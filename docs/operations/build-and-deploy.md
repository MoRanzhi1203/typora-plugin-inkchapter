# 构建与部署指南

> 更新记录: 2026-08-11 — 新增 R59 自动化部署/验证脚本、Gate 流程

## 开发部署

### 一键构建和部署

```bash
pnpm build:dev
```

此命令执行以下步骤：

1. **清理**: 删除 `./dist` 目录
2. **复制 locales**: 如果 `src/locales/` 存在，复制到 `dist/locales/`
3. **esbuild 打包**: `src/main.ts` → `dist/`（ESM、sourcemap、bundle）
4. **安装到 test vault**: 部署到 `test/vault/.typora/plugins/dist/`
5. **重启 Typora（仅当未运行时）**: 若检测到 Typora 正在运行，**不关闭任何窗口**（跳过 `closeTypora()` 与自动重开），只提示手动重启以加载新构建；若未运行，才执行关闭，并**先以 vault 文件夹启动**（`test/vault`）再打开 `test/vault/doc.md` —— 单独打开文件不会触发社区框架的 vault 插件加载，窗口里将没有墨章 UI。可执行文件按 `TYPORA_EXE` 环境变量 → 常见安装路径 → PATH 顺序解析。

### 打开测试 vault（墨章默认加载）

```bash
pnpm run open:vault                # 挂载 test/vault 后打开 test/vault/doc.md
pnpm run open:vault -- <doc.md>    # 打开指定文档
```

该命令**始终先以文件夹方式挂载 `test/vault`**，轮询 `inkchapter-runtime-load.json` 直到出现新的 `loadSource=vault`，然后才打开文档。原因：社区框架只在“打开笔记文件夹”时加载 vault 插件，单独打开 `.md` 文件得到的窗口没有墨章 UI。可执行文件按 `TYPORA_EXE` → 常见安装路径 → PATH 解析。

### 自动化部署脚本（R59）

使用固定脚本部署，禁止手写 `Copy-Item` 路径：

```powershell
# 部署（含硬路径断言、旧错误目录检测、SHA256 校验）
powershell -File scripts\deploy-test-vault.ps1
```

> 旧 `restart-typora-test-vault.ps1` 与 `verify-typora-runtime.ps1` 已移除。重启走正常启动流程；15 项运行时校验按 [runtime-verification.md](runtime-verification.md) 手工采集审计证据。

### Gate 流程

```text
GATE0: tsc --noEmit → pnpm test → pnpm run build:dev
GATE1: scripts\deploy-test-vault.ps1 (硬路径断言, 禁止 test\vault.typora)
GATE2: project dist SHA256 vs runtime dist SHA256
GATE3: expected buildId == runtime-load buildMarker
GATE4: strict 15-item verify（按 runtime-verification.md 手工/审计采集）
GATE5: minimal GUI smoke
任一 Gate FAIL → HARD STOP, 后续 Gate SKIPPED
```

### 唯一正确运行时路径

```
test\vault\.typora\plugins\dist\main.js
test\vault\.typora\plugins\dist\style.css
```

禁止使用 `test\vault.typora`（错误路径）。

### 构建产物

- `dist/main.js` — 插件主文件（bundle）
- `dist/main.js.map` — sourcemap
- `dist/manifest.json` — 插件清单
- `dist/style.css` — 编译后的样式

### 验证部署

打开 `test/vault/.typora/inkchapter-runtime-load.json`：

```json
{
  "pluginId": "ranzhi.inkchapter",
  "buildMarker": "inkchapter-sidebar-restored-v1",
  "loadedAt": "...",
  "pluginRoot": "...\\test\\vault\\.typora\\plugins\\dist",
  "mainJsSha256": "...",
  "initializationCount": 1,
  "ribbonInjected": false
}
```

## 生产构建

```bash
pnpm run build
```

使用 esbuild 打包（`node build.js --prod`），产物在 `dist/` 目录（与开发构建同一目录）。

## 打包

```bash
pnpm run pack
```

先执行生产构建，然后生成 zip 包。

## 部署到生产环境

1. 构建生产版本：`node build.js --prod`
2. 部署到测试 vault：`scripts/deploy-test-vault.ps1`（目标 `test/vault/.typora/plugins/dist/`）
3. 清运行时缓存（`inkchapter-runtime-load.json` + `inkchapter/audit/`）后重启 Typora
4. 验证 SHA parity（project dist main.js SHA == runtime plugin main.js SHA）与 `initializationCount=1`

## 构建系统

| 组件 | 用途 | 文件 |
|---|---|---|
| esbuild | 唯一构建 authority（开发 + 生产） | `build.js`（`node build.js` / `node build.js --prod`） |
| esbuild-sass-plugin | 样式编译 | `build.js` 内 |
| esbuild-plugin-typora | 部署/重启 | `build.js` 内 |
| archiver | 打包 | `pack.js` |
