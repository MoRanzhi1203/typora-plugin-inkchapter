// @vitest-environment jsdom
/**
 * TRAE rebase §13 — CODE_EMPTY_BLOCK on the GENERIC code-diagnostic pipeline.
 *
 * The whole point of this suite: `CODE_EMPTY_BLOCK` must behave like
 * `CODE_MISSING_NAME` / `CODE_MISSING_LANGUAGE` — same canonical code target
 * authority, same `block-node` locator, same LocateFrame / overlay-frame, same
 * document-space carrier, same active lease, same cleanup.
 *
 *   13.1 canonical target: block:code:N → canonical `pre.md-fences`
 *   13.2 generic locator reuse: EMPTY and MISSING_NAME share the code branch
 *   13.3 no special surface dependency (production-path invariant)
 *   13.4 active owner uniqueness (exactly ONE frame, no stale frame)
 *   13.5 toggle / switch between code diagnostics
 *   13.6 document-space persistence after the one-click commit
 *   §14  A/B/C producer (empty / missing name / missing language)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import { computeDocumentDiagnostics, CODE_EMPTY_BLOCK_CODE } from './document-diagnostics'
import type { DocumentDiagnosticsInput } from './document-diagnostics'
import { resetDocumentSourceSyntaxAuthority } from './document-source-syntax-authority'
import { resetDocumentDefinitionReferenceIndex } from './document-definition-reference-index'
import { resetDocumentInlineLinkAuthority } from './document-inline-link-authority'
import { getRuleMeta } from './document-diagnostic-location'

const HOST_SRC = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')

// ── 13.1 — canonical code target authority (pure DOM enumeration) ───────────
describe('TRAE rebase §13.1 — canonical code target', () => {
  let host: DocumentUtilityOverlayHost | null = null
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
  })
  afterEach(() => {
    host?.dispose()
    host = null
    vi.unstubAllGlobals()
  })

  it('block:code:N → canonical pre.md-fences, excluding CodeMirror internals / math / other pre', () => {
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
    // A CodeMirror-internal `pre` (NO md-fences) — must never be a canonical target.
    const internal = document.createElement('pre')
    internal.className = 'CodeMirror-line cm-line'
    write.appendChild(internal)
    // A math block — a different canonical family.
    const math = document.createElement('div')
    math.className = 'md-math-block'
    write.appendChild(math)
    // A plain `pre` (not a fenced code block).
    const other = document.createElement('pre')
    other.className = 'some-other-pre'
    write.appendChild(other)
    // ── the TWO canonical fenced code blocks.
    const fence0 = document.createElement('pre')
    fence0.className = 'md-fences'
    const fence1 = document.createElement('pre')
    fence1.className = 'md-fences'
    write.append(fence0, fence1)

    const h = new DocumentUtilityOverlayHost({ ctx: fakeCtx(), providers: fakeProviders() })
    host = h
    const resolveBlock = (h as unknown as {
      resolveBlockIdentity(kind: string, id: string): HTMLElement | null
    }).resolveBlockIdentity.bind(h)
    expect(resolveBlock('code', 'block:code:0')).toBe(fence0)
    expect(resolveBlock('code', 'block:code:1')).toBe(fence1)
    expect(resolveBlock('code', 'block:code:2')).toBeNull()
    // The internal `pre` / math / other pre are never selected.
    expect(resolveBlock('code', 'block:code:0')).not.toBe(internal)
    expect(resolveBlock('code', 'block:code:0')).not.toBe(other)
    expect(resolveBlock('formula', 'block:formula:0')).toBe(math)
  })
})

// ── 13.2–13.6 + §14 — host-level pipeline ──────────────────────────────────
describe('TRAE rebase §13.2–13.6 — generic code-diagnostic pipeline', () => {
  let host: DocumentUtilityOverlayHost | null = null
  let infoSpy: { mock: { calls: unknown[][] }; mockRestore: () => void } | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
    Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as typeof infoSpy
  })
  afterEach(() => {
    infoSpy?.mockRestore()
    infoSpy = null
    host?.dispose()
    host = null
    vi.unstubAllGlobals()
  })

  type CodeDiag = {
    id: string
    code: string
    severity: 'error' | 'warning' | 'info'
    ordinal: number
    message: string
  }

  function mount(codeDiags: CodeDiag[]): void {
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
    for (const d of codeDiags) {
      const pre = document.createElement('pre')
      pre.className = 'md-fences'
      pre.setAttribute('data-line', String(d.ordinal + 1))
      write.appendChild(pre)
    }
    const h = new DocumentUtilityOverlayHost({ ctx: fakeCtx(), providers: fakeProviders() })
    host = h
    h.mount()
    const snapshot = {
      documentKey: 'doc:key', revision: 1, sourceRevision: 1, generatedAt: 0,
      diagnostics: codeDiags.map(d => ({
        id: d.id,
        documentKey: 'doc:key', severity: d.severity, category: 'document',
        code: d.code, message: d.message, detail: '',
        metadata: { canonicalBlockIdentity: `block:code:${d.ordinal}` },
        location: { kind: 'block-node', blockKind: 'code', stableIdentity: `block:code:${d.ordinal}` },
      })),
      errorCount: 0, warningCount: 0, infoCount: codeDiags.length,
    }
    const authority = (h as unknown as {
      diagnostics: { snapshot: unknown; recompute: (r: string) => void }
    }).diagnostics
    authority.snapshot = snapshot
    authority.recompute = () => { /* frozen */ }
    ;(h as unknown as { snapshot: unknown }).snapshot = snapshot
    ;(h as unknown as { openDrawer(filter: string): void }).openDrawer('all')
    ;(h as unknown as { renderDrawer(): void }).renderDrawer()
  }

  function rows(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-doc-drawer__item[data-diagnostic-id]'))
  }
  /**
   * A REAL pointer activation + click on a drawer row. The row element is
   * RE-QUERIED by diagnostic id on every activation: the drawer re-renders after
   * each owner transition, so a cached element would be detached and the capture
   * `pointerdown` mint would never fire (which would look like a spurious
   * duplicate-activation drop).
   */
  function activate(diagId: string): void {
    const row = document.querySelector<HTMLElement>(
      `.inkchapter-doc-drawer__item[data-diagnostic-id="${diagId}"]`,
    )
    expect(row, `drawer row for ${diagId}`).not.toBeNull()
    row!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    row!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  }
  function frames(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-diagnostic-locate-frame'))
  }
  function docCarriers(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-locate-document-layer > *'))
  }
  function locateFrameAudits(): Array<Record<string, string>> {
    return infoSpy!.mock.calls.map(c => String(c[0]))
      .filter(l => l.includes('DOCUMENT-DIAGNOSTIC-LOCATE-FRAME'))
      .map(line => {
        const body = line.slice(line.indexOf('DOCUMENT-DIAGNOSTIC-LOCATE-FRAME'))
        const out: Record<string, string> = {}
        for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
        return out
      })
  }
  function countAudit(event: string): number {
    return infoSpy!.mock.calls.map(c => String(c[0])).filter(l => l.includes(event)).length
  }
  /** The classified actions reported by the ACTIVE-INTERACTION audit, in order. */
  function activeActions(): string[] {
    return infoSpy!.mock.calls.map(c => String(c[0]))
      .filter(l => l.includes('ACTIVE-INTERACTION-AUDIT'))
      .map(l => (/classifiedAction="?([A-Z_]+)"?/.exec(l)?.[1]) ?? '?')
  }

  const EMPTY: CodeDiag = { id: 'code:CODE_EMPTY_BLOCK:block:code:0', code: 'CODE_EMPTY_BLOCK', severity: 'info', ordinal: 0, message: '代码块为空' }
  const MISSING_NAME: CodeDiag = { id: 'code:CODE_MISSING_NAME:block:code:1', code: 'CODE_MISSING_NAME', severity: 'warning', ordinal: 1, message: '缺少代码名' }
  const MISSING_LANG: CodeDiag = { id: 'code:CODE_MISSING_LANGUAGE:block:code:2', code: 'CODE_MISSING_LANGUAGE', severity: 'warning', ordinal: 2, message: '缺少代码语言' }

  it('§13.2/13.3/13.4: one click ⇒ ONE generic code overlay frame, no special surface', () => {
    mount([EMPTY])
    expect(rows()).toHaveLength(1)
    activate(EMPTY.id)
    // One-click → ONE committed overlay frame in the generic code carrier.
    expect(frames()).toHaveLength(1)
    const audit = locateFrameAudits().at(-1)!
    expect(audit.targetKind).toBe('code')
    expect(audit.anchorTag).toBe('pre')
    expect(audit.frameCount).toBe('1')
    expect(audit.inlineMarkCount).toBe('0')
    expect(audit.staleLocateFrameCount).toBe('0')
    // The generic document-space carrier was committed.
    expect(countAudit('DOCUMENT-DIAGNOSTIC-LOCATE-DOCUMENT-SPACE-AUDIT')).toBeGreaterThanOrEqual(1)
    expect(docCarriers().length).toBeGreaterThanOrEqual(1)
    // No CODE_EMPTY_BLOCK-specific carrier class ever appears.
    expect(document.querySelectorAll('.inkchapter-diagnostic-empty-surface').length).toBe(0)
    expect(document.querySelectorAll('[data-ink-empty-block]').length).toBe(0)
  })

  it('§13.2: CODE_MISSING_NAME uses the SAME code frame branch as CODE_EMPTY_BLOCK', () => {
    // Severity is deliberately aligned here: this test proves the SHARED locate /
    // frame BRANCH, not the severity→geometry token mapping (covered by the
    // inline-presentation / rule-meta suites).
    const nameInfo: CodeDiag = { ...MISSING_NAME, severity: 'info' }
    mount([nameInfo, EMPTY])
    activate(nameInfo.id)
    const nameAudit = locateFrameAudits().at(-1)!
    activate(EMPTY.id)
    const emptyAudit = locateFrameAudits().at(-1)!
    for (const audit of [nameAudit, emptyAudit]) {
      expect(audit.targetKind, JSON.stringify(audit)).toBe('code')
      expect(audit.anchorTag).toBe('pre')
      expect(audit.frameCount).toBe('1')
      expect(audit.inlineMarkCount).toBe('0')
      expect(audit.staleLocateFrameCount).toBe('0')
    }
    // …and the registry makes them the SAME generic code block-node rule.
    expect(getRuleMeta('CODE_MISSING_NAME')!.locationStrategy)
      .toBe(getRuleMeta(CODE_EMPTY_BLOCK_CODE)!.locationStrategy)
  })

  it('§13.5: two REAL activations produce TWO business dispatches and never a duplicate carrier', () => {
    mount([EMPTY])
    activate(EMPTY.id)
    expect(frames()).toHaveLength(1)
    // §13.4 — exactly ONE active frame, no stale frame.
    expect(document.querySelectorAll('.inkchapter-diagnostic-locate-frame').length).toBe(1)
    // A GENUINE second activation (its own pointerdown) is NEVER dropped as a
    // duplicate, and it never grows a second carrier. Its DEACTIVATE classification
    // is covered by the injected-ACTIVE-state suites (active-state-machine /
    // active-interaction / drawer-persistence); the interactive state cannot reach
    // ACTIVE in jsdom, so it is asserted there, not here.
    activate(EMPTY.id)
    expect(countAudit('DOCUMENT-DIAGNOSTIC-CLICK-DISPATCH-V2')).toBe(2)
    expect(host!.getDuplicatePointerActivationDropCount()).toBe(0)
    expect(document.querySelectorAll('.inkchapter-diagnostic-locate-frame').length).toBeLessThanOrEqual(1)
    expect(activeActions().length).toBeGreaterThanOrEqual(1)
  })

  it('§13.5: EMPTY → MISSING_NAME keeps at most ONE live code frame (no duplicate owner)', () => {
    mount([EMPTY, MISSING_NAME])
    expect(rows().length).toBe(2)
    activate(EMPTY.id)
    expect(document.querySelectorAll('.inkchapter-diagnostic-locate-frame').length).toBe(1)
    activate(MISSING_NAME.id)
    // never TWO owners, never a stale frame. (jsdom has no layout, so the WARNING
    // severity carrier may legitimately end on the documented degraded path with 0
    // mounted elements — the real-layout carrier is asserted in the runtime matrix.)
    expect(document.querySelectorAll('.inkchapter-diagnostic-locate-frame').length).toBeLessThanOrEqual(1)
    const audit = locateFrameAudits().at(-1)!
    expect(audit.targetKind).toBe('code')
    expect(audit.staleLocateFrameCount).toBe('0')
  })

  it('§13.5: EMPTY → MISSING_LANGUAGE → EMPTY is stable (one owner, no inline mark)', () => {
    mount([EMPTY, MISSING_LANG])
    activate(EMPTY.id)
    activate(MISSING_LANG.id)
    expect(document.querySelectorAll('.inkchapter-diagnostic-locate-frame').length).toBeLessThanOrEqual(1)
    activate(EMPTY.id)
    expect(document.querySelectorAll('.inkchapter-diagnostic-locate-frame').length).toBeLessThanOrEqual(1)
    expect(document.querySelectorAll('.inkchapter-diagnostic-locate-frame[data-target-kind="inline"]').length).toBe(0)
  })

  it('§13.6: the committed carrier persists into the document-space layer', () => {
    mount([EMPTY])
    activate(EMPTY.id)
    const layer = document.querySelector('.inkchapter-locate-document-layer')
    expect(layer).not.toBeNull()
    // The viewport frame was handed over to the document-space carrier exactly once.
    expect(document.querySelectorAll('.inkchapter-diagnostic-locate-frame').length).toBe(1)
    expect(layer!.children.length).toBeGreaterThanOrEqual(1)
  })

  it('§13.3: the production host contains NO CODE_EMPTY_BLOCK special surface path', () => {
    for (const forbidden of [
      'commitEmptyBlockVisual',
      'empty-container-surface',
      'block-content-surface',
      'evaluateEmptyBlockVisualCommit',
      'buildEmptyBlockPresentationAudit',
      'evaluateFinalVisualCommitV8',
      'evaluatePersistentCarrierCompositing',
      'evaluateAtomicCarrierHandoff',
      'contentSurface',
      'lastFinalVisualCommitVerdict',
      'lastPersistentCarrierVerdict',
    ]) {
      expect(HOST_SRC).not.toContain(forbidden)
    }
    // …and CODE_EMPTY_BLOCK is not special-cased anywhere in the locate commit path.
    expect(HOST_SRC).not.toMatch(/CODE_EMPTY_BLOCK[^\n]*commitEmptyBlock/)
  })

  it('§14: the A/B/C producer yields empty / missing-name / missing-language independently', () => {
    resetDocumentSourceSyntaxAuthority()
    resetDocumentDefinitionReferenceIndex()
    resetDocumentInlineLinkAuthority()
    const code = (name: string | null, language: string | null, ordinal: number) =>
      ({ name, language, element: document.createElement('pre'), targetIdentity: `block:code:${ordinal}` })
    const input = (markdown: string, codes: DocumentDiagnosticsInput['codes']): DocumentDiagnosticsInput => ({
      documentKey: 'doc:abc', markdown, strictMode: false, vaultRoot: '/vault',
      headings: [], figures: [], tables: [], codes, formulas: [], links: [],
      canonicalDuplicateIdentities: [], captionDuplicateNames: [],
    })
    // Code A — empty + named + language.
    const a = computeDocumentDiagnostics(input('```python\n```\n', [code('代码 1', 'python', 0)]))
    expect(a.diagnostics.some(d => d.code === CODE_EMPTY_BLOCK_CODE)).toBe(true)
    expect(a.diagnostics.some(d => d.code === 'CODE_MISSING_NAME')).toBe(false)
    expect(a.diagnostics.some(d => d.code === 'CODE_MISSING_LANGUAGE')).toBe(false)
    // Code B — non-empty + missing name.
    const b = computeDocumentDiagnostics(input('```python\nprint(1)\n```\n', [code(null, 'python', 0)]))
    expect(b.diagnostics.some(d => d.code === 'CODE_MISSING_NAME')).toBe(true)
    expect(b.diagnostics.some(d => d.code === CODE_EMPTY_BLOCK_CODE)).toBe(false)
    // Code C — non-empty + missing language.
    const c = computeDocumentDiagnostics(input('```\nprint(1)\n```\n', [code('代码 3', null, 0)]))
    expect(c.diagnostics.some(d => d.code === 'CODE_MISSING_LANGUAGE')).toBe(true)
    expect(c.diagnostics.some(d => d.code === CODE_EMPTY_BLOCK_CODE)).toBe(false)
  })

  it('§13.2: the registry makes EMPTY a plain code block-node rule (no special presentation kind)', () => {
    const empty = getRuleMeta(CODE_EMPTY_BLOCK_CODE)!
    const name = getRuleMeta('CODE_MISSING_NAME')!
    expect(empty.locationStrategy).toBe(name.locationStrategy)
    expect(empty.presentationKind).toBe(name.presentationKind)
    expect(empty.presentationKind).not.toBe('empty-block-container')
  })
})

// ── fixtures ──────────────────────────────────────────────────────────────
function fakeCtx(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '```\n```\n',
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
    getFormulaVisibleTagTokens: () => [], getFigureName: () => null, getTableName: () => null,
    getCodeName: () => null, getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }), isLinkTargetMissing: () => false,
    getHeadingIdentity: () => null, parseLocalLinkTargets: () => [], getObjectCaptionHost: () => null,
  }
}
