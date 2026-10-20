# 文件树 ↔ Windows 资源管理器拖拽 R2 — 最终报告（真实运行闭环）

日期：2026-10-20
工程：`D:\TyporaPluginProjects\typora-plugin-inkchapter`
最终候选构建：`420B9E4C5181E7A5532BE082BCFEF1A131A3BA86FAAFF08C036AF9B018EE6961`
上一候选构建：`DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A`（D01/D05/拖出与 D07 缺陷均在此构建上实测）

## 1. 总体结论

**真实 OS 拖拽主链路：PASS（含同轮缺陷修复与复验）**

| 类别 | 结论 |
|---|---|
| 构建 / 部署 / 加载身份 | PASS（最终 `420B9E4C...`，`loadSource=vault`，adapter `attached=true`） |
| 真实 OS 拖入（Explorer → 文件树） | PASS：D01、D02、D03、D04、D05、D06(.txt 拒绝) |
| 真实 OS 拖出（文件树 → Explorer） | PASS：D10 跨盘（D:→C:）与同盘（D:→D:），源保留、SHA 一致 |
| 悬停自动展开 / 侧栏滚动 / 窗口宽度变化 | PASS |
| 监听器生命周期 / 单次处理 | PASS（每次 drop 计数 +1，无重复；重启从 0 开始） |
| D07 树内拖放 | 发现真实缺陷 → 已修复 → 复验 PASS |
| D08 编辑器正文拖放 | PASS（不拦截、不复制；Typora 原生打开文件） |
| D09 桌面拖出 / D11 未保存告警 / D12 快速重叠 | NOT_RUN（见 §8） |
| 合成事件 / 服务测试 | 仅作为补充证据，**未用于**宣布真实 GUI PASS |

未覆盖、移动或删除任何用户正式文件；未修改 Typora 本体、app.asar 或社区框架源码；未执行 Git commit。

## 2. 运行身份（最终实例）

| 项目 | 值 |
|---|---|
| Typora PID / HWND | 31320 / 789980 |
| 打开路径 | `...\test\vault` |
| 加载 SHA256 | `420B9E4C5181E7A5532BE082BCFEF1A131A3BA86FAAFF08C036AF9B018EE6961` |
| loadedAt | 2026-10-20T11:24:20.253Z |
| loadSource | vault |
| adapter | `attached=true, externalDropCount=2, copiedCount=3, failedCount=0` |
| internalDragActive | false |
| DevTools | 已打开（本报告全部 DOM/适配器读数来自真实渲染器控制台） |

> 说明：原候选 `DD4F...` 在 18:50 / 19:10 两次真实加载并完成 D01/D05/拖出/批量/悬停等实测；D07 缺陷修复后重新构建为 `420B9E4C...`，部署并重启复验。

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
| D06 | `.txt` / 目录 / 符号链接 | **部分 PASS** | `.txt` 真实拖入被拒（`failedCount=1`，vault 内无 `.txt`）；目录/符号链接仅单测覆盖（NOT_RUN 真机） |
| D07 | 文件树内部拖放 | **缺陷→已修复→PASS** | 见 §5；修复后 `internal-a.md` 原生移动到 `root`，适配器计数 0 |
| D08 | `.md` 拖到编辑器正文 | **PASS** | 原生打开 `D04-batch-a.md`，未复制、适配器计数不变；同时触发框架按外部文档切换 vault（见 §6） |
| D09 | 文件夹悬停自动展开 | **PASS** | 悬停折叠 `internal`：309 ms `ty-on-drag-enter`，907 ms `file-node-expanded`，离开后 6018 ms 自动折叠 |
| D09b | 拖出到桌面 | **NOT_RUN** | 桌面被窗口覆盖，未构造独立桌面落点 |
| D10 | 拖出到 Explorer（跨盘 D:→C:） | **PASS** | `internal-b.md` 18 B → `sources`；源保留；另见历史 `Figure-...` 证据 |
| D10b | 拖出到 Explorer（同盘 D:→D:） | **PASS** | `root\D01-single.md` → `expanded\D01-single.md` 18 B，双方 SHA `75C9FB6C...`，源保留 |
| D11 | 未保存文档拖出告警 | **NOT_RUN** | 需真实未保存态；单测覆盖告警判定 |
| D12 | 快速重复 / Esc / 离开窗口 | **部分 PASS** | Esc 真实取消：无复制、计数不变；离开窗口（dragleave relatedTarget=null）后外部拖入仍正常；重叠 busy guard 仅单测（文件过小未触发） |

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

## 6. 已观察但判定为原生/框架行为（非本轮缺陷）

1. **文件夹行落点后的折叠**：拖放落在“已展开的文件夹行”上时，文件夹可能回到折叠（悬停展开状态的清理）；落在**子文件行**上则保持展开，且刷新出的节点具备真实布局。刷新 API 本身不折叠（子行落点实测保持展开）。该项记为 **PARTIAL（原生悬停态）**。
2. **拖入编辑器正文会切换 vault**：Typora 把外部文档所在目录当作新 vault，vault 级插件被卸载（`adapter` 变为 `NO_ADAPTER`），文件树切换到该目录；这是框架的 vault 作用域行为，不是拖放适配器逻辑。打开 vault 内文档或重启后插件恢复。

## 7. 自动化门禁

| 门禁 | 结果 |
|---|---|
| TypeScript `tsc --noEmit` | PASS |
| 定向测试 `file-tree-drag-adapter.test.ts` | 16/16 PASS |
| 全量测试 | 245 文件 / 4592 用例 PASS |
| 生产构建 | PASS（`420B9E4C5181E7A5532BE082BCFEF1A131A3BA86FAAFF08C036AF9B018EE6961`） |
| 测试 vault 部署 | PASS（`DEPLOY_HASH_MAIN_MATCH=True`） |
| 运行时加载 | PASS（`loadSource=vault`，adapter attached） |
| 全局生产插件 | 未覆盖（保持 `DE62CB1A...`） |

## 8. 未执行 / 待人工

- D09b 桌面拖出（需真实桌面落点）。
- D11 未保存文档拖出告警（需人工构造未保存态）。
- D06 目录 / 符号链接真实鼠标拖入（单测已覆盖拒绝路径）。
- D12 大文件重叠导入的 busy guard（真实文件过小，未触发；单测覆盖）。
- 只读 ACL 真实拒绝。
- 文件夹行落点后的展开态保持（原生悬停态，PARTIAL）。

## 9. 清理与证据

- 真实副本已归档：`os-drag-artifacts/os-dragin-D01-single.md`、`os-dragin-D05-conflict-2.md`、`os-dragout-internal-b.md`、`os-dragout-same-volume-D01-single.md`。
- 测试 vault 已恢复基线（`conflict` 两个预置文件；`internal` 两个样本；`root`/`expanded`/`unexpanded` 仅 `.gitkeep`）。
- `sources` 已恢复 10 个源样本；D08 在 `sources` 生成的 `.typora` 已清理。
- 详细复制完整性见 `COPY-INTEGRITY.md`；构建/部署身份见 `BUILD-DEPLOY-IDENTITY.md`。
