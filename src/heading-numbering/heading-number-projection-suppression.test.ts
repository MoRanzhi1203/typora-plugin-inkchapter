import { describe, it, expect } from 'vitest'
import { suppressProjectionsForSourceNumbers } from './heading-number-projection-suppression'
import type { HeadingDecorationProjection } from './heading-decoration-projection-v514-r4'

function projection(key: string, label: string): HeadingDecorationProjection {
  return { stableIdentity: key, label, gap: 'space' }
}

describe('R08 — source number projection dedupe', () => {
  it('suppresses a projection when the heading already carries the number', () => {
    const headings = [
      { key: 'a', text: '文档' },
      { key: 'b', text: '1.1 研究背景' },
    ]
    const result = suppressProjectionsForSourceNumbers(headings, [
      projection('a', ''),
      projection('b', '1.1'),
    ])
    expect(result.projections[1]).toEqual({ stableIdentity: 'b', label: '', gap: 'none' })
    expect(result.suppressed).toEqual(['b'])
  })

  it('suppresses a manual number even when it differs from the computed label', () => {
    const headings = [{ key: 'a', text: '2.5 研究背景' }]
    const result = suppressProjectionsForSourceNumbers(headings, [projection('a', '1')])
    expect(result.projections[0].label).toBe('')
  })

  it('does not suppress ambiguous prefixes or plain titles', () => {
    const headings = [
      { key: 'a', text: '2026 年研究报告' },
      { key: 'b', text: '研究背景' },
      { key: 'c', text: '3D 建模技术' },
    ]
    const result = suppressProjectionsForSourceNumbers(headings, [
      projection('a', '1'),
      projection('b', '2'),
      projection('c', '3'),
    ])
    expect(result.projections.map(p => p.label)).toEqual(['1', '2', '3'])
    expect(result.suppressed).toEqual([])
  })

  it('leaves an already-empty projection untouched', () => {
    const headings = [{ key: 'a', text: '1 标题' }]
    const result = suppressProjectionsForSourceNumbers(headings, [projection('a', '')])
    expect(result.projections[0].label).toBe('')
    expect(result.suppressed).toEqual([])
  })
})
