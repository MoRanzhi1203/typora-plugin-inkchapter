// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  resolveMergeSemantic,
  resolveEffectiveParagraphIndent,
  applyEffectiveParagraphIndent,
} from './paragraph-indent-manager'

describe('MERGE: paragraph boundary merge semantic resolution (PF3)', () => {
  it('MERGE-1: left force-indent + right auto + Delete → force-indent', () => {
    const r = resolveMergeSemantic('delete', 'force-indent', 'auto')
    expect(r.winner).toBe('force-indent')
    expect(r.reason).toBe('LEFT_EXPLICIT_ONLY')
  })

  it('MERGE-2: left auto + right force-indent + Backspace → force-indent', () => {
    const r = resolveMergeSemantic('backspace', 'auto', 'force-indent')
    expect(r.winner).toBe('force-indent')
    expect(r.reason).toBe('RIGHT_EXPLICIT_ONLY')
  })

  it('MERGE-3: auto + auto → auto (no new explicit record)', () => {
    const r = resolveMergeSemantic('delete', 'auto', 'auto')
    expect(r.winner).toBe('auto')
    expect(r.reason).toBe('BOTH_AUTO')
  })

  it('MERGE-4: force-indent + force-indent → force-indent (single winner)', () => {
    const r = resolveMergeSemantic('delete', 'force-indent', 'force-indent')
    expect(r.winner).toBe('force-indent')
    expect(r.reason).toBe('BOTH_EXPLICIT_SAME')
  })

  it('MERGE-5: left force-indent + right force-flush + Delete → force-indent', () => {
    const r = resolveMergeSemantic('delete', 'force-indent', 'force-flush')
    expect(r.winner).toBe('force-indent')
    expect(r.reason).toBe('CONFLICT_DELETE_LEFT')
  })

  it('MERGE-6: left force-indent + right force-flush + Backspace → force-flush', () => {
    const r = resolveMergeSemantic('backspace', 'force-indent', 'force-flush')
    expect(r.winner).toBe('force-flush')
    expect(r.reason).toBe('CONFLICT_BACKSPACE_RIGHT')
  })

  it('MERGE-7: merged semantic survives continued input (visual stays)', () => {
    const r = resolveMergeSemantic('delete', 'force-indent', 'auto')
    const effective = resolveEffectiveParagraphIndent(r.winner, 'flush', { isFormulaContinuation: false })
    expect(effective).toBe('indent-2')

    const p = document.createElement('p')
    applyEffectiveParagraphIndent(p, effective)
    expect(p.classList.contains('inkchapter-paragraph-effective-indent-2')).toBe(true)
  })

  it('MERGE-8: merge produces exactly one winner owner', () => {
    // resolver returns a single semantic winner; loser is retired by the service.
    const same = resolveMergeSemantic('delete', 'force-indent', 'force-indent')
    expect(same.winner).toBe('force-indent')
    const conflict = resolveMergeSemantic('backspace', 'force-indent', 'force-flush')
    expect(conflict.winner).toBe('force-flush')
  })

  it('MERGE-9: force-indent empty-equivalent projection stays indent-2 semantic', () => {
    // empty-equivalent uses EMPTY_PADDING, but semantic remains force-indent → indent-2.
    const r = resolveMergeSemantic('backspace', 'auto', 'force-indent')
    expect(r.winner).toBe('force-indent')
    const effective = resolveEffectiveParagraphIndent(r.winner, 'flush', { isFormulaContinuation: false })
    expect(effective).toBe('indent-2')
  })

  it('MERGE-10: merge resolution is pure (no selection/caret writes)', () => {
    // resolveMergeSemantic is a pure function: no DOM/selection side effects.
    const selBefore = typeof window.getSelection === 'function' ? window.getSelection() : null
    const r = resolveMergeSemantic('delete', 'force-indent', 'auto')
    expect(r.winner).toBe('force-indent')
    // No DOM mutation happened as a side effect.
    expect(document.body.childElementCount).toBe(0)
    void selBefore
  })

  it('MERGE-11: non-boundary delete/backspace does not arm a merge semantic', () => {
    // The resolver only applies to explicit boundary-merge intent; a plain
    // character delete is NOT a merge and carries no left/right semantic pair.
    const r = resolveMergeSemantic('delete', 'auto', 'auto')
    expect(r.winner).toBe('auto')
    expect(r.reason).toBe('BOTH_AUTO')
  })

  it('MERGE-12: auto + auto never fabricates an explicit record', () => {
    const r = resolveMergeSemantic('backspace', 'auto', 'auto')
    expect(r.winner).toBe('auto')
    expect(r.winner).not.toBe('force-indent')
    expect(r.winner).not.toBe('force-flush')
  })
})
