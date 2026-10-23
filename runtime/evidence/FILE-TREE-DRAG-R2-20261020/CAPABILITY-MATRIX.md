# 文件树 ↔ Windows 资源管理器拖拽 R2 — 能力矩阵

日期：2026-10-20
工程：`D:\TyporaPluginProjects\typora-plugin-inkchapter`
HEAD：`2901a28`（R2 修复提交）
本轮候选构建：`CB60457608E65901A037105B3712EA2771938F036AA7BDD5900220AE6150D63E`（D12 busy 修复后；上一构建 `1ABFB941...`）

## 状态定义

| 状态 | 含义 |
|---|---|
| PASS | 已由真实运行或可复现自动化门禁证明 |
| PARTIAL | 主体能力可用，但存在明确的系统/平台限制 |
| BLOCKED | 当前插件权限或 OS 接口无法实现 |
| PENDING_USER_MANUAL | 需要人工鼠标/真实 GUI 操作，尚未执行 |
| NOT_RUN | 本轮未执行 |

## 能力矩阵

| 能力 | 结论 | 证据 / 限制 |
|---|---|---|
| 仅拦截文件树区域的外部文件拖入 | PASS | 捕获监听按 `#file-library-tree` 过滤；编辑器正文与内部拖拽测试通过 |
| 外部 `.md` / `.markdown` 拖入执行真实复制 | PASS | `FileCopyService.copyFile`；真实临时目录 SHA 一致，见 `COPY-INTEGRITY.md` |
| 阻止 Typora 原生 `copyOrMoveFiles → rename` 移动 | PASS（自动化事件层） | 捕获阶段 `preventDefault + stopPropagation + stopImmediatePropagation`；真实 GUI 待人工确认 |
| 批量导入 | PASS | 多文件逐项结果；单个失败不影响其他文件 |
| 同名冲突默认保留两个 | PASS | 自动生成 `名称 (2).md`；`skip` / `overwrite` 为显式策略 |
| 大小写不同但同名的 Windows 冲突 | PASS | `Note.md` 与 `note.md` 自动重命名，原目标不变 |
| 导入后文件树增量刷新 | PASS（代码/单测） | `fileTree.onChangeForWin(..., 'add')` + Typora 原生 watcher；不整体重绘 |
| 树根 / 已展开目录 / 未展开目录 / 文件节点父目录 | PASS（路径解析） | 纯策略与 DOM 适配器测试覆盖；真实 GUI 待人工 |
| 多文件、空文件、中文/空格文件名、CRLF 原样复制 | PASS（真实 fs） | 0 字节、`中文 名称（空格）.md`、CRLF 字节均 SHA 一致 |
| 拒绝 `.txt` / 目录 / 无效路径 | PASS | 真实 OS：`.txt`、目录（通知“源路径不是普通文件”）、junction（通知“不支持符号链接”）均拒绝且无副本；`INVALID_SOURCE` 单测覆盖 |
| 拒绝符号链接源与内部符号链接目标 | PASS | 真实 OS：目录 junction 拖入被拒（`SOURCE_SYMLINK_REJECTED` 通知）；`lstat` 拒绝；Windows junction 测试通过 |
| 拒绝父级 junction 造成的 realpath 越界 | PASS（本轮修复） | `realpath` 复核；新增 junction 逃逸测试 |
| 拒绝目录越界 / 不存在目标 / 非目录目标 | PASS | `path.relative` + `lstat` + `realpath` |
| 无权限 / 复制失败逐文件反馈 | PASS（真实 ACL 拒写 + 通知） | `acl-target` 仅 RX：直接写入被拒、真实拖入无文件、源完整；OCR 捕获“已复制 0 个文件到「acl-target」，1 个失败”“复制失败 (EPERM)” |
| 未保存文档拖出提示 | PASS（修复后，真实 OS + OCR） | 判定机制：`#write` 内编辑事件时间戳 vs 文件 mtime（`> mtime + 1s` 视为脏）；Typora 1.6.7 的 `hasMidified` 运行时恒为 false，不可依赖。实测脏文档告警被 OCR 捕获、保存后与干净文档均不告警；副本为磁盘版本，不自动保存 |
| 拖出使用 Typora 原生 OS 拖拽 | PASS（静态审计） | 节点 dragstart → `ipcRenderer.send("ondragstart", path, icon)`；墨章不重复发送 |
| 拖出目标“必然复制而非移动” | PARTIAL / BLOCKED | Electron `startDrag` 不接收 dropEffect；Explorer 中 Shift 会移动，源端无法强制 |
| 拖出不阻塞原生 IPC | PASS（本轮修复） | dragstart 观察延迟到 `setTimeout(0)`，避免 `lstat` 慢盘拖住系统拖拽 |
| 导入进行中的重叠拖入（busy guard） | PASS（真实 OS + 审计） | 1148 文件批量复制进行中再次拖入 → `INKCHAPTER-FILE-DRAG-IN-DROP` `phase=busy, processing=true, sourcesCount=1`，目标无副本；同时修复了 `internalDragActive` 残留导致 drop 不触发的窗口级失效 |
| 插件重载 / 切换 vault 后不重复安装监听 | PASS（单实例注册表） | `globalThis.__INKCHAPTER_FILE_TREE_DRAG_ADAPTER__`；替换旧实例测试通过 |
| 侧栏展开/折叠/滚动/宽度拖拽/打开文件 | PASS（设计保持） | 不删原生监听、不整体刷新、仅临时高亮类 |
| 候选构建真实加载 | PASS | 测试 vault `runtime-load.json`：`CB604576...`，`loadSource=vault`，`initializationCount=1`，`loadedAt=2026-10-23T22:31:57.809Z`（无调试参数；PID 22476，窗口 HWND 268040） |
| 真实 GUI D01–D12 | PASS | D01–D12 全部 **PASS**；D09 桌面文件夹与桌面根、D11 告警、D12 busy 命中（审计 `phase=busy`）均有真实运行证据；ACL 拒写与失败通知 PASS |
| 真实 OS 拖入复制 | PASS（OS） | `D01-single.md`→`root`、`D05-conflict.md`→`conflict`、批量 2 文件；源保留、SHA 一致 |
| 真实 OS 同名冲突 | PASS（OS） | `D05-conflict (2).md`、`case-note (2).md`（大小写冲突）；原目标未覆盖 |
| 真实 OS 拖出复制 | PASS（OS） | 跨盘 D:→C: 与同盘 D:→D:，源保留、SHA 一致 |
| 真实 OS 内部拖放 | PASS（修复后） | 原生移动（源消失、目标出现），适配器不计数；修复前为复制缺陷 |
| 运行时真实 DOM/适配器探针 | PASS | `attached:true`；`#file-library-tree` 与目标节点存在；真实 `File.getMountFolder()` 正确 |
| 运行时合成 drop（仅集成证据） | PASS（非 OS 拖拽） | 真实渲染器内合成 drop 产生 2 个目标文件，源/目标 SHA 一致；不得当作 D01 真实 PASS |
| 只读目录 GUI 反馈 | PASS（真实 ACL 拒写 + 通知） | `acl-target` 仅 RX：真实拖入后目录为空、源完整；截图 OCR 捕获失败汇总与 `EPERM` 明细 |
| 刷新时滚动/折叠/侧栏宽度视觉变化 | PASS（滚动/宽度）；PARTIAL（文件夹行落点折叠） | 滚轮滚动行位移 58px、窗口 900→700 后拖入成功；文件夹行落点回到折叠属原生悬停态 |

## 调试启动参数与探针纪律

1. **禁止**使用 `--remote-debugging-port`、`--inspect` 等参数启动 Typora。实测主进程抛出 `Error: Not allow debugging this program.`，这是 Typora 的明确限制，不得尝试绕过。
2. 本轮已检索项目 `scripts/`、`src/`、`docs/`、`runtime/` 及提示词：未发现上述参数的持久化用法；唯一一次使用为临时 shell 命令，已停止使用。
3. DevTools 探针仅在 **Console 已打开且输入焦点已确认** 时允许粘贴；无法确认时禁止粘贴，避免污染 Markdown 正文。
4. Runtime 验收优先使用：文件系统结果、Typora 日志、插件审计日志（`test/vault/.typora/inkchapter/audit/*.log`）、`runtime-load.json`、真实 OS 拖拽结果。远程调试不是必需条件。

## 系统权限与接口结论

1. 插件运行在 Typora 渲染进程，可直接使用 Node `fs` / `path`；文件复制能力**不需要**主进程权限。
2. 拖出使用 Typora 已存在的原生 IPC 通道，插件**不访问、不伪造**主进程 `webContents.startDrag`。
3. 源端无法强制 Explorer 的 copy/move 语义；这是 Electron/Windows 的接口边界，不是插件缺陷。
4. 当前候选构建已在测试 vault 正常启动并真实加载（`CB604576...`，`loadedAt=2026-10-23T22:31:57.809Z`，`initializationCount=1`）；真实 OS 主链路已实测 PASS，未执行项明确标记 NOT_RUN/PARTIAL。
5. **窗口级拖拽状态异常（已修复）**：`internalDragActive` 残留会使外部 `dragover` 不再 `preventDefault`，导致 `drop` 完全不触发（拖入无反应、busy 提示缺失）。已增加 `mouseup` / 失焦 / `visibilitychange` 兜底清理与 15 s TTL，并新增拖入决策审计 `INKCHAPTER-FILE-DRAG-IN-DROP`。
