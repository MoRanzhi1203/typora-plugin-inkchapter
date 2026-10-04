/**
 * Phase 7R.3.11 — Document Utilities: diagnostic model types.
 *
 * Presentation/diagnostics layer ONLY. These types describe problems detected
 * from the EXISTING numbering/caption/formula authorities — they never rebuild
 * heading numbering or object scope semantics.
 */

import type { DiagnosticDomain } from './diagnostic-domain-v1'
import type { SourceSyntaxOpenerLocation } from './document-diagnostic-source-syntax-location-authority'

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
 * V5.12-R8 §5 — which part of a Markdown image token a source range points at.
 * Fixed semantics:
 *   FIGURE_MISSING_NAME        → 'figure-full-token'
 *   FIGURE_LOCAL_IMAGE_MISSING → 'figure-destination'
 */
export type DiagnosticRangeRole = 'figure-full-token' | 'figure-destination'

/**
 * V1 (Figure Diagnostic Locator) — the stable identity of ONE Figure source
 * occurrence.
 *
 * `src` / `destination` alone can NEVER identify an occurrence (`![](same.png)`
 * twice is two legal figures). The identity is the owning source block + the
 * exact token range + the within-block ordinal, all derived from the Markdown
 * SOURCE (never from the DOM, never from a viewport rect).
 */
export interface DiagnosticFigureOccurrenceIdentity {
  documentKey: string | null
  /** Source generation the identity was computed against. */
  sourceRevision: number | null
  /** `src-block:<startLine>` — the owning Markdown block identity. */
  sourceBlockIdentity: string
  /** 0-based ordinal of the owning block among identical source blocks. */
  sourceBlockOrdinal: number
  /** Absolute offset of the `![alt](dest)` token (null when unknown). */
  tokenStart: number | null
  tokenEnd: number | null
  /** Ordinal of the owning source line among identical raw lines. */
  rawLineOrdinal: number
  /** Ordinal of this token among same-line occurrences of the same group. */
  occurrenceWithinLine: number
  /** Canonical (normalized) destination — display / fallback only, never identity. */
  destination: string
}

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
      /**
       * Scan-time raw text of the anchored source line. The resolver uses it
       * to verify that the element found at `startLine` still carries the
       * scanned content (real source mutation → TARGET_CHANGED) and to
       * re-anchor by text context when the line cannot map to DOM directly
       * (source-only diagnostics such as LATENT_ATX_HEADING_MARKER).
       */
      rawText?: string
      /**
       * V5.12-R5 §5 — the EXACT source range + its identity. A duplicate
       * resource (`![](same.png)` twice) must be resolved by THIS range, never
       * by the first text match. Additive: every existing source-range
       * consumer keeps working when these are absent.
       */
      sourceStart?: number | null
      sourceEnd?: number | null
      sourceRangeIdentity?: string | null
      resourceKind?: 'image' | 'link'
      canonicalDestination?: string
      rawDestination?: string
      /** Expected occurrence ordinal (the clicked diagnostic's own fact). */
      occurrenceIndex?: number
      /** §8.2 — 0-based source-block ordinal among identical raw source lines. */
      rawLineOrdinal?: number
      /** §8.2 — 0-based token ordinal inside the owning source block. */
      occurrenceWithinLine?: number
      /**
       * V5.12-R8 §5 — WHICH part of the Markdown image token this location
       * points at. `figure-full-token` = the whole `![alt](dest)` (the
       * FIGURE_MISSING_NAME target); `figure-destination` = the `dest` path
       * only (the FIGURE_LOCAL_IMAGE_MISSING target). Absent = legacy range.
       */
      rangeRole?: DiagnosticRangeRole
      /** V5.12-R8 §4 — the full Markdown token text (`![alt](dest)`). */
      rawToken?: string
      /** V5.12-R8 §4 — absolute offsets of the full token range. */
      tokenStart?: number | null
      tokenEnd?: number | null
      /** V5.12-R8 §4 — absolute offsets of the destination/path range. */
      destinationStart?: number | null
      destinationEnd?: number | null
    }
  | { kind: 'document-start' }
  | { kind: 'document-end' }
  /**
   * V1 — Diagnostic BLOCK locator (Locator A). The diagnostic target is the
   * WHOLE illegal owning block, never one image token inside it. Used by
   * `FIGURE_BLOCK_STRUCTURE_INVALID`, whose owning block may legitimately
   * contain several inline occurrences (that IS the violation).
   */
  | {
      kind: 'source-block'
      objectKind: 'figure'
      /** `src-block:<startLine>` — the owning Markdown block identity. */
      sourceBlockIdentity: string
      /** 0-based ordinal of the owning block among identical source blocks. */
      sourceBlockOrdinal: number
      /** Absolute source span of the WHOLE owning block (the locate target). */
      sourceStart: number
      sourceEnd: number
      startLine: number
      endLine: number
      sourceRevision: number | null
      locatorStrategy: 'OWNING_BLOCK'
    }
  /**
   * V1 — Figure OCCURRENCE locator (Locator B). The target is ONE image
   * occurrence, identified by `FigureOccurrenceIdentity` (owning block +
   * token range + within-block ordinal) — never by destination alone.
   */
  | {
      kind: 'figure-occurrence'
      occurrenceIdentity: DiagnosticFigureOccurrenceIdentity
      resourceKind: 'image'
      /** Which part of the Markdown token this rule targets. */
      rangeRole: DiagnosticRangeRole
      startLine: number
      startColumn: number
      endLine?: number
      endColumn?: number
      rawText?: string
      sourceStart: number | null
      sourceEnd: number | null
      sourceRangeIdentity: string | null
      canonicalDestination: string
      rawDestination: string
      occurrenceIndex: number
      rawLineOrdinal: number
      occurrenceWithinLine: number
      rawToken?: string
      tokenStart: number | null
      tokenEnd: number | null
      destinationStart: number | null
      destinationEnd: number | null
    }
  | {
      kind: 'block-node'
      blockKind: 'figure' | 'table' | 'code' | 'formula' | 'link'
      stableIdentity: string
    }
  /**
   * Caption Integrity (spec §8/§15) — a DOM-side locator for a caption
   * PROJECTION. Caption ownership is a runtime concept, so the locator carries
   * the caption service's OWN stable `captionId` (never a source offset, never
   * an adjacency-derived neighbour). Locate resolves the live caption element
   * by that id.
   */
  | {
      kind: 'caption-projection'
      captionKind: 'figure' | 'table' | 'code'
      captionId: string
    }
  | {
      kind: 'multi-target'
      targets: readonly DiagnosticLocation[]
    }
  /**
   * TRAE V4 §3 — a SOURCE-SYNTAX OPENER locator. The target is the Markdown
   * source-syntax opening token (code fence ``` / display formula $$ / front
   * matter `---`) of a protected region that never closed — NEVER a canonical
   * code-block object, and NEVER the opener→EOF protected range. The three
   * ranges (`protectedRange` / `locationRange` / `presentationRange`) are
   * deliberately separate fields.
   */
  | SourceSyntaxOpenerLocation
  /**
   * V1 (Target Group closure) — a TARGET GROUP. ONE diagnostic whose semantic
   * fact is carried by SEVERAL co-equal members (e.g. "the document only owns a
   * heading structure": every heading is a member of ONE document-level fact).
   *
   * It is DELIBERATELY a separate kind from `multi-target`:
   *   - `multi-target` = N independent OCCURRENCES (1/N … N/N rows, cursor, switch);
   *   - `target-group` = ONE fact / ONE Drawer row / ONE interaction / ONE lease
   *     with N semantic + visual members.
   *
   * `scrollAnchor` is the SINGLE viewport locate target (the first member);
   * `targets` are ALL members in document order.
   */
  | {
      kind: 'target-group'
      scrollAnchor: DiagnosticLocation
      targets: readonly DiagnosticLocation[]
    }

/**
 * Phase 7R.3.11.8B.7.3 — Diagnostic semantic anchor kinds.
 *
 * A semantic anchor is a STRONGER-than-line identity for a diagnostic target,
 * derived from the diagnostic predicate itself (not from the DOM at scan
 * time). It survives DOM reshapes (wrapper insertion, paragraph splits,
 * decorated caption DOM) because resolution re-derives it from the CURRENT
 * frame at click time.
 */
export type DiagnosticSemanticAnchorKind =
  /** Source text block — the predicate is "line contains a latent marker". */
  | 'source-text'
  /** Local resource — the predicate is "local resource target missing". */
  | 'resource'

/**
 * Phase 7R.3.11.8B.7.3 — diagnostic scan-time source validity fingerprint.
 *
 * VALIDITY ≠ DOM RESOLUTION. Every locatable diagnostic carries a fingerprint
 * over the MINIMAL scan-time source fact its predicate depends on:
 *
 *   latent-atx / source-range  → rawText of the anchored source line
 *   resource (missing local)   → the raw Markdown destination path
 *
 * At click time the overlay re-reads the CURRENT Markdown at the same
 * position and recomputes the fingerprint. A MISMATCH is a REAL source-level
 * change (STALE); a MATCH means the diagnostic is STILL_VALID even when the
 * DOM cannot be resolved right now (UNRESOLVED, never STALE).
 */
export type DiagnosticValidityFingerprint =
  | {
      kind: 'source-text'
      /** 0-based source line whose text must still equal `text`. */
      line: number
      /** Normalized scan-time raw text of that line. */
      text: string
    }
  | {
      kind: 'resource'
      /** Normalized scan-time Markdown destination (e.g. "phase6-test.png"). */
      path: string
      /** Resource occurrence ordinal (1-based) among identical destinations. */
      occurrence: number
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
  /**
   * Unified Diagnostics Domain V1 §11 — WHOSE problem this is. Every
   * `DocumentDiagnostic` is produced by the document authority and therefore
   * carries `domain: 'document'` (set once in `makeDiagnostic`). The field is
   * optional in the TYPE only so pre-existing pure-test literals stay valid;
   * the runtime output of the producer always sets it, and the domain selector
   * treats a missing value as the document domain.
   */
  domain?: DiagnosticDomain
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
   * Phase 7R.3.11.8B.7.3 — scan-time source validity fingerprint. Absent =
   * the diagnostic is treated as always-valid until a live recompute retires
   * it (structure rules with canonical identities). Source-syntax and
   * resource rules MUST carry one so "target changed" is a PROVEN verdict.
   */
  validityFingerprint?: DiagnosticValidityFingerprint
  /**
   * Phase 7R.3.11.8B.5 — Universal Location Authority. Every published
   * Error/Warning/Hint diagnostic MUST carry a non-null `location`
   * (PUBLISHED = LOCATABLE). Producers attach it; the overlay's locate button
   * resolves it via `resolveDiagnosticLocation`.
   */
  location?: DiagnosticLocation
  /**
   * V5.12-R6 §9 — an explicitly NON-LOCATABLE document notice.
   *
   * The empty-document terminal state publishes exactly one diagnostic
   * (`DOCUMENT_EMPTY`) which must NOT be locatable: there is no source target
   * to scroll to, and a bogus H1 / paragraph / EOF target is forbidden. Such a
   * diagnostic carries `nonLocatableNotice: true` and NO `location`; the
   * location contract counts it as a declared notice (never as an unlocatable
   * violation of PUBLISHED = LOCATABLE).
   */
  nonLocatableNotice?: true
}

// ── Numbering Integrity V2 (§9/§21) — canonical effective-number facts ───────
//
// The ONE read-only "effective number" fact provider. It is produced by the
// EXISTING canonical numbering authority (the caption service / formula
// planner) and CONSUMED by the source-only diagnostics producer — the producer
// NEVER re-derives a number and NEVER parses one out of rendered text.

/** Which object kind an effective number belongs to. */
export type ObjectEffectiveNumberKind = 'figure' | 'table' | 'code' | 'formula'

/**
 * ONE canonical effective-number fact. Every field is a CANONICAL fact supplied
 * by the numbering authority (never parsed from rendered text).
 */
export interface ObjectEffectiveNumberFact {
  /** The canonical effective number (raw, no display prefix), e.g. `1` / `2.1`. */
  effectiveNumber: string
  /**
   * FORMULA — the effective SECTION number ENCODED by `effectiveNumber` when
   * the numbering is section-scoped (`effectiveScope === 'section'`). Absent
   * when the number is NOT section-scoped → the section-mismatch rule must
   * never fire (do not invent a section).
   */
  sectionNumber?: string
  /**
   * FORMULA — the section number the object ACTUALLY sits in, per the numbering
   * authority's own canonical resolver. Absent when unknown.
   */
  actualSectionNumber?: string
}

/**
 * The canonical effective-number snapshot the diagnostics producer consumes.
 * `bySourceIdentity` is keyed by the object's CANONICAL SOURCE identity
 * (`block:<kind>:<ordinal>`), i.e. the SAME identity the figure / table / code
 * / formula source rules already use for their stable diagnostic ids — no
 * parallel key is invented.
 */
export interface ObjectEffectiveNumbersSnapshot {
  numberingEnabled: boolean
  sectionNumberingEnabled: boolean
  bySourceIdentity: ReadonlyMap<string, ObjectEffectiveNumberFact>
}

/**
 * The numbering authority's raw (element-keyed) effective-number facts. The
 * diagnostics authority joins each of ITS object facts (element + canonical
 * `block:<kind>:<ordinal>` identity) to this map to build the
 * `ObjectEffectiveNumbersSnapshot.bySourceIdentity` — the identity authority
 * stays the diagnostics layer; the NUMBER authority stays the caption service.
 */
export interface ObjectEffectiveNumberElementFacts {
  numberingEnabled: boolean
  sectionNumberingEnabled: boolean
  byElement: ReadonlyMap<HTMLElement, ObjectEffectiveNumberFact>
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
  /**
   * Phase 7R.3.11.8B.7.1 — Mode provenance. The snapshot is ONLY authoritative
   * for the effective heading structure mode it was computed with. A mode
   * change MUST produce a new snapshot even when the content is unchanged.
   */
  effectiveMode?: 'strict' | 'loose'
  /** Effective-mode transition revision (increments on REAL transitions only). */
  effectiveModeRevision?: number
}

export interface DocumentDiagnosticsState {
  /** e.g. 'NO_ACTIVE_DOCUMENT' | 'EMPTY_DOCUMENT' | 'HEALTHY' | 'HAS_ISSUES' */
  state: 'NO_ACTIVE_DOCUMENT' | 'EMPTY_DOCUMENT' | 'HEALTHY' | 'HAS_ISSUES'
  errorCount: number
  warningCount: number
  infoCount: number
}
