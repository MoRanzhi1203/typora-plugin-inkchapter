/**
 * Heading Auto-Number Conflict Diagnostics V1 §7/§8/§9/§10 — the ONE
 * `HeadingManualNumberPrefixAuthority`.
 *
 * It classifies the CONFIRMED / AMBIGUOUS / NONE status of a manual number
 * prefix carried by a CANONICAL MARKDOWN SOURCE heading text.
 *
 * §5 — the input MUST be the canonical source heading text. The plugin's own
 * generated numbering (a CSS `::before` decoration fed by
 * `data-inkchapter-heading-number`) is NEVER a DOM text node and MUST NEVER be
 * fed here, otherwise the plugin would report its own number as a manual one
 * (`AUTO_GENERATED_HEADING_NUMBER_REPORTED_AS_MANUAL_COUNT=0`).
 *
 * §9/§10 — only `confirmed` may raise an Error. A bare integer + whitespace
 * (`1 绪论`, `2026 工作总结`) and every year / tech token (`2026 年工作总结`,
 * `3D`, `5G`, `Python 3.12`, `ISO 9001`, `R2`, `H2O`, `100 个实验样本`,
 * `Version 2`) stays `ambiguous`/`none`, so the rule can never misfire on
 * ordinary heading content (`HEADING_NUMBER_CONTENT_FALSE_POSITIVE_COUNT=0`).
 *
 * NO DOM, NO numbering settings, NO timers — pure source-text classification.
 */

/** §7 — the confirmed manual-number KINDS. */
export type HeadingManualNumberKind =
  | 'decimal'
  | 'decimal-hierarchical'
  | 'arabic-parenthesized'
  | 'chinese'
  | 'chinese-parenthesized'
  | 'roman'
  | 'chapter-style'

/** §7/§9 — only `confirmed` triggers the Error. */
export type HeadingManualNumberPrefixStatus = 'confirmed' | 'ambiguous' | 'none'

export interface HeadingManualNumberPrefixMatch {
  status: HeadingManualNumberPrefixStatus
  kind: HeadingManualNumberKind | null
  /** The exact source substring of the prefix (`一、` / `1.1` / `第1章`). */
  rawPrefix: string
  /** The bare number token (`一` / `1.1` / `1`); null when not confirmed. */
  normalizedPrefix: string | null
  /** 0-based offsets of `rawPrefix` inside the source heading text. */
  sourceStart: number
  sourceEnd: number
}

const NONE_MATCH: HeadingManualNumberPrefixMatch = {
  status: 'none',
  kind: null,
  rawPrefix: '',
  normalizedPrefix: null,
  sourceStart: 0,
  sourceEnd: 0,
}

const CJK_NUMERALS = '〇零一二三四五六七八九十百千两'
const ROMAN_NUMERALS = 'IVXLCDM'

function makeMatch(input: {
  lead: number
  raw: string
  kind: HeadingManualNumberKind
  normalized: string
}): HeadingManualNumberPrefixMatch {
  return {
    status: 'confirmed',
    kind: input.kind,
    rawPrefix: input.raw,
    normalizedPrefix: input.normalized,
    sourceStart: input.lead,
    sourceEnd: input.lead + input.raw.length,
  }
}

function ambiguous(text: string): HeadingManualNumberPrefixMatch {
  const m = /^\s*/.exec(text)
  const lead = m ? m[0].length : 0
  return {
    status: 'ambiguous',
    kind: null,
    rawPrefix: text.slice(lead),
    normalizedPrefix: null,
    sourceStart: lead,
    sourceEnd: text.length,
  }
}

/**
 * §8/§9 — classify the manual number prefix of a SOURCE heading text.
 *
 * Confirmed patterns (low false-positive by construction — every one of them
 * requires an explicit numbering separator / affix):
 *
 *   chapter-style        `第1章` `第一章` `第2节` `第二节`
 *   arabic-parenthesized `(1)` `（1）`
 *   chinese-parenthesized `（一）` `(一)`
 *   chinese              `一、` `二、`
 *   roman                `I.` `II.` `III、` (separator REQUIRED)
 *   decimal-hierarchical `1.1` `2.3.1` `2.3.4.1` (first segment 1-2 digits)
 *   decimal              `1.` `2、` `3)` `1．`
 */
export function resolveHeadingManualNumberPrefix(
  sourceText: string | null | undefined,
): HeadingManualNumberPrefixMatch {
  const text = sourceText ?? ''
  if (text.trim() === '') return NONE_MATCH
  const leadMatch = /^[ \t]*/.exec(text)
  const lead = leadMatch ? leadMatch[0].length : 0
  const body = text.slice(lead)
  if (body === '') return NONE_MATCH

  // ── chapter-style: `第1章` / `第一章` / `第2节` / `第二节` ────────────────
  // The `第…章/节/篇/部` affix is itself the disambiguator (`一对一`, `第三方`
  // never match), so no trailing separator is required.
  const chapter = new RegExp(
    `^(第\\s*(?:\\d{1,3}|[${CJK_NUMERALS}]+)\\s*[章节篇部])`,
  ).exec(body)
  if (chapter) {
    const numMatch = /(\d{1,3}|[〇零一二三四五六七八九十百千两]+)/.exec(chapter[1])
    return makeMatch({ lead, raw: chapter[1], kind: 'chapter-style', normalized: numMatch ? numMatch[1] : chapter[1] })
  }

  // ── parenthesized: `(1)` `（1）` `（一）` ────────────────────────────────
  // The brackets already disambiguate, so `（一）数据` matches without a space.
  const arabicParen = /^([（(]\s*\d{1,3}\s*[）)])/.exec(body)
  if (arabicParen) {
    const numMatch = /(\d{1,3})/.exec(arabicParen[1])
    return makeMatch({ lead, raw: arabicParen[1], kind: 'arabic-parenthesized', normalized: numMatch ? numMatch[1] : arabicParen[1] })
  }
  const cjkParen = new RegExp(`^([（(]\\s*[${CJK_NUMERALS}]+\\s*[）)])`).exec(body)
  if (cjkParen) {
    const numMatch = new RegExp(`([${CJK_NUMERALS}]+)`).exec(cjkParen[1])
    return makeMatch({ lead, raw: cjkParen[1], kind: 'chinese-parenthesized', normalized: numMatch ? numMatch[1] : cjkParen[1] })
  }

  // ── hierarchical decimal: `1.1` / `2.3.1` / `2.3.4.1` ──────────────────
  // The FIRST segment is 1-2 digits, so a year (`2026.10`) is never a level.
  const hierarchical = /^(\d{1,2}(?:[.．]\d{1,3}){1,})(?=\s|$)/.exec(body)
  if (hierarchical) {
    const raw = hierarchical[1]
    return makeMatch({ lead, raw, kind: 'decimal-hierarchical', normalized: raw.replace(/．/g, '.') })
  }

  // ── plain decimal: `1.` / `2、` / `3)` / `1．` ──────────────────────────
  const decimal = /^(\d{1,3})([.、)．])(?=\s|[^\d\s])/.exec(body)
  if (decimal) {
    const raw = `${decimal[1]}${decimal[2]}`
    return makeMatch({ lead, raw, kind: 'decimal', normalized: decimal[1] })
  }

  // ── chinese: `一、` / `二、` (a separator is REQUIRED, so `一对一` /
  //    `三分之一` never match) ────────────────────────────────────────────
  const cjk = new RegExp(`^([${CJK_NUMERALS}]+)([、.])`).exec(body)
  if (cjk) {
    const raw = `${cjk[1]}${cjk[2]}`
    return makeMatch({ lead, raw, kind: 'chinese', normalized: cjk[1] })
  }

  // ── roman: a separator is REQUIRED and the run must be uppercase roman ──
  //    (`Introduction` / `Method` never match — no separator).
  const roman = new RegExp(`^([${ROMAN_NUMERALS}]{1,7})([.、])(?=\\s|$|[^\\sA-Za-z])`).exec(body)
  if (roman) {
    const raw = `${roman[1]}${roman[2]}`
    return makeMatch({ lead, raw, kind: 'roman', normalized: roman[1] })
  }

  // ── §9/§10 — everything else that STARTS with a digit run is AMBIGUOUS
  //    (bare integer + whitespace, a year, `3D` / `5G`, `100 个…`). It can
  //    never become a confirmed prefix from text alone.
  if (/^\d/.test(body)) return ambiguous(text)
  return NONE_MATCH
}

/** §10 — the legacy narrow view: only the confirmed kinds the old rule owned. */
const LEGACY_MANUAL_NUMBER_KINDS: ReadonlySet<HeadingManualNumberKind> = new Set([
  'decimal',
  'decimal-hierarchical',
  'arabic-parenthesized',
  'chinese',
  'chinese-parenthesized',
])

export type LegacyManualNumberPrefixFamily = 'arabic' | 'cjk-enum' | 'cjk-paren'

export interface LegacyManualNumberPrefixMatch {
  family: LegacyManualNumberPrefixFamily
  matched: string
}

export function legacyFamilyForKind(kind: HeadingManualNumberKind): LegacyManualNumberPrefixFamily {
  if (kind === 'chinese') return 'cjk-enum'
  if (kind === 'chinese-parenthesized') return 'cjk-paren'
  return 'arabic'
}

/**
 * §14 — the LEGACY `HEADING_MANUAL_NUMBER_PREFIX` view of the ONE authority.
 *
 * It is deliberately NARROWER than the conflict authority: the legacy warning
 * keeps its historical conservative scope (no `roman`, no `chapter-style`) so a
 * rule that never fired before cannot start firing, while BOTH rules are backed
 * by the SAME parser implementation.
 */
export function detectLegacyManualNumberPrefix(
  text: string | null | undefined,
): LegacyManualNumberPrefixMatch | null {
  const match = resolveHeadingManualNumberPrefix(text)
  if (match.status !== 'confirmed' || match.kind == null) return null
  if (!LEGACY_MANUAL_NUMBER_KINDS.has(match.kind)) return null
  return { family: legacyFamilyForKind(match.kind), matched: match.rawPrefix }
}
