// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.8 — Standard EOF newline policy matrix.
 *
 * The old contract ("exactly one trailing blank line", 0→MISSING / 1→PASS /
 * >=2→EXCESSIVE) is formally retired. The file-level contract is:
 *
 *   source does NOT end with a terminal newline  → MISSING_TERMINAL_NEWLINE
 *   terminal newline + extraTrailingBlankLineCount 0~1 → PASS
 *   terminal newline + extraTrailingBlankLineCount >=2 → EXCESSIVE_TRAILING_BLANK_LINES
 *
 * Covered here:
 *   - LF matrix, CRLF matrix, whitespace-only blank-line matrix;
 *   - structural block EOF endings (paragraph / heading / table / code /
 *     figure / formula / list / blockquote): standard terminal newline must be
 *     PASS without any "extra Enter" — the historical Table/Code EOF pain;
 *   - no-terminal-newline and >=2-extra variants per block type;
 *   - MISSING and EXCESSIVE never co-occur (mutually exclusive by verdict).
 */
import { describe, it, expect } from 'vitest'
import { computeDocumentDiagnostics, computeEofNewlinePolicy } from './document-diagnostics'
import type { DocumentDiagnosticsInput } from './document-diagnostics'

function inputOf(markdown: string | null): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc', markdown, strictMode: true, vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
  }
}

function eofCodes(markdown: string): string[] {
  return computeDocumentDiagnostics(inputOf(markdown)).diagnostics
    .filter(d => d.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING' || d.code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')
    .map(d => d.code)
}

const MISSING = 'MISSING_TERMINAL_NEWLINE'
const EXCESSIVE = 'EXCESSIVE_TRAILING_BLANK_LINES'

// ── LF matrix ───────────────────────────────────────────────
describe('EOF-LF matrix', () => {
  it('LF_NO_TERMINAL_NEWLINE: "a" → MISSING', () => {
    const p = computeEofNewlinePolicy('a')
    expect(p.verdict).toBe(MISSING)
    expect(p.hasTerminalNewline).toBe(false)
    expect(eofCodes('a')).toEqual(['DOCUMENT_TERMINAL_NEWLINE_MISSING'])
  })
  it('LF_TERMINAL_NEWLINE_ONLY: "a\\n" → PASS (0 extra)', () => {
    const p = computeEofNewlinePolicy('a\n')
    expect(p.verdict).toBe('PASS')
    expect(p.hasTerminalNewline).toBe(true)
    expect(p.extraTrailingBlankLineCount).toBe(0)
    expect(eofCodes('a\n')).toEqual([])
  })
  it('LF_ONE_EXTRA_BLANK: "a\\n\\n" → PASS (1 extra)', () => {
    const p = computeEofNewlinePolicy('a\n\n')
    expect(p.verdict).toBe('PASS')
    expect(p.extraTrailingBlankLineCount).toBe(1)
    expect(eofCodes('a\n\n')).toEqual([])
  })
  it('LF_TWO_EXTRA_BLANKS: "a\\n\\n\\n" → EXCESSIVE', () => {
    const p = computeEofNewlinePolicy('a\n\n\n')
    expect(p.verdict).toBe(EXCESSIVE)
    expect(p.extraTrailingBlankLineCount).toBe(2)
    expect(eofCodes('a\n\n\n')).toEqual(['DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE'])
  })
})

// ── CRLF matrix ─────────────────────────────────────────────
describe('EOF-CRLF matrix', () => {
  it('CRLF_NO_TERMINAL_NEWLINE: "a" → MISSING', () => {
    expect(computeEofNewlinePolicy('a').verdict).toBe(MISSING)
  })
  it('CRLF_TERMINAL_NEWLINE_ONLY: "a\\r\\n" → PASS (0 extra)', () => {
    const p = computeEofNewlinePolicy('a\r\n')
    expect(p.verdict).toBe('PASS')
    expect(p.hasTerminalNewline).toBe(true)
    expect(p.extraTrailingBlankLineCount).toBe(0)
    expect(eofCodes('a\r\n')).toEqual([])
  })
  it('CRLF_ONE_EXTRA_BLANK: "a\\r\\n\\r\\n" → PASS (1 extra)', () => {
    const p = computeEofNewlinePolicy('a\r\n\r\n')
    expect(p.verdict).toBe('PASS')
    expect(p.extraTrailingBlankLineCount).toBe(1)
    expect(eofCodes('a\r\n\r\n')).toEqual([])
  })
  it('CRLF_TWO_EXTRA_BLANKS: "a\\r\\n\\r\\n\\r\\n" → EXCESSIVE', () => {
    const p = computeEofNewlinePolicy('a\r\n\r\n\r\n')
    expect(p.verdict).toBe(EXCESSIVE)
    expect(p.extraTrailingBlankLineCount).toBe(2)
    expect(eofCodes('a\r\n\r\n\r\n')).toEqual(['DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE'])
  })
})

// ── Whitespace-only blank-line matrix ───────────────────────
describe('EOF-whitespace-only matrix', () => {
  it('WHITESPACE_ONLY_ONE_EXTRA: "a\\n   \\n" / "a\\n\\t\\n" → PASS (spaces/tabs are a blank line)', () => {
    for (const md of ['a\n   \n', 'a\n\t\n', 'a\n \t \n']) {
      const p = computeEofNewlinePolicy(md)
      expect(p.verdict).toBe('PASS')
      expect(p.extraTrailingBlankLineCount).toBe(1)
      expect(eofCodes(md)).toEqual([])
    }
  })
  it('WHITESPACE_ONLY_TWO_EXTRA: "a\\n   \\n\\t\\n" → EXCESSIVE', () => {
    const p = computeEofNewlinePolicy('a\n   \n\t\n')
    expect(p.verdict).toBe(EXCESSIVE)
    expect(p.extraTrailingBlankLineCount).toBe(2)
    expect(eofCodes('a\n   \n\t\n')).toEqual(['DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE'])
  })
  it('content-line trailing spaces are NOT a blank line: "a   \\n" → PASS 0 extra', () => {
    const p = computeEofNewlinePolicy('a   \n')
    expect(p.verdict).toBe('PASS')
    expect(p.extraTrailingBlankLineCount).toBe(0)
  })
})

// ── Structural-block EOF endings ────────────────────────────
const BLOCKS: Array<{ kind: string; md: string }> = [
  { kind: 'paragraph', md: '尾部普通段落。' },
  { kind: 'heading', md: '# 尾部标题' },
  { kind: 'table', md: '| 列A | 列B |\n| --- | --- |\n| 1 | 2 |' },
  { kind: 'code', md: '```ts\nconst answer = 42\n```' },
  { kind: 'figure', md: '![尾部图片](assets/tail.png)' },
  { kind: 'formula', md: '$$\nE = mc^2\n$$' },
  { kind: 'list', md: '- 甲\n- 乙' },
  { kind: 'blockquote', md: '> 尾部引用' },
]

describe('EOF-structural-block regression (unit level)', () => {
  for (const { kind, md } of BLOCKS) {
    it(`${kind.toUpperCase()}_EOF_STANDARD_NEWLINE: block + terminal \\n → PASS, no warning`, () => {
      const standard = md + '\n'
      const p = computeEofNewlinePolicy(standard)
      expect(p.verdict).toBe('PASS')
      expect(p.hasTerminalNewline).toBe(true)
      expect(p.extraTrailingBlankLineCount).toBe(0)
      expect(eofCodes(standard)).toEqual([])
    })

    it(`${kind.toUpperCase()}_EOF_NO_TERMINAL_NEWLINE: block WITHOUT terminal \\n → MISSING_TERMINAL_NEWLINE`, () => {
      const p = computeEofNewlinePolicy(md)
      expect(p.verdict).toBe(MISSING)
      expect(eofCodes(md)).toEqual(['DOCUMENT_TERMINAL_NEWLINE_MISSING'])
    })

    it(`${kind.toUpperCase()}_EOF_TWO_EXTRA_BLANKS: block + \\n\\n\\n → EXCESSIVE only (never MISSING)`, () => {
      const excessive = md + '\n\n\n'
      const p = computeEofNewlinePolicy(excessive)
      expect(p.verdict).toBe(EXCESSIVE)
      expect(p.extraTrailingBlankLineCount).toBeGreaterThanOrEqual(2)
      const codes = eofCodes(excessive)
      expect(codes).toContain('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')
      expect(codes).not.toContain('DOCUMENT_TERMINAL_NEWLINE_MISSING')
    })
  }

  it('interior blanks inside a block (e.g. code fence) never become EOF blanks', () => {
    const code = '```ts\nconst a = 1\n\nconst b = 2\n```\n'
    const p = computeEofNewlinePolicy(code)
    expect(p.verdict).toBe('PASS')
    expect(p.extraTrailingBlankLineCount).toBe(0)
    expect(eofCodes(code)).toEqual([])
  })
})
