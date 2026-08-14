# Trae — 当前项目问题收敛与修复门禁（先 P0 Runtime，后 P2/P3）

## 0. 任务目标

当前项目扫描已经完成。不要重新做一轮泛扫描，本轮按已确认优先级收敛问题：

```text
Phase 1
Current Build Runtime Proof

Phase 2
只有 P0 Runtime 关闭后，才允许处理 P2/P3 工程问题
```

项目根目录：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

当前冻结 Build：

```text
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq
```

当前 Main SHA：

```text
238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B
```

当前 Style SHA：

```text
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

当前静态基线：

```text
tsc = PASS
vitest = 762/762 PASS
preflight = PASS
fixture baseline = CLEAN
```

但：

```text
Strict Startup 1jdevq = NOT FORMALLY EXECUTED
Formal E2-01 1jdevq = NOT EXECUTED
```

因此：

```text
R60 EXECUTION STATUS = NO-GO
```

直到 current Build 的 Strict Startup + E2-01 完成。

---

# 1. HARD RULE

本轮禁止：

```text
PowerShell
pwsh
执行 *.ps1
Node child_process 调用 PowerShell

git add
git commit
git push

进入 R60
```

优先使用：

```text
node
npx
vitest
dotnet
现有 Node Runtime Gate
现有 Win32 helper
```

如果 non-PowerShell 能力缺失：

```text
NON_POWERSHELL_RUNTIME_CAPABILITY_GAP
→ STOP
```

不得降低门槛。

---

# 2. 当前问题分层

## P0 / 当前必须先关闭

### P0-VERIFY-1

```text
Current Build Strict Startup formal proof missing
```

### P0-VERIFY-2

```text
Current Build clean E2-01 runtime proof missing
```

### P0-CANDIDATE-1

```text
Empty paragraph visual caret geometry
expected≈32px
actual may remain≈0px
```

注意：

```text
历史 Build 曾 Runtime FAIL
≠
当前 1jdevq native-empty 修复后仍 FAIL
```

必须重新 runtime 证明。

---

# 3. 当前业务源码冻结

在完成 current Build E2-01 之前，不得修改：

```text
src/heading-numbering/empty-special-command.ts
src/heading-numbering/heading-numbering-service.ts
src/heading-numbering/paragraph-canonical-registry.ts
src/runtime/document-runtime-context.ts
```

并冻结：

```text
CanonicalRecordId architecture
CURRENT_LIVE
CURRENT_AWAITING_TRANSFER
CURRENT_RETIRED
PERSISTED_HISTORICAL

NormalEnter
SPLIT_1_TO_2

historical resolver
scope authority
Live Owner Dominance

caret geometry algorithm
CSS visual workaround
generic caret repair/restore
ordinary non-empty Special Command
```

本阶段不要因为怀疑 caret 0px 就先改 CSS。

---

# 4. Phase 1-A：修正 / 校验 Node Runtime Gate

当前 Node authority：

```text
scripts/r58-matrix/run-empty-special-gate.mjs
```

必须确认：

```text
可从项目根目录调用
可从 scripts/r58-matrix 目录调用
不依赖 process.cwd()
```

ROOT 应基于：

```text
import.meta.url
```

解析。

不得出现：

```text
scripts/r58-matrix/scripts/r58-matrix
```

重复路径。

如果当前 harness 仍硬编码项目路径或 Typora 路径，本阶段只允许修 harness 路径解析，不改业务 src。

推荐：

```js
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPT_DIR, '..', '..')
```

Typora 路径优先：

```text
CLI arg
→ env
→ repo-local config
→ known default
```

任何 resolved path 必须打印：

```text
resolvedScriptDir
resolvedRepoRoot
resolvedTyporaExe
resolvedFixture
resolvedAuditDir
```

---

# 5. Phase 1-B：Node Preflight

从项目根目录执行：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode preflight
```

如果当前 cwd 已在 `scripts/r58-matrix`：

```text
node .\run-empty-special-gate.mjs --mode preflight
```

Preflight 必须验证：

```text
expectedBuildId =
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq

expectedMainSHA =
238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B

expectedStyleSHA =
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0

project main exists
runtime main exists
main shaMatch=true
style shaMatch=true

fixture =
r58-empty-special-e2-01.md

fixture bytes =
E6 96 87 E6 9C AC 0A 0A

no BOM

sidecarExists=false
sidecarRecordCount=0

parser/harness ready
audit dir accessible
```

如果 Preflight FAIL：

```text
STOP
```

只修 harness/preflight 层问题，不改业务 source。

---

# 6. Phase 1-C：Formal Strict Startup

执行：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode strict-startup
```

Strict Startup 必须真实验证：

```text
old Typora process exited
processCountAfterClose=0

newPid
newStartTime

MainWindowHandle != 0
MainWindowTitle != ""

target vault =
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault

target document =
r58-empty-special-e2-01.md

runtimeMainPath
runtimeMainSHA
projectMainSHA
shaMatch=true

styleSHA

runtimeBuildId =
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq

initializationCount=1

runtime-load mtime >= new process StartTime

readinessReady=true
auditDecision=ACCEPT

current RUNTIME-IDENTITY-FINAL
belongs to current launch/session
```

如果只是启动命令执行成功，不得宣布 PASS。

缺任一关键字段：

```text
Strict Startup != PASS
```

---

# 7. Phase 1-D：只执行 clean E2-01

Strict Startup PASS 后执行：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode run --scenario E2 --trial 01
```

只执行一次，然后 STOP。

禁止自动继续：

```text
E2-02
E2-03
E1
E3
```

禁止 retry-until-pass。

---

# 8. E2-01 Trial Precondition

正式发送输入前必须验证：

```text
fixture clean=true
sidecarExists=false
sidecarRecordCount=0

scopeId correct
target paragraph connected=true
target paragraph empty=true
target is trailing empty paragraph
nextRuntimeId=null
previous paragraph exists

byteOffsetStart captured
```

如果 topology 不满足：

```text
INVALID / FIXTURE_TOPOLOGY_MISMATCH
SendEnterCallCount=0
```

---

# 9. Token Provenance Gate

Formal E2 只允许：

```text
。。
```

不是：

```text
..
```

Enter 前必须证明：

```text
visibleText=="。。"
logicalOffset=2
```

以及真实 IME provenance：

```text
compositionstart
beforeinput insertCompositionText
input
compositionend
```

如果失败：

```text
INVALID / SPECIAL_TOKEN_PROVENANCE_MISMATCH
SendEnterCallCount=0
```

---

# 10. E2-01 事件链必须唯一

byte-window 内必须只有一个 EmptySpecial txn：

```text
SPECIAL-COMMAND-ROUTING-AUDIT
EMPTY-SPECIAL-PRE
EMPTY-SPECIAL-MUTATION-WINDOW-ARM
EMPTY-SPECIAL-TOKEN-CONSUMED
EMPTY-SPECIAL-EMPTY-SPAN-PREDICATE
EMPTY-SPECIAL-DOM-NORMALIZATION
EMPTY-SPECIAL-SETTLE-AUDIT
EMPTY-SPECIAL-STRUCTURAL-RESOLUTION
EMPTY-SPECIAL-CANONICAL-COMMIT
EMPTY-SPECIAL-CARET-VERIFY
EMPTY-SPECIAL-CARET-GEOMETRY
EMPTY-SPECIAL-VISUAL-VERIFY
EMPTY-SPECIAL-FINAL
EMPTY-SPECIAL-TRANSACTION-CLOSE
```

全部 same txnId。

要求：

```text
PRE exactly 1
ARM exactly 1
TOKEN-CONSUMED exactly 1
DOM-NORMALIZATION exactly 1
SETTLE exactly 1
FINAL exactly 1
TRANSACTION-CLOSE exactly 1
```

---

# 11. P0-A Runtime Gate：Exact Empty Span

必须：

```text
EMPTY-SPECIAL-EMPTY-SPAN-PREDICATE

matchesExpectedMdPlainShape=true
hasNonEmptyTextNode=false
safeEmptyTextShape=true
decision=SAFE_EMPTY
```

随后：

```text
EMPTY-SPECIAL-DOM-NORMALIZATION

decision=NORMALIZED_TO_NATIVE_EMPTY
nativeEmptyEquivalentAfter=true
markdownContentChanged=false
overall=true
```

如果：

```text
BLOCK_UNSAFE_STRUCTURE
```

则：

```text
P0-A = FAIL / RUNTIME
```

立即 STOP。

---

# 12. P0-B Runtime Gate：Terminal Cleanup

必须：

```text
EMPTY-SPECIAL-TRANSACTION-CLOSE

observerDisconnected=true
timeoutCleared=true
activeTxnCleared=true
terminal=true
```

并验证 close 后：

```text
same txnId
EMPTY-SPECIAL-MUTATION count=0
```

如果仍有 mutation：

```text
P0-B = FAIL / RUNTIME
STALE_EMPTY_SPECIAL_OBSERVER
```

STOP。

---

# 13. P0-C Runtime Gate：Routing

必须：

```text
ENTER-ADMISSION-AUDIT
decision=ALLOW_SPECIAL_COMMAND
```

然后：

```text
SPECIAL-COMMAND-ROUTING-AUDIT
selectedPath=EMPTY_SPECIAL
```

禁止：

```text
ALLOW_SPECIAL_COMMAND
→ NORMAL_ENTER
```

如果发生：

```text
P0-C = FAIL / RUNTIME
SPECIAL_ROUTE_DIVERGENCE
```

STOP。

不要修改 NormalEnter resolver。

---

# 14. Mutation Settle Gate

必须：

```text
observerRootConnectedAtArm=true
observerRootContainsSourceAtArm=true
sourceConnectedAtArm=true
observerRootIsCurrentEditorRoot=true

observerArmedAt < tokenConsumedAt

relevantMutationCount>=1
quietBoundaryReached=true

decision=SETTLED_BY_MUTATION_QUIET
```

如果：

```text
relevantMutationCount=0
```

判：

```text
INVALID / EMPTY_SPECIAL_MUTATION_NOT_OBSERVED
```

如果：

```text
TIMEOUT_BLOCK
```

判真实业务 FAIL。

STOP。

---

# 15. 当前真正未知：Caret Geometry

只有前面全部 PASS 后才判断：

```text
EMPTY-SPECIAL-CARET-GEOMETRY
```

目标：

```text
fontSizePx≈16
expectedIndentPx≈32
actualCaretIndentPx≈32

caretVisualCorrect=true
overall=true
```

如果：

```text
nativeEmptyEquivalentAfter=true
actualCaretIndentPx≈32
caretVisualCorrect=true
```

则：

```text
Empty visual caret problem
= CLOSED / CURRENT BUILD RUNTIME
```

不要加入 CSS workaround。

如果：

```text
nativeEmptyEquivalentAfter=true
semanticCorrect=true
computedTextIndent≈32px
caretLogicalCorrect=true
expectedIndentPx≈32
actualCaretIndentPx≈0
caretVisualCorrect=false
```

则：

```text
EMPTY PARAGRAPH VISUAL CARET PROJECTION BUG
= CONFIRMED / RUNTIME
```

立即 STOP。

本轮不得自动修改 CSS，先保存 runtime evidence。

---

# 16. E2-01 PASS Gate

只有全部满足：

```text
routingCorrect=true

safeEmptyPredicate=true
nativeEmptyEquivalentAfter=true

mutationAuthoritative=true

logicalSlotPreserved=true
paragraphCountPreserved=true
canonicalOwnerCorrect=true

semanticCorrect=true
visualIndentCorrect=true

caretLogicalCorrect=true
caretVisualCorrect=true

unexpectedMerge=false
unexpectedDelete=false

transactionClose=true
postCloseSameTxnMutationCount=0

EMPTY-SPECIAL-FINAL overall=true
```

才允许：

```text
E2-01 = PASS / RUNTIME
```

然后立即 STOP。

---

# 17. Phase 2：仅当 P0 全部关闭后才处理 P2/P3

进入条件：

```text
Strict Startup = PASS
E2-01 = PASS / RUNTIME
```

否则：

```text
Phase 2 = FORBIDDEN
```

---

# 18. P2-1：dispose() Async Lifecycle Leak

已确认 source 问题：

```text
dispose()
未统一清：
active EmptySpecial settle observer
active EmptySpecial RAF
sidecarWriteTimer
```

修复目标：

```text
dispose()
↓
close active EmptySpecial txn if any
↓
disconnect observer
↓
cancel RAF
↓
clear settle state
↓
clear sidecarWriteTimer
↓
then dispose remaining services
```

增加：

```text
dispose mid-transaction
→ observer disconnected
→ RAF cancelled
→ no post-dispose callback
```

测试。

---

# 19. P2-2：Duplicate Lifecycle

目标事件：

```text
EDITOR-RUNTIME-BOUND
DOCUMENT-CONTEXT-READY
SIDECAR-ACTUAL-LOAD
```

调查同一：

```text
editorInstanceId
scopeId
documentKey
```

是否重复。

修复应按 owner 去重，但不得改变业务幂等语义。

如果存在合法重复，必须显式区分：

```text
INITIAL
REFRESH
REOPEN
```

---

# 20. P2-3：Node Harness Hardcoded Paths

ROOT 必须基于：

```text
import.meta.url
```

Typora 路径：

```text
CLI arg
→ environment
→ config/default discovery
```

测试：

```text
from repo root
from scripts/r58-matrix
from unrelated cwd
```

三种 cwd 均解析到同一 repo root。

---

# 21. P3-1：Canonical UPDATE→CREATE Defensive Invariant

先写测试证明：

```text
existingCanonicalRecordId exists
但 inMemoryOverrides 不存在
```

当前实际行为。

如果确实 fallback CREATE，则改成：

```text
BLOCK / invariant violation
```

禁止创造第二个 CanonicalRecordId。

不要未测试就改。

---

# 22. P3-2：Parser Single Authority

当前：

```text
run-empty-special-gate.mjs embedded parser
+
empty-special-trial-parser.js
```

收敛成：

```text
one parser module
```

供：

```text
CLI harness
contract tests
report writer
```

共同使用。

不得复制 verdict logic。

---

# 23. P3-3：Observability Naming

将：

```text
EMPTY-SPECIAL-TRANSACTION-CLOSE overall=true
```

与业务 `FINAL overall` 区分。

推荐：

```text
cleanupComplete
businessOverall
```

---

# 24. P3-4：Minor Cleanup

检查：

```text
startupErrorHandler timeout
forensic sink beforeunload listener
process.cwd() vault fallback
deprecated methods
placeholder values
```

逐项低风险清理。

---

# 25. Phase 2 Regression Gate

如果 Phase 2 修改 `src/**`：

```text
必须生成新 Build ID
必须生成新 Main SHA
```

执行：

```text
npx tsc --noEmit
npx vitest run
build
deploy
project/runtime SHA parity
Strict Startup
clean E2-01
```

如果只改 harness/scripts：

```text
不得生成业务 Build
```

---

# 26. 最终报告

输出：

```text
docs/audits/inkchapter-current-issue-resolution-2026-08-13.md
```

以及：

```text
artifacts/project-audit/inkchapter-current-issue-resolution-2026-08-13.json
```

报告至少包含：

```text
A. Current Build
B. Strict Startup Result
C. E2-01 Result
D. P0-A/P0-B/P0-C Runtime Status
E. Caret Geometry Status
F. P2/P3 Fix Status
G. Regression Results
H. Remaining Issues
I. R60 Verdict
```

---

# 27. R60 Verdict

当前初始状态：

```text
R60 = NO-GO
```

只有：

```text
Strict Startup PASS
+
E2-01 PASS / RUNTIME
```

之后才能重新评估。

如果：

```text
nativeEmptyEquivalentAfter=true
但 caretVisualCorrect=false
```

则：

```text
R60 = NO-GO
```

必须先单独解决 Empty Visual Caret。

---

# 28. STOP 纪律

Phase 1：

```text
Preflight
→ Strict Startup
→ exactly one E2-01
→ STOP
```

任何 FAIL / INVALID：

```text
保存 evidence
→ STOP
```

禁止 retry-until-pass。

Phase 2：

```text
只有 P0 runtime 全关闭后才能开始
```

禁止在同一轮把 P0 runtime fail 自动改成源码修复。

本轮原则：

```text
先证明
再修复
一层一层关闭问题
```
