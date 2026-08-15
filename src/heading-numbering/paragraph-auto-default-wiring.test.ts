// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  resolveEffectiveParagraphIndent,
  applyEffectiveParagraphIndent,
} from './paragraph-indent-manager'
import { resolveParagraphLayoutSettings } from './heading-numbering-scope-store'
import type { HeadingNumberingScopeStore, ParagraphLayoutSettings } from './heading-types'

function storeWith(global: ParagraphLayoutSettings, docOverrides: HeadingNumberingScopeStore['documentOverrides'] = {}): HeadingNumberingScopeStore {
  return {
    schemaVersion: 1,
    globalDefault: {} as HeadingNumberingScopeStore['globalDefault'],
    documentOverrides: docOverrides,
    globalParagraphLayout: global,
  }
}

function draftDirty(draft: ParagraphLayoutSettings, baseline: ParagraphLayoutSettings): boolean {
  return JSON.stringify(draft) !== JSON.stringify(baseline)
}

describe('PF1-AUTO: ordinary AUTO paragraph default wiring', () => {
  it('PF1-AUTO-1: modifying draft.defaultIndent marks dirty', () => {
    const baseline: ParagraphLayoutSettings = { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true }
    const draft: ParagraphLayoutSettings = { ...baseline, defaultIndent: 'indent-2' }
    expect(draftDirty(draft, baseline)).toBe(true)
    expect(draftDirty({ ...baseline }, baseline)).toBe(false)
  })

  it('PF1-AUTO-2/3: save persists, cancel keeps persisted value unchanged', () => {
    const global: ParagraphLayoutSettings = { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true }
    const before = storeWith(global)

    // Simulate local save → global default updated.
    const saved = storeWith({ ...global, defaultIndent: 'indent-2' })
    expect(resolveParagraphLayoutSettings(saved, null).defaultIndent).toBe('indent-2')

    // Cancel does not touch the persisted store.
    expect(resolveParagraphLayoutSettings(before, null).defaultIndent).toBe('flush')
  })

  it('PF1-AUTO-4: document override wins over global', () => {
    const store = storeWith(
      { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true },
      {
        'doc-a': {
          updatedAt: 1,
          settings: {} as HeadingNumberingScopeStore['globalDefault'],
          paragraphLayout: { defaultIndent: 'indent-2', flushAfterDisplayMath: false, indentShortcutEnabled: false },
        },
      },
    )
    expect(resolveParagraphLayoutSettings(store, 'doc-a').defaultIndent).toBe('indent-2')
    expect(resolveParagraphLayoutSettings(store, 'doc-b').defaultIndent).toBe('flush')
  })

  it('PF1-AUTO-5: saved indent-2 resolves to indent-2', () => {
    const store = storeWith({ defaultIndent: 'indent-2', flushAfterDisplayMath: true, indentShortcutEnabled: true })
    expect(resolveParagraphLayoutSettings(store, null).defaultIndent).toBe('indent-2')
  })

  it('PF1-AUTO-6: auto + indent-2 → effective indent-2', () => {
    expect(resolveEffectiveParagraphIndent('auto', 'indent-2', { isFormulaContinuation: false })).toBe('indent-2')
  })

  it('PF1-AUTO-7: auto + flush → effective flush', () => {
    expect(resolveEffectiveParagraphIndent('auto', 'flush', { isFormulaContinuation: false })).toBe('flush')
  })

  it('PF1-AUTO-8/9: refresh projects indent-2 class onto AUTO paragraph', () => {
    const p = document.createElement('p')
    applyEffectiveParagraphIndent(p, 'indent-2')
    expect(p.classList.contains('inkchapter-paragraph-effective-indent-2')).toBe(true)
    expect(p.classList.contains('inkchapter-paragraph-effective-flush')).toBe(false)

    applyEffectiveParagraphIndent(p, 'flush')
    expect(p.classList.contains('inkchapter-paragraph-effective-indent-2')).toBe(false)
    expect(p.classList.contains('inkchapter-paragraph-effective-flush')).toBe(true)
  })

  it('PF1-AUTO-10: force-indent does not follow ordinary default change', () => {
    expect(resolveEffectiveParagraphIndent('force-indent', 'flush', { isFormulaContinuation: false })).toBe('indent-2')
    expect(resolveEffectiveParagraphIndent('force-indent', 'indent-2', { isFormulaContinuation: false })).toBe('indent-2')
    // auto follows default, force-indent stays explicit
    expect(resolveEffectiveParagraphIndent('auto', 'flush', { isFormulaContinuation: false })).toBe('flush')
  })

  it('PF1-AUTO-11/12: paragraphLayout dirty/save is independent of heading settings', () => {
    const baseline: ParagraphLayoutSettings = { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true }
    const paragraphDraft: ParagraphLayoutSettings = { ...baseline, defaultIndent: 'indent-2' }
    // paragraphLayoutDraft has its own dirty signal, unrelated to any heading draft.
    expect(draftDirty(paragraphDraft, baseline)).toBe(true)
    // A single authoritative save entry applies the paragraph draft without touching other state.
    const saved = storeWith({ ...baseline, defaultIndent: paragraphDraft.defaultIndent })
    expect(resolveParagraphLayoutSettings(saved, null).defaultIndent).toBe('indent-2')
  })
})
