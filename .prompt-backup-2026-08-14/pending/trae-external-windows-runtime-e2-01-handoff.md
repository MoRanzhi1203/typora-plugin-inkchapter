# Trae — 正常 Windows Runtime 外部执行交接与 E2-01 证据闭环

## 0. 任务定位

当前项目的业务源码与 Node Runtime Gate 已经完成到以下状态：

```text
Build:
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq

Main SHA:
238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B

Style SHA:
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

已确认：

```text
tsc = PASS
vitest = 762/762 PASS
preflight = PASS

Node Runtime Gate:
import.meta.url root resolution = PASS
multi-cwd contract = PASS
NuGet restore dependency = REMOVED
Node direct Roslyn compile = PASS
Win32 helper self-test = PASS
```

当前唯一环境阻塞：

```text
Trae sandbox
禁止 Typora 写：

C:\Users\MSIPC\AppData\Roaming\Typora\lockfile
C:\Users\MSIPC\AppData\Roaming\Typora\typora.log
```

因此：

```text
Strict Startup = NOT PASS
E2-01 = NOT EXECUTED
P0-A/B/C = SOURCE FIXED / RUNTIME PENDING
Caret Geometry = UNKNOWN ON CURRENT BUILD
R58.7 = NOT CLOSED
R60 = NO-GO
```

本轮目标不是继续修改代码，而是建立：

```text
Trae
→ 外部正常 Windows Runtime 执行
→ artifact 回收
→ Trae 只读分析
→ 精确决定下一轮修复
```

---

# 1. HARD FREEZE

本轮禁止修改：

```text
src/**
dist/**
Build ID
Main SHA
style.css
Canonical architecture
NormalEnter
EmptySpecial business implementation
DocumentRuntimeContext
historical resolver
caret geometry
CSS workaround
```

也禁止修改当前已经通过的：

```text
ensureHelperBuilt()
Roslyn direct compile
Win32 helper build path
multi-cwd path contract
```

除非出现新的独立 harness 缺陷证据。

---

# 2. 禁止 PowerShell

全程禁止：

```text
powershell.exe
pwsh
执行 *.ps1
Node child_process 调用 PowerShell
```

外部 Windows Runtime 也必须只使用：

```text
node
dotnet
现有 Node harness
```

---

# 3. Trae 沙箱内只做一次环境判定

如果当前环境仍是 Trae sandbox：

不要继续重试：

```text
strict-startup
strict-startup
strict-startup
```

如果已知沙箱会阻止：

```text
AppData\Roaming\Typora\lockfile
typora.log
```

则直接：

```text
EXTERNAL_RUNTIME_HANDOFF_REQUIRED
```

并停止沙箱内 Runtime 执行。

不得把这些下游失败当作新业务 bug：

```text
noMainWindow
runtimeNotReady
runtimeBuildMismatch
initializationCount!=1
runtimeMainShaMismatch
auditSessionAuthority:none
```

---

# 4. 外部正常 Windows Runtime — 第一步只跑 Strict Startup

让用户在**正常 Windows 终端**、非 Trae sandbox 中执行。

如果当前目录是项目根目录：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

执行：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode strict-startup
```

如果当前目录已经是：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\scripts\r58-matrix
```

执行：

```text
node .\run-empty-special-gate.mjs --mode strict-startup
```

不要同时执行 E2-01。

---

# 5. Strict Startup 必须完整证明

必须全部成立：

```text
oldProcessExited=true
processCountAfterClose=0

newPid != null
newStartTime != null

MainWindowHandle != 0
MainWindowTitle != ""

targetVault =
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault

targetDocument =
r58-empty-special-e2-01.md

runtimeMainPath correct

projectMainSHA =
238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B

runtimeMainSHA =
238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B

shaMatch=true

styleSHA =
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0

runtimeBuildId =
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq

initializationCount=1

runtimeLoadFresh=true
runtime-load mtime >= newStartTime

readinessReady=true
auditDecision=ACCEPT

RUNTIME-IDENTITY-FINAL
belongs to current launch/session
```

若启动命令已经发出但以上证据不完整，必须明确：

```text
启动命令已发出，但尚未确认成功
```

不得宣称：

```text
Strict Startup = PASS
```

---

# 6. Strict Startup Artifact

外部执行后必须保留：

```text
artifacts/empty-special-runtime/strict-startup.json
```

如果失败，还保留：

```text
artifacts/empty-special-runtime/runner-error.json
```

用户将该 artifact / 输出交回 Trae 后，Trae只读分析。

Trae不得凭用户一句“Typora 打开了”替代 artifact。

---

# 7. Strict Startup 分支

## 7.1 PASS

如果：

```text
Strict Startup = PASS
```

才进入 E2-01。

## 7.2 FAIL

如果是项目级真实失败：

```text
保存 evidence
STOP
```

不要执行 E2-01。

## 7.3 ENVIRONMENT-BLOCKED

如果仍是：

```text
TYPORA_SANDBOX_WRITE_DENIED
```

说明仍在受限环境。

继续：

```text
EXTERNAL_RUNTIME_HANDOFF_REQUIRED
STOP
```

禁止 retry-until-pass。

---

# 8. 外部正常 Windows Runtime — 第二步只跑一次 E2-01

只有 Strict Startup PASS 后，用户执行：

项目根目录：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode run --scenario E2 --trial 01
```

或 `scripts\r58-matrix` 目录：

```text
node .\run-empty-special-gate.mjs --mode run --scenario E2 --trial 01
```

只执行：

```text
E2-01
```

一次。

执行结束立即 STOP。

禁止：

```text
E2-02
E2-03
E1
E3
retry-until-pass
```

---

# 9. E2-01 输入前置门

必须证明：

```text
fixtureClean=true
sidecarExists=false
sidecarRecordCount=0

scopeId=r58-empty-special-e2-01.md

target paragraph connected=true
target paragraph empty=true
target is trailing empty paragraph
nextRuntimeId=null
previous paragraph exists

foreground window = target Typora window

byteOffsetStart captured
```

如果不满足：

```text
INVALID / FIXTURE_TOPOLOGY_MISMATCH
SendEnterCallCount=0
```

---

# 10. Token Provenance Gate

只接受：

```text
。。
```

Enter 前必须：

```text
visibleText=="。。"
logicalOffset=2
```

并存在完整 IME provenance：

```text
compositionstart
beforeinput insertCompositionText
input
compositionend
```

如果实际为：

```text
..
```

或其它内容：

```text
INVALID / SPECIAL_TOKEN_PROVENANCE_MISMATCH
SendEnterCallCount=0
```

STOP。

---

# 11. E2-01 正式事务链

必须：

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

Formal count：

```text
PRE = 1
ARM = 1
TOKEN-CONSUMED = 1
EMPTY-SPAN-PREDICATE = 1
DOM-NORMALIZATION = 1
SETTLE = 1
FINAL = 1
TRANSACTION-CLOSE = 1
```

---

# 12. P0-C — Routing Gate

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

如果：

```text
ALLOW_SPECIAL_COMMAND
→ NORMAL_ENTER
```

判：

```text
P0-C = FAIL / RUNTIME
SPECIAL_ROUTE_DIVERGENCE
```

STOP。

不要修改 NormalEnter resolver。

---

# 13. P0-A — Empty Span Gate

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

判：

```text
P0-A = FAIL / RUNTIME
```

STOP。

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

判真实 Runtime FAIL。

STOP。

---

# 15. P0-B — Terminal Cleanup Gate

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
EMPTY-SPECIAL-MUTATION count = 0
```

如果仍有旧 txn mutation：

```text
P0-B = FAIL / RUNTIME
STALE_EMPTY_SPECIAL_OBSERVER
```

STOP。

---

# 16. Caret Geometry — 当前最终未知量

前三关全部通过后才看：

```text
EMPTY-SPECIAL-CARET-GEOMETRY
```

## 16.1 通过

如果：

```text
fontSizePx≈16
expectedIndentPx≈32
actualCaretIndentPx≈32
caretLogicalCorrect=true
caretVisualCorrect=true
overall=true
```

判：

```text
EMPTY VISUAL CARET
= CLOSED / CURRENT BUILD RUNTIME
```

## 16.2 失败

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

判：

```text
EMPTY PARAGRAPH VISUAL CARET PROJECTION BUG
= CONFIRMED / CURRENT BUILD RUNTIME
```

STOP。

不得同一轮加入 CSS workaround。

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

# 18. 外部 E2-01 Artifact 回收

正式 trial 后必须保留：

```text
artifacts/empty-special-runtime/e2-01/
```

至少包括：

```text
strict-startup.json
trial-precondition.json
input-injection-audit.json
trial.delta.jsonl
trial-summary.json
fixture-before.bin
fixture-after.bin
sidecar-before.json
sidecar-after.json
runtime-identity.json
```

用户将这些 artifact 或完整 `trial-summary.json + trial.delta.jsonl` 提供给 Trae 后：

Trae只读分析。

---

# 19. Trae 回收证据后的唯一允许输出

Trae必须给出：

```text
Strict Startup:
PASS / FAIL / INVALID

E2-01:
PASS / FAIL / INVALID / NOT EXECUTED

P0-A:
RUNTIME PASS / FAIL / PENDING

P0-B:
RUNTIME PASS / FAIL / PENDING

P0-C:
RUNTIME PASS / FAIL / PENDING

Caret:
≈32 CLOSED
或
≈0 CONFIRMED BUG
或
UNKNOWN
```

并精确列：

```text
txnId
intentEpoch
routing decision
predicate decision
normalization decision
settle decision
mutation count
terminal cleanup
post-close mutation count
expectedIndentPx
actualCaretIndentPx
FINAL overall
```

禁止只写：

```text
“看起来通过”
“应该已经修好”
```

---

# 20. 下一轮修复分支

## Branch A — E2-01 PASS

若：

```text
E2-01 = PASS / RUNTIME
```

则下一轮才允许进入：

```text
P2/P3 engineering cleanup
```

包括：

```text
dispose async lifecycle cleanup
duplicate lifecycle authority
Typora executable path authority
canonical existingId missing → BLOCK
parser single authority
TRANSACTION-CLOSE naming
minor listener/timer/process.cwd/deprecated cleanup
```

## Branch B — Caret 0px CONFIRMED

若：

```text
P0-A PASS
P0-B PASS
P0-C PASS
nativeEmptyEquivalentAfter=true
actualCaretIndentPx≈0
```

则下一轮只修：

```text
EMPTY-ONLY VISUAL PROJECTION
```

禁止：

```text
\u200B
&nbsp;
fake selection
canonical change
historical resolver
NormalEnter workaround
```

## Branch C — P0-A/B/C 任一 FAIL

只修实际失败层。

禁止把三个 P0 一起重写。

---

# 21. 当前 R58.7 / R60 纪律

在外部 Strict Startup 与 E2-01 完成前：

```text
R58.7 = NOT CLOSED
R60 = NO-GO
```

不得因为：

```text
tsc PASS
762/762 PASS
preflight PASS
harness PASS
```

宣布 R58.7 完成。

---

# 22. 本轮 STOP 规则

当前 Trae 沙箱内：

```text
只准备外部 Runtime handoff
不再修改业务代码
不再重试沙箱 Strict Startup
```

外部 Runtime：

```text
Strict Startup
→ PASS 才跑 E2-01
→ 一次后 STOP
```

artifact 回传后：

```text
Trae 只读分析
→ 给下一轮精确修复方案
→ STOP
```

本轮核心原则：

```text
Runtime evidence first.
No speculative business patch.
No sandbox retry loop.
