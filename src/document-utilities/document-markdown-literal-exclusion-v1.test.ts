// @vitest-environment jsdom
/**
 * V1 — Markdown Literal Exclusion targeted suite.
 *
 * THE DEFECT: the resource scanner regex-scanned the WHOLE markdown, so
 * `` `![](a.png)` ``, a fenced example block and indented code were admitted as
 * real Figure / Link / Resource candidates — producing "图片块格式不规范"
 * (FIGURE_BLOCK_STRUCTURE_INVALID) for plain description text.
 *
 * Covered here:
 *   LITERAL-RANGE-*    the literal/code source ranges (§4/§7/§9/§22)
 *   LITERAL-OVERLAP-*  the overlap semantics (§12)
 *   LITERAL-SCANNER-*  scanner exclusion + real tokens still admitted (§14/§20/§31)
 *   LITERAL-DIAGNOSTIC-* diagnostics / structure / resource convergence (§15-§19)
 *   LITERAL-GATE-*     the hard gates (§28/§34/§40)
 *   LITERAL-FIXTURE-*  the runtime fixture + the alt-binding regression (§29/§30)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  FIGURE_LITERAL_EXCLUSION_V1_GATE_KEYS,
  computeLiteralExclusionFacts,
  computeMarkdownLiteralRanges,
  createFigureLiteralExclusionV1Counters,
  evaluateFigureLiteralExclusionV1Gates,
  evaluateLiteralExclusionAgainstDiagnostics,
  formatFigureLiteralExclusionV1GateReport,
  isSourceRangeLiteral,
  literalKindAt,
} from './document-markdown-literal-exclusion-v1'
import {
  parseImageSourceOccurrences,
  parseLocalLinkTargets,
  scanAdmittedReferenceCounts,
  scanAdmittedReferenceSpans,
} from './document-resource-scanner'
import { computeDocumentDiagnostics, buildFigureSourceOccurrences } from './document-diagnostics'
import type { DocumentDiagnosticsInput, DiagnosticLinkFact } from './document-diagnostics'
import { analyzeFigureStandaloneSourceBlocks } from './document-standalone-object-block-invariant-v515'

// ── §4/§7/§9/§22 — the literal range authority ─────────────────────────────

describe('LITERAL-RANGE — literal/code source ranges', () => {
  it('a single-backtick inline code span is literal', () => {
    const md = '`![](a.png)`'
    const ranges = computeMarkdownLiteralRanges(md)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].kind).toBe('inline-code')
    expect(ranges[0].start).toBe(0)
    expect(ranges[0].end).toBe(md.length)
  })

  it('a double-backtick span closes only on an equal-length run (§22)', () => {
    const md = '``![](a.png)``'
    const ranges = computeMarkdownLiteralRanges(md)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].kind).toBe('inline-code')
    expect(ranges[0].end).toBe(md.length)

    // `x``y` — the single run closes on the NEXT single run, not the double one.
    const mixed = '`x``y`'
    const mixedRanges = computeMarkdownLiteralRanges(mixed)
    expect(mixedRanges).toHaveLength(1)
    expect(mixedRanges[0].end).toBe(mixed.length)
  })

  it('an unmatched backtick run is literal TEXT, not a code span', () => {
    const md = 'a `b ![](c.png)'
    expect(computeMarkdownLiteralRanges(md)).toEqual([])
  })

  it('text around an inline code span stays outside the literal range', () => {
    const md = 'before `![](a.png)` after'
    const ranges = computeMarkdownLiteralRanges(md)
    expect(ranges).toHaveLength(1)
    expect(literalKindAt(ranges, 0)).toBeNull()
    expect(literalKindAt(ranges, md.indexOf('`'))).toBe('inline-code')
    expect(literalKindAt(ranges, md.length - 1)).toBeNull()
  })

  it('a fenced block is literal as a whole, including its fences (§7)', () => {
    const md = '```md\n![](a.png)\n[text](https://example.com)\n```\n'
    const ranges = computeMarkdownLiteralRanges(md)
    const fenced = ranges.filter(r => r.kind === 'fenced-code')
    expect(fenced).toHaveLength(1)
    expect(fenced[0].start).toBe(0)
    expect(fenced[0].end).toBe(md.indexOf('\n```\n') + 5)
  })

  it('a tilde fence and an unclosed fence both become literal ranges', () => {
    const tilde = '~~~\n![](a.png)\n~~~\n'
    expect(computeMarkdownLiteralRanges(tilde).filter(r => r.kind === 'fenced-code')).toHaveLength(1)
    const unclosed = '```\n![](a.png)\n'
    const ranges = computeMarkdownLiteralRanges(unclosed)
    expect(ranges.filter(r => r.kind === 'fenced-code')).toHaveLength(1)
    expect(ranges[0].end).toBe(unclosed.length)
  })

  it('indented code after a blank line is literal; a list continuation is NOT (§9)', () => {
    const indented = 'text\n\n    ![](a.png)\n'
    const ranges = computeMarkdownLiteralRanges(indented)
    expect(ranges.filter(r => r.kind === 'indented-code')).toHaveLength(1)

    const listContinuation = '- item\n    continued text ![](a.png)\n'
    expect(computeMarkdownLiteralRanges(listContinuation).filter(r => r.kind === 'indented-code')).toHaveLength(0)
  })

  it('inline code inside a fence is never double-counted', () => {
    const md = '```\n`![](a.png)`\n```\n'
    const ranges = computeMarkdownLiteralRanges(md)
    expect(ranges.filter(r => r.kind === 'inline-code')).toHaveLength(0)
    expect(ranges.filter(r => r.kind === 'fenced-code')).toHaveLength(1)
  })
})

// ── §12 — the overlap semantics ────────────────────────────────────────────

describe('LITERAL-OVERLAP — the exclusion is an OVERLAP test', () => {
  const ranges = computeMarkdownLiteralRanges('aa `code` bb')
  const start = 3
  const end = 9 // `code` including backticks

  it('a fully-inside candidate is excluded', () => {
    expect(isSourceRangeLiteral(ranges, start + 1, end - 1)).toBe(true)
  })
  it('a candidate crossing the LEFT boundary is excluded', () => {
    expect(isSourceRangeLiteral(ranges, start - 2, start + 2)).toBe(true)
  })
  it('a candidate crossing the RIGHT boundary is excluded', () => {
    expect(isSourceRangeLiteral(ranges, end - 2, end + 2)).toBe(true)
  })
  it('a candidate CONTAINING the literal is excluded', () => {
    expect(isSourceRangeLiteral(ranges, 0, 20)).toBe(true)
  })
  it('a candidate that merely TOUCHES the boundary is NOT excluded', () => {
    expect(isSourceRangeLiteral(ranges, 0, start)).toBe(false)
    expect(isSourceRangeLiteral(ranges, end, 20)).toBe(false)
  })
})

// ── §14/§20/§31 — the scanner exclusion ───────────────────────────────────

describe('LITERAL-SCANNER — the scanner excludes literal tokens, keeps real ones', () => {
  it('an inline-code image token is never an image occurrence', () => {
    expect(parseImageSourceOccurrences('`![](a.png)`')).toHaveLength(0)
    expect(parseImageSourceOccurrences('before `![](a.png)` after')).toHaveLength(0)
    expect(parseImageSourceOccurrences('`![](a.png)` `![](b.png)`')).toHaveLength(0)
    expect(parseImageSourceOccurrences('``![](a.png)``')).toHaveLength(0)
  })

  it('a fenced / indented image token is never an image occurrence', () => {
    expect(parseImageSourceOccurrences('```md\n![](a.png)\n```\n')).toHaveLength(0)
    expect(parseImageSourceOccurrences('text\n\n    ![](a.png)\n')).toHaveLength(0)
  })

  it('an inline-code link token is never a local reference', () => {
    expect(parseLocalLinkTargets('`[example](./a.md)`')).toHaveLength(0)
    expect(parseLocalLinkTargets('```\n[x](./a.md)\n```\n')).toHaveLength(0)
  })

  it('a real image next to a literal image is still admitted (§22/§23)', () => {
    const md = '`![](a.png)` ![](real.png)'
    const occ = parseImageSourceOccurrences(md)
    expect(occ).toHaveLength(1)
    expect(occ[0].rawDestination).toBe('real.png')

    const facts = computeLiteralExclusionFacts(md)
    expect(facts.rawImageSyntaxMatchCount).toBe(2)
    expect(facts.excludedImageCandidateCount).toBe(1)
    expect(facts.admittedImageCandidateCount).toBe(1)
    expect(facts.excludedImageByInlineCodeCount).toBe(1)
  })

  it('the scanner counts agree with the literal facts (§31)', () => {
    const md = '示例：`![](fake.png)`\n\n![real](assets/real.png)\n'
    const facts = computeLiteralExclusionFacts(md)
    const admitted = scanAdmittedReferenceCounts(md)
    expect(admitted.imageCount).toBe(facts.admittedImageCandidateCount)
    expect(admitted.imageCount).toBe(1)
    expect(facts.excludedImageCandidateCount).toBe(1)
  })

  it('the exclusion uses the FULL token range: adjacency is not an overlap (§12)', () => {
    const md = '![](a.png)`x`'
    const ranges = computeMarkdownLiteralRanges(md)
    const literalStart = md.indexOf('`')
    expect(literalStart).toBe(10)
    // the whole token [0,10) ends EXACTLY at the literal start → not excluded
    expect(isSourceRangeLiteral(ranges, 0, 10)).toBe(false)
    // any range that reaches INTO the literal is excluded
    expect(isSourceRangeLiteral(ranges, 9, literalStart + 1)).toBe(true)
  })
})

// ── §15-§19 — diagnostics / structure / resource convergence ──────────────

function linkFacts(markdown: string, missing: (t: string) => boolean): DiagnosticLinkFact[] {
  const out: DiagnosticLinkFact[] = []
  const raw = parseLocalLinkTargets(markdown)
  for (let i = 0; i < raw.length; i++) {
    const o = typeof raw[i] === 'string' ? { target: raw[i] as string } : raw[i] as Exclude<typeof raw[number], string>
    if (!missing(o.target)) continue
    out.push({
      target: o.target, element: null, index: out.length,
      resourceKind: o.resourceKind, semanticDestination: o.target,
      sourceStart: o.sourceStart, sourceEnd: o.sourceEnd,
      startLine: o.startLine, endLine: o.endLine, startColumn: o.startColumn, endColumn: o.endColumn,
      rawText: o.rawText, destinationStart: o.destinationStart, destinationEnd: o.destinationEnd,
      rawToken: o.rawToken, altText: o.altText, resourceClass: o.resourceClass,
      targetIdentity: `local:${o.target}`,
    })
  }
  return out
}

function inputOf(markdown: string, missing: (t: string) => boolean = () => true): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:literal',
    markdown,
    strictMode: false,
    vaultRoot: 'D:/vault',
    headings: [], figures: [],
    figureSourceOccurrences: buildFigureSourceOccurrences({
      scanned: parseImageSourceOccurrences(markdown),
      documentKey: 'doc:literal',
      resolveCanonicalDestination: d => d,
      isLocalFileMissing: missing,
    }),
    tables: [], codes: [], formulas: [],
    links: linkFacts(markdown, missing),
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
  }
}

function codesOf(markdown: string, missing?: (t: string) => boolean): string[] {
  return computeDocumentDiagnostics(inputOf(markdown, missing)).diagnostics.map(d => d.code)
}

describe('LITERAL-DIAGNOSTIC — literal syntax produces no business diagnostic', () => {
  it('`![](a.png)` → 0 figure / resource diagnostics', () => {
    const codes = codesOf('`![](a.png)`')
    expect(codes.filter(c => c.startsWith('FIGURE_'))).toEqual([])
    expect(codes).not.toContain('LINK_LOCAL_TARGET_MISSING')
  })

  it('`![](missing.png)` never yields FIGURE_LOCAL_IMAGE_MISSING (§15)', () => {
    const codes = codesOf('`![](missing.png)`')
    expect(codes).not.toContain('FIGURE_LOCAL_IMAGE_MISSING')
    expect(codes).not.toContain('FIGURE_MISSING_NAME')
  })

  it('before `![](a.png)` after is a plain paragraph (§5/§17)', () => {
    const codes = codesOf('before `![](a.png)` after')
    expect(codes).not.toContain('FIGURE_BLOCK_STRUCTURE_INVALID')
    expect(codes.filter(c => c.startsWith('FIGURE_'))).toEqual([])
  })

  it('multiple inline-code images never trigger IMAGE_MULTIPLE_IN_BLOCK (§6)', () => {
    const codes = codesOf('`![](a.png)` `![](b.png)`')
    expect(codes).not.toContain('FIGURE_BLOCK_STRUCTURE_INVALID')
  })

  it('fenced code syntax is fully excluded (§7)', () => {
    const md = '```md\n![](a.png)\n![alt](b.png)\n[text](https://example.com)\n```\n'
    const codes = codesOf(md)
    expect(codes.filter(c => c.startsWith('FIGURE_'))).toEqual([])
    expect(codes).not.toContain('LINK_LOCAL_TARGET_MISSING')
  })

  it('literal + real figure: only the REAL image is admitted (§23)', () => {
    const md = '示例：`![](fake.png)`\n\n![real](assets/real.png)\n'
    const codes = codesOf(md)
    // the real image is missing on disk (default missing policy) — exactly ONE warning
    expect(codes.filter(c => c === 'FIGURE_LOCAL_IMAGE_MISSING')).toHaveLength(1)
    expect(codes.filter(c => c === 'FIGURE_BLOCK_STRUCTURE_INVALID')).toEqual([])
  })

  it('same-paragraph literal fake + real figure: only the REAL image counts (§24)', () => {
    const md = 'before `![](fake.png)` ![real](assets/real.png)\n'
    const out = computeDocumentDiagnostics(inputOf(md, () => false))
    const structure = out.diagnostics.filter(d => d.code === 'FIGURE_BLOCK_STRUCTURE_INVALID')
    expect(structure).toHaveLength(1)
    expect(String(structure[0].metadata?.rawObjectCount)).toBe('1')
    expect(String(structure[0].metadata?.violationKinds)).toBe('MIXED_WITH_TEXT')
  })

  it('the alt-binding description sentence produces no structure error (§30)', () => {
    const md = '本文验证：Markdown 图片 `![alt](path)` 中的 alt 是图片图名的 canonical source of truth。\n'
    const codes = codesOf(md)
    expect(codes).not.toContain('FIGURE_BLOCK_STRUCTURE_INVALID')
    expect(codes.filter(c => c.startsWith('FIGURE_'))).toEqual([])
  })
})

describe('LITERAL-STRUCTURE — the invariant receives a clean candidate set', () => {
  it('a literal-only paragraph yields ZERO figure blocks', () => {
    const md = 'before `![](a.png)` after\n'
    const blocks = analyzeFigureStandaloneSourceBlocks({
      source: md,
      occurrences: parseImageSourceOccurrences(md).map(o => ({ tokenStart: o.tokenStart, tokenEnd: o.tokenEnd })),
    })
    expect(blocks).toEqual([])
  })

  it('literal fake + real image yields ONE block owning EXACTLY ONE object', () => {
    const md = 'before `![](fake.png)` ![real](assets/real.png)\n'
    const blocks = analyzeFigureStandaloneSourceBlocks({
      source: md,
      occurrences: parseImageSourceOccurrences(md).map(o => ({ tokenStart: o.tokenStart, tokenEnd: o.tokenEnd })),
    })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].imageOccurrenceCount).toBe(1)
    expect(blocks[0].result.decision).toBe('INVALID_MIXED_WITH_TEXT')
  })
})

// ── §28/§34/§40 — the hard gates ──────────────────────────────────────────

describe('LITERAL-GATE — the literal exclusion hard gates', () => {
  it('the gate set covers every required counter and all-zero PASSes', () => {
    expect(FIGURE_LITERAL_EXCLUSION_V1_GATE_KEYS.length).toBeGreaterThanOrEqual(24)
    const counters = createFigureLiteralExclusionV1Counters()
    expect(formatFigureLiteralExclusionV1GateReport(counters)).toHaveLength(FIGURE_LITERAL_EXCLUSION_V1_GATE_KEYS.length)
    expect(evaluateFigureLiteralExclusionV1Gates(counters).decision).toBe('PASS')
    counters.codeLiteralFigureStructureInvalid = 1
    expect(evaluateFigureLiteralExclusionV1Gates(counters).decision).toBe('FAIL')
  })

  it('a literal-derived diagnostic is measured as a REAL false positive', () => {
    // the ORIGINAL polluted behaviour, reproduced by hand: a structure diagnostic
    // whose block contains ONLY literal text.
    const md = 'before `![](a.png)` after\n'
    const fake = {
      id: 'fake-structure',
      documentKey: 'doc:literal',
      severity: 'error' as const,
      category: 'figure' as const,
      code: 'FIGURE_BLOCK_STRUCTURE_INVALID',
      message: 'x',
      location: { kind: 'source-block' as const, objectKind: 'figure' as const, sourceBlockIdentity: 'src-block:0', sourceBlockOrdinal: 0, sourceStart: 0, sourceEnd: md.length - 1, startLine: 0, endLine: 0, sourceRevision: null, locatorStrategy: 'OWNING_BLOCK' as const },
    }
    const evaluated = evaluateLiteralExclusionAgainstDiagnostics({ markdown: md, diagnostics: [fake] })
    expect(evaluated.counters.codeLiteralFigureStructureInvalid).toBe(1)
    expect(evaluated.literalFalsePositiveDiagnosticIds).toEqual(['fake-structure'])
  })

  it('a LEGITIMATE mixed block owning a real image is never a false positive', () => {
    const md = 'before `![](fake.png)` ![real](assets/real.png)\n'
    const out = computeDocumentDiagnostics(inputOf(md, () => false))
    const structure = out.diagnostics.filter(d => d.code === 'FIGURE_BLOCK_STRUCTURE_INVALID')
    expect(structure).toHaveLength(1)
    const admitted = scanAdmittedReferenceCounts(md)
    const evaluated = evaluateLiteralExclusionAgainstDiagnostics({
      markdown: md,
      diagnostics: out.diagnostics,
      admittedImageCount: admitted.imageCount,
      admittedLinkCount: admitted.linkCount,
      admittedSpans: scanAdmittedReferenceSpans(md),
    })
    expect(evaluated.literalFalsePositiveDiagnosticIds).toEqual([])
    expect(evaluateFigureLiteralExclusionV1Gates(evaluated.counters).decision).toBe('PASS')
  })
})

// ── §29/§30 — the runtime fixture + the alt-binding regression ────────────

describe('LITERAL-FIXTURE — the runtime fixture and the alt-binding regression', () => {
  const literalFixture = readFileSync(
    resolve(process.cwd(), 'test/vault/runtime/smoke/Figure-Literal-Exclusion-Test.md'),
    'utf8',
  )
  const altFixture = readFileSync(
    resolve(process.cwd(), 'test/vault/fixtures/figure/figure-alt-binding-fixture.md'),
    'utf8',
  )

  it('the literal fixture excludes every inline / fenced / indented example', () => {
    const facts = computeLiteralExclusionFacts(literalFixture)
    expect(facts.inlineCodeRangeCount).toBeGreaterThanOrEqual(8)
    expect(facts.fencedCodeRangeCount).toBeGreaterThanOrEqual(1)
    expect(facts.indentedCodeRangeCount).toBeGreaterThanOrEqual(1)
    expect(facts.rawImageSyntaxMatchCount).toBeGreaterThanOrEqual(14)
    expect(facts.admittedImageCandidateCount).toBe(2) // Case F + Case G real images
    expect(facts.excludedImageCandidateCount).toBe(facts.rawImageSyntaxMatchCount - 2)
    expect(facts.excludedImageByInlineCodeCount).toBeGreaterThanOrEqual(8)
    expect(facts.excludedImageByFenceCount).toBeGreaterThanOrEqual(2)
    expect(facts.excludedImageByIndentedCodeCount).toBeGreaterThanOrEqual(1)
    expect(facts.admittedLinkCandidateCount).toBe(0)
    expect(facts.excludedLinkCandidateCount).toBeGreaterThanOrEqual(3)
  })

  it('the literal fixture produces no literal-derived diagnostic', () => {
    const out = computeDocumentDiagnostics(inputOf(literalFixture, () => false))
    const admitted = scanAdmittedReferenceCounts(literalFixture)
    const evaluated = evaluateLiteralExclusionAgainstDiagnostics({
      markdown: literalFixture,
      diagnostics: out.diagnostics,
      admittedImageCount: admitted.imageCount,
      admittedLinkCount: admitted.linkCount,
      admittedSpans: scanAdmittedReferenceSpans(literalFixture),
    })
    expect(evaluated.literalFalsePositiveDiagnosticIds).toEqual([])
    expect(evaluateFigureLiteralExclusionV1Gates(evaluated.counters).decision).toBe('PASS')
    // the ONLY figure diagnostic is the legitimate Case G mixed block
    expect(out.diagnostics.filter(d => d.code === 'FIGURE_BLOCK_STRUCTURE_INVALID')).toHaveLength(1)
    expect(out.diagnostics.filter(d => d.code === 'FIGURE_MISSING_NAME')).toHaveLength(0)
    expect(out.diagnostics.filter(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING')).toHaveLength(0)
  })

  it('§30 — the alt-binding description `![alt](path)` is excluded and yields no structure error', () => {
    const line = altFixture.split('\n')[2]
    expect(line).toContain('`![alt](path)`')
    const ranges = computeMarkdownLiteralRanges(altFixture)
    const tokenStart = altFixture.indexOf('![alt](path)')
    expect(tokenStart).toBeGreaterThan(-1)
    expect(isSourceRangeLiteral(ranges, tokenStart, tokenStart + '![alt](path)'.length)).toBe(true)

    const out = computeDocumentDiagnostics(inputOf(altFixture, () => false))
    const firstLineStructure = out.diagnostics.filter(d =>
      d.code === 'FIGURE_BLOCK_STRUCTURE_INVALID'
      && (d.location as { startLine?: number } | undefined)?.startLine === 2)
    expect(firstLineStructure).toEqual([])

    const facts = computeLiteralExclusionFacts(altFixture)
    expect(facts.excludedImageByInlineCodeCount).toBeGreaterThanOrEqual(1)
  })

  it('§30/§31 — the real figures of the alt-binding fixture are still admitted', () => {
    const occ = parseImageSourceOccurrences(altFixture)
    // 空 alt / 中文 alt / 空格路径 / percent-encoded / dup ×2 / HTTP = 7 real images
    expect(occ).toHaveLength(7)
    expect(occ.map(o => o.rawDestination)).toContain('a.png')
    expect(occ.map(o => o.rawDestination)).toContain('b.png')
    const facts = computeLiteralExclusionFacts(altFixture)
    expect(facts.admittedImageCandidateCount).toBe(7)
    // 7 real + the `![alt](path)` inline-code example
    expect(facts.rawImageSyntaxMatchCount).toBe(8)
    expect(facts.excludedImageByInlineCodeCount).toBe(1)
    const admitted = scanAdmittedReferenceCounts(altFixture)
    expect(admitted.imageCount).toBe(facts.admittedImageCandidateCount)
  })
})
