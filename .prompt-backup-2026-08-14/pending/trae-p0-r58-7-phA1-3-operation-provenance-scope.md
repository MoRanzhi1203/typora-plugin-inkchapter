# TRAE P0 — R58.7 Phase A.1.3 Operation Provenance + Save-As Classifier + Immutable Transition Snapshot + Scope Identity Completion

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Document Operation Provenance**
>
> Current authoritative status:
>
> ```text
> R58.7 PHASE A.1.2 NOT FIXED
> R60 BLOCKED
> ```
>
> Current runtime build:
>
> ```text
> inkchapter-r58-7-phA1-2-runtime-scope-saveas-w5h2t
> ```
>
> 本轮禁止进入 Phase B。
>
> 当前 Phase A.1.2 已经证明：
>
> ```text
> NO_EDITOR → EPHEMERAL
> businessReady=true
> persistenceReady=false
> scopeId=untitled:<session>:editor-1
> ```
>
> 是真实成立的。
>
> 同时：
>
> ```text
> UserIntent
> Mutation Batch
> ```
>
> 已经开始输出：
>
> ```text
> scopeId
> persistenceKey
> documentMode
> ```
>
> 但最新 runtime 又暴露了一个新的硬错误：
>
> ```text
> 打开已有 doc.md
> 被误判为
> SAVE_AS_PROMOTION
> ```
>
> 实际日志：
>
> ```text
> fromMode=EPHEMERAL
> toMode=PERSISTED
> scopeIdBefore=untitled:...
> scopeIdAfter=doc.md
> scopeIdSame=false
> reason=SAVE_AS_PROMOTION
> decision=PROMOTE_PERSISTENCE
> ```
>
> 随后又真实执行：
>
> ```text
> CANONICAL-BINDING-DOCUMENT-SWITCH
> SIDECAR-ACTUAL-LOAD doc.md.json
> PERSISTED_HISTORICAL load
> ```
>
> 这已经证明：
>
> ```text
> 实际动作 = 打开已有 document
> 不是 Save As
> ```
>
> 所以本轮核心原则：
>
> ```text
> EPHEMERAL → PERSISTED
> 本身不能作为 Save As 证据
> ```
>
> 必须引入：
>
> ```text
> Operation Provenance
> ```

---

# 0. 本轮只修四件事

```text
1. 引入明确 Save/Save-As provenance

2. 正确区分：
   SAVE_AS_PROMOTION
   DOCUMENT_SWITCH

3. Transition 使用 immutable before/after snapshot

4. scopeId 真正进入：
   Canonical Registry
   LiveReplacementTicket
   CaretExpectation
   Handoff
   Canonical transfer guards
```

禁止继续扩大范围。

---

# 1. 当前 Runtime Ground Truth — HARD FREEZE

以下当前已有正向 runtime 证据：

```text
EDITOR-RUNTIME-BOUND

NO_EDITOR → EPHEMERAL

DOCUMENT-CONTEXT-STATE:
mode=EPHEMERAL

scopeId=untitled:session-...:editor-1

businessReady=true

persistenceReady=false

DOCUMENT-CONTEXT-READY

DOCUMENT-PERSISTENCE-GATE:
rehydrate-sidecar
SKIP_EPHEMERAL

UserIntent persisted trace:
scopeId=doc.md
persistenceKey=doc.md
documentMode=PERSISTED

Mutation persisted trace:
scopeId=doc.md
persistenceKey=doc.md
documentMode=PERSISTED

plugin SHA == project SHA

shaMatch=true

style SHA real

initializationCount=1

Persisted doc.md `。。+Enter` success

SelectionTruth

Caret verify

Split continuity

Merge batch-first
```

这些全部 HARD FREEZE。

---

# 2. 当前 P0-A — Save-As Classifier 错误

最新真实日志：

```text
readContentFrom
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\doc.md
```

紧接：

```text
DOCUMENT-CONTEXT-TRANSITION:
fromMode=EPHEMERAL
toMode=PERSISTED
scopeIdBefore=untitled:...
scopeIdAfter=doc.md
scopeIdSame=false
reason=SAVE_AS_PROMOTION
decision=PROMOTE_PERSISTENCE
```

这是硬错误。

---

# 3. 为什么这是 Document Switch

随后真实：

```text
CANONICAL-BINDING-DOCUMENT-SWITCH

SIDECAR-ACTUAL-LOAD:
documentKey=doc.md

PERSISTED_LOAD:
state=PERSISTED_HISTORICAL
```

因此正确语义：

```text
Untitled
→ 打开已有 doc.md
=
DOCUMENT_SWITCH
```

不是：

```text
SAVE_AS_PROMOTION
```

---

# 4. 当前错误分类规则必须删除

禁止继续：

```ts
if (
  before.mode === "EPHEMERAL" &&
  after.mode === "PERSISTED"
) {
  return "SAVE_AS_PROMOTION";
}
```

因为：

```text
打开已有文件
```

也会产生同样的：

```text
EPHEMERAL → PERSISTED
```

---

# 5. Same Editor Runtime 也不是 Save-As 证据

最新日志显示：

```text
editorInstanceId=editor-1
```

在打开 doc.md 后仍可保持不变。

因此：

```text
same editorRoot
same editorInstanceId
```

只能说明：

```text
Typora 复用了 editor runtime
```

不能说明：

```text
用户执行了 Save As
```

---

# 6. 新核心：Operation Provenance

新增：

```ts
type DocumentOperationKind =
  | "NONE"
  | "SAVE"
  | "SAVE_AS"
  | "OPEN_EXISTING"
  | "DOCUMENT_SWITCH";
```

---

# 7. PendingPersistencePromotion

新增：

```ts
interface PendingPersistencePromotion {
  promotionId: string;

  scopeId: string;

  editorInstanceId: string;

  source:
    | "FILE_WILL_SAVE"
    | "SAVE_COMMAND"
    | "SAVE_AS_COMMAND"
    | "CONFIRMED_PERSISTENCE_SIGNAL";

  targetPath: string | null;

  createdAt: number;

  consumed: boolean;
}
```

---

# 8. Save-As 不能由 `file:open` 自己推断

正确：

```text
真实 Save/Save-As 信号
↓
创建 PendingPersistencePromotion
↓
后续 file/path change
↓
consume pending promotion
↓
才允许 SAVE_AS_PROMOTION
```

---

# 9. `file:open` 只能消费，不负责创建 Promotion

禁止：

```text
file:open
看到 EPHEMERAL → PERSISTED
直接判断 SAVE_AS
```

必须：

```text
if matching pending promotion exists
→ SAVE_AS_PROMOTION

else
→ DOCUMENT_SWITCH
```

---

# 10. 未找到真实 Save 信号时默认安全策略

如果无法可靠确定：

```text
Save As provenance
```

必须：

```text
DO NOT PROMOTE
```

而是：

```text
DOCUMENT_SWITCH
```

禁止“猜 Save As”。

---

# 11. Source Map — Save Operation Provenance

修改前必须输出：

```text
workspace file:will-save
→ file/function

workspace file:save
→ file/function

save command
→ file/function

save-as command
→ file/function

file:open
→ file/function

active-leaf:change
→ file/function

onFilePathUpdated / active file resolver
→ file/function
```

---

# 12. 必须确认真实可用事件

必须通过现有 core/workspace API 查清楚：

```text
哪个事件在 Untitled Save As 前发生
```

候选：

```text
file:will-save

file:save

command invocation

active path change
```

禁止仅凭假设。

---

# 13. Pending Promotion Create Trace

必须：

```text
PERSISTENCE-PROMOTION-PENDING:
promotionId=...
scopeId=S1
editorInstanceId=editor-1
source=FILE_WILL_SAVE|SAVE_AS_COMMAND|...
targetPath=...
decision=CREATE
```

---

# 14. Pending Promotion Consume Trace

必须：

```text
PERSISTENCE-PROMOTION-CONSUME:
promotionId=...
scopeId=S1
targetPath=...
decision=MATCH
```

---

# 15. Pending Promotion Miss Trace

如果：

```text
EPHEMERAL → PERSISTED
```

但没有匹配 pending promotion：

```text
PERSISTENCE-PROMOTION-MISS:
scopeIdBefore=S1
afterPath=...
decision=DOCUMENT_SWITCH
```

---

# 16. Save-As Promotion 判定

只有全部：

```text
before.mode=EPHEMERAL

after.mode=PERSISTED

pending promotion exists

pending.scopeId == before.scopeId

pending.editorInstanceId == current editorInstanceId

targetPath matches after.activeFilePath
```

才：

```text
SAVE_AS_PROMOTION
```

---

# 17. Document Switch 判定

任一：

```text
no pending promotion

scope mismatch

editor mismatch

target path mismatch

opening existing file
```

则：

```text
DOCUMENT_SWITCH
```

---

# 18. Case A — 打开已有 doc.md

当前日志场景必须变成：

```text
DOCUMENT-CONTEXT-TRANSITION:
fromMode=EPHEMERAL
toMode=PERSISTED
scopeIdBefore=S1
scopeIdAfter=<new doc scope>
scopeIdSame=false
persistenceKeyBefore=null
persistenceKeyAfter=doc.md
reason=DOCUMENT_SWITCH
decision=SWITCH_DOCUMENT
```

---

# 19. Case A 禁止出现

```text
reason=SAVE_AS_PROMOTION
```

必须：

```text
count=0
```

---

# 20. Case A 后允许 Historical Load

因为是真正 document switch：

```text
SIDECAR-ACTUAL-LOAD doc.md.json
```

允许。

---

# 21. 当前 P0-B — Transition Before Snapshot 被污染

最新日志：

```text
fromMode=EPHEMERAL
```

却：

```text
persistenceKeyBefore=doc.md
```

这是不可能的真实前态。

EPHEMERAL 应：

```text
persistenceKeyBefore=null
```

---

# 22. Root Cause 必须定位

修改前必须回答：

```text
为什么 before.mode 还是 EPHEMERAL，
但 before.persistenceKey 已经变成 doc.md？
```

必须定位到：

```text
mutable shared object

or
mutation ordering

or
loadDocumentContext() side effect
```

不能只说“trace bug”。

---

# 23. Immutable Context Snapshot

新增：

```ts
interface DocumentRuntimeSnapshot {
  mode: DocumentRuntimeMode;

  scopeId: string | null;

  persistenceKey: string | null;

  activeFilePath: string | null;

  editorInstanceId: string | null;

  businessReady: boolean;

  persistenceReady: boolean;

  sessionId: string;
}
```

---

# 24. Snapshot Function

必须：

```ts
snapshotDocumentRuntimeContext(ctx)
```

返回：

```text
plain immutable value object
```

禁止返回原对象引用。

---

# 25. 正确 Transition 流程

必须：

```text
before = immutable snapshot(current context)
↓
resolve candidate after
↓
after = immutable snapshot(candidate)
↓
classify operation(before, after, provenance)
↓
commit context
↓
emit trace(before, after)
```

---

# 26. 禁止错误顺序

禁止：

```text
mutate current context
↓
再读取 before
```

---

# 27. Transition Trace Invariant

如果：

```text
fromMode=EPHEMERAL
```

则必须：

```text
persistenceKeyBefore=null
```

除非有明确特殊 legacy state，
否则 HARD FAIL。

---

# 28. Transition Snapshot Audit

新增：

```text
DOCUMENT-CONTEXT-SNAPSHOT-AUDIT:
beforeMode=...
beforeScopeId=...
beforePersistenceKey=...
afterMode=...
afterScopeId=...
afterPersistenceKey=...
valid=true|false
```

---

# 29. 当前 P0-C — scopeId 只迁了部分 Trace

当前已有：

```text
USER-INTENT-EPOCH:
scopeId=doc.md

EDITOR-MUTATION-BATCH:
scopeId=doc.md
```

但是：

```text
LIVE-REPLACEMENT-TICKET:
documentKey=doc.md
```

以及：

```text
RECORD-LIFECYCLE:
documentKey=doc.md
```

仍是旧模型。

---

# 30. Registry Current-Session Identity 必须真正改用 scopeId

目标：

```text
(scopeId, CanonicalRecordId)
```

---

# 31. Persisted Historical Identity 继续保留 persistenceKey

PERSISTED_HISTORICAL：

```text
persistenceKey=doc.md
```

可以继续。

但 current-session：

```text
scopeId
```

必须是 authority。

---

# 32. CanonicalRuntimeMeta

必须至少变成：

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

---

# 33. Registry Current API Scope Guard

以下必须验证：

```text
register current

reuse

transfer

await

retire

promotion
```

都有：

```text
scopeId match
```

---

# 34. Cross Scope Hard Stop

如果：

```text
record.scopeId != current transaction.scopeId
```

则：

```text
CANONICAL-SCOPE-MISMATCH:
decision=HARD_STOP
```

禁止 mutation。

---

# 35. RECORD-LIFECYCLE Trace

Current-session：

```text
RECORD-LIFECYCLE:
recordId=...
scopeId=...
persistenceKey=...
state=CURRENT_LIVE|CURRENT_AWAITING_TRANSFER
runtimeId=...
generation=...
origin=current-session
```

---

# 36. PERSISTED_LOAD Trace

Persisted：

```text
RECORD-LIFECYCLE:
event=PERSISTED_LOAD
scopeId=<current persisted runtime scope or persisted namespace marker>
persistenceKey=doc.md
state=PERSISTED_HISTORICAL
```

---

# 37. LiveReplacementTicket

必须增加：

```ts
scopeId: string;
persistenceKey: string | null;
```

---

# 38. Ticket Scope Guard

resolve 前：

```text
ticket.scopeId == current scopeId
```

否则：

```text
LIVE-REPLACEMENT-TICKET-CLOSE:
reason=SCOPE_CHANGED
decision=CLOSE
```

---

# 39. Handoff Scope

必须：

```text
handoff.scopeId
```

resolve 前 scope match。

---

# 40. CaretExpectation Scope

必须：

```text
expectation.scopeId
```

verify 前：

```text
expectation.scopeId == current scopeId
```

否则：

```text
CARET-EXPECTATION-CLOSE:
reason=SCOPE_CHANGED
restoreAttempted=false
```

---

# 41. UserIntent Scope 已有正向证据，HARD FREEZE

不要重写 UserIntent capture。

只确保：

```text
scope snapshot
```

继续正确。

---

# 42. Mutation Scope 已有正向证据，HARD FREEZE

不要重写 Mutation Shape。

只确保：

```text
scopeId
persistenceKey
documentMode
```

继续存在。

---

# 43. 当前 P0-D — EPHEMERAL Persistence Suppression 仍未真实验收

本轮必须真实执行：

```text
Untitled
↓
至少 2 次 `。。+Enter`
```

然后检查：

```text
SIDECAR-WRITE-SKIP
```

---

# 44. EPHEMERAL Persistence Gate

必须：

```text
scheduleSidecarWrite()
→ SKIP
```

而不是：

```text
timer
→ flush
→ store BLOCK
```

---

# 45. Required Trace

```text
SIDECAR-WRITE-SKIP:
mode=EPHEMERAL
scopeId=S1
persistenceKey=null
reason=PERSISTENCE_NOT_READY
decision=SKIP
```

---

# 46. EPHEMERAL Hard Counts

必须：

```text
saveParagraphLayout("")
= 0

SIDECAR-ACTUAL-WRITE source=BLOCKED empty key
= 0

SIDECAR-ACTUAL-LOAD
= 0

PERSISTED_HISTORICAL birth
= 0
```

---

# 47. Case B — 真正 Save As

必须真实执行：

```text
新建 Untitled
↓
2 次以上 `。。+Enter`
↓
至少一次 Split
↓
Save As:
untitled-saveas-<unique>.md
```

---

# 48. Case B Before

必须：

```text
mode=EPHEMERAL

scopeId=S1

persistenceKey=null
```

---

# 49. Case B Pending Evidence

Save As 前必须看到：

```text
PERSISTENCE-PROMOTION-PENDING
```

---

# 50. Case B After

必须：

```text
mode=PERSISTED

scopeId=S1

persistenceKey=untitled-saveas-<unique>.md
```

---

# 51. Save-As Transition Trace

必须：

```text
DOCUMENT-CONTEXT-TRANSITION:
fromMode=EPHEMERAL
toMode=PERSISTED
scopeIdBefore=S1
scopeIdAfter=S1
scopeIdSame=true
persistenceKeyBefore=null
persistenceKeyAfter=untitled-saveas-<unique>.md
reason=SAVE_AS_PROMOTION
decision=PROMOTE_PERSISTENCE
```

---

# 52. Registry Save-As Promotion

同一 live records：

```text
record IDs unchanged
runtime IDs unchanged
generation unchanged
state CURRENT_LIVE
```

---

# 53. Save-As 不得触发 Document Switch

Case B 中：

```text
CANONICAL-BINDING-DOCUMENT-SWITCH
```

针对当前 EPHEMERAL scope：

```text
count=0
```

---

# 54. Save-As 不得 Historical Rehydrate 当前 Live

Case B：

```text
PERSISTED_HISTORICAL
```

不得用于替换当前 EPHEMERAL live records。

---

# 55. Save-As Initial Snapshot

Promotion 后允许：

```text
one initial sidecar snapshot
```

路径：

```text
...\paragraph-layout\untitled-saveas-<unique>.md.json
```

---

# 56. Initial Snapshot Trace

必须：

```text
SIDECAR-PERSISTENCE-PROMOTION-WRITE:
scopeId=S1
persistenceKey=untitled-saveas-<unique>.md
recordCount=...
decision=WRITE_INITIAL_SNAPSHOT
```

---

# 57. Save-As Existing Target Conflict

如果目标已有 sidecar：

```text
SAVE-AS-PERSISTENCE-CONFLICT
decision=BLOCK_OR_DEFER
```

不要自动 merge historical。

验收使用全新 unique 文件名。

---

# 58. Case C — 打开已有 doc.md

独立执行：

```text
新建 Untitled
↓
不要保存
↓
点击左侧已有 doc.md
```

---

# 59. Case C Expected

必须：

```text
reason=DOCUMENT_SWITCH

scopeIdSame=false

SIDECAR-ACTUAL-LOAD doc.md.json
```

---

# 60. Case C Forbidden

必须：

```text
SAVE_AS_PROMOTION = 0
```

---

# 61. Operation Classification Table

必须实现清晰表：

| Before | Provenance | After | Decision |
|---|---|---|---|
| EPHEMERAL | matching save evidence | PERSISTED | SAVE_AS_PROMOTION |
| EPHEMERAL | no save evidence | PERSISTED | DOCUMENT_SWITCH |
| PERSISTED A | open B | PERSISTED B | DOCUMENT_SWITCH |
| PERSISTED same path | save | PERSISTED same | SAVE |
| NO_EDITOR | open file | PERSISTED | DOCUMENT_OPEN |
| NO_EDITOR | editor only | EPHEMERAL | EDITOR_OPEN |

---

# 62. `refreshDocumentContext()` 不再决定用户操作

它只负责：

```text
resolve state
```

不能：

```text
guess operation
```

Operation classification 应单独：

```ts
classifyDocumentTransition(
  before,
  after,
  provenance
)
```

---

# 63. Document Transition Result

建议：

```ts
interface DocumentTransitionDecision {
  kind:
    | "NONE"
    | "EDITOR_OPEN"
    | "DOCUMENT_OPEN"
    | "DOCUMENT_SWITCH"
    | "SAVE"
    | "SAVE_AS_PROMOTION";

  reason: string;

  preserveScope: boolean;

  allowHistoricalLoad: boolean;

  allowPersistencePromotion: boolean;
}
```

---

# 64. SAVE_AS_PROMOTION Decision

必须：

```text
preserveScope=true
allowHistoricalLoad=false
allowPersistencePromotion=true
```

---

# 65. DOCUMENT_SWITCH Decision

必须：

```text
preserveScope=false
allowHistoricalLoad=true
allowPersistencePromotion=false
```

---

# 66. Current `scopeId=doc.md` 设计要谨慎

对于 PERSISTED current session，
不要再把：

```text
scopeId == persistenceKey
```

当成硬规则。

建议 PERSISTED runtime 仍保留独立 scope：

```text
docscope:<session>:<editor>:<counter>
```

而：

```text
persistenceKey=doc.md
```

单独保存。

否则：

```text
同文件多 editor/session
```

会再次混淆 runtime/persistence identity。

---

# 67. 本轮是否改 persisted scope format

如果当前改动风险过大：

```text
本轮可以暂时保留 persisted scopeId=doc.md
```

但必须在 Final Report 明确：

```text
TEMPORARY COMPATIBILITY
```

不能宣称 runtime/persistence identity 已完全解耦。

最低要求：

```text
EPHEMERAL current records
必须有真实 scopeId
```

---

# 68. HARD FREEZE — Special Command

禁止修改：

```text
`。。+Enter`
token recognition
commit
caret
```

---

# 69. HARD FREEZE — Selection/Caret Core

禁止修改：

```text
resolveSelectionTruth

sameAsCommand

SELECTION-CONTINUITY-VERIFY

caret restore
```

只增加：

```text
scope guard
```

---

# 70. HARD FREEZE — Split

禁止修改：

```text
SPLIT_1_TO_2
canonicalOwner
caretDestination
LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

---

# 71. HARD FREEZE — Merge

禁止修改 merge algorithm。

---

# 72. HARD FREEZE — Historical Resolver

本轮不清理 doc.md 66+ historical pollution。

继续：

```text
BLOCK ambiguous
```

即可。

---

# 73. HARD FREEZE — Runtime Identity

保持：

```text
plugin SHA
project SHA
shaMatch=true
style SHA
Build ID
initializationCount
```

---

# 74. SyntaxError 继续隔离

当前：

```text
SyntaxError: Unexpected token ')'
```

仍然单独记录。

本轮不把它和 Save-As classifier 混在一起。

---

# 75. Build ID

必须更新为：

```text
inkchapter-r58-7-phA1-3-operation-provenance-scope-<unique>
```

---

# 76. Unit Test OP-1

输入：

```text
before=EPHEMERAL
after=PERSISTED
pendingPromotion=null
```

必须：

```text
DOCUMENT_SWITCH
```

---

# 77. Unit Test OP-2

输入：

```text
before=EPHEMERAL
after=PERSISTED
matching pending promotion
```

必须：

```text
SAVE_AS_PROMOTION
```

---

# 78. Unit Test OP-3

pending target mismatch：

```text
DOCUMENT_SWITCH
```

---

# 79. Unit Test OP-4

pending scope mismatch：

```text
DOCUMENT_SWITCH
```

并 close invalid promotion。

---

# 80. Unit Test SNAP-1

before：

```text
EPHEMERAL
persistenceKey=null
```

after resolve：

```text
PERSISTED
persistenceKey=doc.md
```

必须：

```text
before.persistenceKey
仍 null
```

---

# 81. Unit Test SNAP-2

mutation after snapshot 不得改变 before。

---

# 82. Unit Test SCOPE-1

Current record：

```text
scopeId=S1
```

ticket：

```text
scopeId=S1
```

transfer：

```text
ALLOW
```

---

# 83. Unit Test SCOPE-2

Current record：

```text
scopeId=S1
```

ticket：

```text
scopeId=S2
```

必须：

```text
BLOCK
```

---

# 84. Unit Test SCOPE-3

Caret expectation scope mismatch：

```text
restore=0
close=SCOPE_CHANGED
```

---

# 85. Unit Test SCOPE-4

Handoff scope mismatch：

```text
transfer=0
close=SCOPE_CHANGED
```

---

# 86. Runtime Acceptance A — Existing doc Open

至少 3/3：

```text
Untitled
→ click existing doc.md
```

必须：

```text
DOCUMENT_SWITCH
SAVE_AS_PROMOTION=0
```

---

# 87. Runtime Acceptance B — Real Save-As

至少 3/3：

```text
Untitled
→ create live overrides
→ Save As unique file
```

必须：

```text
matching pending promotion
SAVE_AS_PROMOTION
scopeIdSame=true
record IDs same
generation same
```

---

# 88. Runtime Acceptance C — Immutable Snapshot

全日志：

```text
fromMode=EPHEMERAL
AND
persistenceKeyBefore != null
= 0
```

---

# 89. Runtime Acceptance D — Scope Propagation

Current-session events：

```text
RECORD-LIFECYCLE

LIVE-REPLACEMENT-TICKET

CARET-EXPECTATION

HANDOFF

CANONICAL-BINDING-TRANSFER
```

必须：

```text
scopeId non-empty
```

---

# 90. Runtime Acceptance E — Cross Scope Zero

```text
CANONICAL-SCOPE-MISMATCH
= 0
```

正常路径中为 0。

必须有 unit test 覆盖 BLOCK。

---

# 91. Runtime Acceptance F — EPHEMERAL Persistence

Untitled 至少：

```text
2 次 special
1 次 split
```

必须：

```text
SIDECAR-WRITE-SKIP >= 1

saveParagraphLayout("") = 0

SIDECAR-ACTUAL-WRITE empty key = 0
```

---

# 92. Runtime Acceptance G — Save-As Snapshot

每个真实 Save-As：

```text
one initial snapshot
```

路径正确。

---

# 93. Runtime Acceptance H — Persisted Regression

打开：

```text
doc.md
```

执行：

```text
。。+Enter
normal Enter
Backspace
```

必须继续工作。

---

# 94. Runtime Acceptance I — Historical Safety

doc.md：

```text
ambiguous historical groups
→ BLOCK
```

继续保持。

---

# 95. Strict Startup

每次 restart 必须真实验证：

```text
old process exit

new PID

StartTime

MainWindowHandle != 0

MainWindowTitle nonempty

target vault

plugin SHA

project SHA

shaMatch=true

style SHA

Build ID

initializationCount=1
```

---

# 96. Startup Incomplete

任一 mandatory 未验证：

```text
启动命令已发出，但尚未确认成功
```

---

# 97. Hard Stop List

任一：

```text
EPHEMERAL→PERSISTED 无 provenance
仍判 SAVE_AS

打开已有 doc.md
reason=SAVE_AS_PROMOTION

scopeIdSame=false
却判 SAVE_AS_PROMOTION

fromMode=EPHEMERAL
但 persistenceKeyBefore 非 null

before snapshot 被 after mutation 污染

Registry current record 无 scopeId

LiveReplacementTicket 无 scopeId

CaretExpectation 无 scopeId

Handoff 无 scopeId

cross-scope record transfer

scope mismatch 仍 restore caret

EPHEMERAL saveParagraphLayout("")

EPHEMERAL physical empty-key write

Save-As scopeId 改变

Save-As recordId 重建

Save-As generation 无故增加

Save-As historical rehydrate 当前 live

Save-As 被 CANONICAL-BINDING-DOCUMENT-SWITCH 处理

Document Switch 保留旧 EPHEMERAL scope

Build ID reuse

plugin/project SHA mismatch

strict startup mandatory missing
```

立即：

```text
R58.7 PHASE A.1.3 NOT FIXED — R60 BLOCKED
```

---

# 98. 禁止假修复

禁止：

```text
只看 from/to mode 判断 Save-As

只看 same editorInstanceId 判断 Save-As

只看 activeFilePath null→non-null 判断 Save-As

硬编码 doc.md 是 Document Switch

硬编码 untitled-test 是 Save-As

用 setTimeout 猜 Save 操作

只修 trace reason 文本
但实际流程仍 document switch

只把 Registry 日志加 scopeId
但 lookup/transfer 仍不校验 scope

为了 Save-As 直接跳过所有 historical 逻辑
但 document switch 也被跳过

清空 Registry 来避免冲突

重建所有 record

修改 Special Command

修改 Split

修改 Merge

进入 ContinuityEngine
```

---

# 99. 推荐修改范围

优先：

```text
src/runtime/document-runtime-context.ts

src/heading-numbering/heading-numbering-service.ts

src/heading-numbering/paragraph-canonical-registry.ts
```

可能小改：

```text
LiveReplacementTicket type

CaretExpectation type

OneShotHandoff type
```

不要大改：

```text
paragraph-indent-manager.ts

paragraph-layout-store.ts

merge resolver
```

---

# 100. Build / Deploy

执行：

```powershell
pnpm exec tsc --noEmit

pnpm test

pnpm run build:dev

powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1
```

记录：

```text
typecheck
tests
build
plugin SHA
project SHA
style SHA
shaMatch
Build ID
```

---

# 101. Runtime Test 顺序

必须严格：

```text
restart
↓
strict startup
↓
Case C: Untitled → existing doc.md
↓
verify DOCUMENT_SWITCH
↓
restart/new Untitled
↓
Case B: Untitled → real Save-As unique file
↓
verify SAVE_AS_PROMOTION
↓
scope continuity
↓
record continuity
↓
initial snapshot
↓
persisted regression
```

---

# 102. Case C 必须先测

先测错误最容易复现的：

```text
Untitled → existing doc.md
```

如果仍误判 Save-As：

```text
立即停止
```

不要继续 Save-As 3/3。

---

# 103. Case B 才测真实 Save-As

只有 Case C PASS 后：

```text
真实 Save As
```

至少 3 次。

---

# 104. Final Report

必须：

```text
## 1. Current Ground Truth
## 2. HARD FREEZE Confirmation
## 3. Source Map — Save Provenance
## 4. Source Map — Document Transition
## 5. Source Map — Registry Scope
## 6. Exact Save-As Misclassification Root Cause
## 7. Same Editor Why Not Sufficient
## 8. Operation Provenance Model
## 9. PendingPersistencePromotion
## 10. Promotion Create Signal
## 11. Promotion Consume Signal
## 12. Promotion Miss
## 13. Document Switch Classifier
## 14. Save-As Classifier
## 15. Immutable Before Snapshot
## 16. Immutable After Snapshot
## 17. Snapshot Audit
## 18. Registry scopeId
## 19. Ticket scopeId
## 20. Caret scopeId
## 21. Handoff scopeId
## 22. Cross-Scope Guards
## 23. EPHEMERAL Persistence Suppression
## 24. Case C Existing doc Open 3/3
## 25. Case B Real Save-As 3/3
## 26. scopeId Continuity
## 27. recordId Continuity
## 28. generation Continuity
## 29. Initial Snapshot
## 30. Persisted Regression
## 31. Historical Safety
## 32. Files Changed
## 33. Build ID
## 34. Build ID Audit
## 35. Typecheck
## 36. Tests
## 37. Build
## 38. Deploy SHA
## 39. Strict Startup
## 40. Hard Stop Counts
## 41. Remaining Issues
## 42. Final Verdict
```

---

# 105. Final Verdict

只有全部 mandatory runtime PASS：

```text
R58.7 PHASE A.1.3 PASS — SAVE-AS / DOCUMENT-SWITCH CLASSIFIER CLOSED
```

然后才允许继续：

```text
R58.7 PHASE A.1.4
or
Phase A closure audit
```

否则：

```text
R58.7 PHASE A.1.3 NOT FIXED — R60 BLOCKED
```

任何：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

必须：

```text
R58.7 PHASE A.1.3 NOT FIXED — R60 BLOCKED
```

---

# 106. Execution Rules

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
Save operation event
pending promotion
target path
scopeId
record IDs
generation
transition before/after
sidecar call count
PID
StartTime
HWND
WindowTitle
SHA
Build ID
runtime acceptance
```

---

# 107. 第一执行动作

不要先修改 classifier。

先输出三组 Source Map：

```text
Save Operation Provenance
Document Transition
Registry / Ticket / Caret / Handoff Scope
```

然后回答：

```text
1. 当前为什么只要 EPHEMERAL→PERSISTED 就被标成 SAVE_AS_PROMOTION？

2. 为什么打开已有 doc.md 时 editorInstanceId 没变，
   说明 same editor 不能证明 Save-As？

3. 为什么 transition trace 中
   fromMode=EPHEMERAL
   但 persistenceKeyBefore 已经是 doc.md？

4. 当前哪一个真实 Typora/workspace event
   能在 Save-As path change 前提供明确的保存 provenance？
```

只有定位四个问题后才开始修改。

本轮只执行 Phase A.1.3。
