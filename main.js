// main.js
const { app, BrowserWindow, screen, globalShortcut, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const https = require("https");

let win;
let isHidden = false;

const NOTCH_WIDTH = 360;
const NOTCH_WIDTH_EXPANDED = 600; // For multi-section layout
const NOTCH_HEIGHT = 40;
const NOTCH_HEIGHT_EXPANDED = 120; // For expanded activities
const NOTCH_HEIGHT_MULTI = 120; // For multi-section layout

let lastKnownSize = { width: NOTCH_WIDTH, height: NOTCH_HEIGHT };
let isRepositioning = false;
let repositionResetTimer = null;

function buildSizePayload(width, height) {
  return {
    width,
    height,
    expanded: width > NOTCH_WIDTH || height > NOTCH_HEIGHT
  };
}

function getDisplayForWindow() {
  if (!win || win.isDestroyed()) {
    return screen.getPrimaryDisplay();
  }
  const bounds = win.getBounds();
  return screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
}

function markRepositioning() {
  isRepositioning = true;
  clearTimeout(repositionResetTimer);
  repositionResetTimer = setTimeout(() => {
    isRepositioning = false;
  }, 20);
}

function resizeAndCenter(width, height) {
  if (!win || win.isDestroyed()) return;

  if (height > 0) {
    lastKnownSize = { width, height };
  }

  const display = getDisplayForWindow();
  const bounds = display.bounds;

  const x = Math.round(bounds.x + (bounds.width - width) / 2);
  const y = bounds.y;

  markRepositioning();
  // Use animate: true for smoother window resizing
  win.setBounds({ x, y, width, height }, true);
}

// ---------------- HIDE / SHOW (REAL HIDE) ----------------
function hideIsland() {
  if (!win || win.isDestroyed() || isHidden) return;
  isHidden = true;

  win.webContents.send("island-hide", buildSizePayload(lastKnownSize.width, 0));

  // Shrink window to zero height
  markRepositioning();
  win.setSize(lastKnownSize.width, 0, true);
}

function showIsland(height = lastKnownSize.height, width = lastKnownSize.width) {
  if (!win || win.isDestroyed()) return;
  isHidden = false;

  resizeAndCenter(width, height);

  win.webContents.send("island-show", buildSizePayload(lastKnownSize.width, lastKnownSize.height));
}

function expandIsland(height = NOTCH_HEIGHT_EXPANDED, width = NOTCH_WIDTH) {
  if (!win || win.isDestroyed() || isHidden) return;
  resizeAndCenter(width, height);
  win.webContents.send("island-expand", buildSizePayload(lastKnownSize.width, lastKnownSize.height));
}

function collapseIsland() {
  if (!win || win.isDestroyed() || isHidden) return;
  resizeAndCenter(NOTCH_WIDTH, NOTCH_HEIGHT);
  win.webContents.send("island-collapse", buildSizePayload(lastKnownSize.width, lastKnownSize.height));
}

// ---------------- DETECTION ----------------
function checkFullscreenState() {
  const focused = BrowserWindow.getFocusedWindow();

  if (!focused) {
    showIsland();
    return;
  }

  const isFullScreen =
    (focused.isFullScreen && focused.isFullScreen()) ||
    (focused.isSimpleFullScreen && focused.isSimpleFullScreen());
  const isMaximized = focused.isMaximized && focused.isMaximized();

  if (isFullScreen || isMaximized) {
    hideIsland();
    return;
  }

  showIsland();
}

function startFullscreenPoller() {
  setInterval(checkFullscreenState, 350);
}

// ---------------- CREATE WINDOW ----------------
function createWindow() {
  const primary = screen.getPrimaryDisplay();

  const x = Math.round(primary.bounds.x + (primary.bounds.width - NOTCH_WIDTH) / 2);
  const y = primary.bounds.y || 0;

  win = new BrowserWindow({
    width: NOTCH_WIDTH,
    height: NOTCH_HEIGHT,
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

  win.setMovable(false);

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile("index.html");

  win.webContents.on("did-finish-load", () => {
    setTimeout(() => {
      win.showInactive();
      showIsland();
    }, 80);
  });

  win.on("move", () => {
    if (!isRepositioning && !isHidden) {
      resizeAndCenter(lastKnownSize.width, lastKnownSize.height);
    }
  });
}

// ---------------- SETTINGS ---------------- 
const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");
const WALLPAPER_DIR = path.join(app.getPath("home"), "Downloads", "Wallpapers");
const YOUTUBE_SCRIPT_PATH = path.join(__dirname, "youtube-detect.ps1");
const YOUTUBE_DETECT_SCRIPT = `
$windows = Get-Process | Where-Object { $_.MainWindowTitle -match 'youtube' }
$result = @{
    hasWindow = $false
    title = $null
}
if ($windows -and $windows.Count -gt 0) {
    $result.hasWindow = $true
    $firstWithTitle = $windows | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } | Select-Object -First 1
    if ($firstWithTitle) {
        $result.title = $firstWithTitle.MainWindowTitle
    } else {
        $result.title = $windows[0].MainWindowTitle
    }
}
$result | ConvertTo-Json -Compress
`;

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    }
  } catch (e) {
    console.error("Error loading settings:", e);
  }
  return {
    showClock: true,
    showCalendar: true,
    showMusic: true,
    showTray: true,
    musicSource: "youtube"
  };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    return true;
  } catch (e) {
    console.error("Error saving settings:", e);
    return false;
  }
}

ipcMain.handle("get-settings", () => loadSettings());
ipcMain.handle("save-settings", (event, settings) => saveSettings(settings));

ipcMain.handle("resize-and-center", (event, width, height) => {
  resizeAndCenter(width, height);
});

function buildWallpaperList() {
  try {
    if (!fs.existsSync(WALLPAPER_DIR)) return [];
    const files = fs.readdirSync(WALLPAPER_DIR);
    return files
      .filter((file) => /\.(png|jpg|jpeg|gif|webp)$/i.test(file))
      .map((file) => {
        const absolute = path.join(WALLPAPER_DIR, file);
        return `file://${absolute.replace(/\\/g, "/")}`;
      });
  } catch (e) {
    return [];
  }
}

ipcMain.handle("get-wallpapers", () => buildWallpaperList());

function ensureCentered() {
  if (!win || win.isDestroyed() || isHidden) return;
  resizeAndCenter(lastKnownSize.width, lastKnownSize.height);
}

function registerScreenListeners() {
  screen.on("display-metrics-changed", ensureCentered);
  screen.on("display-added", ensureCentered);
  screen.on("display-removed", ensureCentered);
}

// ---------------- MEDIA SESSION (YouTube Detection) ---------------- 
let currentMediaMetadata = null;
let mediaScanInFlight = false;
const thumbnailCache = new Map();
let youtubeScriptReady = false;

function ensureYouTubeScript() {
  try {
    if (!fs.existsSync(YOUTUBE_SCRIPT_PATH)) {
      fs.writeFileSync(YOUTUBE_SCRIPT_PATH, YOUTUBE_DETECT_SCRIPT, "utf8");
      youtubeScriptReady = true;
      return true;
    }

    if (!youtubeScriptReady) {
      fs.writeFileSync(YOUTUBE_SCRIPT_PATH, YOUTUBE_DETECT_SCRIPT, "utf8");
    }

    youtubeScriptReady = true;
    return true;
  } catch (e) {
    youtubeScriptReady = false;
    return false;
  }
}

function fetchYouTubeThumbnail(searchTitle) {
  return new Promise((resolve) => {
    if (!searchTitle || searchTitle.length < 3) return resolve(null);
    if (thumbnailCache.has(searchTitle)) return resolve(thumbnailCache.get(searchTitle));

    const query = encodeURIComponent(searchTitle);
    const options = {
      hostname: "www.youtube.com",
      path: `/results?search_query=${query}`,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117 Safari/537.36"
      }
    };

    const req = https.get(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        const match = body.match(/\/watch\?v=([A-Za-z0-9_-]{11})/);
        if (match && match[1]) {
          const url = `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`;
          thumbnailCache.set(searchTitle, url);
          resolve(url);
        } else {
          resolve(null);
        }
      });
    });

    req.on("error", () => resolve(null));
  });
}

function getWindowsMediaSession() {
  return new Promise((resolve) => {
    if (!ensureYouTubeScript()) {
      resolve(null);
      return;
    }

    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${YOUTUBE_SCRIPT_PATH}"`,
      {
        maxBuffer: 1024 * 1024,
        timeout: 3000,
        windowsHide: true
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        const output = stdout?.trim();
        if (output) {
          try {
            const parsed = JSON.parse(output);
            resolve(parsed);
            return;
          } catch (e) {
            resolve(null);
            return;
          }
        }

        resolve(null);
      }
    );
  });
}

function parseYouTubeTitle(title) {
  if (!title) return null;
  
  // Extract video title from browser window title
  // Common formats:
  // "Video Title - YouTube"
  // "Video Title - Channel Name - YouTube"
  // "Video Title | Channel Name - YouTube"
  
  // Remove " - YouTube" or " | YouTube" suffix
  let cleanTitle = title.replace(/\s*[-|]\s*YouTube.*$/i, '').trim();
  
  // Try to split by " - " or " | " to get title and channel
  const parts = cleanTitle.split(/\s*[-|]\s*/);
  
  if (parts.length >= 2) {
    // Last part is usually the channel
    const videoTitle = parts.slice(0, -1).join(' - ').trim();
    const channel = parts[parts.length - 1].trim();
    
    return {
      title: videoTitle || cleanTitle,
      artist: channel || 'YouTube',
      isPlaying: true,
      source: 'youtube'
    };
  }
  
  // If no separator, use the whole thing as title
  return {
    title: cleanTitle || title,
    artist: 'YouTube',
    isPlaying: true,
    source: 'youtube'
  };
}

function updateMediaFromSystem() {
  if (mediaScanInFlight) return;
  mediaScanInFlight = true;

  getWindowsMediaSession()
    .then((session) => {
      const hasWindow = !!session?.hasWindow;
      const rawTitle = typeof session?.title === 'string' ? session.title.trim() : '';

      if (!hasWindow) {
        if (currentMediaMetadata) {
          currentMediaMetadata = null;
          if (win && !win.isDestroyed()) {
            win.webContents.send("media-update", null);
            collapseIsland();
          }
        }
        return;
      }

      const hasUsableTitle = rawTitle.length > 0;
      const titleForMetadata = hasUsableTitle
        ? rawTitle
        : (currentMediaMetadata?.rawTitle || 'YouTube');
      const metadata = parseYouTubeTitle(titleForMetadata);

      const shouldUpdate =
        !currentMediaMetadata ||
        currentMediaMetadata.title !== metadata.title ||
        currentMediaMetadata.artist !== metadata.artist;

      const sendMetadata = (thumbnail = null) => {
        currentMediaMetadata = {
          ...metadata,
          thumbnail: thumbnail ?? currentMediaMetadata?.thumbnail ?? null,
          rawTitle: titleForMetadata
        };

        if (win && !win.isDestroyed()) {
          win.webContents.send("media-update", currentMediaMetadata);
          // Expand immediately for smoother transition
          expandIsland(NOTCH_HEIGHT_MULTI, NOTCH_WIDTH_EXPANDED);
        }
      };

      if (shouldUpdate) {
        const canLookupThumb =
          hasUsableTitle &&
          metadata.title &&
          metadata.title.length > 3 &&
          metadata.title.toLowerCase() !== 'youtube';

        if (canLookupThumb) {
          fetchYouTubeThumbnail(metadata.title)
            .then((thumb) => sendMetadata(thumb))
            .catch(() => sendMetadata(null));
        } else {
          sendMetadata(null);
        }
      } else if (!currentMediaMetadata) {
        sendMetadata(null);
      } else {
        // Ensure the notch stays expanded even if metadata hasn't changed
        expandIsland(NOTCH_HEIGHT_MULTI, NOTCH_WIDTH_EXPANDED);
      }
    })
    .catch(() => {
      // Silent fail
    })
    .finally(() => {
      mediaScanInFlight = false;
    });
}

function startMediaSessionMonitor() {
  // Check frequently for YouTube windows; lighter detection ensures we react quickly
  setInterval(() => {
    updateMediaFromSystem();
  }, 600);
  
  // Also check immediately and after a short delay
  updateMediaFromSystem();
  setTimeout(() => updateMediaFromSystem(), 700);
}

// ---------------- APP INIT ----------------
app.whenReady().then(() => {
  registerScreenListeners();
  createWindow();
  startFullscreenPoller();
  startMediaSessionMonitor();

  globalShortcut.register("F11", () => {
    setTimeout(checkFullscreenState, 150);
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0)
    createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
