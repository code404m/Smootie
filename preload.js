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

    // Get current date info
    getDate: () => {
        const now = new Date();
        return {
            day: now.getDate(),
            month: now.toLocaleString("en-GB", { month: "short" }),
            year: now.getFullYear(),
            dayOfWeek: now.toLocaleString("en-GB", { weekday: "short" })
        };
    },

    // Media session handlers
    onMediaUpdate: (callback) => {
        ipcRenderer.on("media-update", (event, data) => callback(data));
    },

    onIslandShow: (callback) => {
        ipcRenderer.on("island-show", (event, dimensions) => callback(dimensions));
    },

    onIslandHide: (callback) => {
        ipcRenderer.on("island-hide", (event, dimensions) => callback(dimensions));
    },

    onIslandExpand: (callback) => {
        ipcRenderer.on("island-expand", (event, dimensions) => callback(dimensions));
    },

    onIslandCollapse: (callback) => {
        ipcRenderer.on("island-collapse", (event, dimensions) => callback(dimensions));
    },

    // Settings
    getSettings: () => {
        return ipcRenderer.invoke("get-settings");
    },

    saveSettings: (settings) => {
        return ipcRenderer.invoke("save-settings", settings);
    },

    // Resize and center window
    resizeAndCenter: (width, height) => {
        return ipcRenderer.invoke("resize-and-center", width, height);
    },

    getWallpapers: () => {
        return ipcRenderer.invoke("get-wallpapers");
    }
});
