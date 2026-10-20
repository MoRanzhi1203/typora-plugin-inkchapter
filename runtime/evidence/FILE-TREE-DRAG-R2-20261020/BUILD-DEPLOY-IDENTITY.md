# 文件树 ↔ Windows 资源管理器拖拽 R2 — 构建、部署与身份

日期：2026-10-20 17:20 (+08:00)
工程：`D:\TyporaPluginProjects\typora-plugin-inkchapter`

## 1. WIP 与版本

| 项目 | 值 |
|---|---|
| Git HEAD | `f976ff844c3a75019484e8ab1fc7df62a64e7655` |
| Node | `v24.19.0`（`E:\NodeJS`） |
| pnpm | `11.15.0` |
| Typora | `1.6.7` |
| Typora 资源版本 | `24.1.2` |

`git status --short`（未提交，未 reset / clean / stash / commit）：

```
 M CHANGELOG.md
 M docs/maintenance/prompt-cleanup-history.md
 M docs/maintenance/prompt-consolidation-record.md
 M docs/modules/README.md
 M docs/modules/document-utilities.md
 M src/main.ts
 M src/style.scss
?? src/file-transfer/
?? test/vault/墨章插件测试/.backup/
?? test/vault/墨章插件测试/file-tree-drag-r2/
```

说明：前 5 个 docs/CHANGELOG 改动为本轮开始前已存在的 WIP，未触碰；`src/main.ts`、`src/style.scss`、`src/file-transfer/` 为本功能改动；`file-tree-drag-r2/` 为人工验收样本。

## 2. 四类门禁状态

### STATIC_GATE = PASS

| 检查 | 结果 |
|---|---|
| `tsc --noEmit -p tsconfig.json` | PASS |
| 定向测试 `src/file-transfer` | 5 文件 / 61 用例 PASS |
| 全量测试 | 245 文件 / 4590 用例 PASS |
| 生产构建 `pnpm run build` | PASS（esbuild，`--prod`） |
| `dist/main.js.map` | 不存在（确认为生产构建） |

定向测试文件：

- `file-transfer-policy.test.ts`（17）
- `file-copy-service.test.ts`（18）
- `native-drag-bridge.test.ts`（10）
- `file-tree-drag-adapter.test.ts`（14）
- `file-tree-drop.integration.test.ts`（2）

### DEPLOY_SHA_GATE = PASS

| 位置 | main.js SHA256 | style.css SHA256 |
|---|---|---|
| `dist` | `DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A` | `B4E80A5FD35E6BC5A5A6A62612B13F05EDA6F035160A00179185912DAEA0C6EF` |
| 测试 vault `.typora/plugins/dist` | `DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A` | `B4E80A5FD35E6BC5A5A6A62612B13F05EDA6F035160A00179185912DAEA0C6EF` |
| 哈希一致 | **True** | **True** |

- `BUILD_MODE: production`
- `VAULT_ENABLED: True`
- `GLOBAL_DEPLOY: skipped`
- 全局生产插件未被覆盖：仍为 `DE62CB1A7489E219EF88D4BA0E2431D57506FAAE3D7E2A1433606FD2639A339E`

### RUNTIME_IDENTITY = LOADED（PASS）

用户关闭原有 Typora 后，本轮安全启动测试 vault（未再关闭/重启任何带未保存内容的窗口）。

| 运行位置 | 实际加载 SHA | 加载时间 | 说明 |
|---|---|---|---|
| 当前候选窗口（vault） | `DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A` | 2026-10-20T09:29:20.613Z | `loadSource=vault`，测试 vault |
| 旧全局构建 | `DE62CB1A...` | 2026-10-19T17:50:04.015Z | 已不在当前窗口 |
| 旧测试 vault runtime-load | `B68D5041...` | 2026-10-17T18:22:10.592Z | 历史值，已被新加载覆盖 |

当前 Typora：

- PID：10148
- HWND：9441978
- 标题：测试 vault 文档（启动后打开 `critique_republican_masters_059 (1).md`）
- 启动时间：2026-10-20 17:29:16
- `runtime-load.json`：`mainJsSha256=DD4F...`，`loadSource=vault`
- DevTools 控制台另见 `[InkChapter] RUNTIME-IDENTITY-FINAL ... shaMatch=true`

运行时 DOM 探针：

- `window.__INKCHAPTER_FILE_TREE_DRAG_ADAPTER__.current.getInvariant()`：
  `{attached:true, processing:false, externalDropCount:2, copiedCount:2, failedCount:0, lastDestination:"...test\\vault", highlighted:false}`
- `#file-library-tree` 存在，`File.getMountFolder()` 返回测试 vault 根。
- `file-tree-drag-r2` 与 5 个目标子目录节点均可在真实 DOM 中定位。

### OS_DRAG_E2E = PENDING_USER_MANUAL

真实鼠标拖拽未能完整、可靠地由自动化完成；详见 `OS-DRAG-RUNTIME-MATRIX.md`。
已观察到一次真实拖出复制（源文件保持，SHA 一致），但 D01–D12 仍需人工逐项确认。

## 3. 历史候选与当前候选

| 阶段 | main.js SHA256 |
|---|---|
| 本轮开始时核实的旧候选（历史报告 D58FF） | `D58FF586A4FEF3FE084474877A1767E0F08D030595CB11668EE2B402B56C7999` |
| 本轮定点修复后 | `DD4F6646438A5B218CD04EDC08EA04B67BF1432A8CAEFC13C5E65F921962FD3A` |

D58FF 已在本轮开始通过 `dist/main.js` 与测试 vault 两处 SHA 核实；不是引用旧报告值。

## 4. 构建脚本安全审计

- `pnpm run build` → `node build.js --prod`：仅构建，不调用 `installDevPlugin`、不执行 `closeTypora`、不启动 Typora。本轮使用该命令。
- `pnpm run build:dev` → `build.js`（dev）：会调用 `installDevPlugin` 和 `closeTypora` 并启动 Typora，可能危及未保存内容。本轮**禁止并跳过**。
- 测试 vault 部署脚本只复制文件并校验 SHA，不终止 Typora。

## 5. 结论

- 静态、测试、构建、测试 vault 部署：**PASS**
- 运行时加载候选构建：**LOADED / PASS**
- 真实 OS 拖拽 D01–D12：**PENDING_USER_MANUAL**
- 总体：**PARTIAL / PENDING_USER_MANUAL**（不得写 FULL_PASS）
