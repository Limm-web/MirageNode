# MIRAGE-NODE :: desktop input driver (SendInput / human-like)
param(
    [Parameter(Mandatory=$true)][string]$Action,
    [int]$X = 0, [int]$Y = 0,
    [string]$Text = "",
    [string]$Combo = "",
    [int]$Steps = 30,
    [int]$Amount = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NI {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int e);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint f, int e);
}
"@

function Ease([double]$t){ return (1 - [Math]::Pow(1-$t, 2.2)) }

switch ($Action) {

  'move' {
    $cur = [System.Windows.Forms.Cursor]::Position
    $sx = $cur.X; $sy = $cur.Y
    for ($i=1; $i -le $Steps; $i++) {
      $t = Ease($i / $Steps)
      $nx = [int]($sx + ($X - $sx) * $t + (Get-Random -Min -1 -Max 2))
      $ny = [int]($sy + ($Y - $sy) * $t + (Get-Random -Min -1 -Max 2))
      [NI]::SetCursorPos($nx, $ny) | Out-Null
      Start-Sleep -Milliseconds 13
    }
    [NI]::SetCursorPos($X, $Y) | Out-Null
  }

  'click' {
    [NI]::mouse_event(2, 0, 0, 0, 0); Start-Sleep -Milliseconds 55
    [NI]::mouse_event(4, 0, 0, 0, 0)
  }

  'wheel' {
    $delta = [int]($Amount * 120)
    if ($delta -lt 0) { $delta += 4294967296 }
    [NI]::mouse_event(0x0800, 0, 0, [uint32]$delta, 0)
  }

  'type' {
    $special = "+^%~(){}[]"
    foreach ($ch in $Text.ToCharArray()) {
      $c = [string]$ch
      if ($special.Contains($c)) { $c = '{' + $c + '}' }
      [System.Windows.Forms.SendKeys]::SendWait($c)
      Start-Sleep -Milliseconds (Get-Random -Min 34 -Max 82)
    }
  }

  'combo' {
    $map = @{ control=0x11; ctrl=0x11; shift=0x10; alt=0x12; enter=0x0D; return=0x0D;
              tab=0x09; esc=0x1B; escape=0x1B; f4=0x73; f5=0x74; f11=0x7A; win=0x5B }
    $keys = $Combo.Split('+') | ForEach-Object {
        $n = $_.Trim().ToLower()
        if ($map.ContainsKey($n)) { $map[$n] } else { [byte][char]::ToUpper($_.Trim()[0]) }
    }
    for ($i=0; $i -lt $keys.Count-1; $i++) { [NI]::keybd_event($keys[$i], 0, 0, 0); Start-Sleep -Milliseconds 25 }
    [NI]::keybd_event($keys[-1], 0, 0, 0);            Start-Sleep -Milliseconds 45
    [NI]::keybd_event($keys[-1], 0, 2, 0)
    for ($i=$keys.Count-2; $i -ge 0; $i--) { [NI]::keybd_event($keys[$i], 0, 2, 0) }
  }

  'key' {
    $map = @{ enter=0x0D; esc=0x1B; escape=0x1B; tab=0x09; f5=0x74; f11=0x7A }
    $n = $Combo.Trim().ToLower()
    $vk = if ($map.ContainsKey($n)) { $map[$n] } else { [byte][char]::ToUpper($n[0]) }
    [NI]::keybd_event($vk, 0, 0, 0); Start-Sleep -Milliseconds 40
    [NI]::keybd_event($vk, 0, 2, 0)
  }

  default { throw "Unknown action: $Action" }
}
