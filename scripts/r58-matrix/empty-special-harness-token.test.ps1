#Requires -Version 5.1
# empty-special-harness-token.test.ps1 — tests the harness token proof logic
# (P0-D): the committed token must be U+3002 U+3002 (。。) with IME provenance
# BEFORE Enter is allowed.
#
# HARNESS-TOKEN-1..2
#
# Usage:
#   .\empty-special-harness-token.test.ps1

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'forensic-file-collector.ps1')

# Mirror of Test-EmptySpecialTokenProvenance (kept here so the test is self-contained).
function Test-EmptySpecialTokenProvenanceLocal {
    param([string]$Path, [long]$OffsetBefore = 0)
    $fullwidth = [string][char]0x3002
    $token2 = $fullwidth + $fullwidth
    if (-not (Test-Path -LiteralPath $Path)) {
        return [pscustomobject]@{ verdict = 'INVALID'; invalidReason = 'SPECIAL_TOKEN_PROVENANCE_MISMATCH'; tokenText = $null; logicalOffset = $null; imeProvenance = $false }
    }
    $len = (Get-Item -LiteralPath $Path).Length
    if ($len -le $OffsetBefore) {
        return [pscustomobject]@{ verdict = 'INVALID'; invalidReason = 'SPECIAL_TOKEN_PROVENANCE_MISMATCH'; tokenText = $null; logicalOffset = $null; imeProvenance = $false }
    }
    $delta = Read-R58AuditDeltaRaw -Path $Path -OffsetBefore $OffsetBefore -OffsetAfter $len
    $events = @(ConvertFrom-R58JsonLines -Text $delta)

    $ime = @($events | Where-Object { $_.event -eq 'IME-SELECTION-AUDIT' })
    $hasCompStart = @($ime | Where-Object { (Get-R58EventField -Event $_ -Name 'eventType') -eq 'compositionstart' }).Count -gt 0
    $hasBeforeInputComp = @($ime | Where-Object { (Get-R58EventField -Event $_ -Name 'eventType') -eq 'beforeinput' -and (Get-R58EventField -Event $_ -Name 'inputType') -eq 'insertCompositionText' }).Count -gt 0
    $hasInput = @($ime | Where-Object { (Get-R58EventField -Event $_ -Name 'eventType') -eq 'input' }).Count -gt 0
    $hasCompEnd = @($ime | Where-Object { (Get-R58EventField -Event $_ -Name 'eventType') -eq 'compositionend' }).Count -gt 0
    $imeProvenance = ($hasCompStart -and $hasBeforeInputComp -and $hasInput -and $hasCompEnd)

    $commit = @($events | Where-Object { $_.event -eq 'TEXT-COMMIT-AUDIT' } | Select-Object -Last 1)
    $visibleText = if ($commit.Count -gt 0) { Get-R58EventField -Event $commit[0] -Name 'visibleText' } else { $null }
    $logicalOffset = if ($commit.Count -gt 0) { Get-R58EventField -Event $commit[0] -Name 'logicalOffset' } else { $null }

    $tokenOk = ($visibleText -eq $token2) -and ($logicalOffset -eq 2)
    if ($imeProvenance -and $tokenOk) {
        return [pscustomobject]@{ verdict = 'PASS'; invalidReason = $null; tokenText = $visibleText; logicalOffset = $logicalOffset; imeProvenance = $true }
    }
    return [pscustomobject]@{ verdict = 'INVALID'; invalidReason = 'SPECIAL_TOKEN_PROVENANCE_MISMATCH'; tokenText = $visibleText; logicalOffset = $logicalOffset; imeProvenance = $imeProvenance }
}

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('esp-token-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function New-Line {
    param([int]$Ts, [string]$Event, [hashtable]$Payload)
    $obj = [ordered]@{ ts = $Ts; sessionId = 's1'; buildId = 'b1'; event = $Event; payload = $Payload }
    return ($obj | ConvertTo-Json -Compress)
}

function New-TokenDelta {
    param([string]$VisibleText)
    $fp = [string][char]0x3002
    $lines = @(
        (New-Line 1 'IME-SELECTION-AUDIT' @{ eventType = 'compositionstart'; inputType = 'none'; isComposing = $true }),
        (New-Line 2 'IME-SELECTION-AUDIT' @{ eventType = 'beforeinput'; inputType = 'insertCompositionText'; isComposing = $true }),
        (New-Line 3 'IME-SELECTION-AUDIT' @{ eventType = 'input'; inputType = 'input'; isComposing = $true }),
        (New-Line 4 'IME-SELECTION-AUDIT' @{ eventType = 'compositionend'; inputType = 'none'; isComposing = $false }),
        (New-Line 5 'TEXT-COMMIT-AUDIT' @{ visibleText = $VisibleText; logicalOffset = $VisibleText.Length })
    )
    return ($lines -join "`n") + "`n"
}

$results = @()
function Add-Result {
    param([string]$Name, [bool]$Ok, [string]$Detail)
    $script:results += [pscustomobject]@{ name = $Name; ok = $Ok; detail = $Detail }
}

try {
    $fp = [string][char]0x3002
    $token2 = $fp + $fp

    # HARNESS-TOKEN-1: valid IME provenance + "。。" → Enter allowed (PASS)
    $d1 = Join-Path $tmpRoot 'good.jsonl'
    Write-Utf8NoBom -Path $d1 -Content (New-TokenDelta -VisibleText $token2)
    $v1 = Test-EmptySpecialTokenProvenanceLocal -Path $d1
    Add-Result -Name 'HARNESS-TOKEN-1 (U+3002 + IME provenance → Enter allowed)' -Ok ($v1.verdict -eq 'PASS') -Detail "verdict=$($v1.verdict) tokenText=$($v1.tokenText)"

    # HARNESS-TOKEN-2: ".." (ASCII) → INVALID, Enter NOT allowed
    $d2 = Join-Path $tmpRoot 'bad.jsonl'
    Write-Utf8NoBom -Path $d2 -Content (New-TokenDelta -VisibleText '..')
    $v2 = Test-EmptySpecialTokenProvenanceLocal -Path $d2
    Add-Result -Name 'HARNESS-TOKEN-2 (ASCII ".." → INVALID, SendEnter=0)' -Ok ($v2.verdict -eq 'INVALID') -Detail "verdict=$($v2.verdict) reason=$($v2.invalidReason)"
} finally {
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$passCount = @($results | Where-Object { $_.ok }).Count
foreach ($r in $results) {
    Write-Host ("{0} = {1} ({2})" -f $r.name, $(if ($r.ok) { 'PASS' } else { 'FAIL' }), $r.detail)
}
Write-Host ("EMPTY-SPECIAL-HARNESS-TOKEN TOTAL = {0}/2 PASS" -f $passCount)

if ($passCount -ne 2) { throw 'EMPTY-SPECIAL-HARNESS-TOKEN tests FAILED' }
