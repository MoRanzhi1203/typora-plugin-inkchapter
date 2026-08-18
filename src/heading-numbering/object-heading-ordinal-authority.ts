/**
 * Shared Object Heading Ordinal Authority (v2.5.3).
 *
 * A single structured heading-number state source consumed by table / figure /
 * code / formula object numbering. Ordinals come from the numeric `counters`
 * produced by the Heading Numbering engine — NEVER parsed back out of the
 * rendered display label (`data-inkchapter-heading-number`).
 *
 * This module is PURE: it maps `NumberedHeading[]` (which already carry the
 * numeric counter path) into a stable, role-mapped index and resolves an object
 * target's nearest preceding logical chapter / section / subsection by document
 * order.
 */

import {
  resolveLogicalHeadingRoleMap,
  type LogicalHeadingRoleMap,
} from './heading-context-resolver'
import type { NumberedHeading } from './heading-types'

export type LogicalHeadingRole = 'chapter' | 'section' | 'subsection'

/**
 * Structured read-only heading number state (spec §10).
 * `ordinal` is the heading's OWN logical counter value; `numberingPath` is the
 * full logical path (e.g. `[5,1]` for chapter 5 section 1).
 */
export interface StructuredHeadingNumberState {
  headingId: string
  node: HTMLElement | null
  documentKey: string
  physicalLevel: number
  logicalDepth: number | null
  logicalRole: LogicalHeadingRole | null
  ordinal: number | null
  numberingPath: number[]
  renderedLabel: string | null
  numbered: boolean
}

/** Per-document ordered heading index (spec §14 + v2.5.4 generation binding). */
export interface ObjectHeadingIndex {
  documentKey: string
  revision: number
  /** v2.5.4: increments on every real document switch. */
  documentGeneration: number
  /** v2.5.4: stable token for the editor root the index was built from. */
  editorRootToken: number
  entries: StructuredHeadingNumberState[]
}

export type ObjectHeadingContextDecision = 'RESOLVED' | 'PARTIAL' | 'NONE'

/** Resolved ordinal context for a single object target (spec §19). */
export interface ObjectHeadingOrdinalContext {
  documentKey: string
  chapterHeadingId: string | null
  sectionHeadingId: string | null
  subsectionHeadingId: string | null
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  subsectionOrdinal: number | null
  chapterPhysicalLevel: number | null
  sectionPhysicalLevel: number | null
  subsectionPhysicalLevel: number | null
  decision: ObjectHeadingContextDecision
  /** v2.5.4: provenance of this context (live DOM + structured ordinal). */
  source?: string
  /** v2.5.6: immutable snapshot identity (OBJECT-CONTEXT-SNAPSHOT-V2). */
  snapshotId?: string | null
  /** v2.5.6: block ordinal captured when this snapshot was created. */
  snapshotBlockOrdinal?: number | null
  /** v2.5.6: heading index revision at snapshot time. */
  snapshotRevision?: number
}

/** Map a physical heading level to its logical role for the active structure mode. */
export function roleForPhysicalLevel(
  physicalLevel: number,
  roleMap: LogicalHeadingRoleMap,
): LogicalHeadingRole | null {
  if (physicalLevel === roleMap.chapterPhysicalLevel) return 'chapter'
  if (physicalLevel === roleMap.sectionPhysicalLevel) return 'section'
  if (physicalLevel === roleMap.subsectionPhysicalLevel) return 'subsection'
  return null
}

/**
 * Build the logical numbering path (chapter → section → subsection) from the
 * engine's numeric counters. The hidden H1 title (strict mode) is excluded
 * because path construction walks only the logical role levels.
 */
export function buildNumberingPath(
  counters: readonly number[],
  physicalLevel: number,
  roleMap: LogicalHeadingRoleMap,
): number[] {
  const path: number[] = []
  const roles: Array<{ physicalLevel: number }> = [
    { physicalLevel: roleMap.chapterPhysicalLevel },
    { physicalLevel: roleMap.sectionPhysicalLevel },
    { physicalLevel: roleMap.subsectionPhysicalLevel },
  ]
  for (const r of roles) {
    if (r.physicalLevel > physicalLevel) break
    const v = counters[r.physicalLevel - 1]
    path.push(typeof v === 'number' && v >= 1 ? v : 0)
  }
  return path
}

/**
 * Map `NumberedHeading[]` (engine output) into structured states. Pure and
 * jsdom-testable. `nodeByKey` is optional (headingId → DOM element).
 */
export function buildStructuredHeadingStates(
  numbered: readonly NumberedHeading[],
  roleMap: LogicalHeadingRoleMap,
  documentKey: string,
  nodeByKey?: ReadonlyMap<string, HTMLElement>,
): StructuredHeadingNumberState[] {
  return numbered.map((h) => {
    const role = roleForPhysicalLevel(h.level, roleMap)
    const path = buildNumberingPath(h.counters, h.level, roleMap)
    const own = h.counters[h.level - 1]
    const numberedFlag = h.label !== ''
    return {
      headingId: h.key,
      node: nodeByKey?.get(h.key) ?? null,
      documentKey,
      physicalLevel: h.level,
      logicalDepth: role === 'chapter' ? 1 : role === 'section' ? 2 : role === 'subsection' ? 3 : null,
      logicalRole: role,
      ordinal: role !== null && numberedFlag && typeof own === 'number' && own >= 1 ? own : null,
      numberingPath: path,
      renderedLabel: numberedFlag ? h.label : null,
      numbered: numberedFlag,
    }
  })
}

/** Build an immutable-feeling ordered index from structured states (spec §14). */
export function buildObjectHeadingIndex(
  documentKey: string,
  states: readonly StructuredHeadingNumberState[],
  revision: number,
  documentGeneration = 0,
  editorRootToken = 0,
): ObjectHeadingIndex {
  return { documentKey, revision, documentGeneration, editorRootToken, entries: [...states] }
}

/** Best-effort document-order precedence test. */
function precedes(node: HTMLElement | null, target: HTMLElement): boolean {
  if (!node || !target) return false
  if (!node.isConnected || !target.isConnected) return false
  try {
    return (node.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  } catch {
    return false
  }
}

/**
 * Resolve the nearest preceding logical chapter / section / subsection for an
 * object target by walking the ordered heading index in document order. Never
 * uses `target.closest(h2/h3)` and never parses display labels.
 */
export function resolveObjectHeadingOrdinalContext(
  target: HTMLElement,
  documentKey: string,
  headingIndex: ObjectHeadingIndex,
  roleMap: LogicalHeadingRoleMap,
): ObjectHeadingOrdinalContext {
  let chapter: StructuredHeadingNumberState | null = null
  let section: StructuredHeadingNumberState | null = null
  let subsection: StructuredHeadingNumberState | null = null

  for (const entry of headingIndex.entries) {
    if (!precedes(entry.node, target)) continue
    if (entry.logicalRole === 'chapter') {
      chapter = entry
      section = null
      subsection = null
    } else if (entry.logicalRole === 'section') {
      section = entry
      subsection = null
    } else if (entry.logicalRole === 'subsection') {
      subsection = entry
    }
  }

  const chapterOrdinal = chapter?.ordinal ?? null
  const sectionOrdinal = section?.ordinal ?? null
  const subsectionOrdinal = subsection?.ordinal ?? null

  let decision: ObjectHeadingContextDecision
  if (chapterOrdinal !== null) {
    decision = 'RESOLVED'
  } else if (sectionOrdinal !== null || subsectionOrdinal !== null) {
    decision = 'PARTIAL'
  } else {
    decision = 'NONE'
  }

  return {
    documentKey,
    chapterHeadingId: chapter?.headingId ?? null,
    sectionHeadingId: section?.headingId ?? null,
    subsectionHeadingId: subsection?.headingId ?? null,
    chapterOrdinal,
    sectionOrdinal,
    subsectionOrdinal,
    chapterPhysicalLevel: roleMap.chapterPhysicalLevel,
    sectionPhysicalLevel: roleMap.sectionPhysicalLevel,
    subsectionPhysicalLevel: roleMap.subsectionPhysicalLevel,
    decision,
  }
}

/** Convenience: resolve the role map for a structure mode without re-importing the resolver. */
export function resolveObjectHeadingRoleMap(mode: 'strict' | 'loose'): LogicalHeadingRoleMap {
  return resolveLogicalHeadingRoleMap(mode)
}

// ── v2.5.4: Document Generation Gate + Live DOM Projection ──────────

export interface ObjectContextGenerationGateInput {
  currentDocumentKey: string | null
  indexDocumentKey: string
  targetDocumentKey: string
  currentDocumentGeneration: number
  indexDocumentGeneration: number
  currentEditorRootToken: number
  indexEditorRootToken: number
  targetEditorRootToken: number
}

export interface ObjectContextGenerationGateResult {
  sameDocument: boolean
  sameGeneration: boolean
  sameRoot: boolean
  decision: 'PASS' | 'BLOCK'
  reason: string | null
}

/** Enforce that a target resolves ONLY against a same-generation, same-root index. */
export function checkObjectContextGenerationGate(
  input: ObjectContextGenerationGateInput,
): ObjectContextGenerationGateResult {
  const sameDocument = input.currentDocumentKey === input.indexDocumentKey
    && input.indexDocumentKey === input.targetDocumentKey
  const sameGeneration = input.currentDocumentGeneration === input.indexDocumentGeneration
  const sameRoot = input.currentEditorRootToken === input.indexEditorRootToken
    && input.indexEditorRootToken === input.targetEditorRootToken

  let decision: 'PASS' | 'BLOCK' = 'PASS'
  let reason: string | null = null
  if (!sameDocument) {
    decision = 'BLOCK'
    reason = 'BLOCK_CROSS_DOCUMENT_GENERATION'
  } else if (!sameGeneration) {
    decision = 'BLOCK'
    reason = 'BLOCK_CROSS_DOCUMENT_GENERATION'
  } else if (!sameRoot) {
    decision = 'BLOCK'
    reason = 'BLOCK_STALE_EDITOR_ROOT'
  }

  return { sameDocument, sameGeneration, sameRoot, decision, reason }
}

export interface LiveHeadingEntry {
  element: HTMLElement
  /** Stable live heading identity (data-inkchapter-heading-id / elementKey). */
  headingId: string
}

export interface LiveObjectTargetEntry {
  element: HTMLElement
  objectType: 'table' | 'figure' | 'code' | 'formula'
  runtimeKey: string
}

/** One event in the interleaved live document order stream (spec §C). */
export interface LiveDocumentNumberingEvent {
  eventIndex: number
  kind: 'heading' | 'object'
  objectType: 'table' | 'figure' | 'code' | 'formula' | null
  runtimeKey: string | null
  nodeToken: number
  headingId: string | null
  physicalLevel: number | null
  logicalRole: LogicalHeadingRole | null
  ordinal: number | null
  currentChapterOrdinal: number | null
  currentSectionOrdinal: number | null
  /** v2.5.6: top-level document block ordinal (authoritative order). */
  blockOrdinal: number
  /** v2.5.6: deterministic order within the shared top-level block. */
  intraBlockOrdinal: number
  /** v2.5.6: stable token for the top-level anchor node. */
  anchorNodeToken: number
  /** v2.5.6: stable token for the original source node. */
  sourceNodeToken: number
}

/** v2.5.6: normalized top-level document block anchor (DOCUMENT-BLOCK-ANCHOR). */
export interface DocumentBlockAnchor {
  sourceNode: HTMLElement
  anchorNode: HTMLElement
  editorRoot: HTMLElement
  editorRootToken: number
  blockOrdinal: number
  intraBlockOrdinal: number
  kind: 'heading' | 'table' | 'figure' | 'code' | 'formula'
  runtimeKey: string
}

export type DocumentBlockAnchorDecision = 'RESOLVED' | 'BLOCK_ANCHOR_NOT_FOUND'

export interface DocumentBlockAnchorResolution {
  anchor: DocumentBlockAnchor | null
  decision: DocumentBlockAnchorDecision
  reason: string | null
}

/** v2.5.6: per-object immutable context snapshot (OBJECT-CONTEXT-SNAPSHOT-V2). */
export interface ObjectContextSnapshotV2 {
  objectType: 'table' | 'figure' | 'code' | 'formula'
  runtimeKey: string
  formulaIndex: number | null
  sourceNodeToken: number
  anchorNodeToken: number
  blockOrdinal: number
  previousHeadingBlockOrdinal: number | null
  chapterHeadingId: string | null
  chapterOrdinal: number | null
  sectionHeadingId: string | null
  sectionOrdinal: number | null
  snapshotId: string
  decision: ObjectHeadingContextDecision
}

/** v2.5.6: nearest-prior heading verification (OBJECT-CONTEXT-ORDER-VERIFY). */
export interface ObjectContextOrderVerify {
  runtimeKey: string
  objectBlockOrdinal: number
  selectedChapterBlockOrdinal: number | null
  nearestPriorChapterBlockOrdinal: number | null
  selectedSectionBlockOrdinal: number | null
  nearestPriorSectionBlockOrdinal: number | null
  chapterNearestMatch: boolean
  sectionNearestMatch: boolean
  decision: 'PASS' | 'FAIL'
}

/** v2.5.6: ordered block stream summary (DOCUMENT-BLOCK-STREAM). */
export interface DocumentBlockStream {
  documentKey: string
  documentGeneration: number
  editorRootToken: number
  eventCount: number
  headingEventCount: number
  objectEventCount: number
  firstObjectEventIndex: number | null
  lastHeadingEventIndex: number | null
  monotonicBlockOrder: boolean
  duplicateAnchorCount: number
  unresolvedAnchorCount: number
  decision: 'PASS' | 'FAIL'
}

export interface LiveObjectContextProjectionResult {
  contexts: ObjectHeadingOrdinalContext[]
  events: LiveDocumentNumberingEvent[]
  liveHeadingCount: number
  matchedHeadingCount: number
  unmatchedHeadingCount: number
  objectContextSnapshotCount: number
  contextOrderMismatchCount: number
  /** v2.5.6: normalized block anchors for every resolved candidate. */
  anchors: DocumentBlockAnchor[]
  /** v2.5.6: immutable object context snapshots. */
  snapshots: ObjectContextSnapshotV2[]
  /** v2.5.6: nearest-prior heading verifications. */
  orderVerifies: ObjectContextOrderVerify[]
  /** v2.5.6: ordered block stream summary. */
  stream: DocumentBlockStream
}

/** v2.5.6: workspace active document gate (WORKSPACE-ACTIVE-DOCUMENT-GATE). */
export interface WorkspaceActiveDocumentGateInput {
  workspaceActivePath: string | null
  workspaceDocumentKey: string | null
  serviceDocumentKey: string | null
  headingIndexDocumentKey: string
  documentGeneration: number
  editorRootToken: number
  businessReady: boolean
}

export interface WorkspaceActiveDocumentGateResult {
  workspaceActivePath: string | null
  workspaceDocumentKey: string | null
  serviceDocumentKey: string | null
  headingIndexDocumentKey: string
  documentGeneration: number
  editorRootToken: number
  businessReady: boolean
  decision: 'PASS' | 'BLOCK'
  reason: string | null
}

/**
 * v2.5.6: when the workspace's real active document key diverges from the
 * service's internal document key, business numbering MUST be blocked until
 * Document Context READY (PRE_DOCUMENT_CONTEXT_SWITCH).
 */
export function checkWorkspaceActiveDocumentGate(
  input: WorkspaceActiveDocumentGateInput,
): WorkspaceActiveDocumentGateResult {
  const base = {
    workspaceActivePath: input.workspaceActivePath,
    workspaceDocumentKey: input.workspaceDocumentKey,
    serviceDocumentKey: input.serviceDocumentKey,
    headingIndexDocumentKey: input.headingIndexDocumentKey,
    documentGeneration: input.documentGeneration,
    editorRootToken: input.editorRootToken,
    businessReady: input.businessReady,
  }
  const workspaceKey = input.workspaceDocumentKey
  const serviceKey = input.serviceDocumentKey
  if (workspaceKey !== null && serviceKey !== null && workspaceKey !== serviceKey) {
    return { ...base, decision: 'BLOCK', reason: 'PRE_DOCUMENT_CONTEXT_SWITCH' }
  }
  return { ...base, decision: 'PASS', reason: null }
}

/** Total document order via live DOM (both elements connected in the same document). */
export function documentOrderCompare(a: HTMLElement, b: HTMLElement): number {
  if (a === b) return 0
  const pos = a.compareDocumentPosition(b)
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1
  return 0
}

/**
 * v2.5.6 core: every live heading / object is FIRST normalized to its top-level
 * document block child (`anchorNode` whose parent is `editorRoot`), then all
 * candidates are sorted by `blockOrdinal` / `intraBlockOrdinal`. This is the
 * authoritative document order — never `compareDocumentPosition` on arbitrary
 * source nodes (which returns 0 for disconnected trees and silently collapses
 * to "all headings first, all objects last").
 */
export function resolveDocumentBlockAnchor(
  sourceNode: HTMLElement,
  editorRoot: HTMLElement,
  kind: DocumentBlockAnchor['kind'],
  runtimeKey: string,
  editorRootToken = 0,
): DocumentBlockAnchorResolution {
  if (sourceNode === editorRoot) {
    return { anchor: null, decision: 'BLOCK_ANCHOR_NOT_FOUND', reason: 'SOURCE_IS_EDITOR_ROOT' }
  }
  // Walk up until we find the innermost node whose parent IS the editor root.
  let anchorNode: HTMLElement | null = null
  let el: HTMLElement | null = sourceNode
  while (el && el !== editorRoot) {
    if (el.parentElement === editorRoot) {
      anchorNode = el
      break
    }
    el = el.parentElement
  }
  if (!anchorNode) {
    return { anchor: null, decision: 'BLOCK_ANCHOR_NOT_FOUND', reason: 'NO_ROOT_CHILD_ANCHOR' }
  }
  if (!editorRoot.contains(anchorNode)) {
    return { anchor: null, decision: 'BLOCK_ANCHOR_NOT_FOUND', reason: 'ANCHOR_NOT_IN_EDITOR_ROOT' }
  }
  const blockOrdinal = Array.from(editorRoot.children).indexOf(anchorNode)
  if (blockOrdinal < 0) {
    return { anchor: null, decision: 'BLOCK_ANCHOR_NOT_FOUND', reason: 'ANCHOR_NOT_ROOT_CHILD' }
  }
  return {
    anchor: {
      sourceNode,
      anchorNode,
      editorRoot,
      editorRootToken,
      blockOrdinal,
      intraBlockOrdinal: computeIntraBlockOrdinal(sourceNode, anchorNode),
      kind,
      runtimeKey,
    },
    decision: 'RESOLVED',
    reason: null,
  }
}

/** Deterministic document order of `sourceNode` within its top-level anchor block. */
function computeIntraBlockOrdinal(sourceNode: HTMLElement, anchorNode: HTMLElement): number {
  if (sourceNode === anchorNode) return 0
  const walker = document.createTreeWalker(anchorNode, NodeFilter.SHOW_ELEMENT, null)
  let idx = 0
  let node: Node | null = walker.nextNode()
  while (node) {
    if (node === sourceNode) return idx
    idx++
    node = walker.nextNode()
  }
  return idx
}

interface OrderedAnchorItem {
  anchor: DocumentBlockAnchor
  headingId: string | null
  state: StructuredHeadingNumberState | null
  objectType: 'table' | 'figure' | 'code' | 'formula' | null
  runtimeKey: string | null
}

interface HeadingAnchorInfo {
  headingId: string
  logicalRole: LogicalHeadingRole | null
  blockOrdinal: number
  intraBlockOrdinal: number
}

/** Nearest prior heading (by block ordinal) of a given logical role. */
function nearestPriorHeading(
  headingAnchors: readonly HeadingAnchorInfo[],
  objectBlockOrdinal: number,
  role: LogicalHeadingRole,
): HeadingAnchorInfo | null {
  let best: HeadingAnchorInfo | null = null
  for (const h of headingAnchors) {
    if (h.logicalRole !== role) continue
    if (h.blockOrdinal >= objectBlockOrdinal) continue
    if (!best || h.blockOrdinal > best.blockOrdinal) best = h
  }
  return best
}

/**
 * v2.5.6 core: live editor DOM decides heading/object ORDER via top-level
 * document block anchors (blockOrdinal / intraBlockOrdinal). Structured heading
 * state only provides identity + numeric ordinal. Each object snapshots the
 * current heading context at the moment it appears (immutable copy); later
 * headings never mutate an already-captured snapshot.
 */
export function projectLiveObjectHeadingContexts(
  liveHeadings: readonly LiveHeadingEntry[],
  objectTargets: readonly LiveObjectTargetEntry[],
  headingIndex: ObjectHeadingIndex,
  roleMap: LogicalHeadingRoleMap,
  editorRoot: HTMLElement,
  editorRootToken = 0,
): LiveObjectContextProjectionResult {
  const stateByHeadingId = new Map<string, StructuredHeadingNumberState>()
  for (const entry of headingIndex.entries) {
    if (!stateByHeadingId.has(entry.headingId)) stateByHeadingId.set(entry.headingId, entry)
  }

  const nodeTokens = new WeakMap<HTMLElement, number>()
  let nextNodeToken = 0
  const tokenFor = (el: HTMLElement): number => {
    let t = nodeTokens.get(el)
    if (t === undefined) {
      t = ++nextNodeToken
      nodeTokens.set(el, t)
    }
    return t
  }

  const items: OrderedAnchorItem[] = []
  let matchedHeadingCount = 0
  let unmatchedHeadingCount = 0
  let unresolvedAnchorCount = 0

  for (const h of liveHeadings) {
    const state = stateByHeadingId.get(h.headingId) ?? null
    if (state) matchedHeadingCount++
    else unmatchedHeadingCount++
    const res = resolveDocumentBlockAnchor(h.element, editorRoot, 'heading', h.headingId, editorRootToken)
    if (!res.anchor) {
      unresolvedAnchorCount++
      continue
    }
    items.push({ anchor: res.anchor, headingId: h.headingId, state, objectType: null, runtimeKey: null })
  }
  for (const t of objectTargets) {
    const res = resolveDocumentBlockAnchor(t.element, editorRoot, t.objectType, t.runtimeKey, editorRootToken)
    if (!res.anchor) {
      unresolvedAnchorCount++
      continue
    }
    items.push({ anchor: res.anchor, headingId: null, state: null, objectType: t.objectType, runtimeKey: t.runtimeKey })
  }

  // True interleaved stream: order by top-level block ordinal, then intra-block order.
  items.sort((a, b) => {
    if (a.anchor.blockOrdinal !== b.anchor.blockOrdinal) return a.anchor.blockOrdinal - b.anchor.blockOrdinal
    return a.anchor.intraBlockOrdinal - b.anchor.intraBlockOrdinal
  })

  const headingAnchors: HeadingAnchorInfo[] = items
    .filter((it) => it.headingId !== null && it.state !== null)
    .map((it) => ({
      headingId: it.headingId as string,
      logicalRole: it.state?.logicalRole ?? null,
      blockOrdinal: it.anchor.blockOrdinal,
      intraBlockOrdinal: it.anchor.intraBlockOrdinal,
    }))

  let currentChapter: StructuredHeadingNumberState | null = null
  let currentSection: StructuredHeadingNumberState | null = null
  let currentSubsection: StructuredHeadingNumberState | null = null
  let currentChapterBlockOrdinal: number | null = null
  let currentSectionBlockOrdinal: number | null = null

  const contexts: ObjectHeadingOrdinalContext[] = []
  const events: LiveDocumentNumberingEvent[] = []
  const snapshots: ObjectContextSnapshotV2[] = []
  const anchors: DocumentBlockAnchor[] = []
  let objectContextSnapshotCount = 0
  let snapshotSeq = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    anchors.push(item.anchor)

    if (item.headingId !== null && item.state !== null) {
      const role = item.state.logicalRole
      if (role === 'chapter') {
        currentChapter = item.state
        currentChapterBlockOrdinal = item.anchor.blockOrdinal
        currentSection = null
        currentSectionBlockOrdinal = null
        currentSubsection = null
      } else if (role === 'section') {
        currentSection = item.state
        currentSectionBlockOrdinal = item.anchor.blockOrdinal
        currentSubsection = null
      } else if (role === 'subsection') {
        currentSubsection = item.state
      }
      events.push({
        eventIndex: i,
        kind: 'heading',
        objectType: null,
        runtimeKey: null,
        nodeToken: tokenFor(item.anchor.sourceNode),
        headingId: item.headingId,
        physicalLevel: item.state.physicalLevel,
        logicalRole: role,
        ordinal: item.state.ordinal,
        currentChapterOrdinal: currentChapter?.ordinal ?? null,
        currentSectionOrdinal: currentSection?.ordinal ?? null,
        blockOrdinal: item.anchor.blockOrdinal,
        intraBlockOrdinal: item.anchor.intraBlockOrdinal,
        anchorNodeToken: tokenFor(item.anchor.anchorNode),
        sourceNodeToken: tokenFor(item.anchor.sourceNode),
      })
      continue
    }

    const chapterOrdinal = currentChapter?.ordinal ?? null
    const sectionOrdinal = currentSection?.ordinal ?? null
    const subsectionOrdinal = currentSubsection?.ordinal ?? null
    let decision: ObjectHeadingContextDecision
    if (chapterOrdinal !== null) decision = 'RESOLVED'
    else if (sectionOrdinal !== null || subsectionOrdinal !== null) decision = 'PARTIAL'
    else decision = 'NONE'

    // Immutable snapshot: copy primitive values NOW, never store a mutable ref.
    snapshotSeq++
    const snapshotId = `snap-${snapshotSeq}`
    const objectType = item.objectType as 'table' | 'figure' | 'code' | 'formula'
    const runtimeKey = item.runtimeKey as string

    const context: ObjectHeadingOrdinalContext = {
      documentKey: headingIndex.documentKey,
      chapterHeadingId: currentChapter?.headingId ?? null,
      sectionHeadingId: currentSection?.headingId ?? null,
      subsectionHeadingId: currentSubsection?.headingId ?? null,
      chapterOrdinal,
      sectionOrdinal,
      subsectionOrdinal,
      chapterPhysicalLevel: roleMap.chapterPhysicalLevel,
      sectionPhysicalLevel: roleMap.sectionPhysicalLevel,
      subsectionPhysicalLevel: roleMap.subsectionPhysicalLevel,
      decision,
      source: 'LIVE_DOM_PLUS_STRUCTURED_HEADING_STATE',
      snapshotId,
      snapshotBlockOrdinal: item.anchor.blockOrdinal,
      snapshotRevision: headingIndex.revision,
    }
    contexts.push(context)
    objectContextSnapshotCount++

    const previousHeadingBlockOrdinal = Math.max(currentChapterBlockOrdinal ?? -1, currentSectionBlockOrdinal ?? -1)
    snapshots.push({
      objectType,
      runtimeKey,
      formulaIndex: objectType === 'formula' ? snapshots.filter((s) => s.objectType === 'formula').length : null,
      sourceNodeToken: tokenFor(item.anchor.sourceNode),
      anchorNodeToken: tokenFor(item.anchor.anchorNode),
      blockOrdinal: item.anchor.blockOrdinal,
      previousHeadingBlockOrdinal: previousHeadingBlockOrdinal >= 0 ? previousHeadingBlockOrdinal : null,
      chapterHeadingId: currentChapter?.headingId ?? null,
      chapterOrdinal,
      sectionHeadingId: currentSection?.headingId ?? null,
      sectionOrdinal,
      snapshotId,
      decision,
    })

    events.push({
      eventIndex: i,
      kind: 'object',
      objectType,
      runtimeKey,
      nodeToken: tokenFor(item.anchor.sourceNode),
      headingId: null,
      physicalLevel: null,
      logicalRole: null,
      ordinal: null,
      currentChapterOrdinal: chapterOrdinal,
      currentSectionOrdinal: sectionOrdinal,
      blockOrdinal: item.anchor.blockOrdinal,
      intraBlockOrdinal: item.anchor.intraBlockOrdinal,
      anchorNodeToken: tokenFor(item.anchor.anchorNode),
      sourceNodeToken: tokenFor(item.anchor.sourceNode),
    })
  }

  // OBJECT-CONTEXT-ORDER-VERIFY: selected heading must be the nearest prior one.
  const orderVerifies: ObjectContextOrderVerify[] = []
  let contextOrderMismatchCount = 0
  for (let i = 0; i < contexts.length; i++) {
    const ctx = contexts[i]
    const snap = snapshots[i]
    if (!snap) continue
    const nearestChapter = nearestPriorHeading(headingAnchors, snap.blockOrdinal, 'chapter')
    const nearestSection = nearestPriorHeading(headingAnchors, snap.blockOrdinal, 'section')
    const selectedChapterBlockOrdinal = headingAnchors.find((h) => h.headingId === ctx.chapterHeadingId)?.blockOrdinal ?? null
    const selectedSectionBlockOrdinal = headingAnchors.find((h) => h.headingId === ctx.sectionHeadingId)?.blockOrdinal ?? null
    const chapterNearestMatch =
      (ctx.chapterHeadingId === null && nearestChapter === null) ||
      (selectedChapterBlockOrdinal !== null && nearestChapter !== null && selectedChapterBlockOrdinal === nearestChapter.blockOrdinal)
    const sectionNearestMatch =
      (ctx.sectionHeadingId === null && nearestSection === null) ||
      (selectedSectionBlockOrdinal !== null && nearestSection !== null && selectedSectionBlockOrdinal === nearestSection.blockOrdinal)
    const verifyDecision: 'PASS' | 'FAIL' = chapterNearestMatch && sectionNearestMatch ? 'PASS' : 'FAIL'
    if (verifyDecision === 'FAIL') contextOrderMismatchCount++
    orderVerifies.push({
      runtimeKey: snap.runtimeKey,
      objectBlockOrdinal: snap.blockOrdinal,
      selectedChapterBlockOrdinal,
      nearestPriorChapterBlockOrdinal: nearestChapter?.blockOrdinal ?? null,
      selectedSectionBlockOrdinal,
      nearestPriorSectionBlockOrdinal: nearestSection?.blockOrdinal ?? null,
      chapterNearestMatch,
      sectionNearestMatch,
      decision: verifyDecision,
    })
  }

  // DOCUMENT-BLOCK-STREAM summary.
  let monotonicBlockOrder = true
  for (let i = 1; i < events.length; i++) {
    if (events[i].blockOrdinal < events[i - 1].blockOrdinal) {
      monotonicBlockOrder = false
      break
    }
  }
  const headingEventCount = events.filter((e) => e.kind === 'heading').length
  const objectEventCount = events.filter((e) => e.kind === 'object').length
  const firstObjectEventIndex = events.find((e) => e.kind === 'object')?.eventIndex ?? null
  let lastHeadingEventIndex: number | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'heading') {
      lastHeadingEventIndex = events[i].eventIndex
      break
    }
  }

  const seenAnchorNodes = new Set<HTMLElement>()
  let duplicateAnchorCount = 0
  for (const it of items) {
    if (seenAnchorNodes.has(it.anchor.anchorNode)) duplicateAnchorCount++
    else seenAnchorNodes.add(it.anchor.anchorNode)
  }

  const stream: DocumentBlockStream = {
    documentKey: headingIndex.documentKey,
    documentGeneration: headingIndex.documentGeneration,
    editorRootToken,
    eventCount: events.length,
    headingEventCount,
    objectEventCount,
    firstObjectEventIndex,
    lastHeadingEventIndex,
    monotonicBlockOrder,
    duplicateAnchorCount,
    unresolvedAnchorCount,
    decision: monotonicBlockOrder ? 'PASS' : 'FAIL',
  }

  return {
    contexts,
    events,
    liveHeadingCount: liveHeadings.length,
    matchedHeadingCount,
    unmatchedHeadingCount,
    objectContextSnapshotCount,
    contextOrderMismatchCount,
    anchors,
    snapshots,
    orderVerifies,
    stream,
  }
}

// ── v2.5.4: True Quiescence (pure, testable) ────────────────────────

export interface TrueQuiescenceInput {
  now: number
  lastBusinessMutationAt: number
  lastFormulaRefreshAt: number
  lastFormulaDomWriteAt: number
  lastDocumentSwitchAt: number
  lastFormulaSettingsChangeAt: number
  pendingRefreshCount: number
  reentrantRefreshCount: number
}

export interface TrueQuiescenceResult {
  idleWindowMs: number
  decision: 'QUIESCENT' | 'NOT_YET_QUIESCENT'
}

/**
 * True quiescence requires a real idle window >= 10000ms AND zero pending /
 * reentrant refreshes. `idleWindowMs=0` is never QUIESCENT.
 */
export function resolveTrueQuiescence(input: TrueQuiescenceInput): TrueQuiescenceResult {
  const idleSince = Math.max(
    input.lastBusinessMutationAt,
    input.lastFormulaRefreshAt,
    input.lastFormulaDomWriteAt,
    input.lastDocumentSwitchAt,
    input.lastFormulaSettingsChangeAt,
  )
  const idleWindowMs = idleSince > 0 ? input.now - idleSince : 0
  const decision: 'QUIESCENT' | 'NOT_YET_QUIESCENT' =
    idleWindowMs >= 10000 && input.pendingRefreshCount === 0 && input.reentrantRefreshCount === 0
      ? 'QUIESCENT'
      : 'NOT_YET_QUIESCENT'
  return { idleWindowMs, decision }
}
