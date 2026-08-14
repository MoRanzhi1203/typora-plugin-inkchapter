# TRAE P0 — R58.7 Phase A.1 Ephemeral Document Runtime Context + Business/Persistence Dual Gate

> Project: `D:\TyporaPluginProjects\typora-plugin-inkchapter`
>
> Priority: **P0 / Document Runtime Semantics Repair**
>
> Current authoritative status:
>
> ```text
> R58.7 PHASE A SAFETY = PASS OBSERVED
> R58.7 PHASE A PRODUCT BEHAVIOR = INCOMPLETE
> R60 BLOCKED
> ```
>
> 当前真实问题不是 `。。+回车` 识别失败。
>
> 最新 runtime 已明确：
>
> ```text
> DOCUMENT-CONTEXT-STATE:
> activeFilePath=
> documentKey=null
> ready=false
> reason=ACTIVE_FILE_MISSING
> ```
>
> 然后：
>
> ```text
> DOCUMENT-CONTEXT-GATE:
> caller=special-command
> ready=false
> reason=ACTIVE_FILE_MISSING
> decision=NO_OP
> ```
>
> 当前界面是：
>
> ```text
> Untitled
> ```
>
> 即尚未保存、没有 activeFilePath 的编辑页。
>
> 因此当前 Phase A 的单一 `ready` 概念过于严格：
>
> ```text
> 没有持久化文件路径
> ≠
> 不能进行当前会话内业务操作
> ```
>
> 本轮必须把：
>
> ```text
> Document Ready
> ```
>
> 拆成：
>
> ```text
> Business Runtime Ready
> +
> Persistence Ready
> ```
>
> 并正式支持：
>
> ```text
> EPHEMERAL / Untitled
> ```
>
> 文档上下文。

---

# 0. 本轮唯一目标

让以下场景工作：

```text
新建 Untitled
↓
输入 “。。”
↓
Enter
↓
token 消失
↓
当前 paragraph force-indent
↓
caret continuity 正常
```

同时继续保证：

```text
Untitled
→ sidecar load = 0
→ sidecar write = 0
→ historical rehydrate = 0
→ paragraph-layout\.json = 0
```

---

# 1. 当前错误模型

现有：

```ts
DocumentRuntimeContext.ready: boolean
```

实际上同时控制：

```text
live business
+
persistent storage
```

导致：

```text
activeFilePath missing
→ ready=false
→ special command NO_OP
```

这是当前截图中 `。。+回车` 无效的直接原因。

---

# 2. 新 DocumentRuntimeContext

改为：

```ts
type DocumentRuntimeMode =
  | "NO_EDITOR"
  | "EPHEMERAL"
  | "PERSISTED";

interface DocumentRuntimeContext {
  mode: DocumentRuntimeMode;

  scopeId: string | null;

  sessionId: string;

  editorInstanceId: string | null;

  vaultRoot: string | null;

  activeFilePath: string | null;

  persistenceKey: string | null;

  businessReady: boolean;

  persistenceReady: boolean;

  businessReason:
    | "READY"
    | "NO_EDITOR"
    | "EDITOR_SCOPE_MISSING";

  persistenceReason:
    | "READY"
    | "ACTIVE_FILE_MISSING"
    | "PERSISTENCE_KEY_MISSING"
    | "VAULT_MISSING"
    | "FILE_OUTSIDE_VAULT";
}
```

---

# 3. 三态定义

## 3.1 NO_EDITOR

```text
mode=NO_EDITOR

scopeId=null

businessReady=false

persistenceReady=false
```

用于：

```text
没有 editorRoot
```

---

## 3.2 EPHEMERAL

用于：

```text
Untitled
未保存编辑器
```

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

## 3.3 PERSISTED

用于真实文件：

```text
doc.md
```

必须：

```text
mode=PERSISTED

scopeId=<stable current-session scope>

businessReady=true

persistenceReady=true

activeFilePath=...\doc.md

persistenceKey=doc.md
```

---

# 4. `scopeId` 与 `persistenceKey` 必须分离

这是本轮核心架构规则。

`scopeId`：

```text
当前编辑 session 的业务 namespace
```

负责：

```text
Canonical live ownership
UserIntent
Split
Merge
Backspace
Caret continuity
Special command
```

`persistenceKey`：

```text
持久化文档身份
```

负责：

```text
Sidecar filename
Persisted snapshot
Historical rehydrate
```

禁止再让一个 `documentKey` 同时承担两种职责。

---

# 5. Untitled Scope ID

Untitled 必须生成非空 scopeId：

```text
untitled:<sessionId>:<editorInstanceId>
```

例如：

```text
untitled:sess-1786468367907:editor-1
```

要求：

```text
当前 Untitled session 内稳定
```

不能每次 keydown 重新生成。

---

# 6. Untitled 中允许的业务

在：

```text
mode=EPHEMERAL
businessReady=true
```

时，允许：

```text
Special command
。。+Enter

Canonical live record create

Canonical live update

Split

Merge

Backspace reverse

Promotion

UserIntent

CaretPlan / CaretExpectation

SelectionTruth

Visual projection
```

---

# 7. Untitled 中禁止的业务

在：

```text
persistenceReady=false
```

时，禁止：

```text
Sidecar load

Sidecar write

Persisted historical rehydrate

Generic historical resolver

Persisted historical candidate competition

Persistent snapshot
```

---

# 8. 双 Gate

移除/废弃：

```ts
assertDocumentContextReady()
```

作为单一业务 gate。

拆成：

```ts
assertBusinessContextReady(caller)
```

和：

```ts
assertPersistenceContextReady(caller)
```

---

# 9. Business Gate

规则：

```text
editorRoot exists
scopeId non-empty
businessReady=true
```

则：

```text
ALLOW
```

Untitled：

```text
ALLOW
```

真实 doc.md：

```text
ALLOW
```

---

# 10. Persistence Gate

规则：

```text
mode=PERSISTED

vaultRoot valid

activeFilePath valid

persistenceKey non-empty

activeFilePath inside vault
```

才：

```text
ALLOW
```

Untitled：

```text
NO_OP
```

---

# 11. Gate Trace

业务：

```text
DOCUMENT-BUSINESS-GATE:
caller=special-command
mode=EPHEMERAL
scopeId=untitled:...
businessReady=true
decision=ALLOW
```

持久化：

```text
DOCUMENT-PERSISTENCE-GATE:
caller=sidecar-write
mode=EPHEMERAL
persistenceReady=false
reason=ACTIVE_FILE_MISSING
decision=SKIP_EPHEMERAL
```

---

# 12. 当前 `special-command` 必须改 Gate

当前：

```text
special-command
→ assertDocumentContextReady()
→ NO_OP
```

改成：

```text
special-command
→ assertBusinessContextReady()
```

Untitled 必须允许。

---

# 13. Mutation Observer Gate

当前：

```text
mutation-observer
→ assertDocumentContextReady()
```

必须改成：

```text
mutation-observer
→ assertBusinessContextReady()
```

因此 Untitled Split / Merge 可以继续处理。

---

# 14. Backspace Gate

当前 Backspace business 也必须：

```text
assertBusinessContextReady()
```

不能因为未保存而禁用。

---

# 15. Canonical Registry Namespace

当前 session canonical record 必须绑定：

```text
scopeId
```

而不是强制依赖：

```text
persistenceKey
```

建议：

```ts
interface CanonicalRuntimeMeta {
  recordId: string;

  scopeId: string;

  persistenceKey: string | null;

  state: CanonicalRuntimeState;

  currentElement?: HTMLElement;

  currentRuntimeId?: string;

  generation: number;

  sessionId: string;
}
```

---

# 16. EPHEMERAL Canonical Record

Untitled 中创建：

```text
recordId=R1

scopeId=untitled:...

persistenceKey=null

state=CURRENT_LIVE
```

允许当前 session 内正常工作。

---

# 17. EPHEMERAL Record 禁止进入持久化

任何：

```text
persistenceKey=null
```

的 record：

```text
SIDECAR-ACTUAL-WRITE=0
```

---

# 18. Sidecar Store Gate

`paragraph-layout-store.ts` 必须继续保持：

```text
empty persistenceKey
→ write=0
```

但日志语义改成：

```text
SIDECAR-WRITE-SKIP:
reason=EPHEMERAL_DOCUMENT
```

不是 error。

---

# 19. EPHEMERAL 不加载 Sidecar

Untitled：

```text
SIDECAR-ACTUAL-LOAD=0
```

不得试图：

```text
paragraph-layout\.json
```

---

# 20. EPHEMERAL 不做 Historical Rehydrate

Untitled：

```text
PERSISTED_HISTORICAL birth = 0

historical candidate resolver call = 0
```

---

# 21. Untitled → Save As Transition

这是本轮最关键 lifecycle。

例如：

```text
Untitled
```

当前：

```text
mode=EPHEMERAL

scopeId=S1

persistenceKey=null
```

然后保存为：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\untitled-test.md
```

---

# 22. 保存转换时 `scopeId` 必须保持不变

必须：

```text
before.scopeId=S1

after.scopeId=S1
```

禁止：

```text
保存时销毁所有 CURRENT_LIVE record
```

---

# 23. 保存转换

正确：

```text
mode:
EPHEMERAL
→ PERSISTED

activeFilePath:
null
→ ...\untitled-test.md

persistenceKey:
null
→ untitled-test.md

businessReady:
true
→ true

persistenceReady:
false
→ true

scopeId:
S1
→ S1
```

---

# 24. Transition Trace

必须：

```text
DOCUMENT-CONTEXT-TRANSITION:
from=EPHEMERAL
to=PERSISTED
scopeIdBefore=S1
scopeIdAfter=S1
scopeIdSame=true
activeFilePath=...\untitled-test.md
persistenceKey=untitled-test.md
decision=PROMOTE_PERSISTENCE
```

---

# 25. 保存后第一次 Snapshot

转换完成后：

```text
current session live state
↓
build stable snapshot
↓
write:
...\paragraph-layout\untitled-test.md.json
```

禁止：

```text
重新 historical rehydrate 当前 live paragraph
```

---

# 26. 保存时 Record ID 不得重建

例如 EPHEMERAL：

```text
R1
R2
R3
```

保存后必须仍：

```text
R1
R2
R3
```

只增加：

```text
persistenceKey
```

不能：

```text
R1 → new R4
R2 → new R5
```

---

# 27. PERSISTED 文档保持原行为

打开真实：

```text
doc.md
```

应：

```text
mode=PERSISTED

businessReady=true

persistenceReady=true

persistenceKey=doc.md
```

并继续：

```text
doc.md.json
```

---

# 28. File Open Ordering

PERSISTED file-open：

```text
resolve vault

resolve active file

resolve persistenceKey

resolve scopeId

DOCUMENT-CONTEXT-READY

load sidecar

rehydrate once

bind/current business
```

---

# 29. Editor Load Ordering

Untitled editor-load：

```text
editorRoot exists
↓
create editorInstanceId
↓
create EPHEMERAL scopeId
↓
DOCUMENT-CONTEXT-READY
mode=EPHEMERAL
businessReady=true
↓
bind business
```

不等待 file-open。

---

# 30. `DOCUMENT-CONTEXT-READY` 重新定义

不再表示：

```text
一定有磁盘文件
```

而表示：

```text
当前 editor 有可用 runtime scope
```

因此 Untitled 也必须：

```text
DOCUMENT-CONTEXT-READY:
mode=EPHEMERAL
```

---

# 31. 新 Context Trace Contract

Untitled：

```text
DOCUMENT-CONTEXT-STATE:
mode=EPHEMERAL
scopeId=untitled:...
activeFilePath=null
persistenceKey=null
businessReady=true
persistenceReady=false
businessReason=READY
persistenceReason=ACTIVE_FILE_MISSING
```

真实文件：

```text
DOCUMENT-CONTEXT-STATE:
mode=PERSISTED
scopeId=...
activeFilePath=...\doc.md
persistenceKey=doc.md
businessReady=true
persistenceReady=true
```

---

# 32. 当前 screenshot acceptance

复现当前截图：

```text
Untitled tab
```

输入：

```text
。。
```

按 Enter。

必须：

```text
DOCUMENT-BUSINESS-GATE:
caller=special-command
decision=ALLOW

SPECIAL COMMAND txn starts

token removed

force-indent applied

caret logicalOffset=0

SIDECAR-WRITE-SKIP:
reason=EPHEMERAL_DOCUMENT
```

---

# 33. Special Command Acceptance

Untitled 至少：

```text
10/10
```

每次：

```text
。。+Enter
```

必须成功。

---

# 34. Untitled Split Acceptance

Special command 后 normal Enter：

```text
SPLIT_1_TO_2
```

必须继续：

```text
canonicalOwner correct

caretDestination correct
```

至少：

```text
10/10
```

---

# 35. Untitled Backspace Acceptance

至少：

```text
5/5
```

不得因为：

```text
persistenceReady=false
```

而 NO_OP。

---

# 36. Untitled Merge Acceptance

至少：

```text
plain+plain
canonical+plain
plain+canonical
canonical+canonical
```

各 3 次。

逻辑应与 persisted document 一致。

---

# 37. Untitled Sidecar Hard Gate

全日志：

```text
SIDECAR-ACTUAL-WRITE during EPHEMERAL = 0

SIDECAR-ACTUAL-LOAD during EPHEMERAL = 0

paragraph-layout\.json = 0
```

---

# 38. Untitled Historical Hard Gate

全日志：

```text
PERSISTED_HISTORICAL birth during EPHEMERAL = 0

historical resolver during EPHEMERAL = 0
```

---

# 39. Save-As Acceptance

执行：

```text
Untitled
↓
建立至少 3 个 canonical live overrides
↓
Save As:
untitled-test.md
```

必须：

```text
DOCUMENT-CONTEXT-TRANSITION
EPHEMERAL → PERSISTED

scopeIdSame=true

record IDs unchanged

persistenceKey=untitled-test.md

sidecar path=...\untitled-test.md.json
```

---

# 40. Save-As 后继续编辑

保存后继续：

```text
。。+Enter
normal Enter
Backspace
Merge
```

必须仍正常。

禁止：

```text
context transition 后失去 live binding
```

---

# 41. Save-As 后首次 Snapshot

必须：

```text
SIDECAR-ACTUAL-WRITE
documentKey=untitled-test.md
```

且：

```text
recordCount
```

应反映当前 stable live records。

---

# 42. Existing doc.md Acceptance

点击左侧：

```text
doc.md
```

必须：

```text
mode=PERSISTED
persistenceKey=doc.md
businessReady=true
persistenceReady=true
```

---

# 43. `。。+回车` 在 doc.md

至少：

```text
10/10
```

确认此次修复没有破坏 persisted document。

---

# 44. HARD FREEZE

本轮禁止修改：

```text
resolveSelectionTruth

Mutation Shape Authority

Split canonicalOwner/caretDestination

Merge batch-first preflight

Proof-Before-Mutation

Live Owner Dominance

UserIntent dedup

SELECTION-CONTINUITY-VERIFY

Caret restore rules

physical sidecar backend
```

---

# 45. 不进入 Phase B

本轮只修：

```text
Phase A.1
Ephemeral Runtime Context
```

禁止提前：

```text
ContinuityEngine migration

Registry Commit Firewall migration

CaretPlan rewrite

Session Overlay full migration
```

---

# 46. 当前 Runtime Identity HARD FREEZE

当前已经正确：

```text
pluginMainPath=
...\test\vault\.typora\plugins\dist\main.js

projectMainPath=
D:\TyporaPluginProjects\typora-plugin-inkchapter\dist\main.js

pluginMainSha256
=
projectMainSha256

shaMatch=true

styleSha256 real

initializationCount=1
```

不要再改。

---

# 47. Source Map — Context

修改前必须输出：

```text
editor-load
→ file/function

file-open
→ file/function

active-leaf change
→ file/function

activeFilePath resolver
→ file/function

current documentKey resolver
→ file/function

DocumentRuntimeContext resolver
→ file/function

special-command gate
→ file/function

mutation observer gate
→ file/function

backspace gate
→ file/function

sidecar load gate
→ file/function

sidecar write gate
→ file/function
```

---

# 48. Source Map — Untitled Detection

必须回答：

```text
Typora 未保存编辑器
在 runtime 中如何可靠区分：
NO_EDITOR
vs
EPHEMERAL
```

禁止仅用：

```text
activeFilePath == null
```

来判断 NO_EDITOR。

必须结合：

```text
editorRoot exists
active markdown editor exists
```

---

# 49. editorInstanceId

必须有稳定的当前 editor 实例 identity。

可以：

```text
WeakMap<HTMLElement, string>
```

为 editorRoot 分配：

```text
editor-1
editor-2
```

用于 EPHEMERAL scope。

---

# 50. Unit Test EDC-1

输入：

```text
editorRoot exists
activeFilePath=null
```

必须：

```text
mode=EPHEMERAL
businessReady=true
persistenceReady=false
```

---

# 51. Unit Test EDC-2

输入：

```text
editorRoot missing
activeFilePath=null
```

必须：

```text
mode=NO_EDITOR
businessReady=false
```

---

# 52. Unit Test EDC-3

输入：

```text
editorRoot exists
activeFilePath=...\doc.md
```

必须：

```text
mode=PERSISTED
businessReady=true
persistenceReady=true
persistenceKey=doc.md
```

---

# 53. Unit Test EDC-4

EPHEMERAL special command：

```text
business gate ALLOW
persistence gate SKIP
```

---

# 54. Unit Test EDC-5

EPHEMERAL sidecar write：

```text
write call count=0
```

---

# 55. Unit Test EDC-6

EPHEMERAL → PERSISTED：

```text
scopeId unchanged
```

---

# 56. Unit Test EDC-7

Save-As：

```text
record IDs unchanged
```

---

# 57. Runtime Acceptance EA1 — Untitled Special Command

当前截图场景至少：

```text
10/10
```

---

# 58. Runtime Acceptance EA2 — Untitled Business

执行：

```text
special
split
backspace
merge
arrow navigation
typing
```

全部 business 可用。

---

# 59. Runtime Acceptance EA3 — Untitled Persistence Isolation

必须：

```text
sidecar read/write = 0
historical resolver = 0
```

---

# 60. Runtime Acceptance EA4 — Save-As Transition

至少：

```text
3/3
```

Untitled → saved `.md`。

---

# 61. Runtime Acceptance EA5 — Existing Persisted File

`doc.md`：

```text
special 10/10
split 10/10
```

不能 regression。

---

# 62. Hard Stop List

任一出现：

```text
Untitled special-command still NO_OP

Untitled businessReady=false

Untitled has no scopeId

Untitled sidecar write

Untitled sidecar load

paragraph-layout\.json

Untitled historical rehydrate

Save-As changes scopeId

Save-As recreates record IDs

Save-As loses CURRENT_LIVE binding

Persisted doc.md special-command regression

projectMainPath regression

shaMatch != true
```

立即：

```text
R58.7 PHASE A.1 NOT FIXED — R60 BLOCKED
```

---

# 63. 禁止假修复

禁止：

```text
给 special-command 单独绕过 context gate

硬编码 Untitled documentKey="untitled.md"

把 persistenceKey 填成 "Untitled"

允许写 untitled.json

允许写 .json

只根据 tab title 判断文档身份

保存时清空 registry 重建

保存时把所有 EPHEMERAL record 变成 historical

关闭 Document Context Firewall

继续使用单一 ready boolean

提前做 ContinuityEngine
```

---

# 64. 推荐修改范围

优先：

```text
src/runtime/document-runtime-context.ts

src/heading-numbering/heading-numbering-service.ts

src/heading-numbering/paragraph-canonical-registry.ts

src/heading-numbering/paragraph-layout-store.ts
```

尽量不动：

```text
paragraph-indent-manager.ts
merge resolver
selection truth
```

---

# 65. Build ID

本轮：

```text
inkchapter-r58-7-phA1-ephemeral-context-<unique>
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

记录：

```text
typecheck
tests
build
plugin SHA
project SHA
style SHA
shaMatch
Build ID
```

---

# 67. Restart + Strict Verification

必须真实重启 Typora。

验证：

```text
old process exited

new PID

StartTime

MainWindowHandle

MainWindowTitle

target vault

plugin SHA

project SHA

style SHA

Build ID

initializationCount=1
```

如果当前是 Untitled：

```text
activeDoc empty
```

不是 startup failure，
但必须：

```text
mode=EPHEMERAL
businessReady=true
```

---

# 68. Startup Rule Adjustment

Strict startup 中：

```text
activeDoc exact
```

对于 EPHEMERAL 场景不能强制要求 `.md` path。

应该记录：

```text
activeDoc=<empty>
documentMode=EPHEMERAL
scopeId=<non-empty>
businessReady=true
persistenceReady=false
```

这才是合法状态。

---

# 69. Final Report

必须输出：

```text
## 1. Current Runtime Root Cause
## 2. Why Phase A Safety Was Correct But Product Semantics Were Too Strict
## 3. Source Map — Context
## 4. Source Map — Untitled Detection
## 5. Current Single Ready Model
## 6. New Dual-Gate Model
## 7. NO_EDITOR
## 8. EPHEMERAL
## 9. PERSISTED
## 10. scopeId
## 11. persistenceKey
## 12. editorInstanceId
## 13. Business Gate
## 14. Persistence Gate
## 15. Special Command Gate
## 16. Mutation Gate
## 17. Backspace Gate
## 18. Sidecar Gate
## 19. EPHEMERAL Canonical Record
## 20. EPHEMERAL Historical Isolation
## 21. Untitled→Save-As Transition
## 22. scopeId Continuity
## 23. Record ID Continuity
## 24. Stable Snapshot After Save
## 25. Existing doc.md Regression
## 26. Files Changed
## 27. Build ID
## 28. Typecheck
## 29. Tests
## 30. Build
## 31. Deploy SHA
## 32. Strict Startup
## 33. EA1 Untitled Special 10/10
## 34. EA2 Untitled Business
## 35. EA3 Persistence Isolation
## 36. EA4 Save-As 3/3
## 37. EA5 Persisted doc.md
## 38. Hard Stop Counts
## 39. Remaining Issues
## 40. Final Verdict
```

---

# 70. Final Verdict

只有全部通过才允许：

```text
R58.7 PHASE A.1 PASS — CONTINUE TO PHASE B
```

否则：

```text
R58.7 PHASE A.1 NOT FIXED — R60 BLOCKED
```

任何 mandatory：

```text
NOT EXECUTED
INCOMPLETE
FAIL
```

必须：

```text
R58.7 PHASE A.1 NOT FIXED — R60 BLOCKED
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
scopeId
editorInstanceId
persistenceKey
context mode
businessReady
persistenceReady
Save-As transition
record ID continuity
sidecar call count
historical resolver call count
runtime acceptance
PID
HWND
SHA
Build ID
```

---

# 72. 第一执行动作

不要先写代码。

先输出：

```text
Current Context Source Map
```

然后明确回答：

```text
为什么当前 Untitled
被识别为 ACTIVE_FILE_MISSING / NOT_READY，
而不是 EPHEMERAL / BUSINESS_READY？
```

确认根因后：

```text
拆 dual gate
→ 支持 EPHEMERAL
→ 再验证当前截图中的 “。。+回车”
```

本轮只修 Phase A.1。
