/**
 * V5.2 — 一体化可展开文档状态工具栏（ExpandableDocumentStatusToolbar）。
 *
 * 结构（唯一 DOM 宿主，绝不进入 #write）：
 *   .inkchapter-doc-toolbar-ui              (fixed，右端/顶部锚定；宽度跟随 layout)
 *   └─ .inkchapter-doc-expand__layout       (唯一宽度权威；收起 32px / 展开 min(360, 可用))
 *      ├─ .inkchapter-doc-expand__row       (header：100% 宽；grid = 1fr + 32px 状态热区)
 *      │   ├─ .inkchapter-doc-expand__tabs  (3 等分标签，仅在展开时显示)
 *      │   └─ button.inkchapter-doc-status  (12px 纯色方块 + 32px 透明热区)
 *      └─ .inkchapter-doc-expand__panel     (content：100% 宽；唯一内容区)
 *
 * V5.2 修订：检测标签不再有「摘要 → 详情」过渡页，展开后直接渲染诊断列表；
 * 列表行来自 host 提供的「目标投影 + 文档位置排序 + 既有文案」权威，仅做视图
 * 层严重级别筛选，不重新计算诊断。
 *
 * V5.2 布局修订：header 与 content 是同一 layout 的两个 width:100% 子项，
 * 状态热区计入 header 总宽度，左右边界同时重合；收起态只保留 32px 热区。
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
const LAYOUT_CLASS = 'inkchapter-doc-expand__layout'
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

/** 收起态布局宽度 = 状态热区宽度；展开宽度初始值（CSS 会再按可用视口收缩）。 */
const COLLAPSED_WIDTH_PX = 32
const EXPANDED_WIDTH_PX = 360
const VIEWPORT_GUTTER_PX = 8

export class DocumentHubController {
  private rootEl: HTMLDivElement | null = null
  private layoutEl: HTMLDivElement | null = null
  private headerEl: HTMLDivElement | null = null
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
  private onWindowResize: (() => void) | null = null

  constructor(private readonly options: DocumentHubControllerOptions) {}

  mount(): void {
    if (this.rootEl) return
    const root = document.createElement('div')
    root.className = ROOT_CLASS
    root.dataset['expanded'] = 'false'

    const layout = document.createElement('div')
    layout.className = LAYOUT_CLASS

    const row = document.createElement('div')
    row.className = ROW_CLASS

    const tabs = document.createElement('div')
    tabs.className = TABS_CLASS
    tabs.hidden = true
    tabs.setAttribute('role', 'tablist')
    tabs.setAttribute('aria-label', '文档工具')
    for (const tab of TABS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = TAB_CLASS
      button.id = `${ROOT_CLASS}__tab-${tab.id}`
      button.dataset['tab'] = tab.id
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-selected', 'false')
      button.setAttribute('aria-controls', `${ROOT_CLASS}__panel`)
      button.tabIndex = -1
      button.textContent = tab.label
      button.addEventListener('click', () => this.switchTab(tab.id))
      button.addEventListener('keydown', (event) => this.handleTabKeyDown(event, tab.id))
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
    panel.id = `${ROOT_CLASS}__panel`
    panel.hidden = true
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-label', '文档工具内容')

    layout.append(row, panel)
    root.append(layout)
    this.options.mountEl.appendChild(root)
    this.rootEl = root
    this.layoutEl = layout
    this.headerEl = row
    this.statusEl = status
    this.squareEl = square
    this.lockFrameEl = lockFrame
    this.tabsEl = tabs
    this.panelEl = panel

    this.onDocMouseDown = (event: MouseEvent) => {
      if (this.mode !== 'expanded') return
      const target = event.target as Node | null
      if (!target) return
      if (this.layoutEl?.contains(target)) return
      this.close()
    }
    this.onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || this.mode !== 'expanded') return
      event.preventDefault()
      this.close()
      this.statusEl?.focus()
    }
    this.onWindowResize = () => this.positionRoot()
    document.addEventListener('mousedown', this.onDocMouseDown, true)
    document.addEventListener('keydown', this.onKeyDown, true)
    window.addEventListener('resize', this.onWindowResize)
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
    this.rootEl!.dataset['expanded'] = 'true'
    this.tabsEl!.hidden = false
    this.positionRoot()
    this.renderPanel()
    this.renderTabs()
    this.waitForOpenFrame()
    this.statusEl?.setAttribute('aria-expanded', 'true')
    this.updateTabFocusability()
  }

  close(): void {
    if (this.mode !== 'expanded') return
    this.mode = 'collapsed'
    this.rootEl?.classList.remove('is-open')
    this.rootEl?.setAttribute('data-expanded', 'false')
    if (this.tabsEl) this.tabsEl.hidden = true
    if (this.panelEl) this.panelEl.hidden = true
    this.statusEl?.setAttribute('aria-expanded', 'false')
    this.updateTabFocusability()
  }

  /** 选中标签；再次点击当前标签不再制造空白内容区。 */
  switchTab(tab: DocumentToolbarTab): void {
    if (this.mode !== 'expanded') this.open()
    if (this.tab === tab) {
      this.renderTabs()
      return
    }
    this.tab = tab
    if (tab === 'diagnostics') this.severityFilter = 'all'
    this.renderTabs()
    this.renderPanel()
    this.updateTabFocusability()
  }

  private handleTabKeyDown(event: KeyboardEvent, tab: DocumentToolbarTab): void {
    const index = TABS.findIndex(item => item.id === tab)
    if (index < 0) return
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    if (next < 0) return
    event.preventDefault()
    const nextTab = TABS[next]
    this.switchTab(nextTab.id)
    this.tabsEl?.querySelector<HTMLButtonElement>(`.${TAB_CLASS}[data-tab="${nextTab.id}"]`)?.focus()
  }

  private updateTabFocusability(): void {
    const tabs = this.tabsEl
    if (!tabs) return
    const expanded = this.mode === 'expanded'
    for (const button of Array.from(tabs.querySelectorAll<HTMLButtonElement>(`.${TAB_CLASS}`))) {
      button.tabIndex = expanded && button.dataset['tab'] === this.tab ? 0 : -1
    }
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
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
    const right = Math.max(VIEWPORT_GUTTER_PX, viewportWidth - rect.right)
    const top = Math.max(VIEWPORT_GUTTER_PX, rect.top)
    // 右端锚点固定；展开宽度只按真实可用空间收缩，绝不移动锚点。
    const available = Math.max(COLLAPSED_WIDTH_PX * 4, viewportWidth - right - VIEWPORT_GUTTER_PX)
    const panelMax = Math.max(180, viewportHeight - top - COLLAPSED_WIDTH_PX - 16)
    root.style.right = `${right}px`
    root.style.top = `${top}px`
    root.style.setProperty('--inkchapter-toolbar-available', `${Math.min(EXPANDED_WIDTH_PX, available)}px`)
    root.style.setProperty('--inkchapter-toolbar-panel-max', `${panelMax}px`)
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
    this.updateTabFocusability()
  }

  private renderPanel(): void {
    const panel = this.panelEl
    const model = this.model
    if (!panel) return
    if (!model) return
    panel.replaceChildren()
    panel.hidden = false
    panel.setAttribute('aria-labelledby', `${ROOT_CLASS}__tab-${this.tab}`)
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
    box.appendChild(this.buildOverviewLine(model, counts))
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

  /** 顶部状态概要：只显示真实非零数量，不重复“文档检测”标题。 */
  private buildOverviewLine(
    model: DocumentHubModel,
    counts: { error: number; warning: number; info: number },
  ): HTMLElement {
    const line = this.buildLine('inkchapter-doc-expand__overview')
    const summary = document.createElement('span')
    summary.className = 'inkchapter-doc-expand__summary'
    const parts: string[] = []
    if (counts.error > 0) parts.push(`${counts.error} 错误`)
    if (counts.warning > 0) parts.push(`${counts.warning} 警告`)
    if (counts.info > 0) parts.push(`${counts.info} 提示`)
    summary.textContent = parts.length > 0 ? parts.join(' · ') : '未发现问题'
    summary.setAttribute('aria-label', `检测结果：${summary.textContent}`)
    line.appendChild(summary)
    line.appendChild(this.buildIconButton('重新检测', RECHECK_ICON_PATH, () => this.options.actions.recheck(),
      model.actions.recheck ? null : '检测服务尚未就绪'))
    return line
  }

  private buildFilterLine(
    model: DocumentHubModel,
    counts: { error: number; warning: number; info: number },
  ): HTMLElement {
    const line = this.buildLine('inkchapter-doc-expand__filters')
    line.setAttribute('role', 'group')
    line.setAttribute('aria-label', '按严重级别筛选')
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
    return line
  }

  private buildDiagnosticRow(item: DocumentHubDiagnosticItem): HTMLButtonElement {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = `inkchapter-doc-expand__diag is-${item.severity}`
    row.dataset['severity'] = item.severity
    row.dataset['diagnosticId'] = item.id
    row.setAttribute('aria-label', item.line != null ? `${item.title}（第 ${item.line} 行）` : item.title)

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

    const loc = document.createElement('span')
    loc.className = 'inkchapter-doc-expand__diag-loc'
    loc.setAttribute('aria-hidden', 'true')
    loc.textContent = item.line != null ? `L${item.line}` : ''

    row.append(dot, body, loc)
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
      // Disabled batch actions stay visible with their real reason on hover:
      // the user must not wonder where the buttons went when the doc is empty.
      const actions = this.buildLine('inkchapter-doc-expand__actions')
      actions.append(
        this.buildButton('上传全部', false, () => {}, '当前文档没有图片引用', true),
        this.buildButton('下载全部', false, () => {}, '当前文档没有图片引用', true),
      )
      box.appendChild(actions)
      return box
    }

    const overview = this.buildLine('inkchapter-doc-expand__overview')
    const text = document.createElement('span')
    text.className = 'inkchapter-doc-expand__summary'
    text.textContent = `${image.scopeLabel} · ${image.referenceCount} 处引用`
    overview.appendChild(text)
    box.appendChild(overview)

    const facts: string[] = []
    if (image.insertionModeText) facts.push(`插入：${image.insertionModeText}`)
    if (image.autoSyncText) facts.push(`自动同步：${image.autoSyncText}`)
    if (facts.length > 0) {
      const meta = document.createElement('div')
      meta.className = 'inkchapter-doc-expand__meta'
      meta.textContent = facts.join(' · ')
      box.appendChild(meta)
    }

    const primary = this.buildLine('inkchapter-doc-expand__actions')
    primary.append(
      this.buildButton('上传全部', model.actions.uploadAll, () => this.options.actions.uploadAll(),
        explainBatchActionDisabled('uploadAll', model), true),
      this.buildButton('下载全部', model.actions.downloadAll, () => this.options.actions.downloadAll(),
        explainBatchActionDisabled('downloadAll', model), true),
    )
    box.appendChild(primary)

    const secondary = this.buildLine('inkchapter-doc-expand__actions is-secondary')
    secondary.append(
      this.buildButton('检查并补齐双链', model.actions.dualLink, () => this.options.actions.dualLink(),
        explainBatchActionDisabled('dualLink', model), false, 'link'),
      this.buildButton('文档设置', true, () => this.options.actions.openImageSettings(), null, false, 'ghost'),
    )
    box.appendChild(secondary)
    return box
  }

  private buildLockTab(model: DocumentHubModel): HTMLElement {
    const box = this.buildBox()
    const line = this.buildLine()
    const text = document.createElement('span')
    text.className = 'inkchapter-doc-expand__summary'
    text.textContent = model.locked ? '当前文档已锁定' : '当前文档可编辑'
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

  private buildLine(extraClass?: string): HTMLElement {
    const line = document.createElement('div')
    line.className = extraClass ? `inkchapter-doc-expand__line ${extraClass}` : 'inkchapter-doc-expand__line'
    return line
  }

  private buildButton(
    label: string,
    enabled: boolean,
    onClick: () => void,
    disabledReason?: string | null,
    primary = false,
    variant?: 'link' | 'ghost',
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'inkchapter-doc-expand__button'
    if (primary) button.classList.add('is-primary')
    if (variant) button.classList.add(`is-${variant}`)
    button.textContent = label
    button.disabled = !enabled
    if (!enabled && disabledReason) {
      button.title = disabledReason
      button.setAttribute('aria-description', disabledReason)
    }
    button.addEventListener('click', () => {
      if (button.disabled) return
      onClick()
    })
    return button
  }

  private buildIconButton(
    label: string,
    path: string,
    onClick: () => void,
    disabledReason?: string | null,
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'inkchapter-doc-expand__icon-button'
    button.setAttribute('aria-label', label)
    button.title = label
    if (disabledReason) {
      button.disabled = true
      button.title = disabledReason
      button.setAttribute('aria-description', disabledReason)
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('width', '13')
    svg.setAttribute('height', '13')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    icon.setAttribute('d', path)
    icon.setAttribute('fill', 'none')
    icon.setAttribute('stroke', 'currentColor')
    icon.setAttribute('stroke-width', '1.4')
    icon.setAttribute('stroke-linecap', 'round')
    icon.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(icon)
    button.appendChild(svg)
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

  /** 布局审计入口：layout / header / content 三个几何权威节点。 */
  getLayoutElements(): { root: HTMLElement | null; layout: HTMLElement | null; header: HTMLElement | null; content: HTMLElement | null } {
    return {
      root: this.rootEl,
      layout: this.layoutEl,
      header: this.headerEl,
      content: this.panelEl,
    }
  }

  /**
   * 真实几何测量（供 GUI 审计 / 断言）：header 与 content 的左/右/宽度差值。
   * 生产路径不调用；调用方负责在展开动画稳定后取值。
   */
  measureLayout(): {
    header: { left: number; right: number; width: number }
    content: { left: number; right: number; width: number }
    deltas: { left: number; right: number; width: number }
  } | null {
    const header = this.headerEl
    const content = this.panelEl
    if (!header || !content) return null
    const h = header.getBoundingClientRect()
    const c = content.getBoundingClientRect()
    return {
      header: { left: h.left, right: h.right, width: h.width },
      content: { left: c.left, right: c.right, width: c.width },
      deltas: {
        left: Math.abs(h.left - c.left),
        right: Math.abs(h.right - c.right),
        width: Math.abs(h.width - c.width),
      },
    }
  }

  dispose(): void {
    if (this.pendingClickTimer != null) {
      clearTimeout(this.pendingClickTimer)
      this.pendingClickTimer = null
    }
    this.close()
    this.rootEl?.remove()
    this.rootEl = null
    this.layoutEl = null
    this.headerEl = null
    this.statusEl = null
    this.squareEl = null
    this.lockFrameEl = null
    this.tabsEl = null
    this.panelEl = null
    if (this.onDocMouseDown) document.removeEventListener('mousedown', this.onDocMouseDown, true)
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown, true)
    if (this.onWindowResize) window.removeEventListener('resize', this.onWindowResize)
    this.onDocMouseDown = null
    this.onKeyDown = null
    this.onWindowResize = null
  }
}

/** 16×16 线性“重新检测”图标路径。 */
const RECHECK_ICON_PATH =
  'M13 8a5 5 0 1 1-1.5-3.5M13 2v3.2H9.8'
