# Smootie - Cross-Platform Desktop Widget

A beautiful desktop widget that displays time, date, and YouTube video information with media controls.

## 🌍 Platform Support

✅ **Windows** - Full support with PowerShell integration  
✅ **Linux** - Full support including Kali Linux, Ubuntu, Fedora, Debian, Arch, etc.   

<img width="1920" height="1080" alt="2026-01-28_21h26_40" src="https://github.com/user-attachments/assets/059c7f81-3427-44e2-8002-0d983ab23cb5" />


## 📦 Installation

### Windows
1. Download the latest release from the repository’s Releases section.
2. Extract (if applicable) and run Smootie.exe.

### Linux (including Kali Linux)
1. Download Smootie-linux-x64.tar.gz from the Releases section.
2. Extract the archive: tar -xzf Smootie-linux-x64.tar.gz
3. Run the application: ./Smootie

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
- **Storage**: 176MB

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
