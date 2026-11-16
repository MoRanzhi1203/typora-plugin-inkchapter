# Runtime 验证指南

> 更新记录: 2026-10-24 — 移除一次性 `verify-typora-runtime.ps1`；本指南改为手工采集 + 审计日志证据。

## 一、核心原则

**启动命令成功 ≠ Typora 已成功启动。** 只有完成本指南验证步骤后，才允许表述"Typora 已启动"或"插件已加载"。任一项缺失只能写："启动命令已发出，但尚未确认成功。"

## 二、证据采集方式

旧自动脚本已移除。按下方 15 项逐项采集证据（PowerShell + `runtime-load.json` + 审计 JSONL），全部满足方可继续；禁止只凭启动命令返回码判定成功。

## 三、严格 15 项验证清单

| # | 项目 | 证据来源 |
|---|------|---------|
| 1 | old Typora process fully exited | Get-Process Typora |
| 2 | new PID | Get-Process Typora |
| 3 | new StartTime | Get-Process Typora |
| 4 | MainWindowHandle != 0 | Get-Process Typora |
| 5 | MainWindowTitle nonempty | Get-Process Typora |
| 6 | target vault REALLY open | active document path, runtime-load, MainWindowTitle |
| 7 | project dist/main.js SHA256 | Get-FileHash dist\main.js |
| 8 | actual runtime main.js SHA256 | Get-FileHash test\vault\.typora\...\main.js |
| 9 | main.js hash match | compare #7 vs #8 |
| 10 | project dist/style.css SHA256 | Get-FileHash dist\style.css |
| 11 | actual runtime style.css SHA256 | Get-FileHash test\vault\.typora\...\style.css |
| 12 | style.css hash match | compare #10 vs #11 |
| 13 | expected/current build marker match | INKCHAPTER_BUILD_ID vs runtime-load buildMarker |
| 14 | actual loaded script absolute path | runtime-load mainJsPath |
| 15 | initializationCount = 1 | runtime-load initializationCount |

## 四、第 6 项 Target Vault 禁止硬编码

必须由真实证据证明：
- 当前 active document path 含 `test\vault`
- 或 runtime-load pluginRoot 含 `test\vault\.typora`

禁止输出 `6. vault: test/vault` 这类硬编码结论。

## 五、第 8/11 项必须真实 Get-FileHash

禁止：
- 读取错误目录 hash
- 仅相信 runtime-load.json 自报 hash
- 重复 project hash 当 runtime hash

## 六、Runtime 证据来源

- `test/vault/.typora/inkchapter-runtime-load.json` — 插件 onload 写入（含 buildMarker, mainJsSha256, initializationCount, pluginRoot）
- `test/vault/.typora/core.json` — showRibbon 配置
- `test/vault/.typora/plugins.json` — 插件注册

## 五、R10 图表代码公式编号运行时验收记录

命令：`pnpm run accept:object-numbering`（启动器：`scripts/run-object-numbering-acceptance.mjs`；运行器：`src/runtime/object-number-acceptance-runner.ts`）。

夹具：`test/vault/runtime/acceptance/ObjectNumbering-R10-Runtime-Acceptance.template.md`（2 个章节、3 张图片、2 张表格、2 个代码块、3 个公式块；部分对象已有题注）。

真实 Typora 1.6.7 / Windows 运行结果（报告：test/vault/runtime/acceptance/object-numbering-acceptance-last-run.json）：

| 项目 | 结果 |
|---|---|
| 对象数量 | 图 3 / 表 2 / 代码 2 / 公式 3 |
| 写入补丁 | 8 |
| 题注列表 | `图 1-1 系统架构图`、`图 1-2`、`表 1-1 模块状态`、`代码 1-1 数据读取程序`、`（1-1）`、`图 2-1`、`表 2-1 实验结果`、`代码 2-1`、`（2-2）` |
| 源码哈希 | 写入前 `d4e0692a` → 写入后 `da4cc156` → 第二次同步 `da4cc156` |
| 第二次同步 | `UNCHANGED`，0 补丁，逐字节一致 |
| DOM 题注 | 9 条，重复题注 0 |
| 章节联动 | 插入新章节后 `APPLIED`（6 补丁），再次同步 `UNCHANGED` |
| 撤销 / 重做 | 撤销改变缓冲区；重做恢复编号后缓冲区 |
| 导出副本 | `ObjectNumbering-R10-Runtime-Acceptance.numbered.md`，含标题与图/表编号 |
| HTML | 宿主 `exportToHTML` 在本机不可用，记录为 `HTML_HOST_API_NOT_VERIFIED`，未声称通过 |

说明：本次验收不声称已验证 Word 原生 SEQ 字段或 PDF 排版；编号已写入源码副本，宿主导出时使用真实文本编号。
