# TRAE P0 — R58.6.3 Unified Selection Truth + MERGE_2_TO_1 Continuity + Runtime Identity Verification

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Runtime Closure**
>
> Current authoritative status:
>
> ```text
> R58.6.2 NOT FIXED
> R60 BLOCKED
> ```
>
> 本轮不要重写 canonical architecture。
>
> 只关闭 3 个剩余 runtime 缺口：
>
> 1. Unified Selection Truth：统一 OBS-SELECTION / MutationObserver / POST-TOKEN-SELECTION / Split Resolver / Caret Verify 的 selection identity；
> 2. MERGE_2_TO_1 Single-Owner Continuity：修复 merge 被安全 BLOCK 后永久 CURRENT_AWAITING_TRANSFER；
> 3. Runtime Identity Verification：修复 plugin artifact path / plugin SHA / active doc / initializationCount 的严格启动证据。
>
> 只有这三项真实闭环后，才继续 R58.6 GUI acceptance。

---

# 0. 最新 Runtime Ground Truth

最新 runtime Build：

```text
inkchapter-r58-6-2-shape-split-proof-selection-w4k1z
```

最新 runtime 已真实证明以下链路工作，必须 HARD FREEZE：

```text
Mutation Shape Authority:
1→2 = SPLIT_1_TO_2
2→1 = MERGE_2_TO_1

SPLIT_1_TO_2 resolver:
caretDestination resolved
canonicalOwner resolved
canonicalOwner != caretDestination

CANONICAL-BINDING-TRANSFER:
reason=LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH

Proof-Before-Mutation:
LIVE-OWNERSHIP-PROOF VALID
→ PROMOTE

invalid proof:
PROMOTION-LIFECYCLE-VIOLATION
decision=BLOCK

HANDOFF-CLOSE:
reason=NO_REPLACEMENT_REQUIRED

Live Owner Dominance:
HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER

CURRENT_LIVE projection-only:
dirty=false
writeScheduled=false

physical sidecar:
source=physical
backend=filesystem

Backspace:
no CREATE_NEW observed

single-dot:
no wrong apply observed
```

禁止重新推翻这些链路。

---

# 1. Runtime Failure A — Selection Truth 仍然分裂

最新 runtime 同时出现：

```text
EDITOR-MUTATION-BATCH:
selectionRuntimeId=P-RUNTIME-22
```

但 Observation：

```text
OBS-SELECTION:
selParagraph=undefined
sameAsCommand=true
```

并且多次出现：

```text
selParagraph=undefined
sameAsCommand=true
```

这是逻辑矛盾。

说明至少存在两套 selection identity：

```text
MutationObserver / Split Resolver
→ 能解析 runtimeId

OBS-SELECTION
→ 无法解析 paragraph
```

---

# 2. Unified Selection Truth

新增唯一 authoritative API：

```ts
interface SelectionTruth {
  selectionExists: boolean;

  paragraph: HTMLElement | null;
  runtimeId: string | null;
  ordinal: number | null;

  logicalOffset: number | null;

  collapsed: boolean;

  anchorNodeConnected: boolean;
  focusNodeConnected: boolean;

  insideEditor: boolean;
}

function resolveSelectionTruth(
  editorRoot: HTMLElement
): SelectionTruth;
```

整个插件的：

```text
Selection
→ paragraph
→ runtimeId
→ local logical offset
```

只能由这个 API 决定。

---

# 3. Selection Node Resolution

必须同时支持：

```text
TextNode
HTMLElement
```

推荐语义：

```ts
function resolveSelectionParagraphElement(
  node: Node | null,
  editorRoot: HTMLElement
): HTMLElement | null {
  if (!node) return null;

  const base =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : node instanceof HTMLElement
        ? node
        : null;

  if (!base) return null;

  const paragraph = resolveSupportedBodyParagraph(base);

  if (!paragraph) return null;
  if (!editorRoot.contains(paragraph)) return null;

  return paragraph;
}
```

注意：

```text
resolveSupportedBodyParagraph()
```

必须复用现有 adapter/editor paragraph taxonomy，
不要另写一套不一致 selector。

---

# 4. logicalOffset 必须是 Paragraph-Local

当前 OBS-SELECTION 仍有：

```text
cursorOffset=89
```

禁止继续用全局 cursorOffset 判断 paragraph identity。

新增/统一：

```ts
getLogicalOffsetWithinParagraph(
  paragraph: HTMLElement,
  anchorNode: Node,
  anchorOffset: number
): number | null
```

要求：

```text
logicalOffset
=
当前 paragraph 内相对位置
```

不是：

```text
document-global cursor offset
```

---

# 5. sameAsCommand Hard Rule

以后：

```ts
sameAsCommand =
  selectionTruth.runtimeId !== null &&
  selectionTruth.runtimeId === expectedCaretRuntimeId;
```

禁止：

```text
cursorOffset 相等
ordinal 相等
旧 originalElement 相等
```

代替 paragraph identity。

硬规则：

```text
selectionTruth.runtimeId=null
→ sameAsCommand=false
```

因此必须做到：

```text
selParagraph=undefined sameAsCommand=true = 0
```

---

# 6. Observation Target 不能永远绑定 originalElement

特殊命令开始：

```text
original=P1
```

如果 continuity 后：

```text
P1 → P6
```

后续 observation 必须更新 expected target。

新增：

```ts
interface CaretExpectation {
  expectedElement: HTMLElement;
  expectedRuntimeId: string;

  expectedLogicalOffset: number | null;

  generation: number;

  reason:
    | "SPECIAL_COMMAND_CURRENT_PARAGRAPH"
    | "SPLIT_NEW_PARAGRAPH"
    | "MERGE_DESTINATION";
}
```

---

# 7. CaretExpectation — Special Indent Enter

对于：

```text
。。+Enter
```

业务语义：

```text
canonical owner
=
caret destination
=
当前逻辑 paragraph
```

command 后：

```text
expectedLogicalOffset=0
```

如果当前 paragraph replacement：

```text
P1 → P6
```

则：

```text
expectedRuntimeId
P1 → P6
```

Observation 不能继续检查 detached P1。

---

# 8. CaretExpectation — Normal Enter Split

最新 runtime 已能：

```text
P21
→ P23 + P22

canonicalOwner=P23
caretDestination=P22
```

因此：

```text
expectedCaretRuntimeId=P22
```

绝不能把：

```text
canonicalOwner=P23
```

当成 caret target。

---

# 9. CaretExpectation — Merge

对于：

```text
P3 + P4
→ P21
```

如果 merge resolved：

```text
expectedCaretRuntimeId=P21
```

必须从统一 SelectionTruth 验证。

---

# 10. 所有 Selection Consumer 必须统一

以下全部必须调用：

```text
resolveSelectionTruth()
```

禁止自行解析：

```text
EDITOR-MUTATION-BATCH

OBS-SELECTION

POST-TOKEN-SELECTION

SPLIT-CARET-DESTINATION

MERGE-CARET-DESTINATION

POST-HANDOFF verification

CARET-CONTINUITY verification

CARET-NAVIGATION-AUDIT
```

---

# 11. Selection Consistency Trace

新增：

```text
SELECTION-TRUTH
```

字段：

```text
source
runtimeId
ordinal
logicalOffset
collapsed
anchorConnected
focusConnected
insideEditor
```

同一个 event cycle 允许不同 source 调用，
但必须得到同一个 runtimeId。

---

# 12. Selection Divergence Hard Diagnostic

新增：

```text
SELECTION-TRUTH-DIVERGENCE
```

当同一 observation cycle：

```text
EDITOR-MUTATION-BATCH runtimeId=P22
OBS-SELECTION runtimeId=null
```

或：

```text
POST-TOKEN-SELECTION runtimeId=P8
OBS-SELECTION runtimeId=P7
```

必须：

```text
ACTION=HARD_STOP
```

---

# 13. Selection Continuity Verification

新增：

```text
SELECTION-CONTINUITY-VERIFY
```

字段：

```text
continuityId
reason
expectedRuntimeId
actualRuntimeId
expectedLogicalOffset
actualLogicalOffset
paragraphMatches
connected
verified
```

时机：

```text
continuity transfer
↓
microtask verify
↓
RAF verify
```

---

# 14. Caret Repair 规则

如果：

```text
verified=true
```

则：

```text
caretWriteAttempted=false
```

只有：

```text
expected destination 已明确
+
actual selection 错误
```

才允许一次：

```text
restoreLogicalCaret()
```

禁止：

```text
每次 refresh 抢焦点
无限 setTimeout
ArrowDown interception
```

---

# 15. Runtime Failure B — MERGE_2_TO_1 被安全 BLOCK 后永久 Awaiting

最新 runtime 已正确分类：

```text
removedParagraphCount=2
addedParagraphCount=1

mutationShape=MERGE_2_TO_1
```

并正确没有降格为 1→1。

但当前：

```text
LIVE-REPLACEMENT-BLOCK
reason=unsafe-shape-for-transfer
```

之前 canonical record 已：

```text
CURRENT_LIVE
→ CURRENT_AWAITING_TRANSFER
```

然后长期：

```text
CURRENT_AWAITING_TRANSFER
```

出现超过几十秒的 leak。

所以：

```text
Shape Authority = PASS
Merge Continuity = FAIL
```

---

# 16. MERGE_2_TO_1 Resolver

新增：

```ts
interface MergeContinuityResolution {
  mergedDestination: HTMLElement | null;

  caretDestination: HTMLElement | null;

  canonicalRecordId: string | null;

  decision:
    | "TRANSFER_SINGLE_OWNER"
    | "NO_CANONICAL_OWNER"
    | "BLOCK_MULTI_OWNER"
    | "BLOCK_AMBIGUOUS";

  evidence: string[];
}
```

---

# 17. MERGE Case M0 — No Canonical Owner

如果：

```text
removed=2
added=1
canonicalRemovedCount=0
```

必须：

```text
decision=NO_CANONICAL_OWNER
```

不创建 canonical continuity ticket。

不进入：

```text
CURRENT_AWAITING_TRANSFER
```

---

# 18. MERGE Case M1 — Single Canonical Owner

如果：

```text
removed=2
added=1
canonicalRemovedCount=1
```

且：

```text
same mutation batch
same document
same editor root
unique added paragraph
added paragraph connected
added paragraph not already canonically owned
record generation current
```

则：

```text
decision=TRANSFER_SINGLE_OWNER
```

---

# 19. Single-Owner Merge Transfer

例如：

```text
P3 = canonical owner R1
P4 = plain paragraph

P3 + P4
→ P21
```

必须：

```text
R1 → P21
```

执行：

```text
CANONICAL-BINDING-TRANSFER
fromRuntimeId=P3
toRuntimeId=P21
reason=LIVE_DOM_MERGE_SINGLE_OWNER
```

并：

```text
recordCount unchanged
generation +1
old owner invalidated
new owner established
```

---

# 20. Merge Semantic Continuity

如果 R1：

```text
semantic=force-indent
```

则 P21：

```text
semantic=force-indent
```

不能：

```text
auto
```

也不能：

```text
CREATE_NEW
```

---

# 21. MERGE Case M2 — Two Canonical Owners

如果：

```text
removed=2
added=1
canonicalRemovedCount=2
```

这是 business identity conflict。

必须：

```text
MERGE-CANONICAL-CONFLICT
decision=BLOCK_MULTI_OWNER
```

禁止：

```text
first owner wins
last owner wins
ordinal heuristic
text heuristic
historical heuristic
```

---

# 22. Multi-Owner Merge 状态处理

`BLOCK_MULTI_OWNER` 不能静默永久：

```text
CURRENT_AWAITING_TRANSFER
```

必须进入显式 conflict state 或至少独立 conflict registry。

如果本轮不扩展 lifecycle enum，
允许保留：

```text
CURRENT_AWAITING_TRANSFER
```

但必须同时：

```text
reason=MERGE_MULTI_OWNER_CONFLICT
```

并从普通 leak audit 中区分出来。

禁止把真正 conflict 当普通 unresolved replacement。

---

# 23. MERGE Case M3 — Ambiguous Structure

如果：

```text
addedCount != 1
parent mismatch
document mismatch
destination disconnected
owner collision
```

则：

```text
decision=BLOCK_AMBIGUOUS
```

说明真实 reason。

---

# 24. Merge Caret Destination

对于 2→1：

```text
unique added paragraph
=
merged destination
```

如果 unified SelectionTruth：

```text
runtimeId == mergedRuntimeId
```

则：

```text
caretDestination=mergedDestination
```

输出：

```text
MERGE-CARET-DESTINATION
decision=RESOLVED
```

---

# 25. Merge Ticket

建议新增：

```ts
interface MergeContinuityTicket {
  ticketId: string;

  documentKey: string;

  removedRuntimeIds: string[];

  canonicalRemovedRecords: {
    recordId: string;
    runtimeId: string;
    generation: number;
    element: HTMLElement;
  }[];

  mergedDestination: HTMLElement;

  caretDestination: HTMLElement | null;

  createdAt: number;
}
```

不要复用含义模糊的 generic 1→1 ticket。

---

# 26. Merge Runtime Trace

必须：

```text
MERGE-CONTINUITY-TICKET

MERGE-CONTINUITY-RESOLVE

MERGE-CARET-DESTINATION
```

成功：

```text
MERGE-CONTINUITY-RESOLVE
decision=TRANSFER_SINGLE_OWNER
```

冲突：

```text
MERGE-CONTINUITY-RESOLVE
decision=BLOCK_MULTI_OWNER
```

---

# 27. 关键流程顺序调整

当前错误顺序：

```text
removed canonical detected
↓
立即 AWAIT_TRANSFER
↓
发现 MERGE
↓
BLOCK
↓
永久 awaiting
```

改为：

```text
Mutation batch
↓
authoritative shape
↓
resolve continuity decision
↓
如果 TRANSFER:
  AWAIT_TRANSFER
  → TRANSFER
  在同一 continuity transaction 内完成

如果 NO_CANONICAL_OWNER:
  不进入 awaiting

如果 BLOCK_MULTI_OWNER:
  明确 conflict
```

---

# 28. Awaiting Leak Gate

对：

```text
MERGE_2_TO_1
canonicalRemovedCount=1
unique destination
```

如果：

```text
awaitingForMs > 2000
```

必须：

```text
CONTINUITY-RESOLUTION-LEAK
reason=merge-single-owner-resolvable
ACTION=HARD_STOP
```

实际上建议：

```text
< 1 editor cycle
```

就完成 transfer。

---

# 29. Split HARD FREEZE

当前 Split 已真实做到：

```text
SPLIT-CARET-DESTINATION
decision=RESOLVED

EDITOR-CONTINUITY-RESOLVE
canonicalOwner != caretDestination

CANONICAL-BINDING-TRANSFER
reason=LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

本轮禁止重写 Split 主算法。

只允许：

```text
把 selection source 改为 Unified SelectionTruth
```

---

# 30. Promotion HARD FREEZE

当前已真实看到：

```text
LIVE-OWNERSHIP-PROOF
decision=VALID

→ PROMOTE
```

非法 proof：

```text
PROMOTION-LIFECYCLE-VIOLATION
decision=BLOCK
```

本轮禁止再重写 Promotion 主路径。

只允许补 regression test。

---

# 31. Mutation Shape HARD FREEZE

继续保持：

```text
1→1 = REPLACE_1_TO_1
1→2 = SPLIT_1_TO_2
2→1 = MERGE_2_TO_1
```

禁止再按 canonical participant count 改 shape。

---

# 32. Handoff HARD FREEZE

继续：

```text
HANDOFF-CLOSE
reason=NO_REPLACEMENT_REQUIRED
```

禁止延长 handoff TTL。

---

# 33. Live Owner Dominance HARD FREEZE

继续：

```text
HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER
```

禁止 historical candidate 阻塞 exact CURRENT_LIVE owner。

---

# 34. Runtime Failure C — Plugin Runtime Identity 仍错误

当前 runtime 仍：

```text
Plugin Artifact Path:
D:\Typora\resources\electron.asar\renderer\main.js

Plugin SHA256:
unknown

Active Doc:
unknown
```

说明：

```text
strict startup verification = FAIL
```

---

# 35. Runtime Identity Verification 独立处理

不要为修 plugin path 修改 paragraph continuity。

优先从 authoritative：

```text
vault.path
```

和真实插件部署结构得到 plugin bundle。

目标不是“猜一个路径”，而是：

```text
candidate path
↓
fs.existsSync
↓
real file
↓
SHA256
```

---

# 36. Plugin Artifact Path Strategy

优先候选：

```text
<targetVault>\.typora\plugins\dist\main.js
```

如果真实 manifest 表明插件有独立目录：

```text
<targetVault>\.typora\plugins\<plugin-id>\dist\main.js
```

以真实 filesystem 和 loader manifest 为准。

禁止继续以：

```text
__dirname
document.currentScript
electron renderer module
```

作为 authoritative plugin path。

---

# 37. PLUGIN-RUNTIME-ARTIFACT

必须：

```text
pluginMainPath=<real deployed InkChapter main.js>
exists=true

pluginMainSha256=<real sha>

projectMainSha256=<dist sha>

shaMatch=true

buildId=<current build>
```

---

# 38. Active Document

当前：

```text
Active Doc: unknown
```

必须改成真实：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\doc.md
```

或等价 authoritative relative path：

```text
doc.md
```

来源必须是：

```text
workspace/vault active file context
```

禁止硬编码。

---

# 39. initializationCount

新增：

```text
INKCHAPTER-INITIALIZATION
```

字段：

```text
buildId
initializationCount
sessionId
timestamp
```

严格要求：

```text
initializationCount=1
```

同一 fresh restart：

```text
>1
```

则：

```text
HARD STOP
```

---

# 40. Strict Startup Gate

必须同时验证：

```text
old Typora process exited

new PID

StartTime

MainWindowHandle != 0

MainWindowTitle nonempty

target vault exact

target document exact

plugin main path exact/exists

plugin SHA256

project SHA256

shaMatch=true

style SHA256

Build ID exact

initializationCount=1
```

任一缺失：

```text
启动命令已发出，但尚未确认成功
```

---

# 41. Build ID

本轮使用：

```text
inkchapter-r58-6-3-selection-merge-runtime-identity-<unique>
```

source / dist / deployed / runtime / verification 必须一致。

---

# 42. Unit Test S1 — TextNode Selection

Selection anchor 是 TextNode：

```text
resolveSelectionTruth()
```

必须正确得到：

```text
paragraph
runtimeId
logicalOffset
```

---

# 43. Unit Test S2 — Element Selection

Selection anchor 是 HTMLElement：

必须正确得到同一 paragraph identity。

---

# 44. Unit Test S3 — Null RuntimeId

如果：

```text
runtimeId=null
```

必须：

```text
sameAsCommand=false
```

---

# 45. Unit Test S4 — Continuity Target Update

```text
expected=P1
P1 → P6 transfer
```

之后：

```text
CaretExpectation.expectedRuntimeId=P6
```

---

# 46. Unit Test M1 — Merge No Owner

```text
2 removed
1 added
canonicalRemovedCount=0
```

必须：

```text
NO_CANONICAL_OWNER
no AWAIT_TRANSFER
```

---

# 47. Unit Test M2 — Merge Single Owner

```text
P3 canonical
P4 plain
→ P21
```

必须：

```text
TRANSFER_SINGLE_OWNER
R1→P21
same record
generation+1
```

---

# 48. Unit Test M3 — Merge Multi Owner

```text
P3=R1
P4=R2
→ P21
```

必须：

```text
BLOCK_MULTI_OWNER
```

禁止 transfer。

---

# 49. Unit Test M4 — Merge Caret

如果 Selection：

```text
P21
```

必须：

```text
MERGE-CARET-DESTINATION
runtimeId=P21
decision=RESOLVED
```

---

# 50. Runtime Acceptance S1 — Selection Truth Consistency

至少 20 个 observation。

必须：

```text
SELECTION-TRUTH-DIVERGENCE = 0
```

---

# 51. Runtime Acceptance S2 — No Undefined/True Contradiction

必须：

```text
selParagraph=undefined sameAsCommand=true = 0
```

---

# 52. Runtime Acceptance S3 — Command Caret

至少 10 次：

```text
。。+Enter
```

必须：

```text
expectedRuntimeId
=
actualRuntimeId

expectedLogicalOffset=0
actualLogicalOffset=0

SELECTION-CONTINUITY-VERIFY
verified=true
```

10/10。

---

# 53. Runtime Acceptance S4 — Split Caret

至少 10 次 normal Enter split：

```text
canonicalOwner != caretDestination

actual selection
=
caretDestination
```

10/10。

---

# 54. Runtime Acceptance M1 — Merge Single Owner 10/10

至少 10 次：

```text
2→1
canonicalRemovedCount=1
```

必须：

```text
MERGE-CONTINUITY-RESOLVE
decision=TRANSFER_SINGLE_OWNER

CANONICAL-BINDING-TRANSFER
reason=LIVE_DOM_MERGE_SINGLE_OWNER

recordCount unchanged
generation+1
```

10/10。

---

# 55. Runtime Acceptance M2 — No Permanent Awaiting

对 merge single-owner：

```text
CURRENT_AWAITING_TRANSFER
```

不得超过：

```text
2000ms
```

建议：

```text
same continuity transaction
```

即完成 transfer。

---

# 56. Runtime Acceptance M3 — Merge Multi Owner Safety

至少 3 次 synthetic/unit runtime case：

```text
2 canonical owners
→ 1 paragraph
```

必须：

```text
BLOCK_MULTI_OWNER
```

不得：

```text
first wins
```

---

# 57. Runtime Acceptance U1 — Full User Flow

至少 10 次：

```text
输入 “。。”
→ Enter
→ 当前段首行缩进
→ caret 在当前段

输入正文
→ normal Enter
→ completed old paragraph 保持 force-indent
→ new paragraph auto
→ caret 在新 paragraph

Backspace merge
→ single owner continuity 正确
→ canonical 不丢
→ 不永久 awaiting

↑ ↓
→ 正常
```

10/10。

---

# 58. Runtime Acceptance U2 — Regression

必须继续：

```text
Mutation Shape downgrade = 0

SPLIT resolver regression = 0

bindingVerified=false decision=PROMOTE = 0

stale handoff transfer = 0

historical blocks exact live owner = 0

Backspace CREATE_NEW = 0

single-dot wrong apply = 0

current-session historical heuristic = 0

physical sidecar PASS
```

---

# 59. Runtime Acceptance R1 — Plugin Identity

必须：

```text
pluginMainPath != electron.asar renderer main.js

exists=true

pluginMainSha256 != unknown

projectMainSha256 != unknown

shaMatch=true
```

---

# 60. Runtime Acceptance R2 — Active Doc

必须：

```text
Active Doc=doc.md
```

或 authoritative absolute path。

不得：

```text
unknown
```

---

# 61. Runtime Acceptance R3 — initializationCount

fresh restart：

```text
initializationCount=1
```

---

# 62. Runtime Acceptance R4 — Strict Startup

所有 strict startup fields 全通过。

否则：

```text
启动命令已发出，但尚未确认成功
```

---

# 63. Hard Stop List

任一出现：

```text
selParagraph=undefined sameAsCommand=true

SELECTION-TRUTH-DIVERGENCE

MutationObserver selectionRuntimeId
!=
OBS-SELECTION runtimeId
same cycle

SPECIAL_INDENT_ENTER
verified caret not in expected current paragraph

SPLIT
actual selection != caretDestination

MERGE 2→1 single owner
still only LIVE-REPLACEMENT-BLOCK

MERGE single-owner
awaitingForMs > 2000

MERGE single-owner
CREATE_NEW

MERGE multi-owner
decision=TRANSFER

MERGE 2→1
被重新分类成 REPLACE_1_TO_1

bindingVerified=false decision=PROMOTE

stale handoff transfer

historical blocks exact CURRENT_LIVE owner

plugin path = electron.asar renderer main.js

Plugin SHA256=unknown

Active Doc=unknown

initializationCount != 1

runtime Build ID mismatch

deployed SHA mismatch
```

立即：

```text
R58.6.3 NOT FIXED — R60 BLOCKED
```

---

# 64. 禁止的假修复

禁止：

```text
只改 OBS-SELECTION 日志字段

sameAsCommand 继续依赖 global cursorOffset

为了让 sameAsCommand=true
直接硬编码 expected runtimeId

ArrowDown interception

无限 setSelection

每次 refresh restore caret

MERGE 单 owner 继续统一 BLOCK

MERGE 2→1 降格 1→1

MERGE multi-owner first wins

historical heuristic 解决 merge

ordinal-only 解决 merge

text-only global search 解决 merge

为了修 plugin path
修改 canonical editor core

硬编码 Active Doc=doc.md

只把 Plugin SHA 日志改成非 unknown
但不真实 hash 文件
```

---

# 65. 推荐修改范围

优先：

```text
src/heading-numbering/heading-numbering-service.ts

src/heading-numbering/paragraph-canonical-registry.ts

src/main.ts

src/heading-numbering/paragraph-indent-forensic.ts
```

如已有：

```text
selection helper
editor-continuity.ts
```

允许集中实现。

不要扩大到：

```text
single-dot core

Two-Pass historical resolver

heading numbering engine

outline numbering

template system

sidecar compaction
```

---

# 66. Source Map 必须先做

修改前输出：

```text
OBS-SELECTION
→ file/function

POST-TOKEN-SELECTION
→ file/function

EDITOR-MUTATION-BATCH selection resolution
→ file/function

SPLIT-CARET-DESTINATION
→ file/function

existing selection helpers
→ file/function

global cursorOffset logic
→ file/function

sameAsCommand calculation
→ file/function

MERGE classification
→ file/function

current merge BLOCK path
→ file/function

AWAIT_TRANSFER before resolver
→ file/function

plugin runtime path
→ file/function

Active Doc resolution
→ file/function

initialization count
→ file/function
```

先确认 bypass，再改。

---

# 67. Build / Deploy

执行：

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1
```

记录：

```text
exit code
test count
project dist main.js SHA256
deployed plugin main.js SHA256
style.css SHA256
Build ID
```

---

# 68. Strict Restart

启动/重启 Typora 后：

不允许因为：

```text
restart script exit 0
```

就说启动成功。

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

# 69. Final Report

必须输出：

```text
## 1. Current Ground Truth
## 2. Source Map
## 3. Selection Root Cause
## 4. Unified SelectionTruth
## 5. Paragraph Resolution
## 6. Logical Offset
## 7. sameAsCommand
## 8. CaretExpectation
## 9. Selection Consumers Unified
## 10. Selection Verification
## 11. Merge Root Cause
## 12. MERGE_2_TO_1 Resolver
## 13. No-Owner Merge
## 14. Single-Owner Merge
## 15. Multi-Owner Merge
## 16. Merge Caret Destination
## 17. Awaiting Lifecycle
## 18. Runtime Identity Root Cause
## 19. Plugin Artifact Path
## 20. Active Doc
## 21. initializationCount
## 22. Files Changed
## 23. Build ID
## 24. Typecheck
## 25. Tests
## 26. Build
## 27. Deploy SHA256
## 28. Strict Startup
## 29. S1 Selection Truth Consistency
## 30. S2 No Undefined/True Contradiction
## 31. S3 Command Caret 10/10
## 32. S4 Split Caret 10/10
## 33. M1 Merge Single Owner 10/10
## 34. M2 No Permanent Awaiting
## 35. M3 Merge Multi Owner Safety
## 36. U1 Full User Flow 10/10
## 37. U2 Regression
## 38. R1 Plugin Identity
## 39. R2 Active Doc
## 40. R3 initializationCount
## 41. R4 Strict Startup
## 42. Hard Stop Counts
## 43. Remaining Known Issues
## 44. Final Verdict
```

---

# 70. Final Verdict

最终只能：

```text
R58.6.3 FIXED — R58.6 GUI ACCEPTANCE CONTINUES
```

或者：

```text
R58.6.3 NOT FIXED — R60 BLOCKED
```

注意：

```text
R58.6.3 FIXED
```

不等于：

```text
R60 UNLOCKED
```

仍需完成 R58.6 原完整 GUI/runtime acceptance。

任何 mandatory：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

最终必须：

```text
R58.6.3 NOT FIXED — R60 BLOCKED
```

---

# 71. Execution Rules

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
selection runtimeId
paragraph identity
logicalOffset
sameAsCommand
caret expectation
merge destination
canonical owner
merge conflict
awaiting duration
plugin path
plugin SHA
active doc
initializationCount
PID
StartTime
HWND
window title
vault
Build ID
runtime acceptance count
```

本轮严格按：

```text
Unified Selection Truth
→ Merge Single-Owner Continuity
→ Selection Continuity Verify
→ Runtime Identity Verification
```

顺序执行。

不要重新扩大问题范围。
