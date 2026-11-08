/**
 * V5.2 — 可展开文档状态工具栏（ExpandableDocumentStatusToolbar）。
 *
 * 收起：仅一个 12–14px 纯色方块 + 透明热区（无外壳 / 背景 / 边框 / 阴影）。
 * 单击：向右端锚定、向左展开「检测｜图片｜锁定」三个横向标签 + 单一内容区；再次单击收起。
 * 双击：直接切换真实文档锁定（手势仲裁，不触发展开/收起闪烁）。
 * 详情：检测标签内的「详情」在同一内容容器内部切换，绝不另开第二层诊断浮窗。
 *
 * 约束：
 * - 只做展示与回调；不直接读写文件 / Markdown；所有动作经由注入的 actions。
 * - 展开容器只创建一次，不因打开/关闭反复重建 DOM。
 * - 不轮询：状态由 host 在诊断发布 / 文档切换 / 锁定变化时推送。
 */

import type { DocumentHubDiagnosticItem, DocumentHubModel } from './document-hub-model'
import { explainBatchActionDisabled } from './document-hub-model'
import type { DocumentStatusView } from './document-status-indicator'

export type DocumentToolbarTab = 'diagnostics' | 'images' | 'lock'
export type DocumentToolbarMode = 'collapsed' | 'expanded'
export type DocumentDetailView = 'summary' | 'diagnostic-details'

export interface DocumentHubActions {
  recheck(): void
  toggleLock(): void
  uploadAll(): void
  downloadAll(): void
  dualLink(): void
  openImageSettings(): void
  /** 定位一条诊断：实现方负责关闭工具栏并定位到正文目标。 */
  locateDiagnostic?(diagnosticId: string): void
}

export interface DocumentHubControllerOptions {
  /** 状态方块挂载点（host 的 toolbar 容器）。 */
  mountEl: HTMLElement
  actions: DocumentHubActions
  /** 展开内容区里的提示文案（首次启用 / 配置变更等）；空则不显示。 */
  getHint?: () => string | null
  /** 双击判定窗口（毫秒），默认 260。 */
  doubleClickWindowMs?: number
}

const ROOT_CLASS = 'inkchapter-doc-toolbar-ui'
const STATUS_CLASS = 'inkchapter-doc-status'
const EXPAND_CLASS = 'inkchapter-doc-expand'
const TABS: readonly { id: DocumentToolbarTab; label: string }[] = [
  { id: 'diagnostics', label: '检测' },
  { id: 'images', label: '图片' },
  { id: 'lock', label: '锁定' },
]

const SEVERITY_LABEL: Record<DocumentHubDiagnosticItem['severity'], string> = {
  error: '错误',
  warning: '警告',
  hint: '提示',
  info: '信息',
}

export class DocumentHubController {
  private rootEl: HTMLDivElement | null = null
  private statusEl: HTMLButtonElement | null = null
  private squareEl: HTMLSpanElement | null = null
  private lockFrameEl: HTMLSpanElement | null = null
  private expandEl: HTMLDivElement | null = null
  private tabsEl: HTMLDivElement | null = null
  private panelEl: HTMLDivElement | null = null
  private model: DocumentHubModel | null = null
  private mode: DocumentToolbarMode = 'collapsed'
  private tab: DocumentToolbarTab = 'diagnostics'
  private detail: DocumentDetailView = 'summary'
  private pendingClickTimer: ReturnType<typeof setTimeout> | null = null
  private onDocMouseDown: ((event: MouseEvent) => void) | null = null
  private onKeyDown: ((event: KeyboardEvent) => void) | null = null

  constructor(private readonly options: DocumentHubControllerOptions) {}

  mount(): void {
    if (this.rootEl) return
    const root = document.createElement('div')
    root.className = ROOT_CLASS

    const status = document.createElement('button')
    status.type = 'button'
    status.className = STATUS_CLASS
    status.setAttribute('aria-expanded', 'false')
    status.setAttribute('aria-label', '文档状态')
    status.title = '单击展开文档工具；双击锁定/解锁'

    const square = document.createElement('span')
    square.className = `${STATUS_CLASS}__square`
    const lockFrame = document.createElement('span')
    lockFrame.className = `${STATUS_CLASS}__lock-frame`
    status.append(square, lockFrame)
    status.addEventListener('click', (event) => {
      event.preventDefault()
      this.handleStatusClick()
    })

    const expand = document.createElement('div')
    expand.className = EXPAND_CLASS
    expand.hidden = true
    expand.setAttribute('role', 'group')
    expand.setAttribute('aria-label', '文档工具')

    const tabs = document.createElement('div')
    tabs.className = `${EXPAND_CLASS}__tabs`
    tabs.setAttribute('role', 'tablist')
    for (const tab of TABS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `${EXPAND_CLASS}__tab`
      button.dataset['tab'] = tab.id
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-selected', 'false')
      button.textContent = tab.label
      button.addEventListener('click', () => this.switchTab(tab.id))
      tabs.appendChild(button)
    }

    const panel = document.createElement('div')
    panel.className = `${EXPAND_CLASS}__panel`
    panel.setAttribute('role', 'tabpanel')

    expand.append(tabs, panel)
    root.append(status, expand)
    this.options.mountEl.appendChild(root)

    this.rootEl = root
    this.statusEl = status
    this.squareEl = square
    this.lockFrameEl = lockFrame
    this.expandEl = expand
    this.tabsEl = tabs
    this.panelEl = panel

    this.onDocMouseDown = (event: MouseEvent) => {
      if (this.mode !== 'expanded') return
      const target = event.target as Node | null
      if (!target) return
      if (this.expandEl?.contains(target) || this.statusEl?.contains(target)) return
      this.close()
    }
    this.onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || this.mode !== 'expanded') return
      event.preventDefault()
      this.close()
      this.statusEl?.focus()
    }
    document.addEventListener('mousedown', this.onDocMouseDown, true)
    document.addEventListener('keydown', this.onKeyDown, true)
    this.renderTabs()
  }

  update(view: DocumentStatusView, model: DocumentHubModel): void {
    this.model = model
    if (!this.rootEl) this.mount()
    const el = this.statusEl!
    el.dataset['status'] = view.code
    el.dataset['errorCount'] = String(view.errorCount)
    el.dataset['warningCount'] = String(view.warningCount)
    el.dataset['hintCount'] = String(view.hintCount)
    el.dataset['locked'] = view.locked ? '1' : '0'
    el.classList.toggle('is-locked', view.locked)
    el.setAttribute('aria-label', view.label)
    el.title = view.label
    if (this.squareEl) this.squareEl.style.backgroundColor = view.color
    if (this.lockFrameEl) this.lockFrameEl.style.borderColor = view.locked ? 'currentColor' : 'transparent'
    if (this.mode === 'expanded') this.renderPanel()
  }

  isOpen(): boolean {
    return this.mode === 'expanded'
  }

  getMode(): DocumentToolbarMode {
    return this.mode
  }

  getActiveTab(): DocumentToolbarTab {
    return this.tab
  }

  getDetailView(): DocumentDetailView {
    return this.detail
  }

  /** 状态方块点击：单/双击仲裁（双击只切换锁定）。 */
  private handleStatusClick(): void {
    if (this.pendingClickTimer != null) {
      // 第二击落在判定窗口内 → 双击：取消待执行的单击展开，只切换锁定。
      clearTimeout(this.pendingClickTimer)
      this.pendingClickTimer = null
      this.options.actions.toggleLock()
      return
    }
    this.pendingClickTimer = setTimeout(() => {
      this.pendingClickTimer = null
      this.toggle()
    }, this.options.doubleClickWindowMs ?? 260)
  }

  toggle(): void {
    if (this.mode === 'expanded') this.close()
    else this.open()
  }

  open(): void {
    if (!this.rootEl) this.mount()
    if (this.mode === 'expanded') return
    this.mode = 'expanded'
    this.tab = 'diagnostics'
    this.detail = 'summary'
    const expand = this.expandEl!
    expand.hidden = false
    this.positionExpand()
    this.renderTabs()
    this.renderPanel()
    this.statusEl?.setAttribute('aria-expanded', 'true')
    // 允许浏览器先完成 hidden=false 的布局，再加动画类。
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => expand.classList.add('is-open'))
    } else {
      expand.classList.add('is-open')
    }
  }

  close(): void {
    if (this.mode !== 'expanded') return
    this.mode = 'collapsed'
    this.expandEl?.classList.remove('is-open')
    if (this.expandEl) this.expandEl.hidden = true
    this.statusEl?.setAttribute('aria-expanded', 'false')
  }

  switchTab(tab: DocumentToolbarTab): void {
    this.tab = tab
    this.detail = 'summary'
    this.renderTabs()
    this.renderPanel()
  }

  private positionExpand(): void {
    const expand = this.expandEl
    const status = this.statusEl
    if (!expand || !status) return
    const rect = status.getBoundingClientRect()
    const width = Math.min(320, Math.max(260, window.innerWidth - 24))
    const right = Math.max(8, window.innerWidth - rect.right)
    const top = Math.max(8, rect.bottom + 8)
    expand.style.width = `${width}px`
    expand.style.right = `${right}px`
    expand.style.top = `${top}px`
  }

  private renderTabs(): void {
    const tabs = this.tabsEl
    if (!tabs) return
    for (const button of Array.from(tabs.querySelectorAll<HTMLButtonElement>(`.${EXPAND_CLASS}__tab`))) {
      const active = button.dataset['tab'] === this.tab
      button.setAttribute('aria-selected', active ? 'true' : 'false')
      button.classList.toggle('is-active', active)
    }
  }

  private renderPanel(): void {
    const panel = this.panelEl
    const model = this.model
    if (!panel || !model) return
    panel.replaceChildren()

    if (this.tab === 'diagnostics') {
      if (this.detail === 'diagnostic-details') {
        panel.appendChild(this.buildDiagnosticsDetail(model))
      } else {
        panel.appendChild(this.buildDiagnosticsSummary(model))
      }
      return
    }
    if (this.tab === 'images') {
      panel.appendChild(this.buildImagesTab(model))
      return
    }
    panel.appendChild(this.buildLockTab(model))
  }

  private buildDiagnosticsSummary(model: DocumentHubModel): HTMLElement {
    const box = document.createElement('div')
    box.className = `${EXPAND_CLASS}__section`

    const status = model.status
    const summary = document.createElement('div')
    summary.className = `${EXPAND_CLASS}__summary`
    if (status.code === 'GRAY') {
      summary.textContent = '尚未检测或检测不可用'
    } else {
      summary.textContent = `${status.errorCount} 错误 · ${status.warningCount} 警告`
    }
    box.appendChild(summary)

    const actions = document.createElement('div')
    actions.className = `${EXPAND_CLASS}__actions`
    actions.append(
      this.buildButton('重新检测', model.actions.recheck, () => this.options.actions.recheck()),
      this.buildButton('详情', model.actions.openDiagnostics, () => {
        this.detail = 'diagnostic-details'
        this.renderPanel()
      }),
    )
    box.appendChild(actions)
    const hint = this.buildHint()
    if (hint) box.appendChild(hint)
    return box
  }

  private buildDiagnosticsDetail(model: DocumentHubModel): HTMLElement {
    const box = document.createElement('div')
    box.className = `${EXPAND_CLASS}__section`

    const header = document.createElement('div')
    header.className = `${EXPAND_CLASS}__actions`
    header.appendChild(this.buildButton('返回', true, () => {
      this.detail = 'summary'
      this.renderPanel()
    }))
    box.appendChild(header)

    const list = document.createElement('div')
    list.className = `${EXPAND_CLASS}__list`
    if (!model.actions.openDiagnostics) {
      list.textContent = '当前没有可用的检测结果'
    } else if (model.diagnostics.length === 0) {
      list.textContent = '未发现问题'
    } else {
      for (const item of model.diagnostics) {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = `${EXPAND_CLASS}__diag is-${item.severity}`
        const badge = document.createElement('span')
        badge.className = `${EXPAND_CLASS}__diag-severity`
        badge.textContent = SEVERITY_LABEL[item.severity]
        const text = document.createElement('span')
        text.className = `${EXPAND_CLASS}__diag-message`
        text.textContent = item.message
        row.append(badge, text)
        row.addEventListener('click', () => {
          this.close()
          this.options.actions.locateDiagnostic?.(item.id)
        })
        list.appendChild(row)
      }
    }
    box.appendChild(list)
    return box
  }

  private buildImagesTab(model: DocumentHubModel): HTMLElement {
    const box = document.createElement('div')
    box.className = `${EXPAND_CLASS}__section`
    const image = model.image

    if (!image || !image.enabled) {
      const row = document.createElement('div')
      row.className = `${EXPAND_CLASS}__summary`
      row.textContent = '图片管理未启用'
      box.appendChild(row)
      const actions = document.createElement('div')
      actions.className = `${EXPAND_CLASS}__actions`
      actions.appendChild(this.buildButton('配置当前文档', true, () => this.options.actions.openImageSettings()))
      box.appendChild(actions)
      return box
    }

    box.appendChild(this.buildRow('生效来源', image.scopeLabel))
    box.appendChild(this.buildRow('插入方式', image.insertionModeText ?? '由 Typora 原生设置决定'))
    box.appendChild(this.buildRow('自动同步', image.autoSyncText ?? '关闭'))
    box.appendChild(this.buildRow('引用', `${image.referenceCount} 处（本地 ${image.localCount} / 远程 ${image.remoteCount}）`))
    box.appendChild(this.buildRow('可复用', `本地 ${image.reuseLocalCount} / 远程 ${image.reuseRemoteCount}`))
    box.appendChild(this.buildRow('待传输', `上传 ${image.pendingUploadCount} / 下载 ${image.pendingDownloadCount}`))

    const actions = document.createElement('div')
    actions.className = `${EXPAND_CLASS}__actions`
    actions.append(
      this.buildButton('上传本文图片', model.actions.uploadAll, () => this.options.actions.uploadAll(),
        explainBatchActionDisabled('uploadAll', model)),
      this.buildButton('下载本文图片', model.actions.downloadAll, () => this.options.actions.downloadAll(),
        explainBatchActionDisabled('downloadAll', model)),
      this.buildButton('检查并补齐双链', model.actions.dualLink, () => this.options.actions.dualLink(),
        explainBatchActionDisabled('dualLink', model)),
      this.buildButton('当前文档高级设置', true, () => this.options.actions.openImageSettings()),
    )
    box.appendChild(actions)
    return box
  }

  private buildLockTab(model: DocumentHubModel): HTMLElement {
    const box = document.createElement('div')
    box.className = `${EXPAND_CLASS}__section`
    box.appendChild(this.buildRow('状态', model.locked ? '已锁定（只读）' : '编辑中'))
    const actions = document.createElement('div')
    actions.className = `${EXPAND_CLASS}__actions`
    actions.appendChild(this.buildButton(
      model.locked ? '解锁文档' : '锁定文档',
      model.actions.toggleLock,
      () => this.options.actions.toggleLock(),
    ))
    box.appendChild(actions)
    return box
  }

  private buildRow(label: string, value: string): HTMLElement {
    const row = document.createElement('div')
    row.className = `${EXPAND_CLASS}__row`
    const name = document.createElement('span')
    name.className = `${EXPAND_CLASS}__row-label`
    name.textContent = label
    const val = document.createElement('span')
    val.className = `${EXPAND_CLASS}__row-value`
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
    button.className = `${EXPAND_CLASS}__button`
    button.textContent = label
    button.disabled = !enabled
    if (!enabled && disabledReason) button.title = disabledReason
    button.addEventListener('click', () => {
      if (button.disabled) return
      onClick()
    })
    return button
  }

  private buildHint(): HTMLElement | null {
    const hint = this.options.getHint?.()
    if (!hint) return null
    const el = document.createElement('div')
    el.className = `${EXPAND_CLASS}__hint`
    el.textContent = hint
    return el
  }

  /** 测试/诊断用：展开内容区。 */
  getPanelElement(): HTMLElement | null {
    return this.panelEl
  }

  getStatusElement(): HTMLElement | null {
    return this.statusEl
  }

  dispose(): void {
    if (this.pendingClickTimer != null) {
      clearTimeout(this.pendingClickTimer)
      this.pendingClickTimer = null
    }
    this.close()
    this.rootEl?.remove()
    this.rootEl = null
    this.statusEl = null
    this.squareEl = null
    this.lockFrameEl = null
    this.expandEl = null
    this.tabsEl = null
    this.panelEl = null
    if (this.onDocMouseDown) document.removeEventListener('mousedown', this.onDocMouseDown, true)
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown, true)
    this.onDocMouseDown = null
    this.onKeyDown = null
  }
}
