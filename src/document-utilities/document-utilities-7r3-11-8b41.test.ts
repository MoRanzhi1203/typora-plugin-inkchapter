// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.4.1 — Latent ATX Heading Marker Diagnostics integration.
 *
 * SEV-*     strict=WARNING / loose=HINT('info') / escaped IGNORE
 * ISOLATE-* latent never pollutes h1Count / gap / structure
 * TRANS-*   latent ↔ canonical transitions with NO double report
 * SEP-*     DOCUMENT-UTILITY-DIAGNOSTIC-AUTHORITY-SEPARATION audit
 * LOG-*     DOCUMENT-UTILITY-LATENT-ATX-MARKER transition log
 */
import { describe, it, expect, vi } from 'vitest'
import type { CanonicalHeadingEntry, CanonicalHeadingFrame } from '../heading-numbering/canonical-heading-frame'
import type { SemanticHeadingNumberState } from '../heading-numbering/semantic-heading-types'
import { mapCanonicalHeadingFrameForDiagnostics } from './document-h1-authority-bridge'
import type { DiagnosticCanonicalHeadingAuthorityResult } from './document-h1-authority-bridge'
import { computeDocumentDiagnostics } from './document-diagnostics'
import type { DocumentDiagnosticsInput } from './document-diagnostics'
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

function makeEntry(identity: string, physicalLevel: number, element: HTMLElement): CanonicalHeadingEntry {
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

function canonicalResult(entries: CanonicalHeadingEntry[], docKey = 'doc:a'): DiagnosticCanonicalHeadingAuthorityResult {
  return mapCanonicalHeadingFrameForDiagnostics(makeFrame(docKey, entries), docKey)
}

/** Heading element with a Typora data-line source position. */
function headingEl(text: string, line: number, level = 2): HTMLElement {
  const e = document.createElement(`h${level}`)
  e.setAttribute('data-line', String(line))
  e.textContent = text
  return e
}

const plainEl = (): HTMLElement => document.createElement('div')

function pureInput(partial: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:a',
    markdown: '# H1\n\n##\n\n',
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

// ── Authority harness ─────────────────────────────────────────────────
function authorityCtx(docKey = 'doc:a', strict = true, markdown = '# H1\n\n##\n\n'): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => `/vault/${docKey}.md`,
      getDocumentKey: () => docKey,
      getMarkdown: () => markdown,
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

function logLines(infoSpy: { mock: { calls: Array<Array<unknown>> } }, event: string): string[] {
  return infoSpy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event))
}

// ── SEV severity policy ───────────────────────────────────────────────
describe('SEV latent severity policy', () => {
  const latent = [{ line: 3, markerLevel: 2, markerText: '##', text: '' }]

  it('SEV-1: strict → LATENT_ATX_HEADING_MARKER = WARNING', () => {
    const r = computeDocumentDiagnostics(pureInput({ latentAtxMarkers: latent }))
    const item = r.diagnostics.find(d => d.code === 'LATENT_ATX_HEADING_MARKER_LEVEL_2')
    expect(item).toBeTruthy()
    expect(item!.severity).toBe('warning')
    expect(item!.metadata?.ruleId).toBe('LATENT-ATX-HEADING-MARKER')
    expect(item!.metadata?.markerLevel).toBe(2)
    expect(item!.metadata?.fixKind).toBe('ESCAPE_HEADING_MARKER')
  })

  it('SEV-2: loose → LATENT_ATX_HEADING_MARKER = HINT (info)', () => {
    const r = computeDocumentDiagnostics(pureInput({ strictMode: false, latentAtxMarkers: latent }))
    const item = r.diagnostics.find(d => d.code === 'LATENT_ATX_HEADING_MARKER_LEVEL_2')
    expect(item).toBeTruthy()
    expect(item!.severity).toBe('info')
  })

  it('SEV-3: latent is NEVER an error in any mode', () => {
    for (const strict of [true, false]) {
      const r = computeDocumentDiagnostics(pureInput({ strictMode: strict, latentAtxMarkers: latent }))
      expect(r.diagnostics.some(d => d.code.startsWith('LATENT_ATX') && d.severity === 'error')).toBe(false)
    }
  })

  it('SEV-4: escaped markers produce NO items at all (no latent input)', () => {
    const r = computeDocumentDiagnostics(pureInput({ latentAtxMarkers: [] }))
    expect(r.diagnostics.some(d => d.code.startsWith('LATENT_ATX'))).toBe(false)
  })

  it('SEV-5: real gap still strict=ERROR / loose=WARNING alongside latent', () => {
    const strictR = computeDocumentDiagnostics(pureInput({
      headings: [
        { level: 2, text: 'H2', element: plainEl() },
        { level: 4, text: 'H4', element: plainEl() },
      ],
      latentAtxMarkers: [{ line: 9, markerLevel: 1, markerText: '#', text: '' }],
    }))
    expect(strictR.diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')?.severity).toBe('error')
    expect(strictR.diagnostics.find(d => d.code === 'LATENT_ATX_HEADING_MARKER_LEVEL_1')?.severity).toBe('warning')
    const looseR = computeDocumentDiagnostics(pureInput({
      strictMode: false,
      headings: [
        { level: 2, text: 'H2', element: plainEl() },
        { level: 4, text: 'H4', element: plainEl() },
      ],
      latentAtxMarkers: [{ line: 9, markerLevel: 1, markerText: '#', text: '' }],
    }))
    expect(looseR.diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')?.severity).toBe('warning')
    expect(looseR.diagnostics.find(d => d.code === 'LATENT_ATX_HEADING_MARKER_LEVEL_1')?.severity).toBe('info')
  })
})

// ── ISOLATE latent never pollutes structure ───────────────────────────
describe('ISOLATE latent structure isolation (authority)', () => {
  const MD = '# 第一章\n\n##\n\n####\n\n## 第二章\n'
  // canonical: H1(line0), H2(line6). Lines 2 ("##") and 4 ("####") are latent.
  const entries = [
    makeEntry('h1', 1, headingEl('第一章', 0, 1)),
    makeEntry('h2b', 2, headingEl('第二章', 6)),
  ]

  it('ISOLATE-1: latent markers do NOT change h1Count / gap / structural count', () => {
    const auth = new DocumentDiagnosticsAuthority(authorityCtx('doc:a', true, MD), authorityProviders(canonicalResult(entries)))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    auth.recompute()
    const snap = auth.getSnapshot()
    // h1Count stays 1 → no STRICT_SINGLE_H1 error.
    expect(snap?.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
    // canonical [1,2] has no gap.
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
    // The bare ## / #### lines only produce LATENT items (level 2 + level 4).
    expect(snap?.diagnostics.filter(d => d.code.startsWith('LATENT_ATX')).map(d => d.code).sort())
      .toEqual(['LATENT_ATX_HEADING_MARKER_LEVEL_2', 'LATENT_ATX_HEADING_MARKER_LEVEL_4'].sort())
    // No EMPTY_HEADING from latent lines (not canonical).
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(false)
    vi.restoreAllMocks()
  })

  it('ISOLATE-2: separation audit PASS with latent counts reported separately', () => {
    const auth = new DocumentDiagnosticsAuthority(
      authorityCtx('doc:isolate2', true, MD),
      authorityProviders(canonicalResult(entries, 'doc:isolate2')),
    )
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    auth.recompute()
    const line = logLines(info, 'DOCUMENT-UTILITY-DIAGNOSTIC-AUTHORITY-SEPARATION')
      .find(l => l.includes('canonicalHeadingCount=2'))!
    expect(line).toContain('structuralHeadingCount=2')
    expect(line).toContain('latentAtxCount=2')
    expect(line).toContain('escapedMarkerCount=0')
    expect(line).toContain('nonCanonicalStructuralIncludedCount=0')
    expect(line).toContain('decision=PASS')
    vi.restoreAllMocks()
  })

  it('ISOLATE-3: escaped markers counted but zero structure effect', () => {
    const md = '\\##\n##\n'
    const auth = new DocumentDiagnosticsAuthority(
      authorityCtx('doc:isolate3', true, md),
      authorityProviders(canonicalResult([], 'doc:isolate3')),
    )
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    auth.recompute()
    const snap = auth.getSnapshot()
    // "\\##" → escaped (no item); "##" → latent level 2.
    expect(snap?.diagnostics.filter(d => d.code.startsWith('LATENT_ATX')).length).toBe(1)
    const sep = logLines(info, 'DOCUMENT-UTILITY-DIAGNOSTIC-AUTHORITY-SEPARATION')
      .find(l => l.includes('escapedMarkerCount=1'))!
    expect(sep).toContain('latentAtxCount=1')
    expect(sep).toContain('decision=PASS')
    vi.restoreAllMocks()
  })
})

// ── TRANS latent ↔ canonical transitions ──────────────────────────────
describe('TRANS latent ↔ canonical (no double report)', () => {
  const MD = '##\n'

  it('TRANS-1: latent ## → canonical empty H2 → latent resolved, EMPTY_HEADING appears', () => {
    const auth = new DocumentDiagnosticsAuthority(authorityCtx('doc:a', true, MD), authorityProviders(canonicalResult([])))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    auth.recompute()
    let snap = auth.getSnapshot()
    expect(snap?.diagnostics.some(d => d.code === 'LATENT_ATX_HEADING_MARKER_LEVEL_2')).toBe(true)
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(false)
    // Now Typora converts line 0 into a canonical empty H2 node.
    const promoted = new DocumentDiagnosticsAuthority(
      authorityCtx('doc:a', true, MD),
      authorityProviders(canonicalResult([makeEntry('h2', 2, headingEl('', 0))])),
    )
    promoted.recompute()
    snap = promoted.getSnapshot()
    expect(snap?.diagnostics.some(d => d.code === 'LATENT_ATX_HEADING_MARKER_LEVEL_2')).toBe(false)
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(true)
    vi.restoreAllMocks()
  })

  it('TRANS-2: canonical empty H2 → latent ## → EMPTY_HEADING resolved, latent appears', () => {
    const first = new DocumentDiagnosticsAuthority(
      authorityCtx('doc:a', true, MD),
      authorityProviders(canonicalResult([makeEntry('h2', 2, headingEl('', 0))])),
    )
    first.recompute()
    expect(first.getSnapshot()?.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(true)
    const degraded = new DocumentDiagnosticsAuthority(authorityCtx('doc:a', true, MD), authorityProviders(canonicalResult([])))
    degraded.recompute()
    const snap = degraded.getSnapshot()
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_EMPTY_TEXT')).toBe(false)
    expect(snap?.diagnostics.some(d => d.code === 'LATENT_ATX_HEADING_MARKER_LEVEL_2')).toBe(true)
  })

  it('TRANS-3: latent #### → canonical H4 with previous H2 → gap takes over, no double report', () => {
    const MD3 = '## 章节\n\n####\n'
    const before = new DocumentDiagnosticsAuthority(authorityCtx('doc:a', true, MD3), authorityProviders(canonicalResult([makeEntry('h2', 2, headingEl('章节', 0))])))
    before.recompute()
    expect(before.getSnapshot()?.diagnostics.some(d => d.code === 'LATENT_ATX_HEADING_MARKER_LEVEL_4')).toBe(true)
    expect(before.getSnapshot()?.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
    const after = new DocumentDiagnosticsAuthority(
      authorityCtx('doc:a', true, MD3),
      authorityProviders(canonicalResult([
        makeEntry('h2', 2, headingEl('章节', 0)),
        makeEntry('h4', 4, headingEl('', 2)),
      ])),
    )
    after.recompute()
    const snap = after.getSnapshot()
    expect(snap?.diagnostics.some(d => d.code === 'LATENT_ATX_HEADING_MARKER_LEVEL_4')).toBe(false)
    expect(snap?.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(true)
  })
})

// ── LOG latent marker transition log ──────────────────────────────────
describe('LOG latent marker transition log', () => {
  it('LOG-1: DOCUMENT-UTILITY-LATENT-ATX-MARKER emitted with per-fact detail (strict WARNING)', () => {
    const MD = '##\n'
    const auth = new DocumentDiagnosticsAuthority(authorityCtx('doc:a', true, MD), authorityProviders(canonicalResult([])))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    auth.recompute()
    const line = logLines(info, 'DOCUMENT-UTILITY-LATENT-ATX-MARKER')[0]
    expect(line).toContain('documentKey=doc:a')
    expect(line).toContain('mode=strict')
    expect(line).toContain('"severity":"WARNING"')
    expect(line).toContain('"markerLevel":2')
    expect(line).toContain('"decision":"LATENT_ATX_HEADING_MARKER"')
    vi.restoreAllMocks()
  })

  it('LOG-2: identical state is suppressed (state-token dedup); transition re-emits', () => {
    const MD = '##\n'
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const auth = new DocumentDiagnosticsAuthority(authorityCtx('doc:log2', true, MD), authorityProviders(canonicalResult([])))
    auth.recompute()
    auth.recompute()
    const emitted = logLines(info, 'DOCUMENT-UTILITY-LATENT-ATX-MARKER')
    expect(emitted.length).toBe(1)
    vi.restoreAllMocks()
  })
})

// ── REG regression: previous round invariants still hold ──────────────
describe('REG canonical structure regression with latent present', () => {
  it('REG-1: canonical heading count == structural count regardless of latent', () => {
    const MD = '# 甲\n\n##\n\n## 乙\n'
    const entries = [
      makeEntry('h1', 1, headingEl('甲', 0, 1)),
      makeEntry('h2', 2, headingEl('乙', 4)),
    ]
    const auth = new DocumentDiagnosticsAuthority(authorityCtx('doc:a', true, MD), authorityProviders(canonicalResult(entries)))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    auth.recompute()
    const sep = logLines(info, 'DOCUMENT-UTILITY-DIAGNOSTIC-AUTHORITY-SEPARATION')
      .find(l => l.includes('canonicalHeadingCount=2'))!
    expect(sep).toContain('structuralHeadingCount=2')
    expect(sep).toContain('latentAtxCount=1')
    expect(sep).toContain('decision=PASS')
    vi.restoreAllMocks()
  })
})
