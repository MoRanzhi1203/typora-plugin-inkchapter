# ============================================================================
# deploy-test-vault.ps1
# R59: Deploy built dist to the correct test-vault runtime path.
# Hard assertion on runtime root — any wrong path throws immediately.
# ============================================================================

$ErrorActionPreference = "Stop"

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
