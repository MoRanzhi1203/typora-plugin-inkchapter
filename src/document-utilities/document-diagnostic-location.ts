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
  DOCUMENT_TERMINAL_NEWLINE_MISSING: { ruleId: 'DOCUMENT_TERMINAL_NEWLINE_MISSING', category: 'document', locationStrategy: 'document-end' },
  DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE: { ruleId: 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', category: 'document', locationStrategy: 'document-end' },
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
}

/** Normalize source text for anchor comparison (trim + collapse whitespace). */
export function normalizeSourceAnchorText(text: string | null | undefined): string {
  return (text ?? '').replace(/\r/g, '').replace(/\s+/g, ' ').trim()
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
    case 'source-range': {
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
    default:
      return { decision: 'UNSUPPORTED', element: null, scrollAction: null, targetIndex, reason: 'UNKNOWN_LOCATION_KIND' }
  }
}
