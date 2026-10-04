/**
 * Phase 7R.3.11 — Document Diagnostics Authority (event-driven).
 *
 * Holds ONE committed snapshot per active document. Recompute is triggered by
 * the overlay host on relevant events (document switch, canonical frame
 * commit, caption/formula state change, manual recheck) — NEVER by timers or
 * polling. It consumes existing authorities and never derives numbering
 * semantics itself.
 */
import {
  DOCUMENT_HEADING_ONLY_NO_BODY_CODE,
  HEADING_AUTO_NUMBER_CONFLICT_CODE,
  computeDocumentDiagnostics,
  computeEofNewlinePolicy,
  hasSubstantiveNonHeadingContent,
  mergeDocumentDiagnostics,
} from './document-diagnostics'
// Heading Auto-Number Conflict V1.2 §3–§47 — the ONE per-heading evidence-state
// audit + transition classifier + hard-gate + positive-coverage authority for
// `HEADING_AUTO_NUMBER_CONFLICT`.
import {
  HEADING_AUTO_NUMBER_CONFLICT_AUDIT_EVENT,
  HEADING_AUTO_NUMBER_CONFLICT_DYNAMIC_AUDIT_EVENT,
  applyHeadingAutoNumberConflictFailure,
  createHeadingAutoNumberConflictCounters,
  createHeadingAutoNumberConflictCoverage,
  evaluateHeadingAutoNumberConflictCoverage,
  evaluateHeadingAutoNumberConflictDualPass,
  evaluateHeadingAutoNumberConflictFacts,
  evaluateHeadingAutoNumberConflictGates,
  evaluateHeadingAutoNumberConflictTransition,
  formatHeadingAutoNumberConflictCoverageReport,
  formatHeadingAutoNumberConflictGateReport,
  headingAutoNumberConflictTransactionKey,
  noteHeadingAutoNumberConflictCoverage,
  noteHeadingAutoNumberConflictCoverageForReason,
  type HeadingAutoNumberConflictCounters,
  type HeadingAutoNumberConflictCoverage,
  type HeadingAutoNumberConflictEvidenceState,
  type HeadingAutoNumberConflictReportEnvelope,
} from './document-diagnostics-heading-auto-number-conflict-v1'
// The SAME parser authority the producer uses — the audit classifies the
// generated prefix with it so no second classifier exists.
import {
  detectLegacyManualNumberPrefix,
  resolveHeadingManualNumberPrefix,
} from './document-diagnostics-heading-manual-number-prefix-v1'
import { isSemanticallyEmptyDocument } from './document-diagnostic-empty-short-circuit-v512-r6'
import type {
  DiagnosticFormulaFact,
  DiagnosticH1Fact,
  DiagnosticHeadingFact,
  DiagnosticLinkFact,
  DiagnosticObjectFact,
  DocumentDiagnosticsComputed,
  DocumentDiagnosticsInput,
  HeadingDiagnosticAuthority,
  LatentAtxMarkerInput,
} from './document-diagnostics'
import type { DocumentDiagnostic } from './diagnostics-types'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
// V1 — Markdown literal exclusion: the runtime audit + hard gates that prove
// inline code / fenced code syntax never reaches the business layer.
import {
  FIGURE_LITERAL_EXCLUSION_AUDIT,
  MARKDOWN_LITERAL_EXCLUSION_AUDIT,
  evaluateFigureLiteralExclusionV1Gates,
  evaluateLiteralExclusionAgainstDiagnostics,
  formatFigureLiteralExclusionV1GateReport,
} from './document-markdown-literal-exclusion-v1'
import { scanAdmittedReferenceCounts, scanAdmittedReferenceSpans } from './document-resource-scanner'
import type { OutlineDiagnosticTargetInput } from './document-diagnostic-outline-projection-v514-r2'
import { collectDiagnosticsInput, resolveBusinessContentRoot, type DocumentUtilitiesContext } from './document-utilities-context'
import type {
  DiagnosticCanonicalHeadingAuthorityResult,
  DiagnosticCanonicalHeadingFact,
} from './document-h1-authority-bridge'
import {
  detectLatentAtxMarkers,
  collectCanonicalHeadingOwnedLines,
  collectCanonicalHeadingSourceLines,
  collectCanonicalHeadingTextKeys,
  type LatentAtxMarkerFact,
} from './latent-atx-heading-marker'
import {
  buildFigureSourceOccurrences,
  linkOccurrenceIndex,
  resolveResourceSemanticPath,
  normalizeResourceToken,
  type FigureSourceOccurrence,
} from './document-diagnostics'
import type { ImageSourceOccurrence, ResourceClass } from './document-resource-scanner'
// V5.15 — Standalone Object Block Invariant (DOM projection of the gate).
import {
  analyzeFigureBlockStructureDom,
  noteFigureBlockAdmission,
  beginFigureBlockStructureV515DomPass,
  getFigureBlockStructureV515GateReport,
  getFigureBlockStructureV515CoverageReport,
  getFigureBlockStructureV515GateDecision,
  FIGURE_BLOCK_STRUCTURE_INVALID_CODE,
  DOCUMENT_DIAGNOSTIC_STANDALONE_OBJECT_BLOCK_AUDIT,
  type FigureBlockStructureResult,
} from './document-standalone-object-block-invariant-v515'
import {
  computeDiagnosticLocationContract,
  getRuleMeta,
} from './document-diagnostic-location'
// Capability Matrix V1 §14 — the ONE read-only capability count authority.
import { DOCUMENT_DIAGNOSTICS_CAPABILITY_AUDIT_EVENT } from './document-diagnostic-capability-summary'
// Capability Matrix V2 §19/§22 — the ONE Runtime Closure Authority (the §19
// capability audit is DERIVED from it, never hand-written).
import { resolveDocumentDiagnosticsCapabilityAudit } from './document-diagnostic-runtime-closure-authority'
import { emitRuntimeAudit, emitRuntimeAuditStateDedup } from '../runtime/forensic-log-sink'

export interface DocumentDiagnosticsProviders {
  /** Formula visible tag tokens via the existing projection authority (read-only). */
  getFormulaVisibleTagTokens: (host: HTMLElement) => string[]
  /** Figure name from the caption authority (null when unnamed). */
  getFigureName: (img: HTMLElement) => string | null
  getTableName: (el: HTMLElement) => string | null
  getCodeName: (el: HTMLElement) => string | null
  getCodeLanguage: (el: HTMLElement) => string | null
  /** Resolve an image's local path; returns { localPath } ONLY when missing. */
  resolveImageLocalPath: (img: HTMLElement) => { localPath: string | null }
  /** True when a local relative link target does not exist. */
  isLinkTargetMissing: (target: string) => boolean
  /** Canonical heading stable identity by element (from the canonical frame). */
  getHeadingIdentity: (el: HTMLElement) => string | null
  /** Parse markdown into local link targets (authority-driven, no network).
   *  Phase 7R.3.11.8B.7.3 — facts may carry `resourceKind: 'image' | 'link'`
   *  (image Markdown → img DOM target). */
  parseLocalLinkTargets: (markdown: string) => Array<string | { target: string; resourceKind?: 'image' | 'link'; sourceStart?: number; sourceEnd?: number; startLine?: number; endLine?: number; startColumn?: number; endColumn?: number; rawText?: string; destinationStart?: number; destinationEnd?: number; rawToken?: string; altText?: string; resourceClass?: ResourceClass }>
  /**
   * V5.12-R8 §4 — EVERY Markdown image occurrence (full token range +
   * destination range + alt text + resource class), from the SINGLE scanner
   * authority. Optional: when absent, figure missing-name falls back to the
   * legacy DOM-figure facts (pure/legacy callers only).
   */
  parseImageSourceOccurrences?: (markdown: string) => ImageSourceOccurrence[]
  /** Phase 7R.3.11.8B.1 — canonical H1 authority bridge result (WAIT/INVALID/READY).
   *  Optional so tests that never exercise STRICT-SINGLE-H1 need no stub. */
  getCanonicalH1Facts?: () => DiagnosticCanonicalHeadingAuthorityResult
  /** Phase 7R.3.11.8B.7.6 — rendered caption host for a business object
   *  element (img/table/pre) — compound missing-name locator. Optional. */
  getObjectCaptionHost?: (el: HTMLElement) => HTMLElement | null
  /**
   * V5.14-R2 §P8 — publish the CURRENT heading diagnostic occurrences so the
   * left outline can mirror them (COMMITTED mappings only). Optional.
   */
  publishOutlineHeadingDiagnostics?: (targets: readonly OutlineDiagnosticTargetInput[]) => void
  /**
   * Heading Auto-Number Conflict V1.2 §21/§22 — the ONE post-commit report capture
   * sink. Called at the END of a committed recompute (after a REPORT_ONLY request),
   * never right after a setter. Optional.
   */
  onHeadingConflictReportCapture?: (capture: {
    runtimeSessionId: string
    reportSequence: number
    settingsRevision: number
    sourceRevision: number
    diagnosticsRevision: number
    baselineEstablished: boolean
    capturePhase: 'POST_COMMIT'
    dualPass: { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[]; unmet: readonly string[] }
    gateReport: string[]
    coverageReport: string[]
  }) => void
  /**
   * Heading Auto-Number Conflict V1 §2/§4 — the ONE per-heading heading
   * auto-numbering EFFECTIVENESS authority (the numbering service's own verdict).
   * Optional: absent ⇒ no heading is "effectively numbered" and the conflict rule
   * stays silent (pure/legacy callers).
   */
  getHeadingAutoNumberingEffectiveFacts?: () => {
    enabled: boolean
    h1NumberingEnabled: boolean
    /** Heading Auto-Number Conflict V1.2 §13 — the effective STYLE identity. */
    styleKey?: string
    isEffectiveForElement: (element: HTMLElement | null) => boolean
  }
  /**
   * Heading Auto-Number Conflict V1.2 §21/§22 — the ONE dev/test bridge
   * consumption point. Invoked at the START of every recompute (the toolbar
   * 「重新检查文档」 button drives it deterministically), so the bridge never
   * depends on an OS-level focus/selection event. main.ts owns the file IO +
   * the official-setter call; this module only requests it. Optional.
   */
  consumeHeadingConflictTestBridge?: () => void
  /**
   * Phase G (spec §8) — the DOM-side Caption Integrity producer. It returns the
   * caption-integrity diagnostics for the CURRENT document (ownership resolved
   * ONLY through the caption service's canonical owner map). Merged into the
   * SAME snapshot as the source-only diagnostics. Optional: absent ⇒ no caption
   * integrity diagnostics (pure / legacy callers).
   */
  getCaptionIntegrityDiagnostics?: (
    documentKey: string | null,
    sourceRevision: number,
  ) => readonly DocumentDiagnostic[]
}

export class DocumentDiagnosticsAuthority {
  private snapshot: DocumentDiagnosticsSnapshot | null = null
  private revision = 0
  private sourceRevision = 0
  private lastDocumentKey: string | null = null
  private lastContentFingerprint = ''
  /** Phase 7R.3.11.8B.1 — H1 authority bridge audit dedup (state-token). */
  private lastH1BridgeSignature = ''
  /** Phase 7R.3.11.8B.2 — H1 authority invariant audit dedup (state-token). */
  private lastH1InvariantSignature = ''
  /** Phase 7R.3.11.8B.4.1 — latent ATX marker transition dedup (state-token). */
  private lastLatentAtxSignature = ''
  /** V1 — literal-exclusion audit dedupe (state-token). */
  private lastLiteralExclusionSignature = ''
  /** Heading Auto-Number Conflict V1 §44/§46/§47 — gate + coverage counters. */
  private countersHeadingAutoNumberConflict: HeadingAutoNumberConflictCounters =
    createHeadingAutoNumberConflictCounters()
  private coverageHeadingAutoNumberConflict: HeadingAutoNumberConflictCoverage =
    createHeadingAutoNumberConflictCoverage()
  /** §44 — the conflict-set signature of the last audited recompute. */
  private lastConflictSignature = ''
  /**
   * §7 — the RUNTIME SESSION identity of this plugin instance (one Typora
   * process). The evidence state is isolated by `runtimeSessionId|documentKey`.
   */
  private readonly conflictRuntimeSessionId: string = `ic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  /** §3/§4 — the ONE per-heading evidence state (kept even when conflict=false). */
  private conflictEvidenceStates = new Map<string, HeadingAutoNumberConflictEvidenceState>()
  /** §7 — the (session|document) scope the evidence state belongs to. */
  private conflictDynamicScopeKey = ''
  /** §6 — the first complete snapshot only establishes the baseline. */
  private conflictBaselineEstablished = false
  /** §19 — transaction dedup keys already counted (one transaction = one bump). */
  private conflictCoverageTransactions = new Set<string>()
  /** §21/§22 — a REPORT_ONLY request waiting for the next diagnostics commit. */
  private conflictPendingReport = false
  /** §20 — monotonic report sequence inside this runtime session. */
  private conflictReportSequence = 0
  /** V5.15 — the figure owning-block structure results of the last DOM pass. */
  private lastFigureStructureResults: FigureBlockStructureResult[] = []
  private listeners = new Set<(snapshot: DocumentDiagnosticsSnapshot | null) => void>()

  constructor(
    private ctx: DocumentUtilitiesContext,
    private providers: DocumentDiagnosticsProviders,
  ) {}

  getSnapshot(): DocumentDiagnosticsSnapshot | null {
    return this.snapshot
  }

  /** Current source generation identity (increments on document key change). */
  getSourceRevision(): number {
    return this.sourceRevision
  }

  subscribe(listener: (snapshot: DocumentDiagnosticsSnapshot | null) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const l of this.listeners) l(this.snapshot)
  }

  /** Recompute from current authorities. Event-driven only. */
  recompute(reason: string = 'AUTO'): void {
    const structural = this.collectStructuralFacts()
    const input = collectDiagnosticsInput(this.ctx, structural)
    if (input.documentKey !== this.lastDocumentKey) {
      this.sourceRevision++
      this.lastDocumentKey = input.documentKey
    }
    // V1 §21 — the figure locator records the EXACT source generation this
    // compute runs against, so a later click can detect a stale revision.
    input.sourceRevision = this.sourceRevision
    // Phase 7R.3.11.8B.4 — severity transition log (strict/loose switch only).
    this.emitHeadingSeverityTransition(input.documentKey, input.strictMode)
    const computed = computeDocumentDiagnostics(input)
    // Phase G §8 — merge the DOM-side caption-integrity diagnostics (when a
    // producer is wired) into the SAME snapshot the Drawer / location contract
    // consume. Never a second pipeline, never a second registry.
    const captionDiagnostics = this.collectCaptionIntegrityDiagnostics(input.documentKey)
    const merged = mergeDocumentDiagnostics(computed.diagnostics, captionDiagnostics)
    // Heading Auto-Number Conflict V1 §44/§45 — the ONE runtime audit for the
    // conflict rule (state-deduped; event-driven, never a poll).
    this.emitHeadingAutoNumberConflictAudits(input, computed)
    // V1 §37 — low-frequency, state-deduped audit for the single-heading-no-body
    // hint (never per block, never per mutation).
    this.emitHeadingOnlyHintAudit(input, computed)
    // V5.15 §16/§17 — ONE standalone-object-block audit per recompute, emitted
    // AFTER the source structure diagnostics were computed, so the gate report
    // and the coverage report always describe the SAME snapshot.
    this.emitStandaloneObjectBlockInvariantAudit(computed.diagnostics)
    // V1 §26/§27 — the literal exclusion audit + hard gates (inline / fenced code).
    this.emitLiteralExclusionAudit(input.markdown, computed.diagnostics)
    // Only a PASSING canonical authority may emit the real-gap audit — a
    // polluted sequence (invariant FAIL) must never publish gap facts.
    if (structural.headingAuthority?.decision === 'PASS') {
      this.emitHeadingGapInputIfAny(structural.headings, input.documentKey)
    }
    this.revision++
    // Phase 7R.3.11.8B.7.1 — mode provenance: the snapshot records the
    // effective heading structure mode + transition revision it was computed
    // with. CONTENT UNCHANGED + MODE CHANGED = NEW AUTHORITATIVE SNAPSHOT.
    const effectiveMode: 'strict' | 'loose' = input.strictMode ? 'strict' : 'loose'
    const effectiveModeRevision = this.ctx.authority.getEffectiveHeadingModeRevision?.() ?? 0
    const nextSnapshot: DocumentDiagnosticsSnapshot = {
      documentKey: input.documentKey,
      revision: this.revision,
      sourceRevision: this.sourceRevision,
      generatedAt: Date.now(),
      diagnostics: merged.diagnostics,
      errorCount: merged.errorCount,
      warningCount: merged.warningCount,
      infoCount: merged.infoCount,
      effectiveMode,
      effectiveModeRevision,
    }
    // Phase 7R.3.11.8B.7.1 — the semantic fingerprint MUST include the mode
    // provenance: same content + different mode = different fingerprint.
    // Phase 7R.3.11.8-B §32 — identical-state recomputes do NOT re-publish.
    const fingerprint = `${nextSnapshot.documentKey ?? ''}|mode:${effectiveMode}:${effectiveModeRevision}|${nextSnapshot.diagnostics
      .map(d => `${d.severity}:${d.code}:${d.targetIdentity ?? d.stableIdentity ?? ''}`)
      .sort()
      .join(';')}`
    // Phase 7R.3.11.8B.11 — HEADING-DOCUMENT-SHAPE-AUDIT: the shape decision
    // (headingCount across H1..H6 / plainBodyOnly) that drives the ONLY
    // strict-H1 exemption. Documented so a plain-body doc never double-reports
    // and any heading immediately ends the exemption.
    this.emitHeadingDocumentShapeAudit(input.markdown, structural.headings)
    // Phase 7R.3.11.8B.9 — HEADING-POLICY-DIAGNOSTIC-AUDIT: records the real
    // three-state activation gate behind every strict-policy decision so a
    // DISABLED/UNCONFIGURED doc can never silently emit strict-H1 rules.
    this.emitHeadingPolicyDiagnosticAudit(nextSnapshot, input, structural.h1Facts, structural.headings)
    // Phase 7R.3.11.8B.7.7+ — DOCUMENT-TRAILING-BLANK-AUDIT: records the REAL
    // source tail observed at recompute time so a DIRECT 0→1 failure can be
    // classified (source authority vs counter vs reconcile/publish vs timing).
    const publishDecision = fingerprint === this.lastContentFingerprint ? 'NOOP' : 'PUBLISHED'
    this.emitTrailingBlankAudit(input.markdown, this.sourceRevision, this.snapshot, nextSnapshot, publishDecision)
    // Capability Matrix V1 §14 — ONE capability audit per recompute (event-driven,
    // never a poll): the registry-derived counts + decision, emitted before the
    // NOOP early-return so it fires exactly once per recompute either way.
    this.emitDiagnosticCapabilityAudit(input.documentKey, publishDecision)
    if (fingerprint === this.lastContentFingerprint) {
      // §21/§22 — the bridge is consumed POST-COMMIT (never at the start of the
      // recompute): the evidence state must describe a CONSISTENT snapshot, so
      // the applied mutation is observed by the NEXT recompute it triggers.
      this.consumeHeadingConflictTestBridge()
      // §22 — a REPORT_ONLY request must still be served on a NOOP commit.
      this.flushHeadingConflictPendingReport()
      return
    }
    this.lastContentFingerprint = fingerprint
    const previous = this.snapshot
    this.snapshot = nextSnapshot
    this.lastPublishReason = reason
    this.notify()
    // Phase 7R.3.11.8B.5 — low-noise rule snapshot + location contract audit
    // (emitted only when the committed content fingerprint actually changed).
    this.emitDocumentDiagnosticRuleSnapshot(nextSnapshot)
    this.emitDocumentDiagnosticLocationContract(nextSnapshot)
    // Phase 7R.3.11.8B.7.5 — OBJECT-CAPTION-DIAGNOSTIC-AUDIT (publish-time
    // only; never per-mutation). Each figure/table/code records its semantic
    // name verdict so a name-bearing object never silently looks missing.
    this.emitObjectCaptionDiagnosticAudit(structural, input.documentKey)
    // Phase 7R.3.11.8B.7.1 — snapshot diff audit on mode transitions only.
    this.emitSnapshotDiffIfModeChanged(previous, nextSnapshot)
    // §21/§22 — POST-COMMIT bridge consumption + REPORT_ONLY capture: the
    // committed snapshot is now the authoritative one. Consuming here (never at
    // the start) guarantees every evidence state describes a CONSISTENT snapshot.
    this.consumeHeadingConflictTestBridge()
    this.flushHeadingConflictPendingReport()
  }

  /**
   * Heading Auto-Number Conflict V1.2 §21/§22 — the ONE dev/test bridge
   * consumption point, invoked POST-COMMIT (the toolbar 「重新检查文档」 button
   * drives this recompute deterministically, never an OS-level focus event).
   * main.ts owns the file IO + the official setter; failures are
   * observability-only and must never affect the diagnostics commit.
   */
  private consumeHeadingConflictTestBridge(): void {
    try { this.providers.consumeHeadingConflictTestBridge?.() } catch { /* observability only */ }
  }

  /**
   * Phase G §8 — the DOM-side caption-integrity producer bridge. Optional;
   * failures are observability-only and must never affect the diagnostics
   * commit (a broken caption producer simply yields no caption diagnostics).
   */
  private collectCaptionIntegrityDiagnostics(documentKey: string | null): readonly DocumentDiagnostic[] {
    const provider = this.providers.getCaptionIntegrityDiagnostics
    if (typeof provider !== 'function') return []
    try {
      return provider(documentKey, this.sourceRevision) ?? []
    } catch {
      return []
    }
  }

  /** Phase 7R.3.11.8B.7.7 — reason of the LAST published snapshot. */
  lastPublishReason = 'AUTO'

  /** EOF-related diagnostic codes of a snapshot (for diff). */
  private eofCodes(snapshot: DocumentDiagnosticsSnapshot | null): string[] {
    if (!snapshot) return []
    return snapshot.diagnostics
      .filter(d => d.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING' || d.code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')
      .map(d => d.code)
      .sort()
  }

  /**
   * Phase 7R.3.11.8B.8 — DOCUMENT-TRAILING-BLANK-AUDIT (one per recompute;
   * recompute is event-driven, never a poll). Records the REAL observed source
   * tail + the two split quantities (hasTerminalNewline /
   * extraTrailingBlankLineCount) so a Runtime failure is classifiable:
   *   1. EOF_SOURCE_AUTHORITY_MISMATCH  (visual tail ≠ getMarkdown tail)
   *   2. EOF_COUNTER_BUG                (counter disagrees with the tail)
   *   3. DIAGNOSTIC_RECONCILE_PUBLISH_BUG (policy flipped but no publish)
   *   4. EDIT_EVENT_PRE_COMMIT_TIMING_BUG (edit read old source)
   */
  private emitTrailingBlankAudit(
    markdown: string | null | undefined,
    sourceRevision: number,
    previous: DocumentDiagnosticsSnapshot | null,
    next: DocumentDiagnosticsSnapshot,
    publishDecision: 'PUBLISHED' | 'NOOP',
  ): void {
    const raw = markdown ?? ''
    const policy = computeEofNewlinePolicy(raw)
    const lineEnding = this.detectLineEnding(raw)
    const prevCodes = this.eofCodes(previous)
    const nextCodes = this.eofCodes(next)
    const diagnosticDiff = prevCodes.length === 0 && nextCodes.length === 0 ? 'NONE'
      : prevCodes.length === 0 ? `ADD:${nextCodes.join(',')}`
        : nextCodes.length === 0 ? `REMOVE:${prevCodes.join(',')}`
          : `REPLACE:${prevCodes.join('>')}->${nextCodes.join(',')}`
    emitRuntimeAudit('DOCUMENT-TRAILING-BLANK-AUDIT', {
      documentKey: next.documentKey,
      trigger: this.lastPublishReason,
      sourceRevision,
      sourceTailEscaped: JSON.stringify(raw.slice(-16)),
      sourceLength: raw.length,
      lineEnding,
      hasTerminalNewline: policy.hasTerminalNewline,
      terminalNewlineCount: policy.terminalNewlineCount,
      extraTrailingBlankLineCount: policy.extraTrailingBlankLineCount,
      policyDecision: policy.verdict,
      previousDiagnostic: prevCodes.length ? prevCodes : null,
      nextDiagnostic: nextCodes.length ? nextCodes : null,
      diagnosticDiff,
      publishDecision,
      decision: nextCodes.length === 0 ? 'PASS' : nextCodes.join(','),
    })
  }

  private detectLineEnding(raw: string): 'LF' | 'CRLF' | 'CR' | 'MIXED' | 'NONE' {
    if (raw === '') return 'NONE'
    const hasCrlf = raw.includes('\r\n')
    const withoutCrlf = raw.replace(/\r\n/g, '')
    const hasLoneLf = withoutCrlf.includes('\n')
    const hasLoneCr = withoutCrlf.includes('\r')
    if (hasCrlf) return hasLoneLf || hasLoneCr ? 'MIXED' : 'CRLF'
    if (hasLoneLf) return 'LF'
    if (hasLoneCr) return 'CR'
    return 'NONE'
  }

  /**
   * Phase 7R.3.11.8B.11 — HEADING-DOCUMENT-SHAPE-AUDIT (event-driven, one per
   * recompute). Exposes the DOCUMENT SHAPE that drives the plain-body-only
   * strict-H1 exemption: headingCount covers H1..H6 (never just h1Count), and
   * plainBodyOnly is true only when the whole doc is ordinary body text.
   * Any heading (headingCount > 0) ends the exemption → strictRuleSetDecision
   * becomes STRICT_RULES_ACTIVE (or LOOSE_NO_STRICT_RULES in loose mode).
   */
  private emitHeadingDocumentShapeAudit(
    markdown: string | null | undefined,
    headings: readonly DiagnosticHeadingFact[],
  ): void {
    const docKey = this.ctx.authority.getDocumentKey()
    if (!docKey) return
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
    for (const h of headings) {
      const lv = h.level
      if (lv >= 1 && lv <= 6) counts[lv] = (counts[lv] ?? 0) + 1
    }
    const headingCount = headings.length
    const hasMeaningfulBodyContent = markdown != null && markdown.trim() !== ''
    const plainBodyOnly = headingCount === 0 && hasMeaningfulBodyContent
    const firstHeadingLevel = headingCount > 0 ? (headings[0]?.level ?? null) : null
    // Body-before-first-H1 is a SHAPE fact for the audit: any non-blank line
    // before the first ATX heading, or a first heading that is not H1 after a
    // leading body paragraph.
    const lines = (markdown ?? '').split(/\r\n|\r|\n/)
    const firstAtxLine = lines.findIndex(l => /^\s*#{1,6}\s/.test(l))
    const bodyBeforeFirstHeading = firstAtxLine > 0 && lines.slice(0, firstAtxLine).some(l => l.trim() !== '')
    const hasBodyBeforeFirstH1 = bodyBeforeFirstHeading || (firstHeadingLevel != null && firstHeadingLevel !== 1)
    const strictRuleSetDecision = plainBodyOnly
      ? 'PLAIN_BODY_ONLY_EXEMPT'
      : (this.ctx.authority.isStrictMode() ? 'STRICT_RULES_ACTIVE' : 'LOOSE_NO_STRICT_RULES')
    emitRuntimeAudit('HEADING-DOCUMENT-SHAPE-AUDIT', {
      documentKey: docKey,
      headingCount,
      h1Count: counts[1] ?? 0,
      h2Count: counts[2] ?? 0,
      h3Count: counts[3] ?? 0,
      h4Count: counts[4] ?? 0,
      h5Count: counts[5] ?? 0,
      h6Count: counts[6] ?? 0,
      hasMeaningfulBodyContent,
      plainBodyOnly,
      firstHeadingLevel,
      hasBodyBeforeFirstH1,
      strictRuleSetDecision,
    })
  }

  /**
   * Phase 7R.3.11.8B.10 — HEADING-POLICY-AUTHORITY-AUDIT (event-driven, one per
   * recompute). Records the FULL activation authority for the active document:
   * stored mode vs effective activation are deliberately separate. The critical
   * state (storedMode=strict, no user activation) logs:
   *   featureEnabled/globalScopeEnabled/documentScopeEnabled=false,
   *   activationSource=none, effectivePolicyActive=false, effectiveMode=null,
   *   strictDiagnosticsActive=false, decision=SKIP reason=STRICT_POLICY_INACTIVE.
   */
  private emitHeadingPolicyDiagnosticAudit(
    snapshot: DocumentDiagnosticsSnapshot,
    input: ReturnType<typeof collectDiagnosticsInput>,
    h1Facts: readonly DiagnosticH1Fact[] | null | undefined,
    headings: readonly DiagnosticHeadingFact[],
  ): void {
    if (!input.documentKey) return
    const h1Count = h1Facts === undefined || h1Facts === null ? -1 : h1Facts.length
    const strictCodes = snapshot.diagnostics
      .filter(d => d.code.startsWith('STRICT_SINGLE_H1_') || d.code.startsWith('STRICT_FIRST_H1_') || d.code === 'STRICT_H1_MISSING')
      .map(d => d.code)
    // Phase 7R.3.11.8B.11 — activation is SHAPE-driven (plain-body-only
    // exemption). The activation-authority fields below remain observable but
    // no longer act as a permanent SKIP gate for heading documents.
    const hasMeaningfulBody = input.markdown != null && input.markdown.trim() !== ''
    const plainBodyOnly = headings.length === 0 && hasMeaningfulBody
    const strictDiagnosticsActive = input.strictMode && !plainBodyOnly
    const state = this.ctx.authority.getHeadingPolicyState?.()
    const emitted = strictCodes.length > 0
    const reason = !strictDiagnosticsActive
      ? (plainBodyOnly ? 'PLAIN_BODY_ONLY_EXEMPT' : 'MODE_NOT_STRICT')
      : (emitted ? 'EMIT_STRICT_POLICY' : 'ACTIVE_NO_VIOLATION')
    emitRuntimeAudit('HEADING-POLICY-AUTHORITY-AUDIT', {
      documentKey: input.documentKey,
      storedMode: state?.storedMode ?? null,
      storedStrictRequire: state?.storedStrictRequire ?? (state?.storedMode === 'strict'),
      featureEnabled: state?.enabled ?? true,
      globalScopeEnabled: state?.globalScopeEnabled ?? false,
      documentScopeEnabled: state?.documentScopeEnabled ?? false,
      documentOverride: state?.documentOverride ?? null,
      activationSource: state?.activationSource ?? 'none',
      effectivePolicyActive: state?.effectivePolicyActive ?? false,
      effectiveMode: state?.effectiveMode ?? null,
      effectiveStrictRequire: state?.effectiveStrictRequire ?? false,
      h1Count,
      strictDiagnosticsActive,
      diagnosticCode: strictCodes.length ? strictCodes : null,
      decision: emitted ? 'EMIT' : 'SKIP',
      reason,
    })
  }

  /**
   * Phase 7R.3.11.8B.7.1 — DOCUMENT-DIAGNOSTIC-SNAPSHOT-DIFF (mode transition
   * only): which rules appeared/disappeared/changed severity, and whether any
   * location moved. Observability only.
   */
  private emitSnapshotDiffIfModeChanged(previous: DocumentDiagnosticsSnapshot | null, next: DocumentDiagnosticsSnapshot): void {
    if (!previous || previous.effectiveMode === next.effectiveMode) return
    const prevById = new Map(previous.diagnostics.map(d => [d.id, d]))
    const nextById = new Map(next.diagnostics.map(d => [d.id, d]))
    const added: string[] = []
    const removed: string[] = []
    let severityChanged = 0
    let locationChanged = 0
    for (const [id, nd] of nextById) {
      const pd = prevById.get(id)
      if (!pd) added.push(getRuleMeta(nd.code)?.ruleId ?? nd.code)
      else if (pd.severity !== nd.severity) severityChanged++
    }
    for (const [id, pd] of prevById) {
      if (!nextById.has(id)) removed.push(getRuleMeta(pd.code)?.ruleId ?? pd.code)
    }
    for (const [id, nd] of nextById) {
      const pd = prevById.get(id)
      if (!pd) continue
      const pk = JSON.stringify(pd.location)
      const nk = JSON.stringify(nd.location)
      if (pk !== nk) locationChanged++
    }
    emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-SNAPSHOT-DIFF', {
      documentKey: next.documentKey,
      previousRevision: previous.revision,
      nextRevision: next.revision,
      previousMode: previous.effectiveMode,
      nextMode: next.effectiveMode,
      addedRuleIds: added,
      removedRuleIds: removed,
      severityChangedCount: severityChanged,
      locationChangedCount: locationChanged,
    })
  }

  /**
   * Phase 7R.3.11.8B.5 — DOCUMENT-DIAGNOSTIC-RULE-SNAPSHOT. One summary per
   * committed content change: severity sums + per-record ruleId/location kind.
   */
  /**
   * V5.15 §16/§17 — the Standalone Object Block Invariant runtime audit.
   *
   * Emitted ONCE per recompute with the per-block figure decisions plus the
   * hard-gate / coverage report, so a forbidden count is readable straight from
   * the runtime log and always describes the current snapshot.
   */
  private emitStandaloneObjectBlockInvariantAudit(
    diagnostics: readonly DocumentDiagnostic[],
  ): void {
    const results = this.lastFigureStructureResults
    const documentKey = this.ctx.authority.getDocumentKey() ?? null
    const gate = getFigureBlockStructureV515GateDecision()
    const admittedCount = results.filter(r => r.decision === 'VALID_STANDALONE_FIGURE').length
    const blocked = results
      .filter(r => r.decision !== 'VALID_STANDALONE_FIGURE')
      .map(r => `${r.owningBlockIdentity}:${r.decision}`)
    const structureDiagnosticCount = diagnostics.filter(d => d.code === FIGURE_BLOCK_STRUCTURE_INVALID_CODE).length
    emitRuntimeAudit(DOCUMENT_DIAGNOSTIC_STANDALONE_OBJECT_BLOCK_AUDIT, {
      documentKey,
      objectKind: 'figure',
      rawObjectCount: results.reduce((n, r) => n + r.imageOccurrenceCount, 0),
      canonicalObjectCount: admittedCount,
      figureBlockCount: results.length,
      normalBusinessTargetAdmittedCount: admittedCount,
      excludedFromNormalTargetCount: blocked.length,
      excludedBlocks: blocked.join('|') || 'NONE',
      containerKinds: results.map(r => `${r.owningBlockIdentity}:${r.containerKind}`).join('|') || 'NONE',
      violations: results
        .flatMap(r => r.violationCodes)
        .filter((v, i, all) => all.indexOf(v) === i)
        .join('|') || 'NONE',
      figureCanonicalTargetCount: admittedCount,
      figureStructureDiagnosticCount: structureDiagnosticCount,
      normalBusinessTargetAdmitted: admittedCount > 0,
      structuralDiagnosticPublished: structureDiagnosticCount > 0,
      gateDecision: gate.decision,
      gateFailing: gate.failedChecks.join('|') || 'NONE',
      gateReport: getFigureBlockStructureV515GateReport(),
      coverageReport: getFigureBlockStructureV515CoverageReport(),
      decision: gate.decision,
      reason: 'FIGURE_STANDALONE_BLOCK_INVARIANT_EVALUATED',
    })
  }

  /**
   * V1 §26/§27 — the Markdown literal exclusion audit + the Figure literal
   * exclusion hard gates.
   *
   * Emitted ONCE per recompute. The gate is REAL: it consumes the markdown, the
   * literal ranges and the COMPUTED diagnostics — a diagnostic whose source range
   * overlaps a literal region is a measured false positive, never a heuristic.
   */
  private emitLiteralExclusionAudit(
    markdown: string | null,
    diagnostics: readonly DocumentDiagnostic[],
  ): void {
    const admitted = scanAdmittedReferenceCounts(markdown ?? '')
    const evaluated = evaluateLiteralExclusionAgainstDiagnostics({
      markdown,
      diagnostics,
      admittedImageCount: admitted.imageCount,
      admittedLinkCount: admitted.linkCount,
      admittedSpans: scanAdmittedReferenceSpans(markdown ?? ''),
    })
    const gate = evaluateFigureLiteralExclusionV1Gates(evaluated.counters)
    const facts = evaluated.facts
    const figureDiagnostics = diagnostics.filter(d =>
      d.code === 'FIGURE_MISSING_NAME'
      || d.code === 'FIGURE_LOCAL_IMAGE_MISSING'
      || d.code === 'FIGURE_BLOCK_STRUCTURE_INVALID').length
    const signature = [
      this.ctx.authority.getDocumentKey() ?? '',
      facts.inlineCodeRangeCount, facts.fencedCodeRangeCount, facts.indentedCodeRangeCount,
      facts.rawImageSyntaxMatchCount, facts.rawLinkSyntaxMatchCount,
      facts.excludedImageCandidateCount, facts.admittedImageCandidateCount,
      gate.decision, evaluated.literalFalsePositiveDiagnosticIds.join(','),
    ].join('|')
    if (signature === this.lastLiteralExclusionSignature) return
    this.lastLiteralExclusionSignature = signature

    emitRuntimeAudit(MARKDOWN_LITERAL_EXCLUSION_AUDIT, {
      documentKey: this.ctx.authority.getDocumentKey() ?? null,
      sourceRevision: this.sourceRevision,
      inlineCodeRangeCount: facts.inlineCodeRangeCount,
      fencedCodeRangeCount: facts.fencedCodeRangeCount,
      indentedCodeRangeCount: facts.indentedCodeRangeCount,
      rawImageSyntaxMatchCount: facts.rawImageSyntaxMatchCount,
      rawLinkSyntaxMatchCount: facts.rawLinkSyntaxMatchCount,
      excludedImageCandidateCount: facts.excludedImageCandidateCount,
      excludedLinkCandidateCount: facts.excludedLinkCandidateCount,
      admittedImageCandidateCount: admitted.imageCount,
      admittedLinkCandidateCount: admitted.linkCount,
      decision: gate.decision,
      reason: gate.decision === 'PASS' ? 'LITERAL_EXCLUSION_OK' : gate.failedChecks.join(','),
    })
    emitRuntimeAudit(FIGURE_LITERAL_EXCLUSION_AUDIT, {
      documentKey: this.ctx.authority.getDocumentKey() ?? null,
      rawFigureLikeSyntaxCount: facts.rawImageSyntaxMatchCount,
      excludedByInlineCodeCount: facts.excludedImageByInlineCodeCount,
      excludedByFenceCount: facts.excludedImageByFenceCount,
      excludedByOtherLiteralCount: facts.excludedImageByIndentedCodeCount,
      realFigureOccurrenceCount: admitted.imageCount,
      figureCanonicalTargetCount: admitted.imageCount,
      figureDiagnosticCount: figureDiagnostics,
      figureResourceResolutionCount: diagnostics.filter(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING').length,
      literalFalsePositiveDiagnosticIds: evaluated.literalFalsePositiveDiagnosticIds.join('|') || 'NONE',
      gateReport: formatFigureLiteralExclusionV1GateReport(evaluated.counters),
      decision: gate.decision,
      reason: gate.decision === 'PASS' ? 'FIGURE_LITERAL_EXCLUSION_OK' : gate.failedChecks.join(','),
    })
  }

  /**
   * Capability Matrix V1 §14 — the ONE runtime capability audit.
   *
   * Emitted ONCE per diagnostics recompute (event-driven, never a poll) with the
   * registry-derived counts + decision + reason. The counts are read from the
   * SINGLE registry via `resolveDocumentDiagnosticCapabilitySummary`, so the
   * audit can never drift from the Capability Matrix document.
   */
  private emitDiagnosticCapabilityAudit(
    documentKey: string | null,
    publishDecision: 'PUBLISHED' | 'NOOP',
  ): void {
    const audit = resolveDocumentDiagnosticsCapabilityAudit()
    emitRuntimeAudit(DOCUMENT_DIAGNOSTICS_CAPABILITY_AUDIT_EVENT, {
      documentKey,
      registeredRuleFamilyCount: audit.registeredRuleFamilyCount,
      resolvedDiagnosticCodeCount: audit.resolvedDiagnosticCodeCount,
      userVisibleDiagnosticTypeCount: audit.userVisibleDiagnosticTypeCount,
      implementedFamilyCount: audit.implementedFamilyCount,
      deferredFamilyCount: audit.deferredFamilyCount,
      stateGuardCodeCount: audit.stateGuardCodeCount,
      contentDiagnosticCodeCount: audit.contentDiagnosticCodeCount,
      closedFamilyCount: audit.closedFamilyCount,
      partialFamilyCount: audit.partialFamilyCount,
      unverifiedFamilyCount: audit.unverifiedFamilyCount,
      deferredClosureFamilyCount: audit.deferredClosureFamilyCount,
      unregisteredRuntimeCodeCount: audit.unregisteredRuntimeCodeCount,
      implementedWithoutProducerCount: audit.implementedWithoutProducerCount,
      duplicateFamilyCount: audit.duplicateFamilyCount,
      unknownSeverityCount: audit.unknownSeverityCount,
      staleRuntimeEvidenceCount: audit.staleRuntimeEvidenceCount,
      runtimeEvidenceShaMismatchCount: audit.runtimeEvidenceShaMismatchCount,
      decision: audit.decision,
      gateReason: audit.reason,
      reason: publishDecision === 'PUBLISHED' ? 'SNAPSHOT_PUBLISHED' : 'SNAPSHOT_UNCHANGED',
    })
  }

  private emitDocumentDiagnosticRuleSnapshot(snapshot: DocumentDiagnosticsSnapshot): void {
    emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-RULE-SNAPSHOT', {
      documentKey: snapshot.documentKey,
      revision: snapshot.revision,
      errorCount: snapshot.errorCount,
      warningCount: snapshot.warningCount,
      hintCount: snapshot.infoCount,
      totalCount: snapshot.diagnostics.length,
      records: snapshot.diagnostics.map(d => ({
        diagnosticId: d.id,
        ruleId: getRuleMeta(d.code)?.ruleId ?? d.code,
        severity: d.severity,
        category: d.category,
        locationKind: d.location?.kind ?? null,
        targetCount: d.location?.kind === 'multi-target' ? d.location.targets.length : 1,
      })),
    })
  }

  /**
   * Phase 7R.3.11.8B.7.5 — OBJECT-CAPTION-DIAGNOSTIC-AUDIT (publish-time only).
   * One record per figure/table/code carrying its semantic-name verdict so a
   * name-bearing object can never silently look "missing". semanticName is the
   * unified authority result (figure=alt, table/code=registry title); the
   * rendered "type + number" prefix is NEVER treated as a name.
   */
  private emitObjectCaptionDiagnosticAudit(
    structural: ReturnType<DocumentDiagnosticsAuthority['collectStructuralFacts']>,
    documentKey: string | null,
  ): void {
    const row = (objectType: 'figure' | 'table' | 'code', f: { name: string | null; targetIdentity?: string }): void => {
      const semanticName = (f.name ?? '').trim()
      const hasSemanticName = semanticName !== ''
      emitRuntimeAudit('OBJECT-CAPTION-DIAGNOSTIC-AUDIT', {
        documentKey,
        objectType,
        objectIdentity: f.targetIdentity ?? null,
        number: null, // numbering lives in the caption system; never re-derived here
        semanticName,
        hasSemanticName,
        nameSource: objectType === 'figure' ? 'MARKDOWN_ALT' : 'CAPTION_REGISTRY',
        diagnosticDecision: hasSemanticName ? 'NO_MISSING_NAME' : 'MISSING_NAME',
        reason: hasSemanticName ? 'semantic-name-present' : 'type-number-only-or-empty',
      })
    }
    for (const f of structural.figures) row('figure', f)
    for (const t of structural.tables) row('table', t)
    for (const c of structural.codes) row('code', c)
  }

  /**
   * Phase 7R.3.11.8B.7.6 — RESOURCE-RESOLUTION-AUDIT (state-deduped).
   * Records the base authority (ACTIVE DOCUMENT directory) and the resolved
   * absolute path + existence for every local Markdown resource reference.
   * A normal document-relative asset (Phase7) shows exists=true with
   * baseAuthority=document-dir; a deliberately-missing fixture stays exists=false.
   */
  private emitResourceResolutionAudit(
    resourceKind: string | undefined,
    rawDestination: string,
    exists: boolean,
    documentDir: string | null,
    vaultRoot: string | null,
  ): void {
    const resolvedAbsolutePath = documentDir && !/^[a-z][a-z0-9+.-]*:/i.test(rawDestination)
      ? normalizeResourceToken(`${documentDir}/${rawDestination.replace(/^\.\//, '')}`)
      : (vaultRoot ? normalizeResourceToken(`${vaultRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/${rawDestination.replace(/^\.\//, '')}`) : rawDestination)
    const signature = `${this.ctx.authority.getDocumentKey() ?? ''}|${resourceKind ?? ''}|${rawDestination}|${exists}`
    if (signature === this.lastResourceResolutionSignature) return
    this.lastResourceResolutionSignature = signature
    emitRuntimeAudit('RESOURCE-RESOLUTION-AUDIT', {
      documentKey: this.ctx.authority.getDocumentKey(),
      documentPath: this.ctx.authority.getActiveFilePath(),
      documentDir,
      rawDestination,
      decodedDestination: normalizeResourceToken(rawDestination),
      normalizedDestination: normalizeResourceToken(rawDestination),
      resolvedAbsolutePath,
      baseAuthority: documentDir ? 'document-dir' : 'vault-root-fallback',
      exists,
      resourceKind: resourceKind ?? null,
      renderDecision: 'DOM-RENDER', // image render authority is the DOM <img> (file URI)
      diagnosticDecision: exists ? 'NO_MISSING_RESOURCE' : 'LOCAL_LINK_TARGET_NOT_FOUND',
    })
  }

  /** Phase 7R.3.11.8B.7.6 — resource-resolution audit dedup token. */
  private lastResourceResolutionSignature = ''

  /**
   * Phase 7R.3.11.8B.5 — DOCUMENT-DIAGNOSTIC-LOCATION-CONTRACT.
   * PUBLISHED = LOCATABLE: diagnosticCount == locatableCount, unlocatable = 0.
   */
  private emitDocumentDiagnosticLocationContract(snapshot: DocumentDiagnosticsSnapshot): void {
    const contract = computeDiagnosticLocationContract(snapshot)
    emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-LOCATION-CONTRACT', {
      documentKey: snapshot.documentKey,
      revision: snapshot.revision,
      diagnosticCount: contract.diagnosticCount,
      locatableDiagnosticCount: contract.locatableDiagnosticCount,
      unlocatableDiagnosticCount: contract.unlocatableDiagnosticCount,
      nonLocatableNoticeCount: contract.nonLocatableNoticeCount,
      canonicalNodeLocationCount: contract.canonicalNodeLocationCount,
      sourceRangeLocationCount: contract.sourceRangeLocationCount,
      documentStartLocationCount: contract.documentStartLocationCount,
      documentEndLocationCount: contract.documentEndLocationCount,
      blockNodeLocationCount: contract.blockNodeLocationCount,
      multiTargetLocationCount: contract.multiTargetLocationCount,
      decision: contract.decision,
    })
  }

  /**
   * Phase 7R.3.11.5 — low-noise heading-input audit: emitted ONLY when a
   * real heading level gap exists (physical levels), with the exact jump point.
   */
  private emitHeadingGapInputIfAny(headings: DiagnosticHeadingFact[], documentKey: string | null): void {
    let prevLevel: number | null = null
    for (const h of headings) {
      if (prevLevel != null && h.level > prevLevel + 1) {
        const missingLevels: number[] = []
        for (let l = prevLevel + 1; l < h.level; l++) missingLevels.push(l)
        emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-HEADING-INPUT', {
          documentKey,
          previousLevel: prevLevel,
          currentLevel: h.level,
          missingLevels,
          stableIdentity: h.stableIdentity ?? null,
          text: h.text,
          decision: 'HEADING_LEVEL_GAP',
        })
      }
      prevLevel = h.level
    }
  }

  /** Mark snapshot stale for a changed document; recompute immediately. */
  rebind(): void {
    this.recompute()
  }

  /**
   * Heading Auto-Number Conflict V1.2 §3–§22 — the ONE evidence-state audit.
   *
   *   per-heading EVIDENCE STATE → ONE transition CLASSIFIER → transitionReason
   *     → conflict audit / dynamic audit / coverage / failure gates
   *
   * §3/§4 the state is per-heading (keyed by headingStableIdentity) and is kept
   * even while `conflict=false`, so a config change can never be misread as a
   * source change. §6 the first complete snapshot only establishes the baseline.
   * §7 a new (session|document) scope establishes a NEW baseline. §19 coverage is
   * bumped ONCE per transaction (reason-level dedup), never once per heading.
   */
  private emitHeadingAutoNumberConflictAudits(
    input: DocumentDiagnosticsInput,
    computed: DocumentDiagnosticsComputed,
  ): void {
    const keyOf = (identity: string | undefined | null): string => String(identity ?? '')
    const conflicts = computed.diagnostics.filter(d => d.code === HEADING_AUTO_NUMBER_CONFLICT_CODE)
    const conflictByIdentity = new Map<string, DocumentDiagnostic>()
    for (const d of conflicts) {
      const key = keyOf(d.stableIdentity)
      if (conflictByIdentity.has(key)) {
        this.countersHeadingAutoNumberConflict.headingAutoNumberConflictDuplicateDiagnostic++
      } else {
        conflictByIdentity.set(key, d)
      }
    }
    // §14/§43 — a conflicting heading must NEVER also carry the generic warning.
    for (const d of computed.diagnostics) {
      if (d.code !== 'HEADING_MANUAL_NUMBER_PREFIX') continue
      if (conflictByIdentity.has(keyOf(d.stableIdentity))) {
        this.countersHeadingAutoNumberConflict.autoNumberConflictAndManualPrefixDuplicateReport++
      }
    }

    const globalEnabled = input.headingAutoNumbering?.enabled === true
    const h1Enabled = input.headingAutoNumbering?.h1NumberingEnabled === true
    // Heading Auto-Number Conflict V1.2 §13 — the STYLE identity comes from the
    // numbering authority's own effective configuration (preset + per-level
    // NUMBER FORMAT), NOT from the rendered auto number. A global ON/OFF toggle
    // therefore leaves the style key unchanged and can never be misclassified as
    // NUMBER_STYLE_CHANGED; only a real preset/format change moves it.
    const styleKey = input.headingAutoNumbering?.styleKey ?? ''

    // §3/§4 — the FULL per-heading evidence state (EVERY canonical heading).
    const states = new Map<string, HeadingAutoNumberConflictEvidenceState>()
    let dropped = 0
    for (const heading of input.headings) {
      const key = keyOf(heading.stableIdentity)
      if (key === '') { dropped++; continue }
      const diag = conflictByIdentity.get(key)
      const prefix = resolveHeadingManualNumberPrefix(heading.text)
      const generated = heading.element?.getAttribute?.('data-inkchapter-heading-number') ?? null
      states.set(key, {
        documentKey: input.documentKey ?? '',
        headingStableIdentity: key,
        headingLevel: heading.level,
        sourceText: heading.text,
        manualPrefixStatus: prefix.status,
        manualPrefixKind: prefix.kind,
        manualPrefixRaw: prefix.status === 'confirmed' ? prefix.rawPrefix : null,
        globalAutoNumberingEnabled: globalEnabled,
        autoNumberingEffectiveForHeading: heading.autoNumberingEffective === true,
        h1NumberingEnabled: h1Enabled,
        numberingStyleKey: styleKey,
        generatedVisiblePrefix: generated,
        conflict: diag != null,
        diagnosticId: diag?.id ?? null,
      })
    }
    // §3 — a canonical heading without a stable identity can never be tracked.
    if (dropped > 0) this.countersHeadingAutoNumberConflict.dynamicStateDroppedNonConflictHeading += dropped

    // ── §44 — the per-conflicting-heading facts (deduped by conflict signature).
    const conflictSignature = [...conflictByIdentity.keys()].sort().join('|')
    if (conflictSignature !== this.lastConflictSignature) {
      for (const [key, d] of conflictByIdentity) {
        const st = states.get(key)
        const generatedPrefix = st?.generatedVisiblePrefix ?? null
        // §5/§44 — the AUTO style is classified by the SAME parser authority
        // (audit-only presentation classification, never a detection input).
        const autoKind = generatedPrefix != null && generatedPrefix !== ''
          ? resolveHeadingManualNumberPrefix(`${generatedPrefix} 标题`).kind
          : null
        const facts = {
          documentKey: input.documentKey,
          diagnosticId: d.id,
          headingStableIdentity: key,
          headingLevel: st ? String(st.headingLevel) : null,
          autoNumberingGlobalEnabled: globalEnabled,
          autoNumberingEffectiveForHeading: st?.autoNumberingEffectiveForHeading === true,
          h1NumberingEnabled: h1Enabled,
          canonicalSourceText: st?.sourceText ?? '',
          manualPrefixStatus: st?.manualPrefixStatus ?? 'none',
          manualPrefixKind: st?.manualPrefixKind ?? null,
          manualPrefixRaw: st?.manualPrefixRaw ?? null,
          generatedVisiblePrefix: generatedPrefix,
          sourceEvidenceUsesGeneratedPrefix: false,
          severity: d.severity,
        }
        const verdict = evaluateHeadingAutoNumberConflictFacts(facts)
        applyHeadingAutoNumberConflictFailure(this.countersHeadingAutoNumberConflict, verdict.failedChecks)
        emitRuntimeAudit(HEADING_AUTO_NUMBER_CONFLICT_AUDIT_EVENT, {
          ...facts,
          autoVisiblePrefixKind: autoKind,
          runtimeSessionId: this.conflictRuntimeSessionId,
          decision: verdict.decision,
          reason: verdict.reason,
        })
        noteHeadingAutoNumberConflictCoverage(this.coverageHeadingAutoNumberConflict, {
          manualPrefixKind: facts.manualPrefixKind,
          crossStyle: autoKind != null && facts.manualPrefixKind != null && autoKind !== facts.manualPrefixKind,
        })
        // §20/§26 — the SAME heading would ALSO have raised the legacy generic
        // manual-prefix warning, so the producer suppressed it.
        if (st && detectLegacyManualNumberPrefix(st.sourceText) != null) {
          this.coverageHeadingAutoNumberConflict.suppressionSameHeading++
        }
      }
      // §20/§26 — a heading that is NOT conflict-effective keeps its warning.
      if (computed.diagnostics.some(d => d.code === 'HEADING_MANUAL_NUMBER_PREFIX')) {
        this.coverageHeadingAutoNumberConflict.nonConflictManualWarning++
      }
    }
    this.lastConflictSignature = conflictSignature

    // ── §7 — (runtimeSessionId | documentKey) isolation: a new scope = new baseline.
    const scopeKey = `${this.conflictRuntimeSessionId}|${input.documentKey ?? ''}`
    if (scopeKey !== this.conflictDynamicScopeKey) {
      // A diff across different scopes would be a cross-document leak; the state
      // is dropped wholesale instead of being compared.
      this.conflictDynamicScopeKey = scopeKey
      this.conflictEvidenceStates = states
      this.conflictBaselineEstablished = true
      return
    }
    // ── §6 — the first complete snapshot only establishes the baseline.
    if (!this.conflictBaselineEstablished) {
      this.conflictEvidenceStates = states
      this.conflictBaselineEstablished = true
      return
    }

    // ── §9 — ONE classifier, one reason, all downstream consumers.
    const diagnosticsRevision = this.revision
    const sourceRevision = this.sourceRevision
    const keys = new Set<string>([...this.conflictEvidenceStates.keys(), ...states.keys()])
    for (const key of keys) {
      const before = this.conflictEvidenceStates.get(key)
      const after = states.get(key) ?? null
      // A heading that APPEARED has no baseline evidence: it is not a change.
      if (!before) continue
      const verdict = evaluateHeadingAutoNumberConflictTransition({ before, after })
      if (verdict.transitionReason === 'NO_CHANGE') continue
      if (verdict.transitionReason !== 'HEADING_REMOVED') {
        applyHeadingAutoNumberConflictFailure(
          this.countersHeadingAutoNumberConflict,
          verdict.failedChecks,
          verdict.transitionReason,
        )
      }
      emitRuntimeAudit(HEADING_AUTO_NUMBER_CONFLICT_DYNAMIC_AUDIT_EVENT, {
        documentKey: input.documentKey,
        headingStableIdentity: key,
        runtimeSessionId: this.conflictRuntimeSessionId,
        diagnosticsRevision,
        sourceRevision,
        transitionReason: verdict.transitionReason,
        before,
        after,
        decision: verdict.decision,
        reason: verdict.failedChecks.length === 0 ? 'EVIDENCE_STATE_TRANSITION_CLASSIFIED' : verdict.failedChecks.join(','),
      })
      // §17/§18/§19 — coverage consumes ONLY the classifier's reason, deduped per
      // transaction so one Auto-ON→OFF (17 headings) counts ONCE.
      if (verdict.coverageKey != null) {
        const txKey = headingAutoNumberConflictTransactionKey({
          runtimeSessionId: this.conflictRuntimeSessionId,
          diagnosticsRevision,
          transitionReason: verdict.transitionReason,
          settingsRevision: 0,
          sourceRevision,
        })
        if (!this.conflictCoverageTransactions.has(txKey)) {
          this.conflictCoverageTransactions.add(txKey)
          noteHeadingAutoNumberConflictCoverageForReason(this.coverageHeadingAutoNumberConflict, verdict.transitionReason)
        }
      }
    }
    this.conflictEvidenceStates = states
  }

  /** §47 — the overlay host records ONE real first-click activation of a conflict. */
  noteHeadingAutoNumberConflictFirstClickActivated(): void {
    this.coverageHeadingAutoNumberConflict.firstClickActive++
  }

  // ── §21/§22 — the ONE post-commit report authority ─────────────────────────

  /** §22 — arm a REPORT_ONLY: capture happens on the NEXT diagnostics commit. */
  requestHeadingAutoNumberConflictReport(): void {
    this.conflictPendingReport = true
  }

  /** §20 — the runtime session id of THIS plugin instance. */
  getHeadingConflictRuntimeSessionId(): string {
    return this.conflictRuntimeSessionId
  }

  /** §6 — whether the baseline of the current (session|document) scope is set. */
  isHeadingConflictBaselineEstablished(): boolean {
    return this.conflictBaselineEstablished
  }

  /** §22 — the committed diagnostics revision. */
  getCommittedDiagnosticsRevision(): number {
    return this.revision
  }

  /** §22 — the committed source revision. */
  getCommittedSourceRevision(): number {
    return this.sourceRevision
  }

  /** §22 — the current (session|document) dynamic scope key. */
  getHeadingConflictDynamicScopeKey(): string {
    return this.conflictDynamicScopeKey
  }

  /**
   * §22 — the post-commit capture. It runs at the END of a committed recompute
   * (never right after a setter), so the gate/coverage report always describes
   * the SAME committed snapshot and carries its revision + session id.
   */
  private flushHeadingConflictPendingReport(): void {
    if (!this.conflictPendingReport) return
    this.conflictPendingReport = false
    const envelope: HeadingAutoNumberConflictReportEnvelope = {
      runtimeSessionId: this.conflictRuntimeSessionId,
      reportSequence: ++this.conflictReportSequence,
      settingsRevision: 0,
      sourceRevision: this.sourceRevision,
      diagnosticsRevision: this.revision,
      baselineEstablished: this.conflictBaselineEstablished,
      capturePhase: 'POST_COMMIT',
    }
    const capture = {
      ...envelope,
      dualPass: this.getHeadingAutoNumberConflictDualPassDecision(),
      gateReport: formatHeadingAutoNumberConflictGateReport(this.countersHeadingAutoNumberConflict),
      coverageReport: formatHeadingAutoNumberConflictCoverageReport(this.coverageHeadingAutoNumberConflict),
    }
    emitRuntimeAudit('HEADING-CONFLICT-REPORT-CAPTURED', capture)
    try {
      this.providers.onHeadingConflictReportCapture?.(capture)
    } catch { /* observability only — never affects diagnostics */ }
  }

  /**
   * §17/§26 (Runtime Closure V1) — ONE real stable post-click Drawer viewport
   * observation for a conflict Error click (shared probe, never a second one).
   */
  noteHeadingAutoNumberConflictDrawerViewportStable(): void {
    this.coverageHeadingAutoNumberConflict.drawerViewportStable++
  }

  /** §16 (Runtime Closure V1) — a repeated click that did NOT deactivate. */
  noteHeadingAutoNumberConflictRepeatedClickNotDeactivated(): void {
    this.countersHeadingAutoNumberConflict.headingAutoNumberConflictRepeatedClickNotDeactivated++
  }

  /** §4 (Runtime Closure V1) — the DUAL pass condition surface. */
  getHeadingAutoNumberConflictDualPassDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[]; unmet: readonly string[] } {
    const dual = evaluateHeadingAutoNumberConflictDualPass(
      this.countersHeadingAutoNumberConflict,
      this.coverageHeadingAutoNumberConflict,
    )
    return { decision: dual.decision, failedChecks: dual.failedChecks, unmet: dual.unmet }
  }

  /** §46 — read-only gate surface (runtime verification). */
  getHeadingAutoNumberConflictGateReport(): string[] {
    return formatHeadingAutoNumberConflictGateReport(this.countersHeadingAutoNumberConflict)
  }

  getHeadingAutoNumberConflictGateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] } {
    return evaluateHeadingAutoNumberConflictGates(this.countersHeadingAutoNumberConflict)
  }

  getHeadingAutoNumberConflictCounters(): Readonly<HeadingAutoNumberConflictCounters> {
    return { ...this.countersHeadingAutoNumberConflict }
  }

  getHeadingAutoNumberConflictCoverageReport(): string[] {
    return formatHeadingAutoNumberConflictCoverageReport(this.coverageHeadingAutoNumberConflict)
  }

  getHeadingAutoNumberConflictCoverageDecision(): { decision: 'PASS' | 'FAIL'; unmet: readonly string[] } {
    return evaluateHeadingAutoNumberConflictCoverage(this.coverageHeadingAutoNumberConflict)
  }

  getHeadingAutoNumberConflictCoverage(): Readonly<HeadingAutoNumberConflictCoverage> {
    return { ...this.coverageHeadingAutoNumberConflict }
  }

  private collectStructuralFacts(): {
    headings: DiagnosticHeadingFact[]
    h1Facts: DiagnosticH1Fact[] | null
    headingAuthority: HeadingDiagnosticAuthority
    latentAtxMarkers: LatentAtxMarkerInput[]
    figures: DiagnosticObjectFact[]
    figureSourceOccurrences?: FigureSourceOccurrence[]
    tables: DiagnosticObjectFact[]
    codes: DiagnosticObjectFact[]
    formulas: DiagnosticFormulaFact[]
    links: DiagnosticLinkFact[]
    /** Heading Auto-Number Conflict V1 §2/§4 — global effectiveness audit facts. */
    headingAutoNumbering: { enabled: boolean; h1NumberingEnabled: boolean; styleKey?: string }
  } {
    const root = resolveBusinessContentRoot()
    const figures: DiagnosticObjectFact[] = []
    const tables: DiagnosticObjectFact[] = []
    const codes: DiagnosticObjectFact[] = []
    const formulas: DiagnosticFormulaFact[] = []
    const links: DiagnosticLinkFact[] = []
    // Phase 7R.3.11.8B.1 — canonical H1 authority bridge (WAIT/INVALID/READY).
    // Phase 7R.3.11.8B.4 — the SAME bridge is the ONLY diagnostics heading
    // sequence: all canonical heading facts in canonical document order.
    // Plain-text hash markers never appear here (they are not Heading Nodes).
    const authority = this.providers.getCanonicalH1Facts?.()
    let h1Facts: DiagnosticH1Fact[] | null = null
    const canonicalHeadingFacts: DiagnosticCanonicalHeadingFact[] = []
    if (authority) {
      this.emitH1AuthorityAudits(authority)
      if (authority.state === 'READY') {
        canonicalHeadingFacts.push(...authority.headingFacts)
        h1Facts = authority.h1Facts.map(f => ({
          stableIdentity: f.stableIdentity,
          element: f.element,
          text: f.text,
        }))
      }
    }
    // Heading Auto-Number Conflict V1 §2/§4 — the numbering authority's OWN
    // per-heading effectiveness verdict (never a second level/config rule).
    const autoNumberingFacts = this.providers.getHeadingAutoNumberingEffectiveFacts?.()
      ?? { enabled: false, h1NumberingEnabled: false, isEffectiveForElement: () => false }
    const headings: DiagnosticHeadingFact[] = canonicalHeadingFacts.map(f => ({
      level: f.physicalLevel,
      text: f.text,
      stableIdentity: f.stableIdentity,
      element: f.element,
      autoNumberingEffective: autoNumberingFacts.enabled === true
        && autoNumberingFacts.isEffectiveForElement(f.element),
    }))
    const headingAutoNumbering = {
      enabled: autoNumberingFacts.enabled === true,
      h1NumberingEnabled: autoNumberingFacts.h1NumberingEnabled === true,
      styleKey: autoNumberingFacts.styleKey ?? '',
    }
    // Phase 7R.3.11.8B.4 — canonical == diagnostics heading authority invariant.
    const headingAuthority = this.computeHeadingAuthority(authority, headings)
    this.emitHeadingAuthorityAudits(authority, headingAuthority)

    // Phase 7R.3.11.8B.4.1 — Source Syntax Diagnostics: latent ATX heading
    // markers from RAW Markdown, ONLY when the canonical frame is READY (a
    // trustworthy "not canonical" verdict requires a trustworthy frame).
    const sourceMarkdown = this.ctx.authority.getMarkdown()
    const latentAtxScan = authority?.state === 'READY' && sourceMarkdown != null
      ? detectLatentAtxMarkers(
          sourceMarkdown,
          collectCanonicalHeadingSourceLines(canonicalHeadingFacts.map(f => f.element)),
          collectCanonicalHeadingTextKeys(canonicalHeadingFacts),
        )
      : { latent: [] as LatentAtxMarkerFact[], escaped: [] as LatentAtxMarkerFact[], canonicalLines: [] as number[] }
    const latentAtxMarkers: LatentAtxMarkerInput[] = latentAtxScan.latent.map(f => ({
      line: f.line,
      column: f.column ?? 0,
      markerLevel: f.markerLevel,
      markerText: f.markerText,
      text: f.text,
      // Phase 7R.3.11.8B.7.2 — scan-time raw line text (content anchor for
      // the locate resolver: DOM verification + text-context re-anchor).
      rawText: sourceMarkdown != null ? (sourceMarkdown.split('\n')[f.line] ?? undefined) : undefined,
    }))
    // Authority separation audit (canonical vs structural vs source-syntax).
    this.emitAuthoritySeparationAudit(authority, latentAtxScan, latentAtxMarkers)
    // Phase 7R.3.11.8B.4.1 — LATENT-ATX marker transition log (state-deduped).
    this.emitLatentAtxMarkerLog(
      authority?.documentKey ?? null,
      latentAtxScan.latent,
      this.ctx.authority.isStrictMode(),
    )

    if (root) {
      // Figures — images outside captions; local missing paths only.
      // Phase 7R.3.11.8B.5 — block ordinal identity (`block:figure:<n>`) is the
      // stable locator for figure diagnostics; re-derived at locate time.
      let figureOrdinal = 0
      // V5.15 §16/§18 — open the DOM admission pass: the gate + coverage
      // counters describe THIS document state, never a stale earlier pass.
      beginFigureBlockStructureV515DomPass()
      this.lastFigureStructureResults = []
      const figureStructureResults = this.lastFigureStructureResults
      for (const img of Array.from(root.querySelectorAll<HTMLElement>('img'))) {
        if (img.closest('[data-inkchapter-caption]')) continue
        // V5.15 §6/§10 — the ordinal is consumed FIRST so the surviving valid
        // figures keep the exact `block:figure:<n>` identity the locate resolver
        // re-derives from the live DOM (querySelectorAll('img')[ordinal]).
        const blockOrdinal = figureOrdinal++
        // V5.15 — a structurally invalid image owning block is NOT a normal
        // figure target: it never enters numbering / caption / naming / locate.
        const structure = analyzeFigureBlockStructureDom(img)
        figureStructureResults.push(structure)
        if (structure.decision !== 'VALID_STANDALONE_FIGURE') {
          noteFigureBlockAdmission(structure, false)
          continue
        }
        const { localPath } = this.providers.resolveImageLocalPath(img)
        figures.push({
          name: this.providers.getFigureName(img),
          localPath: localPath ?? undefined,
          element: img,
          targetIdentity: `block:figure:${blockOrdinal}`,
        })
        noteFigureBlockAdmission(structure, true)
      }

      // Tables.
      let tableOrdinal = 0
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('table'))) {
        if (el.closest('[data-inkchapter-caption]')) continue
        tables.push({ name: this.providers.getTableName(el), element: el, targetIdentity: `block:table:${tableOrdinal++}` })
      }

      // Code — canonical fence host only; CodeMirror renderer descendants are
      // never treated as separate code blocks.
      let codeOrdinal = 0
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('pre.md-fences'))) {
        codes.push({
          name: this.providers.getCodeName(el),
          language: this.providers.getCodeLanguage(el),
          element: el,
          targetIdentity: `block:code:${codeOrdinal++}`,
        })
      }

      // Formula — block math hosts; projection invariants only.
      let formulaOrdinal = 0
      for (const host of Array.from(root.querySelectorAll<HTMLElement>('.md-math-block'))) {
        formulas.push({
          visibleTagTokens: this.providers.getFormulaVisibleTagTokens(host),
          element: host,
          targetIdentity: `block:formula:${formulaOrdinal++}`,
        })
      }
    }

    // Links — safe local targets only (no network), missing targets only.
    // Phase 7R.3.11.8B.7.3 — each local reference is a SEPARATE fact carrying
    // its occurrence ordinal + resource kind (image vs link) so diagnostics
    // dedup per occurrence and locate the correct DOM target.
    // Phase 7R.3.11.8B.7.4 — Source Token / Semantic Resource separation: the
    // RAW Markdown token stays the source-layer identity (validity), while
    // `semanticDestination` is the vault-relative canonical path resolved from
    // the DOCUMENT base directory (DOM-layer comparison).
    const markdown = this.ctx.authority.getMarkdown()
    const activeFilePath = this.ctx.authority.getActiveFilePath()
    const vaultRoot = this.ctx.authority.vaultRoot
    // ── V5.12-R8 §4 — unified Figure Source Occurrences (ONE scanner) ──────
    // Built from the SAME scanner as `parseLocalLinkTargets`, so the two figure
    // rules agree on the occurrence and each consumes its own range:
    //   FIGURE_MISSING_NAME        → full token range
    //   FIGURE_LOCAL_IMAGE_MISSING → destination range
    let figureSourceOccurrences: FigureSourceOccurrence[] | undefined
    if (markdown != null && typeof this.providers.parseImageSourceOccurrences === 'function') {
      figureSourceOccurrences = buildFigureSourceOccurrences({
        scanned: this.providers.parseImageSourceOccurrences(markdown),
        documentKey: this.ctx.authority.getDocumentKey(),
        resolveCanonicalDestination: (rawDestination, isLocal) => isLocal
          ? resolveResourceSemanticPath(rawDestination, activeFilePath, vaultRoot)
          : rawDestination,
        isLocalFileMissing: (rawDestination) => this.providers.isLinkTargetMissing(rawDestination),
      })
    }
    if (markdown != null) {
      const rawFacts = this.providers.parseLocalLinkTargets(markdown)
      const normFacts: Array<{
        target: string
        resourceKind?: 'image' | 'link'
        sourceStart?: number
        sourceEnd?: number
        startLine?: number
        endLine?: number
        startColumn?: number
        endColumn?: number
        rawText?: string
        destinationStart?: number
        destinationEnd?: number
        rawToken?: string
        altText?: string
        resourceClass?: ResourceClass
      }> = rawFacts.map(f => (typeof f === 'string' ? { target: f } : f))
      const documentDir = activeFilePath
        ? activeFilePath.replace(/\\/g, '/').replace(/[\\/][^\\/]*$/, '')
        : null
      for (let i = 0; i < normFacts.length; i++) {
        const fact = normFacts[i]
        const target = fact.target
        const targetExists = !this.providers.isLinkTargetMissing(target)
        // Phase 7R.3.11.8B.7.6 — RESOURCE-RESOLUTION-AUDIT (state-deduped,
        // low-noise): the base authority must be the ACTIVE DOCUMENT directory.
        this.emitResourceResolutionAudit(fact.resourceKind, target, targetExists, documentDir, vaultRoot)
        // Only MISSING local targets become diagnostics (present assets are
        // healthy — Phase7 images resolved against the document dir exist).
        if (targetExists) continue
        // Semantic identity: raw token physically resolved against the active
        // document directory → vault-relative canonical when inside the vault,
        // absolute canonical when the resource escapes the vault. Shared with
        // the DOM comparison space (single identity).
        const semanticDestination = resolveResourceSemanticPath(target, activeFilePath, vaultRoot)
        // V5.12-R5 §6 — the occurrence GROUP is (resourceKind + canonical
        // destination), never the raw destination alone.
        const occurrenceIndex = linkOccurrenceIndex(
          normFacts,
          target,
          i,
          fact.resourceKind,
          semanticDestination,
        )
        links.push({
          target,
          element: null,
          index: i,
          resourceKind: fact.resourceKind,
          semanticDestination,
          // V4 — SOURCE anchor passthrough (missing-image diagnostics become
          // source-first: no rendered <img> is required to emit or locate them).
          sourceStart: fact.sourceStart,
          sourceEnd: fact.sourceEnd,
          startLine: fact.startLine,
          endLine: fact.endLine,
          startColumn: fact.startColumn,
          endColumn: fact.endColumn,
          rawText: fact.rawText,
          // V5.12-R8 §4 — destination/path range + full token travel together.
          destinationStart: fact.destinationStart,
          destinationEnd: fact.destinationEnd,
          rawToken: fact.rawToken,
          altText: fact.altText,
          resourceClass: fact.resourceClass,
          targetIdentity: `local:${target}${occurrenceIndex > 0 ? `:${occurrenceIndex + 1}` : ''}`,
        })
      }
    }

    return { headings, h1Facts, headingAuthority, latentAtxMarkers, figures, figureSourceOccurrences, tables, codes, formulas, links, headingAutoNumbering }
  }

  /** Phase 7R.3.11.8B.4.1 — LATENT-ATX marker transition log (state-deduped). */
  private emitLatentAtxMarkerLog(
    documentKey: string | null,
    facts: readonly LatentAtxMarkerFact[],
    strictMode: boolean,
  ): void {
    const signature = `${documentKey ?? ''}|${strictMode}|${facts.map(f => `${f.line}:${f.markerLevel}:${f.text}`).join(',')}`
    if (signature === this.lastLatentAtxSignature) return
    this.lastLatentAtxSignature = signature
    emitRuntimeAudit('DOCUMENT-UTILITY-LATENT-ATX-MARKER', {
      documentKey,
      mode: strictMode ? 'strict' : 'loose',
      count: facts.length,
      facts: facts.map(f => ({
        line: f.line,
        column: f.column,
        markerLevel: f.markerLevel,
        markerText: f.markerText,
        escaped: f.escaped,
        canonicalMatch: f.canonicalMatch,
        severity: strictMode ? 'WARNING' : 'HINT',
        decision: 'LATENT_ATX_HEADING_MARKER',
      })),
    })
  }

  /**
   * Phase 7R.3.11.8B.4.1 — Authority Separation audit. Structural diagnostics
   * MUST equal the canonical frame exactly; source-syntax (latent/escaped)
   * counts are reported but never written into the structural sequence.
   */
  private emitAuthoritySeparationAudit(
    authority: DiagnosticCanonicalHeadingAuthorityResult | undefined,
    scan: { latent: LatentAtxMarkerFact[]; escaped: LatentAtxMarkerFact[] },
    latentAtxMarkers: readonly LatentAtxMarkerInput[],
  ): void {
    const canonicalHeadingCount = authority?.state === 'READY' ? authority.canonicalEntryCount : 0
    const structuralHeadingCount = canonicalHeadingCount
    const nonCanonicalStructuralIncludedCount = canonicalHeadingCount === structuralHeadingCount ? 0 : 1
    const decision = authority?.state === 'READY' && nonCanonicalStructuralIncludedCount === 0 ? 'PASS' : 'NOT_EVALUATED'
    const signature = `${authority?.documentKey ?? ''}|${canonicalHeadingCount}|${structuralHeadingCount}|${latentAtxMarkers.length}|${scan.escaped.length}|${decision}`
    emitRuntimeAuditStateDedup('DOCUMENT-UTILITY-DIAGNOSTIC-AUTHORITY-SEPARATION', signature, {
      documentKey: authority?.documentKey ?? null,
      canonicalHeadingCount,
      structuralHeadingCount,
      latentAtxCount: latentAtxMarkers.length,
      escapedMarkerCount: scan.escaped.length,
      nonCanonicalStructuralIncludedCount,
      decision,
    })
  }

  /**
   * Phase 7R.3.11.8B.4 — canonical == diagnostics heading authority invariant.
   * READY frame: PASS only when canonicalHeadingCount == diagnosticHeadingCount
   * with no non-canonical entries and no missing canonical entries; FAIL
   * otherwise (blocks wrong gap publish). WAIT/INVALID / no provider →
   * NOT_EVALUATED (no heading structure diagnostics are judged anyway).
   */
  private computeHeadingAuthority(
    authority: DiagnosticCanonicalHeadingAuthorityResult | undefined,
    headings: DiagnosticHeadingFact[],
  ): HeadingDiagnosticAuthority {
    const diagIds = headings.map(h => h.stableIdentity ?? '')
    if (!authority || authority.state !== 'READY') {
      const canonicalIds: string[] = []
      return {
        canonicalHeadingCount: authority?.canonicalEntryCount ?? 0,
        diagnosticHeadingCount: headings.length,
        canonicalStableIdentities: canonicalIds,
        diagnosticStableIdentities: diagIds,
        nonCanonicalIncludedCount: headings.length,
        missingCanonicalCount: authority?.canonicalEntryCount ?? 0,
        decision: 'NOT_EVALUATED',
        reason: !authority ? 'AUTHORITY_NOT_READY' : (authority.state === 'INVALID' ? 'AUTHORITY_INVALID' : 'AUTHORITY_NOT_READY'),
      }
    }
    const canonicalIds = authority.headingFacts.map(f => f.stableIdentity)
    const canonicalSet = new Set(canonicalIds)
    const diagSet = new Set(diagIds)
    const nonCanonicalIncludedCount = diagIds.filter(id => !canonicalSet.has(id)).length
    const missingCanonicalCount = canonicalIds.filter(id => !diagSet.has(id)).length
    const countMatch = authority.canonicalEntryCount === headings.length
    const passed = countMatch && nonCanonicalIncludedCount === 0 && missingCanonicalCount === 0
    return {
      canonicalHeadingCount: authority.canonicalEntryCount,
      diagnosticHeadingCount: headings.length,
      canonicalStableIdentities: canonicalIds,
      diagnosticStableIdentities: diagIds,
      nonCanonicalIncludedCount,
      missingCanonicalCount,
      decision: passed ? 'PASS' : 'FAIL',
      reason: passed
        ? 'READY'
        : (nonCanonicalIncludedCount > 0 ? 'NON_CANONICAL_HEADING_INCLUDED' : 'CANONICAL_HEADING_MISSING'),
    }
  }

  /**
   * Phase 7R.3.11.8B.4 — heading authority runtime audits. State-token deduped:
   * identical-state repeats are suppressed; transitions / invariant FAIL always
   * re-emit (per §36).
   */
  private emitHeadingAuthorityAudits(
    authority: DiagnosticCanonicalHeadingAuthorityResult | undefined,
    invariant: HeadingDiagnosticAuthority,
  ): void {
    if (!authority) return
    const signature = `${authority.documentKey ?? ''}|${authority.state}|${invariant.canonicalHeadingCount}|${invariant.diagnosticHeadingCount}|${invariant.nonCanonicalIncludedCount}|${invariant.missingCanonicalCount}|${invariant.decision}|${invariant.reason ?? ''}`
    emitRuntimeAuditStateDedup('DOCUMENT-UTILITY-HEADING-DIAGNOSTIC-AUTHORITY', signature, {
      documentKey: authority.documentKey,
      canonicalHeadingCount: invariant.canonicalHeadingCount,
      diagnosticHeadingCount: invariant.diagnosticHeadingCount,
      physicalLevels: authority.state === 'READY' ? authority.physicalLevels : [],
      stableIdentities: authority.state === 'READY' ? authority.headingFacts.map(f => f.stableIdentity) : [],
      nonCanonicalIncludedCount: invariant.nonCanonicalIncludedCount,
      decision: invariant.decision,
      reason: invariant.reason ?? null,
    })
    emitRuntimeAuditStateDedup('DOCUMENT-UTILITY-HEADING-DIAGNOSTIC-AUTHORITY-INVARIANT', signature, {
      documentKey: authority.documentKey,
      canonicalHeadingCount: invariant.canonicalHeadingCount,
      diagnosticHeadingCount: invariant.diagnosticHeadingCount,
      canonicalStableIdentities: invariant.canonicalStableIdentities,
      diagnosticStableIdentities: invariant.diagnosticStableIdentities,
      nonCanonicalIncludedCount: invariant.nonCanonicalIncludedCount,
      missingCanonicalCount: invariant.missingCanonicalCount,
      decision: invariant.decision,
      reason: invariant.reason ?? null,
    })
  }

  /** Phase 7R.3.11.8B.4 §35 — severity transition log (strict/loose switch only). */
  private lastSeverityModeByDocument = new Map<string, boolean>()
  private emitHeadingSeverityTransition(documentKey: string | null, strictMode: boolean): void {
    if (!documentKey) return
    const prev = this.lastSeverityModeByDocument.get(documentKey)
    if (prev === undefined) {
      this.lastSeverityModeByDocument.set(documentKey, strictMode)
      return
    }
    if (prev === strictMode) return
    this.lastSeverityModeByDocument.set(documentKey, strictMode)
    for (const ruleId of ['HEADING_LEVEL_GAP', 'HEADING_EMPTY_TEXT']) {
      emitRuntimeAudit('DOCUMENT-UTILITY-DIAGNOSTIC-SEVERITY', {
        ruleId,
        documentKey,
        mode: strictMode ? 'strict' : 'loose',
        previousSeverity: prev ? 'error' : 'warning',
        nextSeverity: strictMode ? 'error' : 'warning',
        reason: 'SEVERITY_TRANSITION',
      })
    }
  }

  /**
   * V1 §37 — low-frequency audit for `DOCUMENT_HEADING_ONLY_NO_BODY`.
   * State-deduped on (documentKey | headingCount | hasBody | empty | emitted):
   * emitted on TRANSITION only, never per mutation and never per block.
   */
  private emitHeadingOnlyHintAudit(
    input: DocumentDiagnosticsInput,
    computed: DocumentDiagnosticsComputed,
  ): void {
    const headingCount = input.headings.length
    const documentEmpty = isSemanticallyEmptyDocument(input.markdown)
    const emittedDiag = computed.diagnostics.find(d => d.code === DOCUMENT_HEADING_ONLY_NO_BODY_CODE) ?? null
    // Measure the body fact only when the shape is even eligible (cheap scan).
    // Mirrors the producer's authority exactly: `data-line` + ATX text key.
    const hasBody = headingCount === 1 && input.markdown != null
      ? hasSubstantiveNonHeadingContent(
          input.markdown,
          collectCanonicalHeadingOwnedLines(
            input.markdown,
            collectCanonicalHeadingSourceLines(input.headings.map(h => h.element)),
            collectCanonicalHeadingTextKeys(input.headings.map(h => ({ physicalLevel: h.level, text: h.text }))),
          ),
        )
      : false
    const emitted = emittedDiag != null
    const signature = `${input.documentKey ?? ''}|h${headingCount}|body:${hasBody}|empty:${documentEmpty}|e:${emitted}`
    emitRuntimeAuditStateDedup('DOCUMENT-DIAGNOSTIC-HEADING-ONLY-AUDIT', signature, {
      documentKey: input.documentKey,
      headingCount,
      hasSubstantiveNonHeadingContent: hasBody,
      documentEmpty,
      emitted,
      diagnosticId: emittedDiag?.id ?? null,
      targetKey: emittedDiag?.targetIdentity ?? null,
      decision: emitted ? 'EMIT' : 'SUPPRESS',
      reason: documentEmpty
        ? 'DOCUMENT_EMPTY_PRECEDENCE'
        : emitted
          ? 'HEADING_ONLY_NO_BODY'
          : headingCount === 1
            ? 'HAS_SUBSTANTIVE_BODY'
            : `HEADING_COUNT_${headingCount}`,
    })
  }

  /**
   * Phase 7R.3.11.8B.1 — low-noise H1 authority audits.
   *  - DOCUMENT-UTILITY-H1-AUTHORITY-BRIDGE (state-token deduped)
   *  - DOCUMENT-UTILITY-H1-AUTHORITY-INVARIANT: only READY may yield PASS/FAIL;
   *    WAIT/INVALID → NOT_EVALUATED (Phase 7R.3.11.8B.2). State-token deduped.
   */
  private emitH1AuthorityAudits(authority: DiagnosticCanonicalHeadingAuthorityResult): void {
    const signature = `${authority.documentKey ?? ''}|${authority.state}|${authority.reason}|${authority.canonicalEntryCount}|${authority.mappedEntryCount}|${authority.invalidEntryCount}|${authority.physicalLevels.join(',')}|${authority.h1Count}`
    if (signature !== this.lastH1BridgeSignature) {
      this.lastH1BridgeSignature = signature
      emitRuntimeAudit('DOCUMENT-UTILITY-H1-AUTHORITY-BRIDGE', {
        documentKey: authority.documentKey,
        activeDocumentKey: this.ctx.authority.getDocumentKey(),
        framePresent: authority.framePresent,
        frameDocumentKey: authority.frameDocumentKey,
        semanticRevision: authority.semanticRevision,
        frameGeneration: authority.frameGeneration,
        canonicalEntryCount: authority.canonicalEntryCount,
        mappedEntryCount: authority.mappedEntryCount,
        invalidEntryCount: authority.invalidEntryCount,
        physicalLevels: authority.physicalLevels,
        h1Count: authority.h1Count,
        h1StableIdentities: authority.h1StableIdentities,
        authorityState: authority.state,
        reason: authority.reason,
        decision: authority.state,
      })
    }
    // Hard invariant — only a READY frame is evaluated. A READY frame that
    // visibly contains level 1 can NEVER produce h1Count=0; if it ever does,
    // fail loudly (false NO_H1 would otherwise be published).
    const isReady = authority.state === 'READY'
    const invariantViolated = isReady && authority.physicalLevels.includes(1) && authority.h1Count === 0
    const invariantDecision = isReady ? (invariantViolated ? 'FAIL' : 'PASS') : 'NOT_EVALUATED'
    const invariantReason = isReady
      ? (invariantViolated ? 'COUNT_MISMATCH' : 'READY')
      : (authority.state === 'INVALID' ? 'AUTHORITY_INVALID' : 'AUTHORITY_NOT_READY')
    const invariantSignature = `${authority.documentKey ?? ''}|${authority.state}|${authority.physicalLevels.join(',')}|${authority.h1Count}|${invariantDecision}`
    if (invariantSignature !== this.lastH1InvariantSignature) {
      this.lastH1InvariantSignature = invariantSignature
      emitRuntimeAudit('DOCUMENT-UTILITY-H1-AUTHORITY-INVARIANT', {
        documentKey: authority.documentKey,
        canonicalEntryCount: authority.canonicalEntryCount,
        mappedEntryCount: authority.mappedEntryCount,
        h1Count: authority.h1Count,
        physicalLevels: authority.physicalLevels,
        authorityState: authority.state,
        decision: invariantDecision,
        reason: invariantReason,
      })
    }
  }
}
