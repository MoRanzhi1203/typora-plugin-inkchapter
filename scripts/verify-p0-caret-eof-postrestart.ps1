# ============================================================================
# verify-p0-caret-eof-postrestart.ps1
#
# 墨章 InkChapter — P0 光标隔离 / 文末 Enter / EOF 空行  「重启后」验收脚本
#
# 用途：在【人工重启 Typora 并载入 test vault 新构建之后】运行本脚本，自动完成
#       可自动化部分的验收，并把无法自动化的真实键入/鼠标/像素项打印为人工清单。
#
# 严格约束（与本项目规则一致）：
#   * 只读：本脚本**不启动/不重启/不关闭** Typora，不部署，不修改任何源码、
#     Markdown 或配置。
#   * 未取得真实证据的项一律 NOT_RUN / PENDING_USER_MANUAL，绝不判 PASS。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\verify-p0-caret-eof-postrestart.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\verify-p0-caret-eof-postrestart.ps1 -SessionId 1791xxxxxxxxx
#
# 参数：
#   -SessionId <string>   指定审计会话号（runtime-sess-<id>.log）；缺省取最新。
#   -NoReport             不写验收报告 md（默认写入 runtime/evidence/）。
# ============================================================================

[CmdletBinding()]
param(
    [string]$SessionId = "",
    [switch]$NoReport
)

$ErrorActionPreference = "Stop"

# ── 路径（单一权威） ───────────────────────────────────────────────────────
$ProjectRoot   = "D:\TyporaPluginProjects\typora-plugin-inkchapter"
$ProjectMain   = Join-Path $ProjectRoot "dist\main.js"
$ProjectCss    = Join-Path $ProjectRoot "dist\style.css"
$RuntimeMain   = Join-Path $ProjectRoot "test\vault\.typora\plugins\dist\main.js"
$RuntimeCss    = Join-Path $ProjectRoot "test\vault\.typora\plugins\dist\style.css"
$RuntimeLoad   = Join-Path $ProjectRoot "test\vault\.typora\inkchapter-runtime-load.json"
$AuditDir      = Join-Path $ProjectRoot "test\vault\.typora\inkchapter\audit"
$GlobalRoot    = Join-Path $env:APPDATA "Typora\plugins"
$GlobalMain    = Join-Path $GlobalRoot "plugins\ranzhi.inkchapter\main.js"
$EvidenceDir   = Join-Path $ProjectRoot "runtime\evidence"
$ReportPath    = Join-Path $EvidenceDir "P0-CARET-EOF-POSTRESTART-ACCEPTANCE.md"

$TargetDocA    = Join-Path $ProjectRoot "test\vault\runtime\Document-Diagnostics-Trailing-Blank-3.md"
$TargetDocB    = Join-Path $ProjectRoot "test\vault\runtime\Document-Diagnostics-Trailing-Blank-0.md"
$TargetDocC    = Join-Path $ProjectRoot "test\vault\Document-Diagnostics-Code-Integrity-Test.md"

# ── 载入产物必须包含的新门禁标记（ASCII，抗 esbuild 中文转义） ──────────────
$RequiredMarkers = @(
    'DOCUMENT-DIAGNOSTIC-NAV-POST-DEFAULT-SELECTION',
    'auditCoverageDecision',
    'AUDIT_COVERAGE',
    'ENTER-PLUGIN-INTERVENTION-AUDIT',
    'data-inkchapter-presentation',
    'CARET_ISOLATION_GATE',
    'renderedVisibleBlankCount',
    'excessVisibleRows'
)

# ── 小工具 ─────────────────────────────────────────────────────────────────
function Get-Sha256([string]$p) {
    if (Test-Path -LiteralPath $p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
    return ""
}
function Read-Text([string]$p) {
    if (-not (Test-Path -LiteralPath $p)) { return "" }
    return [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
}
function Read-Json([string]$p) {
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    try { return (Read-Text $p | ConvertFrom-Json) } catch { return $null }
}
function Get-IntField([string]$line, [string]$name, [int]$default = -1) {
    if ([string]::IsNullOrEmpty($line)) { return $default }
    $m = [regex]::Match($line, '"' + [regex]::Escape($name) + '"\s*:\s*(-?\d+)')
    if ($m.Success) { return [int]$m.Groups[1].Value }
    return $default
}
function Get-StrField([string]$line, [string]$name, [string]$default = "") {
    if ([string]::IsNullOrEmpty($line)) { return $default }
    $m = [regex]::Match($line, '"' + [regex]::Escape($name) + '"\s*:\s*"([^"]*)"')
    if ($m.Success) { return $m.Groups[1].Value }
    return $default
}
# JSON 布尔值为**未加引号**字面量；返回 'true'/'false'，字段缺失返回 ''。
function Get-BoolField([string]$line, [string]$name, [string]$default = "") {
    if ([string]::IsNullOrEmpty($line)) { return $default }
    $m = [regex]::Match($line, '"' + [regex]::Escape($name) + '"\s*:\s*(true|false)')
    if ($m.Success) { return $m.Groups[1].Value }
    return $default
}

Write-Output "=========================================================="
Write-Output "P0 POST-RESTART ACCEPTANCE — caret / Enter / EOF"
Write-Output "=========================================================="
Write-Output ""

# ── PHASE 1 · 运行实例身份 ─────────────────────────────────────────────────
$procs = @(Get-Process Typora -ErrorAction SilentlyContinue)
$mainProc = $procs | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1

$pidValue = 0; $hwnd = 0; $title = ""; $responding = $false; $startTime = ""
if ($mainProc) {
    $pidValue = $mainProc.Id
    $hwnd = [int64]$mainProc.MainWindowHandle
    $title = $mainProc.MainWindowTitle
    $responding = [bool]$mainProc.Responding
    $startTime = $mainProc.StartTime.ToString("o")
}

$buildSha    = Get-Sha256 $ProjectMain
$deploySha   = Get-Sha256 $RuntimeMain
$globalSha   = Get-Sha256 $GlobalMain
$deployCss   = Get-Sha256 $RuntimeCss
$buildCss    = Get-Sha256 $ProjectCss

$rl = Read-Json $RuntimeLoad
$loadSha = ""; $initCount = 0; $loadSource = ""; $loadedAt = ""; $loadRoot = ""; $buildMarker = ""
if ($rl) {
    $loadSha = [string]$rl.mainJsSha256
    $initCount = [int]$rl.initializationCount
    $loadSource = [string]$rl.loadSource
    $loadedAt = [string]$rl.loadedAt
    $loadRoot = [string]$rl.pluginRoot
    $buildMarker = [string]$rl.buildMarker
}

$typoraRunning   = ($procs.Count -gt 0)
$identityExact   = ($loadSha -ne "" -and $loadSha -eq $deploySha -and $loadSha -eq $buildSha)
$deployParity    = ($deploySha -ne "" -and $deploySha -eq $buildSha)
$initCountOk     = ($initCount -eq 1)
$loadSourceOk    = ($loadSource -eq 'vault')
$vaultRootOk     = ($loadRoot -match 'test\\vault\\\.typora')
$respondingOk    = ($typoraRunning -and $responding)

Write-Output "[PHASE 1] 运行实例身份"
Write-Output "  TYPORA_RUNNING     = $typoraRunning"
Write-Output "  PID / HWND         = $pidValue / $hwnd"
Write-Output "  TITLE              = $title"
Write-Output "  RESPONDING         = $responding"
Write-Output "  START_TIME         = $startTime"
Write-Output "  BUILD_SHA256       = $buildSha"
Write-Output "  DEPLOY_SHA256      = $deploySha"
Write-Output "  LOADED_SHA256      = $loadSha"
Write-Output "  LOADED_AT          = $loadedAt"
Write-Output "  INIT_COUNT         = $initCount"
Write-Output "  LOAD_SOURCE        = $loadSource"
Write-Output "  PLUGIN_ROOT        = $loadRoot"
Write-Output "  BUILD_MARKER       = $buildMarker"
Write-Output "  IDENTITY_EXACT(BUILD==DEPLOY==LOADED) = $identityExact"
Write-Output "  DEPLOY_PARITY(BUILD==DEPLOY)          = $deployParity"
Write-Output ""
Write-Output "  (参考) GLOBAL_PRODUCTION_SHA256 = $globalSha   [本轮未覆盖，非验收目标]"
Write-Output ""

# ── ADMISSION GATE（R4 §4）—— 当前进程 + 当前会话身份必须有效，否则全部
#    当前 Runtime 子门禁只能 NOT_ADMITTED / PENDING；旧会话证据不得升级当前分数。
$admitted = ($typoraRunning -and $identityExact -and $initCountOk -and $loadSourceOk -and $vaultRootOk)
$admissionReason = if ($admitted) { 'CURRENT_RUNTIME_ADMITTED' } else { 'CURRENT_RUNTIME_NOT_ADMITTED' }
Write-Output "  ADMISSION = $admissionReason"
Write-Output ""

# ── PHASE 2 · 载入产物标记（证明新门禁代码真的在运行） ─────────────────────
$mainText = Read-Text $RuntimeMain
$markerResults = @()
foreach ($mk in $RequiredMarkers) {
    $present = ($mainText -ne "") -and $mainText.Contains($mk)
    $markerResults += [PSCustomObject]@{ Marker = $mk; Present = $present }
}
$markersAllPresent = -not ($markerResults | Where-Object { -not $_.Present })

Write-Output "[PHASE 2] 载入产物门禁标记"
foreach ($r in $markerResults) {
    Write-Output ("  {0,-52} = {1}" -f $r.Marker, $r.Present)
}
Write-Output "  MARKERS_ALL_PRESENT = $markersAllPresent"
Write-Output ""

# ── PHASE 3 · 最新审计会话（真实运行事实） ─────────────────────────────────
$auditFile = $null
if (Test-Path -LiteralPath $AuditDir) {
    if ($SessionId -ne "") {
        $auditFile = Get-ChildItem -LiteralPath $AuditDir -Filter ("runtime-sess-" + $SessionId + ".log") -ErrorAction SilentlyContinue |
            Select-Object -First 1
    }
    if (-not $auditFile) {
        $auditFile = Get-ChildItem -LiteralPath $AuditDir -Filter "runtime-sess-*.log" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }
}

$navLine = ""; $intLine = ""; $eofLine = ""; $dupCount = 0; $eofGateLine = ""
$specialEnterCount = 0; $normalEnterCount = 0; $echoHeldPaintCount = 0; $canonCommitCount = 0
$auditPath = ""; $auditLines = 0
if ($auditFile) {
    $auditPath = $auditFile.FullName
    $all = @(Get-Content -LiteralPath $auditPath -Encoding UTF8 -ErrorAction SilentlyContinue)
    $auditLines = $all.Count
    $navMatches = $all | Select-String -Pattern 'DOCUMENT-DIAGNOSTIC-NAV-POST-DEFAULT-SELECTION' -ErrorAction SilentlyContinue
    if ($navMatches) { $navLine = $navMatches[-1].Line }
    $intMatches = $all | Select-String -Pattern 'ENTER-PLUGIN-INTERVENTION-AUDIT' -ErrorAction SilentlyContinue
    if ($intMatches) { $intLine = $intMatches[-1].Line }
    $eofMatches = $all | Select-String -Pattern 'EOF-BLANK-DECISION|DOCUMENT-DIAGNOSTIC-EOF' -ErrorAction SilentlyContinue
    if ($eofMatches) { $eofLine = $eofMatches[-1].Line }
    $dupCount = ($all | Select-String -Pattern 'ENTER-DUPLICATE-SPLIT-AFTER-FINAL' -ErrorAction SilentlyContinue | Measure-Object).Count
    # EN-11 — group classification facts (all from REAL events)
    $specialEnterCount = ($all | Select-String -Pattern 'ALLOW_SPECIAL_COMMAND' -ErrorAction SilentlyContinue | Measure-Object).Count
    $normalEnterCount  = ($all | Select-String -Pattern 'ALLOW_NORMAL_ENTER' -ErrorAction SilentlyContinue | Measure-Object).Count
    $echoHeldPaintCount = ($all | Select-String -Pattern 'DOCUMENT-DIAGNOSTIC-ECHO-WINDOW-PAINT-HELD' -ErrorAction SilentlyContinue | Measure-Object).Count
    $canonCommitCount = ($all | Select-String -Pattern 'CANONICAL-RECORD-COMMIT' -ErrorAction SilentlyContinue | Measure-Object).Count
    $eofGateMatches = $all | Select-String -Pattern 'VISUAL-CLOSURE-AUDIT' -ErrorAction SilentlyContinue
    if ($eofGateMatches) { $eofGateLine = $eofGateMatches[-1].Line }
}

Write-Output "[PHASE 3] 审计会话事实"
Write-Output "  AUDIT_FILE = $auditPath"
Write-Output "  AUDIT_LINES = $auditLines"
Write-Output ""

# 3.1 审计覆盖门禁（来自真实导航事件）
$auditNavSeen = ($navLine -ne "")
$hasAuditCounters = ($navLine -ne "") -and $navLine.Contains('auditCounters')
$dropCount = Get-IntField $navLine 'AUDITS_DROPPED'
$enqCount  = Get-IntField $navLine 'AUDITS_ENQUEUED'
$flushCnt  = Get-IntField $navLine 'AUDITS_FLUSHED'
$eligCount = Get-IntField $navLine 'KEY_EVENTS_ELIGIBLE'
$rejCount  = Get-IntField $navLine 'AUDITS_REJECTED_WITH_REASON'
$covDec    = Get-StrField $navLine 'auditCoverageDecision'
$anchorInPres = Get-BoolField $navLine 'anchorInsidePluginPresentation'
$caretGate = Get-StrField $navLine 'caretIsolationGateDecision'
$navAnchorOk = ($anchorInPres -eq 'false')

# 3.2 光标隔离六项门禁
$cgEditable = Get-IntField $navLine 'DIAGNOSTIC_TEXT_IN_EDITABLE_TREE_COUNT'
$cgSelAnchor = Get-IntField $navLine 'SELECTION_ANCHOR_IN_PLUGIN_PRESENTATION_COUNT'
$cgNonMd    = Get-IntField $navLine 'NON_MARKDOWN_TEXT_SERIALIZED_COUNT'
$cgArrow    = Get-IntField $navLine 'NATIVE_ARROW_NAVIGATION_REGRESSION_COUNT'
$cgEof      = Get-IntField $navLine 'EOF_CARET_BOUNDARY_VIOLATION_COUNT'
$cgOccl     = Get-IntField $navLine 'DIAGNOSTIC_OVERLAY_CARET_OCCLUSION_COUNT'
$caretAllZero = ($cgEditable -eq 0 -and $cgSelAnchor -eq 0 -and $cgNonMd -eq 0 -and $cgArrow -eq 0 -and $cgEof -eq 0 -and $cgOccl -eq 0)
$caretFieldsPresent = ($cgEditable -ge 0 -and $cgSelAnchor -ge 0 -and $cgNonMd -ge 0 -and $cgArrow -ge 0 -and $cgEof -ge 0 -and $cgOccl -ge 0)

# 3.3 Enter 事件链干预事实
$intSeen = ($intLine -ne "")
$intCreatedTxn = Get-BoolField $intLine 'createdTransaction'
$intPrevented  = Get-BoolField $intLine 'defaultPreventedAtHandlerEnd'

# 3.4 EOF 计数轴
$eofVisible = Get-IntField $eofLine 'renderedVisibleBlankCount'
$eofExcess  = Get-IntField $eofLine 'excessVisibleRows'
$eofSource  = Get-IntField $eofLine 'sourceBlankLineCount'
$eofPublish = Get-BoolField $eofLine 'publish'

# 光标隔离运行时判定（样本/字段缺失 => PENDING，不得以静态 0 冒充 PASS）
$caretRuntimeDecision =
    if (-not $admitted) { 'NOT_ADMITTED' }
    elseif (-not $auditNavSeen -or -not $caretFieldsPresent -or $anchorInPres -eq '') { 'NOT_RUN' }
    elseif ($caretAllZero -and $navAnchorOk) { 'PASS' }
    else { 'FAIL' }

$auditCoverageDecision =
    if (-not $admitted) { 'NOT_ADMITTED' }
    elseif (-not $auditNavSeen -or -not $hasAuditCounters -or $eligCount -le 0) { 'NOT_RUN' }
    elseif ($dropCount -eq 0 -and $eligCount -eq ($enqCount + $rejCount)) { 'PASS' }
    else { 'FAIL' }

if ($auditNavSeen) {
    Write-Output "  [3.1] 审计覆盖（真实导航事件）"
    Write-Output "        KEY_EVENTS_ELIGIBLE=$eligCount ENQUEUED=$enqCount FLUSHED=$flushCnt DROPPED=$dropCount REJECTED=$rejCount"
    Write-Output "        auditCoverageDecision=$covDec  anchorInsidePluginPresentation=$anchorInPres  caretIsolationGate=$caretGate"
    Write-Output "        => AUDIT_COVERAGE=$auditCoverageDecision"
    Write-Output "  [3.2] 光标隔离六项门禁"
    Write-Output "        DIAGNOSTIC_TEXT_IN_EDITABLE_TREE=$cgEditable SELECTION_ANCHOR_IN_PLUGIN_PRESENTATION=$cgSelAnchor"
    Write-Output "        NON_MARKDOWN_TEXT_SERIALIZED=$cgNonMd NATIVE_ARROW_NAV_REGRESSION=$cgArrow EOF_CARET_BOUNDARY_VIOLATION=$cgEof OVERLAY_CARET_OCCLUSION=$cgOccl"
    Write-Output "        => CARET_ISOLATION_RUNTIME=$caretRuntimeDecision"
} else {
    Write-Output "  [3.1]/[3.2] 未发现导航审计样本 => PENDING_USER_MANUAL（请先在正文按下方向键/Home/End）"
}

# ── 3.5 EN-11 组别判定 + 回显窗口门禁（全部来自真实事件） ──
$totalEnterCount = $normalEnterCount + $specialEnterCount
$enterGroup =
    if (-not $admitted) { 'HISTORICAL_NOT_ADMITTED' }
    elseif ($canonCommitCount -gt 0 -or $specialEnterCount -gt 0) { 'D_INDENT_SHORTCUT' }
    elseif ($normalEnterCount -gt 0) { 'C_PLAIN_ENTER' }
    elseif ($auditFile) { 'UNKNOWN_NO_ENTER' }
    else { 'NOT_RUN' }
# R4 §4 — dup=0 在“本次运行没有任何真实 Enter”时**不得**判 PASS。
$en11EchoWindowGate =
    if (-not $admitted) { 'NOT_ADMITTED' }
    elseif ($totalEnterCount -le 0) { 'NOT_RUN' }
    elseif ($dupCount -eq 0) { 'PASS' }
    else { 'FAIL' }

Write-Output "[PHASE 3.5] EN-11 组别 / 回显窗口门禁"
Write-Output "  NORMAL_ENTER=$normalEnterCount  SPECIAL_COMMAND_ENTER=$specialEnterCount  CANONICAL_RECORD_COMMIT=$canonCommitCount"
Write-Output "  ECHO_WINDOW_PAINT_HELD=$echoHeldPaintCount  ENTER_DUPLICATE_SPLIT=$dupCount"
Write-Output "  GROUP=$enterGroup  (A=插件禁用无会话 / B=缩进快捷关闭 / C=普通 Enter / D=。。+Enter)"
Write-Output "  => EN11_ECHO_WINDOW_GATE=$en11EchoWindowGate"
Write-Output ""

# ── PHASE 4 · 真实导出 Markdown 泄漏尽力比对（BEST_EFFORT） ────────────────
$leakCount = -1; $leakSamples = @()
if ($auditFile) {
    $samples = @()
    foreach ($ln in @(Get-Content -LiteralPath $auditPath -Encoding UTF8 -ErrorAction SilentlyContinue)) {
        if ($ln -notmatch 'diagnosticTextSamples') { continue }
        foreach ($mm in [regex]::Matches($ln, '"diagnosticTextSamples"\s*:\s*\[(.*?)\]')) {
            foreach ($sm in [regex]::Matches($mm.Groups[1].Value, '"([^"]{2,})"')) { $samples += $sm.Groups[1].Value }
        }
    }
    $samples = $samples | Select-Object -Unique
    if ($samples.Count -gt 0) {
        $leakCount = 0
        foreach ($doc in @($TargetDocA, $TargetDocB, $TargetDocC)) {
            $dt = Read-Text $doc
            if ($dt -eq "") { continue }
            foreach ($s in $samples) {
                if ($s.Trim().Length -ge 2 -and $dt.Contains($s.Trim())) { $leakCount++; $leakSamples += ($s + ' @ ' + (Split-Path $doc -Leaf)) }
            }
        }
    }
}
Write-Output ""
Write-Output "[PHASE 4] 真实导出 Markdown 插件文字泄漏（BEST_EFFORT）"
if ($leakCount -lt 0) {
    Write-Output "  PLUGIN_TEXT_IN_SERIALIZED_MARKDOWN_COUNT = NOT_RUN（未取得插件文字指纹；需先触发诊断并保存文档）"
} else {
    Write-Output "  PLUGIN_TEXT_IN_SERIALIZED_MARKDOWN_COUNT = $leakCount"
    if ($leakSamples.Count -gt 0) { Write-Output ("  SAMPLES = " + ($leakSamples -join ' | ')) }
}

# ── PHASE 5 · EOF 计数轴（若有样本） ───────────────────────────────────────
Write-Output ""
Write-Output "[PHASE 5] 文末空行计数轴"
if ($eofLine -ne "") {
    Write-Output "  sourceBlankLineCount=$eofSource renderedVisibleBlankCount=$eofVisible excessVisibleRows=$eofExcess publish=$eofPublish"
    Write-Output "  => EOF 计数轴已分离（源码数 != 可见数 属预期）"
} else {
    Write-Output "  NOT_RUN（请打开 Trailing-Blank-3/0.md 并触发文末诊断）"
}

# ── PHASE 6 · 结论 ─────────────────────────────────────────────────────────
$running = $typoraRunning
$overallIdentity =
    if (-not $running) { 'FAIL' }
    elseif ($identityExact -and $initCountOk -and $loadSourceOk -and $vaultRootOk) { 'PASS' }
    else { 'FAIL' }

Write-Output ""
Write-Output "=========================================================="
Write-Output "VERDICT"
Write-Output "=========================================================="
Write-Output "TYPORA_RUNNING            = $running"
Write-Output "RESPONDING                = $respondingOk"
Write-Output "RUNTIME_IDENTITY          = $overallIdentity"
Write-Output "LOADED_MARKERS            = $markersAllPresent"
Write-Output "AUDIT_COVERAGE            = $auditCoverageDecision"
Write-Output "CARET_ISOLATION_RUNTIME   = $caretRuntimeDecision"
Write-Output "ENTER_EOF_RUNTIME         = PENDING_USER_MANUAL (需 C0/C4 真实对照)"
Write-Output "EOF_VISUAL_RUNTIME        = PENDING_USER_MANUAL (需人工目检)"
Write-Output "CAPTION_INTERACTION       = PENDING_USER_MANUAL (需真实鼠标)"
Write-Output "PLUGIN_TEXT_IN_MARKDOWN   = $(if($leakCount -lt 0){'NOT_RUN'}else{$leakCount})"
Write-Output "ENTER_DUPLICATE_SPLIT_OBSERVED = $dupCount"
Write-Output "EN11_GROUP                = $enterGroup"
Write-Output "EN11_ECHO_WINDOW_GATE     = $en11EchoWindowGate"
Write-Output "ECHO_WINDOW_PAINT_HELD    = $echoHeldPaintCount"
Write-Output "ADMISSION                 = $admissionReason"
Write-Output ""

if (-not $running) {
    Write-Output "!! 未检测到运行中的 Typora。唯一必需动作：人工重启 Typora 并打开 test vault 后重新运行本脚本。"
    Write-Output "   （本脚本不会、也不允许自行启动 Typora。）"
}
if ($running -and -not $identityExact) {
    Write-Output "!! 已加载 SHA ($loadSha) != 部署/构建 SHA ($deploySha)。请人工重启 Typora 重新加载。"
}

# ── PHASE 7 · 人工验收清单（脚本无法合成的真实输入） ───────────────────────
Write-Output ""
Write-Output "=========================================================="
Write-Output "MANUAL CHECKLIST（真实键盘/鼠标/像素；脚本无法合成 trusted 输入）"
Write-Output "=========================================================="
Write-Output "  C0/C4 配对：先在 vault 内禁用墨章(C0)对 Trailing-Blank-3.md 文末按一次 Enter，记录"
Write-Output "              最终 Markdown 字节/终止 LF/SPLIT 次数；再启用墨章(C4)同条件重复并比较。"
Write-Output "  A01-A10    ：方向键/Home/End/Ctrl+End/Ctrl+A/拖选/Backspace+Undo+Redo/Enter×3/题注交互/跨文档。"
Write-Output "  B00-B13    ：N=0/1/2/5/10 可见空行 + 序列 1→2→10→5→2→1→0→1 + 源码模式↔WYSIWYG + 保存重开。"
Write-Output "  C01-C08    ：滚动/侧栏折叠拖拽/窗口大小/ Drawer 开关筛选/同屏多警告/连续编辑不卡死/C0-C4 差异。"
Write-Output "  每例记录：caseId | before/after SHA | caretBefore/After | DOM blank N | Drawer | overlay | decision"
Write-Output ""

# ── 生成报告文件 ───────────────────────────────────────────────────────────
if (-not $NoReport) {
    $stamp = (Get-Date).ToString("o")
    $report = @()
    $report += "# P0-CARET-EOF-POSTRESTART-ACCEPTANCE"
    $report += ""
    $report += "> 生成时间：$stamp | 脚本：scripts/verify-p0-caret-eof-postrestart.ps1"
    $report += "> 审计会话：$auditPath"
    $report += ""
    $report += "## 运行实例身份"
    $report += "- TYPORA_RUNNING=$running  RESPONDING=$responding  PID=$pidValue  HWND=$hwnd"
    $report += "- TITLE=$title"
    $report += "- BUILD_SHA256=$buildSha"
    $report += "- DEPLOY_SHA256=$deploySha"
    $report += "- LOADED_SHA256=$loadSha  LOADED_AT=$loadedAt  INIT_COUNT=$initCount  LOAD_SOURCE=$loadSource"
    $report += "- GLOBAL_PRODUCTION_SHA256=$globalSha (未覆盖)"
    $report += "- RUNTIME_IDENTITY=$overallIdentity"
    $report += ""
    $report += "## 载入产物门禁标记"
    foreach ($r in $markerResults) { $report += "- $($r.Marker) = $($r.Present)" }
    $report += "- MARKERS_ALL_PRESENT=$markersAllPresent"
    $report += ""
    $report += "## 审计事实"
    $report += "- AUDIT_COVERAGE=$auditCoverageDecision (ELIGIBLE=$eligCount ENQUEUED=$enqCount FLUSHED=$flushCnt DROPPED=$dropCount REJECTED=$rejCount)"
    $report += "- CARET_ISOLATION_RUNTIME=$caretRuntimeDecision"
    $report += "  - DIAGNOSTIC_TEXT_IN_EDITABLE_TREE=$cgEditable SELECTION_ANCHOR_IN_PLUGIN_PRESENTATION=$cgSelAnchor NON_MARKDOWN_TEXT_SERIALIZED=$cgNonMd"
    $report += "  - NATIVE_ARROW_NAV_REGRESSION=$cgArrow EOF_CARET_BOUNDARY_VIOLATION=$cgEof OVERLAY_CARET_OCCLUSION=$cgOccl"
    $report += "- ENTER-PLUGIN-INTERVENTION: seen=$intSeen createdTransaction=$intCreatedTxn defaultPreventedAtHandlerEnd=$intPrevented"
    $report += "- ENTER_DUPLICATE_SPLIT_OBSERVED=$dupCount"
    $report += "- EN11_GROUP=$enterGroup  EN11_ECHO_WINDOW_GATE=$en11EchoWindowGate  ECHO_WINDOW_PAINT_HELD=$echoHeldPaintCount"
    $report += "- EN-11 facts: NORMAL_ENTER=$normalEnterCount SPECIAL_COMMAND_ENTER=$specialEnterCount CANONICAL_RECORD_COMMIT=$canonCommitCount"
    $report += "- EOF: sourceBlankLineCount=$eofSource renderedVisibleBlankCount=$eofVisible excessVisibleRows=$eofExcess publish=$eofPublish"
    $report += "- PLUGIN_TEXT_IN_SERIALIZED_MARKDOWN_COUNT=$(if($leakCount -lt 0){'NOT_RUN'}else{$leakCount})"
    $report += ""
    $report += "## 结论"
    $report += "- ENTER_EOF_RUNTIME=PENDING_USER_MANUAL"
    $report += "- EOF_VISUAL_RUNTIME=PENDING_USER_MANUAL"
    $report += "- CAPTION_INTERACTION=PENDING_USER_MANUAL"
    $report += "- FULL_RUNTIME_ACCEPTANCE=$(if($overallIdentity -eq 'PASS' -and $auditCoverageDecision -eq 'PASS'){'PARTIAL'}else{'PENDING'})"
    $report += ""
    if (-not (Test-Path -LiteralPath $EvidenceDir)) { $null = New-Item -ItemType Directory -Force -Path $EvidenceDir }
    [System.IO.File]::WriteAllText($ReportPath, ($report -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "REPORT_WRITTEN: $ReportPath"
}

# ── OVERALL_DECISION + 退出码（R4 §4：返回码与判定对齐，待人工不算通过） ──
$gateValues = @($auditCoverageDecision, $caretRuntimeDecision, $en11EchoWindowGate)
$anyFail = ($gateValues -contains 'FAIL') -or ($running -and -not $identityExact) -or ($running -and -not $markersAllPresent)
$anyPending = ($gateValues -contains 'NOT_RUN') -or ($gateValues -contains 'NOT_ADMITTED') `
    -or ($gateValues -contains 'PENDING_USER_MANUAL') -or (-not $admitted)
$overallDecision = if ($anyFail) { 'FAIL' } elseif ($anyPending) { 'PENDING_USER_MANUAL' } else { 'PASS' }
Write-Output ""
Write-Output "OVERALL_DECISION=$overallDecision"
if ($overallDecision -eq 'FAIL') { exit 2 }
exit 0
