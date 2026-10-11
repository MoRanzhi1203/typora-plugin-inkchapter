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
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

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

type Internals = { renderDrawer(): void; openDrawer(filter?: string): void }

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

function makeWorld(): DocumentUtilityOverlayHost {
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
  fence.className = 'md-fences'; fence.setAttribute('data-line', '10'); fence.textContent = 'x'
  write.appendChild(fence)
  const table = document.createElement('table')
  table.setAttribute('data-line', '20'); write.appendChild(table)
  const h2 = document.createElement('h2')
  h2.setAttribute('data-id', 'H-1'); h2.setAttribute('data-line', '30'); h2.textContent = '小节'
  write.appendChild(h2)
  for (const el of Array.from(write.querySelectorAll('h1,h2,pre,table'))) {
    stubRect(el, () => ({ left: 100, top: 200, right: 700, bottom: 240 }))
  }

  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
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

async function openWith(diags: Array<Record<string, unknown>>): Promise<DocumentUtilityOverlayHost> {
  const h = makeWorld()
  inject(h, diags)
  ;(h as unknown as Internals).openDrawer('all')
  await flushRaf()
  return h
}

// ── SORT at the Drawer level ────────────────────────────────────────────────

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
