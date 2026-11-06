# Prompt Archive Manifest — 2026-11-06

> 本文档记录 2026-11-06 归档批次：工作目录中**已确认执行完毕**的 Markdown 提示词。
> 归档原件保留在 `本地归档目录（2026-11-06 批次）`（本地，不发布到 GitHub）；`本地待执行目录`
> 只保留**未完成/待执行**任务（本批次执行后为空）。
>
> 状态与动作定义遵循 [../operations/prompt-lifecycle.md](../operations/prompt-lifecycle.md)：
> `ExecutionStatus ≠ FinalAction`。本批全部为 `EXECUTED_CONFIRMED` + `ARCHIVE_EXECUTED`。

## 一、归档清单

| # | Prompt | Topic | ExecutionStatus | FinalAction | AbsorbedBy | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `InkChapter_CodeBlock_V4_Trae_Prompt.md` | 代码块尾部连续空行导致折叠失效 + 代码块 L1/L2 诊断 | `EXECUTED_CONFIRMED` | `ARCHIVE_EXECUTED` | `docs/modules/document-utilities.md` § 空代码块诊断；`src/document-utilities/document-diagnostic-code-block-v4.ts` | `6C2B7854…6C084E` |
| 2 | `InkChapter_Content_Block_Toolbar_Trae_Prompt.md` | 内容块悬停工具栏（代码复制/折叠、图片复制、统一交互） | `EXECUTED_CONFIRMED` | `ARCHIVE_EXECUTED` | `docs/modules/document-utilities.md`；`src/document-utilities/content-block-toolbar-controller.ts` | `767C998D…5FE88A` |
| 3 | `INKCHAPTER_IMAGE_DUAL_LINK_DEDUP_TRAE_V4.md` | 图片双链与内容去重（V4.0） | `EXECUTED_CONFIRMED` | `ARCHIVE_EXECUTED` | `docs/modules/image-management/image-management-implementation.md`；`src/image-management/image-asset-service.ts` | `EC2B14B1…27EFF23` |
| 4 | `INKCHAPTER_IMAGE_MANAGEMENT_TRAE_MASTER_PLAN.md` | 图片管理总规划（上传/下载/图库/缓存/离线/分享/迁移/三级配置） | `EXECUTED_CONFIRMED` | `ARCHIVE_EXECUTED` | `docs/modules/image-management/image-management-implementation.md`；`src/image-management/*` | `EDDC17F2…A90C0C5` |
| 5 | `TRAE-INKCHAPTER-GITHUB-REPOSITORY-HISTORY-HYGIENE.md` | GitHub 仓库当前树与历史清理 | `EXECUTED_CONFIRMED` | `ARCHIVE_EXECUTED` | `docs/maintenance/prompt-cleanup-history.md`；`scripts/verify-image-privacy.mjs` | `304F6B8B…527BEF` |
| 6 | `TRAE-INKCHAPTER-PARAGRAPH-INDENT-FULL-AUDIT-REPAIR.md` | 段落缩进 V2 全量审计修复与 GUI 收口 | `EXECUTED_CONFIRMED` | `ARCHIVE_EXECUTED` | `docs/modules/heading-layout.md` § 缩进解析优先级；`src/heading-numbering/paragraph-indent-*.ts` | `7252E228…1286FA` |

## 二、执行状态证据（代码 / 测试 / 提交）

| Prompt | 代码证据 | 测试证据 | 提交证据 |
| --- | --- | --- | --- |
| CodeBlock V4 | `document-diagnostic-code-block-v4.ts`、`content-block-toolbar-controller.ts`（折叠控制） | `document-diagnostic-code-block-v4.test.ts`、`content-block-toolbar-*` 系列测试 | 代码块 V3/V4 系列提交（V4 诊断与折叠稳定） |
| Content Block Toolbar | `content-block-toolbar-controller.ts`、`content-block-toolbar-target.ts`、`content-block-toolbar-image-actions.ts` | `content-block-toolbar-controller.test.ts` 等 6 个测试文件 | 工具栏系列提交 |
| Image Dual Link V4 | `image-asset-service.ts`、`document-remote-download.ts`、`image-reference-rewrite.ts` | `image-asset-*`、`document-remote-download.test.ts` 等 | `c63f39f feat(image): V4 dual-link dedup + remote duplicate reference locator fix` |
| Image Master Plan | `image-upload-service.ts`、`image-download-service.ts`、`image-library-center.ts`、`image-cache-service.ts`、`image-offline-service.ts`、`image-share-package.ts`、`image-path-migration.ts`、`image-scope-*` | 图片管理 279+ 测试（历史记录）与 V4.0 验收 | V4.0 系列提交 |
| GitHub Hygiene | `scripts/verify-image-privacy.mjs`、`.gitignore` 规则、历史重写（filter-repo） | `verify-image-privacy.mjs --all` PASS | `f828f34`、`e2c5967 fix(privacy): scan all tracked files…` |
| Paragraph Indent V2 | `paragraph-indent-manager.ts`、`paragraph-indent-eligibility.ts` | `paragraph-indent-v2-eligibility.test.ts` 等 4 个 V2 测试 | 缩进 V2 系列提交 |

## 三、归档处置

- 6 个原件从 `本地待执行目录` 移动到 `本地归档目录（2026-11-06 批次）`；
- `本地待执行目录` 保留目录本身（项目本地规则），当前没有未完成任务；
- `本地提示词目录` 整个目录在 `.gitignore` 中（本地保存、不发布），本次归档不改变该发布策略；
- 未删除任何未完成提示词、归档原件、原始数据或用户未提交修改。

## 四、已知遗留（不影响归档判定）

- GitHub 历史清理：旧提交 SHA（`1d4d370`/`2973b6b` 等）在 GitHub 完成 GC 前仍可能通过旧链接访问；这是平台侧行为，仓库当前树已清理并通过隐私门禁。详见 `docs/maintenance/prompt-cleanup-history.md`。
