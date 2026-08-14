#Requires -Version 5.1
# empty-special-parser-contract.test.ps1 — regression tests for
# empty-special-trial-parser.js. Exercises every verdict path:
#   PASS, INVALID (arm precondition / order / transaction / mutation), FAIL.
#
# EMPTY-SPECIAL-PARSER-CONTRACT-1..12
#
# Usage:
#   .\empty-special-parser-contract.test.ps1

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$ParserJs = Join-Path $PSScriptRoot 'empty-special-trial-parser.js'

function Get-NodePath {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $node) { return $null }
    return $node.Source
}

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('esp-' + [Guid]::NewGuid().ToString('N'))
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

# Base E2 delta. Each override mutates the named section payload.
function New-E2Lines {
    param(
        [hashtable]$Arm,
        [hashtable]$TokenConsumed,
        [hashtable]$DomNorm,
        [hashtable]$Settle,
        [hashtable]$Geometry,
        [hashtable]$Final,
        [hashtable]$Routing = @{ txnId = 'txn-e2-1'; admissionDecision = 'ALLOW_SPECIAL_COMMAND'; selectedPath = 'EMPTY_SPECIAL' },
        [hashtable]$Close = @{ txnId = 'txn-e2-1'; finalState = 'COMMITTED'; observerDisconnected = $true; activeTxnCleared = $true; terminal = $true; overall = $true },
        [bool]$DuplicatePre = $false,
        [string]$FinalTxnIdOverride = ''
    )
    $txn = 'txn-e2-1'
    $finalTxn = if ($FinalTxnIdOverride -eq '') { $txn } else { $FinalTxnIdOverride }

    $lines = @(
        (New-Line 1 'EMPTY-SPECIAL-MUTATION-WINDOW-ARM' $Arm),
        (New-Line 2 'EMPTY-SPECIAL-PRE' @{ txnId = $txn; sourceRuntimeId = 'rt-c'; previousRuntimeId = 'rt-text'; nextRuntimeId = $null; paragraphCountBefore = 2; sourceOrdinal = 1 }),
        (New-Line 3 'EMPTY-SPECIAL-TOKEN-CONSUMED' $TokenConsumed),
        (New-Line 4 'EMPTY-SPECIAL-DOM-NORMALIZATION' $DomNorm),
        (New-Line 5 'EMPTY-SPECIAL-SETTLE-AUDIT' $Settle),
        (New-Line 6 'EMPTY-SPECIAL-STRUCTURAL-RESOLUTION' @{ txnId = $txn; decision = 'SAME_NODE'; candidateCount = 1 }),
        (New-Line 7 'EMPTY-SPECIAL-CANONICAL-COMMIT' @{ txnId = $txn; recordId = 'rec-1'; decision = 'UPDATE_EXISTING'; success = $true }),
        (New-Line 8 'EMPTY-SPECIAL-CARET-VERIFY' @{ txnId = $txn; caretLogicalCorrect = $true }),
        (New-Line 9 'EMPTY-SPECIAL-CARET-GEOMETRY' $Geometry),
        (New-Line 10 'EMPTY-SPECIAL-VISUAL-VERIFY' @{ txnId = $txn; semanticCorrect = $true; visualIndentCorrect = $true }),
        (New-Line 11 'EMPTY-SPECIAL-FINAL' $Final),
        (New-Line 12 'EMPTY-SPECIAL-TRANSACTION-CLOSE' $Close),
        (New-Line 13 'SPECIAL-COMMAND-ROUTING-AUDIT' $Routing)
    )
    if ($DuplicatePre) {
        $lines = @($lines[0], $lines[1], $lines[1], $lines[2], $lines[3], $lines[4], $lines[5], $lines[6], $lines[7], $lines[8], $lines[9], $lines[10], $lines[11], $lines[12])
    }
    return ($lines -join "`n") + "`n"
}

# Defaults (full PASS).
$baseArm = @{ txnId = 'txn-e2-1'; observerRootConnectedAtArm = $true; observerRootContainsSourceAtArm = $true; sourceConnectedAtArm = $true; observerRootIsCurrentEditorRoot = $true; observerArmedAt = 100; decision = 'ARMED' }
$baseToken = @{ txnId = 'txn-e2-1'; tokenConsumedAt = 200 }
$baseDomNorm = @{ txnId = 'txn-e2-1'; decision = 'NORMALIZED_TO_NATIVE_EMPTY'; nativeEmptyEquivalentAfter = $true; overall = $true; markdownContentChanged = $false }
$baseSettle = @{ txnId = 'txn-e2-1'; observerArmedBeforeTokenConsume = $true; relevantMutationCount = 2; quietBoundaryReached = $true; decision = 'SETTLED_BY_MUTATION_QUIET' }
$baseGeometry = @{ txnId = 'txn-e2-1'; expectedIndentPx = 32; actualCaretIndentPx = 32; overall = $true }
$baseFinal = @{ txnId = 'txn-e2-1'; overall = $true; logicalSlotPreserved = $true; paragraphCountPreserved = $true; canonicalOwnerCorrect = $true; semanticCorrect = $true; visualIndentCorrect = $true; caretLogicalCorrect = $true; caretVisualCorrect = $true; unexpectedMerge = $false; unexpectedDelete = $false }
$baseClose = @{ txnId = 'txn-e2-1'; finalState = 'COMMITTED'; observerDisconnected = $true; activeTxnCleared = $true; terminal = $true; overall = $true }
$baseRouting = @{ txnId = 'txn-e2-1'; admissionDecision = 'ALLOW_SPECIAL_COMMAND'; selectedPath = 'EMPTY_SPECIAL' }

$results = @()
function Add-Result {
    param([string]$Name, [bool]$Ok, [string]$Detail)
    $script:results += [pscustomobject]@{ name = $Name; ok = $Ok; detail = $Detail }
}

function Run-Case {
    param([string]$Name, [string]$Delta, [string]$ExpectedVerdict, [string]$ExpectedReason)
    $d = Join-Path $tmpRoot (($Name -replace '[^a-zA-Z0-9]', '') + '.jsonl')
    $o = Join-Path $tmpRoot (($Name -replace '[^a-zA-Z0-9]', '') + '.out.json')
    Write-Utf8NoBom -Path $d -Content $Delta
    $node = Get-NodePath
    if ($null -eq $node) { throw 'node not available' }
    $null = & $node $ParserJs --type E2 --fixture 'f.md' --delta $d --out $o 2>&1
    $v = Get-Content -LiteralPath $o -Raw | ConvertFrom-Json
    $ok = ($v.verdict -eq $ExpectedVerdict) -and ($ExpectedReason -eq '' -or $v.invalidReason -eq $ExpectedReason)
    Add-Result -Name $Name -Ok $ok -Detail "verdict=$($v.verdict) reason=$($v.invalidReason)"
}

try {
    # 1. Full PASS
    $delta = New-E2Lines -Arm $baseArm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $baseSettle -Geometry $baseGeometry -Final $baseFinal
    Run-Case 'EMPTY-SPECIAL-PARSER-CONTRACT-1 (full PASS)' $delta 'PASS' ''

    # 2. root disconnected
    $arm = $baseArm.Clone(); $arm.observerRootConnectedAtArm = $false
    Run-Case 'EMPTY-SPECIAL-PARSER-CONTRACT-2 (root disconnected)' (New-E2Lines -Arm $arm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $baseSettle -Geometry $baseGeometry -Final $baseFinal) 'INVALID' 'OBSERVER_ARM_PRECONDITION_FAILED'

    # 3. root does not contain source
    $arm = $baseArm.Clone(); $arm.observerRootContainsSourceAtArm = $false
    Run-Case 'EMPTY-SPECIAL-PARSER-CONTRACT-3 (root not contain source)' (New-E2Lines -Arm $arm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $baseSettle -Geometry $baseGeometry -Final $baseFinal) 'INVALID' 'OBSERVER_ARM_PRECONDITION_FAILED'

    # 4. source disconnected at arm
    $arm = $baseArm.Clone(); $arm.sourceConnectedAtArm = $false
    Run-Case 'EMPTY-SPECIAL-PARSER-CONTRACT-4 (source disconnected at arm)' (New-E2Lines -Arm $arm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $baseSettle -Geometry $baseGeometry -Final $baseFinal) 'INVALID' 'OBSERVER_ARM_PRECONDITION_FAILED'

    # 5. arm timestamp >= token timestamp
    $arm = $baseArm.Clone(); $arm.observerArmedAt = 300
    $tok = $baseToken.Clone(); $tok.tokenConsumedAt = 100
    Run-Case 'EMPTY-SPECIAL-PARSER-CONTRACT-5 (arm>=token)' (New-E2Lines -Arm $arm -TokenConsumed $tok -DomNorm $baseDomNorm -Settle $baseSettle -Geometry $baseGeometry -Final $baseFinal) 'INVALID' 'OBSERVER_ARM_ORDER_INVALID'

    # 6. duplicate PRE
    Run-Case 'EMPTY-SPECIAL-PARSER-CONTRACT-6 (duplicate PRE)' (New-E2Lines -Arm $baseArm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $baseSettle -Geometry $baseGeometry -Final $baseFinal -DuplicatePre $true) 'INVALID' 'TRIAL_TRANSACTION_AMBIGUOUS'

    # 7. txnId mismatch (FINAL)
    $fin = $baseFinal.Clone(); $fin.txnId = 'txn-OTHER'
    Run-Case 'EMPTY-SPECIAL-PARSER-CONTRACT-7 (txnId mismatch)' (New-E2Lines -Arm $baseArm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $baseSettle -Geometry $baseGeometry -Final $fin) 'INVALID' 'TRIAL_TRANSACTION_AMBIGUOUS'

    # 8. DOM normalization fail (BLOCK_UNSAFE_STRUCTURE)
    $dn = $baseDomNorm.Clone(); $dn.decision = 'BLOCK_UNSAFE_STRUCTURE'; $dn.nativeEmptyEquivalentAfter = $false; $dn.overall = $false
    Run-Case 'EMPTY-SPECIAL-PARSER-CONTRACT-8 (dom normalization fail)' (New-E2Lines -Arm $baseArm -TokenConsumed $baseToken -DomNorm $dn -Settle $baseSettle -Geometry $baseGeometry -Final $baseFinal) 'FAIL' ''

    # 9. TIMEOUT_BLOCK
    $st = $baseSettle.Clone(); $st.decision = 'TIMEOUT_BLOCK'; $st.quietBoundaryReached = $false
    $fin = $baseFinal.Clone(); $fin.overall = $false
    Run-Case 'EMPTY-SPECIAL-PARSER-CONTRACT-9 (TIMEOUT_BLOCK)' (New-E2Lines -Arm $baseArm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $st -Geometry $baseGeometry -Final $fin) 'FAIL' ''

    # 10. geometry fail
    $g = $baseGeometry.Clone(); $g.actualCaretIndentPx = 0; $g.overall = $false
    Run-Case 'EMPTY-SPECIAL-PARSER-CONTRACT-10 (geometry fail)' (New-E2Lines -Arm $baseArm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $baseSettle -Geometry $g -Final $baseFinal) 'FAIL' ''

    # 11. FINAL fail (caretVisualCorrect=false)
    $fin = $baseFinal.Clone(); $fin.caretVisualCorrect = $false; $fin.overall = $false
    Run-Case 'EMPTY-SPECIAL-PARSER-CONTRACT-11 (FINAL fail)' (New-E2Lines -Arm $baseArm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $baseSettle -Geometry $baseGeometry -Final $fin) 'FAIL' ''

    # 12. mutationCount=0
    $st = $baseSettle.Clone(); $st.relevantMutationCount = 0; $st.quietBoundaryReached = $false; $st.decision = 'SETTLED_NO_RELEVANT_MUTATION'
    Run-Case 'EMPTY-SPECIAL-PARSER-CONTRACT-12 (mutationCount=0)' (New-E2Lines -Arm $baseArm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $st -Geometry $baseGeometry -Final $baseFinal) 'INVALID' 'EMPTY_SPECIAL_MUTATION_NOT_OBSERVED'

    # 13. EMPTY-TERMINAL-1: BLOCK close without observer disconnected → FAIL
    $close = $baseClose.Clone(); $close.observerDisconnected = $false
    Run-Case 'EMPTY-TERMINAL-1 (observer not disconnected)' (New-E2Lines -Arm $baseArm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $baseSettle -Geometry $baseGeometry -Final $baseFinal -Close $close) 'FAIL' ''

    # 14. EMPTY-TERMINAL-2: close without active txn cleared → FAIL
    $close = $baseClose.Clone(); $close.activeTxnCleared = $false
    Run-Case 'EMPTY-TERMINAL-2 (active txn not cleared)' (New-E2Lines -Arm $baseArm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $baseSettle -Geometry $baseGeometry -Final $baseFinal -Close $close) 'FAIL' ''

    # 15. SPECIAL-ROUTE-3: ALLOW_SPECIAL_COMMAND → NORMAL_ENTER → FAIL
    $routing = $baseRouting.Clone(); $routing.selectedPath = 'NORMAL_ENTER'
    Run-Case 'SPECIAL-ROUTE-3 (ALLOW_SPECIAL_COMMAND -> NORMAL_ENTER)' (New-E2Lines -Arm $baseArm -TokenConsumed $baseToken -DomNorm $baseDomNorm -Settle $baseSettle -Geometry $baseGeometry -Final $baseFinal -Routing $routing) 'FAIL' ''
} finally {
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$passCount = @($results | Where-Object { $_.ok }).Count
foreach ($r in $results) {
    Write-Host ("{0} = {1} ({2})" -f $r.name, $(if ($r.ok) { 'PASS' } else { 'FAIL' }), $r.detail)
}
Write-Host ("EMPTY-SPECIAL-PARSER-CONTRACT TOTAL = {0}/15 PASS" -f $passCount)

if ($passCount -ne 15) { throw 'EMPTY-SPECIAL-PARSER-CONTRACT tests FAILED' }
