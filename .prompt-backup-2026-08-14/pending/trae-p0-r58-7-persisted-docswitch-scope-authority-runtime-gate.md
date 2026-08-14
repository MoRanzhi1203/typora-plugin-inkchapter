# Trae P0 — R58.7 PERSISTED→PERSISTED Document Scope Authority 修复 + Document-Switch Runtime Gate

## 0. 当前结论

当前 Build：

```text
inkchapter-r58-7-clean-r0-closure-p4v9n
```

当前已有高优先级证据：

```text
Formal Clean R0 = PASS / runtime
Post-TEXT_INPUT stability = PASS
Probe lifecycle COMPLETE = PASS
Canonical Transfer = PASS
AWAITING-TRANSFER-LEAK awaitingCount=0
Enter Admission = PASS
```

但 Reduced Matrix 在同一个 Typora session 内切换文档时暴露真实 P0：

```text
PERSISTED A → PERSISTED B

activeFilePath = B
persistenceKey = B
scopeId = A   ← stale
```

并继续传播到：

```text
USER-INTENT-EPOCH
EDITOR-MUTATION-BATCH
RUNTIME-SCOPE-SNAPSHOT
REGISTER_CURRENT
HANDOFF
CaretExpectation
LiveReplacementTicket
Canonical runtime metadata
```

因此：

```text
Reduced Matrix = STOPPED / INVALID
R58.7 PRACTICAL CLOSURE = NOT YET
R60 = BLOCKED
```

本轮只修：

```text
DocumentRuntimeContext
PERSISTED → PERSISTED DOCUMENT_SWITCH
scopeId authority / transition propagation
```

---

# 1. 冻结范围

本轮禁止修改以下已通过路径的业务算法：

```text
CaretExpectation supersession algorithm
Post-TEXT_INPUT probe
restoreLogicalCaret
CARET-REPAIR
SelectionTruth
NormalEnter structural resolver
Canonical Transfer algorithm
Canonical visual verifier
Historical resolver rules
Merge
Save-As provenance classifier
```

尤其禁止通过：

```text
重新启用 historical heuristic
whole-document ordinal/text fallback
previous paragraph fallback
强制 caret restore
强制 indentation
每切文件就重启 Typora
```

来规避问题。

---

# 2. 根因问题定义

真实错误状态：

```text
before:
mode=PERSISTED
scopeId=r58-caret-a1-fresh-06.md
persistenceKey=r58-caret-a1-fresh-06.md
activeFilePath=...\r58-caret-a1-fresh-06.md

用户 file-open:
r58-caret-a1-fresh-07.md

after 当前错误:
mode=PERSISTED
scopeId=r58-caret-a1-fresh-06.md            ← stale
persistenceKey=r58-caret-a1-fresh-07.md
activeFilePath=...\r58-caret-a1-fresh-07.md
```

正确状态必须是：

```text
after:
mode=PERSISTED
scopeId=r58-caret-a1-fresh-07.md
persistenceKey=r58-caret-a1-fresh-07.md
activeFilePath=...\r58-caret-a1-fresh-07.md
```

并发出：

```text
DOCUMENT-CONTEXT-TRANSITION:
fromMode=PERSISTED
toMode=PERSISTED
scopeIdBefore=r58-caret-a1-fresh-06.md
scopeIdAfter=r58-caret-a1-fresh-07.md
scopeIdSame=false
persistenceKeyBefore=r58-caret-a1-fresh-06.md
persistenceKeyAfter=r58-caret-a1-fresh-07.md
reason=DOCUMENT_SWITCH
decision=SWITCH_DOCUMENT
```

---

# 3. 不允许通过 Mode 相同判定“同一个文档”

禁止类似：

```ts
if (before.mode === after.mode) {
  preserveScope();
}
```

PERSISTED → PERSISTED 仍然可能是：

```text
DOCUMENT_SWITCH
```

Document identity 必须至少综合：

```text
activeFilePath
persistenceKey
documentKey
operation provenance
```

判断。

---

# 4. Save As 规则必须保持不变

当前已经建立的 Save-As provenance 规则继续冻结。

只有：

```text
EPHEMERAL
→ matching PendingPersistencePromotion
→ PERSISTED
```

才允许：

```text
reason=SAVE_AS_PROMOTION
preserveScope=true
CanonicalRecordId unchanged
```

普通：

```text
PERSISTED A → PERSISTED B
```

且没有 matching save promotion：

```text
reason=DOCUMENT_SWITCH
preserveScope=false
```

禁止为了修 Document Switch 改坏 Save As。

---

# 5. 强制 Immutable Transition

DocumentRuntimeContext 更新必须采用：

```text
immutable before snapshot
↓
resolve candidate after
↓
classify transition(before, after, provenance)
↓
commit complete new context
↓
emit audit
```

禁止：

```text
先 mutation currentContext.persistenceKey
↓
再从已经被 mutation 的 context 推断 before
```

目标接口可类似：

```ts
interface DocumentContextTransitionInput {
  before: DocumentRuntimeContext
  candidate: DocumentRuntimeContext
  provenance: OperationProvenance
}

interface DocumentContextTransitionPlan {
  reason:
    | "DOCUMENT_SWITCH"
    | "SAVE_AS_PROMOTION"
    | "SAME_DOCUMENT_REFRESH"
    | "NO_EDITOR"
  preserveScope: boolean
  next: DocumentRuntimeContext
}
```

实现名称可调整，但必须保持：

```text
PLAN BEFORE MUTATION
ONE COMMIT AUTHORITY
```

---

# 6. Scope Authority

当前 persisted 文档兼容模式保持：

```text
scopeId = persistenceKey = documentKey
```

不要在本轮顺手引入新的：

```text
docscope:<session>:...
```

格式。

本轮只做最小修复：

```text
PERSISTED A → PERSISTED B
scopeId A → B
```

---

# 7. Current-Session Scope 传播硬约束

切换到文档 B 后，所有新的 current-session 事件必须：

```text
scopeId == currentDocumentContext.scopeId
```

至少覆盖：

```text
USER-INTENT-EPOCH
RUNTIME-SCOPE-SNAPSHOT
EDITOR-MUTATION-BATCH
REGISTER_CURRENT
CARET-EXPECTATION-CREATE
HANDOFF-CREATE
LIVE-REPLACEMENT-TICKET
SOURCE-SNAPSHOT
TRANSFER-PLAN
Canonical runtime metadata
POST-TEXT-INPUT-ARM
REHYDRATE-SELECTION-AUDIT
```

如果出现：

```text
event.scopeId != currentDocumentContext.scopeId
```

必须记录：

```text
DOCUMENT-SCOPE-AUTHORITY-AUDIT
overall=false
```

---

# 8. Cross-Scope Canonical Hard Stop

禁止跨 scope canonical mutation。

如果：

```text
record.scopeId != transaction.scopeId
```

或：

```text
ticket.scopeId != currentContext.scopeId
```

则必须：

```text
CANONICAL-SCOPE-MISMATCH:
recordId=...
recordScopeId=...
transactionScopeId=...
currentScopeId=...
decision=HARD_STOP
```

并禁止：

```text
transfer
restore
historical recovery
append replacement record
```

---

# 9. Document Switch 时旧 current-session owner 处理

A → B 时：

```text
A 中 CURRENT_LIVE / CURRENT_AWAITING_TRANSFER
不得继续作为 B 的 current owners
```

必须由现有 document-switch lifecycle 合法关闭：

```text
CURRENT_LIVE / CURRENT_AWAITING_TRANSFER
→ RETIRE / CLOSE / documented terminal transition
```

必须证明：

```text
旧 scope active CaretExpectation = 0
旧 scope active Handoff = 0
旧 scope active LiveReplacementTicket = 0
旧 scope current mutation ownership = 0
```

不得删除 persistent sidecar 作为处理方法。

---

# 10. Source Investigation — 先追根因再改

先输出只读 Source Map：

```text
DocumentRuntimeContext 定义
loadDocumentContext()
refreshDocumentContext()
getDocumentKey()
ServiceDocSwitch / file-open handler
DOCUMENT-CONTEXT-TRANSITION builder
PendingPersistencePromotion
Save-As classifier
registry.onDocumentSwitch / retirement
scopeId 构造逻辑
persistenceKey 构造逻辑
```

重点回答：

```text
1. PERSISTED → PERSISTED 为什么保留旧 scopeId？
2. 是哪个具体分支决定 preserveScope？
3. before context 是否在 classify 前被 mutation？
4. activeFilePath / persistenceKey 谁先变化？
5. DOCUMENT_SWITCH 是否只由 mode transition 判断？
6. file-open 时是否遗漏 scopeId rebuild？
7. registry retire 与 new context commit 的顺序是什么？
```

先报告根因，再做最小改动。

---

# 11. Mandatory Unit Tests

至少新增：

## DS-1 — PERSISTED A → PERSISTED B

```text
before:
mode=PERSISTED
scope=A
key=A

after candidate:
mode=PERSISTED
key=B

expected:
reason=DOCUMENT_SWITCH
preserveScope=false
scope=B
key=B
scopeIdSame=false
```

## DS-2 — PERSISTED A → PERSISTED A

普通 refresh / save：

```text
expected:
SAME_DOCUMENT_REFRESH
scope unchanged
```

## DS-3 — EPHEMERAL → PERSISTED Save As

有 matching PendingPersistencePromotion：

```text
expected:
SAVE_AS_PROMOTION
preserveScope=true
CanonicalRecordId unchanged
```

## DS-4 — Immutable before snapshot

在 after candidate 构造后：

```text
before.scopeId / before.persistenceKey
不得被 mutation
```

## DS-5 — Post-switch Register

A → B 后：

```text
REGISTER_CURRENT.scopeId=B
persistenceKey=B
documentKey=B
```

## DS-6 — Old-scope transient owners close

A → B：

```text
A CaretExpectation closed
A Handoff closed
A replacement ticket closed/cancelled
restoreAttempted=false
```

## DS-7 — Cross-scope transfer forbidden

```text
record.scope=A
transaction.scope=B

=> CANONICAL-SCOPE-MISMATCH
=> HARD_STOP
=> transfer=false
```

## DS-8 — Historical isolation remains

```text
CURRENT_LIVE / CURRENT_AWAITING_TRANSFER
不得因 scope switch 使用 historical heuristic
```

---

# 12. Build ID

修复后生成新唯一 Build ID。

建议：

```text
inkchapter-r58-7-persisted-docswitch-scope-authority-<unique>
```

禁止继续使用：

```text
inkchapter-r58-7-clean-r0-closure-p4v9n
```

新 Build 必须能从 runtime audit 明确辨识。

---

# 13. Final-Source Pipeline

所有修改完成后，只在最终源码状态执行：

```text
pnpm exec tsc --noEmit
targeted tests
full tests
pnpm run build:dev
```

必须报告：

```text
targeted test files
targeted passed count
full test files
full passed count
build result
```

---

# 14. Deploy

部署到唯一正确 runtime：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\style.css
```

禁止：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault.typora
```

部署后重新计算：

```text
project main SHA
runtime main SHA
mainMatch

project style SHA
runtime style SHA
cssMatch
```

必须：

```text
mainMatch=true
cssMatch=true
```

---

# 15. Document-Switch Runtime Gate 专用 Fixtures

不要使用 fresh-09。

新建：

```text
r58-docswitch-scope-a.md
r58-docswitch-scope-b.md
```

要求两者首次测试前：

```text
sidecarExists=false
recordCount=0
```

禁止删除 sidecar 来伪造 clean。

---

# 16. Strict Startup

Document-Switch Gate 开始时必须一次完整严格启动。

必须证明：

```text
old process exited
new PID
new StartTime
MainWindowHandle != 0
MainWindowTitle != ""

target vault
target document = r58-docswitch-scope-a.md

runtime plugin main path
project/runtime main SHA
style SHA
Build ID
runtime Build ID
initializationCount=1
```

缺任意字段必须原样输出：

**启动命令已发出，但尚未确认成功**

未 Strict Startup PASS 时禁止开始 runtime gate。

---

# 17. Runtime Gate Phase A

启动 A：

```text
r58-docswitch-scope-a.md
```

必须：

```text
mode=PERSISTED
scopeId=r58-docswitch-scope-a.md
persistenceKey=r58-docswitch-scope-a.md
activeFilePath=...\r58-docswitch-scope-a.md

SIDECAR-ACTUAL-LOAD
exists=false
recordCount=0
source=physical
```

---

# 18. A → B：禁止重启

这是本轮最关键 Gate。

必须：

```text
同一个 Typora session
直接 file-open B
```

禁止：

```text
关闭 Typora
重启 B
```

否则无法证明 Document Switch 修复。

预期：

```text
ServiceDocSwitch:
oldKey=A
newKey=B
```

然后：

```text
DOCUMENT-CONTEXT-TRANSITION:
fromMode=PERSISTED
toMode=PERSISTED
scopeIdBefore=A
scopeIdAfter=B
scopeIdSame=false
persistenceKeyBefore=A
persistenceKeyAfter=B
reason=DOCUMENT_SWITCH
decision=SWITCH_DOCUMENT
```

最终：

```text
DOCUMENT-CONTEXT-STATE:
scopeId=B
activeFilePath=B
persistenceKey=B
```

不得出现：

```text
scopeId=A
persistenceKey=B
```

---

# 19. B 中 Current-Session Scope Audit

切到 B 后，执行任何新操作前先确认：

```text
old A current owners = 0
old A active Handoff = 0
old A CaretExpectation = 0
old A AwaitingTransfer leak = 0
```

然后 B 的所有新事件必须：

```text
scopeId=B
persistenceKey=B
```

至少检查：

```text
USER-INTENT-EPOCH
EDITOR-MUTATION-BATCH
RUNTIME-SCOPE-SNAPSHOT
```

---

# 20. B 中执行一次 Canonical + Caret Gate

在 B 中执行：

```text
。。
Enter
Enter
立即输入 。
等待 >=2.5s
```

必须：

```text
REGISTER_CURRENT.scopeId=B
REGISTER_CURRENT.persistenceKey=B
REGISTER_CURRENT.documentKey=B

SOURCE-SNAPSHOT.scopeId=B
TRANSFER-PLAN.scopeId=B

POST-TEXT-INPUT-ARM.scopeId=B

COMMIT+50    logicalOffset=1
COMMIT+150   logicalOffset=1
COMMIT+300   logicalOffset=1
COMMIT+500   logicalOffset=1
COMMIT+1000  logicalOffset=1
COMMIT+2200  logicalOffset=1

visibleText="。"
insideEditor=true

CARET-CONTINUITY-RESTORE=0
CARET-REPAIR=0
unexpected PLUGIN-SELECTION-WRITE=0

POST-TEXT-INPUT-COMPLETE
activeObservationAfterComplete=none
pendingCallbackCountAfterComplete=0

CANONICAL-VISUAL-VERIFY overall=true
PROJECTION-VERIFY overall=true
CANONICAL-TRANSFER-FINAL-AUDIT overall=true
AWAITING-TRANSFER-LEAK awaitingCount=0
NORMAL-ENTER-FINAL overall=true

CANONICAL-SCOPE-MISMATCH count=0
```

---

# 21. B → A Reverse Switch Gate

B 的测试完成后：

```text
同 session
B → A
```

禁止重启。

必须：

```text
scopeIdBefore=B
scopeIdAfter=A
scopeIdSame=false

persistenceKeyBefore=B
persistenceKeyAfter=A

reason=DOCUMENT_SWITCH
decision=SWITCH_DOCUMENT
```

最终：

```text
scopeId=A
persistenceKey=A
activeFilePath=A
```

用于证明修复不是单向特判。

---

# 22. Document-Switch Gate PASS 条件

只有以下全部通过：

```text
Strict Startup PASS
A context PASS
A→B transition PASS
B context authority PASS
B current-session operation scope PASS
B canonical/caret gate PASS
B→A reverse transition PASS
cross-scope hard-stop tests PASS
Save-As regression PASS
historical isolation regression PASS
```

才允许：

```text
DOCUMENT-SWITCH SCOPE AUTHORITY = PASS
```

否则：

```text
DOCUMENT-SWITCH SCOPE AUTHORITY = FAIL
R58.7 PRACTICAL CLOSURE BLOCKED
R60 BLOCKED
```

---

# 23. Reduced Matrix 恢复策略

Document-Switch Gate PASS 后才恢复 Reduced Matrix。

此时不要再用“每个 trial 都重启 Typora”规避问题。

可以：

```text
一次 Strict Startup
↓
fresh-09  A1-01
↓
file-open fresh-11
确认 scope transition + clean baseline
A1-02
↓
file-open fresh-12
确认 scope transition + clean baseline
A1-03
↓
fresh-13 A2
↓
fresh-14 A3
```

每次切文档必须：

```text
activeFilePath == persistenceKey == scopeId == current fixture
```

并确认：

```text
old current-session owners = 0
new document baseline clean
```

B1 再单独使用两个真实 historical fixtures。

---

# 24. 当前旧证据处理

保留：

```text
fresh-05 Formal Clean R0 = PASS
fresh-06 A1 behavioral = supplementary PASS
```

标记：

```text
fresh-07 = INVALID / stale scope
fresh-08 = INVALID / stale scope
```

fresh-06 / 07 / 08 / 10 如已有 sidecar：

```text
不得再次作为 fresh fixture
```

fresh-09 暂时保留给修复后 Reduced Matrix。

---

# 25. SyntaxError 独立债务

继续记录：

```text
SyntaxError: Unexpected token ')'
```

但除非新证据证明与 DocumentRuntimeContext 修复存在直接因果，否则：

```text
禁止顺手修这个问题
禁止因此改 Caret / Canonical / paragraph 业务
```

报告：

```text
startupSyntaxErrorObserved=true/false
attribution=UNRESOLVED
```

---

# 26. Fail-Fast

以下任意一项出现立即 STOP：

```text
scopeId != persistenceKey on PERSISTED doc
scopeId != current documentKey
cross-scope canonical mutation
CANONICAL-SCOPE-MISMATCH
Save-As regression
historical resolver leakage
awaitingCount > 0 at stable boundary
NormalEnter final overall=false
Post-TEXT_INPUT final offset != 1
```

保留现场，不得：

```text
删除 sidecar
重置 fixture
自动重跑直到 PASS
继续 Reduced Matrix
```

---

# 27. 最终报告格式

```text
=== ROOT CAUSE ===
sourceFile:
sourceFunction:
faultyBranch:
whyPersistedSwitchPreservedScope:

=== PATCH ===
filesChanged:
transitionModel:
scopeAuthority:
crossScopeGuard:

=== TESTS ===
DS-1:
DS-2:
DS-3:
DS-4:
DS-5:
DS-6:
DS-7:
DS-8:
targeted:
full:
tsc:
build:

=== ARTIFACT ===
buildId:
projectMainSHA:
runtimeMainSHA:
mainMatch:
projectStyleSHA:
runtimeStyleSHA:
cssMatch:

=== STRICT STARTUP ===
oldProcessExited:
PID:
StartTime:
MainWindowHandle:
MainWindowTitle:
targetVault:
targetDocument:
runtimeBuildId:
initializationCount:

=== DOC SWITCH A ===
scopeId:
persistenceKey:
activeFilePath:
sidecarLoad:

=== A TO B ===
scopeIdBefore:
scopeIdAfter:
scopeIdSame:
persistenceKeyBefore:
persistenceKeyAfter:
reason:
decision:

=== B AUTHORITY ===
scopeId:
persistenceKey:
activeFilePath:
oldScopeOwners:
scopeMismatchCount:

=== B CANONICAL/CARET ===
registerScope:
sourceSnapshotScope:
transferPlanScope:
postTextInputScope:
commit50:
commit150:
commit300:
commit500:
commit1000:
commit2200:
caretRestore:
caretRepair:
pluginSelectionWrite:
canonicalFinal:
awaitingCount:
normalEnterFinal:

=== B TO A ===
scopeIdBefore:
scopeIdAfter:
persistenceKeyBefore:
persistenceKeyAfter:
reason:
decision:

=== REGRESSIONS ===
saveAsPromotion:
historicalIsolation:
crossScopeHardStop:

=== VERDICT ===
documentSwitchScopeAuthority:
reducedMatrixMayResume:
R58_7:
R60:
```

---

# 28. 最终允许状态

若 Gate PASS：

```text
PERSISTED→PERSISTED DOCUMENT_SWITCH SCOPE AUTHORITY = FIXED / RUNTIME PASS

Caret / Probe / Canonical Transfer = NO REGRESSION

REDUCED MATRIX MAY RESUME

R58.7 PRACTICAL CLOSURE = NOT YET
R60 = BLOCKED
```

注意：

```text
仅 Document-Switch Gate PASS
≠
R58.7 Practical Closure PASS
```

仍需继续 Reduced Matrix。

---

# 29. Git

禁止：

```text
git add
git commit
git push
```
