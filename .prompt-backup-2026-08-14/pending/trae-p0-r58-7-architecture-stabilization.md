# TRAE P0 — R58.7 Architecture Stabilization: Document Context Authority + Pure Continuity Engine + Registry Commit Firewall + Session Overlay Persistence

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Architecture Stabilization**
>
> Current authoritative status:
>
> ```text
> R58.6.7 NOT FIXED
> R60 BLOCKED
> ```
>
> 本轮禁止继续沿着：
>
> ```text
> bug
> → 新增一个状态
> → 再新增一个 ticket
> → 再加一个 timer
> → 再加一个 guard
> ```
>
> 的方式修补。
>
> 最新 runtime 已经证明：
>
> ```text
> documentKey=unknown
> documentKey=""
> sidecar path=...\paragraph-layout\.json
> ```
>
> 同时 canonical record、UserIntent、Split、Sidecar write 已经开始运行。
>
> 这意味着：
>
> ```text
> Document Scope 尚未 Ready
> 但业务 mutation 已经开始
> ```
>
> 这是比 Merge / Caret / Handoff 更底层的架构错误。
>
> 本轮目标：
>
> ```text
> 先建立 Document Context Authority
> ↓
> 再建立 Pure ContinuityEngine
> ↓
> 再把 Registry 收敛为唯一 Mutation Authority
> ↓
> 再把 Sidecar 降级为稳定边界 Snapshot
> ```
>
> 不再继续扩张 R58.6.x 状态机。

---

# 0. R58.7 总体原则

本轮严格遵守：

```text
SCOPE FIRST
PLAN BEFORE MUTATION
ONE COMMIT AUTHORITY
PERSIST ONLY AT STABLE BOUNDARY
```

即：

```text
Document Scope
→ Immutable Input
→ Pure Continuity Plan
→ Registry Commit
→ Caret Plan
→ Visual Projection
→ Stable Persistence Snapshot
```

禁止任何模块绕过这条链。

---

# 1. 当前最新 Runtime Ground Truth

当前真实 Build：

```text
inkchapter-r58-6-7-intent-merge-batch-caret-identity-q9k2m
```

当前已经有真实正向证据，必须 HARD FREEZE：

```text
SelectionTruth
SELECTION-CONTINUITY-VERIFY
UserIntent basic capture
UserIntent dedup for Backspace keydown+beforeinput
HANDOFF-CLOSE: SUPERSEDED_BY_USER_INTENT
CaretExpectation supersession
SPLIT_1_TO_2 classification
canonicalOwner != caretDestination
SPLIT_NEW_PARAGRAPH expectation
LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
Proof-Before-Mutation
Live Owner Dominance
CURRENT_LIVE projection-only
physical sidecar backend
plugin runtime artifact path
plugin SHA
initializationCount=1
```

本轮不重写以上已经有正向 runtime 证据的主逻辑。

---

# 2. 当前最高优先级根因：Document Context 未 Ready

最新 runtime 出现：

```text
USER-INTENT-EPOCH:
documentKey=unknown
```

以及：

```text
EDITOR-MUTATION-BATCH:
documentKey=
```

以及：

```text
RECORD-LIFECYCLE:
documentKey=
```

同时 physical sidecar 写到了：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\inkchapter\paragraph-layout\.json
```

而不是：

```text
...\paragraph-layout\doc.md.json
```

这是 HARD FAIL。

---

# 3. Document Runtime Context

建立唯一 authoritative context：

```ts
interface DocumentRuntimeContext {
  vaultRoot: string | null;
  activeFilePath: string | null;
  documentKey: string | null;
  sessionId: string;
  ready: boolean;
  readyReason:
    | "READY"
    | "VAULT_MISSING"
    | "ACTIVE_FILE_MISSING"
    | "DOCUMENT_KEY_MISSING"
    | "FILE_OUTSIDE_VAULT";
}
```

---

# 4. Document Context Ready 条件

必须全部满足：

```text
vaultRoot != null
activeFilePath != null
documentKey != null
documentKey.trim() !== ""
activeFilePath is inside vaultRoot
```

才：

```text
ready=true
```

---

# 5. Document Context Firewall

以下所有业务动作必须先：

```text
assertDocumentContextReady()
```

包括：

```text
Canonical record create
Canonical record update
Canonical transfer
Canonical retire
Sidecar load
Sidecar write
Rehydrate
UserIntent business transaction
Special command
Split continuity
Merge continuity
Backspace reverse
Promotion
Caret expectation creation
```

---

# 6. Context Not Ready = NO-OP

如果：

```text
documentContext.ready=false
```

必须：

```text
DOCUMENT-CONTEXT-GATE:
ready=false
reason=...
decision=NO_OP
```

禁止：

```text
CREATE_NEW
REUSE_EXISTING
AWAIT_TRANSFER
TRANSFER
sidecar write
rehydrate
```

---

# 7. 禁止空 documentKey Sidecar

新增 hard invariant：

```text
documentKey == null
OR
documentKey.trim()===""
```

则：

```text
SIDECAR-ACTUAL-WRITE = 0
```

禁止任何：

```text
paragraph-layout\.json
```

---

# 8. Document Context 初始化顺序

正确顺序必须：

```text
plugin onload
↓
vault context ready
↓
file-open / active file resolved
↓
documentKey resolved
↓
DOCUMENT-CONTEXT-READY
↓
load sidecar
↓
bind business mutation pipeline
```

禁止：

```text
bind business mutation pipeline
↓
user input
↓
之后才拿到 documentKey
```

---

# 9. Document Context Trace

新增：

```text
DOCUMENT-CONTEXT-STATE:
vaultRoot=...
activeFilePath=...
documentKey=...
ready=true|false
reason=...
sessionId=...
```

---

# 10. Document Context Ready Event

必须有：

```text
DOCUMENT-CONTEXT-READY:
documentKey=doc.md
activeFilePath=...\doc.md
vaultRoot=...\test\vault
sessionId=...
decision=READY
```

只有这个 trace 出现后，允许业务 mutation。

---

# 11. 当前架构债：多个模块各自做 continuity 决策

当前存在：

```text
MutationObserver
Handoff
LiveReplacementTicket
Split resolver
Merge resolver
Backspace reverse
CaretExpectation
Rehydrate resolver
```

它们分别有自己的局部生命周期。

本轮不再增加新的独立 lifecycle object。

---

# 12. 建立唯一 ContinuityEngine

新增：

```ts
class ContinuityEngine {
  resolve(input: ContinuityInput): ContinuityPlan;
}
```

要求：

```text
PURE
DETERMINISTIC
NO SIDE EFFECT
```

---

# 13. ContinuityInput

```ts
interface ContinuityInput {
  documentKey: string;
  intent: UserIntentToken;
  mutationShape:
    | "NONE"
    | "REPLACE_1_TO_1"
    | "SPLIT_1_TO_2"
    | "MERGE_2_TO_1"
    | "COMPLEX";
  removed: ParagraphSnapshot[];
  added: ParagraphSnapshot[];
  canonicalOwners: CanonicalOwnerSnapshot[];
  selection: SelectionTruth;
}
```

---

# 14. ParagraphSnapshot

```ts
interface ParagraphSnapshot {
  runtimeId: string;
  element: HTMLElement;
  connected: boolean;
  ordinal: number | null;
  text: string;
  semanticMode:
    | "auto"
    | "force-indent"
    | "force-flush";
}
```

---

# 15. CanonicalOwnerSnapshot

```ts
interface CanonicalOwnerSnapshot {
  recordId: string;
  runtimeId: string;
  generation: number;
  state:
    | "CURRENT_LIVE"
    | "CURRENT_AWAITING_TRANSFER"
    | "CURRENT_RETIRED"
    | "PERSISTED_HISTORICAL";
  documentKey: string;
}
```

---

# 16. ContinuityPlan

统一：

```ts
type ContinuityPlan =
  | NoOpPlan
  | ReplacePlan
  | SplitPlan
  | MergeSingleOwnerPlan
  | MergeConflictPlan
  | BlockPlan;
```

---

# 17. Resolver 绝不能改状态

`ContinuityEngine.resolve()` 禁止调用：

```text
markAwaitingTransfer
canonicalTransferBinding
registerRecord
retireRecord
sidecar write
setSelection
apply visual class
```

它只能：

```text
read immutable snapshots
return plan
```

---

# 18. Registry 成为唯一 Mutation Authority

所有 canonical mutation 必须经过：

```ts
registry.commit(plan)
```

Service 层禁止直接修改：

```text
record.mode
record.temporary
record.anchor
record.runtimeId
record.generation
```

---

# 19. Registry Commit API

建议：

```ts
registry.commitReplace(plan)
registry.commitSplit(plan)
registry.commitMergeSingleOwner(plan)
registry.commitCreate(...)
registry.commitBackspaceUpdate(...)
registry.commitPromotion(...)
```

---

# 20. Registry Commit 必须重新验证 Preconditions

Registry commit 前检查：

```text
documentKey match
record state CURRENT_LIVE
generation match
destination unowned
source still valid
```

否则：

```text
REGISTRY-COMMIT-BLOCK
```

---

# 21. Merge 不再保留 Per-Owner Mutation

必须永久删除/禁用：

```text
for each canonical owner
→ markAwaiting
→ resolve
→ transfer
```

Merge 必须：

```text
batch snapshot
↓
pure resolve
↓
one plan
↓
one registry commit
```

---

# 22. Multi-Owner Merge

如果：

```text
canonicalOwners.length >= 2
```

ContinuityEngine 必须：

```text
MERGE_CONFLICT
BLOCK_MULTI_OWNER
```

然后 Registry：

```text
commit count=0
```

---

# 23. Multi-Owner Zero Mutation Invariant

必须：

```text
markAwaitingTransfer=0
canonicalTransferBinding=0
generation changes=0
record ownership changes=0
```

---

# 24. Split 继续保留现有业务语义

Split：

```text
canonicalOwner != caretDestination
```

继续 HARD FREEZE。

ContinuityEngine 只统一表达为：

```text
SplitPlan
```

而不是改算法。

---

# 25. CaretExpectation 降级为 CaretPlan

不要再继续扩张 Caret lifecycle。

改成：

```ts
interface CaretPlan {
  transactionId: string;
  expectedRuntimeId: string | null;
  expectedLogicalOffset: number | null;
  validUntilIntentEpoch: number;
  reason:
    | "SPECIAL_COMMAND"
    | "SPLIT"
    | "MERGE";
}
```

---

# 26. CaretPlan 来源

CaretPlan 必须由：

```text
business transaction result
或
ContinuityPlan
```

产生。

禁止 Caret 模块自行推断 canonical owner。

---

# 27. New Intent 自动使旧 CaretPlan 过期

如果：

```text
currentIntentEpoch
>
validUntilIntentEpoch
```

则：

```text
expired=true
```

不需要继续维护复杂：

```text
ACTIVE
SUPERSEDED
CLOSED
```

状态树。

---

# 28. Caret Verify 继续保留

现有：

```text
SELECTION-CONTINUITY-VERIFY
```

继续保留。

逻辑变为：

```text
CaretPlan valid
→ verify

CaretPlan expired
→ ignore
```

---

# 29. UserIntent 保留，但职责缩小

保留：

```text
intentId
epoch
source
dedup
```

它只负责回答：

```text
当前 transaction 是否已被更新 user intent 取代
```

它不能决定：

```text
canonical owner
sidecar record
merge winner
```

---

# 30. Session Overlay Persistence

当前持续写 canonical sidecar 的方案造成：

```text
大量 transient record
大量 historical ambiguity
sidecar recordCount 持续增长
```

本轮开始引入：

```text
Session Overlay
```

---

# 31. SessionParagraphOverride

```ts
interface SessionParagraphOverride {
  sessionRecordId: string;
  documentKey: string;
  runtimeId: string;
  mode:
    | "auto"
    | "force-indent"
    | "force-flush";
  generation: number;
}
```

---

# 32. 当前编辑 Session 优先使用 Overlay

当前 session：

```text
runtime paragraph
↔ session override
```

作为 live business truth。

Sidecar 不需要记录每一个 transient runtime mutation。

---

# 33. Sidecar 只在 Stable Boundary Snapshot

Stable boundary：

```text
file save
file close
document switch
explicit flush
plugin unload
```

此时：

```text
Session Overlay
+
current stable document structure
↓
build persisted snapshot
↓
write sidecar once
```

---

# 34. 禁止每次 transient mutation 立即 persistent write

以下事件禁止直接 persistent snapshot：

```text
temporary split
temporary empty paragraph
intermediate replacement
handoff
mutation batch
```

---

# 35. File Open Rehydrate 改成 One-Pass

正确：

```text
file-open
↓
document context ready
↓
load persisted snapshot
↓
one reconciliation pass
↓
build session overlay
↓
CURRENT SESSION starts
```

---

# 36. Current Session 禁止 Generic Historical Resolver

Session ready 后：

```text
historical generic candidate resolver
```

禁止参与：

```text
live edit continuity
```

只允许：

```text
file-open reconciliation
```

---

# 37. Refresh 只能 Visual Projection

当前 session 中：

```text
refresh
```

只能：

```text
read live overlay
↓
apply visual projection
```

不能重新跑 historical identity competition。

---

# 38. Single Dot Forensic 重新定义

当前：

```text
visibleText="。"
semantic=force-indent
```

不能自动等于：

```text
SINGLE_DOT_WRONG_APPLY
```

因为可能是一个合法 CURRENT_LIVE paragraph，
用户后来把正文删成 `。`。

---

# 39. SINGLE_DOT_WRONG_APPLY 正确定义

必须同时：

```text
visibleText=="。"
semanticBefore=="auto"
no exact CURRENT_LIVE ownership
non-auto record attempts apply
source is historical/rehydrate/candidate resolver
```

才：

```text
SINGLE_DOT_WRONG_APPLY
```

---

# 40. Runtime Identity 独立拆分

Runtime Identity 不应继续混在 paragraph continuity service 中。

独立：

```text
RuntimeDiagnosticsService
```

负责：

```text
plugin path
project artifact path
style path
SHA
Build ID
PID
window
active doc
vault
```

---

# 41. Project Artifact Path 当前错误

当前 runtime：

```text
projectMainPath=
D:\Typora\resources\dist\main.js
```

这是错误目标。

真正项目 artifact 应来自：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\main.js
```

---

# 42. Style Artifact Path

同样应指向项目 build：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\style.css
```

或项目实际构建输出路径。

禁止：

```text
D:\Typora\resources\dist\style.css
```

---

# 43. Native Typora Block Identity Forensic

本轮增加一个只读调查任务：

研究 Typora 是否存在：

```text
stable block ID
NodeMap ID
AST node ID
internal paragraph UID
```

---

# 44. Native Identity Investigation 只读

禁止在确认稳定性之前用于业务。

只输出：

```text
candidate property
location
split behavior
merge behavior
reload behavior
save behavior
stability verdict
```

---

# 45. Native Identity Acceptance

只有同时：

```text
same paragraph edit stable
split behavior deterministic
merge behavior deterministic
reload stable
document switch isolated
```

才允许以后考虑替代 CanonicalRecordId。

否则：

```text
DO NOT ADOPT
```

---

# 46. HARD FREEZE

本轮禁止重写：

```text
resolveSelectionTruth
Mutation Shape Authority
Split canonicalOwner/caretDestination rule
Proof-Before-Mutation
Live Owner Dominance
UserIntent dedup basic mechanism
SELECTION-CONTINUITY-VERIFY
physical sidecar backend
```

---

# 47. EditorTransactionCoordinator

建议新增：

```ts
class EditorTransactionCoordinator {
  begin(intent: UserIntentToken): EditorTransaction;
  capturePreState(...): void;
  captureMutationBatch(...): void;
  resolve(...): ContinuityPlan;
  commit(...): CommitResult;
  finalizeCaret(...): CaretPlan;
}
```

---

# 48. EditorTransaction

```ts
interface EditorTransaction {
  transactionId: string;
  documentKey: string;
  intent: UserIntentToken;
  preState: EditorSnapshot | null;
  mutationInput: ContinuityInput | null;
  continuityPlan: ContinuityPlan | null;
  committed: boolean;
}
```

---

# 49. Transaction Ownership

一次真实 user action：

```text
one intent
→ one editor transaction
```

后续 DOM mutation 属于同一个 transaction。

MutationObserver 不创建新的 business transaction。

---

# 50. Transaction Expiry

新 trusted user intent：

```text
old transaction expired
```

旧 transaction：

```text
不得 commit
不得 restore caret
不得 transfer owner
```

---

# 51. Document Context 与 Transaction 强绑定

Transaction creation：

```text
documentContext.ready=true
```

才允许。

Transaction 必须 snapshot：

```text
documentKey
sessionId
```

后续 commit 必须一致。

---

# 52. Phase A — Document Context Firewall

第一阶段只修：

```text
document context
sidecar path
business gate
```

不要同时重构 Merge/Caret。

---

# 53. Phase A Gate

只有以下全部通过：

```text
documentKey unknown business mutation = 0
empty sidecar filename = 0
doc.md context ready
doc.md.json load/write path correct
```

才进入 Phase B。

---

# 54. Phase B — Pure ContinuityEngine

只迁移：

```text
REPLACE
SPLIT
MERGE
```

到 pure resolver。

不改业务语义。

---

# 55. Phase B Gate

必须：

```text
same input → same plan
resolver side effects=0
multi-owner merge → MERGE_CONFLICT
split → canonicalOwner/caretDestination unchanged
```

---

# 56. Phase C — Registry Commit Firewall

所有 canonical mutation 必须收口。

---

# 57. Phase C Gate

必须：

```text
service direct record mutation=0
one successful plan → one commit
commit precondition recheck PASS
partial mutation=0
```

---

# 58. Phase D — CaretPlan Simplification

只有 A-C 稳定后才迁移 CaretExpectation。

---

# 59. Phase E — Session Overlay + Stable Snapshot

只有 continuity runtime 稳定后才迁 persistence。

禁止 Phase A 尚未通过就大改 sidecar model。

---

# 60. Phase F — Runtime Diagnostics Split

把：

```text
Build ID
SHA
PID
window
vault
doc
```

完全独立于 paragraph continuity。

---

# 61. Phase G — Native Identity Forensic

只调查，不采用。

---

# 62. Unit Test DC-1

```text
documentKey=""
```

执行 special command：

必须：

```text
canonical record create=0
sidecar write=0
DOCUMENT-CONTEXT-GATE NO_OP
```

---

# 63. Unit Test DC-2

```text
documentKey=null
```

Merge：

```text
ContinuityEngine not called
Registry commit=0
```

---

# 64. Unit Test DC-3

file-open ready：

```text
documentKey=doc.md
```

才允许：

```text
doc.md.json
```

---

# 65. Unit Test CE-1 Pure Resolver

同一 `ContinuityInput` 调用 100 次：

```text
same ContinuityPlan
```

且：

```text
registry state unchanged
```

---

# 66. Unit Test CE-2 Merge Multi Owner

输入：

```text
2 canonical owners
1 destination
```

输出必须：

```text
MERGE_CONFLICT
```

且 resolver 后：

```text
registry unchanged
```

---

# 67. Unit Test RC-1 Registry Commit

错误 generation：

```text
commit block
```

---

# 68. Unit Test RC-2 Destination Already Owned

```text
commit block
```

不能 partial mutation。

---

# 69. Runtime Acceptance A — Document Context

必须：

```text
DOCUMENT-CONTEXT-READY
documentKey=doc.md
```

之后才出现：

```text
USER-INTENT-EPOCH
CANONICAL-RECORD-COMMIT
SIDECAR-ACTUAL-WRITE
```

---

# 70. Runtime Acceptance B — Empty DocumentKey Zero

全日志：

```text
documentKey=unknown on business mutation = 0
documentKey="" on canonical lifecycle = 0
paragraph-layout\.json = 0
```

---

# 71. Runtime Acceptance C — ContinuityEngine

必须有：

```text
CONTINUITY-PLAN
```

例如：

```text
transactionId=...
shape=SPLIT_1_TO_2
plan=SPLIT
```

---

# 72. Runtime Acceptance D — Registry Commit

每个 successful plan：

```text
exactly one REGISTRY-COMMIT
```

---

# 73. Runtime Acceptance E — Merge Multi Owner

至少 5/5：

```text
plan=MERGE_CONFLICT
reason=BLOCK_MULTI_OWNER
registryCommit=0
awaiting=0
partialMutation=0
```

---

# 74. Runtime Acceptance F — Split

至少 10/10：

```text
plan=SPLIT
canonicalOwner correct
caretDestination correct
one registry commit
caretPlan expected=caretDestination
```

---

# 75. Runtime Acceptance G — New Intent Supersedes Old Transaction

至少：

```text
special → normal Enter
special → ArrowDown
special → pointer
```

必须：

```text
old transaction expired
old transaction commit=0
old caret restore=0
```

---

# 76. Runtime Acceptance H — File Save Snapshot

save 时：

```text
one stable snapshot write
```

document key：

```text
doc.md
```

path：

```text
...\paragraph-layout\doc.md.json
```

---

# 77. Runtime Acceptance I — File Reopen

重新打开：

```text
load persisted snapshot once
reconcile once
build session overlay
```

之后 live refresh：

```text
historical resolver call=0
```

---

# 78. Runtime Acceptance J — Identity Diagnostics

必须：

```text
projectMainPath=
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\main.js
```

以及真实：

```text
projectMainSha256
pluginMainSha256
shaMatch=true
styleSha256
```

---

# 79. Runtime Acceptance K — Strict Startup

必须完整 PASS。

否则：

```text
启动命令已发出，但尚未确认成功
```

---

# 80. Hard Stop List

任一出现：

```text
documentKey unknown 仍 create canonical record
documentKey="" 仍 sidecar write
paragraph-layout\.json
ContinuityEngine resolve 修改 registry
service 直接改 canonical record
Merge per-owner partial commit
multi-owner enters awaiting
one user action produces multiple registry commits
old transaction 在新 intent 后仍 commit
old caretPlan 在新 intent 后 restore
current session refresh 调 historical resolver
transient mutation 每次 persistent write
RUNTIME-IDENTITY-FINAL project path 指向 D:\Typora\resources\dist
project SHA unknown
shaMatch != true
strict startup mandatory missing
```

立即：

```text
R58.7 NOT FIXED — R60 BLOCKED
```

---

# 81. 禁止的假修复

禁止：

```text
只把 documentKey 日志从 unknown 改成 doc.md
硬编码 documentKey="doc.md"
sidecar .json 文件名硬拼 doc.md
继续增加新的 ticket
继续增加新的 timeout
Merge collision 后 rollback
继续让 service 直接修改 registry record
为了简化删除 SelectionTruth
为了简化删除 UserIntent dedup
把 historical resolver 完全删除
把 sidecar 完全删除
在未验证前采用 Typora internal NodeMap ID
硬编码 Project SHA
硬编码 shaMatch=true
```

---

# 82. 推荐修改范围

优先新增/拆分：

```text
src/runtime/document-runtime-context.ts
src/heading-numbering/editor-transaction-coordinator.ts
src/heading-numbering/continuity-engine.ts
src/heading-numbering/continuity-types.ts
src/runtime/runtime-diagnostics-service.ts
```

现有：

```text
src/heading-numbering/heading-numbering-service.ts
```

目标是：

```text
逐步减负
```

而不是继续塞更多 state。

---

# 83. Registry

```text
paragraph-canonical-registry.ts
```

本轮目标：

```text
成为唯一 canonical mutation authority
```

---

# 84. Sidecar Store

```text
paragraph-layout-store.ts
```

新增：

```text
stable snapshot write
```

并禁止：

```text
empty documentKey write
```

---

# 85. Build ID

本轮：

```text
inkchapter-r58-7-architecture-stabilization-<unique>
```

---

# 86. Build / Deploy

执行：

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1
```

记录：

```text
typecheck exit
tests
build exit
source Build ID
dist Build ID
deployed Build ID
project main SHA
plugin main SHA
style SHA
shaMatch
```

---

# 87. Restart

必须：

```text
restart Typora
↓
strict startup verify
↓
wait DOCUMENT-CONTEXT-READY
↓
open doc.md
↓
run acceptance
```

---

# 88. Strict Restart Rule

不能因为：

```text
restart script exit 0
```

就说启动成功。

必须验证：

```text
process
PID
StartTime
HWND
WindowTitle
vault
doc
plugin SHA
project SHA
style SHA
Build ID
initializationCount
```

否则：

```text
启动命令已发出，但尚未确认成功
```

---

# 89. 执行阶段顺序

严格：

```text
Phase A
Document Context Firewall
↓
Phase B
Pure ContinuityEngine
↓
Phase C
Registry Commit Firewall
↓
Phase D
CaretPlan Simplification
↓
Phase E
Session Overlay + Stable Snapshot
↓
Phase F
Runtime Diagnostics Split
↓
Phase G
Native Typora Identity Forensic
```

禁止多个 Phase 同时大改。

---

# 90. Final Report

必须输出：

```text
## 1. Current Ground Truth
## 2. Why R58.6.x Patch Strategy Stops Here
## 3. HARD FREEZE Confirmation
## 4. Document Context Root Cause
## 5. Current Empty documentKey Evidence
## 6. DocumentRuntimeContext
## 7. Document Context Firewall
## 8. Document Ready Ordering
## 9. Empty Sidecar Prevention
## 10. Current Continuity State-Machine Inventory
## 11. ContinuityEngine Design
## 12. ContinuityInput
## 13. ContinuityPlan
## 14. Pure Resolver Verification
## 15. Registry Mutation Audit
## 16. Registry Commit Firewall
## 17. Merge Multi-Owner Plan
## 18. Split Plan
## 19. CaretPlan Simplification
## 20. UserIntent Responsibility Boundary
## 21. EditorTransactionCoordinator
## 22. Transaction Expiry
## 23. Session Overlay Design
## 24. Stable Persistence Boundary
## 25. File-Open Reconciliation
## 26. Current-Session Historical Isolation
## 27. Single-Dot Forensic Redefinition
## 28. Runtime Diagnostics Separation
## 29. Project Artifact Path Fix
## 30. Native Typora Identity Investigation
## 31. Files Added
## 32. Files Changed
## 33. Build ID
## 34. Typecheck
## 35. Tests
## 36. Build
## 37. Deploy SHA
## 38. Strict Startup
## 39. Phase A Results
## 40. Phase B Results
## 41. Phase C Results
## 42. Phase D Results
## 43. Phase E Results
## 44. Runtime Acceptance
## 45. Regression
## 46. Hard Stop Counts
## 47. Remaining Known Issues
## 48. Final Verdict
```

---

# 91. Final Verdict

R58.7 允许阶段性 verdict：

```text
R58.7 PHASE A PASS — CONTINUE
```

```text
R58.7 PHASE B PASS — CONTINUE
```

整体最终只能：

```text
R58.7 FIXED — R58 GUI ACCEPTANCE CONTINUES
```

或者：

```text
R58.7 NOT FIXED — R60 BLOCKED
```

任何 mandatory：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

整体最终必须：

```text
R58.7 NOT FIXED — R60 BLOCKED
```

---

# 92. Execution Rules

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

用于审计。

禁止编造：

```text
documentKey
context ready
transaction ID
continuity plan
registry commit
sidecar snapshot
native block ID
plugin SHA
project SHA
style SHA
Build ID
PID
StartTime
HWND
WindowTitle
runtime acceptance
```

---

# 93. 第一执行动作

不要先改 Merge。

不要先改 Caret。

不要先改 Handoff。

第一步必须：

```text
Source Map:
Document Context
```

完整输出：

```text
vaultRoot 来源
activeFilePath 来源
documentKey 来源
file-open handler
editor-load handler
bindEditorRoot timing
loadDocumentContext()
ServiceDocSwitch
sidecar load
sidecar write
```

然后回答：

```text
为什么当前 R58.6.7 runtime
在 documentKey 尚未 ready 时
已经允许 business mutation 开始？
```

先修这个 root cause。

只有：

```text
Phase A PASS
```

之后才允许进入 ContinuityEngine 重构。
