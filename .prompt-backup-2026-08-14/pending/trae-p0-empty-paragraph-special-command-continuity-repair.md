# Trae — P0 Empty Paragraph Special-Command Structural + Caret Continuity Repair

## 0. 当前冻结基线

当前 Build：

```text
inkchapter-r58-7-file-audit-ime-provenance-imep4k7
```

当前 Main SHA：

```text
939F8F3E014724C2F7EAEE6AB9C336A3BB2013DE7EE308F79C932390EE88BE2C
```

当前 Style SHA：

```text
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

当前稳定主链继续 HARD FREEZE：

```text
Canonical Transfer
Scope Authority
Awaiting Transfer
Generic Historical Resolver Isolation
DocumentRuntimeContext
NormalEnter SPLIT_1_TO_2
Generic Caret Repair / Restore
```

本轮不要继续 Full Reduced Matrix。

只处理：

```text
P0 Empty Paragraph Special-Command
Structural + Caret Continuity
```

---

# 1. 三个必须复现的真实故障

## E1 — 尾部连续空行

```text
文本段落
空行
空行
空行 ← 光标
EOF
```

执行：

```text
。。
Enter
```

当前错误：

```text
目标空行确实变为首行缩进二字符
但 caret 跳到上一空行

再次 Enter 后
caret 又进入目标行下一行

必须再 ArrowUp
才能回目标行
```

预期：

```text
目标 logical empty slot 保留
canonical owner=目标空行
caret=目标空行@0

随后普通 Enter：
canonical 留在原目标空行
caret 只进入新建下一行
```

## E2 — 单个尾部空行

```text
段落文本
空行 ← 光标
EOF
```

执行：

```text
。。
Enter
```

当前错误：

```text
semantic 已 force-indent
但 caret 视觉上仍停在左侧顶格

必须再次 Enter
原行缩进视觉才真正稳定
```

预期：

```text
命令完成后立即：

semantic=force-indent
visual indent=2em
caret logicalOffset=0
caret visual X=expected indent X

不需要额外 Enter
不需要 blur/refocus
```

## E3 — 中间连续空行

```text
文本段落 A
空行 B
空行 C ← 光标
空行 D
文本段落 E
```

执行：

```text
。。
Enter
```

当前错误：

```text
C 被删除
```

预期：

```text
B/C/D logical slot 数量不变
C 不消失
E 不前移替代 C

canonical owner=C
caret=C@0

unexpected merge=0
unexpected delete=0
```

---

# 2. 根因模型

三个问题统一视为：

```text
原始逻辑 paragraph = EMPTY

用户临时输入 "。。"
↓
paragraph 暂时 non-empty

Special Command 消费 token
↓
paragraph 再次 EMPTY

Typora 执行自己的：
empty-block normalization
replacement
collapse
placeholder processing

当前插件却在 normalization 完成前
就把事务判定为成功
```

当前类似：

```text
REGISTER_CURRENT
↓
CANONICAL-RECORD-COMMIT
↓
consume "。。"
↓
POST-TOKEN-SELECTION sameAsCommand=true
↓
ENTER-COMMIT-ATOMIC overallSuccess=true
```

这个同步 PASS 对 token-only empty case 不再充分。

---

# 3. 新分支：TOKEN_ONLY_EMPTY_SPECIAL_COMMAND

当执行 Enter 前：

```text
currentParagraphVisibleText === "。。"
```

必须进入：

```text
TOKEN_ONLY_EMPTY_SPECIAL_COMMAND
```

普通：

```text
"文本。。" + Enter
```

继续走旧 non-empty Special Command 路径，不得改变。

核心原则：

```text
TOKEN REMOVED
≠
COMMAND COMMITTED
```

---

# 4. EmptySpecialCommandTransaction

新增：

```ts
type EmptySpecialCommandState =
  | "PRE_CAPTURED"
  | "TOKEN_CONSUMING"
  | "NORMALIZATION_PENDING"
  | "STRUCTURE_RESOLVED"
  | "CANONICAL_COMMITTED"
  | "CARET_VERIFIED"
  | "VISUAL_VERIFIED"
  | "COMMITTED"
  | "BLOCKED";
```

事务至少保存：

```ts
interface EmptySpecialCommandTransaction {
  txnId: string;

  scopeId: string;
  intentEpoch: number;

  sourceElement: HTMLElement;
  sourceRuntimeId: string;
  sourceOrdinal: number;

  previousElement: HTMLElement | null;
  previousRuntimeId: string | null;

  nextElement: HTMLElement | null;
  nextRuntimeId: string | null;

  paragraphCountBefore: number;

  sourceWasTokenOnly: true;

  existingCanonicalRecordId: string | null;

  desiredMode: "force-indent";

  state: EmptySpecialCommandState;
}
```

---

# 5. 延迟 token-only Canonical Commit

禁止：

```text
REGISTER_CURRENT
→ 立即绑定马上可能被 Typora replacement/delete 的 source P
```

改为：

```text
capture EmptySpecialCommandPlan
↓
consume token
↓
等待 Typora normalization
↓
resolve final logical empty slot
↓
唯一 finalElement
↓
Registry.commit(plan, finalElement)
```

建议：

```ts
interface EmptySpecialCommandPlan {
  operation: "CREATE" | "UPDATE";

  existingRecordId: string | null;

  mode: "force-indent";

  scopeId: string;
  intentEpoch: number;

  sourceRuntimeId: string;
  sourceOrdinal: number;

  previousRuntimeId: string | null;
  nextRuntimeId: string | null;

  paragraphCountBefore: number;

  sourceWasTokenOnly: true;
}
```

规则：

```text
已有 canonical → UPDATE_EXISTING，禁止 append

新 canonical → final owner 唯一确认后才能 CREATE
```

---

# 6. EMPTY-BLOCK-DOM-SNAPSHOT

先采样 Typora 原生空段落 DOM。

新增：

```text
EMPTY-BLOCK-DOM-SNAPSHOT
```

阶段：

```text
NATIVE_EMPTY
BEFORE_TOKEN_CONSUME
AFTER_TOKEN_CONSUME
AFTER_MICROTASK
AFTER_RAF
```

记录：

```text
runtimeId
ordinal
tagName
className
textContent
innerHTML
childNodeCount
childNodeSummary
hasBR
hasPlaceholderSpan
hasTyporaMarker
isConnected
previousRuntimeId
nextRuntimeId
selectionRuntimeId
selectionOffset
```

目标：

```text
比较 native empty paragraph
与 consume "。。" 后产生的 empty paragraph
是否为同一种 Typora 认可的 empty-block representation
```

若当前 token consume 产生异常空 DOM，恢复 Typora 原生 empty-block representation。

禁止：

```text
​
&nbsp;
不可见 Markdown 业务字符
```

不得污染 Markdown。

---

# 7. Transaction-scoped EmptySlotResolution

严禁：

```text
previous paragraph fallback
next paragraph fallback
ordinal-only fallback
textHash fallback
generic historical resolver
```

新增：

```ts
interface EmptySlotResolution {
  decision:
    | "SAME_NODE"
    | "CONTROLLED_REPLACEMENT"
    | "AMBIGUOUS"
    | "MISSING";

  sourceRuntimeId: string;
  resolvedRuntimeId: string | null;

  previousRuntimeId: string | null;
  nextRuntimeId: string | null;

  candidateCount: number;

  paragraphCountBefore: number;
  paragraphCountAfter: number;
}
```

优先：

```text
sourceElement.connected=true
→ SAME_NODE
```

若 source 被 replacement：

```text
pre:
prev=P10
source=P11
next=P12

post:
P11 disconnected
P10 connected
P12 connected

P10/P12 之间唯一出现 replacement empty P13

→ CONTROLLED_REPLACEMENT
```

允许：

```text
logical P11
→ physical P13
```

若：

```text
candidateCount != 1
```

必须：

```text
BLOCK_AMBIGUOUS_EMPTY_SLOT
```

不能猜。

---

# 8. Structural Invariant

Special Command 本身必须：

```text
logicalSlotPreserved=true
paragraphCountAfter==paragraphCountBefore
```

禁止：

```text
新增 logical paragraph
删除 logical paragraph
MERGE_2_TO_1
silent collapse
```

controlled replacement 只有：

```text
1 removed
+
1 replacement
+
same logical slot proven
```

才允许继续。

---

# 9. Empty-only Caret Restore

禁止恢复 generic CARET-REPAIR。

只允许：

```text
EMPTY-SPECIAL-CARET-RESTORE
```

必须全部成立：

```text
transaction.active=true

currentIntentEpoch==transaction.intentEpoch

noNewerTrustedUserIntent=true

resolvedEmptySlot unique=true

resolvedElement.connected=true

currentSelection != resolvedElement@0
```

才允许一次：

```text
selection write
→ resolvedElement@logicalOffset0
```

硬限制：

```text
authorizedCaretWriteCount<=1
```

随后：

```text
microtask verify
RAF verify
```

失败则：

```text
BLOCK
```

禁止多时点重复拉回。

---

# 10. E2：真实 Caret Geometry

不能再把：

```text
semantic=force-indent
computedTextIndent=32px
```

等价为：

```text
caret 已视觉缩进
```

新增：

```text
EMPTY-SPECIAL-CARET-GEOMETRY
```

记录：

```text
runtimeId
fontSizePx
expectedIndentPx
paragraphRectLeft
paragraphContentLeft
caretRectLeft
actualCaretIndentPx
tolerancePx
logicalOffset
overall
```

计算：

```text
actualCaretIndentPx
=
caretRectLeft - paragraphContentLeft
```

要求：

```text
abs(actualCaretIndentPx-expectedIndentPx)
<= tolerancePx
```

---

# 11. 若 runtime 证明 text-indent 无法定位 empty caret

只有真实 E2 runtime 证明：

```text
semantic correct
computed text-indent correct
caretRect.left still unindented
```

才允许增加：

```text
.inkchapter-empty-force-indent-caret
```

候选方案：

```text
empty + focused:
padding-inline-start:2em
text-indent:0

输入第一枚真实字符后：
移除 empty-only projection
恢复：
text-indent:2em
padding-inline-start:0
```

必须 runtime geometry 验证。

禁止影响非空 paragraph。

---

# 12. E1 Acceptance

```text
文本
空 A
空 B
空 C ← caret
EOF
```

`。。+Enter` 后必须：

```text
A survives
B survives
C survives

paragraphCount unchanged

logicalTarget=C
canonicalOwner=C

caret=C@0

caretLogicalCorrect=true
caretVisualCorrect=true

unexpectedMerge=false
unexpectedDelete=false
```

随后普通 Enter：

```text
C remains force-indent
new D created
canonicalOwner remains C
caret=D@0
```

禁止 caret 回 B。

---

# 13. E2 Acceptance

```text
文本
空 C ← caret
EOF
```

`。。+Enter` 后：

```text
C survives
semantic=force-indent
expectedIndent=2em
caretLogicalOffset=0
caret visual geometry=2em within tolerance
```

不得要求：

```text
额外 Enter
blur
refocus
```

随后直接输入 `A`：

```text
A 从 2em 位置开始
canonical owner unchanged
```

---

# 14. E3 Acceptance

```text
文本 A
空 B
空 C ← caret
空 D
文本 E
```

`。。+Enter` 后：

```text
B survives
C survives
D survives
E survives

logical slot count unchanged
paragraphCount unchanged

C still between B and D

E 不前移替代 C

canonicalOwner=C
caret=C@0

unexpectedMerge=false
unexpectedDelete=false
```

---

# 15. 新 Audit

必须新增：

```text
EMPTY-SPECIAL-PRE
EMPTY-SPECIAL-TOKEN-CONSUMED
EMPTY-SPECIAL-MUTATION
EMPTY-SPECIAL-STRUCTURAL-RESOLUTION
EMPTY-SPECIAL-CANONICAL-COMMIT
EMPTY-SPECIAL-CARET-VERIFY
EMPTY-SPECIAL-CARET-GEOMETRY
EMPTY-SPECIAL-VISUAL-VERIFY
EMPTY-SPECIAL-FINAL
```

`EMPTY-SPECIAL-PRE` 至少：

```text
txnId
intentEpoch
scopeId
sourceRuntimeId
sourceOrdinal
previousRuntimeId
nextRuntimeId
previousVisibleText
sourceVisibleText
nextVisibleText
paragraphCountBefore
selectionRuntimeId
logicalOffset
existingCanonicalRecordId
```

`EMPTY-SPECIAL-FINAL`：

```text
txnId
sourceWasTokenOnly=true
logicalSlotPreserved=
paragraphCountPreserved=
canonicalOwnerCorrect=
semanticCorrect=
visualIndentCorrect=
caretLogicalCorrect=
caretVisualCorrect=
authorizedCaretWriteCount=
unexpectedMerge=
unexpectedDelete=
overall=
```

只有：

```text
EMPTY-SPECIAL-FINAL overall=true
```

才算最终 PASS。

---

# 16. ENTER-COMMIT-ATOMIC 降级

对：

```text
TOKEN_ONLY_EMPTY_SPECIAL_COMMAND
```

原：

```text
ENTER-COMMIT-ATOMIC overallSuccess=true
```

只能解释为：

```text
SYNCHRONOUS_PHASE_PASS
```

不能作为最终 command PASS。

最终 authority：

```text
EMPTY-SPECIAL-FINAL
```

---

# 17. 单元/集成测试

至少：

```text
EMPTY-SPECIAL-E1
trailing empty run

EMPTY-SPECIAL-E2
single trailing empty

EMPTY-SPECIAL-E3
middle empty run

EMPTY-SPECIAL-E4
first paragraph empty

EMPTY-SPECIAL-E5
already FORCE_INDENT empty paragraph

EMPTY-SPECIAL-E6
FORCE_FLUSH → FORCE_INDENT
must UPDATE_EXISTING

EMPTY-SPECIAL-E7
new trusted intent supersedes pending transaction

EMPTY-SPECIAL-E8
source survives → SAME_NODE

EMPTY-SPECIAL-E9
unique replacement → CONTROLLED_REPLACEMENT

EMPTY-SPECIAL-E10
ambiguous replacement → BLOCK

EMPTY-SPECIAL-E11
normal nonempty "文本。。+Enter"
old path unaffected

EMPTY-SPECIAL-E12
authorizedCaretWriteCount<=1

EMPTY-SPECIAL-E13
caret geometry PASS

EMPTY-SPECIAL-E14
caret geometry FAIL
→ BLOCK / no fake PASS
```

---

# 18. Regression Gates

必须继续通过：

```text
Normal Enter SPLIT_1_TO_2
Canonical Transfer
CURRENT_AWAITING_TRANSFER
Backspace UPDATE_EXISTING
Canonical Promotion existing tests
Historical physical load
DocumentRuntimeContext
Persisted A→B switch
Rehydrate live binding
Selection writer inventory
```

---

# 19. 允许修改范围

优先：

```text
src/services/heading-numbering-service.ts

src/paragraph/paragraph-indent-manager.ts

src/paragraph/paragraph-canonical-registry.ts
仅 final-owner commit / controlled replacement 必要接口

src/style.css
仅 runtime geometry 证明 empty caret 需要专用 projection 时

tests/**

scripts/r58-matrix/**
用于 E1/E2/E3 runtime fixture/parser/audit
```

---

# 20. HARD FREEZE

禁止重构：

```text
CanonicalRecordId architecture

CURRENT_LIVE
CURRENT_AWAITING_TRANSFER
CURRENT_RETIRED
PERSISTED_HISTORICAL

NormalEnter SPLIT_1_TO_2 resolver

generic historical resolver

DocumentRuntimeContext

scope authority

ordinary nonempty Special Command path

generic caret repair

generic selection restore
```

---

# 21. 不要混入其他问题

本 patch 暂不处理：

```text
POST-TEXT observation supersession
PromotionRequest lifecycle
Rehydrate no-op storm
startup SyntaxError
```

先单独收敛这个 P0。

---

# 22. 实现顺序

```text
1. 建立 E1/E2/E3 fixtures
2. 增加 EMPTY-BLOCK-DOM-SNAPSHOT
3. 采样 native empty block
4. 比较 consume-token 后 empty DOM
5. 建立 EmptySpecialCommandTransaction
6. 延迟 token-only canonical commit
7. 建立 EmptySlotResolution
8. 建立 post-normalization settle
9. 建立 transaction-scoped caret restore
10. 增加 caret geometry audit
11. 必要时才增加 empty-only visual projection
12. 跑 E1/E2/E3 tests
13. 跑全 regression
14. tsc
15. build
16. deploy
17. SHA parity
18. Strict Startup
19. E1 runtime
20. E2 runtime
21. E3 runtime
22. final-summary
23. STOP
```

---

# 23. Runtime 验收

E1/E2/E3 每个至少：

```text
3/3 PASS
```

每轮必须：

```text
EMPTY-SPECIAL-FINAL overall=true

canonicalOwnerCorrect=true
logicalSlotPreserved=true
caretLogicalCorrect=true
caretVisualCorrect=true

unexpectedMerge=false
unexpectedDelete=false

CANONICAL-SCOPE-MISMATCH=0

AWAITING-TRANSFER-LEAK-AUDIT
awaitingCount=0

unexpected CARET-REPAIR=0
unexpected generic selection write=0
```

任何失败：

```text
STOP
```

保存现场，禁止 retry-until-pass。

---

# 24. Evidence 表述

Source/unit/build/deploy 通过后只能：

```text
Empty Special Repair
= IMPLEMENTED / SOURCE + UNIT
```

只有真实 Typora E1/E2/E3 runtime 全部通过：

```text
Empty Paragraph Special-Command Continuity
= PASS / RUNTIME
```

禁止把 build PASS 等同 runtime PASS。

---

# 25. Strict Startup

如果本轮启动/重启 Typora，必须验证：

```text
old Typora process exited
new PID
StartTime
MainWindowHandle != 0
MainWindowTitle != ""
targetVault
targetDocument
runtimeMainPath
runtimeMainSHA
projectMainSHA
shaMatch=true
styleSHA
Build ID
runtime Build ID
initializationCount=1
```

实际启动命令已执行但 mandatory evidence 不完整时，必须原样写：

启动命令已发出，但尚未确认成功

如果根本没有执行启动：

```text
Strict Startup = NOT EXECUTED
```

---

# 26. Git

禁止：

```text
git add
git commit
git push
```

不要自动进入 R60。

完成 E1/E2/E3 runtime 验收后 STOP。
