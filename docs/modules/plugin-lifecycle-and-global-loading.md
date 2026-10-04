# 模块：Plugin Lifecycle / Global Loading（插件生命周期与全局加载）

## 1. 作用与用户可见能力

- 插件随 Typora 社区框架加载，用户级（global community plugin）安装后对**任意** Markdown 路径生效，不要求文档所在目录存在本地 `.typora`。
- 负责生命周期装配、命令注册、设置注册、服务初始化与释放。
- 对外可见：设置页、命令（见下）、诊断/编号/题注/文档工具功能全部在此装配。

## 2. 当前实现状态

- 已实现：`Plugin.onload()` 装配、`onunload()` 释放、幂等 schema 迁移、全局加载审计、路径权威分层。
- `.typora/community-plugins` 为只读运行环境；本模块只读该布局常量、不写入。

## 3. Production Entry Points

| 关注点 | 生产文件 |
|---|---|
| 生命周期 / 装配 / 命令 | `src/main.ts`（`export default class extends Plugin<InkChapterSettings>`） |
| 清单 | `src/manifest.json`（`id=ranzhi.inkchapter`，`minCoreVersion=2.9.0`） |
| 路径权威 | `src/runtime/inkchapter-path-authority.ts`（`resolveInkChapterPathAuthority`、`INKCHAPTER_PLUGIN_ID`、`GLOBAL_PLUGIN_LAYOUT`） |
| Bootstrap 溯源 | `src/runtime/inkchapter-bootstrap-audit.ts`（`recordInkChapterBootstrap`） |
| 设置模型 | `src/settings/settings-model.ts`、`src/settings/default-settings.ts` |

## 4. Authority / Source of Truth

- **Install / workspace / vault / document 根**：由 `resolveInkChapterPathAuthority` 分离，绝不互相代用（硬门禁标签 `GLOBAL_LOAD_HARD_GATE_LABELS` 全部须为 0）。
- **Load mode**：由观测事实决定（`localInkChapterPluginPresent` → `test-vault`；否则 `global`）。
- **Active document presence**：`activeLeaf.state.path` 最高权威（`main.ts` `readWorkspaceActiveLeafState`）。

## 5. 核心数据结构

- `InkChapterPathAuthority` / `InkChapterDocumentContext`（`documentPath/documentDir/workspaceRoot/vaultRoot/pluginInstallRoot/pluginLoadMode`）。
- `InkChapterGlobalLoadAudit`（`pluginLoadMode`、`installRootAuthority`、`decision`）。

## 6. 主流程

```text
module evaluation → recordInkChapterBootstrap（用户级路径，最早证据）
onload():
  registerSettings + setDefault(DEFAULT_SETTINGS)
  幂等迁移：levelRange / specialNumbering / formatLibrary / caption
  resolveInkChapterPathAuthority → InkChapterDocumentContext
  initializeForensicSink
  new HeadingNumberingService / CaptionService.start() / DocumentNumberingCoordinator
  createDocumentUtilities().mount()
  DocumentViewContextMenu.attach() / TabCloseVisibilityEnhancer.attach()
  注册命令 + registerSettingTab
  写 inkchapter-runtime-load.json + emitRuntimeAudit('RUNTIME-IDENTITY-FINAL')
onunload(): 逆序 dispose 全部服务 + shutdownForensicSink()
```

## 7. 用户交互与 UI Contract

- 命令 id 与标题见 [plugin-architecture.md](../architecture/plugin-architecture.md) §5。
- 加载失败时给出 `Notice.error`，但插件主体（命令）仍注册。

## 8. Settings / Persistence

- 框架 `PluginSettings`；默认值 `DEFAULT_SETTINGS`（含 `schemaVersion`）。
- 迁移在 `main.ts` 内联且幂等。

## 9. Dynamic Refresh / Event Model

- `onWorkspaceEvent`（`active-leaf:change`、`file:open`）、`onEditorEvent`（`edit`）、`tab:toggle`（经 `subscribeActiveTabsTabToggle` 重新挂载到当前 tabs 节点）。
- 全部通过 `this.register(dispose)` 保证释放。

## 10. Runtime Audit / Debug Evidence

- `INKCHAPTER-GLOBAL-LOAD-AUDIT`（`buildInkChapterGlobalLoadAudit`）。
- `RUNTIME-IDENTITY-FINAL`；`<vault>/.typora/inkchapter-runtime-load.json`；forensic log sink。
- 详见 [runtime-audit-and-identity.md](runtime-audit-and-identity.md)。

## 11. Tests / Fixtures

- `src/runtime/inkchapter-path-authority.test.ts`、`inkchapter-bootstrap-audit.test.ts`、`inkchapter-plugin-constructor-phase6.test.ts`、`document-runtime-context.test.ts`。

## 12. Build / Deployment 相关约束

- 全局安装根遵循框架标准布局 `.typora/community-plugins/plugins/<id>`；不得硬编码用户/项目绝对路径，不得用 per-folder 拷贝/符号链接模拟全局模式。

## 13. 已知限制与 Deferred Work

- 真实"关闭最后标签→应用内空 leaf"观测受环境阻塞（见 [../roadmap/known-gaps-and-deferred-work.md](../roadmap/known-gaps-and-deferred-work.md)）。

## 14. 历史设计决策

- 早期以单一 `vaultRoot` 推断所有根，导致用户级插件在无本地 `.typora` 的文档中误判；现拆分为分层路径权威，`vaultRoot` 允许为 null。
