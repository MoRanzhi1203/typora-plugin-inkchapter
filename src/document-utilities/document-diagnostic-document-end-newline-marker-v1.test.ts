// @vitest-environment jsdom
/**
 * TRAE — `DOCUMENT_TERMINAL_NEWLINE_MISSING` document-end visual closure.
 *
 * THE DEFECT: the missing-terminal-newline warning is a `document-end` semantic
 * target with NO DOM node. Only `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE` was
 * wired into the synthetic document-end visual path, so the newline warning fell
 * through to the boundary-only branch (GO_BOTTOM + SCROLL_ACTION) with
 * `highlightTargets = []` → no presentation rect → `FAIL_VISUAL` → the active
 * owner was rolled back. Three secondary defects rode along:
 *   • severity drifted `warning → info` in the visual closure,
 *   • the closure could PASS on some OTHER diagnostic's passive marker,
 *   • the marker / lease did not track the diagnostic live.
 *
 * COVERED HERE (§15 + §11/§12/§13):
 *   A–H  every last-canonical-block shape yields a locatable compact marker
 *   E    a code block anchors on the canonical top-level fence, never a
 *        CodeMirror-internal `pre`
 *   J/L/M legal vs missing × LF/CRLF are decided by detection (pure)
 *   K    the excess rule keeps the SAME locator with its frozen band geometry
 *   §11  the closure severity follows the Diagnostic Snapshot (never `info`)
 *   §12  the closure is scoped to the CURRENT diagnostic's active visual
 *   §13  the diagnostic's appearance / disappearance is live
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { computeDocumentDiagnostics, computeEofNewlinePolicy } from './document-diagnostics'
import type { DocumentDiagnosticsInput } from './document-diagnostics'
import {
  DOCUMENT_END_NEWLINE_GATE_KEYS,
  DOCUMENT_END_NEWLINE_MISSING_RULE,
  DOCUMENT_END_TRAILING_BLANK_MIN_EXCESS,
  DOCUMENT_END_TRAILING_BLANK_RULE_NAME,
  EOF_NEWLINE_MARKER_ARIA_LABEL,
  EOF_NEWLINE_MARKER_GEOMETRY_SOURCE,
  EOF_NEWLINE_MARKER_KIND,
  EOF_NEWLINE_MARKER_MAX_HEIGHT_PX,
  EOF_NEWLINE_MARKER_MAX_WIDTH_PX,
  EOF_NEWLINE_MARKER_MIN_HEIGHT_PX,
  EOF_NEWLINE_MARKER_RULE_ATTR,
  computeDocumentEndNewlineMarkerGeometry,
  createDocumentEndNewlineGateCounters,
  emptyDocumentEndNewlineCoverageCounters,
  evaluateDocumentEndNewlineGates,
  evaluateDocumentEndNewlinePositiveCoverage,
  resolveDocumentEndVisualRule,
} from './document-diagnostic-document-end-newline-marker-v1'
import {
  DOCUMENT_END_SEMANTIC_ANCHOR_IDENTITY,
  DOCUMENT_END_VISUAL_AUDIT_EVENT,
  EOF_MARKER_KIND_DOCUMENT_END_WARNING,
} from './document-diagnostic-document-end-visual-v513-r1'

// ── environment stubs (mirrors the V5.13-R1 suite) ─────────────────────────

let rafSeq = 1
let rafTasks = new Map<number, FrameRequestCallback>()
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

function inputOf(markdown: string | null): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc', markdown, strictMode: true, vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
  }
}

// ── Part 1 · pure: the ONE document-end resolver + the compact chip ─────────

describe('DocumentEndTargetResolver — rule is a pure function of the diagnostic', () => {
  it('maps the two document-end rules; unrelated rules keep null', () => {
    expect(resolveDocumentEndVisualRule({
      code: DOCUMENT_END_NEWLINE_MISSING_RULE, locationKind: 'document-end', extraTrailingBlankLineCount: 0,
    })).toBe('TERMINAL_NEWLINE_MISSING')
    expect(resolveDocumentEndVisualRule({
      code: DOCUMENT_END_TRAILING_BLANK_RULE_NAME, locationKind: 'document-end',
      extraTrailingBlankLineCount: DOCUMENT_END_TRAILING_BLANK_MIN_EXCESS,
    })).toBe('TRAILING_BLANK_EXCESS')
    expect(resolveDocumentEndVisualRule({
      code: DOCUMENT_END_TRAILING_BLANK_RULE_NAME, locationKind: 'document-end',
      extraTrailingBlankLineCount: DOCUMENT_END_TRAILING_BLANK_MIN_EXCESS - 1,
    })).toBeNull()
    // the 0~1 extra blank lines that are LEGAL never own a document-end visual
    expect(resolveDocumentEndVisualRule({
      code: DOCUMENT_END_NEWLINE_MISSING_RULE, locationKind: 'block-node', extraTrailingBlankLineCount: 0,
    })).toBeNull()
    expect(resolveDocumentEndVisualRule({
      code: 'HEADING_EMPTY_TEXT', locationKind: 'document-end', extraTrailingBlankLineCount: 9,
    })).toBeNull()
    expect(resolveDocumentEndVisualRule({
      code: DOCUMENT_END_NEWLINE_MISSING_RULE, locationKind: null, extraTrailingBlankLineCount: 0,
    })).toBeNull()
  })
})

describe('computeDocumentEndNewlineMarkerGeometry — the compact EOF chip', () => {
  const anchor = { left: 60, top: 900, right: 700, bottom: 1000, width: 640, height: 100 }
  const column = { left: 50, top: 0, right: 850, bottom: 1200, width: 800, height: 1200 }
  const editor = { left: 50, top: 0, right: 850, bottom: 1100, width: 800, height: 1100 }

  it('is compact, soft-fill-sized, and sits on the EOF side of the anchor', () => {
    const geo = computeDocumentEndNewlineMarkerGeometry({
      documentIsNonEmpty: true, lastCanonicalBlockRect: anchor, contentBoundsRect: column,
      editorContentRect: editor, lineHeight: 24, textColumnLeft: 60,
    })
    expect(geo.rect).not.toBeNull()
    expect(geo.geometrySource).toBe(EOF_NEWLINE_MARKER_GEOMETRY_SOURCE)
    expect(geo.rect!.width).toBeLessThanOrEqual(EOF_NEWLINE_MARKER_MAX_WIDTH_PX)
    expect(geo.rect!.height).toBeGreaterThanOrEqual(EOF_NEWLINE_MARKER_MIN_HEIGHT_PX)
    expect(geo.rect!.height).toBeLessThanOrEqual(EOF_NEWLINE_MARKER_MAX_HEIGHT_PX)
    // EOF side: at/after the block bottom edge, never the block body centre
    expect(geo.rect!.top).toBeGreaterThanOrEqual(anchor.bottom - geo.rect!.height)
    expect(geo.rect!.left).toBe(60)
    expect(geo.clampedInsideEditor).toBe(false)
    expect(geo.meaningfulIntersectionCount).toBe(0)
    expect(geo.failClosed).toBe(false)
  })

  it('bounds itself inside the visible editor instead of painting offscreen', () => {
    const geo = computeDocumentEndNewlineMarkerGeometry({
      documentIsNonEmpty: true, lastCanonicalBlockRect: anchor, contentBoundsRect: column,
      editorContentRect: { ...editor, top: 0, bottom: 1010 }, lineHeight: 24, textColumnLeft: 60,
    })
    expect(geo.rect).not.toBeNull()
    expect(geo.clampedInsideEditor).toBe(true)
    expect(geo.rect!.bottom).toBeLessThanOrEqual(1010 - 2)
  })

  it('fails CLOSED for a non-empty document with no resolvable canonical block', () => {
    const geo = computeDocumentEndNewlineMarkerGeometry({
      documentIsNonEmpty: true, lastCanonicalBlockRect: null, contentBoundsRect: column,
      editorContentRect: editor, lineHeight: 24, textColumnLeft: 60,
    })
    expect(geo.rect).toBeNull()
    expect(geo.failClosed).toBe(true)
    expect(geo.reason).toBe('NO_LAST_CANONICAL_BLOCK')
    // an EMPTY document never fails closed (it owns no document-end visual)
    expect(computeDocumentEndNewlineMarkerGeometry({
      documentIsNonEmpty: false, lastCanonicalBlockRect: null, contentBoundsRect: column,
      editorContentRect: editor, lineHeight: 24, textColumnLeft: 60,
    }).failClosed).toBe(false)
  })

  it('never intersects another meaningful block (the chip is a chip)', () => {
    const other = { left: 60, top: 1001, right: 700, bottom: 1100, width: 640, height: 99 }
    const geo = computeDocumentEndNewlineMarkerGeometry({
      documentIsNonEmpty: true, lastCanonicalBlockRect: anchor, contentBoundsRect: column,
      editorContentRect: editor, lineHeight: 24, textColumnLeft: 60, otherMeaningfulRects: [other],
    })
    // top = 1002 → the other block starts at 1001 → a real intersection is reported
    expect(geo.meaningfulIntersectionCount).toBe(1)
    expect(geo.meaningfulIntersectionArea).toBeGreaterThan(0)
  })
})

describe('the 17 document-end gates + positive coverage', () => {
  it('every gate is 0 ⇒ PASS; one hit ⇒ FAIL', () => {
    expect(DOCUMENT_END_NEWLINE_GATE_KEYS).toHaveLength(17)
    const counters = createDocumentEndNewlineGateCounters()
    expect(evaluateDocumentEndNewlineGates(counters).decision).toBe('PASS')
    counters.severityDriftWarningToInfo = 1
    expect(evaluateDocumentEndNewlineGates(counters).decision).toBe('FAIL')
    expect(evaluateDocumentEndNewlineGates(counters).failing).toEqual(['severityDriftWarningToInfo'])
  })

  it('positive coverage requires every runtime step, never a fabricated PASS', () => {
    const coverage = emptyDocumentEndNewlineCoverageCounters()
    expect(evaluateDocumentEndNewlinePositiveCoverage(coverage).satisfied).toBe(false)
    for (const key of Object.keys(coverage)) coverage[key] = 1
    expect(evaluateDocumentEndNewlinePositiveCoverage(coverage).satisfied).toBe(true)
  })
})

// ── Part 2 · host: the shared generic document-end pipeline ────────────────

let infoSpy: InfoSpy | null = null
let hosts: DocumentUtilityOverlayHost[] = []

type Internals = {
  commitSyntheticEofVisual(tx: unknown, diag: Record<string, unknown>, extra: number, remeasured: boolean): boolean
  commitAdmittedSnapshot(snapshot: DocumentDiagnosticsSnapshot | null, source: string): void
  emitVisualClosureAudit(reason: string): void
  removeLocateDocumentCarrier(): void
  locateDiagnostic(diagnosticId: string): void
  lastLocatedDiagnosticId: string | null
  lastDocEndVisualRule: string | null
  lastLocateCommitGate: { canCommit: boolean; reason: string; failedChecks: string[] } | null
  locateDocEndCarrier: HTMLElement | null
  locateCommittedVisual: unknown
}

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveLeafState: () => ({ leafStateKnown: true, leafPath: 'doc.md' }),
      getActiveFilePath: () => 'doc.md',
      getDocumentKey: () => 'doc:eof',
      getMarkdown: () => 'content',
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

type LastBlockKind = 'paragraph' | 'heading' | 'list' | 'blockquote' | 'code' | 'table' | 'formula' | 'figure'

interface World {
  h: DocumentUtilityOverlayHost
  write: HTMLElement
  last: HTMLElement
  codeMirror?: HTMLElement
}

/** The last CANONICAL top-level content block, one shape per §15 A–H. */
function makeKindWorld(kind: LastBlockKind): World {
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

  let el: HTMLElement
  let codeMirror: HTMLElement | undefined
  if (kind === 'list') {
    const ul = document.createElement('ul')
    const li = document.createElement('li')
    li.textContent = '列表项'
    ul.appendChild(li)
    el = ul
  } else if (kind === 'blockquote') {
    const bq = document.createElement('blockquote')
    const p = document.createElement('p')
    p.textContent = '引用文字'
    bq.appendChild(p)
    el = bq
  } else if (kind === 'code') {
    // The CANONICAL fence is the top-level `div.md-fences`; the CodeMirror
    // editor (with its own internal `pre`) is a NESTED child and must never be
    // the anchor.
    el = document.createElement('div')
    el.className = 'md-fences'
    el.textContent = 'const answer = 42'
    const cm = document.createElement('div')
    cm.className = 'CodeMirror'
    const inner = document.createElement('pre')
    inner.className = 'CodeMirror-line'
    inner.textContent = 'const answer = 42'
    cm.appendChild(inner)
    el.appendChild(cm)
    codeMirror = cm
  } else if (kind === 'table') {
    const t = document.createElement('table')
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.textContent = 'cell'
    tr.appendChild(td)
    t.appendChild(tr)
    el = t
  } else if (kind === 'formula') {
    el = document.createElement('div')
    el.className = 'md-math-block'
    const span = document.createElement('span')
    span.textContent = 'E = mc^2'
    el.appendChild(span)
  } else if (kind === 'figure') {
    el = document.createElement('figure')
    const img = document.createElement('img')
    const cap = document.createElement('figcaption')
    cap.textContent = '图 1'
    el.appendChild(img)
    el.appendChild(cap)
  } else if (kind === 'heading') {
    el = document.createElement('h2')
    el.textContent = '尾部标题'
  } else {
    el = document.createElement('p')
    el.textContent = '末段'
  }
  write.appendChild(el)
  const left = kind === 'list' || kind === 'blockquote' ? 80 : 60
  stubRect(el, () => ({ left, top: 1000, right: left + 640, bottom: 1040 }))
  if (codeMirror) stubRect(codeMirror, () => ({ left: 60, top: 1000, right: 700, bottom: 1040 }))

  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  hosts.push(h)
  return { h, write, last: el, codeMirror }
}

function newlineDiag(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: `document:${DOCUMENT_END_NEWLINE_MISSING_RULE}:document:terminal-newline-missing`,
    documentKey: 'doc:eof',
    severity: 'warning',
    category: 'document',
    code: DOCUMENT_END_NEWLINE_MISSING_RULE,
    message: '警告：文档末尾缺少换行符',
    detail: '',
    metadata: {
      ruleId: 'DOCUMENT-TERMINAL-NEWLINE-MISSING',
      reason: 'MISSING_TERMINAL_NEWLINE',
      terminalNewlineCount: 0,
      extraTrailingBlankLineCount: 0,
    },
    location: { kind: 'document-end' },
    ...over,
  }
}

function excessDiag(extra: number): Record<string, unknown> {
  return {
    id: `document:${DOCUMENT_END_TRAILING_BLANK_RULE_NAME}:${extra}`,
    documentKey: 'doc:eof',
    severity: 'warning',
    category: 'document',
    code: DOCUMENT_END_TRAILING_BLANK_RULE_NAME,
    message: '警告：文档末尾存在过多空行',
    detail: '',
    metadata: {
      ruleId: 'DOCUMENT-TRAILING-BLANK-LINES-EXCESSIVE',
      reason: 'EXCESSIVE_TRAILING_BLANK_LINES',
      terminalNewlineCount: extra + 1,
      extraTrailingBlankLineCount: extra,
    },
    location: { kind: 'document-end' },
  }
}

function snapshotOf(diags: Array<Record<string, unknown>>, revision = 1): DocumentDiagnosticsSnapshot {
  return {
    documentKey: 'doc:eof', revision, sourceRevision: revision, generatedAt: 0,
    diagnostics: diags as unknown as DocumentDiagnosticsSnapshot['diagnostics'],
    errorCount: 0, warningCount: diags.length, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
}

function injectSnapshot(world: World, diags: Array<Record<string, unknown>>): void {
  const snapshot = snapshotOf(diags)
  const authority = (world.h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null } }).diagnostics
  authority.snapshot = snapshot
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
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element, pseudo?: string) => {
    if (pseudo != null) return { content: 'none' } as unknown as CSSStyleDeclaration
    const isEofBand = el.getAttribute?.('data-ink-eof-marker') === 'true'
    return {
      lineHeight: '24px',
      backgroundColor: 'rgba(168, 121, 50, 0.08)',
      backgroundImage: 'none',
      boxShadow: 'none',
      outlineStyle: 'none',
      outlineWidth: '0px',
      borderLeftWidth: isEofBand ? '4px' : '0px',
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

// §15 A–H — every last canonical block shape
const KINDS: LastBlockKind[] = ['paragraph', 'heading', 'list', 'blockquote', 'code', 'table', 'formula', 'figure']

describe('§15 A–H — the missing-newline warning gets a REAL presentation target', () => {
  for (const kind of KINDS) {
    it(`A–H last block = ${kind}: one click paints a locatable compact marker (no rollback)`, () => {
      const world = makeKindWorld(kind)
      const diag = newlineDiag()
      injectSnapshot(world, [diag])
      const ok = (world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 0, true)
      expect(ok).toBe(true)

      const layer = world.write.querySelector('.inkchapter-diagnostic-layer, [data-inkchapter-locate-layer]')
      expect(layer).not.toBeNull()
      const marker = layer!.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
      expect(marker).not.toBeNull()
      // §8.2 — the compact EOF chip identity + severity, on the unified carrier.
      expect(marker.getAttribute('data-ink-marker-kind')).toBe(EOF_NEWLINE_MARKER_KIND)
      expect(marker.getAttribute('data-ink-eof-rule')).toBe(EOF_NEWLINE_MARKER_RULE_ATTR)
      expect(marker.getAttribute('data-ink-target-identity')).toBe(DOCUMENT_END_SEMANTIC_ANCHOR_IDENTITY)
      expect(marker.getAttribute('data-severity')).toBe('warning')
      expect(marker.getAttribute('title')).toBe(EOF_NEWLINE_MARKER_ARIA_LABEL)
      const width = Number.parseFloat(marker.style.width)
      const height = Number.parseFloat(marker.style.height)
      expect(width).toBeLessThanOrEqual(EOF_NEWLINE_MARKER_MAX_WIDTH_PX)
      expect(height).toBeGreaterThanOrEqual(EOF_NEWLINE_MARKER_MIN_HEIGHT_PX)
      expect(height).toBeLessThanOrEqual(EOF_NEWLINE_MARKER_MAX_HEIGHT_PX)
      // §8.1 — the last block itself is NEVER polluted.
      expect(world.last.getAttribute('style')).toBeNull()
      expect(world.last.querySelector('[data-ink-eof-marker="true"]')).toBeNull()
      // every new hard gate stays 0 ⇒ the closure really committed
      expect(world.h.getDocumentEndNewlineGateDecision().decision).toBe('PASS')
      expect(world.h.getDocumentEndNewlineGateDecision().failing).toEqual([])
    })
  }

  it('E — a code block anchors on the canonical top-level fence, never the CodeMirror `pre`', () => {
    const world = makeKindWorld('code')
    const diag = newlineDiag()
    injectSnapshot(world, [diag])
    expect((world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 0, true)).toBe(true)
    const audit = readAudits(infoSpy!, DOCUMENT_END_VISUAL_AUDIT_EVENT).pop()!
    // the anchor identity is the top-level fence (line-based), not a `pre.md-*` guess
    expect(String(audit.lastMeaningfulIdentity)).toContain('div')
    expect(world.codeMirror!.querySelector('[data-ink-eof-marker="true"]')).toBeNull()
    expect(world.h.getDocumentEndNewlineGateCounters().markerLeftCodeMirrorInternalTarget).toBe(0)
    expect(world.h.getDocumentEndNewlineGateCounters().markerCoveredByCodeMirrorInternal).toBe(0)
  })

  // §7 — the ONE-CLICK locate path: GO_BOTTOM is a STEP, not the result.
  it('§7 — the real click routes the warning to a PRESENTATION TARGET (never SCROLL_ACTION-only)', () => {
    vi.useFakeTimers()
    ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
      ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number) as typeof requestAnimationFrame
    ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => { /* noop */ }
    try {
      const world = makeKindWorld('paragraph')
      const diag = newlineDiag()
      injectSnapshot(world, [diag])
      ;(world.h as unknown as Internals).locateDiagnostic(String(diag.id))
      vi.advanceTimersByTime(80)

      const locateAudit = readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-LOCATE-AUDIT').pop()
      expect(locateAudit).toBeTruthy()
      expect(locateAudit!.resolveDecision).toBe('RESOLVED')
      // §7 — the locate is resolved by the document-end PRESENTATION target, never
      // by the bare scroll step. Both document-end reasons carry that meaning:
      // `…_PRESENTATION_TARGET` (no scroll container) / `…_SYNTHETIC_EOF` (settled).
      expect(['DOCUMENT_END_PRESENTATION_TARGET', 'DOCUMENT_END_SYNTHETIC_EOF'])
        .toContain(locateAudit!.resolveReason)
      expect(locateAudit!.resolveReason).not.toBe('SCROLL_ACTION')
      // the single click really committed the marker (no rollback, no 2nd click)
      expect(eofCarriers()).toBe(1)
      const visualAudit = readAudits(infoSpy!, DOCUMENT_END_VISUAL_AUDIT_EVENT).pop()!
      expect(visualAudit.finalDecision).toBe('PASS')
      expect(visualAudit.severity).toBe('warning')
      expect(world.h.getDocumentEndNewlineGateDecision().decision).toBe('PASS')
      expect(world.h.isLocateTransactionActive()).toBe(false)
      // §17 — one click is enough; the owner survives; the warning severity holds.
      const gates = world.h.getDocumentEndNewlineGateCounters()
      expect(gates.secondClickRequired).toBe(0)
      expect(gates.firstClickLocateRollback).toBe(0)
      expect(gates.severityDriftWarningToInfo).toBe(0)
      expect(gates.unscopedVisualFalsePass).toBe(0)
      expect(gates.DOCUMENT_END_ONE_CLICK_COMMIT_RUNTIME_COUNT).toBeGreaterThanOrEqual(1)
      const closure = world.h.getLastVisualClosureAudit()!
      expect(closure.reason).toBe('LOCATE_COMMITTED')
      expect(closure.severity).toBe('warning')
      expect(closure.docEndVisualRule).toBe('TERMINAL_NEWLINE_MISSING')
      expect(closure.markerKind).toBe(EOF_NEWLINE_MARKER_KIND)
    } finally {
      vi.useRealTimers()
    }
  })

  it('K — the excess rule keeps the SAME locator with its frozen band geometry', () => {
    const world = makeKindWorld('paragraph')
    const diag = excessDiag(5)
    injectSnapshot(world, [diag])
    expect((world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)).toBe(true)
    const marker = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
    expect(marker.getAttribute('data-ink-marker-kind')).toBe(EOF_MARKER_KIND_DOCUMENT_END_WARNING)
    // the excess band is NOT the compact chip (it spans the excessive zone)
    const audit = readAudits(infoSpy!, DOCUMENT_END_VISUAL_AUDIT_EVENT).pop()!
    expect(audit.excessiveTrailingBlankLineCount).toBe('5')
    expect(world.h.getDocumentEndNewlineGateDecision().decision).toBe('PASS')
  })
})

// §15 J/L/M — detection decides legal vs missing; the visual layer never invents one
describe('§15 J/L/M — legal vs missing terminal newline (LF/CRLF)', () => {
  it('a legal terminal newline publishes NO diagnostic (so no marker can exist)', () => {
    for (const md of ['a\n', 'a\r\n', 'a\n\n']) {
      expect(computeEofNewlinePolicy(md).verdict).toBe('PASS')
      const codes = computeDocumentDiagnostics(inputOf(md)).diagnostics.map(d => d.code)
      expect(codes).not.toContain(DOCUMENT_END_NEWLINE_MISSING_RULE)
    }
  })

  it('a missing terminal newline publishes exactly the document-end warning (LF and CRLF)', () => {
    for (const md of ['a', 'line1\r\nline2']) {
      const diags = computeDocumentDiagnostics(inputOf(md)).diagnostics
        .filter(d => d.code === DOCUMENT_END_NEWLINE_MISSING_RULE)
      expect(diags).toHaveLength(1)
      expect(diags[0].location).toEqual({ kind: 'document-end' })
      expect(diags[0].severity).toBe('warning')
    }
  })
})

// §11 — severity authority
describe('§11 — the closure severity follows the Diagnostic Snapshot', () => {
  it('a warning document-end diagnostic never drifts to info in the visual closure', () => {
    const world = makeKindWorld('paragraph')
    const diag = newlineDiag()
    injectSnapshot(world, [diag])
    const internals = world.h as unknown as Internals
    // no locate frame at all: this is exactly the historical `?? 'info'` path
    internals.lastLocatedDiagnosticId = String(diag.id)
    internals.lastDocEndVisualRule = null
    internals.emitVisualClosureAudit('TEST_SEVERITY')
    const closure = world.h.getLastVisualClosureAudit()!
    expect(closure.severity).toBe('warning')
    expect(world.h.getDocumentEndNewlineGateCounters().severityDriftWarningToInfo).toBe(0)
  })
})

// §12 — scoped visual closure
describe('§12 — the closure is scoped to the CURRENT diagnostic', () => {
  it('a document-end rule with NO active visual must not PASS on a foreign marker', () => {
    const world = makeKindWorld('paragraph')
    const diag = newlineDiag()
    injectSnapshot(world, [diag])
    const internals = world.h as unknown as Internals
    internals.lastLocatedDiagnosticId = String(diag.id)
    internals.lastDocEndVisualRule = 'TERMINAL_NEWLINE_MISSING'
    internals.lastLocateCommitGate = { canCommit: true, reason: 'STALE', failedChecks: [] }
    internals.locateDocEndCarrier = null
    internals.locateCommittedVisual = null
    internals.emitVisualClosureAudit('TEST_SCOPE')
    const closure = world.h.getLastVisualClosureAudit()!
    expect(closure.currentDiagnosticActiveVisualCount).toBe(0)
    expect(closure.visualDecision).toBe('FAIL')
    expect(closure.commitDecision).toBe('NO_COMMIT')
    expect(closure.decision).toBe('FAIL')
    expect(world.h.getDocumentEndNewlineGateCounters().unscopedVisualFalsePass).toBe(1)
  })

  it('a committed document-end visual PASSES with exactly one live carrier', () => {
    const world = makeKindWorld('paragraph')
    const diag = newlineDiag()
    injectSnapshot(world, [diag])
    const internals = world.h as unknown as Internals
    internals.lastLocatedDiagnosticId = String(diag.id)
    expect(internals.commitSyntheticEofVisual(fakeTx(), diag, 0, true)).toBe(true)
    const closure = world.h.getLastVisualClosureAudit()!
    expect(closure.visualDecision).toBe('PASS')
    expect(closure.commitDecision).toBe('COMMIT')
    expect(closure.visualFragmentCount).toBe(1)
    expect(eofCarriers()).toBe(1)
    expect(world.h.getDocumentEndNewlineGateCounters().unscopedVisualFalsePass).toBe(0)
    expect(world.h.getDocumentEndNewlineGateCounters().diagnosticTargetKeyMismatch).toBe(0)
  })
})

// §13 — live resolve / reintroduce
describe('§13 — the diagnostic, marker and lease track the source live', () => {
  it('case B: adding a legal terminal newline removes the diagnostic, marker and lease in one commit', () => {
    const world = makeKindWorld('paragraph')
    const diag = newlineDiag()
    const internals = world.h as unknown as Internals
    internals.commitAdmittedSnapshot(snapshotOf([diag], 1), 'TEST')
    internals.lastLocatedDiagnosticId = String(diag.id)
    expect(internals.commitSyntheticEofVisual(fakeTx(), diag, 0, true)).toBe(true)
    expect(eofCarriers()).toBe(1)

    // the user adds the legal terminal newline → the diagnostic disappears
    internals.commitAdmittedSnapshot(snapshotOf([], 2), 'TEST')
    expect(eofCarriers()).toBe(0)
    expect(internals.locateDocEndCarrier).toBeNull()
    expect(world.h.getDocumentEndNewlineGateCounters().DOCUMENT_END_DIAGNOSTIC_REMOVED_RUNTIME_COUNT).toBe(1)
    expect(world.h.getDocumentEndNewlineGateCounters().staleVisualAfterDiagnosticRemoved).toBe(0)
  })

  it('case C: deleting the terminal newline again reintroduces the diagnostic', () => {
    const world = makeKindWorld('paragraph')
    const diag = newlineDiag()
    const internals = world.h as unknown as Internals
    internals.commitAdmittedSnapshot(snapshotOf([diag], 1), 'TEST')
    internals.commitAdmittedSnapshot(snapshotOf([], 2), 'TEST')
    internals.commitAdmittedSnapshot(snapshotOf([diag], 3), 'TEST')
    expect(world.h.getDocumentEndNewlineGateCounters().DOCUMENT_END_DIAGNOSTIC_REINTRODUCED_RUNTIME_COUNT).toBe(1)
    // the tenant can locate it again after the reintroduction
    internals.lastLocatedDiagnosticId = String(diag.id)
    expect(internals.commitSyntheticEofVisual(fakeTx(), diag, 0, true)).toBe(true)
    expect(eofCarriers()).toBe(1)
  })
})
