# 文件树 ↔ Windows 资源管理器拖拽 R2 — D01–D12 运行矩阵

日期：2026-10-20
真实 GUI 结论：**PASS（主链路）/ PARTIAL（少数未执行项）**

## 0. 运行身份（最终）

| 项目 | 值 |
|---|---|
| Typora PID / HWND | 31320 / 789980 |
| 打开路径 | `D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault` |
| 当前加载来源 | vault |
| 当前加载 SHA256 | `420B9E4C5181E7A5532BE082BCFEF1A131A3BA86FAAFF08C036AF9B018EE6961` |
| loadedAt | 2026-10-20T11:24:20.253Z |
| 上一候选（已完成 D01/D05/拖出/悬停实测） | `DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A` |
| 适配器 invariant | `attached=true, processing=false, externalDropCount=2, copiedCount=3, failedCount=0, internalDragActive=false` |

> 结论：构建、部署、加载 SHA 三者一致；`RUNTIME_IDENTITY = LOADED / PASS`。

## 0.1 测量工具校正（重要）

早期两次落点偏移的根因不是产品缺陷，而是测量工具：

- PowerShell 进程默认 DPI-unaware，`SetCursorPos` / UIA 坐标被系统按 125% 虚拟化（×1.25）；
- 文件树处于折叠状态时旧坐标失效；
- 修正：所有脚本调用 `SetThreadDpiAwarenessContext(-4)`，并用真实 DevTools 控制台读取 `getBoundingClientRect()`（CSS px，dpr=1.25，页面原点物理 `9,63`）换算落点。

## 1. D01–D12 矩阵（真实 OS 鼠标拖拽）

证据分级：
- **OS**：Win32 `SendInput` 绝对坐标真实鼠标按下/移动/释放；
- **DOM**：真实 Typora 渲染器 DevTools 控制台读数（仅用于测量/核验，不合成 Drop）；
- **UNIT**：vitest；**SVC**：真实文件系统服务测试。

| ID | 真实动作 | 结果 | 证据 |
|---|---|---|---|
| D01 | Explorer 单个 `.md` → 文件树 `root` | **PASS** | OS + DOM：`root\D01-single.md` 18 B，SHA `75C9FB6C...`；源仍在；展开后节点可见；adapter 计数 1 |
| D02 | 拖入已展开子文件夹 | **PASS** | OS + DOM：3 次拖入已展开 `internal` → `D04-batch-a.md`、`(2)`、`(3)`；源保留 |
| D03 | 拖入未展开子文件夹 | **PASS** | OS：`root` 折叠时接收 D01；`unexpanded` 接收 `empty.md` 后首次展开可见 |
| D04 | 多文件批量 `.md`/`.markdown` | **PASS** | OS：一次 drop 携带 `crlf.md` + `case-note.md` → 两个副本，SHA 分别 `4AD3EF...`、`516EA8...` |
| D05 | 同名重复拖入 | **PASS** | OS：`D05-conflict (2).md` 15 B，SHA `BE6039...`；预置目标未被覆盖；源仍在 |
| D06 | `.txt` / 目录 / 符号链接 | **PARTIAL** | OS：`.txt` 真实拖入被拒（failed=1，无副本）；目录/符号链接 **UNIT only / NOT_RUN 真机** |
| D07 | 文件树内部拖放 | **PASS（修复后）** | 修复前为复制缺陷；修复后 `internal-a.md` 原生移动到 `root`，adapter 计数 0 |
| D08 | Explorer `.md` → 编辑器正文 | **PASS** | OS：Typora 原生打开文件，无复制、adapter 计数不变；触发框架 vault 切换（见 §3） |
| D09 | 文件夹悬停自动展开 | **PASS** | DOM 采样：309 ms `ty-on-drag-enter`；907 ms `file-node-expanded`；离开后 6018 ms 折叠 |
| D09b | 文件树 → Windows 桌面 | **NOT_RUN** | 未构造可见桌面落点 |
| D10 | 文件树 → Explorer 另一目录（跨盘 D:→C:） | **PASS** | OS：`internal-b.md` 18 B → `sources`；源保留 |
| D10b | 同盘 D:→D: | **PASS** | OS：`root\D01-single.md` → `expanded\D01-single.md`，双方 SHA `75C9FB6C...`，源保留 |
| D11 | 未保存 Markdown 拖出告警 | **NOT_RUN** | 需人工未保存态；`UNIT` 覆盖告警判定 |
| D12 | 快速重复 / Esc / 拖出窗口 | **PARTIAL** | OS：Esc 真实取消（无复制、计数不变）；拖出窗口后外部拖入恢复；重叠 busy guard `UNIT only` |

补充真实回归：

| 项目 | 结果 |
|---|---|
| 侧栏滚轮滚动 | PASS（行 top 194→252 CSS，adapter 仍 attached） |
| 窗口宽度 900→700 | PASS（adapter 仍 attached，拖入 `expanded` 成功，SHA `80381751...`） |
| 监听器生命周期 | PASS（每次 drop 计数 +1，无重复；重启从 0 开始；单实例注册表 `UNIT`） |
| 刷新可见性 | PASS（复制后节点出现在 DOM 且展开后有真实布局；文件夹行落点可能回到折叠，属原生悬停态） |

## 2. 修复记录（D07）

- 现象：内部拖放被当作外部导入复制（源与目标同时存在）。
- 根因：内部/外部拖拽的 `dataTransfer.types` 均为 `["Files"]`，无法按类型区分。
- 修复：`internalDragActive` 记录 dragstart 来源；内部 drop 完全放行原生移动；`dragend` / `dragleave(relatedTarget=null)` / 新 dragstart 清除。
- 验证：`UNIT` 3 个新用例 + 定向 16/16；真实 OS 复验（移动、外部拖入、拖出、拖出后再拖入）。

## 3. 原生/框架行为（非缺陷）

- 拖入编辑器正文会让 Typora 把外部文档目录当作 vault，vault 级插件被卸载、文件树切换到该目录（框架作用域行为）；重启或打开 vault 内文档后恢复。
- 文件夹行落点后的折叠：悬停展开态的清理；子文件行落点保持展开。

## 4. 明确结论

- 真实 OS 拖入：D01/D02/D03/D04/D05 **PASS**；D06 `.txt` **PASS**（目录/符号链接 NOT_RUN）。
- 真实 OS 拖出：D10 跨盘 **PASS**、同盘 **PASS**；桌面 NOT_RUN。
- 真实 OS 内部拖放：**PASS（修复后）**。
- 悬停展开、滚动、宽度变化、监听器生命周期：**PASS**。
- 未执行项明确标记 **NOT_RUN**；未以合成事件或服务测试冒充真实 GUI PASS。
