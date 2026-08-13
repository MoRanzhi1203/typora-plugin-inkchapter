#Requires -Version 5.1
# r58-trial-evaluator.ps1
# Parses a captured trial console log and produces a PASS/FAIL/INVALID verdict
# against the R58 A1 mandatory runtime evidence (spec sections 11–13).

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-R58LogContent {
    param([Parameter(Mandatory = $true)][string]$LogFile)
    if (-not (Test-Path -LiteralPath $LogFile)) {
        return $null
    }
    return Get-Content -LiteralPath $LogFile -Raw
}

function Test-R58RegexCount {
    param([string]$Content, [string]$Pattern)
    if ([string]::IsNullOrEmpty($Content)) { return 0 }
    return ([regex]::Matches($Content, $Pattern)).Count
}

# ── 11. Runtime clean baseline ────────────────────────────────────────────────
function Test-R58CleanBaseline {
    param([string]$Content, [string]$FixtureName)
    if ([string]::IsNullOrEmpty($Content)) {
        return [pscustomobject]@{ cleanBaseline = $false; reason = 'NO_CONSOLE' }
    }
    # SIDECAR-ACTUAL-LOAD ... exists=false recordCount=0 source=physical
    $loadPattern = 'SIDECAR-ACTUAL-LOAD:\s*documentKey=' + [regex]::Escape($FixtureName) + '.*?exists=false\s+recordCount=0\s+source=physical'
    $loadOk = [regex]::IsMatch($Content, $loadPattern)

    # No historical records may be loaded
    $persistedLoadCount = Test-R58RegexCount -Content $Content -Pattern 'PERSISTED_LOAD'
    $persistedHistoricalCount = Test-R58RegexCount -Content $Content -Pattern 'PERSISTED_HISTORICAL'

    $ok = $loadOk -and ($persistedLoadCount -eq 0) -and ($persistedHistoricalCount -eq 0)
    return [pscustomobject]@{
        cleanBaseline = $ok
        sidcarLoadClean = $loadOk
        persistedLoadCount = $persistedLoadCount
        persistedHistoricalCount = $persistedHistoricalCount
        reason = $(if ($ok) { 'CLEAN' } else { 'BASELINE_NOT_CLEAN' })
    }
}

# ── 13.1 Trusted input provenance ─────────────────────────────────────────────
function Test-R58TrustedInput {
    param([string]$Content)
    if ([string]::IsNullOrEmpty($Content)) {
        return [pscustomobject]@{ trustedInput = $false; imeProvenance = $false }
    }
    # KEYBOARD-EVENT-PROVENANCE: key=Process code=Period isTrusted=true
    $processPeriod = [regex]::IsMatch($Content, 'KEYBOARD-EVENT-PROVENANCE:\s*key=Process\s+code=Period\s+isTrusted=true')
    # IME composition chain markers
    $compStart = Test-R58RegexCount -Content $Content -Pattern 'IME-SELECTION-AUDIT:\s*compositionSessionId=.*?eventType=compositionstart' -ge 1
    $beforeInput = [regex]::IsMatch($Content, 'beforeinput\s+inputType=insertCompositionText')
    $inputEvent = [regex]::IsMatch($Content, 'eventType=input\s+inputType=input')
    $compEnd = [regex]::IsMatch($Content, 'eventType=compositionend')
    $imeOrder = [regex]::IsMatch($Content, 'IME-EVENT-ORDER:')

    $trusted = $processPeriod
    $ime = $compStart -and $beforeInput -and $inputEvent -and $compEnd -and $imeOrder
    return [pscustomobject]@{
        trustedInput = $trusted
        imeProvenance = $ime
        processPeriod = $processPeriod
        compositionStart = $compStart
        beforeInputComposition = $beforeInput
        inputComposition = $inputEvent
        compositionEnd = $compEnd
        imeEventOrder = $imeOrder
    }
}

# ── 13.2 TEXT_INPUT takeover ──────────────────────────────────────────────────
function Test-R58TextInputSupersession {
    param([string]$Content)
    if ([string]::IsNullOrEmpty($Content)) {
        return [pscustomobject]@{ textInputSupersession = $false; armCount = 0; superseded = $false }
    }
    $armCount = Test-R58RegexCount -Content $Content -Pattern 'POST-TEXT-INPUT-ARM:'
    $superseded = [regex]::IsMatch($Content, 'CARET-EXPECTATION-SUPERSESSION-AUDIT:.*?superseded=true')
    return [pscustomobject]@{
        textInputSupersession = ($armCount -eq 1 -and $superseded)
        armCount = $armCount
        superseded = $superseded
    }
}

# ── 13.3 Stability samples ────────────────────────────────────────────────────
function Get-R58CommitSample {
    param([string]$Content, [string]$Sample)
    if ([string]::IsNullOrEmpty($Content)) { return $null }
    $esc = [regex]::Escape($Sample)
    # Find the POST-TEXT-INPUT-STABILITY line for this sample
    $pattern = 'POST-TEXT-INPUT-STABILITY:.*?sample=' + $esc + '\s'
    $m = [regex]::Match($Content, $pattern)
    if (-not $m.Success) { return $null }
    # Extract the whole stability line up to newline
    $lineStart = $Content.LastIndexOf("`n", $m.Index)
    if ($lineStart -lt 0) { $lineStart = 0 }
    $lineEnd = $Content.IndexOf("`n", $m.Index)
    if ($lineEnd -lt 0) { $lineEnd = $Content.Length }
    $line = $Content.Substring($lineStart, $lineEnd - $lineStart)

    $logicalOffset = $null
    if ($line -match 'logicalOffset=(\d+)') { $logicalOffset = [int]$Matches[1] }
    $visibleText = ''
    if ($line -match 'visibleText=(\S*)') { $visibleText = $Matches[1] }
    $insideEditor = $false
    if ($line -match 'insideEditor=(true|false)') { $insideEditor = ($Matches[1] -eq 'true') }

    return [pscustomobject]@{
        sample = $Sample
        logicalOffset = $logicalOffset
        visibleText = $visibleText
        insideEditor = $insideEditor
    }
}

function Test-R58Stability {
    param([string]$Content)
    $samples = @('COMMIT+50', 'COMMIT+150', 'COMMIT+300', 'COMMIT+500', 'COMMIT+1000', 'COMMIT+2200')
    $results = @()
    $allOk = $true
    foreach ($s in $samples) {
        $r = Get-R58CommitSample -Content $Content -Sample $s
        if ($null -eq $r) {
            $results += [pscustomobject]@{ sample = $s; logicalOffset = $null; visibleText = ''; insideEditor = $false; ok = $false }
            $allOk = $false
            continue
        }
        $ok = ($r.logicalOffset -eq 1 -and $r.visibleText -eq [char]0x3002 -and $r.insideEditor)
        $results += [pscustomobject]@{ sample = $s; logicalOffset = $r.logicalOffset; visibleText = $r.visibleText; insideEditor = $r.insideEditor; ok = $ok }
        if (-not $ok) { $allOk = $false }
    }
    return [pscustomobject]@{
        stability = $allOk
        commit50 = $(if ($results[0].ok) { 1 } else { 0 })
        commit150 = $(if ($results[1].ok) { 1 } else { 0 })
        commit300 = $(if ($results[2].ok) { 1 } else { 0 })
        commit500 = $(if ($results[3].ok) { 1 } else { 0 })
        commit1000 = $(if ($results[4].ok) { 1 } else { 0 })
        commit2200 = $(if ($results[5].ok) { 1 } else { 0 })
        samples = $results
    }
}

# ── 13.4 No plugin caret writes ───────────────────────────────────────────────
function Test-R58NoCaretWrites {
    param([string]$Content)
    if ([string]::IsNullOrEmpty($Content)) {
        return [pscustomobject]@{ caretRestore = -1; caretRepair = -1; pluginSelectionWrite = -1; noCaretWrites = $false }
    }
    # In POST-TEXT-INPUT-STABILITY lines, these counters must all be 0.
    $restoreMax = 0
    foreach ($m in [regex]::Matches($Content, 'caretContinuityRestoreCountSinceInput=(\d+)')) {
        $v = [int]$m.Groups[1].Value
        if ($v -gt $restoreMax) { $restoreMax = $v }
    }
    $repairMax = 0
    foreach ($m in [regex]::Matches($Content, 'caretRepairCountSinceInput=(\d+)')) {
        $v = [int]$m.Groups[1].Value
        if ($v -gt $repairMax) { $repairMax = $v }
    }
    $writeMax = 0
    foreach ($m in [regex]::Matches($Content, 'pluginSelectionWriteCountSinceInput=(\d+)')) {
        $v = [int]$m.Groups[1].Value
        if ($v -gt $writeMax) { $writeMax = $v }
    }
    return [pscustomobject]@{
        caretRestore = $restoreMax
        caretRepair = $repairMax
        pluginSelectionWrite = $writeMax
        noCaretWrites = ($restoreMax -eq 0 -and $repairMax -eq 0 -and $writeMax -eq 0)
    }
}

# ── 13.5 Probe lifecycle ──────────────────────────────────────────────────────
function Test-R58ProbeComplete {
    param([string]$Content)
    if ([string]::IsNullOrEmpty($Content)) {
        return [pscustomobject]@{ probeComplete = $false; completeCount = 0; activeObservationAfterComplete = 'missing'; pendingCallbackCountAfterComplete = -1 }
    }
    $completeCount = Test-R58RegexCount -Content $Content -Pattern 'POST-TEXT-INPUT-COMPLETE:'
    $activeNone = $false
    if ($Content -match 'activeObservationAfterComplete=(\S+)') { $activeNone = ($Matches[1] -eq 'none') }
    $pendingZero = $false
    if ($Content -match 'pendingCallbackCountAfterComplete=(\d+)') { $pendingZero = ([int]$Matches[1] -eq 0) }
    $decision = $false
    if ($Content -match 'POST-TEXT-INPUT-COMPLETE:.*?decision=COMPLETE') { $decision = $true }

    return [pscustomobject]@{
        probeComplete = ($completeCount -eq 1 -and $activeNone -and $pendingZero -and $decision)
        completeCount = $completeCount
        activeObservationAfterComplete = $(if ($activeNone) { 'none' } else { 'not-none' })
        pendingCallbackCountAfterComplete = $(if ($pendingZero) { 0 } else { -1 })
    }
}

# ── 13.6 Canonical regression ─────────────────────────────────────────────────
function Test-R58Canonical {
    param([string]$Content)
    if ([string]::IsNullOrEmpty($Content)) {
        return [pscustomobject]@{ canonical = $false }
    }
    $visual = [regex]::IsMatch($Content, 'CANONICAL-VISUAL-VERIFY:.*?overall=true')
    $projection = [regex]::IsMatch($Content, 'PROJECTION-VERIFY:.*?overall=true')
    $finalAudit = [regex]::IsMatch($Content, 'CANONICAL-TRANSFER-FINAL-AUDIT:.*?overall=true')
    $normalEnter = [regex]::IsMatch($Content, 'NORMAL-ENTER-FINAL:.*?overall=true')

    # Every AWAITING-TRANSFER-LEAK-AUDIT must show awaitingCount=0
    $leakOk = $true
    $leakCount = 0
    foreach ($m in [regex]::Matches($Content, 'AWAITING-TRANSFER-LEAK-AUDIT:.*?awaitingCount=(\d+)')) {
        $leakCount++
        if ([int]$m.Groups[1].Value -ne 0) { $leakOk = $false }
    }
    $canonical = $visual -and $projection -and $finalAudit -and $normalEnter -and $leakOk -and ($leakCount -gt 0)
    return [pscustomobject]@{
        canonical = $canonical
        canonicalVisualVerify = $visual
        projectionVerify = $projection
        canonicalFinalAudit = $finalAudit
        normalEnterFinal = $normalEnter
        awaitingCount = $(if ($leakOk) { 0 } else { -1 })
        awaitingLeakAuditCount = $leakCount
    }
}

# ── 13.1 Enter admission ──────────────────────────────────────────────────────
function Test-R58EnterAdmission {
    param([string]$Content)
    if ([string]::IsNullOrEmpty($Content)) {
        return [pscustomobject]@{ enterAdmission = $false; processPeriodReject = $false }
    }
    $reject = [regex]::IsMatch($Content, 'ENTER-ADMISSION-AUDIT:\s*key=Process\s+code=Period\s+isTrusted=true\s+isComposing=false\s+decision=REJECT_NON_ENTER')
    # non-enter keys must never create a normal-enter txn
    $nonEnter = [regex]::IsMatch($Content, 'normalEnterTxnCreatedFromNonEnterCount=([1-9]\d*)')
    return [pscustomobject]@{
        enterAdmission = ($reject -and (-not $nonEnter))
        processPeriodReject = $reject
        nonEnterCreatedNormalEnter = $nonEnter
    }
}

# ── Full verdict assembly ──────────────────────────────────────────────────────
function New-R58TrialVerdict {
    param(
        [Parameter(Mandatory = $true)][string]$Trial,
        [Parameter(Mandatory = $true)][string]$FixtureName,
        [Parameter(Mandatory = $true)][string]$LogFile
    )
    $content = Get-R58LogContent -LogFile $LogFile
    if ($null -eq $content) {
        return [pscustomobject]@{
            trial = $Trial
            fixture = $FixtureName
            verdict = 'INVALID'
            reason = 'CONSOLE_MISSING'
        }
    }
    $baseline = Test-R58CleanBaseline -Content $content -FixtureName $FixtureName
    $trusted = Test-R58TrustedInput -Content $content
    $supersession = Test-R58TextInputSupersession -Content $content
    $stability = Test-R58Stability -Content $content
    $noWrites = Test-R58NoCaretWrites -Content $content
    $complete = Test-R58ProbeComplete -Content $content
    $canonical = Test-R58Canonical -Content $content
    $enter = Test-R58EnterAdmission -Content $content

    $allPass = $baseline.cleanBaseline -and $trusted.trustedInput -and $trusted.imeProvenance `
        -and $supersession.textInputSupersession -and $stability.stability `
        -and $noWrites.noCaretWrites -and $complete.probeComplete -and $canonical.canonical `
        -and $enter.enterAdmission

    return [pscustomobject]@{
        trial = $Trial
        fixture = $FixtureName
        strictStartup = $true
        cleanBaseline = $baseline.cleanBaseline
        trustedInput = $trusted.trustedInput
        imeProvenance = $trusted.imeProvenance
        textInputSupersession = $supersession.textInputSupersession
        commit50 = $stability.commit50
        commit150 = $stability.commit150
        commit300 = $stability.commit300
        commit500 = $stability.commit500
        commit1000 = $stability.commit1000
        commit2200 = $stability.commit2200
        caretRestore = $noWrites.caretRestore
        caretRepair = $noWrites.caretRepair
        pluginSelectionWrite = $noWrites.pluginSelectionWrite
        probeComplete = $complete.probeComplete
        canonicalVisualVerify = $canonical.canonicalVisualVerify
        projectionVerify = $canonical.projectionVerify
        canonicalFinalAudit = $canonical.canonicalFinalAudit
        awaitingCount = $canonical.awaitingCount
        normalEnterFinal = $canonical.normalEnterFinal
        verdict = $(if ($allPass) { 'PASS' } else { 'FAIL' })
        reason = $(if ($allPass) { 'ALL_CHECKS_PASS' } else {
            @(
                $(if (-not $baseline.cleanBaseline) { 'CLEAN_BASELINE' }),
                $(if (-not $trusted.trustedInput) { 'TRUSTED_INPUT' }),
                $(if (-not $trusted.imeProvenance) { 'IME_PROVENANCE' }),
                $(if (-not $supersession.textInputSupersession) { 'SUPERSESSION' }),
                $(if (-not $stability.stability) { 'STABILITY' }),
                $(if (-not $noWrites.noCaretWrites) { 'CARET_WRITES' }),
                $(if (-not $complete.probeComplete) { 'PROBE_COMPLETE' }),
                $(if (-not $canonical.canonical) { 'CANONICAL' }),
                $(if (-not $enter.enterAdmission) { 'ENTER_ADMISSION' })
            ) -join ','
        })
        details = [pscustomobject]@{
            baseline = $baseline
            trusted = $trusted
            supersession = $supersession
            stability = $stability
            noWrites = $noWrites
            complete = $complete
            canonical = $canonical
            enter = $enter
        }
    }
}
