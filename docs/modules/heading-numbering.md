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

R08 / R09 已实现并在真实 Typora 缓冲区完成运行时验收。

## 已实现内容

- H1–H6 自动编号、五种以上预设、自定义多级组合格式、文档级覆盖与局部编号覆盖。
- 三种存储模式：
  - **渲染层编号**：只显示，不写 Markdown；
  - **源码持久化**：编号写入标题文本，正文/大纲不再叠加投影；
  - **导出时固化**：编辑不改原文，导出 `*.numbered.md` 副本。
- 已有编号识别（十进制 / 中文章节 / 中文大纲 / 罗马 / 字母 / 自定义）与四种处理策略（接管 / 移除重排 / 保留不叠加 / 只检测）。
- 编号归属台账（墨章写入 / 接管 / 用户保留 / 未确认 / 不参与），按稳定结构身份存储，不依赖标题文本中的数字。
- 同步时机：手动 / 编辑后（仅标题结构变化触发，400ms 防抖）/ 保存时；写入走同一条撤销命令栈。
- 中央检测面板的六条编号诊断：双重编号、编号不一致、编号缺失、编号错序、格式冲突、归属冲突；每条带 `Lxx`、可定位、可单项 / 同类 / 一键修复。
- 编号管理卡片：模式、策略、同步时机、已接管数量、冲突数量与源码预览。
- 图表 / 公式章节前缀统一接口；导出时表格题注在上、图片题注在下、代码题注在围栏外、公式只输出 `\tag{}`。

## 运行时验收

```powershell
pnpm run build
powershell -ExecutionPolicy Bypass -File scripts/deploy-test-vault.ps1
pnpm run accept:numbering
```

验收覆盖：源码写入、第二次同步零改动、正文与大纲投影去重、中央诊断出现与消失、撤销 / 重做、移除墨章编号、夹具还原。

## 相关代码

- `src/main.ts` — 服务初始化、六条编号命令、运行时验收驱动
- `src/heading-numbering/numbering-engine.ts` — 唯一编号计算权威
- `src/heading-numbering/heading-number-persistence.ts` — 持久化规划器（模式 / 策略 / 归属 / 幂等）
- `src/heading-numbering/heading-number-source-scanner.ts` — 已有编号识别
- `src/heading-numbering/numbering-persistence-service.ts` — 运行时同步、导出、移除
- `src/heading-numbering/heading-number-projection-suppression.ts` — 正文/大纲投影去重
- `src/document-utilities/document-diagnostics-heading-number-v1.ts` — 中央诊断事实
- `src/document-utilities/document-diagnostic-heading-number-fix-v2.ts` — 编号专项修复
- `src/settings/numbering-management-card.ts` — 编号管理卡片

## 验证证据

- `pnpm run typecheck`、生产构建、`docs:verify` 通过。
- Vitest：编号持久化 / 扫描 / 冲突 / 修复 / 性能 / 大纲去重等专项用例全部通过。
- 真实 Typora Runtime：`verdict=PASS`，报告位于 `test/vault/runtime/acceptance/numbering-acceptance-last-run.json`。

## 历史修复记录

- 初始 MVP 实现（`trae-inkchapter-heading-numbering-mvp`）
- 焦点丢失修复（`trae-fix-heading-numbering-focus-loss`）
- 编号布局修复（`trae-fix-heading-number-layout`）
- 标题文本焦点偏移修复（`trae-fix-heading-text-focus-shift`）
- 延迟优化（`trae-optimize-heading-numbering-latency`）
- 双 H1 格式记忆（`trae-dual-h1-format-memory`）
- H1 可见编号路径修复（`trae-fix-h1-visible-numbering-path`）
- 一级编号设置（`trae-add-level-one-heading-number-setting`）
- R08 编号持久化（`5dea357`）
- R09 中央诊断接入、专项修复与大纲验收
