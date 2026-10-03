/**
 * V5.14-R5 — Diagnostic INLINE PRESENTATION (short semantic layer).
 *
 * ROOT_R5_1 = the inline reason chip REUSED the full diagnostic title / message.
 * ROOT_R5_2 = there was no dedicated short semantic label for the INLINE surface.
 * ROOT_R5_3 = the severity prefix / icon was EMBEDDED in the inline text (the
 *   strict validator's own `message` starts with `⚠ 严格模式结构错误：…`, and the
 *   unmapped-code fallback sliced that very string).
 * ROOT_R5_4 = the inline label was TRUNCATED from long text instead of being
 *   GENERATED from the DiagnosticCode.
 * ROOT_R5_5 = the reason-chip geometry could reuse an OLD width after the inline
 *   label became shorter (the chip rect was a `16 + len * 7` ESTIMATE, never the
 *   rendered width).
 *
 * The presentation layer is a pure, deterministic
 *   DiagnosticCode -> inlineHint
 * mapping. It NEVER derives the hint from the Chinese message text (no reverse
 * inference, no `message.slice`), and it NEVER mutates the diagnostic business
 * facts (`code` / `severity` / `title` / `message`) or the Drawer copy.
 *
 * Pure contract: no DOM, no host state.
 */

export type DiagnosticSeverityLike = 'error' | 'warning' | 'info'

/** Where the inline hint came from (audited; known codes must never fall back). */
export type InlineHintSource = 'MAPPED' | 'DYNAMIC' | 'CATEGORY_FALLBACK' | 'MESSAGE_FALLBACK'

export interface DiagnosticPresentation {
  /** The SHORT in-document label (what the body chip shows). */
  inlineHint: string
  /** The Drawer heading — the FULL diagnostic message (never compressed here). */
  drawerTitle: string
  /** The Drawer body — the FULL explanation / advice (never compressed here). */
  drawerDetail: string | null
  inlineHintSource: InlineHintSource
}

export interface DiagnosticPresentationInput {
  code: string
  severity?: string | null
  message?: string | null
  detail?: string | null
  category?: string | null
  metadata?: Record<string, unknown> | null
}

// ── §9/§10 — the inline chip budget ─────────────────────────────────────────

/** §9 — fallback clamp only; the primary fix is the short semantic mapping. */
export const INLINE_CHIP_MAX_WIDTH_PX_V514R5 = 168
/** §9 — the chip padding per side (inline-flex, min-height 20px). */
export const INLINE_CHIP_PADDING_PX_V514R5 = 7
/** §9 — a per-character advance estimate (CJK ≈ 1em, latin ≈ 0.5em). */
export const INLINE_CHIP_CJK_ADVANCE_PX_V514R5 = 13
export const INLINE_CHIP_LATIN_ADVANCE_PX_V514R5 = 7
/** §9 — 常规 4~10 个汉字左右；动态结构允许略长。 */
export const INLINE_HINT_MAX_CHARS_V514R5 = 10
export const INLINE_HINT_DYNAMIC_MAX_CHARS_V514R5 = 18

/**
 * §7 — tokens that must NEVER appear inside the inline chip: severity is already
 * expressed by the fill colour / brightness, so the text must stay severity-free.
 */
export const INLINE_HINT_FORBIDDEN_TOKENS_V514R5 = [
  '⚠', '❌', '⛔', '🔴', '🟡', '错误', '警告', '提示', 'Error', 'Warning',
  '严格模式结构错误', '建议', '请', '当前检测到', '当前文档', '文档必须',
] as const

/** §7/§21 — the exact severity prefixes that must never lead an inline hint. */
export const INLINE_HINT_SEVERITY_PREFIXES_V514R5 = ['⚠', '❌', '错误：', '警告：', '提示：', 'Error:', 'Warning:'] as const

/**
 * §7 — severity emoji / pictographs anywhere in the hint. The ARROW block
 * (U+2190–U+21FF) is deliberately EXCLUDED: `→` is a legitimate structural glyph
 * of the heading-gap hint (`H3 → H5 · 缺 H4`), not a severity symbol.
 */
const EMOJI_RE = /[\u2600-\u27BF\u2B00-\u2BFF\uFE0F\uD83C-\uDBFF\uDC00-\uDFFF]/

// ── §4/§5 — the deterministic DiagnosticCode -> inlineHint table ────────────

const INLINE_HINT_BY_CODE_V514R5: Readonly<Record<string, string>> = {
  // strict first-H1 top-line family (`STRICT_FIRST_H1_<documentStartState>`)
  STRICT_FIRST_H1_LEADING_PARAGRAPH: 'H1 前有正文',
  STRICT_FIRST_H1_LEADING_EMPTY_LINE: 'H1 前有空行',
  STRICT_FIRST_H1_LEADING_EMPTY_BLOCK: 'H1 前有空段落',
  STRICT_FIRST_H1_LEADING_OTHER_HEADING: 'H1 非首项',
  STRICT_FIRST_H1_LEADING_OTHER_BLOCK: 'H1 前有其他内容',
  STRICT_FIRST_H1_DOCUMENT_EMPTY: '缺少 H1',
  STRICT_FIRST_H1_SOURCE_UNAVAILABLE: '无法校验 H1',
  // strict single-H1 family
  STRICT_SINGLE_H1_NO_H1: '缺少 H1',
  STRICT_SINGLE_H1_MULTIPLE_H1: '多余 H1',
  // heading structure
  HEADING_DUPLICATE_TEXT: '重复标题',
  HEADING_DUPLICATE_IDENTITY: '重复标题身份',
  HEADING_EMPTY_TEXT: '空标题',
  // Heading Auto-Number Conflict V1 §27 — the short chip for the heading
  // auto-number conflict (existing heading-Error presentation, no new style).
  HEADING_AUTO_NUMBER_CONFLICT: '编号冲突',
  // objects
  TABLE_MISSING_NAME: '缺少表名',
  TABLE_DUPLICATE_NAME: '重复表名',
  CODE_MISSING_NAME: '缺少代码名',
  CODE_MISSING_LANGUAGE: '缺少代码语言',
  CODE_DUPLICATE_NAME: '重复代码名',
  FIGURE_MISSING_NAME: '缺少图名',
  FIGURE_DUPLICATE_NAME: '重复图名',
  FIGURE_LOCAL_IMAGE_MISSING: '图片不存在',
  FORMULA_DUPLICATE_VISIBLE_TAG: '重复公式编号',
  LINK_LOCAL_TARGET_MISSING: '链接不存在',
  // document end / lifecycle
  DOCUMENT_TERMINAL_NEWLINE_MISSING: '末尾缺少换行',
  DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE: '尾部空行过多',
  DOCUMENT_INACTIVE: '无活动文档',
  // V1 — 单标题无正文 (document completeness hint)
  DOCUMENT_HEADING_ONLY_NO_BODY: '仅有标题',
}

function prefixHintForCode(code: string): string | null {
  if (code.startsWith('LATENT_ATX_HEADING_MARKER')) return '潜在标题标记'
  if (code.startsWith('STRICT_FIRST_H1_')) return 'H1 非首项'
  return null
}

/** §17 — the stable short category label used when a code has no mapping yet. */
export function inlineHintCategoryForCode(code: string, category?: string | null): string {
  const c = String(category ?? '').toLowerCase()
  if (c === 'heading') return '标题问题'
  if (c === 'table' || c === 'code' || c === 'figure' || c === 'formula' || c === 'link') return '资源问题'
  if (c === 'document') return '结构问题'
  if (code.startsWith('HEADING_') || code.startsWith('LATENT_ATX_')) return '标题问题'
  if (code.startsWith('STRICT_')) return '结构问题'
  if (code.startsWith('TABLE_') || code.startsWith('CODE_') || code.startsWith('FIGURE_')
    || code.startsWith('FORMULA_') || code.startsWith('IMAGE_') || code.startsWith('LINK_')) return '资源问题'
  if (code.startsWith('DOCUMENT_')) return '结构问题'
  return '文档问题'
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * §6 — the DYNAMIC short phrase. It keeps the CRITICAL facts (the two levels and
 * the missing one) and drops the sentence, the count and the advice.
 */
export function buildHeadingGapInlineHint(metadata: Record<string, unknown> | null | undefined): string | null {
  const meta = metadata ?? {}
  const prev = num(meta.previousLevel)
  const cur = num(meta.currentLevel)
  if (prev == null || cur == null) return null
  const missing = Array.isArray(meta.missingLevels)
    ? (meta.missingLevels as unknown[]).map(n => num(n)).filter((n): n is number => n != null)
    : []
  const missLabel = missing.length > 0 ? missing.map(l => `H${l}`).join('、') : null
  return missLabel ? `H${prev} → H${cur} · 缺 ${missLabel}` : `H${prev} → H${cur}`
}

/**
 * §3/§4/§5/§6 — the ONE inline-hint authority: a DETERMINISTIC mapping from the
 * DiagnosticCode (plus explicit structured metadata), never a text transform.
 */
export function resolveInlineHint(input: DiagnosticPresentationInput): { hint: string; source: InlineHintSource } {
  const code = String(input.code ?? '')
  const meta = input.metadata ?? {}
  // §6 — DYNAMIC structural facts first (they carry the most useful numbers).
  if (code === 'HEADING_LEVEL_GAP') {
    const dynamic = buildHeadingGapInlineHint(meta)
    if (dynamic) return { hint: dynamic, source: 'DYNAMIC' }
  }
  if (meta.reason === 'H1_NOT_FIRST') return { hint: 'H1 非首项', source: 'MAPPED' }
  const mapped = INLINE_HINT_BY_CODE_V514R5[code]
  if (mapped) return { hint: mapped, source: 'MAPPED' }
  const byPrefix = prefixHintForCode(code)
  if (byPrefix) return { hint: byPrefix, source: 'MAPPED' }
  // §17 — an UNMAPPED code gets a stable short CATEGORY label (never the message).
  const category = inlineHintCategoryForCode(code, input.category ?? null)
  if (category) return { hint: category, source: 'CATEGORY_FALLBACK' }
  // last resort only: a hard-clamped message slice (audited as MESSAGE_FALLBACK)
  const msg = String(input.message ?? '').trim()
  if (!msg) return { hint: '文档问题', source: 'CATEGORY_FALLBACK' }
  return { hint: msg.slice(0, INLINE_HINT_MAX_CHARS_V514R5), source: 'MESSAGE_FALLBACK' }
}

/**
 * §8 — the Drawer is NOT compressed to 4~10 characters. Only the strict
 * first-H1 family needs a concise TITLE because its own `message` is a
 * multi-line sentence with a severity glyph; the full sentence then moves to
 * the DETAIL so nothing is lost.
 */
const DRAWER_TITLE_BY_CODE_V514R5: Readonly<Record<string, string>> = {
  STRICT_FIRST_H1_LEADING_PARAGRAPH: 'H1 前存在正文',
  STRICT_FIRST_H1_LEADING_EMPTY_LINE: 'H1 前存在空行',
  STRICT_FIRST_H1_LEADING_EMPTY_BLOCK: 'H1 前存在空段落',
  STRICT_FIRST_H1_LEADING_OTHER_HEADING: 'H1 不是文档首项',
  STRICT_FIRST_H1_LEADING_OTHER_BLOCK: 'H1 前存在其他内容',
  STRICT_FIRST_H1_DOCUMENT_EMPTY: '文档缺少 H1',
  STRICT_FIRST_H1_SOURCE_UNAVAILABLE: '无法校验 H1',
}

/** §8 — turn a multi-line diagnostic message into a single-line full detail. */
export function buildDrawerDetailFromMessage(message: string): string {
  return String(message ?? '')
    .replace(/^\s*[⚠❌⛔]\s*/, '')
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim()
}

/**
 * §3/§8 — the ONE presentation authority. The Drawer keeps the FULL message +
 * detail; only the inline surface is compressed.
 */
export function buildDiagnosticPresentation(input: DiagnosticPresentationInput): DiagnosticPresentation {
  const code = String(input.code ?? '')
  const { hint, source } = resolveInlineHint(input)
  const message = String(input.message ?? '').trim()
  const explicitDetail = String(input.detail ?? '').trim()
  const drawerTitleOverride = DRAWER_TITLE_BY_CODE_V514R5[code] ?? null
  return {
    inlineHint: hint,
    drawerTitle: drawerTitleOverride ?? message ?? inlineHintCategoryForCode(code, input.category ?? null),
    // §8 — the FULL explanation is never dropped: an override title promotes the
    // message to the detail, otherwise the explicit detail stays authoritative.
    drawerDetail: explicitDetail
      || (drawerTitleOverride != null && message !== '' ? buildDrawerDetailFromMessage(message) : null)
      || null,
    inlineHintSource: source,
  }
}

// ── §7/§21 — text safety ────────────────────────────────────────────────────

/** §7 — does the hint carry a severity PREFIX (⚠ / 错误： …)? */
export function inlineHintHasSeverityPrefix(hint: string): boolean {
  const t = String(hint ?? '').trim()
  return INLINE_HINT_SEVERITY_PREFIXES_V514R5.some(p => t.startsWith(p))
}

/** §7 — does the hint carry a severity emoji anywhere? */
export function inlineHintHasSeverityEmoji(hint: string): boolean {
  return EMOJI_RE.test(String(hint ?? ''))
}

/**
 * §21 — the full text-safety contract for a known inline hint: no severity
 * prefix / emoji, single line, no advice sentence, no "当前检测到…" narrative.
 */
export function inlineHintIsSafe(hint: string): boolean {
  const t = String(hint ?? '')
  if (t.trim() === '') return false
  if (inlineHintHasSeverityPrefix(t)) return false
  if (inlineHintHasSeverityEmoji(t)) return false
  if (/[\r\n]/.test(t)) return false
  return !INLINE_HINT_FORBIDDEN_TOKENS_V514R5.some(token => t.includes(token))
}

/** §10 — the intrinsic text width estimate used for PLACEMENT (never for paint). */
export function computeInlineChipWidthPx(hint: string): number {
  const t = String(hint ?? '')
  let advance = 0
  for (const ch of t) {
    advance += /[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch)
      ? INLINE_CHIP_CJK_ADVANCE_PX_V514R5
      : INLINE_CHIP_LATIN_ADVANCE_PX_V514R5
  }
  const raw = advance + INLINE_CHIP_PADDING_PX_V514R5 * 2
  return Math.max(24, Math.min(INLINE_CHIP_MAX_WIDTH_PX_V514R5, raw))
}

/** §10/§11 — the audit geometry facts for one chip. */
export function evaluateInlineChipGeometry(input: {
  hint: string
  renderedWidthPx: number | null
  previousRenderedWidthPx?: number | null
}): { intrinsicWidthPx: number; renderedWidthPx: number; clamped: boolean; shrank: boolean } {
  const intrinsicWidthPx = computeInlineChipWidthPx(input.hint)
  const renderedWidthPx = input.renderedWidthPx ?? intrinsicWidthPx
  return {
    intrinsicWidthPx,
    renderedWidthPx,
    clamped: renderedWidthPx >= INLINE_CHIP_MAX_WIDTH_PX_V514R5 - 0.5,
    shrank: input.previousRenderedWidthPx != null && renderedWidthPx < input.previousRenderedWidthPx - 0.5,
  }
}

// ── §19 — the V5.14-R5 inline-presentation hard gates (all must be 0) ───────

export const INLINE_PRESENTATION_V514R5_GATE_KEYS = [
  'inlineReasonUsesFullDiagnosticMessage',
  'inlineReasonUsesFullDiagnosticTitleWhenMapped',
  'inlineReasonContainsSeverityPrefix',
  'inlineReasonContainsSeverityEmoji',
  'knownDiagnosticWithoutInlineHintMapping',
  'inlineReasonStaleWidthAfterLabelChange',
  'inlineReasonFixedWidth',
  'outlineReasonChip',
  'inlinePresentationMutatedHeadingText',
  'inlinePresentationMutatedHeadingNumber',
  'passiveActiveRegression',
  'diagnosticDocumentOrderRegression',
] as const

export type InlinePresentationV514R5GateKey = typeof INLINE_PRESENTATION_V514R5_GATE_KEYS[number]

export const INLINE_PRESENTATION_V514R5_GATE_LABELS: Readonly<Record<InlinePresentationV514R5GateKey, string>> = {
  inlineReasonUsesFullDiagnosticMessage: 'INLINE_REASON_USES_FULL_DIAGNOSTIC_MESSAGE_COUNT',
  inlineReasonUsesFullDiagnosticTitleWhenMapped: 'INLINE_REASON_USES_FULL_DIAGNOSTIC_TITLE_WHEN_MAPPED_COUNT',
  inlineReasonContainsSeverityPrefix: 'INLINE_REASON_CONTAINS_SEVERITY_PREFIX_COUNT',
  inlineReasonContainsSeverityEmoji: 'INLINE_REASON_CONTAINS_SEVERITY_EMOJI_COUNT',
  knownDiagnosticWithoutInlineHintMapping: 'KNOWN_DIAGNOSTIC_WITHOUT_INLINE_HINT_MAPPING_COUNT',
  inlineReasonStaleWidthAfterLabelChange: 'INLINE_REASON_STALE_WIDTH_AFTER_LABEL_CHANGE_COUNT',
  inlineReasonFixedWidth: 'INLINE_REASON_FIXED_WIDTH_COUNT',
  outlineReasonChip: 'OUTLINE_REASON_CHIP_COUNT',
  inlinePresentationMutatedHeadingText: 'INLINE_PRESENTATION_MUTATED_HEADING_TEXT_COUNT',
  inlinePresentationMutatedHeadingNumber: 'INLINE_PRESENTATION_MUTATED_HEADING_NUMBER_COUNT',
  passiveActiveRegression: 'PASSIVE_ACTIVE_REGRESSION_COUNT',
  diagnosticDocumentOrderRegression: 'DIAGNOSTIC_DOCUMENT_ORDER_REGRESSION_COUNT',
}

export type InlinePresentationV514R5Counters = Record<InlinePresentationV514R5GateKey, number>

export function createInlinePresentationV514R5Counters(): InlinePresentationV514R5Counters {
  return INLINE_PRESENTATION_V514R5_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as InlinePresentationV514R5Counters)
}

export function formatInlinePresentationV514R5GateReport(
  counters: Readonly<InlinePresentationV514R5Counters>,
): string[] {
  return INLINE_PRESENTATION_V514R5_GATE_KEYS.map(
    key => `${INLINE_PRESENTATION_V514R5_GATE_LABELS[key]}=${counters[key] ?? 0}`,
  )
}

export function evaluateInlinePresentationV514R5Gates(
  counters: Readonly<InlinePresentationV514R5Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: InlinePresentationV514R5GateKey[] } {
  const failedChecks = INLINE_PRESENTATION_V514R5_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §18 — the ONE inline-presentation runtime audit. */
export const DOCUMENT_DIAGNOSTIC_INLINE_PRESENTATION_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-INLINE-PRESENTATION-AUDIT'
