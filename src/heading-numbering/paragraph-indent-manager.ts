/**
 * Paragraph Indent Manager — manages paragraph-level indent semantics.
 *
 * Responsibilities:
 * 1. Parse `<!-- inkchapter:paragraph-indent=2 -->` markers from Markdown source
 * 2. Apply text-indent styles to paragraph DOM elements
 * 3. Detect formula continuation (paragraph → display math → paragraph)
 * 4. Handle `..` / `。。` + Enter shortcut for force-indent-2 paragraphs
 */

import type {
  ParagraphIndentMode,
  ParagraphIndentOverride,
  ParagraphLayoutContext,
  ParagraphLayoutSettings,
} from './heading-types'
import { PARAGRAPH_INDENT_MARKER, resolveParagraphIndent } from './heading-types'

const INDENT_MARKER_COMMENT = `<!-- ${PARAGRAPH_INDENT_MARKER} -->`

// CSS class applied to a paragraph with force-indent-2 semantic
const FORCE_INDENT_CLASS = 'inkchapter-paragraph-indent-2'

// Excluded context selectors — must not trigger shortcut in these elements
const EXCLUDED_PARENT_SELECTORS = [
  'pre', 'code', '.md-codeblock',
  '.md-math-block', '.math', 'mjx-container',
  'blockquote', '.md-blockquote',
  'li', 'ul', 'ol',
  'table', 'th', 'td',
  'sup', '.md-footnote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]

/**
 * Scans Markdown source for paragraph indent markers.
 * Returns a Set of paragraph indices that have force-indent-2.
 */
export function parseIndentMarkers(markdown: string): Set<number> {
  const markers = new Set<number>()
  if (!markdown) return markers

  const lines = markdown.split('\n')
  let paraIndex = 0
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Skip heading lines (start with #)
    if (/^#{1,6}\s/.test(line)) {
      i++
      // Consume the paragraph block (heading content)
      while (i < lines.length && lines[i].trim() !== '') i++
      // Skip blank lines
      while (i < lines.length && lines[i].trim() === '') i++
      continue
    }

    // Skip blank lines — they separate paragraphs
    if (line.trim() === '') {
      i++
      continue
    }

    // Check if this line is a marker comment
    const trimmed = line.trim()
    if (trimmed === INDENT_MARKER_COMMENT) {
      markers.add(paraIndex)
      i++
      // Skip blank lines after marker
      while (i < lines.length && lines[i].trim() === '') i++
      continue
    }

    // Skip fenced code blocks
    if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) {
      i++
      while (i < lines.length && !/^(```|~~~)/.test(lines[i].trim())) i++
      i++ // skip closing fence
      continue
    }

    // Skip display math blocks ($$ ... $$)
    if (trimmed.startsWith('$$') && trimmed.length > 2) {
      i++
      while (i < lines.length && !lines[i].trim().endsWith('$$')) i++
      i++
      continue
    }

    // Skip list items, blockquotes, tables (non-paragraph structures)
    if (/^[\s]*[-*+>|]/.test(line) || /^\d+\.\s/.test(line)) {
      i++
      // Consume the block
      while (i < lines.length && lines[i].trim() !== '') i++
      // Skip blank lines
      while (i < lines.length && lines[i].trim() === '') i++
      continue
    }

    // This is a paragraph — consume it
    paraIndex++
    i++
    // Consume continuation lines (non-blank, non-structural)
    while (i < lines.length && lines[i].trim() !== '' && !isStructuralLine(lines[i])) {
      i++
    }
    // Skip trailing blank lines
    while (i < lines.length && lines[i].trim() === '') i++
  }

  return markers
}

function isStructuralLine(line: string): boolean {
  const t = line.trim()
  if (t === '') return false
  if (/^#{1,6}\s/.test(t)) return true
  if (/^```|^~~~/.test(t)) return true
  if (/^[\s]*[-*+>|]/.test(t)) return true
  if (/^\d+\.\s/.test(t)) return true
  return false
}

/**
 * Determine if a paragraph DOM element follows a display math block.
 * Checks the previous sibling in the DOM tree.
 */
export function isAfterDisplayMath(paragraph: HTMLElement): boolean {
  let prev = paragraph.previousElementSibling
  while (prev) {
    // Skip blank/intermediate elements
    if (prev.querySelector('.md-math-block, mjx-container[display="true"]')) {
      return true
    }
    // Check if the element itself is a math block
    if (prev.classList.contains('md-math-block')) return true
    const mjx = prev.querySelector?.('mjx-container[display="true"]')
    if (mjx) return true
    // Check for MathJax display math wrapper
    if (prev.tagName === 'P' && prev.querySelector('mjx-container[display="true"]')) return true

    // Stop checking at structural elements (headings, lists, blockquotes, code, tables)
    const tag = prev.tagName
    if (/^H[1-6]$/.test(tag)) break
    if (['UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR'].includes(tag)) break
    if (prev.classList.contains('md-codeblock')) break
    if (prev.classList.contains('md-footnote')) break

    // If this is a non-blank paragraph, it's not a direct continuation
    if (tag === 'P' && prev.textContent?.trim()) break

    prev = prev.previousElementSibling
  }
  return false
}

/**
 * Determine if a DOM node is inside an excluded context (code, math, list, quote, table, footnote).
 */
export function isInExcludedContext(node: Node | null): boolean {
  if (!node) return true
  let el: Node | null = node
  while (el) {
    if (!(el instanceof Element)) {
      el = el.parentNode
      continue
    }
    const tag = el.tagName
    if (tag === 'PRE' || tag === 'CODE') return true
    if (tag === 'BLOCKQUOTE') return true
    if (tag === 'LI' || tag === 'UL' || tag === 'OL') return true
    if (tag === 'TABLE' || tag === 'TH' || tag === 'TD') return true
    if (/^H[1-6]$/.test(tag)) return true
    if (el.classList.contains('md-codeblock')) return true
    if (el.classList.contains('md-math-block')) return true
    if (el.classList.contains('md-footnote')) return true
    if (el.closest?.('mjx-container') && !el.closest?.('[display="true"]')) return true
    el = el.parentElement
  }
  return false
}

/**
 * Get the current paragraph element from cursor position.
 */
export function getCurrentParagraphElement(): HTMLParagraphElement | null {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return null

  const node = sel.getRangeAt(0).startContainer
  if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
    return node.parentElement.closest('p')
  }
  if (node instanceof Element) {
    return node.closest('p')
  }
  return null
}

/**
 * Check if the cursor is at the end of its text node content.
 */
export function isCursorAtEnd(): boolean {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return false
  const range = sel.getRangeAt(0)
  if (!range.collapsed) return false
  const node = range.startContainer
  if (node.nodeType === Node.TEXT_NODE) {
    return range.startOffset >= (node.textContent?.length ?? 0)
  }
  // For element nodes, cursor is at end if at the last child
  if (node instanceof Element && node.childNodes.length > 0) {
    return range.startOffset >= node.childNodes.length
  }
  return range.startOffset >= ((node.textContent?.length) ?? 0)
}

/**
 * Check if the current context qualifies for the indent shortcut.
 */
export function canTriggerIndentShortcut(): boolean {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return false
  const node = sel.getRangeAt(0).startContainer
  return !isInExcludedContext(node)
}

/**
 * Check if a paragraph DOM element has the force-indent-2 class applied.
 */
export function hasForceIndentClass(el: HTMLElement): boolean {
  return el.classList.contains(FORCE_INDENT_CLASS)
}

/**
 * Apply text-indent style to a paragraph DOM element.
 */
export function applyParagraphIndent(el: HTMLElement, indentValue: string): void {
  if (indentValue === '2em') {
    el.classList.add(FORCE_INDENT_CLASS)
  } else {
    el.classList.remove(FORCE_INDENT_CLASS)
  }
}

/**
 * Scan editor DOM for all comment nodes with the indent marker,
 * and apply force-indent-2 to the following paragraph.
 * Returns the count of markers found.
 */
export function applyIndentMarkersFromDOM(editorRoot: HTMLElement): number {
  const walker = document.createTreeWalker(
    editorRoot,
    NodeFilter.SHOW_COMMENT,
    { acceptNode: (node) => node.nodeValue?.trim() === INDENT_MARKER_COMMENT ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP },
  )

  let count = 0
  const markerNodes: Comment[] = []
  while (walker.nextNode()) {
    markerNodes.push(walker.currentNode as Comment)
  }

  for (const comment of markerNodes) {
    // Find the next paragraph element after this comment
    let next: Node | null = comment.nextSibling
    while (next) {
      if (next.nodeType === Node.ELEMENT_NODE) {
        const el = next as HTMLElement
        if (el.tagName === 'P') {
          applyParagraphIndent(el, '2em')
          count++
          break
        }
        // Skip non-paragraph elements (headings, lists, etc.)
        if (/^(H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR)$/.test(el.tagName)) break
        if (el.classList.contains('md-codeblock')) break
        if (el.classList.contains('md-math-block')) break
      }
      next = next.nextSibling
    }
  }

  // Also handle markers that are inside paragraph elements (inline comments)
  // After the walker scan, we've applied force-indent to all relevant paragraphs.
  return count
}

/**
 * Apply paragraph indent styles based on settings and markers.
 *
 * For each paragraph element in the editor:
 * 1. If it has a force-indent-2 marker → text-indent: 2em
 * 2. Else if it follows a display math block and flushAfterDisplayMath → text-indent: 0
 * 3. Else → document default (0 or 2em)
 */
export function refreshParagraphIndentStyles(
  editorRoot: HTMLElement,
  settings: ParagraphLayoutSettings,
): void {
  // First, apply force-indent markers from DOM comments
  applyIndentMarkersFromDOM(editorRoot)

  // Then, handle default and formula continuation for non-force-indent paragraphs
  const paragraphs = editorRoot.querySelectorAll<HTMLParagraphElement>('p')

  for (const p of paragraphs) {
    // Skip excluded paragraphs
    if (isInExcludedContext(p)) continue

    // Skip paragraphs that already have force-indent
    if (hasForceIndentClass(p)) continue

    // Skip empty paragraphs
    if (!p.textContent?.trim()) continue

    // Determine indent mode
    let mode: ParagraphIndentMode = settings.defaultIndent
    if (settings.flushAfterDisplayMath && isAfterDisplayMath(p)) {
      mode = 'flush'
    }

    applyParagraphIndent(p, mode === 'indent-2' ? '2em' : '0')
  }
}

/**
 * Build Markdown source with a paragraph indent marker injected.
 *
 * Finds the last occurrence of `..` or `。。` as a standalone paragraph
 * and replaces it with the marker comment + an empty paragraph.
 *
 * @returns The modified Markdown string, or null if no shortcut line found.
 */
export function injectShortcutMarkerInMarkdown(markdown: string): string | null {
  if (!markdown) return null

  // Split into lines for processing
  const lines = markdown.split('\n')

  // Find the last standalone `..` or `。。` paragraph
  let targetLineIdx = -1
  let targetText = ''

  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim()
    if (trimmed === '..' || trimmed === '。。') {
      // Check that it's truly standalone: previous line is blank or start of doc,
      // and following line is blank or end of doc
      const prevBlank = i === 0 || lines[i - 1].trim() === ''
      const nextBlank = i === lines.length - 1 || (i + 1 < lines.length && lines[i + 1].trim() === '')

      if (prevBlank && nextBlank) {
        targetLineIdx = i
        targetText = trimmed
        break
      }
    }
  }

  if (targetLineIdx < 0) return null

  // Replace: `..` or `。。` → marker comment + blank line + empty paragraph
  const before = lines.slice(0, targetLineIdx)
  const after = lines.slice(targetLineIdx + 1)

  const result = [
    ...before,
    INDENT_MARKER_COMMENT,
    '',
    '',  // creates an empty paragraph
    ...after,
  ].join('\n')

  return result
}

/**
 * Position cursor in the first empty paragraph after the last indent marker.
 * Called after reloadContent to restore cursor position.
 */
export function focusNewIndentParagraph(editorRoot: HTMLElement): boolean {
  // Find all marker comment nodes
  const walker = document.createTreeWalker(
    editorRoot,
    NodeFilter.SHOW_COMMENT,
    { acceptNode: (node) => node.nodeValue?.trim() === INDENT_MARKER_COMMENT ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP },
  )

  const markers: Comment[] = []
  while (walker.nextNode()) {
    markers.push(walker.currentNode as Comment)
  }

  if (markers.length === 0) return false

  // Focus the paragraph after the last marker
  const lastMarker = markers[markers.length - 1]
  let next: Node | null = lastMarker.nextSibling
  while (next) {
    if (next.nodeType === Node.ELEMENT_NODE && (next as HTMLElement).tagName === 'P') {
      const p = next as HTMLElement
      const sel = window.getSelection()
      if (!sel) return false
      const range = document.createRange()

      // Try to set cursor at the first text node of the paragraph
      const firstText = findFirstTextNode(p)
      if (firstText) {
        range.setStart(firstText, 0)
      } else {
        range.setStart(p, 0)
      }
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)

      // Also scroll the paragraph into view
      p.scrollIntoView?.({ block: 'nearest' })

      return true
    }
    next = next.nextSibling
  }

  return false
}

function findFirstTextNode(el: Node): Text | null {
  if (el.nodeType === Node.TEXT_NODE) return el as Text
  for (const child of el.childNodes) {
    const found = findFirstTextNode(child)
    if (found) return found
  }
  return null
}

/**
 * Resolve the effective indent for a paragraph element.
 */
export function resolveParagraphElementIndent(
  el: HTMLElement,
  settings: ParagraphLayoutSettings,
): ParagraphIndentMode {
  // Check force-indent marker
  if (hasForceIndentClass(el)) return 'indent-2'

  // Check formula continuation
  if (settings.flushAfterDisplayMath && isAfterDisplayMath(el)) return 'flush'

  return settings.defaultIndent
}
