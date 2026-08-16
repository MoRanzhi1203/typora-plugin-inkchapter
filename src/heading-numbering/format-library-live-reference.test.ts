import { describe, it, expect } from 'vitest'
import { resolveEffectiveSettings } from './heading-numbering-scope-store'
import {
  resolveDocumentFormatBinding,
  resolveGlobalDefaultFormatRef,
  resolveEffectiveFormatId,
  customFormatRef,
} from './document-format-binding'
import type { HeadingNumberingScopeStore, FormatLibrary, CustomNumberingFormat } from './heading-types'

function makeLevels(token: string): Record<number, any> {
  const lv = {
    enabled: true,
    tokenStyle: 'arabic',
    includeParents: true,
    prefix: '',
    suffix: '',
    separator: '.',
    startAt: 1,
    restartAfterLevel: null,
    formatVariants: { withLevelOne: [], withoutLevelOne: [] },
    levelTemplate: { tokenStyle: 'arabic' as const, prefix: token, suffix: '' },
    multilevelFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
    contextualFormatVariants: {
      withLevelOne: [{ id: 'seg', type: 'level-reference' as const, level: 1 as const, appearance: { tokenStyle: 'arabic' as const, prefix: token, suffix: '' } }],
      withoutLevelOne: [],
    },
    numberTitleSpacing: 'space' as const,
  }
  const levels: Record<number, any> = {}
  for (let i = 1; i <= 6; i++) levels[i] = { ...lv }
  return levels
}

function makeFormat(id: string, version: number, token: string): CustomNumberingFormat {
  return {
    id,
    name: id,
    description: '',
    createdAt: 1,
    updatedAt: 1,
    version,
    basedOn: { type: 'blank' },
    settings: { levels: makeLevels(token), showLevelOneNumber: true, enabled: true, maxDepth: 6 },
  } as any
}

function makeLibrary(formats: CustomNumberingFormat[]): FormatLibrary {
  return { version: 1, formats, preferences: { hiddenBuiltInPresetIds: [], customFormatOrder: formats.map(f => f.id) } }
}

function makeStore(opts?: {
  globalSource?: { type: 'custom'; formatId: string; version: number }
  globalToken?: string
  overrides?: Record<string, { source?: { type: 'custom'; formatId: string; version: number }; token?: string }>
}): HeadingNumberingScopeStore {
  const globalDefault: any = {
    enabled: true,
    headingStructureMode: 'loose',
    showLevelOneNumber: true,
    preset: 'custom',
    maxDepth: 6,
    levels: makeLevels(opts?.globalToken ?? 'OLD'),
    customDefinition: makeLevels(opts?.globalToken ?? 'OLD'),
    formatSource: opts?.globalSource,
  }
  const documentOverrides: Record<string, any> = {}
  for (const [k, v] of Object.entries(opts?.overrides ?? {})) {
    documentOverrides[k] = {
      updatedAt: 1,
      settings: { enabled: true, headingStructureMode: 'loose', showLevelOneNumber: true, preset: 'custom', maxDepth: 6, levels: makeLevels(v.token ?? 'OLD') },
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

function levelToken(settings: any): string {
  return settings.levels[1].levelTemplate.prefix
}

describe('resolveEffectiveSettings — Live Reference', () => {
  it('linked global default resolves LATEST library definition (not stale snapshot)', () => {
    const store = makeStore({
      globalSource: { type: 'custom', formatId: 'style1', version: 5 },
      globalToken: 'V5',
    })
    const library = makeLibrary([makeFormat('style1', 8, 'V8')])
    const ctx = resolveEffectiveSettings(store, 'doc-a', library)
    expect(levelToken(ctx.effectiveSettings)).toBe('V8')
  })

  it('without library, falls back to persisted snapshot (frozen/legacy)', () => {
    const store = makeStore({
      globalSource: { type: 'custom', formatId: 'style1', version: 5 },
      globalToken: 'V5',
    })
    const ctx = resolveEffectiveSettings(store, 'doc-a')
    expect(levelToken(ctx.effectiveSettings)).toBe('V5')
  })

  it('linked document override resolves LATEST library definition', () => {
    const store = makeStore({
      globalSource: { type: 'custom', formatId: 'style1', version: 8 },
      globalToken: 'GLOBAL',
      overrides: { 'doc-c': { source: { type: 'custom', formatId: 'style2', version: 3 }, token: 'OLD2' } },
    })
    const library = makeLibrary([
      makeFormat('style1', 8, 'GLOBAL'),
      makeFormat('style2', 9, 'NEW2'),
    ])
    const ctx = resolveEffectiveSettings(store, 'doc-c', library)
    expect(levelToken(ctx.effectiveSettings)).toBe('NEW2')
  })

  it('missing format reference falls back to snapshot (repair path)', () => {
    const store = makeStore({
      globalSource: { type: 'custom', formatId: 'style-missing', version: 5 },
      globalToken: 'V5',
    })
    const library = makeLibrary([makeFormat('style1', 8, 'V8')])
    const ctx = resolveEffectiveSettings(store, 'doc-a', library)
    expect(levelToken(ctx.effectiveSettings)).toBe('V5')
  })
})

describe('live reference + binding resolver integration', () => {
  it('effective ref matches changed format only when linked', () => {
    const store = makeStore({
      globalSource: { type: 'custom', formatId: 'style1', version: 5 },
      overrides: { 'doc-c': { source: { type: 'custom', formatId: 'style2', version: 3 } } },
    })
    const bindingA = resolveDocumentFormatBinding(store, 'doc-a')
    const globalRef = resolveGlobalDefaultFormatRef(store)
    expect(resolveEffectiveFormatId(bindingA, globalRef)).toBe(customFormatRef('style1'))

    const bindingC = resolveDocumentFormatBinding(store, 'doc-c')
    expect(resolveEffectiveFormatId(bindingC, globalRef)).toBe(customFormatRef('style2'))
  })
})
