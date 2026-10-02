/**
 * Phase 7R.3.11.8B.5 — Document Diagnostic Universal Location Authority.
 *
 * Single location model for ALL published diagnostics. A published diagnostic
 * is LOCATABLE by construction: every Error/Warning/Hint carries one of the
 * six `DiagnosticLocation` kinds. This module owns:
 *
 *  1. `DOCUMENT_DIAGNOSTIC_RULE_REGISTRY` — ruleId → category + location strategy.
 *  2. `computeDiagnosticLocationContract(snapshot)` — PUBLISHED = LOCATABLE audit.
 *  3. `resolveDiagnosticLocation(...)` — universal resolver: stable locator
 *     → LIVE DOM target / scroll action at click time. NEVER holds a
 *     long-lived HTMLElement as the only authority.
 *
 * Resolution NEVER mutates Markdown or business content. Multi-target cycling
 * is handled by the caller (overlay) via `targetIndex`.
 */
import type {
  DiagnosticFigureOccurrenceIdentity,
  DiagnosticLocation,
  DiagnosticRangeRole,
  DocumentDiagnostic,
  DocumentDiagnosticCategory,
  DocumentDiagnosticsSnapshot,
} from './diagnostics-types'
// V5.12-R5 — the explicit ambiguity failure reason (never a silent first match).
import { AMBIGUOUS_DUPLICATE_INLINE_RANGE_REASON } from './document-diagnostic-source-occurrence-v512-r5'
// Unified Diagnostics Domain V1 §9/§24 — the domain type used by the rule-domain authority.
import type { DiagnosticDomain } from './diagnostic-domain-v1'

// ── Rule Registry ─────────────────────────────────────────

export type DiagnosticLocationStrategy =
  | 'canonical-node'
  | 'source-range'
  | 'document-start'
  | 'document-end'
  | 'block-node'
  | 'multi-target'
  /** V1 — ONE diagnostic whose N member targets form a SINGLE fact (1 Drawer row). */
  | 'target-group'
  /** V1 — the WHOLE owning Markdown block (structure errors). */
  | 'source-block'
  /** V1 — ONE verified figure source occurrence (image warnings). */
  | 'figure-occurrence'

/**
 * VNext §9/§30 — the 10 INTERNAL diagnostic areas.
 *
 * These are grouping metadata ONLY: the Drawer keeps its severity tabs
 * (全部 / 错误 / 警告 / 提示) and never exposes one tab per area. `area` is
 * deliberately SEPARATE from `DocumentDiagnosticCategory`, which stays the
 * legacy consumer-facing grouping used by the drawer projection / dedup keys.
 */
export type DocumentDiagnosticArea =
  | 'document-state'
  | 'document-completeness'
  | 'heading'
  | 'figure'
  | 'table'
  | 'code'
  | 'formula'
  | 'caption-numbering'
  | 'link-anchor'
  | 'cross-reference'

/** VNext §10/§11 — what the problem acts on (never the severity, never the domain). */
export type DocumentDiagnosticScope = 'document' | 'heading' | 'block' | 'object' | 'inline'

export const DOCUMENT_DIAGNOSTIC_AREAS: readonly DocumentDiagnosticArea[] = [
  'document-state',
  'document-completeness',
  'heading',
  'figure',
  'table',
  'code',
  'formula',
  'caption-numbering',
  'link-anchor',
  'cross-reference',
]

/**
 * VNext §4/§41 — the ONE active-visual MODE authority.
 *
 * `text-tight-single-target` — the default: a click activates the ONE canonical
 * target of the diagnostic (the existing heading emphasis).
 *
 * `text-tight-multi-target` — a DOCUMENT-COMPLETENESS rule whose location is a
 * `multi-target` heading list: ONE click activates EVERY heading target with an
 * INDEPENDENT text-tight fill (1 diagnostic → N targets → 1 lease → N fills).
 * It is NEVER a single merged rectangle and never N separate transactions.
 */
export type DocumentDiagnosticActiveVisualMode =
  | 'text-tight-single-target'
  | 'text-tight-multi-target'
  /** V1 — ONE group owner activating N co-equal heading members simultaneously. */
  | 'text-tight-target-group'

/** VNext §9 — the UI presentation axis (how the Drawer / body render the item). */
export interface DocumentDiagnosticRulePresentation {
  /** §11 — paint the short reason chip on the target block/heading. */
  reasonChip: boolean
  /** §9 — a passive (non-active) marker may be painted for this rule. */
  passiveVisual: boolean
  /** §9 — the rule supports an ACTIVE locate visual on first click. */
  activeVisual: boolean
  /** §4 — how the ACTIVE visual covers the rule's canonical target set. */
  activeVisualMode: DocumentDiagnosticActiveVisualMode
  /**
   * Target Group V1 §6/§11 — the interaction authority mode.
   *   single     — ONE target, repeated click toggles.
   *   occurrence — N independent occurrences (cursor / switch / 1-N).
   *   group      — ONE fact with N members (no cursor, repeated click toggles).
   */
  interactionMode: DocumentDiagnosticInteractionMode
  /**
   * Target Group V1 §6/§8 — how the Drawer flattens this rule.
   *   single-row       — exactly ONE row (target-group AND ordinary rules).
   *   occurrence-rows  — one row per occurrence target (multi-target).
   */
  drawerProjectionMode: DocumentDiagnosticDrawerProjectionMode
}

export type DocumentDiagnosticInteractionMode = 'single' | 'occurrence' | 'group'
export type DocumentDiagnosticDrawerProjectionMode = 'single-row' | 'occurrence-rows'

export interface DocumentDiagnosticRuleMeta {
  ruleId: string
  category: DocumentDiagnosticCategory
  locationStrategy: DiagnosticLocationStrategy
  /** §9/§32 — WHO owns the problem. Every rule in this registry is `document`. */
  domain: DiagnosticDomain
  /** §9/§30 — the 10-way INTERNAL area (never a Drawer tab). */
  area: DocumentDiagnosticArea
  /** §10/§11 — WHERE the problem acts; the reason-chip default derives from it. */
  scope: DocumentDiagnosticScope
  presentation: DocumentDiagnosticRulePresentation
}

/** area → scope default (§11: scope=document ⇒ reasonChip=false). */
const AREA_DEFAULT_SCOPE: Readonly<Record<DocumentDiagnosticArea, DocumentDiagnosticScope>> = {
  'document-state': 'document',
  'document-completeness': 'document',
  heading: 'heading',
  figure: 'object',
  table: 'object',
  code: 'object',
  formula: 'object',
  'caption-numbering': 'object',
  'link-anchor': 'inline',
  'cross-reference': 'inline',
}

/** legacy consumer category → internal area default. */
const CATEGORY_DEFAULT_AREA: Readonly<Record<DocumentDiagnosticCategory, DocumentDiagnosticArea>> = {
  document: 'document-state',
  heading: 'heading',
  figure: 'figure',
  table: 'table',
  code: 'code',
  formula: 'formula',
  link: 'link-anchor',
}

/**
 * §9 — build ONE rule meta entry. Defaults are DERIVED (area → scope →
 * reasonChip) so every registered rule is complete by construction: a rule can
 * never be registered without domain / area / scope / presentation metadata
 * (Hard Gate `DOCUMENT_RULE_WITHOUT_*_COUNT=0`).
 */
function rule(
  ruleId: string,
  category: DocumentDiagnosticCategory,
  locationStrategy: DiagnosticLocationStrategy,
  extra: {
    area?: DocumentDiagnosticArea
    scope?: DocumentDiagnosticScope
    reasonChip?: boolean
    passiveVisual?: boolean
    activeVisual?: boolean
    activeVisualMode?: DocumentDiagnosticActiveVisualMode
    interactionMode?: DocumentDiagnosticInteractionMode
    drawerProjectionMode?: DocumentDiagnosticDrawerProjectionMode
  } = {},
): DocumentDiagnosticRuleMeta {
  const area = extra.area ?? CATEGORY_DEFAULT_AREA[category]
  const scope = extra.scope ?? AREA_DEFAULT_SCOPE[area]
  // Target Group V1 §6 — the mode is DERIVED from the location strategy so a rule
  // can never register a contradictory interaction / projection mode.
  const interactionMode = extra.interactionMode
    ?? (locationStrategy === 'target-group' ? 'group' : locationStrategy === 'multi-target' ? 'occurrence' : 'single')
  const drawerProjectionMode = extra.drawerProjectionMode
    ?? (locationStrategy === 'multi-target' ? 'occurrence-rows' : 'single-row')
  return {
    ruleId,
    category,
    locationStrategy,
    domain: 'document',
    area,
    scope,
    presentation: {
      // §11 — the DEFAULT is scope-driven; a rule may still override explicitly.
      reasonChip: extra.reasonChip ?? scope !== 'document',
      passiveVisual: extra.passiveVisual ?? true,
      activeVisual: extra.activeVisual ?? true,
      activeVisualMode: extra.activeVisualMode
        ?? (locationStrategy === 'target-group' ? 'text-tight-target-group' : 'text-tight-single-target'),
      interactionMode,
      drawerProjectionMode,
    },
  }
}

/**
 * Real producer ruleId → category + area + scope + location strategy +
 * presentation. Keys mirror the ACTUAL codes emitted by
 * `computeDocumentDiagnostics` (never invented aliases).
 */
export const DOCUMENT_DIAGNOSTIC_RULE_REGISTRY: Record<string, DocumentDiagnosticRuleMeta> = {
  // Document-level
  DOCUMENT_INACTIVE: rule('DOCUMENT_INACTIVE', 'document', 'document-start', { area: 'document-state' }),
  DOCUMENT_EMPTY: rule('DOCUMENT_EMPTY', 'document', 'document-start', { area: 'document-state' }),
  DOCUMENT_SOURCE_UNAVAILABLE: rule('DOCUMENT_SOURCE_UNAVAILABLE', 'document', 'document-start', { area: 'document-state' }),
  DOCUMENT_TERMINAL_NEWLINE_MISSING: rule('DOCUMENT_TERMINAL_NEWLINE_MISSING', 'document', 'document-end', { area: 'document-state' }),
  DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE: rule('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', 'document', 'document-end', { area: 'document-state' }),
  // V1 — 单标题无正文 Hint：the target is the UNIQUE canonical heading (never
  // EOF / blank body / toolbar / drawer), so its strategy is `canonical-node`
  // with a `source-range` fallback when the frame carries no stable identity.
  DOCUMENT_HEADING_ONLY_NO_BODY: rule('DOCUMENT_HEADING_ONLY_NO_BODY', 'document', 'canonical-node', { area: 'document-completeness' }),
  // VNext §12/§13 / Target Group V1 §4/§6 — 多标题无正文 Hint（与上面严格互斥）。
  // It is a TARGET GROUP: ONE document-level fact carried by EVERY canonical
  // heading. ONE diagnostic / ONE Drawer row / ONE interaction / ONE lease with
  // N co-equal heading members — never an occurrence list (`1/N`).
  DOCUMENT_HEADINGS_ONLY_NO_BODY: rule('DOCUMENT_HEADINGS_ONLY_NO_BODY', 'document', 'target-group', {
    area: 'document-completeness',
  }),
  STRICT_SINGLE_H1_NO_H1: rule('STRICT_SINGLE_H1_NO_H1', 'document', 'document-start', { area: 'document-state' }),
  // §10/§11 — the MULTIPLE-H1 violation ACTS ON the offending H1 (its reason
  // chip is painted on that heading, the frozen V5.14-R5 contract), so its
  // scope is `heading`, not `document`, even though the RULE is document-level.
  STRICT_SINGLE_H1_MULTIPLE_H1: rule('STRICT_SINGLE_H1_MULTIPLE_H1', 'document', 'multi-target', { area: 'document-state', scope: 'heading' }),
  // Source syntax
  LATENT_ATX_HEADING_MARKER: rule('LATENT_ATX_HEADING_MARKER', 'heading', 'source-range'),
  // Heading structure
  HEADING_LEVEL_GAP: rule('HEADING_LEVEL_GAP', 'heading', 'canonical-node'),
  HEADING_EMPTY_TEXT: rule('HEADING_EMPTY_TEXT', 'heading', 'canonical-node'),
  HEADING_DUPLICATE_TEXT: rule('HEADING_DUPLICATE_TEXT', 'heading', 'multi-target'),
  HEADING_DUPLICATE_IDENTITY: rule('HEADING_DUPLICATE_IDENTITY', 'heading', 'canonical-node'),
  // VNext §16/§17 — section completeness (heading-scoped hints).
  SECTION_EMPTY: rule('SECTION_EMPTY', 'heading', 'canonical-node', { area: 'document-completeness', scope: 'heading', reasonChip: true }),
  SECTION_ONLY_SUBHEADINGS: rule('SECTION_ONLY_SUBHEADINGS', 'heading', 'canonical-node', { area: 'document-completeness', scope: 'heading', reasonChip: true }),
  // VNext §24 — user manual numbering while automatic numbering is ON.
  HEADING_MANUAL_NUMBER_PREFIX: rule('HEADING_MANUAL_NUMBER_PREFIX', 'heading', 'canonical-node', { area: 'caption-numbering', scope: 'heading' }),
  // Figure / table / code / formula / link (block node)
  FIGURE_MISSING_NAME: rule('FIGURE_MISSING_NAME', 'figure', 'figure-occurrence'),
  FIGURE_DUPLICATE_NAME: rule('FIGURE_DUPLICATE_NAME', 'figure', 'multi-target'),
  FIGURE_LOCAL_IMAGE_MISSING: rule('FIGURE_LOCAL_IMAGE_MISSING', 'figure', 'figure-occurrence'),
  // V5.15 / V1 — a structurally invalid picture block owns a BLOCK-level
  // locator: the target is the WHOLE owning block (never one image token) and
  // the rule never enters the inline occurrence / duplicate-range resolver.
  FIGURE_BLOCK_STRUCTURE_INVALID: rule('FIGURE_BLOCK_STRUCTURE_INVALID', 'figure', 'source-block'),
  FIGURE_MANUAL_NUMBER_PREFIX: rule('FIGURE_MANUAL_NUMBER_PREFIX', 'figure', 'figure-occurrence', { area: 'caption-numbering', scope: 'object' }),
  TABLE_MISSING_NAME: rule('TABLE_MISSING_NAME', 'table', 'block-node'),
  TABLE_DUPLICATE_NAME: rule('TABLE_DUPLICATE_NAME', 'table', 'multi-target'),
  // VNext §18 — a table carrying a list/blockquote marker is not a standalone
  // block (proven by the source parser, never by DOM position).
  TABLE_BLOCK_STRUCTURE_INVALID: rule('TABLE_BLOCK_STRUCTURE_INVALID', 'table', 'source-range'),
  TABLE_EMPTY_CONTENT: rule('TABLE_EMPTY_CONTENT', 'table', 'source-range', { area: 'document-completeness', scope: 'object' }),
  CODE_MISSING_NAME: rule('CODE_MISSING_NAME', 'code', 'block-node'),
  CODE_MISSING_LANGUAGE: rule('CODE_MISSING_LANGUAGE', 'code', 'block-node'),
  CODE_DUPLICATE_NAME: rule('CODE_DUPLICATE_NAME', 'code', 'multi-target'),
  CODE_EMPTY_BLOCK: rule('CODE_EMPTY_BLOCK', 'code', 'source-range', { area: 'document-completeness', scope: 'object' }),
  FORMULA_DUPLICATE_VISIBLE_TAG: rule('FORMULA_DUPLICATE_VISIBLE_TAG', 'formula', 'block-node'),
  // VNext §19 — a display formula carrying a list/blockquote marker is not a
  // standalone block (the formula analogue of FIGURE_BLOCK_STRUCTURE_INVALID).
  // Located as a source-range over the WHOLE formula block: the figure
  // `source-block` locator is figure-specific and must not be reused here.
  FORMULA_BLOCK_STRUCTURE_INVALID: rule('FORMULA_BLOCK_STRUCTURE_INVALID', 'formula', 'source-range'),
  FORMULA_EMPTY_CONTENT: rule('FORMULA_EMPTY_CONTENT', 'formula', 'source-range', { area: 'document-completeness', scope: 'object' }),
  BLOCKQUOTE_EMPTY: rule('BLOCKQUOTE_EMPTY', 'document', 'source-range', { area: 'document-completeness', scope: 'block' }),
  LINK_LOCAL_TARGET_MISSING: rule('LINK_LOCAL_TARGET_MISSING', 'link', 'block-node'),
}

/** §11 — the ONE scope resolver (registry + prefix aware). */
export function resolveRuleScope(code: string): DocumentDiagnosticScope | null {
  return getRuleMeta(code)?.scope ?? null
}

/** §11 — the ONE reason-chip authority for a rule code (never a code special case). */
export function resolveRuleReasonChip(code: string): boolean | null {
  return getRuleMeta(code)?.presentation.reasonChip ?? null
}

/** §4 — the ONE active-visual-mode authority for a rule code (never a code special case). */
export function resolveRuleActiveVisualMode(code: string): DocumentDiagnosticActiveVisualMode {
  return getRuleMeta(code)?.presentation.activeVisualMode ?? 'text-tight-single-target'
}

/** Target Group V1 §6/§11 — the ONE interaction-mode authority for a rule code. */
export function resolveRuleInteractionMode(code: string): DocumentDiagnosticInteractionMode {
  return getRuleMeta(code)?.presentation.interactionMode ?? 'single'
}

/** Target Group V1 §6/§8 — the ONE drawer-projection-mode authority for a rule code. */
export function resolveRuleDrawerProjectionMode(code: string): DocumentDiagnosticDrawerProjectionMode {
  return getRuleMeta(code)?.presentation.drawerProjectionMode ?? 'single-row'
}

/** Resolve registry meta by the REAL emitted code (prefix match for LATENT levels). */
export function getRuleMeta(code: string): DocumentDiagnosticRuleMeta | null {
  if (DOCUMENT_DIAGNOSTIC_RULE_REGISTRY[code]) return DOCUMENT_DIAGNOSTIC_RULE_REGISTRY[code]
  if (code.startsWith('LATENT_ATX_HEADING_MARKER')) return DOCUMENT_DIAGNOSTIC_RULE_REGISTRY.LATENT_ATX_HEADING_MARKER
  if (code.startsWith('STRICT_FIRST_H1_')) {
    // §11 — the pre-H1 lint acts ON the first H1 (its reason chip is painted on
    // that heading, the frozen V5.14-R5 contract) ⇒ scope=heading.
    return rule('STRICT_FIRST_H1_POSITION', 'document', 'canonical-node', { area: 'document-state', scope: 'heading' })
  }
  return null
}

/**
 * Unified Diagnostics Domain V1 §5/§9/§24 — the ONE rule-domain authority.
 *
 * EVERY rule registered here describes a problem the USER can fix by editing
 * Markdown, so the whole registry belongs to the DOCUMENT domain. Runtime
 * integrity (plugin code / state / deployment) has its own model and adapter in
 * `diagnostic-domain-v1` and never appears in this registry.
 */
export const DOCUMENT_DIAGNOSTIC_RULE_DOMAIN: DiagnosticDomain = 'document'

/** §24 — explicit code → domain map for every registered rule. */
export const DOCUMENT_DIAGNOSTIC_RULE_DOMAINS: Readonly<Record<string, DiagnosticDomain>> =
  Object.fromEntries(
    Object.keys(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY).map(code => [code, DOCUMENT_DIAGNOSTIC_RULE_DOMAIN]),
  )

/**
 * §9 — the SINGLE rule-domain resolver (registry + prefix aware). Returns
 * `null` for an unregistered code (a new rule MUST register a domain).
 */
export function resolveDiagnosticDomain(code: string): DiagnosticDomain | null {
  return getRuleMeta(code) != null ? DOCUMENT_DIAGNOSTIC_RULE_DOMAIN : null
}

// ── Location Contract Audit ──────────────────────────────

export interface DiagnosticLocationContract {
  diagnosticCount: number
  locatableDiagnosticCount: number
  unlocatableDiagnosticCount: number
  /**
   * V5.12-R6 §9 — declared NON-LOCATABLE document notices (e.g. the
   * empty-document terminal `DOCUMENT_EMPTY`). These are excluded from
   * `unlocatableDiagnosticCount` by declaration, never by silent omission.
   */
  nonLocatableNoticeCount: number
  canonicalNodeLocationCount: number
  sourceRangeLocationCount: number
  /** V1 — block-level structure locators. */
  sourceBlockLocationCount: number
  /** V1 — figure occurrence locators. */
  figureOccurrenceLocationCount: number
  documentStartLocationCount: number
  documentEndLocationCount: number
  blockNodeLocationCount: number
  multiTargetLocationCount: number
  /** V1 — target-group locators (ONE diagnostic / N members / ONE row). */
  targetGroupLocationCount: number
  decision: 'PASS' | 'FAIL'
}

/** A location is "present" iff non-null AND a recognized kind. */
export function hasLocatableLocation(location: DiagnosticLocation | undefined | null): boolean {
  if (!location) return false
  if (location.kind === 'canonical-node') return location.stableIdentity.trim() !== ''
  if (location.kind === 'block-node') return location.stableIdentity.trim() !== ''
  if (location.kind === 'source-range') return Number.isFinite(location.startLine)
  // V1 — a block locator is locatable when it carries a real owning block span.
  if (location.kind === 'source-block') {
    return Number.isFinite(location.startLine)
      && Number.isFinite(location.sourceStart)
      && Number.isFinite(location.sourceEnd)
      && location.sourceBlockIdentity.trim() !== ''
  }
  // V1 — an occurrence locator is locatable when its identity is verifiable.
  if (location.kind === 'figure-occurrence') {
    return Number.isFinite(location.startLine)
      && location.occurrenceIdentity.sourceBlockIdentity.trim() !== ''
  }
  if (location.kind === 'multi-target') return location.targets.length > 0
  // Target Group V1 §4 — a group is locatable when its scroll anchor is locatable
  // (or it declares at least one member).
  if (location.kind === 'target-group') {
    return location.targets.length > 0 || hasLocatableLocation(location.scrollAnchor)
  }
  return true // document-start / document-end
}

/**
 * PUBLISHED = LOCATABLE. Counts every published diagnostic against its
 * `location`. Unlocatable (missing / empty locator) → FAIL.
 */
export function computeDiagnosticLocationContract(
  snapshot: DocumentDiagnosticsSnapshot | null,
): DiagnosticLocationContract {
  const diags = snapshot?.diagnostics ?? []
  let canonicalNode = 0
  let sourceRange = 0
  let sourceBlock = 0
  let figureOccurrence = 0
  let documentStart = 0
  let documentEnd = 0
  let blockNode = 0
  let multiTarget = 0
  let targetGroup = 0
  let locatable = 0
  let nonLocatableNotice = 0
  for (const d of diags) {
    if (!hasLocatableLocation(d.location)) {
      // V5.12-R6 §9 — a DECLARED non-locatable notice (empty-document terminal
      // state) is intentional, never a PUBLISHED = LOCATABLE violation.
      if (d.nonLocatableNotice === true) nonLocatableNotice++
      continue
    }
    locatable++
    switch (d.location!.kind) {
      case 'canonical-node': canonicalNode++; break
      case 'source-range': sourceRange++; break
      case 'source-block': sourceBlock++; break
      case 'figure-occurrence': figureOccurrence++; break
      case 'document-start': documentStart++; break
      case 'document-end': documentEnd++; break
      case 'block-node': blockNode++; break
      case 'multi-target': multiTarget++; break
      case 'target-group': targetGroup++; break
    }
  }
  const unlocatable = diags.length - locatable - nonLocatableNotice
  return {
    diagnosticCount: diags.length,
    locatableDiagnosticCount: locatable,
    unlocatableDiagnosticCount: unlocatable,
    nonLocatableNoticeCount: nonLocatableNotice,
    canonicalNodeLocationCount: canonicalNode,
    sourceRangeLocationCount: sourceRange,
    sourceBlockLocationCount: sourceBlock,
    figureOccurrenceLocationCount: figureOccurrence,
    documentStartLocationCount: documentStart,
    documentEndLocationCount: documentEnd,
    blockNodeLocationCount: blockNode,
    multiTargetLocationCount: multiTarget,
    targetGroupLocationCount: targetGroup,
    decision: unlocatable === 0 ? 'PASS' : 'FAIL',
  }
}

// ── Universal Resolver ───────────────────────────────────

export type DiagnosticLocationResolveDecision =
  | 'RESOLVED'
  | 'STALE'
  | 'TARGET_CHANGED'
  | 'UNRESOLVED'
  | 'WRONG_DOCUMENT'
  | 'NOT_FOUND'
  | 'UNSUPPORTED'

export type DiagnosticResolveAnchor =
  | 'heading-identity'
  | 'block-identity'
  | 'source-line'
  | 'source-line-offset'
  | 'source-text-context'
  | 'resource-semantic'
  | 'document-boundary'
  /** V5.12-R5 §7 — the EXACT source occurrence (never a first-text-match). */
  | 'source-occurrence'
  /** V1 — the WHOLE owning Markdown block (structure errors). */
  | 'owning-block'
  /** V1 — ONE verified figure occurrence (image warnings). */
  | 'figure-occurrence'
  /** V1 — the owning source block used because the image DOM is absent. */
  | 'source-block-fallback'

/**
 * V5.12-R5 §7 — the resolver's OWN output for a source occurrence. It must be
 * derived from the actual matched source block + token, never copied from the
 * diagnostic's expected metadata.
 */
export interface ResolvedSourceOccurrenceHint {
  element: HTMLElement
  /** Stable identity of the owning block (e.g. `p#data-line-14`). */
  anchorIdentity: string
  anchorTag: string
  /** How many times the destination token occurs inside the owning block. */
  matchCountWithinAnchor: number
  /** Which of those matches this occurrence IS (0-based, verified). */
  occurrenceWithinAnchor: number
  decision: 'EXACT_SOURCE_RANGE' | 'EXACT_SOURCE_LINE'
  /** Actual token text measured inside the block (never the expected value). */
  rangeText: string
  resolvedSourceStart: number | null
  resolvedSourceEnd: number | null
  resolvedSourceRangeIdentity: string | null
  resolvedOccurrenceIndex: number | null
  /** Source line the resolved block actually carries (null when unknown). */
  resolvedStartLine: number | null
  /** Source end line the resolved block actually carries (null when unknown). */
  resolvedEndLine: number | null
  /**
   * V5.12-R8 §5 — which part of the Markdown image token the resolved range
   * covers. The gate compares expected vs resolved and reports this in the
   * figure target authority audit.
   */
  resolvedRangeRole?: DiagnosticRangeRole
  /** V1 §27 — the live DOM owning-block identity the occurrence resolved in. */
  domBlockIdentity?: string | null
  /** V1 §20 — true when the image DOM was absent and the source block was used. */
  usedSourceBlockFallback?: boolean
}

/**
 * V1 §6/§27 — the Source ↔ DOM owning-block binding.
 *
 * `BOUND`      — exactly ONE live DOM block owns this source block.
 * `AMBIGUOUS`  — more than one candidate matched (never a silent first pick).
 * `MISSING`    — no candidate at all (the caller reports UNRESOLVED).
 */
export interface SourceBlockBinding {
  element: HTMLElement | null
  /** Stable DOM block identity (`dom-block:<tag>:<authority>:<value>`). */
  domBlockIdentity: string
  domTag: string
  candidateCount: number
  decision: 'BOUND' | 'AMBIGUOUS' | 'MISSING'
  /** How the binding was established (`data-line` / `runtime-id` / `text` / `ordinal`). */
  bindingAuthority: string
  // ── V2.3 §6/§9/§36 — SOURCE PROVENANCE that actually participated in
  // candidate construction. It must never be back-filled from the diagnostic's
  // expected fields (`SOURCE_PROVENANCE_SELF_ASSERTION_COUNT=0`).
  sourceBlockIdentity: string
  sourceStart: number | null
  sourceEnd: number | null
  startLine: number
  endLine: number
  sourceContainerKind: string
  /** The source-side DOM-visible semantic text (images contribute nothing). */
  sourceVisibleSemanticText: string
  // ── V2.3 §6 — the matching proof for this candidate pair.
  semanticTextMatch: boolean | 'N/A'
  containerKindMatch: boolean
  classOrdinalMatch: boolean | 'N/A'
  /**
   * V2.3 §36 — completeness of the source provenance. `decision: 'BOUND'` is
   * only valid when this is true AND the DOM target is connected; otherwise the
   * correct verdict is `REJECTED`/`MISSING`, never a proven-but-empty bind.
   */
  provenanceComplete: boolean
}

export interface DiagnosticLocationResolveResult {
  decision: DiagnosticLocationResolveDecision
  /** LIVE DOM target (canonical-node / source-range / block-node / multi-target leaf). */
  element: HTMLElement | null
  /** Document-boundary scroll action (document-start / document-end). */
  scrollAction: 'GO_TOP' | 'GO_BOTTOM' | null
  /** Effective target index within the location (multi-target cycle position). */
  targetIndex: number
  reason?: string
  /** Primary anchor used to resolve (null when nothing was tried). */
  primaryAnchor?: DiagnosticResolveAnchor | null
  /** Secondary anchor used after the primary missed (null when unused). */
  fallbackAnchor?: DiagnosticResolveAnchor | null
  /** Lowercase tag name of the resolved element (paragraph for LATENT_ATX). */
  resolvedNodeKind?: string | null
  /** Stable identity of the resolved element (data-line or canonical identity). */
  resolvedBlockIdentity?: string | null
  /** V5.12-R5 §7 — the resolver's OWN source-occurrence facts (when applicable). */
  sourceOccurrence?: ResolvedSourceOccurrenceHint | null
  /** V1 §27 — the Source ↔ DOM owning-block binding facts (source-block locator). */
  sourceBlockBinding?: SourceBlockBinding | null
  /** V1 §26 — the figure occurrence identity used by the occurrence locator. */
  figureOccurrenceIdentity?: string | null
}

export interface DiagnosticLocationResolveContext {
  documentKey: string | null
  getRoot: () => HTMLElement | null
  /**
   * V1 §21 — the CURRENT source generation. A `source-block` /
   * `figure-occurrence` location whose scan revision differs is STALE (the
   * caller refreshes the diagnostics and retries the user intent ONCE).
   */
  getSourceRevision?: () => number | null
  /** stableIdentity → live heading element (re-derived from the CURRENT frame). */
  resolveHeadingIdentity: (stableIdentity: string) => HTMLElement | null
  /** source line (0-based) → live element carrying Typora `data-line`. */
  resolveSourceLine: (line: number) => HTMLElement | null
  /** block kind + stableIdentity (`block:<kind>:<ordinal>`) → live block element. */
  resolveBlockIdentity: (blockKind: 'figure' | 'table' | 'code' | 'formula' | 'link', stableIdentity: string) => HTMLElement | null
  /**
   * Phase 7R.3.11.8B.7.2 — current Markdown source line text at a 0-based
   * index (null when unavailable / out of range). The content authority for
   * TARGET_CHANGED vs UNRESOLVED classification.
   */
  getSourceLineText?: (line: number) => string | null
  /**
   * Phase 7R.3.11.8B.7.2 — re-anchor by source text context: find the live
   * block whose normalized text equals the normalized scan-time raw text.
   * `nearLine` is a hint (prefer blocks whose data-line is closest to it).
   * This is what allows source-only diagnostics (LATENT_ATX_HEADING_MARKER)
   * to locate a plain paragraph/block without any Heading DOM.
   */
  findBlockByText?: (rawText: string, nearLine?: number) => HTMLElement | null
  /**
   * Phase 7R.3.11.8B.7.3 — resource semantic resolution: find the LIVE element
   * for a local resource diagnostic (missing image / link destination). The
   * implementation re-derives from the CURRENT frame (img src / anchor href),
   * never from a scan-time element. `kind` is 'image' | 'link'.
   */
  resolveResource?: (
    kind: 'image' | 'link',
    /** Normalized destination the diagnostic anchored on. */
    normalizedDestination: string,
    occurrenceIndex: number,
  ) => HTMLElement | null
  /**
   * Phase 7R.3.11.8B.7.3 — normalize a Markdown/DOM resource reference to the
   * SINGLE comparison identity (relative POSIX path, decoded, leading ./
   * stripped). See `normalizeResourcePath`.
   */
  normalizeResourcePath?: (raw: string) => string
  /**
   * Phase 7R.3.11.8B.7.3 — resource validity re-scan: true when the CURRENT
   * Markdown still contains the `occurrence`-th (0-based) reference to the
   * normalized destination. When absent, resource validity is treated as
   * intact (fallback = never falsely stale).
   */
  resourceDestinationPresent?: (normalizedDestination: string, occurrenceIndex: number) => boolean
  /**
   * V5.12-R5 §7 — SOURCE OCCURRENCE resolution. When the location carries an
   * exact source range (sourceStart/sourceEnd + rawLineOrdinal/
   * occurrenceWithinLine), the resolver resolves the ACTUAL source occurrence
   * (verified block ordinal + verified token ordinal) instead of falling back
   * to the first matching text. Returns null when it cannot be verified — the
   * caller then reports UNRESOLVED (never a silent first-match).
   */
  resolveSourceOccurrence?: (input: {
    startLine: number
    sourceStart: number | null
    sourceEnd: number | null
    sourceRangeIdentity: string | null
    rawText?: string
    rawLineOrdinal: number
    occurrenceWithinLine: number
    rawDestination: string | null
    canonicalDestination: string | null
    resourceKind: 'image' | 'link' | null
    expectedOccurrenceIndex: number | null
    /** V5.12-R8 §5 — which part of the image token to resolve. */
    rangeRole?: DiagnosticRangeRole
  }) => ResolvedSourceOccurrenceHint | null
  /**
   * V1 §6/§8 — Source ↔ DOM owning-block binding. Resolves the Markdown owning
   * block behind a `source-block` location into ONE live DOM block plus its
   * stable DOM block identity. Returns null when no DOM block can be verified.
   */
  resolveSourceBlock?: (input: {
    startLine: number
    endLine: number
    sourceStart: number
    sourceEnd: number
    sourceBlockIdentity: string
    sourceBlockOrdinal: number
  }) => SourceBlockBinding | null
  /**
   * V1 §10/§12/§20 — figure occurrence resolution through the owning BLOCK:
   * block binding first, then the Nth image inside that block; when the image
   * DOM is absent (broken local image) the source block itself is the fallback.
   * Null = genuine failure — the caller reports UNRESOLVED (never a silent
   * whole-document destination match).
   */
  resolveFigureOccurrence?: (input: {
    occurrenceIdentity: DiagnosticFigureOccurrenceIdentity
    rangeRole: DiagnosticRangeRole
    startLine: number
    sourceStart: number | null
    sourceEnd: number | null
    /** V5.12-R8 §5 — used to decide WHICH span the diagnostic really targets. */
    destinationStart: number | null
    tokenStart: number | null
    sourceRangeIdentity: string | null
    rawText?: string
    rawDestination: string
    canonicalDestination: string
    occurrenceIndex: number
    rawLineOrdinal: number
    occurrenceWithinLine: number
    expectedOccurrenceIndex: number | null
  }) => ResolvedSourceOccurrenceHint | null
}

/** Normalize source text for anchor comparison (trim + collapse whitespace). */
export function normalizeSourceAnchorText(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')  // NBSP family → plain space
    .replace(/[\u200B-\u200D\uFEFF]/g, '')  // zero-width chars Typora may inject
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * V2.2 §7/§10 — the ONE source→DOM visible-semantic projection.
 *
 *   `![alt](dest)`  → ""      (a rendered image contributes NO text content;
 *                              the alt must NEVER be used as a block-visible
 *                              signature — it is metadata only)
 *   `[text](dest)`  → "text"  (a link's label IS visible text)
 *
 * Without the image rule the needle is `before B` while the DOM reads `before`,
 * so no block containing an image can ever bind once the image really loads.
 */
export function stripInlineResourceSyntax(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
}

/**
 * V2 §6 — strip BLOCK-LEVEL markers (blockquote `>` / list `-` `*` `+` `1.` `1)`)
 * so a list-item or blockquote block can be compared with its OWNING container.
 *
 *   `> ![J](a.png)`  → `![J](a.png)`
 *   `- ![I](a.png)`  → `![I](a.png)`
 *
 * Without this the needle is a bare `>` / `-` which matches no DOM node, so
 * `- ![](a.png)` / `> ![](a.png)` could never bind their owning block.
 */
export function stripBlockLevelMarkers(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/^(\s*>\s*)+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
}

/** V1 §21 — the explicit stale-generation failure reason. */
export const STALE_SOURCE_REVISION_REASON = 'STALE_SOURCE_REVISION'

/**
 * V1 §21 — is the location's scan-time source generation older than the CURRENT
 * one? Only fires when BOTH revisions are known — the caller then refreshes the
 * diagnostics and retries the user intent ONCE (never an infinite loop).
 */
export function isStaleSourceRevision(
  sourceRevisionAtScan: number | null | undefined,
  ctx: { getSourceRevision?: () => number | null },
): boolean {
  if (sourceRevisionAtScan == null) return false
  const atLocate = ctx.getSourceRevision?.()
  if (atLocate == null) return false
  return sourceRevisionAtScan !== atLocate
}

/** True when the element's rendered text still matches the scan-time anchor text. */
export function elementMatchesAnchorText(el: HTMLElement, anchorText: string): boolean {
  if (anchorText === '') return true
  return normalizeSourceAnchorText(el.textContent ?? '') === normalizeSourceAnchorText(anchorText)
}

/**
 * Phase 7R.3.11.8B.7.3 — SINGLE resource-path normalization authority.
 *
 * One function for EVERY "is this the same local resource" comparison across
 * Markdown destinations and Typora DOM src/href attributes. The comparison
 * identity is a relative POSIX path (no leading ./, no scheme/authority, URL
 * decoded, backslashes → slashes, collapsed). Absolute and file:// references
 * are reduced to their vault-relative form by the caller when a vault root is
 * known; without a vault root, absolute paths stay absolute POSIX.
 *
 * Phase 7R.3.11.8B.7.4 (Resource Semantic Identity Closure):
 *   - bounded percent-decoding (≤2 passes) so double-encoded DOM references
 *     converge AND normalize(normalize(x)) === normalize(x) (idempotence);
 *   - a trailing `#fragment` is NEVER part of a resource path (a `#` is the
 *     URL fragment delimiter) — occurrence suffixes such as `dup.png#2` are
 *     display-only and must never reach this function as a real path;
 *   - Windows drive letters stay a single normalized `X:/` prefix.
 *
 * NEVER used to decide file existence — diagnostics rules keep their own
 * filesystem check.
 */
export function normalizeResourcePath(raw: string | null | undefined): string {
  let value = (raw ?? '').trim()
  if (value === '') return ''
  // Strip the URL query + fragment — `?...` / `#...` are never part of the
  // resource path (Typora appends `?lastModify=<ts>` to img src attributes).
  const qIndex = value.indexOf('?')
  if (qIndex >= 0) value = value.slice(0, qIndex)
  const hashIndex = value.indexOf('#')
  if (hashIndex >= 0) value = value.slice(0, hashIndex)
  // file:// scheme → path (both file:///D:/... and file://D:/...).
  if (/^file:\/\//i.test(value)) {
    value = value.slice('file://'.length).replace(/^\/+/, '')
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) {
    // http/https/data/... URLs are NOT local filesystem paths — keep the URL
    // semantics intact so they can never be compared as a local resource.
    // (A single drive letter `D:` is a Windows path, never a URL scheme.)
    return value
  }
  // Bounded percent-decoding (≤2 passes) — a pass only runs while the value
  // still contains a valid %XX sequence, so double-encoded DOM references
  // converge and the function is idempotent (never an unbounded decode chain).
  for (let pass = 0; pass < 2; pass++) {
    if (!value.includes('%')) break
    try {
      const decoded = decodeURIComponent(value)
      if (decoded === value) break
      value = decoded
    } catch {
      break // not valid percent-encoding — keep the raw value
    }
  }
  // Windows drive-letter absolute and UNC → POSIX-ish absolute.
  if (/^[a-z]:[\\/]/i.test(value)) {
    value = `${value[0].toUpperCase()}:/${value.slice(3).replace(/\\/g, '/')}`
  } else {
    value = value.replace(/\\/g, '/')
  }
  // Strip a leading ./ segment (a pure relative reference).
  while (value.startsWith('./')) value = value.slice(2)
  // Collapse duplicate slashes (not leading double for UNC file:////).
  value = value.replace(/\/+/g, '/')
  // Normalize "." segments and resolve ".." lexically WITHOUT crossing an
  // absolute root (a .. above the root clamps to the root).
  const driveMatch = /^([a-z]:\/)(.*)$/i.exec(value)
  const absolute = value.startsWith('/') || !!driveMatch
  const body = driveMatch ? driveMatch[2] : value
  const segments = body.split('/')
  const stack: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') stack.pop()
      else if (!absolute) stack.push('..')
      continue
    }
    stack.push(seg)
  }
  const joined = stack.join('/')
  const prefix = driveMatch ? driveMatch[1] : absolute ? '/' : ''
  return prefix + joined
}

/** Normalize a URL-encoded attribute reference (Typora DOM src/href). */
export function normalizeDomResourceRef(raw: string | null | undefined): string {
  return normalizeResourcePath(raw)
}

function resolvedResult(
  el: HTMLElement,
  targetIndex: number,
  primaryAnchor: DiagnosticResolveAnchor,
  fallbackAnchor: DiagnosticResolveAnchor | null,
): DiagnosticLocationResolveResult {
  return {
    decision: 'RESOLVED',
    element: el,
    scrollAction: null,
    targetIndex,
    primaryAnchor,
    fallbackAnchor,
    resolvedNodeKind: el.tagName.toLowerCase(),
    resolvedBlockIdentity: el.getAttribute('data-line') ?? el.id ?? null,
  }
}

/**
 * Resolve a diagnostic's location into a LIVE target. Pure resolution: never
 * scrolls, never mutates. For `multi-target`, `targetIndex` selects the cycle
 * position (clamped modulo target count).
 */
export function resolveDiagnosticLocation(
  diagnostic: DocumentDiagnostic,
  location: DiagnosticLocation | undefined | null,
  ctx: DiagnosticLocationResolveContext,
  targetIndex = 0,
): DiagnosticLocationResolveResult {
  const diagDocKey = diagnostic.documentKey || ''
  const currentDocKey = ctx.documentKey || ''
  if (diagDocKey && currentDocKey && diagDocKey !== currentDocKey) {
    return { decision: 'WRONG_DOCUMENT', element: null, scrollAction: null, targetIndex, reason: 'DIAGNOSTIC_BELONGS_TO_ANOTHER_DOCUMENT' }
  }
  if (!location || !hasLocatableLocation(location)) {
    return { decision: 'UNSUPPORTED', element: null, scrollAction: null, targetIndex, reason: 'NO_LOCATION' }
  }

  // Phase 7R.3.11.8B.7.3 — VALIDITY gate (separate from DOM resolution).
  // A scan-time validity fingerprint proves whether the SOURCE the diagnostic
  // was computed against is still present. A proven source change short-circuits
  // to TARGET_CHANGED (STALE) BEFORE any DOM resolution attempt. A proven
  // unchanged source NEVER yields STALE — the resolver may still fail with
  // UNRESOLVED, which the caller reports honestly.
  if (diagnostic.validityFingerprint) {
    const vfp = diagnostic.validityFingerprint
    if (vfp.kind === 'source-text' && typeof ctx.getSourceLineText === 'function') {
      const currentText = ctx.getSourceLineText(vfp.line)
      const sourceIntact =
        currentText != null && normalizeSourceAnchorText(currentText) === normalizeSourceAnchorText(vfp.text)
      if (!sourceIntact) {
        return { decision: 'TARGET_CHANGED', element: null, scrollAction: null, targetIndex, reason: 'VALIDITY_SOURCE_CHANGED', primaryAnchor: null, fallbackAnchor: null }
      }
    } else if (vfp.kind === 'resource' && typeof ctx.resourceDestinationPresent === 'function') {
      // Resource validity: the CURRENT Markdown must still reference the same
      // normalized destination the predicate anchored on.
      const resourceIntact = ctx.resourceDestinationPresent(vfp.path, vfp.occurrence)
      if (!resourceIntact) {
        return { decision: 'TARGET_CHANGED', element: null, scrollAction: null, targetIndex, reason: 'VALIDITY_RESOURCE_REMOVED', primaryAnchor: null, fallbackAnchor: null }
      }
    }
  }

  switch (location.kind) {
    case 'canonical-node': {
      const el = ctx.resolveHeadingIdentity(location.stableIdentity)
      if (el) return resolvedResult(el, targetIndex, 'heading-identity', null)
      return {
        decision: 'STALE',
        element: null,
        scrollAction: null,
        targetIndex,
        primaryAnchor: 'heading-identity',
        fallbackAnchor: null,
        reason: 'CANONICAL_NODE_NOT_FOUND',
      }
    }
    case 'source-block': {
      // V1 §4/§5/§16 — a BLOCK-level locator. The target is the WHOLE illegal
      // owning block: it resolves source block → owning DOM block and NEVER
      // enters the inline occurrence / duplicate-range resolver (the multiple
      // inline occurrences ARE the violation, so `AMBIGUOUS_DUPLICATE_INLINE_RANGE`
      // must be structurally unreachable here).
      // §21 — a stale source generation must never be located with old offsets.
      const staleBlock = isStaleSourceRevision(location.sourceRevision, ctx)
      if (staleBlock) {
        return {
          decision: 'TARGET_CHANGED', element: null, scrollAction: null, targetIndex,
          primaryAnchor: 'owning-block', fallbackAnchor: null, reason: STALE_SOURCE_REVISION_REASON,
          sourceBlockBinding: null,
        }
      }
      const resolveBlock = ctx.resolveSourceBlock
      if (typeof resolveBlock === 'function') {
        const binding = resolveBlock({
          startLine: location.startLine,
          endLine: location.endLine,
          sourceStart: location.sourceStart,
          sourceEnd: location.sourceEnd,
          sourceBlockIdentity: location.sourceBlockIdentity,
          sourceBlockOrdinal: location.sourceBlockOrdinal,
        })
        if (binding && binding.decision === 'BOUND' && binding.element) {
          const resolved = resolvedResult(binding.element, targetIndex, 'owning-block', null)
          return {
            ...resolved,
            resolvedNodeKind: binding.domTag,
            resolvedBlockIdentity: binding.domBlockIdentity,
            sourceBlockBinding: binding,
          }
        }
        return {
          decision: 'UNRESOLVED',
          element: null,
          scrollAction: null,
          targetIndex,
          primaryAnchor: 'owning-block',
          fallbackAnchor: null,
          reason: binding?.decision === 'AMBIGUOUS'
            ? 'SOURCE_BLOCK_BINDING_AMBIGUOUS'
            : 'SOURCE_BLOCK_BINDING_MISSING',
          sourceBlockBinding: binding ?? null,
        }
      }
      // Legacy (no binding authority): resolve the owning source line directly.
      // A block locator NEVER falls back to the inline occurrence resolver.
      const blockEl = ctx.resolveSourceLine(location.startLine)
      if (blockEl) return resolvedResult(blockEl, targetIndex, 'owning-block', 'source-line')
      return {
        decision: 'UNRESOLVED',
        element: null,
        scrollAction: null,
        targetIndex,
        primaryAnchor: 'owning-block',
        fallbackAnchor: 'source-line',
        reason: 'SOURCE_BLOCK_BINDING_MISSING',
        sourceBlockBinding: null,
      }
    }
    case 'figure-occurrence': {
      // V1 §10/§12/§16 — an OCCURRENCE-level locator. The target is ONE verified
      // image occurrence: owning block binding first, then the Nth image inside
      // that block. When the image DOM is absent (`FIGURE_LOCAL_IMAGE_MISSING`)
      // the resolver falls back to the owning source block — never UNRESOLVED,
      // and never a whole-document destination match.
      // §21 — a stale source generation must never be located with old offsets.
      if (isStaleSourceRevision(location.occurrenceIdentity.sourceRevision, ctx)) {
        return {
          decision: 'TARGET_CHANGED', element: null, scrollAction: null, targetIndex,
          primaryAnchor: 'figure-occurrence', fallbackAnchor: null, reason: STALE_SOURCE_REVISION_REASON,
          figureOccurrenceIdentity: location.occurrenceIdentity.sourceBlockIdentity,
        }
      }
      const resolveOccurrence = ctx.resolveFigureOccurrence
      if (typeof resolveOccurrence === 'function') {
        const hint = resolveOccurrence({
          occurrenceIdentity: location.occurrenceIdentity,
          rangeRole: location.rangeRole,
          startLine: location.startLine,
          sourceStart: location.sourceStart,
          sourceEnd: location.sourceEnd,
          destinationStart: location.destinationStart,
          tokenStart: location.tokenStart,
          sourceRangeIdentity: location.sourceRangeIdentity,
          rawText: location.rawText,
          rawDestination: location.rawDestination,
          canonicalDestination: location.canonicalDestination,
          occurrenceIndex: location.occurrenceIndex,
          rawLineOrdinal: location.rawLineOrdinal,
          occurrenceWithinLine: location.occurrenceWithinLine,
          expectedOccurrenceIndex: typeof location.occurrenceIndex === 'number' ? location.occurrenceIndex : null,
        })
        if (hint) {
          const resolved = resolvedResult(
            hint.element,
            targetIndex,
            hint.usedSourceBlockFallback ? 'source-block-fallback' : 'figure-occurrence',
            null,
          )
          return {
            ...resolved,
            resolvedNodeKind: hint.anchorTag,
            resolvedBlockIdentity: hint.anchorIdentity,
            sourceOccurrence: hint,
            figureOccurrenceIdentity: location.occurrenceIdentity.sourceBlockIdentity,
          }
        }
        return {
          decision: 'UNRESOLVED',
          element: null,
          scrollAction: null,
          targetIndex,
          primaryAnchor: 'figure-occurrence',
          fallbackAnchor: null,
          reason: 'FIGURE_OCCURRENCE_NOT_MAPPED_TO_DOM',
          figureOccurrenceIdentity: location.occurrenceIdentity.sourceBlockIdentity,
        }
      }
      // Legacy (no occurrence authority): degrade to the equivalent source-range
      // behavior so pure consumers keep working.
      return resolveDiagnosticLocation(diagnostic, {
        kind: 'source-range',
        rangeRole: location.rangeRole,
        startLine: location.startLine,
        startColumn: location.startColumn,
        endLine: location.endLine,
        endColumn: location.endColumn,
        rawText: location.rawText,
        sourceStart: location.sourceStart,
        sourceEnd: location.sourceEnd,
        sourceRangeIdentity: location.sourceRangeIdentity,
        resourceKind: location.resourceKind,
        canonicalDestination: location.canonicalDestination,
        rawDestination: location.rawDestination,
        occurrenceIndex: location.occurrenceIndex,
        rawLineOrdinal: location.rawLineOrdinal,
        occurrenceWithinLine: location.occurrenceWithinLine,
        rawToken: location.rawToken,
        tokenStart: location.tokenStart,
        tokenEnd: location.tokenEnd,
        destinationStart: location.destinationStart,
        destinationEnd: location.destinationEnd,
      }, ctx, targetIndex)
    }
    case 'source-range': {
      // ── V5.12-R5 §7/§8.3 — a source occurrence carrying its EXACT source range
      // resolves through the occurrence authority FIRST, so a duplicate
      // destination can never collapse onto the first text match. The authority
      // internally keeps the (safe) unique-match fallback; it returns null only
      // for a genuine ambiguity — which must be an explicit failure, never a
      // silent highlight of the first token.
      if (
        typeof ctx.resolveSourceOccurrence === 'function'
        && (location.sourceRangeIdentity != null || typeof location.sourceStart === 'number')
      ) {
        const hint = ctx.resolveSourceOccurrence({
          startLine: location.startLine,
          sourceStart: typeof location.sourceStart === 'number' ? location.sourceStart : null,
          sourceEnd: typeof location.sourceEnd === 'number' ? location.sourceEnd : null,
          sourceRangeIdentity: location.sourceRangeIdentity ?? null,
          rawText: location.rawText,
          rawLineOrdinal: typeof location.rawLineOrdinal === 'number' ? location.rawLineOrdinal : 0,
          occurrenceWithinLine: typeof location.occurrenceWithinLine === 'number' ? location.occurrenceWithinLine : 0,
          rawDestination: location.rawDestination ?? null,
          canonicalDestination: location.canonicalDestination ?? null,
          resourceKind: location.resourceKind ?? null,
          expectedOccurrenceIndex: typeof location.occurrenceIndex === 'number' ? location.occurrenceIndex : null,
          // V5.12-R8 §5 — the range role selects WHICH part of the image token
          // the resolver must resolve (full token vs destination/path).
          rangeRole: location.rangeRole,
        })
        if (hint) {
          const resolved = resolvedResult(hint.element, targetIndex, 'source-occurrence', null)
          return {
            ...resolved,
            resolvedNodeKind: hint.anchorTag,
            resolvedBlockIdentity: hint.anchorIdentity,
            sourceOccurrence: hint,
          }
        }
        return {
          decision: 'UNRESOLVED',
          element: null,
          scrollAction: null,
          targetIndex,
          primaryAnchor: 'source-occurrence',
          fallbackAnchor: null,
          reason: AMBIGUOUS_DUPLICATE_INLINE_RANGE_REASON,
        }
      }
      const anchorText = normalizeSourceAnchorText(location.rawText ?? ctx.getSourceLineText?.(location.startLine) ?? '')
      const hasContentAuthority = typeof ctx.getSourceLineText === 'function'
      const hasTextAnchor = anchorText !== ''

      // C. primary: source line → element carrying Typora `data-line`.
      let fallbackAnchor: DiagnosticResolveAnchor | null = null
      let el = ctx.resolveSourceLine(location.startLine)
      // Content verification: the block at the expected line must still carry
      // the scanned text. A same-line block with different content means the
      // source really changed (TARGET_CHANGED), never a silent wrong-target.
      if (el && hasTextAnchor && !elementMatchesAnchorText(el, anchorText)) el = null
      if (!el) {
        // D. offset tolerance: some Typora builds expose 1-based data-line.
        const off = ctx.resolveSourceLine(location.startLine + 1)
        if (off && hasTextAnchor && elementMatchesAnchorText(off, anchorText)) {
          el = off
          fallbackAnchor = 'source-line-offset'
        }
      }
      if (!el && hasTextAnchor && typeof ctx.findBlockByText === 'function') {
        // D/E. source-only diagnostics: re-anchor by text context — a plain
        // paragraph/block carrying the marker text is a valid target; no
        // Heading DOM is required.
        const byText = ctx.findBlockByText(anchorText, location.startLine)
        if (byText) {
          el = byText
          fallbackAnchor = 'source-text-context'
        }
      }
      if (el) return resolvedResult(el, targetIndex, 'source-line', fallbackAnchor)

      // G. classify the REAL reason — never a blanket STALE.
      if (hasContentAuthority && hasTextAnchor) {
        const currentText = ctx.getSourceLineText!(location.startLine)
        const sourceChanged =
          currentText == null || normalizeSourceAnchorText(currentText) !== anchorText
        if (sourceChanged) {
          return {
            decision: 'TARGET_CHANGED',
            element: null,
            scrollAction: null,
            targetIndex,
            primaryAnchor: 'source-line',
            fallbackAnchor,
            reason: 'SOURCE_LINE_CONTENT_CHANGED',
          }
        }
        // Source unchanged → a DOM-mapping failure, NOT a stale target.
        return {
          decision: 'UNRESOLVED',
          element: null,
          scrollAction: null,
          targetIndex,
          primaryAnchor: 'source-line',
          fallbackAnchor,
          reason: 'SOURCE_ANCHOR_NOT_MAPPED_TO_DOM',
        }
      }
      // Legacy callers without content authority: keep the old behavior.
      return {
        decision: 'STALE',
        element: null,
        scrollAction: null,
        targetIndex,
        primaryAnchor: 'source-line',
        fallbackAnchor,
        reason: 'SOURCE_LINE_NOT_FOUND',
      }
    }
    case 'document-start':
      return { decision: 'RESOLVED', element: null, scrollAction: 'GO_TOP', targetIndex, primaryAnchor: 'document-boundary', fallbackAnchor: null }
    case 'document-end':
      return { decision: 'RESOLVED', element: null, scrollAction: 'GO_BOTTOM', targetIndex, primaryAnchor: 'document-boundary', fallbackAnchor: null }
    case 'block-node': {
      const el = ctx.resolveBlockIdentity(location.blockKind, location.stableIdentity)
      if (el) return resolvedResult(el, targetIndex, 'block-identity', null)
      // Phase 7R.3.11.8B.7.3 — resource semantic resolution: a figure whose
      // ordinal identity drifted (or whose DOM got a wrapper) is re-derived
      // from the CURRENT frame by its normalized destination. NEVER a stale
      // verdict while the source is unchanged.
      if (location.blockKind === 'figure' && typeof ctx.resolveResource === 'function' && diagnostic.metadata) {
        // Phase 7R.3.11.8B.7.4 — Semantic Resource Identity (`destination`)
        // takes precedence for DOM resolution; `rawDestination` is the
        // Source Token Identity and is never used to match the DOM.
        const dest = typeof diagnostic.metadata.destination === 'string'
          ? diagnostic.metadata.destination
          : typeof diagnostic.metadata.rawDestination === 'string'
            ? diagnostic.metadata.rawDestination
            : null
        if (dest) {
          const norm = typeof ctx.normalizeResourcePath === 'function' ? ctx.normalizeResourcePath(dest) : normalizeResourcePath(dest)
          if (norm) {
            const occurrence = typeof diagnostic.metadata.occurrenceIndex === 'number' ? diagnostic.metadata.occurrenceIndex : 0
            const byResource = ctx.resolveResource('image', norm, occurrence)
            if (byResource) return resolvedResult(byResource, targetIndex, 'resource-semantic', 'block-identity')
          }
        }
      }
      // Phase 7R.3.11.8B.7.3 — validity is already PROVEN intact by the gate
      // above (or the diagnostic carries a resource fingerprint). A DOM miss
      // after that is a resolver failure (UNRESOLVED) — NEVER a stale target.
      // Legacy callers without a fingerprint AND without resource hooks keep
      // the conservative STALE behavior.
      const legacyNoValidity = !diagnostic.validityFingerprint
        && typeof ctx.resolveResource !== 'function'
        && typeof ctx.resourceDestinationPresent !== 'function'
      if (legacyNoValidity) {
        return {
          decision: 'STALE',
          element: null,
          scrollAction: null,
          targetIndex,
          primaryAnchor: 'block-identity',
          fallbackAnchor: null,
          reason: 'BLOCK_NODE_NOT_FOUND',
        }
      }
      return {
        decision: 'UNRESOLVED',
        element: null,
        scrollAction: null,
        targetIndex,
        primaryAnchor: 'block-identity',
        fallbackAnchor: null,
        reason: 'DOM_TARGET_UNRESOLVED',
      }
    }
    case 'multi-target': {
      if (location.targets.length === 0) {
        return { decision: 'UNSUPPORTED', element: null, scrollAction: null, targetIndex, reason: 'MULTI_TARGET_EMPTY' }
      }
      const idx = ((targetIndex % location.targets.length) + location.targets.length) % location.targets.length
      return resolveDiagnosticLocation(diagnostic, location.targets[idx], ctx, idx)
    }
    case 'target-group': {
      // Target Group V1 §13 — a group locate is ALWAYS the single scroll anchor
      // (the first member). The N members share this ONE viewport locate; the
      // active visual expands to all of them afterwards. A group is NEVER cycled.
      return resolveDiagnosticLocation(diagnostic, location.scrollAnchor, ctx, 0)
    }
    default:
      return { decision: 'UNSUPPORTED', element: null, scrollAction: null, targetIndex, reason: 'UNKNOWN_LOCATION_KIND' }
  }
}
