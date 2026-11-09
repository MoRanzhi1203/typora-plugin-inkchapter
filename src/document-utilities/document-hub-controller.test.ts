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
  it('mounts exactly one transparent 32px hot zone with a 12px square', () => {
    const { controller, mountEl } = mount()
    expect(mountEl.querySelectorAll('.inkchapter-doc-toolbar-ui')).toHaveLength(1)
    const el = status(controller)
    expect(el.style.background).toBe('')
    expect(el.style.boxShadow).toBe('')
    expect(el.style.border).toBe('')
    const square = mountEl.querySelector('.inkchapter-doc-status__square') as HTMLElement
    expect(square).not.toBeNull()
    expect(square.style.backgroundColor).toBe('rgb(207, 34, 46)')
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
    expect(square.style.backgroundColor).toBe('rgb(207, 34, 46)')
  })

  it('does not mark the document locked on focus', () => {
    const { controller } = mount()
    const el = status(controller)
    el.focus()
    el.dispatchEvent(new FocusEvent('focus'))
    expect(el.classList.contains('is-locked')).toBe(false)
    expect(el.dataset.locked).toBe('0')
  })

  it('CSS contract: transparent hot zone, 12px square, 1.5px lock frame, compact list, reduced motion', () => {
    const statusBody = ruleBodies('.inkchapter-doc-status')
    expect(statusBody).toContain('background: transparent')
    expect(statusBody).toContain('box-shadow: none')
    expect(statusBody).toContain('border: 0')
    const squareBody = ruleBodies('.inkchapter-doc-status__square')
    expect(squareBody).toContain('width: 12px')
    expect(squareBody).toContain('height: 12px')
    expect(squareBody).toContain('border-radius: 2px')
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
    expect(layoutBody).toContain('width: 32px')
    expect(layoutBody).toContain('gap: 5px')
    expect(layoutBody).toContain('box-sizing: border-box')
    const expandedBody = ruleBodies('.inkchapter-doc-toolbar-ui[data-expanded="true"] .inkchapter-doc-expand__layout')
    expect(expandedBody).toContain('width: min(360px')

    const headerBody = ruleBodies('.inkchapter-doc-expand__row')
    expect(headerBody).toContain('grid-template-columns: minmax(0, 1fr) 32px')
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

  it('collapsed layout is 32px wide, transparent, and exposes only the status hotspot', () => {
    const { controller } = mount()
    const els = controller.getLayoutElements()
    expect(els.root!.getAttribute('data-expanded')).toBe('false')
    expect((controller.getPanelElement() as HTMLElement).hidden).toBe(true)
    const tabs = els.header!.querySelector('.inkchapter-doc-expand__tabs') as HTMLElement
    expect(tabs.hidden).toBe(true)
    expect(ruleBodies('.inkchapter-doc-expand__layout')).toContain('width: 32px')
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
    expect(text).toContain('1 错误 · 1 警告')
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

  it('clicking a diagnostic row locates it and closes the toolbar', () => {
    const { controller, actions: a } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    ;(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__diag')[1]).click()
    expect(a.locateDiagnostic).toHaveBeenCalledWith('d2')
    expect(controller.isOpen()).toBe(false)
  })

  it('severity filters only filter the view (data unchanged) and keep one container', () => {
    const { controller, mountEl } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    const filters = panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__filter')
    expect(Array.from(filters).map(f => f.dataset['filter'])).toEqual(['all', 'error', 'warning', 'info'])
    ;(Array.from(filters).find(f => f.dataset['filter'] === 'error') as HTMLButtonElement).click()
    expect(controller.getSeverityFilter()).toBe('error')
    expect(panel(controller).querySelectorAll('.inkchapter-doc-expand__diag')).toHaveLength(1)
    expect(mountEl.querySelectorAll('.inkchapter-doc-expand__panel')).toHaveLength(1)
    const all = Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__filter'))
      .find(f => f.dataset['filter'] === 'all')!
    all.click()
    expect(panel(controller).querySelectorAll('.inkchapter-doc-expand__diag')).toHaveLength(2)
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
    expect(panel(controller).textContent).toContain('当前文档没有图片')
    expect(panel(controller).textContent).not.toContain('0 处引用')
  })

  it('lock tab: single line state + real lock action', () => {
    const { controller, actions: a } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    ;(document.querySelectorAll('.inkchapter-doc-expand__tab')[2] as HTMLButtonElement).click()
    expect(panel(controller).textContent).toContain('当前文档可编辑')
    ;(Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__button'))
      .find(b => b.textContent === '锁定') as HTMLButtonElement).click()
    expect(a.toggleLock).toHaveBeenCalledTimes(1)
    controller.update(buildDocumentStatusView(FACTS, true), model(true))
    expect(panel(controller).textContent).toContain('当前文档已锁定')
    expect(panel(controller).textContent).toContain('解锁')
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
