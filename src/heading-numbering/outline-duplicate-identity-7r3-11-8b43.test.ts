// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.4.3 / .1 — Outline Duplicate Identity Mapping Closure.
 *
 * PRE-FIX EVIDENCE (recorded on the unfixed code, jsdom with the REAL Typora
 * outline DOM shape — `.outline-item-wrapper` + `outline-hN` level classes and
 * leaf `.outline-label` spans, anchors WITHOUT href):
 *
 *   rawNativeDomItemCount=16
 *   collectorNativeItemCount=15
 *   strategy=2
 *   leafDedupSkippedCount=3 (element-level; wrapper+anchor+span of the 2nd
 *   "text" item are all skipped by `seenTexts.has(text)`)
 *   → net collapse = 1 item (span15) → collector 16 → 15
 *
 *   FIRST_FAILING_LAYER = C. COLLECTOR_TEXT_DEDUP_COLLAPSES_NODE
 *
 * Post-fix the same DOM must yield 16/16/16/16 and duplicateCollapsedCount=0;
 * the matcher (text + occurrence) completes the 1:1 mapping without a matcher
 * rewrite (Collector-First-Failure closure — no preventive matcher changes).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  findOutlineTextElements,
  matchHeadingsToOutline,
  collectRawNativeOutlineInventory,
  computeDuplicateGroups,
  type OutlineCollectorTrace,
  type OutlineMatchTraceEntry,
} from './outline-numbering-adapter'
import type { HeadingLevel } from './heading-types'

/** Build the real Typora outline DOM shape (wrapper + level class + leaf span). */
function makeOutlineDom(
  items: Array<{ level: number; text: string }>,
  withHref = false,
): HTMLElement {
  document.body.innerHTML = ''
  const sidebar = document.createElement('div')
  sidebar.id = 'typora-sidebar'
  document.body.appendChild(sidebar)

  const outline = document.createElement('div')
  outline.id = 'outline-content'
  sidebar.appendChild(outline)

  for (const it of items) {
    const wrapper = document.createElement('div')
    wrapper.className = `outline-item-wrapper outline-h${it.level}`
    const anchor = document.createElement('a')
    anchor.className = 'outline-item'
    if (withHref) anchor.setAttribute('href', `#h-${it.level}-${it.text}`)
    const label = document.createElement('span')
    label.className = 'outline-label'
    label.textContent = it.text
    anchor.appendChild(label)
    wrapper.appendChild(anchor)
    outline.appendChild(wrapper)
    Object.defineProperty(wrapper, 'offsetParent', { get: () => outline, configurable: true })
    Object.defineProperty(anchor, 'offsetParent', { get: () => wrapper, configurable: true })
    Object.defineProperty(label, 'offsetParent', { get: () => anchor, configurable: true })
  }
  Object.defineProperty(sidebar, 'offsetParent', { get: () => document.body, configurable: true })
  Object.defineProperty(outline, 'offsetParent', { get: () => sidebar, configurable: true })

  // Body headings (#write) — canonical authority for text matching.
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  items.forEach((it, i) => {
    const h = document.createElement(`h${it.level}`)
    h.textContent = it.text
    write.appendChild(h)
  })

  return outline
}

function makeHeadings(items: Array<{ level: number; text: string }>): Array<{ level: HeadingLevel; text: string }> {
  return items.map(it => ({ level: it.level as HeadingLevel, text: it.text }))
}

/** The 16-item ATX-marker fixture heading sequence (14 unique + H1/H2 "text"). */
const ATX_16_ITEMS: Array<{ level: number; text: string }> = [
  { level: 1, text: 'ATX Marker Parser Behavior Test' },
  { level: 2, text: 'Canonical heading section（真实标题）' },
  { level: 3, text: '三级小节' },
  { level: 6, text: '深层六级' },
  { level: 2, text: 'Escaped（必须 IGNORE，不产生任何 Error/Warning/Hint）' },
  { level: 2, text: 'Unescaped 行首 hash（按 Typora 实际解析结果：' },
  { level: 2, text: '若成为 Heading Node 则由 EMPTY_HEADING 接管，否则为 LATENT_ATX_HEADING_MARKER）' },
  { level: 2, text: 'Inline hash（必须 IGNORE，非行首 ATX 候选）' },
  { level: 2, text: 'Parser variants（验证 Typora 对「# + 无空格」vs「# + 空格」的差异）' },
  { level: 2, text: 'Leading whitespace（验证前导空格是否产生 Heading Node）' },
  { level: 2, text: 'Fenced code 内的 hash（必须 IGNORE）' },
  { level: 2, text: 'Real gap section（真实结构跳级）' },
  { level: 4, text: '四级标题' },
  { level: 6, text: '六级标题' },
  { level: 1, text: 'text' },   // `# text`
  { level: 2, text: 'text' },   // `## text` — duplicate text at different level
]

describe('7R.3.11.8B.4.3 — collector closure (raw → eligible → collector)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('F1+F2: ATX 16-item real DOM shape → raw=16, collector=16, duplicateCollapsed=0 (regression)', () => {
    const outline = makeOutlineDom(ATX_16_ITEMS, /* withHref */ false)

    const raw = collectRawNativeOutlineInventory(outline)
    expect(raw.rawNativeDomItemCount).toBe(16)
    const dup = computeDuplicateGroups(raw.items)
    expect(dup.duplicateNormalizedTextGroupCount).toBe(1)
    expect(dup.duplicateGroups[0]).toEqual({ normalizedText: 'text', rawIndexes: [14, 15], levels: [1, 2] })

    const trace: OutlineCollectorTrace = {
      strategy: 'none', rawAnchorCount: 0, anchorEligibleCount: 0,
      leafCandidateCount: 0, leafEligibleCount: 0,
      leafChildSkippedCount: 0, collectedCount: 0,
    }
    const collected = findOutlineTextElements(outline, trace)
    // POST-FIX: no text-dedup — both "text" leaf spans are independent items.
    expect(trace.strategy).toBe(2)
    expect(collected.length).toBe(16)
    expect(Math.max(0, raw.rawNativeDomItemCount - collected.length)).toBe(0)
    // duplicateCollapsedCount (invariant) = raw − collector = 0
  })

  it('F2: H1 "text" + H2 "text" without a[href] → strategy=2, collector=2, collapsed=0', () => {
    const outline = makeOutlineDom([
      { level: 1, text: 'text' },
      { level: 2, text: 'text' },
    ], false)
    const raw = collectRawNativeOutlineInventory(outline)
    expect(raw.rawNativeDomItemCount).toBe(2)
    const trace: OutlineCollectorTrace = {
      strategy: 'none', rawAnchorCount: 0, anchorEligibleCount: 0,
      leafCandidateCount: 0, leafEligibleCount: 0,
      leafChildSkippedCount: 0, collectedCount: 0,
    }
    const collected = findOutlineTextElements(outline, trace)
    expect(trace.strategy).toBe(2)
    expect(collected.length).toBe(2)
    expect(Math.max(0, raw.rawNativeDomItemCount - collected.length)).toBe(0)
  })

  it('F3: baseline with a[href] → Strategy 1 returns all items (no regression)', () => {
    const outline = makeOutlineDom([
      { level: 1, text: 'A' },
      { level: 2, text: 'B' },
      { level: 3, text: 'C' },
    ], true)
    const trace: OutlineCollectorTrace = {
      strategy: 'none', rawAnchorCount: 0, anchorEligibleCount: 0,
      leafCandidateCount: 0, leafEligibleCount: 0,
      leafChildSkippedCount: 0, collectedCount: 0,
    }
    const collected = findOutlineTextElements(outline, trace)
    expect(trace.strategy).toBe(1)
    expect(collected.length).toBe(3)
  })

  it('F9: reconcile repetition — collector + match cardinality stable over 10 calls', () => {
    const outline = makeOutlineDom(ATX_16_ITEMS)
    const headings = makeHeadings(ATX_16_ITEMS)
    for (let i = 0; i < 10; i++) {
      const collected = findOutlineTextElements(outline)
      expect(collected.length).toBe(16)
      const matches = matchHeadingsToOutline(headings, ATX_16_ITEMS.map(() => 'x'), collected)
      expect(matches.length).toBe(16)
    }
  })

  it('F10: native rebuild — old DOM discarded, new DOM remapped completely', () => {
    const headings = makeHeadings(ATX_16_ITEMS)
    const labels = ATX_16_ITEMS.map(it => (it.level === 1 ? '' : `L${it.level}`))
    const outline1 = makeOutlineDom(ATX_16_ITEMS)
    const collected1 = findOutlineTextElements(outline1)
    expect(collected1.length).toBe(16)
    const matches1 = matchHeadingsToOutline(headings, labels, collected1)
    expect(matches1.length).toBe(16)

    // Typora rebuilds the outline: old nodes disconnected, new nodes created.
    outline1.parentElement?.remove()
    const outline2 = makeOutlineDom(ATX_16_ITEMS)
    const collected2 = findOutlineTextElements(outline2)
    expect(collected2.length).toBe(16)
    const matches2 = matchHeadingsToOutline(headings, labels, collected2)
    expect(matches2.length).toBe(16)
    // No element identity is carried across the rebuild.
    const shared = collected1.filter(a => collected2.some(b => b === a))
    expect(shared.length).toBe(0)
  })
})

describe('7R.3.11.8B.4.3 — matcher (text + occurrence) with fixed collector', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('F1: H1 "text" + H2 "text" both match via occurrence; strict labels respected', () => {
    const outline = makeOutlineDom([
      { level: 1, text: 'text' },
      { level: 2, text: 'text' },
    ])
    const headings = makeHeadings([
      { level: 1, text: 'text' },
      { level: 2, text: 'text' },
    ])
    // strict labels: H1 → '' (matched but not decorated), H2 → '一、'
    const labels = ['', '一、']
    const items = findOutlineTextElements(outline)
    expect(items.length).toBe(2)

    const trace: OutlineMatchTraceEntry[] = []
    const matches = matchHeadingsToOutline(headings, labels, items, trace)
    expect(matches.length).toBe(2)
    expect(matches[0].label).toBe('')
    expect(matches[1].label).toBe('一、')
    expect(matches[0].method).toBe('text')
    expect(matches[1].method).toBe('text')
    expect(trace).toHaveLength(2)
    expect(trace[0].decision).toBe('MATCH')
    expect(trace[1].decision).toBe('MATCH')
    expect(trace[0].sameTextOccurrenceOrdinal).toBe(1)
    expect(trace[1].sameTextOccurrenceOrdinal).toBe(2)
    expect(trace[0].selectedNativeIndex).toBe(0)
    expect(trace[1].selectedNativeIndex).toBe(1)
  })

  it('F7: strict H1 participates in matching even though its label is empty', () => {
    const outline = makeOutlineDom([
      { level: 1, text: 'text' },
      { level: 2, text: 'text' },
    ])
    const headings = makeHeadings([
      { level: 1, text: 'text' },
      { level: 2, text: 'text' },
    ])
    const labels = ['', '一、']
    const items = findOutlineTextElements(outline)
    const matches = matchHeadingsToOutline(headings, labels, items)
    expect(matches.length).toBe(2)
    // Both headings consumed their own native target; strict H1 not skipped.
    expect(matches[0].element.textContent?.trim()).toBe('text')
    expect(matches[1].element.textContent?.trim()).toBe('text')
    expect(matches[0].element).not.toBe(matches[1].element)
    // Strict H1 is matched but must not produce a number decoration.
    expect(matches[0].label).toBe('')
    expect(matches[1].label).toBe('一、')
  })

  it('F4: same-level duplicates map by occurrence: occ1→occ1, occ2→occ2', () => {
    const outline = makeOutlineDom([
      { level: 2, text: '方法' },
      { level: 2, text: '方法' },
    ])
    const headings = makeHeadings([
      { level: 2, text: '方法' },
      { level: 2, text: '方法' },
    ])
    const labels = ['一、', '二、']
    const items = findOutlineTextElements(outline)
    expect(items.length).toBe(2)
    const matches = matchHeadingsToOutline(headings, labels, items)
    expect(matches.length).toBe(2)
    expect(matches[0].label).toBe('一、')
    expect(matches[1].label).toBe('二、')
    expect(matches[0].element).not.toBe(matches[1].element)
  })

  it('F5: mixed duplicate levels: H2 A / H3 A / H2 A → three independent matches', () => {
    const outline = makeOutlineDom([
      { level: 2, text: 'A' },
      { level: 3, text: 'A' },
      { level: 2, text: 'A' },
    ])
    const headings = makeHeadings([
      { level: 2, text: 'A' },
      { level: 3, text: 'A' },
      { level: 2, text: 'A' },
    ])
    const labels = ['一、', '1、', '二、']
    const items = findOutlineTextElements(outline)
    expect(items.length).toBe(3)
    const matches = matchHeadingsToOutline(headings, labels, items)
    expect(matches.length).toBe(3)
    const distinct = new Set(matches.map(m => m.element))
    expect(distinct.size).toBe(3)
    expect(matches.map(m => m.label)).toEqual(['一、', '1、', '二、'])
  })

  it('F6: non-adjacent duplicate: H2 方法 / H3 结果 / H2 方法 → three independent matches', () => {
    const outline = makeOutlineDom([
      { level: 2, text: '方法' },
      { level: 3, text: '结果' },
      { level: 2, text: '方法' },
    ])
    const headings = makeHeadings([
      { level: 2, text: '方法' },
      { level: 3, text: '结果' },
      { level: 2, text: '方法' },
    ])
    const labels = ['一、', '1、', '二、']
    const items = findOutlineTextElements(outline)
    expect(items.length).toBe(3)
    const matches = matchHeadingsToOutline(headings, labels, items)
    expect(matches.length).toBe(3)
    expect(new Set(matches.map(m => m.element)).size).toBe(3)
  })

  it('F8: loose duplicate — H1 "text" + H2 "text" both matched and both numbered', () => {
    const outline = makeOutlineDom([
      { level: 1, text: 'text' },
      { level: 2, text: 'text' },
    ])
    const headings = makeHeadings([
      { level: 1, text: 'text' },
      { level: 2, text: 'text' },
    ])
    // loose labels: H1 → '一、', H2 → '（一）1、' (both non-empty)
    const labels = ['一、', '1、']
    const items = findOutlineTextElements(outline)
    const matches = matchHeadingsToOutline(headings, labels, items)
    expect(matches.length).toBe(2)
    expect(matches[0].label).toBe('一、')
    expect(matches[1].label).toBe('1、')
    expect(matches[0].element).not.toBe(matches[1].element)
  })

  it('non-duplicate baseline unchanged: H1 A / H2 B / H3 C', () => {
    const outline = makeOutlineDom([
      { level: 1, text: 'A' },
      { level: 2, text: 'B' },
      { level: 3, text: 'C' },
    ])
    const headings = makeHeadings([
      { level: 1, text: 'A' },
      { level: 2, text: 'B' },
      { level: 3, text: 'C' },
    ])
    const labels = ['', '一、', '1、']
    const items = findOutlineTextElements(outline)
    expect(items.length).toBe(3)
    const matches = matchHeadingsToOutline(headings, labels, items)
    expect(matches.length).toBe(3)
    expect(matches.map(m => m.label)).toEqual(['', '一、', '1、'])
  })

  it('NO_NATIVE_CANDIDATE is recorded when an outline item is missing', () => {
    const outline = makeOutlineDom([
      { level: 1, text: 'text' },
      { level: 2, text: 'text' },
    ])
    const headings = makeHeadings([
      { level: 1, text: 'text' },
      { level: 2, text: 'text' },
      { level: 3, text: 'missing-heading' },
    ])
    const labels = ['', '一、', '1、']
    const items = findOutlineTextElements(outline)
    const trace: OutlineMatchTraceEntry[] = []
    const matches = matchHeadingsToOutline(headings, labels, items, trace)
    expect(matches.length).toBe(2)
    expect(trace[2].decision).toBe('NO_NATIVE_CANDIDATE')
    expect(trace[2].selectedNativeIndex).toBeNull()
  })
})
