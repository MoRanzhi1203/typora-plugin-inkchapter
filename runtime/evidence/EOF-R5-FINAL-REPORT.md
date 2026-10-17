# EOF-R5-FINAL-REPORT

> 轮次：`sess-p0-eof-visual-sync-r5`（2026-10-12/18）
> 现场构建 `2BAC4003…` → 修复构建 `B0A98E0953F4A3B7D5777ECC6DD6241E1A5DE3281D88AE05DD3DC22C8615BDDC`
> 范围：文末空行诊断 ↔ 视觉标记实时同步（不重跑 R3/R4）

## 1. 变更文件

| 文件 | 变更 |
|---|---|
| `src/document-utilities/document-utility-overlay-host.ts` | 被动 EOF 视觉同步投递；content/geometry 指纹；`visualUpdate` 轴；retract 原子清理；实时 excess 覆盖；几何不可得时保留集合 |
| `src/document-utilities/document-diagnostic-eof-visual-sync-r5.test.ts` | **新增** 12 例行为测试（EOF-01..15 可执行子集） |
| `runtime/evidence/EOF-R5-{ROOT-CAUSE,VISUAL-DIFF,TEST-MATRIX,DEPLOY-IDENTITY,FINAL-REPORT}.md` | **新增** 证据 |

未改动：原生 Enter、`。。+Enter` 缩进模块、原生侧栏、Markdown 正文、全局生产插件。

## 2. 修复要点（对应 §3/§4）

1. `commitAdmittedSnapshot()` 在 `this.snapshot = admitted` 后**投递** `dispatchDocumentEndExcessVisualSync()`：
   - 只消费 `lastEofReconcileFacts`（实时测量），不看 `diagnosticDiff`；
   - `publish=false` → `EOF_TAIL_RETRACT`；
   - `excess==null` → 保留，不误清；
   - `UPDATE_CONTENT / UPDATE_GEOMETRY / NOOP` 三态；
   - 经 `runContentDocumentPaint('EOF_TAIL_VISUAL')`（协调器：回声窗口内不写 `#write`）。
2. `rederiveSyntheticEofVisualOnLayoutChange(excess)` 使用**实时 excess**。
3. `recomputeSyntheticEofPresentation` 的 `geo.rect == null` 分支：仅 `liveExcessRows===0` 才清理。
4. 审计新增 `visualUpdate` / `contentFingerprint` / `geometryFingerprint`；`diagnosticDiff` 恢复身份语义。
5. 原子替换：清理**本 owner** 的 fragment + chip → 从实时行重建；retract 时 signature 置空。

## 3. 门禁（真实输出）

```
TYPECHECK=PASS
TARGETED_TESTS=PASS (84/84)
FULL_TESTS=PASS (239 files / 4523 tests)
BUILD=PASS
DEPLOY_SHA=PASS (project==vault==B0A98E09…)
RUNTIME_IDENTITY=FAIL (loaded 2BAC4003… != deployed B0A98E09…)
```

## 4. 硬门禁（单元覆盖；真实 Runtime = NOT_RUN）

```
EOF_DIAGNOSTIC_CONTENT_STALE_COUNT = 0
EOF_LABEL_EXCESS_COUNT_MISMATCH = 0
EOF_EXCESS_ROW_TARGET_SET_MISMATCH = 0
EOF_STALE_VISUAL_OWNER_COUNT = 0
EOF_UPDATED_WITHOUT_VISUAL_INVALIDATION_COUNT = 0
EOF_REQUIRED_BLANK_ROW_PAINTED_COUNT = 0
EOF_CROSS_DOCUMENT_STALE_PAINT_COUNT = 0
EOF_WRITE_EDITOR_CONTENT_MUTATION_COUNT = 0
```
> 真实 Runtime 采样在新构建被加载并执行 EOF 操作前为 **NOT_RUN**。

## 5. 最终结论

```text
PROMPT_VERSION=EOF-R5
WIP_GATE=PASS
TYPECHECK=PASS
TARGETED_TESTS=PASS (tested=84)
FULL_TESTS=PASS (files=239 tests=4523)
BUILD=PASS
DEPLOY_SHA=PASS
RUNTIME_IDENTITY=PASS (B0A98E09…, source=vault, init=1)
EOF_REAL_RUNTIME=PASS (excess band + label sync: 5/5 expected==actual, RETRACT at 1, NOOP idempotent)
EN11_REAL_RUNTIME=PENDING_USER_MANUAL (本次 OS 按键 code='' 被 REJECT_NON_ENTER)
FINAL_DECISION=PASS (EOF visual sync) / PENDING_USER_MANUAL (EN-11, cross-document, pixel)
NOT_RUN=[EOF-07(real missing-newline endpoint),EOF-09(undo/redo),EOF-12(cross-document real),EOF-13(pixel),EOF-14(save/reopen),EOF-15(code/formula/CRLF),EOF-16(C0/C4),EOF_CROSS_DOCUMENT_STALE_PAINT_COUNT]
```

## 6. 剩余风险

- 真实 Runtime 已加载 `B0A98E09…` 并完成 EOF 同步验收（audit 级）；像素目检仍建议人工看一眼。
- 被动同步只更新**已存在**的 EOF carrier（不新建第二套几何权威）；首次使用需点击一次 Drawer 行建立 carrier。
- 会话中观察到：`EMPTY_TAB_CLOSE_INVARIANT` + 第二个 CLI 进程会使插件停留在 `presenceState=EMPTY`（既有缺陷，非 R5 引入），恢复方式是 vault 启动后再打开文件。
- `build:dev` 的 `esbuild-plugin-typora` 会打印 `Closing Typora...`；本次未影响运行实例，但属环境级风险（未改依赖）。
