// Keeps ONE PowerShell running that checks windows ~10x/second.
// The app reads the latest answer instantly instead of starting PowerShell each time.
const { spawn } = require('child_process');

let proc = null;
let stopped = false;
let ready = false;
let fullscreen = false;
let buffer = '';
let onChangeCb = null;

function buildScript(ownPid) {
  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class SmootieWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  static bool IsIgnored(string t) {
    if (t.Length == 0) return true;
    string[] exact = { "Taskbar", "Start", "Search", "Program Manager", "Windows Input Experience", "Microsoft Text Input Application" };
    foreach (string e in exact) { if (string.Equals(t, e, StringComparison.OrdinalIgnoreCase)) return true; }
    string[] part = { "Desktop Window Manager", "TextInputHost" };
    foreach (string p in part) { if (t.IndexOf(p, StringComparison.OrdinalIgnoreCase) >= 0) return true; }
    return false;
  }

  public static string FindFullscreen(uint ownPid, int sx, int sy, int sw, int sh) {
    string found = "";
    IntPtr shell = GetShellWindow();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (h == shell) return true;
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      uint pid = 0;
      GetWindowThreadProcessId(h, out pid);
      if (pid == ownPid) return true;
      int cloaked = 0;
      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;
      RECT r;
      if (!GetWindowRect(h, out r)) return true;
      int w = r.Right - r.Left;
      int ht = r.Bottom - r.Top;
      if (w < 400 || ht < 300) return true;
      StringBuilder sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      string title = sb.ToString();
      if (IsIgnored(title)) return true;
      bool maximized = IsZoomed(h);
      bool covers = Math.Abs(r.Left - sx) <= 10 && Math.Abs(r.Top - sy) <= 10 && w >= sw - 20 && ht >= sh - 20;
      if (maximized || covers) {
        found = (maximized ? "maximized: " : "covers screen: ") + title;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
[Console]::Out.WriteLine("READY")
$last = ""
while ($true) {
  $r = [SmootieWin]::FindFullscreen([uint32]${ownPid}, $s.X, $s.Y, $s.Width, $s.Height)
  if ($r) { $cur = "FULLSCREEN|" + $r } else { $cur = "NOT_FULLSCREEN" }
  if ($cur -ne $last) { [Console]::Out.WriteLine($cur); $last = $cur }
  Start-Sleep -Milliseconds 100
}
`;
}

function handleLine(line) {
  line = line.trim();
  if (!line) return;
  if (line === 'READY') {
    ready = true;
    console.log('[Watcher] Ready');
    return;
  }
  if (line.startsWith('FULLSCREEN') || line === 'NOT_FULLSCREEN') {
    const now = line.startsWith('FULLSCREEN');
    const detail = line.includes('|') ? line.split('|')[1] : '';
    const changed = now !== fullscreen;
    fullscreen = now;
    if (changed) {
      console.log('[Watcher] State:', now ? 'FULLSCREEN (' + detail + ')' : 'NOT_FULLSCREEN');
      if (onChangeCb) {
        try { onChangeCb(now); } catch (e) { console.error('[Watcher] callback error:', e.message); }
      }
    }
  }
}

function start(onChange) {
  if (process.platform !== 'win32' || proc) return;
  stopped = false;
  onChangeCb = onChange || null;
  const encoded = Buffer.from(buildScript(process.pid), 'utf16le').toString('base64');
  proc = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true });
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    lines.forEach(handleLine);
  });
  proc.stderr.on('data', (d) => console.error('[Watcher] stderr:', d.toString().trim()));
  proc.on('exit', () => {
    proc = null;
    ready = false;
    if (!stopped) setTimeout(() => start(onChangeCb), 2000);
  });
}

function stop() {
  stopped = true;
  if (proc) { try { proc.kill(); } catch (e) {} proc = null; }
  ready = false;
}

module.exports = {
  start,
  stop,
  isReady: () => ready,
  isFullscreen: () => fullscreen
};