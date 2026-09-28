// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.20 — Diagnostic Locate Scroll Visual Topology V5.7.
 *
 *   TOPO-V57    pure scroll freezes the CommittedLocateVisualTopology
 *   SIZE-V57    pure scroll cannot adopt a grown/derived block height
 *   KILL-V57    full-frame→open-right flip on scroll is FAIL + frozen
 *   AUDIT-V57   scroll audit carries presentation/expected/painted + gates 0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DiagnosticLocateFrameController } from './document-diagnostic-locate-frame'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'

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

function rectStub(el: HTMLElement, getRect: () => { left: number; top: number; right: number; bottom: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
})

function makeCtrl(): { ctrl: DiagnosticLocateFrameController; table: HTMLElement; rect: { left: number; top: number; right: number; bottom: number }; root: HTMLElement } {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const table = document.createElement('table')
  const td = document.createElement('td')
  td.textContent = 'x'
  table.appendChild(td)
  document.body.appendChild(table)
  const rect = { left: 200, top: 500, right: 900, bottom: 700 }
  rectStub(table, () => rect)
  const ctrl = new DiagnosticLocateFrameController(root)
  ctrl.commit({ diagnosticId: 't', severity: 'warning', anchor: table, kind: 'table' })
  return { ctrl, table, rect, root }
}
const frameOf = (ctrl: DiagnosticLocateFrameController): HTMLElement => ctrl.getFrameElement() as HTMLElement

describe('KILL-V57 / TOPO-V57 — pure scroll never re-derives presentation', () => {
  it('KILL-V57-1: scroll with an occluding drawerRect cannot flip full-frame → open-right-frame', () => {
    const { ctrl, root, table } = makeCtrl()
    const frame = frameOf(ctrl)
    expect(frame.dataset.presentation).toBe('full-frame')
    const drawerLeft = 650
    const clip = { left: 0, top: 0, right: drawerLeft, bottom: 1200, width: drawerLeft, height: 1200 }
    const drawer = { left: drawerLeft, top: 0, right: 900, bottom: 1200, width: 250, height: 1200 }
    // Pre-V5.7 this pure scroll repaint re-derived open-right-frame.
    ctrl.reposition({ clipRect: clip, drawerRect: drawer, scroll: true })
    expect(frame.dataset.presentation).toBe('full-frame') // frozen topology
    // A real (non-scroll) occlusion change still legitimately updates it:
    ctrl.reposition({ clipRect: clip, drawerRect: drawer, scroll: false })
    expect(frame.dataset.presentation).toBe('open-right-frame')
    ctrl.dispose(); table.remove(); root.remove()
  })

  it('TOPO-V57-1: repeated pure-scroll repaints keep dataset.presentation and width stable', () => {
    const { ctrl, table, rect, root } = makeCtrl()
    const frame = frameOf(ctrl)
    const width0 = frame.style.width
    for (let i = 0; i < 5; i++) {
      rect.top -= 100
      rect.bottom -= 100
      ctrl.reposition({ scroll: true })
    }
    expect(frame.dataset.presentation).toBe('full-frame')
    expect(frame.style.width).toBe(width0)
    expect(Number.parseFloat(frame.style.top)).toBeLessThan(500)
    ctrl.dispose(); table.remove(); root.remove()
  })
})

describe('SIZE-V57 — pure scroll cannot adopt a grown/derived block size', () => {
  it('SIZE-V57-1: anchor height +100 during scroll is NOT adopted; non-scroll remeasure is', () => {
    const { ctrl, table, rect, root } = makeCtrl()
    const frame = frameOf(ctrl)
    const height0 = Number.parseFloat(frame.style.height)
    // The live table grew by 100px while the user scrolls.
    rect.bottom += 100
    ctrl.reposition({ scroll: true })
    expect(Number.parseFloat(frame.style.height)).toBe(height0) // frozen committed height
    // A genuine non-scroll remeasure (recovery / resize) may adopt it.
    ctrl.reposition({ scroll: false })
    expect(Number.parseFloat(frame.style.height)).toBeGreaterThan(height0)
    ctrl.dispose(); table.remove(); root.remove()
  })
})

describe('AUDIT-V57 — scroll audit carries topology + six-edge data, gates stay 0', () => {
  function fakeContext(): DocumentUtilitiesContext {
    return {
      authority: {
        getActiveFilePath: () => '/vault/doc.md',
        getDocumentKey: () => 'doc:key',
        getMarkdown: () => '# t\n\nbody',
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
  it('AUDIT-V57-1: scroll path passes scroll:true; topology/size counters remain 0', async () => {
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
    const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
    h.mount()
    write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = write.querySelector('table') as HTMLElement
    rectStub(table, () => ({ left: 200, top: 300, right: 900, bottom: 500 }))
    const tx = { id: 1 } as unknown as { id: number }
    const diag = { id: 'A', severity: 'warning' as const, code: 'X', documentKey: 'doc:key', message: '', detail: '', metadata: {}, location: { kind: 'canonical-node' as const, stableIdentity: 'x' } }
    const result = { decision: 'RESOLVED' as const, element: table, scrollAction: null, targetIndex: 0 }
    ;(h as unknown as { applyLocateHighlightAndVerify(t: unknown, d: unknown, targets: HTMLElement[], r: unknown, i: number): boolean }).applyLocateHighlightAndVerify(tx, diag as unknown as never, [table], result, 0)
    h.locator.clearHighlight()
    await flushRaf()
    const anyH = h as unknown as { onEditorScrollForLocateFrame(): void }
    anyH.onEditorScrollForLocateFrame()
    await flushRaf()
    const counters = h.getScrollStabilityCounters()
    for (const key of Object.keys(counters)) expect(counters[key]).toBe(0)
  })

  it('AUDIT-V57-2: production source keeps the frozen-topology scroll contract', () => {
    const frameSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-diagnostic-locate-frame.ts'), 'utf8')
    expect(frameSrc).toContain('scroll?: boolean')
    expect(frameSrc).toContain('PURE SCROLL')
    expect(frameSrc).toContain('committedPaint')
    const hostSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(hostSrc).toContain('presentationKindChange')
    expect(hostSrc).toContain('expectedPaintedLeftGt2')
    expect(hostSrc).toContain('repositionSelfWake')
  })
})
