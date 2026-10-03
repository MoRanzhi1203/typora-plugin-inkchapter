/**
 * Internal Blank-Line Policy V1 — `EXCESSIVE_INTERNAL_BLANK_LINES`.
 *
 * Product semantics under test:
 *   0~2 consecutive INTERNAL blank lines → PASS
 *   3+  consecutive INTERNAL blank lines → Warning (never Error, never a Hint)
 *
 * The rule is SOURCE-only, ONE diagnostic per gap, strictly separated from the
 * EOF rules, and never fires for blank lines inside a fenced code block /
 * display formula / front matter / HTML block / leading run.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  EXCESSIVE_INTERNAL_BLANK_LINES_CODE,
  INTERNAL_BLANK_LINE_POLICY,
  analyzeInternalBlankLineGaps,
  collectDocumentBlockGaps,
  createInternalBlankLineV1Counters,
  evaluateInternalBlankLineV1Gates,
  formatInternalBlankLineV1GateReport,
  internalBlankGapIdentity,
  isExcessiveInternalBlankRun,
} from './document-diagnostic-internal-blank-lines-v1'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import { resolveDocumentDiagnosticSeverity } from './document-diagnostics'
import { getRuleMeta, resolveRuleReasonChip, resolveRuleScope } from './document-diagnostic-location'
import { classifyDocumentDiagnosticRuleFamily } from './document-diagnostic-empty-short-circuit-v512-r6'

function inputOf(markdown: string | null): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc', markdown, strictMode: true, vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
    h1Facts: null,
  }
}

const blanksOf = (markdown: string): number[] =>
  analyzeInternalBlankLineGaps(markdown).map(g => g.actualBlankLines)

const internalDiagnostics = (markdown: string) =>
  computeDocumentDiagnostics(inputOf(markdown)).diagnostics.filter(d => d.code === EXCESSIVE_INTERNAL_BLANK_LINES_CODE)

// ── §3 — the ONE threshold authority ───────────────────────────────────────

describe('Internal Blank-Line Policy V1 — threshold authority', () => {
  it('§3 — passMaxBlankLines=2 / warningThreshold=3 (adjacent by construction)', () => {
    expect(INTERNAL_BLANK_LINE_POLICY.passMaxBlankLines).toBe(2)
    expect(INTERNAL_BLANK_LINE_POLICY.warningThreshold).toBe(3)
    expect(INTERNAL_BLANK_LINE_POLICY.warningThreshold).toBe(INTERNAL_BLANK_LINE_POLICY.passMaxBlankLines + 1)
  })

  it('§32 — the threshold contract 0/1/2 → false, 3/4/5 → true', () => {
    expect([0, 1, 2, 3, 4, 5].map(n => isExcessiveInternalBlankRun(n)))
      .toEqual([false, false, false, true, true, true])
  })

  it('§2 — the rule severity is FIXED at warning in strict AND loose mode', () => {
    expect(resolveDocumentDiagnosticSeverity(EXCESSIVE_INTERNAL_BLANK_LINES_CODE, true)).toBe('warning')
    expect(resolveDocumentDiagnosticSeverity(EXCESSIVE_INTERNAL_BLANK_LINES_CODE, false)).toBe('warning')
  })

  it('§1/§24 — registry metadata: area=document-format, scope=block, reasonChip=false', () => {
    const meta = getRuleMeta(EXCESSIVE_INTERNAL_BLANK_LINES_CODE)
    expect(meta).not.toBeNull()
    expect(meta!.area).toBe('document-format')
    expect(meta!.scope).toBe('block')
    expect(meta!.presentation.reasonChip).toBe(false)
    expect(meta!.presentation.passiveVisual).toBe(false)
    expect(meta!.presentation.activeVisual).toBe(true)
    expect(meta!.locationStrategy).toBe('source-range')
    expect(resolveRuleReasonChip(EXCESSIVE_INTERNAL_BLANK_LINES_CODE)).toBe(false)
    expect(resolveRuleScope(EXCESSIVE_INTERNAL_BLANK_LINES_CODE)).toBe('block')
  })

  it('§10 — the rule is NOT classified as an EOF rule', () => {
    expect(classifyDocumentDiagnosticRuleFamily(EXCESSIVE_INTERNAL_BLANK_LINES_CODE)).not.toBe('eof')
  })

  it('§35 — every hard gate starts at 0 and the report carries all keys', () => {
    const counters = createInternalBlankLineV1Counters()
    const report = formatInternalBlankLineV1GateReport(counters)
    expect(report.every(line => line.endsWith('=0'))).toBe(true)
    expect(report.some(l => l.startsWith('EOF_BLANK_LINE_REPORTED_AS_INTERNAL_COUNT='))).toBe(true)
    expect(report.some(l => l.startsWith('CODE_FENCE_INTERNAL_BLANK_LINE_FALSE_POSITIVE_COUNT='))).toBe(true)
    expect(evaluateInternalBlankLineV1Gates(counters).decision).toBe('PASS')
    expect(evaluateInternalBlankLineV1Gates({ ...counters, eofBlankLineReportedAsInternal: 1 }).decision).toBe('FAIL')
  })
})

// ── §32/§8 — thresholds + block pairs ──────────────────────────────────────

describe('Internal Blank-Line Policy V1 — thresholds and block pairs', () => {
  const gap = (a: string, b: string, n: number): string => `${a}${'\n'.repeat(n)}${b}`

  it('§32 — 0/1/2 blank lines → no diagnostic; 3/4/5 → ONE warning', () => {
    expect(gap('段落 A\n', '段落 B\n', 0)).toBe('段落 A\n段落 B\n')
    expect(blanksOf(gap('段落 A\n', '段落 B\n', 0))).toEqual([])
    expect(blanksOf(gap('段落 A\n', '段落 B\n', 1))).toEqual([])
    expect(blanksOf(gap('段落 A\n', '段落 B\n', 2))).toEqual([])
    expect(blanksOf(gap('段落 A\n', '段落 B\n', 3))).toEqual([3])
    expect(blanksOf(gap('段落 A\n', '段落 B\n', 4))).toEqual([4])
    expect(blanksOf(gap('段落 A\n', '段落 B\n', 5))).toEqual([5])
  })

  it('§16 — heading → paragraph', () => {
    const gaps = analyzeInternalBlankLineGaps('# 标题\n\n\n\n正文。\n')
    expect(gaps).toHaveLength(1)
    expect([gaps[0].previousBlockKind, gaps[0].nextBlockKind]).toEqual(['heading', 'paragraph'])
    expect(gaps[0].actualBlankLines).toBe(3)
  })

  it('§17 — paragraph → heading', () => {
    const gaps = analyzeInternalBlankLineGaps('正文。\n\n\n\n## 下一节\n')
    expect(gaps).toHaveLength(1)
    expect([gaps[0].previousBlockKind, gaps[0].nextBlockKind]).toEqual(['paragraph', 'heading'])
  })

  it('§18 — heading → heading', () => {
    const gaps = analyzeInternalBlankLineGaps('## A\n\n\n\n## B\n')
    expect(gaps).toHaveLength(1)
    expect([gaps[0].previousBlockKind, gaps[0].nextBlockKind]).toEqual(['heading', 'heading'])
  })

  it('§8 — paragraph → paragraph', () => {
    const gaps = analyzeInternalBlankLineGaps('段落 A。\n\n\n\n段落 B。\n')
    expect(gaps).toHaveLength(1)
    expect([gaps[0].previousBlockKind, gaps[0].nextBlockKind]).toEqual(['paragraph', 'paragraph'])
  })

  it('§8 — object ↔ paragraph on both sides (figure / table / code / formula / list / blockquote)', () => {
    const cases: Array<[string, string, string]> = [
      ['figure', '![图](a.png)\n\n\n\n正文。\n', 'paragraph'],
      ['table', '| A |\n| - |\n| 1 |\n\n\n\n正文。\n', 'paragraph'],
      ['code', '```ts\nlet a = 1\n```\n\n\n\n正文。\n', 'paragraph'],
      ['formula', '$$\na = 1\n$$\n\n\n\n正文。\n', 'paragraph'],
      ['list', '- 项目\n\n\n\n正文。\n', 'paragraph'],
      ['blockquote', '> 引用\n\n\n\n正文。\n', 'paragraph'],
    ]
    for (const [label, markdown, expectedNext] of cases) {
      const gaps = analyzeInternalBlankLineGaps(markdown)
      expect(gaps, label).toHaveLength(1)
      expect(gaps[0].nextBlockKind, label).toBe(expectedNext)
      expect(gaps[0].actualBlankLines, label).toBe(3)
    }
    // …and the mirrored paragraph → object direction.
    const mirrored = analyzeInternalBlankLineGaps('正文。\n\n\n\n![图](a.png)\n')
    expect(mirrored).toHaveLength(1)
    expect(mirrored[0].previousBlockKind).toBe('paragraph')
    expect(mirrored[0].nextBlockKind).toBe('paragraph')
  })

  it('§6 — one gap produces exactly ONE gap entry (never one per blank line)', () => {
    expect(collectDocumentBlockGaps('A\n\n\n\n\n\nB\n').filter(g => g.actualBlankLines === 5)).toHaveLength(1)
    expect(internalDiagnostics('A\n\n\n\n\n\nB\n')).toHaveLength(1)
  })
})

// ── §10/§11/§12/§13/§14/§15 — separations and exclusions ───────────────────

describe('Internal Blank-Line Policy V1 — separations and exclusions', () => {
  it('§11 — leading blank lines are never internal', () => {
    expect(blanksOf('\n\n\n\n# 标题\n\n正文。\n')).toEqual([])
    expect(internalDiagnostics('\n\n\n\n# 标题\n')).toHaveLength(0)
  })

  it('§10 — trailing EOF blank lines are never internal (EOF rules own them)', () => {
    expect(blanksOf('# 标题\n\n正文。\n\n\n\n\n')).toEqual([])
    const codes = computeDocumentDiagnostics(inputOf('# 标题\n\n正文。\n\n\n\n\n')).diagnostics.map(d => d.code)
    expect(codes).toContain('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')
    expect(codes).not.toContain(EXCESSIVE_INTERNAL_BLANK_LINES_CODE)
  })

  it('§10 — an INTERNAL gap never produces an EOF diagnostic', () => {
    const codes = computeDocumentDiagnostics(inputOf('# 标题\n\n\n\n正文。\n')).diagnostics.map(d => d.code)
    expect(codes).toContain(EXCESSIVE_INTERNAL_BLANK_LINES_CODE)
    expect(codes).not.toContain('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')
    expect(codes).not.toContain('DOCUMENT_TERMINAL_NEWLINE_MISSING')
  })

  it('§12 — blank lines inside a fenced code block are content, never a gap', () => {
    expect(blanksOf('# 标题\n\n```ts\nlet a = 1\n\n\n\nlet b = 2\n```\n\n正文。\n')).toEqual([])
    expect(internalDiagnostics('# 标题\n\n```ts\nlet a = 1\n\n\n\nlet b = 2\n```\n\n正文。\n')).toHaveLength(0)
  })

  it('§13 — blank lines inside a display formula are content, never a gap', () => {
    const markdown = '# 标题\n\n$$\na = 1\n\n\n\nb = 2\n$$\n\n正文。\n'
    expect(blanksOf(markdown)).toEqual([])
    expect(internalDiagnostics(markdown)).toHaveLength(0)
  })

  it('§14 — blank lines inside YAML front matter are content, never a gap', () => {
    const markdown = '---\ntitle: a\n\n\n\ntags: b\n---\n\n# 标题\n\n正文。\n'
    expect(blanksOf(markdown)).toEqual([])
  })

  it('§14 — blank lines inside an HTML block are content, never a gap', () => {
    const markdown = '# 标题\n\n<div>\n\n\n\n</div>\n\n正文。\n'
    expect(blanksOf(markdown)).toEqual([])
  })

  it('§15 — a loose list / lazy blockquote interior is never a sibling gap', () => {
    expect(blanksOf('- 项目 A\n\n\n\n- 项目 B\n')).toEqual([])
    expect(blanksOf('> 引用 A\n\n\n\n> 引用 B\n')).toEqual([])
  })

  it('§15 — a gap between a container and the NEXT sibling block IS reported', () => {
    expect(blanksOf('- 项目 A\n\n\n\n正文。\n')).toEqual([3])
    expect(blanksOf('> 引用 A\n\n\n\n正文。\n')).toEqual([3])
    expect(blanksOf('正文。\n\n\n\n- 项目 A\n')).toEqual([3])
  })
})

// ── §20/§29 — identity + dedup ─────────────────────────────────────────────

describe('Internal Blank-Line Policy V1 — identity and dedup', () => {
  it('§20 — the identity never depends on the line index or the blank count', () => {
    const a = analyzeInternalBlankLineGaps('# 标题\n\n\n\n正文。\n')[0]
    const b = analyzeInternalBlankLineGaps('# 标题\n\n\n\n\n\n正文。\n')[0]
    expect(internalBlankGapIdentity(a)).toBe(internalBlankGapIdentity(b))
  })

  it('§29 — editing 3 → 4 → 5 → 6 blank lines is the SAME diagnostic (no duplicate)', () => {
    const ids = [3, 4, 5, 6].map(n => {
      const diags = internalDiagnostics(`# 标题${'\n'.repeat(n + 1)}正文。\n`)
      expect(diags, `${n} blanks`).toHaveLength(1)
      return diags[0].id
    })
    expect(new Set(ids).size).toBe(1)
  })

  it('§29 — the actualBlankLines / detail / source range are updated in place', () => {
    const three = internalDiagnostics('# 标题\n\n\n\n正文。\n')[0]
    const five = internalDiagnostics('# 标题\n\n\n\n\n\n正文。\n')[0]
    expect(three.id).toBe(five.id)
    expect(three.metadata?.actualBlankLines).toBe(3)
    expect(five.metadata?.actualBlankLines).toBe(5)
    expect(three.detail).not.toBe(five.detail)
    expect(String(five.detail)).toContain('5')
  })

  it('§20/§6 — two DIFFERENT gaps produce two diagnostics with different ids', () => {
    const diags = internalDiagnostics('# 标题\n\n\n\n正文 A。\n\n\n\n正文 B。\n')
    expect(diags).toHaveLength(2)
    expect(new Set(diags.map(d => d.id)).size).toBe(2)
  })

  it('§7/§9 — the diagnostic carries the full DocumentBlockGap facts', () => {
    const diag = internalDiagnostics('# 标题\n\n\n\n正文。\n')[0]
    const meta = diag.metadata ?? {}
    expect(meta.previousBlockKind).toBe('heading')
    expect(meta.nextBlockKind).toBe('paragraph')
    expect(meta.previousBlockIdentity).toBeTruthy()
    expect(meta.nextBlockIdentity).toBeTruthy()
    expect(meta.firstBlankLine).toBe(1)
    expect(meta.lastBlankLine).toBe(3)
    expect(meta.actualBlankLines).toBe(3)
    expect(meta.passMaxBlankLines).toBe(2)
    expect(meta.warningThreshold).toBe(3)
    expect(meta.reasonChip).toBe(false)
    expect(meta.ruleCategory).toBe('document-format')
    expect(meta.scope).toBe('block-gap')
  })

  it('§22/§23 — the locator anchors the NEXT block (never the blank band)', () => {
    const diag = internalDiagnostics('# 标题\n\n\n\n正文锚点。\n')[0]
    expect(diag.location?.kind).toBe('source-range')
    const loc = diag.location as { startLine: number; rawText?: string }
    expect(loc.startLine).toBe(4) // the first blank-free line AFTER the gap
    expect(loc.rawText).toBe('正文锚点。')
  })

  it('§2 — 2 blank lines never become a Hint', () => {
    const diags = internalDiagnostics('# 标题\n\n\n正文。\n')
    expect(diags).toHaveLength(0)
  })

  it('§27 — the diagnostic counts as exactly ONE warning', () => {
    const computed = computeDocumentDiagnostics(inputOf('# 标题\n\n\n\n正文。\n'))
    expect(computed.warningCount).toBe(1)
    expect(computed.errorCount).toBe(0)
    expect(computed.diagnostics.filter(d => d.code === EXCESSIVE_INTERNAL_BLANK_LINES_CODE)[0].severity).toBe('warning')
  })
})

// ── §4 — source-only detection ─────────────────────────────────────────────

describe('Internal Blank-Line Policy V1 — runtime fixture contract', () => {
  const markdown = readFileSync(
    'test/vault/runtime/smoke/Document-Diagnostics-Internal-Blank-Lines-Test.md',
    'utf8',
  )
  const gaps = analyzeInternalBlankLineGaps(markdown)
  const pairs = gaps.map(g => `${g.previousBlockKind}>${g.nextBlockKind}:${g.actualBlankLines}`)

  it('§30 — every case A~L is present with the expected gap facts', () => {
    // Case C/D/H + I-1 → paragraph→paragraph (3/5/3/3)
    expect(pairs.filter(p => p.startsWith('paragraph>paragraph'))).toEqual([
      'paragraph>paragraph:3', // Case C
      'paragraph>paragraph:5', // Case D
      'paragraph>paragraph:3', // Case H
      'paragraph>paragraph:3', // I-1 (image paragraph → paragraph)
    ])
    expect(pairs).toContain('heading>paragraph:3')  // Case E
    expect(pairs).toContain('paragraph>heading:3')  // Case F
    expect(pairs).toContain('heading>heading:3')    // Case G
    expect(pairs).toContain('table>paragraph:3')    // I-2
    expect(pairs).toContain('code>paragraph:3')     // I-3
    expect(pairs).toContain('formula>paragraph:3')  // I-4
    expect(pairs).toContain('list>paragraph:3')     // I-5
    expect(pairs).toContain('blockquote>paragraph:3') // I-6
  })

  it('§30 — exactly ONE gap reports actualBlankLines=5 (Case D) and none is below the threshold', () => {
    expect(gaps.filter(g => g.actualBlankLines === 5)).toHaveLength(1)
    expect(gaps.every(g => g.actualBlankLines >= INTERNAL_BLANK_LINE_POLICY.warningThreshold)).toBe(true)
  })

  it('§12/§13 — Case J (code fence) and Case K (formula) add no gap', () => {
    const lines = markdown.split('\n')
    const codeStart = lines.findIndex(l => l.includes('Case J — fenced code'))
    expect(codeStart).toBeGreaterThan(0)
    // no gap sits inside the code fence (between ```ts and the closing ```)
    const inside = gaps.filter(g => g.firstBlankLine > codeStart)
    expect(inside.every(g => g.actualBlankLines >= 3)).toBe(true)
    expect(gaps.some(g => g.actualBlankLines === 3 && g.firstBlankLine > codeStart && g.firstBlankLine < codeStart + 12)).toBe(false)
  })

  it('§10 — Case L (trailing EOF blanks) is never an internal gap', () => {
    const lastContentLine = markdown.trimEnd().split('\n').length - 1
    expect(gaps.every(g => g.lastBlankLine < lastContentLine)).toBe(true)
  })
})

// ── §4 — source-only detection ─────────────────────────────────────────────

describe('Internal Blank-Line Policy V1 — source-only authority', () => {
  it('§4 — whitespace-only lines of any kind count as blank lines', () => {
    expect(analyzeInternalBlankLineGaps('A\n   \n\t\n \t \nB\n')[0]?.actualBlankLines).toBe(3)
  })

  it('§4 — CRLF sources are handled by the same line map', () => {
    expect(analyzeInternalBlankLineGaps('A\r\n\r\n\r\n\r\nB\r\n')[0]?.actualBlankLines).toBe(3)
  })

  it('§4 — the analyzer is a pure Markdown function (no DOM input at all)', () => {
    expect(typeof collectDocumentBlockGaps).toBe('function')
    expect(collectDocumentBlockGaps(null)).toEqual([])
    expect(collectDocumentBlockGaps('')).toEqual([])
  })
})
