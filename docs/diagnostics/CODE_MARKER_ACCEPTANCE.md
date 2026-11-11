# 代码块诊断标记锚定专项（2026-11-11）

> 分支：`feature/diagnostics-code-marker-anchor`
> 基线：`main = ffb15b9`
> 取证日志：`runtime-sess-1793625411316.log`（CB002 的 codeCarrier 记录）
> 说明：指定的 `app-1794370117715.log` 不在当前工作区；以下使用同字段的
> `codeCarrierCoveredPrimary/Secondary/OverflowPx` 真实审计记录。未伪造该日志。

## 1. 真实证据

日志字段：

```
codeVisualRuleActive=true
codeCarrierCoveredPrimary=null
codeCarrierCoveredSecondary=true
codeCarrierOverflowPx=0
visualDecision=PASS
semanticAnchorIdentity=pre#.md-fences ...
targetIdentity=code:CB002:block:code:9...
```

解释：

- `primary=null`：该代码诊断没有 caption/PRIMARY 目标（语言/空块类）。
- `secondary=true`：carrier 覆盖了**一个** `pre.md-fences`。
- 旧 gate 只要求 `primary !== false && secondary !== false`，即
  **“覆盖某个代码块”** 就 PASS；它没有证明这个 `pre` 就是
  `block:code:N` 对应的那一个，也没有区分 caption/topbar/body 的视觉目标。
- 因此 `codeCarrierCoveredSecondary=true` 只能证明“覆盖某个代码块”，
  不能证明“覆盖诊断所属的代码块”。这就是可能出现在下一个代码块/空段落上的
  false-pass 结构原因。

## 2. 根因

1. **身份缺口**：`locateCommittedSecondaryEl` 被覆盖检查使用，但没有把它与
   诊断的 canonical `block:code:N` 做等值校验；`canonicalBlockIdentityOf` 虽存在，
   只作为 locator 的 resolvedBlockIdentity，没有进入 code visual gate。
2. **覆盖语义错误**：旧 gate 对 CODE_MISSING_NAME/LANGUAGE 都要求覆盖整个
   `pre` body；这迫使 marker 使用整个代码块，无法安全落到“题注/顶栏”区域。
3. **没有可采证的 owner**：frame DOM 没有 `data-diagnostic-id`、
   `data-code-target-identity`、`data-marker-owner-identity`，验收只能看覆盖率，
   无法区分“目标正确”和“覆盖了相邻代码块”。

## 3. 修改

### 3.1 身份校验（production）

`document-utility-overlay-host.ts` 的 code visual closure 增加：

- `expectedCodeIdentity`：诊断 `location.kind='block-node'` + `blockKind='code'`
  的 `stableIdentity`（`block:code:N`）。
- `markerOwnerIdentity`：`canonicalBlockIdentityOf('code', secondaryEl)` 的实时 DOM 枚举。
- `codeTargetBindingDecision = MATCH | MISMATCH | NOT_VERIFIED | NOT_APPLICABLE`。
- `codeVisualScopeOk` 只在 `MATCH`（或非 code 的 N/A）时允许 PASS；
  `MISMATCH` / `NOT_VERIFIED` 触发 `DOCUMENT-DIAGNOSTIC-CODE-TARGET-IDENTITY`
  audit 并阻止 visual PASS/COMMIT。

### 3.2 覆盖语义按 paint kind

新增 `CODE_TOPBAR`：

- `CAPTION_ONLY`：要求 carrier 覆盖 caption/PRIMARY，不要求覆盖整个 body。
- `CODE_TOPBAR`：要求 carrier 覆盖真实 `.inkchapter-content-toolbar--langbar`，
  不要求覆盖整个 body。
- `BLOCK_BODY`：才要求覆盖 `pre` secondary。

这样 topbar marker 不会因为“没覆盖整个代码块”被误判，也不会用 fixed
top/margin 把 marker 推到下方。

### 3.3 真实顶栏测量

新增 `measureCodeTopbarRect(anchor)`：

- 只查 `anchor.querySelector('.inkchapter-content-toolbar--langbar')`；
- 实时 `getBoundingClientRect()`；
- 不可测 → 返回 null，回退 body，不发明 fixed offset。

`CODE_MISSING_NAME`：

- 有 owned caption → `CAPTION_ONLY`；
- 无 caption → 真实 langbar → `CODE_TOPBAR`；
- 两者都不可测 → `BLOCK_BODY`。

`CODE_MISSING_LANGUAGE` / `CODE_EMPTY_BLOCK`：

- 真实 langbar → `CODE_TOPBAR`；
- 否则 `BLOCK_BODY`。

### 3.4 DOM 证据属性

code frame 新增：

```
data-diagnostic-id="..."
data-code-target-identity="block:code:N"
data-marker-owner-identity="block:code:N"
data-code-target-binding="MATCH|MISMATCH|NOT_VERIFIED"
data-paint-kind="caption-only|code-topbar"  (when applicable)
```

不改变 Markdown、题注、语言栏、折叠/复制按钮。

## 4. 修改前后 DOM / 定位差异

| 项 | 修改前 | 修改后 |
|---|---|---|
| 目标身份 | 无 frame owner 属性 | `data-code-target-identity` + `data-marker-owner-identity` |
| gate | 覆盖任意 `pre` 即可能 PASS | 必须 `MATCH` 才 PASS |
| 覆盖对象 | 整个 body（语言/空块） | langbar / caption / body 按 paint kind |
| 目标区域 | body 坐标（可能偏移） | 真实 langbar 的 `getBoundingClientRect` |
| 不可测 | secondary 覆盖可默认 PASS | `NOT_VERIFIED`，不渲染误导标记 |

## 5. 测试

新增/调整：

- `document-diagnostic-code-empty-block-generic-pipeline.test.ts`
  - frame 带 `block:code:0` / owner / MATCH / diagnostic-id；
  - 真实 langbar → `data-paint-kind=code-topbar`、身份 MATCH。
- 既有 code empty/locate/drawer/visual closure 定向：92 tests PASS。
- 全量见执行日志。

## 6. 真实 GUI 采证

运行：

```js
// DevTools Console
// 粘贴 docs/diagnostics/CODE_MARKER_ACCEPTANCE_DEVTOOLS.js
```

字段：

`documentKey`、`diagnosticId`、`targetIndex`、`canonicalCodeIdentity`、
`markerOwnerIdentity`、`actualTargetIdentity`、`codeRect`、`captionRect`、
`topbarRect`、`diagnosticMarkerRect`、`markerComputedStyle`、`layoutEpoch`、
`renderedPosition`、`anchorDecision`、`nextCodeBlockOverlap`、
`blankParagraphOverlapCount`、`verdict`。

判定：

- `PASS`：owner === expected、frame 在目标区域、无下一代码块/空段落交叠。
- `FAIL`：身份不一致、覆盖下一代码块/空段落、或 marker 不在目标区域。
- `NOT_VERIFIED`：frame/目标不可测、不可见。

当前会话未启动 Typora（`Start-Process` 失败），因此 GUI 项为
**NEEDS_MANUAL**，未把 jsdom 结果写成真实 GUI 通过。

## 7. 仍需人工

1. 在真实 Typora 打开 `Document-Diagnostics-Code-Integrity-Test.md`。
2. 激活代码诊断（缺少名称/语言/空块）。
3. 粘贴 `CODE_MARKER_ACCEPTANCE_DEVTOOLS.js`，保存 JSON + 截图。
4. 特别检查：4 个连续代码块、前后空行、有/无题注、`codePosition=above/below`、
   折叠、100/125/150% DPI、深浅主题、多文档切换。
5. 若 `verdict=FAIL`，记录 `expectedCodeIdentity`/`markerOwnerIdentity`/
   `nextCodeBlockIdentity`，不要用 CSS 偏移掩盖。

## 8. 本轮验证结果

- 定向：`document-diagnostic-code-empty-block-generic-pipeline.test.ts` **11 tests PASS**；
  代码块/定位/抽屉/视觉闭合定向集 **92 tests PASS**。
- 全量：**338 文件 / 5907 tests PASS**，164.00s；TSC / 隐私 / 文档 PASS。
- 构建：PASS，`dist/main.js` SHA256
  `3733016B5506E2453FE1F8480F9E7AC6F91A23A165174205BC2022614FBE7913`。
- 已复制到 `test/vault/.typora/plugins/dist/main.js`（同 SHA）。
- 当前 Typora 未运行；`inkchapter-runtime-load.json` 仍是上一次 `17E64A2…` 的
  加载记录，**新构建尚未真实加载**。GUI 项因此仍为 **NEEDS_MANUAL**。

## 9. P0 回归修复（2026-11-11 第二轮，标记消失）

### 9.1 真实根因

上一轮把 `CODE_MISSING_NAME` / `CODE_MISSING_LANGUAGE` / `CODE_EMPTY_BLOCK`
的 `preciseRect` 改成了 `measureCodeTopbarRect(anchor)`，即**可见载体只有约
30px 的语言栏**。生产链路里：

1. `verifyOneClickPaintedVisual` → `verifyOneClickLocateVisual` 要求 painted
   rect 与可见编辑器**交集 > 0**（`PAINTED_OUTSIDE_VISIBLE_EDITOR`）；
2. 高代码块被居中/滚动后，语言栏这一行可以完全在可见区之外；
3. 失败 → 同一事务内有界重试 → `ONE_CLICK_VISUAL_FAILED` →
   `teardownDiagnosticInteraction` 回滚 → **标记被清除**。

`NOT_VERIFIED` 本身只影响 `codeVisualScopeOk` 审计，不是移除标记的直接分支；
但它没有安全降级，也没有把定位器返回的节点纠正到 canonical 代码块。
另外 `data-paint-kind` 的 `else` 在上一轮被错误绑定到 `if (code)`，会造成
BLOCK_BODY 之后残留 `caption-only`（透明）状态。

### 9.2 修复

- 恢复 `BLOCK_BODY` 为三种代码规则的可见载体；`currentCodeTopbarRect`
  仅作为 closure 证据，不再作为唯一绘制目标。
- 提交前按 `location.stableIdentity` 解析 canonical `block:code:N`；
  定位器返回相邻代码块时纠正锚点并发出
  `DOCUMENT-DIAGNOSTIC-CODE-ANCHOR-CANONICAL-CORRECTION`。
- `commitDocumentSpaceCarrier`：`BLOCK_BODY` 只使用代码块自身矩形，
  不再与题注 union（避免“标记落到代码块下方”）。
- 拆分 `codeMarkerVisible`（可见性）与 `codeMarkerBindingState`
  （`BOUND_BODY` / `BOUND_CAPTION` / `PENDING_LAYOUT` / `IDENTITY_CONFLICT` /
  `NO_TARGET`）；`NOT_VERIFIED` 保持可见但审计为 `DEGRADED`，不伪造 PASS。
- 修正 `data-paint-kind` 的生命周期。

### 9.3 回归测试

新增 `document-diagnostic-code-marker-visibility-v1.test.ts`（先失败后修复）：

- 真实 langbar 存在时，三种代码规则的标记高度必须覆盖代码块本体（修复前 34px）；
- langbar 后挂载不得移除/缩小标记；
- 4 个连续代码块只有目标块有标记；
- 定位器给错相邻块时必须纠正回 `block:code:0`。

结果：修复前 5 failed；修复后该套件 6/6 PASS，
`document-diagnostic-code-empty-block-generic-pipeline.test.ts` 11/11 PASS，
`document-diagnostic-locate-document-space-v511…` 29/29 PASS。

### 9.4 全量 / 构建 / 部署

- 全量：**339 文件 / 5913 tests PASS**（181.98s，最终代码）。
- TSC：PASS；`verify:archive` / `docs:verify` / `verify:image-privacy`：PASS。
- BUILD：`dist/main.js` `2D7DE822CDAB2A3EF3559DED1D084DF0861666AE2AFE08EC2FF5E163D9CD7D7A`；
  `dist/style.css` `EBEDF8A9BC567584C7F94B8F2AB8EDCBC4E30AB619ABF5676B1A05A32811A3DD`（未改 CSS）。
- DEPLOY：`test/vault/.typora/plugins/dist/main.js` 同 SHA（`deploy-test-vault.ps1` 校验通过）。
- RUNTIME_LOAD：真实 Typora 已加载最终构建
  （`mainJsSha256=2D7DE822…`，`loadSource=vault`，`initializationCount=1`，
  `loadedAt=2026-11-11T11:25:51.576Z`）；`Document-Diagnostics-Code-Integrity-Test.md`
  已打开，插件面板显示 `错误 0 / 警告 10 / 提示 0`，语言栏（TXT/TS + 复制按钮）正常。

### 9.5 真实 GUI 状态：NEEDS_MANUAL（仅“点击后的标记像素/DOMRect”）

最终构建已真实加载（见 9.4）。但本轮无法取得“点击代码诊断后同屏截图 + marker DOMRect”：

- `--remote-debugging-port=9222` 不开放 CDP；
- DevTools 控制台虽可打开，但桌面焦点被其他应用（微信/Trae）抢占，
  自动化输入无法稳定落到控制台提示符，无法可靠执行只读测量脚本。

因此**不宣布 GUI 标记验收通过**，也未合并到 `main`；需要用户按下列最小步骤确认一次。

最小人工步骤：

1. 关闭 Typora，然后在测试 vault 目录执行
   `Typora.exe D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault`；
2. 打开 `Document-Diagnostics-Code-Integrity-Test.md`，点击“缺少语言/缺少名称/空代码块”；
3. 确认标记覆盖**该代码块本体**，不越过下一个代码块或空段落；
4. 在 DevTools Console 粘贴 `CODE_MARKER_ACCEPTANCE_DEVTOOLS.js`，保存 JSON + 截图；
5. 若 `data-code-target-binding=MATCH` 且 `verdict=PASS`，再合并分支；否则附 JSON 返回。
