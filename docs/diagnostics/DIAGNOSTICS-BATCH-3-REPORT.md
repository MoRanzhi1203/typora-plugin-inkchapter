# 诊断三批次 — B3 学术档案与 Compact Inspector 验收报告

> 分支：`feature/diagnostics-b3-academic-ui`
> 基线：`main` @ `55db668e12d3ded49e75e8fe922a8f1713f4691d`
> 时间：2026-11-10（Etc/GMT-8）
> 范围：只改受控源码、测试和诊断文档；未修改 Typora、社区框架、用户 Markdown 或真实用户配置。

## 1. 批次状态（PARTIAL）

| 项 | 状态 | 说明 |
|---|---|---|
| B3-01 Profile 模型与继承 | PASS（模型 + 设置页+持久化） | general/academic/lab-report/custom；设置页下拉、`resolveUiSettings` 校验、写回持久化；10+3 tests |
| B3-01 Profile 设置 UI / 持久化 | PASS（代码/设置页）；GUI NEEDS_MANUAL | `inkchapter-ui-setting-tab.ts` 新增诊断档案/版心控件；真实 Typora 视觉未验收 |
| B3-02 学术/实验报告可选规则 | PARTIAL | academic 通过 profile 启用两条公式源码规则；其余可选规则未定义，避免虚构 |
| B3-03 版心模型 | PASS（模型 + 运行时 CSS 变量） | 预设 + clamp；`applyAcademicProfile` 写 `--inkchapter-content-width` 与 body class |
| B3-03 版心写入文档 / UI | PASS（仅墨章命名空间）；GUI NEEDS_MANUAL | CSS 仅作用于 `body.inkchapter-academic-width #write`，不改用户 CSS/文档 |
| B3-04 顶部方块 + 三标签 + 上下等宽 | NEEDS_MANUAL | 现有 V5.2 已有 检测/图片/锁定 三标签与 360px 展开宽度；B3 未能在真实 Typora 中重验收 |
| B3-05 诊断列表 UI 语义 | 沿用 B1/B2 | 事件/行数语义已在 B1 落地，B3 未新增列表功能 |
| B3-06 图片页 / 锁定 / 导航器 | NEEDS_MANUAL | 既有能力保留，未改；真实 GUI 交互未重新验收 |
| B3-07 真实 GUI / DPI / 主题 / DOMRect | NEEDS_MANUAL | 无法从 DSH 完成 Typora 控件级点击与像素证据；不伪造截图 |
| B3-08 报告 / 门禁 / 合并 | SEE §5 | — |

**结论：B3 的纯模型与公式 profile 接线 PASS；设置 UI、版心写入和真实 GUI 验收未完成，不能宣称 B3 全合同 PASS。**

## 2. 已实现

### 2.1 Profile 模型（`document-diagnostic-profile-v1.ts`）

- `DiagnosticProfileId = general | academic | lab-report | custom`。
- 继承：`academic → general`，`lab-report → academic → general`，`custom → general`（可覆盖）。
- `resolveDiagnosticProfile()`：root→leaf 链、显式启用/禁用、公式源码限制、内容宽度、未知规则 issue、循环 issue。
- `isDiagnosticFamilyEnabledForProfile()`：显式 profile 覆盖优先，否则回落注册表 `defaultEnabled`。
- 关键安全：未知规则只记 issue、不崩溃；循环只记一次 issue、不递归。
- 测试：`document-diagnostic-profile-v1.test.ts` 10 tests。

### 2.2 版心模型（`document-diagnostic-academic-width-v1.ts`）

- 预设：narrow 720 / standard 820 / wide 960 / lab-report 900。
- 自定义 px 被 clamp 到 560–1200；comfortable range 640–1100；`clamped` 标记。
- 测试：三例（预设、越界 clamp、合法自定义）。

### 2.3 Profile → 公式规则接线

- `DocumentDiagnosticsInput.diagnosticProfile` 可提供 `formulaSourceRules` 与 `contentWidthPx`。
- academic/lab-report 因此启用两条默认关闭的公式源码规则（长度/单行）。
- 宽度规则用 `min(measuredAvailable, profile.contentWidthPx)` 作为上限。
- 测试：`document-diagnostics-b2-rules.test.ts` 新增三例（academic 启用、general 关闭、profile 宽度 cap）。

## 3. BLOCKED / NEEDS_MANUAL

### 3.1 Profile 设置 UI / 持久化（代码 PASS；GUI NEEDS_MANUAL）

- 设置页新增「文档诊断 · 学术档案」：诊断档案下拉、版心宽度下拉、自定义 px 输入。
- 保存走既有 `InkChapterUiSettings` 持久化；`resolveUiSettings` 校验非法值并回落默认。
- 写回时 `main.applyAcademicProfile()` 立即应用；加载时也应用一次。
- GUI 视觉/交互仍需人工验收，标 NEEDS_MANUAL。

### 3.2 版心写入（代码 PASS；GUI NEEDS_MANUAL）

- 运行时写 `--inkchapter-content-width` 与 `body.inkchapter-academic-width`。
- CSS 仅在 `body.inkchapter-academic-width #write` 下生效，默认 general 不加类；不写用户 CSS 文件、不改 Markdown。
- 自定义宽度 clamp 到 560–1200px。

### 3.3 学术/实验报告可选规则（PARTIAL）

- 已定义并接线：公式源码长度/单行（通过 profile limits）。
- 其余“学术规则”（如引用完整性、图表编号风格）没有本任务书之外的确定语义；不虚构 ID。
- 解除条件：给出可验证的规则定义与 canonical 事实源。

### 3.4 版心写入（已由 B3 实现，GUI 待验收）

- 已实现受控 width provider：只影响墨章 CSS 命名空间，不改用户文档/CSS。
- 解除条件剩：真实 Typora 中确认 `#write` max-width 与 DPI/主题表现。

### 3.4 真实 GUI（NEEDS_MANUAL）

自动测试不能代替真实 Typora 的像素/点击验收。B3 需要人工确认：

> 本轮尝试用 `Typora.exe --user-data-dir=<临时目录> test/vault` 启动隔离实例以便采证；未出现新窗口（Typora 单实例行为），因此 GUI 仍无法在本会话自动完成，未伪造截图。

1. 展开后顶部方块与底部内容面板同宽（360px 权威），无白色外层；
2. 检测/图片/锁定三标签切换不改变宽度/位置；
3. 检测列表事件数与行数语义（B1）在真实 UI 中一致；
4. 图片页、锁定细框、导航器在 100%/150% DPI 与明暗主题下的截图/DOMRect；
5. 版心设置若实现，确认只影响墨章 UI，不改用户 Markdown/CSS。

## 4. 规则总数

B3 未新增注册规则；规则总数仍为 **98 家族 / 104 注册解析代码 / 109 展开代码 / 105 生产器代码 / 100 可达**，DEFERRED 4（B2 已 BLOCKED）。

## 5. 验证

| 命令 | 结果 |
|---|---|
| TypeScript `tsc --noEmit` | PASS |
| B3 profile/width + B2 profile wiring | 27 tests PASS（2 文件） |
| 全量 Vitest | PASS，331 文件 / 5838 tests，147.69s |
| 生产构建 | PASS，`dist/main.js` SHA256 `9CB915D55EFE1BF74472180C6E4EAFB398F3160BADDFAC2FDE1BCF8D901D55CE` |
| 隐私 / 文档 | PASS（SCANNED_LINES=0；DOC_BROKEN_LINK_COUNT=0） |

## 6. 合并决策

B3 只完成纯模型与公式 profile 接线；设置 UI、版心写入、真实 GUI 均未完成。按任务书要求，B3 记录为 PARTIAL / BLOCKED / NEEDS_MANUAL，不能标记为“三批次全部 PASS”。
