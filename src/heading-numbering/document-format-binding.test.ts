import { describe, it, expect } from 'vitest'
import type { HeadingNumberingScopeStore, NumberingFormatSource } from './heading-types'
import {
  builtInFormatRef,
  customFormatRef,
  formatRefKey,
  resolveGlobalDefaultFormatRef,
  resolveDocumentFormatBinding,
  resolveEffectiveFormatId,
  resolveDocumentFormatState,
  resolveFormatBadges,
  normalizeDocumentFormatBinding,
  migrateLegacyDocumentFormatBinding,
  findFormatReferences,
} from './document-format-binding'

function makeStore(opts?: {
  globalSource?: NumberingFormatSource
  globalPreset?: string
  overrides?: Record<string, { source?: NumberingFormatSource; preset?: string }>
}): HeadingNumberingScopeStore {
  const globalDefault = {
    preset: opts?.globalPreset ?? 'decimal-hierarchical',
    formatSource: opts?.globalSource,
  }
  const documentOverrides: Record<string, any> = {}
  for (const [k, v] of Object.entries(opts?.overrides ?? {})) {
    documentOverrides[k] = {
      updatedAt: 1,
      settings: { preset: v.preset ?? 'custom' },
      formatSource: v.source,
    }
  }
  return {
    schemaVersion: 1,
    globalDefault,
    documentOverrides,
    globalParagraphLayout: { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true },
  } as any
}

const custom1: NumberingFormatSource = { type: 'custom', formatId: 'style1', version: 1 }
const custom2: NumberingFormatSource = { type: 'custom', formatId: 'style2', version: 1 }
const custom3: NumberingFormatSource = { type: 'custom', formatId: 'style3', version: 1 }

describe('formatRefKey / ref builders', () => {
  it('builds stable refs and never uses name', () => {
    expect(builtInFormatRef('decimal-hierarchical')).toBe('preset:decimal-hierarchical')
    expect(customFormatRef('style1')).toBe('format:style1')
    expect(formatRefKey(custom1)).toBe('format:style1')
    expect(formatRefKey({ type: 'built-in', presetId: 'roman-mixed' })).toBe('preset:roman-mixed')
    expect(formatRefKey({ type: 'snapshot' })).toBeNull()
    expect(formatRefKey(null)).toBeNull()
  })
})

describe('resolveGlobalDefaultFormatRef', () => {
  it('prefers formatSource', () => {
    expect(resolveGlobalDefaultFormatRef(makeStore({ globalSource: custom1 }))).toBe('format:style1')
  })
  it('falls back to built-in preset field', () => {
    expect(resolveGlobalDefaultFormatRef(makeStore({ globalPreset: 'academic-paper' }))).toBe('preset:academic-paper')
  })
  it('repairs to built-in default when unresolved', () => {
    expect(resolveGlobalDefaultFormatRef(makeStore({ globalPreset: 'custom' }))).toBe('preset:decimal-hierarchical')
  })
})

describe('resolveDocumentFormatBinding', () => {
  it('no document key → inherit', () => {
    expect(resolveDocumentFormatBinding(makeStore({ globalSource: custom1 }), null)).toEqual({ mode: 'inherit', overrideFormatId: null })
  })
  it('no override → inherit', () => {
    expect(resolveDocumentFormatBinding(makeStore({ globalSource: custom1 }), 'doc-a')).toEqual({ mode: 'inherit', overrideFormatId: null })
  })
  it('custom override → override', () => {
    const store = makeStore({ overrides: { 'doc-a': { source: custom2 } } })
    expect(resolveDocumentFormatBinding(store, 'doc-a')).toEqual({ mode: 'override', overrideFormatId: 'format:style2' })
  })
  it('built-in override → override', () => {
    const store = makeStore({ overrides: { 'doc-a': { source: { type: 'built-in', presetId: 'roman-mixed' } } } })
    expect(resolveDocumentFormatBinding(store, 'doc-a')).toEqual({ mode: 'override', overrideFormatId: 'preset:roman-mixed' })
  })
  it('override with built-in preset snapshot (no source) → override', () => {
    const store = makeStore({ overrides: { 'doc-a': { preset: 'academic-paper' } } })
    expect(resolveDocumentFormatBinding(store, 'doc-a')).toEqual({ mode: 'override', overrideFormatId: 'preset:academic-paper' })
  })
  it('override without ref (custom snapshot) → inherit at format level', () => {
    const store = makeStore({ overrides: { 'doc-a': { preset: 'custom' } } })
    expect(resolveDocumentFormatBinding(store, 'doc-a')).toEqual({ mode: 'inherit', overrideFormatId: null })
  })
})

describe('resolveEffectiveFormatId / resolveDocumentFormatState', () => {
  it('inherit → effective follows global', () => {
    expect(resolveEffectiveFormatId({ mode: 'inherit', overrideFormatId: null }, 'format:style1')).toBe('format:style1')
  })
  it('override → effective follows override', () => {
    expect(resolveEffectiveFormatId({ mode: 'override', overrideFormatId: 'format:style2' }, 'format:style1')).toBe('format:style2')
  })

  it('inherit state', () => {
    const r = resolveDocumentFormatState({ mode: 'inherit', overrideFormatId: null }, 'format:style1')
    expect(r.mode).toBe('inherit')
    expect(r.overrideFormatId).toBeNull()
    expect(r.effectiveFormatId).toBe('format:style1')
    expect(r.source).toBe('global-default')
  })

  it('override state', () => {
    const r = resolveDocumentFormatState({ mode: 'override', overrideFormatId: 'format:style2' }, 'format:style1')
    expect(r.mode).toBe('override')
    expect(r.overrideFormatId).toBe('format:style2')
    expect(r.effectiveFormatId).toBe('format:style2')
    expect(r.source).toBe('document-override')
  })
})

describe('resolveFormatBadges', () => {
  it('inherit: global default card → globalDefault+effective, no currentDocument', () => {
    const r = resolveDocumentFormatState({ mode: 'inherit', overrideFormatId: null }, 'format:style1')
    expect(resolveFormatBadges(r, 'format:style1')).toEqual({ currentDocument: false, globalDefault: true, effective: true })
  })

  it('override: override card → currentDocument+effective', () => {
    const r = resolveDocumentFormatState({ mode: 'override', overrideFormatId: 'format:style2' }, 'format:style1')
    expect(resolveFormatBadges(r, 'format:style2')).toEqual({ currentDocument: true, globalDefault: false, effective: true })
  })

  it('override: global default card → globalDefault only (not effective)', () => {
    const r = resolveDocumentFormatState({ mode: 'override', overrideFormatId: 'format:style2' }, 'format:style1')
    expect(resolveFormatBadges(r, 'format:style1')).toEqual({ currentDocument: false, globalDefault: true, effective: false })
  })
})

describe('global default change (inherit follows, override does not)', () => {
  it('A inherit → style2, B override(style3) → style3', () => {
    const storeBefore = makeStore({
      globalSource: custom1,
      overrides: { 'doc-b': { source: custom3 } },
    })
    // Change global default style1 → style2
    const storeAfter = makeStore({
      globalSource: custom2,
      overrides: { 'doc-b': { source: custom3 } },
    })

    const a = resolveDocumentFormatState(
      resolveDocumentFormatBinding(storeAfter, 'doc-a'),
      resolveGlobalDefaultFormatRef(storeAfter),
    )
    const b = resolveDocumentFormatState(
      resolveDocumentFormatBinding(storeAfter, 'doc-b'),
      resolveGlobalDefaultFormatRef(storeAfter),
    )

    expect(a.effectiveFormatId).toBe('format:style2')
    expect(a.source).toBe('global-default')
    expect(b.effectiveFormatId).toBe('format:style3')
    expect(b.source).toBe('document-override')

    // Sanity: before the change, A inherited style1.
    const aBefore = resolveDocumentFormatState(
      resolveDocumentFormatBinding(storeBefore, 'doc-a'),
      resolveGlobalDefaultFormatRef(storeBefore),
    )
    expect(aBefore.effectiveFormatId).toBe('format:style1')
  })
})

describe('normalizeDocumentFormatBinding', () => {
  it('illegal inherit+override → override null', () => {
    expect(normalizeDocumentFormatBinding({ mode: 'inherit', overrideFormatId: 'style1' })).toEqual({ mode: 'inherit', overrideFormatId: null })
  })
  it('override without id → inherit', () => {
    expect(normalizeDocumentFormatBinding({ mode: 'override', overrideFormatId: null })).toEqual({ mode: 'inherit', overrideFormatId: null })
  })
  it('valid override preserved', () => {
    expect(normalizeDocumentFormatBinding({ mode: 'override', overrideFormatId: 'style2' })).toEqual({ mode: 'override', overrideFormatId: 'style2' })
  })
  it('idempotent', () => {
    const once = normalizeDocumentFormatBinding({ mode: 'inherit', overrideFormatId: 'style1' })
    expect(normalizeDocumentFormatBinding(once)).toEqual(once)
  })
})

describe('migrateLegacyDocumentFormatBinding', () => {
  it('inherit flag wins over stale id', () => {
    expect(migrateLegacyDocumentFormatBinding({ inherit: true, formatId: 'style1' })).toEqual({ mode: 'inherit', overrideFormatId: null })
  })
  it('scope current + format → override', () => {
    expect(migrateLegacyDocumentFormatBinding({ scope: 'current', format: 'style2' })).toEqual({ mode: 'override', overrideFormatId: 'style2' })
  })
  it('documentFormatId → override', () => {
    expect(migrateLegacyDocumentFormatBinding({ documentFormatId: 'style3' })).toEqual({ mode: 'override', overrideFormatId: 'style3' })
  })
})

describe('findFormatReferences', () => {
  it('detects global default and override references', () => {
    const store = makeStore({
      globalSource: custom1,
      overrides: {
        'doc-a': { source: custom2 },
        'doc-b': { source: custom2 },
      },
    })
    expect(findFormatReferences(store, 'format:style1')).toEqual({ isGlobalDefault: true, overrideDocumentKeys: [] })
    expect(findFormatReferences(store, 'format:style2')).toEqual({ isGlobalDefault: false, overrideDocumentKeys: ['doc-a', 'doc-b'] })
    expect(findFormatReferences(store, 'format:style3')).toEqual({ isGlobalDefault: false, overrideDocumentKeys: [] })
  })

  it('detects built-in preset snapshot references', () => {
    const store = makeStore({
      overrides: { 'doc-a': { preset: 'academic-paper' } },
    })
    expect(findFormatReferences(store, 'preset:academic-paper').overrideDocumentKeys).toEqual(['doc-a'])
  })
})
