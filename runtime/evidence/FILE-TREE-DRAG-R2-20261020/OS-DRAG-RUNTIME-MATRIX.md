# 文件树 ↔ Windows 资源管理器拖拽 R2 — D01–D12 运行矩阵

日期：2026-10-20
真实 GUI 结论：**PENDING_USER_MANUAL**
原因：候选构建已真实加载；自动化鼠标拖拽无法稳定复现完整 D01–D12（窗口/坐标/前台限制），需人工逐项确认。

## 0. 当前运行身份

| 项目 | 值 |
|---|---|
| Typora PID | 10148 |
| HWND | 9441978 |
| 窗口标题 | 测试 vault 文档（启动后恢复 `critique_republican_masters_059 (1).md`） |
| 当前加载来源 | vault |
| 当前加载 SHA256 | `DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A` |
| 当前加载时间 | 2026-10-20T09:29:20.613Z |
| 候选构建 SHA256 | `DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A` |
| 候选构建状态 | **已加载（vault）** |
| 旧测试 vault runtime-load | `B68D5041...`，2026-10-17T18:22:10.592Z（已被覆盖） |

> 结论：`RUNTIME_IDENTITY = LOADED / PASS`。构建、部署、加载 SHA 三者一致。

## 0.1 运行时 DOM / 适配器探针

| 探针 | 结果 |
|---|---|
| `#file-library-tree` | 存在 |
| `File.getMountFolder()` | `D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault` |
| `window.__INKCHAPTER_FILE_TREE_DRAG_ADAPTER__.current.getInvariant()` | `attached=true, processing=false, externalDropCount=2, copiedCount=2, failedCount=0` |
| 真实 DOM 目标节点 | `file-tree-drag-r2` + `conflict/expanded/internal/root/unexpanded` 均存在 |
| 运行时合成 drop（集成证据，非 OS 拖拽） | 观察到 `root\D01-single.md` 与 `root\D01-single (2).md`，源/目标 SHA 均为 `75C9FB6C...`，源仍存在；至少一次由合成 drop 驱动，不能全部归因于合成事件；随后已清理测试目标 |
| 真实拖出复制观察 | `Figure-Standalone-Block-Invariant-Test.md` 被复制到 Explorer 的 `sources` 文件夹；原文件仍在，双方 SHA 均为 `52BB2189...`（17:49:15 创建） |

> 合成 drop 仅用于验证真实渲染器内的适配器/复制服务链路，**不冒充** D01 真实 OS 拖拽 PASS。

## 1. D01–D12 矩阵

| ID | 真实动作 | 自动化等价证据 | 真实 GUI 结果 | 说明 |
|---|---|---|---|---|
| D01 | Explorer 单个 `.md` 拖入文件树根部 | 真实 OS 拖入 `中文 空格.md` → vault 根；源/目标 SHA 均为 `4AE27530...`，源仍存在；证据已移入 `os-drag-artifacts/os-dragin-中文 空格.md` | **PASS（OS-automated）** | 输入来源为 Win32 `mouse_event`，非合成 DragEvent；建议人工复验一次 |
| D02 | 拖入已展开子文件夹 | 适配器测试：目录节点路径解析 + `onChangeForWin` 刷新调用 | **NOT_RUN / PENDING_USER_MANUAL** | 需真实树节点与视觉确认 |
| D03 | 拖入未展开子文件夹 | 适配器测试：未展开目录仍按 `data-path` 解析；不做整体重绘 | **NOT_RUN / PENDING_USER_MANUAL** | 需首次展开可见性确认 |
| D04 | 同时拖入多个 `.md` / `.markdown` | 批量测试：2 个文件分别复制、无源删除 | **NOT_RUN / PENDING_USER_MANUAL** | 需真实多文件拖拽 |
| D05 | 同名文件重复拖入 | 真实 OS 拖入两次 `中文 空格.md` → 生成 `中文 空格.md` + `中文 空格 (2).md`；原目标未被覆盖，源仍存在 | **PASS（OS-automated）** | 证据：`os-drag-artifacts/os-dragin-中文 空格*.md` |
| D06 | `.txt`、目录、符号链接、无效来源 | 单测：`UNSUPPORTED_EXTENSION` / `SOURCE_NOT_FILE` / `SOURCE_SYMLINK_REJECTED`；目标内部 junction 拒绝 | **NOT_RUN / PENDING_USER_MANUAL** | 需 Explorer 真实拖入 |
| D07 | 文件树内部拖放 | 适配器测试：`types=['file','text/plain']` 不拦截，原生 handler 继续执行 | **NOT_RUN / PENDING_USER_MANUAL** | 真实内部拖拽可能移动文件，必须用测试样本 |
| D08 | Explorer `.md` 拖入编辑器正文 | 适配器测试：`#write` 目标不拦截、不复制、不 `preventDefault` | **NOT_RUN / PENDING_USER_MANUAL** | 需真实编辑器拖放 |
| D09 | 文件树 `.md` 拖出至 Windows 桌面 | 静态审计：节点 dragstart → 原生 `ondragstart` IPC；墨章只观察 | **NOT_RUN / PENDING_USER_MANUAL** | 需人工拖拽并核对桌面文件 |
| D10 | 文件树 `.md` 拖出至资源管理器另一目录 | 真实拖出复制：`Figure-Standalone-Block-Invariant-Test.md` → Explorer `sources`，源仍存在，SHA 均为 `52BB2189...`；证据 `os-drag-artifacts/os-dragout-Figure-Standalone-Block-Invariant-Test.md` | **PASS（OS-automated）** | 跨盘 D: → C:；输入来源为 Win32 `mouse_event` |
| D11 | 打开且未保存的 Markdown 向外拖出 | 单测：`shouldWarnStaleDragOut` 与 bridge 告警文案 | **NOT_RUN / PENDING_USER_MANUAL** | 不得自动保存；需真实未保存态 |
| D12 | 快速重复拖入、取消、Esc、拖拽离开窗口 | 单测：busy guard、dragleave 清理、dispose 清理、单实例注册表 | **NOT_RUN / PENDING_USER_MANUAL** | 需真实事件时序 |

## 2. 补充必测项

| 项目 | 自动化结果 | 真实 GUI |
|---|---|---|
| 中文文件名 + 空格 | PASS（真实 fs，SHA 一致） | **PASS（OS-automated）**：`中文 空格.md` |
| CRLF 字节原样复制 | PASS（真实 fs，SHA 一致） | NOT_RUN |
| 0 字节 Markdown | PASS（真实 fs，0 字节） | **PASS（OS-automated）**：`os-dragin-empty.md` |
| 同名大小写差异 | PASS（Windows 冲突重命名） | NOT_RUN |
| 源/目标 realpath 越界（父级 junction） | PASS（拒绝，目标未写入） | NOT_RUN |
| 只读目录 | 错误路径已实现；真实 ACL 未构造 | NOT_RUN |
| 刷新时滚动/折叠/侧栏宽度 | 代码不整体重绘 | PENDING_USER_MANUAL |
| 重启/切换 vault 监听器不重复 | 单实例注册表测试通过 | PENDING_USER_MANUAL |

## 3. 真实 GUI 收据模板（人工执行时填写）

每条必须记录：

```
ID:
PID / HWND:
文档或 vault:
加载 mainJsSha256:
源路径:
目标路径:
拖拽前源存在: Y/N
拖拽后源存在: Y/N
源长度 / SHA256:
目标长度 / SHA256:
源是否变化: Y/N
DragEvent: types= / dropEffect= / defaultPrevented= / stopPropagation=
复制服务结果: copied / skipped / failed / renamed
刷新状态: 新节点可见 / 首次展开可见 / 无重复
结论: PASS / FAIL / NOT_RUN
```

## 4. 已准备的人工测试样本

源目录（临时，不涉及用户重要文档）：

```
C:\Users\MSIPC\AppData\Local\Temp\inkchapter-drag-r2\sources
  D01-single.md
  D04-batch-a.md
  D04-batch-b.markdown
  D05-conflict.md
  中文 空格.md
  case-note.md
  D06-ignored.txt
  empty.md
  crlf.md
```

测试 vault 目标目录：

```
D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\墨章插件测试\file-tree-drag-r2
  root
  expanded
  unexpanded
  conflict     (预置 D05-conflict.md 与 case-note.MD)
  internal     (内部拖放样本)
```

拖出目标目录（跨盘，D: → C:）：

```
C:\Users\MSIPC\AppData\Local\Temp\inkchapter-drag-r2\out-desktop-like
C:\Users\MSIPC\AppData\Local\Temp\inkchapter-drag-r2\out-explorer
```

## 5. 明确结论

- 自动化等价证据：**PASS**（不冒充真实 OS 拖拽）。
- 运行时合成 drop：**PASS 作为集成证据**（真实渲染器/真实 fs），不计为 D01 真实 OS PASS。
- 真实 OS 拖入（OS-automated）：D01 **PASS**、D05 **PASS**；中文/空格与 0 字节补充项 **PASS**。
- 真实 OS 拖出（OS-automated）：D10 **PASS**（跨盘复制，源保持、SHA 一致）。
- 其余 D02/D03/D04/D06/D07/D08/D09/D11/D12：**仍为 PENDING_USER_MANUAL**。
- 未发现“测试通过即真实运行通过”的虚假声明；也未把 OS 自动化输入冒充人工鼠标。
