# Trae — esc2b7q Source Self-Audit Gate → Empty Special Runtime E1/E2/E3

## 0. 当前基线

当前 Build：

```text
inkchapter-r58-7-p0-empty-special-continuity-esc2b7q
```

当前 Main SHA：

```text
4581D1E835F8F2CC5C9A42CB2A5DD3E5A402886947446A0BB71664A80CC89C89
```

当前 Style SHA：

```text
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

当前已报告：

```text
EMPTY-SPECIAL-E1~E14 helper/unit = 14/14 PASS
Full regression = 722/722 PASS
tsc = PASS
project/runtime main SHA parity = true
project/runtime style SHA parity = true
```

当前仍未成立：

```text
Strict Startup = NOT EXECUTED
Real E1 = NOT EXECUTED
Real E2 = NOT EXECUTED
Real E3 = NOT EXECUTED

Empty Paragraph Special-Command Continuity
= NOT YET
```

本轮先做：

```text
READ-ONLY SOURCE SELF-AUDIT
```

只有审计明确发现缺陷时才允许修改代码。

---

# 1. 审计目标

核对当前 esc2b7q 是否真正满足原 P0 修复方案，而不是只实现了 helper/unit 层。

重点核对 A~G：

```text
A. EMPTY-BLOCK-DOM-SNAPSHOT 是否真的实现
B. settle 是否由 mutation/stable boundary 驱动
C. EmptySlot controlled replacement 是否无 fallback
D. rebindCurrentLiveRecord 是否满足 canonical lease safety
E. intent supersession 是否在 mutation 前阻断 stale txn
F. EMPTY-SPECIAL-* audit 是否全部进入 JSONL
G. E1/E2/E3 tests 是否真正覆盖 service integration
```

---

# 2. A — Native Empty DOM Root-Cause Probe

只读搜索：

```text
EMPTY-BLOCK-DOM-SNAPSHOT
NATIVE_EMPTY
BEFORE_TOKEN_CONSUME
AFTER_TOKEN_CONSUME
AFTER_MICROTASK
AFTER_RAF
```

必须回答：

```text
A1. 是否存在 EMPTY-BLOCK-DOM-SNAPSHOT？
A2. 是否真的采样 NATIVE_EMPTY？
A3. 是否记录 native empty 与 token-consumed empty：
    innerHTML
    childNodes
    BR
    placeholder
    Typora marker
A4. 是否有实际比较逻辑或至少 runtime audit 能比较？
```

如果不存在或只实现部分：

```text
A = FAIL
reason=NATIVE_EMPTY_DOM_PROBE_MISSING
```

不要直接改。

先列出缺失项。

---

# 3. B — Normalization Settle Authority

只读检查：

```text
scheduleEmptySpecialSettle
settleEmptySpecialTransaction
queueMicrotask
requestAnimationFrame
MutationObserver
mutation generation
quiet/stable boundary
timeout
```

必须确定当前实现属于哪一种：

```text
B1:
microtask + one RAF only

B2:
mutation-authoritative settle
+ bounded safety timeout
```

如果只是：

```text
microtask + RAF
```

则：

```text
B = FAIL
reason=TIME_ONLY_SETTLE
```

正确目标：

```text
TOKEN_CONSUMED
↓
open mutation window / generation
↓
observe source-related mutation
↓
wait until structural mutation settles
↓
bounded timeout fallback
↓
resolve final slot
```

禁止简单增加更多固定：

```text
50ms
150ms
300ms
```

---

# 4. C — EmptySlot Controlled Replacement Safety

只读检查：

```text
resolveEmptySlot
CONTROLLED_REPLACEMENT
SAME_NODE
AMBIGUOUS
MISSING
```

必须证明 controlled replacement 只依赖当前 txn 的结构证据：

```text
source runtime
previous runtime
next runtime
source disconnected
candidate inserted/replaced inside same bracket
candidateCount==1
```

明确确认不存在：

```text
previous paragraph fallback
next paragraph fallback
ordinal-only fallback
textHash
anchor heuristic
generic historical resolver
PERSISTED_HISTORICAL resolver
```

如果存在任一 fallback：

```text
C = FAIL
reason=EMPTY_SLOT_FALLBACK_LEAK
```

---

# 5. D — rebindCurrentLiveRecord Canonical Lease Safety

审计：

```text
paragraph-canonical-registry.ts
rebindCurrentLiveRecord
```

必须逐项确认：

```text
D1. recordId unchanged
D2. recordCount unchanged
D3. stateBefore=CURRENT_LIVE
D4. scope/document match
D5. expected generation checked
D6. old runtime belongs to this record
D7. new element/runtime has no conflicting owner
D8. old WeakMap binding invalidated
D9. old runtimeId map invalidated
D10. new element binding installed
D11. new runtimeId binding installed
D12. generation increments exactly once
D13. no CREATE_NEW
D14. no historical resolver
```

如果任何关键 lease 条件未 enforcement：

```text
D = FAIL
reason=CANONICAL_REBIND_LEASE_INCOMPLETE
```

必须指出具体缺失项。

---

# 6. E — Intent Supersession

构造源代码路径：

```text
TOKEN_CONSUMED
↓
settle pending
↓
new trusted user intent
```

必须确认：

```text
currentIntentEpoch > txn.intentEpoch
```

时，在以下任何行为之前：

```text
canonical commit
canonical rebind
semantic write
visual write
selection write
caret restore
```

立即：

```text
BLOCK / SUPERSEDE
```

要求 audit：

```text
EMPTY-SPECIAL-SUPERSESSION-AUDIT
txnId=
oldEpoch=
newEpoch=
newSource=
mutationAttempted=false
canonicalCommitAttempted=false
caretWriteAttempted=false
decision=SUPERSEDE
```

如果当前只在最终阶段检查 epoch，而前面已经发生 mutation：

```text
E = FAIL
reason=SUPERSESSION_CHECK_TOO_LATE
```

---

# 7. F — JSONL Audit Completeness

检查所有：

```text
EMPTY-SPECIAL-PRE
EMPTY-SPECIAL-TOKEN-CONSUMED
EMPTY-SPECIAL-MUTATION
EMPTY-SPECIAL-STRUCTURAL-RESOLUTION
EMPTY-SPECIAL-CANONICAL-COMMIT
EMPTY-SPECIAL-CARET-RESTORE
EMPTY-SPECIAL-CARET-VERIFY
EMPTY-SPECIAL-CARET-GEOMETRY
EMPTY-SPECIAL-VISUAL-VERIFY
EMPTY-SPECIAL-FINAL
EMPTY-SPECIAL-SUPERSESSION-AUDIT
EMPTY-BLOCK-DOM-SNAPSHOT
```

必须确认它们使用：

```text
emitRuntimeAudit(...)
```

进入 file-backed JSONL。

如果只是：

```text
console.log
console.warn
recordRuntimeAudit only in console
```

则：

```text
F = FAIL
reason=JSONL_AUDIT_INCOMPLETE
```

---

# 8. G — Test Coverage Level

检查：

```text
empty-special-command.test.ts
```

明确区分：

```text
PURE HELPER TEST
SERVICE INTEGRATION TEST
REAL DOM/SELECTION TEST
```

必须回答：

```text
G1. E1/E2/E3 是否只调用：
resolveEmptySlot
computeCaretGeometry
evaluateEmptySpecialFinal
isTokenOnlyEmptySpecialCommand

还是实际调用：
commitEnterIndentTransactionSync
→ commitEmptySpecialTransactionSync
→ schedule/settle
→ canonical commit/rebind
→ caret verify
→ final audit
```

如果 E1/E2/E3 只是 pure helper：

```text
G = WARN/FAIL
reason=HELPER_ONLY_NOT_SERVICE_INTEGRATION
```

此时必须新增至少：

```text
EMPTY-SPECIAL-INTEGRATION-E1
EMPTY-SPECIAL-INTEGRATION-E2
EMPTY-SPECIAL-INTEGRATION-E3
```

覆盖真实 service orchestration。

---

# 9. 审计输出格式

先只读，不修改代码。

生成：

```text
SOURCE-SELF-AUDIT.md
```

结构：

```text
A Native Empty DOM Probe
PASS/FAIL
evidence=
missing=

B Normalization Settle
PASS/FAIL
authority=
evidence=
missing=

C EmptySlot Resolver
PASS/FAIL
evidence=

D Canonical Rebind Lease
PASS/FAIL
missingLeaseChecks=

E Intent Supersession
PASS/FAIL
evidence=

F JSONL Audit
PASS/FAIL
missingEvents=

G Test Coverage
PASS/WARN/FAIL
helperTests=
integrationTests=
```

最后：

```text
SOURCE SELF-AUDIT OVERALL
= PASS / FAIL
```

---

# 10. 修改许可

只有：

```text
SOURCE SELF-AUDIT OVERALL = FAIL
```

才允许修改代码。

修改范围必须最小：

```text
src/heading-numbering/empty-special-command.ts
src/heading-numbering/heading-numbering-service.ts
src/heading-numbering/paragraph-canonical-registry.ts
src/heading-numbering/paragraph-indent-manager.ts
src/heading-numbering/paragraph-indent-forensic.ts
tests/**
scripts/r58-matrix/**
```

继续 HARD FREEZE：

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
ordinary non-empty Special Command
generic caret repair
generic selection restore
```

---

# 11. 如果 A 失败：先补 native DOM probe

必须先增加：

```text
EMPTY-BLOCK-DOM-SNAPSHOT
```

不能先改 resolver。

必须能在真实 runtime 采集：

```text
NATIVE_EMPTY
BEFORE_TOKEN_CONSUME
AFTER_TOKEN_CONSUME
AFTER_MICROTASK
AFTER_RAF
```

注意：

```text
Source 层只能 IMPLEMENT probe
不能伪造 native runtime DOM 结论
```

---

# 12. 如果 B 失败：修为 mutation-authoritative settle

目标：

```text
token consumed
↓
begin empty-special mutation generation
↓
MutationObserver captures relevant batch
↓
source/neighbor topology stable
↓
no new relevant mutation within bounded quiet turn
↓
resolve final slot
```

必须有：

```text
EMPTY-SPECIAL-SETTLE-AUDIT
txnId=
mutationGeneration=
relevantMutationCount=
quietBoundaryReached=
timeoutReached=
decision=
```

禁止 retry-until-pass。

---

# 13. 如果 D 失败：强化 rebindCurrentLiveRecord

不得做：

```text
force rebind
blind map overwrite
record owner replacement without generation proof
```

必须通过：

```text
recordId
scope
documentKey
expectedGeneration
expectedOldRuntimeId
newRuntimeId
collision check
```

形成 CAS-like contract。

失败：

```text
BLOCK
```

不能 CREATE_NEW。

---

# 14. 如果 G 失败：补 service integration tests

新增至少三项：

```text
EMPTY-SPECIAL-INTEGRATION-E1
EMPTY-SPECIAL-INTEGRATION-E2
EMPTY-SPECIAL-INTEGRATION-E3
```

需要模拟/驱动：

```text
token-only detection
token consume
DOM replacement/survival
settle
canonical commit/rebind
caret logical verify
final evaluation
```

E3 必须覆盖：

```text
prev empty
source empty
next empty
```

禁止用 ordinal 猜 replacement。

---

# 15. 修复后的 source gates

要求：

```text
Source Self-Audit = PASS

EMPTY-SPECIAL-E1~E14 = PASS

EMPTY-SPECIAL-INTEGRATION-E1~E3 = PASS

Full regression = PASS

tsc --noEmit = PASS
```

然后：

```text
build
deploy
SHA parity
```

产生新 Build 时必须报告新 Build ID 和 SHA。

---

# 16. Runtime 前禁止声明修复完成

Source/unit/build/deploy 后只能：

```text
Empty Special Source Architecture
= VERIFIED / SOURCE + UNIT
```

不得写：

```text
Empty Paragraph Special-Command Continuity
= PASS / RUNTIME
```

---

# 17. Sandbox 行为

如果当前 Trae sandbox 无法真实启动 Typora：

```text
不要尝试伪造 Strict Startup
不要把 sandbox block 当 business FAIL
```

若根本没有执行启动命令：

```text
Strict Startup = NOT EXECUTED
reason=SANDBOX_DESKTOP_LIMITATION
```

不要写：

```text
启动命令已发出，但尚未确认成功
```

除非确实执行了启动命令。

---

# 18. Sandbox 外 Runtime E1/E2/E3

Source Self-Audit PASS 后，给用户明确 PowerShell 指令，在普通 Windows PowerShell 执行：

```text
close Typora
→ processCount=0
→ deploy confirmed Build
→ Strict Startup
→ E1 runtime
→ E2 runtime
→ E3 runtime
```

Strict Startup mandatory：

```text
oldProcessExited=true
processCountAfterClose=0
newPid
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
buildId
runtimeBuildId
initializationCount=1
auditSessionId
```

---

# 19. Runtime E1/E2/E3 Authority

每个 scenario 必须以 JSONL：

```text
EMPTY-SPECIAL-FINAL
```

作为唯一 final authority。

要求：

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

E2 必须真实检查：

```text
EMPTY-SPECIAL-CARET-GEOMETRY
```

不能只看 computedTextIndent。

E1/E2/E3 每项至少：

```text
3/3 PASS
```

任何真实 FAIL：

```text
STOP
```

保存完整 audit/delta/fixture/sidecar，不自动 retry。

---

# 20. 本轮不处理

继续延期：

```text
POST-TEXT observation supersession
PromotionRequest lifecycle
Rehydrate no-op storm
startup SyntaxError
```

除非它们直接阻止 E1/E2/E3 的 source audit 或 runtime。

---

# 21. Git

禁止：

```text
git add
git commit
git push
```

不要自动进入 R60。

最终在：

```text
SOURCE SELF-AUDIT
→ 必要修复
→ source/unit/build/deploy
→ 输出 sandbox 外 runtime 指令
```

后 STOP。
