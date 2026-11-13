import { describe, expect, it } from 'vitest'
import {
  blankAdjacencyDetail,
  isRenderedBlankCountExcessive,
  resolveAdjacentBlankPolicy,
  resolveAdjacentBlankPolicyByKind,
  toBlankAdjacencyKind,
  type BlankAdjacencyKind,
} from './document-diagnostic-blank-adjacency-policy-v1'

const KINDS: BlankAdjacencyKind[] = ['paragraph', 'heading', 'image', 'code', 'math', 'table', 'list', 'quote', 'other']

describe('ADJACENT BLANK-LINE POLICY MATRIX V1', () => {
  it('maps scanner tokens to the policy vocabulary', () => {
    expect(toBlankAdjacencyKind('paragraph')).toBe('paragraph')
    expect(toBlankAdjacencyKind('heading')).toBe('heading')
    expect(toBlankAdjacencyKind('formula')).toBe('math')
    expect(toBlankAdjacencyKind('blockquote')).toBe('quote')
    expect(toBlankAdjacencyKind('figure')).toBe('image')
    expect(toBlankAdjacencyKind('front-matter')).toBe('other')
    expect(toBlankAdjacencyKind(null)).toBe('other')
  })

  it('paragraph → paragraph allows exactly 1 rendered blank', () => {
    const p = resolveAdjacentBlankPolicy('paragraph', 'paragraph')
    expect(p.maxRenderedBlankLines).toBe(1)
    expect(p.repairTarget).toBe(1)
    expect(p.fillMissing).toBe(false)
    expect(p.structuralSourceBlankLines).toBe(1)
  })

  it('EVERY other block pair allows 0 rendered blanks', () => {
    for (const before of KINDS) {
      for (const after of KINDS) {
        if (before === 'paragraph' && after === 'paragraph') continue
        const p = resolveAdjacentBlankPolicy(before, after)
        expect(p.maxRenderedBlankLines, `${before}>${after}`).toBe(0)
        expect(p.repairTarget, `${before}>${after}`).toBe(0)
        expect(p.fillMissing, `${before}>${after}`).toBe(false)
        // a zero allowance still keeps the structural source separator
        expect(p.structuralSourceBlankLines, `${before}>${after}`).toBe(1)
      }
    }
  })

  it('document start allows 0; document end requires exactly 1 and fills', () => {
    const start = resolveAdjacentBlankPolicy('document-start', 'heading')
    expect(start.maxRenderedBlankLines).toBe(0)
    expect(start.fillMissing).toBe(false)
    const end = resolveAdjacentBlankPolicy('paragraph', 'document-end')
    expect(end.maxRenderedBlankLines).toBe(1)
    expect(end.repairTarget).toBe(1)
    expect(end.fillMissing).toBe(true)
  })

  it('excess predicate is strictly greater than the pair allowance', () => {
    const pp = resolveAdjacentBlankPolicy('paragraph', 'paragraph')
    expect([0, 1, 2, 3].map(n => isRenderedBlankCountExcessive(n, pp))).toEqual([false, false, true, true])
    const hh = resolveAdjacentBlankPolicy('heading', 'paragraph')
    expect([0, 1, 2].map(n => isRenderedBlankCountExcessive(n, hh))).toEqual([false, true, true])
  })

  it('the copy names the pair and states ITS allowance', () => {
    expect(blankAdjacencyDetail('paragraph', 'paragraph', 3)).toBe('两个正文段落之间存在 3 个额外空行，应保留 1 个。')
    expect(blankAdjacencyDetail('paragraph', 'heading', 2)).toBe('正文与标题之间存在 2 个额外空行，应清除为 0 个。')
    expect(blankAdjacencyDetail('code', 'paragraph', 1)).toBe('代码块与正文之间存在 1 个额外空行，应清除为 0 个。')
    expect(blankAdjacencyDetail('document-start', 'paragraph', 1)).toBe('文档开头存在 1 个额外空行，应清除为 0 个。')
    expect(blankAdjacencyDetail('paragraph', 'document-end', 2)).toBe('文档末尾存在 2 个额外空行，应保留 1 个。')
  })

  it('the kind-based lookup and the explicit lookup agree', () => {
    expect(resolveAdjacentBlankPolicyByKind('formula', 'blockquote'))
      .toEqual(resolveAdjacentBlankPolicy('math', 'quote'))
    // a missing legacy kind is never paragraph→paragraph by accident
    expect(resolveAdjacentBlankPolicyByKind(undefined, 'paragraph').maxRenderedBlankLines).toBe(0)
  })
})
