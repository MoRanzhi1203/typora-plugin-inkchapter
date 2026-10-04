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
- UI：标签滚动条、标签分隔线、区域边界与主题视觉层级对齐。

### Removed

- 迁移完成后删除已过时的一次性执行提示词 Markdown（共 114 个文件）。

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
