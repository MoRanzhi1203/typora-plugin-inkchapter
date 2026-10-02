/**
 * V5.14-R1 (Phase 2/3) — Document Diagnostics Multi-View Authority: the ONE
 * occurrence-level projection every view consumes.
 *
 * `DiagnosticSemanticAuthority → DiagnosticTargetProjection → …`
 *
 * Editor Marker / Outline Marker / Drawer Entry / Runtime Closure Audit all read
 * THIS projection. No view may re-count targets or re-guess a document position.
 *
 * Pure contract: no DOM, no host state. See `DOCUMENT-DIAGNOSTIC-DRAWER-ORDER-AUDIT`.
 */
import type { DiagnosticLocation, DocumentDiagnostic } from './diagnostics-types'

export type DiagnosticSeverityV514 = 'error' | 'warning' | 'info'

/** §2 — one real TARGET OCCURRENCE. For `kind:'multi-target'` a diagnostic yields
 * N projections (targetIndex 0..N-1, shared targetCount); for `kind:'target-group'`
 * it yields EXACTLY ONE group projection (targetIndex 0, targetCount 1 — a group is
 * NOT an occurrence list); for every other kind it yields exactly one
 * (targetIndex 0, targetCount 1).
 */
export interface DiagnosticTargetProjection {
  diagnosticId: string
  ruleId: string
  severity: DiagnosticSeverityV514
  targetIndex: number
  targetCount: number
  stableIdentity: string
  documentKey: string
  sourceStartOffset: number | null
  sourceEndOffset: number | null
  canonicalBlockIndex: number | null
  canonicalHeadingIndex: number | null
  sourceLine: number | null
  sourceColumn: number | null
  locationKind: string
  active: boolean
}

/** §3 — the document ordering authority: band first, then the in-band key. */
export const DOCUMENT_POSITION_BAND_START = 0
export const DOCUMENT_POSITION_BAND_SOURCE = 1
export const DOCUMENT_POSITION_BAND_END = 2

/** Segregated in-band key ranges so different authorities can never collide. */
export const DOCUMENT_POSITION_KEY_SOURCE_MAX = 10_000_000
export const DOCUMENT_POSITION_KEY_LINE_BASE = 10_000_000
export const DOCUMENT_POSITION_KEY_HEADING_BASE = 100_000_000
export const DOCUMENT_POSITION_KEY_BLOCK_BASE = 1_000_000_000
export const DOCUMENT_POSITION_KEY_UNKNOWN = 10_000_000_000

export interface DocumentPosition {
  band: number
  key: number
  subKey: number
}

/**
 * §7/§43 — canonical-node / block-node targets carry NO source offset, so the
 * host supplies the single-source identity→position map (the SAME resolution the
 * markers use). Views never guess: they read these facts.
 */
export interface DocumentPositionContext {
  headingIndexOfStableIdentity?: (stableIdentity: string) => number | null
  blockIndexOfStableIdentity?: (stableIdentity: string) => number | null
  lineOfStableIdentity?: (stableIdentity: string) => number | null
}

const SEVERITY_RANK: Readonly<Record<DiagnosticSeverityV514, number>> = { error: 0, warning: 1, info: 2 }

function normalizeSeverityV514(raw: unknown): DiagnosticSeverityV514 {
  const s = String(raw ?? 'info').toLowerCase()
  return s === 'error' ? 'error' : s === 'warning' ? 'warning' : 'info'
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function sourceIdentityOf(loc: Extract<DiagnosticLocation, { kind: 'source-range' }>): string {
  if (typeof loc.sourceRangeIdentity === 'string' && loc.sourceRangeIdentity !== '') return loc.sourceRangeIdentity
  const occ = numOrNull(loc.occurrenceIndex)
  return `source:${loc.startLine}:${loc.startColumn}:${occ ?? 0}`
}

function projectOne(
  d: DocumentDiagnostic,
  severity: DiagnosticSeverityV514,
  loc: DiagnosticLocation | null,
  targetIndex: number,
  targetCount: number,
  ctx: DocumentPositionContext,
): DiagnosticTargetProjection {
  let stableIdentity = ''
  let sourceStartOffset: number | null = null
  let sourceEndOffset: number | null = null
  let sourceLine: number | null = null
  let sourceColumn: number | null = null
  let canonicalHeadingIndex: number | null = null
  let canonicalBlockIndex: number | null = null
  if (loc) {
    if (loc.kind === 'source-range') {
      sourceStartOffset = numOrNull(loc.sourceStart)
      sourceEndOffset = numOrNull(loc.sourceEnd)
      sourceLine = numOrNull(loc.startLine)
      sourceColumn = numOrNull(loc.startColumn)
      stableIdentity = sourceIdentityOf(loc)
    } else if (loc.kind === 'figure-occurrence') {
      // V1 — the occurrence locator orders exactly like its source range.
      sourceStartOffset = numOrNull(loc.sourceStart)
      sourceEndOffset = numOrNull(loc.sourceEnd)
      sourceLine = numOrNull(loc.startLine)
      sourceColumn = numOrNull(loc.startColumn)
      stableIdentity = typeof loc.sourceRangeIdentity === 'string' && loc.sourceRangeIdentity !== ''
        ? loc.sourceRangeIdentity
        : `figure-occurrence:${loc.occurrenceIdentity.sourceBlockIdentity}:${loc.occurrenceIdentity.tokenStart ?? 'n'}`
    } else if (loc.kind === 'source-block') {
      // V1 — the block locator orders by the owning block's first source line.
      sourceStartOffset = numOrNull(loc.sourceStart)
      sourceEndOffset = numOrNull(loc.sourceEnd)
      sourceLine = numOrNull(loc.startLine)
      sourceColumn = 0
      stableIdentity = `block:${loc.sourceBlockIdentity}`
    } else if (loc.kind === 'canonical-node') {
      stableIdentity = loc.stableIdentity
      canonicalHeadingIndex = ctx.headingIndexOfStableIdentity?.(stableIdentity) ?? null
      sourceLine = ctx.lineOfStableIdentity?.(stableIdentity) ?? null
    } else if (loc.kind === 'block-node') {
      stableIdentity = loc.stableIdentity
      canonicalBlockIndex = ctx.blockIndexOfStableIdentity?.(stableIdentity) ?? null
      sourceLine = ctx.lineOfStableIdentity?.(stableIdentity) ?? null
    }
  }
  return {
    diagnosticId: d.id,
    ruleId: typeof d.code === 'string' && d.code !== '' ? d.code : d.id,
    severity,
    targetIndex,
    targetCount,
    stableIdentity,
    documentKey: d.documentKey,
    sourceStartOffset,
    sourceEndOffset,
    canonicalBlockIndex,
    canonicalHeadingIndex,
    sourceLine,
    sourceColumn,
    locationKind: loc ? loc.kind : 'unknown',
    active: false,
  }
}

/**
 * Target Group V1 §10 — the stable identity of a TARGET GROUP projection. It is
 * a SENTINEL (never a member's stable identity), so the group's Drawer / active
 * target key is `${documentKey}::${diagnosticId}::0::GROUP` — independent of the
 * scrollAnchor identity and containing NO member target index.
 */
export const TARGET_GROUP_STABLE_IDENTITY = 'GROUP'

/**
 * Target Group V1 §8 — build the ONE projection of a `target-group` diagnostic.
 * It is ALWAYS exactly one row (`targetIndex: 0`, `targetCount: 1`), so the Drawer
 * can never paint a `1/N` occurrence badge for a group. The members stay on the
 * LOCATION (the interaction / visual authorities read them).
 */
function buildTargetGroupProjection(
  d: DocumentDiagnostic,
  severity: DiagnosticSeverityV514,
  loc: Extract<DiagnosticLocation, { kind: 'target-group' }>,
  ctx: DocumentPositionContext,
): DiagnosticTargetProjection {
  const anchor = loc.scrollAnchor
  let sourceLine: number | null = null
  let sourceColumn: number | null = null
  let canonicalHeadingIndex: number | null = null
  if (anchor.kind === 'source-range') {
    sourceLine = numOrNull(anchor.startLine)
    sourceColumn = numOrNull(anchor.startColumn)
  } else if (anchor.kind === 'canonical-node') {
    canonicalHeadingIndex = ctx.headingIndexOfStableIdentity?.(anchor.stableIdentity) ?? null
    sourceLine = ctx.lineOfStableIdentity?.(anchor.stableIdentity) ?? null
  } else if (anchor.kind === 'block-node') {
    sourceLine = ctx.lineOfStableIdentity?.(anchor.stableIdentity) ?? null
  }
  return {
    diagnosticId: d.id,
    ruleId: typeof d.code === 'string' && d.code !== '' ? d.code : d.id,
    severity,
    // §8 — ONE row: the ordinal badge is driven by targetCount > 1, so 1 ⇒ no badge.
    targetIndex: 0,
    targetCount: 1,
    stableIdentity: TARGET_GROUP_STABLE_IDENTITY,
    documentKey: d.documentKey,
    sourceStartOffset: null,
    sourceEndOffset: null,
    canonicalBlockIndex: null,
    canonicalHeadingIndex,
    sourceLine,
    sourceColumn,
    locationKind: 'target-group',
    active: false,
  }
}

/**
 * §4 — flatten the diagnostic list into ONE entry per real target occurrence.
 * The multi-target business diagnostic is preserved (never split into several
 * diagnostics); only its projection is expanded.
 *
 * Target Group V1 §8 — a `target-group` diagnostic is NEVER expanded: it yields
 * EXACTLY ONE projection (ONE Drawer row). Ordinary `multi-target` keeps its N
 * occurrence projections (regression-protected).
 */
export function flattenDiagnosticsToProjections(
  diagnostics: readonly DocumentDiagnostic[],
  ctx: DocumentPositionContext = {},
): DiagnosticTargetProjection[] {
  const out: DiagnosticTargetProjection[] = []
  for (const d of diagnostics) {
    const severity = normalizeSeverityV514(d.severity)
    const loc = d.location ?? null
    if (loc && loc.kind === 'target-group') {
      // §8 — ONE row, never `projectionCount = targets.length`.
      out.push(buildTargetGroupProjection(d, severity, loc, ctx))
      continue
    }
    if (loc && loc.kind === 'multi-target') {
      const targets = loc.targets ?? []
      if (targets.length === 0) continue
      for (let i = 0; i < targets.length; i++) {
        out.push(projectOne(d, severity, targets[i], i, targets.length, ctx))
      }
      continue
    }
    out.push(projectOne(d, severity, loc, 0, 1, ctx))
  }
  return out
}

/** §3 — the documentPosition of ONE projection (band + key + subKey). */
export function documentPositionOf(p: DiagnosticTargetProjection): DocumentPosition {
  if (p.locationKind === 'document-start') return { band: DOCUMENT_POSITION_BAND_START, key: 0, subKey: 0 }
  if (p.locationKind === 'document-end') return { band: DOCUMENT_POSITION_BAND_END, key: 0, subKey: 0 }
  // §3 — ONE common unit: the source LINE. Mixing raw source OFFSETS with line
  // numbers inside a single ordered key would be unsound (an offset of 1200 would
  // sort before line 2), so `sourceStartOffset` stays a recorded FACT and the
  // line (+column) is the ordering key every positionable target shares.
  if (p.sourceLine != null) {
    return {
      band: DOCUMENT_POSITION_BAND_SOURCE,
      key: Math.max(0, p.sourceLine) * 1000 + Math.max(0, p.sourceColumn ?? 0),
      subKey: p.targetIndex,
    }
  }
  if (p.canonicalHeadingIndex != null) {
    return {
      band: DOCUMENT_POSITION_BAND_SOURCE,
      key: DOCUMENT_POSITION_KEY_HEADING_BASE + p.canonicalHeadingIndex,
      subKey: p.targetIndex,
    }
  }
  if (p.canonicalBlockIndex != null) {
    return {
      band: DOCUMENT_POSITION_BAND_SOURCE,
      key: DOCUMENT_POSITION_KEY_BLOCK_BASE + p.canonicalBlockIndex,
      subKey: p.targetIndex,
    }
  }
  // §11 — an unlocatable target still sorts AFTER every located one, but BEFORE
  // document-end, so a document-level diagnostic can never jump into the body.
  return { band: DOCUMENT_POSITION_BAND_SOURCE, key: DOCUMENT_POSITION_KEY_UNKNOWN, subKey: p.targetIndex }
}

/**
 * §3 — strict document-position order. Severity / ruleId / diagnosticId /
 * targetIndex are ONLY tie-breaks at an identical position, never the primary key.
 */
export function compareDiagnosticTargetProjections(
  a: DiagnosticTargetProjection,
  b: DiagnosticTargetProjection,
): number {
  const pa = documentPositionOf(a)
  const pb = documentPositionOf(b)
  if (pa.band !== pb.band) return pa.band - pb.band
  if (pa.key !== pb.key) return pa.key - pb.key
  if (pa.subKey !== pb.subKey) return pa.subKey - pb.subKey
  const sr = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  if (sr !== 0) return sr
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1
  if (a.diagnosticId !== b.diagnosticId) return a.diagnosticId < b.diagnosticId ? -1 : 1
  return a.targetIndex - b.targetIndex
}

/** §4 — sort a copy; the input array is never mutated. */
export function sortProjectionsByDocumentPosition(
  projections: readonly DiagnosticTargetProjection[],
): DiagnosticTargetProjection[] {
  return [...projections].sort(compareDiagnosticTargetProjections)
}

/** §32 — filtering may remove entries but must NEVER reorder the survivors. */
export function filterProjectionsBySeverity(
  projections: readonly DiagnosticTargetProjection[],
  filter: 'all' | DiagnosticSeverityV514,
): DiagnosticTargetProjection[] {
  return filter === 'all' ? [...projections] : projections.filter(p => p.severity === filter)
}

export function projectionKey(p: DiagnosticTargetProjection): string {
  return `${p.diagnosticId}#${p.targetIndex}`
}

/** §6 — the source facts that, when unchanged, forbid any order drift. */
export function projectionSourceSignature(p: DiagnosticTargetProjection): string {
  return `${p.sourceStartOffset ?? 'n'}|${p.stableIdentity}|${p.sourceLine ?? 'n'}|${projectionKey(p)}`
}

// ── V5.14-R1 §41 — the Drawer ordering hard gates (all must be 0) ──────────

export const DRAWER_ORDER_V514R1_GATE_KEYS = [
  'documentOrderInversion',
  'filterRelativeOrderMutation',
  'multiTargetGroupedInsteadOfPositionSorted',
  'selectedTargetChangedWithoutUserIntent',
  'documentOrderDriftWithoutSourceChange',
] as const

export type DrawerOrderV514R1GateKey = typeof DRAWER_ORDER_V514R1_GATE_KEYS[number]

export const DRAWER_ORDER_V514R1_GATE_LABELS: Readonly<Record<DrawerOrderV514R1GateKey, string>> = {
  documentOrderInversion: 'DRAWER_DOCUMENT_ORDER_INVERSION_COUNT',
  filterRelativeOrderMutation: 'DRAWER_FILTER_RELATIVE_ORDER_MUTATION_COUNT',
  multiTargetGroupedInsteadOfPositionSorted: 'DRAWER_MULTI_TARGET_GROUPED_INSTEAD_OF_POSITION_SORTED_COUNT',
  selectedTargetChangedWithoutUserIntent: 'DRAWER_SELECTED_TARGET_CHANGED_WITHOUT_USER_INTENT_COUNT',
  documentOrderDriftWithoutSourceChange: 'DRAWER_DOCUMENT_ORDER_DRIFT_WITHOUT_SOURCE_CHANGE_COUNT',
}

export type DrawerOrderV514R1Counters = Record<DrawerOrderV514R1GateKey, number>

export function createDrawerOrderV514R1Counters(): DrawerOrderV514R1Counters {
  return DRAWER_ORDER_V514R1_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as DrawerOrderV514R1Counters)
}

export function formatDrawerOrderV514R1GateReport(counters: Readonly<DrawerOrderV514R1Counters>): string[] {
  return DRAWER_ORDER_V514R1_GATE_KEYS.map(k => `${DRAWER_ORDER_V514R1_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateDrawerOrderV514R1Gates(
  counters: Readonly<DrawerOrderV514R1Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: DrawerOrderV514R1GateKey[] } {
  const failedChecks = DRAWER_ORDER_V514R1_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §41 — count descents in the RENDERED order (must be 0 for a sorted list). */
export function countDocumentOrderInversions(
  rendered: readonly DiagnosticTargetProjection[],
): number {
  let n = 0
  for (let i = 1; i < rendered.length; i++) {
    if (compareDiagnosticTargetProjections(rendered[i - 1], rendered[i]) > 0) n++
  }
  return n
}

/** §32 — the filtered list must be an order-preserving subsequence of the full one. */
export function isOrderPreservingSubsequence(
  full: readonly DiagnosticTargetProjection[],
  filtered: readonly DiagnosticTargetProjection[],
): boolean {
  let i = 0
  for (const f of filtered) {
    const key = projectionKey(f)
    while (i < full.length && projectionKey(full[i]) !== key) i++
    if (i >= full.length) return false
    i++
  }
  return true
}

function indicesOfDiagnostic(ps: readonly DiagnosticTargetProjection[], id: string): number[] {
  const out: number[] = []
  ps.forEach((p, i) => { if (p.diagnosticId === id) out.push(i) })
  return out
}

function isInterleaved(ps: readonly DiagnosticTargetProjection[], id: string): boolean {
  const idxs = indicesOfDiagnostic(ps, id)
  if (idxs.length < 2) return false
  return idxs[idxs.length - 1] - idxs[0] !== idxs.length - 1
}

/**
 * §41 — a multi-target diagnostic whose occurrences were kept CONTIGUOUS while
 * the document order requires another diagnostic BETWEEN them. This is exactly
 * the old "group by rule" behaviour the drawer must never fall back to.
 */
export function countMultiTargetGroupedInsteadOfPositionSorted(
  expected: readonly DiagnosticTargetProjection[],
  rendered: readonly DiagnosticTargetProjection[],
): number {
  const eq = (a: readonly DiagnosticTargetProjection[], b: readonly DiagnosticTargetProjection[]): boolean =>
    a.length === b.length && a.every((p, i) => projectionKey(p) === projectionKey(b[i]))
  if (eq(expected, rendered)) return 0
  let n = 0
  for (const id of new Set(expected.map(p => p.diagnosticId))) {
    if (indicesOfDiagnostic(expected, id).length < 2) continue
    if (!isInterleaved(expected, id)) continue
    if (!isInterleaved(rendered, id)) n++
  }
  return n
}

/**
 * §6 — the same source facts must produce the same order. Returns 1 when the
 * signature multiset is unchanged but the rendered sequence drifted.
 */
export function countDocumentOrderDriftWithoutSourceChange(
  previous: readonly DiagnosticTargetProjection[],
  next: readonly DiagnosticTargetProjection[],
): number {
  const sig = (ps: readonly DiagnosticTargetProjection[]): string =>
    ps.map(projectionSourceSignature).sort().join('||')
  if (sig(previous) !== sig(next)) return 0
  const seq = (ps: readonly DiagnosticTargetProjection[]): string => ps.map(projectionKey).join('||')
  return seq(previous) === seq(next) ? 0 : 1
}

// ── §37/§38 — the Drawer order runtime audit ───────────────────────────────

export const DRAWER_ORDER_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-DRAWER-ORDER-AUDIT'

export interface DrawerOrderAuditEntry {
  diagnosticId: string
  ruleId: string
  targetIndex: number
  targetCount: number
  documentPosition: DocumentPosition
  sourceStartOffset: number | null
  stableIdentity: string
  severity: DiagnosticSeverityV514
}

export function buildDrawerOrderAuditEntries(
  rendered: readonly DiagnosticTargetProjection[],
): DrawerOrderAuditEntry[] {
  return rendered.map(p => ({
    diagnosticId: p.diagnosticId,
    ruleId: p.ruleId,
    targetIndex: p.targetIndex,
    targetCount: p.targetCount,
    documentPosition: documentPositionOf(p),
    sourceStartOffset: p.sourceStartOffset,
    stableIdentity: p.stableIdentity,
    severity: p.severity,
  }))
}

/** §38 — `isMonotonicDocumentOrder` + the tie-break count of one render. */
export function summarizeDrawerOrderAudit(
  previous: readonly DiagnosticTargetProjection[],
  rendered: readonly DiagnosticTargetProjection[],
): {
  entryCount: number
  isMonotonicDocumentOrder: boolean
  tieBreakCount: number
  driftWithoutSourceChange: number
} {
  let tieBreakCount = 0
  for (let i = 1; i < rendered.length; i++) {
    const a = documentPositionOf(rendered[i - 1])
    const b = documentPositionOf(rendered[i])
    if (a.band === b.band && a.key === b.key && a.subKey === b.subKey) tieBreakCount++
  }
  return {
    entryCount: rendered.length,
    isMonotonicDocumentOrder: countDocumentOrderInversions(rendered) === 0,
    tieBreakCount,
    driftWithoutSourceChange: countDocumentOrderDriftWithoutSourceChange(previous, rendered),
  }
}
