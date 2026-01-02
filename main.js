// main.js
const { app, BrowserWindow, screen, ipcMain } = require("electron");
const https = require("https");
const path = require("path");
const fs = require('fs').promises;
const os = require('os');

let win;
let currentVideoInfo = null;
let videoDetectionInterval = null;
let lastMaximizedState = null;
let activeWindowFn = null;
let photoCache = new Map();
let isVideoCheckRunning = false;
let lastActiveWindowInfo = null;
let lastActiveWindowAtMs = 0;
let lastYouTubeDebugKey = null;
let youTubeResolveInFlight = new Set();
let youTubeTitleCache = new Map();
let lastDetectedYouTubeTitle = null;
let lastYouTubeResolveAt = 0;
const YOUTUBE_DEBOUNCE_MS = 300;

// PowerShell process variables for media controls
let psProcess = null;
let psCommandQueue = [];
let psReady = false;
let lastPlaybackState = null; // 'playing' | 'paused' | null
let playbackCheckMs = 0;
const PLAYBACK_CHECK_INTERVAL_MS = 800;
let lastMediaCommandAtMs = 0;
const MEDIA_COMMAND_COOLDOWN_MS = 250;

function startPersistentPowerShell() {
  const { spawn } = require('child_process');
  if (psProcess) return;
  psProcess = spawn('powershell', ['-NoProfile', '-STA', '-Command', '-'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false
  });

  psReady = false;
  let buffer = '';
  psProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    // Simple prompt detection; PowerShell ends commands with a prompt line
    if (buffer.includes('PS>') || buffer.includes('>>')) {
      buffer = '';
      psReady = true;
      drainQueue();
    }
    // Try to parse playback state from any output
    const state = parsePlaybackState(data.toString());
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

  // Prime the session with the required assembly
  psProcess.stdin.write('Add-Type -AssemblyName System.Windows.Forms\n');
}

function queuePowerShellCommand(cmd) {
  if (!psProcess || !psReady) {
    startPersistentPowerShell();
    psCommandQueue.push(cmd);
    return;
  }
  drainQueue();
  if (psReady) {
    psProcess.stdin.write(cmd + '\n');
  }
}

function drainQueue() {
  while (psReady && psCommandQueue.length > 0) {
    const cmd = psCommandQueue.shift();
    psProcess.stdin.write(cmd + '\n');
  }
}

// Helper function to send key commands
function sendKeyCommand(key) {
  const escapedKey = String(key).replace(/'/g, "''");
  const ps = `[System.Windows.Forms.SendKeys]::SendWait('${escapedKey}')`;
  queuePowerShellCommand(ps);
}

// Detect YouTube playback state via UI Automation (Windows)
function detectYouTubePlaybackState() {
  const now = Date.now();
  if (now - playbackCheckMs < PLAYBACK_CHECK_INTERVAL_MS) return;
  playbackCheckMs = now;

  // PowerShell UI Automation to read YouTube's play/pause button aria-label
  const ps = `Add-Type -AssemblyName UIAutomationClient; [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueProperty) | ForEach-Object { $_.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueProperty) } | Where-Object { $_.Current.AutomationId -eq 'movie_player' -and $_.Current.ClassName -eq 'ytd-watch-flexy' } | ForEach-Object { $_.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'play-pause-button')) } | ForEach-Object { $_.Current.Name }`;
  queuePowerShellCommand(ps);
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
    const mod = await import("active-win");
    activeWindowFn = mod.activeWindow;
  }
  return activeWindowFn();
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

    if (windowInfo?.bounds) {
      const primaryDisplay = screen.getPrimaryDisplay();
      const isMaximized = computeIsMaximized(windowInfo.bounds, primaryDisplay.bounds);

      if (lastMaximizedState === null || isMaximized !== lastMaximizedState) {
        lastMaximizedState = isMaximized;
        if (win && !win.isDestroyed()) {
          win.webContents.send(isMaximized ? "island-hide" : "island-show");
        }
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
        // Update video info in the music player
        if (win && !win.isDestroyed()) {
          win.webContents.send("update-video-info", videoInfo);
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
                win.webContents.send("update-video-info", updated);
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
  // Then check every 500ms (faster than before)
  videoDetectionInterval = setInterval(checkVideoPlayback, 300);
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
    try {
      const now = Date.now();
      if (now - lastMediaCommandAtMs < MEDIA_COMMAND_COOLDOWN_MS) return;
      lastMediaCommandAtMs = now;

      const windowInfo = (now - lastActiveWindowAtMs) <= 3000 && lastActiveWindowInfo
        ? lastActiveWindowInfo
        : null;

      const title = windowInfo?.title || "";
      const isYouTubeByTitle = title.toLowerCase().includes("youtube");
      const isYouTubeByUrl = !!(windowInfo?.url && (windowInfo.url.includes("youtube.com") || windowInfo.url.includes("youtu.be")));
      const isYouTubeByState = !!(currentVideoInfo && currentVideoInfo.source === "youtube");
      
      // Send command if YouTube is detected (by URL or title)
      if (isYouTubeByUrl || isYouTubeByTitle || isYouTubeByState) {
        debugLog('Sending spacebar to YouTube (by URL)');
        sendKeyCommand("k");
      } else {
        debugLog('Active window is not YouTube:', title);
      }
    } catch (error) {
      console.error("Error controlling video playback:", error.message);
    }
  });

  ipcMain.on("video-next", async () => {
    try {
      const now = Date.now();
      if (now - lastMediaCommandAtMs < MEDIA_COMMAND_COOLDOWN_MS) return;
      lastMediaCommandAtMs = now;

      const windowInfo = (now - lastActiveWindowAtMs) <= 3000 && lastActiveWindowInfo
        ? lastActiveWindowInfo
        : null;

      const title = windowInfo?.title || "";
      const isYouTubeByTitle = title.toLowerCase().includes("youtube");
      const isYouTubeByUrl = !!(windowInfo?.url && (windowInfo.url.includes("youtube.com") || windowInfo.url.includes("youtu.be")));
      const isYouTubeByState = !!(currentVideoInfo && currentVideoInfo.source === "youtube");
      
      if (isYouTubeByUrl || isYouTubeByTitle || isYouTubeByState) {
        debugLog('Sending Shift+N to YouTube (by URL)');
        sendKeyCommand("+n");
      }
    } catch (error) {
      console.error("Error controlling next video:", error.message);
    }
  });

  ipcMain.on("video-previous", async () => {
    try {
      const now = Date.now();
      if (now - lastMediaCommandAtMs < MEDIA_COMMAND_COOLDOWN_MS) return;
      lastMediaCommandAtMs = now;

      const windowInfo = (now - lastActiveWindowAtMs) <= 3000 && lastActiveWindowInfo
        ? lastActiveWindowInfo
        : null;

      const title = windowInfo?.title || "";
      const isYouTubeByTitle = title.toLowerCase().includes("youtube");
      const isYouTubeByUrl = !!(windowInfo?.url && (windowInfo.url.includes("youtube.com") || windowInfo.url.includes("youtu.be")));
      const isYouTubeByState = !!(currentVideoInfo && currentVideoInfo.source === "youtube");
      
      if (isYouTubeByUrl || isYouTubeByTitle || isYouTubeByState) {
        debugLog('Sending Shift+P to YouTube (by URL)');
        sendKeyCommand("+p");
      }
    } catch (error) {
      console.error("Error controlling previous video:", error.message);
    }
  });

  // Get random photo from user's computer
  ipcMain.handle("get-random-photo", async (event, photoSource) => {
    try {
      const photoDirs = [];
      const selectedSource = photoSource || "all";
      
      // Handle custom folder path
      if (selectedSource.startsWith("C:") || selectedSource.startsWith("/") || selectedSource.includes("\\")) {
        photoDirs.push(selectedSource);
      } else if (process.platform === 'win32') {
        // Windows - search directories based on selected source
        switch (selectedSource) {
          case "pictures":
            photoDirs.push(
              path.join(os.homedir(), 'Pictures'),
              path.join(os.homedir(), 'Pictures', 'Wallpapers'),
              path.join(os.homedir(), 'Pictures', 'Screenshots'),
              'C:\\Users\\Public\\Pictures'
            );
            break;
          case "desktop":
            photoDirs.push(path.join(os.homedir(), 'Desktop'));
            break;
          case "downloads":
            photoDirs.push(path.join(os.homedir(), 'Downloads'));
            break;
          case "wallpapers":
            photoDirs.push(
              path.join(os.homedir(), 'Pictures', 'Wallpapers'),
              path.join(os.homedir(), 'Pictures', 'Screenshots')
            );
            // Only add common wallpaper directories if they exist
            const commonWallpaperDirs = [
              'C:\\Users\\Public\\Pictures',
              'D:\\Wallpapers',
              path.join(os.homedir(), 'AppData', 'Local', 'Packages', 'Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy', 'LocalState', 'Assets'),
              path.join(os.homedir(), 'Pictures', 'Camera Roll')
            ];
            for (const dir of commonWallpaperDirs) {
              try {
                if (fs.existsSync(dir)) {
                  photoDirs.push(dir);
                }
              } catch (e) {
                // Skip if can't check directory
              }
            }
            break;
          case "all":
          default:
            photoDirs.push(
              path.join(os.homedir(), 'Pictures'),
              path.join(os.homedir(), 'Desktop'),
              path.join(os.homedir(), 'Documents'),
              path.join(os.homedir(), 'Downloads'),
              path.join(os.homedir(), 'Pictures', 'Wallpapers'),
              path.join(os.homedir(), 'Pictures', 'Screenshots'),
              'C:\\Users\\Public\\Pictures',
              'C:\\Wallpapers',
              'D:\\Wallpapers',
              'D:\\Pictures',
              'D:\\Downloads'
            );
            break;
        }
      } else if (process.platform === 'darwin') {
        // macOS
        switch (selectedSource) {
          case "pictures":
            photoDirs.push(path.join(os.homedir(), 'Pictures'));
            break;
          case "desktop":
            photoDirs.push(path.join(os.homedir(), 'Desktop'));
            break;
          case "downloads":
            photoDirs.push(path.join(os.homedir(), 'Downloads'));
            break;
          case "wallpapers":
            photoDirs.push(path.join(os.homedir(), 'Pictures', 'Wallpapers'));
            break;
          case "all":
          default:
            photoDirs.push(
              path.join(os.homedir(), 'Pictures'),
              path.join(os.homedir(), 'Desktop'),
              path.join(os.homedir(), 'Documents')
            );
            break;
        }
      } else {
        // Linux
        switch (selectedSource) {
          case "pictures":
            photoDirs.push(path.join(os.homedir(), 'Pictures'));
            break;
          case "desktop":
            photoDirs.push(path.join(os.homedir(), 'Desktop'));
            break;
          case "downloads":
            photoDirs.push(path.join(os.homedir(), 'Downloads'));
            break;
          case "wallpapers":
            photoDirs.push(path.join(os.homedir(), 'Pictures', 'Wallpapers'));
            break;
          case "all":
          default:
            photoDirs.push(
              path.join(os.homedir(), 'Pictures'),
              path.join(os.homedir(), 'Desktop'),
              path.join(os.homedir(), 'Documents')
            );
            break;
        }
      }

      const cacheKey = selectedSource;
      const now = Date.now();
      const cached = photoCache.get(cacheKey);
      if (cached && cached.files && cached.files.length > 0 && (now - cached.lastScanMs) < 10 * 60 * 1000) {
        const randomIndex = Math.floor(Math.random() * cached.files.length);
        return cached.files[randomIndex];
      }

      // Supported image extensions
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'];
      
      // Collect all image files
      const imageFiles = [];
      
      for (const dir of photoDirs) {
        try {
          const files = await fs.readdir(dir);
          
          for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (imageExtensions.includes(ext)) {
              imageFiles.push(path.join(dir, file));
            }
          }
        } catch (err) {
          // Directory doesn't exist or can't be accessed, skip it
          continue;
        }
      }

      photoCache.set(cacheKey, { files: imageFiles, lastScanMs: now });

      if (imageFiles.length === 0) {
        return null; // No images found
      }

      // Return a random image
      const randomIndex = Math.floor(Math.random() * imageFiles.length);
      const selectedImage = imageFiles[randomIndex];
      return selectedImage;
      
    } catch (error) {
      console.error('Error getting random photo:', error);
      return null;
    }
  });

  // Select custom folder for photos
  ipcMain.handle("select-custom-folder", async () => {
    try {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog({
        title: 'Select Photo Folder',
        properties: ['openDirectory'],
        buttonLabel: 'Select Folder'
      });
      
      if (result.filePaths && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return null;
    } catch (error) {
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