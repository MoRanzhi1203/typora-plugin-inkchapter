#Requires -Version 5.1
# jsonl-offset-utf8-smoke.ps1 — verifies the forensic-file-collector byte offset
# is a TRUE UTF-8 byte offset (not a character index).
#
# No Typora dependency. Writes ASCII + multibyte Unicode JSONL, records the byte
# offset, appends more Unicode lines, reads the delta by byte offset, decodes
# UTF-8, and asserts the Unicode content survives intact.
#
# All non-ASCII characters are built from code points (U+3002, CJK) so this file
# never depends on the PowerShell 5.1 .ps1 ANSI-vs-UTF8 source decoding.
#
# Usage:
#   .\jsonl-offset-utf8-smoke.ps1 [-OutputDir artifacts\r58-final]

[CmdletBinding()]
param(
    [string]$OutputDir = 'artifacts\r58-final'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:Root = 'D:\TyporaPluginProjects\typora-plugin-inkchapter'
. (Join-Path $PSScriptRoot 'forensic-file-collector.ps1')

$outAbs = if ([System.IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $script:Root $OutputDir }
if (-not (Test-Path -LiteralPath $outAbs)) { New-Item -ItemType Directory -Path $outAbs -Force | Out-Null }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('ink-utf8-offset-' + [Guid]::NewGuid().ToString('N') + '.jsonl')
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# Build Unicode strings from code points (no literal non-ASCII in this file).
$fullwidthPeriod = [string][char]0x3002
$unicodePath = -join @([char]0x6D4B, [char]0x8BD5, [char]0x6587, [char]0x6863, '.', 'm', 'd')

$line1 = '{"event":"ASCII","payload":{"text":"abc"}}' + "`n"
$line2 = '{"event":"UNICODE","payload":{"text":"' + $fullwidthPeriod + '"}}' + "`n"
$line3 = '{"event":"UNICODE_PATH","payload":{"text":"' + $unicodePath + '"}}' + "`n"

try {
    # Write line1, then record the byte offset (via the collector's own function).
    [System.IO.File]::WriteAllText($tmp, $line1, $utf8NoBom)
    $offsetBefore = Get-R58AuditByteLength -Path $tmp

    # Append line2 + line3 (multibyte Unicode) in the same UTF-8 (no BOM) encoding.
    [System.IO.File]::AppendAllText($tmp, ($line2 + $line3), $utf8NoBom)
    $offsetAfter = Get-R58AuditByteLength -Path $tmp

    $deltaRaw = Read-R58AuditDeltaRaw -Path $tmp -OffsetBefore $offsetBefore -OffsetAfter $offsetAfter
    $events = @(ConvertFrom-R58JsonLines -Text $deltaRaw)

    $parseFailureCount = 0
    $deltaLineCount = 0
    $texts = @()
    foreach ($ev in $events) {
        if ($ev.PSObject.Properties.Name -contains '__parseError') {
            $parseFailureCount++
            continue
        }
        $deltaLineCount++
        if ($null -ne $ev.payload -and $null -ne $ev.payload.text) {
            $texts += [string]$ev.payload.text
        }
    }

    $line2Ok = ($texts.Count -ge 1) -and ($texts[0] -eq $fullwidthPeriod)
    $line3Ok = ($texts.Count -ge 2) -and ($texts[1] -eq $unicodePath)
    $overall = ($deltaLineCount -eq 2) -and ($parseFailureCount -eq 0) -and $line2Ok -and $line3Ok

    $report = [pscustomobject]@{
        mode = 'JSONL-OFFSET-UTF8-SMOKE'
        path = $tmp
        offsetBefore = $offsetBefore
        offsetAfter = $offsetAfter
        deltaBytes = ($offsetAfter - $offsetBefore)
        deltaLineCount = $deltaLineCount
        parseFailureCount = $parseFailureCount
        line2Text = if ($texts.Count -ge 1) { $texts[0] } else { $null }
        line3Text = if ($texts.Count -ge 2) { $texts[1] } else { $null }
        unicodeIntact = ($line2Ok -and $line3Ok)
        overall = $overall
        verdict = if ($overall) { 'PASS' } else { 'FAIL' }
    }
} finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
}

$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outAbs 'jsonl-offset-utf8-smoke.json') -Encoding UTF8
Write-Output ("JSONL-OFFSET-UTF8-SMOKE = {0} (deltaLineCount={1} parseFailureCount={2} unicodeIntact={3})" -f $report.verdict, $report.deltaLineCount, $report.parseFailureCount, $report.unicodeIntact)
if ($report.verdict -ne 'PASS') { throw 'JSONL-OFFSET-UTF8-SMOKE FAILED' }
