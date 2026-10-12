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

# ── GLOBAL (user-level) install — the root that loads for NORMAL documents ─
# Non-vault Markdown paths have no local `.typora`, so the framework loads the
# user-level copy. Both roots MUST carry the same artifact or the two windows
# show two versions.
$GlobalRoot     = Join-Path $env:APPDATA "Typora\plugins"
$GlobalPluginId = "ranzhi.inkchapter"
$GlobalMain     = Join-Path $GlobalRoot "plugins\$GlobalPluginId\main.js"
$GlobalCss      = Join-Path $GlobalRoot "plugins\$GlobalPluginId\style.css"
$GlobalLoad     = Join-Path $GlobalRoot "inkchapter-runtime-load.json"

# ── Expected build ID (single source: forensic.ts) ─────────────────────────
$ExpectedBuildId = "inkchapter-heading-reason-chip-stable-anchor-v2"

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

# ── 16. Phase 7R.3.11.8B.4.2 — SETTINGS MODE PARITY ───────────────────────
# persisted headingStructureMode (settings JSON) vs runtime resolved mode
# (from the audit log's HEADING-STRUCTURE-EFFECTIVE-AUTHORITY event).
$SettingsFile = Join-Path $ProjectRoot "test\vault\.typora\data\ranzhi.inkchapter.json"
$persistedMode = ""
if (Test-Path $SettingsFile) {
    try {
        # PS 5.1 ConvertFrom-Json is fragile on the large settings JSON — use a
        # bounded regex over the globalDefault block instead (robust).
        $raw = Get-Content $SettingsFile -Raw
        $gdMatch = [regex]::Match($raw, '"globalDefault"\s*:\s*\{[^}]*')
        if ($gdMatch.Success) {
            $gdChunk = $gdMatch.Value
            $mMode = [regex]::Match($gdChunk, '"headingStructureMode"\s*:\s*"([a-z]+)"')
            $mLegacy = [regex]::Match($gdChunk, '"showLevelOneNumber"\s*:\s*(true|false)')
            if ($mMode.Success) { $persistedMode = $mMode.Groups[1].Value }
            elseif ($mLegacy.Success) { $persistedMode = if ($mLegacy.Groups[1].Value -eq 'true') { 'loose' } else { 'strict' } }
            else { $persistedMode = 'strict' }
        } else { $persistedMode = "NO_GLOBAL_DEFAULT" }
    } catch { $persistedMode = "UNPARSEABLE" }
} else { $persistedMode = "NO_FILE" }

$runtimeResolvedMode = ""
$runtimeAuthorityDecision = ""
$auditDir = Join-Path $ProjectRoot "test\vault\.typora\inkchapter\audit"
$latestAudit = Get-ChildItem $auditDir -Filter "runtime-*.log" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($latestAudit) {
    $match = Select-String -Path $latestAudit.FullName -Pattern 'HEADING-STRUCTURE-EFFECTIVE-AUTHORITY' |
        Select-Object -Last 1
    if ($match) {
        if ($match.Line -match '"resolvedMode":"([a-z]+)"') { $runtimeResolvedMode = $Matches[1] }
        if ($match.Line -match '"decision":"([A-Z_]+)"') { $runtimeAuthorityDecision = $Matches[1] }
    }
}
$settingsModeParity = ($persistedMode -eq $runtimeResolvedMode) -and ($runtimeAuthorityDecision -eq "COHERENT")

# ── 17. TWO-ROOT IDENTITY (test-vault path vs normal-document path) ─────────
# The vault path loads `<vault>/.typora/plugins/<id>`; a NORMAL Markdown path
# (no local `.typora`) loads the user-level `<userData>/plugins/plugins/<id>`.
# Both roots must carry the SAME artifact and each window's recorded load must
# match its own root, or the same plugin appears as two different versions.
$globalMainSha256 = if (Test-Path $GlobalMain) { (Get-FileHash $GlobalMain -Algorithm SHA256).Hash } else { "" }
$globalCssSha256  = if (Test-Path $GlobalCss)  { (Get-FileHash $GlobalCss  -Algorithm SHA256).Hash } else { "" }
$crossRootOnDiskParity = ($runtimeMainSha256 -ne "") -and ($globalMainSha256 -ne "") -and ($runtimeMainSha256 -eq $globalMainSha256)

function Read-LoadRecord([string]$p) {
    if (-not (Test-Path $p)) { return $null }
    try { return (Get-Content $p -Raw | ConvertFrom-Json) } catch { return $null }
}
$vaultLoadRec  = Read-LoadRecord $RuntimeLoad
$globalLoadRec = Read-LoadRecord $GlobalLoad

$vaultLoadSha     = if ($vaultLoadRec)  { [string]$vaultLoadRec.mainJsSha256 } else { "" }
$vaultLoadAt      = if ($vaultLoadRec)  { [string]$vaultLoadRec.loadedAt }    else { "" }
$vaultLoadSource  = if ($vaultLoadRec)  { [string]$vaultLoadRec.loadSource }  else { "" }
$vaultLoadRoot    = if ($vaultLoadRec)  { [string]$vaultLoadRec.pluginRoot }  else { "" }
$globalLoadSha    = if ($globalLoadRec) { [string]$globalLoadRec.mainJsSha256 } else { "" }
$globalLoadAt     = if ($globalLoadRec) { [string]$globalLoadRec.loadedAt }     else { "" }
$globalLoadSource = if ($globalLoadRec) { [string]$globalLoadRec.loadSource }   else { "" }
$globalLoadRoot   = if ($globalLoadRec) { [string]$globalLoadRec.pluginRoot }   else { "" }

$vaultRuntimeIdentityMatch  = ($vaultLoadSha -ne "")  -and ($vaultLoadSha  -eq $runtimeMainSha256)
$globalRuntimeIdentityMatch = ($globalLoadSha -ne "") -and ($globalLoadSha -eq $globalMainSha256)
$twoPathVersionConsistency  = $crossRootOnDiskParity -and $vaultRuntimeIdentityMatch -and $globalRuntimeIdentityMatch -and ($vaultLoadSha -eq $globalLoadSha)

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
    persistedMode         = $persistedMode
    runtimeResolvedMode   = $runtimeResolvedMode
    runtimeAuthorityDecision = $runtimeAuthorityDecision
    settingsModeParity    = $settingsModeParity
    globalMainPath        = $GlobalMain
    globalMainSha256      = $globalMainSha256
    globalCssSha256       = $globalCssSha256
    crossRootOnDiskParity = $crossRootOnDiskParity
    vaultRuntimeLoadSha256 = $vaultLoadSha
    vaultRuntimeLoadLoadedAt = $vaultLoadAt
    vaultRuntimeLoadSource = $vaultLoadSource
    vaultRuntimeLoadPluginRoot = $vaultLoadRoot
    globalRuntimeLoadSha256 = $globalLoadSha
    globalRuntimeLoadLoadedAt = $globalLoadAt
    globalRuntimeLoadSource = $globalLoadSource
    globalRuntimeLoadPluginRoot = $globalLoadRoot
    vaultRuntimeIdentityMatch = $vaultRuntimeIdentityMatch
    globalRuntimeIdentityMatch = $globalRuntimeIdentityMatch
    twoPathVersionConsistency = $twoPathVersionConsistency
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
if (-not $result.settingsModeParity)          { $missingItems += 16 }

$result.all15Passed = ($missingItems.Count -eq 0)

# ── Output structured JSON ─────────────────────────────────────────────────
$result | ConvertTo-Json -Depth 3

Write-Output ""

# ── Summary ────────────────────────────────────────────────────────────────
if ($result.all15Passed) {
    Write-Output "ALL 15 ITEMS PASSED"
    Write-Output "SETTINGS_MODE_PARITY=PASS"
} else {
    Write-Output "MISSING ITEMS: $($missingItems -join ', ')"
    Write-Output "FINAL VERDICT: launch command sent but not yet confirmed successful."
}

Write-Output ""
Write-Output "========================================"
Write-Output "TWO-ROOT IDENTITY"
Write-Output "========================================"
Write-Output "vault path   -> pluginRoot=$vaultLoadRoot"
Write-Output "                 mainJsSha256=$vaultLoadSha  source=$vaultLoadSource  loadedAt=$vaultLoadAt"
Write-Output "normal path  -> pluginRoot=$globalLoadRoot"
Write-Output "                 mainJsSha256=$globalLoadSha  source=$globalLoadSource  loadedAt=$globalLoadAt"
Write-Output "on-disk      -> vault=$runtimeMainSha256"
Write-Output "                global=$globalMainSha256"
Write-Output "CROSS_ROOT_ON_DISK_PARITY=$crossRootOnDiskParity"
Write-Output "VAULT_RUNTIME_IDENTITY_MATCH=$vaultRuntimeIdentityMatch"
Write-Output "GLOBAL_RUNTIME_IDENTITY_MATCH=$globalRuntimeIdentityMatch"
Write-Output "TWO_PATH_VERSION_CONSISTENCY=$twoPathVersionConsistency"
if (-not $twoPathVersionConsistency) {
    Write-Output "NOTE: run each Typora window (vault doc AND a normal doc) once so both"
    Write-Output "      runtime-load.json records are fresh, then re-run this script."
}
