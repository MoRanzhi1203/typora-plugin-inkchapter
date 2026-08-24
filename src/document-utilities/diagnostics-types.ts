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

export interface DocumentDiagnosticLocatorDescriptor {
  kind: DocumentDiagnosticTargetKind
  /** The current DOM target (may be null when the target no longer exists). */
  targetElement: HTMLElement | null
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
