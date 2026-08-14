# Trae — R58.7 File-backed Audit → JSONL Runner → Runtime Smoke → Full Reduced Matrix Gate

## 0. 当前基线

当前新 Build：

```text
inkchapter-r58-7-file-backed-audit-sink-fbas8k3q
```

当前已完成：

```text
File-backed Audit Sink — Source = PASS
File-backed Audit Sink — Unit = PASS
AUD-1~AUD-10 = 10/10 PASS
Full Tests = 700/700 PASS
tsc = PASS
build:dev = PASS
deploy = PASS

project main SHA
=
runtime main SHA
=
C5A34D07CF4D1EA0E7E12FCC1F93D962D87390A0146F38939B133619A737E413

mainMatch=true

project/runtime style SHA
=
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0

cssMatch=true
```

当前仍未完成：

```text
Sink Runtime Load = NOT YET VERIFIED
Actual JSONL File Creation = NOT YET VERIFIED
Runtime Event Completeness = NOT YET VERIFIED
Runner JSONL Integration = NOT IMPLEMENTED
InputSmoke = NOT YET
Full Reduced Matrix = NOT YET
R58.7 PRACTICAL CLOSURE = NOT YET
R60 = BLOCKED
```

---

# 1. 本轮目标

本轮只完成：

```text
A. Runner 从 CDP 切换到 JSONL file-backed collector
B. 新 Build fbas8k3q 的 Strict Startup
C. File-backed Audit Sink Runtime Smoke
D. Trusted InputSmoke
E. 仅在 A-D 全 PASS 后运行 Full Reduced Matrix
```

执行顺序：

```text
JSONL Runner Integration
↓
DryRun
↓
Strict Startup
↓
Sink Runtime Smoke
↓
InputSmoke
↓
if PASS
↓
Fixture Reset
↓
Full Reduced Matrix
↓
Final Summary
↓
STOP
```

---

# 2. 冻结范围

禁止修改插件业务算法：

```text
CaretExpectation
SelectionTruth
NormalEnter
Canonical Transfer
Canonical visual verifier
Canonical Registry lifecycle
DocumentRuntimeContext
Save-As classifier
Historical resolver
Rehydrate
Merge
Paragraph semantic / visual logic
```

暂时冻结：

```text
src/runtime/forensic-log-sink.ts
```

除非 Runtime Smoke 直接证明 sink 有真实缺陷。

本轮优先只允许修改：

```text
scripts/r58-matrix/**
```

禁止：

```text
重新启用 CDP
--remote-debugging-port
--inspect
--inspect-brk
Runtime.evaluate
synthetic DOM event
testMode
git add
git commit
git push
```

---

# 3. CDP 正式废弃

已有证据：

```text
normal launch:
DevToolsActivePort = NOT RECREATED
NORMAL_LAUNCH_CDP = UNAVAILABLE

debug launch:
Typora rejects debugging
Error: Not allow debugging this program
```

Runner 正式架构：

```text
Normal Typora Launch
↓
File-backed JSONL Audit
↓
Byte Offset / Session File Collector
↓
Win32 SendInput
↓
JSONL Delta
↓
Deterministic Parser
```

正式执行链移除：

```text
r58-cdp-collector.js
DevToolsActivePort
port 9222
/json/version
/json/list
CDP target selection
```

旧文件可保留，但不得再被正式 Runner 调用。

---

# 4. 新增 JSONL Collector

建议新增：

```text
scripts/r58-matrix/forensic-file-collector.ps1
```

或：

```text
scripts/r58-matrix/forensic-file-collector.js
```

必须提供等价能力：

```text
ResolveCurrentAuditFile()
GetAuditOffset()
ReadAuditDelta()
WaitForAuditEvent()
ValidateJsonLines()
GetAuditSessionIdentity()
```

禁止仅通过“最新修改时间”盲选 `runtime-*.log`。

---

# 5. Audit Session Authority

audit 目录：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\inkchapter\audit
```

current session audit file 必须同时满足：

```text
file time >= new Typora StartTime
FORENSIC-SINK-READY exists
buildId=inkchapter-r58-7-file-backed-audit-sink-fbas8k3q
RUNTIME-IDENTITY-FINAL exists
initializationCount=1
target vault matches
target document matches
```

输出：

```text
AUDIT-SESSION-AUTHORITY:
auditPath=
auditSessionId=
buildId=
targetDoc=
newTyporaStartTime=
readyFound=
identityFound=
initializationCount=
decision=ACCEPT / REJECT
```

多个 candidate 无法唯一确认：

```text
TRIAL INVALID
reason=AUDIT_SESSION_AMBIGUOUS
```

禁止猜测。

---

# 6. JSONL Schema Probe

InputSmoke 前先检查 JSONL：

```text
every non-empty line JSON.parse succeeds
```

至少支持：

```text
ts / timestamp
sessionId
buildId
event
payload
```

可选提升字段：

```text
scopeId
persistenceKey
documentKey
editorInstanceId
intentEpoch
normalEnterTxnId
observationId
```

输出：

```text
JSONL-SCHEMA-AUDIT:
lineCount=
parseSuccessCount=
parseFailureCount=
uniqueEvents=
buildIds=
sessionIds=
overall=
```

要求：

```text
parseFailureCount=0
overall=true
```

---

# 7. trial-parser.js 改为 JSONL Event Parser

禁止继续把旧 console 正则作为唯一判定入口。

例如：

```text
COMMIT+2200
```

必须按：

```text
event == POST-TEXT-INPUT-STABILITY
payload.sample == COMMIT+2200
```

解析。

`PERSISTED_HISTORICAL` 应按：

```text
event == RECORD-LIFECYCLE
state / payload.state == PERSISTED_HISTORICAL
```

解析。

每个正式 event 都建立结构化 selector。

---

# 8. File Offset Evidence Window

每个 trial：

```text
resolve current audit file
↓
flush / stabilize
↓
record byteOffsetBefore
↓
TRIAL START
↓
SendInput / file-open
↓
wait target stable event
↓
wait sink flush / file length stable
↓
record byteOffsetAfter
↓
read [before, after)
↓
parse delta JSONL
↓
TRIAL END
```

记录：

```text
auditPath
byteOffsetBefore
byteOffsetAfter
deltaBytes
deltaLineCount
```

禁止 truncate 当前 session log。

---

# 9. Sink Flush / Stability

不得只固定 Sleep 后假设落盘。

优先等待：

```text
FORENSIC-SINK-FLUSH
```

并确认：

```text
droppedCount=0
errorCount=0
```

若某阶段无明确 flush event，则：

```text
目标 stable event 已出现
+
file length 连续 2~3 次稳定
```

---

# 10. Strict Startup

启动：

```text
r58-automation-input-smoke.md
```

必须直接保存 OS 原始证据：

```text
oldPid
oldProcessExited=true
processCountAfterClose=0
newPid
StartTime
MainWindowHandle != 0
MainWindowTitle != ""
targetVault
targetDocument
runtime plugin main path
project main SHA
runtime main SHA
mainMatch=true
project style SHA
runtime style SHA
cssMatch=true
Build ID
runtime Build ID
initializationCount=1
```

Build 必须：

```text
inkchapter-r58-7-file-backed-audit-sink-fbas8k3q
```

缺任何 mandatory 字段必须原样报告：

启动命令已发出，但尚未确认成功

并停止 Sink Smoke / InputSmoke。

---

# 11. Sink Runtime Smoke

Strict Startup PASS 后暂不输入。

验证：

```text
audit directory exists=true
current session audit file exists=true
fileSize > 0
FORENSIC-SINK-READY found=true
buildId=fbas8k3q
JSONL parseFailureCount=0
FORENSIC-SINK-ERROR count=0
latest droppedCount=0
latest errorCount=0
```

启动基线必须落盘：

```text
RUNTIME-IDENTITY-FINAL
DOCUMENT-CONTEXT-STATE
DOCUMENT-CONTEXT-READY
SIDECAR-ACTUAL-LOAD
```

对 disposable smoke fixture：

```text
SIDECAR-ACTUAL-LOAD
exists=false
recordCount=0
source=physical

scopeId == persistenceKey == r58-automation-input-smoke.md
```

---

# 12. Sink Runtime Smoke PASS

只有：

```text
auditFileExists=true
FORENSIC-SINK-READY=true
JSONL valid=true
buildId correct=true
session authority=true
baseline events present=true
sinkErrorCount=0
droppedCount=0
```

才允许：

```text
FILE-BACKED AUDIT SINK = PASS / RUNTIME
```

否则：

```text
InputSmoke = BLOCKED
Full = BLOCKED
```

---

# 13. InputSmoke

Sink Runtime Smoke PASS 后：

```text
record audit byte offset
↓
SetForegroundWindow(Typora HWND)
↓
GetForegroundWindow()==Typora HWND
↓
SendInput Period
SendInput Period
SendInput Enter
SendInput Enter
SendInput Period
↓
wait >= 2.5s
```

禁止 Unicode 直接注入、clipboard、DOM insertion、synthetic event。

---

# 14. Input Provenance Gate

从 JSONL delta 证明：

```text
KEYBOARD-EVENT-PROVENANCE
key=Process
code=Period
isTrusted=true
```

并证明真实 IME provenance。

至少要求：

```text
composition session exists
insertCompositionText / composition event sequence exists
TEXT-COMMIT-AUDIT
visibleText="。"
logicalOffset=1
```

trusted Period 有、但无中文 IME：

```text
INPUTSMOKE = INVALID
reason=IME_NOT_ACTIVE
```

`isTrusted != true`：

```text
INPUTSMOKE = INVALID
reason=INPUT_PROVENANCE_MISMATCH
```

不得判业务 FAIL。

---

# 15. InputSmoke Business Gate

同时必须：

```text
POST-TEXT-INPUT-ARM exactly 1

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
activeObservationAfterComplete=none
pendingCallbackCountAfterComplete=0

CANONICAL-VISUAL-VERIFY overall=true
PROJECTION-VERIFY overall=true
CANONICAL-TRANSFER-FINAL-AUDIT overall=true
NORMAL-ENTER-FINAL overall=true

AWAITING-TRANSFER-LEAK-AUDIT awaitingCount=0
CANONICAL-SCOPE-MISMATCH count=0

CARET-CONTINUITY-RESTORE after input=0
CARET-REPAIR after input=0
unexpected PLUGIN-SELECTION-WRITE=0

FORENSIC-SINK-ERROR count=0
droppedCount=0
```

---

# 16. InputSmoke PASS 后才 Reset Fixtures

InputSmoke PASS 前禁止 reset fresh-01~10 和 Full。

PASS 后执行：

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
fixtureExists=true
sidecarExists=false
```

旧 app-*.log 不删除。

---

# 17. Full Reduced Matrix

分配：

```text
A1-01 → fresh-01
A1-02 → fresh-02
A1-03 → fresh-03
A2-01 → fresh-04
A3-01 → fresh-05
B1-01 → r58-b1-historical-01.md
B1-02 → r58-b1-historical-02.md
```

fresh-06~10 仅作 INVALID 替补。

---

# 18. A1 ×3

每轮：

```text
。。
Enter
Enter
立即输入 。
wait >=2.5s
```

要求：

```text
clean physical sidecar
scope authority correct
trusted Period / IME provenance correct
POST-TEXT-INPUT-COMPLETE
COMMIT+50~2200 logicalOffset=1
canonical final=true
normalEnter final=true
awaitingCount=0
scopeMismatchCount=0
caretRestore=0
caretRepair=0
unexpectedSelectionWrite=0
sinkErrorCount=0
droppedCount=0
```

A1 必须 3/3 PASS。

---

# 19. 同 Session Document Switch

A1-01 后不要 restart 规避。

```text
fresh-01 → fresh-02 → fresh-03 → fresh-04 → fresh-05
```

每次：

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
scopeId == persistenceKey == documentKey == current fixture
old scope current owners=0
awaitingCount=0
CANONICAL-SCOPE-MISMATCH=0
```

---

# 20. A2 ×1

fresh-04：

```text
普通段落输入
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

# 21. A3 ×1

fresh-05：

```text
。。
Enter
Enter
然后不再输入
wait >=2.5s
```

验证：

```text
completedOriginalRuntimeId correct
caretDestinationRuntimeId correct
canonicalOwner != caretDestination
canonical transfer overall=true
NORMAL-ENTER-FINAL overall=true
selectionInsideEditor=true
awaitingCount=0
scopeMismatchCount=0
无异常 caretRestore / caretRepair
sinkErrorCount=0
droppedCount=0
```

A3 不要求 POST-TEXT-INPUT-COMPLETE。

---

# 22. B1 Seed

使用：

```text
r58-b1-historical-01.md
r58-b1-historical-02.md
```

Seed 只生成合法 physical sidecar，不算 PASS。

要求：

```text
sidecar exists=true
recordCount>=1
stable persistence boundary reached
```

---

# 23. B1 ×2

必须：

```text
SIDECAR-ACTUAL-LOAD
exists=true
recordCount>=1
source=physical

RECORD-LIFECYCLE
event=PERSISTED_LOAD
state=PERSISTED_HISTORICAL
```

generic historical resolver 只允许 PERSISTED_HISTORICAL。

每轮：

```text
historicalResolverLeakage=0
duplicateAppend=0
awaitingCount=0
scopeMismatchCount=0
sinkErrorCount=0
droppedCount=0
```

B1 必须 2/2 PASS。

---

# 24. FAIL / INVALID

业务断言失败：

```text
TRIAL FAIL
```

测试基础设施失败：

```text
TRIAL INVALID
```

INVALID 示例：

```text
foreground HWND mismatch
IME_NOT_ACTIVE
input provenance mismatch
audit session ambiguous
JSONL collector failure
sink observability failure
script duplicated input
```

FAIL 不允许自动换 fixture 重跑至 PASS。

---

# 25. Fail-Fast

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

禁止删现场、truncate audit、自动继续或重跑到 PASS。

---

# 26. Runner 输出

必须生成：

```text
artifacts/r58-final/
dry-run.json
strict-startup.json
sink-runtime-smoke.json
sink-runtime-smoke.md
input-smoke.delta.jsonl
input-smoke.json
input-smoke.md
A1-01.delta.jsonl
A1-01.json
...
B1-02.delta.jsonl
B1-02.json
final-summary.json
final-summary.md
```

---

# 27. 最终判定

只有：

```text
Strict Startup = PASS
Sink Runtime Smoke = PASS
InputSmoke = PASS
A1 = 3/3 PASS
A2 = 1/1 PASS
A3 = 1/1 PASS
B1 = 2/2 PASS
TOTAL = 7/7 PASS
```

才允许：

```text
File-backed Audit Sink = PASS / RUNTIME
Trusted Input Automation = PASS / RUNTIME
Document-Switch Scope Authority = PASS
Reduced Matrix = 7/7 PASS
R58.7 PRACTICAL CLOSURE = PASS
Extended Stress Matrix = WAIVED / NOT EXECUTED
R60 = MAY PROCEED UNDER REDUCED-MATRIX WAIVER
```

禁止宣称：

```text
A1×10 PASS
FULL EXHAUSTIVE MATRIX PASS
R58.7 FULL EXHAUSTIVE CLOSURE PASS
```

---

# 28. 若只完成 Smoke

若：

```text
Strict Startup PASS
Sink Runtime Smoke PASS
InputSmoke PASS
```

但 Full 未执行，只能报告：

```text
File-backed Audit Sink = PASS / RUNTIME
Trusted Input Automation = PASS / RUNTIME
Full Reduced Matrix = MAY START
R58.7 PRACTICAL CLOSURE = NOT YET
R60 = BLOCKED
```

---

# 29. 立即执行

现在：

```text
1. 完成 Runner JSONL 集成
2. 脚本语法检查
3. DryRun
4. Strict Startup
5. Sink Runtime Smoke
6. PASS 后 InputSmoke
7. InputSmoke PASS 后 Full
8. 生成 final-summary
9. STOP
```

如果真实桌面能力受环境限制：

```text
不要伪造 runtime PASS
明确报告阻塞步骤与缺失证据
```

不要自动进入 R60。

---

# 30. Git

禁止：

```text
git add
git commit
git push
```
