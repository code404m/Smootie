// main.js
const { app, BrowserWindow, screen, globalShortcut } = require("electron");
const path = require("path");

let win;
let isHidden = false;

const NOTCH_WIDTH = 360;
const NOTCH_HEIGHT = 40;

// ---------------- HIDE / SHOW (REAL HIDE) ----------------
function hideIsland() {
  if (!win || win.isDestroyed() || isHidden) return;
  isHidden = true;

  win.webContents.send("island-hide");

  // Shrink window to zero height
  win.setSize(NOTCH_WIDTH, 0, true);
}

function showIsland() {
  if (!win || win.isDestroyed() || !isHidden) return;
  isHidden = false;

  win.webContents.send("island-show");

  // Restore normal height
  win.setSize(NOTCH_WIDTH, NOTCH_HEIGHT, true);
}

// ---------------- DETECTION ----------------
function checkFullscreenState() {
  const focused = BrowserWindow.getFocusedWindow();
  const primary = screen.getPrimaryDisplay();
  const screenBounds = primary.bounds;

  if (!focused) {
    showIsland();
    return;
  }

  if (focused.isFullScreen && focused.isFullScreen()) return hideIsland();
  if (focused.isSimpleFullScreen && focused.isSimpleFullScreen()) return hideIsland();
  if (focused.isMaximized && focused.isMaximized()) return hideIsland();

  const bounds = focused.getBounds();
  const fullscreenLike =
    bounds.width >= screenBounds.width &&
    bounds.height >= screenBounds.height - 1 &&
    bounds.y <= screenBounds.y + 1;

  if (fullscreenLike) return hideIsland();

  showIsland();
}

function startFullscreenPoller() {
  setInterval(checkFullscreenState, 350);
}

// ---------------- CREATE WINDOW ----------------
function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const screenWidth = primary.bounds.width;
  const screenY = primary.bounds.y || 0;

  const x = Math.round(primary.bounds.x + (screenWidth - NOTCH_WIDTH) / 2);
  const y = screenY;

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

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile("index.html");

  win.webContents.on("did-finish-load", () => {
    setTimeout(() => {
      win.showInactive();
      showIsland();
    }, 80);
  });

  setTimeout(() => win.setPosition(x, y), 150);
}

// ---------------- APP INIT ----------------
app.whenReady().then(() => {
  createWindow();
  startFullscreenPoller();

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
