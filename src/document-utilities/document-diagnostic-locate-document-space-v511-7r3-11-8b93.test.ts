// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.24 — Diagnostic Locate Document-Space Visual Carrier V5.11.
 *
 * POST-COMMIT USER SCROLL IS VISUALLY INERT.
 *
 * The committed visual is converted ONCE into document-local geometry and
 * mounted in a document-space layer; the locate scroll lease is released at the
 * terminal so the scroll handler no longer repaints / remeasures / re-resolves /
 * recenters / writes scrollTop.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  DOCUMENT_SPACE_DRIFT_HARD_PX,
  LOCATE_DOCUMENT_LAYER_CLASS,
  LOCATE_DOCUMENT_SPACE_AUDIT_EVENT,
  LOCATE_DOCUMENT_SPACE_V511_GATE_KEYS,
  createLocateDocumentSpaceV511GateCounters,
  documentLocalDrift,
  isLayoutReflow,
  layoutFingerprintKey,
  makeDocumentSpaceRect,
  viewportRectToDocumentLocalRect,
  type LocateLayoutFingerprint,
} from './document-locate-document-space-v5-11'

// ── rAF harness ────────────────────────────────────────────────────────────
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
  while (rafTasks.size > 0 && guard++ < 300) {
    const cur = Array.from(rafTasks.values())
    rafTasks.clear()
    for (const cb of cur) cb(0)
    await Promise.resolve()
  }
}

type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# 标题\n\n正文',
      isStrictMode: () => true,
      vaultRoot: '/vault',
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
    getHeadingIdentity: (el) => el.getAttribute('data-id'),
    parseLocalLinkTargets: () => [],
    getObjectCaptionHost: (obj) => (obj as unknown as { __inkCaption?: HTMLElement }).__inkCaption ?? null,
  }
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

// ── World (scroll container + document host + moving target) ───────────────
interface World {
  h: DocumentUtilityOverlayHost
  shell: HTMLElement
  write: HTMLElement
  target: HTMLElement
  caption: HTMLElement | null
  scrollTop(): number
  scrollBy(delta: number): void
  setTargetHeight(h: number): void
  setHostWidth(w: number): void
  stubContentRect(el: HTMLElement, contentTop: number, height: number): void
}

function makeWorld(opts: {
  tag: string
  targetTop: number
  targetHeight: number
  viewHeight?: number
  contentHeight?: number
  initialScrollTop?: number
  withCaption?: boolean
  captionHeight?: number
  captionGap?: number
  targetHtml?: string
  /**
   * V511-DRAG — model the REAL content host: in Typora the document host is a child
   * of the scroller, so its VIEWPORT box moves with `scrollTop`. Without this the
   * document-local conversion (`viewport − hostRect`) cannot be asserted absolutely.
   */
  scrollingHost?: boolean
}): World {
  const viewHeight = opts.viewHeight ?? 600
  const contentHeight = opts.contentHeight ?? 3000
  const scrollingHost = opts.scrollingHost === true
  let targetTop = opts.targetTop
  let targetHeight = opts.targetHeight
  const captionHeight = opts.captionHeight ?? 40
  const captionGap = opts.captionGap ?? 8
  let hostWidth = 800
  let scrollTop = Math.max(0, Math.min(opts.initialScrollTop ?? 0, Math.max(0, contentHeight - viewHeight)))

  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  Object.defineProperty(shell, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => { scrollTop = Math.max(0, Math.min(Number(v) || 0, Math.max(0, contentHeight - viewHeight))) },
  })
  Object.defineProperty(shell, 'clientHeight', { configurable: true, get: () => viewHeight })
  Object.defineProperty(shell, 'scrollHeight', { configurable: true, get: () => contentHeight })
  stubRect(shell, () => ({ left: 0, top: 0, right: hostWidth, bottom: viewHeight }))

  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  stubRect(write, () => {
    const top = scrollingHost ? -scrollTop : 0
    return { left: 0, top, right: hostWidth, bottom: top + contentHeight }
  })

  let caption: HTMLElement | null = null
  if (opts.withCaption) {
    caption = document.createElement('div')
    caption.className = 'inkchapter-caption'
    caption.textContent = '题注'
    write.appendChild(caption)
    stubRect(caption, () => {
      const top = targetTop - captionGap - captionHeight - scrollTop
      return { left: 200, top, right: 900, bottom: top + captionHeight }
    })
  }
  const target = document.createElement(opts.tag)
  if (opts.tag === 'pre') (target as HTMLElement).className = 'md-fences'
  if (opts.targetHtml) target.innerHTML = opts.targetHtml
  write.appendChild(target)
  stubRect(target, () => {
    const top = targetTop - scrollTop
    return { left: 200, top, right: 900, bottom: top + targetHeight }
  })
  if (caption) (target as unknown as { __inkCaption?: HTMLElement }).__inkCaption = caption

  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return {
    h, shell, write, target, caption,
    scrollTop: () => scrollTop,
    scrollBy: (delta: number) => {
      scrollTop = Math.max(0, Math.min(scrollTop + delta, Math.max(0, contentHeight - viewHeight)))
      shell.dispatchEvent(new Event('scroll'))
    },
    setTargetHeight: (v: number) => { targetHeight = v },
    setHostWidth: (v: number) => { hostWidth = v },
    stubContentRect: (el: HTMLElement, contentTop: number, h2: number) => {
      stubRect(el, () => { const top = contentTop - scrollTop; return { left: 200, top, right: 900, bottom: top + h2 } })
    },
  }
}

function inject(h: DocumentUtilityOverlayHost, diag: Record<string, unknown>): void {
  const snapshot = {
    documentKey: 'doc:key', revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: [diag], errorCount: 0, warningCount: 0, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for the document-space test */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}
function diagOf(id: string, code: string, location: Record<string, unknown>, metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, documentKey: 'doc:key', severity: 'error', category: 'document', code, message: 'm', detail: '', metadata, location }
}
async function oneClick(h: DocumentUtilityOverlayHost, id: string): Promise<void> {
  ;(h as unknown as { locateDiagnostic(id: string): void }).locateDiagnostic(id)
  await flushRaf()
}

const CODE_LOC = { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' }
const TABLE_LOC = { kind: 'block-node', blockKind: 'table', stableIdentity: 'block:table:0' }

let infoSpy: InfoSpy | null = null
let host: DocumentUtilityOverlayHost | null = null
let origBcr: typeof Element.prototype.getBoundingClientRect

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  // The viewport carrier follows the scroll (it is a VIEWPORT overlay), which is
  // exactly what the document-space carrier must replace.
  origBcr = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (this.classList && this.classList.contains('inkchapter-diagnostic-locate-frame')) {
      const st = Number.parseFloat((this as HTMLElement).style.top || '0')
      const l = Number.parseFloat((this as HTMLElement).style.left || '0')
      const w = Number.parseFloat((this as HTMLElement).style.width || '300')
      const h = Number.parseFloat((this as HTMLElement).style.height || '100')
      // A carrier inside the DOCUMENT-SPACE layer shares the content host's
      // containing block, so it SCROLLS with the host: viewport = host + style.
      const hostEl = document.getElementById('write')
      const inDocLayer = typeof this.closest === 'function'
        && this.closest(`.${LOCATE_DOCUMENT_LAYER_CLASS}`) != null
      const hr = inDocLayer && hostEl ? hostEl.getBoundingClientRect() : null
      const left = l + (hr ? hr.left : 0)
      const top = st + (hr ? hr.top : 0)
      return { x: left, y: top, left, top, right: left + w, bottom: top + h, width: w, height: h, toJSON: () => ({}) } as DOMRect
    }
    return origBcr.call(this)
  } as typeof Element.prototype.getBoundingClientRect
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
})
afterEach(() => {
  Element.prototype.getBoundingClientRect = origBcr
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

function gateZero(h: DocumentUtilityOverlayHost): void {
  const c = h.getDocumentSpaceCounters()
  for (const key of Object.keys(c)) expect(c[key], key).toBe(0)
}

// ── V511-1 / 2 ─────────────────────────────────────────────────────────────
describe('V511-1/2 — Table/Code COMMIT is scroll-inert', () => {
  for (const c of [
    { name: 'Table', id: 'T', code: 'TABLE_MISSING_NAME', tag: 'table', loc: TABLE_LOC, top: 1000 },
    { name: 'Code', id: 'C', code: 'CODE_MISSING_NAME', tag: 'pre', loc: CODE_LOC, top: 1100 },
  ] as const) {
    it(`V511-${c.name === 'Table' ? 1 : 2}: ${c.name} scroll +400 → repaint/measure/resolve/recenter/write all 0`, async () => {
      const w = makeWorld({ tag: c.tag, targetTop: c.top, targetHeight: 200, targetHtml: c.tag === 'table' ? '<tr><td>x</td></tr>' : undefined })
      host = w.h
      inject(host, diagOf(c.id, c.code, c.loc))

      const repaint = vi.spyOn(host as unknown as { repositionDiagnosticLocateFrame: () => void }, 'repositionDiagnosticLocateFrame')
      const placement = vi.spyOn(host as unknown as { measurePlacementState: () => unknown }, 'measurePlacementState')
      const visual = vi.spyOn(host as unknown as { measureActualPaintedLocateVisual: () => unknown }, 'measureActualPaintedLocateVisual')

      await oneClick(host, c.id)
      const committed = host.getCommittedDocumentSpace()
      expect(committed, c.name).not.toBeNull()
      const localBefore = JSON.stringify(committed!.primaryLocal)
      const carrierBefore = document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`)
      expect(carrierBefore, c.name).not.toBeNull()
      const styleBefore = (carrierBefore as HTMLElement).getAttribute('style')
      expect(host.getLocateScrollLeaseState(), c.name).toBe('RELEASED')
      const callsBefore = repaint.mock.calls.length + placement.mock.calls.length + visual.mock.calls.length

      w.scrollBy(400)
      await flushRaf()

      expect(repaint.mock.calls.length + placement.mock.calls.length + visual.mock.calls.length - callsBefore, c.name).toBe(0)
      expect(host.getPostCommitUserScrollCount(), c.name).toBeGreaterThan(0)
      // The carrier and its DOCUMENT-LOCAL geometry are untouched by the scroll.
      expect((carrierBefore as HTMLElement).getAttribute('style'), c.name).toBe(styleBefore)
      const after = host.getCommittedDocumentSpace()!
      expect(after.diagnosticId, c.name).toBe(c.id)
      expect(after.presentationKind, c.name).toBe(committed!.presentationKind)
      expect(after.visualEpoch, c.name).toBe(committed!.visualEpoch)
      expect(JSON.stringify(after.primaryLocal), c.name).toBe(localBefore)
      gateZero(host)
      repaint.mockRestore(); placement.mockRestore(); visual.mockRestore()
    })
  }
})

// ── V511-3 ─────────────────────────────────────────────────────────────────
describe('V511-3 — scroll out and back returns the SAME carrier', () => {
  it('V511-3: same carrier node / local rect / epoch / id / presentationKind', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')
    const before = host.getCommittedDocumentSpace()!
    const carrierBefore = document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`)
    expect(carrierBefore).not.toBeNull()
    const styleBefore = (carrierBefore as HTMLElement).getAttribute('style')

    w.scrollBy(2600) // target fully offscreen
    await flushRaf()
    w.scrollBy(-2600) // and back
    await flushRaf()

    const carrierAfter = document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`)
    expect(carrierAfter).toBe(carrierBefore) // never recreated
    expect((carrierAfter as HTMLElement).getAttribute('style')).toBe(styleBefore)
    const after = host.getCommittedDocumentSpace()!
    expect(after.visualEpoch).toBe(before.visualEpoch)
    expect(after.diagnosticId).toBe(before.diagnosticId)
    expect(after.presentationKind).toBe(before.presentationKind)
    expect(documentLocalDrift(before.primaryLocal, after.primaryLocal)).toBe(0)
    gateZero(host)
  })
})

// ── V511-4/5/6 ─────────────────────────────────────────────────────────────
describe('V511-4/5/6 — inline resources never remeasure on scroll', () => {
  const cases: Array<{ n: number; id: string; tag: string; code: string; loc: Record<string, unknown>; meta: Record<string, unknown>; occ: number | null }> = [
    { n: 4, id: 'I0', tag: 'img', code: 'FIGURE_LOCAL_IMAGE_MISSING', loc: { kind: 'block-node', blockKind: 'figure', stableIdentity: 'block:figure:0' }, meta: { resourceKind: 'image', occurrenceIndex: 0, destination: 'a.png', rawDestination: 'a.png' }, occ: 0 },
    { n: 5, id: 'I1', tag: 'img', code: 'FIGURE_LOCAL_IMAGE_MISSING', loc: { kind: 'block-node', blockKind: 'figure', stableIdentity: 'block:figure:1' }, meta: { resourceKind: 'image', occurrenceIndex: 1, destination: 'b.png', rawDestination: 'b.png' }, occ: 1 },
    { n: 6, id: 'L', tag: 'a', code: 'LINK_LOCAL_TARGET_MISSING', loc: { kind: 'block-node', blockKind: 'link', stableIdentity: 'local:missing.md' }, meta: { resourceKind: 'link', occurrenceIndex: 0, destination: 'missing.md', rawDestination: './missing.md' }, occ: 0 },
  ]
  for (const c of cases) {
    it(`V511-${c.n}: ${c.tag} occurrence ${c.occ} → occurrence/sourceRange/fragments frozen on scroll`, async () => {
      const w = makeWorld({ tag: c.tag, targetTop: 1000, targetHeight: c.tag === 'a' ? 20 : 120 })
      if (c.tag === 'a') (w.target as HTMLAnchorElement).setAttribute('href', './missing.md')
      if (c.tag === 'img') {
        const sibling = document.createElement('img')
        sibling.src = 'sibling.png'
        w.write.appendChild(sibling)
        w.stubContentRect(sibling, 1600, 120)
      }
      host = w.h
      inject(host, diagOf(c.id, c.code, c.loc, c.meta))
      await oneClick(host, c.id)

      const before = host.getCommittedDocumentSpace()!
      expect(before.occurrenceIndex).toBe(c.occ)
      const inlineBefore = JSON.stringify(before.inlineLocal)
      w.scrollBy(500)
      await flushRaf()
      const after = host.getCommittedDocumentSpace()!
      expect(after.occurrenceIndex).toBe(c.occ)
      expect(JSON.stringify(after.inlineLocal)).toBe(inlineBefore)
      expect(documentLocalDrift(before.primaryLocal, after.primaryLocal) ?? 0).toBe(0)
      expect(host.getDocumentSpaceCounters().postCommitInlineRemeasureOnScroll).toBe(0)
      expect(host.getDocumentSpaceCounters().postCommitInlineOccurrenceChange).toBe(0)
      gateZero(host)
    })
  }
})

// ── V511-7 ─────────────────────────────────────────────────────────────────
describe('V511-7 — Heading never changes visual type on scroll', () => {
  it('V511-7: presentationKind is frozen', async () => {
    const w = makeWorld({ tag: 'h1', targetTop: 1000, targetHeight: 60 })
    w.target.setAttribute('data-id', 'H1')
    host = w.h
    inject(host, diagOf('H', 'HEADING_LEVEL_GAP', { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H1' }))
    await oneClick(host, 'H')
    const before = host.getCommittedDocumentSpace()!
    expect(before.presentationKind).not.toBeNull()
    w.scrollBy(420)
    await flushRaf()
    const after = host.getCommittedDocumentSpace()!
    expect(after.presentationKind).toBe(before.presentationKind)
    expect(after.diagnosticId).toBe('H')
    gateZero(host)
  })
})

// ── V511-8 ─────────────────────────────────────────────────────────────────
describe('V511-8 — left-click dismiss is final', () => {
  it('V511-8: the carrier is removed and a later scroll never brings it back', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')
    expect(document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`)).not.toBeNull()

    w.write.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', cancelable: true }))
    await flushRaf()
    expect(host.getCommittedDocumentSpace()).toBeNull()
    expect(document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`)).toBeNull()
    expect(host.getLocateScrollLeaseState()).toBe('RELEASED')

    w.scrollBy(300)
    await flushRaf()
    expect(document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`)).toBeNull()
    expect(host.getCommittedDocumentSpace()).toBeNull()
    expect(host.getDocumentSpaceCounters().locateVisualReappearAfterDocumentDismiss).toBe(0)
    expect(host.getDocumentSpaceCounters().postDismissRecenter).toBe(0)
  })
})

// ── V511-9 / 10 / 11 ───────────────────────────────────────────────────────
describe('V511-9/10/11 — only a TRUE layout reflow reconciles', () => {
  it('V511-10: a pure scroll is NOT a layout reflow', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')
    w.scrollBy(500)
    await flushRaf()
    const audits = readAudits(infoSpy!, LOCATE_DOCUMENT_SPACE_AUDIT_EVENT)
    const inert = audits.filter(a => a.reason === 'POST_COMMIT_USER_SCROLL_INERT')
    expect(inert.length).toBeGreaterThan(0)
    for (const a of inert) {
      expect(a.layoutReconcileTriggered).toBe('false')
      expect(a.postCommitRepaintCount).toBe('0')
      expect(a.postCommitRemeasureCount).toBe('0')
      expect(a.postCommitReresolveCount).toBe('0')
      expect(a.postCommitRecenterCount).toBe('0')
      expect(a.postCommitScrollWriteCount).toBe('0')
      expect(a.layoutFingerprintBefore).toBe(a.layoutFingerprintAfter)
    }
    gateZero(host)
  })

  it('V511-9: a true resize reconciles the SAME target exactly once', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')
    const before = host.getCommittedDocumentSpace()!

    // The editor width really changed → a reflow.
    w.write.style.width = '520px'
    stubRect(w.write, () => ({ left: 0, top: 0, right: 520, bottom: 3000 }))
    window.dispatchEvent(new Event('resize'))
    await flushRaf()

    const audits = readAudits(infoSpy!, LOCATE_DOCUMENT_SPACE_AUDIT_EVENT)
    const reconciled = audits.filter(a => a.layoutReconcileTriggered === 'true')
    expect(reconciled.length).toBeGreaterThanOrEqual(1)
    expect(reconciled[0].reason).toContain('LAYOUT_RECONCILE')
    const after = host.getCommittedDocumentSpace()!
    expect(after.diagnosticId).toBe(before.diagnosticId)
    expect(after.presentationKind).toBe(before.presentationKind)
    expect(host.getDocumentSpaceCounters().layoutReconcileTargetIdentityChange).toBe(0)
    expect(host.getDocumentSpaceCounters().layoutReconcilePresentationKindChange).toBe(0)
  })

  it('V511-11: a Drawer-width reflow keeps the identities stable', async () => {
    const w = makeWorld({ tag: 'table', targetTop: 1000, targetHeight: 200, withCaption: true, targetHtml: '<tr><td>x</td></tr>' })
    host = w.h
    inject(host, diagOf('T', 'TABLE_MISSING_NAME', TABLE_LOC))
    await oneClick(host, 'T')
    const before = host.getCommittedDocumentSpace()!
    expect(before.secondaryAnchorIdentity).not.toBeNull()

    stubRect(w.write, () => ({ left: 0, top: 0, right: 620, bottom: 3000 }))
    window.dispatchEvent(new Event('resize'))
    await flushRaf()

    const after = host.getCommittedDocumentSpace()!
    expect(after.secondaryAnchorIdentity).toBe(before.secondaryAnchorIdentity)
    expect(after.primaryAnchorIdentity).toBe(before.primaryAnchorIdentity)
    expect(after.presentationKind).toBe(before.presentationKind)
    expect(host.getDocumentSpaceCounters().layoutReconcileTargetIdentityChange).toBe(0)
    expect(host.getDocumentSpaceCounters().layoutReconcilePresentationKindChange).toBe(0)
  })
})

// ── V511-12 ────────────────────────────────────────────────────────────────
describe('V511-12 — a compound carrier never escapes into neighbouring blocks', () => {
  it('V511-12: the frozen secondary local rect does not swallow nearby blocks', async () => {
    const w = makeWorld({ tag: 'table', targetTop: 1000, targetHeight: 200, withCaption: true, targetHtml: '<tr><td>x</td></tr>' })
    // Nearby blocks that must NOT be absorbed.
    const near = document.createElement('h2')
    near.textContent = '邻近标题'
    w.write.appendChild(near)
    w.stubContentRect(near, 1300, 40)
    const nearCode = document.createElement('pre')
    nearCode.className = 'md-fences'
    w.write.appendChild(nearCode)
    w.stubContentRect(nearCode, 1400, 120)

    host = w.h
    inject(host, diagOf('T', 'TABLE_MISSING_NAME', TABLE_LOC))
    await oneClick(host, 'T')
    const before = host.getCommittedDocumentSpace()!
    const carrier = document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`) as HTMLElement
    expect(carrier).not.toBeNull()
    const widthBefore = carrier.style.width

    w.scrollBy(400)
    await flushRaf()

    const after = host.getCommittedDocumentSpace()!
    expect(documentLocalDrift(before.secondaryLocal, after.secondaryLocal)).toBe(0)
    expect(carrier.style.width).toBe(widthBefore)
    expect(host.getDocumentSpaceCounters().postCommitCompoundBoundsChange).toBe(0)
    expect(host.getDocumentSpaceCounters().postCommitSecondaryAnchorChange).toBe(0)
    gateZero(host)
  })
})

// ── V511-13 ────────────────────────────────────────────────────────────────
describe('V511-13 — no scroll handler paint in the COMMITTED state', () => {
  it('V511-13: a canonical scroll event performs 0 paint / 0 measure / 0 resolve', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')

    const repaint = vi.spyOn(host as unknown as { repositionDiagnosticLocateFrame: () => void }, 'repositionDiagnosticLocateFrame')
    const placement = vi.spyOn(host as unknown as { measurePlacementState: () => unknown }, 'measurePlacementState')
    const fingerprint = vi.spyOn(host as unknown as { measureLocateLayoutFingerprint: () => unknown }, 'measureLocateLayoutFingerprint')

    w.shell.dispatchEvent(new Event('scroll'))
    await flushRaf()
    w.shell.scrollTop = 250
    w.shell.dispatchEvent(new Event('scroll'))
    await flushRaf()

    expect(repaint.mock.calls.length).toBe(0)
    expect(placement.mock.calls.length).toBe(0)
    expect(fingerprint.mock.calls.length).toBe(0)
    gateZero(host)
    repaint.mockRestore(); placement.mockRestore(); fingerprint.mockRestore()
  })
})

// ── V511-DRAG — sidebar-divider drag (editor width change, NO window resize)  ─
describe('V511-DRAG — the ACTIVE document-space carrier follows a real editor-width change', () => {
  const carrierOf = (): HTMLElement | null =>
    document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`) as HTMLElement | null
  const geomOf = (): { left: number; top: number; width: number } => {
    const c = carrierOf()!
    return { left: parseFloat(c.style.left), top: parseFloat(c.style.top), width: parseFloat(c.style.width) }
  }
  const runGeometryPass = (reason: string): void => {
    ;(host as unknown as { applyGeometry(r: Set<string>): void }).applyGeometry(new Set([reason]))
  }
  /** GROUND TRUTH — the target's own document-local rect (viewport − content host). */
  const targetLocal = (): { top: number; width: number } => {
    const t = w_target!.getBoundingClientRect()
    const h = w_write!.getBoundingClientRect()
    return { top: t.top - h.top, width: t.right - t.left }
  }
  // The frame pads the target by `frameGap` on every side.
  const expectCarrierFollowsTarget = (): void => {
    const g = geomOf()
    const t = targetLocal()
    expect(Math.abs(g.top - (t.top - 2)), `carrier.top=${g.top} target.top=${t.top}`).toBeLessThanOrEqual(1)
    expect(Math.abs(g.width - (t.width + 4)), `carrier.width=${g.width} target.width=${t.width}`).toBeLessThanOrEqual(1)
  }
  let w_target: HTMLElement | null = null
  let w_write: HTMLElement | null = null

  it('V511-DRAG-1: the drag re-measures the carrier (a window.resize never fired)', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200, scrollingHost: true })
    host = w.h; w_target = w.target; w_write = w.write
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')
    expectCarrierFollowsTarget()
    expect(geomOf().top).toBe(998) // 1000 − frameGap(2)

    // SIDEBAR DIVIDER DRAG: the editor narrows AND the code block re-wraps — its
    // document position and rendered width both change. No `window.resize` fires.
    w.setHostWidth(520)
    stubRect(w.target, () => {
      const top = 1060 - w.scrollTop()
      return { left: 200, top, right: 640, bottom: top + 260 }
    })
    runGeometryPass('resize-observer')
    await flushRaf()

    // the carrier MUST be re-measured onto the NEW target geometry
    expectCarrierFollowsTarget()
    expect(geomOf().top).toBe(1058) // 1060 − frameGap(2)
    expect(geomOf().width).toBe(444) // 440 + 2*frameGap
    expect(host.getCommittedDocumentSpace()).not.toBeNull()
  })

  it('V511-DRAG-2: after the drag the (re-measured) carrier stays scroll-inert', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200, scrollingHost: true })
    host = w.h; w_target = w.target; w_write = w.write
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')

    w.setHostWidth(520)
    stubRect(w.target, () => {
      const top = 1060 - w.scrollTop()
      return { left: 200, top, right: 640, bottom: top + 260 }
    })
    runGeometryPass('resize-observer')
    await flushRaf()
    expectCarrierFollowsTarget()
    const dragged = geomOf()

    // POST-DRAG SCROLL PROOF — the document-local carrier does not move at all.
    w.scrollBy(400)
    await flushRaf()
    expect(geomOf()).toEqual(dragged)
    expectCarrierFollowsTarget()

    // REVERSE drag → back to the wide layout; the carrier must follow again.
    w.setHostWidth(800)
    stubRect(w.target, () => {
      const top = 1000 - w.scrollTop()
      return { left: 200, top, right: 900, bottom: top + 200 }
    })
    runGeometryPass('resize-observer')
    await flushRaf()
    expectCarrierFollowsTarget()
    const restored = geomOf()
    expect(restored.top).toBe(998)
    expect(restored.width).toBe(704) // 700 + 2*frameGap
    expect(restored.width).toBeGreaterThan(dragged.width)

    // DEACTIVATE (left-click dismiss) → REACTIVATE keeps the same authority.
    w.write.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', cancelable: true }))
    await flushRaf()
    expect(carrierOf()).toBeNull()
    await oneClick(host, 'C')
    expectCarrierFollowsTarget()
    gateZero(host)
  })
})

// ── ROOT_CODE_CARRIER_CONTENT_COLUMN ───────────────────────────────────────
describe('V511-CONTENT-COLUMN — a full-width carrier never overflows the content column', () => {
  const carrierOf = (): HTMLElement | null =>
    document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`) as HTMLElement | null

  it('V511-COL-1: a full-width code carrier is clamped to the column (the +4px gap is dropped)', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200, scrollingHost: true })
    host = w.h
    // Zero the content padding so the semantic content column coincides with the
    // host box (0..800), then make the code block span that whole column.
    w.write.style.padding = '0px'
    w.write.style.border = '0px'
    stubRect(w.target, () => {
      const top = 1000 - w.scrollTop()
      return { left: 0, top, right: 800, bottom: top + 200 }
    })
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')
    const c = carrierOf()!
    // The 2px symmetric gap would have made this 804 → clamped to the column (800).
    expect(parseFloat(c.style.width)).toBe(800)
    expect(parseFloat(c.style.left)).toBe(0)
    expect(host.getDocumentSpaceCounters().codeCarrierOverflowsContentColumn).toBe(0)
    gateZero(host)
  })

  it('V511-COL-2: a narrower carrier keeps its 2px breathing gap', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200, scrollingHost: true })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')
    // target 200..900 (700 wide) → 198..902 = 704: the gap is preserved because the
    // target itself extends past the column, so no side is clamped.
    const c = carrierOf()!
    expect(parseFloat(c.style.width)).toBe(704)
    gateZero(host)
  })
})

// ── ROOT_ACTIVE_DUP_CARRIER ────────────────────────────────────────────────
describe('ROOT_ACTIVE_DUP_CARRIER — 布局重测不得留下 viewport 帧（重复标记 / 不随滚动）', () => {
  const docFrames = (): number =>
    document.querySelectorAll(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`).length
  const strayViewportFrames = (): number =>
    Array.from(document.querySelectorAll('.inkchapter-diagnostic-locate-frame'))
      .filter(el => el.closest(`.${LOCATE_DOCUMENT_LAYER_CLASS}`) == null).length

  it('激活 code 诊断 → 拖拽侧栏 → 只剩 1 个 document-space 载体，viewport 帧已释放', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200, scrollingHost: true })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_LANGUAGE', CODE_LOC))
    await oneClick(host, 'C')
    expect(docFrames()).toBe(1)
    // committed: the pre-commit viewport frame was cloned + released.
    expect(host.getLocateFrameStructure().locateFrameCount).toBe(0)

    // SIDEBAR DIVIDER DRAG: the editor narrows AND the code block re-wraps.
    w.setHostWidth(520)
    stubRect(w.target, () => {
      const top = 1060 - w.scrollTop()
      return { left: 200, top, right: 640, bottom: top + 260 }
    })
    ;(host as unknown as { applyGeometry(r: Set<string>): void }).applyGeometry(new Set(['resize-observer']))
    await flushRaf()

    // The remeasure path (which re-presents the PRE-COMMIT viewport frame) really ran.
    expect(readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-LAYOUT-INVALIDATION-REMEASURE').length).toBeGreaterThanOrEqual(1)
    // …yet the viewport frame must NOT survive: the doc-space carrier is the sole owner.
    expect(docFrames()).toBe(1)
    expect(strayViewportFrames()).toBe(0)
    expect(host.getLocateFrameStructure().locateFrameCount).toBe(0)
    expect(host.getDocumentSpaceCounters().locateViewportFrameLingeringAfterCommit).toBe(0)

    // FINAL DOM ACCEPTANCE — the reconcile audit reports the REAL DOM facts.
    const reconcile = readAudits(infoSpy!, LOCATE_DOCUMENT_SPACE_AUDIT_EVENT)
      .find(a => (a.reason ?? '').startsWith('LAYOUT_RECONCILE:'))
    expect(reconcile).toBeDefined()
    expect(reconcile!.viewportFrameLingeringCount).toBe('1') // raw pre-release evidence
    // the SECONDARY is re-projected on the SAME epoch, never left frozen.
    expect(reconcile).toHaveProperty('secondaryLocalDriftPx')
    expect(reconcile!.secondaryElementConnected).toBe('true')
  })

  it('拖拽后滚动：唯一的 document-space 载体随文档滚动，无第二枚标记', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200, scrollingHost: true })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_LANGUAGE', CODE_LOC))
    await oneClick(host, 'C')
    w.setHostWidth(520)
    ;(host as unknown as { applyGeometry(r: Set<string>): void }).applyGeometry(new Set(['resize-observer']))
    await flushRaf()
    const carrier = document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`) as HTMLElement
    const topBefore = parseFloat(carrier.style.top)
    w.scrollBy(400)
    await flushRaf()
    // the document-local carrier does not move with scroll (native), and no second,
    // viewport-fixed marker exists to diverge from it.
    expect(parseFloat(carrier.style.top)).toBe(topBefore)
    expect(strayViewportFrames()).toBe(0)
    expect(host.getDocumentSpaceCounters().postCommitUserScrollRepaint).toBe(0)
    expect(host.getDocumentSpaceCounters().locateViewportFrameLingeringAfterCommit).toBe(0)
  })
})

// ── ROOT_COMPOUND_CAPTION_COVERAGE ─────────────────────────────────────────
describe('ROOT_COMPOUND_CAPTION_COVERAGE — 复合题注高亮在布局变化后仍被载体覆盖', () => {
  const carrierOf = (): HTMLElement | null =>
    document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`) as HTMLElement | null
  const geom = (): { top: number; height: number; width: number } => {
    const c = carrierOf()!
    return { top: parseFloat(c.style.top), height: parseFloat(c.style.height), width: parseFloat(c.style.width) }
  }
  const runGeometryPass = (reason: string): void => {
    ;(host as unknown as { applyGeometry(r: Set<string>): void }).applyGeometry(new Set([reason]))
  }

  it('CODE_MISSING_NAME：题注+代码主体的载体在拖拽后仍覆盖题注（不是塌缩到代码主体）', async () => {
    // Force the REAL-layout branch so the frame controller resolves the caption host
    // and the committed carrier actually spans `caption ∪ body` (as in Typora).
    const ua = vi.spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 RegularRuntime')
    try {
      const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200, withCaption: true, scrollingHost: true })
      host = w.h
      inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
      await oneClick(host, 'C')
      expect(carrierOf()).not.toBeNull()
      const committed = geom()
      // the committed carrier must span the caption ∪ body (NOT just the body).
      const bodyH = w.target.getBoundingClientRect().height
      expect(committed.height).toBeGreaterThan(bodyH + 5)

      // SIDEBAR DIVIDER DRAG — the caption and the body both move / re-wrap.
      w.setHostWidth(520)
      stubRect(w.target, () => {
        const top = 1060 - w.scrollTop()
        return { left: 200, top, right: 640, bottom: top + 200 }
      })
      if (w.caption) stubRect(w.caption, () => {
        const top = 1060 - 26 - w.scrollTop()
        return { left: 200, top, right: 640, bottom: top + 22 }
      })
      runGeometryPass('resize-observer')
      await flushRaf()

      const after = geom()
      // the carrier keeps its compound height (caption + body) — it must NOT collapse
      // onto the body (the reported "题注高亮覆盖丢失").
      expect(Math.abs(after.height - committed.height)).toBeLessThanOrEqual(4)
      expect(host.getDocumentSpaceCounters().compoundCaptionUncoveredAfterReconcile).toBe(0)
      // ── §3.3 — the caption PRIMARY child must be re-derived with the LIVE caption:
      // a deep-cloned carrier kept the COMMIT-time cue width (the caption is re-wrapped
      // narrower/wider), so the emphasis no longer covered the caption.
      const cue = (): HTMLElement | null =>
        document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame > .inkchapter-diagnostic-locate-marker[data-cue-type='caption-host']`) as HTMLElement | null
      expect(cue()).not.toBeNull()
      const liveCaption = w.caption!.getBoundingClientRect()
      expect(Math.abs(parseFloat(cue()!.style.width) - liveCaption.width)).toBeLessThanOrEqual(2)
      expect(host.getDocumentSpaceCounters().compoundCaptionCueUncoveredAfterReconcile).toBe(0)
      const rec = readAudits(infoSpy!, LOCATE_DOCUMENT_SPACE_AUDIT_EVENT)
        .find(a => (a.reason ?? '').startsWith('LAYOUT_RECONCILE:'))
      expect(rec).toBeDefined()
      expect(rec!.captionCoveredByCarrier).toBe('true')
      expect(rec!.captionCuePresent).toBe('true')
    } finally {
      ua.mockRestore()
    }
  })
})

// ── ROOT_COMPOUND_CAPTION_COVERAGE §3.1 — detached DOM re-bind ─────────────
describe('§3.1 — 已提交元素 detached 时按同一语义身份重解析（不在死节点上继续画）', () => {
  type Internals = { resolveLiveCommittedElement(f: HTMLElement | null, i: string | null): HTMLElement | null }

  it('连接中 → 返回同一节点；detached → 返回同身份的新节点；identity 不符 → 不误绑', () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200, scrollingHost: true })
    host = w.h
    const internals = host as unknown as Internals
    const id = 'pre#.md-fences'
    // connected → the SAME node (no re-bind)
    expect(internals.resolveLiveCommittedElement(w.target, id)).toBe(w.target)
    // Typora rebuilt `pre` → the committed reference is DETACHED
    w.target.remove()
    expect(w.target.isConnected).toBe(false)
    const rebuilt = document.createElement('pre')
    rebuilt.className = 'md-fences'
    w.write.appendChild(rebuilt)
    expect(internals.resolveLiveCommittedElement(w.target, id)).toBe(rebuilt)
    // a DIFFERENT identity is never silently bound to an unrelated node
    expect(internals.resolveLiveCommittedElement(w.target, 'pre#999.nope')).toBe(w.target)
    // no expected identity → keep the fallback (never scan)
    expect(internals.resolveLiveCommittedElement(w.target, null)).toBe(w.target)
  })

  it('DOM 重建后布局变化：编辑器宽度变化仍触发一次事务内 reconcile（不因死引用早退）', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200, scrollingHost: true })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')
    // connected baseline: the carrier follows the real editor-width change.
    stubRect(w.write, () => ({ left: 0, top: -w.scrollTop(), right: 560, bottom: -w.scrollTop() + 3000 }))
    stubRect(w.target, () => {
      const top = 1400 - w.scrollTop()
      return { left: 200, top, right: 640, bottom: top + 200 }
    })
    ;(host as unknown as { applyGeometry(r: Set<string>): void }).applyGeometry(new Set(['resize-observer']))
    await flushRaf()
    const top = parseFloat((document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS} .inkchapter-diagnostic-locate-frame`) as HTMLElement).style.top)
    expect(top).toBeGreaterThan(1000)
    expect(host.getDocumentSpaceCounters().layoutReconcileTargetIdentityChange).toBe(0)
  })
})

// ── Pure contract ──────────────────────────────────────────────────────────
describe('V511-CONTRACT — pure document-space surface', () => {
  it('V511-CONTRACT-1: the hard gates are declared exactly once', () => {
    expect(LOCATE_DOCUMENT_SPACE_V511_GATE_KEYS.length).toBe(24)
    expect(new Set(LOCATE_DOCUMENT_SPACE_V511_GATE_KEYS).size).toBe(24)
    for (const key of [
      'postCommitUserScrollRepaint', 'postCommitUserScrollRemeasure', 'postCommitUserScrollReresolve',
      'postCommitUserScrollRecenter', 'postCommitUserScrollWrite', 'postCommitPresentationKindChange',
      'postCommitTargetIdentityChange', 'postCommitPrimaryAnchorChange', 'postCommitSecondaryAnchorChange',
      'postCommitCompoundBoundsChange', 'postCommitInlineRemeasureOnScroll', 'postCommitInlineOccurrenceChange',
      'userScrollReentersLocateTransaction', 'documentSpaceOverlayScrollDrift',
      'layoutReconcileTargetIdentityChange', 'layoutReconcilePresentationKindChange',
      'locateVisualReappearAfterDocumentDismiss', 'postDismissRecenter',
      'docSpaceCarrierPaintDriftGt1px',
      // ROOT_ACTIVE_DUP_CARRIER — a pre-commit viewport frame that outlived its commit.
      'locateViewportFrameLingeringAfterCommit',
      // ROOT_COMPOUND_CAPTION_COVERAGE — a compound caption left outside the carrier.
      'compoundCaptionUncoveredAfterReconcile',
      // ROOT_COMPOUND_CAPTION_COVERAGE — the caption PRIMARY child lost/mismatched.
      'compoundCaptionCueUncoveredAfterReconcile',
      // ROOT_BLANK_SEMANTIC_CONTAINMENT — a blank carrier intruding into adjacent prose.
      'blankCarrierIntrudesAdjacentProse',
      // ROOT_CODE_CARRIER_CONTENT_COLUMN — a full-width code carrier overflowing the column.
      'codeCarrierOverflowsContentColumn',
    ] as const) {
      expect(LOCATE_DOCUMENT_SPACE_V511_GATE_KEYS).toContain(key)
    }
    expect(createLocateDocumentSpaceV511GateCounters().postCommitUserScrollRepaint).toBe(0)
    expect(DOCUMENT_SPACE_DRIFT_HARD_PX).toBe(2)
    expect(LOCATE_DOCUMENT_LAYER_CLASS).toBe('inkchapter-locate-document-layer')
  })

  it('V511-CONTRACT-2: viewport → document-local conversion is edge-derived', () => {
    const local = viewportRectToDocumentLocalRect({
      viewportRect: { left: 210, top: 340, right: 710, bottom: 540 },
      contentHostRect: { left: 10, top: 40, right: 810, bottom: 3040 },
    })!
    expect(local).toEqual({ x: 200, y: 300, left: 200, top: 300, right: 700, bottom: 500, width: 500, height: 200 })
    expect(viewportRectToDocumentLocalRect({ viewportRect: null, contentHostRect: null })).toBeNull()
    // A pure scroll moves the VIEWPORT rect but not the document-local rect.
    const scrolled = viewportRectToDocumentLocalRect({
      viewportRect: { left: 210, top: 340 - 400, right: 710, bottom: 540 - 400 },
      contentHostRect: { left: 10, top: 40 - 400, right: 810, bottom: 3040 - 400 },
    })!
    expect(documentLocalDrift(local, scrolled)).toBe(0)
    expect(documentLocalDrift(local, null)).toBeNull()
  })

  it('V511-CONTRACT-3: only a real reflow is a reflow', () => {
    const base: LocateLayoutFingerprint = {
      documentHostWidth: 800, semanticWidth: 700, semanticHeight: 200,
      primaryWidth: 700, primaryHeight: 40, secondaryWidth: 700, secondaryHeight: 200,
      lineFragmentCount: null, structureRevision: 1,
    }
    expect(isLayoutReflow(base, { ...base })).toBe(false)
    // Sub-pixel rounding is not a reflow.
    expect(isLayoutReflow(base, { ...base, semanticWidth: 700.4 })).toBe(false)
    expect(isLayoutReflow(base, { ...base, documentHostWidth: 520 })).toBe(true)
    expect(isLayoutReflow(base, { ...base, semanticHeight: 260 })).toBe(true)
    expect(isLayoutReflow(base, { ...base, structureRevision: 2 })).toBe(true)
    expect(isLayoutReflow(null, base)).toBe(false)
    expect(layoutFingerprintKey(base)).toContain('800|700|200')
  })

  it('V511-CONTRACT-4: documentSpaceRect is always edge-derived', () => {
    const r = makeDocumentSpaceRect({ left: 10, top: 20, right: 5, bottom: 8 })
    expect(r.width).toBe(0)
    expect(r.height).toBe(0)
    const ok = makeDocumentSpaceRect({ left: 10, top: 20, right: 110, bottom: 80 })
    expect(ok.width).toBe(100)
    expect(ok.height).toBe(60)
  })

  it('V511-CONTRACT-5: production source separates viewport and document-space hosts', () => {
    const hostSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(hostSrc).toContain('Document-Space Visual Carrier')
    expect(hostSrc).toContain('commitDocumentSpaceCarrier')
    expect(hostSrc).toContain('auditPostCommitScrollInert')
    expect(hostSrc).toContain('reconcileLocateDocumentSpace')
    expect(hostSrc).toContain('acquireLocateScrollLease')
    expect(hostSrc).toContain('releaseLocateScrollLease')
    expect(hostSrc).toContain('LOCATE_DOCUMENT_SPACE_AUDIT_EVENT')
    // The scroll handler must consult the lease BEFORE scheduling any repaint.
    const scrollIdx = hostSrc.indexOf('private onEditorScrollForLocateFrame')
    const leaseIdx = hostSrc.indexOf('locateScrollLeaseActive()', scrollIdx)
    const rafIdx = hostSrc.indexOf('this.locateScrollRafHandle = requestAnimationFrame', scrollIdx)
    expect(leaseIdx).toBeGreaterThan(scrollIdx)
    expect(leaseIdx).toBeLessThan(rafIdx)
    const pureSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-locate-document-space-v5-11.ts'), 'utf8')
    expect(pureSrc).toContain('viewportRectToDocumentLocalRect')
    expect(pureSrc).toContain('POST-COMMIT USER SCROLL IS VISUALLY INERT')
  })
})
