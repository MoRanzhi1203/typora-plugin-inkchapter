// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.5 — Document Diagnostic Universal Location Authority.
 *
 * PUBLISHED = LOCATABLE. Tests the six DiagnosticLocation kinds, the producer
 * attachment (canonical-node / source-range / document-start / document-end /
 * block-node / multi-target), the location contract audit, the universal
 * resolver, and the overlay locate interaction (highlight + edit-lock).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import { computeDiagnosticLocationContract, resolveDiagnosticLocation, hasLocatableLocation } from './document-diagnostic-location'
import { DocumentDiagnosticLocator, DIAGNOSTIC_HIGHLIGHT_CLASS } from './document-diagnostic-locator'
import type { DocumentDiagnostic } from './diagnostics-types'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

function baseInput(overrides: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:key',
    markdown: '# 标题\n\n正文',
    strictMode: true,
    vaultRoot: '/vault',
    headings: [],
    h1Facts: null,
    latentAtxMarkers: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
    ...overrides,
  }
}

function findCode(diags: readonly DocumentDiagnostic[], code: string): DocumentDiagnostic {
  const d = diags.find(x => x.code === code)
  if (!d) throw new Error(`missing ${code}`)
  return d
}

describe('LOC — producer location attachment (six kinds)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('LOC-0 contract: total == error+warning+hint and locatable == total', () => {
    const el = document.createElement('h2')
    el.setAttribute('data-line', '3')
    const out = computeDocumentDiagnostics(baseInput({
      headings: [
        { level: 2, text: 'A', stableIdentity: 'h-a', element: el },
        { level: 4, text: 'B', stableIdentity: 'h-b', element: el },
      ],
      codes: [{ name: null, language: null, element: document.createElement('pre'), targetIdentity: 'block:code:0' }],
    }))
    const snapshot = {
      documentKey: 'doc:key',
      revision: 1,
      sourceRevision: 1,
      generatedAt: 0,
      diagnostics: out.diagnostics,
      errorCount: out.errorCount,
      warningCount: out.warningCount,
      infoCount: out.infoCount,
    }
    expect(out.diagnostics.length).toBe(out.errorCount + out.warningCount + out.infoCount)
    const contract = computeDiagnosticLocationContract(snapshot)
    expect(contract.diagnosticCount).toBe(out.diagnostics.length)
    expect(contract.locatableDiagnosticCount).toBe(out.diagnostics.length)
    expect(contract.unlocatableDiagnosticCount).toBe(0)
    expect(contract.decision).toBe('PASS')
  })

  it('ZERO-H1: STRICT_SINGLE_H1_NO_H1 → document-start', () => {
    const out = computeDocumentDiagnostics(baseInput({ h1Facts: [] }))
    const d = findCode(out.diagnostics, 'STRICT_SINGLE_H1_NO_H1')
    expect(d.severity).toBe('error')
    expect(d.location?.kind).toBe('document-start')
  })

  it('MULTI-H1: 3 H1s → one aggregate multi-target with H1 #2..#3', () => {
    const out = computeDocumentDiagnostics(baseInput({
      h1Facts: [
        { stableIdentity: 'h1-a', element: null },
        { stableIdentity: 'h1-b', element: null },
        { stableIdentity: 'h1-c', element: null },
      ],
    }))
    const d = findCode(out.diagnostics, 'STRICT_SINGLE_H1_MULTIPLE_H1')
    expect(d.severity).toBe('error')
    expect(d.location?.kind).toBe('multi-target')
    if (d.location?.kind !== 'multi-target') throw new Error('not multi-target')
    expect(d.location.targets).toHaveLength(2)
    expect(d.location.targets[0]).toEqual({ kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'h1-b' })
    expect(d.location.targets[1]).toEqual({ kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'h1-c' })
  })

  it('FIRST-H1: unique H1 not at top → canonical-node on the H1 itself', () => {
    const el = document.createElement('h1')
    el.setAttribute('data-line', '5')
    const out = computeDocumentDiagnostics(baseInput({
      markdown: '正文\n# 标题\n',
      headings: [{ level: 1, text: '标题', stableIdentity: 'the-h1', element: el }],
    }))
    const d = out.diagnostics.find(x => x.code.startsWith('STRICT_FIRST_H1_'))
    expect(d).toBeTruthy()
    expect(d!.severity).toBe('warning')
    expect(d!.location?.kind).toBe('canonical-node')
  })

  it('GAP: H2→H4 locates the OFFENDING H4 (canonical-node), not H2', () => {
    const out = computeDocumentDiagnostics(baseInput({
      headings: [
        { level: 2, text: 'A', stableIdentity: 'h2-a', element: null },
        { level: 4, text: 'B', stableIdentity: 'h4-b', element: null },
      ],
    }))
    const d = findCode(out.diagnostics, 'HEADING_LEVEL_GAP')
    expect(d.severity).toBe('error') // strict
    expect(d.location?.kind).toBe('canonical-node')
    if (d.location?.kind !== 'canonical-node') throw new Error('not canonical-node')
    expect(d.location.stableIdentity).toBe('h4-b')
  })

  it('EMPTY: real canonical empty H3 → canonical-node; plain non-canonical ## not EMPTY', () => {
    const out = computeDocumentDiagnostics(baseInput({
      headings: [{ level: 3, text: '', stableIdentity: 'empty-h3', element: null }],
    }))
    const d = findCode(out.diagnostics, 'HEADING_EMPTY_TEXT')
    expect(d.location?.kind).toBe('canonical-node')
    if (d.location?.kind !== 'canonical-node') throw new Error('not canonical-node')
    expect(d.location.stableIdentity).toBe('empty-h3')
    // A non-canonical `##` plain line (not in headings) must NOT produce EMPTY.
    const emptyCount = out.diagnostics.filter(x => x.code === 'HEADING_EMPTY_TEXT').length
    expect(emptyCount).toBe(1)
  })

  it('LATENT: two identical ## at line 10/20 → two source-range locations, no collision', () => {
    const out = computeDocumentDiagnostics(baseInput({
      latentAtxMarkers: [
        { line: 10, column: 0, markerLevel: 2, markerText: '##', text: '##' },
        { line: 20, column: 0, markerLevel: 2, markerText: '##', text: '##' },
      ],
    }))
    const latent = out.diagnostics.filter(x => x.code === 'LATENT_ATX_HEADING_MARKER_LEVEL_2')
    expect(latent).toHaveLength(2)
    expect(latent[0].location?.kind).toBe('source-range')
    expect(latent[1].location?.kind).toBe('source-range')
    if (latent[0].location?.kind !== 'source-range' || latent[1].location?.kind !== 'source-range') throw new Error('not source-range')
    expect(latent[0].location.startLine).toBe(10)
    expect(latent[1].location.startLine).toBe(20)
    expect(latent[0].id).not.toBe(latent[1].id)
  })

  it('ESCAPED: no latent input → zero LATENT diagnostics (escaped markers produce no record)', () => {
    const out = computeDocumentDiagnostics(baseInput({ latentAtxMarkers: [] }))
    expect(out.diagnostics.filter(x => x.code.startsWith('LATENT_ATX_HEADING_MARKER'))).toHaveLength(0)
  })

  it('EOF: terminal newline missing → document-end', () => {
    const out = computeDocumentDiagnostics(baseInput({ markdown: '# 标题\n\n正文' }))
    const d = findCode(out.diagnostics, 'DOCUMENT_TERMINAL_NEWLINE_MISSING')
    expect(d.location?.kind).toBe('document-end')
  })

  it('CODE-NAME + CODE-LANG: two warnings share the SAME code block stable identity', () => {
    const out = computeDocumentDiagnostics(baseInput({
      codes: [{ name: null, language: null, element: document.createElement('pre'), targetIdentity: 'block:code:0' }],
    }))
    const name = findCode(out.diagnostics, 'CODE_MISSING_NAME')
    const lang = findCode(out.diagnostics, 'CODE_MISSING_LANGUAGE')
    expect(name.location?.kind).toBe('block-node')
    expect(lang.location?.kind).toBe('block-node')
    if (name.location?.kind !== 'block-node' || lang.location?.kind !== 'block-node') throw new Error('not block-node')
    expect(name.location.stableIdentity).toBe('block:code:0')
    expect(lang.location.stableIdentity).toBe('block:code:0') // target sharing is legal
  })

  it('TABLE: TABLE_MISSING_NAME → block-node table', () => {
    const out = computeDocumentDiagnostics(baseInput({
      tables: [{ name: null, element: document.createElement('table'), targetIdentity: 'block:table:0' }],
    }))
    const d = findCode(out.diagnostics, 'TABLE_MISSING_NAME')
    expect(d.location?.kind).toBe('block-node')
    if (d.location?.kind !== 'block-node') throw new Error('not block-node')
    expect(d.location.blockKind).toBe('table')
  })

  it('FIGURE: FIGURE_MISSING_NAME → block-node figure', () => {
    const out = computeDocumentDiagnostics(baseInput({
      figures: [{ name: null, element: document.createElement('img'), targetIdentity: 'block:figure:0' }],
    }))
    const d = findCode(out.diagnostics, 'FIGURE_MISSING_NAME')
    expect(d.location?.kind).toBe('block-node')
    if (d.location?.kind !== 'block-node') throw new Error('not block-node')
    expect(d.location.blockKind).toBe('figure')
  })

  it('FORMULA: FORMULA_DUPLICATE_VISIBLE_TAG → block-node formula', () => {
    const out = computeDocumentDiagnostics(baseInput({
      formulas: [{ visibleTagTokens: ['1', '1'], element: document.createElement('div'), targetIdentity: 'block:formula:0' }],
    }))
    const d = findCode(out.diagnostics, 'FORMULA_DUPLICATE_VISIBLE_TAG')
    expect(d.location?.kind).toBe('block-node')
    if (d.location?.kind !== 'block-node') throw new Error('not block-node')
    expect(d.location.blockKind).toBe('formula')
  })

  it('DUPLICATE heading text: H2 方法 ×3 → multi-target (offending = #2,#3)', () => {
    const out = computeDocumentDiagnostics(baseInput({
      headings: [
        { level: 2, text: '方法', stableIdentity: 'm1', element: null },
        { level: 2, text: '方法', stableIdentity: 'm2', element: null },
        { level: 2, text: '方法', stableIdentity: 'm3', element: null },
      ],
    }))
    const d = findCode(out.diagnostics, 'HEADING_DUPLICATE_TEXT')
    expect(d.location?.kind).toBe('multi-target')
    if (d.location?.kind !== 'multi-target') throw new Error('not multi-target')
    expect(d.location.targets).toHaveLength(2)
    if (d.location.targets[0].kind !== 'canonical-node' || d.location.targets[1].kind !== 'canonical-node') throw new Error('not canonical')
    expect(d.location.targets[0].stableIdentity).toBe('m2')
    expect(d.location.targets[1].stableIdentity).toBe('m3')
  })
})

describe('LOC — universal resolver', () => {
  it('canonical-node resolves via CURRENT frame (stale DOM replaced → still PASS)', () => {
    const liveEl = document.createElement('h2')
    const diag: DocumentDiagnostic = {
      id: 'd1', documentKey: 'doc:key', severity: 'warning', category: 'heading',
      code: 'HEADING_EMPTY_TEXT', message: 'x',
      location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'the-h2' },
    }
    const r = resolveDiagnosticLocation(diag, diag.location, {
      documentKey: 'doc:key',
      getRoot: () => document.body,
      resolveHeadingIdentity: (id) => id === 'the-h2' ? liveEl : null,
      resolveSourceLine: () => null,
      resolveBlockIdentity: () => null,
    })
    expect(r.decision).toBe('RESOLVED')
    expect(r.element).toBe(liveEl)
  })

  it('canonical-node STALE when the identity vanished', () => {
    const diag: DocumentDiagnostic = {
      id: 'd1', documentKey: 'doc:key', severity: 'warning', category: 'heading',
      code: 'HEADING_EMPTY_TEXT', message: 'x',
      location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'gone' },
    }
    const r = resolveDiagnosticLocation(diag, diag.location, {
      documentKey: 'doc:key', getRoot: () => document.body,
      resolveHeadingIdentity: () => null, resolveSourceLine: () => null, resolveBlockIdentity: () => null,
    })
    expect(r.decision).toBe('STALE')
  })

  it('WRONG_DOCUMENT when the diagnostic belongs to another document', () => {
    const diag: DocumentDiagnostic = {
      id: 'd1', documentKey: 'doc:A', severity: 'warning', category: 'document',
      code: 'DOCUMENT_TERMINAL_NEWLINE_MISSING', message: 'x', location: { kind: 'document-end' },
    }
    const r = resolveDiagnosticLocation(diag, diag.location, {
      documentKey: 'doc:B', getRoot: () => document.body,
      resolveHeadingIdentity: () => null, resolveSourceLine: () => null, resolveBlockIdentity: () => null,
    })
    expect(r.decision).toBe('WRONG_DOCUMENT')
  })

  it('multi-target cycles by targetIndex', () => {
    const a = document.createElement('h2')
    const b = document.createElement('h2')
    const diag: DocumentDiagnostic = {
      id: 'd1', documentKey: 'doc:key', severity: 'error', category: 'document',
      code: 'STRICT_SINGLE_H1_MULTIPLE_H1', message: 'x',
      location: {
        kind: 'multi-target',
        targets: [
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'h1-b' },
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'h1-c' },
        ],
      },
    }
    const r0 = resolveDiagnosticLocation(diag, diag.location, {
      documentKey: 'doc:key', getRoot: () => document.body,
      resolveHeadingIdentity: (id) => id === 'h1-b' ? a : id === 'h1-c' ? b : null,
      resolveSourceLine: () => null, resolveBlockIdentity: () => null,
    }, 0)
    expect(r0.element).toBe(a)
    const r1 = resolveDiagnosticLocation(diag, diag.location, {
      documentKey: 'doc:key', getRoot: () => document.body,
      resolveHeadingIdentity: (id) => id === 'h1-b' ? a : id === 'h1-c' ? b : null,
      resolveSourceLine: () => null, resolveBlockIdentity: () => null,
    }, 1)
    expect(r1.element).toBe(b)
  })

  it('document-start → GO_TOP, document-end → GO_BOTTOM', () => {
    const dStart: DocumentDiagnostic = {
      id: 'd1', documentKey: 'doc:key', severity: 'error', category: 'document',
      code: 'STRICT_SINGLE_H1_NO_H1', message: 'x', location: { kind: 'document-start' },
    }
    const rTop = resolveDiagnosticLocation(dStart, dStart.location, {
      documentKey: 'doc:key', getRoot: () => document.body,
      resolveHeadingIdentity: () => null, resolveSourceLine: () => null, resolveBlockIdentity: () => null,
    })
    expect(rTop.scrollAction).toBe('GO_TOP')
    const dEnd: DocumentDiagnostic = {
      id: 'd2', documentKey: 'doc:key', severity: 'warning', category: 'document',
      code: 'DOCUMENT_TERMINAL_NEWLINE_MISSING', message: 'x', location: { kind: 'document-end' },
    }
    const rBottom = resolveDiagnosticLocation(dEnd, dEnd.location, {
      documentKey: 'doc:key', getRoot: () => document.body,
      resolveHeadingIdentity: () => null, resolveSourceLine: () => null, resolveBlockIdentity: () => null,
    })
    expect(rBottom.scrollAction).toBe('GO_BOTTOM')
  })

  it('UNSUPPORTED when no location (contract violation is explicit, never silent)', () => {
    const diag: DocumentDiagnostic = {
      id: 'd1', documentKey: 'doc:key', severity: 'warning', category: 'document',
      code: 'X', message: 'x', location: undefined,
    }
    expect(hasLocatableLocation(diag.location)).toBe(false)
    const r = resolveDiagnosticLocation(diag, diag.location, {
      documentKey: 'doc:key', getRoot: () => document.body,
      resolveHeadingIdentity: () => null, resolveSourceLine: () => null, resolveBlockIdentity: () => null,
    })
    expect(r.decision).toBe('UNSUPPORTED')
  })
})

describe('LOC — highlight + overlay locate interaction', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number)
    // jsdom has no scrollIntoView — stub it for the locator's scroll path.
    Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('HIGHLIGHT: locate adds the highlight class and removes it after the bounded window', () => {
    const el = document.createElement('h2')
    document.body.appendChild(el)
    const locator = new DocumentDiagnosticLocator({ getContainer: () => null })
    const r = locator.locate(el)
    expect(r.located).toBe(true)
    expect(el.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)).toBe(true)
    vi.advanceTimersByTime(1700)
    expect(el.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)).toBe(false)
  })

  it('LOCK + locate: locked edit guard does not block read-only locate (code block highlight + zero content mutation)', () => {
    const write = document.createElement('div')
    write.id = 'write'
    write.innerHTML = '<h1>标题</h1><p>正文</p><pre class="md-fences"></pre>'
    document.body.appendChild(write)

    const ctx: DocumentUtilitiesContext = {
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
    const providers: DocumentDiagnosticsProviders = {
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
    const host = new DocumentUtilityOverlayHost({ ctx, providers })
    host.mount()
    host.bindDocument()

    // Lock the edit guard via the toolbar lock button (class-based lookup).
    const lockBtn = document.querySelector<HTMLButtonElement>('.inkchapter-doc-toolbar__btn--lock')
    expect(lockBtn).toBeTruthy()
    lockBtn!.click()
    expect(host.editGuard.isLocked()).toBe(true)

    // Open the diagnostics drawer so items render.
    const diagBtn = document.querySelector<HTMLButtonElement>('.inkchapter-doc-toolbar__btn--diag')
    expect(diagBtn).toBeTruthy()
    diagBtn!.click()

    const before = write.textContent
    const drawer = document.querySelector('.inkchapter-doc-drawer') as HTMLElement
    const locateButtons = Array.from(drawer.querySelectorAll<HTMLButtonElement>('.inkchapter-doc-drawer__item-locate'))
    // Every published diagnostic item carries a locate button.
    expect(locateButtons.length).toBeGreaterThan(0)

    // Click the CODE_MISSING_LANGUAGE item's locate (block target = the <pre>).
    const pre = write.querySelector('pre') as HTMLElement
    const items = Array.from(drawer.querySelectorAll<HTMLElement>('.inkchapter-doc-drawer__item'))
    const langItem = items.find(el => (el.textContent ?? '').includes('代码块缺少语言标识')) ?? items[0]
    const langLocate = langItem.querySelector<HTMLButtonElement>('.inkchapter-doc-drawer__item-locate')
    expect(langLocate).toBeTruthy()
    langLocate!.click()
    vi.advanceTimersByTime(50)
    expect(pre.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)).toBe(true)
    // Read-only: the Markdown CONTENT is untouched; only the temporary
    // highlight class on an existing element changed (locate is navigation).
    expect(write.textContent).toBe(before)
    // Highlight is temporary — removed after the bounded window.
    vi.advanceTimersByTime(1700)
    expect(pre.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)).toBe(false)
    host.dispose()
  })
})
