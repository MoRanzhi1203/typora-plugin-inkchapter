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
): { expected: DOMRect[]; fragments: ClosureRect[]; foundToken: boolean } {
  if (!el) return { expected: [], fragments: [], foundToken: false }
  try {
    const range = document.createRange()
    const wanted = textPrefix && textPrefix.length > 0 ? textPrefix : null
    if (wanted) {
      const node = findTextNodeContaining(el, wanted)
      if (node) {
        const start = node.nodeValue!.indexOf(wanted)
        range.setStart(node, Math.max(0, start))
        range.setEnd(node, start + wanted.length)
      } else {
        range.selectNodeContents(el)
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
): { exact: RectSnapshot | null; foundToken: boolean } {
  if (!el) return { exact: null, foundToken: false }
  try {
    const range = document.createRange()
    const wanted = textPrefix && textPrefix.length > 0 ? textPrefix : null
    if (wanted) {
      const node = findTextNodeContaining(el, wanted)
      if (node) {
        const start = node.nodeValue!.indexOf(wanted)
        range.setStart(node, Math.max(0, start))
        range.setEnd(node, start + wanted.length)
      } else {
        range.selectNodeContents(el)
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

function findTextNodeContaining(el: Element, text: string): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let n: Node | null = walker.nextNode()
  while (n) {
    if (n.nodeValue && n.nodeValue.includes(text)) return n as Text
    n = walker.nextNode()
  }
  return null
}

function foundTokenIn(el: Element, text: string): boolean {
  return el.textContent?.includes(text) === true
}

export { inflateRectBy }
