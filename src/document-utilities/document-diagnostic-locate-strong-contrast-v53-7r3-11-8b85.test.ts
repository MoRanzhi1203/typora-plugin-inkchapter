// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.16 — Diagnostic Locate Strong Contrast V5.3 kill-bugs.
 *
 *   CONTRAST-V53  strong light/dark token bands + 1.65 hierarchy
 *   IMAGE-V53     error exact/source-line ~22% inline fill; fallback stays clean
 *   LINK-V53      warning inline ~22% + 2px keyline; gate/native selection kept
 *   TABLE-V53     table name-slot PRIMARY (21%) > context (12%); cells untouched
 *   CODE-V53      code name-slot PRIMARY (21%) > context (12%); pre/code untouched
 *   HEADING-V53   marker/corner only; no full-width fill/border; text-tight <=6%
 *   DRAWER-V53    error/warning active 9%, info 7%, hover neutral, rail intact
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DiagnosticLocateFrameController, DIAGNOSTIC_LOCATE_FRAME_CLASS, DIAGNOSTIC_LOCATE_CAPTION_CUE_CLASS } from './document-diagnostic-locate-frame'

const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

function visualRegion(): string {
  const start = scss.indexOf('.inkchapter-diagnostic-locate-frame {')
  const end = scss.indexOf('@media (prefers-reduced-motion: reduce)', start + 1)
  return scss.slice(start, end)
}

/** Light severity block (first occurrence = light overrides). */
function lightSev(sev: 'error' | 'warning' | 'info'): string {
  const b = visualRegion()
  const start = b.indexOf(`[data-severity='${sev}']`)
  const body = b.slice(start, b.indexOf('\n}', start))
  return body
}

function pctOf(block: string, token: string): number {
  const line = block.split('\n').find(l => l.includes(`--ink-locate-${token}:`)) ?? ''
  const m = line.match(/([\d.]+)%/)
  return Number(m?.[1] ?? NaN)
}

function pctInInlines(sev: 'error' | 'warning' | 'info', token: string): number {
  const inline = scss.slice(scss.indexOf('.inkchapter-diagnostic-inline-mark {'), scss.indexOf('/* ── V5.12-R1 — Heading Diagnostic'))
  const start = inline.indexOf(`[data-severity='${sev}']`)
  const body = inline.slice(start, inline.indexOf('\n}', start))
  return pctOf(body, token)
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

// ── CONTRAST-V53 ────────────────────────────────────────
describe('CONTRAST-V53 — strong light + dark bands', () => {
  it('CONTRAST-V53-1/2/3/4: light primary/inline/context bands', () => {
    const err = lightSev('error')
    const warn = lightSev('warning')
    const info = lightSev('info')
    expect(pctOf(err, 'primary-bg') / 100).toBeGreaterThanOrEqual(0.18) // Error Primary ~20%
    expect(pctOf(err, 'primary-bg') / 100).toBeLessThanOrEqual(0.22)
    expect(pctOf(warn, 'primary-bg') / 100).toBeGreaterThanOrEqual(0.19) // Warning Primary ~21%
    expect(pctOf(warn, 'primary-bg') / 100).toBeLessThanOrEqual(0.22)
    expect(pctOf(err, 'inline-bg') / 100).toBeGreaterThanOrEqual(0.20) // Inline 22%
    expect(pctOf(warn, 'inline-bg') / 100).toBeGreaterThanOrEqual(0.20)
    expect(pctOf(info, 'context-bg') / 100).toBeGreaterThanOrEqual(0.08) // Context 9–12%
    expect(pctOf(err, 'context-bg') / 100).toBeGreaterThanOrEqual(0.10)
    expect(pctOf(warn, 'context-bg') / 100).toBeGreaterThanOrEqual(0.11)
    expect(pctOf(err, 'context-bg') / 100).toBeLessThanOrEqual(0.12)
    expect(pctOf(warn, 'context-bg') / 100).toBeLessThanOrEqual(0.12)
  })

  it('CONTRAST-V53-5: primary >= context * 1.65 (light)', () => {
    for (const sev of ['error', 'warning', 'info'] as const) {
      const b = lightSev(sev)
      expect(pctOf(b, 'primary-bg') / 100).toBeGreaterThanOrEqual((pctOf(b, 'context-bg') / 100) * 1.65)
    }
  })

  it('CONTRAST-V53-6/7: border <= 80% and keyline <= 96% (light)', () => {
    for (const sev of ['error', 'warning', 'info'] as const) {
      const b = lightSev(sev)
      expect(pctOf(b, 'border') / 100).toBeLessThanOrEqual(0.80)
      expect(pctOf(b, 'keyline') / 100).toBeLessThanOrEqual(0.96)
    }
  })

  it('CONTRAST-V53-8: no editor shadow / glow anywhere on the carriers', () => {
    const r = visualRegion()
    expect(r).toContain('box-shadow: none')
    const inline = scss.slice(scss.indexOf('.inkchapter-diagnostic-inline-mark {'), scss.indexOf('/* ── V5.12-R1 — Heading Diagnostic'))
    for (const m of inline.matchAll(/box-shadow:\s*([^;]+);/g)) expect(m[1].trim()).toBe('none')
  })

  it('CONTRAST-V53-9: dark token split exists with stronger dark fills (no neon caps)', () => {
    const dark = scss.slice(scss.indexOf('@media (prefers-color-scheme: dark)'))
    expect(dark).toContain('--ink-ui-sev-error: #c77c7a')
    // dark frame severity raises context toward 15% (Error/Warning)
    const darkPart = visualRegion().slice(visualRegion().indexOf('@media (prefers-color-scheme: dark)'))
    const derr = darkPart.indexOf(`[data-severity='error']`)
    const errBody = darkPart.slice(derr, darkPart.indexOf('\n}', derr))
    expect(errBody).toContain('--ink-locate-primary-bg: color-mix(in srgb, var(--ink-ui-sev-error')
    expect(errBody).toMatch(/-locate-context-bg: color-mix\(in srgb, var\(--ink-ui-sev-error[^)]*\) 1[45]%, transparent\)/)
    // no keyline > 96
    expect(scss).not.toMatch(/-locate-keyline: color-mix\(in srgb, var\(--ink-ui-sev-(error|warning|info)[^)]*\) (?:9[7-9]|100)%/)
  })
})

// ── IMAGE-V53 ───────────────────────────────────────────
describe('IMAGE-V53 — strong error source-line, clean fallback', () => {
  it('IMAGE-V53-1/2: exact/source-line error inline fill >= 20% and fill-only fallback', () => {
    const r = visualRegion()
    const inlineBlock = r.slice(r.indexOf("[data-presentation='inline-mark']"))
    expect(inlineBlock).toContain('background-color: var(--ink-locate-inline-bg)')
    const err = lightSev('error')
    expect(pctOf(err, 'inline-bg') / 100).toBeGreaterThanOrEqual(0.20)
    expect(pctOf(err, 'inline-bg') / 100).toBeLessThanOrEqual(0.22)
    // V5.12-R7 §10 — the owning-block fallback is a plain fill (no transparent
    // wash, no corner cap / left marker line).
    expect(scss).not.toMatch(/inline-mark'\]\[data-fallback-level='2'\] \{[\s\S]{0,120}background: transparent/)
    expect(scss).not.toMatch(/inline-mark'\]\[data-fallback-level='2'\]::(before|after)/)
    // V5.3 colour token authority unchanged.
    expect(pctOf(err, 'keyline') / 100).toBeGreaterThanOrEqual(0.90)
  })

  it('IMAGE-V53-3/4: Source-First + occurrence untouched (no JS rewrite)', () => {
    const hostSource = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(hostSource).toContain('FIGURE_LOCAL_IMAGE_MISSING')
    expect(hostSource).toContain('fallbackLevel')
  })
})

// ── LINK-V53 ────────────────────────────────────────────
describe('LINK-V53 — strong warning inline', () => {
  it('LINK-V53-1/2: warning inline fill 20–22%, FILL_ONLY (no 2px keyline)', () => {
    expect(pctInInlines('warning', 'inline-bg') / 100).toBeGreaterThanOrEqual(0.20)
    expect(pctInInlines('warning', 'inline-bg') / 100).toBeLessThanOrEqual(0.22)
    expect(pctInInlines('warning', 'inline-edge') / 100).toBeGreaterThanOrEqual(0.90)
    const inline = scss.slice(scss.indexOf('.inkchapter-diagnostic-inline-mark {'), scss.indexOf('/* ── V5.12-R1 — Heading Diagnostic'))
    // V5.12-R7 §8 — the 2px lower keyline gradient is GONE; only the fill stays.
    expect(inline).not.toContain('background-image: linear-gradient(')
    expect(inline).toContain('background-color: var(--ink-locate-inline-bg)')
  })

  it('LINK-V53-3/4: ::selection + native hover untouched and V5.2 inline gate unchanged', () => {
    expect(scss).not.toContain('::selection {')
    const hostSource = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(hostSource).toContain("structure.kind === 'inline'")
    expect(hostSource).toContain('inlineMarkCount === 1')
  })
})

// ── TABLE-V53 / CODE-V53 ────────────────────────────────
describe('TABLE-V53 / CODE-V53 — name-slot PRIMARY over full context, zero mutation', () => {
  function commitObject(kind: 'table' | 'code') {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const anchor = document.createElement(kind === 'table' ? 'table' : 'pre')
    rectStub(anchor, { left: 200, top: 300, right: 1000, bottom: 500 })
    if (kind === 'code') {
      const code = document.createElement('code')
      code.textContent = 'GET /api/users'
      anchor.appendChild(code)
    } else {
      const tr = document.createElement('tr')
      const td = document.createElement('td')
      td.textContent = 'user'
      tr.appendChild(td)
      anchor.appendChild(tr)
    }
    document.body.appendChild(anchor)
    const ctrl = new DiagnosticLocateFrameController(root)
    ctrl.commit({
      diagnosticId: 'd1',
      severity: 'warning',
      anchor,
      kind,
      captionHostRect: { left: 200, top: 260, right: 420, bottom: 292, width: 220, height: 32 },
    })
    const frame = root.querySelector(`.${DIAGNOSTIC_LOCATE_FRAME_CLASS}`) as HTMLElement
    return { root, anchor, ctrl, frame }
  }

  it('TABLE-V53-1/2: PRIMARY name-slot (caption-host) + full context frame', () => {
    const { frame } = commitObject('table')
    expect(frame.dataset.captionCue).toBe('caption-host')
    const cue = frame.querySelector<HTMLElement>(`.${DIAGNOSTIC_LOCATE_CAPTION_CUE_CLASS}[data-cue-type='caption-host']`)
    expect(cue).toBeTruthy()
    expect(Number(cue!.style.height.replace('px', ''))).toBeGreaterThanOrEqual(12)
    // Warning primary 21% / context 12% tokens (used by frame + marker fill).
    const warn = lightSev('warning')
    expect(pctOf(warn, 'primary-bg') / 100).toBeGreaterThanOrEqual(0.19)
    expect(pctOf(warn, 'primary-bg') / 100).toBeLessThanOrEqual(0.22)
    expect(pctOf(warn, 'context-bg') / 100).toBeGreaterThanOrEqual(0.11)
    expect(pctOf(warn, 'context-bg') / 100).toBeLessThanOrEqual(0.12)
    expect((pctOf(warn, 'primary-bg') / 100) >= (pctOf(warn, 'context-bg') / 100) * 1.65).toBe(true)
  })

  it('TABLE-V53-3: td/th/tr/tbody backgrounds NEVER mutated', () => {
    const { anchor, ctrl } = commitObject('table')
    const cells = Array.from(anchor.querySelectorAll<HTMLElement>('td,th,tr,tbody'))
    expect(cells.length).toBeGreaterThan(0)
    for (const el of cells) expect(el.style.background).toBe('')
    expect(anchor.style.background).toBe('')
    ctrl.dispose()
  })

  it('CODE-V53-1/2: pre/code/token backgrounds NEVER mutated + context complete', () => {
    const { anchor, ctrl } = commitObject('code')
    const code = anchor.querySelector('code') as HTMLElement
    expect(code.style.background).toBe('')
    expect(code.style.backgroundColor).toBe('')
    expect(anchor.style.background).toBe('')
    const fr = ctrl.getFrameRect()!
    expect(fr.width).toBeGreaterThan(0)
    ctrl.dispose()
  })

  it('CODE-V53-3: native selection never overridden', () => {
    expect(scss).not.toContain('::selection {')
  })
})

// ── HEADING-V53 ─────────────────────────────────────────
describe('HEADING-V53 — marker/corner only', () => {
  it('HEADING-V53-1: marker/corner authority kept, active carrier is FILL-only', () => {
    const err = lightSev('error')
    // V5.3 colour token authority unchanged.
    expect(pctOf(err, 'keyline') / 100).toBeGreaterThanOrEqual(0.90)
    const headIdx = scss.indexOf(".inkchapter-diagnostic-locate-frame[data-presentation='text-tight-marker']")
    const head = scss.slice(headIdx, headIdx + 260)
    expect(head).toContain('border: none')
    // V5.12-R7 §9 — the heading active carrier is a FILL (never a full-width band
    // and never a corner cap / keyline).
    expect(head).toContain('background: var(--ink-locate-context-bg)')
    expect(scss).not.toContain('var(--ink-heading-corner')
    expect(scss).not.toMatch(/text-tight-marker[\s\S]{0,200}width: 100%/)
    expect(scss).not.toMatch(/text-tight-marker[\s\S]{0,200}border: 1px/)
  })
})

// ── DRAWER-V53 ──────────────────────────────────────────
describe('DRAWER-V53 — strong but below doc Secondary', () => {
  it('DRAWER-V53-1/2/3: error/warning active 9%, info 7%; rail + no row shadow', () => {
    expect(scss).toContain('--ink-drawer-active-wash: 9%')
    expect(scss).toContain('--ink-drawer-active-wash: 7%')
    const block = scss.slice(scss.indexOf('.inkchapter-doc-drawer__item--error.is-selected,'), scss.indexOf('.inkchapter-doc-drawer__item.is-busy'))
    expect(block).not.toContain('box-shadow: 0')
    expect(block).toContain('box-shadow: none')
    const rail = scss.slice(scss.indexOf('.inkchapter-doc-drawer__item.is-selected::before,'))
    expect(rail).toContain('width: 2px')
  })

  it('DRAWER-V53-4: hover neutral 3.5–4% (not severity)', () => {
    const hover = scss.slice(scss.indexOf('.inkchapter-doc-drawer__item:focus-visible'), scss.indexOf('.inkchapter-doc-drawer__item.is-busy'))
    expect(hover).toContain('--ink-ui-bg-hover')
    expect(hover).toMatch(/rgba\(0,\s*0,\s*0,\s*0\.04\)/)
    expect(hover).not.toContain('--ink-ui-sev-')
  })

  it('DRAWER-V53-5: V5.1 recovery untouched by the visual change', () => {
    const hostSource = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(hostSource).toContain('releaseDrawerRecoveryLease')
    expect(hostSource).toContain('resolveProblemsControlAction')
    expect(hostSource).toContain('canPerformLayoutRecovery')
  })
})
