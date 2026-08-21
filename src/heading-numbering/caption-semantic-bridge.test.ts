import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { buildHeadingNumberingSnapshotForRevision } from './heading-numbering-snapshot'
import { computeProductionDesiredCaptionStates, type CaptionObjectEntry, type ProductionObjectConfigs } from './caption-semantic-bridge'
import { DEFAULT_OBJECT_NUMBERING_CONFIG, type ObjectNumberingConfig } from './object-numbering-engine'
import type { HeadingDescriptor, HeadingNumberingSettings } from './heading-types'
import { DEFAULT_SETTINGS } from '../settings/default-settings'

const base = DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault

function hd(key: string, level: 1 | 2 | 3 | 4 | 5 | 6, text = key): HeadingDescriptor {
  return { key, level, text }
}

function settings(mode: 'strict' | 'loose'): HeadingNumberingSettings {
  return { ...base, levels: { ...base.levels }, headingStructureMode: mode, showLevelOneNumber: mode === 'loose' }
}

function config(preset: ObjectNumberingConfig['preset'], overrides: Partial<ObjectNumberingConfig> = {}): ObjectNumberingConfig {
  return { ...DEFAULT_OBJECT_NUMBERING_CONFIG.figure, preset, ...overrides }
}

function configs(preset: ObjectNumberingConfig['preset']): ProductionObjectConfigs {
  return {
    figure: config(preset),
    table: { ...config(preset), prefix: '表' },
    code: { ...config(preset), prefix: '代码' },
  }
}

function compute(headings: HeadingDescriptor[], mode: 'strict' | 'loose', objects: CaptionObjectEntry[], cfg: ProductionObjectConfigs) {
  const snap = buildHeadingNumberingSnapshotForRevision(headings, settings(mode), undefined, undefined, 1, 'doc.md')
  return computeProductionDesiredCaptionStates(snap, objects, cfg)
}

describe('6A-AUTH — production Caption consumes heading snapshot (no DOM parse)', () => {
  it('6A-AUTH-4: strict H2 chapter / H3 section', () => {
    const r = compute(
      [hd('t', 1), hd('c', 2), hd('s', 3)],
      'strict',
      [{ stableIdentity: 'f1', objectKind: 'figure', precedingHeadingCount: 3 }],
      configs('section-dash'),
    )
    expect(r[0].chapterOrdinal).toBe(1)
    expect(r[0].sectionOrdinal).toBe(1)
    expect(r[0].rawNumber).toBe('1.1-1')
    expect(r[0].renderedLabel).toBe('图 1.1-1')
  })

  it('6A-AUTH-3: strict H1 title is not Chapter', () => {
    const r = compute(
      [hd('t', 1)],
      'strict',
      [{ stableIdentity: 'f1', objectKind: 'figure', precedingHeadingCount: 1 }],
      configs('section-dash'),
    )
    expect(r[0].effectiveScope).toBe('global')
    expect(r[0].rawNumber).toBe('1')
  })

  it('6A-AUTH-6: section request falls back SECTION→CHAPTER→GLOBAL', () => {
    const r = compute(
      [hd('t', 1), hd('c', 2)],
      'strict',
      [{ stableIdentity: 'f1', objectKind: 'figure', precedingHeadingCount: 2 }],
      configs('section-dash'),
    )
    expect(r[0].effectiveScope).toBe('chapter')
    expect(r[0].rawNumber).toBe('1-1')
  })

  it('6A-AUTH-5: loose branch-local compression (H2→H4 → chapter/section)', () => {
    const r = compute(
      [hd('c', 2), hd('s', 4)],
      'loose',
      [{ stableIdentity: 'f1', objectKind: 'figure', precedingHeadingCount: 2 }],
      configs('section-dash'),
    )
    expect(r[0].chapterOrdinal).toBe(1)
    expect(r[0].sectionOrdinal).toBe(1)
    expect(r[0].rawNumber).toBe('1.1-1')
  })

  it('6A-AUTH-7: Figure/Table/Code counters are independent', () => {
    const objects: CaptionObjectEntry[] = [
      { stableIdentity: 'F1', objectKind: 'figure', precedingHeadingCount: 3 },
      { stableIdentity: 'T1', objectKind: 'table', precedingHeadingCount: 3 },
      { stableIdentity: 'F2', objectKind: 'figure', precedingHeadingCount: 3 },
      { stableIdentity: 'C1', objectKind: 'code', precedingHeadingCount: 3 },
    ]
    const r = compute([hd('t', 1), hd('c', 2), hd('s', 3)], 'strict', objects, configs('section-dash'))
    expect(r.map(x => `${x.objectKind}:${x.rawNumber}`)).toEqual([
      'figure:1.1-1',
      'table:1.1-1',
      'figure:1.1-2',
      'code:1.1-1',
    ])
  })

  it('6A-AUTH-8: standard preset uses `preset` even if legacy fields disagree', () => {
    const cfg: ProductionObjectConfigs = {
      figure: config('section-dash', { numberingMode: 'continuous', template: '{n}' }),
      table: config('section-dash'),
      code: config('section-dash'),
    }
    const r = compute(
      [hd('t', 1), hd('c', 2), hd('s', 3)],
      'strict',
      [{ stableIdentity: 'f1', objectKind: 'figure', precedingHeadingCount: 3 }],
      cfg,
    )
    expect(r[0].rawNumber).toBe('1.1-1') // preset wins over legacy template {n}
  })

  it('6A-AUTH-9: legacy-custom preserves template syntax with semantic chapter/section input', () => {
    const cfg: ProductionObjectConfigs = {
      figure: config('legacy-custom', { template: '{chapter}/{section}/{n}' }),
      table: config('legacy-custom', { template: '{chapter}/{section}/{n}' }),
      code: config('legacy-custom', { template: '{chapter}/{section}/{n}' }),
    }
    const r = compute(
      [hd('t', 1), hd('c', 2), hd('s', 3)],
      'strict',
      [{ stableIdentity: 'f1', objectKind: 'figure', precedingHeadingCount: 3 }],
      cfg,
    )
    expect(r[0].rawNumber).toBe('1/1/1')
  })

  it('6A-AUTH-2: rendered heading label text does not affect caption number', () => {
    const a = compute(
      [hd('t', 1, '一、'), hd('c', 2, '1.1'), hd('s', 3, '(I)')],
      'strict',
      [{ stableIdentity: 'f1', objectKind: 'figure', precedingHeadingCount: 3 }],
      configs('section-dash'),
    )
    const b = compute(
      [hd('t', 1, 'Document'), hd('c', 2, 'Chapter'), hd('s', 3, 'Section')],
      'strict',
      [{ stableIdentity: 'f1', objectKind: 'figure', precedingHeadingCount: 3 }],
      configs('section-dash'),
    )
    expect(a[0].rawNumber).toBe(b[0].rawNumber)
  })

  it('startAt / minDigits enter production desired state', () => {
    const cfg: ProductionObjectConfigs = {
      figure: config('section-dash', { startAt: 3, minDigits: 2 }),
      table: config('section-dash'),
      code: config('section-dash'),
    }
    const r = compute(
      [hd('t', 1), hd('c', 2), hd('s', 3)],
      'strict',
      [{ stableIdentity: 'f1', objectKind: 'figure', precedingHeadingCount: 3 }],
      cfg,
    )
    expect(r[0].rawNumber).toBe('1.1-03') // startAt=3 -> ordinal 3; minDigits=2 -> 03
  })
})

describe('6A-AUTH-10 — bridge does not parse DOM heading numbers', () => {
  it('caption-semantic-bridge imports the heading snapshot, not the DOM-number resolver', () => {
    const src = readFileSync(fileURLToPath(new URL('./caption-semantic-bridge.ts', import.meta.url)), 'utf8')
    expect(src).not.toContain("from './heading-context-resolver'")
    expect(src).toContain('HeadingNumberingSnapshot')
  })
})
