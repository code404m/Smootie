// main.js
const { app, BrowserWindow, screen, ipcMain } = require("electron");
const https = require("https");
const path = require("path");
const fs = require('fs').promises;
const os = require('os');

// Platform detection
const platform = process.platform;
const isWindows = platform === 'win32';
const isLinux = platform === 'linux';
const isMac = platform === 'darwin';

let win;
let currentVideoInfo = null;
let videoDetectionInterval = null;
let lastMaximizedState = null;
let activeWindowFn = null;
let photoCache = new Map();
const MAX_CACHE_SIZE = 100;
let isVideoCheckRunning = false;
let lastActiveWindowInfo = null;
let lastActiveWindowAtMs = 0;
let lastYouTubeDebugKey = null;
let youTubeResolveInFlight = new Set();
let youTubeTitleCache = new Map();
let lastDetectedYouTubeTitle = null;
let lastYouTubeResolveAt = 0;
const YOUTUBE_DEBOUNCE_MS = 500;

let lastYouTubeWindowInfo = null;
let lastYouTubeWindowAtMs = 0;

// Platform-specific process variables for media controls
let psProcess = null; // Windows PowerShell
let linuxProcess = null; // Linux shell process
let psCommandQueue = [];
let psReady = false;
let lastPlaybackState = null; // 'playing' | 'paused' | null
let playbackCheckMs = 0;
const PLAYBACK_CHECK_INTERVAL_MS = 1200;
let lastMediaCommandAtMs = 0;
const MEDIA_COMMAND_COOLDOWN_MS = 350;
const IS_DEVELOPMENT = !app.isPackaged;

function getStartupEnabled() {
  try {
    if (isWindows || isMac) {
      const settings = app.getLoginItemSettings();
      return !!settings?.openAtLogin;
    } else if (isLinux) {
      // Linux: Check autostart desktop file
      const autostartDir = path.join(os.homedir(), '.config', 'autostart');
      const desktopFile = path.join(autostartDir, 'smootie.desktop');
      try {
        fs.accessSync(desktopFile);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  } catch (error) {
    console.error("[startup] Failed to get login item settings:", error.message);
    return false;
  }
}

function setStartupEnabled(enable) {
  try {
    if (isWindows || isMac) {
      const args = [];
      if (IS_DEVELOPMENT) {
        args.push(app.getAppPath());
      }
      app.setLoginItemSettings({
        openAtLogin: !!enable,
        path: process.execPath,
        args
      });
      console.log("[startup] setLoginItemSettings:", { enable, path: process.execPath, args });
      return true;
    } else if (isLinux) {
      // Linux: Create/remove autostart desktop file
      const autostartDir = path.join(os.homedir(), '.config', 'autostart');
      const desktopFile = path.join(autostartDir, 'smootie.desktop');
      
      if (enable) {
        // Ensure autostart directory exists
        fs.mkdirSync(autostartDir, { recursive: true });
        
        // Create desktop file
        const desktopContent = `[Desktop Entry]
Type=Application
Name=Smootie
Exec=${process.execPath}
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
        fs.writeFileSync(desktopFile, desktopContent);
      } else {
        // Remove desktop file
        try {
          fs.unlinkSync(desktopFile);
        } catch {
          // File doesn't exist, that's fine
        }
      }
      console.log("[startup] Linux autostart", enable ? "enabled" : "disabled");
      return true;
    }
    return false;
  } catch (error) {
    console.error("[startup] Failed to set login item settings:", error.message);
    return false;
  }
}

function startPersistentPowerShell() {
  if (!isWindows) return;
  const { spawn } = require('child_process');
  if (psProcess) return;
  psProcess = spawn('powershell', ['-NoProfile', '-STA', '-Command', '-'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false
  });

  psReady = false;
  let buffer = '';
  psProcess.stdout.on('data', (data) => {
    const output = data.toString();
    buffer += output;
    
    // Log all PowerShell output for debugging
    const lines = output.split('\n').filter(l => l.trim().length > 0);
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (!trimmed.match(/^PS [A-Z]:\\/)) {
        console.log('[PowerShell]', trimmed);
      }

      if (trimmed === 'PowerShell ready' && !psReady) {
        console.log('[PowerShell] Ready signal received');
        psReady = true;
        drainQueue();
      }
    });
    
    // Simple prompt detection; PowerShell ends commands with a prompt line
    if (buffer.includes('PS>') || buffer.includes('>>') || buffer.match(/PS [A-Z]:\\[^>]*>/)) {
      if (!psReady) {
        console.log('[PowerShell] Session ready');
      }
      buffer = '';
      psReady = true;
      drainQueue();
    }
    // Try to parse playback state from any output
    const state = parsePlaybackState(output);
    if (state && state !== lastPlaybackState) {
      lastPlaybackState = state;
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-playback-state', state);
      }
    }
  });

  psProcess.stderr.on('data', (data) => {
    console.error('PowerShell stderr:', data.toString());
  });

  psProcess.on('close', (code) => {
    console.log('PowerShell process exited with code', code);
    psProcess = null;
    psReady = false;
  });

  // Prime the session with the required assembly and wait for ready
  psProcess.stdin.write('Add-Type -AssemblyName System.Windows.Forms; Write-Host "PowerShell ready"\n');
  console.log('[PowerShell] Started, waiting for ready signal...');
}

function startPersistentLinuxShell() {
  if (!isLinux) return;
  const { spawn } = require('child_process');
  if (linuxProcess) return;
  
  // Try to use bash, fallback to sh
  const shell = process.env.SHELL || '/bin/bash';
  linuxProcess = spawn(shell, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false
  });

  psReady = false;
  let buffer = '';
  linuxProcess.stdout.on('data', (data) => {
    const output = data.toString();
    buffer += output;
    console.log('[Linux Shell]', output.trim());
    
    // Simple prompt detection
    if (buffer.includes('$') || buffer.includes('#')) {
      if (!psReady) {
        console.log('[Linux Shell] Session ready');
        psReady = true;
        drainQueue();
      }
      buffer = '';
    }
  });

  linuxProcess.stderr.on('data', (data) => {
    console.error('Linux Shell stderr:', data.toString());
  });

  linuxProcess.on('close', (code) => {
    console.log('Linux shell process exited with code', code);
    linuxProcess = null;
    psReady = false;
  });

  console.log('[Linux Shell] Started');
}

function queuePowerShellCommand(cmd) {
  console.log("[queueCommand] Queuing command, psReady:", psReady, "hasProcess:", !!psProcess || !!linuxProcess);
  
  // Limit queue size to prevent memory buildup
  if (psCommandQueue.length > 10) {
    psCommandQueue.shift(); // Remove oldest command
  }
  
  if ((!psProcess || !psReady) && (!linuxProcess || !psReady)) {
    console.log("[queueCommand] Process not ready, starting and queuing command");
    if (isWindows) {
      startPersistentPowerShell();
    } else if (isLinux) {
      startPersistentLinuxShell();
    }
    psCommandQueue.push(cmd);
    return;
  }
  drainQueue();
  if (psReady) {
    console.log("[queueCommand] Sending command to process");
    // Ensure command ends properly and triggers execution
    if (isWindows && psProcess) {
      psProcess.stdin.write(cmd.trim() + '\n');
    } else if (isLinux && linuxProcess) {
      linuxProcess.stdin.write(cmd.trim() + '\n');
    }
  } else {
    console.log("[queueCommand] Process not ready, adding to queue");
    psCommandQueue.push(cmd);
  }
}

function drainQueue() {
  while (psReady && psCommandQueue.length > 0) {
    const cmd = psCommandQueue.shift();
    console.log("[drainQueue] Executing queued command");
    if (isWindows && psProcess) {
      psProcess.stdin.write(cmd.trim() + '\n');
    } else if (isLinux && linuxProcess) {
      linuxProcess.stdin.write(cmd.trim() + '\n');
    }
  }
}

// Helper function to send key commands
function sendKeyCommand(key) {
  if (isWindows) {
    const escapedKey = String(key).replace(/'/g, "''");
    const ps = `[System.Windows.Forms.SendKeys]::SendWait('${escapedKey}')`;
    queuePowerShellCommand(ps);
  } else if (isLinux) {
    // Linux: Use xdotool to send keys
    const cmd = `xdotool key '${key}'`;
    queuePowerShellCommand(cmd);
  }
}

function sendMediaKeyCommand(mediaKeyName) {
  console.log("[sendMediaKeyCommand] Called with:", mediaKeyName);
  const name = String(mediaKeyName || "").toUpperCase();
  
  if (isWindows) {
    const vkMap = {
      MEDIA_PLAY_PAUSE: 0xB3,
      MEDIA_NEXT_TRACK: 0xB0,
      MEDIA_PREV_TRACK: 0xB1
    };
    const vk = vkMap[name];
    if (!vk) {
      console.log("[sendMediaKeyCommand] Unknown media key:", name);
      return;
    }

    const ps = `
      if (-not ([System.Management.Automation.PSTypeName]'Win32.NativeMethods').Type) {
        Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @'
          using System;
          using System.Runtime.InteropServices;

          public static class NativeMethods {
            [DllImport("user32.dll")]
            public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
          }
        '@;
      }

      [Win32.NativeMethods]::keybd_event(${vk}, 0, 0, 0)
      Start-Sleep -Milliseconds 10
      [Win32.NativeMethods]::keybd_event(${vk}, 0, 2, 0)
      Write-Host "Sent media key: ${name}"
    `;
    console.log("[sendMediaKeyCommand] Sending Windows media key command");
    queuePowerShellCommand(ps);
  } else if (isLinux) {
    // Linux: Use xdotool or dbus for media keys
    const mediaKeyMap = {
      'MEDIA_PLAY_PAUSE': 'XF86AudioPlay',
      'MEDIA_NEXT_TRACK': 'XF86AudioNext',
      'MEDIA_PREV_TRACK': 'XF86AudioPrev'
    };
    
    const linuxKey = mediaKeyMap[name];
    if (!linuxKey) {
      console.log("[sendMediaKeyCommand] Unknown Linux media key:", name);
      return;
    }
    
    // Try dbus first (more reliable for media controls)
    const dbusCmd = `dbus-send --type=method_call --dest=org.mpris.MediaPlayer2.player /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player.${name === 'MEDIA_PLAY_PAUSE' ? 'PlayPause' : name === 'MEDIA_NEXT_TRACK' ? 'Next' : 'Previous'}`;
    
    // Fallback to xdotool
    const xdotoolCmd = `xdotool key ${linuxKey}`;
    
    console.log("[sendMediaKeyCommand] Sending Linux media key command");
    // Try dbus first, then fallback to xdotool
    queuePowerShellCommand(`${dbusCmd} 2>/dev/null || ${xdotoolCmd}`);
  }
}

// Helper function to activate YouTube/Chrome window first, then send key "k"
function activateYouTubeAndSendKey(youtubeWindowTitle, youtubeProcessId, key) {
  console.log("[activateYouTubeAndSendKey] Called with:", {
    title: youtubeWindowTitle,
    processId: youtubeProcessId,
    key
  });

  const escapedTitle = String(youtubeWindowTitle || "").replace(/'/g, "''").replace(/`/g, "``");
  const escapedKey = String(key).replace(/'/g, "''");
  const pid = Number.isFinite(Number(youtubeProcessId)) ? Number(youtubeProcessId) : null;

  if (isWindows) {
    // Build a minimal, safe PowerShell script: try AppActivate by PID, then by title, then by generic 'YouTube'
    const pidActivation = pid !== null
      ? `
        try { $activated = $shell.AppActivate(${pid}) } catch { $activated = $false }
      `
      : `
        $activated = $false
      `;

    const titleActivation = escapedTitle
      ? `
        if (-not $activated -and '${escapedTitle}'.Length -gt 0) {
          try { $activated = $shell.AppActivate('${escapedTitle}') } catch { }
        }
      `
      : "";

    const ps = `
      Add-Type -AssemblyName System.Windows.Forms
      $shell = New-Object -ComObject WScript.Shell
      $activated = $false
      ${pidActivation}
      ${titleActivation}
      if (-not $activated) {
        try { $activated = $shell.AppActivate('YouTube') } catch { }
      }
      if (-not $activated) {
        try { $activated = $shell.AppActivate('Google Chrome') } catch { }
      }
      if ($activated) {
        Start-Sleep -Milliseconds 120
        [System.Windows.Forms.SendKeys]::SendWait('${escapedKey}')
        Write-Host "[activateYouTubeAndSendKey] Sent key '${escapedKey}'"
      } else {
        Write-Host "[activateYouTubeAndSendKey] Could not activate a YouTube window"
      }
    `;

    console.log("[activateYouTubeAndSendKey] Queuing PowerShell command");
    queuePowerShellCommand(ps);
  } else if (isLinux) {
    // Linux: Use xdotool to find and activate YouTube window, then send key
    const linuxCmd = `
      # Try to find YouTube window by title
      WINDOW_ID=$(xdotool search --name "${escapedTitle}" | head -1)
      if [ -z "$WINDOW_ID" ]; then
        # Try generic YouTube
        WINDOW_ID=$(xdotool search --name "YouTube" | head -1)
      fi
      if [ -z "$WINDOW_ID" ]; then
        # Try Chrome
        WINDOW_ID=$(xdotool search --name "Google Chrome" | head -1)
      fi
      if [ -n "$WINDOW_ID" ]; then
        xdotool windowactivate "$WINDOW_ID"
        sleep 0.12
        xdotool key "${escapedKey}"
        echo "[activateYouTubeAndSendKey] Sent key '${escapedKey}' to window $WINDOW_ID"
      else
        echo "[activateYouTubeAndSendKey] Could not activate a YouTube window"
      fi
    `;
    
    console.log("[activateYouTubeAndSendKey] Queuing Linux command");
    queuePowerShellCommand(linuxCmd);
  }
}

// Detect YouTube playback state via UI Automation (Windows)
function detectYouTubePlaybackState() {
  const now = Date.now();
  if (now - playbackCheckMs < PLAYBACK_CHECK_INTERVAL_MS) return;
  playbackCheckMs = now;
  // UI Automation-based playback detection is temporarily disabled due to
  // PowerShell parser issues and to simplify the media control path.
}

// Parse playback state from UI Automation output
function parsePlaybackState(output) {
  if (!output || typeof output !== 'string') return null;
  const lower = output.toLowerCase().trim();
  if (lower.includes('play') && !lower.includes('pause')) return 'paused';
  if (lower.includes('pause') && !lower.includes('play')) return 'playing';
  return null;
}

const DEBUG_LOGS = false;
function debugLog(...args) {
  if (DEBUG_LOGS) console.log(...args);
}

const NOOK_WIDTH = 750;
const NOOK_HEIGHT = 140;

// ---------------- VIDEO DETECTION (YouTube Only) ----------------四肢
function computeIsMaximized(windowBounds, screenBounds) {
  let positionTolerance, sizeTolerance;

  const hasSignificantOffset = Math.abs(windowBounds.x) > 50 || Math.abs(windowBounds.y) > 50;
  const isMuchLarger = windowBounds.width > screenBounds.width * 1.1 ||
                      windowBounds.height > screenBounds.height * 1.1;

  if (hasSignificantOffset) {
    positionTolerance = 100;
    sizeTolerance = 20;
  } else if (isMuchLarger) {
    positionTolerance = 150;
    sizeTolerance = 50;
  } else {
    positionTolerance = 20;
    sizeTolerance = 20;
  }
  return (
    Math.abs(windowBounds.x - screenBounds.x) <= positionTolerance &&
    Math.abs(windowBounds.y - screenBounds.y) <= positionTolerance &&
    windowBounds.width >= screenBounds.width - sizeTolerance &&
    windowBounds.height >= screenBounds.height - sizeTolerance
  );
}

async function getActiveWindowInfo() {
  if (!activeWindowFn) {
    if (isWindows) {
      const mod = await import("active-win");
      activeWindowFn = mod.activeWindow;
    } else if (isLinux) {
      // Linux: Use xdotool or wmctrl for active window detection
      activeWindowFn = getActiveWindowLinux;
    } else if (isMac) {
      const mod = await import("active-win");
      activeWindowFn = mod.activeWindow;
    }
  }
  return activeWindowFn();
}

// Linux active window detection using xdotool
async function getActiveWindowLinux() {
  const { exec } = require('child_process');
  
  return new Promise((resolve) => {
    // Try xdotool first (more precise)
    exec('xdotool getwindowfocus getwindowname 2>/dev/null', (error, stdout, stderr) => {
      if (!error && stdout) {
        const title = stdout.trim();
        if (title) {
          resolve({
            title: title,
            owner: { name: 'unknown' },
            bounds: { x: 0, y: 0, width: 1920, height: 1080 } // Default bounds
          });
          return;
        }
      }
      
      // Fallback to wmctrl
      exec('wmctrl -a :ACTIVE: -l 2>/dev/null | head -1', (error2, stdout2) => {
        if (!error2 && stdout2) {
          const parts = stdout2.trim().split(/\s+/);
          const title = parts.slice(3).join(' ');
          if (title) {
            resolve({
              title: title,
              owner: { name: 'unknown' },
              bounds: { x: 0, y: 0, width: 1920, height: 1080 }
            });
            return;
          }
        }
        
        // Final fallback
        resolve({
          title: '',
          owner: { name: 'unknown' },
          bounds: { x: 0, y: 0, width: 1920, height: 1080 }
        });
      });
    });
  });
}

function isYouTubeWindow(windowInfo) {
  if (!windowInfo) return { isVideo: false };
  
  const title = windowInfo.title || "";
  const titleLower = title.toLowerCase();
  const url = (windowInfo.url || "").toLowerCase();

  function extractYouTubeVideoId(rawUrl) {
    if (!rawUrl) return null;
    try {
      const urlObj = new URL(rawUrl);
      const v = urlObj.searchParams.get("v");
      if (v && v.length === 11) return v;
      const parts = urlObj.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && last.length === 11) return last.split("?")[0];
    } catch (e) {
      const match = rawUrl.match(/(?:watch\?v=|youtu\.be\/|embed\/)([^&\s?]+)/i);
      if (match && match[1] && match[1].length === 11) return match[1];
    }
    return null;
  }

  function extractVideoIdFromTitle(videoTitle) {
    if (!videoTitle) return null;
    
    // More aggressive patterns to find video IDs in titles
    const patterns = [
      /watch\?v=([a-zA-Z0-9_-]{11})/i,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/i,
      /v=([a-zA-Z0-9_-]{11})/i,
      /embed\/([a-zA-Z0-9_-]{11})/i,
      /\b([a-zA-Z0-9_-]{11})\b/
    ];
    
    for (const pattern of patterns) {
      const match = videoTitle.match(pattern);
      if (match && match[1] && match[1].length === 11) {
        return match[1];
      }
    }
    return null;
  }
  
  const isYouTubeDomain = url.includes("youtube.com") || url.includes("youtu.be") || url.includes("music.youtube.com");

  // URL-based detection (most reliable when URL is available)
  if (isYouTubeDomain) {
    // Extract video ID and title
    let videoId = extractYouTubeVideoId(windowInfo.url);
    
    // Try to extract video title from window title (format: "Video Title - YouTube" or just "Video Title")
    let videoTitle = title;
    if (title.includes(" - YouTube")) {
      videoTitle = title.replace(" - YouTube", "").trim();
    } else if (title.includes(" | YouTube")) {
      videoTitle = title.replace(" | YouTube", "").trim();
    }
    
    // Remove browser name from title if present
    const browserNames = [" - Google Chrome", " - Mozilla Firefox", " - Microsoft Edge", " - Brave", " - Opera", " - Safari", " - Vivaldi", " - Arc", " - Zen"];
    for (const browserName of browserNames) {
      if (videoTitle.includes(browserName)) {
        videoTitle = videoTitle.replace(browserName, "").trim();
      }
    }
    
    // Only return video info if we have a valid video title
    if (videoTitle && videoTitle !== "" && videoTitle !== "YouTube") {
      // If we don't have a video ID from URL, try to extract from title
      if (!videoId) {
        videoId = extractVideoIdFromTitle(videoTitle);
      }

      return {
        isVideo: true,
        source: "youtube",
        title: videoTitle,
        url: windowInfo.url || "",
        videoId: videoId || "detected",
        thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null
      };
    }
  }

  // Check for YouTube in title (fallback when URL is undefined)
  if (titleLower.includes("youtube")) {
    // Try to extract video title from window title (format: "Video Title - YouTube" or just "Video Title")
    let videoTitle = title;
    if (title.includes(" - YouTube")) {
      videoTitle = title.replace(" - YouTube", "").trim();
    } else if (title.includes(" | YouTube")) {
      videoTitle = title.replace(" | YouTube", "").trim();
    }
    
    // Remove browser name from title if present
    const browserNames = [" - Google Chrome", " - Mozilla Firefox", " - Microsoft Edge", " - Brave", " - Opera", " - Safari", " - Vivaldi", " - Arc", " - Zen"];
    for (const browserName of browserNames) {
      if (videoTitle.includes(browserName)) {
        videoTitle = videoTitle.replace(browserName, "").trim();
      }
    }
    
    // Remove tab numbers like (99), (1), etc. from the beginning
    videoTitle = videoTitle.replace(/^\(\d+\)\s*/, '');

    // Try to extract video ID from title when URL is not available
    let videoId = extractYouTubeVideoId(windowInfo.url);
    if (!videoId) {
      videoId = extractVideoIdFromTitle(videoTitle);
    }
    
    // Check if this looks like a video page (has a title that's not just "YouTube")
    if (videoTitle && videoTitle !== "" && videoTitle !== "YouTube" && 
        !titleLower.includes("home") && !titleLower.includes("search") && 
        !titleLower.includes("trending") && !titleLower.includes("subscriptions")) {

      return {
        isVideo: true,
        source: "youtube",
        title: videoTitle,
        url: windowInfo.url || "",
        videoId: videoId || "detected",
        thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null
      };
    }
  }
  
  return { isVideo: false };
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

function httpsGetText(url, opts = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const options = {
      ...opts,
      headers: {
        "User-Agent": "Mozilla/5.0",
        ...(opts.headers || {})
      }
    };

    https.get(url, options, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers?.location;
      if (status >= 300 && status < 400 && location && redirectCount < 3) {
        res.resume();
        const nextUrl = new URL(location, url).toString();
        resolve(httpsGetText(nextUrl, opts, redirectCount + 1));
        return;
      }

      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

async function resolveYouTubeByTitle(videoTitle) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;
  if (!videoTitle) return null;

  const cached = youTubeTitleCache.get(videoTitle);
  const now = Date.now();
  if (cached && cached.videoId && (now - cached.atMs) < 12 * 60 * 60 * 1000) {
    return cached;
  }

  const q = encodeURIComponent(videoTitle);
  const endpoint = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${q}&key=${apiKey}`;
  const json = await httpsGetJson(endpoint);
  const item = json?.items?.[0];
  const videoId = item?.id?.videoId;
  if (!videoId || String(videoId).length !== 11) return null;
  const resolved = {
    videoId,
    thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    atMs: now
  };
  youTubeTitleCache.set(videoTitle, resolved);
  
  // Clean up old cache entries to prevent memory buildup
  if (youTubeTitleCache.size > MAX_CACHE_SIZE) {
    const oldestKey = youTubeTitleCache.keys().next().value;
    youTubeTitleCache.delete(oldestKey);
  }
  
  return resolved;
}

async function resolveYouTubeByTitleNoApi(videoTitle) {
  if (!videoTitle) return null;

  const cached = youTubeTitleCache.get(videoTitle);
  const now = Date.now();
  if (cached && cached.videoId && (now - cached.atMs) < 12 * 60 * 60 * 1000) {
    return cached;
  }

  const q = encodeURIComponent(videoTitle);
  const endpoint = `https://www.youtube.com/results?search_query=${q}`;
  const html = await httpsGetText(endpoint);

  const matchVideoId = html.match(/\"videoId\"\s*:\s*\"([a-zA-Z0-9_-]{11})\"/) ||
    html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
  const videoId = matchVideoId?.[1];
  if (!videoId || String(videoId).length !== 11) return null;

  const resolved = {
    videoId,
    thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    atMs: now
  };
  youTubeTitleCache.set(videoTitle, resolved);
  
  // Clean up old cache entries to prevent memory buildup
  if (youTubeTitleCache.size > MAX_CACHE_SIZE) {
    const oldestKey = youTubeTitleCache.keys().next().value;
    youTubeTitleCache.delete(oldestKey);
  }
  
  return resolved;
}

async function checkVideoPlayback() {
  if (isVideoCheckRunning) return;
  isVideoCheckRunning = true;
  try {
    // Dynamic import for ES module - use activeWindow export
    const windowInfo = await getActiveWindowInfo();

    lastActiveWindowInfo = windowInfo || null;
    lastActiveWindowAtMs = Date.now();

    let isMaximized = false;
    if (windowInfo?.bounds) {
      const primaryDisplay = screen.getPrimaryDisplay();
      isMaximized = computeIsMaximized(windowInfo.bounds, primaryDisplay.bounds);

      // Always update island visibility based on current maximized state
      if (win && !win.isDestroyed()) {
        win.webContents.send(isMaximized ? "island-hide" : "island-show");
      }

      // Still track state changes for debugging/logging
      if (lastMaximizedState === null || isMaximized !== lastMaximizedState) {
        lastMaximizedState = isMaximized;
        console.log("[maximized] State changed to:", isMaximized);
      }
    } else {
      // No window bounds available, assume not maximized and show island
      if (win && !win.isDestroyed()) {
        win.webContents.send("island-show");
      }
      if (lastMaximizedState !== false) {
        lastMaximizedState = false;
        console.log("[maximized] No window bounds, assuming not maximized");
      }
    }
    
    // Check if it's a browser window (has URL) or known browser
    const ownerName = (windowInfo?.owner?.name || "").toLowerCase();
    const title = (windowInfo?.title || "").toLowerCase();
    const url = (windowInfo?.url || "").toLowerCase();
    
    // Any window with a URL is likely a browser, plus check known browsers
    const isBrowser = (url && url.length > 0) || 
                     ownerName.includes('chrome') || ownerName.includes('edge') || 
                     ownerName.includes('firefox') || ownerName.includes('brave') ||
                     ownerName.includes('opera') || ownerName.includes('safari') ||
                     ownerName.includes('vivaldi') || ownerName.includes('arc') ||
                     ownerName.includes('chromium') || ownerName.includes('mozilla') ||
                     ownerName.includes('zen') || ownerName.includes('iexplore') ||
                     ownerName.includes('explorer') || title.includes('google chrome') ||
                     title.includes('mozilla firefox') || title.includes('microsoft edge') ||
                     title.includes('brave') || title.includes('opera') || title.includes('safari') ||
                     title.includes('firefox') || title.includes('mozilla') || title.includes('zen') ||
                     title.includes('internet explorer') || title.includes('iexplore');

    let videoInfo = isYouTubeWindow(windowInfo);

    if (videoInfo?.isVideo && videoInfo?.source === "youtube" && (!videoInfo.thumbnail || videoInfo.videoId === "detected")) {
      const cached = youTubeTitleCache.get(videoInfo.title);
      if (cached?.videoId && cached?.thumbnail) {
        videoInfo = {
          ...videoInfo,
          videoId: cached.videoId,
          thumbnail: cached.thumbnail
        };
      }
    }

    const looksYouTubeish = url.includes("youtube") || title.includes("youtube");
    if (looksYouTubeish) {
      lastYouTubeWindowInfo = {
        title: windowInfo?.title || "",
        processId: windowInfo?.owner?.processId || null
      };
      lastYouTubeWindowAtMs = Date.now();

      const debugKey = `${windowInfo?.title || ""}|${windowInfo?.url || ""}|${videoInfo?.isVideo ? "video" : "novideo"}|${videoInfo?.videoId || ""}|${videoInfo?.thumbnail || ""}`;
      if (debugKey !== lastYouTubeDebugKey) {
        lastYouTubeDebugKey = debugKey;
        console.log("[youtube-detect]", {
          owner: windowInfo?.owner?.name,
          title: windowInfo?.title,
          url: windowInfo?.url,
          videoInfo
        });
      }
    }

    // Skip non-browser windows only when YouTube isn't detected.
    // Some YouTube PWAs / WebView windows may not expose a URL or recognizable browser owner.
    if (!videoInfo.isVideo && !isBrowser) return;
    
    if (videoInfo.isVideo) {
      const hasMeaningfulChange = !currentVideoInfo ||
        currentVideoInfo.title !== videoInfo.title ||
        currentVideoInfo.source !== videoInfo.source ||
        currentVideoInfo.url !== videoInfo.url ||
        currentVideoInfo.videoId !== videoInfo.videoId ||
        currentVideoInfo.thumbnail !== videoInfo.thumbnail;

      if (hasMeaningfulChange) {
        currentVideoInfo = videoInfo;
  // Update video info in the music player with debouncing
  if (win && !win.isDestroyed()) {
    // Use setTimeout to batch rapid updates
    if (win.videoUpdateTimeout) {
      clearTimeout(win.videoUpdateTimeout);
    }
    win.videoUpdateTimeout = setTimeout(() => {
      win.webContents.send("update-video-info", videoInfo);
      win.videoUpdateTimeout = null;
    }, 50);
  }
      }

      if (videoInfo.source === "youtube" && (!videoInfo.thumbnail || videoInfo.videoId === "detected")) {
        const titleKey = videoInfo.title;
        if (titleKey && titleKey !== lastDetectedYouTubeTitle) {
          lastDetectedYouTubeTitle = titleKey;
          lastYouTubeResolveAt = Date.now() - YOUTUBE_DEBOUNCE_MS - 1;
        }
        if (titleKey && !youTubeResolveInFlight.has(titleKey) && (Date.now() - lastYouTubeResolveAt > YOUTUBE_DEBOUNCE_MS)) {
          youTubeResolveInFlight.add(titleKey);
          const resolver = process.env.YOUTUBE_API_KEY ? resolveYouTubeByTitle : resolveYouTubeByTitleNoApi;
          resolver(titleKey)
            .then((resolved) => {
              if (!resolved) return;
              if (lastDetectedYouTubeTitle !== titleKey) return;

              const base = (currentVideoInfo && currentVideoInfo.source === "youtube" && currentVideoInfo.title === titleKey)
                ? currentVideoInfo
                : { ...videoInfo, title: titleKey };

              const updated = {
                ...base,
                videoId: resolved.videoId,
                thumbnail: resolved.thumbnail
              };

              currentVideoInfo = updated;
              if (win && !win.isDestroyed()) {
                // Use debounced update for resolved video info
                if (win.videoUpdateTimeout) {
                  clearTimeout(win.videoUpdateTimeout);
                }
                win.videoUpdateTimeout = setTimeout(() => {
                  win.webContents.send("update-video-info", updated);
                  win.videoUpdateTimeout = null;
                }, 50);
              }
            })
            .catch(() => {
              // ignore
            })
            .finally(() => {
              youTubeResolveInFlight.delete(titleKey);
            });
        }
      }

      // Trigger playback state detection when YouTube video is detected
      detectYouTubePlaybackState();
    } else {
      // Only clear if we had video info before
      if (currentVideoInfo) {
        lastDetectedYouTubeTitle = null;
        currentVideoInfo = null;
        lastPlaybackState = null;
        if (win && !win.isDestroyed()) {
          win.webContents.send("update-video-info", null);
          win.webContents.send("update-playback-state", null);
        }
      }
    }
  } catch (error) {
    // Silently handle errors (e.g., permissions, window not available)
    console.error("Error detecting video:", error.message);
  } finally {
    isVideoCheckRunning = false;
  }
}

function startVideoDetection() {
  if (videoDetectionInterval) return;
  // Check immediately on startup
  checkVideoPlayback();
  // Then check frequently so maximization changes are detected quickly
  // 280ms is a good balance between responsiveness and CPU usage
  videoDetectionInterval = setInterval(checkVideoPlayback, 280);
}

function stopVideoDetection() {
  if (videoDetectionInterval) {
    clearInterval(videoDetectionInterval);
    videoDetectionInterval = null;
  }
}

// ---------------- CREATE WINDOW ----------------四肢
function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const screenWidth = primary.bounds.width;
  const screenY = primary.bounds.y || 0;

  const x = Math.round(primary.bounds.x + (screenWidth - NOOK_WIDTH) / 2);
  const y = primary.bounds.y; // Always at the very top of the screen

  win = new BrowserWindow({
    width: NOOK_WIDTH,
    height: NOOK_HEIGHT,
    x, y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile("index.html");

  win.webContents.on("did-finish-load", () => {
    setTimeout(() => {
      win.showInactive();
    }, 80);
  });

  setTimeout(() => win.setPosition(x, y), 150);
}

// ---------------- IPC HANDLERS ----------------四肢
function setupIpcHandlers() {
  ipcMain.on("request-video-check", async () => {
    await checkVideoPlayback();
  });

  // Test function to trigger video controls
  ipcMain.on("test-video-controls", async () => {
    console.log('Testing video controls...');
    // Simulate clicking the play/pause button
    ipcMain.emit('video-play-pause');
  });

  // Video control handlers
  ipcMain.on("video-play-pause", async () => {
    console.log("[IPC] video-play-pause received");
    try {
      const now = Date.now();
      if (now - lastMediaCommandAtMs < MEDIA_COMMAND_COOLDOWN_MS) {
        console.log("[IPC] video-play-pause: cooldown active, ignoring");
        return;
      }
      lastMediaCommandAtMs = now;

      const target = (now - lastYouTubeWindowAtMs) <= 15000 && lastYouTubeWindowInfo
        ? lastYouTubeWindowInfo
        : ((now - lastActiveWindowAtMs) <= 3000 && lastActiveWindowInfo
          ? { title: lastActiveWindowInfo?.title || "", processId: lastActiveWindowInfo?.owner?.processId || null }
          : null);

      const title = target?.title || "";
      const processId = target?.processId || null;
      const isYouTubeByTitle = title.toLowerCase().includes("youtube");
      const isYouTubeByState = !!(currentVideoInfo && currentVideoInfo.source === "youtube");

      console.log("[IPC] video-play-pause:", {
        title,
        processId,
        isYouTubeByTitle,
        isYouTubeByState,
        hasTarget: !!target,
        currentVideoInfo: currentVideoInfo?.source
      });

      if (isYouTubeByTitle || isYouTubeByState) {
        console.log("[IPC] Executing play/pause command for YouTube using 'k'");
        // Focus the YouTube/Chrome window and send YouTube's 'k' shortcut only
        activateYouTubeAndSendKey(title, processId, "k");
      } else {
        // Fallback: send a global media play/pause key when we don't have a clear YouTube target
        console.log("[IPC] video-play-pause: Not clearly YouTube, using media key fallback");
        sendMediaKeyCommand("MEDIA_PLAY_PAUSE");
      }
    } catch (error) {
      console.error("Error controlling video playback:", error.message);
    }
  });

  ipcMain.on("video-next", async () => {
    console.log("[IPC] video-next received");
    try {
      const now = Date.now();
      if (now - lastMediaCommandAtMs < MEDIA_COMMAND_COOLDOWN_MS) {
        console.log("[IPC] video-next: cooldown active, ignoring");
        return;
      }
      lastMediaCommandAtMs = now;

      const target = (now - lastYouTubeWindowAtMs) <= 15000 && lastYouTubeWindowInfo
        ? lastYouTubeWindowInfo
        : ((now - lastActiveWindowAtMs) <= 3000 && lastActiveWindowInfo
          ? { title: lastActiveWindowInfo?.title || "", processId: lastActiveWindowInfo?.owner?.processId || null }
          : null);

      const title = target?.title || "";
      const processId = target?.processId || null;
      const isYouTubeByTitle = title.toLowerCase().includes("youtube");
      const isYouTubeByState = !!(currentVideoInfo && currentVideoInfo.source === "youtube");

      console.log("[IPC] video-next:", {
        title,
        processId,
        isYouTubeByTitle,
        isYouTubeByState,
        hasTarget: !!target,
        currentVideoInfo: currentVideoInfo?.source
      });

      if (isYouTubeByTitle || isYouTubeByState) {
        console.log("[IPC] Executing next command for YouTube using Shift+N");
        activateYouTubeAndSendKey(title, processId, "+n");
      } else {
        // Fallback: send a global media next-track key when we don't have a clear YouTube target
        console.log("[IPC] video-next: Not clearly YouTube, using media key fallback");
        sendMediaKeyCommand("MEDIA_NEXT_TRACK");
      }
    } catch (error) {
      console.error("Error controlling next video:", error.message);
    }
  });

  ipcMain.on("video-previous", async () => {
    console.log("[IPC] video-previous received");
    try {
      const now = Date.now();
      if (now - lastMediaCommandAtMs < MEDIA_COMMAND_COOLDOWN_MS) {
        console.log("[IPC] video-previous: cooldown active, ignoring");
        return;
      }
      lastMediaCommandAtMs = now;

      const target = (now - lastYouTubeWindowAtMs) <= 15000 && lastYouTubeWindowInfo
        ? lastYouTubeWindowInfo
        : ((now - lastActiveWindowAtMs) <= 3000 && lastActiveWindowInfo
          ? { title: lastActiveWindowInfo?.title || "", processId: lastActiveWindowInfo?.owner?.processId || null }
          : null);

      const title = target?.title || "";
      const processId = target?.processId || null;
      const isYouTubeByTitle = title.toLowerCase().includes("youtube");
      const isYouTubeByState = !!(currentVideoInfo && currentVideoInfo.source === "youtube");

      console.log("[IPC] video-previous:", {
        title,
        processId,
        isYouTubeByTitle,
        isYouTubeByState,
        hasTarget: !!target,
        currentVideoInfo: currentVideoInfo?.source
      });

      if (isYouTubeByTitle || isYouTubeByState) {
        console.log("[IPC] Executing previous command for YouTube using Shift+P");
        activateYouTubeAndSendKey(title, processId, "+p");
      } else {
        // Fallback: send a global media previous-track key when we don't have a clear YouTube target
        console.log("[IPC] video-previous: Not clearly YouTube, using media key fallback");
        sendMediaKeyCommand("MEDIA_PREV_TRACK");
      }
    } catch (error) {
      console.error("Error controlling previous video:", error.message);
    }
  });

  // Get random photo from user's computer
  ipcMain.handle("get-random-photo", async (event, photoSource) => {
    try {
      if (!photoSource || photoSource === "all") {
        // For now, return null for "all" source - could be implemented later
        return null;
      }

      // Otherwise treat photoSource as a folder path
      return await getRandomPhotoFromFolder(photoSource);
    } catch (error) {
      console.error('Error getting random photo:', error);
      return null;
    }
  });

  // Helper function to get random photo from a specific folder
  async function getRandomPhotoFromFolder(folderPath) {
    if (!folderPath) {
      return null;
    }

    // Supported image extensions
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'];

    // Collect all image files
    const imageFiles = [];

    try {
      const files = await fs.readdir(folderPath);

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (imageExtensions.includes(ext)) {
          imageFiles.push(path.join(folderPath, file));
        }
      }
    } catch (err) {
      // Directory doesn't exist or can't be accessed, skip it
      return null;
    }

    if (imageFiles.length === 0) {
      return null; // No images found
    }

    // Return a random image
    const randomIndex = Math.floor(Math.random() * imageFiles.length);
    const selectedImage = imageFiles[randomIndex];
    return selectedImage;
  }

  // Get random photo from user's computer (legacy handler)
  ipcMain.handle("get-random-photo-from-folder", async (event, folderPath) => {
    return await getRandomPhotoFromFolder(folderPath);
  });

  // Select custom folder for photos
  ipcMain.handle("select-custom-folder", async () => {
    const { dialog } = require('electron');
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    });
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
    }
  });

  ipcMain.handle("get-folder-path", async () => {
    const { dialog } = require('electron');
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    });
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
      console.error('Error selecting folder:', error);
      return null;
    }
  });

  // Hide/show island window handlers
  ipcMain.on("hide-island-window", () => {
    console.log("hide-island-window IPC received");
    if (win && !win.isDestroyed()) {
      console.log("Hiding window - current visible state:", win.isVisible());
      try {
        // Disable alwaysOnTop first
        win.setAlwaysOnTop(false);
        // Small delay to ensure alwaysOnTop is disabled
        setTimeout(() => {
          win.hide();
          console.log("Window hidden, new visible state:", win.isVisible());
        }, 10);
      } catch (error) {
        console.error("Error hiding window:", error);
      }
    } else {
      console.error("Window not available or destroyed");
    }
  });

  ipcMain.on("show-island-window", () => {
    console.log("show-island-window IPC received");
    if (win && !win.isDestroyed()) {
      console.log("Showing window");
      try {
        win.showInactive();
        // Re-enable alwaysOnTop after showing
        setTimeout(() => {
          win.setAlwaysOnTop(true, "screen-saver");
          console.log("Window shown, alwaysOnTop re-enabled");
        }, 50);
      } catch (error) {
        console.error("Error showing window:", error);
      }
    } else {
      console.error("Window not available or destroyed");
    }
  });

  // Quit app handler
  ipcMain.on("quit-app", () => {
    console.log("quit-app IPC received");
    app.quit();
  });

  // Check if any window is maximized using active-win package
  ipcMain.handle("is-window-maximized", async () => {
    try {
      // Use active-win to get the active window info
      const windowInfo = await getActiveWindowInfo();
      
      if (!windowInfo || !windowInfo.bounds) {
        return false;
      }
      
      // Get screen bounds
      const primaryDisplay = screen.getPrimaryDisplay();
      const screenBounds = primaryDisplay.bounds;

      return computeIsMaximized(windowInfo.bounds, screenBounds);
    } catch (error) {
      console.error('Error checking maximized windows:', error.message);
      return false;
    }
  });

}

// ---------------- APP INIT ----------------四肢
app.whenReady().then(() => {
  createWindow();
  setupIpcHandlers();
  startVideoDetection();
});

app.on("will-quit", () => {
  stopVideoDetection();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0)
    createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});