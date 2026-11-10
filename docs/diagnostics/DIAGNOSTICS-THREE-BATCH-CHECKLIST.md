# 墨章文档诊断三批次 — 任务清单

状态：`TODO` / `DOING` / `PASS` / `BLOCKED` / `NEEDS_MANUAL`。
`PASS` 只表示该任务已有可复现证据；`NEEDS_MANUAL` 不计入 PASS。

## GIT-0 主线整合

| ID | 任务 | 状态 | 证据 |
|---|---|---|---|
| GIT-0.1 | Git 状态、分支、血缘、worktree、stash、未跟踪文件审计 | PASS | 执行日志“审计快照” |
| GIT-0.2 | 未跟踪成果哈希保全；用户资料不提交 | PASS | 执行日志“未跟踪成果保全” |
| GIT-0.3 | 功能分支基线门禁（typecheck / 327×5783 tests / build / privacy / docs） | PASS | 执行日志“开发前基线门禁” |
| GIT-0.4 | `--no-ff` 合并现有功能分支到 `main` | PASS | merge SHA `3b20ea5` |
| GIT-0.5 | 合并后门禁 | PASS | typecheck / 327×5783 tests / build / privacy / docs 全通过 |
| GIT-0.6 | 提交审计清单与三批次执行日志到 `main` | PASS | docs commit `4017d59` |
| GIT-0.7 | 记录 `BASELINE_MAIN_SHA` | PASS | `4017d598134720396fe28ccae53488e9f95886ac` |

## B1 诊断可靠性

| ID | 任务 | 状态 | 证据 |
|---|---|---|---|
| B1-01 | 统计集合 / 差集 / 守恒 / 103 与 98 口径 / 94-or-95 重算 | PASS | code-sets 模块 + 7 tests；95 = 98−CB008−CB010−STRICT_FIRST_H1_DOCUMENT_EMPTY |
| B1-02 | “1 警告却灰色”复现、状态权威与 stale fence | PASS（自动）；GUI NEEDS_MANUAL | YELLOW/getComputedStyle；stale revision 拒绝；真实 Typora 截图待人工 |
| B1-03 | 事件数 vs 投影行数；4 条编号定位契约 | PASS | 1 event / 2 rows 测试；4 条 location 对齐 |
| B1-04 | CB007/8/10、STRICT_FIRST_H1_DOCUMENT_EMPTY、strictPolicyActive、死字段/残留处置 | PASS | CB007 rawText；CB008/010 defaultEnabled=false；strict 门控；旧 code 名清理 |
| B1-05 | source unavailable / 空代码块 / 空表去重；空行阈值注释 | PASS | 抑制测试；空行注释修正 |
| B1-06 | 三条重名规则行为测试；动态 code / strict-loose / 多目标 / 文档切换测试 | PASS | b1-reliability 12 tests；hub 7 tests |
| B1-07 | 当前构建的真实 Typora 运行时证据 | NEEDS_MANUAL | 无 Typora 控件级点击/截图能力；未伪造闭包 |
| B1-08 | B1 报告 + 门禁 + 合并 `main` | PASS | merge `19bf0dc`；合并后 329×5805 PASS |

## B2 规则扩展

| ID | 任务 | 状态 | 证据 |
|---|---|---|---|
| B2-01 | 5 条 DEFERRED 正式实现 | PARTIAL：1 PASS + 4 BLOCKED | FRONTMATTER_MALFORMED 已实现；文件锚点 + 3 交叉引用无 canonical 语法/文件锚点权威 |
| B2-02 | 表格结构规则 | PASS（列数）/ BLOCKED（对齐） | TABLE_COLUMN_COUNT_MISMATCH 行为测试；ALIGNMENT 无可靠语法权威 |
| B2-03 | 列表结构规则 | PASS（缩进）/ TODO（标记/序号） | LIST_INDENTATION_INVALID 三例；合法混合标记/非 1 起始不误报 |
| B2-04 | 标题 / 自动编号规则 | PASS（序列） | HEADING_NUMBER_SEQUENCE_INVALID 使用 canonical displayCountedPath；四例测试 |
| B2-05 | 图片资源规则 | BLOCKED | 缺少可靠 image file-info provider，未用扩展名猜测 |
| B2-06 | 公式宽度 / 源码长度 / 单行 / 渲染失败 | PASS（4 项）/ TODO（高度可选） | 源码长度/单行/宽度/失败均有测试；高度默认关闭未做 |
| B2-07 | 注册、默认策略、测试、能力矩阵 | PASS（已实现项） | 99 家族 / 105 解析代码 / 110 展开 / 106 生产器 / 101 可达 |
| B2-08 | B2 报告 + 门禁 + 合并 `main` | PASS（PARTIAL 记录） | 全量 PASS；merge `8d5e475`；B2b 追加 HEADING_NUMBER_SEQUENCE_INVALID |

## B3 学术档案与 Compact Inspector UI

| ID | 任务 | 状态 | 证据 |
|---|---|---|---|
| B3-01 | Profile（general/academic/lab-report/custom）与继承 | PASS（模型 + 设置页/持久化） | 10+3 tests；设置页下拉；无 GUI 验收 |
| B3-02 | 学术/实验报告可选检测 | PARTIAL | academic profile 启用公式源码规则；其余无确定语义 |
| B3-03 | 可配置版心模型与超宽规则 | PASS（模型 + CSS 变量）/ GUI NEEDS_MANUAL | 预设 + clamp；只作用于墨章命名空间 |
| B3-04 | 顶部方块 + 三标签 + 上下等宽 UI 精修 | NEEDS_MANUAL | 现有 V5.2 三标签/360px；未真实 GUI 重验收 |
| B3-05 | 诊断列表 UI 语义 | 沿用 B1/B2 | 事件/行数语义已在 B1 落地 |
| B3-06 | 图片页 / 锁定 / 导航器 | NEEDS_MANUAL | 既有能力保留；未 GUI 重验收 |
| B3-07 | 真实 Typora GUI / DPI / 主题 / DOMRect 验收 | NEEDS_MANUAL | 无控件级点击/截图能力；未伪造证据 |
| B3-08 | B3 报告 + 门禁 + 合并 `main` | PASS（PARTIAL 记录） | 全量 331×5838 PASS；merge `842074c` + B3b `ca29669` |

## 最终

| ID | 任务 | 状态 | 证据 |
|---|---|---|---|
| FINAL-01 | Git 总览与三次合并记录 | PASS | GIT-0 `3b20ea5`；B1 `19bf0dc`；B2 `8d5e475`；B3 `842074c` |
| FINAL-02 | 最新规则家族 / 展开代码 / 级别分布重算 | PASS | 99 / 110 / 105；13-68-29；可达 101（13-61-27） |
| FINAL-03 | 全量测试、构建 SHA、隐私审计 | PASS | 331×5836；`124EECE…`；privacy/docs PASS |
| FINAL-04 | GUI 证据 / NEEDS_MANUAL 清单 | NEEDS_MANUAL | 真实 Typora 截图/DOMRect 未获得；未伪造 |
| FINAL-05 | 最终交付报告 | PASS | `DIAGNOSTICS-THREE-BATCH-FINAL-REPORT.md` |
