/**
 * R14-02 — 正文诊断徽章的展示与交互控制器。
 *
 * 从 `document-utility-overlay-host.ts` 抽出的唯一徽章权威：
 *
 * 1. 展示（纯函数）
 *    - 输入：一个标题真实拥有的全部诊断 + 标题文本 + 真实源码行号；
 *    - 输出：`reasonItems`（最多两个具体徽章 + `+N` 汇总）与主文案；
 *    - 文案、优先级、语义去重全部复用 `document-diagnostic-badge-v1`，
 *      本模块不产生第二套映射。
 *
 * 2. 交互（有状态控制器）
 *    - 指针：只有「同一徽章、左键、位移 ≤6px」的完整手势才会激活；
 *      拖拽结束后的合成 click 被抑制；右键永不拦截。
 *    - 键盘：Enter / Space 等价点击，Escape 结束临时分组聚焦。
 *    - `+N`：读取该标题的真实诊断 id 集合，打开面板并临时聚焦全部行。
 *    - 生命周期：所有定时器集中登记，`dispose()` / 关闭面板时清零。
 *
 * 宿主只提供「打开面板 / 定位 / 绘制聚焦」这几个端口，不再持有徽章手势状态。
 */

import {
  buildDiagnosticBadgeSet,
  formatDiagnosticBadgeTooltip,
  type DiagnosticBadgeInput,
} from './document-diagnostic-badge-v1'
import {
  mergeHeadingMarkerSeverity,
  severityRank,
  shouldRenderReasonChip,
} from './document-heading-diagnostic-marker-v5-12'

export type HeadingBadgeSeverity = 'error' | 'warning' | 'info'

/** 一个标题真实拥有的诊断（宿主快照的最小结构投影）。 */
export interface HeadingBadgeDiagnosticSource {
  id: string
  code: string
  severity?: string | null
  message?: string | null
  detail?: string | null
  category?: string | null
  metadata?: Record<string, unknown> | null
  targetIdentity?: string | null
}

export interface HeadingBadgeReasonItem {
  diagnosticId: string
  severity: HeadingBadgeSeverity
  text: string
  rank: number
  /** 具体诊断徽章，或 `+N` 汇总徽章。 */
  kind?: 'diagnostic' | 'summary'
  /** 完整规则名 + 一句说明 + 真实 `Lxx`。 */
  tooltip?: string
  /** 该标题真实拥有的全部诊断（`+N` 点击范围）。 */
  headingDiagnosticIds?: string[]
}

export interface HeadingBadgePresentation {
  reasonItems: HeadingBadgeReasonItem[]
  /** 主文案（最高优先级徽章）；没有任何徽章时为 null。 */
  reasonText: string | null
}

export interface HeadingBadgePresentationArgs {
  headingText: string
  /** 1-based 真实源码行号，未知为 null。 */
  line: number | null
  diagnostics: readonly HeadingBadgeDiagnosticSource[]
}

/**
 * 徽章展示的唯一入口。非 chip-eligible 诊断被过滤掉（文档级诊断不在正文
 * 出现），但底层诊断永远不会被删除。
 */
export function buildHeadingBadgePresentation(
  args: HeadingBadgePresentationArgs,
): HeadingBadgePresentation {
  const inputs: DiagnosticBadgeInput[] = []
  for (const d of args.diagnostics) {
    if (!shouldRenderReasonChip({ metadata: d.metadata ?? {}, code: d.code })) continue
    inputs.push({
      diagnosticId: d.id,
      code: d.code,
      severity: d.severity ?? null,
      message: d.message ?? null,
      detail: d.detail ?? null,
      category: d.category ?? null,
      metadata: d.metadata ?? null,
      line: args.line,
      headingText: args.headingText,
      targetIdentity: d.targetIdentity ?? null,
    })
  }

  const set = buildDiagnosticBadgeSet(inputs)
  const headingDiagnosticIds = inputs.map(i => i.diagnosticId)
  const reasonItems: HeadingBadgeReasonItem[] = set.visible.map(b => ({
    diagnosticId: b.diagnosticId,
    severity: b.severity,
    text: b.shortLabel,
    rank: severityRank(b.severity),
    kind: 'diagnostic' as const,
    tooltip: formatDiagnosticBadgeTooltip(b),
    headingDiagnosticIds,
  }))
  if (set.summary) {
    const highest = mergeHeadingMarkerSeverity(set.all.map(b => b.severity)) ?? 'info'
    reasonItems.push({
      diagnosticId: '',
      severity: highest,
      text: set.summary.label,
      rank: -1,
      kind: 'summary',
      tooltip: `该标题还有 ${set.summary.count} 个问题，点击在检测面板查看全部`,
      headingDiagnosticIds,
    })
  }

  return {
    reasonItems,
    reasonText: reasonItems.length > 0 ? reasonItems[0].text : null,
  }
}

// ── 交互控制器 ──────────────────────────────────────────────

/** 宿主端口：控制器只负责手势/状态，面板操作由宿主实现。 */
export interface HeadingBadgeInteractionPorts {
  /** 打开（或保持）面板并精确定位一个诊断。 */
  openAndLocate(diagnosticId: string): void
  /** 打开（或保持）面板并定位到该标题的第一个可定位诊断。 */
  openAndLocateFirst(diagnosticIds: readonly string[]): void
  /** 在面板行上绘制临时分组聚焦。 */
  paintGroupFocus(ids: ReadonlySet<string>): void
  /** 清除临时分组聚焦。 */
  clearGroupFocusPaint(): void
  isDisposed(): boolean
}

const KEEP_DRAWER_OPEN_MS = 2500
const GROUP_FOCUS_MS = 6000
const GROUP_FOCUS_REAPPLY_DELAYS_MS = [0, 160, 480, 960] as const
const ACTIVATION_DEDUP_MS = 450
const DRAG_SUPPRESS_CLICK_MS = 500
const DRAG_TOLERANCE_PX = 6

const BADGE_ITEM_SELECTOR = '.inkchapter-heading-diagnostic-reason__item'
const MARKER_SELECTOR = '.inkchapter-heading-diagnostic-marker'

/**
 * R14 徽章手势与聚焦状态。一个宿主实例只创建一次；`bind()` 幂等。
 */
export class HeadingBadgeInteractionController {
  private layer: HTMLElement | null = null
  private listeners: AbortController | null = null

  private pointerDownItem: HTMLElement | null = null
  private pointerDownX = 0
  private pointerDownY = 0
  private pointerDownButton = -1
  private suppressClickUntil = 0

  private lastActivationKey = ''
  private lastActivationAt = 0

  private keepDrawerOpenUntil = 0
  private groupFocusIds = new Set<string>()
  private groupFocusTimer: ReturnType<typeof setTimeout> | null = null
  private groupFocusReapplyTimers: Array<ReturnType<typeof setTimeout>> = []

  constructor(private readonly ports: HeadingBadgeInteractionPorts) {}

  /** 绑定到标记层（可重复调用；换层时先解绑旧层）。 */
  bind(layer: HTMLElement): void {
    if (this.layer === layer) return
    this.unbind()
    this.layer = layer
    layer.setAttribute('data-ink-badge-interaction', 'true')
    const listeners = new AbortController()
    this.listeners = listeners
    const options: AddEventListenerOptions = { capture: true, signal: listeners.signal }
    layer.addEventListener('pointerdown', this.onPointerDown, options)
    layer.addEventListener('mousedown', this.onPointerDown, options)
    layer.addEventListener('pointerup', this.onPointerUp, options)
    layer.addEventListener('click', this.onClick, options)
    layer.addEventListener('keydown', this.onKeyDown, options)
  }

  /** 释放全部监听器与定时器（宿主 dispose 时调用）。 */
  dispose(): void {
    this.unbind()
    this.clearGroupFocus()
    this.groupFocusIds.clear()
    this.resetKeepDrawerOpen()
    this.resetGesture()
  }

  /**
   * R14 — 徽章触发的定位窗口内，面板不得被折叠 / 紧凑化。
   */
  shouldKeepDrawerOpen(): boolean {
    return Date.now() < this.keepDrawerOpenUntil
  }

  markKeepDrawerOpen(): void {
    this.keepDrawerOpenUntil = Date.now() + KEEP_DRAWER_OPEN_MS
  }

  resetKeepDrawerOpen(): void {
    this.keepDrawerOpenUntil = 0
  }

  /** 清除按下的手势状态与拖拽抑制窗口。 */
  resetGesture(): void {
    this.pointerDownItem = null
    this.pointerDownButton = -1
    this.suppressClickUntil = 0
  }

  /** 结束 `+N` 临时分组聚焦（面板关闭 / Escape / 超时）。 */
  clearGroupFocus(): void {
    if (this.groupFocusTimer != null) {
      clearTimeout(this.groupFocusTimer)
      this.groupFocusTimer = null
    }
    for (const timer of this.groupFocusReapplyTimers) clearTimeout(timer)
    this.groupFocusReapplyTimers = []
    this.groupFocusIds.clear()
    // 始终清除面板行上的临时标记，避免任何残留 class/attribute。
    this.ports.clearGroupFocusPaint()
  }

  isGroupFocusActive(): boolean {
    return this.groupFocusIds.size > 0
  }

  // ── 手势 ──────────────────────────────────────────────

  private unbind(): void {
    this.listeners?.abort()
    this.listeners = null
    this.layer = null
  }

  private itemFromEvent(ev: Event): HTMLElement | null {
    const target = ev.target
    if (!(target instanceof Element)) return null
    const item = target.closest<HTMLElement>(BADGE_ITEM_SELECTOR)
    return item != null && this.layer?.contains(item) ? item : null
  }

  private readonly onPointerDown = (ev: Event): void => {
    const item = this.itemFromEvent(ev)
    if (!item) return
    const mouse = ev as MouseEvent
    // 只有主（左）键会被吞掉；右键必须保留原生菜单。
    if (typeof mouse.button === 'number' && mouse.button !== 0) return
    this.pointerDownItem = item
    this.pointerDownX = mouse.clientX ?? 0
    this.pointerDownY = mouse.clientY ?? 0
    this.pointerDownButton = mouse.button ?? 0
    // 徽章是覆盖层装饰，不是可编辑正文：永不移动光标 / 选区，也不让编辑器
    // 消费该手势（capture 阶段与编辑器自身处理器解耦）。
    ev.preventDefault()
    ev.stopPropagation()
  }

  private readonly onPointerUp = (ev: Event): void => {
    const item = this.itemFromEvent(ev)
    if (!item) return
    const mouse = ev as MouseEvent
    const downItem = this.pointerDownItem
    const downButton = this.pointerDownButton
    const moved = Math.hypot(
      (mouse.clientX ?? 0) - this.pointerDownX,
      (mouse.clientY ?? 0) - this.pointerDownY,
    )
    this.pointerDownItem = null
    this.pointerDownButton = -1
    if ((mouse.button ?? 0) !== 0 || downItem !== item || downButton !== 0 || moved > DRAG_TOLERANCE_PX) {
      // 拖拽 / 来源不一致：浏览器随后派发的合成 click 不得触发激活。
      this.suppressClickUntil = Date.now() + DRAG_SUPPRESS_CLICK_MS
      return
    }
    ev.preventDefault()
    ev.stopPropagation()
    this.activate(item)
  }

  private readonly onClick = (ev: Event): void => {
    const item = this.itemFromEvent(ev)
    if (!item) return
    const mouse = ev as MouseEvent
    if (typeof mouse.button === 'number' && mouse.button !== 0) return
    if (Date.now() < this.suppressClickUntil) {
      this.suppressClickUntil = 0
      ev.preventDefault()
      ev.stopPropagation()
      return
    }
    ev.preventDefault()
    ev.stopPropagation()
    this.activate(item)
  }

  private readonly onKeyDown = (ev: Event): void => {
    const item = this.itemFromEvent(ev)
    if (!item) return
    const key = (ev as KeyboardEvent).key
    if (key === 'Escape') {
      this.clearGroupFocus()
      item.blur()
      ev.preventDefault()
      ev.stopPropagation()
      return
    }
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      ev.preventDefault()
      ev.stopPropagation()
      this.activate(item)
    }
  }

  // ── 激活 ──────────────────────────────────────────────

  private activate(item: HTMLElement): void {
    if (this.ports.isDisposed()) return
    const marker = item.closest<HTMLElement>(MARKER_SELECTOR)
    const identity = marker?.getAttribute('data-ink-stable-identity') ?? ''
    const kind = item.getAttribute('data-ink-badge-kind') ?? 'diagnostic'
    const key = kind === 'summary'
      ? `summary:${identity}`
      : `id:${item.getAttribute('data-ink-diagnostic-id') ?? ''}`
    const now = Date.now()
    // 同一次点击会同时产生 pointerup + click：同键 450ms 内只激活一次。
    if (key === this.lastActivationKey && now - this.lastActivationAt < ACTIVATION_DEDUP_MS) return
    this.lastActivationKey = key
    this.lastActivationAt = now

    if (kind === 'summary') {
      const ids = this.headingDiagnosticIds(identity)
      if (ids.length === 0) return
      this.markKeepDrawerOpen()
      this.focusGroup(ids)
      return
    }

    const diagnosticId = item.getAttribute('data-ink-diagnostic-id') ?? ''
    if (diagnosticId === '') return
    this.markKeepDrawerOpen()
    this.clearGroupFocus()
    this.ports.openAndLocate(diagnosticId)
  }

  /** 读取该标题标记上的完整诊断 id 集合（`+N` 的真实范围）。 */
  private headingDiagnosticIds(identity: string): string[] {
    const layer = this.layer
    if (!layer || identity === '') return []
    let marker: HTMLElement | null = null
    for (const candidate of Array.from(layer.querySelectorAll<HTMLElement>(MARKER_SELECTOR))) {
      if (candidate.getAttribute('data-ink-stable-identity') === identity) { marker = candidate; break }
    }
    const chip = marker?.querySelector<HTMLElement>('.inkchapter-heading-diagnostic-reason') ?? null
    const raw = marker?.getAttribute('data-ink-diagnostic-ids') ?? chip?.getAttribute('data-ink-diagnostic-ids') ?? '[]'
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === 'string' && v !== '')
        : []
    } catch {
      return []
    }
  }

  private focusGroup(diagnosticIds: readonly string[]): void {
    this.clearGroupFocus()
    this.ports.openAndLocateFirst(diagnosticIds)
    this.groupFocusIds = new Set(diagnosticIds)
    this.ports.paintGroupFocus(this.groupFocusIds)
    // 定位事务可能异步重绘面板：在短暂窗口内重复应用，直到分组聚焦结束。
    for (const delay of GROUP_FOCUS_REAPPLY_DELAYS_MS) {
      this.groupFocusReapplyTimers.push(setTimeout(() => {
        if (this.groupFocusIds.size > 0) this.ports.paintGroupFocus(this.groupFocusIds)
      }, delay))
    }
    this.groupFocusTimer = setTimeout(() => this.clearGroupFocus(), GROUP_FOCUS_MS)
  }
}
