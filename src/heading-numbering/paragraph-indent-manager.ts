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
 * Build Markdown source with a canonical paragraph indent marker.
 *
 * CANONICAL FORMAT (the only acceptable serialization):
 * ```
 * <!-- inkchapter:paragraph-indent=2 -->
 *
 * target paragraph content
 * ```
 *
 * That is: MARKER on its own line, then a BLANK LINE, then TARGET PARAGRAPH.
 *
 * FORBIDDEN formats (must never be generated):
 * - `<!-- inkchapter:paragraph-indent=2 -->target text`  (same line)
 * - `<!-- inkchapter:paragraph-indent=2 -->\ntarget text` (no blank line)
 *
 * The function replaces the command line (".." or "。。") with a canonical
 * marker block. The target paragraph (the blank line Typora creates after
 * Enter) is preserved as-is.
 *
 * @returns The modified Markdown string, or null if no command found.
 */
export function injectShortcutMarkerInMarkdown(markdown: string): string | null {
  if (!markdown) return null

  const lines = markdown.split('\n')

  // Find the paragraph that is exactly a command token (search from end)
  let targetLineIdx = -1
  let foundToken: IndentCommandToken = null

  for (let i = lines.length - 1; i >= 0; i--) {
    const token = recognizeParagraphIndentCommand(lines[i])
    if (token) {
      const prevBlank = i === 0 || lines[i - 1].trim() === ''
      const nextBlank = i === lines.length - 1 || (i + 1 < lines.length && lines[i + 1].trim() === '')
      if (prevBlank && nextBlank) {
        targetLineIdx = i
        foundToken = token
        break
      }
    }
  }

  if (targetLineIdx < 0) return null

  // Collect the lines before the command
  const before = lines.slice(0, targetLineIdx)

  // After the command line: Typora creates a blank line then the target paragraph
  // (which is the new empty paragraph created by Enter).
  // Structure: [command line] [blank/empty line: target paragraph] [rest]
  const after = lines.slice(targetLineIdx + 1)

  // Build canonical output: marker + blank + target paragraph + rest
  const result = [
    ...before,
    INDENT_MARKER_COMMENT,   // canonical marker on its own line
    '',                       // blank line separator
    ...after,                 // target paragraph + rest of document
  ].join('\n')

  return result
}

/**
 * Canonicalize all paragraph indent markers in a Markdown string.
 *
 * This is a safe, idempotent operation that fixes:
 * - **Same-line markers**: `<!-- inkchapter:paragraph-indent=2 -->text` → canonical
 * - **Missing blank line**: marker followed immediately by paragraph → canonical
 * - **Duplicate markers**: consecutive markers → single marker
 * - **Orphan markers**: marker at EOF with no target → removed
 *
 * Normal (non-indent) HTML comments are NEVER modified.
 *
 * @returns The canonicalized Markdown string.
 */
export function canonicalizeParagraphIndentMarkers(markdown: string): string {
  if (!markdown) return markdown

  const lines = markdown.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Check if this line contains (or is) an indent marker
    const markerMatch = trimmed.match(/^<!--\s*inkchapter:paragraph-indent=2\s*-->/)

    if (markerMatch) {
      // Extract any text after the marker on the same line (broken same-line format)
      const afterMarker = trimmed.slice(markerMatch[0].length).trim()

      // Skip this line in output — we'll emit canonical marker
      i++

      // Count consecutive duplicate markers
      while (i < lines.length) {
        const nextTrim = lines[i].trim()
        if (nextTrim === INDENT_MARKER_COMMENT) {
          i++ // skip duplicate
        } else {
          break
        }
      }

      // Check for orphan: marker at EOF with no target
      if (i >= lines.length) {
        if (afterMarker) {
          // Same-line marker with text but at EOF — keep the text as a paragraph
          result.push(INDENT_MARKER_COMMENT)
          result.push('')
          result.push(afterMarker)
        }
        // Else: orphan marker, skip it entirely
        continue
      }

      // Skip blank lines between marker and target
      while (i < lines.length && lines[i].trim() === '') {
        i++
      }

      // Now emit canonical marker + blank + content
      result.push(INDENT_MARKER_COMMENT)
      result.push('')

      if (afterMarker) {
        // Same-line marker: the text after marker is the target paragraph
        result.push(afterMarker)
      }
      // else: the next content line(s) are the target paragraph
      // They will be consumed by the normal loop below (we already skipped blanks)

      continue
    }

    // Normal line — pass through unchanged
    result.push(line)
    i++
  }

  return result.join('\n')
}

/**
 * Focus the paragraph after a specific marker index.
 *
 * Index 0 = first marker, 1 = second, etc.
 * This is the target identity recovery mechanism — it does NOT use
 * "last marker" as the sole recovery algorithm.
 */
export function focusParagraphAfterMarkerIndex(editorRoot: HTMLElement, markerIndex: number): boolean {
  const markers = collectIndentMarkers(editorRoot)
  if (markerIndex < 0 || markerIndex >= markers.length) return false

  const marker = markers[markerIndex]
  const p = findNextParagraphAfter(marker)
  if (!p) return false

  const sel = window.getSelection()
  if (!sel) return false
  const range = document.createRange()
  const firstText = findFirstTextNode(p)
  if (firstText) {
    range.setStart(firstText, 0)
  } else {
    range.setStart(p, 0)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  p.scrollIntoView?.({ block: 'nearest' })
  return true
}

/**
 * Apply force-indent to the paragraph after a specific marker index.
 * Returns true if applied successfully.
 */
export function applyIndentByMarkerIndex(editorRoot: HTMLElement, markerIndex: number): boolean {
  const markers = collectIndentMarkers(editorRoot)
  if (markerIndex < 0 || markerIndex >= markers.length) return false

  const marker = markers[markerIndex]
  const p = findNextParagraphAfter(marker)
  if (!p) return false

  applyParagraphIndent(p, '2em')
  return true
}

function collectIndentMarkers(editorRoot: HTMLElement): Comment[] {
  const walker = document.createTreeWalker(
    editorRoot,
    NodeFilter.SHOW_COMMENT,
    { acceptNode: (node) => node.nodeValue?.trim() === PARAGRAPH_INDENT_MARKER ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP },
  )
  const markers: Comment[] = []
  while (walker.nextNode()) {
    markers.push(walker.currentNode as Comment)
  }
  return markers
}

function findNextParagraphAfter(comment: Comment): HTMLElement | null {
  let next: Node | null = comment.nextSibling
  while (next) {
    if (next.nodeType === Node.ELEMENT_NODE) {
      const el = next as HTMLElement
      if (el.tagName === 'P') return el
      if (/^(H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR)$/.test(el.tagName)) return null
      if (el.classList.contains('md-codeblock')) return null
      if (el.classList.contains('md-math-block')) return null
    }
    next = next.nextSibling
  }
  return null
}

/**
 * Position cursor in the first empty paragraph after the LAST indent marker.
 * @deprecated Prefer `focusParagraphAfterMarkerIndex` for target-specific recovery.
 */
export function focusNewIndentParagraph(editorRoot: HTMLElement): boolean {
  const markers = collectIndentMarkers(editorRoot)
  if (markers.length === 0) return false
  return focusParagraphAfterMarkerIndex(editorRoot, markers.length - 1)
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
 * Recognizer: check if text is an indent shortcut command token.
 * Only exact matches — ".." or "。。" — trigger. No prefix/suffix variants.
 */
export type IndentCommandToken = '..' | '。。' | null

export function recognizeParagraphIndentCommand(text: string): IndentCommandToken {
  const trimmed = text.trim()
  if (trimmed === '..') return '..'
  if (trimmed === '。。') return '。。'
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

// ── Unified Semantic Paragraph Indent Setter ─────────────────────────────

/** Data attribute storing the semantic indent mode. */
export const INDENT_MODE_ATTR = 'data-inkchapter-indent-mode'

/** Semantic indent mode for a paragraph block. */
export type ParagraphIndentSemanticMode = 'auto' | 'force-indent' | 'force-flush'

/**
 * Unified semantic entry point: set the indent mode for a paragraph.
 *
 * This is the single place where force-indent / force-flush / auto state
 * is written to the DOM.  All consumers (shortcut probe, formula continuation,
 * future context-menu) MUST go through this function.
 *
 * The layout resolver (`refreshParagraphIndentStyles`) reads this state
 * and produces the final CSS class / attribute / render output.
 *
 * Rendering chain:
 *   semantic = force-indent
 *   → setParagraphIndentMode(block, 'force-indent')
 *   → FORCE_INDENT_CLASS + data-inkchapter-indent-mode="force-indent"
 *   → refreshParagraphIndentStyles skips (already marked)
 *   → CSS: .inkchapter-paragraph-indent-2 { text-indent: 2em }
 */
export function setParagraphIndentMode(
  paragraph: HTMLElement,
  mode: ParagraphIndentSemanticMode,
): void {
  // Clear previous state
  paragraph.classList.remove(FORCE_INDENT_CLASS)
  paragraph.removeAttribute(INDENT_MODE_ATTR)

  if (mode === 'force-indent') {
    paragraph.classList.add(FORCE_INDENT_CLASS)
    paragraph.setAttribute(INDENT_MODE_ATTR, 'force-indent')
  } else if (mode === 'force-flush') {
    paragraph.setAttribute(INDENT_MODE_ATTR, 'force-flush')
    paragraph.style.textIndent = '0'
  }
  // 'auto': no explicit state (falls through to default / formula rules)
}

/**
 * Get the current semantic indent mode from a paragraph element.
 */
export function getParagraphIndentMode(el: HTMLElement): ParagraphIndentSemanticMode {
  if (el.classList.contains(FORCE_INDENT_CLASS)) return 'force-indent'
  const attr = el.getAttribute(INDENT_MODE_ATTR)
  if (attr === 'force-flush') return 'force-flush'
  return 'auto'
}

// ── Block Resolvers (selection-based, no full-scan) ──────────────────────

/** Tags that represent content blocks in Typora's editor DOM. */
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE'])

/**
 * Resolve the current content block element from the browser selection.
 *
 * Starts at `selection.anchorNode` and walks up to the nearest block-level
 * element inside `editorRoot`.  Does **not** assume the block is a `<p>`.
 *
 * @returns The block element, or null if no valid block is found.
 */
export function resolveCurrentBlockFromSelection(
  editorRoot: HTMLElement,
): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return null

  let node: Node | null = sel.getRangeAt(0).startContainer
  while (node && node !== editorRoot) {
    if (node instanceof HTMLElement && BLOCK_TAGS.has(node.tagName)) {
      // Verify it's inside editorRoot (not sidebar, settings, etc.)
      if (editorRoot.contains(node)) return node
    }
    node = node.parentNode
  }
  return null
}

/**
 * Resolve the previous content block sibling of `currentBlock`.
 *
 * Walks `previousElementSibling` until a block-level element is found,
 * skipping blank/interstitial elements (e.g. empty spans, line markers).
 *
 * @returns The previous block element, or null if none exists.
 */
export function resolvePreviousBlock(
  currentBlock: HTMLElement,
  editorRoot: HTMLElement,
): HTMLElement | null {
  let prev = currentBlock.previousElementSibling
  while (prev) {
    if (!editorRoot.contains(prev)) return null

    if (prev instanceof HTMLElement && BLOCK_TAGS.has(prev.tagName)) {
      return prev
    }

    // Skip interstitial elements: empty spans, comment nodes, br-only, etc.
    const tag = prev.tagName
    if (tag === 'BR' || tag === 'HR' || tag === 'SCRIPT' || tag === 'STYLE') {
      prev = prev.previousElementSibling
      continue
    }

    // If it's a non-block element with no text content, skip
    if (!BLOCK_TAGS.has(tag) && !prev.textContent?.trim()) {
      prev = prev.previousElementSibling
      continue
    }

    // Any other element — stop to avoid crossing structural boundaries
    break
  }
  return null
}

/**
 * Check if an element is a regular content block (paragraph-like).
 * Excludes headings, list items, code blocks, blockquotes, tables.
 */
export function isContentBlock(el: HTMLElement): boolean {
  const tag = el.tagName
  if (tag === 'P') return true
  // Exclude non-paragraph blocks
  if (/^H[1-6]$/.test(tag)) return false
  if (tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'PRE' || tag === 'TABLE') return false
  return false
}

// ── Runtime Block Probe (development diagnostic) ─────────────────────────

let blockProbeFired = false

/**
 * Development-only runtime block probe.
 *
 * Outputs the real DOM structure around the current selection to the console
 * (and optionally to a diagnostic file) so we can verify:
 * - selection.anchorNode type and position
 * - current block tag, class, attributes, outerHTML summary
 * - previous block structure
 * - parent chain
 */
export function writeBlockProbeDiagnostic(
  editorRoot: HTMLElement,
  reason: string,
  writeFile?: (filename: string, data: string) => void,
): void {
  // Fire only once per session to avoid log spam
  if (blockProbeFired) return
  blockProbeFired = true

  const sel = window.getSelection()
  const lines: string[] = [
    `=== InkChapter Runtime Block Probe ===`,
    `Refresh reason: ${reason}`,
    `Editor root: ${editorRoot.id || editorRoot.tagName} (${editorRoot.className?.slice(0, 80) || 'no class'})`,
    ``,
  ]

  if (sel?.rangeCount) {
    const anchorNode = sel.getRangeAt(0).startContainer
    lines.push(`-- Selection --`)
    lines.push(`anchorNode: ${anchorNode.nodeName} (type=${anchorNode.nodeType})`)
    if (anchorNode.nodeType === Node.TEXT_NODE) {
      lines.push(`anchorOffset: ${sel.getRangeAt(0).startOffset}`)
      lines.push(`textContent (first 40): "${anchorNode.textContent?.slice(0, 40)}"`)
    }
    lines.push(`anchorNode parent: ${anchorNode.parentElement?.tagName || 'null'}`)
    lines.push(``)
  } else {
    lines.push(`-- Selection: none --`)
    lines.push(``)
  }

  const currentBlock = resolveCurrentBlockFromSelection(editorRoot)
  if (currentBlock) {
    lines.push(`-- Current Block (B) --`)
    lines.push(`tag: ${currentBlock.tagName}`)
    lines.push(`class: ${currentBlock.className?.slice(0, 120) || '(none)'}`)
    lines.push(`id: ${currentBlock.id || '(none)'}`)
    const attrs: string[] = []
    for (const a of currentBlock.attributes) {
      if (a.name !== 'class' && a.name !== 'id') {
        attrs.push(`${a.name}="${a.value}"`)
      }
    }
    lines.push(`attrs: ${attrs.join(' ') || '(none)'}`)
    lines.push(`textContent (first 60): "${currentBlock.textContent?.slice(0, 60)}"`)
    lines.push(`outerHTML (first 200): ${(currentBlock.outerHTML ?? '').slice(0, 200)}`)

    const prevBlock = resolvePreviousBlock(currentBlock, editorRoot)
    if (prevBlock) {
      lines.push(``)
      lines.push(`-- Previous Block (A) --`)
      lines.push(`tag: ${prevBlock.tagName}`)
      lines.push(`class: ${prevBlock.className?.slice(0, 120) || '(none)'}`)
      lines.push(`textContent: "${prevBlock.textContent?.slice(0, 60)}"`)
      lines.push(`outerHTML (first 200): ${(prevBlock.outerHTML ?? '').slice(0, 200)}`)
    } else {
      lines.push(`-- Previous Block: null --`)
    }
  } else {
    lines.push(`-- Current Block: null (Branch B: selection→block resolver failed) --`)
  }

  // Parent chain from anchorNode
  if (sel?.rangeCount) {
    lines.push(``)
    lines.push(`-- Parent Chain --`)
    let n: Node | null = sel.getRangeAt(0).startContainer
    while (n) {
      const tag = n instanceof Element ? n.tagName : n.nodeName
      const cls = n instanceof Element ? (n.className?.slice(0, 60) || '') : ''
      const id = n instanceof Element && n.id ? ` id=${n.id}` : ''
      lines.push(`  ${tag}${id}${cls ? ` .${cls}` : ''}`)
      if (n === editorRoot) break
      n = n.parentNode
    }
  }

  const output = lines.join('\n')
  console.info(output)

  if (writeFile) {
    try {
      writeFile('inkchapter-block-probe.txt', output)
    } catch { /* ignore */ }
  }
}

// ── Inline Paragraph Command Probe (corrected semantics) ─────────────────

/** Result of a successful inline command probe (same-paragraph model). */
export interface InlineCommandResult {
  /** The command paragraph — this IS the force-indent target. */
  currentBlock: HTMLElement
  /** The command token that was recognized. */
  token: '..' | '。。'
}

/**
 * Dedupe guard: prevent same command paragraph from being processed twice.
 */
const processedCommands = new Set<HTMLElement>()

/**
 * Probe current selection for an inline paragraph indent command.
 *
 * CORRECTED SEMANTICS (R35): Enter is a command SUBMIT, not a paragraph break.
 * The command paragraph A IS the force-indent target.
 * There is NO next paragraph B.
 *
 * Conditions (all must be true):
 * 1. indentShortcutEnabled is true
 * 2. Current block resolved from selection is a content block
 * 3. Current block NOT in excluded context
 * 4. Current block textContent (trimmed) is exactly ".." or "。。"
 * 5. Cursor is inside the current block
 * 6. (Optional) hasParagraphCommandMutation flag for mutex
 *
 * @returns InlineCommandResult if a command is detected, null otherwise.
 */
export function probeInlineParagraphCommand(
  editorRoot: HTMLElement,
  settings: { indentShortcutEnabled: boolean },
): InlineCommandResult | null {
  if (!settings.indentShortcutEnabled) return null

  const currentBlock = resolveCurrentBlockFromSelection(editorRoot)
  if (!currentBlock) return null
  if (!isContentBlock(currentBlock)) return null
  if (isInExcludedContext(currentBlock)) return null

  const text = (currentBlock.textContent ?? '').trim()
  const token = recognizeParagraphIndentCommand(text)
  if (!token) return null

  // Cursor must be in the command block
  const sel = window.getSelection()
  if (sel?.rangeCount) {
    const selNode = sel.getRangeAt(0).startContainer
    if (!currentBlock.contains(selNode)) return null
  }

  // Dedupe
  if (processedCommands.has(currentBlock)) return null
  processedCommands.add(currentBlock)

  return { currentBlock, token }
}

/**
 * Reset the block probe diagnostic flag (for testing).
 */
export function resetBlockProbeDiagnostic(): void {
  blockProbeFired = false
}

/**
 * Clear dedupe guards (for testing).
 */
export function resetProcessedPairs(): void {
  processedCommands.clear()
}

// ── Mutation Classifier (used by main MutationObserver) ──────────────────

/** Maximum added+removed nodes to consider a "small-scale" structural edit. */
const SMALL_MUTATION_THRESHOLD = 10

/** Result of classifying editor mutations. */
export interface MutationClassification {
  /** A heading was added, removed, or its text changed. */
  headingMutation: boolean
  /** A small-scale paragraph-level childList mutation occurred (potential shortcut). */
  paragraphCommandCandidate: boolean
  /** The mutation batch is too large to be a user keystroke (paste, load, rerender). */
  largeBatch: boolean
}

/**
 * Classify a batch of MutationRecords from the main editor MutationObserver.
 *
 * This does NOT scan the full document — it only inspects the mutation records
 * themselves to determine if they represent:
 * - heading structural change (→ 'editor-mutation')
 * - small paragraph childList change (→ 'paragraph-command-mutation' candidate)
 * - large batch (paste/document load → no shortcut candidate)
 */
export function classifyEditorMutation(
  mutations: MutationRecord[],
  root: HTMLElement,
  options?: { suppressParagraphDetection?: boolean },
): MutationClassification {
  let headingMutation = false
  let paragraphCommandCandidate = false
  let largeBatch = false

  let totalAdded = 0
  let totalRemoved = 0

  for (const m of mutations) {
    totalAdded += m.addedNodes.length
    totalRemoved += m.removedNodes.length

    // ── Heading check ──
    if (!headingMutation) {
      // Check added/removed for heading elements
      for (let i = 0; i < m.addedNodes.length; i++) {
        const node = m.addedNodes[i]
        if (node instanceof HTMLElement && isHeadingOrContainsHeading(node)) {
          headingMutation = true
        }
      }
      for (let i = 0; i < m.removedNodes.length; i++) {
        const node = m.removedNodes[i]
        if (node instanceof HTMLElement && isHeadingOrContainsHeading(node)) {
          headingMutation = true
        }
      }
      // characterData on heading ancestors
      if (m.type === 'characterData' && m.target.parentElement) {
        const ancestor = m.target.parentElement.closest('h1, h2, h3, h4, h5, h6')
        if (ancestor && root.contains(ancestor)) {
          headingMutation = true
        }
      }
    }

    // ── Paragraph structural candidate ──
    if (!paragraphCommandCandidate && !options?.suppressParagraphDetection) {
      // Only childList mutations matter for paragraph structural changes
      if (m.type === 'childList') {
        // Mutation target must be in editor root
        if (root.contains(m.target as Node)) {
          // Check if any added/removed node relates to content blocks
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i]
            if (node instanceof HTMLElement) {
              const tag = node.tagName
              if (tag === 'P' || BLOCK_TAGS.has(tag)) {
                paragraphCommandCandidate = true
                break
              }
            }
          }
          if (!paragraphCommandCandidate) {
            for (let i = 0; i < m.removedNodes.length; i++) {
              const node = m.removedNodes[i]
              if (node instanceof HTMLElement) {
                const tag = node.tagName
                if (tag === 'P' || BLOCK_TAGS.has(tag)) {
                  paragraphCommandCandidate = true
                  break
                }
              }
            }
          }
        }
      }
    }
  }

  // Large batch: paste, document load, rerender, plugin-authored reload
  largeBatch = (totalAdded + totalRemoved) > SMALL_MUTATION_THRESHOLD

  // Large batches invalidate paragraph command candidate
  if (largeBatch) {
    paragraphCommandCandidate = false
  }

  return { headingMutation, paragraphCommandCandidate, largeBatch }
}

/** Helper: check if element is or contains a heading. (Exported for classifier.) */
function isHeadingOrContainsHeading(el: HTMLElement): boolean {
  const tag = el.tagName
  if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
    return true
  }
  return el.querySelector('h1, h2, h3, h4, h5, h6') !== null
}
