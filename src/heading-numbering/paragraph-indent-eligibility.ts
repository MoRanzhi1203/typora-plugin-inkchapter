/**
 * Paragraph Indent V2 — Paragraph-Only Eligibility Gate (single canonical resolver).
 *
 * ONE function decides whether a block may carry InkChapter first-line-indent
 * semantics (shortcut, manual command, CSS projection, visual marker, sidecar
 * override, rehydrate, copy/paste, undo/redo, post-merge binding).
 *
 * Design rules:
 *   - NEVER use `tagName === 'P'` as eligibility. Business identity comes from
 *     the canonical block classifier (`classifySemanticBlock`) + ancestry +
 *     content shape.
 *   - Fail CLOSED: an ambiguous target (image inside a textual paragraph, inline
 *     math, inline literal, plugin decoration) is NOT eligible, so the user's
 *     text and Typora's default behavior are preserved.
 *   - PURE: no DOM writes, no selection changes, no sidecar access, no timers.
 *
 * Explicitly ALLOWED: a standalone ordinary body-text paragraph, including an
 * editable blank ordinary paragraph (no children, or only `<br>` / zero-width
 * placeholders).
 *
 * Explicitly PROHIBITED: headings, tables and cells, images / figures /
 * captions / numbering controls, code fences and code captions, display and
 * inline math, lists, blockquotes, horizontal rules, raw HTML blocks,
 * plugin-owned UI/overlays/decorations, and any text nested inside them.
 */

import { classifySemanticBlock, type FirstSemanticBlockType } from './strict-document-validator'

export type ParagraphIndentIneligibleReason =
  | 'NOT_ELEMENT'
  | 'NOT_A_PARAGRAPH'
  | 'EXCLUDED_ANCESTOR'
  | 'PLUGIN_DECORATION'
  | 'NON_TEXT_BLOCK'
  | 'AMBIGUOUS_MIXED_CONTENT'
  | 'INLINE_LITERAL_CONTENT'
  | 'INLINE_MATH_CONTENT'

export interface ParagraphIndentEligibility {
  eligible: boolean
  /** `ELIGIBLE` when eligible; otherwise the first failing reason. */
  reason: ParagraphIndentIneligibleReason | 'ELIGIBLE'
  /** Canonical business block type of the candidate (diagnostic). */
  blockType: FirstSemanticBlockType | null
}

const ELIGIBLE: ParagraphIndentEligibility = { eligible: true, reason: 'ELIGIBLE', blockType: 'paragraph' }

/**
 * Ancestor containers that own a non-paragraph business identity. A `<p>`
 * nested in any of them is never an ordinary body paragraph.
 */
const EXCLUDED_ANCESTOR_SELECTOR = [
  'pre',
  'code',
  'li',
  'ul',
  'ol',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'figure',
  'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  '.md-fences',
  '.md-codeblock',
  '.md-math-block',
  '.md-htmlblock',
  '.md-meta-block',
  '.md-footnote',
  '.CodeMirror',
  '.mathjax-block',
  'mjx-container',
].join(',')

/**
 * Plugin-owned decoration / overlay hosts. Caption projections and diagnostic
 * overlays live outside the business text tree; text inside them is never an
 * ordinary paragraph.
 */
const PLUGIN_DECORATION_SELECTOR = [
  '[data-inkchapter-caption]',
  '.inkchapter-caption',
  '.inkchapter-heading-diagnostic-layer',
  '.inkchapter-heading-diagnostic-marker',
  '.inkchapter-heading-diagnostic-active',
  '.inkchapter-heading-diagnostic-passive',
  '.inkchapter-heading-number-measure',
  '.inkchapter-doc-drawer',
  '.inkchapter-doc-toolbar',
  '.inkchapter-doc-navigator',
  '.inkchapter-toast',
].join(',')

/** Media / structure children that make a paragraph non-textual (fail closed). */
const NON_TEXT_CONTENT_SELECTOR = [
  'img',
  'video',
  'audio',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'pre',
  'table',
  'hr',
  'figure',
  '[data-inkchapter-caption]',
  '.inkchapter-caption',
].join(',')

/** Inline literal containers: a token typed inside them is literal text. */
const INLINE_LITERAL_SELECTOR = 'code, kbd, samp, var, .md-html-inline, [md-inline="html"]'

function firstMatchingAncestor(el: Element, selector: string): Element | null {
  try {
    return el.closest(selector)
  } catch {
    return null
  }
}

/**
 * Resolve whether `paragraph` may own first-line-indent semantics / projection.
 *
 * PURE and idempotent. Callers must NOT write anything when `eligible === false`.
 */
export function resolveParagraphIndentEligibility(
  paragraph: Element | null | undefined,
): ParagraphIndentEligibility {
  if (!paragraph || !(paragraph instanceof Element)) {
    return { eligible: false, reason: 'NOT_ELEMENT', blockType: null }
  }
  if (paragraph.tagName !== 'P') {
    return { eligible: false, reason: 'NOT_A_PARAGRAPH', blockType: null }
  }
  if (firstMatchingAncestor(paragraph, PLUGIN_DECORATION_SELECTOR)) {
    return { eligible: false, reason: 'PLUGIN_DECORATION', blockType: null }
  }
  // `closest` includes the element itself, so a decorated `<p>` is caught too.
  if (firstMatchingAncestor(paragraph, EXCLUDED_ANCESTOR_SELECTOR)) {
    return { eligible: false, reason: 'EXCLUDED_ANCESTOR', blockType: null }
  }

  const block = classifySemanticBlock(paragraph as HTMLElement)
  if (block.type !== 'paragraph') {
    return { eligible: false, reason: 'NON_TEXT_BLOCK', blockType: block.type }
  }

  // A textual `<p>` that also hosts media / display math is ambiguous → reject.
  if (paragraph.querySelector(NON_TEXT_CONTENT_SELECTOR)) {
    return { eligible: false, reason: 'AMBIGUOUS_MIXED_CONTENT', blockType: block.type }
  }
  if (paragraph.querySelector('mjx-container, math')) {
    return { eligible: false, reason: 'INLINE_MATH_CONTENT', blockType: block.type }
  }
  if (paragraph.querySelector(INLINE_LITERAL_SELECTOR)) {
    return { eligible: false, reason: 'INLINE_LITERAL_CONTENT', blockType: block.type }
  }

  return ELIGIBLE
}

// ── Audit counters (must stay 0 for legitimate flows) ────────────────────

export interface ParagraphIndentIsolationCounters {
  /** Blocked attempts to apply indent intent to a non-paragraph business block. */
  nonParagraphIndentApplyCount: number
  /** Blocked attempts to project the two-box marker onto a non-paragraph block. */
  nonParagraphIndentMarkerCount: number
  /** Blocked attempts to persist a sidecar override for a non-paragraph block. */
  nonParagraphSidecarOverrideCount: number
}

export const paragraphIndentIsolationCounters: ParagraphIndentIsolationCounters = {
  nonParagraphIndentApplyCount: 0,
  nonParagraphIndentMarkerCount: 0,
  nonParagraphSidecarOverrideCount: 0,
}

export function recordIndentEligibilityBlock(
  kind: 'apply' | 'marker' | 'sidecar',
): void {
  if (kind === 'apply') paragraphIndentIsolationCounters.nonParagraphIndentApplyCount++
  else if (kind === 'marker') paragraphIndentIsolationCounters.nonParagraphIndentMarkerCount++
  else paragraphIndentIsolationCounters.nonParagraphSidecarOverrideCount++
}

export function resetParagraphIndentIsolationCounters(): void {
  paragraphIndentIsolationCounters.nonParagraphIndentApplyCount = 0
  paragraphIndentIsolationCounters.nonParagraphIndentMarkerCount = 0
  paragraphIndentIsolationCounters.nonParagraphSidecarOverrideCount = 0
}
