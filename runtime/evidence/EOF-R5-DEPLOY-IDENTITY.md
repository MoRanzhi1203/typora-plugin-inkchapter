# EOF-R5-DEPLOY-IDENTITY

> 轮次：`sess-p0-eof-visual-sync-r5`（2026-10-12/18）

## 1. 构建 / 部署 / 加载（独立取值）

| 层 | 值 | 来源 |
|---|---|---|
| 修复前（真实加载） | `2BAC40036D3676193884FA6A96D0C2C95D012FC5DD85CA8D75F14702B3BB5758` | `inkchapter-runtime-load.json` |
| **本轮 BUILD** `dist/main.js` | `B0A98E0953F4A3B7D5777ECC6DD6241E1A5DE3281D88AE05DD3DC22C8615BDDC` | `Get-FileHash` |
| `dist/style.css` | `2B782DBD1D5172F8A36C204D247926541A6B70E18B00D234BE458490FD6AB414` | `Get-FileHash` |
| **部署 TEST_VAULT** | `B0A98E09…` | `Get-FileHash test/vault/.typora/plugins/dist/main.js` |
| **已加载** | `2BAC4003…`（`loadedAt=2026-10-17T16:49:14.321Z`，init=1，source=vault） | `runtime-load.json` |
| 全局生产 | `DE62CB1A7489E219EF88D4BA0E2431D57506FAAE3D7E2A1433606FD2639A339E`（**未覆盖**） | `Get-FileHash` |

## 2. 判定

```
BUILD == DEPLOY        = PASS   (B0A98E09…)
DEPLOY == LOADED       = FAIL   (B0A98E09 ≠ 2BAC4003)
RUNTIME_IDENTITY       = FAIL   → 新构建尚未被真实进程加载
```

## 3. 进程 / 窗口（真实）

| 项 | 值 |
|---|---|
| 主窗口 | PID **37556** / HWND **1509356** / `Responding=True` |
| 标题 | `Document-Diagnostics-Empty-Block-Presentation-Test.md• - Typora` |
| 未保存状态 | **有（`•`）** —— 用户 WIP，**未关闭、未强制重启、未覆盖文件** |
| 子进程 | 14744 / 32368 / 37480 / 38328 |

## 4. 部署安全

- `build:dev` 输出中出现 `Installing plugin... / Closing Typora...`（来自 `esbuild-plugin-typora` 的安装步骤），但**实际未终止** PID 37556（复查存活、HWND 不变、标题 `•` 保留）。
- 仅写入测试 vault；全局生产插件 SHA 未变。
- 未执行 Git commit。

## 5. 为什么没有自动重启

提示词 §7：Typora 正在运行且存在未保存 WIP 时**不得自动结束或强制重启**。因此：

- 新构建的**真实加载 / 真实按键验收 = PENDING_USER_MANUAL**；
- 工程侧（tsc/定向/全量/build/部署 SHA）已完成，不因人工项停在只读阶段。

## 6. 用户唯一必要动作

保存当前文档（或确认可丢弃）→ 关闭并重新打开 `test/vault` → 确认 `runtime-load.json` 的 `mainJsSha256 = B0A98E09…` → 在文末执行 0/1/2/3 空行增删。
