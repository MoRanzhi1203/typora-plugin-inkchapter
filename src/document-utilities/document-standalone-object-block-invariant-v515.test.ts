// @vitest-environment jsdom
/**
 * V5.15 — Standalone Object Block Invariant: targeted closure suite.
 *
 * Covers the prompt's required automation matrix:
 *   Case A  valid standalone image            → normal figure target, 0 structure error
 *   Case B  text + image                      → invalid (MIXED_WITH_TEXT)
 *   Case C  image + text                      → invalid (MIXED_WITH_TEXT)
 *   Case D  text + image + text                → invalid (MIXED_WITH_TEXT)
 *   Case E  two images in one block            → invalid (MULTIPLE_IMAGES)
 *   Case F  text + two images                  → invalid (COMPOSITE, 2 violations, 1 diagnostic)
 *   Case G  two independent image blocks       → two normal figure targets
 *   Case H  linked image                       → normal figure target (DOM authority)
 *   Case I  list image                         → invalid (NON_STANDALONE_CONTAINER)
 *   Case J  blockquote image                   → invalid (NON_STANDALONE_CONTAINER)
 *
 * Plus: the auto-fix (split-only, idempotent, content preserving), the DOM
 * owning-block descriptor, and the 11 V5.15 hard gates.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  analyzeStandaloneObjectBlock,
  analyzeFigureBlockStructure,
  analyzeFigureStandaloneSourceBlocks,
  analyzeFigureBlockStructureDom,
  describeFigureOwningBlockDom,
  buildStandaloneFigureBlockFix,
  figureStructureUserCopy,
  figureViolationCode,
  IMAGE_MIXED_WITH_TEXT_CODE,
  IMAGE_MULTIPLE_IN_BLOCK_CODE,
  IMAGE_NOT_STANDALONE_BLOCK_CODE,
  FIGURE_BLOCK_STRUCTURE_INVALID_CODE,
  FIGURE_IN_LIST_CODE,
  FIGURE_IN_QUOTE_CODE,
  FIGURE_IN_TABLE_CODE,
  FIGURE_INLINE_FORMAT_CODE,
  FIGURE_MULTIPLE_SAME_BLOCK_CODE,
  FIGURE_TEXT_MIXED_CODE,
  FIGURE_STRUCTURE_BLOCK_RULE_CODES,
  classifyFigureStructureIssue,
  FIGURE_BLOCK_STRUCTURE_V515_GATE_KEYS,
  FIGURE_BLOCK_STRUCTURE_V515_GATE_LABELS,
  createFigureBlockStructureV515Counters,
  evaluateFigureBlockStructureV515Gates,
  formatFigureBlockStructureV515GateReport,
  resetFigureBlockStructureV515State,
  getFigureBlockStructureV515Counters,
  getFigureBlockStructureV515GateDecision,
  noteFigureStructureDiagnosticPublished,
  noteFigureBlockAdmission,
  beginFigureBlockStructureV515DomPass,
  getFigureBlockStructureV515CoverageCounters,
} from './document-standalone-object-block-invariant-v515'
import { computeDocumentDiagnostics, buildFigureSourceOccurrences } from './document-diagnostics'
import type { DocumentDiagnosticsInput, DiagnosticLinkFact } from './document-diagnostics'
import { parseImageSourceOccurrences, parseLocalLinkTargets } from './document-resource-scanner'
// V2 §11 — the balanced-paren image token authority (the one the fixers use).
import { scanSourceImageTokens } from './document-figure-heading-invariant-v1'
import {
  FIGURE_BLOCK_STRUCTURE_INVALID_FIX,
  applyPatchesToMarkdown,
  createDefaultDiagnosticFixRegistry,
  type FixContext,
} from './document-diagnostic-fix-v1'
import {
  buildFixedMarkdown,
  describeFixCapability,
  planAllAutoFixesV2,
  selectNonConflictingPlans,
} from './document-diagnostic-fix-v2'

function inputOf(
  markdown: string,
  opts: { missing?: (target: string) => boolean } = {},
): DocumentDiagnosticsInput {
  const missing = opts.missing ?? (() => true)
  const links: DiagnosticLinkFact[] = []
  const raw = parseLocalLinkTargets(markdown)
  for (let i = 0; i < raw.length; i++) {
    const o = typeof raw[i] === 'string' ? { target: raw[i] as string } : raw[i] as Exclude<typeof raw[number], string>
    if (!missing(o.target)) continue
    const occurrenceIndex = raw
      .slice(0, i)
      .filter(p => {
        const q = typeof p === 'string' ? { target: p } : p
        return (q.resourceKind ?? 'link') === (o.resourceKind ?? 'link') && q.target === o.target
      }).length
    links.push({
      target: o.target,
      element: null,
      index: i,
      resourceKind: o.resourceKind,
      semanticDestination: o.target,
      sourceStart: o.sourceStart,
      sourceEnd: o.sourceEnd,
      startLine: o.startLine,
      endLine: o.endLine,
      startColumn: o.startColumn,
      endColumn: o.endColumn,
      rawText: o.rawText,
      destinationStart: o.destinationStart,
      destinationEnd: o.destinationEnd,
      rawToken: o.rawToken,
      altText: o.altText,
      resourceClass: o.resourceClass,
      targetIdentity: `local:${o.target}${occurrenceIndex > 0 ? `:${occurrenceIndex + 1}` : ''}`,
    })
  }
  const figureSourceOccurrences = buildFigureSourceOccurrences({
    scanned: parseImageSourceOccurrences(markdown),
    documentKey: 'doc:v515',
    resolveCanonicalDestination: d => d,
    isLocalFileMissing: d => missing(d),
  })
  return {
    documentKey: 'doc:v515',
    markdown,
    strictMode: false,
    vaultRoot: 'D:/vault',
    headings: [],
    figures: [],
    figureSourceOccurrences,
    tables: [],
    codes: [],
    formulas: [],
    links,
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
  }
}

function diagnosticsOf(
  markdown: string,
  opts: { missing?: (target: string) => boolean } = {},
): ReturnType<typeof computeDocumentDiagnostics> {
  return computeDocumentDiagnostics(inputOf(markdown, opts))
}

function structureDiags(markdown: string) {
  return diagnosticsOf(markdown).diagnostics.filter(d => FIGURE_STRUCTURE_BLOCK_RULE_CODES.has(d.code))
}

function countCode(markdown: string, code: string): number {
  return diagnosticsOf(markdown).diagnostics.filter(d => d.code === code).length
}

function blocksOf(markdown: string) {
  return analyzeFigureStandaloneSourceBlocks({
    source: markdown,
    occurrences: parseImageSourceOccurrences(markdown),
  })
}

const ASSET = 'assets/phase7-strict-h1-boundary/boundary-a-figure.png'

beforeEach(() => {
  resetFigureBlockStructureV515State()
})

// ── §4/§5 — the unified abstraction ───────────────────────────────────────

describe('V5.15 §4 — StandaloneObjectBlockInvariant (pure)', () => {
  it('a paragraph with one object and no other text is standalone', () => {
    const a = analyzeStandaloneObjectBlock({
      kind: 'figure', owningBlockIdentity: 'p', objectCount: 1,
      nonObjectSemanticContentText: '', containerKind: 'paragraph',
    })
    expect(a.standalone).toBe(true)
    expect(a.violations).toEqual([])
  })

  it('one violation per rule: mixed text / multiple objects / non-standalone container', () => {
    const mixed = analyzeStandaloneObjectBlock({
      kind: 'figure', owningBlockIdentity: 'p', objectCount: 1,
      nonObjectSemanticContentText: '前文', containerKind: 'paragraph',
    })
    expect(mixed.violations).toEqual(['MIXED_WITH_TEXT'])
    const multi = analyzeStandaloneObjectBlock({
      kind: 'figure', owningBlockIdentity: 'p', objectCount: 2,
      nonObjectSemanticContentText: '', containerKind: 'paragraph',
    })
    expect(multi.violations).toEqual(['MULTIPLE_OBJECTS_IN_BLOCK'])
    const container = analyzeStandaloneObjectBlock({
      kind: 'figure', owningBlockIdentity: 'li', objectCount: 1,
      nonObjectSemanticContentText: '', containerKind: 'list-item',
    })
    expect(container.violations).toEqual(['NON_STANDALONE_CONTAINER'])
  })

  it('§8.1 — the violation → internal reason code map is fixed', () => {
    expect(figureViolationCode('MIXED_WITH_TEXT')).toBe(IMAGE_MIXED_WITH_TEXT_CODE)
    expect(figureViolationCode('MULTIPLE_OBJECTS_IN_BLOCK')).toBe(IMAGE_MULTIPLE_IN_BLOCK_CODE)
    expect(figureViolationCode('NON_STANDALONE_CONTAINER')).toBe(IMAGE_NOT_STANDALONE_BLOCK_CODE)
  })

  it('§5/§8.2 — the merged UI copy is ONE message per owning block', () => {
    const both = analyzeFigureBlockStructure({
      kind: 'figure', owningBlockIdentity: 'p', objectCount: 2,
      nonObjectSemanticContentText: '前文 中段', containerKind: 'paragraph',
    })
    expect(both.decision).toBe('INVALID_COMPOSITE')
    expect(both.violations).toHaveLength(2)
    const copy = figureStructureUserCopy(both)
    expect(copy.title).toBe('图片块格式不规范')
    expect(copy.detail).toContain('同时包含正文和多张图片')
  })
})

// ── §2/§3 — Markdown block ownership ──────────────────────────────────────

describe('V5.15 §2/§3 — Markdown owning-block analysis (Cases A–J source authority)', () => {
  it('Case A — `![](a.png)` is a valid standalone figure block', () => {
    const b = blocksOf(`![](${ASSET})\n`)
    expect(b).toHaveLength(1)
    expect(b[0].result.decision).toBe('VALID_STANDALONE_FIGURE')
    expect(b[0].imageOccurrenceCount).toBe(1)
    expect(b[0].containerKind).toBe('paragraph')
  })

  it('Case B — `before ![](a.png)` is INVALID_MIXED_WITH_TEXT', () => {
    const b = blocksOf(`before ![](${ASSET})\n`)
    expect(b[0].result.decision).toBe('INVALID_MIXED_WITH_TEXT')
    expect(b[0].result.violationCodes).toEqual([IMAGE_MIXED_WITH_TEXT_CODE])
  })

  it('Case C/D — text after / around the image is the same violation', () => {
    expect(blocksOf(`![](${ASSET}) after\n`)[0].result.decision).toBe('INVALID_MIXED_WITH_TEXT')
    expect(blocksOf(`before ![](${ASSET}) after\n`)[0].result.decision).toBe('INVALID_MIXED_WITH_TEXT')
  })

  it('Case E — two images in one block is INVALID_MULTIPLE_IMAGES (no mixed text)', () => {
    const b = blocksOf(`![a](a.png) ![b](b.png)\n`)
    expect(b[0].imageOccurrenceCount).toBe(2)
    expect(b[0].result.decision).toBe('INVALID_MULTIPLE_IMAGES')
    expect(b[0].result.violationCodes).toEqual([IMAGE_MULTIPLE_IN_BLOCK_CODE])
  })

  it('Case F — text + two images is INVALID_COMPOSITE with BOTH reason codes', () => {
    const b = blocksOf('before ![a](a.png) middle ![b](b.png)\n')
    expect(b).toHaveLength(1)
    expect(b[0].imageOccurrenceCount).toBe(2)
    expect(b[0].result.decision).toBe('INVALID_COMPOSITE')
    expect(new Set(b[0].result.violationCodes)).toEqual(
      new Set([IMAGE_MIXED_WITH_TEXT_CODE, IMAGE_MULTIPLE_IN_BLOCK_CODE]),
    )
  })

  it('Case G — two blank-line separated image blocks are TWO valid blocks', () => {
    const b = blocksOf(`![a](a.png)\n\n![b](b.png)\n`)
    expect(b).toHaveLength(2)
    expect(b.map(x => x.result.decision)).toEqual(['VALID_STANDALONE_FIGURE', 'VALID_STANDALONE_FIGURE'])
  })

  it('Case I/J — list item and blockquote payloads are NON_STANDALONE_CONTAINER', () => {
    const li = blocksOf(`- ![](${ASSET})\n`)
    expect(li[0].containerKind).toBe('list-item')
    expect(li[0].result.decision).toBe('INVALID_NON_STANDALONE_CONTAINER')
    const quote = blocksOf(`> ![](${ASSET})\n`)
    expect(quote[0].containerKind).toBe('blockquote')
    expect(quote[0].result.decision).toBe('INVALID_NON_STANDALONE_CONTAINER')
  })

  it('an image inside a fenced code block is NOT a figure block (never a candidate at all)', () => {
    const md = '```\n![not-an-image](a.png)\n```\n'
    // V1 — literal exclusion happens BEFORE candidate discovery, so the fenced
    // token is not even an image occurrence and no figure block (of ANY container
    // kind) can be produced from it.
    expect(parseImageSourceOccurrences(md)).toHaveLength(0)
    expect(blocksOf(md)).toEqual([])
  })
})

// ── §6/§8/§9 — diagnostics admission + merge ─────────────────────────────

describe('V5.15 §6/§8/§9 — diagnostics: exclusion, merge, severity, locate', () => {
  it('Case A — a valid standalone image keeps its normal figure diagnostics', () => {
    expect(structureDiags(`![](${ASSET})\n`)).toHaveLength(0)
    expect(countCode(`![](${ASSET})\n`, 'FIGURE_MISSING_NAME')).toBe(1)
  })

  it('Case B/C/D — mixed text publishes ONE warning and NO normal figure rule', () => {
    for (const md of [`before ![](${ASSET})\n`, `![](${ASSET}) after\n`, `before ![](${ASSET}) after\n`]) {
      const d = structureDiags(md)
      expect(d).toHaveLength(1)
      expect(d[0].code).toBe(FIGURE_TEXT_MIXED_CODE)
      expect(d[0].severity).toBe('warning')
      expect(countCode(md, 'FIGURE_MISSING_NAME')).toBe(0)
      expect(countCode(md, 'FIGURE_LOCAL_IMAGE_MISSING')).toBe(0)
    }
  })

  it('Case E — two images in one invalid block: 1 structure error, 0 FIGURE_MISSING_NAME', () => {
    const md = `![a](a.png) ![b](b.png)\n`
    expect(structureDiags(md)).toHaveLength(1)
    expect(structureDiags(md)[0].code).toBe(FIGURE_MULTIPLE_SAME_BLOCK_CODE)
    expect(countCode(md, 'FIGURE_MISSING_NAME')).toBe(0)
    expect(countCode(md, 'FIGURE_LOCAL_IMAGE_MISSING')).toBe(0)
  })

  it('Case F — a merged error: ONE diagnostic even though TWO violations were detected', () => {
    const d = structureDiags('before ![a](a.png) middle ![b](b.png)\n')
    expect(d).toHaveLength(1)
    expect(String(d[0].metadata?.violations)).toContain(IMAGE_MIXED_WITH_TEXT_CODE)
    expect(String(d[0].metadata?.violations)).toContain(IMAGE_MULTIPLE_IN_BLOCK_CODE)
    expect(getFigureBlockStructureV515Counters().structureDuplicateDiagnostic).toBe(0)
  })

  it('Case G — two independent blocks keep BOTH normal figure targets', () => {
    const md = `![](${ASSET})\n\n![](${ASSET})\n`
    expect(structureDiags(md)).toHaveLength(0)
    expect(countCode(md, 'FIGURE_MISSING_NAME')).toBe(2)
  })

  it('Case I/J — list / blockquote images get their OWN structure error and no figure rule', () => {
    const list = structureDiags(`- ![](${ASSET})\n`)
    expect(list).toHaveLength(1)
    expect(list[0].code).toBe(FIGURE_IN_LIST_CODE)
    expect(list[0].severity).toBe('error')
    expect(list[0].metadata?.autoFixable).toBe(true)
    const quote = structureDiags(`> ![](${ASSET})\n`)
    expect(quote).toHaveLength(1)
    expect(quote[0].code).toBe(FIGURE_IN_QUOTE_CODE)
    expect(quote[0].severity).toBe('error')
    expect(quote[0].metadata?.autoFixable).toBe(true)
    for (const md of [`- ![](${ASSET})\n`, `> ![](${ASSET})\n`]) {
      expect(countCode(md, 'FIGURE_MISSING_NAME')).toBe(0)
      expect(countCode(md, 'FIGURE_LOCAL_IMAGE_MISSING')).toBe(0)
    }
  })

  it('§7 — the structure target spans the WHOLE owning block and is locatable', () => {
    const md = `before ![](${ASSET}) after\n`
    const d = structureDiags(md)[0]
    // V1 — the structure rule owns a BLOCK-level locator (never an inline range).
    expect(d.location?.kind).toBe('source-block')
    if (d.location?.kind !== 'source-block') throw new Error('not source-block')
    expect(md.slice(d.location.sourceStart ?? 0, d.location.sourceEnd ?? 0)).toBe('before ![](' + ASSET + ') after')
    expect(d.location.startLine).toBe(0)
    expect(d.location.sourceBlockIdentity).toBe('src-block:0')
    expect(getFigureBlockStructureV515Counters().structureUnlocatableDiagnostic).toBe(0)
  })

  it('§9/§26 — structural container / multi-image errors vs mixed-text warnings', () => {
    const multi = structureDiags(`before ![](${ASSET}) ![](${ASSET})\n`)[0]
    expect(multi.code).toBe(FIGURE_MULTIPLE_SAME_BLOCK_CODE)
    expect(multi.severity).toBe('error')
    const mixed = structureDiags(`before ![](${ASSET}) after\n`)[0]
    expect(mixed.code).toBe(FIGURE_TEXT_MIXED_CODE)
    expect(mixed.severity).toBe('warning')
    const valid = diagnosticsOf(`![](${ASSET})\n`).diagnostics.find(d => d.code === 'FIGURE_MISSING_NAME')
    expect(valid?.severity).toBe('warning')
  })

  it('the structure rule family is classified as an object rule (never a document notice)', async () => {
    const { classifyDocumentDiagnosticRuleFamily } = await import('./document-diagnostic-empty-short-circuit-v512-r6')
    expect(classifyDocumentDiagnosticRuleFamily(FIGURE_BLOCK_STRUCTURE_INVALID_CODE)).toBe('object')
  })

  it('a document with NO markdown input keeps the legacy behaviour (no structure gate)', () => {
    const input = inputOf(`before ![](${ASSET})\n`)
    const legacy = computeDocumentDiagnostics({ ...input, markdown: null })
    expect(legacy.diagnostics.some(d => d.code === FIGURE_BLOCK_STRUCTURE_INVALID_CODE)).toBe(false)
    expect(legacy.diagnostics.filter(d => d.code === 'FIGURE_MISSING_NAME')).toHaveLength(1)
  })
})

// ── §5 — the DOM owning-block authority (Case H + container kinds) ────────

describe('V5.15 §5 — DOM owning-block descriptor', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('Case H — a linked image inside a paragraph IS a valid standalone figure target', () => {
    document.body.innerHTML = '<div id="write"><p><a href="https://example.com"><img src="a.png"></a></p></div>'
    const img = document.querySelector('img') as HTMLElement
    const r = analyzeFigureBlockStructureDom(img)
    expect(r.decision).toBe('VALID_STANDALONE_FIGURE')
    expect(r.imageOccurrenceCount).toBe(1)
  })

  it('text + image in one paragraph is INVALID_MIXED_WITH_TEXT in the DOM too', () => {
    document.body.innerHTML = '<div id="write"><p>before <img src="a.png"></p></div>'
    const img = document.querySelector('img') as HTMLElement
    const r = analyzeFigureBlockStructureDom(img)
    expect(r.decision).toBe('INVALID_MIXED_WITH_TEXT')
    expect(r.hasNonImageSemanticContent).toBe(true)
  })

  it('two images in one paragraph is INVALID_MULTIPLE_IMAGES', () => {
    document.body.innerHTML = '<div id="write"><p><img src="a.png"> <img src="b.png"></p></div>'
    const img = document.querySelector('img') as HTMLElement
    expect(analyzeFigureBlockStructureDom(img).decision).toBe('INVALID_MULTIPLE_IMAGES')
  })

  it('a list item image and a blockquote image are NON_STANDALONE_CONTAINER', () => {
    document.body.innerHTML = '<div id="write"><ul><li><img src="a.png"></li></ul></div>'
    let img = document.querySelector('img') as HTMLElement
    expect(analyzeFigureBlockStructureDom(img).decision).toBe('INVALID_NON_STANDALONE_CONTAINER')
    document.body.innerHTML = '<div id="write"><blockquote><p><img src="b.png"></p></blockquote></div>'
    img = document.querySelector('img') as HTMLElement
    const facts = describeFigureOwningBlockDom(img)
    expect(facts.containerKind).toBe('blockquote')
    expect(analyzeFigureBlockStructureDom(img).decision).toBe('INVALID_NON_STANDALONE_CONTAINER')
  })

  it('a caption projection inside the block never counts as document text', () => {
    document.body.innerHTML =
      '<div id="write"><p><img src="a.png"><span data-inkchapter-caption="c1">图 1-1 名称</span></p></div>'
    const img = document.querySelector('img') as HTMLElement
    expect(analyzeFigureBlockStructureDom(img).decision).toBe('VALID_STANDALONE_FIGURE')
  })

  it('plugin UI text inside the block never counts as document text', () => {
    document.body.innerHTML = [
      '<div id="write"><p><img src="a.png">',
      '<span data-inkchapter-ui-root="document-utilities">',
      '<button>编辑图名…</button><button>复制本地路径</button><button>复制 Markdown 引用</button>',
      '</span></p></div>',
    ].join('')
    const img = document.querySelector('img') as HTMLElement
    const facts = describeFigureOwningBlockDom(img)
    expect(facts.nonImageSemanticText).toBe('')
    expect(analyzeFigureBlockStructureDom(img).decision).toBe('VALID_STANDALONE_FIGURE')
  })

  it('§2.1 — the image OWN alt metadata is never "mixed text"', () => {
    document.body.innerHTML =
      '<div id="write"><p><span class="md-image"><img src="a.png" alt="说明"><span class="md-meta">说明</span></span></p></div>'
    const img = document.querySelector('img') as HTMLElement
    const facts = describeFigureOwningBlockDom(img)
    expect(facts.nonImageSemanticText).toBe('')
    expect(analyzeFigureBlockStructureDom(img).decision).toBe('VALID_STANDALONE_FIGURE')
  })
})

// ── §11/§12/§21 — the deterministic auto-fix ──────────────────────────────

describe('V5.15 §11/§12/§21 — auto-fix splits blocks only and is idempotent', () => {
  it('§11.1 — text + image splits into text / image', () => {
    const before = '前文 ![](a.png) 后文\n'
    const { changed, output } = buildStandaloneFigureBlockFix(before)
    expect(changed).toBe(true)
    expect(output).toBe('前文\n\n![](a.png)\n\n后文\n')
  })

  it('§11.2 — two images split into two image blocks', () => {
    const { output } = buildStandaloneFigureBlockFix('![](a.png) ![](b.png)\n')
    expect(output).toBe('![](a.png)\n\n![](b.png)\n')
  })

  it('§11.3 — the prompt example splits into text / image / text / image', () => {
    const { output } = buildStandaloneFigureBlockFix('同段双 occurrence: ![](same.png) middle ![](same.png)\n')
    expect(output).toBe('同段双 occurrence:\n\n![](same.png)\n\nmiddle\n\n![](same.png)\n')
  })

  it('§21 — the fix preserves text, urls, count, alt and occurrence order', () => {
    const before = 'A ![alt a](a.png) B ![alt b](b.png) C\n'
    const { output } = buildStandaloneFigureBlockFix(before)
    expect(output).toContain('![alt a](a.png)')
    expect(output).toContain('![alt b](b.png)')
    expect(output.indexOf('![alt a]')).toBeLessThan(output.indexOf('![alt b]'))
    expect(output.replace(/\n+/g, ' ')).toContain('A')
    expect(output.replace(/\n+/g, ' ')).toContain('B')
    expect(output.replace(/\n+/g, ' ')).toContain('C')
    expect((output.match(/!\[/g) ?? []).length).toBe(2)
  })

  it('§12/§21 — the fix never introduces 2+ consecutive blank lines and is idempotent', () => {
    const before = '同段双 occurrence: ![](same.png) middle ![](same.png)\n'
    const once = buildStandaloneFigureBlockFix(before)
    expect(/\n\n\n/.test(once.output)).toBe(false)
    const twice = buildStandaloneFigureBlockFix(once.output)
    expect(twice.changed).toBe(false)
    expect(twice.output).toBe(once.output)
  })

  it('§21 — after the fix every block is valid again', () => {
    const before = 'before ![a](a.png) middle ![b](b.png)\n'
    const { output } = buildStandaloneFigureBlockFix(before)
    expect(output).toBe('before\n\n![a](a.png)\n\nmiddle\n\n![b](b.png)\n')
    // only the two image-owning blocks are figure blocks, and both are valid now
    const blocks = blocksOf(output)
    expect(blocks).toHaveLength(2)
    expect(blocks.every(b => b.result.decision === 'VALID_STANDALONE_FIGURE')).toBe(true)
    expect(structureDiags(output)).toHaveLength(0)
  })

  it('§4 — a simple list item loses its list marker and becomes a standalone image', () => {
    const before = '- ![a](a.png)\n'
    const { changed, output } = buildStandaloneFigureBlockFix(before)
    expect(changed).toBe(true)
    expect(output).toBe('![a](a.png)\n')
    expect(structureDiags(output)).toHaveLength(0)
  })

  it('a CRLF document keeps its line endings', () => {
    const before = 'before ![](a.png)\r\n'
    const { output } = buildStandaloneFigureBlockFix(before)
    expect(output).toBe('before\r\n\r\n![](a.png)\r\n')
  })
})

// ── §16/§18/§19 — the hard gates ─────────────────────────────────────────

describe('V5.15 §16/§18/§19 — the 11 hard gates', () => {
  it('the 11 gates are declared complete with the exact runtime labels', () => {
    expect(FIGURE_BLOCK_STRUCTURE_V515_GATE_KEYS).toHaveLength(11)
    expect(formatFigureBlockStructureV515GateReport(createFigureBlockStructureV515Counters())).toEqual([
      'FIGURE_MIXED_WITH_TEXT_ADMITTED_AS_NORMAL_TARGET_COUNT=0',
      'FIGURE_MULTI_IMAGE_BLOCK_ADMITTED_AS_NORMAL_TARGET_COUNT=0',
      'FIGURE_NON_STANDALONE_CONTAINER_ADMITTED_AS_NORMAL_TARGET_COUNT=0',
      'INVALID_FIGURE_BLOCK_NUMBERED_COUNT=0',
      'INVALID_FIGURE_BLOCK_CAPTIONED_COUNT=0',
      'INVALID_FIGURE_BLOCK_WITH_MISSING_NAME_DIAGNOSTIC_COUNT=0',
      'FIGURE_STRUCTURE_DUPLICATE_DIAGNOSTIC_COUNT=0',
      'FIGURE_STRUCTURE_UNLOCATABLE_DIAGNOSTIC_COUNT=0',
      'VALID_STANDALONE_FIGURE_REJECTED_COUNT=0',
      'VALID_STANDALONE_FIGURE_NUMBERING_REGRESSION_COUNT=0',
      'VALID_STANDALONE_FIGURE_CAPTION_REGRESSION_COUNT=0',
    ])
    expect(FIGURE_BLOCK_STRUCTURE_V515_GATE_LABELS.validStandaloneFigureRejected)
      .toBe('VALID_STANDALONE_FIGURE_REJECTED_COUNT')
  })

  it('§19 — admitting a VALID figure never fires a gate; rejecting it does', () => {
    const valid = analyzeFigureBlockStructure({
      kind: 'figure', owningBlockIdentity: 'p', objectCount: 1,
      nonObjectSemanticContentText: '', containerKind: 'paragraph',
    })
    noteFigureBlockAdmission(valid, true)
    expect(getFigureBlockStructureV515GateDecision().decision).toBe('PASS')
    noteFigureBlockAdmission(valid, false)
    expect(getFigureBlockStructureV515Counters().validStandaloneFigureRejected).toBe(1)
    expect(getFigureBlockStructureV515GateDecision().decision).toBe('FAIL')
  })

  it('§18 — admitting an INVALID block fires the matching admission gate', () => {
    const invalid = analyzeFigureBlockStructure({
      kind: 'figure', owningBlockIdentity: 'p', objectCount: 2,
      nonObjectSemanticContentText: '前文', containerKind: 'paragraph',
    })
    noteFigureBlockAdmission(invalid, true)
    const c = getFigureBlockStructureV515Counters()
    expect(c.mixedWithTextAdmittedAsNormalTarget).toBe(1)
    expect(c.multiImageBlockAdmittedAsNormalTarget).toBe(1)
    expect(c.nonStandaloneContainerAdmittedAsNormalTarget).toBe(0)
  })

  it('§18 — excluding an INVALID block keeps every admission gate at 0', () => {
    const invalid = analyzeFigureBlockStructure({
      kind: 'figure', owningBlockIdentity: 'li', objectCount: 1,
      nonObjectSemanticContentText: '', containerKind: 'list-item',
    })
    noteFigureBlockAdmission(invalid, false)
    expect(getFigureBlockStructureV515GateDecision().decision).toBe('PASS')
  })

  it('§18 — a duplicate structure diagnostic for the SAME block fires the duplicate gate', () => {
    noteFigureStructureDiagnosticPublished({ owningBlockIdentity: 'src-block:3', violationCount: 2, locatable: true })
    expect(getFigureBlockStructureV515Counters().structureDuplicateDiagnostic).toBe(0)
    noteFigureStructureDiagnosticPublished({ owningBlockIdentity: 'src-block:3', violationCount: 2, locatable: true })
    expect(getFigureBlockStructureV515Counters().structureDuplicateDiagnostic).toBe(1)
  })

  it('§18 — an unlocatable structure diagnostic fires the locate gate', () => {
    noteFigureStructureDiagnosticPublished({ owningBlockIdentity: 'src-block:9', violationCount: 1, locatable: false })
    expect(getFigureBlockStructureV515Counters().structureUnlocatableDiagnostic).toBe(1)
  })

  it('§16/§18 — the DOM pass resets coverage but never masks a recorded gate', () => {
    const invalid = analyzeFigureBlockStructure({
      kind: 'figure', owningBlockIdentity: 'p', objectCount: 2,
      nonObjectSemanticContentText: '', containerKind: 'paragraph',
    })
    noteFigureBlockAdmission(invalid, true)
    expect(getFigureBlockStructureV515Counters().multiImageBlockAdmittedAsNormalTarget).toBe(1)
    beginFigureBlockStructureV515DomPass()
    // a forbidden admission observed once is never forgotten …
    expect(getFigureBlockStructureV515Counters().multiImageBlockAdmittedAsNormalTarget).toBe(1)
    expect(getFigureBlockStructureV515GateDecision().decision).toBe('FAIL')
    // … while the coverage surface describes the new pass
    expect(getFigureBlockStructureV515CoverageCounters().figureBlocksAnalyzed).toBe(0)
  })

  it('a real document run leaves every gate at 0', () => {
    diagnosticsOf(`before ![a](${ASSET}) middle ![b](${ASSET})\n\n![](${ASSET})\n\n- ![](${ASSET})\n`)
    expect(getFigureBlockStructureV515GateDecision().decision).toBe('PASS')
    expect(evaluateFigureBlockStructureV515Gates(getFigureBlockStructureV515Counters()).failedChecks).toEqual([])
  })
})

// ── §20/§34/§36 — the real Runtime fixture (source-level acceptance) ──────

describe('V5.15 §20/§34/§36 — the real runtime fixture', () => {
  const fixturePath = resolve(process.cwd(), 'test/vault/runtime/smoke/Figure-Standalone-Block-Invariant-Test.md')
  const source = readFileSync(fixturePath, 'utf8')

  it('§34 — exactly 3 valid standalone figures and 10 classified structure issues', () => {
    const blocks = blocksOf(source)
    expect(blocks.filter(b => b.result.decision === 'VALID_STANDALONE_FIGURE')).toHaveLength(3) // A + G1 + G2
    // B C D E F I J + I2 J2 + L (the heading block is analysed as a paragraph
    // here; the production emitter owns it as FIGURE_IN_HEADING instead)
    expect(blocks.filter(b => b.result.decision !== 'VALID_STANDALONE_FIGURE')).toHaveLength(10)
    // every fixture image really exists on disk → no resource warning
    const out = diagnosticsOf(source, { missing: () => false })
    const issues = out.diagnostics.filter(d => FIGURE_STRUCTURE_BLOCK_RULE_CODES.has(d.code))
    expect(issues).toHaveLength(9) // 9 block classes (Case K is now a V3 syntax rule)
    // V3 owns the unclosed Case K syntax with its own specific rule.
    expect(out.diagnostics.filter(d => d.code === 'FIGURE_UNCLOSED_DESTINATION')).toHaveLength(1)
    expect(issues.filter(d => d.code === FIGURE_TEXT_MIXED_CODE)).toHaveLength(3) // B C D
    expect(issues.filter(d => d.code === FIGURE_MULTIPLE_SAME_BLOCK_CODE)).toHaveLength(2) // E F
    expect(issues.filter(d => d.code === FIGURE_IN_LIST_CODE)).toHaveLength(2) // I + I2
    expect(issues.filter(d => d.code === FIGURE_IN_QUOTE_CODE)).toHaveLength(2) // J + J2
    expect(out.errorCount).toBe(9) // E F I I2 J J2 + Case K syntax + Case L heading + empty source
    expect(out.warningCount).toBe(3) // B C D
    // an invalid block never produces a normal figure naming diagnostic
    expect(out.diagnostics.filter(d => d.code === 'FIGURE_MISSING_NAME')).toHaveLength(0)
    expect(getFigureBlockStructureV515GateDecision().decision).toBe('PASS')
  })

  it('§36 — the fix clears every structure issue (including list / quote) and is idempotent', () => {
    const once = buildStandaloneFigureBlockFix(source)
    expect(once.changed).toBe(true)
    const after = diagnosticsOf(once.output, { missing: () => false })
      .diagnostics.filter(d => FIGURE_STRUCTURE_BLOCK_RULE_CODES.has(d.code))
    // The V5.15 block repair owns every container / composition class.
    expect(after).toHaveLength(0)
    // The unclosed Case K syntax is an INDEPENDENT V3 rule (not a block class).
    expect(
      diagnosticsOf(once.output, { missing: () => false })
        .diagnostics.filter(d => d.code === 'FIGURE_UNCLOSED_DESTINATION'),
    ).toHaveLength(1)
    // E/F each carried two images; I2 / J2 / L add one each:
    // 3 + B/C/D + (E1,E2) + (F1,F2) + I + J + I2 + J2 + L1 = 15
    expect(blocksOf(once.output).filter(b => b.result.decision === 'VALID_STANDALONE_FIGURE')).toHaveLength(15)
    // §12 — never 2+ consecutive blank lines
    expect(/\n[ \t]*\n[ \t]*\n/.test(once.output)).toBe(false)
    // §21 — every COMPLETE image token survives, in the original order (the
    // deliberately unclosed Case K fragment is not a token in either document).
    const tokens = (s: string): string[] => scanSourceImageTokens(s).map(t => t.rawToken)
    expect(tokens(once.output)).toEqual(tokens(source))
    // §21 — idempotent
    const twice = buildStandaloneFigureBlockFix(once.output)
    expect(twice.changed).toBe(false)
    expect(twice.output).toBe(once.output)
  })
})

// ── §11 — the ONE fix entry for the image structure rule ───────────────────

describe('V5.15 §11 — ONE fix entry: FIGURE_BLOCK_STRUCTURE_INVALID', () => {
  const DOC_KEY = 'doc:v515'

  function fixCtx(markdown: string): FixContext {
    return { markdown, snapshotMarkdown: markdown, documentKey: DOC_KEY, snapshot: null, locked: false }
  }

  function structureDiagnostics(markdown: string) {
    return diagnosticsOf(markdown, { missing: () => false })
      .diagnostics.filter(d => FIGURE_STRUCTURE_BLOCK_RULE_CODES.has(d.code))
  }

  function fixMarkdown(markdown: string, index = 0): string {
    const diagnostic = structureDiagnostics(markdown)[index]
    expect(diagnostic).toBeTruthy()
    const fixer = createDefaultDiagnosticFixRegistry().get(diagnostic.code)
    expect(fixer).toBeTruthy()
    const built = fixer!.build(diagnostic, fixCtx(markdown))
    expect(built.blockers ?? []).toEqual([])
    expect(built.patches ?? []).toHaveLength(1)
    return applyPatchesToMarkdown(markdown, built.patches ?? [])
  }

  it('ONE diagnostic per owning block, classified by its real problem', () => {
    const mixed = structureDiagnostics('前文 ![](a.png) 后文\n')
    expect(mixed).toHaveLength(1)
    expect(mixed[0].code).toBe(FIGURE_TEXT_MIXED_CODE)
    // ONE row per owning block, never one row per image
    const multi = structureDiagnostics('a ![](a.png) b ![](b.png) c\n')
    expect(multi).toHaveLength(1)
    expect(multi[0].code).toBe(FIGURE_MULTIPLE_SAME_BLOCK_CODE)
  })

  it('the capability matrix exposes a real auto fix for every repairable class', () => {
    for (const code of [
      FIGURE_BLOCK_STRUCTURE_INVALID_CODE,
      FIGURE_MULTIPLE_SAME_BLOCK_CODE,
      FIGURE_TEXT_MIXED_CODE,
      FIGURE_IN_LIST_CODE,
      FIGURE_IN_QUOTE_CODE,
      FIGURE_INLINE_FORMAT_CODE,
    ]) {
      expect(describeFixCapability(code).capability, code).toBe('AUTO_SAFE')
      expect(describeFixCapability(code).actionKind, code).toBe('source-patches')
    }
    // a table cell owns no safe fix → the UI must not offer a dead button
    expect(describeFixCapability(FIGURE_IN_TABLE_CODE).capability).toBe('UNAVAILABLE')
  })

  it('two images on one line become two standalone image blocks', () => {
    expect(fixMarkdown('![](a.png) ![](b.png)\n')).toBe('![](a.png)\n\n![](b.png)\n')
  })

  it('three images keep their original order', () => {
    const fixed = fixMarkdown('![](a.png) ![](b.png) ![](c.png)\n')
    expect(fixed).toBe('![](a.png)\n\n![](b.png)\n\n![](c.png)\n')
  })

  it('text before / after / between images is separated', () => {
    expect(fixMarkdown('前文 ![](a.png)\n')).toBe('前文\n\n![](a.png)\n')
    expect(fixMarkdown('![](a.png) 后文\n')).toBe('![](a.png)\n\n后文\n')
    expect(fixMarkdown('文字A ![](a.png) ![图2](b.png) 文字B\n'))
      .toBe('文字A\n\n![](a.png)\n\n![图2](b.png)\n\n文字B\n')
  })

  it('preserves alt text, title, link wrapper and a Chinese path byte for byte', () => {
    const markdown = '前文 ![中文说明](../../assets/图片 名.png "标题") 后文\n'
    const fixed = fixMarkdown(markdown)
    expect(fixed).toBe('前文\n\n![中文说明](../../assets/图片 名.png "标题")\n\n后文\n')
  })

  it('a standalone image is never flagged and never rewritten', () => {
    expect(structureDiagnostics(`![](${ASSET})\n`)).toEqual([])
    expect(structureDiagnostics(`![](${ASSET})\n\n![](${ASSET})\n`)).toEqual([])
  })

  it('image syntax inside fenced / inline code is never a figure', () => {
    expect(structureDiagnostics('```md\nbefore ![](a.png) after\n```\n')).toEqual([])
    expect(structureDiagnostics('before `![](a.png)` after\n')).toEqual([])
  })

  it('a simple list item image loses its list marker (unordered / ordered / task)', () => {
    expect(fixMarkdown('- ![](a.png)\n')).toBe('![](a.png)\n')
    expect(fixMarkdown('1. ![](a.png)\n')).toBe('![](a.png)\n')
    expect(fixMarkdown('- [ ] ![](a.png)\n')).toBe('![](a.png)\n')
    expect(fixMarkdown('- [x] ![图](a.png)\n')).toBe('![图](a.png)\n')
  })

  it('a simple blockquote image loses EVERY quote level', () => {
    expect(fixMarkdown('> ![](a.png)\n')).toBe('![](a.png)\n')
    expect(fixMarkdown('>> ![](a.png)\n')).toBe('![](a.png)\n')
    expect(fixMarkdown('> > ![](a.png)\n')).toBe('![](a.png)\n')
  })

  it('a table image is refused so the table structure is never destroyed', () => {
    const markdown = '| 列A | 列B |\n| --- | --- |\n| ![](t.png) | x |\n'
    const diagnostic = structureDiagnostics(markdown)[0]
    expect(diagnostic).toBeTruthy()
    expect(diagnostic.code).toBe(FIGURE_IN_TABLE_CODE)
    expect(diagnostic.metadata?.['autoFixable']).toBe(false)
    const built = FIGURE_BLOCK_STRUCTURE_INVALID_FIX.build(diagnostic, fixCtx(markdown))
    expect(built.patches ?? []).toEqual([])
    expect((built.blockers ?? []).map(b => b.code)).toContain('STRUCTURE_NOT_AUTO_FIXABLE')
  })

  it('one click fixes every repairable class (paragraph / list / quote) and is idempotent', () => {
    const markdown = '前文 ![](a.png) 后文\n\n![](b.png) ![](c.png)\n\n- ![](d.png)\n\n> ![](e.png)\n'
    const out = diagnosticsOf(markdown, { missing: () => false })
    const snapshot = {
      documentKey: DOC_KEY,
      revision: 1,
      sourceRevision: 1,
      generatedAt: 1,
      diagnostics: out.diagnostics,
      errorCount: out.errorCount,
      warningCount: out.warningCount,
      infoCount: out.infoCount,
      structuralVerified: true,
    }
    const plans = planAllAutoFixesV2(
      { markdown, snapshotMarkdown: markdown, documentKey: DOC_KEY, snapshot, locked: false },
      { captionAvailable: true },
    )
    const { accepted, rejected } = selectNonConflictingPlans(plans)
    expect(accepted).toHaveLength(4)
    expect(rejected).toEqual([])
    const { next } = buildFixedMarkdown(markdown, accepted)
    expect(next).toBe('前文\n\n![](a.png)\n\n后文\n\n![](b.png)\n\n![](c.png)\n\n![](d.png)\n\n![](e.png)\n')
    expect(structureDiagnostics(next)).toHaveLength(0)
    expect(/\n[ \t]*\n[ \t]*\n/.test(next)).toBe(false)
    // idempotent: the already-fixed blocks never yield another patch
    const again = planAllAutoFixesV2(
      { markdown: next, snapshotMarkdown: next, documentKey: DOC_KEY, snapshot, locked: false },
      { captionAvailable: true },
    )
    expect(selectNonConflictingPlans(again).accepted).toHaveLength(0)
  })
})
