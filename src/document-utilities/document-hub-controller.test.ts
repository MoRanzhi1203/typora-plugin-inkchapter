// @vitest-environment jsdom
/**
 * V5.2 — 可展开文档状态工具栏（ExpandableDocumentStatusToolbar）契约。
 *
 * 覆盖：
 *  - 收起仅纯色方块（无白壳/背景/边框/阴影）+ 透明 32px 热区
 *  - 锁定仅细外框且颜色不变；焦点不触发锁定
 *  - 单击展开/收起；双击只切换一次锁定（手势仲裁）
 *  - 三个标签共用一个内容区、默认检测；详情在容器内部切换
 *  - 图片标签压缩状态与真实回调/禁用原因
 *  - Esc / 外部点击 / 文档切换关闭；dispose 释放监听；单实例
 *  - 不进入 #write
 *  - CSS 契约（透明热区、12px 方块、1.5px 锁框、reduced-motion）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentHubController } from './document-hub-controller'
import { buildDocumentHubModel } from './document-hub-model'
import { buildDocumentStatusView, type DocumentStatusFacts } from './document-status-indicator'

const SCSS = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
function ruleBodies(selector: string): string {
  const out: string[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(SCSS)) !== null) {
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
  errorCount: 0,
  warningCount: 2,
  hintCount: 1,
}

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

function model(locked = false, image: typeof IMAGE | null = IMAGE) {
  return buildDocumentHubModel({
    documentPath: 'D:/vault/notes/doc.md',
    saved: true,
    status: buildDocumentStatusView(FACTS, locked),
    locked,
    image,
    diagnosticsAvailable: true,
    diagnostics: [
      { id: 'd1', severity: 'error', message: '错误一' },
      { id: 'd2', severity: 'warning', message: '警告一' },
    ],
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
    const nodes = mountEl.querySelectorAll('.inkchapter-doc-toolbar-ui')
    expect(nodes).toHaveLength(1)
    const el = status(controller)
    expect(el.style.background).toBe('')
    expect(el.style.boxShadow).toBe('')
    expect(el.style.border).toBe('')
    const square = mountEl.querySelector('.inkchapter-doc-status__square') as HTMLElement
    expect(square).not.toBeNull()
    expect(square.style.backgroundColor).toBe('rgb(210, 153, 34)')
  })

  it('maps status colors and keeps the lock frame neutral + color-stable', () => {
    const { controller, mountEl } = mount()
    controller.update(buildDocumentStatusView({ ...FACTS, errorCount: 3 }, true), model(true))
    const el = status(controller)
    expect(el.dataset.status).toBe('RED')
    expect(el.classList.contains('is-locked')).toBe(true)
    const frame = mountEl.querySelector('.inkchapter-doc-status__lock-frame') as HTMLElement
    // 锁定外框不跟随诊断颜色：使用中性 currentColor。
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

  it('CSS contract: transparent hot zone, 12px square, 1.5px lock frame, reduced motion', () => {
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

  it('does not fake a locked state when the lock action fails (state comes from update)', () => {
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

describe('V5.2 three tabs, one content area', () => {
  it('renders diagnostics by default and switches tabs inside one panel', () => {
    const { controller, mountEl } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    const tabs = mountEl.querySelectorAll('.inkchapter-doc-expand__tab')
    expect(Array.from(tabs).map(t => t.textContent)).toEqual(['检测', '图片', '锁定'])
    const panels = mountEl.querySelectorAll('.inkchapter-doc-expand__panel')
    expect(panels).toHaveLength(1)
    expect(panel(controller).textContent).toContain('2 警告')
    ;(tabs[2] as HTMLButtonElement).click()
    expect(controller.getActiveTab()).toBe('lock')
    expect(mountEl.querySelectorAll('.inkchapter-doc-expand__panel')).toHaveLength(1)
    expect(panel(controller).textContent).toContain('编辑中')
  })

  it('details render in the same panel and locating closes the toolbar (no legacy drawer)', () => {
    const { controller, mountEl, actions: a } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    const details = Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__button'))
      .find(btn => btn.textContent === '详情')!
    details.click()
    expect(controller.getDetailView()).toBe('diagnostic-details')
    expect(panel(controller).querySelectorAll('.inkchapter-doc-expand__diag')).toHaveLength(2)
    expect(document.querySelector('.inkchapter-doc-hub')).toBeNull()
    expect(document.querySelector('.inkchapter-doc-drawer')).toBeNull()
    ;(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__diag')[0]).click()
    expect(a.locateDiagnostic).toHaveBeenCalledWith('d1')
    expect(controller.isOpen()).toBe(false)
    void mountEl
  })

  it('images tab shows a compact disabled line when image management is off', () => {
    const { controller, mountEl } = mount()
    controller.update(buildDocumentStatusView(FACTS, false), model(false, { ...IMAGE, enabled: false }))
    status(controller).click()
    vi.advanceTimersByTime(300)
    ;(mountEl.querySelectorAll('.inkchapter-doc-expand__tab')[1] as HTMLButtonElement).click()
    expect(panel(controller).textContent).toContain('图片管理未启用')
    const configure = Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__button'))
      .find(btn => btn.textContent === '配置')!
    configure.click()
    expect(controller['options'].actions.openImageSettings).toHaveBeenCalledTimes(1)
  })

  it('images tab exposes real batch callbacks and disabled reasons', () => {
    const { controller, mountEl, actions: a } = mount()
    status(controller).click()
    vi.advanceTimersByTime(300)
    ;(mountEl.querySelectorAll('.inkchapter-doc-expand__tab')[1] as HTMLButtonElement).click()
    expect(panel(controller).textContent).toContain('覆盖：当前文档')
    expect(panel(controller).textContent).toContain('4 处引用')
    const upload = Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__button'))
      .find(btn => btn.textContent === '上传全部')!
    const download = Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__button'))
      .find(btn => btn.textContent === '下载全部')!
    upload.click()
    download.click()
    expect(a.uploadAll).toHaveBeenCalledTimes(1)
    expect(a.downloadAll).toHaveBeenCalledTimes(1)

    const idle = buildDocumentHubModel({
      documentPath: 'D:/vault/notes/doc.md', saved: true,
      status: buildDocumentStatusView(FACTS, false), locked: false,
      image: { ...IMAGE, pendingUploadCount: 0 },
      diagnosticsAvailable: true, diagnostics: [],
    })
    controller.update(buildDocumentStatusView(FACTS, false), idle)
    const upload2 = Array.from(panel(controller).querySelectorAll<HTMLButtonElement>('.inkchapter-doc-expand__button'))
      .find(btn => btn.textContent === '上传全部')!
    expect(upload2.disabled).toBe(true)
    expect(upload2.title).toContain('没有待上传')
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
