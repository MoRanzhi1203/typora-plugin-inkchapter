/**
 * Document Diagnostics — LEADING BLANK-LINE POLICY V1
 * (`DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE`).
 *
 * THE CONTRACT (blank-line matrix §3.5):
 *
 *   文档开头允许 0 个额外空行；存在任何前置空行即需要删除。
 *
 * The analyzer is SOURCE-ONLY and reuses the shared whitespace contract
 * (`U+200B` / `U+00A0` / `U+FEFF` are blank, never content), so a spaces-only
 * first block cannot masquerade as content.
 *
 * Separation contract:
 *   - this rule owns ONLY the run BEFORE the first content block;
 *   - `EXCESSIVE_INTERNAL_BLANK_LINES` owns gaps BETWEEN content blocks;
 *   - `DOCUMENT_TERMINAL_NEWLINE_MISSING` / `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE`
 *     own the EOF;
 *   - a fully blank document is `DOCUMENT_EMPTY` — never this rule.
 */
import { isWhitespaceOnlyText } from './document-diagnostic-whitespace-semantics-v1'

export const DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE_CODE = 'DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE'

export const DOCUMENT_LEADING_BLANK_LINES_RULE_ID = 'DOCUMENT-LEADING-BLANK-LINES-EXCESSIVE'

export interface LeadingBlankLinesFacts {
  /** Number of raw blank source lines before the first content line. */
  leadingBlankLines: number
  /** 0-based index of the first content line. */
  firstContentLine: number
}

const FRONT_MATTER_DELIM_RE = /^(?:---|\+\+\+|\.\.\.)[ \t]*$/

function splitLines(markdown: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = []
  let offset = 0
  for (const raw of markdown.split('\n')) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    out.push({ text, start: offset, end: offset + text.length })
    offset += raw.length + 1
  }
  return out
}

/**
 * Analyze the leading run. Returns null when there is nothing to report:
 * no leading blank line, a front-matter opening line, or an all-blank document
 * (the empty-document rule owns that case).
 */
export function analyzeLeadingBlankLines(markdown: string | null | undefined): LeadingBlankLinesFacts | null {
  if (markdown == null || markdown === '') return null
  const lines = splitLines(markdown)
  if (lines.length === 0) return null
  // A front-matter opener is the FIRST content line by definition.
  if (FRONT_MATTER_DELIM_RE.test(lines[0].text)) return null
  let firstContent = -1
  for (let i = 0; i < lines.length; i++) {
    if (!isWhitespaceOnlyText(lines[i].text)) { firstContent = i; break }
  }
  if (firstContent <= 0) return null
  return { leadingBlankLines: firstContent, firstContentLine: firstContent }
}

/** The ONE user-facing copy (source / fallback path). */
export function leadingBlankLineDetail(leadingBlankLines: number): string {
  return `文档开头存在 ${leadingBlankLines} 个多余空行，应清除为 0 个。`
}

/** 0-based source offset where the leading run starts (always 0). */
export const LEADING_BLANK_RUN_START = 0
