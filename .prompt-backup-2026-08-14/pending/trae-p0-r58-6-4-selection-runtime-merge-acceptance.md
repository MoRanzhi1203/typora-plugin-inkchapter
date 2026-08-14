# TRAE P0 — R58.6.4 Selection Truth Runtime Activation + Merge Forced Acceptance + Runtime Identity Closure

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Final Runtime Closure Before R58.6 GUI Acceptance**
>
> Current authoritative status:
>
> ```text
> R58.6.3 NOT FIXED
> R60 BLOCKED
> ```
>
> 本轮不要继续扩展 canonical architecture。
>
> 只处理 3 个剩余闭环：
>
> 1. **Selection Truth Runtime Activation**：真正建立并接入唯一 `resolveSelectionTruth()`，替换所有 selection consumer 的旧解析路径；
> 2. **MERGE_2_TO_1 Forced Runtime Acceptance**：源码已有 merge resolver，不再盲改；必须通过定向 GUI/runtime case 证明 no-owner / single-owner / multi-owner 行为；
> 3. **Runtime Identity Closure**：Active Doc 在 file-open 后刷新，Build ID source/dist/deployed/runtime/report 五方一致，并补齐 strict startup 证据。
>
> 只有以上三项真实通过后，才允许继续 R58.6 原 GUI acceptance。

---

# 0. 最新 Runtime Ground Truth

最新 runtime Build 实际加载：

```text
inkchapter-r58-6-3-selection-merge-runtime-identity-d9f2m
```

而上一轮 Final Report 写成：

```text
inkchapter-r58-6-3-selection-merge-runtime-identity-d9f2z
```

因此：

```text
Build ID consistency = FAIL
```

最新 runtime 已真实通过，必须 HARD FREEZE：

```text
Plugin Artifact Path:
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js

Plugin Artifact exists=true

Plugin SHA256:
AE7CAB47FE218F128DDDB5B2B0C9EAADAA459239855706A0745B0F08258390FE

Initialization Count:
1

Mutation Shape Authority:
1→2 = SPLIT_1_TO_2
2→1 = MERGE_2_TO_1

SPLIT_1_TO_2 resolver:
canonicalOwner != caretDestination
CANONICAL-BINDING-TRANSFER reason=LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH

Proof-Before-Mutation:
bindingVerified=false decision=PROMOTE = 0

HANDOFF-CLOSE:
reason=NO_REPLACEMENT_REQUIRED

Live Owner Dominance:
HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER

CURRENT_LIVE projection-only:
dirty=false
writeScheduled=false

AWAITING-TRANSFER-LEAK-AUDIT:
当前日志中 awaitingCount=0

physical sidecar:
source=physical
backend=filesystem
```

禁止重新推翻以上链路。

---

# 1. Runtime Failure A — SelectionTruth 没有真正进入 Production

最新日志仍存在：

```text
OBS-SELECTION:
selParagraph=undefined
sameAsCommand=true
```

且多次发生。

同时同一时段：

```text
EDITOR-MUTATION-BATCH:
selectionRuntimeId=P-RUNTIME-N
```

说明：

```text
MutationObserver
和
OBS-SELECTION
仍然不是同一个 selection truth source
```

另外完整 runtime 中：

```text
SELECTION-TRUTH = 0
SELECTION-CONTINUITY-VERIFY = 0
```

因此：

```text
Unified SelectionTruth
并未真正 runtime activate
```

---

# 2. 不接受“sameAsCommand 那一行已经正确”

下一轮禁止只检查：

```ts
sameAsCommand = ...
```

表达式本身。

必须 Source Map：

```text
OBS-SELECTION 的 selParagraph
从哪里得到？

POST-TOKEN-SELECTION 的 resolvedRuntimeId
从哪里得到？

EDITOR-MUTATION-BATCH 的 selectionRuntimeId
从哪里得到？

SPLIT-CARET-DESTINATION 的 selectionRuntimeId
从哪里得到？

CARET verification
从哪里得到？
```

如果以上不是同一个 resolver：

```text
FAIL
```

---

# 3. 唯一 Authoritative Selection API

必须真实实现并进入 runtime：

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

---

# 4. Selection Paragraph Resolution

必须同时支持：

```text
TextNode anchor
HTMLElement anchor
```

处理顺序：

```text
Selection.anchorNode
↓
TextNode → parentElement
HTMLElement → self
↓
existing supported-body-paragraph resolver
↓
editorRoot containment check
↓
paragraph
```

必须复用现有：

```text
resolveCurrentBodyParagraph
supported body paragraph adapter
paragraph taxonomy
```

禁止再写一套不同 selector。

---

# 5. runtimeId 必须来自同一 Runtime Identity Adapter

`SelectionTruth.runtimeId` 必须通过现有：

```text
getParagraphRuntimeId()
```

或唯一 runtime ID adapter 获取。

禁止：

```text
dataset
DOM index
ordinal
cached runtimeId
```

冒充 runtime identity。

---

# 6. logicalOffset 必须是 Paragraph-Local

新增/统一：

```ts
getLogicalOffsetWithinParagraph(
  paragraph: HTMLElement,
  anchorNode: Node,
  anchorOffset: number
): number | null
```

语义：

```text
当前 paragraph 内字符位置
```

禁止继续用：

```text
document-global cursorOffset
```

作为 paragraph identity 或 sameAsCommand proof。

---

# 7. 所有 Selection Consumer 必须统一

以下全部改为：

```text
resolveSelectionTruth(editorRoot)
```

包括：

```text
OBS-SELECTION

POST-TOKEN-SELECTION

EDITOR-MUTATION-BATCH

SPLIT-CARET-DESTINATION

MERGE-CARET-DESTINATION

POST-HANDOFF verification

SELECTION-CONTINUITY-VERIFY

CARET-NAVIGATION-AUDIT
```

禁止这些模块自行调用：

```text
window.getSelection()
closest()
cursorOffset
selection anchor fallback
DOM ordinal
runtimeId cache
```

来独立推断 paragraph identity。

---

# 8. SELECTION-TRUTH Trace 必须真实出现

每次关键 observation 输出：

```text
SELECTION-TRUTH:
source=<OBS|MUTATION|POST_TOKEN|SPLIT|MERGE|VERIFY>
runtimeId=<P-RUNTIME-N|null>
ordinal=<number|null>
logicalOffset=<number|null>
collapsed=<true|false>
anchorConnected=<true|false>
focusConnected=<true|false>
insideEditor=<true|false>
```

本轮必须：

```text
SELECTION-TRUTH count > 0
```

否则：

```text
runtime path NOT ACTIVATED
```

---

# 9. sameAsCommand Hard Rule

唯一允许：

```ts
sameAsCommand =
  selectionTruth.runtimeId !== null &&
  selectionTruth.runtimeId === expectedCaretRuntimeId;
```

必须：

```text
runtimeId=null
→ sameAsCommand=false
```

因此：

```text
selParagraph=undefined sameAsCommand=true
```

必须永久为：

```text
0
```

---

# 10. CaretExpectation 必须和 Continuity 同步更新

新增/保留：

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

不能永远指向：

```text
originalElement
```

---

# 11. Special Indent Enter Expectation

操作：

```text
。。 + Enter
```

业务期望：

```text
canonicalOwner
=
caretDestination
=
当前 paragraph
```

初始：

```text
expectedLogicalOffset=0
```

如果发生：

```text
P1 → P6
```

则：

```text
CaretExpectation.expectedRuntimeId:
P1 → P6
```

---

# 12. Normal Enter Split Expectation

例如：

```text
P6
→ P8 + P7

canonicalOwner=P8
caretDestination=P7
```

必须：

```text
expectedCaretRuntimeId=P7
```

而不是：

```text
P8
```

---

# 13. Selection Continuity Verify 必须进入 Runtime

continuity transfer 后：

```text
microtask
→ verify

RAF
→ verify
```

新增：

```text
SELECTION-CONTINUITY-VERIFY:
continuityId=...
reason=...
expectedRuntimeId=...
actualRuntimeId=...
expectedLogicalOffset=...
actualLogicalOffset=...
paragraphMatches=...
connected=...
verified=...
caretWriteAttempted=...
```

---

# 14. Caret Repair 只允许一次且仅在必要时

如果：

```text
verified=true
```

必须：

```text
caretWriteAttempted=false
```

只有：

```text
expected destination 已确定
actual selection 错误
```

才允许：

```text
restoreLogicalCaret()
```

最多：

```text
1 microtask attempt
+
1 RAF verification retry
```

禁止：

```text
无限 setTimeout
每次 refresh 抢 selection
ArrowDown interception
periodic caret reset
```

---

# 15. Selection Divergence Hard Stop

新增：

```text
SELECTION-TRUTH-DIVERGENCE
```

如果同一 logical cycle：

```text
MutationObserver runtimeId=P5
OBS runtimeId=null
```

或：

```text
POST_TOKEN runtimeId=P4
VERIFY runtimeId=P3
```

必须：

```text
ACTION=HARD_STOP
```

不得继续以其中一套为准偷偷执行。

---

# 16. Runtime Failure B — Merge Resolver 源码已存在，但没有 Runtime Evidence

上一轮 runtime：

```text
MERGE_2_TO_1 = 0
MERGE-CONTINUITY-RESOLVE = 0
LIVE_DOM_MERGE_SINGLE_OWNER = 0
TRANSFER_SINGLE_OWNER = 0
```

因此正确结论：

```text
Merge = NOT EXECUTED
```

不是 PASS，也不是 FAIL。

本轮核心任务：

```text
不要继续盲改 resolver
先构造真实 merge acceptance
```

---

# 17. Merge Forced Acceptance Matrix

必须主动构造以下 4 类：

```text
M0
plain + plain
→ merge

M1
canonical + plain
→ merge

M2
plain + canonical
→ merge

M3
canonical R1 + canonical R2
→ merge conflict
```

---

# 18. Merge M0 — No Owner

输入：

```text
removed=2
added=1
canonicalRemovedCount=0
```

必须：

```text
mutationShape=MERGE_2_TO_1

MERGE-CONTINUITY-RESOLVE
decision=NO_CANONICAL_OWNER

no AWAIT_TRANSFER
no CREATE_NEW
```

---

# 19. Merge M1 — canonical + plain

例如：

```text
P3 canonical R1
P4 plain

Backspace/Delete merge

→ P21
```

必须：

```text
MERGE-CONTINUITY-RESOLVE
decision=TRANSFER_SINGLE_OWNER

CANONICAL-BINDING-TRANSFER
R1:
P3 → P21

reason=LIVE_DOM_MERGE_SINGLE_OWNER

recordCount unchanged
generation+1
```

---

# 20. Merge M2 — plain + canonical

例如：

```text
P3 plain
P4 canonical R1

merge
→ P21
```

同样：

```text
R1 → P21
```

不能因为 canonical owner 是第二个 removed paragraph 就失效。

---

# 21. Merge M3 — two canonical owners

```text
P3=R1
P4=R2
→ P21
```

必须：

```text
MERGE-CANONICAL-CONFLICT
decision=BLOCK_MULTI_OWNER
```

禁止：

```text
R1 wins
R2 wins
first wins
last wins
historical resolver
text resolver
ordinal resolver
```

---

# 22. Merge Caret Destination

对于：

```text
2→1
```

unique added paragraph：

```text
P21
```

如果：

```text
SelectionTruth.runtimeId=P21
```

则：

```text
MERGE-CARET-DESTINATION
runtimeId=P21
decision=RESOLVED
```

---

# 23. Merge Awaiting Contract

对：

```text
canonicalRemovedCount=1
unique merge destination
```

允许短暂：

```text
CURRENT_AWAITING_TRANSFER
```

但必须在同一 continuity cycle：

```text
→ CURRENT_LIVE
```

不得：

```text
awaitingForMs > 2000
```

---

# 24. Merge No-Owner 不得进入 Awaiting

如果：

```text
canonicalRemovedCount=0
```

则：

```text
AWAIT_TRANSFER
```

必须：

```text
0
```

---

# 25. Merge Multi-Owner Conflict 不得伪装普通 Leak

如果：

```text
BLOCK_MULTI_OWNER
```

必须明确：

```text
reason=MERGE_MULTI_OWNER_CONFLICT
```

可以暂留 unresolved/conflict state，
但必须从普通：

```text
AWAITING-TRANSFER-LEAK-AUDIT
```

分离。

---

# 26. Runtime Failure C — Active Doc Banner 时序错误

当前 startup banner：

```text
Active Doc:
```

为空。

但随后 runtime 明确：

```text
readContentFrom:
...\test\vault\doc.md

onFilePathUpdated:
...\test\vault\doc.md

ServiceDocSwitch:
newKey=doc.md
```

所以问题不是：

```text
拿不到 active doc
```

而是：

```text
startup banner 太早
```

---

# 27. Active Doc Identity Refresh

启动时如果 doc 未打开：

```text
Active Doc:
pending
```

允许。

但是 file-open 后必须：

```text
RUNTIME-IDENTITY-UPDATE:
reason=file-open
activeDoc=doc.md
vaultRoot=...
pluginMainPath=...
pluginMainSha256=...
buildId=...
initializationCount=1
```

---

# 28. Runtime Identity 必须有 Final Resolved Snapshot

在：

```text
file-open
+
editor-load
+
vault context ready
```

后输出一次：

```text
RUNTIME-IDENTITY-FINAL
```

字段：

```text
vaultRoot
activeDoc
pluginMainPath
pluginMainExists
pluginMainSha256
projectMainSha256
shaMatch
stylePath
styleSha256
buildId
initializationCount
sessionId
```

---

# 29. Build ID 五方一致

本轮 Build：

```text
inkchapter-r58-6-4-selection-runtime-merge-acceptance-<unique>
```

必须核对：

```text
SOURCE_BUILD_ID
DIST_BUILD_ID
DEPLOYED_BUILD_ID
RUNTIME_BUILD_ID
FINAL_REPORT_BUILD_ID
```

五者完全一致。

任一不同：

```text
HARD STOP
```

---

# 30. Build ID Audit Trace

新增：

```text
BUILD-ID-AUDIT:
sourceBuildId=...
distBuildId=...
deployedBuildId=...
runtimeBuildId=...
reportBuildId=<generated at report stage>
allMatch=<true|false>
```

如果 report stage 不便由 runtime 输出，
最终报告必须人工/脚本交叉列出前四项，
并保证 Final Report 使用同一个值。

---

# 31. Plugin Identity HARD FREEZE

当前真实通过：

```text
pluginMainPath=
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist\main.js

exists=true

pluginMainSha256=
AE7CAB47...
```

禁止下一轮再改回：

```text
electron.asar
```

---

# 32. initializationCount HARD FREEZE

继续：

```text
initializationCount=1
```

fresh restart 下：

```text
>1
```

即 FAIL。

---

# 33. Strict Startup 仍必须完整验证

最终 strict startup 必须包含：

```text
old Typora process exited

new PID

StartTime

MainWindowHandle != 0

MainWindowTitle nonempty

target vault exact

target document exact

real plugin main path

plugin main SHA256

project dist main SHA256

shaMatch=true

style.css SHA256

Build ID exact

initializationCount=1
```

任一缺失：

```text
启动命令已发出，但尚未确认成功
```

---

# 34. HARD FREEZE — Split

禁止修改：

```text
Mutation Shape Authority

SPLIT_1_TO_2 classification

SPLIT-CARET-DESTINATION

canonicalOwner/caretDestination separation

LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH
```

只允许：

```text
把 selection source 改成 resolveSelectionTruth()
```

---

# 35. HARD FREEZE — Promotion

禁止修改 Promotion 主逻辑。

必须继续：

```text
bindingVerified=false decision=PROMOTE = 0
```

---

# 36. HARD FREEZE — Handoff

继续：

```text
HANDOFF-CLOSE
reason=NO_REPLACEMENT_REQUIRED
```

禁止延长 TTL。

---

# 37. HARD FREEZE — Live Owner Dominance

继续：

```text
HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER
```

---

# 38. HARD FREEZE — Sidecar

继续：

```text
physical sidecar load/write
PERSISTED_HISTORICAL only physical birth
```

本轮不要 sidecar compaction。

---

# 39. Historical Multi-Owner 不属于本轮

当前 historical sidecar 已存在：

```text
recordCount≈39+
```

并出现大量：

```text
multi-owner
→ BLOCK
```

这是安全行为。

本轮禁止：

```text
historical GC
sidecar compaction
record migration
first historical candidate wins
```

---

# 40. SyntaxError 继续隔离

启动仍有：

```text
SyntaxError: Unexpected token ')'
```

但 InkChapter 仍可：

```text
onload START
```

因此：

```text
SyntaxError attribution=UNRESOLVED
```

本轮不要因为这个错误修改 paragraph continuity。

---

# 41. Source Map — Selection 必做

修改前先输出：

```text
resolveSelectionTruth current existence
→ file/function

OBS-SELECTION paragraph source
→ file/function

POST-TOKEN-SELECTION runtimeId source
→ file/function

EDITOR-MUTATION-BATCH runtimeId source
→ file/function

SPLIT selection source
→ file/function

MERGE selection source
→ file/function

sameAsCommand calculation
→ file/function

global cursorOffset use sites
→ file/function
```

---

# 42. Source Map — Merge 必做

输出：

```text
MERGE classification
→ file/function

resolveMergeContinuity
→ file/function

MERGE-CONTINUITY-RESOLVE
→ file/function

single-owner transfer
→ file/function

multi-owner block
→ file/function

AWAIT_TRANSFER point
→ file/function
```

---

# 43. Source Map — Runtime Identity

输出：

```text
startup identity banner
→ file/function

PLUGIN-RUNTIME-ARTIFACT
→ file/function

Active Doc source
→ file/function

file-open event
→ file/function

runtime identity refresh
→ file/function

Build ID source
→ file/function
```

---

# 44. Unit Test ST-1 — TextNode Selection

Selection anchor：

```text
TextNode
```

必须：

```text
paragraph != null
runtimeId != null
logicalOffset != null
```

---

# 45. Unit Test ST-2 — Element Selection

Selection anchor：

```text
HTMLElement
```

必须得到同一 paragraph identity。

---

# 46. Unit Test ST-3 — null runtimeId

如果：

```text
runtimeId=null
```

必须：

```text
sameAsCommand=false
```

---

# 47. Unit Test ST-4 — transfer expectation

```text
expected=P1

P1 → P6
```

之后：

```text
CaretExpectation=P6
```

---

# 48. Unit Test ST-5 — split expectation

```text
canonicalOwner=P8
caretDestination=P7
```

必须：

```text
expectedCaretRuntimeId=P7
```

---

# 49. Unit Test M-0

```text
plain + plain
→ merge
```

必须：

```text
NO_CANONICAL_OWNER
```

---

# 50. Unit Test M-1

```text
canonical + plain
→ merge
```

必须：

```text
TRANSFER_SINGLE_OWNER
```

---

# 51. Unit Test M-2

```text
plain + canonical
→ merge
```

必须：

```text
TRANSFER_SINGLE_OWNER
```

---

# 52. Unit Test M-3

```text
canonical R1 + canonical R2
→ merge
```

必须：

```text
BLOCK_MULTI_OWNER
```

---

# 53. Runtime Acceptance S1 — SelectionTruth Activated

必须：

```text
SELECTION-TRUTH count > 0
```

至少：

```text
20
```

次真实 observation。

---

# 54. Runtime Acceptance S2 — Contradiction Zero

必须：

```text
selParagraph=undefined sameAsCommand=true = 0
```

---

# 55. Runtime Acceptance S3 — Divergence Zero

必须：

```text
SELECTION-TRUTH-DIVERGENCE = 0
```

注意：

只有：

```text
SELECTION-TRUTH > 0
```

前提下 divergence=0 才算 PASS。

---

# 56. Runtime Acceptance S4 — Command Caret 10/10

执行至少 10 次：

```text
。。+Enter
```

每次：

```text
SELECTION-CONTINUITY-VERIFY
reason=SPECIAL_COMMAND_CURRENT_PARAGRAPH
expectedRuntimeId=actualRuntimeId
expectedLogicalOffset=0
actualLogicalOffset=0
verified=true
```

10/10。

---

# 57. Runtime Acceptance S5 — Split Caret 10/10

执行至少 10 次：

```text
normal Enter
```

每次：

```text
canonicalOwner != caretDestination

SELECTION-CONTINUITY-VERIFY
reason=SPLIT_NEW_PARAGRAPH

actualRuntimeId=caretDestinationRuntimeId

verified=true
```

10/10。

---

# 58. Runtime Acceptance M1 — No Owner

真实：

```text
plain + plain → merge
```

必须：

```text
MERGE-CONTINUITY-RESOLVE
decision=NO_CANONICAL_OWNER
```

---

# 59. Runtime Acceptance M2 — canonical + plain

至少 5 次：

```text
canonical + plain → merge
```

必须 5/5：

```text
TRANSFER_SINGLE_OWNER
LIVE_DOM_MERGE_SINGLE_OWNER
same canonicalRecordId
generation+1
recordCount unchanged
```

---

# 60. Runtime Acceptance M3 — plain + canonical

至少 5 次：

```text
plain + canonical → merge
```

同样 5/5。

---

# 61. Runtime Acceptance M4 — Multi Owner Safety

至少 3 个 synthetic/runtime case：

```text
R1 + R2 → one paragraph
```

必须：

```text
BLOCK_MULTI_OWNER
```

不得 transfer。

---

# 62. Runtime Acceptance M5 — No Merge Awaiting Leak

对 single owner：

```text
awaitingForMs > 2000
```

必须：

```text
0
```

---

# 63. Runtime Acceptance I1 — Active Doc Final

startup 早期可以：

```text
pending
```

但 file-open 后：

```text
RUNTIME-IDENTITY-FINAL
activeDoc=doc.md
```

必须存在。

---

# 64. Runtime Acceptance I2 — Build ID All Match

必须：

```text
source=dist=deployed=runtime=final-report
```

---

# 65. Runtime Acceptance I3 — Strict Startup

必须验证全部 strict fields。

否则：

```text
启动命令已发出，但尚未确认成功
```

---

# 66. Runtime Acceptance R1 — Regression

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

# 67. Full User Flow

至少 10 次：

```text
输入 “。。”
→ Enter
→ 当前 paragraph force-indent
→ caret 位于当前 paragraph offset 0

输入正文
→ normal Enter
→ completed old paragraph 保持 force-indent
→ new paragraph auto
→ caret 在 new paragraph

Backspace merge
→ single-owner canonical continuity 正确
→ no permanent awaiting

↑
↓
→ 正常 navigation
```

10/10。

---

# 68. Hard Stop List

任一出现：

```text
SELECTION-TRUTH = 0

SELECTION-CONTINUITY-VERIFY = 0

selParagraph=undefined sameAsCommand=true

SELECTION-TRUTH-DIVERGENCE

sameAsCommand 仍基于 global cursorOffset

OBS / POST_TOKEN / MUTATION 使用不同 paragraph resolver

command caret expected != actual

split actual selection != caretDestination

MERGE resolver 未执行但报告 PASS

MERGE single-owner decision=BLOCK

MERGE single-owner awaitingForMs > 2000

MERGE single-owner CREATE_NEW

MERGE multi-owner decision=TRANSFER

MERGE 2→1 重新变成 REPLACE_1_TO_1

bindingVerified=false decision=PROMOTE

stale handoff transfer

historical candidate blocks exact CURRENT_LIVE owner

Plugin Artifact Path 回退到 electron.asar

pluginMainSha256=unknown

RUNTIME-IDENTITY-FINAL activeDoc empty/unknown

source/dist/deployed/runtime/report Build ID 任一不一致

initializationCount != 1

strict startup mandatory field missing
```

立即：

```text
R58.6.4 NOT FIXED — R60 BLOCKED
```

---

# 69. 禁止的假修复

禁止：

```text
只修改 OBS-SELECTION 输出文字

不实现 resolveSelectionTruth
却把日志名改成 SELECTION-TRUTH

sameAsCommand 继续读取 cursorOffset

SELECTION-TRUTH 不进入 production
却用 divergence=0 宣称 PASS

为了 caret 正确
每次 refresh 强制 setSelection

ArrowDown interception

继续重写已通过的 Split resolver

继续重写 Promotion proof

继续重写 handoff close

盲改 merge resolver
但不构造 runtime merge case

merge 没执行
却在报告写 PASS

硬编码 Active Doc=doc.md

只改 Final Report Build ID
不核对 runtime Build ID

为了 Build ID 一致
伪造日志

本轮做 historical sidecar compaction
```

---

# 70. 推荐修改范围

优先：

```text
src/heading-numbering/heading-numbering-service.ts

src/main.ts

src/heading-numbering/paragraph-indent-forensic.ts
```

如果已有 selection helper：

```text
src/.../selection*.ts
```

优先集中在那里。

`paragraph-canonical-registry.ts`：

```text
除非 Merge acceptance 暴露 registry-level bug
否则本轮不要主动重写
```

---

# 71. Build / Deploy

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
source Build ID
dist Build ID
project dist SHA256
deployed plugin SHA256
style SHA256
shaMatch
```

---

# 72. Strict Restart Rule

重启 Typora 后，不允许只因为：

```text
restart script exit 0
```

就说启动成功。

必须验证：

```text
old process exited
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

# 73. Final Report

必须输出：

```text
## 1. Current Ground Truth
## 2. Source Map — Selection
## 3. Source Map — Merge
## 4. Source Map — Runtime Identity
## 5. Selection Root Cause
## 6. resolveSelectionTruth
## 7. Selection Consumer Migration
## 8. logicalOffset
## 9. sameAsCommand
## 10. CaretExpectation
## 11. SELECTION-TRUTH Runtime Activation
## 12. SELECTION-CONTINUITY-VERIFY
## 13. Merge Existing Resolver Audit
## 14. M0 No Owner
## 15. M1 Canonical + Plain
## 16. M2 Plain + Canonical
## 17. M3 Multi Owner
## 18. Merge Awaiting
## 19. Active Doc Timing Root Cause
## 20. Runtime Identity Final Refresh
## 21. Build ID Five-Way Audit
## 22. Files Changed
## 23. Build ID
## 24. Typecheck
## 25. Tests
## 26. Build
## 27. Deploy SHA256
## 28. Strict Startup
## 29. S1 SelectionTruth Activated
## 30. S2 Contradiction Zero
## 31. S3 Divergence Zero
## 32. S4 Command Caret 10/10
## 33. S5 Split Caret 10/10
## 34. M1 No Owner
## 35. M2 Canonical+Plain 5/5
## 36. M3 Plain+Canonical 5/5
## 37. M4 Multi Owner Safety
## 38. M5 No Merge Awaiting Leak
## 39. I1 Active Doc Final
## 40. I2 Build ID All Match
## 41. I3 Strict Startup
## 42. Regression
## 43. Full User Flow 10/10
## 44. Hard Stop Counts
## 45. Remaining Known Issues
## 46. Final Verdict
```

---

# 74. Final Verdict

最终只能：

```text
R58.6.4 FIXED — R58.6 GUI ACCEPTANCE CONTINUES
```

或者：

```text
R58.6.4 NOT FIXED — R60 BLOCKED
```

注意：

```text
R58.6.4 FIXED
```

仍然不等于：

```text
R60 UNLOCKED
```

还需要完成 R58.6 原完整 GUI/runtime acceptance。

任何 mandatory：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

最终必须：

```text
R58.6.4 NOT FIXED — R60 BLOCKED
```

---

# 75. Execution Rules

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
selection paragraph
logicalOffset
sameAsCommand
CaretExpectation
merge case
merge owner
merge destination
merge pass count
awaiting duration
Active Doc
Build ID
plugin SHA
project SHA
style SHA
PID
StartTime
HWND
window title
vault
runtime acceptance count
```

本轮严格按：

```text
Selection Truth Runtime Activation
→ Selection Continuity Verify
→ Merge Forced Runtime Acceptance
→ Runtime Identity Final Closure
```

执行。

不要重新扩大问题范围。
