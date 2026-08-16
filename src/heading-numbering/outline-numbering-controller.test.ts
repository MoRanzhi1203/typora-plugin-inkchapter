// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OutlineNumberingController } from './outline-numbering-controller'
import type { HeadingDescriptor } from './heading-types'

function makeDom(): { outline: HTMLElement; items: HTMLElement[] } {
  document.body.innerHTML = ''
  const sidebar = document.createElement('div')
  sidebar.id = 'typora-sidebar'
  document.body.appendChild(sidebar)

  const outline = document.createElement('div')
  outline.id = 'outline-content'
  sidebar.appendChild(outline)

  const a1 = document.createElement('a')
  a1.href = '#h1'
  a1.textContent = '第一章'
  outline.appendChild(a1)
  const a2 = document.createElement('a')
  a2.href = '#h2'
  a2.textContent = '第二章'
  outline.appendChild(a2)

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
  Object.defineProperty(a1, 'offsetParent', { get: () => outline, configurable: true })
  Object.defineProperty(a2, 'offsetParent', { get: () => outline, configurable: true })

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

  it('native childList mutation after Typora wipes decorations re-applies them', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()

    // Typora wipes InkChapter decorations.
    for (const el of outline.querySelectorAll<HTMLElement>('[data-inkchapter-number]')) {
      el.removeAttribute('data-inkchapter-number')
    }
    expect(outline.querySelectorAll('[data-inkchapter-number]').length).toBe(0)

    // Native rebuild: add an outline item (childList mutation) → auto reapply.
    const a3 = document.createElement('a')
    a3.href = '#h3'
    a3.textContent = '第三章'
    outline.appendChild(a3)
    await nextFrames()

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
    const a1 = document.createElement('a'); a1.href = '#h1'; a1.textContent = '第一章'; outline.appendChild(a1)
    const a2 = document.createElement('a'); a2.href = '#h2'; a2.textContent = '第二章'; outline.appendChild(a2)
    Object.defineProperty(outline, 'offsetParent', { get: () => sidebar, configurable: true })
    Object.defineProperty(a1, 'offsetParent', { get: () => outline, configurable: true })
    Object.defineProperty(a2, 'offsetParent', { get: () => outline, configurable: true })

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
})
