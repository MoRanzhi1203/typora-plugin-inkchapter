# TRAE P0 — R58.7 Phase A.1.1 Editor Runtime Authority + Context Refresh Ordering

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Editor Runtime Scope Activation**
>
> Current authoritative status:
>
> ```text
> R58.7 PHASE A.1 NOT FIXED
> R60 BLOCKED
> ```
>
> 当前问题已经进一步收敛：
>
> ```text
> EPHEMERAL 三态模型本身不是主要问题；
> 真正失败的是 Editor Runtime Authority 与 Document Context 刷新时序。
> ```
>
> 最新 runtime 已明确出现：
>
> ```text
> SelectionTruth:
> insideEditor=true
> runtimeId=P-RUNTIME-*
> ```
>
> MutationObserver 也真实运行并检测到：
>
> ```text
> SPLIT_1_TO_2
> removed=[P-RUNTIME-*]
> added=[P-RUNTIME-*,P-RUNTIME-*]
> ```
>
> 但 DocumentRuntimeContext 从头到尾仍然：
>
> ```text
> mode=NO_EDITOR
> scopeId=null
> businessReady=false
> businessReason=NO_EDITOR
> ```
>
> 并导致：
>
> ```text
> DOCUMENT-BUSINESS-GATE:
> caller=special-command
> mode=NO_EDITOR
> businessReady=false
> decision=NO_OP
> ```
>
> 因此当前 `Untitled` 中 `。。+Enter` 无效的直接根因是：
>
> ```text
> editorRoot 实际已经存在
> ≠
> DocumentRuntimeContext 知道 editorRoot 已存在
> ```
>
> 本轮只解决这个“Editor Runtime 真值不同步”问题。

---

# 0. 本轮唯一目标

必须做到：

```text
Typora Untitled editor 已真实存在
↓
Editor Runtime Authority 绑定 editorRoot
↓
Document Context 立即刷新
↓
NO_EDITOR → EPHEMERAL
↓
businessReady=true
↓
special-command ALLOW
↓
。。+Enter 正常执行
```

本轮禁止扩大范围。

---

# 1. 当前 Runtime 证据

当前实际行为：

```text
DOCUMENT-CONTEXT-STATE:
mode=NO_EDITOR
scopeId=null
activeFilePath=
persistenceKey=null
businessReady=false
persistenceReady=false
businessReason=NO_EDITOR
```

但之后：

```text
SELECTION-TRUTH:
insideEditor=true
runtimeId=P-RUNTIME-1
```

以及：

```text
EDITOR-MUTATION-BATCH
selectionRuntimeId=P-RUNTIME-1
```

甚至：

```text
mutationShape=SPLIT_1_TO_2
```

说明：

```text
editorRoot definitely exists
```

但 context 仍是：

```text
NO_EDITOR
```

这是逻辑矛盾。

---

# 2. 当前 Source Root Cause 假设

当前很可能是：

```text
constructor
↓
refreshDocumentContext()
↓
adapter.getEditorRoot() == null
↓
mode=NO_EDITOR
```

之后：

```text
markdown-editor load
↓
adapter.setEditorRoot(editorEl)
↓
connectObserver(editorEl)
↓
bindEditorRoot()
```

但没有：

```text
refreshDocumentContext(editorEl)
```

因此 context 永远缓存启动时的：

```text
NO_EDITOR
```

本轮必须先验证这个 Source Map，再修改。

---

# 3. 禁止继续修改三态模型

以下模型 HARD FREEZE：

```text
NO_EDITOR
EPHEMERAL
PERSISTED
```

以及：

```text
businessReady
persistenceReady
scopeId
persistenceKey
```

本轮不要增加：

```text
第四种状态
新 ticket
新 timeout
新 lifecycle enum
```

---

# 4. 建立唯一 Editor Runtime Authority

新增或正式收敛：

```ts
interface EditorRuntime {
  root: HTMLElement;

  editorInstanceId: string;

  boundAt: number;
}
```

Service 维护唯一：

```ts
private currentEditorRuntime: EditorRuntime | null = null;
```

---

# 5. 唯一 Root Source

禁止多个模块分别通过不同方式找 editor root。

以下模块：

```text
DocumentRuntimeContext
SelectionTruth
MutationObserver
UserIntent
Special Command
Backspace
Split
Merge
Caret
```

必须共享同一个：

```text
currentEditorRuntime.root
```

或同一个 adapter authoritative getter。

---

# 6. `setEditorRoot()` 后立即绑定 Runtime Authority

在真实 editor load：

```ts
this.adapter.setEditorRoot(editorEl);
```

之后立即：

```ts
this.bindEditorRuntime(editorEl);
```

禁止先：

```text
connectObserver
bindEditorRoot
business events
```

再 refresh context。

---

# 7. 正确顺序

必须：

```text
markdown-editor load
↓
adapter.setEditorRoot(editorEl)
↓
bindEditorRuntime(editorEl)
↓
assign stable editorInstanceId
↓
refreshDocumentContext(reason=EDITOR_ROOT_BOUND)
↓
NO_EDITOR → EPHEMERAL/PERSISTED
↓
bindEditorRoot
↓
connectObserver
↓
business events allowed
```

---

# 8. 禁止错误顺序

禁止：

```text
refresh context
↓
NO_EDITOR
↓
setEditorRoot
↓
bind business
↓
不再 refresh
```

---

# 9. Editor Instance ID

必须为每个真实 editorRoot 分配稳定 ID。

推荐：

```ts
private editorInstanceIds = new WeakMap<HTMLElement, string>();
```

函数：

```ts
private getOrCreateEditorInstanceId(root: HTMLElement): string
```

要求：

```text
同一 root
→ 同一 editorInstanceId
```

---

# 10. EDITOR-RUNTIME-BOUND Trace

每次真实绑定：

```text
EDITOR-RUNTIME-BOUND:
editorInstanceId=editor-1
rootConnected=true
rootTag=DIV
timestamp=...
decision=BOUND
```

---

# 11. Editor Runtime Unbound

当 editor 真正被关闭/销毁：

```text
EDITOR-RUNTIME-UNBOUND:
editorInstanceId=editor-1
decision=UNBOUND
```

然后才允许：

```text
mode=NO_EDITOR
```

---

# 12. Untitled Context Refresh

当：

```text
editorRoot exists
activeFilePath=null
```

必须：

```text
DOCUMENT-CONTEXT-TRANSITION:
from=NO_EDITOR
to=EPHEMERAL
reason=EDITOR_ROOT_BOUND
```

---

# 13. EPHEMERAL State

必须：

```text
mode=EPHEMERAL

scopeId=untitled:<sessionId>:<editorInstanceId>

businessReady=true

persistenceReady=false

activeFilePath=null

persistenceKey=null
```

---

# 14. Document Context Refresh 不得偷偷自己猜 Root

优先改成显式输入：

```ts
refreshDocumentContext({
  reason,
  editorRuntime,
  activeFilePath
})
```

而不是函数内部再：

```text
query DOM
get maybe stale cached adapter
```

---

# 15. Context Resolver 输入必须是同一时刻 Snapshot

例如：

```ts
interface DocumentContextInput {
  editorRoot: HTMLElement | null;

  editorInstanceId: string | null;

  vaultRoot: string | null;

  activeFilePath: string | null;

  sessionId: string;

  reason: string;
}
```

一次 resolve 使用一份 immutable input。

---

# 16. Context Refresh Trace

必须：

```text
DOCUMENT-CONTEXT-REFRESH:
reason=EDITOR_ROOT_BOUND
editorRootExists=true
editorInstanceId=editor-1
activeFilePath=null
previousMode=NO_EDITOR
nextMode=EPHEMERAL
```

---

# 17. Gate 不得直接相信 stale context

新增：

```ts
ensureBusinessContextCurrent(caller)
```

逻辑：

```text
if current context businessReady=true
→ continue

if current context businessReady=false
→ inspect authoritative editor runtime

if editor runtime exists
→ refresh context once

→ evaluate businessReady again
```

---

# 18. 这不是 Special Command Bypass

禁止：

```text
if caller == special-command
then allow
```

正确：

```text
business gate sees stale NO_EDITOR
↓
authoritative editor runtime exists
↓
refresh shared context
↓
EPHEMERAL
↓
normal gate ALLOW
```

所有 business caller 共用。

---

# 19. Business Gate Source

以下统一：

```text
special-command

mutation-observer

backspace

promotion

split

merge
```

调用：

```ts
ensureBusinessContextCurrent(caller)
```

---

# 20. Persistence Gate 不需要自愈成 EPHEMERAL 可写

EPHEMERAL 继续：

```text
persistenceReady=false
```

即使 editorRoot 已存在。

所以：

```text
sidecar write
sidecar load
rehydrate
```

仍然 SKIP。

---

# 21. `getDocumentKey()` 不能参与判断 Editor Exists

当前：

```text
getDocumentKey()==null
```

只能说明：

```text
没有持久化 key
```

不能说明：

```text
没有 editor
```

本轮必须删除所有：

```text
documentKey null → NO_EDITOR
```

这样的隐式语义。

---

# 22. `activeFilePath` 不能参与判断 Editor Exists

同理：

```text
activeFilePath=null
```

在 Untitled 是合法。

不能：

```text
activeFilePath=null → NO_EDITOR
```

必须：

```text
editorRoot missing → NO_EDITOR

editorRoot exists + activeFilePath null → EPHEMERAL
```

---

# 23. SelectionTruth 与 Context 的一致性 Invariant

新增 runtime invariant：

```text
if
SELECTION-TRUTH insideEditor=true

then
DocumentContext mode != NO_EDITOR
```

否则：

```text
EDITOR-CONTEXT-DIVERGENCE
decision=HARD_STOP
```

---

# 24. Mutation 与 Context 的一致性 Invariant

如果：

```text
EDITOR-MUTATION-BATCH selectionRuntimeId=P-RUNTIME-*
```

同时：

```text
mode=NO_EDITOR
```

则：

```text
EDITOR-CONTEXT-DIVERGENCE
source=MUTATION
decision=HARD_STOP
```

---

# 25. Divergence Trace

必须：

```text
EDITOR-CONTEXT-DIVERGENCE:
source=SELECTION|MUTATION|USER_INTENT
editorRuntimeExists=true
documentMode=NO_EDITOR
businessReady=false
decision=HARD_STOP
```

---

# 26. 目标是 Divergence = 0

修复后全日志：

```text
EDITOR-CONTEXT-DIVERGENCE=0
```

---

# 27. Untitled 最小验收顺序

不要一上来跑 10/10。

先 Gate 0：

```text
启动 Typora
停在 Untitled
什么都不输入
```

必须先看到：

```text
EDITOR-RUNTIME-BOUND
```

紧接着：

```text
DOCUMENT-CONTEXT-TRANSITION
NO_EDITOR → EPHEMERAL
```

再：

```text
DOCUMENT-CONTEXT-STATE
mode=EPHEMERAL
businessReady=true
```

---

# 28. Gate 0 没通过立即停止

如果启动后只看到：

```text
mode=NO_EDITOR
```

没有：

```text
EDITOR-RUNTIME-BOUND
```

或者没有：

```text
NO_EDITOR → EPHEMERAL
```

立即：

```text
R58.7 PHASE A.1.1 NOT FIXED — R60 BLOCKED
```

不要继续测试 special command。

---

# 29. Gate 1 — 单次 Special Command

Gate 0 PASS 后：

```text
输入：。。
按 Enter
```

必须：

```text
DOCUMENT-BUSINESS-GATE:
caller=special-command
mode=EPHEMERAL
businessReady=true
decision=ALLOW
```

然后：

```text
special command transaction starts
token removed
semantic force-indent
caret continuity
```

---

# 30. Gate 1 禁止出现

```text
caller=special-command
mode=NO_EDITOR
decision=NO_OP
```

必须：

```text
count=0
```

---

# 31. Gate 2 — Mutation

special command 后 normal Enter：

必须：

```text
DOCUMENT-BUSINESS-GATE:
caller=mutation-observer
mode=EPHEMERAL
decision=ALLOW
```

---

# 32. Gate 3 — Persistence Isolation

同一 Untitled session：

```text
DOCUMENT-PERSISTENCE-GATE:
mode=EPHEMERAL
decision=SKIP_EPHEMERAL
```

且：

```text
SIDECAR-ACTUAL-WRITE=0
SIDECAR-ACTUAL-LOAD=0
```

---

# 33. Gate 4 — Repeated Special

只有 Gate 0-3 PASS 后，
再跑：

```text
。。+Enter
```

10 次。

必须：

```text
10/10
```

---

# 34. Gate 5 — Save As 暂缓到 A.1.1 通过后

本轮主要验证：

```text
NO_EDITOR → EPHEMERAL
```

如果这一点还没过，
不要浪费时间测 Save As。

---

# 35. Build ID 必须更新

当前上一版代码变化后仍复用了：

```text
inkchapter-r58-7-architecture-stabilization-phA-k3v8j
```

这是不可接受的。

本轮 Build ID：

```text
inkchapter-r58-7-phA1-1-editor-runtime-authority-<unique>
```

---

# 36. Build ID Hard Rule

任何代码变化后：

```text
Build ID 必须变化
```

禁止：

```text
same Business Build
different main.js SHA
```

---

# 37. Runtime Build Audit

必须记录：

```text
SOURCE_BUILD_ID

DIST_BUILD_ID

DEPLOYED_BUILD_ID

RUNTIME_BUILD_ID

REPORT_BUILD_ID
```

全部一致。

---

# 38. SHA HARD FREEZE

当前已经正确：

```text
pluginMainSha256
=
projectMainSha256

shaMatch=true

styleSha256 real
```

本轮不要改路径 resolver。

---

# 39. HARD FREEZE

禁止修改：

```text
NO_EDITOR / EPHEMERAL / PERSISTED model

businessReady / persistenceReady semantics

scopeId / persistenceKey separation

resolveSelectionTruth

Mutation Shape Authority

Split resolver

Merge batch-first

Proof-Before-Mutation

Live Owner Dominance

UserIntent dedup

Caret verification

Sidecar empty-key guard

Runtime identity project/plugin/style paths
```

---

# 40. 禁止进入后续架构 Phase

本轮禁止：

```text
ContinuityEngine migration

Registry Commit Firewall

CaretPlan rewrite

Session Overlay full migration

Sidecar snapshot redesign

Native Typora identity adoption
```

只修：

```text
Editor Runtime Authority
+
Context Refresh Ordering
```

---

# 41. Source Map — Editor Runtime

修改前必须输出：

```text
markdown-editor load
→ file/function

adapter.setEditorRoot
→ file/function

adapter.getEditorRoot
→ file/function

bindEditorRoot
→ file/function

connectObserver
→ file/function

refreshDocumentContext
→ file/function

current editorInstanceId
→ file/function

current NO_EDITOR transition
→ file/function
```

---

# 42. Source Map — Gate

必须输出：

```text
special-command business gate

mutation-observer business gate

backspace business gate

rehydrate persistence gate

sidecar write persistence gate
```

---

# 43. 必须回答的根因问题

在修改前明确回答：

```text
为什么 SelectionTruth / MutationObserver 已经能看到 editorRoot，
但 DocumentRuntimeContext 仍是 NO_EDITOR？
```

必须定位到：

```text
具体 field
具体 refresh timing
具体 function
```

不能只说：

```text
“时序问题”
```

---

# 44. Unit Test ER-1

输入：

```text
initial:
editorRuntime=null
activeFilePath=null
```

必须：

```text
mode=NO_EDITOR
```

---

# 45. Unit Test ER-2

之后：

```text
bindEditorRuntime(root)
activeFilePath=null
```

必须立即：

```text
mode=EPHEMERAL
businessReady=true
```

---

# 46. Unit Test ER-3

同一个 root 重复 bind：

```text
editorInstanceId unchanged
scopeId unchanged
```

---

# 47. Unit Test ER-4

context stale：

```text
mode=NO_EDITOR

but currentEditorRuntime != null
```

执行：

```text
ensureBusinessContextCurrent()
```

必须：

```text
refresh once
→ EPHEMERAL
→ ALLOW
```

---

# 48. Unit Test ER-5

没有 editor runtime：

```text
mode=NO_EDITOR
```

Gate：

```text
NO_OP
```

不能误判 EPHEMERAL。

---

# 49. Unit Test ER-6

Selection invariant：

```text
insideEditor=true
mode=NO_EDITOR
```

必须：

```text
EDITOR-CONTEXT-DIVERGENCE
```

---

# 50. Unit Test ER-7

EPHEMERAL persistence：

```text
persistence gate
→ SKIP
```

---

# 51. Runtime Acceptance RA0 — Startup Untitled

必须：

```text
EDITOR-RUNTIME-BOUND count >=1

NO_EDITOR→EPHEMERAL count >=1

mode=EPHEMERAL
scopeId non-empty
businessReady=true
persistenceReady=false
```

---

# 52. Runtime Acceptance RA1 — Single Special

必须：

```text
special-command gate ALLOW
```

并实际完成一次 `。。+Enter`。

---

# 53. Runtime Acceptance RA2 — No NO_EDITOR Business During Active Editor

当：

```text
current editor runtime exists
```

全日志：

```text
DOCUMENT-BUSINESS-GATE mode=NO_EDITOR
= 0
```

---

# 54. Runtime Acceptance RA3 — Divergence Zero

```text
EDITOR-CONTEXT-DIVERGENCE=0
```

---

# 55. Runtime Acceptance RA4 — Untitled Persistence Isolation

```text
SIDECAR-ACTUAL-WRITE=0
SIDECAR-ACTUAL-LOAD=0
PERSISTED_HISTORICAL birth=0
```

---

# 56. Runtime Acceptance RA5 — Special 10/10

RA0-4 PASS 后：

```text
Untitled
。。+Enter
```

10/10。

---

# 57. Runtime Acceptance RA6 — Split 5/5

Untitled special 后 normal Enter：

```text
SPLIT_1_TO_2
```

至少 5/5，
只验证不被 context gate 错挡。

---

# 58. Runtime Acceptance RA7 — Backspace 3/3

Untitled：

```text
backspace business gate ALLOW
```

至少 3/3。

---

# 59. Save-As 留到后续 A.1.2

只有本轮：

```text
Editor Runtime Authority
```

通过后，
才继续：

```text
EPHEMERAL → PERSISTED
```

转换验收。

---

# 60. Strict Startup

本轮重启必须验证：

```text
old process exited

new PID

StartTime

MainWindowHandle != 0

MainWindowTitle nonempty

target vault

plugin SHA

project SHA

shaMatch=true

style SHA

Build ID

initializationCount=1
```

---

# 61. Untitled Startup Special Rule

对于 Untitled：

```text
activeDoc empty
```

允许。

但必须：

```text
documentMode=EPHEMERAL
scopeId non-empty
businessReady=true
persistenceReady=false
```

---

# 62. 启动验证不足

任一 strict startup mandatory 未验证：

```text
启动命令已发出，但尚未确认成功
```

---

# 63. Hard Stop List

任一出现：

```text
editorRoot exists
但 mode 仍 NO_EDITOR

SelectionTruth insideEditor=true
同时 mode=NO_EDITOR

Mutation selectionRuntimeId non-null
同时 mode=NO_EDITOR

EDITOR-RUNTIME-BOUND=0

NO_EDITOR→EPHEMERAL=0

special-command mode=NO_EDITOR NO_OP

business gate 使用 activeFilePath 判断 editor exists

business gate 使用 documentKey 判断 editor exists

same root 产生多个 editorInstanceId

same code SHA change 但 Build ID 不变

EPHEMERAL sidecar write

EPHEMERAL historical rehydrate

project/plugin SHA mismatch

strict startup mandatory missing
```

立即：

```text
R58.7 PHASE A.1.1 NOT FIXED — R60 BLOCKED
```

---

# 64. 禁止假修复

禁止：

```text
special-command 单独 bypass business gate

硬编码 mode=EPHEMERAL

硬编码 scopeId

只看 window title "Untitled"

只看 activeFilePath null 就直接 EPHEMERAL
而不确认 editorRoot

用 setTimeout 延迟 1 秒再 refresh
来掩盖时序

每次 keydown refresh 全部 context

每次 mutation 生成新的 editorInstanceId

修改 SelectionTruth

修改 Split resolver

修改 Merge resolver

改 Sidecar persistence 模型

继续复用旧 Build ID
```

---

# 65. 推荐修改范围

优先：

```text
src/runtime/document-runtime-context.ts

src/heading-numbering/heading-numbering-service.ts

editor adapter / editor root holder
```

尽量不动：

```text
paragraph-canonical-registry.ts

paragraph-indent-manager.ts

paragraph-layout-store.ts

merge code
```

---

# 66. Build / Deploy

执行：

```powershell
pnpm exec tsc --noEmit

pnpm test

pnpm run build:dev

powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1
```

---

# 67. Restart

必须真实：

```text
restart Typora
↓
verify startup
↓
stop at Untitled
↓
不输入
↓
先检查 RA0
```

---

# 68. 严格执行顺序

```text
Source Map
↓
Root Cause exact function/field
↓
Editor Runtime Authority
↓
Context refresh ordering
↓
RA0
↓
RA1
↓
RA2-4
↓
RA5-7
```

不能跳步。

---

# 69. Final Report

必须输出：

```text
## 1. Current Runtime Contradiction
## 2. Source Map — Editor Runtime
## 3. Source Map — Business/Persistence Gates
## 4. Exact Root Cause
## 5. Current Editor Root Authorities
## 6. New EditorRuntime Authority
## 7. editorInstanceId
## 8. bindEditorRuntime
## 9. Context Refresh Ordering
## 10. ensureBusinessContextCurrent
## 11. NO_EDITOR Semantics
## 12. EPHEMERAL Transition
## 13. Editor/Context Divergence Invariant
## 14. Files Changed
## 15. Build ID
## 16. Build ID Multi-Way Audit
## 17. Typecheck
## 18. Tests
## 19. Build
## 20. Deploy SHA
## 21. Strict Startup
## 22. RA0 Startup Untitled
## 23. RA1 Single Special
## 24. RA2 NO_EDITOR Business Zero
## 25. RA3 Divergence Zero
## 26. RA4 Persistence Isolation
## 27. RA5 Special 10/10
## 28. RA6 Split 5/5
## 29. RA7 Backspace 3/3
## 30. Hard Stop Counts
## 31. Remaining Issues
## 32. Final Verdict
```

---

# 70. Final Verdict

只有全部 mandatory 通过才允许：

```text
R58.7 PHASE A.1.1 PASS — CONTINUE TO PHASE A.1.2
```

否则：

```text
R58.7 PHASE A.1.1 NOT FIXED — R60 BLOCKED
```

任何：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

必须：

```text
R58.7 PHASE A.1.1 NOT FIXED — R60 BLOCKED
```

---

# 71. Execution Rules

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

禁止编造：

```text
editorRoot
editorInstanceId
scopeId
context transition
businessReady
persistenceReady
Build ID
SHA
PID
HWND
runtime acceptance
```

---

# 72. 第一执行动作

不要先改代码。

先完整输出：

```text
Editor Runtime Source Map
```

并明确回答：

```text
SelectionTruth / MutationObserver 为什么能看到 editor，
而 DocumentRuntimeContext 为什么仍停在 NO_EDITOR？
```

必须定位到：

```text
具体函数
具体字段
具体调用顺序
```

确认后，
只修：

```text
Editor Runtime Authority
+
Context Refresh Ordering
```

本轮禁止进入任何后续 Phase。
