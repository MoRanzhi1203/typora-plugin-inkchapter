#Requires -Version 5.1
# input-inject.test.ps1 — Runner-only regression tests for the SendInput
# injection gate. Pure logic: no real window / SendInput required.
#
# INPUT-INJECT-1..4
#
# Usage:
#   .\input-inject.test.ps1

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'input-injection-audit.ps1')

# Sanity: the A1/InputSmoke key sequence must be exactly 5 logical keys.
$smokeKeys = Get-R58InputSmokeKeys
if ($smokeKeys.Count -ne 5) { throw "Get-R58InputSmokeKeys expected 5 keys, got $($smokeKeys.Count)" }


function New-Audit {
    param(
        [bool]$ForegroundMatch,
        [int]$Requested,
        [int]$Returned,
        [bool]$Attempted = $true,
        [bool]$Succeeded
    )
    return [pscustomobject]@{
        targetPid = 1
        targetHwnd = [IntPtr]::new(1)
        foregroundHwndBefore = [IntPtr]::Zero
        foregroundMatchBefore = $ForegroundMatch
        requestedInputCount = $Requested
        sendInputReturnCount = $Returned
        foregroundHwndAfter = [IntPtr]::Zero
        injectionAttempted = $Attempted
        injectionSucceeded = $Succeeded
    }
}

$results = @()
function Add-Result {
    param([string]$Name, [bool]$Ok, [string]$Detail)
    $script:results += [pscustomobject]@{ name = $Name; ok = $Ok; detail = $Detail }
}

# 1. requested=5 returned=5 → PASS
$r1 = Test-R58InputInjectionGate -Audit (New-Audit -ForegroundMatch $true -Requested 5 -Returned 5 -Succeeded $true)
Add-Result -Name 'INPUT-INJECT-1 (requested=5 returned=5)' -Ok ($r1.verdict -eq 'PASS') -Detail "verdict=$($r1.verdict)"

# 2. requested=5 returned=0 → INVALID / SENDINPUT_PARTIAL_OR_FAILED
$r2 = Test-R58InputInjectionGate -Audit (New-Audit -ForegroundMatch $true -Requested 5 -Returned 0 -Succeeded $false)
Add-Result -Name 'INPUT-INJECT-2 (requested=5 returned=0)' -Ok ($r2.verdict -eq 'INVALID' -and $r2.invalidReason -eq 'SENDINPUT_PARTIAL_OR_FAILED') -Detail "verdict=$($r2.verdict) reason=$($r2.invalidReason)"

# 3. requested=5 returned=3 → INVALID / SENDINPUT_PARTIAL_OR_FAILED
$r3 = Test-R58InputInjectionGate -Audit (New-Audit -ForegroundMatch $true -Requested 5 -Returned 3 -Succeeded $false)
Add-Result -Name 'INPUT-INJECT-3 (requested=5 returned=3)' -Ok ($r3.verdict -eq 'INVALID' -and $r3.invalidReason -eq 'SENDINPUT_PARTIAL_OR_FAILED') -Detail "verdict=$($r3.verdict) reason=$($r3.invalidReason)"

# 4. foreground mismatch → INVALID / FOREGROUND_WINDOW_MISMATCH
$r4 = Test-R58InputInjectionGate -Audit (New-Audit -ForegroundMatch $false -Requested 5 -Returned 5 -Succeeded $true)
Add-Result -Name 'INPUT-INJECT-4 (foreground mismatch)' -Ok ($r4.verdict -eq 'INVALID' -and $r4.invalidReason -eq 'FOREGROUND_WINDOW_MISMATCH') -Detail "verdict=$($r4.verdict) reason=$($r4.invalidReason)"

$passCount = @($results | Where-Object { $_.ok }).Count
foreach ($r in $results) {
    Write-Host ("{0} = {1} ({2})" -f $r.name, $(if ($r.ok) { 'PASS' } else { 'FAIL' }), $r.detail)
}
Write-Host ("INPUT-INJECT TOTAL = {0}/4 PASS" -f $passCount)

if ($passCount -ne 4) { throw 'INPUT-INJECT tests FAILED' }
