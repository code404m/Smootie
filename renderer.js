// renderer.js
// Main renderer logic for Nook Tray widget

(function () {
  let currentVideoInfo = null;
  let isPlaying = true;
  let currentMode = 1; // 1 = clock mode, 2 = nook mode
  let lastGoodThumbnailUrl = null;

  const DEBUG_LOGS = false;
  function debugLog(...args) {
    if (DEBUG_LOGS) console.log(...args);
  }

  // -------- MODE SWITCHING (M key) --------
  let clockModeEl = null;
  let nookModeEl = null;

  function initializeModeElements() {
    clockModeEl = document.getElementById("mode-clock");
    nookModeEl = document.getElementById("mode-nook");
    debugLog("Mode elements found:", { clockModeEl: !!clockModeEl, nookModeEl: !!nookModeEl });
  }

  function applyMode(mode) {
    currentMode = mode;
    debugLog("Applying mode:", mode);
    
    if (clockModeEl && nookModeEl) {
      if (mode === 1) {
        clockModeEl.classList.remove("mode-hidden");
        nookModeEl.classList.add("mode-hidden");
        debugLog("Switched to Mode 1 (Clock)");
      } else {
        clockModeEl.classList.add("mode-hidden");
        nookModeEl.classList.remove("mode-hidden");
        debugLog("Switched to Mode 2 (Nook)");
        
        // When switching to Mode 2, update video info immediately if we have it
        if (currentVideoInfo) {
          debugLog("Updating video info for Mode 2:", currentVideoInfo.title);
          updateVideoInfo(currentVideoInfo);
        } else {
          // Request a fresh video check if we don't have video info
          if (window.SmootieAPI && window.SmootieAPI.requestVideoCheck) {
            window.SmootieAPI.requestVideoCheck();
          }
        }
      }
    } else {
      // Try to initialize elements again
      initializeModeElements();
      // Retry applying mode
      if (clockModeEl && nookModeEl) {
        applyMode(mode);
      } else {
        console.error("Could not find mode elements!");
      }
    }
  }

  // Wait for DOM to be fully loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeModeElements();
      applyMode(1);
    });
  } else {
    // DOM already loaded
    initializeModeElements();
    applyMode(1);
  }

  // Right-click to close app
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (window.SmootieAPI && window.SmootieAPI.quitApp) {
      window.SmootieAPI.quitApp();
    }
  });

  // Click on black background to switch to Mode 1 (but not on interactive elements)
  document.addEventListener("click", (e) => {
    // Only switch to Mode 1 if we're currently in Mode 2 (nook mode)
    if (currentMode !== 2) return;
    
    // Check if the clicked element or its parents are interactive
    const target = e.target;
    const interactiveSelectors = [
      'button', 
      '.music-control-btn', 
      '.top-icon', 
      '.nook-tab',
      '.menu-item',
      'input',
      'select',
      'textarea',
      'a',
      '[role="button"]',
      '.clickable',
      '.svg-icon',
      '.tab-icon',
      'svg',
      'path',
      '.nook-label',
      '.tray-label',
      '.song-title',
      '.album-label',
      '.artist-name',
      '.clock-time',
      '.clock-date'
    ];
    
    // Check if the clicked element or any of its parents match interactive selectors
    let isInteractive = false;
    let element = target;
    while (element && element !== document.body) {
      if (interactiveSelectors.some(selector => element.matches?.(selector))) {
        isInteractive = true;
        break;
      }
      element = element.parentElement;
    }
    
    // Only switch to Mode 1 if the click was on a non-interactive element
    if (!isInteractive) {
      // Check if we're clicking on the actual background (black areas)
      const computedStyle = window.getComputedStyle(target);
      const backgroundColor = computedStyle.backgroundColor;
      
      // Switch to Mode 1 if clicking on black/dark background
      if (backgroundColor && (backgroundColor === 'rgb(0, 0, 0)' || backgroundColor === '#000000' || backgroundColor.includes('rgb(0, 0, 0)'))) {
        applyMode(1);
      }
    }
  });

  // Multiple switching options
  window.addEventListener("keydown", (e) => {
    debugLog("Key pressed:", e.key);
    if (e.key === "m" || e.key === "M") {
      debugLog("M key detected, switching mode");
      applyMode(currentMode === 1 ? 2 : 1);
    } else if (e.key === " " || e.key === "Spacebar") {
      debugLog("Spacebar detected, switching mode");
      e.preventDefault(); // Prevent page scroll
      applyMode(currentMode === 1 ? 2 : 1);
    }
  });

  // Click on clock island to switch (single click)
  document.addEventListener("click", (e) => {
    if (clockModeEl && clockModeEl.contains(e.target)) {
      debugLog("Clock island clicked, switching mode");
      e.stopPropagation(); // Prevent double-click detection
      applyMode(currentMode === 1 ? 2 : 1);
    }
  });

  // Double-click anywhere else (not on clock island) to switch
  let lastClickTime = 0;
  let lastClickTarget = null;
  
  document.addEventListener("click", (e) => {
    // Don't trigger double-click if clicking on clock island
    if (clockModeEl && clockModeEl.contains(e.target)) {
      return;
    }
    
    const currentTime = new Date().getTime();
    const timeDiff = currentTime - lastClickTime;
    const sameTarget = lastClickTarget === e.target;
    
    if (timeDiff < 300 && timeDiff > 0 && sameTarget) { // Double click on same element
      debugLog("Double-click detected, switching mode");
      e.stopPropagation();
      applyMode(currentMode === 1 ? 2 : 1);
    }
    
    lastClickTime = currentTime;
    lastClickTarget = e.target;
  });

  // -------- CLOCK (Mode 1) --------
  function updateClock() {
    const timeEl = document.getElementById("clock-time");
    const dateEl = document.getElementById("clock-date");

    if (!timeEl || !dateEl) return;

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    // Format: "11:53:55" (hours:minutes:seconds all together)
    timeEl.textContent = `${hours}:${minutes}:${seconds}`;

    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    // Format: "Fri, 12 Jan" (day name, day number, month abbreviation)
    dateEl.textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;
  }

  updateClock();
  setInterval(updateClock, 1000);

  // Initialize calendar
  function updateCalendar() {
    const now = new Date();
    const monthEl = document.getElementById("calendar-month");
    const weekDatesEl = document.getElementById("calendar-week-dates");
    const dayLabelFor = (dayIndex) => {
      switch (dayIndex) {
        case 0:
          return "S";
        case 1:
          return "MON";
        case 2:
          return "T";
        case 3:
          return "W";
        case 4:
          return "T";
        case 5:
          return "F";
        case 6:
          return "S";
        default:
          return "";
      }
    };
    
    if (monthEl) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      monthEl.textContent = months[now.getMonth()];
    }
    
    if (weekDatesEl) {
      weekDatesEl.innerHTML = "";
      const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startDate = new Date(todayDate);
      startDate.setDate(todayDate.getDate() - 3);

      for (let i = 0; i < 7; i++) {
        const dateItemEl = document.createElement("div");
        const dateObj = new Date(startDate);
        dateObj.setDate(startDate.getDate() + i);

        const isToday = dateObj.toDateString() === todayDate.toDateString();
        dateItemEl.className = "calendar-date-item" + (isToday ? " today" : "");

        const dayLabelEl = document.createElement("div");
        dayLabelEl.className = "calendar-day-label";
        dayLabelEl.textContent = dayLabelFor(dateObj.getDay());

        const dateNumberEl = document.createElement("div");
        dateNumberEl.className = "calendar-date-number";
        dateNumberEl.textContent = String(dateObj.getDate()).padStart(2, "0");

        dateItemEl.appendChild(dayLabelEl);
        dateItemEl.appendChild(dateNumberEl);
        weekDatesEl.appendChild(dateItemEl);
      }
    }
  }
  updateCalendar();
  setInterval(updateCalendar, 60000); // Update every minute

  // Update video/music information
  function updateVideoInfo(videoInfo) {
    // Only update currentVideoInfo if we received valid video info
    // This preserves the last known video info when switching apps
    if (videoInfo && videoInfo.title && videoInfo.title !== "No video playing") {
      currentVideoInfo = videoInfo;
    }
    // If videoInfo is null, keep the last known state (don't clear immediately)

    debugLog('Received video info:', JSON.stringify(videoInfo, null, 2));
    
    const songTitleEl = document.getElementById("song-title");
    const albumLabelEl = document.getElementById("album-label");
    const artistNameEl = document.getElementById("artist-name");
    const albumArtEl = document.getElementById("album-art-img");
    
    // Use currentVideoInfo (which preserves last known state) instead of videoInfo parameter
    const displayInfo = currentVideoInfo;
    
    if (displayInfo && displayInfo.title && displayInfo.title !== "No video playing") {
      debugLog('Showing video info:', displayInfo.title);
      // Show video info when YouTube video is detected
      if (songTitleEl) {
        songTitleEl.textContent = displayInfo.title;
      }
      
      // Update album label and artist
      if (albumLabelEl) {
        albumLabelEl.textContent = displayInfo.source === "youtube" ? "YouTube" : "Local Video";
      }
      
      if (artistNameEl) {
        if (displayInfo.source === "youtube") {
          artistNameEl.textContent = "";
        } else {
          artistNameEl.textContent = displayInfo.source === "local" ? "Local Video" : "--";
        }
      }
      
      // Update album art (YouTube thumbnail) - always show for YouTube
      if (albumArtEl && displayInfo.source === "youtube") {
        let thumbnailUrl = null;

        // Prefer thumbnail URL provided by the main process (most reliable)
        if (displayInfo.thumbnail) {
          thumbnailUrl = displayInfo.thumbnail;
          debugLog('Using thumbnail from main process:', thumbnailUrl);
        }

        // Next best: build thumbnail from a real videoId (even if it was "detected" initially)
        // Try to extract videoId from title if videoId is "detected"
        if (!thumbnailUrl && displayInfo.videoId && displayInfo.videoId !== "detected" && displayInfo.videoId !== "generated") {
          thumbnailUrl = `https://img.youtube.com/vi/${displayInfo.videoId}/mqdefault.jpg`;
          debugLog('Built thumbnail from videoId:', displayInfo.videoId);
        } else if (!thumbnailUrl && displayInfo.videoId === "detected" && displayInfo.title) {
          // If videoId is "detected", try harder to extract from title
          const titlePatterns = [
            /watch\?v=([a-zA-Z0-9_-]{11})/i,
            /youtu\.be\/([a-zA-Z0-9_-]{11})/i,
            /v=([a-zA-Z0-9_-]{11})/i,
            /\b([a-zA-Z0-9_-]{11})\b/
          ];
          
          for (const pattern of titlePatterns) {
            const match = displayInfo.title.match(pattern);
            if (match && match[1] && match[1].length === 11) {
              thumbnailUrl = `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg`;
              debugLog('Extracted video ID from title (videoId was "detected"):', match[1]);
              break;
            }
          }
        }

        // Next: try to extract the videoId from the URL (handle undefined)
        if (!thumbnailUrl && displayInfo.url && displayInfo.url !== undefined && displayInfo.url !== "") {
          const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /[?&]v=([a-zA-Z0-9_-]{11})/,
            /\/embed\/([a-zA-Z0-9_-]{11})/,
            /youtu\.be\/([a-zA-Z0-9_-]{11})/
          ];

          for (const pattern of patterns) {
            const match = displayInfo.url.match(pattern);
            if (match && match[1] && match[1].length === 11) {
              thumbnailUrl = `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg`;
              debugLog('Extracted video ID from url:', match[1]);
              break;
            }
          }
        }

        // If we still don't have a thumbnail URL, try to request it via API if available
        if (!thumbnailUrl && displayInfo.title && window.SmootieAPI && window.SmootieAPI.requestVideoCheck) {
          debugLog('No thumbnail URL found, requesting video check to trigger API resolution');
          window.SmootieAPI.requestVideoCheck();
        }

        // If we still don't have a thumbnail, keep showing the last good one to avoid flicker
        if (!thumbnailUrl && lastGoodThumbnailUrl) {
          thumbnailUrl = lastGoodThumbnailUrl;
        }
        
        // Always display the album art for YouTube videos
        albumArtEl.style.display = "block";
        
        if (thumbnailUrl) {
          if (albumArtEl.src !== thumbnailUrl) {
            albumArtEl.src = thumbnailUrl;
          }
          debugLog('Setting album art src to:', thumbnailUrl);

          if (thumbnailUrl.startsWith("http")) {
            lastGoodThumbnailUrl = thumbnailUrl;
          }
          // Set up error handler to try different thumbnail qualities if one fails
          albumArtEl.onerror = function() {
            const currentSrc = this.src;
            if (currentSrc.includes('/mqdefault.jpg')) {
              // Try higher quality first
              this.src = currentSrc.replace('/mqdefault.jpg', '/maxresdefault.jpg');
              this.onerror = function() {
                this.src = currentSrc.replace('/mqdefault.jpg', '/hqdefault.jpg');
                this.onerror = function() {
                  this.src = currentSrc.replace('/mqdefault.jpg', '/default.jpg');
                  this.onerror = function() {
                    // Final fallback: show placeholder
                    this.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' fill='%23333'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%23999' font-family='sans-serif' font-size='12'%3EYouTube%3C/text%3E%3C/svg%3E";
                  };
                };
              };
            } else {
              // Already tried all qualities, show placeholder
              this.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' fill='%23333'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%23999' font-family='sans-serif' font-size='12'%3EYouTube%3C/text%3E%3C/svg%3E";
            }
          };
        } else {
          // No thumbnail URL found - show placeholder but keep trying
          albumArtEl.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' fill='%23333'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%23999' font-family='sans-serif' font-size='12'%3EYouTube%3C/text%3E%3C/svg%3E";
          albumArtEl.onerror = null; // Clear error handler for placeholder
          debugLog('No thumbnail URL found for YouTube video, showing placeholder');
        }
      }
    } else {
      debugLog('Hiding all video info');
      // No video playing - hide all video info completely
      if (songTitleEl) {
        songTitleEl.textContent = "";
      }
      if (albumLabelEl) {
        albumLabelEl.textContent = "";
      }
      if (artistNameEl) {
        artistNameEl.textContent = "";
      }
      if (albumArtEl) {
        albumArtEl.style.display = "none";
      }

      // Keep lastGoodThumbnailUrl so the next detection doesn't flicker to placeholder while resolving
    }
  }

  // Update playback state (playing/paused)
  function updatePlaybackState(state) {
    const playBtn = document.getElementById("play-btn");
    if (!playBtn) return;
    
    if (state === 'playing') {
      playBtn.classList.remove("is-paused");
      playBtn.setAttribute("aria-label", "Pause");
    } else if (state === 'paused') {
      playBtn.classList.add("is-paused");
      playBtn.setAttribute("aria-label", "Play");
    } else {
      // Unknown state, keep as generic toggle
      playBtn.classList.remove("is-paused");
      playBtn.setAttribute("aria-label", "Play/Pause");
    }
  }

  // Music controls
  const playBtn = document.getElementById("play-btn");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  let playToggleInFlight = false;
  
  if (playBtn) {
    playBtn.classList.remove("is-paused");
    playBtn.setAttribute("aria-label", "Play/Pause");

    playBtn.addEventListener("click", () => {
      if (playToggleInFlight) return;
      playToggleInFlight = true;
      playBtn.classList.add("is-busy");

      // Send play/pause command to YouTube
      if (window.SmootieAPI && window.SmootieAPI.videoPlayPause) {
        window.SmootieAPI.videoPlayPause();
      }

      // Do not try to infer actual playback state; keep button as a toggle control.
      // This avoids the UI appearing “inverted” when YouTube was already paused/playing.

      setTimeout(() => {
        playToggleInFlight = false;
        playBtn.classList.remove("is-busy");
      }, 450);
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      // Send previous command to YouTube
      if (window.SmootieAPI && window.SmootieAPI.videoPrevious) {
        window.SmootieAPI.videoPrevious();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      // Send next command to YouTube
      if (window.SmootieAPI && window.SmootieAPI.videoNext) {
        window.SmootieAPI.videoNext();
      }
    });
  }

  // Top bar buttons
  const menuBtn = document.getElementById("menu-btn");
  const menuMenu = document.getElementById("menu-menu");
  const menuChooseFolder = document.getElementById("menu-choose-folder");
  const homeTabBtn = document.getElementById("tab-tray");
  
  if (menuBtn) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!menuMenu) return;
      menuMenu.style.display = menuMenu.style.display === "block" ? "none" : "block";
    });
  }

  if (menuMenu) {
    menuMenu.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  if (homeTabBtn) {
    homeTabBtn.addEventListener("click", () => {
      debugLog("Home tab clicked, returning to Mode 1");
      applyMode(1); // Always switch to Mode 1 (clock)
    });
  }

  // Close settings menu when clicking outside
  document.addEventListener("click", () => {
    if (menuMenu) {
      menuMenu.style.display = "none";
    }
  });

  // Click on nook-tray background to return to mode 1 (clock)
  const nookTray = document.getElementById("mode-nook");
  if (nookTray) {
    nookTray.addEventListener("click", (e) => {
      // Only switch to mode 1 if clicking on the background, not interactive elements
      if (e.target === nookTray || e.target.classList.contains("nook-content")) {
        debugLog("Background clicked, returning to Mode 1");
        applyMode(1); // Switch to clock mode
      }
    });
  }

  // Listen for video info updates from main process
  if (window.SmootieAPI) {
    window.SmootieAPI.onVideoInfoUpdate((videoInfo) => {
      updateVideoInfo(videoInfo);
    });
  }

  // Listen for playback state updates from main process
  if (window.SmootieAPI) {
    window.SmootieAPI.onPlaybackStateUpdate((state) => {
      updatePlaybackState(state);
    });
  }

  // Proactively trigger detection on startup so thumbnail is ready even in Mode 1
  if (window.SmootieAPI && window.SmootieAPI.requestVideoCheck) {
    window.SmootieAPI.requestVideoCheck();
    setTimeout(() => window.SmootieAPI.requestVideoCheck(), 250);
  }

  // Preload thumbnails to avoid showing them late when switching modes
  function preloadImage(url) {
    if (!url) return;
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.src = url;
  }

  if (window.SmootieAPI) {
    window.SmootieAPI.onVideoInfoUpdate((videoInfo) => {
      if (videoInfo?.thumbnail) preloadImage(videoInfo.thumbnail);
    });
  }

  // Load random photo from user's computer
  function loadRandomPhoto() {
    const profileImg = document.getElementById("profile-img");
    debugLog("Loading photo from source:", currentPhotoSource);
    if (profileImg && window.SmootieAPI && window.SmootieAPI.getRandomPhoto) {
      window.SmootieAPI.getRandomPhoto(currentPhotoSource).then((photoPath) => {
        debugLog("Photo path received:", photoPath);
        if (photoPath) {
          profileImg.src = `file://${photoPath}`;
          profileImg.style.display = "block";
          debugLog("Image src set to:", profileImg.src);
        } else {
          // No photo found - hide image to show dark background
          profileImg.style.display = "none";
          debugLog("No photo found, hiding image");
        }
      }).catch((error) => {
        // Error - hide image to show dark background
        profileImg.style.display = "none";
        debugLog("Could not load random photo:", error);
      });
    } else {
      debugLog("Missing elements or API");
    }
  }

  // Profile picture click handler - directly open folder selection
  const profilePicture = document.getElementById("profile-picture");
  let currentPhotoSource = localStorage.getItem("photoSource") || "all";

  function choosePhotoFolder() {
    if (window.SmootieAPI && window.SmootieAPI.selectCustomFolder) {
      window.SmootieAPI.selectCustomFolder().then((folderPath) => {
        if (folderPath) {
          currentPhotoSource = folderPath;
          localStorage.setItem("photoSource", folderPath);
          localStorage.setItem(
            "customFolderName",
            folderPath.split('\\').pop() || folderPath.split('/').pop() || 'Custom Folder'
          );
          loadRandomPhoto();
        }
      }).catch((error) => {
        console.error("Error selecting folder:", error);
      });
    } else {
      console.error("Folder selection API not available");
    }
  }

  if (menuChooseFolder) {
    menuChooseFolder.addEventListener("click", () => {
      if (menuMenu) menuMenu.style.display = "none";
      choosePhotoFolder();
    });
  }
  
  if (profilePicture) {
    profilePicture.addEventListener("click", (e) => {
      debugLog("Profile picture clicked, opening folder selection...");
      e.stopPropagation();

      choosePhotoFolder();
    });
  } else {
    console.error("Profile picture element not found!");
  }

  // Change photo every 2 minutes
  setInterval(loadRandomPhoto, 120000);

  // Initialize with default state
  updateVideoInfo(null);
  loadRandomPhoto();

  // -------- WINDOW MAXIMIZATION DETECTION --------
  let isWindowMaximized = false;

  // Update island visibility based on maximization state
  function updateIslandVisibility() {
    const nookTray = document.getElementById("mode-nook");
    const clockMode = document.getElementById("mode-clock");
    
    if (nookTray && clockMode) {
      if (isWindowMaximized) {
        nookTray.style.display = "none";
        clockMode.style.display = "none";
      } else {
        nookTray.style.display = "flex";
        clockMode.style.display = "flex";
      }
    }
  }

  if (window.SmootieAPI) {
    if (window.SmootieAPI.onIslandHide) {
      window.SmootieAPI.onIslandHide(() => {
        isWindowMaximized = true;
        updateIslandVisibility();
      });
    }

    if (window.SmootieAPI.onIslandShow) {
      window.SmootieAPI.onIslandShow(() => {
        isWindowMaximized = false;
        updateIslandVisibility();
      });
    }

    if (window.SmootieAPI.isWindowMaximized) {
      window.SmootieAPI.isWindowMaximized().then((isMaximized) => {
        isWindowMaximized = !!isMaximized;
        updateIslandVisibility();
      }).catch(() => {
        // ignore
      });
    }
  }
})();