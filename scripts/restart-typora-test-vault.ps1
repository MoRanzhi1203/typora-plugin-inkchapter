# ============================================================================
# restart-typora-test-vault.ps1
# R59: Terminate old Typora, launch with test vault.
# Does NOT deploy, does NOT verify hashes, does NOT hardcode PASS.
# ============================================================================

$ErrorActionPreference = "Stop"

$TyporaExe   = "D:\Typora\Typora.exe"
$TargetVault = "D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault"

Write-Output "========================================"
Write-Output "RESTART-TYPORA-TEST-VAULT"
Write-Output "========================================"
Write-Output ""

# ── 1. Terminate old Typora ───────────────────────────────────────────────
$oldProcesses = Get-Process Typora -ErrorAction SilentlyContinue
if ($oldProcesses) {
    foreach ($p in $oldProcesses) {
        Write-Output "Terminating old Typora PID=$($p.Id) StartTime=$($p.StartTime) Title=$($p.MainWindowTitle)"
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 3
} else {
    Write-Output "No old Typora process found."
}

# ── 2. Confirm old PID exited ──────────────────────────────────────────────
$remaining = Get-Process Typora -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Output "WARNING: Typora processes still running after terminate:"
    foreach ($p in $remaining) {
        Write-Output "  PID=$($p.Id) Title=$($p.MainWindowTitle)"
    }
} else {
    Write-Output "oldProcessExited: true"
}
Write-Output ""

# ── 3. Launch target vault ─────────────────────────────────────────────────
Write-Output "Launching Typora with vault: $TargetVault"
Start-Process $TyporaExe -ArgumentList $TargetVault
Write-Output "Launch sent."
Write-Output ""

# ── 4. Wait for new process/window ─────────────────────────────────────────
$maxWait = 15
$waited = 0
$newProcess = $null
while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 2
    $waited += 2
    $newProcess = Get-Process Typora -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1
    if ($newProcess) {
        break
    }
    Write-Output "Waiting for Typora window... (${waited}s)"
}

if ($newProcess) {
    Write-Output ""
    Write-Output "New Typora detected:"
    Write-Output "  PID: $($newProcess.Id)"
    Write-Output "  StartTime: $($newProcess.StartTime)"
    Write-Output "  MainWindowHandle: $($newProcess.MainWindowHandle)"
    Write-Output "  MainWindowTitle: $($newProcess.MainWindowTitle)"
} else {
    Write-Output ""
    Write-Output "Typora did not start within ${maxWait}s."
}

Write-Output ""
Write-Output "========================================"
