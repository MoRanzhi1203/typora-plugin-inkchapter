#Requires -Version 5.1
# document-switch-driver.ps1 — switch the active document in the SAME Typora session.
# Typora is single-instance: launching Typora.exe <file> forwards the file-open
# to the already-running instance (no restart). This is the document-switch path.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'fixture-manager.ps1')

$script:TyporaExe = 'D:\Typora\Typora.exe'

# Switch active document to the given fixture (same session, no restart).
function Switch-R58Document {
    param([Parameter(Mandatory = $true)][string]$FixtureName)
    $path = Get-R58FixturePath -FixtureName $FixtureName
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Fixture not found for document switch: $path"
    }
    # Forward file-open to the running single-instance (no --remote-debugging-port here).
    Start-Process -FilePath $script:TyporaExe -ArgumentList ('"' + $path + '"') | Out-Null
    return $path
}
