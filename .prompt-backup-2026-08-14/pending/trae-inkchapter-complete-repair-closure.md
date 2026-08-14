# Trae — InkChapter 当前问题完整修复与 Runtime 闭环总指令

## 0. 任务目标

当前项目已经完成全仓扫描、Node Runtime Gate 路径修复、NuGet 依赖移除和 Roslyn Win32 helper 自检。

本指令不是重新扫描项目，而是按依赖关系把当前剩余问题完整关闭：

```text
Phase 1
真实 Strict Startup
→ 单次 clean E2-01
→ 判定 P0-A / P0-B / P0-C / Caret Geometry

Phase 2A
若 E2-01 暴露业务 P0
→ 只修对应 P0
→ 新 Build
→ Strict Startup
→ 单次 clean E2-01
→ STOP

Phase 2B
若 E2-01 PASS
→ 处理已确认 P2/P3 工程问题
→ 新 Build（仅当 src/** 修改）
→ 回归
→ Strict Startup
→ clean E2-01

Phase 3
R58.7 reduced closure matrix
→ 7/7 PASS
→ 才允许评估 R60
```

---

# 1. 项目与冻结基线

项目根目录：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

当前冻结业务 Build：

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

当前已知静态基线：

```text
tsc = PASS
vitest = 762/762 PASS
preflight = PASS
fixture baseline = CLEAN
```

当前 Node Runtime Gate：

```text
scripts/r58-matrix/run-empty-special-gate.mjs
```

已完成：

```text
import.meta.url repo root resolution
multi-cwd contract PASS
NuGet restore dependency REMOVED
Node direct Roslyn compile PASS
Win32 helper enumerate self-test PASS
```

当前真正剩余的第一阻塞：

```text
Trae sandbox 不允许 Typora 写：
C:\Users\MSIPC\AppData\Roaming\Typora\lockfile
C:\Users\MSIPC\AppData\Roaming\Typora\typora.log
```

因此当前：

```text
Strict Startup = NOT PASS
E2-01 = NOT EXECUTED
R60 = NO-GO
```

---

# 2. HARD RULES

## 2.1 禁止 PowerShell

禁止：

```text
powershell.exe
pwsh
执行任何 *.ps1
Node child_process 间接调用 PowerShell
```

现有 `.ps1` 仅可只读参考。

## 2.2 禁止 retry-until-pass

任何：

```text
FAIL
INVALID
ENVIRONMENT-BLOCKED
```

都必须：

```text
保存 evidence
→ STOP
```

不得自动重试直到通过。

## 2.3 禁止无证据宣布修复

证据优先级：

```text
Runtime evidence
> actual executed command
> source implementation
> unit/integration tests
> Trae summary
> inference
```

禁止：

```text
source patched → Runtime FIXED
tests PASS → user-visible FIXED
build PASS → Typora startup PASS
```

## 2.4 Git 冻结

禁止：

```text
git add
git commit
git push
```

直到用户明确允许。

---

# 3. Strict Startup 强制验证规则

如果执行了 Typora 启动/重启命令，但下列任一项缺失，必须原样写：

```text
启动命令已发出，但尚未确认成功
```

Formal Strict Startup 必须全部证明：

```text
1. old Typora process exited
2. processCountAfterClose=0
3. new PID
4. new StartTime
5. MainWindowHandle != 0
6. MainWindowTitle != ""
7. exact target vault
8. target document
9. runtime plugin main path
10. runtime plugin main SHA256
11. project/dist main SHA256
12. shaMatch=true
13. style.css SHA256
14. runtime Build ID
15. RUNTIME-IDENTITY-FINAL Build ID
16. initializationCount=1
17. runtime-load freshness >= new process StartTime
18. readinessReady=true
19. auditDecision=ACCEPT
20. current audit session belongs to current launch
```

不能用：

```text
StartProcess success
process exists
window appeared briefly
runtime-load file exists
```

替代以上完整验证。

---

# 4. Phase 1 — 当前 Build 的真实 Runtime Proof

## 4.1 不再修改 helper build 逻辑

当前 Node direct Roslyn 路径已证明：

```text
SDK discovery PASS
csc.dll discovery PASS
Microsoft.NETCore.App.Ref discovery PASS
reference enumeration PASS
helper compile PASS
runtimeconfig PASS
helper enumerate self-test PASS
```

除非出现新的独立 harness bug，否则：

```text
FREEZE ensureHelperBuilt()
FREEZE Roslyn compile path
```

不要再改。

---

# 5. Phase 1-A — Preflight

在正常 Windows 用户环境执行：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode preflight
```

若当前 cwd 在：

```text
scripts\r58-matrix
```

可执行：

```text
node .\run-empty-special-gate.mjs --mode preflight
```

必须验证：

```text
resolvedRepoRoot correct
resolvedTyporaExe exists
resolvedFixture correct
resolvedAuditDir correct

expectedBuildId =
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq

projectMainSHA =
238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B

runtimeMainSHA =
238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B

shaMatch=true

styleSHA =
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0

fixture =
r58-empty-special-e2-01.md

fixture bytes =
E6 96 87 E6 9C AC 0A 0A

no BOM
sidecarExists=false
sidecarRecordCount=0
fixtureClean=true
```

若 FAIL：

```text
STOP
```

只允许修 harness/preflight 层问题。

---

# 6. Phase 1-B — Formal Strict Startup

执行：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode strict-startup
```

目标文档必须是：

```text
r58-empty-special-e2-01.md
```

若 Trae sandbox 仍阻止 Typora AppData 写入：

```text
ENVIRONMENT-BLOCKED / TYPO﻿RA_SANDBOX_WRITE_DENIED
```

保存：

```text
artifacts/empty-special-runtime/strict-startup.json
artifacts/empty-special-runtime/runner-error.json
```

然后 STOP。

不要把以下派生失败当成新项目 bug：

```text
noMainWindow
runtimeNotReady
runtimeBuildMismatch
initializationCount!=1
runtimeMainShaMismatch
auditSessionAuthority:none
```

如果上游原因是：

```text
Typora 无法正常启动
```

这些全部只是 downstream result。

---

# 7. Phase 1-C — 只执行一次 clean E2-01

只有：

```text
Strict Startup = PASS
```

才执行：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode run --scenario E2 --trial 01
```

只执行一次。

然后：

```text
STOP
```

禁止同一轮继续：

```text
E2-02
E2-03
E1
E3
```

---

# 8. E2-01 Trial Precondition

发送任何业务输入前必须证明：

```text
fixtureClean=true
sidecarExists=false
sidecarRecordCount=0

scopeId=r58-empty-special-e2-01.md
targetConnected=true

target paragraph empty=true
target is trailing empty paragraph
nextRuntimeId=null
previous paragraph exists

byteOffsetStart captured
foreground window = target Typora window
```

若不满足：

```text
INVALID / FIXTURE_TOPOLOGY_MISMATCH
SendInputCallCount=0
```

STOP。

---

# 9. Formal Token Provenance

只接受：

```text
。。
```

禁止：

```text
..
```

Enter 前必须 runtime 证明：

```text
visibleText=="。。"
logicalOffset=2
```

并要求 IME provenance：

```text
compositionstart
beforeinput insertCompositionText
input
compositionend
```

如果不满足：

```text
INVALID / SPECIAL_TOKEN_PROVENANCE_MISMATCH
SendEnterCallCount=0
```

STOP。

---

# 10. E2-01 唯一事务链

byte-window 内必须只有一个 EmptySpecial transaction：

```text
SPECIAL-COMMAND-ROUTING-AUDIT
↓
EMPTY-SPECIAL-PRE
↓
EMPTY-SPECIAL-MUTATION-WINDOW-ARM
↓
EMPTY-SPECIAL-TOKEN-CONSUMED
↓
EMPTY-SPECIAL-EMPTY-SPAN-PREDICATE
↓
EMPTY-SPECIAL-DOM-NORMALIZATION
↓
EMPTY-SPECIAL-MUTATION
↓
EMPTY-SPECIAL-SETTLE-AUDIT
↓
EMPTY-SPECIAL-STRUCTURAL-RESOLUTION
↓
EMPTY-SPECIAL-CANONICAL-COMMIT
↓
EMPTY-SPECIAL-CARET-VERIFY
↓
EMPTY-SPECIAL-CARET-GEOMETRY
↓
EMPTY-SPECIAL-VISUAL-VERIFY
↓
EMPTY-SPECIAL-FINAL
↓
EMPTY-SPECIAL-TRANSACTION-CLOSE
```

全部：

```text
same txnId
```

Formal counts：

```text
PRE exactly 1
ARM exactly 1
TOKEN-CONSUMED exactly 1
EMPTY-SPAN-PREDICATE exactly 1
DOM-NORMALIZATION exactly 1
SETTLE exactly 1
FINAL exactly 1
TRANSACTION-CLOSE exactly 1
```

---

# 11. P0-A — Exact Empty Span Runtime Gate

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

如果再次：

```text
BLOCK_UNSAFE_STRUCTURE
```

正式判：

```text
P0-A
= FAIL / RUNTIME
```

STOP。

下一轮只修 predicate/normalization，不碰其它架构。

---

# 12. P0-B — Terminal Cleanup Runtime Gate

必须：

```text
EMPTY-SPECIAL-TRANSACTION-CLOSE

observerDisconnected=true
timeoutCleared=true
activeTxnCleared=true
terminal=true
```

并验证：

```text
TRANSACTION-CLOSE 后
same txnId
EMPTY-SPECIAL-MUTATION count=0
```

如果仍出现：

```text
EMPTY-SPECIAL-MUTATION
same closed txnId
```

正式判：

```text
P0-B
= FAIL / RUNTIME
STALE_EMPTY_SPECIAL_OBSERVER
```

STOP。

---

# 13. P0-C — Routing Runtime Gate

必须：

```text
ENTER-ADMISSION-AUDIT
decision=ALLOW_SPECIAL_COMMAND
```

紧接：

```text
SPECIAL-COMMAND-ROUTING-AUDIT
selectedPath=EMPTY_SPECIAL
```

禁止：

```text
ALLOW_SPECIAL_COMMAND
→ NORMAL_ENTER
```

若发生：

```text
P0-C
= FAIL / RUNTIME
SPECIAL_ROUTE_DIVERGENCE
```

STOP。

不得修改 NormalEnter resolver。

---

# 14. Mutation-authoritative Settle

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

若：

```text
relevantMutationCount=0
```

判：

```text
INVALID / EMPTY_SPECIAL_MUTATION_NOT_OBSERVED
```

若：

```text
TIMEOUT_BLOCK
```

判：

```text
REAL BUSINESS FAIL
```

STOP。

---

# 15. 当前真正未知 — Empty Visual Caret

只有前面全部 PASS 后才允许判断：

```text
EMPTY-SPECIAL-CARET-GEOMETRY
```

预期：

```text
fontSizePx≈16
expectedIndentPx≈32
actualCaretIndentPx≈32
caretVisualCorrect=true
overall=true
```

## 15.1 如果 actual≈32px

判：

```text
Empty Visual Caret
= CLOSED / CURRENT BUILD RUNTIME
```

禁止增加 CSS workaround。

## 15.2 如果 actual≈0px

若同时：

```text
nativeEmptyEquivalentAfter=true
semanticCorrect=true
computedTextIndent≈32px
caretLogicalCorrect=true

expectedIndentPx≈32
actualCaretIndentPx≈0
caretVisualCorrect=false
```

正式判：

```text
EMPTY PARAGRAPH VISUAL CARET PROJECTION BUG
= CONFIRMED / CURRENT BUILD RUNTIME
```

STOP。

不得同一轮自动修 CSS。

---

# 16. 如果 Caret 0px 被确认 — 下一轮唯一允许的修复

只有 Runtime 已确认 15.2 才进入本节。

目标不是改 canonical、selection 或插入不可见字符，而是设计：

```text
EMPTY-ONLY VISUAL PROJECTION
```

约束：

```text
只作用于：
empty paragraph
+
force-indent semantic mode
+
current EmptySpecial owner

不得修改 Markdown
不得插入 \u200B
不得插入 &nbsp;
不得写假文本
不得 fake selection
不得改变 canonical identity
不得调用 historical resolver
不得改变 NormalEnter
```

优先探索：

```text
empty-only padding-inline-start: 2em
+
text-indent: 0
```

仅作为视觉 projection。

第一枚真实字符输入后必须立即恢复：

```text
padding-inline-start: 0
text-indent: 2em
```

必须增加状态/audit：

```text
EMPTY-SPECIAL-VISUAL-PROJECTION-APPLY
EMPTY-SPECIAL-VISUAL-PROJECTION-REMOVE
EMPTY-SPECIAL-VISUAL-PROJECTION-VERIFY
```

Runtime 必须证明：

```text
empty:
actualCaretIndentPx≈32

first real char:
projectionRemoved=true
textIndent≈32
paddingInlineStart≈0

non-empty ordinary paragraph:
unaffected=true
```

任何 `src/**` 修改都必须：

```text
new Build ID
new Main SHA
tsc
full vitest
build
deploy
SHA parity
Strict Startup
single clean E2-01
```

---

# 17. E2-01 PASS Gate

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

然后 STOP。

---

# 18. Phase 2 — 只有 E2-01 PASS 后才处理工程问题

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

# 19. P2-1 — dispose() Async Lifecycle Leak

已确认 source 问题：

```text
dispose()
未统一清理：

active EmptySpecial settle observer
active EmptySpecial RAF
sidecarWriteTimer
```

修复目标：

```text
dispose()
↓
if active EmptySpecial txn:
    closeEmptySpecialTransaction()
↓
disconnect observer
cancel owned RAF
clear settle timer/state
↓
clear sidecarWriteTimer
↓
dispose remaining resources
```

必须保证：

```text
old txn cleanup
不得清除 newer txn
```

测试：

```text
DISPOSE-EMPTY-1
dispose during armed EmptySpecial
→ observer disconnected

DISPOSE-EMPTY-2
dispose with pending RAF
→ RAF cancelled

DISPOSE-EMPTY-3
dispose with sidecarWriteTimer
→ timer cleared

DISPOSE-EMPTY-4
post-dispose callback
→ DROP / no DOM/canonical mutation
```

---

# 20. P2-2 — Duplicate Lifecycle Authority

检查并收敛：

```text
EDITOR-RUNTIME-BOUND
DOCUMENT-CONTEXT-READY
SIDECAR-ACTUAL-LOAD
```

按：

```text
editorInstanceId
scopeId
documentKey
lifecycle generation
```

去重。

禁止简单吞合法事件。

若存在合法第二次事件，应明确：

```text
INITIAL
REFRESH
REOPEN
```

目标：

```text
同一 authoritative document-open lifecycle
不产生重复业务 load
```

并确保 sidecar load 不重复构建 persisted historical records。

---

# 21. P2-3 — Harness Portability

已经修复 `ROOT`，继续完成 Typora 路径 authority：

```text
--typora-exe
→ INKCHAPTER_TYPORA_EXE
→ known install discovery
→ explicit INVALID
```

不要默默依赖：

```text
D:\Typora\Typora.exe
```

增加：

```text
HARNESS-PATH-ROOT
HARNESS-PATH-SCRIPT-DIR
HARNESS-PATH-UNRELATED-CWD
```

三种 cwd contract。

---

# 22. P3-1 — Canonical UPDATE→CREATE Defensive Invariant

先测试：

```text
existingCanonicalRecordId exists
but
inMemoryOverrides missing that ID
```

当前行为。

如果实际 fallback CREATE：

```text
禁止 CREATE
```

改为：

```text
BLOCK_CANONICAL_INVARIANT_VIOLATION
```

因为：

```text
existing business identity
≠
permission to create new business identity
```

增加 audit：

```text
EMPTY-SPECIAL-CANONICAL-INVARIANT
existingCanonicalRecordId
recordPresent
decision
```

不得破坏当前 canonical architecture。

---

# 23. P3-2 — Parser Single Authority

当前：

```text
run-empty-special-gate.mjs embedded parser
+
empty-special-trial-parser.js
```

最终收敛为：

```text
scripts/r58-matrix/empty-special-verdict-parser.mjs
```

唯一 authority。

由：

```text
CLI harness
parser contract
report writer
```

共同 import。

禁止复制 verdict 逻辑。

必须保留：

```text
EMPTY-SPAN-PREDICATE gate
timeoutCleared gate
post-close mutation=0
routing gate
geometry gate
FINAL gate
```

---

# 24. P3-3 — Observability Naming

当前：

```text
EMPTY-SPECIAL-TRANSACTION-CLOSE overall=true
```

表示：

```text
cleanup succeeded
```

不是：

```text
business success
```

改成：

```text
cleanupComplete=true
```

必要时加：

```text
businessFinalOverall
```

避免 parser/人工误读。

---

# 25. P3-4 — Minor Lifecycle Cleanup

依次检查：

```text
startupErrorHandler 10s timeout
forensic sink beforeunload listener
process.cwd() vault fallback
deprecated sweep
placeholder runtimeId
```

原则：

```text
低风险
小 patch
独立测试
不得改变业务语义
```

---

# 26. Phase 2 业务源码修改后的 Build 规则

只要修改任何：

```text
src/**
```

必须生成全新 Build ID。

禁止复用：

```text
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq
```

新 Build 必须：

```text
npx tsc --noEmit
npx vitest run
build
deploy
project/runtime SHA parity
```

报告：

```text
Build ID
projectMainSHA
runtimeMainSHA
shaMatch
styleSHA
```

之后必须重新：

```text
Preflight
Strict Startup
single clean E2-01
```

---

# 27. Phase 3 — Reduced Matrix Closure

只有：

```text
最新 Build
Strict Startup PASS
clean E2-01 PASS
```

之后才进入 reduced closure。

正式矩阵：

```text
A1 clean independent repeat ×3
A2 noncanonical ×1
A3 split-no-text ×1
B1 historical ×2
```

Fixture：

```text
A1-01 → r58-caret-a1-fresh-01.md
A1-02 → r58-caret-a1-fresh-02.md
A1-03 → r58-caret-a1-fresh-03.md

A2-01 → r58-caret-a1-fresh-04.md
A3-01 → r58-caret-a1-fresh-05.md

B1-01 → r58-b1-historical-01.md
B1-02 → r58-b1-historical-02.md
```

禁止用 spare fixture 隐藏真实 FAIL。

---

# 28. A1 Gate

动作：

```text
。。
Enter
Enter
立即输入 。
wait >=2.5s
```

PASS：

```text
post-input commit offset 1 through +2200 stable
visual/canonical/final audits true
restore writes=0
repair writes=0
selection writes=0
awaiting=0
mismatch=0
```

3 个独立 fixture 全部 PASS。

---

# 29. A2 Gate

普通非 canonical paragraph：

```text
Enter
立即输入 。
```

要求：

```text
noncanonical path correct
no accidental canonical append
caret stable
no stale restore
```

---

# 30. A3 Gate

动作：

```text
。。
Enter
Enter
不输入文本
wait >=2.5s
```

要求：

```text
canonical owner != caret destination
transfer=true
no POST-TEXT requirement
awaiting=0
mismatch=0
```

---

# 31. B1 Historical Gate

使用专用 historical fixture。

必须：

```text
seed legitimate sidecar
close
physical reopen
```

要求：

```text
PERSISTED_HISTORICAL only from physical load
historical resolver only on historical state
CURRENT_LIVE no historical heuristic
CURRENT_AWAITING_TRANSFER zero historical candidates
CURRENT_RETIRED zero candidates
no resolver leakage
```

两次独立 PASS。

---

# 32. Reduced Matrix Final Verdict

只有：

```text
A1 3/3 PASS
A2 1/1 PASS
A3 1/1 PASS
B1 2/2 PASS
```

才允许：

```text
Reduced Matrix = 7/7 PASS
R58.7 PRACTICAL CLOSURE = PASS
Extended Stress Matrix = WAIVED / NOT EXECUTED
R60 MAY PROCEED UNDER REDUCED-MATRIX WAIVER
```

禁止写：

```text
Full Exhaustive Closure
A1×10
```

---

# 33. R60 Go / No-Go

当前：

```text
R60 = NO-GO
```

允许转为：

```text
R60 MAY PROCEED UNDER REDUCED-MATRIX WAIVER
```

必须同时：

```text
latest Build identity verified
Strict Startup PASS
clean E2-01 PASS
P0-A closed
P0-B closed
P0-C closed
caret geometry closed
Reduced Matrix 7/7 PASS
no canonical mismatch
no awaiting leak
```

---

# 34. 输出报告

每一阶段保存独立 evidence。

最终生成：

```text
docs/audits/inkchapter-complete-repair-closure-2026-08-13.md
```

以及：

```text
artifacts/project-audit/inkchapter-complete-repair-closure-2026-08-13.json
```

报告结构：

```text
A. Build Identity
B. Harness Status
C. Strict Startup
D. E2-01 Runtime Result
E. P0-A / P0-B / P0-C
F. Caret Geometry
G. Phase 2 Fixes
H. Regression
I. Reduced Matrix
J. Remaining Known Issues
K. R58.7 Verdict
L. R60 Verdict
```

---

# 35. 绝对禁止的修法

禁止：

```text
previous paragraph fallback
next paragraph fallback
ordinal +/-1 heuristic
generic historical resolver for current session
setTimeout + unconditional setSelection
invisible chars in Markdown
\u200B
&nbsp;
retry-until-pass
CSS workaround before caret runtime proof
fake CURRENT_LIVE after failed transfer
CREATE new canonical ID to hide missing old record
```

---

# 36. 最终执行纪律

每个 runtime gate：

```text
PASS
→ 才进入下一层
```

任何：

```text
FAIL
INVALID
ENVIRONMENT-BLOCKED
```

都：

```text
保存证据
→ STOP
```

不得把“完整修复”理解成一次性无条件修改所有层。

正确含义是：

```text
先证明
→ 精确修当前失败层
→ 新 Build
→ 回归
→ Runtime 再证明
→ 再进入下一层
```

直到：

```text
Strict Startup PASS
E2-01 PASS
P0 closed
P2/P3 closed
Reduced Matrix 7/7 PASS
```

才算当前 R58.7 修复闭环完成。
