# 模块：Runtime Audit / Identity（运行时审计与身份）

## 1. 作用与用户可见能力

面向开发者/自动化：提供"这次加载到底是不是**这一次**构建、**这一个** vault、**这一个**进程"的可验证证据。用户不可见。

## 2. 当前实现状态

- 已实现：`RUNTIME-IDENTITY-FINAL` 身份快照、`inkchapter-runtime-load.json` 落盘、JSONL forensic 日志 sink、结构化运行时验证脚本。
- 原则：**`启动命令成功 ≠ Runtime Identity PASS`**。只有通过验证脚本的 15 项检查才允许表述"已启动/已加载"。

## 3. Production Entry Points

| 关注点 | 生产文件 |
|---|---|
| 身份快照 / 审计事件 | `src/main.ts`（`INKCHAPTER_BUILD_ID`、`RUNTIME_GATE_REVISION`、`emitRuntimeAudit('RUNTIME-IDENTITY-FINAL', ...)`） |
| 内存审计缓冲 | `src/heading-numbering/runtime-audit.ts`（`enableRuntimeAudit` / `getAuditEventsJSON` / `copyAuditEventsToClipboard` / `recordRuntimeAudit`） |
| 文件 sink | `src/runtime/forensic-log-sink.ts`（`initializeForensicSink` / `emitRuntimeAudit` / `shutdownForensicSink`） |
| 全局加载审计 | `src/runtime/inkchapter-path-authority.ts` + `src/runtime/inkchapter-bootstrap-audit.ts` |
| 运行时验证脚本 | `scripts/verify-typora-runtime.ps1`、`scripts/verify-typora-startup.ps1` |
| 部署脚本 | `scripts/deploy-test-vault.ps1`、`scripts/restart-typora-test-vault.ps1` |

## 4. Authority / Source of Truth

- **Build marker**：`INKCHAPTER_BUILD_ID`（业务构建标识）；运行时另有 `RUNTIME_AUDIT_BUILD_MARKER`（审计专用，二者分离）。
- **Deployed artifact SHA**：`main.ts` 分别计算 project dist 与部署副本的 SHA256，`shaMatch` 用于识别陈旧部署。
- **Fresh Runtime Identity**：以 `initializationCount`、进程 identity、vault 真实性共同判定，而非只看命令返回码。

## 5. 核心数据结构

- `inkchapter-runtime-load.json`：`pluginId` / `buildMarker` / `runtimeGateRevision` / `loadedAt` / `pluginRoot` / `mainJsPath` / `mainJsSha256` / `manifestPath` / `initializationCount` / `sidebarStructure`。
- forensic JSONL 记录：`level` / `event` / envelope 字段（`documentKey` / `editorInstanceId` 等）/ `payload`。

## 6. 主流程

```text
onload
  → initializeForensicSink({ vaultRoot, buildId, sessionId })
  → emitRuntimeAudit('INKCHAPTER-GLOBAL-LOAD-AUDIT', ...)
  → 计算 project / deployed main.js 与 style.css SHA
  → emitRuntimeAudit('RUNTIME-IDENTITY-FINAL', { shaMatch, initializationCount, ... })
  → 写 {pluginRoot}/../../inkchapter-runtime-load.json
  → refreshRuntimeIntegrity（runtime 域，不进用户 Drawer）
验证：scripts/verify-typora-runtime.ps1 → all15Passed=true
```

## 7. 用户交互与 UI Contract

- 命令：`inkchapter.audit.copy` / `inkchapter.audit.clear` / `inkchapter.audit.snapshot`。

## 8. Settings / Persistence

- 审计 sink 自身不持久化设置；输出路径 `<vault>/.typora/inkchapter/audit/runtime-<sessionId>.log`。
- `docs/`、`test/vault/.typora/inkchapter/audit/` 等运行时产物受 `.gitignore` 排除。

## 9. Dynamic Refresh / Event Model

- 事件驱动 `emitRuntimeAudit`；sink 异步队列 + 去重（`forensic-log-sink-dedup.test.ts`），写失败 fail-open。

## 10. Runtime Audit / Debug Evidence

关键事件：`RUNTIME-IDENTITY-FINAL`、`INKCHAPTER-GLOBAL-LOAD-AUDIT`、`PLUGIN-RUNTIME-ARTIFACT`、`[DIAGNOSTIC][RUNTIME]`。15 项检查见 [../operations/runtime-verification.md](../operations/runtime-verification.md)。

## 11. Tests / Fixtures

- `src/runtime/forensic-log-sink.test.ts`、`forensic-log-sink-dedup.test.ts`、`ime-audit-mirror.test.ts`、`editor-input-focus-probe.test.ts`。

## 12. Build / Deployment 相关约束

- SHA parity：project `dist/main.js` == 部署副本 `main.js`；style 同理。
- 部署与验证必须走固定脚本，禁止手写 `Copy-Item` 路径。

## 13. 已知限制与 Deferred Work

- 像素级目检（`PIXEL_GATE`）需真实 Typora 会话。

## 14. 历史设计决策

- 历史上 `pluginMainSha256` 优先取 project 构建，无法发现"陈旧部署"；现额外计算 deployed artifact SHA 以闭合该盲点（见 `main.ts` 注释）。
