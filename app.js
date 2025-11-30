// app.js - Main application logic

let currentActivity = 'clock';
let settings = {};
let mediaData = null;

const DEFAULT_NOTCH_WIDTH = 360;
const DEFAULT_NOTCH_HEIGHT = 40;
let notchDimensions = { width: DEFAULT_NOTCH_WIDTH, height: DEFAULT_NOTCH_HEIGHT };

let wallpaperImages = [];
let wallpaperIndex = 0;
let wallpaperTimer = null;

function getNotchElement() {
    return document.getElementById('notch');
}

function applyNotchDimensions(dimensions = {}) {
    const notch = getNotchElement();
    if (!notch) return;

    const { width, height, expanded } = dimensions;

    if (typeof width === 'number' && width > 0) {
        notch.style.width = `${width}px`;
        notchDimensions.width = width;
    }

    if (typeof height === 'number' && height >= 0) {
        notch.style.height = `${height}px`;
        notchDimensions.height = height;
    }

    let shouldExpand = expanded;
    if (typeof shouldExpand !== 'boolean') {
        shouldExpand = notchDimensions.width > DEFAULT_NOTCH_WIDTH || notchDimensions.height > DEFAULT_NOTCH_HEIGHT;
    }

    notch.setAttribute('data-expanded', shouldExpand ? 'true' : 'false');
}

function updateModePill() {
    const pill = document.getElementById('mode-pill');
    const iconEl = document.getElementById('mode-pill-icon');
    const textEl = document.getElementById('mode-pill-text');

    if (!pill || !iconEl || !textEl) return;

    if (currentActivity !== 'multi') {
        pill.style.display = 'none';
        return;
    }

    // Always show "NOW PLAYING" in multi mode
    pill.style.display = 'inline-flex';
    textEl.textContent = 'NOW PLAYING';
    iconEl.textContent = '♪';
}

function getCurrentTimeString() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

function updateTimeDisplays() {
    const timeString = getCurrentTimeString();
    const scheduleEl = document.getElementById('calendar-schedule');
    if (scheduleEl) {
        scheduleEl.textContent = timeString;
    }
}

function applyArtwork(imageUrl) {
    const regular = document.getElementById('music-artwork');
    const compact = document.getElementById('music-artwork-compact');

    [regular, compact].forEach((element) => {
        if (!element) return;
        if (imageUrl) {
            element.style.backgroundImage = `url('${imageUrl}')`;
            element.classList.add('has-artwork');
        } else {
            element.style.backgroundImage = '';
            element.classList.remove('has-artwork');
        }
    });
}

function updateMirrorPhoto() {
    const photoEl = document.getElementById('mirror-photo');
    if (!photoEl) return;
    const label = photoEl.querySelector('.mirror-label');

    if (!wallpaperImages.length) {
        photoEl.style.backgroundImage = '';
        if (label) label.style.display = 'block';
        return;
    }

    const current = wallpaperImages[wallpaperIndex % wallpaperImages.length];
    photoEl.style.backgroundImage = `url('${current}')`;
    if (label) label.style.display = 'none';
}

function cycleWallpaper() {
    if (!wallpaperImages.length) return;
    wallpaperIndex = (wallpaperIndex + 1) % wallpaperImages.length;
    updateMirrorPhoto();
}

async function loadWallpapers() {
    if (!window.SmootieAPI?.getWallpapers) return;
    try {
        wallpaperImages = await window.SmootieAPI.getWallpapers();
        wallpaperIndex = 0;
        updateMirrorPhoto();
        if (wallpaperTimer) clearInterval(wallpaperTimer);
        if (wallpaperImages.length) {
            wallpaperTimer = setInterval(cycleWallpaper, 15000);
        }
    } catch (e) {
        wallpaperImages = [];
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    // Load settings
    try {
        settings = await window.SmootieAPI.getSettings() || {};
    } catch (e) {
        settings = {
            showClock: true,
            showCalendar: true,
            showMusic: true,
            showTray: true
        };
    }

    // Setup clock
    if (settings.showClock) {
        setupClock();
    }

    // Setup calendar
    if (settings.showCalendar) {
        setupCalendar();
    }

    // Setup music player
    if (settings.showMusic) {
        setupMusicPlayer();
    }

    // Setup tray
    if (settings.showTray) {
        setupTray();
    }

    // Setup settings panel
    setupSettings();

    // Listen for media updates
    window.SmootieAPI.onMediaUpdate((data) => {
        if (data && settings.showMusic) {
            mediaData = data;
            updateMusicDisplay(mediaData);
            applyArtwork(mediaData.thumbnail);
            // Switch to Mode 2: YouTube track with smooth transition
            if (currentActivity !== 'multi') {
                showActivity('multi');
            } else {
                // Already in multi mode, just update content
                updateMultiActivity();
            }
        } else {
            mediaData = null;
            applyArtwork(null);
            updateMusicDisplay({
                title: 'No music playing',
                artist: 'YouTube',
                isPlaying: false
            });
            // Switch to Mode 1: Clock with smooth transition
            if (currentActivity !== 'clock') {
                showActivity('clock');
            }
        }
    });

    // Listen for island state changes
    if (window.SmootieAPI?.onIslandShow) {
        window.SmootieAPI.onIslandShow((dimensions) => {
            applyNotchDimensions(dimensions);
        });
    }

    if (window.SmootieAPI?.onIslandHide) {
        window.SmootieAPI.onIslandHide((dimensions) => {
            applyNotchDimensions({
                width: dimensions?.width ?? notchDimensions.width,
                height: 0,
                expanded: false
            });
        });
    }

    if (window.SmootieAPI?.onIslandExpand) {
        window.SmootieAPI.onIslandExpand((dimensions) => {
            applyNotchDimensions({
                width: dimensions?.width ?? notchDimensions.width,
                height: dimensions?.height ?? notchDimensions.height,
                expanded: true
            });
        });
    }

    if (window.SmootieAPI?.onIslandCollapse) {
        window.SmootieAPI.onIslandCollapse((dimensions) => {
            applyNotchDimensions({
                width: dimensions?.width ?? DEFAULT_NOTCH_WIDTH,
                height: dimensions?.height ?? DEFAULT_NOTCH_HEIGHT,
                expanded: false
            });
        });
    }
    
    updateTimeDisplays();
    setInterval(updateTimeDisplays, 1000);
    loadWallpapers();

    // Start with Mode 2: Multi-activity (matching second image) - set as active immediately
    updateMultiActivity();
    const multiActivity = document.getElementById('multi-activity');
    if (multiActivity) {
        multiActivity.style.display = 'flex';
        multiActivity.setAttribute('data-active', 'true');
        multiActivity.style.opacity = '1';
        currentActivity = 'multi';
        // Set expanded dimensions for multi-activity view
        applyNotchDimensions({
            width: 620,
            height: 140,
            expanded: true
        });
        // Ensure pill is visible
        updateModePill();
        if (window.SmootieAPI && window.SmootieAPI.resizeAndCenter) {
            window.SmootieAPI.resizeAndCenter(620, 140);
        }
    }
}

function setupClock() {
    const clockEl = document.getElementById('clock');
    clockEl.innerText = window.SmootieAPI.getTime();
    
    window.SmootieAPI.onTick((time) => {
        clockEl.innerText = time;
    });
}

function setupCalendar() {
    updateCalendar();
    setInterval(updateCalendar, 60000); // Update every minute
}

function updateCalendar() {
    const dateInfo = window.SmootieAPI.getDate();
    document.getElementById('calendar-month').textContent = dateInfo.month;
    document.getElementById('calendar-year').textContent = dateInfo.year;
    
    // Update active day
    const today = dateInfo.day;
    document.querySelectorAll('.calendar-day').forEach(day => {
        day.classList.remove('active');
        if (parseInt(day.textContent) === today) {
            day.classList.add('active');
        }
    });
    
    updateTimeDisplays();
}

function setupMusicPlayer() {
    // Music controls
    const playPauseBtn = document.getElementById('play-pause-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', () => {
            if (mediaData) {
                playPauseBtn.textContent = mediaData.isPlaying ? '▶' : '⏸';
            }
        });
    }
    
    if (prevBtn) prevBtn.addEventListener('click', () => {});
    if (nextBtn) nextBtn.addEventListener('click', () => {});
}

function updateMusicDisplay(data = {}) {
    const title = document.getElementById('music-title');
    const artist = document.getElementById('music-artist');
    if (title) title.textContent = data.title || 'No music playing';
    if (artist) artist.textContent = data.artist || 'YouTube Music';
    
    const playPauseBtn = document.getElementById('play-pause-btn');
    if (playPauseBtn) {
        playPauseBtn.textContent = data.isPlaying ? '⏸' : '▶';
    }
}

function setupTray() {
    // Tray functionality
    const trayLabel = document.getElementById('tray-label');
    if (trayLabel) {
        trayLabel.addEventListener('click', () => {
            showActivity('tray');
        });
    }
}

function setupSettings() {
    // Load settings into UI
    const clockCheck = document.getElementById('setting-clock');
    const calendarCheck = document.getElementById('setting-calendar');
    const musicCheck = document.getElementById('setting-music');
    const trayCheck = document.getElementById('setting-tray');
    
    if (clockCheck) clockCheck.checked = settings.showClock !== false;
    if (calendarCheck) calendarCheck.checked = settings.showCalendar !== false;
    if (musicCheck) musicCheck.checked = settings.showMusic !== false;
    if (trayCheck) trayCheck.checked = settings.showTray !== false;

    // Settings button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            document.getElementById('settings-panel').style.display = 'flex';
        });
    }

    const closeSettings = document.getElementById('close-settings');
    if (closeSettings) {
        closeSettings.addEventListener('click', () => {
            document.getElementById('settings-panel').style.display = 'none';
            saveSettings();
        });
    }

    // Save on change
    ['setting-clock', 'setting-calendar', 'setting-music', 'setting-tray'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                saveSettings();
            });
        }
    });
}

async function saveSettings() {
    settings = {
        showClock: document.getElementById('setting-clock').checked,
        showCalendar: document.getElementById('setting-calendar').checked,
        showMusic: document.getElementById('setting-music').checked,
        showTray: document.getElementById('setting-tray').checked
    };
    
    try {
        await window.SmootieAPI.saveSettings(settings);
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

function showActivity(activity) {
    const activityEl = document.getElementById(activity + '-activity');
    if (!activityEl) return;

    // Determine new dimensions first
    let newWidth = DEFAULT_NOTCH_WIDTH;
    let newHeight = DEFAULT_NOTCH_HEIGHT;
    
    // Mode 1: Clock (collapsed, simple)
    if (activity === 'clock') {
        newWidth = DEFAULT_NOTCH_WIDTH;
        newHeight = DEFAULT_NOTCH_HEIGHT;
    }
        // Mode 2: YouTube track (expanded, multi-section)
        else if (activity === 'multi') {
            newWidth = 620;
            newHeight = 140;
    }
    // Other activities (fallback)
    else if (activity === 'music' || activity === 'calendar') {
        newWidth = DEFAULT_NOTCH_WIDTH;
        newHeight = 120;
    } else {
        newWidth = DEFAULT_NOTCH_WIDTH;
        newHeight = DEFAULT_NOTCH_HEIGHT;
    }

    // Start window resize first (before content change for smoother transition)
    const isExpanded = newWidth > DEFAULT_NOTCH_WIDTH || newHeight > DEFAULT_NOTCH_HEIGHT;
    applyNotchDimensions({ width: newWidth, height: newHeight, expanded: isExpanded });
    
    // Request window resize and recenter via IPC
    if (window.SmootieAPI && window.SmootieAPI.resizeAndCenter) {
        window.SmootieAPI.resizeAndCenter(newWidth, newHeight);
    }

    // Fade out current activities
    document.querySelectorAll('.activity[data-active="true"]').forEach(el => {
        el.style.opacity = '0';
        setTimeout(() => {
            el.style.display = 'none';
            el.removeAttribute('data-active');
        }, 150);
    });

    // Update content for multi-activity before showing
    if (activity === 'multi') {
        updateMultiActivity();
    }

    // Show and fade in new activity
    activityEl.style.display = 'flex';
    currentActivity = activity;
    updateModePill();
    
    // Use requestAnimationFrame for smooth transition
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            activityEl.setAttribute('data-active', 'true');
            activityEl.style.opacity = '1';
        });
    });
}

function updateMultiActivity() {
    const titleEl = document.getElementById('music-title-compact');
    const artistEl = document.getElementById('music-artist-compact');
    const albumEl = document.getElementById('music-album-compact');
    const agendaTextEl = document.getElementById('mode2-agenda-text');

    // Default to match reference image exactly
    if (titleEl) titleEl.textContent = mediaData?.title || 'Dibi Dibi Rek';
    if (artistEl) artistEl.textContent = mediaData?.artist || mediaData?.channel || 'Ismaël Lô';
    if (albumEl) albumEl.textContent = mediaData?.album || 'BEST OF';
    // Bug 1 Fix: Check mediaData.status first, then fallback to default
    if (agendaTextEl) agendaTextEl.textContent = mediaData?.status || 'Nothing for today';

    // Apply artwork if available, otherwise keep default
    applyArtwork(mediaData?.thumbnail || null);

    // Bug 2 Fix: Use actual current date instead of hardcoded values
    const dateInfo = window.SmootieAPI.getDate();
    const monthEl = document.getElementById('calendar-month-compact');
    if (monthEl) monthEl.textContent = dateInfo.month.toLowerCase();

    const daysContainer = document.getElementById('mode2-days');
    if (daysContainer) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysData = [];
        for (let i = -3; i <= 3; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            const dayNumber = date.getDate();
            const dayOfWeek = date.getDay();
            const isToday = i === 0;
            let displayLetter = '';
            if(date.toLocaleString('en-GB', { weekday: 'short' }).toUpperCase().startsWith('MON')) displayLetter = 'MON';
            else displayLetter = date.toLocaleString('en-GB', { weekday: 'short' })[0].toUpperCase();
            let colorClass = '';
            if (dayOfWeek === 0 || dayOfWeek === 6) colorClass = 'weekend';
            if (isToday) colorClass = 'active';
            daysData.push({
                letter: displayLetter,
                number: dayNumber.toString().padStart(2, '0'),
                active: isToday,
                colorClass
            });
        }
        daysContainer.innerHTML = '';
        daysData.forEach(day => {
            const dayEl = document.createElement('div');
            dayEl.className = 'mode2-day-horizontal' + (day.colorClass ? ' ' + day.colorClass : '');
            if (day.active) dayEl.classList.add('active');
            const letter = document.createElement('span');
            letter.className = 'day-letter-horizontal';
            letter.textContent = day.letter;
            dayEl.appendChild(letter);
            const number = document.createElement('span');
            number.className = 'day-number-horizontal';
            number.textContent = day.number;
            dayEl.appendChild(number);
            daysContainer.appendChild(dayEl);
        });
    }

    updateMirrorPhoto();
    updateModePill();
}

// Activity switching
const nookLabel = document.getElementById('nook-label');
if (nookLabel) {
    nookLabel.addEventListener('click', () => {
        if (settings.showCalendar) {
            showActivity('calendar');
        } else {
            showActivity('clock');
        }
    });
}

// Update multi-activity periodically when in Mode 2
setInterval(() => {
    if (currentActivity === 'multi') {
        updateMultiActivity();
    }
}, 1000);

// Mode switching logic:
// Mode 1: Clock - Simple clock display (40px height, 360px width)
// Mode 2: YouTube Track - Multi-section layout with music, calendar, mirror (100px height, 600px width)
// Automatically switches to Mode 2 when YouTube is detected, back to Mode 1 when YouTube closes
