param(
  [int]$Hwnd = 0,
  [string]$Widths = "1400,1000,800,700,600,520,480,400"
)
$ErrorActionPreference = "Stop"

if ($Hwnd -eq 0) {
  $p = Get-Process Typora -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { Write-Error "No Typora window found"; exit 1 }
  $Hwnd = $p.MainWindowHandle
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class TyporaWinResize {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

# Restore from maximized so SetWindowPos applies.
[TyporaWinResize]::ShowWindow([IntPtr]$Hwnd, 9) | Out-Null   # SW_RESTORE
Start-Sleep -Milliseconds 800

foreach ($w in ($Widths -split ',' | ForEach-Object { [int]$_ })) {
  [TyporaWinResize]::SetWindowPos([IntPtr]$Hwnd, [IntPtr]::Zero, 80, 40, $w, 820, 0x0004) | Out-Null  # SWP_NOZORDER
  Start-Sleep -Milliseconds 1800
  # Report the window + client widths actually applied.
  $rc = New-Object TyporaWinResize+RECT
  [TyporaWinResize]::GetClientRect([IntPtr]$Hwnd, [ref]$rc) | Out-Null
  Write-Output ("RESIZE target={0} clientW={1}" -f $w, ($rc.Right - $rc.Left))
}
Write-Output "RESIZE_MATRIX=DONE"
