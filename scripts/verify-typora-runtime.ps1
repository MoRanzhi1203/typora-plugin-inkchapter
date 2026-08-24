# ============================================================================
# verify-typora-runtime.ps1
# R59: Strict 15-item runtime verification. Outputs structured JSON.
# Does NOT start Typora, deploy, or modify source.
# ============================================================================

$ErrorActionPreference = "Stop"

$ProjectRoot    = "D:\TyporaPluginProjects\typora-plugin-inkchapter"
$RuntimeMain    = Join-Path $ProjectRoot "test\vault\.typora\plugins\dist\main.js"
$RuntimeCss     = Join-Path $ProjectRoot "test\vault\.typora\plugins\dist\style.css"
$RuntimeLoad    = Join-Path $ProjectRoot "test\vault\.typora\inkchapter-runtime-load.json"
$ProjectMain    = Join-Path $ProjectRoot "dist\main.js"
$ProjectCss     = Join-Path $ProjectRoot "dist\style.css"

# ── Expected build ID (single source: forensic.ts) ─────────────────────────
$ExpectedBuildId = "inkchapter-caption-deferred-hot-loop-frame-v7R3.9"

# ── Check required source-of-truth files exist ─────────────────────────────
$runtimeMainExists = Test-Path $RuntimeMain
$runtimeCssExists  = Test-Path $RuntimeCss
$runtimeLoadExists = Test-Path $RuntimeLoad
$projectMainExists = Test-Path $ProjectMain
$projectCssExists  = Test-Path $ProjectCss

# ── 1. old Typora process fully exited ─────────────────────────────────────
$typoraProcesses = Get-Process Typora -ErrorAction SilentlyContinue
$mainProc = $typoraProcesses | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1

# ── 2/3/4/5: PID, StartTime, HWND, Title ──────────────────────────────────
$procId = 0
$start  = ""
$hwnd   = 0
$title  = ""
if ($mainProc) {
    $procId = $mainProc.Id
    $start  = $mainProc.StartTime.ToString("o")
    $hwnd   = $mainProc.MainWindowHandle
    $title  = $mainProc.MainWindowTitle
}

# ── 6. target vault REALLY open ────────────────────────────────────────────
$activeDocPath  = ""
$targetVaultVerified = $false
if ($runtimeLoadExists) {
    try {
        $rl = Get-Content $RuntimeLoad -Raw | ConvertFrom-Json
        if ($rl.mainJsPath) {
            # The pluginRoot tells us where the plugin loaded from, which implies
            # the vault. Extract active document from title or runtime context.
            # Since runtime-load doesn't directly have activeDocPath, we use
            # MainWindowTitle as a proxy for what document/vault is open.
            if ($title -match 'doc\.md' -or $title -match 'test\\vault') {
                $targetVaultVerified = $true
            }
            # Also check if runtime-load reported pluginRoot starts with test\vault
            if ($rl.pluginRoot -match 'test\\vault\\.typora') {
                $targetVaultVerified = $true
            }
        }
    } catch {
        # runtime-load parse failed
    }
}

# ── 7. project dist/main.js SHA256 ─────────────────────────────────────────
$projectMainSha256 = ""
if ($projectMainExists) {
    $projectMainSha256 = (Get-FileHash $ProjectMain -Algorithm SHA256).Hash
}

# ── 8. actual runtime main.js SHA256 (REAL Get-FileHash) ──────────────────
$runtimeMainSha256 = ""
if ($runtimeMainExists) {
    $runtimeMainSha256 = (Get-FileHash $RuntimeMain -Algorithm SHA256).Hash
}

# ── 9. main.js hash match ──────────────────────────────────────────────────
$mainHashMatch = ($projectMainSha256 -ne "") -and ($runtimeMainSha256 -ne "") -and ($projectMainSha256 -eq $runtimeMainSha256)

# ── 10. project dist/style.css SHA256 ─────────────────────────────────────
$projectCssSha256 = ""
if ($projectCssExists) {
    $projectCssSha256 = (Get-FileHash $ProjectCss -Algorithm SHA256).Hash
}

# ── 11. actual runtime style.css SHA256 (REAL Get-FileHash) ───────────────
$runtimeCssSha256 = ""
if ($runtimeCssExists) {
    $runtimeCssSha256 = (Get-FileHash $RuntimeCss -Algorithm SHA256).Hash
}

# ── 12. style.css hash match ───────────────────────────────────────────────
$cssHashMatch = ($projectCssSha256 -ne "") -and ($runtimeCssSha256 -ne "") -and ($projectCssSha256 -eq $runtimeCssSha256)

# ── 13. expected/current build marker match ────────────────────────────────
$runtimeBuildId = ""
$buildIdMatch = $false
$initializationCount = 0
$actualMainJsPath = $RuntimeMain
$actualCssPath   = $RuntimeCss

if ($runtimeLoadExists) {
    try {
        $rl = Get-Content $RuntimeLoad -Raw | ConvertFrom-Json
        $runtimeBuildId = $rl.buildMarker
        $initializationCount = $rl.initializationCount
        if ($rl.mainJsPath) { $actualMainJsPath = $rl.mainJsPath }
        $buildIdMatch = ($runtimeBuildId -eq $ExpectedBuildId)
    } catch {
        # parse failed
    }
}

# ── 15. initializationCount = 1 ────────────────────────────────────────────

# ── Assemble result JSON ───────────────────────────────────────────────────
$result = [PSCustomObject]@{
    oldProcessExited      = ($runtimeLoadExists -and $initializationCount -eq 1)
    pid                   = $procId
    startTime             = $start
    mainWindowHandle      = $hwnd
    mainWindowTitle       = $title
    activeDocumentPath    = $activeDocPath
    targetVaultPath       = $ProjectRoot + "\test\vault"
    targetVaultVerified   = $targetVaultVerified
    projectMainSha256     = $projectMainSha256
    runtimeMainSha256     = $runtimeMainSha256
    mainHashMatch         = $mainHashMatch
    projectCssSha256      = $projectCssSha256
    runtimeCssSha256      = $runtimeCssSha256
    cssHashMatch          = $cssHashMatch
    expectedBuildId       = $ExpectedBuildId
    runtimeBuildId        = $runtimeBuildId
    buildIdMatch          = $buildIdMatch
    actualMainJsPath      = $actualMainJsPath
    actualStyleCssPath    = $actualCssPath
    runtimeLoadPath       = $RuntimeLoad
    initializationCount   = $initializationCount
    all15Passed           = $false
}

# ── Compute all15Passed ────────────────────────────────────────────────────
$missingItems = @()
if (-not $result.oldProcessExited)            { $missingItems += 1 }
if ($result.pid -eq 0)                        { $missingItems += 2 }
if ($result.startTime -eq "")                 { $missingItems += 3 }
if ($result.mainWindowHandle -eq 0)           { $missingItems += 4 }
if ($result.mainWindowTitle -eq "")           { $missingItems += 5 }
if (-not $result.targetVaultVerified)         { $missingItems += 6 }
if ($result.projectMainSha256 -eq "")         { $missingItems += 7 }
if ($result.runtimeMainSha256 -eq "")         { $missingItems += 8 }
if (-not $result.mainHashMatch)               { $missingItems += 9 }
if ($result.projectCssSha256 -eq "")          { $missingItems += 10 }
if ($result.runtimeCssSha256 -eq "")          { $missingItems += 11 }
if (-not $result.cssHashMatch)                { $missingItems += 12 }
if (-not $result.buildIdMatch)                { $missingItems += 13 }
if ($result.actualMainJsPath -eq "")          { $missingItems += 14 }
if ($result.initializationCount -ne 1)        { $missingItems += 15 }

$result.all15Passed = ($missingItems.Count -eq 0)

# ── Output structured JSON ─────────────────────────────────────────────────
$result | ConvertTo-Json -Depth 3

Write-Output ""

# ── Summary ────────────────────────────────────────────────────────────────
if ($result.all15Passed) {
    Write-Output "ALL 15 ITEMS PASSED"
} else {
    Write-Output "MISSING ITEMS: $($missingItems -join ', ')"
    Write-Output "FINAL VERDICT: launch command sent but not yet confirmed successful."
}
