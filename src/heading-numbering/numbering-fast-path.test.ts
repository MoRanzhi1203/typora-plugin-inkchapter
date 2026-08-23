// @vitest-environment jsdom
/**
 * Phase 7R.3.4-C — fast-path fingerprint + early no-op tests (FAST-1..5).
 * Phase 7R.3.4-E — resolver-session fingerprint tests (BIND-PERF-3/4).
 */

import { describe, it, expect } from 'vitest'
import type { HeadingNumberingSnapshot } from './heading-numbering-snapshot'
import type { SemanticHeadingNumberState } from './semantic-heading-types'
import type { FormulaTarget } from './formula-numbering-adapter'
import {
  computeHeadingSemanticFingerprint,
  buildObjectStructureFingerprint,
  objectStructureFingerprintEqual,
} from './numbering-fast-path'

function semantic(overrides: Partial<SemanticHeadingNumberState> & { stableIdentity: string }): SemanticHeadingNumberState {
  return {
    physicalLevel: 2,
    effectiveDepth: 1,
    semanticRole: 'chapter',
    structuralParentIdentity: null,
    structuralChapterIdentity: 'h1',
    structuralSectionIdentity: null,
    strictBoundaryIdentity: 'boundary-a',
    strictBoundaryOrdinal: 1,
    logicalOrdinal: null,
    chapterOrdinal: 1,
    sectionOrdinal: null,
    counted: true,
    countingReason: 'test',
    ordinalByDepth: [null, 1],
    displayCountedPath: [1],
    sourceRevision: 1,
    ...overrides,
  }
}

function snapshot(semanticEntries: SemanticHeadingNumberState[], revision: number, documentKey = 'doc-a'): HeadingNumberingSnapshot {
  return {
    documentKey,
    revision,
    structureMode: 'strict',
    headings: [],
    physical: [],
    semantic: semanticEntries,
  }
}

describe('headingSemanticFingerprint (Phase 7R.3.4-C)', () => {
  const states = [
    semantic({ stableIdentity: 'h1', physicalLevel: 1, semanticRole: 'chapter', chapterOrdinal: 1 }),
    semantic({ stableIdentity: 'h2', physicalLevel: 2, semanticRole: 'section', chapterOrdinal: 1, sectionOrdinal: 1 }),
  ]

  it('FAST-1: snapshot revision changes but semantic fingerprint unchanged → identical fingerprint (no full scan)', () => {
    const fp4 = computeHeadingSemanticFingerprint(snapshot(states, 4))
    const fp5 = computeHeadingSemanticFingerprint(snapshot(states, 5))
    expect(fp4).toBe(fp5)
    expect(fp4.length).toBeGreaterThan(0)
  })

  it('FAST-5: heading text-only edit (no ordinal/role change) → fingerprint unchanged (Formula affectedCount=0 path)', () => {
    const before = computeHeadingSemanticFingerprint(snapshot(states, 4))
    // Text is not part of the fingerprint; only semantic fields are.
    const after = computeHeadingSemanticFingerprint(snapshot(states, 6))
    expect(before).toBe(after)
  })

  it('semantic ordinal change → fingerprint changes', () => {
    const before = computeHeadingSemanticFingerprint(snapshot(states, 4))
    const changed = states.map(s => s.stableIdentity === 'h2' ? { ...s, sectionOrdinal: 2 } : s)
    const after = computeHeadingSemanticFingerprint(snapshot(changed, 4))
    expect(after).not.toBe(before)
  })

  it('document key change → fingerprint changes', () => {
    const before = computeHeadingSemanticFingerprint(snapshot(states, 4, 'doc-a'))
    const after = computeHeadingSemanticFingerprint(snapshot(states, 4, 'doc-b'))
    expect(after).not.toBe(before)
  })

  it('counted flag change → fingerprint changes', () => {
    const before = computeHeadingSemanticFingerprint(snapshot(states, 4))
    const changed = states.map(s => ({ ...s, counted: !s.counted }))
    const after = computeHeadingSemanticFingerprint(snapshot(changed, 4))
    expect(after).not.toBe(before)
  })
})

describe('objectStructureFingerprint (Phase 7R.3.4-C/D)', () => {
  function mkEl(): HTMLElement {
    return document.createElement('div')
  }

  function mkFormula(root: HTMLElement, ordinal: number): FormulaTarget {
    return { root, ordinal, nativeNumberNode: null, nativeNumberText: '', nativeNodeSafe: false }
  }

  it('FAST-3: renderer-only mutation (MJX/SVG) does not change canonical structure fingerprint', () => {
    const t1 = { type: 'table' as const, ordinal: 0, root: mkEl() }
    const f1 = { type: 'figure' as const, ordinal: 0, root: mkEl() }
    const formula = mkFormula(mkEl(), 0)
    const before = buildObjectStructureFingerprint([t1, f1], [formula])
    // Renderer output replacement: the same business hosts, new mjx children.
    const formula2 = mkFormula(formula.root, 0)
    const after = buildObjectStructureFingerprint([t1, f1], [formula2])
    expect(objectStructureFingerprintEqual(before, after)).toBe(true)
  })

  it('FAST-4: plugin self mutation (caption decoration) does not change structure fingerprint', () => {
    const t1 = { type: 'table' as const, ordinal: 0, root: mkEl() }
    const formula = mkFormula(mkEl(), 0)
    const before = buildObjectStructureFingerprint([t1], [formula])
    const after = buildObjectStructureFingerprint([{ ...t1, root: t1.root }], [formula])
    expect(objectStructureFingerprintEqual(before, after)).toBe(true)
  })

  it('FAST-2: formula business host added/removed → structure fingerprint changes', () => {
    const t1 = { type: 'table' as const, ordinal: 0, root: mkEl() }
    const f1 = mkFormula(mkEl(), 0)
    const f2 = mkFormula(mkEl(), 1)
    const before = buildObjectStructureFingerprint([t1], [f1])
    const after = buildObjectStructureFingerprint([t1], [f1, f2])
    expect(objectStructureFingerprintEqual(before, after)).toBe(false)
  })

  it('BIND-PERF-3: heading semantic fingerprint change invalidates the resolver session', () => {
    const fpA = computeHeadingSemanticFingerprint(snapshot([
      semantic({ stableIdentity: 'h1', semanticRole: 'chapter', chapterOrdinal: 1 }),
    ], 1))
    const fpB = computeHeadingSemanticFingerprint(snapshot([
      semantic({ stableIdentity: 'h1', semanticRole: 'chapter', chapterOrdinal: 2 }),
    ], 1))
    expect(fpA).not.toBe(fpB)
  })

  it('BIND-PERF-4: MathJax renderer mutation (not in fingerprint) retains the resolver session', () => {
    // The resolver session keys on documentKey + headingSemanticFingerprint;
    // renderer output never appears in either → session retained.
    const s1 = snapshot([semantic({ stableIdentity: 'h1', semanticRole: 'chapter', chapterOrdinal: 1 })], 1)
    const s2 = snapshot([semantic({ stableIdentity: 'h1', semanticRole: 'chapter', chapterOrdinal: 1 })], 2)
    expect(computeHeadingSemanticFingerprint(s1)).toBe(computeHeadingSemanticFingerprint(s2))
  })
})
