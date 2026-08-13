#Requires -Version 5.1
# run-r58-a1-matrix.ps1
# R58 A1 matrix automation runner — external black-box.
#
# Modes:
#   DryRun  — read-only environment/preflight check (no input, no Typora start)
#   Smoke   — one automation trial on r58-caret-a1-auto-smoke-01.md
#   A1      — fail-fast canonical matrix on fresh-06..15
#
# Usage:
#   .\run-r58-a1-matrix.ps1 -Mode DryRun
#   .\run-r58-a1-matrix.ps1 -Mode Smoke
#   .\run-r58-a1-matrix.ps1 -Mode A1

[CmdletBinding()]
param(
    [ValidateSet('DryRun', 'Smoke', 'A1')]
    [string]$Mode = 'DryRun',
    [int]$StartFreshNumber = 6,
    [int]$TrialCount = 10,
    [string]$OutputDir = 'artifacts\r58-a1',
    [bool]$FailFast = $true,
    [int]$DebugPort = 9222,
    [int]$TrialDurationMs = 25000
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ── Load helpers ───────────────────────────────────────────────────────────────
. (Join-Path $PSScriptRoot 'r58-process-verifier.ps1')
. (Join-Path $PSScriptRoot 'r58-input-injector.ps1')
. (Join-Path $PSScriptRoot 'r58-console-collector.ps1')
. (Join-Path $PSScriptRoot 'r58-trial-evaluator.ps1')

# ── Output dir ─────────────────────────────────────────────────────────────────
$rootResolved = $script:R58Root
$outAbs = if ([System.IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $rootResolved $OutputDir }
if (-not (Test-Path -LiteralPath $outAbs)) {
    New-Item -ItemType Directory -Path $outAbs -Force | Out-Null
}

function Write-R58Step {
    param([string]$Text)
    Write-Output ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Text)
}

# ── Strict startup verification ────────────────────────────────────────────────
function Test-R58StrictStartup {
    param([string]$FixtureName, [int]$OldPid)
    $main = Wait-R58TyporaMainWindow -TimeoutSeconds 30 -ExpectedFixture $FixtureName
    if (-not $main) {
        return [pscustomobject]@{
            strictStartup = $false
            reason = 'NO_MAIN_WINDOW'
            newPid = $null
            oldPid = $OldPid
        }
    }
    $rl = Get-R58RuntimeLoad
    $sha = Get-R58ShaCheck

    $runtimeMainPathOk = ($rl.mainJsPath -eq $script:R58RuntimeMain)
    $buildOk = ($rl.buildMarker -eq $script:R58BuildId)
    $initOk = ($rl.initializationCount -eq 1)
    $mainMatch = $sha.mainMatch -and $sha.mainMatchExpected
    $cssMatch = $sha.cssMatch -and $sha.cssMatchExpected

    $ok = ($main.Id -ne $OldPid) -and ($main.MainWindowHandle -ne 0) `
        -and $runtimeMainPathOk -and $buildOk -and $initOk -and $mainMatch -and $cssMatch

    return [pscustomobject]@{
        strictStartup = $ok
        reason = $(if ($ok) { 'STARTUP_OK' } else { 'STARTUP_FIELD_FAIL' })
        oldPid = $OldPid
        newPid = $main.Id
        startTime = $main.StartTime
        mainWindowHandle = $main.MainWindowHandle
        mainWindowTitle = $main.MainWindowTitle
        runtimeMainPathOk = $runtimeMainPathOk
        buildOk = $buildOk
        initOk = $initOk
        mainMatch = $mainMatch
        cssMatch = $cssMatch
        runtimeLoad = $rl
        sha = $sha
    }
}

# ── Single trial (shared by Smoke and A1) ──────────────────────────────────────
function Invoke-R58Trial {
    param(
        [Parameter(Mandatory = $true)][string]$Trial,
        [Parameter(Mandatory = $true)][string]$FixtureName
    )
    Write-R58Step "$Trial fixture=$FixtureName START"

    # 1. Record old PID
    $oldMain = Get-R58TyporaMainWindow
    $oldPid = if ($oldMain) { $oldMain.Id } else { 0 }

    # 2. Close Typora + verify exit
    $exit = Stop-R58Typora -OldPid $oldPid
    if (-not $exit.closed) {
        return [pscustomobject]@{
            trial = $Trial
            fixture = $FixtureName
            verdict = 'FAIL'
            reason = 'OLD_PROCESS_NOT_EXITED'
            strictStartup = $false
        }
    }

    # 3. Fixture clean gate
    $fs = Get-R58FixtureState -FixtureName $FixtureName
    if (-not $fs.fixtureExists -or $fs.sidecarExists -or $fs.recordCount -ne 0) {
        return [pscustomobject]@{
            trial = $Trial
            fixture = $FixtureName
            verdict = 'INVALID'
            reason = 'FIXTURE_NOT_FRESH'
            fixtureExists = $fs.fixtureExists
            sidecarExists = $fs.sidecarExists
            recordCount = $fs.recordCount
            strictStartup = $false
        }
    }

    # 4. Start console collector BEFORE Typora (to capture plugin load baseline)
    $consoleFile = Join-Path $outAbs "$Trial-console.log"
    if (Test-Path -LiteralPath $consoleFile) { Remove-Item -LiteralPath $consoleFile -Force }
    $collector = $null
    $collectorError = $null
    try {
        $collector = Start-R58ConsoleCollector -Port $DebugPort -OutputFile $consoleFile -FixtureName $FixtureName -DurationMs $TrialDurationMs
    } catch {
        $collectorError = $_.Exception.Message
    }

    # 5. Start Typora
    try {
        $null = Start-R58TyporaFixture -FixtureName $FixtureName -DebugPort $DebugPort
    } catch {
        if ($collector) { Stop-R58ConsoleCollector -Collector $collector }
        return [pscustomobject]@{
            trial = $Trial
            fixture = $FixtureName
            verdict = 'FAIL'
            reason = 'TYPORA_START_FAILED'
            strictStartup = $false
        }
    }

    # 6. Strict startup
    $startup = Test-R58StrictStartup -FixtureName $FixtureName -OldPid $oldPid
    if (-not $startup.strictStartup) {
        if ($collector) { Stop-R58ConsoleCollector -Collector $collector }
        return [pscustomobject]@{
            trial = $Trial
            fixture = $FixtureName
            verdict = 'FAIL'
            reason = 'STRICT_STARTUP'
            strictStartup = $false
            startup = $startup
        }
    }

    # 7. Inject real OS input
    try {
        $null = Invoke-R58A1Keystrokes -HWND $startup.mainWindowHandle
    } catch {
        if ($collector) { Stop-R58ConsoleCollector -Collector $collector }
        return [pscustomobject]@{
            trial = $Trial
            fixture = $FixtureName
            verdict = 'FAIL'
            reason = 'INPUT_INJECT_FAILED'
            strictStartup = $true
        }
    }

    # 8. Wait >= 2.5s for probe completion
    Start-Sleep -Milliseconds 3000

    # 9. Stop collector
    if ($collector) { Stop-R58ConsoleCollector -Collector $collector }

    # 10. Evaluate
    $verdict = New-R58TrialVerdict -Trial $Trial -FixtureName $FixtureName -LogFile $consoleFile

    # 11. Persist verdict + runtime metadata
    $runtimeJson = [pscustomobject]@{
        trial = $Trial
        fixture = $FixtureName
        buildId = $script:R58BuildId
        oldPid = $oldPid
        oldProcessExited = $exit.closed
        startup = $startup
        collectorError = $collectorError
        consoleFile = $consoleFile
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
    }
    $runtimeJson | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outAbs "$Trial-runtime.json") -Encoding UTF8
    $verdict | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outAbs "$Trial-verdict.json") -Encoding UTF8

    Write-R58Step "$Trial fixture=$FixtureName verdict=$($verdict.verdict) reason=$($verdict.reason)"
    return $verdict
}

# ── DryRun ─────────────────────────────────────────────────────────────────────
function Invoke-R58DryRun {
    Write-R58Step 'DryRun START (read-only, no input)'

    $pathAuth = Test-R58PathAuthority
    Write-R58Step "PATH AUTHORITY pass=$($pathAuth.authorityPathPass) wrongPathExists=$($pathAuth.wrongPathExists)"

    # Fixtures
    $smokeName = 'r58-caret-a1-auto-smoke-01.md'
    $smokeState = Get-R58FixtureState -FixtureName $smokeName
    $fixtures = @()
    for ($n = $StartFreshNumber; $n -lt ($StartFreshNumber + $TrialCount); $n++) {
        $f = 'r58-caret-a1-fresh-{0:d2}.md' -f $n
        $fixtures += Get-R58FixtureState -FixtureName $f
    }
    Write-R58Step "SMOKE fixtureExists=$($smokeState.fixtureExists) sidecarExists=$($smokeState.sidecarExists) recordCount=$($smokeState.recordCount)"

    # Typora process discovery
    $procs = Get-R58TyporaProcesses
    $mainWin = Get-R58TyporaMainWindow
    $procCount = @($procs | Where-Object { $null -ne $_ }).Count
    Write-R58Step "TYPORA count=$procCount mainPid=$(if ($mainWin) { $mainWin.Id } else { 'none' }) mainTitle=$(if ($mainWin) { $mainWin.MainWindowTitle } else { '' })"

    # runtime-load + SHA
    $rl = Get-R58RuntimeLoad
    $sha = Get-R58ShaCheck
    Write-R58Step "RUNTIME-LOAD build=$($rl.buildMarker) init=$($rl.initializationCount)"
    Write-R58Step "SHA mainMatch=$($sha.mainMatch) mainExpected=$($sha.mainMatchExpected) cssMatch=$($sha.cssMatch) cssExpected=$($sha.cssMatchExpected)"

    # Console collector capability
    $nodeOk = Test-R58NodeAvailable
    $collectorJsOk = Test-Path -LiteralPath (Join-Path $PSScriptRoot 'r58-cdp-collector.js')
    Write-R58Step "CONSOLE-COLLECTOR nodeOk=$nodeOk collectorJsOk=$collectorJsOk"

    # Window focus capability (foreground HWND discovery only; no SetForegroundWindow side effect in DryRun)
    $fg = Get-R58ForegroundWindow
    Write-R58Step "FOREGROUND-HWND=$fg"

    $report = [pscustomobject]@{
        mode = 'DryRun'
        buildId = $script:R58BuildId
        pathAuthority = $pathAuth
        smokeFixture = $smokeState
        a1Fixtures = $fixtures
        typoraProcessCount = @($procs).Count
        mainWindow = $mainWin
        runtimeLoad = $rl
        sha = $sha
        nodeAvailable = $nodeOk
        collectorJsAvailable = $collectorJsOk
        foregroundHwnd = $fg
        dryRunPass = ($pathAuth.authorityPathPass -and $rl.runtimeLoadExists -and $sha.mainMatch -and $sha.cssMatch -and $nodeOk -and $collectorJsOk)
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
    }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outAbs 'dryrun-report.json') -Encoding UTF8
    Write-R58Step "DryRun PASS=$($report.dryRunPass)"
    return $report
}

# ── Smoke ──────────────────────────────────────────────────────────────────────
function Invoke-R58Smoke {
    Write-R58Step 'Smoke START'
    $smokeName = 'r58-caret-a1-auto-smoke-01.md'
    $state = Get-R58FixtureState -FixtureName $smokeName
    if (-not $state.fixtureExists) {
        Write-R58Step "Creating smoke fixture $smokeName"
        $null = New-R58FreshFixture -FixtureName $smokeName
    }
    $v = Invoke-R58Trial -Trial 'smoke' -FixtureName $smokeName
    $summary = [pscustomobject]@{
        mode = 'Smoke'
        buildId = $script:R58BuildId
        mainSha = $script:R58ExpectedMainSha
        styleSha = $script:R58ExpectedStyleSha
        smokeVerdict = $v.verdict
        reason = $v.reason
    }
    $summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outAbs 'smoke-summary.json') -Encoding UTF8
    Write-R58Step "Smoke verdict=$($v.verdict)"
    return $summary
}

# ── A1 matrix ──────────────────────────────────────────────────────────────────
function Invoke-R58A1 {
    Write-R58Step 'A1 matrix START'
    $results = @()
    for ($n = $StartFreshNumber; $n -lt ($StartFreshNumber + $TrialCount); $n++) {
        $idx = $n - $StartFreshNumber + 1
        $f = 'r58-caret-a1-fresh-{0:d2}.md' -f $n
        $trial = 'A1-{0:d2}' -f $idx
        $state = Get-R58FixtureState -FixtureName $f
        if (-not $state.fixtureExists) {
            Write-R58Step "Creating fresh fixture $f"
            try { $null = New-R58FreshFixture -FixtureName $f } catch {
                Write-R58Step "FAILED to create fixture $f : $($_.Exception.Message)"
                $results += [pscustomobject]@{ trial = $trial; fixture = $f; verdict = 'INVALID'; reason = 'FIXTURE_CREATE_FAILED' }
                break
            }
        }
        $v = Invoke-R58Trial -Trial $trial -FixtureName $f
        $results += $v
        if ($FailFast -and $v.verdict -ne 'PASS') {
            Write-R58Step "FAIL-FAST STOP after $trial verdict=$($v.verdict)"
            break
        }
    }

    $pass = @($results | Where-Object { $_.verdict -eq 'PASS' }).Count
    $fail = @($results | Where-Object { $_.verdict -eq 'FAIL' }).Count
    $invalid = @($results | Where-Object { $_.verdict -eq 'INVALID' }).Count

    $summary = [pscustomobject]@{
        mode = 'A1'
        buildId = $script:R58BuildId
        mainSha = $script:R58ExpectedMainSha
        styleSha = $script:R58ExpectedStyleSha
        passCount = $pass
        failCount = $fail
        invalidCount = $invalid
        totalRun = $results.Count
        result = $(if ($pass -eq 10 -and $fail -eq 0 -and $invalid -eq 0) { 'A1_FRESH_CANONICAL_MATRIX_10_10_PASS' } else { 'A1_MATRIX_NOT_PASSED' })
        results = $results
    }
    $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outAbs 'a1-summary.json') -Encoding UTF8

    # a1-summary.md
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('# R58 A1 Matrix Summary')
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine("- Build ID: ``$($script:R58BuildId)``")
    [void]$sb.AppendLine("- main SHA: ``$($script:R58ExpectedMainSha)``")
    [void]$sb.AppendLine("- style SHA: ``$($script:R58ExpectedStyleSha)``")
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('| Trial | Fixture | Verdict | Reason |')
    [void]$sb.AppendLine('|---|---|---|---|')
    foreach ($r in $results) {
        [void]$sb.AppendLine("| $($r.trial) | $($r.fixture) | $($r.verdict) | $($r.reason) |")
    }
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine("- PASS count: $pass")
    [void]$sb.AppendLine("- FAIL count: $fail")
    [void]$sb.AppendLine("- INVALID count: $invalid")
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine("## A1 RESULT: $($summary.result)")
    Set-Content -LiteralPath (Join-Path $outAbs 'a1-summary.md') -Value $sb.ToString() -Encoding UTF8

    Write-R58Step "A1 result=$($summary.result) PASS=$pass FAIL=$fail INVALID=$invalid"
    return $summary
}

# ── Entry ──────────────────────────────────────────────────────────────────────
Write-R58Step "Runner mode=$Mode buildId=$script:R58BuildId outputDir=$outAbs"

try {
    switch ($Mode) {
        'DryRun' { Invoke-R58DryRun }
        'Smoke'  { Invoke-R58Smoke }
        'A1'     { Invoke-R58A1 }
    }
} catch {
    $errFile = Join-Path $outAbs "runner-error.log"
    $errMsg = "FATAL runner error at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'):`n$($_.Exception.ToString())`n`nScriptStackTrace:`n$($_.ScriptStackTrace)"
    try { Set-Content -LiteralPath $errFile -Value $errMsg -Encoding UTF8 } catch { }
    Write-Output "RUNNER_FATAL_ERROR: $($_.Exception.Message)"
    Write-Output "Error details written to: $errFile"
    throw
}
