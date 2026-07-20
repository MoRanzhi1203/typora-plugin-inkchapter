import type {
  HeadingDescriptor,
  HeadingLevel,
  HeadingSnapshot,
  RenderedHeadingState,
  DiffResult,
} from '../heading-numbering/heading-types'

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'
const NUMBERED_CLASS = 'inkchapter-numbered-heading'
const NUMBER_ATTR = 'data-inkchapter-heading-number'

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
      result.push({ key: this.elementKey(el), level: level as HeadingLevel, text: el.textContent ?? '' })
    }
    return result
  }

  createHeadingSnapshot(): HeadingSnapshot[] {
    if (!this.editorRoot) return []
    const els = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    const result: HeadingSnapshot[] = []
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (this.isInsideExcluded(el)) continue
      const level = parseInt(el.tagName.charAt(1), 10)
      if (level < 1 || level > 6) continue
      result.push({ key: this.elementKey(el), level: level as HeadingLevel })
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
      if (!el.classList.contains(NUMBERED_CLASS)) return false
      if (el.getAttribute(NUMBER_ATTR) !== state.label) return false
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
        key: this.elementKey(el),
        level: level as HeadingLevel,
        label: labels[labelIdx],
      })
      labelIdx++
    }
    return result
  }

  /**
   * Apply numbering with diff-based updates. Returns diff stats.
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
        newNumbered.add(el)
        labelIdx++

        const currentLabel = el.getAttribute(NUMBER_ATTR)
        const hasClass = el.classList.contains(NUMBERED_CLASS)

        // Repair: element missing class or has wrong attribute
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

  /** Check if any previously numbered element is disconnected. */
  hasDisconnectedElements(states: RenderedHeadingState[]): boolean {
    for (const s of states) {
      if (!s.element.isConnected || !s.element.classList.contains(NUMBERED_CLASS)) return true
    }
    return false
  }

  private elementKey(el: HTMLElement): string {
    return `${el.tagName}-${el.getAttribute('data-line') ?? ''}-${el.id ?? ''}`
  }

  private isInsideExcluded(el: HTMLElement): boolean {
    if (el.closest('pre, code, .md-codeblock')) return true
    if (el.closest('[hidden], template')) return true
    return false
  }
}
