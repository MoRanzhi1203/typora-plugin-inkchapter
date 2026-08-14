# TRAE P0 — R58.7 Current Problem Closure Plan
## Registry Scope Authority + Cross-Scope Firewall + Caret/Handoff Closure + Operation Provenance Acceptance

> Project:
>
> `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Current authoritative status:
>
> ```text
> R58.7 PHASE A.1.3.1 NOT FIXED
> R60 BLOCKED
> ```
>
> Latest observed runtime build:
>
> ```text
> inkchapter-r58-7-phA1-3-1-runtime-scope-identity-d6g1b
> ```
>
> 本文档不是要求继续扩展架构。
>
> 当前真正的问题已经从：
>
> ```text
> `。。+Enter` 是否工作
> ```
>
> 转移为：
>
> ```text
> 一个 CanonicalRecord 到底属于哪个 runtime scope，
> 以及谁有权修改、transfer、restore、handoff 它。
> ```
>
> 必须按本文档顺序收口。
>
> 禁止跳过 Phase 1 直接进入 Save-As GUI acceptance。
> 禁止跳过 Runtime Acceptance 直接宣布 PASS。
> 禁止提前进入 ContinuityEngine / Phase B。

---

# 0. 当前问题总览

当前只剩 7 类核心问题：

```text
P0-1
Runtime Scope 尚未成为 Canonical Registry 的真实 identity authority

P0-2
Cross-scope mutation firewall 尚未被证明真实生效

P0-3
CaretExpectation / Handoff scope lifecycle 尚未闭环

P0-4
Save-As / Document Switch Operation Provenance 尚未 runtime 验收

P0-5
EPHEMERAL → PERSISTED 的 identity continuity 尚未真实证明

DEBT-1
Persisted historical sidecar snapshot 长期污染 / 膨胀

DEBT-2
启动阶段 SyntaxError attribution + strict startup evidence 尚未闭环
```

执行顺序必须：

```text
Phase 1
Scope Authority Closure

↓

Phase 2
Operation Provenance GUI Acceptance

↓

Phase 3
Phase A Closure Audit

↓

后续再处理
Session Overlay / Stable Snapshot
SyntaxError attribution
Phase B ContinuityEngine
```

---

# 1. 当前已经真实稳定的能力 — HARD FREEZE

当前 runtime 已经证明：

```text
EDITOR-RUNTIME-BOUND

NO_EDITOR → EPHEMERAL

scopeId=untitled:<session>:editor-1

businessReady=true

persistenceReady=false

USER-INTENT-EPOCH:
scopeId=untitled:...
persistenceKey=null
documentMode=EPHEMERAL

EDITOR-MUTATION-BATCH:
scopeId=untitled:...
persistenceKey=null
documentMode=EPHEMERAL

`。。+Enter`

ENTER-COMMIT-ATOMIC:
overallSuccess=true

POST-TOKEN-SELECTION:
sameAsCommand=true

SELECTION-TRUTH

SELECTION-CONTINUITY-VERIFY

SPLIT_1_TO_2

canonicalOwner != caretDestination

LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH

SIDECAR-WRITE-SKIP:
mode=EPHEMERAL
reason=PERSISTENCE_NOT_READY

SINGLE-DOT-CURRENT-LIVE:
decision=INFO

pluginMainSha256
=
projectMainSha256

shaMatch=true

styleSha256 real

initializationCount=1
```

以上全部 HARD FREEZE。

禁止为了修 Scope / Save-As：

```text
重新修改 Special Command
重新修改 SelectionTruth
重新修改 Split resolver
重新修改 Sidecar EPHEMERAL suppression
重新修改 Single-Dot CURRENT_LIVE de-noise
重新修改 Merge algorithm
```

---

# 2. P0-1 — Registry 仍然没有真正采用 runtime scope

当前上层已经：

```text
scopeId=untitled:session-...:editor-1
```

但 Registry runtime 仍然：

```text
RECORD-LIFECYCLE:
event=REGISTER_CURRENT
documentKey=
state=CURRENT_LIVE
```

Split 时：

```text
RECORD-LIFECYCLE:
event=AWAIT_TRANSFER
documentKey=
```

随后：

```text
RECORD-LIFECYCLE:
event=TRANSFER
documentKey=
```

这证明：

```text
UserIntent / Mutation / Ticket
已经部分 scope-aware

BUT

Canonical Registry
仍使用旧 documentKey namespace
```

因此：

```text
(scopeId, CanonicalRecordId)
```

尚未真正成为 current-session canonical identity。

---

# 3. P0-1 Root Cause 必须先确认

修改前必须输出 Registry Source Map：

```text
CanonicalRuntimeMeta definition

registerCurrentSessionRecord

resolveLiveOwnershipProof

reuse existing

markAwaitingTransfer

transferCanonicalBinding

retireRecord

promoteExistingByRecordId

Backspace update

recordIdByRuntimeId

recordIdByElement

RECORD-LIFECYCLE logger
```

然后明确回答：

```text
哪些 API 仍然接收 documentKey？

哪些 lookup / guard 仍依赖 documentKey？

哪些地方只是日志打印 documentKey，
哪些地方真的以 documentKey 决定业务 identity？
```

禁止只改日志字段。

---

# 4. 建立统一 RuntimeScopeRef

如果当前已有 RuntimeScopeRef，
先验证它是否真的被 transaction 主链消费。

目标：

```ts
export interface RuntimeScopeRef {
  readonly scopeId: string;
  readonly persistenceKey: string | null;
  readonly mode: "EPHEMERAL" | "PERSISTED";
  readonly sessionId: string;
  readonly editorInstanceId: string;
}
```

---

# 5. RuntimeScopeRef 必须是 transaction authority

每次 trusted transaction：

```text
transaction start
↓
snapshotRuntimeScope()
↓
RuntimeScopeRef S1
```

之后整条 transaction 必须复用 S1：

```text
UserIntent
Mutation
Canonical Create/Reuse
Ticket
Await
Transfer
CaretExpectation
Handoff
Backspace
Promotion
Retire
```

禁止 transaction 中途各模块分别重新读取：

```text
getDocumentKey()
getScopeContext()
documentContext.scopeId
```

---

# 6. 必须出现真实 RUNTIME-SCOPE-SNAPSHOT

Runtime 必须看到：

```text
RUNTIME-SCOPE-SNAPSHOT:
source=TRANSACTION_START
scopeId=...
persistenceKey=...
mode=...
sessionId=...
editorInstanceId=...
valid=true
```

如果没有：

```text
RuntimeScopeRef 定义存在
```

不能算完成。

---

# 7. CanonicalRuntimeMeta 真正迁移

必须至少：

```ts
interface CanonicalRuntimeMeta {
  recordId: string;

  scopeId: string;

  persistenceKey: string | null;

  sessionId: string;

  state:
    | "CURRENT_LIVE"
    | "CURRENT_AWAITING_TRANSFER"
    | "CURRENT_RETIRED"
    | "PERSISTED_HISTORICAL";

  currentRuntimeId?: string;

  previousRuntimeId?: string;

  generation: number;
}
```

---

# 8. Current-Session Canonical Identity

必须正式定义：

```text
(scopeId, CanonicalRecordId)
```

禁止继续：

```text
(documentKey="", CanonicalRecordId)
```

作为 Untitled current-session namespace。

---

# 9. documentKey 兼容规则

如果暂时不能删除：

```text
documentKey
```

则：

```text
CURRENT_LIVE
CURRENT_AWAITING_TRANSFER
CURRENT_RETIRED
```

不得依赖 documentKey 做 runtime scope authorization。

它只能保留为：

```text
deprecated persistence compatibility
```

---

# 10. RECORD-LIFECYCLE 必须来自真实 meta.scopeId

必须：

```text
RECORD-LIFECYCLE:
event=REGISTER_CURRENT
recordId=...
scopeId=untitled:...
persistenceKey=null
sessionId=...
state=CURRENT_LIVE
runtimeId=P-RUNTIME-*
generation=...
origin=current-session
```

Split：

```text
AWAIT_TRANSFER
scopeId=S1

TRANSFER
scopeId=S1
```

禁止：

```text
CURRENT_* + documentKey=""
```

---

# 11. P0-2 — Cross-Scope Mutation Firewall

核心 invariant：

```text
record.scopeId
==
operation.scopeId
```

否则：

```text
mutation forbidden
```

---

# 12. 建立统一 Scope Guard

禁止每个 API 复制不一致逻辑。

建议：

```ts
assertCanonicalScope({
  recordId,
  recordScopeId,
  operationScopeId,
  operation,
})
```

---

# 13. Scope Guard 必须覆盖

至少：

```text
REGISTER/REUSE
AWAIT_TRANSFER
TRANSFER
RETIRE
PROMOTION
BACKSPACE_UPDATE
LIVE_OWNERSHIP_PROOF
```

---

# 14. Scope Mismatch 必须真实 BLOCK

统一 trace：

```text
CANONICAL-SCOPE-MISMATCH:
recordId=...
recordScopeId=S1
operationScopeId=S2
operation=TRANSFER|REUSE|AWAIT|RETIRE|PROMOTION|BACKSPACE
decision=BLOCK
```

并保证：

```text
state unchanged
runtimeId unchanged
generation unchanged
recordCount unchanged
```

---

# 15. 主动失败路径测试是 mandatory

必须人为构造：

```text
record.scopeId=S1
operation.scopeId=S2
```

分别测试：

```text
reuse
await
transfer
retire
promotion
backspace
```

全部：

```text
BLOCK
```

不能只靠正常 runtime：

```text
CANONICAL-SCOPE-MISMATCH=0
```

来宣称 firewall 生效。

---

# 16. Ticket Scope 必须从“日志字段”升级为业务 authorization

当前 runtime 已经能看到：

```text
LIVE-REPLACEMENT-TICKET:
scopeId=untitled:...
persistenceKey=null
mode=EPHEMERAL
```

这只是 diagnostics PASS。

还必须证明 Ticket 结构本身拥有 scope。

建议：

```ts
interface LiveReplacementTicket {
  ...
  scope: RuntimeScopeRef;
}
```

---

# 17. Ticket Guard

在：

```text
markAwaiting
resolve
transfer
```

前必须：

```text
ticket.scope.scopeId
==
current transaction scope.scopeId
```

否则：

```text
LIVE-REPLACEMENT-TICKET-CLOSE:
reason=SCOPE_CHANGED
decision=CLOSE
```

并：

```text
markAwaiting=0
transfer=0
generationDelta=0
```

---

# 18. P0-3 — CaretExpectation scope lifecycle

当前 caret algorithm 已经稳定。

本轮只增加 scope ownership。

目标：

```ts
interface CaretExpectation {
  ...
  scope: RuntimeScopeRef;
}
```

---

# 19. Caret Create Trace

所有创建点必须输出：

```text
CARET-EXPECTATION-CREATE:
expectationId=...
scopeId=S1
persistenceKey=null
mode=EPHEMERAL
intentEpoch=...
expectedRuntimeId=...
decision=ACTIVE
```

---

# 20. Caret Verify Scope Guard

任何：

```text
MICROTASK
RAF
OBS
restore
```

前：

```text
expectation.scope.scopeId
==
currentScope.scopeId
```

不一致：

```text
CARET-EXPECTATION-CLOSE:
reason=SCOPE_CHANGED
restoreAttempted=false
```

---

# 21. Scope Change 优先于 Intent Epoch

顺序必须：

```text
scope mismatch
→ SCOPE_CHANGED

else if intent epoch superseded
→ SUPERSEDED_BY_USER_INTENT
```

不能反过来。

---

# 22. Handoff scope lifecycle

当前 Handoff 只证明：

```text
SUPERSEDED_BY_USER_INTENT
```

尚未证明 scope ownership。

目标：

```ts
interface OneShotParagraphReplacementHandoff {
  ...
  scope: RuntimeScopeRef;
}
```

---

# 23. Handoff Create / Close Trace

创建：

```text
HANDOFF-CREATE:
handoffId=...
scopeId=S1
intentEpoch=...
```

关闭：

```text
HANDOFF-CLOSE:
handoffId=...
scopeId=S1
reason=...
```

---

# 24. Handoff Scope Guard

resolve 前：

```text
handoff.scope.scopeId
==
currentScope.scopeId
```

不一致：

```text
HANDOFF-CLOSE:
reason=SCOPE_CHANGED
decision=CLOSE
```

并：

```text
replacement transfer=0
canonical transfer=0
semantic write=0
caret write=0
```

---

# 25. Canonical Binding Transfer Trace

必须：

```text
CANONICAL-BINDING-TRANSFER:
canonicalRecordId=...
scopeId=S1
fromRuntimeId=...
toRuntimeId=...
generationBefore=...
generationAfter=...
reason=...
```

---

# 26. Phase 1 Runtime Acceptance

Untitled 中执行：

```text
至少 5 次 `。。+Enter`
至少 3 次 Split
至少 2 次 Backspace
```

必须满足：

```text
RUNTIME-SCOPE-SNAPSHOT
每个业务 transaction 可追踪

RECORD-LIFECYCLE CURRENT_*
scopeId non-empty

RECORD-LIFECYCLE documentKey=""
作为 runtime namespace
= 0

LIVE-REPLACEMENT-TICKET
scopeId non-empty

CARET-EXPECTATION-CREATE
scopeId non-empty

HANDOFF-CREATE/CLOSE
scopeId non-empty

CANONICAL-BINDING-TRANSFER
scopeId non-empty
```

---

# 27. Phase 1 Failure-Path Acceptance

Unit test 必须主动证明：

```text
S1 record + S2 operation
→ BLOCK
```

至少：

```text
TRANSFER
REUSE
AWAIT
CARET RESTORE
HANDOFF RESOLVE
```

必须验证无副作用。

---

# 28. Phase 1 Regression Gate

继续要求：

```text
`。。+Enter` 5/5

Split 5/5

Selection/Caret verify PASS

SIDECAR-WRITE-SKIP 正常

SINGLE-DOT-CURRENT-LIVE
decision=INFO

SINGLE_DOT_SEMANTIC_VIOLATION
CURRENT_LIVE false positive
= 0
```

---

# 29. Phase 1 Hard Stop

任一：

```text
CURRENT_* RECORD-LIFECYCLE scopeId missing

CURRENT_* Registry 仍依赖 documentKey=""

Ticket 只有日志 scope，业务结构无 scope

scope mismatch 仍 markAwaiting

scope mismatch 仍 transfer

Caret scope mismatch 仍 restore

Handoff scope mismatch 仍 transfer

RUNTIME-SCOPE-SNAPSHOT 未进入真实 transaction

仅改 trace，不改 authorization

Special Command regression

Split regression

Sidecar suppression regression
```

立即：

```text
R58.7 PHASE A.1.3.1a NOT FIXED — R60 BLOCKED
```

禁止进入 Phase 2。

---

# 30. Phase 1 PASS 条件

只有全部通过：

```text
R58.7 PHASE A.1.3.1a PASS — RUNTIME SCOPE AUTHORITY CLOSED
```

此时才允许执行 Phase 2。

---

# 31. P0-4 — Operation Provenance 尚未 runtime 验收

Phase 2 原则：

```text
优先不改代码
先执行两个 GUI 对照实验
```

当前已有：

```text
file:will-save
PendingPersistencePromotion
SAVE_AS_PROMOTION classifier
DOCUMENT_SWITCH classifier
```

但目前缺真实 acceptance。

---

# 32. Case A — Document Switch

必须先执行：

```text
新建 Untitled
↓
不要保存
↓
建立至少 1 个 current live override
↓
点击左侧已有 doc.md
```

---

# 33. Case A 必须

```text
PERSISTENCE-PROMOTION-PENDING
= 0
```

然后：

```text
DOCUMENT-CONTEXT-TRANSITION:
fromMode=EPHEMERAL
toMode=PERSISTED
persistenceKeyBefore=null
persistenceKeyAfter=doc.md
reason=DOCUMENT_SWITCH
scopeIdSame=false
```

并允许：

```text
CANONICAL-BINDING-DOCUMENT-SWITCH

SIDECAR-ACTUAL-LOAD doc.md.json

PERSISTED_HISTORICAL load
```

---

# 34. Case A 禁止

```text
SAVE_AS_PROMOTION
```

必须：

```text
count=0
```

如果 Case A FAIL：

```text
立即停止
```

不要进入真实 Save-As Case。

---

# 35. P0-5 — Real Save-As Identity Continuity

Case A PASS 后，执行 Case B。

---

# 36. Case B — Real Save As

```text
新建全新 Untitled
↓
至少 2 次 `。。+Enter`
↓
至少 1 次 Split
↓
记录所有 current CanonicalRecordId
↓
Save As:
phase-a-saveas-<unique>.md
```

---

# 37. Save Provenance 必须真实出现

必须看到实际插件 trace：

```text
PERSISTENCE-PROMOTION-PENDING
```

不能把 core 的：

```text
workspace.on(file:will-save, ...)
```

注册日志当成实际 event。

---

# 38. file:will-save 必须验证真实 payload

必须记录：

```text
event timestamp
scopeId
editorInstanceId
file argument
target path 是否已知
```

如果：

```text
targetPath 在 will-save 时为空
```

不要强行要求提前 targetPath exact match。

应以真实事件顺序调整 matching 规则。

禁止猜。

---

# 39. Save-As Promotion 必须

最终：

```text
DOCUMENT-CONTEXT-TRANSITION:
fromMode=EPHEMERAL
toMode=PERSISTED
scopeIdBefore=S1
scopeIdAfter=S1
scopeIdSame=true
persistenceKeyBefore=null
persistenceKeyAfter=phase-a-saveas-<unique>.md
reason=SAVE_AS_PROMOTION
```

---

# 40. Save-As Identity Continuity

保存前：

```text
recordIds=[R1,R2,...]
```

保存后必须：

```text
same recordIds
```

并：

```text
runtime binding retained
generation unchanged due solely to save
CURRENT_LIVE retained
```

禁止：

```text
clear registry

recreate records

CURRENT_LIVE → PERSISTED_HISTORICAL

historical rehydrate current live records
```

---

# 41. Save-As 不得走 Document Switch

Case B 当前 scope：

```text
CANONICAL-BINDING-DOCUMENT-SWITCH
= 0
```

---

# 42. Initial Stable Snapshot

Promotion 完成后允许：

```text
one initial sidecar snapshot
```

路径：

```text
...\paragraph-layout\phase-a-saveas-<unique>.md.json
```

禁止：

```text
\.json
untitled.json
unknown.json
```

---

# 43. Save-As 后继续编辑

保存后继续：

```text
`。。+Enter`
Normal Enter
Backspace
Split
```

必须：

```text
same scopeId=S1
persistenceKey=<saved file>
```

---

# 44. Phase 2 Acceptance

Case A：

```text
Document Switch
至少 3/3
```

Case B：

```text
Real Save-As
至少 3/3
```

---

# 45. Phase 2 Hard Stop

任一：

```text
没有 Save provenance 却判 SAVE_AS_PROMOTION

Document Switch 被判 Save-As

Save-As scopeId 改变

Save-As recordId 重建

Save-As generation 无故增加

Save-As current records 变 historical

Save-As 触发 document switch handling

beforeMode=EPHEMERAL
但 persistenceKeyBefore 非 null

file:will-save payload 被猜测而不是 runtime 记录
```

则：

```text
R58.7 PHASE A.1.3.2 NOT FIXED — R60 BLOCKED
```

---

# 46. Phase 2 PASS

全部 runtime 对照通过才允许：

```text
R58.7 PHASE A.1.3.2 PASS — OPERATION PROVENANCE CLOSED
```

---

# 47. Phase 3 — Phase A Closure Audit

Phase 1 + Phase 2 均 PASS 后，
不要马上进入 Phase B。

先做一次 Phase A Closure Audit。

---

# 48. Phase A Closure 必须确认

```text
NO_EDITOR / EPHEMERAL / PERSISTED
三态清晰

scopeId / persistenceKey
职责分离

businessReady / persistenceReady
职责分离

EPHEMERAL
不 load/write persistent sidecar

CURRENT_* records
全部 scope-aware

Cross-scope mutation
全部 blocked

Caret/Handoff
scope-aware

Document Switch
不保留旧 runtime scope

Save-As
保留 runtime scope

Save-As
保留 CanonicalRecordId

Runtime Identity
plugin/project SHA match

initializationCount=1
```

---

# 49. Phase A Closure Report

只有 closure audit 全部 PASS：

```text
R58.7 PHASE A CLOSED
```

然后才允许讨论：

```text
R58.7 Phase B
Pure ContinuityEngine
```

---

# 50. DEBT-1 — Historical Sidecar Pollution

当前仍存在长期结构债务：

```text
PERSISTED_HISTORICAL records
持续积累

candidateCount
可能越来越高

rehydrate ambiguity
越来越多
```

本轮不要顺手修。

---

# 51. Historical Pollution 后续目标

后续独立阶段：

```text
Session Overlay
+
Stable Snapshot
```

目标：

```text
current editing session
→ session overlay authoritative

stable save/close/switch boundary
→ compact persistent snapshot
```

而不是：

```text
每次 runtime churn
→ sidecar 继续增长
```

---

# 52. DEBT-2 — SyntaxError Attribution

当前启动仍出现：

```text
SyntaxError: Unexpected token ')'
```

但之后 InkChapter 可继续：

```text
onload START
runtime identity
business operations
```

所以当前只能判：

```text
STARTUP ERROR EXISTS
SOURCE UNATTRIBUTED
```

本轮不要修改 canonical/split/save logic 来“修”它。

---

# 53. SyntaxError 后续独立 forensic

以后单独执行：

```text
source attribution

plugin disabled comparison

bundle syntax scan

preload/renderer IPC attribution

stack origin
```

禁止和当前 Scope / Save-As 混修。

---

# 54. Strict Startup Verification

每次启动或重启 Typora：

必须验证：

```text
old Typora process exited

new PID

new StartTime

MainWindowHandle != 0

MainWindowTitle nonempty

target vault

target document / Untitled state

runtime plugin main path

plugin main SHA256

project main SHA256

shaMatch=true

style SHA256

Build ID

initializationCount=1
```

---

# 55. Startup Evidence Rule

如果启动命令已经执行，
但任一 mandatory 字段没有真实验证：

必须原样输出：

```text
启动命令已发出，但尚未确认成功
```

禁止把：

```text
Start-Process success
PID exists
pnpm build success
```

等同于：

```text
Typora 已成功启动
```

---

# 56. Build ID Policy

Phase 1 新 Build ID：

```text
inkchapter-r58-7-phA1-3-1a-scope-authority-<unique>
```

如果 Phase 2 只做 runtime acceptance 不改代码：

```text
不得为了测试重新换 Build ID
```

如果 Phase 2 runtime 证明 classifier 必须修改，
才创建：

```text
inkchapter-r58-7-phA1-3-2-provenance-<unique>
```

---

# 57. Build ID Audit

每次代码修改：

```text
SOURCE
DIST
DEPLOYED
RUNTIME
REPORT
```

必须完全一致。

---

# 58. Typecheck / Tests / Build

执行：

```powershell
pnpm exec tsc --noEmit

pnpm test

pnpm run build:dev

powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1
```

必须记录：

```text
typecheck exit

tests count

failures

build exit

project main SHA

deployed main SHA

shaMatch

style SHA

Build ID
```

---

# 59. 验收状态必须分层

以后禁止：

```text
typecheck PASS
+
unit tests PASS
+
build PASS
=
PHASE PASS
```

必须分别报告：

```text
SOURCE COMPLETE

UNIT TEST COMPLETE

BUILD COMPLETE

DEPLOY COMPLETE

STARTUP VERIFIED

RUNTIME ACCEPTANCE COMPLETE
```

只有最后一个完成：

```text
PHASE PASS
```

---

# 60. Hard Freeze Summary

禁止再动：

```text
Special Command core

SelectionTruth core

Split canonicalOwner/caretDestination algorithm

Mutation Shape Authority

Merge batch-first

EPHEMERAL persistence suppression

Single-Dot CURRENT_LIVE de-noise

Runtime artifact path/SHA logic
```

除非出现明确 regression runtime evidence。

---

# 61. 禁止假修复

禁止：

```text
只给日志加 scopeId

Registry lookup/transfer 仍使用空 documentKey

Ticket 只打印 scopeId 但不校验 scope

Caret 只打印 scopeId 但 restore 不校验

Handoff 只打印 scopeId 但 transfer 不校验

把 scopeId 硬编码成 document path

Untitled 创建假 persistenceKey

用 timer 猜 Save-As

EPHEMERAL→PERSISTED 自动判 Save-As

same editor 自动判 Save-As

清空 Registry 来规避跨 scope 问题

Save-As 重建 records

删掉 historical hard stop

继续修改 `。。+Enter`

提前进入 ContinuityEngine
```

---

# 62. 推荐修改范围 — Phase 1

优先：

```text
src/heading-numbering/paragraph-canonical-registry.ts

src/heading-numbering/heading-numbering-service.ts
```

可能需要：

```text
src/runtime/document-runtime-context.ts

src/heading-numbering/paragraph-indent-manager.ts
```

只允许为：

```text
RuntimeScopeRef
Caret scope
Handoff scope
```

做最小类型适配。

---

# 63. 第一执行动作

不要先改代码。

先输出：

```text
A. Registry Identity Source Map

B. RuntimeScopeRef Consumption Source Map

C. Ticket Scope Authorization Source Map

D. Caret Scope Source Map

E. Handoff Scope Source Map
```

然后明确回答：

```text
1. 为什么当前 UserIntent/Mutation/Ticket 已经有 scopeId，
   但 Registry CURRENT_* 仍是 documentKey=""？

2. RuntimeScopeRef 当前是否真的由 transaction snapshot 一次后贯穿全链？
   还是只是定义了 helper？

3. 哪些 Registry mutation 在 scope mismatch 时仍会继续修改 state？

4. CaretExpectation 哪些 create / verify / restore 路径没有 scope guard？

5. Handoff 哪些 create / resolve / transfer 路径没有 scope guard？
```

确认后只执行 Phase 1。

---

# 64. Final Verdict Policy

Phase 1 任一 mandatory：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

必须：

```text
R58.7 PHASE A.1.3.1a NOT FIXED — R60 BLOCKED
```

Phase 1 全通过：

```text
R58.7 PHASE A.1.3.1a PASS — RUNTIME SCOPE AUTHORITY CLOSED
```

然后才进入 Phase 2。

Phase 2 任一 mandatory：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

必须：

```text
R58.7 PHASE A.1.3.2 NOT FIXED — R60 BLOCKED
```

Phase 2 全通过：

```text
R58.7 PHASE A.1.3.2 PASS — OPERATION PROVENANCE CLOSED
```

Phase A Closure Audit 全通过：

```text
R58.7 PHASE A CLOSED
```

否则：

```text
R60 BLOCKED
```

---

# 65. Execution Rules

直接操作：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

禁止：

```text
git add
git commit
git push
```

允许：

```text
git status
git diff
```

禁止编造：

```text
scopeId

RuntimeScopeRef consumption

scope mismatch blocking

Caret/Handoff guard

Save provenance

Save target path

recordId continuity

generation continuity

sidecar write

Build ID

SHA

PID

StartTime

MainWindowHandle

MainWindowTitle

runtime acceptance count
```

---

# 66. 最终目标

当前不是继续增加状态机。

最终要收敛为：

```text
Trusted User Transaction
↓
one RuntimeScopeRef
↓
all current-session business objects share same scope
↓
scope guard before mutation
↓
current live continuity
↓
document switch invalidates old scope
↓
Save-As promotes persistence without changing runtime identity
```

只有做到这一点：

```text
Phase A
```

才真正具备进入：

```text
Pure ContinuityEngine
```

的资格。
