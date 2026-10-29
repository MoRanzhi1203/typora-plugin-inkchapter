# 基础标题编号

## 用户可见功能

用户在 Typora 中编辑 Markdown 文档时，H1-H6 标题自动显示编号。标题编号通过 CSS `::before` 伪元素渲染，不修改 Markdown 原文。用户可以通过插件设置页的开关一键启用/关闭标题编号，也可以控制是否对 H1 显示编号。

## 预期表现

- 打开标题编号开关后，所有 H1-H6 标题立即显示自动编号
- 关闭开关后，编号立即消失，文档恢复原状
- H1 编号可见性可独立控制：关闭 H1 编号后，H2 从 1 开始计数，编号路径不暴露隐藏的 H1
- 文档正文编辑时实时刷新编号（防抖延迟 60ms）
- 文件切换后编号自动适配新文档

## 当前真实表现

基于代码分析（未 Runtime 验证）：
- 启用/禁用开关正常：`s.enabled` 控制总开关，通过 `heading-numbering-service.ts` 触发全局刷新
- H1 可见性切换正常：`showLevelOneNumber` 控制，通过 `applyLevelOneVisibility()` 统一入口处理，同步 checkbox UI
- 编号计算使用纯函数 `computeHeadingNumbering()`，层次计数器在启用级别间正确进位
- CSS 渲染通过 `numbering-formatter.ts` 生成 `::before { content: "..." }` 样式注入
- 刷新触发：`toggle`、`manual`、`initial-load`、`focus-in`、`file-open`、`active-leaf-change` 等事件
- 防抖延迟 60ms（`TAIL_REFRESH_MS`），焦点事件额外 50ms（`FOCUS_TAIL_MS`）

## 当前状态

已实现但未验收

## 已实现内容

- H1-H6 全部 6 级标题自动编号
- 全局启用/禁用开关（设置页 + F1 命令）
- H1 可见性独立开关（设置页 + F1 命令）
- 实时刷新（编辑、文件切换、焦点事件）
- 防抖优化（防止高频 DOM 操作）
- CSS `::before` 注入方式（不修改 Markdown 原文）
- 层次计数器进位逻辑（含 `startAt` 和 `restartAfterLevel` 支持）

## 未完成内容

- 缺少 Runtime 真实验证证据（截图/日志）
- H1 关闭时 H2 从 1 开始计数的编号路径有待验证

## 用户操作方式

1. 打开 Typora，点击 **文件 → 偏好设置 → 插件 → 墨章 InkChapter → 标题编号**
2. 在设置页中打开「启用标题编号」开关
3. 如需隐藏 H1 编号，关闭「一级标题显示编号」开关
4. 也可通过 F1 命令面板搜索「标题编号」快速切换

## 相关代码

- `src/main.ts` — 插件入口、命令注册
- `src/heading-numbering/numbering-engine.ts` — 编号计算纯函数
- `src/heading-numbering/numbering-formatter.ts` — CSS 格式化
- `src/heading-numbering/heading-numbering-service.ts` — 事件驱动刷新编排
- `src/heading-numbering/heading-types.ts` — 类型定义
- `src/settings/heading-numbering-setting-tab.ts` — 设置页 UI

## 验证证据

- 代码审查确认编号计算逻辑正确
- buildMarker `inkchapter-sidebar-restored-v1` 确认部署版本
- 无 Runtime 验证证据（截图/日志缺失）

## 已知问题

无

## 历史修复记录

- 初始 MVP 实现（`trae-inkchapter-heading-numbering-mvp`）
- 焦点丢失修复（`trae-fix-heading-numbering-focus-loss`）
- 编号布局修复（`trae-fix-heading-number-layout`）
- 标题文本焦点偏移修复（`trae-fix-heading-text-focus-shift`）
- 延迟优化（`trae-optimize-heading-numbering-latency`）
- 双 H1 格式记忆（`trae-dual-h1-format-memory`）
- H1 可见编号路径修复（`trae-fix-h1-visible-numbering-path`）
- 一级编号设置（`trae-add-level-one-heading-number-setting`）
- 修复前审计（`trae-audit-heading-numbering-and-outline-before-fix`）

## 当前唯一下一步

在 Typora 中打开 test vault 的测试文档，验证 H1-H6 编号是否正确显示、开关是否立即生效。
