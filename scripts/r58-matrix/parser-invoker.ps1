#Requires -Version 5.1
# parser-invoker.ps1 — defensive trial-parser.js invocation + stable result contract.
#
# Single source of truth for the PowerShell runner consuming trial-parser.js
# output. On ANY parser failure (missing node, nonzero exit, missing/empty output,
# invalid JSON, or a JSON object without a top-level `verdict`), returns an
# INVALID envelope with reason PARSER_CONTRACT_ERROR — never throws into the
# caller and never fabricates a business verdict.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-NodePath {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $node) { return $null }
    return $node.Source
}

function New-ParserContractError {
    param([string]$Type, [string[]]$Checks, [string]$Raw = '')
    return [pscustomobject]@{
        type = $Type
        verdict = 'INVALID'
        invalidReason = 'PARSER_CONTRACT_ERROR'
        failedChecks = @($Checks)
        raw = $Raw
    }
}

# Invoke trial-parser.js and return its parsed JSON verdict object.
# -ParserJs allows tests to substitute a fake parser to exercise the contract.
function Invoke-TrialParser {
    param(
        [string]$Type,
        [string]$Fixture,
        [string]$DeltaFile,
        [string]$OutFile,
        [string]$ParserJs = ''
    )
    $node = Get-NodePath
    if ($null -eq $node) {
        return (New-ParserContractError -Type $Type -Checks @('node-not-available'))
    }
    if ($ParserJs -eq '') { $ParserJs = Join-Path $PSScriptRoot 'trial-parser.js' }

    $stdout = & $node $ParserJs --type $Type --fixture $Fixture --delta $DeltaFile --out $OutFile 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        return (New-ParserContractError -Type $Type -Checks @("parser-exit-$exitCode") -Raw ($stdout -join "`n"))
    }
    if (-not (Test-Path -LiteralPath $OutFile)) {
        return (New-ParserContractError -Type $Type -Checks @('parser-output-missing'))
    }
    $raw = Get-Content -LiteralPath $OutFile -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return (New-ParserContractError -Type $Type -Checks @('parser-output-empty'))
    }
    $obj = $null
    try {
        $obj = $raw | ConvertFrom-Json
    } catch {
        return (New-ParserContractError -Type $Type -Checks @('parser-output-invalid-json') -Raw $raw)
    }
    if ($null -eq $obj) {
        return (New-ParserContractError -Type $Type -Checks @('parser-output-invalid-json') -Raw $raw)
    }
    $hasVerdict = $false
    foreach ($prop in $obj.PSObject.Properties) {
        if ($prop.Name -eq 'verdict') { $hasVerdict = $true; break }
    }
    if (-not $hasVerdict) {
        return (New-ParserContractError -Type $Type -Checks @('parser-output-missing-verdict') -Raw $raw)
    }
    return $obj
}
