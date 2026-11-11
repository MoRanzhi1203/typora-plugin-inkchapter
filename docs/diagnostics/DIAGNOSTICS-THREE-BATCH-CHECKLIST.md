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
| B2-01 | 5 条 DEFERRED 正式实现 | PARTIAL：1 PASS + 3 BLOCKED + 1 接口就绪 | FRONTMATTER_MALFORMED 已实现；跨文件 anchor 三态接口 9 tests；文件锚点/3 交叉引用仍无 canonical authority |
| B2-02 | 表格结构规则 | PASS（列数 + 对齐） | COLUMN 行为测试；ALIGNMENT 独立 delimiter cell 语法测试 |
| B2-02b | 表格对齐独立诊断（B2d） | PASS | 已证明松 delimiter 下 `::` 是独立缺陷；3 tests |
| B2-03 | 列表结构规则 | PASS（缩进）/ TODO（标记/序号） | LIST_INDENTATION_INVALID 三例；合法混合标记/非 1 起始不误报 |
| B2-04 | 标题 / 自动编号规则 | PASS（序列） | HEADING_NUMBER_SEQUENCE_INVALID 使用 canonical displayCountedPath；四例测试 |
| B2-05 | 图片资源规则 | PARTIAL（扩展名 + 字节证据） | FIGURE_IMAGE_FORMAT_UNSUPPORTED 支持字节优先；Provider/Runtime 已接线，真实 Typora 时序未采证；重复内容未做 |
| B2-06 | 公式宽度 / 源码长度 / 单行 / 渲染失败 | PASS（4 项）/ TODO（高度可选） | 源码长度/单行/宽度/失败均有测试；高度默认关闭未做 |
| B2-07 | 注册、默认策略、测试、能力矩阵 | PASS（已实现项） | 101 家族 / 107 解析代码 / 112 展开 / 108 生产器 / 103 可达 |
| B2-08 | B2 报告 + 门禁 + 合并 `main` | PASS（PARTIAL 记录） | 全量 PASS；merge `8d5e475`；B2b 追加 HEADING_NUMBER_SEQUENCE_INVALID |

## B3 学术档案与 Compact Inspector UI

| ID | 任务 | 状态 | 证据 |
|---|---|---|---|
| B3-01 | Profile（general/academic/lab-report/custom）与继承 | PASS（模型 + 设置页/持久化） | 10+3 tests；设置页下拉；无 GUI 验收 |
| B3-02 | 学术/实验报告可选检测 | PARTIAL | academic profile 启用公式源码规则；其余无确定语义 |
| B3-03 | 可配置版心模型与超宽规则 | PASS（模型 + CSS 变量）/ GUI NEEDS_MANUAL | 预设 + clamp；只作用于墨章命名空间 |
| B3-04 | 顶部方块 + 三标签 + 上下等宽 UI 精修 | NEEDS_MANUAL | 旧实例运行 3AFA 旧 build；新 3578 已复制；Typora 关闭后本会话无法重启，需人工采证 |
| B3-05 | 诊断列表 UI 语义 | 沿用 B1/B2 | 事件/行数语义已在 B1 落地 |
| B3-06 | 图片页 / 锁定 / 导航器 | NEEDS_MANUAL | 既有能力保留；未 GUI 重验收 |
| B3-07 | 真实 Typora GUI / DPI / 主题 / DOMRect 验收 | NEEDS_MANUAL | 无控件级点击/截图能力；未伪造证据 |
| B3-08 | B3 报告 + 门禁 + 合并 `main` | PASS（PARTIAL 记录） | 全量 331×5838 PASS；merge `842074c` + B3b `ca29669` |

## 最终

| ID | 任务 | 状态 | 证据 |
|---|---|---|---|
| FINAL-01 | Git 总览与三次合并记录 | PASS | GIT-0 `3b20ea5`；B1 `19bf0dc`；B2 `8d5e475`；B3 `842074c` |
| FINAL-02 | 最新规则家族 / 展开代码 / 级别分布重算 | PASS | 101 / 112 / 107；13-70-29；可达 103（13-63-27） |
| FINAL-03 | 全量测试、构建 SHA、隐私审计 | PASS | 338×5907；`3733016…`；privacy/docs PASS |
| FINAL-07 | 图片异步证据 Provider + Runtime | INTEGRATION_PASS（未 RUNTIME_VERIFIED） | 7+5 tests；main 预热/失效/文档隔离；诊断字节优先；真实 Typora 时序未采证 |
| FINAL-08 | 结构化引用 parser（未启用规则） | MODULE_PASS | `document-object-reference-v1.ts` 5 tests；拒绝显示编号 |
| FINAL-09 | 跨文件 DOM heading authority | MODULE_PASS（仅活动文档） | 6 tests；重复/断开 UNKNOWN；跨文件目标无权威 |
| FINAL-10 | GUI 验收脚本与步骤 | PASS（脚本自测 11） | 三态、零宽/隐藏标签、多目标、命中、筛选；`GUI_ACCEPTANCE_DEVTOOLS.js` + 步骤文档；GUI_VERIFIED 未做 |
| FINAL-11 | 真实 GUI 采证 | BLOCKED / NEEDS_MANUAL | runtime-load 17E + 收起态已验；展开/锁定/多目标/主题/DPI 未复采 |
| FINAL-12 | 诊断修复 V1 规划器/空行/语言/图名 | MODULE_PASS（apply BLOCKED） | 17 tests；无验证 range transaction，UI 不启用；矩阵见 `DIAGNOSTIC_FIX_CAPABILITY_MATRIX.md` |
| FINAL-13 | 代码块诊断标记锚定 | PASS（代码/单测）/ GUI NEEDS_MANUAL | 身份 MATCH gate、CODE_TOPBAR、frame 证据属性；338×5907；新构建未真实加载 |
| FINAL-06 | B2/B3 阻塞解除专项审计（B2d） | PASS（可实施项） | 三态接口、表格对齐、引用方案、图片/GUI 审计；见 `DIAGNOSTICS-B2B3-UNBLOCK-AUDIT.md` |
| FINAL-04 | GUI 证据 / NEEDS_MANUAL 清单 | NEEDS_MANUAL | 真实 Typora 截图/DOMRect 未获得；未伪造 |
| FINAL-05 | 最终交付报告 | PASS | `DIAGNOSTICS-THREE-BATCH-FINAL-REPORT.md` |
