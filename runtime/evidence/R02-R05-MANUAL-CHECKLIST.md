# R02–R05 人工确认清单（墨章 · 统一几何事务）

> 对应任务：`docs/prompts/pending/TRAE-INKCHAPTER-UNIFIED-VISUAL-GEOMETRY-TRANSACTION-CLOSURE.md` §7 R02–R05
> 适用构建：`dist/main.js = 4D3FA255EBCCA44215A28C0E0874253306685F87A0B6095A372A8303244305ED`（vault 已部署并真实加载，`initializationCount=1`）
> 测试文档：
> - `test/vault/Document-Diagnostics-Code-Integrity-Test.md` —— 含 **heading 诊断**（标题被动高亮 + 右侧标签），用于 R02–R05 的标题/chip 观察
> - `test/vault/runtime/smoke/Document-Diagnostics-Empty-Block-Presentation-Test.md` —— 只产生 **代码/空行** 诊断（`CODE_EMPTY_BLOCK` 等），用于代码块观察
>
> 状态：**R04/R05 数值部分已通过（见 §7 已知良好值）；R02–R05 的像素级判读为 PENDING（需人工）**
> 关联证据：`runtime/evidence/typora-appearance/r06-newbuild-code-integrity.png`；审计会话 `runtime-sess-1791565067680.log`

---

## 0. 准备

- [ ] Typora 窗口保持**最大化**，先打开 `Document-Diagnostics-Code-Integrity-Test.md`；右侧 Drawer 打开。
- [ ] 需要同时观察 **Active + Passive** 时：点 Drawer 中「连续空行过多 / H1 前有其他内容」行使其进入激活态（Active）；只想看被动标记则保持 IDLE。
- [ ] 记录初始窗口宽度与 H1 位置（截图留档）。

> 说明：Code-Integrity 文档较短（`maxScrollTop≈767`），“滚动 1000px”会**滚到底并夹止**——**滚到文档底部即视为满足 R02/R03 的滚动意图**。
> R04/R05 的“侧栏/宽度改变”可用**拖原生侧栏**，或执行项目脚本 `scripts/resize-typora-window.ps1`（真实 `SetWindowPos` 改变窗口宽度）。

---

## 1. R02 —— 不点击，直接向下滚动 ~1000px（滚到底）

**操作**：鼠标移到**正文区**（避开右侧 Drawer、左侧文件树），滚轮向下滚到文档底部；中途**不要点击**。

| 编号 | 观察对象 | PASS 判据 | 结果 |
|---|---|---|---|
| A1 | H1 被动高亮 | 浅色高亮**紧贴标题文字**（非整行/整块底纹），与标题**同步**移动，无滞后/残影 | ☐ PASS ☐ FAIL |
| A2 | H1 右侧标签（reason chip） | 跟随标题；同行放不下时**合法换到标题末行下方**，且**不压相邻段落**、不越出编辑区宽度 | ☐ PASS ☐ FAIL |
| A3 | 「连续空行过多」区间高亮（Active 时） | 淡黄区间**恰好覆盖那 3 个空行**，右侧数量标签正确；滚动中同步 | ☐ PASS ☐ FAIL ☐ N/A |
| A4 | 代码块标记（`CODE_MISSING_NAME` / `CODE_MISSING_LANGUAGE`） | 高亮/边框**只覆盖该代码块**，不扩展到前后正文 | ☐ PASS ☐ FAIL |
| A5 | 文档末尾标记（尾部空行过多 / 缺少末尾换行 `EOF`） | 位于真实可视尾部；`EOF` 为**端点形态**，不铺满剩余视口 | ☐ PASS ☐ FAIL |
| A6 | 光标与选区 | 点正文输入 1 个字符再 `Ctrl+Z` 撤销，光标/选区正常，未被覆盖层遮挡 | ☐ PASS ☐ FAIL |
| A7 | 观感稳定性 | 滚动过程**无大面积闪动/抖动**、无标记“跳一下再回来”（滚动应为惰性，不每帧重建） | ☐ PASS ☐ FAIL |

**记录**：实际滚动像素 __________；截图 __________

---

## 2. R03 —— 反向滚动（从底部滚回顶部）

**操作**：从底部滚回顶部（反向 ~1000px）。

判定：复用 A1–A7，并追加：

| 编号 | 判据 | 结果 |
|---|---|---|
| B1 | 回到初始位置后，标记位置与**初始一致**（无累积偏移、无“回不去”的残影） | ☐ PASS ☐ FAIL |
| B2 | 反向过程中同样无闪动/抖动、无重建迹象 | ☐ PASS ☐ FAIL |

---

## 3. R04 —— 侧栏/窗口 小 → 大

**操作**：把窗口宽度由窄拖到宽（或 `resize-typora-window.ps1 -Widths "700,900,1100,1300"`），**每档停留 1–2 秒**。

| 编号 | 观察对象 | PASS 判据 | 结果 |
|---|---|---|---|
| C1 | 标题被动高亮 | 每一档宽度下都**重新贴合**标题文字（无停留在旧宽度的位置），误差肉眼不可见 | ☐ PASS ☐ FAIL |
| C2 | 标题右侧标签（chip） | 宽度变大后**回到同行右侧**（`visualLabelRight + 间距`）；若某档空间不足则**合法换到下一行**，两种形态都必须在标题的可视区域内、不压相邻段落 | ☐ PASS ☐ FAIL |
| C3 | 无残影/重复 | 旧宽度的 chip / 高亮**不残留**；同一标题只有**一份**标记 | ☐ PASS ☐ FAIL |
| C4 | 层级与光标 | 标记**不盖住 Drawer / 工具栏**；正文/光标列**无竖条或边界线** | ☐ PASS ☐ FAIL |
| C5 | 光标与选区 | 点击正文可正常定位，输入 1 字符 + `Ctrl+Z` 正常 | ☐ PASS ☐ FAIL |
| C6 | 流畅度 | 拖拽/调整过程中**无闪动、无冻结**，窗口保持响应 | ☐ PASS ☐ FAIL |

---

## 4. R05 —— 侧栏/窗口 大 → 小

**操作**：把窗口宽度由宽拖回窄（或 `-Widths "1300,1100,900,700"`）；建议再往返 1–2 轮。

| 编号 | 判据 | 结果 |
|---|---|---|
| D1 | 回到窄宽度后，标记**回到窄宽度布局**（chip 若需换行则正确换行），无残留、无偏移 | ☐ PASS ☐ FAIL |
| D2 | 大小往返 2–3 轮后**无累积偏移**（与首轮同宽度时的位置一致） | ☐ PASS ☐ FAIL |
| D3 | 若 Drawer 打开：Drawer 内容**不被标记覆盖**，抽屉滚动/选中不受影响 | ☐ PASS ☐ FAIL |

---

## 5. 通用失败判据（任一命中即 **FAIL**）

- [ ] 标记相对目标**肉眼可见错位**（滞后、跨块、覆盖相邻段落/代码/图片）
- [ ] 出现**残影**（旧位置残留）或**重复标记**
- [ ] 标记**盖住 Drawer / 工具栏**；或在正文/**光标列**出现竖条 / 边界线
- [ ] 滚动或拖拽时**整窗卡顿 / 无响应**
- [ ] Drawer 选中项与正文高亮**不一致**

---

## 6. 参考基线（“对”的样子）

- 被动标题：**文字紧贴的淡色底纹 + 右侧标签**（无左侧图标 / 竖轨，无整块 wash）。
- 激活空行：**单层淡黄区间 + 右侧数量标签**，区间内**无竖条**（不压光标列）。
- 窄宽度下 chip 换到标题**末行下方**是**合法形态**（不是错位）；关键是必须落在标题可视区域内、不压相邻段落。
- 严重级配色：error = 红 / warning = 琥珀 / info = 蓝灰。

---

## 7. 交叉校验（部分已实测，其余可代做）

**本轮已实测（真实 Runtime，构建 `4D3FA255…`，会话 `runtime-sess-1791566504077.log`）**
在 `Document-Diagnostics-Code-Integrity-Test.md` 上执行 **6 次真实窗口宽度变化**（客户端 685→885→1085→1285→1085→685），共 **24 次 reconcile**：

- `HEADING-REASON-CHIP-STABILITY-AUDIT`：24 次 / **0 FAIL**（`failedChecks: NONE`）
- `VISUAL-REFLOW-AUDIT`：24 次 / **0 FAIL**；`maxTargetVisualDriftPx=0`；**已无 `LAYOUT_EPOCH:PLUGIN_DOM_MUTATION` 触发的全量 heading 重建**
- `VISUAL-CLOSURE-AUDIT`：24 次 / `gateDecision=FAIL` **0 次**（34 项 gateCounters 全 0）
- 15 项 reason-chip 门禁**全 0**：`reasonChipAnchorAuthorityMismatch=0`、`reasonChipVerticalFallback=0`、`nonDirtyHeadingVisualRemeasure=0`、`nonActiveHeadingRebuiltOnNonHeadingSwitch=0`、`pluginDomMutationGlobalHeadingReflow=0`、`crossDocumentHeadingVisualFact=0`
- 对齐：`passiveFragmentRects == currentHeadingTextRects`（逐矩形 0px），`reason=TEXT_TIGHT_COVERAGE_OK`
- Typora `Responding=True`，无冻结

> 结论：R04/R05 的**数值部分 PASS**（宽度变化下标记重建正确、无越界、无旧残影计数）；仅剩像素判读需人工。

**滚动场景待人工后可由执行方代读**最新 `test/vault/.typora/inkchapter/audit/runtime-sess-*.log`：

- [ ] 滚动期间**新增事件应为 0**（`scrollGeometryRebuild=0`，无 reflow/remeasure/resolve）
- [ ] `VISUAL-CLOSURE-AUDIT` `gateDecision=PASS` 且 34 项全 0
- [ ] `DOCUMENT-UTILITY-BCR.writeRect.top` 随滚动单调变化，而标记矩形（`passiveFragmentRects`）保持不变
- [ ] 标记 ↔ 目标逐矩形相等（`passiveFragmentRects == currentHeadingTextRects`，0px），`reason=TEXT_TIGHT_COVERAGE_OK`

---

## 8. 已知环境限制（为何像素判读必须人工）

- Typora 的 Electron 编辑区**不暴露给 Windows UI Automation**（`get_app_state` 仅返回菜单栏 + 空 `pane id=20`）；
- 注入的真实滚轮（Win32 `mouse_event`）与 computer-use `scroll` 均**未真正滚动编辑区**（探针读回 `writeRect.top` 停在文档顶部）；
- 执行方**无法读取图像**，像素级判读不可自动化（窗口宽度变化可自动执行，滚动不可）。

因此 R02–R05 的最终视觉判定以本清单的人工结论为准；在完成前整体 `FINAL_DECISION = PENDING_USER_RUNTIME`。

---

## 9. 结论

- R02（滚动 1000px）：☐ PASS ☐ FAIL ☐ PENDING
- R03（反向滚动）：☐ PASS ☐ FAIL ☐ PENDING
- R04（小→大）：☐ PASS ☐ FAIL ☐ PENDING 　（数值部分已 PASS，见 §7）
- R05（大→小）：☐ PASS ☐ FAIL ☐ PENDING 　（数值部分已 PASS，见 §7）
- 验收人 / 时间：__________
- 备注：__________

---

## 10. 载体排查追加 —— EOF 带 与 标题范围背景（本轮）

> 适用构建：`dist/main.js = D85EDDE08453142A63E50685483B7A92190AB5AE80FD8A7C72621014AC66F6EC`
> （vault 已部署并真实加载：`runtime-load.mainJsSha256=D85EDDE0…`、`initializationCount=1`，
> 会话 `runtime-sess-1791701867926.log`；本轮**代码级**已验证，像素级仍为 PENDING_USER_RUNTIME）

### 10.1 排查结论（静态 + 测试）

| 载体 | 结论 | 依据 |
|---|---|---|
| **EOF 带**（`DOCUMENT_TERMINAL_NEWLINE_MISSING` / 尾部空行过多） | **原为未覆盖**：几何仅在 `commitSyntheticEofVisual`（locate/scroll 路径）写入，编辑器宽度变化无语义重求导；闭合审计亦为**自引用**（取 `lastDocEndVisual` 存储值）。已修：① `EDITOR_LAYOUT_INVALIDATION` 分支新增 `rederiveSyntheticEofVisualOnLayoutChange()`（与 block-gap 同一权威）；② 闭合审计新增 **live 对照** `liveContentColumnRect / liveDocumentTextColumnLeft / endBandOverhangPx / endBandAnchorDriftPx / endBandGeometryDecision`，超容差计入 `docSpaceCarrierPaintDriftGt1px` + 当前事务计数 | [document-utility-overlay-host.ts](file:///d:/TyporaPluginProjects/typora-plugin-inkchapter/src/document-utilities/document-utility-overlay-host.ts#L17256-L17264)、[同文件 rederive](file:///d:/TyporaPluginProjects/typora-plugin-inkchapter/src/document-utilities/document-utility-overlay-host.ts#L22683-L22711)、[EOF 审计](file:///d:/TyporaPluginProjects/typora-plugin-inkchapter/src/document-utilities/document-utility-overlay-host.ts#L6192-L6210) |
| **标题范围背景**（被动 fill 片段 + 激活 emphasis + chip） | **已被覆盖**：编辑器几何真实变化 → `invalidateDiagnosticVisualGeometry('EDITOR_LAYOUT_INVALIDATION')` → 合并 rAF → `renderHeadingDiagnosticMarkers()`（从 `headingVisibleFragments` **实时重测** fill/chip）+ `renderActiveHeadingEmphasisForCommittedVisual()`。无需新增通道 | [invalidate](file:///d:/TyporaPluginProjects/typora-plugin-inkchapter/src/document-utilities/document-utility-overlay-host.ts#L17235-L17238)、[reconcile rAF](file:///d:/TyporaPluginProjects/typora-plugin-inkchapter/src/document-utilities/document-utility-overlay-host.ts#L5730-L5741) |

### 10.2 人工验证步骤（EOF 带随宽度重求导）

1. 打开含「尾部空行过多」或「文档末尾缺少换行符」诊断的文档（如 `test/vault/runtime/Document-Diagnostics-Trailing-Blank-3.md`）。
2. 在 Drawer 中**点击**该文档末尾诊断行 → 观察 `EOF` 端点 / 淡黄尾带。
3. **拖动左侧文件树与编辑区之间的分隔线**（或 `resize-typora-window.ps1`）改变编辑区宽度。

| 编号 | 观察对象 | PASS 判据 | 结果 |
|---|---|---|---|
| E1 | EOF 带随宽度重求导 | 拖拽后尾带的**左边界贴正文文本列、右边界贴内容列**，不越出编辑区、不覆盖相邻块 | ☐ PASS ☐ FAIL |
| E2 | EOF 端点形态 | `EOF` 仍为**端点/紧凑形态**，不铺满剩余视口、不盖光标列 | ☐ PASS ☐ FAIL |
| E3 | EOF 无残影 | 宽度往返 2–3 轮后仍只有**一份**尾带，无旧宽度残留 | ☐ PASS ☐ FAIL |

### 10.3 可代读的运行时证据（人工操作后）

在最新 `test/vault/.typora/inkchapter/audit/runtime-sess-*.log` 中应出现：

- [ ] `DOCUMENT-DIAGNOSTIC-EOF-LAYOUT-REMEASURE`（含 `rule` / `localRect` / `decision=REMEASURE`）
- [ ] `VISUAL-CLOSURE-AUDIT`（EOF 分支）中 `endBandOverhangPx=0`、`endBandAnchorDriftPx=0`、`endBandGeometryDecision=PASS`
- [ ] `DOCUMENT-DIAGNOSTIC-V511` 中 `docSpaceCarrierPaintDriftCurrentTx=0`

### 10.4 本轮结论

- EOF 带：**代码级已修**（重求导 + live 对照 + 门禁 + 回归用例）；像素级 ☐ PASS ☐ FAIL ☐ PENDING
- 标题范围背景：**已覆盖，无需改动**（编号 A1/A2/C1/C2 复用）
- `FINAL_DECISION = PENDING_USER_RUNTIME`（真实拖拽像素视觉未确认）

---

## 11. 根因修复 —— 尾带右缘改用 `#write` 内容区（END 宽度异常）

> 适用构建：`dist/main.js = 057774FF5D293489837F432C3DCF2BD7785252A2F2903603A5C33CEFD660B074`
> （vault 已部署并真实加载：`runtime-load.mainJsSha256=057774FF…`、`initializationCount=1`）

### 11.1 根因（实测）

尾带**左缘**用正文文本列左缘，**右缘**却用 `#write` 的 **border box** 右缘（`getBoundingClientRect()` 含内边距）→ 右侧多伸出 ≈ `#write` 右内边距（实测 **29.6px**），左右不对称、尾带偏宽：

| 提交 | 尾带 | 正文文本列 | 右溢 |
|---|---|---|---|
| tx2 | [378.8, 1141.8] w=763 | [378.8, 1112.2] w=733.4 | +29.6px |
| tx8 | [359.8, 1141.8] w=782 | [359.8, 1112.2] w=752.4 | +29.6px |

根因文件：[computeSyntheticEofGeometry](file:///d:/TyporaPluginProjects/typora-plugin-inkchapter/src/document-utilities/document-diagnostic-document-end-visual-v513-r1.ts#L324-L328) 的 `right = content.right`；[measureSemanticContentColumnRect()](file:///d:/TyporaPluginProjects/typora-plugin-inkchapter/src/document-utilities/document-utility-overlay-host.ts#L21731-L21779) 取 [resolveBusinessContentRoot()](file:///d:/TyporaPluginProjects/typora-plugin-inkchapter/src/document-utilities/document-utilities-context.ts#L123-L125) = `#write` 的**边框盒**。块间空行带经 [resolveBlockGapHorizontalExtent](file:///d:/TyporaPluginProjects/typora-plugin-inkchapter/src/document-utilities/document-diagnostic-block-gap-visual-v1.ts#L170-L173) `columnRight = contentRight` 共用同一权威 → 同样右溢。

### 11.2 修复（共享权威）

`measureSemanticContentColumnRect()` 改为返回 `#write` 的**内容盒**（边框盒水平方向减去 border + padding，再按编辑器裁剪；垂直不变）。EOF 尾带与块间空行带、EOF live 对照门禁共用此一处 → 两带右缘同步改为内容区右缘，与左缘对称。

### 11.3 验证

- `tsc --noEmit` = 0；全量 **222 files / 4273 tests 全绿**。
- 新增回归用例 [document-diagnostic-document-end-visual-v513-r1.test.ts](file:///d:/TyporaPluginProjects/typora-plugin-inkchapter/src/document-utilities/document-diagnostic-document-end-visual-v513-r1.test.ts#L1359-L1405)：`#write=[50,850]`、正文列左缘 60、右内边距 30 → 尾带 [60,820]（宽 **760**，非边框盒 790）；无内边距时退化 790（不回归）。
- 构建 `057774FF…` 已部署并在真实 Typora 加载。

### 11.4 人工验证（E1 复用）

| 编号 | 观察对象 | PASS 判据 | 结果 |
|---|---|---|---|
| E4 | 尾带右缘 | 尾带**右侧贴合正文右缘**（不再伸出 ~30px），左右对称 | ☐ PASS ☐ FAIL |

- 验收人 / 时间：__________
- `FINAL_DECISION = PENDING_USER_RUNTIME`（真实像素视觉未确认）

---

## 12. 根因修复 —— Active 代码块标记重复 + 不随滚动（ROOT_ACTIVE_DUP_CARRIER）

> 适用构建：`dist/main.js = B2F942CC6BA2D7F92746BAF048A0F2A647222F75B523FEE992AAF8585ECB5933`
> （vault 已部署并真实加载：`runtime-load.mainJsSha256=B2F942CC…`、`initializationCount=1`）

### 12.1 复现证据（旧构建，会话 `runtime-sess-1791703615548.log`）

激活 `CODE_MISSING_LANGUAGE` 后拖拽左侧文件栏（07:33:47.618 `LAYOUT-INVALIDATION-REMEASURE`，epoch 8）。同一毫秒：

- `DOCUMENT-DIAGNOSTIC-LOCATE-FRAME`：`frameCount=1`（提交后 viewport 帧**未释放**）
- `DOCUMENT-DIAGNOSTIC-LOCATE-VISUAL-GEOMETRY`：`visualCarrier=overlay-frame, frameCount=1`
- `DOCUMENT-DIAGNOSTIC-LOCATE-DOCUMENT-SPACE-AUDIT`（`LAYOUT_RECONCILE`）：
  - Primary（frame clone）`[28, 764, 735, 807]` w=707 ← 已按新布局重定位
  - Secondary `[30, 633.8, 830, 672.4]` w=**800** ← **提交期旧布局（编辑器当前宽 763.4）**

### 12.2 根因

1. **可见的重复标记**：`commitDiagnosticLocateVisual` 在布局重测时**重新挂载 pre-commit 的 viewport 帧**，而该路径没有 `commitDocumentSpaceCarrier` 的 `releaseViewportCarrier()`（点击路径才有）→ viewport 帧残留 = 第二枚标记（**viewport-fixed，不随文档滚动**）。`frameCount=1 / staleLocateFrameCount=0` 本身描述的就是这个残留，故不能作为「无重复」的证据。
2. **Secondary 几何陈旧**：`reconcileLocateDocumentSpace` 只重投影 `c.primaryLocal`，从不重测 `c.secondaryLocal` → 保留提交期矩形（宽 800 / top 落后 130px）。

### 12.3 修复

- `remeasureActiveVisualOnLayoutChange` 在 `commitDiagnosticLocateVisual` 之后**释放 viewport 帧**（doc-space 载体为唯一可见所有者）。
- `reconcileLocateDocumentSpace` 按**同一 epoch 重投影 Secondary**（从持久化的 `locateCommittedSecondaryEl` 实测；元素失效则原子清空）。
- 新增 **FINAL DOM 验收审计字段**（`primaryContainingBlock / secondaryContainingBlock / secondaryElementConnected / secondaryLocalDriftPx / viewportFrameLingeringCount`）与硬门禁 `locateViewportFrameLingeringAfterCommit`。

### 12.4 验证

- `tsc --noEmit` = 0；全量 **222 files / 4275 tests 全绿**（含代码块/长代码块/缺名称/缺语言/标题/连续空行/文末空行）。
- **red→green**：临时禁用 release → 新增用例 `strayViewportFrames()` = **1**（复现重复标记）→ 恢复后 = **0**。

### 12.5 人工验证

| 编号 | 观察对象 | PASS 判据 | 结果 |
|---|---|---|---|
| F1 | 激活 code 诊断 → 拖拽侧栏 | 代码块上**只有一枚**标记，位置贴合代码块 | ☐ PASS ☐ FAIL |
| F2 | 拖拽后滚动 | 标记**随文档滚动**，无残留/第二枚 | ☐ PASS ☐ FAIL |
| F3 | 长代码块 / 缺名称 / 缺语言 / 标题 / 连续空行 / 文末空行 | 未因修复被破坏 | ☐ PASS ☐ FAIL |

操作后可代读最新 `audit/runtime-sess-*.log`：
- [ ] **无** `DOCUMENT-DIAGNOSTIC-DUP-CARRIER-DETECTED`
- [ ] `LOCATE-DOCUMENT-SPACE-AUDIT`（`LAYOUT_RECONCILE`）中 `viewportFrameLingeringCount=0`（release 之后的门禁）
- [ ] `secondaryLocalDriftPx` 在首次 reconcile 后归 0（同 epoch 已重投影）

- `FINAL_DECISION = PENDING_USER_RUNTIME`（真实像素视觉未确认）

---

## 13. 根因修复 —— 复合题注高亮在拖拽后丢失（ROOT_COMPOUND_CAPTION_COVERAGE）

> 适用构建：`dist/main.js = 12EA332EB128646DD2DCBBE3C1B7791766438455B3C12B3B43DD58DE71EB2DDA`
> （vault 已部署；`runtime-load.mainJsSha256=12EA332E…`）

### 13.1 复现证据（会话 `runtime-sess-1791705440056.log`，`README.md` + `CODE_MISSING_NAME:block:code:0`）

| 时刻 | 事件 | 载体（document-local） |
|---|---|---|
| 07:59:44.193 | `DOCUMENT_SPACE_CARRIER_COMMITTED`（tx=7） | primary=[28.5,**198.8**,832.5,**404.8**] w=804 **h=206** ← 覆盖 **题注∪代码主体** |
| 07:59:44.186 | `LOCATE-VISUAL-INVARIANT` | frameRect h=**206.4**（题注 237.9→主体 442.3）；targetRect（代码主体）top=265.7 h=176.6；primaryMarkerRect（题注）h=24.8 |
| 07:59:53.474 | `LAYOUT_RECONCILE:LAYOUT_GEOMETRY_CHANGE`（拖拽后） | primary=[28,**225**,719,406] **h=181** ← **塌缩到代码主体，题注丢失** |

`primaryContainingBlock=DIV#`（doc layer）/`secondaryContainingBlock=DIV#write` 均正常；`viewportFrameLingeringCount=1` 为 release 前的原始证据（上一轮已修）；`secondaryLocalDriftPx=112.6 / secondaryLocalCorrected=true` 说明 Secondary 已按新布局重投影。

### 13.2 根因

`reconcileLocateDocumentSpace` 用 **`frame.getAnchorElement()`（=代码主体）** 重定位已提交载体并硬编码 pad=2，而**提交期**的载体是 **`frame.getFrameElement()`（=题注∪主体）**。于是任何布局变化都把载体塌缩到代码主体、**丢掉题注覆盖**（上一轮释放残留 viewport 帧后，这个塌缩才成为可见症状）。`visualDecision=PASS`/`frameCount=1` 都描述不到它。

### 13.3 修复

- 提交时记录 **载体↔锚点每边关系** `edgePad`（复合目标 top 为负=题注高度）与题注元素；reconcile 用 **同一关系 + LIVE 锚点** 重求导载体 → 题注+主体绑定同一布局快照。
- 新增 **真实 DOM 验收**：`captionCoveredByCarrier`（题注是否在载体矩形内）、`carrierEdgePad`、`nameSlotPrimaryPresent`；新增硬门禁 `compoundCaptionUncoveredAfterReconcile`（**增量**判定：仅当**提交期已覆盖**而 reconcile 后丢失才计，避免 headless 假阳性）。

### 13.4 验证

- `tsc --noEmit` = 0；全量 **222 files / 4276 tests 全绿**（含 CODE_MISSING_LANGUAGE / CODE_MISSING_NAME / CODE_EMPTY_BLOCK / 长代码块 / 普通代码块 / 标题 / 连续空行 / 文末空行）。
- **red→green**：旧「锚点+pad=2」求导 → 复合题注用例断言载体高度变化 **46px** FAIL；恢复后差值 ≤4px 且 `captionCoveredByCarrier=true`、门禁计数=0。

### 13.5 关于 `drawerPersistenceGateDecision=FAIL`

**并非 tx=7 触发**：tx=7 自身 `decision=PASS reason=EXPECTED_DRAWER_OVERLAY_OCCLUSION`。该字段取自**会话累计** `countersDrawerV512R3`；首次触发在 **tx=1（07:58:47.428，`document:` 级诊断）**：`drawerRequestedOpenButHiddenAfterCommit=1` + `postRestorePanelGeometryClip=1`（coverage=1）→ 累计 `postRestoreFullCoveragePanelIntersectionFatal=1`，此后每个审计恒为 FAIL。（本轮未改动该累计门禁语义。）

### 13.6 人工验证

| 编号 | 观察对象 | PASS 判据 | 结果 |
|---|---|---|---|
| G1 | 打开 README.md → 激活 `CODE_MISSING_NAME`（“代码 1-1”+下方代码块） | **题注“代码 1-1”有主强调高亮**，代码主体保留辅助高亮 | ☐ PASS ☐ FAIL |
| G2 | 拖拽左侧文件栏 | 题注高亮**不丢失、与代码主体同步** | ☐ PASS ☐ FAIL |
| G3 | 拖拽后滚动 | 复合高亮随文档滚动、无重复/残影 | ☐ PASS ☐ FAIL |

操作后可代读最新 `audit/runtime-sess-*.log`：`LAYOUT_RECONCILE` 中 `captionCoveredByCarrier=true`、`carrierEdgePad.top<0`；**无** `DOCUMENT-DIAGNOSTIC-COMPOUND-CAPTION-LOST`；`compoundCaptionUncoveredAfterReconcile=0`。

- `FINAL_DECISION = PENDING_USER_RUNTIME`（真实像素视觉未确认）

---

## 14. 复合题注高亮闭环（CODE-COMPOSITE-MARKER-RESIZE-CLOSURE）

> 构建：`dist/main.js = 454BFA515C462C1B7909C5CAA6F281BC61632752BAC3F01F028B94ED080D7831`
> 真实加载：`mainJsSha256=454BFA51…`、`initializationCount=1`（vault == project == loaded）

### 14.1 新增根因（本轮，PROVEN）

**题注 PRIMARY 子层几何停留在 commit 快照**：`commitDocumentSpaceCarrier` 以 `cloneNode(true)` 深拷贝 pre-commit frame，**连同其 caption cue 子元素**的 commit 时 left/top/width/height；而 `reconcileLocateDocumentSpace` 只重设**外层** box → 拖拽后 cue 宽度仍是旧值（实测差 **260px**），题注主强调与题注不一致/看似丢失。

- 修复：抽出纯权威 [`computeCaptionCueRect`](file:///d:/TyporaPluginProjects/typora-plugin-inkchapter/src/document-utilities/document-diagnostic-locate-frame.ts#L47-L69)（frame controller 与 host reconcile 共用）；reconcile **同帧**重求导 cue 子层（原子，无“外层已动/子层未动”的半帧）。
- 新门禁 `compoundCaptionCueUncoveredAfterReconcile`（增量判定）。
- §3.1：新增 [`resolveLiveCommittedElement`](file:///d:/TyporaPluginProjects/typora-plugin-inkchapter/src/document-utilities/document-utility-overlay-host.ts#L4705-L4719)，在 **reconcile** 与 **remeasure（`commitDiagnosticLocateVisual`）** 两处把 detached 的已提交引用按同一语义身份重解析，不在死节点上继续画；reflow 指纹改用 LIVE 锚点。

### 14.2 red→green

- 关掉 cue 重求导 → 复合题注用例断言 cue 宽度差 **260px** FAIL；恢复后 ≤2px、`captionCuePresent=true`、门禁计数=0。
- 关掉 edgePad 重求导 → 载体高度差 **46px** FAIL；恢复后 ≤4px。

### 14.3 门禁结果

- `tsc --noEmit` = 0；定向 v511 **25/25**；全量 **222 files / 4278 tests 全绿**；门禁键 **22**。
- 部署 SHA == 工程 SHA == 真实加载 SHA（`454BFA51…`）。

### 14.4 人工验收（新构建 454BFA51）

| 编号 | 判据 | 结果 |
|---|---|---|
| H1 | README.md 激活 CODE_MISSING_NAME：题注“代码 1-1”与代码正文**同时**着色 | ☐ PASS ☐ FAIL |
| H2 | 侧栏 宽→窄→宽 ×5：题注高亮**不丢失/不变形**，无第二重叠条带 | ☐ PASS ☐ FAIL |
| H3 | 拖拽后滚动/反向滚动/切换诊断再切回：无漂移、无残留旧框 | ☐ PASS ☐ FAIL |

可代读：`LAYOUT_RECONCILE` 中 `captionCoveredByCarrier=true`、`captionCuePresent=true`、`captionCuePaintedRect` 覆盖 `captionLocalRect`；无 `DOCUMENT-DIAGNOSTIC-COMPOUND-CAPTION-CUE-LOST`。

- `ACTIVE_COMPOSITE_VISUAL_GATE = UNVERIFIED`（需人工拖拽）；`DRAWER_GATE = FAIL`（会话累计计数，首次触发 tx=1）
- `FINAL_DECISION = PENDING_USER_RUNTIME_ACCEPTANCE`


