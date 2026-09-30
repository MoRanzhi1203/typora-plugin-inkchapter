// @vitest-environment jsdom
/**
 * V1 — Figure Diagnostic Locator (Block Identity + Occurrence Identity +
 * Source↔DOM Binding) targeted closure suite.
 *
 * THE DEFECT (proved by the real runtime log):
 *   a `FIGURE_BLOCK_STRUCTURE_INVALID` click entered ACTIVATE → RESOLVING but
 *   the location was still a `source-range`, so the INLINE occurrence resolver
 *   was used → `resolveDecision=UNRESOLVED /
 *   resolveReason=AMBIGUOUS_DUPLICATE_INLINE_RANGE`.
 *
 * These tests lock the fix:
 *
 *   V1-IDENTITY-*   block / occurrence / DOM identity builders (pure)
 *   V1-PRODUCER-*   source-block vs figure-occurrence locator split (pure)
 *   V1-GATE-*       the runtime gates + the locate/cleanup/feature separation
 *   V1-HOST-*       the host REALLY locates (jsdom) — structure block, duplicate
 *                   same.png occurrences, broken local image fallback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeDocumentDiagnostics, buildFigureSourceOccurrences } from './document-diagnostics'
import type { DocumentDiagnosticsInput, DiagnosticLinkFact } from './document-diagnostics'
import { parseImageSourceOccurrences, parseLocalLinkTargets } from './document-resource-scanner'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  FIGURE_DIAGNOSTIC_LOCATOR_AUDIT,
  FIGURE_SOURCE_DOM_BLOCK_BINDING_AUDIT,
  FIGURE_DIAGNOSTIC_LOCATOR_V1_GATE_KEYS,
  FIGURE_DIAGNOSTIC_LOCATOR_V1_GATE_LABELS,
  FIGURE_DIAGNOSTIC_LOCATOR_V1_COVERAGE_MINIMUMS,
  buildDomBlockIdentity,
  buildFigureOccurrenceIdentity,
  buildSourceBlockBindingKey,
  buildSourceBlockIdentity,
  computeCleanupClosureDecision,
  computeFeatureLocateDecision,
  computeLocateDecision,
  createFigureDiagnosticLocatorV1Counters,
  createFigureDiagnosticLocatorV1CoverageCounters,
  evaluateFigureDiagnosticLocatorV1Coverage,
  evaluateFigureDiagnosticLocatorV1Gates,
  figureDiagnosticLocatorKindForRule,
  figureOccurrenceIdentityIsStable,
  formatFigureDiagnosticLocatorV1GateReport,
  isBlockLevelFigureRule,
  isResolvableDomBlockIdentity,
  locationMustNotUseInlineResolver,
} from './document-diagnostic-locator-authority-v1'
import { resolveDiagnosticLocation, hasLocatableLocation, isStaleSourceRevision, STALE_SOURCE_REVISION_REASON } from './document-diagnostic-location'
import { computeDiagnosticLocationContract } from './document-diagnostic-location'
import { resetFigureBlockStructureV515State } from './document-standalone-object-block-invariant-v515'

const ASSET = 'assets/a.png'
const SAME = 'same.png'

// ── pure identity ──────────────────────────────────────────────────────────

describe('V1-IDENTITY — block / occurrence / DOM identity', () => {
  it('the source-block identity is derived from the owning block start line', () => {
    expect(buildSourceBlockIdentity(0)).toBe('src-block:0')
    expect(buildSourceBlockIdentity(18)).toBe('src-block:18')
  })

  it('two byte-identical blocks never share a binding key (§9)', () => {
    const a = buildSourceBlockBindingKey({
      documentKey: 'doc', sourceRevision: 1, sourceBlockIdentity: 'src-block:4',
      sourceBlockOrdinal: 0, sourceStart: 12, sourceEnd: 30,
    })
    const b = buildSourceBlockBindingKey({
      documentKey: 'doc', sourceRevision: 1, sourceBlockIdentity: 'src-block:4',
      sourceBlockOrdinal: 1, sourceStart: 12, sourceEnd: 30,
    })
    expect(a).not.toBe(b)
  })

  it('the occurrence identity separates same-destination token ordinals (§11/§38)', () => {
    const base = {
      documentKey: 'doc', sourceRevision: 1, sourceBlockIdentity: 'src-block:2',
      sourceBlockOrdinal: 0, rawLineOrdinal: 0, occurrenceWithinLine: 0, destination: SAME,
    }
    const first = buildFigureOccurrenceIdentity({ ...base, tokenStart: 0, tokenEnd: 13 })
    const second = buildFigureOccurrenceIdentity({ ...base, tokenStart: 40, tokenEnd: 53 })
    expect(first).not.toBe(second)
    expect(figureOccurrenceIdentityIsStable({ sourceBlockIdentity: 'src-block:2', tokenStart: 0, rawLineOrdinal: 0, occurrenceWithinLine: 0 })).toBe(true)
    expect(figureOccurrenceIdentityIsStable({ sourceBlockIdentity: '', tokenStart: 0, rawLineOrdinal: 0, occurrenceWithinLine: 0 })).toBe(false)
    expect(figureOccurrenceIdentityIsStable({ sourceBlockIdentity: 'src-block:2', tokenStart: null, rawLineOrdinal: 0, occurrenceWithinLine: 0 })).toBe(false)
  })

  it('dom-block identity is always resolvable — never `dom-block:p:na` (§7)', () => {
    expect(buildDomBlockIdentity({ tag: 'P', runtimeId: null, dataLine: '7', elementId: null, ordinal: 3, structuralSignature: '1:a.png' }))
      .toBe('dom-block:p:line:7')
    expect(buildDomBlockIdentity({ tag: 'p', runtimeId: 'n-42', dataLine: '7', elementId: null, ordinal: 0, structuralSignature: '' }))
      .toBe('dom-block:p:rid:n-42')
    const fallback = buildDomBlockIdentity({ tag: 'p', runtimeId: null, dataLine: null, elementId: null, ordinal: 5, structuralSignature: '0:' })
    expect(fallback).toBe('dom-block:p:ord:5:sig:0:')
    expect(isResolvableDomBlockIdentity(fallback)).toBe(true)
    expect(isResolvableDomBlockIdentity('dom-block:p:na')).toBe(false)
    expect(isResolvableDomBlockIdentity('')).toBe(false)
    expect(isResolvableDomBlockIdentity('dom-block:p:line:')).toBe(true)
  })

  it('the locator classification keeps structure BLOCK-level and images OCCURRENCE-level', () => {
    expect(figureDiagnosticLocatorKindForRule('FIGURE_BLOCK_STRUCTURE_INVALID')).toBe('source-block')
    expect(figureDiagnosticLocatorKindForRule('FIGURE_MISSING_NAME')).toBe('figure-occurrence')
    expect(figureDiagnosticLocatorKindForRule('FIGURE_LOCAL_IMAGE_MISSING')).toBe('figure-occurrence')
    expect(figureDiagnosticLocatorKindForRule('HEADING_LEVEL_GAP')).toBe('other')
    expect(isBlockLevelFigureRule('FIGURE_BLOCK_STRUCTURE_INVALID')).toBe(true)
    expect(isBlockLevelFigureRule('FIGURE_MISSING_NAME')).toBe(false)
    expect(locationMustNotUseInlineResolver({ kind: 'source-block' } as never)).toBe(true)
    expect(locationMustNotUseInlineResolver({ kind: 'figure-occurrence' } as never)).toBe(true)
    expect(locationMustNotUseInlineResolver({ kind: 'source-range' } as never)).toBe(false)
  })
})

// ── the runtime gates ──────────────────────────────────────────────────────

describe('V1-GATE — runtime gates + locate/cleanup separation', () => {
  it('every forbidden counter must be 0 and every coverage counter must reach its minimum', () => {
    expect(FIGURE_DIAGNOSTIC_LOCATOR_V1_GATE_KEYS).toHaveLength(11)
    const counters = createFigureDiagnosticLocatorV1Counters()
    expect(formatFigureDiagnosticLocatorV1GateReport(counters)).toHaveLength(11)
    expect(evaluateFigureDiagnosticLocatorV1Gates(counters).decision).toBe('PASS')
    counters.structureAmbiguousDuplicateInlineRange = 1
    expect(evaluateFigureDiagnosticLocatorV1Gates(counters).decision).toBe('FAIL')
    expect(FIGURE_DIAGNOSTIC_LOCATOR_V1_GATE_LABELS.structureAmbiguousDuplicateInlineRange)
      .toBe('FIGURE_STRUCTURE_AMBIGUOUS_DUPLICATE_INLINE_RANGE_COUNT')

    const coverage = createFigureDiagnosticLocatorV1CoverageCounters()
    expect(evaluateFigureDiagnosticLocatorV1Coverage(coverage).decision).toBe('FAIL')
    expect(FIGURE_DIAGNOSTIC_LOCATOR_V1_COVERAGE_MINIMUMS.duplicateDestinationDistinctOccurrenceLocateRuntime).toBe(2)
    coverage.structureBlockLocateRuntime = 1
    coverage.missingNameOccurrenceLocateRuntime = 1
    coverage.localImageMissingLocateRuntime = 1
    coverage.duplicateDestinationDistinctOccurrenceLocateRuntime = 2
    expect(evaluateFigureDiagnosticLocatorV1Coverage(coverage).decision).toBe('PASS')
  })

  it('a cleanup PASS never masks a locate FAIL (§31/§32)', () => {
    expect(computeLocateDecision({
      resolveDecision: 'UNRESOLVED', scrollDecision: 'N/A', highlightDecision: 'N/A', finalDecision: 'FAIL',
    })).toBe('FAIL')
    expect(computeLocateDecision({
      resolveDecision: 'RESOLVED', scrollDecision: 'PASS', highlightDecision: 'PASS', finalDecision: 'PASS',
    })).toBe('PASS')
    const cleanCleanup = {
      rollbackCompleted: true, rollbackFillRemoved: true, rollbackLeaseReleased: true,
      rollbackMarkerRemoved: true, rollbackTransactionClosed: true,
    }
    expect(computeCleanupClosureDecision(cleanCleanup)).toBe('PASS')
    expect(computeCleanupClosureDecision({ ...cleanCleanup, rollbackFillRemoved: false })).toBe('FAIL')
    // A clean rollback after a locate FAIL is still a FEATURE FAIL.
    expect(computeFeatureLocateDecision('FAIL', 'PASS')).toBe('FAIL')
    expect(computeFeatureLocateDecision('PASS', 'PASS')).toBe('PASS')
    expect(computeFeatureLocateDecision('PASS', 'FAIL')).toBe('FAIL')
  })

  it('the block locator never enters the inline duplicate resolver (§5/§41.4)', () => {
    const md = `before ![](${ASSET}) after\n`
    const diag = byCode(inputOf(md), 'FIGURE_BLOCK_STRUCTURE_INVALID')[0]
    expect(diag.location?.kind).toBe('source-block')
    // A block locator resolves through `resolveSourceBlock`; with NO hook it
    // must still never report the inline duplicate reason.
    const result = resolveDiagnosticLocation(diag, diag.location, {
      documentKey: 'doc:v1',
      getRoot: () => null,
      resolveHeadingIdentity: () => null,
      resolveSourceLine: () => null,
      resolveBlockIdentity: () => null,
    })
    expect(result.decision).toBe('UNRESOLVED')
    expect(result.reason).not.toBe('AMBIGUOUS_DUPLICATE_INLINE_RANGE')
    expect(result.primaryAnchor).toBe('owning-block')
  })

  it('a stale source generation yields STALE_SOURCE_REVISION, never a stale locate (§21)', () => {
    expect(isStaleSourceRevision(1, { getSourceRevision: () => 2 })).toBe(true)
    expect(isStaleSourceRevision(2, { getSourceRevision: () => 2 })).toBe(false)
    expect(isStaleSourceRevision(null, { getSourceRevision: () => 2 })).toBe(false)
    expect(isStaleSourceRevision(1, {})).toBe(false)

    const md = `before ![](${ASSET}) after\n`
    const diag = byCode({ ...inputOf(md), sourceRevision: 4 }, 'FIGURE_BLOCK_STRUCTURE_INVALID')[0]
    expect((diag.location as { sourceRevision: number | null }).sourceRevision).toBe(4)
    const stale = resolveDiagnosticLocation(diag, diag.location, {
      documentKey: 'doc:v1',
      getRoot: () => null,
      getSourceRevision: () => 9,
      resolveHeadingIdentity: () => null,
      resolveSourceLine: () => null,
      resolveBlockIdentity: () => null,
    })
    expect(stale.decision).toBe('TARGET_CHANGED')
    expect(stale.reason).toBe(STALE_SOURCE_REVISION_REASON)
  })
})

// ── producers ──────────────────────────────────────────────────────────────

function inputOf(markdown: string, opts: { missing?: (t: string) => boolean } = {}): DocumentDiagnosticsInput {
  const missing = opts.missing ?? (() => true)
  const links: DiagnosticLinkFact[] = []
  const raw = parseLocalLinkTargets(markdown)
  for (let i = 0; i < raw.length; i++) {
    const o = typeof raw[i] === 'string' ? { target: raw[i] as string } : raw[i] as Exclude<typeof raw[number], string>
    if (!missing(o.target)) continue
    const occurrenceIndex = raw.slice(0, i).filter(p => {
      const q = typeof p === 'string' ? { target: p } : p
      return (q.resourceKind ?? 'link') === (o.resourceKind ?? 'link') && q.target === o.target
    }).length
    links.push({
      target: o.target, element: null, index: i,
      resourceKind: o.resourceKind, semanticDestination: o.target,
      sourceStart: o.sourceStart, sourceEnd: o.sourceEnd,
      startLine: o.startLine, endLine: o.endLine, startColumn: o.startColumn, endColumn: o.endColumn,
      rawText: o.rawText, destinationStart: o.destinationStart, destinationEnd: o.destinationEnd,
      rawToken: o.rawToken, altText: o.altText, resourceClass: o.resourceClass,
      targetIdentity: `local:${o.target}${occurrenceIndex > 0 ? `:${occurrenceIndex + 1}` : ''}`,
    })
  }
  const figureSourceOccurrences = buildFigureSourceOccurrences({
    scanned: parseImageSourceOccurrences(markdown),
    documentKey: 'doc:v1',
    resolveCanonicalDestination: d => d,
    isLocalFileMissing: d => missing(d),
  })
  return {
    documentKey: 'doc:v1', markdown, strictMode: false, vaultRoot: 'D:/vault',
    headings: [], figures: [], figureSourceOccurrences, tables: [], codes: [], formulas: [],
    links, canonicalDuplicateIdentities: [], captionDuplicateNames: [],
  }
}

function byCode(input: DocumentDiagnosticsInput, code: string) {
  return computeDocumentDiagnostics(input).diagnostics.filter(d => d.code === code)
}

describe('V1-PRODUCER — locator split', () => {
  it('FIGURE_BLOCK_STRUCTURE_INVALID owns a BLOCK-level locator spanning the whole block', () => {
    const md = `before ![](${ASSET}) after\n`
    const d = byCode(inputOf(md), 'FIGURE_BLOCK_STRUCTURE_INVALID')[0]
    expect(d.location?.kind).toBe('source-block')
    if (d.location?.kind !== 'source-block') throw new Error('not source-block')
    expect(d.location.locatorStrategy).toBe('OWNING_BLOCK')
    expect(d.location.sourceBlockIdentity).toBe('src-block:0')
    expect(md.slice(d.location.sourceStart, d.location.sourceEnd)).toBe(`before ![](${ASSET}) after`)
    expect(hasLocatableLocation(d.location)).toBe(true)
  })

  it('two byte-identical invalid blocks get distinct block ordinals (§9/§37)', () => {
    const md = `before ![](${ASSET})\n\nbefore ![](${ASSET})\n`
    const blocks = byCode(inputOf(md), 'FIGURE_BLOCK_STRUCTURE_INVALID')
    expect(blocks).toHaveLength(2)
    const ordinals = blocks.map(b => (b.location as { sourceBlockOrdinal: number }).sourceBlockOrdinal)
    expect(new Set(ordinals).size).toBe(2)
  })

  it('duplicate `![](same.png)` yields distinct occurrence identities (§11/§22)', () => {
    const md = `![](${SAME})\n\n![](${SAME})\n`
    const mn = byCode(inputOf(md), 'FIGURE_MISSING_NAME')
    expect(mn).toHaveLength(2)
    const ids = mn.map(d => {
      const loc = d.location as { occurrenceIdentity: { sourceBlockIdentity: string; tokenStart: number | null } }
      return buildFigureOccurrenceIdentity({
        documentKey: 'doc:v1', sourceRevision: null,
        sourceBlockIdentity: loc.occurrenceIdentity.sourceBlockIdentity,
        sourceBlockOrdinal: 0, tokenStart: loc.occurrenceIdentity.tokenStart, tokenEnd: 0,
        rawLineOrdinal: 0, occurrenceWithinLine: 0, destination: SAME,
      })
    })
    expect(new Set(ids).size).toBe(2)
    const blocks = mn.map(d => (d.location as { occurrenceIdentity: { sourceBlockIdentity: string } }).occurrenceIdentity.sourceBlockIdentity)
    expect(new Set(blocks).size).toBe(2)
    for (const d of mn) expect(hasLocatableLocation(d.location)).toBe(true)

    const missing = byCode(inputOf(md), 'FIGURE_LOCAL_IMAGE_MISSING')
    expect(missing).toHaveLength(2)
    expect(missing.every(d => d.location?.kind === 'figure-occurrence')).toBe(true)
    expect(missing.every(d => (d.location as { rangeRole: string }).rangeRole === 'figure-destination')).toBe(true)
  })
})

// ── REAL host runtime (jsdom) ──────────────────────────────────────────────

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
let infoSpy: InfoSpy | null = null
let host: DocumentUtilityOverlayHost | null = null
let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1
let lastRangeEl: Element | null = null
let lastRangeOffset = -1

function stubRaf(): void {
  rafTasks = new Map()
  rafSeq = 1
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
    (cb: FrameRequestCallback): number => { const id = rafSeq++; rafTasks.set(id, cb); return id }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number): void => { rafTasks.delete(id) }
}
async function flushRaf(): Promise<void> {
  let guard = 0
  while (rafTasks.size > 0 && guard++ < 400) {
    const cur = Array.from(rafTasks.values())
    rafTasks.clear()
    for (const cb of cur) cb(0)
    await Promise.resolve()
  }
}

function stubRect(el: Element, getRect: () => { left: number; top: number; right: number; bottom: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const r = getRect()
      return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }
    },
  })
}

function stubRangeRectsByOffset(fn: (el: Element | null, offset: number) => Array<{ left: number; top: number; right: number; bottom: number }>): void {
  const fake = {
    setStart(n: Node, o: number): void { lastRangeEl = (n as Text).parentElement ?? null; lastRangeOffset = o },
    setEnd(): void { /* noop */ },
    selectNodeContents(n: Node): void { lastRangeEl = (n as Element).parentElement ?? (n as Element); lastRangeOffset = -1 },
    getClientRects: () => fn(lastRangeEl, lastRangeOffset).map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top })),
  }
  ;(document as unknown as { createRange: () => unknown }).createRange = () => fake
}

function readAudit(spy: InfoSpy, event: string, nth = 0): Record<string, string> | null {
  const lines = spy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event))
  const line = lines[nth]
  if (!line) return null
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}

function makeHost(markdown: string): { h: DocumentUtilityOverlayHost; write: HTMLElement } {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  stubRect(shell, () => ({ left: 0, top: 0, right: 800, bottom: 600 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  const root = document.createElement('div')
  root.className = 'inkchapter-doc-overlay-root'
  stubRect(root, () => ({ left: 0, top: 0, right: 1536, bottom: 782 }))
  document.body.appendChild(root)
  const ctx: DocumentUtilitiesContext = {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:v1',
      getMarkdown: () => markdown,
      isStrictMode: () => false,
      vaultRoot: 'D:/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
  const providers: DocumentDiagnosticsProviders = {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => true,
    getHeadingIdentity: (el) => el.getAttribute('data-id'),
    parseLocalLinkTargets: () => [],
  }
  const h = new DocumentUtilityOverlayHost({ ctx, providers })
  h.mount()
  return { h, write }
}

function injectDiagnostics(h: DocumentUtilityOverlayHost, markdown: string): string[] {
  const r = computeDocumentDiagnostics(inputOf(markdown))
  const diags = r.diagnostics.filter(d =>
    d.code === 'FIGURE_BLOCK_STRUCTURE_INVALID'
    || d.code === 'FIGURE_MISSING_NAME'
    || d.code === 'FIGURE_LOCAL_IMAGE_MISSING')
  const snapshot = {
    documentKey: 'doc:v1', revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: diags, errorCount: 0, warningCount: 0, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as {
    diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void }
  }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for the transaction test */ }
  return diags.map(d => d.id)
}

async function locate(h: DocumentUtilityOverlayHost, id: string): Promise<void> {
  ;(h as unknown as { locateDiagnostic(id: string): void }).locateDiagnostic(id)
  await flushRaf()
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
  resetFigureBlockStructureV515State()
})

afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

describe('V1-HOST — structure block locate (whole owning block)', () => {
  it('V1-HOST-1: text+image structure error locates the WHOLE owning block, no inline ambiguity', async () => {
    const md = `before ![](${ASSET}) after\n`
    const { h, write } = makeHost(md)
    host = h
    write.innerHTML = `<p data-line="0">before ![](${ASSET}) after</p>`
    const p = write.querySelector('p') as HTMLElement
    stubRect(p, () => ({ left: 300, top: 100, right: 700, bottom: 118 }))
    stubRangeRectsByOffset(() => [{ left: 300, top: 100, right: 700, bottom: 118 }])
    const ids = injectDiagnostics(h, md)
    expect(ids).toHaveLength(1)

    await locate(h, ids[0])

    const locatorAudit = readAudit(infoSpy!, FIGURE_DIAGNOSTIC_LOCATOR_AUDIT, 0)
    expect(locatorAudit).not.toBeNull()
    expect(locatorAudit!.locatorKind).toBe('source-block')
    expect(locatorAudit!.resolveDecision).toBe('RESOLVED')
    expect(locatorAudit!.resolveReason).not.toBe('AMBIGUOUS_DUPLICATE_INLINE_RANGE')
    expect(locatorAudit!.resolvedNodeKind).toBe('p')
    expect(locatorAudit!.domBlockIdentity).toBe('dom-block:p:line:0')
    expect(locatorAudit!.finalDecision).toBe('PASS')

    const bindingAudit = readAudit(infoSpy!, FIGURE_SOURCE_DOM_BLOCK_BINDING_AUDIT, 0)
    expect(bindingAudit).not.toBeNull()
    expect(bindingAudit!.decision).toBe('BOUND')
    expect(bindingAudit!.domBlockIdentity).toBe('dom-block:p:line:0')

    expect(h.getFigureLocatorV1GateReport()).toContain('FIGURE_STRUCTURE_RUNTIME_UNRESOLVED_COUNT=0')
    expect(h.getFigureLocatorV1GateReport()).toContain('FIGURE_STRUCTURE_AMBIGUOUS_DUPLICATE_INLINE_RANGE_COUNT=0')
    expect(h.getFigureLocatorV1GateReport()).toContain('FIGURE_STRUCTURE_BLOCK_BINDING_MISSING_COUNT=0')
    expect(h.getFigureLocatorV1GateReport()).toContain('FIGURE_STRUCTURE_BLOCK_BINDING_AMBIGUOUS_COUNT=0')
    expect(h.getFigureLocatorV1CoverageReport()).toContain('FIGURE_STRUCTURE_BLOCK_LOCATE_RUNTIME_COUNT=1')
    expect(h.getFigureLocatorV1GateDecision().failedChecks).toEqual([])

    // LOCATE vs CLEANUP vs FEATURE — never one merged PASS.
    const decisions = h.getFigureLocateDecisions()
    expect(decisions.locateDecision).toBe('PASS')
    expect(decisions.featureDecision).toBe('PASS')
  })

  it('V1-HOST-2: `![](same.png) ![](same.png)` (one block, two tokens) still locates the WHOLE block', async () => {
    const md = `![](${SAME}) ![](${SAME})\n`
    const { h, write } = makeHost(md)
    host = h
    write.innerHTML = `<p data-line="0">![](${SAME}) ![](${SAME})</p>`
    const p = write.querySelector('p') as HTMLElement
    stubRect(p, () => ({ left: 300, top: 100, right: 700, bottom: 118 }))
    stubRangeRectsByOffset(() => [{ left: 300, top: 100, right: 700, bottom: 118 }])
    const ids = injectDiagnostics(h, md)
    const structureId = ids.find(id => id.includes('FIGURE_BLOCK_STRUCTURE_INVALID'))
    expect(structureId).toBeTruthy()

    await locate(h, structureId!)

    const locatorAudit = readAudit(infoSpy!, FIGURE_DIAGNOSTIC_LOCATOR_AUDIT, 0)
    expect(locatorAudit!.locatorKind).toBe('source-block')
    expect(locatorAudit!.resolveDecision).toBe('RESOLVED')
    expect(h.getFigureLocatorV1GateReport()).toContain('FIGURE_STRUCTURE_AMBIGUOUS_DUPLICATE_INLINE_RANGE_COUNT=0')
    expect(h.getFigureLocatorV1GateDecision().failedChecks).toEqual([])
  })
})

describe('V1-HOST — duplicate same.png occurrence locate + broken-image fallback', () => {
  it('V1-HOST-3: two duplicate same.png warnings locate two DISTINCT blocks', async () => {
    const md = `![](${SAME})\n\n![](${SAME})\n`
    const { h, write } = makeHost(md)
    host = h
    write.innerHTML = `<p data-line="0">![](${SAME})</p><p data-line="2">![](${SAME})</p>`
    const p0 = write.querySelectorAll('p')[0] as HTMLElement
    const p1 = write.querySelectorAll('p')[1] as HTMLElement
    stubRect(p0, () => ({ left: 300, top: 100, right: 372, bottom: 118 }))
    stubRect(p1, () => ({ left: 300, top: 200, right: 372, bottom: 218 }))
    stubRangeRectsByOffset((el) => (el === p0
      ? [{ left: 300, top: 100, right: 372, bottom: 118 }]
      : el === p1
        ? [{ left: 300, top: 200, right: 372, bottom: 218 }]
        : [{ left: 0, top: 0, right: 0, bottom: 0 }]))
    const ids = injectDiagnostics(h, md)
    const mn = ids.filter(id => id.includes('FIGURE_MISSING_NAME'))
    expect(mn).toHaveLength(2)

    await locate(h, mn[0])
    const a0 = readAudit(infoSpy!, FIGURE_DIAGNOSTIC_LOCATOR_AUDIT, 0)!
    expect(a0.locatorKind).toBe('figure-occurrence')
    expect(a0.resolveDecision).toBe('RESOLVED')
    expect(a0.domBlockIdentity).toBe('dom-block:p:line:0')
    const firstBlock = a0.resolvedBlockIdentity

    await locate(h, mn[1])
    const a1 = readAudit(infoSpy!, FIGURE_DIAGNOSTIC_LOCATOR_AUDIT, 1)!
    expect(a1.locatorKind).toBe('figure-occurrence')
    expect(a1.resolveDecision).toBe('RESOLVED')
    expect(a1.domBlockIdentity).toBe('dom-block:p:line:2')
    expect(a1.resolvedBlockIdentity).not.toBe(firstBlock)

    // The broken images have NO <img> DOM → the source-block fallback is used.
    expect(a0.usedFallback).toBe('true')
    expect(a1.usedFallback).toBe('true')

    expect(h.getFigureLocatorV1GateReport()).toContain('FIGURE_WARNING_RUNTIME_UNRESOLVED_COUNT=0')
    expect(h.getFigureLocatorV1GateReport()).toContain('FIGURE_WARNING_DUPLICATE_DESTINATION_AMBIGUITY_COUNT=0')
    expect(h.getFigureLocatorV1GateReport()).toContain('FIGURE_OCCURRENCE_IDENTITY_MISSING_COUNT=0')
    expect(h.getFigureLocatorV1CoverageReport()).toContain('FIGURE_MISSING_NAME_OCCURRENCE_LOCATE_RUNTIME_COUNT=2')
    expect(h.getFigureLocatorV1CoverageReport()).toContain('DUPLICATE_DESTINATION_DISTINCT_OCCURRENCE_LOCATE_RUNTIME_COUNT=2')
    expect(h.getFigureLocatorV1GateDecision().failedChecks).toEqual([])
  })

  it('V1-HOST-4: a broken local image resolves through the source-block fallback (§20)', async () => {
    const md = `![](missing.png)\n`
    const { h, write } = makeHost(md)
    host = h
    write.innerHTML = `<p data-line="0">![](missing.png)</p>`
    const p = write.querySelector('p') as HTMLElement
    stubRect(p, () => ({ left: 300, top: 100, right: 372, bottom: 118 }))
    stubRangeRectsByOffset(() => [{ left: 300, top: 100, right: 372, bottom: 118 }])
    const ids = injectDiagnostics(h, md)
    const missingId = ids.find(id => id.includes('FIGURE_LOCAL_IMAGE_MISSING'))
    expect(missingId).toBeTruthy()

    await locate(h, missingId!)

    const audit = readAudit(infoSpy!, FIGURE_DIAGNOSTIC_LOCATOR_AUDIT, 0)!
    expect(audit.locatorKind).toBe('figure-occurrence')
    expect(audit.resolveDecision).toBe('RESOLVED')
    expect(audit.usedFallback).toBe('true')
    expect(audit.domBlockIdentity).toBe('dom-block:p:line:0')
    expect(h.getFigureLocatorV1GateReport()).toContain('FIGURE_LOCAL_IMAGE_MISSING_WITHOUT_SOURCE_BLOCK_FALLBACK_COUNT=0')
    expect(h.getFigureLocatorV1CoverageReport()).toContain('FIGURE_LOCAL_IMAGE_MISSING_LOCATE_RUNTIME_COUNT=1')
    expect(h.getFigureLocatorV1GateDecision().failedChecks).toEqual([])
  })

  it('V1-HOST-5: the FULL runtime matrix satisfies every gate AND every coverage minimum', async () => {
    // structure + two duplicate-destination occurrences + a broken local image.
    const md = `before ![](${ASSET}) after\n\n![](${SAME})\n\n![](${SAME})\n`
    const { h, write } = makeHost(md)
    host = h
    write.innerHTML = `<p data-line="0">before ![](${ASSET}) after</p>`
      + `<p data-line="2">![](${SAME})</p>`
      + `<p data-line="4">![](${SAME})</p>`
    const ps = write.querySelectorAll('p')
    stubRect(ps[0], () => ({ left: 300, top: 100, right: 700, bottom: 118 }))
    stubRect(ps[1], () => ({ left: 300, top: 200, right: 372, bottom: 218 }))
    stubRect(ps[2], () => ({ left: 300, top: 300, right: 372, bottom: 318 }))
    stubRangeRectsByOffset((el) => (el === ps[0]
      ? [{ left: 300, top: 100, right: 700, bottom: 118 }]
      : el === ps[1]
        ? [{ left: 300, top: 200, right: 372, bottom: 218 }]
        : [{ left: 300, top: 300, right: 372, bottom: 318 }]))
    const ids = injectDiagnostics(h, md)
    const structureId = ids.find(id => id.includes('FIGURE_BLOCK_STRUCTURE_INVALID'))!
    const mn = ids.filter(id => id.includes('FIGURE_MISSING_NAME'))
    const lm = ids.filter(id => id.includes('FIGURE_LOCAL_IMAGE_MISSING'))
    expect(mn).toHaveLength(2)
    expect(lm).toHaveLength(2)

    await locate(h, structureId)
    await locate(h, mn[0])
    await locate(h, mn[1])
    await locate(h, lm[0])

    const decision = h.getFigureLocatorV1GateDecision()
    expect(decision.failedChecks).toEqual([])
    expect(decision.gateDecision).toBe('PASS')
    expect(decision.unmetCoverage).toEqual([])
    expect(decision.coverageDecision).toBe('PASS')
    expect(decision.decision).toBe('PASS')
    expect(h.getFigureLocatorV1GateReport()).toEqual(expect.arrayContaining([
      'FIGURE_STRUCTURE_RUNTIME_UNRESOLVED_COUNT=0',
      'FIGURE_STRUCTURE_AMBIGUOUS_DUPLICATE_INLINE_RANGE_COUNT=0',
      'FIGURE_STRUCTURE_BLOCK_BINDING_MISSING_COUNT=0',
      'FIGURE_STRUCTURE_BLOCK_BINDING_AMBIGUOUS_COUNT=0',
      'FIGURE_STRUCTURE_LOCATE_ROLLBACK_COUNT=0',
      'FIGURE_WARNING_RUNTIME_UNRESOLVED_COUNT=0',
      'FIGURE_WARNING_DUPLICATE_DESTINATION_AMBIGUITY_COUNT=0',
      'FIGURE_OCCURRENCE_IDENTITY_MISSING_COUNT=0',
      'FIGURE_OCCURRENCE_WRONG_TARGET_COUNT=0',
      'FIGURE_LOCAL_IMAGE_MISSING_WITHOUT_SOURCE_BLOCK_FALLBACK_COUNT=0',
      'FIGURE_RUNTIME_LOCATE_FALSE_PASS_COUNT=0',
    ]))
    const coverage = h.getFigureLocatorV1CoverageReport()
    const val = (key: string): number =>
      Number(coverage.find(l => l.startsWith(`${key}=`))?.split('=')[1] ?? '0')
    expect(val('FIGURE_STRUCTURE_BLOCK_LOCATE_RUNTIME_COUNT')).toBeGreaterThanOrEqual(1)
    expect(val('FIGURE_MISSING_NAME_OCCURRENCE_LOCATE_RUNTIME_COUNT')).toBeGreaterThanOrEqual(1)
    expect(val('FIGURE_LOCAL_IMAGE_MISSING_LOCATE_RUNTIME_COUNT')).toBeGreaterThanOrEqual(1)
    expect(val('DUPLICATE_DESTINATION_DISTINCT_OCCURRENCE_LOCATE_RUNTIME_COUNT')).toBeGreaterThanOrEqual(2)
    // LOCATE / CLEANUP / FEATURE never collapse into one PASS.
    const decisions = h.getFigureLocateDecisions()
    expect(decisions.locateDecision).toBe('PASS')
    expect(decisions.featureDecision).toBe('PASS')
  })
})

// ── the runtime fixture (source-level acceptance) ──────────────────────────

describe('V1-FIXTURE — the runtime fixture is fully locatable by construction', () => {
  const fixturePath = resolve(process.cwd(), 'test/vault/runtime/smoke/Figure-Diagnostic-Locator-V1-Test.md')
  const source = readFileSync(fixturePath, 'utf8')

  it('every figure diagnostic uses the correct locator and the contract PASSes', () => {
    // ONLY the declared EXPECTED_MISSING resource is absent (fixture closure).
    const missing = (t: string): boolean => (t.split('/').pop() ?? t) === 'missing-local-image.png'
    const out = computeDocumentDiagnostics(inputOf(source, { missing }))
    const structure = out.diagnostics.filter(d => d.code === 'FIGURE_BLOCK_STRUCTURE_INVALID')
    const missingName = out.diagnostics.filter(d => d.code === 'FIGURE_MISSING_NAME')
    const localMissing = out.diagnostics.filter(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING')

    // 6 structure blocks: S1..S4 + the two identical S5 blocks.
    expect(structure).toHaveLength(6)
    expect(structure.every(d => d.location?.kind === 'source-block')).toBe(true)
    // 3 unnamed valid figures: W1 (×2, the duplicate destination) + W2.
    expect(missingName).toHaveLength(3)
    expect(missingName.every(d => d.location?.kind === 'figure-occurrence')).toBe(true)
    // 1 absent local image: W3 ONLY (the single EXPECTED_MISSING case).
    expect(localMissing).toHaveLength(1)
    expect(localMissing.every(d => d.location?.kind === 'figure-occurrence')).toBe(true)
    expect(String(localMissing[0].metadata?.rawDestination)).toBe('missing-local-image.png')

    // §12/§22 — the two duplicate `repeated-visible.png` occurrences are
    // independently identified and share the SAME destination.
    const dup = missingName.filter(d =>
      String(d.metadata?.canonicalDestination ?? '').includes('repeated-visible.png'))
    expect(dup).toHaveLength(2)
    const dupIdentity = dup.map(d =>
      (d.location as { occurrenceIdentity: { sourceBlockIdentity: string } }).occurrenceIdentity.sourceBlockIdentity)
    expect(new Set(dupIdentity).size).toBe(2)

    const contract = computeDiagnosticLocationContract({
      documentKey: 'doc:v1', revision: 1, sourceRevision: 1, generatedAt: 0,
      diagnostics: out.diagnostics,
      errorCount: out.errorCount, warningCount: out.warningCount, infoCount: out.infoCount,
    })
    expect(contract.unlocatableDiagnosticCount).toBe(0)
    expect(contract.decision).toBe('PASS')
    expect(contract.sourceBlockLocationCount).toBe(structure.length)
    expect(contract.figureOccurrenceLocationCount).toBe(missingName.length + localMissing.length)
  })
})
