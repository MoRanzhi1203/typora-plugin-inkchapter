// @vitest-environment jsdom
/**
 * TRAE §二 (UNIFIED BLANK REGION) — the document-end EXCESS marker must be the
 * SAME BlankRegion as the internal gap: `lastMeaningfulBlock + blankRows + EOF
 * boundary`. This suite proves the doc-end carrier draws its REAL trailing blank
 * rows through the SHARED per-row fragment builder (identical fragment class),
 * instead of the old independent band-only paint.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import { RENDERED_BLANK_ROW_FRAGMENT_CLASS } from './document-diagnostic-block-gap-visual-v1'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}
let rafTasks = new Map<number, FrameRequestCallback>()
function stubRaf(): void {
  rafTasks = new Map()
  let seq = 1
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => { const id = seq++; rafTasks.set(id, cb); return id }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => { rafTasks.delete(id) }
}

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveLeafState: () => ({ leafStateKnown: true, leafPath: 'doc.md' }),
      getActiveFilePath: () => 'doc.md',
      getDocumentKey: () => 'doc:eof',
      getMarkdown: () => 'content\n\n\n\n\n\n',
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

interface World { h: DocumentUtilityOverlayHost; write: HTMLElement }
function makeWorld(): World {
  const shell = document.createElement('div')
  shell.className = 'typ-markdown-view'
  document.body.appendChild(shell)
  stubRect(shell, () => ({ left: 0, top: 0, right: 900, bottom: 1200 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  stubRect(write, () => ({ left: 50, top: 0, right: 850, bottom: 1200 }))
  const last = document.createElement('p')
  last.setAttribute('data-line', '10')
  last.textContent = '最后一段正文'
  write.appendChild(last)
  stubRect(last, () => ({ left: 60, top: 1000, right: 700, bottom: 1024 }))
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, write }
}
function trailingBlankDiag(extra: number): Record<string, unknown> {
  return {
    id: `document:DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE:${extra}`,
    documentKey: 'doc:eof', severity: 'warning', category: 'document',
    code: 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', message: '文档末尾空行过多', detail: '',
    metadata: { ruleId: 'DOCUMENT-TRAILING-BLANK-LINES-EXCESSIVE', reason: 'EXCESSIVE_TRAILING_BLANK_LINES', terminalNewlineCount: extra + 1, extraTrailingBlankLineCount: extra },
    location: { kind: 'document-end' },
  }
}
function injectSnapshot(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>): void {
  const snapshot = {
    documentKey: 'doc:eof', revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: diags, errorCount: 0, warningCount: 1, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}

type Internals = {
  commitSyntheticEofVisual(tx: unknown, diag: Record<string, unknown>, extra: number, remeasured: boolean): boolean
  emitVisualClosureAudit(reason: string): void
  bumpDocumentLayoutEpoch(kind: string): boolean
  commitAdmittedSnapshot(snapshot: unknown, source: string): void
  rederiveSyntheticEofVisualOnLayoutChange(): void
  isAdjacentCaptionRect(
    frame: { left: number; top: number; right: number; bottom: number },
    caption: { left: number; top: number; right: number; bottom: number },
  ): boolean
  captionHostOwnedByAnchor(anchor: HTMLElement, host: HTMLElement | null): boolean
  classifyCaptionRelation(
    frame: { left: number; top: number; right: number; bottom: number },
    caption: { left: number; top: number; right: number; bottom: number },
  ): 'CONTAINED' | 'OVERLAP' | 'ADJACENT' | 'NONE'
  openDrawer(filter?: string): void
  renderDrawer(): void
}
function snapshotOf(diags: Array<Record<string, unknown>>): DocumentDiagnosticsSnapshot {
  return {
    documentKey: 'doc:eof', revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: diags, errorCount: 0, warningCount: diags.length, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
}
const EOF_EXCESS_CODE = 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE'
const fakeTx = (): Record<string, unknown> => ({ id: 1, documentKey: 'doc:eof', diagnosticId: 'D1', targetIndex: 0, targetCount: 1, startedAt: 0, state: 'PRESENTING' })

function readAudits(spy: { mock: { calls: unknown[][] } }, event: string): Array<Record<string, string>> {
  return spy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event)).map(line => {
    const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
    const out: Record<string, string> = {}
    for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
    return out
  })
}

let host: DocumentUtilityOverlayHost | null = null
let infoSpy: { mock: { calls: unknown[][] }; mockRestore: () => void } | null = null
beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as typeof infoSpy
  vi.spyOn(window, 'getComputedStyle').mockImplementation((() => ({
    lineHeight: '24px', backgroundColor: 'rgba(168,121,50,0.08)', backgroundImage: 'none',
    boxShadow: 'none', outlineStyle: 'none', outlineWidth: '0px',
    borderLeftWidth: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px',
    borderLeftStyle: 'none', borderTopStyle: 'none', borderRightStyle: 'none', borderBottomStyle: 'none',
  })) as unknown as typeof window.getComputedStyle)
})
afterEach(() => { host?.dispose(); host = null; infoSpy?.mockRestore(); infoSpy = null; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('TRAE §二 — 文末 excess 复用正文 BlankRegion 的 Fragment 绘制', () => {
  it('文末 excess 载体的真实尾随空行由共享 builder 绘制为 per-row fragments', () => {
    const w = makeWorld()
    host = w.h
    // 3 REAL trailing blank rows after the last meaningful block.
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('p')
      b.textContent = ''
      const top = 1024 + i * 24
      stubRect(b, () => ({ left: 60, top, right: 700, bottom: top + 24 }))
      w.write.appendChild(b)
    }
    const diag = trailingBlankDiag(5)
    injectSnapshot(host, [diag])
    const ok = (host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(ok).toBe(true)
    const carrier = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement | null
    expect(carrier).not.toBeNull()
    // the SAME fragment element/class as the internal gap — one BlankRegion model.
    const frags = carrier!.querySelectorAll(`.${RENDERED_BLANK_ROW_FRAGMENT_CLASS}`)
    expect(frags.length).toBeGreaterThanOrEqual(1)
    // every fragment is container-relative + non-interactive (shared contract).
    for (const f of Array.from(frags)) {
      const el = f as HTMLElement
      expect(Number.parseFloat(el.style.left)).toBeGreaterThanOrEqual(0)
      expect(el.style.pointerEvents).toBe('none')
    }
  })

  it('item 4 — 无真实可视空行几何时【禁止合成兜底】：不绘制任何文末背景', () => {
    const w = makeWorld()
    host = w.h
    const diag = trailingBlankDiag(3)
    injectSnapshot(host, [diag])
    // NO real trailing blank rows in this world → the plan is REJECTED (no synthetic
    // large rectangle fallback) → nothing is painted.
    const ok = (host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 3, true)
    expect(ok).toBe(false)
    expect(document.querySelector('[data-ink-eof-marker="true"]')).toBeNull()
    expect(host.getEofBlankRegionGateDecision().failing).toContain('EOF_BLANK_ROW_GEOMETRY_VALID')
  })
})

describe('TRAE §P1/§P2 — 门禁与过期纪元', () => {
  function addTrailingBlanks(write: HTMLElement, count: number): void {
    for (let i = 0; i < count; i++) {
      const b = document.createElement('p')
      b.textContent = ''
      const top = 1024 + i * 24
      stubRect(b, () => ({ left: 60, top, right: 700, bottom: top + 24 }))
      write.appendChild(b)
    }
  }

  it('§P2 — 一次正常文末 excess 提交后，7 项空白区域门禁全部成立', () => {
    const w = makeWorld()
    host = w.h
    addTrailingBlanks(w.write, 3)
    const diag = trailingBlankDiag(5)
    injectSnapshot(host, [diag])
    expect((host as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)).toBe(true)
    const report = host.getEofBlankRegionGateReport()
    expect(report).toContain('EOF_NONEMPTY_BLOCK_OVERLAP_COUNT=0')
    expect(report).toContain('EOF_PARENT_BACKGROUND_OVERLAP_COUNT=0')
    expect(report).toContain('EOF_BLANK_ROW_GEOMETRY_VALID=true')
    expect(report).toContain('EOF_LAYOUT_EPOCH_CURRENT=true')
    expect(report).toContain('EOF_FRAGMENT_OWNER_COUNT_MATCH=true')
    expect(report).toContain('EOF_ACTUAL_COVERAGE_VALID=true')
    expect(report).toContain('EOF_STALE_COMMIT_COUNT=0')
    expect(host.getEofBlankRegionGateDecision().decision).toBe('PASS')
  })

  it('§P1/§P2 — 过期纪元先就地重测恢复同一诊断，绝不因几何失效而丢失激活标记', () => {
    const w = makeWorld()
    host = w.h
    addTrailingBlanks(w.write, 3)
    const diag = trailingBlankDiag(5)
    injectSnapshot(host, [diag])
    const internals = host as unknown as Internals
    expect(internals.commitSyntheticEofVisual(fakeTx(), diag, 5, true)).toBe(true)
    expect(document.querySelector('[data-ink-eof-marker="true"]')).not.toBeNull()
    // a REAL reflow happens AFTER the measure → the committed band is stale.
    internals.bumpDocumentLayoutEpoch('WINDOW_LAYOUT_SETTLE')
    internals.emitVisualClosureAudit('TEST_STALE_EPOCH')
    const closures = readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-VISUAL-CLOSURE-AUDIT')
    const last = closures[closures.length - 1]
    // §P2 — the stale geometry is RE-MEASURED at the CURRENT epoch in place: the
    // visual is valid again and — crucially — the marker is NOT lost.
    expect(last.layoutEpochCurrent).toBe('true')
    expect(last.geometryPending).toBe('false')
    expect(readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-EOF-STALE-EPOCH-REMEASURED').length).toBeGreaterThanOrEqual(1)
    expect(document.querySelector('[data-ink-eof-marker="true"]')).not.toBeNull()
    // §P6 — no unexpected release / deselect / lost recovery.
    expect(host.getActivationLifecycleGateDecision().decision).toBe('PASS')
    expect(host.getActivationLifecycleGateReport()).toContain('SELECTED_DIAGNOSTIC_UNEXPECTED_CLEAR_COUNT=0')
    expect(host.getActivationLifecycleGateReport()).toContain('ACTIVE_VISUAL_UNEXPECTED_RELEASE_COUNT=0')
    expect(host.getActivationLifecycleGateReport()).toContain('PENDING_GEOMETRY_RECOVERY_LOST_COUNT=0')
    expect(host.getActivationLifecycleGateReport()).toContain('STALE_RECOVERY_COMMIT_COUNT=0')
    expect(host.getActivationLifecycleGateReport()).toContain('RECOVERY_SYNTHETIC_CLICK_COUNT=0')
    expect(host.getActivationLifecycleGateReport()).toContain('PLUGIN_PRESENTATION_FALSE_INVALIDATION_COUNT=0')
  })

  it('item P1 — WYSIWYG 2 个可视空行 ⇒ 必须保留警告（excess=1，禁止提前撤销）', () => {
    const w = makeWorld()
    host = w.h
    addTrailingBlanks(w.write, 2) // 2 visible → excess = 1 → WARNING
    const internals = host as unknown as Internals
    internals.commitAdmittedSnapshot(snapshotOf([trailingBlankDiag(2)]), 'TEST')
    expect(host.getCurrentProblemsProjection().warningCount).toBe(1)
    const audit = readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-EOF-BLANK-DECISION-AUDIT').pop()
    expect(audit?.mode).toBe('wysiwyg')
    expect(audit?.renderedVisibleBlankCount).toBe('2')
    expect(audit?.excessVisibleRows).toBe('1')
    expect(audit?.publish).toBe('true')
    expect(audit?.publishReason).toBe('VISIBLE_EXCESSIVE_1')
    expect(audit?.diagnosticDecision).toBe('PUBLISH_EXCESSIVE')
    expect(audit?.nextDiagnosticId).not.toBe('null')
    expect(audit?.diagnosticDiff).toBe('NONE')
    expect(audit?.drawerWarningCount).toBe('1')
  })

  it('item P2 — WYSIWYG 恰好 1 个可视空行 ⇒ 原子撤销（drawer/计数/视觉/选中全清）', () => {
    const w = makeWorld()
    host = w.h
    addTrailingBlanks(w.write, 1) // 1 visible → excess = 0 → PASS
    const internals = host as unknown as Internals
    internals.commitAdmittedSnapshot(snapshotOf([trailingBlankDiag(2)]), 'TEST')
    const proj = host.getCurrentProblemsProjection()
    expect(proj.warningCount).toBe(0)
    expect(proj.totalCount).toBe(0)
    const audit = readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-EOF-BLANK-DECISION-AUDIT').pop()
    expect(audit?.renderedVisibleBlankCount).toBe('1')
    expect(audit?.excessVisibleRows).toBe('0')
    expect(audit?.publish).toBe('false')
    expect(audit?.publishReason).toBe('VISIBLE_WITHIN_ALLOWANCE_0')
    expect(audit?.diagnosticDecision).toBe('RETRACT_PASS')
    expect(audit?.nextDiagnosticId).toBe('null')
    expect(audit?.diagnosticDiff).toBe('REMOVE')
    expect(audit?.drawerWarningCount).toBe('0')
  })

  it('item P2/P3 — 3→2 警告保留、2→1 完全撤销、1→2 立即重新发布（无需刷新）', () => {
    const w = makeWorld()
    host = w.h
    const internals = host as unknown as Internals
    const blanks = (): HTMLElement[] => Array.from(w.write.querySelectorAll('p')).filter(p => (p.textContent ?? '').trim() === '')
    const setVisible = (n: number): void => {
      while (blanks().length > n) blanks().pop()!.remove()
      while (blanks().length < n) {
        const b = document.createElement('p')
        b.textContent = ''
        const idx = blanks().length
        const top = 1024 + idx * 24
        Object.defineProperty(b, 'getBoundingClientRect', { configurable: true, value: () => ({ x: 60, y: top, left: 60, top, right: 700, bottom: top + 24, width: 640, height: 24, toJSON: () => ({}) }) })
        w.write.appendChild(b)
      }
    }
    const commit = (): void => internals.commitAdmittedSnapshot(snapshotOf([trailingBlankDiag(2)]), 'TEST')
    // 3 visible → excess 2 → warn
    setVisible(3); commit()
    expect(host.getCurrentProblemsProjection().warningCount).toBe(1)
    let a = readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-EOF-BLANK-DECISION-AUDIT').pop()
    expect(a?.excessVisibleRows).toBe('2')
    expect(a?.publish).toBe('true')
    // 3→2 — the warning MUST SURVIVE (excess 1)
    setVisible(2); commit()
    expect(host.getCurrentProblemsProjection().warningCount).toBe(1)
    a = readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-EOF-BLANK-DECISION-AUDIT').pop()
    expect(a?.excessVisibleRows).toBe('1')
    expect(a?.publish).toBe('true')
    // 2→1 — the warning is RETRACTED
    setVisible(1); commit()
    expect(host.getCurrentProblemsProjection().warningCount).toBe(0)
    a = readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-EOF-BLANK-DECISION-AUDIT').pop()
    expect(a?.publish).toBe('false')
    expect(a?.diagnosticDecision).toBe('RETRACT_PASS')
    // 1→2 — the warning comes back immediately (no reopen / no manual refresh)
    setVisible(2); commit()
    expect(host.getCurrentProblemsProjection().warningCount).toBe(1)
    a = readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-EOF-BLANK-DECISION-AUDIT').pop()
    expect(a?.publish).toBe('true')
    expect(a?.diagnosticDecision).toBe('PUBLISH_EXCESSIVE')
  })
})

// ── TRAE P3 — the parameterised threshold matrix (dual mode) ───────────────
describe('TRAE P3 — 文末空行阈值矩阵 0/1/2/3/4/10（WYSIWYG + 源码模式）', () => {
  function worldWith(n: number): { h: DocumentUtilityOverlayHost; write: HTMLElement } {
    const w = makeWorld()
    for (let i = 0; i < n; i++) {
      const b = document.createElement('p')
      b.textContent = ''
      const top = 1024 + i * 24
      Object.defineProperty(b, 'getBoundingClientRect', { configurable: true, value: () => ({ x: 60, y: top, left: 60, top, right: 700, bottom: top + 24, width: 640, height: 24, toJSON: () => ({}) }) })
      w.write.appendChild(b)
    }
    return { h: w.h, write: w.write }
  }
  const run = (n: number, source: boolean): Record<string, string> | undefined => {
    const { h } = worldWith(n)
    host = h
    if (source) document.body.classList.add('typora-sourceview-on')
    try {
      const internals = h as unknown as Internals
      internals.commitAdmittedSnapshot(snapshotOf([trailingBlankDiag(Math.max(2, n))]), 'TEST')
      return readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-EOF-BLANK-DECISION-AUDIT').pop()
    } finally {
      document.body.classList.remove('typora-sourceview-on')
    }
  }
  for (const n of [0, 1, 2, 3, 4, 10]) {
    it(`WYSIWYG N=${n} ⇒ ${n >= 2 ? '发布警告' : 'PASS 撤销'}`, () => {
      const a = run(n, false)
      expect(a?.mode).toBe('wysiwyg')
      expect(a?.renderedVisibleBlankCount).toBe(String(n))
      expect(a?.excessVisibleRows).toBe(String(Math.max(0, n - 1)))
      expect(a?.publish).toBe(String(n >= 2))
      expect(host!.getCurrentProblemsProjection().warningCount).toBe(n >= 2 ? 1 : 0)
    })
    it(`源码模式 N=${n} ⇒ 按源码尾部规则发布`, () => {
      const a = run(n, true)
      expect(a?.mode).toBe('source')
      expect(a?.publish).toBe('true')
      expect(host!.getCurrentProblemsProjection().warningCount).toBe(1)
    })
  }

  it('UNKNOWN/不可测量 ≠ PASS：无业务根时不冒充恰好一行，也不撤销已有问题', () => {
    const { h } = worldWith(3)
    host = h
    // remove the business root so the runtime cannot measure the visible rows.
    document.getElementById('write')!.remove()
    const internals = host as unknown as Internals
    internals.commitAdmittedSnapshot(snapshotOf([trailingBlankDiag(3)]), 'TEST')
    const a = readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-EOF-BLANK-DECISION-AUDIT').pop()
    expect(a?.renderedVisibleBlankCount).toBe('null')
    expect(a?.publish).toBe('true')
    // NEVER retract on an unknown/unmeasurable state (either the WYSIWYG
    // UNMEASURABLE branch or the MODE_UNKNOWN branch — both KEEP the source verdict).
    expect(String(a?.publishReason)).toMatch(/KEEP_SOURCE/)
    expect(host.getCurrentProblemsProjection().warningCount).toBe(1)
  })
})

// ── TRAE EOF-ENTER-BLANK §3.1/§6/§7 — visible/source separation closure ─────
describe('TRAE EOF-ENTER-BLANK — 源事实/可见事实分离，Drawer 文案随真实可见行数', () => {
  /** A mutable world whose trailing blank-row count can be changed step by step. */
  function seqWorld(): { h: DocumentUtilityOverlayHost; setBlanks: (n: number) => void } {
    const w = makeWorld()
    let rows: HTMLElement[] = []
    const setBlanks = (n: number): void => {
      for (const r of rows) r.remove()
      rows = []
      for (let i = 0; i < n; i++) {
        const b = document.createElement('p')
        b.textContent = ''
        const top = 1024 + i * 24
        stubRect(b, () => ({ left: 60, top, right: 700, bottom: top + 24 }))
        w.write.appendChild(b)
        rows.push(b)
      }
    }
    return { h: w.h, setBlanks }
  }
  const drawerEofDetail = (): string =>
    (document.querySelector('.inkchapter-doc-drawer__item-detail') as HTMLElement | null)?.textContent ?? ''
  const lastAudit = (): Record<string, string> | undefined =>
    readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-EOF-BLANK-DECISION-AUDIT').pop()

  it('E02/E03 — 0→1→2→3→2→1→0：判定/Drawer 文案/可见数一致，源码数从不被当可见数', () => {
    const { h, setBlanks } = seqWorld()
    host = h
    const internals = h as unknown as Internals
    internals.openDrawer('all')
    for (const n of [0, 1, 2, 3, 2, 1, 0]) {
      setBlanks(n)
      // the SOURCE facts are deliberately DIFFERENT from the visible rows (2n−1),
      // so a conflation of the two would be caught here.
      const sourceExtra = Math.max(2, n * 2 - 1)
      internals.commitAdmittedSnapshot(snapshotOf([trailingBlankDiag(sourceExtra)]), 'TEST')
      const a = lastAudit()
      expect(a?.mode).toBe('wysiwyg')
      expect(a?.renderedVisibleBlankCount).toBe(String(n))
      const warn = n >= 2
      expect(a?.publish).toBe(String(warn))
      expect(Number(a?.renderedVisibleBlankCount)).not.toBe(Number(a?.sourceBlankLineCount))
      internals.renderDrawer()
      if (warn) {
        expect(drawerEofDetail()).toBe(`文末有 ${n} 个可见空行，建议保留 1 个。`)
      } else {
        // retracted: no stale Drawer count either
        expect(a?.publishReason).toBe(`VISIBLE_WITHIN_ALLOWANCE_${Math.max(0, n - 1)}`)
        expect(drawerEofDetail()).not.toContain('可见空行')
      }
    }
  })

  it('E08 — 源码模式文案明确标注「源码」，不使用可见数', () => {
    const { h, setBlanks } = seqWorld()
    host = h
    setBlanks(3)
    const internals = h as unknown as Internals
    internals.openDrawer('all')
    document.body.classList.add('typora-sourceview-on')
    try {
      internals.commitAdmittedSnapshot(snapshotOf([trailingBlankDiag(7)]), 'TEST')
      const a = lastAudit()
      expect(a?.mode).toBe('source')
      expect(a?.publish).toBe('true')
      internals.renderDrawer()
      const detail = drawerEofDetail()
      expect(detail).toMatch(/^源码：/)
      expect(detail).toContain('7 个源码空行')
      expect(detail).not.toContain('可见空行')
    } finally {
      document.body.classList.remove('typora-sourceview-on')
    }
  })

  it('E01/E04 — 可见行数在回退时同步缩减：3→2→1→0 每次 Drawer 文案都用当次真实可见数', () => {
    const { h, setBlanks } = seqWorld()
    host = h
    const internals = h as unknown as Internals
    internals.openDrawer('all')
    const seen: string[] = []
    for (const n of [3, 2, 1, 0]) {
      setBlanks(n)
      internals.commitAdmittedSnapshot(snapshotOf([trailingBlankDiag(5)]), 'TEST')
      const a = lastAudit()
      expect(a?.renderedVisibleBlankCount).toBe(String(n))
      internals.renderDrawer()
      seen.push(drawerEofDetail())
    }
    expect(seen[0]).toBe('文末有 3 个可见空行，建议保留 1 个。')
    expect(seen[1]).toBe('文末有 2 个可见空行，建议保留 1 个。')
    // 1 and 0 are within allowance → retracted (no Drawer row at all)
    expect(seen[2]).not.toContain('可见空行')
    expect(seen[3]).not.toContain('可见空行')
    expect(host.getCurrentProblemsProjection().warningCount).toBe(0)
  })
})

// ── TRAE §A2 — code-carrier caption adjacency (parent-container refusal) ────
describe('TRAE §A2 — 代码块激活不越界（父容器标题/标签拒绝）', () => {
  const frame = { left: 60, top: 400, right: 700, bottom: 500 }
  it('§A2-2 — 真实相邻图注（紧贴块上方/下方）才允许并入', () => {
    const w = makeWorld()
    host = w.h
    const t = host as unknown as Internals
    // caption immediately ABOVE the block (one line + margin)
    expect(t.isAdjacentCaptionRect(frame, { left: 60, top: 376, right: 300, bottom: 396 })).toBe(true)
    // caption immediately BELOW the block
    expect(t.isAdjacentCaptionRect(frame, { left: 60, top: 502, right: 300, bottom: 522 })).toBe(true)
  })
  it('§A2-3/§A2-5 — 父容器 / 无关标题 / 不相交的标题一律拒绝', () => {
    const w = makeWorld()
    host = w.h
    const t = host as unknown as Internals
    // a PARENT container wrapping the block (and more blocks): both gaps hugely negative
    expect(t.isAdjacentCaptionRect(frame, { left: 40, top: 100, right: 860, bottom: 1200 })).toBe(false)
    // an unrelated heading far above
    expect(t.isAdjacentCaptionRect(frame, { left: 60, top: 100, right: 300, bottom: 124 })).toBe(false)
    // no horizontal overlap
    expect(t.isAdjacentCaptionRect(frame, { left: 720, top: 376, right: 900, bottom: 396 })).toBe(false)
  })
})

// ── TRAE P0 §A/§2/§4/§6 — code diagnostic paint target policy ───────────────
describe('TRAE P0 §A — 代码诊断视觉目标策略（标题所有权/涂色类型/相邻交叉）', () => {
  const w = (): Internals => {
    const world = makeWorld()
    host = world.h
    return host as unknown as Internals
  }
  const parent = (): HTMLElement => {
    const p = document.createElement('div')
    document.getElementById('write')!.appendChild(p)
    return p
  }

  it('§A/§4 — classifyCaptionRelation: CONTAINED / OVERLAP / ADJACENT / NONE 明确分类', () => {
    const t = w()
    const frame = { left: 60, top: 400, right: 700, bottom: 500 }
    // fully contained caption row (the real 墨章 code caption may sit INSIDE the box)
    expect(t.classifyCaptionRelation(frame, { left: 60, top: 410, right: 300, bottom: 430 })).toBe('CONTAINED')
    // partial vertical overlap
    expect(t.classifyCaptionRelation(frame, { left: 60, top: 390, right: 300, bottom: 410 })).toBe('OVERLAP')
    // touching above / below within the bounded offset
    expect(t.classifyCaptionRelation(frame, { left: 60, top: 376, right: 300, bottom: 396 })).toBe('ADJACENT')
    expect(t.classifyCaptionRelation(frame, { left: 60, top: 504, right: 300, bottom: 524 })).toBe('ADJACENT')
    // no horizontal overlap / too far → NONE
    expect(t.classifyCaptionRelation(frame, { left: 720, top: 376, right: 900, bottom: 396 })).toBe('NONE')
    expect(t.classifyCaptionRelation(frame, { left: 60, top: 100, right: 300, bottom: 124 })).toBe('NONE')
  })

  it('§A/§2 — captionHostOwnedByAnchor: 兄弟/子节点=owned；祖先容器/自身/无关=拒绝', () => {
    const t = w()
    const box = parent()
    const anchor = document.createElement('pre')
    anchor.className = 'md-fences'
    box.appendChild(anchor)
    const siblingCaption = document.createElement('div')
    box.appendChild(siblingCaption)
    const childCaption = document.createElement('div')
    anchor.appendChild(childCaption)
    const ancestor = box
    const unrelated = document.createElement('div')
    document.body.appendChild(unrelated)
    expect(t.captionHostOwnedByAnchor(anchor, siblingCaption)).toBe(true)
    expect(t.captionHostOwnedByAnchor(anchor, childCaption)).toBe(true)
    // a PARENT container is the parent-substitution defect
    expect(t.captionHostOwnedByAnchor(anchor, ancestor)).toBe(false)
    expect(t.captionHostOwnedByAnchor(anchor, anchor)).toBe(false)
    expect(t.captionHostOwnedByAnchor(anchor, null)).toBe(false)
    expect(t.captionHostOwnedByAnchor(anchor, unrelated)).toBe(false)
  })
})

// ── TRAE §B2/B3 — the EOF fragment set follows the real row count ───────────
describe('TRAE §B2/B3 — 文末片段集合随真实行数重建（不冻结/无残留）', () => {
  const fragCount = (): number => {
    const c = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement | null
    return c ? c.querySelectorAll('.inkchapter-block-gap-fragment').length : 0
  }
  const chipText = (): string | null => {
    const c = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement | null
    return c?.querySelector<HTMLElement>('[data-ink-chip-pos="top-right"]')?.textContent ?? null
  }
  const setVisible = (write: HTMLElement, n: number): void => {
    const blanks = (): HTMLElement[] => Array.from(write.querySelectorAll('p')).filter(p => (p.textContent ?? '').trim() === '')
    while (blanks().length > n) blanks().pop()!.remove()
    while (blanks().length < n) {
      const b = document.createElement('p')
      b.textContent = ''
      const idx = blanks().length
      const top = 1024 + idx * 24
      Object.defineProperty(b, 'getBoundingClientRect', { configurable: true, value: () => ({ x: 60, y: top, left: 60, top, right: 700, bottom: top + 24, width: 640, height: 24, toJSON: () => ({}) }) })
      write.appendChild(b)
    }
  }

  it('§B2 — 行数减少后片段集合被重建（5→2），标签同步', () => {
    const w = makeWorld()
    host = w.h
    setVisible(w.write, 6) // 6 real rows → 5 excess
    const diag = trailingBlankDiag(6)
    injectSnapshot(host, [diag])
    const t = host as unknown as Internals
    expect(t.commitSyntheticEofVisual(fakeTx(), diag, 6, true)).toBe(true)
    expect(fragCount()).toBe(5)
    setVisible(w.write, 3) // → 2 excess
    t.rederiveSyntheticEofVisualOnLayoutChange()
    expect(fragCount()).toBe(2)
    expect(chipText()).toBe('多余 2 空行')
    expect(host.getEofFragmentSetEvidence().fragmentSetMismatchCount).toBe(0)
  })

  it('§B2/item 5.3 — 1→2→10→5→2→1→0→1 全程片段数与真实 excess 行一致', () => {
    const w = makeWorld()
    host = w.h
    const t = host as unknown as Internals
    const diag = trailingBlankDiag(10)
    // seed with 2 rows then drive the exact sequence
    setVisible(w.write, 2)
    injectSnapshot(host, [diag])
    t.commitSyntheticEofVisual(fakeTx(), diag, 10, true)
    const seq = [1, 2, 10, 5, 2, 1, 0, 1]
    for (const n of seq) {
      setVisible(w.write, n)
      t.rederiveSyntheticEofVisualOnLayoutChange()
      const expected = Math.max(0, n - 1)
      expect(fragCount(), `visible=${n}`).toBe(expected)
      if (expected > 0) expect(chipText()).toBe(`多余 ${expected} 空行`)
    }
    expect(host.getEofFragmentSetEvidence().fragmentSetMismatchCount).toBe(0)
  })

  it('§B3 — 相同身份+计数跳过 DOM 写；身份/计数变化则重建（旧片段清理计数>0）', () => {
    const w = makeWorld()
    host = w.h
    setVisible(w.write, 5)
    const diag = trailingBlankDiag(5)
    injectSnapshot(host, [diag])
    const t = host as unknown as Internals
    t.commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(fragCount()).toBe(4)
    // identical identity + count → NO rebuild (cleanup stays 0)
    t.rederiveSyntheticEofVisualOnLayoutChange()
    expect(host.getEofFragmentSetEvidence().oldFragmentCleanupCount).toBe(0)
    expect(fragCount()).toBe(4)
    // count change → rebuild (old fragments cleaned)
    setVisible(w.write, 7)
    t.rederiveSyntheticEofVisualOnLayoutChange()
    expect(fragCount()).toBe(6)
    expect(host.getEofFragmentSetEvidence().oldFragmentCleanupCount).toBeGreaterThan(0)
  })
})
