// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  resolveFirstSemanticBlock,
  validateStrictFirstH1,
  computeFirstBlockSignature,
  shouldRevalidateStrictFirstH1,
} from './strict-document-validator'

function root(...children: (Node | string)[]): HTMLElement {
  const r = document.createElement('div')
  for (const c of children) {
    if (typeof c === 'string') {
      const p = document.createElement('p')
      p.textContent = c
      r.appendChild(p)
    } else {
      r.appendChild(c)
    }
  }
  return r
}

function h(level: number, text = ''): HTMLElement {
  const el = document.createElement(`h${level}`)
  el.textContent = text
  return el
}

function sig(el: HTMLElement): string {
  return computeFirstBlockSignature(resolveFirstSemanticBlock(el))
}

describe('STRICT-RUNTIME: STRICT-FIRST-H1 reactive validation wiring', () => {
  it('STRICT-RUNTIME-1: document open + strict + H1 first → PASS', () => {
    const r = root(h(1, '标题'), '正文')
    const block = resolveFirstSemanticBlock(r)
    expect(validateStrictFirstH1(block, 'strict').decision).toBe('PASS')
  })

  it('STRICT-RUNTIME-2: document open + strict + paragraph first → FAIL', () => {
    const r = root('正文', h(1, '标题'))
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('FAIL')
  })

  it('STRICT-RUNTIME-3: loose → strict triggers immediate revalidation', () => {
    expect(shouldRevalidateStrictFirstH1('loose', 'heading|1', true, 'strict', 'heading|1')).toBe(true)
  })

  it('STRICT-RUNTIME-4: strict → loose clears to SKIP', () => {
    const r = root('正文', h(1, '标题'))
    const block = resolveFirstSemanticBlock(r)
    expect(validateStrictFirstH1(block, 'loose').decision).toBe('SKIP')
    expect(shouldRevalidateStrictFirstH1('strict', 'paragraph|', true, 'loose', 'paragraph|')).toBe(true)
  })

  it('STRICT-RUNTIME-5: H1 → H2 auto PASS → FAIL (signature change)', () => {
    const r = root(h(1, '标题'))
    const before = sig(r)
    expect(before).toBe('heading|1')
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('PASS')

    r.replaceChild(h(2, '标题'), r.children[0])
    const after = sig(r)
    expect(after).toBe('heading|2')
    expect(shouldRevalidateStrictFirstH1('strict', before, true, 'strict', after)).toBe(true)
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('FAIL')
  })

  it('STRICT-RUNTIME-6: paragraph → H1 auto FAIL → PASS (signature change)', () => {
    const r = root('正文')
    const before = sig(r)
    expect(before).toBe('paragraph|')
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('FAIL')

    r.replaceChild(h(1, '正文'), r.children[0])
    const after = sig(r)
    expect(after).toBe('heading|1')
    expect(shouldRevalidateStrictFirstH1('strict', before, true, 'strict', after)).toBe(true)
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('PASS')
  })

  it('STRICT-RUNTIME-7: insert paragraph before H1 → PASS → FAIL', () => {
    const r = root(h(1, '标题'))
    expect(sig(r)).toBe('heading|1')

    r.insertBefore(document.createTextNode(''), r.firstChild)
    const p0 = document.createElement('p')
    p0.textContent = '正文'
    r.insertBefore(p0, r.firstChild)
    expect(sig(r)).toBe('paragraph|')
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('FAIL')
  })

  it('STRICT-RUNTIME-8: delete offending paragraph before H1 → FAIL → PASS', () => {
    const r = root('正文', h(1, '标题'))
    expect(sig(r)).toBe('paragraph|')
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('FAIL')

    r.removeChild(r.children[0])
    expect(sig(r)).toBe('heading|1')
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('PASS')
  })

  it('STRICT-RUNTIME-9: middle-document mutation with unchanged first block → SKIP_REVALIDATION', () => {
    const r = root(h(1, '标题'), '中段', '尾部')
    const before = sig(r)
    // Mutate a middle paragraph's text (first block unchanged).
    ;(r.children[1] as HTMLElement).textContent = '中段改'
    const after = sig(r)
    expect(before).toBe('heading|1')
    expect(after).toBe('heading|1')
    expect(shouldRevalidateStrictFirstH1('strict', before, true, 'strict', after)).toBe(false)
  })

  it('STRICT-RUNTIME-10: single source of truth — signature/revalidate helpers do not re-implement the rule', () => {
    // The runtime layer only decides WHEN; validateStrictFirstH1 is the ONLY rule.
    const r = root('正文', h(1, '标题'))
    const v = validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict')
    expect(v.ruleId).toBe('STRICT-FIRST-H1')
    expect(sig(r)).toBe('paragraph|')
  })

  it('STRICT-RUNTIME-11: first-block signature change is the UI-refresh trigger', () => {
    const r = root(h(1, '标题'))
    const before = sig(r)
    r.replaceChild(h(3, '标题'), r.children[0])
    const after = sig(r)
    expect(before).not.toBe(after)
    expect(shouldRevalidateStrictFirstH1('strict', before, true, 'strict', after)).toBe(true)
  })

  it('STRICT-RUNTIME-12: document switch resets state (null prev forces revalidation)', () => {
    // After document switch the service resets state+signature to null → must revalidate.
    expect(shouldRevalidateStrictFirstH1(null, null, false, 'strict', 'heading|1')).toBe(true)
  })

  it('STRICT-RUNTIME-13: front matter before H1 → FAIL', () => {
    const fm = document.createElement('div')
    fm.classList.add('md-meta-block')
    fm.textContent = 'title: test'
    const r = root(fm, h(1, '标题'))
    const block = resolveFirstSemanticBlock(r)
    expect(block?.type).toBe('front-matter')
    expect(validateStrictFirstH1(block, 'strict').decision).toBe('FAIL')
  })

  it('STRICT-RUNTIME-14: empty document → FAIL', () => {
    const r = root()
    expect(resolveFirstSemanticBlock(r)).toBeNull()
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('FAIL')
  })

  it('STRICT-RUNTIME-15: loose mode structural mutation → no STRICT-FIRST-H1 error', () => {
    const r = root('正文', h(1, '标题'))
    // Even with a paragraph first, loose mode reports SKIP (no error).
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'loose').decision).toBe('SKIP')
  })
})
