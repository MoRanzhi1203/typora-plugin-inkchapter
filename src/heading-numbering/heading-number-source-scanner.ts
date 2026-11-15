/**
 * R08 — Existing heading number scanner (pure).
 *
 * WHY: heading numbers used to live ONLY in the render layer. Any document that
 * already carried manual numbers (`1.1 研究背景`, `第一章 绪论`, `一、背景`) got a
 * SECOND projected number on top of the manual one. Before the plugin may write,
 * adopt, replace or diagnose a source number it has to answer one question per
 * heading: "is this leading token really a section number, and is it the number
 * the unified engine would produce?"
 *
 * Rules that protect ordinary prose (the old naive `^\d+` stripping failed here):
 *   - a bare number needs a delimiter (`1.`, `1、`, `1)`) or must equal the
 *     EXPECTED computed label to count as confirmed;
 *   - `2026 年研究报告` → weak candidate (2026 ≠ expected) ⇒ never auto-rewritten;
 *   - `3D 建模技术` → no match at all (digit immediately followed by a letter);
 *   - `第三代人工智能` → no match (Chinese numeral without `、` / `第…章` wrapper).
 *
 * Confidence contract:
 *   verified   = the prefix equals the unified computed label.
 *   structural = unambiguous numbering grammar (wrapper or delimiter).
 *   weak       = ambiguous (bare number/letter + whitespace, not the expected label).
 * Only `verified` / `structural` prefixes may be auto-adopted, replaced or removed.
 */

export type DetectedHeadingNumberFormat =
  | 'arabic'
  | 'decimal-multilevel'
  | 'fullwidth-arabic'
  | 'chinese-chapter'
  | 'chinese-outline'
  | 'chinese-parenthesized'
  | 'roman'
  | 'alpha'
  | 'circled'
  | 'appendix'
  | 'custom'

export type DetectionConfidence = 'verified' | 'structural' | 'weak'

export interface HeadingNumberScanOptions {
  /** Unified engine label for this heading. '' / undefined = heading is not numbered. */
  expectedLabel?: string
  /** Custom literal prefix configured for this level (e.g. `课题`). */
  templatePrefix?: string
  /** Custom literal suffix configured for this level (e.g. `部分`). */
  templateSuffix?: string
}

export interface ExistingHeadingNumber {
  /** Exact matched prefix, including wrapper, delimiter and trailing whitespace. */
  raw: string
  /** Number portion including wrapper, e.g. `1.2`, `第一章`, `III`, `（一）`. */
  numberText: string
  format: DetectedHeadingNumberFormat
  confidence: DetectionConfidence
  matchesExpected: boolean
  /** Heading text after the prefix, leading whitespace removed. */
  title: string
}

export interface ScannedHeadingNumber {
  /** The first (outermost) number prefix. null = heading has no number prefix. */
  first: ExistingHeadingNumber | null
  /** Any ADDITIONAL prefixes found after the first one (double numbering). */
  extra: ExistingHeadingNumber[]
  /** Title with every confirmed prefix removed. */
  title: string
}

interface PatternHit {
  raw: string
  numberText: string
  format: DetectedHeadingNumberFormat
  strong: boolean
}

const FULLWIDTH_DIGIT_START = 0xFF10
const ASCII_DIGIT_START = 0x30

const CHINESE_DIGITS = '0-9０-９一二三四五六七八九十百千零〇两壹贰叁肆伍陆柒捌玖拾'
const ARABIC = '0-9０-９'

interface PatternRule {
  format: DetectedHeadingNumberFormat
  strong: boolean
  /** Captures group 1 = number text; group 2 (optional) is the trailing delimiter. */
  regex: RegExp
}

/**
 * Ordered grammar. Longest / most specific wrappers first; decimal before the
 * single-level arabic rule so `1.2` never degrades to `1.`.
 */
const PATTERN_RULES: readonly PatternRule[] = [
  {
    format: 'chinese-chapter',
    strong: true,
    regex: new RegExp(`^(第\\s*[${CHINESE_DIGITS}]+\\s*[章节篇部卷条])(?:\\s*[、，,：:.．])?\\s*`),
  },
  {
    format: 'appendix',
    strong: true,
    regex: /^(附录\s*[A-Za-z0-9０-９]+(?:\.[0-9]+)*)(?:\s*[、，,：:.．])?\s*/,
  },
  {
    format: 'chinese-parenthesized',
    strong: true,
    regex: new RegExp(`^([（(]\\s*[${CHINESE_DIGITS}]+\\s*[）)])\\s*`),
  },
  {
    format: 'chinese-parenthesized',
    strong: true,
    regex: new RegExp(`^([（(]\\s*[${ARABIC}]+\\s*[）)])\\s*`),
  },
  {
    // Decimal must precede the single-level rules so `1.2` never degrades to `1.`.
    format: 'decimal-multilevel',
    strong: true,
    regex: new RegExp(`^([${ARABIC}]+(?:[.．\\-][${ARABIC}]+)+)(?=[\\s、，,：:）)]|[.．]|$)(?:[、，,：:）)]|[.．])?\\s*`),
  },
  {
    format: 'chinese-outline',
    strong: true,
    regex: new RegExp(`^([${CHINESE_DIGITS}]+)([、，,．.])\\s*`),
  },
  {
    format: 'circled',
    strong: true,
    regex: /^([①-⑳㉑-㉟㊱-㊿])(?:[、，,：:.．])?\s*/,
  },
  {
    // A delimiter is REQUIRED: `I think` must never look like a roman number.
    format: 'roman',
    strong: true,
    regex: /^([IVXLCDM]{1,8})(?:[、，,：:）)]|[.．])\s*/,
  },
  {
    format: 'alpha',
    strong: true,
    regex: /^([A-Za-z])(?:[、，,：:）)]|[.．])\s*/,
  },
  {
    format: 'arabic',
    strong: true,
    regex: new RegExp(`^([${ARABIC}]+)([、，,：:）)]|[.．])\\s*`),
  },
  {
    // A bare 1-3 digit number + whitespace is the common Word/plain-Markdown
    // section number (`2 研究方法`). Longer numbers (`2026 年研究报告`) stay weak
    // so a year is never mistaken for a section number.
    format: 'arabic',
    strong: true,
    regex: new RegExp(`^([${ARABIC}]{1,3})\\s+`),
  },
  {
    format: 'arabic',
    strong: false,
    regex: new RegExp(`^([${ARABIC}]{4,})\\s+`),
  },
]

const MAX_PREFIX_SCAN = 3

/** Normalise a label for equality comparison (width, whitespace, separators). */
export function canonicalNumberLabel(value: string): string {
  return value
    .replace(/[\s\u00A0\u3000]+/g, '')
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - FULLWIDTH_DIGIT_START + ASCII_DIGIT_START))
    .replace(/[Ａ-Ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[ａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[．。]/g, '.')
    .replace(/，/g, ',')
    .replace(/：/g, ':')
}

/** Digits-only detection used to pick the `fullwidth-arabic` format. */
function isFullwidthDigits(value: string): boolean {
  return /[０-９]/.test(value) && !/[0-9]/.test(value)
}

function buildCustomHit(text: string, options: HeadingNumberScanOptions): PatternHit | null {
  const prefix = options.templatePrefix ?? ''
  const suffix = options.templateSuffix ?? ''
  if (prefix === '' && suffix === '') return null
  const escapedPrefix = escapeRegExp(prefix)
  const escapedSuffix = escapeRegExp(suffix)
  const regex = new RegExp(`^(${escapedPrefix}\\s*[^\\s]+?\\s*${escapedSuffix})(?=[\\s、，,：:）)]|$)\\s*[、，,：:）)]?\\s*`)
  const match = regex.exec(text)
  if (!match) return null
  const raw = match[0]
  if (raw.trim() === '') return null
  return {
    raw,
    numberText: match[1].trim(),
    format: 'custom',
    strong: prefix !== '' || suffix !== '',
  }
}

/** `2026.11.16 报告` is a date, not a section number. */
const DATE_LIKE_PREFIX = new RegExp(`^[0-9０-９]{4}[.．\\-/][0-9０-９]{1,2}[.．\\-/][0-9０-９]{1,2}(?=\\s|$)`)

function findPatternHit(text: string, options: HeadingNumberScanOptions): PatternHit | null {
  const custom = buildCustomHit(text, options)
  if (custom) return custom
  if (DATE_LIKE_PREFIX.test(text)) return null
  const expected = canonicalNumberLabel(options.expectedLabel ?? '')

  for (const rule of PATTERN_RULES) {
    const match = rule.regex.exec(text)
    if (!match) continue
    const raw = match[0]
    if (raw.trim() === '') continue
    const numberText = match[1]?.trim() ?? ''
    if (numberText === '') continue
    const format: DetectedHeadingNumberFormat =
      (rule.format === 'arabic' || rule.format === 'decimal-multilevel') && isFullwidthDigits(numberText)
        ? 'fullwidth-arabic'
        : rule.format
    return {
      raw,
      numberText,
      format,
      strong: rule.strong,
    }
  }
  return null
}

/**
 * Scan ONE prefix from the start of a heading text.
 *
 * @returns null when no grammar matched, or when the remainder would be empty
 *          (a heading that is nothing but a number is never rewritten).
 */
export function scanHeadingNumberPrefix(
  text: string,
  options: HeadingNumberScanOptions = {},
): ExistingHeadingNumber | null {
  const source = stripLeadingWhitespace(text)
  if (source === '') return null
  const hit = findPatternHit(source, options)
  if (!hit) return null
  const title = stripLeadingWhitespace(source.slice(hit.raw.length))
  if (title === '') return null

  const expected = canonicalNumberLabel(options.expectedLabel ?? '')
  const matchesExpected = expected !== '' && canonicalNumberLabel(hit.numberText) === expected
  const confidence: DetectionConfidence = matchesExpected
    ? 'verified'
    : (hit.strong ? 'structural' : 'weak')

  return {
    raw: hit.raw,
    numberText: hit.numberText,
    format: hit.format,
    confidence,
    matchesExpected,
    title,
  }
}

/**
 * Scan a heading text and strip EVERY confirmed prefix (repairs double
 * numbering `1.1 1.1 研究背景` → title `研究背景` in one pass).
 *
 * A weak prefix that does not match the expected label is NOT stripped; it is
 * reported as the first match so callers can list it as an unresolved candidate.
 */
export function scanHeadingNumber(
  text: string,
  options: HeadingNumberScanOptions = {},
): ScannedHeadingNumber {
  let remaining = stripLeadingWhitespace(text)
  const matches: ExistingHeadingNumber[] = []

  for (let i = 0; i < MAX_PREFIX_SCAN; i++) {
    const match = scanHeadingNumberPrefix(remaining, options)
    if (!match) break
    if (match.confidence === 'weak' && !match.matchesExpected) {
      // Ambiguous (e.g. `2026 年研究报告`) — keep it, never auto-strip.
      if (matches.length === 0) matches.push(match)
      break
    }
    matches.push(match)
    remaining = match.title
    if (matches.length === 1) continue
  }

  return {
    first: matches[0] ?? null,
    extra: matches.slice(1),
    title: matches.length === 0 ? stripLeadingWhitespace(text) : remaining,
  }
}

/** True when the prefix may be rewritten / removed without user confirmation. */
export function isRewritableHeadingNumber(match: ExistingHeadingNumber | null): boolean {
  if (!match) return false
  return match.confidence === 'verified' || match.confidence === 'structural'
}

/** Remove all confirmed prefixes from a heading text (no numbering re-added). */
export function stripHeadingNumberPrefixes(
  text: string,
  options: HeadingNumberScanOptions = {},
): string {
  return scanHeadingNumber(text, options).title
}

function stripLeadingWhitespace(value: string): string {
  return value.replace(/^[\s\u00A0\u3000]+/, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
