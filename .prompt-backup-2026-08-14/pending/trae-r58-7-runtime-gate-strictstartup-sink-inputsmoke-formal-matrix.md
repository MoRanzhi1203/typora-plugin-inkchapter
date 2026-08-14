# Trae — R58.7 Runtime Gate：Strict Startup → Sink Smoke → InputSmoke → Formal Matrix

## 0. 当前冻结基线

当前 Build：

```text
inkchapter-r58-7-file-audit-ime-provenance-imep4k7
```

当前 Main SHA：

```text
939F8F3E014724C2F7EAEE6AB9C336A3BB2013DE7EE308F79C932390EE88BE2C
```

当前 Style SHA：

```text
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

当前已完成：

```text
JSONL-OFFSET-UTF8-SMOKE = PASS

IME JSONL Observability
= IMPLEMENTED / source + unit

IME-AUD-1~8
= 8/8 PASS

File-backed Audit Sink
= IMPLEMENTED / source + unit

Full Tests
= 708/708 PASS

tsc
= PASS

build / deploy
= PASS

mainMatch
= true

cssMatch
= true

Runner JSONL Integration
= IMPLEMENTED / SOURCE PASS

DryRun
= PASS
```

当前未完成：

```text
imep4k7 Runtime Activation
= NOT YET

Strict Startup #1
= NOT YET

Sink Runtime Smoke
= NOT YET

InputSmoke
= NOT YET

Strict Startup #2
= NOT YET

Full Reduced Matrix
= NOT YET

R58.7 PRACTICAL CLOSURE
= NOT YET

R60
= BLOCKED
```

---

# 1. 本轮目标

本轮不再继续开发新的业务功能。

只完成真实桌面 Runtime Gate：

```text
Strict Startup #1
↓
Sink Runtime Smoke
↓
InputSmoke
↓
PASS
↓
Fixture Reset
↓
Strict Startup #2
↓
Full Reduced Matrix
↓
Final Summary
↓
STOP
```

---

# 2. Build 立即冻结

当前：

```text
inkchapter-r58-7-file-audit-ime-provenance-imep4k7
```

从现在开始：

```text
src/**
= FREEZE
```

禁止继续修改：

```text
forensic-log-sink.ts
heading-numbering-service.ts
paragraph-indent-forensic.ts

CaretExpectation
SelectionTruth
NormalEnter
Canonical Transfer
Canonical Registry
DocumentRuntimeContext
Historical resolver
Rehydrate
Merge
Paragraph semantic / visual logic
IME 状态机
```

除非 Runtime Gate 给出直接失败证据。

禁止无证据生成新 Build。

---

# 3. 当前 runtimeBuildId=dsw2q7 的解释

DryRun 中如果仍看到：

```text
runtimeBuildId =
inkchapter-r58-7-persisted-docswitch-scope-authority-dsw2q7
```

不要判新 Build FAIL。

正确解释：

```text
imep4k7 Deploy
= PASS

imep4k7 Runtime Activation
= NOT YET

dsw2q7
= stale previous runtime evidence
```

只有真实启动新 Typora 后：

```text
runtimeBuildId=imep4k7
```

才表示新 Build 已进入 runtime。

---

# 4. 不要预先手动启动 Typora

如果 `StrictStartup` 模式的职责包括：

```text
关闭旧 Typora
↓
确认 processCount=0
↓
启动目标 fixture
↓
获取新 PID
↓
验证 HWND / title / Build / SHA
```

那么：

```text
禁止用户先手动打开 Typora
```

必须让 Runner 自己完成整个启动链。

如果当前 Runner 的 `StrictStartup` 反而要求 Typora 已提前打开：

```text
只修 scripts/r58-matrix/**
```

让 `StrictStartup` 自己负责启动。

不得通过人工预启动绕过 Strict Startup。

---

# 5. Strict Startup #1

目标文档：

```text
r58-automation-input-smoke.md
```

在真实 Windows PowerShell 中执行：

```powershell
cd D:\TyporaPluginProjects\typora-plugin-inkchapter

.\scripts\r58-matrix\run-r58-final-matrix.ps1 `
  -Mode StrictStartup `
  -OutputDir "artifacts\r58-final"
```

Runner 必须完成：

```text
记录旧 Typora PID
↓
关闭旧 Typora
↓
等待旧 PID 消失
↓
确认 processCountAfterClose=0
↓
正常启动 Typora + smoke fixture
↓
获取 new PID
↓
StartTime
↓
MainWindowHandle
↓
MainWindowTitle
↓
runtime identity
```

---

# 6. Strict Startup #1 Mandatory Evidence

必须全部存在：

```text
oldPid
oldProcessExited=true
processCountAfterClose=0

newPid
StartTime
MainWindowHandle != 0
MainWindowTitle != ""

targetVault
=
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault

targetDocument
=
r58-automation-input-smoke.md

runtimeMainPath

projectMainSHA
=
939F8F3E014724C2F7EAEE6AB9C336A3BB2013DE7EE308F79C932390EE88BE2C

runtimeMainSHA
=
939F8F3E014724C2F7EAEE6AB9C336A3BB2013DE7EE308F79C932390EE88BE2C

mainMatch=true

styleSHA
=
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0

cssMatch=true

Build ID
=
inkchapter-r58-7-file-audit-ime-provenance-imep4k7

runtime Build ID
=
inkchapter-r58-7-file-audit-ime-provenance-imep4k7

initializationCount=1
```

只有全部满足：

```text
STRICT STARTUP #1
= PASS / RUNTIME
```

---

# 7. Strict Startup 表述规则

如果根本没有执行启动命令：

```text
Strict Startup #1
= NOT EXECUTED
```

禁止写：

```text
启动命令已发出，但尚未确认成功
```

只有：

```text
启动命令确实已经执行
+
mandatory evidence 缺失
```

时，必须原样报告：

**启动命令已发出，但尚未确认成功**

并立即停止：

```text
SinkSmoke
InputSmoke
Full
```

---

# 8. Sink Runtime Smoke

Strict Startup #1 PASS 后执行：

```powershell
.\scripts\r58-matrix\run-r58-final-matrix.ps1 `
  -Mode SinkSmoke `
  -OutputDir "artifacts\r58-final"
```

这一步先不要输入任何内容。

目标是首次证明：

```text
imep4k7
↓
真实 Typora renderer
↓
forensic sink
↓
真实 JSONL 文件
```

---

# 9. Sink Runtime Smoke 必须验证

audit 目录：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\inkchapter\audit
```

必须：

```text
auditDirExists=true

currentSessionAuditFileExists=true

fileSize > 0

FORENSIC-SINK-READY
= found

RUNTIME-IDENTITY-FINAL
= found

DOCUMENT-CONTEXT-STATE
= found

DOCUMENT-CONTEXT-READY
= found

SIDECAR-ACTUAL-LOAD
= found

buildId
=
inkchapter-r58-7-file-audit-ime-provenance-imep4k7

JSONL parseFailureCount=0

FORENSIC-SINK-ERROR count=0

droppedCount=0

errorCount=0
```

---

# 10. Audit Session Authority

禁止简单选择：

```text
LastWriteTime 最新的 runtime-*.log
```

必须证明当前 audit file 属于本次新进程。

至少要求：

```text
file time >= new Typora StartTime

FORENSIC-SINK-READY sessionId matches

buildId=imep4k7

RUNTIME-IDENTITY-FINAL present

initializationCount=1

target document
=
r58-automation-input-smoke.md
```

如果存在多个 candidate 无法唯一确认：

```text
SINK SMOKE
= INVALID

reason=AUDIT_SESSION_AMBIGUOUS
```

不得猜测。

---

# 11. Smoke Fixture Clean Baseline

必须确认：

```text
SIDECAR-ACTUAL-LOAD

exists=false
recordCount=0
source=physical
```

同时：

```text
scopeId
==
persistenceKey
==
documentKey
==
r58-automation-input-smoke.md
```

只有全部成立：

```text
FILE-BACKED AUDIT SINK
= PASS / RUNTIME
```

否则：

```text
InputSmoke
= BLOCKED
```

---

# 12. InputSmoke

Sink Runtime Smoke PASS 后执行：

```powershell
.\scripts\r58-matrix\run-r58-final-matrix.ps1 `
  -Mode InputSmoke `
  -OutputDir "artifacts\r58-final"
```

Runner 必须：

```text
记录 audit byte offset
↓
SetForegroundWindow(Typora HWND)
↓
确认 GetForegroundWindow()==Typora HWND
↓
SendInput Period
↓
SendInput Period
↓
SendInput Enter
↓
SendInput Enter
↓
SendInput Period
↓
等待 >=2.5s
↓
读取当前 trial JSONL delta
```

禁止：

```text
Unicode direct injection
clipboard paste
DOM insertion
synthetic KeyboardEvent
Runtime.evaluate
CDP
```

---

# 13. Input Provenance Gate

JSONL delta 必须证明：

```text
KEYBOARD-EVENT-PROVENANCE

key=Process
code=Period
isTrusted=true
```

并证明完整 IME provenance：

```text
IME-SELECTION-AUDIT / IME-EVENT-ORDER

compositionstart
↓
beforeinput
inputType=insertCompositionText
↓
input
↓
compositionend
```

`compositionupdate`：

```text
若真实环境产生则必须记录
```

但不强制每次必有。

同时：

```text
TEXT-COMMIT-AUDIT

visibleText="。"
logicalOffset=1
```

---

# 14. InputSmoke INVALID 分类

如果：

```text
foreground HWND mismatch
```

则：

```text
INPUTSMOKE
= INVALID

reason=FOREGROUND_WINDOW_MISMATCH
```

如果：

```text
isTrusted != true
```

则：

```text
INPUTSMOKE
= INVALID

reason=INPUT_PROVENANCE_MISMATCH
```

如果：

```text
trusted Period=true
但缺完整中文 IME chain
```

则：

```text
INPUTSMOKE
= INVALID

reason=IME_NOT_ACTIVE
```

如果：

```text
JSONL collector/session authority/sink observability 出错
```

则判：

```text
INPUTSMOKE
= INVALID
```

这些都不是业务 FAIL。

---

# 15. InputSmoke Business Gate

必须：

```text
POST-TEXT-INPUT-ARM
exactly 1

CARET-EXPECTATION-SUPERSESSION-AUDIT
superseded=true
restoreAttempted=false

TEXT-COMMIT-AUDIT
visibleText="。"
logicalOffset=1

POST-TEXT-INPUT-STABILITY:
COMMIT+50    logicalOffset=1
COMMIT+150   logicalOffset=1
COMMIT+300   logicalOffset=1
COMMIT+500   logicalOffset=1
COMMIT+1000  logicalOffset=1
COMMIT+2200  logicalOffset=1

insideEditor=true

POST-TEXT-INPUT-COMPLETE
= exactly once

activeObservationAfterComplete=none
pendingCallbackCountAfterComplete=0

CANONICAL-VISUAL-VERIFY
overall=true

PROJECTION-VERIFY
overall=true

CANONICAL-TRANSFER-FINAL-AUDIT
overall=true

NORMAL-ENTER-FINAL
overall=true

AWAITING-TRANSFER-LEAK-AUDIT
awaitingCount=0

CANONICAL-SCOPE-MISMATCH
count=0

CARET-CONTINUITY-RESTORE after input=0

CARET-REPAIR after input=0

unexpected PLUGIN-SELECTION-WRITE=0

FORENSIC-SINK-ERROR count=0

droppedCount=0
```

只有全部满足：

```text
INPUTSMOKE
= PASS / RUNTIME
```

---

# 16. InputSmoke PASS 后正式冻结自动化基础设施

InputSmoke PASS 后：

```text
File-backed Audit Sink
= PASS / RUNTIME

IME JSONL Observability
= PASS / RUNTIME

Trusted Input Automation
= PASS / RUNTIME
```

此后不再改：

```text
src/**
scripts/r58-matrix/**
```

除非 Full Matrix 出现真实 FAIL / INVALID。

---

# 17. Fixture Reset

只有 InputSmoke PASS 后才执行：

```text
TEST FIXTURE RESET
```

重置：

```text
r58-caret-a1-fresh-01.md
...
r58-caret-a1-fresh-10.md
```

及对应 sidecar。

要求：

```text
fresh-01 fixtureExists=true sidecarExists=false
...
fresh-10 fixtureExists=true sidecarExists=false
```

旧：

```text
app-*.log
runtime-load
audit logs
plugins
dist
其他 fixture
```

不得删除。

---

# 18. 不允许沿用 Smoke Session 跑 Full

InputSmoke session：

```text
只用于自动化基础设施验收
```

Formal Matrix 必须使用新的干净 session。

所以：

```text
InputSmoke PASS
↓
Fixture Reset
↓
关闭 Smoke Typora
↓
processCount=0
↓
Strict Startup #2
↓
fresh-01
↓
Formal Matrix
```

禁止：

```text
InputSmoke PASS
→ 同一个 Typora session 直接切 fresh-01
→ Full
```

---

# 19. Strict Startup #2

目标：

```text
r58-caret-a1-fresh-01.md
```

必须再次执行完整 Strict Startup。

要求与 #1 相同：

```text
oldPid exited
processCountAfterClose=0

newPid
StartTime
MainWindowHandle !=0
MainWindowTitle

targetVault
targetDocument=fresh-01

runtime Build ID=imep4k7
SHA match
style match
initializationCount=1
```

只有：

```text
STRICT STARTUP #2
= PASS
```

才进入 Formal Matrix。

---

# 20. Full Reduced Matrix 分配

```text
A1-01
→ r58-caret-a1-fresh-01.md

A1-02
→ r58-caret-a1-fresh-02.md

A1-03
→ r58-caret-a1-fresh-03.md

A2-01
→ r58-caret-a1-fresh-04.md

A3-01
→ r58-caret-a1-fresh-05.md

B1-01
→ r58-b1-historical-01.md

B1-02
→ r58-b1-historical-02.md
```

fresh-06~10：

```text
只允许作为 TRIAL INVALID 的替补
```

不得隐藏真实 FAIL。

---

# 21. A1 ×3

每轮：

```text
。。
Enter
Enter
立即输入 。
wait >=2.5s
```

必须：

```text
clean sidecar
trusted input=true
IME provenance=true

scope authority=true

POST-TEXT-INPUT-COMPLETE=true

COMMIT+50~2200
logicalOffset=1

canonical final=true
NORMAL-ENTER-FINAL=true

awaitingCount=0
scopeMismatchCount=0

caretRestore=0
caretRepair=0
unexpectedSelectionWrite=0

sinkErrorCount=0
droppedCount=0
```

A1：

```text
3/3 PASS
```

---

# 22. A1/A2/A3 必须同 Matrix Session Document Switch

Strict Startup #2 后：

```text
fresh-01
→ fresh-02
→ fresh-03
→ fresh-04
→ fresh-05
```

期间禁止 restart 来规避 document switch。

每次必须：

```text
DOCUMENT-CONTEXT-TRANSITION

scopeIdBefore=old
scopeIdAfter=new
scopeIdSame=false

persistenceKeyBefore=old
persistenceKeyAfter=new

preserveScope=false
reason=DOCUMENT_SWITCH
decision=SWITCH_DOCUMENT
```

稳定后：

```text
scopeId
==
persistenceKey
==
documentKey
==
current fixture

old scope current owners=0
awaitingCount=0
CANONICAL-SCOPE-MISMATCH=0
```

---

# 23. A2 ×1

fresh-04：

```text
普通段落
Enter
立即输入 。
wait >=2.5s
```

要求：

```text
sourceCanonicalRecordId=none

NORMAL-ENTER-FINAL overall=true

selectionInsideEditor=true

caretRestore=0
caretRepair=0
unexpectedSelectionWrite=0

awaitingCount=0
scopeMismatchCount=0

sinkErrorCount=0
droppedCount=0
```

---

# 24. A3 ×1

fresh-05：

```text
。。
Enter
Enter
然后不再输入
wait >=2.5s
```

要求：

```text
completedOriginalRuntimeId correct

caretDestinationRuntimeId correct

canonicalOwner != caretDestination

canonical transfer overall=true

NORMAL-ENTER-FINAL overall=true

selectionInsideEditor=true

awaitingCount=0
scopeMismatchCount=0

无异常 caretRestore
无异常 caretRepair

sinkErrorCount=0
droppedCount=0
```

A3 不要求：

```text
POST-TEXT-INPUT-COMPLETE
```

---

# 25. B1 Seed + B1 ×2

使用独立：

```text
r58-b1-historical-01.md
r58-b1-historical-02.md
```

Seed：

```text
生成合法 canonical override
↓
stable persistence boundary
↓
sidecar exists=true
↓
recordCount>=1
```

Seed 不算 PASS。

正式 B1 必须 physical load：

```text
SIDECAR-ACTUAL-LOAD

exists=true
recordCount>=1
source=physical
```

并：

```text
RECORD-LIFECYCLE
event=PERSISTED_LOAD

state=PERSISTED_HISTORICAL
```

仅：

```text
PERSISTED_HISTORICAL
```

允许 generic historical resolver。

每轮：

```text
historicalResolverLeakage=0
duplicateAppend=0
awaitingCount=0
scopeMismatchCount=0
sinkErrorCount=0
droppedCount=0
```

B1：

```text
2/2 PASS
```

---

# 26. FAIL / INVALID

真实业务断言失败：

```text
TRIAL FAIL
```

基础设施失败：

```text
TRIAL INVALID
```

INVALID 包括：

```text
foreground mismatch
IME_NOT_ACTIVE
input provenance mismatch
audit session ambiguous
JSONL collector failure
sink observability failure
script duplicated input
```

真实 FAIL：

```text
不得自动换 fixture 重跑直到 PASS
```

---

# 27. Fail-Fast

任何 FAIL：

```text
STOP MATRIX
```

保存：

```text
current audit JSONL
trial delta JSONL
trial verdict JSON
runtime-load
process metadata
fixture
sidecar
summary-so-far
```

生成：

```text
artifacts/r58-final/FAILURE-SNAPSHOT/
```

禁止：

```text
删现场
truncate audit
重置失败 sidecar
继续下一 trial
retry-until-pass
```

---

# 28. Full Mode 必须自身包含 Formal Session 建立

正式运行：

```powershell
.\scripts\r58-matrix\run-r58-final-matrix.ps1 `
  -Mode Full `
  -OutputDir "artifacts\r58-final"
```

Full 模式必须自己包含：

```text
确认 InputSmoke 已 PASS
↓
Fixture Reset
↓
关闭 Smoke Session
↓
processCount=0
↓
Strict Startup #2
↓
target fresh-01
↓
A1-01
↓
A1-02
↓
A1-03
↓
A2
↓
A3
↓
B1 Seed
↓
B1-01
↓
B1-02
↓
Final Summary
```

如果 Full 当前缺：

```text
Strict Startup #2
```

只修：

```text
scripts/r58-matrix/**
```

不得修改 src。

---

# 29. 最终 PASS 条件

必须：

```text
JSONL-OFFSET-UTF8-SMOKE = PASS

Strict Startup #1 = PASS
Sink Runtime Smoke = PASS
InputSmoke = PASS

Strict Startup #2 = PASS

A1 = 3/3 PASS
A2 = 1/1 PASS
A3 = 1/1 PASS
B1 = 2/2 PASS

TOTAL = 7/7 PASS
```

只有全部成立：

```text
File-backed Audit Sink
= PASS / RUNTIME

IME JSONL Observability
= PASS / RUNTIME

Trusted Input Automation
= PASS / RUNTIME

Document-Switch Scope Authority
= PASS

Reduced Matrix
= 7/7 PASS

R58.7 PRACTICAL CLOSURE
= PASS

Extended Stress Matrix
= WAIVED / NOT EXECUTED

R60
= MAY PROCEED UNDER REDUCED-MATRIX WAIVER
```

---

# 30. 禁止过度宣称

禁止写：

```text
A1×10 PASS
Full Exhaustive Matrix PASS
R58.7 Full Exhaustive Closure PASS
```

只能写：

```text
Reduced Matrix = 7/7 PASS
Extended Stress Matrix = WAIVED / NOT EXECUTED
```

---

# 31. 当前立即执行

现在不要继续修改 src。

直接在真实 Windows 桌面环境：

```text
1. Strict Startup #1
2. Sink Runtime Smoke
3. InputSmoke
4. PASS 后 Fixture Reset
5. Strict Startup #2
6. Full Reduced Matrix
7. Final Summary
8. STOP
```

不要自动进入 R60。

---

# 32. Git

禁止：

```text
git add
git commit
git push
```
