/**
 * Phase 7R.3.11 — Document Utilities: shared document context.
 *
 * ONE shared document context (documentKey / active editor root / active
 * scroll container / authority accessors) reused by every utility so they
 * never query DOM or resolve authority facts independently.
 */
import type { DocumentDiagnosticsInput } from './document-diagnostics'

export interface DocumentUtilitiesAuthorityContext {
  getActiveFilePath: () => string | null
  getDocumentKey: () => string | null
  getMarkdown: () => string | null
  /** Strict heading structure mode (numbering authority). */
  isStrictMode: () => boolean
  vaultRoot: string | null
  /** Optional canonical heading frame duplicate identities. */
  getCanonicalDuplicateIdentities: () => string[]
  /** Caption-service-provided duplicate names across figure/table/code. */
  getCaptionDuplicateNames: () => string[]
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
    figures: DocumentDiagnosticsInput['figures']
    tables: DocumentDiagnosticsInput['tables']
    codes: DocumentDiagnosticsInput['codes']
    formulas: DocumentDiagnosticsInput['formulas']
    links: DocumentDiagnosticsInput['links']
  },
): DocumentDiagnosticsInput {
  return {
    documentKey: ctx.authority.getDocumentKey(),
    markdown: ctx.authority.getMarkdown(),
    strictMode: ctx.authority.isStrictMode(),
    vaultRoot: ctx.authority.vaultRoot,
    headings: structural.headings,
    h1Facts: structural.h1Facts,
    figures: structural.figures,
    tables: structural.tables,
    codes: structural.codes,
    formulas: structural.formulas,
    links: structural.links,
    canonicalDuplicateIdentities: ctx.authority.getCanonicalDuplicateIdentities(),
    captionDuplicateNames: ctx.authority.getCaptionDuplicateNames(),
  }
}
