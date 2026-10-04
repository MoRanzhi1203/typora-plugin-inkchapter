# 设置页 UI

## Settings Workbench（Phase 2-C，2026-08+）

> 本节是当前设置页（标题编号页签）的权威结构描述。**视觉规范见 [UI 视觉体系文档](ui-visual-system.md)。** 下方自「用户可见功能」起的各节为 Phase 2-C 落地前（Phase ≤2-B）的历史快照，不代表当前行为。

### 目标结构：Workbench Shell + Compact Summary + 4 Tabs

设置页已从“超长单页纵向堆叠”重构为 **Settings Workbench Shell**（单实例，4 个 panel 共享同一个 sticky Bottom Action Bar）：

```text
标题编号
样式 · 来源：全局默认 / 当前文档 · 标题编号：已启用/关闭     ← Compact Summary（单行紧凑）
────────────────────────────────────────────
编号方案   标题格式   文档规则   图表对象                    ← 4 Tabs（文本式，非大按钮）
────────────────────────────────────────────
schemePanel   = 作用域 + 启用标题编号 + 编号格式库 / 格式库管理
headingPanel  = H1-H6 自定义格式编辑器 + 实时预览（Custom Editor）
rulesPanel    = 标题有效级数 + 标题结构 + 正文排版等文档级规则
objectsPanel  = 图 / 表 / 代码 / 公式 Caption 设置
────────────────────────────────────────────
当前作用域 …                      [取消更改] [保存并应用]      ← 单实例 sticky Bottom Action Bar
```

- **Compact Summary**：单行紧凑，字段 = 当前样式 · 来源（全局默认/当前文档）· 标题编号启用状态（示例形态：`论文.md · 样式1 · 来源：全局默认 · 已启用`；文件名可作首字段，实现以当前落盘字段为准），替代旧的大留白状态块；无大 Card、无大阴影。
- **4 个固定 Tab**：编号方案 / 标题格式 / 文档规则 / 图表对象，runtime key = `scheme | heading | rules | objects`；**固定 4 个，不再新增第五个 tab**。
- **Tab 视觉**：类 Typora 原生 tab——active = 字重略增 + 底边线，hover 轻微，非蓝色大按钮 / 非 Pill / 非 Card；窄窗下 tabs 单行紧凑、必要时 `overflow-x:auto`；不以 `window.innerWidth` 为唯一响应式依据（基于 settings 容器宽度）。

### 核心机制（工程约束）

- **activeWorkbenchTab 是纯 UI runtime state**：不持久化、不进 config / schema / document / global / local config；重新打开设置页默认回到 `scheme`；同一打开周期内 rerender 与 scope 切换均保持当前 tab。
- **Tab 点击禁止 rerender**：只执行 `activateWorkbenchTab(tab)`——切换 panel 显隐 + active class + `aria-selected`（`role=tab/tablist/tabpanel`）；避免重复执行格式库初始化、重复 listener、输入草稿/预览重建、DOM churn、滚动跳动与闪烁。业务设置触发的原有 rerender 后，按 `activeWorkbenchTab` 恢复当前 panel；scope 切换保持 tab。
- **全部既有 renderer 必须继续执行**（保留 DOM 构造与必要初始化/副作用）：`renderScopeCard` / `renderFormatLibraryCard` / `renderCustomEditorCard` / `renderAdvancedSettingsCard` / `renderCaptionCard`；用 `renderIntoWorkbenchPanel(panel, renderFn)` 差集捕获 renderer 新增的 container **直属 child** 移入对应 panel；禁止移动 body portal / menu layer / modal / tooltip / context menu 等非直属宿主节点。
- **文档规则 Tab（Current Document）三态切换**：继承全局默认（INHERIT）/ 严格模式（STRICT）/ 宽松模式（LOOSE）——读取当前 effective mode、选择写入 **document scope（不写 global；恢复“继承”即清除文档覆盖）**；global 作用域仍为严格/宽松两态。以上仅移排、**不改语义**：保留既有 scope / config key / 默认值 / 继承逻辑。
- **保存语义区分（仅记录不实现）**：“保存样式（preset/style）”“应用设置（作用到当前文档或全局默认）”“取消更改（丢弃未应用草稿）”语义不同、分属不同语境；正文保存语义重构属 Phase 2-D，本阶段只保留单实例 sticky bottom bar 与既有逻辑，不实现。

### 相关代码

- `src/settings/heading-numbering-setting-tab.ts`：Workbench Shell 与既有 renderer（`activeWorkbenchTab` / `WORKBENCH_TABS` / `renderWorkbenchShell` / `renderIntoWorkbenchPanel` / `activateWorkbenchTab` / `syncWorkbenchTabUI` / `render`）。
- `src/style.scss`：`.inkchapter-wb-summary / -tabs / -tab / -panel`（active 下划线、panel 扁平去 shadow）与 `--ink-ui-*` token。

### 状态

```text
PHASE_2C_SETTINGS_WORKBENCH=ENGINEERING_PASS
SETTINGS_IA=ENGINEERING_PASS
SETTINGS_LAYOUT_VISUAL=PENDING_USER_MANUAL_CHECK    （人工视觉验收待执行/待截图，不得写 PASS）
UI_PHASE_2D=BLOCKED_BY_PHASE_2C_VISUAL_ACCEPTANCE
```

- 正文保存语义、双栏标题格式编辑器（2-D）、对象矩阵（2-E）、Typora 主题跟随（2-G）等**均未开始**。
- 真实 Typora 人工视觉验收尚未执行，验收矩阵见 [UI 视觉体系文档](ui-visual-system.md) §9。

---

> ⚠️ 历史快照说明：以下自「## 用户可见功能」起的各节为 **Phase ≤2-B（Settings Workbench 落地前）** 的记录；其中“当前状态 / 已知缺陷 / 已实现 UI 组件”等旧结论不代表 Phase 2-C 之后的当前行为，当前状态以本节为准。

## 用户可见功能

用户在 Typora 偏好设置 → 插件 → 墨章 InkChapter 中看到「标题编号」设置标签页，包含：
- **作用域选择栏**: 全局默认 / 当前文档切换
- **基础设置**: 启用编号开关、H1 可见性开关
- **预设卡片**: 4 个预设卡片（点击高亮选中）
- **预设下拉**: 备用的下拉选择器
- **级数范围**: 全局最大级别 + 文档覆盖
- **实时预览**: 当前配置的编号预览
- **Custom 面板**: 对每个 H1-H6 级别的格式编辑（可折叠）

## 预期表现

- 设置页所有控件交互流畅、实时响应
- 预设卡片点击后立即高亮选中
- Custom 面板展开后编辑区完整显示
- 拖拽操作顺滑（无卡死、不消失）
- 预览实时更新（无一致性问题）

## 当前真实表现

基于代码分析（存在缺陷，未 Runtime 验证）：

**已实现的 UI 组件**:
- `renderScopeBar()`: 作用域选择标签
- `renderLevelRangeSection()`: 级数范围设置区（含 Draft 状态和确定/取消）
- `renderCustomPanels()`: Custom H1-H6 可折叠面板（含格式编辑区和迷你预览）
- 拖拽基础设施：`DragState` 状态管理、拖拽阈值（`DRAG_THRESHOLD = 4`）、ghost 元素、指示器元素
- `updatePreview()`: 全局实时预览
- 13 种 Token 风格选择器（下拉列表）

**已知缺陷**（源于 Custom 编辑器问题）:
- Custom 面板打开时拖拽栏可能为空
- 预览与实际编号不一致
- 拖拽操作在复杂场景可能卡死

**设置页生命周期**:
- `onshow()`: 初始化 draft、订阅外部变更、render
- `onhide()`: 取消拖拽、取消订阅
- Draft 系统：修改暂存在内存中，非实时持久化
- `syncFromExternalChange()`: 外部 F1 命令变化时刷新 UI

## 当前状态

（2026-08+ Settings Workbench 更新，见文首权威节）

- 工程状态：`PHASE_2C_SETTINGS_WORKBENCH=ENGINEERING_PASS`、`SETTINGS_IA=ENGINEERING_PASS`（代码已提交至 git HEAD `37c14f3`）。
- 视觉状态：`SETTINGS_LAYOUT_VISUAL=PENDING_USER_MANUAL_CHECK`——设置页 Workbench / Compact Summary / 4 Tab / Bottom Bar 的**人工视觉验收待执行/待截图**；工程完成 ≠ 视觉 PASS。
- 本节下文“存在缺陷 / 超长单页”等旧结论针对 Phase 2-C 之前的单页长表单；Workbench 已按 4-Tab 收敛。历史缺陷（拖拽栏空、预览不一致、卡死等）是否在 Workbench 各 panel 中复现，需人工复核，见下方历史清单。

## 已实现内容

- 作用域切换标签（全局/当前文档）
- 启用编号开关
- H1 可见性开关
- 4 个预设卡片（含选中高亮和预览）
- 预设下拉选择器（与卡片同步）
- 级数范围设置区（draft + 确定/取消）
- 全局实时预览区
- Custom 面板框架（H1-H6 折叠）
- Token 风格选择器（13 种）
- 拖拽基础设施
- 外部变更订阅（F1 命令同步）

## 未完成内容

- Custom 编辑器缺陷修复（空拖拽栏、缺失当前段、预览不一致）
- 拖拽稳定性增强
- 设置页错误恢复（已有的 error fallback）

## 用户操作方式

1. **文件 → 偏好设置 → 插件 → 墨章 InkChapter**
2. 在「标题编号」标签页中配置所有设置
3. 点击预设卡片快速切换编号样式
4. 选择「自定义」展开逐级设置面板

## 相关代码

- `src/settings/heading-numbering-setting-tab.ts` — 设置页完整 UI（500+ 行）
- `src/heading-numbering/format-drag-utils.ts` — 拖拽工具函数
- `src/settings/default-settings.ts` — 默认设置
- `src/settings/settings-model.ts` — 设置数据模型
- `src/style.scss` — 全部 UI 样式（803 行）

## 验证证据

- 代码审查确认 UI 组件架构完整
- 部分已执行提示词确认拖拽功能（`trae-stable-format-segment-drag`）
- 无 Runtime 验证证据

## 已知问题

当前（Phase 2-C 后）：
1. `SETTINGS_LAYOUT_VISUAL=PENDING_USER_MANUAL_CHECK`：Settings Workbench / Compact Summary / 4 Tab / sticky Bottom Bar 未做真实 Typora 人工视觉验收（无截图），未验收前不得视为视觉 PASS。
2. 文档规则等各 Tab 与 Typora 原生 tab 的一致性、窄窗 tabs 溢出行为待人工复核（规范见 [UI 视觉体系文档](ui-visual-system.md)）。
3. 早期 Custom 编辑器缺陷（下方历史清单）是否在 Workbench「标题格式」面板中仍复现，需人工复核。

历史（Phase ≤2-B 遗留，供复核参考）：
1. Custom 拖拽栏空（`ensureCurrentLevelSegment` 逻辑不完整）
2. 预览不一致（使用独立渲染路径而非实际编号计算）
3. 复杂拖拽可能卡死（`trae-fix-format-tag-drag-freeze`）

## 历史修复记录

- 预设预览 UI 优化（`trae-optimize-heading-preset-preview-ui`）
- 拖拽替换工具栏（`trae-replace-format-move-toolbar-with-drag-sort`）
- 稳定格式拖拽（`trae-stable-format-segment-drag`）
- 拖拽卡死修复（`trae-fix-format-tag-drag-freeze`）
- 前向拖拽修复（`trae-fix-format-tag-forward-drag`）
- 拖拽不启动修复（`trae-fix-format-tag-drag-not-starting`）
- H1 与 Custom 同步（`trae-sync-global-h1-toggle-with-custom-panel`）
- Custom 级别列加宽（`trae-widen-custom-level-column`）

## 当前唯一下一步

在真实 Typora 中打开设置页，对 **Settings Workbench** 做人工视觉验收（`SETTINGS_LAYOUT_VISUAL=PENDING_USER_MANUAL_CHECK`）：Compact Summary、4 Tab 切换（无闪烁 / 无重复 DOM / 无输入丢失）、各 panel 内容完整（标题格式含 H1-H6 与实时预览）、窄窗 tabs 行为、dark/light 主题；并复核历史 Custom 编辑器缺陷是否在「标题格式」面板中复现。验收项见 [UI 视觉体系文档](ui-visual-system.md)。

## 2026-08-19 Cleanup 吸收

- `trae-object-numbering-v2-settings-ui-p0-closure.md`
- `trae-object-numbering-preset-ui-v2.md`
- `trae-object-numbering-preset-ui-simplification-v2.2.md`
- `trae-object-numbering-preset-ui-runtime-authority-v2.1.md`
- `trae-object-caption-runtime-not-working-fix.md`

上述 legacy prompt 的 UI 结论已并入设置页、预设卡片与题注入口，不再保留独立 prompt 文档。
