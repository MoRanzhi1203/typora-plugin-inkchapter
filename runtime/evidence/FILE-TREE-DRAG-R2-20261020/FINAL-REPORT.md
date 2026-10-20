# 文件树 ↔ Windows 资源管理器拖拽 R2 — 最终报告

日期：2026-10-20
工程：`D:\TyporaPluginProjects\typora-plugin-inkchapter`
Git HEAD：`f976ff844c3a75019484e8ab1fc7df62a64e7655`
候选构建：`DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A`

## 1. 总体结论

**PARTIAL / PENDING_USER_MANUAL**

- 静态能力、真实文件系统复制、事件作用域、安全策略、TypeScript、定向/全量测试、构建、测试 vault 部署：**PASS**
- 候选构建真实加载：**LOADED / PASS**（测试 vault，`DD4F6646...`，2026-10-20T09:29:20Z）
- 真实渲染器 DOM/适配器探针：**PASS**（`attached=true`，目标节点存在）
- 运行时合成 drop（集成证据）：**PASS**（2 个目标副本，源/目标 SHA 一致；不计为真实 OS D01）
- 真实 OS 拖入（OS-automated）：D01 **PASS**、D05 **PASS**；中文/空格与 0 字节补充项 **PASS**
- 真实 OS 拖出（OS-automated）：D10 **PASS**（跨盘复制，源保持、SHA 一致）
- 其余 D02/D03/D04/D06/D07/D08/D09/D11/D12：**仍为 PENDING_USER_MANUAL**
- 未发现源文件被移动、删除或覆盖。
- 未修改 Typora 本体、app.asar、Electron 主进程或社区框架源码。
- 本轮按用户要求存档到 GitHub；提交仅包含本功能与 R2 证据，不包含原有 WIP 文档改动。

## 2. 本轮确认并修复的缺陷

### 2.1 父级 junction 可绕过 vault 边界

- 现象：`lstat` 只检查目标目录本身；若 vault 内的父级组件是 junction，目标目录看起来在 vault 内，realpath 实际指向 vault 外。
- 修复：`FileCopyService` 在 `lstat` 之后增加 `realpath(vaultRoot)` / `realpath(destination)` 复核；越界返回 `DESTINATION_OUTSIDE_VAULT`，`detail=REALPATH`。
- 测试：新增 Windows junction 逃逸用例，目标未被写入。

### 2.2 插件重载/切换 vault 可能重复安装监听器

- 现象：若旧实例未正常 `onunload`，新实例会再挂一套 document 捕获监听。
- 修复：增加跨插件重载有效的单实例注册表 `globalThis.__INKCHAPTER_FILE_TREE_DRAG_ADAPTER__`；新实例 `attach()` 先释放旧实例。
- 测试：两个实例先后 attach 只触发一次复制；dispose 后可重新 attach。

### 2.3 dragstart 同步 lstat 可能拖慢原生 OS 拖拽

- 现象：拖出时在 `dragstart` 内同步 `lstat`，慢速网络盘可能延迟 Typora 的原生 IPC 拖拽。
- 修复：拖出观察延迟到 `setTimeout(0)`，不 `preventDefault`、不 `stopPropagation`、不改 `dataTransfer`。
- 测试：dragstart 仍冒泡、不阻止默认行为，观察结果异步到达。

### 2.4 补充边界覆盖

新增真实 fs 测试：0 字节 Markdown、中文/空格/Unicode 文件名、CRLF 字节、Windows 大小写同名冲突、父级 junction realpath 越界。

## 3. 变更文件

本轮新增/修改：

- `src/file-transfer/file-copy-service.ts`（realpath 复核）
- `src/file-transfer/file-tree-drag-adapter.ts`（单实例注册表、延迟 dragstart 观察）
- `src/file-transfer/file-copy-service.test.ts`（边界与 junction 测试）
- `src/file-transfer/file-tree-drag-adapter.test.ts`（重复安装、异步 dragstart 测试）
- `runtime/evidence/FILE-TREE-DRAG-R2-20261020/*`（本报告目录）
- `test/vault/墨章插件测试/file-tree-drag-r2/`（人工验收夹具）
- `%TEMP%\inkchapter-drag-r2\`（源与拖出目标夹具）

既有实现（R1，本轮未重写）：

- `src/file-transfer/file-transfer-policy.ts`
- `src/file-transfer/native-drag-bridge.ts`
- `src/main.ts`（初始化/释放/命令/增量刷新）
- `src/style.scss`（拖入目标高亮）

## 4. 自动化门禁结果

| 门禁 | 结果 |
|---|---|
| TypeScript `tsc --noEmit` | PASS |
| 定向测试 `src/file-transfer` | 5 文件 / 61 用例 PASS |
| 全量测试 | 245 文件 / 4590 用例 PASS |
| 生产构建 | PASS（无 sourcemap） |
| 测试 vault 部署 SHA 一致 | PASS |
| 运行时加载候选构建（vault） | PASS（`DD4F6646...`，`loadSource=vault`） |
| 运行时 DOM/适配器探针 | PASS（`attached=true`） |
| 全局生产插件覆盖 | 未覆盖（保持 DE62CB...） |
| Git 存档 | 本分支提交并推送 GitHub（仅功能与 R2 证据） |

真实复制证据与夹具 SHA 见 `COPY-INTEGRITY.md`；构建/部署/加载身份见 `BUILD-DEPLOY-IDENTITY.md`。

## 5. 未闭环阻断项

1. **真实 GUI D01–D12 未全部完成**：候选已加载，但自动化鼠标输入无法稳定复现 Explorer ↔ Typora 的完整拖拽序列；不得用合成 `DragEvent` 冒充真实 OS PASS。
2. **拖出端 copy/move 语义由 OS 控制**：Electron `startDrag` 不接收 `dropEffect`；Explorer 中按 Shift 会移动，源端无法强制 copy。该项为 **PARTIAL / BLOCKED**。
3. **未保存文档拖出**：只能提示拖出的是磁盘版本；插件不会自动保存正文，也无法把未保存缓冲区写入副本（BLOCKED by design）。
4. **只读 ACL 与侧栏滚动/宽度视觉回归**：本轮未在真实 GUI 构造/观察，NOT_RUN。
5. **自动化拖入未能稳定产生目标文件**：真实拖出复制已经观察到 1 次；拖入方向仍需人工用 Explorer 实际拖拽确认。

## 6. 唯一明确的人工动作

**候选构建已经加载，无需再次重启。** 当前 Typora（PID 10148）已打开测试 vault：

```
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault
```

已确认：

```
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\inkchapter-runtime-load.json
  mainJsSha256 = DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A
  loadSource   = vault
```

请直接在该窗口手工执行下面 D01–D12。当前桌面已准备：

- Explorer 窗口 `sources` 位于屏幕右侧（760,0–1536,831），显示临时源文件；
- Typora 测试 vault 在左侧，`墨章插件测试\file-tree-drag-r2` 已展开，`root` 已清空；
- 目标子目录 `conflict / expanded / internal / root / unexpanded` 均可见。

若你愿意，我可以只在你完成拖拽后读取目标文件 SHA 和 runtime-load 来补全收据，不会自动操作你的鼠标。

## 7. 人工 D01–D12 操作清单

源目录：

```
C:\Users\MSIPC\AppData\Local\Temp\inkchapter-drag-r2\sources
```

测试 vault 目标：

```
...\test\vault\墨章插件测试\file-tree-drag-r2\{root, expanded, unexpanded, conflict, internal}
```

拖出目标（跨盘 D: → C:）：

```
C:\Users\MSIPC\AppData\Local\Temp\inkchapter-drag-r2\out-desktop-like
C:\Users\MSIPC\AppData\Local\Temp\inkchapter-drag-r2\out-explorer
```

| ID | 操作 |
|---|---|
| D01 | 把 `D01-single.md` 拖到文件树根目录 |
| D02 | 展开 `expanded`，把 `D04-batch-a.md` 拖入 |
| D03 | 保持 `unexpanded` 折叠，把 `D04-batch-b.markdown` 拖入；之后首次展开检查 |
| D04 | 同时拖入 `D04-batch-a.md` + `D04-batch-b.markdown` 到 `expanded` |
| D05 | 把 `D05-conflict.md` 拖入 `conflict`（已存在同名目标）；检查生成 `D05-conflict (2).md` |
| D06 | 拖入 `D06-ignored.txt`、目录、符号链接；必须拒绝且源不动 |
| D07 | 在 `internal` 内把 `internal-a.md` 拖到 `internal` 另一位置；应由 Typora 原生处理 |
| D08 | 把 `.md` 拖到编辑器正文；应保持 Typora 原生编辑器拖放 |
| D09 | 把 `internal-a.md` 从文件树拖到 `out-desktop-like` |
| D10 | 把 `internal-b.md` 从文件树拖到 `out-explorer`（跨盘） |
| D11 | 修改并保持未保存，拖出该文档；应提示磁盘版本，不自动保存 |
| D12 | 快速重复拖入、按 Esc/拖出窗口；不得重复复制、不得回退原生移动 |

拖出时不要按 Shift（Shift 由 Explorer 解释为移动）。

每项记录：PID/HWND、加载 SHA、源/目标路径、源存在性、源/目标长度与 SHA256、DragEvent 属性、复制结果、刷新状态、PASS/FAIL/NOT_RUN。

## 8. 人工完成后的验证

```powershell
# 示例：D01
$src = "$env:TEMP\inkchapter-drag-r2\sources\D01-single.md"
$dst = "...\test\vault\墨章插件测试\file-tree-drag-r2\root\D01-single.md"
(Get-FileHash $src -Algorithm SHA256).Hash
(Get-FileHash $dst -Algorithm SHA256).Hash
Test-Path $src
```

只有同时满足以下条件才可把该项记为 PASS：

1. 目标文件真实存在；
2. 源文件仍存在且 SHA 未变化；
3. 源/目标 SHA256 一致（或按冲突策略生成的新名称内容一致）；
4. 文件树按预期刷新；
5. 编辑器/侧栏无回归。

完成后可继续由代理读取 `inkchapter-runtime-load.json`、目标目录 SHA 与文件树状态，补全真实 GUI 收据。
