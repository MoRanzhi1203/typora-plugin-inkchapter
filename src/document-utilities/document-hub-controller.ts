/**
 * V5.1 — 右上角文档状态方块 + 统一「墨章文档管理中心」面板。
 *
 * 设计约束：
 * - 状态方块约 12–14px，热区 30–36px；锁定时在方块外增加独立外框。
 * - 面板是独立 fixed 浮层，**绝不**插入 `#write` 的可序列化内容。
 * - 面板只做展示与回调，不直接读写文件 / Markdown；所有动作经由注入的 actions。
 * - 不轮询：状态由 host 在诊断发布 / 文档切换 / 锁定变化时推送。
 */

import type { DocumentHubModel } from './document-hub-model'
import { explainBatchActionDisabled } from './document-hub-model'
import type { DocumentStatusView } from './document-status-indicator'

export interface DocumentHubActions {
  recheck: () => void
  toggleLock: () => void
  openDiagnostics: () => void
  uploadAll: () => void
  downloadAll: () => void
  dualLink: () => void
  openImageSettings: () => void
}

export interface DocumentHubControllerOptions {
  /** 状态方块挂载点（host 的 toolbar 容器）。 */
  mountEl: HTMLElement
  actions: DocumentHubActions
  /** 面板内的提示文案（首次启用 / 配置变更等）；空则隐藏。 */
  getHint?: () => string | null
}

const SQUARE_CLASS = 'inkchapter-doc-status'
const PANEL_CLASS = 'inkchapter-doc-hub'

export class DocumentHubController {
  private statusEl: HTMLButtonElement | null = null
  private squareEl: HTMLSpanElement | null = null
  private frameEl: HTMLSpanElement | null = null
  private panelEl: HTMLDivElement | null = null
  private model: DocumentHubModel | null = null
  private onDocMouseDown: ((event: MouseEvent) => void) | null = null
  private onKeyDown: ((event: KeyboardEvent) => void) | null = null

  constructor(private readonly options: DocumentHubControllerOptions) {}

  mount(): void {
    if (this.statusEl) return
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = SQUARE_CLASS
    btn.setAttribute('aria-haspopup', 'dialog')
    btn.setAttribute('aria-expanded', 'false')
    btn.title = '文档管理中心'
    btn.setAttribute('aria-label', '文档管理中心')

    const square = document.createElement('span')
    square.className = `${SQUARE_CLASS}__square`
    const frame = document.createElement('span')
    frame.className = `${SQUARE_CLASS}__frame`
    btn.append(square, frame)
    btn.addEventListener('click', () => this.toggle())

    this.options.mountEl.appendChild(btn)
    this.statusEl = btn
    this.squareEl = square
    this.frameEl = frame

    this.onDocMouseDown = (event: MouseEvent) => {
      if (!this.panelEl) return
      const target = event.target as Node | null
      if (target && (this.panelEl.contains(target) || this.statusEl?.contains(target))) return
      this.close()
    }
    this.onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.panelEl) {
        event.preventDefault()
        this.close()
      }
    }
    document.addEventListener('mousedown', this.onDocMouseDown, true)
    document.addEventListener('keydown', this.onKeyDown, true)
  }

  update(view: DocumentStatusView, model: DocumentHubModel): void {
    this.model = model
    if (!this.statusEl || !this.squareEl) this.mount()
    const el = this.statusEl!
    el.dataset.status = view.code
    el.dataset.errorCount = String(view.errorCount)
    el.dataset.warningCount = String(view.warningCount)
    el.dataset.hintCount = String(view.hintCount)
    el.dataset.locked = view.locked ? '1' : '0'
    el.classList.toggle('is-locked', view.locked)
    el.setAttribute('aria-label', view.label)
    el.title = view.label
    if (this.squareEl) this.squareEl.style.backgroundColor = view.color
    if (this.frameEl) this.frameEl.style.borderColor = view.locked ? view.color : 'transparent'
    if (this.panelEl) this.renderPanel()
  }

  isOpen(): boolean {
    return this.panelEl != null
  }

  toggle(): void {
    if (this.panelEl) this.close()
    else this.open()
  }

  open(): void {
    if (this.panelEl) return
    const panel = document.createElement('div')
    panel.className = PANEL_CLASS
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', '墨章文档管理中心')
    panel.style.position = 'fixed'
    panel.style.zIndex = '2147483000'
    panel.style.width = '360px'
    panel.style.maxHeight = 'min(560px, 70vh)'
    panel.style.overflowY = 'auto'
    panel.style.boxSizing = 'border-box'
    this.panelEl = panel
    document.body.appendChild(panel)
    this.positionPanel()
    this.renderPanel()
    this.statusEl?.setAttribute('aria-expanded', 'true')
  }

  close(): void {
    if (!this.panelEl) return
    this.panelEl.remove()
    this.panelEl = null
    this.statusEl?.setAttribute('aria-expanded', 'false')
  }

  private positionPanel(): void {
    const panel = this.panelEl
    const status = this.statusEl
    if (!panel || !status) return
    const rect = status.getBoundingClientRect()
    const width = 360
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))
    const top = Math.max(8, rect.bottom + 8)
    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
  }

  private renderPanel(): void {
    const panel = this.panelEl
    const model = this.model
    if (!panel || !model) return
    panel.replaceChildren()

    const header = document.createElement('div')
    header.className = `${PANEL_CLASS}__header`
    const title = document.createElement('span')
    title.className = `${PANEL_CLASS}__title`
    title.textContent = '墨章文档管理中心'
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = `${PANEL_CLASS}__close`
    closeBtn.setAttribute('aria-label', '关闭')
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', () => this.close())
    header.append(title, closeBtn)
    panel.appendChild(header)

    const doc = document.createElement('div')
    doc.className = `${PANEL_CLASS}__document`
    doc.textContent = `${model.documentName}${model.saved ? '' : '（未保存）'}`
    if (model.documentPath) {
      doc.title = model.documentPath
    }
    panel.appendChild(doc)

    panel.appendChild(this.buildSection('文档检测', model, [
      this.buildRow('状态', model.status.label),
    ], [
      this.buildButton('重新检测', model.actions.recheck, () => this.options.actions.recheck()),
      this.buildButton('查看详情', model.actions.openDiagnostics, () => this.options.actions.openDiagnostics()),
    ]))

    panel.appendChild(this.buildSection('文档锁定', model, [
      this.buildRow('锁定状态', model.locked ? '已锁定' : '编辑中'),
    ], [
      this.buildButton(model.locked ? '解锁文档' : '锁定文档', model.actions.toggleLock, () => this.options.actions.toggleLock()),
    ]))

    if (model.image) {
      const image = model.image
      panel.appendChild(this.buildSection('当前文档图片', model, [
        this.buildRow('策略', image.policyText),
        this.buildRow('生效来源', image.scopeLabel),
        this.buildRow('引用', `${image.referenceCount} 处（本地 ${image.localCount} / 远程 ${image.remoteCount}）`),
        this.buildRow('可复用', `本地 ${image.reuseLocalCount} / 远程 ${image.reuseRemoteCount}`),
        this.buildRow('待传输', `上传 ${image.pendingUploadCount} / 下载 ${image.pendingDownloadCount}`),
        this.buildRow('双链完整', String(image.dualLinkCompleteCount)),
      ], [
        this.buildButton('上传全部图片', model.actions.uploadAll, () => this.options.actions.uploadAll(),
          explainBatchActionDisabled('uploadAll', model)),
        this.buildButton('下载全部图片', model.actions.downloadAll, () => this.options.actions.downloadAll(),
          explainBatchActionDisabled('downloadAll', model)),
        this.buildButton('检查/补齐双链', model.actions.dualLink, () => this.options.actions.dualLink(),
          explainBatchActionDisabled('dualLink', model)),
        this.buildButton('图片设置…', model.actions.openImageSettings, () => this.options.actions.openImageSettings()),
      ]))
    } else {
      const hint = document.createElement('div')
      hint.className = `${PANEL_CLASS}__hint`
      hint.textContent = '图片管理未启用：启用后这里会显示当前文档图片策略与批量操作。'
      panel.appendChild(hint)
    }

    const customHint = this.options.getHint?.()
    if (customHint) {
      const hint = document.createElement('div')
      hint.className = `${PANEL_CLASS}__hint`
      hint.textContent = customHint
      panel.appendChild(hint)
    }
  }

  private buildSection(
    title: string,
    model: DocumentHubModel,
    rows: HTMLElement[],
    buttons: HTMLElement[],
  ): HTMLElement {
    const section = document.createElement('section')
    section.className = `${PANEL_CLASS}__section`
    const heading = document.createElement('div')
    heading.className = `${PANEL_CLASS}__section-title`
    heading.textContent = title
    section.appendChild(heading)
    for (const row of rows) section.appendChild(row)
    if (buttons.length > 0) {
      const actions = document.createElement('div')
      actions.className = `${PANEL_CLASS}__actions`
      for (const button of buttons) actions.appendChild(button)
      section.appendChild(actions)
    }
    return section
  }

  private buildRow(label: string, value: string): HTMLElement {
    const row = document.createElement('div')
    row.className = `${PANEL_CLASS}__row`
    const name = document.createElement('span')
    name.className = `${PANEL_CLASS}__row-label`
    name.textContent = label
    const val = document.createElement('span')
    val.className = `${PANEL_CLASS}__row-value`
    val.textContent = value
    row.append(name, val)
    return row
  }

  private buildButton(
    label: string,
    enabled: boolean,
    onClick: () => void,
    disabledReason?: string | null,
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `${PANEL_CLASS}__button`
    button.textContent = label
    button.disabled = !enabled
    if (!enabled && disabledReason) button.title = disabledReason
    button.addEventListener('click', () => {
      if (button.disabled) return
      onClick()
    })
    return button
  }

  /** 测试/诊断用：当前面板 DOM。 */
  getPanelElement(): HTMLElement | null {
    return this.panelEl
  }

  getStatusElement(): HTMLElement | null {
    return this.statusEl
  }

  dispose(): void {
    this.close()
    this.statusEl?.remove()
    this.statusEl = null
    this.squareEl = null
    this.frameEl = null
    if (this.onDocMouseDown) document.removeEventListener('mousedown', this.onDocMouseDown, true)
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown, true)
    this.onDocMouseDown = null
    this.onKeyDown = null
  }
}
