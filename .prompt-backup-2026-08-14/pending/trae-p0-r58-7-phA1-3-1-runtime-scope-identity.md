# TRAE P0 — R58.7 Phase A.1.3.1 Runtime Scope Identity Completion + Scope Guard Activation + Single-Dot Forensic De-noise

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Runtime Identity Integrity**
>
> Current authoritative status:
>
> ```text
> R58.7 PHASE A.1.3 NOT FIXED
> R60 BLOCKED
> ```
>
> Current runtime build:
>
> ```text
> inkchapter-r58-7-phA1-3-operation-provenance-scope-f3x9r
> ```
>
> 本轮不是继续修改 Save-As classifier。
>
> 最新 runtime 已经证明：
>
> ```text
> EPHEMERAL Context
> UserIntent scope
> Mutation scope
> Special Command
> Split continuity
> Sidecar suppression
> Selection/Caret verification
> ```
>
> 都已经真实运行。
>
> 但底层仍然存在半迁移：
>
> ```text
> USER-INTENT-EPOCH
> → scopeId 正确
>
> EDITOR-MUTATION-BATCH
> → scopeId 正确
>
> BUT
>
> RECORD-LIFECYCLE
> → documentKey=""
>
> LIVE-REPLACEMENT-TICKET
> → documentKey=""
>
> CARET-EXPECTATION
> → 无 scopeId
>
> HANDOFF
> → 无 scopeId
> ```
>
> 当前真正需要完成的是：
>
> ```text
> Runtime Scope Identity Completion
> ```
>
> 同时最新 runtime 再次出现：
>
> ```text
> SINGLE_DOT_SEMANTIC_VIOLATION
> ```
>
> 但其真实来源是：
>
> ```text
> CURRENT_LIVE
> lastSemanticWriter=W-ENTER-COMMIT-SEMANTIC
> rehydrateDecisionId=null
> selectedRecordId=null
> candidateCount=0
> ```
>
> 这是 diagnostic false positive，
> 不是 historical wrong apply。
>
> 本轮只修：
>
> ```text
> RuntimeScopeRef
> Registry scope identity
> Ticket scope identity
> Caret/Handoff scope guards
> Cross-scope hard stop
> Single-Dot forensic predicate
> ```
>
> Save-As provenance 暂时 HARD FREEZE，
> 等本轮完成后单独做 GUI runtime acceptance。

---

# 0. 本轮唯一目标

必须完成：

```text
DocumentRuntimeContext.scopeId
↓
RuntimeScopeRef snapshot
↓
UserIntent
↓
Mutation
↓
Canonical Registry
↓
LiveReplacementTicket
↓
CaretExpectation
↓
Handoff
↓
Canonical Transfer

全部共享同一个 runtime scope identity
```

并建立：

```text
cross-scope mutation = HARD STOP
```

同时修正：

```text
CURRENT_LIVE single-dot
≠
historical wrong apply
```

---

# 1. 当前已验证部分 — HARD FREEZE

当前 runtime 已有真实正向证据：

```text
EDITOR-RUNTIME-BOUND

NO_EDITOR → EPHEMERAL

DOCUMENT-CONTEXT-STATE:
mode=EPHEMERAL

scopeId=untitled:session-...:editor-1

businessReady=true

persistenceReady=false

DOCUMENT-CONTEXT-SNAPSHOT-AUDIT
valid=true

USER-INTENT-EPOCH:
scopeId=untitled:...
persistenceKey=null
documentMode=EPHEMERAL

EDITOR-MUTATION-BATCH:
scopeId=untitled:...
persistenceKey=null
documentMode=EPHEMERAL

SIDECAR-WRITE-SKIP:
mode=EPHEMERAL
reason=PERSISTENCE_NOT_READY

Special Command:
`。。+Enter`
overallSuccess=true

SelectionTruth

SELECTION-CONTINUITY-VERIFY

SPLIT_1_TO_2

canonicalOwner != caretDestination

LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH

UserIntent supersession

pluginMainSha256
=
projectMainSha256

shaMatch=true

styleSha256 real

initializationCount=1
```

以上全部 HARD FREEZE。

---

# 2. 当前核心 FAIL — Registry 仍使用空 documentKey

当前：

```text
RECORD-LIFECYCLE:
event=REGISTER_CURRENT
recordId=...
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

说明：

```text
Canonical Registry
仍然没有真正采用 scopeId
```

---

# 3. 当前核心 FAIL — LiveReplacementTicket 仍使用 documentKey

当前：

```text
LIVE-REPLACEMENT-TICKET:
ticketId=...
recordId=...
fromRuntimeId=...
generation=...
documentKey=
source=MUTATION_OBSERVER
```

这意味着：

```text
Ticket 没有 runtime scope ownership
```

---

# 4. 当前核心 FAIL — CaretExpectation 没有 scope

当前：

```text
CARET-EXPECTATION-CREATE:
expectationId=...
intentEpoch=...
expectedRuntimeId=...
canonicalRecordId=...
generation=...
```

但没有：

```text
scopeId
```

因此无法证明：

```text
document switch 后旧 caret expectation
不会 restore 到新文档
```

---

# 5. 当前核心 FAIL — Handoff 没有 scope

当前：

```text
HANDOFF-CLOSE:
handoffId=...
reason=SUPERSEDED_BY_USER_INTENT
```

但 handoff 本身没有 scope ownership。

因此当前只能判断：

```text
intent epoch
```

不能判断：

```text
document/runtime scope change
```

---

# 6. 建立统一 RuntimeScopeRef

新增：

```ts
interface RuntimeScopeRef {
  scopeId: string;

  persistenceKey: string | null;

  mode:
    | "EPHEMERAL"
    | "PERSISTED";

  sessionId: string;

  editorInstanceId: string;
}
```

---

# 7. RuntimeScopeRef 必须不可变

一次创建后：

```text
不得 mutate
```

建议：

```ts
Object.freeze(...)
```

或者通过 readonly interface：

```ts
interface RuntimeScopeRef {
  readonly scopeId: string;
  readonly persistenceKey: string | null;
  readonly mode: "EPHEMERAL" | "PERSISTED";
  readonly sessionId: string;
  readonly editorInstanceId: string;
}
```

---

# 8. 单一 Snapshot API

新增：

```ts
private snapshotRuntimeScope(): RuntimeScopeRef | null
```

只允许从：

```text
DocumentRuntimeContext
+
EditorRuntime
```

生成。

---

# 9. Business Transaction 只 snapshot 一次

每个 trusted user transaction：

```text
begin transaction
↓
scope = snapshotRuntimeScope()
```

之后整条链：

```text
UserIntent
Mutation
Ticket
Registry
Caret
Handoff
```

都使用这份：

```text
scope
```

禁止中途重新：

```text
getDocumentKey()
getScopeContext()
read documentContext.scopeId
```

---

# 10. Runtime Scope Snapshot Trace

必须：

```text
RUNTIME-SCOPE-SNAPSHOT:
source=TRANSACTION_START
scopeId=...
persistenceKey=...
mode=EPHEMERAL|PERSISTED
sessionId=...
editorInstanceId=...
valid=true
```

---

# 11. Scope Snapshot Hard Gate

如果：

```text
businessReady=true
```

但：

```text
scopeId missing
editorInstanceId missing
```

必须：

```text
RUNTIME-SCOPE-VIOLATION:
reason=INVALID_SCOPE_SNAPSHOT
decision=HARD_STOP
```

---

# 12. CanonicalRuntimeMeta 正式迁移

必须：

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

  currentElement?: HTMLElement;

  currentRuntimeId?: string;

  previousRuntimeId?: string;

  generation: number;
}
```

---

# 13. Current-Session Record Identity

当前编辑 session：

```text
(scopeId, CanonicalRecordId)
```

必须成为唯一 live business identity。

禁止：

```text
(documentKey="", CanonicalRecordId)
```

---

# 14. Persisted Historical Identity

PERSISTED_HISTORICAL：

```text
persistenceKey
```

继续保留。

它用于：

```text
sidecar reload
historical reconciliation
```

但不能替代 current-session scope。

---

# 15. `documentKey` 兼容字段处理

如果暂时不能删除：

```ts
documentKey
```

则：

```text
CURRENT_* state
不能再依赖 documentKey 做 runtime namespace
```

只能作为：

```text
deprecated compatibility field
```

---

# 16. Registry registerCurrent 必须接收 RuntimeScopeRef

建议：

```ts
registry.registerCurrent({
  record,
  scope,
  element,
  runtimeId,
});
```

内部：

```text
meta.scopeId = scope.scopeId
meta.persistenceKey = scope.persistenceKey
```

---

# 17. Registry reuseExisting Scope Guard

复用前：

```text
record.scopeId
==
operation.scopeId
```

否则：

```text
CANONICAL-SCOPE-MISMATCH
operation=REUSE_EXISTING
decision=BLOCK
```

---

# 18. Registry markAwaiting Scope Guard

调用：

```text
markAwaitingTransfer
```

前必须：

```text
record.scopeId == ticket.scopeId
```

否则：

```text
BLOCK
```

并：

```text
state unchanged
```

---

# 19. Registry transfer Scope Guard

transfer 前必须：

```text
record.scopeId == ticket.scopeId
```

否则：

```text
CANONICAL-SCOPE-MISMATCH:
operation=TRANSFER
decision=BLOCK
```

并保证：

```text
generation unchanged
runtimeId unchanged
state unchanged
```

---

# 20. Registry retire Scope Guard

同理：

```text
scope mismatch
→ retire=0
```

---

# 21. Registry promotion Scope Guard

Promotion：

```text
scope mismatch
→ promotion=0
```

---

# 22. Registry Backspace Scope Guard

Backspace reverse/update：

```text
scope mismatch
→ mutation=0
```

---

# 23. Registry Trace 改造

Current-session：

```text
RECORD-LIFECYCLE:
event=REGISTER_CURRENT
recordId=...
scopeId=untitled:...
persistenceKey=null
sessionId=...
state=CURRENT_LIVE
runtimeId=P-RUNTIME-*
generation=1
origin=current-session
```

---

# 24. Current-session 禁止空 namespace trace

以下：

```text
RECORD-LIFECYCLE
```

对于：

```text
CURRENT_LIVE
CURRENT_AWAITING_TRANSFER
CURRENT_RETIRED
```

必须：

```text
scopeId non-empty
```

---

# 25. LiveReplacementTicket 加 RuntimeScopeRef

改为：

```ts
interface LiveReplacementTicket {
  ticketId: string;

  recordId: string;

  fromRuntimeId: string;

  generation: number;

  scope: RuntimeScopeRef;

  source: string;
}
```

---

# 26. Ticket Create Trace

必须：

```text
LIVE-REPLACEMENT-TICKET:
ticketId=...
recordId=...
fromRuntimeId=...
generation=...
scopeId=untitled:...
persistenceKey=null
mode=EPHEMERAL
source=MUTATION_OBSERVER
```

---

# 27. Ticket Resolve Scope Check

在任何：

```text
markAwaiting
resolve
transfer
```

前：

```text
ticket.scope.scopeId
==
current scope.scopeId
```

---

# 28. Ticket Scope Mismatch

必须：

```text
LIVE-REPLACEMENT-TICKET-CLOSE:
ticketId=...
ticketScopeId=S1
currentScopeId=S2
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

# 29. CaretExpectation 加 RuntimeScopeRef

建议：

```ts
interface CaretExpectation {
  ...
  scope: RuntimeScopeRef;
}
```

---

# 30. Caret Create Trace

必须：

```text
CARET-EXPECTATION-CREATE:
expectationId=...
scopeId=...
persistenceKey=...
mode=...
intentEpoch=...
expectedRuntimeId=...
decision=ACTIVE
```

---

# 31. Caret Verify Scope Guard

verify 前：

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

# 32. Scope Changed 优先于 Intent Epoch

顺序：

```text
scope mismatch
→ SCOPE_CHANGED

else
intent epoch superseded
→ SUPERSEDED_BY_USER_INTENT
```

---

# 33. Handoff 加 RuntimeScopeRef

Handoff：

```ts
interface OneShotHandoff {
  ...
  scope: RuntimeScopeRef;
}
```

---

# 34. Handoff Create Trace

必须：

```text
HANDOFF-CREATE:
handoffId=...
scopeId=...
intentEpoch=...
```

---

# 35. Handoff Scope Guard

resolve 前：

```text
handoff.scope.scopeId
==
currentScope.scopeId
```

否则：

```text
HANDOFF-CLOSE:
reason=SCOPE_CHANGED
decision=CLOSE
```

---

# 36. Handoff Scope Mismatch 禁止 Transfer

必须：

```text
canonical transfer=0
```

---

# 37. Canonical Binding Transfer Trace

必须增加：

```text
scopeId=...
```

例如：

```text
CANONICAL-BINDING-TRANSFER:
canonicalRecordId=...
scopeId=untitled:...
fromRuntimeId=...
toRuntimeId=...
generationBefore=...
generationAfter=...
reason=...
```

---

# 38. Cross-Scope Guard 统一入口

不要每个函数复制代码。

建议：

```ts
private assertCanonicalScope(
  recordScopeId: string,
  operationScopeId: string,
  operation: string,
  recordId: string,
): boolean
```

---

# 39. Scope Mismatch Trace

统一：

```text
CANONICAL-SCOPE-MISMATCH:
recordId=...
recordScopeId=S1
operationScopeId=S2
operation=TRANSFER|REUSE|AWAIT|RETIRE|PROMOTION|BACKSPACE
decision=BLOCK
```

---

# 40. Scope Guard 必须是业务 guard，不只是日志

禁止：

```text
仅增加 CANONICAL-SCOPE-MISMATCH trace
```

但仍然继续 mutation。

必须：

```text
return false / no-op
```

---

# 41. 主动失败路径 Unit Test

必须人为构造：

```text
record.scopeId=S1

ticket.scopeId=S2
```

调用：

```text
transfer
```

必须：

```text
CANONICAL-SCOPE-MISMATCH
decision=BLOCK
```

同时：

```text
state unchanged
runtimeId unchanged
generation unchanged
```

---

# 42. 主动失败路径 — Caret

```text
expectation.scopeId=S1
current.scopeId=S2
```

verify：

```text
restore=0
close=SCOPE_CHANGED
```

---

# 43. 主动失败路径 — Handoff

```text
handoff.scopeId=S1
current.scopeId=S2
```

resolve：

```text
transfer=0
close=SCOPE_CHANGED
```

---

# 44. 主动失败路径 — Ticket

```text
ticket.scopeId=S1
current.scopeId=S2
```

必须：

```text
markAwaiting=0
transfer=0
```

---

# 45. Scope Audit

新增：

```text
RUNTIME-SCOPE-INVARIANT-AUDIT:
currentSessionRecordCount=...
recordsMissingScope=0
ticketsMissingScope=0
caretExpectationsMissingScope=0
handoffsMissingScope=0
crossScopeMutationCount=0
decision=PASS
```

---

# 46. Current Session `documentKey=""` 归零

修复后：

```text
RECORD-LIFECYCLE
CURRENT_*
documentKey=
```

必须：

```text
0
```

或者该字段不再输出。

---

# 47. LiveReplacementTicket `documentKey=""` 归零

必须：

```text
0
```

改成 scope trace。

---

# 48. 当前 Single-Dot False Positive

最新 runtime：

```text
visibleText="。"
semanticBefore=force-indent
semanticAfter=force-indent
computedIndent=32px
lastSemanticWriter=W-ENTER-COMMIT-SEMANTIC
rehydrateDecisionId=null
selectedRecordId=null
candidateCount=0
ambiguity=false
blocked=false
```

却：

```text
SINGLE_DOT_SEMANTIC_VIOLATION
decision=HARD_STOP
```

这是错误。

---

# 49. Single-Dot Diagnostic 重新定义

新增两种事件：

```text
SINGLE-DOT-CURRENT-LIVE
```

和：

```text
SINGLE-DOT-WRONG-APPLY
```

---

# 50. SINGLE-DOT-CURRENT-LIVE

如果：

```text
visibleText=="。"

AND exact CURRENT_LIVE owner exists

AND semanticBefore in:
force-indent|force-flush

AND last semantic writer is current-session/live writer
```

则：

```text
SINGLE-DOT-CURRENT-LIVE:
decision=INFO
```

禁止 HARD STOP。

---

# 51. Historical Wrong Apply 正确定义

只有同时：

```text
visibleText=="。"

semanticBefore=="auto"

no exact CURRENT_LIVE owner

non-auto semantic is about to be applied

source=
REHYDRATE
or
PERSISTED_HISTORICAL
or
HISTORICAL_RESOLVER
```

才：

```text
SINGLE-DOT-WRONG-APPLY
decision=HARD_STOP
```

---

# 52. Current Live Writer 不得判 Wrong Apply

以下 writer：

```text
W-ENTER-COMMIT-SEMANTIC

W-BACKSPACE-UPDATE

W-PROMOTION

W-LIVE-TRANSFER
```

只要 exact live ownership 成立，
都不是 historical wrong apply。

---

# 53. Single-Dot Trace 必须输出 scope

改为：

```text
SINGLE-DOT-TRACE:
scopeId=...
persistenceKey=...
mode=...
runtimeId=...
recordId=...
recordState=...
visibleText="。"
semantic=...
writer=...
source=...
```

---

# 54. 禁止继续输出 `documentKey=unknown`

Single-dot diagnostics 也必须用：

```text
scopeId
persistenceKey
```

---

# 55. Single-Dot Unit Test SD-1

Current live：

```text
visibleText="。"
recordState=CURRENT_LIVE
semantic=force-indent
writer=W-ENTER-COMMIT-SEMANTIC
```

必须：

```text
INFO
HARD_STOP=0
```

---

# 56. Single-Dot Unit Test SD-2

Historical wrong apply：

```text
visibleText="。"
semanticBefore=auto
no exact CURRENT_LIVE
historical non-auto candidate selected
```

必须：

```text
SINGLE-DOT-WRONG-APPLY
HARD_STOP
```

---

# 57. Single-Dot Unit Test SD-3

Historical ambiguous but blocked：

```text
candidateCount>1
decision=BLOCK
semantic remains auto
```

不得：

```text
WRONG_APPLY
```

---

# 58. Save-As Provenance HARD FREEZE

本轮禁止继续修改：

```text
PendingPersistencePromotion

file:will-save

SAVE_AS_PROMOTION classifier

DOCUMENT_SWITCH classifier
```

除非编译适配 scope type 必须。

---

# 59. Save-As Runtime Acceptance 暂缓

本轮不要求：

```text
Save-As 3/3
```

它留给：

```text
R58.7 Phase A.1.3.2
Operation Provenance Runtime Acceptance
```

---

# 60. Sidecar Suppression HARD FREEZE

已经真实看到：

```text
SIDECAR-WRITE-SKIP
mode=EPHEMERAL
```

不要再改：

```text
scheduleSidecarWrite
```

---

# 61. Special Command HARD FREEZE

不要再改：

```text
`。。+Enter`

token recognition

token removal

semantic commit

visual commit

caret commit
```

---

# 62. Selection HARD FREEZE

禁止修改：

```text
resolveSelectionTruth

POST-TOKEN-SELECTION

sameAsCommand

SELECTION-CONTINUITY-VERIFY
```

---

# 63. Split HARD FREEZE

禁止修改：

```text
Mutation Shape Authority

SPLIT_1_TO_2

canonicalOwner

caretDestination

LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

---

# 64. Merge HARD FREEZE

本轮禁止修改 merge algorithm。

---

# 65. Runtime Identity HARD FREEZE

继续保持：

```text
pluginMainPath

projectMainPath

pluginMainSha256

projectMainSha256

shaMatch=true

styleSha256

initializationCount=1
```

---

# 66. SyntaxError 独立记录

当前：

```text
SyntaxError: Unexpected token ')'
```

继续独立追踪。

本轮不与 scope migration 混修。

---

# 67. Source Map — Registry

修改前必须输出：

```text
CanonicalRuntimeMeta definition

registerCurrent

reuseExisting

markAwaitingTransfer

transfer

retire

promotion

backspace update

RECORD-LIFECYCLE logger
```

---

# 68. Source Map — Ticket

必须输出：

```text
LiveReplacementTicket definition

ticket create

ticket resolve

ticket close

markAwaiting call

transfer call
```

---

# 69. Source Map — Caret

必须输出：

```text
CaretExpectation definition

create

verify

restore

close
```

---

# 70. Source Map — Handoff

必须输出：

```text
Handoff definition

create

resolve

close

intent supersession
```

---

# 71. Source Map — Single Dot

必须输出：

```text
traceSingleDotIfMatch

hard stop predicate

semanticBefore source

selectedRecordId source

rehydrateDecisionId source

writer tracking source

exact live owner resolver
```

---

# 72. 修改前必须回答

明确回答：

```text
1. 为什么 UserIntent / Mutation 已经有 scopeId，
   Registry 仍然记录 documentKey=""？

2. 哪些 Registry API 仍以 documentKey 作为 current-session namespace？

3. Ticket / Caret / Handoff 当前在哪里缺失 scope ownership？

4. SINGLE_DOT_SEMANTIC_VIOLATION 为什么会把
   CURRENT_LIVE force-indent paragraph
   错判成 historical contamination？
```

---

# 73. Unit Test RS-1

EPHEMERAL current record：

```text
scopeId=S1
persistenceKey=null
```

必须正常 register。

---

# 74. Unit Test RS-2

同 scope transfer：

```text
S1 → S1
```

PASS。

---

# 75. Unit Test RS-3

cross scope transfer：

```text
S1 → S2
```

BLOCK。

---

# 76. Unit Test RS-4

cross scope reuse：

```text
BLOCK
```

---

# 77. Unit Test RS-5

cross scope await：

```text
BLOCK
```

---

# 78. Unit Test RS-6

cross scope retire：

```text
BLOCK
```

---

# 79. Unit Test RS-7

Ticket mismatch：

```text
CLOSE SCOPE_CHANGED
```

---

# 80. Unit Test RS-8

Caret mismatch：

```text
restore=0
```

---

# 81. Unit Test RS-9

Handoff mismatch：

```text
transfer=0
```

---

# 82. Runtime Acceptance RA1 — Current Record Scope

Untitled 中：

```text
至少 3 次 `。。+Enter`
至少 2 次 Split
```

所有：

```text
RECORD-LIFECYCLE
```

必须：

```text
scopeId=<same S1>
```

---

# 83. Runtime Acceptance RA2 — Ticket Scope

所有：

```text
LIVE-REPLACEMENT-TICKET
```

必须：

```text
scopeId=S1
```

---

# 84. Runtime Acceptance RA3 — Caret Scope

所有：

```text
CARET-EXPECTATION-CREATE
```

必须：

```text
scopeId=S1
```

---

# 85. Runtime Acceptance RA4 — Handoff Scope

所有：

```text
HANDOFF-CREATE/CLOSE
```

必须可以追踪：

```text
scopeId=S1
```

---

# 86. Runtime Acceptance RA5 — Empty Runtime Namespace Zero

必须：

```text
RECORD-LIFECYCLE documentKey=""
= 0

LIVE-REPLACEMENT-TICKET documentKey=""
= 0
```

---

# 87. Runtime Acceptance RA6 — Cross-Scope Runtime Zero

正常路径：

```text
CANONICAL-SCOPE-MISMATCH=0
```

并且 unit test 必须证明 mismatch path 能 BLOCK。

---

# 88. Runtime Acceptance RA7 — Single Dot False Positive Zero

当前 live editing 中：

```text
SINGLE_DOT_SEMANTIC_VIOLATION
= 0
```

允许：

```text
SINGLE-DOT-CURRENT-LIVE
```

---

# 89. Runtime Acceptance RA8 — Historical Wrong Apply 仍可 Hard Stop

使用已有 historical test 或 unit test：

```text
historical wrong apply
→ SINGLE-DOT-WRONG-APPLY
→ HARD_STOP
```

不能因为去假阳性而失去保护。

---

# 90. Runtime Acceptance RA9 — Regression

仍必须：

```text
Untitled `。。+Enter`
至少 5/5

Split
至少 5/5

SIDECAR-WRITE-SKIP
继续正常

Selection/Caret verify
继续 PASS
```

---

# 91. Build ID

本轮必须唯一：

```text
inkchapter-r58-7-phA1-3-1-runtime-scope-identity-<unique>
```

禁止复用：

```text
f3x9r
```

---

# 92. Build ID Audit

必须：

```text
SOURCE_BUILD_ID
DIST_BUILD_ID
DEPLOYED_BUILD_ID
RUNTIME_BUILD_ID
REPORT_BUILD_ID
```

全部一致。

---

# 93. Build / Deploy

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
shaMatch
style SHA
Build ID
```

---

# 94. Restart + Strict Startup

必须真实：

```text
old Typora process exited

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

# 95. Strict Startup 不完整

任一 mandatory 未验证：

```text
启动命令已发出，但尚未确认成功
```

---

# 96. Runtime Test 顺序

严格：

```text
restart
↓
strict startup
↓
Untitled
↓
3x special
↓
2x split
↓
scope traces
↓
single-dot diagnostics
↓
final scope audit
```

本轮不要做 Save-As acceptance。

---

# 97. Hard Stop List

任一：

```text
CURRENT_* RECORD-LIFECYCLE scopeId missing

LIVE-REPLACEMENT-TICKET scopeId missing

CARET-EXPECTATION scopeId missing

HANDOFF scopeId missing

record.scopeId != ticket.scopeId
仍 markAwaiting

record.scopeId != operation.scopeId
仍 transfer

scope mismatch 仍 restore caret

scope mismatch 仍 handoff transfer

current-session 仍用 documentKey="" 作为 namespace

scope guard 只有 trace 没有 BLOCK

SINGLE_DOT CURRENT_LIVE 仍 HARD STOP

historical wrong apply 不再 HARD STOP

Special Command regression

Split regression

EPHEMERAL sidecar suppression regression

Build ID reuse

plugin/project SHA mismatch

strict startup mandatory missing
```

立即：

```text
R58.7 PHASE A.1.3.1 NOT FIXED — R60 BLOCKED
```

---

# 98. 禁止假修复

禁止：

```text
只给 RECORD-LIFECYCLE 日志加 scopeId
但 Registry 仍以 documentKey 做 lookup

只给 Ticket 日志加 scopeId
但 resolve 不比较 scope

只给 Caret 日志加 scopeId
但 restore 不比较 scope

只给 Handoff 日志加 scopeId
但 transfer 不比较 scope

把 documentKey="" 改成 scopeId 文本
但结构中仍无 scope

为了避免 Single-Dot 报警直接删除 hard stop

把所有 single-dot 都视为合法

重新修改 Save-As classifier

修改 Special Command

修改 Split

修改 Merge

进入 ContinuityEngine
```

---

# 99. 推荐修改范围

优先：

```text
src/heading-numbering/paragraph-canonical-registry.ts

src/heading-numbering/heading-numbering-service.ts
```

可能新增：

```text
src/runtime/runtime-scope-ref.ts
```

或者：

```text
src/heading-numbering/runtime-scope-types.ts
```

避免大改：

```text
paragraph-indent-manager.ts

paragraph-layout-store.ts

document-runtime-context.ts

Save-As provenance code
```

---

# 100. Phase A.1.3.2 暂缓

本轮完成后再单独执行：

```text
R58.7 Phase A.1.3.2
Operation Provenance Runtime Acceptance
```

它应优先：

```text
不改代码
先跑 GUI Case A / Case B
```

---

# 101. Final Report

必须：

```text
## 1. Current Ground Truth
## 2. HARD FREEZE Confirmation
## 3. Source Map — Registry
## 4. Source Map — Ticket
## 5. Source Map — Caret
## 6. Source Map — Handoff
## 7. Source Map — Single Dot
## 8. Exact Half-Migration Root Cause
## 9. RuntimeScopeRef
## 10. Scope Snapshot Authority
## 11. CanonicalRuntimeMeta Migration
## 12. Registry Scope Guards
## 13. Ticket Scope
## 14. Ticket Scope Guard
## 15. Caret Scope
## 16. Caret Scope Guard
## 17. Handoff Scope
## 18. Handoff Scope Guard
## 19. Canonical Binding Scope Trace
## 20. Cross-Scope Hard Stop
## 21. Active Failure-Path Tests
## 22. Single-Dot False Positive Root Cause
## 23. SINGLE-DOT-CURRENT-LIVE
## 24. SINGLE-DOT-WRONG-APPLY
## 25. Historical Hard Stop Preservation
## 26. Files Changed
## 27. Build ID
## 28. Build ID Audit
## 29. Typecheck
## 30. Tests
## 31. Build
## 32. Deploy SHA
## 33. Strict Startup
## 34. RA1 Current Record Scope
## 35. RA2 Ticket Scope
## 36. RA3 Caret Scope
## 37. RA4 Handoff Scope
## 38. RA5 Empty Runtime Namespace Zero
## 39. RA6 Cross-Scope Safety
## 40. RA7 Single-Dot False Positive Zero
## 41. RA8 Historical Wrong Apply Protection
## 42. RA9 Regression
## 43. Scope Invariant Audit
## 44. Hard Stop Counts
## 45. Remaining Issues
## 46. Final Verdict
```

---

# 102. Final Verdict

只有所有 mandatory runtime gate 真实通过，
才允许：

```text
R58.7 PHASE A.1.3.1 PASS — RUNTIME SCOPE IDENTITY CLOSED
```

然后进入：

```text
R58.7 Phase A.1.3.2
Operation Provenance Runtime Acceptance
```

否则：

```text
R58.7 PHASE A.1.3.1 NOT FIXED — R60 BLOCKED
```

任何：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

必须：

```text
R58.7 PHASE A.1.3.1 NOT FIXED — R60 BLOCKED
```

---

# 103. Execution Rules

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
RuntimeScopeRef
registry meta
ticket scope
caret scope
handoff scope
cross-scope guard
single-dot writer
single-dot owner
Build ID
SHA
PID
StartTime
HWND
WindowTitle
runtime acceptance
```

---

# 104. 第一执行动作

不要先改代码。

先输出：

```text
Registry Source Map
Ticket Source Map
Caret Source Map
Handoff Source Map
Single-Dot Source Map
```

然后明确回答：

```text
为什么上层 UserIntent / Mutation
已经有 scopeId，
但底层 Registry / Ticket
仍使用 documentKey=""？

哪些实际 Registry mutation API
仍然依赖 documentKey？

CaretExpectation / Handoff
当前为什么没有 scope ownership？

为什么 CURRENT_LIVE force-indent
在 visibleText="。" 时
会被错误判成 historical semantic violation？
```

定位后，
只执行：

```text
Runtime Scope Identity Completion
+
Scope Guard Activation
+
Single-Dot Forensic De-noise
```

禁止进入任何后续 Phase。
