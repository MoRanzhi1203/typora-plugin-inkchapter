<#
.SYNOPSIS
    Verify Typora startup and InkChapter plugin loading for the test vault.
.DESCRIPTION
    This script performs the mandatory startup verification steps:
    1. Check and kill old Typora processes
    2. Build and deploy the plugin
    3. Verify SHA256 consistency
    4. Wait for Typora main window
    5. Report status as A/B/C/D
.PARAMETER SkipBuild
    Skip the build step (use when plugin is already built and deployed).
.PARAMETER SkipKill
    Skip killing existing Typora processes.
.PARAMETER NoTypora
    Do not start Typora (build verification only).
.EXAMPLE
    .\scripts\verify-typora-startup.ps1
    Full verification: kill old, build, deploy, start Typora, check window.
.EXAMPLE
    .\scripts\verify-typora-startup.ps1 -SkipBuild
    Only kill old Typora and start new one (assumes already built).
#>

[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipKill,
    [switch]$NoTypora
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Resolve-Path "$PSScriptRoot\.."
Set-Location $ProjectRoot

$Result = @{
    BuildPassed       = $false
    ProjectHash       = ''
    VaultHash         = ''
    HashMatch         = $false
    OldProcessExited  = $true
    NewProcessId      = $null
    NewProcessStart   = $null
    MainWindowHandle  = $null
    MainWindowTitle   = ''
    VaultConfirmed    = $false
    BuildMarker       = 'inkchapter-outline-fix-v4-dom-agnostic'
    MarkerAppeared    = $false
    MarkerCount       = 0
    FinalStatus       = 'A'
    FailureReason     = ''
    BuildStartTime    = Get-Date
}

Write-Output "========================================"
Write-Output " Typora Start Verification"
Write-Output " Project: $ProjectRoot"
Write-Output " Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Output "========================================"

# ── Step 0: Pre-flight ──────────────────────────
Write-Output ""
Write-Output "[Step 0] Pre-flight checks..."

$gitBranch = (git branch --show-current 2>$null) -replace '\* ', ''
$gitHead = (git rev-parse HEAD 2>$null).Substring(0, 7)
Write-Output "  Branch: $gitBranch"
Write-Output "  HEAD:   $gitHead"
Write-Output "  Node:   $(node --version)"
Write-Output "  pnpm:   $(pnpm --version)"

$modFiles = git status --short 2>$null | Select-String '^\s*M'
if ($modFiles) {
    Write-Output "  WARNING: Uncommitted modified files:"
    $modFiles | ForEach-Object { Write-Output "    $_" }
}

# ── Step 1: Kill old Typora ─────────────────────
if (-not $SkipKill) {
    Write-Output ""
    Write-Output "[Step 1] Checking for existing Typora processes..."
    $oldProcesses = Get-Process Typora -ErrorAction SilentlyContinue
    if ($oldProcesses) {
        Write-Output "  Found $($oldProcesses.Count) Typora process(es):"
        $oldProcesses | Select-Object Id, StartTime, MainWindowHandle, MainWindowTitle | ForEach-Object { Write-Output "    PID=$($_.Id) Start=$($_.StartTime) HWND=$($_.MainWindowHandle) Title=$($_.MainWindowTitle)" }

        Write-Output "  Killing old processes..."
        $oldProcesses | Stop-Process -Force -ErrorAction SilentlyContinue

        Write-Output "  Waiting for process exit (max 15s)..."
        $deadline = (Get-Date).AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 500
            $remaining = Get-Process Typora -ErrorAction SilentlyContinue
            if (-not $remaining) { break }
        } while ((Get-Date) -lt $deadline)

        if ($remaining) {
            $Result.FinalStatus = 'A'
            $Result.FailureReason = "Old Typora processes still running after 15s: $($remaining.Id -join ', ')"
            $Result.OldProcessExited = $false
            Write-Output "  FAILED: Old processes still running."
            Write-Output "  Final Status: $($Result.FinalStatus)"
            return $Result
        }
        Write-Output "  Old processes exited."
    } else {
        Write-Output "  No existing Typora processes."
    }
}

# ── Step 2: Build & deploy ──────────────────────
if (-not $SkipBuild) {
    Write-Output ""
    Write-Output "[Step 2] TypeScript check..."

    $tscResult = pnpm exec tsc --noEmit 2>&1
    if ($LASTEXITCODE -ne 0) {
        $Result.FinalStatus = 'A'
        $Result.FailureReason = "TypeScript check failed: $($tscResult -join '; ')"
        $Result.BuildPassed = $false
        Write-Output "  FAILED: tsc --noEmit"
        Write-Output "  $tscResult"
        Write-Output "  Final Status: $($Result.FinalStatus)"
        return $Result
    }
    Write-Output "  tsc --noEmit: PASS"

    Write-Output ""
    Write-Output "[Step 3] Build & deploy..."

    if ($NoTypora) {
        # Build without starting Typora
        $buildResult = pnpm run build 2>&1
    } else {
        $buildResult = pnpm run build:dev 2>&1
    }
    Write-Output "  Build output: $buildResult"
}

# ── Step 4: Verify SHA256 ───────────────────────
Write-Output ""
Write-Output "[Step 4] Verify SHA256..."

$distPath = "$ProjectRoot\dist\main.js"
$vaultPath = "$ProjectRoot\test\vault\.typora\plugins\dist\main.js"

if (Test-Path $distPath) {
    $Result.ProjectHash = (Get-FileHash $distPath -Algorithm SHA256).Hash
    Write-Output "  project dist SHA256: $($Result.ProjectHash)"
} else {
    Write-Output "  WARNING: dist\main.js not found"
}

if (Test-Path $vaultPath) {
    $Result.VaultHash = (Get-FileHash $vaultPath -Algorithm SHA256).Hash
    Write-Output "  vault plugin SHA256: $($Result.VaultHash)"
} else {
    Write-Output "  WARNING: vault plugin main.js not found"
}

if ($Result.ProjectHash -and $Result.VaultHash) {
    $Result.HashMatch = ($Result.ProjectHash -eq $Result.VaultHash)
    if ($Result.HashMatch) {
        Write-Output "  SHA256: MATCH"
    } else {
        Write-Output "  SHA256: MISMATCH — deployment may be incomplete"
        $Result.FailureReason = "dist and vault SHA256 mismatch"
    }
}

$Result.BuildPassed = $Result.HashMatch

# ── Step 5: Check for Typora window ─────────────
if (-not $NoTypora) {
    Write-Output ""
    Write-Output "[Step 5] Waiting for Typora main window (max 25s)..."

    $launchTime = Get-Date
    $deadline = $launchTime.AddSeconds(25)
    $windowProcess = $null

    do {
        Start-Sleep -Milliseconds 500

        $windowProcess = Get-Process Typora -ErrorAction SilentlyContinue |
          Where-Object {
            $_.MainWindowHandle -ne 0 -and
            $_.StartTime -ge $launchTime.AddSeconds(-3)
          } |
          Sort-Object StartTime -Descending |
          Select-Object -First 1

        if ($windowProcess) { break }
    } while ((Get-Date) -lt $deadline)

    if ($windowProcess) {
        $Result.NewProcessId = $windowProcess.Id
        $Result.NewProcessStart = $windowProcess.StartTime
        $Result.MainWindowHandle = $windowProcess.MainWindowHandle
        $Result.MainWindowTitle = $windowProcess.MainWindowTitle

        Write-Output "  PID:            $($Result.NewProcessId)"
        Write-Output "  StartTime:      $($Result.NewProcessStart)"
        Write-Output "  MainWindowHandle: $($Result.MainWindowHandle)"
        Write-Output "  MainWindowTitle:  $($Result.MainWindowTitle)"

        # Check if title contains test vault info
        if ($Result.MainWindowTitle -match 'vault|doc\.md|inkchapter') {
            $Result.VaultConfirmed = $true
            Write-Output "  Vault check: title contains vault/doc indicator"
        } elseif ($Result.MainWindowTitle) {
            Write-Output "  Vault check: title present but vault indicator not confirmed"
        }

        if ($Result.HashMatch -and $Result.VaultConfirmed) {
            $Result.FinalStatus = 'C'
        } else {
            $Result.FinalStatus = 'B'
        }
    } else {
        $Result.FinalStatus = 'A'
        $Result.FailureReason = 'Typora main window not detected within 25s'
        Write-Output "  Typora main window NOT detected within 25s."
    }
} else {
    Write-Output ""
    Write-Output "[Step 5] Skipped (NoTypora mode)"
    if ($Result.HashMatch) {
        $Result.FinalStatus = 'A'
    }
}

# ── Final report ────────────────────────────────
Write-Output ""
Write-Output "========================================"
Write-Output " Verification Result"
Write-Output "========================================"
Write-Output " Build passed:      $($Result.BuildPassed)"
Write-Output " SHA256 match:      $($Result.HashMatch)"
Write-Output " Old process exited: $($Result.OldProcessExited)"
Write-Output " New PID:           $($Result.NewProcessId)"
Write-Output " MainWindowHandle:  $($Result.MainWindowHandle)"
Write-Output " MainWindowTitle:   $($Result.MainWindowTitle)"
Write-Output " Vault confirmed:   $($Result.VaultConfirmed)"
Write-Output " Build marker:      $($Result.BuildMarker)"
Write-Output " Marker confirmed:  $($Result.MarkerAppeared) (requires user check)"
Write-Output ""
Write-Output " Final Status:      $($Result.FinalStatus)"
if ($Result.FailureReason) {
    Write-Output " Failure reason:    $($Result.FailureReason)"
}
Write-Output "========================================"

# Status description (ASCII-only for PS 5.1 compatibility)
$statusDescriptions = @{
    'A' = 'Status A: Startup command issued, main window not yet confirmed.'
    'B' = 'Status B: Main window confirmed, vault and plugin not yet verified.'
    'C' = 'Status C: Target vault confirmed, plugin build marker not yet verified.'
    'D' = 'Status D: Typora started, target vault opened, plugin loaded and confirmed.'
}
Write-Output ""
Write-Output " Conclusion: $($statusDescriptions[$Result.FinalStatus])"

# Only status D requires manual user confirmation of build marker
if ($Result.FinalStatus -eq 'C') {
    Write-Output ""
    Write-Output " Next step: Please open Typora Developer Tools (Ctrl+Shift+I)"
    Write-Output " and confirm the console shows:"
    Write-Output "   [InkChapter] onload START  build=$($Result.BuildMarker)"
}

return $Result
