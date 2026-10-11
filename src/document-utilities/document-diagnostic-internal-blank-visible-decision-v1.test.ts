// @vitest-environment jsdom
/**
 * LIVE-UPDATE CLOSURE — `EXCESSIVE_INTERNAL_BLANK_LINES` VISIBLE-based DECISION.
 *
 * ROOT CAUSE: the rule was published straight from the SOURCE blank-line count, so
 * a document whose N source blank lines Typora renders as a SINGLE visible blank
 * line (source=4 / visible=1) was wrongly warned.
 *
 * This suite proves the ONE publication decision:
 *   · source=4 / visible=1 → 0 diagnostics (dropped from the snapshot + counts);
 *   · source=4 / visible=2 → exactly ONE warning, count = visible (2, not 4);
 *   · visible 2 ↔ 1 flips the diagnostic live (add / remove) with Active cleanup;
 *   · the data source follows the editing mode (WYSIWYG vs source) and a mode
 *     switch re-evaluates without reusing the other mode's result;
 *   · an unmeasurable visible count is NEVER guessed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  INTERNAL_BLANK_DECISION_GATE_KEYS,
  createInternalBlankDecisionGates,
  decideInternalBlankPublication,
  detectDocumentEditingMode,
  evaluateInternalBlankDecisionGates,
  internalBlankLineVisibleDetail,
} from './document-diagnostic-internal-blank-decision-v1'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

const CODE = 'EXCESSIVE_INTERNAL_BLANK_LINES'
const BLANK_ID = `document:${CODE}:blank-gap:paragraph:正文一。#0>>paragraph:正文二。#0`
const TARGET = 'blank-gap:paragraph:正文一。#0>>paragraph:正文二。#0'

// ── Part A — the PURE decision module ───────────────────────────────────────

describe('A — decideInternalBlankPublication：以可视空行数为判定依据', () => {
  it('WYSIWYG：visible=1 → 不发布；visible=2 → 发布且数量=可视数', () => {
    const one = decideInternalBlankPublication({
      mode: 'wysiwyg', measuredVisibleBlankLineCount: 1, sourceBlankLineCount: 4,
    })
    expect(one.publish).toBe(false)
    expect(one.displayBlankLineCount).toBeNull()
    expect(one.visibleBlankLineCount).toBe(1)

    const two = decideInternalBlankPublication({
      mode: 'wysiwyg', measuredVisibleBlankLineCount: 2, sourceBlankLineCount: 4,
    })
    expect(two.publish).toBe(true)
    expect(two.displayBlankLineCount).toBe(2)
    expect(two.visibleBlankLineCount).toBe(2)
  })

  it('WYSIWYG：source=4 / visible=0 → 不发布（源码数量不得冒充可视数量）', () => {
    const d = decideInternalBlankPublication({
      mode: 'wysiwyg', measuredVisibleBlankLineCount: 0, sourceBlankLineCount: 4,
    })
    expect(d.publish).toBe(false)
  })

  it('不可测量（visible=null）→ 不发布、不猜测可视数', () => {
    const d = decideInternalBlankPublication({
      mode: 'wysiwyg', measuredVisibleBlankLineCount: null, sourceBlankLineCount: 7,
    })
    expect(d.publish).toBe(false)
    expect(d.visibleBlankLineCount).toBeNull()
    expect(d.reason).toContain('UNMEASURABLE')
  })

  it('SOURCE 模式：源码行即可视行（source=4 → visible=4 → 发布）', () => {
    const d = decideInternalBlankPublication({
      mode: 'source', measuredVisibleBlankLineCount: null, sourceBlankLineCount: 4,
    })
    expect(d.publish).toBe(true)
    expect(d.visibleBlankLineCount).toBe(4)
    expect(d.displayBlankLineCount).toBe(4)
  })

  it('UNKNOWN 模式：不猜测、不发布', () => {
    const d = decideInternalBlankPublication({
      mode: 'unknown', measuredVisibleBlankLineCount: null, sourceBlankLineCount: 9,
    })
    expect(d.publish).toBe(false)
    expect(d.visibleBlankLineCount).toBeNull()
  })

  it('可视文案明确写「可视」，不使用源码数量', () => {
    expect(internalBlankLineVisibleDetail(2)).toContain('2 个可视连续空行')
    expect(internalBlankLineVisibleDetail(2)).not.toContain('源码')
  })

  it('门禁默认全 0 → PASS（空实现也必须是 PASS，不做伪失败）', () => {
    expect(evaluateInternalBlankDecisionGates(createInternalBlankDecisionGates()).decision).toBe('PASS')
    expect(INTERNAL_BLANK_DECISION_GATE_KEYS.length).toBeGreaterThan(0)
  })
})

describe('A2 — detectDocumentEditingMode：数据来源按模式区分', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('#write 存在 → wysiwyg', () => {
    const w = document.createElement('div'); w.id = 'write'; document.body.appendChild(w)
    expect(detectDocumentEditingMode(document)).toBe('wysiwyg')
  })

  it('body.typora-sourceview-on → source（优先于 #write）', () => {
    const w = document.createElement('div'); w.id = 'write'; document.body.appendChild(w)
    document.body.classList.add('typora-sourceview-on')
    expect(detectDocumentEditingMode(document)).toBe('source')
    document.body.classList.remove('typora-sourceview-on')
  })

  it('既无 #write 也无标记 → unknown', () => {
    expect(detectDocumentEditingMode(document)).toBe('unknown')
  })
})

// ── Part B — the host publication boundary ──────────────────────────────────

type Rect = { left: number; top: number; right: number; bottom: number }
function stubRaf(): Map<number, FrameRequestCallback> {
  const tasks = new Map<number, FrameRequestCallback>()
  let seq = 1
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
    (cb: FrameRequestCallback): number => { const id = seq++; tasks.set(id, cb); return id }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame =
    (id: number): void => { tasks.delete(id) }
  return tasks
}
async function flushRaf(tasks: Map<number, FrameRequestCallback>): Promise<void> {
  let guard = 0
  while (tasks.size > 0 && guard++ < 200) {
    const cur = Array.from(tasks.values()); tasks.clear()
    for (const cb of cur) cb(0)
    await Promise.resolve()
  }
}
function stubRect(el: Element, r: Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }),
  })
}

function fakeContext(markdown: string): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => markdown,
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

function blankDiag(sourceBlankLines: number): Record<string, unknown> {
  return {
    domain: 'document', documentKey: 'doc:key', severity: 'warning',
    id: BLANK_ID, category: 'document', code: CODE, message: '连续空行过多',
    detail: `源码中存在 ${sourceBlankLines} 个连续空行，建议压缩为 1 个空行。`,
    targetIdentity: TARGET,
    metadata: {
      actualBlankLines: sourceBlankLines, firstBlankLine: 3,
      previousBlockStartLine: 2, nextBlockStartLine: 3 + sourceBlankLines,
      previousBlockKind: 'paragraph', nextBlockKind: 'paragraph',
      nextBlockAnchorText: '正文二。', previousBlockAnchorText: '正文一。',
    },
    location: { kind: 'source-range', startLine: 3 + sourceBlankLines, startColumn: 0, rawText: '正文二。' },
  }
}
function snapshotOf(diags: Array<Record<string, unknown>>): DocumentDiagnosticsSnapshot {
  return {
    documentKey: 'doc:key', revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: diags,
    errorCount: diags.filter(d => d.severity === 'error').length,
    warningCount: diags.filter(d => d.severity === 'warning').length,
    infoCount: diags.filter(d => d.severity === 'info').length,
  } as unknown as DocumentDiagnosticsSnapshot
}

type HostInternals = {
  resolveRenderedBlankRowsForMeta(meta: Record<string, unknown>): unknown
  reconcileInternalBlankLineDiagnostics(s: unknown): DocumentDiagnosticsSnapshot | null
  reevaluateInternalBlankLineMode(): void
  lastRawAdmittedSnapshot: DocumentDiagnosticsSnapshot | null
  lastInternalBlankEditingMode: string | null
  snapshot: DocumentDiagnosticsSnapshot | null
  getInternalBlankDecisionCoverageReport(): string[]
}

let host: DocumentUtilityOverlayHost | null = null
let rafTasks = new Map<number, FrameRequestCallback>()
let infoSpy: { mockRestore: () => void } | null = null

function makeWorld(markdown: string): DocumentUtilityOverlayHost {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  stubRect(shell, { left: 0, top: 0, right: 1200, bottom: 800 })
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  stubRect(write, { left: 0, top: 0, right: 1200, bottom: 800 })
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(markdown), providers: fakeProviders() })
  h.mount()
  return h
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  rafTasks = stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as { mockRestore: () => void }
})
afterEach(() => {
  infoSpy?.mockRestore(); infoSpy = null
  host?.dispose(); host = null
  vi.unstubAllGlobals()
})

/** Stub the rendered-row measurement with an exact VISIBLE band count. */
function stubVisible(h: DocumentUtilityOverlayHost, visible: number, rendered = visible): void {
  ;(h as unknown as HostInternals).resolveRenderedBlankRowsForMeta = () => ({
    sourceBlankLineCount: 4, renderedBlankRowCount: rendered, visibleBlankLineCount: visible,
    rows: Array.from({ length: rendered }, (_, i) => ({ index: i })),
    decision: 'VERIFIED', authority: 'RENDERED_DOM_BLANK_ROWS_V1', probe: null,
  })
}

describe('B — 边界提交：可视数量决定发布（真实 host 管线）', () => {
  it('source=4 / visible=1 → 诊断数 0，且 warningCount 同步归零', () => {
    host = makeWorld('正文一。\n\n\n\n\n正文二。\n')
    stubVisible(host, 1)
    const decided = (host as unknown as HostInternals).reconcileInternalBlankLineDiagnostics(
      snapshotOf([blankDiag(4)]),
    )!
    expect(decided.diagnostics.filter(d => d.code === CODE)).toHaveLength(0)
    expect(decided.warningCount).toBe(0)
  })

  it('source=4 / visible=2 → 1 条 warning，且元数据记录可视数量与源码数量', () => {
    host = makeWorld('正文一。\n\n\n\n\n正文二。\n')
    stubVisible(host, 2)
    const decided = (host as unknown as HostInternals).reconcileInternalBlankLineDiagnostics(
      snapshotOf([blankDiag(4)]),
    )!
    const kept = decided.diagnostics.filter(d => d.code === CODE)
    expect(kept).toHaveLength(1)
    expect(decided.warningCount).toBe(1)
    const meta = kept[0].metadata as Record<string, unknown>
    expect(meta.publishedBlankLineCount).toBe(2)          // the displayed / decision count
    expect(meta.visibleBlankLineCount).toBe(2)
    expect(meta.sourceBlankLineCount).toBe(4)             // the SOURCE count (not the decision)
    expect(String(kept[0].detail ?? '')).toContain('2 个可视连续空行')
    expect(String(kept[0].detail ?? '')).not.toContain('源码中存在 4')
  })

  it('可视 2 → 1（编辑/撤销）：诊断被移除且清理已完成', () => {
    host = makeWorld('正文一。\n\n\n\n\n正文二。\n')
    const h = host as unknown as HostInternals
    h.lastRawAdmittedSnapshot = snapshotOf([blankDiag(4)])
    stubVisible(host, 2)
    const published = h.reconcileInternalBlankLineDiagnostics(h.lastRawAdmittedSnapshot!)!
    expect(published.diagnostics.filter(d => d.code === CODE)).toHaveLength(1)
    // the raw snapshot is unchanged; now the visible bands collapse to 1
    stubVisible(host, 1)
    const removed = h.reconcileInternalBlankLineDiagnostics(h.lastRawAdmittedSnapshot!)!
    expect(removed.diagnostics.filter(d => d.code === CODE)).toHaveLength(0)
    expect(removed.warningCount).toBe(0)
  })

  it('可视 1 → 2（输入/撤销回来）：诊断实时重新出现', () => {
    host = makeWorld('正文一。\n\n\n\n\n正文二。\n')
    const h = host as unknown as HostInternals
    h.lastRawAdmittedSnapshot = snapshotOf([blankDiag(4)])
    stubVisible(host, 1)
    expect(h.reconcileInternalBlankLineDiagnostics(h.lastRawAdmittedSnapshot!)!.diagnostics
      .filter(d => d.code === CODE)).toHaveLength(0)
    stubVisible(host, 2)
    expect(h.reconcileInternalBlankLineDiagnostics(h.lastRawAdmittedSnapshot!)!.diagnostics
      .filter(d => d.code === CODE)).toHaveLength(1)
  })
})

describe('B2 — 模式切换：重新评估、禁止复用另一模式结果', () => {
  it('WYSIWYG(visible=1) → source 模式：改由源码行数判定（source=4 → 出现）', () => {
    host = makeWorld('正文一。\n\n\n\n\n正文二。\n')
    const h = host as unknown as HostInternals
    h.lastRawAdmittedSnapshot = snapshotOf([blankDiag(4)])
    stubVisible(host, 1)
    h.lastInternalBlankEditingMode = 'wysiwyg'
    // while WYSIWYG, no diagnostic (visible=1)
    expect(h.reconcileInternalBlankLineDiagnostics(h.lastRawAdmittedSnapshot!)!.diagnostics
      .filter(d => d.code === CODE)).toHaveLength(0)
    // switching to source mode must RE-EVALUATE using the source data source
    document.body.classList.add('typora-sourceview-on')
    h.reevaluateInternalBlankLineMode()
    expect(detectDocumentEditingMode(document)).toBe('source')
    expect(h.snapshot!.diagnostics.filter(d => d.code === CODE)).toHaveLength(1)
    document.body.classList.remove('typora-sourceview-on')
  })

  it('source 模式回到 WYSIWYG：不得复用 source 模式遗留的诊断', () => {
    host = makeWorld('正文一。\n\n\n\n\n正文二。\n')
    const h = host as unknown as HostInternals
    h.lastRawAdmittedSnapshot = snapshotOf([blankDiag(4)])
    // pretend the last decision ran in source mode (which would publish source=4)
    h.lastInternalBlankEditingMode = 'source'
    document.body.classList.remove('typora-sourceview-on')
    stubVisible(host, 1)   // WYSIWYG now measures only ONE visible band
    h.reevaluateInternalBlankLineMode()
    expect(detectDocumentEditingMode(document)).toBe('wysiwyg')
    expect(h.snapshot!.diagnostics.filter(d => d.code === CODE)).toHaveLength(0)
  })
})
