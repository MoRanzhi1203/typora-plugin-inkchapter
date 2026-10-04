# 标题编号范围

## 用户可见功能

用户可以限制标题编号的作用范围——例如只对 H1-H3 进行编号，H4-H6 不编号。支持全局限制（适用于所有文档）和文档级覆盖（仅当前文档）。

## 预期表现

- 全局最大级别默认为 6（全部级别生效）
- 用户可设置全局最大级别（如 3），则 H4-H6 不编号
- 单个文档可覆盖为不同值
- 超出范围的标题创建被阻止（Enter 创建新标题时）
- Typora 原生快捷键（Ctrl+4）创建的超出范围标题被自动恢复为纯文本
- 粘贴内容中的超出范围 ATX 标题被自动转换
- 设置页有「确定」和「取消」按钮保护配置修改

## 当前真实表现

基于代码分析（未 Runtime 验证）：

**强制执行引擎**（`heading-level-range-enforcer.ts`）:
- `canCreateHeading(requestedLevel, effectiveMaxLevel)`: 权限检查
- `preserveBlockedAtxHeadingAsText()`: 将超范围标题的 `#` 转义为 `\#`
- Post-hoc 修正: 监听 DOM 变更，检测并恢复原生快捷键创建的超范围标题
- Paste 拦截: 粘贴后检测超范围 ATX 行并转换为纯文本
- 降级拦截: 阻止标题降级超过最大级别
- 用户提示: 阻止操作时显示友好通知

**设置页 UI**:
- `renderLevelRangeSection()` 渲染级数范围设置区
- Range Draft 状态（`rangeDraft`）：全局/文档独立 draft
- Dirty 标记：修改后才能启用「确定」按钮
- 全局级数选择器（1-6）
- 文档模式切换（inherit/custom）
- 文档级数选择器（仅在 custom 模式生效）

**编号计算集成**:
- `computeHeadingNumbering()` 中的 `h.level <= settings.maxDepth` 过滤

## 当前状态

已实现但未验收

## 已实现内容

- 全局最大级别配置（1-6）
- 文档级覆盖（inherit/custom 模式）
- 标题创建权限检查
- 超范围标题自动恢复（转义 # 为纯文本）
- Paste 拦截转换
- 降级阻止
- 友好用户通知
- 设置页确定/取消按钮保护
- Draft 状态管理

## 未完成内容

- Runtime 验证（确认 Ctrl+4 创建 H4 在 maxLevel=3 时被阻止）
- 粘贴场景的边界测试
- 文档覆盖与全局限制的交互验证

## 用户操作方式

1. 打开设置页 → 标题有效级数范围
2. 修改全局最大级别（如 3）
3. 点击「确定」保存
4. 新建文档尝试创建 H4 — 应被阻止
5. 使用 Ctrl+4 快捷键 — 标题被恢复为纯文本
6. 文档级覆盖：切换到「当前文档」，选择 custom 模式，设置不同级数

## 相关代码

- `src/heading-numbering/heading-level-range-enforcer.ts` — 强制执行引擎
- `src/heading-numbering/level-range-utils.ts` — 级数范围工具函数
- `src/heading-numbering/heading-types.ts` — `MaxHeadingLevel`、`HeadingLevelRangeSettings`
- `src/settings/heading-numbering-setting-tab.ts` — `renderLevelRangeSection`、`rangeDraft`
- `src/heading-numbering/heading-numbering-service.ts` — enforcer 集成
- `src/settings/default-settings.ts` — `levelRange` 默认值

## 验证证据

- 代码审查确认强制执行逻辑完整
- 对应已执行提示词（`trae-enforce-heading-level-range-and-preserve-hashes`）
- superseded 版本（`trae-heading-level-range-global-and-document`）
- 确认/取消按钮已实现（`trae-add-confirm-cancel-to-heading-range-settings`）
- 无 Runtime 验证证据

## 已知问题

无

## 历史修复记录

- 强制执行实现（`trae-enforce-heading-level-range-and-preserve-hashes`）
- 确认/取消按钮（`trae-add-confirm-cancel-to-heading-range-settings`）
- 全局+文档覆盖（`trae-heading-level-range-global-and-document`，已废弃）

## 当前唯一下一步

使用测试模板「08-标题有效级数限制测试.md」在 Typora 中验证级数限制功能。
