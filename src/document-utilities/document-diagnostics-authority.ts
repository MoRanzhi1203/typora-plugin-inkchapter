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
  DiagnosticHeadingFact,
  DiagnosticLinkFact,
  DiagnosticObjectFact,
} from './document-diagnostics'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { collectDiagnosticsInput, resolveBusinessContentRoot, type DocumentUtilitiesContext } from './document-utilities-context'
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
}

export class DocumentDiagnosticsAuthority {
  private snapshot: DocumentDiagnosticsSnapshot | null = null
  private revision = 0
  private sourceRevision = 0
  private lastDocumentKey: string | null = null
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
    this.snapshot = {
      documentKey: input.documentKey,
      revision: this.revision,
      sourceRevision: this.sourceRevision,
      generatedAt: Date.now(),
      diagnostics: computed.diagnostics,
      errorCount: computed.errorCount,
      warningCount: computed.warningCount,
      infoCount: computed.infoCount,
    }
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

    return { headings, figures, tables, codes, formulas, links }
  }
}
