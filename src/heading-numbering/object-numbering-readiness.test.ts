import { describe, it, expect } from 'vitest'
import { resolveObjectNumberingReadiness } from './object-numbering-engine'

describe('resolveObjectNumberingReadiness (v2.5.3)', () => {
  it('continuous → READY with only documentKey', () => {
    const r = resolveObjectNumberingReadiness({
      documentKey: 'docA',
      requestedScope: 'document',
      ordinals: { chapterOrdinal: null, sectionOrdinal: null, subsectionOrdinal: null },
    })
    expect(r.contextState).toBe('READY')
    expect(r.decision).toBe('READY')
    expect(r.missingFields).toEqual([])
  })

  it('chapter-dot missing chapter → NOT_READY / MISSING_CHAPTER_ORDINAL', () => {
    const r = resolveObjectNumberingReadiness({
      documentKey: 'docA',
      requestedScope: 'chapter',
      ordinals: { chapterOrdinal: null, sectionOrdinal: null, subsectionOrdinal: null },
    })
    expect(r.contextState).toBe('PARTIAL')
    expect(r.decision).toBe('NOT_READY')
    expect(r.reason).toBe('MISSING_CHAPTER_ORDINAL')
  })

  it('section-dot missing section → NOT_READY / MISSING_SECTION_ORDINAL', () => {
    const r = resolveObjectNumberingReadiness({
      documentKey: 'docA',
      requestedScope: 'section',
      ordinals: { chapterOrdinal: 1, sectionOrdinal: null, subsectionOrdinal: null },
    })
    expect(r.decision).toBe('NOT_READY')
    expect(r.reason).toBe('MISSING_SECTION_ORDINAL')
  })

  it('section-dot complete → READY', () => {
    const r = resolveObjectNumberingReadiness({
      documentKey: 'docA',
      requestedScope: 'section',
      ordinals: { chapterOrdinal: 1, sectionOrdinal: 2, subsectionOrdinal: null },
    })
    expect(r.contextState).toBe('READY')
    expect(r.decision).toBe('READY')
  })

  it('missing documentKey → NOT_READY / MISSING_DOCUMENT_KEY', () => {
    const r = resolveObjectNumberingReadiness({
      documentKey: null,
      requestedScope: 'section',
      ordinals: { chapterOrdinal: 1, sectionOrdinal: 2, subsectionOrdinal: null },
    })
    expect(r.contextState).toBe('NOT_READY')
    expect(r.decision).toBe('NOT_READY')
    expect(r.reason).toBe('MISSING_DOCUMENT_KEY')
  })
})
