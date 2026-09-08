// @vitest-environment jsdom
/**
 * TB-DENSITY — Document Problems Control / Edit-Lock Toolbar horizontal density.
 *
 * Guards that the RIGHT-UTILITY-RAIL Authoritative Visual block stays the single
 * spacing authority: compact shell, 4px shell padding, 3–4px segment padding,
 * 3px icon–count gap, ONE status/action divider and ZERO error/warning dividers,
 * no wide leftover padding/gap/margin/min-width/flex, and hover that only paints
 * a background (never changes outer width).
 *
 * Static CSS assertions read the SCSS source; structural assertions mount the
 * real overlay host in jsdom (no fragile pixel-perfect layout numbers).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DocumentUtilityOverlayHost,
  decideToolbarPresentation,
} from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

const scssRaw = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
// Comments between leaf rules otherwise get glued into the selector chunk by
// the naive brace parser — strip them so selectors parse cleanly.
const scss = scssRaw.replace(/\/\*[\s\S]*?\*\//g, '')

// ── SCSS parsing helpers (leaf rules; same approach as OVERLAY-ISO tests) ──
function rulePairs(css: string): Array<{ selector: string; body: string }> {
  const pairs: Array<{ selector: string; body: string }> = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    pairs.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim() })
  }
  return pairs
}

const pairs = rulePairs(scss)

/** Every rule body whose selector list mentions `selector` (exact class token). */
function ruleBodies(selector: string): string[] {
  return pairs
    .filter(r => r.selector.split(',').map(s => s.trim()).includes(selector))
    .map(r => r.body)
}

/** Non-compact toolbar-scoped rules (compact density is frozen separately). */
function wideToolbarRules() {
  return pairs.filter(r =>
    /inkchapter-doc-toolbar|inkchapter-problems-control|inkchapter-toolbar-segment|inkchapter-toolbar-entry|inkchapter-editlock/.test(r.selector) &&
    !r.selector.includes('data-density="compact"'),
  )
}

// ── DOM helpers ──────────────────────────────────────────────────────────────
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

function makeDiag(severity: 'error' | 'warning', id: string, message: string): DocumentDiagnosticsSnapshot['diagnostics'][number] {
  return {
    id,
    severity,
    code: 'TEST',
    message,
    category: 'document',
    stableIdentity: id,
    targetIdentity: id,
    metadata: {},
    location: null,
  } as unknown as DocumentDiagnosticsSnapshot['diagnostics'][number]
}

function injectCounts(h: DocumentUtilityOverlayHost, errors: number, warnings: number): void {
  const items: DocumentDiagnosticsSnapshot['diagnostics'][number][] = []
  for (let i = 0; i < errors; i++) items.push(makeDiag('error', `e${i}`, `错误 ${i}`))
  for (let i = 0; i < warnings; i++) items.push(makeDiag('warning', `w${i}`, `警告 ${i}`))
  const snapshot = {
    documentKey: 'doc:key',
    revision: 1,
    sourceRevision: 1,
    generatedAt: 0,
    diagnostics: items,
    errorCount: errors,
    warningCount: warnings,
    infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot | null }).snapshot = snapshot
  ;(h as unknown as { renderDiagnosticsButton: () => void }).renderDiagnosticsButton()
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
})

function mountHost(): DocumentUtilityOverlayHost {
  const h = new DocumentUtilityOverlayHost({
    ctx: fakeContext(),
    providers: fakeProviders(),
    onBindDocument: () => {},
  })
  h.mount()
  return h
}

describe('TB-DENSITY-CSS wide authoritative tokens', () => {
  it('shell: 32px height, 4px horizontal padding, gap 0 (single shell)', () => {
    const bodies = ruleBodies('.inkchapter-doc-toolbar').join('\n')
    expect(bodies).toMatch(/height\s*:\s*32px/)
    expect(bodies).toMatch(/padding\s*:\s*1px 4px/)
    expect(bodies).toMatch(/gap\s*:\s*0/)
    // no wide leftover shell horizontal padding
    expect(bodies).not.toMatch(/padding\s*:\s*(?:[\d.]+px\s+)?(?:8|10|12)px(?:\s|$)/)
  })

  it('status group: gap 4px + exactly one status/action divider, no error/warning divider', () => {
    const control = ruleBodies('.inkchapter-problems-control').join('\n')
    expect(control).toMatch(/gap\s*:\s*4px/)
    expect(control).toMatch(/padding-right\s*:\s*5px/)
    const borderRightCount = (control.match(/border-right\s*:/g) ?? []).length
    expect(borderRightCount).toBe(1)
    expect(control).not.toMatch(/border-left\s*:/)
    // segments/entry never carry their own divider or inter-segment margins
    const segEntry = wideToolbarRules()
      .filter(r => /inkchapter-toolbar-segment|inkchapter-toolbar-entry/.test(r.selector))
      .map(r => r.body).join('\n')
    expect(segEntry).not.toMatch(/border-(left|right)\s*:/)
    expect(segEntry).not.toMatch(/margin-left\s*:\s*[1-9]/)
    expect(pairs.some(r => r.selector === '.inkchapter-toolbar-segment + .inkchapter-toolbar-segment')).toBe(false)
  })

  it('segments: 4px horizontal padding + 3px icon-count gap', () => {
    const bodies = ruleBodies('.inkchapter-doc-toolbar__btn--diag').join('\n')
    expect(bodies).toMatch(/padding\s*:\s*0 4px/)
    expect(bodies).toMatch(/height\s*:\s*28px/)
    const segBodies = ruleBodies('.inkchapter-toolbar-segment').join('\n')
    expect(segBodies).toMatch(/gap\s*:\s*3px/)
  })

  it('edit/lock action: 6px padding, 4px icon-text gap, divider breathing 5px', () => {
    const bodies = ruleBodies('.inkchapter-editlock').join('\n')
    expect(bodies).toMatch(/padding\s*:\s*0 6px/)
    expect(bodies).toMatch(/gap\s*:\s*4px/)
    expect(bodies).toMatch(/margin-left\s*:\s*5px/)
    expect(bodies).toMatch(/height\s*:\s*28px/)
  })

  it('no wide leftover 8/10/12px spacing, large min-width, flex:1 or big width', () => {
    const scope = wideToolbarRules().map(r => r.body).join('\n')
    expect(scope).not.toMatch(/margin-(left|right)\s*:\s*(?:8|10)px/)
    expect(scope).not.toMatch(/gap\s*:\s*(?:8|10|12)px/)
    expect(scope).not.toMatch(/column-gap\s*:\s*(?:8|10|12)px/)
    expect(scope).not.toMatch(/padding-(left|right)\s*:\s*(?:8|10|12)px/)
    expect(scope).not.toMatch(/padding\s*:\s*(?:[\d.]+px\s+)?(?:8|10|12)px/)
    expect(scope).not.toMatch(/min-width\s*:\s*(?:1[2-9]|[2-9]\d|\d{3})px/)
    expect(scope).not.toMatch(/flex\s*:\s*1(?:\s|$)/)
    expect(scope).not.toMatch(/width\s*:\s*\d{3}px/)
  })

  it('hover paints a background only - no width-affecting declaration', () => {
    const hovers = wideToolbarRules().filter(r => /:hover/.test(r.selector))
    expect(hovers.length).toBeGreaterThan(0)
    for (const r of hovers) {
      expect(r.body, r.selector).not.toMatch(/width|min-width|padding|margin|gap|flex|box-shadow/)
      expect(r.body).toMatch(/background/)
    }
  })

  it('no appended density override block after the authoritative styles', () => {
    // The shell 4px padding token must exist exactly once (single authority).
    expect(scss.match(/padding\s*:\s*1px 4px/g) ?? []).toHaveLength(1)
  })
})

describe('TB-DENSITY-1/2/3/5 single shell, same status group, natural counts', () => {
  it('one shell, one status group containing error+warning', () => {
    const h = mountHost()
    injectCounts(h, 5, 22)
    expect(document.querySelectorAll('.inkchapter-doc-toolbar')).toHaveLength(1)
    const control = document.querySelector('.inkchapter-problems-control')
    expect(control).toBeTruthy()
    const segments = Array.from(control!.querySelectorAll('.inkchapter-toolbar-segment'))
    expect(segments).toHaveLength(2)
    expect(segments[0].getAttribute('data-severity')).toBe('error')
    expect(segments[1].getAttribute('data-severity')).toBe('warning')
    expect(segments[0].querySelector('.inkchapter-toolbar-segment__count')?.textContent).toBe('5')
    expect(segments[1].querySelector('.inkchapter-toolbar-segment__count')?.textContent).toBe('22')
    // edit/lock action is a toolbar sibling of the status group (not inside it)
    const lock = document.querySelector('.inkchapter-doc-toolbar__btn--lock')
    expect(lock?.parentElement?.classList.contains('inkchapter-doc-toolbar')).toBe(true)
  })

  it('0/0 renders the healthy smart entry; 99/99 uses natural-width counters', () => {
    const h = mountHost()
    injectCounts(h, 0, 0)
    expect(document.querySelectorAll('.inkchapter-toolbar-segment')).toHaveLength(0)
    expect(document.querySelectorAll('.inkchapter-doc-toolbar')).toHaveLength(1)
    const entry = document.querySelector('.inkchapter-toolbar-entry')
    expect(entry?.classList.contains('is-healthy')).toBe(true)
    injectCounts(h, 99, 99)
    const counts = Array.from(document.querySelectorAll('.inkchapter-toolbar-segment__count')).map(el => el.textContent)
    expect(counts).toEqual(['99', '99'])
  })
})

describe('TB-DENSITY-4 one status/action divider', () => {
  it('divider count is enforced by CSS (control border-right), not by inline DOM borders', () => {
    const h = mountHost()
    injectCounts(h, 5, 22)
    const control = document.querySelector('.inkchapter-problems-control') as HTMLElement
    const lock = document.querySelector('.inkchapter-doc-toolbar__btn--lock') as HTMLElement
    expect(control.style.borderRight).toBe('')
    expect(lock.style.borderLeft).toBe('')
    const segBodies = ruleBodies('.inkchapter-toolbar-segment').join('\n')
    expect(segBodies).not.toMatch(/border-(left|right)/)
  })
})

describe('TB-DENSITY-6/9 edit-lock semantics + locked state', () => {
  it('clicking toggles 编辑 <-> 已锁定 and keeps one toolbar', () => {
    const write = document.createElement('div')
    write.id = 'write'
    write.setAttribute('contenteditable', 'true')
    document.body.appendChild(write)
    mountHost()
    const lockBtn = document.querySelector('.inkchapter-doc-toolbar__btn--lock') as HTMLButtonElement
    expect(lockBtn.textContent).toBe('编辑')
    lockBtn.click()
    expect(lockBtn.textContent).toBe('已锁定')
    expect(lockBtn.classList.contains('is-locked')).toBe(true)
    lockBtn.click()
    expect(lockBtn.textContent).toBe('编辑')
    expect(lockBtn.classList.contains('is-locked')).toBe(false)
    expect(document.querySelectorAll('.inkchapter-doc-toolbar')).toHaveLength(1)
  })
})

describe('TB-DENSITY-7 full/compact/suppressed authority unchanged', () => {
  it('three-tier presentation thresholds still hold', () => {
    expect(decideToolbarPresentation(null)).toBe('full')
    expect(decideToolbarPresentation(1000)).toBe('full')
    expect(decideToolbarPresentation(400)).toBe('compact')
    expect(decideToolbarPresentation(200)).toBe('suppressed')
  })
})

describe('TB-DENSITY-8/10 hover structure + no duplicate mount', () => {
  it('hovering edit/lock keeps exactly one toolbar shell', () => {
    const h = mountHost()
    injectCounts(h, 5, 22)
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-doc-toolbar .inkchapter-doc-toolbar__btn'))
    expect(buttons.length).toBe(3) // error + warning + edit/lock
    const lock = document.querySelector('.inkchapter-doc-toolbar__btn--lock') as HTMLElement
    lock.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(document.querySelectorAll('.inkchapter-doc-toolbar')).toHaveLength(1)
  })

  it('repeated bindDocument keeps exactly one toolbar + navigator (no duplicate mount)', () => {
    const h = mountHost()
    h.bindDocument()
    h.bindDocument()
    expect(document.querySelectorAll('.inkchapter-doc-toolbar')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-drawer')).toHaveLength(1)
  })
})
