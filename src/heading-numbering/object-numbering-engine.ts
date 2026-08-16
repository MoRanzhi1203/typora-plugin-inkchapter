/**
 * Object Numbering V2 — unified, pure numbering engine for table/figure/code/formula.
 *
 * One engine shared by all object adapters (never four copies of the algorithm).
 * Numbering is computed from document structure + config, never stored in Markdown.
 * Name stays fully decoupled from numbering eligibility/value.
 */

import { chapterFromHeadingNumber, sectionFromHeadingNumber } from './heading-context-resolver'

export type ObjectNumberingType = 'table' | 'figure' | 'code' | 'formula'

export type NumberingMode =
  | 'continuous'
  | 'reset-h1'
  | 'reset-h2'
  | 'reset-h3'
  | 'chapter-linked'
  | 'custom'

export type NumberStyle =
  | 'arabic'
  | 'arabic-padded'
  | 'chinese'
  | 'chinese-financial'
  | 'roman-lower'
  | 'roman-upper'
  | 'alpha-lower'
  | 'alpha-upper'

export type ObjectPosition = 'above' | 'below' | 'left' | 'right'

export interface ObjectNumberingConfig {
  enabled: boolean
  prefix: string
  position: ObjectPosition
  numberingMode: NumberingMode
  numberStyle: NumberStyle
  startAt: number
  minDigits: number
  template: string
  resetHeadingLevel?: 1 | 2 | 3
  customExpression?: string
  /** formula only: native vs inkchapter numbering implementation. */
  formulaMode?: 'typora-native' | 'inkchapter'
}

export interface HeadingContext {
  h1?: string
  h2?: string
  h3?: string
}

export interface NumberingTarget {
  type: ObjectNumberingType
  documentOrder: number
  name?: string
  headingContext?: HeadingContext
}

export interface NumberingContext {
  n: string
  chapter?: string
  section?: string
  type?: string
}

export interface NumberingResult {
  type: ObjectNumberingType
  sequenceValue: number
  formattedSequence: string
  renderedNumber: string
  label: string
}

export const DEFAULT_OBJECT_NUMBERING_CONFIG: Record<ObjectNumberingType, ObjectNumberingConfig> = {
  table: { enabled: true, prefix: '表', position: 'above', numberingMode: 'continuous', numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '{n}' },
  figure: { enabled: true, prefix: '图', position: 'below', numberingMode: 'continuous', numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '{n}' },
  code: { enabled: true, prefix: '代码', position: 'above', numberingMode: 'continuous', numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '{n}' },
  formula: { enabled: false, prefix: '', position: 'right', numberingMode: 'continuous', numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '({n})', formulaMode: 'typora-native' },
}

// ── Number style formatting ──────────────────────────────────────────

function toChineseNumberLower(n: number): string {
  if (n < 0) return ''
  const v = Math.floor(n)
  if (v === 0) return '零'
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  const units = ['', '十', '百', '千']
  const str = String(v)
  let out = ''
  let zeroPending = false
  for (let i = 0; i < str.length; i++) {
    const d = Number(str[i])
    const pos = str.length - 1 - i
    if (d === 0) { zeroPending = true; continue }
    if (zeroPending) { out += '零'; zeroPending = false }
    if (pos === 1 && d === 1 && i === 0) {
      out += units[pos]
    } else {
      out += digits[d] + units[pos]
    }
  }
  return out
}

function toChineseNumberFinancial(n: number): string {
  const lower = toChineseNumberLower(n)
  const map: Record<string, string> = {
    零: '零', 一: '壹', 二: '贰', 三: '叁', 四: '肆', 五: '伍', 六: '陆', 七: '柒', 八: '捌', 九: '玖',
    十: '拾', 百: '佰', 千: '仟', 万: '万', 亿: '亿', 兆: '兆',
  }
  return lower.split('').map(ch => map[ch] ?? ch).join('')
}

function toRoman(n: number): string {
  if (n < 1 || n > 3999) return ''
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let v = Math.floor(n)
  let out = ''
  for (const [num, sym] of table) {
    while (v >= num) { out += sym; v -= num }
  }
  return out
}

function toAlpha(n: number): string {
  if (n < 1) return ''
  let v = n
  let out = ''
  while (v > 0) {
    v--
    out = String.fromCharCode(65 + (v % 26)) + out
    v = Math.floor(v / 26)
  }
  return out
}

/**
 * Format a 1-based sequence value into its display form for a given style.
 * `minDigits` only affects `arabic-padded`.
 */
export function formatSequenceNumber(value: number, style: NumberStyle, minDigits = 1): string {
  const v = Math.max(0, Math.floor(value))
  switch (style) {
    case 'arabic':
      return String(v)
    case 'arabic-padded':
      return String(v).padStart(Math.max(1, minDigits), '0')
    case 'chinese':
      return toChineseNumberLower(v)
    case 'chinese-financial':
      return toChineseNumberFinancial(v)
    case 'roman-lower':
      return toRoman(v).toLowerCase()
    case 'roman-upper':
      return toRoman(v)
    case 'alpha-lower':
      return toAlpha(v).toLowerCase()
    case 'alpha-upper':
      return toAlpha(v)
  }
}

// ── Number template rendering ────────────────────────────────────────

/**
 * Render a number template (`{n}`, `{chapter}`, `{section}`, `{type}`) into a
 * string. Unknown placeholders are kept as-is (fail-safe); validation is done
 * separately by `validateNumberTemplate`.
 */
export function renderNumberTemplate(template: string, context: NumberingContext): string {
  const t = template ?? '{n}'
  return t
    .replace(/\{n\}/g, context.n ?? '')
    .replace(/\{chapter\}/g, context.chapter ?? '0')
    .replace(/\{section\}/g, context.section ?? '0')
    .replace(/\{type\}/g, context.type ?? '')
}

export function validateNumberTemplate(template: string): { valid: boolean; reason: string } {
  const t = (template ?? '').trim()
  if (t === '') return { valid: false, reason: 'EMPTY_TEMPLATE' }
  if (!/\{n\}/.test(t)) return { valid: false, reason: 'MISSING_N_TOKEN' }
  const known = /(\{[a-z]+\})/g
  let m: RegExpExecArray | null
  known.lastIndex = 0
  while ((m = known.exec(t)) !== null) {
    if (!['{n}', '{chapter}', '{section}', '{type}'].includes(m[1])) {
      return { valid: false, reason: `UNKNOWN_TOKEN_${m[1]}` }
    }
  }
  return { valid: true, reason: 'OK' }
}

// ── Numbering computation (pure) ─────────────────────────────────────

export interface ComputeObjectNumbersOptions {
  configs: Record<ObjectNumberingType, ObjectNumberingConfig>
  /** Fallback heading context used when a target has none. */
  headingContext?: HeadingContext
}

/**
 * Compute per-target sequence values + rendered numbers + labels.
 * Each type has an INDEPENDENT sequence. NumberingMode controls reset points:
 * continuous (no reset), reset-h1/h2/h3 (reset when that heading changes),
 * chapter-linked (reset per H1 chapter), custom (continuous fallback).
 * Name never influences numbering.
 */
export function computeObjectNumbers(
  targets: NumberingTarget[],
  options: ComputeObjectNumbersOptions,
): NumberingResult[] {
  const { configs, headingContext = {} } = options
  const counters: Partial<Record<ObjectNumberingType, number>> = {}
  const lastHeading: Partial<Record<ObjectNumberingType, { h1?: string; h2?: string; h3?: string }>> = {}

  const resetKey = (mode: NumberingMode, ctx: HeadingContext | undefined, type: ObjectNumberingType): string => {
    const c = ctx ?? {}
    switch (mode) {
      case 'reset-h1': return c.h1 ?? ''
      case 'reset-h2': return `${c.h1 ?? ''}\u0000${c.h2 ?? ''}`
      case 'reset-h3': return `${c.h1 ?? ''}\u0000${c.h2 ?? ''}\u0000${c.h3 ?? ''}`
      case 'chapter-linked': return c.h1 ?? ''
      default: return ''
    }
  }

  return targets.map(target => {
    const type = target.type
    const config = configs[type] ?? DEFAULT_OBJECT_NUMBERING_CONFIG[type]
    const ctx: HeadingContext = target.headingContext ?? headingContext
    const key = resetKey(config.numberingMode, ctx, type)
    const prevKey = lastHeading[type]?.h1 === undefined ? undefined : resetKey(config.numberingMode, lastHeading[type], type)

    if (key !== (prevKey ?? key) || counters[type] === undefined) {
      counters[type] = config.startAt - 1
    }
    counters[type]++
    lastHeading[type] = ctx

    const sequenceValue = counters[type]
    const formattedSequence = formatSequenceNumber(sequenceValue, config.numberStyle, config.minDigits)
    const renderedNumber = renderNumberTemplate(config.template, {
      n: formattedSequence,
      chapter: chapterFromHeadingNumber(ctx.h1 ?? headingContext.h1),
      section: sectionFromHeadingNumber(ctx.h2 ?? headingContext.h2),
      type: config.prefix,
    })
    const label = buildObjectNumberingLabel(config.prefix, renderedNumber, target.name ?? '')
    return { type, sequenceValue, formattedSequence, renderedNumber, label }
  })
}

/** Build the final caption label: prefix + renderedNumber + optional name. */
export function buildObjectNumberingLabel(prefix: string, renderedNumber: string, name: string): string {
  const parts: string[] = []
  if (prefix.trim() !== '') parts.push(prefix.trim())
  parts.push(renderedNumber)
  const trimmedName = name.trim()
  if (trimmedName !== '') parts.push(trimmedName)
  return parts.join(' ')
}

/** Render a preview label from an explicit sample context (for the settings UI). */
export function renderNumberingPreview(
  type: ObjectNumberingType,
  config: ObjectNumberingConfig,
  sample: { n?: number; chapter?: string; section?: string; name?: string },
): string {
  const cfg = { ...DEFAULT_OBJECT_NUMBERING_CONFIG[type], ...config }
  const n = sample.n ?? 1
  const formatted = formatSequenceNumber(n, cfg.numberStyle, cfg.minDigits)
  const rendered = renderNumberTemplate(cfg.template, {
    n: formatted,
    chapter: sample.chapter ?? '2',
    section: sample.section ?? '3',
    type: cfg.prefix,
  })
  return buildObjectNumberingLabel(cfg.prefix, rendered, sample.name ?? '')
}
