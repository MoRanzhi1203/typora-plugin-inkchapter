param(
  [Parameter(Mandatory=$true)]
  [string]$VaultPath,

  [switch]$ForceRefresh
)

$ErrorActionPreference = "Stop"

# -- Source directory (resolved from script location) --
$srcDir = Join-Path -Path $PSScriptRoot -ChildPath "..\test-documents\manual"
$srcDir = [System.IO.Path]::GetFullPath($srcDir)
if (-not (Test-Path -LiteralPath $srcDir -PathType Container)) {
  Write-Error "Source directory not found: $srcDir"
  exit 1
}

# -- Target folder name via Unicode codepoints: 墨(U+58A8) 章(U+7AE0) 插(U+63D2) 件(U+4EF6) 测(U+6D4B) 试(U+8BD5) --
$TargetFolderName = -join @(
  [char]0x58A8,
  [char]0x7AE0,
  [char]0x63D2,
  [char]0x4EF6,
  [char]0x6D4B,
  [char]0x8BD5
)

$TargetDir = Join-Path -Path $VaultPath -ChildPath $TargetFolderName

if (-not (Test-Path -LiteralPath $VaultPath -PathType Container)) {
  Write-Error "Vault path does not exist: $VaultPath"
  exit 1
}

# -- Get source files from filesystem (not hardcoded names) --
$sourceFiles = Get-ChildItem -LiteralPath $srcDir -File |
  Where-Object { $_.Name -match '^(README|0[1-8])-.*\.md$' } |
  Sort-Object Name

if ($sourceFiles.Count -ne 9) {
  Write-Error "Expected 9 source files, found $($sourceFiles.Count)"
  exit 1
}

# -- Ensure target directory exists --
if (-not (Test-Path -LiteralPath $TargetDir -PathType Container)) {
  New-Item -ItemType Directory -Path $TargetDir -Force -ErrorAction SilentlyContinue | Out-Null
}

$added = 0; $skipped = 0; $conflicts = 0; $overwritten = 0
$backupDir = $null

foreach ($srcFile in $sourceFiles) {
  $srcPath = $srcFile.FullName
  $fileName = $srcFile.Name
  $dstPath = Join-Path -Path $TargetDir -ChildPath $fileName

  if (-not (Test-Path -LiteralPath $dstPath -PathType Leaf)) {
    Copy-Item -LiteralPath $srcPath -Destination $dstPath
    Write-Output "[COPY] $fileName"
    $added++
    continue
  }

  $srcHash = (Get-FileHash -LiteralPath $srcPath -Algorithm SHA256).Hash
  $dstHash = (Get-FileHash -LiteralPath $dstPath -Algorithm SHA256).Hash

  if ($srcHash -eq $dstHash) {
    Write-Output "[SKIP] $fileName (identical)"
    $skipped++
    continue
  }

  if ($ForceRefresh) {
    if (-not $backupDir) {
      $ts = Get-Date -Format "yyyyMMdd-HHmmss"
      $backupDir = Join-Path -Path $TargetDir -ChildPath ".backup\$ts"
      New-Item -ItemType Directory -Path $backupDir -Force -ErrorAction SilentlyContinue | Out-Null
      Write-Output "[BACKUP] $backupDir"
    }
    Copy-Item -LiteralPath $dstPath -Destination (Join-Path -Path $backupDir -ChildPath $fileName)
    Copy-Item -LiteralPath $srcPath -Destination $dstPath -Force
    Write-Output "[OVERWRITE] $fileName (backed up)"
    $overwritten++
  } else {
    Write-Output "[CONFLICT] $fileName (content differs, use -ForceRefresh to overwrite)"
    $conflicts++
  }
}

Write-Output "---"
Write-Output "added=$added skipped=$skipped conflicts=$conflicts overwritten=$overwritten"
Write-Output "target=$TargetDir"

if ($backupDir) { Write-Output "backup=$backupDir" }

if ($conflicts -gt 0) { exit 1 } else { exit 0 }
