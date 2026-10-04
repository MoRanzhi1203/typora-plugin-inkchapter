# 墨章 InkChapter 文档索引

欢迎。这是墨章 InkChapter 插件的正式文档入口。新开发者仅阅读 [../README.md](../README.md)、本索引与 [../CHANGELOG.md](../CHANGELOG.md)，即可理解当前真实功能、架构、验证方法与已知限制，**无需**阅读任何历史提示词。

## 架构（Architecture）

- [plugin-architecture.md](architecture/plugin-architecture.md) — 分层、生产入口、依赖方向、生命周期、设置持久化。
- [identity-presentation-authorities.md](architecture/identity-presentation-authorities.md) — 源身份 / 对象身份 / 定位 / 呈现 / 事务与 lease / Layout Epoch / 文档隔离，及 `CURRENT|PARTIAL|DEFERRED` 标注。
- [decisions/](decisions/) — 架构决策记录 ADR-001…ADR-005。

## 模块（Modules）

- [modules/README.md](modules/README.md) — 模块索引。
- [modules/heading-numbering.md](modules/heading-numbering.md) — 标题自动编号。
- [modules/numbering-presets.md](modules/numbering-presets.md) / [modules/custom-multilevel-format.md](modules/custom-multilevel-format.md) — 编号预设与自定义多级格式。
- [modules/strict-loose-heading-structure.md](modules/strict-loose-heading-structure.md) — Strict/Loose 与共享样式槽。
- [modules/heading-range-control.md](modules/heading-range-control.md) / [modules/special-heading-rules.md](modules/special-heading-rules.md) — 级数范围与特殊标题。
- [modules/heading-layout.md](modules/heading-layout.md) / [modules/outline-numbering.md](modules/outline-numbering.md) — 标题排版与大纲编号。
- [modules/caption-system.md](modules/caption-system.md) / [modules/formula-numbering.md](modules/formula-numbering.md) — 题注与公式编号。
- [modules/document-utilities.md](modules/document-utilities.md) / [modules/document-diagnostics.md](modules/document-diagnostics.md) — 文档工具与文档诊断。
- [modules/settings-ui.md](modules/settings-ui.md) — 设置工作台。
- [modules/ui-visual-system.md](modules/ui-visual-system.md) — UI 视觉体系。
- [modules/document-scoped-settings.md](modules/document-scoped-settings.md) / [modules/format-application-state.md](modules/format-application-state.md) / [modules/sidebar-integration.md](modules/sidebar-integration.md) — 文档级设置、格式应用状态、侧栏兼容。
- [modules/plugin-lifecycle-and-global-loading.md](modules/plugin-lifecycle-and-global-loading.md) — 插件生命周期与全局加载。
- [modules/runtime-audit-and-identity.md](modules/runtime-audit-and-identity.md) — 运行时审计与身份。

## Diagnostics Capability Matrix

- [diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md](diagnostics/DOCUMENT-DIAGNOSTICS-CAPABILITY-MATRIX.md) — 规则矩阵（唯一权威，由 `scripts/document-diagnostics/generate-capability-matrix.mjs` 生成）。
- [diagnostics/DOCUMENT-DIAGNOSTICS-VNEXT-GAP-LEDGER.md](diagnostics/DOCUMENT-DIAGNOSTICS-VNEXT-GAP-LEDGER.md) — VNext 规则实现状态与延后原因。

## 运维（Operations）

- [operations/build-and-deploy.md](operations/build-and-deploy.md) — 构建、部署、全局插件安装、SHA parity。
- [operations/runtime-verification.md](operations/runtime-verification.md) — 运行时身份验证（15 项）。
- [operations/testing.md](operations/testing.md) — 测试 vault 与检查清单。
- [operations/development.md](operations/development.md) — 开发环境与流程。
- [operations/prompt-lifecycle.md](operations/prompt-lifecycle.md) — 提示词治理（历史证据规则；提示词文档已于 2026-10 整合退休）。

## Roadmap

- [roadmap/known-gaps-and-deferred-work.md](roadmap/known-gaps-and-deferred-work.md) — 已知缺口与被延后能力。

## Maintenance

- [maintenance/prompt-consolidation-record.md](maintenance/prompt-consolidation-record.md) — 全部已删除提示词的迁移记录。
- [maintenance/prompt-cleanup-history.md](maintenance/prompt-cleanup-history.md) — 历史清理日志。

## Changelog

- [../CHANGELOG.md](../CHANGELOG.md)

## 校验

- 文档一致性校验脚本：[scripts/docs/verify-docs.mjs](../scripts/docs/verify-docs.mjs)（检查断链、缺失源码/脚本/fixture 路径、陈旧提示词引用、重复 canonical 文档）。
