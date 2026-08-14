# TRAE P0 — R58.6.7 Trusted User Intent Coverage + Batch-First Merge Ownership Authority + Caret Expectation Lifecycle Completion + Strict Runtime Identity Snapshot

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Runtime Ownership Transaction Closure**
>
> Current authoritative status:
>
> ```text
> R58.6.6 NOT FIXED
> R60 BLOCKED
> ```
>
> 本轮不要继续给 Merge 增加“collision 之后的补救逻辑”。
>
> 最新 runtime 已经证明当前真正根因是：
>
> ```text
> MERGE_2_TO_1
> 在知道整个 batch 有几个 canonical owners 之前，
> 就已经开始对第一个 owner 做不可逆 transfer。
> ```
>
> 结果：
>
> ```text
> owner #1 → 先 transfer 到 merged destination
> owner #2 → element collision
> owner #2 → CURRENT_AWAITING_TRANSFER 泄漏数秒
> ```
>
> 所以本轮核心原则只有一句：
>
> ```text
> PREPARE FIRST
> DECIDE ONCE
> COMMIT ONCE
> ```
>
> 任何 Merge lifecycle mutation 必须晚于 batch ownership preflight。

---

# 0. 最新 Runtime Ground Truth

当前真实 runtime Build：

```text
inkchapter-r58-6-6-intent-caret-handoff-merge-identity-p7q3x
```

已真实通过，必须 HARD FREEZE：

```text
SelectionTruth runtime activation

SELECTION-TRUTH source=MUTATION

SELECTION-TRUTH source=OBS

sameAsCommand 基于 runtimeId

Special CaretExpectation creation

SELECTION-CONTINUITY-VERIFY
source=MICROTASK

SELECTION-CONTINUITY-VERIFY
source=RAF

Special command immediate verified=true

CaretExpectation special→special supersession

Mutation Shape Authority

SPLIT_1_TO_2 resolver

canonicalOwner != caretDestination

LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH

Proof-Before-Mutation

Live Owner Dominance

CURRENT_LIVE projection-only

physical sidecar

plugin runtime path real

plugin SHA real

initializationCount=1

Active Doc file-open resolution
```

禁止重写以上主逻辑。

---

# 1. 当前 P0-A — Trusted User Intent Coverage 不完整

真实 runtime：

```text
USER-INTENT-EPOCH:
epoch=1 source=SPECIAL_COMMAND

USER-INTENT-EPOCH:
epoch=2 source=SPECIAL_COMMAND
```

但同一日志里实际还发生：

```text
normal Enter

Backspace reverse

Merge

普通 typing

selection movement
```

却没有：

```text
source=NORMAL_ENTER
source=BACKSPACE
source=DELETE
source=KEYBOARD_NAVIGATION
source=TEXT_INPUT
source=POINTER
```

因此当前：

```text
UserIntentEpoch
仅覆盖 special command
```

还不是 editor-wide user intent authority。

---

# 2. User Intent Authority 必须提升到 Editor Root Capture 层

不要在各业务 handler 内零散：

```text
advanceUserIntent()
```

而是建立统一：

```ts
private beginTrustedUserIntent(
  source: UserIntentSource,
  event: Event,
): UserIntentToken
```

由 editor root capture 层调用。

---

# 3. UserIntentSource

统一：

```ts
type UserIntentSource =
  | "SPECIAL_COMMAND"
  | "NORMAL_ENTER"
  | "BACKSPACE"
  | "DELETE"
  | "TEXT_INPUT"
  | "KEYBOARD_NAVIGATION"
  | "POINTER"
  | "SELECTION_CHANGE";
```

注意：

```text
PROGRAMMATIC_CONTINUITY
```

不是 trusted user intent，
不能推进 epoch。

---

# 4. 必须覆盖的 Trusted Input

至少：

```text
keydown Enter

keydown Backspace

keydown Delete

keydown ArrowUp

keydown ArrowDown

keydown ArrowLeft

keydown ArrowRight

printable key input

beforeinput insertText

beforeinput insertParagraph

beforeinput deleteContentBackward

beforeinput deleteContentForward

pointerdown

mousedown
```

---

# 5. 禁止双计数：keydown + beforeinput 必须 Dedup

一个物理操作可能产生：

```text
keydown
+
beforeinput
```

不能：

```text
epoch N → N+1 → N+2
```

必须属于一个：

```text
UserIntentToken
```

---

# 6. UserIntentToken

新增：

```ts
interface UserIntentToken {
  intentId: string;

  epoch: number;

  source: UserIntentSource;

  startedAt: number;

  eventType: string;

  key?: string;

  inputType?: string;

  trusted: boolean;
}
```

---

# 7. Intent Dedup 建议

可以基于：

```text
same physical key
same editor root
short time window
matching key/inputType family
```

例如：

```text
keydown Enter
→ create intent token

beforeinput insertParagraph
→ attach to same token
```

不要再次推进 epoch。

---

# 8. USER-INTENT-EPOCH Trace

必须：

```text
USER-INTENT-EPOCH:
intentId=...
epoch=...
source=NORMAL_ENTER|BACKSPACE|DELETE|...
eventType=keydown|beforeinput|pointerdown
key=...
inputType=...
deduplicated=true|false
trustedUserInput=true
previousEpoch=...
documentKey=...
timestamp=...
```

---

# 9. MutationObserver 绝不能推进 Epoch

必须继续：

```text
MutationObserver
DOM replacement
rehydrate
render refresh
projection
canonical transfer
sidecar write
```

都：

```text
epoch unchanged
```

---

# 10. 当前 P0-B — Merge 是 Per-Owner Resolver，而不是 Batch Resolver

真实失败 batch：

```text
removed=[
  P-RUNTIME-6,
  P-RUNTIME-4
]

added=[
  P-RUNTIME-9
]
```

其中：

```text
P6 = CURRENT_LIVE owner R57
P4 = CURRENT_LIVE owner R58
```

实际却：

```text
R57:
P6 → P9
decision=TRANSFER_SINGLE_OWNER

然后

R58:
P4 → P9
decision=BLOCK_AMBIGUOUS
reason=element-collision
```

这是错误的 partial commit。

---

# 11. Merge 必须改成 Batch-First Architecture

禁止：

```ts
for (const record of canonicalRemovedRecords) {
  resolveMergeContinuity(record)
}
```

必须：

```ts
const ctx = buildMergeBatchContext(...)

const decision = preflightMergeBatch(ctx)

commitMergeBatch(ctx, decision)
```

---

# 12. MergeOwnerSnapshot

新增：

```ts
interface MergeOwnerSnapshot {
  recordId: string;

  runtimeId: string;

  generation: number;

  element: HTMLElement;

  state: CanonicalRuntimeState;

  documentKey: string;
}
```

---

# 13. MergeBatchContext

新增：

```ts
interface MergeBatchContext {
  batchId: string;

  documentKey: string;

  removedParagraphs: HTMLElement[];

  removedRuntimeIds: string[];

  addedParagraphs: HTMLElement[];

  mergedDestination: HTMLElement | null;

  canonicalOwners: MergeOwnerSnapshot[];

  canonicalOwnerCount: number;

  selectionRuntimeId: string | null;

  createdAt: number;
}
```

---

# 14. `canonicalOwnerCount` 必须是 Unique Owner Count

定义：

```text
canonicalOwnerCount
=
raw removed paragraphs 中
不同 CanonicalRecordId 的数量
```

禁止：

```text
per-record resolver 累加
```

---

# 15. Hard Invariant

必须：

```text
0
<= canonicalOwnerCount
<= removedParagraphCount
```

当前日志出现：

```text
removedParagraphCount=2
canonicalRemovedCount=4
```

这是 HARD FAIL。

新增：

```text
MERGE-OWNER-COUNT-INVARIANT
```

字段：

```text
removedParagraphCount
canonicalOwnerCount
valid=true|false
```

---

# 16. Merge Preflight 必须发生在任何 lifecycle mutation 之前

严禁以下顺序：

```text
markAwaitingTransfer()
↓
再统计 owners
```

正确：

```text
raw mutation batch
↓
classify shape
↓
build owner snapshot
↓
decide
↓
ONLY IF transfer:
  markAwaitingTransfer
  transfer
```

---

# 17. Merge Decision Type

新增：

```ts
type MergeBatchDecision =
  | "NO_CANONICAL_OWNER"
  | "TRANSFER_SINGLE_OWNER"
  | "BLOCK_MULTI_OWNER"
  | "BLOCK_AMBIGUOUS";
```

---

# 18. M0 — No Owner

如果：

```text
canonicalOwnerCount=0
```

则：

```text
decision=NO_CANONICAL_OWNER
```

必须：

```text
markAwaitingTransfer call count = 0

canonicalTransferBinding call count = 0

CREATE_NEW = 0
```

---

# 19. M1/M2 — Exactly One Owner

如果：

```text
canonicalOwnerCount=1
```

且：

```text
addedParagraphCount=1

mergedDestination connected

document match

owner state CURRENT_LIVE

generation current

merged destination unowned
```

则：

```text
decision=TRANSFER_SINGLE_OWNER
```

---

# 20. Single Owner Commit

只能在 preflight 完成后：

```text
CURRENT_LIVE
→ CURRENT_AWAITING_TRANSFER
→ CURRENT_LIVE
```

同一 transaction 内：

```text
generation+1
```

输出：

```text
CANONICAL-BINDING-TRANSFER
reason=LIVE_DOM_MERGE_SINGLE_OWNER
```

---

# 21. M3 — Two or More Owners

如果：

```text
canonicalOwnerCount >= 2
```

必须直接：

```text
decision=BLOCK_MULTI_OWNER
```

---

# 22. Multi-Owner Zero Partial Commit

最关键 hard invariant：

```text
MERGE_2_TO_1
canonicalOwnerCount >= 2

→ markAwaitingTransfer call count = 0

→ canonicalTransferBinding call count = 0

→ generation changes = 0

→ owner bindings changed = 0
```

不能：

```text
first wins
second collision
```

---

# 23. Multi-Owner Trace

必须：

```text
MERGE-BATCH-PREFLIGHT:
batchId=...
mutationShape=MERGE_2_TO_1
removedRuntimeIds=[...]
mergedDestination=P-RUNTIME-N
canonicalOwnerIds=[R1,R2]
canonicalOwnerCount=2
decision=BLOCK_MULTI_OWNER
```

然后：

```text
MERGE-CANONICAL-CONFLICT:
batchId=...
recordIds=[R1,R2]
destination=P-RUNTIME-N
decision=BLOCK_MULTI_OWNER
```

---

# 24. Multi-Owner 不能进入普通 Awaiting

任何：

```text
BLOCK_MULTI_OWNER
```

不得：

```text
CURRENT_AWAITING_TRANSFER
```

如果需要保存 conflict：

```text
separate conflict diagnostic
```

不要污染 lifecycle。

---

# 25. 当前 permanent awaiting regression 必须修掉

最新 runtime：

```text
R58
→ CURRENT_AWAITING_TRANSFER

element collision
→ BLOCK_AMBIGUOUS

awaitingForMs
持续超过 5 秒
```

本轮必须做到：

```text
multi-owner:
never enters awaiting

single-owner:
awaiting < 2000ms
```

---

# 26. Awaiting Leak Hard Stop

新增：

```text
MERGE-AWAITING-LEAK:
batchId=...
recordId=...
decision=HARD_STOP
```

若：

```text
single-owner awaiting > 2000ms
```

或：

```text
multi-owner any awaiting
```

立即 FAIL。

---

# 27. Merge Element Collision 只允许出现在真正 Structural Ambiguity

在 batch-first 之后：

```text
canonicalOwnerCount>=2
```

应在 collision 之前就 BLOCK。

所以 M3 不应该再出现：

```text
reason=element-collision
```

如果仍出现：

```text
说明 preflight 没挡住 partial commit
```

HARD FAIL。

---

# 28. 当前 P0-C — Split 没有建立 CaretExpectation

Split 已真实知道：

```text
canonicalOwner=P6
caretDestination=P5
```

但还没有：

```text
CARET-EXPECTATION-CREATE
reason=SPLIT_NEW_PARAGRAPH
```

本轮必须补。

---

# 29. Split Expectation Creation

Split resolver commit 后：

```text
CARET-EXPECTATION-CREATE:
reason=SPLIT_NEW_PARAGRAPH
intentEpoch=<current normal Enter epoch>
expectedRuntimeId=<caretDestination>
expectedLogicalOffset=0
```

---

# 30. Split Expectation 不能使用 Canonical Owner

硬规则：

```text
expectedRuntimeId
=
caretDestinationRuntimeId
```

禁止：

```text
canonicalOwnerRuntimeId
```

---

# 31. Merge Expectation Creation

M1/M2 commit 成功后：

```text
CARET-EXPECTATION-CREATE:
reason=MERGE_DESTINATION
intentEpoch=<Backspace/Delete epoch>
expectedRuntimeId=<merged destination>
```

---

# 32. M0/M3 不创建 Transfer CaretExpectation

M0 no canonical owner：

```text
可以只做 selection diagnostic
```

M3 conflict：

```text
不能创建 semantic transfer expectation
```

---

# 33. 当前 P0-D — Delayed Verify 仍未覆盖 OBS T4-T9

目前真实：

```text
MICROTASK verify PASS

RAF verify PASS
```

但：

```text
OBS T4-T9
```

只打印：

```text
OBS-SELECTION
```

没有：

```text
SELECTION-CONTINUITY-VERIFY source=OBS
```

本轮必须接上。

---

# 34. OBS Verify Gate

T4-T9：

如果：

```text
active expectation exists
&& expectation.intentEpoch == current epoch
```

则：

```text
verifyCaretExpectation(source=OBS)
```

---

# 35. OBS Superseded Gate

如果：

```text
expectation.intentEpoch != current epoch
```

则：

```text
CARET-EXPECTATION-CLOSE
reason=SUPERSEDED_BY_USER_INTENT
```

然后：

```text
禁止 verify/restore old expectation
```

---

# 36. Restore Gate 保持严格

只有：

```text
active=true
same epoch
no newer trusted input
target connected
same logical continuity
actual != expected
restoreAttempts=0
```

才允许：

```text
one-shot restore
```

---

# 37. Restore 不得被 normal user movement 触发

测试必须覆盖：

```text
Special command
→ normal Enter

Special command
→ ArrowDown

Special command
→ mouse click

Special command
→ Backspace
```

都必须：

```text
new epoch
old expectation close
restore=0
```

---

# 38. Current P0-E — RUNTIME-IDENTITY-FINAL 仍不完整

最新 final snapshot 只有：

```text
vaultRoot
activeDoc
initializationCount
sessionId
```

缺：

```text
buildId

pluginMainPath
pluginMainExists
pluginMainSha256

projectMainPath
projectMainSha256

shaMatch

stylePath
styleSha256
```

本轮必须补齐。

---

# 39. Runtime Identity 不再允许丢 Build ID 字段

必须统一来自：

```text
INKCHAPTER_BUILD_ID
```

所有：

```text
startup banner
plugin artifact
initialization
runtime identity final
strict startup
report
```

同源。

---

# 40. RUNTIME-IDENTITY-FINAL Contract

必须：

```text
RUNTIME-IDENTITY-FINAL:
reason=file-open
vaultRoot=...
activeDoc=...
pluginMainPath=...
pluginMainExists=true
pluginMainSha256=...
projectMainPath=...
projectMainSha256=...
shaMatch=true
stylePath=...
styleSha256=...
buildId=...
initializationCount=1
sessionId=...
```

---

# 41. Build ID Multi-Way Audit

本轮 Build：

```text
inkchapter-r58-6-7-intent-merge-batch-caret-identity-<unique>
```

必须：

```text
SOURCE
DIST
DEPLOYED
STARTUP_RUNTIME
PLUGIN_ARTIFACT
INITIALIZATION
RUNTIME_IDENTITY_FINAL
FINAL_REPORT
```

全部一致。

---

# 42. Strict Startup Verification

每次 restart：

必须：

```text
old Typora process exited

new PID

StartTime

MainWindowHandle != 0

MainWindowTitle nonempty

target vault exact

target doc exact

plugin main path

plugin main SHA256

project main SHA256

shaMatch=true

style SHA256

Build ID

initializationCount=1
```

---

# 43. 启动语义硬规则

启动命令 exit 0 不等于启动成功。

任一 mandatory 未验证：

```text
启动命令已发出，但尚未确认成功
```

---

# 44. SelectionTruth HARD FREEZE

禁止修改：

```text
resolveSelectionTruth

SELECTION-TRUTH

runtimeId resolution

logicalOffset

sameAsCommand
```

除非出现新 regression。

---

# 45. Split Resolver HARD FREEZE

禁止修改：

```text
SPLIT_1_TO_2 classifier

canonicalOwner/caretDestination resolver

LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

只允许：

```text
connect UserIntent
connect CaretExpectation
connect verify
```

---

# 46. Promotion HARD FREEZE

继续：

```text
bindingVerified=false decision=PROMOTE = 0
```

---

# 47. Live Owner Dominance HARD FREEZE

继续：

```text
MATCH-LIVE-BINDING

HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER
```

---

# 48. Sidecar HARD FREEZE

继续：

```text
physical load/write

PERSISTED_HISTORICAL only persisted birth
```

本轮不要做 GC。

---

# 49. Historical Pollution 继续隔离

当前 sidecar 已：

```text
recordCount 57+
```

historical ambiguity：

```text
multi-owner
→ BLOCK
```

继续保持安全 BLOCK。

本轮不要 compaction。

---

# 50. SyntaxError 继续隔离

启动仍可能：

```text
SyntaxError: Unexpected token ')'
```

但 InkChapter 后续正常 onload。

本轮不因为该 SyntaxError 重写 continuity。

---

# 51. Source Map — User Intent

修改前必须输出：

```text
editor root keydown capture
→ file/function

beforeinput capture
→ file/function

pointer/mousedown capture
→ file/function

special command detection
→ file/function

normal Enter detection
→ file/function

Backspace/Delete
→ file/function

Arrow navigation
→ file/function
```

---

# 52. Source Map — Merge

必须输出：

```text
raw mutation batch
→ file/function

global shape classifier
→ file/function

current canonical owner enumeration
→ file/function

current per-owner loop
→ file/function

markAwaitingTransfer
→ file/function

resolveMergeContinuity
→ file/function

canonicalTransferBinding
→ file/function
```

必须明确指出：

```text
哪个循环导致 first-owner partial commit
```

---

# 53. Source Map — Caret

必须输出：

```text
special expectation creation
→ file/function

split result
→ file/function

merge result
→ file/function

verify helper
→ file/function

OBS T4-T9
→ file/function

restore helper
→ file/function
```

---

# 54. Source Map — Identity

输出：

```text
INKCHAPTER_BUILD_ID
→ file

startup banner
→ file/function

plugin artifact
→ file/function

initialization
→ file/function

runtime identity final
→ file/function

restart verification script
→ path
```

---

# 55. Unit Test MI-1 — Owner Count Unique

输入：

```text
removed P1,P2
R1 owns P1
R2 owns P2
```

必须：

```text
canonicalOwnerCount=2
```

禁止 4。

---

# 56. Unit Test MI-2 — Multi Owner Zero Mutation

输入：

```text
ownerCount=2
```

必须：

```text
decision=BLOCK_MULTI_OWNER

markAwaitingTransfer=0

canonicalTransferBinding=0

generation changes=0
```

---

# 57. Unit Test MI-3 — Single Owner Commit

输入：

```text
ownerCount=1
destination=P3
```

必须：

```text
TRANSFER_SINGLE_OWNER
```

且：

```text
CURRENT_LIVE
→ AWAIT
→ CURRENT_LIVE
```

---

# 58. Unit Test MI-4 — No Owner

ownerCount=0：

```text
NO_CANONICAL_OWNER
```

无 lifecycle mutation。

---

# 59. Unit Test UI-1 — Normal Enter Intent

keydown Enter + beforeinput insertParagraph：

必须只：

```text
epoch +1
```

source：

```text
NORMAL_ENTER
```

---

# 60. Unit Test UI-2 — Backspace Intent

Backspace：

```text
epoch+1
source=BACKSPACE
```

---

# 61. Unit Test UI-3 — Pointer Intent

pointerdown + mousedown：

同一物理 pointer：

```text
epoch+1
```

不是 +2。

---

# 62. Unit Test UI-4 — Mutation Does Not Advance

MutationObserver：

```text
epoch unchanged
```

---

# 63. Unit Test CE-1 — Split Creates Expectation

Split：

```text
canonicalOwner=P6
caretDestination=P5
```

必须：

```text
expected=P5
reason=SPLIT_NEW_PARAGRAPH
```

---

# 64. Unit Test CE-2 — Merge Creates Expectation

single-owner merge：

```text
expected=mergedDestination
reason=MERGE_DESTINATION
```

---

# 65. Runtime Acceptance U1 — Intent Coverage

真实执行并看到：

```text
SPECIAL_COMMAND

NORMAL_ENTER

BACKSPACE

DELETE

KEYBOARD_NAVIGATION

POINTER
```

至少每类 3 次。

---

# 66. Runtime Acceptance U2 — Intent Dedup

全日志检查：

```text
keydown+beforeinput
同一物理动作双增 epoch = 0
```

---

# 67. Runtime Acceptance U3 — Special → Normal Enter Supersession

至少 10 次：

```text
special command
↓
< handoff timeout
↓
normal Enter
```

必须：

```text
new epoch

old expectation close

old handoff close
reason=SUPERSEDED_BY_USER_INTENT
```

后续：

```text
split reason=LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

---

# 68. Runtime Acceptance U4 — User Movement Never Restored Back

每种至少 3 次：

```text
special → ArrowDown
special → pointer click
special → Backspace
```

必须：

```text
new epoch
old expectation close
restore old expectation = 0
```

---

# 69. Runtime Acceptance C1 — Special Verify 10/10

至少 10 次 special：

```text
MICROTASK verified=true
RAF verified=true
OBS verified=true
```

并覆盖 2 秒 observation。

---

# 70. Runtime Acceptance C2 — Split Verify 10/10

normal Enter：

```text
CARET-EXPECTATION-CREATE
reason=SPLIT_NEW_PARAGRAPH
```

10/10：

```text
actual=caretDestination
verified=true
```

---

# 71. Runtime Acceptance C3 — Real Drift One-Shot Restore

只有无新 intent drift：

至少 3 case：

```text
attempt=1
result=SUCCESS
final verify=true
```

---

# 72. Runtime Acceptance M0 — Plain+Plain

3/3：

```text
ownerCount=0
NO_CANONICAL_OWNER
no awaiting
```

---

# 73. Runtime Acceptance M1 — Canonical+Plain

5/5：

```text
ownerCount=1
TRANSFER_SINGLE_OWNER
same record
generation+1
awaiting<2000ms
```

---

# 74. Runtime Acceptance M2 — Plain+Canonical

5/5：

同上。

---

# 75. Runtime Acceptance M3 — Canonical+Canonical

至少 5/5：

```text
ownerCount=2

BLOCK_MULTI_OWNER

canonicalTransferBinding=0

markAwaitingTransfer=0

partial commit=0

element-collision=0

awaiting leak=0
```

这是本轮最高优先级 gate。

---

# 76. Runtime Acceptance M4 — Owner Count Invariant

全日志：

```text
canonicalOwnerCount > removedParagraphCount
= 0
```

---

# 77. Runtime Acceptance M5 — General Awaiting

全日志：

```text
CURRENT_AWAITING_TRANSFER >2000ms
= 0
```

除非明确 separate conflict state，
但 M3 禁止进入 awaiting。

---

# 78. Runtime Acceptance I1 — Final Identity Full

必须完整：

```text
pluginMainPath

pluginMainExists

pluginMainSha256

projectMainSha256

shaMatch

styleSha256

buildId

sessionId

activeDoc

initializationCount
```

---

# 79. Runtime Acceptance I2 — Multi-Way Build Match

必须全部一致。

---

# 80. Runtime Acceptance I3 — Strict Startup

必须：

```text
decision=PASS
```

否则：

```text
启动命令已发出，但尚未确认成功
```

---

# 81. Regression Gates

必须继续：

```text
SelectionTruth regression = 0

undefined+sameAsCommand=true = 0

Mutation Shape downgrade = 0

Split resolver regression = 0

bindingVerified=false decision=PROMOTE = 0

historical blocks exact CURRENT_LIVE owner = 0

Backspace CREATE_NEW = 0

single-dot wrong apply = 0

current-session historical heuristic = 0

physical sidecar PASS
```

---

# 82. 新 Hard Stop List

任一出现：

```text
normal Enter 不推进 intent

Backspace/Delete 不推进 intent

pointer 不推进 intent

同一 keydown+beforeinput epoch 连加两次

MutationObserver 推进 epoch

M3 ownerCount>=2
仍 markAwaitingTransfer

M3 ownerCount>=2
仍 canonicalTransferBinding

M3 first owner wins

M3 second owner element-collision

M3 partial transfer

M3 awaiting leak

canonicalOwnerCount > removedParagraphCount

single-owner merge awaiting >2000ms

Split expectation missing

Split expectation target=canonicalOwner

SELECTION-CONTINUITY-VERIFY source=OBS = 0

old expectation epoch!=current
仍 restore

restore attempts >1

RUNTIME-IDENTITY-FINAL 缺 buildId

RUNTIME-IDENTITY-FINAL 缺 plugin/project/style SHA

Build ID multi-way mismatch

strict startup mandatory missing
```

立即：

```text
R58.6.7 NOT FIXED — R60 BLOCKED
```

---

# 83. 禁止的假修复

禁止：

```text
在 element-collision 后把第二个 record RETIRE
来掩盖 multi-owner bug

让 first owner wins

让 last owner wins

在 per-owner loop 里做 rollback
而不是先 preflight

先 transfer 再发现 conflict

M3 继续进入 AWAIT

把 canonicalRemovedCount 日志手改成 2
但 owner enumeration 仍错误

只补 USER-INTENT-EPOCH 日志
不真正 supersede handoff/expectation

每个 beforeinput 都 epoch++

normal Enter 后 restore old special caret

重新重写 SelectionTruth

重新重写 Split resolver

为解决 Merge 使用 historical heuristic

本轮做 sidecar GC

硬编码 identity values
```

---

# 84. 推荐修改范围

优先：

```text
src/heading-numbering/heading-numbering-service.ts

src/heading-numbering/paragraph-indent-manager.ts

src/heading-numbering/paragraph-indent-forensic.ts

src/main.ts

scripts/restart-typora-test-vault.ps1
```

`paragraph-canonical-registry.ts`：

```text
仅允许增加明确 batch-commit API
或 invariant support。

不要重写 registry identity model。
```

---

# 85. 推荐 Merge Transaction API

可考虑：

```ts
registry.transferSingleOwnerMerge({
  proof,
  destination,
  reason: "LIVE_DOM_MERGE_SINGLE_OWNER",
});
```

前提：

```text
service 已完成 batch preflight
ownerCount===1
```

Registry 内仍需重验 proof，
但 Registry 不负责决定 multi-owner。

---

# 86. Build ID

本轮：

```text
inkchapter-r58-6-7-intent-merge-batch-caret-identity-<unique>
```

---

# 87. Build / Deploy

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

tests total/pass

build exit

SOURCE_BUILD_ID

DIST_BUILD_ID

DEPLOYED_BUILD_ID

project main SHA256

deployed main SHA256

style SHA256

shaMatch
```

---

# 88. Restart + Runtime Acceptance

必须实际：

```text
restart Typora

strict startup verify

open doc.md

run U1-U4

run C1-C3

run M0-M3

collect runtime log
```

不能再停在：

```text
Runtime Acceptance NOT EXECUTED
```

然后宣称 source closure complete。

---

# 89. Strict Restart Rule

必须真实验证：

```text
process
PID
StartTime
HWND
WindowTitle
vault
doc
build
plugin SHA
project SHA
style SHA
initializationCount
```

否则：

```text
启动命令已发出，但尚未确认成功
```

---

# 90. Final Report

必须输出：

```text
## 1. Current Ground Truth
## 2. HARD FREEZE Confirmation
## 3. Source Map — User Intent
## 4. Source Map — Merge
## 5. Source Map — Caret
## 6. Source Map — Runtime Identity
## 7. Trusted User Intent Root Cause
## 8. UserIntentToken
## 9. Event Dedup
## 10. UserIntent Coverage
## 11. Handoff Supersession
## 12. CaretExpectation Supersession
## 13. Merge Root Cause
## 14. Current Per-Owner Partial Commit Path
## 15. MergeBatchContext
## 16. Canonical Owner Enumeration
## 17. Owner Count Invariant
## 18. Merge Preflight
## 19. M0 No Owner
## 20. M1 Single Owner
## 21. M2 Single Owner Reverse Position
## 22. M3 Multi Owner Zero Partial Commit
## 23. Merge Awaiting
## 24. Split CaretExpectation
## 25. Merge CaretExpectation
## 26. OBS Continuity Verify
## 27. One-Shot Restore
## 28. Runtime Identity Final
## 29. Build ID Multi-Way Audit
## 30. Files Changed
## 31. Build ID
## 32. Typecheck
## 33. Tests
## 34. Build
## 35. Deploy SHA
## 36. Strict Startup
## 37. U1 Intent Coverage
## 38. U2 Intent Dedup
## 39. U3 Special→Normal Enter
## 40. U4 User Movement No Restore
## 41. C1 Special Verify 10/10
## 42. C2 Split Verify 10/10
## 43. C3 Drift Restore 3/3
## 44. M0 3/3
## 45. M1 5/5
## 46. M2 5/5
## 47. M3 5/5 Zero Partial Commit
## 48. M4 Owner Count Invariant
## 49. M5 Awaiting Leak
## 50. Identity Final
## 51. Strict Startup Fields
## 52. Regression
## 53. Hard Stop Counts
## 54. Remaining Known Issues
## 55. Final Verdict
```

---

# 91. Final Verdict

最终只能：

```text
R58.6.7 FIXED — R58.6 GUI ACCEPTANCE CONTINUES
```

或者：

```text
R58.6.7 NOT FIXED — R60 BLOCKED
```

注意：

```text
R58.6.7 FIXED
```

不等于：

```text
R60 UNLOCKED
```

还需完成 R58.6 原完整 GUI/runtime acceptance。

任何 mandatory：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

最终必须：

```text
R58.6.7 NOT FIXED — R60 BLOCKED
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
intent epoch
intent dedup
canonical owner count
merge batch decision
partial commit count
awaiting duration
caret expectation
restore result
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

本轮严格按：

```text
Trusted User Intent Coverage
→ Merge Batch Preflight
→ Zero Partial Commit
→ CaretExpectation Lifecycle Completion
→ OBS Verify
→ Runtime Identity Final
→ Strict Startup
```

顺序执行。

不要重新扩大问题范围。
