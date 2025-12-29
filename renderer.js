// renderer.js
// Main renderer logic for Nook Tray widget

(function () {
  let currentVideoInfo = null;
  let isPlaying = true;
  let currentMode = 1; // 1 = clock mode, 2 = nook mode

  // -------- MODE SWITCHING (M key) --------
  let clockModeEl = null;
  let nookModeEl = null;

  function initializeModeElements() {
    clockModeEl = document.getElementById("mode-clock");
    nookModeEl = document.getElementById("mode-nook");
    console.log("Mode elements found:", { clockModeEl: !!clockModeEl, nookModeEl: !!nookModeEl });
  }

  function applyMode(mode) {
    currentMode = mode;
    console.log("Applying mode:", mode);
    
    if (clockModeEl && nookModeEl) {
      if (mode === 1) {
        clockModeEl.classList.remove("mode-hidden");
        nookModeEl.classList.add("mode-hidden");
        console.log("Switched to Mode 1 (Clock)");
      } else {
        clockModeEl.classList.add("mode-hidden");
        nookModeEl.classList.remove("mode-hidden");
        console.log("Switched to Mode 2 (Nook)");
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

  // Multiple switching options
  window.addEventListener("keydown", (e) => {
    console.log("Key pressed:", e.key);
    if (e.key === "m" || e.key === "M") {
      console.log("M key detected, switching mode");
      applyMode(currentMode === 1 ? 2 : 1);
    } else if (e.key === " " || e.key === "Spacebar") {
      console.log("Spacebar detected, switching mode");
      e.preventDefault(); // Prevent page scroll
      applyMode(currentMode === 1 ? 2 : 1);
    }
  });

  // Click on clock island to switch (single click)
  document.addEventListener("click", (e) => {
    if (clockModeEl && clockModeEl.contains(e.target)) {
      console.log("Clock island clicked, switching mode");
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
      console.log("Double-click detected, switching mode");
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
    currentVideoInfo = videoInfo;
    
    console.log('Received video info:', videoInfo); // Debug log
    
    const songTitleEl = document.getElementById("song-title");
    const albumLabelEl = document.getElementById("album-label");
    const artistNameEl = document.getElementById("artist-name");
    const albumArtEl = document.getElementById("album-art-img");
    
    if (videoInfo && videoInfo.title && videoInfo.title !== "No video playing") {
      console.log('Showing video info:', videoInfo.title); // Debug log
      // Only show video info when YouTube video is actually playing
      if (songTitleEl) {
        songTitleEl.textContent = videoInfo.title;
      }
      
      // Update album label and artist
      if (albumLabelEl) {
        albumLabelEl.textContent = videoInfo.source === "youtube" ? "YouTube" : "Local Video";
      }
      
      if (artistNameEl) {
        if (videoInfo.source === "youtube") {
          artistNameEl.textContent = "YouTube";
        } else {
          artistNameEl.textContent = videoInfo.source === "local" ? "Local Video" : "--";
        }
      }
      
      // Update album art (YouTube thumbnail)
      if (albumArtEl && videoInfo.source === "youtube") {
        // Only show thumbnail if we have a valid YouTube video
        if (videoInfo.thumbnail && videoInfo.videoId !== "detected") {
          albumArtEl.src = videoInfo.thumbnail;
          albumArtEl.style.display = "block";
          albumArtEl.onerror = function() {
            this.style.display = "none";
          };
        } else if (videoInfo.videoId && videoInfo.videoId !== "detected") {
          // Generate thumbnail URL from video ID
          albumArtEl.src = `https://img.youtube.com/vi/${videoInfo.videoId}/mqdefault.jpg`;
          albumArtEl.style.display = "block";
          albumArtEl.onerror = function() {
            this.style.display = "none";
          };
        } else {
          // Hide thumbnail for title-only detection (no video ID)
          albumArtEl.style.display = "none";
        }
      }
    } else {
      console.log('Hiding all video info'); // Debug log
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
    }
  }

  // Music controls
  const playBtn = document.getElementById("play-btn");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  
  if (playBtn) {
    playBtn.classList.toggle("is-paused", !isPlaying);
    playBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");

    playBtn.addEventListener("click", () => {
      // Send play/pause command to YouTube
      if (window.SmootieAPI && window.SmootieAPI.videoPlayPause) {
        window.SmootieAPI.videoPlayPause();
      }
      isPlaying = !isPlaying;
      // Toggle play/pause icon
      playBtn.classList.toggle("is-paused", !isPlaying);
      playBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
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
  const settingsBtn = document.getElementById("settings-btn");
  const homeTabBtn = document.getElementById("tab-tray");
  
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      console.log("Settings clicked");
    });
  }

  if (homeTabBtn) {
    homeTabBtn.addEventListener("click", () => {
      console.log("Home tab clicked, returning to Mode 1");
      applyMode(1); // Always switch to Mode 1 (clock)
    });
  }

  // Listen for video info updates from main process
  if (window.SmootieAPI) {
    window.SmootieAPI.onVideoInfoUpdate((videoInfo) => {
      updateVideoInfo(videoInfo);
    });
  }

  // Load random photo from user's computer
  function loadRandomPhoto() {
    const profileImg = document.getElementById("profile-img");
    console.log("Loading photo from source:", currentPhotoSource);
    if (profileImg && window.SmootieAPI && window.SmootieAPI.getRandomPhoto) {
      window.SmootieAPI.getRandomPhoto(currentPhotoSource).then((photoPath) => {
        console.log("Photo path received:", photoPath);
        if (photoPath) {
          profileImg.src = `file://${photoPath}`;
          profileImg.style.display = "block";
          console.log("Image src set to:", profileImg.src);
        } else {
          // No photo found - hide image to show dark background
          profileImg.style.display = "none";
          console.log("No photo found, hiding image");
        }
      }).catch((error) => {
        // Error - hide image to show dark background
        profileImg.style.display = "none";
        console.log("Could not load random photo:", error);
      });
    } else {
      console.log("Missing elements or API");
    }
  }

  // Photo source selector functionality
  const photoSourceBtn = document.getElementById("photo-source-btn");
  const photoSourceMenu = document.getElementById("photo-source-menu");
  const photoSourceOptions = document.querySelectorAll(".photo-source-option");
  let currentPhotoSource = localStorage.getItem("photoSource") || "all";

  console.log("Photo source button found:", photoSourceBtn);
  console.log("Photo source menu found:", photoSourceMenu);
  console.log("Photo source options found:", photoSourceOptions.length);

  // Set active state for current photo source
  function updatePhotoSourceUI() {
    photoSourceOptions.forEach(option => {
      const source = option.dataset.source;
      const isActive = (source === currentPhotoSource) || 
                     (source === "custom" && (currentPhotoSource.startsWith("C:") || currentPhotoSource.startsWith("/") || currentPhotoSource.includes("\\")));
      
      if (isActive) {
        option.classList.add("active");
        // Update button text for custom folder
        if (source === "custom") {
          const customName = localStorage.getItem("customFolderName") || "Custom Folder";
          option.textContent = customName;
        }
      } else {
        option.classList.remove("active");
        // Reset button text for custom folder only if it's not the active custom folder
        if (source === "custom" && !isActive) {
          option.textContent = "Choose Custom Folder";
        }
      }
    });
  }

  // Toggle photo source menu
  if (photoSourceBtn) {
    photoSourceBtn.addEventListener("click", (e) => {
      console.log("Photo source button clicked!");
      e.stopPropagation();
      if (photoSourceMenu.style.display === "block") {
        photoSourceMenu.style.display = "none";
      } else {
        photoSourceMenu.style.display = "block";
        updatePhotoSourceUI();
      }
    });
  } else {
    console.error("Photo source button not found!");
  }

  // Handle photo source selection
  photoSourceOptions.forEach(option => {
    option.addEventListener("click", (e) => {
      e.stopPropagation();
      const selectedSource = option.dataset.source;
      
      if (selectedSource === "custom") {
        // Open folder selection dialog
        if (window.SmootieAPI && window.SmootieAPI.selectCustomFolder) {
          window.SmootieAPI.selectCustomFolder().then((folderPath) => {
            if (folderPath) {
              currentPhotoSource = folderPath;
              localStorage.setItem("photoSource", folderPath);
              localStorage.setItem("customFolderName", folderPath.split('\\').pop() || folderPath.split('/').pop() || 'Custom Folder');
              
              // Update UI
              updatePhotoSourceUI();
              photoSourceMenu.style.display = "none";
              
              // Load photo from custom folder
              loadRandomPhoto();
            }
          });
        }
      } else {
        currentPhotoSource = selectedSource;
        localStorage.setItem("photoSource", selectedSource);
        localStorage.removeItem("customFolderName");
        
        // Update UI
        updatePhotoSourceUI();
        photoSourceMenu.style.display = "none";
        
        // Load photo from new source
        loadRandomPhoto();
      }
    });
  });

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!photoSourceMenu.contains(e.target) && e.target !== photoSourceBtn) {
      photoSourceMenu.style.display = "none";
    }
  });

  // Change photo every 30 seconds
  setInterval(loadRandomPhoto, 30000);

  // Initialize with default state
  updateVideoInfo(null);
  loadRandomPhoto();

  // -------- WINDOW MAXIMIZATION DETECTION --------
  let isWindowMaximized = false;

  // Check if any window is maximized
  function checkMaximizedWindows() {
    if (window.SmootieAPI && window.SmootieAPI.isWindowMaximized) {
      window.SmootieAPI.isWindowMaximized().then((isMaximized) => {
        isWindowMaximized = isMaximized;
        updateIslandVisibility();
        console.log("Island hidden:", isWindowMaximized);
      }).catch((error) => {
        console.error("Error checking maximized windows:", error);
      });
    }
  }

  // Update island visibility based on maximization state
  function updateIslandVisibility() {
    const nookTray = document.getElementById("mode-nook");
    const clockMode = document.getElementById("mode-clock");
    
    if (nookTray && clockMode) {
      if (isWindowMaximized) {
        nookTray.style.display = "none";
        clockMode.style.display = "none";
        console.log("Hiding island - windows maximized");
      } else {
        nookTray.style.display = "flex";
        clockMode.style.display = "flex";
        console.log("Showing island - no maximized windows");
      }
    }
  }

  // Check maximized windows every 2 seconds
  setInterval(checkMaximizedWindows, 2000);

  // Initial check
  setTimeout(checkMaximizedWindows, 1000);
})();