// @vitest-environment jsdom
/**
 * Phase 4 — heading number position & layout (alignment / box width / gap / wrapped lines).
 *
 * Source branch: feature/heading-number-layout-phase4 (1f73ecf).
 * The branch implementation was written against the pre-rewrite heading pipeline;
 * the feature is re-implemented here against the current architecture.
 *
 * INVARIANT: the default position is the DISABLED position (0 / 0 / false) so that
 * importing this feature never changes the rendering of an existing document.
 */
import { describe, it, expect } from 'vitest'
import { migrateSettings } from './config-migration'
import { getPresetLevels } from './presets'
import { deepCloneSettings } from './heading-numbering-scope-store'
import { HeadingDomAdapter } from '../infrastructure/heading-dom-adapter'
import {
  DEFAULT_HEADING_LEVEL_POSITION,
  HEADING_LEVELS,
  type HeadingLevel,
  type HeadingLevelPosition,
  type HeadingLevelStyle,
} from './heading-types'

const WIDTH_VAR = '--inkchapter-num-width'
const ALIGN_VAR = '--inkchapter-num-align'
const GAP_VAR = '--inkchapter-num-gap'
const WRAP_ATTR = 'data-inkchapter-wrap-align'

function positionOf(levels: Record<HeadingLevel, HeadingLevelStyle>, lv: HeadingLevel): HeadingLevelPosition {
  const pos = levels[lv].position
  expect(pos).toBeTruthy()
  return pos as HeadingLevelPosition
}

function enabledPosition(overrides: Partial<HeadingLevelPosition> = {}): HeadingLevelPosition {
  return {
    numberAlignment: 'right',
    numberBoxWidthEm: 3,
    numberTextGapEm: 0.6,
    alignWrappedLines: true,
    ...overrides,
  }
}

function positionsRecord(pos: HeadingLevelPosition): Record<HeadingLevel, HeadingLevelPosition> {
  const rec = {} as Record<HeadingLevel, HeadingLevelPosition>
  for (const lv of HEADING_LEVELS) rec[lv] = { ...pos }
  return rec
}

function makeEditor(tags: string[]): { write: HTMLElement; adapter: HeadingDomAdapter } {
  document.body.innerHTML = ''
  const write = document.createElement('div')
  write.id = 'write'
  for (const tag of tags) {
    const h = document.createElement(tag)
    h.textContent = tag
    write.appendChild(h)
  }
  document.body.appendChild(write)
  const adapter = new HeadingDomAdapter()
  adapter.setEditorRoot(write)
  return { write, adapter }
}

describe('P4-POSITION — default (disabled) position never changes rendering', () => {
  it('fresh settings carry the disabled default for every level', () => {
    const s = migrateSettings({})
    for (const lv of HEADING_LEVELS) {
      expect(positionOf(s.levels, lv)).toEqual(DEFAULT_HEADING_LEVEL_POSITION)
    }
    expect(DEFAULT_HEADING_LEVEL_POSITION.numberBoxWidthEm).toBe(0)
    expect(DEFAULT_HEADING_LEVEL_POSITION.numberTextGapEm).toBe(0)
    expect(DEFAULT_HEADING_LEVEL_POSITION.alignWrappedLines).toBe(false)
  })

  it('every built-in preset level carries a position', () => {
    for (const preset of [
      'decimal-hierarchical',
      'chinese-chapter',
      'chinese-outline',
      'roman-hierarchical',
      'academic-paper',
      'chapter-section-clause',
      'appendix-hierarchical',
      'roman-mixed',
      'letter-mixed',
      'custom',
    ] as const) {
      const levels = getPresetLevels(preset)
      for (const lv of HEADING_LEVELS) {
        expect(positionOf(levels, lv)).toEqual(DEFAULT_HEADING_LEVEL_POSITION)
      }
    }
  })
})

describe('P4-POSITION — migration keeps and sanitises a stored position', () => {
  it('keeps a valid stored position', () => {
    const stored = enabledPosition({ numberAlignment: 'center' })
    const levels = getPresetLevels('custom')
    for (const lv of HEADING_LEVELS) (levels[lv] as any).position = { ...stored }
    const s = migrateSettings({ preset: 'custom', levels } as any)
    for (const lv of HEADING_LEVELS) {
      expect(positionOf(s.levels, lv)).toEqual(stored)
    }
  })

  it('clamps out-of-range numbers and rejects an unknown alignment', () => {
    const levels = getPresetLevels('custom')
    for (const lv of HEADING_LEVELS) {
      (levels[lv] as any).position = {
        numberAlignment: 'diagonal',
        numberBoxWidthEm: 99,
        numberTextGapEm: -4,
        alignWrappedLines: 'yes',
      }
    }
    const s = migrateSettings({ preset: 'custom', levels } as any)
    for (const lv of HEADING_LEVELS) {
      const pos = positionOf(s.levels, lv)
      expect(pos.numberAlignment).toBe('left')
      expect(pos.numberBoxWidthEm).toBe(12)
      expect(pos.numberTextGapEm).toBe(0)
      expect(pos.alignWrappedLines).toBe(false)
    }
  })

  it('a missing position falls back to the disabled default', () => {
    const levels = getPresetLevels('custom')
    for (const lv of HEADING_LEVELS) delete (levels[lv] as any).position
    const s = migrateSettings({ preset: 'custom', levels } as any)
    for (const lv of HEADING_LEVELS) {
      expect(positionOf(s.levels, lv)).toEqual(DEFAULT_HEADING_LEVEL_POSITION)
    }
  })
})

describe('P4-POSITION — scope cloning keeps the position (no shared reference)', () => {
  it('deepCloneSettings copies position per level', () => {
    const s = migrateSettings({})
    s.levels[2].position = enabledPosition()
    const clone = deepCloneSettings(s)
    expect(clone.levels[2].position).toEqual(enabledPosition())
    expect(clone.levels[2].position).not.toBe(s.levels[2].position)
  })
})

describe('P4-POSITION — DOM application', () => {
  it('writes CSS variables and the wrapped-line attribute when enabled', () => {
    const { write, adapter } = makeEditor(['h1', 'h2', 'h3'])
    const pos = enabledPosition()
    adapter.applyHeadingNumberPositions(positionsRecord(pos))

    const h2 = write.querySelector('h2') as HTMLElement
    expect(h2.style.getPropertyValue(WIDTH_VAR)).toBe('3em')
    expect(h2.style.getPropertyValue(ALIGN_VAR)).toBe('right')
    expect(h2.style.getPropertyValue(GAP_VAR)).toBe('0.6em')
    expect(h2.getAttribute(WRAP_ATTR)).toBe('true')
  })

  it('writes nothing for the disabled default (zero-regression)', () => {
    const { write, adapter } = makeEditor(['h1', 'h2'])
    adapter.applyHeadingNumberPositions(positionsRecord({ ...DEFAULT_HEADING_LEVEL_POSITION }))

    const h2 = write.querySelector('h2') as HTMLElement
    expect(h2.getAttribute('style')).toBeNull()
    expect(h2.hasAttribute(WRAP_ATTR)).toBe(false)
  })

  it('clears previously applied variables when the position is disabled again', () => {
    const { write, adapter } = makeEditor(['h2'])
    adapter.applyHeadingNumberPositions(positionsRecord(enabledPosition()))
    adapter.applyHeadingNumberPositions(positionsRecord({ ...DEFAULT_HEADING_LEVEL_POSITION }))

    const h2 = write.querySelector('h2') as HTMLElement
    expect(h2.style.getPropertyValue(WIDTH_VAR)).toBe('')
    expect(h2.style.getPropertyValue(ALIGN_VAR)).toBe('')
    expect(h2.style.getPropertyValue(GAP_VAR)).toBe('')
    expect(h2.hasAttribute(WRAP_ATTR)).toBe(false)
    expect(h2.getAttribute('style')).toBeNull()
  })

  it('clearNumbering removes the position variables too', () => {
    const { write, adapter } = makeEditor(['h2'])
    adapter.applyHeadingNumberPositions(positionsRecord(enabledPosition()))
    adapter.clearNumbering()

    const h2 = write.querySelector('h2') as HTMLElement
    expect(h2.style.getPropertyValue(WIDTH_VAR)).toBe('')
    expect(h2.hasAttribute(WRAP_ATTR)).toBe(false)
    expect(h2.getAttribute('style')).toBeNull()
  })

  it('a wrapped-line-only position still writes the attribute (width stays unset)', () => {
    const { write, adapter } = makeEditor(['h3'])
    adapter.applyHeadingNumberPositions(
      positionsRecord({ ...DEFAULT_HEADING_LEVEL_POSITION, alignWrappedLines: true }),
    )

    const h3 = write.querySelector('h3') as HTMLElement
    expect(h3.style.getPropertyValue(WIDTH_VAR)).toBe('')
    expect(h3.getAttribute(WRAP_ATTR)).toBe('true')
  })
})
