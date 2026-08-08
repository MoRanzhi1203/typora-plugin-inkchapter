import { describe, it, expect } from 'vitest'
import {
  saveHeadingSettings,
  resolveEffectiveSettings,
  getDefaultHeadingNumberingSettings,
} from './heading-numbering-scope-store'
import { resolveHeadingStructure } from './heading-structure'
import type {
  HeadingNumberingScopeStore,
  HeadingNumberingSettings,
} from './heading-types'
import { getPresetLevels } from './presets'

function makeStore(
  globalSettings?: Partial<HeadingNumberingSettings>,
): HeadingNumberingScopeStore {
  const globalDefault = { ...getDefaultHeadingNumberingSettings(), ...globalSettings }
  return {
    schemaVersion: 1,
    globalDefault: globalDefault as any,
    globalParagraphLayout: { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true },
    documentOverrides: {},
  }
}

describe('applyPresetToScope mode preservation', () => {
  it('global strict + apply preset to document scope → document stays strict', () => {
    const store = makeStore({ headingStructureMode: 'strict' })
    const levels = getPresetLevels('decimal-hierarchical')
    const snapshot: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'decimal-hierarchical',
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    const updated = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-a', settings: snapshot })
    const ctx = resolveEffectiveSettings(updated, 'doc-a')
    const structure = resolveHeadingStructure(ctx.effectiveSettings)
    expect(structure.mode).toBe('strict')
  })

  it('global loose + apply preset to document scope → document stays loose', () => {
    const store = makeStore({ headingStructureMode: 'loose', showLevelOneNumber: true })
    const levels = getPresetLevels('decimal-hierarchical')
    const snapshot: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'loose',
      showLevelOneNumber: true,
      preset: 'decimal-hierarchical',
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    const updated = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-b', settings: snapshot })
    const ctx = resolveEffectiveSettings(updated, 'doc-b')
    expect(resolveHeadingStructure(ctx.effectiveSettings).mode).toBe('loose')
  })

  it('document strict override + apply preset to global → global stays loose, doc stays strict', () => {
    const store = makeStore({ headingStructureMode: 'loose', showLevelOneNumber: true })
    // First set doc to strict
    const docStrict: HeadingNumberingSettings = { ...getDefaultHeadingNumberingSettings(), headingStructureMode: 'strict', showLevelOneNumber: false }
    let updated = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-c', settings: docStrict })
    // Then apply preset to global (preserving global mode=loose)
    const levels = getPresetLevels('roman-hierarchical')
    const globalSnapshot: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'loose',
      showLevelOneNumber: true,
      preset: 'roman-hierarchical',
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    updated = saveHeadingSettings(updated, { scope: 'global', documentKey: null, settings: globalSnapshot })
    const ctxGlobal = resolveEffectiveSettings(updated, null)
    expect(resolveHeadingStructure(ctxGlobal.effectiveSettings).mode).toBe('loose')
    const ctxDoc = resolveEffectiveSettings(updated, 'doc-c')
    expect(resolveHeadingStructure(ctxDoc.effectiveSettings).mode).toBe('strict')
  })

  it('strict + apply roman-hierarchical → stays strict', () => {
    const store = makeStore({ headingStructureMode: 'strict' })
    const levels = getPresetLevels('roman-hierarchical')
    const snapshot: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'roman-hierarchical',
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    const updated = saveHeadingSettings(store, { scope: 'global', documentKey: null, settings: snapshot })
    const ctx = resolveEffectiveSettings(updated, null)
    expect(resolveHeadingStructure(ctx.effectiveSettings).mode).toBe('strict')
  })

  it('loose + apply roman-hierarchical → stays loose', () => {
    const store = makeStore({ headingStructureMode: 'loose', showLevelOneNumber: true })
    const levels = getPresetLevels('roman-hierarchical')
    const snapshot: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'loose',
      showLevelOneNumber: true,
      preset: 'roman-hierarchical',
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    const updated = saveHeadingSettings(store, { scope: 'global', documentKey: null, settings: snapshot })
    const ctx = resolveEffectiveSettings(updated, null)
    expect(resolveHeadingStructure(ctx.effectiveSettings).mode).toBe('loose')
  })
})

describe('applyFormatToScope mode preservation', () => {
  it('strict doc + apply legacy loose custom format (showLevelOneNumber=true) → stays strict', () => {
    const store = makeStore({ headingStructureMode: 'strict' })
    const snapshot: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'custom',
      maxDepth: 6,
      levels: getPresetLevels('decimal-hierarchical'),
      customDefinition: getPresetLevels('decimal-hierarchical'),
    }
    const formatSource = { type: 'custom' as const, formatId: 'legacy-loose', version: 1 }
    const updated = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-d', settings: snapshot, formatSource })
    expect(resolveHeadingStructure(updated.documentOverrides['doc-d'].settings).mode).toBe('strict')
    expect(updated.documentOverrides['doc-d'].formatSource).toEqual(formatSource)
  })

  it('loose doc + apply legacy strict custom format (showLevelOneNumber=false) → stays loose', () => {
    const store = makeStore({ headingStructureMode: 'loose', showLevelOneNumber: true })
    const snapshot: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'loose',
      showLevelOneNumber: true,
      preset: 'custom',
      maxDepth: 6,
      levels: getPresetLevels('decimal-hierarchical'),
      customDefinition: getPresetLevels('decimal-hierarchical'),
    }
    const updated = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-e', settings: snapshot })
    expect(resolveHeadingStructure(updated.documentOverrides['doc-e'].settings).mode).toBe('loose')
  })

  it('custom format formatSource preserved correctly', () => {
    const store = makeStore({ headingStructureMode: 'strict' })
    const snapshot: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'custom',
      maxDepth: 6,
      levels: getPresetLevels('decimal-hierarchical'),
      customDefinition: getPresetLevels('decimal-hierarchical'),
    }
    const formatSource = { type: 'custom' as const, formatId: 'fmt-abcd', version: 3 }
    const updated = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-f', settings: snapshot, formatSource })
    const docFmt = updated.documentOverrides['doc-f'].formatSource
    expect(docFmt?.type).toBe('custom')
    if (docFmt?.type === 'custom') {
      expect(docFmt.formatId).toBe('fmt-abcd')
      expect(docFmt.version).toBe(3)
    }
  })

  it('layoutOverrides preserved when applying format', () => {
    const store = makeStore({ headingStructureMode: 'strict' })
    const snapshot: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'custom',
      maxDepth: 6,
      levels: getPresetLevels('decimal-hierarchical'),
      customDefinition: getPresetLevels('decimal-hierarchical'),
      headingLayouts: {
        h1: { textAlign: 'center', firstLineIndentEm: 0 },
        h2: { textAlign: 'left', firstLineIndentEm: 2 },
        h3: { textAlign: 'left', firstLineIndentEm: 0 },
        h4: { textAlign: 'left', firstLineIndentEm: 0 },
        h5: { textAlign: 'left', firstLineIndentEm: 0 },
        h6: { textAlign: 'left', firstLineIndentEm: 0 },
      },
    }
    const updated = saveHeadingSettings(store, { scope: 'document', documentKey: 'doc-g', settings: snapshot })
    const ctx = resolveEffectiveSettings(updated, 'doc-g')
    expect(ctx.effectiveSettings.headingLayouts?.h1.textAlign).toBe('center')
  })
})
