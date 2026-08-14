# Trae — EmptySpecial Runtime Harness：独立 Clean Trial + Topology Precondition + Byte-Window JSONL Gate

## 0. 当前冻结基线

当前 Build：

```text
inkchapter-r58-7-p0-empty-special-native-dom-es2b7q
```

当前 Main SHA：

```text
C5ACDD8F1D7AEF025E1978843CEEDC69C52023329EE1AE8547266DD0B64247C1
```

当前 Style SHA：

```text
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

当前状态：

```text
Native Empty DOM normalization
= IMPLEMENTED / SOURCE + UNIT

Mutation Observer arm-before-consume
= IMPLEMENTED / SOURCE + UNIT

TIMEOUT_BLOCK
= IMPLEMENTED / SOURCE + UNIT

UTF-8 JSONL reader
= IMPLEMENTED / POWERSHELL TEST PASS

Strict Startup readiness fix
= IMPLEMENTED / NOT YET RUNTIME VERIFIED

Real E2/E1/E3
= NOT EXECUTED
```

本轮目标：

```text
只补 EmptySpecial Runtime Harness
并执行正式 E2 → E1 → E3 runtime gate
```

---

# 1. HARD FREEZE

禁止修改：

```text
src/**
Build ID
CanonicalRecordId architecture
CURRENT_LIVE / AWAITING_TRANSFER / RETIRED / PERSISTED_HISTORICAL
NormalEnter SPLIT_1_TO_2
generic historical resolver
DocumentRuntimeContext
scope authority
Live Owner Dominance
ordinary non-empty Special Command
generic caret repair / restore
```

Runtime gate 前只允许修改：

```text
scripts/r58-matrix/**
test/vault/r58-empty-special-*.md
harness/parser/report
```

除非真实 runtime FAIL 明确证明当前 Build 本身存在业务缺陷。

---

# 2. Formal Trial 必须使用 9 个独立 fixture

建立：

```text
r58-empty-special-e1-01.md
r58-empty-special-e1-02.md
r58-empty-special-e1-03.md

r58-empty-special-e2-01.md
r58-empty-special-e2-02.md
r58-empty-special-e2-03.md

r58-empty-special-e3-01.md
r58-empty-special-e3-02.md
r58-empty-special-e3-03.md
```

每个 trial 独立 document identity。

禁止同一 fixture 连续做 3 次，因为第一次成功后可能已创建 canonical/sidecar。

---

# 3. 每 trial clean precondition

开始前必须验证：

```text
fixture exists=true
sidecarExists=false
sidecarRecordCount=0
no prior current-session canonical record
processCountAfterClose=0
```

若失败：

```text
INVALID / FIXTURE_NOT_CLEAN
```

允许 fixture-manager 只重置当前 trial fixture 及其 sidecar。

禁止删除历史 audit 证据。

---

# 4. Fixture 必须预构造目标结构

Formal trial 不要：

```text
打开文件
→ 输入“文本”
→ 连续 Enter 现场造空行
→ 再开始测试
```

fixture 必须预先具有目标 Markdown 拓扑。

Runtime trial 只做：

```text
定位目标 empty paragraph
→ 输入“。。”
→ Enter
```

---

# 5. Runtime Topology Precondition

新增 harness audit：

```text
EMPTY-SPECIAL-FIXTURE-PRECONDITION
```

至少记录：

```text
scenario
trialId
documentKey
paragraphCount
targetOrdinal
targetRuntimeId
previousRuntimeId
nextRuntimeId
previousVisibleText
targetVisibleText
nextVisibleText
previousEmpty
targetEmpty
nextEmpty
targetConnected
sidecarExists
sidecarRecordCount
overall
invalidReason
```

Markdown 空行不能直接当作 runtime 多个独立 empty paragraph 的证明。

---

# 6. E1 Topology

E1：

```text
文本
空 A
空 B
空 C ← target
EOF
```

必须证明：

```text
targetEmpty=true
target 为 trailing empty paragraph
previousEmpty=true
trailing empty run length >= 3
nextRuntimeId=null
```

否则：

```text
INVALID / FIXTURE_TOPOLOGY_MISMATCH
```

---

# 7. E2 Topology

E2：

```text
文本
空 C ← target
EOF
```

必须：

```text
targetEmpty=true
target 为 trailing empty paragraph
nextRuntimeId=null
```

否则 INVALID。

---

# 8. E3 Topology

E3：

```text
文本 A
空 B
空 C ← target
空 D
文本 E
```

必须真实证明：

```text
previousEmpty=true
targetEmpty=true
nextEmpty=true
target 有 previous/next logical neighbors
following non-empty paragraph exists
```

如果 Typora runtime 没形成三个独立 empty paragraph：

```text
INVALID / FIXTURE_TOPOLOGY_MISMATCH
```

禁止 ordinal 猜 target。

---

# 9. Formal JSONL 必须 byte-offset window

禁止：

```text
whole session
→ Select-Object -Last 1
```

正式流程：

```text
resolve current audit session
→ capture byteOffsetBeforeTrial
→ perform trial input
→ wait final authority
→ flush/stable
→ capture byteOffsetAfterTrial
→ read exact delta
→ UTF-8 decode
→ parse only current trial
```

复用现有：

```text
forensic-file-collector.ps1
byte-offset collector
Read-R58Utf8Lines
```

禁止 truncate audit。

---

# 10. Trial baseline

每 trial 记录：

```text
trialId
scenario
fixture
auditPath
auditSessionId
byteOffsetStart
runtimeBuildId
runtimeMainSHA
scopeId
persistenceKey
documentKey
targetRuntimeId
targetOrdinal
userIntentEpochBefore
canonicalRecordCountBefore
sidecarRecordCountBefore
```

---

# 11. 输入前 foreground gate

如果 Runner 使用 SendInput：

必须先：

```text
target PID verified=true
target HWND verified=true
foreground target HWND verified=true
```

否则：

```text
INVALID / FOREGROUND_WINDOW_MISMATCH
SendInputCallCount=0
```

禁止 foreground mismatch 时继续发送。

---

# 12. 每 trial 唯一 txnId

delta 必须：

```text
EMPTY-SPECIAL-PRE exactly 1
EMPTY-SPECIAL-FINAL exactly 1
PRE.txnId == FINAL.txnId
```

以下全部必须属于同一 txnId：

```text
EMPTY-SPECIAL-DOM-NORMALIZATION
EMPTY-SPECIAL-SETTLE-AUDIT
EMPTY-SPECIAL-STRUCTURAL-RESOLUTION
EMPTY-SPECIAL-CANONICAL-COMMIT/REBIND
EMPTY-SPECIAL-CARET-VERIFY
EMPTY-SPECIAL-CARET-GEOMETRY
EMPTY-SPECIAL-VISUAL-VERIFY
EMPTY-SPECIAL-FINAL
```

否则：

```text
INVALID / TRIAL_TRANSACTION_AMBIGUOUS
```

---

# 13. Token-only formal settle 必须 mutation-authoritative

E1/E2/E3 formal PASS 不接受：

```text
SETTLED_NO_RELEVANT_MUTATION
```

正常 PASS 必须：

```text
observerArmedBeforeTokenConsume=true
observerRootConnected=true
observerRootContainsSource=true
sourceConnectedAtArm=true
relevantMutationCount>=1
quietBoundaryReached=true
decision=SETTLED_BY_MUTATION_QUIET
```

若：

```text
relevantMutationCount=0
```

判：

```text
INVALID / EMPTY_SPECIAL_MUTATION_NOT_OBSERVED
```

不能算 PASS。

如果当前 Build 缺 `observerRootContainsSource` 等关键 runtime 字段，不得猜，报告：

```text
RUNTIME_OBSERVABILITY_GAP
```

并 STOP；在此之前不要改 src。

---

# 14. Native DOM Normalization Gate

每 trial 必须有：

```text
EMPTY-SPECIAL-DOM-NORMALIZATION
```

要求：

```text
decision=NORMALIZED_TO_NATIVE_EMPTY
或 ALREADY_NATIVE_EMPTY

nativeEmptyEquivalentAfter=true
overall=true
markdownContentChanged=false
```

若：

```text
BLOCK_UNSAFE_STRUCTURE
```

则真实 BLOCK/FAIL，STOP。

---

# 15. 顺序：E2 First

严格：

```text
E2-01
E2-02
E2-03
→ 全 PASS
E1-01
E1-02
E1-03
→ 全 PASS
E3-01
E3-02
E3-03
```

E2 first 用来验证 native empty normalization 是否真正解决 0px visual caret。

---

# 16. E2 PASS Gate

每 trial：

```text
DOM normalization:
nativeEmptyEquivalentAfter=true

SETTLE:
observerArmedBeforeTokenConsume=true
relevantMutationCount>=1
quietBoundaryReached=true
decision=SETTLED_BY_MUTATION_QUIET

GEOMETRY:
expectedIndentPx≈32
actualCaretIndentPx≈32
overall=true

FINAL:
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

若 native normalization 后：

```text
caretVisualCorrect=false
```

立即 STOP，保存证据。

不要自动进入 CSS workaround。

---

# 17. E1 PASS Gate

每 trial：

```text
DOM normalization PASS
mutation settle PASS
logicalSlotPreserved=true
paragraphCountPreserved=true
canonicalOwnerCorrect=true
caretLogicalCorrect=true
unexpectedMerge=false
unexpectedDelete=false
EMPTY-SPECIAL-FINAL overall=true
```

随后同一 trial 允许再执行一次普通 Enter，只验证：

```text
original target remains force-indent
canonical owner remains original target
new next paragraph created
caret moves only to new next paragraph
```

单独标识：

```text
E1_POST_NORMAL_ENTER
```

不要与 EmptySpecial transaction 混淆。

---

# 18. E3 PASS Gate

每 trial：

```text
B/C/D logical empty slots preserved
paragraphCountPreserved=true
C still between B and D
following non-empty E 不前移
canonicalOwnerCorrect=true
caretLogicalCorrect=true
unexpectedMerge=false
unexpectedDelete=false
EMPTY-SPECIAL-FINAL overall=true
```

如果 source physical replacement：

```text
decision=CONTROLLED_REPLACEMENT
candidateCount=1
```

若 candidateCount != 1：

```text
AMBIGUOUS / BLOCK
```

禁止 fallback。

---

# 19. 每 trial 独立 artifacts

建议：

```text
artifacts/empty-special-runtime/
  e2-01/
  e2-02/
  e2-03/
  e1-01/
  ...
  e3-03/
```

每个至少：

```text
trial-summary.json
trial.delta.jsonl
trial-precondition.json
strict-startup/session-identity evidence
fixture snapshot
sidecar state before
sidecar state after
Build/SHA evidence
input-injection-audit.json
```

---

# 20. Verdict 只允许三类

```text
PASS
FAIL
INVALID
```

PASS：
业务断言全部满足。

FAIL：
真实 EmptySpecial business assertion failure。

INVALID：
fixture topology mismatch
foreground mismatch
audit/session ambiguity
UTF-8 parse failure
mutation not observed
transaction ambiguous
environment issue

INVALID 不计入 3/3。

---

# 21. 禁止 retry-until-pass

任何真实：

```text
FAIL
```

立即 STOP。

保存现场。

不得换备用 fixture 隐藏失败。

只有明确 INVALID 且原因与 business 无关，才允许修 harness 后从新的 clean trial 重新开始。

---

# 22. Strict Startup 必须先验证 readiness fix

matrix 前单独跑：

```text
StrictStartup
```

必须：

```text
oldProcessExited=true
processCountAfterClose=0
newPid
new StartTime
MainWindowHandle!=0
MainWindowTitle!=""

runtimeBuildId=
inkchapter-r58-7-p0-empty-special-native-dom-es2b7q

runtimeMainSHA=
C5ACDD8F1D7AEF025E1978843CEEDC69C52023329EE1AE8547266DD0B64247C1

initializationCount=1
readinessReady=true
auditDecision=ACCEPT
new auditSessionId

runtime-load LastWriteTime >= process StartTime
RUNTIME-IDENTITY-FINAL belongs to current session
```

如果仍读到旧 Build：

```text
FAIL / READINESS_RACE_NOT_FIXED
```

STOP。

---

# 23. UTF-8 Gate

正式 trial 前跑现有 UTF-8 reader smoke。

确保：

```text
U+3002 “。”
```

完整。

任何 JSONL parse failure：

```text
INVALID / JSONL_UTF8_PARSE_FAILURE
```

---

# 24. E2 Persistence Sanity

E2 3/3 PASS 后，再做一个独立 sanity，不计入 3/3：

```text
fresh E2 sanity fixture

。。
Enter
→ EmptySpecial PASS
→ 直接输入 A
→ save
→ close
→ physical reopen
```

验证：

```text
A 未丢失
无 \u200B
无 phantom Markdown content
无额外 empty paragraph
force-indent persistence 符合预期
```

如条件允许，再做一次基本 Undo sanity。

失败则 STOP，不进入 E1/E3。

---

# 25. Formal Closure

只有：

```text
Strict Startup = PASS

E2 = 3/3 PASS
E2 persistence sanity = PASS

E1 = 3/3 PASS

E3 = 3/3 PASS
```

才允许：

```text
Empty Paragraph Visual Caret
= PASS / RUNTIME

Empty Paragraph Special-Command Continuity
= PASS / RUNTIME
```

否则保持 NOT YET。

---

# 26. 暂不处理

继续延期：

```text
POST-TEXT observation supersession
Promotion lifecycle
Rehydrate no-op storm
startup SyntaxError
doc.md historical sidecar cleanup
```

除非它们直接阻止本 harness。

---

# 27. Git

禁止：

```text
git add
git commit
git push
```

不要进入 R60。

本轮：

```text
补 Runtime Harness
→ Strict Startup verification
→ E2 3/3
→ E2 persistence sanity
→ E1 3/3
→ E3 3/3
→ final summary
→ STOP
```
