/**
 * Phase 7R.3.11 — Document Utilities: shared document context.
 *
 * ONE shared document context (documentKey / active editor root / active
 * scroll container / authority accessors) reused by every utility so they
 * never query DOM or resolve authority facts independently.
 */
import type { DocumentDiagnosticsInput } from './document-diagnostics'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import type { ActiveLeafDocumentFacts } from './document-active-leaf-presence'

export interface HeadingPolicyActivationState {
  /** Global heading-numbering feature master switch (enabled ≠ configured). */
  enabled: boolean
  /** User EXPLICITLY configured a heading structure policy (never default). */
  configured: boolean
  /** Effective structure mode resolved by the numbering authority. */
  effectiveMode: 'strict' | 'loose' | 'custom' | null
  /** enabled && configured && effectiveMode === 'strict'. */
  strictPolicyActive: boolean
  // ── Phase 7R.3.11.8B.10 authority fields (full audit; stubs may omit) ──
  /** Stored structure mode (default/legacy seed is JUST a stored value). */
  storedMode?: 'strict' | 'loose' | 'custom' | null
  /** storedMode === 'strict' — still NOT activation. */
  storedStrictRequire?: boolean
  /** Global scope explicitly activated (write-authority bit). */
  globalScopeEnabled?: boolean
  /** Current document carries an explicit override. */
  documentScopeEnabled?: boolean
  documentOverride?: 'strict' | 'loose' | null
  activationSource?: 'none' | 'global-explicit' | 'document-explicit' | 'inherited'
  effectivePolicyActive?: boolean
  effectiveStrictRequire?: boolean
}

export interface DocumentUtilitiesAuthorityContext {
  getActiveFilePath: () => string | null
  getDocumentKey: () => string | null
  /**
   * V3 — ACTIVE workspace leaf document facts (highest-priority ACTIVE
   * DOCUMENT PRESENCE authority). When supplied, an EXPLICIT EMPTY leaf
   * (known=true + path='') HARD-VETOES every stale `getActiveFilePath()` /
   * `getDocumentKey()` fallback; only when the leaf is unreadable
   * (known=false) may the legacy file/document-key sources participate.
   * Absent in legacy/headless consumers → the leaf is treated as UNKNOWN and
   * the legacy fallback keeps its exact previous behavior.
   */
  getActiveLeafState?: () => ActiveLeafDocumentFacts | null | undefined

  getMarkdown: () => string | null
  /** Strict heading structure mode (numbering authority). */
  isStrictMode: () => boolean
  /**
   * Phase 7R.3.11.8B.9 — CONDITIONAL strict-policy activation. Only when this
   * reports strictPolicyActive === true may Document Diagnostics emit
   * strict-policy rules (must exist H1 / single H1 / start-with-H1 / no pre-H1
   * body). Optional so pure tests that never exercise the settings pipeline
   * keep the legacy strictMode boolean semantics.
   */
  getHeadingPolicyState?: () => HeadingPolicyActivationState
  /**
   * Phase 7R.3.11.8B.7.1 — effective-mode transition revision (increments on
   * REAL strict<->loose transitions only; idempotent/shielded writes do not).
   * Optional so tests that never exercise the mode pipeline need no stub.
   */
  getEffectiveHeadingModeRevision?: () => number
  /** Phase 7R.3.11.8B.7.1 — latest PUBLISHED diagnostic snapshot (invariant). */
  getDiagnosticSnapshot?: () => DocumentDiagnosticsSnapshot | null
  vaultRoot: string | null
  /** Optional canonical heading frame duplicate identities. */
  getCanonicalDuplicateIdentities: () => string[]
  /** Caption-service-provided duplicate names across figure/table/code. */
  getCaptionDuplicateNames: () => string[]
  /**
   * VNext §24 — which OBJECT auto-numbering systems are ON (figure/table/code/
   * formula). Optional: without it the manual-number rules stay OFF (a literal
   * `1.` prefix is then plain text and must never be reported).
   */
  getObjectNumberingEnabled?: () => { figure?: boolean; table?: boolean; code?: boolean; formula?: boolean }
  /**
   * Heading Auto-Number Conflict V1 §2/§4 — the ONE per-heading heading
   * auto-numbering EFFECTIVENESS authority, owned by the heading numbering
   * service. `isEffectiveForElement` answers "will the plugin paint an automatic
   * number on THIS heading?" for the CURRENT effective settings (strict/loose H1
   * · per-level enabled · maxDepth · overrides). Optional: absent (pure/legacy
   * consumers) means the conflict rule never runs.
   */
  getHeadingAutoNumberingEffectiveFacts?: () => {
    enabled: boolean
    h1NumberingEnabled: boolean
    /** Heading Auto-Number Conflict V1.2 §13 — the effective STYLE identity. */
    styleKey?: string
    isEffectiveForElement: (element: HTMLElement | null) => boolean
  }
}

export interface DocumentUtilitiesContext {
  authority: DocumentUtilitiesAuthorityContext
  /** True when the given documentKey currently has an active business document. */
  hasActiveDocument: () => boolean
}

/**
 * Resolve the Markdown business content root (Typora `#write` writing area).
 * Forensic: Typora creates `#write` as the contenteditable writing area and
 * `editor.writingArea` is the SAME element — so `#write` is authoritative and
 * keeps this module free of a hard `typora` module dependency (test-safe).
 */
export function resolveBusinessContentRoot(): HTMLElement | null {
  return document.getElementById('write') as HTMLElement | null
}

/**
 * Resolve the active Markdown editor scroll container.
 *
 * Forensic (Typora): the writing area `#write` is centered inside its parent,
 * and the parent element is the scroll viewport (the community framework's
 * MdEditorMode uses `editor.writingArea.parentElement.scrollTop` for
 * getScroll/applyScroll). `#write` itself is NOT the scroll container, and
 * `window` must not be assumed either.
 */
export function resolveEditorScrollContainer(): HTMLElement | null {
  const root = resolveBusinessContentRoot()
  if (!root) return null
  const parent = root.parentElement
  return parent instanceof HTMLElement ? parent : root
}

/**
 * Build a diagnostics input from the shared context + structural DOM facts.
 * The structural facts are collected read-only here so the pure compute stays
 * authority-driven (it consumes heading levels/text, caption records and
 * formula projection output — it never derives numbering semantics).
 */
export function collectDiagnosticsInput(
  ctx: DocumentUtilitiesContext,
  structural: {
    headings: DocumentDiagnosticsInput['headings']
    /** Phase 7R.3.11.8-B — canonical H1 facts (null = frame not ready). */
    h1Facts: DocumentDiagnosticsInput['h1Facts']
    /** Phase 7R.3.11.8B.4 — canonical heading authority invariant. */
    headingAuthority: DocumentDiagnosticsInput['headingAuthority']
    /** Phase 7R.3.11.8B.4.1 — latent ATX source-syntax facts (isolated). */
    latentAtxMarkers: DocumentDiagnosticsInput['latentAtxMarkers']
    figures: DocumentDiagnosticsInput['figures']
    /** V5.12-R8 §4 — unified figure source occurrences (optional). */
    figureSourceOccurrences?: DocumentDiagnosticsInput['figureSourceOccurrences']
    tables: DocumentDiagnosticsInput['tables']
    codes: DocumentDiagnosticsInput['codes']
    formulas: DocumentDiagnosticsInput['formulas']
    links: DocumentDiagnosticsInput['links']
    /**
     * Heading Auto-Number Conflict V1 §2/§4 — the numbering authority's global
     * effectiveness facts (the PER-HEADING verdict travels on each heading fact).
     */
    headingAutoNumbering?: DocumentDiagnosticsInput['headingAutoNumbering']
  },
): DocumentDiagnosticsInput {
  // Phase 7R.3.11.8B.9 — conditional strict-policy activation. When the
  // provider exists, its three-state policy decides strict-policy rule gating;
  // without it (pure/legacy consumers) strictMode keeps its old semantics.
  const policy = ctx.authority.getHeadingPolicyState?.()
  return {
    documentKey: ctx.authority.getDocumentKey(),
    markdown: ctx.authority.getMarkdown(),
    strictMode: ctx.authority.isStrictMode(),
    headingPolicyEnabled: policy?.enabled,
    headingPolicyConfigured: policy?.configured,
    strictPolicyActive: policy?.strictPolicyActive,
    vaultRoot: ctx.authority.vaultRoot,
    headings: structural.headings,
    h1Facts: structural.h1Facts,
    headingAuthority: structural.headingAuthority,
    latentAtxMarkers: structural.latentAtxMarkers,
    figures: structural.figures,
    figureSourceOccurrences: structural.figureSourceOccurrences,
    tables: structural.tables,
    codes: structural.codes,
    formulas: structural.formulas,
    links: structural.links,
    canonicalDuplicateIdentities: ctx.authority.getCanonicalDuplicateIdentities(),
    captionDuplicateNames: ctx.authority.getCaptionDuplicateNames(),
    // VNext §24 — manual-number rules run ONLY while the matching automatic
    // numbering is ON (heading policy + object numbering service).
    numberingEnabled: {
      heading: policy?.enabled === true,
      ...(ctx.authority.getObjectNumberingEnabled?.() ?? {}),
    },
    headingAutoNumbering: structural.headingAutoNumbering,
  }
}
