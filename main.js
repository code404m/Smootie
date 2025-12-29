// main.js
const { app, BrowserWindow, screen, ipcMain } = require("electron");
const path = require("path");
const fs = require('fs').promises;
const os = require('os');

let win;
let currentVideoInfo = null;
let videoDetectionInterval = null;

const NOOK_WIDTH = 750;
const NOOK_HEIGHT = 140;

// ---------------- VIDEO DETECTION (YouTube Only) ----------------四肢
function isYouTubeWindow(windowInfo) {
  if (!windowInfo) return { isVideo: false };
  
  const title = windowInfo.title || "";
  const titleLower = title.toLowerCase();
  const url = (windowInfo.url || "").toLowerCase();
  
  // Check for YouTube in title (fallback when URL is undefined)
  if (titleLower.includes("youtube")) {
    // Try to extract video title from window title (format: "Video Title - YouTube" or just "Video Title")
    let videoTitle = title;
    if (title.includes(" - YouTube")) {
      videoTitle = title.replace(" - YouTube", "").trim();
    } else if (title.includes(" | YouTube")) {
      videoTitle = title.replace(" | YouTube", "").trim();
    }
    
    // Remove tab numbers like (99), (1), etc. from the beginning
    videoTitle = videoTitle.replace(/^\(\d+\)\s*/, '');
    
    // Check if this looks like a video page (has a title that's not just "YouTube")
    if (videoTitle && videoTitle !== "" && videoTitle !== "YouTube" && 
        !titleLower.includes("home") && !titleLower.includes("search") && 
        !titleLower.includes("trending") && !titleLower.includes("subscriptions")) {
      console.log('YouTube video detected:', videoTitle); 
      return {
        isVideo: true,
        source: "youtube",
        title: videoTitle,
        url: url || "",
        videoId: "detected", // We don't need the actual ID for controls
        thumbnail: `https://img.youtube.com/vi/detected/mqdefault.jpg`
      };
    }
  }
  
  // Original URL-based detection (for when URL is available)
  if ((url.includes("youtube.com/watch") || url.includes("youtu.be/")) && 
      (url.includes("v=") || url.includes("/watch") || url.includes("/embed/"))) {
    // Extract video ID and title
    let videoId = null;
    try {
      const urlObj = new URL(windowInfo.url);
      videoId = urlObj.searchParams.get("v") || urlObj.pathname.split("/").pop().split("?")[0];
    } catch (e) {
      // URL parsing failed, try to extract from URL string
      const match = url.match(/(?:watch\?v=|youtu\.be\/|embed\/)([^&\s?]+)/);
      if (match) videoId = match[1];
    }
    
    // Try to extract video title from window title (format: "Video Title - YouTube" or just "Video Title")
    let videoTitle = title;
    if (title.includes(" - YouTube")) {
      videoTitle = title.replace(" - YouTube", "").trim();
    } else if (title.includes(" | YouTube")) {
      videoTitle = title.replace(" | YouTube", "").trim();
    }
    
    // Only return video info if we have a valid video ID and title
    if (videoId && videoTitle && videoTitle !== "" && videoTitle !== "YouTube") {
      console.log('YouTube video detected by URL:', videoTitle); 
      return {
        isVideo: true,
        source: "youtube",
        title: videoTitle,
        url: windowInfo.url || "",
        videoId: videoId,
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
      };
    }
  }
  
  return { isVideo: false };
}

async function checkVideoPlayback() {
  try {
    // Dynamic import for ES module - use activeWindow export
    const { activeWindow } = await import("active-win");
    const windowInfo = await activeWindow();
    
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
    
    if (!isBrowser) return; // Skip non-browser windows
    
    const videoInfo = isYouTubeWindow(windowInfo);
    
    console.log('Active window:', windowInfo?.title, windowInfo?.url); // Debug log
    console.log('Video detection result:', videoInfo); // Debug log
    
    if (videoInfo.isVideo) {
      // Only update if video info has changed
      if (!currentVideoInfo || currentVideoInfo.title !== videoInfo.title) {
        currentVideoInfo = videoInfo;
        // Update video info in the music player
        if (win && !win.isDestroyed()) {
          win.webContents.send("update-video-info", videoInfo);
        }
      }
    } else {
      // Only clear if we had video info before
      if (currentVideoInfo) {
        currentVideoInfo = null;
        if (win && !win.isDestroyed()) {
          win.webContents.send("update-video-info", null);
        }
      }
    }
  } catch (error) {
    // Silently handle errors (e.g., permissions, window not available)
    console.error("Error detecting video:", error.message);
  }
}

function startVideoDetection() {
  if (videoDetectionInterval) return;
  // Check immediately on startup
  checkVideoPlayback();
  // Then check every 500ms (faster than before)
  videoDetectionInterval = setInterval(checkVideoPlayback, 500);
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
      console.log('Play/pause button clicked'); // Debug
      
      // Get current window info once and check quickly
      const { activeWindow } = await import("active-win");
      const windowInfo = await activeWindow();
      const title = windowInfo?.title || "";
      const isYouTubeByTitle = title.toLowerCase().includes("youtube");
      
      console.log('Active window:', title); // Debug
      
      // Send command if YouTube is detected (by URL or title)
      if (windowInfo?.url && (windowInfo.url.includes("youtube.com") || windowInfo.url.includes("youtu.be"))) {
        console.log('Sending spacebar to YouTube (by URL)'); // Debug
        sendKeyCommand(" ");
      } else if (isYouTubeByTitle) {
        console.log('Sending spacebar to YouTube (by title)'); // Debug
        sendKeyCommand(" ");
      } else {
        console.log('Active window is not YouTube:', title);
      }
    } catch (error) {
      console.error("Error controlling video playback:", error.message);
    }
  });

  ipcMain.on("video-next", async () => {
    try {
      console.log('Next button clicked'); // Debug
      
      const { activeWindow } = await import("active-win");
      const windowInfo = await activeWindow();
      const title = windowInfo?.title || "";
      const isYouTubeByTitle = title.toLowerCase().includes("youtube");
      
      if (windowInfo?.url && (windowInfo.url.includes("youtube.com") || windowInfo.url.includes("youtu.be"))) {
        console.log('Sending Shift+N to YouTube (by URL)'); // Debug
        sendKeyCommand("+n");
      } else if (isYouTubeByTitle) {
        console.log('Sending Shift+N to YouTube (by title)'); // Debug
        sendKeyCommand("+n");
      }
    } catch (error) {
      console.error("Error controlling next video:", error.message);
    }
  });

  ipcMain.on("video-previous", async () => {
    try {
      console.log('Previous button clicked'); // Debug
      
      const { activeWindow } = await import("active-win");
      const windowInfo = await activeWindow();
      const title = windowInfo?.title || "";
      const isYouTubeByTitle = title.toLowerCase().includes("youtube");
      
      if (windowInfo?.url && (windowInfo.url.includes("youtube.com") || windowInfo.url.includes("youtu.be"))) {
        console.log('Sending Shift+P to YouTube (by URL)'); // Debug
        sendKeyCommand("+p");
      } else if (isYouTubeByTitle) {
        console.log('Sending Shift+P to YouTube (by title)'); // Debug
        sendKeyCommand("+p");
      }
    } catch (error) {
      console.error("Error controlling previous video:", error.message);
    }
  });

  // Helper function to send key commands
  function sendKeyCommand(key) {
    const { exec } = require('child_process');
    // Use PowerShell with faster execution
    exec(`powershell -NoProfile -Command "[System.Windows.Forms.SendKeys]::SendWait('${key}')"`, { timeout: 1000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('PowerShell error:', error);
      } else {
        console.log('PowerShell command executed successfully');
      }
    });
  }

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

      // Supported image extensions
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'];
      
      // Collect all image files
      const imageFiles = [];
      
      console.log('Searching for photos in directories:', photoDirs);
      
      for (const dir of photoDirs) {
        try {
          console.log('Checking directory:', dir);
          const files = await fs.readdir(dir);
          console.log('Found files in', dir, ':', files.length);
          
          for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (imageExtensions.includes(ext)) {
              imageFiles.push(path.join(dir, file));
            }
          }
        } catch (err) {
          console.log('Could not access directory:', dir, err.message);
          // Directory doesn't exist or can't be accessed, skip it
          continue;
        }
      }

      console.log('Total images found:', imageFiles.length);
      if (imageFiles.length > 0) {
        console.log('Sample images:', imageFiles.slice(0, 3));
      }

      if (imageFiles.length === 0) {
        return null; // No images found
      }

      // Return a random image
      const randomIndex = Math.floor(Math.random() * imageFiles.length);
      const selectedImage = imageFiles[randomIndex];
      console.log('Selected image:', selectedImage);
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

  // Check if any window is maximized using active-win package
  ipcMain.handle("is-window-maximized", async () => {
    try {
      // Use active-win to get the active window info
      const { activeWindow } = await import("active-win");
      const windowInfo = await activeWindow();
      
      if (!windowInfo || !windowInfo.bounds) {
        return false;
      }
      
      // Get screen bounds
      const primaryDisplay = screen.getPrimaryDisplay();
      const screenBounds = primaryDisplay.bounds;
      
      // Check if the active window covers the entire screen (maximized)
      const windowBounds = windowInfo.bounds;
      
      // Smart tolerance: adapts to different operating systems and desktop environments
      let positionTolerance, sizeTolerance;
      
      // Detect if window is significantly offset (indicates dock, panel, or DE-specific behavior)
      const hasSignificantOffset = Math.abs(windowBounds.x) > 50 || Math.abs(windowBounds.y) > 50;
      
      // Window is much larger than screen (common in some Linux DEs with scaling)
      const isMuchLarger = windowBounds.width > screenBounds.width * 1.1 || 
                          windowBounds.height > screenBounds.height * 1.1;
      
      if (hasSignificantOffset) {
        // Likely dock user (MyDockFinder, macOS dock, Linux panels)
        positionTolerance = 100;
        sizeTolerance = 20;
      } else if (isMuchLarger) {
        // Likely Linux with scaling or multi-monitor setup
        positionTolerance = 150;
        sizeTolerance = 50;
      } else {
        // Standard Windows behavior
        positionTolerance = 20;
        sizeTolerance = 20;
      }
      
      console.log("Smart detection - Has offset:", hasSignificantOffset, "Much larger:", isMuchLarger);
      console.log("Tolerance - Position:", positionTolerance, "Size:", sizeTolerance);
      console.log("Detailed comparison:");
      console.log("Position X:", windowBounds.x, "vs", screenBounds.x, "diff:", Math.abs(windowBounds.x - screenBounds.x));
      console.log("Position Y:", windowBounds.y, "vs", screenBounds.y, "diff:", Math.abs(windowBounds.y - screenBounds.y));
      console.log("Width:", windowBounds.width, "vs", screenBounds.width, ">=?", windowBounds.width >= screenBounds.width - sizeTolerance);
      console.log("Height:", windowBounds.height, "vs", screenBounds.height, ">=?", windowBounds.height >= screenBounds.height - sizeTolerance);
      
      const isMaximized = 
        Math.abs(windowBounds.x - screenBounds.x) <= positionTolerance &&
        Math.abs(windowBounds.y - screenBounds.y) <= positionTolerance &&
        (windowBounds.width >= screenBounds.width - sizeTolerance) &&
        (windowBounds.height >= screenBounds.height - sizeTolerance);
      
      console.log("Window bounds:", windowBounds, "Screen bounds:", screenBounds, "Is maximized:", isMaximized);
      
      return isMaximized;
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