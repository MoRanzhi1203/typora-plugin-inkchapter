// @vitest-environment jsdom
/**
 * R7 — Rendered blank-row candidate filtering.
 *
 * REPORTED DEFECT: after repeatedly typing text X into an activated excessive
 * blank run and deleting X again to merge, the FIRST really visible blank line
 * after X is occasionally not counted. The truth is 3 rows, the diagnostic says
 * 2 and the highlight covers one row less.
 *
 * This suite does NOT assume a root cause. It first PINS the observable
 * behaviour of the candidate classifier for the two shapes that matter:
 *
 *   (a) a plain empty `<p>`                                 → blank row
 *   (b) the SAME empty `<p>` after the paragraph-indent module
 *       stamped `inkchapter-paragraph-effective-flush` on it → ??? (this suite)
 *
 * `inkchapter-paragraph-effective-flush` / `-indent-2` are written by
 * `applyEffectiveParagraphIndent` onto REAL user paragraphs (`#write > p`) as a
 * visual projection for `text-indent`. They are not plugin overlay nodes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  classifyRenderedRowCandidate,
  isPluginOwnedBlankRowCandidate,
  normalizeSiblingBoundaryPair,
  resolveRenderedBlankRows,
  type RectLike,
  type RenderedRowClassification,
} from './document-diagnostic-rendered-blank-row'
import {
  decideInternalBlankPublication,
  internalBlankLineVisibleDetail,
} from './document-diagnostic-internal-blank-decision-v1'
import { computeRenderedBlankRowFragments } from './document-diagnostic-block-gap-visual-v1'

const ROW_HEIGHT = 20
const ROW_TOP_STEP = 24

/** A real Typora empty business paragraph: zero width, real height. */
function measureBlankRow(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
  return { left: 0, top: 0, right: 0, bottom: ROW_HEIGHT, width: 0, height: ROW_HEIGHT }
}

function emptyParagraph(className = '', dataLine = '5'): HTMLParagraphElement {
  const p = document.createElement('p')
  if (className !== '') p.className = className
  if (dataLine !== '') p.setAttribute('data-line', dataLine)
  return p
}

describe('R7-01 — the plugin indent class must not make a business row plugin-owned', () => {
  it('R7-01a a plain empty <p> is a blank-row candidate', () => {
    const cls: RenderedRowClassification = classifyRenderedRowCandidate(emptyParagraph(), measureBlankRow)
    expect(cls.blankText).toBe(true)
    expect(cls.editableVerified).toBe(true)
    expect(cls.pluginOwned).toBe(false)
    expect(cls.candidateBlankRow).toBe(true)
  })

  it('R7-01b the SAME empty <p> + inkchapter-paragraph-effective-flush is still a blank row', () => {
    // `applyEffectiveParagraphIndent(p, 'flush')` stamps this class on a REAL
    // user paragraph (also on the empty paragraph Enter just created).
    const cls = classifyRenderedRowCandidate(
      emptyParagraph('inkchapter-paragraph-effective-flush'), measureBlankRow,
    )
    expect(cls.blankText).toBe(true)
    expect(cls.editableVerified).toBe(true)
    // the plugin only wrote a text-indent projection; the node is still the
    // document's own empty block, i.e. one REAL visible blank line
    expect(cls.pluginOwned).toBe(false)
    expect(cls.candidateBlankRow).toBe(true)
  })

  it('R7-01c the indent-2 flavour is equally a business row', () => {
    const cls = classifyRenderedRowCandidate(
      emptyParagraph('inkchapter-paragraph-effective-indent-2'), measureBlankRow,
    )
    expect(cls.pluginOwned).toBe(false)
    expect(cls.candidateBlankRow).toBe(true)
  })

  it('R7-01d both indent classes at once (stale residue) do not disqualify the row', () => {
    const p = emptyParagraph('inkchapter-paragraph-effective-indent-2 inkchapter-paragraph-effective-flush')
    const cls = classifyRenderedRowCandidate(p, measureBlankRow)
    expect(cls.pluginOwned).toBe(false)
    expect(cls.candidateBlankRow).toBe(true)
  })

  it('R7-01e a real user paragraph that ALSO carries other plugin classes stays a business row', () => {
    // the indent projection is not the only plugin class a real block can carry
    const p = emptyParagraph('inkchapter-empty-block inkchapter-paragraph-effective-flush')
    const cls = classifyRenderedRowCandidate(p, measureBlankRow)
    expect(cls.candidateBlankRow).toBe(true)
  })
})

describe('R7-02 — genuine plugin overlay nodes stay excluded', () => {
  it('R7-02a the locate layer is never a business row', () => {
    const layer = document.createElement('div')
    layer.setAttribute('data-inkchapter-locate-layer', 'true')
    expect(isPluginOwnedBlankRowCandidate(layer)).toBe(true)
  })

  it('R7-02b a caption carrier is never a business row', () => {
    const cap = document.createElement('div')
    cap.setAttribute('data-inkchapter-caption', '1-1')
    expect(isPluginOwnedBlankRowCandidate(cap)).toBe(true)
  })

  it('R7-02c a diagnostic marker is never a business row', () => {
    const marker = document.createElement('span')
    marker.setAttribute('data-inkchapter-diagnostic-marker', 'true')
    expect(isPluginOwnedBlankRowCandidate(marker)).toBe(true)
  })

  it('R7-02d the utility UI root is never a business row', () => {
    const root = document.createElement('div')
    root.setAttribute('data-ink-ui-root', 'true')
    expect(isPluginOwnedBlankRowCandidate(root)).toBe(true)
  })

  it('R7-02e anything INSIDE the locate layer is never a business row', () => {
    const layer = document.createElement('div')
    layer.setAttribute('data-inkchapter-locate-layer', 'true')
    const container = document.createElement('div')
    container.className = 'inkchapter-block-gap-visual'
    layer.appendChild(container)
    expect(isPluginOwnedBlankRowCandidate(container)).toBe(true)
  })

  it('R7-02f an empty overlay div without data attributes is not admitted as a row', () => {
    // Even a stray plugin `<div>` is rejected by `editableVerified` (not P/LI and
    // no `data-line`), so the classifier never needs the class-name heuristic.
    const div = document.createElement('div')
    div.className = 'inkchapter-something'
    const cls = classifyRenderedRowCandidate(div, measureBlankRow)
    expect(cls.editableVerified).toBe(false)
    expect(cls.candidateBlankRow).toBe(false)
  })
})

// ── R7-03 — the counting chain must agree with the classifier ──────────────

type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, r: Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }),
  })
}

interface GapFixture {
  root: HTMLElement
  previous: HTMLElement
  next: HTMLElement
  rows: HTMLElement[]
}

/**
 * Build a business root with `previous` → N rendered blank rows → `next`.
 * `rowClasses[i]` is applied to the i-th blank row so the suite can reproduce
 * Typora's real mix (some empty paragraphs carry the indent projection class,
 * some do not) — which is exactly why the reported defect looked intermittent.
 */
function buildGap(input: {
  rowClasses: string[]
  wrapRowsIn?: string
}): GapFixture {
  const root = document.createElement('div')
  root.className = 'typ-markdown-view'
  document.body.appendChild(root)

  const previous = document.createElement('p')
  previous.className = 'md-p md-end-block'
  previous.setAttribute('data-line', '0')
  previous.textContent = '甲。'
  root.appendChild(previous)
  stubRect(previous, { left: 60, top: 0, right: 700, bottom: 40 })

  const rowsHost = input.wrapRowsIn != null ? document.createElement(input.wrapRowsIn) : root
  if (rowsHost !== root) root.appendChild(rowsHost)

  const rows: HTMLElement[] = []
  let top = 41
  input.rowClasses.forEach((cls, i) => {
    const row = document.createElement('p')
    row.setAttribute('data-line', String(10 + i))
    if (cls !== '') row.className = cls
    rowsHost.appendChild(row)
    stubRect(row, { left: 60, top, right: 60, bottom: top + ROW_HEIGHT })
    rows.push(row)
    top += ROW_TOP_STEP
  })

  const next = document.createElement('p')
  next.className = 'md-p md-end-block'
  next.setAttribute('data-line', '99')
  next.textContent = '乙。'
  root.appendChild(next)
  stubRect(next, { left: 60, top: top + 1, right: 700, bottom: top + 30 })
  return { root, previous, next, rows }
}

function resolve(gap: GapFixture, sourceBlankLineCount: number) {
  return resolveRenderedBlankRows({
    businessRoot: gap.root,
    previousElement: gap.previous,
    nextElement: gap.next,
    sourceBlankLineCount,
    layoutEpoch: 1,
    expectedLayoutEpoch: 1,
  })
}

/**
 * The PRODUCTION call order: the host first normalizes the two boundary
 * elements to the same sibling level, then resolves the rows between them.
 */
function resolveNormalized(gap: GapFixture, sourceBlankLineCount: number) {
  const pair = normalizeSiblingBoundaryPair(gap.root, gap.previous, gap.next)
    ?? { previous: gap.previous, next: gap.next }
  return resolveRenderedBlankRows({
    businessRoot: gap.root,
    previousElement: pair.previous,
    nextElement: pair.next,
    sourceBlankLineCount,
    layoutEpoch: 1,
    expectedLayoutEpoch: 1,
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.spyOn(window, 'getComputedStyle').mockImplementation((() => ({
    display: 'block', visibility: 'visible', opacity: '1',
  })) as unknown as typeof window.getComputedStyle)
})

describe('R7-03 — a real gap of 3 rows counts 3, whatever the row carries', () => {
  it('R7-03a plain rows: 3 → 3', () => {
    const res = resolve(buildGap({ rowClasses: ['', '', ''] }), 3)
    expect(res.decision).toBe('VERIFIED')
    expect(res.renderedBlankRowCount).toBe(3)
    expect(res.visibleBlankLineCount).toBe(3)
  })

  it('R7-03b THE DEFECT: the FIRST row carries the indent projection class → still 3', () => {
    const res = resolve(
      buildGap({ rowClasses: ['inkchapter-paragraph-effective-flush', '', ''] }), 3,
    )
    expect(res.decision).toBe('VERIFIED')
    expect(res.renderedBlankRowCount).toBe(3)   // was 2 before the fix
    expect(res.visibleBlankLineCount).toBe(3)   // the label the Drawer states
    expect(res.rows.every(r => !r.pluginOwned)).toBe(true)
  })

  it('R7-03c every row carries a projection class → still 3', () => {
    const res = resolve(buildGap({
      rowClasses: [
        'inkchapter-paragraph-effective-flush',
        'inkchapter-paragraph-effective-indent-2',
        'inkchapter-empty-block',
      ],
    }), 3)
    expect(res.renderedBlankRowCount).toBe(3)
    expect(res.visibleBlankLineCount).toBe(3)
  })

  it('R7-03d a projection class on the boundary blocks does not disturb the count', () => {
    const gap = buildGap({ rowClasses: ['inkchapter-paragraph-effective-flush', '', ''] })
    gap.previous.className += ' inkchapter-paragraph-effective-flush'
    gap.next.className += ' inkchapter-paragraph-effective-indent-2'
    const res = resolve(gap, 3)
    expect(res.renderedBlankRowCount).toBe(3)
  })

  it('R7-03e source 7 rendered 3 stays 3 (no source substitution)', () => {
    const res = resolve(
      buildGap({ rowClasses: ['inkchapter-paragraph-effective-flush', '', ''] }), 7,
    )
    expect(res.renderedBlankRowCount).toBe(3)
    expect(res.visibleBlankLineCount).toBe(3)
  })
})

// ── R7-04 — 50 alternating split/merge rounds never lose a row ──────────────

describe('R7-04 — 50 alternating split/merge rounds stay exact', () => {
  it('R7-04 every round: merged 3, split 2+2, the class rotates across rows', () => {
    const CLASSES = ['inkchapter-paragraph-effective-flush', 'inkchapter-paragraph-effective-indent-2', '']
    for (let round = 0; round < 50; round++) {
      // MERGED state: three visible rows, each round puts the projection class
      // on a different row (0,1,2 rotating) — this is the intermittency.
      const projected = CLASSES[round % CLASSES.length]
      const mergedClasses = ['', '', '']
      mergedClasses[round % 3] = projected
      const merged = resolve(buildGap({ rowClasses: mergedClasses }), 3)
      expect(merged.renderedBlankRowCount, `merged round ${round}`).toBe(3)
      expect(merged.visibleBlankLineCount, `merged round ${round}`).toBe(3)

      // SPLIT state: two independent gaps of 2 rows each; one of them carries
      // the projection class on its first row.
      const leftClasses = ['', '']
      leftClasses[round % 2] = projected
      const rightClasses = ['', '']
      rightClasses[(round + 1) % 2] = projected
      const left = resolve(buildGap({ rowClasses: leftClasses }), 2)
      const right = resolve(buildGap({ rowClasses: rightClasses }), 2)
      expect(left.renderedBlankRowCount, `left round ${round}`).toBe(2)
      expect(right.renderedBlankRowCount, `right round ${round}`).toBe(2)

      document.body.innerHTML = ''
    }
  })
})

// ── R7-05 — mixed DOM: boundary blocks inside a Typora wrapper element ─────

describe('R7-05 — mixed DOM shapes keep the count', () => {
  it('R7-05a a boundary block wrapped in a div still yields all 3 rows', () => {
    // Typora wraps a newly typed block in `div.md-end-block` while the blank
    // rows stay direct children — this is the documented wrapper shape the
    // sibling normalization exists for.
    const gap = buildGap({ rowClasses: ['inkchapter-paragraph-effective-flush', '', ''] })
    const wrapper = document.createElement('div')
    wrapper.className = 'md-end-block'
    gap.root.insertBefore(wrapper, gap.previous)
    wrapper.appendChild(gap.previous)
    const res = resolveNormalized(gap, 3)
    expect(res.decision).toBe('VERIFIED')
    expect(res.renderedBlankRowCount).toBe(3)
    expect(res.visibleBlankLineCount).toBe(3)
  })

  it('R7-05b a DORMANT-ish single row is still counted as 1, not 0', () => {
    const res = resolve(buildGap({ rowClasses: ['inkchapter-paragraph-effective-flush'] }), 1)
    expect(res.renderedBlankRowCount).toBe(1)
    expect(res.visibleBlankLineCount).toBe(1)
  })

  it('R7-05c rows nested inside a wrapper are FAIL CLOSED, never silently under-counted', () => {
    // KNOWN LIMITATION (documented, not a silent loss): when the BLANK ROWS
    // themselves sit inside a wrapper element rather than being direct children
    // of the content root, the between-sibling traversal cannot measure them.
    // The resolver then reports NO_RENDERED_ROWS and the diagnostic is withheld
    // for that pass (a bounded re-decision retries), so the user never sees a
    // confidently WRONG smaller number.
    const gap = buildGap({
      rowClasses: ['inkchapter-paragraph-effective-flush', '', ''],
      wrapRowsIn: 'div',
    })
    const res = resolveNormalized(gap, 3)
    expect(res.decision).toBe('NO_RENDERED_ROWS')
    expect(res.renderedBlankRowCount).toBe(0)
  })
})

// ── R7-06 — the whole chain: count → diagnostic copy → highlight range ─────

describe('R7-06 the count feeds the diagnostic copy AND the highlight range', () => {
  it('R7-06a a 3-row gap states 3 and paints 3 rows (first row carries the class)', () => {
    const gap = buildGap({ rowClasses: ['inkchapter-paragraph-effective-flush', '', ''] })
    const res = resolve(gap, 3)
    expect(res.decision).toBe('VERIFIED')
    expect(res.visibleBlankLineCount).toBe(3)

    // 1) the publication decision states the VISIBLE count (what the Drawer shows)
    const decision = decideInternalBlankPublication({
      mode: 'wysiwyg',
      measuredVisibleBlankLineCount: res.visibleBlankLineCount,
      sourceBlankLineCount: 3,
    })
    expect(decision.publish).toBe(true)
    expect(decision.displayBlankLineCount).toBe(3)
    expect(internalBlankLineVisibleDetail(decision.displayBlankLineCount as number))
      .toContain('3 个可视连续空行')

    // 2) the highlight range covers exactly those rows (no missing band)
    const rects = res.rows.map(r => r.rect).filter((r): r is RectLike => r != null)
    expect(rects.length).toBe(3)
    const geometry = computeRenderedBlankRowFragments({
      rowRects: rects,
      contentColumns: { left: 60, right: 700 },
    })
    expect(geometry.fragments.length).toBe(3)
    expect(geometry.container).not.toBeNull()
  })

  it('R7-06b the same gap without the class yields the SAME facts (no behavioural drift)', () => {
    const withClass = resolve(buildGap({ rowClasses: ['inkchapter-paragraph-effective-flush', '', ''] }), 3)
    document.body.innerHTML = ''
    const withoutClass = resolve(buildGap({ rowClasses: ['', '', ''] }), 3)
    expect(withClass.visibleBlankLineCount).toBe(withoutClass.visibleBlankLineCount)
    expect(withClass.renderedBlankRowCount).toBe(withoutClass.renderedBlankRowCount)
  })
})

