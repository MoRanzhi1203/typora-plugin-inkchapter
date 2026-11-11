// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Probe = {
  createProbe(doc: Document, win: Window): { run(): Promise<any> }
}

function loadProbe(): Probe {
  const source = readFileSync(resolve(process.cwd(), 'docs/diagnostics/GUI_ACCEPTANCE_DEVTOOLS.js'), 'utf8')
  const mod = { exports: {} as Probe }
  const factory = new Function('module', 'exports', 'document', 'window', 'globalThis', source)
  factory(mod, mod.exports, document, window, globalThis)
  return mod.exports
}

interface Rect { left: number; top: number; width: number; height: number }

const DEFAULT_RECT = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height })

function setRect(el: Element, r: Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...r,
      x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height,
    }),
  })
}

interface Setup {
  expanded?: boolean
  tabsVisible?: boolean
  panelVisible?: boolean
  tabWidths?: number[]
  rowRect?: Rect
  panelRect?: Rect
  warningCount?: number
  errorCount?: number
  hintCount?: number
  rows?: Array<{ id: string; severity: string; text: string }>
  hitTarget?: 'write' | 'plugin' | 'none'
  writeRect?: Rect
  maxWidth?: string
}

function setup(options: Setup = {}) {
  const expanded = options.expanded ?? false
  document.body.innerHTML = ''
  const mk = (cls: string, parent: ParentNode = document.body) => {
    const el = document.createElement('div')
    el.className = cls
    parent.appendChild(el)
    return el
  }
  const root = mk('inkchapter-doc-toolbar-ui')
  root.setAttribute('data-inkchapter-ui-root', 'document-utilities')
  root.dataset.expanded = expanded ? 'true' : 'false'
  const toolbar = mk('inkchapter-doc-toolbar', root)
  const layout = mk('inkchapter-doc-expand__layout', root)
  const row = mk('inkchapter-doc-expand__row', layout)
  const tabs = mk('inkchapter-doc-expand__tabs', row)
  const tabButtons = [0, 1, 2].map(i => {
    const b = document.createElement('button')
    b.className = 'inkchapter-doc-expand__tab'
    b.dataset.tab = ['diagnostics', 'images', 'lock'][i]
    b.textContent = ['检测', '图片', '锁定'][i]
    tabs.appendChild(b)
    return b
  })
  const panel = mk('inkchapter-doc-expand__panel', layout)
  const status = document.createElement('button')
  status.className = 'inkchapter-doc-status'
  status.dataset.status = (options.errorCount ?? 0) > 0 ? 'RED' : (options.warningCount ?? 0) > 0 ? 'YELLOW' : 'GREEN'
  status.dataset.errorCount = String(options.errorCount ?? 0)
  status.dataset.warningCount = String(options.warningCount ?? 0)
  status.dataset.hintCount = String(options.hintCount ?? 0)
  status.dataset.locked = '0'
  const square = document.createElement('span')
  square.className = 'inkchapter-doc-status__square'
  square.style.backgroundColor = 'rgb(212, 154, 38)'
  const lockFrame = document.createElement('span')
  lockFrame.className = 'inkchapter-doc-status__lock-frame'
  status.append(square, lockFrame)
  root.appendChild(status)

  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)

  const tabWidths = options.tabWidths ?? (expanded ? [100, 100, 100] : [0, 0, 0])
  tabButtons.forEach((b, i) => setRect(b, expanded && options.tabsVisible !== false ? DEFAULT_RECT(100 + i * 100, 50, tabWidths[i], 30) : DEFAULT_RECT(0, 0, tabWidths[i], 0)))
  setRect(tabs, expanded && options.tabsVisible !== false ? DEFAULT_RECT(100, 50, 300, 30) : DEFAULT_RECT(0, 0, 300, 0))
  const rowRect = options.rowRect ?? (expanded ? DEFAULT_RECT(100, 50, 360, 40) : DEFAULT_RECT(0, 0, 40, 40))
  const panelRect = options.panelRect ?? (expanded ? DEFAULT_RECT(100, 90, 360, 200) : DEFAULT_RECT(0, 0, 360, 0))
  setRect(row, rowRect)
  setRect(panel, panelRect)
  setRect(layout, DEFAULT_RECT(100, 50, expanded ? 360 : 40, expanded ? 240 : 40))
  setRect(root, DEFAULT_RECT(100, 50, expanded ? 360 : 40, expanded ? 240 : 40))
  setRect(toolbar, DEFAULT_RECT(100, 40, 360, 20))
  setRect(status, DEFAULT_RECT(420, 50, 32, 32))
  setRect(square, DEFAULT_RECT(428, 58, 15, 15))
  setRect(lockFrame, DEFAULT_RECT(423, 53, 22, 22))
  setRect(write, options.writeRect ?? DEFAULT_RECT(100, 100, 537.6, 600))
  if (options.maxWidth) write.style.maxWidth = options.maxWidth

  document.body.querySelectorAll('.inkchapter-doc-expand__diag').forEach(el => el.remove())
  for (const item of options.rows ?? []) {
    const r = document.createElement('button')
    r.className = 'inkchapter-doc-expand__diag'
    r.dataset.severity = item.severity
    r.dataset.diagnosticId = item.id
    r.textContent = item.text
    panel.appendChild(r)
    setRect(r, DEFAULT_RECT(100, 100, 360, 30))
  }

  const hitTarget = options.hitTarget ?? 'write'
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => hitTarget === 'plugin' ? [panel, root] : hitTarget === 'none' ? [] : [write],
  })
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => hitTarget === 'plugin' ? panel : hitTarget === 'none' ? null : write,
  })
  ;(window as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0)
  return { root, toolbar, layout, row, tabs, tabButtons, panel, status, square, lockFrame, write }
}

const probe = loadProbe()

afterEach(() => {
  document.body.innerHTML = ''
})

describe('GUI acceptance probe — collapsed', () => {
  it('does not interpret zero DOM rows as zero diagnostics and marks tab/geometry NOT_APPLICABLE', async () => {
    setup({ expanded: false, warningCount: 10, rows: [] })
    const r = await probe.createProbe(document, window).run()
    expect(r.visibility.expanded).toBe(false)
    expect(r.diagnostics.instanceCounts.warning).toBe(10)
    expect(r.diagnostics.domRowCount).toBe(0)
    expect(r.diagnostics.projectedRowCount).toBeNull()
    expect(r.diagnostics.rowCoverage.verdict).toBe('NOT_APPLICABLE')
    expect(r.diagnostics.rowCoverage.reason).toBe('COLLAPSED_DOES_NOT_MEAN_ZERO_DIAGNOSTICS')
    expect(r.toolbar.tabWidth.verdict).toBe('NOT_APPLICABLE')
    expect(r.toolbar.tabWidthsEqual).toBe(false)
    expect(r.toolbar.geometry.overall.verdict).toBe('NOT_APPLICABLE')
    expect(r.diagnostics.multiTarget.verdict).toBe('NOT_APPLICABLE')
  })

  it('passes the collapsed hit test when #write receives the hit', async () => {
    setup({ expanded: false, warningCount: 1, hitTarget: 'write' })
    const r = await probe.createProbe(document, window).run()
    expect(r.collapsedHitTest.verdict).toBe('PASS')
  })

  it('fails the collapsed hit test when a plugin layer blocks #write', async () => {
    setup({ expanded: false, warningCount: 1, hitTarget: 'plugin' })
    const r = await probe.createProbe(document, window).run()
    expect(r.collapsedHitTest.verdict).toBe('FAIL')
    expect(r.collapsedHitTest.blockingCount).toBeGreaterThan(0)
  })
})

describe('GUI acceptance probe — expanded', () => {
  it('validates three equal tabs and header/panel geometry', async () => {
    setup({ expanded: true, warningCount: 1, rows: [{ id: 'w1', severity: 'warning', text: 'w' }] })
    const r = await probe.createProbe(document, window).run()
    expect(r.toolbar.tabWidth.verdict).toBe('PASS')
    expect(r.toolbar.geometry.overall.verdict).toBe('PASS')
    expect(r.diagnostics.projectedRowCount).toBe(1)
    expect(r.diagnostics.rowCoverage.verdict).toBe('PASS')
  })

  it('fails hidden/zero-width tabs instead of returning tabWidthsEqual=true', async () => {
    setup({ expanded: true, tabsVisible: false, warningCount: 1 })
    const r = await probe.createProbe(document, window).run()
    expect(r.toolbar.tabWidth.verdict).toBe('FAIL')
    expect(r.toolbar.tabWidth.reason).toBe('TAB_HIDDEN_OR_ZERO_WIDTH')
  })

  it('fails zero-width tabs even if all three are zero', async () => {
    setup({ expanded: true, tabsVisible: true, tabWidths: [0, 0, 0], warningCount: 1 })
    const r = await probe.createProbe(document, window).run()
    expect(r.toolbar.tabWidth.verdict).toBe('FAIL')
  })

  it('reports column deltas above 1px as FAIL', async () => {
    setup({
      expanded: true, warningCount: 1,
      rowRect: DEFAULT_RECT(100, 50, 360, 40),
      panelRect: DEFAULT_RECT(100, 90, 355, 200),
    })
    const r = await probe.createProbe(document, window).run()
    expect(r.toolbar.geometry.overall.verdict).toBe('FAIL')
    const pair = r.toolbar.geometry.pairs.find((p: any) => p.pair === 'row-vs-panel')
    expect(Math.abs(pair.deltas.width)).toBeGreaterThan(1)
  })

  it('distinguishes a filtered DOM view from full instance counts', async () => {
    setup({
      expanded: true, errorCount: 1, warningCount: 2, hintCount: 1,
      rows: [{ id: 'w1', severity: 'warning', text: 'only warning row' }],
    })
    const r = await probe.createProbe(document, window).run()
    expect(r.diagnostics.instanceTotal).toBe(4)
    expect(r.diagnostics.domRowCount).toBe(1)
    expect(r.diagnostics.projectedRowCount).toBe(1)
    expect(r.diagnostics.domBySeverity).toEqual({ error: 0, warning: 1, hint: 0 })
    expect(r.diagnostics.rowCoverage.reason).toBe('DOM_ROWS_PRESENT')
  })

  it('accepts 1 warning event / 2 targets / 2 display rows', async () => {
    setup({
      expanded: true, warningCount: 1,
      rows: [
        { id: 'multi:w', severity: 'warning', text: 'target 1' },
        { id: 'multi:w', severity: 'warning', text: 'target 2' },
      ],
    })
    const r = await probe.createProbe(document, window).run()
    expect(r.diagnostics.multiTarget.verdict).toBe('PASS')
    expect(r.diagnostics.multiTarget.groups[0].rowCount).toBe(2)
    expect(r.diagnostics.multiTarget.groups[0].id).toBe('multi:w')
  })

  it('does not claim multi-target PASS when only one display row is observable', async () => {
    setup({
      expanded: true, warningCount: 2,
      rows: [{ id: 'multi:w', severity: 'warning', text: 'only one row' }],
    })
    const r = await probe.createProbe(document, window).run()
    expect(r.diagnostics.multiTarget.verdict).toBe('NOT_APPLICABLE')
    expect(r.diagnostics.multiTarget.reason).toBe('NO_MULTI_TARGET_GROUP')
  })

  it('does not treat max-width 860 vs actual 537.6 or bodyRect.height=0 as layout failure', async () => {
    setup({ expanded: true, warningCount: 1, maxWidth: '860px', writeRect: DEFAULT_RECT(100, -10, 537.6, 600) })
    const r = await probe.createProbe(document, window).run()
    expect(r.content.maxWidthComparison.equal).toBe(false)
    expect(r.content.maxWidthComparison.verdict).toBe('NOT_APPLICABLE')
    expect(r.content.writeYNegative).toBe(true)
    expect(r.content.bodyRectHeightZero).toBe(true)
    expect(r.content.layoutModification).toBe('NONE_READ_ONLY')
  })
})
