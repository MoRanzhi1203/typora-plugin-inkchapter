#Requires -Version 5.1
# window-input.ps1 — real Windows input via user32 SetForegroundWindow/GetForegroundWindow/SendInput.
# Reuses the verified r58-input-injector.ps1 primitives (single source of truth).

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'r58-input-injector.ps1')

# Re-export under final-matrix naming.
function Focus-TyporaWindow { param([Parameter(Mandatory = $true)][IntPtr]$HWND) Set-R58ForegroundWindow -HWND $HWND }
function Get-ForegroundWindowHandle { Get-R58ForegroundWindow }
function Send-PhysicalKey { param([uint16]$Vk) Send-R58VkKey -Vk $Vk }
function Invoke-A1Keystrokes { param([IntPtr]$HWND) Invoke-R58A1Keystrokes -HWND $HWND }

# A2: ordinary paragraph + Enter + final period (NO special canonical command).
function Invoke-A2Keystrokes {
    param([Parameter(Mandatory = $true)][IntPtr]$HWND)
    Focus-TyporaWindow -HWND $HWND | Out-Null
    Start-Sleep -Milliseconds 400
    # Type ordinary text "abc" (physical letter keys) to avoid the 。。 special command.
    foreach ($ch in @('A', 'B', 'C')) {
        Send-PhysicalKey -Vk ([int][char]$ch) | Out-Null
        Start-Sleep -Milliseconds 100
    }
    # Enter (normal enter, no special command)
    Send-PhysicalKey -Vk 0x0D | Out-Null
    Start-Sleep -Milliseconds 200
    # Final period (IME produces 。)
    Send-PhysicalKey -Vk 0xBE | Out-Null
    return $true
}

# A3: 。。 Enter Enter, then NO text (split only).
function Invoke-A3Keystrokes {
    param([Parameter(Mandatory = $true)][IntPtr]$HWND)
    Focus-TyporaWindow -HWND $HWND | Out-Null
    Start-Sleep -Milliseconds 400
    Send-PhysicalKey -Vk 0xBE | Out-Null; Start-Sleep -Milliseconds 120
    Send-PhysicalKey -Vk 0xBE | Out-Null; Start-Sleep -Milliseconds 120
    Send-PhysicalKey -Vk 0x0D | Out-Null; Start-Sleep -Milliseconds 200
    Send-PhysicalKey -Vk 0x0D | Out-Null
    return $true
}
