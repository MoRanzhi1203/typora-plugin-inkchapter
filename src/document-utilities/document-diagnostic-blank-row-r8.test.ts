// @vitest-environment jsdom
/**
 * R8 — Repeated split → delete-merge → re-split, 50 cycles.
 *
 * This suite mirrors the REAL GUI sequence that was executed in Typora against
 * build `9D3B85ED…` (see REPAIR-PROGRESS.md R8 section):
 *
 *   insert X into the middle of an excessive blank run   → the run splits in two
 *   delete X (Backspace) so the run merges again         → one maximal run
 *   insert X again                                       → split again
 *
 * The DOM is mutated IN PLACE exactly like Typora does (the same `<p>` nodes are
 * reused; only their text and the plugin's indent projection class change), so
 * this is not a "rebuild the tree and measure" test.
 *
 * The invariant under test is the one the bug report names: for EVERY stable
 * state, the number of counted blank rows must equal the number of really
 * visible, editable blank paragraphs — including the FIRST row adjacent to the
 * inserted text, and including rows the paragraph-indent module stamped with
 * `inkchapter-paragraph-effective-flush` / `-indent-2`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  resolveRenderedBlankRows,
  type RectLike,
} from './document-diagnostic-rendered-blank-row'

const ROW_TOP0 = 100
const ROW_STEP = 38.4
const ROW_H = 25.6

type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, r: Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }),
  })
}

interface Doc {
  root: HTMLElement
  prev: HTMLElement
  blankRows: HTMLElement[]
  next: HTMLElement
}

/** A Typora-shaped document: prev block → N blank `<p>` → next block. */
function buildDoc(blankRowCount: number): Doc {
  const root = document.createElement('div')
  root.className = 'typ-markdown-view'
  document.body.appendChild(root)

  const prev = document.createElement('p')
  prev.className = 'md-end-block md-p'
  prev.setAttribute('data-line', '0')
  prev.textContent = '前段正文'
  root.appendChild(prev)
  stubRect(prev, { left: 60, top: ROW_TOP0 - ROW_STEP, right: 700, bottom: ROW_TOP0 - ROW_STEP + ROW_H })

  const blankRows: HTMLElement[] = []
  for (let i = 0; i < blankRowCount; i++) {
    const row = document.createElement('p')
    row.className = 'md-end-block md-p'
    row.setAttribute('data-line', String(10 + i))
    root.appendChild(row)
    const top = ROW_TOP0 + i * ROW_STEP
    stubRect(row, { left: 60, top, right: 60, bottom: top + ROW_H })
    blankRows.push(row)
  }

  const next = document.createElement('p')
  next.className = 'md-end-block md-p'
  next.setAttribute('data-line', '999')
  next.textContent = '后段正文'
  root.appendChild(next)
  const nextTop = ROW_TOP0 + blankRowCount * ROW_STEP
  stubRect(next, { left: 60, top: nextTop, right: 700, bottom: nextTop + ROW_H })

  return { root, prev, blankRows, next }
}

function measure(doc: Doc, previous: HTMLElement, next: HTMLElement, sourceBlankLineCount = 11) {
  return resolveRenderedBlankRows({
    businessRoot: doc.root,
    previousElement: previous,
    nextElement: next,
    sourceBlankLineCount,
    layoutEpoch: 1,
    expectedLayoutEpoch: 1,
  })
}

const INDENT_CLASSES = [
  'inkchapter-paragraph-effective-flush',
  'inkchapter-paragraph-effective-indent-2',
  '',
]

beforeEach(() => {
  document.body.innerHTML = ''
  vi.spyOn(window, 'getComputedStyle').mockImplementation((() => ({
    display: 'block', visibility: 'visible', opacity: '1',
  })) as unknown as typeof window.getComputedStyle)
})

describe('R8-01 — 50 real split / delete-merge / re-split cycles', () => {
  it('R8-01 every cycle counts BOTH sides exactly, never dropping the row next to X', () => {
    const doc = buildDoc(5)
    const positions: number[] = []

    for (let cycle = 0; cycle < 50; cycle++) {
      // ── insert X into the MIDDLE blank paragraph (in place, like Typora) ──
      const midIndex = 2 + (cycle % 3) - 1 // 1..3 → keeps the split point moving
      const x = doc.blankRows[midIndex]
      x.textContent = 'X'
      // the plugin projects text-indent onto REAL paragraphs; rotate the class so
      // every position of the run is covered across the 50 cycles
      const projected = INDENT_CLASSES[cycle % INDENT_CLASSES.length]
      x.className = projected === '' ? 'md-end-block md-p' : `md-end-block md-p ${projected}`

      // the split point itself is a text block now, so it must NOT be counted
      const above = measure(doc, doc.prev, x)
      const below = measure(doc, x, doc.next)
      const aboveRows = midIndex
      const belowRows = doc.blankRows.length - midIndex - 1
      positions.push(aboveRows, belowRows)

      expect(above.renderedBlankRowCount, `cycle ${cycle} above`).toBe(aboveRows)
      expect(below.renderedBlankRowCount, `cycle ${cycle} below`).toBe(belowRows)
      expect(above.visibleBlankLineCount, `cycle ${cycle} above visible`).toBe(aboveRows)
      expect(below.visibleBlankLineCount, `cycle ${cycle} below visible`).toBe(belowRows)
      // every counted row must really be a candidate (no silently excluded row)
      expect(above.rows.every(r => !r.pluginOwned), `cycle ${cycle} above owned`).toBe(true)
      expect(below.rows.every(r => !r.pluginOwned), `cycle ${cycle} below owned`).toBe(true)

      // the row ADJACENT to X on both sides must be present (the reported bug)
      if (aboveRows > 0) {
        const lastAbove = above.rows[above.rows.length - 1]
        expect(lastAbove.element, `cycle ${cycle} row above X`).toBe(doc.blankRows[midIndex - 1])
      }
      if (belowRows > 0) {
        const firstBelow = below.rows[0]
        expect(firstBelow.element, `cycle ${cycle} row below X`).toBe(doc.blankRows[midIndex + 1])
      }

      // ── delete X so the run merges again (in place) ──
      x.textContent = ''
      x.className = 'md-end-block md-p'

      const merged = measure(doc, doc.prev, doc.next)
      expect(merged.renderedBlankRowCount, `cycle ${cycle} merged`).toBe(doc.blankRows.length)
      expect(merged.visibleBlankLineCount, `cycle ${cycle} merged visible`).toBe(doc.blankRows.length)
    }

    // the split point really moved (not the same measure 50 times)
    expect(new Set(positions).size).toBeGreaterThan(1)
  })
})

describe('R8-02 — first / last blank row ownership', () => {
  it('R8-02a X at the FIRST blank row: the following rows are all counted', () => {
    const doc = buildDoc(5)
    const x = doc.blankRows[0]
    x.textContent = 'X'
    x.className = 'md-end-block md-p inkchapter-paragraph-effective-flush'
    const above = measure(doc, doc.prev, x)
    const below = measure(doc, x, doc.next)
    expect(above.renderedBlankRowCount).toBe(0)
    expect(below.renderedBlankRowCount).toBe(4)
    expect(below.rows[0].element).toBe(doc.blankRows[1])
  })

  it('R8-02b X at the LAST blank row: the preceding rows are all counted', () => {
    const doc = buildDoc(5)
    const x = doc.blankRows[4]
    x.textContent = 'X'
    x.className = 'md-end-block md-p inkchapter-paragraph-effective-indent-2'
    const above = measure(doc, doc.prev, x)
    const below = measure(doc, x, doc.next)
    expect(above.renderedBlankRowCount).toBe(4)
    expect(below.renderedBlankRowCount).toBe(0)
    expect(above.rows[above.rows.length - 1].element).toBe(doc.blankRows[3])
  })
})

describe('R8-03 — the indent projection never disqualifies a real blank row', () => {
  it('R8-03a all 5 rows projected, all 5 still counted', () => {
    const doc = buildDoc(5)
    doc.blankRows.forEach((row, i) => {
      row.className = `md-end-block md-p ${INDENT_CLASSES[i % 3]}`.trim()
    })
    const all = measure(doc, doc.prev, doc.next)
    expect(all.renderedBlankRowCount).toBe(5)
    expect(all.visibleBlankLineCount).toBe(5)
    expect(all.rows.every(r => !r.pluginOwned)).toBe(true)
  })

  it('R8-03b a projected row next to X is still the FIRST counted row on that side', () => {
    const doc = buildDoc(5)
    const x = doc.blankRows[2]
    x.textContent = 'X'
    x.className = 'md-end-block md-p inkchapter-paragraph-effective-flush'
    doc.blankRows[3].className = 'md-end-block md-p inkchapter-paragraph-effective-flush'
    const below = measure(doc, x, doc.next)
    expect(below.renderedBlankRowCount).toBe(2)
    expect(below.rows[0].element).toBe(doc.blankRows[3])
    expect(below.rows[0].pluginOwned).toBe(false)
  })
})

describe('R8-04 — merged run after 50 delete cycles still equals the visible rows', () => {
  it('R8-04 after 50 insert/delete cycles the merged count is exact', () => {
    const doc = buildDoc(5)
    for (let cycle = 0; cycle < 50; cycle++) {
      const x = doc.blankRows[cycle % doc.blankRows.length]
      x.textContent = 'X'
      x.className = `md-end-block md-p ${INDENT_CLASSES[cycle % 3]}`.trim()
      measure(doc, doc.prev, x)
      measure(doc, x, doc.next)
      x.textContent = ''
      x.className = 'md-end-block md-p'
    }
    const merged = measure(doc, doc.prev, doc.next)
    expect(merged.renderedBlankRowCount).toBe(5)
    expect(merged.visibleBlankLineCount).toBe(5)
    expect(merged.decision).toBe('VERIFIED')
    // no residual row was marked plugin-owned by the repeated projection
    expect(merged.rows.every(r => !r.pluginOwned)).toBe(true)
  })
})
