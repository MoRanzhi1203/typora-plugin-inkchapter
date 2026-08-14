# TRAE P0 — R58.7 Editor Continuity Root Repair
## NormalEnter Transaction Attribution + Caret Ownership Handover + Atomic Canonical Semantic/Visual Transfer

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Current status:
>
> ```text
> R58.7 EDITOR INTERACTION EMERGENCY REPAIR NOT FIXED
> R60 BLOCKED
> ```
>
> Latest observed runtime:
>
> ```text
> build=inkchapter-r58-7-phA1-3-1a-scope-authority-k9m4v
> plugin/project SHA=3611A6C366709CB92C0ED9FD93501C84BE2D77CD8CAF6DEC249CBB5F3A2EE1C6
> shaMatch=true
> initializationCount=1
> ```

---

# 0. 本轮不是继续加日志，而是执行真正修复

当前用户真实 P0：

```text
1. `。。+Enter` 后继续普通 Enter，光标会跳到上一行。
2. force-indent 段落普通 Enter 后，completed paragraph 缩进丢失。
3. 第一行 Enter 仍存在 caret/selection 消失风险。
```

最新 runtime 已证明：

```text
P0-1 NormalEnterContinuityTransaction 尚未真正实现
P0-2 NORMAL-ENTER forensic 没有 transaction window，TEXT_INPUT / ARROW / SPECIAL mutation 被误归入 Normal Enter
P0-3 Canonical ownership transfer 成功，但 semantic / visual projection 没有一起迁移
P0-4 NORMAL-ENTER-POST 的 completedRuntimeId 使用 removed source，而不是 canonicalOwner replacement
P0-5 SAME_PARAGRAPH_LINE_BREAK 在没有 BR 证据时被猜测
P0-6 NORMAL_ENTER 与 ArrowUp/ArrowDown 同毫秒出现，必须验证真实事件来源
```

禁止继续只增加 forensic 然后停止。

---

# 1. HARD FREEZE

继续冻结：

```text
`。。` token recognition
Special Command token deletion
Special Command force-indent semantic commit
POST-TOKEN-SELECTION
SelectionTruth resolver 本体
EPHEMERAL SIDECAR-WRITE-SKIP
Single-Dot CURRENT_LIVE de-noise
Save-As classifier
Document Switch classifier
Merge algorithm
Historical resolver
```

本轮只修 Normal Enter continuity 主链。

---

# 2. 建立真实 NormalEnterContinuityTransaction

新增独立 transaction：

```ts
interface NormalEnterContinuityTransaction {
  id: string;
  intentId: string;
  intentEpoch: number;

  scopeId: string;
  persistenceKey: string | null;

  createdAt: number;
  active: boolean;

  sourceElement: HTMLElement;
  sourceRuntimeId: string;
  sourceOrdinal: number;

  sourceCanonicalRecordId: string | null;
  sourceCanonicalGeneration: number | null;

  sourceSemantic: "auto" | "force-indent" | "force-flush";
  sourceComputedIndent: string;

  preLogicalOffset: number | null;
  isFirstParagraph: boolean;
  previousParagraphRuntimeId: string | null;

  mutationBatchIds: string[];

  structuralDecision:
    | "PENDING"
    | "TOP_LEVEL_SPLIT"
    | "SAME_PARAGRAPH_LINE_BREAK"
    | "REPLACED_PARAGRAPH"
    | "INSERT_NEW_PARAGRAPH"
    | "NO_TOP_LEVEL_CHANGE"
    | "UNKNOWN";

  removedSourceRuntimeId: string | null;
  completedRuntimeId: string | null;
  caretDestinationRuntimeId: string | null;

  state:
    | "CAPTURED_PRE"
    | "CARET_OWNERSHIP_ACQUIRED"
    | "NATIVE_MUTATION_PENDING"
    | "STRUCTURE_RESOLVED"
    | "PROJECTION_VERIFIED"
    | "CARET_VERIFIED"
    | "CLOSED"
    | "FAILED";
}
```

每次真实 Normal Enter 都必须创建唯一：

```text
normalEnterTxnId=NENTER-...
```

并贯穿：

```text
NORMAL-ENTER-PRE
NORMAL-ENTER-RAW-MUTATION
NORMAL-ENTER-POST
NORMAL-ENTER-CARET-HANDOVER
NORMAL-ENTER-CARET-VERIFY
NORMAL-ENTER-FINAL
```

---

# 3. Mutation 必须真正归属于 transaction

当前错误：

```text
TEXT_INPUT
KEYBOARD_NAVIGATION
SPECIAL_COMMAND
```

产生的 mutation 仍会被打印成：

```text
NORMAL-ENTER-RAW-MUTATION
NORMAL-ENTER-POST
```

必须修复。

只有：

```text
activeNormalEnterTxn != null
AND
batch belongs to txn window
AND
intentEpoch == txn.intentEpoch
AND
scopeId == txn.scopeId
```

才允许归入 Normal Enter。

新用户输入：

```text
TEXT_INPUT
SPECIAL_COMMAND
NORMAL_ENTER
BACKSPACE
KEYBOARD_NAVIGATION
POINTER
```

如果不是当前 native Enter sequence 的一部分，必须：

```text
NORMAL-ENTER-TRANSACTION-CLOSE:
reason=SUPERSEDED_BY_NEW_USER_INTENT
```

之后所有 mutation 禁止继续写入旧 txn。

目标：

```text
textInputMisattributedToNormalEnter=0
navigationMisattributedToNormalEnter=0
specialCommandMisattributedToNormalEnter=0
```

---

# 4. Caret Ownership Handover

当前真实顺序仍是：

```text
NORMAL-ENTER-PRE
↓
HANDOFF-CLOSE
↓
CARET-EXPECTATION-CLOSE
↓
native mutation
```

但没有新的 caret owner。

必须改为：

```text
NORMAL_ENTER
↓
create NormalEnterContinuityTransaction
↓
state=CAPTURED_PRE
↓
acquire new caret ownership
↓
NORMAL-ENTER-CARET-HANDOVER
↓
THEN close old Special expectation/handoff
↓
Typora native mutation
```

必须：

```text
NORMAL-ENTER-CARET-HANDOVER:
normalEnterTxnId=...
fromCaretExpectationId=...
fromHandoffId=...
sourceRuntimeId=...
scopeId=...
newOwnerState=ACTIVE
decision=TAKE_OWNERSHIP
```

旧对象关闭原因改为：

```text
OWNERSHIP_TRANSFERRED_TO_NORMAL_ENTER
```

禁止在 handover 同步路径中出现：

```text
active caret owner count = 0
```

否则：

```text
NORMAL-ENTER-CARET-OWNERSHIP-GAP
decision=HARD_STOP
```

目标：

```text
caretOwnershipGapCount=0
```

---

# 5. Canonical Transfer 必须同时迁移 semantic + visual projection

最新 runtime 已证明：

```text
P-RUNTIME-3
record=R1
semantic=force-indent
computed=32px
```

Typora split：

```text
removed P3
added P8,P7
```

Resolver：

```text
canonicalOwner=P8
caretDestination=P7
```

Registry：

```text
TRANSFER R1:
P3 → P8
```

identity transfer 已成功。

但随后 P8 真实出现：

```text
sourceRecordId=R1
sourceSemantic=auto
sourceComputedIndent=0px
```

所以当前是：

```text
Canonical Identity Transfer = PASS
Semantic Transfer = FAIL
Visual Projection Transfer = FAIL
```

必须把 transfer 改为原子完整流程：

```text
transfer canonical owner
↓
apply record semantic to new owner
↓
refresh effective visual projection
↓
verify semantic
↓
verify computed style
↓
only then mark transfer complete
```

新增 mandatory：

```text
CANONICAL-TRANSFER-FINAL-AUDIT:
recordId=...
oldOwnerRuntimeId=...
newOwnerRuntimeId=...
recordMode=force-indent
newOwnerSemantic=force-indent
expectedIndent=32px
actualIndent=32px
identityTransfer=true
semanticTransfer=true
visualTransfer=true
overall=true
```

只有：

```text
identityTransfer=true
semanticTransfer=true
visualTransfer=true
```

才允许 `TRANSFER COMPLETE`。

如果：

```text
recordMode=force-indent
newOwnerSemantic=auto
```

必须：

```text
CANONICAL-TRANSFER-PROJECTION-FAIL:
reason=SEMANTIC_MISMATCH
decision=FAIL
```

如果：

```text
expectedIndent=32px
actualIndent=0px
```

必须：

```text
CANONICAL-TRANSFER-PROJECTION-FAIL:
reason=VISUAL_MISMATCH
decision=FAIL
```

CURRENT_LIVE transfer 禁止调用 historical resolver 补救。

---

# 6. 修正 completedRuntimeId

当前 Split：

```text
removedSource=P3
canonicalOwner=P8
caretDestination=P7
```

但 NORMAL-ENTER-POST 错误输出：

```text
completedRuntimeId=P3
```

正确必须是：

```text
removedSourceRuntimeId=P3
completedRuntimeId=P8
caretDestinationRuntimeId=P7
```

对于 TOP_LEVEL_SPLIT：

```text
completedRuntimeId == canonicalOwnerRuntimeId
```

且：

```text
completedRuntimeId != removedSourceRuntimeId
```

NORMAL-ENTER-POST 必须输出：

```text
normalEnterTxnId
intentEpoch
scopeId
removedSourceRuntimeId
completedRuntimeId
caretDestinationRuntimeId
completedRecordId
completedSemantic
completedComputedIndent
caretDestinationSemantic
caretDestinationComputedIndent
selectionRuntimeId
selectionInsideEditor
```

---

# 7. 禁止猜 SAME_PARAGRAPH_LINE_BREAK

当前很多：

```text
removed P=0
added P=0
```

只有：

```text
#text
characterData
SPAN normalization
```

却直接输出：

```text
SAME_PARAGRAPH_LINE_BREAK
```

这是错误。

只有存在明确证据，例如：

```text
added BR
known Typora line-break node
pre/post snapshot 明确新增 logical line boundary
```

才允许：

```text
SAME_PARAGRAPH_LINE_BREAK
```

否则：

```text
NO_TOP_LEVEL_CHANGE
```

或：

```text
UNKNOWN
```

`0 removed P / 0 added P` 绝不等于 line break。

---

# 8. 新增 INSERT_NEW_PARAGRAPH

当前 runtime 已出现：

```text
removedParagraphCount=0
addedParagraphCount=1
selection=new P
mutationShape=COMPLEX
```

必须判断是否为：

```text
INSERT_NEW_PARAGRAPH
```

不能只输出 UNKNOWN 然后继续 PASS。

Structural resolver 必须比较：

```text
pre paragraph runtime list
post paragraph runtime list
source runtime
source connected state
added/removed runtimeIds
selection runtimeId
canonical owner
text snapshot
```

不能只依赖单个 observer batch。

---

# 9. ArrowUp / ArrowDown Provenance

最新 runtime 多次：

```text
NORMAL_ENTER
```

同一毫秒紧接：

```text
KEYBOARD_NAVIGATION
ArrowUp / ArrowDown
```

必须确认它们到底是不是用户真实按键。

增加：

```text
KEYBOARD-EVENT-PROVENANCE:
eventId=...
key=...
code=...
isTrusted=...
repeat=...
timeStamp=...
targetTag=...
targetRuntimeId=...
defaultPrevented=...
eventPhase=...
sourceListener=...
```

Acceptance 操作中明确：

```text
只按 Enter
不按 ArrowUp/ArrowDown
```

如果仍出现 navigation：

```text
unexpectedKeyboardNavigationCount > 0
```

必须 FAIL。

如果是真实用户按键：

```text
isTrusted=true
```

并从 Enter bug 中排除。

---

# 10. 第一行专项

当前这一份日志没有再次捕获 first-line selection disappear。

因此：

```text
First-Line bug = NOT PROVEN FIXED
```

第一行：

```text
sourceOrdinal=0
isFirstParagraph=true
previousParagraphRuntimeId=none
```

任何 caret restore 禁止 fallback：

```text
previous paragraph
nearest previous paragraph
source paragraph
```

优先：

```text
native post selection valid
→ no caret write
```

只有 selection missing/outside editor 才能 restore，且目标必须是：

```text
transaction-resolved caretDestinationRuntimeId
```

无法 resolve：

```text
FIRST-LINE-CARET-FAIL
decision=FAIL
```

---

# 11. Unit Tests

必须新增至少：

```text
NTX-1
Normal Enter N1 → B1/B2
Text Input → B3
N1 只能拥有 B1/B2

NTX-2
N1 active → N2 begins
N1 close，N2 成为唯一 active txn

CH-1
NormalEnter owner ACTIVE 必须先于旧 Special owner CLOSE

CH-2
ownership handover 中 activeOwnerCount 不得为 0

CT-1
force-indent record P1→P2
transfer 后 P2 semantic=force-indent，computed=expected

CT-2
identity success + semantic failure
overall 必须 false

CR-1
removed P1 + added P2/P3
canonicalOwner=P2
caret=P3
→ removedSource=P1 / completed=P2 / caret=P3

SD-1
0/0 P + text/span mutation
不得判 SAME_PARAGRAPH_LINE_BREAK

SD-2
明确 BR evidence
才允许 SAME_PARAGRAPH_LINE_BREAK

INP-1
0 removed + 1 added P + selection=new P
解析 INSERT_NEW_PARAGRAPH
```

---

# 12. Runtime Acceptance

## Case A — force-indent split 10/10

```text
paragraph
→ `。。+Enter`
→ verify 32px
→ ordinary Enter
```

每次必须：

```text
source record mode=force-indent
canonicalOwner replacement semantic=force-indent
canonicalOwner computedIndent=32px
caret destination selectionInsideEditor=true
```

## Case B — completed identity

所有 Split：

```text
completedRuntimeId == canonicalOwnerRuntimeId
completedRuntimeId != removedSourceRuntimeId
```

## Case C — caret jump 20 次

测试过程中：

```text
不主动按 ArrowUp/ArrowDown
```

要求：

```text
previousParagraphJumpCount=0
unexpectedKeyboardNavigationCount=0
selectionLossCount=0
```

## Case D — first line 10/10

```text
new Untitled
first paragraph
text
ordinary Enter
```

必须：

```text
selectionExists=true
insideEditor=true
firstLineFailureCount=0
```

## Case E — attribution purity

执行：

```text
10 Normal Enter
10 Text Input
5 intentional Arrow navigation
3 Special Command
```

要求：

```text
textInputMisattributedToNormalEnter=0
navigationMisattributedToNormalEnter=0
specialCommandMisattributedToNormalEnter=0
```

---

# 13. Final Audit

必须输出：

```text
NORMAL-ENTER-ROOT-REPAIR-AUDIT:

normalEnterCount=...
normalEnterTxnCreatedCount=...
normalEnterTxnClosedCount=...

caretOwnershipGapCount=0
selectionLossCount=0
previousParagraphJumpCount=0
unexpectedKeyboardNavigationCount=0

textInputMisattributedToNormalEnter=0
navigationMisattributedToNormalEnter=0
specialCommandMisattributedToNormalEnter=0

canonicalIdentityTransferFailureCount=0
canonicalSemanticTransferFailureCount=0
canonicalVisualTransferFailureCount=0

completedRuntimeMismatchCount=0
firstLineFailureCount=0

topLevelSplitCount=...
sameParagraphLineBreakCount=...
insertNewParagraphCount=...
noTopLevelChangeCount=...
unknownStructuralCount=...

overall=PASS|FAIL
```

---

# 14. Build ID

必须使用全新唯一：

```text
inkchapter-r58-7-editor-continuity-root-repair-<unique>
```

禁止继续复用：

```text
inkchapter-r58-7-phA1-3-1a-scope-authority-k9m4v
```

必须核对：

```text
SOURCE_BUILD_ID
DIST_BUILD_ID
DEPLOYED_BUILD_ID
RUNTIME_BUILD_ID
REPORT_BUILD_ID
```

全部一致。

---

# 15. Build / Deploy

执行：

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1
```

报告：

```text
typecheck
tests
new tests
build
project SHA
plugin SHA
shaMatch
style SHA
Build ID
```

---

# 16. Strict Startup

重启后必须验证：

```text
old Typora process exited
new PID
StartTime
MainWindowHandle != 0
MainWindowTitle nonempty
target vault
target document / Untitled
runtime plugin path
plugin SHA
project SHA
shaMatch=true
style SHA
Build ID
runtime Build ID
initializationCount=1
```

缺任一 mandatory：

```text
启动命令已发出，但尚未确认成功
```

---

# 17. Hard Stop

任一：

```text
没有 NormalEnterContinuityTransaction
没有 normalEnterTxnId
TEXT_INPUT/ARROW/SPECIAL mutation 继续污染 Normal Enter
new owner 未 active 就关闭旧 caret owner
caretOwnershipGapCount>0
record 已 transfer 但 replacement semantic=auto
record mode=force-indent 但 replacement computedIndent=0px
completedRuntimeId 使用 removed runtimeId
无 BR 证据仍判 SAME_PARAGRAPH_LINE_BREAK
用户未按 Arrow 却出现 unexpected navigation
first-line selection lost
继续复用旧 Build ID
只加日志但不修复
只通过 typecheck/build 就宣布 PASS
```

立即：

```text
R58.7 EDITOR CONTINUITY ROOT REPAIR NOT FIXED — R60 BLOCKED
```

---

# 18. 禁止假修复

禁止：

```text
setTimeout restore 到上一段
always restore source paragraph
每次 Enter 手动拆 DOM
给所有 replacement paragraph 硬编码 32px
只复制 CSS class 不复制 semantic
只复制 semantic 不验证 computed style
用 historical resolver 修 CURRENT_LIVE
把 0/0 P mutation 猜成 SAME_P_BR
只修改 trace 文本
隐藏 UNKNOWN
删除 Arrow trace
不更新 Build ID
```

---

# 19. 推荐修改范围

优先：

```text
src/heading-numbering/heading-numbering-service.ts
src/heading-numbering/paragraph-indent-manager.ts
```

强烈建议新增：

```text
src/heading-numbering/normal-enter-continuity.ts
```

用于承载：

```text
NormalEnterContinuityTransaction
transaction lifecycle
mutation attribution
pre/post resolver
caret ownership state
```

Registry 只做 atomic semantic/visual projection 的最小适配。

---

# 20. 修改前必须输出 Source Maps

```text
1. Normal Enter Transaction Source Map
2. Mutation Attribution Source Map
3. Caret Ownership Handover Source Map
4. Canonical Transfer + Semantic Projection Source Map
5. Completed Runtime Resolver Source Map
6. Keyboard Navigation Provenance Source Map
```

然后回答：

```text
1. 为什么当前没有独立 NormalEnter transaction？
2. 为什么 TEXT_INPUT / ARROW / SPECIAL mutation 会被记成 NORMAL-ENTER？
3. 为什么 record 已从 P3 transfer 到 P8，但 P8 semantic=auto / computed=0px？
4. canonical transfer 当前在哪一步结束，semantic/projection writer 为什么没一起执行？
5. 为什么 completedRuntimeId 会等于 removed source？
6. 没有 BR 时为什么仍判 SAME_PARAGRAPH_LINE_BREAK？
7. 同毫秒 ArrowUp/ArrowDown 到底来自真实用户输入、synthetic event 还是 classifier bug？
```

---

# 21. Execution Order

严格按：

```text
Step 1
实现 NormalEnterContinuityTransaction
+ txnId
+ mutation attribution
+ caret ownership handover

Step 2
typecheck + unit tests

Step 3
实现 Canonical Transfer Atomic Projection

Step 4
修 completedRuntimeId + structural evidence

Step 5
加入 keyboard provenance

Step 6
build/deploy/restart

Step 7
strict startup

Step 8
真实 GUI runtime acceptance
```

禁止跳步。

---

# 22. Acceptance 分层

必须分别报告：

```text
SOURCE COMPLETE
UNIT TEST COMPLETE
BUILD COMPLETE
DEPLOY COMPLETE
STARTUP VERIFIED
RUNTIME ACCEPTANCE COMPLETE
```

只有 `RUNTIME ACCEPTANCE COMPLETE` 才允许 PASS。

---

# 23. Final Verdict

全部 mandatory runtime gate 真实通过：

```text
R58.7 EDITOR CONTINUITY ROOT REPAIR PASS
— NORMAL ENTER TRANSACTION / CARET OWNERSHIP / ATOMIC PROJECTION CLOSED
```

任何：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

必须：

```text
R58.7 EDITOR CONTINUITY ROOT REPAIR NOT FIXED — R60 BLOCKED
```

---

# 24. Execution Rules

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

禁止编造任何：

```text
normalEnterTxnId
mutation ownership
caret ownership
semantic transfer
visual transfer
completed runtime
keyboard provenance
Build ID
SHA
PID
StartTime
MainWindowHandle
MainWindowTitle
runtime acceptance count
```

---

# 25. 最终业务 invariant

必须最终实现：

```text
force-indent P1
↓
Normal Enter
↓
Typora replaces P1
↓
canonicalOwner=P2
caretDestination=P3
↓
record identity P1→P2
↓
force-indent semantic P1→P2
↓
32px visual projection P1→P2
↓
selection stays on P3
↓
no previous-line jump
↓
next input continues normally
```

同时：

```text
Normal Enter transaction
只能拥有自己的 mutations，
不得污染后续 Text Input / Navigation / Special Command。
```
