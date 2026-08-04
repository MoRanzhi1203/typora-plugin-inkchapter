/**
 * Outline Numbering Adapter v5 — relaxed root detection for hidden panels.
 *
 * Key changes from v4:
 * 1. findOutlineRootRelaxed() — skips offsetParent checks for hidden panels
 * 2. findOutlineTextElementsRelaxed() — finds items even when panel is hidden
 * 3. findOutlineRoot() and findOutlineRootRelaxed() share core logic
 * 4. Event chain logging with structured event records
 * 5. outlineRootSelector tracking for diagnostics
 */

import type { HeadingDescriptor, HeadingLevel } from './heading-types'

// ── Selectors ─────────────────────────────────────────

const ROOT_CANDIDATES = [
  '#outline-content',
  '.outline-content',
  '.outline-panel',
  '.sidebar-outline',
  '.ty-outline',
  '[data-outline]',
]

/** File-tree panel selectors: these are siblings of the outline panel, not ancestors. */
const FILE_TREE_PANEL_SELECTORS = [
  '#file-library',
  '.file-library',
  '.file-tree',
  '#file-tree',
  '.ty-file-list',
  '.sidebar-file-list',
]

/** Search / footer / toolbar selectors: NEVER outline containers. */
const NON_OUTLINE_SELECTORS = [
  '#file-library-search',
  '#file-library-filter',
  '.file-library-search',
  '.ty-file-search',
  '#ty-sidebar-footer',
  '.sidebar-footer',
  '#sidebar-menu-btn',
  '.sidebar-footer-main-item',
  '[data-action]',
  'input',
  'textarea',
]

const NUMBER_ATTR = 'data-inkchapter-number'

/** Set to false to silence outline debug logs in production. */
const OUTLINE_DEBUG = false
const LOG = (...args: unknown[]) => { if (OUTLINE_DEBUG) console.log(...args) }

// ── Types ─────────────────────────────────────────────

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

// ── DOM helpers ───────────────────────────────────────

function elTag(el: HTMLElement): string {
  return el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.split(' ').slice(0, 2).join('.') : '')
}

/** Check if element is inside (or is) a non-outline panel (footer, search, file-tree panel). */
function isInsideExcludedPanel(el: HTMLElement): boolean {
  // Direct match or ancestor match for file-tree panels
  for (const sel of FILE_TREE_PANEL_SELECTORS) {
    if (el.matches(sel) || el.closest(sel)) return true
  }
  // Direct match or ancestor match for non-outline elements
  for (const sel of NON_OUTLINE_SELECTORS) {
    if (el.matches(sel) || el.closest(sel)) return true
  }
  return false
}

/** Check if element directly matches a non-outline selector. */
function isNonOutlineDirectly(el: HTMLElement): boolean {
  for (const sel of NON_OUTLINE_SELECTORS) {
    if (el.matches(sel)) return true
  }
  for (const sel of FILE_TREE_PANEL_SELECTORS) {
    if (el.matches(sel)) return true
  }
  return false
}

/** Get ancestor chain from element up to #typora-sidebar (or root). */
function getAncestorChain(el: HTMLElement): string[] {
  const chain: string[] = []
  let cur: HTMLElement | null = el
  while (cur) {
    chain.push(elTag(cur))
    if (cur.id === 'typora-sidebar' || cur === document.body) break
    cur = cur.parentElement
  }
  return chain
}

// ── Heading text matching ─────────────────────────────

/** Collect current body heading texts for outline candidate validation. */
function getBodyHeadingTexts(): Set<string> {
  const write = document.getElementById('write')
  if (!write) return new Set()
  const headings = write.querySelectorAll('h1, h2, h3, h4, h5, h6')
  const texts = new Set<string>()
  headings.forEach(h => {
    const t = (h.textContent ?? '').trim()
    if (t) texts.add(t)
  })
  return texts
}

/** Count how many body heading texts appear inside a container element. */
function countHeadingTextHits(el: HTMLElement, bodyTexts: Set<string>): number {
  let count = 0
  for (const t of bodyTexts) {
    if (el.textContent && el.textContent.includes(t)) count++
  }
  return count
}

// ── Public API ────────────────────────────────────────

/**
 * Comprehensive DOM diagnostic dump.
 * Logs ALL sidebar containers to console, showing which pass/fail each check.
 */
export function dumpOutlineDOM(): void {
  const bodyTexts = getBodyHeadingTexts()
  console.group('[InkChapter OUTLINE] === DOM Diagnostic Dump ===')
  console.log(`Body heading texts (${bodyTexts.size}):`, [...bodyTexts].slice(0, 20).join(', '))

  // 1. Check ROOT_CANDIDATES
  console.log('--- ROOT_CANDIDATES ---')
  for (const sel of ROOT_CANDIDATES) {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) { console.log(`  ${sel}: NOT_FOUND`); continue }
    const opOk = el.offsetParent !== null
    const txtOk = el.textContent && el.textContent.trim().length > 0
    const nonOut = isNonOutlineDirectly(el)
    const insideEx = isInsideExcludedPanel(el)
    const hits = countHeadingTextHits(el, bodyTexts)
    const anchorCount = el.querySelectorAll('a[href^="#"]').length
    console.log(`  ${sel}: tag=${el.tagName} id=${el.id||'?'} class="${el.className}" offsetParent=${opOk} textLen=${el.textContent?.trim().length??0} nonOutline=${nonOut} insideExcluded=${insideEx} headingHits=${hits} anchorLinks=${anchorCount}`)
  }

  // 2. Find outline items by heading text
  console.log('--- Finding outline items by heading text ---')
  const sidebar = document.getElementById('typora-sidebar') || document.querySelector('.typora-sidebar')
  if (sidebar) {
    // Try to find elements whose textContent matches known heading texts
    const allLeafish = sidebar.querySelectorAll<HTMLElement>('div, span, li, a, p')
    const headingMatches: Array<{ el: HTMLElement; text: string; tag: string; ancestors: string[] }> = []
    for (const el of allLeafish) {
      if (el.offsetParent === null) continue
      const text = (el.textContent ?? '').trim()
      if (!text) continue
      // Check if this element's direct text matches a heading (not just contains it in a child)
      const directText = getDirectText(el).trim()
      if (bodyTexts.has(text) || bodyTexts.has(directText)) {
        headingMatches.push({
          el,
          text: text.slice(0, 60),
          tag: elTag(el),
          ancestors: getAncestorChain(el).slice(1, 6), // skip self, show 5 ancestors
        })
      }
    }
    console.log(`  Found ${headingMatches.length} elements matching heading texts:`)
    for (const m of headingMatches.slice(0, 30)) {
      console.log(`    [${m.tag}] "${m.text}" ancestors: ${m.ancestors.join(' > ')}`)
    }

    // 3. Find common ancestor of heading-matching elements
    if (headingMatches.length >= 2) {
      const ancestors = headingMatches.map(m => new Set(getAncestorChain(m.el)))
      const common = [...ancestors[0]].filter(a => ancestors.every(s => s.has(a)))
      console.log(`  Common ancestors (${common.length}):`, common.join(' > '))

      // The deepest common ancestor is the most likely outline root
      const lca = common[common.length - 1] // deepest = first in chain (closest to items)
      if (lca) {
        const lcaEl = document.getElementById(lca.replace(/.*#/, '').replace(/\..*/, '')) ||
                       sidebar.querySelector('.' + lca.replace(/.*\./, '').split('.')[0]) as HTMLElement
        console.log(`  Deepest common ancestor (likely outline root): ${lca}`)
      }
    }
  }

  // 4. Full sidebar scan: show ALL candidate containers
  console.log('--- Full sidebar scan (all div/ul/ol/section/nav) ---')
  if (sidebar) {
    const allDivs = sidebar.querySelectorAll<HTMLElement>('div, ul, ol, section, nav')
    const candidates: Array<{ tag: string; hits: number; anchors: number; offsetOk: boolean; insideEx: boolean; nonOut: boolean; childCount: number; textLen: number }> = []
    for (const c of allDivs) {
      if (c.offsetParent === null && c.tagName !== 'DIV') continue // skip hidden non-divs
      const hits = countHeadingTextHits(c, bodyTexts)
      const anchors = c.querySelectorAll('a[href^="#"]').length
      const insideEx = isInsideExcludedPanel(c)
      const nonOut = isNonOutlineDirectly(c)
      candidates.push({
        tag: elTag(c),
        hits,
        anchors,
        offsetOk: c.offsetParent !== null,
        insideEx,
        nonOut,
        childCount: c.children.length,
        textLen: (c.textContent ?? '').trim().length,
      })
    }
    // Sort by heading hits descending
    candidates.sort((a, b) => b.hits - a.hits)
    for (const c of candidates.slice(0, 20)) {
      const status = c.insideEx ? 'EXCLUDED' : c.nonOut ? 'NON-OUTLINE' : c.hits >= 2 ? 'CANDIDATE' : 'low-hits'
      console.log(`  [${status}] ${c.tag} headingHits=${c.hits} anchors=${c.anchors} offsetOk=${c.offsetOk} children=${c.childCount} textLen=${c.textLen}`)
    }
  }

  // 5. Dump outline tab button
  console.log('--- Outline tab button ---')
  const tabBtns = document.querySelectorAll('[data-action], [data-type], .typora-sidebar-tabs *, .sidebar-tabs *')
  for (const t of Array.from(tabBtns).slice(0, 6)) {
    const el = t as HTMLElement
    if (el.offsetParent === null) continue
    console.log(`  ${el.tagName}#${el.id||'?'} class="${el.className}" data-action="${el.getAttribute('data-action')||''}" data-type="${el.getAttribute('data-type')||''}" outerHTML=${el.outerHTML.slice(0, 300)}`)
  }

  // 6. Dump sample outline item outerHTML
  console.log('--- Sample outline items (by text search) ---')
  const sampleTexts = ['环境准备', 'Python 版本', '数据读取', '前言']
  for (const t of sampleTexts) {
    const found = [...document.querySelectorAll('*')].find(el =>
      el.textContent?.trim() === t && (el as HTMLElement).offsetParent !== null && el.closest('#typora-sidebar, .typora-sidebar')
    ) as HTMLElement | undefined
    if (found) {
      console.log(`  "${t}": tag=${found.tagName} outerHTML=${found.outerHTML.slice(0, 400)}`)
      console.log(`    parent: ${found.parentElement ? elTag(found.parentElement) : 'none'} outerHTML=${found.parentElement?.outerHTML.slice(0, 300)}`)
      console.log(`    ancestors: ${getAncestorChain(found).join(' > ')}`)
    } else {
      console.log(`  "${t}": NOT FOUND in sidebar`)
    }
  }

  console.groupEnd()
}

/** Get direct text content (excluding child element text). */
function getDirectText(el: HTMLElement): string {
  let text = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
    }
  }
  return text
}

/** Find the real outline root element (visible only). */
export function findOutlineRoot(): HTMLElement | null {
  return findOutlineRootCore(true)
}

/** Find outline root allowing hidden panels (e.g. when file tree is active). */
export function findOutlineRootRelaxed(): HTMLElement | null {
  return findOutlineRootCore(false)
}

/** Core outline root detection with optional visibility requirement. */
function findOutlineRootCore(requireVisible: boolean): HTMLElement | null {
  const bodyTexts = getBodyHeadingTexts()

  // Phase 1: Try known ROOT_CANDIDATES with relaxed validation
  for (const sel of ROOT_CANDIDATES) {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) continue
    if (requireVisible && el.offsetParent === null) continue
    if (!el.textContent || el.textContent.trim().length === 0) continue
    if (isNonOutlineDirectly(el)) continue
    if (isInsideExcludedPanel(el)) continue
    if (isValidOutlineRootRelaxed(el, bodyTexts)) return el
  }

  // Phase 2: Search sidebar area for any container with outline items
  const sidebar = findSidebarHost()
  if (!sidebar) return null

  // Mark excluded panels
  for (const sel of [...FILE_TREE_PANEL_SELECTORS, ...NON_OUTLINE_SELECTORS]) {
    const els = sidebar.querySelectorAll(sel)
    els.forEach(e => e.setAttribute('data-inkchapter-exclude', 'true'))
  }

  // Find the container with the most heading-text hits
  const containers = sidebar.querySelectorAll<HTMLElement>('div, ul, ol, section, nav')
  let bestEl: HTMLElement | null = null
  let bestHits = 0

  for (const c of containers) {
    if (requireVisible && c.offsetParent === null) continue
    if (c.hasAttribute('data-inkchapter-exclude')) continue
    if (isInsideExcludedPanel(c)) continue
    if (isNonOutlineDirectly(c)) continue
    if (c.querySelector('input, textarea')) continue

    const hits = countHeadingTextHits(c, bodyTexts)
    if (hits >= 2 && hits > bestHits) {
      const directChildHits = countDirectChildHeadingHits(c, bodyTexts)
      if (directChildHits >= 2 || hits >= 5) {
        bestHits = hits
        bestEl = c
      }
    }
  }

  if (bestEl) {
    return bestEl
  }

  // Phase 3: LCA of heading-matching elements
  const headingMatchEls = findHeadingMatchElements(sidebar, bodyTexts, requireVisible)
  if (headingMatchEls.length >= 2) {
    const lca = findLCA(headingMatchEls)
    if (lca && lca !== sidebar && lca !== document.body) {
      return lca
    }
  }

  return null
}

/** Relaxed validation: has heading-text hits (≥2) OR anchor links (≥2). */
function isValidOutlineRootRelaxed(el: HTMLElement, bodyTexts: Set<string>): boolean {
  if (!el.isConnected) return false
  if (el.querySelector('input, textarea')) return false

  // Check for anchor links
  const links = el.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')
  if (links.length >= 2) return true

  // Check for heading text matches
  const hits = countHeadingTextHits(el, bodyTexts)
  return hits >= 2
}

/** Count how many body heading texts appear in DIRECT children of a container. */
function countDirectChildHeadingHits(el: HTMLElement, bodyTexts: Set<string>): number {
  let count = 0
  for (const child of Array.from(el.children)) {
    const text = (child.textContent ?? '').trim()
    for (const t of bodyTexts) {
      if (text === t || text.startsWith(t)) { count++; break }
    }
    if (count >= 3) break
  }
  return count
}

/** Find sidebar host element. */
function findSidebarHost(): HTMLElement | null {
  const sidebar = document.getElementById('typora-sidebar') ||
                  document.querySelector('.typora-sidebar') as HTMLElement | null
  return sidebar
}

/** Find elements in sidebar whose text matches body headings. */
function findHeadingMatchElements(sidebar: HTMLElement, bodyTexts: Set<string>, requireVisible: boolean = true): HTMLElement[] {
  const result: HTMLElement[] = []
  const allLeafish = sidebar.querySelectorAll<HTMLElement>('div, span, li, a, p')
  const seen: Set<string> = new Set()
  for (const el of allLeafish) {
    if (requireVisible && el.offsetParent === null) continue
    const text = (el.textContent ?? '').trim()
    if (!text || text.length > 200) continue
    if (seen.has(text)) continue
    if (bodyTexts.has(text)) {
      seen.add(text)
      result.push(el)
    }
  }
  return result
}

/** Find lowest common ancestor of elements. */
function findLCA(els: HTMLElement[]): HTMLElement | null {
  if (els.length === 0) return null
  if (els.length === 1) return els[0]
  const ancestorSets = els.map(el => {
    const set = new Set<HTMLElement>()
    let cur: HTMLElement | null = el
    while (cur) {
      set.add(cur)
      cur = cur.parentElement
    }
    return set
  })
  // Find all common ancestors
  const common = [...ancestorSets[0]].filter(a => ancestorSets.every(s => s.has(a)))
  if (common.length === 0) return null
  // Return deepest common ancestor (most nested)
  return common.reduce((deepest, cur) =>
    cur.contains(deepest) ? cur : deepest
  )
}

// ── Outline text elements ─────────────────────────────

/** Find all visible outline entry elements inside the outline root. */
export function findOutlineTextElements(root: HTMLElement): HTMLElement[] {
  return findOutlineTextElementsCore(root, true)
}

/** Find outline entry elements including hidden ones (e.g. when panel is display:none). */
export function findOutlineTextElementsRelaxed(root: HTMLElement): HTMLElement[] {
  return findOutlineTextElementsCore(root, false)
}

/** Core outline text element finder with optional visibility filtering. */
function findOutlineTextElementsCore(root: HTMLElement, requireVisible: boolean): HTMLElement[] {
  const bodyTexts = getBodyHeadingTexts()
  const items: HTMLElement[] = []

  // Strategy 1: Find <a> with href (classic Typora outline)
  const anchors = root.querySelectorAll<HTMLAnchorElement>('a[href]')
  for (const a of anchors) {
    if (requireVisible && a.offsetParent === null) continue
    if (a.textContent && a.textContent.trim().length > 0) {
      items.push(a)
    }
  }
  if (items.length >= 2) return items

  // Strategy 2: Find elements whose text matches body headings
  const allLeafish = root.querySelectorAll<HTMLElement>('div, span, li, a, p')
  const seenTexts = new Set<string>()
  for (const el of allLeafish) {
    if (requireVisible && el.offsetParent === null) continue
    const text = (el.textContent ?? '').trim()
    if (!text || text.length > 200) continue
    if (!bodyTexts.has(text)) continue
    if (seenTexts.has(text)) continue
    let hasMatchingChild = false
    for (const child of el.querySelectorAll<HTMLElement>('*')) {
      if (bodyTexts.has((child.textContent ?? '').trim())) {
        hasMatchingChild = true
        break
      }
    }
    if (hasMatchingChild) continue
    seenTexts.add(text)
    items.push(el)
  }

  if (items.length >= 2) return items

  // Strategy 3: Find all leaf elements with non-empty text
  const allEls = root.querySelectorAll<HTMLElement>('span, div, p, li, a')
  for (const el of allEls) {
    if (requireVisible && el.offsetParent === null) continue
    const text = (el.textContent ?? '').trim()
    if (text.length === 0) continue
    if (el.children.length > 0 && el.querySelector('span, a, div, p, li')) continue
    if (el.matches('button, input, textarea, [data-action], [role="button"]')) continue
    items.push(el)
  }

  return items
}

// ── Matching ──────────────────────────────────────────

/**
 * Match body headings to outline items.
 * Priority: ID match → text+level+occurrence match → index match (when counts equal).
 */
export function matchHeadingsToOutline(
  bodyHeadings: readonly { level: HeadingLevel; text: string }[],
  bodyLabels: readonly string[],
  outlineElements: HTMLElement[],
): Array<{ element: HTMLElement; label: string; method: 'id' | 'text' | 'index' | 'none' }> {
  const result: Array<{ element: HTMLElement; label: string; method: 'id' | 'text' | 'index' | 'none' }> = []
  const usedOutlineIndices = new Set<number>()

  // Phase 1: ID-based matching
  const write = document.getElementById('write')
  const headingEls = write ? Array.from(write.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')) : []

  if (headingEls.length > 0) {
    const idToLabel = new Map<string, string>()
    for (let i = 0; i < bodyHeadings.length && i < bodyLabels.length; i++) {
      const el = headingEls[i]
      if (el?.id && bodyLabels[i]) {
        idToLabel.set(el.id, bodyLabels[i])
      }
    }

    for (let oi = 0; oi < outlineElements.length; oi++) {
      const el = outlineElements[oi]
      const href = el.getAttribute('href') ?? el.closest('a')?.getAttribute('href')
      if (href && href.startsWith('#')) {
        const id = href.slice(1)
        const label = idToLabel.get(id)
        if (label !== undefined) {
          result.push({ element: el, label, method: 'id' })
          usedOutlineIndices.add(oi)
        }
      }
    }
  }

  // Phase 2: Text-based matching with occurrence index for duplicates
  if (result.length < outlineElements.length) {
    // Build outline text → indices map
    const outlineTexts = outlineElements.map(el => (el.textContent ?? '').trim())

    // For each body heading, find matching outline element by text + occurrence
    const textOccurrenceOutline = new Map<string, number>()
    const textOccurrenceBody = new Map<string, number>()

    for (let bi = 0; bi < bodyHeadings.length && bi < bodyLabels.length; bi++) {
      const bodyText = bodyHeadings[bi].text.trim()
      if (!bodyText) continue

      // Count occurrence of this text in body headings so far
      const bodyOccurrence = (textOccurrenceBody.get(bodyText) ?? 0)
      textOccurrenceBody.set(bodyText, bodyOccurrence + 1)

      // Find the Nth occurrence of this text in outline elements
      let outlineOccurrence = 0
      for (let oi = 0; oi < outlineElements.length; oi++) {
        if (usedOutlineIndices.has(oi)) continue
        if (outlineTexts[oi] === bodyText) {
          if (outlineOccurrence === bodyOccurrence) {
            result.push({ element: outlineElements[oi], label: bodyLabels[bi], method: 'text' })
            usedOutlineIndices.add(oi)
            break
          }
          outlineOccurrence++
        }
      }
    }
  }

  // Phase 3: Index-based fallback (only when unmatched pairs remain)
  if (result.length < outlineElements.length &&
      result.length < bodyHeadings.length) {
    // Collect unmatched outline elements
    const unmatchedOutline: number[] = []
    for (let oi = 0; oi < outlineElements.length; oi++) {
      if (!usedOutlineIndices.has(oi)) unmatchedOutline.push(oi)
    }
    // Collect unmatched body headings
    const matchedBodyIndices = new Set<number>()
    // Find which body indices are already matched via text
    for (const r of result) {
      for (let bi = 0; bi < bodyHeadings.length; bi++) {
        if (bodyHeadings[bi].text.trim() === (r.element.textContent ?? '').trim()) {
          matchedBodyIndices.add(bi)
        }
      }
    }
    const unmatchedBody: number[] = []
    for (let bi = 0; bi < bodyHeadings.length && bi < bodyLabels.length; bi++) {
      if (!matchedBodyIndices.has(bi)) unmatchedBody.push(bi)
    }

    // Match by position if counts align
    const pairCount = Math.min(unmatchedOutline.length, unmatchedBody.length)
    for (let i = 0; i < pairCount; i++) {
      result.push({
        element: outlineElements[unmatchedOutline[i]],
        label: bodyLabels[unmatchedBody[i]],
        method: 'index',
      })
    }
  }

  return result
}

// ── Data attribute operations ─────────────────────────

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
        applied++
      }
    }
  }

  return { applied, updated, removed: 0 }
}

export function clearAllNumberingAttributes(root: HTMLElement | null): number {
  if (!root) return 0
  const els = root.querySelectorAll<HTMLElement>(`[${NUMBER_ATTR}]`)
  let count = els.length
  els.forEach(el => el.removeAttribute(NUMBER_ATTR))
  return count
}

// ── Probe ─────────────────────────────────────────────

export function runOutlineProbe(callback: (log: string) => void): ProbeResult | null {
  const root = findOutlineRoot()
  if (!root) {
    callback('[InkChapter:outline-probe] outlineRootFound=false')
    for (const sel of ROOT_CANDIDATES) {
      const el = document.querySelector(sel)
      callback(`[InkChapter:outline-probe] candidate ${sel}: ${el ? 'exists(visible=' + !!(el as HTMLElement).offsetParent + ')' : 'NOT_FOUND'}`)
    }
    return null
  }

  callback('[InkChapter:outline-probe] outlineRootFound=true')
  callback(`[InkChapter:outline-probe] rootSelector=${root.id || root.className || root.tagName}`)

  const items = findOutlineTextElements(root)
  callback(`[InkChapter:outline-probe] itemCount=${items.length}`)

  const visibleItems = items.filter(el => el.offsetParent !== null)
  callback(`[InkChapter:outline-probe] visibleItemCount=${visibleItems.length}`)

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

// ── Full sync ─────────────────────────────────────────

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
  const textCount = matches.filter(m => m.method === 'text').length
  const idxCount = matches.filter(m => m.method === 'index').length
  callback(`matchedCount=${matches.length} (id=${idCount} text=${textCount} idx=${idxCount})`)

  const attrResult = applyNumberingAttributes(
    matches.map(m => ({ element: m.element, label: m.label }))
  )
  callback(`attributeAppliedCount=${attrResult.applied + attrResult.updated}`)

  // Sync bold state on numbering prefixes to match title text boldness
  syncOutlineNumberBoldStyle()

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

// ── Quick sync ────────────────────────────────────────

export function quickSyncOutline(
  bodyHeadings: readonly { level: HeadingLevel; text: string }[],
  bodyLabels: readonly string[],
): { matched: number; applied: number } {
  // Try visible root first, then fall back to relaxed (hidden) root
  let root = findOutlineRoot()
  let useRelaxed = false
  if (!root) {
    root = findOutlineRootRelaxed()
    useRelaxed = true
  }
  if (!root) {
    LOG('[InkChapter OUTLINE] quickSync: root not found (visible or relaxed)')
    return { matched: 0, applied: 0 }
  }
  LOG(`[InkChapter OUTLINE] quickSync: root=${elTag(root)} relaxed=${useRelaxed}`)

  const items = useRelaxed ? findOutlineTextElementsRelaxed(root) : findOutlineTextElements(root)
  LOG(`[InkChapter OUTLINE] quickSync: found ${items.length} text elements, first=${items[0]?.textContent?.trim().slice(0, 30) ?? 'none'}`)
  if (items.length === 0) return { matched: 0, applied: 0 }

  const matches = matchHeadingsToOutline(bodyHeadings, bodyLabels, items)
  LOG(`[InkChapter OUTLINE] quickSync: ${matches.length} matches (body=${bodyHeadings.length} labels=${bodyLabels.length} items=${items.length})`)
  if (matches.length === 0) return { matched: 0, applied: 0 }

  const attrResult = applyNumberingAttributes(
    matches.map(m => ({ element: m.element, label: m.label }))
  )

  // Sync bold state on numbering prefixes to match title text boldness
  syncOutlineNumberBoldStyle()

  return { matched: matches.length, applied: attrResult.applied + attrResult.updated }
}

export function isOutlineVisible(): boolean {
  return findOutlineRoot() !== null
}

// ── File tree cleanup ─────────────────────────────────

export function clearFileTreeNumberingAttributes(): number {
  let count = 0
  const allSelectors = [...FILE_TREE_PANEL_SELECTORS, ...NON_OUTLINE_SELECTORS]
  for (const sel of allSelectors) {
    const els = document.querySelectorAll(sel)
    els.forEach(ft => {
      ft.removeAttribute('data-inkchapter-exclude')
      const marked = ft.querySelectorAll<HTMLElement>(`[${NUMBER_ATTR}]`)
      marked.forEach(el => { el.removeAttribute(NUMBER_ATTR); count++ })
    })
  }
  return count
}

export function cleanupV2Spans(): void {
  const spans = document.querySelectorAll('.inkchapter-outline-number')
  spans.forEach(s => s.remove())
}

// ── Bold numbering sync ───────────────────────────────

const BOLD_CLASS = 'inkchapter-outline-number-bold'

/**
 * Bold sources are tracked separately so that when active state moves,
 * only the active source is affected — markdown and level bold persist.
 */

/** Typora applies .active to the currently-active outline item. */
function isElementActiveBold(el: HTMLElement): boolean {
  // Direct match: the numbered element itself has .active
  if (el.classList.contains('active')) return true
  // Ancestor match: a parent outline-item wrapper has .active
  const activeAncestor = el.closest('.active') as HTMLElement | null
  if (activeAncestor) {
    // Confirm the ancestor is within the outline area (not file tree / footer)
    const sidebar = document.getElementById('typora-sidebar') || document.querySelector('.typora-sidebar')
    if (sidebar && sidebar.contains(activeAncestor)) {
      // Exclude non-outline panels
      if (!isInsideExcludedPanel(activeAncestor)) return true
    }
  }
  // aria-current fallback
  if (el.getAttribute('aria-current') === 'true') return true
  return false
}

/** Markdown **bold** or __bold__ renders <strong>/<b> in outline text. */
function isElementMarkdownBold(el: HTMLElement): boolean {
  const boldTags = el.querySelectorAll('strong, b')
  for (const bt of boldTags) {
    if (bt.textContent && bt.textContent.trim().length > 0) return true
  }
  return false
}

/**
 * Theme/level bold: element's own computed weight is >= 600,
 * but NOT from .active (which is handled separately).
 * We check after temporarily suppressing the active influence by
 * checking if non-active descendants are also bold.
 */
function isElementLevelOrThemeBold(el: HTMLElement): boolean {
  const ownWeight = parseFloat(getComputedStyle(el).fontWeight)
  if (ownWeight < 600) return false

  // If element itself is bold AND does not have .active, it's level/theme bold
  if (!isElementActiveBold(el)) return true

  // Element has .active AND is bold — check if non-active siblings/children
  // have the same bold weight (indicating level/theme bold, not active bold)
  const allDescendants = el.querySelectorAll<HTMLElement>('span, div, a, p, li')
  for (const desc of allDescendants) {
    if (!desc.textContent || desc.textContent.trim().length === 0) continue
    if (desc.classList.contains('active')) continue
    if (desc.closest('.active') && desc.closest('.active') !== el) continue
    const w = parseFloat(getComputedStyle(desc).fontWeight)
    if (w >= 600) return true
  }

  return false
}

/**
 * Determine if an outline item's numbering should be bold.
 * Combines three independent bold sources (any one true → bold).
 */
function shouldOutlineNumberBeBold(el: HTMLElement): boolean {
  try {
    return isElementMarkdownBold(el) || isElementLevelOrThemeBold(el) || isElementActiveBold(el)
  } catch {
    return false
  }
}

// Re-export flag for controller to guard against observer loops.
export let isApplyingOutlineBoldStyle = false

/**
 * Sync the bold class on all outline items that have data-inkchapter-number.
 *
 * Strategy: CLEAN SLATE then RE-DERIVE.
 * 1. Remove all existing bold classes from numbered elements.
 * 2. Re-derive bold state from three independent sources:
 *    - Markdown bold (<strong>/<b> in outline text)
 *    - Level/theme bold (non-active computed font-weight >= 600)
 *    - Active bold (Typora .active class on current outline item)
 * 3. Apply bold class only where at least one source is true.
 *
 * This ensures that when the active item changes:
 * - Old active item loses its active-bold source → numbering returns to normal
 * - New active item gains active-bold → numbering becomes bold
 * - Markdown-bold and level-bold items retain their bold numbering
 *
 * Must be called after numbering attributes have been written to the DOM.
 */
export function syncOutlineNumberBoldStyle(): void {
  if (isApplyingOutlineBoldStyle) return
  isApplyingOutlineBoldStyle = true
  try {
    // Step 1: Remove all old bold classes (clean slate)
    const allBold = document.querySelectorAll<HTMLElement>(`[${NUMBER_ATTR}].${BOLD_CLASS}`)
    for (const el of allBold) {
      try { el.classList.remove(BOLD_CLASS) } catch { /* ignore disconnected */ }
    }

    // Step 2: Re-derive from actual bold sources
    const numberedEls = document.querySelectorAll<HTMLElement>(`[${NUMBER_ATTR}]`)
    for (const el of numberedEls) {
      try {
        if (shouldOutlineNumberBeBold(el)) {
          el.classList.add(BOLD_CLASS)
        }
      } catch {
        // Ignore errors from disconnected or orphaned elements
      }
    }
  } finally {
    isApplyingOutlineBoldStyle = false
  }
}

/** Clear all bold classes from numbered elements (for shutdown / document switch). */
export function clearOutlineNumberBoldStyle(): void {
  const allBold = document.querySelectorAll<HTMLElement>(`[${NUMBER_ATTR}].${BOLD_CLASS}`)
  for (const el of allBold) {
    try { el.classList.remove(BOLD_CLASS) } catch { /* ignore disconnected */ }
  }
}
