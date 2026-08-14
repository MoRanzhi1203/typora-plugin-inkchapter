# TRAE P0 — R58.6.5 Caret Expectation + Continuity Verification + Merge Forced Runtime Acceptance + Strict Identity Finalization

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Final Runtime Closure Before Full R58.6 Acceptance**
>
> Current authoritative status:
>
> ```text
> R58.6.4 NOT FIXED
> R60 BLOCKED
> ```
>
> 本轮不要再修改 SelectionTruth 主体，不要重写 Split / Promotion / Mutation Shape / Handoff。
>
> 只处理 3 个剩余闭环：
>
> 1. **CaretExpectation + SELECTION-CONTINUITY-VERIFY + one-shot restore**
> 2. **MERGE_2_TO_1 Forced Runtime Acceptance**
> 3. **Strict Runtime Identity Finalization**

---

# 0. 最新 Runtime Ground Truth

当前真实 runtime Build：

```text
inkchapter-r58-6-4-selection-runtime-merge-acceptance-h1j3n
```

已经真实通过，必须 HARD FREEZE：

```text
SelectionTruth runtime activation:
SELECTION-TRUTH source=MUTATION
SELECTION-TRUTH source=OBS

OBS-SELECTION:
runtimeId=P-RUNTIME-N
sameAsCommand=true/false

selParagraph=undefined sameAsCommand=true
→ 已消失

Mutation Shape Authority:
1→1 = REPLACE_1_TO_1
1→2 = SPLIT_1_TO_2
2→1 = MERGE_2_TO_1

SPLIT_1_TO_2 resolver:
canonicalOwner != caretDestination
reason=LIVE_DOM_SPLIT_COMPLETED_PARAGRAPH

Proof-Before-Mutation:
bindingVerified=false decision=PROMOTE = 0

HANDOFF-CLOSE:
reason=NO_REPLACEMENT_REQUIRED

Live Owner Dominance:
HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER

General awaiting leak:
AWAITING-TRANSFER-LEAK-AUDIT awaitingCount=0

Plugin runtime artifact path:
<target vault>\.typora\plugins\dist\main.js

Plugin SHA256:
real non-unknown

Active Doc final refresh:
RUNTIME-IDENTITY-FINAL activeDoc=...\doc.md

initializationCount=1

physical sidecar:
source=physical
backend=filesystem
```

禁止重新推翻以上链路。

---

# 1. 当前真正的 P0 — SelectionTruth 已正确，但 Caret 会真实漂移

最新 runtime 已证明：

```text
commandRuntimeId=P-RUNTIME-1
```

命令刚完成：

```text
POST-TOKEN-SELECTION:
resolvedRuntimeId=P-RUNTIME-1
sameAsCommand=true
anchorOffset=0
caretSuccess=true
```

T4/T5/T6 仍在预期 paragraph，但后续 T7/T8/T9 可真实移动到其他 `P-RUNTIME-*`。

因此本轮结论必须是：

```text
Selection parser 已经能正确告诉我们 caret 漂移了
```

而不是：

```text
Selection parser 自己解析错
```

本轮禁止继续修改 `resolveSelectionTruth()` 主算法。

---

# 2. 本轮核心模型：CaretExpectation

新增/正式启用：

```ts
type CaretExpectationReason =
  | "SPECIAL_COMMAND_CURRENT_PARAGRAPH"
  | "SPLIT_NEW_PARAGRAPH"
  | "MERGE_DESTINATION";

interface CaretExpectation {
  expectationId: string;
  documentKey: string;

  expectedElement: HTMLElement;
  expectedRuntimeId: string;
  expectedLogicalOffset: number | null;

  canonicalRecordId: string | null;
  generation: number;

  reason: CaretExpectationReason;
  createdAt: number;
  active: boolean;
}
```

CaretExpectation 不是旧 `originalElement`，而是当前 continuity transaction 对 caret 目标的 authoritative expectation。

---

# 3. Special `。。+Enter` Contract

业务语义：

```text
token removed
current logical paragraph force-indent
caret remains in same logical paragraph
logicalOffset=0
```

命令 commit 后必须创建：

```text
reason=SPECIAL_COMMAND_CURRENT_PARAGRAPH
expectedRuntimeId=<current live paragraph runtimeId>
expectedLogicalOffset=0
```

如果发生 current paragraph replacement：

```text
P1 → P6
```

并 canonical transfer：

```text
R1: P1 → P6
```

则必须同步：

```text
CaretExpectation.expectedRuntimeId:
P1 → P6
```

后续 OBS 不得继续比较 detached/old P1。

---

# 4. Split CaretExpectation

例如：

```text
P6 → P8 + P7
canonicalOwner=P8
caretDestination=P7
```

必须：

```text
reason=SPLIT_NEW_PARAGRAPH
expectedRuntimeId=P7
```

禁止把 canonical owner P8 当成 caret target。

---

# 5. Merge CaretExpectation

例如：

```text
P3 + P4 → P21
```

如果 merge resolved：

```text
reason=MERGE_DESTINATION
expectedRuntimeId=P21
```

---

# 6. SELECTION-CONTINUITY-VERIFY 必须真实进入 Runtime

新增统一方法：

```ts
interface CaretVerificationResult {
  expectationId: string;
  expectedRuntimeId: string;
  actualRuntimeId: string | null;

  expectedLogicalOffset: number | null;
  actualLogicalOffset: number | null;

  paragraphMatches: boolean;
  offsetMatches: boolean;
  connected: boolean;

  verified: boolean;
  caretWriteAttempted: boolean;
}

function verifyCaretExpectation(
  expectation: CaretExpectation,
  source: "MICROTASK" | "RAF" | "OBS"
): CaretVerificationResult;
```

必须使用现有 authoritative：

```text
resolveSelectionTruth()
```

得到 actual runtimeId / logicalOffset。

---

# 7. Runtime Trace Contract

必须输出：

```text
SELECTION-CONTINUITY-VERIFY:
expectationId=...
reason=SPECIAL_COMMAND_CURRENT_PARAGRAPH|SPLIT_NEW_PARAGRAPH|MERGE_DESTINATION
source=MICROTASK|RAF|OBS
expectedRuntimeId=P-RUNTIME-X
actualRuntimeId=P-RUNTIME-Y
expectedLogicalOffset=...
actualLogicalOffset=...
paragraphMatches=true|false
offsetMatches=true|false
connected=true|false
verified=true|false
caretWriteAttempted=true|false
```

本轮必须：

```text
SELECTION-CONTINUITY-VERIFY count > 0
```

否则 runtime path 未激活。

---

# 8. Verify Timing

每次建立/更新 expectation 后：

```text
same synchronous transaction:
create/update expectation

queueMicrotask:
verify

requestAnimationFrame:
verify
```

T4/T5/...T9 observation 只做 verify，不重新发明 expected target。

---

# 9. One-Shot Caret Restore

只有：

```text
expectation.active=true
expected paragraph connected
actualRuntimeId != expectedRuntimeId
或 logicalOffset mismatch
且该 expectation 尚未执行 restore
```

才允许：

```text
restoreLogicalCaret(expectation)
```

每个 `expectationId`：

```text
restore attempt <= 1
```

禁止：

```text
每个 T4/T5/T6/T7 都 restore
无限 setTimeout
每次 refresh setSelection
轮询抢 caret
ArrowDown interception
```

---

# 10. Restore Trace

必须：

```text
CARET-CONTINUITY-RESTORE:
expectationId=...
reason=...
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

Restore 后必须 RAF 再 verify。

失败：

```text
CARET-CONTINUITY-RESTORE-FAILED
ACTION=HARD_STOP
```

---

# 11. CaretExpectation Lifecycle

建议：

```text
CREATE
→ ACTIVE
→ VERIFIED
→ CLOSED
```

或：

```text
CREATE
→ ACTIVE
→ RESTORE_ATTEMPTED
→ VERIFIED
→ CLOSED
```

continuity target 更新：

```text
UPDATE_TARGET
generation++
```

handoff close 不等于 expectation close。

只有 final caret verification 成功后才允许 close expectation。

---

# 12. SelectionTruth HARD FREEZE

禁止修改：

```text
resolveSelectionTruth()
SELECTION-TRUTH source=MUTATION
SELECTION-TRUTH source=OBS
OBS-SELECTION runtimeId
sameAsCommand runtimeId comparison
```

除非新 runtime 明确证明 regression。

---

# 13. Runtime Acceptance C1 — Special Command Caret 10/10

执行 `。。+Enter` 至少 10 次。

每次必须：

```text
POST-TOKEN-SELECTION:
resolvedRuntimeId=<expected>
anchorOffset=0

SELECTION-CONTINUITY-VERIFY:
reason=SPECIAL_COMMAND_CURRENT_PARAGRAPH
expectedRuntimeId=actualRuntimeId
expectedLogicalOffset=0
actualLogicalOffset=0
verified=true
```

必须 10/10。

并且等待至少：

```text
2.2s
```

覆盖 T4-T9，不能只验证 command 后 0ms。

---

# 14. Runtime Acceptance C2 — Delayed Drift Repair

必须至少捕获 3 个 drift case：

```text
早期 actual=expected
后期 actual!=expected
```

如果 drift 发生：

```text
CARET-CONTINUITY-RESTORE attempt=1
→ RESULT SUCCESS
→ next VERIFY actual=expected verified=true
```

至少 3/3。

---

# 15. Runtime Acceptance C3 — No Repeated Restore

必须：

```text
same expectationId
restore attempt count <= 1
```

全日志：

```text
duplicate restore = 0
```

---

# 16. Runtime Acceptance C4 — Split Caret 10/10

至少 10 次 normal Enter：

```text
canonicalOwner != caretDestination
```

必须：

```text
CaretExpectation.reason=SPLIT_NEW_PARAGRAPH
expectedRuntimeId=caretDestinationRuntimeId

SELECTION-CONTINUITY-VERIFY:
actualRuntimeId=caretDestinationRuntimeId
verified=true
```

10/10。

---

# 17. 当前 Merge 状态

源码已有：

```text
resolveMergeContinuity()
```

但最新 runtime 没有真实执行：

```text
MERGE-CONTINUITY-RESOLVE
TRANSFER_SINGLE_OWNER
LIVE_DOM_MERGE_SINGLE_OWNER
BLOCK_MULTI_OWNER
```

因此：

```text
Merge resolver source exists
Merge runtime acceptance = NOT EXECUTED
```

本轮不要继续盲改 resolver。

---

# 18. Merge Forced Acceptance Matrix

必须主动构造：

```text
M0 plain + plain
M1 canonical + plain
M2 plain + canonical
M3 canonical R1 + canonical R2
```

不能等待“碰巧发生”。

---

# 19. M0 — Plain + Plain

```text
P1 plain
P2 plain
→ merge → P3
```

必须：

```text
mutationShape=MERGE_2_TO_1
canonicalRemovedCount=0

MERGE-CONTINUITY-RESOLVE
decision=NO_CANONICAL_OWNER
```

必须：

```text
CREATE_NEW=0
AWAIT_TRANSFER=0
```

至少 3/3。

---

# 20. M1 — Canonical + Plain

准备：

```text
P1 force-indent canonical R1
P2 plain
```

merge：

```text
P1 + P2 → P3
```

必须：

```text
mutationShape=MERGE_2_TO_1
canonicalRemovedCount=1

MERGE-CONTINUITY-RESOLVE
decision=TRANSFER_SINGLE_OWNER

CANONICAL-BINDING-TRANSFER
from=P1
to=P3
reason=LIVE_DOM_MERGE_SINGLE_OWNER

same recordId=R1
generation+1
recordCount unchanged
```

至少 5/5。

---

# 21. M2 — Plain + Canonical

准备：

```text
P1 plain
P2 canonical R1
```

merge：

```text
P1 + P2 → P3
```

必须同样：

```text
TRANSFER_SINGLE_OWNER
R1 → P3
```

禁止假设 canonical owner 一定是 removed[0]。

至少 5/5。

---

# 22. M3 — Canonical + Canonical

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
R1 wins
R2 wins
first wins
last wins
historical fallback
text fallback
ordinal fallback
```

至少 3/3 BLOCK。

---

# 23. Merge Caret Acceptance

M1/M2 成功后：

```text
CaretExpectation.reason=MERGE_DESTINATION
expectedRuntimeId=<merged paragraph>
```

必须：

```text
SELECTION-CONTINUITY-VERIFY
actualRuntimeId=expectedRuntimeId
verified=true
```

---

# 24. Merge Awaiting Gate

M1/M2：

```text
CURRENT_AWAITING_TRANSFER
```

仅允许存在于同一 continuity transaction。

禁止：

```text
awaitingForMs > 2000
```

最终必须：

```text
CURRENT_LIVE
```

---

# 25. Runtime Identity 当前通过部分 HARD FREEZE

继续冻结：

```text
Plugin Artifact Path:
<target vault>\.typora\plugins\dist\main.js

exists=true
Plugin SHA real
Active Doc final=doc.md
initializationCount=1
runtime Build ID correct
```

禁止下一轮再改 path resolver。

---

# 26. RUNTIME-IDENTITY-FINAL 必须补齐字段

当前 final trace 字段还不完整。

必须扩展到：

```text
RUNTIME-IDENTITY-FINAL:
reason=file-open
vaultRoot=...
activeDoc=...
pluginMainPath=...
pluginMainExists=true
pluginMainSha256=...
projectMainSha256=...
shaMatch=true
stylePath=...
styleSha256=...
buildId=...
initializationCount=1
sessionId=...
```

禁止只打印值，不真实读取/hash 文件。

---

# 27. Build ID Five-Way Strict Audit

本轮 Build ID：

```text
inkchapter-r58-6-5-caret-merge-strict-identity-<unique>
```

必须独立核对：

```text
SOURCE_BUILD_ID
DIST_BUILD_ID
DEPLOYED_BUILD_ID
RUNTIME_BUILD_ID
FINAL_REPORT_BUILD_ID
```

五方一致。

Final Report 不得手敲另一个 Build ID。

---

# 28. Strict Startup Verification

每次本轮重启 Typora，必须真实验证：

```text
1. old Typora process exited
2. new PID
3. StartTime
4. MainWindowHandle != 0
5. MainWindowTitle nonempty
6. target vault exact:
   D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
7. target document exact: doc.md
8. real plugin main path
9. plugin main SHA256
10. project dist main SHA256
11. shaMatch=true
12. style.css SHA256
13. Build ID exact
14. initializationCount=1
```

任一缺失：

```text
启动命令已发出，但尚未确认成功
```

---

# 29. Strict Startup 输出格式

必须：

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

否则：

```text
decision=INCOMPLETE|FAIL
```

---

# 30. HARD FREEZE — Mutation Shape

继续：

```text
1→1 REPLACE_1_TO_1
1→2 SPLIT_1_TO_2
2→1 MERGE_2_TO_1
```

禁止按 canonical participant count 改写 shape。

---

# 31. HARD FREEZE — Split

禁止修改 Split resolver 主算法。

只允许：

```text
为 split result 建立/更新 CaretExpectation
```

---

# 32. HARD FREEZE — Promotion

继续：

```text
LiveOwnershipProof before mutation
bindingVerified=false decision=PROMOTE = 0
```

---

# 33. HARD FREEZE — Handoff

继续：

```text
HANDOFF-CLOSE
reason=NO_REPLACEMENT_REQUIRED
```

禁止延长 TTL。

---

# 34. HARD FREEZE — Live Owner Dominance

继续：

```text
MATCH-LIVE-BINDING
HISTORICAL-CANDIDATE-SUPPRESSED-BY-LIVE-OWNER
```

---

# 35. Historical Sidecar 暂不清理

当前 physical sidecar 已累积大量 historical records，并有 multi-owner BLOCK。

本轮继续安全 BLOCK。

禁止：

```text
sidecar GC
compaction
migration
first historical wins
```

留到 editor continuity 全部通过后处理。

---

# 36. SyntaxError 继续隔离

当前启动仍可能有：

```text
SyntaxError: Unexpected token ')'
```

但 InkChapter 后续正常 onload。

本轮：

```text
SyntaxError attribution=UNRESOLVED
```

不要修改 paragraph continuity 来“顺手修复”。

---

# 37. Source Map — Caret 必做

修改前输出：

```text
POST-TOKEN-SELECTION
→ file/function

OBS-SELECTION
→ file/function

current sameAsCommand
→ file/function

handoff creation/update
→ file/function

split continuity result
→ file/function

current caret restore helper
→ file/function

current selection write helper
→ file/function

observation timer T4-T9
→ file/function
```

---

# 38. Source Map — Merge 必做

输出：

```text
resolveMergeContinuity
→ file/function

MERGE classification
→ file/function

single-owner transfer
→ file/function

multi-owner block
→ file/function

AWAIT_TRANSFER point
→ file/function
```

---

# 39. Source Map — Runtime Identity 必做

输出：

```text
runtime banner
→ file/function

RUNTIME-IDENTITY-FINAL
→ file/function

plugin SHA
→ file/function

project SHA
→ file/function

style SHA
→ file/function

Build ID source
→ file/function

restart / verify script
→ file/path
```

---

# 40. Unit Tests — Caret

必须至少：

```text
C-U1 Special expectation creation
command=P1 → expected=P1 offset=0

C-U2 Replacement expectation update
P1→P6 → expected=P6 generation++

C-U3 Split expectation
canonicalOwner=P8 caretDestination=P7 → expected=P7

C-U4 Verify match
expected=P7 actual=P7 → verified=true caretWriteAttempted=false

C-U5 Verify mismatch
expected=P7 actual=P4 → verified=false → one restore

C-U6 Duplicate restore block
same expectation second restore → BLOCK_DUPLICATE_RESTORE
```

---

# 41. Build / Deploy

执行：

```powershell
pnpm exec tsc --noEmit
pnpm test
pnpm run build:dev
powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1
```

记录：

```text
typecheck exit code
test count
build exit code

SOURCE_BUILD_ID
DIST_BUILD_ID
DEPLOYED_BUILD_ID

project main.js SHA256
deployed plugin main.js SHA256
style.css SHA256
shaMatch
```

---

# 42. Restart 必须真实执行

不能只 build/deploy 后就写 runtime acceptance NOT EXECUTED。

必须：

```text
restart Typora
verify startup
open target doc
run GUI/runtime acceptance
```

如果确实无法自动操作 GUI，必须明确报告 `NOT EXECUTED`，不能宣称 FIXED。

---

# 43. GUI Runtime Procedure — Caret

固定 target：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\doc.md
```

至少 10 次：

```text
1. 进入普通正文 paragraph
2. 输入 “。。”
3. Enter
4. 检查该 paragraph force-indent
5. 等待至少 2.2s
6. 验证 caret 仍处于 expected paragraph offset 0
7. 输入正文
8. normal Enter
9. 验证 caret 在 new paragraph
10. ↑ / ↓ 导航
```

必须覆盖：

```text
T4
T5
T6
T7
T8
T9
```

---

# 44. GUI Runtime Procedure — Merge

必须明确执行：

```text
M0 plain+plain x3
M1 canonical+plain x5
M2 plain+canonical x5
M3 canonical+canonical x3
```

收集真实 trace。

---

# 45. Runtime Hard Gates — Caret

必须：

```text
SELECTION-TRUTH > 0
SELECTION-CONTINUITY-VERIFY > 0

SPECIAL command verified=true 10/10
Split verified=true 10/10

CARET-CONTINUITY-RESTORE-FAILED = 0
duplicate restore = 0
```

---

# 46. Runtime Hard Gates — Merge

必须：

```text
MERGE-CONTINUITY-RESOLVE > 0

M0:
NO_CANONICAL_OWNER 3/3

M1:
TRANSFER_SINGLE_OWNER 5/5

M2:
TRANSFER_SINGLE_OWNER 5/5

M3:
BLOCK_MULTI_OWNER 3/3

LIVE_DOM_MERGE_SINGLE_OWNER > 0
single-owner awaitingForMs > 2000 = 0
```

---

# 47. Regression Hard Gates

必须继续：

```text
Mutation Shape downgrade = 0
SPLIT resolver regression = 0
bindingVerified=false decision=PROMOTE = 0
stale handoff transfer = 0
historical blocks exact CURRENT_LIVE owner = 0
Backspace CREATE_NEW = 0
single-dot wrong apply = 0
current-session historical heuristic = 0
general awaiting leak = 0
physical sidecar load/write PASS
```

---

# 48. Strict Identity Hard Gates

必须：

```text
RUNTIME-IDENTITY-FINAL activeDoc=doc.md
pluginMainPath exists=true
pluginMainSha256 real
projectMainSha256 real
shaMatch=true
styleSha256 real
SOURCE=DIST=DEPLOYED=RUNTIME=REPORT Build ID
initializationCount=1
PID verified
StartTime verified
MainWindowHandle != 0
MainWindowTitle nonempty
target vault exact
```

---

# 49. Hard Stop List

任一出现：

```text
resolveSelectionTruth 主体被重写并 regression

SELECTION-TRUTH = 0

SELECTION-CONTINUITY-VERIFY = 0

special command T7/T8/T9:
actual != expected
且没有 one-shot restore

restore attempt > 1 per expectation

restore result FAIL

split caret expectation = canonicalOwner

split actual selection != caretDestination

MERGE acceptance 未执行却报告 PASS

M1/M2 decision=BLOCK

M1/M2 CREATE_NEW

M1/M2 awaitingForMs > 2000

M3 decision=TRANSFER

2→1 被重新分类成 1→1

bindingVerified=false decision=PROMOTE

stale handoff transfer

historical candidate blocks exact CURRENT_LIVE owner

plugin path 回退到 electron.asar

Active Doc final empty/unknown

plugin/project SHA unknown

shaMatch != true

style SHA missing

Build ID 五方不一致

initializationCount != 1

PID/StartTime/HWND/WindowTitle 任一未验证
```

立即：

```text
R58.6.5 NOT FIXED — R60 BLOCKED
```

---

# 50. 禁止的假修复

禁止：

```text
只加 SELECTION-CONTINUITY-VERIFY 日志
但不比较真实 SelectionTruth

直接把 verified=true 写死

检测 drift 后每 100ms 抢 caret

ArrowDown interception

全局 keydown hack

为了通过 test 关闭 OBS timer

只测 T4/T5 不测 T7/T8/T9

Merge resolver 不执行却写 source-ready=PASS

用 synthetic log 冒充真实 merge GUI case

M3 first-owner-wins

改回 1→1 resolver 处理 merge

为 strict startup 硬编码 PID/HWND/title

只打印 shaMatch=true 但不真实 hash 文件

手写 Final Report Build ID 不核对 runtime
```

---

# 51. 推荐修改范围

优先：

```text
src/heading-numbering/heading-numbering-service.ts
src/heading-numbering/paragraph-indent-manager.ts
src/main.ts
src/heading-numbering/paragraph-indent-forensic.ts
scripts/restart-or-verify related script
```

`paragraph-canonical-registry.ts`：

```text
除非 merge forced acceptance 暴露 registry bug
否则不要主动重写。
```

---

# 52. Final Report

必须输出：

```text
## 1. Current Ground Truth
## 2. HARD FREEZE Confirmation
## 3. Source Map — Caret
## 4. Source Map — Merge
## 5. Source Map — Runtime Identity
## 6. Caret Drift Root Cause
## 7. CaretExpectation Design
## 8. Expectation Creation
## 9. Expectation Transfer Update
## 10. Split Expectation
## 11. Merge Expectation
## 12. SELECTION-CONTINUITY-VERIFY
## 13. One-Shot Restore
## 14. Restore Result Verification
## 15. Merge Existing Resolver Audit
## 16. M0 Plain+Plain
## 17. M1 Canonical+Plain
## 18. M2 Plain+Canonical
## 19. M3 Canonical+Canonical
## 20. Merge Awaiting
## 21. Runtime Identity Final Fields
## 22. Build ID Five-Way Audit
## 23. Files Changed
## 24. Build ID
## 25. Typecheck
## 26. Tests
## 27. Build
## 28. Deploy SHA256
## 29. Strict Startup
## 30. C1 Special Caret 10/10
## 31. C2 Delayed Drift Repair
## 32. C3 No Duplicate Restore
## 33. C4 Split Caret 10/10
## 34. M0 3/3
## 35. M1 5/5
## 36. M2 5/5
## 37. M3 3/3
## 38. No Merge Awaiting Leak
## 39. Regression
## 40. Runtime Identity Final
## 41. Strict Startup Fields
## 42. Hard Stop Counts
## 43. Remaining Known Issues
## 44. Final Verdict
```

---

# 53. Final Verdict

最终只能：

```text
R58.6.5 FIXED — R58.6 GUI ACCEPTANCE CONTINUES
```

或者：

```text
R58.6.5 NOT FIXED — R60 BLOCKED
```

注意：

```text
R58.6.5 FIXED
```

仍然不等于：

```text
R60 UNLOCKED
```

任何 mandatory：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

最终必须：

```text
R58.6.5 NOT FIXED — R60 BLOCKED
```

---

# 54. Execution Rules

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
CaretExpectation
expectedRuntimeId
actualRuntimeId
logicalOffset
restore attempt
restore result
merge case
merge owner
merge destination
merge pass count
awaiting duration
Active Doc
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
CaretExpectation
→ SELECTION-CONTINUITY-VERIFY
→ One-Shot Restore
→ Merge Forced Runtime Acceptance
→ Strict Runtime Identity Finalization
```

顺序执行。

不要重新扩大问题范围。
