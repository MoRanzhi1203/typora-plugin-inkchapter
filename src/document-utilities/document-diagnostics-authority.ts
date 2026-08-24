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
} from './document-diagnostics'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { collectDiagnosticsInput, resolveBusinessContentRoot, type DocumentUtilitiesContext } from './document-utilities-context'
import type { DiagnosticCanonicalHeadingAuthorityResult } from './document-h1-authority-bridge'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

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
    const computed = computeDocumentDiagnostics(input)
    this.emitHeadingGapInputIfAny(structural.headings, input.documentKey)
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
    figures: DiagnosticObjectFact[]
    tables: DiagnosticObjectFact[]
    codes: DiagnosticObjectFact[]
    formulas: DiagnosticFormulaFact[]
    links: DiagnosticLinkFact[]
  } {
    const root = resolveBusinessContentRoot()
    const headings: DiagnosticHeadingFact[] = []
    const figures: DiagnosticObjectFact[] = []
    const tables: DiagnosticObjectFact[] = []
    const codes: DiagnosticObjectFact[] = []
    const formulas: DiagnosticFormulaFact[] = []
    const links: DiagnosticLinkFact[] = []
    // Phase 7R.3.11.8B.1 — canonical H1 authority bridge (WAIT/INVALID/READY).
    // WAIT/INVALID → h1Facts = null (STRICT-SINGLE-H1 must NOT be judged).
    // READY (even empty) → h1Facts = canonical H1 facts.
    const authority = this.providers.getCanonicalH1Facts?.()
    let h1Facts: DiagnosticH1Fact[] | null = null
    if (authority) {
      this.emitH1AuthorityAudits(authority)
      if (authority.state === 'READY') {
        h1Facts = authority.h1Facts.map(f => ({
          stableIdentity: f.stableIdentity,
          element: f.element,
          text: f.element?.textContent?.trim() ?? undefined,
        }))
      }
    }

    if (root) {
      // Headings — level + text only (never re-derived numbering).
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))) {
        const level = parseInt(el.tagName.charAt(1), 10)
        headings.push({
          level,
          text: (el.textContent ?? '').trim(),
          stableIdentity: this.providers.getHeadingIdentity(el) ?? undefined,
          element: el,
        })
      }

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

    return { headings, h1Facts, figures, tables, codes, formulas, links }
  }

  /**
   * Phase 7R.3.11.8B.1 — low-noise H1 authority audits.
   *  - DOCUMENT-UTILITY-H1-AUTHORITY-BRIDGE (state-token deduped)
   *  - DOCUMENT-UTILITY-H1-AUTHORITY-INVARIANT (hard: READY frame whose
   *    physicalLevels contain 1 but h1Count===0 must FAIL and block false NO_H1)
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
    // Hard invariant — a READY frame that visibly contains level 1 can NEVER
    // produce h1Count=0; if it ever does, block false NO_H1 and fail loudly.
    const invariantViolated = authority.state === 'READY'
      && authority.physicalLevels.includes(1)
      && authority.h1Count === 0
    emitRuntimeAudit('DOCUMENT-UTILITY-H1-AUTHORITY-INVARIANT', {
      documentKey: authority.documentKey,
      canonicalEntryCount: authority.canonicalEntryCount,
      mappedEntryCount: authority.mappedEntryCount,
      h1Count: authority.h1Count,
      physicalLevels: authority.physicalLevels,
      decision: invariantViolated ? 'FAIL' : 'PASS',
    })
  }
}
