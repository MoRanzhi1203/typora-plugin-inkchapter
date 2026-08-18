/**
 * v2.5.7-R5.3.1: Formula TeX Source Verifier.
 *
 * Recovers the raw LaTeX source of a canonical formula host for use as a
 * READ-ONLY hash verifier — never as primary identity. Priority:
 *   1. FORMULA_HOST_RAW_SOURCE_NODE  — <pre> inside the host
 *   2. RAWBLOCK_SOURCE_CONTAINER     — .md-rawblock-container / .md-math-container
 *   3. EDITOR_MARKDOWN_BLOCK_AUTHORITY — N-th $$...$$ block from editor markdown
 *   4. SAFE_HOST_TEXT_SOURCE_SEGMENT — host raw text containing "$$ ... $$"
 *   5. UNAVAILABLE
 *
 * Only allowed normalization: CRLF→LF, trim outer whitespace, strip outermost
 * $$ delimiters. NO semantic rewriting. NO deriving TeX from rendered output.
 * Production code never hardcodes fixture TeX/hashes.
 */

export type FormulaTexSourceKind =
  | 'FORMULA_HOST_RAW_SOURCE_NODE'
  | 'RAWBLOCK_SOURCE_CONTAINER'
  | 'EDITOR_MARKDOWN_BLOCK_AUTHORITY'
  | 'SAFE_HOST_TEXT_SOURCE_SEGMENT'
  | 'UNAVAILABLE'

export interface FormulaTexSourceVerifierResult {
  sourceKind: FormulaTexSourceKind
  /** Number of source candidates considered (before fallbacks). */
  sourceCandidateCount: number
  rawSourceLength: number
  normalizedSourceLength: number
  sourceHash: string
  sourcePrefix: string
  containsDisplayDelimiter: boolean
  editState: 'EDIT' | 'NON_EDIT' | 'UNKNOWN'
  decision: 'READY' | 'DEGRADED' | 'UNAVAILABLE'
  reason: string | null
}

export function simpleHash(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash.toString(16)
}

/** CRLF→LF, trim outer whitespace, strip outermost $$ delimiters only. */
export function normalizeTexSource(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n').trim()
  s = s.replace(/^\$\$\s*/m, '').replace(/\s*\$\$$/m, '')
  return s.trim()
}

/** Detect edit state from the canonical host classes. */
export function resolveEditState(host: HTMLElement | null): 'EDIT' | 'NON_EDIT' | 'UNKNOWN' {
  if (!host) return 'UNKNOWN'
  if (host.classList.contains('md-rawblock-on-edit')) return 'EDIT'
  if (host.classList.contains('md-rawblock') || host.classList.contains('md-math-block')) return 'NON_EDIT'
  return 'UNKNOWN'
}

function findDisplayDelimitedSegment(text: string): string | null {
  const start = text.indexOf('$$')
  if (start < 0) return null
  const end = text.indexOf('$$', start + 2)
  if (end < 0) return null
  return text.slice(start, end + 2)
}

/** Extract the N-th (0-based) "$$ ... $$" display block from markdown. */
export function extractMarkdownDisplayBlock(markdown: string, formulaIndex: number): string | null {
  let remaining = markdown
  let found: string | null = null
  for (let i = 0; i <= formulaIndex; i++) {
    const idx = remaining.indexOf('$$')
    if (idx < 0) return null
    const close = remaining.indexOf('$$', idx + 2)
    if (close < 0) return null
    found = remaining.slice(idx, close + 2)
    remaining = remaining.slice(close + 2)
  }
  return found
}

export interface FormulaTexSourceVerifierInput {
  host: HTMLElement | null
  formulaIndex: number
  editorRoot: HTMLElement | null
  /** Editor markdown for EDITOR_MARKDOWN_BLOCK_AUTHORITY (optional). */
  markdown?: string | null
}

export function verifyFormulaTexSource(input: FormulaTexSourceVerifierInput): FormulaTexSourceVerifierResult {
  const { host, formulaIndex, editorRoot, markdown } = input
  let candidateCount = 0
  let raw = ''
  let sourceKind: FormulaTexSourceKind = 'UNAVAILABLE'

  if (host) {
    // 1. FORMULA_HOST_RAW_SOURCE_NODE — <pre> inside the host.
    try {
      const pre = host.querySelector('pre')
      const fromPre = pre?.textContent
      if (fromPre && fromPre.trim().length > 0) {
        candidateCount++
        raw = fromPre
        sourceKind = 'FORMULA_HOST_RAW_SOURCE_NODE'
      }
    } catch { /* read-only */ }

    // 2. RAWBLOCK_SOURCE_CONTAINER.
    if (!raw && host.querySelector) {
      try {
        const container = host.querySelector('.md-rawblock-container, .md-math-container')
        const fromContainer = container?.textContent
        if (fromContainer && fromContainer.trim().length > 0) {
          candidateCount++
          raw = fromContainer
          sourceKind = 'RAWBLOCK_SOURCE_CONTAINER'
        }
      } catch { /* read-only */ }
    }

    // 3. SAFE_HOST_TEXT_SOURCE_SEGMENT — raw host text containing "$$ ... $$".
    if (!raw) {
      try {
        const segment = findDisplayDelimitedSegment(host.textContent ?? '')
        if (segment) {
          candidateCount++
          raw = segment
          sourceKind = 'SAFE_HOST_TEXT_SOURCE_SEGMENT'
        }
      } catch { /* read-only */ }
    }
  }

  // 3 (higher priority than host-text fallback). EDITOR_MARKDOWN_BLOCK_AUTHORITY.
  if (!raw && markdown && markdown.includes('$$')) {
    try {
      const block = extractMarkdownDisplayBlock(markdown, formulaIndex)
      if (block) {
        candidateCount++
        raw = block
        sourceKind = 'EDITOR_MARKDOWN_BLOCK_AUTHORITY'
      }
    } catch { /* read-only */ }
  }

  // Final fallback — editor root text segment (same SAFE rule).
  if (!raw && editorRoot) {
    try {
      const segment = findDisplayDelimitedSegment(editorRoot.textContent ?? '')
      if (segment) {
        candidateCount++
        raw = segment
        sourceKind = 'SAFE_HOST_TEXT_SOURCE_SEGMENT'
      }
    } catch { /* read-only */ }
  }

  const normalized = normalizeTexSource(raw)
  const containsDisplayDelimiter = raw.includes('$$')
  const editState = resolveEditState(host)

  if (normalized.length === 0) {
    return {
      sourceKind: raw.length === 0 ? 'UNAVAILABLE' : sourceKind,
      sourceCandidateCount: candidateCount,
      rawSourceLength: raw.length,
      normalizedSourceLength: normalized.length,
      sourceHash: simpleHash(normalized),
      sourcePrefix: normalized.slice(0, 80),
      containsDisplayDelimiter,
      editState,
      decision: 'UNAVAILABLE',
      reason: raw.length === 0 ? 'NO_RAW_SOURCE_FOUND' : 'NORMALIZED_SOURCE_EMPTY',
    }
  }

  return {
    sourceKind,
    sourceCandidateCount: candidateCount,
    rawSourceLength: raw.length,
    normalizedSourceLength: normalized.length,
    sourceHash: simpleHash(normalized),
    sourcePrefix: normalized.slice(0, 80),
    containsDisplayDelimiter,
    editState,
    decision: sourceKind === 'SAFE_HOST_TEXT_SOURCE_SEGMENT' || sourceKind === 'EDITOR_MARKDOWN_BLOCK_AUTHORITY' ? 'DEGRADED' : 'READY',
    reason: null,
  }
}

/** Compatibility helper used by caption-service wiring (normalized tex only). */
export function extractFormulaTexForTrace(host: HTMLElement | null): string {
  if (!host) return ''
  const result = verifyFormulaTexSource({ host, formulaIndex: 0, editorRoot: null })
  if (result.decision === 'UNAVAILABLE') return ''
  const pre = host.querySelector('pre')
  const fromPre = pre?.textContent?.trim()
  if (fromPre) return normalizeTexSource(fromPre)
  return normalizeTexSource(host.textContent ?? '')
}
