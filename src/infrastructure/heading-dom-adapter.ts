import type {
  HeadingDescriptor,
  HeadingLevel,
  HeadingSnapshot,
} from '../heading-numbering/heading-types'

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'
const NUMBERED_CLASS = 'inkchapter-numbered-heading'
const NUMBER_ATTR = 'data-inkchapter-heading-number'

/**
 * DOM adapter for heading numbering.
 * Provides editor root access, heading extraction, snapshot creation,
 * diff-based numbering application, and full cleanup.
 */
export class HeadingDomAdapter {
  private editorRoot: HTMLElement | null = null
  /** Track currently numbered elements for diff updates. */
  private numberedElements = new WeakMap<HTMLElement, string>()

  /** Get the current editor root element. */
  getEditorRoot(): HTMLElement | null {
    return this.editorRoot
  }

  /** Set or clear the editor root. Detaches old reference. */
  setEditorRoot(el: HTMLElement | null): void {
    this.editorRoot = el
  }

  /** Detect the editor root from the document. */
  detectEditorRoot(): HTMLElement | null {
    return document.getElementById('write')
  }

  /**
   * Extract heading descriptors from the current editor root.
   * Excludes code blocks, hidden elements, and non-editor regions.
   */
  collectHeadings(): HeadingDescriptor[] {
    if (!this.editorRoot) {
      return []
    }

    const headingEls = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    const result: HeadingDescriptor[] = []

    for (let i = 0; i < headingEls.length; i++) {
      const el = headingEls[i]

      if (this.isInsideExcluded(el)) {
        continue
      }

      const level = parseInt(el.tagName.charAt(1), 10)
      if (level < 1 || level > 6) {
        continue
      }

      result.push({
        key: this.elementKey(el),
        level: level as HeadingLevel,
        text: el.textContent ?? '',
      })
    }

    return result
  }

  /**
   * Create a lightweight snapshot for dirty checking.
   * Only compares heading structure (element identity + level),
   * not text content.
   */
  createHeadingSnapshot(): HeadingSnapshot[] {
    if (!this.editorRoot) {
      return []
    }

    const headingEls = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    const result: HeadingSnapshot[] = []

    for (let i = 0; i < headingEls.length; i++) {
      const el = headingEls[i]

      if (this.isInsideExcluded(el)) {
        continue
      }

      const level = parseInt(el.tagName.charAt(1), 10)
      if (level < 1 || level > 6) {
        continue
      }

      result.push({
        key: this.elementKey(el),
        level: level as HeadingLevel,
      })
    }

    return result
  }

  /**
   * Compare two snapshots. Returns true if heading structure changed.
   */
  hasStructureChanged(a: HeadingSnapshot[], b: HeadingSnapshot[]): boolean {
    if (a.length !== b.length) {
      return true
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i].key !== b[i].key || a[i].level !== b[i].level) {
        return true
      }
    }
    return false
  }

  /**
   * Apply numbering with diff-based updates.
   * - Only sets attribute when value changed
   * - Only adds class when not already present
   * - Removes numbering from elements no longer numbered
   * - Does NOT do full clear-then-rebuild
   */
  applyNumberingDiff(labels: readonly string[]): void {
    if (!this.editorRoot) {
      return
    }

    const headingEls = this.editorRoot.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    const newNumbered = new WeakMap<HTMLElement, string>()
    let labelIdx = 0

    for (let i = 0; i < headingEls.length; i++) {
      const el = headingEls[i]

      if (this.isInsideExcluded(el)) {
        continue
      }

      if (labelIdx >= labels.length) {
        continue
      }

      const label = labels[labelIdx]
      newNumbered.set(el, label)

      // Diff: only update if changed
      const currentLabel = el.getAttribute(NUMBER_ATTR)
      if (currentLabel !== label) {
        el.setAttribute(NUMBER_ATTR, label)
      }

      if (!el.classList.contains(NUMBERED_CLASS)) {
        el.classList.add(NUMBERED_CLASS)
      }

      labelIdx++
    }

    // Remove numbering from elements no longer in the list
    for (let i = 0; i < headingEls.length; i++) {
      const el = headingEls[i]

      if (this.isInsideExcluded(el)) {
        continue
      }

      const wasNumbered = this.numberedElements.has(el) && el.classList.contains(NUMBERED_CLASS)
      const isNumbered = newNumbered.has(el)

      if (wasNumbered && !isNumbered) {
        el.classList.remove(NUMBERED_CLASS)
        el.removeAttribute(NUMBER_ATTR)
      }
    }

    // Update tracking
    this.numberedElements = newNumbered
  }

  /**
   * Remove all heading numbering. Used for toggle-off and cleanup.
   */
  clearNumbering(): void {
    if (!this.editorRoot) {
      return
    }

    const headingEls = this.editorRoot.querySelectorAll<HTMLHeadingElement>(`.${NUMBERED_CLASS}`)
    for (let i = 0; i < headingEls.length; i++) {
      headingEls[i].classList.remove(NUMBERED_CLASS)
      headingEls[i].removeAttribute(NUMBER_ATTR)
    }
  }

  /** Generate a stable key for a heading element. */
  private elementKey(el: HTMLElement): string {
    return `${el.tagName}-${el.getAttribute('data-line') ?? ''}-${el.id ?? ''}`
  }

  /** Check if an element is inside excluded regions. */
  private isInsideExcluded(el: HTMLElement): boolean {
    if (el.closest('pre, code, .md-codeblock')) {
      return true
    }
    if (el.closest('[hidden], template')) {
      return true
    }
    return false
  }
}
