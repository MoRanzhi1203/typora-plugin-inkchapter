# Trae P0 — R58.7 Clean R0 Closure + A1 Matrix Gate

## 0. 任务定位

本轮目标不是继续修 Caret / Canonical 业务逻辑，而是完成：

```text
Probe Lifecycle Closure
→ Final Artifact Provenance
→ Strict Startup
→ Clean R0
→ R0 PASS 后再进入 A1 Matrix
```

当前已知 runtime 结论：

```text
R58.7 STALE CARET EXPECTATION = FIXED
POST-TEXT_INPUT behavioral stability = PASS in observed runtime
TEXT_COMMIT anchor = PASS for current runtime
Plugin selection writer causality = NOT SUPPORTED
Rehydrate causality = NOT SUPPORTED
Native / IME / Typora transient = STRONGLY SUPPORTED
Canonical Transfer = PASS / FREEZE
```

但当前仍有 3 个验收缺口：

```text
1. fresh-01 实际 sidecarExists=true / recordCount=4，不能算 clean R0
2. PostTextInputObservation 在 COMMIT+2200 后仍继续接收后续 T_INPUT_EVENT
3. strict startup 缺 OS 级 oldProcessExited / PID / StartTime / HWND / Title 原始证据
```

因此：

```text
R58.7 CARET OWNERSHIP FULL CLOSURE = NOT YET ACCEPTED
R60 BLOCKED
```

---

# 1. 冻结范围

以下业务逻辑全部冻结：

```text
CaretExpectation supersession
TEXT_INPUT UserIntentEpoch
Composition dedupe
Caret writer
CARET-REPAIR
restoreLogicalCaret

Enter Admission
Process / Period → REJECT_NON_ENTER
NormalEnter transaction admission
Caret Handover
SelectionTruth
StructuralResolution

Canonical Transfer
Canonical source snapshot
Canonical visual verifier
Canonical semantic projection
Canonical identity transfer
Awaiting cleanup

Rehydrate business semantics
Historical resolver
Save-As
Merge
```

本轮严禁：

```text
继续改 caret 修复策略
增加 setSelection/setTimeout 猜测补丁
修改 restoreLogicalCaret
修改 CARET-REPAIR
修改 Canonical Transfer
修改 NormalEnter ownership
禁用 rehydrate 来掩盖问题
previous-paragraph fallback
generic historical heuristic
```

本轮唯一允许的 source 改动：

```text
PostTextInputObservation forensic lifecycle
forensic-only diagnostics/tests
```

---

# 2. Probe Lifecycle Closure

## 2.1 COMMIT+2200 必须正式完成 Observation

当前问题：

```text
COMMIT+2200 已完成
↓
旧 ptsi observation 仍存活
↓
后续完全不同 input 仍写入旧 observation 的 T_INPUT_EVENT
```

必须修正为：

```text
COMMIT+2200
→ POST-TEXT-INPUT-COMPLETE
→ cancel remaining callbacks/timers
→ activeObservation = null
```

新增日志：

```text
POST-TEXT-INPUT-COMPLETE:
observationId=
generation=
scopeId=
editorInstanceId=
compositionSessionId=
finalSample=COMMIT+2200
finalRuntimeId=
finalVisibleText=
finalLogicalOffset=
activeObservationAfterComplete=none
pendingCallbackCountAfterComplete=0
decision=COMPLETE
```

硬 invariant：

```text
COMMIT+2200 completed
→ observation terminal
→ no later event may mutate/log into this observation
```

---

# 3. Foreign Input Event Isolation

每一个：

```text
T_INPUT_EVENT
```

必须额外校验：

```text
eventCompositionSessionId
===
observation.compositionSessionId
```

如果不同：

```text
POST-TEXT-INPUT-FOREIGN-EVENT-BLOCK:
observationId=
observationCompositionSessionId=
eventCompositionSessionId=
eventIntentEpoch=
observationIntentEpoch=
runtimeId=
decision=IGNORE
```

禁止把不同 composition session 的 input 写入旧 observation。

同时保留现有：

```text
observationId
generation
scopeId
editorInstanceId
```

callback gate。

最终硬条件：

```text
foreignInputAcceptedByObservation=0
staleCallbackExecutedCount=0
activeObservationPeak=1
```

---

# 4. Same Composition Session 保持现有正确语义

继续保持：

```text
same compositionSessionId
→ same user takeover
→ non-dedup insertCompositionText 也不得误 cancel
```

必须继续：

```text
POST-TEXT-INPUT-PROBE-INVARIANT:
sameCompositionSessionNonDedupInputCancels=false
maxActiveObservation=1
overall=true
```

禁止为了修 foreign event 而破坏 same-session continuity。

---

# 5. Forensic-only 单元测试

至少新增/确认以下测试。

## PL-1 — Complete at +2200

```text
ARM O1
→ COMMIT
→ COMMIT+2200
→ COMPLETE
→ activeObservation=null
```

要求：

```text
completeCount=1
activeObservationAfterComplete=null
pendingCallbackCount=0
```

## PL-2 — Foreign composition ignored

```text
O1 compositionSession=C1
event input compositionSession=C2
```

要求：

```text
T_INPUT_EVENT not appended to O1
FOREIGN-EVENT-BLOCK emitted
foreignInputAcceptedByObservation=0
```

## PL-3 — Same composition kept

```text
O1 session=C1
second non-dedup insertCompositionText session=C1
```

要求：

```text
O1 remains active
no NEW_REAL_INTENT cancel
```

## PL-4 — Stale timer

```text
O1 completed
old callback fires
```

要求：

```text
decision=DROP_STALE
staleCallbackExecutedCount=0
```

## PL-5 — Scope/editor switch

```text
O1 active
→ scope change/editor unbind/unload
```

要求：

```text
cancel
activeObservation=null
```

禁止在这些测试中修改任何真实 Caret/Selection 行为。

---

# 6. New Build ID

只要修改 forensic source，就必须新 Build ID。

禁止复用：

```text
m8k2x
j7d3q
k9t4w
```

建议：

```text
inkchapter-r58-7-clean-r0-closure-<unique>
```

必须在全部 source 修改完成后再写最终 Build ID。

---

# 7. Final Pipeline

顺序必须严格：

```text
完成所有 forensic source 修改
↓
写最终 Build ID
↓
pnpm exec tsc --noEmit
↓
最终 targeted tests
↓
pnpm exec vitest run
↓
pnpm run build:dev
↓
deploy
↓
four-path direct SHA
```

禁止：

```text
测试后继续修改 TS 却沿用旧测试结果
pnpm run build 替代 build:dev
```

---

# 8. Artifact Provenance

唯一正确 runtime plugin：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js
```

禁止：

```text
test\vault.typora
```

必须直接输出：

```text
PROJECT MAIN:
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\main.js

RUNTIME MAIN:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js

PROJECT STYLE:
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\style.css

RUNTIME STYLE:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\style.css
```

必须：

```text
mainMatch=true
cssMatch=true
```

style source 无业务修改时继续确认：

```text
src/style.scss git diff = empty
```

style SHA 预期仍应与标准 `build:dev` 产物一致。

---

# 9. Clean Fixture Strategy

`r58-caret-a1-fresh-01.md` 已被污染：

```text
sidecarExists=true
recordCount=4
```

它不得再作为 clean R0/A1 fixture。

禁止删除它的 sidecar 后伪装为 fresh。

优先检查：

```text
r58-caret-a1-fresh-02.md
```

测试前必须输出：

```text
fixturePath=
sidecarAbsolutePath=
fixtureExists=true
sidecarExists=false
recordCount=0
```

如果 fresh-02 也被污染：

```text
STOP using it
→ try fresh-03
```

如果现有 fresh fixture 均被用过，则创建新唯一文件：

```text
r58-caret-clean-r0-<timestamp>.md
```

新的 sidecar 必须从未存在。

---

# 10. Strict Startup Gate

完成 artifact 后，优先由用户在 sandbox 外手动启动 Typora 并打开 exact clean fixture。

Trae随后只读验证。

必须证明同一次启动：

```text
oldProcessExited=true

new PID
StartTime
MainWindowHandle != 0
MainWindowTitle != ""

targetVault=
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault

targetDocument=<exact clean fixture>

runtimePluginMainPath=
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js

projectMainSHA=
runtimeMainSHA=
shaMatch=true

styleSHA=

Build ID=
runtimeBuildID=
initializationCount=1
```

任何以前：

```text
Title=Error
旧 PID
旧 StartTime
旧 build runtime-load
```

不得复用。

若任一强制字段缺失，必须原样写：

**启动命令已发出，但尚未确认成功**

---

# 11. Runtime Clean Baseline Gate

打开 clean fixture 后，在用户执行任何测试操作前必须证明：

```text
activeFilePath=<exact clean fixture>
persistenceKey=<exact clean fixture>

sidecarExists=false
recordCount=0

registryRecordCount=0
PERSISTED_HISTORICAL count=0
```

如果日志出现：

```text
SIDECAR-ACTUAL-LOAD exists=true recordCount>0
```

或者：

```text
PERSISTED_LOAD
```

则：

```text
CLEAN BASELINE FAIL
```

STOP。

不要继续 R0。

---

# 12. Clean R0 — 只执行一次

Strict Startup PASS + Clean Baseline PASS 后：

只执行一次：

```text
。。
Enter
Enter
立即输入 。
等待至少 2.5 秒
```

然后停止所有输入。

不要立刻进入 A1×10。

---

# 13. Clean R0 Mandatory Evidence

必须只存在一个目标 observation：

```text
POST-TEXT-INPUT-ARM count=1
activeObservationPeak=1
```

并且完整输出：

```text
TEXT_INPUT supersede=true

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

完成后：

```text
activeObservationAfterComplete=none
pendingCallbackCountAfterComplete=0
foreignInputAcceptedByObservation=0
staleCallbackExecutedCount=0
```

---

# 14. Clean R0 Behavioral PASS 条件

要求：

```text
COMMIT+50:
visibleText="。"
logicalOffset=1
insideEditor=true

COMMIT+150:
visibleText="。"
logicalOffset=1
insideEditor=true

COMMIT+300:
visibleText="。"
logicalOffset=1
insideEditor=true

COMMIT+500:
visibleText="。"
logicalOffset=1
insideEditor=true

COMMIT+1000:
visibleText="。"
logicalOffset=1
insideEditor=true

COMMIT+2200:
visibleText="。"
logicalOffset=1
insideEditor=true
```

并且：

```text
CARET-CONTINUITY-RESTORE after typing=0
CARET-REPAIR after typing=0
unexpected PLUGIN-SELECTION-WRITE=0
```

如果 composition / mutation 中间存在：

```text
1 → 0 → 1
```

但 COMMIT+50 以后全为 1，则：

```text
native / IME / Typora transient candidate
NO BUSINESS FIX
```

---

# 15. Rehydrate 因果规则继续保持

仅当同时满足：

```text
selectionBefore=1
actualDomWriteCount>0
selectionAfter=0
pluginSelectionWriteCount=0
且 COMMIT 后持续错误
```

才允许：

```text
rehydrate = strong causal candidate
```

如果：

```text
actualDomWriteCount=0
```

则不得把 selection transient 归因于 rehydrate。

---

# 16. Canonical Regression Gate

Clean R0 中必须保持：

```text
SOURCE-SNAPSHOT state=CURRENT_LIVE
CANONICAL-VISUAL-VERIFY overall=true
PROJECTION-VERIFY overall=true
RECORD-LIFECYCLE TRANSFER
CANONICAL-TRANSFER-FINAL-AUDIT overall=true
AWAITING-TRANSFER-LEAK-AUDIT awaitingCount=0
NORMAL-ENTER-FINAL overall=true
```

Canonical 业务代码继续冻结。

---

# 17. Enter Admission Regression Gate

必须：

```text
Process / Period
→ ENTER-ADMISSION-AUDIT decision=REJECT_NON_ENTER
```

且：

```text
normalEnterTxnCreatedFromNonEnterCount=0
```

`nonEnterRejectedCount > 0` 正常。

---

# 18. Clean R0 Verdict

只有 strict startup + clean baseline + probe isolation + behavioral stability 全通过，才允许：

```text
CLEAN R0 PASS — PROCEED TO A1 MATRIX
```

否则必须具体写：

```text
CLEAN R0 FAIL — <reason>
R60 BLOCKED
```

例如：

```text
CLEAN R0 FAIL — FIXTURE CONTAMINATED
```

或：

```text
CLEAN R0 FAIL — PROBE LIFECYCLE LEAK
```

或：

```text
CLEAN R0 FAIL — POST-TEXT_INPUT STABILITY
```

---

# 19. A1 Matrix — 仅在 Clean R0 PASS 后

Clean R0 本身不计入 A1×10。

A1 必须是 10 个独立 clean fixture。

每一个 trial：

```text
sidecarExists=false
recordCount=0
registryRecordCount=0
PERSISTED_HISTORICAL=0
```

操作：

```text
。。
Enter
Enter
立即输入 。
等待 >2.2s
```

每轮要求：

```text
COMMIT+50=1
COMMIT+150=1
COMMIT+300=1
COMMIT+500=1
COMMIT+1000=1
COMMIT+2200=1

visibleText="。"
insideEditor=true

restore=0
repair=0
unexpectedSelectionWrite=0

POST-TEXT-INPUT-COMPLETE exactly once
foreignInputAccepted=0
```

A1：

```text
10/10 PASS
```

后才继续：

```text
A2 fresh noncanonical ×3
A3 split no text ×3
B1 historical/noise ×5
```

---

# 20. 最终 R58.7 Full Closure

最终必须同时满足：

```text
Clean R0 = PASS

A1 fresh canonical = 10/10
A2 fresh noncanonical = PASS
A3 split no text = PASS
B1 historical/noise = PASS

falseCaretRestore=0
unexpectedSelectionWrite=0
selectionLoss=0

Canonical projection fail=0
Canonical final audit fail=0
Awaiting leak=0

Process/Period created NormalEnter=0

Probe lifecycle leak=0
foreign event contamination=0
stale callback execution=0
```

此时才允许：

```text
R58.7 CARET OWNERSHIP FULL CLOSURE PASS
R60 MAY PROCEED
```

否则：

```text
R58.7 CARET OWNERSHIP NOT FULLY CLOSED
R60 BLOCKED
```

---

# 21. 最终报告模板

```text
Build ID:

Final tsc:
Final targeted tests:
Final full tests:
Build command:

Project main SHA:
Runtime main SHA:
mainMatch:

Project style SHA:
Runtime style SHA:
cssMatch:
style source diff:

Probe lifecycle:
sameCompositionSessionNonDedupInputCancels:
activeObservationPeak:
completeCount:
activeObservationAfterComplete:
foreignInputAcceptedByObservation:
staleCallbackExecutedCount:

Strict startup:
oldProcessExited:
PID:
StartTime:
MainWindowHandle:
MainWindowTitle:
targetVault:
targetDocument:
runtimeBuildId:
initializationCount:

Clean baseline:
sidecarExists:
recordCount:
registryRecordCount:
persistedHistoricalCount:

Clean R0:
observationId:
TEXT_COMMIT:
COMMIT+50:
COMMIT+150:
COMMIT+300:
COMMIT+500:
COMMIT+1000:
COMMIT+2200:
caretRestoreAfterInput:
caretRepairAfterInput:
unexpectedSelectionWrite:
rehydrateActualDomWrite:
POST-TEXT-INPUT-COMPLETE:
foreignInputAccepted:
staleCallbackExecuted:

Canonical:
projectionFail:
finalAuditFail:
awaitingLeak:

Enter Admission:
nonEnterCreatedNENTER:

Clean R0 Verdict:
```

---

# 22. Git

禁止：

```text
git add
git commit
git push
```
