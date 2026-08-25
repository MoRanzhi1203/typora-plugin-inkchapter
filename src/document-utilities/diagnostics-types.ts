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
}

export interface DocumentDiagnosticsState {
  /** e.g. 'NO_ACTIVE_DOCUMENT' | 'EMPTY_DOCUMENT' | 'HEALTHY' | 'HAS_ISSUES' */
  state: 'NO_ACTIVE_DOCUMENT' | 'EMPTY_DOCUMENT' | 'HEALTHY' | 'HAS_ISSUES'
  errorCount: number
  warningCount: number
  infoCount: number
}
