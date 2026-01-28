# Smootie - Cross-Platform Desktop Widget

A beautiful desktop widget that displays time, date, and YouTube video information with media controls.

## 🌍 Platform Support

✅ **Windows** - Full support with PowerShell integration  
✅ **Linux** - Full support including Kali Linux, Ubuntu, Fedora, Debian, Arch, etc.  
✅ **macOS** - Full support  

## 📦 Installation

### Windows
1. You can download the latest version from here: https://www.dropbox.com/home/Smootie
      OR
1. Download `Smootie-win32-x64.zip`
2. Extract and run `Smootie.exe`

### Linux (including Kali Linux)
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

### macOS
1. Download `Smootie-darwin-x64.zip`
2. Extract and run `Smootie.app`

## 🚀 Features

- **Clock Mode**: Minimal clock display with date
- **Widget Mode**: Full widget with YouTube video info and controls
- **Media Controls**: Play/pause, next, previous for YouTube
- **Auto-start**: Option to start with your system
- **Cross-platform**: Works on Windows, Linux, and macOS
- **Kali Linux Compatible**: Tested and working on Kali Linux

## 🎮 Controls

- **M key**: Switch between modes
- **Spacebar**: Switch between modes
- **Click clock**: Switch to widget mode
- **Double-click background**: Switch to clock mode
- **Right-click**: Close app

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
npm run package-mac    # macOS
```

## 🐧 Linux Specific Notes

### Kali Linux
- Fully compatible with Kali Linux
- Uses `xdotool` and `wmctrl` for window management
- Supports all desktop environments (GNOME, KDE, XFCE, etc.)

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

- **Windows**: Windows 10/11
- **Linux**: Any modern distribution with X11
- **macOS**: macOS 10.14+
- **RAM**: 100MB minimum
- **Storage**: 200MB

## 🎨 Customization

- **Photos**: Click profile picture to select custom photo folder
- **Startup**: Use menu to enable/disable auto-start
- **Position**: Widget automatically positions at top-center of screen

## 🐛 Bug Reports

Please report issues with:
- Operating system and version
- Desktop environment (for Linux)
- Error messages from console

## 📄 License

MIT License - see LICENSE file for details
