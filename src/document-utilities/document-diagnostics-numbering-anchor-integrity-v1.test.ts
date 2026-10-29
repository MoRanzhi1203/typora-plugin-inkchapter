// @vitest-environment jsdom
/**
 * Document Diagnostics — Phase H (Numbering Integrity §9/§21) + Phase I
 * (Anchor Integrity §10/§22) targeted contract tests.
 *
 * IMPLEMENTED this round:
 *   Phase H  TABLE_MANUAL_NUMBER_PREFIX / CODE_MANUAL_NUMBER_PREFIX
 *            (mirror the existing FIGURE_MANUAL_NUMBER_PREFIX; reuse the ONE
 *            `detectManualNumberPrefix` authority — no second regex).
 *   Phase I  LINK_LOCAL_ANCHOR_MISSING  (canonical heading anchor = Typora's
 *            own rendered heading id — the SAME identity the outline adapter
 *            matches `href="#id"` against; no second slugifier).
 *            HEADING_ANCHOR_COLLISION   (ONE diagnostic per collision group).
 *
 * Numbering Integrity V2 (§9) — the number families
 *   FIGURE/TABLE/CODE_NUMBER_DUPLICATE, FIGURE/TABLE/CODE_NUMBER_ORDER_INVALID,
 *   FORMULA_NUMBER_ORDER_INVALID, FORMULA_NUMBER_SECTION_MISMATCH
 * are now IMPLEMENTED against the canonical effective-number provider; this file
 * asserts they stay SILENT when no provider snapshot is supplied.
 *
 * DEFERRED_BY_SPEC this round (asserted NOT to be accidentally enabled):
 *   LINK_LOCAL_FILE_ANCHOR_MISSING, and the 3 cross-reference families.
 */
import { describe, expect, it } from 'vitest'
import {
  CODE_MANUAL_NUMBER_PREFIX_CODE,
  HEADING_ANCHOR_COLLISION_CODE,
  LINK_LOCAL_ANCHOR_MISSING_CODE,
  TABLE_MANUAL_NUMBER_PREFIX_CODE,
  computeDocumentDiagnostics,
  resolveDocumentDiagnosticSeverity,
  type DocumentDiagnosticsInput,
} from './document-diagnostics'
import {
  DOCUMENT_DIAGNOSTIC_RULE_REGISTRY,
  getRuleMeta,
} from './document-diagnostic-location'

interface HeadingSpec {
  level: number
  text: string
  line?: number | null
  identity?: string | null
  id?: string | null
  withElement?: boolean
}

function makeHeading(spec: HeadingSpec, index: number): { level: number; text: string; stableIdentity?: string; element: HTMLElement | null } {
  const text = spec.text
  if (spec.withElement === false) {
    return { level: spec.level, text, stableIdentity: spec.identity === null ? undefined : (spec.identity ?? `H:${index}`), element: null }
  }
  const el = document.createElement(`h${spec.level}`)
  const line = spec.line === undefined ? index * 2 : spec.line
  if (line != null) el.setAttribute('data-line', String(line))
  if (spec.id != null && spec.id !== '') el.id = spec.id
  el.textContent = text
  return { level: spec.level, text, stableIdentity: spec.identity === null ? undefined : (spec.identity ?? `H:${index}`), element: el }
}

function inputOf(
  markdown: string | null,
  headings: readonly HeadingSpec[] = [],
  overrides: Partial<DocumentDiagnosticsInput> = {},
): DocumentDiagnosticsInput {
  const facts = headings.map((h, i) => makeHeading(h, i))
  return {
    documentKey: 'doc:numbering-anchor',
    markdown,
    strictMode: false,
    vaultRoot: '/vault',
    headings: facts,
    h1Facts: facts.filter(f => f.level === 1).map(f => ({ stableIdentity: f.stableIdentity, element: f.element, text: f.text })),
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

const diagOf = (
  code: string,
  markdown: string | null,
  headings: readonly HeadingSpec[] = [],
  overrides: Partial<DocumentDiagnosticsInput> = {},
) => computeDocumentDiagnostics(inputOf(markdown, headings, overrides)).diagnostics.filter(d => d.code === code)

const codesOf = (
  markdown: string | null,
  headings: readonly HeadingSpec[] = [],
  overrides: Partial<DocumentDiagnosticsInput> = {},
): string[] => computeDocumentDiagnostics(inputOf(markdown, headings, overrides)).diagnostics.map(d => d.code)

const table = (name: string, ordinal: number) => ({ name, element: null, targetIdentity: `block:table:${ordinal}` })
const codeBlock = (name: string, ordinal: number) => ({ name, element: null, targetIdentity: `block:code:${ordinal}` })

// ── Phase H §9 — TABLE / CODE manual number prefix ──────────────────────────

describe('Phase H §9 — TABLE_MANUAL_NUMBER_PREFIX / CODE_MANUAL_NUMBER_PREFIX', () => {
  it('is an IMPLEMENTED Warning family registered to the producer', () => {
    for (const code of [TABLE_MANUAL_NUMBER_PREFIX_CODE, CODE_MANUAL_NUMBER_PREFIX_CODE]) {
      const meta = getRuleMeta(code)!
      expect(meta.implementationStatus).toBe('IMPLEMENTED')
      expect(meta.producerAuthority).toBe('computeDocumentDiagnostics')
      expect(resolveDocumentDiagnosticSeverity(code, true)).toBe('warning')
      expect(resolveDocumentDiagnosticSeverity(code, false)).toBe('warning')
    }
  })

  it('emits ONE table diagnostic for a manual prefix while table auto-numbering is ON', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n'
    const hits = diagOf(TABLE_MANUAL_NUMBER_PREFIX_CODE, md, [], {
      tables: [table('1. 数据表', 0)], numberingEnabled: { table: true },
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].location?.kind).toBe('block-node')
    expect(hits[0].targetIdentity).toBe('block:table:0')
  })

  it('emits ONE code diagnostic for a manual prefix while code auto-numbering is ON', () => {
    const hits = diagOf(CODE_MANUAL_NUMBER_PREFIX_CODE, '普通正文\n', [], {
      codes: [codeBlock('1.1 示例代码', 0)], numberingEnabled: { code: true },
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].targetIdentity).toBe('block:code:0')
  })

  it('TABLE_MANUAL_PREFIX_FALSE_POSITIVE_COUNT=0 — silent while numbering is OFF', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n'
    expect(codesOf(md, [], { tables: [table('1. 数据表', 0)] })).not.toContain(TABLE_MANUAL_NUMBER_PREFIX_CODE)
    expect(codesOf(md, [], { tables: [table('1. 数据表', 0)], numberingEnabled: { table: false } }))
      .not.toContain(TABLE_MANUAL_NUMBER_PREFIX_CODE)
  })

  it('CODE_MANUAL_PREFIX_FALSE_POSITIVE_COUNT=0 — silent while numbering is OFF', () => {
    expect(codesOf('普通正文\n', [], { codes: [codeBlock('1. 示例', 0)] })).not.toContain(CODE_MANUAL_NUMBER_PREFIX_CODE)
  })

  it('TABLE_MANUAL_PREFIX_FALSE_POSITIVE_COUNT=0 — non-numbering leading digits never match', () => {
    for (const name of ['2026 数据', '5G 网络', 'ISO 9001 认证', 'R2 版本']) {
      expect(diagOf(TABLE_MANUAL_NUMBER_PREFIX_CODE, '正文\n', [], {
        tables: [table(name, 0)], numberingEnabled: { table: true },
      }), name).toHaveLength(0)
    }
  })

  it('CODE_MANUAL_PREFIX_FALSE_POSITIVE_COUNT=0 — non-numbering leading digits never match', () => {
    for (const name of ['2026 示例', '3D 渲染', '第一章 说明']) {
      expect(diagOf(CODE_MANUAL_NUMBER_PREFIX_CODE, '正文\n', [], {
        codes: [codeBlock(name, 0)], numberingEnabled: { code: true },
      }), name).toHaveLength(0)
    }
  })

  it('MANUAL_PREFIX_GENERATED_NUMBER_SOURCE_IDENTITY_COUNT=0 — identity derives from the SOURCE object, not a generated number', () => {
    const out = computeDocumentDiagnostics(inputOf('正文\n', [], {
      tables: [table('1. 数据表', 3)], codes: [codeBlock('1.1 示例代码', 2)],
      numberingEnabled: { table: true, code: true },
    }))
    const t = out.diagnostics.find(d => d.code === TABLE_MANUAL_NUMBER_PREFIX_CODE)!
    const c = out.diagnostics.find(d => d.code === CODE_MANUAL_NUMBER_PREFIX_CODE)!
    // The id/targetIdentity are the object's block ordinal (source identity) —
    // NO generated sequence number ("1"/"1.1") ever enters them.
    expect(t.targetIdentity).toBe('block:table:3')
    expect(t.id).toBe('table:TABLE_MANUAL_NUMBER_PREFIX:block:table:3')
    expect(t.id).not.toContain('1. ')
    expect(c.targetIdentity).toBe('block:code:2')
    expect(c.id).toBe('code:CODE_MANUAL_NUMBER_PREFIX:block:code:2')
    expect(c.id).not.toContain('1.1 ')
  })

  it('NUMBER_STYLE_SWITCH_DIAGNOSTIC_ID_CHURN_COUNT=0 — the rule never reads a number style', () => {
    const build = () => computeDocumentDiagnostics(inputOf('正文\n', [], {
      tables: [table('1. 数据表', 0)], codes: [codeBlock('1. 示例代码', 0)],
      numberingEnabled: { table: true, code: true },
    })).diagnostics.filter(d => d.code === TABLE_MANUAL_NUMBER_PREFIX_CODE || d.code === CODE_MANUAL_NUMBER_PREFIX_CODE).map(d => d.id).sort()
    expect(build()).toEqual(build())
  })
})

// ── Phase H §21 — the number families are now IMPLEMENTED (Numbering V2) ─────

const NUMBER_INTEGRITY_FAMILIES = [
  'FIGURE_NUMBER_DUPLICATE', 'TABLE_NUMBER_DUPLICATE', 'CODE_NUMBER_DUPLICATE',
  'FIGURE_NUMBER_ORDER_INVALID', 'TABLE_NUMBER_ORDER_INVALID', 'CODE_NUMBER_ORDER_INVALID',
  'FORMULA_NUMBER_ORDER_INVALID', 'FORMULA_NUMBER_SECTION_MISMATCH',
] as const

describe('Phase H §21 / Numbering V2 — number duplicate / order / formula families', () => {
  it('are registered IMPLEMENTED with the source producer authority', () => {
    for (const familyId of NUMBER_INTEGRITY_FAMILIES) {
      const meta = getRuleMeta(familyId)!
      expect(meta.implementationStatus, familyId).toBe('IMPLEMENTED')
      expect(meta.producerAuthority, familyId).toBe('computeDocumentDiagnostics')
    }
  })

  it('OBJECT_NUMBER_DUPLICATE_FALSE_POSITIVE_COUNT=0 / OBJECT_NUMBER_ORDER_FALSE_POSITIVE_COUNT=0 — silent with no provider', () => {
    const out = computeDocumentDiagnostics(inputOf('正文\n', [], {
      figures: [{ name: 'A', element: null, targetIdentity: 'block:figure:0' }, { name: 'B', element: null, targetIdentity: 'block:figure:1' }],
      tables: [table('A', 0), table('B', 1)],
      codes: [codeBlock('A', 0), codeBlock('B', 1)],
      numberingEnabled: { figure: true, table: true, code: true },
    }))
    const codes = out.diagnostics.map(d => d.code)
    for (const familyId of NUMBER_INTEGRITY_FAMILIES) expect(codes).not.toContain(familyId)
  })

  it('FORMULA_NUMBER_ORDER_FALSE_POSITIVE_COUNT=0 / FORMULA_NUMBER_SECTION_FALSE_POSITIVE_COUNT=0 — silent with no provider', () => {
    const codes = codesOf('$$\nx\n$$\n\n$$\ny\n$$\n', [], {
      formulas: [{ visibleTagTokens: ['(1)'], element: null, targetIdentity: 'block:formula:0' }, { visibleTagTokens: ['(2)'], element: null, targetIdentity: 'block:formula:1' }],
      numberingEnabled: { formula: true },
    })
    expect(codes).not.toContain('FORMULA_NUMBER_ORDER_INVALID')
    expect(codes).not.toContain('FORMULA_NUMBER_SECTION_MISMATCH')
  })
})

// ── Phase I §10 — Anchor Integrity ──────────────────────────────────────────

describe('Phase I §10 — LINK_LOCAL_ANCHOR_MISSING', () => {
  it('is an IMPLEMENTED Warning family registered to the producer', () => {
    const meta = getRuleMeta(LINK_LOCAL_ANCHOR_MISSING_CODE)!
    expect(meta.implementationStatus).toBe('IMPLEMENTED')
    expect(meta.producerAuthority).toBe('computeDocumentDiagnostics')
    expect(resolveDocumentDiagnosticSeverity(LINK_LOCAL_ANCHOR_MISSING_CODE, true)).toBe('warning')
  })

  it('A1 — a valid local anchor resolves to a canonical heading id (no diagnostic)', () => {
    const md = '# 标题\n\n[跳转](#标题)\n'
    expect(diagOf(LINK_LOCAL_ANCHOR_MISSING_CODE, md, [{ level: 1, text: '标题', line: 0, id: '标题' }]))
      .toHaveLength(0)
  })

  it('A2 — a missing local anchor emits ONE source-range diagnostic', () => {
    const md = '# 标题\n\n[跳转](#不存在)\n'
    const hits = diagOf(LINK_LOCAL_ANCHOR_MISSING_CODE, md, [{ level: 1, text: '标题', line: 0, id: '标题' }])
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].location?.kind).toBe('source-range')
    expect(hits[0].metadata?.anchor).toBe('不存在')
  })

  it('LOCAL_ANCHOR_MISSING_FALSE_POSITIVE_COUNT=0 — silent when the anchor authority is unavailable (no heading id)', () => {
    const md = '# 标题\n\n[跳转](#任意)\n'
    expect(codesOf(md, [{ level: 1, text: '标题', line: 0 }], {})).not.toContain(LINK_LOCAL_ANCHOR_MISSING_CODE)
  })

  it('ignores anchors inside literal / code ranges (the shared scanner exclusion)', () => {
    const md = '# 标题\n\n`[x](#不存在)`\n\n```\n[x](#也不存在)\n```\n'
    expect(codesOf(md, [{ level: 1, text: '标题', line: 0, id: '标题' }], {})).not.toContain(LINK_LOCAL_ANCHOR_MISSING_CODE)
  })

  it('LOCAL_FILE_ANCHOR_UNSAFE_GUESS_COUNT=0 — a cross-file anchor is never guessed as a local anchor', () => {
    const md = '# 标题\n\n[跳转](other.md#target)\n'
    const codes = codesOf(md, [{ level: 1, text: '标题', line: 0, id: '标题' }], {})
    expect(codes).not.toContain(LINK_LOCAL_ANCHOR_MISSING_CODE)
    expect(codes).not.toContain('LINK_LOCAL_FILE_ANCHOR_MISSING')
  })
})

describe('Phase I §10 — HEADING_ANCHOR_COLLISION', () => {
  it('is an IMPLEMENTED Warning family with target-group presentation', () => {
    const meta = getRuleMeta(HEADING_ANCHOR_COLLISION_CODE)!
    expect(meta.implementationStatus).toBe('IMPLEMENTED')
    expect(meta.producerAuthority).toBe('computeDocumentDiagnostics')
    expect(meta.locationStrategy).toBe('target-group')
    expect(resolveDocumentDiagnosticSeverity(HEADING_ANCHOR_COLLISION_CODE, true)).toBe('warning')
  })

  it('A3 — two headings sharing ONE anchor id → ONE target-group diagnostic', () => {
    const md = '## A\n\n## B\n'
    const headings: HeadingSpec[] = [
      { level: 2, text: 'A', line: 0, id: 'same' },
      { level: 2, text: 'B', line: 2, id: 'same' },
    ]
    const hits = diagOf(HEADING_ANCHOR_COLLISION_CODE, md, headings)
    expect(hits).toHaveLength(1)
    expect(hits[0].location?.kind).toBe('target-group')
    if (hits[0].location?.kind === 'target-group') expect(hits[0].location.targets).toHaveLength(2)
    expect(hits[0].targetIdentity).toBe('heading-anchor-collision:same')
  })

  it('HEADING_ANCHOR_COLLISION_FALSE_POSITIVE_COUNT=0 — distinct anchors never collide', () => {
    const md = '## A\n\n## B\n'
    expect(diagOf(HEADING_ANCHOR_COLLISION_CODE, md, [
      { level: 2, text: 'A', line: 0, id: 'a' },
      { level: 2, text: 'B', line: 2, id: 'b' },
    ])).toHaveLength(0)
  })
})

// ── Universal gates ─────────────────────────────────────────────────────────

describe('Phase H/I — deferred families are never accidentally enabled', () => {
  it('DEFERRED_REFERENCE_RULE_ACCIDENTALLY_ENABLED_COUNT=0 — cross-reference stays DEFERRED_BY_SPEC', () => {
    for (const familyId of ['FIGURE_REFERENCE_TARGET_MISSING', 'TABLE_REFERENCE_TARGET_MISSING', 'FORMULA_REFERENCE_TARGET_MISSING']) {
      expect(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY[familyId].implementationStatus).toBe('DEFERRED_BY_SPEC')
    }
    const codes = codesOf('图 3-2 见正文\n', [])
    expect(codes).not.toContain('FIGURE_REFERENCE_TARGET_MISSING')
    expect(codes).not.toContain('TABLE_REFERENCE_TARGET_MISSING')
    expect(codes).not.toContain('FORMULA_REFERENCE_TARGET_MISSING')
  })

  it('CROSS_REFERENCE_BROAD_PROSE_REGEX_PARSER_COUNT=0 — no deferred reference family has a producer code', () => {
    for (const familyId of [
      'FIGURE_REFERENCE_TARGET_MISSING', 'TABLE_REFERENCE_TARGET_MISSING', 'FORMULA_REFERENCE_TARGET_MISSING',
      'LINK_LOCAL_FILE_ANCHOR_MISSING',
    ]) {
      expect(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY[familyId].producerAuthority).toBe('NONE')
    }
  })
})
