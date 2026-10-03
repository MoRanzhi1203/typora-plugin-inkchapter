// @vitest-environment jsdom
/**
 * DOCUMENT_HEADING_ONLY_NO_BODY V1 — targeted contract tests (§35).
 *
 * The rule is a DOCUMENT-SHAPE hint, never a completeness score:
 *   headingCount === 1 && no substantive non-heading content && !documentEmpty
 *
 * These tests lock down: DOCUMENT_EMPTY precedence, the whole content-type
 * matrix (paragraph / list / blockquote / code / table / image / formula must
 * all suppress the hint), the EXACT single-heading scope, strict-H1
 * coexistence, the canonical target + stable identity, real-time refresh
 * (body insert / delete) and the source-only body authority.
 */
import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_HEADING_ONLY_NO_BODY_CODE,
  computeDocumentDiagnostics,
  hasSubstantiveNonHeadingContent,
  resolveDocumentDiagnosticSeverity,
  type DocumentDiagnosticsInput,
} from './document-diagnostics'
import { DOCUMENT_EMPTY_DIAGNOSTIC_CODE } from './document-diagnostic-empty-short-circuit-v512-r6'
import { DOCUMENT_DIAGNOSTIC_RULE_REGISTRY, getRuleMeta } from './document-diagnostic-location'
import { resolveInlineHint } from './document-diagnostic-inline-presentation-v514-r5'
import { collectCanonicalHeadingOwnedLines } from './latent-atx-heading-marker'

const HINT = DOCUMENT_HEADING_ONLY_NO_BODY_CODE
const MESSAGE = '文档仅包含标题'
const DETAIL = '当前文档只有一个标题，尚未包含正文内容。'

interface HeadingSpec {
  level: number
  text?: string
  /** Typora `data-line` (0-based source line). `null` = no attribute. */
  line?: number | null
  /** `null` = no canonical stable identity. */
  identity?: string | null
  /** false = the fact carries no element at all. */
  withElement?: boolean
}

function makeElement(tag: string, line: number | null, text: string): HTMLElement {
  const el = document.createElement(tag)
  if (line != null) el.setAttribute('data-line', String(line))
  el.textContent = text
  return el
}

function inputOf(
  markdown: string | null,
  headings: readonly HeadingSpec[] = [],
  overrides: Partial<DocumentDiagnosticsInput> = {},
): DocumentDiagnosticsInput {
  const facts = headings.map((h, i) => {
    const text = h.text ?? `H${h.level}`
    return {
      level: h.level,
      text,
      stableIdentity: h.identity === null ? undefined : (h.identity ?? `H:${i}`),
      element: h.withElement === false ? null : makeElement(`h${h.level}`, h.line === undefined ? i * 2 : h.line, text),
    }
  })
  return {
    documentKey: 'doc:v1',
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
    ...overrides,
  }
}

const hintCount = (markdown: string | null, headings: readonly HeadingSpec[] = [], overrides: Partial<DocumentDiagnosticsInput> = {}): number =>
  computeDocumentDiagnostics(inputOf(markdown, headings, overrides)).diagnostics.filter(d => d.code === HINT).length

const codesOf = (markdown: string | null, headings: readonly HeadingSpec[] = [], overrides: Partial<DocumentDiagnosticsInput> = {}): string[] =>
  computeDocumentDiagnostics(inputOf(markdown, headings, overrides)).diagnostics.map(d => d.code)

// ── §2/§3/§4 — rule identity, severity and copy ──────────────────────────────

describe('V1 rule identity — id / severity / copy (§2/§3/§4)', () => {
  it('has a stable id and is a HINT (info) in BOTH strict and loose mode', () => {
    expect(HINT).toBe('DOCUMENT_HEADING_ONLY_NO_BODY')
    expect(resolveDocumentDiagnosticSeverity(HINT, true)).toBe('info')
    expect(resolveDocumentDiagnosticSeverity(HINT, false)).toBe('info')
  })

  it('is registered with the document category and a heading locator strategy', () => {
    // VNext §9 — the registry entry also carries the domain / area / scope /
    // presentation metadata (asserted in full by the VNext metadata test).
    expect(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY[HINT]).toMatchObject({
      ruleId: HINT,
      category: 'document',
      locationStrategy: 'canonical-node',
      domain: 'document',
      area: 'document-completeness',
      scope: 'document',
      presentation: { reasonChip: false, passiveVisual: true, activeVisual: true },
    })
    expect(getRuleMeta(HINT)?.category).toBe('document')
  })

  it('uses the canonical user copy and a non-coercive inline hint', () => {
    const out = computeDocumentDiagnostics(inputOf('# 标题\n', [{ level: 1, line: 0 }]))
    const d = out.diagnostics.find(x => x.code === HINT)!
    expect(d.message).toBe(MESSAGE)
    expect(d.detail).toBe(DETAIL)
    expect(resolveInlineHint({ code: HINT }).hint).toBe('仅有标题')
    // never coercive wording
    expect(d.message + d.detail).not.toMatch(/错误|必须|不合法/)
  })
})

// ── §13 / §24-A/B — DOCUMENT_EMPTY precedence ───────────────────────────────

describe('V1 §13/§24-A/B — an empty document publishes ONLY DOCUMENT_EMPTY', () => {
  for (const source of ['', '\n', '\n\n', '   ', '\t', ' \t\r\n \n ', '\uFEFF\r\n']) {
    it(`${JSON.stringify(source)} → DOCUMENT_EMPTY only (coexist = 0)`, () => {
      const codes = codesOf(source)
      expect(codes).toEqual([DOCUMENT_EMPTY_DIAGNOSTIC_CODE])
      expect(codes).not.toContain(HINT)
    })
  }

  it('a source-less document (markdown=null) never gets the hint either', () => {
    expect(hintCount(null, [{ level: 1, line: null, withElement: false }])).toBe(0)
  })
})

// ── §10 / §11 / §24-C/D/E — single heading, no body ─────────────────────────

describe('V1 §10/§11/§24-C/D/E — a single heading with no body triggers the hint', () => {
  it('single H1', () => {
    expect(hintCount('# 标题\n', [{ level: 1, line: 0 }])).toBe(1)
  })

  it('single H2 / H3', () => {
    expect(hintCount('## 标题\n', [{ level: 2, line: 0 }])).toBe(1)
    expect(hintCount('### 标题\n', [{ level: 3, line: 0 }])).toBe(1)
  })

  it('single heading + blank / whitespace-only lines', () => {
    expect(hintCount('# 标题\n\n\n', [{ level: 1, line: 0 }])).toBe(1)
    expect(hintCount('# 标题\n   \n\t\n', [{ level: 1, line: 0 }])).toBe(1)
    expect(hintCount('# 标题', [{ level: 1, line: 0 }])).toBe(1)
  })

  it('§32 — a coexisting strict-H1 ERROR never swallows the hint', () => {
    const out = computeDocumentDiagnostics(inputOf('## 只有二级\n', [{ level: 2, line: 0 }]))
    const codes = out.diagnostics.map(d => d.code)
    expect(codes).toContain(HINT)
    // strict structure complaints coexist (different dimension)
    expect(codes.some(c => c.startsWith('STRICT_'))).toBe(true)
    expect(out.infoCount).toBeGreaterThanOrEqual(1)
    expect(out.errorCount + out.warningCount).toBeGreaterThanOrEqual(1)
    // clean single H1 in strict mode = exactly 1/0/0/1 (§15)
    const clean = computeDocumentDiagnostics(inputOf('# 标题\n', [{ level: 1, line: 0 }]))
    expect(clean.diagnostics.map(d => d.code)).toEqual([HINT])
    expect([clean.errorCount, clean.warningCount, clean.infoCount]).toEqual([0, 0, 1])
  })

  it('§32 — the hint is mode-independent (loose mode still reports it)', () => {
    expect(hintCount('# 标题\n', [{ level: 1, line: 0 }], { strictMode: false })).toBe(1)
  })
})

// ── §6 / §24-F..L — every substantive body content type suppresses the hint ──

describe('V1 §6/§24-F..L — substantive body content suppresses the hint', () => {
  const bodies: Array<[string, string]> = [
    ['§24-F paragraph', '# 标题\n\n这是一段正文。\n'],
    ['§24-G list', '# 标题\n\n- 第一项\n- 第二项\n'],
    ['§24-G ordered list', '# 标题\n\n1. 第一项\n'],
    ['§24-H blockquote', '# 标题\n\n> 引用内容\n'],
    ['§24-I code block', '# 标题\n\n```ts\nconst a = 1\n```\n'],
    ['§24-J table', '# 标题\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'],
    ['§24-K image', '# 标题\n\n![图](missing.png)\n'],
    ['§24-K html image', '# 标题\n\n<img src="x.png">\n'],
    ['§24-L formula', '# 标题\n\n$$\nE = mc^2\n$$\n'],
    ['thematic break line', '# 标题\n\n---\n'],
    ['escaped hash paragraph', '# 标题\n\n\\#\n'],
    ['latent-ish inline hash text', '# 标题\n\n#notaheading\n'],
    ['atx-looking line inside a fence', '# 标题\n\n```\n# inner\n```\n'],
    ['html comment', '# 标题\n\n<!-- note -->\n'],
  ]
  for (const [label, markdown] of bodies) {
    it(`${label} → HEADING_ONLY = 0`, () => {
      expect(hintCount(markdown, [{ level: 1, line: 0 }])).toBe(0)
    })
  }

  it('a missing image is still BODY content (its own diagnostic is separate)', () => {
    expect(hintCount('# 标题\n\n![图](missing.png)\n', [{ level: 1, line: 0 }])).toBe(0)
  })

  it('§7 — whitespace / blank lines are never body content', () => {
    expect(hintCount('# 标题\n\n   \n\t\n\n', [{ level: 1, line: 0 }])).toBe(1)
  })

  it('§26 — the body authority is SOURCE-based: plugin DOM never participates', () => {
    // A body-less source whose document DOM is full of plugin-injected nodes
    // still yields the hint: nothing here reads the rendered node count.
    document.body.innerHTML =
      '<div id="write"><h1 data-line="0">标题</h1>' +
      '<div data-inkchapter-locate-layer="true"></div>' +
      '<div class="inkchapter-diagnostic-highlight"></div>' +
      '<span class="inkchapter-heading-diagnostic-marker"></span></div>'
    const input = inputOf('# 标题\n', [{ level: 1, line: 0 }])
    expect(computeDocumentDiagnostics(input).diagnostics.some(d => d.code === HINT)).toBe(true)
    document.body.innerHTML = ''
  })
})

// ── §25 — EXACT scope: exactly ONE heading ─────────────────────────────────

describe('V1 §25 — multi-heading documents are out of scope', () => {
  it('two headings with no body do NOT trigger this rule', () => {
    expect(hintCount('# 标题 1\n## 标题 2\n', [{ level: 1, line: 0 }, { level: 2, line: 1 }])).toBe(0)
  })

  it('zero headings (plain body) keeps the existing strict-H1 exemption', () => {
    const out = computeDocumentDiagnostics(inputOf('只有正文。\n', []))
    expect(out.diagnostics.some(d => d.code === HINT)).toBe(false)
    expect(out.diagnostics.some(d => d.code.startsWith('STRICT_'))).toBe(false)
  })

  it('zero headings and no body (empty) is DOCUMENT_EMPTY, not this hint', () => {
    expect(codesOf('')).toEqual([DOCUMENT_EMPTY_DIAGNOSTIC_CODE])
  })
})

// ── §18 / §19 — canonical target + stable identity ─────────────────────────

describe('V1 §18/§19 — the target is the UNIQUE HEADING', () => {
  it('carries a canonical-node location + heading locator on the heading itself', () => {
    const out = computeDocumentDiagnostics(inputOf('# 唯一的标题\n', [{ level: 1, line: 0, identity: 'H:doc:v1:1' }]))
    const d = out.diagnostics.find(x => x.code === HINT)!
    expect(d.location).toEqual({ kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H:doc:v1:1' })
    expect(d.locator?.kind).toBe('heading')
    expect(d.targetIdentity).toBe('heading-only:H:doc:v1:1')
    // never EOF / blank body / toolbar / drawer
    expect(d.location?.kind).not.toBe('document-end')
  })

  it('falls back to the heading source line when no stable identity exists', () => {
    const out = computeDocumentDiagnostics(inputOf('\n\n\n\n# 标题\n', [{ level: 1, line: 4, identity: null }]))
    const d = out.diagnostics.find(x => x.code === HINT)!
    expect(d.location).toEqual({ kind: 'source-range', startLine: 4, startColumn: 0 })
    expect(d.targetIdentity).toBe('heading-only:line:4')
  })

  it('works WITHOUT a data-line stamp via the ATX text-key safety net (real runtime)', () => {
    // This Typora build does not expose `data-line` on headings; the canonical
    // ATX text key is the documented second authority the latent-ATX scanner
    // already uses, so the rule must still resolve the heading's own line.
    const out = computeDocumentDiagnostics(
      inputOf('# 只有标题\n', [{ level: 1, line: null, identity: 'H:doc:v1:0', text: '只有标题' }]),
    )
    const d = out.diagnostics.find(x => x.code === HINT)!
    expect(d.location).toEqual({ kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H:doc:v1:0' })
  })

  it('stays SILENT when the canonical heading text does not match the source line', () => {
    // e.g. the DOM heading text carries plugin chip copy while the source owns
    // an unrelated line: unverifiable → never a false positive.
    const out = computeDocumentDiagnostics(
      inputOf('# 只有标题\n', [{ level: 1, line: null, identity: 'H:1', text: '标题 缺 H4' }]),
    )
    expect(out.diagnostics.some(d => d.code === HINT)).toBe(false)
  })

  it('stays SILENT when the canonical frame carries neither identity nor source line', () => {
    // An unverifiable shape must never become a false positive: without the
    // heading's own source-line anchor the body scan cannot prove "no body".
    const out = computeDocumentDiagnostics(inputOf('# 标题\n', [{ level: 1, line: null, identity: null, withElement: false }]))
    expect(out.diagnostics.some(d => d.code === HINT)).toBe(false)
  })

  it('is silent when the heading source line does not match the claimed body', () => {
    // The heading is canonical-claimed at line 4, but the source really owns a
    // paragraph there → the verdict is "has body" and the hint must not fire.
    const out = computeDocumentDiagnostics(inputOf('# 标题\n\n正文\n', [{ level: 1, line: 4, identity: null }]))
    expect(out.diagnostics.some(d => d.code === HINT)).toBe(false)
  })

  it('identity is deterministic (same input → same id) and tracks the heading identity', () => {
    const a1 = computeDocumentDiagnostics(inputOf('# 标题\n', [{ level: 1, line: 0, identity: 'A' }])).diagnostics.find(d => d.code === HINT)!
    const a2 = computeDocumentDiagnostics(inputOf('# 标题\n', [{ level: 1, line: 0, identity: 'A' }])).diagnostics.find(d => d.code === HINT)!
    const b = computeDocumentDiagnostics(inputOf('# 标题\n', [{ level: 1, line: 0, identity: 'B' }])).diagnostics.find(d => d.code === HINT)!
    expect(a1.id).toBe(a2.id)
    expect(a1.id).not.toBe(b.id)
    expect(a1.documentKey).toBe('doc:v1')
  })
})

// ── §22 / §27 / §28 — real-time refresh + document identity ────────────────

describe('V1 §22/§27/§28 — event-driven refresh across edits and documents', () => {
  it('body INSERT clears the hint, body DELETE restores it', () => {
    const heading: HeadingSpec = { level: 1, line: 0 }
    expect(hintCount('# 标题\n', [heading])).toBe(1)
    expect(hintCount('# 标题\n\n正文。\n', [heading])).toBe(0)
    expect(hintCount('# 标题\n', [heading])).toBe(1)
  })

  it('no cross-document leak: the hint always carries the CURRENT documentKey', () => {
    const a = computeDocumentDiagnostics(inputOf('# A\n', [{ level: 1, line: 0 }], { documentKey: 'doc:a' }))
      .diagnostics.find(d => d.code === HINT)!
    const b = computeDocumentDiagnostics(inputOf('# B\n\n正文\n', [{ level: 1, line: 0 }], { documentKey: 'doc:b' }))
      .diagnostics.find(d => d.code === HINT)
    expect(a.documentKey).toBe('doc:a')
    expect(b).toBeUndefined()
  })
})

// ── body-authority unit contract (§5/§6/§7/§9) ─────────────────────────────

describe('V1 hasSubstantiveNonHeadingContent — source authority', () => {
  it('blank-only sources have no body', () => {
    for (const s of ['', '\n\n', '   \n\t\n', '# T\n\n\n']) {
      expect(hasSubstantiveNonHeadingContent(s, s.includes('# T') ? new Set([0]) : new Set())).toBe(false)
    }
  })

  it('a non-blank line outside the canonical heading set is body', () => {
    expect(hasSubstantiveNonHeadingContent('# T\n\n正文\n', new Set([0]))).toBe(true)
    expect(hasSubstantiveNonHeadingContent('# T\n\n```\n码\n```\n', new Set([0]))).toBe(true)
  })

  it('CRLF sources are handled', () => {
    expect(hasSubstantiveNonHeadingContent('# T\r\n\r\n', new Set([0]))).toBe(false)
    expect(hasSubstantiveNonHeadingContent('# T\r\n\r\n正文\r\n', new Set([0]))).toBe(true)
  })

  it('a setext underline belongs to the heading above it', () => {
    expect(hasSubstantiveNonHeadingContent('T\n===\n', new Set([0]))).toBe(false)
    expect(hasSubstantiveNonHeadingContent('T\n---\n', new Set([0]))).toBe(false)
    // …but the same line with no heading above it IS content
    expect(hasSubstantiveNonHeadingContent('---\n', new Set())).toBe(true)
  })

  it('null / undefined sources have no body (never a crash)', () => {
    expect(hasSubstantiveNonHeadingContent(null, new Set())).toBe(false)
    expect(hasSubstantiveNonHeadingContent(undefined, new Set())).toBe(false)
  })
})

// ── canonical heading-owned source lines (the trigger anchor) ──────────────

describe('V1 collectCanonicalHeadingOwnedLines — heading line authority', () => {
  it('claims a line by the Typora data-line stamp', () => {
    const owned = collectCanonicalHeadingOwnedLines('# T\n\nbody\n', new Set([0]), new Set())
    expect([...owned]).toEqual([0])
  })

  it('claims a line by the ATX level:text key when data-line is absent', () => {
    const owned = collectCanonicalHeadingOwnedLines('## 小节\n\n', new Set(), new Set(['2:小节']))
    expect([...owned]).toEqual([0])
  })

  it('never claims a non-ATX line, an escaped marker, or fenced content', () => {
    // `\#` is escaped, `#x` has no space, and the fenced `# inner` is code.
    const owned = collectCanonicalHeadingOwnedLines(
      '\\# T\n#x\n```\n# inner\n```\n',
      new Set(),
      new Set(['1:T', '1:x', '1:inner']),
    )
    expect([...owned]).toEqual([])
  })

  it('handles CRLF and returns the exact line set', () => {
    const owned = collectCanonicalHeadingOwnedLines('# T\r\n\r\n', new Set([0]), new Set())
    expect([...owned]).toEqual([0])
  })

  it('null markdown claims nothing', () => {
    expect(collectCanonicalHeadingOwnedLines(null, new Set([0]), new Set()).size).toBe(0)
  })
})
