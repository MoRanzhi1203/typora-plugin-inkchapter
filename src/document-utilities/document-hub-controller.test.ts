// @vitest-environment jsdom
/**
 * V5.1 — 状态方块 + 文档管理中心面板的真实 DOM 契约。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentHubController } from './document-hub-controller'
import { buildDocumentHubModel } from './document-hub-model'
import { buildDocumentStatusView, type DocumentStatusFacts } from './document-status-indicator'

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
}

function actions() {
  return {
    recheck: vi.fn(),
    toggleLock: vi.fn(),
    openDiagnostics: vi.fn(),
    uploadAll: vi.fn(),
    downloadAll: vi.fn(),
    dualLink: vi.fn(),
    openImageSettings: vi.fn(),
  }
}

function mount() {
  const mountEl = document.createElement('div')
  document.body.appendChild(mountEl)
  const a = actions()
  const controller = new DocumentHubController({ mountEl, actions: a })
  controller.mount()
  return { controller, mountEl, actions: a }
}

function model(locked = false) {
  return buildDocumentHubModel({
    documentPath: 'D:/vault/notes/doc.md',
    saved: true,
    status: buildDocumentStatusView(FACTS, locked),
    locked,
    image: IMAGE,
    diagnosticsAvailable: true,
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('DocumentHubController — status square', () => {
  it('mounts one small status square with the status color', () => {
    const { controller, mountEl } = mount()
    const square = mountEl.querySelector('.inkchapter-doc-status') as HTMLElement
    expect(square).not.toBeNull()
    expect(square.querySelector('.inkchapter-doc-status__square')).not.toBeNull()
    controller.update(buildDocumentStatusView(FACTS, false), model(false))
    const dot = mountEl.querySelector('.inkchapter-doc-status__square') as HTMLElement
    expect(dot.style.backgroundColor).toBe('rgb(210, 153, 34)')
    expect(square.dataset.status).toBe('YELLOW')
  })

  it('adds an independent frame when locked without changing the color', () => {
    const { controller, mountEl } = mount()
    controller.update(buildDocumentStatusView(FACTS, true), model(true))
    const square = mountEl.querySelector('.inkchapter-doc-status') as HTMLElement
    expect(square.classList.contains('is-locked')).toBe(true)
    expect(square.dataset.status).toBe('YELLOW')
    const frame = mountEl.querySelector('.inkchapter-doc-status__frame') as HTMLElement
    expect(frame.style.borderColor).not.toBe('transparent')
  })

  it('shows RED for errors and GRAY when unverifiable', () => {
    const { controller, mountEl } = mount()
    controller.update(
      buildDocumentStatusView({ ...FACTS, errorCount: 3 }, false),
      model(false),
    )
    expect((mountEl.querySelector('.inkchapter-doc-status') as HTMLElement).dataset.status).toBe('RED')
    controller.update(
      buildDocumentStatusView({ ...FACTS, hasDocument: false }, false),
      model(false),
    )
    expect((mountEl.querySelector('.inkchapter-doc-status') as HTMLElement).dataset.status).toBe('GRAY')
  })
})

describe('DocumentHubController — hub panel', () => {
  it('opens a panel containing detection, lock and image sections', () => {
    const { controller } = mount()
    controller.update(buildDocumentStatusView(FACTS, false), model(false))
    controller.open()
    const panel = controller.getPanelElement()!
    expect(panel).not.toBeNull()
    expect(panel.textContent).toContain('文档检测')
    expect(panel.textContent).toContain('文档锁定')
    expect(panel.textContent).toContain('当前文档图片')
    expect(panel.textContent).toContain('上传全部图片')
    expect(panel.textContent).toContain('下载全部图片')
    expect(panel.textContent).toContain('检查/补齐双链')
    // 面板绝不进入编辑内容区
    expect(panel.closest('#write')).toBeNull()
  })

  it('invokes actions from panel buttons', () => {
    const { controller, actions: a } = mount()
    controller.update(buildDocumentStatusView(FACTS, false), model(false))
    controller.open()
    const panel = controller.getPanelElement()!
    const click = (label: string) => {
      const btn = Array.from(panel.querySelectorAll<HTMLButtonElement>('.inkchapter-doc-hub__button'))
        .find(item => item.textContent === label)
      expect(btn, label).toBeTruthy()
      btn!.click()
    }
    click('重新检测')
    click('锁定文档')
    click('上传全部图片')
    click('下载全部图片')
    click('检查/补齐双链')
    click('图片设置…')
    expect(a.recheck).toHaveBeenCalledTimes(1)
    expect(a.toggleLock).toHaveBeenCalledTimes(1)
    expect(a.uploadAll).toHaveBeenCalledTimes(1)
    expect(a.downloadAll).toHaveBeenCalledTimes(1)
    expect(a.dualLink).toHaveBeenCalledTimes(1)
    expect(a.openImageSettings).toHaveBeenCalledTimes(1)
  })

  it('disables upload while locked and explains why', () => {
    const { controller } = mount()
    controller.update(buildDocumentStatusView(FACTS, true), model(true))
    controller.open()
    const panel = controller.getPanelElement()!
    const upload = Array.from(panel.querySelectorAll<HTMLButtonElement>('.inkchapter-doc-hub__button'))
      .find(item => item.textContent === '上传全部图片')!
    expect(upload.disabled).toBe(true)
    expect(upload.title).toContain('已锁定')
    const lock = Array.from(panel.querySelectorAll<HTMLButtonElement>('.inkchapter-doc-hub__button'))
      .find(item => item.textContent === '解锁文档')
    expect(lock).toBeTruthy()
  })

  it('closes on Escape and on outside mousedown', () => {
    const { controller } = mount()
    controller.update(buildDocumentStatusView(FACTS, false), model(false))
    controller.open()
    expect(controller.isOpen()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(controller.isOpen()).toBe(false)
    controller.open()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(controller.isOpen()).toBe(false)
  })

  it('toggles from the status square and updates aria-expanded', () => {
    const { controller, mountEl } = mount()
    controller.update(buildDocumentStatusView(FACTS, false), model(false))
    const square = mountEl.querySelector('.inkchapter-doc-status') as HTMLButtonElement
    square.click()
    expect(controller.isOpen()).toBe(true)
    expect(square.getAttribute('aria-expanded')).toBe('true')
    square.click()
    expect(controller.isOpen()).toBe(false)
  })

  it('shows the first-enable hint when provided', () => {
    const mountEl = document.createElement('div')
    document.body.appendChild(mountEl)
    const controller = new DocumentHubController({
      mountEl,
      actions: actions(),
      getHint: () => '首次启用：图片管理已就绪，批量操作会先预览再执行。',
    })
    controller.mount()
    controller.update(buildDocumentStatusView(FACTS, false), model(false))
    controller.open()
    expect(controller.getPanelElement()!.textContent).toContain('首次启用')
  })

  it('disposes the square and panel', () => {
    const { controller, mountEl } = mount()
    controller.update(buildDocumentStatusView(FACTS, false), model(false))
    controller.open()
    controller.dispose()
    expect(controller.isOpen()).toBe(false)
    expect(mountEl.querySelector('.inkchapter-doc-status')).toBeNull()
  })
})
