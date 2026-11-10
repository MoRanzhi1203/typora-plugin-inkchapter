# 墨章文档诊断三批次 — 执行日志

> 任务书：`INKCHAPTER_DIAGNOSTICS_THREE_BATCHES_DSH_MASTER.md`（项目根目录，未跟踪用户资料，保留原文件）。
> 本日志只记录实际执行过、可复现的 Git / 测试 / 构建 / 验收证据；不记录未执行的推测。
> 时间均为本机时区（Etc/GMT-8）。为避免泄露，本文件不写入本机绝对路径、凭据或用户 Markdown 内容。

## 2026-11-10 — GIT-0 主线整合（GIT-0.1 / GIT-0.2）

### 审计快照

| 项 | 值 |
|---|---|
| 开发前分支 | `feature/document-status-image-batch` |
| 开发前 HEAD | `b951c07bc00d6b7a6aba2e41eed9ee90ec46d613` |
| 本地 `main` | `6341c0606fce7b203c700355bb97d406f976b79c` |
| `origin/main`（本地跟踪引用） | `6341c0606fce7b203c700355bb97d406f976b79c` |
| 血缘 | `main` 是功能分支祖先；`main...HEAD` = `0 16`（功能分支领先 16 个提交） |
| 工作区 | 无已跟踪修改；5 个未跟踪文件（见保全表） |
| 进行中的 merge/rebase | 无（`.git/MERGE_HEAD`、`rebase-merge`、`rebase-apply` 均不存在） |
| 现有 worktree | 主工作树 + `runtime/ab/A`、`runtime/ab/B`（均为 detached HEAD，未改动） |
| stash | 1 条既有 stash（`archive/heading-reason-chip-stable-anchor-v2` 的 runtime sidecar），未触碰 |
| `dist/` | 被 `.gitignore` 忽略，不进入版本库 |

### 未跟踪成果保全

| 文件 | SHA256 | 处置 |
|---|---|---|
| `INKCHAPTER_DIAGNOSTICS_THREE_BATCHES_DSH_MASTER.md` | `7E9E6A641BDC071A5C955B143356E17C1F6DF25284BA976C8825A2364B72C136` | 保留在项目根目录，未提交（用户资料） |
| `INKCHAPTER_V52_COMPACT_INSPECTOR_FINAL_DSH.md` | `246A8DA609B95BC27236F4BD4AC293C51759DDBDB1746829CBA9BD78D389CBEC` | 保留，未提交 |
| `INKCHAPTER_V52_FLUENT_COMPACT_UI_DSH.md` | `8B16DD123854E4F2AC97E44B26AD321AC8DD9CD511B0C9709B68A743A4F7B1D1` | 保留，未提交 |
| `INKCHAPTER_V52_UI_LAYOUT_REDESIGN_DSH.md` | `47D5A559301CA11C42317D5B09AE8260E73ED71B4E04FF5D161DE6BA85EE86FD` | 保留，未提交 |
| `docs/diagnostics/DOCUMENT_DIAGNOSTICS_FULL_INVENTORY.md` | `ADC61923FC42B7FB2EE196B243C8A5FFCB85F4DE0AB521CBBE93A481D8BD50F9` | 本轮审计成果，提交到 `main` |

### 开发前基线门禁（功能分支）

| 命令 | 结果 |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | PASS，exit 0 |
| `node node_modules/vitest/vitest.mjs run --reporter=dot` | PASS，327 文件 / 5783 测试，203.90s |
| `node scripts/progress-archive.mjs verify` | PASS，ENTRY_COUNT=39 |
| `node scripts/verify-image-privacy.mjs` | PASS，SCANNED_LINES=0 |
| `node scripts/docs/verify-docs.mjs` | PASS，DOC_BROKEN_LINK_COUNT=0 |
| `node build.js --prod` | PASS，`dist/main.js` SHA256 `7BB0DF417B3C912CC66E84FA56260CF7A34A811417D1E8AA9549124987A53312` |

### 合并

- 方式：`git merge --no-ff feature/document-status-image-batch`
- 结果：PASS，无冲突
- merge commit：`3b20ea51f9f1ac35febbe273e4d7ca3ba59e0ed5`
- 合并规模：51 files changed，+4680 / -95
- 合并后 `main` HEAD：`3b20ea51f9f1ac35febbe273e4d7ca3ba59e0ed5`
- 远端：未 push；本地 `main` 领先 `origin/main` 17 个提交（16 个功能提交 + merge commit）。远端可用性/分支保护尚未验证，按任务书保留本地合并并记录待办。

### 合并后门禁

| 命令 | 结果 |
|---|---|
| TypeScript | PASS，exit 0 |
| 全量 Vitest | PASS，327 文件 / 5783 测试，193.72s |
| 隐私检查 | PASS，SCANNED_LINES=0 |
| 文档检查 | PASS，RESULT=PASS |
| 生产构建 | PASS，`dist/main.js` SHA256 `7BB0DF417B3C912CC66E84FA56260CF7A34A811417D1E8AA9549124987A53312` |

### 决策

- 现有功能分支的 16 个提交全部属于 V5.1 文档中心 / 导航器修复 / V5.2 Compact Inspector，未见敏感文件、构建缓存或未审查的大范围无关重构；执行 `--no-ff` 合并保留血缘。
- 未删除任何分支、stash、worktree 或历史提交。
- `BASELINE_MAIN_SHA` 在合并后文档提交完成后记录。

### 基线文档提交

- 提交内容：`DOCUMENT_DIAGNOSTICS_FULL_INVENTORY.md`、本执行日志、`DIAGNOSTICS-THREE-BATCH-CHECKLIST.md`
- `BASELINE_MAIN_SHA`：见本节提交后的 `git rev-parse main`（记录于 B1 启动前）
- 未跟踪用户资料（任务书与三份 V5.2 提示词）保持原样，不进入版本库。

## 追加记录

### 2026-11-10 — B1 诊断可靠性

- 分支：`feature/diagnostics-b1-reliability`（从 `BASELINE_MAIN_SHA=4017d598134720396fe28ccae53488e9f95886ac` 创建）
- 代码集合：92 家族 / 98 注册解析代码 / 103 展开代码 / 98 生产器代码 / 95 可达代码（CB008、CB010、STRICT_FIRST_H1_DOCUMENT_EMPTY 不可达）
- 严重程度：注册表基准 12/62/29；可达 12/56/27；strict 可达 14/60/21
- 定向测试：B1 相关 16 文件 / 328 tests PASS
- 全量测试：329 文件 / 5805 tests PASS，129.25s
- TypeScript：PASS
- 构建：PASS，dist/main.js SHA256 `FD45A411B5B514161CAD673D975FE7EF7E6B728178381C9B64CCD493AFE1C4B4`
- 隐私：PASS（SCANNED_LINES=0）；文档：PASS（DOC_BROKEN_LINK_COUNT=0）
- GUI：`NEEDS_MANUAL`（自动测试无法代替真实 Typora 像素/点击验收；未伪造截图或 runtime closure）
- B1 报告：`docs/diagnostics/DIAGNOSTICS-BATCH-1-REPORT.md`
- 合并：`git merge --no-ff feature/diagnostics-b1-reliability` → `19bf0dc9317a6ee4ed3458e4f0cc78c5c9f73a0e`
- 合并后全量：329 文件 / 5805 tests PASS，131.96s
- 合并后 TypeScript / 构建 / 隐私：PASS（`dist/main.js` SHA256 `FD45A411B5B514161CAD673D975FE7EF7E6B728178381C9B64CCD493AFE1C4B4`）
- 备注：B1-07 真实 GUI 确认仍为 `NEEDS_MANUAL`；B1 的代码/测试门禁已 PASS，未将 NEEDS_MANUAL 记为 PASS。

### 2026-11-10 — B2 规则扩展（PARTIAL）

- 分支：`feature/diagnostics-b2-rule-expansion`（从 `f71d16b` 创建）
- 已实现：FRONTMATTER_MALFORMED、TABLE_COLUMN_COUNT_MISMATCH、LIST_INDENTATION_INVALID、FORMULA_SOURCE_LENGTH_EXCEEDING（默认关闭）、FORMULA_SOURCE_LINE_TOO_LONG（默认关闭）、FORMULA_RENDER_WIDTH_OVERFLOW、FORMULA_LATEX_RENDER_FAILED
- 规则总数：98 家族 / 104 注册解析代码 / 109 展开代码 / 105 生产器代码 / 100 可达；DEFERRED 4（BLOCKED）
- 定向测试：B2 14 tests PASS；计数/能力/闭包 84 tests PASS
- 全量测试：330 文件 / 5819 tests PASS，123.68s
- TypeScript：PASS；隐私：PASS；文档：PASS
- 构建：PASS，`dist/main.js` SHA256 `BE23061EAFAA0A5717F28C0FFA7D0102EA04BBD61D09287B60E250C653D6078B`
- BLOCKED：LINK_LOCAL_FILE_ANCHOR_MISSING、3 条交叉引用（无 canonical 语法/文件锚点权威）；TABLE_ALIGNMENT_INVALID、HEADING_NUMBER_SEQUENCE_INVALID、图片格式（缺可靠权威）
- B2 报告：`docs/diagnostics/DIAGNOSTICS-BATCH-2-REPORT.md`
- 合并：`git merge --no-ff feature/diagnostics-b2-rule-expansion` → `8d5e475e3dd334d99d0e8de329d7f8c920e15163`
- 状态：PARTIAL（实现项 PASS；4 条 DEFERRED 与表格对齐/标题编号/图片格式 BLOCKED，未虚假标记）

### 2026-11-10 — B3 学术档案与 Compact Inspector（PARTIAL）

- 分支：`feature/diagnostics-b3-academic-ui`（从 `55db668` 创建）
- 已实现：profile 模型（general/academic/lab-report/custom、继承、显式启停、未知规则、循环）；版心模型（720/820/900/960 + 自定义 clamp）；profile → 公式源码限制/宽度 cap 接线
- 未实现：profile 设置 UI/持久化（BLOCKED）；版心写入（BLOCKED）；学术/实验报告其余可选规则（无确定语义）；真实 GUI/DPI/主题/DOMRect（NEEDS_MANUAL）
- 规则总数不变：98 家族 / 104 注册解析代码 / 109 展开代码 / 105 生产器代码 / 100 可达
- 全量测试：331 文件 / 5832 tests PASS，126.31s
- TypeScript / 隐私 / 文档：PASS
- 构建：PASS，`dist/main.js` SHA256 `084CD8277859AB15B1C116A5FC87494CF4242081151F6E02DFB1B36411FADECD`
- B3 报告：`docs/diagnostics/DIAGNOSTICS-BATCH-3-REPORT.md`
- 合并：`git merge --no-ff feature/diagnostics-b3-academic-ui` → `842074c89bed270a188071625a257f5fd2eb1920`
- 状态：PARTIAL（profile/width 纯模型 PASS；设置 UI/版心写入 BLOCKED；真实 GUI NEEDS_MANUAL）

### 2026-11-10 — 最终总验收

- 最终 main（本文提交前）：`842074c89bed270a188071625a257f5fd2eb1920`
- 规则：98 家族 / 104 注册解析代码 / 109 展开代码 / 105 生产器代码 / 100 可达；13-67-29 基准，可达 13-60-27
- 测试：331 文件 / 5832 tests PASS；构建 SHA `084CD8277859AB15B1C116A5FC87494CF4242081151F6E02DFB1B36411FADECD`
- 状态：GIT-0 / B1 代码 PASS；B2/B3 PARTIAL；GUI NEEDS_MANUAL；存在 BLOCKED，未达到 `ALL_MANDATORY_TASKS_PASS`
- 最终报告：`docs/diagnostics/DIAGNOSTICS-THREE-BATCH-FINAL-REPORT.md`

（后续批次在此追加；每批次包含分支、HEAD、任务、测试、构建 SHA、合并 SHA、阻塞/待人工验收。）
