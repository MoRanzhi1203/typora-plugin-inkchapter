#Requires -Version 5.1
# run-empty-special-gate.ps1 — EmptySpecial E1/E2/E3 formal runtime harness.
#
# Frozen Build/SHA (do NOT modify): the runtime business code is frozen this round.
# This harness only drives the runtime and parses the byte-window JSONL delta.
#
# Modes:
#   Preflight     read-only build/SHA/fixture/parser/UTF-8 preflight (no Typora)
#   StrictStartup delegate to run-r58-final-matrix.ps1 -Mode StrictStartup
#   Run           single clean trial: close Typora -> reset sidecar -> launch ->
#                 byte-window -> 。。+Enter -> wait final -> parse -> artifacts
#
# Usage:
#   .\run-empty-special-gate.ps1 -Mode Preflight
#   .\run-empty-special-gate.ps1 -Mode Run -Scenario E2 -TrialNum 01
#
# Run order (E2 first): E2-01,02,03 -> E1-01,02,03 -> E3-01,02,03.

[CmdletBinding()]
param(
    [ValidateSet('Preflight', 'StrictStartup', 'Run')]
    [string]$Mode = 'Preflight',
    [ValidateSet('E1', 'E2', 'E3')]
    [string]$Scenario = 'E2',
    [ValidateSet('01', '02', '03')]
    [string]$TrialNum = '01',
    [string]$OutputDir = 'artifacts\empty-special-runtime'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:Root = 'D:\TyporaPluginProjects\typora-plugin-inkchapter'
$script:Vault = Join-Path $script:Root 'test\vault'
$script:AuditDir = Join-Path $script:Vault '.typora\inkchapter\audit'
$script:BuildId = 'inkchapter-r58-7-evc3-canonical-transfer-empty-visual-rc3'
$script:ExpectedMainSha = 'E059EDE4DE878FB467D75C3180E451F6B3B622DD931EF3D04D088DF4B0FA9ED8'
$script:ExpectedStyleSha = '3B9F8AEE699925428770283E1DEAF0FE7A71B041B7A530BD583CFB60B4682B31'

. (Join-Path $PSScriptRoot 'process-control.ps1')
. (Join-Path $PSScriptRoot 'window-input.ps1')
. (Join-Path $PSScriptRoot 'forensic-file-collector.ps1')
. (Join-Path $PSScriptRoot 'input-injection-audit.ps1')

$outAbs = if ([System.IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $script:Root $OutputDir }
if (-not (Test-Path -LiteralPath $outAbs)) { New-Item -ItemType Directory -Path $outAbs -Force | Out-Null }

function Write-Step { param([string]$Text) Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Text) }

function Get-EmptySpecialFixture {
    param([string]$Scenario, [string]$Num)
    return ('r58-empty-special-' + $Scenario.ToLower() + '-' + $Num + '.md')
}

# EmptySpecial key sequence is SPLIT: token (Period Period) then Enter (Return),
# so the harness can prove the real U+3002 token BEFORE sending Enter.
function Get-EmptySpecialTokenKeys {
    return [uint16[]]@($script:VK_OEM_PERIOD, $script:VK_OEM_PERIOD)
}

function Get-EmptySpecialEnterKey {
    return [uint16[]]@($script:VK_RETURN)
}

# P0-D: prove the committed token is U+3002 U+3002 (。。) with IME provenance before Enter.
function Test-EmptySpecialTokenProvenance {
    param([Parameter(Mandatory = $true)][string]$Path, [long]$OffsetBefore = 0)
    $fullwidth = [string][char]0x3002
    $token2 = $fullwidth + $fullwidth
    if (-not (Test-Path -LiteralPath $Path)) {
        return [pscustomobject]@{ verdict = 'INVALID'; invalidReason = 'SPECIAL_TOKEN_PROVENANCE_MISMATCH'; tokenText = $null; logicalOffset = $null; imeProvenance = $false }
    }
    $len = (Get-Item -LiteralPath $Path).Length
    if ($len -le $OffsetBefore) {
        return [pscustomobject]@{ verdict = 'INVALID'; invalidReason = 'SPECIAL_TOKEN_PROVENANCE_MISMATCH'; tokenText = $null; logicalOffset = $null; imeProvenance = $false }
    }
    $delta = Read-R58AuditDeltaRaw -Path $Path -OffsetBefore $OffsetBefore -OffsetAfter $len
    $events = @(ConvertFrom-R58JsonLines -Text $delta)

    $ime = @($events | Where-Object { $_.event -eq 'IME-SELECTION-AUDIT' })
    $hasCompStart = @($ime | Where-Object { (Get-R58EventField -Event $_ -Name 'eventType') -eq 'compositionstart' }).Count -gt 0
    $hasBeforeInputComp = @($ime | Where-Object { (Get-R58EventField -Event $_ -Name 'eventType') -eq 'beforeinput' -and (Get-R58EventField -Event $_ -Name 'inputType') -eq 'insertCompositionText' }).Count -gt 0
    $hasInput = @($ime | Where-Object { (Get-R58EventField -Event $_ -Name 'eventType') -eq 'input' }).Count -gt 0
    $hasCompEnd = @($ime | Where-Object { (Get-R58EventField -Event $_ -Name 'eventType') -eq 'compositionend' }).Count -gt 0
    $imeProvenance = ($hasCompStart -and $hasBeforeInputComp -and $hasInput -and $hasCompEnd)

    $commit = @($events | Where-Object { $_.event -eq 'TEXT-COMMIT-AUDIT' } | Select-Object -Last 1)
    $visibleText = if ($commit.Count -gt 0) { Get-R58EventField -Event $commit[0] -Name 'visibleText' } else { $null }
    $logicalOffset = if ($commit.Count -gt 0) { Get-R58EventField -Event $commit[0] -Name 'logicalOffset' } else { $null }

    $tokenOk = ($visibleText -eq $token2) -and ($logicalOffset -eq 2)
    if ($imeProvenance -and $tokenOk) {
        return [pscustomobject]@{ verdict = 'PASS'; invalidReason = $null; tokenText = $visibleText; logicalOffset = $logicalOffset; imeProvenance = $true }
    }
    return [pscustomobject]@{ verdict = 'INVALID'; invalidReason = 'SPECIAL_TOKEN_PROVENANCE_MISMATCH'; tokenText = $visibleText; logicalOffset = $logicalOffset; imeProvenance = $imeProvenance }
}

function Test-EmptySpecialClean {
    param([Parameter(Mandatory = $true)][string]$FixtureName)
    $fixture = Join-Path $script:Vault $FixtureName
    $sidecar = Join-Path $script:Vault ('.typora\inkchapter\paragraph-layout\' + $FixtureName + '.json')
    $fixtureExists = Test-Path -LiteralPath $fixture
    $sidecarExists = Test-Path -LiteralPath $sidecar
    $recordCount = -1
    if ($sidecarExists) {
        try {
            $sj = Get-Content -LiteralPath $sidecar -Raw | ConvertFrom-Json
            if ($null -ne $sj.paragraphOverrides) { $recordCount = $sj.paragraphOverrides.Count }
            elseif ($null -ne $sj.records) { $recordCount = $sj.records.Count }
        } catch { $recordCount = -1 }
    }
    return [pscustomobject]@{
        fixtureName = $FixtureName
        fixturePath = $fixture
        fixtureExists = $fixtureExists
        sidecarPath = $sidecar
        sidecarExists = $sidecarExists
        sidecarRecordCount = $recordCount
        clean = ($fixtureExists -and (-not $sidecarExists))
    }
}

function Reset-EmptySpecialSidecar {
    param([Parameter(Mandatory = $true)][string]$FixtureName)
    $sidecar = Join-Path $script:Vault ('.typora\inkchapter\paragraph-layout\' + $FixtureName + '.json')
    if (Test-Path -LiteralPath $sidecar) { Remove-Item -LiteralPath $sidecar -Force }
}

# ── Preflight ────────────────────────────────────────────────────────────────
function Invoke-EmptySpecialPreflight {
    Write-Step 'EmptySpecial Preflight START (read-only)'
    $pm = (Get-FileHash -LiteralPath (Join-Path $script:Root 'dist\main.js') -Algorithm SHA256).Hash
    $rm = (Get-FileHash -LiteralPath (Join-Path $script:Vault '.typora\plugins\dist\main.js') -Algorithm SHA256).Hash
    $ps = (Get-FileHash -LiteralPath (Join-Path $script:Root 'dist\style.css') -Algorithm SHA256).Hash
    $parser = Join-Path $PSScriptRoot 'empty-special-trial-parser.js'

    $fixtures = @()
    foreach ($s in @('e1', 'e2', 'e3')) {
        foreach ($n in @('01', '02', '03')) {
            $fixtures += Test-EmptySpecialClean -FixtureName ('r58-empty-special-' + $s + '-' + $n + '.md')
        }
    }

    $report = [pscustomobject]@{
        mode = 'Preflight'
        buildId = $script:BuildId
        projectMainSHA = $pm
        runtimeMainSHA = $rm
        shaMatch = ($pm -eq $rm -and $pm -eq $script:ExpectedMainSha)
        styleSHA = $ps
        styleMatch = ($ps -eq $script:ExpectedStyleSha)
        parserExists = (Test-Path -LiteralPath $parser)
        fixtures = $fixtures
        fixturesClean = (@($fixtures | Where-Object { $_.clean }).Count -eq $fixtures.Count)
        nodeAvailable = ($null -ne (Get-Command node.exe -ErrorAction SilentlyContinue))
        auditDirExists = (Test-Path -LiteralPath $script:AuditDir)
    }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outAbs 'preflight.json') -Encoding UTF8
    Write-Step ("Preflight shaMatch={0} styleMatch={1} fixturesClean={2} parserExists={3}" -f $report.shaMatch, $report.styleMatch, $report.fixturesClean, $report.parserExists)
    return $report
}

# ── StrictStartup ─────────────────────────────────────────────────────────────
function Invoke-EmptySpecialStrictStartup {
    Write-Step 'EmptySpecial StrictStartup -> delegate to run-r58-final-matrix.ps1'
    $runner = Join-Path $PSScriptRoot 'run-r58-final-matrix.ps1'
    & $runner -Mode StrictStartup
}

# ── Single trial ──────────────────────────────────────────────────────────────
function Invoke-EmptySpecialTrial {
    Write-Step "EmptySpecial trial START scenario=$Scenario num=$TrialNum"
    $fixtureName = Get-EmptySpecialFixture -Scenario $Scenario -Num $TrialNum
    $trialDir = Join-Path $outAbs (($Scenario.ToLower()) + '-' + $TrialNum)
    if (-not (Test-Path -LiteralPath $trialDir)) { New-Item -ItemType Directory -Path $trialDir -Force | Out-Null }

    # 1. Close Typora -> processCount=0.
    $close = Stop-TyporaAll
    $processCountAfterClose = $close.typoraCountAfterClose

    # 2. Reset sidecar for this fixture (clean precondition).
    Reset-EmptySpecialSidecar -FixtureName $fixtureName
    $clean = Test-EmptySpecialClean -FixtureName $fixtureName

    $precondition = [pscustomobject]@{
        scenario = $Scenario
        trialId = ($Scenario.ToLower() + '-' + $TrialNum)
        fixture = $fixtureName
        processCountAfterClose = $processCountAfterClose
        sidecarExists = $clean.sidecarExists
        sidecarRecordCount = $clean.sidecarRecordCount
        fixtureExists = $clean.fixtureExists
        clean = ($processCountAfterClose -eq 0 -and $clean.clean)
        invalidReason = if ($processCountAfterClose -ne 0) { 'processCountAfterClose!=0' } elseif (-not $clean.clean) { 'FIXTURE_NOT_CLEAN' } else { $null }
    }
    $precondition | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $trialDir 'trial-precondition.json') -Encoding UTF8

    if (-not $precondition.clean) {
        return [pscustomobject]@{ mode = 'Run'; scenario = $Scenario; trialId = ($Scenario.ToLower() + '-' + $TrialNum); verdict = 'INVALID'; invalidReason = $precondition.invalidReason; failedChecks = @($precondition.invalidReason) }
    }

    # 3. Launch Typora on the fixture.
    $startCmdAt = Get-Date
    $null = Start-TyporaOnFixture -FixtureName $fixtureName
    $main = Wait-TyporaWindow -TimeoutSeconds 30 -Fixture $fixtureName

    # 4. Resolve current audit session (newest file) + byte offset start.
    $auditFiles = @(Get-R58AuditFiles)
    if ($auditFiles.Count -eq 0) {
        return [pscustomobject]@{ mode = 'Run'; scenario = $Scenario; trialId = ($Scenario.ToLower() + '-' + $TrialNum); verdict = 'INVALID'; invalidReason = 'NO_AUDIT_FILE'; failedChecks = @('NO_AUDIT_FILE') }
    }
    $auditPath = $auditFiles[0].FullName
    $byteOffsetStart = (Get-R58AuditByteLength -Path $auditPath)

    # 5. Foreground gate + token input (Period Period) + token proof + Enter.
    $hwnd = if ($main) { $main.MainWindowHandle } else { [IntPtr]::Zero }
    $pidVal = if ($main) { $main.Id } else { 0 }
    if ($hwnd -eq [IntPtr]::Zero -or $pidVal -eq 0) {
        return [pscustomobject]@{ mode = 'Run'; scenario = $Scenario; trialId = ($Scenario.ToLower() + '-' + $TrialNum); verdict = 'INVALID'; invalidReason = 'NO_MAIN_WINDOW'; failedChecks = @('NO_MAIN_WINDOW') }
    }

    # 5a. Send token (Period Period) only.
    $tokenInject = Invoke-R58InputInjectionAudit -TargetPid $pidVal -TargetHwnd $hwnd -Keys (Get-EmptySpecialTokenKeys) -InterKeyDelayMs 120
    $tokenGate = Test-R58InputInjectionGate -Audit $tokenInject
    if ($tokenGate.verdict -ne 'PASS') {
        return [pscustomobject]@{ mode = 'Run'; scenario = $Scenario; trialId = ($Scenario.ToLower() + '-' + $TrialNum); verdict = 'INVALID'; invalidReason = $tokenGate.invalidReason; failedChecks = @($tokenGate.invalidReason); sendEnterCallCount = 0 }
    }

    # 5b. Prove the committed token is U+3002 U+3002 (。。) before Enter.
    Start-Sleep -Milliseconds 500
    $tokenProof = Test-EmptySpecialTokenProvenance -Path $auditPath -OffsetBefore $byteOffsetStart
    $tokenProof | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $trialDir 'special-token-provenance.json') -Encoding UTF8
    if ($tokenProof.verdict -ne 'PASS') {
        return [pscustomobject]@{ mode = 'Run'; scenario = $Scenario; trialId = ($Scenario.ToLower() + '-' + $TrialNum); verdict = 'INVALID'; invalidReason = 'SPECIAL_TOKEN_PROVENANCE_MISMATCH'; failedChecks = @('SPECIAL_TOKEN_PROVENANCE_MISMATCH'); sendEnterCallCount = 0 }
    }

    # 5c. Send Enter (only after token proven).
    $enterInject = Invoke-R58InputInjectionAudit -TargetPid $pidVal -TargetHwnd $hwnd -Keys (Get-EmptySpecialEnterKey) -InterKeyDelayMs 120
    $enterInject | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $trialDir 'input-injection-audit.json') -Encoding UTF8
    $enterGate = Test-R58InputInjectionGate -Audit $enterInject
    if ($enterGate.verdict -ne 'PASS') {
        return [pscustomobject]@{ mode = 'Run'; scenario = $Scenario; trialId = ($Scenario.ToLower() + '-' + $TrialNum); verdict = 'INVALID'; invalidReason = $enterGate.invalidReason; failedChecks = @($enterGate.invalidReason); sendEnterCallCount = 1 }
    }

    # 6. Wait for final authority + flush/stable.
    $finalEvent = Wait-R58AuditEvent -Path $auditPath -OffsetBefore $byteOffsetStart -EventNames @('EMPTY-SPECIAL-FINAL') -TimeoutMs 20000
    if ($null -eq $finalEvent) {
        return [pscustomobject]@{ mode = 'Run'; scenario = $Scenario; trialId = ($Scenario.ToLower() + '-' + $TrialNum); verdict = 'FAIL'; invalidReason = 'NO_FINAL_EVENT'; failedChecks = @('NO_EMPTY-SPECIAL-FINAL') }
    }
    $null = Wait-R58AuditFileLengthStable -Path $auditPath -StableCount 3 -TimeoutMs 10000
    $byteOffsetEnd = (Get-R58AuditByteLength -Path $auditPath)

    # 7. Read exact UTF-8 delta + write trial.delta.jsonl.
    $deltaRaw = Read-R58AuditDeltaRaw -Path $auditPath -OffsetBefore $byteOffsetStart -OffsetAfter $byteOffsetEnd
    [System.IO.File]::WriteAllText((Join-Path $trialDir 'trial.delta.jsonl'), $deltaRaw, (New-Object System.Text.UTF8Encoding($false)))

    # 8. Parse via empty-special-trial-parser.js.
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    $parserOut = Join-Path $trialDir 'parser-out.json'
    $null = & $node (Join-Path $PSScriptRoot 'empty-special-trial-parser.js') --type $Scenario --fixture $fixtureName --delta (Join-Path $trialDir 'trial.delta.jsonl') --out $parserOut 2>&1
    $verdict = Get-Content -LiteralPath $parserOut -Raw | ConvertFrom-Json

    # 9. Trial summary.
    $summary = [pscustomobject]@{
        mode = 'Run'
        scenario = $Scenario
        trialId = ($Scenario.ToLower() + '-' + $TrialNum)
        fixture = $fixtureName
        auditPath = $auditPath
        byteOffsetStart = $byteOffsetStart
        byteOffsetEnd = $byteOffsetEnd
        runtimeBuildId = $script:BuildId
        runtimeMainSHA = $script:ExpectedMainSha
        verdict = $verdict.verdict
        invalidReason = $verdict.invalidReason
        failedChecks = @($verdict.failedChecks)
        domNormalization = $verdict.domNormalization
        settle = $verdict.settle
        geometry = $verdict.geometry
        final = $verdict.final
    }
    $summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $trialDir 'trial-summary.json') -Encoding UTF8
    Write-Step ("EmptySpecial trial verdict={0} scenario={1} num={2} invalid={3}" -f $summary.verdict, $Scenario, $TrialNum, $summary.invalidReason)
    return $summary
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
switch ($Mode) {
    'Preflight' { Invoke-EmptySpecialPreflight | Out-Null }
    'StrictStartup' { Invoke-EmptySpecialStrictStartup | Out-Null }
    'Run' { Invoke-EmptySpecialTrial | Out-Null }
}
