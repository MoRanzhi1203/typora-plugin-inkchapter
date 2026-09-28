// @vitest-environment jsdom
/**
 * V5.12-R5 — Duplicate Occurrence / Source-Range Authority Closure.
 *
 * THE DEFECT: two `![](same.png)` occurrences got a per-occurrence
 * `occurrenceIndex` and distinct source offsets, but the source RANGE identity
 * was dropped before the inline Range build, so the resolver fell back to the
 * FIRST text match — the second diagnostic painted the FIRST `same.png`.
 *
 * These kill-bug tests lock the fix:
 *
 *   R5-SOURCE-1  two same.png on separate lines → distinct identity/offsets
 *   R5-SOURCE-2  two same.png on ONE line → occurrenceWithinAnchor 0/1
 *   R5-SOURCE-3  three identical destinations → 0/1/2 all independent
 *   R5-SOURCE-4  image + link to the same canonical target → separate groups
 *   R5-SOURCE-5  encoded destination → canonical authority reused for grouping
 *   R5-SOURCE-6  source revision change → old diagnostic never commits old range
 *   R5-RANGE-1   occurrence-aware exact DOM Range (nth occurrence)
 *   R5-RANGE-2   re-measure keeps the nth occurrence (never back to the 1st)
 *   R5-RANGE-3   the frame controller paints the nth occurrence's range
 *   R5-GATE-1..5 the source-occurrence hard gate
 *   R5-HOST-1..3 the host locates occurrence 0/1 with REAL resolved facts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeDocumentDiagnostics, linkOccurrenceIndex } from './document-diagnostics'
import type { DocumentDiagnosticsInput, DiagnosticLinkFact } from './document-diagnostics'
import { parseLocalLinkTargets } from './document-utilities'
import { DiagnosticLocateFrameController } from './document-diagnostic-locate-frame'
import { measureTextFragmentRects } from './document-locate-visual-geometry-v4'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  SOURCE_OCCURRENCE_AUTHORITY_AUDIT_EVENT,
  SOURCE_OCCURRENCE_V512R5_GATE_KEYS,
  SOURCE_OCCURRENCE_V512R5_GATE_LABELS,
  buildSourceRangeIdentity,
  createSourceOccurrenceV512R5Counters,
  evaluateSourceOccurrenceAuthority,
  evaluateSourceOccurrenceV512R5Gates,
  formatSourceOccurrenceV512R5GateReport,
  selectOccurrenceOffset,
  sourceOccurrenceGateKeyForCheck,
  sourceOccurrenceGroupKey,
} from './document-diagnostic-source-occurrence-v512-r5'

// ── diagnostics fixtures ───────────────────────────────────────────────────
function factsFromMarkdown(markdown: string): DiagnosticLinkFact[] {
  const raw = parseLocalLinkTargets(markdown)
  return raw.map((f, i) => {
    const o = typeof f === 'string' ? { target: f } : f
    return {
      target: o.target,
      element: null,
      index: i,
      resourceKind: o.resourceKind ?? 'link',
      semanticDestination: o.target,
      sourceStart: o.sourceStart,
      sourceEnd: o.sourceEnd,
      startLine: o.startLine,
      endLine: o.endLine,
      startColumn: o.startColumn,
      endColumn: o.endColumn,
      rawText: o.rawText,
    }
  })
}

function inputOf(markdown: string): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:r5',
    markdown,
    strictMode: true,
    vaultRoot: 'D:/vault',
    headings: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: factsFromMarkdown(markdown),
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
  }
}

type Loc = {
  kind: string
  startLine: number
  sourceStart: number | null
  sourceEnd: number | null
  sourceRangeIdentity: string | null
  rawLineOrdinal: number | null
  occurrenceWithinLine: number | null
  occurrenceIndex: number | null
  canonicalDestination: string | null
  resourceKind: string | null
  rawDestination: string | null
}

function sourceImages(markdown: string): Array<{ meta: Record<string, unknown>; loc: Loc; id: string }> {
  const r = computeDocumentDiagnostics(inputOf(markdown))
  return r.diagnostics
    .filter(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING')
    .map(d => ({
      meta: (d.metadata ?? {}) as Record<string, unknown>,
      loc: d.location as unknown as Loc,
      id: d.id,
    }))
}

const TWO_LINES = '# T\n\n![](same.png)\n\n![](same.png)\n'
const ONE_LINE = '# T\n\n![a](same.png) text ![b](same.png)\n'
const THREE_LINES = '![](same.png)\n\n![](same.png)\n\n![](same.png)\n'

describe('R5-SOURCE — source occurrence identity never collapses', () => {
  it('R5-SOURCE-1: two same.png on separate lines → distinct identity + offsets', () => {
    const imgs = sourceImages(TWO_LINES)
    expect(imgs).toHaveLength(2)
    expect(imgs.map(i => i.meta.occurrenceIndex)).toEqual([0, 1])
    expect(imgs[0].meta.sourceStart).not.toBe(imgs[1].meta.sourceStart)
    expect(imgs[0].meta.sourceEnd).not.toBe(imgs[1].meta.sourceEnd)
    expect(imgs[0].loc.sourceRangeIdentity).not.toBeNull()
    expect(imgs[1].loc.sourceRangeIdentity).not.toBeNull()
    expect(imgs[0].loc.sourceRangeIdentity).not.toBe(imgs[1].loc.sourceRangeIdentity)
    // The source-range location carries the FULL source occurrence fact.
    expect(imgs[0].loc.sourceStart).not.toBe(imgs[1].loc.sourceStart)
    expect(imgs[0].loc.sourceEnd).not.toBe(imgs[1].loc.sourceEnd)
    expect(imgs.map(i => i.loc.rawLineOrdinal)).toEqual([0, 1])
    expect(imgs.map(i => i.loc.occurrenceWithinLine)).toEqual([0, 0])
  })

  it('R5-SOURCE-2: two same.png on ONE line → occurrenceWithinAnchor 0 / 1', () => {
    const imgs = sourceImages(ONE_LINE)
    expect(imgs).toHaveLength(2)
    expect(imgs.map(i => i.meta.occurrenceIndex)).toEqual([0, 1])
    // same owning line → the token ordinal inside the block is the only
    // disambiguator (the kill-bug case).
    expect(imgs.map(i => i.loc.rawLineOrdinal)).toEqual([0, 0])
    expect(imgs.map(i => i.loc.occurrenceWithinLine)).toEqual([0, 1])
    expect(imgs[0].loc.sourceStart).not.toBe(imgs[1].loc.sourceStart)
    expect(imgs[0].loc.sourceRangeIdentity).not.toBe(imgs[1].loc.sourceRangeIdentity)
  })

  it('R5-SOURCE-3: three identical destinations → 0 / 1 / 2 all independent', () => {
    const imgs = sourceImages(THREE_LINES)
    expect(imgs).toHaveLength(3)
    expect(imgs.map(i => i.meta.occurrenceIndex)).toEqual([0, 1, 2])
    const starts = new Set(imgs.map(i => i.loc.sourceStart))
    const identities = new Set(imgs.map(i => i.loc.sourceRangeIdentity))
    expect(starts.size).toBe(3)
    expect(identities.size).toBe(3)
  })

  it('R5-SOURCE-4: image + link to the same canonical target → separate groups', () => {
    const facts = [
      { target: 'same.png', resourceKind: 'image' as const, semanticDestination: 'same.png' },
      { target: 'same.png', resourceKind: 'link' as const, semanticDestination: 'same.png' },
    ]
    // The occurrence GROUP is (resourceKind + canonicalDestination).
    expect(sourceOccurrenceGroupKey('image', 'same.png')).not.toBe(sourceOccurrenceGroupKey('link', 'same.png'))
    expect(linkOccurrenceIndex(facts, 'same.png', 0, 'image', 'same.png')).toBe(0)
    expect(linkOccurrenceIndex(facts, 'same.png', 1, 'link', 'same.png')).toBe(0)
  })

  it('R5-SOURCE-5: encoded destination groups by the canonical (decoded) identity', () => {
    // Same canonical destination, one token percent-encoded → SAME group.
    const facts = [
      { target: 'a%20b.png', resourceKind: 'image' as const, semanticDestination: 'a b.png' },
      { target: 'a b.png', resourceKind: 'image' as const, semanticDestination: 'a b.png' },
    ]
    expect(linkOccurrenceIndex(facts, 'a%20b.png', 0, 'image', 'a b.png')).toBe(0)
    expect(linkOccurrenceIndex(facts, 'a b.png', 1, 'image', 'a b.png')).toBe(1)
  })

  it('R5-SOURCE-6: identity includes the source revision slot (stale range cannot collide)', () => {
    const a = buildSourceRangeIdentity({ documentKey: 'd', sourceRevision: 1, resourceKind: 'image', canonicalDestination: 'same.png', sourceStart: 5, sourceEnd: 18, occurrenceIndex: 0 })
    const b = buildSourceRangeIdentity({ documentKey: 'd', sourceRevision: 2, resourceKind: 'image', canonicalDestination: 'same.png', sourceStart: 5, sourceEnd: 18, occurrenceIndex: 0 })
    expect(a).not.toBe(b)
  })
})

// ── occurrence-aware DOM Range ─────────────────────────────────────────────
type Rect = { left: number; top: number; right: number; bottom: number }
let lastRangeEl: Element | null = null
let lastRangeOffset = -1

/** Capture (element, start offset) so a Range stub can be occurrence-aware. */
function stubRangeRectsByOffset(fn: (el: Element | null, offset: number) => Rect[]): void {
  const fake = {
    setStart(n: Node, o: number): void { lastRangeEl = (n as Text).parentElement ?? null; lastRangeOffset = o },
    setEnd(): void { /* noop */ },
    selectNodeContents(n: Node): void { lastRangeEl = (n as Element).parentElement ?? (n as Element); lastRangeOffset = -1 },
    getClientRects: () => fn(lastRangeEl, lastRangeOffset).map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top })),
  }
  ;(document as unknown as { createRange: () => unknown }).createRange = () => fake
}

describe('R5-RANGE — the exact nth occurrence drives the DOM Range', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    lastRangeEl = null
    lastRangeOffset = -1
  })

  it('R5-RANGE-1: occurrence 0 / 1 measure two DIFFERENT ranges', () => {
    const owner = document.createElement('p')
    owner.textContent = 'same.png x same.png'
    document.body.appendChild(owner)
    // token offsets: 0 and 11.
    stubRangeRectsByOffset((el, ov) => (el === owner && ov === 11
      ? [{ left: 200, top: 40, right: 272, bottom: 58 }]
      : [{ left: 100, top: 20, right: 172, bottom: 38 }]))
    const a = measureTextFragmentRects(owner, 'same.png', 0)
    const b = measureTextFragmentRects(owner, 'same.png', 1)
    expect(a.expected).toHaveLength(1)
    expect(b.expected).toHaveLength(1)
    expect(a.expected[0].left).toBe(100)
    expect(b.expected[0].left).toBe(200)
    expect(a.expected[0].left).not.toBe(b.expected[0].left)
  })

  it('R5-RANGE-2: re-measuring occurrence 1 never falls back to occurrence 0', () => {
    const owner = document.createElement('p')
    owner.textContent = 'same.png x same.png'
    document.body.appendChild(owner)
    stubRangeRectsByOffset((el, ov) => (el === owner && ov === 11
      ? [{ left: 200, top: 40, right: 272, bottom: 58 }]
      : [{ left: 100, top: 20, right: 172, bottom: 38 }]))
    const first = measureTextFragmentRects(owner, 'same.png', 1)
    const second = measureTextFragmentRects(owner, 'same.png', 1)
    expect(first.expected[0].left).toBe(200)
    expect(second.expected[0].left).toBe(200)
    // §8.3 — a missing nth occurrence is an explicit miss, never the 1st match.
    const missing = measureTextFragmentRects(owner, 'same.png', 2)
    expect(missing.expected).toHaveLength(0)
    expect(selectOccurrenceOffset(owner.textContent ?? '', 'same.png', 2)).toBeNull()
  })

  it('R5-RANGE-3: the frame controller paints the nth occurrence range', () => {
    const owner = document.createElement('p')
    owner.textContent = 'same.png x same.png'
    document.body.appendChild(owner)
    stubRangeRectsByOffset((el, ov) => (el === owner && ov === 11
      ? [{ left: 200, top: 40, right: 272, bottom: 58 }]
      : [{ left: 100, top: 20, right: 172, bottom: 38 }]))
    const root = document.createElement('div')
    document.body.appendChild(root)
    const ctrl = new DiagnosticLocateFrameController(root)
    ctrl.commit({
      diagnosticId: 'img:same.png:1',
      severity: 'error',
      anchor: owner,
      forceInlineMark: true,
      preciseRect: { left: 200, top: 40, right: 272, bottom: 58, width: 72, height: 18 },
      preciseTextPrefix: 'same.png',
      preciseOccurrenceWithinAnchor: 1,
    })
    const facts = ctrl.getInlineFragmentFacts()
    expect(facts.expected).toHaveLength(1)
    expect(facts.expected[0].left).toBe(200)
  })
})

// ── R5 hard gate ───────────────────────────────────────────────────────────
describe('R5-GATE — the source occurrence hard gate', () => {
  const base = {
    duplicateGroupSize: 2,
    resourceKind: 'image' as const,
    expectedOccurrenceIndex: 1,
    resolvedOccurrenceIndex: 1,
    expectedSourceRangeIdentity: 'A',
    resolvedSourceRangeIdentity: 'A',
    expectedSourceStart: 20,
    expectedSourceEnd: 33,
    resolvedSourceStart: 20,
    resolvedSourceEnd: 33,
    ambiguousFirstMatchFallback: false,
    sameRangeAsSiblingOccurrence: false,
    sameIdentityAsSiblingOccurrence: false,
  }

  it('R5-GATE-1: expected=1 resolved=0 → COMMIT FAIL', () => {
    const d = evaluateSourceOccurrenceAuthority({ ...base, resolvedOccurrenceIndex: 0, resolvedSourceRangeIdentity: 'B', resolvedSourceStart: 5, resolvedSourceEnd: 18 })
    expect(d.decision).toBe('FAIL')
    expect(d.mayProceedToCoordinateGate).toBe(false)
    expect(d.failedChecks).toContain('OCCURRENCE_EXPECTED_RESOLVED_MISMATCH')
  })

  it('R5-GATE-2: duplicate group with resolvedOccurrenceIndex=null → COMMIT FAIL', () => {
    const d = evaluateSourceOccurrenceAuthority({ ...base, resolvedOccurrenceIndex: null })
    expect(d.decision).toBe('FAIL')
    expect(d.failedChecks).toContain('OCCURRENCE_RESOLVED_INDEX_NULL')
  })

  it('R5-GATE-3: siblings with the SAME sourceRangeIdentity → FAIL', () => {
    const d = evaluateSourceOccurrenceAuthority({ ...base, sameIdentityAsSiblingOccurrence: true })
    expect(d.decision).toBe('FAIL')
    expect(d.failedChecks).toContain('DUPLICATE_DESTINATION_SAME_SOURCE_RANGE_IDENTITY')
  })

  it('R5-GATE-4: distinct source but the SAME visual range → FAIL', () => {
    const d = evaluateSourceOccurrenceAuthority({ ...base, sameRangeAsSiblingOccurrence: true })
    expect(d.decision).toBe('FAIL')
    expect(d.failedChecks).toContain('DUPLICATE_DESTINATION_SAME_SOURCE_RANGE')
  })

  it('R5-GATE-5: a single occurrence is never blocked by duplicate-only gates', () => {
    const d = evaluateSourceOccurrenceAuthority({
      ...base,
      duplicateGroupSize: 1,
      expectedOccurrenceIndex: 0,
      resolvedOccurrenceIndex: null,
      expectedSourceRangeIdentity: null,
      resolvedSourceRangeIdentity: null,
    })
    expect(d.decision).toBe('PASS')
    expect(d.mayProceedToCoordinateGate).toBe(true)
  })

  it('R5-GATE-6: the report is exactly the 11 gate counters and maps every check', () => {
    expect(SOURCE_OCCURRENCE_V512R5_GATE_KEYS).toHaveLength(11)
    const counters = createSourceOccurrenceV512R5Counters()
    const lines = formatSourceOccurrenceV512R5GateReport(counters)
    expect(lines).toHaveLength(11)
    expect(evaluateSourceOccurrenceV512R5Gates(counters).decision).toBe('PASS')
    counters.occurrenceExpectedResolvedMismatch = 1
    const failed = evaluateSourceOccurrenceV512R5Gates(counters)
    expect(failed.decision).toBe('FAIL')
    expect(failed.failing).toContain(SOURCE_OCCURRENCE_V512R5_GATE_LABELS.occurrenceExpectedResolvedMismatch)
    expect(sourceOccurrenceGateKeyForCheck('OCCURRENCE_EXPECTED_RESOLVED_MISMATCH')).toBe('occurrenceExpectedResolvedMismatch')
  })
})

// ── host end-to-end ────────────────────────────────────────────────────────
let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1
function stubRaf(): void {
  rafTasks = new Map()
  rafSeq = 1
  const raf = (cb: FrameRequestCallback): number => { const id = rafSeq++; rafTasks.set(id, cb); return id }
  const caf = (id: number): void => { rafTasks.delete(id) }
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = raf
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = caf
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

function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
function readAudit(spy: InfoSpy, event: string, nth = 0): Record<string, string> | null {
  const lines = spy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event))
  const line = lines[nth]
  if (!line) return null
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}

async function locate(h: DocumentUtilityOverlayHost, id: string): Promise<void> {
  ;(h as unknown as { locateDiagnostic(id: string): void }).locateDiagnostic(id)
  await flushRaf()
}

let infoSpy: InfoSpy | null = null
let host: DocumentUtilityOverlayHost | null = null

function makeHost(markdown: string): { h: DocumentUtilityOverlayHost; write: HTMLElement } {
  // A real scroll viewport (the framework uses #write.parentElement).
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
      getDocumentKey: () => 'doc:r5',
      getMarkdown: () => markdown,
      isStrictMode: () => true,
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

/** Inject the diagnostics computed from the SAME markdown the host reads. */
function injectDiagnostics(h: DocumentUtilityOverlayHost, markdown: string): string[] {
  const r = computeDocumentDiagnostics(inputOf(markdown))
  const diags = r.diagnostics.filter(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING')
  const snapshot = {
    documentKey: 'doc:r5',
    revision: 1,
    sourceRevision: 1,
    generatedAt: 0,
    diagnostics: diags,
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for the transaction test */ }
  return diags.map(d => d.id)
}

/**
 * Two `![](same.png)` blocks in the SAME document, WITHOUT `data-line` (the
 * real forensic situation) → the resolver must use the source ordinal, never
 * the first text match.
 */
function mountTwoBlocks(markdown: string): { h: DocumentUtilityOverlayHost; ids: string[]; p0: HTMLElement; p1: HTMLElement } {
  const { h, write } = makeHost(markdown)
  host = h
  write.innerHTML = '<p>![](same.png)</p><p>![](same.png)</p>'
  const p0 = write.querySelectorAll('p')[0] as HTMLElement
  const p1 = write.querySelectorAll('p')[1] as HTMLElement
  stubRect(p0, () => ({ left: 300, top: 100, right: 372, bottom: 118 }))
  stubRect(p1, () => ({ left: 300, top: 200, right: 372, bottom: 218 }))
  stubRangeRectsByOffset((el) => (el === p0
    ? [{ left: 300, top: 100, right: 372, bottom: 118 }]
    : el === p1
      ? [{ left: 300, top: 200, right: 372, bottom: 218 }]
      : [{ left: 0, top: 0, right: 0, bottom: 0 }]))
  const ids = injectDiagnostics(h, markdown)
  expect(ids).toHaveLength(2)
  return { h, ids, p0, p1 }
}

describe('R5-HOST — the host locates the REAL source occurrence', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
    stubRaf()
    Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
  })
  afterEach(() => {
    infoSpy?.mockRestore()
    infoSpy = null
    host?.dispose()
    host = null
    vi.unstubAllGlobals()
  })

  it('R5-HOST-1: occurrence 0 → 1 resolves distinct identities + distinct ranges', async () => {
    const { h, ids } = mountTwoBlocks(TWO_LINES)
    await locate(h, ids[0])
    const a0 = readAudit(infoSpy!, SOURCE_OCCURRENCE_AUTHORITY_AUDIT_EVENT, 0)
    expect(a0).not.toBeNull()
    expect(a0!.expectedOccurrenceIndex).toBe('0')
    expect(a0!.resolvedOccurrenceIndex).toBe('0')
    expect(a0!.sourceRangeIdentity !== 'null' && a0!.sourceRangeIdentity !== 'undefined' && a0!.sourceRangeIdentity !== '').toBe(true)
    expect(a0!.decision).toBe('PASS')
    const rect0 = a0!.rangeUnionRect
    const id0 = a0!.resolvedSourceRangeIdentity

    await locate(h, ids[1])
    const a1 = readAudit(infoSpy!, SOURCE_OCCURRENCE_AUTHORITY_AUDIT_EVENT, 1)
    expect(a1).not.toBeNull()
    expect(a1!.expectedOccurrenceIndex).toBe('1')
    expect(a1!.resolvedOccurrenceIndex).toBe('1')
    expect(a1!.decision).toBe('PASS')
    expect(a1!.resolvedSourceRangeIdentity).not.toBe(id0)
    expect(a1!.rangeUnionRect).not.toBe(rect0)
    expect(a1!.reason).not.toContain('DUPLICATE_OCCURRENCES_COLLAPSED_TO_SAME_RANGE')
    // Only the LAST occurrence's visual remains; the first marker is gone.
    const structure = h.getLocateFrameStructure()
    expect(structure.staleLocateFrameCount).toBe(0)
    expect(structure.inlineMarkCount).toBeLessThanOrEqual(1)
    const gates = h.getSourceOccurrenceV512R5GateDecision()
    expect(gates.decision).toBe('PASS')
    expect(h.getSourceOccurrenceV512R5GateReport()).toHaveLength(11)
  })

  it('R5-HOST-2: reverse 1 → 0 stays correct', async () => {
    const { h, ids } = mountTwoBlocks(TWO_LINES)
    await locate(h, ids[1])
    const a1 = readAudit(infoSpy!, SOURCE_OCCURRENCE_AUTHORITY_AUDIT_EVENT, 0)
    expect(a1!.resolvedOccurrenceIndex).toBe('1')
    await locate(h, ids[0])
    const a0 = readAudit(infoSpy!, SOURCE_OCCURRENCE_AUTHORITY_AUDIT_EVENT, 1)
    expect(a0!.resolvedOccurrenceIndex).toBe('0')
    expect(a0!.decision).toBe('PASS')
    expect(a0!.rangeUnionRect).not.toBe(a1!.rangeUnionRect)
    expect(h.getSourceOccurrenceV512R5GateDecision().decision).toBe('PASS')
  })

  it('R5-HOST-3: rapid 0 → 1 → 0 → 1 ends on occurrence 1', async () => {
    const { h, ids } = mountTwoBlocks(TWO_LINES)
    await locate(h, ids[0])
    await locate(h, ids[1])
    await locate(h, ids[0])
    await locate(h, ids[1])
    const last = readAudit(infoSpy!, SOURCE_OCCURRENCE_AUTHORITY_AUDIT_EVENT, 3)
    expect(last).not.toBeNull()
    expect(last!.resolvedOccurrenceIndex).toBe('1')
    expect(last!.decision).toBe('PASS')
    expect(h.getSourceOccurrenceV512R5GateDecision().decision).toBe('PASS')
    // The active visual is the LAST diagnostic, not a stale earlier one.
    expect(h.getLocateFrameStructure().activeDiagnosticId).toBe(ids[1])
  })
})
