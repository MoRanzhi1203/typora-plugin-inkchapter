# 正文诊断徽章 Runtime 验收（R14）

验收脚本：`pnpm run accept:diagnostic-badges`（仅 `test/vault`，通过请求 token + 专用验收文档启用）。

## 夹具

- 主体：`test/vault/墨章插件测试/08-标题编号与跳级翻转测试.md`（真实标题跳级 + 重复标题夹具）。
- 聚合场景（脚本追加）：`### 5 实验` → `##### 5 实验`，同一标题同时产生「层级跳级 / 重复标题 / 重复规范身份」，用于验证 `2 个具体徽章 + +N`。
- 修复场景（脚本追加）：`## 1.1 1.1 双重编号测试`，提供真实 `HEADING_DOUBLE_NUMBER_PREFIX`（AUTO_SAFE）修复目标。

## 验收步骤与证据（2026-11-18，PASS）

| 步骤 | 内容 | 结果 |
|---|---|---|
| `badges-presentation` | 文案 / 严重级别 / 聚合数量 / tooltip / 行号全部与同一份诊断快照一致；无「标题问题」等泛化文案 | PASS |
| `badges-click-specific` | 点击具体徽章 → 面板打开 → 选中同一 diagnosticId；Markdown 不变 | PASS |
| `badges-click-summary` | 点击 `+N` → 面板打开 → 该标题全部诊断行临时聚焦；Markdown 不变 | PASS |
| `badges-keyboard` | 键盘 `Enter` 激活徽章并选中同一诊断 | PASS |
| `badges-fix-undo` | 真实单项修复 → 源码更新 → 徽章消失 → `Ctrl+Z` 等价 Undo → 徽章恢复 | PASS |
| `badges-content-reset` | 内容清空 → 旧徽章清零 → 恢复 → 徽章重建；标题编号不变 | PASS |

## 真实 DOM 证据（节选）

- H5「5 实验」：4 个真实诊断 → 正文显示 `层级跳级 H3→H5`（error）、`编号格式异常`（warning）、`+2`（summary），summary scope 记录全部 4 个 diagnosticId。
- H2「第一章」：显示 `双重编号`、`编号不一致` 两枚具体徽章；修复后 `HEADING_DOUBLE_NUMBER_PREFIX` 徽章消失，撤销后恢复。
- H3「第一节」：显示 `重复标题：第一节`（warning）。
- H2「第二章」：显示 `编号错序`（warning）。
- 每个 marker 的 tooltip 均包含完整规则名、一句说明与真实 `Lxx`（例如 H5 行 9、H2 行 13）。

## 关联实现

- 展示模型：`src/document-utilities/document-diagnostic-badge-v1.ts`
- DOM 渲染与交互：`src/document-utilities/document-utility-overlay-host.ts`
- 验收 runner：`src/runtime/diagnostic-badge-acceptance-runner.ts`
- 启动器：`scripts/run-diagnostic-badge-acceptance.mjs`
- 单元测试：`document-diagnostic-badge-v1.test.ts`、`document-heading-diagnostic-marker-surface-v512-r9.test.ts`（R14 交互 / CSS）
