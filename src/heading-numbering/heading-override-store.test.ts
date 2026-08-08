import { describe, it, expect } from 'vitest'
import { HeadingOverrideStore } from './heading-override-store'

describe('HeadingOverrideStore strict mode H1 priority', () => {
  function makeNameRules() {
    return [
      { text: '参考文献', enabled: true },
      { text: '摘要', enabled: true },
    ]
  }

  it('strict + H1 explicit numbered → still unnumbered (structure priority)', () => {
    const store = new HeadingOverrideStore('test-doc', {})
    const fp = HeadingOverrideStore.fingerprint('test-doc', 1, { parentLine: null, ancestorLevels: [] }, '第一章')
    store.setOverride(fp, 'numbered', 'self', 'manual')

    const resolved = store.resolveMode(1, fp, [], '第一章', makeNameRules(), 'trim', false)
    expect(resolved.mode).toBe('unnumbered')
    expect(resolved.source).toBe('default') // structure rule overrides manual
  })

  it('strict + H1 inherit → unnumbered (structure default)', () => {
    const store = new HeadingOverrideStore('test-doc', {})
    const fp = HeadingOverrideStore.fingerprint('test-doc', 1, { parentLine: null, ancestorLevels: [] }, '引言')

    const resolved = store.resolveMode(1, fp, [], '引言', makeNameRules(), 'trim', false)
    expect(resolved.mode).toBe('unnumbered')
    expect(resolved.source).toBe('default')
  })

  it('loose + H1 explicit numbered → numbered', () => {
    const store = new HeadingOverrideStore('test-doc', {})
    const fp = HeadingOverrideStore.fingerprint('test-doc', 1, { parentLine: null, ancestorLevels: [] }, '第一章')
    store.setOverride(fp, 'numbered', 'self', 'manual')

    const resolved = store.resolveMode(1, fp, [], '第一章', makeNameRules(), 'trim', true)
    expect(resolved.mode).toBe('numbered')
    expect(resolved.source).toBe('manual')
  })

  it('loose + H1 special name (参考文献) → unnumbered by name rule', () => {
    const store = new HeadingOverrideStore('test-doc', {})
    const fp = HeadingOverrideStore.fingerprint('test-doc', 1, { parentLine: null, ancestorLevels: [] }, '参考文献')

    const resolved = store.resolveMode(1, fp, [], '参考文献', makeNameRules(), 'trim', true)
    expect(resolved.mode).toBe('unnumbered')
    expect(resolved.source).toBe('name-rule')
  })

  it('strict + H2 special name → unnumbered by name rule (works normally)', () => {
    const store = new HeadingOverrideStore('test-doc', {})
    const fp = HeadingOverrideStore.fingerprint('test-doc', 2, { parentLine: null, ancestorLevels: [1] }, '参考文献')

    const resolved = store.resolveMode(2, fp, [], '参考文献', makeNameRules(), 'trim', false)
    expect(resolved.mode).toBe('unnumbered')
    expect(resolved.source).toBe('name-rule')
  })

  it('strict + H1 subtree unnumbered → H1 still unnumbered', () => {
    const store = new HeadingOverrideStore('test-doc', {})
    const fp = HeadingOverrideStore.fingerprint('test-doc', 1, { parentLine: null, ancestorLevels: [] }, '第一章')
    store.setOverride(fp, 'unnumbered', 'subtree', 'manual')

    const resolved = store.resolveMode(1, fp, [], '第一章', makeNameRules(), 'trim', false)
    expect(resolved.mode).toBe('unnumbered')
  })
})
