/**
 * Heading level range utilities: scan, convert, and manage heading levels in markdown.
 *
 * Includes:
 * - Parse headings from raw markdown text (text-based, not DOM)
 * - Detect out-of-range headings
 * - Force-convert out-of-range headings to bold paragraphs (with undo support)
 */

/** Represents a heading line parsed from markdown text. */
export interface ParsedHeading {
  /** 0-based line index in the original markdown content. */
  lineIndex: number
  /** Heading level (1-6). */
  level: number
  /** The heading text (content after the `#` prefix, trimmed). */
  text: string
  /** Full line text (the `#` prefix part). */
  prefix: string
}

/** Result of scanning markdown for out-of-range headings. */
export interface HeadingScanResult {
  /** All headings found in the document. */
  allHeadings: ParsedHeading[]
  /** Only headings whose level exceeds maxLevel. */
  outOfRange: ParsedHeading[]
}

/** Action chosen by the user when lowering the range. */
export type RangeReduceAction = 'cancel' | 'limit-future' | 'convert'

/** Heading regex: must start with 1-6 # characters followed by a space. */
const RE_HEADING_LINE = /^(#{1,6})\s+(.+?)\s*$/

/**
 * Scan markdown content and identify out-of-range headings.
 * Code blocks are handled: lines inside ``` are skipped.
 */
export function scanHeadingsForRange(
  markdown: string,
  maxLevel: number,
): HeadingScanResult {
  const lines = markdown.split(/\n/)
  const allHeadings: ParsedHeading[] = []
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]

    // Detect code block fences (only at line start)
    const isFence = /^```/.test(raw.trimStart())
    if (isFence) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    // Skip blockquote lines for heading detection
    const stripped = raw.trimStart()
    if (stripped.startsWith('>')) {
      const afterBlockquote = stripped.replace(/^>+\s*/, '')
      if (/^#{1,6}\s/.test(afterBlockquote)) {
        continue
      }
      continue
    }

    const match = raw.match(RE_HEADING_LINE)
    if (match) {
      const level = match[1].length
      const text = match[2].trim()

      if (text.length === 0) continue

      allHeadings.push({
        lineIndex: i,
        level,
        text: match[2],
        prefix: match[1],
      })
    }
  }

  return {
    allHeadings,
    outOfRange: allHeadings.filter(h => h.level > maxLevel),
  }
}

/**
 * Convert out-of-range headings to bold paragraphs in markdown text.
 *
 * Converts: `##### Result` → `**Result**`
 * Preserves: inline code, links, and existing formatting in heading text.
 * Does NOT add plugin auto-numbering.
 * Code blocks are handled correctly (fenced content skipped).
 *
 * Returns the modified markdown text.
 */
export function convertHeadingsToBold(
  markdown: string,
  headings: ParsedHeading[],
): string {
  const lines = markdown.split(/\n/)
  const sorted = [...headings].sort((a, b) => b.lineIndex - a.lineIndex)

  for (const h of sorted) {
    const line = lines[h.lineIndex]
    const match = line.match(RE_HEADING_LINE)
    if (!match) continue

    const text = match[2].trim()
    if (text.length === 0) {
      lines[h.lineIndex] = ''
      continue
    }

    lines[h.lineIndex] = `**${text}**`
  }

  return lines.join('\n')
}
