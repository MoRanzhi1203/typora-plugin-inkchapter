import { describe, it, expect } from 'vitest'
import {
  computeDesiredNumberState,
  type DesiredCaptionNumberState,
  type NumberingBlock,
  type ObjectNumberingRules,
} from './unified-ordinal-engine'
import { computeSemanticHeadingNumbers } from './semantic-heading-numbering'
import type { CaptionObjectKind, HeadingLevel, SemanticHeadingNumberState } from './semantic-heading-types'
import type { NumberingPreset } from './numbering-preset-formatter'

function hh(key: string, level: HeadingLevel, text = key): NumberingBlock {
  return { kind: 'heading', key, level, text }
}

function obj(objectKind: CaptionObjectKind, stableIdentity: string): NumberingBlock {
  return { kind: 'object', stableIdentity, objectKind }
}

function rulesFor(preset: NumberingPreset): ObjectNumberingRules {
  return {
    figure: { enabled: true, prefix: '图', preset },
    table: { enabled: true, prefix: '表', preset },
    formula: { enabled: true, prefix: '', preset },
    code: { enabled: true, prefix: '代码', preset },
  }
}

function semanticStatesFor(
  blocks: NumberingBlock[],
  mode: 'strict' | 'loose',
  startAt: number[] = [1, 1, 1, 1, 1, 1],
): SemanticHeadingNumberState[] {
  const headings = blocks
    .filter((b): b is Extract<NumberingBlock, { kind: 'heading' }> => b.kind === 'heading')
    .map(b => ({ key: b.key, level: b.level, text: b.text }))
  return computeSemanticHeadingNumbers(headings, mode, { startAt, sourceRevision: 1 })
}

function compute(
  blocks: NumberingBlock[],
  preset: NumberingPreset,
  mode: 'strict' | 'loose',
  startAt: number[] = [1, 1, 1, 1, 1, 1],
): DesiredCaptionNumberState[] {
  return computeDesiredNumberState(blocks, rulesFor(preset), 1, semanticStatesFor(blocks, mode, startAt))
}

function formatted(
  blocks: NumberingBlock[],
  preset: NumberingPreset,
  mode: 'strict' | 'loose',
  startAt: number[] = [1, 1, 1, 1, 1, 1],
): string[] {
  return compute(blocks, preset, mode, startAt).map(r => r.formattedNumber)
}

describe('strict semantic matrix (section-dash)', () => {
  it('S1: H1 title + H2 chapter + H3 section + Figure -> 1.1-1', () => {
    const blocks = [hh('t', 1), hh('c', 2), hh('s', 3), obj('figure', 'f1')]
    expect(formatted(blocks, 'section-dash', 'strict')).toEqual(['1.1-1'])
  })

  it('S2: H1 title + H2 chapter + Figure (no section) -> 1-1', () => {
    const blocks = [hh('t', 1), hh('c', 2), obj('figure', 'f1')]
    expect(formatted(blocks, 'section-dash', 'strict')).toEqual(['1-1'])
  })

  it('S3: H1 title + H2 chapter + H4 + Figure -> 1-1 (H4 is not H3)', () => {
    const blocks = [hh('t', 1), hh('c', 2), hh('x', 4), obj('figure', 'f1')]
    expect(formatted(blocks, 'section-dash', 'strict')).toEqual(['1-1'])
  })

  it('S4: H1 title + Figure -> 1 (H1 is not chapter)', () => {
    const blocks = [hh('t', 1), obj('figure', 'f1')]
    expect(formatted(blocks, 'section-dash', 'strict')).toEqual(['1'])
  })

  it('S5: H2 chapter + H3 section + Figure (no title) -> 1.1-1', () => {
    const blocks = [hh('c', 2), hh('s', 3), obj('figure', 'f1')]
    expect(formatted(blocks, 'section-dash', 'strict')).toEqual(['1.1-1'])
  })
})

describe('loose semantic matrix (section-dash)', () => {
  it('L1: H1 + H2 + Figure -> 1.1-1', () => {
    expect(formatted([hh('c', 1), hh('s', 2), obj('figure', 'f1')], 'section-dash', 'loose')).toEqual(['1.1-1'])
  })

  it('L2: H1 + H3 + Figure -> 1.1-1 (compression)', () => {
    expect(formatted([hh('c', 1), hh('s', 3), obj('figure', 'f1')], 'section-dash', 'loose')).toEqual(['1.1-1'])
  })

  it('L3: H2 + H3 + Figure (no H1) -> 1.1-1', () => {
    expect(formatted([hh('c', 2), hh('s', 3), obj('figure', 'f1')], 'section-dash', 'loose')).toEqual(['1.1-1'])
  })

  it('L4: H1 + Figure -> 1-1 (section degrades to chapter)', () => {
    expect(formatted([hh('c', 1), obj('figure', 'f1')], 'section-dash', 'loose')).toEqual(['1-1'])
  })

  it('L5: Figure (no heading) -> 1', () => {
    expect(formatted([obj('figure', 'f1')], 'section-dash', 'loose')).toEqual(['1'])
  })
})

describe('heterogeneous loose structures (closed by semantic authority)', () => {
  it('heterogeneous chapter root H2/H3 then H1/H3 -> figure 2.1-1', () => {
    const blocks: NumberingBlock[] = [
      hh('c1', 2), hh('s1', 3),
      hh('c2', 1), hh('s2', 3),
      obj('figure', 'f'),
    ]
    expect(formatted(blocks, 'section-dash', 'loose')).toEqual(['2.1-1'])
  })

  it('same-chapter heterogeneous section H1/H3/H2 -> figure 1.1-1 and 1.2-1', () => {
    const blocks: NumberingBlock[] = [
      hh('c', 1), hh('s1', 3), obj('figure', 'f1'),
      hh('s2', 2), obj('figure', 'f2'),
    ]
    expect(formatted(blocks, 'section-dash', 'loose')).toEqual(['1.1-1', '1.2-1'])
  })
})

describe('L-MIX contract tests (path-local loose compression)', () => {
  it('L-MIX-1: H1/H2 branch then H1/H3 branch -> 2.1-1', () => {
    const blocks: NumberingBlock[] = [
      hh('ca', 1), hh('sa', 2),
      hh('cb', 1), hh('sb', 3),
      obj('figure', 'f'),
    ]
    expect(formatted(blocks, 'section-dash', 'loose')).toEqual(['2.1-1'])
  })

  it('L-MIX-2: H2/H3 branch then H2/H4 branch -> 2.1-1', () => {
    const blocks: NumberingBlock[] = [
      hh('ca', 2), hh('sa', 3),
      hh('cb', 2), hh('sb', 4),
      obj('figure', 'f'),
    ]
    expect(formatted(blocks, 'section-dash', 'loose')).toEqual(['2.1-1'])
  })

  it('L-MIX-3: H1/H3 branch then H1/H2 branch -> 2.1-1', () => {
    const blocks: NumberingBlock[] = [
      hh('ca', 1), hh('sa', 3),
      hh('cb', 1), hh('sb', 2),
      obj('figure', 'f'),
    ]
    expect(formatted(blocks, 'section-dash', 'loose')).toEqual(['2.1-1'])
  })
})

describe('strict contract tests', () => {
  it('STRICT-GAP-1: H1 + H2 + H4 + Figure -> effectiveScope chapter', () => {
    const blocks = [hh('t', 1), hh('c', 2), hh('x', 4), obj('figure', 'f')]
    const result = compute(blocks, 'section-dash', 'strict')
    expect(result[0].effectiveScope).toBe('chapter')
    expect(result[0].formattedNumber).toBe('1-1')
  })

  it('STRICT-TITLE-1: H1 + Figure -> effectiveScope global', () => {
    const blocks = [hh('t', 1), obj('figure', 'f')]
    const result = compute(blocks, 'section-dash', 'strict')
    expect(result[0].effectiveScope).toBe('global')
    expect(result[0].formattedNumber).toBe('1')
  })

  it('STRICT-NO-TITLE-1: H2 + H3 + Figure -> effectiveScope section', () => {
    const blocks = [hh('c', 2), hh('s', 3), obj('figure', 'f')]
    const result = compute(blocks, 'section-dash', 'strict')
    expect(result[0].effectiveScope).toBe('section')
    expect(result[0].formattedNumber).toBe('1.1-1')
  })
})

describe('canonical non-default ordinal contract', () => {
  it('chapter=3 section=2 -> 3.2-1 (never 1.1-1)', () => {
    const blocks = [hh('t', 1), hh('c', 2), hh('s', 3), obj('figure', 'f')]
    // semantic chapter start 3, section start 2
    expect(formatted(blocks, 'section-dash', 'strict', [3, 2, 1, 1, 1, 1])).toEqual(['3.2-1'])
  })
})

describe('display-text independence', () => {
  it('changing only rendered heading text does not change numbering', () => {
    const a: NumberingBlock[] = [hh('t', 1, '一、'), hh('c', 2, '1.1'), hh('s', 3, '(I)'), obj('figure', 'f')]
    const b: NumberingBlock[] = [hh('t', 1, 'Document'), hh('c', 2, 'Chapter'), hh('s', 3, 'Section'), obj('figure', 'f')]
    expect(formatted(a, 'section-dash', 'strict')).toEqual(['1.1-1'])
    expect(formatted(b, 'section-dash', 'strict')).toEqual(['1.1-1'])
  })
})

describe('four object kinds count independently', () => {
  it('F M F T M C -> independent sequences in section 2.1', () => {
    const blocks: NumberingBlock[] = [
      hh('t', 1), hh('c1', 2), hh('c2', 2), hh('s', 3),
      obj('figure', 'F1'), obj('formula', 'M1'), obj('figure', 'F2'),
      obj('table', 'T1'), obj('formula', 'M2'), obj('code', 'C1'),
    ]
    expect(formatted(blocks, 'section-dash', 'strict')).toEqual(['2.1-1', '2.1-1', '2.1-2', '2.1-1', '2.1-2', '2.1-1'])
  })
})

describe('insert/delete/reorder (global)', () => {
  it('insert X between A and B reflows B and C', () => {
    const before = [obj('figure', 'A'), obj('figure', 'B'), obj('figure', 'C')]
    expect(formatted(before, 'global', 'loose')).toEqual(['1', '2', '3'])
    const after = [obj('figure', 'A'), obj('figure', 'X'), obj('figure', 'B'), obj('figure', 'C')]
    expect(formatted(after, 'global', 'loose')).toEqual(['1', '2', '3', '4'])
  })

  it('reorder A/C/B obeys document order', () => {
    const blocks = [obj('figure', 'A'), obj('figure', 'C'), obj('figure', 'B')]
    expect(formatted(blocks, 'global', 'loose')).toEqual(['1', '2', '3'])
  })
})

describe('cross-scope move (section-dash)', () => {
  it('moving B from 2.1 to 2.2 repairs both scopes', () => {
    const before: NumberingBlock[] = [
      hh('t', 1), hh('c1', 2), hh('c2', 2),
      hh('s21', 3), obj('figure', 'A'), obj('figure', 'B'), obj('figure', 'C'),
      hh('s22', 3), obj('figure', 'D'),
    ]
    expect(formatted(before, 'section-dash', 'strict')).toEqual(['2.1-1', '2.1-2', '2.1-3', '2.2-1'])

    const after: NumberingBlock[] = [
      hh('t', 1), hh('c1', 2), hh('c2', 2),
      hh('s21', 3), obj('figure', 'A'), obj('figure', 'C'),
      hh('s22', 3), obj('figure', 'D'), obj('figure', 'B'),
    ]
    expect(formatted(after, 'section-dash', 'strict')).toEqual(['2.1-1', '2.1-2', '2.2-1', '2.2-2'])
  })
})

describe('document switch isolation', () => {
  it('two documents compute independently with no shared state', () => {
    const A: NumberingBlock[] = [hh('t', 1), hh('c', 2), hh('s', 3), obj('figure', 'A1'), obj('figure', 'A2')]
    const B: NumberingBlock[] = [hh('c', 1), obj('formula', 'B1'), obj('formula', 'B2'), obj('formula', 'B3')]

    const a1 = formatted(A, 'section-dash', 'strict')
    const a2 = formatted(A, 'section-dash', 'strict')
    const b1 = formatted(B, 'global', 'loose')

    expect(a1).toEqual(['1.1-1', '1.1-2'])
    expect(a2).toEqual(a1)
    expect(b1).toEqual(['1', '2', '3'])
  })
})

describe('FULL_RECOMPUTE_REFERENCE_ENGINE (idempotency)', () => {
  it('recomputing the same state yields identical desired numbering', () => {
    const blocks: NumberingBlock[] = [
      hh('t', 1), hh('c', 2), hh('s', 3),
      obj('figure', 'f1'), obj('formula', 'm1'), obj('table', 't1'),
    ]
    const r1 = compute(blocks, 'section-dash', 'strict')
    const r2 = compute(blocks, 'section-dash', 'strict')
    expect(r1).toEqual(r2)
    expect(r1.map(r => r.formattedNumber)).toEqual(['1.1-1', '1.1-1', '1.1-1'])
  })
})
