// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.4.1 — Latent ATX Heading Marker detector (pure).
 *
 * DET-*  escaped suppression
 * CAND-* candidate predicate (Typora/CommonMark ATX shape)
 * EXCL-* canonical exclusion (data-line + text-key)
 * FENCE-* fenced code skip
 * LINE-* line/column/marker metadata
 */
import { describe, it, expect } from 'vitest'
import {
  detectLatentAtxMarkers,
  collectCanonicalHeadingSourceLines,
  collectCanonicalHeadingTextKeys,
} from './latent-atx-heading-marker'

describe('DET escaped marker suppression', () => {
  it('DET-1: \\#, \\##, \\#### → latent=0 escaped=3, no structure effect', () => {
    const md = '\\#\n\\##\n\\####\n'
    const r = detectLatentAtxMarkers(md)
    expect(r.latent).toHaveLength(0)
    expect(r.escaped.map(f => f.markerLevel)).toEqual([1, 2, 4])
  })

  it('DET-2: escaped markers never become latent even without canonical frame', () => {
    const r = detectLatentAtxMarkers('\\##\n\\######\n')
    expect(r.latent).toHaveLength(0)
    expect(r.escaped).toHaveLength(2)
  })

  it('DET-3: escaped count has zero error/warning/hint potential (facts escaped=true)', () => {
    const r = detectLatentAtxMarkers('\\#\n')
    expect(r.escaped[0].escaped).toBe(true)
    expect(r.escaped[0].markerLevel).toBe(1)
  })
})

describe('CAND candidate predicate', () => {
  it('CAND-1: bare # / ## / #### are latent candidates (level 1/2/4)', () => {
    const md = '#\n##\n####\n'
    const r = detectLatentAtxMarkers(md)
    expect(r.latent.map(f => f.markerLevel)).toEqual([1, 2, 4])
    expect(r.latent.map(f => f.line)).toEqual([0, 1, 2])
  })

  it('CAND-2: "# text" IS a candidate; "#text" (no space) is NOT', () => {
    const md = '# text\n#text\n'
    const r = detectLatentAtxMarkers(md)
    expect(r.latent.map(f => f.line)).toEqual([0])
    expect(r.latent[0].text).toBe('text')
  })

  it('CAND-3: "#######" (7 hashes) and "    ##" (4 spaces) are NOT candidates', () => {
    const md = '#######\n    ##\n'
    const r = detectLatentAtxMarkers(md)
    expect(r.latent).toHaveLength(0)
  })

  it('CAND-4: 1-3 leading spaces are allowed (column reported), 4+ are not', () => {
    const md = ' ##\n  ##\n   ##\n    ##\n'
    const r = detectLatentAtxMarkers(md)
    expect(r.latent.map(f => f.column)).toEqual([1, 2, 3])
    expect(r.latent).toHaveLength(3)
  })

  it('CAND-5: closing hash sequence is stripped from text', () => {
    const r = detectLatentAtxMarkers('## 标题 ##\n')
    expect(r.latent[0].text).toBe('标题')
  })

  it('CAND-6: inline hashes are never candidates (not line-start)', () => {
    const md = '价格 #1\nC# language\nfoo ## bar\n'
    const r = detectLatentAtxMarkers(md)
    expect(r.latent).toHaveLength(0)
  })

  it('CAND-7: blockquote/list prefixes are never candidates', () => {
    const md = '> ## 引用内\n- ## 列表内\n'
    const r = detectLatentAtxMarkers(md)
    expect(r.latent).toHaveLength(0)
  })
})

describe('EXCL canonical exclusion', () => {
  it('EXCL-1: candidate line in canonicalHeadingLines → NOT latent', () => {
    const md = '##\n## 标题\n'
    const r = detectLatentAtxMarkers(md, new Set([1]))
    expect(r.latent.map(f => f.line)).toEqual([0]) // only the bare ## stays latent
  })

  it('EXCL-2: text-key fallback excludes canonical headings without data-line', () => {
    const md = '## 标题\n'
    const r = detectLatentAtxMarkers(md, new Set(), new Set(['2:标题']))
    expect(r.latent).toHaveLength(0)
  })

  it('EXCL-3: empty canonical H2 (line occupied) suppresses latent for that line', () => {
    const md = '##\n'
    const r = detectLatentAtxMarkers(md, new Set([0]))
    expect(r.latent).toHaveLength(0) // canonical empty H2 → EMPTY_HEADING takes over
  })

  it('EXCL-4: transition — removing the canonical line re-enables latent', () => {
    const md = '##\n'
    const r1 = detectLatentAtxMarkers(md, new Set([0]))
    expect(r1.latent).toHaveLength(0)
    const r2 = detectLatentAtxMarkers(md, new Set())
    expect(r2.latent.map(f => f.line)).toEqual([0])
  })
})

describe('FENCE fenced code skip', () => {
  it('FENCE-1: hashes inside a fenced code block are never candidates', () => {
    const md = '```\n##\n#\n```\n##\n'
    const r = detectLatentAtxMarkers(md)
    // only the trailing bare ## outside the fence is latent
    expect(r.latent.map(f => f.line)).toEqual([4])
  })

  it('FENCE-2: tilde fences are handled too', () => {
    const md = '~~~\n##\n~~~\n'
    const r = detectLatentAtxMarkers(md)
    expect(r.latent).toHaveLength(0)
  })

  it('FENCE-3: unclosed fence suppresses everything after it', () => {
    const md = '```\n##\n'
    const r = detectLatentAtxMarkers(md)
    expect(r.latent).toHaveLength(0)
  })
})

describe('LINE metadata', () => {
  it('LINE-1: line index and marker text are accurate', () => {
    const md = '正文\n##\n### 三\n'
    const r = detectLatentAtxMarkers(md)
    expect(r.latent.map(f => f.line)).toEqual([1, 2])
    expect(r.latent[0].markerText).toBe('##')
    expect(r.latent[1].markerText).toBe('###')
    expect(r.latent[1].text).toBe('三')
  })

  it('LINE-2: CRLF line endings do not break detection', () => {
    const md = '##\r\n####\r\n'
    const r = detectLatentAtxMarkers(md)
    expect(r.latent.map(f => f.markerLevel)).toEqual([2, 4])
  })

  it('LINE-3: null markdown → empty result', () => {
    expect(detectLatentAtxMarkers(null)).toEqual({ latent: [], escaped: [], canonicalLines: [] })
  })
})

describe('HELPERS source-line collection', () => {
  it('collectCanonicalHeadingSourceLines reads data-line attributes', () => {
    const el1 = document.createElement('div')
    el1.setAttribute('data-line', '3')
    const el2 = document.createElement('div')
    el2.setAttribute('data-line', '7')
    const lines = collectCanonicalHeadingSourceLines([el1, el2, null])
    expect([...lines]).toEqual([3, 7])
  })

  it('collectCanonicalHeadingTextKeys normalizes level:text', () => {
    const keys = collectCanonicalHeadingTextKeys([
      { physicalLevel: 2, text: ' 标题 ' },
      { physicalLevel: 1, text: '' },
    ])
    expect(keys.has('2:标题')).toBe(true)
    expect(keys.has('1:')).toBe(true)
  })
})
