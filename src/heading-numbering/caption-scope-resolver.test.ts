import { describe, it, expect } from 'vitest'
import { resolveCaptionScope } from './caption-scope-resolver'

describe('resolveCaptionScope', () => {
  it('GLOBAL always resolves to global without degrade', () => {
    const r = resolveCaptionScope('global', 2, 1)
    expect(r.effectiveScope).toBe('global')
    expect(r.degraded).toBe(false)
    expect(r.chapter).toBeNull()
    expect(r.section).toBeNull()
  })

  it('CHAPTER resolves exactly when chapter present', () => {
    const r = resolveCaptionScope('chapter', 2, 1)
    expect(r.effectiveScope).toBe('chapter')
    expect(r.chapter).toBe(2)
    expect(r.section).toBeNull()
    expect(r.degraded).toBe(false)
  })

  it('CHAPTER degrades to global when no chapter', () => {
    const r = resolveCaptionScope('chapter', null, null)
    expect(r.effectiveScope).toBe('global')
    expect(r.degraded).toBe(true)
    expect(r.resolutionReason).toBe('CHAPTER_TO_GLOBAL')
  })

  it('SECTION resolves exactly when chapter + section present', () => {
    const r = resolveCaptionScope('section', 2, 1)
    expect(r.effectiveScope).toBe('section')
    expect(r.chapter).toBe(2)
    expect(r.section).toBe(1)
    expect(r.degraded).toBe(false)
  })

  it('SECTION degrades to chapter when section missing', () => {
    const r = resolveCaptionScope('section', 2, null)
    expect(r.effectiveScope).toBe('chapter')
    expect(r.chapter).toBe(2)
    expect(r.section).toBeNull()
    expect(r.degraded).toBe(true)
    expect(r.resolutionReason).toBe('SECTION_TO_CHAPTER')
  })

  it('SECTION degrades to global when both missing', () => {
    const r = resolveCaptionScope('section', null, null)
    expect(r.effectiveScope).toBe('global')
    expect(r.degraded).toBe(true)
    expect(r.resolutionReason).toBe('SECTION_TO_GLOBAL')
  })
})
