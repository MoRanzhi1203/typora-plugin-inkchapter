# Trae — P0 Empty-Special Runtime Repair: Native Empty DOM + Mutation Authority + Clean E1/E2/E3

## 0. 当前 Runtime 基线

当前真实运行 Build：

```text
inkchapter-r58-7-p0-empty-special-auditfix-es2b7q
```

当前 Main SHA：

```text
2256FA7B6C57FF767FEACA32E784953BC32DBF1782AE09722CFC15C134EDCF2E
```

当前 Style SHA：

```text
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

当前真实 Runtime 已证明：

```text
Runtime Build Activation = PASS
Artifact SHA parity = PASS
Initialization Count = 1
```

当前事务真实结果：

```text
Empty Special logical slot = PASS
Paragraph count = PASS
Canonical owner = PASS
Semantic force-indent = PASS
Computed text-indent = PASS / 32px
Logical caret = PASS / offset 0

Visual caret = FAIL
expectedIndentPx=32
actualCaretIndentPx=0

EMPTY-SPECIAL-FINAL
= FAIL / RUNTIME
```

Formal E1/E2/E3 仍为：

```text
NOT YET
```

当前 `doc.md` 不可作为 formal fixture：

```text
SIDECAR-ACTUAL-LOAD
exists=true
recordCount=114
```

---

# 1. 本轮只处理三个问题

按顺序：

```text
P0-A
Token-only empty DOM normalization

P0-B
EmptySpecial mutation window / settle authority

P0-C
仅在 P0-A 修复后，runtime 仍证明 caret geometry=0 时，
才允许 empty-only visual projection
```

之后建立 clean E1/E2/E3 runtime fixtures。

禁止重新修改 Canonical/NormalEnter 主架构。

---

# 2. 已确认 Runtime 证据

## Native Empty DOM

真实 native empty：

```html
<p></p>
```

对应：

```text
innerHTML=""
textContent=""
childNodeCount=0
```

## Token-only command consume 后 DOM

命令前：

```html
<p><span md-inline="plain" class="md-plain md-expand">。。</span></p>
```

consume 后：

```html
<p><span md-inline="plain" class="md-plain md-expand"></span></p>
```

AFTER_RAF 仍保留空 span。

因此：

```text
Native Empty DOM
!=
Token-consumed Empty DOM
```

= CONFIRMED / RUNTIME。

## Caret Geometry

当前 runtime：

```text
fontSizePx=16
expectedIndentPx=32
actualCaretIndentPx=0

semanticCorrect=true
visualIndentCorrect=true
caretLogicalCorrect=true
caretVisualCorrect=false
```

因此当前强 root-cause candidate：

```text
空 md-plain/md-expand span
把 editing position 锚在 paragraph 左侧
```

不要先上 CSS workaround。

---

# 3. P0-A — Token-only Empty DOM Normalization

目标：

```text
"。。"
→ consume token
→ restore Typora-native empty paragraph representation
```

优先实现：

```text
<p><span md-inline="plain" class="md-plain md-expand"></span></p>

→

<p></p>
```

或严格等价的 Typora native empty representation。

禁止：

```text
\u200B
&nbsp;
不可见 Markdown 字符
持久化 placeholder 文本
```

不得污染 Markdown。

---

# 4. DOM Normalization 必须 transaction-scoped

禁止：

```text
cleanupAllEmptySpans()
```

只允许处理当前：

```text
TOKEN_ONLY_EMPTY_SPECIAL_COMMAND
```

transaction 的 source/final paragraph。

建议新增：

```ts
normalizeTokenConsumedEmptyParagraph(txn, paragraph)
```

返回至少：

```text
txnId
runtimeId
beforeInnerHTML
afterInnerHTML
beforeChildCount
afterChildCount
nativeEmptyEquivalent
markdownContentChanged
decision
```

decision：

```text
NORMALIZED_TO_NATIVE_EMPTY
ALREADY_NATIVE_EMPTY
BLOCK_UNSAFE_STRUCTURE
```

---

# 5. Unsafe DOM 必须 BLOCK

若 token consume 后包含：

```text
非空文本
链接
强调
代码
图片
多个未知 sibling
unknown Typora marker
```

禁止盲删。

必须：

```text
BLOCK_UNSAFE_EMPTY_DOM
```

---

# 6. 新增 JSONL Audit

新增：

```text
EMPTY-SPECIAL-DOM-NORMALIZATION
```

必须 `emitRuntimeAudit(...)`。

记录：

```text
txnId
intentEpoch
runtimeId
beforeInnerHTML
afterInnerHTML
beforeChildNodeCount
afterChildNodeCount
beforeVisibleText
afterVisibleText
nativeEmptyEquivalentBefore
nativeEmptyEquivalentAfter
markdownContentChanged
decision
overall
```

---

# 7. P0-B — Mutation Observer 必须在 consume 前 ARM

当前真实 runtime：

```text
EMPTY-SPECIAL-SETTLE-AUDIT

mutationGeneration=0
relevantMutationCount=0
quietBoundaryReached=false
timeoutReached=true
decision=TIMEOUT
```

但 token consume 明明产生 DOM mutation。

因此修正顺序：

```text
PRE_CAPTURE
↓
ARM_EMPTY_SPECIAL_MUTATION_WINDOW
↓
record baseline generation
↓
consume token
↓
normalize empty DOM
↓
observer captures relevant mutation
↓
wait quiet boundary
↓
resolve final slot
```

禁止：

```text
consume token
↓
再 arm observer
```

---

# 8. Mutation Authority 状态

至少：

```text
PRE_CAPTURED
MUTATION_WINDOW_ARMED
TOKEN_CONSUMED
DOM_NORMALIZED
MUTATION_OBSERVED
QUIET_BOUNDARY_REACHED
STRUCTURE_RESOLVED
```

新增 invariant：

```text
mutationWindowArmedBeforeTokenConsume=true
```

---

# 9. TIMEOUT 后禁止继续 commit

当前错误：

```text
TIMEOUT
quietBoundaryReached=false
↓
仍 canonical commit
```

必须移除。

settle decision 改为：

```text
SETTLED_BY_MUTATION_QUIET
SETTLED_NO_RELEVANT_MUTATION
TIMEOUT_BLOCK
SUPERSEDED
```

规则：

```text
relevantMutationCount>0
→ 必须 quietBoundaryReached=true
→ 才能 STRUCTURE_RESOLVE

relevantMutationCount==0
→ 只有 PRE/microtask/RAF topology 完全稳定
   且 source connected
→ 才允许 SETTLED_NO_RELEVANT_MUTATION

否则：
TIMEOUT_BLOCK
```

TIMEOUT_BLOCK 后：

```text
canonicalCommitAttempted=false
canonicalRebindAttempted=false
caretWriteAttempted=false
finalOverall=false
```

---

# 10. 增强 EMPTY-SPECIAL-SETTLE-AUDIT

记录：

```text
txnId
intentEpoch
observerArmedAt
tokenConsumedAt
observerArmedBeforeTokenConsume
mutationGenerationStart
mutationGenerationEnd
relevantMutationCount
relevantMutationTypes
sourceConnectedBefore
sourceConnectedAfter
paragraphCountBefore
paragraphCountAfter
quietBoundaryReached
timeoutReached
decision
```

硬要求：

```text
observerArmedBeforeTokenConsume=true
```

---

# 11. Intent supersession 不得放松

若：

```text
currentIntentEpoch > txn.intentEpoch
```

必须：

```text
SUPERSEDE
```

并保证：

```text
canonicalCommitAttempted=false
canonicalRebindAttempted=false
caretWriteAttempted=false
```

---

# 12. P0-A 修复后先重测 E2

不要立即加 CSS。

先真实验证：

```text
token-only empty
→ normalize to native <p></p>
→ semantic force-indent
→ caret logical offset 0
→ measure caret geometry
```

若：

```text
expectedIndentPx=32
actualCaretIndentPx≈32
caretVisualCorrect=true
```

则：

```text
P0-C NOT NEEDED
```

禁止增加 empty-only CSS。

---

# 13. P0-C 仅在 native empty 仍失败时允许

只有真实 runtime 同时证明：

```text
nativeEmptyEquivalent=true
semanticCorrect=true
computedTextIndent=32px
caretLogicalCorrect=true

but

actualCaretIndentPx=0
```

才允许研究：

```text
.inkchapter-empty-force-indent-caret
```

候选：

```text
empty + focused + force-indent:
padding-inline-start:2em
text-indent:0
```

第一枚真实字符出现后：

```text
remove empty-only projection
restore:
text-indent:2em
padding-inline-start:0
```

必须保证：

```text
non-empty unaffected
Markdown unaffected
canonical unaffected
selection owner unaffected
```

---

# 14. 禁止 fake geometry

禁止：

```text
插入不可见字符
setSelection 到伪节点
重复 focus
多时点 setTimeout repair
```

`caretVisualCorrect` 必须由真实 `caretRect.left` 证明。

---

# 15. Clean Runtime Fixtures

禁止继续用：

```text
doc.md
```

当前其 sidecar：

```text
recordCount=114
```

必须建立：

```text
r58-empty-special-e1-clean.md
r58-empty-special-e2-clean.md
r58-empty-special-e3-clean.md
```

每个要求：

```text
sidecarExists=false
recordCount=0
```

---

# 16. E1 Acceptance

```text
文本
空 A
空 B
空 C ← caret
EOF
```

执行：

```text
。。
Enter
```

必须：

```text
A/B/C survives
paragraphCount unchanged
logicalSlotPreserved=true
canonicalOwner=C
caret=C@0
caretLogicalCorrect=true
unexpectedMerge=false
unexpectedDelete=false
```

随后普通 Enter：

```text
C remains force-indent
new D created
caret=D@0
canonicalOwner remains C
```

---

# 17. E2 Acceptance

```text
文本
空 C ← caret
EOF
```

`。。+Enter` 后：

```text
nativeEmptyEquivalent=true
semanticCorrect=true
visualIndentCorrect=true
caretLogicalCorrect=true
caretVisualCorrect=true
expectedIndentPx≈32
actualCaretIndentPx≈32
```

不得依赖：

```text
extra Enter
blur
refocus
Arrow key
```

---

# 18. E3 Acceptance

```text
文本 A
空 B
空 C ← caret
空 D
文本 E
```

`。。+Enter` 后：

```text
B/C/D survives
paragraphCount unchanged
C still between B and D
E 不前移
canonicalOwner=C
caret=C@0
unexpectedMerge=false
unexpectedDelete=false
```

replacement 时：

```text
CONTROLLED_REPLACEMENT
candidateCount=1
```

ambiguous：

```text
BLOCK
```

禁止猜。

---

# 19. Runtime Final Authority

唯一 authority：

```text
EMPTY-SPECIAL-FINAL
```

必须：

```text
overall=true
logicalSlotPreserved=true
paragraphCountPreserved=true
canonicalOwnerCorrect=true
semanticCorrect=true
visualIndentCorrect=true
caretLogicalCorrect=true
caretVisualCorrect=true
unexpectedMerge=false
unexpectedDelete=false
```

E2 额外：

```text
EMPTY-SPECIAL-CARET-GEOMETRY overall=true
```

---

# 20. PowerShell JSONL UTF-8 Reader

当前 Windows PowerShell 5.1：

```text
Get-Content | ConvertFrom-Json
```

对 UTF-8 no-BOM JSONL 出现乱码并破坏 JSON。

只允许修 Runner/PowerShell helper。

优先：

```powershell
$Utf8 = New-Object System.Text.UTF8Encoding($false, $true)
[System.IO.File]::ReadLines($Path, $Utf8)
```

或：

```powershell
Get-Content -Encoding UTF8
```

提取单一事件时：

```text
先过滤 event string
再 ConvertFrom-Json
```

但 formal JSONL validator 仍须全文件逐行 parse。

不要改 forensic sink，除非 byte-level 证明原始 JSONL 本身损坏。

---

# 21. Strict Startup Readiness Race

当前：

```text
MainWindowHandle != 0
```

发生时插件可能尚未新 onload，导致读取旧 runtime-load。

Strict Startup 必须等待：

```text
runtime-load LastWriteTime >= new Typora StartTime
runtimeBuildId == expected Build
runtimeMainSha == expected SHA
initializationCount == 1
current-session RUNTIME-IDENTITY-FINAL exists
audit session created after process StartTime
```

然后才判：

```text
Strict Startup = PASS
```

---

# 22. Startup SyntaxError

仍存在：

```text
SyntaxError: Unexpected token ')'
```

发生在 InkChapter onload 前。

本 patch 不处理。

状态：

```text
Startup SyntaxError = EXISTS
InkChapter causality = NOT ESTABLISHED
```

---

# 23. Historical Sidecar Pollution

`doc.md` 的 114 条 historical records 本 patch 不清理。

Formal E1/E2/E3 必须绕开，使用 clean fixtures。

---

# 24. HARD FREEZE

禁止修改：

```text
CanonicalRecordId architecture
CURRENT_LIVE
CURRENT_AWAITING_TRANSFER
CURRENT_RETIRED
PERSISTED_HISTORICAL
NormalEnter SPLIT_1_TO_2
generic historical resolver
DocumentRuntimeContext
scope authority
Live Owner Dominance
ordinary non-empty Special Command
generic caret repair
generic selection restore
```

---

# 25. Source / Unit Gates

至少新增：

```text
EMPTY-DOM-NORMALIZE-1
native empty → ALREADY_NATIVE_EMPTY

EMPTY-DOM-NORMALIZE-2
empty md-plain span → NORMALIZED_TO_NATIVE_EMPTY

EMPTY-DOM-NORMALIZE-3
unknown/mixed child → BLOCK_UNSAFE_STRUCTURE

EMPTY-DOM-NORMALIZE-4
no invisible markdown chars

EMPTY-SETTLE-1
observer armed before consume

EMPTY-SETTLE-2
relevant mutation + quiet → SETTLED_BY_MUTATION_QUIET

EMPTY-SETTLE-3
no mutation + stable topology → SETTLED_NO_RELEVANT_MUTATION

EMPTY-SETTLE-4
timeout without authority → TIMEOUT_BLOCK

EMPTY-SETTLE-5
timeout block → no canonical/caret write

EMPTY-RUNTIME-PARSER-UTF8-1
U+3002 JSONL parse intact
```

继续：

```text
Full regression PASS
tsc PASS
```

---

# 26. Build / Deploy

若修改 `src/**`：

```text
new Build ID
build
deploy
SHA parity
```

报告：

```text
Build ID
projectMainSHA
runtimeMainSHA
shaMatch
styleSHA
```

---

# 27. Runtime 执行顺序

严格：

```text
1. source/unit fix
2. full regression
3. tsc
4. build
5. deploy
6. SHA parity
7. close Typora
8. processCount=0
9. create/reset clean E1/E2/E3 fixtures
10. verify sidecarExists=false / recordCount=0
11. Strict Startup with readiness polling
12. E2 first
13. E1
14. E3
15. each 3/3 PASS
16. final summary
17. STOP
```

E2 first 用于最快验证：

```text
native empty normalization
是否直接解决 caretVisualCorrect=false
```

---

# 28. Evidence 表述

Source/unit/build 后只能：

```text
Native Empty DOM Repair
= IMPLEMENTED / SOURCE + UNIT

Mutation Settle Authority
= IMPLEMENTED / SOURCE + UNIT
```

只有真实 E2：

```text
nativeEmptyEquivalent=true
caretVisualCorrect=true
```

才允许：

```text
Empty Paragraph Visual Caret
= PASS / RUNTIME
```

只有 clean E1/E2/E3 各 3/3：

```text
Empty Paragraph Special-Command Continuity
= PASS / RUNTIME
```

---

# 29. STOP 条件

以下任一立即 STOP：

```text
TIMEOUT_BLOCK
EMPTY-SPECIAL-FINAL overall=false
caretVisualCorrect=false after native normalization
unexpectedMerge=true
unexpectedDelete=true
canonicalOwnerCorrect=false
CANONICAL-SCOPE-MISMATCH > 0
awaitingCount > 0
unexpected generic selection write > 0
```

保存：

```text
runtime JSONL
fixture
sidecar
Build/SHA
PowerShell output
```

禁止 retry-until-pass。

---

# 30. Git

禁止：

```text
git add
git commit
git push
```

不要进入 R60。

本轮只完成：

```text
Native Empty DOM normalization
→ mutation-authoritative settle
→ clean E2/E1/E3 runtime
→ STOP
```
