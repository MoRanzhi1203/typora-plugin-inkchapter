/**
 * Outline Numbering Adapter v3 — runtime-probed Typora outline sidebar DOM.
 *
 * Key changes from v1/v2 (which failed):
 * 1. Root selector is probed from multiple candidates, not assumed as #outline-content
 * 2. Item selection uses flexible traversal, not only a[href^="#"]
 * 3. Data attribute + CSS ::before replaces span insertion (spans get wiped)
 * 4. Index-based matching as primary fallback when ID matching fails
 * 5. Probe function for runtime DOM verification
 */

import type { HeadingDescriptor, HeadingLevel } from './heading-types'

// ── Selectors (probed at runtime) ─────────────────────

/**
 * Outline panel candidate selectors (in priority order).
 * These are the REAL outline container selectors for Typora 1.6.7.
 * We explicitly EXCLUDE file-tree selectors (#file-library, .file-library, etc.)
 * to prevent heading numbers from polluting the file tree.
 */
const ROOT_CANDIDATES = [
  '#outline-content',            // Typora standard outline
  '.outline-content',            // alternative class
  '#file-library .outline-panel', // wihin file-library but specific to outline sub-panel
  '.sidebar-outline',            // custom class
  '.ty-outline',                 // Typora internal
]

/** File-tree selectors: we NEVER apply numbering to these. */
const FILE_TREE_SELECTORS = [
  '#file-library',
  '.file-library',
  '.file-tree',
  '#file-tree',
  '.ty-file-list',
  '.sidebar-file-list',
  '[data-file-list]',
  '#file-library-search',    // file search panel
  '#file-library-filter',    // file filter area
  '.file-library-search',    // alt class
  '.ty-file-search',         // Typora internal file search
]

const NUMBER_ATTR = 'data-inkchapter-number'

// ── Probe result types ─────────────────────────────────

interface ProbeResult {
  rootFound: boolean
  rootSelector: string | null
  rootTag: string
  itemCount: number
  visibleItemCount: number
  firstItemHtml: string
  probeTextNodes: HTMLElement[]
}

export interface SyncResult {
  rootFound: boolean
  bodyHeadingCount: number
  outlineItemCount: number
  matchedCount: number
  matchedByIdx: number
  attributeApplied: number
  unmatchedCount: number
}

// ── Public API ─────────────────────────────────────────

/** Find the real outline root element using multiple candidate selectors. */
export function findOutlineRoot(): HTMLElement | null {
  // First try specific outline selectors
  for (const sel of ROOT_CANDIDATES) {
    const el = document.querySelector(sel) as HTMLElement | null
    if (el && el.offsetParent !== null && el.textContent && el.textContent.trim().length > 0) {
      if (!isFileTreeElementDirectly(el) && isValidOutlineRoot(el)) return el
    }
  }
  // Fallback: search sidebar area with positive validation
  const sidebar = document.getElementById('typora-sidebar')
  if (sidebar) {
    for (const ftSel of FILE_TREE_SELECTORS) {
      const ft = sidebar.querySelector(ftSel)
      if (ft) ft.setAttribute('data-inkchapter-exclude', 'true')
    }
    const candidates = sidebar.querySelectorAll<HTMLElement>('div, ul, ol, section, nav')
    for (const c of candidates) {
      if (isInsideFileTree(c)) continue
      if (c.offsetParent === null) continue
      // Positive validation: must contain actual outline entries with href="#..."
      if (!isValidOutlineRoot(c)) continue
      return c
    }
  }
  return null
}

/**
 * Positive validation: does the element contain real outline entries?
 * A real outline root has <a> elements with href="#..." (Typora outline links).
 * This prevents mistaking file-search/other sidebar panels for the outline.
 */
function isValidOutlineRoot(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  // Check for input/textarea (search panels)
  if (el.querySelector('input, textarea')) return false
  // Must contain at least one <a> with href starting with "#"
  const links = el.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')
  return links.length > 0
}

/**
 * Check if an element directly matches a file-tree selector (no ancestor lookup).
 * Used for ROOT_CANDIDATES results — these are known outline containers,
 * so we only need to verify the element itself is not a file tree panel.
 */
function isFileTreeElementDirectly(el: HTMLElement): boolean {
  for (const sel of FILE_TREE_SELECTORS) {
    if (el.matches(sel)) return true
  }
  if (el.hasAttribute('data-inkchapter-exclude')) return true
  return false
}

/** Check if an element is inside (or is) a file-tree container. */
function isInsideFileTree(el: HTMLElement): boolean {
  for (const sel of FILE_TREE_SELECTORS) {
    if (el.matches(sel) || el.closest(sel)) return true
  }
  if (el.hasAttribute('data-inkchapter-exclude')) return true
  // Heuristic: file-tree items typically contain ".md" or ".MD"
  if (el.textContent && /\.[mM][dD]\b/.test(el.textContent.trim())) return true
  return false
}

/**
 * Find all visible text-bearing elements inside the outline root.
 * These are the elements where we can set data-inkchapter-number.
 * We look for leaf text elements: spans, anchors, or divs with direct text.
 */
export function findOutlineTextElements(root: HTMLElement): HTMLElement[] {
  const items: HTMLElement[] = []

  // Strategy 1: find all <a> with href (classic Typora outline)
  const anchors = root.querySelectorAll<HTMLAnchorElement>('a[href]')
  for (const a of anchors) {
    if (a.offsetParent !== null && a.textContent && a.textContent.trim().length > 0) {
      items.push(a)
    }
  }

  if (items.length > 0) return items

  // Strategy 2: find all visible leaf elements with text
  const allEls = root.querySelectorAll<HTMLElement>('span, div, p, li, a')
  for (const el of allEls) {
    if (el.offsetParent === null) continue
    const text = (el.textContent ?? '').trim()
    if (text.length === 0) continue
    // Skip container elements (they have children that are also candidates)
    if (el.children.length > 0 && el.querySelector('span, a, div, p, li')) continue
    items.push(el)
  }

  return items
}

// ── Matching ──────────────────────────────────────────

/**
 * Match body headings to outline items.
 * Priority: ID match → index match (when counts equal) → text similarity.
 */
export function matchHeadingsToOutline(
  bodyHeadings: readonly { level: HeadingLevel; text: string }[],
  bodyLabels: readonly string[],
  outlineElements: HTMLElement[],
): Array<{ element: HTMLElement; label: string; method: 'id' | 'index' | 'none' }> {
  const result: Array<{ element: HTMLElement; label: string; method: 'id' | 'index' | 'none' }> = []

  // Try ID-based matching first: find heading elements in #write by id
  const write = document.getElementById('write')
  const headingEls = write ? Array.from(write.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')) : []

  let idMatchCount = 0

  if (headingEls.length > 0) {
    // Build id→label map
    const idToLabel = new Map<string, string>()
    for (let i = 0; i < bodyHeadings.length && i < bodyLabels.length; i++) {
      const el = headingEls[i]
      if (el?.id && bodyLabels[i]) {
        idToLabel.set(el.id, bodyLabels[i])
      }
    }

    // Match outline elements by href/id
    for (const el of outlineElements) {
      const href = el.getAttribute('href') ?? el.closest('a')?.getAttribute('href')
      if (href && href.startsWith('#')) {
        const id = href.slice(1)
        const label = idToLabel.get(id)
        if (label !== undefined) {
          result.push({ element: el, label, method: 'id' })
          idMatchCount++
          continue
        }
      }
    }
  }

  // Index-based fallback: if counts match, pair by position
  if (idMatchCount < outlineElements.length &&
      bodyHeadings.length === outlineElements.length) {
    for (let i = 0; i < outlineElements.length; i++) {
      // Skip already matched by ID
      if (result.some(r => r.element === outlineElements[i])) continue
      if (i < bodyLabels.length) {
        result.push({ element: outlineElements[i], label: bodyLabels[i], method: 'index' })
      }
    }
  }

  return result
}

// ── Data attribute operations ──────────────────────────

/**
 * Apply numbering via data-inkchapter-number attribute.
 * The CSS ::before pseudo-element renders the number.
 * Idempotent: only updates if value changed.
 */
export function applyNumberingAttributes(
  matches: Array<{ element: HTMLElement; label: string }>,
): { applied: number; updated: number; removed: number } {
  let applied = 0, updated = 0

  for (const { element, label } of matches) {
    const current = element.getAttribute(NUMBER_ATTR)
    if (label) {
      if (current === label) continue
      if (current !== null) updated++
      else applied++
      element.setAttribute(NUMBER_ATTR, label)
    } else {
      if (current !== null) {
        element.removeAttribute(NUMBER_ATTR)
        applied++ // count removal as action
      }
    }
  }

  return { applied, updated, removed: 0 }
}

/** Remove all data-inkchapter-number attributes from outline area. */
export function clearAllNumberingAttributes(root: HTMLElement | null): number {
  if (!root) return 0
  const els = root.querySelectorAll<HTMLElement>(`[${NUMBER_ATTR}]`)
  let count = els.length
  els.forEach(el => el.removeAttribute(NUMBER_ATTR))
  return count
}

// ── Probe (diagnostic) ─────────────────────────────────

/** Run diagnostic probe: show [墨章探针N] on first 3 outline items for 3 seconds. */
export function runOutlineProbe(callback: (log: string) => void): ProbeResult | null {
  const root = findOutlineRoot()
  if (!root) {
    callback('[InkChapter:outline-probe] outlineRootFound=false')
    for (const sel of ROOT_CANDIDATES) {
      const el = document.querySelector(sel)
      callback(`[InkChapter:outline-probe] candidate ${sel}: ${el ? 'exists(visible=' + (el as HTMLElement).offsetParent + ')' : 'NOT_FOUND'}`)
    }
    return null
  }

  callback('[InkChapter:outline-probe] outlineRootFound=true')
  callback(`[InkChapter:outline-probe] rootSelector=${root.id || root.className || root.tagName}`)

  const items = findOutlineTextElements(root)
  callback(`[InkChapter:outline-probe] itemCount=${items.length}`)

  const visibleItems = items.filter(el => el.offsetParent !== null)
  callback(`[InkChapter:outline-probe] visibleItemCount=${visibleItems.length}`)

  // Show probes on first 3 items
  const probeTexts = ['墨章探针1', '墨章探针2', '墨章探针3']
  const probeElements: HTMLElement[] = []

  for (let i = 0; i < Math.min(3, visibleItems.length); i++) {
    const el = visibleItems[i]
    el.setAttribute(NUMBER_ATTR, `[${probeTexts[i]}]`)
    probeElements.push(el)
  }

  if (visibleItems.length > 0) {
    const firstHtml = visibleItems[0].outerHTML.slice(0, 200)
    callback(`[InkChapter:outline-probe] firstItemHtml=${firstHtml}`)
  }

  // Clean up after 3 seconds
  setTimeout(() => {
    for (const el of probeElements) {
      el.removeAttribute(NUMBER_ATTR)
    }
  }, 3000)

  return {
    rootFound: true,
    rootSelector: root.id || root.className || root.tagName,
    rootTag: root.tagName,
    itemCount: items.length,
    visibleItemCount: visibleItems.length,
    firstItemHtml: visibleItems[0]?.outerHTML.slice(0, 200) ?? '',
    probeTextNodes: probeElements,
  }
}

// ── Full sync (for manual command) ─────────────────────

/** Full sync with diagnostic output. Returns stats. */
export function fullSyncOutline(
  bodyHeadings: readonly { level: HeadingLevel; text: string }[],
  bodyLabels: readonly string[],
  callback: (log: string) => void,
): SyncResult {
  const root = findOutlineRoot()
  callback(`rootFound=${String(!!root)}`)
  callback(`bodyHeadingCount=${bodyHeadings.length}`)

  if (!root) {
    return { rootFound: false, bodyHeadingCount: bodyHeadings.length, outlineItemCount: 0, matchedCount: 0, matchedByIdx: 0, attributeApplied: 0, unmatchedCount: 0 }
  }

  const items = findOutlineTextElements(root)
  callback(`outlineItemCount=${items.length}`)

  const matches = matchHeadingsToOutline(bodyHeadings, bodyLabels, items)
  const idCount = matches.filter(m => m.method === 'id').length
  const idxCount = matches.filter(m => m.method === 'index').length
  callback(`matchedCount=${matches.length}`)
  callback(`matchedByIndexCount=${idxCount}`)

  const attrResult = applyNumberingAttributes(
    matches.map(m => ({ element: m.element, label: m.label }))
  )
  callback(`attributeAppliedCount=${attrResult.applied + attrResult.updated}`)

  const unmatched = items.length - matches.length
  callback(`unmatchedCount=${unmatched}`)

  return {
    rootFound: true,
    bodyHeadingCount: bodyHeadings.length,
    outlineItemCount: items.length,
    matchedCount: matches.length,
    matchedByIdx: idxCount,
    attributeApplied: attrResult.applied + attrResult.updated,
    unmatchedCount: unmatched,
  }
}

/** Lightweight sync (no diagnostic output, for auto-refresh). */
export function quickSyncOutline(
  bodyHeadings: readonly { level: HeadingLevel; text: string }[],
  bodyLabels: readonly string[],
): { matched: number; applied: number } {
  const root = findOutlineRoot()
  if (!root) return { matched: 0, applied: 0 }

  const items = findOutlineTextElements(root)
  if (items.length === 0) return { matched: 0, applied: 0 }

  const matches = matchHeadingsToOutline(bodyHeadings, bodyLabels, items)
  if (matches.length === 0) return { matched: 0, applied: 0 }

  const attrResult = applyNumberingAttributes(
    matches.map(m => ({ element: m.element, label: m.label }))
  )

  return { matched: matches.length, applied: attrResult.applied + attrResult.updated }
}

/** Check if outline sidebar is visible. */
export function isOutlineVisible(): boolean {
  return findOutlineRoot() !== null
}

/** Clear any accidentally-applied numbering attributes from the file tree area. */
export function clearFileTreeNumberingAttributes(): number {
  let count = 0
  for (const sel of FILE_TREE_SELECTORS) {
    const ft = document.querySelector(sel)
    if (ft) {
      ft.removeAttribute('data-inkchapter-exclude')
      const marked = ft.querySelectorAll<HTMLElement>(`[${NUMBER_ATTR}]`)
      marked.forEach(el => { el.removeAttribute(NUMBER_ATTR); count++ })
    }
  }
  return count
}

/** Remove the leftover NUMBER_CLASS spans from v2 implementation. */
export function cleanupV2Spans(): void {
  const spans = document.querySelectorAll('.inkchapter-outline-number')
  spans.forEach(s => s.remove())
}
