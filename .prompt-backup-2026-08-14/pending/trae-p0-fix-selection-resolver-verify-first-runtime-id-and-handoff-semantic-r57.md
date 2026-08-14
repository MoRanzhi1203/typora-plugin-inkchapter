# TRAE P0 修复工程：修 Selection Resolver、Verify-First Caret、稳定 Runtime Paragraph ID、Handoff Semantic Freshness 与 Backspace 统一 Caret

## 0. 项目路径

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

---

# 1. 当前真实结论

当前 R56 的方向并非完全错误。

真实 runtime 已经证明：

```text
Exact command recognizer
PASS

token consume
PASS

paragraph count unchanged
PASS

immediate semantic FORCE_INDENT
PASS

immediate visual 32px
PASS

single `。`
AUTO
PASS

Two-Pass Rehydrate
PASS / FREEZE
```

但当前 R56 仍然失败在：

```text
P0-A
Selection → Paragraph resolver 无法解析 Text Node anchor

P0-B
Caret 流程仍是“先写，再验证”，
而真实 Typora 可能在 token consume 后已经把 caret 保留在正确空段内

P0-C
commandIdentity 使用 class/text fingerprint，
它会因为 token 删除、md-focus、inkchapter class 等变化而变化，
不是稳定 runtime identity

P0-D
One-Shot Handoff 保存 stale semantic 快照 FORCE_INDENT，
用户 Backspace 改成 FORCE_FLUSH 后，
后续 replacement 仍可能被旧 handoff 恢复成 FORCE_INDENT

P0-E
Backspace 仍在走旧 placeCaretInParagraph / realm Node check，
与 Enter 的新 caret pipeline 不统一

P0-F
disk sidecar 被禁用，
但 memory sidecar records 仍在增加：
0 → 1 → 2 → 3...
导致 rehydrate 继续扫描内存污染 record
```

---

# 2. 当前最关键的真实 DOM 证据

R56 已经真实打印：

```text
EMPTY-PARAGRAPH-DOM-PROBE

P
└─ SPAN
   └─ #text
```

并且：

```text
selectionAnchorNode=#text
selectionAnchorOffset=0
```

但是随后：

```text
ENTER-CARET-LOCAL
success=false
sameParagraph=false
localOffset=undefined
selectionIdentity=null
```

这高度证明：

```text
Range 不一定是第一问题

Selection resolver 本身首先失败
```

因为：

```text
Text Node
没有 closest()
```

---

# 3. 本轮 HARD FREEZE

禁止修改：

```text
keydown Enter capture = sole business owner

beforeinput(insertParagraph) = suppress-only

exact token recognizer:
。。
..

single:
。
.
绝不执行业务命令

caret collapsed
caret at exact token end
normal body paragraph only
IME exclusion

150ms transaction close

token consumed in CURRENT same paragraph
no native split
paragraph count unchanged

semantic / visual separation

Backspace semantic:
FORCE_INDENT → FORCE_FLUSH

Two-Pass Rehydrate:
RESOLVE ALL
→ GROUP
→ DECIDE
→ APPLY

multi-owner:
BLOCK ALL

single-dot isolation
```

禁止：

```text
重新修改 recognizer
重新修改 Two-Pass grouping
恢复 long-lived Pending
让 global refresh 写 caret
让 rehydrate / reconstruct 写 caret
neighbor fallback
```

---

# 4. P0-A：先建立唯一 Selection Resolver

新增唯一公共 helper，例如：

```ts
resolveSelectionParagraph(
  selection: Selection | null,
  editorRoot: HTMLElement
): SelectionParagraphResolution
```

不要让：

```text
Enter
Backspace
OBS-SELECTION
forensic
```

各自实现不同的 selection → paragraph 逻辑。

---

# 5. Text Node 必须正确上溯

核心规则：

```ts
function normalizeSelectionNodeToElement(node: Node | null): Element | null {
  if (!node) return null

  if (node.nodeType === 1) {
    return node as Element
  }

  if (node.nodeType === 3) {
    return (node as Text).parentElement
  }

  return (node as any).parentElement ?? null
}
```

然后：

```text
element
→ closest('p')
```

但实际 selector 必须以当前项目真实 body paragraph selector 为准，例如：

```text
p.md-p
```

不得凭空扩大到 heading / list / excluded block。

---

# 6. 必须避免 instanceof Node / Element 必要 guard

继续禁止：

```text
instanceof global Node
instanceof ownerWindow.Node
instanceof global Element
instanceof HTMLElement
```

作为必要合法条件。

使用：

```text
nodeType
parentElement
ownerDocument
isConnected
tagName
closest capability
```

---

# 7. SelectionParagraphResolution

建议返回：

```ts
interface SelectionParagraphResolution {
  selectionExists: boolean

  anchorNodeType?: number
  anchorNodeName?: string

  normalizedElement?: Element | null

  paragraph?: HTMLElement | null

  paragraphRuntimeId?: string

  paragraphOrdinal?: number

  localLogicalOffset?: number

  insideEditorRoot: boolean

  reason?: string
}
```

---

# 8. localLogicalOffset 必须按 Paragraph 内部计算

对于当前空段结构：

```text
P
└─ SPAN
   └─ #text offset=0
```

必须解析：

```text
localLogicalOffset=0
```

不能返回：

```text
undefined
```

对于非空 paragraph：

```text
localLogicalOffset
```

也必须是 paragraph 内部可解释 offset。

本轮只需要确保：

```text
command 空 paragraph
→ localLogicalOffset=0
```

可靠。

---

# 9. P0-B：Caret 必须改成 VERIFY FIRST

当前命令流程禁止继续：

```text
consume token
↓
无条件写 Range
↓
再验证
```

改为：

```text
consume token
↓
读取当前 Selection
↓
resolveSelectionParagraph()
↓
如果 selection 已经在 command paragraph 且 localOffset=0
→ 不写 caret
→ success
```

只有 mismatch 才 repair。

---

# 10. 新流程：POST-TOKEN-SELECTION

token consume 后，semantic/visual 写入前后均可做 snapshot，但最终必须至少记录：

```text
POST-TOKEN-SELECTION

txnId

commandRuntimeId

anchorNodeType
anchorNodeName

resolvedParagraphRuntimeId

resolvedParagraphOrdinal

localLogicalOffset

sameAsCommandTarget

alreadyCorrect
```

---

# 11. alreadyCorrect 条件

只有：

```text
resolvedSelectionParagraph
===
commandCurrentElement

AND

localLogicalOffset === 0
```

才：

```text
alreadyCorrect=true
```

此时：

```text
caretWriteAttempted=false
caretSuccess=true
```

---

# 12. 只有 mismatch 才进入 Repair

如果：

```text
sameAsCommandTarget=false
```

或：

```text
localLogicalOffset !== 0
```

才调用：

```text
repairCaretAtParagraphLogicalStart(...)
```

---

# 13. Repair 优先定位真实 caret-bearing leaf

R56 已证明当前空段：

```text
P
└─ SPAN
   └─ #text
```

因此 Repair 优先：

```text
找到 paragraph 内合法的 caret-bearing Text Node
```

例如：

```text
SPAN > #text
```

然后：

```text
Range.setStart(textNode, 0)
Range.collapse(true)
```

Range 必须来自：

```text
paragraph.ownerDocument.createRange()
```

Selection 必须来自：

```text
paragraph.ownerDocument.defaultView?.getSelection()
```

---

# 14. Repair Fallback

只有找不到合法 text leaf 时：

允许：

```text
Range.setStart(paragraph, 0)
```

或 equivalent paragraph-local structural position。

禁止：

```text
previous paragraph
next paragraph
nearest paragraph
global text offset
```

---

# 15. Repair 后必须再次 resolveSelectionParagraph()

不能相信：

```text
addRange()
```

执行成功就算 caret success。

必须 readback：

```text
Selection
↓
resolveSelectionParagraph
↓
same paragraph
+
localOffset=0
```

才成功。

---

# 16. P0-C：废弃 Mutable String Fingerprint 作为 Runtime Identity

当前类似：

```text
P:md-end-block md-p md-focus inkchapter-pa:。。:
```

不是 identity。

它包含会变化的：

```text
className
textContent
focus class
inkchapter class
```

本命令本身就会：

```text
"。。" → ""
```

所以禁止用该字符串判断：

```text
same paragraph
```

---

# 17. Runtime Paragraph ID 使用 Object Identity

新增：

```ts
private paragraphRuntimeIds = new WeakMap<object, string>()
private nextParagraphRuntimeId = 1
```

helper：

```ts
getParagraphRuntimeId(paragraph)
```

第一次看到：

```text
P-RUNTIME-1
P-RUNTIME-2
...
```

同一个 HTMLElement 对象：

```text
永远同一个 runtime id
```

---

# 18. Runtime ID 不得包含任何 mutable content

禁止 runtime ID 依赖：

```text
text
class
semantic
indent
focus
ordinal
```

这些只能作为：

```text
diagnostic metadata
```

---

# 19. 同步 commit 的 same paragraph 判断

直接：

```ts
selectionParagraph === commandCurrentElement
```

runtime id 只用于日志。

不要：

```text
string fingerprint equality
```

---

# 20. DOM Replacement 后更新 Current Element

每个 Enter command 的 runtime continuity：

```ts
interface RuntimeParagraphContinuity {
  txnId: string

  currentElement: HTMLElement

  currentRuntimeId: string

  generation: number
}
```

replacement 后：

```text
currentElement = replacement
currentRuntimeId = runtimeId(replacement)
generation++
```

---

# 21. P0-D：One-Shot Handoff 不能保存 stale semantic 快照

当前错误：

```text
Enter
→ handoff semantic=FORCE_INDENT

Backspace
→ current semantic=FORCE_FLUSH

DOM replacement
→ handoff 仍 transfer FORCE_INDENT
```

这是严重错误。

---

# 22. Handoff 应保存 ownership，不保存固定 semantic payload

不要：

```ts
handoff.semantic = 'force-indent'
```

作为永久真相。

改为：

```ts
interface OneShotParagraphReplacementHandoff {
  txnId: string

  currentElement: HTMLElement
  currentRuntimeId: string

  generation: number

  consumed: boolean
}
```

---

# 23. Replacement 时读取 CURRENT Semantic Truth

真正 transfer 前：

```ts
const currentSemantic =
  getParagraphIndentMode(handoff.currentElement)
```

然后 transfer：

```text
current semantic
+
current effective visual
```

而不是 Enter 时冻结的 semantic。

---

# 24. Backspace 后 Handoff 必须反映 FORCE_FLUSH

场景：

```text
Enter
→ FORCE_INDENT

Backspace at logical start
→ FORCE_FLUSH

Typora replacement
```

要求：

```text
replacement semantic=FORCE_FLUSH
replacement indent=0px
```

绝不能重新变成：

```text
FORCE_INDENT / 32px
```

---

# 25. 新 Handoff Trace

新增：

```text
HANDOFF-CURRENT-SEMANTIC
```

字段：

```text
txnId
generation

currentRuntimeId

semanticAtHandoffCreation
semanticAtReplacementTime

visualAtReplacementTime

replacementRuntimeId

semanticAfter
indentAfter

verified
```

如果：

```text
creation=force-indent
replacementTime=force-flush
```

必须最终：

```text
semanticAfter=force-flush
indentAfter=0px
```

---

# 26. P0-E：Backspace 必须迁移到同一个 Selection/Caret Pipeline

当前日志仍然：

```text
Backspace reverse command:
force-indent → force-flush

CARET_TARGET_INVALID:
paragraph is not a Node in owner document realm
```

证明 Backspace 还在调用旧 helper。

本轮必须删除：

```text
Backspace → old placeCaretInParagraph()
```

路径。

---

# 27. Backspace 正确流程

逻辑起点：

```text
caret collapsed
selection paragraph = current paragraph
localLogicalOffset=0
semantic=FORCE_INDENT
```

第一次 Backspace：

```text
prevent native delete

same paragraph
semantic FORCE_INDENT → FORCE_FLUSH
text unchanged

caret:
先 verify current selection
如果仍正确
→ no write

如果需要 repair
→ 使用同一个 repairCaretAtParagraphLogicalStart()
```

---

# 28. Enter / Backspace 只有一个 Caret Framework

允许：

```text
resolveSelectionParagraph()

verifyCaretAtParagraphStart()

repairCaretAtParagraphLogicalStart()
```

禁止：

```text
Enter 使用 R57 helper
Backspace 使用旧 placeCaretInParagraph
```

旧 helper 如果没有其它合法调用：

```text
删除
```

否则必须标记：

```text
not for paragraph-indent command
```

---

# 29. P0-F：修 Memory Sidecar 半禁用状态

当前：

```text
disk write blocked
```

但：

```text
memory records:
0 → 1 → 2 → 3
```

这是不一致状态。

---

# 30. 必须区分 Sidecar Storage Gate 与 Canonical Record Model

最终固定产品语义不能被破坏：

```text
exact `。。/.. + Enter`

必须：
create/upsert canonical paragraph override
exactly once immediately

semantic=FORCE_INDENT

temporary=true allowed

stable recordId

later body text:
update SAME record
temporary=false

Backspace:
update SAME record
FORCE_FLUSH

不得 append new record
```

这一条是最终产品合同。

---

# 31. 本轮允许 Storage I/O 继续被 vaultRoot Gate 阻止，但 Canonical Record 不得乱增

如果由于：

```text
vaultRoot unknown
```

物理 sidecar write 仍 disabled：

必须至少保证：

```text
Enter command
→ canonical in-memory sidecar abstraction create/upsert exactly once

Backspace
→ update same recordId

recordCount 不增加
```

禁止当前：

```text
Enter no canonical record
Backspace append record
Backspace 再 append record
```

的半禁用状态。

---

# 32. 稳定 recordId 必须绑定 Enter Transaction

Enter：

```text
txnId
→ recordId R
```

后续：

```text
promotion
Backspace
one-shot replacement continuity
```

都必须继续引用：

```text
same R
```

---

# 33. Runtime Continuity 与 Sidecar Semantic Source 的边界

Runtime continuity 可以携带：

```text
recordId
currentElement
runtimeId
```

但不能成为新的 semantic source。

Canonical semantic source：

```text
sidecar record / explicit paragraph semantic model
```

Runtime element 上的：

```text
data/class
```

只是 projection。

---

# 34. Rehydrate 本轮仍冻结

不要因为 memory record 修复而重新改：

```text
Two-Pass
weak match rules
multi-owner rules
```

只保证：

```text
没有 duplicate record
```

减少噪音。

---

# 35. Selection Resolver Test

至少新增：

```text
SR-1 TextNode Anchor → parent SPAN → P

SR-2 Element Anchor → P

SR-3 Empty P SPAN Text offset0 → localOffset0

SR-4 Selection outside editor → blocked

SR-5 Heading/list/excluded block → blocked

SR-6 Enter/Backspace/OBS use same resolver
```

---

# 36. Verify-First Test

至少：

```text
VF-1 Post-token selection already in command P offset0 → no caret write

VF-2 alreadyCorrect → caretSuccess=true

VF-3 mismatch → repair attempted

VF-4 repair success requires readback paragraph equality

VF-5 global cursor equality alone cannot make success true

VF-6 no neighbor fallback
```

---

# 37. Runtime ID Test

至少：

```text
RI-1 Same HTMLElement → same runtimeId

RI-2 class change → runtimeId unchanged

RI-3 text "。。" → "" → runtimeId unchanged

RI-4 semantic class change → runtimeId unchanged

RI-5 replacement HTMLElement → new runtimeId

RI-6 continuity currentElement updates on replacement
```

---

# 38. Handoff Semantic Freshness Test

至少：

```text
HS-1 Enter FORCE_INDENT then replacement → FORCE_INDENT

HS-2 Enter → Backspace FORCE_FLUSH → replacement → FORCE_FLUSH

HS-3 stale creation semantic must not override current semantic

HS-4 handoff transfer visual follows current semantic

HS-5 handoff never writes caret

HS-6 handoff uses same recordId if canonical record exists
```

---

# 39. Backspace Unified Caret Test

至少：

```text
BU-1 first Backspace at logical start changes only semantic

BU-2 text unchanged

BU-3 caret remains same paragraph offset0

BU-4 already-correct selection → no caret write

BU-5 repair uses shared helper only if necessary

BU-6 old CARET_TARGET_INVALID path not invoked
```

---

# 40. Canonical Record Test

至少：

```text
CR-1 Enter creates/upserts exactly one record

CR-2 stable recordId bound to txn

CR-3 repeated refresh does not append

CR-4 body promotion updates same record

CR-5 Backspace updates same record FORCE_FLUSH

CR-6 recordCount unchanged on Backspace

CR-7 physical write may be blocked by vault gate without duplicate memory records

CR-8 no legacy Candidate semantic
```

---

# 41. GUI 测试严格缩小

不要继续大量重复。

只做：

```text
G1
有文本段后：
`。。+Enter`

G2
有文本段 + 2 个空段 + `。。+Enter`

G3
连续 4 个空段，最后一个 `。。+Enter`

G4
`。。+Enter`
随后当前段正文起点第一次 Backspace

G5
单 `。`
```

每组：

```text
3 次
```

任一关键失败：

```text
HARD STOP
```

---

# 42. G1/G2/G3 成功标准

token consume 后首先必须看到：

```text
POST-TOKEN-SELECTION

resolvedParagraphRuntimeId
==
commandRuntimeId

localLogicalOffset=0

alreadyCorrect=true
```

理想：

```text
caretWriteAttempted=false
```

如果必须 repair：

```text
repair 后同样满足
same paragraph + offset0
```

---

# 43. G4 Backspace 成功标准

```text
before:
semantic=FORCE_INDENT

Backspace:

after:
semantic=FORCE_FLUSH
text unchanged
selection same paragraph
localOffset=0

same recordId

recordCount unchanged
```

如果随后 DOM replacement：

```text
replacement semantic=FORCE_FLUSH
indent=0px
```

---

# 44. G5 Single Dot

```text
。
```

必须：

```text
semantic=AUTO
no new record
no business command
```

---

# 45. 必须新增 Runtime Logs

至少：

```text
POST-TOKEN-SELECTION

CARET-VERIFY-FIRST

CARET-REPAIR

SELECTION-RESOLUTION

PARAGRAPH-RUNTIME-ID

HANDOFF-CURRENT-SEMANTIC

CANONICAL-RECORD

BACKSPACE-CARET-VERIFY
```

---

# 46. 日志必须减少噪音

当前 REHYDRATE-PLAN 连续刷屏严重。

本轮不改 Two-Pass 逻辑，但 forensic logging 必须限流：

```text
同一个 plan signature
短时间重复
→ aggregate count
```

避免几十上百条 identical plan 把关键 caret trace 淹没。

不能通过关闭真实业务逻辑来减少日志。

---

# 47. Startup 验证必须修正错误路径

上一轮错误命令使用：

```text
test\vault.typora\...
```

这是错的。

正确路径：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist\main.js
```

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist\style.css
```

runtime-load：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\inkchapter-runtime-load.json
```

---

# 48. 严格 15 项启动验证

每次启动/重启必须真实验证：

```text
1. old Typora process fully exited

2. new PID

3. new StartTime

4. MainWindowHandle != 0

5. MainWindowTitle nonempty

6. target vault REALLY open
   不能硬编码打印 "test/vault"
   必须从真实窗口/当前文档/实际 runtime context 证明

7. project dist/main.js SHA256

8. actual runtime main.js SHA256

9. main.js hash match

10. project dist/style.css SHA256

11. actual runtime style.css SHA256

12. style.css hash match

13. current unified build marker

14. actual loaded script absolute path

15. initializationCount = 1
```

#8 / #11：

```text
必须真实 Get-FileHash
```

任一缺失：

```text
启动命令已发出，但尚未确认成功。
```

禁止声称：

```text
15/15 PASS
```

除非 15 项全部真实输出。

---

# 49. SyntaxError 继续只做 Attribution

继续记录：

```text
SyntaxError: Unexpected token ')'
```

如果没有 source 证明：

```text
UNRESOLVED
```

不得修改 paragraph command 业务逻辑。

---

# 50. Build ID

本轮：

```text
inkchapter-selection-resolver-verify-first-runtime-id-r57-<id>
```

必须仍然：

```text
INKCHAPTER_BUILD_ID
```

唯一来源。

---

# 51. Typecheck / Unit / Build

执行：

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
```

单元测试 PASS：

```text
不能代替 GUI
```

---

# 52. 部署

必须部署到：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist\main.js
```

和：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\
test\vault\.typora\plugins\dist\style.css
```

---

# 53. 本轮成功标准

必须全部成立：

```text
TextNode selection anchor
可以解析到正确 P

selectionIdentity=null
在正常 empty paragraph command 中 = 0 次

POST-TOKEN-SELECTION
能证明 command paragraph

alreadyCorrect=true 时：
caretWriteAttempted=false

Enter caret 不再无条件写 Range

mutable class/text fingerprint
不再作为 runtime identity

same HTMLElement
runtimeId 不变

Backspace
不再调用旧 realm-check caret helper

CARET_TARGET_INVALID
来自 paragraph indent Enter/Backspace path = 0

Enter → Backspace FORCE_FLUSH
后续 replacement 仍 FORCE_FLUSH

One-Shot 不再恢复 stale FORCE_INDENT

canonical record:
Enter exactly once
Backspace same record
recordCount no append

single `。`
AUTO

G1 3/3
G2 3/3
G3 3/3
G4 3/3
G5 3/3

strict startup 15/15
真实通过
```

---

# 54. 本轮禁止事项

不得：

```text
git add
git commit
git push
```

不得：

```text
恢复 long-lived Pending
```

不得：

```text
用 mutable fingerprint 判断 same paragraph
```

不得：

```text
用 absolute global text offset
作为 empty paragraph caret identity
```

不得：

```text
无条件重写 caret
```

不得：

```text
Backspace 使用旧 placeCaretInParagraph
```

不得：

```text
One-Shot 保存 stale semantic 并覆盖新 semantic
```

不得：

```text
追加 duplicate sidecar records
```

不得：

```text
进入 30/30 stress
```

---

# 55. 最终报告格式

```text
# 1. Git Baseline

# 2. R56 Runtime Root Cause Confirmation

# 3. Selection Resolver Root Cause

# 4. TextNode → SPAN → P Resolution

# 5. SelectionParagraphResolution

# 6. POST-TOKEN-SELECTION

# 7. Verify-First Caret Design

# 8. Caret Write Avoidance Count

# 9. Caret Repair Path

# 10. Runtime Paragraph ID Design

# 11. Mutable Fingerprint Removal

# 12. One-Shot Semantic Freshness Fix

# 13. Enter → Backspace → Replacement Proof

# 14. Backspace Unified Caret Pipeline

# 15. Old Caret Helper Remaining Call Sites

# 16. Canonical Record Exactly-Once Design

# 17. Stable RecordId Proof

# 18. Record Count Before/After Backspace

# 19. SR-1~SR-6

# 20. VF-1~VF-6

# 21. RI-1~RI-6

# 22. HS-1~HS-6

# 23. BU-1~BU-6

# 24. CR-1~CR-8

# 25. Typecheck

# 26. Unit Tests

# 27. Build

# 28. Build ID

# 29. Deployment Paths

# 30. Strict 15-item Startup Verification

# 31. G1 3/3

# 32. G2 3/3

# 33. G3 3/3

# 34. G4 3/3

# 35. G5 3/3

# 36. CARET_TARGET_INVALID Count

# 37. SelectionIdentity Null Count

# 38. Caret Repair Attempt Count

# 39. Stale Semantic Overwrite Count

# 40. Duplicate Record Count

# 41. Remaining Failure
NONE / exact failure

# 42. Is Persistent Disk Sidecar Context Ready?
FALSE unless vaultRoot fixed separately

# 43. Is 30/30 Ready?
FALSE

# 44. Git Final Status
```

---

# 56. 本轮最终原则

```text
第一：
先解析真实 Selection，
再决定是否需要写 caret。

第二：
如果 Typora 已经把 caret 留在正确 empty paragraph，
InkChapter 什么都不要做。

第三：
TextNode anchor 必须先上溯到 Element，再解析 paragraph。

第四：
runtime paragraph identity 必须基于对象实例，
不能基于会变化的 class/text fingerprint。

第五：
One-Shot transfer 必须读取 replacement 时的 CURRENT semantic，
不能用 Enter 时冻结的旧 semantic。

第六：
Enter 和 Backspace 必须共用同一 selection/caret pipeline。

第七：
最终产品合同仍然是：
Enter sidecar exactly once immediately，
Backspace 更新 SAME record，
绝不能 append duplicate records。
```
