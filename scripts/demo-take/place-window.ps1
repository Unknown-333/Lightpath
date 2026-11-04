# Moves one top-level window so its visible frame covers exactly X,Y,W,H (screen pixels), through
# the Win32 API (SetWindowPos). No mouse or keyboard input is sent.
#   -Title   part of the window title to look for (first visible match, at least 3 characters)
#   -ProcessId only windows of this process (the Chrome that Lightpath launched)
#   -Topmost keep it above other windows (-Topmost:$false takes that off again)
# Prints the window's visible frame after the move, as JSON.
param(
  [Parameter(Mandatory = $true)][string]$Title,
  [int]$X, [int]$Y, [int]$W, [int]$H,
  [switch]$Topmost,
  [switch]$Release,
  [int]$ProcessId = 0,
  [int]$TimeoutMs = 20000
)
$ErrorActionPreference = 'Stop'
# An empty title would match any window: never move a window that isn't ours.
if ($Title.Length -lt 3) { throw '-Title needs at least 3 characters' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class LpWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static IntPtr Find(string part, uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      if (pid != 0) { uint p; GetWindowThreadProcessId(h, out p); if (p != pid) return true; }
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      if (sb.Length > 0 && sb.ToString().Contains(part)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static RECT Frame(IntPtr h) {
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    return r;
  }
}
'@
$deadline = [DateTime]::Now.AddMilliseconds($TimeoutMs)
$hwnd = [IntPtr]::Zero
while ($hwnd -eq [IntPtr]::Zero) {
  $hwnd = [LpWin]::Find($Title, [uint32]$ProcessId)
  if ($hwnd -ne [IntPtr]::Zero) { break }
  if ([DateTime]::Now -gt $deadline) { throw "no visible window with '$Title' in its title" }
  Start-Sleep -Milliseconds 200
}
$NOSIZE_NOMOVE = 0x0003
$SHOW = 0x0040
# (PowerShell names are case-insensitive: the handle must not be called $h, or it overwrites -H.)
if ($Release) {
  [void][LpWin]::SetWindowPos($hwnd, [IntPtr](-2), 0, 0, 0, 0, $NOSIZE_NOMOVE)
  '{"released":true}'
  exit 0
}
[void][LpWin]::ShowWindow($hwnd, 9) # restore, in case it opened maximized
$after = if ($Topmost) { [IntPtr](-1) } else { [IntPtr]::Zero }
# The window rect includes invisible resize borders; size it so the visible frame lands on the target.
$tries = @()
for ($i = 0; $i -lt 3; $i++) {
  $wr = New-Object LpWin+RECT
  [void][LpWin]::GetWindowRect($hwnd, [ref]$wr)
  $fr = [LpWin]::Frame($hwnd)
  $l = $fr.Left - $wr.Left; $t = $fr.Top - $wr.Top; $r = $wr.Right - $fr.Right; $b = $wr.Bottom - $fr.Bottom
  $tries += "window $($wr.Left),$($wr.Top),$($wr.Right),$($wr.Bottom) frame $($fr.Left),$($fr.Top),$($fr.Right),$($fr.Bottom)"
  [void][LpWin]::SetWindowPos($hwnd, $after, $X - $l, $Y - $t, $W + $l + $r, $H + $t + $b, $SHOW)
  Start-Sleep -Milliseconds 150
}
$fr = [LpWin]::Frame($hwnd)
@{ left = $fr.Left; top = $fr.Top; width = $fr.Right - $fr.Left; height = $fr.Bottom - $fr.Top; tries = $tries } | ConvertTo-Json -Compress
