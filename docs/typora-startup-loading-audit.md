# Typora 启动与墨章全局加载审计

审计时间：2026-11-01　目标：`D:\TyporaPluginProjects\typora-plugin-inkchapter`
Typora：`D:\Typora\Typora.exe` 1.6.7（SHA-256 前 16 位 `36EB51EF39D25566`）
证据目录：`runtime/startup-audit/`（实验 JSON、启动脚本、备份）

## 1. 结论摘要

| 问题 | 状态 | 结论 |
| --- | --- | --- |
| P0-1 自动化启动后异常退出 | **已定位，已修复（构建侧）** | 不是 Typora 崩溃，也不是 InkChapter 渲染问题。vault 模式加载的是**开发版 core**，它在启动时无条件 `devtools()`：既自动打开 DevTools，又写入并 watch `_lock/win-test`，任何对该文件的删除/重写都会调用 `window.close`。`build.js` 的 `closeTypora()` 删除的正是这个文件，因此「dev 构建 + 启动」会互相踩，表现为启动后 10–60 秒退出。 |
| P0-2 仅 test/vault 能加载墨章 | **根因范围已缩小，未完成修复** | 全局安装、启用清单、`window.html` 注入、符号链接、全局插件版本均已排除。实验证明：普通目录文档启动后**全局插件回执不刷新**，且 `.typora/plugins.json`、绝对 `PLUGIN_CORE_PATH`、全局构建升级都无法改变。最可能的原因是普通文档窗口缺少 `_options`（实测其 renderer 无 `--tyopt` 参数），全局 `loader.js` 在首行访问 `_options` 即中断。兼容补丁已写好但**未通过验证**，故未作为最终修复提交。 |

## 2. 加载架构（实测链路）

```
Typora 1.6.7
 └ resources/window.html（已注入 loader，2026-07-20）
    └ <script src="typora://app/userData/plugins/loader.js" type="module">
       └ %APPDATA%\Typora\plugins  ──符号链接──▶ C:\Users\MSIPC\.typora\community-plugins
          ├ loader.json  {"coreVersion":"2.9.13","debug":false}
          ├ plugins.json {"ranzhi.inkchapter": true}
          ├ 2.9.13/core.js（生产 core，无 devtools/locker）
          └ plugins/ranzhi.inkchapter/{main.js,style.css,manifest.json}
```

loader 读取 `<mountFolder>/.typora/env.json` 决定 core 与插件目录：

- **vault 文档**：`test/vault/.typora/env.json` 把 `PLUGIN_CORE_PATH` 指向项目内**开发 core**
  `node_modules/@typora-community-plugin/core/dist/core.js`；插件从 `test/vault/.typora/plugins` 加载。
- **普通文档**：无 env.json → 生产 core 2.9.13（不开 DevTools）；插件目录应为全局目录。

core 侧（生产版 `2.9.13/core.js`）：

```js
loadFromVault() {
  globalPluginsDir = env.PLUGIN_GLOBAL_DIR || join(globalRootDir(), "plugins")
  vaultPluginsDir  = join(config.configDir, "plugins")
  enabledPlugins   = config.readConfigJson("plugins")
  ... loadManifests(); loadPlugins()
}
loadPlugins() { ...filter(id => enabledPlugins[id]).map(enablePlugin) }
```

配置目录选择：`access(vault.configDir)` 成功 → 用 vault 配置，否则用全局配置。

## 3. P0-1：退出链路（证据确认）

开发 core 文件末尾：

```js
// node_modules/@typora-community-plugin/core/dist/core.js  L13348-L13353
if (true) { const { devtools: devtools2 } = ...; devtools2() }
```

`devtools()`（同文件 L13170-L13202）：

```js
ClientCommand.toggleDevTools();                 // 每次加载即打开 DevTools
if (File.isNode) createLocker();
// createLocker: writeText(_lock/win-test) 后 fs.watch，事件 rename → JSBridge.invoke("window.close")
```

`build.js`（修改前 L66-L74）在 Typora 未运行时调用 `closeTypora()`，其实现即删除
`node_modules/@typora-community-plugin/core/dist/_lock/win-test` —— 与上述 watcher 直接冲突。

**关键澄清**：`[blur]`、`[focus] 2` 只是关窗前的正常焦点日志，不是根因；把 `--tyopt`
里的 `debug:true` 当作根因也不成立（`conf.user.json` 无 debug 项，DevTools 来自开发 core）。

### 修复

[build.js](../build.js#L66-L78)：`build:dev` 不再调用
`closeTypora()`；Typora 未运行时只 `openTestVault()`。验证：构建前后 Typora 进程数均为 5，窗口保持。

**未修改**：开发 core 的 `if (true) devtools()` 属第三方依赖（`node_modules`），按规则不动；因此 vault
开发模式仍会自动打开 DevTools（调试用），但不再导致退出。

## 4. P0-2：全局加载（实验证据 + 待验证假设）

已排除项（每项均有实验或静态证据）：

| 假设 | 验证方式 | 结果 |
| --- | --- | --- |
| 全局未安装 | 检查 `~/.typora/community-plugins/plugins/ranzhi.inkchapter` | 存在（已更新为当前构建 `DCBEB207…`） |
| 未启用 | 检查全局 `plugins.json` | `{"ranzhi.inkchapter": true}` |
| 未注入 | 检查 `resources/window.html` | 已注入 loader 脚本 |
| 目录未链接 | 检查 `%APPDATA%\Typora\plugins` | 符号链接 → community-plugins |
| 旧构建失效 | 全局换为当前构建后重测（D07） | 回执仍不刷新 → 排除 |
| 缺 `.typora/plugins.json` | 在探针目录补建 true 后重测（D08） | 回执仍不刷新 → 排除 |
| core 相对路径问题 | 在探针目录写入绝对 `PLUGIN_CORE_PATH` 后重测（D09） | 回执仍不刷新 → 排除 |

观测到的新事实：

- 普通文档 renderer 进程命令行**没有 `--tyopt`**（vault 模式有）；即该窗口很可能没有
  `window._options`。
- 全局 `loader.js` 的第一条语句就访问 `_options.mountFolder`：

```js
let n = _options.mountFolder || a(_options.initFilePath || File.filePath || ...)
```

若 `_options` 未定义，loader 会在此抛 `ReferenceError`，此后什么都不会发生（无 core、无插件、
无回执、无 UI）——与 D02/D04/D07/D08/D09 完全一致。

待验证假设：普通文档窗口 `_options` 缺失导致 loader 首行中断。
兼容补丁已写好（`_options` 空值回退 + `--user-data-dir` 推导 userDataPath + 异常落盘），保存在
`runtime/startup-audit/loader-patched-unverified.js`，但**未通过验证**（该补丁应用后回执仍不刷新，
且异常未能落盘，说明失败点可能更早或补丁本身未生效），已从全局目录回滚原版 loader。

## 5. 代码与文件修改清单

| 文件 | 修改 | 可回滚 |
| --- | --- | --- |
| `build.js` | dev 构建不再调用 `closeTypora()` | 是（git diff 可取回） |
| `~/.typora/community-plugins/plugins/ranzhi.inkchapter/*` | 更新为当前构建（`DCBEB207…`） | 是（旧版备份 `runtime/startup-audit/backup-global/`） |
| `~/.typora/community-plugins/loader.js` | **已恢复原版**（补丁未采纳） | 是 |
| `test/vault/.typora/env.json` | **已恢复原版**（切生产 core 的试验已回滚） | 是 |
| `test/vault/.typora/plugins.json` | 实验期间临时禁用后已恢复 `true` | 是 |

## 6. 部署与回滚

```powershell
# 回滚全局插件
Copy-Item runtime\startup-audit\backup-global\* `
  C:\Users\MSIPC\.typora\community-plugins\plugins\ranzhi.inkchapter\ -Recurse -Force

# 回滚 build.js
git checkout -- build.js

# 回滚 vault 配置（已在仓库内，直接 git status 确认）
git status --short test/vault/.typora
```

## 7. 未完成 / 待人工验收

1. **P0-2 未修复**：普通目录文档仍不加载墨章。下一步需要可用的普通文档调试通道：
   先点击编辑区使编辑器获得焦点，再尝试 F12（本次在普通文档中 F12/Ctrl+Shift+I 均未打开 DevTools），
   或在 loader 中用 `document.title` 落盘异常后再复测。
2. 深色主题下的视觉回归未做。
3. F05 中「文档检查栏 / 空行标记 / 代码块标记 / 侧栏拖拽 / 窗口宽度」未做完整 GUI 回归（本轮只验证了
   启动与加载，未改这些功能的代码；文末“缺少空行”标记已确认从源码与构建中移除）。
4. 开发 core 自动打开 DevTools 的行为未消除（属第三方依赖，需改 `node_modules` 或改用生产 core +
   调整 vault 插件目录布局 `_typora/plugins/ranzhi.inkchapter/`，都不在本轮最小修复范围）。
