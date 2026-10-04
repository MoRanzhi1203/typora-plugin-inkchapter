# 侧栏兼容

## 用户可见功能

墨章插件不修改 Typora 的原生侧栏。用户看到的是标准的 Typora 侧栏：文件、搜索、大纲三个标签页，无自定义 Ribbon 按钮。侧栏顶部分页操作保持 Typora 原生样式。

## 预期表现

- 插件加载后，Typora 侧栏保持原样
- 无自定义 Ribbon 注入（无墨章 Logo 或其他自定义按钮）
- 侧栏标签页（文件/搜索/大纲）正常切换
- 侧栏 CSS 类名与原生 Typora 一致

## 当前真实表现

基于 Runtime 证据（已验证）：

**runtime-load.json 证据**（2026-08-02）:
```json
{
  "ribbonInjected": false,
  "ribbonEnableClass": false,
  "sidebarStructure": {
    "hasInfoPanelTabWrapper": true,
    "hasInfoPanelTabFile": true,
    "hasInfoPanelTabSearch": true,
    "hasInfoPanelTabOutline": true,
    "sidebarClasses": "stopselect dropmenu sidebar-menu open active-tab-files use-file-tree-style"
  }
}
```

**core.json 证据**:
```json
{
  "showRibbon": false
}
```

**代码层面**:
- `src/main.ts` 不注入自定义 Ribbon（无 `registerRibbon` 调用）
- `src/style.scss` 不包含侧栏修改样式（803 行全部为编号和设置页样式）
- `manifest.json` 中无 `showRibbon` 或 Ribbon 相关配置

**构建标识**: `inkchapter-sidebar-restored-v1` 明确记录侧栏恢复版本

## 当前状态

已实现并验收

## 已实现内容

- 不注入自定义 Ribbon
- Typora 原生侧栏保持完整
- 侧栏标签页全部可用
- showRibbon: false 配置
- Runtime 验证证据（JSON + DOM 检查）

## 未完成内容

无

## 用户操作方式

无需任何操作——插件安装后侧栏保持 Typora 原生状态。

## 相关代码

- `src/main.ts` — 无线程注入
- `src/style.scss` — 无侧栏样式
- `src/manifest.json` — 无 Ribbon 声明
- `test/vault/.typora/core.json` — `showRibbon: false`
- `test/vault/.typora/inkchapter-runtime-load.json` — 侧栏结构证据

## 验证证据

- runtime-load.json 确认 `ribbonInjected: false`、`ribbonEnableClass: false`
- runtime-load.json 确认 sidebar 结构完整（InfoPanel 四个 tab 全部存在）
- core.json 确认 `showRibbon: false`
- style.scss 审计确认无侧栏相关样式

## 已知问题

无

## 历史修复记录

- 原生侧栏完全恢复（`trae-restore-true-native-typora-sidebar-before-community-plugin-injection`）
- 原生侧栏切换器复原（`trae-restore-original-typora-sidebar-switcher`）

## 当前唯一下一步

已完成，无需进一步操作。
