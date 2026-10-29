/**
 * Document Diagnostics — Drawer VIEW ORDER authority V1.
 *
 * The ONE pure authority for the presentation ORDER / FILTER / GROUP of the
 * Drawer rows. It is DERIVED from the frozen V5.14-R1 projection contract
 * (`DiagnosticTargetProjection` + `documentPositionOf`): it NEVER re-counts
 * targets, NEVER re-derives a position and NEVER splits a business diagnostic.
 *
 *   - default  `document`  — Markdown source position (band → line → column),
 *                            then severity, then the STABLE rule priority;
 *   - optional `severity`  — severity first, then the STABLE rule priority,
 *                            then source position;
 *   - optional `type`      — problem type first, then severity, then position.
 *
 * `filter` removes entries but must NEVER reorder the survivors; `group` is a
 * presentation overlay that keeps the underlying order intact.
 *
 * Pure contract: no DOM, no host state.
 */
import {
  compareDiagnosticTargetProjections,
  type DiagnosticTargetProjection,
} from './document-diagnostic-drawer-order-v514-r1'
import { resolveRulePriority } from './document-diagnostic-copy-v1'

// ── §1 — the sort MODE authority ────────────────────────────────────────────

export type DiagnosticSortMode = 'document' | 'severity' | 'type'

export const DIAGNOSTIC_SORT_MODES: readonly DiagnosticSortMode[] = ['document', 'severity', 'type']

export const DIAGNOSTIC_SORT_MODE_LABELS: Readonly<Record<DiagnosticSortMode, string>> = Object.freeze({
  document: '按位置',
  severity: '按严重程度',
  type: '按问题类型',
})

export function isDiagnosticSortMode(v: unknown): v is DiagnosticSortMode {
  return v === 'document' || v === 'severity' || v === 'type'
}

// ── §2 — the problem TYPE authority (derived from the rule code) ────────────

export type DiagnosticProblemType = 'document' | 'heading' | 'figure' | 'table' | 'code' | 'formula' | 'link'

export const DIAGNOSTIC_PROBLEM_TYPES: readonly DiagnosticProblemType[] = [
  'document', 'heading', 'figure', 'table', 'code', 'formula', 'link',
]

export const DIAGNOSTIC_PROBLEM_TYPE_LABELS: Readonly<Record<DiagnosticProblemType, string>> = Object.freeze({
  document: '文档',
  heading: '标题',
  figure: '图片',
  table: '表格',
  code: '代码块',
  formula: '公式',
  link: '链接',
})

const PROBLEM_TYPE_ORDER: Readonly<Record<DiagnosticProblemType, number>> = Object.freeze({
  document: 0, heading: 1, figure: 2, table: 3, code: 4, formula: 5, link: 6,
})

/**
 * §2 — the problem type of a rule code. It mirrors the registry's consumer
 * category: the CODE PREFIX is the single source (no meta lookup, no DOM).
 * The link-anchor / reference families (footnotes, reference-style links,
 * anchors) are all `link`.
 */
export function resolveProblemType(code: string): DiagnosticProblemType {
  const c = String(code ?? '')
  if (c.startsWith('HEADING_') || c.startsWith('SECTION_') || c.startsWith('LATENT_ATX_')
    || c.startsWith('STRICT_SINGLE_H1') || c.startsWith('STRICT_FIRST_H1')) return 'heading'
  if (c.startsWith('FIGURE_')) return 'figure'
  if (c.startsWith('TABLE_')) return 'table'
  if (c.startsWith('CODE_')) return 'code'
  if (c.startsWith('FORMULA_')) return 'formula'
  if (c.startsWith('LINK_') || c.startsWith('FOOTNOTE_') || c.startsWith('FRONTMATTER_')) return 'link'
  return 'document'
}

export function resolveProblemTypeLabel(code: string): string {
  return DIAGNOSTIC_PROBLEM_TYPE_LABELS[resolveProblemType(code)]
}

// ── §3 — the comparators ────────────────────────────────────────────────────

const SEVERITY_RANK: Readonly<Record<string, number>> = { error: 0, warning: 1, info: 2, hint: 2 }

function severityRankOf(p: DiagnosticTargetProjection): number {
  return SEVERITY_RANK[p.severity] ?? 2
}

/** §3 — stable rule priority, then the rule id, then the diagnostic id. */
function compareStable(a: DiagnosticTargetProjection, b: DiagnosticTargetProjection): number {
  const pa = resolveRulePriority(a.ruleId)
  const pb = resolveRulePriority(b.ruleId)
  if (pa !== pb) return pa - pb
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1
  if (a.diagnosticId !== b.diagnosticId) return a.diagnosticId < b.diagnosticId ? -1 : 1
  return a.targetIndex - b.targetIndex
}

/**
 * §3 — default: Markdown source position, then severity, then rule priority.
 * It DELEGATES to the frozen V5.14-R1 comparator so the Drawer's default order
 * can never drift from the ordering contract (ONE authority, no duplication).
 */
export function compareByDocumentPosition(
  a: DiagnosticTargetProjection,
  b: DiagnosticTargetProjection,
): number {
  return compareDiagnosticTargetProjections(a, b)
}

/** §3 — severity first, then rule priority, then source position. */
export function compareBySeverity(
  a: DiagnosticTargetProjection,
  b: DiagnosticTargetProjection,
): number {
  const sr = severityRankOf(a) - severityRankOf(b)
  if (sr !== 0) return sr
  const stable = compareStable(a, b)
  if (stable !== 0) return stable
  return compareByDocumentPosition(a, b)
}

/** §3 — problem type first, then severity, then source position. */
export function compareByProblemType(
  a: DiagnosticTargetProjection,
  b: DiagnosticTargetProjection,
): number {
  const ta = PROBLEM_TYPE_ORDER[resolveProblemType(a.ruleId)]
  const tb = PROBLEM_TYPE_ORDER[resolveProblemType(b.ruleId)]
  if (ta !== tb) return ta - tb
  const sr = severityRankOf(a) - severityRankOf(b)
  if (sr !== 0) return sr
  return compareByDocumentPosition(a, b)
}

/** §3 — the ONE comparator of a mode. */
export function comparatorForSortMode(
  mode: DiagnosticSortMode,
): (a: DiagnosticTargetProjection, b: DiagnosticTargetProjection) => number {
  if (mode === 'severity') return compareBySeverity
  if (mode === 'type') return compareByProblemType
  return compareByDocumentPosition
}

/** §3 — sort a COPY; the input array is never mutated. Deterministic + stable. */
export function sortProjections(
  projections: readonly DiagnosticTargetProjection[],
  mode: DiagnosticSortMode,
): DiagnosticTargetProjection[] {
  const cmp = comparatorForSortMode(mode)
  return [...projections].sort(cmp)
}

// ── §4 — the TYPE filter ────────────────────────────────────────────────────

export type DiagnosticTypeFilter = DiagnosticProblemType | 'all'

export function isDiagnosticTypeFilter(v: unknown): v is DiagnosticTypeFilter {
  return v === 'all' || (typeof v === 'string' && (DIAGNOSTIC_PROBLEM_TYPES as readonly string[]).includes(v))
}

/** §4 — a filter removes entries but NEVER reorders the survivors. */
export function filterProjectionsByProblemType(
  projections: readonly DiagnosticTargetProjection[],
  filter: DiagnosticTypeFilter,
): DiagnosticTargetProjection[] {
  if (filter === 'all') return [...projections]
  return projections.filter(p => resolveProblemType(p.ruleId) === filter)
}

// ── §6 — the control-strip layout authority ─────────────────────────────────

/**
 * §6 — below this Drawer content width the sort/type/group controls stack
 * vertically (each takes the full width) so a very narrow Drawer never clips.
 */
export const DRAWER_VIEW_ORDER_STACK_WIDTH_PX = 260

export type DrawerViewOrderLayout = 'wide' | 'stacked'

/**
 * §6 — resolve the control-strip layout from the MEASURED Drawer content width.
 * Unknown / zero width (unmeasured) → `wide`: CSS `flex-wrap` still protects a
 * narrow Drawer, and an unmeasured width must never force a stacked layout.
 */
export function resolveDrawerViewOrderLayout(widthPx: number | null | undefined): DrawerViewOrderLayout {
  if (typeof widthPx !== 'number' || !Number.isFinite(widthPx) || widthPx <= 0) return 'wide'
  return widthPx < DRAWER_VIEW_ORDER_STACK_WIDTH_PX ? 'stacked' : 'wide'
}

// ── §5 — optional GROUPING ──────────────────────────────────────────────────

export interface DiagnosticTypeGroup {
  type: DiagnosticProblemType
  label: string
  items: DiagnosticTargetProjection[]
}

/**
 * §5 — group an ALREADY-ORDERED list by problem type, in the FIXED type order.
 * The order of items inside each group is preserved exactly (the group is a
 * presentation overlay, never a re-sort). Empty groups are omitted.
 */
export function groupProjectionsByProblemType(
  projections: readonly DiagnosticTargetProjection[],
): DiagnosticTypeGroup[] {
  const buckets = new Map<DiagnosticProblemType, DiagnosticTargetProjection[]>()
  for (const p of projections) {
    const t = resolveProblemType(p.ruleId)
    const arr = buckets.get(t)
    if (arr) arr.push(p)
    else buckets.set(t, [p])
  }
  const groups: DiagnosticTypeGroup[] = []
  for (const t of DIAGNOSTIC_PROBLEM_TYPES) {
    const items = buckets.get(t)
    if (items && items.length > 0) groups.push({ type: t, label: DIAGNOSTIC_PROBLEM_TYPE_LABELS[t], items })
  }
  return groups
}
