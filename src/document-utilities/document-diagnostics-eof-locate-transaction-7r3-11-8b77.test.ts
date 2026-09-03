// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.8 — Standard EOF newline policy (supersedes the B.7.7
 * exactly-one-blank contract) + Locate Transaction lock.
 *
 * P0-1: standard file-level EOF policy — terminal newline required; 0~1 extra
 *       trailing blank lines PASS; >=2 extra blank lines EXCESSIVE. Copy says
 *       "应以一个换行符结束" / "存在多个连续空行" (never "保留一个空行").
 * P0-2: a locate is a NON-REENTRANT transaction: busy clicks IGNORE_BUSY,
 *       never queued, never advance targetIndex; cursor commits only after
 *       the scroll settles + highlight; document switch cancels the tx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeDocumentDiagnostics, computeEofNewlinePolicy } from './document-diagnostics'
import type { DocumentDiagnosticsInput, DocumentDiagnosticsComputed } from './document-diagnostics'
import { DocumentDiagnosticsAuthority, type DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DiagnosticCanonicalHeadingAuthorityResult } from './document-h1-authority-bridge'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

function h1Authority(): DiagnosticCanonicalHeadingAuthorityResult {
  return {
    state: 'READY', reason: 'READY', documentKey: 'doc', framePresent: true,
    frameDocumentKey: 'doc', semanticRevision: 1, frameGeneration: 1,
    canonicalEntryCount: 0, mappedEntryCount: 0, invalidEntryCount: 0,
    physicalLevels: [], headingFacts: [], h1Facts: [], h1Count: 0, h1StableIdentities: [],
  }
}

function inputOf(markdown: string | null): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc', markdown, strictMode: true, vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
  }
}

function codesOf(r: DocumentDiagnosticsComputed): string[] {
  return r.diagnostics.filter(d => d.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING' || d.code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE').map(d => d.code)
}

// ── P0-1 standard EOF newline policy + copy ──────────────────
describe('EOF — standard newline policy', () => {
  it('MISSING_TERMINAL_NEWLINE / 0-1_EXTRA_PASS / 2_PLUS_EXCESSIVE over logical lines', () => {
    expect(computeEofNewlinePolicy('a').verdict).toBe('MISSING_TERMINAL_NEWLINE') // no newline at EOF
    expect(computeEofNewlinePolicy('a\n').verdict).toBe('PASS') // terminal newline, 0 extra
    expect(computeEofNewlinePolicy('a\n\n').verdict).toBe('PASS') // terminal newline, 1 extra
    expect(computeEofNewlinePolicy('a\n\n\n').verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES') // 2 extra
    expect(computeEofNewlinePolicy('a\n\n\n\n').verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES') // 3 extra
    expect(computeEofNewlinePolicy('a\r\n').verdict).toBe('PASS')
    expect(computeEofNewlinePolicy('a\r\n\r\n').verdict).toBe('PASS')
    expect(computeEofNewlinePolicy('a\r\n\r\n\r\n').verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES')
    expect(computeEofNewlinePolicy('a\n   \n').verdict).toBe('PASS') // whitespace-only blank is legal
    expect(computeEofNewlinePolicy('a\n\t\n \n').verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES')
  })

  it('LIVE_RECONCILE transitions MISSING↔PASS↔EXCESSIVE flip the published diagnostic', () => {
    const step = (md: string | null): string[] => codesOf(computeDocumentDiagnostics(inputOf(md)))
    expect(step('a')).toEqual(['DOCUMENT_TERMINAL_NEWLINE_MISSING']) // no terminal newline → MISSING
    expect(step('a\n')).toEqual([]) // terminal newline, 0 extra → PASS
    expect(step('a\n\n')).toEqual([]) // 1 extra blank → still PASS
    expect(step('a\n\n\n')).toEqual(['DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE']) // 2 extra → EXCESSIVE
    expect(step('a\n\n')).toEqual([]) // back to 1 extra → PASS (excessive removed)
    expect(step('a\n')).toEqual([]) // back to 0 extra → PASS
    expect(step('a')).toEqual(['DOCUMENT_TERMINAL_NEWLINE_MISSING']) // terminal newline deleted → MISSING
  })

  it('MISSING and EXCESSIVE are mutually exclusive + standard copy', () => {
    const miss = computeDocumentDiagnostics(inputOf('a'))
    const ex = computeDocumentDiagnostics(inputOf('a\n\n\n'))
    expect(codesOf(miss)).toEqual(['DOCUMENT_TERMINAL_NEWLINE_MISSING'])
    expect(codesOf(ex)).toEqual(['DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE'])
    const missDetail = miss.diagnostics.find(d => d.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING')?.detail ?? ''
    const missMsg = miss.diagnostics.find(d => d.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING')?.message ?? ''
    const exDetail = ex.diagnostics.find(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')?.detail ?? ''
    expect(missMsg).toContain('文档末尾缺少换行符')
    expect(missMsg).not.toContain('缺少空行')
    expect(missDetail).toContain('应以一个换行符结束')
    expect(missDetail).not.toContain('保留一个空行')
    expect(exDetail).toContain('存在多个连续空行')
    expect(exDetail).not.toContain('应仅保留一个空行')
    // EOF diagnostics anchor at document-end.
    expect(miss.diagnostics.find(d => d.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING')?.location).toEqual({ kind: 'document-end' })
    expect(ex.diagnostics.find(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')?.location).toEqual({ kind: 'document-end' })
  })
})

// ── P0-2 Locate transaction lock ───────────────────────────
describe('LOCATE — non-reentrant transaction', () => {
  let host: DocumentUtilityOverlayHost
  let write: HTMLElement
  let h1s: HTMLElement[]
  let infoSpy: ReturnType<typeof vi.spyOn>

  const docKey = 'multi-h1-doc'

  function ctx(): DocumentUtilitiesContext {
    return {
      authority: {
        getActiveFilePath: () => `/vault/${docKey}.md`,
        getDocumentKey: () => docKey,
        getMarkdown: () => '# A\n# B\n# C\n',
        isStrictMode: () => true,
        vaultRoot: '/vault',
        getCanonicalDuplicateIdentities: () => [],
        getCaptionDuplicateNames: () => [],
      },
      hasActiveDocument: () => true,
    }
  }

  function providers(): DocumentDiagnosticsProviders {
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
      getCanonicalH1Facts: () => h1Authority(),
    }
  }

  function injectMultiH1Snapshot(authorityOverride?: boolean): string {
    // Manual snapshot with a multi-target diagnostic (3 H1s → offending 2..3).
    const target = (id: string): DocumentDiagnosticsSnapshot['diagnostics'][number]['location'] => ({
      kind: 'canonical-node', nodeKind: 'heading', stableIdentity: id,
    })
    const diag = {
      id: 'multi-h1',
      documentKey: docKey,
      severity: 'error' as const,
      category: 'document' as const,
      code: 'STRICT_SINGLE_H1_MULTIPLE_H1',
      message: '严格模式要求全文只能包含一个一级标题（H1），当前检测到 3 个。',
      targetIdentity: 'single-h1:multiple-h1:H1:idx:0',
      metadata: { ruleId: 'STRICT-SINGLE-H1', h1Count: 3 },
      location: { kind: 'multi-target' as const, targets: [target('B-id'), target('C-id')] },
    }
    const snapshot = {
      documentKey: docKey,
      revision: 9,
      sourceRevision: 1,
      generatedAt: 0,
      diagnostics: [diag] as DocumentDiagnosticsSnapshot['diagnostics'],
      errorCount: 1,
      warningCount: 0,
      infoCount: 0,
    }
    // The locate controller reads the AUTHORITY snapshot; the drawer renderer
    // reads the host snapshot. Inject both so the click path finds the diag.
    ;(host['diagnostics'] as unknown as { snapshot: DocumentDiagnosticsSnapshot | null }).snapshot = snapshot as DocumentDiagnosticsSnapshot
    host['snapshot'] = snapshot as DocumentDiagnosticsSnapshot
    host['renderDrawer']()
    return diag.id
  }

  function firstLocateButton(): HTMLButtonElement | null {
    return document.querySelector('.inkchapter-doc-drawer__item-locate')
  }

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.useFakeTimers()
    write = document.createElement('div')
    write.id = 'write'
    const mk = (tag: string, id: string): HTMLElement => {
      const el = document.createElement(tag)
      el.setAttribute('data-id', id)
      el.textContent = id
      write.appendChild(el)
      return el
    }
    h1s = [mk('h1', 'A-id'), mk('h1', 'B-id'), mk('h1', 'C-id')]
    document.body.appendChild(write)
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number) as typeof requestAnimationFrame)
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
    Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
    host = new DocumentUtilityOverlayHost({ ctx: ctx(), providers: providers() })
    host.mount()
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy?.mockRestore()
    host.dispose()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function countTx(needle: string): number {
    return infoSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('DOCUMENT-DIAGNOSTIC-LOCATE-TRANSACTION') && String(c[0]).includes(needle)).length
  }

  it('BUSY_CLICK_IGNORED + NO_TARGET_ADVANCE: during settle, repeated clicks are ignored and the cursor never advances', () => {
    injectMultiH1Snapshot()
    const id = 'multi-h1'
    const btn = firstLocateButton()!
    btn.click()
    // Transaction is now RESOLVING/SCROLLING (settle still pending).
    expect(host.isLocateTransactionActive()).toBe(true)
    // UI busy state.
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toBe('定位中…')
    // 9 more controller-level clicks while busy → IGNORE_BUSY.
    for (let i = 0; i < 9; i++) host['locateDiagnostic'](id)
    expect(countTx('IGNORE_BUSY')).toBe(9)
    // Cursor was NOT advanced by the ignored clicks.
    expect(host['multiTargetCursor'].get(id)).toBeUndefined()
    // Let the settle finish (2 stable frames) → commit next index.
    vi.advanceTimersByTime(40)
    expect(host.isLocateTransactionActive()).toBe(false)
    expect(host['multiTargetCursor'].get(id)).toBe(1)
    // UI restored.
    expect(firstLocateButton()!.disabled).toBe(false)
    expect(firstLocateButton()!.textContent).toBe('定位')
    // The completed transaction commits the next index exactly once.
    expect(host['multiTargetCursor'].get(id)).toBe(1)
  })

  it('MULTI_H1_NORMAL_CYCLE: settle then re-click advances target 0→1→2→0', () => {
    injectMultiH1Snapshot()
    const id = 'multi-h1'
    const clickAndSettle = (): void => {
      const btn = firstLocateButton()!
      btn.click()
      vi.advanceTimersByTime(40)
      expect(host.isLocateTransactionActive()).toBe(false)
    }
    clickAndSettle()
    expect(host['multiTargetCursor'].get(id)).toBe(1)
    clickAndSettle()
    expect(host['multiTargetCursor'].get(id)).toBe(0) // 2 targets: 1→(commit)→0
    expect(host['multiTargetCursor'].get(id)).not.toBeUndefined()
  })

  it('DOCUMENT_SWITCH_CANCEL: active transaction is cancelled on bindDocument (no commit)', () => {
    injectMultiH1Snapshot()
    const id = 'multi-h1'
    firstLocateButton()!.click()
    expect(host.isLocateTransactionActive()).toBe(true)
    host.bindDocument() // document switch
    expect(host.isLocateTransactionActive()).toBe(false)
    expect(host['multiTargetCursor'].get(id)).toBeUndefined() // never committed
  })

  it('RAPID_CLICK_X10 totals accepted=1 ignoredBusy=9 and advance=1 after settle', () => {
    injectMultiH1Snapshot()
    const id = 'multi-h1'
    // click #1 accepted
    host['locateDiagnostic'](id)
    // clicks #2..#10 ignored while busy
    for (let i = 0; i < 9; i++) host['locateDiagnostic'](id)
    expect(countTx('IGNORE_BUSY')).toBe(9)
    vi.advanceTimersByTime(40)
    expect(host['multiTargetCursor'].get(id)).toBe(1)
  })

  it('TARGET_ALREADY_VISIBLE: settle completes without requiring an actual scroll event', () => {
    // jsdom container has no scrolling; the 2-stable-frame gate settles the tx.
    injectMultiH1Snapshot()
    firstLocateButton()!.click()
    expect(host.isLocateTransactionActive()).toBe(true)
    vi.advanceTimersByTime(40)
    expect(host.isLocateTransactionActive()).toBe(false)
    expect(host['multiTargetCursor'].get('multi-h1')).toBe(1)
  })
})
