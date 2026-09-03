// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.7.6+8B.8 — Four-Issue Closure matrix (EOF policy migrated
 * to the standard file-level newline rule in 8B.8):
 *
 *   P1-4 EOF newline policy (no terminal newline → MISSING_TERMINAL_NEWLINE;
 *         terminal newline + 0~1 extra blank → PASS; terminal newline +
 *         >=2 extra blank → EXCESSIVE; logical-line based, mutually exclusive)
 *         + document-end locator;
 *   P0-2 compound locator (caption primary + object secondary highlight);
 *   P0-3 resource base = ACTIVE DOCUMENT directory (real-fs authority test).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { computeDocumentDiagnostics, computeEofNewlinePolicy } from './document-diagnostics'
import { parseLocalLinkTargets } from './document-utilities'
import type { DocumentDiagnosticsInput } from './document-diagnostics'
import { DocumentDiagnosticsAuthority, type DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DiagnosticCanonicalHeadingAuthorityResult } from './document-h1-authority-bridge'
import { DocumentDiagnosticLocator, DIAGNOSTIC_HIGHLIGHT_CLASS } from './document-diagnostic-locator'
import { resolveDiagnosticLocation } from './document-diagnostic-location'
import type { DocumentDiagnostic, DiagnosticLocation } from './diagnostics-types'

function hasCode(diags: readonly { code: string }[], code: string): boolean {
  return diags.some(d => d.code === code)
}

function h1Authority(): DiagnosticCanonicalHeadingAuthorityResult {
  return {
    state: 'READY', reason: 'READY', documentKey: 'doc', framePresent: true,
    frameDocumentKey: 'doc', semanticRevision: 1, frameGeneration: 1,
    canonicalEntryCount: 0, mappedEntryCount: 0, invalidEntryCount: 0,
    physicalLevels: [], headingFacts: [], h1Facts: [], h1Count: 0, h1StableIdentities: [],
  }
}

// ── P1-4 EOF newline policy ────────────────────────────────
describe('EOF-NEWLINE — standard file-level newline policy (mutually exclusive)', () => {
  function inputOf(markdown: string | null): DocumentDiagnosticsInput {
    return {
      documentKey: 'doc', markdown, strictMode: true, vaultRoot: '/vault',
      headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
      canonicalDuplicateIdentities: [], captionDuplicateNames: [],
    }
  }

  it('NO_TERMINAL_NEWLINE_MISSING: "a" → DOCUMENT_TERMINAL_NEWLINE_MISSING, never EXCESSIVE', () => {
    for (const md of ['a', 'a   ']) {
      const p = computeEofNewlinePolicy(md)
      expect(p.verdict).toBe('MISSING_TERMINAL_NEWLINE')
      expect(p.hasTerminalNewline).toBe(false)
      expect(p.extraTrailingBlankLineCount).toBe(0)
      const r = computeDocumentDiagnostics(inputOf(md))
      expect(hasCode(r.diagnostics, 'DOCUMENT_TERMINAL_NEWLINE_MISSING')).toBe(true)
      expect(hasCode(r.diagnostics, 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')).toBe(false)
    }
  })

  it('TERMINAL_NEWLINE_0_EXTRA_PASS: "a\\n" / "a\\r\\n" → PASS, no EOF diagnostic', () => {
    for (const md of ['a\n', 'a\r\n']) {
      const p = computeEofNewlinePolicy(md)
      expect(p.verdict).toBe('PASS')
      expect(p.hasTerminalNewline).toBe(true)
      expect(p.extraTrailingBlankLineCount).toBe(0)
      const r = computeDocumentDiagnostics(inputOf(md))
      expect(hasCode(r.diagnostics, 'DOCUMENT_TERMINAL_NEWLINE_MISSING')).toBe(false)
      expect(hasCode(r.diagnostics, 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')).toBe(false)
    }
  })

  it('ONE_EXTRA_BLANK_PASS: terminal newline + 1 blank (incl. whitespace-only) → PASS, no EOF diagnostic', () => {
    for (const md of ['a\n\n', 'a\n   \n', 'a\r\n\r\n']) {
      const p = computeEofNewlinePolicy(md)
      expect(p.verdict).toBe('PASS')
      expect(p.extraTrailingBlankLineCount).toBe(1)
      const r = computeDocumentDiagnostics(inputOf(md))
      expect(hasCode(r.diagnostics, 'DOCUMENT_TERMINAL_NEWLINE_MISSING')).toBe(false)
      expect(hasCode(r.diagnostics, 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')).toBe(false)
    }
  })

  it('TWO_PLUS_EXTRA_BLANK_EXCESSIVE: terminal newline + >=2 extra blanks → EXCESSIVE, never MISSING', () => {
    for (const md of ['a\n\n\n', 'a\n\n\n\n', 'a\n\n\n\n\n', 'a\n\t\n \n', 'a\r\n\r\n\r\n']) {
      const p = computeEofNewlinePolicy(md)
      expect(p.verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES')
      expect(p.extraTrailingBlankLineCount).toBeGreaterThanOrEqual(2)
      const r = computeDocumentDiagnostics(inputOf(md))
      expect(hasCode(r.diagnostics, 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')).toBe(true)
      expect(hasCode(r.diagnostics, 'DOCUMENT_TERMINAL_NEWLINE_MISSING')).toBe(false)
    }
  })

  it('interior blank lines never count toward the trailing policy', () => {
    // "a\n\n\nb\n" — interior blanks before b, then EOF with terminal newline
    // and 0 extra blanks after b → PASS.
    const p = computeEofNewlinePolicy('a\n\n\nb\n')
    expect(p.verdict).toBe('PASS')
    expect(p.extraTrailingBlankLineCount).toBe(0)
    const r = computeDocumentDiagnostics(inputOf('a\n\n\nb\n'))
    expect(hasCode(r.diagnostics, 'DOCUMENT_TERMINAL_NEWLINE_MISSING')).toBe(false)
    expect(hasCode(r.diagnostics, 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')).toBe(false)
  })

  it('empty / whitespace-only document → SKIP (no EOF diagnostic)', () => {
    expect(computeEofNewlinePolicy('').verdict).toBe('SKIP')
    expect(computeEofNewlinePolicy('   \n\t\n').verdict).toBe('SKIP')
  })
})

describe('DOCUMENT_END_LOCATOR — EOF diagnostics resolve to GO_BOTTOM', () => {
  it('EXCESSIVE and MISSING use document-end (never SOURCE_LINE_NOT_FOUND/STALE)', () => {
    const mk = (code: string): DocumentDiagnostic => ({
      id: code, documentKey: 'doc', severity: 'warning', category: 'document', code,
      message: 'x', location: { kind: 'document-end' },
    })
    for (const code of ['DOCUMENT_TERMINAL_NEWLINE_MISSING', 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE']) {
      const d = mk(code)
      const r = resolveDiagnosticLocation(d, d.location, {
        documentKey: 'doc', getRoot: () => document.body,
        resolveHeadingIdentity: () => null, resolveSourceLine: () => null, resolveBlockIdentity: () => null,
      })
      expect(r.decision).toBe('RESOLVED')
      expect(r.scrollAction).toBe('GO_BOTTOM')
    }
  })
})

// ── P0-2 compound locator ──────────────────────────────────
describe('COMPOUND — caption primary + object secondary locate', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
    vi.useFakeTimers()
  })
  afterEach(() => { vi.useRealTimers() })

  function mount(): { caption: HTMLElement; table: HTMLElement } {
    const caption = document.createElement('div')
    caption.className = 'inkchapter-object-caption inkchapter-object-caption-table'
    caption.setAttribute('data-inkchapter-caption', 'true')
    caption.setAttribute('data-inkchapter-caption-type', 'table')
    caption.textContent = '表 1.1-1'
    const table = document.createElement('table')
    document.body.append(caption, table)
    return { caption, table }
  }

  it('TABLE_MISSING_NAME_COMPOUND_LOCATE: caption (primary) + table highlighted; scroll targets caption first', () => {
    const { caption, table } = mount()
    const locator = new DocumentDiagnosticLocator({ getContainer: () => null })
    const scroll = vi.spyOn(caption, 'scrollIntoView')
    const count = locator.locateCompound(caption, [table])
    expect(count).toBe(2)
    expect(caption.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)).toBe(true)
    expect(table.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)).toBe(true)
    expect(scroll).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1700)
    expect(caption.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)).toBe(false)
    expect(table.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)).toBe(false)
  })

  it('CAPTION_PRIMARY_SCROLL: primary (caption) is the scroll target; secondary is never scrolled', () => {
    const { caption, table } = mount()
    const locator = new DocumentDiagnosticLocator({ getContainer: () => null })
    let captionScrolled = 0
    let tableScrolled = 0
    caption.scrollIntoView = () => { captionScrolled++ }
    table.scrollIntoView = () => { tableScrolled++ }
    locator.locateCompound(caption, [table])
    expect(captionScrolled).toBe(1)
    expect(tableScrolled).toBe(0)
  })

  it('locateCompound with no connected element returns 0 (no highlight, stale path)', () => {
    const locator = new DocumentDiagnosticLocator({ getContainer: () => null, onStale: () => {} })
    const detached = document.createElement('img')
    const count = locator.locateCompound(detached, [null])
    expect(count).toBe(0)
  })
})

// ── P0-3 resource base = active document dir (real fs) ─────
describe('RESOURCE — document-dir base authority (filesystem truth)', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkchapter-resbase-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function makeCtx(): DocumentUtilitiesContext {
    const doc = path.join(tmp, 'runtime', 'smoke', 'Phase7.md')
    return {
      authority: {
        getActiveFilePath: () => doc,
        getDocumentKey: () => 'phase7',
        getMarkdown: () => '# H1\n\n![boundary](assets/phase7-strict-h1-boundary/boundary-a-figure.png)\n\n',
        isStrictMode: () => true,
        vaultRoot: path.join(tmp, 'vault'),
        getCanonicalDuplicateIdentities: () => [],
        getCaptionDuplicateNames: () => [],
      },
      hasActiveDocument: () => true,
    }
  }

  function makeProviders(): DocumentDiagnosticsProviders {
    const docDir = path.dirname(makeCtx().authority.getActiveFilePath()!)
    return {
      getFormulaVisibleTagTokens: () => [],
      getFigureName: () => null,
      getTableName: () => null,
      getCodeName: () => null,
      getCodeLanguage: () => null,
      resolveImageLocalPath: () => ({ localPath: null }),
      // document-dir base (mirrors the production provider fix).
      isLinkTargetMissing: (target: string) => !fs.existsSync(path.join(docDir, target)),
      getHeadingIdentity: () => null,
      parseLocalLinkTargets: (md: string) => parseLocalLinkTargets(md),
      getCanonicalH1Facts: () => h1Authority(),
    }
  }

  function mountDoc(): void {
    const docDir = path.join(tmp, 'runtime', 'smoke')
    fs.mkdirSync(path.join(docDir, 'assets', 'phase7-strict-h1-boundary'), { recursive: true })
    fs.writeFileSync(path.join(docDir, 'assets', 'phase7-strict-h1-boundary', 'boundary-a-figure.png'), 'x')
  }

  function linkCodes(s: { diagnostics: readonly { code: string }[] } | null): string {
    if (!s) return ''
    return s.diagnostics.filter(d => d.code === 'LINK_LOCAL_TARGET_MISSING').map(d => d.code).join(',')
  }

  it('PHASE7_NORMAL_IMAGE_NO_WARNING: asset under DOCUMENT dir exists → no LINK_LOCAL_TARGET_NOT_FOUND', () => {
    mountDoc()
    const authority = new DocumentDiagnosticsAuthority(makeCtx(), makeProviders())
    let last = ''
    const dispose = authority.subscribe(s => { last = linkCodes(s) })
    authority.recompute('TEST')
    expect(last).toBe('')
    dispose()
  })

  it('GENERIC_LOCATOR_MISSING_IMAGE_WARNING: file truly absent under DOCUMENT dir → warning stays', () => {
    // No asset created under the document dir → the referenced image is missing.
    const authority = new DocumentDiagnosticsAuthority(makeCtx(), makeProviders())
    let last = ''
    const dispose = authority.subscribe(s => { last = linkCodes(s) })
    authority.recompute('TEST')
    // eslint-disable-next-line no-console
    console.log('ALL_CODES', authority.getSnapshot()?.diagnostics.map(d => d.code).join(',') ?? '(null)')
    expect(last).toContain('LINK_LOCAL_TARGET_MISSING')
    dispose()
  })
})
