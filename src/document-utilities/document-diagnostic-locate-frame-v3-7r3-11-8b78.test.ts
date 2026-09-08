// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.8 — Diagnostic Locate Frame V3 targeted tests.
 *
 * V3 visual model (complex Block -> overlay frame; Heading -> compact severity
 * indicator; Inline -> precise severity mark). Gates:
 *   VIS-V3-1..10 / FRAME-1..5 / TABLE-FRAME-1..4 / CODE-FRAME-1..5 /
 *   HEADING-FRAME-1..3 / SEVERITY-FRAME-1..3 / INLINE-VIS-1..3 +
 *   lifecycle / responsive / dark-mode.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import { DIAGNOSTIC_LOCATE_FRAME_CLASS, DIAGNOSTIC_INLINE_MARK_CLASS } from './document-diagnostic-locate-frame'
import { DIAGNOSTIC_HIGHLIGHT_CLASS } from './document-diagnostic-locator'

const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

interface ShellRect { top: number; right: number; bottom: number; left: number; width: number; height: number }

function fakeContext(overrides: Partial<DocumentUtilitiesContext['authority']> = {}): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# 标题\n\n正文',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
      ...overrides,
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
  write.setAttribute('contenteditable', 'true')
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

afterEach(() => {
  host?.dispose()
  host = null
  vi.restoreAllMocks()
})

function mountHost(): { h: DocumentUtilityOverlayHost; shell: HTMLElement; write: HTMLElement } {
  const shell = makeShell()
  const write = document.getElementById('write') as HTMLElement
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
  h.mount()
  host = h
  return { h, shell, write }
}

interface FakeDiag { id: string; severity: 'error' | 'warning' | 'info'; code: string }

/** Drive the real HIGHLIGHTING path with a manually resolved target list. */
function commitLocate(h: DocumentUtilityOverlayHost, el: HTMLElement, diag: FakeDiag): boolean {
  const tx = { id: 1, state: 'SCROLLING' } as unknown as {
    id: number
    documentKey: string | null
    diagnosticId: string
    targetIndex: number
    targetCount: number
    startedAt: number
    state: 'RESOLVING' | 'SCROLLING' | 'HIGHLIGHTING'
  }
  const d = {
    ...diag,
    documentKey: 'doc:key',
    message: 'x',
    detail: '',
    metadata: {},
    location: { kind: 'canonical-node' as const, stableIdentity: 'x' },
  }
  const result = {
    decision: 'RESOLVED' as const,
    element: el,
    scrollAction: null,
    targetIndex: 0,
    primaryAnchor: 'block-identity' as const,
    fallbackAnchor: null,
    resolvedNodeKind: el.tagName.toLowerCase(),
    resolvedBlockIdentity: null,
  }
  const ok = (h as unknown as { applyLocateHighlightAndVerify(t: unknown, d: unknown, targets: HTMLElement[], r: unknown, i: number): boolean }).applyLocateHighlightAndVerify(tx, d, [el], result, 0)
  // The locator schedules a 1600 ms class removal; release it right away —
  // this test inspects the V3 overlay state, not the transient class.
  h.locator.clearHighlight()
  return ok
}

function frameEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`.${DIAGNOSTIC_LOCATE_FRAME_CLASS}`))
}

// ── FRAME ────────────────────────────────────────────────
describe('FRAME — single overlay locate frame', () => {
  it('FRAME-1: complex table target mounts exactly one frame with severity + kind', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<table><tr><th>A</th></tr><tr><td>1</td></tr></table>'
    const table = write.querySelector('table') as HTMLElement
    expect(commitLocate(h, table, { id: 't1', severity: 'warning', code: 'TABLE_MISSING_NAME' })).toBe(true)
    const frames = frameEls()
    expect(frames).toHaveLength(1)
    expect(frames[0].getAttribute('data-target-kind')).toBe('table')
    expect(frames[0].getAttribute('data-severity')).toBe('warning')
    expect(h.getLocateFrameStructure().locateFrameCount).toBe(1)
    expect(h.getLocateFrameStructure().duplicateLocateFrame).toBe(false)
    expect(h.getLocateFrameStructure().staleLocateFrameCount).toBe(0)
    // Frame is inside the overlay root, NOT inside #write.
    expect(write.querySelector(`.${DIAGNOSTIC_LOCATE_FRAME_CLASS}`)).toBeNull()
  })

  it('FRAME-2 + VIS-V3-10: switching diagnostic reuses/replaces while staying <= 1', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<table><tr><td>1</td></tr></table><h2>标题</h2>'
    const table = write.querySelector('table') as HTMLElement
    const h2 = write.querySelector('h2') as HTMLElement
    commitLocate(h, table, { id: 'a', severity: 'warning', code: 'A' })
    const first = frameEls()[0]
    commitLocate(h, h2, { id: 'b', severity: 'error', code: 'B' })
    const frames = frameEls()
    expect(frames).toHaveLength(1)
    expect(frames[0].getAttribute('data-target-kind')).toBe('heading')
    expect(frames[0].getAttribute('data-severity')).toBe('error')
    expect(h.getLocateFrameStructure().activeDiagnosticId).toBe('b')
    expect(h.getLocateFrameStructure().locateFrameCount).toBeLessThanOrEqual(1)
    // Old frame element was replaced or reused — never two live frames.
    expect(document.querySelectorAll(`.${DIAGNOSTIC_LOCATE_FRAME_CLASS}`).length).toBe(1)
    void first
  })

  it('FRAME-3: drawer close clears the frame', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<pre class="md-fences"><code>code</code></pre>'
    const pre = write.querySelector('pre') as HTMLElement
    commitLocate(h, pre, { id: 'c1', severity: 'error', code: 'CODE_MISSING_LANGUAGE' })
    expect(frameEls()).toHaveLength(1)
    ;(h as unknown as { closeDrawer(): void }).closeDrawer()
    expect(frameEls()).toHaveLength(0)
    expect(h.getLocateFrameStructure().active).toBe(false)
  })

  it('FRAME-4: document switch clears the frame', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<h2>标题</h2>'
    const h2 = write.querySelector('h2') as HTMLElement
    commitLocate(h, h2, { id: 'd1', severity: 'warning', code: 'DUPLICATE_HEADING' })
    expect(frameEls()).toHaveLength(1)
    h.bindDocument() // doc switch / reconcile
    expect(frameEls()).toHaveLength(0)
    expect(h.getLocateFrameStructure().active).toBe(false)
  })

  it('FRAME-5: primary frame count never exceeds 1 across many commits', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<table><tr><td>1</td></tr></table><pre class="md-fences"><code>x</code></pre><h2>t</h2>'
    const table = write.querySelector('table') as HTMLElement
    const pre = write.querySelector('pre') as HTMLElement
    const h2 = write.querySelector('h2') as HTMLElement
    for (let i = 0; i < 5; i++) {
      const el = [table, pre, h2][i % 3]
      commitLocate(h, el, { id: `x${i}`, severity: i % 2 ? 'error' : 'warning', code: 'X' })
      expect(h.getLocateFrameStructure().locateFrameCount).toBeLessThanOrEqual(1)
      expect(frameEls().length).toBeLessThanOrEqual(1)
    }
  })
})

// ── TABLE-FRAME ──────────────────────────────────────────
describe('TABLE-FRAME — overlay frame only, cells untouched', () => {
  it('TABLE-FRAME-1: table locate creates an overlay frame (kind=table)', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<table><tr><th>H</th></tr><tr><td>D</td></tr></table>'
    const table = write.querySelector('table') as HTMLElement
    commitLocate(h, table, { id: 't', severity: 'warning', code: 'TABLE_MISSING_NAME' })
    expect(frameEls()).toHaveLength(1)
    expect(frameEls()[0].getAttribute('data-target-kind')).toBe('table')
  })

  it('TABLE-FRAME-2/3/4: td/th/tr style & class are unchanged', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
    const cells = Array.from(write.querySelectorAll('td, th, tr')) as HTMLElement[]
    const before = cells.map(c => ({ cls: c.className, style: c.getAttribute('style'), attrs: Array.from(c.attributes).map(a => a.name).join(',') }))
    commitLocate(h, write.querySelector('table') as HTMLElement, { id: 't', severity: 'warning', code: 'TABLE_MISSING_NAME' })
    cells.forEach((c, i) => {
      expect(c.className).toBe(before[i].cls)
      expect(c.getAttribute('style')).toBe(before[i].style)
      expect(c.style.background).toBe('')
      expect(c.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)).toBe(false)
      expect(c.classList.contains(DIAGNOSTIC_LOCATE_FRAME_CLASS)).toBe(false)
      expect(c.getAttribute('data-severity')).toBeNull()
    })
  })
})

// ── CODE-FRAME ───────────────────────────────────────────
describe('CODE-FRAME — overlay frame only, code inner untouched', () => {
  it('CODE-FRAME-1: code locate creates an overlay frame (kind=code)', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<pre class="md-fences"><code>let a = 1;</code></pre>'
    commitLocate(h, write.querySelector('pre') as HTMLElement, { id: 'c', severity: 'warning', code: 'CODE_MISSING_LANGUAGE' })
    expect(frameEls()).toHaveLength(1)
    expect(frameEls()[0].getAttribute('data-target-kind')).toBe('code')
  })

  it('CODE-FRAME-2/3/4/5: pre/code/token/CodeMirror-line styles untouched', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<pre class="md-fences"><code><span class="cm-token">tok</span><span class="CodeMirror-line">line</span></code></pre>'
    const pre = write.querySelector('pre') as HTMLElement
    const code = write.querySelector('code') as HTMLElement
    const tokens = Array.from(write.querySelectorAll('span')) as HTMLElement[]
    const before = tokens.map(t => ({ cls: t.className, style: t.getAttribute('style') }))
    commitLocate(h, pre, { id: 'c', severity: 'warning', code: 'CODE_MISSING_LANGUAGE' })
    expect(pre.style.background).toBe('')
    expect(code.style.background).toBe('')
    tokens.forEach((t, i) => {
      expect(t.className).toBe(before[i].cls)
      expect(t.getAttribute('style')).toBe(before[i].style)
      expect(t.style.background).toBe('')
    })
    // Inner code never receives the locate class (outer wrapper only).
    expect(code.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)).toBe(false)
  })
})

// ── HEADING-FRAME ────────────────────────────────────────
describe('HEADING-FRAME — no full-width band, indicator only', () => {
  it('HEADING-FRAME-1/2: heading locate -> heading indicator frame, zero fill on the element', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<h2 id="x">章节标题</h2>'
    const h2 = write.querySelector('h2') as HTMLElement
    commitLocate(h, h2, { id: 'h', severity: 'error', code: 'HEADING_LEVEL' })
    const frames = frameEls()
    expect(frames).toHaveLength(1)
    expect(frames[0].getAttribute('data-target-kind')).toBe('heading')
    // The heading element keeps its own background/color (no direct paint).
    expect(h2.style.background).toBe('')
    expect(h2.style.color).toBe('')
  })

  it('HEADING-FRAME-3: CSS shows no full-width colored band + inline native heading preserved', () => {
    // CSS contract: the heading carrier draws ONLY a compact left indicator.
    const headIdx = scss.indexOf(".inkchapter-diagnostic-locate-frame[data-target-kind='heading']")
    expect(headIdx).toBeGreaterThan(-1)
    const headingRule = scss.slice(headIdx, headIdx + 240)
    expect(headingRule).toContain('border: none')
    expect(headingRule).toContain('background: transparent')
    expect(headingRule).toContain('inset 2px 0 0')
    // No legacy direct body paint survives.
    expect(scss).not.toContain('rgba(7, 112, 170')
  })
})

// ── SEVERITY-FRAME ───────────────────────────────────────
describe('SEVERITY-FRAME — severity colors stay on the frame', () => {
  it('SEVERITY-FRAME-1/2/3: error/warning/info set data-severity', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = write.querySelector('table') as HTMLElement
    const severities: Array<'error' | 'warning' | 'info'> = ['error', 'warning', 'info']
    severities.forEach((sev, i) => {
      commitLocate(h, table, { id: `s${i}`, severity: sev, code: 'X' })
      const frames = frameEls()
      expect(frames).toHaveLength(1)
      expect(frames[0].getAttribute('data-severity')).toBe(sev)
    })
  })

  it('CSS maps severity to muted palette tokens via data-severity (no hard-coded bright fills)', () => {
    expect(scss).toContain("data-severity='error'")
    expect(scss).toContain('var(--ink-ui-sev-error')
    expect(scss).toContain('var(--ink-ui-sev-warning')
    expect(scss).toContain('var(--ink-ui-sev-info')
  })
})

// ── INLINE-VIS ───────────────────────────────────────────
describe('INLINE-VIS — precise inline mark', () => {
  it('INLINE-VIS-1: warning link -> amber inline mark, no frame rectangle', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<p><a href="missing.png">链接</a></p>'
    const a = write.querySelector('a') as HTMLElement
    commitLocate(h, a, { id: 'i', severity: 'warning', code: 'LINK_TARGET_MISSING' })
    expect(frameEls()).toHaveLength(0)
    expect(a.classList.contains(DIAGNOSTIC_INLINE_MARK_CLASS)).toBe(true)
    expect(a.getAttribute('data-severity')).toBe('warning')
    expect(a.getAttribute('data-target-kind')).toBe('inline')
  })

  it('INLINE-VIS-2: mark is a precise rounded underline tint, not a filled native selection', () => {
    // CSS contract: 6% tint + inset bottom underline + radius — never a solid
    // ::selection-like fill, and no ::selection override exists anywhere.
    const markBlock = scss.slice(scss.indexOf('.inkchapter-diagnostic-inline-mark'))
    expect(markBlock).toContain('color-mix(in srgb, var(--ink-locate-color) 6%, transparent)')
    expect(markBlock).toContain('inset 0 -1px 0')
    expect(scss).not.toContain('::selection {')
  })

  it('INLINE-VIS-3: switching target clears the old inline mark', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<p><a id="a1">一</a><a id="a2">二</a></p>'
    const a1 = write.querySelector('#a1') as HTMLElement
    const a2 = write.querySelector('#a2') as HTMLElement
    commitLocate(h, a1, { id: 'i1', severity: 'warning', code: 'X' })
    expect(a1.classList.contains(DIAGNOSTIC_INLINE_MARK_CLASS)).toBe(true)
    commitLocate(h, a2, { id: 'i2', severity: 'error', code: 'X' })
    expect(a1.classList.contains(DIAGNOSTIC_INLINE_MARK_CLASS)).toBe(false)
    expect(a2.classList.contains(DIAGNOSTIC_INLINE_MARK_CLASS)).toBe(true)
    expect(document.querySelectorAll(`.${DIAGNOSTIC_INLINE_MARK_CLASS}`)).toHaveLength(1)
    expect(h.getLocateFrameStructure().inlineMarkCount).toBe(1)
    expect(h.getLocateFrameStructure().duplicateInlineMark).toBe(false)
  })
})

// ── lifecycle ────────────────────────────────────────────
describe('LIFECYCLE — active visual state cleanup', () => {
  it('stale visuals are 0 after commit, drawer close, and document switch', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<pre class="md-fences"><code>x</code></pre><h2>标题</h2>'
    const pre = write.querySelector('pre') as HTMLElement
    const h2 = write.querySelector('h2') as HTMLElement
    commitLocate(h, pre, { id: 'l1', severity: 'error', code: 'X' })
    expect(h.getLocateFrameStructure().staleLocateFrameCount).toBe(0)
    commitLocate(h, h2, { id: 'l2', severity: 'warning', code: 'X' })
    expect(h.getLocateFrameStructure().staleLocateFrameCount).toBe(0)
    ;(h as unknown as { closeDrawer(): void }).closeDrawer()
    expect(h.getLocateFrameStructure().active).toBe(false)
    expect(frameEls()).toHaveLength(0)
  })

  it('anchor disconnect clears the frame (no stale frame left behind)', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<h2>标题</h2>'
    const h2 = write.querySelector('h2') as HTMLElement
    commitLocate(h, h2, { id: 'l3', severity: 'info', code: 'X' })
    expect(frameEls()).toHaveLength(1)
    h2.remove() // Typora re-render replaced the node
    ;(h as unknown as { repositionDiagnosticLocateFrame(): void }).repositionDiagnosticLocateFrame()
    expect(frameEls()).toHaveLength(0)
    expect(h.getLocateFrameStructure().staleLocateFrameCount).toBe(0)
  })
})

// ── responsive ───────────────────────────────────────────
describe('RESPONSIVE — frame follows target on scroll / resize / drawer geometry', () => {
  it('scroll repositions the frame onto the live anchor rect', () => {
    const { h, write, shell } = mountHost()
    write.innerHTML = '<h2>标题</h2>'
    const h2 = write.querySelector('h2') as HTMLElement
    const rect = { left: 100, top: 200, right: 400, bottom: 240, width: 300, height: 40 }
    Object.defineProperty(h2, 'getBoundingClientRect', { configurable: true, value: () => rect })
    commitLocate(h, h2, { id: 'r1', severity: 'warning', code: 'X' })
    const frame = frameEls()[0]
    expect(frame.style.display).toBe('block')
    expect(frame.style.left).toBe('100px')
    expect(frame.style.top).toBe('200px')
    // Scroll the container -> target moves up 60px.
    rect.top = 140
    rect.bottom = 180
    rect.left = 120
    shell.dispatchEvent(new Event('scroll'))
    expect(frame.style.left).toBe('120px')
    expect(frame.style.top).toBe('140px')
  })

  it('window resize (DevTools layout change) repositions via geometry sync', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<h2>标题</h2>'
    const h2 = write.querySelector('h2') as HTMLElement
    const rect = { left: 50, top: 80, right: 350, bottom: 120, width: 300, height: 40 }
    Object.defineProperty(h2, 'getBoundingClientRect', { configurable: true, value: () => rect })
    commitLocate(h, h2, { id: 'r2', severity: 'info', code: 'X' })
    const frame = frameEls()[0]
    rect.left = 240 // narrow editor moved the anchor right
    rect.right = 540
    window.dispatchEvent(new Event('resize'))
    expect(frame.style.left).toBe('240px')
  })

  it('drawer open does not destroy the frame; close clears it (VIS-V3-12 path)', () => {
    const { h, write } = mountHost()
    write.innerHTML = '<table><tr><td>x</td></tr></table>'
    commitLocate(h, write.querySelector('table') as HTMLElement, { id: 'r3', severity: 'warning', code: 'X' })
    const drawerBtn = document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement
    drawerBtn.click()
    expect(frameEls()).toHaveLength(1)
    const close = document.querySelector<HTMLButtonElement>('.inkchapter-doc-drawer__action--close')!
    close.click()
    expect(frameEls()).toHaveLength(0)
  })
})

// ── dark mode ────────────────────────────────────────────
describe('DARK MODE — tokenized severity palette (no big independent override)', () => {
  it('severity palette is declared at :root in light AND dark', () => {
    expect(scss).toMatch(/:root\s*\{\s*--ink-ui-sev-error\s*:/)
    const darkIdx = scss.indexOf('prefers-color-scheme: dark')
    expect(darkIdx).toBeGreaterThan(-1)
    const after = scss.slice(darkIdx)
    expect(after).toContain('--ink-ui-sev-error')
    expect(after).toContain('--ink-ui-sev-warning')
    expect(after).toContain('--ink-ui-sev-info')
  })

  it('V3 frame CSS exists and caps wash at <= 2%', () => {
    expect(scss).toContain('.inkchapter-diagnostic-locate-frame')
    // Severity washes: every wash mix stays <= 2%.
    const washMatches = scss.match(/--ink-locate-wash: color-mix\(in srgb, var\(--ink-ui-sev-[a-z]+[^)]*\) (\d+)%, transparent\)/g) ?? []
    expect(washMatches.length).toBeGreaterThanOrEqual(3)
    for (const m of washMatches) {
      const pct = Number(/(\d+)%/.exec(m)?.[1] ?? 99)
      expect(pct).toBeLessThanOrEqual(2)
    }
  })
})
