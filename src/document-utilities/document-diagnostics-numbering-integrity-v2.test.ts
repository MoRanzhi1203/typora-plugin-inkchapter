// @vitest-environment jsdom
/**
 * Numbering Integrity V2 (spec §9 / §21) — targeted contract tests.
 *
 * The 8 number families (FIGURE/TABLE/CODE_NUMBER_DUPLICATE,
 * FIGURE/TABLE/CODE_NUMBER_ORDER_INVALID, FORMULA_NUMBER_ORDER_INVALID,
 * FORMULA_NUMBER_SECTION_MISMATCH) are IMPLEMENTED in the source-only producer
 * against the ONE canonical "effective number" fact snapshot
 * (`input.objectEffectiveNumbers`, keyed by the object's canonical SOURCE
 * identity `block:<kind>:<ordinal>`). The producer NEVER re-derives a number and
 * NEVER parses one out of rendered text.
 *
 * Covered here:
 *   - duplicate detection (figure / table / code)
 *   - order detection (figure / table / code)
 *   - formula order
 *   - formula section mismatch (+ non-section scoped never fires)
 *   - empty / absent provider silence (zero false positives)
 *   - NUMBER_STYLE_SWITCH_DIAGNOSTIC_ID_CHURN_COUNT=0
 *   - the §21 gates that are assertable in this environment
 */
import { describe, expect, it } from 'vitest'
import {
  CODE_NUMBER_DUPLICATE_CODE,
  CODE_NUMBER_ORDER_INVALID_CODE,
  FIGURE_NUMBER_DUPLICATE_CODE,
  FIGURE_NUMBER_ORDER_INVALID_CODE,
  TABLE_NUMBER_DUPLICATE_CODE,
  TABLE_NUMBER_ORDER_INVALID_CODE,
  FORMULA_NUMBER_ORDER_INVALID_CODE,
  FORMULA_NUMBER_SECTION_MISMATCH_CODE,
  computeDocumentDiagnostics,
  type DocumentDiagnosticsInput,
} from './document-diagnostics'
import { getRuleMeta } from './document-diagnostic-location'
import type { ObjectEffectiveNumberFact, ObjectEffectiveNumbersSnapshot } from './diagnostics-types'

const NUMBER_CODE_LIST = [
  FIGURE_NUMBER_DUPLICATE_CODE, TABLE_NUMBER_DUPLICATE_CODE, CODE_NUMBER_DUPLICATE_CODE,
  FIGURE_NUMBER_ORDER_INVALID_CODE, TABLE_NUMBER_ORDER_INVALID_CODE, CODE_NUMBER_ORDER_INVALID_CODE,
  FORMULA_NUMBER_ORDER_INVALID_CODE, FORMULA_NUMBER_SECTION_MISMATCH_CODE,
] as const

function inputOf(overrides: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:numbering-v2',
    markdown: '正文\n',
    strictMode: false,
    vaultRoot: '/vault',
    headings: [],
    h1Facts: [],
    latentAtxMarkers: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
    ...overrides,
  }
}

const snapshotOf = (
  entries: Record<string, ObjectEffectiveNumberFact>,
  opts: { numberingEnabled?: boolean; sectionNumberingEnabled?: boolean } = {},
): ObjectEffectiveNumbersSnapshot => ({
  numberingEnabled: opts.numberingEnabled ?? true,
  sectionNumberingEnabled: opts.sectionNumberingEnabled ?? false,
  bySourceIdentity: new Map(Object.entries(entries)),
})

type ObjFact = { name: string | null; element: HTMLElement | null; targetIdentity: string }
const obj = (name: string, ordinal: number, kind: 'figure' | 'table' | 'code'): ObjFact =>
  ({ name, element: null, targetIdentity: `block:${kind}:${ordinal}` })
const fml = (ordinal: number) =>
  ({ visibleTagTokens: [], element: null, targetIdentity: `block:formula:${ordinal}` })

const run = (overrides: Partial<DocumentDiagnosticsInput>) =>
  computeDocumentDiagnostics(inputOf(overrides)).diagnostics
const codesOf = (overrides: Partial<DocumentDiagnosticsInput>) => run(overrides).map(d => d.code)

// ── §9 — DUPLICATE ──────────────────────────────────────────────────────────

describe('Numbering V2 §9 — *_NUMBER_DUPLICATE', () => {
  it('figure / table / code share the same effective number → ONE group diagnostic each', () => {
    const figures = run({
      figures: [obj('A', 0, 'figure'), obj('B', 1, 'figure')],
      objectEffectiveNumbers: snapshotOf({ 'block:figure:0': { effectiveNumber: '1' }, 'block:figure:1': { effectiveNumber: '1' } }),
    }).filter(d => d.code === FIGURE_NUMBER_DUPLICATE_CODE)
    expect(figures).toHaveLength(1)
    expect(figures[0].severity).toBe('warning')
    expect(figures[0].location?.kind).toBe('target-group')
    if (figures[0].location?.kind === 'target-group') expect(figures[0].location.targets).toHaveLength(2)
    expect(figures[0].id).toBe(`figure:${FIGURE_NUMBER_DUPLICATE_CODE}:block:figure:0`)

    const tables = run({
      tables: [obj('A', 0, 'table'), obj('B', 1, 'table'), obj('C', 2, 'table')],
      objectEffectiveNumbers: snapshotOf({
        'block:table:0': { effectiveNumber: '2' },
        'block:table:1': { effectiveNumber: '1' },
        'block:table:2': { effectiveNumber: '2' },
      }),
    }).filter(d => d.code === TABLE_NUMBER_DUPLICATE_CODE)
    expect(tables).toHaveLength(1)

    const codes = run({
      codes: [obj('A', 0, 'code'), obj('B', 1, 'code')],
      objectEffectiveNumbers: snapshotOf({ 'block:code:0': { effectiveNumber: '5' }, 'block:code:1': { effectiveNumber: '5' } }),
    }).filter(d => d.code === CODE_NUMBER_DUPLICATE_CODE)
    expect(codes).toHaveLength(1)
  })

  it('OBJECT_NUMBER_DUPLICATE_FALSE_POSITIVE_COUNT=0 — distinct numbers never duplicate', () => {
    const codes = codesOf({
      figures: [obj('A', 0, 'figure'), obj('B', 1, 'figure')],
      tables: [obj('A', 0, 'table'), obj('B', 1, 'table')],
      codes: [obj('A', 0, 'code'), obj('B', 1, 'code')],
      objectEffectiveNumbers: snapshotOf({
        'block:figure:0': { effectiveNumber: '1' }, 'block:figure:1': { effectiveNumber: '2' },
        'block:table:0': { effectiveNumber: '1' }, 'block:table:1': { effectiveNumber: '2' },
        'block:code:0': { effectiveNumber: '1' }, 'block:code:1': { effectiveNumber: '2' },
      }),
    })
    expect(codes).not.toContain(FIGURE_NUMBER_DUPLICATE_CODE)
    expect(codes).not.toContain(TABLE_NUMBER_DUPLICATE_CODE)
    expect(codes).not.toContain(CODE_NUMBER_DUPLICATE_CODE)
  })
})

// ── §9 — ORDER ──────────────────────────────────────────────────────────────

describe('Numbering V2 §9 — *_NUMBER_ORDER_INVALID', () => {
  it('figure / table / code non-increasing numbers → ONE diagnostic on the offending object', () => {
    const fig = run({
      figures: [obj('A', 0, 'figure'), obj('B', 1, 'figure'), obj('C', 2, 'figure')],
      objectEffectiveNumbers: snapshotOf({
        'block:figure:0': { effectiveNumber: '1' },
        'block:figure:1': { effectiveNumber: '3' },
        'block:figure:2': { effectiveNumber: '2' },
      }),
    }).filter(d => d.code === FIGURE_NUMBER_ORDER_INVALID_CODE)
    expect(fig).toHaveLength(1)
    expect(fig[0].id).toBe(`figure:${FIGURE_NUMBER_ORDER_INVALID_CODE}:block:figure:2`)

    const tbl = run({
      tables: [obj('A', 0, 'table'), obj('B', 1, 'table')],
      objectEffectiveNumbers: snapshotOf({ 'block:table:0': { effectiveNumber: '2' }, 'block:table:1': { effectiveNumber: '1' } }),
    }).filter(d => d.code === TABLE_NUMBER_ORDER_INVALID_CODE)
    expect(tbl).toHaveLength(1)

    const code = run({
      codes: [obj('A', 0, 'code'), obj('B', 1, 'code'), obj('C', 2, 'code')],
      objectEffectiveNumbers: snapshotOf({
        'block:code:0': { effectiveNumber: '1' },
        'block:code:1': { effectiveNumber: '1' },
        'block:code:2': { effectiveNumber: '3' },
      }),
    }).filter(d => d.code === CODE_NUMBER_ORDER_INVALID_CODE)
    expect(code).toHaveLength(1)
  })

  it('OBJECT_NUMBER_ORDER_FALSE_POSITIVE_COUNT=0 — strictly increasing numbers never fire', () => {
    const codes = codesOf({
      tables: [obj('A', 0, 'table'), obj('B', 1, 'table'), obj('C', 2, 'table')],
      objectEffectiveNumbers: snapshotOf({
        'block:table:0': { effectiveNumber: '1' },
        'block:table:1': { effectiveNumber: '2' },
        'block:table:2': { effectiveNumber: '2.1' },
      }),
    })
    expect(codes).not.toContain(TABLE_NUMBER_ORDER_INVALID_CODE)
  })

  it('ORDER is silent when the provider snapshot is INCOMPLETE for the type (never guess)', () => {
    const codes = codesOf({
      tables: [obj('A', 0, 'table'), obj('B', 1, 'table')],
      // Only the SECOND table has a fact → order is not judgeable.
      objectEffectiveNumbers: snapshotOf({ 'block:table:1': { effectiveNumber: '1' } }),
    })
    expect(codes).not.toContain(TABLE_NUMBER_ORDER_INVALID_CODE)
  })
})

// ── §9 — FORMULA ────────────────────────────────────────────────────────────

describe('Numbering V2 §9 — formula number rules', () => {
  it('FORMULA_NUMBER_ORDER_INVALID — non-increasing formula numbers', () => {
    const hits = run({
      formulas: [fml(0), fml(1), fml(2)],
      objectEffectiveNumbers: snapshotOf({
        'block:formula:0': { effectiveNumber: '1' },
        'block:formula:1': { effectiveNumber: '3' },
        'block:formula:2': { effectiveNumber: '2' },
      }),
    }).filter(d => d.code === FORMULA_NUMBER_ORDER_INVALID_CODE)
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe(`formula:${FORMULA_NUMBER_ORDER_INVALID_CODE}:block:formula:2`)
  })

  it('FORMULA_NUMBER_SECTION_MISMATCH — section-scoped number ≠ the section it sits in', () => {
    const hits = run({
      formulas: [fml(0), fml(1)],
      objectEffectiveNumbers: snapshotOf({
        'block:formula:0': { effectiveNumber: '1.1', sectionNumber: '1', actualSectionNumber: '2' },
        // Not section-scoped → the mismatch rule must NEVER fire.
        'block:formula:1': { effectiveNumber: '2' },
      }),
    }).filter(d => d.code === FORMULA_NUMBER_SECTION_MISMATCH_CODE)
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe(`formula:${FORMULA_NUMBER_SECTION_MISMATCH_CODE}:block:formula:0`)
  })

  it('FORMULA_NUMBER_ORDER_FALSE_POSITIVE_COUNT=0 / FORMULA_NUMBER_SECTION_FALSE_POSITIVE_COUNT=0 — silent when coherent', () => {
    const codes = codesOf({
      formulas: [fml(0), fml(1)],
      objectEffectiveNumbers: snapshotOf({
        'block:formula:0': { effectiveNumber: '1.1', sectionNumber: '1', actualSectionNumber: '1' },
        'block:formula:1': { effectiveNumber: '1.2', sectionNumber: '1', actualSectionNumber: '1' },
      }),
    })
    expect(codes).not.toContain(FORMULA_NUMBER_ORDER_INVALID_CODE)
    expect(codes).not.toContain(FORMULA_NUMBER_SECTION_MISMATCH_CODE)
  })

  it('a NON-section mode never invents a section number', () => {
    const codes = codesOf({
      formulas: [fml(0)],
      objectEffectiveNumbers: snapshotOf({
        'block:formula:0': { effectiveNumber: '1' }, // no sectionNumber / actualSectionNumber
      }),
    })
    expect(codes).not.toContain(FORMULA_NUMBER_SECTION_MISMATCH_CODE)
  })
})

// ── §9 — empty / absent provider ⇒ total silence ────────────────────────────

describe('Numbering V2 §9 — absent / empty provider is silent (zero false positives)', () => {
  const duplicated = (): Partial<DocumentDiagnosticsInput> => ({
    figures: [obj('A', 0, 'figure'), obj('B', 1, 'figure')],
    tables: [obj('A', 0, 'table'), obj('B', 1, 'table')],
    codes: [obj('A', 0, 'code'), obj('B', 1, 'code')],
    formulas: [fml(0), fml(1)],
  })

  it('no provider → zero number diagnostics', () => {
    const codes = codesOf(duplicated())
    for (const c of NUMBER_CODE_LIST) expect(codes, c).not.toContain(c)
  })

  it('numberingEnabled=false → zero number diagnostics', () => {
    const codes = codesOf({
      ...duplicated(),
      objectEffectiveNumbers: snapshotOf({
        'block:figure:0': { effectiveNumber: '1' }, 'block:figure:1': { effectiveNumber: '1' },
        'block:table:0': { effectiveNumber: '1' }, 'block:table:1': { effectiveNumber: '1' },
        'block:code:0': { effectiveNumber: '1' }, 'block:code:1': { effectiveNumber: '1' },
        'block:formula:0': { effectiveNumber: '1' }, 'block:formula:1': { effectiveNumber: '1' },
      }, { numberingEnabled: false }),
    })
    for (const c of NUMBER_CODE_LIST) expect(codes, c).not.toContain(c)
  })

  it('empty bySourceIdentity → zero number diagnostics', () => {
    const codes = codesOf({ ...duplicated(), objectEffectiveNumbers: snapshotOf({}) })
    for (const c of NUMBER_CODE_LIST) expect(codes, c).not.toContain(c)
  })
})

// ── §21 — id stability + source-identity gates ──────────────────────────────

describe('Numbering V2 §21 — style switch never churns an id', () => {
  const idsFor = (numbers: [string, string]): string[] =>
    run({
      figures: [obj('A', 0, 'figure'), obj('B', 1, 'figure')],
      objectEffectiveNumbers: snapshotOf({
        'block:figure:0': { effectiveNumber: numbers[0] },
        'block:figure:1': { effectiveNumber: numbers[1] },
      }),
    })
      .filter(d => d.code === FIGURE_NUMBER_DUPLICATE_CODE)
      .map(d => d.id)

  it('NUMBER_STYLE_SWITCH_DIAGNOSTIC_ID_CHURN_COUNT=0 — Decimal / Roman / Chinese produce the SAME id', () => {
    const decimal = idsFor(['1', '1'])
    const roman = idsFor(['I', 'I'])
    const chinese = idsFor(['一', '一'])
    expect(decimal).toHaveLength(1)
    expect(roman).toEqual(decimal)
    expect(chinese).toEqual(decimal)
    // The id derives from the object's SOURCE identity, never a generated number.
    expect(decimal[0]).toBe(`figure:${FIGURE_NUMBER_DUPLICATE_CODE}:block:figure:0`)
    expect(decimal[0]).not.toContain('1')
  })

  it('MANUAL_PREFIX_GENERATED_NUMBER_SOURCE_IDENTITY_COUNT=0 — ids come from block ordinal, not the number', () => {
    const hits = run({
      tables: [obj('A', 0, 'table'), obj('B', 1, 'table'), obj('C', 2, 'table')],
      objectEffectiveNumbers: snapshotOf({
        'block:table:0': { effectiveNumber: '1' },
        'block:table:1': { effectiveNumber: '3' },
        'block:table:2': { effectiveNumber: '2' },
      }),
    })
    for (const d of hits.filter(x => NUMBER_CODE_LIST.includes(x.code as (typeof NUMBER_CODE_LIST)[number]))) {
      expect(d.id).toBe(`${d.category}:${d.code}:${d.targetIdentity}`)
      expect(d.stableIdentity).toBeUndefined()
    }
  })

  it('every number family is IMPLEMENTED with the source producer authority', () => {
    for (const code of NUMBER_CODE_LIST) {
      const meta = getRuleMeta(code)!
      expect(meta.implementationStatus, code).toBe('IMPLEMENTED')
      expect(meta.producerAuthority, code).toBe('computeDocumentDiagnostics')
    }
  })
})
