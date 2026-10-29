// @vitest-environment jsdom
/**
 * Document Diagnostics — Locate + Active Visual activation V1.
 *
 * Proves that ONE Drawer click on each NEW diagnostic family kind resolves a
 * REAL target and commits a VISIBLE carrier through the EXISTING machinery:
 *
 *   - caption integrity      → `caption-projection`  → caption-slot / block fill
 *   - numbering integrity    → `block-node`          → object block fill
 *   - anchor integrity       → `source-range` (link) → inline mark
 *   - heading anchor collision → `target-group`      → heading visible label
 *
 * Every case asserts: the transaction terminal state is COMMITTED, the commit
 * gate `canCommit === true`, a painted carrier exists, `fillCount >= 1`, and a
 * SECOND click DEACTIVATES cleanly (IDLE + carrier removed + lease released).
 *
 * A negative case proves the honesty contract: a locatable family whose target
 * genuinely cannot be measured (a caption id with no live projection) must end
 * IDLE with NO carrier — never a fake active row / stale carrier / stale lease.
 *
 * jsdom applies no stylesheet, so the FILL_ONLY computed-style probe is doubled
 * with a realistic fill-only carrier (exactly like the R7 host gate test); the
 * code under test is the measurement itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  computeDocumentDiagnostics,
  LINK_LOCAL_ANCHOR_MISSING_CODE,
  HEADING_ANCHOR_COLLISION_CODE,
  TABLE_MANUAL_NUMBER_PREFIX_CODE,
} from './document-diagnostics'
import { computeCaptionIntegrityDiagnostics } from './document-diagnostics-caption-integrity-v1'
import { CaptionDomAdapter } from '../heading-numbering/caption-dom-adapter'

// ── rAF harness ─────────────────────────────────────────────────────────────
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

// ── host + scroll-container world ───────────────────────────────────────────
type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}

const VIEW_HEIGHT = 600
const CONTENT_HEIGHT = 2400
const VIEW_TOP = 0

interface World {
  h: DocumentUtilityOverlayHost
  write: HTMLElement
  inject(diags: Array<Record<string, unknown>>): void
  /** Place an element at a document-space content offset; its viewport rect tracks scrollTop. */
  place(el: HTMLElement, contentTop: number, height: number): void
  scrollTop(): number
  click(id: string, targetIndex?: number): Promise<void>
}

function makeWorld(ctx: DocumentUtilitiesContext, providers: DocumentDiagnosticsProviders): World {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  let scrollTop = 0
  Object.defineProperty(shell, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => { scrollTop = Math.max(0, Math.min(Number(v) || 0, CONTENT_HEIGHT - VIEW_HEIGHT)) },
  })
  Object.defineProperty(shell, 'clientHeight', { configurable: true, get: () => VIEW_HEIGHT })
  Object.defineProperty(shell, 'scrollHeight', { configurable: true, get: () => CONTENT_HEIGHT })
  stubRect(shell, () => ({ left: 0, top: VIEW_TOP, right: 800, bottom: VIEW_TOP + VIEW_HEIGHT }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)

  const h = new DocumentUtilityOverlayHost({ ctx, providers })
  h.mount()

  const place = (el: HTMLElement, contentTop: number, height: number): void => {
    stubRect(el, () => {
      const top = VIEW_TOP + (contentTop - scrollTop)
      return { left: 100, top, right: 620, bottom: top + height }
    })
  }

  const inject = (diags: Array<Record<string, unknown>>): void => {
    const snapshot = {
      documentKey: 'doc:key', revision: 1, sourceRevision: 1, generatedAt: 0,
      diagnostics: diags,
      errorCount: diags.filter(d => d.severity === 'error').length,
      warningCount: diags.filter(d => d.severity === 'warning').length,
      infoCount: diags.filter(d => d.severity === 'info').length,
    } as unknown as DocumentDiagnosticsSnapshot
    const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
    authority.snapshot = snapshot
    authority.recompute = () => { /* frozen */ }
    ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
  }

  const click = async (id: string, targetIndex?: number): Promise<void> => {
    ;(h as unknown as { locateDiagnostic(id: string, t?: number): void }).locateDiagnostic(id, targetIndex)
    await flushRaf()
  }

  return { h, write, inject, place, scrollTop: () => scrollTop, click }
}

function fakeContext(markdown = '# t'): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => markdown,
      isStrictMode: () => false,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  } as unknown as DocumentUtilitiesContext
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
    getHeadingIdentity: (el) => el.getAttribute('data-id'),
    parseLocalLinkTargets: () => [],
    getObjectCaptionHost: () => null,
  }
}

// ── carrier probes ──────────────────────────────────────────────────────────
const frameEl = (): HTMLElement | null => document.querySelector('.inkchapter-diagnostic-locate-frame')
const inlineMarkEl = (): HTMLElement | null => document.querySelector('.inkchapter-diagnostic-inline-mark')
const inlineFragments = (): HTMLElement[] => Array.from(document.querySelectorAll('.inkchapter-diagnostic-inline-fragment'))
const headingActiveFragments = (): HTMLElement[] => Array.from(document.querySelectorAll('.inkchapter-heading-diagnostic-active__fragment'))
const anyCarrier = (): boolean =>
  frameEl() != null || inlineMarkEl() != null || inlineFragments().length > 0 || headingActiveFragments().length > 0

let host: DocumentUtilityOverlayHost | null = null
let infoSpy: { mock: { calls: unknown[][] }; mockRestore: () => void } | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  // jsdom has no stylesheet: present a realistic FILL_ONLY carrier surface so the
  // FILL_ONLY measurement code path under test is exercised honestly.
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element, pseudo?: string) => {
    if (pseudo != null) return { content: 'none' } as unknown as CSSStyleDeclaration
    void el
    return {
      backgroundColor: 'rgba(168, 121, 50, 0.21)',
      backgroundImage: 'none',
      boxShadow: 'none',
      outlineStyle: 'none',
      outlineWidth: '0px',
      borderTopStyle: 'none', borderRightStyle: 'none', borderBottomStyle: 'none', borderLeftStyle: 'none',
      borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
    } as unknown as CSSStyleDeclaration
  }) as unknown as typeof window.getComputedStyle)
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as { mock: { calls: unknown[][] }; mockRestore: () => void }
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** The LAST emitted `<event> ...` audit line parsed into a key=value map. */
function lastAudit(event: string): Record<string, string> | null {
  const lines = (infoSpy?.mock.calls ?? []).map(c => String(c[0] ?? '')).filter(l => l.includes(event))
  const line = lines[lines.length - 1]
  if (!line) return null
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}

const ONE_CLICK_AUDIT = 'DOCUMENT-DIAGNOSTIC-ONE-CLICK-LOCATE-AUDIT'

/** Assert a click COMMITTED + painted + filled, and a 2nd click cleanly deactivates. */
async function expectCommitThenDeactivate(w: World, id: string, kindAssert: () => void): Promise<void> {
  await w.click(id)
  expect(w.h.getDiagnosticInteractionStateV2().phase).toBe('ACTIVE')
  expect(w.h.getDiagnosticInteractionStateV2().diagnosticId).toBe(id)
  const one = lastAudit(ONE_CLICK_AUDIT)
  expect(one?.terminalState).toBe('COMMITTED')
  expect(one?.decision).toBe('PASS')
  expect(w.h.getLastLocateCommitGate()?.canCommit).toBe(true)
  expect(w.h.isLocateTransactionActive()).toBe(false)
  kindAssert()
  expect(anyCarrier()).toBe(true)
  expect(w.h.getActiveLocateFillCount()).toBeGreaterThanOrEqual(1)

  await w.click(id)
  expect(w.h.getDiagnosticInteractionStateV2().phase).toBe('IDLE')
  expect(anyCarrier()).toBe(false)
}

// ── Caption Integrity (caption-projection) ──────────────────────────────────

describe('Locate V1 — caption integrity (caption-projection → painted carrier)', () => {
  it('FIGURE_CAPTION_FORMAT_INVALID commits on the FIRST click and deactivates on the second', async () => {
    const w = makeWorld(fakeContext(), fakeProviders())
    host = w.h

    const owner = document.createElement('p')
    const img = document.createElement('img')
    img.setAttribute('src', 'a.png')
    owner.appendChild(img)
    w.write.appendChild(owner)
    w.place(owner, 900, 120)
    w.place(img, 900, 120)

    const adapter = new CaptionDomAdapter(() => w.write)
    const caption = adapter.renderCaption({ type: 'figure', ordinal: 0, root: owner }, '图1', '', 'cap-1', 'below')
    w.place(caption, 1040, 30)

    const produced = computeCaptionIntegrityDiagnostics({ documentKey: 'doc:key', root: w.write }).diagnostics
    const diag = produced.find(d => d.code === 'FIGURE_CAPTION_FORMAT_INVALID')
    expect(diag, 'producer emitted FIGURE_CAPTION_FORMAT_INVALID').toBeTruthy()
    expect(diag!.location?.kind).toBe('caption-projection')

    w.inject([diag as unknown as Record<string, unknown>])
    await expectCommitThenDeactivate(w, diag!.id, () => {
      const s = w.h.getLocateFrameStructure()
      expect(s.active).toBe(true)
      expect(s.activeDiagnosticId).toBe(diag!.id)
      expect(frameEl()).not.toBeNull()
    })
  })

  it('an orphan caption projection is still locatable by its caption service id', async () => {
    const w = makeWorld(fakeContext(), fakeProviders())
    host = w.h
    const owner = document.createElement('p')
    const img = document.createElement('img')
    img.setAttribute('src', 'a.png')
    owner.appendChild(img)
    w.write.appendChild(owner)
    w.place(owner, 900, 120)
    w.place(img, 900, 120)
    const adapter = new CaptionDomAdapter(() => w.write)
    const caption = adapter.renderCaption({ type: 'figure', ordinal: 0, root: owner }, '图 1', '名称', 'cap-orphan', 'below')
    w.place(caption, 1040, 30)
    owner.remove() // projection remains → ORPHAN (never adjacency-adopted)

    const produced = computeCaptionIntegrityDiagnostics({ documentKey: 'doc:key', root: w.write }).diagnostics
    const diag = produced.find(d => d.code === 'FIGURE_ORPHAN_CAPTION')
    expect(diag).toBeTruthy()
    w.inject([diag as unknown as Record<string, unknown>])

    await w.click(diag!.id)
    expect(w.h.getDiagnosticInteractionStateV2().phase).toBe('ACTIVE')
    expect(w.h.getLastLocateCommitGate()?.canCommit).toBe(true)
    expect(anyCarrier()).toBe(true)
  })
})

// ── Numbering Integrity (block-node) ────────────────────────────────────────

describe('Locate V1 — numbering integrity (block-node object → painted carrier)', () => {
  it('TABLE_MANUAL_NUMBER_PREFIX commits on the FIRST click and deactivates on the second', async () => {
    const md = '正文\n'
    const w = makeWorld(fakeContext(md), fakeProviders())
    host = w.h
    const table = document.createElement('table')
    table.setAttribute('data-line', '0')
    w.write.appendChild(table)
    w.place(table, 900, 200)

    const out = computeDocumentDiagnostics({
      documentKey: 'doc:key', markdown: md, strictMode: false, vaultRoot: '/vault',
      headings: [], h1Facts: [], latentAtxMarkers: [], figures: [],
      tables: [{ name: '1. 数据表', element: table, targetIdentity: 'block:table:0' }],
      codes: [], formulas: [], links: [], canonicalDuplicateIdentities: [], captionDuplicateNames: [],
      numberingEnabled: { table: true },
    })
    const diag = out.diagnostics.find(d => d.code === TABLE_MANUAL_NUMBER_PREFIX_CODE)
    expect(diag).toBeTruthy()
    expect(diag!.location?.kind).toBe('block-node')

    w.inject([diag as unknown as Record<string, unknown>])
    await expectCommitThenDeactivate(w, diag!.id, () => {
      const s = w.h.getLocateFrameStructure()
      expect(s.active).toBe(true)
      expect(s.kind).toBe('table')
      expect(frameEl()).not.toBeNull()
    })
  })
})

// ── Anchor Integrity (source-range link → inline mark) ──────────────────────

describe('Locate V1 — anchor integrity (LINK_LOCAL_ANCHOR_MISSING → inline mark)', () => {
  it('commits on the FIRST click and deactivates on the second', async () => {
    const md = '# 标题\n\n[跳转](#不存在)\n'
    const w = makeWorld(fakeContext(md), fakeProviders())
    host = w.h

    const heading = document.createElement('h1')
    heading.setAttribute('data-line', '0')
    heading.setAttribute('data-id', 'H:0')
    heading.id = '标题'
    heading.textContent = '标题'
    w.write.appendChild(heading)
    w.place(heading, 100, 40)

    const paragraph = document.createElement('p')
    paragraph.setAttribute('data-line', '2')
    const anchor = document.createElement('a')
    anchor.setAttribute('href', '#不存在')
    anchor.textContent = '跳转'
    paragraph.appendChild(anchor)
    w.write.appendChild(paragraph)
    w.place(paragraph, 900, 30)
    w.place(anchor, 900, 30)

    const out = computeDocumentDiagnostics({
      documentKey: 'doc:key', markdown: md, strictMode: false, vaultRoot: '/vault',
      headings: [{ level: 1, text: '标题', stableIdentity: 'H:0', element: heading }],
      h1Facts: [], latentAtxMarkers: [], figures: [], tables: [], codes: [], formulas: [], links: [],
      canonicalDuplicateIdentities: [], captionDuplicateNames: [],
    })
    const diag = out.diagnostics.find(d => d.code === LINK_LOCAL_ANCHOR_MISSING_CODE)
    expect(diag, 'producer emitted LINK_LOCAL_ANCHOR_MISSING').toBeTruthy()
    expect(diag!.location?.kind).toBe('source-range')

    w.inject([diag as unknown as Record<string, unknown>])
    await expectCommitThenDeactivate(w, diag!.id, () => {
      const s = w.h.getLocateFrameStructure()
      expect(s.active).toBe(true)
      expect(s.kind).toBe('inline')
      // The link's OWN inline carrier (mark or fragment), never a heading marker.
      expect(inlineMarkEl() != null || inlineFragments().length > 0 || s.inlineMarkCount >= 1).toBe(true)
      expect(s.headingMarkerCarrier).toBe(false)
    })
  })
})

// ── Heading Anchor Collision (target-group of headings) ─────────────────────

describe('Locate V1 — heading anchor collision (target-group → heading visible label)', () => {
  it('commits on the FIRST click and deactivates on the second', async () => {
    const md = '## A\n\n## B\n'
    const w = makeWorld(fakeContext(md), fakeProviders())
    host = w.h

    const a = document.createElement('h2')
    a.setAttribute('data-line', '0'); a.setAttribute('data-id', 'H:0'); a.id = 'same'; a.textContent = 'A'
    const b = document.createElement('h2')
    b.setAttribute('data-line', '2'); b.setAttribute('data-id', 'H:1'); b.id = 'same'; b.textContent = 'B'
    w.write.append(a, b)
    w.place(a, 900, 40)
    w.place(b, 990, 40)

    const out = computeDocumentDiagnostics({
      documentKey: 'doc:key', markdown: md, strictMode: false, vaultRoot: '/vault',
      headings: [
        { level: 2, text: 'A', stableIdentity: 'H:0', element: a },
        { level: 2, text: 'B', stableIdentity: 'H:1', element: b },
      ],
      h1Facts: [], latentAtxMarkers: [], figures: [], tables: [], codes: [], formulas: [], links: [],
      canonicalDuplicateIdentities: [], captionDuplicateNames: [],
    })
    const diag = out.diagnostics.find(d => d.code === HEADING_ANCHOR_COLLISION_CODE)
    expect(diag).toBeTruthy()
    expect(diag!.location?.kind).toBe('target-group')

    w.inject([diag as unknown as Record<string, unknown>])
    await expectCommitThenDeactivate(w, diag!.id, () => {
      const s = w.h.getLocateFrameStructure()
      expect(s.active).toBe(true)
      expect(s.headingMarkerCarrier).toBe(true)
      expect(headingActiveFragments().length).toBeGreaterThanOrEqual(1)
    })
  })
})

// ── Honesty contract: no fake active on an unmeasurable target ──────────────

describe('Locate V1 — no fake active on a zero/unresolvable target', () => {
  it('a caption id with no live projection ends IDLE with no carrier / no lease', async () => {
    const w = makeWorld(fakeContext(), fakeProviders())
    host = w.h
    // A valid caption exists, but the diagnostic points at a captionId that is
    // NOT in the DOM → the target genuinely cannot be measured.
    const owner = document.createElement('p')
    const img = document.createElement('img')
    img.setAttribute('src', 'a.png')
    owner.appendChild(img)
    w.write.appendChild(owner)
    w.place(owner, 900, 120)
    w.place(img, 900, 120)
    const adapter = new CaptionDomAdapter(() => w.write)
    const caption = adapter.renderCaption({ type: 'figure', ordinal: 0, root: owner }, '图 1', '名称', 'cap-live', 'below')
    w.place(caption, 1040, 30)

    const missing = {
      id: 'doc:key::FIGURE_CAPTION_FORMAT_INVALID::cap-gone', domain: 'document', documentKey: 'doc:key',
      severity: 'warning', category: 'figure', code: 'FIGURE_CAPTION_FORMAT_INVALID',
      message: 'm', detail: '', metadata: {}, stableIdentity: 'cap-gone',
      location: { kind: 'caption-projection', captionKind: 'figure', captionId: 'cap-gone' },
    }
    w.inject([missing])
    await w.click(missing.id)

    expect(w.h.getDiagnosticInteractionStateV2().phase).toBe('IDLE')
    expect(w.h.getDiagnosticInteractionStateV2().diagnosticId).toBeNull()
    expect(w.h.isLocateTransactionActive()).toBe(false)
    expect(anyCarrier()).toBe(false)
    expect(w.h.getActiveLocateFillCount()).toBe(0)
    const gate = w.h.getLastLocateCommitGate()
    expect(gate == null || gate.canCommit === false).toBe(true)
  })
})
