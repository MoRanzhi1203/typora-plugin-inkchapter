import type {
  HeadingDescriptor,
  HeadingLevel,
  HeadingSnapshot,
  RenderedHeadingState,
  DiffResult,
  HeadingLayoutSettings,
} from '../heading-numbering/heading-types'

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'
const NUMBERED_CLASS = 'inkchapter-numbered-heading'
const NUMBER_ATTR = 'data-inkchapter-heading-number'
const GAP_ATTR = 'data-inkchapter-heading-gap'

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
  collectHeadingBindings(): { key: string; element: HTMLHeadingElement; level: HeadingLevel; text: string }[] {
    if (!this.editorRoot) return []
    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    const result: { key: string; element: HTMLHeadingElement; level: HeadingLevel; text: string }[] = []
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
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
   * Each element must: still be connected, have the class, have correct attr value.
   */
  isRenderedStateValid(states: RenderedHeadingState[]): boolean {
    if (!this.editorRoot) return false
    const currentEls = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    let idx = 0
    for (let i = 0; i < currentEls.length && idx < states.length; i++) {
      const el = currentEls[i]
      if (this.isInsideExcluded(el)) continue
      if (idx >= states.length) return false
      const state = states[idx]
      if (state.element !== el) return false
      if (!state.element.isConnected) return false
      if (state.label === '') {
        // Un-numbered heading: must NOT have class or attr
        if (el.classList.contains(NUMBERED_CLASS)) return false
        if (el.hasAttribute(NUMBER_ATTR)) return false
      } else {
        if (!el.classList.contains(NUMBERED_CLASS)) return false
        if (el.getAttribute(NUMBER_ATTR) !== state.label) return false
      }
      idx++
    }
    return idx === states.length
  }

  /** Build rendered states from current DOM + computed labels. */
  buildRenderedStates(labels: readonly string[]): RenderedHeadingState[] {
    if (!this.editorRoot) return []
    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    const result: RenderedHeadingState[] = []
    let labelIdx = 0
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue
      if (labelIdx >= labels.length) continue
      const level = parseInt(el.tagName.charAt(1), 10)
      result.push({
        element: el,
        key: this.elementKey(el, i),
        level: level as HeadingLevel,
        label: labels[labelIdx],
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
   * Apply label gap (number-to-title spacing) to all heading elements.
   * Stores an enumeration value ("space"/"none") so that CSS attribute
   * selectors can deterministically apply spacing without fragile
   * trailing-space characters.
   * Must be called after applyNumberingDiff or repairDecoration.
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
        const label = states[labelIdx].label
        scanned++
        repairedSet.add(el)
        labelIdx++

        if (label === '') {
          // Un-numbered: ensure decoration is removed
          if (el.classList.contains(NUMBERED_CLASS)) {
            el.classList.remove(NUMBERED_CLASS)
            removed++
          }
          if (el.hasAttribute(NUMBER_ATTR)) {
            el.removeAttribute(NUMBER_ATTR)
          }
          continue
        }

        const currentLabel = el.getAttribute(NUMBER_ATTR)
        const hasClass = el.classList.contains(NUMBERED_CLASS)

        if (!hasClass || currentLabel !== label) {
          if (!hasClass) { el.classList.add(NUMBERED_CLASS); repaired++ }
          if (currentLabel !== label) { el.setAttribute(NUMBER_ATTR, label); updated++ }
        }
      }
    }

    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue
      if (!repairedSet.has(el) && el.classList.contains(NUMBERED_CLASS)) {
        el.classList.remove(NUMBERED_CLASS)
        el.removeAttribute(NUMBER_ATTR)
        removed++
      }
    }

    return { scanned, repaired, updated, removed }
  }

  clearNumbering(): void {
    if (!this.editorRoot) return
    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(`.${NUMBERED_CLASS}`)
    for (let i = 0; i < els.length; i++) {
      els[i].classList.remove(NUMBERED_CLASS)
      els[i].removeAttribute(NUMBER_ATTR)
    }
  }

  /**
   * Validate that all heading elements still carry their expected gap attributes.
   * Used by the fast-path to detect gap loss without a full refresh.
   */
  areGapsValid(gaps: readonly string[]): boolean {
    if (!this.editorRoot) return true
    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    let gapIdx = 0
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue
      if (gapIdx >= gaps.length) return true
      const expected = gaps[gapIdx]
      gapIdx++
      if (expected === 'space') {
        if (el.getAttribute(GAP_ATTR) !== 'space') return false
      } else {
        if (el.hasAttribute(GAP_ATTR)) return false
      }
    }
    return true
  }

  // ── Layout (alignment + indent) ─────────────────────

  /**
   * Apply heading layout classes to all headings in the editor.
   * Layout is independent of numbering — it applies even when numbering is off.
   */
  applyHeadingLayouts(layouts: HeadingLayoutSettings): void {
    if (!this.editorRoot) return
    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    const levelToConfig: Record<number, { textAlign: string; firstLineIndentEm: number }> = {
      1: layouts.h1, 2: layouts.h2, 3: layouts.h3,
      4: layouts.h4, 5: layouts.h5, 6: layouts.h6,
    }

    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      const level = parseInt(el.tagName.charAt(1), 10)
      const config = levelToConfig[level]
      if (!config) continue

      // Remove all old layout classes
      for (const cls of LAYOUT_CLASSES) {
        el.classList.remove(cls)
      }

      // Apply the appropriate class
      if (config.textAlign === 'left' && config.firstLineIndentEm >= 2) {
        el.classList.add('inkchapter-heading-indent-2')
      } else {
        el.classList.add(`inkchapter-heading-align-${config.textAlign}`)
      }
    }
  }

  /** Clear all layout classes from headings. */
  clearHeadingLayouts(): void {
    if (!this.editorRoot) return
    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    for (let i = 0; i < els.length; i++) {
      for (const cls of LAYOUT_CLASSES) {
        els[i].classList.remove(cls)
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
