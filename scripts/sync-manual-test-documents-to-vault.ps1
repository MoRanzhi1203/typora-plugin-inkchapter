param(
  [Parameter(Mandatory=$true)]
  [string]$VaultPath,

  [switch]$ForceRefresh
)

$ErrorActionPreference = "Stop"

$srcDir = Join-Path $PSScriptRoot "..\test-documents\manual"
if (-not (Test-Path $srcDir)) {
  Write-Error "Source directory not found: $srcDir"
  exit 1
}

$targetDir = Join-Path $VaultPath "墨章插件测试"
if (-not (Test-Path $VaultPath)) {
  Write-Error "Vault path does not exist: $VaultPath"
  exit 1
}

$files = @(
  "README-测试说明.md",
  "01-中文学术论文模板.md",
  "02-技术博客模板.md",
  "03-项目报告模板.md",
  "04-课程讲义模板.md",
  "05-中英双语论文模板.md",
  "06-深层级结构压力测试.md",
  "07-重复标题与特殊标题测试.md",
  "08-标题有效级数限制测试.md"
)

New-Item -ItemType Directory -Path $targetDir -Force -ErrorAction SilentlyContinue | Out-Null

$added = 0; $skipped = 0; $conflicts = 0; $overwritten = 0
$backupDir = $null

foreach ($f in $files) {
  $srcPath = Join-Path $srcDir $f
  $dstPath = Join-Path $targetDir $f

  if (-not (Test-Path $dstPath)) {
    Copy-Item $srcPath $dstPath
    Write-Output "[COPY] $f"
    $added++
    continue
  }

  $srcHash = (Get-FileHash $srcPath -Algorithm SHA256).Hash
  $dstHash = (Get-FileHash $dstPath -Algorithm SHA256).Hash

  if ($srcHash -eq $dstHash) {
    Write-Output "[SKIP] $f (identical)"
    $skipped++
    continue
  }

  if ($ForceRefresh) {
    if (-not $backupDir) {
      $ts = Get-Date -Format "yyyyMMdd-HHmmss"
      $backupDir = Join-Path $targetDir ".backup\$ts"
      New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
      Write-Output "[BACKUP] $backupDir"
    }
    Copy-Item $dstPath (Join-Path $backupDir $f)
    Copy-Item $srcPath $dstPath -Force
    Write-Output "[OVERWRITE] $f (backed up)"
    $overwritten++
  } else {
    Write-Output "[CONFLICT] $f (content differs, use -ForceRefresh to overwrite)"
    $conflicts++
  }
}

Write-Output "---"
Write-Output "added=$added skipped=$skipped conflicts=$conflicts overwritten=$overwritten"
Write-Output "target=$targetDir"

if ($backupDir) { Write-Output "backup=$backupDir" }

exit ($conflicts -gt 0 ? 1 : 0)
