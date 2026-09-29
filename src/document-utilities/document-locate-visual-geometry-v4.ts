/**
 * Phase 7R.3.11.8B.13 — Diagnostic Locate Visual Geometry V4 (pure).
 *
 * Severity decides color; TARGET KIND decides geometry.
 *
 *   link / source-range image -> INLINE_MARK
 *   heading                    -> TEXT_TIGHT_MARKER
 *   table / code / figure / … -> FULL_OBJECT_FRAME or OCCLUDED (open-edge)
 *
 * semanticRect   = how large the problem object really is.
 * presentationRect = what the CURRENT screen should draw (never merged).
 *
 * Drawer occlusion is expressed as an OPEN-EDGE presentation — never a fake
 * closed rectangle clipped to the drawer edge. Every derived rect goes through
 * makeRectSnapshot, so RECT-INVARIANT-1..5 always hold.
 */
import {
  inflateRectBy,
  makeRectSnapshot,
  snapshotDomRect,
  validateRectInvariants,
  unionClientRects,
  type RectSnapshot,
} from './document-locate-rect-v4'
import { groupClientRectsToFragments, type ClosureRect } from './document-diagnostic-visual-closure-v512-r2'

export type LocateVisualTargetKind =
  | 'inline'
  | 'heading'
  | 'table'
  | 'code'
  | 'figure'
  | 'formula'
  | 'blockquote'
  | 'block'

export type LocatePresentation =
  | 'inline-mark'
  | 'text-tight-marker'
  | 'full-frame'
  | 'open-right-frame'
  | 'open-left-frame'

export type OcclusionSide = 'none' | 'left' | 'right' | 'top' | 'bottom'

export interface LocateVisualGeometryV4 {
  kind: LocateVisualTargetKind
  semanticRect: RectSnapshot
  /** Full semantic-based box (NEVER clamped to drawer/unobscured). */
  presentationRect: RectSnapshot | null
  /** V5.4 — visibility/occlusion only. Never a geometry authority. */
  visibilityClipRect: RectSnapshot | null
  /** Coverage of semanticRect by presentationRect (>=0.98 gate for blocks). */
  coverage: { horizontal: number; vertical: number }
  /** Right edge authority for the presentation geometry. */
  rightEdgeAuthority: 'SEMANTIC_TARGET' | 'DRAWER_LEFT' | 'UNOBSCURED_EDITOR_RIGHT'
  occlusion: OcclusionSide[]
  presentation: LocatePresentation
  openEdges: ('left' | 'right' | 'top' | 'bottom')[]
  /** Only for open-edge frames: whether the corresponding border paints. */
  borderRendered: { left: boolean; top: boolean; right: boolean; bottom: boolean }
  radius: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }
  /** RECT hard gate — every derived rect in this structure must pass. */
  rectInvariantPass: boolean
  /** semanticRect fully visible inside the unobscured editor. */
  fullyVisible: boolean
}

export interface BuildLocateVisualGeometryInput {
  kind: LocateVisualTargetKind
  /** Real object extent in viewport coords (anchor BCR). */
  semanticRect: { left: number; top: number; right: number; bottom: number } | null
  /** Drawer-unobscured editor region; null when unknown/headless. */
  unobscuredRect: { left: number; top: number; right: number; bottom: number } | null
  /** Optional drawer rect for explicit occlusion attribution. */
  drawerRect?: { left: number; top: number; right: number; bottom: number } | null
  headless: boolean
  /** Force inline-mark presentation (sourceRange-exact image geometry). */
  forceInlineMark?: boolean
}

/**
 * V4 decision authority. Presentation + open-edge + border/radius flags are
 * derived ONLY from target kind and rect relationships (semantic vs the
 * unobscured editor). Table/code/… never choose `inline-mark`, headings never
 * choose a closed frame, inline never chooses a full frame.
 */
export function buildLocateVisualGeometryV4(input: BuildLocateVisualGeometryInput): LocateVisualGeometryV4 {
  const semantic = semanticRectOf(input.semanticRect)
  const unobscured = snapshotDomRect(input.unobscuredRect ?? null)

  const inlineLike = input.kind === 'inline' || input.forceInlineMark === true
  const headingLike = input.kind === 'heading'

  // V5.4 — visibility clip is ONLY used for occlusion/visibility decisions and
  // NEVER rewrites presentation geometry. presentationRect always follows the
  // full semantic target (+ its outset already applied upstream).
  if (inlineLike) {
    return finish({
      kind: input.kind,
      semanticRect: semantic,
      presentationRect: semantic,
      occlusion: [],
      presentation: 'inline-mark',
      fullyVisible: unobscured ? isFullyVisible(semantic, unobscured) : true,
      headless: input.headless,
      visibilityClip: unobscured,
    })
  }

  if (headingLike) {
    // Text-tight marker — never a full-width fill/border frame.
    return finish({
      kind: input.kind,
      semanticRect: semantic,
      presentationRect: semantic,
      occlusion: [],
      presentation: 'text-tight-marker',
      fullyVisible: unobscured ? isFullyVisible(semantic, unobscured) : true,
      headless: input.headless,
      visibilityClip: unobscured,
    })
  }

  // Object kinds (table/code/figure/formula/blockquote/block).
  if (!unobscured || input.headless) {
    // Unknown geometry / headless: present the semantic box (never clipped to
    // a fake half), still gated by invariants.
    return finish({
      kind: input.kind,
      semanticRect: semantic,
      presentationRect: semantic,
      occlusion: [],
      presentation: 'full-frame',
      fullyVisible: true,
      headless: input.headless,
    })
  }

  const fully = isFullyVisible(semantic, unobscured)
  if (fully) {
    return finish({
      kind: input.kind,
      semanticRect: semantic,
      presentationRect: semantic,
      occlusion: [],
      presentation: 'full-frame',
      fullyVisible: true,
      headless: false,
      visibilityClip: unobscured,
    })
  }

  // Occluded: NEVER truncate the presentation box to the clip edge. The full
  // semantic box is the geometry authority; the DRAWER-side border is opened
  // (no fake closed edge) and layout recovery (V5.1) is expected upstream to
  // re-measure after collapse. Coverage therefore stays complete.
  const occlusion: OcclusionSide[] = []
  if (semantic.right > unobscured.right + 0.5 && semantic.left < unobscured.right) occlusion.push('right')
  if (semantic.left < unobscured.left - 0.5 && semantic.right > unobscured.left) occlusion.push('left')
  if (semantic.bottom > unobscured.bottom + 0.5 && semantic.top < unobscured.bottom) occlusion.push('bottom')
  if (semantic.top < unobscured.top - 0.5 && semantic.bottom > unobscured.top) occlusion.push('top')

  const rightOpen = occlusion.includes('right') && !occlusion.includes('left')
  const leftOpen = occlusion.includes('left') && !occlusion.includes('right')
  // When both sides are occluded the visible strip keeps an open presentation
  // on the wider side; choose the larger hidden region for the open edge.
  const opensRight = rightOpen || (occlusion.includes('right') && occlusion.includes('left') && (semantic.right - unobscured.right) >= (unobscured.left - semantic.left))
  const opensLeft = !opensRight && leftOpen
  const presentation: LocatePresentation = opensRight
    ? 'open-right-frame'
    : opensLeft
      ? 'open-left-frame'
      : 'open-right-frame'

  // V5.4 — presentation rect is the FULL semantic box (never clampRectToClip).
  const presentationRect = semantic
  const openEdges: ('left' | 'right')[] = opensRight ? ['right'] : opensLeft ? ['left'] : []
  const borderRendered = { left: !openEdges.includes('left'), top: true, right: !openEdges.includes('right'), bottom: true }
  const radiusBase = 4
  const radius = {
    topLeft: radiusBase,
    topRight: openEdges.includes('right') || openEdges.includes('left') ? 0 : radiusBase,
    bottomRight: openEdges.includes('right') || openEdges.includes('left') ? 0 : radiusBase,
    bottomLeft: radiusBase,
  }
  return {
    kind: input.kind,
    semanticRect: semantic,
    presentationRect,
    visibilityClipRect: unobscured,
    coverage: coverageOf(semantic, presentationRect),
    rightEdgeAuthority: 'SEMANTIC_TARGET',
    occlusion,
    presentation,
    openEdges,
    borderRendered,
    radius,
    rectInvariantPass: validateRectInvariants(semantic) && validateRectInvariants(presentationRect),
    fullyVisible: false,
  }
}

/** Presentation↔semantic coverage (1 when the full semantic box is kept). */
function coverageOf(semantic: RectSnapshot, present: RectSnapshot): { horizontal: number; vertical: number } {
  const ix = makeRectSnapshot({
    left: Math.max(semantic.left, present.left),
    top: Math.max(semantic.top, present.top),
    right: Math.min(semantic.right, present.right),
    bottom: Math.min(semantic.bottom, present.bottom),
  })
  const sw = semantic.width > 0 ? semantic.width : 1
  const sh = semantic.height > 0 ? semantic.height : 1
  return {
    horizontal: Math.min(1, Math.max(0, ix.width / sw)),
    vertical: Math.min(1, Math.max(0, ix.height / sh)),
  }
}

function semanticRectOf(r: { left: number; top: number; right: number; bottom: number } | null): RectSnapshot {
  return makeRectSnapshot(r ?? { left: 0, top: 0, right: 0, bottom: 0 })
}

function isFullyVisible(rect: RectSnapshot, clip: RectSnapshot): boolean {
  return rect.left >= clip.left - 0.5 && rect.right <= clip.right + 0.5 && rect.top >= clip.top - 0.5 && rect.bottom <= clip.bottom + 0.5
}

function finish(p: {
  kind: LocateVisualTargetKind
  semanticRect: RectSnapshot
  presentationRect: RectSnapshot | null
  occlusion: OcclusionSide[]
  presentation: LocatePresentation
  fullyVisible: boolean
  headless: boolean
  visibilityClip?: RectSnapshot | null
}): LocateVisualGeometryV4 {
  const openEdges: ('left' | 'right')[] =
    p.presentation === 'open-right-frame' ? ['right']
      : p.presentation === 'open-left-frame' ? ['left']
        : []
  const present = p.presentationRect ? clampValid(p.presentationRect) : null
  const borderRendered = {
    left: !openEdges.includes('left'),
    top: true,
    right: !openEdges.includes('right'),
    bottom: true,
  }
  const radius = {
    topLeft: 4,
    topRight: openEdges.length > 0 ? 0 : 4,
    bottomRight: openEdges.length > 0 ? 0 : 4,
    bottomLeft: 4,
  }
  return {
    kind: p.kind,
    semanticRect: p.semanticRect,
    presentationRect: present,
    visibilityClipRect: p.visibilityClip ?? null,
    coverage: present ? coverageOf(p.semanticRect, present) : { horizontal: 0, vertical: 0 },
    rightEdgeAuthority: 'SEMANTIC_TARGET',
    occlusion: p.occlusion,
    presentation: p.presentation,
    openEdges,
    borderRendered,
    radius,
    rectInvariantPass: validateRectInvariants(p.semanticRect) && validateRectInvariants(present),
    fullyVisible: p.fullyVisible,
  }
}

function clampValid(r: RectSnapshot): RectSnapshot {
  return validateRectInvariants(r) ? r : makeRectSnapshot({ left: 0, top: 0, right: 0, bottom: 0 })
}

/**
 * V5.12-R2 §10 — the PER-LINE fragment authority for inline source ranges.
 *
 * `expected` is the raw meaningful `Range.getClientRects()` set; `fragments` is
 * the same geometry grouped by VISUAL LINE (never a cross-line union). The
 * final inline visual must use `fragments`, never `unionClientRects(expected)`.
 */
export function measureTextFragmentRects(
  el: Element | null,
  textPrefix?: string | null,
  occurrenceIndex = 0,
): { expected: DOMRect[]; fragments: ClosureRect[]; foundToken: boolean } {
  if (!el) return { expected: [], fragments: [], foundToken: false }
  try {
    const range = document.createRange()
    const wanted = textPrefix && textPrefix.length > 0 ? textPrefix : null
    if (wanted) {
      // V5.12-R5 §8.2 — occurrence-aware exact range: the `occurrenceIndex`-th
      // token match, never a silent first match for a duplicate destination.
      // V5.12-R8 §6 — the token may span SEVERAL text nodes (whole image token).
      const decision = applyTokenRange(range, el, wanted, occurrenceIndex)
      if (decision === 'miss') {
        // The Nth occurrence does not exist → NO geometry (never the 1st match).
        return { expected: [], fragments: [], foundToken: false }
      }
    } else {
      range.selectNodeContents(el)
    }
    const raw = Array.from(range.getClientRects())
    const expected = raw.filter(r => r.width > 0 && r.height > 0 && Number.isFinite(r.left) && Number.isFinite(r.right))
    return {
      expected,
      fragments: groupClientRectsToFragments(expected),
      foundToken: wanted ? foundTokenIn(el, wanted) : false,
    }
  } catch {
    return { expected: [], fragments: [], foundToken: false }
  }
}

/** Inline mark exact text geometry — union of meaningful client rects. */
export function measureTextRects(
  el: Element | null,
  textPrefix?: string | null,
  occurrenceIndex = 0,
): { exact: RectSnapshot | null; foundToken: boolean } {
  if (!el) return { exact: null, foundToken: false }
  try {
    const range = document.createRange()
    const wanted = textPrefix && textPrefix.length > 0 ? textPrefix : null
    if (wanted) {
      // V5.12-R5 §8.2 / V5.12-R8 §6 — occurrence-aware exact range, possibly
      // spanning several text nodes (whole Markdown image token).
      const decision = applyTokenRange(range, el, wanted, occurrenceIndex)
      if (decision === 'miss') {
        // V5.12-R5 §8.2 — an unmeasurable nth occurrence is an explicit miss.
        return { exact: null, foundToken: false }
      }
    } else {
      range.selectNodeContents(el)
    }
    const rects = range.getClientRects()
    const box = unionClientRects(rects)
    return { exact: box, foundToken: wanted ? foundTokenIn(el, wanted) : false }
  } catch {
    return { exact: null, foundToken: false }
  }
}

/**
 * V5.12-R5 §8.2 — the `occurrenceIndex`-th match of `text` inside `el`, walking
 * text nodes in DOCUMENT ORDER. Returns null when that occurrence does not
 * exist (the caller must never fall back to the first match for occurrence > 0).
 */
function findTokenMatch(
  el: Element,
  text: string,
  occurrenceIndex: number,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let seen = 0
  let n: Node | null = walker.nextNode()
  while (n) {
    const value = n.nodeValue ?? ''
    if (value !== '') {
      let from = 0
      for (;;) {
        const idx = value.indexOf(text, from)
        if (idx < 0) break
        if (seen === occurrenceIndex) return { node: n as Text, offset: idx }
        seen++
        from = idx + text.length
      }
    }
    n = walker.nextNode()
  }
  return null
}

/**
 * V5.12-R8 §6/§13 — CROSS-TEXT-NODE token range.
 *
 * Typora renders a Markdown image token as SEVERAL text nodes (`![](` +
 * `a.png` + `)`), so a whole-token highlight (`![](a.png)`) can never be
 * measured inside a single text node. This matcher concatenates the element's
 * text nodes in document order, finds the `occurrenceIndex`-th match in the
 * CONCATENATION and maps both ends back to `(node, offset)` — producing a real
 * DOM Range. Multi-line matches then yield one fragment per visual line via
 * `Range.getClientRects()` (never a cross-line union).
 *
 * Used only when the single-text-node matcher misses, so no existing
 * occurrence ordinal changes.
 */
function findTokenNodeRange(
  el: Element,
  text: string,
  occurrenceIndex: number,
): { startNode: Text; startOffset: number; endNode: Text; endOffset: number } | null {
  if (!text) return null
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  const starts: number[] = []
  const lengths: number[] = []
  let flat = ''
  let n: Node | null = walker.nextNode()
  while (n) {
    const value = n.nodeValue ?? ''
    if (value !== '') {
      starts.push(flat.length)
      lengths.push(value.length)
      nodes.push(n as Text)
      flat += value
    }
    n = walker.nextNode()
  }
  if (nodes.length === 0) return null
  const locate = (flatIndex: number): { node: Text; offset: number } | null => {
    for (let i = 0; i < nodes.length; i++) {
      if (flatIndex >= starts[i] && flatIndex < starts[i] + lengths[i]) {
        return { node: nodes[i], offset: flatIndex - starts[i] }
      }
    }
    return null
  }
  let seen = 0
  let from = 0
  for (;;) {
    const idx = flat.indexOf(text, from)
    if (idx < 0) return null
    if (seen === occurrenceIndex) {
      const start = locate(idx)
      const end = locate(idx + text.length - 1)
      if (!start || !end) return null
      return { startNode: start.node, startOffset: start.offset, endNode: end.node, endOffset: end.offset + 1 }
    }
    seen++
    from = idx + text.length
  }
}

/**
 * Set a Range to the `occurrenceIndex`-th occurrence of `wanted` inside `el`.
 * Returns 'set' (exact range), 'miss' (that occurrence does not exist) or
 * 'whole' (no token requested / no occurrence anywhere → element contents).
 */
function applyTokenRange(
  range: Range,
  el: Element,
  wanted: string | null,
  occurrenceIndex: number,
): 'set' | 'miss' | 'whole' {
  if (!wanted) {
    range.selectNodeContents(el)
    return 'whole'
  }
  const occurrence = Math.max(0, Math.floor(occurrenceIndex))
  const match = findTokenMatch(el, wanted, occurrence)
  if (match) {
    range.setStart(match.node, match.offset)
    range.setEnd(match.node, match.offset + wanted.length)
    return 'set'
  }
  // V5.12-R8 §6 — the token may be split across text nodes (broken images).
  const span = findTokenNodeRange(el, wanted, occurrence)
  if (span) {
    range.setStart(span.startNode, span.startOffset)
    range.setEnd(span.endNode, span.endOffset)
    return 'set'
  }
  if (occurrence > 0) return 'miss'
  range.selectNodeContents(el)
  return 'whole'
}

/** V5.12-R5 §11 — how many times `text` occurs in the element's rendered text. */
export function countTokenInElement(el: Element | null, text: string): number {
  if (!el || !text) return 0
  const hay = el.textContent ?? ''
  let count = 0
  let from = 0
  for (;;) {
    const idx = hay.indexOf(text, from)
    if (idx < 0) break
    count++
    from = idx + text.length
  }
  return count
}

function foundTokenIn(el: Element, text: string): boolean {
  return el.textContent?.includes(text) === true
}

export { inflateRectBy }
