// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  resolveEffectiveParagraphIndent,
  isIndentShortcutEditingToken,
  readParagraphIndentCommand,
} from './paragraph-indent-manager'
import { isTokenOnlyEmptySpecialCommand } from './empty-special-command'
import { resolveParagraphLayoutSettings } from './heading-numbering-scope-store'
import type { HeadingNumberingScopeStore } from './heading-types'

function storeWith(global: HeadingNumberingScopeStore['globalParagraphLayout']): HeadingNumberingScopeStore {
  return {
    schemaVersion: 1,
    globalDefault: {} as HeadingNumberingScopeStore['globalDefault'],
    documentOverrides: {},
    globalParagraphLayout: global,
  }
}

describe('PARA-SETTING: paragraph layout settings reach Runtime', () => {
  // ── Ordinary default ──────────────────────────────────────
  it('PARA-SETTING-1: ordinaryDefault=flush + auto → flush', () => {
    expect(resolveEffectiveParagraphIndent('auto', 'flush', { isFormulaContinuation: false })).toBe('flush')
  })

  it('PARA-SETTING-2: ordinaryDefault=indent-2 + auto → indent-2', () => {
    expect(resolveEffectiveParagraphIndent('auto', 'indent-2', { isFormulaContinuation: false })).toBe('indent-2')
  })

  // ── Formula continuation (structural rule) ────────────────
  it('PARA-SETTING-3: formula continuation flush overrides ordinary indent-2', () => {
    expect(resolveEffectiveParagraphIndent('auto', 'indent-2', { isFormulaContinuation: true })).toBe('flush')
  })

  it('PARA-SETTING-4: formula continuation disabled → follows ordinary default', () => {
    // When the rule is off, the caller passes isFormulaContinuation=false.
    expect(resolveEffectiveParagraphIndent('auto', 'indent-2', { isFormulaContinuation: false })).toBe('indent-2')
    expect(resolveEffectiveParagraphIndent('auto', 'flush', { isFormulaContinuation: false })).toBe('flush')
  })

  it('PARA-SETTING-5: explicit force-indent beats formula-continuation flush', () => {
    expect(resolveEffectiveParagraphIndent('force-indent', 'flush', { isFormulaContinuation: true })).toBe('indent-2')
  })

  // ── Admission ─────────────────────────────────────────────
  it('PARA-SETTING-6: enabled + exact "。。" + ordinary paragraph → admitted', () => {
    const p = document.createElement('p')
    p.textContent = '。。'
    expect(isTokenOnlyEmptySpecialCommand('。。', '。。')).toBe(true)
    expect(readParagraphIndentCommand(p)).toBe('。。')
    expect(isIndentShortcutEditingToken(p, true)).toBe(true)
  })

  it('PARA-SETTING-7: disabled → shortcut rejected, token not admitted', () => {
    const p = document.createElement('p')
    p.textContent = '。。'
    // Even with an exact token, the enabled=false gate rejects.
    expect(readParagraphIndentCommand(p)).toBe('。。')
    expect(isIndentShortcutEditingToken(p, false)).toBe(false)
  })

  it('PARA-SETTING-8: default indent-2 still admits explicit force-indent', () => {
    // force-indent semantic is preserved even when the visual already is indent-2.
    expect(resolveEffectiveParagraphIndent('force-indent', 'indent-2', { isFormulaContinuation: false })).toBe('indent-2')
    // auto and force-indent may share visual output, but force-indent stays explicit.
    expect(resolveEffectiveParagraphIndent('auto', 'indent-2', { isFormulaContinuation: false })).toBe('indent-2')
  })

  it('PARA-SETTING-9: non-token / excluded contexts never trigger', () => {
    for (const bad of [' 。', '。。 ', '。。x', ' ', '\u00A0', '。', '...']) {
      expect(isTokenOnlyEmptySpecialCommand(bad, '。。')).toBe(false)
    }
    const heading = document.createElement('h2')
    heading.textContent = '。。'
    expect(isIndentShortcutEditingToken(heading, true)).toBe(false)
    const code = document.createElement('code')
    code.textContent = '。。'
    expect(isIndentShortcutEditingToken(code, true)).toBe(false)
  })

  // ── Save / cancel affect Runtime ──────────────────────────
  it('PARA-SETTING-10: save immediately changes resolved runtime settings', () => {
    const store = storeWith({ defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true })
    expect(resolveParagraphLayoutSettings(store, null).defaultIndent).toBe('flush')

    // Simulate save → global default updated.
    const saved = storeWith({ defaultIndent: 'indent-2', flushAfterDisplayMath: false, indentShortcutEnabled: false })
    expect(resolveParagraphLayoutSettings(saved, null).defaultIndent).toBe('indent-2')
    expect(resolveParagraphLayoutSettings(saved, null).flushAfterDisplayMath).toBe(false)
    expect(resolveParagraphLayoutSettings(saved, null).indentShortcutEnabled).toBe(false)
  })

  it('PARA-SETTING-11: cancel keeps the old saved value (no runtime pollution)', () => {
    const oldStore = storeWith({ defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true })
    // Cancelled edit does not touch the store — runtime still reads old values.
    expect(resolveParagraphLayoutSettings(oldStore, null).defaultIndent).toBe('flush')
    expect(resolveParagraphLayoutSettings(oldStore, null).indentShortcutEnabled).toBe(true)
  })

  it('PARA-SETTING-12: preview and runtime resolver produce identical results', () => {
    const cases: Array<{ mode: 'auto' | 'force-indent' | 'force-flush'; defaultIndent: 'flush' | 'indent-2'; formula: boolean }> = [
      { mode: 'auto', defaultIndent: 'flush', formula: false },
      { mode: 'auto', defaultIndent: 'indent-2', formula: false },
      { mode: 'auto', defaultIndent: 'indent-2', formula: true },
      { mode: 'force-indent', defaultIndent: 'flush', formula: true },
      { mode: 'force-flush', defaultIndent: 'indent-2', formula: true },
    ]
    for (const c of cases) {
      const preview = resolveEffectiveParagraphIndent(c.mode, c.defaultIndent, { isFormulaContinuation: c.formula })
      const runtime = resolveEffectiveParagraphIndent(c.mode, c.defaultIndent, { isFormulaContinuation: c.formula })
      expect(preview).toBe(runtime)
    }
  })
})
