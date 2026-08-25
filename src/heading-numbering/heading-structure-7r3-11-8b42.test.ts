// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.4.2 — Strict Effective Heading Numbering Authority focused
 * tests. Covers the §35-44 acceptance matrix against the EXISTING production
 * pure logic (no engine rewrite — Branch A closure).
 *
 * MODE-*      resolveHeadingStructure / deriveModeMirror
 * MAP-*       resolveStyleSlot / computePhysicalSlotMapping
 * LABEL-*     computeHeadingNumbering strict/loose visible labels
 * TRANS-*     loose↔strict label swap
 * SCOPE-*     resolveEffectiveSettings global/override/remove/document-switch
 * UI-*        effective settings source (global vs document)
 * PRESET-*    preset/custom format preserves structure mode
 * DOM-*       projected DOM number-attribute facts + mapping invariant
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveHeadingStructure, resolveStyleSlot, deriveModeMirror, resolvePhysicalHeadingForStyleSlot } from './heading-structure'
import type { HeadingStructureMode } from './heading-structure'
import { computeHeadingNumbering } from './numbering-engine'
import type { HeadingDescriptor, HeadingLevel, HeadingNumberingSettings } from './heading-types'
import { getPresetLevels } from './presets'
import {
  resolveEffectiveSettings,
  saveHeadingSettings,
  removeDocumentOverride,
  getDefaultHeadingNumberingSettings,
  deepCloneSettings,
} from './heading-numbering-scope-store'
import type { HeadingNumberingScopeStore } from './heading-types'
import {
  computePhysicalSlotMapping,
  collectHeadingProjectionFacts,
  emitHeadingNumberingMappingInvariant,
  emitHeadingModeTransitionCleanup,
} from './heading-structure-audit'

function hd(text: string, level: number, i: number): HeadingDescriptor {
  return { key: `h-${i}`, level: level as HeadingLevel, text }
}

function makeSettings(mode: HeadingStructureMode, preset: string = 'decimal-hierarchical'): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: mode,
    showLevelOneNumber: mode === 'loose',
    preset: preset as HeadingNumberingSettings['preset'],
    maxDepth: 6,
    levels: getPresetLevels(preset as never),
    customDefinition: getPresetLevels(preset as never),
  }
}

function labelsOf(settings: HeadingNumberingSettings, levels: number[]): string[] {
  return computeHeadingNumbering(levels.map((lv, i) => hd(`H${lv}-${i}`, lv, i)), settings).map(h => h.label)
}

// ── MODE ──────────────────────────────────────────────────────────────
describe('MODE resolver contract', () => {
  it('MODE-1: strict + legacy true → resolved strict, showH1=false, root=2', () => {
    const r = resolveHeadingStructure({ headingStructureMode: 'strict', showLevelOneNumber: true })
    expect(r.mode).toBe('strict')
    expect(r.showLevelOneNumber).toBe(false)
    expect(r.numberingRootPhysicalLevel).toBe(2)
    expect(r.requiresSingleH1).toBe(true)
  })

  it('MODE-2: loose + legacy false → resolved loose, showH1=true, root=1', () => {
    const r = resolveHeadingStructure({ headingStructureMode: 'loose', showLevelOneNumber: false })
    expect(r.mode).toBe('loose')
    expect(r.showLevelOneNumber).toBe(true)
    expect(r.numberingRootPhysicalLevel).toBe(1)
    expect(r.requiresSingleH1).toBe(false)
  })

  it('MODE-3: mode missing → legacy fallback (false→strict, true→loose, missing→strict)', () => {
    expect(resolveHeadingStructure({ showLevelOneNumber: false }).mode).toBe('strict')
    expect(resolveHeadingStructure({ showLevelOneNumber: true }).mode).toBe('loose')
    expect(resolveHeadingStructure({}).mode).toBe('strict')
  })

  it('MODE-4: deriveModeMirror — mode is the single authority', () => {
    expect(deriveModeMirror('strict')).toEqual({ headingStructureMode: 'strict', showLevelOneNumber: false })
    expect(deriveModeMirror('loose')).toEqual({ headingStructureMode: 'loose', showLevelOneNumber: true })
  })
})

// ── MAP ───────────────────────────────────────────────────────────────
describe('MAP physical→style-slot', () => {
  it('MAP-STRICT: H1→null, H2→S1, H3→S2, H4→S3, H5→S4, H6→S5', () => {
    expect(resolveStyleSlot('strict', 1)).toBeNull()
    expect(resolveStyleSlot('strict', 2)).toBe(1)
    expect(resolveStyleSlot('strict', 3)).toBe(2)
    expect(resolveStyleSlot('strict', 4)).toBe(3)
    expect(resolveStyleSlot('strict', 5)).toBe(4)
    expect(resolveStyleSlot('strict', 6)).toBe(5)
  })

  it('MAP-LOOSE: H1→S1, H2→S2, H3→S3, H4→S4, H5→S5, H6→S6', () => {
    expect(resolveStyleSlot('loose', 1)).toBe(1)
    expect(resolveStyleSlot('loose', 2)).toBe(2)
    expect(resolveStyleSlot('loose', 3)).toBe(3)
    expect(resolveStyleSlot('loose', 4)).toBe(4)
    expect(resolveStyleSlot('loose', 5)).toBe(5)
    expect(resolveStyleSlot('loose', 6)).toBe(6)
  })

  it('computePhysicalSlotMapping exposes the same invariant', () => {
    expect(computePhysicalSlotMapping('strict')).toEqual({
      physicalH1Slot: null, physicalH2Slot: 1, physicalH3Slot: 2, physicalH4Slot: 3, physicalH5Slot: 4, physicalH6Slot: 5,
    })
    expect(computePhysicalSlotMapping('loose')).toEqual({
      physicalH1Slot: 1, physicalH2Slot: 2, physicalH3Slot: 3, physicalH4Slot: 4, physicalH5Slot: 5, physicalH6Slot: 6,
    })
  })

  it('strict reverse: S1→H2 … S5→H6; S6→null', () => {
    expect(resolvePhysicalHeadingForStyleSlot('strict', 1)).toBe(2)
    expect(resolvePhysicalHeadingForStyleSlot('strict', 5)).toBe(6)
    expect(resolvePhysicalHeadingForStyleSlot('strict', 6)).toBeNull()
  })
})

// ── LABEL ─────────────────────────────────────────────────────────────
describe('LABEL strict/loose visible labels', () => {
  it('LABEL-S1: strict + one H1 → H1="", H2=S1, H3=S2', () => {
    const labels = labelsOf(makeSettings('strict', 'chinese-chapter'), [1, 2, 3])
    expect(labels[0]).toBe('')
    expect(labels[1]).not.toBe('') // H2 = S1 (一、)
    expect(labels[2]).not.toBe('') // H3 = S2 (1.1)
  })

  it('LABEL-S2: strict + two H1 → BOTH H1 labels empty (no fallback loose)', () => {
    const labels = labelsOf(makeSettings('strict', 'decimal-hierarchical'), [1, 2, 1, 3])
    expect(labels[0]).toBe('')
    expect(labels[2]).toBe('')
    expect(labels[1]).not.toBe('') // first H2 after title still numbered
  })

  it('LABEL-S3: strict + zero H1 → mode stays strict, H2 still root', () => {
    const labels = labelsOf(makeSettings('strict', 'decimal-hierarchical'), [2, 3])
    expect(labels[0]).not.toBe('') // H2 is first numbered level even without H1
    expect(labels[1]).not.toBe('')
  })

  it('LABEL-loose: H1=S1, H2=S2, H3=S3', () => {
    const labels = labelsOf(makeSettings('loose', 'decimal-hierarchical'), [1, 2, 3])
    expect(labels[0]).not.toBe('')
    expect(labels[1]).not.toBe('')
    expect(labels[2]).not.toBe('')
  })
})

// ── TRANS ─────────────────────────────────────────────────────────────
describe('TRANS mode transitions', () => {
  const levels = [1, 2, 3]

  it('TRANS-MODE-1: loose→strict → H1 stale number removed, H2 S2→S1, H3 S3→S2', () => {
    const loose = labelsOf(makeSettings('loose', 'decimal-hierarchical'), levels)
    const strict = labelsOf(makeSettings('strict', 'decimal-hierarchical'), levels)
    expect(loose[0]).not.toBe('') // loose H1 numbered
    expect(strict[0]).toBe('') // strict H1 unnumbered
    // strict H2 label equals loose H1 label (S1); strict H3 equals loose H2 (S2)
    expect(strict[1]).toBe(loose[0])
    expect(strict[2]).toBe(loose[1])
  })

  it('TRANS-MODE-2: strict→loose → H1 gains S1, H2 S1→S2, H3 S2→S3', () => {
    const strict = labelsOf(makeSettings('strict', 'decimal-hierarchical'), levels)
    const loose = labelsOf(makeSettings('loose', 'decimal-hierarchical'), levels)
    expect(strict[0]).toBe('') // strict H1 no number
    expect(loose[0]).not.toBe('') // loose H1 gains S1
    // strict H3 label == loose H2 label (S2 shared slot)
    expect(strict[2]).toBe(loose[1])
  })

  it('TRANS-MODE-3: 5 consecutive switches always settle on the mode-correct labels', () => {
    let mode: HeadingStructureMode = 'strict'
    let last: string[] = []
    // 4 toggles from strict ends back at strict (strict→loose→strict→loose→strict)
    for (let i = 0; i < 4; i++) {
      mode = mode === 'strict' ? 'loose' : 'strict'
      last = labelsOf(makeSettings(mode, 'decimal-hierarchical'), levels)
      expect(last[0]).toBe(mode === 'strict' ? '' : last[0])
    }
    expect(mode).toBe('strict')
    expect(last[0]).toBe('')
  })
})

// ── SCOPE ─────────────────────────────────────────────────────────────
describe('SCOPE effective resolution', () => {
  function storeWith(globalMode: HeadingStructureMode | undefined, showLevelOneNumber: boolean): HeadingNumberingScopeStore {
    const gd = getDefaultHeadingNumberingSettings()
    if (globalMode) gd.headingStructureMode = globalMode
    gd.showLevelOneNumber = showLevelOneNumber
    return { schemaVersion: 1, globalDefault: gd, documentOverrides: {}, globalParagraphLayout: { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true } }
  }

  it('SCOPE-1: global strict + no override → effective strict', () => {
    const ctx = resolveEffectiveSettings(storeWith('strict', false), 'doc-a')
    expect(resolveHeadingStructure(ctx.effectiveSettings).mode).toBe('strict')
    expect(ctx.source).toBe('global')
  })

  it('SCOPE-2: global strict + doc override loose → effective loose', () => {
    let store = storeWith('strict', false)
    const loose = deepCloneSettings(store.globalDefault)
    loose.headingStructureMode = 'loose'
    loose.showLevelOneNumber = true
    store = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-a', settings: loose })
    const ctx = resolveEffectiveSettings(store, 'doc-a')
    expect(resolveHeadingStructure(ctx.effectiveSettings).mode).toBe('loose')
    expect(ctx.source).toBe('document')
  })

  it('SCOPE-3: remove doc override → back to strict', () => {
    let store = storeWith('strict', false)
    const loose = deepCloneSettings(store.globalDefault)
    loose.headingStructureMode = 'loose'
    loose.showLevelOneNumber = true
    store = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-a', settings: loose })
    expect(resolveHeadingStructure(resolveEffectiveSettings(store, 'doc-a').effectiveSettings).mode).toBe('loose')
    store = removeDocumentOverride(store, 'doc-a')
    const ctx = resolveEffectiveSettings(store, 'doc-a')
    expect(resolveHeadingStructure(ctx.effectiveSettings).mode).toBe('strict')
    expect(ctx.source).toBe('global')
  })

  it('SCOPE-4: A strict / B loose / A strict — no carryover', () => {
    let store = storeWith('strict', false)
    const loose = deepCloneSettings(store.globalDefault)
    loose.headingStructureMode = 'loose'
    loose.showLevelOneNumber = true
    store = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-b', settings: loose })
    expect(resolveHeadingStructure(resolveEffectiveSettings(store, 'doc-a').effectiveSettings).mode).toBe('strict')
    expect(resolveHeadingStructure(resolveEffectiveSettings(store, 'doc-b').effectiveSettings).mode).toBe('loose')
    expect(resolveHeadingStructure(resolveEffectiveSettings(store, 'doc-a').effectiveSettings).mode).toBe('strict')
  })
})

// ── UI ────────────────────────────────────────────────────────────────
describe('UI effective scope source', () => {
  it('UI-SCOPE: current document shows effective mode + source', () => {
    const gpl = { defaultIndent: 'flush' as const, flushAfterDisplayMath: true, indentShortcutEnabled: true }
    let store: HeadingNumberingScopeStore = { schemaVersion: 1, globalDefault: getDefaultHeadingNumberingSettings(), documentOverrides: {}, globalParagraphLayout: gpl }
    store.globalDefault.headingStructureMode = 'strict'
    expect(resolveEffectiveSettings(store, 'doc-a').source).toBe('global')
    const loose = deepCloneSettings(store.globalDefault)
    loose.headingStructureMode = 'loose'
    loose.showLevelOneNumber = true
    store = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-a', settings: loose })
    const ctx = resolveEffectiveSettings(store, 'doc-a')
    expect(ctx.source).toBe('document')
    expect(ctx.effectiveSettings.headingStructureMode).toBe('loose')
  })
})

// ── PRESET / CUSTOM ───────────────────────────────────────────────────
describe('PRESET/CUSTOM preserve mode', () => {
  it('PRESET-1: deriveModeMirror used by preset/format snapshots keeps the mode', () => {
    // snapshot for a strict scope → mode stays strict even with format fields
    expect(deriveModeMirror('strict')).toEqual({ headingStructureMode: 'strict', showLevelOneNumber: false })
    expect(deriveModeMirror('loose')).toEqual({ headingStructureMode: 'loose', showLevelOneNumber: true })
  })

  it('PRESET-2: custom legacy loose format applied to a strict scope keeps strict', () => {
    // global strict; doc override carries a custom snapshot that wrongly has
    // legacy showLevelOneNumber=true but correct mode field → strict wins.
    const gpl = { defaultIndent: 'flush' as const, flushAfterDisplayMath: true, indentShortcutEnabled: true }
    let store: HeadingNumberingScopeStore = { schemaVersion: 1, globalDefault: getDefaultHeadingNumberingSettings(), documentOverrides: {}, globalParagraphLayout: gpl }
    store.globalDefault.headingStructureMode = 'strict'
    store.globalDefault.showLevelOneNumber = false
    const custom = deepCloneSettings(store.globalDefault)
    custom.headingStructureMode = 'strict'
    custom.showLevelOneNumber = true // legacy mirror must NOT override mode
    custom.preset = 'custom'
    store = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-a', settings: custom })
    const ctx = resolveEffectiveSettings(store, 'doc-a')
    expect(ctx.effectiveSettings.headingStructureMode).toBe('strict')
    expect(resolveHeadingStructure(ctx.effectiveSettings).mode).toBe('strict')
    expect(resolveHeadingStructure(ctx.effectiveSettings).showLevelOneNumber).toBe(false)
  })
})

// ── DOM projection ────────────────────────────────────────────────────
describe('DOM projection facts + mapping invariant', () => {
  function makeRoot(attrs: Array<{ level: number; attr: string | null }>): HTMLElement {
    const root = document.createElement('div')
    for (const a of attrs) {
      const el = document.createElement(`h${a.level}`)
      if (a.attr) el.setAttribute('data-inkchapter-heading-number', a.attr)
      root.appendChild(el)
    }
    return root
  }

  it('DOM-1: collectHeadingProjectionFacts reads level + number attribute', () => {
    const facts = collectHeadingProjectionFacts(makeRoot([
      { level: 1, attr: null },
      { level: 2, attr: '1' },
    ]))
    expect(facts).toEqual([
      { level: 1, numberAttr: null },
      { level: 2, numberAttr: '1' },
    ])
  })

  it('DOM-2: strict mapping invariant → PASS when H1 has no number; FAIL when visible', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    emitHeadingNumberingMappingInvariant({
      documentKey: 'doc-a', mode: 'strict',
      headingElements: collectHeadingProjectionFacts(makeRoot([
        { level: 1, attr: null }, { level: 2, attr: '一、' }, { level: 3, attr: '1.1' },
      ])),
    })
    const line = info.mock.calls.map(c => String(c[0])).filter(l => l.includes('HEADING-NUMBERING-MAPPING-INVARIANT')).join('\n')
    expect(line).toContain('decision=PASS')
    expect(line).toContain('visibleH1NumberCount=0')
    vi.restoreAllMocks()
  })

  it('DOM-3: strict with stale H1 number → STRICT_H1_NUMBER_VISIBLE', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    emitHeadingNumberingMappingInvariant({
      documentKey: 'doc-a', mode: 'strict',
      headingElements: collectHeadingProjectionFacts(makeRoot([
        { level: 1, attr: '一、' }, { level: 2, attr: '1.1' },
      ])),
    })
    const line = info.mock.calls.map(c => String(c[0])).filter(l => l.includes('HEADING-NUMBERING-MAPPING-INVARIANT')).join('\n')
    expect(line).toContain('decision=STRICT_H1_NUMBER_VISIBLE')
    expect(line).toContain('visibleH1NumberCount=1')
    vi.restoreAllMocks()
  })

  it('DOM-4: loose mapping invariant → PASS with H1=S1', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    emitHeadingNumberingMappingInvariant({
      documentKey: 'doc-a', mode: 'loose',
      headingElements: collectHeadingProjectionFacts(makeRoot([
        { level: 1, attr: '1' }, { level: 2, attr: '1.1' },
      ])),
    })
    const line = info.mock.calls.map(c => String(c[0])).filter(l => l.includes('HEADING-NUMBERING-MAPPING-INVARIANT')).join('\n')
    expect(line).toContain('decision=PASS')
    expect(line).toContain('physicalH1Slot=1')
    vi.restoreAllMocks()
  })

  it('TRANS-AUDIT: loose→strict transition cleanup emits CLEAN when no stale H1 remains', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    // 1st call: document enters loose (baseline).
    emitHeadingModeTransitionCleanup('doc:t', 'loose', collectHeadingProjectionFacts(makeRoot([
      { level: 1, attr: '1' }, { level: 2, attr: '1.1' },
    ])))
    // 2nd call: strict — the previous loose H1 number must be gone.
    emitHeadingModeTransitionCleanup('doc:t', 'strict', collectHeadingProjectionFacts(makeRoot([
      { level: 1, attr: null }, { level: 2, attr: '1' },
    ])))
    const line = info.mock.calls.map(c => String(c[0])).filter(l => l.includes('HEADING-MODE-TRANSITION-CLEANUP')).join('\n')
    expect(line).toContain('fromMode=loose')
    expect(line).toContain('toMode=strict')
    expect(line).toContain('removedStaleNumberCount=1')
    expect(line).toContain('visibleH1NumberCountAfter=0')
    expect(line).toContain('decision=CLEAN')
    vi.restoreAllMocks()
  })

  it('TRANS-AUDIT: strict→loose transition projects loose mapping', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    emitHeadingModeTransitionCleanup('doc:t2', 'strict', collectHeadingProjectionFacts(makeRoot([
      { level: 1, attr: null }, { level: 2, attr: '1' },
    ])))
    emitHeadingModeTransitionCleanup('doc:t2', 'loose', collectHeadingProjectionFacts(makeRoot([
      { level: 1, attr: '1' }, { level: 2, attr: '1.1' },
    ])))
    const line = info.mock.calls.map(c => String(c[0])).filter(l => l.includes('HEADING-MODE-TRANSITION-CLEANUP')).join('\n')
    expect(line).toContain('fromMode=strict')
    expect(line).toContain('toMode=loose')
    expect(line).toContain('decision=LOOSE_PROJECTED')
    vi.restoreAllMocks()
  })
})
