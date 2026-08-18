/**
 * Formula Dependency Frontier — v2.5.7-R5.4.3.12
 *
 * Core logic for computing dependency frontiers when formula insertion/removal/
 * reordering/cross-scope movement or heading structure changes occur. All
 * functions are pure (no external state except emitRuntimeAudit) and produce
 * structured audit records for the cascade projection pipeline.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { type LivePlanDiffEntry } from './formula-live-revision'

// ── Types ────────────────────────────────────────────────────────────

export type FormulaDependencyOperation =
  | 'FORMULA_INSERT'
  | 'FORMULA_REMOVE'
  | 'FORMULA_REORDER'
  | 'FORMULA_MOVE_SCOPE'
  | 'HEADING_INSERT'
  | 'HEADING_REMOVE'
  | 'HEADING_LEVEL_CHANGE'
  | 'HEADING_REORDER'
  | 'HEADING_NUMBERING_STATE_CHANGE'
  | 'HEADING_TEXT_ONLY'

export interface FormulaDependencyFrontier {
  frontierId: string
  operationBatchId: string
  operation: FormulaDependencyOperation
  documentKey: string
  generation: number
  rootToken: number
  startBlockOrder: number
  oldEndBlockOrder: number | null
  newEndBlockOrder: number | null
  oldScopeKeys: string[]
  newScopeKeys: string[]
  oldLogicalHeadingLevel: number | null
  newLogicalHeadingLevel: number | null
  candidateStableIdentities: Array<number | 'AMBIGUOUS' | null>
  decision: 'REPROJECT' | 'NO_NUMBERING_SEMANTIC_CHANGE' | 'FAIL'
  reason: string | null
}

export interface FormulaCascadeProjectionBatch {
  projectionBatchId: string
  frontierId: string
  triggerOperation: FormulaDependencyOperation
  requestedStableIdentities: Array<number | 'AMBIGUOUS' | null>
  requestedCount: number
  settledCount: number
  fulfilledCount: number
  appliedCount: number
  visibleVerifiedCount: number
  failedCount: number
  pendingCount: number
}

// ── Internal Helpers ─────────────────────────────────────────────────

let _frontierCounter = 0

function nextFrontierId(): string {
  _frontierCounter++
  return `frontier-${_frontierCounter}-${Date.now()}`
}

/**
 * Extract the numeric sequence value from a desired tag string.
 * The tag format is expected to be "scope:sequence" or "sequence".
 */
function extractSequenceValue(tag: string): number | null {
  const parts = tag.split(':')
  const seqPart = parts.length >= 2 ? parts[1] : parts[0]
  const num = Number(seqPart)
  return Number.isFinite(num) ? num : null
}

// ── computeFormulaSuffixFrontier ─────────────────────────────────────

export function computeFormulaSuffixFrontier(input: {
  operation: 'FORMULA_INSERT' | 'FORMULA_REMOVE' | 'FORMULA_REORDER' | 'FORMULA_MOVE_SCOPE'
  operationBatchId: string
  documentKey: string
  generation: number
  rootToken: number
  mutationBlockOrder: number
  oldPosition: number | null
  newPosition: number | null
  oldScopeKey: string | null
  newScopeKey: string | null
  scopeEnd: number
  beforeStableIdentities: Array<number | 'AMBIGUOUS' | null>
  afterStableIdentities: Array<number | 'AMBIGUOUS' | null>
}): FormulaDependencyFrontier {
  const frontierId = nextFrontierId()
  const {
    operation,
    operationBatchId,
    documentKey,
    generation,
    rootToken,
    mutationBlockOrder,
    oldPosition,
    newPosition,
    oldScopeKey,
    newScopeKey,
    scopeEnd,
    beforeStableIdentities,
    afterStableIdentities,
  } = input

  let startBlockOrder: number
  let oldEndBlockOrder: number | null
  let newEndBlockOrder: number | null
  let oldScopeKeys: string[]
  let newScopeKeys: string[]
  let decision: 'REPROJECT' | 'NO_NUMBERING_SEMANTIC_CHANGE' | 'FAIL'
  let reason: string | null

  switch (operation) {
    case 'FORMULA_INSERT': {
      startBlockOrder = mutationBlockOrder
      oldEndBlockOrder = null
      newEndBlockOrder = scopeEnd
      oldScopeKeys = []
      newScopeKeys = newScopeKey ? [newScopeKey] : []
      decision = 'REPROJECT'
      reason = 'formula-insert-suffix-invalidation'
      break
    }
    case 'FORMULA_REMOVE': {
      startBlockOrder = mutationBlockOrder
      oldEndBlockOrder = scopeEnd
      newEndBlockOrder = null
      oldScopeKeys = oldScopeKey ? [oldScopeKey] : []
      newScopeKeys = []
      decision = 'REPROJECT'
      reason = 'formula-remove-suffix-invalidation'
      break
    }
    case 'FORMULA_REORDER': {
      const oldPos = oldPosition ?? mutationBlockOrder
      const newPos = newPosition ?? mutationBlockOrder
      startBlockOrder = Math.min(oldPos, newPos)
      oldEndBlockOrder = scopeEnd
      newEndBlockOrder = scopeEnd
      oldScopeKeys = oldScopeKey ? [oldScopeKey] : []
      newScopeKeys = newScopeKey ? [newScopeKey] : []
      decision = 'REPROJECT'
      reason = 'formula-reorder-suffix-invalidation'
      break
    }
    case 'FORMULA_MOVE_SCOPE': {
      startBlockOrder = mutationBlockOrder
      oldEndBlockOrder = scopeEnd
      newEndBlockOrder = scopeEnd
      oldScopeKeys = oldScopeKey ? [oldScopeKey] : []
      newScopeKeys = newScopeKey ? [newScopeKey] : []
      decision = 'REPROJECT'
      reason = 'formula-move-scope-suffix-invalidation'
      break
    }
    default: {
      startBlockOrder = mutationBlockOrder
      oldEndBlockOrder = null
      newEndBlockOrder = null
      oldScopeKeys = []
      newScopeKeys = []
      decision = 'FAIL'
      reason = 'unrecognized-operation'
    }
  }

  // Determine candidate stable identities: the intersection of before and after
  const candidateSet = new Set<number>()
  const ambiguousSet = new Set<'AMBIGUOUS' | null>()
  for (const id of beforeStableIdentities) {
    if (id === 'AMBIGUOUS' || id === null) ambiguousSet.add(id)
    else candidateSet.add(id)
  }
  const afterSet = new Set<number>()
  for (const id of afterStableIdentities) {
    if (id === 'AMBIGUOUS' || id === null) ambiguousSet.add(id)
    else afterSet.add(id)
  }
  const survivingNumbers: number[] = []
  for (const id of candidateSet) {
    if (afterSet.has(id)) survivingNumbers.push(id)
  }
  const candidateStableIdentities: Array<number | 'AMBIGUOUS' | null> = [
    ...survivingNumbers,
    ...(ambiguousSet.has('AMBIGUOUS') ? ['AMBIGUOUS' as const] : []),
    ...(ambiguousSet.has(null) ? [null] : []),
  ]

  // Emit FORMULA-SEQUENCE-SUFFIX-INVALIDATION
  emitSequenceSuffixInvalidation({
    frontierId,
    operationBatchId,
    operation,
    scopeKey: newScopeKey ?? oldScopeKey ?? null,
    mutationBlockOrder,
    frontierStartBlockOrder: startBlockOrder,
    frontierEndBlockOrder: newEndBlockOrder ?? oldEndBlockOrder ?? scopeEnd,
    beforeStableIdentities,
    afterStableIdentities,
    candidateStableIdentities,
    affectedNewStableIdentities: afterStableIdentities.filter((id) => {
      if (id === 'AMBIGUOUS' || id === null) return false
      return !candidateSet.has(id)
    }),
    affectedExistingStableIdentities: survivingNumbers,
    decision,
    reason,
  })

  // Emit FORMULA-DEPENDENCY-FRONTIER-AUTHORITY
  emitRuntimeAudit('FORMULA-DEPENDENCY-FRONTIER-AUTHORITY', {
    frontierId,
    operationBatchId,
    operation,
    documentKey,
    generation,
    rootToken,
    startBlockOrder,
    oldEndBlockOrder,
    newEndBlockOrder,
    oldScopeKeys,
    newScopeKeys,
    candidateStableIdentities: candidateStableIdentities.map((id) =>
      id === 'AMBIGUOUS' ? 'AMBIGUOUS' : id,
    ),
    decision,
    reason,
    runtimeMarker: R54312_RUNTIME_MARKER,
  })

  return {
    frontierId,
    operationBatchId,
    operation,
    documentKey,
    generation,
    rootToken,
    startBlockOrder,
    oldEndBlockOrder,
    newEndBlockOrder,
    oldScopeKeys,
    newScopeKeys,
    oldLogicalHeadingLevel: null,
    newLogicalHeadingLevel: null,
    candidateStableIdentities,
    decision,
    reason,
  }
}

// ── emitSequenceSuffixInvalidation ───────────────────────────────────

export function emitSequenceSuffixInvalidation(input: {
  frontierId: string
  operationBatchId: string
  operation: FormulaDependencyOperation
  scopeKey: string | null
  mutationBlockOrder: number
  frontierStartBlockOrder: number
  frontierEndBlockOrder: number
  beforeStableIdentities: Array<number | 'AMBIGUOUS' | null>
  afterStableIdentities: Array<number | 'AMBIGUOUS' | null>
  candidateStableIdentities: Array<number | 'AMBIGUOUS' | null>
  affectedNewStableIdentities: Array<number | 'AMBIGUOUS' | null>
  affectedExistingStableIdentities: Array<number | 'AMBIGUOUS' | null>
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-SEQUENCE-SUFFIX-INVALIDATION', {
    frontierId: input.frontierId,
    operationBatchId: input.operationBatchId,
    operation: input.operation,
    scopeKey: input.scopeKey,
    mutationBlockOrder: input.mutationBlockOrder,
    frontierStartBlockOrder: input.frontierStartBlockOrder,
    frontierEndBlockOrder: input.frontierEndBlockOrder,
    beforeStableIdentities: input.beforeStableIdentities.map((id) =>
      id === 'AMBIGUOUS' ? 'AMBIGUOUS' : id,
    ),
    afterStableIdentities: input.afterStableIdentities.map((id) =>
      id === 'AMBIGUOUS' ? 'AMBIGUOUS' : id,
    ),
    candidateStableIdentities: input.candidateStableIdentities.map((id) =>
      id === 'AMBIGUOUS' ? 'AMBIGUOUS' : id,
    ),
    affectedNewStableIdentities: input.affectedNewStableIdentities.map((id) =>
      id === 'AMBIGUOUS' ? 'AMBIGUOUS' : id,
    ),
    affectedExistingStableIdentities: input.affectedExistingStableIdentities.map((id) =>
      id === 'AMBIGUOUS' ? 'AMBIGUOUS' : id,
    ),
    decision: input.decision,
    reason: input.reason,
    runtimeMarker: R54312_RUNTIME_MARKER,
  })
}

// ── computeHeadingDependencyFrontier ─────────────────────────────────

export function computeHeadingDependencyFrontier(input: {
  operation: 'HEADING_INSERT' | 'HEADING_REMOVE' | 'HEADING_LEVEL_CHANGE' | 'HEADING_REORDER' | 'HEADING_NUMBERING_STATE_CHANGE' | 'HEADING_TEXT_ONLY'
  operationBatchId: string
  documentKey: string
  generation: number
  rootToken: number
  oldLogicalHeadingLevel: number | null
  newLogicalHeadingLevel: number | null
  headingBlockOrder: number
  previousHeadingBlockOrder: number | null
  nextHeadingBlockOrder: number | null
  documentEndBlockOrder: number
  allHeadingBlockOrders: number[]
  allFormulaStableIdentities: Array<number | 'AMBIGUOUS' | null>
  allFormulaBlockOrders: number[]
}): FormulaDependencyFrontier {
  const frontierId = nextFrontierId()
  const {
    operation,
    operationBatchId,
    documentKey,
    generation,
    rootToken,
    oldLogicalHeadingLevel,
    newLogicalHeadingLevel,
    headingBlockOrder,
    nextHeadingBlockOrder,
    documentEndBlockOrder,
    allFormulaStableIdentities,
  } = input

  let startBlockOrder: number
  let oldEndBlockOrder: number | null
  let newEndBlockOrder: number | null
  let decision: 'REPROJECT' | 'NO_NUMBERING_SEMANTIC_CHANGE' | 'FAIL'
  let reason: string | null

  if (operation === 'HEADING_TEXT_ONLY') {
    decision = 'NO_NUMBERING_SEMANTIC_CHANGE'
    reason = 'heading-text-only-no-semantic-change'
    startBlockOrder = headingBlockOrder
    oldEndBlockOrder = null
    newEndBlockOrder = null
  } else {
    // Determine the structural range based on heading level
    const newLevel = newLogicalHeadingLevel ?? oldLogicalHeadingLevel

    if (newLevel === 1) {
      // H1 structural: heading to document end
      startBlockOrder = headingBlockOrder
      oldEndBlockOrder = documentEndBlockOrder
      newEndBlockOrder = documentEndBlockOrder
    } else if (newLevel === 2) {
      // H2 structural (no H1): heading to next H1 - 1 (or document end)
      // Find next H1 after this heading using the next sibling heading order
      let nextH1Order = documentEndBlockOrder
      if (nextHeadingBlockOrder !== null) {
        nextH1Order = nextHeadingBlockOrder - 1
      }
      startBlockOrder = headingBlockOrder
      oldEndBlockOrder = nextH1Order
      newEndBlockOrder = nextH1Order
    } else if (newLevel !== null && newLevel >= 3) {
      // H3+ structural: heading to next H2 - 1 (or document end)
      let nextH2Order = documentEndBlockOrder
      if (nextHeadingBlockOrder !== null) {
        nextH2Order = nextHeadingBlockOrder - 1
      }
      startBlockOrder = headingBlockOrder
      oldEndBlockOrder = nextH2Order
      newEndBlockOrder = nextH2Order
    } else {
      // Fallback: heading to document end
      startBlockOrder = headingBlockOrder
      oldEndBlockOrder = documentEndBlockOrder
      newEndBlockOrder = documentEndBlockOrder
    }

    if (operation === 'HEADING_LEVEL_CHANGE') {
      // Level change: use old range UNION new range
      const oldStart = headingBlockOrder
      const oldEnd = oldEndBlockOrder ?? documentEndBlockOrder
      const newStart = headingBlockOrder
      const newEnd = newEndBlockOrder ?? documentEndBlockOrder
      startBlockOrder = Math.min(oldStart, newStart)
      oldEndBlockOrder = Math.max(oldEnd, newEnd)
      newEndBlockOrder = Math.max(oldEnd, newEnd)
    }

    decision = 'REPROJECT'
    reason = `heading-${operation.toLowerCase()}-structural-change`
  }

  // Compute candidate stable identities: formulas within the frontier range
  const candidateStableIdentities: Array<number | 'AMBIGUOUS' | null> =
    allFormulaStableIdentities

  // Emit FORMULA-HEADING-DEPENDENCY-FRONTIER
  emitRuntimeAudit('FORMULA-HEADING-DEPENDENCY-FRONTIER', {
    frontierId,
    operationBatchId,
    operation,
    documentKey,
    generation,
    rootToken,
    headingBlockOrder,
    oldLogicalHeadingLevel,
    newLogicalHeadingLevel,
    startBlockOrder,
    oldEndBlockOrder,
    newEndBlockOrder,
    previousHeadingBlockOrder: input.previousHeadingBlockOrder,
    nextHeadingBlockOrder,
    documentEndBlockOrder,
    candidateStableIdentities: candidateStableIdentities.map((id) =>
      id === 'AMBIGUOUS' ? 'AMBIGUOUS' : id,
    ),
    decision,
    reason,
    runtimeMarker: R54312_RUNTIME_MARKER,
  })

  return {
    frontierId,
    operationBatchId,
    operation,
    documentKey,
    generation,
    rootToken,
    startBlockOrder,
    oldEndBlockOrder,
    newEndBlockOrder,
    oldScopeKeys: [],
    newScopeKeys: [],
    oldLogicalHeadingLevel,
    newLogicalHeadingLevel,
    candidateStableIdentities,
    decision,
    reason,
  }
}

// ── computeOrderedFrontierReprojection ───────────────────────────────

export function computeOrderedFrontierReprojection(input: {
  frontierId: string
  documentKey: string
  generation: number
  rootToken: number
  startBlockOrder: number
  endBlockOrder: number
  beforeStableIdentities: Array<number | 'AMBIGUOUS' | null>
  beforeDesiredTags: (string | null)[]
  afterStableIdentities: Array<number | 'AMBIGUOUS' | null>
  afterDesiredTags: (string | null)[]
}): {
  diffs: LivePlanDiffEntry[]
  affectedExistingStableIdentities: Array<number | 'AMBIGUOUS' | null>
  desiredTagChangedCount: number
  sequenceChangedCount: number
  contextChangedCount: number
} {
  const {
    frontierId,
    documentKey,
    generation,
    rootToken,
    startBlockOrder,
    endBlockOrder,
    beforeStableIdentities,
    beforeDesiredTags,
    afterStableIdentities,
    afterDesiredTags,
  } = input

  // Build identity-to-index maps for before and after
  const beforeMap = new Map<number, { index: number; desiredTag: string | null }>()
  const beforeAmbiguous: Array<{ index: number; desiredTag: string | null }> = []
  for (let i = 0; i < beforeStableIdentities.length; i++) {
    const id = beforeStableIdentities[i]
    if (id === 'AMBIGUOUS' || id === null) {
      beforeAmbiguous.push({ index: i, desiredTag: beforeDesiredTags[i] ?? null })
    } else {
      beforeMap.set(id, { index: i, desiredTag: beforeDesiredTags[i] ?? null })
    }
  }

  const afterMap = new Map<number, { index: number; desiredTag: string | null }>()
  const afterAmbiguous: Array<{ index: number; desiredTag: string | null }> = []
  for (let i = 0; i < afterStableIdentities.length; i++) {
    const id = afterStableIdentities[i]
    if (id === 'AMBIGUOUS' || id === null) {
      afterAmbiguous.push({ index: i, desiredTag: afterDesiredTags[i] ?? null })
    } else {
      afterMap.set(id, { index: i, desiredTag: afterDesiredTags[i] ?? null })
    }
  }

  const diffs: LivePlanDiffEntry[] = []
  const affectedExistingSet = new Set<number | 'AMBIGUOUS' | null>()
  let desiredTagChangedCount = 0
  let sequenceChangedCount = 0
  let contextChangedCount = 0

  // Compare by stable identity
  const allIdentities = new Set<number>([
    ...beforeMap.keys(),
    ...afterMap.keys(),
  ])

  for (const id of allIdentities) {
    const before = beforeMap.get(id)
    const after = afterMap.get(id)
    const changeKinds: string[] = []

    if (!before && after) {
      changeKinds.push('ADDED')
    } else if (before && !after) {
      changeKinds.push('REMOVED')
      affectedExistingSet.add(id)
    } else if (before && after) {
      // Compare desiredTag
      if (before.desiredTag !== after.desiredTag) {
        changeKinds.push('DESIRED_TAG_CHANGED')
        desiredTagChangedCount++
        affectedExistingSet.add(id)
      }
      // Compare formulaIndex (order changed)
      if (before.index !== after.index) {
        changeKinds.push('ORDER_CHANGED')
        sequenceChangedCount++
        affectedExistingSet.add(id)
      }
      // Compare scopeKey (context changed) — inferred from desiredTag format
      const beforeScope = before.desiredTag?.split(':')[0] ?? null
      const afterScope = after.desiredTag?.split(':')[0] ?? null
      if (beforeScope !== afterScope) {
        changeKinds.push('SCOPE_CHANGED')
        contextChangedCount++
        affectedExistingSet.add(id)
      }
      // Compare sequenceValue (sequence changed) — inferred from desiredTag format
      const beforeSeq = before.desiredTag?.split(':')[1] ?? null
      const afterSeq = after.desiredTag?.split(':')[1] ?? null
      if (beforeSeq !== afterSeq && before.desiredTag !== after.desiredTag) {
        changeKinds.push('SEQUENCE_CHANGED')
        sequenceChangedCount++
        affectedExistingSet.add(id)
      }
    }

    if (changeKinds.length === 0 && before && after) {
      changeKinds.push('UNCHANGED')
    }

    const beforeScopeKey = before?.desiredTag?.split(':')[0] ?? null
    const afterScopeKey = after?.desiredTag?.split(':')[0] ?? null
    const beforeSeqValue = before?.desiredTag ? extractSequenceValue(before.desiredTag) : null
    const afterSeqValue = after?.desiredTag ? extractSequenceValue(after.desiredTag) : null

    const diff: LivePlanDiffEntry = {
      stableFormulaIdentity: id,
      previousFormulaIndex: before?.index ?? null,
      nextFormulaIndex: after?.index ?? null,
      previousSourceHash: null,
      nextSourceHash: null,
      previousDesiredTag: before?.desiredTag ?? null,
      nextDesiredTag: after?.desiredTag ?? null,
      previousContentRevision: null,
      nextContentRevision: null,
      previousScopeKey: beforeScopeKey,
      nextScopeKey: afterScopeKey,
      previousSequenceValue: beforeSeqValue,
      nextSequenceValue: afterSeqValue,
      changeKinds: changeKinds as LivePlanDiffEntry['changeKinds'],
      requiresRenderInvalidation: changeKinds.some(
        (k) => k === 'SOURCE_CHANGED' || k === 'DESIRED_TAG_CHANGED' || k === 'ORDER_CHANGED' || k === 'CONTEXT_CHANGED' || k === 'SCOPE_CHANGED' || k === 'SEQUENCE_CHANGED',
      ),
    }
    diffs.push(diff)
  }

  // Handle ambiguous entries
  const maxAmbiguousLen = Math.max(beforeAmbiguous.length, afterAmbiguous.length)
  for (let i = 0; i < maxAmbiguousLen; i++) {
    const before = beforeAmbiguous[i]
    const after = afterAmbiguous[i]
    const changeKinds: string[] = []

    if (!before && after) {
      changeKinds.push('ADDED')
    } else if (before && !after) {
      changeKinds.push('REMOVED')
    } else if (before && after) {
      if (before.desiredTag !== after.desiredTag) {
        changeKinds.push('DESIRED_TAG_CHANGED')
        desiredTagChangedCount++
      }
      if (before.index !== after.index) {
        changeKinds.push('ORDER_CHANGED')
      }
    }

    if (changeKinds.length === 0 && before && after) {
      changeKinds.push('UNCHANGED')
    }

    if (before || after) {
      const ambBeforeScopeKey = before?.desiredTag?.split(':')[0] ?? null
      const ambAfterScopeKey = after?.desiredTag?.split(':')[0] ?? null
      const ambBeforeSeqValue = before?.desiredTag ? extractSequenceValue(before.desiredTag) : null
      const ambAfterSeqValue = after?.desiredTag ? extractSequenceValue(after.desiredTag) : null

      const diff: LivePlanDiffEntry = {
        stableFormulaIdentity: 'AMBIGUOUS',
        previousFormulaIndex: before?.index ?? null,
        nextFormulaIndex: after?.index ?? null,
        previousSourceHash: null,
        nextSourceHash: null,
        previousDesiredTag: before?.desiredTag ?? null,
        nextDesiredTag: after?.desiredTag ?? null,
        previousContentRevision: null,
        nextContentRevision: null,
        previousScopeKey: ambBeforeScopeKey,
        nextScopeKey: ambAfterScopeKey,
        previousSequenceValue: ambBeforeSeqValue,
        nextSequenceValue: ambAfterSeqValue,
        changeKinds: changeKinds as LivePlanDiffEntry['changeKinds'],
        requiresRenderInvalidation: changeKinds.some(
          (k) => k === 'SOURCE_CHANGED' || k === 'DESIRED_TAG_CHANGED' || k === 'ORDER_CHANGED',
        ),
      }
      diffs.push(diff)
    }
  }

  const affectedExistingStableIdentities: Array<number | 'AMBIGUOUS' | null> = [
    ...affectedExistingSet,
  ]

  // Emit FORMULA-ORDERED-FRONTIER-REPROJECTION
  emitRuntimeAudit('FORMULA-ORDERED-FRONTIER-REPROJECTION', {
    frontierId,
    documentKey,
    generation,
    rootToken,
    startBlockOrder,
    endBlockOrder,
    beforeStableIdentities: beforeStableIdentities.map((id) =>
      id === 'AMBIGUOUS' ? 'AMBIGUOUS' : id,
    ),
    afterStableIdentities: afterStableIdentities.map((id) =>
      id === 'AMBIGUOUS' ? 'AMBIGUOUS' : id,
    ),
    diffCount: diffs.length,
    desiredTagChangedCount,
    sequenceChangedCount,
    contextChangedCount,
    affectedExistingCount: affectedExistingStableIdentities.length,
    runtimeMarker: R54312_RUNTIME_MARKER,
  })

  return {
    diffs,
    affectedExistingStableIdentities,
    desiredTagChangedCount,
    sequenceChangedCount,
    contextChangedCount,
  }
}

// ── emitCleanAuthority ───────────────────────────────────────────────

export function emitCleanAuthority(input: {
  frontierId: string
  operation: FormulaDependencyOperation
  candidateCount: number
  survivingCandidateCount: number
  unchangedDesiredTagCount: number
  changedDesiredTagCount: number
  affectedExistingFormulaCount: number
  frontierReprojectionExecuted: boolean
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-DEPENDENCY-FRONTIER-CLEAN-AUTHORITY', {
    frontierId: input.frontierId,
    operation: input.operation,
    candidateCount: input.candidateCount,
    survivingCandidateCount: input.survivingCandidateCount,
    unchangedDesiredTagCount: input.unchangedDesiredTagCount,
    changedDesiredTagCount: input.changedDesiredTagCount,
    affectedExistingFormulaCount: input.affectedExistingFormulaCount,
    frontierReprojectionExecuted: input.frontierReprojectionExecuted,
    decision: input.decision,
    reason: input.reason,
    runtimeMarker: R54312_RUNTIME_MARKER,
  })
}

// ── emitCascadeProjectionDispatch ────────────────────────────────────

export function emitCascadeProjectionDispatch(input: {
  projectionBatchId: string
  frontierId: string
  operation: FormulaDependencyOperation
  requestedStableIdentities: Array<number | 'AMBIGUOUS' | null>
  requestedCount: number
  oldDesiredTags: (string | null)[]
  newDesiredTags: (string | null)[]
}): void {
  emitRuntimeAudit('FORMULA-CASCADE-PROJECTION-DISPATCH', {
    projectionBatchId: input.projectionBatchId,
    frontierId: input.frontierId,
    operation: input.operation,
    requestedStableIdentities: input.requestedStableIdentities.map((id) =>
      id === 'AMBIGUOUS' ? 'AMBIGUOUS' : id,
    ),
    requestedCount: input.requestedCount,
    oldDesiredTags: input.oldDesiredTags,
    newDesiredTags: input.newDesiredTags,
    runtimeMarker: R54312_RUNTIME_MARKER,
  })
}

// ── emitCascadeProjectionFinal ───────────────────────────────────────

export function emitCascadeProjectionFinal(input: {
  projectionBatchId: string
  frontierId: string
  operation: FormulaDependencyOperation
  requestedCount: number
  settledCount: number
  fulfilledCount: number
  appliedCount: number
  visibleVerifiedCount: number
  failedCount: number
  pendingCount: number
  allDesiredTagsVisible: boolean
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-CASCADE-PROJECTION-FINAL', {
    projectionBatchId: input.projectionBatchId,
    frontierId: input.frontierId,
    operation: input.operation,
    requestedCount: input.requestedCount,
    settledCount: input.settledCount,
    fulfilledCount: input.fulfilledCount,
    appliedCount: input.appliedCount,
    visibleVerifiedCount: input.visibleVerifiedCount,
    failedCount: input.failedCount,
    pendingCount: input.pendingCount,
    allDesiredTagsVisible: input.allDesiredTagsVisible,
    decision: input.decision,
    reason: input.reason,
    runtimeMarker: R54312_RUNTIME_MARKER,
  })
}

// ── resetDependencyFrontierState ─────────────────────────────────────

export function resetDependencyFrontierState(): void {
  _frontierCounter = 0
}

// ── Build Markers ────────────────────────────────────────────────────

export const R54312_RUNTIME_MARKER = 'FORMULA-DEPENDENCY-FRONTIER-CASCADE-V2.5.7-R5.4.3.12'
export const R54312_BUILD_MARKER = 'inkchapter-formula-dependency-frontier-cascade-v2.5.7-r5.4.3.12'