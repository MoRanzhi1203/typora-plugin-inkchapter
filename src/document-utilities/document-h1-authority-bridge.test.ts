// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.1 — H1 authority bridge tests with the REAL production
 * CanonicalHeadingEntry shape (entry.semanticState.physicalLevel).
 *
 * H1-BRIDGE-1..12  real shape / zero / multi / frame-null WAIT / invalid
 *                  level / document mismatch / loose skip / popup recovery.
 *
 * The factory below builds REAL CanonicalHeadingFrame objects — never a
 * synthetic flat `{ stableIdentity, physicalLevel }` that could mask the
 * field-path bug that caused README's false h1Count=0.
 */

import { describe, it, expect, vi } from 'vitest'
import type { CanonicalHeadingEntry, CanonicalHeadingFrame } from '../heading-numbering/canonical-heading-frame'
import type { SemanticHeadingNumberState } from '../heading-numbering/semantic-heading-types'
import { mapCanonicalHeadingFrameForDiagnostics, type DiagnosticCanonicalHeadingAuthorityResult } from './document-h1-authority-bridge'
import { computeDocumentDiagnostics } from './document-diagnostics'
import type { DocumentDiagnosticsInput } from './document-diagnostics'
import { DocumentDiagnosticsAuthority, type DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

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

/** REAL production CanonicalHeadingEntry — level lives in semanticState. */
function makeEntry(identity: string, physicalLevel: number, element: HTMLElement = document.createElement('div')): CanonicalHeadingEntry {
  return { stableIdentity: identity, element, semanticState: makeSemanticState(identity, physicalLevel) }
}

/** REAL production CanonicalHeadingFrame. */
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

const el = (): HTMLElement => document.createElement('div')

function input(partial: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
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

/** h1Facts derived from the REAL frame via the production bridge. */
function h1FactsFromFrame(frame: CanonicalHeadingFrame | null): DocumentDiagnosticsInput['h1Facts'] {
  const result = mapCanonicalHeadingFrameForDiagnostics(frame, 'doc:a')
  return result.state === 'READY' ? result.h1Facts.map(f => ({ stableIdentity: f.stableIdentity, element: f.element, text: undefined })) : null
}

describe('H1-BRIDGE production bridge', () => {
  it('H1-BRIDGE-1: real [1,2,2] → READY h1Count=1, STRICT-SINGLE-H1 PASS, no errors', () => {
    const frame = makeFrame('doc:a', [makeEntry('H1:idx:0', 1), makeEntry('H1:idx:1', 2), makeEntry('H1:idx:2', 2)])
    const result = mapCanonicalHeadingFrameForDiagnostics(frame, 'doc:a')
    expect(result.state).toBe('READY')
    expect(result.canonicalEntryCount).toBe(3)
    expect(result.mappedEntryCount).toBe(3)
    expect(result.invalidEntryCount).toBe(0)
    expect(result.physicalLevels).toEqual([1, 2, 2])
    expect(result.h1Count).toBe(1)
    expect(result.h1StableIdentities).toEqual(['H1:idx:0'])

    const r = computeDocumentDiagnostics(input({ h1Facts: h1FactsFromFrame(frame) }))
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
  })

  it('H1-BRIDGE-2: real [1,1,2] → h1Count=2, MULTIPLE_H1, offending = second H1', () => {
    const second = el()
    const frame = makeFrame('doc:a', [
      makeEntry('h1-a', 1, el()),
      makeEntry('h1-b', 1, second),
      makeEntry('h2-a', 2, el()),
    ])
    const result = mapCanonicalHeadingFrameForDiagnostics(frame, 'doc:a')
    expect(result.state).toBe('READY')
    expect(result.h1Count).toBe(2)
    const r = computeDocumentDiagnostics(input({ h1Facts: h1FactsFromFrame(frame) }))
    const item = r.diagnostics.find(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')
    expect(item).toBeTruthy()
    expect(item!.stableIdentity).toBe('h1-b')
    expect(item!.locator?.targetElement).toBe(second)
  })

  it('H1-BRIDGE-3: real [2,2] → h1Count=0, NO_H1 ERROR', () => {
    const frame = makeFrame('doc:a', [makeEntry('h2-a', 2), makeEntry('h2-b', 2)])
    const result = mapCanonicalHeadingFrameForDiagnostics(frame, 'doc:a')
    expect(result.state).toBe('READY')
    expect(result.h1Count).toBe(0)
    const r = computeDocumentDiagnostics(input({ h1Facts: h1FactsFromFrame(frame) }))
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(true)
  })

  it('H1-BRIDGE-4: frame=null → WAIT, NO_H1 count=0 (no false error)', () => {
    const result = mapCanonicalHeadingFrameForDiagnostics(null, 'doc:a')
    expect(result.state).toBe('WAIT')
    expect(result.reason).toBe('FRAME_NOT_READY')
    const r = computeDocumentDiagnostics(input({ h1Facts: null }))
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
  })

  it('H1-BRIDGE-5: entries with MISSING physicalLevel → INVALID, NO_H1 count=0', () => {
    const broken = makeEntry('broken', 1)
    ;(broken.semanticState as { physicalLevel?: number }).physicalLevel = undefined as never
    const frame = makeFrame('doc:a', [broken, makeEntry('h2-a', 2), makeEntry('h2-b', 2)])
    const result = mapCanonicalHeadingFrameForDiagnostics(frame, 'doc:a')
    expect(result.state).toBe('INVALID')
    expect(result.reason).toBe('PHYSICAL_LEVEL_MISSING')
    expect(result.invalidEntryCount).toBe(1)
    expect(result.h1Count).toBe(0)
    const r = computeDocumentDiagnostics(input({ h1Facts: null })) // WAIT/INVALID → null → skipped
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
  })

  it('H1-BRIDGE-6: out-of-range level [1,7,2] → INVALID (never silently drops)', () => {
    const bad = makeEntry('bad', 7)
    const frame = makeFrame('doc:a', [makeEntry('h1', 1), bad, makeEntry('h2', 2)])
    const result = mapCanonicalHeadingFrameForDiagnostics(frame, 'doc:a')
    expect(result.state).toBe('INVALID')
    expect(result.reason).toBe('PHYSICAL_LEVEL_OUT_OF_RANGE')
    expect(result.invalidEntryCount).toBe(1)
  })

  it('H1-BRIDGE-7: frame belongs to OLD document → WAIT DOCUMENT_MISMATCH, no NO_H1', () => {
    const frame = makeFrame('doc:A', [makeEntry('h1', 1), makeEntry('h2', 2), makeEntry('h2', 2)])
    const result = mapCanonicalHeadingFrameForDiagnostics(frame, 'doc:B')
    expect(result.state).toBe('WAIT')
    expect(result.reason).toBe('DOCUMENT_MISMATCH')
    expect(result.h1Count).toBe(0)
    const r = computeDocumentDiagnostics(input({ documentKey: 'doc:B', h1Facts: null }))
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
  })

  it('H1-BRIDGE-8: strict [1,2,2] PASS → loose SKIP', () => {
    const frame = makeFrame('doc:a', [makeEntry('h1', 1), makeEntry('h2', 2), makeEntry('h2', 2)])
    const facts = h1FactsFromFrame(frame)
    const strictR = computeDocumentDiagnostics(input({ h1Facts: facts }))
    expect(strictR.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
    const looseR = computeDocumentDiagnostics(input({ strictMode: false, h1Facts: facts }))
    expect(looseR.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
  })

  it('H1-BRIDGE-9: loose [1,1,2] → no STRICT-SINGLE-H1 error (no popup source)', () => {
    const frame = makeFrame('doc:a', [makeEntry('h1-a', 1), makeEntry('h1-b', 1), makeEntry('h2', 2)])
    const r = computeDocumentDiagnostics(input({ strictMode: false, h1Facts: h1FactsFromFrame(frame) }))
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
  })

  it('H1-BRIDGE-10: [2,2] → [1,2,2] → ERROR cleared (NO_H1 disappears on recovery)', () => {
    const zero = makeFrame('doc:a', [makeEntry('h2-a', 2), makeEntry('h2-b', 2)])
    const r0 = computeDocumentDiagnostics(input({ h1Facts: h1FactsFromFrame(zero) }))
    expect(r0.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(true)
    const fixed = makeFrame('doc:a', [makeEntry('h1', 1), makeEntry('h2-a', 2), makeEntry('h2-b', 2)])
    const r1 = computeDocumentDiagnostics(input({ h1Facts: h1FactsFromFrame(fixed) }))
    expect(r1.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
  })

  it('H1-BRIDGE-11: recovery then re-violation [1,2,2] → [1,1,2] → MULTIPLE_H1 again', () => {
    const good = makeFrame('doc:a', [makeEntry('h1', 1), makeEntry('h2-a', 2)])
    const r0 = computeDocumentDiagnostics(input({ h1Facts: h1FactsFromFrame(good) }))
    expect(r0.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
    const bad = makeFrame('doc:a', [makeEntry('h1-a', 1), makeEntry('h1-b', 1), makeEntry('h2', 2)])
    const r1 = computeDocumentDiagnostics(input({ h1Facts: h1FactsFromFrame(bad) }))
    expect(r1.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')).toBe(true)
  })

  it('H1-BRIDGE-12: bridge reads entry.semanticState.physicalLevel (real path compiled)', () => {
    const frame = makeFrame('doc:a', [makeEntry('h1', 1)])
    const result = mapCanonicalHeadingFrameForDiagnostics(frame, 'doc:a')
    // If the adapter had read a fake top-level entry.physicalLevel, this would be 0.
    expect(result.h1Count).toBe(1)
    expect(result.physicalLevels).toEqual([1])
  })

  it('READY empty frame (0 entries) → h1Count=0 is a REAL zero-H1 document', () => {
    const frame = makeFrame('doc:a', [])
    const result = mapCanonicalHeadingFrameForDiagnostics(frame, 'doc:a')
    expect(result.state).toBe('READY')
    expect(result.canonicalEntryCount).toBe(0)
    expect(result.h1Count).toBe(0)
    const r = computeDocumentDiagnostics(input({ h1Facts: h1FactsFromFrame(frame) }))
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(true)
  })
})

// ── Phase 7R.3.11.8B.2 — H1-AUTHORITY-INVARIANT audit semantics ──────────
function makeInvariantCtx(docKey = 'doc:a'): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => docKey,
      getMarkdown: () => '# H1\n\n',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
}

function makeInvariantProviders(result: DiagnosticCanonicalHeadingAuthorityResult): DocumentDiagnosticsProviders {
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

function lastInvariant(infoSpy: { mock: { calls: Array<Array<unknown>> } }): string | null {
  const lines = infoSpy.mock.calls.map(c => String(c[0])).filter(l => l.includes('DOCUMENT-UTILITY-H1-AUTHORITY-INVARIANT'))
  return lines.length > 0 ? lines[lines.length - 1] : null
}

describe('H1-INVARIANT audit semantics (7R.3.11.8B.2)', () => {
  it('H1-INVARIANT-1: bridge WAIT → invariant NOT_EVALUATED (AUTHORITY_NOT_READY)', () => {
    const result = mapCanonicalHeadingFrameForDiagnostics(null, 'doc:a')
    const authority = new DocumentDiagnosticsAuthority(makeInvariantCtx(), makeInvariantProviders(result))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    authority.recompute()
    const line = lastInvariant(info)
    expect(line).toBeTruthy()
    expect(line).toContain('decision=NOT_EVALUATED')
    expect(line).toContain('reason=AUTHORITY_NOT_READY')
    vi.restoreAllMocks()
  })

  it('H1-INVARIANT-2: bridge INVALID → invariant NOT_EVALUATED (AUTHORITY_INVALID)', () => {
    const bad = makeEntry('bad', 7)
    const frame = makeFrame('doc:a', [makeEntry('h1', 1), bad, makeEntry('h2', 2)])
    const result = mapCanonicalHeadingFrameForDiagnostics(frame, 'doc:a')
    expect(result.state).toBe('INVALID')
    const authority = new DocumentDiagnosticsAuthority(makeInvariantCtx(), makeInvariantProviders(result))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    authority.recompute()
    const line = lastInvariant(info)
    expect(line).toBeTruthy()
    expect(line).toContain('decision=NOT_EVALUATED')
    expect(line).toContain('reason=AUTHORITY_INVALID')
    vi.restoreAllMocks()
  })

  it('H1-INVARIANT-3: READY [1,2,2] → PASS', () => {
    const frame = makeFrame('doc:a', [makeEntry('H1:idx:0', 1), makeEntry('h2-a', 2), makeEntry('h2-b', 2)])
    const result = mapCanonicalHeadingFrameForDiagnostics(frame, 'doc:a')
    const authority = new DocumentDiagnosticsAuthority(makeInvariantCtx(), makeInvariantProviders(result))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    authority.recompute()
    const line = lastInvariant(info)
    expect(line).toBeTruthy()
    expect(line).toContain('decision=PASS')
    vi.restoreAllMocks()
  })

  it('H1-INVARIANT-4: READY but internal count mismatch (level 1 present, h1Count=0) → FAIL', () => {
    // The production bridge never emits this; the audit must still catch it.
    const broken = mapCanonicalHeadingFrameForDiagnostics(makeFrame('doc:a', [makeEntry('h1', 1)]), 'doc:a')
    const result: DiagnosticCanonicalHeadingAuthorityResult = {
      ...broken,
      state: 'READY',
      physicalLevels: [1, 2, 2],
      h1Count: 0,
      h1StableIdentities: [],
    }
    const authority = new DocumentDiagnosticsAuthority(makeInvariantCtx(), makeInvariantProviders(result))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    authority.recompute()
    const line = lastInvariant(info)
    expect(line).toBeTruthy()
    expect(line).toContain('decision=FAIL')
    expect(line).toContain('reason=COUNT_MISMATCH')
    vi.restoreAllMocks()
  })

  it('LOG-DEDUP-1/2: identical invariant token suppressed; transition re-emits', () => {
    const frame = makeFrame('doc:a', [makeEntry('h1', 1), makeEntry('h2', 2)])
    const result = mapCanonicalHeadingFrameForDiagnostics(frame, 'doc:a')
    const authority = new DocumentDiagnosticsAuthority(makeInvariantCtx(), makeInvariantProviders(result))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    authority.recompute()
    authority.recompute() // identical state → suppressed
    authority.recompute()
    const emitted = info.mock.calls.map(c => String(c[0])).filter(l => l.includes('DOCUMENT-UTILITY-H1-AUTHORITY-INVARIANT'))
    expect(emitted.length).toBe(1)
    // Transition: READY [1,2] → INVALID → re-emits NOT_EVALUATED.
    const bad = makeEntry('bad', 7)
    const badResult = mapCanonicalHeadingFrameForDiagnostics(makeFrame('doc:a', [makeEntry('h1', 1), bad]), 'doc:a')
    const prov2 = makeInvariantProviders(badResult)
    const authority2 = new DocumentDiagnosticsAuthority(makeInvariantCtx(), prov2)
    authority2.recompute()
    const emitted2 = info.mock.calls.map(c => String(c[0])).filter(l => l.includes('DOCUMENT-UTILITY-H1-AUTHORITY-INVARIANT'))
    expect(emitted2.length).toBe(2) // transition must emit
    expect(emitted2[emitted2.length - 1]).toContain('decision=NOT_EVALUATED')
    vi.restoreAllMocks()
  })
})
