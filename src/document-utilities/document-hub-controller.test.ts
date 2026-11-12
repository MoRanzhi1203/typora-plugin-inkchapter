// @vitest-environment jsdom
/**
 * V5.2 — 一体化文档状态工具栏 + 直接诊断列表。
 *
 * 覆盖：
 *  - 收起仅纯色方块（无白壳/背景/边框/阴影）+ 透明 32px 热区
 *  - 锁定仅细外框且颜色不变；焦点不触发锁定
 *  - 单击展开/收起；双击只切换一次锁定
 *  - 展开后直接渲染诊断列表（无摘要过渡页、无「详情」「返回」按钮）
 *  - 列表行 = 真实快照；筛选只做视图过滤；点击行调用真实定位后收起
 *  - 图片/锁定标签保持；Esc/外部关闭；单实例；不进入 #write
 *  - CSS 契约（透明热区、12px 方块、1.5px 锁框、紧凑列表、reduced-motion）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentHubController } from './document-hub-controller'
import { buildDocumentHubModel, type DocumentHubDiagnosticItem } from './document-hub-model'
import { buildDocumentStatusView, type DocumentStatusFacts } from './document-status-indicator'

const SCSS = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
// Comments between rules otherwise glue onto the following selector chunk and
// hide the real rule from `ruleBodies` — strip them, like the OVERLAY/DENSITY
// suites already do. Assertions are unchanged (no relaxation).
const SCSS_RULES = SCSS.replace(/\/\*[\s\S]*?\*\//g, '')
function ruleBodies(selector: string): string {
  const out: string[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(SCSS_RULES)) !== null) {
    const sels = m[1].split(',').map(s => s.trim())
    if (sels.includes(selector)) out.push(m[2])
  }
  return out.join('\n')
}

const FACTS: DocumentStatusFacts = {
  hasDocument: true,
  diagnosticsEnabled: true,
  checking: false,
  structuralVerified: true,
  hasProjection: true,
  errorCount: 1,
  warningCount: 1,
  hintCount: 0,
}

const DIAGNOSTICS: readonly DocumentHubDiagnosticItem[] = [
  { id: 'd1', severity: 'error', title: '未闭合代码围栏', detail: '缺少结束标记', line: 3 },
  { id: 'd2', severity: 'warning', title: '标题层级跳跃', detail: 'H1 后直接 H3', line: 7 },
]

const IMAGE = {
  enabled: true,
  referenceCount: 4,
  localCount: 2,
  remoteCount: 2,
  reuseLocalCount: 1,
  reuseRemoteCount: 1,
  pendingUploadCount: 1,
  pendingDownloadCount: 1,
  missingLocalCount: 2,
  dualLinkCompleteCount: 0,
  policyText: '引用 本地相对路径 · GitHub 上传 · 自动：关闭',
  scopeSource: 'document' as const,
  scopeLabel: '覆盖：当前文档',
  projectDirectory: 'D:/vault/assets/images',
  insertionModeText: '复制到 ./assets',
  autoSyncText: '关闭',
}

function model(locked = false, image: typeof IMAGE | null = IMAGE, diagnostics = DIAGNOSTICS) {
  return buildDocumentHubModel({
    documentPath: 'D:/vault/notes/doc.md',
    saved: true,
    status: buildDocumentStatusView(FACTS, locked),
    locked,
    image,
    diagnosticsAvailable: true,
    diagnostics,
  })
}

function actions() {
  return {
    recheck: vi.fn(),
    toggleLock: vi.fn(),
    uploadAll: vi.fn(),
    downloadAll: vi.fn(),
    dualLink: vi.fn(),
    openImageSettings: vi.fn(),
    locateDiagnostic: vi.fn(),
  }
}

function mount() {
  const mountEl = document.createElement('div')
  document.body.appendChild(mountEl)
  const a = actions()
  const controller = new DocumentHubController({ mountEl, actions: a, doubleClickWindowMs: 260 })
  controller.mount()
  controller.update(buildDocumentStatusView(FACTS, false), model())
  return { controller, mountEl, actions: a }
}

function status(controller: DocumentHubController): HTMLButtonElement {
  return controller.getStatusElement() as HTMLButtonElement
}

function panel(controller: DocumentHubController): HTMLElement {
  return controller.getPanelElement()!
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('V5.2 collapsed status square', () => {
  it('mounts exactly one transparent 32px hot zone with a 15px square', () => {
    const { controller, mountEl } = mount()
    expect(mountEl.querySelectorAll('.inkchapter-doc-toolbar-ui')).toHaveLength(1)
    const el = status(controller)
    expect(el.style.background).toBe('')
    expect(el.style.boxShadow).toBe('')
    expect(el.style.border).toBe('')
    const square = mountEl.querySelector('.inkchapter-doc-status__square') as HTMLElement
    expect(square).not.toBeNull()
    expect(square.style.backgroundColor).toBe('rgb(210, 77, 87)')
  })

  it('keeps the lock frame neutral + color-stable', () => {
    const { controller, mountEl } = mount()
    controller.update(buildDocumentStatusView({ ...FACTS, errorCount: 3 }, true), model(true))
    const el = status(controller)
    expect(el.dataset.status).toBe('RED')
    expect(el.classList.contains('is-locked')).toBe(true)
    const frame = mountEl.querySelector('.inkchapter-doc-status__lock-frame') as HTMLElement
    expect(frame.style.borderColor.toLowerCase()).toBe('currentcolor')
    const square = mountEl.querySelector('.inkchapter-doc-status__square') as HTMLElement
    expect(square.style.backgroundColor).toBe('rgb(210, 77, 87)')
  })

  it('does not mark the document locked on focus', () => {
    const { controller } = mount()
    const el = status(controller)
    el.focus()
    el.dispatchEvent(new FocusEvent('focus'))
    expect(el.classList.contains('is-locked')).toBe(false)
    expect(el.dataset.locked).toBe('0')
  })

  it('CSS contract: transparent hot zone, 15px square, 1.5px lock frame, compact list, reduced motion', () => {
    const statusBody = ruleBodies('.inkchapter-doc-status')
    expect(statusBody).toContain('background: transparent')
    expect(statusBody).toContain('box-shadow: none')
    expect(statusBody).toContain('border: 0')
    const squareBody = ruleBodies('.inkchapter-doc-status__square')
    expect(squareBody).toContain('width: 15px')
    expect(squareBody).toContain('height: 15px')
    expect(squareBody).toContain('border-radius: 3px')
    const frameBody = ruleBodies('.inkchapter-doc-status__lock-frame')
    expect(frameBody).toContain('1.5px solid transparent')
    expect(SCSS).toContain('prefers-reduced-motion')
    expect(ruleBodies('.inkchapter-doc-expand__tabs').length).toBeGreaterThan(0)
    expect(ruleBodies('.inkchapter-doc-expand__panel').length).toBeGreaterThan(0)
    expect(ruleBodies('.inkchapter-doc-expand__diag')).toMatch(/padding/)
    expect(ruleBodies('.inkchapter-doc-expand__list')).toContain('max-height')
  })
})

describe('V5.2 single equal-width layout authority', () => {
  it('header and content are the two 100% children of the ONE layout; status hotspot is inside header', () => {
    const { controller, mountEl } = mount()
    const els = controller.getLayoutElements()
    expect(els.layout).not.toBeNull()
    expect(els.header!.parentElement).toBe(els.layout)
    expect(els.content!.parentElement).toBe(els.layout)
    expect(els.layout!.children).toHaveLength(2)
    expect(els.header!.children).toHaveLength(2)
    expect(status(controller).parentElement).toBe(els.header)
    expect(els.header!.querySelector('.inkchapter-doc-expand__tabs')).not.toBeNull()
    expect(mountEl.querySelectorAll('.inkchapter-doc-expand__layout')).toHaveLength(1)
    expect(mountEl.querySelectorAll('.inkchapter-doc-expand__panel')).toHaveLength(1)
  })

  it('CSS: layout is the only width authority; header/content both width:100% + border-box', () => {
    const layoutBody = ruleBodies('.inkchapter-doc-expand__layout')
    expect(layoutBody).toContain('width: 40px')
    expect(layoutBody).toContain('gap: 4px')
    expect(layoutBody).toContain('box-sizing: border-box')
    const expandedBody = ruleBodies('.inkchapter-doc-toolbar-ui[data-expanded="true"] .inkchapter-doc-expand__layout')
    expect(expandedBody).toContain('width: min(360px')

    const headerBody = ruleBodies('.inkchapter-doc-expand__row')
    expect(headerBody).toContain('grid-template-columns: minmax(0, 1fr) 38px')
    expect(headerBody).toContain('width: 100%')
    expect(headerBody).toContain('box-sizing: border-box')

    const contentBody = ruleBodies('.inkchapter-doc-expand__panel')
    expect(contentBody).toContain('width: 100%')
    expect(contentBody).toContain('box-sizing: border-box')
    expect(contentBody).not.toContain('max-width: 320px')

    const tabsBody = ruleBodies('.inkchapter-doc-expand__tabs')
    expect(tabsBody).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(tabsBody).toContain('width: 100%')
    // Author `display: grid` beats UA [hidden]; the collapsed state must win.
    expect(ruleBodies('.inkchapter-doc-expand__tabs[hidden]')).toContain('display: none')

    // Exactly one right/top anchor is written by the controller (root only).
    expect(ruleBodies('.inkchapter-doc-expand__row')).not.toContain('position: fixed')
    expect(ruleBodies('.inkchapter-doc-expand__panel')).not.toContain('right:')
    expect(ruleBodies('.inkchapter-doc-expand__panel')).not.toContain('left:')
  })

  it('collapsed layout is 40px wide, transparent, and exposes only the status hotspot', () => {
    const { controller } = mount()
    const els = controller.getLayoutElements()
    expect(els.root!.getAttribute('data-expanded')).toBe('false')
    expect((controller.getPanelElement() as HTMLElement).hidden).toBe(true)
    const tabs = els.header!.querySelector('.inkchapter-doc-expand__tabs') as HTMLElement
    expect(tabs.hidden).toBe(true)
    expect(ruleBodies('.inkchapter-doc-expand__layout')).toContain('width: 40px')
    expect(ruleBodies('.inkchapter-doc-expand__layout')).toContain('background: transparent')
  })

  it('tab switches rebuild only the single content panel (top-level layout unchanged)', () => {
    const { controller, mountEl } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    const layout = controller.getLayoutElements().layout
    for (const tab of ['images', 'lock', 'diagnostics'] as const) {
      ;(document.querySelectorAll(`.inkchapter-doc-expand__tab[data-tab="${tab}"]`)[0] as HTMLButtonElement).click()
      expect(controller.getLayoutElements().layout).toBe(layout)
      expect(mountEl.querySelectorAll('.inkchapter-doc-expand__layout')).toHaveLength(1)
      expect(mountEl.querySelectorAll('.inkchapter-doc-expand__panel')).toHaveLength(1)
      expect(controller.getLayoutElements().header!.parentElement).toBe(layout)
      expect(controller.getLayoutElements().content!.parentElement).toBe(layout)
    }
  })

  it('measureLayout reports left/right/width deltas (mock rects prove the comparison contract)', () => {
    const { controller } = mount()
    const els = controller.getLayoutElements()
    const rect = (left: number, width: number) => ({
      left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0,
      toJSON: () => ({}),
    }) as DOMRect
    els.header!.getBoundingClientRect = () => rect(100, 360)
    els.content!.getBoundingClientRect = () => rect(100, 360)
    expect(controller.measureLayout()!.deltas).toEqual({ left: 0, right: 0, width: 0 })
    els.content!.getBoundingClientRect = () => rect(102, 356)
    const drift = controller.measureLayout()!.deltas
    expect(drift.left).toBe(2)
    expect(drift.right).toBe(2)
    expect(drift.width).toBe(4)
  })

  it('keyboard arrows move tab focus across the three equal tabs', () => {
    const { controller } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    const first = document.querySelector<HTMLButtonElement>('.inkchapter-doc-expand__tab[data-tab="diagnostics"]')!
    first.focus()
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(controller.getActiveTab()).toBe('images')
    expect(document.querySelector<HTMLButtonElement>('.inkchapter-doc-expand__tab[data-tab="images"]')!.tabIndex).toBe(0)
  })
})

describe('V5.2 single-click expand / double-click lock arbitration', () => {
  it('single click expands after the arbitration window and a second single click collapses', () => {
    const { controller } = mount()
    status(controller).click()
    expect(controller.isOpen()).toBe(false)
    vi.advanceTimersByTime(300)
    expect(controller.isOpen()).toBe(true)
    expect(controller.getActiveTab()).toBe('diagnostics')
    status(controller).click()
    vi.advanceTimersByTime(300)
    expect(controller.isOpen()).toBe(false)
  })

  it('double click toggles lock exactly once and never expands', () => {
    const { controller, actions: a } = mount()
    const el = status(controller)
    el.click()
    el.click()
    vi.advanceTimersByTime(400)
    expect(a.toggleLock).toHaveBeenCalledTimes(1)
    expect(controller.isOpen()).toBe(false)
  })

  it('does not fake a locked state when the lock action fails', () => {
    const { controller } = mount()
    const el = status(controller)
    el.click()
    el.click()
    expect(el.classList.contains('is-locked')).toBe(false)
    expect(el.dataset.locked).toBe('0')
  })

  it('Escape and outside mousedown close the toolbar', () => {
    const { controller } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    expect(controller.isOpen()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(controller.isOpen()).toBe(false)
    status(controller).click()
    vi.advanceTimersByTime(300)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(controller.isOpen()).toBe(false)
  })
})

describe('V5.2 diagnostics list (no summary page)', () => {
  it('expands directly into the diagnostic list (no summary / 详情 / 返回)', () => {
    const { controller } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    const text = panel(controller).textContent ?? ''
    expect(text).not.toContain('详情')
    expect(text).not.toContain('返回')
    // V5.2 layout redesign: the compact REAL-count overview is the only
    // summary; the old summary→detail→back page stays gone.
    expect(text).toContain('1 项错误 · 1 项警告')
    expect(text).not.toContain('文档检测')
    expect(panel(controller).querySelector('.inkchapter-doc-expand__overview')).not.toBeNull()
    const rows = panel(controller).querySelectorAll('.inkchapter-doc-expand__diag')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('data-diagnostic-id')).toBe('d1')
    expect(rows[1].getAttribute('data-diagnostic-id')).toBe('d2')
    expect(rows[0].textContent).toContain('未闭合代码围栏')
    expect(rows[0].textContent).toContain('L3')
    expect(rows[1].textContent).toContain('L7')
  })

  it('every row keeps Lxx when there is no fix, including info and 5-digit lines', () => {
    const { controller } = mount()
    controller.update(
      buildDocumentStatusView(FACTS, false),
      model(false, IMAGE, [
        { id: 'i1', severity: 'info', title: '章节没有正文', detail: '', line: 12, ruleId: 'SECTION_EMPTY' },
        { id: 'e1', severity: 'error', title: '图片资源不存在', detail: '', line: 12345, ruleId: 'FIGURE_LOCAL_IMAGE_MISSING' },
      ]),
    )
    status(controller).click()
    vi.advanceTimersByTime(300)
    const rows = panel(controller).querySelectorAll<HTMLElement>('.inkchapter-doc-expand__diag')
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('.inkchapter-doc-expand__diag-loc')!.textContent).toBe('L12')
    expect(rows[1].querySelector('.inkchapter-doc-expand__diag-loc')!.textContent).toBe('L12345')
    // info without a fix still owns its line cell
    expect(rows[0].querySelector('.inkchapter-doc-expand__diag-fix')).toBeNull()
    expect(rows[1].querySelector('.inkchapter-doc-expand__diag-fix')).toBeNull()
  })

  it('clicking a diagnostic row locates it and closes the toolbar', () => {
    const { controller, actions: a } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    ;(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__diag')[1]).click()
    expect(a.locateDiagnostic).toHaveBeenCalledWith('d2')
    expect(controller.isOpen()).toBe(false)
  })

  it('severity filter popup only filters the view, keeps one container, and closes', () => {
    const { controller, mountEl } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    // Fluent Compact: no row of four cramped filter buttons by default.
    expect(panel(controller).querySelectorAll('.inkchapter-doc-expand__filter-option')).toHaveLength(0)
    const filterButton = panel(controller).querySelector<HTMLButtonElement>('.inkchapter-doc-expand__filter-button')!
    expect(filterButton).not.toBeNull()
    filterButton.click()
    expect(controller.isFilterPopupOpen()).toBe(true)
    const options = panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__filter-option')
    expect(Array.from(options).map(o => o.dataset['filter'])).toEqual(['all', 'error', 'warning', 'info'])
    expect(options[0].getAttribute('aria-checked')).toBe('true')
    ;(Array.from(options).find(o => o.dataset['filter'] === 'error') as HTMLButtonElement).click()
    expect(controller.getSeverityFilter()).toBe('error')
    expect(controller.isFilterPopupOpen()).toBe(false)
    expect(panel(controller).querySelectorAll('.inkchapter-doc-expand__diag')).toHaveLength(1)
    // Filtering only narrows the view: the real total summary must not shrink.
    expect(panel(controller).querySelector('.inkchapter-doc-expand__summary')?.textContent)
      .toContain('1 项错误 · 1 项警告')
    expect(mountEl.querySelectorAll('.inkchapter-doc-expand__panel')).toHaveLength(1)
    // Reopen and restore "all".
    panel(controller).querySelector<HTMLButtonElement>('.inkchapter-doc-expand__filter-button')!.click()
    ;(Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__filter-option'))
      .find(o => o.dataset['filter'] === 'all') as HTMLButtonElement).click()
    expect(panel(controller).querySelectorAll('.inkchapter-doc-expand__diag')).toHaveLength(2)
  })

  it('filter popup closes on Escape and on a click inside the panel, never closing the toolbar', () => {
    const { controller } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    panel(controller).querySelector<HTMLButtonElement>('.inkchapter-doc-expand__filter-button')!.click()
    expect(controller.isFilterPopupOpen()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(controller.isFilterPopupOpen()).toBe(false)
    expect(controller.isOpen()).toBe(true)

    panel(controller).querySelector<HTMLButtonElement>('.inkchapter-doc-expand__filter-button')!.click()
    panel(controller).querySelector('.inkchapter-doc-expand__list')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(controller.isFilterPopupOpen()).toBe(false)
    expect(controller.isOpen()).toBe(true)
  })

  it('empty filtered result says "没有匹配项" instead of claiming a clean scan', () => {
    const { controller } = mount()
    controller.update(
      buildDocumentStatusView({ ...FACTS, warningCount: 0 }, false),
      model(false, IMAGE, [DIAGNOSTICS[0]]),
    )
    status(controller).click()
    vi.advanceTimersByTime(300)
    panel(controller).querySelector<HTMLButtonElement>('.inkchapter-doc-expand__filter-button')!.click()
    ;(Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__filter-option'))
      .find(o => o.dataset['filter'] === 'warning') as HTMLButtonElement).click()
    expect(panel(controller).textContent).toContain('没有匹配项')
    expect(panel(controller).textContent).not.toContain('未发现问题')
  })

  it('unchecked/unknown document says 未检查 instead of claiming a clean scan', () => {
    const { controller } = mount()
    controller.update(
      buildDocumentStatusView({ ...FACTS, hasProjection: false }, false),
      model(false, IMAGE, []),
    )
    status(controller).click()
    vi.advanceTimersByTime(300)
    expect(panel(controller).textContent).toContain('未检查')
    expect(panel(controller).textContent).not.toContain('未发现问题')
    expect(panel(controller).querySelectorAll('.inkchapter-doc-expand__diag')).toHaveLength(0)
  })

  it('shows an empty state when the snapshot has no diagnostics', () => {
    const { controller } = mount()
    controller.update(buildDocumentStatusView({ ...FACTS, errorCount: 0, warningCount: 0 }, false), model(false, IMAGE, []))
    status(controller).click()
    vi.advanceTimersByTime(300)
    expect(panel(controller).textContent).toContain('未发现问题')
    expect(panel(controller).querySelectorAll('.inkchapter-doc-expand__diag')).toHaveLength(0)
  })
})

describe('V5.2 images / lock tabs unchanged', () => {
  it('images tab: disabled compact line, then real batch callbacks', () => {
    const { controller, actions: a } = mount()
    controller.update(buildDocumentStatusView(FACTS, false), model(false, { ...IMAGE, enabled: false }))
    status(controller).click()
    vi.advanceTimersByTime(300)
    ;(document.querySelectorAll('.inkchapter-doc-expand__tab')[1] as HTMLButtonElement).click()
    expect(panel(controller).textContent).toContain('图片管理未启用')
    ;(Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__button'))
      .find(b => b.textContent === '配置') as HTMLButtonElement).click()
    expect(a.openImageSettings).toHaveBeenCalledTimes(1)

    controller.update(buildDocumentStatusView(FACTS, false), model())
    ;(document.querySelectorAll('.inkchapter-doc-expand__tab')[1] as HTMLButtonElement).click()
    expect(panel(controller).textContent).toContain('覆盖：当前文档 · 4 处引用')
    ;(Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__button'))
      .find(b => b.textContent === '上传全部') as HTMLButtonElement).click()
    expect(a.uploadAll).toHaveBeenCalledTimes(1)
  })

  it('images tab: empty document shows a compact empty state without zero counts', () => {
    const { controller } = mount()
    controller.update(
      buildDocumentStatusView(FACTS, false),
      model(false, { ...IMAGE, referenceCount: 0, localCount: 0, remoteCount: 0, pendingUploadCount: 0, pendingDownloadCount: 0 }),
    )
    status(controller).click()
    vi.advanceTimersByTime(300)
    ;(document.querySelectorAll('.inkchapter-doc-expand__tab')[1] as HTMLButtonElement).click()
    expect(panel(controller).textContent).toContain('当前文档无图片')
    expect(panel(controller).textContent).not.toContain('0 处引用')
  })

  it('images tab: preview-supported resource facts separate missing from uploadable', () => {
    const { controller } = mount()
    controller.update(
      buildDocumentStatusView(FACTS, false),
      model(false, {
        ...IMAGE,
        referenceCount: 3,
        pendingUploadCount: 1,
        pendingDownloadCount: 0,
        missingLocalCount: 2,
        reuseLocalCount: 0,
        reuseRemoteCount: 0,
      }),
    )
    status(controller).click()
    vi.advanceTimersByTime(300)
    ;(document.querySelectorAll('.inkchapter-doc-expand__tab')[1] as HTMLButtonElement).click()
    const text = panel(controller).textContent ?? ''
    expect(text).toContain('覆盖：当前文档 · 3 处引用')
    expect(text).toContain('可上传 1')
    expect(text).toContain('缺失 2')
    expect(text).not.toContain('可上传 3')
    expect(text).not.toContain('可复用')
  })

  it('switching detection/image/lock tabs never changes the diagnostic colour', () => {
    const { controller } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    const before = status(controller).dataset['status']
    const beforeColor = (controller.getStatusElement()!.querySelector('.inkchapter-doc-status__square') as HTMLElement).style.backgroundColor
    for (const index of [1, 2, 0]) {
      ;(document.querySelectorAll('.inkchapter-doc-expand__tab')[index] as HTMLButtonElement).click()
      expect(status(controller).dataset['status']).toBe(before)
      const square = controller.getStatusElement()!.querySelector('.inkchapter-doc-status__square') as HTMLElement
      expect(square.style.backgroundColor).toBe(beforeColor)
    }
  })

  it('lock tab: single line state + real lock action', () => {
    const { controller, actions: a } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    ;(document.querySelectorAll('.inkchapter-doc-expand__tab')[2] as HTMLButtonElement).click()
    expect(panel(controller).textContent).toContain('编辑中')
    expect(panel(controller).querySelector('.inkchapter-doc-expand__lock-icon')).not.toBeNull()
    ;(Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__button'))
      .find(b => b.textContent === '锁定') as HTMLButtonElement).click()
    expect(a.toggleLock).toHaveBeenCalledTimes(1)
    controller.update(buildDocumentStatusView(FACTS, true), model(true))
    expect(panel(controller).textContent).toContain('已锁定')
    expect(panel(controller).textContent).toContain('解锁')
  })
})

describe('V5.2 Fluent Compact visual contract', () => {
  it('defines scoped Fluent tokens for light and dark themes', () => {
    const rootBody = ruleBodies('.inkchapter-doc-toolbar-ui')
    // U1 — pure-white surface, black/gray hierarchy, light neutral selection.
    expect(rootBody).toContain('--ink-doc-surface: #ffffff')
    expect(rootBody).toContain('--ink-doc-hairline: #dee2e7')
    expect(rootBody).toContain('--ink-doc-divider: #eef0f2')
    expect(rootBody).toContain('--ink-doc-text: #24272d')
    expect(rootBody).toContain('--ink-doc-secondary: #626a75')
    expect(rootBody).toContain('--ink-doc-action: #454b55')
    expect(rootBody).toContain('--ink-doc-loc: #737b86')
    expect(rootBody).toContain('--ink-doc-selection: #f1f2f4')
    expect(rootBody).toContain('--ink-doc-hover: #f7f8fa')
    expect(rootBody).toContain('--ink-doc-warning: #d49a26')
    expect(rootBody).toContain('--ink-doc-error: #d24d57')
    expect(rootBody).toContain('--ink-doc-success: #2f986d')
    expect(rootBody).toContain('--ink-doc-hint: #66869f')
    expect(rootBody).toContain('--ink-doc-radius: 6px')
    // Dark theme overrides the same scoped surface token, not a second panel.
    expect(SCSS).toContain('--ink-doc-surface: #1f2021')
    expect(SCSS).toContain('--ink-doc-text: #e9eaec')
  })

  it('header is 36px tall; square is 15px inside a 32px hit region with a separate lock outline', () => {
    expect(ruleBodies('.inkchapter-doc-expand__row')).toContain('height: 36px')
    const statusBody = ruleBodies('.inkchapter-doc-status')
    expect(statusBody).toContain('width: 32px')
    expect(statusBody).toContain('height: 32px')
    expect(ruleBodies('.inkchapter-doc-status__square')).toContain('width: 15px')
    expect(ruleBodies('.inkchapter-doc-status__lock-frame')).toContain('width: 22px')
  })

  it('panel uses the one quiet Fluent surface with a 1px hairline and 6px radius', () => {
    const layoutBody = ruleBodies('.inkchapter-doc-expand__layout')
    expect(layoutBody).toContain('border: 1px solid transparent')
    expect(layoutBody).toContain('border-radius: var(--ink-doc-radius)')
    const expandedBody = ruleBodies('.inkchapter-doc-toolbar-ui[data-expanded="true"] .inkchapter-doc-expand__layout')
    expect(expandedBody).toContain('background: var(--ink-doc-surface)')
    expect(expandedBody).toContain('border-color: var(--ink-doc-hairline)')
    expect(expandedBody).not.toContain('box-shadow')
    expect(ruleBodies('.inkchapter-doc-expand__panel')).toContain('padding: 12px')
  })

  it('image primary actions are an equal two-column grid; filter is a popup menu', () => {
    expect(ruleBodies('.inkchapter-doc-expand__actions.is-primary-actions'))
      .toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(ruleBodies('.inkchapter-doc-expand__filter-popup')).toContain('position: absolute')
    expect(ruleBodies('.inkchapter-doc-expand__filter-option')).toContain('grid-template-columns')
    // The old inline four-button filter row must not come back.
    expect(ruleBodies('.inkchapter-doc-expand__filter')).not.toContain('display:')
  })

  it('diagnostics use a stable 48px right-aligned location cell + 44px fix action', () => {
    const diagBody = ruleBodies('.inkchapter-doc-expand__diag')
    expect(diagBody).toContain('grid-template-columns: 6px minmax(0, 1fr) 48px 44px')
    expect(ruleBodies('.inkchapter-doc-expand__diag-loc')).toContain('text-align: right')
    // The fix action is a low-emphasis but ALWAYS reachable entry (touch too).
    expect(ruleBodies('.inkchapter-doc-expand__diag-fix')).toContain('font-size: 11px')
  })
})

describe('V5.2 lifecycle / isolation', () => {
  it('stays outside #write and disposes its DOM and listeners', () => {
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
    const { controller, mountEl } = mount()
    expect(write.querySelector('.inkchapter-doc-status')).toBeNull()
    expect(mountEl.closest('#write')).toBeNull()
    controller.dispose()
    expect(document.querySelector('.inkchapter-doc-toolbar-ui')).toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(controller.isOpen()).toBe(false)
  })

  it('keeps a single instance even if mount is called repeatedly', () => {
    const { controller, mountEl } = mount()
    controller.mount()
    controller.mount()
    expect(mountEl.querySelectorAll('.inkchapter-doc-toolbar-ui')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-status')).toHaveLength(1)
  })

  it('closes when the host reports a document switch (close contract)', () => {
    const { controller } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    expect(controller.isOpen()).toBe(true)
    controller.close()
    expect(controller.isOpen()).toBe(false)
  })
})

describe('F3 — row-level fix entries', () => {
  const FIXED: readonly DocumentHubDiagnosticItem[] = [
    { id: 'a', severity: 'warning', title: '连续空行过多', detail: '建议压缩', line: 4, ruleId: 'EXCESSIVE_INTERNAL_BLANK_LINES', fix: { capability: 'AUTO_SAFE', label: '压缩连续空行' } },
    { id: 'b', severity: 'warning', title: '连续空行过多', detail: '建议压缩', line: 9, ruleId: 'EXCESSIVE_INTERNAL_BLANK_LINES', fix: { capability: 'AUTO_SAFE', label: '压缩连续空行' } },
    { id: 'c', severity: 'info', title: '标题跳跃', detail: '', line: 12, ruleId: 'HEADING_LEVEL_GAP' },
  ]

  function mountFixed(locked = false, fixBusy = false) {
    const mountEl = document.createElement('div')
    document.body.appendChild(mountEl)
    const a = {
      recheck: vi.fn(), toggleLock: vi.fn(), uploadAll: vi.fn(), downloadAll: vi.fn(),
      dualLink: vi.fn(), openImageSettings: vi.fn(), locateDiagnostic: vi.fn(),
      fixDiagnostic: vi.fn(), fixAllAuto: vi.fn(),
    }
    const controller = new DocumentHubController({ mountEl, actions: a, doubleClickWindowMs: 260 })
    controller.mount()
    controller.update(buildDocumentStatusView(FACTS, locked), buildDocumentHubModel({
      documentPath: 'D:/vault/notes/doc.md',
      saved: true,
      status: buildDocumentStatusView(FACTS, locked),
      locked,
      image: null,
      diagnosticsAvailable: true,
      diagnostics: FIXED,
      autoFixableCount: 2,
      fixBusy,
    }))
    controller.open()
    return { controller, mountEl, actions: a }
  }

  it('renders a fix action only on rules with a real capability', () => {
    const { controller } = mountFixed()
    const rows = Array.from(panel(controller).querySelectorAll<HTMLElement>('.inkchapter-doc-expand__diag'))
    expect(rows[0].querySelector('.inkchapter-doc-expand__diag-fix')).not.toBeNull()
    expect(rows[2].querySelector('.inkchapter-doc-expand__diag-fix')).toBeNull()
  })

  it('fix click never triggers the row locate (no double jump)', () => {
    const { controller, actions: a } = mountFixed()
    const fix = panel(controller).querySelector<HTMLButtonElement>('.inkchapter-doc-expand__diag-fix')!
    fix.click()
    expect(a.fixDiagnostic).toHaveBeenCalledWith('a')
    expect(a.locateDiagnostic).not.toHaveBeenCalled()
    expect(controller.isOpen()).toBe(true)
  })

  it('keeps exactly ONE action per row (same-rule lives inside the preview)', () => {
    const { controller } = mountFixed()
    const rows = Array.from(panel(controller).querySelectorAll<HTMLElement>('.inkchapter-doc-expand__diag'))
    for (const row of rows) {
      expect(row.querySelectorAll('.inkchapter-doc-expand__diag-fix').length).toBeLessThanOrEqual(1)
    }
    expect(panel(controller).querySelectorAll('.inkchapter-doc-expand__diag-fix.is-same-rule')).toHaveLength(0)
  })

  it('the auto-fix row reports the REAL planned count and disables while locked', () => {
    const { controller } = mountFixed(true)
    const text = panel(controller).textContent ?? ''
    expect(text).toContain('2 项可自动修复')
    const all = Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__button'))
      .find(b => b.textContent === '一键修复可处理项')!
    expect(all.disabled).toBe(true)
    expect(all.title).toContain('已锁定')
    // Row actions are disabled under the same lock.
    const fix = panel(controller).querySelector<HTMLButtonElement>('.inkchapter-doc-expand__diag-fix')!
    expect(fix.disabled).toBe(true)
  })
})

describe('S1 — view sort menu', () => {
  const ITEMS: readonly DocumentHubDiagnosticItem[] = [
    { id: 'w', severity: 'warning', title: '连续空行过多', line: 3, ruleId: 'Z_RULE' },
    { id: 'e', severity: 'error', title: '围栏未闭合', line: 9, ruleId: 'A_RULE' },
    { id: 'i', severity: 'info', title: '标题跳跃', line: 12, ruleId: 'M_RULE' },
  ]

  function mountSortable() {
    const mountEl = document.createElement('div')
    document.body.appendChild(mountEl)
    const a = { ...actions(), fixDiagnostic: vi.fn(), fixAllAuto: vi.fn() }
    const controller = new DocumentHubController({ mountEl, actions: a, doubleClickWindowMs: 260 })
    controller.mount()
    controller.update(buildDocumentStatusView(FACTS, false), buildDocumentHubModel({
      documentPath: 'D:/vault/notes/doc.md',
      saved: true,
      status: buildDocumentStatusView(FACTS, false),
      locked: false,
      image: null,
      diagnosticsAvailable: true,
      diagnostics: ITEMS,
    }))
    controller.open()
    return { controller }
  }

  function renderedIds(controller: DocumentHubController): (string | null)[] {
    return Array.from(panel(controller).querySelectorAll<HTMLElement>('.inkchapter-doc-expand__diag'))
      .map(row => row.dataset['diagnosticId'] ?? null)
  }

  it('offers document / severity / rule sorts and keeps the document order by default', () => {
    const { controller } = mountSortable()
    expect(renderedIds(controller)).toEqual(['w', 'e', 'i'])
    const sortButton = panel(controller).querySelector<HTMLButtonElement>('.inkchapter-doc-expand__sort-button')!
    sortButton.click()
    const options = Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__filter-option'))
    expect(options.map(o => o.dataset['sort'])).toEqual(['document', 'document-desc', 'severity', 'rule'])
  })

  it('severity / rule sorts are VIEW-ONLY (counts and filter results unchanged)', () => {
    const { controller } = mountSortable()
    panel(controller).querySelector<HTMLButtonElement>('.inkchapter-doc-expand__sort-button')!.click()
    const severity = Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__filter-option'))
      .find(o => o.dataset['sort'] === 'severity')!
    severity.click()
    expect(controller.getSortMode()).toBe('severity')
    expect(renderedIds(controller)).toEqual(['e', 'w', 'i'])
    // The authoritative summary is untouched by the view sort.
    expect(panel(controller).querySelector('.inkchapter-doc-expand__summary')?.textContent)
      .toContain('1 项错误 · 1 项警告')

    panel(controller).querySelector<HTMLButtonElement>('.inkchapter-doc-expand__sort-button')!.click()
    const rule = Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__filter-option'))
      .find(o => o.dataset['sort'] === 'rule')!
    rule.click()
    expect(controller.getSortMode()).toBe('rule')
    expect(renderedIds(controller)).toEqual(['e', 'i', 'w'])
  })
})
