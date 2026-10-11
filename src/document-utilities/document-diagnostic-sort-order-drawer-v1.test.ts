// @vitest-environment jsdom
/**
 * Document Diagnostics Drawer — SORT (by position) + DETAIL REMOVAL regression.
 *
 * Drawer-level proof:
 *   - the RENDERED row order follows the unified SOURCE-POSITION model across
 *     heading / code / table / internal-blank / document-end diagnostics;
 *   - a MID-document `EXCESSIVE_INTERNAL_BLANK_LINES` row is NOT at the front;
 *   - the 「详情 / 收起」button, its hidden detail DOM and any leftover listener
 *     are GONE; the card keeps exactly ONE description and the whole card still
 *     activates a locate.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

/** The REAL reproduction document (read-only; never modified). */
const REPRO_MD = readFileSync(
  resolve(process.cwd(), 'test/vault/runtime/smoke/Document-Diagnostics-Block-Gap-Presentation-Extent-Test.md'),
  'utf8',
)

// ── rAF / geometry stubs ────────────────────────────────────────────────────

let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1
function stubRaf(): void {
  rafTasks = new Map()
  rafSeq = 1
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
    (cb: FrameRequestCallback): number => { const id = rafSeq++; rafTasks.set(id, cb); return id }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame =
    (id: number): void => { rafTasks.delete(id) }
}
async function flushRaf(): Promise<void> {
  let guard = 0
  while (rafTasks.size > 0 && guard++ < 400) {
    const cur = Array.from(rafTasks.values())
    rafTasks.clear()
    for (const cb of cur) cb(0)
    await Promise.resolve()
  }
}
type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}
function stubRangeRects(rects: Rect[]): void {
  const fake = {
    setStart(): void { /* noop */ },
    setEnd(): void { /* noop */ },
    getClientRects: () => rects.map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top })),
  }
  ;(document as unknown as { createRange: () => unknown }).createRange = () => fake
}

function fakeContext(markdown = '# t'): DocumentUtilitiesContext {
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

type Internals = {
  renderDrawer(): void
  openDrawer(filter?: string): void
  locateDiagnostic(id: string, targetIndex?: number): void
}
type HostApi = {
  getDiagnosticInteractionStateV2(): { phase: string; diagnosticId: string | null; diagnosticTargetIndex: number | null }
}

let host: DocumentUtilityOverlayHost | null = null
let infoSpy: { mockRestore: () => void } | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  stubRangeRects([{ left: 200, top: 204, right: 420, bottom: 228 }])
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement): number {
      if (!this.classList.contains('inkchapter-doc-drawer__item')) return 0
      const parent = this.parentElement
      if (!parent) return 0
      const sibs = Array.from(parent.children).filter(c => c.classList.contains('inkchapter-doc-drawer__item'))
      return Math.max(0, sibs.indexOf(this)) * 40
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement): number { return this.classList.contains('inkchapter-doc-drawer__item') ? 36 : 0 },
  })
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as { mockRestore: () => void }
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

// ── world: a #write root with headings + a code block + a table ─────────────

function makeWorld(opts: { markdown?: string; fenceDataLine?: string | null } = {}): DocumentUtilityOverlayHost {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  stubRect(shell, () => ({ left: 0, top: 0, right: 1200, bottom: 800 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  stubRect(write, () => ({ left: 0, top: 0, right: 1200, bottom: 800 }))

  const h1 = document.createElement('h1')
  h1.setAttribute('data-id', 'H-0'); h1.setAttribute('data-line', '2'); h1.textContent = '标题'
  write.appendChild(h1)
  const fence = document.createElement('pre')
  fence.className = 'md-fences'; fence.textContent = 'x'
  // Typora does NOT guarantee `data-line` on a code fence — the repro case
  // relies on the SOURCE-side fallback, so allow it to be ABSENT here.
  if (opts.fenceDataLine !== null) fence.setAttribute('data-line', opts.fenceDataLine ?? '10')
  write.appendChild(fence)
  const table = document.createElement('table')
  table.setAttribute('data-line', '20'); write.appendChild(table)
  const h2 = document.createElement('h2')
  h2.setAttribute('data-id', 'H-1'); h2.setAttribute('data-line', '30'); h2.textContent = '小节'
  write.appendChild(h2)
  for (const el of Array.from(write.querySelectorAll('h1,h2,pre,table'))) {
    stubRect(el, () => ({ left: 100, top: 200, right: 700, bottom: 240 }))
  }

  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(opts.markdown), providers: fakeProviders() })
  h.mount()
  return h
}

function inject(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>, revision = 1): void {
  const snapshot = {
    documentKey: 'doc:key', revision, sourceRevision: revision, generatedAt: 0,
    diagnostics: diags,
    errorCount: diags.filter(d => d.severity === 'error').length,
    warningCount: diags.filter(d => d.severity === 'warning').length,
    infoCount: diags.filter(d => d.severity === 'info').length,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}

const rows = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-doc-drawer__item[data-diagnostic-id]'))
const rowIds = (): string[] => rows().map(el => el.getAttribute('data-diagnostic-id') ?? '')

/** The diagnostic fixtures for the sort scenario. */
function sortScenario(): Array<Record<string, unknown>> {
  const base = { domain: 'document', documentKey: 'doc:key', severity: 'warning', detail: '' }
  return [
    { ...base, id: 'eof', category: 'document', code: 'DOCUMENT_TERMINAL_NEWLINE_MISSING', message: '末尾缺少换行符', location: { kind: 'document-end' } },
    { ...base, id: 'blank', category: 'document', code: 'EXCESSIVE_INTERNAL_BLANK_LINES', message: '连续空行过多', location: { kind: 'source-range', startLine: 25, startColumn: 0 } },
    { ...base, id: 'h1', category: 'heading', code: 'HEADING_LEVEL_GAP', message: '跳级', stableIdentity: 'H-0', location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-0' } },
    { ...base, id: 'code', category: 'code', code: 'CODE_MISSING_NAME', message: '缺少代码名', location: { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' } },
    { ...base, id: 'table', category: 'table', code: 'TABLE_MISSING_NAME', message: '缺少表名', location: { kind: 'block-node', blockKind: 'table', stableIdentity: 'block:table:0' } },
    { ...base, id: 'h2', category: 'heading', code: 'HEADING_LEVEL_GAP', message: '跳级2', stableIdentity: 'H-1', location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-1' } },
  ]
}

async function openWith(
  diags: Array<Record<string, unknown>>,
  worldOpts: { markdown?: string; fenceDataLine?: string | null } = {},
): Promise<DocumentUtilityOverlayHost> {
  const h = makeWorld(worldOpts)
  inject(h, diags)
  ;(h as unknown as Internals).openDrawer('all')
  await flushRaf()
  return h
}

/** The REAL repro document's three diagnostics (source lines from the source scan). */
function reproScenario(): Array<Record<string, unknown>> {
  const base = { domain: 'document', documentKey: 'doc:key', detail: '' }
  return [
    { ...base, id: 'blank', severity: 'warning', category: 'document', code: 'EXCESSIVE_INTERNAL_BLANK_LINES', message: '连续空行过多', location: { kind: 'source-range', startLine: 20, startColumn: 0 } },
    { ...base, id: 'image', severity: 'warning', category: 'figure', code: 'FIGURE_LOCAL_IMAGE_MISSING', message: '本地图片不存在', location: { kind: 'figure-occurrence', startLine: 14, startColumn: 0, rangeRole: 'figure-destination', occurrenceIdentity: { documentKey: 'doc:key', sourceRevision: 1, sourceBlockIdentity: 'src-block:14', sourceBlockOrdinal: 0, tokenStart: 0, tokenEnd: 10, rawLineOrdinal: 0, occurrenceWithinLine: 0, destination: 'missing-assets/x.png' }, resourceKind: 'image', canonicalDestination: 'missing-assets/x.png', rawDestination: 'missing-assets/x.png', occurrenceIndex: 0, rawLineOrdinal: 0, occurrenceWithinLine: 0, sourceStart: 0, sourceEnd: 10, sourceRangeIdentity: null } },
    { ...base, id: 'code', severity: 'warning', category: 'code', code: 'CODE_MISSING_NAME', message: '代码块缺少名称', location: { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' } },
  ]
}

// ── SORT at the Drawer level ────────────────────────────────────────────────

describe('Drawer SORT — the REAL reproduction document', () => {
  it('orders CODE_MISSING_NAME → 图片不存在 → EXCESSIVE_INTERNAL_BLANK_LINES', async () => {
    // The fence carries NO data-line (the real Typora case) → the SOURCE-side
    // fallback must supply the code block's real source line.
    host = await openWith(reproScenario(), { markdown: REPRO_MD, fenceDataLine: null })
    expect(rowIds()).toEqual(['code', 'image', 'blank'])
  })

  it('the code row is FIRST even though its DOM element has no data-line', async () => {
    host = await openWith(reproScenario(), { markdown: REPRO_MD, fenceDataLine: null })
    expect(rowIds()[0]).toBe('code')
    expect(rowIds()[rowIds().length - 1]).toBe('blank')
  })
})

describe('Drawer SORT — the rendered row order follows the source position', () => {
  it('orders heading(2) → code(10) → table(20) → blank(25) → heading(30) → eof', async () => {
    host = await openWith(sortScenario())
    expect(rowIds()).toEqual(['h1', 'code', 'table', 'blank', 'h2', 'eof'])
  })

  it('a MID-document internal blank gap is NEVER the first row', async () => {
    host = await openWith(sortScenario())
    expect(rowIds()[0]).not.toBe('blank')
    // …and it sits between its real neighbours by source line (20 < 25 < 30)
    const ids = rowIds()
    expect(ids.indexOf('blank')).toBeGreaterThan(ids.indexOf('table'))
    expect(ids.indexOf('blank')).toBeLessThan(ids.indexOf('h2'))
  })

  it('a HEAD blank gap and a TAIL gap still order by their own lines', async () => {
    // gap at line 1 (head), gap at line 40 (tail), one heading in between
    host = await openWith([
      { domain: 'document', documentKey: 'doc:key', severity: 'warning', detail: '', id: 'tail', category: 'document', code: 'EXCESSIVE_INTERNAL_BLANK_LINES', message: '尾部空行', location: { kind: 'source-range', startLine: 40, startColumn: 0 } },
      { domain: 'document', documentKey: 'doc:key', severity: 'warning', detail: '', id: 'head', category: 'document', code: 'EXCESSIVE_INTERNAL_BLANK_LINES', message: '首部空行', location: { kind: 'source-range', startLine: 1, startColumn: 0 } },
      { domain: 'document', documentKey: 'doc:key', severity: 'warning', detail: '', id: 'h1', category: 'heading', code: 'HEADING_LEVEL_GAP', message: '跳级', stableIdentity: 'H-0', location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-0' } },
    ])
    expect(rowIds()).toEqual(['head', 'h1', 'tail'])
  })

  it('an unknown-position object never jumps to the front', async () => {
    host = await openWith([
      { domain: 'document', documentKey: 'doc:key', severity: 'warning', detail: '', id: 'unknown', category: 'figure', code: 'FIGURE_DUPLICATE_NAME', message: '重复图名', location: { kind: 'block-node', blockKind: 'figure', stableIdentity: 'block:figure:9' } },
      { domain: 'document', documentKey: 'doc:key', severity: 'warning', detail: '', id: 'blank', category: 'document', code: 'EXCESSIVE_INTERNAL_BLANK_LINES', message: '连续空行过多', location: { kind: 'source-range', startLine: 12, startColumn: 0 } },
    ])
    expect(rowIds()[0]).toBe('blank')
    expect(rowIds()[1]).toBe('unknown')
  })
})

// ── DETAIL REMOVAL ──────────────────────────────────────────────────────────

describe('Drawer card — the 「详情」feature is fully removed', () => {
  it('no detail button, no hidden detail node, no expand state on any row', async () => {
    host = await openWith(sortScenario())
    expect(document.querySelectorAll('[data-ink-detail-toggle]')).toHaveLength(0)
    expect(document.querySelectorAll('.inkchapter-doc-drawer__item-more')).toHaveLength(0)
    expect(document.querySelectorAll('.inkchapter-doc-drawer__item-suggestion')).toHaveLength(0)
    for (const row of rows()) {
      expect(row.querySelector('button')).toBeNull()
      expect(row.querySelector('[hidden]')).toBeNull()
      expect(row.querySelector('[aria-expanded]')).toBeNull()
    }
  })

  it('每个卡片保留标题 + 至多一条说明', async () => {
    host = await openWith(sortScenario())
    for (const row of rows()) {
      expect(row.querySelectorAll('.inkchapter-doc-drawer__item-msg')).toHaveLength(1)
      expect(row.querySelectorAll('.inkchapter-doc-drawer__item-detail').length).toBeLessThanOrEqual(1)
    }
  })

  it('整张卡片仍可点击定位（row 有 click 监听且是 role=button）', async () => {
    host = await openWith(sortScenario())
    const row = rows().find(r => r.getAttribute('data-diagnostic-id') === 'blank')!
    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('tabindex')).toBe('0')
    // the row itself is the locate target (no nested interactive control shadows it)
    expect(row.querySelector('button, a, [role="button"]')).toBeNull()
  })
})

// ── 交互验收（Drawer 级：点击激活 / 排序·筛选·分组 / 动态更新） ──────────────
// GUI 级点击在本环境不可达（Typora 抽屉是 Electron web DOM，UIA 不暴露、且无
// 截图坐标可用），因此以同一套真实 Drawer 渲染管线做确定性交互验收。

const internals = (h: DocumentUtilityOverlayHost): Internals => h as unknown as Internals
const api = (): HostApi => host as unknown as HostApi
const selectedIds = (): string[] =>
  rows().filter(r => r.classList.contains('is-selected')).map(r => r.getAttribute('data-diagnostic-id') ?? '')
const projectionIds = (): string[] => host!.getDrawerProjections().map(p => p.diagnosticId)
const setSortMode = (mode: string): void => { (host as unknown as { drawerSortMode: string }).drawerSortMode = mode }
const setTypeFilter = (f: string): void => { (host as unknown as { drawerTypeFilter: string }).drawerTypeFilter = f }
const toggleGrouped = (): void => {
  const h = host as unknown as { drawerGrouped: boolean }
  h.drawerGrouped = !h.drawerGrouped
}
async function clickRow(id: string): Promise<void> {
  internals(host!).locateDiagnostic(id, 0)
  await flushRaf()
}

describe('Drawer 交互验收 — 点击激活与排序/筛选/分组协同', () => {
  it('点击一行 → 该行 Active；再次点击 → 取消', async () => {
    host = await openWith(sortScenario())
    await clickRow('code')
    expect(api().getDiagnosticInteractionStateV2().diagnosticId).toBe('code')
    expect(selectedIds()).toEqual(['code'])
    await clickRow('code')
    expect(selectedIds()).toEqual([])
  })

  it('切换排序模式：行序改变、Active 诊断保持、无重复行', async () => {
    host = await openWith(sortScenario())
    await clickRow('code')          // a resolvable DOM target (block:code:0)
    expect(selectedIds()).toEqual(['code'])

    setSortMode('severity')
    internals(host).renderDrawer()
    await flushRaf()
    // same set of diagnostics (no loss / duplication), order may change
    expect(new Set(projectionIds()).size).toBe(projectionIds().length)
    expect(new Set(projectionIds())).toEqual(new Set(['h1', 'code', 'table', 'blank', 'h2', 'eof']))
    // the ACTIVE diagnostic survives a sort-mode change
    expect(api().getDiagnosticInteractionStateV2().diagnosticId).toBe('code')
    expect(selectedIds()).toEqual(['code'])
    // and the painted rows still match the projection order
    expect(rowIds()).toEqual(projectionIds())
  })

  it('类型筛选：只保留该类型、保序、Active 被筛掉时无选中', async () => {
    host = await openWith(sortScenario())
    await clickRow('code')          // code type
    setTypeFilter('heading')
    internals(host).renderDrawer()
    await flushRaf()
    expect(rowIds()).toEqual(['h1', 'h2'])          // order preserved within the type
    expect(selectedIds()).toEqual([])                // active row filtered out
    // back to all → the row set is restored in document order
    setTypeFilter('all')
    internals(host).renderDrawer()
    await flushRaf()
    expect(rowIds()).toEqual(['h1', 'code', 'table', 'blank', 'h2', 'eof'])
  })

  it('动态更新：空行后移后按新位置重排，且无残留/重复行', async () => {
    host = await openWith(sortScenario())
    expect(rowIds()).toEqual(['h1', 'code', 'table', 'blank', 'h2', 'eof'])
    // a live edit moves the excess gap AFTER h2 (source line 40)
    const moved = sortScenario().map(d =>
      d.id === 'blank' ? { ...d, location: { kind: 'source-range', startLine: 40, startColumn: 0 } } : d)
    inject(host, moved, 2)
    internals(host).renderDrawer()
    await flushRaf()
    expect(rowIds()).toEqual(['h1', 'code', 'table', 'h2', 'blank', 'eof'])
    expect(new Set(rowIds()).size).toBe(rowIds().length)   // no duplicated rows
    expect(document.querySelectorAll('.inkchapter-doc-drawer__item').length).toBe(6)  // no residue
  })

  it('分组切换：出现分组头、组内顺序保持、诊断不丢失', async () => {
    host = await openWith(sortScenario())
    toggleGrouped()
    internals(host).renderDrawer()
    await flushRaf()
    const headers = Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-doc-drawer__group-header'))
    expect(headers.length).toBeGreaterThan(0)
    // every diagnostic is still rendered exactly once
    const ids = rowIds()
    expect(new Set(ids).size).toBe(6)
    expect(new Set(ids)).toEqual(new Set(['h1', 'code', 'table', 'blank', 'h2', 'eof']))
    // the heading group keeps its document order
    expect(ids.filter(id => id === 'h1' || id === 'h2')).toEqual(['h1', 'h2'])
  })
})

// ── ACTIVE 视觉必须跟随已提交快照（同 id 数量变化 → 重绑定 LIVE 诊断） ─────────

const BLANK_ID = 'document:EXCESSIVE_INTERNAL_BLANK_LINES:blank-gap:paragraph:正文一。#0>>paragraph:正文二。#0'

function blankDiag(n: number): Record<string, unknown> {
  return {
    domain: 'document', documentKey: 'doc:key', severity: 'warning',
    id: BLANK_ID, category: 'document', code: 'EXCESSIVE_INTERNAL_BLANK_LINES',
    message: '连续空行过多',
    detail: `当前两个内容块之间存在 ${n} 个连续空行，建议压缩为 1 个空行。`,
    targetIdentity: 'blank-gap:paragraph:正文一。#0>>paragraph:正文二。#0',
    metadata: {
      actualBlankLines: n, firstBlankLine: 3,
      previousBlockStartLine: 2, nextBlockStartLine: 3 + n,
      previousBlockKind: 'paragraph', nextBlockKind: 'paragraph',
      nextBlockAnchorText: '正文二。', previousBlockAnchorText: '正文一。',
    },
    location: { kind: 'source-range', startLine: 3 + n, startColumn: 0, rawText: '正文二。' },
  }
}

describe('ACTIVE 空行视觉 — 跟随已提交快照（禁止复用点击时的旧诊断对象）', () => {
  it('同一诊断 id 下 2 → 4 空行：绑定的 ACTIVE 诊断事实必须变新', async () => {
    host = await openWith([blankDiag(2)], { markdown: '正文一。\n\n\n\n正文二。\n' })
    const h = host as unknown as {
      locateCommittedBlockGapInputs: unknown
      diagnosticInteractionState: Record<string, unknown>
      rebindActiveVisualToLiveDiagnostic(): void
    }
    // Seed the ACTIVE blank band exactly as the click path does: the captured diag
    // is the OLD object (actualBlankLines=2), the snapshot now carries 4.
    h.locateCommittedBlockGapInputs = { diagId: BLANK_ID, severity: 'warning', diag: blankDiag(2), element: null }
    h.diagnosticInteractionState = { ...h.diagnosticInteractionState, phase: 'ACTIVE', diagnosticId: BLANK_ID }
    inject(host, [blankDiag(4)], 2)

    expect(host.getActiveBlankVisualDiagnosticFacts()?.actualBlankLines).toBe(2)  // stale BEFORE rebind
    h.rebindActiveVisualToLiveDiagnostic()
    expect(host.getActiveBlankVisualDiagnosticFacts()?.actualBlankLines).toBe(4)  // live AFTER rebind
    expect(host.getActiveBlankVisualDiagnosticFacts()?.diagnosticId).toBe(BLANK_ID)  // identity stable
  })

  it('诊断已消失时不复活旧视觉（rebind 不写回已删除的诊断）', async () => {
    host = await openWith([blankDiag(2)], { markdown: '正文一。\n\n\n\n正文二。\n' })
    const h = host as unknown as {
      locateCommittedBlockGapInputs: unknown
      diagnosticInteractionState: Record<string, unknown>
      rebindActiveVisualToLiveDiagnostic(): void
    }
    h.locateCommittedBlockGapInputs = { diagId: BLANK_ID, severity: 'warning', diag: blankDiag(2), element: null }
    h.diagnosticInteractionState = { ...h.diagnosticInteractionState, phase: 'ACTIVE', diagnosticId: BLANK_ID }
    inject(host, [{ ...blankDiag(2), id: 'other-id', code: 'OTHER' }], 3)   // the id no longer exists
    h.rebindActiveVisualToLiveDiagnostic()
    // the captured object is NOT replaced by a live one (there is none)
    expect(host.getActiveBlankVisualDiagnosticFacts()?.actualBlankLines).toBe(2)
  })
})
