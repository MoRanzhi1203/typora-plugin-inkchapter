import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { planFormulaSemanticNumbers, type FormulaSemanticContext } from './formula-semantic-planner'
import { DEFAULT_OBJECT_NUMBERING_CONFIG, type ObjectNumberingConfig } from './object-numbering-engine'

function cfg(overrides: Partial<ObjectNumberingConfig> = {}): ObjectNumberingConfig {
  return { ...DEFAULT_OBJECT_NUMBERING_CONFIG.formula, enabled: true, formulaMode: 'inkchapter', ...overrides }
}

const ctx = (chapter: number | null, section: number | null): FormulaSemanticContext => ({ chapterOrdinal: chapter, sectionOrdinal: section })

describe('Phase 7 FORMULA-SEM — canonical semantic formula numbering (pure planner)', () => {
  it('FORMULA-SEM-1: strict H1/H2/H3 Section 1 + section-dash → raw 1.1-1 → display (1.1-1)', () => {
    const r = planFormulaSemanticNumbers([ctx(1, 1)], cfg({ preset: 'section-dash' }))
    expect(r[0].effectiveScope).toBe('section')
    expect(r[0].rawNumber).toBe('1.1-1')
    expect(r[0].renderedNumber).toBe('(1.1-1)')
  })

  it('FORMULA-SEM-2: two formulas in same Section → (1.1-1) (1.1-2)', () => {
    const r = planFormulaSemanticNumbers([ctx(1, 1), ctx(1, 1)], cfg({ preset: 'section-dash' }))
    expect(r.map(x => x.renderedNumber)).toEqual(['(1.1-1)', '(1.1-2)'])
  })

  it('FORMULA-SEM-3: next Section resets formula ordinal → (1.2-1)', () => {
    const r = planFormulaSemanticNumbers([ctx(1, 1), ctx(1, 1), ctx(1, 2)], cfg({ preset: 'section-dash' }))
    expect(r.map(x => x.renderedNumber)).toEqual(['(1.1-1)', '(1.1-2)', '(1.2-1)'])
  })

  it('FORMULA-SEM-4: SECTION preset with only Chapter → effectiveScope=chapter → (1-1)', () => {
    const r = planFormulaSemanticNumbers([ctx(1, null)], cfg({ preset: 'section-dash' }))
    expect(r[0].effectiveScope).toBe('chapter')
    expect(r[0].chapterOrdinal).toBe(1)
    expect(r[0].sectionOrdinal).toBeNull()
    expect(r[0].renderedNumber).toBe('(1-1)')
  })

  it('FORMULA-SEM-5: SECTION preset with only document title → effectiveScope=global → (1)', () => {
    const r = planFormulaSemanticNumbers([ctx(null, null)], cfg({ preset: 'section-dash' }))
    expect(r[0].effectiveScope).toBe('global')
    expect(r[0].renderedNumber).toBe('(1)')
  })

  it('FORMULA-SEM-6: missing H3 (H1/H2/H4) must NOT fabricate Section → (1-1)', () => {
    // chapter=1, section=null (no H3): SECTION request degrades to CHAPTER.
    const r = planFormulaSemanticNumbers([ctx(1, null)], cfg({ preset: 'section-dash' }))
    expect(r[0].effectiveScope).toBe('chapter')
    expect(r[0].rawNumber).toBe('1-1')
    expect(r[0].renderedNumber).toBe('(1-1)')
  })

  it('FORMULA-SEM-7: loose branch-local semantic state consumed without physical-level assumptions', () => {
    // The planner only receives semantic ordinals — never physical H levels.
    const r = planFormulaSemanticNumbers([ctx(2, 1)], cfg({ preset: 'section-dash' }))
    expect(r[0].renderedNumber).toBe('(2.1-1)')
  })

  it('FORMULA-SEM-8: startAt=3 → first formula in scope has n=3', () => {
    const r = planFormulaSemanticNumbers([ctx(1, 1)], cfg({ preset: 'section-dash', startAt: 3 }))
    expect(r[0].rawNumber).toBe('1.1-3')
  })

  it('FORMULA-SEM-9: minDigits=2 pads only {n} → (1.1-03), never chapter/section', () => {
    const r = planFormulaSemanticNumbers([ctx(1, 1)], cfg({ preset: 'section-dash', startAt: 3, minDigits: 2 }))
    expect(r[0].rawNumber).toBe('1.1-03')
    expect(r[0].renderedNumber).toBe('(1.1-03)')
  })

  it('FORMULA-SEM-10: formula ordinal independent of figure/table/code counters', () => {
    // The planner is the ONLY formula counter; per-kind scopeKey prefix isolates it.
    const r = planFormulaSemanticNumbers([ctx(1, 1), ctx(1, 1)], cfg({ preset: 'section-dash' }))
    expect(r.map(x => x.ordinal)).toEqual([1, 2])
  })

  it('FORMULA-SEM-11: chapter-dash preset → (1-1) in section scope uses chapter only', () => {
    const r = planFormulaSemanticNumbers([ctx(1, 3)], cfg({ preset: 'chapter-dash' }))
    expect(r[0].effectiveScope).toBe('chapter')
    expect(r[0].renderedNumber).toBe('(1-1)')
  })
})

describe('Phase 7 FORMULA-PRESET — standard preset authority + legacy-custom', () => {
  it('FORMULA-PRESET-1: preset=section-dash wins over legacy template ({n}) → (1.1-1)', () => {
    const r = planFormulaSemanticNumbers([ctx(1, 1)], cfg({ preset: 'section-dash', numberingMode: 'continuous', template: '({n})' }))
    expect(r[0].renderedNumber).toBe('(1.1-1)')
  })

  it('FORMULA-PRESET-2: all five standard presets produce exact raw/display values', () => {
    const cases: Array<[ObjectNumberingConfig['preset'] | undefined, string]> = [
      ['global', '(1)'],
      ['chapter-dot', '(1.1)'],
      ['section-dot', '(1.1.1)'],
      ['chapter-dash', '(1-1)'],
      ['section-dash', '(1.1-1)'],
    ]
    for (const [preset, expected] of cases) {
      const r = planFormulaSemanticNumbers([ctx(1, 1)], cfg({ preset }))
      expect(r[0].renderedNumber).toBe(expected)
    }
  })

  it('FORMULA-PRESET-3: legacy-custom uses template with canonical semantic variables', () => {
    const r = planFormulaSemanticNumbers([ctx(5, 3)], cfg({ preset: 'legacy-custom', template: '({chapter}.{section}.{n})' }))
    expect(r[0].renderedNumber).toBe('(5.3.1)')
    const r2 = planFormulaSemanticNumbers([ctx(5, 3)], cfg({ preset: 'legacy-custom', template: '({chapter}.{section}.{n})', startAt: 2 }))
    expect(r2[0].renderedNumber).toBe('(5.3.2)')
  })

  it('FORMULA-PRESET-4: chapter-dash with section semantic → chapter scope (never 2-1-3)', () => {
    const r = planFormulaSemanticNumbers([ctx(2, 1)], cfg({ preset: 'chapter-dash' }))
    expect(r[0].rawNumber).toBe('2-1')
    expect(r[0].renderedNumber).toBe('(2-1)')
  })
})

describe('Phase 7 source guards — old Formula DOM authority removed, defer policy present', () => {
  const src = readFileSync(fileURLToPath(new URL('./caption-service.ts', import.meta.url)), 'utf8')

  it('FORMULA-DEFER-4: no old DOM heading authority fallback for formula path', () => {
    expect(src).not.toContain('headingContextForTargetRoot')
    expect(src).not.toContain('buildHeadingContextEntries')
    expect(src).not.toContain('HEADING-CONTEXT targetType=${targetType}')
    expect(src).not.toContain('source=data-inkchapter-heading-number')
  })

  it('FORMULA-DEFER-1/2: NO_SNAPSHOT / DOCUMENT_CONTEXT_MISMATCH defer with writes=0', () => {
    expect(src).toContain("FORMULA-SEMANTIC-PROJECTION-DEFER")
    expect(src).toContain("reason: 'NO_SNAPSHOT'")
    expect(src).toContain("reason: 'DOCUMENT_CONTEXT_MISMATCH'")
    expect(src).toContain('projectionWrites: 0')
  })

  it('FORMULA-SEMANTIC markers present; shared resolver + planner reused', () => {
    expect(src).toContain('resolvePrecedingSemanticHeading')
    expect(src).toContain('planFormulaSemanticNumbers')
    // Phase 7R.3.6 markers (explicit resolution + atomic plan-set coherence).
    expect(src).toContain('FORMULA-SEMANTIC-RESOLUTION')
    expect(src).toContain('FORMULA-PLAN-CANDIDATE-COHERENCE')
    expect(src).toContain('FORMULA-PLAN-SET-PUBLISH')
    expect(src).toContain('FORMULA-CANONICAL-TARGET')
  })
})
