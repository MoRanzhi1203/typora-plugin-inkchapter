#Requires -Version 5.1
# r58-input-injector.ps1
# Real OS input injection via user32!SendInput (external black-box, no DOM).
# The Chinese fullwidth period U+3002 is produced by sending the physical
# Period key while the active IME is in Chinese mode. This is the ONLY path
# that yields `key=Process code=Period isTrusted=true` in the renderer.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ── user32 P/Invoke (single load guard) ───────────────────────────────────────
if (-not ('R58InputNative' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class R58InputNative {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }
}
"@
}

# ── Key constants ──────────────────────────────────────────────────────────────
$script:VK_RETURN = 0x0D
$script:VK_OEM_PERIOD = 0xBE
$script:INPUT_KEYBOARD = 1
$script:KEYEVENTF_KEYUP = 0x0002
$script:KEYEVENTF_SCANCODE = 0x0008

# ── Focus the Typora main window ──────────────────────────────────────────────
function Set-R58ForegroundWindow {
    param([Parameter(Mandatory = $true)][IntPtr]$HWND)
    if ($HWND -eq [IntPtr]::Zero) { return $false }
    [R58InputNative]::BringWindowToTop($HWND) | Out-Null
    $ok = [R58InputNative]::SetForegroundWindow($HWND)
    Start-Sleep -Milliseconds 250
    return $ok
}

function Get-R58ForegroundWindow {
    return [R58InputNative]::GetForegroundWindow()
}

# ── Send a single virtual-key press (down + up) ────────────────────────────────
function Send-R58VkKey {
    param([uint16]$Vk)
    $size = [System.Runtime.InteropServices.Marshal]::SizeOf([type][R58InputNative+INPUT])

    $down = New-Object R58InputNative+INPUT
    $down.type = $script:INPUT_KEYBOARD
    $down.U.ki.wVk = $Vk
    $down.U.ki.wScan = 0
    $down.U.ki.dwFlags = 0
    $down.U.ki.time = 0
    $down.U.ki.dwExtraInfo = [IntPtr]::Zero

    $up = New-Object R58InputNative+INPUT
    $up.type = $script:INPUT_KEYBOARD
    $up.U.ki.wVk = $Vk
    $up.U.ki.wScan = 0
    $up.U.ki.dwFlags = $script:KEYEVENTF_KEYUP
    $up.U.ki.time = 0
    $up.U.ki.dwExtraInfo = [IntPtr]::Zero

    $sent = [R58InputNative]::SendInput(2, [R58InputNative+INPUT[]]@($down, $up), $size)
    return $sent
}

# ── Send the full A1 keystroke sequence: 。。 Enter Enter 。 ────────────────────
# Chinese fullwidth periods are emitted by pressing the physical Period key
# while the active IME is in Chinese punctuation mode. This is the user-equivalent
# action; the IME converts each Period key into U+3002 and the renderer sees
# key=Process code=Period isTrusted=true with a composition chain.
function Invoke-R58A1Keystrokes {
    param(
        [Parameter(Mandatory = $true)][IntPtr]$HWND,
        [int]$PeriodDelayMs = 120,
        [int]$EnterDelayMs = 200,
        [int]$FinalPauseMs = 0
    )
    $focus = Set-R58ForegroundWindow -HWND $HWND
    if (-not $focus) {
        throw "SetForegroundWindow failed for HWND=$HWND"
    }
    Start-Sleep -Milliseconds 500

    # 1st 。。
    Send-R58VkKey -Vk $script:VK_OEM_PERIOD | Out-Null
    Start-Sleep -Milliseconds $PeriodDelayMs
    # 2nd 。
    Send-R58VkKey -Vk $script:VK_OEM_PERIOD | Out-Null
    Start-Sleep -Milliseconds $PeriodDelayMs

    # Enter (SPECIAL_COMMAND — consumes 。。)
    Send-R58VkKey -Vk $script:VK_RETURN | Out-Null
    Start-Sleep -Milliseconds $EnterDelayMs

    # Enter (NORMAL_ENTER — produces SPLIT_NEW_PARAGRAPH expectation)
    Send-R58VkKey -Vk $script:VK_RETURN | Out-Null
    Start-Sleep -Milliseconds $EnterDelayMs

    # 立即输入 。 (final period → supersedes SPLIT expectation → POST-TEXT-INPUT-ARM)
    Send-R58VkKey -Vk $script:VK_OEM_PERIOD | Out-Null

    if ($FinalPauseMs -gt 0) {
        Start-Sleep -Milliseconds $FinalPauseMs
    }
    return $true
}
