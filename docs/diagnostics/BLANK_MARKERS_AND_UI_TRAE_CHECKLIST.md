# 三类空行标记 + 检测面板白底 UI — Trae 任务账本

> 分支：`feature/diagnostics-trae-ui-quick-fix`（未合并 main、未推送远端）
> 任务：三类空行标记统一 + 检测面板白底黑灰精修
> 状态：`PENDING / IN_PROGRESS / PASS / FAIL / BLOCKED / NEEDS_MANUAL`

## G0 — 源码与运行时基线

| 项 | 状态 | 证据 |
|---|---|---|
| 读取任务书、审计现有 marker / 面板 / FixPlanner / 事务 | PASS | 任务书全文；`document-utility-overlay-host.ts`、`style.scss`、`fix-v1/v2`、`main.ts` |
| 三类规则 → 数据 → 载体 → DOM → CSS → 点击映射 | PASS | `EXCESSIVE_INTERNAL_BLANK_LINES`（block-gap carrier）、`DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE`（EOF carrier）、`DOCUMENT_TERMINAL_NEWLINE_MISSING`（endpoint carrier） |
| 规则 ID / 规范化计数字段 | PASS | internal: `actualBlankLines − passMaxBlankLines`；end excess: `extraTrailingBlankLineCount`；end missing: `terminalNewlineCount === 0 ⇒ 1` |
| 保护用户未提交文件 | PASS | 仅修改项目源码；未跟踪 DSH 任务书原样保留 |

## M1 — 三类空行统一为左侧标记

| 项 | 状态 | 证据 |
|---|---|---|
| 内部多余空行：2px 左侧实线，无整块填充 | BLOCKED（运行期不可达） | CSS/标签契约 PASS；但真实 GUI 中 WYSIWYG `renderedBlankRowCount=1 ⇒ publish=false`，source 模式 publish=true 却 `LOCATE_FAILED:SCROLL_TARGET_DID_NOT_ENTER_VIEWPORT`。见「运行期证据」 |
| 文末多余空行：2px 左侧实线，不再整片米黄 | PASS（真实 GUI） | 点击后 carrier `background=rgba(0,0,0,0)`、`border-left:1.6px solid rgb(168,121,50)`、标签 `多余 3 空行` |
| 文末缺少空行：16–20px 短虚线 | PASS（真实 GUI） | carrier `form=endpoint`、`.inkchapter-eof-endpoint-line` `height:18px`、`border-left:1.6px dashed rgb(168,121,50)`、标签 `缺少 1 空行` |
| 计数不再在最右端 | PASS（真实 GUI） | `data-ink-eof-marker` carrier 内 chip `text=多余 3 空行`、`left:10px`、`right:auto`、`height:20px` |
| 文案来自真实诊断 | PASS | `document-diagnostic-blank-marker-v1.ts`；host 使用 `blankLineMarkerText(diag…, metadata)` |
| 标签位于线的右侧 6–10px、20px 高、极淡琥珀底 | PASS | `left: 10px; height: 20px; color-mix(accent 12%, bg)` |
| 不生成 Markdown 段落 / 不改行高 | PASS | 纯 overlay，`pointer-events` 仅标签可点 |
| 只有标签可交互，点击定位正确诊断 | PASS | `bindBlankMarkerChip` → `locateDiagnostic(id)`；carrier 仍 pointer-events:none |
| 特殊块相邻时保持真实 target 绑定 | PASS | 沿用既有 block-gap / EOF 几何与身份；本轮未改锚点逻辑 |
| 无有效计数时不显示（不臆造） | PASS | `blankLineMarkerText` 返回 null ⇒ 移除标签 |

## U1 — 检测面板白底黑灰

| 项 | 状态 | 证据 |
|---|---|---|
| 主背景 #FFFFFF；hairline / divider 独立 | PASS | `--ink-doc-surface`、`--ink-doc-hairline`、`--ink-doc-divider` |
| 文本层级：主文字 / 说明 / 行号 / 操作 | PASS | `#24272D` / `#626A75` / `#737B86` / `#454B55` |
| hover `#F7F8FA`、选中 `#F1F2F4` | PASS | token + 行规则 |
| 行内以细分隔线代替灰色卡片 | PASS | 行 `border-bottom: 1px solid var(--ink-doc-divider)` |
| 深色主题对应变量 | PASS | dark `#1f2021 / #e9eaec / #343638 …` |
| 15px 方块 / 32px 热区 / 三标签 / 同宽 | PASS | 既有结构与测试未回退 |
| 排序 / 筛选图标菜单位于右上 | PASS | sort + filter icon buttons |

## S1 — 排序与计数

| 项 | 状态 | 证据 |
|---|---|---|
| 默认按源码位置升序 | PASS | host 投影排序（既有） |
| 文档倒序 / 严重程度 / 规则类型 | PASS | `document-desc` 模式 + 菜单 4 项 |
| 事件数 / 投影行数分离 | PASS | `rowCount` 与状态计数分离（既有） |
| 筛选/切换文档同一快照 | PASS | 既有 admission；本轮未引入第二数据源 |

## F1 — 修复入口

| 项 | 状态 | 证据 |
|---|---|---|
| 行内仅一个主操作（修复/处理） | PASS | hub 行操作只渲染一个按钮 |
| 同类修复位于预览内，名称完整 | PASS | `同类修复（N 项）`，仅同规则 >1 项出现 |
| 一键修复计数来自 FixPlanner | PASS | `computeAutoFixableCount`（真实 AUTO_SAFE 计划） |
| 预览 → 确认 → 事务 → 重算 | PASS | controller + adapter + `classifyFixOutcome` |
| 撤销/重做、锁定、切换拒绝 | PASS（单测）/ NEEDS_MANUAL（真实按键） | `File.reloadContent` 单条 undo；锁定/切换单测 |
| 结构未验证时拒绝整篇写回 | PASS | `readFixSource` + `isSourceVerified` |

## CSS 与生命周期

| 项 | 状态 | 证据 |
|---|---|---|
| 标记与代码题注/语言栏/折叠互不干扰 | PASS | 独立选择器；未改代码块 marker |
| 响应/异步结果按文档隔离 | PASS | 既有 documentKey/epoch；修复计划在确认时重建 |
| 不修改 Typora 安装目录 / 框架 / 用户文档 | PASS | 仅项目源码与测试域 |

## T1 — 测试与验收

| 项 | 状态 | 证据 |
|---|---|---|
| 新增三类标记事实/视觉/交互测试 | PASS | `document-diagnostic-blank-marker-v1.test.ts`（11） |
| 面板/排序/修复交互测试 | PASS | hub controller（40）、model order（7）、panel（7）、controller（11） |
| TypeScript | PASS | `tsc --noEmit`（exit 0） |
| 全量 Vitest | PASS | `344 test files / 5983 tests` 全部通过 |
| build | PASS | `pnpm build`（verify:archive + tsc + esbuild prod） |
| 隐私 / docs | PASS | `PRIVACY_GATE=PASS`；`docs:verify RESULT=PASS` |
| 运行时 bundle | PASS | 部署 SHA 见下；`loadSource=vault` |
| 真实 Typora GUI 视觉/交互（白底、文末两类 marker、修复 diff、撤销） | NEEDS_MANUAL | 白底/文末 marker 已取得运行期 computed style；修复 diff 与 Ctrl+Z 仍需人工按键 |
| 内部空行 marker | BLOCKED | 见「运行期证据」：发布策略与 Typora WYSIWYG 折叠冲突 |

## 运行期证据（真实 Typora 1.6.7 / Electron 24，2026-11-12）

采证方式：临时只读 observer 追加到 test-vault 的 `dist/main.js`（不改源码、不改用户文档），通过 `reqnode('fs')` 落盘 DOM/computed style；采证后已恢复 pristine bundle。fixtures 位于 `test/vault/__gui-*.md`（gitignored），证据 JSON 位于 `runtime/gui-acceptance/`（gitignored）。

| 事实 | 数值 |
|---|---|
| 面板 surface | `.inkchapter-doc-expand__layout` `background=rgb(255,255,255)`、`border=0.8px solid rgb(222,226,231)` |
| 顶部/内容同宽 | header 358×36 与 panel 358×133：width/left/right 误差均为 0（≤1 CSS px） |
| 行 | `grid-template-columns: 6px minmax(0,1fr) 40px 44px`、`column-gap:6px`、标题 `rgb(36,39,45)` |
| 文末多余空行 | carrier `bg=rgba(0,0,0,0)`、`border-left=1.6px solid rgb(168,121,50)`（2px @0.8 渲染缩放）、chip `多余 3 空行` `left:10px` `height:20px` |
| 文末缺少空行 | carrier `form=endpoint`、endpoint line `2×18px`、`border-left=1.6px dashed rgb(168,121,50)`、label `缺少 1 空行` |
| 干净文档 | 修复前：面板恒报 `文档末尾缺少换行符`；修复后：`rows=0` |

### 已修复的两个真实缺陷（本轮 GUI 验收发现）

1. `ROOT_EOF_TEXT_SOURCE` — 结构化序列化是块级：WYSIWYG 丢末尾换行、source 模式多一个换行，EOF 判定因此对**所有干净文档**误报「缺少换行符」。修复：`DocumentDiagnosticsInput.eofMarkdown` 由 `authority.getMarkdown()` 提供，EOF 策略只读文本镜像；结构/空行规则仍读结构化快照。回归：`document-diagnostic-trailing-blank-fixtures.test.ts` 新增 4 条。
2. `M1 EOF surface gate` — unified 展示改为「无填充 + 左线」后，旧 `FILL_ONLY` 门禁要求 `fillCount>=1`，点击后 `fillCount=0 → LOCATE_FAILED → 标记被回滚`（标记永远不出现）。修复：`resolveEofMarkerSurfacePainted`（fill / 插件自有边框 / endpoint 任一即算已绘制，全无则仍 FAIL）。回归：`document-diagnostic-blank-marker-v1.test.ts` 新增 5 条。

### 内部空行 marker 阻塞事实

- WYSIWYG：`DOCUMENT-DIAGNOSTIC-RENDERED-BLANK-ROW-DOM-PROBE renderedBlankRowCount=1` → `DOCUMENT-INTERNAL-BLANK-LINE-DECISION-AUDIT publish=false reason=VISIBLE_WITHIN_ALLOWANCE_RENDERED_VISIBLE_BANDS`（4 个源码空行被 Typora 折叠为 1 个可见带）。
- source 模式：`publish=true reason=VISIBLE_EXCESSIVE_SOURCE_LINES_VISIBLE sourceBlankLineCount=4`，但块级目标不存在 → `LOCATE_FAILED:SCROLL_TARGET_DID_NOT_ENTER_VIEWPORT`，无 `.inkchapter-block-gap-fragments`。
- 结论：现行「WYSIWYG 只按可见带发布」策略与「标记只在 WYSIWYG 可渲染」互相排斥，内部空行诊断在真实 GUI 中不可达。这是产品策略决策（改为按规范化源码计数发布，或为 source 模式提供行内标记），不应由实现方静默改规则。

## 真实 GUI 采证（仍需人工）

Typora 已启动并加载本轮 bundle。以下项目仍保留人工验收：

1. 打开 `test/vault/__gui-blank-end-excess.md`，展开面板并点击该诊断行：
   - 左侧 2px 实线 + `多余 3 空行` 标签（已由 computed style 证实），确认肉眼无整片黄色、标签不在右端。
2. 打开 `test/vault/__gui-blank-end-missing.md` 点击诊断行：18px 短虚线 + `缺少 1 空行`。
3. 行内「修复」→ 预览 → 确认 → 诊断重算 → `Ctrl+Z` 一次恢复；同规则 ≥2 项时在预览内点「同类修复（N 项）」→ 一次写回 → 一次撤销。
4. 100/125/150% DPI、深色主题、窗口缩放、侧栏拖拽：面板左右边界与顶部严格同宽（≤1 CSS px）。

## 构建与部署

- `dist/main.js`：`CA5E41EC3C22BD5CEF0E6210F55323D5684D0AD31A48558BD6E5C9111BC9E8A8`
- `dist/style.css`：`96A5EE1EA8CA1445C696222B71A0D4602B6601C6C344A743D9F9DD6F68DF65F5`（本轮未改 CSS）
- 测试 vault 部署文件 SHA 与上述一致（采证用的临时 observer 追加版已在采证后还原为 pristine）。

## 真实 GUI 采证（NEEDS_MANUAL）

Typora 已启动并加载本轮 bundle。以下项目保留人工验收：

1. 打开 `test/vault/__gui-blank-end-excess.md`，展开右上角面板：
   - 背景应为纯白，行之间有细分隔线，选中/hover 为浅灰。
2. 文末多余空行：左侧 2px 实线 + `多余 3 空行`（无整片黄色、无右侧数字）。
3. 文末缺少空行：`test/vault/__gui-blank-end-missing.md`，18px 短虚线 + `缺少 1 空行`。
4. 行内「修复」→ 预览 → 确认 → 诊断重算消失 → `Ctrl+Z` 一次恢复；同规则 ≥2 项时在预览内点「同类修复（N 项）」→ 一次写回 → 一次撤销。
5. 100/125/150% DPI、深色主题、窗口缩放、侧栏拖拽：面板左右边界与顶部严格同宽（≤1 CSS px）。
6. 内部连续空行：见上方 BLOCKED 事实；待策略决策后再验收。

---

## M1-LAYOUT / M1-RENDER-COUNT 本轮真实 GUI 采证（2026-11-12）

### 1. 源码空行 ↔ 渲染空段落映射（`runtime/gui-acceptance/blank-dom-*.json`）

| 夹具 | 源码行 | 源码空行 | 渲染空 `<p>` |
| --- | --- | --- | --- |
| `__gui-b0.md` | 2 | 0 | 0 |
| `__gui-b1.md` | 3 | 1 | 0 |
| `__gui-b2.md` | 4 | 2 | 0 |
| `__gui-b4.md` | 6 | 4 | 1 |
| `__gui-b9.md` | 11 | 9 | 4 |
| `blank-end-excess`（文末 3 空行） | 6 | 3 | 2（含 1 个 allowed 行） |
| `blank-end-missing` | 3 | 0 | 0（无幻影占位段落） |

结论：**1 个 `\n` ≠ 1 个渲染空行**。用户可见数量只能取 `renderedBlankLineCount`；源码数仅在 source 模式并显式标注「源码」。

### 2. 标记几何（真实 Typora 1.6.7，`snap-D/E/G.json`）

| 项 | 实测 |
| --- | --- |
| `#write.left` | 390.4 |
| 文本列 left | 420.4 |
| 内部空行 rail | `left=-18px; width=18px` → 视口 l=402.4, w=18, `border-left` 2px（1.6px @125%）实线 |
| 内部空行 chip | `多余 4 空行`（源码 9），L406.4 T183.2 |
| 光标进入首个空行后 | chip 自动 T183.2 → T221.2（避让下一行），`collision=0` |
| 文末多余 rail | 载体 rect 保持 l=420.4（`endBandAnchorDriftPx` 门禁），rail l=402.4 w=18 |
| 文末多余 chip | `多余 2 空行`（源码 3 空行） |
| 文末缺少 | `--ink-blank-marker-offset: -18px`；虚线 l=402.4 `1.6px dashed rgb(168,121,50)`；标签 `缺少 1 空行` l=412.4 |
| 独立碰撞检查 | chip 246.2–266.2 vs 光标行 218–243.6 → `manualChipCaretCollision=false` |

### 3. 修复链路（真实 GUI，`snap-H3.json`）

- 预览：`将修改源码 1 处 · 将删除 3 行源码空行（源码第 4–6 行）`（渲染层显示「多余 2」）。
- 确认后：面板关闭、诊断行清空、chip/rail 移除，`editor.getMarkdown()` = `…最后一段内容。\n`。
- 真实按键：`Ctrl+Z` → 恢复 `\n\n\n\n`；`Ctrl+Y` → 回到修复态 `\n`（单事务一次撤销）。

### 4. 本轮修复的两个真实缺陷（非 CSS 掩盖）

1. **EOF chip 定位基座错误**：`paintDocEndExcessRows` 用「第一条尾随行」当 `containerTop`，而 chip 的 `top` 相对载体 → 每个文末标签下移约 38px，碰撞判定评估的矩形与实际绘制矩形不一致（假 PASS）。改为载体自身 `hostRect.top + localRect.top`，候选行仅取 `trailingBlankRects.slice(requiredRows)`（超额行），全部被光标占用时移到载体下方。
2. **写回校验权威错误**：块级结构序列化器不保留文末换行（写回后 `…内容。`），导致真实成功的修复被判 `READBACK_MISMATCH`。新增 `readMarkdownExact`（文本镜像）作为唯一 READBACK 权威；基座仍用结构序列化器。
3. **写回基座权威错误（会后复现，已修）**：`editor.UserOp.getMarkdownSourceFrom($('#write'))` 在有**已渲染代码块**的文档里会把代码块正文序列化成 DOM 文本 —— 取证实测为 `" 1runtime/smoke/….mdTXT纯文本1 行"`（` 1` 行号槽、`TXT纯文本` 语言标签、`1 行` 行数提示），见 `snap-J.json`；同一文档的镜像 `editor.getMarkdown()` 与磁盘文件逐字节一致。修复器过去以结构序列化结果为整篇写回基座，因此在 `test/vault/doc.md` 上执行「删除文末多余空行」时把这段界面文字写进了代码块。现改为：**写回基座 / 陈旧性比对 / 回读全部使用文本镜像**，结构序列化只保留给诊断读取。

### 3b. doc.md 代码块污染回归（真实 GUI，`snap-K/L/M.json`）

| 阶段 | 代码块状态 | 文末换行 | 说明 |
| --- | --- | --- | --- |
| 修复前 | 正文 `runtime/smoke/….md`（渲染层另有行号/语言 chrome） | 6 个（12 字符 CRLF） | — |
| 点「删除文末多余空行」后 | 仍为 `runtime/smoke/….md`，`纯文本`/`TXT` 未出现 | 1 个（2 字符） | 直接修复，无中间预览面板，提示「已修复 1 项（Ctrl+Z 可撤销）」 |
| `Ctrl+Z` | 不变 | 恢复 6 个 | 单事务撤销成立 |
| `Ctrl+Y` | 不变 | 仍为 6 个 | **未复现 redo**（`reloadContent` 的 undo 步未提供 redo 步），记为 NEEDS_MANUAL |

同时在本轮确认：同一份诊断生成的内部空行修复（8 空行 → 1）同样不再污染代码块。


### 5. 本轮验证

- `npx vitest run`：345 文件 / 6007 测试 PASS。
- `tsc --noEmit` PASS；`pnpm build` PASS。
- `dist/main.js` SHA256：`904EEAD679A9732144F1D7ABDF9FAED57EAD5C66B4AC9274F6F59F4FEEC883EF`（含写回基座修复）。
- 测试 vault 部署文件已还原为无探针的同一 `dist/main.js`；夹具已还原；采证脚本保留在 gitignored 的 `runtime/gui-acceptance/`。

### 6. 仍未验收（NEEDS_MANUAL）

1. 100% / 125% / 150% DPI、深色主题下的 rail 与 chip 位置（本轮仅在默认 DPI/浅色下实测）。
2. 窗口缩放与侧栏拖拽到极窄时 `gutterPx` 收缩与 chip 重新安置（纯函数已测，真实窄窗未点验）。
3. 文档锁定、多文档快速切换下的标记生命周期。
4. 「同类修复（N 项）」多诊断一次写回 + 一次撤销（本轮为单项）。
5. 内部空行诊断在 source 模式下的发布策略（上方既有 BLOCKED 事实未变）。
6. `Ctrl+Y` 在 `reloadContent` 修复事务后的 redo（本轮未复现，撤销正常）。
7. 诊断读取仍使用结构序列化器：含多行代码块的文档里，块内文本与行号会与真实 Markdown 不一致（本轮仅把**写回**切到文本镜像；诊断读取未改，属已知限制）。

DevTools 只读采证（可选）：
```js
const panel = document.querySelector('.inkchapter-doc-toolbar-ui .inkchapter-doc-expand__panel')
const rows = [...document.querySelectorAll('.inkchapter-doc-expand__diag')]
const chips = [...document.querySelectorAll('.inkchapter-blank-run-count')]
console.log({
  surfaceBg: getComputedStyle(document.querySelector('.inkchapter-doc-expand__layout')).backgroundColor,
  rowSeparator: rows[0] && getComputedStyle(rows[0]).borderBottomColor,
  chips: chips.map(c => ({ text: c.textContent, left: getComputedStyle(c).left, right: getComputedStyle(c).right })),
  markers: [...document.querySelectorAll('[data-ink-eof-marker="true"]')].map(m => ({
    form: m.getAttribute('data-ink-eof-form'),
    bg: getComputedStyle(m).backgroundColor,
    borderLeft: getComputedStyle(m).borderLeft,
  })),
})
```


---

## 追加：图片独立块规则纠偏（snap-AA → snap-BB / snap-BC）

### A. 结论

- 图片结构问题按**真实容器 / 组合**分类为 7 条稳定 ruleId（`source-block` 定位）：
  - `FIGURE_IN_LIST`（错误）图片被设置为列表项
  - `FIGURE_IN_QUOTE`（错误）图片被设置为引用块
  - `FIGURE_IN_TABLE`（错误）图片嵌入表格单元格
  - `FIGURE_MULTIPLE_SAME_BLOCK`（错误）多张图片位于同一段落
  - `FIGURE_TEXT_MIXED`（警告）图片与正文位于同一段落
  - `FIGURE_INLINE_FORMAT`（警告）图片包含不允许的行内格式
  - `FIGURE_BLOCK_STRUCTURE_INVALID`（错误）图片独立块结构异常（通用兜底）
- 每个 owning block **只发布一条**诊断，优先级：非法容器 > 多图同行 > 图文混排 > 行内格式 > 通用结构。
- 上一轮新增的 `FIGURE_MIXED_WITH_TEXT` 与本规则族重复，仍保持整条移除。
- 原规则此前"只报错不能修"的原因：`buildStandaloneFigureBlockFix()` 只存在于纯函数层，
  `V1_FIXERS` / `CAPABILITY_MATRIX` 中没有它的条目，UI 因此永远拿不到 `fix` 描述符。
- 本轮为每个可修复分类接入真实修复器（`AUTO_SAFE`，`replace-block`）：列表移除标记、引用移除全部层级、
  多图 / 图文拆分、行内格式剥离；表格单元格保持 `UNAVAILABLE`（不渲染修复按钮）。

### B. 真实 Typora 验收（snap-BB）

夹具 `test/vault/__figure-structure.md`（1 个 2 图 + 正文段落、1 个图文段落、1 个已独立图片、1 个列表内图片）。

| 阶段 | 结果 |
|---|---|
| `FIX_1` | 2 图 + 正文段落一次写回：`文字A` / `![图1]` / `![图2]` / `文字B` 四块；toast「已修复 1 项（Ctrl+Z 可撤销）」 |
| `FIX_2` | 图文段落一次写回：`只有文字和一张图` / `![图3]` 两块 |
| `ROWS_AFTER` | 仅剩列表内图片一行，`rowFixButtons=[false]`（不渲染修复按钮） |
| `UNDO` | `editor.undo.undo()` → Markdown 回到 FIX_1 之后的状态（一次撤销回退整次写回） |
| `SETTLED` | 两条可修复行重新出现（L10 / L14），列表行仍无按钮 |

全程没有任何 `图片与正文混排` 行；行标题均为 `图片必须作为独立块插入`。

### C. 渲染验收（snap-BC）

修复后 `#write img`：`imgCount=5`、`imgLoaded=5`（4 张正文图 + 1 张已独立图全部加载成功）；
顶层段落顺序为 `文字A` / `![图1]` / `![图2]` / `文字B` / …，确认按原顺序拆成独立块。

### D. 回归

- 347 文件 / 6032 测试通过；`tsc --noEmit` PASS；`pnpm build` PASS。
- 新增 12 条定向用例（多图同行 / 三图顺序 / 图文前后 / 中文路径 + title / 已独立不误报 /
  围栏与行内代码 / 列表与引用拒绝 / 表格拒绝 / 一键多块 / 幂等 / 不重复警告 / 能力矩阵）。

### E. 仍未验收（NEEDS_MANUAL）

1. `Ctrl+Y`（redo）在 `reloadContent` 事务后的行为——本轮只验证了 `editor.undo.undo()` 的撤销。
2. 列表 / 引用 / 表格图片的"手动修复"路径（本轮按规范明确拒绝自动修复，未提供引导式交互）。
3. 与上一节相同的 DPI / 主题 / 极窄窗、多文档快速切换等既有未验收项。

---

## 追加：标题内图片检测与修复（V1）

### A. 规则

- 新增 `FIGURE_IN_HEADING`（错误，`source-block`）：「图片被插入标题」。
  覆盖 H1–H6 的文字前 / 中 / 后、多图、仅图片、空路径图片；优先级高于
  `FIGURE_MULTIPLE_SAME_BLOCK` / `FIGURE_TEXT_MIXED`，同一标题只发布 1 条结构诊断。
- 新增 `FIGURE_SYNTAX_IN_HEADING`（错误，`source-block`）：「标题中包含图片链接语法」。
  只覆盖**没有完整图片 token** 的标题语法残留（如未闭合的 `![J](url`）；有完整 token 的
  标题由 `FIGURE_IN_HEADING` 独占，同一图片节点不会重复报错。
- 新增 `FIGURE_EMPTY_SOURCE`（错误，`source-range`）：「图片路径为空」。
  `![]()` / `![alt]()` / `![alt](   )` 作为独立资源维度报告；结构修复后仍保留。
  **V2 起能力为 `EXPLICIT_ONLY`：删除必须由用户点击该行「处理」明确触发，不进入一键修复。**
- 检测权威是 Markdown 源码（`document-figure-heading-invariant-v1.ts`），
  不是渲染后的 `<img>`；行内代码、代码围栏、转义 `\![...]` 一律排除。

### B. 修复

- 有文字标题：保留 H1–H6 层级与文字，图片按原顺序移到标题后的独立段落；
  标题内残留的图片语法片段一并移出，标题中不再留下 `![](...)`。
- 仅图片标题：移除标题结构，图片节点原样保留。
- 空路径图片：结构修复时原样保留（`![]()` 仍是 `![]()`），不伪造路径、不自动上传/下载；
  用户明确选择「删除空图片占位符」时才删除。
- 单一修复与一键修复走同一 `replace-block` 源补丁；修复后重新解析文档刷新诊断。

### C. 自动化回归

- `document-figure-heading-invariant-v1.test.ts`：33 条用例（H1–H6、前/中/后、
  多图、仅图片、三种空路径、标题语法残留、平衡括号 URL、行内代码/转义/围栏排除、
  标题层级保持、图片 token 保持、显式删除空路径、单项与一键一致性、幂等、抽屉文案、
  共享扫描器转义排除）。
- 全量 Vitest：349 文件 / 6088 测试通过；`tsc --noEmit` PASS；`pnpm build` PASS。

### D. GUI 验收（真实 Typora，V1 记录）

> 以下为 V1 验收记录，当时 `FIGURE_EMPTY_SOURCE` 为 `AUTO_SAFE`。V2 已改为
> `EXPLICIT_ONLY`（一键修复不再删除空图片），并新增标题语法规则与列表/引用原位修复；
> 复验结果见下一节。

夹具：`test/vault/runtime/smoke/Figure-Heading-Image-Test.md`。
运行时回执确认新构建已由 Typora 加载（`mainJsSha256=9304AB67…`，`loadSource=vault`）。

| 步骤 | 真实结果 |
|---|---|
| 检测面板 | 7 条 H2–H6「图片被插入标题」（含两处空路径标题）+「图片路径为空」独立行；标题/说明与规则表一致，无通用「图片必须作为独立块插入」 |
| 单项修复 | 点击第 4 行「将图片移出标题」→ toast「已修复 1 项」；标题文字保留、图片移到标题外；错误 9 → 8 |
| 空路径修复 | 「图片路径为空」行提供「移除空图片」按钮；标题内的空图片与标题结构修复合并为一次操作，`![]()` / `![说明]()` 被移除 |
| 一键修复 | 点击「一键修复可处理项」→ toast「已修复 7 项」（5 个标题 plan + 2 个空路径综合 plan）；标题图片全部移出、空图片节点全部移除；最终错误 0，警告 1（代码块名称），提示 3 |
| 行内代码 / 转义 / 围栏 | 行内代码与代码围栏不产生诊断；转义图片保持文字 `!不应检测`，不产生图片行 |
| 去重 | 同一标题只有 1 条 `FIGURE_IN_HEADING`；无 `FIGURE_TEXT_MIXED` / `FIGURE_MULTIPLE_SAME_BLOCK` |
| Ctrl+Z / Ctrl+Y | 单项修复后 Ctrl+Z 回到原始结构（错误 9），Ctrl+Y 恢复修复结果（错误 8） |

**空路径综合修复（V1 行为，V2 已取消）**：V1 中标题内的 `FIGURE_EMPTY_SOURCE` 计划会同时完成
标题结构修复并移除空 token，因此优先于普通 `FIGURE_IN_HEADING` 计划。V2 改为 `EXPLICIT_ONLY`
后，一键修复不再包含空路径计划，标题修复由 `FIGURE_IN_HEADING` 独占并原样保留空 token。

**GUI 验收发现并修复的真实缺陷**：共享资源扫描器此前未排除反斜杠转义的图片标记
（`\![alt](src)`），导致转义行被当成 `FIGURE_TEXT_MIXED` 并被一键修复拆成图片。
已在 `scanMarkdownReferences` / `findReferenceSpans` 中跳过奇数反斜杠转义的引用，
并新增回归用例；复验后转义行保持文字且不再有任何图片诊断。

---

## 追加：V2 图片规则纠偏（本轮）

### A. 规则与去重

- `FIGURE_IN_HEADING`：标题中存在**完整图片 token**（含空路径 `![]()`）；一个标题只发 1 条，
  优先级高于多图 / 图文 / 通用结构。
- `FIGURE_SYNTAX_IN_HEADING`：标题中存在**未闭合的图片链接语法**（`![...](` 但没有配对的
  `)`），且该标题没有完整 token；一个标题只发 1 条。两者以「是否存在完整 token」为唯一边界，
  同一图片节点不会重复报错。
- 空路径 `FIGURE_EMPTY_SOURCE` 仍是独立资源维度：标题结构修复后继续显示，不会被静默清除。
- 规则 ID 映射：V2 表中的 `FIGURE_BLOCK_STRUCTURE` 沿用既有稳定 ID
  `FIGURE_BLOCK_STRUCTURE_INVALID`（兜底规则），未新增同义 ID。

### B. 修复（真实源码补丁）

- 标题：图片 + 语法片段按源码顺序移出，标题层级 / 文字 / 图片字节不变；仅图片 / 仅语法标题
  失去标题标记；空路径 token 原样保留。
- 列表（§6.3）：**原位**拆分，`- 第一项\n- ![图]\n- 第三项` →
  `- 第一项\n\n![图]\n\n- 第三项`；有序列表保留字面编号；任务列表仅移除任务标记。
  嵌套项、带缩进子内容的项拒绝自动修复并说明原因。
- 引用（§7.3）：**原位**提取，图片前后引用文字保留各自引用属性，`>` 空行邻居被规范化，
  不把其他引用文字转成普通段落。
- 空路径（§10.1）：能力 `EXPLICIT_ONLY`，行内按钮文案「删除空图片占位符」，需用户明确点击；
  `planAllAutoFixesV2` / 「N 项可自动修复」/ 一键修复均不包含它。
- 一键修复（§13.2）：只收集 `AUTO_SAFE`，按依赖优先级排序（容器 → 多图 → 图文 → 通用；
  同优先级按位置），冲突计划保留先占用字节者；合并为一次 `reloadContent`，写回后重新检测。

### C. 自动化回归

- `document-figure-heading-invariant-v1.test.ts`（33）：新增标题语法残留 / 平衡括号 URL /
  显式删除空路径 / 一键不删除空路径。
- `document-figure-issue-classification-v1.test.ts`（22）：新增列表原位、兄弟项保留、有序
  列表编号、任务列表、缩进子内容拒绝、引用原位三段。
- 全量 Vitest：349 文件 / 6088 测试通过；`tsc --noEmit` PASS；`pnpm build` 与 `pnpm build:dev` PASS。
- 真实 Typora 已加载新构建：`mainJsSha256=664F5D73B04A0E40246E55CCDDD9B2901B5860174190568111C33CC3BCE546E6`，
  `loadSource=vault`。

### D. GUI 复验（真实 Typora，PASS）

夹具：`test/vault/runtime/smoke/Figure-Standalone-Block-Invariant-Test.md`（含 V2 追加用例）。

| 场景 | 真实结果 |
|---|---|
| 初始检测 | 错误 9 / 警告 3 / 提示 6；「11 项可自动修复」——空路径项**不计入**一键修复 |
| 可见行 | 3×「图片与正文位于同一段落」、2×「多张图片位于同一段落」、1×「图片被设置为列表项」 |
| 一键修复 | toast「已修复 11 项（Ctrl+Z 可撤销）」；剩余 1 错误（「图片路径为空（第 86 行）」）+ 1 警告 + 2 提示 |
| Case I2 列表 | 保存后的源码为 `- 第一项` / 空行 / `![I2]` / 空行 / `- 第三项`，兄弟项与顺序不变 |
| Case J2 引用 | `> 前面的引用说明` / 空行 / `![J2]` / 空行 / `> 后面的引用说明`，前后文字保留引用属性 |
| Case K 标题语法 | `## 结束` 与 `![K](https://raw.githubusercontent.com/…)` 分成两个块，标题中无 `![` 残留，远程 URL 完整（V3 起由 `FIGURE_UNCLOSED_DESTINATION` 检出） |
| Case L 标题多图 | `## 标题` + 独立 `![L1]` + 原样保留的 `![]()`；标题文字与图片均未丢失 |
| 空路径显式处理 | 行内按钮 aria「删除空图片占位符：图片路径为空」；点击后 toast「已修复 1 项」、错误 0；源码中的 `![]()` 行被干净删除，L1 与标题保留 |
| Ctrl+Z / Ctrl+Y | Ctrl+Z：错误 9 / 警告 3（整批恢复）；Ctrl+Y：错误 1 / 警告 1（整批重做） |
| 去重 | 每个标题 / 容器只出现一条专用诊断；无通用「图片必须作为独立块插入」占位文案 |

---

## 追加：V3 图片链接语法完整性（本轮）

### A. 规则

- `FIGURE_UNCLOSED_DESTINATION`：「图片链接括号未闭合」（错误，`source-range`）。
- `FIGURE_UNCLOSED_ALT`：「图片描述方括号未闭合」（错误，`source-range`）。
- `FIGURE_MALFORMED_SYNTAX`：「图片链接语法不完整」（错误，`source-range`）。
- `FIGURE_INVALID_DESTINATION`：「图片路径语法不合法」（错误，`source-range`）。
- `FIGURE_EMPTY_SOURCE`：保持独立资源规则；空路径不重复报语法错误。
- 扫描器：`document-figure-syntax-integrity-v1.ts`，按行状态机处理 `![` 候选，支持平衡括号、转义括号、尖括号路径、title、中文 / 空格 / 百分号 / 查询参数；跳过围栏代码、行内代码、转义语法、普通链接、HTML 注释与 raw-text 元素。

### B. 修复与二次检测

- 缺少 `)`：仅在“段落结尾 + 本段无其他未闭合结构”时自动插入 `)`，URL 字节不变。
- 缺少 `]`：仅在描述与路径边界无歧义（描述不含括号、恰有一个 `(` 且有匹配 `)`）时插入 `]`。
- 语法不完整 / 路径非法：仅诊断与定位，不显示修复按钮。
- 修复后重新运行全部图片规则：标题 / 列表 / 引用 / 多图 / 图文 / 空路径会继续提示。

### C. 自动化

- `document-figure-syntax-integrity-v1.test.ts`（14）：缺少 `)` / 缺少 `]` / 完整闭合 / 空路径 / 平衡括号 / 转义括号 / 尖括号 / title / 中文百分号 / 围栏 / 行内代码 / 转义 / HTML / 标题列表引用 / 多候选 / 最小字节修复。
- `document-figure-syntax-diagnostic-v1.test.ts`（12）：Case K / Case L、单项与一键、修复后二次诊断、歧义降级、幂等。
- 全量 Vitest：351 文件 / 6116 测试通过；`tsc --noEmit` PASS；`pnpm build` PASS。

### D. GUI 复验（真实 Typora，PASS）

构建 `mainJsSha256=D9240095A3DAC14898A9D0E03850846F720E6E38C2FEEF913DF9A5ACB77CE8DD`，`loadSource=vault`。

| 场景 | 真实结果 |
|---|---|
| Case K 初始 | 行内显示「图片链接括号未闭合」；错误 6 / 提示 4，5 项可自动修复 |
| Case K 单项修复 | toast「已修复 1 项」；源码补全为 `![K](https://…/k.png)`，URL 完整；该行随即变为「图片被插入标题」 |
| Case L | 「图片被插入标题」与「图片路径为空」分别显示；空路径未被语法规则误报 |
| Case M | 「图片描述方括号未闭合」；修复后为 `![M](…png)` |
| Case N / O | 列表 / 引用中的未闭合 `)` 同样被检出；补全后分别转为「图片被设置为列表项 / 引用块」 |
| 一键修复 | 「已修复 5 项」；剩余 3 项（空路径 + 列表 + 引用），空路径仍为显式处理 |
| Ctrl+Z / Ctrl+Y | 撤销恢复未闭合语法行；重做恢复补全后的标题错误 |
| 保存源码 | K / L 标题图片移出，M 方括号补全，N / O 括号补全；`![]()` 原样保留 |

---

## 追加：V3-UI 文档检测面板全规则行号统一（本轮）

### A. 审计发现

- 源码类规则（`source-range` / `figure-occurrence` / `source-block`）有真实行号，但 UI 直接显示 0-based 值（例如源码第 87 行显示为 L86）。
- `document-start` / `document-end` 边界规则、`caption-projection`、`multi-target` / `target-group` 投影不产生行号。
- 标题 `canonical-node`、代码/链接 `block-node` 依赖 `data-line`；Typora 标题/链接元素常无该属性，导致「章节没有正文」「重复标题」「代码块缺少名称」「本地链接目标不存在」等行完全不显示。
- `DOCUMENT_EMPTY` 等非定位通知没有任何行号来源。

### B. 统一实现

- `flattenDiagnosticsToProjections` 增加唯一位置解析链：
  1. 定位器自带行（源码 range / 图片 occurrence / owning block / source-syntax opener）；
  2. 实时元素 `data-line`；
  3. 规则元数据真实行（`startLine` / `sectionStartLine` / `sourceLine` / `blockStartLine` 等）；
  4. 嵌套定位器首成员（multi-target / target-group）；
  5. 显式文档边界（document-start = L1；document-end = 当前行数）；
  6. 仅 document 作用域规则允许回退到文档起点；非定位通知也以文档起点显示。
- `computeDocumentDiagnostics` 统一盖章：用当前 Markdown 的 ATX 标题行表、canonical 对象边界表、链接事实与元素 `data-line` 为缺失行号的诊断补 `metadata.startLine`（0-based 内部值）。
- `diagnosticDisplayLine(sourceLine)` 是唯一的 1-based 展示转换；面板、预览统一使用。
- 行号列固定 48px、右对齐、tabular numbers、nowrap；修复按钮有无都不影响行号列。

### C. 自动化

- `document-diagnostic-line-unification-v1.test.ts`（8）：source/canonical/block/caption/element/document-start/end/multi-target/target-group/metadata/通知/1-based 显示。
- `document-diagnostic-line-coverage-v1.test.ts`（3）：真实混合文档（标题跳级、重复标题、章节提示、本地链接、本地图片、代码块、图文混排、EOF）逐规则行号断言；无 DOM `data-line` 时所有投影仍非空；LF/CRLF/中文/Emoji 映射一致。

### D. 真实 Typora GUI 复验（PASS）

验收构建（dev bundle）`mainJsSha256=D7ABD178AC128DDE6DD0DCDB267937C5D0789DB111ACA135B7F58687F65B31E2`，`loadSource=vault / global`。最终交付重建为生产包 `mainJsSha256=68B31D88FD840CE33E17CDF4E32CA1CB84BF5A0AAADE74A12870A32970FF640C`；重新执行 dev 构建可复现 `D7ABD178…`，证明两次构建源码完全一致，仅压缩模式不同，行为不变。最终构建已同步到 vault 与两个全局插件目录。

| 场景 | 真实结果 |
|---|---|
| 混合文档面板 | 5 警告 / 6 提示，全部行显示 1-based `Lxx` |
| 章节仅包含子标题 | L3（章节标题行） |
| 章节没有正文 | L5 / L7 / L77 / L79 等真实标题行 |
| 重复标题 | L9（后出现的重复标题） |
| 本地链接目标不存在 | L11 |
| 本地图片不存在 | L13 |
| 图片与正文同段 | L15 |
| 一键修复后 | 行号随新快照重算：空路径从 L86 → L85，标题图片 L77；不再保留旧行号 |
| 无修复按钮的 info 行 | 仍显示 L3 / L5 / L7 / L9 |
| 窄窗口 / 5 位行号 | 48px 固定列 + nowrap + tabular numbers，无遮挡或换行 |

### E. 最终门禁（本轮）

- 全量 Vitest：**353 文件 / 6128 用例全部通过**（含新增 `document-diagnostic-line-unification-v1` 8 项、`document-diagnostic-line-coverage-v1` 3 项）。
- `tsc --noEmit`：PASS。
- `pnpm run build`（prod）：PASS，`dist/main.js` = `68B31D88…`。
- `pnpm run docs:verify`：PASS（`DOC_BROKEN_LINK_COUNT=0`、`STALE_PROMPT_REFERENCE_COUNT=0`）。


---

## 追加：全类型空行策略矩阵 V1（本轮）

### A. 统一矩阵

| 前一个块 | 后一个块 | 允许的额外渲染空段 | 修复目标 |
|---|---|---:|---:|
| 正文 | 正文 | 1 | 保留 1 |
| 任意其他普通块组合（正文/标题/图片/代码块/公式块/表格/列表/引用块） | 任意其他普通块组合 | 0 | 清除为 0 |
| 文档开头 | 任意块 | 0 | 清除为 0 |
| 任意块 | 文档末尾 | 1（严格） | 补齐或删减为 1 个换行 |

- 判定轴：Typora 真实渲染空段落（`visibleBlankLineCount`）；源码换行数只用于修复与位置映射。
- 修复始终保留 1 个源码结构空行，因此 0 目标不会合并相邻正文，也不会破坏围栏、公式、表格、列表或引用结构。
- 普通正文之间只做超额删减，不补齐缺失空行；只有文档末尾允许补齐。

### B. 模块

- `document-diagnostic-blank-adjacency-policy-v1.ts`：矩阵、块类型映射、块对文案、超额判定（唯一权威）。
- `document-diagnostic-internal-blank-decision-v1.ts`：发布判定改为 `visible > 当前块对允许值`。
- `document-diagnostics.ts`：诊断 metadata 增加 `blankPairAllowance` / `blankPairStructuralSourceBlankLines`。
- `document-diagnostic-leading-blank-lines-v1.ts`：新增 `DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE`（文首 0，源级检测）。
- `document-diagnostic-fix-v1.ts`：新增文首空行删除与 `DOCUMENT_TERMINAL_NEWLINE_MISSING` 自动补齐。
- `document-diagnostic-blank-marker-v1.ts`：标记数量 = `publishedBlankLineCount − blankPairAllowance`。

### C. 门禁

- 全量 Vitest：**355 文件 / 6155 用例全部通过**。
- `tsc --noEmit`：PASS；`pnpm run build`（prod）：PASS，`dist/main.js` = `9004C7DA…`。
- 新增矩阵测试 7 项、文首规则/集成测试 9 项、修复测试 7 项、标记计数测试 4 项。
- 真实 Typora 1.6.7：已加载 `mainJsSha256=9004C7DA…`（`loadSource=vault`，`initializationCount=1`）并打开 `Blank-Line-Matrix-Runtime-Test.md` 夹具。
