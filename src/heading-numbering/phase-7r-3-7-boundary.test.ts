// @vitest-environment jsdom
/**
 * Phase 7R.3.7 — Strict H1 Numbering Boundary + Shared Semantic Scope Identity
 *
 * HB-1..5      heading boundary (semantic reset + boundary identity + cut)
 * ZERO-1/2     no zero-fill in strict missing-level display
 * OBJ-BND-1..4 object boundary scope (figure/table/formula/code shared)
 * SCOPE-ID-1/2 boundary-aware scope identity + formula signature
 * CAP-DEFER-1/2 caption transient unresolved → DEFER, previous plan preserved
 * COMMIT-ADOPT-1..3 durable commit adoption guards
 * LINEAGE-1/2  formula transition lineage across boundary change
 */

import { describe, it, expect } from 'vitest'
import { buildHeadingNumberingSnapshotForRevision, type HeadingNumberingSnapshot } from './heading-numbering-snapshot'
import { computeHeadingNumbering } from './numbering-engine'
import { computeProductionDesiredCaptionStates, type CaptionObjectEntry, type ProductionObjectConfigs } from './caption-semantic-bridge'
import { planFormulaSemanticNumbers, type FormulaSemanticContext } from './formula-semantic-planner'
import { FormulaProjectionController, classifyFormulaProjectionVerify, type FormulaNativeRenderPlan } from './formula-projection-controller'
import { objectScopeKey, type ObjectSemanticScopeIdentity } from './object-semantic-scope'
import { classifyFormulaSemanticResolution, LEGITIMATE_GLOBAL_UNBOUND_REASONS } from './formula-semantic-resolution'
import { DEFAULT_OBJECT_NUMBERING_CONFIG, type ObjectNumberingConfig } from './object-numbering-engine'
import type { HeadingDescriptor, HeadingNumberingSettings } from './heading-types'
import { getPresetLevels } from './presets'
import { DEFAULT_SETTINGS } from '../settings/default-settings'

const base = DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault

function hd(key: string, level: 1 | 2 | 3 | 4 | 5 | 6, text = key): HeadingDescriptor {
  return { key, level, text }
}

function settings(mode: 'strict' | 'loose'): HeadingNumberingSettings {
  return {
    ...base,
    levels: getPresetLevels('decimal-hierarchical'),
    customDefinition: getPresetLevels('decimal-hierarchical'),
    headingStructureMode: mode,
    showLevelOneNumber: mode === 'loose',
  }
}

function snap(headings: HeadingDescriptor[], mode: 'strict' | 'loose', documentKey = 'doc.md'): HeadingNumberingSnapshot {
  return buildHeadingNumberingSnapshotForRevision(headings, settings(mode), undefined, undefined, 1, documentKey)
}

function cfg(preset: ObjectNumberingConfig['preset'], overrides: Partial<ObjectNumberingConfig> = {}): ObjectNumberingConfig {
  return { ...DEFAULT_OBJECT_NUMBERING_CONFIG.figure, preset, ...overrides }
}

function cfgAll(preset: ObjectNumberingConfig['preset']): ProductionObjectConfigs {
  return { figure: cfg(preset), table: cfg(preset), code: cfg(preset) }
}

const captionObj = (id: string, kind: 'figure' | 'table' | 'code', heading: string | null, boundary: string | null, chapter: string | null, section: string | null, chapterOrdinal: number | null, sectionOrdinal: number | null): CaptionObjectEntry => ({
  stableIdentity: id,
  objectKind: kind,
  precedingHeadingStableIdentity: heading,
  structureMode: 'strict',
  strictBoundaryIdentity: boundary,
  structuralChapterIdentity: chapter,
  structuralSectionIdentity: section,
  chapterOrdinal,
  sectionOrdinal,
})

describe('HB — strict H1 heading boundary', () => {
  it('HB-1: H2 chapter ordinal restarts at 1 after every H1 (semantic)', () => {
    const s = snap([hd('tA', 1, 'Boundary A'), hd('A1', 2), hd('A2', 2), hd('tB', 1, 'Boundary B'), hd('B1', 2)], 'strict')
    const chapter = s.semantic.map(x => x.chapterOrdinal)
    expect(chapter).toEqual([null, 1, 2, null, 1])
    // H2 after Boundary B restarts at 1 — never inherits Boundary A's counter.
    expect(s.semantic[4].chapterOrdinal).toBe(1)
  })

  it('HB-2: physical H2 visible labels restart at 一、 after every H1', () => {
    const s = snap([hd('tA', 1, 'Boundary A'), hd('A1', 2), hd('A2', 2), hd('tB', 1, 'Boundary B'), hd('B1', 2)], 'strict')
    const physical = computeHeadingNumbering(
      [hd('tA', 1, 'Boundary A'), hd('A1', 2), hd('A2', 2), hd('tB', 1, 'Boundary B'), hd('B1', 2)],
      settings('strict'),
    )
    // H1s are unnumbered; H2 labels: A1=1, A2=2, B1=1 (boundary-local).
    expect(physical[0].label).toBe('')
    expect(physical[3].label).toBe('')
    expect(physical[1].label).toBe('1')
    expect(physical[2].label).toBe('2')
    expect(physical[4].label).toBe('1')
    // physical and semantic chapter ordinals agree (PHYSICAL_SEMANTIC_BOUNDARY_COHERENCE)
    expect(physical[4].counters[1]).toBe(s.semantic[4].chapterOrdinal)
  })

  it('HB-3: heading after H1 never inherits the previous boundary chapter ancestry', () => {
    const s = snap([hd('tA', 1), hd('A1', 2), hd('A1-1', 3), hd('tB', 1), hd('Bsec', 3)], 'strict')
    const a1 = s.semantic[1]
    const a11 = s.semantic[2]
    const bsec = s.semantic[4]
    // A1 is itself a chapter (no chapter ancestor); A1-1 binds to A1.
    expect(a1.semanticRole).toBe('chapter')
    expect(a11.structuralChapterIdentity).toBe('A1')
    // Bsec is an H3 in a NEW boundary with NO H2 → no chapter/section ancestry,
    // never inherits A1 / A1-1.
    expect(bsec.structuralChapterIdentity).toBeNull()
    expect(bsec.structuralSectionIdentity).toBeNull()
    expect(bsec.chapterOrdinal).toBeNull()
    expect(bsec.strictBoundaryIdentity).toBe('tB')
    expect(bsec.strictBoundaryIdentity).not.toBe(a1.strictBoundaryIdentity)
  })

  it('HB-4: strictBoundaryIdentity equals nearest preceding H1 stableIdentity', () => {
    const s = snap([hd('tA', 1), hd('A1', 2), hd('A1-1', 3), hd('tB', 1), hd('B1', 2), hd('B1-1', 3)], 'strict')
    expect(s.semantic.map(x => x.strictBoundaryIdentity)).toEqual(['tA', 'tA', 'tA', 'tB', 'tB', 'tB'])
    expect(s.semantic.map(x => x.strictBoundaryOrdinal)).toEqual([1, 1, 1, 2, 2, 2])
  })

  it('HB-5: loose mode keeps strictBoundaryIdentity=null and unchanged ordinals', () => {
    const s = snap([hd('c1', 1), hd('s1', 2), hd('c2', 1), hd('s2', 3)], 'loose')
    expect(s.semantic.map(x => x.strictBoundaryIdentity)).toEqual([null, null, null, null])
    expect(s.semantic.map(x => x.chapterOrdinal)).toEqual([1, 1, 2, 2])
  })
})

describe('ZERO — strict missing-level display (no zero-fill / no gap compression)', () => {
  it('ZERO-1: H1/H2/H4 never renders 1.0.1 — H4 label suppressed', () => {
    const physical = computeHeadingNumbering(
      [hd('t', 1), hd('c', 2), hd('x', 4)],
      settings('strict'),
    )
    expect(physical[0].label).toBe('')
    expect(physical[1].label).toBe('1')
    expect(physical[2].label).toBe('') // no fabricated 1.0.1
  })

  it('ZERO-2: H1/H3 never renders 0.1 / 1.0 — H3 label suppressed', () => {
    const physical = computeHeadingNumbering(
      [hd('t', 1), hd('s', 3)],
      settings('strict'),
    )
    expect(physical[0].label).toBe('')
    expect(physical[1].label).toBe('') // no fabricated 0.1 / 1.0
  })

  it('ZERO-3: loose mode keeps its own (pre-existing) physical display — strict suppression never applies', () => {
    const physical = computeHeadingNumbering(
      [hd('c', 1), hd('s', 3)],
      settings('loose'),
    )
    expect(physical[0].label).toBe('1')
    // Loose physical display is unchanged by Phase 7R.3.7 (strict-only policy):
    // the H3 still renders a label (no strict missing-parent suppression).
    expect(physical[1].label).not.toBe('')
  })
})

describe('OBJ-BND — shared boundary scope for Figure/Table/Formula/Code', () => {
  function formulaContext(boundary: string | null, chapter: string | null, section: string | null, c: number | null, s: number | null): FormulaSemanticContext {
    return {
      chapterOrdinal: c,
      sectionOrdinal: s,
      mode: 'strict',
      strictBoundaryIdentity: boundary,
      structuralChapterIdentity: chapter,
      structuralSectionIdentity: section,
    }
  }

  it('OBJ-BND-1: chapter-dash restarts ordinal per boundary for every kind', () => {
    const heading = 'A1'
    const boundary = 'tA'
    const chapter = 'A1'
    const objects: CaptionObjectEntry[] = [
      captionObj('F1', 'figure', heading, boundary, chapter, null, 1, null),
      captionObj('F2', 'figure', heading, boundary, chapter, null, 1, null),
      captionObj('T1', 'table', heading, boundary, chapter, null, 1, null),
      captionObj('C1', 'code', heading, boundary, chapter, null, 1, null),
    ]
    const s = snap([hd('tA', 1), hd('A1', 2), hd('tB', 1), hd('B1', 2)], 'strict')
    const states = computeProductionDesiredCaptionStates(s, objects, cfgAll('chapter-dash'))
    // Boundary A / Chapter 1 → 1-1 / 1-2 for figures; 1-1 for table/code.
    const byKind = Object.fromEntries(states.map(x => [`${x.objectKind}@${x.ordinal}`, x.rawNumber]))
    expect(byKind['figure@1']).toBe('1-1')
    expect(byKind['figure@2']).toBe('1-2')
    expect(byKind['table@1']).toBe('1-1')
    expect(byKind['code@1']).toBe('1-1')

    // Boundary B / Chapter 1 → figure restarts at 1-1 (never 1-3).
    const bObjects = [captionObj('F3', 'figure', 'B1', 'tB', 'B1', null, 1, null)]
    const bStates = computeProductionDesiredCaptionStates(s, bObjects, cfgAll('chapter-dash'))
    expect(bStates[0].rawNumber).toBe('1-1')
  })

  it('OBJ-BND-2: same visible 1.1-1 in two boundaries but scopeKey differs', () => {
    const s = snap([hd('tA', 1), hd('A1', 2), hd('A1-1', 3), hd('tB', 1), hd('B1', 2), hd('B1-1', 3)], 'strict')
    const aObj = [captionObj('Fa', 'figure', 'A1-1', 'tA', 'A1', 'A1-1', 1, 1)]
    const bObj = [captionObj('Fb', 'figure', 'B1-1', 'tB', 'B1', 'B1-1', 1, 1)]
    const a = computeProductionDesiredCaptionStates(s, aObj, cfgAll('section-dash'))[0]
    const b = computeProductionDesiredCaptionStates(s, bObj, cfgAll('section-dash'))[0]
    expect(a.rawNumber).toBe('1.1-1')
    expect(b.rawNumber).toBe('1.1-1')
    expect(a.scopeKey).not.toBe(b.scopeKey)
  })

  it('OBJ-BND-3: strict GLOBAL is boundary-local (A:1,2 / B:1)', () => {
    const s = snap([hd('tA', 1), hd('tB', 1)], 'strict')
    const aObjs = [
      captionObj('A1', 'figure', 'tA', 'tA', null, null, null, null),
      captionObj('A2', 'figure', 'tA', 'tA', null, null, null, null),
    ]
    const bObjs = [captionObj('B1', 'figure', 'tB', 'tB', null, null, null, null)]
    const a = computeProductionDesiredCaptionStates(s, aObjs, cfgAll('global'))
    const b = computeProductionDesiredCaptionStates(s, bObjs, cfgAll('global'))
    expect(a.map(x => x.rawNumber)).toEqual(['1', '2'])
    expect(b.map(x => x.rawNumber)).toEqual(['1'])
    // scope keys differ across boundaries even though rawNumber is equal
    expect(a[0].scopeKey).not.toBe(b[0].scopeKey)
  })

  it('OBJ-BND-4: H1 A/H2 A1 then H1 B/H3 BSection — object is GLOBAL in B (1), never inherited 1.1-1', () => {
    const s = snap([hd('tA', 1), hd('A1', 2), hd('tB', 1), hd('Bsec', 3)], 'strict')
    const bObj = [captionObj('Fb', 'figure', 'Bsec', 'tB', null, null, null, null)]
    const b = computeProductionDesiredCaptionStates(s, bObj, cfgAll('section-dash'))
    expect(b[0].effectiveScope).toBe('global')
    expect(b[0].rawNumber).toBe('1')
    expect(b[0].scopeKey).not.toContain('A1')
  })

  it('OBJ-BND-5: formula planner uses the same boundary-aware scope key', () => {
    const s = snap([hd('tA', 1), hd('A1', 2), hd('A1-1', 3), hd('tB', 1), hd('B1', 2), hd('B1-1', 3)], 'strict')
    const fa = formulaContext('tA', 'A1', 'A1-1', 1, 1)
    const fb = formulaContext('tB', 'B1', 'B1-1', 1, 1)
    const cfgFormula: ObjectNumberingConfig = {
      ...DEFAULT_OBJECT_NUMBERING_CONFIG.formula,
      enabled: true,
      formulaMode: 'inkchapter',
      preset: 'section-dash',
    }
    const plannedA = planFormulaSemanticNumbers([fa], cfgFormula)
    const plannedB = planFormulaSemanticNumbers([fb], cfgFormula)
    expect(plannedA[0].rawNumber).toBe('1.1-1')
    expect(plannedB[0].rawNumber).toBe('1.1-1')
    // The planner exposes the boundary provenance that feeds the projection signature.
    expect(plannedA[0].strictBoundaryIdentity).toBe('tA')
    expect(plannedB[0].strictBoundaryIdentity).toBe('tB')
  })
})

describe('SCOPE-ID — scope identity + formula signature', () => {
  it('SCOPE-ID-1: two boundaries with chapter=1/section=1 → different scope identities', () => {
    const idA: ObjectSemanticScopeIdentity = {
      mode: 'strict',
      boundaryIdentity: 'tA',
      effectiveScope: 'section',
      structuralChapterIdentity: 'A1',
      structuralSectionIdentity: 'A1-1',
      chapterOrdinal: 1,
      sectionOrdinal: 1,
    }
    const idB: ObjectSemanticScopeIdentity = {
      mode: 'strict',
      boundaryIdentity: 'tB',
      effectiveScope: 'section',
      structuralChapterIdentity: 'B1',
      structuralSectionIdentity: 'B1-1',
      chapterOrdinal: 1,
      sectionOrdinal: 1,
    }
    expect(objectScopeKey('formula', idA)).not.toBe(objectScopeKey('formula', idB))
    expect(objectScopeKey('figure', idA)).not.toBe(objectScopeKey('figure', idB))
  })

  it('SCOPE-ID-2: same visible raw 1-1 across boundaries → different projection signatures', () => {
    const controller = new FormulaProjectionController()
    const hostA = document.createElement('div')
    const hostB = document.createElement('div')
    document.body.appendChild(hostA)
    document.body.appendChild(hostB)
    const planA: FormulaNativeRenderPlan = {
      documentKey: 'doc.md',
      revision: 1,
      sourceHash: 'h-x',
      rawNumber: '1-1',
      renderedNumber: '(1-1)',
      formulaRuntimeKey: 'formula:1',
      authority: 'inkchapter-native-transient',
      formulaMode: 'inkchapter',
      strictBoundaryIdentity: 'tA',
      structuralChapterIdentity: 'A1',
      structuralSectionIdentity: null,
      effectiveScope: 'chapter',
    }
    const planB: FormulaNativeRenderPlan = { ...planA, formulaRuntimeKey: 'formula:2', strictBoundaryIdentity: 'tB', structuralChapterIdentity: 'B1' }
    controller.setPlan(hostA, planA)
    controller.setPlan(hostB, planB)
    expect(controller.currentSignatureHash(hostA)).not.toBe(controller.currentSignatureHash(hostB))
  })
})

describe('CAP-DEFER — caption transient unresolved closure', () => {
  it('CAP-DEFER-1: CANDIDATE_IDENTITY_MISSING classifies as TRANSIENT_UNRESOLVED, never GLOBAL', () => {
    const res = classifyFormulaSemanticResolution(false, 'CANDIDATE_IDENTITY_MISSING', null, null)
    expect(res.decision).toBe('TRANSIENT_UNRESOLVED')
    expect(LEGITIMATE_GLOBAL_UNBOUND_REASONS.has('CANDIDATE_IDENTITY_MISSING')).toBe(false)
  })

  it('CAP-DEFER-2: genuine before-first-heading stays LEGITIMATE_GLOBAL (表 1 allowed)', () => {
    const res = classifyFormulaSemanticResolution(false, 'NO_PRECEDING_HEADING', null, null)
    expect(res.decision).toBe('LEGITIMATE_GLOBAL_FALLBACK')
  })
})

describe('COMMIT-ADOPT — formula durable commit adoption', () => {
  it('COMMIT-ADOPT-1: exact visible semantic output with null commit state → ADOPTED_EXISTING_SEMANTIC_OUTPUT', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const plan: FormulaNativeRenderPlan = {
      documentKey: 'doc.md',
      revision: 1,
      sourceHash: 'h-x',
      rawNumber: '1-1',
      renderedNumber: '(1-1)',
      formulaRuntimeKey: 'formula:1',
      authority: 'inkchapter-native-transient',
      formulaMode: 'inkchapter',
      strictBoundaryIdentity: 'tA',
      structuralChapterIdentity: 'A1',
      structuralSectionIdentity: null,
      effectiveScope: 'chapter',
    }
    controller.setPlan(host, plan)
    expect(controller.commitState(host).lastCommittedActivationId).toBeNull()
    const adopted = controller.adoptExistingSemanticOutput(host)
    expect(adopted).toBe(true)
    const cs = controller.commitState(host)
    expect(cs.lastCommittedActivationId).toBe(cs.currentActivationId)
    expect(cs.lastCommittedSignatureHash).toBe(cs.currentSignatureHash)
    expect(cs.lastCommittedRawNumber).toBe('1-1')
  })

  it('COMMIT-ADOPT-2: no adoption without a current activation', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    document.body.appendChild(host)
    expect(controller.adoptExistingSemanticOutput(host)).toBe(false)
  })

  it('COMMIT-ADOPT-3: duplicate visible tokens are classified DUPLICATE (never verified/adopted)', () => {
    const decision = classifyFormulaProjectionVerify({
      planExists: true,
      injected: true,
      committedForCurrentSignature: true,
      lookupDecision: 'MATCHED',
      semanticCommitted: true,
      sequentialCommitted: true, // a second sequential (native) token exists
      customDecorationCount: 0,
    })
    expect(decision).toBe('DUPLICATE')
  })
})

describe('LINEAGE — formula transition lineage across boundary change', () => {
  it('LINEAGE-1: Boundary A → Boundary B with same raw 1-1 mints a NEW activation with different signature', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const basePlan = (boundary: string, chapter: string, runtimeKey: string): FormulaNativeRenderPlan => ({
      documentKey: 'doc.md',
      revision: 1,
      sourceHash: 'h-x',
      rawNumber: '1-1',
      renderedNumber: '(1-1)',
      formulaRuntimeKey: runtimeKey,
      authority: 'inkchapter-native-transient',
      formulaMode: 'inkchapter',
      strictBoundaryIdentity: boundary,
      structuralChapterIdentity: chapter,
      structuralSectionIdentity: null,
      effectiveScope: 'chapter',
    })
    controller.setPlan(host, basePlan('tA', 'A1', 'formula:1'))
    const actA = controller.getCurrentActivation(host)!
    const transition = controller.applyProjectionPlan(host, basePlan('tB', 'B1', 'formula:1'))
    const actB = controller.getCurrentActivation(host)!
    expect(transition.affected).toBe(true)
    expect(transition.reason).toBe('SEMANTIC_NUMBER_CHANGED')
    expect(actB.activationId).not.toBe(actA.activationId)
    expect(actB.signatureHash).not.toBe(actA.signatureHash)
    // lineage: previous activation + previous signature carried (non-null)
    expect(transition.transition!.previousActivationId).toBe(actA.activationId)
    expect(transition.transition!.previousSignatureHash).toBe(actA.signatureHash)
    expect(transition.transition!.strictBoundaryIdentity).toBe('tB')
  })

  it('LINEAGE-2: only the FIRST activation may have null previous lineage', () => {
    const controller = new FormulaProjectionController()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const plan: FormulaNativeRenderPlan = {
      documentKey: 'doc.md',
      revision: 1,
      sourceHash: 'h-x',
      rawNumber: '1-1',
      renderedNumber: '(1-1)',
      formulaRuntimeKey: 'formula:1',
      authority: 'inkchapter-native-transient',
      formulaMode: 'inkchapter',
      strictBoundaryIdentity: 'tA',
      structuralChapterIdentity: 'A1',
      structuralSectionIdentity: null,
      effectiveScope: 'chapter',
    }
    const first = controller.setPlan(host, plan)
    const act1 = controller.getCurrentActivation(host)!
    expect(act1.previousSignatureHash).toBeNull()
    // second transition: previous lineage must be non-null
    const second = controller.applyProjectionPlan(host, { ...plan, rawNumber: '1-2', renderedNumber: '(1-2)' })
    expect(second.transition!.previousActivationId).not.toBeNull()
    expect(second.transition!.previousSignatureHash).not.toBeNull()
  })
})
