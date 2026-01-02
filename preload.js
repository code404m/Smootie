// preload.js
const { contextBridge, ipcRenderer } = require("electron");

// Expose safe API to renderer
contextBridge.exposeInMainWorld("SmootieAPI", {
    // Get current time (24h + seconds)
    getTime: () => {
        const now = new Date();
        return now.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    },

    // Subscribe to time updates every second
    onTick: (callback) => {
        setInterval(() => {
            callback(
                new Date().toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                })
            );
        }, 1000);
    },

    // Listen for mode switches
    onModeSwitch: (callback) => {
        ipcRenderer.on("switch-mode", (event, data) => {
            callback(data);
        });
    },

    // Listen for video info updates
    onVideoInfoUpdate: (callback) => {
        ipcRenderer.on("update-video-info", (event, videoInfo) => {
            callback(videoInfo);
        });
    },

    // Listen for island show/hide
    onIslandHide: (callback) => {
        ipcRenderer.on("island-hide", () => callback());
    },

    onIslandShow: (callback) => {
        ipcRenderer.on("island-show", () => callback());
    },

    // Request video check
    requestVideoCheck: () => {
        ipcRenderer.send("request-video-check");
    },

    // Get random photo from user's computer
    getRandomPhoto: (photoSource) => {
        return ipcRenderer.invoke("get-random-photo", photoSource);
    },

    // Select custom folder for photos
    selectCustomFolder: () => {
        return ipcRenderer.invoke("select-custom-folder");
    },

    // Listen for photo updates
    onPhotoUpdate: (callback) => {
        ipcRenderer.on("update-photo", (event, photoPath) => {
            callback(photoPath);
        });
    },

    // Listen for playback state updates
    onPlaybackStateUpdate: (callback) => {
        ipcRenderer.on("update-playback-state", (event, state) => {
            callback(state);
        });
    },

    // Video control functions
    videoPlayPause: () => {
        ipcRenderer.send("video-play-pause");
    },

    videoNext: () => {
        ipcRenderer.send("video-next");
    },

    videoPrevious: () => {
        ipcRenderer.send("video-previous");
    },

    // Check if any window is maximized
    isWindowMaximized: () => {
        return ipcRenderer.invoke("is-window-maximized");
    },

    // Hide/show the island window
    hideWindow: () => {
        ipcRenderer.send("hide-island-window");
    },

    showWindow: () => {
        ipcRenderer.send("show-island-window");
    },

    // Quit the app
    quitApp: () => {
        ipcRenderer.send("quit-app");
    }
});
