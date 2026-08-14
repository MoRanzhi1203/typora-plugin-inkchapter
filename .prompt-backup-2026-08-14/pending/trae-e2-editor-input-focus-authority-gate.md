# Trae — E2 Editor Input Focus Authority 纯观测门禁

## 0. 任务目标

本轮只建立并验证 **E2 Editor Input Focus Authority** 的纯观测门禁。

当前已确认：

```text
E2 Internal Strict Startup = PASS / RUNTIME / FORMAL
Foreground Input Safety = FIXED / RUNTIME PASS
Input Target HWND Authority = PASS / RUNTIME
SendInput OS Acceptance = PASS / RUNTIME
Failure-Path Artifact Durability = FIXED / RUNTIME PASS
Token Verdict Specificity = FIXED / RUNTIME PASS
Trial Artifact Authority = PASS / RUNTIME
Forensic Late Flush = RULED OUT / CURRENT RUNTIME
Current E2-01 = INVALID / RUNTIME_KEYBOARD_EVENT_NOT_OBSERVED
```

当前 Runtime 核心链条：

```text
targetHwnd=1314632
foregroundHwndAfterAcquire=1314632
foregroundMatchAfterAcquire=true
foregroundHwndBeforeInput=1314632
foregroundMatchBeforeInput=true
requestedInputCount=2
sendInputReturnCount=2
foregroundHwndAfterInput=1314632
foregroundMatchAfterInput=true

trial delta:
deltaExists=true
deltaBytes=0
eventCount=0

keyboardEventCount=0
beforeInputCount=0
inputCount=0
compositionStartCount=0
compositionEndCount=0

raw audit:
byteOffset 4768 -> 4768
```

正式问题：

```text
E2 EDITOR INPUT DELIVERY GAP
= CONFIRMED / CURRENT RUNTIME
```

当前主要怀疑但未证明：

```text
Editor / Contenteditable Focus Authority
= PRIMARY SUSPECT / UNPROVEN
```

本轮目标不是修复 focus，而是**证明 SendInput 前到底谁拥有输入焦点与 selection/caret authority**。

---

# 1. 当前冻结 Build

```text
Build ID:
inkchapter-r58-7-p0-empty-special-terminal-normalize-1jdevq

Main SHA:
238A7D80B6AE6ED0564F13867562E0E017E4CDDDF3A8AE3F70DD81723EC83D9B

Style SHA:
F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0
```

项目：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

目标 fixture：

```text
test\vault\r58-empty-special-e2-01.md
```

---

# 2. HARD FREEZE

禁止修改业务逻辑：

```text
src/**
dist/**
Build ID
Main SHA
style.css
fixture
EmptySpecial
NormalEnter
Canonical
DocumentRuntimeContext
historical resolver
caret/CSS
selection restore/repair
IME behavior
token command behavior
```

不得生成新业务 Build。

---

# 3. 本轮允许修改范围

只允许 Harness / observability：

```text
scripts/r58-matrix/run-empty-special-gate.mjs
scripts/r58-matrix/e2-input.mjs
scripts/r58-matrix/*focus*.mjs
scripts/r58-matrix/*contract*.mjs
scripts/r58-matrix/win32-helper/*
```

如果必须修改 `src/**` 才能获取 renderer `document.activeElement` / selection：

```text
STOP
FOCUS_PROBE_REQUIRES_BUSINESS_BUILD_CHANGE
```

不得自行修改业务源码。

---

# 4. 禁止项

```text
PowerShell / pwsh / *.ps1
git add / commit / push
retry-until-pass
自动点击编辑器
element.focus()
editor.focus()
contenteditable.focus()
setSelection / Range 修复
发送 Tab / Arrow / Escape 抢焦点
修改 IME
修改 EmptySpecial
重复 E2 直到 PASS
```

本轮只允许：

```text
OBSERVE
CLASSIFY
STOP
```

---

# 5. 必须回答的问题

```text
Q1. SendInput 前 top-level foreground HWND 是否仍是目标 Typora？
Q2. Win32 focused child HWND 是谁？
Q3. Win32 active HWND / capture HWND 是谁？
Q4. renderer document.activeElement 是谁？
Q5. activeElement 是否属于 markdown editor root？
Q6. activeElement 是否 contenteditable？
Q7. selection 是否存在？
Q8. selection anchor/focus 是否都在 editor root 内？
Q9. 当前 paragraph/runtimeId 是否能从 selection 解析？
Q10. logicalOffset 是否存在？
Q11. SendInput 后这些 authority 是否变化？
```

---

# 6. 统一 Focus Snapshot

建议定义：

```ts
type EditorInputFocusSnapshot = {
  phase:
    | "BEFORE_ACQUIRE"
    | "AFTER_ACQUIRE"
    | "BEFORE_INPUT"
    | "AFTER_INPUT";

  buildId: string;
  runtimeSessionId: string;
  auditPath: string;
  trialId: string;
  timestamp: number;

  targetPid: number;
  targetHwnd: number;

  foregroundHwnd: number;
  foregroundMatchesTarget: boolean;

  foregroundThreadId: number | null;
  focusedChildHwnd: number | null;
  activeHwnd: number | null;
  captureHwnd: number | null;
  caretHwnd: number | null;

  editorInstanceId: string | null;

  activeElementTag: string | null;
  activeElementId: string | null;
  activeElementClassName: string | null;
  activeElementContentEditable: string | null;
  activeElementIsContentEditable: boolean | null;
  activeElementInsideEditorRoot: boolean | null;

  selectionRangeCount: number | null;
  selectionAnchorInsideEditor: boolean | null;
  selectionFocusInsideEditor: boolean | null;
  selectionCollapsed: boolean | null;

  selectionRuntimeId: string | null;
  currentParagraphRuntimeId: string | null;
  logicalOffset: number | null;

  overall: boolean;
  decision: string;
}
```

---

# 7. Win32 Focus Authority Probe

优先使用：

```text
GetForegroundWindow
GetWindowThreadProcessId
GetGUIThreadInfo
```

至少产出：

```text
targetPid
targetHwnd
foregroundHwnd
foregroundPid
foregroundThreadId
activeHwnd
focusedChildHwnd
captureHwnd
caretHwnd
```

注意：

```text
foregroundHwnd == targetHwnd
```

只证明 top-level foreground authority，不等于 editor focus。

---

# 8. Renderer Focus Authority Probe

若现有 Runtime 已有可读 renderer probe，优先复用。

需要读取：

```text
document.activeElement
editorRoot
selection
current paragraph
logical offset
```

至少产生：

```text
EDITOR-INPUT-FOCUS-PROBE
```

payload：

```text
phase
editorInstanceId
activeElementTag
activeElementId
activeElementClassName
activeElementContentEditable
activeElementIsContentEditable
activeElementInsideEditorRoot
selectionRangeCount
selectionAnchorInsideEditor
selectionFocusInsideEditor
selectionCollapsed
selectionRuntimeId
currentParagraphRuntimeId
logicalOffset
decision
overall
```

---

# 9. 如果 Harness 无法读取 Renderer 状态

禁止猜测。

明确分类：

```text
RENDERER_FOCUS_PROBE_UNAVAILABLE
```

并 STOP。

不得自动点击、自动 focus、自动改业务源码。

---

# 10. Probe 时间点

至少四个：

```text
FOCUS-1 BEFORE_ACQUIRE
FOCUS-2 AFTER_ACQUIRE
FOCUS-3 BEFORE_INPUT
FOCUS-4 AFTER_INPUT
```

最关键：

```text
BEFORE_INPUT
```

必须在最终 foreground CAS 通过后、真正 `SendInput()` 前完成。

顺序：

```text
FOCUS-PROBE BEFORE_INPUT
↓
foreground CAS
↓
SendInput
↓
FOCUS-PROBE AFTER_INPUT
```

---

# 11. Focus Authority 判定

## A. Top-level Window Wrong

```text
foregroundHwnd != targetHwnd
→ FOREGROUND_WINDOW_MISMATCH
```

## B. Win32 Child Focus Missing

```text
foregroundHwnd == targetHwnd
focusedChildHwnd is null/0
→ WIN32_FOCUSED_CHILD_NOT_FOUND
```

记录，但需结合 renderer probe。

## C. Renderer Active Element 不属于 editor

```text
activeElementInsideEditorRoot=false
→ EDITOR_INPUT_NOT_FOCUSED
```

## D. ActiveElement 在 editor 内，但 selection 不在 editor

```text
activeElementInsideEditorRoot=true
AND (
  selectionRangeCount==0
  OR selectionAnchorInsideEditor=false
  OR selectionFocusInsideEditor=false
)
→ EDITOR_SELECTION_NOT_OWNED
```

## E. ActiveElement + Selection 都正确

```text
activeElementInsideEditorRoot=true
selectionRangeCount>0
selectionAnchorInsideEditor=true
selectionFocusInsideEditor=true
currentParagraphRuntimeId != null
logicalOffset != null
→ EDITOR_FOCUS_AUTHORITY_PASS
```

若此时 `SendInput=2/2` 后仍：

```text
keyboardEventCount=0
```

才升级：

```text
FOCUSED_EDITOR_DID_NOT_OBSERVE_KEYBOARD_EVENT
```

---

# 12. 不要把 contenteditable=true 当唯一条件

Typora 可能使用嵌套容器，因此 authority 以：

```text
editorRoot.contains(activeElement)
+
selection ownership
```

为主。

`isContentEditable` 仅作辅助 evidence。

---

# 13. 新增 artifact

至少生成：

```text
artifacts/empty-special-runtime/e2-01/editor-input-focus-audit.json
```

包含：

```json
{
  "buildId": "...",
  "runtimeSessionId": "...",
  "auditPath": "...",
  "trialId": "e2-01",
  "generatedAt": "...",
  "beforeAcquire": {},
  "afterAcquire": {},
  "beforeInput": {},
  "afterInput": {},
  "finalDecision": "...",
  "overall": false
}
```

即使 probe 不可用，也必须落盘：

```json
{
  "finalDecision": "RENDERER_FOCUS_PROBE_UNAVAILABLE",
  "overall": false
}
```

---

# 14. Input Audit 联动

现有：

```text
input-injection-audit.json
```

继续保持。

最终 input gate 必须能同时看到：

```text
top-level foreground authority
Win32 child focus authority
renderer activeElement authority
selection authority
SendInput OS acceptance
runtime keyboard observation
```

本轮不改变 token gate 业务逻辑。

---

# 15. 建议最终判定顺序

```text
1. Strict Startup authority
2. E2 Runtime Precondition
3. Top-level foreground
4. Win32 focused child observation
5. Renderer activeElement ownership
6. Selection ownership
7. SendInput exactness
8. Runtime keyboard observation
9. beforeinput/input
10. IME
11. token
12. EmptySpecial
```

本轮只推进到第 6/8 层。

---

# 16. Contract Tests

至少新增：

```text
FOCUS-1 foreground target correct + activeElement outside editor
→ EDITOR_INPUT_NOT_FOCUSED

FOCUS-2 activeElement inside editor + selectionRangeCount=0
→ EDITOR_SELECTION_NOT_OWNED

FOCUS-3 activeElement inside editor + anchor outside
→ EDITOR_SELECTION_NOT_OWNED

FOCUS-4 activeElement/selection/runtimeId/logicalOffset all valid
→ EDITOR_FOCUS_AUTHORITY_PASS

FOCUS-5 renderer focus probe unavailable
→ RENDERER_FOCUS_PROBE_UNAVAILABLE

FOCUS-6 focusedChildHwnd missing 但 renderer authority PASS
→ 不误判 EDITOR_INPUT_NOT_FOCUSED

FOCUS-7 foreground mismatch
→ FOREGROUND_WINDOW_MISMATCH

FOCUS-8 focus audit 必须绑定 current build/session/auditPath/trialId

FOCUS-9 wrong-session focus artifact
→ DROP_STALE

FOCUS-10 任何 INVALID
→ editor-input-focus-audit.json 仍落盘
```

---

# 17. 静态验证

只执行：

```text
node --check scripts/r58-matrix/run-empty-special-gate.mjs
node --check scripts/r58-matrix/e2-input.mjs
node --check 新增 focus 模块
```

然后：

```text
focus contracts
input regression contracts
artifact regression contracts
precondition regression contracts
```

最后：

```text
node scripts/r58-matrix/run-empty-special-gate.mjs --mode preflight
```

必须 PASS。

---

# 18. Runtime 纪律

本轮默认：

```text
Harness / observability patch
→ static contracts
→ preflight
→ STOP
```

不要在 Trae sandbox 运行 Strict Startup 或 E2-01。

下一轮再在外部正常 Windows CMD 单次复证。

---

# 19. 如果必须修改 src/** 才能读取 renderer focus

立即 STOP。

报告：

```text
Renderer Focus Probe
= HARNESS-ONLY UNAVAILABLE

Pure Observability Build
= REQUIRED
```

并说明缺失：

```text
document.activeElement
editorRoot.contains(activeElement)
selection ownership
runtimeId/logicalOffset
```

不得自行进入业务 Build 修改。

---

# 20. 报告产出

生成：

```text
docs/audits/inkchapter-e2-editor-input-focus-authority-gate-2026-08-13.md
artifacts/project-audit/inkchapter-e2-editor-input-focus-authority-gate-2026-08-13.json
```

报告至少包含：

```text
A. Frozen Build
B. Current Proven Runtime Chain
C. Editor Input Delivery Gap
D. Win32 Focus Probe Design
E. Renderer Focus Probe Availability
F. Selection Authority Design
G. Focus Verdict Taxonomy
H. Artifact Schema
I. Contract Tests
J. Preflight
K. Runtime Reproof Status
L. Remaining Unknowns
M. P0-A/B/C Status
N. R58.7 / R60 Verdict
```

---

# 21. 最终状态措辞

若 Harness-only focus probe 已实现：

```text
E2 Editor Input Focus Authority Gate
= SOURCE/HARNESS READY / RUNTIME PENDING
```

若 renderer probe 做不到且需要业务 Build：

```text
E2 Editor Input Focus Authority Gate
= HARNESS PARTIAL

Renderer Focus Probe
= PURE OBSERVABILITY BUILD REQUIRED
```

不得写：

```text
Editor focus bug fixed
IME fixed
E2 fixed
P0 fixed
```

---

# 22. 当前 Formal Status 保持

```text
E2 Internal Strict Startup = PASS / RUNTIME / FORMAL
Foreground Input Safety = FIXED / RUNTIME PASS
Input Target HWND Authority = PASS / RUNTIME
SendInput OS Acceptance = PASS / RUNTIME
Failure-Path Artifact Durability = FIXED / RUNTIME PASS
Token Verdict Specificity = FIXED / RUNTIME PASS
Trial Artifact Authority = PASS / RUNTIME
Forensic Late Flush = RULED OUT
E2 Editor Input Delivery Gap = CONFIRMED / CURRENT RUNTIME
Editor / Contenteditable Focus Authority = PRIMARY SUSPECT / UNPROVEN
IME = NOT REACHED
EmptySpecial = NOT STARTED
P0-A/B/C = RUNTIME PENDING
Caret = RUNTIME PENDING
R58.7 = NOT CLOSED
R60 = NO-GO
```

---

# 23. 核心原则

```text
不要为了让输入成功而主动抢焦点。

先证明：
谁拥有 top-level foreground，
谁拥有 Win32 focus，
谁拥有 renderer activeElement，
谁拥有 selection/caret。

只有 focus authority 真正 PASS 后，
SendInput=2/2 仍没有 keyboard event，
才继续调查更底层的 Electron / Windows input delivery。
```
