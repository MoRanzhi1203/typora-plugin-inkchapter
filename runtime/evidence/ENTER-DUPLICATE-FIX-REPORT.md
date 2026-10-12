# ENTER-DUPLICATE-FIX-REPORT

## 1. 本轮修改文件与精确函数

| 文件 | 函数/位置 | 改动 | 理由 |
|---|---|---|---|
| `src/document-utilities/enter-echo-write-trace.ts` | `classifyWriteOrigin()`（新增） | 依据**首个真实外部业务帧**判定写入来源：含 `typora://` ⇒ `typora`；含 `main.js` 业务帧 ⇒ `plugin`；否则 `unknown` | §B2：wrapper 帧在 `main.js` ≠ 插件是写入者 |
| 同上 | `installWriteInterceptor()` 的 `wrapped` | 自身帧丢弃深度 `firstFrames(2)` → **`firstFrames(4)`**（丢弃 `firstFrames`/`noteEnterEchoWrite`/wrapper）；记录 `origin`；`struct:` 与 `attr:` 分类 | §B2：消除自身帧误归因；属性写入不得冒充结构证据 |
| 同上 | `EnterEchoWriteRecord` | 新增 `origin` 字段 | 归档需区分来源 |
| 同上 | `drainEnterEchoWriteTrace()` | 新增 `truncated` | §B2：满额必须显式标记，避免「空记录=原生」 |
| 同上 | `noteEnterEchoWrite()` | 新增 `origin` / `stackOverride` 可选参数（默认 `plugin`，向后兼容手埋点） | 保留既有 4 处手埋点语义 |
| `src/heading-numbering/heading-numbering-service.ts` | Enter 回声检测块（MutationObserver 回调内） | 新增 **`endBlockTouched` 分类**（批次含 `.md-end-block`）；audit 增加 `endBlockRenormalization`，`decision` 取 `NATIVE_END_BLOCK_RENORMALIZATION` \| `DUPLICATE_SPLIT` | §D2：Typora 尾块重建是**原生中间态**，需分类而非吞掉 |
| 同上 | 同上（trace 汇总） | 落盘 payload 增加 `truncated / structuralRecordCount / pluginStructuralWriteCount / originCounts` | §B2 证据分层 |
| 同上 | `enterEndBlockRenormalizationCount` 字段 + `getEnterSplitEchoReport()` | 暴露 `endBlockRenormalizationCount` | 门禁可读 |
| 同上 | Enter 回声检测块（**§D2 定点修复**） | 新增 `transactionAttribution='SAME_ENTER_SCENE_IDEMPOTENT'` + `enterTransactionCoalesceSceneId/Until`；新增公开 `isEnterTransactionCoalesced()` | 真实轨迹已确证第二次拆分是 Typora 尾块重建（`structural=0 / plugin=0 / typora=14 / endBlockRenormalization=true`）→ 归属同一 Enter 事务、**幂等提交**，不吞批次、不改计数 |
| `src/document-utilities/enter-echo-write-trace.test.ts` | — | 新增：`classifyWriteOrigin`（typora/plugin/unknown）、`truncated`、`struct:`/`attr:` 分类 | §B2 要求的 smoke test |

**未做（遵守禁止事项）**：未忽略/吞掉第二个 MutationObserver batch；未改任何计数公式；未强制删空行；未用 debounce 掩盖；未把 tracer 变成长期开启的全域 `Error().stack`（仅 250ms 有界窗口，窗口外零开销）。

## 2. 为什么这样修

- 真实证据显示：第二次 `SPLIT_1_TO_2` 的调用链来自 **Typora 自身** `Editor.pressReturn` 对 `P.md-end-block` 的重建（两条 pressReturn 路径 + 两个 handler），插件**未做结构写入**。
- 但 §0 明确 `recordCount` 与属性写入**不能**单独定案，且源码净增是否异常**尚未测量**。
- 因此本轮只做**可被证据支撑**的两件事：(a) 修好归因仪器，使下一次真实 Enter 的归属可信；(b) 把「Typora 尾块重建」显式分类为原生中间态，为 §D2 的**幂等提交**铺路 —— 不改变任何用户可见计数、不隐藏结构变化。

## 3. 为什么不影响其它编辑功能

- 追踪器：`Date.now() < armedUntil` 单次比较的直通包装；窗口外零开销；`firstFrames` 只在窗口内、且在 `#write` 相关写入时才计算。
- 归因/分类：纯读取 `mutation` 记录与 `classList`，不做写回；`endBlockRenormalization` 仅进审计与报告。
- 未触碰 Markdown、Undo 栈、IME、Enter 事件本身。

## 4. 残余风险

1. **根因未完全定案**：C0–C3 禁用对照与 §B3 三层快照未测，无法排除插件其它路径（`Range`/`innerHTML`/Typora 内部模型）诱发。
2. **`md-end-block` 语义依赖**：若 Typora 版本改变尾块类名，分类将失效（表现为 `endBlockRenormalization=false`，不误报）。
3. **无界增长**：`enterDuplicateStructuralSplitCount` 等为会话计数器，仅用于诊断，不参与门禁阈值以外的逻辑。

## 5. 构建与 SHA 证据

| 项 | 值 |
|---|---|
| dist/main.js | `DE62CB1A7489E219EF88D4BA0E2431D57506FAAE3D7E2A1433606FD2639A339E` |
| dist/style.css | `506B3E639B4BC33827FD914B53CAA8E57F0957460D0927B2A495F9B4D9319EE8` |
| 部署（vault + global） | `DEPLOY_HASH_MAIN_MATCH=true`、`CROSS_ROOT_MAIN_PARITY=true` |
| Runtime 加载 | `mainJsSha256=DE62CB1A…`、`initializationCount=1`、`loadSource=vault`（Typora PID 34412） |
| git | branch `archive/document-diagnostics-copy-sort-ui-v1`、HEAD `9fa6a8024fcd5dac0e629eb3cbaf042ba46b446d`（WIP 全保留） |

## 6. 测试

| 命令 | 结果 |
|---|---|
| `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0（PASS） |
| `pnpm exec vitest run src/document-utilities/enter-echo-write-trace.test.ts` | 5 passed |
| `pnpm exec vitest run`（全量） | **234 files / 4476 tests PASS** |
| `pnpm run build` | PASS（含 `archive VERIFY=PASS`） |
