# 编号预设

## 用户可见功能

用户在设置页看到九个预设卡片，点击即可一键切换标题编号样式。所有标题立即更新为新格式。预设样式预定义了 H1-H6 各级别的编号风格，无需逐级配置。

九个系统预设：
1. 十进制层级（decimal-hierarchical）
2. 中文章节（chinese-chapter）
3. 党政公文四级（chinese-outline）
4. 学术论文（academic-paper）
5. 章—节—条款（chapter-section-clause）
6. 附录层级（appendix-hierarchical）
7. 全罗马层级（roman-hierarchical）
8. 罗马混合层级（roman-mixed）
9. 字母混合层级（letter-mixed）

## 预期表现

- 九个预设卡片显示预览效果
- 点击卡片立即切换编号样式
- 也可通过下拉选择器切换
- 预设切换到「自定义」后保留预设级别的格式定义
- 切换预设后文档和预览同时更新

## 当前真实表现

基于代码分析（未 Runtime 验证）：

**十进制层级（decimal-hierarchical）**:
- H1: `1`、H2: `1.1`、H3: `1.1.1`，以此类推
- 使用 `arabic` token，`.` 分隔符

**中文章节（chinese-chapter）**:
- H1: `第一章`、H2: `第一节`、H3: `一、`、H4: `（一）`、H5: `1.`、H6: `（1）`
- 使用 `chinese` token

**中文大纲（chinese-outline）**:
- H1: `一、`、H2: `（一）`、H3: `1.`、H4: `（1）`、H5: `①`、H6: `A.`

**罗马数字（roman-hierarchical）**:
- H1: `I`、H2: `II`、H3: `III`、H4: `IV`、H5: `V`、H6: `VI`
- 代码已修复：token style 从 `arabic` 改为 `roman-upper`
- 但预览描述与代码不一致（预览显示 `I.1.1` 层级形式，代码生成的是独立罗马数字）

在 `resolveEffectiveSettings()` 中，非 custom 预设始终从 `getPresetLevels()` 重新生成级别定义，确保预设修复立即生效而无需用户重新保存设置。

## 当前状态

已实现但未验收

## 已实现内容

- 四种预设样式定义（`presets.ts`）
- 预设卡片 UI（设置页 `render()` 中的 `PRESET_CARDS`）
- 下拉选择器同步
- 预设切换即时应用到文档（`handlePresetSelect`）
- 动态级别重新生成（`resolveEffectiveSettings` 中非 custom 预设始终重新生成）
- 预览数据生成（`getPresetPreview`）

## 未完成内容

- Roman 预设的 Runtime 真实验证（token style 修复后是否生效）
- Roman 预设的预览行为与代码定义不完全一致
- 所有预设缺少 Runtime 验证证据

## 用户操作方式

1. 打开插件设置页
2. 点击预设卡片（十进制层级/中文章节/中文大纲/罗马数字）
3. 观察文档标题编号立即变化
4. 或使用下拉选择器切换预设

## 相关代码

- `src/heading-numbering/presets.ts` — 预设定义（`PRESETS` 对象）
- `src/heading-numbering/heading-types.ts` — `HeadingNumberingPreset` 类型
- `src/settings/heading-numbering-setting-tab.ts` — 预设卡片 UI、`handlePresetSelect`
- `src/heading-numbering/heading-numbering-scope-store.ts` — `resolveEffectiveSettings` 预设重新生成

## 验证证据

- 代码审查确认四种预设定义正确
- token-formatter.ts 支持 13 种数字风格
- 无 Runtime 验证证据

## 已知问题

- Roman 预设的 `preset.preview` 显示 `{1: 'I', 2: 'II', ...}`（独立罗马数字），但预览描述写的是 `'I.1.1'`（层级形式）
- Roman token style 修复已写入代码但未经 Typora 实际验证

## 历史修复记录

- 添加自定义编号样式（`trae-add-custom-heading-numbering-styles`）
- Roman/Decimal 预设修复（`trae-fix-roman-decimal-heading-presets`）
- 移除法规编号格式（`trae-remove-legal-style-option`）
- 内置预设 Runtime 应用修复（`trae-fix-built-in-presets-runtime-application`）
- Roman 预设与 Custom 格式修复（`trae-fix-roman-preset-and-custom-multilevel-format`）
- Roman 与 Custom 格式终版（`trae-optimize-roman-and-custom-format-final-fix`）

## 当前唯一下一步

在 Typora 中逐一验证四种预设的 Runtime 表现，特别是 Roman 预设的 token style 修复。
## 2026-08-19 Cleanup 吸收

- `trae-object-numbering-preset-ui-v2.md`
- `trae-object-numbering-preset-ui-simplification-v2.2.md`
- `trae-object-numbering-preset-ui-runtime-authority-v2.1.md`

这组 legacy object-numbering preset prompt 的结论已沉入本页的 preset 架构与渲染规则，不再保留独立 prompt 文档。
