# Prompt Cleanup History（历史清理索引）

> 本文件是提示词清理**历史轮次**的摘要索引；每个被删除提示词文件的完整迁移明细见
> [prompt-consolidation-record.md](prompt-consolidation-record.md)。
> 治理规则见 [../operations/prompt-lifecycle.md](../operations/prompt-lifecycle.md)。
>
> 说明：2026-10-05 的整合轮次之后，项目**不再保留任何提示词 Markdown 文件**；本文件只保留历次清理的日期、数量与去向摘要，不再指向已删除文件路径。

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
