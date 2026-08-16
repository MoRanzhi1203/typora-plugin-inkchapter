import { describe, it, expect } from 'vitest'
import {
  DEFAULT_OBJECT_NUMBERING_CONFIG,
  formatSequenceNumber,
  renderNumberTemplate,
  validateNumberTemplate,
  computeObjectNumbers,
  renderNumberingPreview,
  buildObjectNumberingLabel,
  type ObjectNumberingConfig,
  type ObjectNumberingType,
} from './object-numbering-engine'

function configs(overrides?: Partial<Record<ObjectNumberingType, Partial<ObjectNumberingConfig>>>): Record<ObjectNumberingType, ObjectNumberingConfig> {
  return {
    table: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.table },
    figure: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.figure },
    code: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.code },
    formula: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.formula },
    ...(overrides ? {
      table: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.table, ...overrides.table },
      figure: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.figure, ...overrides.figure },
      code: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.code, ...overrides.code },
      formula: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.formula, ...overrides.formula },
    } : {}),
  }
}

describe('formatSequenceNumber', () => {
  it('arabic', () => {
    expect(formatSequenceNumber(1, 'arabic')).toBe('1')
    expect(formatSequenceNumber(10, 'arabic')).toBe('10')
  })
  it('arabic-padded', () => {
    expect(formatSequenceNumber(1, 'arabic-padded', 3)).toBe('001')
    expect(formatSequenceNumber(42, 'arabic-padded', 3)).toBe('042')
  })
  it('chinese', () => {
    expect(formatSequenceNumber(1, 'chinese')).toBe('一')
    expect(formatSequenceNumber(10, 'chinese')).toBe('十')
    expect(formatSequenceNumber(11, 'chinese')).toBe('十一')
    expect(formatSequenceNumber(20, 'chinese')).toBe('二十')
    expect(formatSequenceNumber(101, 'chinese')).toBe('一百零一')
  })
  it('chinese-financial', () => {
    expect(formatSequenceNumber(1, 'chinese-financial')).toBe('壹')
    expect(formatSequenceNumber(2, 'chinese-financial')).toBe('贰')
    expect(formatSequenceNumber(10, 'chinese-financial')).toBe('拾')
  })
  it('roman', () => {
    expect(formatSequenceNumber(1, 'roman-upper')).toBe('I')
    expect(formatSequenceNumber(4, 'roman-upper')).toBe('IV')
    expect(formatSequenceNumber(9, 'roman-upper')).toBe('IX')
    expect(formatSequenceNumber(4, 'roman-lower')).toBe('iv')
  })
  it('alpha', () => {
    expect(formatSequenceNumber(1, 'alpha-upper')).toBe('A')
    expect(formatSequenceNumber(26, 'alpha-upper')).toBe('Z')
    expect(formatSequenceNumber(27, 'alpha-upper')).toBe('AA')
    expect(formatSequenceNumber(1, 'alpha-lower')).toBe('a')
  })
})

describe('renderNumberTemplate / validateNumberTemplate', () => {
  it('renders {n} and {chapter}/{section}', () => {
    expect(renderNumberTemplate('{n}', { n: '3' })).toBe('3')
    expect(renderNumberTemplate('{chapter}-{n}', { n: '3', chapter: '2' })).toBe('2-3')
    expect(renderNumberTemplate('({chapter}.{n})', { n: '3', chapter: '2' })).toBe('(2.3)')
  })
  it('falls back to 0 for missing chapter/section', () => {
    expect(renderNumberTemplate('{chapter}-{n}', { n: '3' })).toBe('0-3')
  })
  it('validates template must contain {n}', () => {
    expect(validateNumberTemplate('{n}').valid).toBe(true)
    expect(validateNumberTemplate('{chapter}-{n}').valid).toBe(true)
    expect(validateNumberTemplate('{chapter}').valid).toBe(false)
    expect(validateNumberTemplate('{unknown}').valid).toBe(false)
  })
})

describe('computeObjectNumbers', () => {
  it('continuous assigns independent per-type sequences', () => {
    const targets = [
      { type: 'table' as const, documentOrder: 0 },
      { type: 'figure' as const, documentOrder: 1 },
      { type: 'code' as const, documentOrder: 2 },
      { type: 'formula' as const, documentOrder: 3 },
      { type: 'figure' as const, documentOrder: 4 },
      { type: 'table' as const, documentOrder: 5 },
    ]
    const r = computeObjectNumbers(targets, { configs: configs() })
    expect(r.map(x => x.sequenceValue)).toEqual([1, 1, 1, 1, 2, 2])
    expect(r.map(x => x.type)).toEqual(['table', 'figure', 'code', 'formula', 'figure', 'table'])
  })

  it('startAt shifts the sequence', () => {
    const targets = [
      { type: 'table' as const, documentOrder: 0 },
      { type: 'table' as const, documentOrder: 1 },
      { type: 'table' as const, documentOrder: 2 },
    ]
    const r = computeObjectNumbers(targets, { configs: configs({ table: { startAt: 3 } }) })
    expect(r.map(x => x.sequenceValue)).toEqual([3, 4, 5])
  })

  it('reset-h1 restarts per chapter', () => {
    const targets = [
      { type: 'table' as const, documentOrder: 0, headingContext: { h1: '1' } },
      { type: 'table' as const, documentOrder: 1, headingContext: { h1: '1' } },
      { type: 'table' as const, documentOrder: 2, headingContext: { h1: '2' } },
      { type: 'table' as const, documentOrder: 3, headingContext: { h1: '2' } },
    ]
    const r = computeObjectNumbers(targets, { configs: configs({ table: { numberingMode: 'reset-h1' } }) })
    expect(r.map(x => x.sequenceValue)).toEqual([1, 2, 1, 2])
  })

  it('chapter-linked renders {chapter}-{n}', () => {
    const targets = [
      { type: 'figure' as const, documentOrder: 0, headingContext: { h1: '1' } },
      { type: 'figure' as const, documentOrder: 1, headingContext: { h1: '1' } },
      { type: 'figure' as const, documentOrder: 2, headingContext: { h1: '2' } },
    ]
    const r = computeObjectNumbers(targets, { configs: configs({ figure: { numberingMode: 'chapter-linked', template: '{chapter}-{n}' } }) })
    expect(r.map(x => x.renderedNumber)).toEqual(['1-1', '1-2', '2-1'])
  })

  it('formula custom template renders ({chapter}.{n})', () => {
    const targets = [
      { type: 'formula' as const, documentOrder: 0, headingContext: { h1: '2' } },
    ]
    const r = computeObjectNumbers(targets, { configs: configs({ formula: { numberingMode: 'chapter-linked', template: '({chapter}.{n})', formulaMode: 'inkchapter' } }) })
    expect(r[0].renderedNumber).toBe('(2.1)')
  })

  it('section template {chapter}.{section}.{n} renders 2.3.1 / 2.3.2', () => {
    const targets = [
      { type: 'code' as const, documentOrder: 0, headingContext: { h1: '2', h2: '2.3' } },
      { type: 'code' as const, documentOrder: 1, headingContext: { h1: '2', h2: '2.3' } },
    ]
    const r = computeObjectNumbers(targets, { configs: configs({ code: { numberingMode: 'chapter-linked', template: '{chapter}.{section}.{n}' } }) })
    expect(r.map(x => x.renderedNumber)).toEqual(['2.3.1', '2.3.2'])
  })

  it('object before first H1 falls back to chapter=0 section=0', () => {
    const targets = [
      { type: 'figure' as const, documentOrder: 0, headingContext: {} },
    ]
    const r = computeObjectNumbers(targets, { configs: configs({ figure: { numberingMode: 'chapter-linked', template: '{chapter}-{n}' } }) })
    expect(r[0].renderedNumber).toBe('0-1')
  })

  it('cross-chapter move renumbers while name stays bound', () => {
    const cfg = configs({ figure: { numberingMode: 'chapter-linked', template: '{chapter}-{n}' } })
    const before = computeObjectNumbers([{ type: 'figure' as const, documentOrder: 0, name: '系统架构', headingContext: { h1: '1' } }], { configs: cfg })
    const after = computeObjectNumbers([{ type: 'figure' as const, documentOrder: 0, name: '系统架构', headingContext: { h1: '2' } }], { configs: cfg })
    expect(before[0].renderedNumber).toBe('1-1')
    expect(after[0].renderedNumber).toBe('2-1')
    expect(before[0].label).toBe('图 1-1 系统架构')
    expect(after[0].label).toBe('图 2-1 系统架构')
  })
})

describe('name decoupling', () => {
  it('name never influences numbering', () => {
    const a = computeObjectNumbers([{ type: 'figure' as const, documentOrder: 0, name: '系统架构' }], { configs: configs() })
    const b = computeObjectNumbers([{ type: 'figure' as const, documentOrder: 0 }], { configs: configs() })
    expect(a[0].sequenceValue).toBe(b[0].sequenceValue)
    expect(a[0].label).toBe('图 1 系统架构')
    expect(b[0].label).toBe('图 1')
  })
})

describe('buildObjectNumberingLabel / renderNumberingPreview', () => {
  it('builds label with single structural spaces', () => {
    expect(buildObjectNumberingLabel('图', '2-3', '系统架构')).toBe('图 2-3 系统架构')
    expect(buildObjectNumberingLabel('图', '2-3', '')).toBe('图 2-3')
    expect(buildObjectNumberingLabel('', '1', '')).toBe('1')
  })
  it('renders preview', () => {
    expect(renderNumberingPreview('figure', DEFAULT_OBJECT_NUMBERING_CONFIG.figure, { n: 3, name: '示例图片' })).toBe('图 3 示例图片')
    expect(renderNumberingPreview('figure', { ...DEFAULT_OBJECT_NUMBERING_CONFIG.figure, template: '{chapter}-{n}' }, { n: 3, chapter: '2', name: '示例图片' })).toBe('图 2-3 示例图片')
    expect(renderNumberingPreview('formula', { ...DEFAULT_OBJECT_NUMBERING_CONFIG.formula, template: '({chapter}.{n})' }, { n: 3, chapter: '2' })).toBe('(2.3)')
  })
})
