/**
 * V5.2 — 一体化可展开文档状态工具栏（Fluent Compact 精修版）。
 *
 * 结构（唯一 DOM 宿主，绝不进入 #write）：
 *   .inkchapter-doc-toolbar-ui              (fixed，右/上锚定；宽度跟随 layout)
 *   └─ .inkchapter-doc-expand__layout       (唯一宽度权威；收起 40px / 展开 min(360, 可用))
 *      ├─ .inkchapter-doc-expand__row       (header：100% 宽；grid = 1fr + 38px 状态热区)
 *      │   ├─ .inkchapter-doc-expand__tabs  (3 等分 Segmented 标签，仅展开时显示)
 *      │   └─ button.inkchapter-doc-status  (15px 纯色方块 + 32px 透明热区)
 *      └─ .inkchapter-doc-expand__panel     (content：100% 宽；唯一内容区)
 *
 * V5.2 Fluent Compact：header 与 content 是同一 layout 的两个 width:100% 子项，
 * 状态热区计入 header 总宽度（38px 列，热区 32px 居中，方块 15px），左右边界同时
 * 重合。检测标签直接渲染真实诊断列表；顶部只保留真实计数概要、筛选 popup 与
 * 重新检测图标。无摘要/详情/返回页，无第二个抽屉。
 */
import type {
  DiagnosticSortMode,
  DocumentHubDiagnosticItem,
  DocumentHubModel,
} from './document-hub-model'
import {
  DIAGNOSTIC_SORT_MODES,
  explainBatchActionDisabled,
  filterDiagnosticItems,
  sortDiagnosticItems,
} from './document-hub-model'
import type { DocumentStatusView } from './document-status-indicator'
import { buildFixPanel, type FixPanelHandlers, type FixPanelState } from './document-diagnostic-fix-panel'

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
  /** 行内「修复/处理」：打开真实修复预览（同类修复在预览内切换）。 */
  fixDiagnostic?(diagnosticId: string): void
  /** 「一键修复可处理项」：仅 AUTO_SAFE 计划。 */
  fixAllAuto?(): void
}

export interface DocumentHubControllerOptions {
  mountEl: HTMLElement
  actions: DocumentHubActions
  getHint?: () => string | null
  doubleClickWindowMs?: number
  /**
   * Called when the panel opens, so the host can refresh the model for
   * panel-only facts (e.g. the real AUTO_SAFE plan count) without taxing every
   * diagnostics publish while the panel is closed.
   */
  onOpen?: () => void
}

const ROOT_CLASS = 'inkchapter-doc-toolbar-ui'
const LAYOUT_CLASS = 'inkchapter-doc-expand__layout'
const ROW_CLASS = 'inkchapter-doc-expand__row'
const STATUS_CLASS = 'inkchapter-doc-status'
const TABS_CLASS = 'inkchapter-doc-expand__tabs'
const TAB_CLASS = 'inkchapter-doc-expand__tab'
const PANEL_CLASS = 'inkchapter-doc-expand__panel'
const FILTER_POPUP_CLASS = 'inkchapter-doc-expand__filter-popup'
const FILTER_OPTION_CLASS = 'inkchapter-doc-expand__filter-option'
const TABS: readonly { id: DocumentToolbarTab; label: string }[] = [
  { id: 'diagnostics', label: '检测' },
  { id: 'images', label: '图片' },
  { id: 'lock', label: '锁定' },
]
const FILTERS: readonly { id: DiagnosticSeverityFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'error', label: '错误' },
  { id: 'warning', label: '警告' },
  { id: 'info', label: '提示' },
]

/** 收起态布局宽度 = 状态列（含方块右侧留白）；展开宽度初始值。 */
const COLLAPSED_WIDTH_PX = 40
const EXPANDED_WIDTH_PX = 360
const COMPONENT_RIGHT_INSET_PX = 12
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
  private filterPopupEl: HTMLElement | null = null
  private model: DocumentHubModel | null = null
  /** The update(view) authority; the overview copy must use the SAME kind. */
  private statusView: DocumentStatusView | null = null
  private mode: DocumentToolbarMode = 'collapsed'
  private tab: DocumentToolbarTab = 'diagnostics'
  private severityFilter: DiagnosticSeverityFilter = 'all'
  private sortMode: DiagnosticSortMode = 'document'
  private openPopup: 'filter' | 'sort' | null = null
  private selectedDiagnosticId: string | null = null
  private fixPanelState: FixPanelState | null = null
  private fixPanelHandlers: FixPanelHandlers | null = null
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
      if (this.layoutEl?.contains(target)) {
        if (this.openPopup != null
          && !this.filterPopupEl?.contains(target)
          && !(this.panelEl?.querySelector('.inkchapter-doc-expand__filter-button')?.contains(target))
          && !(this.panelEl?.querySelector('.inkchapter-doc-expand__sort-button')?.contains(target))) {
          this.closePopup()
        }
        return
      }
      this.close()
    }
    this.onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // A pending fix preview is the innermost layer: Esc cancels it first and
      // NEVER collapses the whole panel (no half-applied repair).
      if (this.fixPanelState != null) {
        event.preventDefault()
        this.cancelFixPanel()
        return
      }
      if (this.openPopup != null) {
        if (this.filterPopupEl?.contains(event.target as Node)) return
        event.preventDefault()
        this.closePopup()
        this.severityFilterFocusRestore()
        return
      }
      if (this.mode !== 'expanded') return
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
    // B1 §B1-03 — the passed view is the ONE severity authority for this frame.
    // Bind it onto the model so a caller can never mix a stale model.status with
    // a newer view (the previous row-count implementation hid that mismatch).
    this.model = {
      ...model,
      status: view,
      rowCount: model.rowCount ?? model.diagnostics.length,
    }
    this.statusView = view
    if (!this.rootEl) this.mount()
    // Selection follows the DIAGNOSTIC ID, never an array index: a row that
    // disappeared from the new snapshot can never keep a stale "selected" state.
    if (this.selectedDiagnosticId != null
      && !this.model.diagnostics.some(item => item.id === this.selectedDiagnosticId)) {
      this.selectedDiagnosticId = null
    }
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

  getSortMode(): DiagnosticSortMode {
    return this.sortMode
  }

  getSelectedDiagnosticId(): string | null {
    return this.selectedDiagnosticId
  }

  isFilterPopupOpen(): boolean {
    return this.openPopup === 'filter'
  }

  isSortPopupOpen(): boolean {
    return this.openPopup === 'sort'
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
    this.closePopup()
    this.rootEl!.dataset['expanded'] = 'true'
    this.tabsEl!.hidden = false
    this.positionRoot()
    this.renderPanel()
    this.renderTabs()
    this.waitForOpenFrame()
    this.statusEl?.setAttribute('aria-expanded', 'true')
    this.updateTabFocusability()
    // Panel-only facts (auto-fix plan count) are refreshed on open; the host
    // skips that planning work while the panel is closed.
    try { this.options.onOpen?.() } catch { /* presentation-only */ }
  }

  close(): void {
    if (this.mode !== 'expanded') return
    this.mode = 'collapsed'
    this.closePopup()
    if (this.fixPanelState != null) this.cancelFixPanel()
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
    this.closePopup()
    if (this.fixPanelState != null) this.cancelFixPanel()
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
    // 整个组件共用一个右端 inset；不做 header/content 各自偏移。
    const right = COMPONENT_RIGHT_INSET_PX
    const top = Math.max(VIEWPORT_GUTTER_PX, rect.top)
    const available = Math.max(COLLAPSED_WIDTH_PX * 4, viewportWidth - right - VIEWPORT_GUTTER_PX)
    const panelMax = Math.max(180, viewportHeight - top - 34 - 16)
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
    this.filterPopupEl = null
    panel.hidden = false
    panel.setAttribute('aria-labelledby', `${ROOT_CLASS}__tab-${this.tab}`)
    if (this.tab === 'diagnostics') {
      // The fix interaction lives INSIDE the 检测 page (no fourth tab, no
      // floating dialog over the document).
      if (this.fixPanelState != null && this.fixPanelHandlers != null) {
        panel.appendChild(buildFixPanel(this.fixPanelState, this.fixPanelHandlers))
        return
      }
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

    // B1 §B1-03 — severity counts are NORMALIZED DIAGNOSTIC EVENTS from the ONE
    // status authority. Multi-target rows are a view detail and never inflate
    // the warning/error/hint counts.
    const counts = {
      error: model.status.errorCount,
      warning: model.status.warningCount,
      info: model.status.hintCount,
    }
    box.appendChild(this.buildOverviewLine(model, counts))
    box.appendChild(this.buildFixAllLine(model))

    // Filter first, then the VIEW-ONLY sort. Neither step mutates the item
    // identity, the multi-target grouping or the authoritative counts.
    const filtered = sortDiagnosticItems(
      filterDiagnosticItems(model.diagnostics, this.severityFilter),
      this.sortMode,
    )

    const list = document.createElement('div')
    list.className = 'inkchapter-doc-expand__list'
    list.setAttribute('role', 'list')
    if (filtered.length === 0) {
      // A zero-diagnostic document is already explained by the overview
      // ("未检查" / "未发现问题"); do not repeat it inside the list. Only a
      // narrowed filter with no matches needs its own line.
      if (model.diagnostics.length > 0) {
        list.appendChild(this.buildEmptyLine('没有匹配项'))
      }
    } else {
      for (const item of filtered) {
        list.appendChild(this.buildDiagnosticRow(item))
      }
    }
    box.appendChild(list)
    if (this.openPopup === 'filter') {
      const popup = this.buildFilterPopup(counts)
      this.filterPopupEl = popup
      box.appendChild(popup)
    } else if (this.openPopup === 'sort') {
      const popup = this.buildSortPopup()
      this.filterPopupEl = popup
      box.appendChild(popup)
    }
    return box
  }

  /**
   * 第二行（仅当存在可安全自动修复能力时）：`N 项可自动修复` + 一键修复。
   * `autoFixableCount` is computed from REAL plans by the host, never typed in.
   */
  private buildFixAllLine(model: DocumentHubModel): HTMLElement {
    const line = this.buildLine('inkchapter-doc-expand__fixall')
    if (model.autoFixableCount <= 0) {
      if (model.diagnostics.length === 0) {
        line.hidden = true
        return line
      }
      const note = document.createElement('span')
      note.className = 'inkchapter-doc-expand__meta'
      note.textContent = '当前没有可安全自动修复项'
      line.appendChild(note)
      return line
    }
    const text = document.createElement('span')
    text.className = 'inkchapter-doc-expand__summary is-fixall-count'
    text.textContent = `${model.autoFixableCount} 项可自动修复`
    line.appendChild(text)
    line.appendChild(this.buildButton(
      '一键修复可处理项',
      !model.locked && !model.fixBusy && typeof this.options.actions.fixAllAuto === 'function',
      () => this.options.actions.fixAllAuto?.(),
      model.locked ? '文档已锁定：请先解锁' : model.fixBusy ? '正在应用修复…' : '修复服务尚未就绪',
      false,
      'link',
    ))
    return line
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
    if (counts.error > 0) parts.push(`${counts.error} 项错误`)
    if (counts.warning > 0) parts.push(`${counts.warning} 项警告`)
    if (counts.info > 0) parts.push(`${counts.info} 项提示`)
    const eventTotal = counts.error + counts.warning + counts.info
    const isGray = (this.statusView?.code ?? model.status.code) === 'GRAY'
    if (!isGray && model.rowCount !== eventTotal) parts.push(`${model.rowCount} 行`)
    summary.textContent = isGray
      ? '未检查'
      : (parts.length > 0 ? parts.join(' · ') : '未发现问题')
    summary.setAttribute('aria-label', `检测结果：${summary.textContent}`)
    line.appendChild(summary)

    const actions = document.createElement('div')
    actions.className = 'inkchapter-doc-expand__overview-actions'
    actions.appendChild(this.buildSortButton())
    actions.appendChild(this.buildFilterButton())
    actions.appendChild(this.buildIconButton(
      '重新检测',
      RECHECK_ICON_PATH,
      () => this.options.actions.recheck(),
      model.actions.recheck ? null : '检测服务尚未就绪',
    ))
    line.appendChild(actions)
    return line
  }

  private buildSortButton(): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'inkchapter-doc-expand__icon-button inkchapter-doc-expand__sort-button'
    if (this.sortMode !== 'document') button.classList.add('is-active')
    const current = DIAGNOSTIC_SORT_MODES.find(item => item.id === this.sortMode)?.label ?? '文档顺序'
    button.setAttribute('aria-label', `排序：${current}`)
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', String(this.openPopup === 'sort'))
    button.title = `排序：${current}`
    button.appendChild(buildSvgIcon(SORT_ICON_PATH))
    button.addEventListener('click', () => {
      const next = this.openPopup === 'sort' ? null : 'sort'
      this.setOpenPopup(next)
      if (next === 'sort') this.focusFirstMenuOption()
    })
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return
      event.preventDefault()
      this.setOpenPopup('sort')
      this.focusFirstMenuOption()
    })
    return button
  }

  private buildSortPopup(): HTMLElement {
    const popup = document.createElement('div')
    popup.className = `${FILTER_POPUP_CLASS} inkchapter-doc-expand__sort-popup`
    popup.setAttribute('role', 'menu')
    popup.setAttribute('aria-label', '排序方式')
    for (const item of DIAGNOSTIC_SORT_MODES) {
      const option = document.createElement('button')
      option.type = 'button'
      option.className = FILTER_OPTION_CLASS
      option.dataset['sort'] = item.id
      option.setAttribute('role', 'menuitemradio')
      option.setAttribute('aria-checked', String(this.sortMode === item.id))
      option.tabIndex = -1

      const check = document.createElement('span')
      check.className = 'inkchapter-doc-expand__filter-check'
      check.setAttribute('aria-hidden', 'true')
      check.textContent = this.sortMode === item.id ? '✓' : ''

      const label = document.createElement('span')
      label.className = 'inkchapter-doc-expand__filter-label'
      label.textContent = item.label

      const count = document.createElement('span')
      count.className = 'inkchapter-doc-expand__filter-count'
      count.textContent = item.id === 'document' ? '' : ''

      option.append(check, label, count)
      option.addEventListener('click', () => {
        this.sortMode = item.id
        this.setOpenPopup(null)
        this.renderPanel()
        this.panelEl?.querySelector<HTMLButtonElement>('.inkchapter-doc-expand__sort-button')?.focus()
      })
      option.addEventListener('keydown', (event) => this.handleFilterOptionKey(event, option))
      popup.appendChild(option)
    }
    return popup
  }

  private buildFilterButton(): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'inkchapter-doc-expand__icon-button inkchapter-doc-expand__filter-button'
    if (this.severityFilter !== 'all') button.classList.add('is-active')
    const current = FILTERS.find(item => item.id === this.severityFilter)?.label ?? '全部'
    button.setAttribute('aria-label', `筛选：${current}`)
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', String(this.openPopup === 'filter'))
    button.title = '筛选严重级别'
    button.appendChild(buildSvgIcon(FILTER_ICON_PATH))
    button.addEventListener('click', () => {
      const next = this.openPopup === 'filter' ? null : 'filter'
      this.setOpenPopup(next)
      if (next === 'filter') this.focusFirstFilterOption()
    })
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return
      event.preventDefault()
      this.setOpenPopup('filter')
      this.focusFirstFilterOption()
    })
    return button
  }

  private buildFilterPopup(counts: { error: number; warning: number; info: number }): HTMLElement {
    const popup = document.createElement('div')
    popup.className = FILTER_POPUP_CLASS
    popup.setAttribute('role', 'menu')
    popup.setAttribute('aria-label', '按严重级别筛选')
    const items = [
      { id: 'all' as const, label: '全部', count: this.model?.rowCount ?? 0 },
      { id: 'error' as const, label: '错误', count: counts.error },
      { id: 'warning' as const, label: '警告', count: counts.warning },
      { id: 'info' as const, label: '提示', count: counts.info },
    ]
    for (const item of items) {
      const option = document.createElement('button')
      option.type = 'button'
      option.className = FILTER_OPTION_CLASS
      option.dataset['filter'] = item.id
      option.setAttribute('role', 'menuitemradio')
      option.setAttribute('aria-checked', String(this.severityFilter === item.id))
      option.tabIndex = -1

      const check = document.createElement('span')
      check.className = 'inkchapter-doc-expand__filter-check'
      check.setAttribute('aria-hidden', 'true')
      check.textContent = this.severityFilter === item.id ? '✓' : ''

      const label = document.createElement('span')
      label.className = 'inkchapter-doc-expand__filter-label'
      label.textContent = item.label

      const count = document.createElement('span')
      count.className = 'inkchapter-doc-expand__filter-count'
      count.textContent = String(item.count)

      option.append(check, label, count)
      option.addEventListener('click', () => {
        this.severityFilter = item.id
        this.setOpenPopup(null)
        this.severityFilterFocusRestore()
      })
      option.addEventListener('keydown', (event) => this.handleFilterOptionKey(event, option))
      popup.appendChild(option)
    }
    return popup
  }

  private handleFilterOptionKey(event: KeyboardEvent, option: HTMLButtonElement): void {
    const options = Array.from(
      this.panelEl?.querySelectorAll<HTMLButtonElement>(`.${FILTER_OPTION_CLASS}`) ?? [],
    )
    const index = options.indexOf(option)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (options.length === 0) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      options[(index + delta + options.length) % options.length]?.focus()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      // Capture the owning menu BEFORE closing (the restore target depends on it).
      const owner = this.openPopup
      this.setOpenPopup(null)
      this.menuFocusRestore(owner)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      option.click()
    }
  }

  private severityFilterFocusRestore(): void {
    this.panelEl?.querySelector<HTMLButtonElement>('.inkchapter-doc-expand__filter-button')?.focus()
  }

  /** Restore focus to the button that owned the CLOSED menu (filter or sort). */
  private menuFocusRestore(owner: 'filter' | 'sort' | null = this.openPopup): void {
    const selector = owner === 'sort'
      ? '.inkchapter-doc-expand__sort-button'
      : '.inkchapter-doc-expand__filter-button'
    this.panelEl?.querySelector<HTMLButtonElement>(selector)?.focus()
  }

  private focusFirstFilterOption(): void {
    this.focusFirstMenuOption()
  }

  private focusFirstMenuOption(): void {
    const first = this.panelEl?.querySelector<HTMLButtonElement>(`.${FILTER_OPTION_CLASS}`)
    if (!first) return
    for (const option of Array.from(this.panelEl?.querySelectorAll<HTMLButtonElement>(`.${FILTER_OPTION_CLASS}`) ?? [])) {
      option.tabIndex = -1
    }
    first.tabIndex = 0
    first.focus()
  }

  private setOpenPopup(next: 'filter' | 'sort' | null): void {
    if (this.openPopup === next) return
    this.openPopup = next
    if (this.mode === 'expanded') this.renderPanel()
  }

  private closePopup(): void {
    if (this.openPopup == null) return
    this.openPopup = null
  }

  private buildDiagnosticRow(item: DocumentHubDiagnosticItem): HTMLElement {
    // A row is NOT a <button>: it must host an inner action button (repair).
    // ARIA + keyboard activation keep the row's locate behavior identical.
    const row = document.createElement('div')
    row.className = `inkchapter-doc-expand__diag is-${item.severity}`
    row.dataset['severity'] = item.severity
    row.dataset['diagnosticId'] = item.id
    row.setAttribute('role', 'button')
    row.tabIndex = 0
    row.setAttribute('aria-label', item.line != null ? `${item.title}（第 ${item.line} 行）` : item.title)
    if (this.selectedDiagnosticId === item.id) {
      row.classList.add('is-selected')
      row.setAttribute('aria-current', 'true')
    }

    const dot = document.createElement('span')
    dot.className = 'inkchapter-doc-expand__diag-dot'
    dot.setAttribute('aria-hidden', 'true')

    const body = document.createElement('span')
    body.className = 'inkchapter-doc-expand__diag-body'
    const title = document.createElement('span')
    title.className = 'inkchapter-doc-expand__diag-title'
    title.textContent = item.title
    if ((item.targetCount ?? 1) > 1) {
      const badge = document.createElement('span')
      badge.className = 'inkchapter-doc-expand__diag-badge'
      badge.textContent = `${(item.targetIndex ?? 0) + 1}/${item.targetCount}`
      title.appendChild(badge)
    }
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

    const action = document.createElement('span')
    action.className = 'inkchapter-doc-expand__diag-action'
    const fix = item.fix
    const fixable = fix != null && fix.capability !== 'UNAVAILABLE' && fix.capability !== 'MANUAL_ONLY'
    if (fixable) {
      const fixButton = document.createElement('button')
      fixButton.type = 'button'
      fixButton.className = 'inkchapter-doc-expand__diag-fix'
      fixButton.textContent = fix.capability === 'AUTO_SAFE' ? '修复' : '处理'
      fixButton.setAttribute('aria-label', `${fix.label}：${item.title}`)
      const locked = this.model?.locked === true
      const busy = this.model?.fixBusy === true
      fixButton.disabled = locked || busy || typeof this.options.actions.fixDiagnostic !== 'function'
      fixButton.title = locked ? '文档已锁定：请先解锁' : busy ? '正在应用修复…' : fix.label
      fixButton.addEventListener('click', (event) => {
        event.stopPropagation()
        if (fixButton.disabled) return
        this.selectedDiagnosticId = item.id
        this.options.actions.fixDiagnostic?.(item.id)
      })
      fixButton.addEventListener('keydown', (event) => event.stopPropagation())
      action.appendChild(fixButton)
    }

    row.append(dot, body, loc, action)
    row.title = item.line != null ? `${item.title}（第 ${item.line} 行）` : item.title
    const locate = (): void => {
      this.selectedDiagnosticId = item.id
      this.close()
      this.options.actions.locateDiagnostic?.(item.id)
    }
    row.addEventListener('click', locate)
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      locate()
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
      text.textContent = '当前文档无图片'
      line.append(text, this.buildButton('设置', true, () => this.options.actions.openImageSettings()))
      box.appendChild(line)
      // Disabled batch actions stay visible with their real reason on hover:
      // the user must not wonder where the buttons went when the doc is empty.
      const actions = this.buildLine('inkchapter-doc-expand__actions is-primary-actions')
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

    // Resource facts are preview-supported only: missing local files are NOT
    // uploadable, so they are reported separately from "可上传".
    const resourceFacts: string[] = []
    if (image.pendingUploadCount > 0) resourceFacts.push(`可上传 ${image.pendingUploadCount}`)
    if (image.pendingDownloadCount > 0) resourceFacts.push(`可下载 ${image.pendingDownloadCount}`)
    if ((image.missingLocalCount ?? 0) > 0) resourceFacts.push(`缺失 ${image.missingLocalCount}`)
    const reusable = image.reuseLocalCount + image.reuseRemoteCount
    if (reusable > 0) resourceFacts.push(`可复用 ${reusable}`)
    if (resourceFacts.length > 0) {
      const resourceLine = document.createElement('div')
      resourceLine.className = 'inkchapter-doc-expand__meta'
      resourceLine.textContent = resourceFacts.join(' · ')
      box.appendChild(resourceLine)
    }

    const facts: string[] = []
    if (image.insertionModeText) facts.push(`插入：${image.insertionModeText}`)
    if (image.autoSyncText) facts.push(`自动同步：${image.autoSyncText}`)
    if (facts.length > 0) {
      const meta = document.createElement('div')
      meta.className = 'inkchapter-doc-expand__meta'
      meta.textContent = facts.join(' · ')
      box.appendChild(meta)
    }

    const primary = this.buildLine('inkchapter-doc-expand__actions is-primary-actions')
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
      this.buildButton('当前文档设置', true, () => this.options.actions.openImageSettings(), null, false, 'ghost'),
    )
    box.appendChild(secondary)
    return box
  }

  private buildLockTab(model: DocumentHubModel): HTMLElement {
    const box = this.buildBox()
    const line = this.buildLine('inkchapter-doc-expand__lock-line')
    const state = document.createElement('span')
    state.className = 'inkchapter-doc-expand__lock-state'
    const icon = document.createElement('span')
    icon.className = 'inkchapter-doc-expand__lock-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.appendChild(buildSvgIcon(model.locked ? LOCK_ICON_PATH : UNLOCK_ICON_PATH))
    const text = document.createElement('span')
    text.className = 'inkchapter-doc-expand__summary'
    text.textContent = model.locked ? '已锁定' : '编辑中'
    state.append(icon, text)
    line.append(state, this.buildButton(
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
    button.appendChild(buildSvgIcon(path))
    button.addEventListener('click', () => {
      if (button.disabled) return
      onClick()
    })
    return button
  }

  getPanelElement(): HTMLElement | null {
    return this.panelEl
  }

  /** Render the REAL fix interaction (input / diff preview) inside the panel. */
  showFixPanel(state: FixPanelState, handlers: FixPanelHandlers): void {
    if (!this.rootEl) this.mount()
    this.fixPanelState = state
    this.fixPanelHandlers = handlers
    if (this.mode !== 'expanded') this.open()
    if (this.tab !== 'diagnostics') this.switchTab('diagnostics')
    this.renderPanel()
  }

  /** Re-render the current fix panel state (busy / error / live diff). */
  updateFixPanel(state: FixPanelState): void {
    if (this.fixPanelState == null) return
    this.fixPanelState = state
    if (this.mode === 'expanded' && this.tab === 'diagnostics') this.renderPanel()
  }

  closeFixPanel(): void {
    // 直接修复不会打开修复面板，但同样要重绘一次：否则已修复的诊断行会停留在
    // 展开的面板里，直到用户手动切换标签页。
    this.fixPanelState = null
    this.fixPanelHandlers = null
    if (this.mode === 'expanded' && this.tab === 'diagnostics') this.renderPanel()
  }

  isFixPanelOpen(): boolean {
    return this.fixPanelState != null
  }

  getFixPanelElement(): HTMLElement | null {
    return this.panelEl?.querySelector('.inkchapter-doc-expand__fix') as HTMLElement | null
  }

  /** User-initiated cancellation (Esc / cancel button / tab switch). */
  cancelFixPanel(): void {
    const handlers = this.fixPanelHandlers
    this.fixPanelState = null
    this.fixPanelHandlers = null
    handlers?.onCancel()
    if (this.mode === 'expanded' && this.tab === 'diagnostics') this.renderPanel()
  }

  getStatusElement(): HTMLElement | null {
    return this.statusEl
  }

  getFilterPopupElement(): HTMLElement | null {
    return this.filterPopupEl
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
    this.fixPanelState = null
    this.fixPanelHandlers = null
    this.rootEl?.remove()
    this.rootEl = null
    this.layoutEl = null
    this.headerEl = null
    this.statusEl = null
    this.squareEl = null
    this.lockFrameEl = null
    this.tabsEl = null
    this.panelEl = null
    this.filterPopupEl = null
    if (this.onDocMouseDown) document.removeEventListener('mousedown', this.onDocMouseDown, true)
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown, true)
    if (this.onWindowResize) window.removeEventListener('resize', this.onWindowResize)
    this.onDocMouseDown = null
    this.onKeyDown = null
    this.onWindowResize = null
  }
}

/** 16×16 线性图标路径（Fluent 风格细线）。 */
const RECHECK_ICON_PATH =
  'M13 8a5 5 0 1 1-1.5-3.5M13 2v3.2H9.8'
const FILTER_ICON_PATH =
  'M2.5 3.5h11M4.5 8h7M6.5 12.5h3'
const SORT_ICON_PATH =
  'M4 12.5V3.5M2 5.5L4 3.5l2 2M12 3.5v9M10 10.5l2 2 2-2'
const LOCK_ICON_PATH =
  'M4.5 7V5.5a3.5 3.5 0 1 1 7 0V7M3.5 7h9v6.5h-9z'
const UNLOCK_ICON_PATH =
  'M4.5 7V5.5a3.5 3.5 0 0 1 6.4-2M3.5 7h9v6.5h-9z'

function buildSvgIcon(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  icon.setAttribute('d', path)
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-width', '1.3')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(icon)
  return svg
}
