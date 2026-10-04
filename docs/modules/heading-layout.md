# 标题排版与段落排版

## 一、标题排版（Heading Layout）

### 用户可见功能

用户可为 H1-H6 每级标题独立设置对齐（左/居中/右）和首行缩进（0/2em）。当前文档可覆盖全局默认排版。设置页提供可视化的排版预览。

### 排版模型

标题排版以物理层级（H1-H6）为 key 存储，与编号格式（通过 S1-S6 slot 存储）独立。**宽松/严格各自独立保存 H1-H6 排版，禁止 strict H2-H6 映射 loose H1-H5 的 level shift**：

- `headingLayoutsByMode: { loose: HeadingLayoutSettings, strict: HeadingLayoutSettings }`（权威，per-mode 物理 H1-H6）
- `headingLayouts`（legacy 共享，仅作迁移源；加载时 `normalizeHeadingLayoutsByMode` deep-clone 到 loose+strict）
- 文档覆盖存储在 `layoutOverrides.headingLayoutsByMode`，不影响 `formatSource`
- 排版解析统一经 `resolveHeadingLayoutsForMode(settings, mode)`，物理索引，无 level shift
- 编号与标题间距（number-title gap）属于编号格式 slot 层，存储于 `levels[lv].numberTitleSpacing`

### 关键规则

1. **排版与格式独立**: 修改对齐/缩进不改变格式来源身份
2. **宽松/严格完全隔离**: strict.Hn 修改不影响 loose.Hn；切换模式各自恢复各自排版
3. **首行缩进作用于整个 heading block**: `[number][gap][title]` 缩进一次，不重复
4. **Focus/Blur 一致性**: heading 获得焦点时，CSS `::before` 伪元素与 heading 正文保持同层缩进
5. **Strict H1 排版**: H1 作为文档题目，gap 强制为 `none`（H1 无编号时）
6. **Loose S6 排版**: 当 `configured=true` 但 `numberingEnabled=false` 时，S6 排版仍生效

### 相关代码

- `src/settings/heading-numbering-setting-tab.ts` — 排版 UI（④标题排版并入格式内容设置）
- `src/heading-numbering/heading-types.ts` — `HeadingLayoutConfig`、`HeadingLayoutsByMode`、`DocumentLayoutOverrides`
- `src/heading-numbering/heading-numbering-scope-store.ts` — `resolveHeadingLayoutsForMode`、`normalizeHeadingLayoutsByMode`
- `src/heading-numbering/heading-numbering-service.ts` — 排版样式注入（物理 H1-H6，无 level shift）

## 二、段落排版（Paragraph Layout）

### 用户可见功能

文档正文段落支持统一顶格或首行缩进 2 字符。支持快捷指令：在空行输入 `..` 或 `。。` 后按 Enter，创建强制首行缩进段落。公式后的续接文本自动顶格。

### ParagraphLayoutSettings

```
defaultIndent: 'flush' | 'indent-2'     // 文档默认段落缩进模式
flushAfterDisplayMath: boolean           // 公式后续接文本自动顶格
indentShortcutEnabled: boolean           // .. / 。。 + Enter 快捷指令开关
```

### 缩进解析优先级

唯一纯函数 resolver `resolveEffectiveParagraphIndent(semantic, documentDefault, structural, transient?)`：

1. `force-indent` → `indent-2`（显式 override 最高）
2. `force-flush` → `flush`（显式 override 最高）
3. `structuralContext.isFormulaContinuation` → `flush`（结构规则，`flushAfterDisplayMath ? isAfterDisplayMath(p) : false`）
4. `documentDefault` → `indent-2` / `flush`（普通正文默认，最低）

即：`explicit override > structural formula-continuation flush > ordinary default`。设置解析统一经 `resolveParagraphLayoutSettings(store, docKey)`（doc override → global → 硬默认）。

### 快捷指令 (`..` / `。。` + Enter)

- 用户在独占行输入 `..` 或 `。。`，按 Enter 后触发 EmptySpecial（仅当 `indentShortcutEnabled=true`）
- `indentShortcutEnabled=false` 时完全放行 Typora 原生 Enter（不 consume token、不建 txn/canonical、不写 force-indent）
- 精确匹配 `isTokenOnlyEmptySpecialCommand(text, '。。')`，caret 在 token 末尾、collapsed、普通正文（非 heading/list/quote/code/table/formula）
- 复用现有 EmptySpecial / empty-equivalent / canonical record / EMPTY_PADDING 链路，产生 **explicit force-indent**（非 auto+default）
- 即使 `defaultIndent=indent-2`，`。。+Enter` 仍写 explicit force-indent；显式 force-indent 覆盖 structural flush

### 相关代码

- `src/heading-numbering/paragraph-indent-manager.ts` — `resolveEffectiveParagraphIndent`、`readParagraphIndentCommand`、`isIndentShortcutEditingToken`
- `src/heading-numbering/heading-numbering-scope-store.ts` — `resolveParagraphLayoutSettings`
- `src/heading-numbering/heading-numbering-service.ts` — `getParagraphLayoutSettings` / `saveParagraphLayoutSettings`（save 后 `flushRefresh()` 无需重启生效）
- `src/heading-numbering/empty-special-command.ts` — `isTokenOnlyEmptySpecialCommand`
- `src/settings/heading-numbering-setting-tab.ts` — 段落排版设置 UI（预览复用 resolver）

## 当前状态

标题排版：已实现（per-mode loose/strict 隔离，无 level shift），Runtime 验证待 PF1 后补证。
段落排版：已实现（三个设置真正接入 Runtime），**PF1 targeted UI/Runtime smoke 待真实 Typora 执行**。

## 已知问题

- 段落排版/快捷指令缺真实 Runtime smoke 证据（PF1 INCOMPLETE）
- 标题 focus/blur 缩进一致性未经 GUI 验证
## 2026-08-19 Cleanup 吸收

- `trae-pf1-paragraph-layout-runtime-smoke.md`
- `trae-p0-empty-paragraph-special-command-continuity-repair.md`
- `trae-p0-empty-special-native-dom-mutation-authority-runtime-gate.md`
- `trae-empty-special-e2-01-node-runtime-gate-no-powershell.md`
- `trae-empty-special-runtime-harness-clean-9-trials-byte-window-gate.md`

以上 prompt 的结论统一沉入本页的 Paragraph Layout / EmptySpecial 规则，不再保留独立 prompt 文档。
