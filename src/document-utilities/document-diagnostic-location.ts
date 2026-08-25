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
  DiagnosticLocation,
  DocumentDiagnostic,
  DocumentDiagnosticCategory,
  DocumentDiagnosticsSnapshot,
} from './diagnostics-types'

// ── Rule Registry ─────────────────────────────────────────

export type DiagnosticLocationStrategy =
  | 'canonical-node'
  | 'source-range'
  | 'document-start'
  | 'document-end'
  | 'block-node'
  | 'multi-target'

export interface DocumentDiagnosticRuleMeta {
  ruleId: string
  category: DocumentDiagnosticCategory
  locationStrategy: DiagnosticLocationStrategy
}

/**
 * Real producer ruleId → category + location strategy. Keys mirror the ACTUAL
 * codes emitted by `computeDocumentDiagnostics` (never invented aliases).
 */
export const DOCUMENT_DIAGNOSTIC_RULE_REGISTRY: Record<string, DocumentDiagnosticRuleMeta> = {
  // Document-level
  DOCUMENT_INACTIVE: { ruleId: 'DOCUMENT_INACTIVE', category: 'document', locationStrategy: 'document-start' },
  DOCUMENT_EMPTY: { ruleId: 'DOCUMENT_EMPTY', category: 'document', locationStrategy: 'document-start' },
  DOCUMENT_SOURCE_UNAVAILABLE: { ruleId: 'DOCUMENT_SOURCE_UNAVAILABLE', category: 'document', locationStrategy: 'document-start' },
  DOCUMENT_TRAILING_BLANK_LINE: { ruleId: 'DOCUMENT_TRAILING_BLANK_LINE', category: 'document', locationStrategy: 'document-end' },
  // Strict H1 (canonical frame authority)
  STRICT_SINGLE_H1_NO_H1: { ruleId: 'STRICT_SINGLE_H1_NO_H1', category: 'document', locationStrategy: 'document-start' },
  STRICT_SINGLE_H1_MULTIPLE_H1: { ruleId: 'STRICT_SINGLE_H1_MULTIPLE_H1', category: 'document', locationStrategy: 'multi-target' },
  // Source syntax
  LATENT_ATX_HEADING_MARKER: { ruleId: 'LATENT_ATX_HEADING_MARKER', category: 'heading', locationStrategy: 'source-range' },
  // Heading structure
  HEADING_LEVEL_GAP: { ruleId: 'HEADING_LEVEL_GAP', category: 'heading', locationStrategy: 'canonical-node' },
  HEADING_EMPTY_TEXT: { ruleId: 'HEADING_EMPTY_TEXT', category: 'heading', locationStrategy: 'canonical-node' },
  HEADING_DUPLICATE_TEXT: { ruleId: 'HEADING_DUPLICATE_TEXT', category: 'heading', locationStrategy: 'multi-target' },
  HEADING_DUPLICATE_IDENTITY: { ruleId: 'HEADING_DUPLICATE_IDENTITY', category: 'heading', locationStrategy: 'canonical-node' },
  // Figure / table / code / formula / link (block node)
  FIGURE_MISSING_NAME: { ruleId: 'FIGURE_MISSING_NAME', category: 'figure', locationStrategy: 'block-node' },
  FIGURE_DUPLICATE_NAME: { ruleId: 'FIGURE_DUPLICATE_NAME', category: 'figure', locationStrategy: 'multi-target' },
  FIGURE_LOCAL_IMAGE_MISSING: { ruleId: 'FIGURE_LOCAL_IMAGE_MISSING', category: 'figure', locationStrategy: 'block-node' },
  TABLE_MISSING_NAME: { ruleId: 'TABLE_MISSING_NAME', category: 'table', locationStrategy: 'block-node' },
  TABLE_DUPLICATE_NAME: { ruleId: 'TABLE_DUPLICATE_NAME', category: 'table', locationStrategy: 'multi-target' },
  CODE_MISSING_NAME: { ruleId: 'CODE_MISSING_NAME', category: 'code', locationStrategy: 'block-node' },
  CODE_MISSING_LANGUAGE: { ruleId: 'CODE_MISSING_LANGUAGE', category: 'code', locationStrategy: 'block-node' },
  CODE_DUPLICATE_NAME: { ruleId: 'CODE_DUPLICATE_NAME', category: 'code', locationStrategy: 'multi-target' },
  FORMULA_DUPLICATE_VISIBLE_TAG: { ruleId: 'FORMULA_DUPLICATE_VISIBLE_TAG', category: 'formula', locationStrategy: 'block-node' },
  LINK_LOCAL_TARGET_MISSING: { ruleId: 'LINK_LOCAL_TARGET_MISSING', category: 'link', locationStrategy: 'block-node' },
}

/** Resolve registry meta by the REAL emitted code (prefix match for LATENT levels). */
export function getRuleMeta(code: string): DocumentDiagnosticRuleMeta | null {
  if (DOCUMENT_DIAGNOSTIC_RULE_REGISTRY[code]) return DOCUMENT_DIAGNOSTIC_RULE_REGISTRY[code]
  if (code.startsWith('LATENT_ATX_HEADING_MARKER')) return DOCUMENT_DIAGNOSTIC_RULE_REGISTRY.LATENT_ATX_HEADING_MARKER
  if (code.startsWith('STRICT_FIRST_H1_')) {
    return { ruleId: 'STRICT_FIRST_H1_POSITION', category: 'document', locationStrategy: 'canonical-node' }
  }
  return null
}

// ── Location Contract Audit ──────────────────────────────

export interface DiagnosticLocationContract {
  diagnosticCount: number
  locatableDiagnosticCount: number
  unlocatableDiagnosticCount: number
  canonicalNodeLocationCount: number
  sourceRangeLocationCount: number
  documentStartLocationCount: number
  documentEndLocationCount: number
  blockNodeLocationCount: number
  multiTargetLocationCount: number
  decision: 'PASS' | 'FAIL'
}

/** A location is "present" iff non-null AND a recognized kind. */
export function hasLocatableLocation(location: DiagnosticLocation | undefined | null): boolean {
  if (!location) return false
  if (location.kind === 'canonical-node') return location.stableIdentity.trim() !== ''
  if (location.kind === 'block-node') return location.stableIdentity.trim() !== ''
  if (location.kind === 'source-range') return Number.isFinite(location.startLine)
  if (location.kind === 'multi-target') return location.targets.length > 0
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
  let documentStart = 0
  let documentEnd = 0
  let blockNode = 0
  let multiTarget = 0
  let locatable = 0
  for (const d of diags) {
    if (!hasLocatableLocation(d.location)) continue
    locatable++
    switch (d.location!.kind) {
      case 'canonical-node': canonicalNode++; break
      case 'source-range': sourceRange++; break
      case 'document-start': documentStart++; break
      case 'document-end': documentEnd++; break
      case 'block-node': blockNode++; break
      case 'multi-target': multiTarget++; break
    }
  }
  const unlocatable = diags.length - locatable
  return {
    diagnosticCount: diags.length,
    locatableDiagnosticCount: locatable,
    unlocatableDiagnosticCount: unlocatable,
    canonicalNodeLocationCount: canonicalNode,
    sourceRangeLocationCount: sourceRange,
    documentStartLocationCount: documentStart,
    documentEndLocationCount: documentEnd,
    blockNodeLocationCount: blockNode,
    multiTargetLocationCount: multiTarget,
    decision: unlocatable === 0 ? 'PASS' : 'FAIL',
  }
}

// ── Universal Resolver ───────────────────────────────────

export type DiagnosticLocationResolveDecision =
  | 'RESOLVED'
  | 'STALE'
  | 'WRONG_DOCUMENT'
  | 'NOT_FOUND'
  | 'UNSUPPORTED'

export interface DiagnosticLocationResolveResult {
  decision: DiagnosticLocationResolveDecision
  /** LIVE DOM target (canonical-node / source-range / block-node / multi-target leaf). */
  element: HTMLElement | null
  /** Document-boundary scroll action (document-start / document-end). */
  scrollAction: 'GO_TOP' | 'GO_BOTTOM' | null
  /** Effective target index within the location (multi-target cycle position). */
  targetIndex: number
  reason?: string
}

export interface DiagnosticLocationResolveContext {
  documentKey: string | null
  getRoot: () => HTMLElement | null
  /** stableIdentity → live heading element (re-derived from the CURRENT frame). */
  resolveHeadingIdentity: (stableIdentity: string) => HTMLElement | null
  /** source line (0-based) → live element carrying Typora `data-line`. */
  resolveSourceLine: (line: number) => HTMLElement | null
  /** block kind + stableIdentity (`block:<kind>:<ordinal>`) → live block element. */
  resolveBlockIdentity: (blockKind: 'figure' | 'table' | 'code' | 'formula' | 'link', stableIdentity: string) => HTMLElement | null
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

  switch (location.kind) {
    case 'canonical-node': {
      const el = ctx.resolveHeadingIdentity(location.stableIdentity)
      return {
        decision: el ? 'RESOLVED' : 'STALE',
        element: el,
        scrollAction: null,
        targetIndex,
        reason: el ? undefined : 'CANONICAL_NODE_NOT_FOUND',
      }
    }
    case 'source-range': {
      const el = ctx.resolveSourceLine(location.startLine)
      return {
        decision: el ? 'RESOLVED' : 'STALE',
        element: el,
        scrollAction: null,
        targetIndex,
        reason: el ? undefined : 'SOURCE_LINE_NOT_FOUND',
      }
    }
    case 'document-start':
      return { decision: 'RESOLVED', element: null, scrollAction: 'GO_TOP', targetIndex }
    case 'document-end':
      return { decision: 'RESOLVED', element: null, scrollAction: 'GO_BOTTOM', targetIndex }
    case 'block-node': {
      const el = ctx.resolveBlockIdentity(location.blockKind, location.stableIdentity)
      return {
        decision: el ? 'RESOLVED' : 'STALE',
        element: el,
        scrollAction: null,
        targetIndex,
        reason: el ? undefined : 'BLOCK_NODE_NOT_FOUND',
      }
    }
    case 'multi-target': {
      if (location.targets.length === 0) {
        return { decision: 'UNSUPPORTED', element: null, scrollAction: null, targetIndex, reason: 'MULTI_TARGET_EMPTY' }
      }
      const idx = ((targetIndex % location.targets.length) + location.targets.length) % location.targets.length
      return resolveDiagnosticLocation(diagnostic, location.targets[idx], ctx, idx)
    }
    default:
      return { decision: 'UNSUPPORTED', element: null, scrollAction: null, targetIndex, reason: 'UNKNOWN_LOCATION_KIND' }
  }
}
