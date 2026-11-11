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
| 内部多余空行：2px 左侧实线，无整块填充 | PASS | `.inkchapter-block-gap-fragments`（transparent + border-left） |
| 文末多余空行：2px 左侧实线，不再整片米黄 | PASS | `[data-ink-eof-marker][data-ink-blank-region='amber-range']` |
| 文末缺少空行：16–20px 短虚线 | PASS | `.inkchapter-eof-endpoint-line`（18px，2px dashed） |
| 计数不再在最右端 | PASS | `.inkchapter-blank-run-count` / legacy `top-right` 选择器都渲染在 `left: 10px` |
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
| 面板/排序/修复交互测试 | PASS | hub controller（41）、model order（7）、panel（7）、controller（11） |
| TypeScript | PASS | `tsc --noEmit`（exit 0） |
| 全量 Vitest | PASS | `344 test files / 5974 tests` 全部通过 |
| build | PASS | `pnpm build`（verify:archive + tsc + esbuild prod） |
| 隐私 / docs | PASS | `PRIVACY_GATE=PASS`；`docs:verify RESULT=PASS` |
| 运行时 bundle | PASS | Typora 重新启动后回执 `mainJsSha256=389CEFE8E5D91DC4DFE14C9AB51BF6BAC501560F275251A1A2C28D7E094364CC`、`loadSource=vault` |
| 真实 Typora GUI 视觉/交互（白底、三类 marker、修复 diff、撤销） | NEEDS_MANUAL | Trae 无法读取真实像素/`getBoundingClientRect`；见下节步骤 |

## 构建与部署

- `dist/main.js`：`389CEFE8E5D91DC4DFE14C9AB51BF6BAC501560F275251A1A2C28D7E094364CC`
- `dist/style.css`：`96A5EE1EA8CA1445C696222B71A0D4602B6601C6C344A743D9F9DD6F68DF65F5`
- 测试 vault 部署文件 SHA 与上述一致。
- 运行时回执：`2026-11-11T16:19:19.584Z`，`loadSource=vault`，`mainJsSha256` 与本地一致。

## 真实 GUI 采证（NEEDS_MANUAL）

Typora 已启动并加载本轮 bundle（`loadSource=vault`，SHA 见下方构建记录）。Trae 侧无法读取真实像素/`getBoundingClientRect`，因此以下项目保留人工验收：

1. 打开 `test/vault/Document-Diagnostics-Code-Integrity-Test.md`，展开右上角面板：
   - 背景应为纯白，行之间有细分隔线，选中/hover 为浅灰。
2. 内部连续空行：左侧 2px 实线 + `多余 N 空行` 标签（N = `actualBlankLines − 1`），无整片黄色、无右侧数字。
3. 文末多余空行：左侧 2px 实线 + `多余 N 空行`（N = `extraTrailingBlankLineCount`），文末区域不填充。
4. 文末缺少空行（删除文件末尾换行）：16–20px 短虚线 + `缺少 1 空行`。
5. 点击三个标签中的任意一个：应定位到对应诊断；标签之外的覆盖层不应拦截正文光标/选择。
6. 行内「修复」→ 预览 → 确认 → 诊断重算消失 → `Ctrl+Z` 一次恢复；同规则 ≥2 项时在预览内点「同类修复（N 项）」→ 一次写回 → 一次撤销。
7. 100/125/150% DPI、深色主题、窗口缩放、侧栏拖拽：面板左右边界与顶部严格同宽（≤1 CSS px）。

DevTools 只读采证（可选）：
```js
const panel = document.querySelector('.inkchapter-doc-toolbar-ui .inkchapter-doc-expand__panel')
const rows = [...document.querySelectorAll('.inkchapter-doc-expand__diag')]
const chips = [...document.querySelectorAll('.inkchapter-blank-run-count')]
console.log({
  panelBg: panel && getComputedStyle(panel.parentElement).backgroundColor,
  rowSeparator: rows[0] && getComputedStyle(rows[0]).borderBottomColor,
  chips: chips.map(c => ({ text: c.textContent, left: getComputedStyle(c).left, right: getComputedStyle(c).right })),
  markers: [...document.querySelectorAll('[data-ink-eof-marker="true"]')].map(m => ({
    form: m.getAttribute('data-ink-eof-form'),
    bg: getComputedStyle(m).backgroundColor,
    borderLeft: getComputedStyle(m).borderLeft,
  })),
})
```
