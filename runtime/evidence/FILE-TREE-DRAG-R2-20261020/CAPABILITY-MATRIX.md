# 文件树 ↔ Windows 资源管理器拖拽 R2 — 能力矩阵

日期：2026-10-20
工程：`D:\TyporaPluginProjects\typora-plugin-inkchapter`
HEAD：`f976ff844c3a75019484e8ab1fc7df62a64e7655`
本轮候选构建：`DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A`

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
| 拒绝 `.txt` / 目录 / 无效路径 | PASS | `UNSUPPORTED_EXTENSION` / `SOURCE_NOT_FILE` / `INVALID_SOURCE` |
| 拒绝符号链接源与内部符号链接目标 | PASS | `lstat` 拒绝；Windows junction 测试通过 |
| 拒绝父级 junction 造成的 realpath 越界 | PASS（本轮修复） | `realpath` 复核；新增 junction 逃逸测试 |
| 拒绝目录越界 / 不存在目标 / 非目录目标 | PASS | `path.relative` + `lstat` + `realpath` |
| 无权限 / 复制失败逐文件反馈 | PASS（错误路径） | `EACCES` / `COPY_FAILED` 被捕获并提示；真实只读 ACL 未单独构造 |
| 未保存文档拖出提示 | PASS（逻辑） | `File.bundle.hasMidified` + 同路径判断；不自动保存 |
| 拖出使用 Typora 原生 OS 拖拽 | PASS（静态审计） | 节点 dragstart → `ipcRenderer.send("ondragstart", path, icon)`；墨章不重复发送 |
| 拖出目标“必然复制而非移动” | PARTIAL / BLOCKED | Electron `startDrag` 不接收 dropEffect；Explorer 中 Shift 会移动，源端无法强制 |
| 拖出不阻塞原生 IPC | PASS（本轮修复） | dragstart 观察延迟到 `setTimeout(0)`，避免 `lstat` 慢盘拖住系统拖拽 |
| 插件重载 / 切换 vault 后不重复安装监听 | PASS（单实例注册表） | `globalThis.__INKCHAPTER_FILE_TREE_DRAG_ADAPTER__`；替换旧实例测试通过 |
| 侧栏展开/折叠/滚动/宽度拖拽/打开文件 | PASS（设计保持） | 不删原生监听、不整体刷新、仅临时高亮类 |
| 候选构建真实加载 | PASS | 测试 vault `runtime-load.json`：`DD4F6646...`，`loadSource=vault`，2026-10-20T09:29:20Z |
| 真实 GUI D01–D12 | PARTIAL | D01/D05/D10 **PASS（OS-automated）**；其余仍 PENDING_USER_MANUAL |
| 真实 OS 拖入复制 | PASS（OS-automated） | `中文 空格.md` → vault 根，源/目标 SHA 一致，源仍存在 |
| 真实 OS 同名冲突 | PASS（OS-automated） | 第二次拖入生成 `中文 空格 (2).md`，原目标未覆盖 |
| 真实 OS 拖出复制 | PASS（OS-automated） | `Figure-...md` → Explorer，源仍存在，SHA 一致 |
| 运行时真实 DOM/适配器探针 | PASS | `attached:true`；`#file-library-tree` 与目标节点存在；真实 `File.getMountFolder()` 正确 |
| 运行时合成 drop（仅集成证据） | PASS（非 OS 拖拽） | 真实渲染器内合成 drop 产生 2 个目标文件，源/目标 SHA 一致；不得当作 D01 真实 PASS |
| 只读目录 GUI 反馈 | NOT_RUN | 需真实 ACL 环境与 GUI 操作 |
| 刷新时滚动/折叠/侧栏宽度视觉变化 | PENDING_USER_MANUAL | 需真实 GUI 观察 |

## 系统权限与接口结论

1. 插件运行在 Typora 渲染进程，可直接使用 Node `fs` / `path`；文件复制能力**不需要**主进程权限。
2. 拖出使用 Typora 已存在的原生 IPC 通道，插件**不访问、不伪造**主进程 `webContents.startDrag`。
3. 源端无法强制 Explorer 的 copy/move 语义；这是 Electron/Windows 的接口边界，不是插件缺陷。
4. 当前候选构建已在测试 vault 真实加载（`DD4F6646...`），但真实 OS 鼠标拖拽 D01–D12 尚未完整人工确认，因此不能把自动化结果写成真实 GUI PASS。
