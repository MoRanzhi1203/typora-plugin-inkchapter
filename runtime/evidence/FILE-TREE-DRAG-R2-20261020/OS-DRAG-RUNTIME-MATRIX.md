# 文件树 ↔ Windows 资源管理器拖拽 R2 — D01–D12 运行矩阵

日期：2026-10-20
真实 GUI 结论：**PASS（主链路）/ PARTIAL（少数未执行项）**

## 0. 运行身份（最终）

| 项目 | 值 |
|---|---|
| Typora PID / HWND | 22476（D12 修复后新窗口 268040）；此前 595916 / 13177692 已最小化，保留各自未保存缓冲区 |
| 打开路径 | `D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault` |
| 启动命令 | `"D:\Typora\Typora.exe" <test vault>`（无调试参数） |
| 当前加载来源 | vault |
| 当前加载 SHA256 | `CB60457608E65901A037105B3712EA2771938F036AA7BDD5900220AE6150D63E` |
| loadedAt | 2026-10-23T22:31:57.809Z（D12 busy 修复后的复验窗口） |
| initializationCount | 1 |
| 上一候选（D07 修复后，完成 D06/D09/ACL 实测） | `420B9E4C5181E7A5532BE082BCFEF1A131A3BA86FAAFF08C036AF9B018EE6961` |
| 更早候选（已完成 D01/D05/拖出/悬停实测） | `DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A` |
| 适配器 invariant（19:24 拖拽实例） | `attached=true, processing=false, externalDropCount=2, copiedCount=3, failedCount=0, internalDragActive=false` |

> 结论：构建、部署、加载 SHA 三者一致；`RUNTIME_IDENTITY = LOADED / PASS`。

## 0.1 测量工具校正（重要）

早期两次落点偏移的根因不是产品缺陷，而是测量工具：

- PowerShell 进程默认 DPI-unaware，`SetCursorPos` / UIA 坐标被系统按 125% 虚拟化（×1.25）；
- 文件树处于折叠状态时旧坐标失效；
- 修正：所有脚本调用 `SetThreadDpiAwarenessContext(-4)`，并用真实 DevTools 控制台读取 `getBoundingClientRect()`（CSS px，dpr=1.25，页面原点物理 `9,63`）换算落点。
- **探针纪律**：DevTools 仅在 Console 已打开且输入焦点已确认时允许粘贴；未确认时禁止粘贴。禁止使用 `--remote-debugging-port` / `--inspect` 启动 Typora（主进程会报 `Not allow debugging this program.`）。Runtime 验收优先使用文件系统、Typora 日志、插件审计日志与真实 OS 拖拽结果。

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
| D06 | `.txt` / 目录 / 符号链接 | **PASS** | OS：`.txt` 拒绝；目录 → 通知“源路径不是普通文件”；junction → 通知“不支持符号链接”；两次均无副本、源完整（`COPY-INTEGRITY.md` §7.4） |
| D07 | 文件树内部拖放 | **PASS（修复后）** | 修复前为复制缺陷；修复后 `internal-a.md` 原生移动到 `root`，adapter 计数 0 |
| D08 | Explorer `.md` → 编辑器正文 | **PASS** | OS：Typora 原生打开文件，无复制、adapter 计数不变；触发框架 vault 切换（见 §3） |
| D09 | 文件夹悬停自动展开 | **PASS** | DOM 采样：309 ms `ty-on-drag-enter`；907 ms `file-node-expanded`；离开后 6018 ms 折叠 |
| D09b | 文件树 → Windows 桌面 | **PASS（桌面文件夹 + 桌面根）** | OS：`Figure-Standalone-Block-Invariant-Test.md` → 桌面文件夹，1328 B，SHA `52BB2189...`；`Generic-Locator-Runtime-Test.md` → 桌面根（kdesk64 PID 14956 接收），398 B，SHA `7F4E6B3B...`；两者源文件保留，测试副本已删除 |
| D10 | 文件树 → Explorer 另一目录（跨盘 D:→C:） | **PASS** | OS：`internal-b.md` 18 B → `sources`；源保留 |
| D10b | 同盘 D:→D: | **PASS** | OS：`root\D01-single.md` → `expanded\D01-single.md`，双方 SHA `75C9FB6C...`，源保留 |
| D11 | 未保存 Markdown 拖出告警 | **PASS（修复后）** | OS + 审计 + OCR：脏文档拖出 → `modified:true / warning:WARN`（`editedAt=21:29:17.709Z` vs `fileMtime=21:17:01.030Z`）；OCR 捕获“墨章：当前文档有未保存修改…请先保存（Ctrl+S）”；副本为磁盘版本；`Ctrl+S` 后与干净文档均 `warning:NONE`；审计 `runtime-sess-1792790938027.log` |
| D12 | 快速重复 / Esc / 拖出窗口 / busy guard | **PASS（修复后）** | OS + 审计：Esc 与拖出窗口 PASS；1148 个 `.md` 真实批量拖入进行中（`started` 审计，0.4 s 内已复制 21 个），再拖 `D05-conflict.md` → 审计 `{"phase":"busy","processing":true,"sourcesCount":1}`，目标无副本；`runtime-sess-1792794717701.log` |
| ACL | 只读目标目录 | **PASS（拒写 + 通知）** | ACL 仅 RX；直接写入被拒；真实拖入 `D05-conflict.md` → 无文件、源完整；截图 OCR 捕获“已复制 0 个文件到「acl-target」，1 个失败”与“复制失败 (EPERM)” |

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

## 2.1 修复记录（D11 未保存告警）

- 现象：未保存文档拖出时磁盘版本副本正确，但“当前文档有未保存修改”告警在真实拖拽中始终不出现。
- 排查结论：Typora 1.6.7 在 Windows 上 `File.bundle.hasMidified` 运行时恒为 `false`；`File.getContent()` 返回 Promise 且内容与 `savedContent` 相同；`@electron/remote` 不可用；标签页无 modified 类名。上述原生脏标记不可依赖。
- 修复：
  1. `dragstart` 目标改为 `closest('.file-library-node[data-path]')`，覆盖真实 Typora 从标题文本/图标等后代节点发起拖拽的情况（此前只匹配 `.file-node-content`，观察被整体跳过）；
  2. 在 `#write` 内监听 `input/paste/cut/drop/compositionend/keydown` 记录 `lastEditAt`；
  3. 拖出时 `lastEditAt > 文件 mtime + 1s` 判定为未保存；`Ctrl+S` 推进 mtime 后自动恢复为干净；
  4. `FileCopyService` 不重构，仍复制磁盘版本并明确提示不自动保存。
- 验证：脏文档 `editedAt=21:29:17.709Z` / `fileMtime=21:17:01.030Z` → `modified:true / warning:WARN`，OCR 捕获告警；保存后与干净文档均 `warning:NONE`。定向 38/38、全量 245 文件 / 4597 用例 PASS。

## 2.2 修复记录（D12 busy guard 无法命中/无法取证）

- 现象：复制进行中再次拖入时既没有副本、也没有“上一批文件仍在导入”提示；随后同一窗口的所有外部拖入都静默失效（Explorer→Explorer 拖拽仍正常）。
- 根因：`internalDragActive` 只在 `drop`/`dragend`/`dragleave(relatedTarget=null)` 清理。真实 Typora 从树内发起拖拽并在窗口外结束时可能三者都不触发，标记残留后 `isExternalTreeDrag()` 恒为 false → `dragover` 不再 `preventDefault` → 浏览器直接拒绝 `drop`，`onDrop`（含 busy 分支）根本没有执行机会。
- 修复：
  1. `mouseup`（捕获）、`visibilitychange(hidden)`、`window blur` 兜底清除内部拖拽标记；
  2. 内部标记增加 15 s TTL，超时自愈；
  3. `onDrop` 增加决策审计 `INKCHAPTER-FILE-DRAG-IN-DROP`（`internal/busy/invalid-target/no-sources/started`、`processing`、`sourcesCount`、`targetDirectory`），使 busy 命中可离线核验，不再依赖瞬时通知。
- 验证：TypeScript PASS；定向 40/40；全量 245 文件 / 4599 用例 PASS；构建 `CB604576...` 部署后，真实 OS 重叠拖拽产生审计 `{"phase":"busy","processing":true,"sourcesCount":1}`。

## 3. 原生/框架行为（非缺陷）

- 拖入编辑器正文会让 Typora 把外部文档目录当作 vault，vault 级插件被卸载、文件树切换到该目录（框架作用域行为）；重启或打开 vault 内文档后恢复。
- 文件夹行落点后的折叠：悬停展开态的清理；子文件行落点保持展开。

## 4. 明确结论

- 真实 OS 拖入：D01/D02/D03/D04/D05 **PASS**；D06 **PASS**（`.txt`、目录、junction 均被拒且无副本）。
- 真实 OS 拖出：D10 跨盘 **PASS**、同盘 **PASS**；D09b 桌面文件夹与**桌面根**均 **PASS**（桌面根由 kdesk64 接收）。
- 真实 OS 内部拖放：**PASS（修复后）**。
- 未保存拖出：磁盘版本副本 **PASS**，告警通知 **PASS（修复后，OCR 实拍）**；只读 ACL 拒写与失败通知 **PASS（EPERM）**。
- 悬停展开、滚动、宽度变化、监听器生命周期：**PASS**。
- D12 重叠：真实 1148 文件批量复制进行中，第二次拖入命中 busy 分支（审计 `phase=busy, processing=true, sourcesCount=1`），目标无副本 → **PASS（修复后）**。

## 5. 本轮运行环境异常与恢复

- 现象：一次误定位拖拽从文件树节点发起（审计 `INKCHAPTER-FILE-DRAG-OUT-INSPECT`，`runtime/Document-Diagnostics-Trailing-Blank-0.md`），随后旧窗口（13177692）对 Explorer 外部拖入不再复制，也不显示 busy/目标错误通知；同一时刻 Explorer→Explorer 拖拽仍正常。
- 处置：**未关闭含未保存缓冲区的旧窗口**，改为用同一 vault 打开新窗口（595916，`loadedAt=2026-10-23T22:08:31.346Z`，构建 SHA 不变）继续验收；新窗口拖入/拖出/ACL 均正常。
- 数据完整性：误拖导致 `test/vault/runtime/Document-Diagnostics-Trailing-Blank-0.md` 从工作区消失；已用 Git 恢复为 39 B 跟踪夹具（非用户文件）。旧窗口该标签显示未保存标记，未执行保存。
- 结论：该现象属于**运行时窗口级状态异常**，`internalDragActive` 残留使外部 `dragover` 不再 `preventDefault`，`drop` 完全不会触发。已在 §2.2 修复（mouseup / 失焦 / visibilitychange 兜底 + 15 s TTL + 拖入决策审计），并在新构建 `CB604576...` 上复验通过。
