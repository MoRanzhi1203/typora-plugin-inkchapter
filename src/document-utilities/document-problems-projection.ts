/**
 * V4 — Problems Control projection (pure). Single derivation chain:
 *
 *   DiagnosticsSnapshot → deriveDocumentProblemsProjection() → CurrentProblemsProjection
 *
 * Toolbar / Drawer MUST consume this projection; neither keeps its own
 * error/warning cache.
 *
 * VNext Presentation Closure V1.1 §21 — the severity counts are delegated to the
 * ONE `countDocumentSeverities` authority (shared with the Drawer tabs); this
 * module no longer keeps a second counting implementation. Severity mapping stays
 * strict: error → errorCount, warning → warningCount, info/hint → hintCount.
 * Unknown severities are SKIPPED — never defaulted into error, never mapped by
 * array order or by UI segment position.
 */
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { countDocumentSeverities, selectDocumentDiagnostics } from './diagnostic-domain-v1'

export type ProblemsSeverity = 'error' | 'warning' | 'hint'

export interface CurrentProblemsProjection {
  documentKey: string | null
  revision: number | null
  sourceRevision: number | null
  errorCount: number
  warningCount: number
  hintCount: number
  totalCount: number
  healthy: boolean
  hasProjection: boolean
}

export function deriveDocumentProblemsProjection(snapshot: DocumentDiagnosticsSnapshot | null): CurrentProblemsProjection {
  if (!snapshot) {
    return { documentKey: null, revision: null, sourceRevision: null, errorCount: 0, warningCount: 0, hintCount: 0, totalCount: 0, healthy: false, hasProjection: false }
  }
  // §22 — the Toolbar reads ONLY the DOCUMENT domain (a runtime FAIL can never
  // inflate the Error / Warning / Hint badges).
  const documentDiagnostics = selectDocumentDiagnostics(snapshot.diagnostics)
  // §21 — unknown severities are skipped (never error, never positional) BEFORE
  // the single counting authority runs.
  const counted = documentDiagnostics.filter(d =>
    d.severity === 'error' || d.severity === 'warning' || d.severity === 'info'
      || (d.severity as string) === 'hint',
  )
  const counts = countDocumentSeverities(counted as readonly { severity: string }[])
  const errorCount = counts.error
  const warningCount = counts.warning
  const hintCount = counts.info
  const totalCount = errorCount + warningCount + hintCount
  return {
    documentKey: snapshot.documentKey,
    revision: snapshot.revision,
    sourceRevision: snapshot.sourceRevision,
    errorCount,
    warningCount,
    hintCount,
    totalCount,
    healthy: totalCount === 0,
    hasProjection: true,
  }
}
