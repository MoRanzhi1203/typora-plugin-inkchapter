# Typora 启动与全局加载测试矩阵

执行时间：2026-11-01　Typora 1.6.7　构建：`main.js DCBEB207…4730`
原始数据：`runtime/startup-audit/D01.json … D06.json`、`run-experiment.ps1`

## 1. 交叉隔离实验（D01–D06，每个观察 180 秒）

| 实验 | 启动方式 | 文档环境 | InkChapter | 结果 | DevTools | 回执（loadSource / SHA / init） |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | 手动（Explorer） | test/vault | 启用 | 存活 180s | 自动出现 | `vault / DCBEB207 / 1` |
| D02 | 手动（Explorer） | 普通目录 | 启用（全局） | 存活 180s | 未出现 | **未刷新（仍是 10/19 的 global/DE62CB1A）** |
| D03 | 自动化（Start-Process） | test/vault | 启用 | 存活 180s | 自动出现 | `vault / DCBEB207 / 1` |
| D04 | 自动化（Start-Process） | 普通目录 | 启用（全局） | 存活 180s | 未出现 | **未刷新** |
| D05 | 手动 | test/vault | **临时禁用** | 存活 180s | 自动出现 | 未刷新（插件未加载，符合预期） |
| D06 | 自动化 | test/vault | **临时禁用** | 存活 180s | 自动出现 | 未刷新（同上） |

结论：

1. **只有自动化启动会退出** → 不成立。D03/D04/D06 全部存活 180 秒。
2. **只有加载 InkChapter 时退出** → 不成立。D05/D06（插件禁用）同样存活，且 DevTools 仍出现。
3. **只有 test/vault 模式触发 DevTools** → 成立。D01/D03/D05/D06 出现，D02/D04 不出现（生产 core）。
4. 普通目录不加载插件与 DevTools 是否同源 → 不共享同一配置：DevTools 来自开发 core，插件加载失败来自
   loader 在普通文档窗口的中断（见 §3）。

> 历史“10–60 秒退出”的可解释来源：反复启动多个实例、以及 `build:dev` 调用 `closeTypora()` 删除
> `_lock/win-test`；开发 core 的 watcher 收到 `rename` 后执行 `window.close`。D01–D06 期间未执行
> `closeTypora()`，全部稳定。

## 2. 补充验证（D07–D10）

| 实验 | 变更 | 结果 |
| --- | --- | --- |
| D07 | 全局插件升级为当前构建 `DCBEB207…` | 普通文档回执仍不刷新 → 排除“旧构建失效” |
| D08 | 探针目录补建 `.typora/plugins.json = {ranzhi.inkchapter:true}` | 仍不刷新 → 排除“启用清单缺失” |
| D09 | 探针目录写入绝对 `PLUGIN_CORE_PATH`（全局 2.9.13 core） | 仍不刷新 → 排除“core 相对路径解析” |
| D10 | Typora 运行中执行 `pnpm run build:dev`（修复后） | 构建前后进程数均为 5，窗口保持 → **P0-1 修复验证通过** |

## 3. 验收标准对照

| 编号 | 验收项 | 状态 | 说明 |
| --- | --- | --- | --- |
| F01 | 手动启动正常 | ✅ | D01/D02/D05 |
| F01 | 自动化启动不异常退出 | ✅ | D03/D04/D06（180s） |
| F01 | 进程/窗口生命周期可解释 | ✅ | 退出链路见审计文档 §3 |
| F01 | DevTools 不会无故弹出 | ⚠️ 未达成 | vault 开发模式仍会自动打开（第三方开发 core 的 `if (true) devtools()`） |
| F02 | 任意普通 Markdown 使用墨章 | ❌ **未达成** | D02/D04/D07/D08/D09 均未加载 |
| F02 | test/vault 使用测试构建 | ✅ | D01/D03 |
| F02 | 切换路径不丢失插件 | ⚠️ 未验证 | 需 P0-2 先解决 |
| F03 | 记录加载来源与哈希 | ✅ | 回执 `loadSource`/`mainJsSha256`；vault `vault/DCBEB207` |
| F03 | 全局与测试构建不混淆 | ✅ | 全局已升级为 `DCBEB207…`，旧版备份 |
| F04 | initializationCount 符合预期 | ✅（vault）/ ❌（普通） | 普通文档无回执 |
| F04 | 无双工具栏/重复标记/Observer | ⚠️ 未做 GUI 回归 | 本轮未改渲染层代码 |
| F05 | 文档检查栏 / 空行 / 代码块标记 | ⚠️ 未做 GUI 回归 | 同上 |
| F05 | 文末“缺少空行”标记已移除 | ✅ | 源码与 `style.css` 中均无 `eof-missing-blank` 符号 |
| F05 | 文档正文不被插件修改 | ✅（继承） | 本轮未改动写入路径 |

图例：✅ 已验证通过；⚠️ 部分达成或未验证；❌ 未达成。

## 4. 复现命令

```powershell
# 单个实验（180 秒）
powershell -File runtime\startup-audit\run-experiment.ps1 -Mode manual -Doc vault  -Plugins on  -Tag D01
powershell -File runtime\startup-audit\run-experiment.ps1 -Mode auto   -Doc normal -Plugins on  -Tag D04

# 修复验证：Typora 运行中构建不关窗
pnpm run build:dev

# 回滚
Copy-Item runtime\startup-audit\backup-global\* `
  C:\Users\MSIPC\.typora\community-plugins\plugins\ranzhi.inkchapter\ -Recurse -Force
git checkout -- build.js
```
