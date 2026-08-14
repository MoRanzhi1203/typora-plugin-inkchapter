# TRAE P0 — R58.6.6 User Intent Epoch + Caret Expectation Ownership + Handoff Supersession + Merge Forced Acceptance + Runtime Identity De-Hardcode

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Runtime Ownership Closure**
>
> Current authoritative status:
>
> ```text
> R58.6.5 NOT FIXED
> R60 BLOCKED
> ```
>
> 本轮禁止继续把问题简化成“发现 caret drift 就 restore”。
>
> 当前最新 runtime 已证明：
>
> ```text
> SelectionTruth 已能正确读到实际 caret runtimeId；
>
> 但 CaretExpectation / SELECTION-CONTINUITY-VERIFY / restore
> 尚未真正进入 production orchestration；
>
> 同时旧 Special Command handoff
> 仍可能在用户已经开始下一次 normal Enter 后继续存活，
> 并把后续 split 解释成旧 command replacement。
> ```
>
> 因此本轮核心不是“增加更多 selection write”，
> 而是先建立：
>
> ```text
> User Intent Ownership
> ```
>
> 只有当前 expectation / handoff 仍属于当前 user intent epoch，
> 才允许 verify / transfer / restore。

---

# 0. 最新 Runtime Ground Truth

当前实际 runtime Build：

```text
inkchapter-r58-6-5-caret-merge-strict-identity-m4n8q
```

当前真实通过，必须 HARD FREEZE：

```text
SelectionTruth runtime activation

SELECTION-TRUTH source=MUTATION

SELECTION-TRUTH source=OBS

OBS-SELECTION runtimeId=P-RUNTIME-N

sameAsCommand 基于 runtime identity

selParagraph=undefined sameAsCommand=true
→ 已消失

Mutation Shape Authority:
1→1 = REPLACE_1_TO_1
1→2 = SPLIT_1_TO_2
2→1 = MERGE_2_TO_1

Split Resolver:
canonicalOwner != caretDestination

LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH

Proof-Before-Mutation:
bindingVerified=false decision=PROMOTE = 0

Live Owner Dominance:
HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER

CURRENT_LIVE projection-only

physical sidecar load/write

general awaiting leak:
awaitingCount=0

plugin runtime main path:
<target vault>\.typora\plugins\dist\main.js

plugin SHA:
real non-unknown

initializationCount=1

Active Doc:
file-open 后能得到 doc.md
```

---

# 1. 当前 R58.6.5 的真实失败

R58.6.5 source 增加了：

```text
CaretExpectation type

verifyCaretExpectation()

restoreLogicalCaret()

activeCaretExpectation field
```

但真实 runtime 没有：

```text
SELECTION-CONTINUITY-VERIFY

CARET-CONTINUITY-RESTORE

CARET-CONTINUITY-RESTORE-RESULT

CARET-EXPECTATION-CREATE

CARET-EXPECTATION-UPDATE

CARET-EXPECTATION-CLOSE
```

因此：

```text
helper exists
≠
production orchestration exists
```

本轮必须真正接通调用链。

---

# 2. 新发现 — `sameAsCommand=false` 不一定是异常 Drift

真实操作链中：

```text
Special command on P1
↓
T4/T5/T6/T7/T8
selection=P1

用户随后执行 normal Enter
↓
P1 → P6 + P5
selection=P5

再继续编辑/split
↓
selection=P7
```

此时 T9：

```text
actual=P7
sameAsCommand=false
```

这不是 Typora 无故把 caret 漂走。

这是：

```text
用户已经产生了新的真实 intent
```

如果插件把任何：

```text
actual != old expected
```

都当成 drift 并 restore，
会造成插件主动抢回用户光标。

---

# 3. 新 P0：User Intent Epoch

新增：

```ts
type UserIntentSource =
  | "SPECIAL_COMMAND"
  | "NORMAL_ENTER"
  | "KEYBOARD"
  | "BEFORE_INPUT"
  | "POINTER"
  | "SELECTION"
  | "PROGRAMMATIC_CONTINUITY";

interface UserIntentState {
  epoch: number;
  source: UserIntentSource;
  startedAt: number;
  trustedUserInput: boolean;
}
```

Service 至少维护：

```ts
private userIntentEpoch = 0;
private currentUserIntent: UserIntentState;
```

---

# 4. 什么事件必须推进 User Intent Epoch

真实用户输入至少包括：

```text
keydown

beforeinput

normal Enter

ArrowUp

ArrowDown

Backspace

Delete

printable character input

mousedown

pointerdown

click-to-move-caret
```

每次新的 trusted user action：

```text
userIntentEpoch++
```

---

# 5. 不允许 MutationObserver 自己推进 User Intent Epoch

以下不是独立 user intent：

```text
DOM replacement

MutationObserver callback

rehydrate

renderRefresh

semantic projection

visual projection

canonical transfer

sidecar write
```

这些都必须继承当前 user intent epoch。

---

# 6. USER-INTENT-EPOCH Trace

新增：

```text
USER-INTENT-EPOCH:
epoch=18
source=NORMAL_ENTER
trustedUserInput=true
previousEpoch=17
documentKey=doc.md
timestamp=...
```

任何新用户行为必须可审计。

---

# 7. CaretExpectation 必须绑定 Intent Epoch

扩展：

```ts
interface CaretExpectation {
  expectationId: string;

  documentKey: string;

  expectedElement: HTMLElement | null;
  expectedRuntimeId: string;

  expectedLogicalOffset: number | null;

  canonicalRecordId: string | null;

  generation: number;

  reason:
    | "SPECIAL_COMMAND_CURRENT_PARAGRAPH"
    | "SPLIT_NEW_PARAGRAPH"
    | "MERGE_DESTINATION";

  intentEpoch: number;

  restoreAttempts: number;

  active: boolean;

  createdAt: number;
}
```

---

# 8. Handoff 也必须绑定 Intent Epoch

扩展现有 One-Shot Handoff：

```ts
interface ParagraphEnterHandoff {
  ...
  intentEpoch: number;
}
```

Special command：

```text
epoch=17
↓
handoff.intentEpoch=17
caretExpectation.intentEpoch=17
```

---

# 9. 新用户行为必须使旧 Handoff 立即失效

如果：

```text
currentUserIntentEpoch=18
```

而：

```text
handoff.intentEpoch=17
```

则必须：

```text
HANDOFF-CLOSE:
reason=SUPERSEDED_BY_USER_INTENT
handoffEpoch=17
currentEpoch=18
decision=CLOSE
```

不能继续等：

```text
T9 / 2000ms
```

---

# 10. `NO_REPLACEMENT_REQUIRED` 继续 HARD FREEZE

已有：

```text
HANDOFF-CLOSE
reason=NO_REPLACEMENT_REQUIRED
```

继续保留。

新增：

```text
SUPERSEDED_BY_USER_INTENT
```

不是替换旧规则，
而是新增更早、更 authoritative 的生命周期关闭条件。

---

# 11. 旧 Special Handoff 禁止接管后续 Normal Enter

真实错误链：

```text
Special command:
P1

1.6s 后 user normal Enter:
P1 → P6 + P5
```

旧 handoff 当前可能：

```text
HANDOFF-RESOLVE
P1 → P6

CANONICAL-BINDING-TRANSFER
reason=HANDOFF_REPLACE
```

这在 attribution 上是错误的。

正确：

```text
NORMAL_ENTER begins
↓
USER-INTENT-EPOCH 17 → 18
↓
old HANDOFF close:
SUPERSEDED_BY_USER_INTENT
↓
normal split resolver owns mutation
↓
canonicalOwner=P6
caretDestination=P5
↓
transfer reason=
LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

---

# 12. User Intent Supersession Hard Rule

任何：

```text
handoff.intentEpoch
!=
currentUserIntentEpoch
```

必须：

```text
resolveAllowed=false
transferAllowed=false
```

禁止：

```text
old handoff wins because same ordinal matched
```

---

# 13. CaretExpectation Supersession

任何新 trusted user input：

```text
epoch N → N+1
```

所有仍 active 且：

```text
expectation.intentEpoch=N
```

必须：

```text
CARET-EXPECTATION-CLOSE:
reason=SUPERSEDED_BY_USER_INTENT
restoreAttempted=false
```

---

# 14. CaretExpectation 不能跨用户行为长期存活

Special command expectation 只负责：

```text
该 special command 自己的 continuity window
```

不负责：

```text
用户之后 normal Enter
用户点击别处
用户方向键移动
用户继续输入
```

---

# 15. Special Command Expectation Creation

`。。+Enter` 成功 commit 后：

```text
CARET-EXPECTATION-CREATE:
expectationId=...
reason=SPECIAL_COMMAND_CURRENT_PARAGRAPH
intentEpoch=<current>
expectedRuntimeId=<current runtime>
expectedLogicalOffset=0
canonicalRecordId=...
generation=...
decision=ACTIVE
```

---

# 16. Special Command Immediate Verify

创建后必须：

```text
queueMicrotask
→ verify

requestAnimationFrame
→ verify
```

真实输出：

```text
SELECTION-CONTINUITY-VERIFY
```

---

# 17. Selection Continuity Verify Contract

必须：

```text
SELECTION-CONTINUITY-VERIFY:
expectationId=...
intentEpoch=...
currentIntentEpoch=...
reason=...
source=MICROTASK|RAF|OBS
expectedRuntimeId=...
actualRuntimeId=...
expectedLogicalOffset=...
actualLogicalOffset=...
paragraphMatches=...
offsetMatches=...
connected=...
superseded=false|true
verified=true|false
caretWriteAttempted=true|false
```

---

# 18. Restore Gate 不能只看 Runtime Mismatch

只有全部满足：

```ts
expectation.active === true

expectation.intentEpoch === currentUserIntentEpoch

no newer trusted user input

expected target connected

expected target still belongs to same logical continuity

actualRuntimeId !== expectedRuntimeId
or offset mismatch

restoreAttempts === 0
```

才允许 restore。

---

# 19. Restore 被新 User Intent 阻止

如果：

```text
actual != expected
```

但：

```text
expectation.intentEpoch != currentUserIntentEpoch
```

必须：

```text
CARET-RESTORE-BLOCK:
reason=SUPERSEDED_BY_USER_INTENT
```

不得写 selection。

---

# 20. One-Shot Restore

一个 expectation：

```text
restoreAttempts <= 1
```

新增：

```text
CARET-CONTINUITY-RESTORE:
expectationId=...
intentEpoch=...
fromRuntimeId=...
toRuntimeId=...
targetLogicalOffset=...
attempt=1
decision=ATTEMPT
```

随后：

```text
CARET-CONTINUITY-RESTORE-RESULT:
expectationId=...
actualRuntimeId=...
actualLogicalOffset=...
decision=SUCCESS|FAIL
```

---

# 21. Restore 后 Verification

restore 后：

```text
requestAnimationFrame
↓
resolveSelectionTruth()
↓
SELECTION-CONTINUITY-VERIFY
```

成功：

```text
verified=true
```

失败：

```text
CARET-CONTINUITY-RESTORE-FAILED
ACTION=HARD_STOP
```

---

# 22. CaretExpectation Lifecycle

必须：

```text
CREATE
→ ACTIVE
→ VERIFIED
→ CLOSED
```

或者：

```text
CREATE
→ ACTIVE
→ RESTORE_ATTEMPTED
→ VERIFIED
→ CLOSED
```

或：

```text
CREATE
→ ACTIVE
→ SUPERSEDED
→ CLOSED
```

禁止：

```text
无限 ACTIVE
```

---

# 23. Observation T4-T9 行为调整

`OBS-SELECTION` 继续保留 diagnostic。

但 T4-T9 不能用：

```text
sameAsCommand=false
```

直接判断错误。

必须额外看：

```text
active expectation?
intentEpoch still current?
```

如果 expectation 已 superseded：

```text
sameAsCommand=false
```

只能说明：

```text
selection 已离开旧 command paragraph
```

不能触发 restore。

---

# 24. Normal Enter 必须创建新的 Split Expectation

例如：

```text
epoch=18

P1
→ P6 + P5

canonicalOwner=P6
caretDestination=P5
```

Split resolver 成功后：

```text
CARET-EXPECTATION-CREATE:
reason=SPLIT_NEW_PARAGRAPH
intentEpoch=18
expectedRuntimeId=P5
```

---

# 25. Split Expectation 不得使用 Canonical Owner

必须：

```text
expectedRuntimeId=caretDestination
```

禁止：

```text
expectedRuntimeId=canonicalOwner
```

---

# 26. Split HARD FREEZE

继续冻结：

```text
SPLIT_1_TO_2 classification

canonicalOwner/caretDestination separation

LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

只允许新增：

```text
create CaretExpectation
```

---

# 27. Merge Forced Runtime Acceptance 继续执行

当前 source 已有：

```text
resolveMergeContinuity()
```

但 runtime 仍：

```text
MERGE-CONTINUITY-RESOLVE = 0
```

因此本轮必须主动制造真实 merge case。

---

# 28. Merge M0 — Plain + Plain

至少 3 次：

```text
plain P1
plain P2
→ merge P3
```

必须：

```text
mutationShape=MERGE_2_TO_1

canonicalRemovedCount=0

MERGE-CONTINUITY-RESOLVE
decision=NO_CANONICAL_OWNER

AWAIT_TRANSFER=0

CREATE_NEW=0
```

3/3。

---

# 29. Merge M1 — Canonical + Plain

至少 5 次：

```text
P1 canonical R1
P2 plain
→ P3
```

必须：

```text
MERGE-CONTINUITY-RESOLVE
decision=TRANSFER_SINGLE_OWNER

CANONICAL-BINDING-TRANSFER
R1:
P1 → P3

reason=LIVE_DOM_MERGE_SINGLE_OWNER

recordCount unchanged

generation+1
```

5/5。

---

# 30. Merge M2 — Plain + Canonical

至少 5 次：

```text
P1 plain
P2 canonical R1
→ P3
```

必须：

```text
TRANSFER_SINGLE_OWNER
R1 → P3
```

禁止假设 owner 一定是 removed[0]。

---

# 31. Merge M3 — Canonical + Canonical

至少 3 次：

```text
P1=R1
P2=R2
→ P3
```

必须：

```text
MERGE-CANONICAL-CONFLICT
decision=BLOCK_MULTI_OWNER
```

禁止：

```text
first wins
last wins
historical wins
ordinal wins
text wins
```

---

# 32. Merge User Intent Epoch

Backspace/Delete merge 属于新的 trusted user intent。

因此：

```text
USER-INTENT-EPOCH
source=BACKSPACE|DELETE
```

旧 expectation/handoff 必须先 supersede。

Merge 自己建立新：

```text
CaretExpectation
reason=MERGE_DESTINATION
intentEpoch=<new epoch>
```

---

# 33. Merge Caret Expectation

M1/M2 resolved 后：

```text
expectedRuntimeId=mergedDestination
```

必须：

```text
SELECTION-CONTINUITY-VERIFY
reason=MERGE_DESTINATION
actual=expected
verified=true
```

---

# 34. Merge Awaiting Gate

single-owner：

```text
CURRENT_AWAITING_TRANSFER
```

不得：

```text
>2000ms
```

最好：

```text
same continuity transaction
```

完成：

```text
CURRENT_LIVE
```

---

# 35. Runtime Identity 当前新失败 — RUNTIME-IDENTITY-FINAL Build ID 过期

当前 startup：

```text
Business Build:
inkchapter-r58-6-5-caret-merge-strict-identity-m4n8q
```

但 file-open：

```text
RUNTIME-IDENTITY-FINAL:
buildId=inkchapter-r58-6-4-selection-runtime-merge-acceptance-h1j3n
```

说明：

```text
file-open identity path
仍使用旧 hard-coded build string
或 stale constant
```

---

# 36. Runtime Identity 必须去 Hard-Code

新增/复用唯一：

```ts
INKCHAPTER_BUILD_ID
```

所有：

```text
startup banner
PLUGIN-RUNTIME-ARTIFACT
INKCHAPTER-INITIALIZATION
RUNTIME-IDENTITY-FINAL
STRICT-STARTUP-VERIFY
Final Report
```

只能引用同一个 build constant / build artifact。

禁止：

```text
file-open handler 单独写字符串
```

---

# 37. RUNTIME-IDENTITY-FINAL 必须真正扩展

真实 runtime 目前仍只输出：

```text
vaultRoot
activeDoc
initializationCount
buildId
```

本轮必须增加：

```text
pluginMainPath

pluginMainExists

pluginMainSha256

projectMainPath

projectMainSha256

shaMatch

stylePath

styleSha256

sessionId
```

---

# 38. RUNTIME-IDENTITY-FINAL Contract

必须真实 runtime：

```text
RUNTIME-IDENTITY-FINAL:
reason=file-open
vaultRoot=D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
activeDoc=D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\doc.md
pluginMainPath=...
pluginMainExists=true
pluginMainSha256=...
projectMainPath=...
projectMainSha256=...
shaMatch=true
stylePath=...
styleSha256=...
buildId=inkchapter-r58-6-6-intent-caret-handoff-merge-identity-<unique>
initializationCount=1
sessionId=...
```

---

# 39. Build ID Five-Way Audit

本轮 Build：

```text
inkchapter-r58-6-6-intent-caret-handoff-merge-identity-<unique>
```

必须：

```text
SOURCE_BUILD_ID
DIST_BUILD_ID
DEPLOYED_BUILD_ID
RUNTIME_BUILD_ID
RUNTIME_IDENTITY_FINAL_BUILD_ID
FINAL_REPORT_BUILD_ID
```

全部相同。

本轮实际要求 6-way。

---

# 40. Build ID Audit Trace

新增：

```text
BUILD-ID-AUDIT:
source=...
dist=...
deployed=...
runtime=...
runtimeIdentityFinal=...
allMatch=true|false
```

Final Report 再核对 report value。

---

# 41. Strict Startup 继续必须完成

每次本轮重启必须验证：

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

style.css SHA256

Build ID

initializationCount=1
```

任一缺失：

```text
启动命令已发出，但尚未确认成功
```

---

# 42. STRICT-STARTUP-VERIFY Trace

要求：

```text
STRICT-STARTUP-VERIFY:
oldPidExited=true
newPid=...
startTime=...
mainWindowHandle=...
mainWindowTitle=...
targetVault=...
activeDoc=...
pluginMainPath=...
pluginMainSha256=...
projectMainSha256=...
shaMatch=true
styleSha256=...
buildId=...
initializationCount=1
decision=PASS
```

---

# 43. SelectionTruth HARD FREEZE

禁止修改：

```text
resolveSelectionTruth()

SELECTION-TRUTH source=OBS

SELECTION-TRUTH source=MUTATION

runtimeId resolution

logicalOffset resolution

sameAsCommand runtimeId equality
```

除非出现明确新 regression。

---

# 44. Mutation Shape HARD FREEZE

继续：

```text
1→1 REPLACE_1_TO_1
1→2 SPLIT_1_TO_2
2→1 MERGE_2_TO_1
```

---

# 45. Promotion HARD FREEZE

继续：

```text
LiveOwnershipProof before mutation

bindingVerified=false decision=PROMOTE = 0
```

---

# 46. Live Owner Dominance HARD FREEZE

继续：

```text
MATCH-LIVE-BINDING

HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER
```

---

# 47. CURRENT_LIVE Projection HARD FREEZE

继续：

```text
dirty=false
writeScheduled=false
reason=live-projection-only
```

---

# 48. Physical Sidecar HARD FREEZE

继续：

```text
source=physical
backend=filesystem
```

本轮禁止 sidecar compaction。

---

# 49. Historical Ambiguity 不属于本轮

当前 sidecar recordCount 已增长到：

```text
51+
```

并大量：

```text
multi-owner
→ BLOCK
```

继续安全 BLOCK。

禁止：

```text
GC
compaction
migration
first-wins
```

---

# 50. SyntaxError 继续隔离

当前 startup 仍：

```text
SyntaxError: Unexpected token ')'
```

但 InkChapter 后续：

```text
onload START
```

所以本轮：

```text
SyntaxError attribution=UNRESOLVED
```

不要为了这个错误修改 continuity。

---

# 51. Source Map — User Intent

修改前必须输出：

```text
keydown handler
→ file/function

beforeinput handler
→ file/function

normal Enter path
→ file/function

special command Enter path
→ file/function

Backspace/Delete path
→ file/function

pointer/mousedown path
→ file/function

ArrowUp/ArrowDown path
→ file/function
```

---

# 52. Source Map — Handoff

必须输出：

```text
handoff creation
→ file/function

handoff T4-T9 observation
→ file/function

HANDOFF-RESOLVE
→ file/function

HANDOFF-CLOSE NO_REPLACEMENT_REQUIRED
→ file/function

handoff canonical transfer
→ file/function
```

---

# 53. Source Map — CaretExpectation

必须输出：

```text
CaretExpectation type
→ file

activeCaretExpectation field
→ file

verifyCaretExpectation()
→ file/function

restoreLogicalCaret()
→ file/function

current production call sites
→ list all

if zero call site:
must state NOT WIRED
```

---

# 54. Source Map — Merge

输出：

```text
resolveMergeContinuity
→ file/function

MERGE shape classifier
→ file/function

single-owner transfer
→ file/function

multi-owner block
→ file/function

awaiting transfer point
→ file/function
```

---

# 55. Source Map — Runtime Identity

输出：

```text
INKCHAPTER_BUILD_ID source
→ file

startup banner
→ file/function

PLUGIN-RUNTIME-ARTIFACT
→ file/function

INKCHAPTER-INITIALIZATION
→ file/function

RUNTIME-IDENTITY-FINAL
→ file/function

restart verification script
→ path
```

---

# 56. Unit Test U1 — User Intent Increment

每次 trusted user input：

```text
epoch N
→ N+1
```

必须通过。

---

# 57. Unit Test U2 — Mutation Does Not Increment

纯 MutationObserver：

```text
epoch N
→ N
```

---

# 58. Unit Test U3 — Handoff Superseded

```text
handoff epoch=10
current epoch=11
```

必须：

```text
resolveAllowed=false
transferAllowed=false
closeReason=SUPERSEDED_BY_USER_INTENT
```

---

# 59. Unit Test U4 — CaretExpectation Superseded

```text
expectation epoch=10
current epoch=11
```

必须：

```text
restoreAllowed=false
closeReason=SUPERSEDED_BY_USER_INTENT
```

---

# 60. Unit Test U5 — Valid Drift Restore

```text
expectation epoch=10
current epoch=10
actual!=expected
restoreAttempts=0
```

允许：

```text
restore attempt=1
```

---

# 61. Unit Test U6 — New User Input Blocks Restore

```text
expectation epoch=10
current epoch=11
actual!=expected
```

必须：

```text
CARET-RESTORE-BLOCK
reason=SUPERSEDED_BY_USER_INTENT
```

---

# 62. Unit Test U7 — Split New Expectation

normal Enter：

```text
epoch=11
canonicalOwner=P6
caretDestination=P5
```

必须：

```text
new expectation epoch=11
expected=P5
```

---

# 63. Unit Test U8 — Old Handoff Does Not Own Split

Special handoff epoch=10，
normal Enter epoch=11：

必须：

```text
old handoff closed
```

且 transfer reason 只能是：

```text
LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

不能：

```text
HANDOFF_REPLACE
```

---

# 64. Runtime Acceptance A1 — Special Command Stable 10/10

至少 10 次：

```text
。。+Enter
```

如果用户 2.2s 内不做任何新输入：

```text
expectation remains same epoch
```

必须：

```text
SELECTION-CONTINUITY-VERIFY
verified=true
```

10/10。

---

# 65. Runtime Acceptance A2 — Real Drift Repair 3/3

只有在：

```text
没有新 user intent
```

前提下，
如果 actual drift：

```text
actual != expected
```

必须：

```text
restore attempt=1
→ result SUCCESS
→ verify true
```

至少 3 个真实/可控 drift case。

---

# 66. Runtime Acceptance A3 — User Movement Must Never Be Repaired Back

至少执行：

```text
Special command
↓
ArrowDown
```

以及：

```text
Special command
↓
normal Enter
```

以及：

```text
Special command
↓
mouse click another paragraph
```

每种至少 3 次。

必须：

```text
USER-INTENT-EPOCH increment

old expectation closed
reason=SUPERSEDED_BY_USER_INTENT

CARET-CONTINUITY-RESTORE = 0 for old expectation
```

---

# 67. Runtime Acceptance A4 — Handoff Supersession 10/10

至少 10 次：

```text
Special command
↓
在 handoff timeout 前 normal Enter
```

必须：

```text
HANDOFF-CLOSE
reason=SUPERSEDED_BY_USER_INTENT
```

且后续 split：

```text
CANONICAL-BINDING-TRANSFER
reason=LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

不得：

```text
reason=HANDOFF_REPLACE
```

---

# 68. Runtime Acceptance A5 — Split Caret 10/10

normal Enter：

```text
CaretExpectation reason=SPLIT_NEW_PARAGRAPH
expected=caretDestination
```

必须 10/10：

```text
actual=expected
verified=true
```

---

# 69. Runtime Acceptance A6 — Restore Duplicate Zero

全日志：

```text
same expectationId restore attempt >1
= 0
```

---

# 70. Runtime Acceptance M0-M3

必须：

```text
M0 plain+plain 3/3
M1 canonical+plain 5/5
M2 plain+canonical 5/5
M3 canonical+canonical 3/3 BLOCK
```

---

# 71. Runtime Acceptance I1 — Runtime Identity Final

必须完整输出：

```text
pluginMainPath
pluginMainExists
pluginMainSha256
projectMainSha256
shaMatch
styleSha256
sessionId
activeDoc
buildId
initializationCount
```

---

# 72. Runtime Acceptance I2 — Build ID De-Hardcode

必须：

```text
startup build
=
plugin artifact build
=
runtime identity final build
=
source build
=
dist build
=
deployed build
=
final report build
```

---

# 73. Runtime Acceptance I3 — Strict Startup

必须完整 PASS。

否则：

```text
启动命令已发出，但尚未确认成功
```

---

# 74. Regression Gates

必须继续：

```text
SelectionTruth regression = 0

selParagraph=undefined sameAsCommand=true = 0

Mutation Shape downgrade = 0

SPLIT resolver regression = 0

bindingVerified=false decision=PROMOTE = 0

historical blocks exact CURRENT_LIVE owner = 0

Backspace CREATE_NEW = 0

single-dot wrong apply = 0

current-session historical heuristic = 0

general awaiting leak = 0

physical sidecar PASS
```

---

# 75. 新 Hard Stop List

任一出现：

```text
UserIntentEpoch 未实现

trusted user input 不推进 epoch

MutationObserver 自己推进 epoch

old handoff epoch != current
仍执行 HANDOFF-RESOLVE

old handoff hijacks normal Enter split

normal Enter 后 transfer reason=HANDOFF_REPLACE

old expectation epoch != current
仍执行 restore

Special command + ArrowDown 后
插件把 caret restore 回 old paragraph

Special command + click 后
插件把 caret restore 回 old paragraph

SELECTION-CONTINUITY-VERIFY = 0

CARET-EXPECTATION-CREATE = 0

restore attempt >1

restore FAILED

split expectation uses canonicalOwner instead of caretDestination

MERGE runtime acceptance 未执行

M1/M2 BLOCK

M3 TRANSFER

RUNTIME-IDENTITY-FINAL buildId 仍为旧 R58.6.4/R58.6.5 hard-coded value

RUNTIME-IDENTITY-FINAL 缺 plugin/project/style SHA

Build ID 多方不一致

strict startup mandatory field missing
```

立即：

```text
R58.6.6 NOT FIXED — R60 BLOCKED
```

---

# 76. 禁止的假修复

禁止：

```text
发现 sameAsCommand=false 就强制 restore

仅根据 T9 判断 caret drift

不区分用户主动移动和非预期 drift

用 setTimeout 轮询抢 caret

ArrowDown interception

全局 keydown preventDefault

为了防旧 handoff
直接把 handoff timeout 改成 0

删除 handoff 功能

重新重写 Split resolver

重新重写 SelectionTruth

把 normal Enter split 继续记为 HANDOFF_REPLACE

只加 USER-INTENT-EPOCH 日志
但不真正 gate handoff/restore

把 RUNTIME-IDENTITY-FINAL buildId 手改成新字符串
但仍有多个 build source

硬编码 activeDoc

硬编码 shaMatch=true

Merge 未执行但报告 PASS

本轮做 sidecar GC
```

---

# 77. 推荐修改范围

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
除非 Merge forced acceptance
真实暴露 registry bug，
否则不要主动重写。
```

---

# 78. Build ID

本轮：

```text
inkchapter-r58-6-6-intent-caret-handoff-merge-identity-<unique>
```

---

# 79. Build / Deploy

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
test count
build exit

SOURCE_BUILD_ID
DIST_BUILD_ID
DEPLOYED_BUILD_ID

project main.js SHA256
deployed main.js SHA256
style.css SHA256
shaMatch
```

---

# 80. Restart + Verify

必须真实重启 Typora。

禁止仅：

```text
build + deploy
```

后写：

```text
runtime NOT EXECUTED
```

必须：

```text
restart
↓
strict startup verify
↓
open doc.md
↓
execute A1-A6
↓
execute M0-M3
↓
collect runtime log
```

---

# 81. Strict Restart Rule

启动命令成功 != Typora 已成功启动。

必须验证：

```text
old process exit
new PID
StartTime
MainWindowHandle
MainWindowTitle
target vault
target doc
plugin bundle
SHA256
Build ID
initializationCount
```

否则必须原样：

```text
启动命令已发出，但尚未确认成功
```

---

# 82. Final Report

必须输出：

```text
## 1. Current Ground Truth
## 2. HARD FREEZE Confirmation
## 3. Source Map — User Intent
## 4. Source Map — Handoff
## 5. Source Map — CaretExpectation
## 6. Source Map — Merge
## 7. Source Map — Runtime Identity
## 8. User Intent Root Cause
## 9. UserIntentEpoch Implementation
## 10. Intent Increment Sources
## 11. Mutation Non-Increment Rule
## 12. Handoff Intent Ownership
## 13. SUPERSEDED_BY_USER_INTENT
## 14. CaretExpectation Intent Ownership
## 15. CaretExpectation Creation
## 16. CaretExpectation Supersession
## 17. SELECTION-CONTINUITY-VERIFY
## 18. One-Shot Restore Gate
## 19. User-Movement Restore Block
## 20. Split Expectation
## 21. Merge Expectation
## 22. Merge Forced Acceptance
## 23. Runtime Identity De-Hardcode
## 24. RUNTIME-IDENTITY-FINAL Fields
## 25. Build ID Multi-Way Audit
## 26. Files Changed
## 27. Build ID
## 28. Typecheck
## 29. Tests
## 30. Build
## 31. Deploy SHA256
## 32. Strict Startup
## 33. A1 Special Command Stable 10/10
## 34. A2 Real Drift Repair 3/3
## 35. A3 User Movement Never Restored
## 36. A4 Handoff Supersession 10/10
## 37. A5 Split Caret 10/10
## 38. A6 Duplicate Restore Zero
## 39. M0 Plain+Plain 3/3
## 40. M1 Canonical+Plain 5/5
## 41. M2 Plain+Canonical 5/5
## 42. M3 Multi-Owner 3/3
## 43. Merge Awaiting
## 44. Runtime Identity Final
## 45. Strict Startup Fields
## 46. Regression
## 47. Hard Stop Counts
## 48. Remaining Known Issues
## 49. Final Verdict
```

---

# 83. Final Verdict

最终只能：

```text
R58.6.6 FIXED — R58.6 GUI ACCEPTANCE CONTINUES
```

或者：

```text
R58.6.6 NOT FIXED — R60 BLOCKED
```

注意：

```text
R58.6.6 FIXED
```

仍然不等于：

```text
R60 UNLOCKED
```

只有 R58.6 原完整 GUI/runtime acceptance 全部完成后，
才允许讨论 R60。

任何 mandatory：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

最终必须：

```text
R58.6.6 NOT FIXED — R60 BLOCKED
```

---

# 84. Execution Rules

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
UserIntentEpoch
trusted user input
handoff epoch
CaretExpectation epoch
restore eligibility
restore result
merge case
merge owner
merge destination
merge pass count
awaiting duration
plugin SHA
project SHA
style SHA
Build ID
PID
StartTime
HWND
WindowTitle
runtime acceptance count
```

本轮严格按：

```text
User Intent Epoch
→ Handoff Supersession
→ CaretExpectation Ownership
→ Verify / One-Shot Restore
→ Split/Merge expectation
→ Merge Forced Acceptance
→ Runtime Identity De-Hardcode
→ Strict Startup
```

顺序执行。

不要重新扩大问题范围。
