/**
 * V5.12-R6 — Empty Document Diagnostic Short-Circuit (pure contract).
 *
 * THE DEFECT (proved by the real runtime fixture
 * `regression/r58/r58-automation-input-smoke.md`, BOM + CRLF only):
 *   a semantically EMPTY Markdown document still produced Strict-H1 errors
 *   ("当前未检测到 H1"), first-H1 warnings ("一级标题必须位于文档首行") AND the
 *   "文档为空" notice side by side — 全部 3 / 错误 1 / 警告 1 / 提示 1.
 *
 *   ROOT_R6_1 = DOCUMENT_EMPTY_IS_IMPLEMENTED_AS_A_PEER_DIAGNOSTIC_INSTEAD_OF_PIPELINE_SHORT_CIRCUIT
 *   ROOT_R6_2 = STRICT_HEADING_RULES_RUN_BEFORE_EMPTY_DOCUMENT_AUTHORITY
 *   ROOT_R6_3 = EMPTY_DOCUMENT_AND_HEADING_COUNT_ZERO_ARE_CONFLATED
 *   ROOT_R6_4 = EMPTY_DIAGNOSTIC_IS_ADDED_AFTER_OTHER_DIAGNOSTICS_INSTEAD_OF_RETURNING_AN_EXCLUSIVE_SNAPSHOT
 *   ROOT_R6_5 = PROBLEMS_COUNTERS_REFLECT_THE_UNSHORTCIRCUITED_SNAPSHOT
 *
 * The ONE authority introduced here is the minimal, deterministic predicate
 *   `source.trim().length === 0 → SEMANTIC_EMPTY_DOCUMENT`
 * plus the measurement helpers that PROVE the short-circuit is exclusive.
 * No DOM access, no Typora runtime, no heading parser, no async, no side effect.
 */

export const EMPTY_DOCUMENT_SHORT_CIRCUIT_AUDIT_EVENT =
  'DOCUMENT-DIAGNOSTIC-EMPTY-SHORT-CIRCUIT-AUDIT'

/** The ONE diagnostic an empty document may publish. */
export const DOCUMENT_EMPTY_DIAGNOSTIC_CODE = 'DOCUMENT_EMPTY'

/** The exclusive-snapshot reason carried by the short-circuit audit. */
export const EMPTY_DOCUMENT_EXCLUSIVE_REASON = 'EMPTY_DOCUMENT_EXCLUSIVE_DIAGNOSTIC'

/**
 * §3 — the MINIMAL stable empty-document definition.
 *
 * `String.prototype.trim()` removes WhiteSpace + LineTerminator, which includes
 * the UTF-8 BOM (U+FEFF / ZWNBSP). The real fixture is BOM + CRLF only, so this
 * predicate is exactly the contract the runtime needs. Deliberately NOT a
 * Markdown-semantics blank parser: HTML comments / front matter / unclosed
 * blocks are OUT of scope for this round.
 */
export function isSemanticallyEmptyDocument(source: string | null | undefined): boolean {
  if (source == null) return false
  return source.trim().length === 0
}

/** §10 — rule families used ONLY to MEASURE leaked diagnostics (never to filter). */
export type DocumentDiagnosticRuleFamily =
  | 'emptyNotice'
  | 'strictH1'
  | 'headingStructure'
  | 'object'
  | 'resource'
  | 'eof'
  | 'documentOther'

/**
 * §10/§15 — classify a diagnostic code into the rule family it belongs to.
 * This is a MEASUREMENT helper for the audit counters: the production fix is a
 * pipeline short-circuit, never a ruleId blacklist.
 */
export function classifyDocumentDiagnosticRuleFamily(code: string): DocumentDiagnosticRuleFamily {
  if (code === DOCUMENT_EMPTY_DIAGNOSTIC_CODE) return 'emptyNotice'
  if (code.startsWith('STRICT_FIRST_H1_')) return 'strictH1'
  if (code === 'STRICT_SINGLE_H1_NO_H1' || code === 'STRICT_SINGLE_H1_MULTIPLE_H1') return 'strictH1'
  if (
    code === 'HEADING_DUPLICATE_IDENTITY'
    || code === 'HEADING_DUPLICATE_TEXT'
    || code === 'HEADING_EMPTY_TEXT'
    || code === 'HEADING_LEVEL_GAP'
    || code === 'LATENT_ATX_HEADING_MARKER'
  ) {
    return 'headingStructure'
  }
  if (code === 'FIGURE_LOCAL_IMAGE_MISSING' || code === 'LINK_LOCAL_TARGET_MISSING') return 'resource'
  if (code.startsWith('FIGURE_') || code.startsWith('TABLE_') || code.startsWith('CODE_') || code.startsWith('FORMULA_')) {
    return 'object'
  }
  if (code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING' || code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE') return 'eof'
  return 'documentOther'
}

/** §15 — the R6 hard-gate counters. ALL must be 0 for a PASS. */
export const EMPTY_DOCUMENT_V512R6_GATE_KEYS = [
  'emptyDocumentNonEmptyDiagnosticCount',
  'emptyDocumentErrorCount',
  'emptyDocumentWarningCount',
  'emptyDocumentStrictH1DiagnosticCount',
  'emptyDocumentHeadingStructureDiagnosticCount',
  'emptyDocumentObjectDiagnosticCount',
  'emptyDocumentResourceDiagnosticCount',
  'emptyDocumentEofDiagnosticCount',
  'emptyDocumentDiagnosticCountNotOne',
  'emptyDocumentUiCountSnapshotMismatchCount',
  'emptyDocumentLocatableDiagnosticCount',
  'emptyDocumentStaleDiagnosticResidueCount',
  'emptyDocumentStaleRevisionCommitCount',
] as const

export type EmptyDocumentV512R6GateKey = typeof EMPTY_DOCUMENT_V512R6_GATE_KEYS[number]

export const EMPTY_DOCUMENT_V512R6_GATE_LABELS: Record<EmptyDocumentV512R6GateKey, string> = {
  emptyDocumentNonEmptyDiagnosticCount: 'EMPTY_DOCUMENT_NON_EMPTY_DIAGNOSTIC_COUNT',
  emptyDocumentErrorCount: 'EMPTY_DOCUMENT_ERROR_COUNT',
  emptyDocumentWarningCount: 'EMPTY_DOCUMENT_WARNING_COUNT',
  emptyDocumentStrictH1DiagnosticCount: 'EMPTY_DOCUMENT_STRICT_H1_DIAGNOSTIC_COUNT',
  emptyDocumentHeadingStructureDiagnosticCount: 'EMPTY_DOCUMENT_HEADING_STRUCTURE_DIAGNOSTIC_COUNT',
  emptyDocumentObjectDiagnosticCount: 'EMPTY_DOCUMENT_OBJECT_DIAGNOSTIC_COUNT',
  emptyDocumentResourceDiagnosticCount: 'EMPTY_DOCUMENT_RESOURCE_DIAGNOSTIC_COUNT',
  emptyDocumentEofDiagnosticCount: 'EMPTY_DOCUMENT_EOF_DIAGNOSTIC_COUNT',
  emptyDocumentDiagnosticCountNotOne: 'EMPTY_DOCUMENT_DIAGNOSTIC_COUNT_NOT_ONE',
  emptyDocumentUiCountSnapshotMismatchCount: 'EMPTY_DOCUMENT_UI_COUNT_SNAPSHOT_MISMATCH_COUNT',
  emptyDocumentLocatableDiagnosticCount: 'EMPTY_DOCUMENT_LOCATABLE_DIAGNOSTIC_COUNT',
  emptyDocumentStaleDiagnosticResidueCount: 'EMPTY_DOCUMENT_STALE_DIAGNOSTIC_RESIDUE_COUNT',
  emptyDocumentStaleRevisionCommitCount: 'EMPTY_DOCUMENT_STALE_REVISION_COMMIT_COUNT',
}

/** §15 — `EMPTY_DOCUMENT_HINT_COUNT` is a VALUE assertion, never a counter. */
export const EMPTY_DOCUMENT_EXPECTED_HINT_COUNT = 1

export function createEmptyDocumentV512R6Counters(): Record<EmptyDocumentV512R6GateKey, number> {
  const out = {} as Record<EmptyDocumentV512R6GateKey, number>
  for (const key of EMPTY_DOCUMENT_V512R6_GATE_KEYS) out[key] = 0
  return out
}

export function formatEmptyDocumentV512R6GateReport(
  counters: Readonly<Record<EmptyDocumentV512R6GateKey, number>>,
): string[] {
  return EMPTY_DOCUMENT_V512R6_GATE_KEYS.map(
    key => `${EMPTY_DOCUMENT_V512R6_GATE_LABELS[key]}=${counters[key] ?? 0}`,
  )
}

export function evaluateEmptyDocumentV512R6Gates(
  counters: Readonly<Record<EmptyDocumentV512R6GateKey, number>>,
): { decision: 'PASS' | 'FAIL'; failing: string[] } {
  const failing = EMPTY_DOCUMENT_V512R6_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return {
    decision: failing.length === 0 ? 'PASS' : 'FAIL',
    failing: failing.map(key => EMPTY_DOCUMENT_V512R6_GATE_LABELS[key]),
  }
}

/** Minimal diagnostic shape the measurement helpers consume. */
export interface EmptyDocumentMeasuredDiagnostic {
  id?: string
  code: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  /** `hasLocatableLocation(d.location)` — precomputed by the caller (pure). */
  locatable: boolean
}

export interface EmptyDocumentShortCircuitMeasurementInput {
  /** true when `isSemanticallyEmptyDocument(source)` AND a document is active. */
  shortCircuitActive: boolean
  diagnostics: readonly EmptyDocumentMeasuredDiagnostic[]
  errorCount: number
  warningCount: number
  hintCount: number
  /** UI projection counts derived from the SAME snapshot (never hand-written). */
  uiErrorCount: number
  uiWarningCount: number
  uiHintCount: number
  uiTotalCount: number
  /** Diagnostic ids published by the PREVIOUS snapshot (stale-residue proof). */
  previousDiagnosticIds: readonly string[]
}

/**
 * §15 — measure the R6 gate values from a committed snapshot. Pure: the caller
 * increments counters with the returned (always non-negative) deltas. All
 * values are 0 for a correct exclusive `[DOCUMENT_EMPTY]` snapshot.
 */
export function measureEmptyDocumentShortCircuit(
  input: EmptyDocumentShortCircuitMeasurementInput,
): Record<EmptyDocumentV512R6GateKey, number> {
  const out = createEmptyDocumentV512R6Counters()
  if (!input.shortCircuitActive) return out

  const previousIds = new Set(input.previousDiagnosticIds)
  for (const d of input.diagnostics) {
    const family = classifyDocumentDiagnosticRuleFamily(d.code)
    if (family !== 'emptyNotice') out.emptyDocumentNonEmptyDiagnosticCount++
    if (d.severity === 'error') out.emptyDocumentErrorCount++
    if (d.severity === 'warning') out.emptyDocumentWarningCount++
    if (family === 'strictH1') out.emptyDocumentStrictH1DiagnosticCount++
    else if (family === 'headingStructure') out.emptyDocumentHeadingStructureDiagnosticCount++
    else if (family === 'object') out.emptyDocumentObjectDiagnosticCount++
    else if (family === 'resource') out.emptyDocumentResourceDiagnosticCount++
    else if (family === 'eof') out.emptyDocumentEofDiagnosticCount++
    if (d.locatable) out.emptyDocumentLocatableDiagnosticCount++
    // §13 — a non-empty diagnostic that also existed in the PREVIOUS snapshot is
    // stale residue: the switch to empty did not atomically replace the list.
    if (family !== 'emptyNotice' && d.id != null && previousIds.has(d.id)) {
      out.emptyDocumentStaleDiagnosticResidueCount++
    }
  }
  if (input.diagnostics.length !== 1) out.emptyDocumentDiagnosticCountNotOne = 1

  // §11 — the UI counters are PROJECTED from the snapshot; a mismatch means
  // somebody hand-overrode the counts instead of fixing the data layer.
  const uiTotal = input.uiErrorCount + input.uiWarningCount + input.uiHintCount
  const mismatch =
    input.uiErrorCount !== input.errorCount
    || input.uiWarningCount !== input.warningCount
    || input.uiHintCount !== input.hintCount
    || input.uiTotalCount !== input.errorCount + input.warningCount + input.hintCount
    || uiTotal !== input.uiTotalCount
  if (mismatch) out.emptyDocumentUiCountSnapshotMismatchCount = 1

  return out
}

/** §19 — the correct empty-document decision token. */
export function emptyDocumentShortCircuitDecision(
  counters: Readonly<Record<EmptyDocumentV512R6GateKey, number>>,
): 'PASS' | 'FAIL' {
  return evaluateEmptyDocumentV512R6Gates(counters).decision
}
