# 文件树 ↔ Windows 资源管理器拖拽 R2 — 最终报告（真实运行闭环）

日期：2026-10-20
工程：`D:\TyporaPluginProjects\typora-plugin-inkchapter`
最终候选构建：`CB60457608E65901A037105B3712EA2771938F036AA7BDD5900220AE6150D63E`（D12 busy 修复后）
上一候选构建：`1ABFB941E857F12166FAFA3764CBD6F7B9E19AC97B10AD7D049B24EA3FD5F746`（D11 告警修复后）
更早候选构建：`DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A`（D01/D05/拖出与 D07 缺陷均在此构建上实测）

## 1. 总体结论

**真实 OS 拖拽主链路：PASS（含同轮缺陷修复与复验）**

| 类别 | 结论 |
|---|---|
| 构建 / 部署 / 加载身份 | PASS（最终 `1ABFB941...`，`loadSource=vault`，adapter `attached=true`） |
| 真实 OS 拖入（Explorer → 文件树） | PASS：D01、D02、D03、D04、D05、D06（`.txt`/目录/junction） |
| 真实 OS 拖出（文件树 → Explorer） | PASS：D10 跨盘（D:→C:）与同盘（D:→D:），源保留、SHA 一致 |
| 悬停自动展开 / 侧栏滚动 / 窗口宽度变化 | PASS |
| 监听器生命周期 / 单次处理 | PASS（每次 drop 计数 +1，无重复；重启从 0 开始） |
| D07 树内拖放 | 发现真实缺陷 → 已修复 → 复验 PASS |
| D08 编辑器正文拖放 | PASS（不拦截、不复制；Typora 原生打开文件） |
| D09 桌面拖出 / D11 未保存告警 / D12 快速重叠 | D09 桌面文件夹与桌面根 **PASS**；D11 **PASS（修复后）**；D12 **PASS（修复后，审计确认 busy 命中）** |
| 合成事件 / 服务测试 | 仅作为补充证据，**未用于**宣布真实 GUI PASS |

未覆盖、移动或删除任何用户正式文件；未修改 Typora 本体、app.asar 或社区框架源码；未执行 Git commit。

## 2. 运行身份（最终恢复实例）

| 项目 | 值 |
|---|---|
| Typora PID / HWND | 22476 / 268040（2026-10-24 06:31 D12 修复后窗口；此前 595916、13177692 最小化保留） |
| 启动命令 | `"D:\Typora\Typora.exe" <test vault>`（无任何调试参数） |
| 打开路径 | `...\test\vault` |
| 加载 SHA256 | `CB60457608E65901A037105B3712EA2771938F036AA7BDD5900220AE6150D63E` |
| loadedAt | 2026-10-23T22:31:57.809Z |
| loadSource | vault |
| initializationCount | 1 |
| 插件审计会话 | `runtime-sess-1792794717701.log` |
| 窗口标题 | `Typora`（无未保存标记） |
| 备注 | D11 修复验证在 05:27 实例完成；D09/ACL 复测在 595916（`1ABFB941...`）完成；D12 busy 修复后构建 `CB604576...`，由新窗口 268040 完成真实重叠复验 |

> 说明：原候选 `DD4F...` 在 18:50 / 19:10 两次真实加载并完成 D01/D05/拖出/批量/悬停等实测；D07 缺陷修复后重新构建为 `420B9E4C...`；D11 告警修复后构建 `1ABFB941...`；D12 busy/状态残留修复后构建 `CB604576...`，均由新窗口加载并完成对应复验。

## 3. 三个优先真实鼠标操作（DD4F 构建实测，Win32 `SendInput` 绝对坐标）

| 项 | 源 | 目标 | 结果 |
|---|---|---|---|
| D01 | `%TEMP%\inkchapter-drag-r2\sources\D01-single.md` | `file-tree-drag-r2\root` | 目标 18 B，SHA `75C9FB6C8B192904B94E24F191772F6917136DFCB0559CFC8F96F1E55917D2CD`，18:59:37 创建；源仍在；展开 root 后节点可见（真实树刷新） |
| D05 | `sources\D05-conflict.md` | `file-tree-drag-r2\conflict`（已有同名） | 生成 `D05-conflict (2).md` 15 B，SHA `BE60390DD684E7D12529A5EAFBD34897F139EEFFDFCEDF3094CEB4C5F6174579`，19:04:25；预置 `D05-conflict.md` 未被覆盖（21 B，`F9B558...`）；源仍在；展开 conflict 后新节点有真实布局（CSS 194–222） |
| 拖出 | 树内 `conflict\D05-conflict (2).md` | Explorer `sources`（C:） | `sources\D05-conflict (2).md` 15 B，SHA `BE6039...`；树内源仍在；适配器计数不变（未拦截原生拖出） |

> 早期两次落点偏移已定位为**测量工具 DPI 虚拟化**（进程未声明 Per-Monitor，坐标被 ×1.25）与**树折叠状态**导致，非产品缺陷；后续全部使用 DPI 感知坐标 + 真实 DOM rect 校正。

## 4. D01–D12 运行结果

| ID | 真实动作 | 结果 | 证据 |
|---|---|---|---|
| D01 | 单个 `.md` → 根/`root` | **PASS** | §3；适配器计数 1 |
| D02 | 拖入已展开子文件夹 | **PASS** | 3 次拖入已展开 `internal`（19:12/19:13/19:14），生成 `D04-batch-a.md`、`(2)`、`(3)`；源保留 |
| D03 | 拖入未展开子文件夹 | **PASS** | 首次 D01 时 `root` 为折叠；`unexpanded` 接收 0 字节 `empty.md` 后首次展开可见 |
| D04 | 多文件批量 | **PASS** | 一次 drop 携带 `crlf.md` + `case-note.md` → `crlf.md`（14 B，`4AD3EF...`）与 `case-note (2).md`（18 B，`516EA8...`），源均保留 |
| D05 | 同名重复拖入 | **PASS** | §3；大小写冲突 `case-note.MD` ↔ `case-note.md` 亦自动改名 |
| D06 | `.txt` / 目录 / 符号链接 | **PASS** | OS：`.txt` 被拒；目录 `folder-source` 拖入 → 通知“源路径不是普通文件”，vault 无副本；目录 junction `junction-dir` 拖入 → 通知“不支持符号链接”，vault 无副本；源均完整（见 `COPY-INTEGRITY.md` §7.4） |
| D07 | 文件树内部拖放 | **缺陷→已修复→PASS** | 见 §5；修复后 `internal-a.md` 原生移动到 `root`，适配器计数 0 |
| D08 | `.md` 拖到编辑器正文 | **PASS** | 原生打开 `D04-batch-a.md`，未复制、适配器计数不变；同时触发框架按外部文档切换 vault（见 §6） |
| D09 | 文件夹悬停自动展开 | **PASS** | 悬停折叠 `internal`：309 ms `ty-on-drag-enter`，907 ms `file-node-expanded`，离开后 6018 ms 自动折叠 |
| D09b | 拖出到桌面 | **PASS（桌面文件夹 + 桌面根）** | OS：`Figure-Standalone-Block-Invariant-Test.md` → 桌面文件夹，1328 B，SHA `52BB2189...`；`Generic-Locator-Runtime-Test.md` → 桌面根（kdesk64 PID 14956 接收），398 B，SHA `7F4E6B3B...`；源保留，副本已删除 |
| D10 | 拖出到 Explorer（跨盘 D:→C:） | **PASS** | `internal-b.md` 18 B → `sources`；源保留；另见历史 `Figure-...` 证据 |
| D10b | 拖出到 Explorer（同盘 D:→D:） | **PASS** | `root\D01-single.md` → `expanded\D01-single.md` 18 B，双方 SHA `75C9FB6C...`，源保留 |
| D11 | 未保存文档拖出告警 | **PASS（修复后）** | OS + 审计 + 截图：脏文档拖出 → `modified:true / warning:WARN`；OCR 捕获告警“当前文档有未保存修改…请先保存（Ctrl+S）”；副本为磁盘版本；保存后与干净文档均不告警 |
| D12 | 快速重复 / Esc / 拖出窗口 / busy guard | **PASS（修复后）** | OS + 审计：Esc 与拖出窗口 PASS；1148 个 `.md` 批量复制进行中（0.4 s 已复制 21 个）再拖 `D05-conflict.md` → `INKCHAPTER-FILE-DRAG-IN-DROP` `{"phase":"busy","processing":true,"sourcesCount":1}`，目标无副本 |
| ACL | 只读目标目录 | **PASS（拒写 + 通知）** | ACL 仅 `RX`；直接写入被拒；真实拖入 `D05-conflict.md` 后目录为空、源完整；OCR 捕获“已复制 0 个文件到「acl-target」，1 个失败”“复制失败 (EPERM)” |

补充：侧栏滚轮滚动 PASS（行 top 194→252 CSS，适配器仍 attached）；窗口宽度 900→700 PASS（仍 attached，拖入 `expanded` 成功，SHA `80381751...`）。

## 5. 本轮确认并修复的真实缺陷（D07）

**现象（修复前 `DD4F...`）**：从文件树把 `internal-a.md` 拖到 `root`，源与目标同时存在（被当成了外部导入复制），适配器 `externalDropCount` +1。原生语义应为**移动**。

**根因**：真实运行中 Typora 内部拖放与 Explorer 外部拖入的 `dataTransfer.types` 都是 `["Files"]`，`File.path` 也都是真实路径；仅靠类型无法区分。适配器缺少“拖拽来源”状态。

**修复**（`src/file-transfer/file-tree-drag-adapter.ts`）：

- 新增 `internalDragActive`：
  - 文件树节点 `dragstart` 置位；
  - `drop` 时若为内部拖拽：**不 preventDefault / 不 stopPropagation / 不复制**，交还原生移动；
  - `dragend`、`dragleave(relatedTarget === null)`（拖出窗口，已实测会触发）以及任意新的 `dragstart` 清除，避免拖出后残留标记；
  - `isExternalTreeDrag()` 在内部拖拽期间返回 false。
- `getInvariant()` 暴露 `internalDragActive` 以便运行态核验。

**定向测试**（`file-tree-drag-adapter.test.ts`，新增 3 例）：
内部拖放即使携带 `Files` 也不复制；拖出窗口后外部拖入恢复拦截；`dragend` 清除状态。定向 16/16 PASS。

**修复后真实复验（`420B9E4C...`）**：
- 内部拖放：`internal-a.md` 从 `internal` 消失并出现在 `root`（原生移动），适配器 `externalDropCount=0`。
- 外部拖入回归：`D01-single.md` + `crlf.md` → `root` 复制 2 个，计数 1，源保留。
- 拖出回归：`internal-b.md` → `sources`（C:）复制成功，源保留，`internalDragActive=false`。
- 拖出后再次外部拖入：`empty.md` → `unexpanded` 成功，计数 2（证明标记已清除）。

### 5.1 D11 未保存告警（后续修复）

- 现象：真实脏文档（标题 `internal-a.md•`）拖出时无告警。
- 运行时根因（审计实测）：
  - `File.bundle.hasMidified` 恒为 `false`；
  - `File.getContent()` 返回 Promise，解析结果与 `bundle.savedContent` 始终相同；
  - 标签页无 modified 类名，`.typ-close::before` 恒为 `"×"`；
  - `UndoManager.commandStack` 不可访问，`@electron/remote` 不存在，窗口标题不可读。
- 修复：
  1. 文件树 `dragstart` 观察改为 `closest('.file-library-node[data-path]')`，不再要求命中 `.file-node-content`；
  2. 监听编辑器 `#write` 内的 `input / paste / cut / drop / compositionend / keydown`，记录最后编辑时间 `lastEditAt`；
  3. 拖出时若 `lastEditAt > 文件 mtime + 1s` 判定为未保存；保存会推进 mtime，自动恢复为干净；
  4. 保留 `savedContent` 内容比对与审计事件 `INKCHAPTER-FILE-DRAG-OUT-INSPECT`（含 `editedAt/fileMtime/modifiedSource/warning`）。
- 真实复验（05:27 实例，审计 `runtime-sess-1792790938027.log`）：
  - 脏文档：`editedAt=21:29:17.709Z`，`fileMtime=21:17:01.030Z` → `modified:true / warning:WARN`；截图 OCR 捕获“墨章：当前文档有未保存修改…请先保存（Ctrl+S）”；
  - Ctrl+S 后：`fileMtime=21:29:42.226Z` > `editedAt` → `warning:NONE`（无假阳性）；
  - 干净文档 `internal-b.md`：`editedAt=null` → `warning:NONE`。
  - 字段读法：脏文档事件的 `modifiedSource` 仍为 `none`，因为它记录的是“内容比对”结论；实际判定来自 `editedAt > fileMtime + 1s` 启发式。审计同时保留 `editedAt` 与 `fileMtime`，可交叉核验（`modified:true` 且 `source:none` 即该启发式命中）。

### 5.2 D09 桌面根 / D12 重叠 / ACL 通知复测（2026-10-24 06:0x–06:3x）

- 运行窗口：同一 vault 的新窗口 `HWND=595916`，`loadedAt=2026-10-23T22:08:31.346Z`，构建 SHA 仍为 `1ABFB941...`。
- D09 桌面根：`Generic-Locator-Runtime-Test.md`（398 B）由真实 OS 拖拽落到桌面根，落点窗口为 kdesk64（PID 14956），目标 SHA `7F4E6B3B...`，源保留；桌面文件夹落点另以 `Figure-Standalone...`（1328 B，`52BB2189...`）复验。两副本均已删除。
- D12 重叠（首次尝试）：以 2000 个 `.md` 批量拖入制造长复制窗口，第二次拖入未产生副本，但当时 busy 通知未捕获；该次环境同时暴露了 `internalDragActive` 残留问题，已在 §5.3 修复并取得审计级 busy 证据。
- ACL：`acl-target`（`icacls /inheritance:r /grant:r RX`）真实拖入 `D05-conflict.md`，目录保持为空、源完整；截图 OCR 捕获失败汇总与 `(EPERM)` 明细。
- 环境异常：一次误定位拖拽从文件树节点发起后，旧窗口（13177692）对外部拖入不再响应（Explorer→Explorer 仍正常）；未关闭其未保存缓冲区，改用新窗口完成上述复测。误拖导致 `runtime/Document-Diagnostics-Trailing-Blank-0.md` 暂时消失，已用 Git 恢复（39 B 跟踪夹具）。

### 5.3 D12 busy guard 修复（`CB604576...`）

- 现象：复制进行中再次拖入既无副本也无 busy 提示；随后同一窗口所有外部拖入静默失效。
- 根因：`internalDragActive` 在“树内 dragstart → 窗口外结束”时可能收不到 `drop` / `dragend` / `dragleave(relatedTarget=null)`，标记残留使 `isExternalTreeDrag()` 恒 false → 外部 `dragover` 不再 `preventDefault` → 浏览器拒绝 `drop`，busy 分支没有执行机会。
- 修复：`mouseup`（捕获）/ `visibilitychange(hidden)` / `window blur` 兜底清理；内部标记 15 s TTL 自愈；新增拖入决策审计 `INKCHAPTER-FILE-DRAG-IN-DROP`（`internal/busy/invalid-target/no-sources/started`、`processing`、`sourcesCount`、`targetDirectory`）。
- 门禁：TypeScript PASS；定向 40/40（新增 mouseup 兜底、TTL 过期与 busy 审计断言）；全量 245 文件 / 4599 用例 PASS；生产构建与部署 SHA 一致。
- 真实复验：1148 文件批量复制进行中，真实 OS 第二次拖入命中 `phase=busy, processing=true, sourcesCount=1`，目标无副本。

## 6. 已观察但判定为原生/框架行为（非本轮缺陷）

1. **文件夹行落点后的折叠**：拖放落在“已展开的文件夹行”上时，文件夹可能回到折叠（悬停展开状态的清理）；落在**子文件行**上则保持展开，且刷新出的节点具备真实布局。刷新 API 本身不折叠（子行落点实测保持展开）。该项记为 **PARTIAL（原生悬停态）**。
2. **拖入编辑器正文会切换 vault**：Typora 把外部文档所在目录当作新 vault，vault 级插件被卸载（`adapter` 变为 `NO_ADAPTER`），文件树切换到该目录；这是框架的 vault 作用域行为，不是拖放适配器逻辑。打开 vault 内文档或重启后插件恢复。

## 7. 自动化门禁

| 门禁 | 结果 |
|---|---|
| TypeScript `tsc --noEmit` | PASS |
| 定向测试 `file-tree-drag-adapter.test.ts` + `file-transfer-policy.test.ts` | 40/40 PASS（19 + 21） |
| 全量测试 | 245 文件 / 4599 用例 PASS |
| 生产构建 | PASS（`CB60457608E65901A037105B3712EA2771938F036AA7BDD5900220AE6150D63E`） |
| 测试 vault 部署 | PASS（`DEPLOY_HASH_MAIN_MATCH=True`） |
| 运行时加载 | PASS（`loadSource=vault`，adapter attached） |
| 全局生产插件 | 未覆盖（保持 `DE62CB1A...`） |

## 8. 未执行 / 待人工

- 文件夹行落点后的展开态保持（原生悬停态，PARTIAL）。
- 全局生产插件未覆盖（测试 vault 专用部署）。

## 9. 清理与证据

- 真实副本已归档：`os-drag-artifacts/os-dragin-D01-single.md`、`os-dragin-D05-conflict-2.md`、`os-dragout-internal-b.md`、`os-dragout-same-volume-D01-single.md`。
- 测试 vault 已恢复基线（`conflict` 两个预置文件；`internal` 两个样本；`root`/`expanded`/`unexpanded` 仅 `.gitkeep`）。
- `sources` 已恢复 10 个源样本；D08 在 `sources` 生成的 `.typora` 已清理。本轮临时 2 GB/3 GB/8 GB 大文件与 2000 文件批次目录均已删除，C: 空间已回收。
- 桌面根/桌面文件夹测试副本（`Generic-Locator-Runtime-Test.md`、`Figure-Standalone-Block-Invariant-Test.md`）已删除；ACL 目标 `acl-target` 已恢复 ACL 并删除；vault 根所有批量 `b*.md`（含 D12 复验的 1148 个）与误入的 `D01-single.md` 已全部删除。
- 本轮临时 Explorer 窗口已关闭，NVIDIA GeForce 覆盖层已恢复显示；`vault` 根仅保留原有测试夹具与既有未跟踪文件。
- `runtime/Document-Diagnostics-Trailing-Blank-0.md` 因误定位拖拽暂时消失，已用 Git 恢复（39 B 跟踪夹具）。
- 夹具说明：D11 期间 Typora 的 `saveFileOnSwitch` 曾自动保存 `internal-a.md`，原始 18 B 字节内容无法逐字节还原；现为干净的 14 B `# internal A\n\n`（SHA `80F877521BC90F0F989BB1B7B7388DA44A5BAC77C1AAD6D838F046A0ADD1D030`）。该文件为测试夹具，非用户文件。
- 详细复制完整性见 `COPY-INTEGRITY.md`；构建/部署身份见 `BUILD-DEPLOY-IDENTITY.md`。

## 10. 主进程调试异常归因与环境恢复（2026-10-20 20:15）

### 10.1 异常与归因

- 现象：以 `--remote-debugging-port=9222` 启动 Typora 时，主进程弹出：
  `A JavaScript error occurred in the main process` / `Error: Not allow debugging this program.`
- 归因：Typora 明确禁止远程调试端口，属于宿主程序的硬限制，**不是插件缺陷**；不得尝试绕过。
- 处置：停止使用该启动方式，改为正常启动测试 vault。

### 10.2 启动参数扫描

已检索项目 `scripts/`、`src/`、`docs/`、`runtime/`（含提示词与验收文档）：

- 未发现 `--remote-debugging-port`、`--inspect`、`DevToolsActivePort` 的持久化用法；
- 该参数仅作为一次性的临时 shell 命令使用，未写入任何脚本/提示词/文档，无需删除文件；
- 已在 `CAPABILITY-MATRIX.md` 固化“禁止调试启动参数”的纪律。

### 10.3 环境恢复核验

| 项目 | 结果 |
|---|---|
| 启动命令 | `"D:\Typora\Typora.exe" <test vault>`（无调试参数） |
| PID / HWND | 32980 / 3737994 |
| 主窗口标题 | `Typora`（无未保存标记），`Responding=True` |
| 目标 vault | `...\test\vault` |
| 构建产物 SHA | `420B9E4C...` |
| 部署产物 SHA | `420B9E4C...`（与 dist 一致） |
| 实际加载 SHA | `420B9E4C...`，`loadSource=vault`，`initializationCount=1` |
| 插件审计会话 | `runtime-sess-1792498501946.log`，78 事件，含 heartbeat 与 tab-close invariants |
| 渲染进程 | client 4 + client 6（正常；未打开 DevTools） |

> 本轮验收不依赖 DevTools；身份与初始化由 `runtime-load.json` + 审计日志独立证明。

### 10.4 文件完整性检查与清理

| 项目 | 结果 |
|---|---|
| `internal/internal-a.md` | 当时 18 B，SHA `B90773886B5ADE73FC3EEA626E95304B6EEABE75DF6E693C9541F87EE190E32B`，mtime 17:15:57，未变化；D11 修复复验期间被 Typora `saveFileOnSwitch` 自动保存，现为 14 B `80F87752...`（见 §9 夹具说明） |
| 未保存缓冲区内容 | `<internal a\n额>` —— “额”为自动化误输入，非用户内容 |
| 处置 | 停止进程丢弃该未保存缓冲区（不写盘）；磁盘文件保持原样 |
| 自动化草稿 | 已删除 `draftsRecover\2026-10-20 internal-a 193244.md`、`...201412.md` |
| Untitled 文档 | 本轮未产生；`draftsRecover` 中 2026-10-19 的 Untitled 文件为历史数据，未触碰 |
| 测试 vault 夹具 | 基线：`conflict` 2 个预置文件、`internal` 2 个样本、`root/expanded/unexpanded` 仅 `.gitkeep` |
| 源样本目录 | 10 个源文件齐全，无残留 `.typora` |
| 桌面 | 未产生任何测试文件 |

### 10.5 DevTools 探针纪律

1. 仅在 Console 已打开且输入焦点已确认时允许粘贴脚本；
2. 无法确认焦点时禁止粘贴，避免脚本进入 Markdown 正文；
3. Runtime 验收优先使用文件系统、Typora 日志、插件审计日志、`runtime-load.json` 与真实 OS 拖拽结果；
4. 远程调试不是验收的必要条件。

### 10.6 本轮静态检查与范围

- `tsc --noEmit`：PASS；
- 全量测试：245 文件 / 4592 用例 PASS；
- 本轮**未修改**文件复制服务、拖拽适配器或测试代码；
- 未执行 Git commit；未触碰用户 WIP 文档。

