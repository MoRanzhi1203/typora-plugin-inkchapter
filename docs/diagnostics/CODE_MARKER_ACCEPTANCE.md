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
