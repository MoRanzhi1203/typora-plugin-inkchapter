import type {
  HeadingDescriptor,
  HeadingLevel,
  HeadingLevelPosition,
  HeadingSnapshot,
  RenderedHeadingState,
  DiffResult,
  HeadingLayoutSettings,
} from '../heading-numbering/heading-types'
import {
  HEADING_DECORATION_NUMBERED_CLASS_V514R4,
  decorationGapAttributeValue,
  decorationMismatchKind,
  normalizeDecorationGap,
  type ActualHeadingDecoration,
  type DecorationMismatchKind,
  type HeadingDecorationProjection,
} from '../heading-numbering/heading-decoration-projection-v514-r4'

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'
const NUMBERED_CLASS = HEADING_DECORATION_NUMBERED_CLASS_V514R4
const NUMBER_ATTR = 'data-inkchapter-heading-number'
const GAP_ATTR = 'data-inkchapter-heading-gap'

/** V5.14-R4 — one atomic decoration reconcile result (label + gap + class). */
export interface DecorationReconcileResult extends DiffResult {
  labelMismatch: number
  gapMismatch: number
  classMismatch: number
  /** headings whose FULL decoration was stripped (incl. the gap attribute). */
  cleared: number
  /** stale gap attributes removed from headings with no decoration at all. */
  staleGapRemoved: number
}

// Number position CSS custom properties — must match CSS in style.scss
const NUM_WIDTH_VAR = '--inkchapter-num-width'
const NUM_ALIGN_VAR = '--inkchapter-num-align'
const NUM_GAP_VAR = '--inkchapter-num-gap'
const WRAP_ALIGN_ATTR = 'data-inkchapter-wrap-align'

// Layout class names — must match CSS in style.scss
const LAYOUT_CLASSES = [
  'inkchapter-heading-align-left',
  'inkchapter-heading-indent-2',
  'inkchapter-heading-align-center',
  'inkchapter-heading-align-right',
]

/**
 * DOM adapter for heading numbering.
 */
export class HeadingDomAdapter {
  private editorRoot: HTMLElement | null = null

  getEditorRoot(): HTMLElement | null { return this.editorRoot }
  setEditorRoot(el: HTMLElement | null): void { this.editorRoot = el }
  detectEditorRoot(): HTMLElement | null { return document.getElementById('write') }

  /**
   * PERFORMANCE — ONE heading query for a whole refresh cycle. Callers pass the
   * result into the collect/validate/reconcile methods so a single keystroke no
   * longer runs 5-7 identical full-document selector scans.
   */
  queryHeadingElements(): HTMLHeadingElement[] {
    if (!this.editorRoot) return []
    return Array.from(this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR))
  }

  collectHeadings(): HeadingDescriptor[] {
    if (!this.editorRoot) return []
    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    const result: HeadingDescriptor[] = []
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue
      const level = parseInt(el.tagName.charAt(1), 10)
      if (level < 1 || level > 6) continue
      result.push({ key: this.elementKey(el, i), level: level as HeadingLevel, text: el.textContent ?? '' })
    }
    return result
  }

  /**
   * Canonical heading DOM binding — the SAME collection as collectHeadings()
   * (same exclusion + same elementKey), but retaining the live element so the
   * Heading authority can resolve "nearest preceding heading" by identity.
   */
  collectHeadingBindings(els?: readonly HTMLHeadingElement[]): { key: string; element: HTMLHeadingElement; level: HeadingLevel; text: string }[] {
    if (!this.editorRoot) return []
    const headingEls = els ?? this.queryHeadingElements()
    const result: { key: string; element: HTMLHeadingElement; level: HeadingLevel; text: string }[] = []
    for (let i = 0; i < headingEls.length; i++) {
      const el = headingEls[i]
      if (this.isInsideExcluded(el)) continue
      const level = parseInt(el.tagName.charAt(1), 10)
      if (level < 1 || level > 6) continue
      result.push({ key: this.elementKey(el, i), element: el, level: level as HeadingLevel, text: el.textContent ?? '' })
    }
    return result
  }

  createHeadingSnapshot(preCollected?: HeadingDescriptor[]): HeadingSnapshot[] {
    if (preCollected) {
      return preCollected.map(h => ({ key: h.key, level: h.level }))
    }
    if (!this.editorRoot) return []
    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    const result: HeadingSnapshot[] = []
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue
      const level = parseInt(el.tagName.charAt(1), 10)
      if (level < 1 || level > 6) continue
      result.push({ key: this.elementKey(el, i), level: level as HeadingLevel })
    }
    return result
  }

  hasStructureChanged(a: HeadingSnapshot[], b: HeadingSnapshot[]): boolean {
    if (a.length !== b.length) return true
    for (let i = 0; i < a.length; i++) {
      if (a[i].key !== b[i].key || a[i].level !== b[i].level) return true
    }
    return false
  }

  /**
   * Check if rendered state is still valid.
   * Each element must: still be connected, have the class, have the correct
   * attribute value(s). V5.14-R4 — when the state carries a `gap`, the gap
   * attribute is validated as part of the SAME check, so a label-valid but
   * gap-invalid DOM can never be accepted by the fast path.
   */
  isRenderedStateValid(states: RenderedHeadingState[], els?: readonly HTMLHeadingElement[]): boolean {
    if (!this.editorRoot) return false
    const currentEls = els ?? this.queryHeadingElements()
    let idx = 0
    for (let i = 0; i < currentEls.length && idx < states.length; i++) {
      const el = currentEls[i]
      if (this.isInsideExcluded(el)) continue
      if (idx >= states.length) return false
      const state = states[idx]
      if (state.element !== el) return false
      if (!state.element.isConnected) return false
      const expectedGap = state.gap == null ? null : normalizeDecorationGap(state.gap)
      if (state.label === '') {
        // Un-numbered heading: must NOT have class or attr (nor a stale gap)
        if (el.classList.contains(NUMBERED_CLASS)) return false
        if (el.hasAttribute(NUMBER_ATTR)) return false
        if (expectedGap != null && el.hasAttribute(GAP_ATTR)) return false
      } else {
        if (!el.classList.contains(NUMBERED_CLASS)) return false
        if (el.getAttribute(NUMBER_ATTR) !== state.label) return false
        if (expectedGap != null) {
          const wanted = decorationGapAttributeValue(expectedGap)
          if (wanted != null) {
            if (el.getAttribute(GAP_ATTR) !== wanted) return false
          } else if (el.hasAttribute(GAP_ATTR)) {
            return false
          }
        }
      }
      idx++
    }
    return idx === states.length
  }

  /** Build rendered states from current DOM + computed labels (+ optional gaps). */
  buildRenderedStates(
    labels: readonly string[],
    gaps?: readonly (string | null | undefined)[],
    els?: readonly HTMLHeadingElement[],
  ): RenderedHeadingState[] {
    if (!this.editorRoot) return []
    const headingEls = els ?? this.queryHeadingElements()
    const result: RenderedHeadingState[] = []
    let labelIdx = 0
    for (let i = 0; i < headingEls.length; i++) {
      const el = headingEls[i]
      if (this.isInsideExcluded(el)) continue
      if (labelIdx >= labels.length) continue
      const level = parseInt(el.tagName.charAt(1), 10)
      result.push({
        element: el,
        key: this.elementKey(el, i),
        level: level as HeadingLevel,
        label: labels[labelIdx],
        gap: normalizeDecorationGap(gaps?.[labelIdx]),
      })
      labelIdx++
    }
    return result
  }

  /**
   * Apply numbering with diff-based updates. Returns diff stats.
   * Empty labels cause removal of numbering decoration (used for un-numbered H1).
   */
  applyNumberingDiff(labels: readonly string[]): DiffResult {
    let scanned = 0, repaired = 0, updated = 0, removed = 0
    if (!this.editorRoot) return { scanned, repaired, updated, removed }

    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    const newNumbered = new Set<HTMLElement>()
    let labelIdx = 0

    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue

      if (labelIdx < labels.length) {
        const label = labels[labelIdx]
        scanned++
        labelIdx++

        if (label === '') {
          // Empty label: ensure numbering decoration is removed
          if (el.classList.contains(NUMBERED_CLASS)) {
            el.classList.remove(NUMBERED_CLASS)
            removed++
          }
          if (el.hasAttribute(NUMBER_ATTR)) {
            el.removeAttribute(NUMBER_ATTR)
          }
          continue
        }

        newNumbered.add(el)

        const currentLabel = el.getAttribute(NUMBER_ATTR)
        const hasClass = el.classList.contains(NUMBERED_CLASS)

        if (!hasClass || currentLabel !== label) {
          if (!hasClass) {
            el.classList.add(NUMBERED_CLASS)
            repaired++
          }
          if (currentLabel !== label) {
            el.setAttribute(NUMBER_ATTR, label)
            updated++
          }
        }
      }
    }

    // Remove numbering from headings no longer in the list
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue
      if (!newNumbered.has(el) && el.classList.contains(NUMBERED_CLASS)) {
        el.classList.remove(NUMBERED_CLASS)
        el.removeAttribute(NUMBER_ATTR)
        removed++
      }
    }

    return { scanned, repaired, updated, removed }
  }

  /**
   * §10 — read the ACTUAL decoration of a heading as one state.
   */
  readHeadingDecoration(el: HTMLElement): ActualHeadingDecoration {
    return {
      numberedClass: el.classList.contains(NUMBERED_CLASS),
      label: el.getAttribute(NUMBER_ATTR),
      gap: normalizeDecorationGap(el.getAttribute(GAP_ATTR)),
    }
  }

  /**
   * §9/§10 — the ONE atomic projection write for a single heading: class +
   * number attribute + gap attribute are committed inside the SAME statement
   * block, so a caller can never observe (or leave behind) a label without its
   * gap. Returns the mismatch kinds it actually repaired.
   */
  private applyHeadingDecoration(
    el: HTMLElement,
    expected: HeadingDecorationProjection,
  ): { changed: boolean; labelMismatch: boolean; gapMismatch: boolean; classMismatch: boolean; mismatchKind: DecorationMismatchKind } {
    const actual = this.readHeadingDecoration(el)
    const mismatchKind = decorationMismatchKind(expected, actual)
    if (expected.label === '') {
      if (mismatchKind === 'none') {
        return { changed: false, labelMismatch: false, gapMismatch: false, classMismatch: false, mismatchKind }
      }
      if (actual.numberedClass) el.classList.remove(NUMBERED_CLASS)
      if (actual.label !== null) el.removeAttribute(NUMBER_ATTR)
      // the gap is ALWAYS stripped together with the number — never left behind
      if (actual.gap !== 'none') el.removeAttribute(GAP_ATTR)
      return {
        changed: true,
        labelMismatch: actual.label !== null,
        gapMismatch: actual.gap !== 'none',
        classMismatch: actual.numberedClass,
        mismatchKind,
      }
    }
    const labelMismatch = actual.label !== expected.label
    const gapMismatch = actual.gap !== expected.gap
    const classMismatch = !actual.numberedClass
    if (!labelMismatch && !gapMismatch && !classMismatch) {
      return { changed: false, labelMismatch: false, gapMismatch: false, classMismatch: false, mismatchKind }
    }
    if (classMismatch) el.classList.add(NUMBERED_CLASS)
    if (labelMismatch) el.setAttribute(NUMBER_ATTR, expected.label)
    const gapAttr = decorationGapAttributeValue(expected.gap)
    if (gapAttr != null) {
      if (gapMismatch) el.setAttribute(GAP_ATTR, gapAttr)
    } else if (gapMismatch) {
      el.removeAttribute(GAP_ATTR)
    }
    return { changed: true, labelMismatch, gapMismatch, classMismatch, mismatchKind }
  }

  /**
   * §9 — the ATOMIC heading decoration reconcile. ONE projection snapshot in,
   * class + label + gap committed per heading in one pass. There is no code path
   * in which the number attribute can be written without the gap being resolved
   * from the SAME projection.
   */
  reconcileHeadingDecorations(
    projections: readonly HeadingDecorationProjection[],
    preCollected?: readonly HTMLHeadingElement[],
  ): DecorationReconcileResult {
    const result: DecorationReconcileResult = {
      scanned: 0, repaired: 0, updated: 0, removed: 0,
      labelMismatch: 0, gapMismatch: 0, classMismatch: 0, cleared: 0, staleGapRemoved: 0,
    }
    if (!this.editorRoot) return result

    const els = preCollected ?? this.queryHeadingElements()
    const handled = new Set<HTMLElement>()
    let idx = 0
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue
      if (idx >= projections.length) break
      const expected = projections[idx]
      idx++
      handled.add(el)
      result.scanned++
      const applied = this.applyHeadingDecoration(el, expected)
      if (applied.labelMismatch) result.labelMismatch++
      if (applied.gapMismatch) result.gapMismatch++
      if (applied.classMismatch) result.classMismatch++
      if (applied.changed) result.repaired++
      if (expected.label === '') result.cleared++
    }

    // Headings beyond the projection: strip the FULL decoration (incl. the gap).
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue
      if (handled.has(el)) continue
      const actual = this.readHeadingDecoration(el)
      if (!actual.numberedClass && actual.label === null && actual.gap === 'none') continue
      el.classList.remove(NUMBERED_CLASS)
      el.removeAttribute(NUMBER_ATTR)
      if (actual.gap !== 'none') {
        el.removeAttribute(GAP_ATTR)
        result.staleGapRemoved++
      }
      result.removed++
    }

    return result
  }

  /**
   * Apply label gap (number-to-title spacing) to all heading elements.
   * V5.14-R4 — legacy compatibility only: the service now routes through
   * `reconcileHeadingDecorations`. Never call this as a separate step after a
   * label commit.
   */
  applyLabelGaps(gaps: readonly string[]): void {
    if (!this.editorRoot) return

    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    let gapIdx = 0

    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue

      if (gapIdx < gaps.length) {
        const gap = gaps[gapIdx]
        gapIdx++
        if (gap === 'space') {
          el.setAttribute(GAP_ATTR, 'space')
        } else {
          el.removeAttribute(GAP_ATTR)
        }
      }
    }

    // Remove gap from any remaining heading that is no longer numbered
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue
      if (!el.classList.contains(NUMBERED_CLASS) && el.hasAttribute(GAP_ATTR)) {
        el.removeAttribute(GAP_ATTR)
      }
    }
  }

  /**
   * Repair numbering decoration without recomputing labels.
   * Used when: node replaced but snapshot structure unchanged.
   * V5.14-R4 — the repair is ATOMIC: it commits class + label + gap in the same
   * per-element block, so a repaired heading can never end up with a label but
   * no gap. When the state does not carry a gap, the element's CURRENT gap is
   * preserved (legacy callers keep their semantics, but never lose parity).
   */
  repairDecoration(states: RenderedHeadingState[]): DiffResult {
    let scanned = 0, repaired = 0, updated = 0, removed = 0
    if (!this.editorRoot) return { scanned, repaired, updated, removed }

    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    const repairedSet = new Set<HTMLElement>()
    let labelIdx = 0

    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue

      if (labelIdx < states.length) {
        const state = states[labelIdx]
        scanned++
        repairedSet.add(el)
        labelIdx++

        const expectedGap = state.gap == null
          ? normalizeDecorationGap(el.getAttribute(GAP_ATTR))
          : normalizeDecorationGap(state.gap)
        const applied = this.applyHeadingDecoration(el, {
          stableIdentity: state.key,
          label: state.label,
          gap: state.label === '' ? 'none' : expectedGap,
        })
        if (applied.classMismatch) repaired++
        if (applied.labelMismatch) updated++
        if (state.label === '') removed++
      }
    }

    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue
      if (!repairedSet.has(el)) {
        const actual = this.readHeadingDecoration(el)
        if (!actual.numberedClass && actual.label === null && actual.gap === 'none') continue
        el.classList.remove(NUMBERED_CLASS)
        el.removeAttribute(NUMBER_ATTR)
        el.removeAttribute(GAP_ATTR)
        removed++
      }
    }

    return { scanned, repaired, updated, removed }
  }

  /**
   * Clear ALL numbering decoration — class + number attribute + gap attribute.
   * V5.14-R4 — the gap is part of the decoration: leaving it behind after a
   * document switch is exactly the stale-gap the R4 gates forbid.
   */
  clearNumbering(): void {
    if (!this.editorRoot) return
    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (
        !el.classList.contains(NUMBERED_CLASS)
        && !el.hasAttribute(NUMBER_ATTR)
        && !el.hasAttribute(GAP_ATTR)
        && !el.hasAttribute(WRAP_ALIGN_ATTR)
        && !el.style.getPropertyValue(NUM_WIDTH_VAR)
        && !el.style.getPropertyValue(NUM_ALIGN_VAR)
        && !el.style.getPropertyValue(NUM_GAP_VAR)
      ) continue
      el.classList.remove(NUMBERED_CLASS)
      el.removeAttribute(NUMBER_ATTR)
      el.removeAttribute(GAP_ATTR)
      this.clearPositionVars(el)
    }
  }

  /**
   * Phase 4 — apply per-level number position (alignment / box width / extra gap /
   * wrapped-line alignment) as CSS custom properties.
   *
   * The DISABLED position (the default) writes nothing, so a document that never
   * configured the feature keeps the pre-feature rendering byte-for-byte; applying
   * the default after a custom position CLEANS the previous variables.
   */
  applyHeadingNumberPositions(
    positions: Record<HeadingLevel, HeadingLevelPosition>,
    preCollected?: readonly HTMLHeadingElement[],
  ): void {
    if (!this.editorRoot) return
    const els = preCollected ?? this.queryHeadingElements()
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      const level = parseInt(el.tagName.charAt(1), 10) as HeadingLevel
      const pos = positions[level]
      if (!pos) continue
      this.applyPositionVars(el, pos)
    }
  }

  /** Clear the position CSS variables / attribute from every heading. */
  clearHeadingNumberPositions(preCollected?: readonly HTMLHeadingElement[]): void {
    if (!this.editorRoot) return
    const els = preCollected ?? this.queryHeadingElements()
    for (let i = 0; i < els.length; i++) this.clearPositionVars(els[i])
  }

  /**
   * Write ONLY the non-default fields. A field at its disabled value is removed
   * instead of written, so the default position is a strict no-op on the DOM.
   */
  private applyPositionVars(el: HTMLElement, pos: HeadingLevelPosition): void {
    if (pos.numberBoxWidthEm > 0) {
      if (el.style.getPropertyValue(NUM_WIDTH_VAR) !== `${pos.numberBoxWidthEm}em`) {
        el.style.setProperty(NUM_WIDTH_VAR, `${pos.numberBoxWidthEm}em`)
      }
      if (el.style.getPropertyValue(NUM_ALIGN_VAR) !== pos.numberAlignment) {
        el.style.setProperty(NUM_ALIGN_VAR, pos.numberAlignment)
      }
    } else {
      el.style.removeProperty(NUM_WIDTH_VAR)
      el.style.removeProperty(NUM_ALIGN_VAR)
    }

    if (pos.numberTextGapEm > 0) {
      if (el.style.getPropertyValue(NUM_GAP_VAR) !== `${pos.numberTextGapEm}em`) {
        el.style.setProperty(NUM_GAP_VAR, `${pos.numberTextGapEm}em`)
      }
    } else {
      el.style.removeProperty(NUM_GAP_VAR)
    }

    if (pos.alignWrappedLines) {
      if (el.getAttribute(WRAP_ALIGN_ATTR) !== 'true') el.setAttribute(WRAP_ALIGN_ATTR, 'true')
    } else {
      el.removeAttribute(WRAP_ALIGN_ATTR)
    }

    this.dropEmptyStyleAttribute(el)
  }

  private clearPositionVars(el: HTMLElement): void {
    el.style.removeProperty(NUM_WIDTH_VAR)
    el.style.removeProperty(NUM_ALIGN_VAR)
    el.style.removeProperty(NUM_GAP_VAR)
    el.removeAttribute(WRAP_ALIGN_ATTR)
    this.dropEmptyStyleAttribute(el)
  }

  /** Remove the style attribute only when WE left it completely empty. */
  private dropEmptyStyleAttribute(el: HTMLElement): void {
    if (el.style.length === 0 && el.hasAttribute('style')) el.removeAttribute('style')
  }

  /**
   * Validate that all heading elements still carry their expected gap attributes.
   * V5.14-R4 — this is now a STRICT parity check: the number of non-excluded
   * headings must equal the projection length (the previous early `return true`
   * accepted a short array as "valid", i.e. a gap mismatch escaped the fast path).
   */
  areGapsValid(gaps: readonly string[]): boolean {
    if (!this.editorRoot) return true
    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    let gapIdx = 0
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue
      if (gapIdx >= gaps.length) return false
      const expected = gaps[gapIdx]
      gapIdx++
      if (expected === 'space') {
        if (el.getAttribute(GAP_ATTR) !== 'space') return false
      } else {
        if (el.hasAttribute(GAP_ATTR)) return false
      }
    }
    return gapIdx === gaps.length
  }

  // ── Layout (alignment + indent) ─────────────────────

  /**
   * Apply heading layout classes to all headings in the editor.
   * Layout is independent of numbering — it applies even when numbering is off.
   */
  applyHeadingLayouts(layouts: HeadingLayoutSettings, preCollected?: readonly HTMLHeadingElement[]): void {
    if (!this.editorRoot) return
    const els = preCollected ?? this.queryHeadingElements()
    const levelToConfig: Record<number, { textAlign: string; firstLineIndentEm: number }> = {
      1: layouts.h1, 2: layouts.h2, 3: layouts.h3,
      4: layouts.h4, 5: layouts.h5, 6: layouts.h6,
    }

    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      const level = parseInt(el.tagName.charAt(1), 10)
      const config = levelToConfig[level]
      if (!config) continue

      // PERFORMANCE — write only on a real state change. The class list is
      // stable for almost every keystroke, so the old unconditional
      // remove×N + add caused needless attribute/style invalidation.
      const desired = config.textAlign === 'left' && config.firstLineIndentEm >= 2
        ? 'inkchapter-heading-indent-2'
        : `inkchapter-heading-align-${config.textAlign}`
      for (const cls of LAYOUT_CLASSES) {
        if (cls !== desired && el.classList.contains(cls)) el.classList.remove(cls)
      }
      if (!el.classList.contains(desired)) el.classList.add(desired)
    }
  }

  /** Clear all layout classes from headings. */
  clearHeadingLayouts(preCollected?: readonly HTMLHeadingElement[]): void {
    if (!this.editorRoot) return
    const els = preCollected ?? this.queryHeadingElements()
    for (let i = 0; i < els.length; i++) {
      for (const cls of LAYOUT_CLASSES) {
        if (els[i].classList.contains(cls)) els[i].classList.remove(cls)
      }
    }
  }

  /** Check if any previously numbered element is disconnected. */
  hasDisconnectedElements(states: RenderedHeadingState[]): boolean {
    for (const s of states) {
      if (!s.element.isConnected || !s.element.classList.contains(NUMBERED_CLASS)) return true
    }
    return false
  }

  /**
   * Build a unique key for a heading element within the current document.
   * Priority: element id > data-line > absolute DOM index (guarantees uniqueness).
   * Previous implementation used only tagName-dataLine-id, which degenerated to
   * "H2--" for all H2 elements when data-line and id were both empty, causing
   * the override map to pollute all same-level headings.
   */
  private elementKey(el: HTMLElement, absoluteIndex: number): string {
    const tag = el.tagName.toUpperCase()
    const id = (el.id ?? '').trim()
    const dataLine = el.getAttribute('data-line')?.trim()

    if (id) return `${tag}:id:${id}`
    if (dataLine) return `${tag}:line:${dataLine}`
    // Fallback: absolute index guarantees uniqueness within the document
    return `${tag}:idx:${absoluteIndex}`
  }

  private isInsideExcluded(el: HTMLElement): boolean {
    if (el.closest('pre, code, .md-codeblock')) return true
    if (el.closest('[hidden], template')) return true
    return false
  }
}
