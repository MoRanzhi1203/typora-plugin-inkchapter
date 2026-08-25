/**
 * Phase 7R.3.11 — Document Diagnostics Authority (event-driven).
 *
 * Holds ONE committed snapshot per active document. Recompute is triggered by
 * the overlay host on relevant events (document switch, canonical frame
 * commit, caption/formula state change, manual recheck) — NEVER by timers or
 * polling. It consumes existing authorities and never derives numbering
 * semantics itself.
 */
import { computeDocumentDiagnostics } from './document-diagnostics'
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
  /** Parse markdown into local link targets (authority-driven, no network). */
  parseLocalLinkTargets: (markdown: string) => string[]
  /** Phase 7R.3.11.8B.1 — canonical H1 authority bridge result (WAIT/INVALID/READY).
   *  Optional so tests that never exercise STRICT-SINGLE-H1 need no stub. */
  getCanonicalH1Facts?: () => DiagnosticCanonicalHeadingAuthorityResult
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
  recompute(): void {
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
    const nextSnapshot: DocumentDiagnosticsSnapshot = {
      documentKey: input.documentKey,
      revision: this.revision,
      sourceRevision: this.sourceRevision,
      generatedAt: Date.now(),
      diagnostics: computed.diagnostics,
      errorCount: computed.errorCount,
      warningCount: computed.warningCount,
      infoCount: computed.infoCount,
    }
    // Phase 7R.3.11.8-B §32 — state-transition logging: identical-state recomputes
    // (same document + same diagnostic content) do NOT re-publish / re-notify.
    const fingerprint = `${nextSnapshot.documentKey ?? ''}|${nextSnapshot.diagnostics
      .map(d => `${d.severity}:${d.code}:${d.targetIdentity ?? d.stableIdentity ?? ''}`)
      .sort()
      .join(';')}`
    if (fingerprint === this.lastContentFingerprint) {
      return
    }
    this.lastContentFingerprint = fingerprint
    this.snapshot = nextSnapshot
    this.notify()
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
      markerLevel: f.markerLevel,
      markerText: f.markerText,
      text: f.text,
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
      for (const img of Array.from(root.querySelectorAll<HTMLElement>('img'))) {
        if (img.closest('[data-inkchapter-caption]')) continue
        const { localPath } = this.providers.resolveImageLocalPath(img)
        figures.push({
          name: this.providers.getFigureName(img),
          localPath: localPath ?? undefined,
          element: img,
        })
      }

      // Tables.
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('table'))) {
        if (el.closest('[data-inkchapter-caption]')) continue
        tables.push({ name: this.providers.getTableName(el), element: el })
      }

      // Code — canonical fence host only; CodeMirror renderer descendants are
      // never treated as separate code blocks.
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('pre.md-fences'))) {
        codes.push({
          name: this.providers.getCodeName(el),
          language: this.providers.getCodeLanguage(el),
          element: el,
        })
      }

      // Formula — block math hosts; projection invariants only.
      for (const host of Array.from(root.querySelectorAll<HTMLElement>('.md-math-block'))) {
        formulas.push({
          visibleTagTokens: this.providers.getFormulaVisibleTagTokens(host),
          element: host,
        })
      }
    }

    // Links — safe local targets only (no network), missing targets only.
    const markdown = this.ctx.authority.getMarkdown()
    if (markdown != null) {
      for (const target of this.providers.parseLocalLinkTargets(markdown)) {
        if (this.providers.isLinkTargetMissing(target)) {
          links.push({ target, element: null })
        }
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
