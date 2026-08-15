import { describe, it, expect } from 'vitest'
import {
  resolveHeadingLayoutsForMode,
  normalizeHeadingLayoutsByMode,
  deepMergeSettings,
  deepCloneSettings,
  resolveEffectiveSettings,
  saveHeadingSettings,
  saveLayoutOverrides,
  getDefaultHeadingNumberingSettings,
  DEFAULT_HEADING_LAYOUTS,
} from './heading-numbering-scope-store'
import type {
  HeadingNumberingSettings,
  HeadingNumberingScopeStore,
  HeadingLayoutSettings,
  HeadingLayoutConfig,
  DocumentLayoutOverrides,
} from './heading-types'

function cfg(overrides: Partial<HeadingLayoutConfig> = {}): HeadingLayoutConfig {
  return { textAlign: 'left', firstLineIndentEm: 0, ...overrides }
}

function layouts(overrides: Partial<HeadingLayoutSettings> = {}): HeadingLayoutSettings {
  return {
    h1: cfg(), h2: cfg(), h3: cfg(), h4: cfg(), h5: cfg(), h6: cfg(),
    ...overrides,
  }
}

function settings(overrides: Partial<HeadingNumberingSettings> = {}): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: 'strict',
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: {} as HeadingNumberingSettings['levels'],
    headingLayoutsByMode: {
      loose: layouts(),
      strict: layouts(),
    },
    ...overrides,
  }
}

function storeWith(global: HeadingNumberingSettings): HeadingNumberingScopeStore {
  return {
    schemaVersion: 1,
    globalDefault: global,
    documentOverrides: {},
    globalParagraphLayout: { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true },
  }
}

describe('HF-LAYOUT: heading layout isolation (per-mode, physical H1-H6)', () => {
  it('HF-LAYOUT-1: loose/strict layout are independent', () => {
    const s = settings({
      headingLayoutsByMode: {
        loose: layouts({ h2: cfg({ textAlign: 'center', firstLineIndentEm: 2 }) }),
        strict: layouts({ h2: cfg({ textAlign: 'left', firstLineIndentEm: 0 }) }),
      },
    })
    const loose = resolveHeadingLayoutsForMode(s, 'loose')
    const strict = resolveHeadingLayoutsForMode(s, 'strict')
    expect(loose.h2.textAlign).toBe('center')
    expect(strict.h2.textAlign).toBe('left')
    expect(loose).not.toBe(strict)
  })

  it('HF-LAYOUT-2: modifying strict.H2 does not affect loose.H2', () => {
    const s = settings({
      headingLayoutsByMode: {
        loose: layouts({ h2: cfg({ textAlign: 'center', firstLineIndentEm: 2 }) }),
        strict: layouts({ h2: cfg({ textAlign: 'left', firstLineIndentEm: 0 }) }),
      },
    })
    const clone = deepCloneSettings(s)
    clone.headingLayoutsByMode!.strict.h2 = cfg({ textAlign: 'right', firstLineIndentEm: 0 })
    expect(clone.headingLayoutsByMode!.strict.h2.textAlign).toBe('right')
    expect(s.headingLayoutsByMode!.strict.h2.textAlign).toBe('left') // original unchanged
    expect(s.headingLayoutsByMode!.loose.h2.textAlign).toBe('center') // loose unaffected
    expect(clone.headingLayoutsByMode!.loose.h2.textAlign).toBe('center')
  })

  it('HF-LAYOUT-3: modifying strict.H2 does not affect loose.H1', () => {
    const s = settings({
      headingLayoutsByMode: {
        loose: layouts({ h1: cfg({ textAlign: 'center' }), h2: cfg({ textAlign: 'left' }) }),
        strict: layouts({ h1: cfg({ textAlign: 'left' }), h2: cfg({ textAlign: 'left' }) }),
      },
    })
    const clone = deepCloneSettings(s)
    clone.headingLayoutsByMode!.strict.h2 = cfg({ textAlign: 'right', firstLineIndentEm: 0 })
    expect(s.headingLayoutsByMode!.loose.h1.textAlign).toBe('center') // unchanged
    expect(clone.headingLayoutsByMode!.loose.h1.textAlign).toBe('center')
  })

  it('HF-LAYOUT-4: real Hn resolver does NOT level shift (strict H2 != loose H1)', () => {
    const s = settings({
      headingLayoutsByMode: {
        loose: layouts({ h1: cfg({ textAlign: 'center' }), h2: cfg({ textAlign: 'left' }) }),
        strict: layouts({ h2: cfg({ textAlign: 'right', firstLineIndentEm: 2 }) }),
      },
    })
    const strict = resolveHeadingLayoutsForMode(s, 'strict')
    // strict physical H2 must use strict.h2, NOT loose.h1
    expect(strict.h2.textAlign).toBe('right')
    expect(strict.h2.firstLineIndentEm).toBe(2)
    expect(strict.h2).not.toEqual(s.headingLayoutsByMode!.loose.h1)
  })

  it('HF-LAYOUT-5: document effective range does not change layout key', () => {
    // The layout resolver is indexed by physical H1-H6 only. Even in strict
    // mode (numbering starts at H2), physical H2 resolves to layout.h2.
    const s = settings({
      headingStructureMode: 'strict',
      headingLayoutsByMode: {
        loose: layouts({ h1: cfg({ textAlign: 'center' }), h2: cfg({ textAlign: 'left' }) }),
        strict: layouts({ h2: cfg({ textAlign: 'right', firstLineIndentEm: 2 }) }),
      },
    })
    const strict = resolveHeadingLayoutsForMode(s, 'strict')
    expect(strict.h2).toEqual(s.headingLayoutsByMode!.strict.h2)
    expect(strict.h2).not.toEqual(s.headingLayoutsByMode!.strict.h1)
  })

  it('HF-LAYOUT-6: save/cancel fully includes per-mode layout', () => {
    const base = settings({
      headingLayoutsByMode: {
        loose: layouts({ h3: cfg({ textAlign: 'left' }) }),
        strict: layouts({ h3: cfg({ textAlign: 'left' }) }),
      },
    })
    const store = storeWith(base)

    // Save a document override with a per-mode layout change (strict H3 → center).
    const docSettings = settings({
      headingStructureMode: 'strict',
      headingLayoutsByMode: {
        loose: layouts({ h3: cfg({ textAlign: 'left' }) }),
        strict: layouts({ h3: cfg({ textAlign: 'center', firstLineIndentEm: 0 }) }),
      },
    })
    const saved = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-a', settings: docSettings })

    const resolved = resolveEffectiveSettings(saved, 'doc-a').effectiveSettings
    expect(resolveHeadingLayoutsForMode(resolved, 'strict').h3.textAlign).toBe('center')

    // "Cancel": restore a deep clone of the pre-edit store — layout must revert.
    const restored = resolveEffectiveSettings(store, 'doc-a').effectiveSettings
    expect(resolveHeadingLayoutsForMode(restored, 'strict').h3.textAlign).toBe('left')
  })

  it('HF-LAYOUT-7: save-as / deep clone keeps layout fully independent', () => {
    const s = settings({
      headingLayoutsByMode: {
        loose: layouts({ h4: cfg({ textAlign: 'left' }) }),
        strict: layouts({ h4: cfg({ textAlign: 'left' }) }),
      },
    })
    const clone = deepCloneSettings(s)
    clone.headingLayoutsByMode!.strict.h4 = cfg({ textAlign: 'center', firstLineIndentEm: 0 })
    expect(clone.headingLayoutsByMode!.strict.h4.textAlign).toBe('center')
    expect(s.headingLayoutsByMode!.strict.h4.textAlign).toBe('left')
    expect(clone.headingLayoutsByMode).not.toBe(s.headingLayoutsByMode)
    expect(clone.headingLayoutsByMode!.strict).not.toBe(s.headingLayoutsByMode!.strict)
  })

  it('HF-LAYOUT-8: legacy shared layout migrates to deep-cloned per-mode layouts', () => {
    const legacy = settings({
      headingLayouts: layouts({ h2: cfg({ textAlign: 'center', firstLineIndentEm: 2 }) }),
      headingLayoutsByMode: undefined,
    })
    const store = normalizeHeadingLayoutsByMode(storeWith(legacy))
    const normalized = store.globalDefault.headingLayoutsByMode!
    expect(normalized.loose.h2.textAlign).toBe('center')
    expect(normalized.strict.h2.textAlign).toBe('center')
    expect(normalized.loose).not.toBe(normalized.strict)
    expect(normalized.loose.h2).not.toBe(normalized.strict.h2)

    // Mutating one mode must not affect the other.
    normalized.loose.h2 = cfg({ textAlign: 'right' })
    expect(normalized.strict.h2.textAlign).toBe('center')
  })

  it('HF-LAYOUT-9: preview and editor resolver share identical semantics', () => {
    const s = settings({
      headingLayoutsByMode: {
        loose: layouts({ h5: cfg({ textAlign: 'center' }) }),
        strict: layouts({ h5: cfg({ textAlign: 'right', firstLineIndentEm: 2 }) }),
      },
    })
    const preview = resolveHeadingLayoutsForMode(s, 'strict')
    const editor = resolveHeadingLayoutsForMode(s, 'strict')
    expect(preview).toEqual(editor)
    expect(preview.h5).toEqual(s.headingLayoutsByMode!.strict.h5)
  })

  it('HF-LAYOUT-10: batch setting only affects current mode + target levels', () => {
    const base = settings({
      headingLayoutsByMode: {
        loose: layouts({ h2: cfg({ textAlign: 'left' }), h3: cfg({ textAlign: 'left' }), h4: cfg({ textAlign: 'left' }) }),
        strict: layouts({ h2: cfg({ textAlign: 'left' }), h3: cfg({ textAlign: 'left' }), h4: cfg({ textAlign: 'left' }) }),
      },
    })
    const store = storeWith(base)

    // Batch: strict H2-H4 → center (per-mode partial override).
    const batch: DocumentLayoutOverrides = {
      headingLayoutsByMode: {
        strict: {
          h2: cfg({ textAlign: 'center', firstLineIndentEm: 0 }),
          h3: cfg({ textAlign: 'center', firstLineIndentEm: 0 }),
          h4: cfg({ textAlign: 'center', firstLineIndentEm: 0 }),
        },
      },
    }
    const after = saveLayoutOverrides(store, 'doc-a', batch)
    const resolved = resolveEffectiveSettings(after, 'doc-a').effectiveSettings

    expect(resolveHeadingLayoutsForMode(resolved, 'strict').h2.textAlign).toBe('center')
    expect(resolveHeadingLayoutsForMode(resolved, 'strict').h3.textAlign).toBe('center')
    expect(resolveHeadingLayoutsForMode(resolved, 'strict').h4.textAlign).toBe('center')
    // Loose mode is unaffected.
    expect(resolveHeadingLayoutsForMode(resolved, 'loose').h2.textAlign).toBe('left')
    expect(resolveHeadingLayoutsForMode(resolved, 'loose').h4.textAlign).toBe('left')
  })

  it('HF-LAYOUT: default settings expose independent loose/strict layouts', () => {
    const d = getDefaultHeadingNumberingSettings()
    expect(d.headingLayoutsByMode).toBeDefined()
    expect(d.headingLayoutsByMode!.loose).not.toBe(d.headingLayoutsByMode!.strict)
    expect(d.headingLayoutsByMode!.loose.h1).toEqual(DEFAULT_HEADING_LAYOUTS.h1)
  })
})
