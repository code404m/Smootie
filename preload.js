// preload.js
const { contextBridge } = require("electron");

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
    }
});
