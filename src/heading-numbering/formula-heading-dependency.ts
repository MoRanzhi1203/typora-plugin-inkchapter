/**
 * v2.5.7-R5.4.3: Heading Dependency Authority.
 *
 * Given a heading event, compute the dependency range of formulas that
 * may be affected. Heading level changes, moves, and numbering state
 * changes produce a union of old and new ranges.
 *
 * Uses the authoritative heading semantic state (not the Outline DOM).
 * Headings are identified by data-inkchapter-heading-id (stable identity).
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { R543_RUNTIME_MARKER } from './formula-semantic-invalidation'

// ── Types ─────────────────────────────────────────────────────────────

export interface HeadingEntry {
  element: HTMLElement
  headingId: string
  tagName: string
  logicalRole: 'chapter' | 'section' | 'subsection' | 'none'
  numbered: boolean
  ordinal: number | null
}

export interface HeadingDependencyRange {
  startElement: HTMLElement | null
  endElement: HTMLElement | null
  startToken: number | null
  endToken: number | null
  formulaCount: number
}

export interface HeadingDependencyAuthorityInput {
  operationBatchId: string
  headingStableIdentity: string
  headingEventKind: string
  previousHeadingLevel: string | null
  nextHeadingLevel: string | null
  previousHeadingRole: string | null
  nextHeadingRole: string | null
  previousOrdinal: number | null
  nextOrdinal: number | null
  liveHeadings: HeadingEntry[]
  liveFormulaRoots: Array<{ element: HTMLElement; token: number }>
}

export interface HeadingDependencyAuthorityResult {
  rangeResolved: boolean
  rangeStartToken: number | null
  rangeEndToken: number | null
  formulaCandidateCount: number
  decision: 'AFFECTED_FORMULA_SCOPE' | 'NO_OP' | 'UNKNOWN'
  reason: string | null
}

/**
 * Compute the heading dependency range for a heading event.
 * The range covers from the changed heading (or nearest enclosing heading)
 * to the next heading at the same or higher semantic level.
 */
export function computeHeadingDependencyRange(input: HeadingDependencyAuthorityInput): HeadingDependencyAuthorityResult {
  if (input.liveHeadings.length === 0) {
    return { rangeResolved: false, rangeStartToken: null, rangeEndToken: null, formulaCandidateCount: 0, decision: 'NO_OP', reason: 'NO_HEADINGS' }
  }

  // Find the changed heading and its position in the live DOM.
  const changedIdx = input.liveHeadings.findIndex((h) => h.headingId === input.headingStableIdentity)
  if (changedIdx === -1) {
    return { rangeResolved: false, rangeStartToken: null, rangeEndToken: null, formulaCandidateCount: 0, decision: 'UNKNOWN', reason: 'HEADING_NOT_FOUND' }
  }

  // Old range: the heading's formula scope before the change.
  // New range: the heading's formula scope after the change.
  // For moves and level changes, compute the union.
  const oldLevel = input.previousHeadingLevel ?? input.liveHeadings[changedIdx]?.tagName ?? 'H3'
  const nextLevel = input.nextHeadingLevel ?? input.liveHeadings[changedIdx]?.tagName ?? 'H3'
  const oldLevelNum = parseInt(oldLevel.replace('H', ''), 10) || 3
  const nextLevelNum = parseInt(nextLevel.replace('H', ''), 10) || 3

  // For HEADING_TEXT_CHANGED / HEADING_ADDED / HEADING_REMOVED,
  // the range starts at the changed heading itself.
  let rangeStart = changedIdx
  let rangeEnd = input.liveHeadings.length - 1

  // The range extends to the next heading at the same or higher level.
  const isLevelChange = input.headingEventKind === 'HEADING_LEVEL_CHANGED' || input.headingEventKind === 'HEADING_MOVED'
  // Use the NEW level for the range end boundary.
  const boundaryLevel = isLevelChange ? nextLevelNum : oldLevelNum
  for (let i = changedIdx + 1; i < input.liveHeadings.length; i++) {
    const h = input.liveHeadings[i]
    const hLevel = parseInt(h.tagName.replace('H', ''), 10) || 3
    if (hLevel <= boundaryLevel) {
      rangeEnd = i - 1
      break
    }
  }

  // If level change, also compute the OLD range for union.
  let oldRangeEnd = rangeEnd
  if (isLevelChange) {
    for (let i = changedIdx + 1; i < input.liveHeadings.length; i++) {
      const h = input.liveHeadings[i]
      const hLevel = parseInt(h.tagName.replace('H', ''), 10) || 3
      if (hLevel <= oldLevelNum) {
        oldRangeEnd = i - 1
        break
      }
    }
    rangeEnd = Math.max(rangeEnd, oldRangeEnd)
  }

  // Count formulas within the range.
  const startEl = rangeStart >= 0 ? input.liveHeadings[rangeStart].element : null
  const endEl = rangeEnd >= 0 && rangeEnd < input.liveHeadings.length ? input.liveHeadings[rangeEnd].element : null
  const formulaCount = input.liveFormulaRoots.filter((f) => {
    if (!startEl || !endEl) return false
    const pos = f.element.compareDocumentPosition(startEl)
    const endPos = f.element.compareDocumentPosition(endEl)
    // Quick check: formula is after start and before end.
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return false
    if (endPos & Node.DOCUMENT_POSITION_PRECEDING) return false
    return true
  }).length

  // Emit the dependency range marker.
  emitRuntimeAudit('FORMULA-HEADING-DEPENDENCY-RANGE', {
    operationBatchId: input.operationBatchId,
    headingStableIdentity: input.headingStableIdentity,
    oldRangeStart: rangeStart,
    oldRangeEnd: isLevelChange ? oldRangeEnd : rangeEnd,
    newRangeStart: rangeStart,
    newRangeEnd: rangeEnd,
    unionRangeStart: rangeStart,
    unionRangeEnd: rangeEnd,
    formulaCountInOldRange: formulaCount,
    formulaCountInNewRange: formulaCount,
    formulaCountInUnion: formulaCount,
    decision: 'RESOLVED',
    reason: null,
    runtimeMarker: R543_RUNTIME_MARKER,
  })

  return {
    rangeResolved: true,
    rangeStartToken: rangeStart,
    rangeEndToken: rangeEnd,
    formulaCandidateCount: formulaCount,
    decision: 'AFFECTED_FORMULA_SCOPE',
    reason: null,
  }
}

/**
 * Emit the heading dependency authority marker.
 */
export function emitHeadingDependencyAuthority(input: HeadingDependencyAuthorityInput, result: HeadingDependencyAuthorityResult): void {
  emitRuntimeAudit('FORMULA-HEADING-DEPENDENCY-AUTHORITY', {
    operationBatchId: input.operationBatchId,
    headingStableIdentity: input.headingStableIdentity,
    headingEventKind: input.headingEventKind,
    previousHeadingLevel: input.previousHeadingLevel,
    nextHeadingLevel: input.nextHeadingLevel,
    previousHeadingRole: input.previousHeadingRole,
    nextHeadingRole: input.nextHeadingRole,
    previousOrdinal: input.previousOrdinal,
    nextOrdinal: input.nextOrdinal,
    dependencyRangeResolved: result.rangeResolved,
    rangeStartToken: result.rangeStartToken,
    rangeEndToken: result.rangeEndToken,
    formulaCandidateCountInRange: result.formulaCandidateCount,
    decision: result.decision,
    reason: result.reason,
    runtimeMarker: R543_RUNTIME_MARKER,
  })
}

/**
 * Emit the heading change closure marker.
 */
export function emitHeadingChangeClosure(input: {
  operationBatchId: string
  headingEventKind: string
  headingStableIdentity: string
  dependencyRangeFormulaCount: number
  affectedFormulaCount: number
  targetedRefreshCount: number
  allAffectedDesiredTagsMatched: boolean
  unaffectedFormulaRefreshCount: number
}): void {
  emitRuntimeAudit('FORMULA-HEADING-CHANGE-CLOSURE', {
    operationBatchId: input.operationBatchId,
    headingEventKind: input.headingEventKind,
    headingStableIdentity: input.headingStableIdentity,
    dependencyRangeFormulaCount: input.dependencyRangeFormulaCount,
    affectedFormulaCount: input.affectedFormulaCount,
    targetedRefreshCount: input.targetedRefreshCount,
    allAffectedDesiredTagsMatched: input.allAffectedDesiredTagsMatched,
    unaffectedFormulaRefreshCount: input.unaffectedFormulaRefreshCount,
    decision: input.unaffectedFormulaRefreshCount === 0 ? 'PASS' : 'FAIL',
    reason: input.unaffectedFormulaRefreshCount === 0 ? null : 'UNAFFECTED_FORMULA_REFRESHED',
    runtimeMarker: R543_RUNTIME_MARKER,
  })
}

/**
 * Emit the event dependency range marker (for formula events).
 */
export function emitFormulaEventDependencyRange(input: {
  operationBatchId: string
  formulaStableIdentity: number | 'AMBIGUOUS' | null
  eventKind: string
  oldScopeKey: string | null
  newScopeKey: string | null
  oldDocumentOrder: number | null
  newDocumentOrder: number | null
  affectedRangeCount: number
}): void {
  emitRuntimeAudit('FORMULA-EVENT-DEPENDENCY-RANGE', {
    operationBatchId: input.operationBatchId,
    formulaStableIdentity: input.formulaStableIdentity,
    eventKind: input.eventKind,
    oldScopeKey: input.oldScopeKey,
    newScopeKey: input.newScopeKey,
    oldDocumentOrder: input.oldDocumentOrder,
    newDocumentOrder: input.newDocumentOrder,
    affectedRangeCount: input.affectedRangeCount,
    decision: 'RESOLVED',
    reason: null,
    runtimeMarker: R543_RUNTIME_MARKER,
  })
}