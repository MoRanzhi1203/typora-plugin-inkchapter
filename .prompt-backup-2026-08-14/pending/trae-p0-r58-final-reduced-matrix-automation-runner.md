# Trae P0 — R58 Final Reduced Matrix 全自动 Runner

## 0. 当前目标

当前 Build 固定为：

```text
inkchapter-r58-7-persisted-docswitch-scope-authority-dsw2q7
```

当前已确认：

```text
PERSISTED→PERSISTED DOCUMENT_SWITCH SCOPE AUTHORITY
= FIXED / RUNTIME PASS

Caret / Probe / Canonical Transfer
= NO REGRESSION

Reduced Matrix
= MAY RESUME

R58.7 PRACTICAL CLOSURE
= NOT YET

R60
= BLOCKED
```

本轮不继续修改插件业务逻辑，而是实现一个可复用的：

```text
R58 Final Matrix Runner v1
```

目标是把以下人工验收：

```text
Strict Startup
A1 ×3
A2 ×1
A3 ×1
B1 ×2
```

自动化为：

```powershell
.\scripts\r58-matrix\run-r58-final-matrix.ps1
```

Runner 自动完成：

```text
fixture reset
→ strict startup
→ A1-01
→ document switch
→ A1-02
→ document switch
→ A1-03
→ document switch
→ A2
→ document switch
→ A3
→ B1 seed
→ restart
→ B1-01
→ B1-02
→ parse
→ final-summary.md/json
```

---

# 1. 本轮冻结插件业务源码

除非 Runner 暴露真实业务 FAIL，否则禁止修改：

```text
src/heading-numbering/**
CaretExpectation
Post-TEXT_INPUT probe
SelectionTruth
NormalEnter
Canonical Transfer
Canonical visual verifier
Canonical Registry
DocumentRuntimeContext
Historical resolver
Save-As classifier
Merge
Rehydrate
```

当前 Build：

```text
inkchapter-r58-7-persisted-docswitch-scope-authority-dsw2q7
```

本轮禁止：

```text
build
build:dev
deploy
修改 Build ID
git add
git commit
git push
```

Runner 必须测试当前真实部署 artifact，而不是测试内部 mock。

---

# 2. Runner 必须是外部黑盒

建议目录：

```text
scripts/r58-matrix/
  run-r58-final-matrix.ps1
  fixture-manager.ps1
  process-control.ps1
  window-input.ps1
  document-switch-driver.ps1
  console-collector.js
  trial-parser.js
  report-writer.js
  scenarios.json
  README.md
```

允许：

```text
PowerShell
Win32 user32.dll
SendInput
SetForegroundWindow
GetForegroundWindow
Chrome DevTools Protocol
Node.js 解析日志
AutoHotkey（仅本机已安装且行为可验证时）
```

禁止：

```text
dispatchEvent(new KeyboardEvent(...))
element.textContent = ...
document.execCommand(...)
Runtime.evaluate 直接插入文本
直接调用插件内部函数
人工伪造 beforeinput/input/compositionend
修改插件增加 testMode
```

---

# 3. 三阶段执行模式

Runner 至少支持：

```powershell
.\scripts\r58-matrix\run-r58-final-matrix.ps1 -Mode DryRun
```

```powershell
.\scripts\r58-matrix\run-r58-final-matrix.ps1 -Mode InputSmoke
```

```powershell
.\scripts\r58-matrix\run-r58-final-matrix.ps1 -Mode Full
```

执行顺序必须：

```text
DryRun PASS
↓
InputSmoke PASS
↓
Full Matrix
```

Smoke 未 PASS 时禁止 Full。

---

# 4. DryRun

DryRun 禁止发送任何编辑按键。

只验证：

```text
project root
vault root
.typora path
runtime main path
runtime style path
fixture directory
sidecar directory

Typora executable discoverable
Typora process discovery works
MainWindowHandle discovery works
SetForegroundWindow capability works

project/runtime main SHA readable
style SHA readable
runtime-load readable

console collector capability
CDP capability
artifact output directory writable
```

正确路径：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora
```

严禁：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault.typora
```

DryRun 结果写入：

```text
artifacts/r58-final/dry-run.json
artifacts/r58-final/dry-run.md
```

---

# 5. InputSmoke

InputSmoke 使用专用 disposable fixture：

```text
r58-automation-input-smoke.md
```

不得占用正式 A1 fixture。

Smoke 目标只证明：

```text
Windows input
→ Typora
→ current Chinese IME
→ trusted browser events
```

操作：

```text
focus Typora
→ 发送两次实体 Period 键
→ Enter
→ Enter
→ 发送一次实体 Period 键
→ wait >= 2.5s
```

必须在 runtime 中看到：

```text
KEYBOARD-EVENT-PROVENANCE:
key=Process
code=Period
isTrusted=true
```

并存在真实 IME 链：

```text
compositionstart
beforeinput inputType=insertCompositionText
input
compositionend
IME-EVENT-ORDER
```

如果只出现：

```text
isTrusted=false
```

或者没有 composition 链：

```text
INPUT SMOKE = FAIL
reason=INPUT_PROVENANCE_MISMATCH
```

禁止运行 Full Matrix。

---

# 6. Windows 输入层

推荐：

```text
PowerShell + Add-Type C# P/Invoke
```

实现：

```text
user32!SetForegroundWindow
user32!GetForegroundWindow
user32!SendInput
```

每次发送输入前：

```text
target PID 已知
target HWND 已知
MainWindowHandle != 0
SetForegroundWindow(targetHWND)
等待 100~300ms
GetForegroundWindow() == targetHWND
```

只有前台确认成功才允许发送按键。

中文句号必须通过实体：

```text
VK_OEM_PERIOD / physical Period key
```

产生。

禁止：

```text
Unicode 直接注入 "。"
clipboard paste
DOM text insertion
```

---

# 7. Fixture Reset

正式 Full Matrix 开始前自动重置：

```text
r58-caret-a1-fresh-01.md
...
r58-caret-a1-fresh-10.md
```

只允许删除：

```text
test\vault\r58-caret-a1-fresh-XX.md
test\vault\.typora\inkchapter\paragraph-layout\r58-caret-a1-fresh-XX.md.json
```

禁止删除：

```text
历史 app-*.log
runtime-load
plugins
dist
其他 fixture
其他 sidecar
```

然后重新生成 01~10。

要求：

```text
fresh-01 fixtureExists=true sidecarExists=false
...
fresh-10 fixtureExists=true sidecarExists=false
```

标记：

```text
TEST FIXTURE RESET
```

旧日志保留，但不得与重置后的 fixture 混用作为 clean provenance。

---

# 8. 正式 Trial 分配

```text
A1-01 → r58-caret-a1-fresh-01.md
A1-02 → r58-caret-a1-fresh-02.md
A1-03 → r58-caret-a1-fresh-03.md

A2-01 → r58-caret-a1-fresh-04.md

A3-01 → r58-caret-a1-fresh-05.md
```

保留：

```text
fresh-06
fresh-07
fresh-08
fresh-09
fresh-10
```

作为 INVALID trial 的替补 fixture。

失败 trial 不得自动换替补。

只有明确属于：

```text
TRIAL INVALID
```

例如输入 provenance 不匹配、用户/脚本多输入了额外字符，才允许人工决定是否使用替补。

---

# 9. Strict OS Startup

Full Matrix 开始时必须执行一次真实 Strict Startup。

Runner 自动：

```text
记录 old Typora PID
→ Stop-Process
→ 等待旧 PID 消失
→ 确认 Typora process count=0
→ 启动 fresh-01
→ 获取 new PID
→ StartTime
→ MainWindowHandle
→ MainWindowTitle
```

同时验证：

```text
target vault
target document
runtime plugin main path
Build ID
runtime Build ID
project/runtime main SHA
style SHA
initializationCount
```

必须生成原始结果：

```text
oldPid
oldPidExited
processCountAfterClose
newPid
startTime
mainWindowHandle
mainWindowTitle
targetVault
targetDocument
runtimeMainPath
projectMainSha
runtimeMainSha
mainMatch
styleSha
buildId
runtimeBuildId
initializationCount
```

任何 mandatory 字段缺失：

```text
STRICT STARTUP = FAIL
```

并在报告中写：

```text
启动命令已发出，但尚未确认成功
```

---

# 10. Console 自动捕获

优先实现：

```text
Typora remote debugging
→ CDP
→ Runtime.enable
→ Log.enable
→ Runtime.consoleAPICalled
→ Runtime.exceptionThrown
```

每个 trial 建立独立 evidence window。

输出：

```text
artifacts/r58-final/
  startup.json
  startup.log

  A1-01.log
  A1-01.json
  A1-02.log
  A1-02.json
  A1-03.log
  A1-03.json

  A2-01.log
  A2-01.json

  A3-01.log
  A3-01.json

  B1-01.log
  B1-01.json
  B1-02.log
  B1-02.json

  final-summary.json
  final-summary.md
```

如果 CDP 不可用：

```text
先 capability probe
```

不得修改插件业务源码来配合测试。

---

# 11. Trial Evidence Window

每轮必须明确：

```text
TRIAL-START
↓
document context ready
↓
clean/historical baseline
↓
固定输入
↓
对应稳定边界
↓
TRIAL-END
```

A1：

```text
TRIAL-END = POST-TEXT-INPUT-COMPLETE
```

A2：

```text
TRIAL-END = 后续输入稳定 >= 2.5s
```

A3：

```text
TRIAL-END = split 后 >= 2.5s，无额外 TEXT_INPUT
```

B1：

```text
TRIAL-END = historical rehydrate/interaction stable boundary
```

TRIAL-END 后所有日志标记：

```text
POST-TRIAL ACTIVITY
```

不得参与该 trial 判定。

---

# 12. A1 ×3

每轮输入：

```text
。。
Enter
Enter
立即输入 。
wait >= 2.5s
```

必须使用真实 Windows input。

输入前必须：

```text
SIDECAR-ACTUAL-LOAD exists=false recordCount=0 source=physical
PERSISTED_LOAD=0
PERSISTED_HISTORICAL=0
scopeId=currentFixture
persistenceKey=currentFixture
activeFilePath=currentFixture
awaitingCount=0
CANONICAL-SCOPE-MISMATCH=0
```

A1 PASS 必须：

```text
Process/Period → REJECT_NON_ENTER
isTrusted=true
IME composition chain exists
POST-TEXT-INPUT-ARM exactly 1
CARET-EXPECTATION-SUPERSESSION-AUDIT superseded=true restoreAttempted=false

COMMIT+50=1
COMMIT+150=1
COMMIT+300=1
COMMIT+500=1
COMMIT+1000=1
COMMIT+2200=1

visibleText="。"
insideEditor=true

CARET-CONTINUITY-RESTORE=0
CARET-REPAIR=0
unexpected PLUGIN-SELECTION-WRITE=0

POST-TEXT-INPUT-COMPLETE exactly once
activeObservationAfterComplete=none
pendingCallbackCountAfterComplete=0

CANONICAL-VISUAL-VERIFY overall=true
PROJECTION-VERIFY overall=true
CANONICAL-TRANSFER-FINAL-AUDIT overall=true
NORMAL-ENTER-FINAL overall=true

AWAITING-TRANSFER-LEAK awaitingCount=0
CANONICAL-SCOPE-MISMATCH=0
```

A1 必须 3/3 PASS。

---

# 13. 同 Session Document Switch

A1-01 之后禁止重启。

自动：

```text
fresh-01 → fresh-02
fresh-02 → fresh-03
fresh-03 → fresh-04
fresh-04 → fresh-05
```

每次 file-open 后必须先验证：

```text
scopeIdBefore=oldFixture
scopeIdAfter=newFixture
scopeIdSame=false
persistenceKeyBefore=oldFixture
persistenceKeyAfter=newFixture
reason=DOCUMENT_SWITCH
decision=SWITCH_DOCUMENT
preserveScope=false
```

随后：

```text
scopeId == persistenceKey == documentKey == currentFixture
```

如果不一致：

```text
TRIAL FAIL
reason=DOCUMENT_SCOPE_AUTHORITY
```

立即停止。

---

# 14. A2 ×1

文件：

```text
r58-caret-a1-fresh-04.md
```

禁止 special canonical command。

操作：

```text
输入普通测试段落
Enter
立即输入 。
wait >= 2.5s
```

必须：

```text
sourceCanonicalRecordId=none
canonicalOutcomeOverall=n/a
NORMAL-ENTER-FINAL overall=true
selectionInsideEditor=true
CARET-CONTINUITY-RESTORE=0
CARET-REPAIR=0
unexpected PLUGIN-SELECTION-WRITE=0
AWAITING-TRANSFER-LEAK awaitingCount=0
CANONICAL-SCOPE-MISMATCH=0
```

---

# 15. A3 ×1

文件：

```text
r58-caret-a1-fresh-05.md
```

操作：

```text
。。
Enter
Enter
然后不再输入文字
wait >= 2.5s
```

重点验证：

```text
completedOriginalRuntimeId 正确
caretDestinationRuntimeId 正确
canonicalOwner != caretDestination
Canonical transfer overall=true
NORMAL-ENTER-FINAL overall=true
selectionInsideEditor=true
AWAITING-TRANSFER-LEAK awaitingCount=0
CANONICAL-SCOPE-MISMATCH=0
无异常 CARET-REPAIR
无异常 CARET-CONTINUITY-RESTORE
```

A3 不要求 POST-TEXT-INPUT-COMPLETE。

---

# 16. B1 Historical Fixtures

使用独立文件：

```text
r58-b1-historical-01.md
r58-b1-historical-02.md
```

不要把 fresh-01~10 直接当 historical fixture。

---

# 17. B1 Seed 自动化

Seed 阶段不计 PASS。

Runner 自动：

```text
创建 historical-01/02
→ 用真实输入创建 canonical override
→ 等到 stable persistence boundary
→ 触发保存
→ 验证 sidecar exists=true
→ recordCount>=1
```

标记：

```text
B1-SEED ONLY
```

然后关闭 Typora。

---

# 18. B1 ×2

重新启动 historical-01。

必须：

```text
SIDECAR-ACTUAL-LOAD exists=true recordCount>=1 source=physical
RECORD-LIFECYCLE event=PERSISTED_LOAD state=PERSISTED_HISTORICAL
```

generic historical resolver 只允许：

```text
PERSISTED_HISTORICAL
```

禁止：

```text
CURRENT_LIVE
CURRENT_AWAITING_TRANSFER
CURRENT_RETIRED
```

进入 historical heuristic。

每轮必须：

```text
historical resolver leakage=0
duplicate canonical append=0
AWAITING-TRANSFER-LEAK awaitingCount=0
CANONICAL-SCOPE-MISMATCH=0
```

B1 必须 2/2 PASS。

---

# 19. Deterministic Parser

不得依赖人工或 AI 模糊判断 PASS。

每轮 parser 输出结构化 JSON，至少包括：

```text
trial
fixture
scopeAuthority
cleanBaseline / historicalBaseline
trustedInput
imeProvenance
postTextInputArmCount
commit50
commit150
commit300
commit500
commit1000
commit2200
caretRestore
caretRepair
pluginSelectionWrite
probeComplete
canonicalFinal
awaitingCount
scopeMismatchCount
normalEnterFinal
verdict
failedChecks[]
firstFailureTimestamp
firstFailureLogLine
```

---

# 20. Fail-Fast

任何 trial 出现：

```text
scopeId != persistenceKey
scopeId != documentKey
CANONICAL-SCOPE-MISMATCH > 0
awaitingCount > 0 at stable boundary
NORMAL-ENTER-FINAL overall=false
CANONICAL-TRANSFER-FINAL-AUDIT overall=false
COMMIT+2200 logicalOffset != 1
caretRestore > 0
caretRepair > 0
unexpected pluginSelectionWrite > 0
```

立即 STOP MATRIX。

保留：

```text
当前 Typora
当前 fixture
当前 sidecar
当前 console
runtime-load
process metadata
trial parser output
```

创建：

```text
artifacts/r58-final/FAILURE-SNAPSHOT/
```

禁止删除证据、自动重试到 PASS 或继续下一 trial。

---

# 21. INVALID 与 FAIL

只有测试基础设施问题允许：

```text
TRIAL INVALID
```

例如：

```text
foreground window 丢失
input provenance mismatch
CDP collector lost connection
脚本重复输入
```

真实业务断言失败必须是：

```text
TRIAL FAIL
```

FAIL 不允许自动换 fresh-06~10 重跑。

---

# 22. SyntaxError 独立记录

继续统计：

```text
SyntaxError: Unexpected token ')'
startupSyntaxErrorObserved=true/false
```

但不得因此修改 Caret / Canonical / DocumentRuntimeContext / paragraph 业务源码，除非有直接因果证据。

---

# 23. Full Matrix 最终判定

必须：

```text
STRICT OS STARTUP = PASS

A1-01 = PASS
A1-02 = PASS
A1-03 = PASS
A1 = 3/3 PASS

A2-01 = PASS
A2 = 1/1 PASS

A3-01 = PASS
A3 = 1/1 PASS

B1-01 = PASS
B1-02 = PASS
B1 = 2/2 PASS

TOTAL = 7/7 PASS
```

只有全部成立：

```text
Document-Switch Scope Authority = PASS
Reduced Matrix = 7/7 PASS
R58.7 PRACTICAL CLOSURE = PASS
Extended Stress Matrix = WAIVED / NOT EXECUTED
R60 = MAY PROCEED UNDER REDUCED-MATRIX WAIVER
```

禁止写：

```text
A1×10 PASS
FULL MATRIX PASS
FULL EXHAUSTIVE CLOSURE PASS
```

---

# 24. final-summary.md

最终自动生成：

```text
=== BUILD ===
buildId:
mainSHA:
styleSHA:

=== STARTUP ===
oldPid:
oldPidExited:
processCountAfterClose:
newPid:
startTime:
mainWindowHandle:
mainWindowTitle:
targetVault:
targetDocument:
mainMatch:
cssMatch:
runtimeBuildId:
initializationCount:
strictStartup:

=== INPUT SMOKE ===
trustedInput:
imeProvenance:
verdict:

=== A1 ===
A1-01:
A1-02:
A1-03:
A1Result:

=== A2 ===
A2-01:
A2Result:

=== A3 ===
A3-01:
A3Result:

=== B1 ===
seed01:
seed02:
B1-01:
B1-02:
B1Result:

=== GLOBAL ASSERTIONS ===
scopeMismatchCount:
maxAwaitingCount:
caretRestoreCount:
caretRepairCount:
unexpectedSelectionWriteCount:
startupSyntaxErrorObserved:

=== FINAL ===
totalPass:
totalFail:
totalInvalid:
reducedMatrix:
practicalClosure:
extendedStressMatrix:
R60:
```

---

# 25. CLI

最终入口：

```powershell
.\scripts\r58-matrix\run-r58-final-matrix.ps1 -Mode DryRun
.\scripts\r58-matrix\run-r58-final-matrix.ps1 -Mode InputSmoke
.\scripts\r58-matrix\run-r58-final-matrix.ps1 -Mode Full
```

可选：

```text
-OutputDir artifacts\r58-final
-FailFast true
-ResetFixtures true
```

---

# 26. 最终交付

返回：

```text
1. Runner 文件清单
2. 架构说明
3. Win32 SendInput 实现
4. isTrusted=true 运行时证明
5. IME provenance 证明
6. console collector 实现
7. Fixture reset 结果
8. DryRun 结果
9. InputSmoke 结果
10. Strict Startup 原始证据
11. A1/A2/A3/B1 逐轮结果
12. FAILURE-SNAPSHOT（如有）
13. final-summary.md 路径
14. final-summary.json 路径
15. 是否达到 R58.7 Practical Closure
```

---

# 27. 执行顺序

严格：

```text
实现 Runner
↓
脚本语法检查
↓
DryRun
↓
InputSmoke
↓
Fixture Reset
↓
Strict Startup
↓
A1×3
↓
A2×1
↓
A3×1
↓
B1 Seed
↓
B1×2
↓
Generate Final Summary
↓
STOP
```

不要自动继续 R60。

---

# 28. Git

禁止：

```text
git add
git commit
git push
```
