import { describe, it, expect } from 'vitest'
import type { HeadingNumberingSnapshot } from './heading-numbering-snapshot'
import type { SemanticHeadingNumberState } from './semantic-heading-types'
import {
  buildObjectCaptionExport,
  formatObjectNumberText,
  insertObjectCaptionForExport,
  resolveObjectNumberingScope,
} from './numbering-object-export-adapter'

function semantic(identity: string, chapter: number, section: number | null): SemanticHeadingNumberState {
  return {
    stableIdentity: identity,
    physicalLevel: 2,
    effectiveDepth: 1,
    semanticRole: 'section',
    structuralParentIdentity: 'h1',
    structuralChapterIdentity: 'h1',
    structuralSectionIdentity: null,
    ordinalByDepth: [chapter, section],
    displayCountedPath: [chapter, section ?? 0],
    logicalOrdinal: chapter,
    chapterOrdinal: chapter,
    sectionOrdinal: section,
    strictBoundaryIdentity: 'h1',
    strictBoundaryOrdinal: null,
    counted: true,
    countingReason: 'TEST',
    sourceRevision: 1,
  }
}

function snapshot(states: SemanticHeadingNumberState[]): HeadingNumberingSnapshot {
  return {
    documentKey: 'doc.md',
    revision: 1,
    structureMode: 'strict',
    headings: [],
    physical: [],
    semantic: states,
  }
}

describe('R08 — object numbering export adapter', () => {
  it('derives the chapter prefix from the unified heading snapshot', () => {
    const scope = resolveObjectNumberingScope(snapshot([semantic('h2', 2, 1)]), 'h2')
    expect(scope).toEqual({ chapterOrdinal: 2, sectionOrdinal: 1 })
    expect(formatObjectNumberText('figure', 3, scope).numberText).toBe('2-3')
    expect(formatObjectNumberText('table', 1, scope, 'dot').numberText).toBe('2.1')
  })

  it('never fabricates a chapter prefix when the heading is unknown', () => {
    const scope = resolveObjectNumberingScope(snapshot([]), 'missing')
    expect(scope).toEqual({ chapterOrdinal: null, sectionOrdinal: null })
    expect(formatObjectNumberText('figure', 4, scope).numberText).toBe('4')
  })

  it('updates the object number when the chapter changes', () => {
    const before = formatObjectNumberText('figure', 1, resolveObjectNumberingScope(snapshot([semantic('h2', 1, 1)]), 'h2'))
    const after = formatObjectNumberText('figure', 1, resolveObjectNumberingScope(snapshot([semantic('h2', 2, 1)]), 'h2'))
    expect(before.numberText).toBe('1-1')
    expect(after.numberText).toBe('2-1')
  })

  it('places table captions above, figure captions below, code captions outside the fence', () => {
    const number = formatObjectNumberText('table', 1, { chapterOrdinal: 2, sectionOrdinal: null })
    expect(buildObjectCaptionExport(number, '数据').placement).toBe('above')
    expect(buildObjectCaptionExport(formatObjectNumberText('figure', 1, { chapterOrdinal: 2, sectionOrdinal: null }), '流程').placement).toBe('below')
    expect(buildObjectCaptionExport(formatObjectNumberText('code', 1, { chapterOrdinal: 2, sectionOrdinal: null }), '示例').placement).toBe('outside-fence')
    expect(buildObjectCaptionExport(formatObjectNumberText('code', 1, { chapterOrdinal: 2, sectionOrdinal: null }), '').caption).toBe('代码 2-1')
  })

  it('formats formulas as an export-only tag, never inline number text', () => {
    const number = formatObjectNumberText('formula', 2, { chapterOrdinal: 3, sectionOrdinal: null })
    const result = buildObjectCaptionExport(number, '')
    expect(result.caption).toBe('\\tag{3-2}')
    expect(result.placement).toBe('formula-tag')
  })

  it('inserts a caption line without touching the original string', () => {
    const markdown = ['# 文档', '', '| a |', '| - |'].join('\n')
    const inserted = insertObjectCaptionForExport(markdown, { caption: '表 1-1 数据', placement: 'above' }, 2)
    expect(inserted).toContain('表 1-1 数据')
    expect(markdown).not.toContain('表 1-1')
  })
})
