// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OutlineNumberingController, buildSemanticSequence } from './outline-numbering-controller'
import type { HeadingDescriptor } from './heading-types'

/** Create a native outline item wrapper (`.outline-item-wrapper.outline-h<N>`) + anchor. */
function appendNativeItem(outline: HTMLElement, href: string, text: string, level = 2): HTMLElement {
  const w = document.createElement('div')
  w.className = `outline-item-wrapper outline-h${level}`
  const a = document.createElement('a')
  a.href = href
  a.textContent = text
  w.appendChild(a)
  outline.appendChild(w)
  Object.defineProperty(a, 'offsetParent', { get: () => w, configurable: true })
  return a
}

function makeDom(): { outline: HTMLElement; items: HTMLElement[] } {
  document.body.innerHTML = ''
  const sidebar = document.createElement('div')
  sidebar.id = 'typora-sidebar'
  document.body.appendChild(sidebar)

  const outline = document.createElement('div')
  outline.id = 'outline-content'
  sidebar.appendChild(outline)

  const a1 = appendNativeItem(outline, '#h1', '第一章')
  const a2 = appendNativeItem(outline, '#h2', '第二章')

  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  const h1 = document.createElement('h2')
  h1.id = 'h1'
  h1.textContent = '第一章'
  write.appendChild(h1)
  const h2 = document.createElement('h2')
  h2.id = 'h2'
  h2.textContent = '第二章'
  write.appendChild(h2)

  // jsdom has no layout — mock offsetParent so `findOutlineRoot` sees visible.
  Object.defineProperty(sidebar, 'offsetParent', { get: () => document.body, configurable: true })
  Object.defineProperty(outline, 'offsetParent', { get: () => sidebar, configurable: true })
  Object.defineProperty(a1, 'offsetParent', { get: () => a1.parentElement, configurable: true })
  Object.defineProperty(a2, 'offsetParent', { get: () => a2.parentElement, configurable: true })

  return { outline, items: [a1, a2] }
}

const headings: HeadingDescriptor[] = [
  { key: 'h1', level: 2, text: '第一章' },
  { key: 'h2', level: 2, text: '第二章' },
]
const labels = ['一、', '二、']

async function nextFrames(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
}

describe('OutlineNumberingController — live reapply', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('syncAfterRefresh advances revision and applies decorations', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')

    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()

    expect(outline.querySelectorAll('[data-inkchapter-number]').length).toBeGreaterThan(0)
    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.snapshotRevision).toBeGreaterThan(0)
    expect(probe.controllerDocumentKey).toBe('doc-a')
    expect(probe.snapshotDocumentKey).toBe('doc-a')
    ctrl.stop()
  })

  it('native childList rebuild (wipe + re-add) re-applies wiped decorations', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames(4)

    // Typora rebuilds the two native wrappers (wiping decorations).
    for (const w of Array.from(outline.querySelectorAll('.outline-item-wrapper'))) w.remove()
    appendNativeItem(outline, '#h1', '第一章')
    appendNativeItem(outline, '#h2', '第二章')
    await nextFrames(8)

    expect(outline.querySelectorAll('[data-inkchapter-number]').length).toBeGreaterThan(0)
    ctrl.stop()
  })

  it('native characterData mutation is observed and schedules reapply', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()

    // Change a text node (characterData) inside the outline — must be observed.
    outline.querySelector('a')!.firstChild!.textContent = '第一章（改）'
    await nextFrames()

    const calls = infoSpy.mock.calls.map(c => String(c[0]))
    expect(calls.some(l => l.includes('NATIVE_TEXT_CHANGED'))).toBe(true)
    infoSpy.mockRestore()
    ctrl.stop()
  })

  it('self mutation (InkChapter decoration attribute) does not loop', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()

    const before = outline.querySelectorAll('[data-inkchapter-number]').length
    // Setting our own decoration attribute must be classified as self-mutation.
    for (const el of outline.querySelectorAll<HTMLElement>('[data-inkchapter-number]')) {
      el.setAttribute('data-inkchapter-number', el.getAttribute('data-inkchapter-number')!)
    }
    await nextFrames()

    expect(outline.querySelectorAll('[data-inkchapter-number]').length).toBe(before)
    ctrl.stop()
  })

  it('empty documentKey snapshot is BLOCKED', async () => {
    makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')

    ctrl.syncAfterRefresh('', headings, labels)
    await nextFrames()

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.snapshotDocumentKey).toBe('')
    expect(probe.snapshotRevision).toBe(0)
    ctrl.stop()
  })

  it('apply binds a real root reference with generation + sameNode=true', async () => {
    makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.rootGeneration).toBeGreaterThan(0)
    expect(probe.boundRootToken).toBeGreaterThan(0)
    expect(probe.sameNode).toBe(true)
    expect(probe.lastApplyTransaction).not.toBeNull()
    expect(probe.lastVerify.decision).toBe('PASS')
    ctrl.stop()
  })

  it('syncAfterRefresh auto-REPAIRs controller=none and produces snapshot', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    // No setDocumentKey — controller is none; sync must auto-REPAIR_BIND.
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.controllerDocumentKey).toBe('doc-a')
    expect(probe.snapshotDocumentKey).toBe('doc-a')
    expect(probe.snapshotRevision).toBeGreaterThan(0)
    expect(outline.querySelectorAll('[data-inkchapter-number]').length).toBeGreaterThan(0)
    ctrl.stop()
  })

  it('stale controller A auto-REBINDs to authoritative B', async () => {
    makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-b', headings, labels)
    await nextFrames()

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.controllerDocumentKey).toBe('doc-b')
    expect(probe.snapshotDocumentKey).toBe('doc-b')
    ctrl.stop()
  })

  it('setDocumentKey same key is NO_OP and does not clear snapshot', () => {
    const ctrl = new OutlineNumberingController()
    expect(ctrl.setDocumentKey('doc-a').decision).toBe('BIND')
    expect(ctrl.setDocumentKey('doc-a').decision).toBe('NO_OP')
    const probe = ctrl.getSyncProbe()
    expect(probe.controllerDocumentKey).toBe('doc-a')
  })

  it('NO_VISIBLE_OUTLINE_ROOT defers (waiting) and keeps latest snapshot', async () => {
    // Sidebar exists but no outline root → findOutlineRoot returns null.
    document.body.innerHTML = ''
    const sidebar = document.createElement('div')
    sidebar.id = 'typora-sidebar'
    document.body.appendChild(sidebar)
    Object.defineProperty(sidebar, 'offsetParent', { get: () => document.body, configurable: true })
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
    const h1 = document.createElement('h2'); h1.id = 'h1'; h1.textContent = '第一章'; write.appendChild(h1)
    const h2 = document.createElement('h2'); h2.id = 'h2'; h2.textContent = '第二章'; write.appendChild(h2)

    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.snapshotRevision).toBeGreaterThan(0)
    expect(probe.waiting).toBe(true)
    expect(probe.pendingDocumentKey).toBe('doc-a')
    ctrl.stop()
  })

  it('root created later wakes the pending snapshot without a new heading refresh', async () => {
    // Visible sidebar + editor headings, but NO outline root yet.
    document.body.innerHTML = ''
    const sidebar = document.createElement('div')
    sidebar.id = 'typora-sidebar'
    document.body.appendChild(sidebar)
    Object.defineProperty(sidebar, 'offsetParent', { get: () => document.body, configurable: true })
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
    const h1 = document.createElement('h2'); h1.id = 'h1'; h1.textContent = '第一章'; write.appendChild(h1)
    const h2 = document.createElement('h2'); h2.id = 'h2'; h2.textContent = '第二章'; write.appendChild(h2)

    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()

    const probeBefore = (window as any).__inkchapter_outline_sync_probe__()
    expect(probeBefore.waiting).toBe(true)
    expect(probeBefore.snapshotRevision).toBeGreaterThan(0)

    // Typora later builds the outline DOM. NO new heading refresh is issued.
    const outline = document.createElement('div')
    outline.id = 'outline-content'
    sidebar.appendChild(outline)
    appendNativeItem(outline, '#h1', '第一章')
    appendNativeItem(outline, '#h2', '第二章')
    Object.defineProperty(outline, 'offsetParent', { get: () => sidebar, configurable: true })

    await nextFrames()

    const probeAfter = (window as any).__inkchapter_outline_sync_probe__()
    expect(probeAfter.waiting).toBe(false)
    expect(outline.querySelectorAll('[data-inkchapter-number]').length).toBeGreaterThan(0)
    expect(probeAfter.lastVerify.decision).toBe('PASS')
    ctrl.stop()
  })

  it('document switch makes the previous pending visible-root wait stale', async () => {
    // Visible sidebar + headings, but NO outline root → doc-a goes DEFER.
    document.body.innerHTML = ''
    const sidebar = document.createElement('div')
    sidebar.id = 'typora-sidebar'
    document.body.appendChild(sidebar)
    Object.defineProperty(sidebar, 'offsetParent', { get: () => document.body, configurable: true })
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
    const h1 = document.createElement('h2'); h1.id = 'h1'; h1.textContent = '第一章'; write.appendChild(h1)
    const h2 = document.createElement('h2'); h2.id = 'h2'; h2.textContent = '第二章'; write.appendChild(h2)

    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()

    const probeA = (window as any).__inkchapter_outline_sync_probe__()
    expect(probeA.waiting).toBe(true)
    expect(probeA.pendingDocumentKey).toBe('doc-a')

    // Switch to document B — the old pending must be cleared/stale.
    ctrl.setDocumentKey('doc-b')

    const probeB = (window as any).__inkchapter_outline_sync_probe__()
    expect(probeB.waiting).toBe(false)
    expect(probeB.pendingDocumentKey).toBe('')
    ctrl.stop()
  })

  it('binds observer to a hidden-but-connected root (no visibility requirement)', () => {
    document.body.innerHTML = ''
    const sidebar = document.createElement('div')
    sidebar.id = 'typora-sidebar'
    document.body.appendChild(sidebar)
    // Sidebar visible, but the outline root itself is connected yet hidden.
    Object.defineProperty(sidebar, 'offsetParent', { get: () => document.body, configurable: true })
    const outline = document.createElement('div')
    outline.id = 'outline-content'
    sidebar.appendChild(outline)
    const a1 = document.createElement('a'); a1.href = '#h1'; a1.textContent = '第一章'; outline.appendChild(a1)
    const a2 = document.createElement('a'); a2.href = '#h2'; a2.textContent = '第二章'; outline.appendChild(a2)
    const write = document.createElement('div'); write.id = 'write'; document.body.appendChild(write)
    const h1 = document.createElement('h2'); h1.id = 'h1'; h1.textContent = '第一章'; write.appendChild(h1)
    const h2 = document.createElement('h2'); h2.id = 'h2'; h2.textContent = '第二章'; write.appendChild(h2)

    const ctrl = new OutlineNumberingController()
    ctrl.start()

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.observer.rootBound).toBe(true)
    expect(probe.observer.observedRootToken).toBeGreaterThanOrEqual(1)
    expect(probe.rootVisible).toBe(false) // hidden root is still bound
    ctrl.stop()
  })

  it('repeated bind to the same root is NO_OP (observerGeneration does not churn)', async () => {
    makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    // Same root throughout → observer bound exactly once.
    expect(probe.observer.observerGeneration).toBe(1)
    expect(probe.observer.observedRootToken).toBeGreaterThanOrEqual(1)
    ctrl.stop()
  })

  // ── v27 Post-Native Stability Closure ──────────────────────────────

  it('native mutation burst coalesces into one post-native apply', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames(4)

    // A burst of native item insertions in one synchronous task. They do NOT
    // match the current headings, so the semantic gate blocks any spurious apply.
    appendNativeItem(outline, '#h3', '第三章')
    appendNativeItem(outline, '#h4', '第四章')
    appendNativeItem(outline, '#h5', '第五章')
    await nextFrames(8)

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.stats.nativeMutationCount).toBeGreaterThanOrEqual(3)
    // Only the initial converged full resync happened; the mismatched burst did
    // not force extra full re-applies (coalesced to 0 because not READY).
    expect(probe.stats.fullResyncBeginCount).toBe(1)
    ctrl.stop()
  })

  it('latest snapshot wins during native dirty (convergence)', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames(4)

    // Native rebuild to 3 items → native becomes dirty.
    appendNativeItem(outline, '#h3', '第三章')
    await nextFrames(1)

    // Two more snapshots arrive while native is dirty → only latest must apply.
    const h3: HeadingDescriptor[] = [...headings, { key: 'h3', level: 2, text: '第三章' }]
    ctrl.syncAfterRefresh('doc-a', h3, ['A、', 'B、', 'C、'])
    ctrl.syncAfterRefresh('doc-a', h3, ['X、', 'Y、', 'Z、'])
    await nextFrames(8)

    const a3 = outline.querySelector<HTMLElement>('a[href="#h3"]')!
    expect(a3.getAttribute('data-inkchapter-number')).toBe('Z、')
    ctrl.stop()
  })

  it('native rebuild after decoration loss repairs and reaches STABLE verify', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames(4)

    // Typora wipes decorations by rebuilding the native wrappers.
    for (const w of Array.from(outline.querySelectorAll('.outline-item-wrapper'))) w.remove()
    appendNativeItem(outline, '#h1', '第一章')
    appendNativeItem(outline, '#h2', '第二章')
    await nextFrames(8)

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(outline.querySelectorAll('[data-inkchapter-number]').length).toBeGreaterThan(0)
    expect(probe.lastVerify.phase).toBe('STABLE')
    expect(probe.stats.stableVerifyFailCount).toBe(0)
    expect(probe.stats.finalDecorationLossCount).toBe(0)
    ctrl.stop()
  })

  it('self decoration attribute mutation does not set nativeDirty', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames(4)

    const epochBefore = (window as any).__inkchapter_outline_sync_probe__().nativeMutationEpoch
    const el = outline.querySelector<HTMLElement>('[data-inkchapter-number]')!
    const original = el.getAttribute('data-inkchapter-number')!
    el.setAttribute('data-inkchapter-number', original + 'x')
    el.setAttribute('data-inkchapter-number', original)
    await nextFrames(3)

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.nativeMutationEpoch).toBe(epochBefore)
    expect(probe.nativeDirty).toBe(false)
    ctrl.stop()
  })

  it('active class mutation does not force structural repair (no native epoch bump)', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames(4)

    const epochBefore = (window as any).__inkchapter_outline_sync_probe__().nativeMutationEpoch
    outline.classList.add('outline-active')
    await nextFrames(3)

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.nativeMutationEpoch).toBe(epochBefore)
    expect(probe.nativeDirty).toBe(false)
    ctrl.stop()
  })

  it('normal native text change does not produce a coverage-gap false FAIL', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames(4)

    outline.querySelector('a')!.firstChild!.textContent = '第一章（改）'
    await nextFrames(8)

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.stats.coverageGapFailCount).toBe(0)
    ctrl.stop()
  })

  // ── v28 Document-Switch Semantic Convergence ──────────────────────

  it('H2→H3 changes the semantic fingerprint', () => {
    const h2 = buildSemanticSequence([{ level: 2, text: '背景' }])
    const h3 = buildSemanticSequence([{ level: 3, text: '背景' }])
    expect(h2).not.toEqual(h3)
  })

  it('duplicate headings are disambiguated by occurrence', () => {
    const seq = buildSemanticSequence([
      { level: 2, text: '背景' },
      { level: 2, text: '背景' },
    ])
    expect(seq).toEqual(['2|背景|1', '2|背景|2'])
  })

  it('same root token across document switch resyncs current document', async () => {
    makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames(4)

    const probeA = (window as any).__inkchapter_outline_sync_probe__()
    expect(probeA.outlineDirty).toBe(false)
    const rootTokenBefore = probeA.boundRootToken

    // Switch to doc-b reusing the SAME DOM root — the matcher re-derives content.
    ctrl.setDocumentKey('doc-b')
    ctrl.syncAfterRefresh('doc-b', headings, labels)
    await nextFrames(4)

    const probeB = (window as any).__inkchapter_outline_sync_probe__()
    expect(probeB.boundRootToken).toBe(rootTokenBefore)
    expect(probeB.snapshotDocumentKey).toBe('doc-b')
    expect(probeB.outlineDirty).toBe(false)
    ctrl.stop()
  })

  it('same root document switch does not disconnect observer', async () => {
    makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames(4)

    const genBefore = (window as any).__inkchapter_outline_sync_probe__().observer.observerGeneration
    ctrl.reinitialize()
    ctrl.setDocumentKey('doc-b')

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.observer.observerGeneration).toBe(genBefore)
    expect(probe.observer.rootBound).toBe(true)
    ctrl.stop()
  })

  it('full resync clears dirty after readiness', async () => {
    makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames(4)

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.outlineDirty).toBe(false)
    expect(probe.outlineDirtyReason).toBe(null)
    expect(probe.lastReadiness.semanticReady).toBe(true)
    ctrl.stop()
  })

  it('native outline not caught up keeps dirty and is not terminal', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames(4)

    // Native outline gains a stale extra item (not caught up).
    appendNativeItem(outline, '#stale', '陈旧标题')
    await nextFrames(10)

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.stats.stableVerifyFailCount).toBe(0)
    expect(probe.lastReadiness.semanticReady).toBe(false)
    expect(probe.outlineDirty).toBe(true)
    ctrl.stop()
  })

  it('semantic fingerprint mismatch does not block full resync (matcher is authority)', async () => {
    const { outline } = makeDom()
    // Force a level difference (h3 vs heading level 2) → matcher still matches by
    // text, but the semantic fingerprint differs. Must NOT block full resync.
    for (const w of Array.from(outline.querySelectorAll('.outline-item-wrapper'))) {
      w.className = 'outline-item-wrapper outline-h3'
    }
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames(4)

    const probe = (window as any).__inkchapter_outline_sync_probe__()
    expect(probe.lastReadiness.semanticReady).toBe(true)
    expect(probe.lastReadiness.fingerprintMismatch).toBe(true)
    expect(probe.stats.semanticDiagnosticMismatchCount).toBeGreaterThan(0)
    expect(probe.outlineDirty).toBe(false)
    expect(outline.querySelectorAll('[data-inkchapter-number]').length).toBeGreaterThan(0)
    ctrl.stop()
  })
})
