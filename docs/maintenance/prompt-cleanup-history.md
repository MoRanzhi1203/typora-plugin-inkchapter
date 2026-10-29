# Prompt Cleanup History（历史清理索引）

> 本文件是提示词清理**历史轮次**的摘要索引；每个被删除提示词文件的完整迁移明细见
> [prompt-consolidation-record.md](prompt-consolidation-record.md)。
> 治理规则见 [../operations/prompt-lifecycle.md](../operations/prompt-lifecycle.md)。
>
> 说明：2026-10-05 的整合轮次之后，项目**不再保留任何提示词 Markdown 文件**；本文件只保留历次清理的日期、数量与去向摘要，不再指向已删除文件路径。
> 2026-10-24 曾按用户要求把两批提示词恢复到 `docs/prompts/pending/`，随后完成二次整合并再次移出（见下节）。

## 2026-10-30 — 空行 / 诊断 / 公式 / 审计批次整合（MERGE_THEN_DELETE）

- 清理 `docs/prompts/pending/` 中 **20 个文件（18 个唯一提示词 + 2 个重复副本 `…LIFECYCLE-R3 (1).md` / `…REALTIME-V2-CLOSURE (1).md`）**；**目录 `docs/prompts/pending/` 按规则保留**，正文移出到外部备份 `D:\TyporaPluginProjects\_prompt-backups\inkchapter-prompt-reorg-20261030\`。
- 结论去向：
  - [../modules/document-utilities.md](../modules/document-utilities.md) §3 新增「连续空行实时链路收口：语义 → 组所有权 → 视觉对账（R2–R10 / REALTIME V1–V4）」7 段（三层权威、空白语义统一、增量边界与被否决的合成脏区间、视觉 owner 契约、组生命周期与血缘、延迟实测、证据目录）；§2 新增「字数面板避让 + 单手势导航意图（WC-R2）」。
  - [../modules/document-diagnostics.md](../modules/document-diagnostics.md) §2 / §4 / §10 / §14：结构化快照契约、结构 no-op 判决、locate successor 重绑定、`DEGRADED_PRESENTED`、审计前缀补充、5 条历史设计决策。
  - [../architecture/identity-presentation-authorities.md](../architecture/identity-presentation-authorities.md) §1「结构快照 vs 增量镜像」、§3「owner 事实晚于绘制事实 / 一区间一 owner」、§5「刷新后重解析 successor / `data-line=null` 是常态」、§7「组 ACTIVE ≠ 存在主 Carrier / 组投影是对账」。
  - [../modules/formula-numbering.md](../modules/formula-numbering.md) §14「公式正确性收口（PA-10–PA-14）」；[../modules/runtime-audit-and-identity.md](../modules/runtime-audit-and-identity.md) §15「只读 GUI caret 探针与 21px 视口标定」。
  - [../roadmap/issue-and-error-ledger.md](../roadmap/issue-and-error-ledger.md) §7「PA-01…PA-26 全项目审计台账（唯一口径）」；[../roadmap/known-gaps-and-deferred-work.md](../roadmap/known-gaps-and-deferred-work.md) §A 更正公式编号行口径（`REDEVELOPMENT_REQUIRED` → `IMPLEMENTED_PARTIAL`），§B 新增 9 条空行/快照/公式/WC-R2/PA 残差。
  - [../archive/PROGRESS-ARCHIVE.md](../archive/PROGRESS-ARCHIVE.md) ENTRY 36–39（R9/R10、实时视觉先行、组 owner V3/V4、公式+WC-R2+整合）。
- 如实保留的未闭环事实：T8 真实屏幕 Paint、≥2000 行文档、三层拆合、Undo/Redo、跨文档隔离（S14）、公式 GUI 夹具与 P95、WC-R2 面板打开时导航均未取证；提示词里 `contentStructureEpoch`、`BlankGapIndex`/`ActiveGapVisualProjection`、`highlightedGapIds`、`KNOWN_EMPTY` 等**设计示意符号从未落地（ABSENT）**，未写入“当前实现”。
- 术语校正（写入文档时已统一为真实名）：`internal-blank-lines-v1.ts` → `document-diagnostic-internal-blank-lines-v1.ts`；`buildDocumentDiagnosticsInput` → `collectDiagnosticsInput`；`activeDiagnosticState` → `diagnosticInteractionState`；`NO_ACTIVE_OWNER` 不是运行期取值（实为 `NO_ACTIVE_INTENT` / `NO_AFFECTED_MEMBER` / `BOUNDARY_UNBOUND`）。
- 逐条明细见 [prompt-consolidation-record.md](prompt-consolidation-record.md) §2026-10-30。

## 2026-10-24 — 恢复后二次整合（MERGE_THEN_DELETE）

- 恢复的 26 个提示词（10-11 批次 18 个 + 10-19 批次 8 个，`TRAE-RENDERED-BLANK-ROW-COORDINATE-CLOSURE.md` 重复 1 个）逐条核对后整合，**目录 `docs/prompts/pending/` 保留**，提示词正文移出到外部备份 `D:\TyporaPluginProjects\_prompt-backups\inkchapter-prompt-reorg-20261024\`。
- 结论去向：[../modules/document-utilities.md](../modules/document-utilities.md) 新增 13 节（空行三层 authority、Block Gap canonical 定位、paint-layer 校准、坐标闭合、三类几何、`CODE_EMPTY_BLOCK` 通用管线、Source-Syntax V4/V5、Document-End 端点、presentation epoch、统一几何事务、composite marker、badge 非重叠），并补齐 EOF-R5 / EN-11 / P0-CARET 三章的缺口；[../modules/document-diagnostics.md](../modules/document-diagnostics.md) §4 / §10 / §14；[../modules/sidebar-integration.md](../modules/sidebar-integration.md) 新增 Ribbon 可见性与 LC-01；[CHANGELOG.md](../../CHANGELOG.md) `[Unreleased] → Fixed` 5 条。
- 如实保留未闭环事实：V6/V7/V8 空代码块专属路线已回退；Source-Syntax V4/V5、空行权威、paint-layer 校准、Document-End、统一几何事务均只到静态/单测落地，Runtime 仍为 `NOT_RUN` / `PENDING`；`ANNOTATION-OVERLAP` 本轮无执行产物。
- 逐条明细见 [prompt-consolidation-record.md](prompt-consolidation-record.md) §2026-10-24。

## 2026-10-19 — Enter / EOF / 光标 P0 批次（MERGE_THEN_DELETE）

- 删除 `docs/prompts/pending/**` 剩余 8 个提示词文件（ENTER-DUPLICATE / ENTER-EOF / EOF-ENTER-BLANK / EN11-R3 / EN11-R4 / P0-CARET-EOF R1 / P0-R2 / EOF-R5），`PROMPT_MD_REMAINING_COUNT` 归零。
- 有效结论并入 [../modules/document-utilities.md](../modules/document-utilities.md) 的「EOF 诊断事实 ↔ 视觉标记实时同步（EOF-R5）」「文末 Enter 重复拆分（EN-11）」「诊断光标隔离、审计覆盖与构建 fail-fast（P0-CARET-EOF）」三节，并更新 [../modules/README.md](../modules/README.md) 索引。
- 用户可见变更并入 [CHANGELOG.md](../../CHANGELOG.md) `[Unreleased] → Fixed`；[../roadmap/issue-and-error-ledger.md](../roadmap/issue-and-error-ledger.md) 的 EN-11 标记为 2026-10-18 已闭环并记录结论修正。
- 证据：`runtime/evidence/EOF-R5-*`、`EN11-R3-*`、`EN11-R4-*`、`EN11-R6-LAYER-PLACEMENT.md`、`P0-CARET-EOF-*`；`NOT_RUN` / `PENDING_USER_MANUAL` 项保持原状态，未写成 PASS。
- 外部备份：`D:\TyporaPluginProjects\_prompt-backups\inkchapter-enter-eof-caret-20261019\`。
- 逐条明细见 [prompt-consolidation-record.md](prompt-consolidation-record.md) §2026-10-19。

## 2026-10-11 — 遗留提示词二次清理（MERGE_THEN_DELETE）

- 删除 `docs/prompts/pending/**` 16 个 + `runtime/smoke/TRAE-*.md` 3 个，共 19 个文件；`scripts/docs/verify-docs.mjs` 的 `PROMPT_MD_REMAINING_COUNT` 归零。
- 有效结论并入 [../modules/document-utilities.md](../modules/document-utilities.md)、[../modules/document-diagnostics.md](../modules/document-diagnostics.md)、[../modules/sidebar-integration.md](../modules/sidebar-integration.md)。
- 提示词路径引用改为指向 canonical 模块文档（`src/settings/ribbon-visibility.ts`、`runtime/evidence/R02-R05-MANUAL-CHECKLIST.md`）。
- 外部备份：`D:\TyporaPluginProjects\_prompt-backups\inkchapter-doc-cleanup-<stamp>\`。
- 逐条明细见 [prompt-consolidation-record.md](prompt-consolidation-record.md) §2026-10-11。

## 2026-10-05 — TRAE V3 文档诊断源码完整性（MERGE_THEN_DELETE）

- 删除 `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-SYNTAX-FOOTNOTE-REFERENCE-FRONTMATTER-EXPANSION-V3.md`（1 个文件）。
- 有效结论并入 [../modules/document-diagnostics.md](../modules/document-diagnostics.md) §2/§3、[CHANGELOG.md](../../CHANGELOG.md) `[Unreleased] → Added`。
- 本轮未实现的 P2 候选（List / Accessibility / Leading Blank / Code / Source Hygiene / Extended Front Matter / Unused reference definition / Table row structure / Formula label）登记进 [../roadmap/known-gaps-and-deferred-work.md](../roadmap/known-gaps-and-deferred-work.md) §E/§F。
- 规则清单以自动生成的 [../diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md](../diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md) 为准。

## 2026-10-05 — 全量整合（终局）

- 一次性审计并删除全部历史提示词 Markdown（原提示词目录及其备份目录，共 114 个文件）。
- 有效信息合并进 `docs/modules/**`、`docs/architecture/**`、`docs/operations/**`、`docs/maintenance/**` 与 `CHANGELOG.md`。
- 未实现 / 延后需求迁入 `docs/roadmap/known-gaps-and-deferred-work.md`。
- 明细见 [prompt-consolidation-record.md](prompt-consolidation-record.md)。

## 2026-10-01 — pending 全量整理

- 28 份 pending 提示词整理：删除 18、保留 10（保留者本轮一并删除）。
- 补录 V5.14-R4(Reflow)/R5/R6/R6.1 与 V5.15 链（Standalone / Multi-Target V2 / Active State Machine V2·V2.1 / Document-End One-Click Locate V2 / Figure Locator V1 / Fixture Resource V1 / Performance Closure V1）及 GUI 链（Empty Workspace V1 / Empty-Surface V2 / Real-DblClick V3 / Problems V4 / Close-Last-Tab V3 / Startup V5）的耐久结论到 `docs/modules/document-utilities.md` 与 `docs/modules/README.md`。
- 归位两份误置于 `test/vault/runtime/smoke/` 的提示词正文。
- 外部快照目录（已删除）。

## 2026-09-29 ~ 2026-09-30 — 诊断定位 / 视觉 / 编号闭合批次

- 多轮 MERGE_THEN_DELETE：V5.12-R2/R3/R4/R5/R6/R7/R8/R9、V5.13-R1/R2/R3/R4/R5、V5.14-R1/R2/R3/R4 的结论并入 `docs/modules/document-utilities.md`（§3/§8）。
- 存档载体为独立 `archive/*` 分支提交（未动 main）。

## 2026-09-07 ~ 2026-09-14 — UI / Navigator / 文档工具批次

- UI Phase 1/2B/2C、Navigator DevTools/True-Inset、Document View Context Menu、Tab Close、Problems/Empty 链等提示词按生命周期规则删除或归档。
- 耐久结论并入 `docs/modules/ui-visual-system.md`、`docs/modules/settings-ui.md`、`docs/modules/document-utilities.md`。

## 更早批次（摘要）

- 2026-08-24：7R caption-numbering 系列（01–45）归档，结论并入 `docs/modules/caption-system.md`、`docs/modules/formula-numbering.md`、`docs/modules/document-utilities.md`。
- 2026-08-19 / 2026-08-14 / 2026-08-11：批量清理公式身份、题注、大纲、标题排版、段落缩进等已执行提示词；结论由源码与模块文档承载。

> 历史轮次的逐条证据链（源码 / 测试 / Runtime 审计）保存在对应的 archive 分支提交与模块文档的"历史设计决策"中。
