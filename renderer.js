// renderer.js
// Main renderer logic for Nook Tray widget

(function () {
  let currentVideoInfo = null;
  let isPlaying = true;
  let currentMode = 1; // 1 = clock mode, 2 = nook mode
  let lastGoodThumbnailUrl = null;
  let lastVideoDetectedAt = 0;
  let lastVideoCheckRequestAt = 0;
  const DEFAULT_ALBUM_ART = "smootie album .jpeg";
  const VIDEO_INFO_GRACE_MS = 4000;
  const VIDEO_CHECK_COOLDOWN_MS = 2000;

  const DEBUG_LOGS = true;
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
    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    
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
        dayLabelEl.textContent = isToday ? dayLabels[dateObj.getDay()] : dayLabels[dateObj.getDay()].charAt(0);

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

  // Update video/music information with debouncing
  let updateVideoInfoTimeout = null;
  function updateVideoInfo(videoInfo) {
    // Clear pending update to prevent rapid DOM changes
    if (updateVideoInfoTimeout) {
      clearTimeout(updateVideoInfoTimeout);
    }
    
    updateVideoInfoTimeout = setTimeout(() => {
      updateVideoInfoImmediate(videoInfo);
      updateVideoInfoTimeout = null;
    }, 100); // Debounce DOM updates
  }
  
  function shouldShowVideoInfo() {
    if (!currentVideoInfo) return false;
    return (Date.now() - lastVideoDetectedAt) < VIDEO_INFO_GRACE_MS;
  }

  function requestThrottledVideoCheck() {
    if (!window.SmootieAPI?.requestVideoCheck) return;
    const now = Date.now();
    if (now - lastVideoCheckRequestAt < VIDEO_CHECK_COOLDOWN_MS) {
      return;
    }
    lastVideoCheckRequestAt = now;
    window.SmootieAPI.requestVideoCheck();
  }

  function updateVideoInfoImmediate(videoInfo) {
    const incomingVideo = videoInfo && videoInfo.title && videoInfo.title !== "No video playing";
    if (incomingVideo) {
      currentVideoInfo = videoInfo;
      lastVideoDetectedAt = Date.now();
    }

    debugLog('Received video info:', JSON.stringify(videoInfo, null, 2));
    
    const songTitleEl = document.getElementById("song-title");
    const albumLabelEl = document.getElementById("album-label");
    const artistNameEl = document.getElementById("artist-name");
    const albumArtEl = document.getElementById("album-art-img");
    
    if (shouldShowVideoInfo()) {
      const displayInfo = currentVideoInfo;
      if (!displayInfo) {
        // Nothing stored yet, fall back to default art
        if (albumArtEl) {
          albumArtEl.src = DEFAULT_ALBUM_ART;
          albumArtEl.style.display = "block";
        }
        return;
      }
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
        if (!thumbnailUrl && displayInfo.title) {
          debugLog('No thumbnail URL found, requesting video check to trigger API resolution');
          requestThrottledVideoCheck();
        }

        // If we still don't have a thumbnail, keep showing the last good one to avoid flicker
        if (!thumbnailUrl && lastGoodThumbnailUrl) {
          thumbnailUrl = lastGoodThumbnailUrl;
        }
        
        // Always display the album art for YouTube videos
        albumArtEl.style.display = "block";
        
        if (thumbnailUrl) {
          if (albumArtEl.src !== thumbnailUrl) {
            optimizedThumbnailLoad(albumArtEl, thumbnailUrl);
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
      currentVideoInfo = null;
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
        albumArtEl.src = DEFAULT_ALBUM_ART;
        albumArtEl.style.display = "block";
      }
      lastGoodThumbnailUrl = null;

      // Keep lastGoodThumbnailUrl so the next detection doesn't flicker to placeholder while resolving
    }
  }

  // Optimize thumbnail loading with lazy loading and error handling
  function optimizedThumbnailLoad(imgElement, src) {
    if (!imgElement || !src) return;
    
    // Use requestIdleCallback for non-critical loading
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        imgElement.src = src;
      }, { timeout: 1000 });
    } else {
      // Fallback for browsers without requestIdleCallback
      setTimeout(() => {
        imgElement.src = src;
      }, 100);
    }
  }

  // Update playback state (playing/paused)
  let playBtn = null;
  let prevBtn = null;
  let nextBtn = null;
  let controlsInitialized = false;
  let playToggleInFlight = false;
  let logicalPlaybackState = "paused"; // Our best guess of current playback state

  function updatePlaybackState(state) {
    if (!playBtn) return;

    if (state === 'playing') {
      logicalPlaybackState = 'playing';
      playBtn.classList.remove("is-paused");
      playBtn.setAttribute("aria-label", "Pause");
    } else if (state === 'paused') {
      logicalPlaybackState = 'paused';
      playBtn.classList.add("is-paused");
      playBtn.setAttribute("aria-label", "Play");
    } else {
      // Unknown state, keep as generic toggle
      logicalPlaybackState = null;
      playBtn.classList.remove("is-paused");
      playBtn.setAttribute("aria-label", "Play/Pause");
    }
  }

  function setupMusicControls() {
    if (controlsInitialized) {
      debugLog("Music controls already initialized");
      return;
    }

    playBtn = document.getElementById("play-btn");
    prevBtn = document.getElementById("prev-btn");
    nextBtn = document.getElementById("next-btn");

    debugLog("Setting up music controls:", {
      playBtn: !!playBtn,
      prevBtn: !!prevBtn,
      nextBtn: !!nextBtn,
      apiAvailable: !!(window.SmootieAPI && window.SmootieAPI.videoPlayPause)
    });

    // If the elements are not yet present (script loaded before DOM), try again shortly.
    if (!playBtn && !prevBtn && !nextBtn) {
      debugLog("Buttons not found, retrying in 50ms");
      setTimeout(setupMusicControls, 50);
      return;
    }

    if (playBtn) {
      // Default to paused state visually (show Play icon).
      // This keeps the button semantics intuitive when a YouTube video is initially paused.
      logicalPlaybackState = 'paused';
      updatePlaybackState(logicalPlaybackState);

      playBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        debugLog("Play button clicked");
        
        if (playToggleInFlight) {
          debugLog("Play toggle already in flight, ignoring");
          return;
        }
        playToggleInFlight = true;
        playBtn.classList.add("is-busy");

        // Toggle our logical playback state and update visuals accordingly
        const nextState = logicalPlaybackState === 'playing' ? 'paused' : 'playing';
        logicalPlaybackState = nextState;
        updatePlaybackState(nextState || 'paused');

        // Send play/pause command to YouTube
        if (window.SmootieAPI && window.SmootieAPI.videoPlayPause) {
          debugLog("Calling videoPlayPause API");
          window.SmootieAPI.videoPlayPause();
        } else {
          console.error("SmootieAPI.videoPlayPause not available");
        }

        setTimeout(() => {
          playToggleInFlight = false;
          playBtn.classList.remove("is-busy");
        }, 450);
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        debugLog("Previous button clicked");
        
        // Visual feedback
        prevBtn.style.opacity = '0.5';
        setTimeout(() => {
          prevBtn.style.opacity = '';
        }, 200);
        
        // Send previous command to YouTube
        if (window.SmootieAPI && window.SmootieAPI.videoPrevious) {
          debugLog("Calling videoPrevious API");
          window.SmootieAPI.videoPrevious();
        } else {
          console.error("SmootieAPI.videoPrevious not available");
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        debugLog("Next button clicked");
        
        // Visual feedback
        nextBtn.style.opacity = '0.5';
        setTimeout(() => {
          nextBtn.style.opacity = '';
        }, 200);
        
        // Send next command to YouTube
        if (window.SmootieAPI && window.SmootieAPI.videoNext) {
          debugLog("Calling videoNext API");
          window.SmootieAPI.videoNext();
        } else {
          console.error("SmootieAPI.videoNext not available");
        }
      });
    }

    controlsInitialized = true;
  }

  // Ensure control listeners are attached after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupMusicControls, { once: true });
  } else {
    setupMusicControls();
  }

  // Top bar buttons
  const menuBtn = document.getElementById("menu-btn");
  const menuMenu = document.getElementById("menu-menu");
  const menuStartupToggle = document.getElementById("menu-startup-toggle");
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

  function updateStartupToggleUI(enabled) {
    if (!menuStartupToggle) return;
    const isEnabled = !!enabled;
    menuStartupToggle.setAttribute("aria-pressed", isEnabled ? "true" : "false");
    menuStartupToggle.textContent = isEnabled ? "Start with Windows (On)" : "Start with Windows (Off)";
  }

  async function initializeStartupToggle() {
    if (!menuStartupToggle || !window.SmootieAPI?.getStartupEnabled) return;
    try {
      const enabled = await window.SmootieAPI.getStartupEnabled();
      updateStartupToggleUI(enabled);
    } catch (error) {
      console.error("Failed to read startup toggle state:", error);
      updateStartupToggleUI(false);
    }
  }

  if (menuStartupToggle) {
    initializeStartupToggle();
    menuStartupToggle.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!window.SmootieAPI?.setStartupEnabled) return;
      const currentState = menuStartupToggle.getAttribute("aria-pressed") === "true";
      const nextState = !currentState;
      updateStartupToggleUI(nextState);
      if (menuMenu) menuMenu.style.display = "none";
      try {
        const result = await window.SmootieAPI.setStartupEnabled(nextState);
        if (typeof result === "boolean") {
          updateStartupToggleUI(result);
        }
      } catch (error) {
        console.error("Failed to toggle startup:", error);
        updateStartupToggleUI(currentState);
      }
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

  // Preload thumbnails efficiently with debouncing
  let preloadTimeout = null;
  function preloadImage(url) {
    if (!url) return;
    
    // Debounce preload requests to avoid overwhelming the network
    if (preloadTimeout) {
      clearTimeout(preloadTimeout);
    }
    
    preloadTimeout = setTimeout(() => {
      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      img.src = url;
      preloadTimeout = null;
    }, 200);
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

  // Update island visibility based on maximization state with debouncing
  let visibilityTimeout = null;
  function updateIslandVisibility() {
    // Clear any pending visibility update
    if (visibilityTimeout) {
      clearTimeout(visibilityTimeout);
      visibilityTimeout = null;
    }

    // Debounce visibility changes to prevent flickering
    visibilityTimeout = setTimeout(() => {
      const nookTray = document.getElementById("mode-nook");
      const clockMode = document.getElementById("mode-clock");
      
      if (nookTray && clockMode) {
        if (isWindowMaximized) {
          nookTray.style.display = "none";
          clockMode.style.display = "none";
          debugLog("Island hidden: window maximized");
        } else {
          nookTray.style.display = "flex";
          clockMode.style.display = "flex";
          debugLog("Island shown: window not maximized");
        }
      }
      visibilityTimeout = null;
    }, 100); // 100ms debounce
  }

  if (window.SmootieAPI) {
    if (window.SmootieAPI.onIslandHide) {
      window.SmootieAPI.onIslandHide(() => {
        debugLog("Received island hide event");
        isWindowMaximized = true;
        updateIslandVisibility();
      });
    }

    if (window.SmootieAPI.onIslandShow) {
      window.SmootieAPI.onIslandShow(() => {
        debugLog("Received island show event");
        isWindowMaximized = false;
        updateIslandVisibility();
      });
    }

    // Check initial maximized state on startup
    if (window.SmootieAPI.isWindowMaximized) {
      window.SmootieAPI.isWindowMaximized().then((isMaximized) => {
        debugLog("Initial maximized state check:", isMaximized);
        isWindowMaximized = !!isMaximized;
        updateIslandVisibility();
      }).catch((error) => {
        console.error("Error checking initial maximized state:", error);
        // Default to showing island if we can't determine state
        isWindowMaximized = false;
        updateIslandVisibility();
      });
    }
  }
})();