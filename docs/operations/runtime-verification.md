# Runtime 验证指南

> 更新记录: 2026-08-11 — 新增 R59 严格 15 项验证、verify-typora-runtime.ps1 自动脚本

## 一、核心原则

**启动命令成功 ≠ Typora 已成功启动。** 只有完成本指南验证步骤后，才允许表述"Typora 已启动"或"插件已加载"。任一项缺失只能写："启动命令已发出，但尚未确认成功。"

## 二、自动化验证（R59）

```powershell
powershell -File scripts\verify-typora-runtime.ps1
```

输出结构化 JSON，含以下所有 15 项。必须 `all15Passed=true` 方可继续。

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
