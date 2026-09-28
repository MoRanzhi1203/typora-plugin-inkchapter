// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.19 — Diagnostic Locate Interaction Lifecycle V5.6.
 *
 *   DISMISS-V56   left pointer on editor surface dismisses the VISUAL only
 *   NODISMISS-V56 right/middle/wheel never dismiss; Drawer/selection preserved
 *   RACE-V56      pending rAF/tx cannot repaint or late-commit after dismiss
 *   RELOCATE-V56  same diagnostic re-locates after dismiss; switch clears A
 *   SCROLL-V56    scroll stability gates keep 0 (V5.5 regression)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DIAGNOSTIC_LOCATE_FRAME_CLASS } from './document-diagnostic-locate-frame'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

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
  while (rafTasks.size > 0) {
    const cur = Array.from(rafTasks.values())
    rafTasks.clear()
    for (const cb of cur) cb(0)
    await Promise.resolve()
  }
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
    getHeadingIdentity: () => null,
    parseLocalLinkTargets: () => [],
  }
}

function makeShell(): HTMLElement {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  Object.defineProperty(shell, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top: 0, right: 800, bottom: 600, left: 0, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }),
  })
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  return shell
}

function mount(): { h: DocumentUtilityOverlayHost; write: HTMLElement; shell: HTMLElement } {
  const shell = makeShell()
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
  h.mount()
  return { h, write: document.getElementById('write') as HTMLElement, shell }
}
function rectStub(el: HTMLElement, getRect: () => { left: number; top: number; right: number; bottom: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}
function commitTable(h: DocumentUtilityOverlayHost, write: HTMLElement, id: string): void {
  const tx = { id: 1 } as unknown as { id: number }
  const diag = { id, severity: 'warning' as const, code: 'X', documentKey: 'doc:key', message: '', detail: '', metadata: {}, location: { kind: 'canonical-node' as const, stableIdentity: 'x' } }
  const el = write.querySelector('table') as HTMLElement
  const result = { decision: 'RESOLVED' as const, element: el, scrollAction: null, targetIndex: 0 }
  ;(h as unknown as { applyLocateHighlightAndVerify(t: unknown, d: unknown, targets: HTMLElement[], r: unknown, i: number): boolean }).applyLocateHighlightAndVerify(tx, diag as unknown as never, [el], result, 0)
  h.locator.clearHighlight()
}
const frames = (): number => document.querySelectorAll(`.${DIAGNOSTIC_LOCATE_FRAME_CLASS}`).length
function pointer(el: EventTarget, button: number, type = 'mouse'): void {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button, pointerType: type, cancelable: true }))
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
})

function seedTable(write: HTMLElement): HTMLElement {
  write.innerHTML = '<p>正文</p><table><tr><td>x</td></tr></table>'
  const table = write.querySelector('table') as HTMLElement
  rectStub(table, () => ({ left: 200, top: 300, right: 900, bottom: 500 }))
  return table
}

// ── DISMISS-V56 ─────────────────────────────────────────
describe('DISMISS-V56 — left pointer on the editor surface dismisses the visual only', () => {
  it('DISMISS-V56-1/2: paragraph + blank surface dismiss; selection + drawer preserved', async () => {
    const { h, write, shell } = mount()
    seedTable(write)
    commitTable(h, write, 'A')
    expect(frames()).toBe(1)
    const selectedBefore = h.getLastLocatedDiagnosticId()
    const paragraph = write.querySelector('p') as HTMLElement
    pointer(paragraph, 0)
    expect(frames()).toBe(0)
    expect(h.getLastLocatedDiagnosticId()).toBe(selectedBefore) // selection preserved
    // blank surface (shell whitespace) also dismisses
    commitTable(h, write, 'A')
    expect(frames()).toBe(1)
    pointer(shell, 0)
    expect(frames()).toBe(0)
    expect(h.getLastLocatedDiagnosticId()).toBe(selectedBefore)
    const counters = h.getInteractionCounters()
    for (const key of Object.keys(counters)) expect(counters[key]).toBe(0)
  })

  it('clicking a sibling (non-editor) surface never dismisses the visual', () => {
    const { h, write } = mount()
    seedTable(write)
    commitTable(h, write, 'A')
    expect(frames()).toBe(1)
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    pointer(outside, 0)
    expect(frames()).toBe(1)
    outside.remove()
  })
})

// ── NODISMISS-V56 ───────────────────────────────────────
describe('NODISMISS-V56 — right/middle/wheel never dismiss', () => {
  it('right and middle pointerdown keep the visual', () => {
    const { h, write } = mount()
    seedTable(write)
    commitTable(h, write, 'A')
    expect(frames()).toBe(1)
    pointer(write, 2) // right
    expect(frames()).toBe(1)
    pointer(write, 1) // middle
    expect(frames()).toBe(1)
    // wheel is not a pointerdown — plain wheel event must not dismiss either.
    write.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    expect(frames()).toBe(1)
  })

  it('non-mouse pointer types never dismiss', () => {
    const { h, write } = mount()
    seedTable(write)
    commitTable(h, write, 'A')
    expect(frames()).toBe(1)
    pointer(write, 0, 'touch')
    expect(frames()).toBe(1)
  })
})

// ── RACE-V56 ────────────────────────────────────────────
describe('RACE-V56 — no reappear / no late commit after dismiss', () => {
  it('pending scroll rAF is cancelled: flush after dismiss leaves no visual', async () => {
    const { h, write, shell } = mount()
    seedTable(write)
    commitTable(h, write, 'A')
    expect(frames()).toBe(1)
    await flushRaf() // drain mount-time rafs
    const anyH = h as unknown as { onEditorScrollForLocateFrame(): void }
    anyH.onEditorScrollForLocateFrame() // queue one repaint
    expect(rafTasks.size).toBe(1)
    pointer(write, 0) // dismiss BEFORE the rAF runs
    expect(frames()).toBe(0)
    expect(rafTasks.size).toBe(0) // pending rAF was cancelled
    await flushRaf()
    expect(frames()).toBe(0) // and a queued stale rAF would be a no-op anyway
  })

  it('pending transaction is invalidated by the dismiss (reason USER_DOCUMENT_POINTER_DISMISS)', () => {
    const { h, write } = mount()
    seedTable(write)
    commitTable(h, write, 'A')
    expect(frames()).toBe(1)
    const counters = h.getInteractionCounters()
    expect(counters.lateCommit).toBe(0)
    expect(counters.danglingTx).toBe(0)
  })
})

// ── RELOCATE-V56 ────────────────────────────────────────
describe('RELOCATE-V56 — re-locate after dismiss and diagnostic switch', () => {
  it('same diagnostic re-locates normally after a document dismiss', () => {
    const { h, write } = mount()
    seedTable(write)
    commitTable(h, write, 'A')
    expect(frames()).toBe(1)
    pointer(write, 0)
    expect(frames()).toBe(0)
    commitTable(h, write, 'A')
    expect(frames()).toBe(1)
    expect(h.getLocateFrameStructure().duplicateLocateFrame).toBe(false)
  })

  it('switching A→B leaves exactly one fresh carrier (no stale A)', () => {
    const { h, write } = mount()
    seedTable(write)
    commitTable(h, write, 'A')
    expect(frames()).toBe(1)
    commitTable(h, write, 'B')
    expect(frames()).toBe(1)
    expect(h.getLocateFrameStructure().staleLocateFrameCount).toBe(0)
    expect(h.getLocateFrameStructure().duplicateLocateFrame).toBe(false)
  })
})

// ── SCROLL-V56 / CSS ────────────────────────────────────
describe('SCROLL-V56 — scroll gates stay 0; overlay is pointer-transparent', () => {
  it('scroll stability counters remain zero after scroll + dismiss', async () => {
    const { h, write, shell } = mount()
    seedTable(write)
    commitTable(h, write, 'A')
    await flushRaf()
    const anyH = h as unknown as { onEditorScrollForLocateFrame(): void }
    anyH.onEditorScrollForLocateFrame()
    await flushRaf()
    pointer(write, 0)
    const scrollCounters = h.getScrollStabilityCounters()
    for (const key of Object.keys(scrollCounters)) expect(scrollCounters[key]).toBe(0)
    expect(h.getInteractionCounters().scrollRepaintAfterDismiss).toBe(0)
  })

  it('CSS: frame + inline carriers are pointer-events:none', () => {
    const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
    expect(scss).toMatch(/\.inkchapter-diagnostic-locate-frame \{[\s\S]{0,600}pointer-events:\s*none;/)
    expect(scss).toMatch(/\.inkchapter-diagnostic-inline-mark \{[\s\S]{0,400}pointer-events:\s*none;/)
  })

  it('dismiss audit is emitted on a real dismiss', () => {
    const { h, write } = mount()
    seedTable(write)
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    commitTable(h, write, 'A')
    pointer(write, 0)
    const found = spy.mock.calls.some(c => String(c[0]).includes('DOCUMENT-DIAGNOSTIC-LOCATE-VISUAL-DISMISS-AUDIT'))
    expect(found).toBe(true)
    spy.mockRestore()
  })
})
