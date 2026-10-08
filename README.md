# Smootie - Desktop Widget

A beautiful desktop widget that displays time, date, and YouTube video information with media controls.

## 🌍 Platform Support

- ✅ **Windows 10 (build 19041+) / 11**: Full support, including screenshot exclusion
- 🟡 **Linux (X11)**: Works, tested on Kali; other distros not fully tested
- ⚠️ **Linux (Wayland)**: Limited; window management tools (`xdotool`, `wmctrl`) may not work

## 📦 Installation

### Windows
1. Download from here: https://www.dropbox.com/home/Smootie
2. Run Smootie.exe

### Linux (tested on Kali)
1. Download `Smootie-linux-x64.tar.gz`
2. Extract: `tar -xzf Smootie-linux-x64.tar.gz`
3. Run: `./Smootie`

#### Linux Dependencies
The app requires these Linux packages for full functionality:
```bash
# Ubuntu/Debian/Kali
sudo apt install xdotool wmctrl

# Fedora/CentOS/RHEL
sudo dnf install xdotool wmctrl

# Arch Linux
sudo pacman -S xdotool wmctrl

# OpenSUSE
sudo zypper install xdotool wmctrl
```

## 🚀 Features

- **Clock Mode**: Minimal clock display with date
- **Widget Mode**: Full widget with YouTube video info and controls
- **Mode 2**: Extended widget with screenshot functionality
- **Media Controls**: Play/pause, next, previous for YouTube
- **Screenshot**: Full-screen capture with island exclusion (Windows only)
- **Auto-start**: Option to start with your system
- **Kali Linux Compatible**: Tested and working on Kali Linux

## 🎮 Controls

- **Spacebar**: Switch between Clock Mode, Widget Mode, and Mode 2
- **Click clock**: Switch to Widget Mode
- **Double-click background**: Switch to Clock Mode
- **Screenshot button** (Mode 2): Capture full screen at native resolution
- **Right-click**: Close app

## 📸 Screenshot Feature

The Screenshot button in Mode 2 captures the full screen at native resolution.

**Windows**: The island stays visible on screen but is excluded from the screenshot using `SetWindowDisplayAffinity` with `WDA_EXCLUDEFROMCAPTURE`.

**Linux**: The screenshot includes the island in the capture (no exclusion mechanism available).

## 🔧 Building from Source

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build for all platforms
npm run package-all

# Build for specific platform
npm run package        # Windows
npm run package-linux  # Linux
```

## 🐧 Linux Specific Notes

### Kali Linux
- Fully compatible with Kali Linux
- Uses `xdotool` and `wmctrl` for window management
- Tested on X11 desktop environments

### Troubleshooting Linux
If media controls don't work:
1. Install required dependencies:
   ```bash
   sudo apt install xdotool wmctrl dbus-x11
   ```
2. Make sure the app has necessary permissions:
   ```bash
   chmod +x Smootie
   ```

### Auto-start on Linux
The app creates a `.desktop` file in `~/.config/autostart/` for automatic startup.

## 📱 System Requirements

- **Windows**: Windows 10 (build 19041+) / 11
- **Linux**: Any modern distribution with X11
- **RAM**: 100MB minimum
- **Storage**: 200MB

## 🎨 Customization

- **Photos**: Click profile picture to select custom photo folder
- **Position**: Widget automatically positions at top-center of screen

## 🐛 Bug Reports (send me the report to code404m@gmail.com)

Please report issues with:
- Operating system and version
- Desktop environment (for Linux)
- Error messages from console

## 📄 License

MIT License - see LICENSE file for details
