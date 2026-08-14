#Requires -Version 5.1
# forensic-utf8-reader.test.ps1 — verifies the JSONL collector reads UTF-8
# (no-BOM) lines explicitly via System.IO.File::ReadLines, so multibyte JSON
# (U+3002 / CJK) survives without corruption in Windows PowerShell 5.1.
#
# EMPTY-RUNTIME-PARSER-UTF8-1
#
# Usage:
#   .\forensic-utf8-reader.test.ps1

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'forensic-file-collector.ps1')

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('utf8reader-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null

# Build multibyte characters from code points (never literal non-ASCII here).
$fp = [string][char]0x3002   # U+3002 (。)
$cjk = -join @([char]0x6D4B, [char]0x8BD5)  # 测试

$results = @()
function Add-Result {
    param([string]$Name, [bool]$Ok, [string]$Detail)
    $script:results += [pscustomobject]@{ name = $Name; ok = $Ok; detail = $Detail }
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

try {
    # 1. Write a UTF-8 no-BOM JSONL with U+3002 + CJK payload, then read it back
    #    through Read-R58Utf8Lines + ConvertFrom-R58JsonLines and verify integrity.
    $path = Join-Path $tmpRoot 'runtime-test.log'
    $line1 = '{"ts":1,"sessionId":"s1","buildId":"b1","event":"TEXT-COMMIT-AUDIT","payload":{"visibleText":"' + $fp + '","path":"' + $cjk + '.md"}}'
    $line2 = '{"ts":2,"sessionId":"s1","buildId":"b1","event":"EMPTY-SPECIAL-FINAL","payload":{"overall":true,"caretVisualCorrect":true}}'
    Write-Utf8NoBom -Path $path -Content (($line1 + "`n" + $line2 + "`n"))

    $lines = @(Read-R58Utf8Lines -Path $path)
    $events = @(ConvertFrom-R58JsonLines -Text ($lines -join "`n"))

    $parseFail = @($events | Where-Object { $_.PSObject.Properties.Name -contains '__parseError' }).Count
    $ev1 = $events[0]
    $textOk = ($null -ne $ev1.payload.visibleText) -and ([string]$ev1.payload.visibleText -eq $fp)
    $pathOk = ($null -ne $ev1.payload.path) -and ([string]$ev1.payload.path -eq ($cjk + '.md'))

    $ok1 = ($lines.Count -eq 2) -and ($events.Count -eq 2) -and ($parseFail -eq 0) -and $textOk -and $pathOk
    Add-Result -Name 'EMPTY-RUNTIME-PARSER-UTF8-1 (U+3002 JSONL parse intact)' -Ok $ok1 -Detail "textOk=$textOk pathOk=$pathOk parseFail=$parseFail"

    # 2. Full-file line-by-line validator must also parse every line (formal validator path).
    $valid = Test-R58JsonLinesValid -Path $path
    $ok2 = ($valid.overall -eq $true) -and ($valid.lineCount -eq 2) -and ($valid.parseFailureCount -eq 0)
    Add-Result -Name 'EMPTY-RUNTIME-PARSER-UTF8-2 (full-file line-by-line valid)' -Ok $ok2 -Detail "lineCount=$($valid.lineCount) parseFailure=$($valid.parseFailureCount)"
} finally {
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$passCount = @($results | Where-Object { $_.ok }).Count
foreach ($r in $results) {
    Write-Host ("{0} = {1} ({2})" -f $r.name, $(if ($r.ok) { 'PASS' } else { 'FAIL' }), $r.detail)
}
Write-Host ("EMPTY-RUNTIME-PARSER-UTF8 TOTAL = {0}/2 PASS" -f $passCount)

if ($passCount -ne 2) { throw 'EMPTY-RUNTIME-PARSER-UTF8 tests FAILED' }
