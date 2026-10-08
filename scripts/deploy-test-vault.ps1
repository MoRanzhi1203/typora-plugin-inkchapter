# ============================================================================
# deploy-test-vault.ps1
# R59: Deploy built dist to the correct test-vault runtime path.
# Hard assertion on runtime root — any wrong path throws immediately.
#
# Optional GLOBAL install (user-level / any document, incl. non-vault paths):
#   & .\scripts\deploy-test-vault.ps1 --global    (or -Global)
# Copies manifest/main/style into the community framework's GLOBAL plugins dir
# and enables the plugin in the GLOBAL config (`settings/plugins.json`).
# GLOBAL_JSON must be written WITHOUT a BOM: the framework does a bare
# `JSON.parse(readTextSync(...))`, and a leading U+FEFF makes it throw -> the
# plugin would be silently discovered but never enabled.
# ============================================================================

$ErrorActionPreference = "Stop"

$RunGlobal = ($args -contains '-Global') -or ($args -contains '--global')

# ── Single source of truth paths ──────────────────────────────────────────
$ProjectRoot    = "D:\TyporaPluginProjects\typora-plugin-inkchapter"
$ExpectedRuntimeRoot = "D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist"
$WrongLegacyPath = "D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault.typora"

$ProjectMain  = Join-Path $ProjectRoot "dist\main.js"
$ProjectCss   = Join-Path $ProjectRoot "dist\style.css"
$RuntimeRoot  = Join-Path $ProjectRoot "test\vault\.typora\plugins\dist"
$RuntimeMain  = Join-Path $RuntimeRoot "main.js"
$RuntimeCss   = Join-Path $RuntimeRoot "style.css"

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
    $legacyCss  = Join-Path $WrongLegacyPath "plugins\dist\style.css"
    Write-Output "  main.js exists: $(Test-Path $legacyMain)"
    Write-Output "  style.css exists: $(Test-Path $legacyCss)"
    if (Test-Path $legacyMain) {
        Write-Output "  main.js last write: $((Get-Item $legacyMain).LastWriteTime)"
    }
    Write-Output "  ACTION: NOT deploying to this path. Recommend manual cleanup."
    Write-Output ""
}

# ── Verify source files exist ──────────────────────────────────────────────
if (-not (Test-Path $ProjectMain)) {
    throw "PROJECT_MAIN_NOT_FOUND: $ProjectMain"
}
if (-not (Test-Path $ProjectCss)) {
    throw "PROJECT_CSS_NOT_FOUND: $ProjectCss"
}

Write-Output "PROJECT_MAIN: $ProjectMain"
Write-Output "PROJECT_STYLE: $ProjectCss"
Write-Output ""

# ── Ensure target directory ────────────────────────────────────────────────
$null = New-Item -ItemType Directory -Force -Path $RuntimeRoot

# ── Compute project hashes BEFORE copy ─────────────────────────────────────
$projectMainHash = (Get-FileHash $ProjectMain -Algorithm SHA256).Hash
$projectCssHash  = (Get-FileHash $ProjectCss -Algorithm SHA256).Hash

Write-Output "PROJECT_MAIN_SHA256: $projectMainHash"
Write-Output "PROJECT_CSS_SHA256: $projectCssHash"
Write-Output ""

# ── Deploy ─────────────────────────────────────────────────────────────────
Copy-Item $ProjectMain $RuntimeMain -Force
Copy-Item $ProjectCss  $RuntimeCss  -Force

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

if (-not $mainMatch) {
    throw "DEPLOY_HASH_MISMATCH: main.js project=$projectMainHash runtime=$runtimeMainHash"
}
if (-not $cssMatch) {
    throw "DEPLOY_HASH_MISMATCH: style.css project=$projectCssHash runtime=$runtimeCssHash"
}

Write-Output ""
Write-Output "DEPLOY COMPLETE"
Write-Output "========================================"

# ── OPTIONAL: GLOBAL (user-level) install ─────────────────────────────────
# Makes InkChapter start for ANY document, including files outside a vault
# (no local `.typora`). The community framework loads `<userData>/plugins`
# (= the `%APPDATA%\Typora\plugins` symlink to `~/.typora/community-plugins`).
if (-not $RunGlobal) {
    Write-Output ""
    Write-Output "GLOBAL_DEPLOY: skipped (pass --global to also install user-level)"
    return
}

Write-Output ""
Write-Output "========================================"
Write-Output "GLOBAL (USER-LEVEL) DEPLOY"
Write-Output "========================================"

$GlobalRoot = Join-Path $env:APPDATA "Typora\plugins"
if (-not (Test-Path $GlobalRoot)) {
    throw "GLOBAL_ROOT_NOT_FOUND: $GlobalRoot (run the community framework installer first)"
}
$ManifestSrc = Join-Path $ProjectRoot "src\manifest.json"
if (-not (Test-Path $ManifestSrc)) {
    throw "PROJECT_MANIFEST_NOT_FOUND: $ManifestSrc"
}
$PluginId = (Get-Content $ManifestSrc -Raw | ConvertFrom-Json).id
if (-not $PluginId) {
    throw "MANIFEST_ID_MISSING: $ManifestSrc"
}

$GlobalPluginDir = Join-Path $GlobalRoot "plugins\$PluginId"
$GlobalSettingsDir = Join-Path $GlobalRoot "settings"
$null = New-Item -ItemType Directory -Force -Path $GlobalPluginDir
$null = New-Item -ItemType Directory -Force -Path $GlobalSettingsDir

Copy-Item $ProjectMain   (Join-Path $GlobalPluginDir "main.js")       -Force
Copy-Item $ProjectCss    (Join-Path $GlobalPluginDir "style.css")     -Force
Copy-Item $ManifestSrc   (Join-Path $GlobalPluginDir "manifest.json") -Force

Write-Output "GLOBAL_PLUGIN_DIR: $GlobalPluginDir"
Write-Output "GLOBAL_PLUGIN_ID: $PluginId"

# ── Enable in the GLOBAL config (merge, NEVER a BOM) ──────────────────────
$globalConfigPath = Join-Path $GlobalSettingsDir "plugins.json"
$enabled = @{}
if (Test-Path $globalConfigPath) {
    try {
        $existing = Get-Content $globalConfigPath -Raw | ConvertFrom-Json
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
$gMain = Join-Path $GlobalPluginDir "main.js"
$gCss  = Join-Path $GlobalPluginDir "style.css"
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

# ── Runtime staleness — has the RUNNING Typora picked up this build? ───────
# The plugin writes `<userData>/plugins/inkchapter-runtime-load.json` (pluginRoot/../..)
# on every load. If its recorded SHA differs from the just-deployed one, Typora is
# still running the PREVIOUS build and must be restarted for the deploy to take effect.
$runtimeLoadPath = Join-Path $GlobalRoot "inkchapter-runtime-load.json"
if (Test-Path $runtimeLoadPath) {
    try {
        $rl = Get-Content $runtimeLoadPath -Raw | ConvertFrom-Json
        $runningSha = [string]$rl.mainJsSha256
        $reloaded = ($runningSha -eq $globalMainHash)
        Write-Output "GLOBAL_RUNNING_SHA256: $runningSha"
        Write-Output "GLOBAL_RUNTIME_RELOADED: $reloaded"
        if (-not $reloaded) {
            Write-Output "TYPORA_RESTART_REQUIRED: running build $runningSha != deployed $globalMainHash — restart Typora."
        }
    } catch {
        Write-Output "GLOBAL_RUNTIME_LOAD_UNREADABLE: $runtimeLoadPath"
    }
} else {
    Write-Output "GLOBAL_RUNTIME_LOAD_MISSING: $runtimeLoadPath (plugin has not loaded in GLOBAL mode yet)"}

Write-Output ""
Write-Output "GLOBAL DEPLOY COMPLETE"
Write-Output "========================================"
