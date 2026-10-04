// @vitest-environment jsdom
/**
 * Capability Matrix V1 — Phase F (§7 / §19): Section Completeness closure.
 *
 * Verifies (not merely "the code exists"):
 *   §7  whole-document headings-only  → DOCUMENT_HEADINGS_ONLY_NO_BODY=1,
 *                                        SECTION_EMPTY=0, SECTION_ONLY_SUBHEADINGS=0
 *   §7  empty leaf section            → SECTION_EMPTY=1
 *   §7  local only-subheadings subtree → SECTION_ONLY_SUBHEADINGS=1, SECTION_EMPTY=0
 *   §7  SECTION_EMPTY ⟂ SECTION_ONLY_SUBHEADINGS (per heading)
 *   §7  dynamic (event-driven recompute, no polling): add body → hint disappears;
 *       remove body → returns; add child heading → EMPTY→ONLY_SUBHEADINGS;
 *       descendant body → ONLY_SUBHEADINGS disappears
 *   §19 locator correctness: the section hint targets its OWN heading
 *       (SECTION_LOCATOR_WRONG_HEADING_COUNT=0)
 */
import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE,
  SECTION_EMPTY_CODE,
  SECTION_ONLY_SUBHEADINGS_CODE,
  computeDocumentDiagnostics,
  type DocumentDiagnosticsInput,
} from './document-diagnostics'
import { getRuleMeta } from './document-diagnostic-location'
import type { DocumentDiagnostic } from './diagnostics-types'

interface HeadingSpec {
  level: number
  text: string
  line: number
}

function makeElement(tag: string, line: number, text: string): HTMLElement {
  const el = document.createElement(tag)
  el.setAttribute('data-line', String(line))
  el.textContent = text
  return el
}

function inputOf(markdown: string, headings: readonly HeadingSpec[]): DocumentDiagnosticsInput {
  const facts = headings.map((h, i) => ({
    level: h.level,
    text: h.text,
    stableIdentity: `H:${i}`,
    element: makeElement(`h${h.level}`, h.line, h.text),
  }))
  return {
    documentKey: 'doc:section-f',
    markdown,
    strictMode: true,
    vaultRoot: '/vault',
    headings: facts,
    h1Facts: facts.filter(f => f.level === 1).map(f => ({ stableIdentity: f.stableIdentity, element: f.element, text: f.text })),
    latentAtxMarkers: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
  }
}

const compile = (markdown: string, headings: readonly HeadingSpec[]): DocumentDiagnostic[] =>
  computeDocumentDiagnostics(inputOf(markdown, headings)).diagnostics

const countOf = (diags: readonly DocumentDiagnostic[], code: string): number =>
  diags.filter(d => d.code === code).length

const sectionHints = (diags: readonly DocumentDiagnostic[]): DocumentDiagnostic[] =>
  diags.filter(d => d.code === SECTION_EMPTY_CODE || d.code === SECTION_ONLY_SUBHEADINGS_CODE)

// ── §7 — whole-document suppression ─────────────────────────────────────────

describe('Phase F §7 — whole-document headings-only suppression', () => {
  it('# A / ## B / ### C with no body → headings-only=1 and BOTH section hints = 0', () => {
    const md = '# A\n\n## B\n\n### C\n'
    const headings: HeadingSpec[] = [
      { level: 1, text: 'A', line: 0 },
      { level: 2, text: 'B', line: 2 },
      { level: 3, text: 'C', line: 4 },
    ]
    const diags = compile(md, headings)
    expect(countOf(diags, DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE)).toBe(1)
    expect(countOf(diags, SECTION_EMPTY_CODE)).toBe(0)
    expect(countOf(diags, SECTION_ONLY_SUBHEADINGS_CODE)).toBe(0)
    expect(sectionHints(diags)).toHaveLength(0)
  })
})

// ── §7 — empty leaf section ─────────────────────────────────────────────────

describe('Phase F §7 — SECTION_EMPTY for an empty leaf section', () => {
  it('# A / body / ## B (B empty) → SECTION_EMPTY for B only', () => {
    const md = '# A\n\n正文\n\n## B\n'
    const headings: HeadingSpec[] = [
      { level: 1, text: 'A', line: 0 },
      { level: 2, text: 'B', line: 4 },
    ]
    const hits = compile(md, headings).filter(d => d.code === SECTION_EMPTY_CODE)
    expect(hits).toHaveLength(1)
    expect(hits[0].targetIdentity).toBe('section:H:1')
    expect(hits[0].severity).toBe('info')
  })
})

// ── §7 — local only-subheadings subtree does NOT trigger whole-doc suppression ─

describe('Phase F §7 — local SECTION_ONLY_SUBHEADINGS without whole-document suppression', () => {
  const md = '# A\n\n## B\n\n# C\n\n正文\n'
  const headings: HeadingSpec[] = [
    { level: 1, text: 'A', line: 0 },
    { level: 2, text: 'B', line: 2 },
    { level: 1, text: 'C', line: 4 },
  ]

  it('A (subtree of only subheadings) → SECTION_ONLY_SUBHEADINGS, NOT SECTION_EMPTY', () => {
    const diags = compile(md, headings)
    // The document HAS body (under C) → no whole-document suppression.
    expect(countOf(diags, DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE)).toBe(0)
    const only = diags.filter(d => d.code === SECTION_ONLY_SUBHEADINGS_CODE)
    expect(only).toHaveLength(1)
    expect(only[0].targetIdentity).toBe('section:H:0')
    // A is not simultaneously SECTION_EMPTY.
    expect(diags.filter(d => d.code === SECTION_EMPTY_CODE).some(d => d.targetIdentity === 'section:H:0')).toBe(false)
  })

  it('SECTION_EMPTY ⟂ SECTION_ONLY_SUBHEADINGS for every heading', () => {
    const diags = compile(md, headings)
    const seen = new Map<string, number>()
    for (const d of sectionHints(diags)) {
      const key = String(d.targetIdentity)
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    for (const count of seen.values()) expect(count).toBe(1)
  })
})

// ── §7 — dynamic, event-driven recompute (no polling) ───────────────────────

describe('Phase F §7 — dynamic refresh through pure recompute', () => {
  const emptyDoc = '# A\n\n# B\n\n正文\n'
  const emptyDocHeadings: HeadingSpec[] = [
    { level: 1, text: 'A', line: 0 },
    { level: 1, text: 'B', line: 2 },
  ]

  it('add body → SECTION_EMPTY disappears; remove body → it returns', () => {
    const before = compile(emptyDoc, emptyDocHeadings)
    expect(before.filter(d => d.code === SECTION_EMPTY_CODE && d.targetIdentity === 'section:H:0')).toHaveLength(1)

    const withBodyMd = '# A\n\n内容\n\n# B\n\n正文\n'
    const withBodyHeadings: HeadingSpec[] = [
      { level: 1, text: 'A', line: 0 },
      { level: 1, text: 'B', line: 4 },
    ]
    const withBody = compile(withBodyMd, withBodyHeadings)
    expect(withBody.filter(d => d.code === SECTION_EMPTY_CODE && d.targetIdentity === 'section:H:0')).toHaveLength(0)

    const again = compile(emptyDoc, emptyDocHeadings)
    expect(again.filter(d => d.code === SECTION_EMPTY_CODE && d.targetIdentity === 'section:H:0')).toHaveLength(1)
  })

  it('add child heading → SECTION_EMPTY becomes SECTION_ONLY_SUBHEADINGS', () => {
    const withChildMd = '# A\n\n## C\n\n# B\n\n正文\n'
    const withChildHeadings: HeadingSpec[] = [
      { level: 1, text: 'A', line: 0 },
      { level: 2, text: 'C', line: 2 },
      { level: 1, text: 'B', line: 4 },
    ]
    const diags = compile(withChildMd, withChildHeadings)
    expect(diags.filter(d => d.code === SECTION_EMPTY_CODE && d.targetIdentity === 'section:H:0')).toHaveLength(0)
    expect(diags.filter(d => d.code === SECTION_ONLY_SUBHEADINGS_CODE && d.targetIdentity === 'section:H:0')).toHaveLength(1)
  })

  it('descendant body → SECTION_ONLY_SUBHEADINGS disappears', () => {
    const withBodyMd = '# A\n\n## C\n\n正文C\n\n# B\n\n正文\n'
    const withBodyHeadings: HeadingSpec[] = [
      { level: 1, text: 'A', line: 0 },
      { level: 2, text: 'C', line: 2 },
      { level: 1, text: 'B', line: 6 },
    ]
    const diags = compile(withBodyMd, withBodyHeadings)
    expect(diags.filter(d => d.code === SECTION_ONLY_SUBHEADINGS_CODE && d.targetIdentity === 'section:H:0')).toHaveLength(0)
  })
})

// ── §19 — locator correctness: the hint targets its OWN heading ─────────────

describe('Phase F §19 — SECTION_LOCATOR_WRONG_HEADING_COUNT=0', () => {
  const md = '# A\n\n## B\n\n# C\n\n正文\n'
  const headings: HeadingSpec[] = [
    { level: 1, text: 'A', line: 0 },
    { level: 2, text: 'B', line: 2 },
    { level: 1, text: 'C', line: 4 },
  ]

  it('every section hint canonical-node identity equals its own heading identity', () => {
    const diags = compile(md, headings)
    const hints = sectionHints(diags)
    expect(hints.length).toBeGreaterThan(0)
    for (const d of hints) {
      expect(d.location?.kind).toBe('canonical-node')
      const identity = d.location?.kind === 'canonical-node' ? d.location.stableIdentity : null
      // targetIdentity is `section:<heading stable identity>` — it must match the
      // SAME heading the location points at.
      expect(d.targetIdentity).toBe(`section:${identity}`)
      expect(d.stableIdentity).toBe(identity)
      // The locator descriptor targets that heading's own live element.
      expect(d.locator?.kind).toBe('heading')
    }
    // H:0 → ONLY_SUBHEADINGS, H:1 → EMPTY; never swapped.
    const byIdentity = new Map(hints.map(h => [String(h.stableIdentity), h.code]))
    expect(byIdentity.get('H:0')).toBe(SECTION_ONLY_SUBHEADINGS_CODE)
    expect(byIdentity.get('H:1')).toBe(SECTION_EMPTY_CODE)
  })
})

// ── §7 — registry suppression metadata reflects reality ─────────────────────

describe('Phase F §7 — section suppression registry metadata', () => {
  it('SECTION_* declare the document-completeness suppression cluster + parent', () => {
    for (const code of [SECTION_EMPTY_CODE, SECTION_ONLY_SUBHEADINGS_CODE]) {
      const meta = getRuleMeta(code)
      expect(meta, code).not.toBeNull()
      expect(meta!.suppressionGroup, code).toBe('section-completeness')
      expect(meta!.suppressionParentFamilyId, code).toBe('DOCUMENT_HEADINGS_ONLY_NO_BODY')
    }
    for (const code of [DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE]) {
      expect(getRuleMeta(code)!.suppressionGroup).toBe('section-completeness')
    }
  })
})
