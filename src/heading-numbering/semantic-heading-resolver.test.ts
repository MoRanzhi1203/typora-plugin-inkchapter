import { describe, it, expect } from 'vitest'
import { resolveSemanticRoles, roleFromEffectiveDepth } from './semantic-heading-resolver'
import type { PhysicalHeading } from './semantic-heading-types'

function h(key: string, level: 1 | 2 | 3 | 4 | 5 | 6, text = key): PhysicalHeading {
  return { key, level, text }
}

describe('roleFromEffectiveDepth', () => {
  it('maps depth to semantic role', () => {
    expect(roleFromEffectiveDepth(0)).toBe('document-title')
    expect(roleFromEffectiveDepth(1)).toBe('chapter')
    expect(roleFromEffectiveDepth(2)).toBe('section')
    expect(roleFromEffectiveDepth(3)).toBe('subsection')
    expect(roleFromEffectiveDepth(4)).toBe('item')
  })
})

describe('resolveSemanticRoles — strict (fixed, no compression)', () => {
  it('H1=title, H2=chapter, H3=section', () => {
    const roles = resolveSemanticRoles([h('t', 1), h('c', 2), h('s', 3)], 'strict')
    expect(roles.map(r => [r.semanticRole, r.effectiveDepth])).toEqual([
      ['document-title', 0],
      ['chapter', 1],
      ['section', 2],
    ])
  })

  it('strict never lets H4 impersonate H3 section', () => {
    const roles = resolveSemanticRoles([h('t', 1), h('c', 2), h('x', 4)], 'strict')
    expect(roles[2].semanticRole).toBe('subsection')
    expect(roles[2].effectiveDepth).toBe(3)
  })

  it('strict H1 is never chapter', () => {
    const roles = resolveSemanticRoles([h('t', 1), h('c', 2)], 'strict')
    expect(roles[0].semanticRole).toBe('document-title')
    expect(roles[1].semanticRole).toBe('chapter')
  })
})

describe('resolveSemanticRoles — loose (path-local compression)', () => {
  it('standard H1→H2→H3 = chapter/section/subsection', () => {
    const roles = resolveSemanticRoles([h('c', 1), h('s', 2), h('ss', 3)], 'loose')
    expect(roles.map(r => r.semanticRole)).toEqual(['chapter', 'section', 'subsection'])
  })

  it('compresses H1→H3 = chapter/section', () => {
    const roles = resolveSemanticRoles([h('c', 1), h('s', 3)], 'loose')
    expect(roles.map(r => r.semanticRole)).toEqual(['chapter', 'section'])
  })

  it('compresses H2→H3 without H1 = chapter/section', () => {
    const roles = resolveSemanticRoles([h('c', 2), h('s', 3)], 'loose')
    expect(roles.map(r => r.semanticRole)).toEqual(['chapter', 'section'])
  })

  it('compresses H2→H4 = chapter/section', () => {
    const roles = resolveSemanticRoles([h('c', 2), h('s', 4)], 'loose')
    expect(roles.map(r => r.semanticRole)).toEqual(['chapter', 'section'])
  })

  it('L-MIX-1 branch-local: H1→H2 then H1→H3 both resolve chapter→section', () => {
    const roles = resolveSemanticRoles([
      h('ca', 1), h('sa', 2),
      h('cb', 1), h('sb', 3),
    ], 'loose')
    expect(roles.map(r => r.semanticRole)).toEqual(['chapter', 'section', 'chapter', 'section'])
  })

  it('heterogeneous chapter roots: H2→H3 then H1→H3', () => {
    const roles = resolveSemanticRoles([
      h('rootA', 2), h('childA', 3),
      h('rootB', 1), h('childB', 3),
    ], 'loose')
    expect(roles.map(r => r.semanticRole)).toEqual(['chapter', 'section', 'chapter', 'section'])
  })

  it('same-chapter heterogeneous section: H1→H3→H2', () => {
    const roles = resolveSemanticRoles([h('c', 1), h('s1', 3), h('s2', 2)], 'loose')
    expect(roles.map(r => r.semanticRole)).toEqual(['chapter', 'section', 'section'])
  })

  it('single heading is chapter', () => {
    const roles = resolveSemanticRoles([h('c', 1)], 'loose')
    expect(roles[0].semanticRole).toBe('chapter')
    expect(roles[0].effectiveDepth).toBe(1)
  })
})
