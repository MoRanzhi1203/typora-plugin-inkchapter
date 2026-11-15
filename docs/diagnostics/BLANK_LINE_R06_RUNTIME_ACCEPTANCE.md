# 空行修复运行时验收（R06）

本轮把「多余空行检测 → 修复 → 重新检测 → 撤销 / 重做」从纯函数与控制器测试，推进到**真实 Typora 编辑器缓冲区**的可重复验收，并且不再依赖 DevTools 控制台输入或窗口焦点。

## 1. 三层验收

| 层级 | 入口 | 证明什么 | 位置 |
|---|---|---|---|
| 1 纯函数 | Vitest | 空行检测、目标定位、补丁生成、结构安全 | `src/document-utilities/document-diagnostic-fix-v1.test.ts` 等 |
| 2 控制器集成 | Vitest（可变缓冲区 + 真实 `DiagnosticFixController`） | 诊断 → 计划 → 写回 → 重新检测全过程 | `src/document-utilities/document-diagnostic-fix-controller.test.ts` |
| 3 真实 Typora Runtime | 测试 vault 内运行的插件 | 真实编辑器写回、诊断刷新、撤销 / 重做 | `src/document-utilities/document-diagnostic-acceptance-harness-v1.ts` + `scripts/run-blank-line-acceptance.mjs` |

第 3 层明确区分两种验收：

- **Runtime 业务入口验收（本轮已自动化完成）**：直接调用与检测面板「修复 / 一键修复」按钮**相同**的 `DiagnosticFixController.startDiagnostic` / `startAllAuto`，不模拟鼠标点击。
- **真实鼠标点击面板验收（本轮未完成）**：需要窗口焦点与 UI Automation，受环境限制，见第 6 节。

## 2. 运行方式

```powershell
pnpm run build
powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1
pnpm run accept:blank
```

`accept:blank` 会：

1. 用模板覆盖验收夹具 `test/vault/runtime/acceptance/Blank-Line-R06-Runtime-Acceptance.md`；
2. 写入运行令牌 `acceptance-request.json`；
3. 以 vault 方式启动 Typora 并打开该文档（已在运行则复用实例）；
4. 轮询插件写出的 `acceptance-last-run.json`；
5. 结束后**无条件**用模板恢复夹具。

Typora 若已在运行旧构建，必须重启后新构建才会加载；脚本在超时会打印当前运行的插件 SHA 供比对。

## 3. 安全门禁

- 仅当活动文档是 `<vault>/runtime/acceptance/Blank-Line-R06-Runtime-Acceptance.md`、且 vault 路径以 `test/vault` 结尾时才启用；
- 需要运行令牌，且同一令牌不会重复执行；
- 可选环境变量 `INKCHAPTER_BLANK_ACCEPTANCE=1` 作为额外开关；
- 只能调用已注册的修复入口，不提供任意 JS 执行、任意文件写入；
- 修复仍走原有版本校验、`expectedBefore` 比对、非空行保护与修复后复检；
- 报告固定写入 `test/vault/runtime/acceptance/acceptance-last-run.json`，不含正文内容（只有哈希、行数、空行 run 尺寸与行号）。

## 4. 本轮实测结果（2026-11-15）

构建 SHA256：`848CD5405D179EF00401AF86BF0B297C1FCA94A8609077CAB3A824E11BEBC08E`，`loadSource=vault`。

| 步骤 | 行数 | 空行诊断 | 文末换行 | 空行 run 尺寸 | 结果 |
|---|---|---|---|---|---|
| baseline | 62 | 7 | 4 | `[1,1,4,1,4,1,4,1]` | — |
| 单项修复（trailing） | 62→59 | 7→6 | 1 | 不变 | PASS |
| 撤销 | 59→62 | 6→7 | 4 | 不变 | PASS（内容与基线逐字节一致） |
| 重做 | 62→59 | 6→6 | 1 | 不变 | PASS |
| 一键修复 | 62→41 | 7→0 | 1 | `[1,1,1,1,1,1,1,1]` | PASS |
| 撤销 | 41→62 | 0→7 | 4 | 还原为基线 | PASS |
| 重做 | 62→41 | 0→0 | 1 | `[1,1,1,1,1,1,1,1]` | PASS |
| 复位 | 41→62 | 0→7 | 4 | 还原为基线 | PASS |

结论：

- 修复后所有块之间只剩 **1 个 Markdown 结构分隔空行**，不会再被诊断为「多余空行」；文末恰好 1 个换行。这回答了 R06 §8.1：上一阶段所说的「1 个结构空行」是**源码分隔空白行**，不是渲染层空段落。
- 撤销后文档与修复前**逐字节一致**（不只是「写回成功」），重做后再次得到修复结果。
- 单项修复与一键修复使用同一逻辑，修复后 `EXCESSIVE_INTERNAL_BLANK_LINES` / `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE` / `DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE` 全部归零。

## 5. 撤销 / 重做语义（Typora 1.6.7）

审计依据：`D:\Typora\resources\appsrc\window\frame.js`（只读）中的 `File.reloadContent` 与 UndoManager 实现。

- `File.reloadContent(markdown, options)` 解构 `{skipUndo, delayRefresh, fromDiskChange, skipChangeCount, onInit, skipStore}`；
- 未传 `skipUndo` 时会构造一条 `tag: "reload"` 的命令，并把 `buildAllDoc(...)` 快照压入 undo / redo，然后 `editor.undo.register(command)` —— 即**一次写回 = 一条撤销记录**；
- `skipUndo: true` 才会走 `editor.undo.reset()`（清空历史）；墨章修复从不使用该分支；
- 撤销 / 重做入口是 `File.editor.undo.undo()` / `.redo()`，与 Edit 菜单、`Ctrl+Z` / `Ctrl+Y` 使用同一条命令栈；本插件通过 `invokeEditorUndo` / `invokeEditorRedo` 调用它们进行验收（`src/infrastructure/typora-adapter.ts`）；
- 运行时实测（第 4 节）证明撤销恢复的是**修复前的完整文档文本**，重做恢复修复结果；光标/选区由同一条命令内压入的 selection undo 恢复。

未通过物理按键验证：`Ctrl+Z` / `Ctrl+Y` 的键盘事件在窗口焦点被其它进程抢占时无法稳定投递，本轮改用同一命令入口验证语义，并如实记录该差异。

## 6. 未完成项

- **真实鼠标点击检测面板「修复 / 一键修复」**：Typora 1.6.7 不暴露 UI Automation 树，CDP 页面目标为空，且系统前台焦点会被其它窗口抢占；本轮未完成，未用控制器测试冒充。
- 第 4 节证据由 Runtime 业务入口调用产生，**不是**鼠标点击产生。
