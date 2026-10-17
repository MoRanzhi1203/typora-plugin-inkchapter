# P0-CARET-EOF-REGRESSION-MATRIX

> 轮次：`sess-p0-caret-eof-full-closure`（2026-10-12）
> 判定口径：`PASS`=本轮有可判错证据通过；`FAIL`=失败；`NOT_RUN`=未执行；`PENDING_USER_MANUAL`=需真实 Typora 人工操作。
> **未执行项一律不得判 PASS。**

## 0. 静态/自动化门禁（本轮实际执行）

| 门禁 | 结果 | 证据 |
|---|---|---|
| TYPECHECK (`tsc --noEmit`) | **PASS** | `TSC_EXIT=0` |
| TARGETED_TESTS | **PASS** (15/15) | `document-diagnostic-caret-isolation-v1.test.ts` + `build-pipeline-fail-fast.test.ts` |
| FULL_TESTS | **PASS** (237 files / 4494 tests) | `pnpm run test` |
| BUILD (`build:dev`，含前置 tsc) | **PASS** | `ARCHIVE VERIFY=PASS` + `BUILD_EXIT=0` |
| ARCHIVE_VERIFY | **PASS** (ENTRY_COUNT=9) | `node scripts/progress-archive.mjs verify` |
| DEPLOY_SHA | **PASS** | project==vault=`3A165610…`，`DEPLOY_HASH_MAIN_MATCH=True` |
| RUNTIME_STRUCTURE | NOT_RUN | 需运行中 Typora |
| RUNTIME_IDENTITY | **FAIL** | 已加载 `430FC947…` ≠ 部署 `3A165610…`（需重启 Typora） |

## A. 光标与输入（A01–A10）

| caseId | 目标 | 结果 | 说明 |
|---|---|---|---|
| A01 | 文末空段落连续 ArrowDown ×6 | NOT_RUN | 需真实键盘 |
| A02 | H1 reason chip 行 Left/Right/Up/Down/Home/End | NOT_RUN | 需真实键盘 |
| A03 | 代码命名/语言/空代码提示附近方向键 + 激活切换 | NOT_RUN | 需真实键盘 |
| A04 | Ctrl+End / Ctrl+A 的 Selection 与正文边界 | NOT_RUN | 需真实键盘 |
| A05 | 鼠标拖拽跨正文与标签，复制无插件备注 | NOT_RUN | 需真实鼠标 |
| A06 | Backspace 合并两个真实空段落 + Undo/Redo | NOT_RUN | 需真实键盘 |
| A07 | Enter 连续 ×3 相对 C0 的增量 | NOT_RUN | 需 C0/C4 真实对照 |
| A08 | 题注投影点击/编辑/取消/保存/右键 | NOT_RUN | 需真实鼠标 |
| A09 | 离开文档再返回，旧审计不污染新文档 | **PASS**（逻辑） | `INVALIDATE` 单测：切文档取消待处理项、不 flush 出跨文档样本 |
| A10 | 快速连续按键/组合键，审计不被静默丢弃 | **PASS**（逻辑） | `NON-SILENT` 单测：溢出计入 `AUDITS_DROPPED` 且 `FAIL_AUDIT_COVERAGE` |

## B. 文末空行（B00–B13）

| caseId | 目标 | 结果 | 说明 |
|---|---|---|---|
| B00/B01/B02/B05/B10 | N=0/1/2/5/10 可见空行的 warning/PASS/涂色 | **PASS**（计数逻辑）/ PENDING_USER_MANUAL（视觉） | `document-diagnostic-blank-region-unified-v1.test.ts` 覆盖 N 序列；像素需人工 |
| B11 | N=1→2→10→5→2→1→0→1 逐次同步 | **PASS**（计数逻辑） | 同上（§B2/B3 序列） |
| B12 | 源码模式↔WYSIWYG 切换 + 保存重开一致 | NOT_RUN | 需真实编辑/保存 |
| B13 | 无空行文件末尾（末尾为代码块）不生成虚假段落 | NOT_RUN | 需真实 Typora |

## C. 布局与诊断（C01–C08）

| caseId | 目标 | 结果 | 说明 |
|---|---|---|---|
| C01 | 滚动/回顶/到底 | NOT_RUN | 需真实滚动（自动化盲区） |
| C02 | 侧栏折叠/展开/拖拽宽度 | NOT_RUN | 需真实鼠标 |
| C03 | 窗口小→大、大→小 | NOT_RUN | 需真实窗口变化 |
| C04 | Drawer 开关/换筛选不遮挡光标与标记 | NOT_RUN | 需真实交互 |
| C05 | 标题与代码警告同屏无跨对象涂色 | NOT_RUN | 需真实交互 |
| C06 | 连续编辑 Observer 不循环、不卡死 | NOT_RUN | 需真实编辑 |
| C07 | 保存并重开所有 fixture，Markdown 无插件备注 | NOT_RUN | 需真实保存 + 导出文本比对（`evaluateSerializedMarkdownGate` 已就绪，输入=`NOT_RUN`） |
| C08 | 禁用墨章 C0 与启用 C4 同场景差异 | NOT_RUN | 见 BASELINE-MATRIX §3 |

## 汇总

- 本轮**已执行并通过**：TYPECHECK / TARGETED / FULL / BUILD / ARCHIVE_VERIFY / DEPLOY_SHA（6 项）；逻辑级 A09/A10/B00-B11（计数逻辑）。
- **NOT_RUN**：A01–A08、B12、B13、C01–C08、C0/C4 配对、RUNTIME_STRUCTURE。
- **FAIL**：RUNTIME_IDENTITY（已加载陈旧）。
- **PENDING_USER_MANUAL**：全部像素/交互/真实键入验收（A/B/C 的真实运行时部分 + 序列化导出比对）。

**唯一必需人工动作：重启 Typora 载入 `3A165610…`，随后在 `Document-Diagnostics-Trailing-Blank-3.md` 上执行 C0/C4 配对 Enter 与 A/B/C 真实操作。**
