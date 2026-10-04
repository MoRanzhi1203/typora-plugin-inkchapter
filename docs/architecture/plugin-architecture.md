# 插件架构（Plugin Architecture）

> 本文件描述墨章 InkChapter 的**当前真实**分层、模块边界、生产入口与依赖关系。
> 所有结论均来自当前 `src/**` 源码、`package.json`、`src/manifest.json` 与测试；不从历史提示词推断。

## 1. 运行形态

- 类型：Typora 社区插件（user-level / global community plugin）。
- 框架：`@typora-community-plugin/core` `^2.7.7`（`package.json` devDependencies）。
- 清单：`src/manifest.json`
  - `id = ranzhi.inkchapter`
  - `version = 0.1.0-alpha.1`
  - `minAppVersion = 1.6.0`，`minCoreVersion = 2.9.0`
  - `platforms = ["win32"]`
- 打包入口：`src/main.ts`（`export default class extends Plugin<InkChapterSettings>`）。

## 2. 分层与职责

| 层 | 目录 | 职责 |
|---|---|---|
| 生命周期 / 装配 | `src/main.ts` | 仅负责 `onload`/`onunload`、命令注册、服务初始化与依赖装配 |
| 编号 / 题注 / 公式 / 排版 | `src/heading-numbering/**` | 标题编号引擎、题注系统、公式投影、段落/标题排版、大纲编号 |
| 文档工具（诊断/锁定/导航） | `src/document-utilities/**` | Authoring-shell 诊断、定位、Drawer、编辑锁定、滚动导航、空白警告呈现 |
| Typora/DOM 适配 | `src/infrastructure/**` | `heading-dom-adapter.ts`、`typora-adapter.ts`：集中隔离 Typora API 与 DOM 访问 |
| 运行时审计 / 路径权威 | `src/runtime/**` | 加载审计、路径权威、forensic 日志 sink、bootstrap 溯源 |
| 设置 | `src/settings/**` | `settings-model.ts`、`default-settings.ts`、`heading-numbering-setting-tab.ts` |
| 通用 | `src/core/logger.ts`、`src/utils/**` | 日志与工具 |
| 样式 | `src/style.scss` | 唯一样式源（构建期编译为 `style.css`） |

## 3. 生产入口点（Production Entry Points）

`src/main.ts` 装配并持有以下服务（均可释放）：

| 服务 | 生产文件 | 装配位置 | 释放 |
|---|---|---|---|
| `HeadingNumberingService` | `src/heading-numbering/heading-numbering-service.ts` | `main.ts` `onload`（`new HeadingNumberingService(ctx, adapter)`） | `onunload` → `dispose()` |
| `HeadingDomAdapter` | `src/infrastructure/heading-dom-adapter.ts` | 注入 `HeadingNumberingService` | 随服务 |
| `CaptionService` | `src/heading-numbering/caption-service.ts` | `main.ts` `captionService.start()` | `onunload` → `dispose()` |
| `DocumentNumberingCoordinator` | `src/heading-numbering/document-numbering-coordinator.ts` | `main.ts`，把 heading snapshot 生命周期接到 caption 重算 | `register(() => dispose())` |
| `CaptionContextMenu` | `src/heading-numbering/caption-context-menu.ts` | `main.ts` `attach()` | `onunload` → `dispose()` |
| `DocumentUtilities` | `src/document-utilities/document-utilities.ts`（工厂 `createDocumentUtilities`） | `main.ts` `mount()` | `onunload` → `dispose()` |
| `DocumentViewContextMenu` | `src/document-utilities/document-view-context-menu.ts` | `main.ts` `attach()` | `register` + `onunload` |
| `TabCloseVisibilityEnhancer` | `src/document-utilities/document-utility-tab-close-visibility.ts` | `main.ts` `attach()` | `register` + `onunload` |
| Settings Tab | `src/settings/heading-numbering-setting-tab.ts` | `registerSettingTab(...)` | 随插件 |

## 4. 依赖方向

```text
main.ts
  ├─ infrastructure/heading-dom-adapter.ts (DOM 适配)
  ├─ heading-numbering/*        (业务：编号 / 题注 / 公式 / 排版 / 大纲)
  ├─ document-utilities/*       (呈现与只读诊断，挂载在 #write 之外)
  ├─ runtime/*                  (审计 + 路径权威 + 日志 sink)
  ├─ settings/*                 (设置模型 + 设置页)
  └─ style.scss

document-utilities 只发布 document 域诊断；runtime 域由 runtime/* 独立承载，
二者经 src/document-utilities/diagnostic-domain-v1.ts 分离（见
docs/diagnostics/DOCUMENT-DIAGNOSTICS-VNEXT-GAP-LEDGER.md §1）。
```

## 5. 命令注册（`main.ts`）

标题编号：`inkchapter.heading.toggle` / `.renumber` / `.toggle-structure-mode`（及 `@deprecated` 的 `.toggle-level-one`）。
标题覆盖：`inkchapter.heading.unnumber-current` / `.number-current` / `.inherit-current` / `.batch-unnumber-from-here` / `.batch-number-from-here` / `.unnumber-subtree` / `.restore-subtree` / `.clear-overrides`。
段落缩进（诊断）：`inkchapter.paragraph.force-indent-current` / `.force-flush-current` / `.auto-indent-current`。
大纲：`inkchapter.outline.probe` / `.dump-dom` / `.sync`。
运行时审计：`inkchapter.audit.copy` / `.clear` / `.snapshot`；状态：`inkchapter.check-status`。

## 6. 设置持久化

- 使用框架 `PluginSettings`（`main.ts` 内 `registerSettings`），默认值来自 `src/settings/default-settings.ts`（含 `schemaVersion`）。
- `main.ts` 内执行幂等的内联 schema 迁移：`levelRange`、`specialNumbering`、`formatLibrary`、`caption`。
- 分层作用域模型见 [ADR-005](../decisions/ADR-005-document-global-effective-settings.md)；文档级键由 `generateDocumentKey()`（`src/heading-numbering/heading-numbering-scope-store.ts`）按 vault 相对路径派生。

## 7. 全局加载与路径权威

- `src/runtime/inkchapter-path-authority.ts` 拆分 install / workspace / vault / document 根，绝不硬编码用户路径；`resolveInkChapterPathAuthority` 产出 `pluginLoadMode = 'global' | 'test-vault' | 'unknown'` 与硬门禁标签 `GLOBAL_LOAD_HARD_GATE_LABELS`。
- 用户级全局插件对任意 Markdown 路径都应加载（不依赖本地 `.typora`）；`main.ts` 在模块求值期即调用 `recordInkChapterBootstrap(...)`。
- 详见 [operations/build-and-deploy.md](../operations/build-and-deploy.md) 与 [modules/plugin-lifecycle-and-global-loading.md](../modules/plugin-lifecycle-and-global-loading.md)。

## 8. 构建与测试

- 构建：`build.js` 是唯一构建 authority（esbuild；`node build.js`=dev，`node build.js --prod`=生产），样式经 `esbuild-sass-plugin` 编译；dev 模式调用 `installDevPlugin()` 并重启 Typora。
- 打包：`pack.js`（`pnpm run pack`）。
- 类型：`tsconfig.json`（严格）；测试：`vitest`（`vitest.config.ts`，`pnpm test`）。
- 部署/校验脚本：`scripts/deploy-test-vault.ps1`、`scripts/restart-typora-test-vault.ps1`、`scripts/verify-typora-runtime.ps1`、`scripts/verify-typora-startup.ps1`。

## 9. 相关文档

- 身份与呈现权威：[identity-presentation-authorities.md](identity-presentation-authorities.md)
- 架构决策：[../decisions/](../decisions/)（ADR-001..005）
- 模块说明：[../modules/](../modules/)
- 运维：[../operations/](../operations/)
