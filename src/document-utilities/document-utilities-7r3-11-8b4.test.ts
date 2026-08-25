// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.4 — Canonical Heading Diagnostics Authority + Severity Policy.
 *
 * AUTH-*   canonical-only heading sequence (plain-text hash markers excluded)
 * SEV-*    unified severity policy (strict ERROR / loose WARNING)
 * GAP-*    forward-gap matrix + backtrack PASS
 * EMPTY-*  real CanonicalHeadingEntry empty-text shape
 * INV-*    canonicalHeadingCount == diagnosticHeadingCount invariant gate
 */
import { describe, it, expect, vi } from 'vitest'
import type { CanonicalHeadingEntry, CanonicalHeadingFrame } from '../heading-numbering/canonical-heading-frame'
import type { SemanticHeadingNumberState } from '../heading-numbering/semantic-heading-types'
import { mapCanonicalHeadingFrameForDiagnostics } from './document-h1-authority-bridge'
import type { DiagnosticCanonicalHeadingAuthorityResult } from './document-h1-authority-bridge'
import { computeDocumentDiagnostics } from './document-diagnostics'
import type { DocumentDiagnosticsInput, HeadingDiagnosticAuthority } from './document-diagnostics'
import { DocumentDiagnosticsAuthority } from './document-diagnostics-authority'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

// ── REAL production shapes ────────────────────────────────────────────
function makeSemanticState(identity: string, physicalLevel: number): SemanticHeadingNumberState {
  return {
    stableIdentity: identity,
    physicalLevel: physicalLevel as SemanticHeadingNumberState['physicalLevel'],
    effectiveDepth: physicalLevel,
    semanticRole: 'section',
    structuralParentIdentity: null,
    structuralChapterIdentity: identity,
    structuralSectionIdentity: identity,
    ordinalByDepth: [],
    displayCountedPath: [],
    logicalOrdinal: null,
    chapterOrdinal: null,
    sectionOrdinal: null,
    strictBoundaryIdentity: null,
    strictBoundaryOrdinal: null,
    counted: false,
    countingReason: 'test',
    sourceRevision: 1,
  }
}

function makeEntry(identity: string, physicalLevel: number, element: HTMLElement = document.createElement('div')): CanonicalHeadingEntry {
  return { stableIdentity: identity, element, semanticState: makeSemanticState(identity, physicalLevel) }
}

function makeFrame(docKey: string, entries: CanonicalHeadingEntry[]): CanonicalHeadingFrame {
  return {
    documentKey: docKey,
    semanticRevision: 1,
    editorStructureEpoch: 1,
    frameGeneration: 1,
    semanticFingerprint: 'test-semantic',
    frameFingerprint: 'test-frame',
    entries,
    entryByIdentity: new Map(entries.map(e => [e.stableIdentity, e])),
  }
}

/** READY canonical result from real entries via the PRODUCTION bridge. */
function canonicalResultFromEntries(entries: CanonicalHeadingEntry[], docKey = 'doc:a'): DiagnosticCanonicalHeadingAuthorityResult {
  return mapCanonicalHeadingFrameForDiagnostics(makeFrame(docKey, entries), docKey)
}

function pureInput(partial: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:a',
    markdown: '# H1\n\n',
    strictMode: true,
    vaultRoot: '/vault',
    headings: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
    ...partial,
  }
}

const el = (text = ''): HTMLElement => {
  const e = document.createElement('div')
  e.textContent = text
  return e
}

// ── Authority harness ─────────────────────────────────────────────────
function authorityCtx(docKey = 'doc:a', strict = true): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => `/vault/${docKey}.md`,
      getDocumentKey: () => docKey,
      getMarkdown: () => '# H1\n\n## H2\n\n### H3\n\n#### H4\n\n',
      isStrictMode: () => strict,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
}

function authorityProviders(result: DiagnosticCanonicalHeadingAuthorityResult): DocumentDiagnosticsProviders {
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
    getCanonicalH1Facts: () => result,
  }
}

function authorityLines(infoSpy: { mock: { calls: Array<Array<unknown>> } }, event: string): string[] {
  return infoSpy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event))
}

function setWriteDom(html: string): void {
  const write = document.createElement('div')
  write.id = 'write'
  write.innerHTML = html
  document.body.appendChild(write)
}

// ── AUTH: canonical-only heading sequence ─────────────────────────────
describe('AUTH canonical heading authority', () => {
  it('AUTH-1: canonical [1,2,3,4] + stray empty h1/h4 DOM nodes (plain # / ####) → diagnosticHeadingCount=4, nonCanonicalIncludedCount=0', () => {
    setWriteDom('<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h1></h1><p>##</p><h4></h4>')
    const result = canonicalResultFromEntries([
      makeEntry('h1', 1, el('H1')),
      makeEntry('h2', 2, el('H2')),
      makeEntry('h3', 3, el('H3')),
      makeEntry('h4', 4, el('H4')),
    ])
    const auth = new DocumentDiagnosticsAuthority(authorityCtx(), authorityProviders(result))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    auth.recompute()
    const lines = authorityLines(info, 'DOCUMENT-UTILITY-HEADING-DIAGNOSTIC-AUTHORITY')
    const last = lines[lines.length - 1]
    expect(last).toContain('canonicalHeadingCount=4')
    expect(last).toContain('diagnosticHeadingCount=4')
    expect(last).toContain('nonCanonicalIncludedCount=0')
    expect(last).toContain('decision=PASS')
    // The stray DOM-only h1/h4 must NOT leak into diagnostics.
    const snap = auth.getSnapshot()
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(false)
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
    expect(snap?.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
    vi.restoreAllMocks()
  })

  it('AUTH-2: plain "##" (stray DOM h2) never triggers EMPTY_HEADING / GAP / STRICT_SINGLE_H1', () => {
    setWriteDom('<h1>A</h1><h2>B</h2><h2></h2>')
    const result = canonicalResultFromEntries([
      makeEntry('h1', 1, el('A')),
      makeEntry('h2', 2, el('B')),
    ])
    const auth = new DocumentDiagnosticsAuthority(authorityCtx(), authorityProviders(result))
    auth.recompute()
    const snap = auth.getSnapshot()
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(false)
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
    expect(snap?.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
  })

  it('AUTH-3: plain "#" (stray DOM h1) does NOT increase h1Count', () => {
    setWriteDom('<h1>A</h1><h1></h1>')
    const result = canonicalResultFromEntries([makeEntry('h1', 1, el('A'))])
    expect(result.h1Count).toBe(1) // canonical frame only
    const auth = new DocumentDiagnosticsAuthority(authorityCtx(), authorityProviders(result))
    auth.recompute()
    const snap = auth.getSnapshot()
    expect(snap?.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')).toBe(false)
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(false)
  })

  it('AUTH-4: canonical [1,3] → HEADING_LEVEL_GAP (missing H2)', () => {
    const r = computeDocumentDiagnostics(pureInput({
      headings: [
        { level: 1, text: 'H1', element: el() },
        { level: 3, text: 'H3', element: el() },
      ],
    }))
    const gap = r.diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')
    expect(gap).toBeTruthy()
    expect(gap!.metadata?.missingLevels).toEqual([2])
  })

  it('AUTH-5: canonical [3,1] → NO GAP (backtrack is a normal structure close)', () => {
    const r = computeDocumentDiagnostics(pureInput({
      headings: [
        { level: 3, text: 'H3', element: el() },
        { level: 1, text: 'H1', element: el() },
      ],
    }))
    expect(r.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
  })

  it('AUTH-6: WAIT frame → authority NOT_EVALUATED and no heading structure diagnostics', () => {
    setWriteDom('<h1>A</h1><h2></h2>')
    const wait = mapCanonicalHeadingFrameForDiagnostics(null, 'doc:a')
    const auth = new DocumentDiagnosticsAuthority(authorityCtx(), authorityProviders(wait))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    auth.recompute()
    const lines = authorityLines(info, 'DOCUMENT-UTILITY-HEADING-DIAGNOSTIC-AUTHORITY')
    expect(lines[lines.length - 1]).toContain('decision=NOT_EVALUATED')
    const snap = auth.getSnapshot()
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(false)
    vi.restoreAllMocks()
  })
})

// ── SEV: unified severity policy ──────────────────────────────────────
describe('SEV severity policy', () => {
  const gapInput = (strict: boolean): DocumentDiagnosticsInput => pureInput({
    strictMode: strict,
    markdown: '# H1\n\n### H3\n',
    headings: [
      { level: 1, text: 'H1', element: el() },
      { level: 3, text: 'H3', element: el() },
    ],
  })

  it('SEV-1: strict H1→H3 → HEADING_LEVEL_GAP=ERROR', () => {
    const r = computeDocumentDiagnostics(gapInput(true))
    const gap = r.diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')
    expect(gap?.severity).toBe('error')
  })

  it('SEV-2: loose H1→H3 → HEADING_LEVEL_GAP=WARNING', () => {
    const r = computeDocumentDiagnostics(gapInput(false))
    const gap = r.diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')
    expect(gap?.severity).toBe('warning')
  })

  it('SEV-3: strict canonical empty H2 → EMPTY_HEADING=ERROR', () => {
    const emptyH2 = makeEntry('h2-empty', 2, el(''))
    const result = canonicalResultFromEntries([makeEntry('h1', 1, el('H1')), emptyH2])
    const r = computeDocumentDiagnostics(pureInput({
      strictMode: true,
      headings: result.headingFacts.map(f => ({ level: f.physicalLevel, text: f.text, stableIdentity: f.stableIdentity, element: f.element })),
    }))
    const item = r.diagnostics.find(d => d.code === 'HEADING_EMPTY_TEXT')
    expect(item).toBeTruthy()
    expect(item!.severity).toBe('error')
    expect(item!.stableIdentity).toBe('h2-empty')
  })

  it('SEV-4: loose canonical empty H2 → EMPTY_HEADING=WARNING', () => {
    const result = canonicalResultFromEntries([makeEntry('h1', 1, el('H1')), makeEntry('h2-empty', 2, el(''))])
    const r = computeDocumentDiagnostics(pureInput({
      strictMode: false,
      headings: result.headingFacts.map(f => ({ level: f.physicalLevel, text: f.text, stableIdentity: f.stableIdentity, element: f.element })),
    }))
    const item = r.diagnostics.find(d => d.code === 'HEADING_EMPTY_TEXT')
    expect(item?.severity).toBe('warning')
  })

  it('SEV-5: plain text "##" → IGNORE (default no item)', () => {
    const r = computeDocumentDiagnostics(pureInput({ headings: [], h1Facts: [{ stableIdentity: 'h1', element: el() }] }))
    expect(r.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(false)
    expect(r.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
  })

  it('SEV-6: code missing name → WARNING in strict AND loose', () => {
    const strictR = computeDocumentDiagnostics(pureInput({ codes: [{ name: null, language: 'ts', element: el() }] }))
    const looseR = computeDocumentDiagnostics(pureInput({ strictMode: false, codes: [{ name: null, language: 'ts', element: el() }] }))
    expect(strictR.diagnostics.find(d => d.code === 'CODE_MISSING_NAME')?.severity).toBe('warning')
    expect(looseR.diagnostics.find(d => d.code === 'CODE_MISSING_NAME')?.severity).toBe('warning')
  })

  it('SEV-7: trailing blank line → WARNING in strict AND loose', () => {
    const strictR = computeDocumentDiagnostics(pureInput({ markdown: 'content\n' }))
    const looseR = computeDocumentDiagnostics(pureInput({ strictMode: false, markdown: 'content\n' }))
    expect(strictR.diagnostics.find(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINE')?.severity).toBe('warning')
    expect(looseR.diagnostics.find(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINE')?.severity).toBe('warning')
  })

  it('SEV-8: code language missing → WARNING in strict AND loose', () => {
    const r = computeDocumentDiagnostics(pureInput({ codes: [{ name: 'x', language: '', element: el() }] }))
    expect(r.diagnostics.find(d => d.code === 'CODE_MISSING_LANGUAGE')?.severity).toBe('warning')
  })
})

// ── GAP matrix ────────────────────────────────────────────────────────
describe('GAP forward-gap matrix + backtrack', () => {
  const run = (levels: number[], strict = true): ReturnType<typeof computeDocumentDiagnostics> =>
    computeDocumentDiagnostics(pureInput({
      strictMode: strict,
      headings: levels.map((level, i) => ({ level, text: `H${level}-${i}`, element: el() })),
    }))

  it('1→2 PASS, 2→3 PASS, 3→4 PASS (no gap)', () => {
    expect(run([1, 2, 3, 4]).diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
  })

  it('1→3 GAP missing[2]', () => {
    const gap = run([1, 3]).diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')
    expect(gap?.metadata?.missingLevels).toEqual([2])
  })

  it('2→4 GAP missing[3]', () => {
    const gap = run([2, 4]).diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')
    expect(gap?.metadata?.missingLevels).toEqual([3])
  })

  it('3→6 GAP missing[4,5]', () => {
    const gap = run([3, 6]).diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')
    expect(gap?.metadata?.missingLevels).toEqual([4, 5])
  })

  it('4→2 PASS, 6→1 PASS, 5→3 PASS (backtrack never a gap)', () => {
    expect(run([4, 2]).diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
    expect(run([6, 1]).diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
    expect(run([5, 3]).diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
  })
})

// ── EMPTY heading (real CanonicalHeadingEntry shape) ──────────────────
describe('EMPTY heading authority', () => {
  it('EMPTY-1: canonical H2 with normalizedText="" → EMPTY_HEADING', () => {
    const result = canonicalResultFromEntries([makeEntry('h2', 2, el(''))])
    expect(result.state).toBe('READY')
    expect(result.headingFacts[0].text).toBe('')
    const r = computeDocumentDiagnostics(pureInput({
      headings: result.headingFacts.map(f => ({ level: f.physicalLevel, text: f.text, stableIdentity: f.stableIdentity, element: f.element })),
    }))
    expect(r.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(true)
  })

  it('EMPTY-2: no CanonicalHeadingEntry → NOT_APPLICABLE (no EMPTY_HEADING)', () => {
    const r = computeDocumentDiagnostics(pureInput({ headings: [] }))
    expect(r.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(false)
  })

  it('EMPTY-3: empty-text canonical H1 still counts as H1 (STRICT-SINGLE-H1 PASS) + EMPTY_HEADING fires', () => {
    const result = canonicalResultFromEntries([makeEntry('h1', 1, el(''))])
    const r = computeDocumentDiagnostics(pureInput({
      h1Facts: result.h1Facts.map(f => ({ stableIdentity: f.stableIdentity, element: f.element })),
      headings: result.headingFacts.map(f => ({ level: f.physicalLevel, text: f.text, stableIdentity: f.stableIdentity, element: f.element })),
    }))
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
    expect(r.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(true)
  })
})

// ── INV: canonicalHeadingCount == diagnosticHeadingCount ──────────────
describe('INV heading authority invariant gate', () => {
  const failedAuthority = (canonical: number, diagnostic: number): HeadingDiagnosticAuthority => ({
    canonicalHeadingCount: canonical,
    diagnosticHeadingCount: diagnostic,
    canonicalStableIdentities: Array.from({ length: canonical }, (_, i) => `c${i}`),
    diagnosticStableIdentities: Array.from({ length: diagnostic }, (_, i) => `d${i}`),
    nonCanonicalIncludedCount: diagnostic - canonical,
    missingCanonicalCount: 0,
    decision: 'FAIL',
    reason: 'NON_CANONICAL_HEADING_INCLUDED',
  })

  it('INV-1: canonical=4 diagnostic=5 (extra H6) → FAIL blocks wrong gap publish', () => {
    // Canonical [1,2,3,4]; polluted diagnostics sequence contains an extra
    // H6 after H4 — a naive scan would emit 3→6 (missing 4,5) as a gap.
    const r = computeDocumentDiagnostics(pureInput({
      headings: [
        { level: 1, text: 'H1', element: el() },
        { level: 2, text: 'H2', element: el() },
        { level: 3, text: 'H3', element: el() },
        { level: 4, text: 'H4', element: el() },
        { level: 6, text: 'H6', element: el() },
      ],
      headingAuthority: failedAuthority(4, 5),
    }))
    expect(r.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
    expect(r.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(false)
  })

  it('INV-2: decision=PASS allows real gap publish', () => {
    const r = computeDocumentDiagnostics(pureInput({
      headings: [
        { level: 1, text: 'H1', element: el() },
        { level: 3, text: 'H3', element: el() },
      ],
      headingAuthority: {
        canonicalHeadingCount: 2,
        diagnosticHeadingCount: 2,
        canonicalStableIdentities: ['h1', 'h3'],
        diagnosticStableIdentities: ['h1', 'h3'],
        nonCanonicalIncludedCount: 0,
        missingCanonicalCount: 0,
        decision: 'PASS',
        reason: 'READY',
      },
    }))
    expect(r.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(true)
  })

  it('INV-3: no headingAuthority (pure callers) still allows structure rules', () => {
    const r = computeDocumentDiagnostics(pureInput({
      headings: [
        { level: 1, text: 'H1', element: el() },
        { level: 3, text: 'H3', element: el() },
      ],
    }))
    expect(r.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(true)
  })
})
