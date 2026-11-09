/**
 * V5.2 — 一体化可展开文档状态工具栏（ExpandableDocumentStatusToolbar）。
 *
 * 结构（唯一 DOM 宿主，绝不进入 #write）：
 *   .inkchapter-doc-toolbar-ui            (fixed，右端锚定)
 *   ├─ .inkchapter-doc-expand__row        (横向：标签栏 + 状态方块)
 *   │   ├─ .inkchapter-doc-expand__tabs   (检测｜图片｜锁定，仅在展开时显示)
 *   │   └─ button.inkchapter-doc-status   (12px 纯色方块 + 32px 透明热区)
 *   └─ .inkchapter-doc-expand__panel      (唯一内容区，仅选中标签时显示)
 *
 * V5.2 修订：检测标签不再有「摘要 → 详情」过渡页，展开后直接渲染诊断列表；
 * 列表行来自 host 提供的「目标投影 + 文档位置排序 + 既有文案」权威，仅做视图
 * 层严重级别筛选，不重新计算诊断。
 */
import type { DocumentHubDiagnosticItem, DocumentHubModel } from './document-hub-model'
import { explainBatchActionDisabled } from './document-hub-model'
import type { DocumentStatusView } from './document-status-indicator'

export type DocumentToolbarTab = 'diagnostics' | 'images' | 'lock'
export type DocumentToolbarMode = 'collapsed' | 'expanded'
export type DiagnosticSeverityFilter = 'all' | 'error' | 'warning' | 'info'

export interface DocumentHubActions {
  recheck(): void
  toggleLock(): void
  uploadAll(): void
  downloadAll(): void
  dualLink(): void
  openImageSettings(): void
  locateDiagnostic?(diagnosticId: string): void
}

export interface DocumentHubControllerOptions {
  mountEl: HTMLElement
  actions: DocumentHubActions
  getHint?: () => string | null
  doubleClickWindowMs?: number
}

const ROOT_CLASS = 'inkchapter-doc-toolbar-ui'
const ROW_CLASS = 'inkchapter-doc-expand__row'
const STATUS_CLASS = 'inkchapter-doc-status'
const TABS_CLASS = 'inkchapter-doc-expand__tabs'
const TAB_CLASS = 'inkchapter-doc-expand__tab'
const PANEL_CLASS = 'inkchapter-doc-expand__panel'
const TABS: readonly { id: DocumentToolbarTab; label: string }[] = [
  { id: 'diagnostics', label: '检测' },
  { id: 'images', label: '图片' },
  { id: 'lock', label: '锁定' },
]

export class DocumentHubController {
  private rootEl: HTMLDivElement | null = null
  private statusEl: HTMLButtonElement | null = null
  private squareEl: HTMLSpanElement | null = null
  private lockFrameEl: HTMLSpanElement | null = null
  private tabsEl: HTMLDivElement | null = null
  private panelEl: HTMLDivElement | null = null
  private model: DocumentHubModel | null = null
  private mode: DocumentToolbarMode = 'collapsed'
  private tab: DocumentToolbarTab = 'diagnostics'
  private severityFilter: DiagnosticSeverityFilter = 'all'
  private pendingClickTimer: ReturnType<typeof setTimeout> | null = null
  private onDocMouseDown: ((event: MouseEvent) => void) | null = null
  private onKeyDown: ((event: KeyboardEvent) => void) | null = null

  constructor(private readonly options: DocumentHubControllerOptions) {}

  mount(): void {
    if (this.rootEl) return
    const root = document.createElement('div')
    root.className = ROOT_CLASS

    const row = document.createElement('div')
    row.className = ROW_CLASS

    const tabs = document.createElement('div')
    tabs.className = TABS_CLASS
    tabs.hidden = true
    tabs.setAttribute('role', 'tablist')
    for (const tab of TABS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = TAB_CLASS
      button.dataset['tab'] = tab.id
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-selected', 'false')
      button.textContent = tab.label
      button.addEventListener('click', () => this.switchTab(tab.id))
      tabs.appendChild(button)
    }

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
    ;(status.style as unknown as { webkitAppRegion: string }).webkitAppRegion = 'no-drag'
    ;(root.style as unknown as { webkitAppRegion: string }).webkitAppRegion = 'no-drag'
    status.addEventListener('click', (event) => {
      event.preventDefault()
      this.handleStatusClick()
    })

    row.append(tabs, status)

    const panel = document.createElement('div')
    panel.className = PANEL_CLASS
    panel.hidden = true
    panel.setAttribute('role', 'tabpanel')

    root.append(row, panel)
    this.options.mountEl.appendChild(root)
    this.rootEl = root
    this.statusEl = status
    this.squareEl = square
    this.lockFrameEl = lockFrame
    this.tabsEl = tabs
    this.panelEl = panel

    this.onDocMouseDown = (event: MouseEvent) => {
      if (this.mode !== 'expanded') return
      const target = event.target as Node | null
      if (!target) return
      if (this.tabsEl?.contains(target) || this.statusEl?.contains(target) || this.panelEl?.contains(target)) return
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
    // 直接定位（不占用 rAF 队列：宿主几何调度依赖 rAF 时序）。
    this.positionRoot()
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
    this.positionRoot()
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

  getSeverityFilter(): DiagnosticSeverityFilter {
    return this.severityFilter
  }

  private handleStatusClick(): void {
    if (this.pendingClickTimer != null) {
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
    this.severityFilter = 'all'
    this.tabsEl!.hidden = false
    this.positionRoot()
    this.renderTabs()
    this.renderPanel()
    this.waitForOpenFrame()
    this.statusEl?.setAttribute('aria-expanded', 'true')
  }

  close(): void {
    if (this.mode !== 'expanded') return
    this.mode = 'collapsed'
    this.rootEl?.classList.remove('is-open')
    if (this.tabsEl) this.tabsEl.hidden = true
    if (this.panelEl) this.panelEl.hidden = true
    this.statusEl?.setAttribute('aria-expanded', 'false')
  }

  /** 选中标签；再次点击当前标签则收起内容区（标签栏保留）。 */
  switchTab(tab: DocumentToolbarTab): void {
    if (this.mode !== 'expanded') this.open()
    if (this.tab === tab && !this.panelEl?.hidden) {
      if (this.panelEl) this.panelEl.hidden = true
      this.renderTabs()
      this.statusEl?.setAttribute('aria-selected', 'false')
      return
    }
    this.tab = tab
    if (tab === 'diagnostics') this.severityFilter = 'all'
    this.renderTabs()
    this.renderPanel()
  }

  private waitForOpenFrame(): void {
    const root = this.rootEl
    if (!root) return
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => root.classList.add('is-open'))
    } else {
      root.classList.add('is-open')
    }
  }

  private positionRoot(): void {
    const root = this.rootEl
    if (!root) return
    const rect = this.options.mountEl.getBoundingClientRect()
    if (rect.width <= 0 && rect.height <= 0) return
    const right = Math.max(8, window.innerWidth - rect.right)
    const top = Math.max(8, rect.top)
    root.style.right = `${right}px`
    root.style.top = `${top}px`
  }

  private renderTabs(): void {
    const tabs = this.tabsEl
    if (!tabs) return
    const panelOpen = this.panelEl != null && this.panelEl.hidden === false
    for (const button of Array.from(tabs.querySelectorAll<HTMLButtonElement>(`.${TAB_CLASS}`))) {
      const active = panelOpen && button.dataset['tab'] === this.tab
      button.setAttribute('aria-selected', active ? 'true' : 'false')
      button.classList.toggle('is-active', active)
    }
  }

  private renderPanel(): void {
    const panel = this.panelEl
    const model = this.model
    if (!panel) return
    if (!model) return
    panel.replaceChildren()
    panel.hidden = false
    if (this.tab === 'diagnostics') {
      panel.appendChild(this.buildDiagnosticsList(model))
      return
    }
    if (this.tab === 'images') {
      panel.appendChild(this.buildImagesTab(model))
      return
    }
    panel.appendChild(this.buildLockTab(model))
  }

  /**
   * 诊断列表：直接渲染真实快照（无摘要过渡页、无详情/返回按钮）。
   * 排序与目标组语义由 host 的投影/排序权威提供；这里的筛选只做视图过滤。
   */
  private buildDiagnosticsList(model: DocumentHubModel): HTMLElement {
    const box = this.buildBox()
    if (!model.actions.openDiagnostics) {
      box.appendChild(this.buildEmptyLine('当前没有可用的检测结果'))
      return box
    }

    const counts = {
      error: model.diagnostics.filter(item => item.severity === 'error').length,
      warning: model.diagnostics.filter(item => item.severity === 'warning').length,
      info: model.diagnostics.filter(item => item.severity === 'info' || item.severity === 'hint').length,
    }
    box.appendChild(this.buildFilterLine(model, counts))

    const filtered = this.severityFilter === 'all'
      ? model.diagnostics
      : model.diagnostics.filter(item => item.severity === this.severityFilter
        || (this.severityFilter === 'info' && item.severity === 'hint'))

    const list = document.createElement('div')
    list.className = 'inkchapter-doc-expand__list'
    if (filtered.length === 0) {
      list.appendChild(this.buildEmptyLine(model.diagnostics.length === 0 ? '未发现问题' : '没有该级别的诊断'))
    } else {
      for (const item of filtered) {
        list.appendChild(this.buildDiagnosticRow(item))
      }
    }
    box.appendChild(list)
    return box
  }

  private buildFilterLine(
    model: DocumentHubModel,
    counts: { error: number; warning: number; info: number },
  ): HTMLElement {
    const line = this.buildLine()
    const filters: { id: DiagnosticSeverityFilter; label: string; count: number }[] = [
      { id: 'all', label: '全部', count: model.diagnostics.length },
      { id: 'error', label: '错误', count: counts.error },
      { id: 'warning', label: '警告', count: counts.warning },
      { id: 'info', label: '提示', count: counts.info },
    ]
    for (const filter of filters) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'inkchapter-doc-expand__filter'
      button.dataset['filter'] = filter.id
      button.textContent = `${filter.label} ${filter.count}`
      button.classList.toggle('is-active', this.severityFilter === filter.id)
      button.setAttribute('aria-pressed', String(this.severityFilter === filter.id))
      button.addEventListener('click', () => {
        this.severityFilter = filter.id
        this.renderPanel()
      })
      line.appendChild(button)
    }
    line.append(
      this.buildButton('刷新', model.actions.recheck, () => this.options.actions.recheck()),
    )
    return line
  }

  private buildDiagnosticRow(item: DocumentHubDiagnosticItem): HTMLButtonElement {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = `inkchapter-doc-expand__diag is-${item.severity}`
    row.dataset['severity'] = item.severity
    row.dataset['diagnosticId'] = item.id

    const dot = document.createElement('span')
    dot.className = 'inkchapter-doc-expand__diag-dot'
    dot.setAttribute('aria-hidden', 'true')

    const body = document.createElement('span')
    body.className = 'inkchapter-doc-expand__diag-body'
    const title = document.createElement('span')
    title.className = 'inkchapter-doc-expand__diag-title'
    title.textContent = item.title
    body.appendChild(title)
    if (item.detail && item.detail !== item.title) {
      const detail = document.createElement('span')
      detail.className = 'inkchapter-doc-expand__diag-detail'
      detail.textContent = item.detail
      body.appendChild(detail)
    }
    row.append(dot, body)

    if (item.line != null) {
      const loc = document.createElement('span')
      loc.className = 'inkchapter-doc-expand__diag-loc'
      loc.textContent = `L${item.line}`
      row.appendChild(loc)
    }
    row.title = item.line != null ? `${item.title}（第 ${item.line} 行）` : item.title
    row.addEventListener('click', () => {
      this.close()
      this.options.actions.locateDiagnostic?.(item.id)
    })
    return row
  }

  private buildImagesTab(model: DocumentHubModel): HTMLElement {
    const box = this.buildBox()
    const image = model.image

    if (!image || !image.enabled) {
      const line = this.buildLine()
      const text = document.createElement('span')
      text.className = 'inkchapter-doc-expand__summary'
      text.textContent = '图片管理未启用'
      line.append(text, this.buildButton('配置', true, () => this.options.actions.openImageSettings()))
      box.appendChild(line)
      return box
    }
    if (image.referenceCount === 0) {
      const line = this.buildLine()
      const text = document.createElement('span')
      text.className = 'inkchapter-doc-expand__summary'
      text.textContent = '当前文档没有图片'
      line.append(text, this.buildButton('设置', true, () => this.options.actions.openImageSettings()))
      box.appendChild(line)
      return box
    }

    const summary = this.buildLine()
    const text = document.createElement('span')
    text.className = 'inkchapter-doc-expand__summary'
    text.textContent = `${image.scopeLabel} · ${image.referenceCount} 处引用`
    summary.appendChild(text)
    box.appendChild(summary)

    const actions = this.buildLine()
    actions.append(
      this.buildButton('上传全部', model.actions.uploadAll, () => this.options.actions.uploadAll(),
        explainBatchActionDisabled('uploadAll', model)),
      this.buildButton('下载全部', model.actions.downloadAll, () => this.options.actions.downloadAll(),
        explainBatchActionDisabled('downloadAll', model)),
      this.buildButton('双链', model.actions.dualLink, () => this.options.actions.dualLink(),
        explainBatchActionDisabled('dualLink', model)),
      this.buildButton('设置', true, () => this.options.actions.openImageSettings()),
    )
    box.appendChild(actions)
    return box
  }

  private buildLockTab(model: DocumentHubModel): HTMLElement {
    const box = this.buildBox()
    const line = this.buildLine()
    const text = document.createElement('span')
    text.className = 'inkchapter-doc-expand__summary'
    text.textContent = model.locked ? '已锁定' : '编辑中'
    line.append(text, this.buildButton(
      model.locked ? '解锁' : '锁定',
      model.actions.toggleLock,
      () => this.options.actions.toggleLock(),
    ))
    box.appendChild(line)
    return box
  }

  private buildEmptyLine(text: string): HTMLElement {
    const line = this.buildLine()
    const span = document.createElement('span')
    span.className = 'inkchapter-doc-expand__empty'
    span.textContent = text
    line.appendChild(span)
    return line
  }

  private buildBox(): HTMLElement {
    const box = document.createElement('div')
    box.className = 'inkchapter-doc-expand__section'
    return box
  }

  private buildLine(): HTMLElement {
    const line = document.createElement('div')
    line.className = 'inkchapter-doc-expand__line'
    return line
  }

  private buildButton(
    label: string,
    enabled: boolean,
    onClick: () => void,
    disabledReason?: string | null,
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'inkchapter-doc-expand__button'
    button.textContent = label
    button.disabled = !enabled
    if (!enabled && disabledReason) button.title = disabledReason
    button.addEventListener('click', () => {
      if (button.disabled) return
      onClick()
    })
    return button
  }

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
    this.tabsEl = null
    this.panelEl = null
    if (this.onDocMouseDown) document.removeEventListener('mousedown', this.onDocMouseDown, true)
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown, true)
    this.onDocMouseDown = null
    this.onKeyDown = null
  }
}
