# TRAE — Figure Standalone Runtime Fixture Projection (V2.1 §3)
#
# The runtime fixture lives under `runtime/smoke/` (which is NOT the plugin vault
# root, so the plugin does not load there). To exercise it in real Typora the
# bundle must be projected to the vault ROOT *together with its relative assets*
# — copying only the Markdown breaks `assets/phase7-strict-h1-boundary/*.png`
# and produces ERR_FILE_NOT_FOUND + FIGURE_LOCAL_IMAGE_MISSING warnings.
#
# This is the ONE projection authority: idempotent, asset-complete, and it runs
# the resource preflight (V2.1 §4) as part of the projection.
#
# Usage:  pwsh -File scripts/runtime-fixtures/project-figure-standalone-runtime-fixture.ps1
#         pwsh -File ... -PreflightOnly

[CmdletBinding()]
param(
  [switch]$PreflightOnly
)

$ErrorActionPreference = 'Stop'

$repoRoot   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$vaultRoot  = Join-Path $repoRoot 'test\vault'
$sourceDir  = Join-Path $vaultRoot 'runtime\smoke'
$fixtureName = 'Figure-Standalone-Block-Invariant-Test.md'
$assetRelDir = 'assets\phase7-strict-h1-boundary'
$requiredAssets = @('boundary-a-figure.png', 'boundary-b-figure.png')

$sourceMd     = Join-Path $sourceDir $fixtureName
$projectedMd  = Join-Path $vaultRoot $fixtureName
$assetSrcDir  = Join-Path $sourceDir $assetRelDir
$assetDstDir  = Join-Path $vaultRoot $assetRelDir

$gate = [ordered]@{
  FIGURE_FIXTURE_PROJECTED_MD_MISSING_COUNT      = 0
  FIGURE_FIXTURE_REQUIRED_ASSET_MISSING_COUNT    = 0
  FIGURE_FIXTURE_RELATIVE_PATH_RESOLVE_FAIL_COUNT = 0
  FIGURE_FIXTURE_ZERO_BYTE_ASSET_COUNT           = 0
}
$failures = New-Object System.Collections.Generic.List[string]

function Fail-Gate([string]$key, [string]$why) {
  $script:gate[$key] = $script:gate[$key] + 1
  $script:failures.Add($why)
}

if (-not $PreflightOnly) {
  # ── projection (idempotent) ────────────────────────────────────────────────
  if (-not (Test-Path -LiteralPath $sourceMd)) {
    Fail-Gate 'FIGURE_FIXTURE_PROJECTED_MD_MISSING_COUNT' "authoritative markdown missing: $sourceMd"
  }
  if (-not (Test-Path -LiteralPath $assetSrcDir)) {
    Fail-Gate 'FIGURE_FIXTURE_REQUIRED_ASSET_MISSING_COUNT' "authoritative asset dir missing: $assetSrcDir"
  }

  if ($failures.Count -eq 0) {
    # Markdown is copied VERBATIM — projection must never rewrite business content.
    Copy-Item -LiteralPath $sourceMd -Destination $projectedMd -Force
    if (-not (Test-Path -LiteralPath $assetDstDir)) {
      New-Item -ItemType Directory -Path $assetDstDir -Force | Out-Null
    }
    foreach ($a in $requiredAssets) {
      $src = Join-Path $assetSrcDir $a
      if (-not (Test-Path -LiteralPath $src)) {
        Fail-Gate 'FIGURE_FIXTURE_REQUIRED_ASSET_MISSING_COUNT' "required asset missing at source: $src"
        continue
      }
      Copy-Item -LiteralPath $src -Destination (Join-Path $assetDstDir $a) -Force
    }
    Write-Output "FIGURE_FIXTURE_PROJECTION: copied md + $($requiredAssets.Count) required assets"
  }
}

# ── resource preflight (V2.1 §4) ─────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $projectedMd)) {
  Fail-Gate 'FIGURE_FIXTURE_PROJECTED_MD_MISSING_COUNT' "projected markdown missing: $projectedMd"
} else {
  $mdText = Get-Content -LiteralPath $projectedMd -Raw
  $docDir = Split-Path -Parent $projectedMd
  foreach ($a in $requiredAssets) {
    $rel = "$assetRelDir\$a"
    $resolved = Join-Path $docDir $rel
    if (-not (Test-Path -LiteralPath $resolved)) {
      Fail-Gate 'FIGURE_FIXTURE_RELATIVE_PATH_RESOLVE_FAIL_COUNT' "relative path does not resolve: $rel"
      Fail-Gate 'FIGURE_FIXTURE_REQUIRED_ASSET_MISSING_COUNT' "projected asset missing: $resolved"
      continue
    }
    $item = Get-Item -LiteralPath $resolved
    if ($item.Length -le 0) {
      Fail-Gate 'FIGURE_FIXTURE_ZERO_BYTE_ASSET_COUNT' "zero-byte asset: $resolved"
    }
    # the projected markdown must reference this asset by the SAME relative path
    if ($mdText -notmatch [regex]::Escape("$assetRelDir/$a".Replace('\', '/'))) {
      Fail-Gate 'FIGURE_FIXTURE_RELATIVE_PATH_RESOLVE_FAIL_COUNT' "markdown does not reference $rel"
    }
  }
}

$decision = if ($failures.Count -eq 0) { 'PASS' } else { 'FAIL' }
Write-Output 'FIGURE_FIXTURE_RESOURCE_PREFLIGHT'
Write-Output ("  source    = " + $sourceMd)
Write-Output ("  projected = " + $projectedMd)
Write-Output ("  assets    = " + $assetDstDir)
foreach ($k in $gate.Keys) { Write-Output ("  {0}={1}" -f $k, $gate[$k]) }
Write-Output ("PREFLIGHT_DECISION=" + $decision)
if ($failures.Count -gt 0) {
  foreach ($f in $failures) { Write-Output ("  FAIL: " + $f) }
  exit 1
}
