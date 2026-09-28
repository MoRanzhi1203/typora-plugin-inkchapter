// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.15 — Diagnostic Locate Visual Contrast V5.2 kill-bugs.
 *
 *   CONTRAST-V52  severity token bands + Primary/Secondary alpha hierarchy
 *   TABLE-V52     table context wash overlay, name-slot PRIMARY fill,
 *                 td/th/tr backgrounds untouched, no shadow/layout shift
 *   CODE-V52      code context wash overlay, pre/code backgrounds untouched
 *   IMAGE-V52     missing-image source-line PRIMARY fill / no broad wash
 *   LINK-V52      missing-link inline fill + inline gate (no false BELOW_PANELS)
 *   DRAWER-V52    active row wash bounded, severity rail, hover neutral
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DiagnosticLocateFrameController, DIAGNOSTIC_LOCATE_FRAME_CLASS, DIAGNOSTIC_LOCATE_CAPTION_CUE_CLASS } from './document-diagnostic-locate-frame'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

function frameRegion(): string {
  const start = scss.indexOf('.inkchapter-diagnostic-locate-frame {')
  const end = scss.indexOf('@media (prefers-color-scheme: dark)', start + 1)
  return scss.slice(start, end)
}

/** Whole locate visual region (light + dark + presentations), for css-shape
 *  assertions that need the presentation/fallback rules. */
function visualRegion(): string {
  const start = scss.indexOf('.inkchapter-diagnostic-locate-frame {')
  const end = scss.indexOf('@media (prefers-reduced-motion: reduce)', start + 1)
  return scss.slice(start, end)
}

function parsePct(line: string): number {
  const m = line.match(/([\d.]+)%/)
  return Number(m?.[1] ?? NaN)
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

function rectStub(el: HTMLElement, r: { left: number; top: number; right: number; bottom: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }),
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
})

// ── CONTRAST-V52 (superseded to V5.3 strong-contrast bands) ─
describe('CONTRAST-V52 — strong-contrast token bands + primary/secondary hierarchy', () => {
  function sevBlock(sev: 'error' | 'warning' | 'info'): { primary: number; context: number; border: number; keyline: number } {
    const b = frameRegion()
    const start = b.indexOf(`[data-severity='${sev}']`)
    expect(start).toBeGreaterThan(-1)
    const chunk = b.slice(start)
    const end = chunk.indexOf('\n}')
    const body = chunk.slice(0, end)
    const read = (name: string): number => {
      const line = body.split('\n').find(l => l.includes(`--ink-locate-${name}:`)) ?? ''
      return parsePct(line)
    }
    return { primary: read('primary-bg'), context: read('context-bg'), border: read('border'), keyline: read('keyline') }
  }

  it('CONTRAST-V52-1/2 (V5.3): Error primary ~20% and Warning primary ~21%', () => {
    const err = sevBlock('error')
    const warn = sevBlock('warning')
    expect(err.primary / 100).toBeGreaterThanOrEqual(0.18)
    expect(err.primary / 100).toBeLessThanOrEqual(0.22)
    expect(warn.primary / 100).toBeGreaterThanOrEqual(0.19)
    expect(warn.primary / 100).toBeLessThanOrEqual(0.22)
    // keyline / border clearly visible
    expect(err.keyline).toBeGreaterThan(90)
    expect(err.border).toBeGreaterThan(70)
    expect(warn.keyline).toBeGreaterThan(90)
    expect(warn.border).toBeGreaterThan(70)
  })

  it('CONTRAST-V52-3 (V5.3): secondary context alpha <= .12', () => {
    for (const sev of ['error', 'warning', 'info'] as const) {
      const ctx = sevBlock(sev).context / 100
      expect(ctx).toBeLessThanOrEqual(0.12)
    }
  })

  it('CONTRAST-V52-4 (V5.3): primary alpha >= secondary alpha * 1.65 (all severities)', () => {
    for (const sev of ['error', 'warning', 'info'] as const) {
      const { primary, context } = sevBlock(sev)
      expect(primary / 100).toBeGreaterThanOrEqual((context / 100) * 1.65)
    }
  })

  it('CONTRAST-V52-5: no editor shadow / glow on the locate frame or inline mark', () => {
    const b = frameRegion()
    expect(b).toContain('box-shadow: none')
    expect(b).not.toMatch(/box-shadow:[^;]*(0px 0px|drop-shadow|blur)/)
    const inline = scss.slice(scss.indexOf('.inkchapter-diagnostic-inline-mark {'), scss.indexOf('/* ── Phase 7R.3.11.8B.6'))
    expect(inline).not.toMatch(/box-shadow:/)
  })

  it('CONTRAST-V52-6: no ::selection override and media-kind frames stay transparent', () => {
    expect(scss).not.toContain('::selection {')
    expect(scss).toMatch(/data-target-kind='figure'\],[\s\S]*?data-target-kind='block'\] \{\s*background: transparent;/)
  })
})

// ── TABLE-V52 / CODE-V52 ────────────────────────────────
describe('TABLE-V52 / CODE-V52 — overlay context wash + untouched descendants', () => {
  function commitObject(kind: 'table' | 'code', withCaption: boolean, sev: 'error' | 'warning' = 'warning') {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const anchor = document.createElement(kind === 'table' ? 'table' : 'pre')
    rectStub(anchor, { left: 200, top: 300, right: 1000, bottom: 500 })
    if (kind === 'code') {
      const code = document.createElement('code')
      code.textContent = 'fn main() {}'
      anchor.appendChild(code)
    } else {
      const tr = document.createElement('tr')
      const td = document.createElement('td')
      td.textContent = '1'
      tr.appendChild(td)
      anchor.appendChild(tr)
    }
    document.body.appendChild(anchor)
    const before = anchor.querySelectorAll('td,th,tr,code').length > 0
      ? Array.from(anchor.querySelectorAll<HTMLElement>('td,th,tr,code')).map(el => el.style.cssText)
      : []
    const ctrl = new DiagnosticLocateFrameController(root)
    ctrl.commit({
      diagnosticId: 'd1',
      severity: sev,
      anchor,
      kind,
      captionHostRect: withCaption ? { left: 200, top: 260, right: 420, bottom: 292, width: 220, height: 32 } : null,
    })
    const frame = root.querySelector(`.${DIAGNOSTIC_LOCATE_FRAME_CLASS}`) as HTMLElement
    return { root, anchor, ctrl, frame, before }
  }

  it('TABLE-V52-1/2: name-slot PRIMARY fill (caption-host marker) + full object context frame', () => {
    const { frame, anchor } = commitObject('table', true)
    expect(frame).toBeTruthy()
    expect(frame.dataset.captionCue).toBe('caption-host')
    const cue = frame.querySelector<HTMLElement>(`.${DIAGNOSTIC_LOCATE_CAPTION_CUE_CLASS}[data-cue-type='caption-host']`)
    expect(cue).toBeTruthy()
    // Primary slot fill is taller than a 2px line (real slot geometry).
    expect(Number(cue!.style.height.replace('px', ''))).toBeGreaterThanOrEqual(12)
    expect(anchor.querySelectorAll('td,th,tr').length).toBeGreaterThan(0)
    // V5.2 — context wash lives on the frame (secondary), never the cells.
    expect(frame.style.background).toBe('')
    expect(anchor.style.background).toBe('')
  })

  it('TABLE-V52-3: td/th/tr computed/inline backgrounds are NEVER mutated by the commit', () => {
    const { anchor, before } = commitObject('table', true)
    const cells = Array.from(anchor.querySelectorAll<HTMLElement>('td,th,tr'))
    expect(cells.length).toBeGreaterThan(0)
    for (const el of cells) {
      expect(el.style.background).toBe('')
      expect(el.style.backgroundColor).toBe('')
    }
    expect(before.every(s => s === '')).toBe(true)
  })

  it('TABLE-V52-4/CODE-V52-4: no layout shift — commit never touches the anchor styles', () => {
    for (const kind of ['table', 'code'] as const) {
      const { anchor } = commitObject(kind, true)
      expect(anchor.style.cssText).toBe('')
      expect(anchor.getAttribute('style')).toBeNull()
      anchor.remove()
    }
  })

  it('CODE-V52-1/2: name-slot PRIMARY fill + pre/code backgrounds untouched', () => {
    const { frame, anchor } = commitObject('code', true)
    const cue = frame.querySelector<HTMLElement>(`.${DIAGNOSTIC_LOCATE_CAPTION_CUE_CLASS}[data-cue-type='caption-host']`)
    expect(cue).toBeTruthy()
    expect(Number(cue!.style.height.replace('px', ''))).toBeGreaterThanOrEqual(12)
    const code = anchor.querySelector('code') as HTMLElement
    expect(code.style.background).toBe('')
    expect(code.style.backgroundColor).toBe('')
    expect(anchor.style.background).toBe('')
  })

  it('CODE-V52-3: no native-selection lookalike — token colour is severity amber/red, never selection blue', () => {
    const b = frameRegion()
    expect(b).toMatch(/--ink-ui-sev-warning/)
    expect(b).toMatch(/--ink-ui-sev-error/)
    // No general-purpose accent/blue as the fill source inside the frame tokens.
    expect(b).not.toMatch(/--ink-locate-primary-bg:[^;]*--ink-ui-accent/)
  })

  it('CODE-V52-5: full context geometry unchanged (frame rect still the semantic box)', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const pre = document.createElement('pre')
    rectStub(pre, { left: 200, top: 300, right: 1000, bottom: 500 })
    document.body.appendChild(pre)
    const ctrl = new DiagnosticLocateFrameController(root)
    ctrl.commit({ diagnosticId: 'c1', severity: 'warning', anchor: pre, kind: 'code' })
    const fr = ctrl.getFrameRect()!
    expect(fr.left).toBe(198) // 2px outer gap unchanged
    expect(fr.top).toBe(298)
    ctrl.dispose()
    pre.remove()
  })
})

// ── IMAGE-V52 ───────────────────────────────────────────
describe('IMAGE-V52 — source-line PRIMARY error fill, no broad wash', () => {
  it('IMAGE-V52-1/4: frame inline-mark uses the ERROR inline fill token (>= .20) and the fallback stays transparent', () => {
    const b = visualRegion()
    const inlineBlock = b.slice(b.indexOf("[data-presentation='inline-mark']"))
    // primary/source-line inline carrier uses the INLINE fill token (V5.3 22%)
    expect(inlineBlock).toContain('var(--ink-locate-inline-bg)')
    // no broad paragraph wash: the fallback-level-2 owning-block corner is transparent
    expect(scss).toMatch(/inline-mark'\]\[data-fallback-level='2'\] \{[\s\S]{0,120}background: transparent/)
    const errStart = b.indexOf(`[data-severity='error']`)
    const err = b.slice(errStart)
    const errEnd = err.indexOf('\n}')
    const errBody = err.slice(0, errEnd)
    const line = errBody.split('\n').find(l => l.includes('--ink-locate-inline-bg:')) ?? ''
    expect(parsePct(line) / 100).toBeGreaterThanOrEqual(0.20)
  })

  it('IMAGE-V52-2/3: occurrence 0/1 identity path unchanged — geometry is per-sourceRange, no JS re-write', () => {
    // Source-First + occurrence 0/1 live in frozen resolver code; the visual
    // layer only consumes resolved geometry. Assert the inline carrier never
    // paints outside its measured rect (no full-width fallback for L0/L1).
    const b = visualRegion()
    expect(b).not.toMatch(/inline-mark'\] \{[\s\S]{0,80}width: 100%/)
  })
})

// ── LINK-V52 ────────────────────────────────────────────
describe('LINK-V52 — inline warning fill + no false BELOW_PANELS', () => {
  function mountHostWithAnchor(): { h: DocumentUtilityOverlayHost; anchor: HTMLElement } {
    const write = document.createElement('div')
    write.id = 'write'
    write.innerHTML = '<p><a id="lnk">指向缺失文件的链接</a></p>'
    document.body.appendChild(write)
    const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
    h.mount()
    h.bindDocument()
    return { h, anchor: write.querySelector('#lnk') as HTMLElement }
  }

  it('LINK-V52-1/2: inline warning fill >= .12 with a 2px lower keyline', () => {
    const inline = scss.slice(scss.indexOf('.inkchapter-diagnostic-inline-mark {'), scss.indexOf('/* ── Phase 7R.3.11.8B.6'))
    const warnBlock = inline.slice(inline.indexOf("[data-severity='warning']"))
    const warnEnd = warnBlock.indexOf('\n}')
    const body = warnBlock.slice(0, warnEnd)
    const bg = body.split('\n').find(l => l.includes('--ink-locate-inline-bg:')) ?? ''
    expect(parsePct(bg) / 100).toBeGreaterThanOrEqual(0.12)
    expect(inline).toContain('2px')
    expect(inline).not.toContain('box-shadow:')
  })

  it('LINK-V52-3/4: a committed inline marker is not gated by frame presentation — the VISUAL-INVARIANT passes', () => {
    const { h, anchor } = mountHostWithAnchor()
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const tx = { id: 1 } as unknown as { id: number }
    const diag = {
      id: 'lnk1', severity: 'warning' as const, code: 'LINK_LOCAL_TARGET_MISSING',
      documentKey: 'doc:key', message: '', detail: '',
      metadata: { resourceKind: 'link', destination: 'missing-assets/generic-locator-link.txt' },
      location: { kind: 'inline-node' as const, nodeIndex: 0 },
    }
    const result = { decision: 'RESOLVED' as const, element: anchor, scrollAction: null, targetIndex: 0 }
    ;(h as unknown as { applyLocateHighlightAndVerify(t: unknown, d: unknown, targets: HTMLElement[], r: unknown, i: number): boolean }).applyLocateHighlightAndVerify(tx, diag as unknown as never, [anchor], result, 0)
    expect(anchor.classList.contains('inkchapter-diagnostic-inline-mark')).toBe(true)
    expect(h.getLocateFrameStructure().inlineMarkCount).toBe(1)
    const found = infoSpy.mock.calls.some(c => {
      const s = String(c[0])
      return s.includes('DOCUMENT-DIAGNOSTIC-LOCATE-VISUAL-INVARIANT') && s.includes('decision=PASS')
    })
    expect(found).toBe(true)
    infoSpy.mockRestore()
    h.dispose()
  })
})

// ── DRAWER-V52 ──────────────────────────────────────────
describe('DRAWER-V52 — active row moderate + severity rail', () => {
  it('DRAWER-V52-1 (V5.3): error/warning active 9%, info 7% (<= .10) and below the document Secondary fill', () => {
    // Authoritative severity wash block is token-driven with per-severity wash.
    expect(scss).toContain('--ink-drawer-active-wash: 9%')
    expect(scss).toContain('--ink-drawer-active-wash: 7%')
    const block = scss.slice(scss.indexOf('.inkchapter-doc-drawer__item--error.is-selected,'), scss.indexOf('.inkchapter-doc-drawer__item.is-busy'))
    const sevActive = block.match(/--ink-ui-sev-(?:error|warning|info)[^)]*\) var\(--ink-drawer-active-wash/g) ?? []
    expect(sevActive.length).toBeGreaterThanOrEqual(3)
    expect(block).not.toContain(') 2%, transparent)')
  })

  it('DRAWER-V52-2: hover stays neutral gray', () => {
    // Authoritative row block: hover uses --ink-ui-bg-hover, never severity.
    const hover = scss.slice(scss.indexOf('.inkchapter-doc-drawer__item:focus-visible'), scss.indexOf('.inkchapter-doc-drawer__item.is-busy'))
    expect(hover).toContain('--ink-ui-bg-hover')
    expect(hover).not.toContain('--ink-ui-sev-')
  })

  it('DRAWER-V52-3: selected row has a 2px inset severity rail (::before) and no box-shadow', () => {
    const rail = scss.slice(scss.indexOf('.inkchapter-doc-drawer__item.is-selected'))
    expect(rail).toContain('width: 2px')
    expect(rail).toContain('box-shadow: none')
    expect(rail).toMatch(/inkchapter-doc-drawer__item--(?:error|warning|info)\.is-selected::before/)
  })

  it('DRAWER-V52-4: V5.1 recovery authority is untouched by the visual change', () => {
    const hostSource = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(hostSource).toContain('releaseDrawerRecoveryLease')
    expect(hostSource).toContain('resolveProblemsControlAction')
    expect(hostSource).toContain('canPerformLayoutRecovery')
  })
})
