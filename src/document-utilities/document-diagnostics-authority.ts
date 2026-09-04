/**
 * Phase 7R.3.11 — Document Diagnostics Authority (event-driven).
 *
 * Holds ONE committed snapshot per active document. Recompute is triggered by
 * the overlay host on relevant events (document switch, canonical frame
 * commit, caption/formula state change, manual recheck) — NEVER by timers or
 * polling. It consumes existing authorities and never derives numbering
 * semantics itself.
 */
import { computeDocumentDiagnostics, computeEofNewlinePolicy } from './document-diagnostics'
import type {
  DiagnosticFormulaFact,
  DiagnosticH1Fact,
  DiagnosticHeadingFact,
  DiagnosticLinkFact,
  DiagnosticObjectFact,
  HeadingDiagnosticAuthority,
  LatentAtxMarkerInput,
} from './document-diagnostics'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { collectDiagnosticsInput, resolveBusinessContentRoot, type DocumentUtilitiesContext } from './document-utilities-context'
import type {
  DiagnosticCanonicalHeadingAuthorityResult,
  DiagnosticCanonicalHeadingFact,
} from './document-h1-authority-bridge'
import {
  detectLatentAtxMarkers,
  collectCanonicalHeadingSourceLines,
  collectCanonicalHeadingTextKeys,
  type LatentAtxMarkerFact,
} from './latent-atx-heading-marker'
import { linkOccurrenceIndex, resolveResourceSemanticPath, normalizeResourceToken } from './document-diagnostics'
import {
  computeDiagnosticLocationContract,
  getRuleMeta,
} from './document-diagnostic-location'
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
  parseLocalLinkTargets: (markdown: string) => Array<string | { target: string; resourceKind?: 'image' | 'link' }>
  /** Phase 7R.3.11.8B.1 — canonical H1 authority bridge result (WAIT/INVALID/READY).
   *  Optional so tests that never exercise STRICT-SINGLE-H1 need no stub. */
  getCanonicalH1Facts?: () => DiagnosticCanonicalHeadingAuthorityResult
  /** Phase 7R.3.11.8B.7.6 — rendered caption host for a business object
   *  element (img/table/pre) — compound missing-name locator. Optional. */
  getObjectCaptionHost?: (el: HTMLElement) => HTMLElement | null
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
    // Phase 7R.3.11.8B.4 — severity transition log (strict/loose switch only).
    this.emitHeadingSeverityTransition(input.documentKey, input.strictMode)
    const computed = computeDocumentDiagnostics(input)
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
      diagnostics: computed.diagnostics,
      errorCount: computed.errorCount,
      warningCount: computed.warningCount,
      infoCount: computed.infoCount,
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
    if (fingerprint === this.lastContentFingerprint) {
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

  private collectStructuralFacts(): {
    headings: DiagnosticHeadingFact[]
    h1Facts: DiagnosticH1Fact[] | null
    headingAuthority: HeadingDiagnosticAuthority
    latentAtxMarkers: LatentAtxMarkerInput[]
    figures: DiagnosticObjectFact[]
    tables: DiagnosticObjectFact[]
    codes: DiagnosticObjectFact[]
    formulas: DiagnosticFormulaFact[]
    links: DiagnosticLinkFact[]
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
    const headings: DiagnosticHeadingFact[] = canonicalHeadingFacts.map(f => ({
      level: f.physicalLevel,
      text: f.text,
      stableIdentity: f.stableIdentity,
      element: f.element,
    }))
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
      for (const img of Array.from(root.querySelectorAll<HTMLElement>('img'))) {
        if (img.closest('[data-inkchapter-caption]')) continue
        const { localPath } = this.providers.resolveImageLocalPath(img)
        figures.push({
          name: this.providers.getFigureName(img),
          localPath: localPath ?? undefined,
          element: img,
          targetIdentity: `block:figure:${figureOrdinal++}`,
        })
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
    if (markdown != null) {
      const rawFacts = this.providers.parseLocalLinkTargets(markdown)
      const normFacts: Array<{ target: string; resourceKind?: 'image' | 'link' }> = rawFacts.map(f =>
        typeof f === 'string' ? { target: f } : f,
      )
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
        const occurrenceIndex = linkOccurrenceIndex(normFacts, target, i)
        // Semantic identity: raw token physically resolved against the active
        // document directory → vault-relative canonical when inside the vault,
        // absolute canonical when the resource escapes the vault. Shared with
        // the DOM comparison space (single identity).
        const semanticDestination = resolveResourceSemanticPath(target, activeFilePath, vaultRoot)
        links.push({
          target,
          element: null,
          index: i,
          resourceKind: fact.resourceKind,
          semanticDestination,
          targetIdentity: `local:${target}${occurrenceIndex > 0 ? `:${occurrenceIndex + 1}` : ''}`,
        })
      }
    }

    return { headings, h1Facts, headingAuthority, latentAtxMarkers, figures, tables, codes, formulas, links }
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
