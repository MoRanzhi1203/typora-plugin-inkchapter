# SOURCE SELF-AUDIT — esc2b7q Empty Paragraph Special-Command

Audit date: 2026-08-13
Baseline Build audited: `inkchapter-r58-7-p0-empty-special-continuity-esc2b7q`
Baseline Main SHA: `4581D1E835F8F2CC5C9A42CB2A5DD3E5A402886947446A0BB71664A80CC89C89`

Fixed Build: `inkchapter-r58-7-p0-empty-special-auditfix-es2b7q`
Fixed Main SHA: `2256FA7B6C57FF767FEACA32E784953BC32DBF1782AE09722CFC15C134EDCF2E`
Style SHA (unchanged): `F163883946FD4FB7448110D0E7A8EB48CD5D52AFC3380BC0E466F7F3378470C0`

---

## A — Native Empty DOM Probe
**PASS**（was FAIL / NATIVE_EMPTY_DOM_PROBE_MISSING）

evidence:
- `empty-special-command.ts` 新增 `snapshotEmptyBlockDom(node, phase, runtimeId)` + `EmptyBlockDomSnapshot`。
- 采集字段：`innerHTML` / `textContent` / `childNodeCount` / `childNodeSummaries` / `hasBR` / `brCount` / `hasPlaceholderSpan` / `hasTyporaMarker`。
- `heading-numbering-service.ts` 新增 `emitEmptyBlockDomSnapshot` + `findNativeEmptyReferenceParagraph`，在 5 个 phase 采样并进入 JSONL：
  - `NATIVE_EMPTY`（参考原生空段：prev → next → 任意空段）
  - `BEFORE_TOKEN_CONSUME`
  - `AFTER_TOKEN_CONSUME`
  - `AFTER_MICROTASK`
  - `AFTER_RAF`
- 全部通过 `emitRuntimeAudit('EMPTY-BLOCK-DOM-SNAPSHOT', ...)` 进入 file-backed JSONL，runtime 可比较 native-empty 与 token-consumed empty。

missing: 无。Source 层只 IMPLEMENT probe，不伪造 runtime DOM 结论。

## B — Normalization Settle
**PASS**（was FAIL / TIME_ONLY_SETTLE）

authority: mutation-authoritative settle + bounded safety timeout（frame 驱动，非固定墙钟 sleep）。

evidence:
- `scheduleEmptySpecialSettle` 改为：先 `MutationObserver`（childList+subtree+characterData）打开 mutation 窗口 → 过滤 `isRelevantEmptySpecialMutation`（childList 且触及 source/prev/next）→ 帧驱动 quiet boundary（连续 2 帧无新 relevant mutation）→ `maxTimeoutMs=300` 仅作 bounded fallback。
- `decideEmptySpecialSettle`（纯函数）承载 quiet boundary / timeout 决策，单测 E15~E18 覆盖。
- `EMPTY-SPECIAL-SETTLE-AUDIT`（txnId/mutationGeneration/relevantMutationCount/quietBoundaryReached/timeoutReached/decision）与 `EMPTY-SPECIAL-MUTATION` 进入 JSONL。

## C — EmptySlot Resolver
**PASS**（无变更）

evidence:
- `resolveEmptySlot` 纯函数仅依赖 `sourceConnected` + `candidateRuntimeIds`（service 已按结构 bracket 过滤）。
- SAME_NODE / CONTROLLED_REPLACEMENT(candidateCount==1) / AMBIGUOUS(>1) / MISSING(0)。
- 无 previous/next fallback、无 textHash、无 anchor heuristic、无 historical resolver。

## D — Canonical Rebind Lease
**PASS**（was FAIL / CANONICAL_REBIND_LEASE_INCOMPLETE）

evidence:
- `rebindCurrentLiveRecord(recordId, newElement, newRuntimeId, lease?)` 改为 CAS-like contract。
- lease 校验：`scopeId` / `documentKey` / `expectedGeneration` / `expectedOldRuntimeId`；new element/runtimeId collision check；state must be CURRENT_LIVE。
- 任一 violation → `emitDiagnostic('REBIND-BLOCKED', ...)` + 返回 `false`（BLOCK），绝不 CREATE_NEW、绝不 historical resolver。
- 成功时：recordId/recordCount 不变、generation 精确 +1、旧 element/runtime 绑定失效、新绑定安装。
- `commitEmptySpecialCanonical` 传入完整 lease；rebind 失败 → `BLOCK`，settle 走 `finishEmptySpecialBlocked('CANONICAL_COMMIT_BLOCKED')`。
- 单测 D-REBIND-1~7 覆盖 valid / scope-mismatch / doc-mismatch / generation-mismatch / old-runtime-mismatch / runtime-collision / non-CURRENT_LIVE。

## E — Intent Supersession
**PASS**（was FAIL / SUPERSESSION_CHECK_TOO_LATE）

evidence:
- settle 首行（任何 canonical/rebind/semantic/visual/selection/caret mutation 之前）检查 `userIntentEpoch !== txn.intentEpoch` → `finishEmptySpecialSuperseded`。
- 新增 `EMPTY-SPECIAL-SUPERSESSION-AUDIT`：`txnId/oldEpoch/newEpoch/newSource/mutationAttempted=false/canonicalCommitAttempted=false/caretWriteAttempted=false/decision=SUPERSEDE`。
- 新增 `lastUserIntentSource` 追踪（在 `beginTrustedUserIntent` 记录）。

## F — JSONL Audit
**PASS**（was FAIL / JSONL_AUDIT_INCOMPLETE）

evidence（全部经 `emitRuntimeAudit` 进入 file-backed JSONL）:
- EMPTY-SPECIAL-PRE / TOKEN-CONSUMED / STRUCTURAL-RESOLUTION / CANONICAL-COMMIT / CARET-VERIFY / CARET-GEOMETRY / VISUAL-VERIFY / FINAL（原有）。
- 本轮补齐：EMPTY-SPECIAL-MUTATION / EMPTY-SPECIAL-CARET-RESTORE / EMPTY-SPECIAL-SUPERSESSION-AUDIT / EMPTY-BLOCK-DOM-SNAPSHOT。
- 另新增 EMPTY-SPECIAL-SETTLE-AUDIT / EMPTY-SPECIAL-CANONICAL-REBIND。

## G — Test Coverage
**PASS**（was FAIL / HELPER_ONLY_NOT_SERVICE_INTEGRATION）

helperTests:
- `EMPTY-SPECIAL-E1~E14`（原有 helper）+ `E15~E18`（settle 决策）。

integrationTests:
- 新增 `empty-special-command.integration.test.ts`（jsdom），`EMPTY-SPECIAL-INTEGRATION-E1/E2/E3`：
  - E1：token detect → consume → source survive → resolve SAME_NODE → canonical UPDATE → final PASS。
  - E2：source replaced → unique candidate → CAS rebind lease → 真实 caret geometry → final PASS。
  - E3：prev empty + source empty + next empty → CONTROLLED_REPLACEMENT（结构 bracket），双 candidate → AMBIGUOUS（不 ordinal 猜）。
- 使用真实 `ParagraphCanonicalRegistry` + 真实 jsdom DOM + 真实 pure 决策函数，覆盖 production orchestration 核心链。
- 说明：完整 `HeadingNumberingService` 私有方法调用由 sandbox 外 runtime E1/E2/E3 覆盖（服务构造依赖真实 Typora DOM/Notice/Editor API，无法在单测安全实例化）。

---

## SOURCE SELF-AUDIT OVERALL
= **PASS**

---

## Verification

- `tsc --noEmit` = **PASS**
- Full regression = **738/738 PASS**（原 722 + 新增 16：E15~E18 ×4 + D-REBIND ×7 + A snapshot ×2 + INTEGRATION ×3）
- `EMPTY-SPECIAL-E1~E14` = PASS
- `EMPTY-SPECIAL-INTEGRATION-E1~E3` = PASS
- `build:dev`（esbuild）= PASS
- deploy（`test/vault/.typora/plugins/dist`）= PASS
- SHA parity：
  - project main == runtime main == `2256FA7B...`（mainMatch = true）
  - project style == runtime style == `F163...`（styleMatch = true）
- runtime Build ID baked = `inkchapter-r58-7-p0-empty-special-auditfix-es2b7q`

## Status

```
Empty Special Source Architecture
= VERIFIED / SOURCE + UNIT

Strict Startup = NOT EXECUTED
Real E1/E2/E3 = NOT EXECUTED
Empty Paragraph Special-Command Continuity = NOT YET (runtime)
```
