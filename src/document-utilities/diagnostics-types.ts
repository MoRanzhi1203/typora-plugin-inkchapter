/**
 * Phase 7R.3.11 — Document Utilities: diagnostic model types.
 *
 * Presentation/diagnostics layer ONLY. These types describe problems detected
 * from the EXISTING numbering/caption/formula authorities — they never rebuild
 * heading numbering or object scope semantics.
 */

export type DocumentDiagnosticSeverity = 'error' | 'warning' | 'info'

export type DocumentDiagnosticCategory =
  | 'document'
  | 'heading'
  | 'figure'
  | 'table'
  | 'code'
  | 'formula'
  | 'link'

export type DocumentDiagnosticTargetKind =
  | 'document'
  | 'heading'
  | 'object'
  | 'formula'
  | 'link'

/**
 * Phase 7R.3.11.8B.5 — Universal Diagnostic Location.
 *
 * Every published diagnostic carries ONE of these stable locators. The locator
 * NEVER holds a long-lived HTMLElement — it is a stable descriptor that the
 * universal resolver (`resolveDiagnosticLocation`) re-derives into a LIVE DOM
 * target at click time.
 */
export type DiagnosticLocation =
  | {
      kind: 'canonical-node'
      nodeKind: 'heading'
      stableIdentity: string
    }
  | {
      kind: 'source-range'
      startLine: number
      startColumn: number
      endLine?: number
      endColumn?: number
      sourceFingerprint?: string
      /**
       * Scan-time raw text of the anchored source line. The resolver uses it
       * to verify that the element found at `startLine` still carries the
       * scanned content (real source mutation → TARGET_CHANGED) and to
       * re-anchor by text context when the line cannot map to DOM directly
       * (source-only diagnostics such as LATENT_ATX_HEADING_MARKER).
       */
      rawText?: string
    }
  | { kind: 'document-start' }
  | { kind: 'document-end' }
  | {
      kind: 'block-node'
      blockKind: 'figure' | 'table' | 'code' | 'formula' | 'link'
      stableIdentity: string
    }
  | {
      kind: 'multi-target'
      targets: readonly DiagnosticLocation[]
    }

/**
 * Phase 7R.3.11.8B.7.3 — Diagnostic semantic anchor kinds.
 *
 * A semantic anchor is a STRONGER-than-line identity for a diagnostic target,
 * derived from the diagnostic predicate itself (not from the DOM at scan
 * time). It survives DOM reshapes (wrapper insertion, paragraph splits,
 * decorated caption DOM) because resolution re-derives it from the CURRENT
 * frame at click time.
 */
export type DiagnosticSemanticAnchorKind =
  /** Source text block — the predicate is "line contains a latent marker". */
  | 'source-text'
  /** Local resource — the predicate is "local resource target missing". */
  | 'resource'

/**
 * Phase 7R.3.11.8B.7.3 — diagnostic scan-time source validity fingerprint.
 *
 * VALIDITY ≠ DOM RESOLUTION. Every locatable diagnostic carries a fingerprint
 * over the MINIMAL scan-time source fact its predicate depends on:
 *
 *   latent-atx / source-range  → rawText of the anchored source line
 *   resource (missing local)   → the raw Markdown destination path
 *
 * At click time the overlay re-reads the CURRENT Markdown at the same
 * position and recomputes the fingerprint. A MISMATCH is a REAL source-level
 * change (STALE); a MATCH means the diagnostic is STILL_VALID even when the
 * DOM cannot be resolved right now (UNRESOLVED, never STALE).
 */
export type DiagnosticValidityFingerprint =
  | {
      kind: 'source-text'
      /** 0-based source line whose text must still equal `text`. */
      line: number
      /** Normalized scan-time raw text of that line. */
      text: string
    }
  | {
      kind: 'resource'
      /** Normalized scan-time Markdown destination (e.g. "phase6-test.png"). */
      path: string
      /** Resource occurrence ordinal (1-based) among identical destinations. */
      occurrence: number
    }

export interface DocumentDiagnosticLocatorDescriptor {
  kind: DocumentDiagnosticTargetKind
  /** The current DOM target (may be null when the target no longer exists). */
  targetElement: HTMLElement | null
  /** Phase 7R.3.11.8-B: document-level locate via the shared Scroll Operation
   *  authority (GO_TOP for NO_H1, GO_BOTTOM for EOF) instead of an element. */
  action?: 'GO_TOP' | 'GO_BOTTOM'
}

export interface DocumentDiagnostic {
  /** Deterministic identity for deduplication / React keys. */
  id: string
  documentKey: string
  severity: DocumentDiagnosticSeverity
  category: DocumentDiagnosticCategory
  /** Stable machine code, e.g. HEADING_GAP. */
  code: string
  message: string
  detail?: string
  /** Existing canonical stable identity when available (never invented here). */
  stableIdentity?: string
  /** Dedup key for the same root cause. */
  targetIdentity?: string
  /** Locator descriptor (may be null when no DOM target exists). */
  locator?: DocumentDiagnosticLocatorDescriptor
  /** Phase 7R.3.11.8-B: rule-specific structured metadata (popup fingerprint etc.). */
  metadata?: Record<string, unknown>
  /**
   * Phase 7R.3.11.8B.7.3 — scan-time source validity fingerprint. Absent =
   * the diagnostic is treated as always-valid until a live recompute retires
   * it (structure rules with canonical identities). Source-syntax and
   * resource rules MUST carry one so "target changed" is a PROVEN verdict.
   */
  validityFingerprint?: DiagnosticValidityFingerprint
  /**
   * Phase 7R.3.11.8B.5 — Universal Location Authority. Every published
   * Error/Warning/Hint diagnostic MUST carry a non-null `location`
   * (PUBLISHED = LOCATABLE). Producers attach it; the overlay's locate button
   * resolves it via `resolveDiagnosticLocation`.
   */
  location?: DiagnosticLocation
}

export interface DocumentDiagnosticsSnapshot {
  documentKey: string | null
  /** Monotonic diagnostic recompute revision (per authority). */
  revision: number
  /** Source generation identity — increments when the document key changes. */
  sourceRevision: number
  /** Wall-clock generation time. */
  generatedAt: number
  diagnostics: readonly DocumentDiagnostic[]
  errorCount: number
  warningCount: number
  infoCount: number
  /**
   * Phase 7R.3.11.8B.7.1 — Mode provenance. The snapshot is ONLY authoritative
   * for the effective heading structure mode it was computed with. A mode
   * change MUST produce a new snapshot even when the content is unchanged.
   */
  effectiveMode?: 'strict' | 'loose'
  /** Effective-mode transition revision (increments on REAL transitions only). */
  effectiveModeRevision?: number
}

export interface DocumentDiagnosticsState {
  /** e.g. 'NO_ACTIVE_DOCUMENT' | 'EMPTY_DOCUMENT' | 'HEALTHY' | 'HAS_ISSUES' */
  state: 'NO_ACTIVE_DOCUMENT' | 'EMPTY_DOCUMENT' | 'HEALTHY' | 'HAS_ISSUES'
  errorCount: number
  warningCount: number
  infoCount: number
}
