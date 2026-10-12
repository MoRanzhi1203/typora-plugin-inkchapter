# ENTER-EOF-ROOT-CAUSE

> 阶段 4/5 交付物。根因定性与证据等级。证据来源：`inkchapter-enter-echo-trace.json`、`audit/runtime-sess-1791791639996.log`、生产源码。

## 1. FIRST_PROVEN_DIVERGENCE

**第一次被证明的真实分叉点**：`runBlankRowPaintLayerAcceptanceDryRun`（`src/document-utilities/document-utility-overlay-host.ts`）。
它在**每次诊断提交**时，向**活动内容文档 `#write` 的 paint layer** 插入探针节点（1 个 `container` + N 个 `fragment` DIV，随后移除）。当该提交落在 **Enter 回声窗口**内时，这 4 个节点插入发生在 Typora 第二次 `SPLIT_1_TO_2` **之前约 108–119ms**。

时间线（`NENTER-3-1791792211233`，Enter=08:03:31.232）：

| 相对时刻 | 事件 | 证据 |
|---|---|---|
| .232 | `KEYBOARD-EVENT-PROVENANCE` / `ENTER-ADMISSION-AUDIT`（真实 Enter） | audit log |
| .260 | 第一次 `SPLIT_1_TO_2`（`emb` removed P-26 / added P-28,P-29） | `EDITOR-MUTATION-BATCH` |
| .261 | `NORMAL-ENTER-FINAL` | audit log |
| .277–.294 | 诊断提交；**dry-run 插入并移除 4 个 DIV**（`PAINT-LAYER-CALIBRATION-AUDIT` .291、`BLANK-ROW-FRAGMENT-CLOSURE-AUDIT` .292） | trace 4×`struct:remove`(plugin,50/50/50/61ms) |
| .335 | 第二个 Mutation batch（22 条 childList，无段落变化） | `EDITOR-MUTATION-BATCH` |
| **.401–.402** | **第二次 `SPLIT_1_TO_2`**（`emb` removed P-28 / added P-30,P-31），批次带 `pluginOwnedAddedCount=4 pluginOwnedRemovedCount=1` | `EDITOR-MUTATION-PROVENANCE-AUDIT`+`BATCH` |
| .403 | `ENTER-DUPLICATE-SPLIT-AFTER-FINAL`（`windowMs=142`, `endBlockRenormalization=true`） | audit log |
| .448 | 源码 `rev7(1064) → rev8(1066)`，**+2 LF** | `DOCUMENT-TRAILING-BLANK-AUDIT` |

## 2. 机制（为什么这会造成「空行增加异常」）

1. 真实 Enter → Typora 原生拆分文末段落（**第一次 split**，内容 +2 LF）。
2. 该 mutation 触发插件提交；提交期 `runBlankRowPaintLayerAcceptanceDryRun` 往 `#write` 内插入 4 个 DIV 探针 → 触发 Typora 的 MutationObserver。
3. Typora 的块模型对 `#write` 子树内的外来子节点插入做出**尾块再归一化**（`endBlockRenormalization=true`），产生**第二次 `SPLIT_1_TO_2`**（在当前语境内等价于对文末段落再做一次 Return）。
4. 第二次 split 又给内容加了一个空段落 → 源码 **+2 LF**（`rev7→rev8`）。
5. 净结果：**一次 Enter = 两次 split = +4 LF = 多出一整条可见空行**。

## 3. 证据等级

| 断言 | 等级 | 依据 |
|---|---|---|
| 回声窗口内存在插件来源的结构写入（4×`remove`，来自 dry-run 帧） | **PROVEN** | trace 原始记录 |
| 两个 `SPLIT_1_TO_2` 批次携带 `pluginOwnedAddedCount=4`（=dry-run 容器+3 fragment） | **PROVEN** | 插件自带 provenance 审计（独立源） |
| 第二次 split 后源码 `+2 LF` | **PROVEN** | `DOCUMENT-TRAILING-BLANK-AUDIT`（`rev7=1064 → rev8=1066`） |
| 「dry-run 写入 → Typora 再归一化 → 第二次 split」的因果链 | **INFERRED（强时序 + 机制 + 独立交叉验证）**；缺 C0/C1 对照 |
| `+2 LF/次 split` 本身是否原生正确 | **UNKNOWN**（无 C0 基线） |

因此：`ROOT_CAUSE_EVIDENCE_LEVEL = PROVEN_WRITE_INFERRED_CAUSAL`。

## 4. 被推翻的旧结论（必须显式记录）

- 旧文档 `ENTER-DUPLICATE-ROOT-CAUSE.md` 结论：「第二次 split = Typora 自身尾块重建（原生中间态）；插件**structure=0 / plugin=0**」。
- **本轮推翻**：宽域 tracer 记录 `pluginStructuralWriteCount=4`；provenance 审计独立显示 split 批次 `pluginOwnedAddedCount=4`。旧结论所依赖的 `structuralRecordCount=0` 是**仪器覆盖不足**造成的假阴性（插桩覆盖 `Node/Element` 方法 + 上一版 tracer 自身帧误配）。
- 旧「修复」（`SAME_ENTER_SCENE_IDEMPOTENT` 事务合并 + 幂等提交）只保证了**诊断提交幂等**，**并未阻止内容被第二次 split 改写** → 属于 §0 禁止的「掩盖重复写入」。本轮不再以它作为根因修复，改为**修产生多余内容的写入入口**。

## 5. 与「四条结构写入」的对应

4 条 plugin 结构写入 = 上述 dry-run 的探针移除；其**同一提交内的探针插入**（provenance 的 4 个 added）才是触发再归一化的动作。二者同源、同一入口。

## 6. 修复方向（详见 FIX-REPORT）

在 Enter 回声窗口（真实 Enter 后 250ms 有界窗口）内**禁止插件向内容文档 `#write` 做结构写入**；R2 进一步把该 DOM 修改型验收探针在**生产默认彻底关闭**（`blankRowAcceptanceDryRunEnabled=false`），仅保留窗口 hold 作纵深防御。dry-run 纯取证，不影响任何计数/视觉/诊断。

## 7. R2 — 真实运行因果确认（已闭环）

新构建 `A337D6DF…` 真实加载后，真实按键 Enter（`code=Enter`/`isTrusted`/`ALLOW_NORMAL_ENTER`）：

- **第二次 `SPLIT_1_TO_2` 消失**：全会话 `ENTER-DUPLICATE-SPLIT-AFTER-FINAL` = **0**（旧构建 3/3）；
- `DOCUMENT-DIAGNOSTIC-PAINT-LAYER-CALIBRATION` / `BLANK-ROW-FRAGMENT-CLOSURE` = **0**（探针已不在生产运行）；
- 单次 Enter 净源码 = **+2 字节**（一次 split），`terminalNewlineCount` 不变（旧构建 +4 LF）；
- 插件 overlay 载体仍在（provenance 仍见 `pluginOwnedAddedCount=4`）但**未再诱发** split ⇒ 触发者是 dry-run 的「插入+移除」瞬态，而非持久 overlay 节点。

因果链由 **跨构建对照** 支持（同文档/同 vault/同 Enter 通道，唯一变量 = 探针开关）：`ROOT_CAUSE_EVIDENCE_LEVEL = PROVEN (write attribution) + CONFIRMED_AB (runtime)`。

## 8. R3 — 文末复核推翻 §7（结论修正）

**§7 的 CONFIRMED 仅对正文中部 Enter 成立。** 文末（EOF）复核：

- C0（原生，插件禁用）1 次文末 Enter → **+2 LF / 1 次 split**；C4（新构建，探针关）→ **+4 LF / 2 次 split**。
- 但新构建 trace：`pluginStructuralWriteCount:0 / structuralRecordCount:0`（回声窗口内**无任何插件 DOM 写入**），14 条全为 Typora 对 `P.md-end-block` 的属性写入，来自**两条不同的 `Editor.pressReturn` 路径**。

**修正后结论**：
1. 文末重复 split **确由墨章引起**（C0≠C4），但**不是**由插件 DOM 结构写入引起（已证伪 dry-run 路径）。
2. `FOUR_STRUCTURAL_WRITE_ORIGINS`（旧构建 4 条 plugin `remove`）是**探针自身的移除**，与触发无关 → 早期「4 条写入 ⇒ 根因」的推断被 R3 证伪。
3. `ROOT_CAUSE_EVIDENCE_LEVEL = UNKNOWN`；下一层怀疑对象：墨章在 **Enter keydown 处理链中的同步执行/事件链干预**（使 Typora `pressReturn` 序列执行两次），尚需针对性插桩。
