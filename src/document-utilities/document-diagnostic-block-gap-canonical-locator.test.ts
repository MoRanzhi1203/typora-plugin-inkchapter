// @vitest-environment jsdom
/**
 * TRAE — `EXCESSIVE_INTERNAL_BLANK_LINES` canonical block-gap LOCATOR closure.
 *
 * THE DEFECT: source detection was correct, but the PREVIOUS boundary was bound
 * by re-guessing the DOM from the Markdown fence text (`previousBlockAnchorText
 * = "```"`), which is NOT a unique identity (every fence shares it). The ladder
 * ended at `previousBindingDecision=MISSING / ANCHOR_TEXT_NOT_FOUND`, so
 * `previousRect=null → gapRect=null → BLOCK_GAP_VISUAL_NOT_PAINTED /
 * ZERO_PAINTED_RECT`, while the NEXT paragraph bound fine.
 *
 * THE FIX UNDER TEST:
 *   source blank-line detection
 *     → canonical `block:<kind>:<ordinal>` boundary identity (source derived)
 *     → canonical boundary resolver (code → `pre.md-fences[N]`)
 *     → presentation extents → BlockGapGeometryPolicy
 *     → gap-centre scroll → settle → re-resolve / re-measure / rebuild
 *     → generic document-space FILL_ONLY carrier → generic active lease
 *     → ACTIVE
 *
 * Covered (§23 A–F + §9/§11/§17/§22):
 *   A  the real regression fixture (code + 3 blank lines + paragraph)
 *   B  every boundary kind combination resolvable in jsdom
 *   C  three identical `"```"` fences bind `block:code:2`, never 0/1
 *   D  the frozen threshold authority (0/1/2 pass, 3/4 warn)
 *   E  fenced-code / front-matter internal blank lines stay excluded
 *   F  the internal gap and the EOF rules stay separated
 *   §9 fail-closed with an EXACT reason (never an adjacent-block highlight)
 *   §11 the horizontal authority is the document column, never the viewport
 *   §17 the closure is scoped to the CURRENT diagnostic's one gap carrier
 *   §22 the gate + coverage families
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  BLOCK_GAP_CANONICAL_CLOSURE_COVERAGE_REQUIREMENTS,
  BLOCK_GAP_CANONICAL_CLOSURE_GATE_KEYS,
  BLOCK_GAP_CANONICAL_CLOSURE_GATE_LABELS,
  BLOCK_GAP_TARGET_AUDIT_EVENT,
  BLOCK_GAP_VISUAL_CLASS,
  BLOCK_GAP_VISUAL_TARGET,
  RENDERED_BLANK_ROW_FRAGMENT_CLASS,
  blockGapFailClosedReason,
  createBlockGapCanonicalClosureGates,
  emptyBlockGapCanonicalClosureCoverage,
  evaluateBlockGapCanonicalClosureCoverage,
  evaluateBlockGapCanonicalClosureGates,
  resolveBlockGapHorizontalExtent,
} from './document-diagnostic-block-gap-visual-v1'
import { RENDERED_BLANK_GAP_SCROLL_TARGET } from './document-diagnostic-rendered-blank-row'
import {
  EXCESSIVE_INTERNAL_BLANK_LINES_CODE,
  analyzeInternalBlankLineGaps,
  collectDocumentBlockGaps,
  isExcessiveInternalBlankRun,
} from './document-diagnostic-internal-blank-lines-v1'

// ── DOM order: LOCAL bitmask literals, never `Node.DOCUMENT_POSITION_*` ─────
describe('TRAE — block-gap DOM order uses spec literals, never Node.DOCUMENT_POSITION_*', () => {
  it('document-utility-overlay-host.ts never references Node.DOCUMENT_POSITION', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    // Root cause: inside the bundled Typora runtime `Node.DOCUMENT_POSITION_*`
    // resolve to `undefined`, so `order & Node.DOCUMENT_POSITION_FOLLOWING === 0`
    // → gapBoundaryOrderOk was ALWAYS false → the rendered-blank-row PRIMARY paint
    // was always skipped → ZERO_PAINTED_RECT. The heading service fixed the same
    // trap with local literals; this guards the block-gap order check too.
    // no CODE usage (a comment may still NAME the trap); the bitmask test must
    // read a local literal, never the runtime-undefined framework constant.
    expect(src).not.toMatch(/&\s*Node\.DOCUMENT_POSITION_/)
    expect(src).toMatch(/&\s*DOM_POSITION_FOLLOWING/)
  })
})

// ── §23 A/D/E/F — the pure source-side contract ─────────────────────────────

/** The REAL regression shape: 3 fences (all `"```"`), a gap, a paragraph. */
const REGRESSION_SOURCE = [
  '# 代码完整性',
  '',
  '正文。',
  '',
  '```ts',
  'const hasLanguage = true',
  '```',
  '',
  '```',
  'const noLanguage = true',
  '```',
  '',
  '```',
  '',
  '```',
  '', // ← the excess run starts
  '',
  '',
  '代码 3 Manual prefix code caption',
  '',
  '```js',
  'const trailing = 1',
  '```',
].join('\n')

describe('TRAE §23 A/C — the canonical boundary identity is source derived', () => {
  it('the regression gap binds `block:code:2` (never the 0th/1st fence)', () => {
    const gaps = collectDocumentBlockGaps(REGRESSION_SOURCE)
    const excessive = gaps.filter(g => isExcessiveInternalBlankRun(g.actualBlankLines))
    expect(excessive).toHaveLength(1)
    const gap = excessive[0]
    expect(gap.previousBlockKind).toBe('code')
    expect(gap.previousBlockCanonicalKind).toBe('code')
    // three fences share the SAME first line (`"```"`): the ordinal is the ONLY
    // stable discriminator, and the previous block is the THIRD fence.
    expect(gap.previousBlockCanonicalOrdinal).toBe(2)
    expect(gap.previousBlockAnchorText).toBe('```')
    expect(gap.nextBlockKind).toBe('paragraph')
    expect(gap.nextBlockCanonicalKind).toBeNull()
    expect(gap.actualBlankLines).toBe(3)
  })

  it('0/1/2/3/4 blank lines keep the FROZEN threshold authority', () => {
    const withBlanks = (n: number): string =>
      ['# T', '', '```', 'const a = 1', '```', ...Array.from({ length: n }, () => ''), 'tail paragraph'].join('\n')
    expect(analyzeInternalBlankLineGaps(withBlanks(0))).toHaveLength(0)
    expect(analyzeInternalBlankLineGaps(withBlanks(1))).toHaveLength(0)
    expect(analyzeInternalBlankLineGaps(withBlanks(2))).toHaveLength(1)
    expect(analyzeInternalBlankLineGaps(withBlanks(3))).toHaveLength(1)
    expect(analyzeInternalBlankLineGaps(withBlanks(4))).toHaveLength(1)
    expect(analyzeInternalBlankLineGaps(withBlanks(2))[0].actualBlankLines).toBe(2)
    expect(analyzeInternalBlankLineGaps(withBlanks(3))[0].actualBlankLines).toBe(3)
  })

  it('§23 E — a fenced-code / front-matter internal blank line is NOT a gap', () => {
    // three blank lines INSIDE a fence are content, never an excessive gap
    const inFence = ['# T', '', '```', 'const a = 1', '', '', '', 'const b = 2', '```', '', 'tail'].join('\n')
    expect(analyzeInternalBlankLineGaps(inFence)).toHaveLength(0)
    // and the empty fence in the regression fixture keeps ONE canonical block
    const gaps = collectDocumentBlockGaps(REGRESSION_SOURCE)
    const emptyFenceRuns = gaps.filter(g => g.previousBlockCanonicalOrdinal === 2)
    expect(emptyFenceRuns.length).toBeGreaterThanOrEqual(1)
    const inFrontMatter = ['---', 'title: x', '', '', 'tags: y', '---', '', 'tail'].join('\n')
    expect(analyzeInternalBlankLineGaps(inFrontMatter)).toHaveLength(0)
  })

  it('§23 F — trailing (EOF) blank runs are never reported as internal', () => {
    const eof = ['# T', '', 'tail paragraph', '', '', '', ''].join('\n')
    // the only legal gap is the single blank line after the heading; the
    // TRAILING run owns no internal gap at all (§10).
    const trailingRunStart = eof.split('\n').length - 4
    for (const g of collectDocumentBlockGaps(eof)) {
      expect(g.lastBlankLine).toBeLessThan(trailingRunStart)
    }
    expect(analyzeInternalBlankLineGaps(eof)).toHaveLength(0)
    const leading = ['', '', '', '# T', '', 'tail'].join('\n')
    expect(collectDocumentBlockGaps(leading).every(g => g.firstBlankLine > 0)).toBe(true)
    expect(analyzeInternalBlankLineGaps(leading)).toHaveLength(0)
  })

  it('table / formula boundaries carry their canonical kind + ordinal', () => {
    const src = ['# T', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', '', '', '$$', 'E = mc^2', '$$'].join('\n')
    const gaps = collectDocumentBlockGaps(src).filter(g => g.actualBlankLines >= 3)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].previousBlockCanonicalKind).toBe('table')
    expect(gaps[0].previousBlockCanonicalOrdinal).toBe(0)
  })

  it('heading / paragraph boundaries have NO canonical object kind', () => {
    const src = ['# T', '', '', '', 'body paragraph'].join('\n')
    const gaps = collectDocumentBlockGaps(src).filter(g => g.actualBlankLines >= 3)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].previousBlockCanonicalKind).toBeNull()
    expect(gaps[0].nextBlockCanonicalKind).toBeNull()
  })
})

// ── §9/§11/§22 — the pure policy families ───────────────────────────────────

describe('TRAE §9/§22 — fail-closed reason + gates + coverage', () => {
  it('§9 — the exact one-sided / both-sided fail-closed reasons', () => {
    expect(blockGapFailClosedReason(true, true)).toBeNull()
    expect(blockGapFailClosedReason(false, true)).toBe('PREVIOUS_BOUNDARY_MISSING')
    expect(blockGapFailClosedReason(true, false)).toBe('NEXT_BOUNDARY_MISSING')
    expect(blockGapFailClosedReason(false, false)).toBe('BOTH_BOUNDARIES_MISSING')
  })

  it('§11 — the document text column wins over the boundary union', () => {
    expect(resolveBlockGapHorizontalExtent({
      textColumnLeft: 120, contentLeft: 100, contentRight: 800,
      previousLeft: 60, previousRight: 700, nextLeft: 60, nextRight: 700,
    })).toEqual({ left: 120, right: 800, authority: 'DOCUMENT_TEXT_COLUMN' })
    expect(resolveBlockGapHorizontalExtent({
      textColumnLeft: null, contentLeft: null, contentRight: null,
      previousLeft: 60, previousRight: 700, nextLeft: 80, nextRight: 720,
    })).toEqual({ left: 60, right: 720, authority: 'BOUNDARY_UNION' })
    expect(resolveBlockGapHorizontalExtent({
      textColumnLeft: null, contentLeft: null, contentRight: null,
      previousLeft: null, previousRight: null, nextLeft: null, nextRight: null,
    })).toBeNull()
  })

  it('§22 — every closure gate is 0 ⇒ PASS; a single hit ⇒ FAIL', () => {
    const counters = createBlockGapCanonicalClosureGates()
    expect(BLOCK_GAP_CANONICAL_CLOSURE_GATE_KEYS).toHaveLength(14)
    for (const key of [
      'anchorTextCodeFenceBindCount', 'previousBoundaryMissingCount', 'nextBoundaryMissingCount',
      'zeroPaintedRectCount', 'documentEndPlacementCount', 'unscopedVisualFalsePassCount',
      'wrongPreviousBlockHighlightCount', 'wrongNextBlockHighlightCount', 'staleVisualCount',
    ] as const) {
      expect(BLOCK_GAP_CANONICAL_CLOSURE_GATE_KEYS).toContain(key)
    }
    expect(evaluateBlockGapCanonicalClosureGates(counters).decision).toBe('PASS')
    counters.anchorTextCodeFenceBindCount = 1
    const verdict = evaluateBlockGapCanonicalClosureGates(counters)
    expect(verdict.decision).toBe('FAIL')
    expect(verdict.failing).toEqual([BLOCK_GAP_CANONICAL_CLOSURE_GATE_LABELS.anchorTextCodeFenceBindCount])
  })

  it('§22 — positive coverage needs the real runtime chain, never a fake PASS', () => {
    const coverage = emptyBlockGapCanonicalClosureCoverage()
    expect(evaluateBlockGapCanonicalClosureCoverage(coverage).satisfied).toBe(false)
    for (const key of Object.keys(BLOCK_GAP_CANONICAL_CLOSURE_COVERAGE_REQUIREMENTS)) coverage[key] = 1
    expect(evaluateBlockGapCanonicalClosureCoverage(coverage).satisfied).toBe(true)
    expect(BLOCK_GAP_CANONICAL_CLOSURE_COVERAGE_REQUIREMENTS.INTERNAL_BLANK_LINE_PREVIOUS_CODE_CANONICAL_BIND_COUNT).toBe(1)
  })
})

// ── host harness (jsdom) ────────────────────────────────────────────────────

let rafSeq = 1
function stubRaf(): void {
  rafSeq = 1
  const raf = (cb: FrameRequestCallback): number => { void cb; return rafSeq++ }
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = raf
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => { /* noop */ }
}

type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const r = getRect()
      return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }
    },
  })
}

interface Internals {
  bindGapBoundary(ref: {
    canonicalKind: string | null
    canonicalOrdinal: number | null
    startLine: number | null
    anchorText: string
  }): { element: HTMLElement | null; decision: string; strategy: string; semanticTextMatch: boolean }
  commitBlockGapVisual(
    diagId: string | null,
    severity: 'error' | 'warning' | 'info',
    diag: Record<string, unknown> | null,
    preferredNextElement?: HTMLElement | null,
  ): void
  emitVisualClosureAudit(reason: string): void
  lastLocatedDiagnosticId: string | null
  snapshot: DocumentDiagnosticsSnapshot | null
  removeBlockGapVisual(): void
  getBlockGapCanonicalClosureCounters(): Record<string, number>
  /** REALTIME — 结构 mutation 后的局部视觉快速 patch（本轮新增）。 */
  patchActiveGapVisualFromDom(): boolean
  /** REALTIME V2 — 交互所有权状态（快速 patch 的授权来源）。 */
  diagnosticInteractionState: Record<string, unknown>
  /** PERF-A/B/C — 最近一次占据扫描的候选节点数。 */
  lastOccupancyCandidateCount: number
  /** PERF-B — 最近一次校准是否命中缓存。 */
  lastCalibrationReused: boolean
  /** PERF-C — 最近一次提交是否处于静默审计模式。 */
  lastCommitAuditQuiet: boolean
}

interface World {
  h: DocumentUtilityOverlayHost
  write: HTMLElement
  fences: HTMLElement[]
  paragraph: HTMLElement
  table: HTMLElement
  formula: HTMLElement
  heading: HTMLElement
}

/**
 * The canonical DOM of the regression fixture: THREE identical fenced code
 * blocks (`pre.md-fences`, all with `data-line`), a paragraph, a table, a
 * formula and a heading — every canonical boundary kind this rule can own.
 */
function makeWorld(): World {
  const shell = document.createElement('div')
  shell.className = 'typ-markdown-view'
  document.body.appendChild(shell)
  stubRect(shell, () => ({ left: 0, top: 0, right: 900, bottom: 1600 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  stubRect(write, () => ({ left: 50, top: 0, right: 850, bottom: 1600 }))

  const heading = document.createElement('h1')
  heading.className = 'md-end-block md-heading'
  heading.textContent = '代码完整性'
  write.appendChild(heading)
  stubRect(heading, () => ({ left: 60, top: 20, right: 700, bottom: 60 }))

  const fences: HTMLElement[] = []
  const fenceTops = [[120, 200], [240, 320], [360, 420]]
  for (let i = 0; i < 3; i++) {
    const fence = document.createElement('pre')
    fence.className = 'md-fences md-end-block'
    fence.setAttribute('data-line', String(10 + i * 6))
    fence.textContent = `const value${i} = ${i}`
    write.appendChild(fence)
    stubRect(fence, () => ({ left: 60, top: fenceTops[i][0], right: 700, bottom: fenceTops[i][1] }))
    fences.push(fence)
  }

  // TRAE — the THREE rendered blank rows the user actually sees between fence#2
  // (bottom 420) and the caption paragraph (top 520). `sourceBlankLineCount = 7`
  // maps to `renderedBlankRowCount = 3` (never a mathematical conversion).
  blankRows = []
  const blankTops = [[421, 454], [454, 487], [487, 519]]
  for (let i = 0; i < 3; i++) {
    const row = document.createElement('p')
    row.className = 'md-p md-end-block'
    row.setAttribute('data-line', String(22 + i))
    write.appendChild(row)
    stubRect(row, () => ({ left: 60, top: blankTops[i][0], right: 700, bottom: blankTops[i][1] }))
    blankRows.push(row)
  }

  const paragraph = document.createElement('p')
  paragraph.className = 'md-end-block md-p'
  paragraph.setAttribute('data-line', '40')
  paragraph.textContent = '代码 3 Manual prefix code caption'
  write.appendChild(paragraph)
  stubRect(paragraph, () => ({ left: 60, top: 520, right: 700, bottom: 544 }))

  const table = document.createElement('table')
  table.setAttribute('data-line', '50')
  const tr = document.createElement('tr')
  const td = document.createElement('td')
  td.textContent = 'cell'
  tr.appendChild(td)
  table.appendChild(tr)
  write.appendChild(table)
  stubRect(table, () => ({ left: 60, top: 600, right: 700, bottom: 660 }))

  const formula = document.createElement('div')
  formula.className = 'md-math-block'
  formula.setAttribute('data-line', '60')
  formula.textContent = 'E = mc^2'
  write.appendChild(formula)
  stubRect(formula, () => ({ left: 60, top: 700, right: 700, bottom: 740 }))

  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  hosts.push(h)
  return { h, write, fences, paragraph, table, formula, heading }
}

const hosts: DocumentUtilityOverlayHost[] = []
/** TRAE — the 3 rendered blank rows of the current world (fragment geometry). */
let blankRows: HTMLElement[] = []

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveLeafState: () => ({ leafStateKnown: true, leafPath: 'doc.md' }),
      getActiveFilePath: () => 'doc.md',
      getDocumentKey: () => 'doc:gap',
      getMarkdown: () => REGRESSION_SOURCE,
      isStrictMode: () => true,
      vaultRoot: '/root',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
}

function fakeProviders(): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false,
    getHeadingIdentity: () => null,
    parseLocalLinkTargets: () => [],
  }
}

const FENCE_TOKEN = '`'.repeat(3)
const GAP_RULE_DIAG_ID = 'document:' + EXCESSIVE_INTERNAL_BLANK_LINES_CODE
  + ':blank-gap:code:' + FENCE_TOKEN + '#2>>paragraph:x#0'

/** The REAL diagnostic record the detection now emits for the fixture gap. */
function gapDiag(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: GAP_RULE_DIAG_ID,
    documentKey: 'doc:gap',
    severity: 'warning',
    category: 'document',
    code: EXCESSIVE_INTERNAL_BLANK_LINES_CODE,
    message: '连续空行过多',
    detail: '连续 3 个空行',
    metadata: {
      ruleId: 'EXCESSIVE-INTERNAL-BLANK-LINES',
      previousBlockIdentity: 'code:```#2',
      previousBlockKind: 'code',
      previousBlockCanonicalKind: 'code',
      previousBlockCanonicalOrdinal: 2,
      previousBlockStartLine: 12,
      previousBlockAnchorText: '```',
      nextBlockIdentity: 'paragraph:代码 3 Manual prefix code caption#0',
      nextBlockKind: 'paragraph',
      nextBlockCanonicalKind: null,
      nextBlockCanonicalOrdinal: null,
      nextBlockStartLine: 19,
      nextBlockAnchorText: '代码 3 Manual prefix code caption',
      firstBlankLine: 15,
      lastBlankLine: 17,
      actualBlankLines: 3,
      passMaxBlankLines: 1,
      warningThreshold: 2,
    },
    location: {
      kind: 'source-range', startLine: 19, startColumn: 0,
      sourceFingerprint: `internal-blank:blank-gap:x`, rawText: '代码 3 Manual prefix code caption',
    },
    ...over,
  }
}

function snapshotOf(diags: Array<Record<string, unknown>>): DocumentDiagnosticsSnapshot {
  return {
    documentKey: 'doc:gap', sourceRevision: 1, presenceActive: true,
    diagnostics: diags, summary: { error: 0, warning: diags.length, info: 0 },
  } as unknown as DocumentDiagnosticsSnapshot
}

function injectSnapshot(world: World, diags: Array<Record<string, unknown>>): void {
  const snapshot = snapshotOf(diags)
  const authority = (world.h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null } }).diagnostics
  authority.snapshot = snapshot
  const internals = world.h as unknown as Internals
  internals.snapshot = snapshot
  internals.lastLocatedDiagnosticId = String(diags[0]?.id ?? '')
}

function readAudits(spy: { mock: { calls: unknown[][] } }, event: string): Array<Record<string, string>> {
  return spy.mock.calls
    .map(c => String(c[0]))
    .filter(l => l.includes(event))
    .map(line => {
      const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
      const out: Record<string, string> = {}
      for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
      return out
    })
}

const gapCarriers = (): number => document.querySelectorAll(`.${BLOCK_GAP_VISUAL_CLASS}`).length

let infoSpy: { mock: { calls: unknown[][] }; mockRestore: () => void } | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  hosts.length = 0
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element, pseudo?: string) => {
    if (pseudo != null) return { content: 'none' } as unknown as CSSStyleDeclaration
    const isGap = el.getAttribute?.('data-block-gap-visual') === BLOCK_GAP_VISUAL_TARGET
    return {
      lineHeight: '24px', marginTop: '12.8px', marginBottom: '15px', display: 'block', visibility: 'visible',
      backgroundColor: isGap ? 'rgba(168, 121, 50, 0.08)' : 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none', boxShadow: 'none', outlineStyle: 'none', outlineWidth: '0px',
      borderLeftWidth: '0px', borderRightWidth: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
      position: isGap ? 'absolute' : 'static', zIndex: 'auto', opacity: '1', color: 'rgb(0,0,0)',
      textIndent: '0px', paddingLeft: '0px', paddingRight: '0px', width: 'auto',
    } as unknown as CSSStyleDeclaration
  }) as unknown as typeof window.getComputedStyle)
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => { /* captured */ }) as unknown as {
    mock: { calls: unknown[][] }; mockRestore: () => void
  }
})

afterEach(() => {
  for (const h of hosts) { try { h.dispose() } catch { /* noop */ } }
  hosts.length = 0
  infoSpy?.mockRestore()
  infoSpy = null
  vi.unstubAllGlobals()
})

// ── §23 B/C — the canonical boundary resolver ───────────────────────────────

describe('TRAE §8/§23 C — canonical boundary binding (fence text is NOT an authority)', () => {
  it('binds `block:code:2` to the THIRD fence, never fence 0/1', () => {
    const world = makeWorld()
    const internals = world.h as unknown as Internals
    const bound = internals.bindGapBoundary({
      canonicalKind: 'code', canonicalOrdinal: 2, startLine: 22, anchorText: '```',
    })
    expect(bound.decision).toBe('BOUND')
    expect(bound.strategy).toBe('CANONICAL_CODE_TARGET')
    expect(bound.element).toBe(world.fences[2])
    expect(bound.element).not.toBe(world.fences[0])
    expect(bound.element).not.toBe(world.fences[1])
    // the fence text is NEVER the binding strategy
    expect(bound.strategy.includes('ANCHOR_TEXT')).toBe(false)
  })

  it('§9 — an out-of-range canonical ordinal FAILS CLOSED (no text guess)', () => {
    const world = makeWorld()
    const internals = world.h as unknown as Internals
    const bound = internals.bindGapBoundary({
      canonicalKind: 'code', canonicalOrdinal: 9, startLine: null, anchorText: '```',
    })
    expect(bound.decision).toBe('MISSING')
    expect(bound.strategy).toBe('CANONICAL_CODE_TARGET_MISSING')
    expect(bound.element).toBeNull()
  })

  it('§8 — the `data-line` fast path saves a drifted ordinal, but only for the SAME kind', () => {
    const world = makeWorld()
    const internals = world.h as unknown as Internals
    // ordinal 9 misses → the data-line element of the SAME canonical kind binds
    const byLine = internals.bindGapBoundary({
      canonicalKind: 'code', canonicalOrdinal: 9, startLine: 22, anchorText: '```',
    })
    expect(byLine.element).toBe(world.fences[2])
    expect(byLine.strategy).toBe('SOURCE_LINE_CANONICAL_CODE_TARGET')
    // …but a data-line element of a DIFFERENT kind never binds a code boundary
    const wrongKind = internals.bindGapBoundary({
      canonicalKind: 'code', canonicalOrdinal: 9, startLine: 40, anchorText: '```',
    })
    expect(wrongKind.decision).toBe('MISSING')
    expect(wrongKind.element).toBeNull()
  })

  it('§8.4 — table / formula boundaries bind through their canonical authority', () => {
    const world = makeWorld()
    const internals = world.h as unknown as Internals
    expect(internals.bindGapBoundary({
      canonicalKind: 'table', canonicalOrdinal: 0, startLine: 50, anchorText: '| a | b |',
    }).element).toBe(world.table)
    expect(internals.bindGapBoundary({
      canonicalKind: 'formula', canonicalOrdinal: 0, startLine: 60, anchorText: '$$',
    }).element).toBe(world.formula)
  })

  it('§8.3 — a text boundary keeps the existing verified ladder', () => {
    const world = makeWorld()
    const internals = world.h as unknown as Internals
    const bound = internals.bindGapBoundary({
      canonicalKind: null, canonicalOrdinal: null, startLine: 40,
      anchorText: '代码 3 Manual prefix code caption',
    })
    expect(bound.decision).toBe('BOUND')
    expect(bound.element).toBe(world.paragraph)
    expect(bound.strategy).toBe('SOURCE_LINE_VERIFIED')
  })
})

// ── §23 A/B — the painted gap band ─────────────────────────────────────────

describe('TRAE §11/§21/§23 A/B — the gap is painted BETWEEN the two canonical boundaries', () => {
  it('A: the regression gap paints a real band (never ZERO_PAINTED_RECT)', () => {
    const world = makeWorld()
    const internals = world.h as unknown as Internals
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    internals.commitBlockGapVisual(GAP_RULE_DIAG_ID, 'warning', diag, world.paragraph)

    expect(gapCarriers()).toBe(1)
    const band = document.querySelector(`.${BLOCK_GAP_VISUAL_CLASS}`) as HTMLElement
    expect(band).not.toBeNull()
    expect(band.getAttribute('data-block-gap-visual')).toBe(BLOCK_GAP_VISUAL_TARGET)
    // TRAE §22/§23 — N FILL_ONLY fragments (one per REAL rendered blank row),
    // NOT one big `[prev.bottom, next.top]` band. 3 rendered rows → 3 fragments.
    expect(document.querySelectorAll(`.${RENDERED_BLANK_ROW_FRAGMENT_CLASS}`).length).toBe(3)
    // the container covers the RENDERED row union (421 … 519), never the raw band.
    expect(Number.parseFloat(band.style.top)).toBe(421)
    expect(Number.parseFloat(band.style.height)).toBe(98)
    expect(Number.parseFloat(band.style.width)).toBeGreaterThan(0)
    // neither adjacent block is painted / highlighted
    expect(world.fences[2].hasAttribute('data-block-gap-visual')).toBe(false)
    expect(world.paragraph.className.includes('inkchapter-block-gap')).toBe(false)
  })

  it('§21 — the target audit carries the canonical boundary + geometry evidence', () => {
    const world = makeWorld()
    const internals = world.h as unknown as Internals
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    internals.commitBlockGapVisual(GAP_RULE_DIAG_ID, 'warning', diag, world.paragraph)

    const audit = readAudits(infoSpy!, BLOCK_GAP_TARGET_AUDIT_EVENT).pop()
    expect(audit).toBeDefined()
    expect(audit!.ruleId).toBe(EXCESSIVE_INTERNAL_BLANK_LINES_CODE)
    expect(audit!.presentationKind).toBe(BLOCK_GAP_VISUAL_TARGET)
    expect(audit!.previousBoundaryKind).toBe('code')
    expect(audit!.previousBoundaryCanonicalIdentity).toBe('block:code:2')
    expect(audit!.previousBindingDecision).toBe('BOUND')
    expect(audit!.previousBindingStrategy).toBe('CANONICAL_CODE_TARGET')
    expect(audit!.previousResolvedTag).toBe('pre')
    expect(audit!.nextBoundaryKind).toBe('paragraph')
    expect(audit!.nextBindingDecision).toBe('BOUND')
    expect(audit!.nextResolvedTag).toBe('p')
    expect(Number(audit!.gapHeight)).toBeGreaterThan(0)
    expect(Number(audit!.gapWidth)).toBeGreaterThan(0)
    // TRAE §19/§20/§42 — the scroll target is the RENDERED blank gap, not the next
    // paragraph. §23 — one fragment per rendered row.
    expect(audit!.scrollTargetKind).toBe(RENDERED_BLANK_GAP_SCROLL_TARGET)
    expect(Number(audit!.scrollTargetCenterY)).toBeGreaterThan(0)
    expect(audit!.markerFragmentCount).toBe('3')
    expect(audit!.fillCarrierRegistered).toBe('true')
    expect(audit!.activeFillCount).toBe('1')
    expect(audit!.visualClosureScoped).toBe('true')
    expect(audit!.currentDiagnosticActiveVisualCount).toBe('1')
    expect(audit!.decision).toBe('PASS')
  })

  it('§9 — a MISSING previous boundary paints NOTHING (never an adjacent highlight)', () => {
    const world = makeWorld()
    const internals = world.h as unknown as Internals
    const diag = gapDiag({
      metadata: {
        ...(gapDiag().metadata as Record<string, unknown>),
        previousBlockCanonicalOrdinal: 9,
        previousBlockStartLine: null,
      },
    })
    injectSnapshot(world, [diag])
    internals.commitBlockGapVisual(GAP_RULE_DIAG_ID, 'warning', diag, world.paragraph)

    expect(gapCarriers()).toBe(0)
    expect(world.fences[2].className.includes('inkchapter-block-gap')).toBe(false)
    expect(world.paragraph.className.includes('inkchapter-block-gap')).toBe(false)
    const audit = readAudits(infoSpy!, BLOCK_GAP_TARGET_AUDIT_EVENT).pop()!
    expect(audit.decision).toBe('MISSING')
    expect(audit.previousBindingDecision).toBe('MISSING')
    expect(audit.previousBindingStrategy).toBe('CANONICAL_CODE_TARGET_MISSING')
    expect(audit.reason).toContain('PREVIOUS_BOUNDARY_MISSING')
  })

  it('B: a paragraph → code gap binds the NEXT fence canonically', () => {
    const world = makeWorld()
    const internals = world.h as unknown as Internals
    const diag = gapDiag({
      metadata: {
        ...(gapDiag().metadata as Record<string, unknown>),
        previousBlockIdentity: 'paragraph:代码 3 Manual prefix code caption#0',
        previousBlockKind: 'paragraph',
        previousBlockCanonicalKind: null,
        previousBlockCanonicalOrdinal: null,
        previousBlockStartLine: 40,
        previousBlockAnchorText: '代码 3 Manual prefix code caption',
        nextBlockIdentity: 'code:```#0',
        nextBlockKind: 'code',
        nextBlockCanonicalKind: 'code',
        nextBlockCanonicalOrdinal: 0,
        nextBlockStartLine: 10,
        nextBlockAnchorText: '```',
      },
    })
    injectSnapshot(world, [diag])
    internals.commitBlockGapVisual(GAP_RULE_DIAG_ID, 'warning', diag, null)
    const audit = readAudits(infoSpy!, BLOCK_GAP_TARGET_AUDIT_EVENT).pop()!
    expect(audit.nextBindingDecision).toBe('BOUND')
    expect(audit.nextBindingStrategy).toBe('CANONICAL_CODE_TARGET')
    expect(audit.nextBoundaryCanonicalIdentity).toBe('block:code:0')
    // the fence is ABOVE the paragraph → not a gap → fail closed, nothing painted
    expect(audit.gapHeight === undefined || audit.gapHeight === '' || audit.decision === 'MISSING').toBe(true)
    expect(gapCarriers()).toBe(0)
  })
})

// ── §17 — the scoped visual closure ─────────────────────────────────────────

describe('TRAE §17 — the block-gap closure is scoped to the CURRENT diagnostic', () => {
  it('with the gap carrier present the closure is a SCOPED pass', () => {
    const world = makeWorld()
    const internals = world.h as unknown as Internals
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    internals.commitBlockGapVisual(GAP_RULE_DIAG_ID, 'warning', diag, world.paragraph)
    internals.emitVisualClosureAudit('TEST')
    const audit = readAudits(infoSpy!, 'VISUAL-CLOSURE-AUDIT').pop()
    expect(audit).toBeDefined()
    expect(audit!.visualTargetKind).toBe(BLOCK_GAP_VISUAL_TARGET)
    expect(audit!.blockGapVisualClosureScoped).toBe('true')
    expect(audit!.blockGapActiveFillCount).toBe('1')
    expect(audit!.decision).toBe('PASS')
  })

  it('with NO gap carrier the closure FAILS (never a passive-marker false PASS)', () => {
    const world = makeWorld()
    const internals = world.h as unknown as Internals
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    // no commit → the diagnostic owns no active visual
    internals.emitVisualClosureAudit('TEST')
    const audit = readAudits(infoSpy!, 'VISUAL-CLOSURE-AUDIT').pop()
    expect(audit).toBeDefined()
    expect(audit!.visualDecision).toBe('FAIL')
    expect(audit!.commitDecision).toBe('NO_COMMIT')
    expect(audit!.decision).toBe('FAIL')
    expect(audit!.blockGapVisualClosureScoped).toBe('false')
    expect(internals.getBlockGapCanonicalClosureCounters().unscopedVisualFalsePassCount).toBeGreaterThanOrEqual(1)
  })

  it('§22 — the retired carrier leaves no stale node behind', () => {
    const world = makeWorld()
    const internals = world.h as unknown as Internals
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    internals.commitBlockGapVisual(GAP_RULE_DIAG_ID, 'warning', diag, world.paragraph)
    expect(gapCarriers()).toBe(1)
    internals.removeBlockGapVisual()
    expect(gapCarriers()).toBe(0)
    expect(internals.getBlockGapCanonicalClosureCounters().staleVisualCount).toBe(0)
  })
})

// ── BLANK-GAP-VISUAL-DIFF — 同一区间 carrier 幂等复用 / 去叠加 ───────────────
//
// 失败先行：旧实现把「是否复用 carrier」判定放在 `lastBlockGapDiagnosticId`
// 被重置之后，所以同一诊断的第二次提交永远走「新建 + append」，旧 carrier
// 既不退役也无人再引用 —— 每次重提交（布局失效 / 滚动 / 侧栏拖拽）都会在同一
// 空行区间上叠加一层琥珀色背景，形成用户截图里的阶梯色带。

describe('BLANK-GAP-VISUAL-DIFF — 同一区间 carrier 幂等复用与去叠加', () => {
  const locateLayer = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-inkchapter-locate-layer="true"]')
  const paintedFragments = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>(`.${RENDERED_BLANK_ROW_FRAGMENT_CLASS}`))
  const commit = (world: World, diag: Record<string, unknown>): void => {
    const internals = world.h as unknown as Internals
    internals.commitBlockGapVisual(GAP_RULE_DIAG_ID, 'warning', diag, world.paragraph)
  }

  it('VIS-04 同一诊断重复提交：carrier / fragment / 数量标签节点身份复用且只有一份', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    commit(world, diag)
    const firstCarrier = document.querySelector<HTMLElement>(`.${BLOCK_GAP_VISUAL_CLASS}`)
    expect(firstCarrier).not.toBeNull()
    const firstFragments = paintedFragments()
    expect(firstFragments).toHaveLength(3)

    commit(world, diag)

    // 去叠加：同一区间只允许一个 carrier（旧实现会留下 2 个）。
    expect(gapCarriers()).toBe(1)
    expect(document.querySelector<HTMLElement>(`.${BLOCK_GAP_VISUAL_CLASS}`)).toBe(firstCarrier)
    // 幂等：片段节点原地复用，不新增、不重排。
    expect(paintedFragments()).toEqual(firstFragments)
    // 数量标签也只有一份。
    expect(document.querySelectorAll('.inkchapter-blank-run-count')).toHaveLength(1)
  })

  it('VIS-02 连续 20 次同诊断提交：carrier 数恒为 1，片段数不随提交次数增长', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    for (let i = 0; i < 20; i++) commit(world, diag)
    expect(gapCarriers()).toBe(1)
    expect(paintedFragments()).toHaveLength(3)
    expect(document.querySelectorAll('.inkchapter-blank-run-count')).toHaveLength(1)
    // 单层填充：整个定位层里只有 ONE 个带琥珀背景的 carrier 容器。
    const layer = locateLayer()
    expect(layer).not.toBeNull()
    expect(layer!.querySelectorAll(`.inkchapter-block-gap-fragments`)).toHaveLength(1)
  })

  it('VIS-06 上一轮泄漏的旧 carrier 会在下一次提交时退役，active-gap-group 不受影响', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    commit(world, diag)
    const layer = locateLayer()
    expect(layer).not.toBeNull()

    const stale = document.createElement('div')
    stale.className = `${BLOCK_GAP_VISUAL_CLASS} inkchapter-block-gap-fragments`
    stale.setAttribute('data-block-gap-visual', BLOCK_GAP_VISUAL_TARGET)
    stale.setAttribute('data-block-gap-owner', 'stale-owner:old-revision')
    layer!.appendChild(stale)

    const group = document.createElement('div')
    group.className = `${BLOCK_GAP_VISUAL_CLASS} inkchapter-block-gap-fragments`
    group.setAttribute('data-block-gap-visual', 'active-gap-group')
    layer!.appendChild(group)

    commit(world, diag)

    // 旧 revision 的孤儿载体被清理（owner token 校验），组载体属于别的所有者，保留。
    expect(stale.isConnected).toBe(false)
    expect(group.isConnected).toBe(true)
    expect(gapCarriers()).toBe(2)
  })

  it('MUT-01 可见空行 3→1：复用同一 carrier，多余 fragment 立即退役', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    commit(world, diag)
    const carrier = document.querySelector<HTMLElement>(`.${BLOCK_GAP_VISUAL_CLASS}`)
    expect(paintedFragments()).toHaveLength(3)

    blankRows[2].remove()
    blankRows[1].remove()
    commit(world, diag)

    expect(gapCarriers()).toBe(1)
    expect(document.querySelector<HTMLElement>(`.${BLOCK_GAP_VISUAL_CLASS}`)).toBe(carrier)
    expect(paintedFragments()).toHaveLength(1)
    expect(carrier!.querySelectorAll(`.${RENDERED_BLANK_ROW_FRAGMENT_CLASS}`)).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-blank-run-count')).toHaveLength(1)
  })

  it('MUT-02 可见空行全部移除：旧违规视觉在同一提交内消失（不保留旧 revision 几何）', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    commit(world, diag)
    expect(gapCarriers()).toBe(1)

    for (const row of blankRows) row.remove()
    commit(world, diag)

    expect(gapCarriers()).toBe(0)
    expect(paintedFragments()).toHaveLength(0)
    expect(document.querySelectorAll('.inkchapter-blank-run-count')).toHaveLength(0)
  })
})

// ── REALTIME — 结构 Mutation 后的局部视觉快速 patch ─────────────────────────
//
// 失败先行：本节要求存在一个「不等待正式诊断重算、直接用当前 DOM 测量并原位
// patch 活动 carrier」的入口。修复前宿主没有该方法（调用即 TypeError），
// 且视觉只能在诊断快照提交后才更新。

describe('REALTIME — GAP_EXPAND / GAP_SHRINK 局部视觉先于正式诊断', () => {
  const carriers = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>(`[data-block-gap-visual="${BLOCK_GAP_VISUAL_TARGET}"]`))
  const fragments = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>(`.${RENDERED_BLANK_ROW_FRAGMENT_CLASS}`))
  const patch = (world: World): boolean =>
    (world.h as unknown as Internals).patchActiveGapVisualFromDom()
  const activate = (world: World, diag: Record<string, unknown>): void => {
    const internals = world.h as unknown as Internals
    internals.commitBlockGapVisual(GAP_RULE_DIAG_ID, 'warning', diag, world.paragraph)
    // REALTIME V2 §4.1 — 快速 patch 只由真实 ACTIVE owner 授权。
    internals.diagnosticInteractionState = {
      version: 1,
      phase: 'ACTIVE',
      diagnosticId: GAP_RULE_DIAG_ID,
      targetKey: 'doc:gap::gap#0',
      diagnosticTargetIndex: 0,
      transactionLocalTargetIndex: 0,
      transactionId: 1,
      leaseToken: 'lease-1',
    }
  }
  const blankRow = (top: number, bottom: number, line: string): HTMLElement => {
    const row = document.createElement('p')
    row.className = 'md-p md-end-block'
    row.setAttribute('data-line', line)
    stubRect(row, () => ({ left: 60, top, right: 700, bottom }))
    return row
  }

  it('FAST-EXPAND 新增一个可见空行：复用同一 carrier，只补差额片段', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    activate(world, diag)
    const carrier = carriers()[0]
    expect(fragments()).toHaveLength(3)

    const row = blankRow(519, 552, '25')
    world.write.insertBefore(row, world.paragraph)
    blankRows.push(row)
    stubRect(world.paragraph, () => ({ left: 60, top: 560, right: 700, bottom: 584 }))

    expect(patch(world)).toBe(true)
    expect(carriers()).toHaveLength(1)
    expect(carriers()[0]).toBe(carrier)
    expect(fragments()).toHaveLength(4)
    expect(document.querySelectorAll('.inkchapter-blank-run-count')).toHaveLength(1)
  })

  it('FAST-SHRINK 删除一个可见空行：原位收缩，片段立即退役', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    activate(world, diag)
    const carrier = carriers()[0]

    blankRows[2].remove()
    blankRows.length = 2

    expect(patch(world)).toBe(true)
    expect(carriers()).toHaveLength(1)
    expect(carriers()[0]).toBe(carrier)
    expect(fragments()).toHaveLength(2)
  })

  it('FAST-CAPTION 插件图题位于边界之间：仍可局部 patch（不得误判为正文拆分）', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    activate(world, diag)
    const carrier = carriers()[0]
    // 真实 Case B DOM：上一块 → 插件图题 → 2 个空段落 → 标题。图题没有
    // `data-inkchapter-ui-root` 等属性，旧实现把它当成「用户正文」而放弃快速 patch。
    const caption = document.createElement('div')
    caption.className = 'inkchapter-caption inkchapter-caption-figure'
    caption.setAttribute('contenteditable', 'false')
    caption.textContent = '图 1 缺失图片诊断目标'
    stubRect(caption, () => ({ left: 60, top: 421, right: 700, bottom: 447 }))
    world.write.insertBefore(caption, blankRows[0])

    expect(patch(world)).toBe(true)
    expect(carriers()).toHaveLength(1)
    expect(carriers()[0]).toBe(carrier)
    expect(fragments()).toHaveLength(3)
  })

  it('FAST-SPLIT 中间插入正文：不误涂（返回 false，交给正式 SPLIT 路径）', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    activate(world, diag)
    const carrier = carriers()[0]
    const before = fragments().length

    const text = document.createElement('p')
    text.className = 'md-end-block md-p'
    text.setAttribute('data-line', '21')
    text.textContent = '中间正文 a'
    stubRect(text, () => ({ left: 60, top: 420, right: 700, bottom: 452 }))
    world.write.insertBefore(text, blankRows[0])

    expect(patch(world)).toBe(false)
    // 局部路径不越权：载体与片段保持不变，等待正式诊断决定拆分
    expect(carriers()).toHaveLength(1)
    expect(carriers()[0]).toBe(carrier)
    expect(fragments()).toHaveLength(before)
  })

  it('FAST-GUARD 边界失联：不绘制、不删除现有载体', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    activate(world, diag)
    const carrier = carriers()[0]

    world.fences[2].remove()

    expect(patch(world)).toBe(false)
    expect(carriers()).toHaveLength(1)
    expect(carriers()[0]).toBe(carrier)
  })

  it('FAST-IDEMPOTENT 连续两次 patch：节点身份与样式不变', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    activate(world, diag)
    const carrier = carriers()[0]
    const style = carrier.style.cssText

    expect(patch(world)).toBe(true)
    expect(patch(world)).toBe(true)
    expect(carriers()[0]).toBe(carrier)
    expect(carrier.style.cssText).toBe(style)
    expect(fragments()).toHaveLength(3)
  })

  it('FAST-ACT-OWNER phase=IDLE 时拒绝快速 patch（历史绘制 id 不得复活激活）', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    activate(world, diag)
    const internals = world.h as unknown as Internals
    // 交互层已回到 IDLE（例如刚被取消 / 事务回滚），载体与 lastBlockGapDiagnosticId
    // 仍短暂存在。历史绘制 id 不能单独授权新的快速绘制。
    internals.diagnosticInteractionState = {
      version: 2,
      phase: 'IDLE',
      diagnosticId: null,
      targetKey: null,
      diagnosticTargetIndex: null,
      transactionLocalTargetIndex: null,
      transactionId: null,
      leaseToken: null,
    }
    const before = fragments().length
    expect(patch(world)).toBe(false)
    expect(fragments()).toHaveLength(before)
    expect(carriers()).toHaveLength(1)
  })

  it('PERF-A 占据扫描只覆盖边界邻域，不扫描全文档', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    activate(world, diag)
    // 与 gap 无关的大量正文块（真实文档形状）。
    for (let i = 0; i < 120; i++) {
      const p = document.createElement('p')
      p.className = 'md-end-block md-p'
      p.setAttribute('data-line', String(100 + i))
      p.textContent = `无关正文 ${i}`
      stubRect(p, () => ({ left: 60, top: 800 + i * 12, right: 700, bottom: 810 + i * 12 }))
      world.write.appendChild(p)
    }
    expect(patch(world)).toBe(true)
    const count = (world.h as unknown as Internals).lastOccupancyCandidateCount
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(40)
  })

  it('PERF-B 布局未变时复用绘制层校准（不再每键插入探针）', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    activate(world, diag)
    expect(patch(world)).toBe(true)
    expect(patch(world)).toBe(true)
    expect((world.h as unknown as Internals).lastCalibrationReused).toBe(true)
  })

  it('PERF-C 快速通道使用静默审计（详细几何审计留给正式诊断）', () => {
    const world = makeWorld()
    const diag = gapDiag()
    injectSnapshot(world, [diag])
    activate(world, diag)
    expect(patch(world)).toBe(true)
    expect((world.h as unknown as Internals).lastCommitAuditQuiet).toBe(true)
  })
})
