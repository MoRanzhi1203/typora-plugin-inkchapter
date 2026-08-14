#Requires -Version 5.1
# run-r58-final-matrix.ps1 — R58 Final Reduced Matrix Runner v2 (JSONL file-backed).
#
# CDP is DEPRECATED. The runner now reads the plugin's file-backed JSONL audit
# sink (test/vault/.typora/inkchapter/audit/runtime-<sessionId>.log).
#
# Modes:
#   DryRun        read-only environment/preflight check (no input, no Typora start)
#   StrictStartup stop old Typora → normal launch → verify process/window/SHA/audit authority
#   SinkSmoke     validate the current audit file (sink observability, no input)
#   InputSmoke    disposable trusted-IME input proof (r58-automation-input-smoke.md)
#   Full          reset fixtures → strict startup → A1×3 → A2 → A3 → B1 seed → B1×2 → summary
#
# Usage:
#   .\run-r58-final-matrix.ps1 -Mode DryRun
#   .\run-r58-final-matrix.ps1 -Mode StrictStartup
#   .\run-r58-final-matrix.ps1 -Mode SinkSmoke
#   .\run-r58-final-matrix.ps1 -Mode InputSmoke
#   .\run-r58-final-matrix.ps1 -Mode Full

[CmdletBinding()]
param(
    [ValidateSet('DryRun', 'StrictStartup', 'SinkSmoke', 'InputSmoke', 'Full')]
    [string]$Mode = 'DryRun',
    [string]$OutputDir = 'artifacts\r58-final',
    [bool]$FailFast = $true,
    [bool]$ResetFixtures = $true
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:Root = 'D:\TyporaPluginProjects\typora-plugin-inkchapter'
$script:ScenariosFile = Join-Path $PSScriptRoot 'scenarios.json'

# ── Load helpers ───────────────────────────────────────────────────────────────
. (Join-Path $PSScriptRoot 'fixture-manager.ps1')
. (Join-Path $PSScriptRoot 'process-control.ps1')
. (Join-Path $PSScriptRoot 'window-input.ps1')
. (Join-Path $PSScriptRoot 'document-switch-driver.ps1')
. (Join-Path $PSScriptRoot 'forensic-file-collector.ps1')
. (Join-Path $PSScriptRoot 'parser-invoker.ps1')
. (Join-Path $PSScriptRoot 'input-injection-audit.ps1')

$scenarios = Get-Content -LiteralPath $script:ScenariosFile -Raw | ConvertFrom-Json

$outAbs = if ([System.IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $script:Root $OutputDir }
if (-not (Test-Path -LiteralPath $outAbs)) { New-Item -ItemType Directory -Path $outAbs -Force | Out-Null }

function Write-Step { param([string]$Text) Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Text) }

# Resolve the single ACCEPT audit file for the new session (throws on ambiguity).
function Resolve-SessionAuditFile {
    param([datetime]$SinceTime, [string]$BuildId, [string]$TargetDoc)
    $results = @(Resolve-R58CurrentAuditFile -SinceTime $SinceTime -BuildId $BuildId -TargetDoc $TargetDoc)
    $accepted = @($results | Where-Object { $_.decision -eq 'ACCEPT' })
    if ($accepted.Count -eq 0) {
        return [pscustomobject]@{
            auditPath = $null
            auditSessionId = $null
            buildId = $null
            decision = 'REJECT'
            candidates = $results
        }
    }
    if ($accepted.Count -gt 1) {
        return [pscustomobject]@{
            auditPath = $null
            auditSessionId = $null
            buildId = $null
            decision = 'AMBIGUOUS'
            candidates = $accepted
        }
    }
    return $accepted[0]
}

# ── DryRun ─────────────────────────────────────────────────────────────────────
function Invoke-FinalDryRun {
    Write-Step 'DryRun START (read-only)'
    $pathAuth = Test-R58PathAuthority
    $nodeOk = $null -ne (Get-NodePath)
    $typoraExeOk = Test-Path -LiteralPath 'D:\Typora\Typora.exe'
    $sha = Read-ShaCheck
    $rl = Read-RuntimeLoad
    $parserJsOk = Test-Path -LiteralPath (Join-Path $PSScriptRoot 'trial-parser.js')
    $collectorPsOk = Test-Path -LiteralPath (Join-Path $PSScriptRoot 'forensic-file-collector.ps1')
    $auditDir = Get-R58AuditDir
    $auditDirExists = Test-Path -LiteralPath $auditDir
    $auditFiles = @(Get-R58AuditFiles)
    $outWritable = $true
    try { $probe = Join-Path $outAbs '.probe'; Set-Content -LiteralPath $probe -Value 'ok'; Remove-Item -LiteralPath $probe -Force } catch { $outWritable = $false }

    $smokeState = Get-R58FixtureState -FixtureName $scenarios.smokeFixture
    $fixtures = @()
    foreach ($n in $scenarios.resetFixtures) { $fixtures += Get-R58FixtureState -FixtureName $n }

    $report = [pscustomobject]@{
        mode = 'DryRun'
        buildId = $scenarios.buildId
        expectedMainSha = $scenarios.expectedMainSha
        pathAuthorityPass = $pathAuth.authorityPathPass
        wrongPathExists = $pathAuth.wrongPathExists
        nodeAvailable = $nodeOk
        typoraExeDiscoverable = $typoraExeOk
        shaReadable = ($null -ne $sha -and $null -ne $sha.projectMainSHA)
        mainMatch = $sha.mainMatch
        mainMatchExpected = $sha.mainMatchExpected
        cssMatch = $sha.cssMatch
        cssMatchExpected = $sha.cssMatchExpected
        runtimeLoadReadable = $rl.runtimeLoadExists
        runtimeBuildId = $rl.buildMarker
        cdpCapability = 'deprecated'
        jsonlCollectorCapability = if ($collectorPsOk) { 'available' } else { 'missing' }
        auditDir = $auditDir
        auditDirExists = $auditDirExists
        auditFileCount = $auditFiles.Count
        parserJsOk = $parserJsOk
        outputWritable = $outWritable
        smokeFixture = $smokeState
        fixtures = $fixtures
        dryRunPass = ($pathAuth.authorityPathPass -and $nodeOk -and $typoraExeOk -and $parserJsOk -and $collectorPsOk -and $outWritable -and $sha.mainMatch -and $sha.cssMatch)
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
    }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outAbs 'dry-run.json') -Encoding UTF8
    Write-Step "DryRun PASS=$($report.dryRunPass)"
    return $report
}

# ── Strict Startup ─────────────────────────────────────────────────────────────
function Wait-FinalRuntimeReady {
    param(
        [Parameter(Mandatory = $true)][datetime]$StartCmdAt,
        [Parameter(Mandatory = $true)][string]$BuildId,
        [Parameter(Mandatory = $true)][string]$TargetDoc,
        [int]$TimeoutSeconds = 45
    )
    $rlPath = Join-Path $script:Root 'test\vault\.typora\inkchapter-runtime-load.json'
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 500
        $rlFresh = $false
        $rl = $null
        if (Test-Path -LiteralPath $rlPath) {
            $rlFresh = ((Get-Item -LiteralPath $rlPath).LastWriteTime -ge $StartCmdAt)
            $rl = Read-RuntimeLoad
        }
        if (-not $rlFresh) { continue }

        $buildOk = ($rl.buildMarker -eq $BuildId)
        $initOk = ($rl.initializationCount -eq 1)
        $shaOk = ($rl.mainJsSha256 -eq $scenarios.expectedMainSha)
        $authority = Resolve-SessionAuditFile -SinceTime $StartCmdAt -BuildId $BuildId -TargetDoc $TargetDoc
        $identityOk = ($authority.decision -eq 'ACCEPT')

        if ($buildOk -and $initOk -and $shaOk -and $identityOk) {
            return [pscustomobject]@{
                ready = $true
                runtimeLoadLastWriteTime = (Get-Item -LiteralPath $rlPath).LastWriteTime
                runtimeLoadFresh = $rlFresh
                runtimeBuildOk = $buildOk
                runtimeShaOk = $shaOk
                identityOk = $identityOk
                runtimeLoad = $rl
                authority = $authority
            }
        }
    } while ((Get-Date) -lt $deadline)

    return [pscustomobject]@{
        ready = $false
        runtimeLoadLastWriteTime = if (Test-Path -LiteralPath $rlPath) { (Get-Item -LiteralPath $rlPath).LastWriteTime } else { $null }
        runtimeLoadFresh = $false
        runtimeBuildOk = $false
        runtimeShaOk = $false
        identityOk = $false
        runtimeLoad = Read-RuntimeLoad
        authority = Resolve-SessionAuditFile -SinceTime $StartCmdAt -BuildId $BuildId -TargetDoc $TargetDoc
    }
}

function Invoke-FinalStrictStartup {
    Write-Step 'Strict Startup START'
    $buildId = $scenarios.buildId
    $targetDoc = $scenarios.smokeFixture

    # 1. Capture old process.
    $oldMain = Get-TyporaMainWindow
    $oldPid = if ($oldMain) { $oldMain.Id } else { 0 }

    # 2. Close old Typora and confirm exit.
    $close = Stop-TyporaAll -OldPid $oldPid

    # 3. Record start time, then normal-launch on the smoke fixture.
    $startCmdAt = (Get-Date)
    $null = Start-TyporaOnFixture -FixtureName $targetDoc

    # 4. Wait for the main window.
    $main = Wait-TyporaWindow -TimeoutSeconds 30 -Fixture $targetDoc

    # 5. SHA parity (independent of plugin readiness).
    $sha = Read-ShaCheck

    # 6. Poll until the NEW session is actually ready (not just a non-zero window):
    #    runtime-load LastWriteTime >= new StartTime, buildId/SHA/init match,
    #    and current-session RUNTIME-IDENTITY-FINAL is ACCEPT.
    $ready = Wait-FinalRuntimeReady -StartCmdAt $startCmdAt -BuildId $buildId -TargetDoc $targetDoc
    $rl = $ready.runtimeLoad
    $authority = $ready.authority

    $newPid = if ($main) { $main.Id } else { $null }
    $startTime = if ($main) { $main.StartTime } else { $null }
    $hwnd = if ($main) { $main.MainWindowHandle } else { [IntPtr]::Zero }
    $title = if ($main) { $main.MainWindowTitle } else { '' }

    $mandatoryOk = (
        $close.closed -and
        ($null -ne $main) -and ($hwnd -ne [IntPtr]::Zero) -and ($title -ne '') -and
        ($sha.mainMatch) -and ($sha.cssMatch) -and
        ($ready.ready) -and
        ($rl.buildMarker -eq $buildId) -and
        ($rl.initializationCount -eq 1) -and
        ($rl.mainJsSha256 -eq $scenarios.expectedMainSha) -and
        ($authority.decision -eq 'ACCEPT')
    )

    $report = [pscustomobject]@{
        mode = 'StrictStartup'
        oldPid = $oldPid
        oldProcessExited = $close.closed
        processCountAfterClose = $close.typoraCountAfterClose
        newPid = $newPid
        startTime = $startTime
        startCmdAt = $startCmdAt
        mainWindowHandle = $hwnd
        mainWindowTitle = $title
        targetVault = (Join-Path $script:Root 'test\vault')
        targetDocument = $targetDoc
        runtimeMainPath = $sha.runtimeMainPath
        projectMainSHA = $sha.projectMainSHA
        runtimeMainSHA = $sha.runtimeMainSHA
        mainMatch = $sha.mainMatch
        projectStyleSHA = $sha.projectStyleSHA
        runtimeStyleSHA = $sha.runtimeStyleSHA
        cssMatch = $sha.cssMatch
        buildId = $buildId
        runtimeBuildId = $rl.buildMarker
        initializationCount = $rl.initializationCount
        runtimeLoadLastWriteTime = $ready.runtimeLoadLastWriteTime
        runtimeLoadFresh = $ready.runtimeLoadFresh
        runtimeBuildOk = $ready.runtimeBuildOk
        runtimeShaOk = $ready.runtimeShaOk
        identityOk = $ready.identityOk
        readinessReady = $ready.ready
        auditPath = $authority.auditPath
        auditSessionId = $authority.auditSessionId
        auditDecision = $authority.decision
        strictStartup = $mandatoryOk
        verdict = if ($mandatoryOk) { 'PASS' } else { 'FAIL' }
        failedChecks = @()
    }
    if (-not $close.closed) { $report.failedChecks += 'oldProcessNotExited' }
    if ($null -eq $main) { $report.failedChecks += 'noMainWindow' }
    elseif ($hwnd -eq [IntPtr]::Zero) { $report.failedChecks += 'noMainWindowHandle' }
    if (-not $sha.mainMatch) { $report.failedChecks += 'mainShaMismatch' }
    if (-not $sha.cssMatch) { $report.failedChecks += 'styleShaMismatch' }
    if (-not $ready.ready) { $report.failedChecks += 'runtimeNotReady' }
    if ($rl.buildMarker -ne $buildId) { $report.failedChecks += 'runtimeBuildMismatch' }
    if ($rl.initializationCount -ne 1) { $report.failedChecks += 'initializationCount!=1' }
    if ($rl.mainJsSha256 -ne $scenarios.expectedMainSha) { $report.failedChecks += 'runtimeMainShaMismatch' }
    if ($authority.decision -ne 'ACCEPT') { $report.failedChecks += 'auditSessionAuthority:' + $authority.decision }

    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outAbs 'strict-startup.json') -Encoding UTF8
    Write-Step "Strict Startup verdict=$($report.verdict) failedChecks=$($report.failedChecks -join ',')"
    return $report
}

# ── Sink Runtime Smoke ─────────────────────────────────────────────────────────
function Invoke-FinalSinkSmoke {
    Write-Step 'Sink Runtime Smoke START'
    $buildId = $scenarios.buildId
    $targetDoc = $scenarios.smokeFixture

    $main = Get-TyporaMainWindow
    $startAt = if ($main) { $main.StartTime } else { (Get-Date).AddMinutes(-5) }
    $authority = Resolve-SessionAuditFile -SinceTime $startAt -BuildId $buildId -TargetDoc $targetDoc

    if ($authority.decision -ne 'ACCEPT') {
        $report = [pscustomobject]@{
            mode = 'SinkSmoke'; verdict = 'INVALID'; invalidReason = 'AUDIT_SESSION_' + $authority.decision
            auditPath = $authority.auditPath
            failedChecks = @('auditSessionAuthority')
        }
        $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outAbs 'sink-runtime-smoke.json') -Encoding UTF8
        Write-Step "Sink Runtime Smoke INVALID reason=$($report.invalidReason)"
        return $report
    }

    $path = $authority.auditPath
    $schema = Test-R58JsonLinesValid -Path $path
    $identity = Get-R58AuditSessionIdentity -Path $path

    $events = $identity.uniqueEvents
    $readyFound = $identity.readyFound
    $identityFound = $identity.identityFound
    $baselinePresent = (
        ($events -contains 'RUNTIME-IDENTITY-FINAL') -and
        ($events -contains 'DOCUMENT-CONTEXT-STATE') -and
        ($events -contains 'DOCUMENT-CONTEXT-READY') -and
        ($events -contains 'SIDECAR-ACTUAL-LOAD')
    )

    # Sink health from FORENSIC-SINK-READY (errorCount / droppedCount must be 0).
    $readyErrorCount = $null
    $readyDroppedCount = $null
    foreach ($ev in (ConvertFrom-R58JsonLines -Text (Get-Content -LiteralPath $path -Raw -Encoding UTF8))) {
        if (($ev.PSObject.Properties.Name -contains 'event') -and ($ev.event -eq 'FORENSIC-SINK-READY')) {
            $readyErrorCount = Get-R58EventField -Event $ev -Name 'errorCount'
            $readyDroppedCount = Get-R58EventField -Event $ev -Name 'droppedCount'
            break
        }
    }

    $sinkErrorCount = if ($null -eq $readyErrorCount) { 0 } else { $readyErrorCount }
    $droppedCount = if ($null -eq $readyDroppedCount) { 0 } else { $readyDroppedCount }

    $pass = (
        (Test-Path -LiteralPath $path) -and
        ((Get-Item -LiteralPath $path).Length -gt 0) -and
        $readyFound -and
        ($identity.buildId -eq $buildId) -and
        ($schema.parseFailureCount -eq 0) -and
        ($schema.lineCount -gt 0) -and
        $identityFound -and
        $baselinePresent -and
        ($sinkErrorCount -eq 0) -and
        ($droppedCount -eq 0)
    )

    $report = [pscustomobject]@{
        mode = 'SinkSmoke'
        auditDirectoryExists = Test-Path -LiteralPath (Get-R58AuditDir)
        auditFileExists = Test-Path -LiteralPath $path
        auditPath = $path
        auditSessionId = $authority.auditSessionId
        fileSize = if (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path).Length } else { 0 }
        forensSinkReadyFound = $readyFound
        buildId = $identity.buildId
        buildIdCorrect = ($identity.buildId -eq $buildId)
        jsonlParseFailureCount = $schema.parseFailureCount
        jsonlValid = ($schema.parseFailureCount -eq 0)
        baselineEventsPresent = $baselinePresent
        sinkErrorCount = $sinkErrorCount
        droppedCount = $droppedCount
        fileBackedAuditSink = if ($pass) { 'PASS' } else { 'FAIL' }
        verdict = if ($pass) { 'PASS' } else { 'FAIL' }
        failedChecks = @()
    }
    if (-not $readyFound) { $report.failedChecks += 'FORENSIC-SINK-READY-missing' }
    if ($identity.buildId -ne $buildId) { $report.failedChecks += 'buildId-mismatch' }
    if ($schema.parseFailureCount -ne 0) { $report.failedChecks += 'jsonlParseFailure' }
    if (-not $baselinePresent) { $report.failedChecks += 'baselineEventsMissing' }
    if ($sinkErrorCount -ne 0) { $report.failedChecks += 'sinkErrorCount!=0' }
    if ($droppedCount -ne 0) { $report.failedChecks += 'droppedCount!=0' }

    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outAbs 'sink-runtime-smoke.json') -Encoding UTF8
    $mdLines = @('# Sink Runtime Smoke', '', '```text', "verdict=$($report.verdict)", "auditFileExists=$($report.auditFileExists)", "FORENSIC-SINK-READY=$($report.forensSinkReadyFound)", "buildId=$($report.buildId)", "jsonlParseFailureCount=$($report.jsonlParseFailureCount)", "sinkErrorCount=$($report.sinkErrorCount)", "droppedCount=$($report.droppedCount)", '```', '')
    $mdLines | Set-Content -LiteralPath (Join-Path $outAbs 'sink-runtime-smoke.md') -Encoding UTF8

    Write-Step "Sink Runtime Smoke verdict=$($report.verdict) failedChecks=$($report.failedChecks -join ',')"
    return $report
}

# ── Shared trial execution (JSONL byte-offset window) ──────────────────────────
function Invoke-JsonlTrial {
    param([string]$Trial, [string]$Type, [string]$Fixture, [string]$AuditPath, [string]$InputAction)

    Write-Step "$Trial type=$Type fixture=$Fixture START"
    $before = Get-R58AuditByteLength -Path $AuditPath

    switch ($InputAction) {
        'A1' { $main = Get-TyporaMainWindow; if ($null -eq $main) { throw 'no main window for A1' }; $null = Invoke-A1Keystrokes -HWND $main.MainWindowHandle }
        'A2' { $main = Get-TyporaMainWindow; if ($null -eq $main) { throw 'no main window for A2' }; $null = Invoke-A2Keystrokes -HWND $main.MainWindowHandle }
        'A3' { $main = Get-TyporaMainWindow; if ($null -eq $main) { throw 'no main window for A3' }; $null = Invoke-A3Keystrokes -HWND $main.MainWindowHandle }
        'Switch' { $null = Switch-R58Document -FixtureName $Fixture }
        'None' { }
    }

    # Wait >= 2.5s then confirm the audit file length is stable (flush).
    Start-Sleep -Milliseconds 2600
    $null = Wait-R58AuditFileLengthStable -Path $AuditPath -StableCount 3 -IntervalMs 400 -TimeoutMs 12000

    $after = Get-R58AuditByteLength -Path $AuditPath
    $deltaRaw = Read-R58AuditDeltaRaw -Path $AuditPath -OffsetBefore $before -OffsetAfter $after
    $deltaFile = Join-Path $outAbs "$Trial.delta.jsonl"
    Set-Content -LiteralPath $deltaFile -Value $deltaRaw -Encoding UTF8

    $verdictJson = Join-Path $outAbs "$Trial.json"
    $verdict = Invoke-TrialParser -Type $Type -Fixture $Fixture -DeltaFile $deltaFile -OutFile $verdictJson
    $verdict | Add-Member -NotePropertyName byteOffsetBefore -NotePropertyValue $before -Force
    $verdict | Add-Member -NotePropertyName byteOffsetAfter -NotePropertyValue $after -Force
    $verdict | Add-Member -NotePropertyName deltaBytes -NotePropertyValue ($after - $before) -Force
    $verdict | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $verdictJson -Encoding UTF8

    Write-Step "$Trial verdict=$($verdict.verdict) failedChecks=$($verdict.failedChecks -join ',')"
    return $verdict
}

# ── InputSmoke ─────────────────────────────────────────────────────────────────
function Invoke-FinalInputSmoke {
    Write-Step 'InputSmoke START'
    $buildId = $scenarios.buildId
    $targetDoc = $scenarios.smokeFixture

    $main = Get-TyporaMainWindow
    if ($null -eq $main) {
        return [pscustomobject]@{ mode = 'InputSmoke'; verdict = 'INVALID'; invalidReason = 'NO_MAIN_WINDOW'; failedChecks = @('NO_MAIN_WINDOW') }
    }
    $authority = Resolve-SessionAuditFile -SinceTime $main.StartTime -BuildId $buildId -TargetDoc $targetDoc
    if ($authority.decision -ne 'ACCEPT') {
        $report = [pscustomobject]@{ mode = 'InputSmoke'; verdict = 'INVALID'; invalidReason = 'AUDIT_SESSION_' + $authority.decision; failedChecks = @('auditSessionAuthority') }
        $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outAbs 'input-smoke.json') -Encoding UTF8
        return $report
    }

    $auditPath = $authority.auditPath
    $before = Get-R58AuditByteLength -Path $auditPath

    # Audited SendInput injection (records foreground + SendInput return count).
    $injection = Invoke-R58InputInjectionAudit -TargetPid $main.Id -TargetHwnd $main.MainWindowHandle -Keys (Get-R58InputSmokeKeys)
    $gate = Test-R58InputInjectionGate -Audit $injection
    if ($gate.verdict -ne 'PASS') {
        $report = [pscustomobject]@{
            mode = 'InputSmoke'
            verdict = 'INVALID'
            invalidReason = $gate.invalidReason
            injectionAudit = $injection
            failedChecks = @($gate.invalidReason)
        }
        $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outAbs 'input-smoke.json') -Encoding UTF8
        Write-Step "InputSmoke INVALID reason=$($gate.invalidReason)"
        return $report
    }

    # Wait >= 2.5s + stable flush, then read the byte-offset delta.
    Start-Sleep -Milliseconds 2600
    $null = Wait-R58AuditFileLengthStable -Path $auditPath -StableCount 3 -IntervalMs 400 -TimeoutMs 12000

    $after = Get-R58AuditByteLength -Path $auditPath
    $deltaRaw = Read-R58AuditDeltaRaw -Path $auditPath -OffsetBefore $before -OffsetAfter $after
    $deltaFile = Join-Path $outAbs 'input-smoke.delta.jsonl'
    Set-Content -LiteralPath $deltaFile -Value $deltaRaw -Encoding UTF8

    $verdictJson = Join-Path $outAbs 'input-smoke.json'
    $verdict = Invoke-TrialParser -Type 'InputSmoke' -Fixture $targetDoc -DeltaFile $deltaFile -OutFile $verdictJson
    $verdict | Add-Member -NotePropertyName byteOffsetBefore -NotePropertyValue $before -Force
    $verdict | Add-Member -NotePropertyName byteOffsetAfter -NotePropertyValue $after -Force
    $verdict | Add-Member -NotePropertyName deltaBytes -NotePropertyValue ($after - $before) -Force
    $verdict | Add-Member -NotePropertyName injectionAudit -NotePropertyValue $injection -Force
    $verdict | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $verdictJson -Encoding UTF8

    $mdLines = @('# InputSmoke', '', '```text', "verdict=$($verdict.verdict)", "trustedInput=$($verdict.trustedInput)", "imeProvenance=$($verdict.imeProvenance)", "textCommit=$($verdict.textCommit)", "postTextInputArmCount=$($verdict.postTextInputArmCount)", "probeComplete=$($verdict.probeComplete)", "normalEnterFinal=$($verdict.normalEnterFinal)", "awaitingCount=$($verdict.awaitingCount)", "scopeMismatchCount=$($verdict.scopeMismatchCount)", "sinkErrorCount=$($verdict.sinkErrorCount)", "droppedCount=$($verdict.droppedCount)", '```', '')
    $mdLines | Set-Content -LiteralPath (Join-Path $outAbs 'input-smoke.md') -Encoding UTF8

    Write-Step "InputSmoke verdict=$($verdict.verdict)"
    return $verdict
}

# ── Full Reduced Matrix ────────────────────────────────────────────────────────
function Invoke-FinalFull {
    Write-Step 'Full START'
    $buildId = $scenarios.buildId
    $targetDoc = $scenarios.smokeFixture

    # 0. Strict startup.
    $startup = Invoke-FinalStrictStartup
    if ($startup.verdict -ne 'PASS') {
        Write-Step 'Full BLOCKED: strict startup not PASS'
        return $startup
    }

    # 1. Sink smoke.
    $smoke = Invoke-FinalSinkSmoke
    if ($smoke.verdict -ne 'PASS') {
        Write-Step 'Full BLOCKED: sink runtime smoke not PASS'
        return $smoke
    }

    # 2. InputSmoke.
    $inputSmoke = Invoke-FinalInputSmoke
    if ($inputSmoke.verdict -ne 'PASS') {
        Write-Step 'Full BLOCKED: InputSmoke not PASS'
        return $inputSmoke
    }

    # 3. Reset A1 fixtures (only after InputSmoke PASS).
    if ($ResetFixtures) {
        $null = Reset-R58A1Fixtures -FixtureNames $scenarios.resetFixtures
    }

    $auditPath = $startup.auditPath
    $trials = @()
    $first = $true
    foreach ($t in $scenarios.trials) {
        if ($t.type -eq 'B1') { continue }
        $action = $t.type
        if (-not $first) {
            # Same-session document switch first.
            $null = Invoke-JsonlTrial -Trial ("{0}-switch" -f $t.trial) -Type $t.type -Fixture $t.fixture -AuditPath $auditPath -InputAction 'Switch'
        }
        $v = Invoke-JsonlTrial -Trial $t.trial -Type $t.type -Fixture $t.fixture -AuditPath $auditPath -InputAction $t.type
        $trials += $v
        if ($v.verdict -eq 'FAIL' -and $FailFast) {
            Write-Step "Fail-fast: STOP after $($t.trial)"
            break
        }
        $first = $false
    }

    # 4. B1 seed + trials.
    $b1Trials = @($scenarios.trials | Where-Object { $_.type -eq 'B1' })
    foreach ($b in $b1Trials) {
        $seed = Invoke-R58B1Seed -FixtureName $b.fixture
        $v = Invoke-JsonlTrial -Trial $b.trial -Type 'B1' -Fixture $b.fixture -AuditPath $auditPath -InputAction 'Switch'
        $v | Add-Member -NotePropertyName seed -NotePropertyValue $seed -Force
        $trials += $v
        if ($v.verdict -eq 'FAIL' -and $FailFast) { break }
    }

    $passCount = @($trials | Where-Object { $_.verdict -eq 'PASS' }).Count
    $failCount = @($trials | Where-Object { $_.verdict -eq 'FAIL' }).Count
    $invalidCount = @($trials | Where-Object { $_.verdict -eq 'INVALID' }).Count

    $summary = [pscustomobject]@{
        mode = 'Full'
        buildId = $buildId
        strictStartup = $startup.verdict
        sinkSmoke = $smoke.verdict
        inputSmoke = $inputSmoke.verdict
        passCount = $passCount
        failCount = $failCount
        invalidCount = $invalidCount
        trials = $trials
        verdict = if ($passCount -eq 7 -and $failCount -eq 0 -and $invalidCount -eq 0) { 'PASS' } else { 'NOT_PASSED' }
    }
    $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outAbs 'final-summary.json') -Encoding UTF8
    Write-Step "Full verdict=$($summary.verdict) pass=$passCount fail=$failCount invalid=$invalidCount"
    return $summary
}

# ── Entry ──────────────────────────────────────────────────────────────────────
Write-Step "Runner mode=$Mode buildId=$($scenarios.buildId) outputDir=$outAbs"
try {
    switch ($Mode) {
        'DryRun'        { Invoke-FinalDryRun }
        'StrictStartup' { Invoke-FinalStrictStartup }
        'SinkSmoke'     { Invoke-FinalSinkSmoke }
        'InputSmoke'    { Invoke-FinalInputSmoke }
        'Full'          { Invoke-FinalFull }
    }
} catch {
    $errFile = Join-Path $outAbs 'runner-error.log'
    try { Set-Content -LiteralPath $errFile -Value $_.Exception.ToString() -Encoding UTF8 } catch {}
    Write-Output "RUNNER_FATAL_ERROR: $($_.Exception.Message)"
    throw
}
