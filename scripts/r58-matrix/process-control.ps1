#Requires -Version 5.1
# process-control.ps1 — Typora process discovery/close/start/wait + SHA + runtime-load.
# Reuses the verified r58-process-verifier.ps1 primitives (single source of truth).

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'r58-process-verifier.ps1')
. (Join-Path $PSScriptRoot 'fixture-manager.ps1')

# Re-export the primitives under the final-matrix naming.
function Get-TyporaProcesses { Get-R58TyporaProcesses }
function Get-TyporaMainWindow { Get-R58TyporaMainWindow }
function Stop-TyporaAll { param([int]$OldPid = 0) Stop-R58Typora -OldPid $OldPid }
function Start-TyporaOnFixture { param([string]$FixtureName, [int]$DebugPort = 9222) Start-R58TyporaFixture -FixtureName $FixtureName -DebugPort $DebugPort }
function Wait-TyporaWindow { param([int]$TimeoutSeconds = 30, [string]$Fixture = '') Wait-R58TyporaMainWindow -TimeoutSeconds $TimeoutSeconds -ExpectedFixture $Fixture }
function Read-RuntimeLoad { Get-R58RuntimeLoad }
function Read-ShaCheck { Get-R58ShaCheck }
