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
5. **重启 Typora**: 关闭当前 Typora → 打开 `test/vault/doc.md`

### 自动化部署脚本（R59）

使用固定脚本部署，禁止手写 `Copy-Item` 路径：

```powershell
# 部署（含硬路径断言、旧错误目录检测、SHA256 校验）
powershell -File scripts\deploy-test-vault.ps1

# 重启 Typora（关闭旧进程→确认退出→启动→等待窗口）
powershell -File scripts\restart-typora-test-vault.ps1

# 运行时验证（结构化 JSON, 15 项校验）
powershell -File scripts\verify-typora-runtime.ps1
```

### Gate 流程

```text
GATE0: tsc --noEmit → pnpm test → pnpm run build:dev
GATE1: scripts\deploy-test-vault.ps1 (硬路径断言, 禁止 test\vault.typora)
GATE2: project dist SHA256 vs runtime dist SHA256
GATE3: expected buildId == runtime-load buildMarker
GATE4: strict 15-item verify (all15Passed=true)
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
