// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.9 — Diagnostic Locate Frame V3.1 pixel-closure contract tests.
 *
 * V3 architecture is FROZEN. V3.1 is surgical visual tuning only:
 *   active row wash <= 2%
 *   complex frame background = transparent / radius ~4px / no geometry transition
 *   table & code outer gap ~2px (clamped to unobscured editor)
 *   frame layer below Drawer / Toolbar / Navigator
 *   heading = compact indicator only (no fill, no full-width border)
 *   inline mark <= 4% with bottom severity edge
 *   missing-image fixture produces a diagnostic + owning-block frame carrier
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DiagnosticLocateFrameController, diagnosticLocateFrameGapFor, DIAGNOSTIC_INLINE_MARK_CLASS, DIAGNOSTIC_LOCATE_FRAME_CLASS } from './document-diagnostic-locate-frame'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

// ── helpers ─────────────────────────────────────────────
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
let host: DocumentUtilityOverlayHost | null = null
beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  vi.spyOn(console, 'info').mockImplementation(() => {})
  host = null
})

function makeRect(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

// ── V31-VIS (drawer active row wash) ────────────────────
describe('V31-VIS — active row wash bounded', () => {
  it('V31-VIS-1/2: drawer active row severity wash is 6% (<= .065) with a 2px severity rail', () => {
    const activeBlock = scss.slice(scss.indexOf('.inkchapter-doc-drawer__item.is-selected'))
    // V5.2 — active wash is token-driven (--ink-drawer-active-wash = 6% light).
    expect(activeBlock).toContain('--ink-drawer-active-wash')
    expect(activeBlock).toContain('box-shadow: none')
    // All three severity wash rules use the bounded active-wash token.
    const severityActive = activeBlock.match(/--ink-ui-sev-(?:error|warning|info)[^)]*\) var\(--ink-drawer-active-wash/g) ?? []
    expect(severityActive.length).toBeGreaterThanOrEqual(3)
    expect(activeBlock).not.toContain(') 2%, transparent)')
  })
})

// ── V31-FRAME (CSS weight + geometry) ───────────────────
describe('V31-FRAME — surgical frame visual', () => {
  const frameBlock = (): string => scss.slice(scss.indexOf('.inkchapter-diagnostic-locate-frame {'), scss.indexOf('@media (prefers-reduced-motion'))

  it('V31-FRAME-1: table/code get the bounded context wash; media objects stay transparent', () => {
    const kindsBlock = scss.slice(scss.indexOf(".inkchapter-diagnostic-locate-frame[data-target-kind='table']"))
    // V5.2 — Table/Code SECONDARY context wash comes from the dedicated token.
    expect(kindsBlock).toContain('background: var(--ink-locate-context-bg)')
    expect(kindsBlock).toContain("data-target-kind='code'")
    expect(kindsBlock).toContain("data-target-kind='figure'")
    // V4/V5.2 — no COMPLEX-KIND rule may ever use the legacy context wash as
    // its own background (wash token is retired for object carriers).
    expect(scss).not.toMatch(/data-target-kind='(table|code|figure|formula|blockquote)'[^{}]*\{\s*background: var\(--ink-locate-wash\)/)
    // media objects never get tinted (a real picture stays clean).
    expect(scss).toMatch(/data-target-kind='figure'\],[\s\S]*?data-target-kind='block'\] \{\s*background: transparent;/)
  })

  it('V31-FRAME-2: geometry properties have NO transition (only color fades)', () => {
    const b = frameBlock()
    expect(b).not.toContain('left 120ms')
    expect(b).not.toContain('top 120ms')
    expect(b).not.toContain('width 120ms')
    expect(b).not.toContain('height 120ms')
    expect(b).not.toContain('transform')
    expect(b).toContain('border-color 120ms ease')
    expect(b).toContain('background-color 120ms ease')
  })

  it('frame radius is 4px and V5.3 severity tokens hold Primary > Secondary hierarchy', () => {
    const b = frameBlock()
    expect(b).toContain('border-radius: 4px')
    // V5.3 light: error primary ~20% (18–22), context 11% (10–12), border 78%.
    expect(b).toMatch(/-locate-primary-bg: color-mix\(in srgb, var\(--ink-ui-sev-error[^)]*\) (?:1[89]|2[0-2])%, transparent\)/)
    expect(b).toMatch(/-locate-context-bg: color-mix\(in srgb, var\(--ink-ui-sev-error[^)]*\) 1[0-2]%, transparent\)/)
    expect(b).toMatch(/-locate-border: color-mix\(in srgb, var\(--ink-ui-sev-error[^)]*\) 7[0-9]%, transparent\)/)
    expect(b).toMatch(/-locate-keyline: color-mix\(in srgb, var\(--ink-ui-sev-error[^)]*\) 9[0-6]%, transparent\)/)
    // Fills stay below the hard upper bounds (never a 30–40% block).
    expect(b).not.toMatch(/-locate-primary-bg: color-mix\(in srgb, var\(--ink-ui-sev-(error|warning|info)[^)]*\) (?:3[0-9]|4[0-9])%/)
    expect(b).not.toMatch(/-locate-keyline: color-mix\(in srgb, var\(--ink-ui-sev-(error|warning|info)[^)]*\) (?:9[7-9]|100)%/)
    // PRIMARY_FILL_ALPHA >= SECONDARY_FILL_ALPHA * 1.65 for all light severities.
    const pairs: Array<[string, string, string]> = [
      ['error', '(?:1[89]|2[0-2])', '1[0-2]'],
      ['warning', '(?:19|2[0-2])', '1[1-2]'],
      ['info', '1[4-8]', '(?:9|10)'],
    ]
    for (const [sev, primary, context] of pairs) {
      expect(b).toMatch(new RegExp(`-locate-primary-bg: color-mix\\(in srgb, var\\(--ink-ui-sev-${sev}[^)]*\\) (?:${primary})%, transparent\\)`))
      expect(b).toMatch(new RegExp(`-locate-context-bg: color-mix\\(in srgb, var\\(--ink-ui-sev-${sev}[^)]*\\) (?:${context})%, transparent\\)`))
    }
  })

  it('V31-FRAME-3: table/code frame outer gap is 2px and applied to the overlay rect', () => {
    expect(diagnosticLocateFrameGapFor('table')).toBe(2)
    expect(diagnosticLocateFrameGapFor('code')).toBe(2)
    expect(diagnosticLocateFrameGapFor('heading')).toBe(0)
    const root = document.createElement('div')
    document.body.appendChild(root)
    const ctrl = new DiagnosticLocateFrameController(root)
    const table = document.createElement('table')
    Object.defineProperty(table, 'getBoundingClientRect', { configurable: true, value: () => makeRect(100, 100, 400, 200) })
    document.body.appendChild(table)
    ctrl.commit({ diagnosticId: 'g', severity: 'warning', anchor: table })
    const frame = ctrl.getFrameElement()!
    expect(frame.style.left).toBe('98px')
    expect(frame.style.top).toBe('98px')
    expect(frame.style.width).toBe('304px')
    expect(frame.style.height).toBe('104px')
    ctrl.dispose()
    table.remove()
  })

  it('V31-FRAME-4 (V5.4): inflated frame is NOT clamped to the unobscured clip — semantic geometry stays complete', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const ctrl = new DiagnosticLocateFrameController(root)
    const table = document.createElement('table')
    Object.defineProperty(table, 'getBoundingClientRect', { configurable: true, value: () => makeRect(100, 100, 400, 200) })
    document.body.appendChild(table)
    ctrl.commit({ diagnosticId: 'c', severity: 'warning', anchor: table })
    // Narrower visibility clip (drawer open) must NOT shorten the frame.
    ctrl.reposition({ headless: false, clipRect: makeRect(150, 120, 800, 600) })
    const frame = ctrl.getFrameElement()!
    const f = ctrl.getFrameRect()!
    // V5.4 — right-edge authority is the full semantic target (98+2 gap … 402).
    expect(Math.abs(f.left - 98)).toBeLessThanOrEqual(1)
    expect(Math.abs((f.left + f.width) - 402)).toBeLessThanOrEqual(1)
    const report = ctrl.getGeometryReport()
    expect(report.rightEdgeAuthority).toBe('SEMANTIC_TARGET')
    expect(report.horizontalCoverage).toBeGreaterThanOrEqual(0.98)
    expect(frame.style.display).toBe('block')
    ctrl.dispose()
    table.remove()
  })

  it('V31-FRAME-5: frame sits BELOW toolbar / navigator / drawer in the overlay root', () => {
    const { h } = (() => {
      makeShell()
      const hh = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
      hh.mount()
      host = hh
      return { h: hh }
    })()
    const root = document.querySelector('[data-inkchapter-utility-root="true"]') as HTMLElement
    const write = document.getElementById('write') as HTMLElement
    write.innerHTML = '<table><tr><td>1</td></tr></table>'
    const table = write.querySelector('table') as HTMLElement
    const diag = { id: 'l', severity: 'warning' as const, code: 'TABLE_MISSING_NAME', documentKey: 'doc:key', message: '', detail: '', metadata: {}, location: { kind: 'canonical-node' as const, stableIdentity: 'x' } }
    const tx = { id: 1 } as unknown as { id: number }
    const result = { decision: 'RESOLVED' as const, element: table, scrollAction: null, targetIndex: 0 }
    ;(h as unknown as { applyLocateHighlightAndVerify(t: unknown, d: unknown, targets: HTMLElement[], r: unknown, i: number): boolean }).applyLocateHighlightAndVerify(tx, diag as unknown as never, [table], result, 0)
    const frame = document.querySelector(`.${DIAGNOSTIC_LOCATE_FRAME_CLASS}`) as HTMLElement | null
    expect(frame).toBeTruthy()
    const els = Array.from(root.children)
    const frameIdx = els.indexOf(frame as HTMLElement)
    const toolbarIdx = els.indexOf(document.querySelector('.inkchapter-doc-toolbar') as HTMLElement)
    const navIdx = els.indexOf(document.querySelector('.inkchapter-doc-navigator') as HTMLElement)
    const drawerIdx = els.indexOf(document.querySelector('.inkchapter-doc-drawer') as HTMLElement)
    expect(frameIdx).toBeGreaterThanOrEqual(0)
    expect(frameIdx).toBeLessThan(toolbarIdx)
    expect(frameIdx).toBeLessThan(navIdx)
    expect(frameIdx).toBeLessThan(drawerIdx)
    expect((frame as HTMLElement).style.zIndex).toBe('')
    h.locator.clearHighlight()
  })
})

// ── V31-HEADING ─────────────────────────────────────────
describe('V31-HEADING — text-tight marker only', () => {
  const headRule = (): string => {
    const idx = scss.indexOf(".inkchapter-diagnostic-locate-frame[data-presentation='text-tight-marker']")
    return scss.slice(idx, idx + 260)
  }

  it('V31-HEADING-1/2: no full-width fill and no full-width border', () => {
    const r = headRule()
    expect(r).toContain('border: none')
    expect(r).toContain('background: transparent')
    expect(r).not.toContain('box-shadow')
    // ::before is the ONLY indicator, and its ::before block stays compact
    // (2px, inset 4px) — never a full-height hard edge.
    const beforeIdx = scss.indexOf('.inkchapter-diagnostic-locate-frame::before')
    const before = scss.slice(beforeIdx, beforeIdx + 220)
    expect(before).toContain('width: 2px')
    expect(before).toContain('top: 6px')
    expect(before).toContain('bottom: 6px')
  })
})

// ── V31-INLINE ──────────────────────────────────────────
describe('V31-INLINE — precise mark weight', () => {
  it('V31-INLINE-1/2: severity fill >= 22% warning with a 2px gradient keyline, no box-shadow', () => {
    const mark = scss.slice(scss.indexOf('.inkchapter-diagnostic-inline-mark {'))
    expect(mark).toContain('--ink-locate-inline-bg')
    expect(mark).toContain('background-image: linear-gradient(')
    expect(mark).toContain('2px')
    expect(mark).not.toContain('inset 0 -1px 0')
    expect(mark).not.toContain(') 4%, transparent)')
    expect(mark).toMatch(/data-severity='warning'[\s\S]{0,260}--ink-locate-inline-bg: color-mix\(in srgb, var\(--ink-locate-color\) 2[0-4]%, transparent\)/)
  })
})

// ── V31-LIFECYCLE / SCROLL / DARK ───────────────────────
describe('V31 lifecycle + scroll + dark', () => {
  function mountHost(): { h: DocumentUtilityOverlayHost; write: HTMLElement } {
    makeShell()
    const hh = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
    hh.mount()
    host = hh
    return { h: hh, write: document.getElementById('write') as HTMLElement }
  }
  function commitLocate(h: DocumentUtilityOverlayHost, el: HTMLElement, id: string, severity: 'error' | 'warning' | 'info'): void {
    const tx = { id: 1 } as unknown as { id: number }
    const diag = { id, severity, code: 'X', documentKey: 'doc:key', message: '', detail: '', metadata: {}, location: { kind: 'canonical-node' as const, stableIdentity: 'x' } }
    const result = { decision: 'RESOLVED' as const, element: el, scrollAction: null, targetIndex: 0 }
    ;(h as unknown as { applyLocateHighlightAndVerify(t: unknown, d: unknown, targets: HTMLElement[], r: unknown, i: number): boolean }).applyLocateHighlightAndVerify(tx, diag as unknown as never, [el], result, 0)
    h.locator.clearHighlight()
  }
  const frames = (): number => document.querySelectorAll(`.${DIAGNOSTIC_LOCATE_FRAME_CLASS}`).length

  it('V31-LIFECYCLE-1: A -> B leaves exactly one live frame (and a heading leaves ZERO legacy frames)', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<h2>A</h2><table><tr><td>1</td></tr></table><pre class="md-fences">x</pre>'
    const h2 = write.querySelector('h2') as HTMLElement
    const table = write.querySelector('table') as HTMLElement
    // V5.12-R2 §5 — a HEADING never mounts a legacy block frame.
    commitLocate(h, h2, 'a', 'error')
    expect(frames()).toBe(0)
    expect(h.getLocateFrameStructure().headingMarkerCarrier).toBe(true)
    const pre = write.querySelector('pre') as HTMLElement
    commitLocate(h, table, 'b', 'warning')
    expect(frames()).toBe(1)
    commitLocate(h, pre, 'c', 'warning')
    expect(frames()).toBe(1)
    expect(h.getLocateFrameStructure().activeDiagnosticId).toBe('c')
  })

  it('V31-LIFECYCLE-2: drawer close removes the frame', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<table><tr><td>1</td></tr></table>'
    commitLocate(h, write.querySelector('table') as HTMLElement, 'a', 'warning')
    expect(frames()).toBe(1)
    ;(h as unknown as { closeDrawer(): void }).closeDrawer()
    expect(frames()).toBe(0)
  })

  it('V31-LIFECYCLE-3: document switch removes the frame', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<table><tr><td>1</td></tr></table>'
    commitLocate(h, write.querySelector('table') as HTMLElement, 'a', 'warning')
    expect(frames()).toBe(1)
    h.bindDocument()
    expect(frames()).toBe(0)
  })

  it('V31-SCROLL-1: scroll reposition is exact after the single rAF repaint (V5.5)', async () => {
    const { h, write, } = mountHost()
    const shell = write.parentElement as HTMLElement
    write.innerHTML = '<table><tr><td>1</td></tr></table>'
    const target = write.querySelector('table') as HTMLElement
    const rect = makeRect(100, 200, 400, 240)
    Object.defineProperty(target, 'getBoundingClientRect', { configurable: true, value: () => rect })
    commitLocate(h, target, 's', 'warning')
    const frame = document.querySelector(`.${DIAGNOSTIC_LOCATE_FRAME_CLASS}`) as HTMLElement
    expect(frame.style.top).toBe('198px')
    rect.top = 120
    rect.bottom = 160
    shell.dispatchEvent(new Event('scroll'))
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)))
    expect(frame.style.top).toBe('118px') // exact absolute write, no stale value
  })

  it('V31-DARK-1: dark-mode severity tokens are present at :root', () => {
    const darkIdx = scss.indexOf('prefers-color-scheme: dark')
    expect(darkIdx).toBeGreaterThan(-1)
    const after = scss.slice(darkIdx)
    expect(after).toMatch(/:root\s*\{\s*--ink-ui-sev-error/)
    expect(after).toContain('--ink-ui-sev-warning')
    expect(after).toContain('--ink-ui-sev-info')
  })

  it('V31-INVARIANT: locate commit emits the lightweight visual invariant audit', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<table><tr><td>1</td></tr></table>'
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    commitLocate(h, write.querySelector('table') as HTMLElement, 'i', 'warning')
    const found = infoSpy.mock.calls.some(c => String(c[0]).includes('DOCUMENT-DIAGNOSTIC-LOCATE-VISUAL-INVARIANT'))
    expect(found).toBe(true)
    infoSpy.mockRestore()
  })

  it('R7-contract: zero-rect missing <img> commits the OWNING BLOCK overlay frame (never an img paint)', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<p id="blk">![](missing-assets/__inkchapter_v31_missing_image__.png)</p><img src="missing-assets/__inkchapter_v31_missing_image__.png">'
    const p = write.querySelector('p') as HTMLElement
    const img = write.querySelector('img') as HTMLElement
    // jsdom default BCR is 0x0 → broken image path.
    const tx = { id: 1 } as unknown as { id: number }
    const diag = {
      id: 'img1', severity: 'error' as const, code: 'FIGURE_LOCAL_IMAGE_MISSING',
      documentKey: 'doc:key', message: '', detail: '',
      metadata: { resourceKind: 'image', destination: 'missing-assets/__inkchapter_v31_missing_image__.png' },
      location: { kind: 'block-node' as const, blockKind: 'figure' as const, stableIdentity: 'block:figure:0' },
    }
    const result = { decision: 'RESOLVED' as const, element: img, scrollAction: null, targetIndex: 0 }
    ;(h as unknown as { applyLocateHighlightAndVerify(t: unknown, d: unknown, targets: HTMLElement[], r: unknown, i: number): boolean }).applyLocateHighlightAndVerify(tx, diag as unknown as never, [img], result, 0)
    const frame = document.querySelector(`.${DIAGNOSTIC_LOCATE_FRAME_CLASS}`) as HTMLElement | null
    expect(frame).toBeTruthy()
    // Owning-block overlay frame (paragraph), not the <img>.
    expect(frame!.getAttribute('data-target-kind')).toBe('block')
    expect(h.getLocateFrameStructure().activeDiagnosticId).toBe('img1')
    expect(img.style.background).toBe('')
    expect(p.classList.contains(DIAGNOSTIC_INLINE_MARK_CLASS)).toBe(false)
    h.locator.clearHighlight()
  })
})
