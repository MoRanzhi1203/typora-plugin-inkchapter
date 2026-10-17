# P0-CARET-EOF-FIX-REPORT

> 轮次：`sess-p0-caret-eof-full-closure`（2026-10-12）｜构建 `3A165610E9C56F78EE7FA2CEBCF9FEEDAAB69D37A6FA27B0D59CBFB039ADDE10`

## 1. 修改文件与行为差异

| 文件 | 改动 | 行为差异 |
|---|---|---|
| `src/document-utilities/document-diagnostic-caret-isolation-v1.ts` | 审计队列**非静默**化；新增 `NavigationAuditCounters` / `evaluateAuditCoverageGate` / `invalidateNavigationAudits`；`eventSeq/queuedAt/flushedAt`；新增 `collectPluginPresentationTexts` / `scanPluginTextInSerializedMarkdown` / `evaluateSerializedMarkdownGate` | 队列溢出由「静默 shift」变为**显式计数并让覆盖门禁 FAIL**；切文档取消待处理审计；序列化泄漏须由**真实导出文本**判定（未采样 `NOT_RUN`） |
| `src/heading-numbering/heading-numbering-service.ts` | 导入并接线新门禁；`bindEditorRoot` 根重绑时 `invalidateNavigationAudits('EDITOR_ROOT_REBIND')`；新增 `getNavigationAuditCoverageReport()`；普通 Enter 路径新增**有界只读** `ENTER-PLUGIN-INTERVENTION-AUDIT` | 切文档不再有跨文档审计污染；可读取审计覆盖门禁；真实 Enter 的「插件是否干预事件链」有本机证据 |
| `src/document-utilities/document-diagnostic-caret-isolation-v1.test.ts` | 新增 §7.2/§7.3 测试（覆盖 PASS / 非静默溢出 FAIL / 切文档取消 / 非导航键 / 序列化泄漏与 NOT_RUN） | 可判错守护新增行为 |
| `src/core/build-pipeline-fail-fast.test.ts`（新） | 断言 `build:dev`/`build` 必须先 `typecheck` 再 `build.js`；`typecheck=tsc --noEmit`；`NAVIGATION_AUDIT_KEYS` 导出仍存在 | 防历史「tsc 失败但 esbuild 仍出产物」回归 |
| `package.json` | `build:dev` / `build` 前置 `pnpm run typecheck`；新增 `typecheck` 脚本 | 构建 **fail-fast**：类型错误不再被 esbuild 掩盖 |

**未做**（遵守禁止事项）：未忽略 MutationObserver；未改任何计数公式除二/减一；未强删空行；未 debounce 掩盖；未修改任何用户 Markdown；未覆盖全局生产插件；未 `git commit`；未启停 Typora。

## 2. 静态/构建门禁（真实输出）

- `TSC_EXIT=0`（PASS）
- 定向测试 15/15 PASS（含新增 §7.2/§7.3 与构建守卫）
- 全量 **237 files / 4494 tests PASS**（`pnpm run test`，含 `ARCHIVE VERIFY=PASS`）
- `pnpm run build:dev` PASS（前置 tsc 通过后才执行 esbuild；`ARCHIVE VERIFY=PASS`）
- 部署 test vault：`DEPLOY_HASH_MAIN_MATCH=True`、`DEPLOY_HASH_CSS_MATCH=True`
- 存档：新增 `PROGRESS-ARCHIVE.md` **ENTRY 9**（append-only 校验通过，`ENTRY_COUNT=9`）

## 3. 性能

- 审计保持**事件驱动 + 单次合并宏任务**（`setTimeout(0)`）；队列上限 64；窗口外零开销；无轮询、无定时器、无递归 setTimeout。
- `ENTER-PLUGIN-INTERVENTION-AUDIT` 仅在 `isRealEnter` 时发出一次，有界。
- 本轮**未做** P95/P99 采样（性能指标 = NOT_RUN，禁止以日志条数冒充改善）。

## 4. 遗留风险

1. **文末 Enter 重复拆分根因未闭环**（`ROOT_CAUSE=UNKNOWN`）；本轮已用静态证据排除「插件事件链 preventDefault/stopPropagation」与「插件结构性写入」两条路径，余下嫌疑需真实运行时插桩。
2. **所有真实键入/鼠标/像素验收 = PENDING_USER_MANUAL**（Typora 未运行且禁止自行启动）。
3. **RUNTIME_IDENTITY=FAIL**：已加载 `430FC947…` ≠ 部署 `3A165610…`，需重启 Typora。
4. `AUDITS_DROPPED` 在极端连按（>64 帧内）下仍可能非 0 → 届时门禁将**如实**报 `FAIL_AUDIT_COVERAGE`（设计如此，不掩盖）。
5. 构建产物为 dev/test（含 sourcemap），仅部署 test vault。

## 5. 最终报告

```text
TYPECHECK=PASS
TARGETED_TESTS=PASS (15/15)
FULL_TESTS=PASS (237 files / 4494 tests)
BUILD=PASS
ARCHIVE_VERIFY=PASS (ENTRY_COUNT=9)
DEPLOY_SHA=PASS (project==vault==3A165610…, style==2B782DBD…)
RUNTIME_IDENTITY=FAIL (loaded 430FC947… != deployed 3A165610…; global untouched DE62CB1A…)
CARET_ISOLATION_RUNTIME=PENDING_USER_MANUAL
ENTER_EOF_RUNTIME=PENDING_USER_MANUAL
EOF_VISUAL_RUNTIME=PENDING_USER_MANUAL
CAPTION_INTERACTION_RUNTIME=PENDING_USER_MANUAL
AUDIT_COVERAGE=PASS (static/unit; runtime sampling NOT_RUN)
FULL_RUNTIME_ACCEPTANCE=PARTIAL
NOT_RUN=[C0/C4 real-Enter pair, A01-A08, B12, B13, C01-C08, RUNTIME_STRUCTURE, serialized-export compare, P95/P99]
FIRST_PROVEN_DIVERGENCE=诊断展示层挂载前缺 contenteditable=false（光标可进入）；导航审计队列满时静默 shift 丢弃样本
MODIFIED_FILES=[src/document-utilities/document-diagnostic-caret-isolation-v1.ts, src/document-utilities/document-diagnostic-caret-isolation-v1.test.ts, src/heading-numbering/heading-numbering-service.ts, src/core/build-pipeline-fail-fast.test.ts, package.json]
EVIDENCE_PATHS=[runtime/evidence/P0-CARET-EOF-ROOT-CAUSE.md, runtime/evidence/P0-CARET-EOF-BASELINE-MATRIX.md, runtime/evidence/P0-CARET-EOF-REGRESSION-MATRIX.md, runtime/evidence/P0-CARET-EOF-RUNTIME-IDENTITY.md, runtime/evidence/P0-CARET-EOF-FIX-REPORT.md, docs/archive/PROGRESS-ARCHIVE.md#ENTRY-9]
```

> `FULL_RUNTIME_ACCEPTANCE=PARTIAL`：自动化可完成的修复已同轮实施并复测；真实键入/视觉/像素项受「Typora 未运行 + 禁止自行启停」阻断，只能 `PENDING_USER_MANUAL`，故**不**报整体 PASS。
