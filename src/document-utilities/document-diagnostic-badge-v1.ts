/**
 * R14 — 正文诊断徽章展示模型（纯契约）。
 *
 * 职责单一：把「一份真实诊断」转换成正文徽章需要的展示事实：
 *   - 具体短文案（禁止“标题问题”等泛化分类）
 *   - 完整标题 / 一句说明 / 真实行号（tooltip 与无障碍标签）
 *   - 严重级别与稳定优先级
 *   - 同标题语义去重 + 稳定排序 + “两个具体徽章 + `+N`”聚合
 *
 * 这里不产生任何诊断，也不读取 DOM：正文徽章与中央检测面板消费的是
 * `DocumentDiagnosticsSnapshot` 里的同一份诊断（同一 diagnosticId / 行号 /
 * 修复状态），本模块只做展示层映射。
 */

import { buildDiagnosticPresentation, inlineHintIsSafe, resolveInlineHint } from './document-diagnostic-inline-presentation-v514-r5'

export type DiagnosticBadgeSeverity = 'error' | 'warning' | 'info'

export interface DiagnosticBadgeInput {
  diagnosticId: string
  code: string
  severity?: string | null
  message?: string | null
  detail?: string | null
  category?: string | null
  metadata?: Record<string, unknown> | null
  /** 1-based real source line (from the heading element / diagnostic location). */
  line?: number | null
  /** The heading's source text — used by the dynamic “重复标题：xxx” label. */
  headingText?: string | null
  targetIdentity?: string | null
}

export interface DiagnosticBadge {
  diagnosticId: string
  code: string
  severity: DiagnosticBadgeSeverity
  shortLabel: string
  fullTitle: string
  description: string
  line: number | null
  targetIdentity: string
  priority: number
  semanticKey: string
  labelSource: 'MAPPED' | 'DYNAMIC' | 'DERIVED'
}

export interface DiagnosticBadgeSummary {
  kind: 'summary'
  label: string
  count: number
}

export interface DiagnosticBadgeSet {
  /** Badges that must be painted (max 2 specific badges). */
  visible: DiagnosticBadge[]
  /** Every distinct badge of this heading, stable-sorted (incl. hidden ones). */
  all: DiagnosticBadge[]
  /** Number of distinct diagnostics NOT painted directly. */
  hiddenCount: number
  /** Summary badge (`+N`) or null when nothing is hidden. */
  summary: DiagnosticBadgeSummary | null
}

/** 正文徽章禁止出现的泛化文案（R14 §5.2）。 */
export const R14_GENERIC_BADGE_LABELS = [
  '标题问题',
  '文档问题',
  '编号问题',
  '格式问题',
  '资源问题',
  '结构问题',
  '存在异常',
  '文档错误',
] as const

export const R14_MAX_BADGE_LABEL_CHARS = 12
export const R14_MAX_DUPLICATE_TITLE_CHARS = 6
export const R14_MAX_BADGES_BEFORE_SUMMARY = 2

/**
 * R14 §6.4 — stable priority bands. Lower number = higher priority.
 * P0 level gap / double number / conflict, P1 order/mismatch/missing,
 * P2 manual/format, P3 duplicate, P4 completeness, P5 everything else.
 */
export const HEADING_BADGE_PRIORITY: Readonly<Record<string, number>> = {
  HEADING_LEVEL_GAP: 0,
  HEADING_DOUBLE_NUMBER_PREFIX: 0,
  HEADING_AUTO_NUMBER_CONFLICT: 0,
  HEADING_NUMBER_SEQUENCE_INVALID: 1,
  HEADING_NUMBER_ORDER_ANOMALY: 1,
  HEADING_NUMBER_MISMATCH: 1,
  HEADING_NUMBER_MISSING: 1,
  HEADING_NUMBER_OWNERSHIP_CONFLICT: 1,
  HEADING_MANUAL_NUMBER_PREFIX: 2,
  HEADING_NUMBER_FORMAT_INCONSISTENT: 2,
  HEADING_DUPLICATE_TEXT: 3,
  HEADING_DUPLICATE_IDENTITY: 3,
  SECTION_EMPTY: 4,
  SECTION_ONLY_SUBHEADINGS: 4,
  DOCUMENT_HEADING_ONLY_NO_BODY: 4,
  DOCUMENT_HEADINGS_ONLY_NO_BODY: 4,
}

/** Explicit R14 short labels. `null` means “not statically mapped”. */
const STATIC_LABEL_BY_CODE: Readonly<Record<string, string | null>> = {
  HEADING_LEVEL_GAP: null, // dynamic: 层级跳级 H3→H5
  HEADING_DUPLICATE_TEXT: null, // dynamic: 重复标题：第一节
  HEADING_DUPLICATE_IDENTITY: '重复标题身份',
  HEADING_EMPTY_TEXT: '空标题',
  HEADING_MANUAL_NUMBER_PREFIX: '手工编号',
  HEADING_AUTO_NUMBER_CONFLICT: '编号冲突',
  HEADING_DOUBLE_NUMBER_PREFIX: '双重编号',
  HEADING_NUMBER_MISMATCH: '编号不一致',
  HEADING_NUMBER_MISSING: '缺少编号',
  HEADING_NUMBER_ORDER_ANOMALY: '编号错序',
  HEADING_NUMBER_SEQUENCE_INVALID: '编号错序',
  HEADING_NUMBER_FORMAT_INCONSISTENT: '编号格式异常',
  HEADING_NUMBER_OWNERSHIP_CONFLICT: '编号归属异常',
  HEADING_ANCHOR_COLLISION: '标题锚点冲突',
  LATENT_ATX_HEADING_MARKER: '潜在标题标记',
  OBJECT_NUMBER_SCOPE_MISSING_LEVEL: '编号作用域缺层级',
  DOCUMENT_HEADING_ONLY_NO_BODY: '章节无正文',
  DOCUMENT_HEADINGS_ONLY_NO_BODY: '章节无正文',
  SECTION_EMPTY: '章节无正文',
  SECTION_ONLY_SUBHEADINGS: '仅含子标题',
}

const SEVERITY_RANK: Readonly<Record<DiagnosticBadgeSeverity, number>> = {
  error: 3,
  warning: 2,
  info: 1,
}

export function normalizeBadgeSeverity(severity: unknown): DiagnosticBadgeSeverity {
  const s = String(severity ?? '').toLowerCase()
  if (s === 'error') return 'error'
  if (s === 'warning') return 'warning'
  return 'info'
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function truncateChars(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return `${chars.slice(0, Math.max(1, max - 1)).join('')}…`
}

/** Remove severity glyphs / prefixes / newlines from any candidate label. */
export function sanitizeBadgeLabel(text: string): string {
  return String(text ?? '')
    .replace(/^\s*[⚠❌⛔🔴🟡]\s*/u, '')
    .replace(/^\s*(错误|警告|提示|Error|Warning)[：:]\s*/u, '')
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim()
}

/** A label that carries no usable message is generic (R14 §5.2). */
export function isGenericBadgeLabel(label: string): boolean {
  const text = sanitizeBadgeLabel(label)
  if (text === '') return true
  return R14_GENERIC_BADGE_LABELS.some(g => text === g)
}

function extractDuplicateTitle(input: DiagnosticBadgeInput): string | null {
  const meta = input.metadata ?? {}
  const metaText = typeof meta['headingText'] === 'string' ? meta['headingText'] : null
  if (metaText && metaText.trim() !== '') return metaText.trim()
  const message = String(input.message ?? '')
  const quoted = /[「“"]([^」”"]+)[」”"]/.exec(message)
  if (quoted?.[1]) return quoted[1].trim()
  if (input.headingText && input.headingText.trim() !== '') return input.headingText.trim()
  return null
}

function resolveLevelGapLabel(input: DiagnosticBadgeInput): string | null {
  const meta = input.metadata ?? {}
  const prev = finiteNumber(meta['previousLevel'])
  const cur = finiteNumber(meta['currentLevel'])
  if (prev == null || cur == null) return null
  return `层级跳级 H${prev}→H${cur}`
}

/**
 * Deterministic fallback for a code with no explicit mapping: NEVER a category
 * word. Prefer the rule's own full title, stripped of generic prefixes and
 * hard-clamped to the badge budget.
 */
function deriveLabelFromTitle(fullTitle: string, code: string): string {
  let text = sanitizeBadgeLabel(fullTitle)
  text = text
    .replace(/^标题/, '')
    .replace(/^文档/, '')
    .replace(/问题$/u, '')
    .replace(/异常$/u, '异常')
    .trim()
  if (text === '' || isGenericBadgeLabel(text)) {
    // Last resort: the code itself in a readable form (`HEADING_FOO_BAR` → `FOO BAR`).
    text = code.replace(/^HEADING_/, '').replace(/_/g, ' ').trim()
  }
  return truncateChars(text, R14_MAX_BADGE_LABEL_CHARS)
}

export interface DiagnosticBadgeLabelResult {
  label: string
  source: 'MAPPED' | 'DYNAMIC' | 'DERIVED'
}

/** R14 §5 — the ONE short-label authority for a body badge. */
export function resolveDiagnosticBadgeLabel(input: DiagnosticBadgeInput): DiagnosticBadgeLabelResult {
  const code = String(input.code ?? '')
  if (code === 'HEADING_LEVEL_GAP') {
    const dynamic = resolveLevelGapLabel(input)
    if (dynamic) return { label: dynamic, source: 'DYNAMIC' }
  }
  if (code === 'HEADING_DUPLICATE_TEXT') {
    const title = extractDuplicateTitle(input)
    if (title) {
      return {
        label: `重复标题：${truncateChars(title, R14_MAX_DUPLICATE_TITLE_CHARS)}`,
        source: 'DYNAMIC',
      }
    }
  }
  if (code.startsWith('LATENT_ATX_HEADING_MARKER')) return { label: '潜在标题标记', source: 'MAPPED' }
  if (Object.prototype.hasOwnProperty.call(STATIC_LABEL_BY_CODE, code)) {
    const mapped = STATIC_LABEL_BY_CODE[code]
    if (mapped) return { label: mapped, source: 'MAPPED' }
  }
  // Reuse the existing deterministic per-code hints (strict H1 family, object
  // lint, …) — but NEVER the generic category fallback (“标题问题”).
  const inline = resolveInlineHint({
    code,
    severity: input.severity ?? null,
    message: input.message ?? null,
    detail: input.detail ?? null,
    category: input.category ?? null,
    metadata: (input.metadata ?? {}) as Record<string, unknown>,
  })
  if (inline.source !== 'CATEGORY_FALLBACK' && inline.source !== 'MESSAGE_FALLBACK'
    && inlineHintIsSafe(inline.hint)) {
    return { label: truncateChars(sanitizeBadgeLabel(inline.hint), R14_MAX_BADGE_LABEL_CHARS), source: 'MAPPED' }
  }
  const presentation = buildDiagnosticPresentation({
    code,
    severity: input.severity ?? null,
    message: input.message ?? null,
    detail: input.detail ?? null,
    category: input.category ?? null,
    metadata: (input.metadata ?? {}) as Record<string, unknown>,
  })
  return { label: deriveLabelFromTitle(presentation.drawerTitle, code), source: 'DERIVED' }
}

function firstSentence(text: string): string {
  const normalized = String(text ?? '').replace(/\s*\r?\n\s*/g, ' ').trim()
  if (normalized === '') return ''
  const end = normalized.indexOf('。')
  const sentence = end >= 0 ? normalized.slice(0, end) : normalized
  return truncateChars(sentence, 90)
}

/** Build one badge from one real diagnostic (never invents facts). */
export function buildDiagnosticBadge(input: DiagnosticBadgeInput): DiagnosticBadge {
  const code = String(input.code ?? '')
  const severity = normalizeBadgeSeverity(input.severity)
  const label = resolveDiagnosticBadgeLabel(input)
  const presentation = buildDiagnosticPresentation({
    code,
    severity: input.severity ?? null,
    message: input.message ?? null,
    detail: input.detail ?? null,
    category: input.category ?? null,
    metadata: (input.metadata ?? {}) as Record<string, unknown>,
  })
  const line = finiteNumber(input.line)
  return {
    diagnosticId: String(input.diagnosticId ?? ''),
    code,
    severity,
    shortLabel: label.label,
    fullTitle: presentation.drawerTitle,
    description: firstSentence(presentation.drawerDetail ?? input.detail ?? input.message ?? ''),
    line,
    targetIdentity: String(input.targetIdentity ?? ''),
    priority: HEADING_BADGE_PRIORITY[code] ?? 5,
    semanticKey: `${label.label}`,
    labelSource: label.source,
  }
}

function compareBadges(a: DiagnosticBadge, b: DiagnosticBadge): number {
  if (a.priority !== b.priority) return a.priority - b.priority
  const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  if (severityDelta !== 0) return severityDelta
  const codeDelta = a.code.localeCompare(b.code)
  if (codeDelta !== 0) return codeDelta
  return a.diagnosticId.localeCompare(b.diagnosticId)
}

/**
 * Build the stable badge set of ONE heading:
 *   - semantic dedupe by visible label (same problem never paints twice)
 *   - deterministic priority ordering (no swap on detection order changes)
 *   - <=2 specific badges, then a `+N` summary of the remaining real problems.
 */
export function buildDiagnosticBadgeSet(inputs: readonly DiagnosticBadgeInput[]): DiagnosticBadgeSet {
  const badges = inputs.map(buildDiagnosticBadge).sort(compareBadges)
  const unique: DiagnosticBadge[] = []
  const seen = new Set<string>()
  for (const badge of badges) {
    if (seen.has(badge.semanticKey)) continue
    seen.add(badge.semanticKey)
    unique.push(badge)
  }
  const visible = unique.slice(0, R14_MAX_BADGES_BEFORE_SUMMARY)
  const hiddenCount = Math.max(0, unique.length - visible.length)
  return {
    visible,
    all: unique,
    hiddenCount,
    summary: hiddenCount > 0
      ? { kind: 'summary', label: `+${hiddenCount}`, count: hiddenCount }
      : null,
  }
}

/** Full tooltip: full title + one-sentence description + real `Lxx` line. */
export function formatDiagnosticBadgeTooltip(badge: Pick<DiagnosticBadge, 'fullTitle' | 'description' | 'line'>): string {
  const title = String(badge.fullTitle ?? '').trim()
  const description = String(badge.description ?? '').trim()
  const lineText = badge.line != null && badge.line > 0 ? `L${badge.line}` : ''
  const head = title !== '' ? title : '诊断'
  const body = description !== '' ? `：${description}` : ''
  return `${head}${body}${lineText !== '' ? `（${lineText}）` : ''}`
}
