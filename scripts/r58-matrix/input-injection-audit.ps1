#Requires -Version 5.1
# input-injection-audit.ps1 — Runner-only SendInput injection audit + gate.
#
# The previous InputSmoke treated "SendInput did not throw" as success. This is
# incorrect: SendInput returns the number of INPUT events actually inserted, and
# 0/partial insertion is a real failure. This module records the injection and
# exposes a pure gate function so the failure is detected deterministically.
#
# INPUT-INJECTION-AUDIT fields:
#   targetPid, targetHwnd, foregroundHwndBefore, foregroundMatchBefore,
#   requestedInputCount, sendInputReturnCount, foregroundHwndAfter,
#   injectionAttempted, injectionSucceeded

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'r58-input-injector.ps1')

# A1 / InputSmoke key sequence: Period Period Enter Enter Period (5 logical keys).
function Get-R58InputSmokeKeys {
    return [uint16[]]@($script:VK_OEM_PERIOD, $script:VK_OEM_PERIOD, $script:VK_RETURN, $script:VK_RETURN, $script:VK_OEM_PERIOD)
}

# Perform an audited SendInput injection. Each logical key press inserts 2 INPUT
# events (down + up); a key press counts as "returned" only when SendInput == 2.
function Invoke-R58InputInjectionAudit {
    param(
        [Parameter(Mandatory = $true)][int]$TargetPid,
        [Parameter(Mandatory = $true)][IntPtr]$TargetHwnd,
        [Parameter(Mandatory = $true)][uint16[]]$Keys,
        [int]$InterKeyDelayMs = 120
    )
    $audit = [ordered]@{
        targetPid = $TargetPid
        targetHwnd = $TargetHwnd
        foregroundHwndBefore = [IntPtr]::Zero
        foregroundMatchBefore = $false
        requestedInputCount = 0
        sendInputReturnCount = 0
        foregroundHwndAfter = [IntPtr]::Zero
        injectionAttempted = $false
        injectionSucceeded = $false
    }

    $audit.foregroundHwndBefore = Get-R58ForegroundWindow
    $audit.foregroundMatchBefore = ($audit.foregroundHwndBefore -eq $TargetHwnd)

    $null = Set-R58ForegroundWindow -HWND $TargetHwnd
    Start-Sleep -Milliseconds 300

    $audit.requestedInputCount = $Keys.Count
    foreach ($k in $Keys) {
        $audit.injectionAttempted = $true
        $sent = Send-R58VkKey -Vk $k
        if ($sent -eq 2) { $audit.sendInputReturnCount++ }
        if ($InterKeyDelayMs -gt 0) { Start-Sleep -Milliseconds $InterKeyDelayMs }
    }

    Start-Sleep -Milliseconds 200
    $audit.foregroundHwndAfter = Get-R58ForegroundWindow
    $audit.injectionSucceeded = ($audit.sendInputReturnCount -eq $audit.requestedInputCount)

    return [pscustomobject]$audit
}

# Pure gate over an INPUT-INJECTION-AUDIT object. Returns PASS or an INVALID envelope.
function Test-R58InputInjectionGate {
    param([pscustomobject]$Audit)
    if ($null -eq $Audit) {
        return [pscustomobject]@{ verdict = 'INVALID'; invalidReason = 'SENDINPUT_PARTIAL_OR_FAILED' }
    }
    if (-not $Audit.foregroundMatchBefore) {
        return [pscustomobject]@{ verdict = 'INVALID'; invalidReason = 'FOREGROUND_WINDOW_MISMATCH' }
    }
    if (-not $Audit.injectionAttempted) {
        return [pscustomobject]@{ verdict = 'INVALID'; invalidReason = 'SENDINPUT_PARTIAL_OR_FAILED' }
    }
    if ($Audit.sendInputReturnCount -ne $Audit.requestedInputCount) {
        return [pscustomobject]@{ verdict = 'INVALID'; invalidReason = 'SENDINPUT_PARTIAL_OR_FAILED' }
    }
    if (-not $Audit.injectionSucceeded) {
        return [pscustomobject]@{ verdict = 'INVALID'; invalidReason = 'SENDINPUT_PARTIAL_OR_FAILED' }
    }
    return [pscustomobject]@{ verdict = 'PASS' }
}
