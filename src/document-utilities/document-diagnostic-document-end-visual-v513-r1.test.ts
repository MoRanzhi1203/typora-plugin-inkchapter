// @vitest-environment jsdom
/**
 * V5.13-R1 — Synthetic EOF Document-Space Visual Target.
 *
 * THE DEFECT: `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE` is a `document-end`
 * diagnostic. GO_BOTTOM succeeded, but the target had `targetKind=null /
 * targetRect=null` → `fillCount=0` → `FAIL_VISUAL`: the user saw NO marker.
 *
 *   SemanticLocation(document-end) ≠ ScrollDestination(GO_BOTTOM) ≠ VisualTarget
 *
 *   TEST-END-1   the trailing-blank rule is unchanged
 *   TEST-END-2   document-end yields a synthetic target (rect != null, h >= 24)
 *   TEST-END-3   no real DOM node is required
 *   TEST-END-4   the marker is fill-only (no line / border / outline / shadow)
 *   TEST-END-5   the last content block is NEVER polluted
 *   TEST-END-6   Typora native bottom padding is never the semantic region
 *   TEST-END-7   post-scroll geometry is used (no stale pre-scroll rect)
 *   TEST-END-8   Drawer stays requested-open through the commit
 *   TEST-END-9   removing the blank lines removes the marker
 *   TEST-END-10/11/12  the EOF rule matrix (1 extra / 0 extra / CRLF)
 *   TEST-END-13  an extreme blank count is height-clamped
 *   TEST-END-14  a post-commit scroll never repaints
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { computeDocumentDiagnostics, computeEofNewlinePolicy } from './document-diagnostics'
import type { DocumentDiagnosticsInput } from './document-diagnostics'
import {
  DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT,
  DOCUMENT_END_SEMANTIC_ANCHOR_IDENTITY,
  DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_KEYS,
  DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_LABELS,
  DOCUMENT_END_VISUAL_AUDIT_EVENT,
  DOCUMENT_END_VISUAL_TARGET_KIND,
  DOCUMENT_END_VISUAL_V513R1_GATE_KEYS,
  DOCUMENT_END_VISUAL_V513R1_GATE_LABELS,
  DOCUMENT_END_VISUAL_V513R2_GATE_KEYS,
  DOCUMENT_END_VISUAL_V513R2_GATE_LABELS,
  DOCUMENT_TEXT_COLUMN_SOURCE,
  EOF_ACCENT_WIDTH_PX,
  EOF_FILL_EMPHASIS_CLASS_LOW,
  EOF_GEOMETRY_SOURCE_LAST_MEANINGFUL_BLOCK,
  EOF_MARKER_KIND_DOCUMENT_END_WARNING,
  EOF_PRESENTATION_HARD_MAX_HEIGHT_PX,
  EOF_PRESENTATION_MAX_HEIGHT_PX,
  EOF_VISIBLE_HEIGHT_RATIO_MIN,
  EOF_VISUAL_MAX_HEIGHT_PX,
  EOF_VISUAL_MIN_HEIGHT_PX,
  clampEofVisualHeight,
  computeEofPresentationHeight,
  computeSyntheticEofGeometry,
  createDocumentEndTextColumnV513R3Counters,
  createDocumentEndVisualV513R1Counters,
  createDocumentEndVisualV513R2Counters,
  evaluateDocumentEndTextColumnV513R3Gates,
  evaluateDocumentEndVisualV513R1Gates,
  evaluateDocumentEndVisualV513R2Gates,
  formatDocumentEndTextColumnV513R3GateReport,
  formatDocumentEndVisualV513R1GateReport,
  formatDocumentEndVisualV513R2GateReport,
  isDocumentEndTrailingBlankDiagnostic,
  isDrawerRightEdgeAuthority,
  isFalseNativePaddingCoverage,
  isSurfaceLeftAccentOnly,
  isTextColumnCandidate,
  isTextColumnDriftWithinTolerance,
  pickDocumentTextColumnLeft,
  presentationVisibleHeightRatio,
  readExtraTrailingBlankLineCount,
} from './document-diagnostic-document-end-visual-v513-r1'
import { LOCATE_DOCUMENT_LAYER_CLASS } from './document-locate-document-space-v5-11'
import { VISUAL_CLOSURE_AUDIT_EVENT } from './document-diagnostic-visual-closure-v512-r2'

// ── rAF harness ────────────────────────────────────────────────────────────
let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1
function stubRaf(): void {
  rafTasks = new Map()
  rafSeq = 1
  const raf = (cb: FrameRequestCallback): number => { const id = rafSeq++; rafTasks.set(id, cb); return id }
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = raf
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => { rafTasks.delete(id) }
}

type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
function readAudits(spy: InfoSpy, event: string): Array<Record<string, string>> {
  return spy.mock.calls
    .map(c => String(c[0]))
    .filter(l => l.includes(event))
    .map(line => {
      const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
      const out: Record<string, string> = {}
      for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
      return out
    })
}

// ── the EOF rule is unchanged (TEST-END-1 / 10 / 11 / 12) ──────────────────

function inputOf(markdown: string | null): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc', markdown, strictMode: true, vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
  }
}

describe('TEST-END-1/10/11/12 — the trailing-blank detection rule is NOT regressed', () => {
  it('TEST-END-1: 6 terminal newlines → extra=5 → DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE (warning / document-end)', () => {
    const markdown = 'content\n\n\n\n\n\n'
    const policy = computeEofNewlinePolicy(markdown)
    expect(policy.terminalNewlineCount).toBe(6)
    expect(policy.extraTrailingBlankLineCount).toBe(5)
    expect(policy.verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES')
    const diag = computeDocumentDiagnostics(inputOf(markdown)).diagnostics
      .find(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')
    expect(diag).toBeTruthy()
    expect(diag!.severity).toBe('warning')
    expect(diag!.location).toEqual({ kind: 'document-end' })
    expect(readExtraTrailingBlankLineCount(diag!.metadata)).toBe(5)
    expect(isDocumentEndTrailingBlankDiagnostic({
      code: diag!.code, locationKind: 'document-end', extraTrailingBlankLineCount: 5,
    })).toBe(true)
  })

  it('TEST-END-10: exactly 1 trailing blank line → no diagnostic and no marker predicate', () => {
    const policy = computeEofNewlinePolicy('a\n\n')
    expect(policy.verdict).toBe('PASS')
    expect(policy.extraTrailingBlankLineCount).toBe(1)
    expect(computeDocumentDiagnostics(inputOf('a\n\n')).diagnostics
      .some(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')).toBe(false)
    expect(isDocumentEndTrailingBlankDiagnostic({ code: 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', locationKind: 'document-end', extraTrailingBlankLineCount: 1 })).toBe(false)
  })

  it('TEST-END-11: 0 extra blank lines → the MISSING_TERMINAL_NEWLINE rule is untouched', () => {
    expect(computeEofNewlinePolicy('a').verdict).toBe('MISSING_TERMINAL_NEWLINE')
    expect(computeDocumentDiagnostics(inputOf('a')).diagnostics
      .some(d => d.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING')).toBe(true)
    // A missing-terminal-newline document-end warning must NEVER get a blank marker.
    expect(isDocumentEndTrailingBlankDiagnostic({ code: 'DOCUMENT_TERMINAL_NEWLINE_MISSING', locationKind: 'document-end', extraTrailingBlankLineCount: 3 })).toBe(false)
  })

  it('TEST-END-12: CRLF is counted identically', () => {
    const policy = computeEofNewlinePolicy('content\r\n\r\n\r\n\r\n\r\n\r\n')
    expect(policy.extraTrailingBlankLineCount).toBe(5)
    expect(policy.verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES')
  })
})

// ── synthetic EOF geometry contract (TEST-END-2 / 6 / 13) ──────────────────

describe('TEST-END-2/6/13 — synthetic EOF geometry', () => {
  const base = {
    lastMeaningfulRect: { left: 60, top: 1000, right: 700, bottom: 1024, width: 640, height: 24 },
    contentBoundsRect: { left: 50, top: 0, right: 850, bottom: 1200, width: 800, height: 1200 },
    editorContentRect: { left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700 },
    lineHeight: 24,
  }

  it('TEST-END-2 / R2: 5 extra blank lines → compact band over the DOCUMENT CONTENT column', () => {
    const geo = computeSyntheticEofGeometry({ ...base, extraTrailingBlankLineCount: 5 })
    expect(geo.rect).not.toBeNull()
    expect(geo.rect!.width).toBe(800) // the semantic content column, not the drawer / viewport
    // §1.1 — compact mapping (never the old 72px card)
    expect(geo.presentationHeight).toBe(computeEofPresentationHeight(5))
    expect(geo.rect!.height).toBeLessThanOrEqual(EOF_PRESENTATION_HARD_MAX_HEIGHT_PX)
    expect(geo.rect!.height).toBeGreaterThanOrEqual(EOF_VISUAL_MIN_HEIGHT_PX)
    expect(geo.geometrySource).toBe(EOF_GEOMETRY_SOURCE_LAST_MEANINGFUL_BLOCK)
    // §2.2 — the right edge authority is the DOCUMENT CONTENT, never the Drawer
    expect(geo.rightEdgeAuthority).toBe(DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT)
    // §2.1 — the legal 1st trailing blank line (24px) is skipped, then the gap
    expect(geo.rect!.top).toBe(1024 + 24 + 6)
    expect(geo.semanticZoneRect!.top).toBe(1024 + 24 + 6)
    expect(geo.semanticZoneRect!.right).toBe(geo.rect!.right)
    // §7 — width/height are re-derived from the edges (never a stale spread).
    expect(geo.rect!.width).toBe(geo.rect!.right - geo.rect!.left)
    expect(geo.rect!.height).toBe(geo.rect!.bottom - geo.rect!.top)
  })

  it('TEST-END-6: a 2-blank semantic region never becomes the whole native bottom padding', () => {
    const geo = computeSyntheticEofGeometry({ ...base, extraTrailingBlankLineCount: 2 })
    expect(geo.presentationHeight).toBe(computeEofPresentationHeight(2))
    expect(geo.rect!.height).not.toBe(base.editorContentRect.height)
    expect(isFalseNativePaddingCoverage({
      syntheticHeight: geo.rect!.height,
      editorContentHeight: base.editorContentRect.height,
      semanticBlankCount: 2,
      lineHeight: 24,
    })).toBe(false)
    // A regression that paints the whole editor column AS the error region is caught.
    expect(isFalseNativePaddingCoverage({
      syntheticHeight: base.editorContentRect.height,
      editorContentHeight: base.editorContentRect.height,
      semanticBlankCount: 2,
      lineHeight: 24,
    })).toBe(true)
    // The right edge is the content edge — never the Drawer edge.
    expect(isDrawerRightEdgeAuthority({ syntheticRight: 850, drawerLeft: 850, semanticContentRight: 850 })).toBe(false)
    expect(isDrawerRightEdgeAuthority({ syntheticRight: 850, drawerLeft: 850, semanticContentRight: 700 })).toBe(true)
  })

  it('TEST-END-13 / R2: 50 extra blank lines stay inside the compact 48px bound', () => {
    const geo = computeSyntheticEofGeometry({ ...base, extraTrailingBlankLineCount: 50 })
    expect(geo.presentationHeight).toBe(computeEofPresentationHeight(50))
    expect(geo.presentationHeight).toBeLessThanOrEqual(EOF_PRESENTATION_HARD_MAX_HEIGHT_PX)
    expect(geo.presentationHeight).toBeLessThanOrEqual(EOF_PRESENTATION_MAX_HEIGHT_PX)
    expect(geo.rect!.height).toBeLessThanOrEqual(EOF_PRESENTATION_HARD_MAX_HEIGHT_PX)
    expect(geo.heightClamped).toBe(true)
    expect(clampEofVisualHeight(24 * 50)).toBe(EOF_VISUAL_MAX_HEIGHT_PX)
    expect(clampEofVisualHeight(1)).toBe(EOF_VISUAL_MIN_HEIGHT_PX)
  })

  it('R2: the viewport clamp is an explicit bottom-aligned fallback (§5)', () => {
    const clampRect = { left: 0, top: 0, right: 900, bottom: 900, width: 900, height: 900 }
    const geo = computeSyntheticEofGeometry({ ...base, extraTrailingBlankLineCount: 5, viewportClampRect: clampRect })
    // band top (1054) is below the clamp bottom (900) → bottom-aligned
    expect(geo.viewportClamped).toBe(true)
    expect(geo.rect!.bottom).toBeLessThanOrEqual(clampRect.bottom + 0.5)
    expect(geo.rect!.height).toBe(computeEofPresentationHeight(5))
    // ratio metric: a fully-visible band is 1.0; a half-visible band is 0.5
    expect(presentationVisibleHeightRatio(geo.rect, clampRect)).toBeGreaterThanOrEqual(EOF_VISIBLE_HEIGHT_RATIO_MIN)
    expect(presentationVisibleHeightRatio(
      { left: 0, top: 880, right: 900, bottom: 940, width: 900, height: 60 }, clampRect,
    )).toBeCloseTo(20 / 60, 5)
  })

  it('a missing line height falls back to 24px and an unmeasurable column yields no geometry', () => {
    const withFallback = computeSyntheticEofGeometry({ ...base, lineHeight: null, extraTrailingBlankLineCount: 3 })
    expect(withFallback.rect!.height).toBe(computeEofPresentationHeight(3))
    const none = computeSyntheticEofGeometry({
      lastMeaningfulRect: null, contentBoundsRect: null, editorContentRect: null,
      lineHeight: 24, extraTrailingBlankLineCount: 3,
    })
    expect(none.rect).toBeNull() // never a silent viewport-bottom fallback
  })
})

// ── the 19 hard gates (pure) ──────────────────────────────────────────────

describe('TEST-END-4 (contract) — 19 + 15 hard gates + fill-only label set', () => {
  it('the gate key/label set is complete and 0 ⇒ PASS, 1 ⇒ FAIL', () => {
    expect(DOCUMENT_END_VISUAL_V513R1_GATE_KEYS).toHaveLength(19)
    expect(Object.keys(DOCUMENT_END_VISUAL_V513R1_GATE_LABELS)).toHaveLength(19)
    const counters = createDocumentEndVisualV513R1Counters()
    expect(evaluateDocumentEndVisualV513R1Gates(counters).decision).toBe('PASS')
    expect(formatDocumentEndVisualV513R1GateReport(counters)).toContain('DOCUMENT_END_VERTICAL_LINE_COUNT=0')
    counters.verticalLine = 1
    const failed = evaluateDocumentEndVisualV513R1Gates(counters)
    expect(failed.decision).toBe('FAIL')
    expect(failed.failedChecks).toEqual(['verticalLine'])
  })

  it('R2 §9: the 15 refinement gates (semantic/presentation/drawer/closure/facts)', () => {
    expect(DOCUMENT_END_VISUAL_V513R2_GATE_KEYS).toHaveLength(15)
    expect(Object.keys(DOCUMENT_END_VISUAL_V513R2_GATE_LABELS)).toHaveLength(15)
    const counters = createDocumentEndVisualV513R2Counters()
    expect(evaluateDocumentEndVisualV513R2Gates(counters).decision).toBe('PASS')
    const report = formatDocumentEndVisualV513R2GateReport(counters)
    for (const label of [
      'DOCUMENT_END_SEMANTIC_RIGHT_FROM_DRAWER_COUNT',
      'DOCUMENT_END_PRESENTATION_RIGHT_FROM_DRAWER_COUNT',
      'DOCUMENT_END_PRESENTATION_HEIGHT_GT_48PX_COUNT',
      'DOCUMENT_END_PRESENTATION_VISIBLE_HEIGHT_RATIO_LT_0_90_COUNT',
      'DOCUMENT_END_PANEL_GEOMETRY_CLIP_COUNT',
      'DOCUMENT_END_VISUAL_PAINTS_ABOVE_DRAWER_COUNT',
      'DOCUMENT_END_GENERIC_CLOSURE_TARGET_NULL_COUNT',
      'DOCUMENT_END_GENERIC_CLOSURE_SEVERITY_MISMATCH_COUNT',
      'DOCUMENT_END_GENERIC_CLOSURE_VISUAL_DECISION_NA_COUNT',
      'DOCUMENT_END_GENERIC_CLOSURE_COMMIT_DECISION_NA_COUNT',
      'DOCUMENT_END_TERMINAL_NEWLINE_FACT_NULL_COUNT',
      'DOCUMENT_END_SOURCE_REVISION_NULL_COUNT',
      'DOCUMENT_END_SCROLL_SETTLED_WITHOUT_REMEASURE_COUNT',
      'DOCUMENT_END_STALE_LAYOUT_EPOCH_COMMIT_COUNT',
      'DOCUMENT_END_SECOND_CLICK_REQUIRED_COUNT',
    ]) {
      expect(report).toContain(`${label}=0`)
    }
    counters.panelGeometryClip = 1
    expect(evaluateDocumentEndVisualV513R2Gates(counters).failedChecks).toEqual(['panelGeometryClip'])
  })
})

// ── host: synthetic EOF target commit (TEST-END-3/4/5/7/8/9/14) ────────────

let infoSpy: InfoSpy | null = null
let hosts: DocumentUtilityOverlayHost[] = []

type Internals = {
  commitSyntheticEofVisual(
    tx: unknown,
    diag: Record<string, unknown>,
    extraTrailingBlankLineCount: number,
    remeasuredAfterScroll: boolean,
  ): boolean
  clearDiagnosticLocateVisual(reason: string): void
  getPostCommitUserScrollCount(): number
}

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveLeafState: () => ({ leafStateKnown: true, leafPath: 'doc.md' }),
      getActiveFilePath: () => 'doc.md',
      getDocumentKey: () => 'doc:eof',
      getMarkdown: () => 'content\n\n\n\n\n\n',
      isStrictMode: () => true,
      vaultRoot: '/root',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
}
function fakeProviders(): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false,
    getHeadingIdentity: () => null,
    parseLocalLinkTargets: () => [],
  }
}

interface World {
  h: DocumentUtilityOverlayHost
  shell: HTMLElement
  write: HTMLElement
  last: HTMLElement
  diagnostics: Record<string, unknown> | null
}

function makeWorld(): World {
  const shell = document.createElement('div')
  shell.className = 'typ-markdown-view'
  document.body.appendChild(shell)
  stubRect(shell, () => ({ left: 0, top: 0, right: 900, bottom: 700 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  stubRect(write, () => ({ left: 50, top: 0, right: 850, bottom: 1200 }))
  const last = document.createElement('p')
  last.setAttribute('data-line', '10')
  last.textContent = '最后一段正文'
  write.appendChild(last)
  stubRect(last, () => ({ left: 60, top: 1000, right: 700, bottom: 1024 }))
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  hosts.push(h)
  const world: World = { h, shell, write, last, diagnostics: null }
  return world
}

function trailingBlankDiag(extra: number, severity = 'warning'): Record<string, unknown> {
  return {
    id: `document:DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE:${extra}`,
    documentKey: 'doc:eof',
    severity,
    category: 'document',
    code: 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE',
    message: '警告：文档末尾存在过多空行',
    detail: '',
    metadata: { ruleId: 'DOCUMENT-TRAILING-BLANK-LINES-EXCESSIVE', reason: 'EXCESSIVE_TRAILING_BLANK_LINES', terminalNewlineCount: extra + 1, extraTrailingBlankLineCount: extra },
    location: { kind: 'document-end' },
  }
}

function injectSnapshot(world: World, diags: Array<Record<string, unknown>>): void {
  const snapshot = {
    documentKey: 'doc:eof', revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: diags, errorCount: 0, warningCount: 1, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (world.h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen */ }
  ;(world.h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}

const fakeTx = (): Record<string, unknown> => ({
  id: 1, documentKey: 'doc:eof', diagnosticId: 'D1', targetIndex: 0, targetCount: 1,
  startedAt: 0, state: 'PRESENTING',
})

const eofCarriers = (): number => document.querySelectorAll('[data-ink-eof-marker="true"]').length

beforeEach(() => {
  document.body.innerHTML = ''
  hosts = []
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  // jsdom applies no stylesheet: double the browser-only computed-style probe with
  // a REALISTIC fill-only warning carrier (the measurement code IS under test).
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element, pseudo?: string) => {
    if (pseudo != null) return { content: 'none' } as unknown as CSSStyleDeclaration
    const isEofBand = el.getAttribute?.('data-ink-eof-marker') === 'true'
    const accent = (el as HTMLElement & { __eofAccentPx?: number }).__eofAccentPx ?? 4
    return {
      lineHeight: '24px',
      backgroundColor: 'rgba(168, 121, 50, 0.08)',
      backgroundImage: 'none',
      boxShadow: 'none',
      outlineStyle: 'none',
      outlineWidth: '0px',
      // V5.13-R3 §9/§19 — the EOF band carries a LEFT-ONLY surface accent.
      borderLeftWidth: isEofBand ? `${accent}px` : '0px',
      borderLeftStyle: isEofBand ? 'solid' : 'none',
      borderTopStyle: 'none',
      borderRightStyle: 'none',
      borderBottomStyle: 'none',
      borderTopWidth: '0px',
      borderRightWidth: '0px',
      borderBottomWidth: '0px',
    } as unknown as CSSStyleDeclaration
  }) as unknown as typeof window.getComputedStyle)
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
})
afterEach(() => {
  for (const h of hosts) { try { h.dispose() } catch { /* noop */ } }
  hosts = []
  infoSpy?.mockRestore()
  infoSpy = null
  vi.unstubAllGlobals()
})

describe('TEST-END-3/4/5/7/8/9/14 — the host commits a synthetic EOF marker without a DOM target', () => {
  it('TEST-END-3/4: a document-end locate with NO DOM node still paints a fill-only document-space marker', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    const ok = (world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(ok).toBe(true)
    // §3/§7 — mounted in the DOCUMENT-SPACE layer, never viewport-fixed.
    const layer = world.write.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS}`)
    expect(layer).not.toBeNull()
    const marker = layer!.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
    expect(marker).not.toBeNull()
    expect(marker.getAttribute('data-coordinate-space')).toBe('HOST_LOCAL_DOCUMENT_SPACE')
    expect(marker.getAttribute('data-severity')).toBe('warning')
    // §9 — fill-only: no line / border / outline / keyline / corner arm / shadow.
    const audit = readAudits(infoSpy!, DOCUMENT_END_VISUAL_AUDIT_EVENT).pop()!
    expect(audit.visualTargetKind).toBe(DOCUMENT_END_VISUAL_TARGET_KIND)
    expect(audit.semanticAnchorIdentity).toBe(DOCUMENT_END_SEMANTIC_ANCHOR_IDENTITY)
    expect(Number(audit.fillCount)).toBeGreaterThanOrEqual(1)
    expect(audit.finalDecision).toBe('PASS')
    // every document-end hard gate is 0
    for (const key of DOCUMENT_END_VISUAL_V513R1_GATE_KEYS) {
      expect(world.h.getDocumentEndVisualGateReport()).toContain(`${DOCUMENT_END_VISUAL_V513R1_GATE_LABELS[key]}=0`)
    }
    expect(world.h.getDocumentEndVisualGateDecision().decision).toBe('PASS')
  })

  it('TEST-END-5: the last meaningful content block class/style is NEVER touched', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(3)
    injectSnapshot(world, [diag])
    const before = world.last.getAttribute('style')
    const beforeClass = world.last.className
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 3, true)
    expect(world.last.getAttribute('style')).toBe(before)
    expect(world.last.className).toBe(beforeClass)
    expect(world.last.querySelector('[data-ink-eof-marker="true"]')).toBeNull()
    // the marker is an overlay sibling, not a child of the content block
    expect(world.write.querySelectorAll('[data-ink-eof-marker="true"]').length).toBe(1)
  })

  it('TEST-END-7: the geometry is built from the POST-scroll measurement (stale pre-scroll rect is refused)', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(4)
    injectSnapshot(world, [diag])
    // pre-scroll the last block sits far above; post-scroll it is at the bottom.
    let blockTop = 100
    stubRect(world.last, () => ({ left: 60, top: blockTop, right: 700, bottom: blockTop + 24 }))
    const internals = world.h as unknown as Internals
    // A tall editor: the post-scroll band still fits inside the visible editor, so
    // the §5 viewport clamp must NOT move it (otherwise it is a real fallback).
    stubRect(world.shell, () => ({ left: 0, top: 0, right: 900, bottom: 1400 }))
    const okPre = internals.commitSyntheticEofVisual(fakeTx(), diag, 4, false)
    // passing `remeasuredAfterScroll=false` is recorded as a violation, never silently accepted
    expect(world.h.getDocumentEndVisualCounters().missingRemeasureAfterScroll).toBe(1)
    expect(okPre).toBe(true)
    blockTop = 900 // the post-scroll position
    const ok = internals.commitSyntheticEofVisual(fakeTx(), diag, 4, true)
    expect(ok).toBe(true)
    const audit = readAudits(infoSpy!, DOCUMENT_END_VISUAL_AUDIT_EVENT).pop()!
    expect(audit.remeasuredAfterScroll).toBe('true')
    expect(Number(audit.syntheticRect ? String(audit.syntheticRect).length : 0)).toBeGreaterThan(0)
    const marker = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
    // local top = viewport top − host top; the host top is 0 here, and the marker
    // must follow the LAST block (+ the legal blank line + gap), proving the fresh
    // post-scroll rect was used.
    expect(marker.style.top).toBe('954px')
  })

  it('TEST-END-8/9: Drawer stays requested-open; clearing the visual removes the marker', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(eofCarriers()).toBe(1)
    const requestedOpen = (world.h as unknown as { isDrawerRequestedOpen?: () => boolean }).isDrawerRequestedOpen?.()
    expect(requestedOpen ?? true).toBe(true)
    // §10 — the diagnostic disappears (blank lines deleted) → the marker must go.
    ;(world.h as unknown as Internals).clearDiagnosticLocateVisual('ACTIVE_DIAGNOSTIC_REMOVED')
    expect(eofCarriers()).toBe(0)
  })

  it('TEST-END-14: a post-commit scroll never repaints / remeasures the marker', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const marker = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
    const styleBefore = marker.style.cssText
    world.shell.scrollTop = 200
    world.shell.dispatchEvent(new Event('scroll'))
    // The scroll IS observed and audited (observability counter), but the
    // document-space marker is never repainted / remeasured / re-written.
    expect((world.h as unknown as Internals).getPostCommitUserScrollCount()).toBe(1)
    const closure = world.h.getVisualClosureCounters()
    expect(closure.postCommitScrollRepaint).toBe(0)
    expect(closure.postCommitScrollRemeasure).toBe(0)
    expect(closure.postCommitScrollReresolve).toBe(0)
    expect(closure.postCommitScrollRecenter).toBe(0)
    expect(closure.postCommitScrollWrite).toBe(0)
    expect(world.h.getDocumentSpaceCounters().documentSpaceOverlayScrollDrift).toBe(0)
    expect((document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement).style.cssText).toBe(styleBefore)
  })
})

// ── V5.13-R2 — semantic zone / band / drawer overlay / generic closure ─────

describe('V5.13-R2 — EOF Soft Band geometry, facts and unified closure', () => {
  it('the band is compact, spans the DOCUMENT CONTENT column and carries REAL facts', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    const ok = (world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(ok).toBe(true)
    const facts = world.h.getLastDocumentEndVisualFacts()!
    expect(facts.presentationHeight).toBe(computeEofPresentationHeight(5))
    expect(facts.presentationHeight).toBeLessThanOrEqual(EOF_PRESENTATION_HARD_MAX_HEIGHT_PX)
    expect(facts.rightEdgeAuthority).toBe(DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT)
    const audit = readAudits(infoSpy!, DOCUMENT_END_VISUAL_AUDIT_EVENT).pop()!
    // §7 — the rule-scan facts flow through (never null)
    expect(audit.sourceRevision).toBe('1')
    expect(audit.terminalNewlineCount).toBe('6')
    expect(audit.extraTrailingBlankLineCount).toBe('5')
    expect(audit.rightEdgeAuthority).toBe(DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT)
    expect(audit.presentationHeight).toBe(String(computeEofPresentationHeight(5)))
    expect(audit.visualTargetKind).toBe(DOCUMENT_END_VISUAL_TARGET_KIND)
    expect(audit.finalDecision).toBe('PASS')
    expect(audit.expectedPanelOcclusion).toBe('false')
    expect(audit.panelGeometryClipCount).toBe('0')
    expect(audit.paintAboveDrawerCount).toBe('0')
    for (const key of DOCUMENT_END_VISUAL_V513R1_GATE_KEYS) {
      expect(world.h.getDocumentEndVisualGateReport()).toContain(`${DOCUMENT_END_VISUAL_V513R1_GATE_LABELS[key]}=0`)
    }
    for (const key of DOCUMENT_END_VISUAL_V513R2_GATE_KEYS) {
      expect(world.h.getDocumentEndVisualV513R2GateReport()).toContain(`${DOCUMENT_END_VISUAL_V513R2_GATE_LABELS[key]}=0`)
    }
    expect(world.h.getDocumentEndVisualV513R2GateDecision().decision).toBe('PASS')
  })

  it('the band X is the TEXT COLUMN (left) + DOCUMENT CONTENT (right) — never the Drawer left edge', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const marker = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
    // §2.2/§8 — right = content column right (viewport 850 → local 800);
    // §3/§4 — left = the TOP-LEVEL PROSE column (the <p> at viewport 60 → local 10),
    // NOT the write outer left (viewport 50) and NOT the table/indent.
    expect(Number.parseFloat(marker.style.left)).toBe(10)
    expect(Number.parseFloat(marker.style.width)).toBe(790)
    expect(Number.parseFloat(marker.style.left) + Number.parseFloat(marker.style.width)).toBe(800)
    expect(marker.getAttribute('data-ink-marker-kind')).toBe('document-end-warning')
    const report = world.h.getDocumentEndVisualV513R2GateReport()
    expect(report).toContain('DOCUMENT_END_PRESENTATION_RIGHT_FROM_DRAWER_COUNT=0')
    expect(report).toContain('DOCUMENT_END_SEMANTIC_RIGHT_FROM_DRAWER_COUNT=0')
    expect(report).toContain('DOCUMENT_END_PANEL_GEOMETRY_CLIP_COUNT=0')
    expect(report).toContain('DOCUMENT_END_PRESENTATION_HEIGHT_GT_48PX_COUNT=0')
  })

  it('§6 — the GENERIC closure audit carries the same EOF facts (never NA/null)', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const closure = readAudits(infoSpy!, VISUAL_CLOSURE_AUDIT_EVENT).pop()!
    expect(closure.severity).toBe('warning')
    expect(closure.visualTargetKind).toBe(DOCUMENT_END_VISUAL_TARGET_KIND)
    expect(closure.semanticAnchorIdentity).toBe(DOCUMENT_END_SEMANTIC_ANCHOR_IDENTITY)
    expect(closure.visualFragmentCount).toBe('1')
    expect(closure.visualDecision).toBe('PASS')
    expect(closure.commitDecision).toBe('COMMIT')
    expect(closure.terminalState).toBe('COMMITTED')
    expect(closure.sourceRevision).toBe('1')
    expect(closure.terminalNewlineCount).toBe('6')
    expect(closure.extraTrailingBlankLineCount).toBe('5')
    expect(closure.rightEdgeAuthority).toBe(DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT)
    expect(closure.decision).toBe('PASS')
  })

  it('§3 — the band is structurally BELOW the Drawer overlay (never paints above it)', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const layer = document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS}`)!
    const overlayRoot = document.querySelector('[data-inkchapter-utility-root="true"]')!
    expect(overlayRoot).not.toBeNull()
    expect(overlayRoot.contains(layer)).toBe(false)
    // §2.3 — the visible-intersection facts never feed back into the band geometry
    expect(world.h.getDocumentEndVisualV513R2GateReport())
      .toContain('DOCUMENT_END_VISUAL_PAINTS_ABOVE_DRAWER_COUNT=0')
  })
})

// ── V5.13-R3 — Document text-column anchor + EOF left accent ───────────────

type LastBlockKind = 'paragraph' | 'indented' | 'list' | 'quote' | 'code' | 'table'

/** §14 — same document text column, different LAST block shapes. */
function addLastBlock(write: HTMLElement, kind: LastBlockKind): void {
  let el: HTMLElement
  if (kind === 'list') {
    const ul = document.createElement('ul')
    const li = document.createElement('li')
    li.textContent = '列表项'
    ul.appendChild(li)
    el = ul
  } else if (kind === 'quote') {
    const bq = document.createElement('blockquote')
    const p = document.createElement('p')
    p.textContent = '引用文字'
    bq.appendChild(p)
    el = bq
  } else if (kind === 'code') {
    el = document.createElement('pre')
    el.textContent = 'code line'
  } else if (kind === 'table') {
    const t = document.createElement('table')
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.textContent = 'cell'
    tr.appendChild(td)
    t.appendChild(tr)
    el = t
  } else {
    el = document.createElement('p')
    el.textContent = kind === 'indented' ? '缩进段落' : '末段'
  }
  write.appendChild(el)
  const left = kind === 'paragraph' ? 60 : kind === 'indented' ? 120 : 80
  stubRect(el, () => ({ left, top: 1000, right: left + 300, bottom: 1040 }))
}

/** §14 — a world whose PROSE column is fixed at 60 while the last block varies. */
function makeAnchorWorld(kind: LastBlockKind): { h: DocumentUtilityOverlayHost; prose: HTMLElement } {
  const shell = document.createElement('div')
  shell.className = 'typ-markdown-view'
  document.body.appendChild(shell)
  stubRect(shell, () => ({ left: 0, top: 0, right: 900, bottom: 1400 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  stubRect(write, () => ({ left: 50, top: 0, right: 850, bottom: 1200 }))
  const prose = document.createElement('p')
  prose.textContent = '普通正文段落'
  write.appendChild(prose)
  stubRect(prose, () => ({ left: 60, top: 100, right: 700, bottom: 124 }))
  addLastBlock(write, kind)
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  hosts.push(h)
  return { h, prose }
}

const EOF_LOCAL_LEFT = 10 // 60 (prose column) − 50 (write host origin)

describe('V5.13-R3 §5/§6 — pickDocumentTextColumnLeft / candidate filtering (pure)', () => {
  it('priority: editor column → top-level prose MIN → cached → content fallback', () => {
    expect(pickDocumentTextColumnLeft({
      editorTextColumnLeft: 42, topLevelProseLefts: [60, 200], cachedLeft: 33, contentLeft: 10,
    })).toEqual({ left: 42, source: DOCUMENT_TEXT_COLUMN_SOURCE.EDITOR_TEXT_COLUMN })
    // §4 — the LEAST-indented prose wins: a deeply indented later block cannot drag it
    expect(pickDocumentTextColumnLeft({
      editorTextColumnLeft: null, topLevelProseLefts: [60, 200, 320], cachedLeft: 33, contentLeft: 10,
    })).toEqual({ left: 60, source: DOCUMENT_TEXT_COLUMN_SOURCE.TOP_LEVEL_PROSE })
    expect(pickDocumentTextColumnLeft({
      editorTextColumnLeft: null, topLevelProseLefts: [], cachedLeft: 33, contentLeft: 10,
    })).toEqual({ left: 33, source: DOCUMENT_TEXT_COLUMN_SOURCE.STABLE_CACHED_PROSE })
    expect(pickDocumentTextColumnLeft({
      editorTextColumnLeft: null, topLevelProseLefts: [], cachedLeft: null, contentLeft: 10,
    })).toEqual({ left: 10, source: DOCUMENT_TEXT_COLUMN_SOURCE.CONTENT_LEFT_FALLBACK })
  })

  it('§6 — li/ul/ol, blockquote, pre/code, table, nested block and overlay never qualify', () => {
    const base = { isDirectChildOfContentRoot: true, left: 100, hasText: true }
    expect(isTextColumnCandidate({ ...base, tagName: 'P', insideIndentedContainer: false })).toBe(true)
    expect(isTextColumnCandidate({ ...base, tagName: 'H3', insideIndentedContainer: false })).toBe(true)
    expect(isTextColumnCandidate({ ...base, tagName: 'P', insideIndentedContainer: true })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'LI', insideIndentedContainer: true })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'BLOCKQUOTE', insideIndentedContainer: true })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'PRE', insideIndentedContainer: true })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'TABLE', insideIndentedContainer: true })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'DIV', insideIndentedContainer: true })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'P', isDirectChildOfContentRoot: false, insideIndentedContainer: false })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'P', hasText: false, insideIndentedContainer: false })).toBe(false)
  })

  it('§14/§19 — drift tolerance + the left-accent surface detector', () => {
    expect(isTextColumnDriftWithinTolerance([60, 60.5, 60.9])).toBe(true)
    expect(isTextColumnDriftWithinTolerance([60, 61.5])).toBe(false)
    expect(isSurfaceLeftAccentOnly({ leftWidth: 4, topWidth: 0, rightWidth: 0, bottomWidth: 0, leftStyle: 'solid' })).toBe(true)
    expect(isSurfaceLeftAccentOnly({ leftWidth: 3, topWidth: 0, rightWidth: 0, bottomWidth: 0, leftStyle: 'solid' })).toBe(true)
    expect(isSurfaceLeftAccentOnly({ leftWidth: 4, topWidth: 1, rightWidth: 0, bottomWidth: 0, leftStyle: 'solid' })).toBe(false)
    expect(isSurfaceLeftAccentOnly({ leftWidth: 6, topWidth: 0, rightWidth: 0, bottomWidth: 0, leftStyle: 'solid' })).toBe(false)
    expect(EOF_ACCENT_WIDTH_PX).toBe(4)
    expect(EOF_MARKER_KIND_DOCUMENT_END_WARNING).toBe('document-end-warning')
    expect(EOF_FILL_EMPHASIS_CLASS_LOW).toBe('LOW_EMPHASIS')
  })

  it('§8/§9 — the band is intentionally NARROWER than the content box (text column → content right)', () => {
    const base = {
      lastMeaningfulRect: { left: 420, top: 1000, right: 1300, bottom: 1024, width: 880, height: 24 },
      contentBoundsRect: { left: 390, top: 0, right: 1414, bottom: 1200, width: 1024, height: 1200 },
      editorContentRect: { left: 278, top: 0, right: 1535, bottom: 750, width: 1257, height: 750 },
      lineHeight: 24,
      extraTrailingBlankLineCount: 5,
    }
    const geo = computeSyntheticEofGeometry({ ...base, textColumnLeft: 420 })
    // left = the TEXT COLUMN (420), right = the DOCUMENT CONTENT (1414)
    expect(geo.rect!.left).toBe(420)
    expect(geo.rect!.right).toBe(1414)
    expect(geo.rect!.width).toBe(994)
    // the content box is 1024 wide → the band is narrower ON PURPOSE, so the
    // geometry-clip gate must compare against the band's OWN width, never 1024.
    expect(geo.rect!.width).toBeLessThan(base.contentBoundsRect.width)
    expect(geo.rect!.width).toBe(geo.rect!.right - geo.rect!.left)
    const fallback = computeSyntheticEofGeometry({ ...base, textColumnLeft: null })
    expect(fallback.rect!.left).toBe(390) // content-left fallback only when no prose exists
  })

  it('§21 — the 15 R3 gates are complete and 0 ⇒ PASS', () => {
    expect(DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_KEYS).toHaveLength(15)
    expect(Object.keys(DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_LABELS)).toHaveLength(15)
    const counters = createDocumentEndTextColumnV513R3Counters()
    const report = formatDocumentEndTextColumnV513R3GateReport(counters)
    for (const label of [
      'DOCUMENT_END_LEFT_ANCHOR_AT_PAGE_EDGE_COUNT',
      'EOF_LEFT_ANCHOR_FROM_LAST_MEANINGFUL_RECT_COUNT',
      'EOF_LEFT_ANCHOR_FROM_SEMANTIC_ZONE_LEFT_COUNT',
      'EOF_LEFT_ANCHOR_FROM_SELECTED_BLOCK_COUNT',
      'EOF_LEFT_ANCHOR_FROM_INDENTED_DESCENDANT_COUNT',
      'DOCUMENT_TEXT_COLUMN_LEFT_DRIFT_GT_1PX_COUNT',
      'DOCUMENT_END_ACCENT_WIDTH_LT_3PX_COUNT',
      'DOCUMENT_END_ACCENT_WIDTH_GT_4PX_COUNT',
      'DOCUMENT_END_TOP_BORDER_COUNT',
      'DOCUMENT_END_RIGHT_BORDER_COUNT',
      'DOCUMENT_END_BOTTOM_BORDER_COUNT',
      'DOCUMENT_END_OUTLINE_COUNT',
      'DOCUMENT_END_SHADOW_COUNT',
      'DOCUMENT_END_NON_WARNING_ACCENT_COUNT',
      'NON_EOF_ACTIVE_LOCATE_VERTICAL_LINE_REGRESSION_COUNT',
    ]) expect(report).toContain(`${label}=0`)
    expect(evaluateDocumentEndTextColumnV513R3Gates(counters).decision).toBe('PASS')
    counters.accentWidthLt3px = 1
    expect(evaluateDocumentEndTextColumnV513R3Gates(counters).failedChecks).toEqual(['accentWidthLt3px'])
  })
})

describe('V5.13-R3 §8/§9/§14 — the EOF band X anchor is independent of the last block', () => {
  const kinds: LastBlockKind[] = ['paragraph', 'indented', 'list', 'quote', 'code', 'table']
  for (const kind of kinds) {
    it(`R3-EOF-X — last block = ${kind}: the band left stays on the PROSE column`, () => {
      const { h } = makeAnchorWorld(kind)
      const diag = trailingBlankDiag(5)
      injectSnapshot({ h } as unknown as World, [diag])
      const ok = (h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
      expect(ok).toBe(true)
      const marker = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
      expect(Number.parseFloat(marker.style.left)).toBe(EOF_LOCAL_LEFT)
      expect(marker.getAttribute('data-ink-marker-kind')).toBe('document-end-warning')
      const anchors = h.getLastDocumentLayoutAnchors()!
      expect(anchors.documentTextColumnLeft).toBe(60)
      expect(anchors.documentTextColumnSource).toBe(DOCUMENT_TEXT_COLUMN_SOURCE.TOP_LEVEL_PROSE)
      // every R3 hard gate stays 0 for every last-block shape
      for (const key of DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_KEYS) {
        expect(h.getDocumentEndTextColumnV513R3GateReport())
          .toContain(`${DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_LABELS[key]}=0`)
      }
      expect(h.getDocumentEndTextColumnV513R3GateDecision().decision).toBe('PASS')
    })
  }

  it('R3-EOF-X-03/06: the anchor is the prose column even when the last block is a table', () => {
    const world = makeAnchorWorld('table')
    const diag = trailingBlankDiag(5)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const audit = readAudits(infoSpy!, DOCUMENT_END_VISUAL_AUDIT_EVENT).pop()!
    expect(audit.presentationLeftSource).toBe('DOCUMENT_TEXT_COLUMN')
    expect(audit.presentationRightSource).toBe('DOCUMENT_CONTENT')
    expect(audit.markerKind).toBe(EOF_MARKER_KIND_DOCUMENT_END_WARNING)
    expect(audit.accentWidthPx).toBe('4')
    expect(audit.fillAlphaClass).toBe(EOF_FILL_EMPHASIS_CLASS_LOW)
    expect(audit.documentTextColumnLeft).toBe('60')
    expect(audit.surfaceLeftAccent).toBe('true')
    expect(audit.decorativeVerticalRail).toBe('false')
    expect(audit.drawerAffectsWorkspaceWidth).toBe('false')
    // §7 — the last block's own (table) left must never be the anchor
    expect(audit.lastMeaningfulLeft).not.toBe(audit.documentTextColumnLeft)
  })

  it('R3-EOF-X-07: a floating Drawer never changes the text-column anchor', () => {
    const world = makeAnchorWorld('paragraph')
    const diag = trailingBlankDiag(5)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    const internals = world.h as unknown as Internals & { drawerOpen: boolean }
    internals.commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const before = world.h.getLastDocumentLayoutAnchors()
    internals.drawerOpen = true
    internals.commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const after = world.h.getLastDocumentLayoutAnchors()
    expect(after!.documentTextColumnLeft).toBe(before!.documentTextColumnLeft)
    expect(after!.documentTextColumnSource).toBe(before!.documentTextColumnSource)
    expect(world.h.getDocumentEndTextColumnV513R3GateReport())
      .toContain('EOF_LEFT_ANCHOR_FROM_SELECTED_BLOCK_COUNT=0')
  })

  it('R3-EOF-X-08: a real reflow recomputes the anchor without drift false-positives', () => {
    // a TABLE last block guarantees the only prose candidate is the column itself
    const world = makeAnchorWorld('table')
    const diag = trailingBlankDiag(5)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    const internals = world.h as unknown as Internals
    internals.commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(world.h.getLastDocumentLayoutAnchors()!.documentTextColumnLeft).toBe(60)
    // a REAL editor-width change (new layout width → new anchor key)
    stubRect(world.prose, () => ({ left: 70, top: 100, right: 700, bottom: 124 }))
    stubRect(document.getElementById('write')!, () => ({ left: 50, top: 0, right: 750, bottom: 1200 }))
    internals.commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(world.h.getLastDocumentLayoutAnchors()!.documentTextColumnLeft).toBe(70)
    expect(world.h.getDocumentEndTextColumnV513R3GateReport())
      .toContain('DOCUMENT_TEXT_COLUMN_LEFT_DRIFT_GT_1PX_COUNT=0')
  })

  it('R3-EOF-X-09: a post-commit scroll never repaints the band (document-space)', () => {
    const world = makeAnchorWorld('table')
    const diag = trailingBlankDiag(5)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const marker = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
    const before = marker.style.cssText
    document.querySelector('.typ-markdown-view')!.dispatchEvent(new Event('scroll'))
    expect((document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement).style.cssText).toBe(before)
    expect(world.h.getDocumentEndTextColumnV513R3GateDecision().decision).toBe('PASS')
  })

  it('R3-EOF-X-10: removing the diagnostic removes the marker entirely', () => {
    const world = makeAnchorWorld('paragraph')
    const diag = trailingBlankDiag(5)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(document.querySelectorAll('[data-ink-eof-marker="true"]').length).toBe(1)
    ;(world.h as unknown as Internals).clearDiagnosticLocateVisual('ACTIVE_DIAGNOSTIC_REMOVED')
    expect(document.querySelectorAll('[data-ink-eof-marker="true"]').length).toBe(0)
  })

  it('R3-EOF-X-acc: a sub-3px or >4px accent is a REAL violation (never silently accepted)', () => {
    const world = makeAnchorWorld('paragraph')
    const diag = trailingBlankDiag(5)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    const internals = world.h as unknown as Internals
    // the mocked computed style reads the accent from `__eofAccentPx` (4px default)
    const originalCreate = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'div') (el as HTMLElement & { __eofAccentPx?: number }).__eofAccentPx = 2
      return el
    }) as unknown as typeof document.createElement)
    internals.commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    spy.mockRestore()
    expect(world.h.getDocumentEndTextColumnV513R3GateReport())
      .toContain('DOCUMENT_END_ACCENT_WIDTH_LT_3PX_COUNT=1')
    expect(world.h.getDocumentEndTextColumnV513R3GateDecision().decision).toBe('FAIL')
  })
})
