/**
 * Object Numbering V2 — unified, pure numbering engine for table/figure/code/formula.
 *
 * One engine shared by all object adapters (never four copies of the algorithm).
 * Numbering is computed from document structure + config, never stored in Markdown.
 * Name stays fully decoupled from numbering eligibility/value.
 */

import { chapterFromHeadingNumber, sectionFromHeadingNumber } from './heading-context-resolver'

/** v1 numeric-chapter runtime marker (dist marker gate). */
export const OBJECT_NUMBERING_RUNTIME_MARKER = 'OBJECT-NUMBERING-NUMERIC-MODES-V1'

/** v2 preset-UI runtime marker (dist marker gate). */
export const OBJECT_NUMBERING_PRESET_UI_V2_MARKER = 'OBJECT-NUMBERING-PRESET-UI-V2'

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

/** v1 numeric-chapter scope: the reset granularity for object numbering. */
export type ObjectNumberingScope = 'document' | 'chapter' | 'section' | 'subsection'

/** v2 stable preset IDs (UI authority; template variables stay internal). */
export type ObjectNumberingPreset =
  | 'continuous'
  | 'chapter-dot'
  | 'chapter-dash'
  | 'section-dot'
  | 'section-dash'

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
  /** v1 numeric-chapter scope (authoritative; `numberingMode` is legacy). */
  scope?: ObjectNumberingScope
  /** v2 stable preset id. When present, scope/template are derived from it. */
  preset?: ObjectNumberingPreset
  /** v2 legacy custom flag: unmappable custom format kept for compatibility. */
  legacyCustomFormat?: boolean
  resetHeadingLevel?: 1 | 2 | 3
  customExpression?: string
  /** formula only: native vs inkchapter numbering implementation. */
  formulaMode?: 'typora-native' | 'inkchapter'
}

export interface HeadingContext {
  h1?: string
  h2?: string
  h3?: string
  /** Structured numeric ordinals (authority for {chapter}/{section}/{subsection}). */
  chapterOrdinal?: number | null
  sectionOrdinal?: number | null
  subsectionOrdinal?: number | null
  /** v2.5.5: stable heading identity for scope-reset keys. */
  chapterHeadingId?: string | null
  sectionHeadingId?: string | null
  subsectionHeadingId?: string | null
}

/** Numeric chapter/section/subsection context used by the v1 engine. */
export interface ObjectNumberingContext {
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  subsectionOrdinal: number | null
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
  subsection?: string
  type?: string
}

export interface NumberingResult {
  type: ObjectNumberingType
  sequenceValue: number
  formattedSequence: string
  renderedNumber: string
  label: string
  /** v2.5.5: scope reset key used for this target (section identity bound). */
  scopeKey?: string
  /** v2.5.5: whether the counter reset on this target. */
  resetApplied?: boolean
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
      // minDigits pads the {n} token (1 → 1, 2 → 01, 3 → 001).
      return minDigits > 1 ? String(v).padStart(Math.max(1, minDigits), '0') : String(v)
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
    .replace(/\{subsection\}/g, context.subsection ?? '0')
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
    if (!['{n}', '{chapter}', '{section}', '{subsection}', '{type}'].includes(m[1])) {
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
  /** Document key (diagnostic only; used in OBJECT-NUMBERING-CONTEXT log). */
  documentKey?: string
}

/** Map a legacy `numberingMode` to the v1 numeric scope. */
export function scopeFromNumberingMode(mode: NumberingMode): ObjectNumberingScope {
  switch (mode) {
    case 'reset-h1':
    case 'chapter-linked':
      return 'chapter'
    case 'reset-h2':
      return 'section'
    case 'reset-h3':
      return 'subsection'
    default:
      return 'document'
  }
}

/** Resolve a config's effective scope (scope field wins; numberingMode is legacy). */
export function resolveScope(config: ObjectNumberingConfig): ObjectNumberingScope {
  if (config.scope === 'document' || config.scope === 'chapter' || config.scope === 'section' || config.scope === 'subsection') {
    return config.scope
  }
  return scopeFromNumberingMode(config.numberingMode)
}

/** Default template per resolved scope (formula wraps the core template). */
export function defaultTemplateFor(scope: ObjectNumberingScope, type: ObjectNumberingType): string {
  const core =
    scope === 'chapter' ? '{chapter}.{n}'
    : scope === 'section' ? '{chapter}.{section}.{n}'
    : scope === 'subsection' ? '{chapter}.{section}.{subsection}.{n}'
    : '{n}'
  return type === 'formula' ? `(${core})` : core
}

/** Extract numeric ordinals from a heading context (numeric fields win; strings fallback). */
export function ordinalsFromContext(ctx: HeadingContext | undefined): ObjectNumberingContext {
  const c = ctx ?? {}
  if (c.chapterOrdinal != null || c.sectionOrdinal != null || c.subsectionOrdinal != null) {
    return {
      chapterOrdinal: c.chapterOrdinal ?? null,
      sectionOrdinal: c.sectionOrdinal ?? null,
      subsectionOrdinal: c.subsectionOrdinal ?? null,
    }
  }
  const toOrd = (s: string | undefined): number | null => {
    if (s === undefined || s === '') return null
    const n = parseInt(s, 10)
    return Number.isFinite(n) && n >= 1 ? n : null
  }
  return {
    chapterOrdinal: toOrd(chapterFromHeadingNumber(c.h1)),
    sectionOrdinal: toOrd(sectionFromHeadingNumber(c.h2)),
    subsectionOrdinal: toOrd(sectionFromHeadingNumber(c.h3)),
  }
}

function scopeSatisfied(scope: ObjectNumberingScope, o: ObjectNumberingContext): boolean {
  switch (scope) {
    case 'chapter': return o.chapterOrdinal != null
    case 'section': return o.chapterOrdinal != null && o.sectionOrdinal != null
    case 'subsection': return o.chapterOrdinal != null && o.sectionOrdinal != null && o.subsectionOrdinal != null
    default: return true
  }
}

export interface ResolvedScopeResult {
  scope: ObjectNumberingScope
  fallback: boolean
  reason: string | null
}

/** Fall back subsection → section → chapter → document when ordinals are missing. */
export function resolveObjectNumberingScope(
  requested: ObjectNumberingScope,
  ordinals: ObjectNumberingContext,
): ResolvedScopeResult {
  const order: ObjectNumberingScope[] = ['subsection', 'section', 'chapter', 'document']
  let idx = order.indexOf(requested)
  if (idx < 0) idx = order.indexOf('document')
  for (let i = idx; i < order.length; i++) {
    const scope = order[i]
    if (scopeSatisfied(scope, ordinals)) {
      return { scope, fallback: scope !== requested, reason: scope !== requested ? fallbackReason(requested) : null }
    }
  }
  return { scope: 'document', fallback: true, reason: 'NO_CONTEXT' }
}

function fallbackReason(requested: ObjectNumberingScope): string {
  switch (requested) {
    case 'subsection': return 'NO_SUBSECTION_CONTEXT'
    case 'section': return 'NO_SECTION_CONTEXT'
    case 'chapter': return 'NO_CHAPTER_CONTEXT'
    default: return 'NO_HEADING_CONTEXT'
  }
}

// ── Context readiness authority (v2.5.3) ────────────────────────────

export type ObjectNumberingReadinessState = 'READY' | 'PARTIAL' | 'NOT_READY'
export type ObjectNumberingReadinessDecision = 'READY' | 'NOT_READY'

export interface ObjectNumberingReadiness {
  contextState: ObjectNumberingReadinessState
  decision: ObjectNumberingReadinessDecision
  requiredFields: string[]
  missingFields: string[]
  reason: string | null
}

/**
 * Decide whether a target has enough structured heading context for its
 * requested scope. A section-scoped target missing a section ordinal must NEVER
 * be reported READY (false-ready is forbidden by v2.5.3).
 */
export function resolveObjectNumberingReadiness(input: {
  documentKey: string | null
  requestedScope: ObjectNumberingScope
  ordinals: ObjectNumberingContext
}): ObjectNumberingReadiness {
  const { documentKey, requestedScope, ordinals } = input

  const requiredFields: string[] = ['documentKey']
  if (requestedScope === 'chapter' || requestedScope === 'section' || requestedScope === 'subsection') {
    requiredFields.push('chapterOrdinal')
  }
  if (requestedScope === 'section' || requestedScope === 'subsection') {
    requiredFields.push('sectionOrdinal')
  }
  if (requestedScope === 'subsection') {
    requiredFields.push('subsectionOrdinal')
  }

  const missingFields: string[] = []
  if (!documentKey) missingFields.push('documentKey')
  if (requestedScope === 'chapter' || requestedScope === 'section' || requestedScope === 'subsection') {
    if (ordinals.chapterOrdinal == null) missingFields.push('chapterOrdinal')
  }
  if (requestedScope === 'section' || requestedScope === 'subsection') {
    if (ordinals.sectionOrdinal == null) missingFields.push('sectionOrdinal')
  }
  if (requestedScope === 'subsection') {
    if (ordinals.subsectionOrdinal == null) missingFields.push('subsectionOrdinal')
  }

  if (missingFields.length === 0) {
    return { contextState: 'READY', decision: 'READY', requiredFields, missingFields: [], reason: null }
  }

  const reason = missingFields.includes('documentKey')
    ? 'MISSING_DOCUMENT_KEY'
    : missingFields.includes('chapterOrdinal')
      ? 'MISSING_CHAPTER_ORDINAL'
      : missingFields.includes('sectionOrdinal')
        ? 'MISSING_SECTION_ORDINAL'
        : 'MISSING_SUBSECTION_ORDINAL'

  // documentKey present but ordinals missing → PARTIAL (still NOT_READY for gates).
  const contextState: ObjectNumberingReadinessState = !documentKey ? 'NOT_READY' : 'PARTIAL'
  return { contextState, decision: 'NOT_READY', requiredFields, missingFields, reason }
}

/** Render the object number from resolved scope + ordinals + padded sequence n. */
export function formatObjectNumber(
  config: ObjectNumberingConfig,
  type: ObjectNumberingType,
  ordinals: ObjectNumberingContext,
  n: string,
  requestedScope: ObjectNumberingScope,
  resolvedScope: ObjectNumberingScope,
): string {
  const template = requestedScope === resolvedScope
    ? (config.template && config.template.trim() !== '' ? config.template : defaultTemplateFor(resolvedScope, type))
    : defaultTemplateFor(resolvedScope, type)
  const rendered = renderNumberTemplate(template, {
    n,
    chapter: ordinals.chapterOrdinal != null ? String(ordinals.chapterOrdinal) : '',
    section: ordinals.sectionOrdinal != null ? String(ordinals.sectionOrdinal) : '',
    subsection: ordinals.subsectionOrdinal != null ? String(ordinals.subsectionOrdinal) : '',
  })
  // Formula parens are the formatter's responsibility (never the user's template).
  return type === 'formula' ? wrapFormulaNumber(rendered) : rendered
}

function wrapFormulaNumber(rendered: string): string {
  const trimmed = rendered.trim()
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return trimmed
  return `(${trimmed})`
}

function scopeResetKey(
  type: ObjectNumberingType,
  scope: ObjectNumberingScope,
  ordinals: ObjectNumberingContext,
  headingIds: { chapterHeadingId?: string | null; sectionHeadingId?: string | null; subsectionHeadingId?: string | null },
  documentKey?: string,
): string {
  const doc = documentKey ?? 'none'
  const ch = headingIds.chapterHeadingId ?? (ordinals.chapterOrdinal != null ? `ord:${ordinals.chapterOrdinal}` : 'none')
  const sec = headingIds.sectionHeadingId ?? (ordinals.sectionOrdinal != null ? `ord:${ordinals.sectionOrdinal}` : 'none')
  const sub = headingIds.subsectionHeadingId ?? (ordinals.subsectionOrdinal != null ? `ord:${ordinals.subsectionOrdinal}` : 'none')
  switch (scope) {
    case 'chapter': return `${type}|chapter|${doc}|${ch}`
    case 'section': return `${type}|section|${doc}|${ch}|${sec}`
    case 'subsection': return `${type}|subsection|${doc}|${ch}|${sec}|${sub}`
    default: return `${type}|document|${doc}`
  }
}

/**
 * Compute per-target sequence values + rendered numbers + labels.
 * Each type has an INDEPENDENT sequence. Scope controls reset points via the
 * numeric chapter/section/subsection ordinals (with subsection→section→chapter
 * →document fallback). Name never influences numbering.
 */
export function computeObjectNumbers(
  targets: NumberingTarget[],
  options: ComputeObjectNumbersOptions,
): NumberingResult[] {
  const { configs, headingContext = {}, documentKey } = options
  const counters: Partial<Record<ObjectNumberingType, number>> = {}
  const lastKey: Partial<Record<ObjectNumberingType, string>> = {}
  const presetLogged = new Set<ObjectNumberingType>()

  return targets.map(target => {
    const type = target.type
    const config = configs[type] ?? DEFAULT_OBJECT_NUMBERING_CONFIG[type]
    const ctx: HeadingContext = target.headingContext ?? headingContext
    const ordinals = ordinalsFromContext(ctx)
    const requestedScope = resolveScope(config)
    const resolved = resolveObjectNumberingScope(requestedScope, ordinals)

    if (!presetLogged.has(type)) {
      presetLogged.add(type)
      console.info(
        `[InkChapter Numbering] OBJECT-NUMBERING-PRESET type=${type} preset=${config.preset ?? 'none'} ` +
        `scope=${requestedScope} internalFormat=${JSON.stringify(config.template)} startAt=${config.startAt} ` +
        `minDigits=${config.minDigits} ` +
        `decision=${config.preset ? 'PRESET' : (config.legacyCustomFormat ? 'LEGACY_CUSTOM' : 'RESOLVED')} ` +
        `runtimeMarker=${OBJECT_NUMBERING_PRESET_UI_V2_MARKER}`,
      )
    }

    if (resolved.fallback) {
      console.info(
        `[InkChapter Numbering] OBJECT-NUMBERING-SCOPE-FALLBACK type=${type} ` +
        `requestedScope=${requestedScope} resolvedScope=${resolved.scope} reason=${resolved.reason}`,
      )
    }

    const key = scopeResetKey(type, resolved.scope, ordinals, {
      chapterHeadingId: ctx.chapterHeadingId,
      sectionHeadingId: ctx.sectionHeadingId,
      subsectionHeadingId: ctx.subsectionHeadingId,
    }, documentKey)
    const resetApplied = key !== lastKey[type] || counters[type] === undefined
    if (resetApplied) {
      counters[type] = config.startAt - 1
    }
    const sequenceValue = (counters[type] ?? 0) + 1
    counters[type] = sequenceValue
    lastKey[type] = key

    const formattedSequence = formatSequenceNumber(sequenceValue, config.numberStyle, config.minDigits)
    const renderedNumber = formatObjectNumber(config, type, ordinals, formattedSequence, requestedScope, resolved.scope)

    console.info(
      `[InkChapter Numbering] OBJECT-NUMBERING-CONTEXT type=${type} documentKey=${documentKey ?? 'none'} ` +
      `requestedScope=${requestedScope} resolvedScope=${resolved.scope} ` +
      `chapterOrdinal=${ordinals.chapterOrdinal ?? 'none'} sectionOrdinal=${ordinals.sectionOrdinal ?? 'none'} ` +
      `subsectionOrdinal=${ordinals.subsectionOrdinal ?? 'none'} sequenceValue=${sequenceValue} ` +
      `formattedSequence=${formattedSequence} format=${config.template} ` +
      `scopeKey=${key} resetApplied=${resetApplied} ` +
      `runtimeMarker=${OBJECT_NUMBERING_RUNTIME_MARKER} decision=RESOLVED`,
    )

    const label = buildObjectNumberingLabel(config.prefix, renderedNumber, target.name ?? '')
    return { type, sequenceValue, formattedSequence, renderedNumber, label, scopeKey: key, resetApplied }
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

/** Render a preview label via the SAME runtime formatter (never a separate UI formatter). */
export function renderNumberingPreview(
  type: ObjectNumberingType,
  config: ObjectNumberingConfig,
  sample: { n?: number; chapter?: string; section?: string; subsection?: string; chapterOrdinal?: number; sectionOrdinal?: number; subsectionOrdinal?: number; name?: string },
): string {
  const cfg = { ...DEFAULT_OBJECT_NUMBERING_CONFIG[type], ...config }
  const n = sample.n ?? 1
  const formatted = formatSequenceNumber(n, cfg.numberStyle, cfg.minDigits)
  const toOrd = (s: string | undefined): number | null => {
    if (s === undefined || s === '') return null
    const p = parseInt(s, 10)
    return Number.isFinite(p) ? p : null
  }
  const ordinals: ObjectNumberingContext = {
    chapterOrdinal: sample.chapterOrdinal ?? toOrd(sample.chapter) ?? 2,
    sectionOrdinal: sample.sectionOrdinal ?? toOrd(sample.section) ?? 3,
    subsectionOrdinal: sample.subsectionOrdinal ?? toOrd(sample.subsection) ?? 4,
  }
  const requestedScope = resolveScope(cfg)
  const resolved = resolveObjectNumberingScope(requestedScope, ordinals)
  const rendered = formatObjectNumber(cfg, type, ordinals, formatted, requestedScope, resolved.scope)
  return buildObjectNumberingLabel(cfg.prefix, rendered, sample.name ?? '')
}
