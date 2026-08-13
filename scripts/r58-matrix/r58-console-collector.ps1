#Requires -Version 5.1
# r58-console-collector.ps1
# Wraps the Node.js CDP collector (r58-cdp-collector.js) so the matrix runner
# can start/stop renderer console capture without touching plugin source.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:CollectorJs = Join-Path $PSScriptRoot 'r58-cdp-collector.js'

function Test-R58NodeAvailable {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    return $null -ne $node
}

# Start a console collector process. Returns a process handle + descriptor.
function Start-R58ConsoleCollector {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$OutputFile,
        [string]$FixtureName = '',
        [int]$DurationMs = 60000
    )
    if (-not (Test-Path -LiteralPath $script:CollectorJs)) {
        throw "Collector JS not found: $script:CollectorJs"
    }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $args = @(
        $script:CollectorJs
        '--port', $Port
        '--out', $OutputFile
    )
    if ($FixtureName -ne '') {
        $args += @('--fixture', $FixtureName)
    }
    $args += @('--duration', $DurationMs)

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $node
    $argStrings = foreach ($a in $args) { '"' + ([string]$a).Replace('"', '\"') + '"' }
    $psi.Arguments = $argStrings -join ' '
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $proc.Start() | Out-Null

    return @{
        Process = $proc
        Port = $Port
        OutputFile = $OutputFile
        FixtureName = $FixtureName
    }
}

# Wait for the collector to attach (its stdout summary JSON appears on exit).
function Wait-R58ConsoleCollectorReady {
    param(
        [hashtable]$Collector,
        [int]$TimeoutMs = 10000
    )
    $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
    do {
        Start-Sleep -Milliseconds 300
        if ($Collector.Process.HasExited) {
            return $false
        }
        # Probe CDP endpoint readiness
        try {
            $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$($Collector.Port)/json/version" -TimeoutSec 2 -ErrorAction Stop
            if ($resp.Browser) { return $true }
        } catch { }
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Stop-R58ConsoleCollector {
    param([hashtable]$Collector)
    if ($Collector -and $Collector.Process) {
        try {
            if (-not $Collector.Process.HasExited) {
                $Collector.Process.Kill() | Out-Null
                $Collector.Process.WaitForExit(5000) | Out-Null
            }
        } catch { }
    }
}
