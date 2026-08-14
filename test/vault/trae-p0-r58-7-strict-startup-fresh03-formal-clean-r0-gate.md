# Trae P0 — R58.7 Strict Startup Provenance + Fresh-03 Formal Clean R0 Gate

## 0. 任务目标

当前禁止继续修改 Caret / Canonical / Rehydrate 业务逻辑。

当前 Build：

```text
inkchapter-r58-7-clean-r0-closure-p4v9n
```

当前已经具备：

```text
source / tests / build:dev = PASS
fresh-02 Clean R0 behavioral stability = PASS
probe lifecycle COMPLETE = PASS / runtime
Canonical Transfer = PASS / FREEZE
```

本轮只完成：

```text
Path Authority
→ Strict Startup Provenance
→ Fresh-03 Clean Runtime Baseline
→ Formal Clean R0
```

在以上全部完成前：

```text
R58.7 FULL CLOSURE = NOT ACCEPTED
R60 BLOCKED
```

---

# 1. 全面冻结

本轮禁止：

```text
修改 CaretExpectation
修改 TEXT_INPUT UserIntent
修改 restoreLogicalCaret
修改 CARET-REPAIR
修改 NormalEnter
修改 Canonical Transfer
修改 Rehydrate 业务行为
修改 Historical resolver
修改 Save-As
修改 Merge

build
build:dev
deploy
改 Build ID

删除 sidecar
清空 fresh-03 历史来制造 clean fixture
git add
git commit
git push
```

除非后续证据证明当前 artifact 本身错误，否则本轮只允许只读验证。

---

# 2. Path Authority — 必须先解决 `.typora` 路径混淆

唯一合法 runtime 根目录：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora
```

禁止使用：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault.typora
```

先执行并保留完整 stdout：

```powershell
$root = "D:\TyporaPluginProjects\typora-plugin-inkchapter"
$vault = Join-Path $root "test\vault"
$dotTypora = Join-Path $vault ".typora"
$wrong = Join-Path $root "test\vault.typora"

Write-Output "=== PATH AUTHORITY ==="
Write-Output "root=$root"
Write-Output "vault=$vault"
Write-Output "dotTypora=$dotTypora"
Write-Output "vaultExists=$(Test-Path $vault)"
Write-Output "dotTyporaExists=$(Test-Path $dotTypora)"

Write-Output "=== FORBIDDEN SHADOW PATH ==="
Write-Output "wrongPath=$wrong"
Write-Output "wrongPathExists=$(Test-Path $wrong)"
```

必须明确报告：

```text
AUTHORITY PATH =
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora
```

后续所有：

```text
runtime-load
runtime main.js
runtime style.css
sidecar
```

必须从 `$dotTypora` 派生。

如果任何命令再次出现：

```text
test\vault.typora
```

则：

```text
CURRENT VERIFICATION INVALID
STOP
```

---

# 3. Fresh-03 输入前磁盘 Clean Gate

目标：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\r58-caret-a1-fresh-03.md
```

执行：

```powershell
$fixture = Join-Path $vault "r58-caret-a1-fresh-03.md"
$sidecarDir = Join-Path $dotTypora "inkchapter\paragraph-layout"
$sidecar = Join-Path $sidecarDir "r58-caret-a1-fresh-03.md.json"

Write-Output "=== FRESH-03 PRECHECK ==="
Write-Output "fixturePath=$fixture"
Write-Output "fixtureExists=$(Test-Path $fixture)"
Write-Output "sidecarPath=$sidecar"
Write-Output "sidecarExists=$(Test-Path $sidecar)"

if (Test-Path $sidecar) {
    try {
        $sj = Get-Content $sidecar -Raw | ConvertFrom-Json

        if ($null -ne $sj.paragraphOverrides) {
            Write-Output "recordCount=$($sj.paragraphOverrides.Count)"
        } elseif ($null -ne $sj.records) {
            Write-Output "recordCount=$($sj.records.Count)"
        } else {
            Write-Output "recordCount=UNKNOWN_SCHEMA"
        }
    } catch {
        Write-Output "sidecarParseError=$($_.Exception.Message)"
    }
} else {
    Write-Output "recordCount=0"
}
```

必须：

```text
fixtureExists=true
sidecarExists=false
recordCount=0
```

如果不是：

```text
FRESH-03 CLEAN PRECHECK FAIL
STOP
```

不得删除 sidecar 后继续。

---

# 4. oldProcessExited 必须直接证明，不允许推断

禁止：

```text
loadedAt 新
initializationCount=1
无更早进程
```

来推断：

```text
oldProcessExited=true
```

必须使用真实旧 PID。

当前若 Typora 正在运行：

```text
先记录 old PID
```

例如：

```text
oldPid=35920
```

然后由用户在 sandbox 外手动关闭 Typora。

Trae 只读执行：

```powershell
Write-Output "=== OLD PROCESS EXIT CHECK ==="

$oldPid = <填入刚才记录的真实旧 PID>

$old = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
Write-Output "oldPid=$oldPid"
Write-Output "oldPidStillExists=$($null -ne $old)"

$current = Get-Process Typora -ErrorAction SilentlyContinue
Write-Output "typoraCountAfterClose=$(@($current).Count)"
```

必须：

```text
oldPidStillExists=false
typoraCountAfterClose=0
```

此时才允许：

```text
oldProcessExited=true
```

---

# 5. 用户手动重新启动 Fresh-03

禁止 Trae 在 sandbox 内强制 `Start-Process Typora`。

由用户在 sandbox 外手动打开：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\r58-caret-a1-fresh-03.md
```

启动后用户暂时不要输入任何内容。

Trae 立即只读执行：

```powershell
Write-Output "=== NEW TYPORA PROCESS ==="

Get-Process Typora -ErrorAction SilentlyContinue |
    Select-Object Id, StartTime, MainWindowHandle, MainWindowTitle |
    Format-List
```

必须找到主窗口进程：

```text
new PID != old PID
StartTime = 本次新启动
MainWindowHandle != 0
MainWindowTitle = r58-caret-a1-fresh-03.md - Typora
```

---

# 6. Correct Runtime-Load Verification

只能读取：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\inkchapter-runtime-load.json
```

执行：

```powershell
$rl = Join-Path $dotTypora "inkchapter-runtime-load.json"

Write-Output "=== CORRECT RUNTIME LOAD ==="
Write-Output "runtimeLoadPath=$rl"
Write-Output "runtimeLoadExists=$(Test-Path $rl)"

if (Test-Path $rl) {
    $j = Get-Content $rl -Raw | ConvertFrom-Json

    Write-Output "buildMarker=$($j.buildMarker)"
    Write-Output "initializationCount=$($j.initializationCount)"
    Write-Output "mainJsPath=$($j.mainJsPath)"
    Write-Output "mainJsSha256=$($j.mainJsSha256)"
    Write-Output "loadedAt=$($j.loadedAt)"
}
```

必须：

```text
buildMarker=inkchapter-r58-7-clean-r0-closure-p4v9n
initializationCount=1
mainJsPath=
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js
```

---

# 7. Direct Artifact SHA — Correct Path Only

执行：

```powershell
$projectMain = Join-Path $root "dist\main.js"
$runtimeMain = Join-Path $dotTypora "plugins\dist\main.js"

$projectStyle = Join-Path $root "dist\style.css"
$runtimeStyle = Join-Path $dotTypora "plugins\dist\style.css"

$pm = (Get-FileHash $projectMain -Algorithm SHA256).Hash
$rm = (Get-FileHash $runtimeMain -Algorithm SHA256).Hash
$ps = (Get-FileHash $projectStyle -Algorithm SHA256).Hash
$rs = (Get-FileHash $runtimeStyle -Algorithm SHA256).Hash

Write-Output "=== DIRECT SHA ==="
Write-Output "projectMainPath=$projectMain"
Write-Output "runtimeMainPath=$runtimeMain"
Write-Output "projectMainSHA=$pm"
Write-Output "runtimeMainSHA=$rm"
Write-Output "mainMatch=$($pm -eq $rm)"

Write-Output "projectStylePath=$projectStyle"
Write-Output "runtimeStylePath=$runtimeStyle"
Write-Output "projectStyleSHA=$ps"
Write-Output "runtimeStyleSHA=$rs"
Write-Output "cssMatch=$($ps -eq $rs)"
```

必须：

```text
mainMatch=true
cssMatch=true
```

当前预期 main SHA：

```text
A4AA5689C724E427A5108895E329070406AA7CA47EBDE74559D785B1B9C77CA3
```

当前预期 style SHA：

```text
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

若 direct SHA 与预期不同：

```text
ARTIFACT PROVENANCE FAIL
STOP
```

不得 build 来掩盖。

---

# 8. Strict Startup Mandatory Gate

必须同时证明：

```text
oldProcessExited=true

new PID
new StartTime
MainWindowHandle != 0
MainWindowTitle != ""

targetVault =
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault

targetDocument =
r58-caret-a1-fresh-03.md

runtime main path =
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js

project/runtime SHA match=true
style SHA match=true

Build ID =
inkchapter-r58-7-clean-r0-closure-p4v9n

runtime Build ID =
inkchapter-r58-7-clean-r0-closure-p4v9n

initializationCount=1
```

任何一个字段缺失：

**启动命令已发出，但尚未确认成功**

不得进入 R0。

---

# 9. Fresh-03 Runtime Clean Baseline

仅磁盘：

```text
sidecarExists=false
recordCount=0
```

还不够。

必须取得 fresh-03 本次 runtime console 的直接证据。

优先通过 Typora DevTools Console 捕获。

搜索：

```text
r58-caret-a1-fresh-03
SIDECAR-ACTUAL-LOAD
PERSISTED_LOAD
PERSISTED_HISTORICAL
```

必须看到：

```text
SIDECAR-ACTUAL-LOAD:
documentKey=r58-caret-a1-fresh-03.md
exists=false
recordCount=0
source=physical
```

并确认从本次 plugin initialization 到 R0 输入前：

```text
PERSISTED_LOAD count=0
PERSISTED_HISTORICAL count=0
```

允许：

```text
DOCUMENT-CONTEXT-STATE mode=PERSISTED
persistenceKey=r58-caret-a1-fresh-03.md
```

但不得存在 historical record load。

---

# 10. 不要依赖错误日志位置

`SIDECAR-ACTUAL-LOAD` / `PERSISTED_LOAD` 当前属于 `[InkChapter]` console 输出。

不要假设：

```text
.typora\__plugin-logger.log
```

一定包含这些内容。

如果 framework logger 无这些事件，则直接使用：

```text
Typora DevTools Console
```

复制/导出本次 fresh-03 runtime 输出。

禁止因为找不到落盘日志就修改业务代码。

---

# 11. READY FOR FORMAL CLEAN R0 判定

只有同时满足：

```text
PATH AUTHORITY PASS
FRESH-03 DISK CLEAN PASS
OLD PROCESS EXIT PASS
NEW PROCESS/WINDOW PASS
RUNTIME-LOAD PASS
DIRECT SHA PASS
FRESH-03 RUNTIME CLEAN BASELINE PASS
```

才允许输出：

```text
STRICT STARTUP PASS
CLEAN BASELINE PASS
READY FOR FORMAL CLEAN R0
```

否则必须：

```text
启动命令已发出，但尚未确认成功
FORMAL CLEAN R0 NOT EXECUTED
R60 BLOCKED
```

---

# 12. Formal Clean R0 — 只执行一次

必须由用户手工执行：

```text
。。
Enter
Enter
立即输入 。
等待至少 2.5 秒
```

然后停止输入。

Trae 不得模拟按键，不得连续执行多轮。

---

# 13. Formal Clean R0 Mandatory Runtime Evidence

必须定位唯一目标 observation：

```text
POST-TEXT-INPUT-ARM count=1
```

必须完整存在：

```text
CARET-EXPECTATION-SUPERSESSION-AUDIT superseded=true

IME-EVENT-ORDER
TEXT-COMMIT-AUDIT

COMMIT+0
COMMIT+16
COMMIT+50
COMMIT+150
COMMIT+300
COMMIT+500
COMMIT+1000
COMMIT+2200

POST-TEXT-INPUT-COMPLETE
```

要求：

```text
activeObservationAfterComplete=none
pendingCallbackCountAfterComplete=0
```

---

# 14. Formal Clean R0 Behavioral PASS

必须：

```text
COMMIT+50    visibleText="。" logicalOffset=1 insideEditor=true
COMMIT+150   visibleText="。" logicalOffset=1 insideEditor=true
COMMIT+300   visibleText="。" logicalOffset=1 insideEditor=true
COMMIT+500   visibleText="。" logicalOffset=1 insideEditor=true
COMMIT+1000  visibleText="。" logicalOffset=1 insideEditor=true
COMMIT+2200  visibleText="。" logicalOffset=1 insideEditor=true
```

同时：

```text
CARET-CONTINUITY-RESTORE after typing = 0
CARET-REPAIR after typing = 0
unexpected PLUGIN-SELECTION-WRITE = 0
rehydrate actualDomWriteCount causing caret reset = 0
```

如果出现：

```text
1 → 0 → 1
```

但 COMMIT+50 以后稳定为 1：

```text
native / IME / Typora transient candidate
NO BUSINESS FIX
```

---

# 15. Canonical Regression Gate

必须继续：

```text
SOURCE-SNAPSHOT state=CURRENT_LIVE
CANONICAL-VISUAL-VERIFY overall=true
PROJECTION-VERIFY overall=true
RECORD-LIFECYCLE TRANSFER
CANONICAL-TRANSFER-FINAL-AUDIT overall=true
AWAITING-TRANSFER-LEAK-AUDIT awaitingCount=0
NORMAL-ENTER-FINAL overall=true
```

否则 Formal Clean R0 FAIL。

---

# 16. Enter Admission Gate

必须：

```text
Process / Period → REJECT_NON_ENTER
```

且：

```text
normalEnterTxnCreatedFromNonEnterCount=0
```

---

# 17. Formal Verdict

只有本次 fresh-03 同时满足：

```text
Strict Startup PASS
Clean Baseline PASS
Formal Clean R0 behavioral PASS
Probe COMPLETE PASS
Canonical PASS
Enter Admission PASS
```

才允许：

```text
STRICT STARTUP PASS
CLEAN BASELINE PASS
FORMAL CLEAN R0 PASS
PROCEED TO A1 MATRIX
```

否则：

```text
FORMAL CLEAN R0 FAIL — <具体原因>
R60 BLOCKED
```

---

# 18. A1 Matrix 暂不执行

本轮只做到：

```text
FORMAL CLEAN R0
```

即使 PASS，也先 STOP。

不要自动开始 A1×10。

下一阶段再单独执行：

```text
A1 fresh canonical ×10
```

fresh-03 不计入 A1。

---

# 19. 最终报告格式

```text
=== PATH AUTHORITY ===
root:
vault:
dotTypora:
wrongPath:
authorityPathPass:

=== OLD PROCESS EXIT ===
oldPid:
oldPidStillExists:
typoraCountAfterClose:
oldProcessExited:

=== NEW STARTUP ===
PID:
StartTime:
MainWindowHandle:
MainWindowTitle:
targetVault:
targetDocument:

=== RUNTIME IDENTITY ===
runtimeLoadPath:
runtimeBuildId:
initializationCount:
runtimeMainPath:

=== SHA ===
projectMainSHA:
runtimeMainSHA:
mainMatch:
projectStyleSHA:
runtimeStyleSHA:
cssMatch:

=== FRESH-03 DISK CLEAN ===
fixtureExists:
sidecarExists:
recordCount:

=== FRESH-03 RUNTIME CLEAN ===
SIDECAR-ACTUAL-LOAD:
persistedLoadCount:
persistedHistoricalCount:

=== FORMAL CLEAN R0 ===
observationId:
TEXT_COMMIT:
COMMIT+50:
COMMIT+150:
COMMIT+300:
COMMIT+500:
COMMIT+1000:
COMMIT+2200:
caretRestore:
caretRepair:
pluginSelectionWrite:
rehydrateActualDomWrite:
POST-TEXT-INPUT-COMPLETE:
activeObservationAfterComplete:
pendingCallbackCountAfterComplete:

=== CANONICAL ===
visualVerify:
projectionVerify:
finalAudit:
awaitingLeak:
normalEnterFinal:

=== ENTER ADMISSION ===
processPeriodDecision:
nonEnterCreatedNormalEnter:

=== VERDICT ===
strictStartup:
cleanBaseline:
formalCleanR0:
R60:
```

---

# 20. Git

禁止：

```text
git add
git commit
git push
```
