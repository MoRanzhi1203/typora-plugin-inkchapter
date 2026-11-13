import { describe, expect, it } from 'vitest'
import {
  allowedVisibleBlankLines,
  blankAdjacencyDetail,
  extraRenderedBlankLines,
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

  it('paragraph → paragraph allows 1 EXTRA rendered blank beyond the separator', () => {
    const p = resolveAdjacentBlankPolicy('paragraph', 'paragraph')
    expect(p.maxRenderedBlankLines).toBe(1)
    expect(p.repairTarget).toBe(1)
    expect(p.fillMissing).toBe(false)
    expect(p.structuralSourceBlankLines).toBe(1)
    expect(p.structuralRenderedBlankLines).toBe(1)
    expect(allowedVisibleBlankLines(p)).toBe(2)
  })

  it('EVERY other block pair allows 0 EXTRA rendered blanks (separator excluded)', () => {
    for (const before of KINDS) {
      for (const after of KINDS) {
        if (before === 'paragraph' && after === 'paragraph') continue
        const p = resolveAdjacentBlankPolicy(before, after)
        expect(p.maxRenderedBlankLines, `${before}>${after}`).toBe(0)
        expect(p.repairTarget, `${before}>${after}`).toBe(0)
        expect(p.fillMissing, `${before}>${after}`).toBe(false)
        // a zero extra allowance still keeps the structural source separator
        expect(p.structuralSourceBlankLines, `${before}>${after}`).toBe(1)
        expect(p.structuralRenderedBlankLines, `${before}>${after}`).toBe(1)
        expect(allowedVisibleBlankLines(p), `${before}>${after}`).toBe(1)
      }
    }
  })

  it('a normal single separator row is never excessive', () => {
    for (const before of KINDS) {
      for (const after of KINDS) {
        const p = resolveAdjacentBlankPolicy(before, after)
        expect(isRenderedBlankCountExcessive(0, p), `${before}>${after}`).toBe(false)
        expect(isRenderedBlankCountExcessive(1, p), `${before}>${after}`).toBe(false)
      }
    }
  })

  it('document start allows 0 and has no structural row; document end keeps 1', () => {
    const start = resolveAdjacentBlankPolicy('document-start', 'heading')
    expect(start.maxRenderedBlankLines).toBe(0)
    expect(start.structuralRenderedBlankLines).toBe(0)
    expect(allowedVisibleBlankLines(start)).toBe(0)
    expect(start.fillMissing).toBe(false)
    const end = resolveAdjacentBlankPolicy('paragraph', 'document-end')
    expect(end.maxRenderedBlankLines).toBe(1)
    expect(end.repairTarget).toBe(1)
    expect(end.fillMissing).toBe(true)
  })

  it('excess predicate is strictly greater than separator + extra allowance', () => {
    const pp = resolveAdjacentBlankPolicy('paragraph', 'paragraph')
    expect([0, 1, 2, 3, 4].map(n => isRenderedBlankCountExcessive(n, pp)))
      .toEqual([false, false, false, true, true])
    const hp = resolveAdjacentBlankPolicy('heading', 'paragraph')
    expect([0, 1, 2, 3].map(n => isRenderedBlankCountExcessive(n, hp)))
      .toEqual([false, false, true, true])
    expect([0, 1, 2].map(n => extraRenderedBlankLines(n, hp))).toEqual([0, 0, 1])
  })

  it('the copy states the EXTRA count beyond the structural separator', () => {
    expect(blankAdjacencyDetail('paragraph', 'paragraph', 3)).toBe('两个正文段落之间存在 2 个额外空行，应保留 1 个。')
    expect(blankAdjacencyDetail('paragraph', 'heading', 2)).toBe('正文与标题之间存在 1 个额外空行，应清除为 0 个。')
    expect(blankAdjacencyDetail('code', 'paragraph', 3)).toBe('代码块与正文之间存在 2 个额外空行，应清除为 0 个。')
    expect(blankAdjacencyDetail('document-start', 'paragraph', 1)).toBe('文档开头存在 1 个额外空行，应清除为 0 个。')
    expect(blankAdjacencyDetail('paragraph', 'document-end', 3)).toBe('文档末尾存在 2 个额外空行，应保留 1 个。')
  })

  it('the kind-based lookup and the explicit lookup agree', () => {
    expect(resolveAdjacentBlankPolicyByKind('formula', 'blockquote'))
      .toEqual(resolveAdjacentBlankPolicy('math', 'quote'))
    // a missing legacy kind is never paragraph→paragraph by accident
    expect(resolveAdjacentBlankPolicyByKind(undefined, 'paragraph').maxRenderedBlankLines).toBe(0)
  })
})
