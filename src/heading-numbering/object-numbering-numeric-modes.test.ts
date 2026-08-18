import { describe, it, expect } from 'vitest'
import {
  computeObjectNumbers,
  formatObjectNumber,
  resolveObjectNumberingScope,
  scopeFromNumberingMode,
  resolveScope,
  defaultTemplateFor,
  renderNumberingPreview,
  DEFAULT_OBJECT_NUMBERING_CONFIG,
  type ObjectNumberingConfig,
  type ObjectNumberingType,
  type ObjectNumberingContext,
} from './object-numbering-engine'
import { resolveHeadingContext } from './heading-context-resolver'

function configs(overrides?: Partial<Record<ObjectNumberingType, Partial<ObjectNumberingConfig>>>): Record<ObjectNumberingType, ObjectNumberingConfig> {
  return {
    table: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.table, ...overrides?.table },
    figure: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.figure, ...overrides?.figure },
    code: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.code, ...overrides?.code },
    formula: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.formula, ...overrides?.formula },
  }
}

const ORD = (chapterOrdinal: number | null, sectionOrdinal: number | null = null, subsectionOrdinal: number | null = null): ObjectNumberingContext =>
  ({ chapterOrdinal, sectionOrdinal, subsectionOrdinal })

describe('numeric chapter scope resolution', () => {
  it('maps legacy numberingMode to scope', () => {
    expect(scopeFromNumberingMode('continuous')).toBe('document')
    expect(scopeFromNumberingMode('reset-h1')).toBe('chapter')
    expect(scopeFromNumberingMode('reset-h2')).toBe('section')
    expect(scopeFromNumberingMode('reset-h3')).toBe('subsection')
    expect(scopeFromNumberingMode('chapter-linked')).toBe('chapter')
  })

  it('scope field wins over numberingMode', () => {
    expect(resolveScope({ ...DEFAULT_OBJECT_NUMBERING_CONFIG.table, numberingMode: 'reset-h1', scope: 'section' })).toBe('section')
    expect(resolveScope({ ...DEFAULT_OBJECT_NUMBERING_CONFIG.table, numberingMode: 'reset-h1' })).toBe('chapter')
  })

  it('resolves without fallback when ordinals are complete', () => {
    const r = resolveObjectNumberingScope('section', ORD(2, 3))
    expect(r).toEqual({ scope: 'section', fallback: false, reason: null })
  })

  it('fallback subsection → section → chapter → document', () => {
    expect(resolveObjectNumberingScope('subsection', ORD(2, 3)).scope).toBe('section')
    expect(resolveObjectNumberingScope('section', ORD(2)).scope).toBe('chapter')
    expect(resolveObjectNumberingScope('chapter', ORD(null)).scope).toBe('document')
    expect(resolveObjectNumberingScope('document', ORD(null)).scope).toBe('document')
  })

  it('fallback reason describes the missing level', () => {
    expect(resolveObjectNumberingScope('section', ORD(2)).reason).toBe('NO_SECTION_CONTEXT')
    expect(resolveObjectNumberingScope('chapter', ORD(null)).reason).toBe('NO_CHAPTER_CONTEXT')
    expect(resolveObjectNumberingScope('subsection', ORD(2, 3)).reason).toBe('NO_SUBSECTION_CONTEXT')
  })
})

describe('local heading ordinals (not global, not parsed from label)', () => {
  it('sectionOrdinal is local under the current H1', () => {
    const headings = [
      { level: 1 as const, number: '第一章', documentOrder: 0 },
      { level: 2 as const, number: '1', documentOrder: 1 },
      { level: 2 as const, number: '2', documentOrder: 2 },
      { level: 1 as const, number: '第二章', documentOrder: 3 },
      { level: 2 as const, number: '1', documentOrder: 4 },
    ]
    const ctx = resolveHeadingContext(headings, 5)
    expect(ctx.chapterOrdinal).toBe(2)
    expect(ctx.sectionOrdinal).toBe(1) // local — global H2 would be 3
  })

  it('subsectionOrdinal is local under the current H2', () => {
    const headings = [
      { level: 1 as const, number: '1', documentOrder: 0 },
      { level: 2 as const, number: '1', documentOrder: 1 },
      { level: 3 as const, number: '1', documentOrder: 2 },
      { level: 3 as const, number: '2', documentOrder: 3 },
      { level: 2 as const, number: '2', documentOrder: 4 },
      { level: 3 as const, number: '1', documentOrder: 5 },
    ]
    const ctx = resolveHeadingContext(headings, 6)
    expect(ctx.chapterOrdinal).toBe(1)
    expect(ctx.sectionOrdinal).toBe(2)
    expect(ctx.subsectionOrdinal).toBe(1) // local — global H3 would be 3
  })

  it('numeric ordinal independent of Chinese display label', () => {
    const headings = [
      { level: 1 as const, number: '二、环境准备', documentOrder: 0 },
      { level: 2 as const, number: '1', documentOrder: 1 },
    ]
    const ctx = resolveHeadingContext(headings, 2)
    expect(ctx.chapterOrdinal).toBe(1)
    expect(ctx.sectionOrdinal).toBe(1)
  })
})

describe('computeObjectNumbers numeric modes', () => {
  it('document scope {n} → 1,2,3', () => {
    const r = computeObjectNumbers(
      [{ type: 'table', documentOrder: 0 }, { type: 'table', documentOrder: 1 }, { type: 'table', documentOrder: 2 }],
      { configs: configs({ table: { scope: 'document', template: '{n}' } }) },
    )
    expect(r.map(x => x.renderedNumber)).toEqual(['1', '2', '3'])
  })

  it('chapter scope {chapter}.{n} → 2.1', () => {
    const r = computeObjectNumbers(
      [{ type: 'table', documentOrder: 0, headingContext: { chapterOrdinal: 2 } }],
      { configs: configs({ table: { scope: 'chapter', template: '{chapter}.{n}' } }) },
    )
    expect(r[0].renderedNumber).toBe('2.1')
  })

  it('chapter scope {chapter}-{n} → 3-4', () => {
    const r = computeObjectNumbers(
      [
        { type: 'figure', documentOrder: 0, headingContext: { chapterOrdinal: 3 } },
        { type: 'figure', documentOrder: 1, headingContext: { chapterOrdinal: 3 } },
        { type: 'figure', documentOrder: 2, headingContext: { chapterOrdinal: 3 } },
        { type: 'figure', documentOrder: 3, headingContext: { chapterOrdinal: 3 } },
      ],
      { configs: configs({ figure: { scope: 'chapter', template: '{chapter}-{n}' } }) },
    )
    expect(r.map(x => x.renderedNumber)).toEqual(['3-1', '3-2', '3-3', '3-4'])
  })

  it('section scope {chapter}.{section}.{n} → 2.3.1', () => {
    const r = computeObjectNumbers(
      [{ type: 'code', documentOrder: 0, headingContext: { chapterOrdinal: 2, sectionOrdinal: 3 } }],
      { configs: configs({ code: { scope: 'section', template: '{chapter}.{section}.{n}' } }) },
    )
    expect(r[0].renderedNumber).toBe('2.3.1')
  })

  it('subsection scope → 2.3.4.1', () => {
    const r = computeObjectNumbers(
      [{ type: 'figure', documentOrder: 0, headingContext: { chapterOrdinal: 2, sectionOrdinal: 3, subsectionOrdinal: 4 } }],
      { configs: configs({ figure: { scope: 'subsection', template: '{chapter}.{section}.{subsection}.{n}' } }) },
    )
    expect(r[0].renderedNumber).toBe('2.3.4.1')
  })

  it('formula ({chapter}.{n}) → (2.1)', () => {
    const r = computeObjectNumbers(
      [{ type: 'formula', documentOrder: 0, headingContext: { chapterOrdinal: 2 } }],
      { configs: configs({ formula: { scope: 'chapter', template: '({chapter}.{n})', formulaMode: 'inkchapter' } }) },
    )
    expect(r[0].renderedNumber).toBe('(2.1)')
  })

  it('minDigits only affects {n}: chapter=3 n=4 minDigits=2 → 3-04', () => {
    const r = computeObjectNumbers(
      [
        { type: 'table', documentOrder: 0, headingContext: { chapterOrdinal: 3 } },
        { type: 'table', documentOrder: 1, headingContext: { chapterOrdinal: 3 } },
        { type: 'table', documentOrder: 2, headingContext: { chapterOrdinal: 3 } },
        { type: 'table', documentOrder: 3, headingContext: { chapterOrdinal: 3 } },
      ],
      { configs: configs({ table: { scope: 'chapter', template: '{chapter}-{n}', minDigits: 2 } }) },
    )
    expect(r.map(x => x.renderedNumber)).toEqual(['3-01', '3-02', '3-03', '3-04'])
  })

  it('startAt shifts the sequence (2.3, 2.4)', () => {
    const r = computeObjectNumbers(
      [
        { type: 'table', documentOrder: 0, headingContext: { chapterOrdinal: 2 } },
        { type: 'table', documentOrder: 1, headingContext: { chapterOrdinal: 2 } },
      ],
      { configs: configs({ table: { scope: 'chapter', template: '{chapter}.{n}', startAt: 3 } }) },
    )
    expect(r.map(x => x.renderedNumber)).toEqual(['2.3', '2.4'])
  })

  it('chapter reset: 1.1, 1.2, 2.1', () => {
    const r = computeObjectNumbers(
      [
        { type: 'table', documentOrder: 0, headingContext: { chapterOrdinal: 1 } },
        { type: 'table', documentOrder: 1, headingContext: { chapterOrdinal: 1 } },
        { type: 'table', documentOrder: 2, headingContext: { chapterOrdinal: 2 } },
      ],
      { configs: configs({ table: { scope: 'chapter', template: '{chapter}.{n}' } }) },
    )
    expect(r.map(x => x.renderedNumber)).toEqual(['1.1', '1.2', '2.1'])
  })

  it('section reset: 2.3.1, 2.3.2, 2.4.1', () => {
    const r = computeObjectNumbers(
      [
        { type: 'code', documentOrder: 0, headingContext: { chapterOrdinal: 2, sectionOrdinal: 3 } },
        { type: 'code', documentOrder: 1, headingContext: { chapterOrdinal: 2, sectionOrdinal: 3 } },
        { type: 'code', documentOrder: 2, headingContext: { chapterOrdinal: 2, sectionOrdinal: 4 } },
      ],
      { configs: configs({ code: { scope: 'section', template: '{chapter}.{section}.{n}' } }) },
    )
    expect(r.map(x => x.renderedNumber)).toEqual(['2.3.1', '2.3.2', '2.4.1'])
  })

  it('four types count independently', () => {
    const cfg: Partial<ObjectNumberingConfig> = { scope: 'chapter', template: '{chapter}.{n}' }
    const r = computeObjectNumbers(
      [
        { type: 'table', documentOrder: 0, headingContext: { chapterOrdinal: 2 } },
        { type: 'figure', documentOrder: 1, headingContext: { chapterOrdinal: 2 } },
        { type: 'code', documentOrder: 2, headingContext: { chapterOrdinal: 2 } },
        { type: 'formula', documentOrder: 3, headingContext: { chapterOrdinal: 2 } },
      ],
      { configs: configs({ table: cfg, figure: cfg, code: cfg, formula: { ...cfg, template: '({chapter}.{n})' } }) },
    )
    expect(r.map(x => x.renderedNumber)).toEqual(['2.1', '2.1', '2.1', '(2.1)'])
  })

  it('fallback: section requested but no section → chapter → 2.1', () => {
    const r = computeObjectNumbers(
      [{ type: 'table', documentOrder: 0, headingContext: { chapterOrdinal: 2 } }],
      { configs: configs({ table: { scope: 'section', template: '{chapter}.{section}.{n}' } }) },
    )
    expect(r[0].renderedNumber).toBe('2.1')
  })

  it('fallback: no chapter → document → 1 (never 0.1)', () => {
    const r = computeObjectNumbers(
      [{ type: 'table', documentOrder: 0, headingContext: {} }],
      { configs: configs({ table: { scope: 'chapter', template: '{chapter}.{n}' } }) },
    )
    expect(r[0].renderedNumber).toBe('1')
  })

  it('legacy continuous + {n} still yields document scope 1,2', () => {
    const r = computeObjectNumbers(
      [{ type: 'table', documentOrder: 0 }, { type: 'table', documentOrder: 1 }],
      { configs: configs({ table: { numberingMode: 'continuous', template: '{n}' } }) },
    )
    expect(r.map(x => x.renderedNumber)).toEqual(['1', '2'])
  })
})

describe('defaultTemplateFor / renderNumberingPreview (runtime formatter)', () => {
  it('default templates per scope', () => {
    expect(defaultTemplateFor('document', 'table')).toBe('{n}')
    expect(defaultTemplateFor('chapter', 'table')).toBe('{chapter}.{n}')
    expect(defaultTemplateFor('section', 'table')).toBe('{chapter}.{section}.{n}')
    expect(defaultTemplateFor('subsection', 'table')).toBe('{chapter}.{section}.{subsection}.{n}')
    expect(defaultTemplateFor('document', 'formula')).toBe('({n})')
    expect(defaultTemplateFor('chapter', 'formula')).toBe('({chapter}.{n})')
  })

  it('preview reuses the runtime formatter', () => {
    expect(renderNumberingPreview('figure', { ...DEFAULT_OBJECT_NUMBERING_CONFIG.figure, scope: 'chapter', template: '{chapter}-{n}' }, { n: 3, chapterOrdinal: 2, name: '示例图片' })).toBe('图 2-3 示例图片')
    expect(renderNumberingPreview('code', { ...DEFAULT_OBJECT_NUMBERING_CONFIG.code, scope: 'section', template: '{chapter}.{section}.{n}' }, { n: 1, chapterOrdinal: 2, sectionOrdinal: 3, name: '示例代码' })).toBe('代码 2.3.1 示例代码')
    expect(renderNumberingPreview('formula', { ...DEFAULT_OBJECT_NUMBERING_CONFIG.formula, scope: 'chapter', template: '({chapter}.{n})' }, { n: 1, chapterOrdinal: 2 })).toBe('(2.1)')
  })
})

describe('formatObjectNumber', () => {
  it('renders numeric ordinals without 0-fallback', () => {
    const cfg: ObjectNumberingConfig = { ...DEFAULT_OBJECT_NUMBERING_CONFIG.table, scope: 'chapter', template: '{chapter}.{n}' }
    expect(formatObjectNumber(cfg, 'table', ORD(2), '1', 'chapter', 'chapter')).toBe('2.1')
  })
})
