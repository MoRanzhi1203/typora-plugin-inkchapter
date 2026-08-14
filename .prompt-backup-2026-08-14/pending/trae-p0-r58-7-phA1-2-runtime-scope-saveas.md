# TRAE P0 — R58.7 Phase A.1.2 Runtime Scope Propagation + Ephemeral Persistence Suppression + Save-As Promotion

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Runtime Scope Completion**
>
> Current authoritative status:
>
> ```text
> R58.7 PHASE A.1.1 FUNCTIONALLY FIXED
> R58.7 PHASE A.1.1 ACCEPTANCE INCOMPLETE
> R60 BLOCKED
> ```
>
> Current verified runtime build:
>
> ```text
> inkchapter-r58-7-phA1-1-editor-runtime-authority-m7n4p
> ```
>
> 当前 `Untitled → EPHEMERAL` 已经真实建立，
> `。。+Enter` 已经真实执行成功，
> Selection / Caret / Split 也已有正向 runtime 证据。
>
> 本轮禁止再次修改这些已修好的功能。
>
> 当前剩余问题已经非常明确：
>
> ```text
> DocumentRuntimeContext 已有：
> scopeId=untitled:<session>:<editor>
>
> 但 UserIntent / Mutation / Canonical Registry
> 仍大量输出：
> documentKey=unknown
> documentKey=""
>
> 同时 EPHEMERAL 虽然 physical sidecar write 已被底层阻止，
> 但业务层仍反复 schedule write，
> 最终触发 saveParagraphLayout("")
> 再由 store BLOCK。
> ```
>
> 因此当前处于：
>
> ```text
> Runtime Context 已迁移
> 但 Runtime Scope 尚未传播到底层
> ```
>
> 本轮只完成这件事，并完成：
>
> ```text
> EPHEMERAL → PERSISTED
> Save-As Promotion
> ```
>
> 不进入 ContinuityEngine。

---

# 0. 本轮目标

必须完成四件事：

```text
1. scopeId 成为当前 session 的 authoritative runtime namespace

2. scopeId 传播到：
   UserIntent
   Mutation Batch
   Canonical Registry
   Live Replacement Ticket
   Caret / Handoff diagnostics
   Runtime audits

3. EPHEMERAL persistenceReady=false 时：
   根本不 schedule persistent sidecar write

4. Untitled Save As 成真实文件时：
   EPHEMERAL → PERSISTED
   scopeId 不变
   CanonicalRecordId 不变
   live binding 不变
   只增加 persistenceKey
```

---

# 1. 当前 Runtime Ground Truth — 必须 HARD FREEZE

当前已真实通过：

```text
EDITOR-RUNTIME-BOUND

NO_EDITOR → EPHEMERAL 实际状态变化

DOCUMENT-CONTEXT-STATE:
mode=EPHEMERAL

scopeId=
untitled:<sessionId>:editor-1

businessReady=true

persistenceReady=false

DOCUMENT-CONTEXT-READY:
mode=EPHEMERAL

Untitled 中 `。。+Enter` 成功

ENTER-COMMIT-ATOMIC:
overallSuccess=true

POST-TOKEN-SELECTION:
sameAsCommand=true

CARET-EXPECTATION-CREATE

SELECTION-CONTINUITY-VERIFY:
MICROTASK verified=true

SELECTION-CONTINUITY-VERIFY:
RAF verified=true

SELECTION-CONTINUITY-VERIFY:
OBS verified=true

SPLIT_1_TO_2

canonicalOwner != caretDestination

LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH

SPLIT_NEW_PARAGRAPH expectation

UserIntent Backspace keydown + beforeinput dedup

HANDOFF-CLOSE:
SUPERSEDED_BY_USER_INTENT

pluginMainSha256
=
projectMainSha256

shaMatch=true

styleSha256 real

initializationCount=1
```

以上全部 HARD FREEZE。

---

# 2. 当前问题 A — `scopeId` 没有传播到底层

当前 Context：

```text
DOCUMENT-CONTEXT-STATE:
mode=EPHEMERAL
scopeId=untitled:session-...:editor-1
businessReady=true
persistenceReady=false
```

但是 UserIntent 仍：

```text
USER-INTENT-EPOCH:
documentKey=unknown
```

Mutation 仍：

```text
EDITOR-MUTATION-BATCH:
documentKey=
```

Registry 仍：

```text
RECORD-LIFECYCLE:
documentKey=
```

Live ticket 仍：

```text
LIVE-REPLACEMENT-TICKET:
documentKey=
```

这说明：

```text
DocumentRuntimeContext.scopeId
```

还没有成为 runtime identity authority。

---

# 3. Runtime Scope 与 Persistence Identity 必须正式分离

定义：

```text
scopeId
=
当前 editor session 的 runtime namespace

persistenceKey
=
磁盘持久化 namespace
```

对于 Untitled：

```text
scopeId=untitled:<session>:<editor>
persistenceKey=null
```

对于真实 doc.md：

```text
scopeId=<当前 editor runtime scope>
persistenceKey=doc.md
```

---

# 4. Canonical Identity Runtime Key

当前 session 内 canonical identity 必须按：

```text
(scopeId, CanonicalRecordId)
```

解释。

禁止继续使用：

```text
(documentKey="", CanonicalRecordId)
```

作为 EPHEMERAL runtime namespace。

---

# 5. Persisted Identity Key

只有 PERSISTED 时才存在：

```text
(persistenceKey, CanonicalRecordId)
```

用于：

```text
Sidecar
Persisted Snapshot
Historical Rehydrate
```

---

# 6. CanonicalRuntimeMeta 扩展

建议正式改成：

```ts
interface CanonicalRuntimeMeta {
  recordId: string;

  scopeId: string;

  persistenceKey: string | null;

  state: CanonicalRuntimeState;

  currentElement?: HTMLElement;

  currentRuntimeId?: string;

  previousRuntimeId?: string;

  generation: number;

  sessionId: string;
}
```

如果必须保留旧：

```ts
documentKey
```

用于兼容，
则它必须：

```text
DEPRECATED
```

并且不能作为 EPHEMERAL runtime authority。

---

# 7. EPHEMERAL Record Contract

Untitled 创建 record：

```text
recordId=R1

scopeId=untitled:session-...:editor-1

persistenceKey=null

state=CURRENT_LIVE

origin=current-session
```

---

# 8. Registry 所有 Current-Session API 必须带 scopeId

至少审计：

```text
registerCurrent

reuseExisting

markAwaitingTransfer

transfer

retire

promote

resolve live owner

lookup by runtimeId

bind element
```

必须确认不会跨 scope 操作。

---

# 9. UserIntent Propagation

当前：

```text
USER-INTENT-EPOCH:
documentKey=unknown
```

必须改为：

```text
USER-INTENT-EPOCH:
scopeId=untitled:...
persistenceKey=null
documentMode=EPHEMERAL
```

---

# 10. UserIntentToken 扩展

建议：

```ts
interface UserIntentToken {
  intentId: string;

  epoch: number;

  source: UserIntentSource;

  scopeId: string;

  persistenceKey: string | null;

  documentMode: "EPHEMERAL" | "PERSISTED";

  startedAt: number;

  eventType: string;

  trusted: boolean;
}
```

---

# 11. UserIntent Hard Gate

创建 intent 时：

```text
businessReady=true
scopeId non-empty
```

必须 snapshot：

```text
scopeId
```

之后同一 intent 不得偷偷变 scope。

---

# 12. Mutation Batch Propagation

当前：

```text
EDITOR-MUTATION-BATCH:
documentKey=
```

必须改为：

```text
EDITOR-MUTATION-BATCH:
scopeId=untitled:...
persistenceKey=null
documentMode=EPHEMERAL
```

---

# 13. Mutation Batch Context

建议：

```ts
interface MutationRuntimeContext {
  scopeId: string;

  persistenceKey: string | null;

  documentMode: "EPHEMERAL" | "PERSISTED";

  sessionId: string;
}
```

每个 MutationObserver batch 开始时 snapshot 一次。

---

# 14. LiveReplacementTicket Propagation

当前 ticket：

```text
documentKey=
```

必须：

```text
scopeId=<non-empty>
persistenceKey=null
```

---

# 15. Handoff Propagation

Handoff 至少记录：

```text
scopeId
intentEpoch
```

旧 handoff 若：

```text
handoff.scopeId != current scopeId
```

必须：

```text
CLOSE
reason=SCOPE_CHANGED
```

不能 transfer。

---

# 16. CaretExpectation Propagation

CaretExpectation 必须记录：

```text
scopeId
```

verify 时：

```text
expectation.scopeId
==
current context.scopeId
```

否则：

```text
close
reason=SCOPE_CHANGED
restoreAllowed=false
```

---

# 17. Canonical Record Trace

当前：

```text
RECORD-LIFECYCLE:
documentKey=
```

必须至少改成：

```text
RECORD-LIFECYCLE:
recordId=...
scopeId=untitled:...
persistenceKey=null
state=CURRENT_LIVE
runtimeId=P-RUNTIME-*
generation=...
```

---

# 18. Current Session Trace 禁止 `documentKey=unknown`

以下 current-session trace：

```text
USER-INTENT-EPOCH

EDITOR-MUTATION-BATCH

LIVE-REPLACEMENT-TICKET

RECORD-LIFECYCLE

CANONICAL-BINDING-TRANSFER

CARET-EXPECTATION-CREATE

HANDOFF
```

在 businessReady=true 时必须：

```text
scopeId non-empty
```

---

# 19. Deprecated documentKey Trace

如果为了兼容仍输出：

```text
documentKey
```

EPHEMERAL 时必须明确：

```text
persistenceKey=null
```

而不是误写：

```text
documentKey=unknown
```

建议彻底把 runtime diagnostic 改成：

```text
scopeId
persistenceKey
documentMode
```

---

# 20. 新 Runtime Scope Audit

新增：

```text
RUNTIME-SCOPE-AUDIT:
source=USER_INTENT|MUTATION|REGISTRY|TICKET|CARET|HANDOFF
scopeId=...
persistenceKey=...
mode=EPHEMERAL|PERSISTED
businessReady=true
valid=true|false
```

---

# 21. Scope Propagation Invariant

只要：

```text
businessReady=true
```

则：

```text
scopeId != null
scopeId.trim() !== ""
```

否则：

```text
RUNTIME-SCOPE-VIOLATION
decision=HARD_STOP
```

---

# 22. EPHEMERAL Scope Isolation

如果以后存在多个 Untitled editor：

```text
Untitled A:
scopeId=S1

Untitled B:
scopeId=S2
```

必须：

```text
S1 != S2
```

Registry live ownership 不得跨 scope。

本轮至少写 unit test，
不要求真实打开多窗口 GUI。

---

# 23. 当前问题 B — EPHEMERAL 仍然反复尝试 Sidecar Write

当前日志中多次：

```text
scheduleSidecarWrite()
↓
saveParagraphLayout("")
↓
SIDECAR-ACTUAL-WRITE:
source=BLOCKED
(empty documentKey, write prevented)
```

底层 Store 安全 guard 是正确的。

但 orchestration 是错误的。

---

# 24. 正确 Persistence Suppression

在：

```text
mode=EPHEMERAL
persistenceReady=false
```

时：

```text
scheduleSidecarWrite()
```

应该在业务层直接：

```text
SKIP
```

不得创建 timer。

---

# 25. scheduleSidecarWrite Gate

必须：

```ts
if (!documentContext.persistenceReady) {
  trace("SIDECAR-WRITE-SKIP", ...);
  return;
}
```

---

# 26. EPHEMERAL Skip Trace

必须：

```text
SIDECAR-WRITE-SKIP:
mode=EPHEMERAL
scopeId=untitled:...
persistenceKey=null
reason=PERSISTENCE_NOT_READY
decision=SKIP
```

---

# 27. Store Bottom Guard HARD FREEZE

`paragraph-layout-store.ts` 中：

```text
empty key write BLOCK
```

继续保留。

它是最后安全网。

但正常 EPHEMERAL 路径不得触发这个 guard。

---

# 28. EPHEMERAL Write Attempt Hard Gate

修复后完整日志：

```text
saveParagraphLayout("")
call count
= 0
```

以及：

```text
SIDECAR-ACTUAL-WRITE source=BLOCKED empty documentKey
= 0
```

---

# 29. flushSidecarWrite Gate

同样：

```text
flushSidecarWrite()
```

在：

```text
persistenceReady=false
```

时不得落到 store write。

必须：

```text
FLUSH-SKIP-EPHEMERAL
```

---

# 30. reconstructParagraphOverridesFromSidecar Gate

EPHEMERAL：

```text
reconstructParagraphOverridesFromSidecar()
```

必须：

```text
SKIP
```

不应该仅依赖 store 内部 empty key。

---

# 31. EPHEMERAL Historical Resolver Gate

完整日志：

```text
PERSISTED_HISTORICAL birth=0

historical candidate resolver call=0
```

---

# 32. 当前问题 C — 缺少显式 Transition / Business Allow Trace

当前状态变化虽然已发生：

```text
NO_EDITOR
→ EPHEMERAL
```

但没有要求中的：

```text
DOCUMENT-CONTEXT-TRANSITION
```

---

# 33. DOCUMENT-CONTEXT-TRANSITION

必须新增：

```text
DOCUMENT-CONTEXT-TRANSITION:
fromMode=NO_EDITOR
toMode=EPHEMERAL
scopeIdBefore=null
scopeIdAfter=untitled:...
persistenceKeyBefore=null
persistenceKeyAfter=null
reason=EDITOR_ROOT_BOUND
decision=TRANSITION
```

---

# 34. Business Gate Allow Trace

现在成功路径没有：

```text
DOCUMENT-BUSINESS-GATE ALLOW
```

必须对关键 caller 输出：

```text
DOCUMENT-BUSINESS-GATE:
caller=special-command
mode=EPHEMERAL
scopeId=untitled:...
businessReady=true
decision=ALLOW
```

---

# 35. Business Gate Trace Sampling

避免日志爆炸：

允许只对关键 transaction entry 输出：

```text
special-command

backspace-command

mutation-batch-start

promotion-command
```

不要求每个 helper 重复打印。

---

# 36. 当前问题 D — Save-As Promotion 尚未执行

本轮必须真实完成：

```text
Untitled
↓
Save As
↓
PERSISTED
```

---

# 37. Save-As Detection

必须基于：

```text
same editor runtime
same editorInstanceId
same scopeId

activeFilePath:
null
→ valid .md path
```

判断为：

```text
EPHEMERAL → PERSISTED
```

---

# 38. Save-As 不能被当成 Document Switch

这是最关键规则之一。

如果：

```text
same editor root
same editorInstanceId
old mode=EPHEMERAL
new activeFilePath valid
```

则：

```text
SAVE_AS_PROMOTION
```

不是：

```text
DOCUMENT_SWITCH
```

---

# 39. Save-As Transition Contract

例：

```text
before:
mode=EPHEMERAL
scopeId=S1
persistenceKey=null

after:
mode=PERSISTED
scopeId=S1
persistenceKey=untitled-test.md
```

必须：

```text
scopeIdSame=true
```

---

# 40. Save-As Promotion Trace

必须：

```text
DOCUMENT-CONTEXT-TRANSITION:
fromMode=EPHEMERAL
toMode=PERSISTED
scopeIdBefore=S1
scopeIdAfter=S1
scopeIdSame=true
persistenceKeyBefore=null
persistenceKeyAfter=untitled-test.md
activeFilePath=...\untitled-test.md
reason=SAVE_AS_PROMOTION
decision=PROMOTE_PERSISTENCE
```

---

# 41. Record IDs 必须保持不变

保存前：

```text
R1
R2
R3
```

保存后：

```text
R1
R2
R3
```

禁止：

```text
REGISTER_CURRENT new R4/R5/R6
```

替换原有 record。

---

# 42. Registry Save-As Promotion

建议新增明确 API：

```ts
registry.promoteScopeToPersistence({
  scopeId,
  persistenceKey,
});
```

职责：

```text
只为该 scope 当前 live/current records
补 persistenceKey

不改 recordId
不改 runtimeId
不改 generation
不改 state
```

---

# 43. Save-As Promotion 不得触发 Historical Rehydrate

因为当前 live state 已经存在。

所以同一 session Save As：

```text
load sidecar
historical reconcile
```

默认：

```text
0
```

---

# 44. Save-As 目标存在已有 Sidecar 的安全规则

如果保存目标：

```text
persistenceKey
```

已经存在 sidecar 数据，
本轮不要自动 merge historical records。

必须：

```text
SAVE-AS-PERSISTENCE-CONFLICT:
decision=BLOCK_OR_DEFER
```

并保持当前 live state。

禁止：

```text
自动 historical wins
```

对于正常验收请保存到一个全新文件名：

```text
untitled-test-<unique>.md
```

---

# 45. Save-As 后首次 Snapshot

Promotion 完成后：

```text
persistenceReady=true
```

允许一次：

```text
stable snapshot write
```

路径：

```text
...\paragraph-layout\untitled-test-<unique>.md.json
```

---

# 46. Snapshot Trace

必须：

```text
SIDECAR-PERSISTENCE-PROMOTION-WRITE:
scopeId=S1
persistenceKey=untitled-test-<unique>.md
recordCount=...
decision=WRITE_INITIAL_SNAPSHOT
```

---

# 47. Save-As 后继续 Live Editing

保存后继续：

```text
。。+Enter
normal Enter
Backspace
Split
Merge
```

必须继续使用：

```text
scopeId=S1
```

不能创建：

```text
新的 current-session scope
```

---

# 48. Save-As 后 UserIntent

必须变成：

```text
USER-INTENT-EPOCH:
scopeId=S1
persistenceKey=untitled-test.md
documentMode=PERSISTED
```

scopeId 不变。

---

# 49. Save-As 后 Mutation

必须：

```text
EDITOR-MUTATION-BATCH:
scopeId=S1
persistenceKey=untitled-test.md
documentMode=PERSISTED
```

---

# 50. Save-As 后 Registry

同一 record：

```text
R1
```

必须：

```text
scopeId=S1
persistenceKey=untitled-test.md
```

---

# 51. Existing Persisted `doc.md`

打开左侧真实：

```text
doc.md
```

继续保持：

```text
mode=PERSISTED
businessReady=true
persistenceReady=true
```

并且：

```text
persistenceKey=doc.md
```

---

# 52. Existing File 可以有新的 scopeId

如果从 Untitled 切到已有 doc.md：

这是：

```text
DOCUMENT_SWITCH
```

允许创建新的：

```text
scopeId
```

不能复用 Untitled scope。

---

# 53. Save-As 与 Document Switch 必须区分

Hard Rule：

```text
same editor runtime
EPHEMERAL→path
=
SAVE_AS_PROMOTION
scope stable

different file/editor context
=
DOCUMENT_SWITCH
scope changes
```

---

# 54. Scope Change 时旧 Transaction 必须失效

Document Switch：

```text
old transaction
old handoff
old caret expectation
```

必须：

```text
SCOPE_CHANGED
→ expire/close
```

---

# 55. EPHEMERAL Runtime Diagnostic 清理

本轮后禁止：

```text
businessReady=true
但 USER-INTENT documentKey=unknown
```

改为：

```text
scopeId=<real>
persistenceKey=null
```

---

# 56. Current Session `documentKey=""` Hard Gate

以下日志中：

```text
RECORD-LIFECYCLE
LIVE-REPLACEMENT-TICKET
CANONICAL-BINDING-TRANSFER
EDITOR-MUTATION-BATCH
```

不再使用空 `documentKey` 表示 runtime namespace。

---

# 57. Runtime Scope Invariant Audit

新增全局统计：

```text
RUNTIME-SCOPE-INVARIANT-AUDIT:
businessReady=true
eventsChecked=N
missingScopeCount=0
crossScopeMutationCount=0
decision=PASS
```

---

# 58. Cross-Scope Mutation Hard Stop

如果：

```text
record.scopeId != transaction.scopeId
```

禁止：

```text
reuse
transfer
promote
retire
```

输出：

```text
RUNTIME-SCOPE-VIOLATION:
reason=CROSS_SCOPE_MUTATION
decision=HARD_STOP
```

---

# 59. HARD FREEZE — Special Command

当前 Untitled：

```text
committed: token=。。
```

已有真实成功。

禁止修改：

```text
token detection
token removal
semantic write
visual write
caret write
Enter atomic transaction
```

---

# 60. HARD FREEZE — Selection/Caret

禁止修改：

```text
resolveSelectionTruth

POST-TOKEN-SELECTION

SELECTION-CONTINUITY-VERIFY

sameAsCommand

SPLIT_NEW_PARAGRAPH caret target
```

---

# 61. HARD FREEZE — Split

禁止修改：

```text
SPLIT_1_TO_2

canonicalOwner/caretDestination

LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

---

# 62. HARD FREEZE — Merge

本轮不继续修 Merge。

禁止重写：

```text
merge batch-first preflight
```

除非 scope propagation 编译需要字段适配。

---

# 63. HARD FREEZE — Runtime Identity

保持：

```text
pluginMainPath

projectMainPath=
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\main.js

pluginMainSha256
=
projectMainSha256

shaMatch=true

styleSha256 real

initializationCount=1
```

---

# 64. ASCII `..` 不在本轮处理

当前日志中曾出现：

```text
committed: token=..
```

本轮不要擅自修改。

只在 Final Report 标记：

```text
ASCII double-dot behavior = REQUIREMENT UNCONFIRMED
```

等待后续明确业务要求。

---

# 65. Source Map — Runtime Scope

修改前必须输出：

```text
DocumentRuntimeContext.scopeId
→ file/function

persistenceKey
→ file/function

UserIntent creation
→ file/function

Mutation batch creation
→ file/function

CanonicalRuntimeMeta creation
→ file/function

RECORD-LIFECYCLE logging
→ file/function

LiveReplacementTicket creation
→ file/function

CaretExpectation creation
→ file/function

Handoff creation
→ file/function
```

---

# 66. Source Map — Persistence Scheduling

必须输出：

```text
scheduleSidecarWrite
→ file/function

flushSidecarWrite
→ file/function

saveParagraphLayout
→ file/function

reconstructParagraphOverridesFromSidecar
→ file/function

file save event
→ file/function

file open event
→ file/function
```

---

# 67. Source Map — Save As

必须确认 Typora 当前可观测的：

```text
file:open
file:save
file:will-save
active-leaf:change
editor:load
active file path change
```

哪一个可以可靠识别：

```text
same editor:
null path → real path
```

必须基于实际 event/source，
禁止猜。

---

# 68. 修改前必须回答的根因问题

必须明确回答：

```text
为什么 DocumentRuntimeContext 已经有 scopeId，
但 UserIntent / Mutation / Registry
仍输出 documentKey=unknown/空？
```

必须定位到：

```text
旧字段读取点
旧 getDocumentKey()
旧函数参数
旧 registry meta
```

---

# 69. Unit Test SP-1 — UserIntent Scope

EPHEMERAL：

```text
scopeId=S1
```

创建 intent：

```text
intent.scopeId=S1
persistenceKey=null
```

---

# 70. Unit Test SP-2 — Mutation Scope

EPHEMERAL batch：

```text
batch.scopeId=S1
```

---

# 71. Unit Test SP-3 — Registry Scope

Create canonical：

```text
meta.scopeId=S1
```

---

# 72. Unit Test SP-4 — Cross Scope Block

Record：

```text
scopeId=S1
```

Transaction：

```text
scopeId=S2
```

必须：

```text
commit/reuse/transfer=false
```

---

# 73. Unit Test PS-1 — EPHEMERAL No Schedule

```text
persistenceReady=false
```

调用：

```text
scheduleSidecarWrite()
```

必须：

```text
timer created=0
store write called=0
```

---

# 74. Unit Test PS-2 — EPHEMERAL Flush

```text
flushSidecarWrite()
```

必须：

```text
store write=0
```

---

# 75. Unit Test SA-1 — Save-As Scope Stable

Before：

```text
mode=EPHEMERAL
scopeId=S1
```

After：

```text
mode=PERSISTED
scopeId=S1
```

---

# 76. Unit Test SA-2 — Record IDs Stable

Before：

```text
[R1,R2,R3]
```

After promotion：

```text
[R1,R2,R3]
```

---

# 77. Unit Test SA-3 — Generation Stable

Save-As 本身不得：

```text
generation++
```

除非真实 DOM continuity mutation 同时发生。

纯 persistence promotion：

```text
generation unchanged
```

---

# 78. Unit Test SA-4 — State Stable

Save-As：

```text
CURRENT_LIVE
→ CURRENT_LIVE
```

不能：

```text
PERSISTED_HISTORICAL
```

---

# 79. Unit Test SA-5 — Existing Sidecar Conflict

如果目标 sidecar 已存在：

```text
do not auto merge
```

输出 conflict/defer。

---

# 80. Runtime Acceptance RA1 — EPHEMERAL Scope Propagation

启动 Untitled 后执行：

```text
pointer
typing
。。+Enter
normal Enter
Backspace
```

必须全部：

```text
scopeId=<same S1>
```

---

# 81. Runtime Acceptance RA2 — Missing Scope Zero

全日志：

```text
businessReady=true
AND
missing scopeId
= 0
```

---

# 82. Runtime Acceptance RA3 — Current Runtime `documentKey=unknown` Zero

针对：

```text
UserIntent
Mutation
Registry
Ticket
Caret
Handoff
```

必须：

```text
documentKey=unknown
= 0
```

或者该字段彻底不再输出。

---

# 83. Runtime Acceptance RA4 — EPHEMERAL Persistence Suppression

Untitled 中至少执行 10 次 special command + 多次 split。

必须：

```text
scheduleSidecarWrite attempted while EPHEMERAL
→ SKIP trace

saveParagraphLayout("")
= 0

SIDECAR-ACTUAL-WRITE source=BLOCKED empty key
= 0

SIDECAR-ACTUAL-LOAD
= 0
```

---

# 84. Runtime Acceptance RA5 — Transition Audit

必须真实：

```text
DOCUMENT-CONTEXT-TRANSITION
NO_EDITOR → EPHEMERAL
```

至少 1 次。

---

# 85. Runtime Acceptance RA6 — Business Allow Audit

必须真实：

```text
DOCUMENT-BUSINESS-GATE
caller=special-command
mode=EPHEMERAL
decision=ALLOW
```

至少 10 次。

---

# 86. Runtime Acceptance RA7 — Save-As 3/3

每次：

```text
新建 Untitled
↓
创建至少 2 个 canonical override
↓
至少一次 split
↓
Save As 到全新 unique .md
```

必须：

```text
EPHEMERAL → PERSISTED
scopeIdSame=true
record IDs unchanged
generation unchanged due solely to save
CURRENT_LIVE retained
```

3/3。

---

# 87. Runtime Acceptance RA8 — Initial Snapshot 3/3

每次 Save-As：

```text
one initial sidecar snapshot
```

路径必须：

```text
...\paragraph-layout\<new-file>.md.json
```

不能：

```text
.json
untitled.json
unknown.json
```

---

# 88. Runtime Acceptance RA9 — Save-As 后继续编辑

保存后：

```text
。。+Enter
normal Enter
Backspace
```

必须继续：

```text
same scopeId
persistenceKey=<saved file>
```

至少 3 个 Save-As case。

---

# 89. Runtime Acceptance RA10 — Existing doc.md Regression

打开：

```text
doc.md
```

必须：

```text
mode=PERSISTED
businessReady=true
persistenceReady=true
persistenceKey=doc.md
```

并执行：

```text
。。+Enter
```

至少 5/5。

---

# 90. Runtime Acceptance RA11 — Physical Sidecar Safety

全日志：

```text
paragraph-layout\.json
= 0

empty persistence key physical write
= 0
```

---

# 91. Runtime Acceptance RA12 — Cross Scope Mutation

全日志：

```text
RUNTIME-SCOPE-VIOLATION
reason=CROSS_SCOPE_MUTATION
= 0
```

---

# 92. Strict Startup

每次 restart 仍必须验证：

```text
old Typora process exited

new PID

StartTime

MainWindowHandle != 0

MainWindowTitle nonempty

target vault

plugin main SHA

project main SHA

shaMatch=true

style SHA

Build ID

initializationCount=1
```

---

# 93. Untitled Active Doc Rule

如果启动时：

```text
Active Doc=""
```

只要：

```text
mode=EPHEMERAL
scopeId non-empty
businessReady=true
persistenceReady=false
```

则 Active Doc 空本身不是失败。

---

# 94. 严格启动措辞

任何 mandatory startup field 未验证：

```text
启动命令已发出，但尚未确认成功
```

---

# 95. Build ID

本轮必须更新：

```text
inkchapter-r58-7-phA1-2-runtime-scope-saveas-<unique>
```

禁止复用：

```text
m7n4p
```

---

# 96. Build ID Audit

必须：

```text
SOURCE
DIST
DEPLOYED
RUNTIME
REPORT
```

全部一致。

---

# 97. Build / Deploy

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
plugin SHA
project SHA
shaMatch
style SHA
Build ID
```

---

# 98. Restart + Acceptance 顺序

严格：

```text
restart
↓
strict startup
↓
Untitled
↓
RA1 scope propagation
↓
RA4 persistence suppression
↓
RA5/RA6 audit traces
↓
Save-As RA7/RA8/RA9
↓
existing doc.md RA10
↓
final log audit
```

---

# 99. Hard Stop List

任一出现：

```text
businessReady=true 但 scopeId missing

UserIntent 仍 documentKey=unknown

Mutation 仍 documentKey=""

Registry current record 仍没有 scopeId

Live ticket 没有 scopeId

record.scopeId != transaction.scopeId
仍 reuse/transfer

EPHEMERAL scheduleSidecarWrite 创建 timer

EPHEMERAL saveParagraphLayout("")

EPHEMERAL SIDECAR-ACTUAL-WRITE BLOCKED empty key 仍出现

EPHEMERAL historical rehydrate

Save-As scopeId 改变

Save-As recordId 重建

Save-As generation 无故增加

Save-As CURRENT_LIVE 变 historical

Save-As 被误判为 document switch

Save-As 自动加载目标已有 historical sidecar 并覆盖 live state

doc.md regression

plugin/project SHA mismatch

Build ID reuse

strict startup mandatory missing
```

立即：

```text
R58.7 PHASE A.1.2 NOT FIXED — R60 BLOCKED
```

---

# 100. 禁止的假修复

禁止：

```text
把 documentKey=unknown 文本改成 scopeId
但业务内部仍使用空 documentKey

硬编码 scopeId

用 persistenceKey 代替 scopeId

Untitled 写一个假 persistenceKey

Untitled 写 untitled.json

只在 paragraph-layout-store.ts BLOCK
而不阻止 scheduleSidecarWrite

保存时 clear registry

保存时 recreate records

保存时 rehydrate 当前 live document

保存时把 EPHEMERAL records 标成 PERSISTED_HISTORICAL

保存时重新生成 scopeId

为了通过日志把 empty write trace 删掉
但仍调用 saveParagraphLayout("")

修改 Special Command

修改 SelectionTruth

修改 Split resolver

提前进入 ContinuityEngine

提前做 Session Overlay full migration
```

---

# 101. 推荐修改范围

优先：

```text
src/runtime/document-runtime-context.ts

src/heading-numbering/heading-numbering-service.ts

src/heading-numbering/paragraph-canonical-registry.ts

src/heading-numbering/paragraph-layout-store.ts
```

可能需要小改：

```text
UserIntentToken type

LiveReplacementTicket type

CaretExpectation type

Handoff type
```

只增加：

```text
scopeId / persistenceKey
```

不要改它们业务算法。

---

# 102. 不进入 R58.7 Phase B

本轮完成前禁止开始：

```text
ContinuityEngine

Registry Commit Firewall full migration

CaretPlan rewrite

Session Overlay persistence redesign
```

本轮是：

```text
Phase A.1.2
```

不是 Phase B。

---

# 103. Final Report

必须输出：

```text
## 1. Current Ground Truth
## 2. HARD FREEZE Confirmation
## 3. Source Map — Runtime Scope
## 4. Source Map — Persistence Scheduling
## 5. Source Map — Save As
## 6. Exact Scope Propagation Root Cause
## 7. scopeId Authority
## 8. persistenceKey Authority
## 9. Canonical Runtime Namespace
## 10. Canonical Persisted Namespace
## 11. UserIntent Scope Propagation
## 12. Mutation Scope Propagation
## 13. Registry Scope Propagation
## 14. Live Ticket Scope Propagation
## 15. Caret/Handoff Scope Propagation
## 16. Runtime Scope Invariants
## 17. EPHEMERAL Persistence Suppression
## 18. scheduleSidecarWrite Gate
## 19. flushSidecarWrite Gate
## 20. Rehydrate Gate
## 21. DOCUMENT-CONTEXT-TRANSITION
## 22. DOCUMENT-BUSINESS-GATE ALLOW
## 23. Save-As Detection
## 24. Save-As vs Document Switch
## 25. EPHEMERAL→PERSISTED Promotion
## 26. scopeId Continuity
## 27. CanonicalRecordId Continuity
## 28. Generation Continuity
## 29. Initial Snapshot
## 30. Existing Sidecar Conflict Policy
## 31. Files Changed
## 32. Build ID
## 33. Build ID Audit
## 34. Typecheck
## 35. Tests
## 36. Build
## 37. Deploy SHA
## 38. Strict Startup
## 39. RA1 Scope Propagation
## 40. RA2 Missing Scope Zero
## 41. RA3 Unknown documentKey Zero
## 42. RA4 EPHEMERAL Persistence Suppression
## 43. RA5 Transition Audit
## 44. RA6 Business Allow Audit
## 45. RA7 Save-As 3/3
## 46. RA8 Initial Snapshot 3/3
## 47. RA9 Post-Save Editing
## 48. RA10 Existing doc.md
## 49. RA11 Sidecar Safety
## 50. RA12 Cross-Scope Safety
## 51. ASCII Double-Dot Requirement Status
## 52. Hard Stop Counts
## 53. Remaining Known Issues
## 54. Final Verdict
```

---

# 104. Final Verdict

只有所有 mandatory runtime gate 真实通过，
才允许：

```text
R58.7 PHASE A.1.2 PASS — PHASE A EPHEMERAL/PERSISTENCE MODEL CLOSED
```

然后才讨论：

```text
R58.7 Phase B
Pure ContinuityEngine
```

否则：

```text
R58.7 PHASE A.1.2 NOT FIXED — R60 BLOCKED
```

任何 mandatory：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

必须：

```text
R58.7 PHASE A.1.2 NOT FIXED — R60 BLOCKED
```

---

# 105. Execution Rules

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
scopeId
persistenceKey
Save-As event
Save-As transition
record IDs
generation
sidecar call count
cross-scope mutation
Build ID
SHA
PID
StartTime
HWND
WindowTitle
runtime acceptance count
```

---

# 106. 第一执行动作

不要先改代码。

先输出三组完整 Source Map：

```text
Runtime Scope
Persistence Scheduling
Save As
```

然后明确回答：

```text
为什么 Context 已经有 scopeId，
但 UserIntent / Mutation / Registry
仍然使用 documentKey=unknown/空？
```

以及：

```text
为什么 EPHEMERAL 已知 persistenceReady=false，
scheduleSidecarWrite() 仍然会走到
saveParagraphLayout("")？
```

最后确认：

```text
Typora 中哪个真实事件/状态变化
可以可靠识别
same editor:
EPHEMERAL(activeFilePath=null)
→
PERSISTED(activeFilePath=<saved .md>)
```

确认三点后再修改代码。

本轮只执行 Phase A.1.2。
