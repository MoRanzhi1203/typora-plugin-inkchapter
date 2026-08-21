import { describe, it, expect } from 'vitest'
import { formatObjectNumber, presetToScopeStyle } from './numbering-preset-formatter'

describe('presetToScopeStyle', () => {
  it('maps the five presets to scope + style', () => {
    expect(presetToScopeStyle('global')).toEqual({ requestedScope: 'global', style: 'dot' })
    expect(presetToScopeStyle('chapter-dot')).toEqual({ requestedScope: 'chapter', style: 'dot' })
    expect(presetToScopeStyle('section-dot')).toEqual({ requestedScope: 'section', style: 'dot' })
    expect(presetToScopeStyle('chapter-dash')).toEqual({ requestedScope: 'chapter', style: 'dash' })
    expect(presetToScopeStyle('section-dash')).toEqual({ requestedScope: 'section', style: 'dash' })
  })
})

describe('formatObjectNumber — five presets (chapter=2, section=1, ordinal=3)', () => {
  it('GLOBAL -> 3', () => {
    expect(formatObjectNumber('global', 'dot', 2, 1, 3)).toBe('3')
  })
  it('CHAPTER_DOT -> 2.3', () => {
    expect(formatObjectNumber('chapter', 'dot', 2, null, 3)).toBe('2.3')
  })
  it('SECTION_DOT -> 2.1.3', () => {
    expect(formatObjectNumber('section', 'dot', 2, 1, 3)).toBe('2.1.3')
  })
  it('CHAPTER_DASH -> 2-3', () => {
    expect(formatObjectNumber('chapter', 'dash', 2, null, 3)).toBe('2-3')
  })
  it('SECTION_DASH -> 2.1-3', () => {
    expect(formatObjectNumber('section', 'dash', 2, 1, 3)).toBe('2.1-3')
  })
})

describe('formatObjectNumber — degradation keeps style', () => {
  it('SECTION_DASH degraded to chapter -> 2-3', () => {
    expect(formatObjectNumber('chapter', 'dash', 2, null, 3)).toBe('2-3')
  })
  it('SECTION_DASH degraded to global -> 3', () => {
    expect(formatObjectNumber('global', 'dash', null, null, 3)).toBe('3')
  })
  it('SECTION_DOT degraded to chapter -> 2.3', () => {
    expect(formatObjectNumber('chapter', 'dot', 2, null, 3)).toBe('2.3')
  })
})
