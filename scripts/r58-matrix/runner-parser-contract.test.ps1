#Requires -Version 5.1
# runner-parser-contract.test.ps1 — regression tests for the PowerShell runner
# consuming trial-parser.js. Verifies the stable result contract and that the
# runner defensively maps any parser failure to INVALID / PARSER_CONTRACT_ERROR.
#
# RUNNER-PARSER-CONTRACT-1..6
#
# Usage:
#   .\runner-parser-contract.test.ps1

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'parser-invoker.ps1')

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('rpc-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null

$fp = [string][char]0x3002  # U+3002 (。)

function Write-TextFile {
    param([string]$Path, [string]$Content)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function New-EventLine {
    param([int]$Ts, [string]$Event, [hashtable]$Payload)
    $obj = [ordered]@{ ts = $Ts; sessionId = 's'; buildId = 'b'; event = $Event; payload = $Payload }
    return ($obj | ConvertTo-Json -Compress)
}

function New-PassDelta {
    $lines = @(
        (New-EventLine -Ts 1 -Event 'KEYBOARD-EVENT-PROVENANCE' -Payload @{ key = 'Process'; code = 'Period'; isTrusted = $true }),
        (New-EventLine -Ts 2 -Event 'IME-SELECTION-AUDIT' -Payload @{ eventType = 'compositionstart'; inputType = 'none'; isComposing = $true; compositionSessionId = 'ime-1' }),
        (New-EventLine -Ts 3 -Event 'IME-SELECTION-AUDIT' -Payload @{ eventType = 'beforeinput'; inputType = 'insertCompositionText'; isComposing = $true; compositionSessionId = 'ime-1' }),
        (New-EventLine -Ts 4 -Event 'IME-SELECTION-AUDIT' -Payload @{ eventType = 'input'; inputType = 'input'; isComposing = $true; compositionSessionId = 'ime-1' }),
        (New-EventLine -Ts 5 -Event 'IME-SELECTION-AUDIT' -Payload @{ eventType = 'compositionend'; inputType = 'none'; isComposing = $false; compositionSessionId = 'ime-1' }),
        (New-EventLine -Ts 7 -Event 'TEXT-COMMIT-AUDIT' -Payload @{ compositionSessionId = 'ime-1'; commitSource = 'COMMIT+0'; visibleText = $fp; logicalOffset = 1 }),
        (New-EventLine -Ts 8 -Event 'POST-TEXT-INPUT-ARM' -Payload @{ generation = 1 }),
        (New-EventLine -Ts 9 -Event 'CARET-EXPECTATION-SUPERSESSION-AUDIT' -Payload @{ superseded = $true; restoreAttempted = $false }),
        (New-EventLine -Ts 10 -Event 'POST-TEXT-INPUT-STABILITY' -Payload @{ sample = 'COMMIT+50'; logicalOffset = 1; insideEditor = $true; visibleText = $fp }),
        (New-EventLine -Ts 11 -Event 'POST-TEXT-INPUT-STABILITY' -Payload @{ sample = 'COMMIT+150'; logicalOffset = 1; insideEditor = $true; visibleText = $fp }),
        (New-EventLine -Ts 12 -Event 'POST-TEXT-INPUT-STABILITY' -Payload @{ sample = 'COMMIT+300'; logicalOffset = 1; insideEditor = $true; visibleText = $fp }),
        (New-EventLine -Ts 13 -Event 'POST-TEXT-INPUT-STABILITY' -Payload @{ sample = 'COMMIT+500'; logicalOffset = 1; insideEditor = $true; visibleText = $fp }),
        (New-EventLine -Ts 14 -Event 'POST-TEXT-INPUT-STABILITY' -Payload @{ sample = 'COMMIT+1000'; logicalOffset = 1; insideEditor = $true; visibleText = $fp }),
        (New-EventLine -Ts 15 -Event 'POST-TEXT-INPUT-STABILITY' -Payload @{ sample = 'COMMIT+2200'; logicalOffset = 1; insideEditor = $true; visibleText = $fp }),
        (New-EventLine -Ts 16 -Event 'POST-TEXT-INPUT-COMPLETE' -Payload @{ activeObservationAfterComplete = 'none'; pendingCallbackCountAfterComplete = 0 }),
        (New-EventLine -Ts 17 -Event 'CANONICAL-VISUAL-VERIFY' -Payload @{ overall = $true }),
        (New-EventLine -Ts 18 -Event 'PROJECTION-VERIFY' -Payload @{ overall = $true }),
        (New-EventLine -Ts 19 -Event 'CANONICAL-TRANSFER-FINAL-AUDIT' -Payload @{ overall = $true }),
        (New-EventLine -Ts 20 -Event 'NORMAL-ENTER-FINAL' -Payload @{ overall = $true }),
        (New-EventLine -Ts 21 -Event 'AWAITING-TRANSFER-LEAK-AUDIT' -Payload @{ awaitingCount = 0 })
    )
    return ($lines -join "`n") + "`n"
}

function New-FailDelta {
    $lines = @(
        (New-EventLine -Ts 1 -Event 'KEYBOARD-EVENT-PROVENANCE' -Payload @{ key = 'Process'; code = 'Period'; isTrusted = $true }),
        (New-EventLine -Ts 2 -Event 'IME-SELECTION-AUDIT' -Payload @{ eventType = 'compositionstart'; inputType = 'none'; isComposing = $true; compositionSessionId = 'ime-1' }),
        (New-EventLine -Ts 3 -Event 'IME-SELECTION-AUDIT' -Payload @{ eventType = 'beforeinput'; inputType = 'insertCompositionText'; isComposing = $true; compositionSessionId = 'ime-1' }),
        (New-EventLine -Ts 4 -Event 'IME-SELECTION-AUDIT' -Payload @{ eventType = 'input'; inputType = 'input'; isComposing = $true; compositionSessionId = 'ime-1' }),
        (New-EventLine -Ts 5 -Event 'IME-SELECTION-AUDIT' -Payload @{ eventType = 'compositionend'; inputType = 'none'; isComposing = $false; compositionSessionId = 'ime-1' }),
        (New-EventLine -Ts 7 -Event 'TEXT-COMMIT-AUDIT' -Payload @{ compositionSessionId = 'ime-1'; commitSource = 'COMMIT+0'; visibleText = $fp; logicalOffset = 1 })
    )
    return ($lines -join "`n") + "`n"
}

# Fake parsers (CommonJS .cjs so `require` works regardless of package.json type).
$fakeMissingVerdict = @"
const fs = require('fs');
const a = process.argv.slice(2);
const i = a.indexOf('--out');
if (i >= 0 && a[i+1]) fs.writeFileSync(a[i+1], '{}');
process.exit(0);
"@

$fakeInvalidJson = @"
const fs = require('fs');
const a = process.argv.slice(2);
const i = a.indexOf('--out');
if (i >= 0 && a[i+1]) fs.writeFileSync(a[i+1], 'not json');
process.exit(0);
"@

$fakeNonzeroExit = @"
process.exit(1);
"@

function Write-FakeParser {
    param([string]$Path, [string]$Body)
    Write-TextFile -Path $Path -Content $Body
}

# ── Test harness ──────────────────────────────────────────────────────────────

$results = @()
function Add-Result {
    param([string]$Name, [bool]$Ok, [string]$Detail)
    $script:results += [pscustomobject]@{ name = $Name; ok = $Ok; detail = $Detail }
}

# 1. PASS envelope
$delta = Join-Path $tmpRoot 'pass.delta.jsonl'
$out = Join-Path $tmpRoot 'pass.out.json'
Write-TextFile -Path $delta -Content (New-PassDelta)
$v = Invoke-TrialParser -Type InputSmoke -Fixture 'x.md' -DeltaFile $delta -OutFile $out
$ok1 = ($v.verdict -eq 'PASS') -and ($v.type -eq 'InputSmoke') -and ($v.failedChecks.Count -eq 0)
Add-Result -Name 'RUNNER-PARSER-CONTRACT-1 (InputSmoke PASS envelope)' -Ok $ok1 -Detail "verdict=$($v.verdict)"

# 2. FAIL envelope
$delta2 = Join-Path $tmpRoot 'fail.delta.jsonl'
$out2 = Join-Path $tmpRoot 'fail.out.json'
Write-TextFile -Path $delta2 -Content (New-FailDelta)
$v2 = Invoke-TrialParser -Type InputSmoke -Fixture 'x.md' -DeltaFile $delta2 -OutFile $out2
$ok2 = ($v2.verdict -eq 'FAIL') -and ($v2.failedChecks.Count -gt 0)
Add-Result -Name 'RUNNER-PARSER-CONTRACT-2 (InputSmoke FAIL envelope)' -Ok $ok2 -Detail "verdict=$($v2.verdict)"

# 3. INVALID envelope (empty delta → INPUT_PROVENANCE_MISMATCH)
$delta3 = Join-Path $tmpRoot 'invalid.delta.jsonl'
$out3 = Join-Path $tmpRoot 'invalid.out.json'
Write-TextFile -Path $delta3 -Content ''
$v3 = Invoke-TrialParser -Type InputSmoke -Fixture 'x.md' -DeltaFile $delta3 -OutFile $out3
$ok3 = ($v3.verdict -eq 'INVALID') -and ($v3.invalidReason -ne 'PARSER_CONTRACT_ERROR')
Add-Result -Name 'RUNNER-PARSER-CONTRACT-3 (InputSmoke INVALID envelope)' -Ok $ok3 -Detail "verdict=$($v3.verdict) reason=$($v3.invalidReason)"

# 4. missing verdict → INVALID / PARSER_CONTRACT_ERROR
$fake4 = Join-Path $tmpRoot 'fake-missing-verdict.cjs'
Write-FakeParser -Path $fake4 -Body $fakeMissingVerdict
$out4 = Join-Path $tmpRoot 'missing.out.json'
$v4 = Invoke-TrialParser -Type InputSmoke -Fixture 'x.md' -DeltaFile $delta3 -OutFile $out4 -ParserJs $fake4
$ok4 = ($v4.verdict -eq 'INVALID') -and ($v4.invalidReason -eq 'PARSER_CONTRACT_ERROR')
Add-Result -Name 'RUNNER-PARSER-CONTRACT-4 (missing verdict)' -Ok $ok4 -Detail "verdict=$($v4.verdict) reason=$($v4.invalidReason)"

# 5. parser invalid JSON → INVALID / PARSER_CONTRACT_ERROR
$fake5 = Join-Path $tmpRoot 'fake-invalid-json.cjs'
Write-FakeParser -Path $fake5 -Body $fakeInvalidJson
$out5 = Join-Path $tmpRoot 'invalidjson.out.json'
$v5 = Invoke-TrialParser -Type InputSmoke -Fixture 'x.md' -DeltaFile $delta3 -OutFile $out5 -ParserJs $fake5
$ok5 = ($v5.verdict -eq 'INVALID') -and ($v5.invalidReason -eq 'PARSER_CONTRACT_ERROR')
Add-Result -Name 'RUNNER-PARSER-CONTRACT-5 (parser invalid JSON)' -Ok $ok5 -Detail "verdict=$($v5.verdict) reason=$($v5.invalidReason)"

# 6. parser nonzero exit → INVALID / PARSER_CONTRACT_ERROR
$fake6 = Join-Path $tmpRoot 'fake-nonzero-exit.cjs'
Write-FakeParser -Path $fake6 -Body $fakeNonzeroExit
$out6 = Join-Path $tmpRoot 'nonzero.out.json'
$v6 = Invoke-TrialParser -Type InputSmoke -Fixture 'x.md' -DeltaFile $delta3 -OutFile $out6 -ParserJs $fake6
$ok6 = ($v6.verdict -eq 'INVALID') -and ($v6.invalidReason -eq 'PARSER_CONTRACT_ERROR')
Add-Result -Name 'RUNNER-PARSER-CONTRACT-6 (parser nonzero exit)' -Ok $ok6 -Detail "verdict=$($v6.verdict) reason=$($v6.invalidReason)"

# ── Summary ────────────────────────────────────────────────────────────────────
$passCount = @($results | Where-Object { $_.ok }).Count
foreach ($r in $results) {
    Write-Host ("{0} = {1} ({2})" -f $r.name, $(if ($r.ok) { 'PASS' } else { 'FAIL' }), $r.detail)
}
Write-Host ("RUNNER-PARSER-CONTRACT TOTAL = {0}/6 PASS" -f $passCount)

Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue

if ($passCount -ne 6) { throw 'RUNNER-PARSER-CONTRACT tests FAILED' }
