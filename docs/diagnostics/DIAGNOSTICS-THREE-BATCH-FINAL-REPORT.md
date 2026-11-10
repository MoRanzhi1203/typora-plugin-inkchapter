# 墨章文档诊断三批次 — 最终交付报告

> 时间：2026-11-10（Etc/GMT-8）
> 项目：typora-plugin-inkchapter
> 依据：`INKCHAPTER_DIAGNOSTICS_THREE_BATCHES_DSH_MASTER.md`
> 结论：**GIT-0 与 B1 代码门禁 PASS；B2/B3 为 PARTIAL；真实 GUI 为 NEEDS_MANUAL；存在有证据的 BLOCKED，未满足 `ALL_MANDATORY_TASKS_PASS`。**

## 1. Git 总览

| 阶段 | 分支 / 引用 | SHA | 结果 |
|---|---|---|---|
| 整合前 | `feature/document-status-image-batch` | `b951c07` | 领先 main 16 个提交 |
| 整合前 main | `main` | `6341c06` | 与 `origin/main` 一致 |
| GIT-0 合并 | `main` | `3b20ea5` | `--no-ff`，无冲突 |
| GIT-0 文档基线 | `main` | `4017d59` | `BASELINE_MAIN_SHA` |
| B1 合并 | `main` | `19bf0dc` | 代码/测试 PASS；GUI NEEDS_MANUAL |
| B2 合并 | `main` | `8d5e475` | PARTIAL；7 条规则实现，4 条 DEFERRED BLOCKED |
| B2b 合并 | `main` | `c722e3a` | HEADING_NUMBER_SEQUENCE_INVALID 实现，B2 规则增至 8 条 |
| B2c 合并 | `main` | `316e06d` | FIGURE_IMAGE_FORMAT_UNSUPPORTED（显式非图片扩展名） |
| B3b 合并 | `main` | `ca29669` | profile 设置页/持久化 + 版心 CSS 变量；代码 PASS，GUI NEEDS_MANUAL |
| B3 合并 | `main` | `842074c` | PARTIAL；profile/width 纯模型 PASS，UI/GUI BLOCKED/NEEDS_MANUAL |
| B2d 合并 | `main` | `1d0a359` | TABLE_ALIGNMENT_INVALID + 跨文件 anchor 三态接口/审计 |
| 2026-11-11 专项合并 | `main` | `442a759` | 图片异步证据 Provider + `inkchapter-ref:` parser（均模块级，未启用规则） |
| 最终 main | `main` | `442a759`（本报告提交后更新为最新 docs commit） | **未推送**；远端保护/可用性未验证，本地保留全部提交 |
| 远端 | `origin` | `origin/main` 仍为 `6341c06` | **未推送**；远端可用性/保护规则未验证，本地保留全部提交 |

未执行 `reset --hard` / `clean -fd` / `push --force`；未删除分支、stash、worktree；既有 stash 与 `runtime/ab/A|B` worktree 未触碰。

## 2. 规则总览（以当前源码为准）

| 口径 | 数值 |
|---|---:|
| 规则家族 | 101 |
| 注册表解析代码 | 107 |
| 展开后的具体代码 | 112 |
| 有生产器路径的代码 | 108 |
| 真正可达的代码 | 103 |
| DEFERRED（BLOCKED） | 4 |
| 默认关闭 | 4（CB008、CB010、公式源码长度、公式单行长度） |
| 错误 / 警告 / 提示（家族） | 13 / 64 / 24 |
| 错误 / 警告 / 提示（112 代码） | 13 / 70 / 29 |
| 可达 103 代码 | 13 / 63 / 27 |
| strict 可达 103 代码 | 15 / 67 / 21 |
| 当前构建运行时闭包已证实 | 0（97 个 IMPLEMENTED 全部 UNVERIFIED） |

代码集合审计：`document-diagnostic-code-sets.ts` + `document-diagnostic-code-sets.test.ts`；五集合与差集守恒，不把家族/解析代码/展开代码/实例混淆。

## 3. 批次明细

### 3.1 GIT-0（PASS）

- 审计当前分支、main、origin/main、ahead/behind、worktree、stash、未跟踪文件。
- 未跟踪的审计报告提交；任务书与三份 V5.2 提示词保留未跟踪，记录 SHA256。
- 合并前门禁：typecheck PASS；327 文件 / 5783 tests PASS；build SHA `7BB0DF41…`；privacy/docs PASS。
- 合并后门禁：typecheck PASS；327 / 5783 PASS；build 同 SHA；privacy/docs PASS。
- 详见 `DIAGNOSTICS-THREE-BATCH-EXECUTION-LOG.md`。

### 3.2 B1（代码 PASS；GUI NEEDS_MANUAL）

完成：
- 代码集合权威（92→B1 的 92/98/103/95 构成修正；B2+B2b 后为 99/105/110/106/101）。
- 状态方块/列表计数改为“规范化诊断事件”；multi-target 1 event / N rows。
- 4 条编号规则定位契约与生产器对齐。
- CB007 接入原始换行数据；CB008/CB010 defaultEnabled=false；STRICT_FIRST_H1_DOCUMENT_EMPTY knownUnreachable。
- strictPolicyActive 接入 strict-only 门控。
- source-unavailable 与 CB009/CODE_EMPTY_BLOCK 同根因抑制；空行注释修正。
- 图/表/代码重名行为测试；stale revision 拒绝；JSDOM/`getComputedStyle` 颜色断言。
- 报告：`DIAGNOSTICS-BATCH-1-REPORT.md`。

未完成：
- 真实 Typora 像素/点击验收（NEEDS_MANUAL）；未伪造截图或运行闭包。

### 3.3 B2（PARTIAL）

已实现（10）：
- FRONTMATTER_MALFORMED
- TABLE_COLUMN_COUNT_MISMATCH
- TABLE_ALIGNMENT_INVALID（独立 delimiter cell 语法）
- LIST_INDENTATION_INVALID
- HEADING_NUMBER_SEQUENCE_INVALID
- FIGURE_IMAGE_FORMAT_UNSUPPORTED（显式非图片扩展名）
- FORMULA_SOURCE_LENGTH_EXCEEDING（默认关闭）
- FORMULA_SOURCE_LINE_TOO_LONG（默认关闭）
- FORMULA_RENDER_WIDTH_OVERFLOW（需 MEASURED 事实）
- FORMULA_LATEX_RENDER_FAILED（需 FAILED 事实）

BLOCKED（有证据）：
- LINK_LOCAL_FILE_ANCHOR_MISSING：无 canonical 跨文件 heading id/slug authority。
- FIGURE / TABLE / FORMULA_REFERENCE_TARGET_MISSING：无 Typora 对象引用语法/canonical 对象引用 parser。
- TABLE_ALIGNMENT_INVALID：已证明是独立缺陷（松 delimiter 识别 + 非法 cell），已实现，不再 BLOCKED。
- 图片格式 / 重复图片：无可靠 file-info/字节 provider；仅实现“显式非图片扩展名”规则。
- 公式渲染高度（可选）未做。

报告：`DIAGNOSTICS-BATCH-2-REPORT.md`。

### 3.4 B3（PARTIAL）

已实现：
- `document-diagnostic-profile-v1.ts`：general / academic / lab-report / custom；继承、显式启停、未知规则 issue、循环检测；10 tests。
- `document-diagnostic-academic-width-v1.ts`：narrow/standard/wide/lab-report + 自定义 px clamp；3 tests。
- profile → 公式源码限制 / 宽度 cap 接线；3 tests。
- 设置页「文档诊断 · 学术档案」：诊断档案/版心宽度/自定义 px；`resolveUiSettings` 校验；写回持久化；`applyAcademicProfile()` 应用 CSS 变量 + body class；仅作用于墨章命名空间。

BLOCKED / NEEDS_MANUAL：
- 学术/实验报告其余可选规则：无确定语义，未虚构规则 ID。
- 真实 GUI/DPI/主题/DOMRect：无法在 DSH 完成控件级点击/截屏验收，标记 NEEDS_MANUAL。本轮尝试 `--user-data-dir` 隔离 Typora 实例，未出现新窗口（单实例行为），未伪造截图。
- profile 设置页/版心写入已实现代码级与设置页接线；真实视觉仍 NEEDS_MANUAL。

报告：`DIAGNOSTICS-BATCH-3-REPORT.md`。

## 4. 验证汇总

| 阶段 | 测试 | 构建 SHA256 |
|---|---|---|
| GIT-0 合并前 | 327 文件 / 5783 tests PASS | `7BB0DF417B3C912CC66E84FA56260CF7A34A811417D1E8AA9549124987A53312` |
| GIT-0 合并后 | 327 文件 / 5783 tests PASS | 同上 |
| B1 | 329 文件 / 5805 tests PASS | `FD45A411B5B514161CAD673D975FE7EF7E6B728178381C9B64CCD493AFE1C4B4` |
| B2 | 330 文件 / 5819 tests PASS | `BE23061EAFAA0A5717F28C0FFA7D0102EA04BBD61D09287B60E250C653D6078B` |
| B2b / B3b / B2c / B2d / 2026-11-11 专项 | 336 文件 / 5878 tests PASS | `17E64A21388DDE062A0F0E529AD508DB76BE759F6FD36610F27AC6238B9F5762` |
| B3 | 336 文件 / 5878 tests PASS | 同上 |

每批次 typecheck PASS；privacy PASS（SCANNED_LINES=0）；docs PASS（DOC_BROKEN_LINK_COUNT=0）。构建产物 `dist/` 被 `.gitignore` 忽略，未提交。

## 5. 未完成 / 阻塞

| ID | 状态 | 解除条件 |
|---|---|---|
| B1-07 | NEEDS_MANUAL | 真实 Typora 中验证 1 warning→amber、multi-target 1 event/2 rows、stale 切换、锁定细框；提供截图 + DOMRect |
| B2 file-anchor | BLOCKED | 提供 `resolveLocalFileAnchor(path, anchor): EXISTS/MISSING/UNKNOWN` canonical provider |
| B2 cross-reference ×3 | BLOCKED | 定义并实现 Typora 支持的对象引用语法 + canonical 编号 parser |
| B2 table alignment | BLOCKED | canonical table parser 提供 alignment 结果 |
| B2 heading sequence | BLOCKED | heading effective-number provider |
| B2 image format/duplicate | BLOCKED | 可靠 image file-info/字节 provider |
| B3 profile settings UI | PASS（设置页/持久化） | 真实视觉 NEEDS_MANUAL |
| B3 width write | PASS（墨章命名空间 CSS 变量） | 真实视觉 NEEDS_MANUAL |
| B3 GUI/DPI/theme/DOMRect | NEEDS_MANUAL | 真实 Typora 截图/DOMRect |

## 7. 2026-11-11 B2/B3 阻塞专项补充

| 项 | 状态 | 已验证证据 | 仍需外部条件 |
|---|---|---|---|
| 跨文件锚点 | 接口 MODULE_PASS / 规则 BLOCKED | `document-cross-file-anchor-v1.ts` 9 tests；`document-heading-dom-anchor-v1.ts` 6 tests（仅活动文档 DOM id，重复/断开 UNKNOWN） | 目标文件 heading DOM 权威；当前无跨文件 READY 来源 |
| 结构化引用 | parser MODULE_PASS / 规则未启用 | `inkchapter-ref:` 规范 + `document-object-reference-v1.ts` 5 tests；拒绝显示编号 | captionId 跨文件持久化 + Typora 显示/导出人工实测 |
| 图片证据 | MODULE_PASS + INTEGRATION_PASS / RUNTIME_VERIFIED 未做 | Provider 7 tests + Runtime 5 tests + 诊断输入/字节优先 2 tests；docKey 隔离、失效、异步预热、同步快照；无上传下载 | 真实 Typora 预热时序/UI 刷新采证；重复内容规则未做 |
| 表格对齐 | PASS（规则） | `TABLE_ALIGNMENT_INVALID` 3 tests；独立于列数/块结构 | 无 |
| GUI | 脚本就绪 / GUI_VERIFIED 未做 | `GUI_ACCEPTANCE_DEVTOOLS.js` + `GUI_ACCEPTANCE_PROCEDURE.md`；旧实例运行 3AFA，新 build 3578 已复制 | 人工启动 Typora 后执行只读脚本 A–E |

> 说明：结构化引用与图片 Provider 是**模块级实现**，尚未产出对应诊断规则；不得写成规则已上线或 GUI 已通过。

## 8. 最终结论

**当前墨章文档诊断：101 个规则家族、112 个展开具体代码、107 个注册解析代码、108 个生产器代码、103 个真正可达代码；注册基准 13 错误 / 70 警告 / 29 提示；可达基准 13 / 63 / 27。**

GIT-0 与 B1 已安全合并；B2 的 8 条源规则与 B3 的 profile/width 模型、设置页/持久化、CSS 变量版心已合并。仍未达到全合同 PASS：4 条 DEFERRED（文件锚点 + 3 交叉引用）、表格对齐、图片格式，以及真实 GUI/DPI/主题/DOMRect 验收仍为 BLOCKED/NEEDS_MANUAL。**因此本轮不能写 `ALL_MANDATORY_TASKS_PASS`。**
