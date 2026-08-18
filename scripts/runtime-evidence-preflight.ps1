# ============================================================================
# runtime-evidence-preflight.ps1
# v2.5.7-R5.4.3.5 P0: Runtime Evidence Path / Permission Authority
#
# Establishes D:\TyporaPluginProjects\typora-plugin-inkchapter\artifacts\formula-runtime\
# as the SINGLE output root for automated runtime evidence. Runs a real
# write / read / delete probe BEFORE any Typora launch. NEVER uses Windows
# Save/Save As dialogs. NEVER writes to C:\Users or protected paths.
# ============================================================================

$ErrorActionPreference = 'Stop'

$ProjectRoot = Resolve-Path "$PSScriptRoot\.."
$OutputRoot  = Join-Path $ProjectRoot 'artifacts\formula-runtime'

Write-Output '========================================'
Write-Output 'RUNTIME-EVIDENCE-PATH-AUTHORITY'
Write-Output "outputRoot=$OutputRoot"
Write-Output '========================================'

# ── 1. Guard: never allow C:\Users / Desktop / Downloads / AppData ───────
$protected = @('^C:\\Users\\', '^C:\\', 'Desktop', 'Downloads', 'AppData')
foreach ($p in $protected) {
    if ($OutputRoot -match $p) {
        Write-Output "PROTECTED_PATH_DETECTED pattern=$p path=$OutputRoot"
        Write-Output 'RUNTIME-EVIDENCE-PATH-AUTHORITY decision=FAIL reason=PROTECTED_OUTPUT_ROOT'
        exit 1
    }
}

# ── 2. Create output root ─────────────────────────────────────────────────
try {
    New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
} catch {
    Write-Output "MKDIR_FAILED $($_.Exception.Message)"
    Write-Output 'RUNTIME-EVIDENCE-PATH-AUTHORITY decision=FAIL reason=MKDIR_FAILED'
    exit 1
}
$dirExists = Test-Path $OutputRoot

# ── 3. Real write / read / delete probe ───────────────────────────────────
$probePath = Join-Path $OutputRoot ".evidence-probe-$PID.tmp"
$writeOk = $false
$readOk  = $false
$deleteOk = $false
try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("R5.4.3.5 evidence probe pid=$PID`n")
    [System.IO.File]::WriteAllBytes($probePath, $bytes)
    $writeOk = $true
    $readBytes = [System.IO.File]::ReadAllBytes($probePath)
    $readOk = ($readBytes.Length -eq $bytes.Length)
} catch {
    Write-Output "WRITE_PROBE_FAILED $($_.Exception.Message)"
} finally {
    if (Test-Path $probePath) {
        try { Remove-Item -LiteralPath $probePath -Force; $deleteOk = -not (Test-Path $probePath) } catch { $deleteOk = $false }
    } else {
        $deleteOk = $true
    }
}

# ── 4. Guard: never interactive save dialog / elevation ──────────────────
$interactiveSaveDialogUsed = $false
$requiresElevation = $false

$decision = if ($dirExists -and $writeOk -and $readOk -and $deleteOk) { 'PASS' } else { 'FAIL' }
$reason = if ($decision -eq 'PASS') { 'null' } else { "dirExists=$dirExists write=$writeOk read=$readOk delete=$deleteOk" }

$result = [PSCustomObject]@{
    marker                       = 'RUNTIME-EVIDENCE-PATH-AUTHORITY'
    outputRoot                   = $OutputRoot
    directoryExists              = $dirExists
    writeProbeSucceeded          = $writeOk
    readBackSucceeded            = $readOk
    deleteProbeSucceeded         = $deleteOk
    requiresElevation            = $requiresElevation
    interactiveSaveDialogUsed    = $interactiveSaveDialogUsed
    decision                     = $decision
    reason                       = $reason
}

$result | ConvertTo-Json -Depth 4
Write-Output ''
if ($decision -eq 'PASS') {
    Write-Output 'RUNTIME-EVIDENCE-PATH-AUTHORITY decision=PASS'
} else {
    Write-Output 'RUNTIME-EVIDENCE-PATH-AUTHORITY decision=FAIL — stopping, will NOT launch runtime acceptance.'
    exit 1
}
Write-Output '========================================'
