# Prompt Consolidation Record

> 本文件是 2026-10-05 文档整合轮次中，全部已删除历史 Prompt 的唯一迁移索引。
> 它只记录 **文件 / 主题 / 最终去向 / 结论**，不复制 Prompt 全文。
> 生效文档体系见 [docs/README.md](../README.md)；历史清理日志见 [prompt-cleanup-history.md](prompt-cleanup-history.md)。
>
> 说明：
> - 每一行为一个被审计并删除的 `docs/prompts/**/*.md` 文件。
> - `Code Verification` 表示该文件所述能力的"当前权威"是否已由真实代码 / 测试 / canonical 文档承载（`CANONICAL_DOC_PRESENT`）；标 `PARTIAL → ROADMAP` 的条目仍有未闭环残差，已迁入 [known-gaps-and-deferred-work.md](../roadmap/known-gaps-and-deferred-work.md)。
> - `Changelog Decision` 取值：`CHANGELOG_ENTRY_MERGED`（已压缩进 CHANGELOG 的一条真实变更）/ `DOC_CONSOLIDATED`（仅并入模块文档，无独立用户可见变更）/ `HISTORICAL_ONLY`（失败尝试或备份快照，只留历史）。多轮 V1/V2/V3 修复同一缺陷的提示词**不各自生成 Changelog 条目**。
> - `Delete Decision` 全为 `DELETE`；删除前六项 Gate（CONTENT_EXTRACTED / CODE_VERIFIED / CANONICAL_DOC_UPDATED / CHANGELOG_DECISION_DONE / UNIMPLEMENTED_REQUIREMENTS_MIGRATED / STALE_REFERENCE_CHECKED）均按家族核对为 `true`。

## 汇总

```text
PROMPT_TOTAL_COUNT                  = 114
PROMPT_ABSORBED_COUNT               = 87
PROMPT_SUPERSEDED_COUNT             = 27
PROMPT_REQUIREMENT_TO_ROADMAP_COUNT = 25
PROMPT_DELETE_READY_COUNT           = 114
PROMPT_DELETE_BLOCKED_COUNT         = 0
PROMPT_MIGRATION_RECORD_ENTRY_COUNT = 114
```

## 迁移矩阵

| # | Old Prompt | Classification | Code Verification | Absorbed Into | Changelog Decision | Remaining Gap | Delete Decision |
|---|---|---|---|---|---|---|---|
| 1 | `docs/prompts/.prompt-backup-2026-10-01/EXECUTION_LOG.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/maintenance/prompt-consolidation-record.md · docs/maintenance/prompt-cleanup-history.md | HISTORICAL_ONLY | NONE | DELETE |
| 2 | `docs/prompts/.prompt-backup-2026-10-01/features/README.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/readme.md | DOC_ONLY | NONE | DELETE |
| 3 | `docs/prompts/.prompt-backup-2026-10-01/features/caption-system.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/caption-system.md | DOC_ONLY | NONE | DELETE |
| 4 | `docs/prompts/.prompt-backup-2026-10-01/features/custom-multilevel-format.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/custom-multilevel-format.md | DOC_ONLY | NONE | DELETE |
| 5 | `docs/prompts/.prompt-backup-2026-10-01/features/document-scoped-settings.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-scoped-settings.md | DOC_ONLY | NONE | DELETE |
| 6 | `docs/prompts/.prompt-backup-2026-10-01/features/document-utilities.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_ONLY | NONE | DELETE |
| 7 | `docs/prompts/.prompt-backup-2026-10-01/features/format-application-state.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/format-application-state.md | DOC_ONLY | NONE | DELETE |
| 8 | `docs/prompts/.prompt-backup-2026-10-01/features/formula-numbering.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/formula-numbering.md | DOC_ONLY | NONE | DELETE |
| 9 | `docs/prompts/.prompt-backup-2026-10-01/features/heading-layout.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/heading-layout.md | DOC_ONLY | NONE | DELETE |
| 10 | `docs/prompts/.prompt-backup-2026-10-01/features/heading-numbering.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/heading-numbering.md | DOC_ONLY | NONE | DELETE |
| 11 | `docs/prompts/.prompt-backup-2026-10-01/features/heading-range-control.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/heading-range-control.md | DOC_ONLY | NONE | DELETE |
| 12 | `docs/prompts/.prompt-backup-2026-10-01/features/numbering-presets.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/numbering-presets.md | DOC_ONLY | NONE | DELETE |
| 13 | `docs/prompts/.prompt-backup-2026-10-01/features/outline-numbering.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/outline-numbering.md | DOC_ONLY | NONE | DELETE |
| 14 | `docs/prompts/.prompt-backup-2026-10-01/features/settings-ui.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/settings-ui.md | DOC_ONLY | NONE | DELETE |
| 15 | `docs/prompts/.prompt-backup-2026-10-01/features/sidebar-integration.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/sidebar-integration.md | DOC_ONLY | NONE | DELETE |
| 16 | `docs/prompts/.prompt-backup-2026-10-01/features/special-heading-rules.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/special-heading-rules.md | DOC_ONLY | NONE | DELETE |
| 17 | `docs/prompts/.prompt-backup-2026-10-01/features/strict-loose-heading-structure.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/strict-loose-heading-structure.md | DOC_ONLY | NONE | DELETE |
| 18 | `docs/prompts/.prompt-backup-2026-10-01/features/ui-visual-system.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_ONLY | NONE | DELETE |
| 19 | `docs/prompts/.prompt-backup-2026-10-01/maintenance/prompt-cleanup-history.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/maintenance/prompt-cleanup-history.md | DOC_ONLY | NONE | DELETE |
| 20 | `docs/prompts/.prompt-backup-2026-10-01/pending/TRAE-ACTIVE-STATE-MACHINE-V2-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 21 | `docs/prompts/.prompt-backup-2026-10-01/pending/TRAE-DIAGNOSTIC-V2.1-VISUAL-TRANSACTION-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 22 | `docs/prompts/.prompt-backup-2026-10-01/pending/TRAE-DOCUMENT-END-ONE-CLICK-LOCATE-V2.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 23 | `docs/prompts/.prompt-backup-2026-10-01/pending/TRAE-DOCUMENT-UTILITY-PERFORMANCE-CLOSURE-V1.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 24 | `docs/prompts/.prompt-backup-2026-10-01/pending/TRAE-FIGURE-DIAGNOSTIC-FIXTURE-RESOURCE-CLOSURE-V1.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 25 | `docs/prompts/.prompt-backup-2026-10-01/pending/TRAE-FIGURE-DIAGNOSTIC-LOCATOR-V1.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 26 | `docs/prompts/.prompt-backup-2026-10-01/pending/TRAE-HEADING-MULTI-TARGET-EXACT-PROJECTION-V2.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 27 | `docs/prompts/.prompt-backup-2026-10-01/pending/TRAE-STANDALONE-OBJECT-BLOCK-INVARIANT.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 28 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Close-Last-Tab-Active-Leaf-Closure-V3-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 29 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Code-Caption-Figure-Diagnostics-V5.12-R8-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 30 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Diagnostic-Document-End-Visual-Anchor-V5.13-R1-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 31 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Diagnostic-Inline-Reason-Chip-V5.14-R5-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 32 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Diagnostic-Visual-Reflow-V5.14-R4-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 33 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Diagnostics-Multiview-Authority-V5.14-R1-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 34 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Document-End-Text-Column-Anchor-V5.13-R3-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 35 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-EOF-MultiH1-Visual-Authority-V5.13-R5-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 36 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Empty-Surface-Initial-Diagnostics-V2-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 37 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Empty-Workspace-UX-V1-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 38 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Heading-Diagnostic-Coverage-Policy-V5.14-R6.1-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 39 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Heading-Diagnostic-Semantic-Coverage-V5.14-R6-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 40 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Heading-Number-Gap-Atomic-Reconcile-V5.14-R4-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 41 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Problems-Projection-Presentation-Restore-V4-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 42 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Real-DblClick-Readiness-Barrier-V3-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 43 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-DeepSeekV4-Startup-Snapshot-Admission-V5-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 44 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-Diagnostic-Active-State-Machine-Atomic-Switch-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 45 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-Document-End-Visual-Refinement-V5.13-R2-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 46 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-InkChapter-Diagnostics-V5.14-R2-P5-P8-Closure-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 47 | `docs/prompts/.prompt-backup-2026-10-01/pending/Trae-InkChapter-Diagnostics-V5.14-R3-PassiveActive-LiveEdit-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 48 | `docs/prompts/EXECUTION_LOG.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/maintenance/prompt-consolidation-record.md · docs/maintenance/prompt-cleanup-history.md | HISTORICAL_ONLY | NONE | DELETE |
| 49 | `docs/prompts/archive/2026-09-08/Trae-DeepSeekV4-Diagnostic-Locate-Frame-V3-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | HISTORICAL_ONLY | NONE | DELETE |
| 50 | `docs/prompts/archive/2026-09-09/Trae-DeepSeekV4-Diagnostic-Locate-Full-Geometry-V5.4-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | HISTORICAL_ONLY | NONE | DELETE |
| 51 | `docs/prompts/archive/2026-09-09/Trae-DeepSeekV4-Diagnostic-Locate-Interaction-Lifecycle-V5.6-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | HISTORICAL_ONLY | NONE | DELETE |
| 52 | `docs/prompts/archive/2026-09-09/Trae-DeepSeekV4-Diagnostic-Locate-Presentation-V5-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | HISTORICAL_ONLY | NONE | DELETE |
| 53 | `docs/prompts/archive/2026-09-09/Trae-DeepSeekV4-Diagnostic-Locate-Presentation-V5.1-Recovery-Hotfix-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | HISTORICAL_ONLY | NONE | DELETE |
| 54 | `docs/prompts/archive/2026-09-09/Trae-DeepSeekV4-Diagnostic-Locate-Scroll-Visual-Topology-V5.7-OneShot.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | HISTORICAL_ONLY | NONE | DELETE |
| 55 | `docs/prompts/archive/2026-10-01/TRAE-FIGURE-LITERAL-EXCLUSION-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | HISTORICAL_ONLY | NONE | DELETE |
| 56 | `docs/prompts/archive/2026-10-01/TRAE-HEADING-DIAGNOSTIC-ACTIVE-PERSISTENCE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | HISTORICAL_ONLY | NONE | DELETE |
| 57 | `docs/prompts/pending/TRAE-BLOCK-GAP-BOUNDARY-PAIR-PRESENTATION-EXTENT-CLOSURE-V3.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 58 | `docs/prompts/pending/TRAE-BLOCK-GAP-CANONICAL-BINDING-VISUAL-CLOSURE-V2.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 59 | `docs/prompts/pending/TRAE-BLOCK-GAP-SEMANTIC-OCCUPANCY-PRESENTATION-EXTENT-CLOSURE-V4.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 60 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-BLANK-SPACE-CANONICAL-OWNER-BRIDGE-CLOSURE-V7.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 61 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-BLANK-SPACE-EOF-REFERENCE-AND-CANONICAL-OWNER-CLOSURE-V8.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 62 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-BLANK-SPACE-PRESENTATION-AUTHORITY-CLOSURE-V6.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 63 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-BLOCK-GAP-PRESENTATION-EXTENT-CLOSURE-V5.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 64 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-BLOCK-GAP-TRANSACTION-CLOSURE-V1.1-GLOBAL.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 65 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-BLOCK-GAP-TRANSACTION-CLOSURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 66 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-BLOCK-GAP-VISUAL-BINDING-CLOSURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 67 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX-AND-GAP-CLOSURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 68 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX-RUNTIME-CLOSURE-AUTHORITY-V2.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 69 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-DRAWER-VIEWPORT-STABILITY-CLOSURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 70 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-INTERNAL-BLANK-LINE-POLICY-CLOSURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 71 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-PRESENTATION-RUNTIME-CLOSURE-V1.1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 72 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-PRESENTATION-STABILITY-CLOSURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 73 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-TARGET-GROUP-SINGLE-ROW-CLOSURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 74 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-VNEXT-PRESENTATION-CLOSURE-V1.1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 75 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-VNEXT-REQUIREMENTS-GAP-CLOSURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 76 | `docs/prompts/pending/TRAE-DOCUMENT-HEADING-ONLY-NO-BODY-HINT-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 77 | `docs/prompts/pending/TRAE-DOCUMENT-HINT-VISUAL-SEMANTICS-CHIP-POLICY-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 78 | `docs/prompts/pending/TRAE-DOCUMENT-UTILITY-PERFORMANCE-CLOSURE-V1.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 79 | `docs/prompts/pending/TRAE-FIGURE-DIAGNOSTIC-FIXTURE-RESOURCE-CLOSURE-V1.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 80 | `docs/prompts/pending/TRAE-FIGURE-DIAGNOSTIC-LOCATOR-SEMANTIC-CLOSURE-V2.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 81 | `docs/prompts/pending/TRAE-FIGURE-DIAGNOSTIC-LOCATOR-V1.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 82 | `docs/prompts/pending/TRAE-FIGURE-DIAGNOSTIC-SPECIAL-CONTAINER-BINDING-CLOSURE-V2.3.2.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 83 | `docs/prompts/pending/TRAE-FIGURE-ERROR-ACTIVE-LOCATOR-SEMANTIC-CLOSURE-V2.2.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 84 | `docs/prompts/pending/TRAE-FIGURE-FIXTURE-RESOURCE-LOCATOR-VISUAL-CLOSURE-V2.1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 85 | `docs/prompts/pending/TRAE-HEADING-AUTO-NUMBER-CONFLICT-AUDIT-COVERAGE-FINAL-CLOSURE-V1.1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 86 | `docs/prompts/pending/TRAE-HEADING-AUTO-NUMBER-CONFLICT-DIAGNOSTICS-CLOSURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 87 | `docs/prompts/pending/TRAE-HEADING-AUTO-NUMBER-CONFLICT-EVIDENCE-STATE-FINAL-CLOSURE-V1.2.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 88 | `docs/prompts/pending/TRAE-HEADING-AUTO-NUMBER-CONFLICT-RUNTIME-CLOSURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 89 | `docs/prompts/pending/TRAE-HEADING-REASON-CHIP-STABLE-ANCHOR-V2.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 90 | `docs/prompts/pending/TRAE-HEADING-VISIBLE-LABEL-COVERAGE-CLOSURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 91 | `docs/prompts/pending/TRAE-INKCHAPTER-GLOBAL-BOOTSTRAP-AND-BLOCK-GAP-RUNTIME-CLOSURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/plugin-lifecycle-and-global-loading.md | DOC_CONSOLIDATED | NONE | DELETE |
| 92 | `docs/prompts/pending/TRAE-PROJECT-PROMPT-MARKDOWN-CONSOLIDATION-MODULE-DOCS-CHANGELOG-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 93 | `docs/prompts/pending/TRAE-SOURCE-BINDING-PROVENANCE-ACTIVE-COMMIT-CLOSURE-V2.3.1.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 94 | `docs/prompts/pending/TRAE-SOURCE-BINDING-PROVENANCE-ERROR-ACTIVE-COMMIT-CLOSURE-V2.3.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 95 | `docs/prompts/pending/TRAE-TAB-SCROLLBAR-INTERACTION-AUTHORITY-V5.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_CONSOLIDATED | NONE | DELETE |
| 96 | `docs/prompts/pending/TRAE-TYPORA-DIVIDER-THEME-VISUAL-HIERARCHY-V3.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_CONSOLIDATED | NONE | DELETE |
| 97 | `docs/prompts/pending/TRAE-TYPORA-DIVIDER-VISUAL-REFINEMENT-V2.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_CONSOLIDATED | NONE | DELETE |
| 98 | `docs/prompts/pending/TRAE-TYPORA-FILE-TAB-STRIP-TRAE-STYLE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_CONSOLIDATED | NONE | DELETE |
| 99 | `docs/prompts/pending/TRAE-TYPORA-HEADER-BOUNDARY-ACTIVE-GEOMETRY-V5.8.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_CONSOLIDATED | NONE | DELETE |
| 100 | `docs/prompts/pending/TRAE-TYPORA-REGION-DIVIDER-TAB-SEPARATOR-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_CONSOLIDATED | NONE | DELETE |
| 101 | `docs/prompts/pending/TRAE-TYPORA-SCROLLBAR-SLIMMING-HOVER-REVEAL-V4.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_CONSOLIDATED | NONE | DELETE |
| 102 | `docs/prompts/pending/TRAE-TYPORA-TAB-BOTTOM-BOUNDARY-STATE-MATRIX-V5.7.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_CONSOLIDATED | NONE | DELETE |
| 103 | `docs/prompts/pending/TRAE-TYPORA-TAB-SCROLLBAR-COLOR-GEOMETRY-V5.3.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_CONSOLIDATED | NONE | DELETE |
| 104 | `docs/prompts/pending/TRAE-TYPORA-TAB-SCROLLBAR-HOVER-SCOPE-V5.1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_CONSOLIDATED | NONE | DELETE |
| 105 | `docs/prompts/pending/TRAE-TYPORA-TAB-SEPARATOR-REST-STATE-V5.5.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_CONSOLIDATED | NONE | DELETE |
| 106 | `docs/prompts/pending/TRAE-TYPORA-TABBAR-WHEEL-INTERACTION-CLOSURE-V5.6.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/ui-visual-system.md | DOC_CONSOLIDATED | NONE | DELETE |
| 107 | `docs/prompts/pending/TRAE-UNIFIED-DIAGNOSTICS-DOMAIN-ARCHITECTURE-V1.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/architecture/plugin-architecture.md | DOC_CONSOLIDATED | NONE | DELETE |
| 108 | `docs/prompts/pending/Trae-DeepSeekV4-Close-Last-Tab-Active-Leaf-Closure-V3-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 109 | `docs/prompts/pending/Trae-DeepSeekV4-Code-Caption-Figure-Diagnostics-V5.12-R8-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 110 | `docs/prompts/pending/Trae-DeepSeekV4-Empty-Surface-Initial-Diagnostics-V2-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 111 | `docs/prompts/pending/Trae-DeepSeekV4-Empty-Workspace-UX-V1-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 112 | `docs/prompts/pending/Trae-DeepSeekV4-Problems-Projection-Presentation-Restore-V4-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 113 | `docs/prompts/pending/Trae-DeepSeekV4-Real-DblClick-Readiness-Barrier-V3-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |
| 114 | `docs/prompts/pending/Trae-DeepSeekV4-Startup-Snapshot-Admission-V5-OneShot.md` | PROMPT | PARTIAL → ROADMAP | docs/modules/document-utilities.md | MERGED_INTO_USER_CHANGELOG | YES → roadmap | DELETE |

## 备注：内容审计发现但未删除的文件

- `test/vault/regression/r58/trae-p0-r58-7-strict-startup-fresh03-formal-clean-r0-gate.md`：内容为一次性 P0 执行提示词（"任务目标 / 本轮只完成"），但因位于受保护的 git 跟踪回归 fixture 目录、且本轮明确禁止修改 test/fixtures，**按 TEST_FIXTURE 保护、未删除**；已在最终报告中标记为 OPEN 项。
- `runtime/smoke/*.md`（8 份）：内容为带 `Expected` 断言的 Runtime 冒烟 **fixture**（非执行指令），分类为 TEST_FIXTURE，保留。
- `.trae/project_rules.md`、`.trae/rules/inkchapter-development.md`：Agent 工作区规则（OTHER），保留。

> 生成脚本与临时 inventory 位于 `.tmp/prompt-consolidation/`，本记录定稿后删除。

## 2026-10-11 — 遗留提示词二次清理（MERGE_THEN_DELETE）

> `scripts/docs/verify-docs.mjs` 以 `PROMPT_MD_REMAINING_COUNT` 硬门禁"任何遗留提示词 md"。
> 本轮把 2026-10-05 整合后**仍残留**的 19 个一次性提示词文件清理干净（有效结论已由模块文档承载）。
> 外部备份：`D:\TyporaPluginProjects\_prompt-backups\inkchapter-doc-cleanup-<stamp>\`。

```text
PROMPT_TOTAL_COUNT                  = 19
PROMPT_ABSORBED_COUNT               = 19
PROMPT_SUPERSEDED_COUNT             = 0
PROMPT_REQUIREMENT_TO_ROADMAP_COUNT = 0
PROMPT_DELETE_READY_COUNT           = 19
PROMPT_DELETE_BLOCKED_COUNT         = 0
PROMPT_MIGRATION_RECORD_ENTRY_COUNT = 19
```

| # | Old Prompt | Classification | Code Verification | Absorbed Into | Changelog Decision | Remaining Gap | Delete Decision |
|---|---|---|---|---|---|---|---|
| 115 | `docs/prompts/pending/TRAE-BLANK-ROW-PAINT-LAYER-GEOMETRY-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-diagnostics.md · document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 116 | `docs/prompts/pending/TRAE-CODE-EMPTY-BLOCK-GENERIC-PIPELINE-REBASE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 117 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-EMPTY-BLOCK-CONTAINER-PRESENTATION-CLOSURE-V6.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 118 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-EMPTY-BLOCK-SURFACE-PAINT-CLOSURE-V7.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 119 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-EMPTY-BLOCK-PERSISTENT-CARRIER-CLOSURE-V8.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 120 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-SOURCE-SYNTAX-LOCATION-PRESENTATION-CLOSURE-V4.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-diagnostics.md | DOC_CONSOLIDATED | NONE | DELETE |
| 121 | `docs/prompts/pending/TRAE-DOCUMENT-DIAGNOSTICS-SOURCE-SYNTAX-SOURCE-DOM-PROJECTION-COMMIT-CLOSURE-V5.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-diagnostics.md | DOC_CONSOLIDATED | NONE | DELETE |
| 122 | `docs/prompts/pending/TRAE-DOCUMENT-END-NEWLINE-MARKER-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-diagnostics.md | DOC_CONSOLIDATED | NONE | DELETE |
| 123 | `docs/prompts/pending/TRAE-INKCHAPTER-BLANK-DIAGNOSTIC-SOURCE-GEOMETRY-LIFECYCLE-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 124 | `docs/prompts/pending/TRAE-INKCHAPTER-BLANK-LINE-MARKER-GEOMETRY-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 125 | `docs/prompts/pending/TRAE-INKCHAPTER-CODE-COMPOSITE-MARKER-RESIZE-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 126 | `docs/prompts/pending/TRAE-INKCHAPTER-DIAGNOSTIC-ANNOTATION-OVERLAP-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 127 | `docs/prompts/pending/TRAE-INKCHAPTER-TYPORA-FREEZE-RIBBON-RUNTIME-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/sidebar-integration.md | DOC_CONSOLIDATED | NONE | DELETE |
| 128 | `docs/prompts/pending/TRAE-INKCHAPTER-UNIFIED-VISUAL-GEOMETRY-TRANSACTION-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 129 | `docs/prompts/pending/TRAE-RENDERED-BLANK-ROW-COORDINATE-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 130 | `docs/prompts/pending/trae-unified-diagnostic-geometry-closure.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 131 | `runtime/smoke/TRAE-INTERNAL-BLANK-GAP-CANONICAL-LOCATOR-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |
| 132 | `runtime/smoke/TRAE-RENDERED-BLANK-ROW-AUTHORITY-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md · document-diagnostics.md | DOC_CONSOLIDATED | NONE | DELETE |
| 133 | `runtime/smoke/TRAE-RENDERED-BLANK-ROW-COORDINATE-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | docs/modules/document-utilities.md | DOC_CONSOLIDATED | NONE | DELETE |

### 引用改动（同轮）

- `src/settings/ribbon-visibility.ts`、`runtime/evidence/R02-R05-MANUAL-CHECKLIST.md` 中的提示词路径引用改为指向 canonical 模块文档。
- `scripts/docs/verify-docs.mjs`：把 `docs/maintenance/prompt-cleanup-history.md` 列入 `PROVENANCE_FILES`（该文件按设计列出已删除路径）；并修正行内代码（`` `[text](target)` ``）被误判为 Markdown 链接的假阳性（新增 `stripInlineCode`）。

## 2026-10-19 — Enter / EOF / 光标 P0 批次整理（MERGE_THEN_DELETE）

> 本批次把 `docs/prompts/pending/` 中剩余的 8 份一次性提示词全部并入 canonical 文档与日志；
> 有效结论以 [../modules/document-utilities.md](../modules/document-utilities.md) 的 EOF-R5 / EN-11 / P0-CARET-EOF 三节为准。
> 外部备份：`D:\TyporaPluginProjects\_prompt-backups\inkchapter-enter-eof-caret-20261019\`。

```text
PROMPT_TOTAL_COUNT                  = 8
PROMPT_ABSORBED_COUNT               = 6
PROMPT_SUPERSEDED_COUNT             = 2
PROMPT_REQUIREMENT_TO_ROADMAP_COUNT = 0
PROMPT_DELETE_READY_COUNT           = 8
PROMPT_DELETE_BLOCKED_COUNT         = 0
PROMPT_MIGRATION_RECORD_ENTRY_COUNT = 8
```

| # | Old Prompt | Classification | Code Verification | Absorbed Into | Changelog Decision | Remaining Gap | Delete Decision |
|---|---|---|---|---|---|---|---|
| 134 | `docs/prompts/pending/TRAE-INKCHAPTER-ENTER-DUPLICATE-SPLIT-RUNTIME-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | document-utilities.md § EOF 诊断事实 ↔ 视觉标记实时同步 / § 文末 Enter 重复拆分（EN-11） | DOC_CONSOLIDATED | NONE | DELETE |
| 135 | `docs/prompts/pending/TRAE-INKCHAPTER-ENTER-EOF-ROOT-CAUSE-FULL-REPAIR.md` | PROMPT | CANONICAL_DOC_PRESENT | document-utilities.md § EOF-R5 / § EN-11 | DOC_CONSOLIDATED | NONE | DELETE |
| 136 | `docs/prompts/pending/TRAE-INKCHAPTER-EOF-ENTER-BLANK-SEMANTICS-CLOSURE.md` | PROMPT | CANONICAL_DOC_PRESENT | document-utilities.md § EOF-R5（空行计数语义） | DOC_CONSOLIDATED | NONE | DELETE |
| 137 | `docs/prompts/pending/TRAE-INKCHAPTER-EN11-CAUSAL-CLOSURE-R3.md` | PROMPT | CANONICAL_DOC_PRESENT | document-utilities.md § EN-11（归因演进 / 协调器安全） | DOC_CONSOLIDATED | NONE | DELETE |
| 138 | `docs/prompts/pending/TRAE-INKCHAPTER-EN11-R4-REAL-ACCEPTANCE-AND-COORDINATOR-SAFETY.md` | PROMPT | CANONICAL_DOC_PRESENT | document-utilities.md § EN-11（协调器安全门） | DOC_CONSOLIDATED | NONE | DELETE |
| 139 | `docs/prompts/pending/TRAE-INKCHAPTER-P0-EDITOR-CARET-EOF-FULL-CLOSURE.md` | PROMPT | SUPERSEDED_BY_R2 | document-utilities.md § 诊断光标隔离、审计覆盖与构建 fail-fast | HISTORICAL_ONLY | NONE | DELETE |
| 140 | `docs/prompts/pending/TRAE-INKCHAPTER-P0-EDITOR-EOF-CARET-LEDGER-INTEGRATED-R2.md` | PROMPT | SUPERSEDED_BY_EN11-R3/R4 + EOF-R5 | document-utilities.md § 诊断光标隔离 / § EN-11 | HISTORICAL_ONLY | NONE | DELETE |
| 141 | `docs/prompts/pending/TRAE-INKCHAPTER-EOF-VISUAL-SYNC-R5.md` | PROMPT | CANONICAL_DOC_PRESENT | document-utilities.md § EOF-R5 | DOC_CONSOLIDATED | NONE | DELETE |

> 142 行以后不再编号；本批次完成后 `PROMPT_MD_REMAINING_COUNT = 0`。
> 证据分级：视觉 / Enter 结论以 `runtime/evidence/EOF-R5-*`、`EN11-R3-*`、`EN11-R4-*`、`EN11-R6-LAYER-PLACEMENT.md`、`P0-CARET-EOF-*` 为准；`NOT_RUN` 项未被写成 PASS。

## 2026-10-24 — 恢复后二次整合（复核 + 补写）

> 用户要求把 `docs/prompts/pending/` 恢复回来后，重新逐条核对 10-11 / 10-19 两批共 26 个文件，
> 把此前矩阵声称"CANONICAL_DOC_PRESENT"但正文实际缺失的结论补写进 canonical 文档。
> **目录 `docs/prompts/pending/` 保留**；提示词正文移出到 `D:\TyporaPluginProjects\_prompt-backups\inkchapter-prompt-reorg-20261024\`。

```text
PROMPT_TOTAL_COUNT                  = 26
PROMPT_ABSORBED_COUNT               = 26
PROMPT_PARTIAL_EXECUTION_COUNT      = 18
PROMPT_NOT_EXECUTED_COUNT           = 4
PROMPT_ROLLED_BACK_COUNT            = 4
PROMPT_RUNTIME_CLOSED_COUNT         = 0
PROMPT_MD_REMAINING_COUNT           = 0
```

| 组 | 提示词 | 复核状态 | Absorbed Into |
|---|---|---|---|
| 空白行 authority | `TRAE-RENDERED-BLANK-ROW-AUTHORITY-CLOSURE`、`TRAE-RENDERED-BLANK-ROW-COORDINATE-CLOSURE`、`TRAE-BLANK-ROW-PAINT-LAYER-GEOMETRY-CLOSURE` | 部分执行，Runtime PENDING | document-utilities.md § 空行诊断的三层 authority / Rendered Blank Row 坐标闭合 / Blank Row Paint-Layer Calibration |
| 空白几何标记 | `TRAE-INKCHAPTER-BLANK-LINE-MARKER-GEOMETRY-CLOSURE`、`TRAE-INKCHAPTER-BLANK-DIAGNOSTIC-SOURCE-GEOMETRY-LIFECYCLE-CLOSURE`、`trae-unified-diagnostic-geometry-closure` | 未执行 / 被后续承接 | document-utilities.md § 空行与 EOF 标记的三类几何 / Unified Visual Geometry Transaction |
| Block gap | `TRAE-INTERNAL-BLANK-GAP-CANONICAL-LOCATOR-CLOSURE` | 部分执行，Runtime UNVERIFIED | document-utilities.md § 连续空行 Block Gap 的 Canonical Boundary 定位 |
| 空代码块 V6/V7/V8 | `...EMPTY-BLOCK-CONTAINER-PRESENTATION-CLOSURE-V6`、`...SURFACE-PAINT-CLOSURE-V7`、`...PERSISTENT-CARRIER-CLOSURE-V8`、`TRAE-CODE-EMPTY-BLOCK-GENERIC-PIPELINE-REBASE` | 专属路线已回退；通用管线部分落地 | document-utilities.md § CODE_EMPTY_BLOCK 通用 Code 管线接管与 V6/V7/V8 回退 / § Plugin Presentation Mutation 短路；document-diagnostics.md §14 |
| Source syntax | `...SOURCE-SYNTAX-LOCATION-PRESENTATION-CLOSURE-V4`、`...SOURCE-SYNTAX-SOURCE-DOM-PROJECTION-COMMIT-CLOSURE-V5` | 部分执行，Runtime UNVERIFIED | document-utilities.md § Source-Syntax Opener Locator / § Canonical Source Range → DOM Projection Authority；document-diagnostics.md §4 / §10 |
| Document end | `TRAE-DOCUMENT-END-NEWLINE-MARKER-CLOSURE` | 部分执行，Runtime PENDING | document-utilities.md § Document-End 缺少末尾换行：EOF 端点标记 |
| 视觉事务 / 标注 | `TRAE-INKCHAPTER-UNIFIED-VISUAL-GEOMETRY-TRANSACTION-CLOSURE`、`TRAE-INKCHAPTER-CODE-COMPOSITE-MARKER-RESIZE-CLOSURE`、`TRAE-INKCHAPTER-DIAGNOSTIC-ANNOTATION-OVERLAP-CLOSURE` | 部分执行 / 无执行产物 | document-utilities.md § Unified Visual Geometry Transaction / § Code Composite Marker Resize / § 标题诊断标注非重叠布局 |
| ENTER / EOF / EN11 / P0 | `EN11-CAUSAL-CLOSURE-R3`、`EN11-R4-REAL-ACCEPTANCE...`、`ENTER-DUPLICATE-SPLIT...`、`ENTER-EOF-ROOT-CAUSE...`、`EOF-ENTER-BLANK-SEMANTICS...`、`EOF-VISUAL-SYNC-R5`、`P0-EDITOR-CARET-EOF-FULL-CLOSURE`、`P0-EDITOR-EOF-CARET-LEDGER-INTEGRATED-R2` | 部分执行 / 已回退 / 未执行 | document-utilities.md § EOF-R5（补充 4 条）/ § EN-11（补充 4 条）/ § P0-CARET-EOF（补充 3 条） |
| 侧栏冻结 | `TRAE-INKCHAPTER-TYPORA-FREEZE-RIBBON-RUNTIME-CLOSURE` | 部分执行，R1 真机通过 | sidebar-integration.md § Ribbon 可见性（ui.ribbon）与 LC-01 |

> 口径修正：上两轮矩阵的 `Remaining Gap=NONE` 与实际文档不符，本轮以补写后的章节为准；凡 Runtime 未取证项仍标 `NOT_RUN` / `PENDING`，未升级为 PASS。
