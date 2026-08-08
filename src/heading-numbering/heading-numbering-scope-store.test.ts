import { describe, it, expect } from 'vitest'
import {
  resolveEffectiveSettings,
  saveHeadingSettings,
  removeDocumentOverride,
  getDefaultHeadingNumberingSettings,
  deepCloneSettings,
} from './heading-numbering-scope-store'
import type {
  HeadingNumberingScopeStore,
  HeadingNumberingSettings,
} from './heading-types'
import { resolveHeadingStructure } from './heading-structure'

// ── Helpers ─────────────────────────────────────────

function makeDefaults(): HeadingNumberingSettings {
  return getDefaultHeadingNumberingSettings()
}

function makeStore(
  globalSettings?: Partial<HeadingNumberingSettings>,
): HeadingNumberingScopeStore {
  const globalDefault = { ...makeDefaults(), ...globalSettings }
  return {
    schemaVersion: 1,
    globalDefault: globalDefault as any,
    globalParagraphLayout: { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true },
    documentOverrides: {},
  }
}

// ── Defaults ────────────────────────────────────────

describe('getDefaultHeadingNumberingSettings', () => {
  it('default headingStructureMode is strict', () => {
    const s = makeDefaults()
    expect(s.headingStructureMode).toBe('strict')
  })

  it('default showLevelOneNumber is false', () => {
    const s = makeDefaults()
    expect(s.showLevelOneNumber).toBe(false)
  })
})

// ── Scope: structure mode inheritance ──────────────

describe('headingStructureMode scope inheritance', () => {
  it('global strict + no doc override → effective strict', () => {
    const store = makeStore({ headingStructureMode: 'strict' })
    const ctx = resolveEffectiveSettings(store, 'doc-1')
    const structure = resolveHeadingStructure(ctx.effectiveSettings)
    expect(structure.mode).toBe('strict')
  })

  it('global strict + doc loose → effective loose', () => {
    const store = makeStore({ headingStructureMode: 'strict' })
    const settings = makeDefaults()
    settings.headingStructureMode = 'loose'
    const updated = saveHeadingSettings(store, {
      scope: 'document',
      documentKey: 'doc-1',
      settings,
    })
    const ctx = resolveEffectiveSettings(updated, 'doc-1')
    const structure = resolveHeadingStructure(ctx.effectiveSettings)
    expect(structure.mode).toBe('loose')
  })

  it('global loose + doc strict → effective strict', () => {
    const store = makeStore({ headingStructureMode: 'loose' })
    const settings = makeDefaults()
    settings.headingStructureMode = 'strict'
    const updated = saveHeadingSettings(store, {
      scope: 'document',
      documentKey: 'doc-2',
      settings,
    })
    const ctx = resolveEffectiveSettings(updated, 'doc-2')
    const structure = resolveHeadingStructure(ctx.effectiveSettings)
    expect(structure.mode).toBe('strict')
  })

  it('remove document override → back to global strict', () => {
    const store = makeStore({ headingStructureMode: 'strict' })
    const settings = makeDefaults()
    settings.headingStructureMode = 'loose'
    let updated = saveHeadingSettings(store, {
      scope: 'document',
      documentKey: 'doc-3',
      settings,
    })
    // Verify document-level loose
    const ctxDoc = resolveEffectiveSettings(updated, 'doc-3')
    expect(resolveHeadingStructure(ctxDoc.effectiveSettings).mode).toBe('loose')

    // Remove override
    const cleaned = removeDocumentOverride(updated, 'doc-3')
    const ctxBack = resolveEffectiveSettings(cleaned, 'doc-3')
    expect(resolveHeadingStructure(ctxBack.effectiveSettings).mode).toBe('strict')
  })

  it('document override preserves formatSource', () => {
    const store = makeStore({ headingStructureMode: 'loose' })
    const settings = makeDefaults()
    settings.headingStructureMode = 'strict'
    const formatSource = { type: 'custom' as const, formatId: 'fmt-1', version: 3 } as import('./heading-types').NumberingFormatSource
    const updated = saveHeadingSettings(store, {
      scope: 'document',
      documentKey: 'doc-4',
      settings,
      formatSource,
    })
    const docFmt = updated.documentOverrides['doc-4'].formatSource
    expect(docFmt?.type).toBe('custom')
    if (docFmt?.type === 'custom') {
      expect(docFmt.formatId).toBe('fmt-1')
      expect(docFmt.version).toBe(3)
    }
  })
})

// ── Mode change does not affect format version ─────

describe('headingStructureMode version isolation', () => {
  it('switching strict→loose keeps formatSource.version unchanged', () => {
    const store = makeStore({ headingStructureMode: 'strict' })
    const formatSource = { type: 'custom' as const, formatId: 'fmt-x', version: 5 } as import('./heading-types').NumberingFormatSource
    const initial = makeDefaults()
    initial.headingStructureMode = 'strict'
    let updated = saveHeadingSettings(store, {
      scope: 'document',
      documentKey: 'doc-v',
      settings: initial,
      formatSource,
    })

    // Switch to loose
    const loose = { ...makeDefaults(), headingStructureMode: 'loose' as const }
    updated = saveHeadingSettings(updated, {
      scope: 'document',
      documentKey: 'doc-v',
      settings: loose,
    })

    const docFmt2 = updated.documentOverrides['doc-v'].formatSource
    if (docFmt2?.type === 'custom') {
      expect(docFmt2.version).toBe(5)
    }
  })
})
