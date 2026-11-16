/**
 * R12 — formula / object numbering must follow the VISIBLE heading hierarchy.
 *
 * Regression guard for the association defects proven before the fix:
 *   - an unnumbered intermediate heading made a section-scoped formula lose a
 *     component (`1-1` instead of the displayed `1.1-1`);
 *   - a custom `restartAfterLevel: null` display (`2.3`) was numbered `2.1`;
 *   - a disabled level still contributed a prefix component;
 *   - a strict heading with a missing intermediate level (suppressed display)
 *     still produced an invented section prefix.
 *
 * The canonical path always comes from `computeHeadingNumbering()` — the same
 * engine that renders the heading label.
 */

import { describe, expect, it } from 'vitest'
import type { HeadingDescriptor, HeadingNumberingSettings } from './heading-types'
import { getPresetLevels } from './presets'
import { buildHeadingNumberingSnapshotForRevision } from './heading-numbering-snapshot'
import { planFormulaSemanticNumbers } from './formula-semantic-planner'
import type { ObjectNumberingConfig } from './object-numbering-engine'
import {
  formatObjectNumberFromComponents,
  resolveDisplayPrefixScope,
} from './object-scope-config'
import type { HeadingStructureMode } from './semantic-heading-types'

const hd = (key: string, level: 1 | 2 | 3 | 4 | 5 | 6, text = key): HeadingDescriptor => ({ key, level, text })

function settings(mode: HeadingStructureMode): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: mode,
    showLevelOneNumber: mode === 'loose',
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: getPresetLevels('decimal-hierarchical'),
  }
}

function snapshot(
  headings: HeadingDescriptor[],
  mode: HeadingStructureMode,
  overrideMap?: Map<string, 'numbered' | 'unnumbered'>,
) {
  return buildHeadingNumberingSnapshotForRevision(headings, settings(mode), overrideMap, undefined, 1, 'doc.md')
}

function headingLabel(snap: ReturnType<typeof snapshot>, key: string): string {
  return snap.physical.find(h => h.key === key)?.label ?? ''
}

function displayNumber(
  snap: ReturnType<typeof snapshot>,
  key: string,
  componentCount: number,
): { components: number[]; number: string; scopeKey: string } {
  const state = snap.semantic.find(s => s.stableIdentity === key)!
  const byId = new Map(snap.semantic.map(s => [s.stableIdentity, s]))
  const scope = resolveDisplayPrefixScope('formula', componentCount, 'dash', state, byId)!
  return {
    components: [...scope.components],
    number: formatObjectNumberFromComponents(scope.components, scope.style, 1),
    scopeKey: scope.scopeKey,
  }
}

const formulaConfig = (preset: ObjectNumberingConfig['preset']): ObjectNumberingConfig => ({
  enabled: true, prefix: '', position: 'right', numberingMode: 'continuous',
  numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '({n})', preset,
})

describe('R12 formula numbering follows the visible heading hierarchy', () => {
  it('keeps the section component when an intermediate heading is unnumbered', () => {
    const snap = snapshot(
      [hd('c', 1, '第一章'), hd('u', 2, '附注'), hd('s', 3, '数据')],
      'loose',
      new Map([['u', 'unnumbered']]),
    )
    expect(headingLabel(snap, 's')).toBe('1.1')
    const display = displayNumber(snap, 's', 2)
    expect(display.components).toEqual([1, 1])
    expect(display.number).toBe('1.1-1')
  })

  it('follows a custom continuous (restartAfterLevel=null) section counter', () => {
    const s = settings('loose')
    s.levels[2] = { ...s.levels[2], restartAfterLevel: null }
    const snap = buildHeadingNumberingSnapshotForRevision(
      [hd('c1', 1), hd('s1', 2), hd('c2', 1), hd('s2', 2)],
      s,
      undefined,
      undefined,
      1,
      'doc.md',
    )
    // Second chapter's H2 is 2 because the level is continuous.
    expect(headingLabel(snap, 's2')).toBe('2.2')
    const display = displayNumber(snap, 's2', 2)
    expect(display.components).toEqual([2, 2])
    expect(display.number).toBe('2.2-1')
  })

  it('follows a custom startAt under strict structure', () => {
    const s = settings('strict')
    s.levels[2] = { ...s.levels[2], startAt: 5 }
    const snap = buildHeadingNumberingSnapshotForRevision(
      [hd('t', 1), hd('c', 2), hd('sec', 3)],
      s,
      undefined,
      undefined,
      1,
      'doc.md',
    )
    expect(headingLabel(snap, 'sec')).toBe('1.5')
    const display = displayNumber(snap, 'sec', 2)
    expect(display.components).toEqual([1, 5])
    expect(display.number).toBe('1.5-1')
  })

  it('never uses a disabled level as a prefix component', () => {
    const s = settings('loose')
    s.levels[3] = { ...s.levels[3], enabled: false }
    const snap = buildHeadingNumberingSnapshotForRevision(
      [hd('c', 1), hd('sec', 2), hd('sub', 3)],
      s,
      undefined,
      undefined,
      1,
      'doc.md',
    )
    expect(headingLabel(snap, 'sub')).toBe('')
    const display = displayNumber(snap, 'sub', 2)
    // Falls back to the nearest visible components (H1 + H2), never H3.
    expect(display.components).toEqual([1, 1])
    expect(display.number).toBe('1.1-1')
  })

  it('does not invent a section in strict mode when an intermediate level is missing', () => {
    const snap = snapshot([hd('t', 1, '题目'), hd('c', 2, '第一章'), hd('sub', 4, '数据')], 'strict')
    expect(headingLabel(snap, 'sub')).toBe('')
    const display = displayNumber(snap, 'sub', 2)
    expect(display.components).toEqual([1])
    expect(display.number).toBe('1-1')
  })

  it('formula planner consumes the display scope instead of semantic depth ordinals', () => {
    const snap = snapshot(
      [hd('c', 1, '第一章'), hd('u', 2, '附注'), hd('s', 3, '数据')],
      'loose',
      new Map([['u', 'unnumbered']]),
    )
    const state = snap.semantic.find(s => s.stableIdentity === 's')!
    const byId = new Map(snap.semantic.map(s => [s.stableIdentity, s]))
    const displayScope = resolveDisplayPrefixScope('formula', 2, 'dash', state, byId)
    const [planned] = planFormulaSemanticNumbers(
      [{ chapterOrdinal: state.chapterOrdinal, sectionOrdinal: state.sectionOrdinal, displayScope }],
      formulaConfig('section-dash'),
    )
    expect(planned.rawNumber).toBe('1.1-1')
    expect(planned.renderedNumber).toBe('(1.1-1)')
  })
})
