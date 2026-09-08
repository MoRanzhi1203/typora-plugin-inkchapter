/**
 * V4 — Problems Control projection (pure). Single derivation chain:
 *
 *   DiagnosticsSnapshot → deriveDocumentProblemsProjection() → CurrentProblemsProjection
 *
 * Toolbar / Drawer MUST consume this projection; neither keeps its own
 * error/warning cache. Severity mapping is strict:
 *   error → errorCount, warning → warningCount, hint → hintCount
 * Unknown severities are SKIPPED — never defaulted into error, never mapped by
 * array order or by UI segment position.
 */
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

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
  let errorCount = 0
  let warningCount = 0
  let hintCount = 0
  for (const d of snapshot.diagnostics) {
    if (d.severity === 'error') errorCount++
    else if (d.severity === 'warning') warningCount++
    else if (d.severity === 'info' || d.severity === 'hint') hintCount++
    // unknown severity → skipped (never error, never positional).
  }
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
