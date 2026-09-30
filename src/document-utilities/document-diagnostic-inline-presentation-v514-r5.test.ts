// @vitest-environment jsdom
/**
 * V5.14-R5 — Diagnostic INLINE reason chip compression & semantic presentation.
 *
 * Covers the V5.14-R5 prompt:
 *  §3/§4/§5/§6/§17  the deterministic DiagnosticCode -> inlineHint authority
 *  §7/§21           text safety (no severity prefix / emoji / advice sentence)
 *  §8               the Drawer keeps the FULL explanation
 *  §10/§11/§22      the chip is sized by the RENDERED width of the short hint
 *  §12/§13/§19      decoration-only + no Outline annotation + the 12 hard gates
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  DOCUMENT_DIAGNOSTIC_INLINE_PRESENTATION_AUDIT_EVENT,
  INLINE_CHIP_MAX_WIDTH_PX_V514R5,
  INLINE_HINT_FORBIDDEN_TOKENS_V514R5,
  INLINE_PRESENTATION_V514R5_GATE_KEYS,
  INLINE_PRESENTATION_V514R5_GATE_LABELS,
  buildDiagnosticPresentation,
  buildHeadingGapInlineHint,
  computeInlineChipWidthPx,
  createInlinePresentationV514R5Counters,
  evaluateInlineChipGeometry,
  evaluateInlinePresentationV514R5Gates,
  formatInlinePresentationV514R5GateReport,
  inlineHintCategoryForCode,
  inlineHintHasSeverityEmoji,
  inlineHintHasSeverityPrefix,
  inlineHintIsSafe,
  resolveInlineHint,
} from './document-diagnostic-inline-presentation-v514-r5'

// ── §4/§5/§6/§17 — the mapping contract ─────────────────────────────────────

describe('V5.14-R5 §4 — the strict H1 / heading inline phrases', () => {
  it('STRICT body-before-H1 becomes "H1 前有正文" (the runtime screenshot case)', () => {
    // the REAL diagnostic: code `STRICT_FIRST_H1_LEADING_PARAGRAPH`, message is a
    // multi-line sentence starting with the severity glyph.
    const presentation = buildDiagnosticPresentation({
      code: 'STRICT_FIRST_H1_LEADING_PARAGRAPH',
      severity: 'error',
      message: '⚠ 严格模式结构错误：文档必须以一级标题开始\nH1 前存在正文内容',
    })
    expect(presentation.inlineHint).toBe('H1 前有正文')
    expect(presentation.inlineHintSource).toBe('MAPPED')
    // §7 — never the severity glyph, never the classification sentence
    expect(inlineHintHasSeverityPrefix(presentation.inlineHint)).toBe(false)
    expect(inlineHintHasSeverityEmoji(presentation.inlineHint)).toBe(false)
    expect(presentation.inlineHint).not.toContain('严格模式结构错误')
    expect(presentation.inlineHint).not.toContain('文档必须')
    // §8 — the Drawer keeps the FULL explanation
    expect(presentation.drawerTitle).toBe('H1 前存在正文')
    expect(presentation.drawerDetail).toContain('严格模式结构错误')
    expect(presentation.drawerDetail).toContain('H1 前存在正文内容')
    expect(presentation.drawerDetail).not.toContain('\n')
  })

  it('missing / multiple H1 + duplicate heading + latent ATX + H1-not-first', () => {
    expect(resolveInlineHint({ code: 'STRICT_SINGLE_H1_NO_H1' }).hint).toBe('缺少 H1')
    expect(resolveInlineHint({ code: 'STRICT_FIRST_H1_DOCUMENT_EMPTY' }).hint).toBe('缺少 H1')
    expect(resolveInlineHint({ code: 'STRICT_SINGLE_H1_MULTIPLE_H1' }).hint).toBe('多余 H1')
    expect(resolveInlineHint({ code: 'HEADING_DUPLICATE_TEXT' }).hint).toBe('重复标题')
    expect(resolveInlineHint({ code: 'HEADING_EMPTY_TEXT' }).hint).toBe('空标题')
    expect(resolveInlineHint({ code: 'LATENT_ATX_HEADING_MARKER_LEVEL_2' }).hint).toBe('潜在标题标记')
    expect(resolveInlineHint({ code: 'STRICT_FIRST_H1_LEADING_OTHER_HEADING' }).hint).toBe('H1 非首项')
    expect(resolveInlineHint({ code: 'X', metadata: { reason: 'H1_NOT_FIRST' } }).hint).toBe('H1 非首项')
  })

  it('the other strict top-line states stay short and distinct', () => {
    expect(resolveInlineHint({ code: 'STRICT_FIRST_H1_LEADING_EMPTY_LINE' }).hint).toBe('H1 前有空行')
    expect(resolveInlineHint({ code: 'STRICT_FIRST_H1_LEADING_OTHER_BLOCK' }).hint).toBe('H1 前有其他内容')
    expect(resolveInlineHint({ code: 'STRICT_FIRST_H1_SOURCE_UNAVAILABLE' }).hint).toBe('无法校验 H1')
  })
})

describe('V5.14-R5 §6 — the DYNAMIC heading-gap phrase keeps the critical facts', () => {
  it('previous=H3 current=H5 missing=[H4] → "H3 → H5 · 缺 H4"', () => {
    expect(buildHeadingGapInlineHint({ previousLevel: 3, currentLevel: 5, missingLevels: [4] })).toBe('H3 → H5 · 缺 H4')
    expect(resolveInlineHint({
      code: 'HEADING_LEVEL_GAP',
      metadata: { previousLevel: 3, currentLevel: 5, missingLevels: [4] },
    })).toEqual({ hint: 'H3 → H5 · 缺 H4', source: 'DYNAMIC' })
    // no missing level → still the two levels (never the sentence)
    expect(buildHeadingGapInlineHint({ previousLevel: 2, currentLevel: 4, missingLevels: [] })).toBe('H2 → H4')
    // the arrow is NOT treated as a severity emoji
    expect(inlineHintHasSeverityEmoji('H3 → H5 · 缺 H4')).toBe(false)
    expect(inlineHintIsSafe('H3 → H5 · 缺 H4')).toBe(true)
  })
})

describe('V5.14-R5 §5 — the object / resource / document-end phrases', () => {
  it('are mapped from their real codes', () => {
    expect(resolveInlineHint({ code: 'TABLE_MISSING_NAME' }).hint).toBe('缺少表名')
    expect(resolveInlineHint({ code: 'CODE_MISSING_NAME' }).hint).toBe('缺少代码名')
    expect(resolveInlineHint({ code: 'CODE_MISSING_LANGUAGE' }).hint).toBe('缺少代码语言')
    expect(resolveInlineHint({ code: 'FIGURE_MISSING_NAME' }).hint).toBe('缺少图名')
    expect(resolveInlineHint({ code: 'FIGURE_LOCAL_IMAGE_MISSING' }).hint).toBe('图片不存在')
    expect(resolveInlineHint({ code: 'LINK_LOCAL_TARGET_MISSING' }).hint).toBe('链接不存在')
    expect(resolveInlineHint({ code: 'DOCUMENT_TERMINAL_NEWLINE_MISSING' }).hint).toBe('末尾缺少换行')
    expect(resolveInlineHint({ code: 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE' }).hint).toBe('尾部空行过多')
    // every one of them is MAPPED (never the message fallback)
    for (const code of ['TABLE_MISSING_NAME', 'CODE_MISSING_NAME', 'FIGURE_MISSING_NAME', 'FIGURE_LOCAL_IMAGE_MISSING']) {
      expect(resolveInlineHint({ code, message: 'x'.repeat(120) }).source).toBe('MAPPED')
    }
  })
})

describe('V5.14-R5 §17/§21 — fallback + text safety', () => {
  it('an unmapped code gets a stable CATEGORY label, never the message', () => {
    expect(resolveInlineHint({ code: 'SOME_NEW_HEADING_RULE', category: 'heading' }))
      .toEqual({ hint: '标题问题', source: 'CATEGORY_FALLBACK' })
    expect(resolveInlineHint({ code: 'SOME_NEW_TABLE_RULE', category: 'table' }).hint).toBe('资源问题')
    expect(resolveInlineHint({ code: 'SOME_NEW_DOC_RULE', category: 'document' }).hint).toBe('结构问题')
    expect(inlineHintCategoryForCode('TOTALLY_UNKNOWN')).toBe('文档问题')
  })

  it('NO known hint carries a severity prefix / emoji / newline / advice sentence', () => {
    const hints = [
      'H1 前有正文', 'H1 前有空行', 'H1 前有空段落', 'H1 非首项', 'H1 前有其他内容', '缺少 H1', '无法校验 H1',
      '多余 H1', '重复标题', '重复标题身份', '空标题', '潜在标题标记', 'H3 → H5 · 缺 H4',
      '缺少表名', '重复表名', '缺少代码名', '缺少代码语言', '重复代码名', '缺少图名', '重复图名',
      '图片不存在', '重复公式编号', '链接不存在', '末尾缺少换行', '尾部空行过多', '无活动文档',
      '标题问题', '资源问题', '结构问题', '文档问题',
    ]
    for (const hint of hints) {
      expect(inlineHintIsSafe(hint), hint).toBe(true)
      expect(inlineHintHasSeverityPrefix(hint), hint).toBe(false)
      expect(inlineHintHasSeverityEmoji(hint), hint).toBe(false)
      expect(/[\r\n]/.test(hint), hint).toBe(false)
      for (const token of INLINE_HINT_FORBIDDEN_TOKENS_V514R5) {
        expect(hint.includes(token), `${hint} must not contain ${token}`).toBe(false)
      }
    }
  })

  it('the FULL strict message is explicitly rejected as an inline hint', () => {
    const full = '⚠ 严格模式结构错误：文档必须以一级标题开始\nH1 前存在正文内容'
    expect(inlineHintIsSafe(full)).toBe(false)
    expect(inlineHintHasSeverityPrefix(full)).toBe(true)
    expect(inlineHintHasSeverityEmoji(full)).toBe(true)
    expect(inlineHintIsSafe('错误：正文')).toBe(false)
    expect(inlineHintIsSafe('当前检测到 2 个 H1')).toBe(false)
  })
})

describe('V5.14-R5 §9/§10 — the chip width budget', () => {
  it('is intrinsic to the SHORT text and clamped only as a fallback', () => {
    const short = computeInlineChipWidthPx('H1 前有正文')
    const longMessage = computeInlineChipWidthPx('⚠ 严格模式结构错误：文档必须以一级标题开始 H1 前存在正文内容')
    expect(short).toBeLessThan(longMessage)
    // 3 latin/space advances (7px) + 4 CJK advances (13px) + 2 × 7px padding
    expect(short).toBe(3 * 7 + 4 * 13 + 14)
    expect(longMessage).toBeLessThanOrEqual(INLINE_CHIP_MAX_WIDTH_PX_V514R5)
    const loose = evaluateInlineChipGeometry({ hint: 'H1 前有正文', renderedWidthPx: short })
    expect(loose.clamped).toBe(false)
    expect(loose.intrinsicWidthPx).toBe(short)
    expect(loose.shrank).toBe(false)
    // §22 — old long → new short
    const shrank = evaluateInlineChipGeometry({
      hint: 'H1 前有正文',
      renderedWidthPx: short,
      previousRenderedWidthPx: longMessage,
    })
    expect(shrank.shrank).toBe(true)
  })
})

describe('V5.14-R5 §19 — the 12 inline-presentation hard gates', () => {
  it('are declared, complete and 0 on a clean surface', () => {
    const counters = createInlinePresentationV514R5Counters()
    expect(INLINE_PRESENTATION_V514R5_GATE_KEYS).toHaveLength(12)
    expect(formatInlinePresentationV514R5GateReport(counters)).toHaveLength(12)
    expect(evaluateInlinePresentationV514R5Gates(counters).decision).toBe('PASS')
    expect(INLINE_PRESENTATION_V514R5_GATE_LABELS.outlineReasonChip).toBe('OUTLINE_REASON_CHIP_COUNT')
    expect(INLINE_PRESENTATION_V514R5_GATE_LABELS.inlineReasonUsesFullDiagnosticMessage)
      .toBe('INLINE_REASON_USES_FULL_DIAGNOSTIC_MESSAGE_COUNT')
    const dirty = createInlinePresentationV514R5Counters()
    dirty.inlineReasonContainsSeverityPrefix = 1
    expect(evaluateInlinePresentationV514R5Gates(dirty).decision).toBe('FAIL')
  })
})

// ── host wiring (jsdom) ─────────────────────────────────────────────────────

function stubRaf(): void {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 1 }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => { /* noop */ }
}
type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}
/**
 * §10 — a minimal jsdom "layout": the reason chip's width is a deterministic
 * function of its text, clamped by the R5 max-width. Without this, jsdom returns
 * a zero rect and the rendered-width contract could not be exercised.
 */
function stubChipLayout(): void {
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (this: Element) {
      const cls = typeof this.className === 'string' ? this.className : ''
      if (cls.includes('inkchapter-heading-diagnostic-reason')) {
        const text = this.textContent ?? ''
        const raw = CHIP_EMULATED_PADDING_PX + text.length * CHIP_EMULATED_PER_CHAR_PX
        const w = Math.min(INLINE_CHIP_MAX_WIDTH_PX_V514R5, raw)
        return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: 20, width: w, height: 20, toJSON: () => ({}) }
      }
      return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }
    },
  })
}
/** The emulated jsdom text advance (only for the chip rect-width contract). */
const CHIP_EMULATED_PER_CHAR_PX = 8
const CHIP_EMULATED_PADDING_PX = 14
function stubRangeRects(rects: Rect[]): void {
  const fake = {
    setStart(): void { /* noop */ },
    setEnd(): void { /* noop */ },
    getClientRects: () => rects.map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top })),
  }
  ;(document as unknown as { createRange: () => unknown }).createRange = () => fake
}
function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# t',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  } as unknown as DocumentUtilitiesContext
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
    getHeadingIdentity: (el) => el.getAttribute('data-id'),
    parseLocalLinkTargets: () => [],
    getObjectCaptionHost: () => null,
  }
}

type HostApi = {
  renderHeadingDiagnosticMarkers(skipActiveEmphasis?: boolean): void
  renderDrawingIfNeeded?: () => void
  getInlinePresentationV514R5Counters(): Record<string, number>
  getInlinePresentationV514R5GateReport(): string[]
  getInlinePresentationV514R5GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
  getInlineChipRebuiltAfterHintChange(): boolean
  getVisualGeometrySnapshot(identity: string): { reasonChipRect: { left: number; right: number; width: number } | null } | null
}
let host: DocumentUtilityOverlayHost | null = null
let infoSpy: { mockRestore: () => void } | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  stubChipLayout()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  stubRangeRects([{ left: 100, top: 204, right: 420, bottom: 228 }])
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as { mockRestore: () => void }
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

function makeWorld(headingCount = 1): { h: DocumentUtilityOverlayHost; headings: HTMLElement[] } {
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  stubRect(write, () => ({ left: 0, top: 0, right: 900, bottom: 3000 }))
  const headings: HTMLElement[] = []
  for (let i = 0; i < headingCount; i++) {
    const h = document.createElement('h2')
    h.setAttribute('data-id', `H-${String.fromCharCode(65 + i)}`)
    h.setAttribute('data-line', String(4 + i))
    h.textContent = `题目${i + 1}`
    write.appendChild(h)
    stubRect(h, () => ({ left: 100, top: 200 + i * 100, right: 1000, bottom: 232 + i * 100 }))
    headings.push(h)
  }
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, headings }
}
function diagFor(
  id: string,
  headingId: string,
  severity: string,
  code: string,
  message: string,
  metadata: Record<string, unknown> = {},
  detail?: string,
): Record<string, unknown> {
  return {
    id, documentKey: 'doc:key', severity, category: code.startsWith('TABLE_') ? 'table' : 'heading',
    code, message, detail: detail ?? '', metadata,
    location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: headingId },
  } as unknown as Record<string, unknown>
}
function inject(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>, revision = 1): void {
  const snapshot = {
    documentKey: 'doc:key', revision, sourceRevision: revision, generatedAt: 0,
    diagnostics: diags, errorCount: 1, warningCount: 0, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for the marker test */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}
const api = (): HostApi => host as unknown as HostApi
const chipText = (): string => (document.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement | null)?.textContent ?? ''
const chipStyleWidthClamp = (): string => (document.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement | null)?.style.maxWidth ?? ''
/** Read the DOCUMENT-DIAGNOSTIC-INLINE-PRESENTATION-AUDIT console lines. */
const readInlineAudits = (): Array<{ fields: Record<string, string>; raw: string }> => {
  const spy = infoSpy as unknown as { mock: { calls: unknown[][] } }
  const out: Array<{ fields: Record<string, string>; raw: string }> = []
  for (const call of spy.mock.calls) {
    const line = String(call[0] ?? '')
    if (!line.includes(DOCUMENT_DIAGNOSTIC_INLINE_PRESENTATION_AUDIT_EVENT)) continue
    const idx = line.indexOf(`${DOCUMENT_DIAGNOSTIC_INLINE_PRESENTATION_AUDIT_EVENT}: `)
    const body = idx >= 0 ? line.slice(idx + DOCUMENT_DIAGNOSTIC_INLINE_PRESENTATION_AUDIT_EVENT.length + 2) : line
    const fields: Record<string, string> = {}
    for (const m of body.matchAll(/(\w+)=([^\s]*)/g)) fields[m[1]] = m[2]
    out.push({ fields, raw: body })
  }
  return out
}

describe('V5.14-R5 §3/§7/§12/§18 — the in-body chip (host wiring)', () => {
  it('the strict body-before-H1 diagnostic shows the SHORT hint, never the sentence', () => {
    const w = makeWorld(1)
    host = w.h
    inject(host, [diagFor('E1', 'H-A', 'error', 'STRICT_FIRST_H1_LEADING_PARAGRAPH',
      '⚠ 严格模式结构错误：文档必须以一级标题开始\nH1 前存在正文内容')])
    api().renderHeadingDiagnosticMarkers()
    expect(chipText()).toBe('H1 前有正文')
    expect(chipText()).not.toContain('⚠')
    expect(chipText()).not.toContain('严格模式结构错误')
    expect(chipText()).not.toContain('\n')
    // §9 — max-width is only the fallback clamp
    expect(chipStyleWidthClamp()).toBe(`${INLINE_CHIP_MAX_WIDTH_PX_V514R5}px`)
    // §12 — the heading itself is untouched
    expect(w.headings[0].textContent).toBe('题目1')
    expect(w.headings[0].hasAttribute('data-inkchapter-heading-number')).toBe(false)
    const counters = api().getInlinePresentationV514R5Counters()
    expect(counters.inlinePresentationMutatedHeadingText).toBe(0)
    expect(counters.inlinePresentationMutatedHeadingNumber).toBe(0)
    expect(counters.inlineReasonUsesFullDiagnosticMessage).toBe(0)
    expect(counters.inlineReasonContainsSeverityPrefix).toBe(0)
    expect(counters.inlineReasonContainsSeverityEmoji).toBe(0)
    expect(counters.knownDiagnosticWithoutInlineHintMapping).toBe(0)
    expect(counters.outlineReasonChip).toBe(0)
    expect(api().getInlinePresentationV514R5GateDecision().decision).toBe('PASS')
  })

  it('§18 — the runtime audit carries the full presentation facts', () => {
    const w = makeWorld(1)
    host = w.h
    inject(host, [diagFor('E1', 'H-A', 'error', 'STRICT_FIRST_H1_LEADING_PARAGRAPH',
      '⚠ 严格模式结构错误：文档必须以一级标题开始\nH1 前存在正文内容')])
    api().renderHeadingDiagnosticMarkers()
    const { fields: audit, raw } = readInlineAudits().pop()!
    expect(audit.diagnosticCode).toBe('STRICT_FIRST_H1_LEADING_PARAGRAPH')
    // (the formatted console line separates fields by a single space, so values
    //  that contain spaces are asserted against the RAW line)
    expect(raw).toContain('inlineHint=H1 前有正文')
    expect(raw).toContain('inlineHintLength=7')
    expect(raw).toContain('drawerTitle=H1 前存在正文')
    expect(audit.inlineHintSource).toBe('MAPPED')
    expect(audit.containsSeverityPrefix).toBe('false')
    expect(audit.containsSeverityEmoji).toBe('false')
    expect(audit.fallbackUsed).toBe('false')
    expect(audit.drawerDetailPresent).toBe('true')
    expect(audit.decision).toBe('PASS')
    expect(audit.reason).toBe('INLINE_HINT_FROM_DIAGNOSTIC_CODE')
    // §10/§11 — the CHIP RECT follows the rendered width, not an estimate
    expect(Number(audit.chipRenderedWidth)).toBeGreaterThan(0)
    expect(Number(audit.chipRenderedWidth)).toBeLessThanOrEqual(INLINE_CHIP_MAX_WIDTH_PX_V514R5)
    expect(audit.chipClamped).toBe('false')
  })

  it('§10/§11/§22 — the chip rect is re-measured when the label changes (long → short)', () => {
    const w = makeWorld(1)
    host = w.h
    // a long DYNAMIC label first
    inject(host, [diagFor('E1', 'H-A', 'error', 'HEADING_LEVEL_GAP', '标题层级存在跳级（H1 → H6）', {
      previousLevel: 1, currentLevel: 6, missingLevels: [2, 3, 4, 5],
    })])
    api().renderHeadingDiagnosticMarkers()
    const longHint = chipText()
    expect(longHint).toBe('H1 → H6 · 缺 H2、H3、H4、H5')
    const longWidth = document.querySelector('.inkchapter-heading-diagnostic-reason')!.getBoundingClientRect().width
    const identity = (document.querySelector('.inkchapter-heading-diagnostic-marker') as HTMLElement).getAttribute('data-ink-stable-identity')!
    const longRect = api().getVisualGeometrySnapshot(identity)!.reasonChipRect!
    expect(longRect.width).toBeCloseTo(
      Math.min(INLINE_CHIP_MAX_WIDTH_PX_V514R5, CHIP_EMULATED_PADDING_PX + longHint.length * CHIP_EMULATED_PER_CHAR_PX), 0)

    // now the SAME target gets a short label
    inject(host, [diagFor('E1', 'H-A', 'error', 'HEADING_DUPLICATE_TEXT', '重复的标题文字「题目1」')], 2)
    api().renderHeadingDiagnosticMarkers()
    expect(chipText()).toBe('重复标题')
    const shortWidth = document.querySelector('.inkchapter-heading-diagnostic-reason')!.getBoundingClientRect().width
    expect(shortWidth).toBeLessThan(longWidth)
    const shortRect = api().getVisualGeometrySnapshot(identity)!.reasonChipRect!
    // §11/§22 — `right` was recomputed from the NEW short text (no stale tail)
    expect(shortRect.width).toBeCloseTo(CHIP_EMULATED_PADDING_PX + '重复标题'.length * CHIP_EMULATED_PER_CHAR_PX, 0)
    expect(shortRect.right).toBeCloseTo(shortRect.left + shortRect.width, 3)
    expect(api().getInlineChipRebuiltAfterHintChange()).toBe(true)
    expect(api().getInlinePresentationV514R5Counters().inlineReasonStaleWidthAfterLabelChange).toBe(0)
    expect(api().getInlinePresentationV514R5Counters().inlineReasonFixedWidth).toBe(0)
  })

  it('§8 — the Drawer keeps the FULL explanation (never the 4~10 char inline hint)', () => {
    const w = makeWorld(1)
    host = w.h
    inject(host, [diagFor('E1', 'H-A', 'error', 'STRICT_FIRST_H1_LEADING_PARAGRAPH',
      '⚠ 严格模式结构错误：文档必须以一级标题开始\nH1 前存在正文内容')])
    const h = host as unknown as { renderDrawer(): void }
    h.renderDrawer()
    const item = document.querySelector('.inkchapter-doc-drawer__item') as HTMLElement | null
    expect(item).not.toBeNull()
    // a CONCISE problem name (not the severity sentence)
    expect(item!.querySelector('.inkchapter-doc-drawer__item-msg')!.textContent).toBe('H1 前存在正文')
    // the FULL explanation is still present
    const detail = item!.querySelector('.inkchapter-doc-drawer__item-detail')
    expect(detail).not.toBeNull()
    expect(detail!.textContent).toContain('严格模式结构错误')
    expect(detail!.textContent).toContain('H1 前存在正文内容')
    expect((detail!.textContent ?? '').length).toBeGreaterThan(10)
  })

  it('§13 — the left OUTLINE projection carries NO annotation text', () => {
    const w = makeWorld(1)
    host = w.h
    const published: Array<Record<string, unknown>> = []
    ;(host as unknown as { opts: { providers: Record<string, unknown> } }).opts.providers.publishOutlineHeadingDiagnostics =
      (targets: Array<Record<string, unknown>>) => { published.push(...targets) }
    inject(host, [diagFor('E1', 'H-A', 'error', 'STRICT_FIRST_H1_LEADING_PARAGRAPH', '⚠ 严格模式结构错误：文档必须以一级标题开始\nH1 前存在正文内容')])
    api().renderHeadingDiagnosticMarkers()
    expect(published.length).toBeGreaterThan(0)
    for (const t of published) {
      expect(Object.keys(t)).not.toContain('inlineHint')
      expect(Object.keys(t)).not.toContain('reasonText')
      expect(Object.keys(t)).not.toContain('message')
      expect(Object.keys(t)).not.toContain('label')
    }
    expect(api().getInlinePresentationV514R5Counters().outlineReasonChip).toBe(0)
  })
})
