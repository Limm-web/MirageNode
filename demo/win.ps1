# MIRAGE-NODE :: window helper (find by title, move / focus / maximize)
param(
    [Parameter(Mandatory=$true)][string]$Title,
    [int]$X = -1, [int]$Y = -1, [int]$W = -1, [int]$H = -1,
    [switch]$Max,
    [switch]$Focus
)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
}
"@

$hwnd = [IntPtr]::Zero
for ($try = 0; $try -lt 20; $try++) {
    $p = Get-Process | Where-Object { $_.MainWindowTitle -like ("*" + $Title + "*") } | Select-Object -First 1
    if ($p -and $p.MainWindowHandle -ne 0) { $hwnd = $p.MainWindowHandle; break }
    Start-Sleep -Milliseconds 350
}
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "WINDOW-NOT-FOUND: $Title"; exit 1 }

if ($Max)      { [W]::ShowWindow($hwnd, 3) | Out-Null }            # SW_MAXIMIZE
elseif ($W -gt 0) { [W]::SetWindowPos($hwnd, [IntPtr]::Zero, $X, $Y, $W, $H, 0x0040) | Out-Null }
if ($Focus)    { [W]::SetForegroundWindow($hwnd) | Out-Null; Start-Sleep -Milliseconds 220 }
Write-Output "WINDOW-OK $Title"
