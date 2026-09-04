// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.11 — Plain-Body-Only Strict Heading Exemption.
 *
 * The ONLY strict-H1 exemption is DOCUMENT SHAPE: the whole document is plain
 * body text (headingCount across H1..H6 === 0, meaningful body present).
 *
 *   plain body only            → no missing-H1 / first-H1 errors  (exempt)
 *   body + any heading (H1..H6)→ exemption ends, strict rules resume
 *   body + H1 + H1             → multiple-H1 returns too
 *   headings removed → back to plain body → strict errors auto-gone
 *
 * The exemption is independent of heading-policy enabled/configured/
 * activationSource: stored strict mode must NOT keep plain docs complaining,
 * and a heading document must NOT be silenced by "policy inactive".
 */
import { describe, it, expect } from 'vitest'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'

function el(tag: string): HTMLElement {
  return document.createElement(tag)
}

interface ShapeCase {
  strictMode?: boolean
  markdown: string
  headings?: DocumentDiagnosticsInput['headings']
  h1Facts?: DocumentDiagnosticsInput['h1Facts']
}

function compute(cfg: ShapeCase) {
  const input: DocumentDiagnosticsInput = {
    documentKey: 'doc:key',
    markdown: cfg.markdown,
    strictMode: cfg.strictMode ?? true,
    vaultRoot: '/vault',
    headings: cfg.headings ?? [],
    h1Facts: cfg.h1Facts ?? [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
  }
  return computeDocumentDiagnostics(input)
}

const h1 = (text: string) => ({ level: 1 as const, text, element: el('h1') })
const h2 = (text: string) => ({ level: 2 as const, text, element: el('h2') })
const h3 = (text: string) => ({ level: 3 as const, text, element: el('h3') })

function hasStrictCode(r: { diagnostics: Array<{ code: string }> }): boolean {
  return r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_') || d.code.startsWith('STRICT_FIRST_H1_') || d.code === 'STRICT_H1_MISSING')
}

describe('PLAIN-BODY-ONLY exemption — pure matrix', () => {
  it('PLAIN_BODY_EXEMPT: pure body + stored strict mode + no policy → NO strict error', () => {
    const r = compute({ strictMode: true, markdown: '纯正文。\n第二段。\n' })
    expect(hasStrictCode(r)).toBe(false)
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(false)
  })

  it('BODY_THEN_H1: heading appears → exemption ends → first-H1 violation returns', () => {
    const r = compute({ markdown: '纯正文。\n\n# 题目1\n', headings: [h1('题目1')], h1Facts: [{ stableIdentity: 'h1-0', element: el('h1') }] })
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_FIRST_H1_'))).toBe(true)
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(false)
  })

  it('BODY_THEN_H1_THEN_H1: two H1 → multiple-H1 error returns', () => {
    const r = compute({
      markdown: '纯正文。\n\n# 题目1\n\n# 题目2\n',
      headings: [h1('题目1'), h1('题目2')],
      h1Facts: [
        { stableIdentity: 'h1-0', element: el('h1') },
        { stableIdentity: 'h1-1', element: el('h1') },
      ],
    })
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')).toBe(true)
  })

  it('BODY_THEN_H2: H2 only → exemption ends → missing-H1 error returns', () => {
    const r = compute({ markdown: '纯正文。\n\n## 小节\n', headings: [h2('小节')], h1Facts: [] })
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(true)
  })

  it('SINGLE_H1_TOP: heading-only doc with one H1 at top → strict PASS (no error)', () => {
    const r = compute({ markdown: '# 题目\n', headings: [h1('题目')], h1Facts: [{ stableIdentity: 'h1-0', element: el('h1') }] })
    expect(hasStrictCode(r)).toBe(false)
  })

  it('LOOSE isolation: loose + multi H1 or H2-only → no strict rules', () => {
    const multi = compute({
      strictMode: false,
      markdown: '# A\n\n# B\n',
      headings: [h1('A'), h1('B')],
      h1Facts: [{ stableIdentity: 'a', element: el('h1') }, { stableIdentity: 'b', element: el('h1') }],
    })
    const h2only = compute({ strictMode: false, markdown: '## 小节\n', headings: [h2('小节')], h1Facts: [] })
    expect(hasStrictCode(multi)).toBe(false)
    expect(hasStrictCode(h2only)).toBe(false)
  })

  it('HEADING_DOC_IGNORES_ACTIVATION: stored strict + NO policy flags + heading → strict rules still run', () => {
    // Regression for the revoked wrong gate: heading docs must not be silenced
    // by an "unconfigured" activation state.
    const r = compute({ markdown: '## 小节\n', headings: [h2('小节')], h1Facts: [] })
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(true)
  })

  it('DELETE_TO_PLAIN: after removing headings the doc is exempt again (0 strict)', () => {
    const plain = compute({ markdown: '只剩正文。\n', headings: [], h1Facts: [] })
    expect(hasStrictCode(plain)).toBe(false)
  })

  it('GENERIC_HEADING_SKIP_STILL_ACTIVE: H1→H3 gap stays while plain/exempt or heading docs', () => {
    const r = compute({
      markdown: '# A\n\n### C\n',
      headings: [h1('A'), h3('C')],
      h1Facts: [{ stableIdentity: 'h1-0', element: el('h1') }],
    })
    const gap = r.diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')
    expect(gap).toBeTruthy()
    expect(gap?.message).toContain('H1')
  })
})
