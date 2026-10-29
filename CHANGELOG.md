# Changelog

本文件记录墨章 InkChapter 面向用户的真实变更。

- 版本号取自 `package.json` / `src/manifest.json`（当前 `0.1.0-alpha.1`）。项目**没有**发布版 git tag（唯一的 tag 是基线标记 `formula-render-restored-baseline-20260821`），因此不虚构 release 版本号。
- 多轮反复修复同一问题的历史工作已**压缩为一条**用户可理解的记录；失败尝试只出现在模块文档的"历史设计决策"与 [docs/maintenance/prompt-consolidation-record.md](docs/maintenance/prompt-consolidation-record.md)，不进入本文件。
- 仅由提示词提出、当前代码未实现的能力**不在此**，见 [docs/roadmap/known-gaps-and-deferred-work.md](docs/roadmap/known-gaps-and-deferred-work.md)。

## [Unreleased]

### Added

- 标题自动编号（H1–H6）：多种编号预设、自定义多级组合格式、文档级覆盖、标题级数范围控制、特殊标题排除、大纲（侧栏目录）编号同步。
- 图表题注系统：表格 / 图片 / 代码题注命名与独立编号，公式语义编号投影。
- 文档诊断：错误 / 警告 / 提示实时检测，工具栏计数、右侧问题面板（Drawer）、点击定位与 active 强调、左侧大纲诊断投影。
- 文档诊断 · 源码完整性（TRAE V3）：未闭合代码围栏 / 未闭合 `$$` 公式块、脚注引用缺失 / 定义重复 / 未使用 / 空定义、引用式链接定义缺失 / 重复、Front Matter 未闭合、表头空 / 重复、空链接文字 / 空链接目标。由三套共享 source authority（`DocumentSourceSyntaxAuthority` / `DocumentDefinitionReferenceIndex` / `DocumentInlineLinkAuthority`）单一解析供给，一次 source revision 解析 / 构建各 ≤ 1 次；代码围栏、公式块、Front Matter 内的 Markdown 一律不产生下游误报。
- 文档工具：编辑锁定、↑↓ 滚动导航（Navigator）、文档查看右键菜单（关闭标签 / 复制路径 / 在资源管理器中显示）、工作区标签关闭按钮增强。
- 设置工作台（编号方案 / 标题格式 / 文档规则 / 图表对象 4-Tab）。
- 运行时身份验证（`RUNTIME-IDENTITY-FINAL`、15 项验证）与全局加载路径权威。
- 公式编号：新装默认「节内编号」（如 `1.1-1`），显式「全局编号」仍可选；空公式块也会占用编号，不再出现编号空洞。
- 字数统计面板打开时自动避让右下滚动导航（左移 / 上移 / 隐藏），导航按钮一次手势只执行一次滚动。

### Changed

- 将历史 Agent 提示词体系整合进正式模块 / 架构 / 运维文档；提示词不再承担项目知识职责。
- 文档体系重组为 `docs/modules`、`docs/architecture`、`docs/operations`、`docs/roadmap`、`docs/maintenance`。

### Fixed

- 文档诊断在空白区域（块间隙 / 文档末尾多余空行）的定位与 active 视觉，统一为单一"呈现范围"，并支持首次点击即定位。
- 同一文档中重复资源（例如两处相同图片）的诊断定位改为按 source occurrence 身份精确命中，不再总是高亮首个匹配。
- 行内诊断定位在程序化滚动后重投影不再漂移（统一为 document-local 坐标）。
- 定位期间 Drawer 不再被折叠或遮挡，恢复后保持选中项与筛选。
- 编辑标题文本后诊断几何实时失效并按当前文本重测。
- 标题编号与编号-标题间距改为原子 reconcile，消除文档切换后的陈旧间距。
- Figure / Caption 诊断的存在性与命名改由 canonical owner（alt / sidecar）判定。
- 文档诊断「连续空行过多」改以**可视空行数**判定（Typora 折叠源码空行后不再误报），并按编辑模式（所见即所得 / 源代码）区分数据来源。
- 文档诊断 Drawer：诊断**内容**变化时就地刷新该行文字（消除"检测数据已更新但 Drawer 文字仍旧"），并保留滚动位置与选中状态。
- 文末空行诊断与视觉标记实时同步（EOF-R5）：内容 / 几何指纹驱动 `UPDATE_CONTENT / UPDATE_GEOMETRY / RETRACT`，Drawer、`多余 N 空行` 标签与精确着色片段原子重建，修复"数值变、色块不变"；规范保留的 1 行永不涂色。
- 文末 Enter 重复拆分（EN-11）：展示层不再作为 `#write` 最后子节点（改为首子节点），并在 Enter 回声窗口内暂缓插件展示写入；真实 16 次物理 Enter 0 次重复拆分、每次 +1 可见空行。
- 文档诊断光标隔离与审计覆盖：展示文本不进入 Selection / Markdown 序列化；导航审计显式记录 `dropped / cancelled` 而非静默丢弃；构建链 `typecheck` fail-fast。
- 连续空行标记：拆分或合并区间后，警告高亮与「N 空行」标签即时跟随新的区间（按语义血缘继承），不再出现高亮丢失、叠加或整块闪烁；主高亮退役时自动改由同组其余区间接管。
- UI：标签滚动条、标签分隔线、区域边界与主题视觉层级对齐。
- 源码语法类诊断（未闭合代码围栏 / `$$` 公式块 / Front Matter）：点击后按 canonical source block 投影，在 opening token 上立即显示 Error 激活标记；Typora 未提供 `data-line` 时不再报"目标未找到"，正常代码块与水平线不会被误选。
- 文档末尾缺少换行符：首次点击即在文末显示紧凑 EOF 端点标记（短横线 +「缺少 1 空行」），补上换行后标记与警告同步消失，不再只是滚到底后回滚。
- 空代码块诊断（「代码块为空」）并入通用代码块定位与高亮管线，与「缺少代码名 / 缺少代码语言」一致；移除空块专属的容器 surface、persistent carrier、原子交接与合成可见性生命周期。
- 修复在普通文件夹打开文档时 Typora 整窗卡死：移除 Ribbon 可见性的「写—观察」反馈环，默认保持原生文件 / 搜索 / 大纲侧栏并保留墨章增强。
- 同一次物理指针激活只派发一次业务诊断点击，重复派发被丢弃；对同一目标再次点击仍保留取消（toggle off）语义。
- 连续空行诊断：一段过量空行被新输入的正文拆分后，左右两段分别独立判定并各自产生警告与标记；某一段恢复正常时只消除该段；删除中间正文后合并为一条。修复 Typora 把新段落包裹在不同 DOM 层级时可视空行测量失败、诊断被静默丢弃的问题。
- 连续空行激活状态按语义血缘继承：已激活区间被正文拆分后，两侧仍违规的新区间同时保持高亮；局部编辑只更新受影响区间；删除中间正文合并时新区间继承激活并自动扩大标记范围；Drawer 仍保持单选。
- 连续空行激活组在"分两步达标"时不再丢失一侧：先分裂到单侧达标、再让另一侧重新达标的场景下，两侧同时高亮（真机回归）。修复两个原因：被可视空行门暂缓发布的后代被移出成员集合；一侧空行归零导致 gap 血缘链断裂。现在成员集合保留血缘后代，并以用户选中的块范围作为只增不减的持久锚。
- 连续空行激活组改为显式生命周期：`ACTIVE`（有高亮）/ `DORMANT`（意图保留但当前无警告，零高亮、Drawer 无选中）/ 取消（清空）。两侧暂时都合规后再超量会自动恢复高亮，无需重新点击；无关的新空行区间不再因为落在历史选中范围内而被误当作后代；再次点击当前组成员会整组取消并与 Drawer 选中同步清空。
- 连续空行激活组不再丢失"先并入下一段、再拆分出来"的一侧：已证明的块锚改为冻结累积（不再每轮被当前成员覆盖），受限选区端点暂时无法解析时保留原身份而不是被更窄位置替换；该侧重新超量后会在同一次提交内恢复高亮（真机 R3-25 回归）。

### Removed

- 迁移完成后删除已过时的一次性执行提示词 Markdown（共 114 个文件）。
- 再次清理遗留的一次性提示词 Markdown（`docs/prompts/pending/**` 16 个 + `runtime/smoke/TRAE-*.md` 3 个，共 19 个），有效结论已并入模块文档。

### Documentation

- 新增模块文档、架构文档、运维文档、Roadmap 与提示词迁移记录（`docs/maintenance/prompt-consolidation-record.md`）、文档校验脚本（`scripts/docs/verify-docs.mjs`）。

## History（基于真实 commit 的整理证据）

> 以下按主题汇总真实 commit（`git log` 证据），仅用于追溯，不等于发布版本。

- 2026-08-21 — 基线标记 `formula-render-restored-baseline-20260821`（原生 MathJax 块公式渲染基线）。
- 2026-09-07 — UI Phase 2B/2C：响应式 Navigator、Toolbar 紧凑化、Settings Workbench。
- 2026-09-08 — 活动文档权威（active leaf / rendered visibility / close-last-tab）、Problems 单投影链、启动快照准入、空工作区与真实双击 Readiness。
- 2026-09-09 — 诊断定位 Frame V3 / V5.4 / V5.6 / V5.7（overlay 视觉闭合、全几何 authority、交互生命周期、滚动视觉拓扑）。
- 2026-09-14 — 诊断视觉几何闭合 V5.12-R2 + Drawer 持久化 V5.12-R3（DocumentLayoutEpoch、两类 lease）。
- 2026-09-29 — 空文档短路 R6、Fill-Only 定位 R7、Code Caption / Figure 诊断 R8；EOF 合成锚点 V5.13-R1/R2/R3；Locate 提交顺序与 Heading Marker R9。
- 2026-09-30 — 诊断多视图 Authority V5.14-R1、P5-R2/P6/P7/P8 闭合 V5.14-R2、Passive/Active 解耦 V5.14-R3、编号 Number+Gap 原子 reconcile V5.14-R4。
- 2026-10-01 — 诊断 V2 身份闭合与 Strict Multi-H1、Heading Reason Chip 稳定锚点 V2、Tab 滚动条 / 分隔线视觉 V5.x。
- 2026-10-02 — 统一诊断域架构 V1（one infrastructure, two responsibility domains）。
- 2026-10-03 — 内部空行策略闭合 V1、Target Group 单行 Drawer、Figure Locator 特殊容器 canonical 绑定 V2.3.2、Heading 自动编号冲突证据态闭合 V1.2。
- 2026-10-04 — 诊断能力矩阵 + Gap Closure V1（Phase A–G）、空白警告呈现策略 V1、Phase H（编号完整性）/ Phase I（anchor 完整性）。
