#Requires -Version 5.1
# r58-process-verifier.ps1
# External black-box process management for the R58 A1 matrix runner.
# Read-only discovery + close/start/wait for the Typora renderer process.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ── Path constants (derived from the single legal runtime root) ──────────────
$script:R58Root = 'D:\TyporaPluginProjects\typora-plugin-inkchapter'
$script:R58Vault = Join-Path $script:R58Root 'test\vault'
$script:R58DotTypora = Join-Path $script:R58Vault '.typora'
$script:R58WrongPath = Join-Path $script:R58Root 'test\vault.typora'
$script:R58TyporaExe = 'D:\Typora\Typora.exe'
$script:R58RuntimeMain = Join-Path $script:R58DotTypora 'plugins\dist\main.js'
$script:R58RuntimeStyle = Join-Path $script:R58DotTypora 'plugins\dist\style.css'
$script:R58ProjectMain = Join-Path $script:R58Root 'dist\main.js'
$script:R58ProjectStyle = Join-Path $script:R58Root 'dist\style.css'
$script:R58RuntimeLoad = Join-Path $script:R58DotTypora 'inkchapter-runtime-load.json'
$script:R58SidecarDir = Join-Path $script:R58DotTypora 'inkchapter\paragraph-layout'

# ── Frozen provenance values ──────────────────────────────────────────────────
$script:R58BuildId = 'inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq'
$script:R58ExpectedMainSha = '238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B'
$script:R58ExpectedStyleSha = 'F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0'

# ── Path authority check ──────────────────────────────────────────────────────
function Test-R58PathAuthority {
    $wrongExists = Test-Path -LiteralPath $script:R58WrongPath
    $dotExists = Test-Path -LiteralPath $script:R58DotTypora
    $vaultExists = Test-Path -LiteralPath $script:R58Vault
    return [pscustomobject]@{
        root = $script:R58Root
        vault = $script:R58Vault
        dotTypora = $script:R58DotTypora
        wrongPath = $script:R58WrongPath
        wrongPathExists = $wrongExists
        vaultExists = $vaultExists
        dotTyporaExists = $dotExists
        authorityPathPass = ($dotExists -and $vaultExists -and (-not $wrongExists))
    }
}

# ── Typora process discovery ──────────────────────────────────────────────────
function Get-R58TyporaProcesses {
    $procs = @(Get-Process Typora -ErrorAction SilentlyContinue)
    $result = @()
    foreach ($p in $procs) {
        try {
            $result += [pscustomobject]@{
                Id = $p.Id
                StartTime = $p.StartTime
                MainWindowHandle = $p.MainWindowHandle
                MainWindowTitle = $p.MainWindowTitle
            }
        } catch {
            $result += [pscustomobject]@{
                Id = $p.Id
                StartTime = $null
                MainWindowHandle = 0
                MainWindowTitle = ''
            }
        }
    }
    return $result
}

function Get-R58TyporaMainWindow {
    $procs = @(Get-Process Typora -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($procs.Count -gt 0) {
        $p = $procs[0]
        return [pscustomobject]@{
            Id = $p.Id
            StartTime = $p.StartTime
            MainWindowHandle = $p.MainWindowHandle
            MainWindowTitle = $p.MainWindowTitle
        }
    }
    return $null
}

# ── Close Typora and wait for full exit ────────────────────────────────────────
function Stop-R58Typora {
    param([int]$OldPid = 0)
    $before = @(Get-Process Typora -ErrorAction SilentlyContinue)
    if ($before.Count -eq 0) {
        return [pscustomobject]@{
            oldPid = $OldPid
            oldPidStillExists = $false
            typoraCountBeforeClose = 0
            typoraCountAfterClose = 0
            closed = $true
        }
    }
    # Record all current PIDs (for old-process verification)
    $pids = @($before | ForEach-Object { $_.Id })
    foreach ($p in $before) {
        try { $p.CloseMainWindow() | Out-Null } catch { }
    }
    Start-Sleep -Milliseconds 800
    $stillRunning = @(Get-Process Typora -ErrorAction SilentlyContinue)
    if ($stillRunning.Count -gt 0) {
        foreach ($p in $stillRunning) {
            try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
    # Wait for all Typora processes to exit
    $deadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 300
        $remaining = @(Get-Process Typora -ErrorAction SilentlyContinue)
    } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)

    $after = @(Get-Process Typora -ErrorAction SilentlyContinue)
    $oldStillExists = $false
    if ($OldPid -gt 0) {
        $oldStillExists = $null -ne (Get-Process -Id $OldPid -ErrorAction SilentlyContinue)
    } else {
        foreach ($oldId in $pids) {
            if ($null -ne (Get-Process -Id $oldId -ErrorAction SilentlyContinue)) {
                $oldStillExists = $true
                break
            }
        }
    }
    return [pscustomobject]@{
        oldPid = $(if ($OldPid -gt 0) { $OldPid } else { $pids -join ',' })
        oldPidStillExists = $oldStillExists
        typoraCountBeforeClose = $before.Count
        typoraCountAfterClose = $after.Count
        closed = ($after.Count -eq 0 -and (-not $oldStillExists))
    }
}

# ── Start Typora on a specific fixture (NORMAL launch, NO debugging flags) ─────
function Start-R58TyporaFixture {
    param(
        [Parameter(Mandatory = $true)][string]$FixtureName,
        [int]$DebugPort = 9222
    )
    $fixturePath = Join-Path $script:R58Vault $FixtureName
    if (-not (Test-Path -LiteralPath $fixturePath)) {
        throw "Fixture not found: $fixturePath"
    }
    # Normal launch only: Typora rejects --remote-debugging-port / --inspect*.
    $args = @($fixturePath)
    try {
        $proc = Start-Process -FilePath $script:R58TyporaExe -ArgumentList $args -PassThru
    } catch {
        throw "Failed to start Typora: $($_.Exception.Message)"
    }
    return $proc
}

# ── Wait for the main window to appear ────────────────────────────────────────
function Wait-R58TyporaMainWindow {
    param(
        [int]$TimeoutSeconds = 30,
        [string]$ExpectedFixture = ''
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 500
        $main = Get-R58TyporaMainWindow
        if ($main -and $main.MainWindowHandle -ne 0) {
            if ($ExpectedFixture -eq '' -or $main.MainWindowTitle -like "*$ExpectedFixture*") {
                return $main
            }
        }
    } while ((Get-Date) -lt $deadline)
    return $null
}

# ── Read runtime-load.json ─────────────────────────────────────────────────────
function Get-R58RuntimeLoad {
    if (-not (Test-Path -LiteralPath $script:R58RuntimeLoad)) {
        return [pscustomobject]@{
            runtimeLoadPath = $script:R58RuntimeLoad
            runtimeLoadExists = $false
            buildMarker = $null
            initializationCount = $null
            mainJsPath = $null
            mainJsSha256 = $null
            loadedAt = $null
        }
    }
    $j = Get-Content -LiteralPath $script:R58RuntimeLoad -Raw | ConvertFrom-Json
    return [pscustomobject]@{
        runtimeLoadPath = $script:R58RuntimeLoad
        runtimeLoadExists = $true
        buildMarker = $j.buildMarker
        initializationCount = $j.initializationCount
        mainJsPath = $j.mainJsPath
        mainJsSha256 = $j.mainJsSha256
        loadedAt = $j.loadedAt
    }
}

# ── Compute artifact SHA and match flags ──────────────────────────────────────
function Get-R58ShaCheck {
    $pm = (Get-FileHash -LiteralPath $script:R58ProjectMain -Algorithm SHA256).Hash
    $rm = (Get-FileHash -LiteralPath $script:R58RuntimeMain -Algorithm SHA256).Hash
    $ps = (Get-FileHash -LiteralPath $script:R58ProjectStyle -Algorithm SHA256).Hash
    $rs = (Get-FileHash -LiteralPath $script:R58RuntimeStyle -Algorithm SHA256).Hash
    return [pscustomobject]@{
        projectMainPath = $script:R58ProjectMain
        runtimeMainPath = $script:R58RuntimeMain
        projectMainSHA = $pm
        runtimeMainSHA = $rm
        mainMatch = ($pm -eq $rm)
        mainMatchExpected = ($pm -eq $script:R58ExpectedMainSha)
        projectStylePath = $script:R58ProjectStyle
        runtimeStylePath = $script:R58RuntimeStyle
        projectStyleSHA = $ps
        runtimeStyleSHA = $rs
        cssMatch = ($ps -eq $rs)
        cssMatchExpected = ($ps -eq $script:R58ExpectedStyleSha)
    }
}

# ── Fixture / sidecar detection ────────────────────────────────────────────────
function Get-R58FixtureState {
    param([Parameter(Mandatory = $true)][string]$FixtureName)
    $fixturePath = Join-Path $script:R58Vault $FixtureName
    $sidecarPath = Join-Path $script:R58SidecarDir ($FixtureName + '.json')
    $fixtureExists = Test-Path -LiteralPath $fixturePath
    $sidecarExists = Test-Path -LiteralPath $sidecarPath
    $recordCount = 0
    if ($sidecarExists) {
        try {
            $sj = Get-Content -LiteralPath $sidecarPath -Raw | ConvertFrom-Json
            if ($null -ne $sj.paragraphOverrides) { $recordCount = $sj.paragraphOverrides.Count }
            elseif ($null -ne $sj.records) { $recordCount = $sj.records.Count }
            else { $recordCount = -1 }
        } catch {
            $recordCount = -1
        }
    }
    return [pscustomobject]@{
        fixtureName = $FixtureName
        fixturePath = $fixturePath
        fixtureExists = $fixtureExists
        sidecarPath = $sidecarPath
        sidecarExists = $sidecarExists
        recordCount = $recordCount
    }
}

# ── Create a minimal fresh fixture (empty markdown) ────────────────────────────
function New-R58FreshFixture {
    param([Parameter(Mandatory = $true)][string]$FixtureName)
    $fixturePath = Join-Path $script:R58Vault $FixtureName
    if (Test-Path -LiteralPath $fixturePath) {
        throw "Fixture already exists, refusing to overwrite: $fixturePath"
    }
    $sidecarPath = Join-Path $script:R58SidecarDir ($FixtureName + '.json')
    if (Test-Path -LiteralPath $sidecarPath) {
        throw "Sidecar already exists, refusing to create fixture: $sidecarPath"
    }
    Set-Content -LiteralPath $fixturePath -Value "" -Encoding UTF8
    return $fixturePath
}
