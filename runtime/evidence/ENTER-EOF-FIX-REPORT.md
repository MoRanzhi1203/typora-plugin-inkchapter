# ENTER-EOF-FIX-REPORT

> ⚠️ **R3 更正（重要）**：本文档 §6/R2 中「真实 Enter 不再出现第二次 split」的结论**仅适用于正文中部**。R3 文末（EOF）复核显示：探针关闭后**文末重复 split 仍然存在**（C0 原生 +2 LF / C4 墨章 +4 LF），且新构建 trace 证明回声窗口内**无插件 DOM 结构写入**。因此 **文末场景未修复，R2 的 PASS 结论作废**。详见 `ENTER-EOF-RUNTIME-ACCEPTANCE.md §8` 与 `ENTER-EOF-CONTROL-MATRIX.md §7`。

> 阶段 5/8/9 交付物。本轮修改文件、精确入口、验证结果与未验证项。

## 1. 修改文件与精确入口

| 文件 | 函数/位置 | 改动 | 理由 |
|---|---|---|---|
| `src/document-utilities/enter-echo-write-trace.ts` | 新增 `isContentDocumentWriteHoldActive()` | 导出「内容文档写入保持」谓词（= 真实 Enter 回声窗口有界门） | 让所有 `#write` 结构写入方在回声窗口内可自退 |
| 同上 | `describeFingerprint()`（新增）+ `EnterEchoWriteRecord.targetFingerprint/affectedFingerprint` | 记录被操作节点/关联节点的**拓扑指纹**（tag/childCount/parent/attrs） | §3.1：把写入绑定到真实节点身份（探针 vs 正文段落）与父容器（是否 `#write`）；补上「覆盖缺口」 |
| 同上 | `noteEnterEchoWrite()` | 新增 `affected` 可选参数；插入指纹字段 | 向后兼容既有 4 处手埋点；`removeChild/insertBefore` 可同时记录对方节点 |
| 同上 | `installWriteInterceptor()` | 传入 `affected` | 交叉记录被移除节点身份 |
| `src/document-utilities/document-utility-overlay-host.ts` | `runBlankRowPaintLayerAcceptanceDryRun()` | 在 `ensureLocateDocumentLayer()` **之前**增加 `isContentDocumentWriteHoldActive()` 早退（附审计 `DOCUMENT-DIAGNOSTIC-BLANK-ROW-DRYRUN-HELD`） | **根因修复**：回声窗口内禁止向 `#write` 做结构写入 |
| `src/document-utilities/document-diagnostic-blank-row-acceptance-hold-v1.test.ts` | 新增测试（3 条，jsdom） | 见 §3 | 可判错断言 |

**未做（遵守禁止事项）**：未忽略/吞掉第二个 Mutation batch；未改任何计数公式（未减半/减一）；未删用户空行；未无条件延迟 250ms；未扩大去重窗口；未覆盖生产全局插件；未改测试文档迎合断言；未写死 Typora 版本。

## 2. 为什么这样修（可被证据支撑的最小改动）

- dry-run 是**纯取证**仪器（产 `PAINT_LAYER_CALIBRATION` / `BLANK_ROW_FRAGMENT_CLOSURE` 审计与验收覆盖率计数），**不参与**任何发布计数、Drawer 文案、视觉几何或诊断 Store。
- 证据（PROVEN）显示：它在每次提交往 `#write` 插入 4 个 DIV，且在 Enter 回声窗口内早于第二次 split。因此在回声窗口（真实 Enter 后 250ms 有界）内**保持它不写内容文档**，即可移除「插件写入 → 原生再归一化 → 第二次 split → 多余空行」链条，而**不改变任何用户可见计数或视觉**。
- 该改动是**可判错**的：`HOLD-3` 断言门必须出现在 `ensureLocateDocumentLayer()` 之前，一旦被删除/后移即 FAIL。

## 3. 测试

新增 `document-diagnostic-blank-row-acceptance-hold-v1.test.ts`：
- `HOLD-1`：写在门**只在**武装窗口内激活（窗口外为 false）。
- `HOLD-2`：被记录写入携带节点+父容器指纹（`parent=DIV.inkchapter-locate-document-layer`）。
- `HOLD-3`（源码契约，可判错）：`runBlankRowPaintLayerAcceptanceDryRun` 内 `isContentDocumentWriteHoldActive()` 必须**先于** `this.ensureLocateDocumentLayer()`，且存在 `DOCUMENT-DIAGNOSTIC-BLANK-ROW-DRYRUN-HELD` 审计。

> 说明：`runBlankRowPaintLayerAcceptanceDryRun` 在 jsdom 下被 `isHeadlessTestRuntime()` 短路，故其**运行时副作用**无法在单测中直接触发；因此行为门由 `HOLD-1/2` 覆盖，入口门由 `HOLD-3` 源码契约覆盖。两类反例（「一次 Enter 两次 Split 但最终正确」vs「一次 Enter 最终错误」）属运行时语义，需真实按键，记为 **PENDING_USER_RUNTIME**，未以相同断言冒充。

## 4. 命令与结果

| 命令 | 结果 |
|---|---|
| `tsc --noEmit` | **exit 0（PASS）** |
| `vitest run`（targeted：tracer + hold） | **2 files / 8 tests PASS** |
| `pnpm run test`（全量） | **235 files / 4479 tests PASS** |
| `pnpm run build`（`ARCHIVE VERIFY=PASS`） | **exit 0（PASS）** |

## 5. 构建与部署 SHA

| 项 | 值 |
|---|---|
| dist/main.js（R2 终态） | `A337D6DF91E7B4171A9C214FF109DD8A5EA6E5F98140310F7579DDD529A549FF` |
| dist/style.css | `506B3E639B4BC33827FD914B53CAA8E57F0957460D0927B2A495F9B4D9319EE8` |
| 测试 vault 部署 | `A337D6DF…`（MATCH） |
| 全局生产 | `DE62CB1A…`（未改） |
| **运行实例实际加载** | `A337D6DF…`（**已受控重载并自证**，`loadSource=vault`） |

## 6. 已验证 / 未验证

**已验证（本轮）**：
- 4 条结构写入归因（PROVEN，含独立 provenance 交叉验证）；
- 旧「原生/plugin=0」结论被推翻；
- 静态门（tsc + 全量测试）PASS；构建 + 测试 vault 部署 SHA MATCH。

**未验证（诚实声明）**：
- **文末（EOF）** 场景的真实 Enter 干净测量（本轮 2 次成功 Enter 均在正文中部；`Ctrl+End` 注入未能稳定移到文末空白段）→ 需 1 步人工复核；
- Drawer 实际 DOM 文本逐字比对、EOF 像素几何、滚动/拖拽/缩放（R02–R05）→ **NOT_RUN**。

## R2 — 第二轮（生产硬关闭 + 真实运行验收）

### R2.1 新增/修改入口

| 文件 | 入口 | 改动 | 理由 |
|---|---|---|---|
| `src/document-utilities/document-utility-overlay-host.ts` | 新增字段 `blankRowAcceptanceDryRunEnabled: boolean = false` | 生产默认**关闭** DOM 修改型验收探针 | 用户要求「必要时彻底关闭」；探针仅取证，不影响任何计数/视觉/诊断 |
| 同上 | `runBlankRowPaintLayerAcceptanceDryRun()` | 增加「生产禁用」审计早退（`DOCUMENT-DIAGNOSTIC-BLANK-ROW-DRYRUN-DISABLED`）；保留回声窗口 hold 作纵深防御 | 不再反复干扰 `#write` |
| `src/document-utilities/document-diagnostic-blank-row-acceptance-hold-v1.test.ts` | `HOLD-3` | 断言「生产禁用门」+「窗口门」都先于 `ensureLocateDocumentLayer()`，且默认值为 false | 可判错 |

### R2.2 其他正文写入载体盘点（用户要求 #5）

`document-utility-overlay-host.ts` 中写入 `#write` 子树的写入族（全部**持久节点**，非「插入即移除」）：
`ensureLocateDocumentLayer`（一次性）、`commitDocumentSpaceCarrier`、`collectHeadingMarkerGroups`、`paintOneSecondaryHeadingActiveFill` / `renderHeadingActiveEmphasisFromAuthority`、`syncCommittedCarrierCaptionCue`、`buildBlankRowFragmentEls`、`commitBlockGapVisual`、`commitBlankSpaceWarningBand`、`runBlankRowPaintLayerAcceptanceDryRun`（本轮已关）。
→ 真实运行中这些载体仍在（provenance 仍见 `pluginOwnedAddedCount=4`），但**新构建下未再诱发第二次 split** ⇒ 只有 dry-run 的「插入+移除」瞬态是触发器。
**因此不声称「反馈环已被普遍消除」**：只声称「已证明的写入源（dry-run）已从生产移除，且真实 Enter 不再出现第二次 split」。其余载体在**真实编辑**中未见诱发，但其在其它路径的潜在影响未经对照证明。

### R2.3 真实运行结果（详见 RUNTIME-ACCEPTANCE）

- 实际加载 SHA `A337D6DF…`（受控重载成功，修正上一版「从未真实运行」的缺陷）；
- 真实 Enter（扫描码注入，`isTrusted`/`code=Enter`/`ALLOW_NORMAL_ENTER`）2 次：**各 1 次 split、`+2 字节`、`termLF` 不变、`ENTER-DUPLICATE-SPLIT-AFTER-FINAL`=0、`PAINT-LAYER-CALIBRATION`=0**；
- 对照旧构建同会话：每次 Enter 2 次 split、净 +4 LF、duplicate=3。

## 7. 附带发现（未修，避免越界）

`scripts/deploy-test-vault.ps1` 使用 `Get-Content $ManifestSrc -Raw`（PowerShell 5 默认 ANSI）读取含中文的 `src/manifest.json`，触发 `ConvertFrom-Json : Invalid object passed in` 而中止部署。本轮改用等价的手工 `Copy-Item` 部署并逐项校验 SHA（不修改用户 WIP 脚本）。建议后续将该行改为 `-Encoding UTF8`。
