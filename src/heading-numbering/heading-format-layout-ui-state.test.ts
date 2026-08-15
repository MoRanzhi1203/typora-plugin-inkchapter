import { describe, it, expect } from 'vitest'
import {
  resolveHeadingLayoutsForMode,
  deepCloneSettings,
  resolveEffectiveSettings,
  saveHeadingSettings,
  saveLayoutOverrides,
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
  return { h1: cfg(), h2: cfg(), h3: cfg(), h4: cfg(), h5: cfg(), h6: cfg(), ...overrides }
}

function settings(overrides: Partial<HeadingNumberingSettings> = {}): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: 'strict',
    showLevelOneNumber: false,
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: {} as HeadingNumberingSettings['levels'],
    headingLayoutsByMode: { loose: layouts(), strict: layouts() },
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

describe('UI/state: ④ 标题排版 (per-mode, physical H1-H6)', () => {
  it('UI-STATE-1: switching loose/strict shows each mode own layout', () => {
    const s = settings({
      headingLayoutsByMode: {
        loose: layouts({ h2: cfg({ textAlign: 'center', firstLineIndentEm: 2 }) }),
        strict: layouts({ h2: cfg({ textAlign: 'right', firstLineIndentEm: 0 }) }),
      },
    })
    expect(resolveHeadingLayoutsForMode(s, 'loose').h2.textAlign).toBe('center')
    expect(resolveHeadingLayoutsForMode(s, 'strict').h2.textAlign).toBe('right')
    // Switching mode must surface different data, not one shared object.
    expect(resolveHeadingLayoutsForMode(s, 'loose')).not.toBe(resolveHeadingLayoutsForMode(s, 'strict'))
  })

  it('UI-STATE-2: editing H2 only edits real H2 (never H1)', () => {
    const base = settings({
      headingLayoutsByMode: {
        loose: layouts({ h1: cfg({ textAlign: 'center' }), h2: cfg({ textAlign: 'left' }) }),
        strict: layouts({ h1: cfg({ textAlign: 'left' }), h2: cfg({ textAlign: 'left' }) }),
      },
    })
    const store = storeWith(base)
    const override: DocumentLayoutOverrides = {
      headingLayoutsByMode: { strict: { h2: cfg({ textAlign: 'center', firstLineIndentEm: 0 }) } },
    }
    const after = saveLayoutOverrides(store, 'doc-a', override)
    const resolved = resolveEffectiveSettings(after, 'doc-a').effectiveSettings

    const strict = resolveHeadingLayoutsForMode(resolved, 'strict')
    expect(strict.h2.textAlign).toBe('center') // edited
    expect(strict.h1.textAlign).toBe('left') // untouched
    expect(resolveHeadingLayoutsForMode(resolved, 'loose').h1.textAlign).toBe('center') // other mode untouched
  })

  it('UI-STATE-3: cancel restores layout (full snapshot)', () => {
    const original = settings({
      headingLayoutsByMode: {
        loose: layouts({ h3: cfg({ textAlign: 'left' }) }),
        strict: layouts({ h3: cfg({ textAlign: 'left' }) }),
      },
    })
    const edited = deepCloneSettings(original)
    edited.headingLayoutsByMode!.strict.h3 = cfg({ textAlign: 'center', firstLineIndentEm: 0 })

    // Persist the edit.
    const saved = saveHeadingSettings(storeWith(original), {
      scope: 'document', documentKey: 'doc-a', settings: edited,
    })
    expect(resolveHeadingLayoutsForMode(resolveEffectiveSettings(saved, 'doc-a').effectiveSettings, 'strict').h3.textAlign).toBe('center')

    // Cancel = restore the pre-edit store.
    expect(resolveHeadingLayoutsForMode(resolveEffectiveSettings(storeWith(original), 'doc-a').effectiveSettings, 'strict').h3.textAlign).toBe('left')
  })

  it('UI-STATE-4: save then re-enter still correct', () => {
    const base = settings({
      headingLayoutsByMode: {
        loose: layouts({ h4: cfg({ textAlign: 'left' }) }),
        strict: layouts({ h4: cfg({ textAlign: 'left' }) }),
      },
    })
    const docSettings = settings({
      headingLayoutsByMode: {
        loose: layouts({ h4: cfg({ textAlign: 'left' }) }),
        strict: layouts({ h4: cfg({ textAlign: 'center', firstLineIndentEm: 2 }) }),
      },
    })
    const saved = saveHeadingSettings(storeWith(base), { scope: 'document', documentKey: 'doc-a', settings: docSettings })

    // Re-entering (re-resolving from the persisted store) must return the saved value.
    const resolved = resolveEffectiveSettings(saved, 'doc-a').effectiveSettings
    expect(resolveHeadingLayoutsForMode(resolved, 'strict').h4.textAlign).toBe('center')
    expect(resolveHeadingLayoutsForMode(resolved, 'strict').h4.firstLineIndentEm).toBe(2)
  })

  it('UI-STATE-5: batch setting does not pollute the other mode', () => {
    const base = settings({
      headingLayoutsByMode: {
        loose: layouts({ h2: cfg({ textAlign: 'left' }), h3: cfg({ textAlign: 'left' }), h4: cfg({ textAlign: 'left' }) }),
        strict: layouts({ h2: cfg({ textAlign: 'left' }), h3: cfg({ textAlign: 'left' }), h4: cfg({ textAlign: 'left' }) }),
      },
    })
    const store = storeWith(base)
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

    const strict = resolveHeadingLayoutsForMode(resolved, 'strict')
    const loose = resolveHeadingLayoutsForMode(resolved, 'loose')
    expect(strict.h2.textAlign).toBe('center')
    expect(strict.h4.textAlign).toBe('center')
    expect(loose.h2.textAlign).toBe('left')
    expect(loose.h3.textAlign).toBe('left')
    expect(loose.h4.textAlign).toBe('left')
  })
})
