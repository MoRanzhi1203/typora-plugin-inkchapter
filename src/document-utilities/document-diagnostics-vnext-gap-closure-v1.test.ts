// @vitest-environment jsdom
/**
 * Document Diagnostics VNext — Requirements Gap Closure V1 targeted contract
 * tests (§37/§38/§49).
 *
 * Covers the rules ENABLED this round:
 *   §13 DOCUMENT_HEADINGS_ONLY_NO_BODY      (multi-heading, no body)
 *   §16 SECTION_EMPTY                       (heading with no body/subheadings)
 *   §17 SECTION_ONLY_SUBHEADINGS            (heading subtree without body)
 *   §18 TABLE_BLOCK_STRUCTURE_INVALID       (non-standalone table block)
 *   §19 FORMULA_BLOCK_STRUCTURE_INVALID     (non-standalone display formula)
 *   §24 HEADING_MANUAL_NUMBER_PREFIX
 *   §24 FIGURE_MANUAL_NUMBER_PREFIX
 *   §28 CODE_EMPTY_BLOCK / TABLE_EMPTY_CONTENT / FORMULA_EMPTY_CONTENT /
 *       BLOCKQUOTE_EMPTY
 *
 * Every rule is asserted on: positive emission, negative no-emission, severity,
 * domain, scope, presentation metadata, stable identity, dedup and the
 * §12/§16/§17 mutual-exclusion hard gates.
 */
import { describe, expect, it } from 'vitest'
import {
  BLOCKQUOTE_EMPTY_CODE,
  CODE_EMPTY_BLOCK_CODE,
  DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE,
  DOCUMENT_HEADING_ONLY_NO_BODY_CODE,
  FIGURE_MANUAL_NUMBER_PREFIX_CODE,
  FORMULA_BLOCK_STRUCTURE_INVALID_CODE,
  FORMULA_EMPTY_CONTENT_CODE,
  HEADING_MANUAL_NUMBER_PREFIX_CODE,
  SECTION_EMPTY_CODE,
  SECTION_ONLY_SUBHEADINGS_CODE,
  TABLE_BLOCK_STRUCTURE_INVALID_CODE,
  TABLE_EMPTY_CONTENT_CODE,
  computeDocumentDiagnostics,
  resolveDocumentDiagnosticSeverity,
  type DocumentDiagnosticsInput,
} from './document-diagnostics'
import {
  DOCUMENT_DIAGNOSTIC_AREAS,
  DOCUMENT_DIAGNOSTIC_RULE_REGISTRY,
  getRuleMeta,
  resolveRuleReasonChip,
  resolveRuleScope,
} from './document-diagnostic-location'
import { shouldRenderReasonChip } from './document-heading-diagnostic-marker-v5-12'
import { detectManualNumberPrefix } from './document-diagnostics-vnext-authority'

interface HeadingSpec {
  level: number
  text?: string
  line?: number | null
  identity?: string | null
  withElement?: boolean
}

function makeElement(tag: string, line: number | null, text: string): HTMLElement {
  const el = document.createElement(tag)
  if (line != null) el.setAttribute('data-line', String(line))
  el.textContent = text
  return el
}

function inputOf(
  markdown: string | null,
  headings: readonly HeadingSpec[] = [],
  overrides: Partial<DocumentDiagnosticsInput> = {},
): DocumentDiagnosticsInput {
  const facts = headings.map((h, i) => {
    const text = h.text ?? `H${h.level}`
    return {
      level: h.level,
      text,
      stableIdentity: h.identity === null ? undefined : (h.identity ?? `H:${i}`),
      element: h.withElement === false ? null : makeElement(`h${h.level}`, h.line === undefined ? i * 2 : h.line, text),
    }
  })
  return {
    documentKey: 'doc:vnext',
    markdown,
    strictMode: true,
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

const codesOf = (
  markdown: string | null,
  headings: readonly HeadingSpec[] = [],
  overrides: Partial<DocumentDiagnosticsInput> = {},
): string[] => computeDocumentDiagnostics(inputOf(markdown, headings, overrides)).diagnostics.map(d => d.code)

const diagOf = (
  code: string,
  markdown: string | null,
  headings: readonly HeadingSpec[] = [],
  overrides: Partial<DocumentDiagnosticsInput> = {},
) => computeDocumentDiagnostics(inputOf(markdown, headings, overrides)).diagnostics.filter(d => d.code === code)

// ── §12/§13 — multi-heading document without body ──────────────────────────

describe('VNext §12/§13 — DOCUMENT_HEADINGS_ONLY_NO_BODY', () => {
  const H = DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE

  it('§13 emits exactly ONE hint for H1 + H2 without body', () => {
    const out = computeDocumentDiagnostics(inputOf('# A\n\n## B\n', [
      { level: 1, text: 'A', line: 0 }, { level: 2, text: 'B', line: 2 },
    ]))
    const hits = out.diagnostics.filter(d => d.code === H)
    expect(hits).toHaveLength(1)
    expect(hits[0].message).toBe('文档只有标题结构')
    expect(hits[0].detail).toBe('当前文档包含多个标题，但尚未包含实际正文内容。')
    expect(hits[0].severity).toBe('info')
    expect(hits[0].domain).toBe('document')
    expect(hits[0].metadata?.scope).toBe('document')
    expect(hits[0].metadata?.reasonChip).toBe(false)
    // Target Group V1 §4/§7 — the semantic target set is EVERY heading, held as
    // ONE `target-group` (ONE Drawer row) with the FIRST heading as scroll anchor.
    expect(hits[0].location?.kind).toBe('target-group')
    expect(hits[0].location?.kind === 'target-group' ? hits[0].location.targets.length : 0).toBe(2)
    expect(hits[0].location?.kind === 'target-group' ? hits[0].location.scrollAnchor.kind : null).toBe('canonical-node')
    expect(hits[0].locator?.kind).toBe('heading')
    // Drawer counts for the screenshot acceptance fixture.
    expect(out.infoCount).toBe(1)
    expect(out.errorCount).toBe(0)
    expect(out.warningCount).toBe(0)
  })

  it('§14 H1 + H2 + H3 without body → one hint', () => {
    expect(diagOf(H, '# A\n\n## B\n\n### C\n', [
      { level: 1, text: 'A', line: 0 }, { level: 2, text: 'B', line: 2 }, { level: 3, text: 'C', line: 4 },
    ])).toHaveLength(1)
  })

  it('§44 H1 + H2 + paragraph → NO hint', () => {
    expect(codesOf('# A\n\n## B\n\n正文\n', [
      { level: 1, text: 'A', line: 0 }, { level: 2, text: 'B', line: 2 },
    ])).not.toContain(H)
  })

  it('§43 a SINGLE heading without body emits ONLY the single-heading hint', () => {
    const codes = codesOf('# A\n', [{ level: 1, text: 'A', line: 0 }])
    expect(codes).toContain(DOCUMENT_HEADING_ONLY_NO_BODY_CODE)
    expect(codes).not.toContain(H)
  })

  it('the single / multi hints can NEVER coexist (SINGLE_AND_MULTI_HEADING_ONLY_COEXIST=0)', () => {
    for (const headingCount of [1, 2, 3, 6]) {
      const md = Array.from({ length: headingCount }, (_, i) => `${'#'.repeat(1 + (i % 3))} H${i}`).join('\n\n') + '\n'
      const headings = md.trimEnd().split('\n\n').map((line, i) => ({
        level: line.match(/^#+/)?.[0].length ?? 1,
        text: line.replace(/^#+\s*/, ''),
        line: md.split('\n').indexOf(line),
      }))
      const codes = codesOf(md, headings)
      const single = codes.filter(c => c === DOCUMENT_HEADING_ONLY_NO_BODY_CODE).length
      const multi = codes.filter(c => c === H).length
      expect(single + multi).toBeLessThanOrEqual(1)
    }
  })

  it('§14 0 heading + plain body → no headings-only hint', () => {
    expect(codesOf('普通正文\n')).not.toContain(H)
  })

  it('§46 H2 + H3 without H1 (strict) → completeness hint + strict structure error coexist', () => {
    const md = '## B\n\n### C\n'
    const headings = [{ level: 2, text: 'B', line: 0 }, { level: 3, text: 'C', line: 2 }]
    const out = computeDocumentDiagnostics(inputOf(md, headings))
    const codes = out.diagnostics.map(d => d.code)
    expect(codes).toContain(H)
    expect(codes).toContain('STRICT_SINGLE_H1_NO_H1')
    expect(out.diagnostics.find(d => d.code === H)!.severity).toBe('info')
    expect(out.diagnostics.find(d => d.code === 'STRICT_SINGLE_H1_NO_H1')!.severity).toBe('error')
  })

  it('is never duplicated (dedup / duplicate id gate)', () => {
    const out = computeDocumentDiagnostics(inputOf('# A\n\n## B\n', [
      { level: 1, text: 'A', line: 0 }, { level: 2, text: 'B', line: 2 },
    ]))
    const ids = out.diagnostics.map(d => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ── §16/§17 — section completeness ────────────────────────────────────────

describe('VNext §16/§17 — SECTION_EMPTY / SECTION_ONLY_SUBHEADINGS', () => {
  it('§16 emits SECTION_EMPTY for a heading immediately followed by a sibling', () => {
    const md = '# A\n\n# B\n\n正文\n'
    const headings = [{ level: 1, text: 'A', line: 0 }, { level: 1, text: 'B', line: 2 }]
    const hits = diagOf(SECTION_EMPTY_CODE, md, headings)
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('info')
    expect(hits[0].metadata?.scope).toBe('heading')
    expect(hits[0].targetIdentity).toBe('section:H:0')
    // a sibling with body must NOT be reported
    expect(diagOf(SECTION_EMPTY_CODE, md, headings).some(d => d.targetIdentity === 'section:H:1')).toBe(false)
  })

  it('§17 emits SECTION_ONLY_SUBHEADINGS when the subtree owns only headings', () => {
    const md = '# A\n\n## B\n\n# C\n\n正文\n'
    const headings = [
      { level: 1, text: 'A', line: 0 }, { level: 2, text: 'B', line: 2 }, { level: 1, text: 'C', line: 4 },
    ]
    const only = diagOf(SECTION_ONLY_SUBHEADINGS_CODE, md, headings)
    expect(only).toHaveLength(1)
    expect(only[0].targetIdentity).toBe('section:H:0')
    const empty = diagOf(SECTION_EMPTY_CODE, md, headings)
    expect(empty).toHaveLength(1)
    expect(empty[0].targetIdentity).toBe('section:H:1')
  })

  it('§17 a heading never receives BOTH hints (SECTION_EMPTY_AND_ONLY_SUBHEADINGS_DUPLICATE=0)', () => {
    const md = '# A\n\n## B\n\n# C\n\n正文\n'
    const headings = [
      { level: 1, text: 'A', line: 0 }, { level: 2, text: 'B', line: 2 }, { level: 1, text: 'C', line: 4 },
    ]
    const out = computeDocumentDiagnostics(inputOf(md, headings))
    const byIdentity = new Map<string, number>()
    for (const d of out.diagnostics) {
      if (d.code !== SECTION_EMPTY_CODE && d.code !== SECTION_ONLY_SUBHEADINGS_CODE) continue
      const key = String(d.targetIdentity)
      byIdentity.set(key, (byIdentity.get(key) ?? 0) + 1)
    }
    for (const count of byIdentity.values()) expect(count).toBe(1)
  })

  it('never fires for a fully bodyless document (the document-level hint owns it)', () => {
    const md = '# A\n\n## B\n'
    const headings = [{ level: 1, text: 'A', line: 0 }, { level: 2, text: 'B', line: 2 }]
    const codes = codesOf(md, headings)
    expect(codes).toContain(DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE)
    expect(codes).not.toContain(SECTION_EMPTY_CODE)
    expect(codes).not.toContain(SECTION_ONLY_SUBHEADINGS_CODE)
  })

  it('a section WITH body is never reported', () => {
    expect(codesOf('# A\n\n正文\n', [{ level: 1, text: 'A', line: 0 }])).not.toContain(SECTION_EMPTY_CODE)
  })

  it('is silent when the heading source lines are unverifiable', () => {
    // The facts claim a heading that does not exist in the Markdown → no verdict.
    expect(codesOf('# A\n\n正文\n', [{ level: 1, text: 'NOT-IN-SOURCE', line: null }]))
      .not.toContain(SECTION_EMPTY_CODE)
  })
})

// ── §24 — manual number prefix ────────────────────────────────────────────

describe('VNext §24 — manual number prefix detection', () => {
  it('detects the documented families', () => {
    expect(detectManualNumberPrefix('1. 概述')?.family).toBe('arabic')
    expect(detectManualNumberPrefix('1.1 概述')?.family).toBe('arabic')
    expect(detectManualNumberPrefix('1.1.2 概述')?.family).toBe('arabic')
    expect(detectManualNumberPrefix('一、概述')?.family).toBe('cjk-enum')
    expect(detectManualNumberPrefix('（一）概述')?.family).toBe('cjk-paren')
  })

  it('§24 never matches the documented negative list', () => {
    for (const text of ['2026 年计划', '5G 网络', '3D 模型', 'R2 版本', 'ISO 9001 认证', '一对一', '三分之一', '2026.10 发布', '第一章 概述']) {
      expect(detectManualNumberPrefix(text), text).toBeNull()
    }
  })

  it('§24 documents (never hides) the inherent decimal ambiguity', () => {
    // A decimal that is byte-identical to a numbering level is indistinguishable
    // without a user-source numbering authority — the rule runs only while
    // auto-numbering is ON, where the collision is real.
    expect(detectManualNumberPrefix('1.5 倍增长')?.matched).toBe('1.5')
  })

  it('only runs while heading auto-numbering is ON', () => {
    const md = '# 1. 概述\n'
    const headings = [{ level: 1, text: '1. 概述', line: 0 }]
    expect(codesOf(md, headings)).not.toContain(HEADING_MANUAL_NUMBER_PREFIX_CODE)
    const hits = diagOf(HEADING_MANUAL_NUMBER_PREFIX_CODE, md, headings, { numberingEnabled: { heading: true } })
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].metadata?.scope).toBe('heading')
  })

  it('emits nothing for a clean heading while numbering is ON', () => {
    expect(diagOf(HEADING_MANUAL_NUMBER_PREFIX_CODE, '# 概述\n', [{ level: 1, text: '概述', line: 0 }], { numberingEnabled: { heading: true } }))
      .toHaveLength(0)
  })
})

// ── §18/§19 — non-standalone tables / display formulas ────────────────────

describe('VNext §18/§19 — non-standalone table / display formula blocks', () => {
  it('§18 an ERROR for a table inside a blockquote, silence for a standalone table', () => {
    const bad = '> | a | b |\n> | - | - |\n> | 1 | 2 |\n'
    const good = '| a | b |\n| - | - |\n| 1 | 2 |\n'
    const badHits = diagOf(TABLE_BLOCK_STRUCTURE_INVALID_CODE, bad)
    expect(badHits).toHaveLength(1)
    expect(badHits[0].severity).toBe('error')
    expect(badHits[0].domain).toBe('document')
    expect(badHits[0].location?.kind).toBe('source-range')
    expect(diagOf(TABLE_BLOCK_STRUCTURE_INVALID_CODE, good)).toHaveLength(0)
  })

  it('§19 an ERROR for a display formula inside a list item, silence when standalone', () => {
    const bad = '- $$\n  x\n  $$\n'
    const good = '$$\nx\n$$\n'
    expect(diagOf(FORMULA_BLOCK_STRUCTURE_INVALID_CODE, bad)).toHaveLength(1)
    expect(diagOf(FORMULA_BLOCK_STRUCTURE_INVALID_CODE, good)).toHaveLength(0)
  })

  it('§19 inline `$…$` math is never a display block', () => {
    expect(codesOf('正文 $x+y$ 正文\n')).not.toContain(FORMULA_BLOCK_STRUCTURE_INVALID_CODE)
    expect(codesOf('正文 $x+y$ 正文\n')).not.toContain(FORMULA_EMPTY_CONTENT_CODE)
  })
})

// ── §28 — empty objects ───────────────────────────────────────────────────

describe('VNext §28 — empty source objects are HINTS', () => {
  it('CODE_EMPTY_BLOCK for an empty fence only', () => {
    expect(diagOf(CODE_EMPTY_BLOCK_CODE, '```js\n```\n')).toHaveLength(1)
    expect(diagOf(CODE_EMPTY_BLOCK_CODE, '```js\ncode\n```\n')).toHaveLength(0)
  })

  it('TABLE_EMPTY_CONTENT for a header-only table', () => {
    expect(diagOf(TABLE_EMPTY_CONTENT_CODE, '| a | b |\n| - | - |\n')).toHaveLength(1)
    expect(diagOf(TABLE_EMPTY_CONTENT_CODE, '| a | b |\n| - | - |\n| 1 | 2 |\n')).toHaveLength(0)
  })

  it('§20 FORMULA_EMPTY_CONTENT is a hint and never touches numbering', () => {
    const hits = diagOf(FORMULA_EMPTY_CONTENT_CODE, '$$\n$$\n')
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('info')
    // §11 — the object-scoped chip is KEPT (the registry is the authority).
    expect(shouldRenderReasonChip({ code: FORMULA_EMPTY_CONTENT_CODE })).toBe(true)
    expect(diagOf(FORMULA_EMPTY_CONTENT_CODE, '$$\nx\n$$\n')).toHaveLength(0)
  })

  it('BLOCKQUOTE_EMPTY only for an empty quote', () => {
    expect(diagOf(BLOCKQUOTE_EMPTY_CODE, '>\n')).toHaveLength(1)
    expect(diagOf(BLOCKQUOTE_EMPTY_CODE, '> 有内容\n')).toHaveLength(0)
  })
})

// ── §9/§10/§11 — metadata authority ───────────────────────────────────────

describe('VNext §9/§10/§11 — the ONE rule metadata authority', () => {
  const VNEXT_CODES = [
    DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE, SECTION_EMPTY_CODE, SECTION_ONLY_SUBHEADINGS_CODE,
    HEADING_MANUAL_NUMBER_PREFIX_CODE, FIGURE_MANUAL_NUMBER_PREFIX_CODE,
    TABLE_BLOCK_STRUCTURE_INVALID_CODE, FORMULA_BLOCK_STRUCTURE_INVALID_CODE,
    CODE_EMPTY_BLOCK_CODE, TABLE_EMPTY_CONTENT_CODE, FORMULA_EMPTY_CONTENT_CODE, BLOCKQUOTE_EMPTY_CODE,
  ]

  it('every VNext rule is registered with domain / area / scope / presentation', () => {
    for (const code of VNEXT_CODES) {
      const meta = getRuleMeta(code)
      expect(meta, code).not.toBeNull()
      expect(meta!.domain, code).toBe('document')
      expect(DOCUMENT_DIAGNOSTIC_AREAS, code).toContain(meta!.area)
      expect(meta!.scope, code).toBeTruthy()
      expect(typeof meta!.presentation.reasonChip, code).toBe('boolean')
      expect(meta!.presentation.activeVisual, code).toBe(true)
    }
  })

  it('every registered document rule carries the full metadata (DOCUMENT_RULE_WITHOUT_*=0)', () => {
    for (const code of Object.keys(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY)) {
      const meta = DOCUMENT_DIAGNOSTIC_RULE_REGISTRY[code]
      expect(meta.domain, code).toBe('document')
      expect(meta.area, code).toBeTruthy()
      expect(meta.scope, code).toBeTruthy()
      expect(typeof meta.presentation.reasonChip, code).toBe('boolean')
      expect(typeof meta.presentation.passiveVisual, code).toBe('boolean')
      expect(typeof meta.presentation.activeVisual, code).toBe('boolean')
    }
  })

  it('§11 scope=document ⇒ reasonChip=false, scope=heading/object ⇒ chip kept', () => {
    expect(resolveRuleScope(DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE)).toBe('document')
    expect(resolveRuleReasonChip(DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE)).toBe(false)
    expect(resolveRuleScope(SECTION_EMPTY_CODE)).toBe('heading')
    expect(resolveRuleReasonChip(SECTION_EMPTY_CODE)).toBe(true)
    expect(resolveRuleScope(CODE_EMPTY_BLOCK_CODE)).toBe('object')
    expect(resolveRuleReasonChip(CODE_EMPTY_BLOCK_CODE)).toBe(true)
  })

  it('§11 the chip policy consults the registry — never a per-code special case', () => {
    // No metadata at all: the registry scope decides.
    expect(shouldRenderReasonChip({ code: DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE })).toBe(false)
    expect(shouldRenderReasonChip({ code: SECTION_EMPTY_CODE })).toBe(true)
    expect(shouldRenderReasonChip({ code: CODE_EMPTY_BLOCK_CODE })).toBe(true)
  })

  it('§47 severity is decoupled from scope / area', () => {
    expect(resolveDocumentDiagnosticSeverity(TABLE_BLOCK_STRUCTURE_INVALID_CODE, true)).toBe('error')
    expect(resolveDocumentDiagnosticSeverity(TABLE_BLOCK_STRUCTURE_INVALID_CODE, false)).toBe('error')
    expect(resolveDocumentDiagnosticSeverity(SECTION_EMPTY_CODE, true)).toBe('info')
    expect(resolveDocumentDiagnosticSeverity(HEADING_MANUAL_NUMBER_PREFIX_CODE, true)).toBe('warning')
  })
})
