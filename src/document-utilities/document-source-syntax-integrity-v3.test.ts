// @vitest-environment jsdom
/**
 * TRAE V3 — Source Syntax / Footnote / Reference-style Link / Front Matter /
 * Table Header / Empty Link integrity tests.
 *
 * Covers spec §19–§24 targeted cases + the §14 parse/build-once hard gates.
 * The three shared authorities are exercised directly AND through the producer.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeDocumentDiagnostics,
  CODE_FENCE_UNCLOSED_CODE,
  FORMULA_BLOCK_UNCLOSED_CODE,
  FOOTNOTE_REFERENCE_TARGET_MISSING_CODE,
  FOOTNOTE_DEFINITION_DUPLICATE_CODE,
  FOOTNOTE_DEFINITION_UNUSED_CODE,
  FOOTNOTE_DEFINITION_EMPTY_CODE,
  LINK_REFERENCE_DEFINITION_MISSING_CODE,
  LINK_REFERENCE_DEFINITION_DUPLICATE_CODE,
  FRONTMATTER_UNCLOSED_CODE,
  TABLE_HEADER_EMPTY_CODE,
  TABLE_HEADER_DUPLICATE_CODE,
  LINK_TEXT_EMPTY_CODE,
  LINK_TARGET_EMPTY_CODE,
  SOURCE_INTEGRITY_DIAGNOSTIC_CODES,
} from './document-diagnostics'
import type { DocumentDiagnosticsInput, DocumentDiagnosticsComputed } from './document-diagnostics'
import {
  getDocumentSourceSyntaxSnapshot,
  getDocumentSourceSyntaxParseCount,
  resetDocumentSourceSyntaxAuthority,
  parseDocumentSourceTables,
  normalizeHeaderSemanticText,
} from './document-source-syntax-authority'
import {
  getDocumentDefinitionReferenceIndex,
  getDocumentDefinitionReferenceIndexBuildCount,
  resetDocumentDefinitionReferenceIndex,
  normalizeDefinitionLabel,
} from './document-definition-reference-index'
import {
  getDocumentInlineLinkAuthority,
  getDocumentInlineLinkParseCount,
  resetDocumentInlineLinkAuthority,
} from './document-inline-link-authority'
import { DOCUMENT_DIAGNOSTIC_RULE_REGISTRY } from './document-diagnostic-location'

function input(partial: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:v3',
    markdown: '',
    strictMode: false,
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

function run(markdown: string, extra: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsComputed {
  return computeDocumentDiagnostics(input({ markdown, ...extra }))
}
const codes = (r: DocumentDiagnosticsComputed): string[] => r.diagnostics.map(d => d.code)
const first = (r: DocumentDiagnosticsComputed, code: string) => r.diagnostics.filter(d => d.code === code)

beforeEach(() => {
  resetDocumentSourceSyntaxAuthority()
  resetDocumentDefinitionReferenceIndex()
  resetDocumentInlineLinkAuthority()
})

// ── §19 Source Syntax ──────────────────────────────────────

describe('TRAE V3 §19 — Source Syntax', () => {
  it('S1 closed ``` → no CODE_FENCE_UNCLOSED', () => {
    const r = run('正文\n\n```js\nconst a = 1\n```\n')
    expect(codes(r)).not.toContain(CODE_FENCE_UNCLOSED_CODE)
  })

  it('S2 unclosed ``` → CODE_FENCE_UNCLOSED (error)', () => {
    const r = run('正文\n\n```js\nconst a = 1\n')
    const d = first(r, CODE_FENCE_UNCLOSED_CODE)
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('error')
  })

  it('S3 unclosed ~~~ → CODE_FENCE_UNCLOSED', () => {
    const r = run('正文\n\n~~~\ncode\n')
    expect(first(r, CODE_FENCE_UNCLOSED_CODE)).toHaveLength(1)
  })

  it('S4 closing fence shorter than opener → still unclosed', () => {
    const snapshot = getDocumentSourceSyntaxSnapshot('doc:short', '```\ncode\n``\n', 1)
    expect(snapshot.codeFences[0].closed).toBe(false)
    expect(snapshot.codeFences[0].fenceLength).toBe(3)
  })

  it('S5 fence-like text inside a fence → no nested false positive', () => {
    const snapshot = getDocumentSourceSyntaxSnapshot('doc:nested', '```\n~~~\n```\n', 1)
    expect(snapshot.codeFences).toHaveLength(1)
    expect(snapshot.codeFences[0].closed).toBe(true)
  })

  it('S6 closed $$ → no FORMULA_BLOCK_UNCLOSED', () => {
    const r = run('正文\n\n$$\nE=mc^2\n$$\n')
    expect(codes(r)).not.toContain(FORMULA_BLOCK_UNCLOSED_CODE)
  })

  it('S7 unclosed $$ → FORMULA_BLOCK_UNCLOSED', () => {
    const r = run('正文\n\n$$\nE=mc^2\n')
    const d = first(r, FORMULA_BLOCK_UNCLOSED_CODE)
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('error')
  })

  it('S8 $$ inside a code fence → no formula block (no false positive)', () => {
    const md = '正文\n\n```\n$$\n$$\n```\n'
    const snapshot = getDocumentSourceSyntaxSnapshot('doc:dollar-in-fence', md, 1)
    expect(snapshot.formulaBlocks).toHaveLength(0)
    const r = run(md, { documentKey: 'doc:dollar-in-fence' })
    expect(codes(r)).not.toContain(FORMULA_BLOCK_UNCLOSED_CODE)
  })

  it('S9 link / footnote / ref-link syntax inside an unclosed fence → no downstream diagnostics', () => {
    const md = '正文\n\n```\n[a]()\n[^x]\n[t][lbl]\n'
    const r = run(md, { documentKey: 'doc:s9' })
    expect(codes(r)).toContain(CODE_FENCE_UNCLOSED_CODE)
    expect(codes(r)).not.toContain(LINK_TARGET_EMPTY_CODE)
    expect(codes(r)).not.toContain(FOOTNOTE_REFERENCE_TARGET_MISSING_CODE)
    expect(codes(r)).not.toContain(LINK_REFERENCE_DEFINITION_MISSING_CODE)
  })
})

// ── §20 Footnote ───────────────────────────────────────────

describe('TRAE V3 §20 — Footnote Integrity', () => {
  it('F1 valid footnote → PASS', () => {
    const r = run('正文[^a]\n\n[^a]: 内容\n')
    expect(codes(r)).not.toContain(FOOTNOTE_REFERENCE_TARGET_MISSING_CODE)
    expect(codes(r)).not.toContain(FOOTNOTE_DEFINITION_UNUSED_CODE)
  })

  it('F2 missing target → Warning', () => {
    const r = run('正文[^abc]\n')
    const d = first(r, FOOTNOTE_REFERENCE_TARGET_MISSING_CODE)
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warning')
  })

  it('F3 same missing label ×3 → 1 diagnostic / 3 targets', () => {
    const r = run('A[^x] B[^x] C[^x]\n')
    const d = first(r, FOOTNOTE_REFERENCE_TARGET_MISSING_CODE)
    expect(d).toHaveLength(1)
    expect(d[0].location?.kind).toBe('target-group')
    if (d[0].location?.kind === 'target-group') expect(d[0].location.targets).toHaveLength(3)
  })

  it('F4 duplicate definitions → 1 Error', () => {
    const r = run('正文[^1]\n\n[^1]: A\n[^1]: B\n')
    const d = first(r, FOOTNOTE_DEFINITION_DUPLICATE_CODE)
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('error')
  })

  it('F5 duplicate + reference → no MISSING', () => {
    const r = run('正文[^1]\n\n[^1]: A\n[^1]: B\n')
    expect(first(r, FOOTNOTE_REFERENCE_TARGET_MISSING_CODE)).toHaveLength(0)
  })

  it('F6 unused definition → Hint', () => {
    const r = run('正文\n\n[^a]: 内容\n')
    const d = first(r, FOOTNOTE_DEFINITION_UNUSED_CODE)
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('info')
  })

  it('F7 empty definition → Hint', () => {
    const r = run('正文\n\n[^abc]:\n')
    expect(first(r, FOOTNOTE_DEFINITION_EMPTY_CODE)).toHaveLength(1)
  })

  it('F8 continuation-line content → NOT empty', () => {
    const r = run('正文[^abc]\n\n[^abc]:\n    第二行实际有内容\n')
    expect(first(r, FOOTNOTE_DEFINITION_EMPTY_CODE)).toHaveLength(0)
  })

  it('F9 add definition → missing disappears', () => {
    const before = run('正文[^abc]\n')
    expect(first(before, FOOTNOTE_REFERENCE_TARGET_MISSING_CODE)).toHaveLength(1)
    const after = run('正文[^abc]\n\n[^abc]: 内容\n')
    expect(first(after, FOOTNOTE_REFERENCE_TARGET_MISSING_CODE)).toHaveLength(0)
  })

  it('F10 delete reference → unused appears', () => {
    const linked = run('正文[^abc]\n\n[^abc]: 内容\n')
    expect(first(linked, FOOTNOTE_DEFINITION_UNUSED_CODE)).toHaveLength(0)
    const orphaned = run('正文\n\n[^abc]: 内容\n')
    expect(first(orphaned, FOOTNOTE_DEFINITION_UNUSED_CODE)).toHaveLength(1)
  })
})

// ── §21 Reference-style Link ───────────────────────────────

describe('TRAE V3 §21 — Reference-style Link Integrity', () => {
  it('R1 valid reference link → PASS', () => {
    const r = run('见 [OpenAI][oa]\n\n[oa]: https://example.com\n')
    expect(codes(r)).not.toContain(LINK_REFERENCE_DEFINITION_MISSING_CODE)
  })

  it('R2 missing definition → Warning', () => {
    const r = run('见 [OpenAI][oa]\n')
    const d = first(r, LINK_REFERENCE_DEFINITION_MISSING_CODE)
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warning')
  })

  it('R3 same missing id ×3 → 1 diagnostic / 3 targets', () => {
    const r = run('A [x][oa] B [y][oa] C [z][oa]\n')
    const d = first(r, LINK_REFERENCE_DEFINITION_MISSING_CODE)
    expect(d).toHaveLength(1)
    if (d[0].location?.kind === 'target-group') expect(d[0].location.targets).toHaveLength(3)
  })

  it('R4 duplicate definition → Warning, 1 diagnostic', () => {
    const r = run('[oa]: https://a.example\n[oa]: https://b.example\n')
    const d = first(r, LINK_REFERENCE_DEFINITION_DUPLICATE_CODE)
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warning')
  })

  it('R5 definition syntax inside a code fence → ignored', () => {
    const r = run('```\n[oa]: https://a.example\n[oa]: https://b.example\n```\n')
    expect(first(r, LINK_REFERENCE_DEFINITION_DUPLICATE_CODE)).toHaveLength(0)
  })

  it('R6 footnote definition is not treated as a link definition', () => {
    const index = getDocumentDefinitionReferenceIndex(
      'doc:r6', '[^a]: 脚注内容\n', 1, getDocumentSourceSyntaxSnapshot('doc:r6', '[^a]: 脚注内容\n', 1),
    )
    expect(index.linkDefinitions).toHaveLength(0)
    expect(index.footnoteDefinitions).toHaveLength(1)
    expect(normalizeDefinitionLabel('  OA ')).toBe('oa')
  })

  it('R7 array-style subscripting is not a reference link', () => {
    const r = run('取值 array[i][j] 即可。\n')
    expect(first(r, LINK_REFERENCE_DEFINITION_MISSING_CODE)).toHaveLength(0)
  })
})

// ── §22 Front Matter ───────────────────────────────────────

describe('TRAE V3 §22 — Front Matter Integrity', () => {
  it('FM1 valid closed front matter → PASS', () => {
    const r = run('---\ntitle: A\n---\n正文\n')
    expect(codes(r)).not.toContain(FRONTMATTER_UNCLOSED_CODE)
  })

  it('FM2 unclosed → Error', () => {
    const r = run('---\ntitle: A\n正文\n')
    const d = first(r, FRONTMATTER_UNCLOSED_CODE)
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('error')
  })

  it('FM3 unclosed suppresses malformed → only UNCLOSED, never MALFORMED', () => {
    const r = run('---\ntitle: : :\n正文\n')
    expect(first(r, FRONTMATTER_UNCLOSED_CODE)).toHaveLength(1)
    expect(codes(r)).not.toContain('FRONTMATTER_MALFORMED')
  })

  it('FM4 malformed is DEFERRED_BY_SPEC (no canonical YAML parser)', () => {
    const meta = DOCUMENT_DIAGNOSTIC_RULE_REGISTRY.FRONTMATTER_MALFORMED
    expect(meta.implementationStatus).toBe('DEFERRED_BY_SPEC')
    expect(meta.producerAuthority).toBe('NONE')
    // The producer NEVER fabricates it, even for closed-but-malformed front matter.
    const r = run('---\ntitle: : :\n---\n正文\n')
    expect(codes(r)).not.toContain('FRONTMATTER_MALFORMED')
  })

  it('FM5 --- in the document middle → not document-start front matter', () => {
    const snapshot = getDocumentSourceSyntaxSnapshot('doc:fm5', '正文\n\n---\n\n更多\n', 1)
    expect(snapshot.frontMatter).toBeNull()
    expect(codes(run('正文\n\n---\n\n更多\n'))).not.toContain(FRONTMATTER_UNCLOSED_CODE)
  })

  it('FM6 Markdown-like text in front matter → no downstream false positive', () => {
    const md = '---\ntitle: A\nempty: [](x)\ndollar: $$\n---\n正文\n'
    const r = run(md, { documentKey: 'doc:fm6' })
    expect(codes(r)).not.toContain(LINK_TEXT_EMPTY_CODE)
    expect(codes(r)).not.toContain(LINK_TARGET_EMPTY_CODE)
    expect(codes(r)).not.toContain(FORMULA_BLOCK_UNCLOSED_CODE)
  })
})

// ── §23 Table Header ───────────────────────────────────────

describe('TRAE V3 §23 — Table Header Integrity', () => {
  it('T1 unique headers → PASS', () => {
    const r = run('| 姓名 | 年龄 |\n|------|------|\n| A | 1 |\n')
    expect(codes(r)).not.toContain(TABLE_HEADER_EMPTY_CODE)
    expect(codes(r)).not.toContain(TABLE_HEADER_DUPLICATE_CODE)
  })

  it('T2 one empty header → Hint', () => {
    const r = run('|      | 数量 |\n|------|------|\n| A | 1 |\n')
    const d = first(r, TABLE_HEADER_EMPTY_CODE)
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('info')
  })

  it('T3 multiple empty headers → 1 diagnostic / N targets', () => {
    const r = run('|      |      | 数量 |\n|------|------|------|\n| A | B | 1 |\n')
    const d = first(r, TABLE_HEADER_EMPTY_CODE)
    expect(d).toHaveLength(1)
    if (d[0].location?.kind === 'target-group') expect(d[0].location.targets).toHaveLength(2)
  })

  it('T4 duplicate header → Warning', () => {
    const r = run('| 姓名 | 姓名 | 年龄 |\n|------|------|------|\n')
    const d = first(r, TABLE_HEADER_DUPLICATE_CODE)
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warning')
  })

  it('T5 3 same headers → 1 diagnostic / 3 targets', () => {
    const r = run('| 姓名 | 姓名 | 姓名 |\n|------|------|------|\n')
    const d = first(r, TABLE_HEADER_DUPLICATE_CODE)
    expect(d).toHaveLength(1)
    if (d[0].location?.kind === 'target-group') expect(d[0].location.targets).toHaveLength(3)
  })

  it('T6 two duplicate groups → 2 diagnostics', () => {
    const r = run('| 姓名 | 姓名 | 年龄 | 年龄 |\n|------|------|------|------|\n')
    expect(first(r, TABLE_HEADER_DUPLICATE_CODE)).toHaveLength(2)
  })

  it('T7 rename duplicate → warning disappears', () => {
    const before = run('| 姓名 | 姓名 | 年龄 |\n|------|------|------|\n')
    expect(first(before, TABLE_HEADER_DUPLICATE_CODE)).toHaveLength(1)
    const after = run('| 姓名 | 名称 | 年龄 |\n|------|------|------|\n')
    expect(first(after, TABLE_HEADER_DUPLICATE_CODE)).toHaveLength(0)
  })

  it('header semantic text ignores inline markdown formatting', () => {
    expect(normalizeHeaderSemanticText('**姓名**')).toBe('姓名')
    expect(normalizeHeaderSemanticText('`年龄`')).toBe('年龄')
  })

  it('table inside a code fence is not a source table', () => {
    const md = '```\n| a | b |\n|---|---|\n```\n'
    const snapshot = getDocumentSourceSyntaxSnapshot('doc:tbl-fence', md, 1)
    expect(parseDocumentSourceTables(md, snapshot)).toHaveLength(0)
  })
})

// ── §24 Inline Link ────────────────────────────────────────

describe('TRAE V3 §24 — Empty Inline Link Integrity', () => {
  it('L1 [text](target) → PASS', () => {
    const r = run('见 [站点](https://example.com)\n')
    expect(codes(r)).not.toContain(LINK_TEXT_EMPTY_CODE)
    expect(codes(r)).not.toContain(LINK_TARGET_EMPTY_CODE)
  })

  it('L2 [](target) → LINK_TEXT_EMPTY', () => {
    const r = run('见 [](https://example.com)\n')
    expect(first(r, LINK_TEXT_EMPTY_CODE)).toHaveLength(1)
  })

  it('L3 [text]() → LINK_TARGET_EMPTY (warning)', () => {
    const r = run('见 [链接]()\n')
    const d = first(r, LINK_TARGET_EMPTY_CODE)
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warning')
  })

  it('L4 ![](image.png) → NOT LINK_TEXT_EMPTY (images excluded)', () => {
    const r = run('![图片](image.png)\n')
    expect(first(r, LINK_TEXT_EMPTY_CODE)).toHaveLength(0)
  })

  it('L5 escaped / code-span syntax → no false positive', () => {
    const r = run('转义 `[x]()` 不应被识别为链接。\n', { documentKey: 'doc:l5' })
    expect(first(r, LINK_TARGET_EMPTY_CODE)).toHaveLength(0)
  })

  it('fenced code link syntax → no false positive', () => {
    const md = '正文\n\n```\n[链接]()\n```\n'
    const r = run(md, { documentKey: 'doc:l6' })
    expect(first(r, LINK_TARGET_EMPTY_CODE)).toHaveLength(0)
  })
})

// ── §14 parse / build-once ─────────────────────────────────

describe('TRAE V3 §14 — parse / build-once per source revision', () => {
  it('SourceSyntaxAuthority parses at most once per documentKey + sourceRevision', () => {
    const md = '# H1\n\n```\ncode\n```\n'
    expect(getDocumentSourceSyntaxParseCount()).toBe(0)
    const a = getDocumentSourceSyntaxSnapshot('doc:parse1', md, 7)
    const b = getDocumentSourceSyntaxSnapshot('doc:parse1', md, 7)
    expect(a).toBe(b)
    expect(getDocumentSourceSyntaxParseCount()).toBe(1)
  })

  it('DefinitionReferenceIndex builds at most once per documentKey + sourceRevision', () => {
    const md = '正文[^a]\n\n[^a]: x\n'
    const snapshot = getDocumentSourceSyntaxSnapshot('doc:parse2', md, 9)
    const a = getDocumentDefinitionReferenceIndex('doc:parse2', md, 9, snapshot)
    const b = getDocumentDefinitionReferenceIndex('doc:parse2', md, 9, snapshot)
    expect(a).toBe(b)
    expect(getDocumentDefinitionReferenceIndexBuildCount()).toBe(1)
  })

  it('InlineLinkAuthority parses at most once per documentKey + sourceRevision', () => {
    const md = '见 [a](b) 与 [c](d)\n'
    const snapshot = getDocumentSourceSyntaxSnapshot('doc:parse3', md, 3)
    const a = getDocumentInlineLinkAuthority('doc:parse3', md, 3, snapshot)
    const b = getDocumentInlineLinkAuthority('doc:parse3', md, 3, snapshot)
    expect(a).toBe(b)
    expect(getDocumentInlineLinkParseCount()).toBe(1)
  })

  it('the producer consumes each authority at most once for one document revision', () => {
    const md = '# 标题\n\n```\nunclosed\n'
    computeDocumentDiagnostics(input({ markdown: md, documentKey: 'doc:parse4', sourceRevision: 42 }))
    expect(getDocumentSourceSyntaxParseCount()).toBe(1)
    expect(getDocumentDefinitionReferenceIndexBuildCount()).toBe(1)
    expect(getDocumentInlineLinkParseCount()).toBe(1)
  })
})

// ── Registry wiring ────────────────────────────────────────

describe('TRAE V3 — registry wiring', () => {
  it('every new runtime code is registered and FRONTMATTER_MALFORMED is not produced', () => {
    for (const code of SOURCE_INTEGRITY_DIAGNOSTIC_CODES) {
      expect(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY[code], code).toBeTruthy()
    }
    expect(SOURCE_INTEGRITY_DIAGNOSTIC_CODES).not.toContain('FRONTMATTER_MALFORMED')
  })
})
