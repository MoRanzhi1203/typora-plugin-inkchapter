import type { HeadingDescriptor, HeadingLevel } from '../heading-numbering/heading-types'

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'
const NUMBERED_CLASS = 'inkchapter-numbered-heading'
const NUMBER_ATTR = 'data-inkchapter-heading-number'

/**
 * DOM adapter for heading numbering.
 * Scans the Typora writing area for heading elements and applies/removes
 * numbering display via CSS ::before pseudo-elements.
 */
export class HeadingDomAdapter {
  private writingArea: HTMLElement | null = null

  /** Set the active writing area element. */
  setWritingArea(el: HTMLElement): void {
    this.writingArea = el
  }

  /** Detect the writing area from the document. */
  detectWritingArea(): HTMLElement | null {
    return document.getElementById('write')
  }

  /**
   * Extract heading descriptors from the current writing area.
   * Excludes headings inside code blocks, templates, and non-editor regions.
   */
  getHeadings(): HeadingDescriptor[] {
    if (!this.writingArea) {
      return []
    }

    const headingEls = this.writingArea.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    const result: HeadingDescriptor[] = []

    for (let i = 0; i < headingEls.length; i++) {
      const el = headingEls[i]

      // Exclude headings inside code blocks or hidden elements
      if (this.isInsideExcluded(el)) {
        continue
      }

      const level = parseInt(el.tagName.charAt(1), 10)
      if (level < 1 || level > 6) {
        continue
      }

      result.push({
        key: this.getHeadingKey(el, i),
        level: level as HeadingLevel,
        text: el.textContent ?? '',
      })
    }

    return result
  }

  /**
   * Apply numbering labels to heading elements.
   * Does NOT modify text content; only sets class + data attribute.
   */
  applyNumbering(labels: readonly string[]): void {
    if (!this.writingArea) {
      return
    }

    const headingEls = this.writingArea.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)
    let labelIdx = 0

    for (let i = 0; i < headingEls.length; i++) {
      const el = headingEls[i]

      if (this.isInsideExcluded(el)) {
        continue
      }

      if (labelIdx < labels.length) {
        el.classList.add(NUMBERED_CLASS)
        el.setAttribute(NUMBER_ATTR, labels[labelIdx])
        labelIdx++
      }
    }
  }

  /**
   * Remove all numbering from heading elements.
   * Removes class and data attribute.
   */
  removeNumbering(): void {
    if (!this.writingArea) {
      return
    }

    const headingEls = this.writingArea.querySelectorAll<HTMLHeadingElement>(`.${NUMBERED_CLASS}`)
    for (let i = 0; i < headingEls.length; i++) {
      headingEls[i].classList.remove(NUMBERED_CLASS)
      headingEls[i].removeAttribute(NUMBER_ATTR)
    }
  }

  /**
   * Refresh numbering: remove existing, then re-apply with new labels.
   */
  refreshNumbering(labels: readonly string[]): void {
    this.removeNumbering()
    this.applyNumbering(labels)
  }

  /** Generate a unique key for a heading element. */
  private getHeadingKey(el: HTMLElement, index: number): string {
    return `heading-${el.tagName.toLowerCase()}-${index}`
  }

  /** Check if an element is inside excluded regions. */
  private isInsideExcluded(el: HTMLElement): boolean {
    // Exclude code blocks
    if (el.closest('pre, code, .md-codeblock')) {
      return true
    }

    // Exclude hidden/template elements
    if (el.closest('[hidden], template, [style*="display: none"]')) {
      return true
    }

    // Exclude non-visible elements
    if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) {
      return true
    }

    return false
  }
}
