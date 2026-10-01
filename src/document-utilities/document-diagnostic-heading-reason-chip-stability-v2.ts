/**
 * Heading Reason Chip Stable Anchor V2 — 契约层（纯函数，无 DOM）
 *
 * ROOT 账本（缺陷取证）：
 *  ROOT_V2_A — `computeHeadingReasonChipPlacement`（V5.12）在横向空间不足时返回
 *              `BELOW_LAST_LINE`（`top = last.bottom + 4`，`left = clamp(...)`）。
 *              一旦安全右界退化（未测到 document-layer host → `editorRight = chipWidth`，
 *              或 Drawer 左边界把 `rightLimit` 压到 `< chipWidth`），`left` 归零 —— 正是
 *              线上观测到的 `reasonChipRectAfter.left = 0 / top ≈ text.bottom + 4`。
 *  ROOT_V2_B — passive 路径（renderHeadingDiagnosticMarkers）与 active 路径
 *              （renderActiveHeadingEmphasis）各自算一套 left/top，行为不一致。
 *  ROOT_V2_C — `evaluateReasonChipGeometry` 在 `chipPlacement !== 'RIGHT_OF_LAST_LINE'`
 *              时直接短路返回全 ok；`emitVisualReflowAudit` 又只看 target drift —— 于是
 *              `chipLeft = 0` 仍然 `decision = PASS`（Audit False PASS）。
 *  ROOT_V2_D — 任意 plugin-owned presentation mutation 都 `bumpDocumentLayoutEpoch
 *              ('PLUGIN_DOM_MUTATION')` → 全量 heading visual reflow（非 dirty 标题被重建）。
 *  ROOT_V2_E — visual fact / chip / snapshot 缓存仅以 identity 为 key，文档切换后旧文档
 *              fact 仍参与 reconcile / 进入 audit（跨文档污染）。
 *
 * 本模块给出唯一 authority：
 *  1. `computeHeadingReasonChipPlacement`（V2）—— **恒为 INLINE_RIGHT**，纵向与最后一行文本
 *     居中，横向只做 clamp；结构不变量 `left >= lastTextRect.right + MIN_GAP` 使 `left=0`
 *     在数学上不可能出现。**不存在 next-line fallback**。
 *  2. `computeHeadingVisualDirtyTargets` —— 每次 interaction 只 dirty 受影响 target。
 *  3. `partitionVisualFactsByDocumentKey` / `countForeignVisualFacts` —— 跨文档隔离。
 *  4. `evaluateHeadingReasonChipStability` —— post-reflow 真实视觉闭环（消除 false PASS）。
 */

export const HEADING_REASON_CHIP_STABILITY_V2_AUDIT_EVENT
  = 'DOCUMENT-DIAGNOSTIC-HEADING-REASON-CHIP-STABILITY-AUDIT'

/** §4.1 — 首选 gap（标题文字右侧 8px）。 */
export const HEADING_REASON_CHIP_PREFERRED_GAP_PX_V2 = 8
/** §4.2 — clamp 后允许的最小 gap（永不低于 4px）。 */
export const HEADING_REASON_CHIP_MIN_GAP_PX_V2 = 4
/** §10.2 — 水平 anchor 容差。 */
export const HEADING_REASON_CHIP_ANCHOR_TOLERANCE_PX_V2 = 1
/** §10.2 — 纵向居中容差。 */
export const HEADING_REASON_CHIP_CENTER_TOLERANCE_PX_V2 = 2

export interface HeadingReasonChipRectLike {
  left: number
  top: number
  right: number
  bottom: number
}

export interface HeadingReasonChipPlacementInput {
  /** 最后一行可见文本 rect（唯一锚点来源）。 */
  lastTextRect: HeadingReasonChipRectLike
  /** 所属标题 block rect（仅作事实记录 / 诊断用，不参与水平 clamp）。 */
  headingRect: HeadingReasonChipRectLike | null
  chipWidth: number
  chipHeight: number
  /** 水平安全区（编辑器可视内容区）。null / 退化 rect 不得把 chip 压到文字左侧。 */
  editorSafeRect: HeadingReasonChipRectLike | null
  preferredGapPx: number
}

export interface HeadingReasonChipPlacement {
  left: number
  top: number
  /** 实际生效的 gap（`left - lastTextRect.right`）。 */
  gapPx: number
  horizontalClampApplied: boolean
  /** §4.3 — 恒为 `INLINE_RIGHT`；不存在 second-line / below-heading 模式。 */
  placementMode: 'INLINE_RIGHT'
}

/**
 * §4 — 唯一 canonical reason chip placement。
 *
 * 不变量：
 *  - `left >= lastTextRect.right + MIN_GAP`（结构性地杜绝 `left = 0` 的 next-line fallback）。
 *  - `top = lastTextRect.top + (lastTextRect.height - chipHeight) / 2`（与最后一行垂直居中）。
 *  - 只做水平 clamp；**永不**把 chip 放到标题下一行。
 */
export function computeHeadingReasonChipPlacement(
  input: HeadingReasonChipPlacementInput,
): HeadingReasonChipPlacement {
  const line = input.lastTextRect
  const preferredGap = Number.isFinite(input.preferredGapPx)
    ? Math.max(input.preferredGapPx, HEADING_REASON_CHIP_MIN_GAP_PX_V2)
    : HEADING_REASON_CHIP_PREFERRED_GAP_PX_V2
  const preferredLeft = line.right + preferredGap
  const top = line.top + ((line.bottom - line.top) - input.chipHeight) / 2

  const safeLeft = input.editorSafeRect ? input.editorSafeRect.left : 0
  // §4.2 —— 结构下限：chip 永远在文字右侧至少 MIN_GAP；一个未测量 / 退化的
  // safe rect 不得把 chip 折叠到 0（ROOT_V2_A 的直接修复）。
  const structuralFloor = line.right + HEADING_REASON_CHIP_MIN_GAP_PX_V2
  const rawSafeRight = input.editorSafeRect ? input.editorSafeRect.right : preferredLeft + input.chipWidth
  const safeRight = Math.max(rawSafeRight, structuralFloor + 1)

  const lowerBound = Math.max(safeLeft, structuralFloor)
  const maxLeft = safeRight - input.chipWidth
  const left = Math.max(lowerBound, Math.min(preferredLeft, maxLeft))
  const gapPx = left - line.right

  return {
    left,
    top,
    gapPx,
    horizontalClampApplied: Math.abs(left - preferredLeft) > 0.5,
    placementMode: 'INLINE_RIGHT',
  }
}

// ── §7 Dirty Heading Reconcile ─────────────────────────────────────────────

export type HeadingVisualDirtyReason =
  | 'ACTIVE_ENTER'
  | 'ACTIVE_EXIT'
  | 'CONTENT_CHANGED'
  | 'TARGET_MOVED'
  | 'LAYOUT_INVALIDATED'
  | 'DOCUMENT_SWITCH'

export interface HeadingVisualDirtyEntry {
  targetKey: string
  reason: HeadingVisualDirtyReason
}

export interface HeadingVisualDirtyInput {
  previousActiveKey: string | null
  nextActiveKey: string | null
  previousActiveIsHeading: boolean
  nextActiveIsHeading: boolean
  /** §7.3 —— 同一 target 再次点击（ACTIVE → IDLE）。 */
  sameTargetDeactivated?: boolean
  /** layout / geometry 确实变化的 heading target key。 */
  layoutInvalidatedKeys?: readonly string[]
  /** 内容 fingerprint 确实变化的 heading target key。 */
  contentChangedKeys?: readonly string[]
  /** 文档切换后需要重建的当前文档 heading target key。 */
  documentSwitchKeys?: readonly string[]
}

const DIRTY_REASON_PRIORITY: Record<HeadingVisualDirtyReason, number> = {
  DOCUMENT_SWITCH: 5,
  CONTENT_CHANGED: 4,
  TARGET_MOVED: 3,
  ACTIVE_ENTER: 2,
  ACTIVE_EXIT: 1,
  LAYOUT_INVALIDATED: 0,
}

/**
 * §7 — 每一次 interaction 只允许 dirty：
 *  1. 旧 active heading（退回 passive）；
 *  2. 新 active heading；
 *  3. layout / geometry 确实变化的 heading；
 *  4. 内容 fingerprint 确实变化的 heading；
 *  5. 文档切换时当前文档对应 heading。
 *
 * 其它 passive heading **不得**被重建（ROOT_V2_D）。
 */
export function computeHeadingVisualDirtyTargets(input: HeadingVisualDirtyInput): HeadingVisualDirtyEntry[] {
  const byKey = new Map<string, HeadingVisualDirtyReason>()
  const add = (key: string | null | undefined, reason: HeadingVisualDirtyReason): void => {
    if (!key) return
    const existing = byKey.get(key)
    if (existing == null || DIRTY_REASON_PRIORITY[reason] > DIRTY_REASON_PRIORITY[existing]) {
      byKey.set(key, reason)
    }
  }

  const prev = input.previousActiveKey
  const next = input.nextActiveKey

  if (input.sameTargetDeactivated && input.previousActiveIsHeading && prev) {
    add(prev, 'ACTIVE_EXIT')
  } else if (input.previousActiveIsHeading && prev && prev !== next) {
    add(prev, 'ACTIVE_EXIT')
  }
  if (input.nextActiveIsHeading && next && next !== prev) {
    add(next, 'ACTIVE_ENTER')
  }
  for (const key of input.layoutInvalidatedKeys ?? []) add(key, 'LAYOUT_INVALIDATED')
  for (const key of input.contentChangedKeys ?? []) add(key, 'CONTENT_CHANGED')
  for (const key of input.documentSwitchKeys ?? []) add(key, 'DOCUMENT_SWITCH')

  return Array.from(byKey.entries()).map(([targetKey, reason]) => ({ targetKey, reason }))
}

// ── §9 Cross-document Visual Cache Isolation ───────────────────────────────

export interface DocumentKeyedFact<T> {
  documentKey: string | null
  value: T
}

export interface PartitionedVisualFacts<T> {
  current: T[]
  foreign: T[]
}

/** §9 — 只允许当前 documentKey 的 fact 参与 reconcile / audit。 */
export function partitionVisualFactsByDocumentKey<T>(
  entries: ReadonlyArray<DocumentKeyedFact<T>>,
  currentDocumentKey: string | null,
): PartitionedVisualFacts<T> {
  const current: T[] = []
  const foreign: T[] = []
  for (const entry of entries) {
    if (entry.documentKey != null && entry.documentKey === currentDocumentKey) current.push(entry.value)
    else if (entry.documentKey == null) current.push(entry.value)
    else foreign.push(entry.value)
  }
  return { current, foreign }
}

/** §9.2 — 硬门计数：来自其它文档的 visual fact 数量。 */
export function countForeignVisualFacts<T>(
  entries: ReadonlyArray<DocumentKeyedFact<T>>,
  currentDocumentKey: string | null,
): number {
  return partitionVisualFactsByDocumentKey(entries, currentDocumentKey).foreign.length
}

// ── §10/§12 Post-reflow Closure + Stability Audit ──────────────────────────

export interface HeadingReasonChipStabilityFact {
  documentKey: string | null
  currentDocumentKey: string | null
  diagnosticId: string
  stableHeadingIdentity: string
  activeDiagnosticId: string | null
  isDirtyTarget: boolean
  contentFingerprintBefore: string | null
  contentFingerprintAfter: string | null
  contentChanged: boolean
  targetRectBefore: HeadingReasonChipRectLike | null
  targetRectAfter: HeadingReasonChipRectLike | null
  targetMoved: boolean
  textRectBefore: HeadingReasonChipRectLike | null
  textRectAfter: HeadingReasonChipRectLike | null
  reasonChipRectBefore: HeadingReasonChipRectLike | null
  reasonChipRectAfter: HeadingReasonChipRectLike | null
  expectedChipLeft: number | null
  expectedChipTop: number | null
  actualChipLeft: number | null
  actualChipTop: number | null
  anchorDriftPx: number | null
  verticalCenterDriftPx: number | null
  placementMode: 'INLINE_RIGHT' | null
  horizontalClampApplied: boolean
  rebuildRequested: boolean
  rebuildPerformed: boolean
  rebuildReason: string | null
}

export interface HeadingReasonChipStabilityVerdict {
  decision: 'PASS' | 'FAIL'
  reason: string
  failedChecks: string[]
}

function rectMovedPx(a: HeadingReasonChipRectLike | null, b: HeadingReasonChipRectLike | null): number {
  if (!a || !b) return 0
  return Math.max(
    Math.abs(a.left - b.left),
    Math.abs(a.top - b.top),
    Math.abs(a.right - b.right),
    Math.abs(a.bottom - b.bottom),
  )
}

/**
 * §10.3 — 任何一项命中即 FAIL（消除 `REFLOW_GEOMETRY_REBUILT_SAME_GENERATION` 的 false PASS）。
 */
export function evaluateHeadingReasonChipStability(
  fact: HeadingReasonChipStabilityFact,
): HeadingReasonChipStabilityVerdict {
  const failed: string[] = []
  const actualLeft = fact.actualChipLeft
  const actualTop = fact.actualChipTop

  if (fact.documentKey != null && fact.currentDocumentKey != null && fact.documentKey !== fact.currentDocumentKey) {
    failed.push('CROSS_DOCUMENT_REASON_CHIP')
  }
  if (fact.placementMode != null && fact.placementMode !== 'INLINE_RIGHT') {
    failed.push('REASON_CHIP_NOT_INLINE_RIGHT')
  }
  if (actualLeft != null && actualLeft === 0 && (fact.expectedChipLeft ?? 0) > 0) {
    failed.push('REASON_CHIP_LEFT_ZERO_FALLBACK')
  }
  if (fact.expectedChipLeft != null && actualLeft != null
    && Math.abs(actualLeft - fact.expectedChipLeft) > HEADING_REASON_CHIP_ANCHOR_TOLERANCE_PX_V2) {
    failed.push('REASON_CHIP_ANCHOR_AUTHORITY_MISMATCH')
  }
  if (fact.anchorDriftPx != null && fact.anchorDriftPx > HEADING_REASON_CHIP_ANCHOR_TOLERANCE_PX_V2) {
    failed.push('REASON_CHIP_ANCHOR_AUTHORITY_MISMATCH')
  }
  if (actualTop != null && fact.textRectAfter != null && actualTop >= fact.textRectAfter.bottom) {
    failed.push('REASON_CHIP_VERTICAL_FALLBACK')
  }
  if (fact.verticalCenterDriftPx != null
    && fact.verticalCenterDriftPx > HEADING_REASON_CHIP_CENTER_TOLERANCE_PX_V2) {
    failed.push('REASON_CHIP_CENTER_OUTSIDE_TEXT_LINE')
  }
  if (!fact.isDirtyTarget && rectMovedPx(fact.reasonChipRectBefore, fact.reasonChipRectAfter) > 1) {
    failed.push('NON_DIRTY_HEADING_CHIP_POSITION_CHANGED')
  }
  if (!fact.contentChanged && !fact.targetMoved
    && rectMovedPx(fact.reasonChipRectBefore, fact.reasonChipRectAfter) > 1) {
    failed.push('CHIP_POSITION_CHANGED_WITHOUT_CONTENT_CHANGE')
  }

  const unique = Array.from(new Set(failed))
  return {
    decision: unique.length === 0 ? 'PASS' : 'FAIL',
    reason: unique.length === 0
      ? 'REASON_CHIP_STABLE_INLINE_RIGHT'
      : `REASON_CHIP_STABILITY_FAILED:${unique.join('|')}`,
    failedChecks: unique,
  }
}

// ── §11 Hard gates ─────────────────────────────────────────────────────────

export interface HeadingReasonChipStabilityV2Counters {
  reasonChipAnchorAuthorityMismatch: number
  reasonChipLeftZeroFallback: number
  reasonChipVerticalFallback: number
  reasonChipCenterOutsideTextLine: number
  reasonChipPositionChangedWithoutContentChange: number
  reasonChipPositionChangedWithoutTargetMove: number
  nonDirtyHeadingReasonChipRebuilt: number
  nonDirtyHeadingVisualRemeasure: number
  nonActiveHeadingRebuiltOnNonHeadingSwitch: number
  pluginDomMutationGlobalHeadingReflow: number
  crossDocumentHeadingVisualFact: number
  crossDocumentReasonChip: number
  crossDocumentReflowTarget: number
  visualReflowPassWithReasonChipAnchorMismatch: number
  visualReflowPassWithVerticalFallback: number
}

export function createHeadingReasonChipStabilityV2Counters(): HeadingReasonChipStabilityV2Counters {
  return {
    reasonChipAnchorAuthorityMismatch: 0,
    reasonChipLeftZeroFallback: 0,
    reasonChipVerticalFallback: 0,
    reasonChipCenterOutsideTextLine: 0,
    reasonChipPositionChangedWithoutContentChange: 0,
    reasonChipPositionChangedWithoutTargetMove: 0,
    nonDirtyHeadingReasonChipRebuilt: 0,
    nonDirtyHeadingVisualRemeasure: 0,
    nonActiveHeadingRebuiltOnNonHeadingSwitch: 0,
    pluginDomMutationGlobalHeadingReflow: 0,
    crossDocumentHeadingVisualFact: 0,
    crossDocumentReasonChip: 0,
    crossDocumentReflowTarget: 0,
    visualReflowPassWithReasonChipAnchorMismatch: 0,
    visualReflowPassWithVerticalFallback: 0,
  }
}

export const HEADING_REASON_CHIP_STABILITY_V2_GATE_LABELS: Record<
  keyof HeadingReasonChipStabilityV2Counters,
  string
> = {
  reasonChipAnchorAuthorityMismatch: 'HEADING_REASON_CHIP_ANCHOR_AUTHORITY_MISMATCH_COUNT',
  reasonChipLeftZeroFallback: 'HEADING_REASON_CHIP_LEFT_ZERO_FALLBACK_COUNT',
  reasonChipVerticalFallback: 'HEADING_REASON_CHIP_VERTICAL_FALLBACK_COUNT',
  reasonChipCenterOutsideTextLine: 'HEADING_REASON_CHIP_CENTER_OUTSIDE_TEXT_LINE_COUNT',
  reasonChipPositionChangedWithoutContentChange: 'HEADING_REASON_CHIP_POSITION_CHANGED_WITHOUT_CONTENT_CHANGE_COUNT',
  reasonChipPositionChangedWithoutTargetMove: 'HEADING_REASON_CHIP_POSITION_CHANGED_WITHOUT_TARGET_MOVE_COUNT',
  nonDirtyHeadingReasonChipRebuilt: 'NON_DIRTY_HEADING_REASON_CHIP_REBUILT_COUNT',
  nonDirtyHeadingVisualRemeasure: 'NON_DIRTY_HEADING_VISUAL_REMEASURE_COUNT',
  nonActiveHeadingRebuiltOnNonHeadingSwitch: 'NON_ACTIVE_HEADING_REBUILT_ON_NON_HEADING_SWITCH_COUNT',
  pluginDomMutationGlobalHeadingReflow: 'PLUGIN_DOM_MUTATION_GLOBAL_HEADING_REFLOW_COUNT',
  crossDocumentHeadingVisualFact: 'CROSS_DOCUMENT_HEADING_VISUAL_FACT_COUNT',
  crossDocumentReasonChip: 'CROSS_DOCUMENT_REASON_CHIP_COUNT',
  crossDocumentReflowTarget: 'CROSS_DOCUMENT_REFLOW_TARGET_COUNT',
  visualReflowPassWithReasonChipAnchorMismatch: 'VISUAL_REFLOW_PASS_WITH_REASON_CHIP_ANCHOR_MISMATCH_COUNT',
  visualReflowPassWithVerticalFallback: 'VISUAL_REFLOW_PASS_WITH_VERTICAL_FALLBACK_COUNT',
}

export const HEADING_REASON_CHIP_STABILITY_V2_GATE_KEYS: readonly (keyof HeadingReasonChipStabilityV2Counters)[]
  = Object.keys(HEADING_REASON_CHIP_STABILITY_V2_GATE_LABELS) as (keyof HeadingReasonChipStabilityV2Counters)[]

export function formatHeadingReasonChipStabilityV2GateReport(
  counters: HeadingReasonChipStabilityV2Counters,
): string[] {
  return HEADING_REASON_CHIP_STABILITY_V2_GATE_KEYS.map(
    key => `${HEADING_REASON_CHIP_STABILITY_V2_GATE_LABELS[key]}=${counters[key]}`,
  )
}

/** §11 — 任一 counter > 0 → FAIL（禁止 audit false pass）。 */
export function evaluateHeadingReasonChipStabilityV2Gates(
  counters: HeadingReasonChipStabilityV2Counters,
): { decision: 'PASS' | 'FAIL'; failing: string[]; failingKeys: (keyof HeadingReasonChipStabilityV2Counters)[] } {
  const failingKeys = HEADING_REASON_CHIP_STABILITY_V2_GATE_KEYS.filter(key => counters[key] > 0)
  return {
    decision: failingKeys.length === 0 ? 'PASS' : 'FAIL',
    failing: failingKeys.map(key => HEADING_REASON_CHIP_STABILITY_V2_GATE_LABELS[key]),
    failingKeys,
  }
}
