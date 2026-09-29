// @vitest-environment jsdom
/**
 * V5.14-R4 — Heading Number + Gap ATOMIC reconcile.
 *
 * Covers the R4 prompt:
 *  §8/§13  the projection contract (label purity, body-index outline gap,
 *          mismatch kinds, the forbidden "text edit → gap drift" transition)
 *  §16.2   heading DOM adapter Case A–F
 *  §17     outline adapter mirrors the body decoration
 *  §18     fast path vs decoration repair (Test 1–4)
 *  §19/§20/§21 the 08 fixture regression, the reverse edit, and a real
 *          spacing-setting round-trip
 */

import { describe, it, expect } from 'vitest'
import { HeadingDomAdapter } from '../infrastructure/heading-dom-adapter'
import {
  buildHeadingDecorationProjections,
  createHeadingDecorationV514R4Counters,
  decorationMismatchKind,
  evaluateHeadingDecorationV514R4Gates,
  formatHeadingDecorationV514R4GateReport,
  gapDriftedWithoutSettingsChange,
  headingDecorationMatches,
  normalizeDecorationGap,
  outlineGapForBodyIndex,
  verifyBodyOutlineParity,
  HEADING_DECORATION_V514R4_GATE_KEYS,
  HEADING_DECORATION_V514R4_GATE_LABELS,
  type HeadingDecorationGap,
  type HeadingDecorationProjection,
} from './heading-decoration-projection-v514-r4'
import {
  applyNumberingAttributes,
  matchHeadingsToOutline,
  pairOutlineItemsWithProjections,
  readOutlineDecoration,
  verifyOutlineDecorationParity,
  type OutlineMatchTraceEntry,
} from './outline-numbering-adapter'
import { computeHeadingNumbering } from './numbering-engine'
import { getPresetLevels } from './presets'
import type { HeadingDescriptor, HeadingLevel, HeadingNumberingSettings } from './heading-types'

const NUMBER_ATTR = 'data-inkchapter-heading-number'
const NUMBER_ATTR_OUTLINE = 'data-inkchapter-number'
const GAP_ATTR = 'data-inkchapter-heading-gap'
const GAP_ATTR_OUTLINE = 'data-inkchapter-number-gap'
const CLASS = 'inkchapter-numbered-heading'

// ── helpers ─────────────────────────────────────────────────────────────────

function makeEditor(tags: string[], texts: string[]): HTMLElement {
  document.body.innerHTML = ''
  const write = document.createElement('div')
  write.id = 'write'
  for (let i = 0; i < tags.length; i++) {
    const h = document.createElement(tags[i])
    h.textContent = texts[i] ?? ''
    write.appendChild(h)
  }
  document.body.appendChild(write)
  return write
}

function makeAdapter(write: HTMLElement): HeadingDomAdapter {
  const adapter = new HeadingDomAdapter()
  adapter.setEditorRoot(write)
  return adapter
}

function proj(label: string, gap: HeadingDecorationGap, stableIdentity = 'H2:idx:0'): HeadingDecorationProjection {
  return { stableIdentity, label, gap }
}

/** Outline items (a[href]) each paired with a matching body heading. */
function buildOutline(items: string[]): HTMLElement[] {
  document.body.innerHTML = ''
  const write = document.createElement('div')
  write.id = 'write'
  const root = document.createElement('div')
  root.id = 'outline-content'
  const anchors: HTMLElement[] = []
  for (const text of items) {
    const h = document.createElement('h2')
    h.textContent = text
    write.appendChild(h)
    const wrapper = document.createElement('div')
    wrapper.className = 'outline-item-wrapper outline-h2'
    const a = document.createElement('a')
    a.setAttribute('href', `#${text}`)
    a.textContent = text
    wrapper.appendChild(a)
    root.appendChild(wrapper)
    anchors.push(a)
  }
  document.body.appendChild(write)
  document.body.appendChild(root)
  return anchors
}

/**
 * Reconcile the outline from ONE projection snapshot, keyed by BODY index —
 * exactly what the controller does.
 */
function outlineReconcile(
  items: HTMLElement[],
  bodyTexts: string[],
  specs: Array<{ label: string; gap: HeadingDecorationGap }>,
): { labelMismatch: number; gapMismatch: number } {
  const bodyHeadings = bodyTexts.map(t => ({ level: 2 as HeadingLevel, text: t }))
  const projections = specs.map((s, i) => proj(s.label, s.gap, `H2:idx:${i}`))
  const trace: OutlineMatchTraceEntry[] = []
  matchHeadingsToOutline(bodyHeadings, projections.map(p => p.label), items, trace)
  const pairs = pairOutlineItemsWithProjections({
    trace,
    items,
    bodyLabels: projections.map(p => p.label),
    projections,
    labelGaps: projections.map(p => p.gap),
  })
  applyNumberingAttributes(pairs)
  return verifyOutlineDecorationParity(pairs)
}

// ── §8/§13 — the projection contract ────────────────────────────────────────

describe('V5.14-R4 §8/§13 — projection contract', () => {
  it('§16.1 — label="" always yields gap none and the label stays pure', () => {
    const p = buildHeadingDecorationProjections([
      { key: 'a', label: '2.1', labelGap: 'space' },
      { key: 'b', label: '2.2', labelGap: 'none' },
      { key: 'c', label: '', labelGap: 'space' },
    ])
    expect(p.map(x => x.gap)).toEqual(['space', 'none', 'none'])
    expect(p[0].label).toBe('2.1')
    expect(p[0].label).not.toContain(' ')
    expect(p[0].label).not.toContain('\u00A0')
    // anything that is not the explicit `space` token means "no gap"
    expect(normalizeDecorationGap('space')).toBe('space')
    expect(normalizeDecorationGap(undefined)).toBe('none')
    expect(normalizeDecorationGap('')).toBe('none')
  })

  it('§13/ROOT_R4_5 — the outline gap is keyed by BODY index, never the match ordinal', () => {
    const projections = buildHeadingDecorationProjections([
      { key: 'h0', label: '1', labelGap: 'space' },
      { key: 'h1', label: '', labelGap: 'space' }, // un-numbered heading
      { key: 'h2', label: '1.1', labelGap: 'space' },
      { key: 'h3', label: '1.2', labelGap: 'none' },
    ])
    // body index 3 must resolve to 'none'. The legacy `labelGaps[matchOrdinal]`
    // lookup shifted by the un-numbered heading and returned 'space' here.
    expect(outlineGapForBodyIndex(projections, 3, ['space', 'space', 'space', 'none'])).toBe('none')
    // an empty label can never keep a gap
    expect(outlineGapForBodyIndex(projections, 1, ['space'])).toBe('none')
    // legacy fallback keeps working when no projection exists
    expect(outlineGapForBodyIndex(null, 0, ['space'])).toBe('space')
    expect(outlineGapForBodyIndex(null, 0, [''])).toBe('none')
  })

  it('§10 — mismatch kinds distinguish label-only / gap-only / combined drift', () => {
    const expected = proj('2.1', 'space')
    expect(decorationMismatchKind(expected, { numberedClass: true, label: '2.1', gap: 'none' })).toBe('gap')
    expect(decorationMismatchKind(expected, { numberedClass: true, label: '2.2', gap: 'space' })).toBe('label')
    expect(decorationMismatchKind(expected, { numberedClass: false, label: '2.1', gap: 'space' })).toBe('class')
    expect(decorationMismatchKind(expected, { numberedClass: true, label: '2.1', gap: 'space' })).toBe('none')
    expect(headingDecorationMatches(expected, { numberedClass: true, label: '2.1', gap: 'space' })).toBe(true)
    expect(headingDecorationMatches(expected, { numberedClass: true, label: '2.1', gap: 'none' })).toBe(false)
    // an empty label requires the decoration to be fully absent
    expect(headingDecorationMatches(proj('', 'none'), { numberedClass: false, label: null, gap: 'none' })).toBe(true)
    expect(headingDecorationMatches(proj('', 'none'), { numberedClass: true, label: null, gap: 'none' })).toBe(false)
  })

  it('§13 — gap drift without a settings/semantic change is the forbidden transition', () => {
    expect(gapDriftedWithoutSettingsChange({
      labelBefore: '2.1', labelAfter: '2.1',
      gapBefore: 'space', gapAfter: 'none',
      settingsChanged: false, semanticChanged: false,
    })).toBe(true)
    // a real settings change legitimately flips the gap
    expect(gapDriftedWithoutSettingsChange({
      labelBefore: '2.1', labelAfter: '2.1',
      gapBefore: 'space', gapAfter: 'none',
      settingsChanged: true, semanticChanged: false,
    })).toBe(false)
    // a changed label is a different business result, not a drift
    expect(gapDriftedWithoutSettingsChange({
      labelBefore: '2.1', labelAfter: '2.2',
      gapBefore: 'space', gapAfter: 'none',
      settingsChanged: false, semanticChanged: true,
    })).toBe(false)
  })

  it('§15 — the 14 R4 gates are declared and start at 0', () => {
    const counters = createHeadingDecorationV514R4Counters()
    expect(HEADING_DECORATION_V514R4_GATE_KEYS).toHaveLength(14)
    expect(evaluateHeadingDecorationV514R4Gates(counters).decision).toBe('PASS')
    expect(formatHeadingDecorationV514R4GateReport(counters)).toHaveLength(14)
    expect(HEADING_DECORATION_V514R4_GATE_LABELS.bodyOutlineGapParityMismatch).toBe('BODY_OUTLINE_GAP_PARITY_MISMATCH_COUNT')
    expect(HEADING_DECORATION_V514R4_GATE_LABELS.staleGapSurvivedDocumentSwitch).toBe('STALE_GAP_SURVIVED_DOCUMENT_SWITCH_COUNT')
    // any non-zero counter fails the gate
    const dirty = createHeadingDecorationV514R4Counters()
    dirty.fastPathAcceptedWithGapMismatch = 1
    expect(evaluateHeadingDecorationV514R4Gates(dirty).decision).toBe('FAIL')
  })

  it('§12 — body/outline parity reports label and gap independently', () => {
    const body = buildHeadingDecorationProjections([
      { key: 'a', label: '1', labelGap: 'space' },
      { key: 'b', label: '1.1', labelGap: 'space' },
    ])
    expect(verifyBodyOutlineParity(body, [
      { stableIdentity: 'a', label: '1', gap: 'space' },
      { stableIdentity: 'b', label: '1.1', gap: 'none' },
    ])).toMatchObject({ labelMismatch: 0, gapMismatch: 1 })
    expect(verifyBodyOutlineParity(body, [
      { stableIdentity: 'a', label: '9', gap: 'space' },
      { stableIdentity: 'b', label: '1.1', gap: 'space' },
    ])).toMatchObject({ labelMismatch: 1, gapMismatch: 0 })
    expect(verifyBodyOutlineParity(body, [
      { stableIdentity: 'a', label: '1', gap: 'space' },
      { stableIdentity: 'b', label: '1.1', gap: 'space' },
    ])).toMatchObject({ labelMismatch: 0, gapMismatch: 0 })
  })
})

// ── §16.2 — heading DOM adapter Case A–F ────────────────────────────────────

describe('V5.14-R4 §16.2 — heading DOM adapter atomic reconcile (Case A–F)', () => {
  it('Case A — label 2.1 + gap space → class + number + gap all present', () => {
    const write = makeEditor(['h2'], ['第一节'])
    const adapter = makeAdapter(write)
    const h = write.querySelector('h2') as HTMLHeadingElement
    adapter.reconcileHeadingDecorations([proj('2.1', 'space')])
    expect(h.classList.contains(CLASS)).toBe(true)
    expect(h.getAttribute(NUMBER_ATTR)).toBe('2.1')
    expect(h.getAttribute(GAP_ATTR)).toBe('space')
    expect(adapter.readHeadingDecoration(h)).toEqual({ numberedClass: true, label: '2.1', gap: 'space' })
  })

  it('Case B — label 2.1 + gap none → gap attribute absent', () => {
    const write = makeEditor(['h2'], ['第一节'])
    const adapter = makeAdapter(write)
    const h = write.querySelector('h2') as HTMLHeadingElement
    adapter.reconcileHeadingDecorations([proj('2.1', 'none')])
    expect(h.classList.contains(CLASS)).toBe(true)
    expect(h.getAttribute(NUMBER_ATTR)).toBe('2.1')
    expect(h.hasAttribute(GAP_ATTR)).toBe(false)
  })

  it('Case C — label unchanged, gap none → space (the key regression)', () => {
    const write = makeEditor(['h2'], ['第一节'])
    const adapter = makeAdapter(write)
    const h = write.querySelector('h2') as HTMLHeadingElement
    adapter.reconcileHeadingDecorations([proj('2.1', 'none')])
    expect(h.hasAttribute(GAP_ATTR)).toBe(false)
    const diff = adapter.reconcileHeadingDecorations([proj('2.1', 'space')])
    expect(h.getAttribute(NUMBER_ATTR)).toBe('2.1')
    expect(h.getAttribute(GAP_ATTR)).toBe('space')
    // the gap-only drift is counted (label was already correct)
    expect(diff.gapMismatch).toBe(1)
    expect(diff.labelMismatch).toBe(0)
  })

  it('Case D — label unchanged, gap space → none', () => {
    const write = makeEditor(['h2'], ['第一节'])
    const adapter = makeAdapter(write)
    const h = write.querySelector('h2') as HTMLHeadingElement
    adapter.reconcileHeadingDecorations([proj('2.1', 'space')])
    adapter.reconcileHeadingDecorations([proj('2.1', 'none')])
    expect(h.getAttribute(NUMBER_ATTR)).toBe('2.1')
    expect(h.hasAttribute(GAP_ATTR)).toBe(false)
  })

  it('Case E — label 2.1 → 2.2 with the gap unchanged → atomic update', () => {
    const write = makeEditor(['h2'], ['第一节'])
    const adapter = makeAdapter(write)
    const h = write.querySelector('h2') as HTMLHeadingElement
    adapter.reconcileHeadingDecorations([proj('2.1', 'space')])
    adapter.reconcileHeadingDecorations([proj('2.2', 'space')])
    expect(h.getAttribute(NUMBER_ATTR)).toBe('2.2')
    expect(h.getAttribute(GAP_ATTR)).toBe('space')
  })

  it('Case F — label cleared → class + number + gap removed together', () => {
    const write = makeEditor(['h2'], ['第一节'])
    const adapter = makeAdapter(write)
    const h = write.querySelector('h2') as HTMLHeadingElement
    adapter.reconcileHeadingDecorations([proj('2.1', 'space')])
    adapter.reconcileHeadingDecorations([proj('', 'none')])
    expect(h.classList.contains(CLASS)).toBe(false)
    expect(h.hasAttribute(NUMBER_ATTR)).toBe(false)
    expect(h.hasAttribute(GAP_ATTR)).toBe(false)
  })

  it('§9 — a heading beyond the projection is stripped INCLUDING its gap', () => {
    const write = makeEditor(['h2', 'h2'], ['a', 'b'])
    const adapter = makeAdapter(write)
    const hs = write.querySelectorAll('h2')
    adapter.reconcileHeadingDecorations([proj('1', 'space'), proj('2', 'space')])
    expect(hs[1].getAttribute(GAP_ATTR)).toBe('space')
    const diff = adapter.reconcileHeadingDecorations([proj('1', 'space')])
    expect(hs[1].hasAttribute(NUMBER_ATTR)).toBe(false)
    expect(hs[1].hasAttribute(GAP_ATTR)).toBe(false)
    expect(diff.staleGapRemoved).toBe(1)
  })

  it('§15 — clearNumbering removes the gap attribute too (no stale gap)', () => {
    const write = makeEditor(['h2', 'h2'], ['a', 'b'])
    const adapter = makeAdapter(write)
    const hs = write.querySelectorAll('h2')
    adapter.reconcileHeadingDecorations([proj('1', 'space'), proj('2', 'space')])
    adapter.clearNumbering()
    for (const h of Array.from(hs)) {
      expect(h.classList.contains(CLASS)).toBe(false)
      expect(h.hasAttribute(NUMBER_ATTR)).toBe(false)
      expect(h.hasAttribute(GAP_ATTR)).toBe(false)
    }
  })

  it('§10 — areGapsValid is a STRICT parity check (a short array is not "valid")', () => {
    const write = makeEditor(['h2', 'h2'], ['a', 'b'])
    const adapter = makeAdapter(write)
    adapter.reconcileHeadingDecorations([proj('1', 'space'), proj('2', 'none')])
    expect(adapter.areGapsValid(['space', 'none'])).toBe(true)
    // short array → the old implementation returned true early
    expect(adapter.areGapsValid(['space'])).toBe(false)
    expect(adapter.areGapsValid(['none', 'none'])).toBe(false)
  })
})

// ── §17 — outline adapter mirrors the body decoration ───────────────────────

describe('V5.14-R4 §17 — outline adapter mirrors the body decoration', () => {
  it('label same / gap changes', () => {
    const items = buildOutline(['A', 'B'])
    outlineReconcile(items, ['A', 'B'], [{ label: '1.1', gap: 'none' }, { label: '1.2', gap: 'space' }])
    expect(readOutlineDecoration(items[0])).toEqual({ label: '1.1', gap: 'none' })
    const verified = outlineReconcile(items, ['A', 'B'], [{ label: '1.1', gap: 'space' }, { label: '1.2', gap: 'space' }])
    expect(readOutlineDecoration(items[0])).toEqual({ label: '1.1', gap: 'space' })
    expect(verified).toEqual({ labelMismatch: 0, gapMismatch: 0 })
  })

  it('label changes / gap same', () => {
    const items = buildOutline(['A', 'B'])
    outlineReconcile(items, ['A', 'B'], [{ label: '1.1', gap: 'space' }, { label: '1.2', gap: 'space' }])
    const verified = outlineReconcile(items, ['A', 'B'], [{ label: '1.9', gap: 'space' }, { label: '1.2', gap: 'space' }])
    expect(readOutlineDecoration(items[0])).toEqual({ label: '1.9', gap: 'space' })
    expect(verified).toEqual({ labelMismatch: 0, gapMismatch: 0 })
  })

  it('label + gap both change', () => {
    const items = buildOutline(['A', 'B'])
    outlineReconcile(items, ['A', 'B'], [{ label: '1.1', gap: 'space' }, { label: '1.2', gap: 'space' }])
    const verified = outlineReconcile(items, ['A', 'B'], [{ label: '1.2', gap: 'none' }, { label: '1.2', gap: 'space' }])
    expect(readOutlineDecoration(items[0])).toEqual({ label: '1.2', gap: 'none' })
    expect(items[0].getAttribute(GAP_ATTR_OUTLINE)).toBe(null)
    expect(verified).toEqual({ labelMismatch: 0, gapMismatch: 0 })
  })

  it('label becomes empty → number + gap removed together', () => {
    const items = buildOutline(['A', 'B'])
    outlineReconcile(items, ['A', 'B'], [{ label: '1.1', gap: 'space' }, { label: '1.2', gap: 'space' }])
    const verified = outlineReconcile(items, ['A', 'B'], [{ label: '', gap: 'none' }, { label: '1.2', gap: 'space' }])
    expect(items[0].hasAttribute(NUMBER_ATTR_OUTLINE)).toBe(false)
    expect(items[0].hasAttribute(GAP_ATTR_OUTLINE)).toBe(false)
    expect(verified).toEqual({ labelMismatch: 0, gapMismatch: 0 })
  })

  it('ROOT_R4_5 — an unmatched heading never shifts a later outline gap', () => {
    // outline only carries A and C; body has A, B (unmatched), C
    const items = buildOutline(['A', 'C'])
    const bodyTexts = ['A', 'B', 'C']
    const specs = [
      { label: '1.1', gap: 'space' as HeadingDecorationGap },
      { label: '1.2', gap: 'space' as HeadingDecorationGap },
      { label: '1.3', gap: 'none' as HeadingDecorationGap },
    ]
    const bodyHeadings = bodyTexts.map(t => ({ level: 2 as HeadingLevel, text: t }))
    const projections = specs.map((s, i) => proj(s.label, s.gap, `H2:idx:${i}`))
    const trace: OutlineMatchTraceEntry[] = []
    matchHeadingsToOutline(bodyHeadings, projections.map(p => p.label), items, trace)
    const pairs = pairOutlineItemsWithProjections({
      trace,
      items,
      bodyLabels: projections.map(p => p.label),
      projections,
      labelGaps: projections.map(p => p.gap),
    })
    applyNumberingAttributes(pairs)
    // item C is BODY index 2 → gap must be 'none' (a match-ordinal lookup would
    // have taken body index 1 = 'space').
    expect(items[1].getAttribute(NUMBER_ATTR_OUTLINE)).toBe('1.3')
    expect(items[1].hasAttribute(GAP_ATTR_OUTLINE)).toBe(false)
    expect(verifyOutlineDecorationParity(pairs)).toEqual({ labelMismatch: 0, gapMismatch: 0 })
  })
})

// ── §18 — fast path vs decoration repair ────────────────────────────────────

describe('V5.14-R4 §18 — fast path vs decoration repair', () => {
  it('Test 1 — label correct, gap missing → fastPath=false, repair=true', () => {
    const write = makeEditor(['h2'], ['第一节'])
    const adapter = makeAdapter(write)
    const h = write.querySelector('h2') as HTMLHeadingElement
    h.classList.add(CLASS)
    h.setAttribute(NUMBER_ATTR, '2.1')
    // the gap is missing
    const states = adapter.buildRenderedStates(['2.1'], ['space'])
    expect(adapter.isRenderedStateValid(states)).toBe(false)
    const diff = adapter.reconcileHeadingDecorations([proj('2.1', 'space')])
    expect(h.getAttribute(GAP_ATTR)).toBe('space')
    expect(diff.gapMismatch).toBe(1)
  })

  it('Test 2 — label correct, gap=space but expected none → repair removes the gap', () => {
    const write = makeEditor(['h2'], ['第一节'])
    const adapter = makeAdapter(write)
    const h = write.querySelector('h2') as HTMLHeadingElement
    h.classList.add(CLASS)
    h.setAttribute(NUMBER_ATTR, '2.1')
    h.setAttribute(GAP_ATTR, 'space')
    const states = adapter.buildRenderedStates(['2.1'], ['none'])
    expect(adapter.isRenderedStateValid(states)).toBe(false)
    const diff = adapter.reconcileHeadingDecorations([proj('2.1', 'none')])
    expect(h.hasAttribute(GAP_ATTR)).toBe(false)
    expect(diff.gapMismatch).toBe(1)
  })

  it('Test 3 — label wrong, gap correct → repair fixes the label atomically', () => {
    const write = makeEditor(['h2'], ['第一节'])
    const adapter = makeAdapter(write)
    const h = write.querySelector('h2') as HTMLHeadingElement
    h.classList.add(CLASS)
    h.setAttribute(NUMBER_ATTR, '2.9')
    h.setAttribute(GAP_ATTR, 'space')
    const states = adapter.buildRenderedStates(['2.1'], ['space'])
    expect(adapter.isRenderedStateValid(states)).toBe(false)
    const diff = adapter.reconcileHeadingDecorations([proj('2.1', 'space')])
    expect(h.getAttribute(NUMBER_ATTR)).toBe('2.1')
    expect(h.getAttribute(GAP_ATTR)).toBe('space')
    expect(diff.labelMismatch).toBe(1)
  })

  it('Test 4 — label + gap both correct → fastPath=true', () => {
    const write = makeEditor(['h2'], ['第一节'])
    const adapter = makeAdapter(write)
    const h = write.querySelector('h2') as HTMLHeadingElement
    h.classList.add(CLASS)
    h.setAttribute(NUMBER_ATTR, '2.1')
    h.setAttribute(GAP_ATTR, 'space')
    const states = adapter.buildRenderedStates(['2.1'], ['space'])
    expect(adapter.isRenderedStateValid(states)).toBe(true)
    expect(adapter.areGapsValid(['space'])).toBe(true)
  })

  it('§10 — repairDecoration keeps label+gap atomic (a state gap is honoured)', () => {
    const write = makeEditor(['h2'], ['第一节'])
    const adapter = makeAdapter(write)
    const h = write.querySelector('h2') as HTMLHeadingElement
    h.classList.add(CLASS)
    h.setAttribute(NUMBER_ATTR, '2.1')
    h.setAttribute(GAP_ATTR, 'space')
    const states = adapter.buildRenderedStates(['2.2'], ['space'])
    adapter.repairDecoration(states)
    expect(h.getAttribute(NUMBER_ATTR)).toBe('2.2')
    expect(h.getAttribute(GAP_ATTR)).toBe('space')
  })

  it('§10 — repairDecoration strips the gap when the repaired label becomes empty', () => {
    const write = makeEditor(['h2'], ['第一节'])
    const adapter = makeAdapter(write)
    const h = write.querySelector('h2') as HTMLHeadingElement
    h.classList.add(CLASS)
    h.setAttribute(NUMBER_ATTR, '2.1')
    h.setAttribute(GAP_ATTR, 'space')
    const states = adapter.buildRenderedStates([''], ['none'])
    adapter.repairDecoration(states)
    expect(h.hasAttribute(NUMBER_ATTR)).toBe(false)
    expect(h.hasAttribute(GAP_ATTR)).toBe(false)
  })
})

// ── §19/§20/§21 — the 08 fixture regression ─────────────────────────────────

describe('V5.14-R4 §19/§20/§21 — 08 fixture regression', () => {
  function settings(): HeadingNumberingSettings {
    return {
      enabled: true,
      headingStructureMode: 'loose',
      showLevelOneNumber: true,
      preset: 'custom' as HeadingNumberingSettings['preset'],
      maxDepth: 6 as HeadingLevel,
      levels: getPresetLevels('decimal-hierarchical'),
    }
  }

  function headingsOf(rows: Array<{ level: number; text: string }>): HeadingDescriptor[] {
    return rows.map((r, i) => ({ key: `H${r.level}:idx:${i}`, level: r.level as HeadingLevel, text: r.text }))
  }

  const before = [
    { level: 1, text: '标题编号与跳级翻转测试' },
    { level: 2, text: '第一章' },
    { level: 3, text: '第一节' },
    { level: 5, text: '第五节（H3 → H5，缺 H4）' },
    { level: 2, text: '第二章' },
    { level: 3, text: '第一节' },
  ]
  const after = before.map(h => (h.level === 5 ? { ...h, text: '第五节' } : h))

  function projectionsOf(rows: Array<{ level: number; text: string }>, s: HeadingNumberingSettings): HeadingDecorationProjection[] {
    const numbered = computeHeadingNumbering(headingsOf(rows), s)
    return buildHeadingDecorationProjections(numbered.map(n => ({ key: n.key, label: n.label, labelGap: n.labelGap })))
  }

  it('§19 — shortening the H5 title does not change any label or gap', () => {
    const s = settings()
    const pBefore = projectionsOf(before, s)
    const pAfter = projectionsOf(after, s)
    expect(pAfter).toHaveLength(pBefore.length)
    for (let i = 0; i < pBefore.length; i++) {
      expect(pAfter[i].label).toBe(pBefore[i].label)
      expect(pAfter[i].gap).toBe(pBefore[i].gap)
    }
    // the edited heading itself is unchanged (H5 → H5)
    expect(pAfter[3].label).toBe(pBefore[3].label)
    expect(pAfter[3].gap).toBe(pBefore[3].gap)
  })

  it('§20 — the reverse edit (re-adding the bracket text) is symmetric', () => {
    const s = settings()
    const pAfter = projectionsOf(after, s)
    const pBefore = projectionsOf(before, s)
    for (let i = 0; i < pAfter.length; i++) {
      expect(pBefore[i].label).toBe(pAfter[i].label)
      expect(pBefore[i].gap).toBe(pAfter[i].gap)
    }
  })

  it('§19 — the adapter lands the same decoration on the real DOM', () => {
    const write = makeEditor(['h1', 'h2', 'h3', 'h5', 'h2', 'h3'], before.map(h => h.text))
    const adapter = makeAdapter(write)
    const s = settings()
    const pBefore = projectionsOf(before, s)
    adapter.reconcileHeadingDecorations(pBefore)
    // edit ONLY the H5 text; the projection is unchanged
    const h5 = write.querySelector('h5') as HTMLHeadingElement
    h5.textContent = '第五节'
    const pAfter = projectionsOf(after, s)
    const diff = adapter.reconcileHeadingDecorations(pAfter)
    expect(diff.labelMismatch).toBe(0)
    expect(diff.gapMismatch).toBe(0)
    const h3 = write.querySelector('h3') as HTMLHeadingElement
    expect(h3.getAttribute(NUMBER_ATTR)).toBe(pAfter[2].label)
    expect(h3.getAttribute(GAP_ATTR)).toBe(pAfter[2].gap === 'space' ? 'space' : null)
  })

  it('§21 — a real spacing setting change still flips the gap (space↔none)', () => {
    const sSpace = settings()
    const sNone = settings()
    for (const lv of [1, 2, 3, 4, 5, 6] as HeadingLevel[]) {
      sSpace.levels[lv].numberTitleSpacing = 'space'
      sNone.levels[lv].numberTitleSpacing = 'none'
    }
    const pSpace = projectionsOf(before, sSpace)
    const pNone = projectionsOf(before, sNone)
    expect(pSpace).toHaveLength(pNone.length)
    for (let i = 0; i < pSpace.length; i++) {
      // the spacing setting never changes the number itself
      expect(pNone[i].label).toBe(pSpace[i].label)
      if (pSpace[i].label !== '') {
        expect(pSpace[i].gap).toBe('space')
        expect(pNone[i].gap).toBe('none')
      } else {
        expect(pSpace[i].gap).toBe('none')
      }
    }
    // …and switching back restores space exactly
    expect(projectionsOf(before, sSpace).map(p => p.gap)).toEqual(pSpace.map(p => p.gap))
  })
})
