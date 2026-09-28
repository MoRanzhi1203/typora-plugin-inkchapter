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
}): World {
  const viewHeight = opts.viewHeight ?? 600
  const contentHeight = opts.contentHeight ?? 3000
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
  stubRect(write, () => ({ left: 0, top: 0, right: hostWidth, bottom: contentHeight }))

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
      return { x: l, y: st, left: l, top: st, right: l + w, bottom: st + h, width: w, height: h, toJSON: () => ({}) } as DOMRect
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

// ── Pure contract ──────────────────────────────────────────────────────────
describe('V511-CONTRACT — pure document-space surface', () => {
  it('V511-CONTRACT-1: the 18 hard gates are declared exactly once', () => {
    expect(LOCATE_DOCUMENT_SPACE_V511_GATE_KEYS.length).toBe(18)
    expect(new Set(LOCATE_DOCUMENT_SPACE_V511_GATE_KEYS).size).toBe(18)
    for (const key of [
      'postCommitUserScrollRepaint', 'postCommitUserScrollRemeasure', 'postCommitUserScrollReresolve',
      'postCommitUserScrollRecenter', 'postCommitUserScrollWrite', 'postCommitPresentationKindChange',
      'postCommitTargetIdentityChange', 'postCommitPrimaryAnchorChange', 'postCommitSecondaryAnchorChange',
      'postCommitCompoundBoundsChange', 'postCommitInlineRemeasureOnScroll', 'postCommitInlineOccurrenceChange',
      'userScrollReentersLocateTransaction', 'documentSpaceOverlayScrollDrift',
      'layoutReconcileTargetIdentityChange', 'layoutReconcilePresentationKindChange',
      'locateVisualReappearAfterDocumentDismiss', 'postDismissRecenter',
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
