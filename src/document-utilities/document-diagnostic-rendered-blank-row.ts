/**
 * Document Diagnostics — RENDERED BLANK ROW AUTHORITY (TRAE rendered-blank-row
 * closure).
 *
 * THE PRODUCT CONTRACT (single fact, two axes):
 *
 *   DISPLAY + RULE fact → the number of raw empty MARKDOWN SOURCE lines between the
 *   two sibling content blocks (`actualBlankLines`). This is the ONE number the
 *   rule decision, the Drawer copy and the Active count label all state.
 *
 *   GEOMETRY fact → the number of blank editable rows Typora RENDERS between the
 *   two PHYSICALLY VERIFIED boundaries. This drives region location, painting and
 *   geometric verification ONLY. It is NEVER shown to the user and is never forced
 *   to equal the source count (the core fixture has source=7 / rendered=3).
 *
 * Authority split (never merged, never a mathematical conversion):
 *
 *   Source scanner        → discovers the BlankGapCandidate (source range +
 *                           previous/next semantic boundary).
 *   Rendered DOM resolver → this module: counts the blank rows the user really
 *                           sees BETWEEN the two PHYSICALLY VERIFIED boundaries,
 *                           and returns their rects.
 *
 * This module is DOM-FACING but deliberately small: it owns ONLY DOM blank-row
 * resolution + the boundary/physical decision algebra + the gate families. It
 * is NEVER a Drawer / Active-State / Carrier-lifecycle / Lease / Scroll
 * authority.
 */

// ── §35 — the runtime audit events ─────────────────────────────────────────
import { stripInvisiblePlaceholderChars } from './document-diagnostic-whitespace-semantics-v1'

/** §35 — the ONE rendered-blank-row runtime audit. */
export const RENDERED_BLANK_ROW_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-RENDERED-BLANK-ROW-AUDIT'

/** §6 — the DOM probe event emitted BEFORE the final logic depends on it. */
export const RENDERED_BLANK_ROW_DOM_PROBE_EVENT = 'DOCUMENT-DIAGNOSTIC-RENDERED-BLANK-ROW-DOM-PROBE'

/** §19/§20/§42 — the scroll target kind for an internal blank gap. */
export const RENDERED_BLANK_GAP_SCROLL_TARGET = 'rendered-blank-gap' as const

/** §8 — the authority token carried on every rendered-blank-row result. */
export const RENDERED_BLANK_ROW_AUTHORITY = 'RENDERED_DOM_BLANK_ROWS_V1'

/**
 * §29 — the marker used while the runtime DOM has not yet confirmed a rendered
 * count. The Drawer NEVER falls back to the SOURCE count.
 */
export const RENDERED_BLANK_ROW_PENDING_DETAIL =
  '当前两个内容块之间存在过多连续空行，待运行时确认可见空行数，建议压缩为 1 个空行。'

// ── §4/§12 — the boundary decision algebra ─────────────────────────────────

export type BoundaryIdentityDecision = 'RESOLVED' | 'MISSING' | 'AMBIGUOUS'

export type BoundaryPhysicalDecision =
  | 'VERIFIED'
  | 'MISSING'
  | 'DISCONNECTED'
  | 'WRONG_KIND'
  | 'ZERO_RECT'
  | 'STALE_LAYOUT'

export type BoundaryDecision = 'BOUND' | 'UNVERIFIED' | 'MISSING' | 'AMBIGUOUS'

export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * §12 — one gap boundary, split into the LOGICAL identity decision and the
 * PHYSICAL DOM decision. `decision=BOUND` is allowed ONLY when both are proven
 * (§13): a logical identity is never silently reported as a physical binding.
 */
export interface BoundaryResolution {
  identityDecision: BoundaryIdentityDecision
  physicalDecision: BoundaryPhysicalDecision
  decision: BoundaryDecision
  canonicalIdentity: string | null
  element: HTMLElement | null
  connected: boolean
  insideBusinessRoot: boolean
  kindVerified: boolean
  rect: RectLike | null
  layoutEpoch: number
  strategy: string
}

/**
 * §13 — the ONE place that folds the identity + physical facts into the final
 * decision. HARD CONTRACT: `BOUND` REQUIRES identity RESOLVED, a connected
 * element inside the business root, a matching kind, a measurable rect with a
 * positive width AND height, and a measurement taken at the CURRENT layout
 * epoch. Any missing precondition degrades the decision — never `BOUND`.
 */
export function evaluateBoundaryResolution(input: {
  identityDecision: BoundaryIdentityDecision
  element: HTMLElement | null
  connected: boolean
  insideBusinessRoot: boolean
  kindVerified: boolean
  rect: RectLike | null
  layoutEpoch: number
  expectedLayoutEpoch?: number | null
  canonicalIdentity: string | null
  strategy: string
}): BoundaryResolution {
  let physicalDecision: BoundaryPhysicalDecision
  if (input.element == null) physicalDecision = 'MISSING'
  else if (!input.connected) physicalDecision = 'DISCONNECTED'
  else if (!input.insideBusinessRoot) physicalDecision = 'MISSING'
  else if (!input.kindVerified) physicalDecision = 'WRONG_KIND'
  else if (input.expectedLayoutEpoch != null && input.layoutEpoch !== input.expectedLayoutEpoch) physicalDecision = 'STALE_LAYOUT'
  else if (input.rect == null || !(input.rect.width > 0) || !(input.rect.height > 0)) physicalDecision = 'ZERO_RECT'
  else physicalDecision = 'VERIFIED'

  let decision: BoundaryDecision
  if (input.identityDecision === 'AMBIGUOUS') decision = 'AMBIGUOUS'
  else if (input.identityDecision === 'MISSING') decision = 'MISSING'
  else if (input.identityDecision === 'RESOLVED' && physicalDecision === 'VERIFIED') decision = 'BOUND'
  else decision = 'UNVERIFIED'

  return {
    identityDecision: input.identityDecision,
    physicalDecision,
    decision,
    canonicalIdentity: input.canonicalIdentity,
    element: input.element,
    connected: input.connected,
    insideBusinessRoot: input.insideBusinessRoot,
    kindVerified: input.kindVerified,
    rect: input.rect,
    layoutEpoch: input.layoutEpoch,
    strategy: input.strategy,
  }
}

// ── §4 — the rendered blank row model ──────────────────────────────────────

export type RenderedBlankRowDecision =
  | 'VERIFIED'
  | 'NO_RENDERED_ROWS'
  | 'RUNTIME_UNAVAILABLE'
  | 'STALE_LAYOUT'
  | 'AMBIGUOUS'

export interface RenderedBlankRow {
  index: number
  element: HTMLElement | null
  rect: RectLike | null
  physicalVerified: boolean
  editableVerified: boolean
  pluginOwned: boolean
  layoutEpoch: number
}

export interface RenderedBlankRowResult {
  sourceBlankLineCount: number
  renderedBlankRowCount: number
  /**
   * §3 — the VISIBLE blank line BAND count: the number of DISTINCT vertical bands
   * the physically verified blank rows occupy. Typora collapses several SOURCE
   * blank lines into FEWER visible bands (and may stack coincident rows), so this
   * is neither the source count nor the raw DOM node count — it is the count the
   * Active label states (`visibleBlankLineCount`).
   */
  visibleBlankLineCount: number
  rows: RenderedBlankRow[]
  decision: RenderedBlankRowDecision
  authority: string
  /** TRAE §6 — the DOM probe facts (forensic; never a decision authority). */
  probe: RenderedBlankRowProbe | null
}

/** §6 — one DOM sibling between the two verified boundaries. */
export interface RenderedBlankRowProbeSibling {
  tag: string
  className: string
  dataLine: string | null
  textLength: number
  normalizedText: string
  contentEditable: string | null
  rect: RectLike | null
  pluginOwned: boolean
  codeMirrorInternal: boolean
  candidateBlankRow: boolean
}

export interface RenderedBlankRowProbe {
  previousElementTag: string | null
  previousElementClass: string | null
  previousElementDataLine: string | null
  previousConnected: boolean
  previousInBusinessRoot: boolean
  nextElementTag: string | null
  nextElementClass: string | null
  nextElementDataLine: string | null
  nextConnected: boolean
  nextInBusinessRoot: boolean
  businessRootTag: string | null
  businessRootClass: string | null
  betweenSiblingCount: number
  betweenSiblings: RenderedBlankRowProbeSibling[]
}

// ── DOM predicates (pure / jsdom-testable) ─────────────────────────────────

/** §9 — the user-visible text projection of a candidate row. */
export function normalizeRenderedRowText(text: string | null | undefined): string {
  // R9 — the SAME whitespace contract as the source scanner: a paragraph that
  // only holds invisible placeholders (Typora writes U+200B for a spaces-only
  // block) IS a blank row. `\s` does not match U+200B, so without this strip the
  // DOM side counted one row less than the source side and the visible count
  // was silently short.
  return stripInvisiblePlaceholderChars(text).replace(/\s+/g, ' ').trim()
}

/**
 * Plugin-OWNED presentation classes — written ONLY on nodes the plugin itself
 * injects (caption carriers, gap / EOF visuals, markers, locate layers, overlay
 * chrome). A row carrying one of these is never a document business row.
 *
 * R7 — this list is deliberately EXACT. It must not contain the projection
 * classes the plugin writes onto REAL user blocks:
 *   `inkchapter-paragraph-effective-flush`
 *   `inkchapter-paragraph-effective-indent-2`
 *   `inkchapter-empty-block`
 * Those blocks are the document's own paragraphs (including the empty paragraph
 * Enter just created), i.e. real visible blank lines. Matching them made the
 * candidate set one row short (truth 3 → reported 2, highlight one row less).
 */
const PLUGIN_OWNED_ROW_CLASS_TOKENS = [
  'inkchapter-caption',
  'inkchapter-block-gap-',
  'inkchapter-blank-',
  'inkchapter-eof-',
  'inkchapter-locate-',
  'inkchapter-diagnostic-',
  'inkchapter-heading-',
  'inkchapter-doc-',
  'inkchapter-ui-',
]

/**
 * §9/§10 — the plugin-owned / auxiliary exclusion.
 *
 * R7 — NEVER match a bare `inkchapter` substring: the paragraph-indent module
 * stamps `inkchapter-paragraph-effective-*` on real `#write > p` blocks, so the
 * old substring test silently deleted one really visible blank line from every
 * affected gap. Overlay nodes are excluded by the exact token list above, by the
 * explicit `data-*` carriers below, and — structurally — by
 * `isEditableBusinessRowElement`, which only admits a `<p>` / `<li>` or a
 * `data-line` leaf.
 */
export function isPluginOwnedBlankRowCandidate(el: HTMLElement): boolean {
  if (el.getAttribute('data-inkchapter-locate-layer') === 'true') return true
  if (el.hasAttribute('data-inkchapter-caption')) return true
  if (el.hasAttribute('data-ink-ui-root')) return true
  if (el.hasAttribute('data-inkchapter-diagnostic-marker')) return true
  if (el.closest('[data-inkchapter-locate-layer], [data-ink-ui-root]') != null) return true
  const cls = String(el.className ?? '')
  return PLUGIN_OWNED_ROW_CLASS_TOKENS.some(token => cls.includes(token))
}

/** §10 — CodeMirror internal rows are never business rows. */
export function isCodeMirrorInternalRow(el: HTMLElement): boolean {
  if (el.closest('.CodeMirror, .cm-editor, .cm-content, .cm-scroller') != null) return true
  const cls = String(el.className ?? '')
  return cls.includes('CodeMirror') || cls.includes('cm-line') || cls.includes('cm-')
}

/** §9 — formula / table internals are not blank rows. */
export function isProtectedBlockInternalRow(el: HTMLElement): boolean {
  if (el.closest('.md-math-block') != null) return true
  if (el.closest('table') != null && el.tagName !== 'TABLE') return true
  return false
}

/** §9 — a hidden node is never a blank row. */
export function isHiddenRenderedRow(el: HTMLElement): boolean {
  try {
    const cs = window.getComputedStyle(el)
    if (cs == null) return false
    if (cs.display === 'none' || cs.visibility === 'hidden') return true
    if (cs.opacity !== '' && Number.parseFloat(cs.opacity) === 0) return true
  } catch { /* treat an unmeasurable style as visible */ }
  return false
}

/**
 * §9 — blank-row BUSINESS semantics: an editable paragraph / list-item business
 * row. A bare `textContent.trim() === ''` NEVER admits an arbitrary empty DIV.
 */
export function isEditableBusinessRowElement(el: HTMLElement): boolean {
  if (el.getAttribute('contenteditable') === 'false') return false
  const tag = el.tagName
  if (tag === 'P' || tag === 'LI') return true
  // an empty block that Typora stamped with a source line and that owns no child
  // block is still a business row (never an overlay / helper).
  return el.hasAttribute('data-line') && el.children.length === 0
}

export interface RenderedRowClassification {
  pluginOwned: boolean
  codeMirrorInternal: boolean
  formulaOrTableInternal: boolean
  hidden: boolean
  /** Any degenerate area (zero width OR zero height) — forensic only. */
  zeroSize: boolean
  /** Zero content WIDTH only — legitimate for an EMPTY editable business row. */
  zeroWidth: boolean
  /** Zero / unmeasurable HEIGHT — an unpaintable row (the ONLY disqualifier). */
  zeroHeight: boolean
  blankText: boolean
  editableVerified: boolean
  candidateBlankRow: boolean
}

/** §9 — classify ONE between-boundary sibling into the blank-row candidate facts. */
export function classifyRenderedRowCandidate(
  el: HTMLElement,
  measureRect: (el: HTMLElement) => RectLike | null,
): RenderedRowClassification {
  const pluginOwned = isPluginOwnedBlankRowCandidate(el)
  const codeMirrorInternal = isCodeMirrorInternalRow(el)
  const formulaOrTableInternal = isProtectedBlockInternalRow(el)
  const hidden = isHiddenRenderedRow(el)
  const rect = measureRect(el)
  // §9 — an EMPTY editable business row (a `<p>` / `<li>` with no text) really has
  // `getBoundingClientRect().width === 0` in Typora's WYSIWYG. That is NOT a
  // degenerate node: the horizontal paint extent comes from the DOCUMENT text
  // column (`computeRenderedBlankRowFragments.contentColumns`), never from the
  // row's own width. Only a zero / unmeasurable HEIGHT makes a row unpaintable.
  const zeroWidth = rect == null || !(rect.width > 0)
  const zeroHeight = rect == null || !(rect.height > 0)
  const zeroSize = zeroWidth || zeroHeight
  const blankText = normalizeRenderedRowText(el.textContent) === ''
  const editableVerified = isEditableBusinessRowElement(el)
  const candidateBlankRow = blankText && editableVerified
    && !pluginOwned && !codeMirrorInternal && !formulaOrTableInternal && !hidden && !zeroHeight
  return {
    pluginOwned,
    codeMirrorInternal,
    formulaOrTableInternal,
    hidden,
    zeroSize,
    zeroWidth,
    zeroHeight,
    blankText,
    editableVerified,
    candidateBlankRow,
  }
}

function defaultMeasureRect(el: HTMLElement): RectLike | null {
  try {
    const r = el.getBoundingClientRect()
    if (!Number.isFinite(r.left) || !Number.isFinite(r.top)) return null
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.right - r.left, height: r.bottom - r.top }
  } catch {
    return null
  }
}

function toRectLike(r: RectLike | null): RectLike | null {
  if (r == null) return null
  const width = Number.isFinite(r.width) ? r.width : r.right - r.left
  const height = Number.isFinite(r.height) ? r.height : r.bottom - r.top
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width, height }
}

/**
 * §6/§9 — normalize two boundary elements to the SAME sibling level.
 *
 * Typora mixes direct block children with wrapper elements (`div.md-end-block`
 * around a newly typed / differently-rendered block). When the two boundaries
 * live at different nesting levels, `collectBetweenBoundarySiblings` refuses the
 * traversal (different parents) and the whole gap becomes unmeasurable — which
 * used to DROP the diagnostic after a blank run was split by typed text.
 *
 * This helper lifts BOTH elements to the children of their deepest common
 * ancestor (still inside the business root), so the blank rows are counted
 * between the real block-level siblings. It never merges an ancestor/descendant
 * pair (that cannot describe a gap) and never leaves the business root.
 */
export function normalizeSiblingBoundaryPair(
  root: HTMLElement,
  previous: HTMLElement,
  next: HTMLElement,
): { previous: HTMLElement; next: HTMLElement } | null {
  if (previous === next) return null
  if (!root.contains(previous) || !root.contains(next)) return null
  if (previous.parentElement != null && previous.parentElement === next.parentElement) {
    return { previous, next }
  }
  const chain = (el: HTMLElement): HTMLElement[] => {
    const out: HTMLElement[] = []
    let cursor: HTMLElement | null = el
    while (cursor != null && cursor !== root) {
      out.push(cursor)
      cursor = cursor.parentElement
    }
    if (cursor !== root) return []
    return out.reverse() // [root child, …, element]
  }
  const a = chain(previous)
  const b = chain(next)
  if (a.length === 0 || b.length === 0) return null
  const shared = Math.min(a.length, b.length)
  let diverge = -1
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) { diverge = i; break }
  }
  // One boundary CONTAINS the other (prefix chain) → not a sibling gap.
  if (diverge < 0) return null
  const liftedPrevious = a[diverge]
  const liftedNext = b[diverge]
  if (liftedPrevious === liftedNext) return null
  if (liftedPrevious.parentElement == null || liftedPrevious.parentElement !== liftedNext.parentElement) return null
  try {
    const order = liftedPrevious.compareDocumentPosition(liftedNext)
    if ((order & Node.DOCUMENT_POSITION_FOLLOWING) === 0) return null
  } catch {
    return null
  }
  return { previous: liftedPrevious, next: liftedNext }
}

/**
 * §6/§9 — collect the DOM siblings STRICTLY between `previous` and `next`.
 * Both must share a parent; otherwise the traversal is refused (AMBIGUOUS).
 */
export function collectBetweenBoundarySiblings(
  root: HTMLElement,
  previous: HTMLElement,
  next: HTMLElement,
): HTMLElement[] | null {
  if (previous.parentElement == null || previous.parentElement !== next.parentElement) return null
  const out: HTMLElement[] = []
  let cursor: Element | null = previous.nextElementSibling
  let guard = 0
  while (cursor != null && cursor !== next && guard++ < 10_000) {
    if (cursor instanceof HTMLElement && root.contains(cursor)) out.push(cursor)
    cursor = cursor.nextElementSibling
  }
  // `next` was never reached → the two elements are not ordered siblings.
  if (cursor !== next) return null
  return out
}

/**
 * §3 — the VISIBLE blank line BAND count.
 *
 * Counts the DISTINCT vertical bands the physically verified blank rows occupy:
 * rows whose vertical extents OVERLAP (or coincide) belong to ONE band. This is the
 * number the user actually sees in the WYSIWYG editor, so it is:
 *   - NEVER the raw DOM node count (coincident rows collapse into one band),
 *   - NEVER the SOURCE blank line count (N source blanks may paint as one band).
 */
export function countVisibleBlankLineBands(
  rows: ReadonlyArray<{ rect: RectLike | null }>,
): number {
  const withRect: RectLike[] = []
  let withoutRect = 0
  for (const row of rows) {
    if (row.rect == null) withoutRect++
    else withRect.push(row.rect)
  }
  const sorted = withRect.slice().sort((a, b) => a.top - b.top)
  let bands = 0
  let bandBottom = Number.NEGATIVE_INFINITY
  for (const rect of sorted) {
    const top = Number.isFinite(rect.top) ? rect.top : bandBottom + 1
    const bottom = Number.isFinite(rect.bottom) ? rect.bottom : top
    // §3 — 1px tolerance: a row starting BELOW the current band's bottom starts a new band.
    if (top >= bandBottom - 1) {
      bands++
      bandBottom = bottom
    } else {
      bandBottom = Math.max(bandBottom, bottom)
    }
  }
  return bands + withoutRect
}

export interface RenderedBlankRowInput {
  businessRoot: HTMLElement | null
  previousElement: HTMLElement | null
  nextElement: HTMLElement | null
  sourceBlankLineCount: number
  layoutEpoch: number
  expectedLayoutEpoch?: number | null
  /** Optional override hooks (host reuse); defaults are the pure predicates. */
  measureRect?: (el: HTMLElement) => RectLike | null
}

/**
 * §8 — the ONE pure rendered-blank-row resolver. It NEVER converts the source
 * count mathematically: it counts the REAL blank DOM rows between the two
 * physically verified boundaries. When the runtime cannot prove them it returns
 * a non-VERIFIED decision with `renderedBlankRowCount = 0` — the caller must
 * then treat the candidate as PENDING, never fall back to the source count.
 */
export function resolveRenderedBlankRows(input: RenderedBlankRowInput): RenderedBlankRowResult {
  const sourceBlankLineCount = Math.max(0, Math.floor(input.sourceBlankLineCount))
  const base = (decision: RenderedBlankRowDecision, rows: RenderedBlankRow[], probe: RenderedBlankRowProbe | null): RenderedBlankRowResult => ({
    sourceBlankLineCount,
    renderedBlankRowCount: decision === 'VERIFIED' ? rows.length : 0,
    visibleBlankLineCount: decision === 'VERIFIED' ? countVisibleBlankLineBands(rows) : 0,
    rows,
    decision,
    authority: RENDERED_BLANK_ROW_AUTHORITY,
    probe,
  })

  if (input.businessRoot == null || !input.businessRoot.isConnected) {
    return base('RUNTIME_UNAVAILABLE', [], null)
  }
  if (input.expectedLayoutEpoch != null && input.layoutEpoch !== input.expectedLayoutEpoch) {
    return base('STALE_LAYOUT', [], null)
  }
  const measure = input.measureRect ?? defaultMeasureRect
  const { previousElement, nextElement, businessRoot } = input
  if (previousElement == null || nextElement == null
    || !previousElement.isConnected || !nextElement.isConnected
    || !businessRoot.contains(previousElement) || !businessRoot.contains(nextElement)) {
    return base('RUNTIME_UNAVAILABLE', [], null)
  }
  const between = collectBetweenBoundarySiblings(businessRoot, previousElement, nextElement)
  if (between == null) {
    return base('AMBIGUOUS', [], {
      previousElementTag: previousElement.tagName.toLowerCase(),
      previousElementClass: String(previousElement.className).slice(0, 64),
      previousElementDataLine: previousElement.getAttribute('data-line'),
      previousConnected: previousElement.isConnected,
      previousInBusinessRoot: businessRoot.contains(previousElement),
      nextElementTag: nextElement.tagName.toLowerCase(),
      nextElementClass: String(nextElement.className).slice(0, 64),
      nextElementDataLine: nextElement.getAttribute('data-line'),
      nextConnected: nextElement.isConnected,
      nextInBusinessRoot: businessRoot.contains(nextElement),
      businessRootTag: businessRoot.tagName.toLowerCase(),
      businessRootClass: String(businessRoot.className).slice(0, 64),
      betweenSiblingCount: 0,
      betweenSiblings: [],
    })
  }

  const probeSiblings: RenderedBlankRowProbeSibling[] = []
  const rows: RenderedBlankRow[] = []
  for (const el of between) {
    const cls = classifyRenderedRowCandidate(el, measure)
    const rect = measure(el)
    probeSiblings.push({
      tag: el.tagName.toLowerCase(),
      className: String(el.className).slice(0, 64),
      dataLine: el.getAttribute('data-line'),
      textLength: (el.textContent ?? '').length,
      normalizedText: normalizeRenderedRowText(el.textContent).slice(0, 48),
      contentEditable: el.getAttribute('contenteditable'),
      rect: toRectLike(rect),
      pluginOwned: cls.pluginOwned,
      codeMirrorInternal: cls.codeMirrorInternal,
      candidateBlankRow: cls.candidateBlankRow,
    })
    if (!cls.candidateBlankRow) continue
    rows.push({
      index: rows.length,
      element: el,
      rect: toRectLike(rect),
      // §9 — an editable blank row may have width 0; only height + connectivity
      // are physically required (the horizontal extent is the text column).
      physicalVerified: rect != null && rect.height > 0 && el.isConnected,
      editableVerified: cls.editableVerified,
      pluginOwned: cls.pluginOwned,
      layoutEpoch: input.layoutEpoch,
    })
  }

  const probe: RenderedBlankRowProbe = {
    previousElementTag: previousElement.tagName.toLowerCase(),
    previousElementClass: String(previousElement.className).slice(0, 64),
    previousElementDataLine: previousElement.getAttribute('data-line'),
    previousConnected: previousElement.isConnected,
    previousInBusinessRoot: businessRoot.contains(previousElement),
    nextElementTag: nextElement.tagName.toLowerCase(),
    nextElementClass: String(nextElement.className).slice(0, 64),
    nextElementDataLine: nextElement.getAttribute('data-line'),
    nextConnected: nextElement.isConnected,
    nextInBusinessRoot: businessRoot.contains(nextElement),
    businessRootTag: businessRoot.tagName.toLowerCase(),
    businessRootClass: String(businessRoot.className).slice(0, 64),
    betweenSiblingCount: between.length,
    betweenSiblings: probeSiblings,
  }
  return base(rows.length > 0 ? 'VERIFIED' : 'NO_RENDERED_ROWS', rows, probe)
}

// ── §39–§44 — the hard gates + positive coverage ───────────────────────────

/**
 * Every one of these MUST stay 0 for the rendered-blank-row closure to pass.
 */
export const RENDERED_BLANK_ROW_GATE_KEYS = [
  'sourceCountUsedAsDisplayCount',
  'sourceRenderedCountConflation',
  'boundWithNullElement',
  'boundWithoutPhysicalVerification',
  'boundWithDisconnectedElement',
  'boundWithStaleLayout',
  'boundWithZeroRect',
  'renderedRowRectMissing',
  'renderedRowZeroHeight',
  'renderedRowOutsideBoundaries',
  'renderedRowPluginOwned',
  'renderedRowCodeMirrorInternal',
  'eofAuthorityUsed',
  'goBottomActionUsed',
  'zeroPaintedRect',
  'secondClickRequired',
  'wrongPreviousBlockHighlight',
  'wrongNextBlockHighlight',
  'presentationBuiltWithNullBoundary',
  'presentationBuiltWithoutRowRect',
  'presentationBuiltOnStaleLayout',
  'staleVisual',
  'doubleCoordinateConversion',
  'unknownCoordinateSpace',
  'mixedCoordinateSpaceCompare',
  'negativeRenderedGapCenter',
  'syntheticGapUsedWhileRenderedRowsVerified',
] as const

export type RenderedBlankRowGateKey = typeof RENDERED_BLANK_ROW_GATE_KEYS[number]

export const RENDERED_BLANK_ROW_GATE_LABELS: Record<RenderedBlankRowGateKey, string> = {
  sourceCountUsedAsDisplayCount: 'INTERNAL_BLANK_LINE_SOURCE_COUNT_USED_AS_DISPLAY_COUNT_COUNT',
  sourceRenderedCountConflation: 'INTERNAL_BLANK_LINE_SOURCE_RENDERED_COUNT_CONFLATION_COUNT',
  boundWithNullElement: 'INTERNAL_BLANK_LINE_BOUND_WITH_NULL_ELEMENT_COUNT',
  boundWithoutPhysicalVerification: 'INTERNAL_BLANK_LINE_BOUND_WITHOUT_PHYSICAL_VERIFICATION_COUNT',
  boundWithDisconnectedElement: 'INTERNAL_BLANK_LINE_BOUND_WITH_DISCONNECTED_ELEMENT_COUNT',
  boundWithStaleLayout: 'INTERNAL_BLANK_LINE_BOUND_WITH_STALE_LAYOUT_COUNT',
  boundWithZeroRect: 'INTERNAL_BLANK_LINE_BOUND_WITH_ZERO_RECT_COUNT',
  renderedRowRectMissing: 'INTERNAL_BLANK_LINE_RENDERED_ROW_RECT_MISSING_COUNT',
  renderedRowZeroHeight: 'INTERNAL_BLANK_LINE_RENDERED_ROW_ZERO_HEIGHT_COUNT',
  renderedRowOutsideBoundaries: 'INTERNAL_BLANK_LINE_RENDERED_ROW_OUTSIDE_BOUNDARIES_COUNT',
  renderedRowPluginOwned: 'INTERNAL_BLANK_LINE_RENDERED_ROW_PLUGIN_OWNED_COUNT',
  renderedRowCodeMirrorInternal: 'INTERNAL_BLANK_LINE_RENDERED_ROW_CODEMIRROR_INTERNAL_COUNT',
  eofAuthorityUsed: 'INTERNAL_BLANK_LINE_EOF_AUTHORITY_USED_COUNT',
  goBottomActionUsed: 'INTERNAL_BLANK_LINE_GO_BOTTOM_ACTION_USED_COUNT',
  zeroPaintedRect: 'INTERNAL_BLANK_LINE_ZERO_PAINTED_RECT_COUNT',
  secondClickRequired: 'INTERNAL_BLANK_LINE_SECOND_CLICK_REQUIRED_COUNT',
  wrongPreviousBlockHighlight: 'INTERNAL_BLANK_LINE_WRONG_PREVIOUS_BLOCK_HIGHLIGHT_COUNT',
  wrongNextBlockHighlight: 'INTERNAL_BLANK_LINE_WRONG_NEXT_BLOCK_HIGHLIGHT_COUNT',
  presentationBuiltWithNullBoundary: 'INTERNAL_BLANK_LINE_PRESENTATION_BUILT_WITH_NULL_BOUNDARY_COUNT',
  presentationBuiltWithoutRowRect: 'INTERNAL_BLANK_LINE_PRESENTATION_BUILT_WITHOUT_ROW_RECT_COUNT',
  presentationBuiltOnStaleLayout: 'INTERNAL_BLANK_LINE_PRESENTATION_BUILT_ON_STALE_LAYOUT_COUNT',
  staleVisual: 'INTERNAL_BLANK_LINE_STALE_VISUAL_COUNT',
  doubleCoordinateConversion: 'INTERNAL_BLANK_LINE_DOUBLE_COORDINATE_CONVERSION_COUNT',
  unknownCoordinateSpace: 'INTERNAL_BLANK_LINE_UNKNOWN_COORDINATE_SPACE_COUNT',
  mixedCoordinateSpaceCompare: 'INTERNAL_BLANK_LINE_MIXED_COORDINATE_SPACE_COMPARE_COUNT',
  negativeRenderedGapCenter: 'INTERNAL_BLANK_LINE_NEGATIVE_RENDERED_GAP_CENTER_COUNT',
  syntheticGapUsedWhileRenderedRowsVerified: 'INTERNAL_BLANK_LINE_SYNTHETIC_GAP_USED_WHILE_RENDERED_ROWS_VERIFIED_COUNT',
}

export function createRenderedBlankRowGates(): Record<RenderedBlankRowGateKey, number> {
  const out = {} as Record<RenderedBlankRowGateKey, number>
  for (const k of RENDERED_BLANK_ROW_GATE_KEYS) out[k] = 0
  return out
}

export function formatRenderedBlankRowGateReport(counters: Readonly<Record<string, number>>): string[] {
  return RENDERED_BLANK_ROW_GATE_KEYS.map(k => `${RENDERED_BLANK_ROW_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateRenderedBlankRowGates(
  counters: Readonly<Record<string, number>>,
): { decision: 'PASS' | 'FAIL'; failCount: number; failing: string[] } {
  const failing = RENDERED_BLANK_ROW_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return {
    decision: failing.length === 0 ? 'PASS' : 'FAIL',
    failCount: failing.length,
    failing: failing.map(k => RENDERED_BLANK_ROW_GATE_LABELS[k]),
  }
}

/** §39–§44 — the positive runtime coverage the closure needs (min values). */
export const RENDERED_BLANK_ROW_COVERAGE_REQUIREMENTS: Readonly<Record<string, number>> = {
  INTERNAL_BLANK_LINE_SOURCE_CANDIDATE_RUNTIME_COUNT: 1,
  INTERNAL_BLANK_LINE_RENDERED_COUNT_VERIFIED_COUNT: 1,
  INTERNAL_BLANK_LINE_DISPLAYED_COUNT_MATCH_SOURCE_COUNT_COUNT: 1,
  INTERNAL_BLANK_LINE_PREVIOUS_PHYSICAL_VERIFIED_COUNT: 1,
  INTERNAL_BLANK_LINE_NEXT_PHYSICAL_VERIFIED_COUNT: 1,
  INTERNAL_BLANK_LINE_RENDERED_ROW_RECT_COUNT: 1,
  INTERNAL_BLANK_LINE_SCROLL_TARGET_RENDERED_GAP_COUNT: 1,
  INTERNAL_BLANK_LINE_FIRST_CLICK_ACTIVE_COUNT: 1,
  INTERNAL_BLANK_LINE_CURRENT_DIAGNOSTIC_ACTIVE_VISUAL_COUNT: 1,
  INTERNAL_BLANK_LINE_MARKER_FRAGMENT_COUNT_MATCH_RENDERED_ROWS_COUNT: 1,
  INTERNAL_BLANK_LINE_3_TO_2_DIAGNOSTIC_REMOVED_COUNT: 1,
  INTERNAL_BLANK_LINE_3_TO_2_VISUAL_REMOVED_COUNT: 1,
  INTERNAL_BLANK_LINE_2_TO_3_DIAGNOSTIC_ADDED_COUNT: 1,
  INTERNAL_BLANK_LINE_2_TO_3_FIRST_CLICK_ACTIVE_COUNT: 1,
  INTERNAL_BLANK_LINE_RENDERED_BLANK_ROW_PRIMARY_GEOMETRY_USED_COUNT: 1,
  INTERNAL_BLANK_LINE_ROW_FRAGMENT_COORDINATE_CONVERSION_COUNT: 1,
}

export function emptyRenderedBlankRowCoverage(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of Object.keys(RENDERED_BLANK_ROW_COVERAGE_REQUIREMENTS)) out[k] = 0
  return out
}

export function evaluateRenderedBlankRowCoverage(
  counters: Readonly<Record<string, number>>,
): { satisfied: boolean; unmet: string[] } {
  const unmet = Object.entries(RENDERED_BLANK_ROW_COVERAGE_REQUIREMENTS)
    .filter(([k, min]) => (counters[k] ?? 0) < min)
    .map(([k]) => k)
  return { satisfied: unmet.length === 0, unmet }
}

// ── §20/§23 — the rendered blank-row union + fragment geometry ─────────────

/**
 * §20 — the union of the rendered blank-row rects. `unionCenterY` is the ONE
 * scroll target for an internal blank gap (never the next paragraph centre).
 */
export function renderedBlankRowUnion(
  rows: ReadonlyArray<{ rect: RectLike | null }>,
): { top: number; bottom: number; left: number; right: number; centerY: number } | null {
  const usable = rows.map(r => r.rect).filter((r): r is RectLike => r != null && Number.isFinite(r.top) && Number.isFinite(r.bottom))
  if (usable.length === 0) return null
  const top = Math.min(...usable.map(r => r.top))
  const bottom = Math.max(...usable.map(r => r.bottom))
  const left = Math.min(...usable.map(r => r.left))
  const right = Math.max(...usable.map(r => r.right))
  return { top, bottom, left, right, centerY: (top + bottom) / 2 }
}

// ── §4/§5/§9/§15 — explicit coordinate space + the ONE canonical conversion ──

/** §4 — every cross-module rect declares its space; never guess it by call site. */
export type CoordinateSpace = 'VIEWPORT' | 'DOCUMENT' | 'DOCUMENT_LOCAL'

export type SpatialRectSource =
  | 'DOM_CLIENT_RECT'
  | 'RENDERED_BLANK_ROW'
  | 'PRESENTATION_EXTENT'
  | 'DOCUMENT_SPACE_CARRIER'

export interface SpatialRect {
  rect: RectLike
  coordinateSpace: CoordinateSpace
  layoutEpoch: number
  source: SpatialRectSource
}

/** §15 — the coordinate audit for ONE rendered-blank-row geometry build. */
export const RENDERED_BLANK_ROW_GEOMETRY_AUDIT_EVENT =
  'DOCUMENT-DIAGNOSTIC-RENDERED-BLANK-ROW-GEOMETRY-AUDIT'

/** §9 — the space every rendered blank-gap FRAGMENT / SCROLL TARGET lives in. */
export const RENDERED_BLANK_GAP_LOCAL_SPACE: CoordinateSpace = 'DOCUMENT_LOCAL'

export interface RenderedRowConversionRecord {
  index: number
  inputRect: RectLike | null
  inputCoordinateSpace: CoordinateSpace
  outputRect: RectLike | null
  outputCoordinateSpace: CoordinateSpace
  conversionCount: number
}

export interface RenderedRowsConversionReport {
  rows: RenderedRowConversionRecord[]
  /** §5/§7 — the converted DOCUMENT_LOCAL row rects, one per converted row. */
  localRects: RectLike[]
  /** §5 — the number of conversions actually performed. Must equal localRects.length. */
  conversionCount: number
  /** §5 — the input was ALREADY local / document space: a double conversion. */
  doubleConversionDetected: boolean
  /** §14 — an unknown coordinate space entered the fragment path. */
  unknownCoordinateSpace: boolean
  /** §14 — a VIEWPORT rect met a DOCUMENT_LOCAL rect inside one comparison. */
  mixedCoordinateDetected: boolean
}

/** §5 — THE one VIEWPORT → DOCUMENT_LOCAL conversion (subtract the host top-left). */
export function viewportRectToDocumentLocalV1(rect: RectLike, host: RectLike): RectLike {
  const left = rect.left - host.left
  const top = rect.top - host.top
  const right = rect.right - host.left
  const bottom = rect.bottom - host.top
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/** §17 — the exact inverse, used ONCE when a local union must feed the viewport placement API. */
export function documentLocalRectToViewportV1(rect: RectLike, host: RectLike): RectLike {
  const left = rect.left + host.left
  const top = rect.top + host.top
  const right = rect.right + host.left
  const bottom = rect.bottom + host.top
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/**
 * §5/§7/§17 — convert every RenderedBlankRow DOMRect EXACTLY ONCE from VIEWPORT
 * into DOCUMENT_LOCAL. `conversionCount` is 1 per converted row and is REFUSED
 * for a rect that is already local/document space: a double conversion can be
 * neither performed nor silently hidden (§5/§14).
 */
export function convertRenderedRowsToLocal(input: {
  rows: ReadonlyArray<{ rect: RectLike | null }>
  inputCoordinateSpace: CoordinateSpace
  contentHostRect: RectLike | null
  layoutEpoch: number
}): RenderedRowsConversionReport {
  const alreadyLocal = input.inputCoordinateSpace !== 'VIEWPORT'
  const host = input.contentHostRect
  const canConvert = input.inputCoordinateSpace === 'VIEWPORT' && host != null
  const records: RenderedRowConversionRecord[] = []
  const localRects: RectLike[] = []
  input.rows.forEach((row, index) => {
    const inRect = row.rect
    if (inRect == null) {
      records.push({
        index,
        inputRect: null,
        inputCoordinateSpace: input.inputCoordinateSpace,
        outputRect: null,
        outputCoordinateSpace: RENDERED_BLANK_GAP_LOCAL_SPACE,
        conversionCount: 0,
      })
      return
    }
    const out = canConvert && host ? viewportRectToDocumentLocalV1(inRect, host) : null
    if (out) localRects.push(out)
    records.push({
      index,
      inputRect: inRect,
      inputCoordinateSpace: input.inputCoordinateSpace,
      outputRect: out,
      outputCoordinateSpace: RENDERED_BLANK_GAP_LOCAL_SPACE,
      conversionCount: out ? 1 : 0,
    })
  })
  return {
    rows: records,
    localRects,
    conversionCount: localRects.length,
    doubleConversionDetected: alreadyLocal,
    unknownCoordinateSpace: alreadyLocal,
    mixedCoordinateDetected: alreadyLocal || host == null,
  }
}

/** §17 — VIEWPORT → DOCUMENT_LOCAL → VIEWPORT round trip (drift must stay <= 1px). */
export function roundTripViewportRectV1(rect: RectLike, host: RectLike): {
  local: RectLike
  viewport: RectLike
  maxDriftPx: number
} {
  const local = viewportRectToDocumentLocalV1(rect, host)
  const viewport = documentLocalRectToViewportV1(local, host)
  const drift = Math.max(
    Math.abs(viewport.left - rect.left),
    Math.abs(viewport.top - rect.top),
    Math.abs(viewport.right - rect.right),
    Math.abs(viewport.bottom - rect.bottom),
  )
  return { local, viewport, maxDriftPx: drift }
}
