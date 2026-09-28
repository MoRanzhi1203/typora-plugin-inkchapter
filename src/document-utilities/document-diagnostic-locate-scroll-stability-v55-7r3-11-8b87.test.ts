// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.18 — Diagnostic Locate Scroll Coordinate Stability V5.5.
 *
 *   DRIFT-V55     absolute fresh remeasure keeps frame↔target offset <=1px
 *   RAF-V55       30 scroll events in one frame → exactly 1 scheduled rAF
 *   COORDS-V55    single viewport→host conversion, no scroll accumulation
 *   GATES-V55     scroll counters stay 0 + V5.4 right-edge untouched
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DiagnosticLocateFrameController } from './document-diagnostic-locate-frame'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

// ── rAF stub: a proper queued scheduler (id semantics like the browser) ─────
let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1
function stubRaf(): void {
  rafTasks = new Map()
  rafSeq = 1
  const raf = (cb: FrameRequestCallback): number => {
    const id = rafSeq++
    rafTasks.set(id, cb)
    return id
  }
  const caf = (id: number): void => {
    rafTasks.delete(id)
  }
  ;(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = raf
  ;(globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = caf
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

function rectStub(el: HTMLElement, getRect: () => { left: number; top: number; right: number; bottom: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const r = getRect()
      return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }
    },
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  stubRaf()
})

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

function mountHost(): { h: DocumentUtilityOverlayHost; write: HTMLElement; shell: HTMLElement } {
  const shell = makeShell()
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
  h.mount()
  host = h
  return { h, write: document.getElementById('write') as HTMLElement, shell }
}
function commitTable(h: DocumentUtilityOverlayHost, write: HTMLElement, id = 't'): void {
  const tx = { id: 1 } as unknown as { id: number }
  const diag = { id, severity: 'warning' as const, code: 'X', documentKey: 'doc:key', message: '', detail: '', metadata: {}, location: { kind: 'canonical-node' as const, stableIdentity: 'x' } }
  const el = write.querySelector('table') as HTMLElement
  const result = { decision: 'RESOLVED' as const, element: el, scrollAction: null, targetIndex: 0 }
  ;(h as unknown as { applyLocateHighlightAndVerify(t: unknown, d: unknown, targets: HTMLElement[], r: unknown, i: number): boolean }).applyLocateHighlightAndVerify(tx, diag as unknown as never, [el], result, 0)
  h.locator.clearHighlight()
}
let host: DocumentUtilityOverlayHost | null = null

// ── DRIFT-V55 (pure frame controller — absolute fresh remeasure) ───────────
describe('DRIFT-V55 — absolute fresh remeasure (no accumulation)', () => {
  function makeController(root: HTMLElement) {
    const table = document.createElement('table')
    const td = document.createElement('td')
    td.textContent = 'x'
    table.appendChild(td)
    document.body.appendChild(table)
    const rect = { left: 200, top: 500, right: 900, bottom: 700 }
    rectStub(table, () => rect)
    const ctrl = new DiagnosticLocateFrameController(root)
    ctrl.commit({ diagnosticId: 'd', severity: 'warning', anchor: table, kind: 'table' })
    const reposition = (): void => { ctrl.reposition({ headless: false }) }
    reposition()
    return { ctrl, table, rect, reposition }
  }

  it('single 100px scroll: style top moves exactly -100 and the report drift stays <= 1', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { ctrl, table, rect, reposition } = makeController(root)
    const frame = ctrl.getFrameElement()!
    const topBefore = Number.parseFloat(frame.style.top)
    rect.top -= 100
    rect.bottom -= 100
    reposition()
    const rep = ctrl.getLastScrollStabilityReport()!
    expect(Math.abs(Number.parseFloat(frame.style.top) - (topBefore - 100))).toBeLessThanOrEqual(1)
    expect(rep.drift!).toBeLessThanOrEqual(1)
    rect.top -= 100
    rect.bottom -= 100
    reposition()
    const rep2 = ctrl.getLastScrollStabilityReport()!
    expect(rep2.drift!).toBeLessThanOrEqual(1)
    ctrl.dispose(); table.remove(); root.remove()
  })

  it('20×10px then round-trip 300px never accumulates drift', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { ctrl, table, rect, reposition } = makeController(root)
    const frame = ctrl.getFrameElement()!
    const startTop = Number.parseFloat(frame.style.top)
    for (let i = 0; i < 20; i++) {
      rect.top -= 10
      rect.bottom -= 10
      reposition()
    }
    const afterSmall = Number.parseFloat(frame.style.top)
    expect(Math.abs(afterSmall - (startTop - 200))).toBeLessThanOrEqual(1)
    rect.top -= 300
    rect.bottom -= 300
    reposition()
    rect.top += 300
    rect.bottom += 300
    reposition()
    // round-trip returns to the pre-round-trip state (after the 20 smalls).
    expect(Math.abs(Number.parseFloat(frame.style.top) - (startTop - 200))).toBeLessThanOrEqual(1)
    ctrl.dispose(); table.remove(); root.remove()
  })
})

// ── COORDS-V55 ──────────────────────────────────────────
describe('COORDS-V55 — single viewport→host conversion, absolute local writes', () => {
  it('fixed host at top 40: scroll -100 ⇒ local style top also moves -100; round-trip returns', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    rectStub(root, () => ({ left: 0, top: 40, right: 1000, bottom: 700 }))
    const table = document.createElement('table')
    const td = document.createElement('td')
    td.textContent = 'x'
    table.appendChild(td)
    document.body.appendChild(table)
    const rect = { left: 200, top: 500, right: 900, bottom: 700 }
    rectStub(table, () => rect)
    const ctrl = new DiagnosticLocateFrameController(root)
    ctrl.commit({ diagnosticId: 'c', severity: 'warning', anchor: table, kind: 'table' })
    const reposition = (): void => { ctrl.reposition({ headless: false }) }
    reposition()
    const frame = ctrl.getFrameElement()!
    const before = Number.parseFloat(frame.style.top) // present.top(498) - hostTop(40) = 458
    expect(before).toBeCloseTo(458, 0)
    rect.top -= 100
    rect.bottom -= 100
    reposition()
    const after = Number.parseFloat(frame.style.top)
    expect(after).toBeCloseTo(358, 0)
    rect.top += 100
    rect.bottom += 100
    reposition()
    expect(Number.parseFloat(frame.style.top)).toBeCloseTo(458, 0)
    ctrl.dispose(); table.remove(); root.remove()
  })
})

// ── RAF-V55 ─────────────────────────────────────────────
describe('RAF-V55 — one rAF per frame, 30 events coalesced', () => {
  it('30 scroll events schedule exactly ONE reposition rAF', async () => {
    const { h, write } = mountHost()
    write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = write.querySelector('table') as HTMLElement
    const rect = { left: 200, top: 300, right: 900, bottom: 500 }
    rectStub(table, () => rect)
    commitTable(h, write, 'q')
    const frame = document.querySelector('.inkchapter-diagnostic-locate-frame') as HTMLElement
    expect(frame).toBeTruthy()
    await flushRaf() // drain any mount-time rAF so the count below is scroll-only
    const topBefore = Number.parseFloat(frame.style.top)
    rect.top -= 200
    rect.bottom -= 200
    // Drive the scroll scheduler twice in the SAME frame: the coalescing guard
    // must keep exactly ONE rAF pending (independent of other system listeners).
    const hostAny = h as unknown as { onEditorScrollForLocateFrame(): void }
    for (let i = 0; i < 30; i++) hostAny.onEditorScrollForLocateFrame()
    expect(rafTasks.size).toBe(1) // exactly one scheduled rAF
    await flushRaf()
    expect(Math.abs(Number.parseFloat(frame.style.top) - (topBefore - 200))).toBeLessThanOrEqual(1)
    // a second burst re-arms only one rAF
    for (let i = 0; i < 5; i++) hostAny.onEditorScrollForLocateFrame()
    expect(rafTasks.size).toBe(1)
    await flushRaf()
  })
})

// ── GATES-V55 ───────────────────────────────────────────
describe('GATES-V55 — hard counters + V5.4 right edge regression', () => {
  it('scroll counters remain 0 and geometry right edge is untouched after scroll', async () => {
    const { h, write, shell } = mountHost()
    write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = write.querySelector('table') as HTMLElement
    const rect = { left: 200, top: 300, right: 900, bottom: 500 }
    rectStub(table, () => rect)
    commitTable(h, write, 'g')
    await flushRaf() // drain mount-time tasks before scrolling
    rect.top -= 200
    rect.bottom -= 200
    for (let i = 0; i < 3; i++) shell.dispatchEvent(new Event('scroll'))
    await flushRaf()
    const counters = h.getScrollStabilityCounters()
    for (const key of Object.keys(counters)) expect(counters[key]).toBe(0)
    expect(h.getLocateGeometryCounters().frameRightClampedToDrawer).toBe(0)
    expect(h.getLocateGeometryCounters().committedTruncatedBlock).toBe(0)
    expect(h.getLocateGeometryCounters().blockCoverageLt098).toBe(0)
  })

  it('production source keeps the V5.5 contract (scheduler + no delta mutation + audit)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(src).toContain('locateScrollRafHandle')
    expect(src).toContain('DOCUMENT-DIAGNOSTIC-LOCATE-SCROLL-STABILITY-AUDIT')
    const frameSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-diagnostic-locate-frame.ts'), 'utf8')
    expect(frameSrc).toContain('getLastScrollStabilityReport')
    // absolute local write, never `top += delta`
    expect(frameSrc).toContain('frame.style.top = `${Math.round(present.top - hostT)}px`')
    expect(frameSrc).not.toMatch(/style\.top\s*\+=\s*/)
    expect(frameSrc).not.toMatch(/style\.top\s*-=\s*/)
  })
})
