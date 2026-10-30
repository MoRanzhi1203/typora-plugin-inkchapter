# ============================================================================
# deploy-test-vault.ps1
# R59 (rev R60): Deploy the built `dist` and report/verify the LOAD SOURCE +
# VERSION IDENTITY of every InkChapter copy on this machine.
#
# TWO DISTINCT TARGETS — never conflated:
#   1. TEST VAULT  (default)  -> <project>\test\vault\.typora\plugins\dist
#      A sandbox. Any build (dev or prod) may be deployed here. No approval.
#   2. GLOBAL      (-Global)  -> %APPDATA%\Typora\plugins\plugins\<pluginId>
#      The REAL user-level install that loads for EVERY Markdown path outside
#      a vault. Overwriting it from a TEST build is REFUSED.
#        * requires BOTH `-Global`  AND  `-ApproveGlobal` (explicit approval),
#        * requires a PRODUCTION build (a dev build ships `dist/main.js.map`).
#      Without `-ApproveGlobal` the global step is skipped with a hard refusal.
#
# The community framework loads `<userData>/plugins/plugins/<id>` (= the
# `%APPDATA%\Typora\plugins` symlink -> `~/.typora/community-plugins`) for
# non-vault documents, and `<vault>/.typora/plugins/<id>` when the opened folder
# IS a vault. Both roots can hold the SAME plugin id; only deploying the SAME
# artifact to both keeps the two windows on one version.
# ============================================================================

$ErrorActionPreference = "Stop"

$RunGlobal     = ($args -contains '-Global')     -or ($args -contains '--global')
$ApproveGlobal = ($args -contains '-ApproveGlobal') -or ($args -contains '--approve-global')

# ── Single source of truth paths ──────────────────────────────────────────
$ProjectRoot    = "D:\TyporaPluginProjects\typora-plugin-inkchapter"
$ExpectedRuntimeRoot = "D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist"
$WrongLegacyPath = "D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault.typora"

$ProjectMain  = Join-Path $ProjectRoot "dist\main.js"
$ProjectCss   = Join-Path $ProjectRoot "dist\style.css"
$ManifestSrc  = Join-Path $ProjectRoot "src\manifest.json"
$RuntimeRoot  = Join-Path $ProjectRoot "test\vault\.typora\plugins\dist"
$RuntimeMain  = Join-Path $RuntimeRoot "main.js"
$RuntimeCss   = Join-Path $RuntimeRoot "style.css"

$GlobalRoot   = Join-Path $env:APPDATA "Typora\plugins"

Write-Output "========================================"
Write-Output "DEPLOY-TEST-VAULT"
Write-Output "========================================"

# ── GATE: Hard path assertion ─────────────────────────────────────────────
$resolvedRuntime = [System.IO.Path]::GetFullPath($RuntimeRoot)
$resolvedExpected = [System.IO.Path]::GetFullPath($ExpectedRuntimeRoot)

if ($resolvedRuntime -ne $resolvedExpected) {
    Write-Output ""
    Write-Output "INVALID_RUNTIME_DEPLOY_PATH"
    Write-Output "Expected: $ExpectedRuntimeRoot"
    Write-Output "Actual:   $resolvedRuntime"
    Write-Output ""
    throw "INVALID_RUNTIME_DEPLOY_PATH: $resolvedRuntime"
}

Write-Output ""
Write-Output "DEPLOY_ROOT: $RuntimeRoot"
Write-Output "DEPLOY_PATH_VALID: true"
Write-Output ""

# ── Legacy wrong path detection ───────────────────────────────────────────
if (Test-Path $WrongLegacyPath) {
    Write-Output "LEGACY_WRONG_DEPLOY_PATH_DETECTED"
    Write-Output "  path: $WrongLegacyPath"
    $legacyMain = Join-Path $WrongLegacyPath "plugins\dist\main.js"
    Write-Output "  main.js exists: $(Test-Path $legacyMain)"
    if (Test-Path $legacyMain) {
        Write-Output "  main.js last write: $((Get-Item $legacyMain).LastWriteTime)"
    }
    Write-Output "  ACTION: NOT deploying to this path. Recommend manual cleanup."
    Write-Output ""
}

# ── Verify source files exist ──────────────────────────────────────────────
if (-not (Test-Path $ProjectMain)) { throw "PROJECT_MAIN_NOT_FOUND: $ProjectMain" }
if (-not (Test-Path $ProjectCss))  { throw "PROJECT_CSS_NOT_FOUND: $ProjectCss" }
if (-not (Test-Path $ManifestSrc)) { throw "PROJECT_MANIFEST_NOT_FOUND: $ManifestSrc" }

$PluginId = (Get-Content $ManifestSrc -Raw -Encoding UTF8 | ConvertFrom-Json).id
if (-not $PluginId) { throw "MANIFEST_ID_MISSING: $ManifestSrc" }

Write-Output "PROJECT_MAIN: $ProjectMain"
Write-Output "PROJECT_STYLE: $ProjectCss"
Write-Output "MANIFEST: $ManifestSrc"
Write-Output "PLUGIN_ID: $PluginId"
Write-Output ""

# ── Build-mode discriminator (prod vs dev/test) ───────────────────────────
# build.js writes a sourcemap ONLY in dev mode (`dist/main.js.map`). Its presence
# is the honest signal that `dist` is a TEST build and must never be promoted to
# the global (production) install.
$IsDevBuild = Test-Path (Join-Path $ProjectRoot "dist\main.js.map")
Write-Output "BUILD_MAP_PRESENT: $IsDevBuild"
Write-Output "BUILD_MODE: $(if ($IsDevBuild) { 'development/test' } else { 'production' })"
Write-Output ""

# ── Compute project hashes BEFORE copy ─────────────────────────────────────
$projectMainHash = (Get-FileHash $ProjectMain -Algorithm SHA256).Hash
$projectCssHash  = (Get-FileHash $ProjectCss -Algorithm SHA256).Hash

Write-Output "PROJECT_MAIN_SHA256: $projectMainHash"
Write-Output "PROJECT_CSS_SHA256: $projectCssHash"
Write-Output ""

# ── Ensure target directory ────────────────────────────────────────────────
$null = New-Item -ItemType Directory -Force -Path $RuntimeRoot

# ── Deploy to TEST VAULT (sandbox — always allowed) ────────────────────────
Copy-Item $ProjectMain $RuntimeMain -Force
Copy-Item $ProjectCss  $RuntimeCss  -Force
Copy-Item $ManifestSrc (Join-Path $RuntimeRoot "manifest.json") -Force

# Mirror the REAL artifact: sourcemaps are dev-only. A stale `*.map` left in the
# deployed copy would make a production deploy look like a dev build and hide
# which artifact is actually live.
Remove-Item (Join-Path $RuntimeRoot "*.map") -Force -ErrorAction SilentlyContinue

Write-Output "RUNTIME_MAIN: $RuntimeMain"
Write-Output "RUNTIME_STYLE: $RuntimeCss"
Write-Output ""

# ── Verify deployment hashes ───────────────────────────────────────────────
$runtimeMainHash = (Get-FileHash $RuntimeMain -Algorithm SHA256).Hash
$runtimeCssHash  = (Get-FileHash $RuntimeCss  -Algorithm SHA256).Hash

Write-Output "RUNTIME_MAIN_SHA256: $runtimeMainHash"
Write-Output "RUNTIME_CSS_SHA256: $runtimeCssHash"
Write-Output ""

$mainMatch = $projectMainHash -eq $runtimeMainHash
$cssMatch  = $projectCssHash  -eq $runtimeCssHash

Write-Output "DEPLOY_HASH_MAIN_MATCH: $mainMatch"
Write-Output "DEPLOY_HASH_CSS_MATCH: $cssMatch"

if (-not $mainMatch) { throw "DEPLOY_HASH_MISMATCH: main.js project=$projectMainHash runtime=$runtimeMainHash" }
if (-not $cssMatch)  { throw "DEPLOY_HASH_MISMATCH: style.css project=$projectCssHash runtime=$runtimeCssHash" }

Write-Output ""
Write-Output "TEST VAULT DEPLOY COMPLETE"
Write-Output "========================================"

# ── IDENTITY INVENTORY — every InkChapter copy that can be loaded ───────────
# Read-only. Prints path + SHA256 + enabled-state for each install root so the
# two Typora windows (vault path vs normal path) can be compared on real data.
Write-Output ""
Write-Output "========================================"
Write-Output "IDENTITY INVENTORY (all InkChapter copies)"
Write-Output "========================================"

$coreVersion = "unknown"
$loaderJson = Join-Path $GlobalRoot "loader.json"
if (Test-Path $loaderJson) {
    try { $coreVersion = (Get-Content $loaderJson -Raw -Encoding UTF8 | ConvertFrom-Json).coreVersion } catch { }
}

$globalPluginDir = Join-Path $GlobalRoot "plugins\$PluginId"
$candidates = @(
    [PSCustomObject]@{ Root = 'PROJECT_DIST';        Dir = (Join-Path $ProjectRoot "dist") },
    [PSCustomObject]@{ Root = 'TEST_VAULT';          Dir = $RuntimeRoot },
    [PSCustomObject]@{ Root = 'GLOBAL_PLUGIN';       Dir = $globalPluginDir },
    [PSCustomObject]@{ Root = 'GLOBAL_STALE_COREVER'; Dir = (Join-Path $GlobalRoot "$coreVersion\typora-plugin-inkchapter") }
)

$globalSettings = Join-Path $GlobalRoot "settings\plugins.json"
$globalEnabled = $false
if (Test-Path $globalSettings) {
    try { $globalEnabled = [bool]((Get-Content $globalSettings -Raw -Encoding UTF8 | ConvertFrom-Json).$PluginId) } catch { }
}
$vaultSettings = Join-Path $ProjectRoot "test\vault\.typora\plugins.json"
$vaultEnabled = $false
if (Test-Path $vaultSettings) {
    try { $vaultEnabled = [bool]((Get-Content $vaultSettings -Raw -Encoding UTF8 | ConvertFrom-Json).$PluginId) } catch { }
}

foreach ($c in $candidates) {
    $m = Join-Path $c.Dir "main.js"
    if (Test-Path $m) {
        $h = (Get-FileHash $m -Algorithm SHA256).Hash
        $exists = $true
    } else {
        $h = 'MISSING'
        $exists = $false
    }
    Write-Output ("{0,-22} | {1,64} | {2}" -f $c.Root, $h, $c.Dir)
}
Write-Output ""
Write-Output "GLOBAL_ENABLED: $globalEnabled   (settings\plugins.json)"
Write-Output "VAULT_ENABLED:  $vaultEnabled   (test\vault\.typora\plugins.json)"
Write-Output ""

# ── Duplicate / priority-conflict verdict ─────────────────────────────────
$staleCorever = Join-Path $GlobalRoot "$coreVersion\typora-plugin-inkchapter"
if (Test-Path $staleCorever) {
    Write-Output "DUPLICATE_COPY_DETECTED: $staleCorever"
    Write-Output "  note: this lives under the CORE version dir and is NOT scanned by the"
    Write-Output "        framework (global plugins dir is <userData>\plugins\plugins)."
    Write-Output "        It is a dead dev artifact and should be removed to avoid confusion."
    Write-Output ""
}

# ── OPTIONAL: GLOBAL (user-level) install ─────────────────────────────────
if (-not $RunGlobal) {
    Write-Output "GLOBAL_DEPLOY: skipped (pass -Global -ApproveGlobal to also install user-level)"
    Write-Output "========================================"
    return
}

Write-Output ""
Write-Output "========================================"
Write-Output "GLOBAL (USER-LEVEL) DEPLOY"
Write-Output "========================================"

if (-not $ApproveGlobal) {
    Write-Output ""
    Write-Output "GLOBAL_DEPLOY_NOT_APPROVED"
    Write-Output "  Refusing to overwrite the PRODUCTION (user-level) install."
    Write-Output "  Re-run with BOTH flags to approve:"
    Write-Output "      & .\scripts\deploy-test-vault.ps1 -Global -ApproveGlobal"
    Write-Output ""
    throw "GLOBAL_DEPLOY_NOT_APPROVED: missing -ApproveGlobal"
}

if ($IsDevBuild) {
    Write-Output ""
    Write-Output "GLOBAL_DEPLOY_FROM_TEST_BUILD_REFUSED"
    Write-Output "  dist\main.js.map is present => this is a DEVELOPMENT/TEST build."
    Write-Output "  Build production first:  pnpm run build   (then: -Global -ApproveGlobal)"
    Write-Output ""
    throw "GLOBAL_DEPLOY_FROM_TEST_BUILD_REFUSED"
}

if (-not (Test-Path $GlobalRoot)) {
    throw "GLOBAL_ROOT_NOT_FOUND: $GlobalRoot (run the community framework installer first)"
}

$GlobalSettingsDir = Join-Path $GlobalRoot "settings"
$null = New-Item -ItemType Directory -Force -Path $globalPluginDir
$null = New-Item -ItemType Directory -Force -Path $GlobalSettingsDir

Copy-Item $ProjectMain   (Join-Path $globalPluginDir "main.js")       -Force
Copy-Item $ProjectCss    (Join-Path $globalPluginDir "style.css")     -Force
Copy-Item $ManifestSrc   (Join-Path $globalPluginDir "manifest.json") -Force

Write-Output "GLOBAL_PLUGIN_DIR: $globalPluginDir"
Write-Output "GLOBAL_PLUGIN_ID: $PluginId"

# ── Enable in the GLOBAL config (merge, NEVER a BOM) ──────────────────────
$globalConfigPath = Join-Path $GlobalSettingsDir "plugins.json"
$enabled = @{}
if (Test-Path $globalConfigPath) {
    try {
        $existing = Get-Content $globalConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($prop in $existing.PSObject.Properties) { $enabled[$prop.Name] = $prop.Value }
    } catch {
        Write-Output "GLOBAL_CONFIG_UNREADABLE: $globalConfigPath (rewriting)"
    }
}
$enabled[$PluginId] = $true
$json = ($enabled | ConvertTo-Json -Depth 5)
[System.IO.File]::WriteAllText($globalConfigPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "GLOBAL_CONFIG: $globalConfigPath"
Write-Output "GLOBAL_CONFIG_BODY: $($json -replace '\s+', ' ')"

# ── Verify: hash parity + BOM-free JSON ───────────────────────────────────
$gMain = Join-Path $globalPluginDir "main.js"
$gCss  = Join-Path $globalPluginDir "style.css"
$gMainHash = (Get-FileHash $gMain -Algorithm SHA256).Hash
$gCssHash  = (Get-FileHash $gCss  -Algorithm SHA256).Hash
$globalMainMatch = $projectMainHash -eq $gMainHash
$globalCssMatch  = $projectCssHash  -eq $gCssHash
$bytes = [System.IO.File]::ReadAllBytes($globalConfigPath)
$hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF

Write-Output "GLOBAL_MAIN_SHA256: $gMainHash"
Write-Output "GLOBAL_CSS_SHA256: $gCssHash"
Write-Output "GLOBAL_HASH_MAIN_MATCH: $globalMainMatch"
Write-Output "GLOBAL_HASH_CSS_MATCH: $globalCssMatch"
Write-Output "GLOBAL_CONFIG_HAS_BOM: $hasBom"

if (-not $globalMainMatch) { throw "GLOBAL_DEPLOY_HASH_MISMATCH: main.js" }
if (-not $globalCssMatch)  { throw "GLOBAL_DEPLOY_HASH_MISMATCH: style.css" }
if ($hasBom)               { throw "GLOBAL_CONFIG_HAS_BOM: $globalConfigPath" }

# ── Cross-root parity: the whole point of this script ─────────────────────
$crossRootMatch = ($runtimeMainHash -eq $gMainHash) -and ($runtimeCssHash -eq $gCssHash)
Write-Output "CROSS_ROOT_MAIN_PARITY: $crossRootMatch"
if (-not $crossRootMatch) {
    Write-Output "TWO_VERSIONS_INSTALLED: vault=$runtimeMainHash global=$gMainHash"
}

# ── Runtime staleness — has the RUNNING Typora picked up this build? ───────
# The plugin writes `<installRoot>/../../inkchapter-runtime-load.json` on every
# load. If its recorded SHA differs from the just-deployed one, Typora is still
# running the PREVIOUS build and must be restarted for the deploy to take effect.
$runtimeLoadPath = Join-Path $GlobalRoot "inkchapter-runtime-load.json"
if (Test-Path $runtimeLoadPath) {
    try {
        $rl = Get-Content $runtimeLoadPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $runningSha = [string]$rl.mainJsSha256
        $reloaded = ($runningSha -eq $gMainHash)
        Write-Output "GLOBAL_RUNNING_SHA256: $runningSha"
        Write-Output "GLOBAL_RUNTIME_RELOADED: $reloaded"
        if (-not $reloaded) {
            Write-Output "TYPORA_RESTART_REQUIRED: running build $runningSha != deployed $gMainHash — restart Typora."
        }
    } catch {
        Write-Output "GLOBAL_RUNTIME_LOAD_UNREADABLE: $runtimeLoadPath"
    }
} else {
    Write-Output "GLOBAL_RUNTIME_LOAD_MISSING: $runtimeLoadPath (plugin has not loaded in GLOBAL mode yet)"
}

Write-Output ""
Write-Output "GLOBAL DEPLOY COMPLETE"
Write-Output "========================================"
