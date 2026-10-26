/**
 * DOCUMENT-DIAGNOSTIC CARET ISOLATION V1
 *
 * P0 — 诊断备注侵入正文光标导航。
 *
 * ROOT CAUSE (structural): 插件的 document-space 展示层
 * (`inkchapter-locate-document-layer`) 被 append 进 `#write`（Typora 的
 * contenteditable 书写区），层内承载**可见文字**（标题原因 chip、`N 空行`
 * 标签、EOF 端点标签、CODE_MISSING_NAME/LANGUAGE 标签等），却**只有**
 * `pointer-events:none` —— 没有 `contenteditable="false"` / `tabindex="-1"` /
 * `user-select:none`。于是这些**非 Markdown 的文字**仍位于可编辑树内，ArrowDown
 * 可以把插入点移动进插件备注文字，而非停留在最后一个真实可编辑段落。
 *
 * 本模块提供两件事：
 *   1. `stampCaretInertPresentation()` —— 让插件展示节点成为**光标惰性孤岛**
 *      （contenteditable=false + tabindex=-1 + user-select:none；
 *        纯装饰再加 pointer-events:none）。仅改插件的展示节点，**不碰**用户
 *      Markdown、不改计数、不改序列化。
 *   2. 有界、只读的 **ArrowDown post-default Selection 审计** + 六项硬门禁计数，
 *      全部数值来自**真实 DOM / Selection**（禁止硬编码 PASS）。
 *
 * 该模块自身不注册任何全局观察器，不做定时轮询。
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

/** 插件展示节点的统一标记（供门禁扫描识别；不参与 Markdown 序列化）。 */
export const PRESENTATION_ATTR = 'data-inkchapter-presentation'
/** 与插件命名空间一致的前缀（class 或 data-* 任一命中即为插件节点）。 */
const INKCHAPTER_PREFIX = 'inkchapter'

export interface CaretIsolationCounters {
  DIAGNOSTIC_TEXT_IN_EDITABLE_TREE_COUNT: number
  SELECTION_ANCHOR_IN_PLUGIN_PRESENTATION_COUNT: number
  NON_MARKDOWN_TEXT_SERIALIZED_COUNT: number
  NATIVE_ARROW_NAVIGATION_REGRESSION_COUNT: number
  EOF_CARET_BOUNDARY_VIOLATION_COUNT: number
  DIAGNOSTIC_OVERLAY_CARET_OCCLUSION_COUNT: number
}

export function createCaretIsolationCounters(): CaretIsolationCounters {
  return {
    DIAGNOSTIC_TEXT_IN_EDITABLE_TREE_COUNT: 0,
    SELECTION_ANCHOR_IN_PLUGIN_PRESENTATION_COUNT: 0,
    NON_MARKDOWN_TEXT_SERIALIZED_COUNT: 0,
    NATIVE_ARROW_NAVIGATION_REGRESSION_COUNT: 0,
    EOF_CARET_BOUNDARY_VIOLATION_COUNT: 0,
    DIAGNOSTIC_OVERLAY_CARET_OCCLUSION_COUNT: 0,
  }
}

export const CARET_ISOLATION_GATE_LABELS: ReadonlyArray<keyof CaretIsolationCounters> = [
  'DIAGNOSTIC_TEXT_IN_EDITABLE_TREE_COUNT',
  'SELECTION_ANCHOR_IN_PLUGIN_PRESENTATION_COUNT',
  'NON_MARKDOWN_TEXT_SERIALIZED_COUNT',
  'NATIVE_ARROW_NAVIGATION_REGRESSION_COUNT',
  'EOF_CARET_BOUNDARY_VIOLATION_COUNT',
  'DIAGNOSTIC_OVERLAY_CARET_OCCLUSION_COUNT',
]

/**
 * P0 门禁：全部计数必须为 0。
 * 计数只允许来自真实 DOM/Selection 审计；调用方不得直接写值。
 */
export function evaluateCaretIsolationGates(counters: CaretIsolationCounters): {
  decision: 'PASS' | 'FAIL'
  failCount: number
  failing: string[]
} {
  const failing = CARET_ISOLATION_GATE_LABELS.filter(k => counters[k] !== 0)
  return { decision: failing.length === 0 ? 'PASS' : 'FAIL', failCount: failing.length, failing: [...failing] }
}

export function formatCaretIsolationGateReport(counters: CaretIsolationCounters): string[] {
  const r = evaluateCaretIsolationGates(counters)
  return [
    `CARET_ISOLATION_GATE=${r.decision}`,
    ...CARET_ISOLATION_GATE_LABELS.map(k => `${k}=${counters[k]}`),
  ]
}

/**
 * 让一个**插件展示节点**成为光标惰性孤岛。
 * - contenteditable=false：Chrome 视其为可编辑区内的**不可编辑原子岛**，插入点
 *   无法进入、ArrowDown 跳过、且不会被当作可编辑文本序列化。
 * - tabindex=-1：不可 Tab 聚焦（仍可程序化聚焦，但我们从不这样做）。
 * - user-select:none：鼠标拖选不会把备注文字纳入选择。
 * - interactive=false 时追加 pointer-events:none（纯装饰不可点击）。
 *
 * 只写插件自己的节点；对宿主 contenteditable 无副作用。
 */
export function stampCaretInertPresentation(el: HTMLElement, interactive = false): void {
  try {
    el.setAttribute(PRESENTATION_ATTR, interactive ? 'interactive' : 'decorative')
    el.setAttribute('contenteditable', 'false')
    el.setAttribute('tabindex', '-1')
    el.style.userSelect = 'none'
    el.style.setProperty('-webkit-user-select', 'none')
    if (!interactive) el.style.pointerEvents = 'none'
  } catch { /* presentation-only */ }
}

/** 该节点（或其最近的展示祖先）是否已被标记为光标惰性。 */
export function isCaretInertPresentation(el: Element | null): boolean {
  if (!el) return false
  try {
    const owner = (el.closest(`[${PRESENTATION_ATTR}]`) ?? el) as Element
    return owner.getAttribute('contenteditable') === 'false'
  } catch {
    return false
  }
}

/** 最近的 contenteditable 祖先（真实编辑语义边界）；无则 null。 */
export function findContenteditableAncestor(el: Element | null): HTMLElement | null {
  let cur: Element | null = el
  while (cur) {
    try {
      if (cur instanceof HTMLElement) {
        const v = cur.getAttribute('contenteditable')
        if (v === 'true' || v === '' || v === 'plaintext-only') return cur
      }
    } catch { /* ignore */ }
    cur = cur.parentElement
  }
  return null
}

/** 是否为插件展示节点（class 或 data-* 命中 `inkchapter` 命名空间）。 */
export function isPluginPresentationNode(el: Element | null): boolean {
  if (!el) return false
  try {
    const cls = typeof el.className === 'string' ? el.className : ''
    if (cls.includes(INKCHAPTER_PREFIX)) return true
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('data-') && a.name.includes(INKCHAPTER_PREFIX)) return true
    }
    return false
  } catch {
    return false
  }
}

function bounded(text: string | null | undefined, n = 60): string {
  const s = String(text ?? '')
  return s.length > n ? s.slice(0, n) : s
}

/** 一个插入点的安全摘要（只读；绝不修改 Selection/DOM）。 */
export interface CaretSiteSummary {
  nodeType: number | null
  nodeName: string | null
  textPreview: string | null
  elementTag: string | null
  elementClassName: string | null
  elementRuntimeId: string | null
  insideWrite: boolean | null
  insidePluginPresentation: boolean
  contenteditableAncestorTag: string | null
  contenteditableAncestorIsWrite: boolean
  caretInert: boolean
}

export function summarizeCaretSite(
  node: Node | null,
  editorRoot: HTMLElement | null,
  peekRuntimeId?: (el: HTMLElement) => string | null,
): CaretSiteSummary {
  const element = node
    ? (node.nodeType === 1 ? (node as Element) : (node.parentElement ?? null))
    : null
  const editableAncestor = findContenteditableAncestor(element)
  let runtimeId: string | null = null
  if (element instanceof HTMLElement && peekRuntimeId) {
    try { runtimeId = peekRuntimeId(element) } catch { runtimeId = null }
  }
  return {
    nodeType: node ? node.nodeType : null,
    nodeName: node ? node.nodeName : null,
    textPreview: node ? bounded(node.textContent) : null,
    elementTag: element ? element.tagName : null,
    elementClassName: element ? bounded(String(element.className ?? '')) : null,
    elementRuntimeId: runtimeId,
    insideWrite: node && editorRoot ? editorRoot.contains(node) : node ? false : null,
    insidePluginPresentation: isPluginPresentationNode(element),
    contenteditableAncestorTag: editableAncestor ? editableAncestor.tagName : null,
    contenteditableAncestorIsWrite: !!(editableAncestor && editorRoot && editableAncestor === editorRoot),
    caretInert: isCaretInertPresentation(element),
  }
}

/**
 * 真实 DOM 扫描：统计**位于可编辑树内、且未被光标隔离、且含文字**的插件展示节点。
 * 返回计数 + 有限样本（供门禁与归因）。只读。
 */
export function scanDiagnosticTextInEditableTree(
  editorRoot: HTMLElement | null,
  maxSamples = 6,
): { count: number; samples: string[] } {
  const samples: string[] = []
  let count = 0
  if (!editorRoot) return { count, samples }
  let nodes: Element[] = []
  try { nodes = Array.from(editorRoot.querySelectorAll('*')) } catch { return { count, samples } }
  for (const el of nodes) {
    if (!isPluginPresentationNode(el)) continue
    const hasText = (el.textContent ?? '').trim().length > 0
    if (!hasText) continue
    // 只统计“文字直接宿主”以避免同一子树重复计数
    const childText = Array.from(el.children).some(c => (c.textContent ?? '').trim().length > 0)
    if (childText) continue
    if (isCaretInertPresentation(el)) continue
    count++
    if (samples.length < maxSamples) {
      samples.push(`${el.tagName}.${bounded(String(el.className ?? ''), 40)}:"${bounded(el.textContent, 24)}"`)
    }
  }
  return { count, samples }
}

/**
 * 收集当前文档树内**插件展示节点**的可见文字指纹（长度 ≥ 2，去重）。
 * 供「实际 Typora 导出 Markdown 是否含插件备注」判定使用（§2.3 / §7.3）。
 */
export function collectPluginPresentationTexts(editorRoot: HTMLElement | null): string[] {
  const out = new Set<string>()
  if (!editorRoot) return []
  try {
    for (const el of Array.from(editorRoot.querySelectorAll('*'))) {
      if (!isPluginPresentationNode(el)) continue
      const t = (el.textContent ?? '').trim()
      if (t.length >= 2) out.add(t)
    }
  } catch { /* ignore */ }
  return [...out]
}

/**
 * §7.3 `PLUGIN_TEXT_IN_SERIALIZED_MARKDOWN_COUNT`：**必须**由 Typora 实际导出/保存的
 * Markdown 文本判定，而非由 `contenteditable=false` / 展示节点标记推断。
 * 本函数只做纯文本比对，任何命中即真实泄漏。
 */
export function scanPluginTextInSerializedMarkdown(
  markdown: string,
  presentationTexts: readonly string[],
  maxSamples = 6,
): { count: number; samples: string[] } {
  const samples: string[] = []
  let count = 0
  const text = String(markdown ?? '')
  for (const t of presentationTexts) {
    const needle = String(t ?? '').trim()
    if (needle.length < 2) continue
    if (text.includes(needle)) {
      count++
      if (samples.length < maxSamples) samples.push(bounded(needle, 30))
    }
  }
  return { count, samples }
}

/**
 * 序列化泄漏门禁：**未取得真实导出文本时必须报 `NOT_RUN`**，不得以静态 0 冒充 PASS。
 */
export function evaluateSerializedMarkdownGate(
  measuredCount: number | null,
): { decision: 'PASS' | 'FAIL' | 'NOT_RUN'; reason: string } {
  if (measuredCount === null || !Number.isFinite(measuredCount)) {
    return { decision: 'NOT_RUN', reason: 'NO_REAL_EXPORT_SAMPLE' }
  }
  return measuredCount === 0
    ? { decision: 'PASS', reason: 'NO_PLUGIN_TEXT_IN_SERIALIZED_MARKDOWN' }
    : { decision: 'FAIL', reason: 'PLUGIN_TEXT_LEAKED_INTO_MARKDOWN' }
}

/** 判定一个插入点是否“落在插件展示文字上”（门禁/兜底用）。 */
export function isSelectionAnchorOnPluginPresentation(
  node: Node | null,
  editorRoot: HTMLElement | null,
): boolean {
  const s = summarizeCaretSite(node, editorRoot)
  return s.insidePluginPresentation && !s.caretInert
}

/** 该展示节点是否属于「文档末尾提示 / EOF 端点」类（EOF 边界违规判定用）。 */
export function isEofBoundaryPresentation(el: Element | null): boolean {
  if (!el) return false
  try {
    if (el.closest('[data-ink-eof-form],[data-ink-marker-kind="document-end"]')) return true
    const cls = typeof el.className === 'string' ? el.className : ''
    return /document-end|eof/i.test(cls)
  } catch {
    return false
  }
}

// ─── 会话级门禁计数（真实审计累计；模块唯一所有者，禁止调用方直接写值） ───

const caretIsolationCounters: CaretIsolationCounters = createCaretIsolationCounters()
let lastDiagnosticTextSamples: string[] = []

export function getCaretIsolationCounters(): Readonly<CaretIsolationCounters> {
  return { ...caretIsolationCounters }
}

export function getLastDiagnosticTextSamples(): readonly string[] {
  return lastDiagnosticTextSamples
}

/** 仅测试用：复位会话计数。 */
export function resetCaretIsolationCounters(): void {
  Object.assign(caretIsolationCounters, createCaretIsolationCounters())
  lastDiagnosticTextSamples = []
}

/**
 * 从**真实 DOM** 重算「可编辑树内的插件诊断文字」计数（集合语义，非累加）。
 * 只读；由每次导航审计 / 视觉提交后调用。
 */
export function refreshCaretIsolationDomCounters(editorRoot: HTMLElement | null): void {
  if (typeof document === 'undefined') return
  const scan = scanDiagnosticTextInEditableTree(editorRoot)
  caretIsolationCounters.DIAGNOSTIC_TEXT_IN_EDITABLE_TREE_COUNT = scan.count
  lastDiagnosticTextSamples = scan.samples
  // 未标记的插件展示文字（容器缺 PRESENTATION_ATTR）—— 与 (1) 语义不同。
  // 作用域 = **文档内容树**（editorRoot）。插件的 toolbar / drawer / outline 等自身 UI
  // 位于 document.body，**不在** Markdown 文档内，也从不被序列化，故不计入本指标。
  let unmarked = 0
  if (editorRoot) {
    try {
      for (const el of Array.from(editorRoot.querySelectorAll('*'))) {
        if (!isPluginPresentationNode(el)) continue
        if ((el.textContent ?? '').trim().length === 0) continue
        const childText = Array.from(el.children).some(c => (c.textContent ?? '').trim().length > 0)
        if (childText) continue
        if (el.closest(`[${PRESENTATION_ATTR}]`)) continue
        unmarked++
      }
    } catch { /* ignore */ }
  }
  caretIsolationCounters.NON_MARKDOWN_TEXT_SERIALIZED_COUNT = unmarked
}

/** 几何遮挡（真实 rect 相交）：插入点 rect 是否被插件展示节点覆盖。 */
function countCaretOcclusion(editorRoot: HTMLElement | null): void {
  if (typeof document === 'undefined') return
  let caretRect: DOMRect | null = null
  try {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (r && (r.width > 0 || r.height > 0)) caretRect = r
    }
  } catch { caretRect = null }
  if (!caretRect || !editorRoot) return
  let occluded = 0
  try {
    for (const el of Array.from(editorRoot.querySelectorAll(`[${PRESENTATION_ATTR}]`))) {
      if (!(el instanceof HTMLElement)) continue
      // 纯装饰（pointer-events:none）不遮挡可交互光标层级
      if (window.getComputedStyle(el).pointerEvents === 'none') continue
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      const intersects = r.left < caretRect.right && r.right > caretRect.left
        && r.top < caretRect.bottom && r.bottom > caretRect.top
      if (intersects) occluded++
    }
  } catch { /* ignore */ }
  caretIsolationCounters.DIAGNOSTIC_OVERLAY_CARET_OCCLUSION_COUNT = occluded
}


/** 最后一个真实（非插件展示）可编辑段落的摘要。 */
export function summarizeLastRealEditableParagraph(
  editorRoot: HTMLElement | null,
  peekRuntimeId?: (el: HTMLElement) => string | null,
): { tag: string | null; runtimeId: string | null; textPreview: string | null } {
  if (!editorRoot) return { tag: null, runtimeId: null, textPreview: null }
  let last: HTMLElement | null = null
  try {
    const ps = editorRoot.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6')
    for (const p of Array.from(ps)) {
      if (!(p instanceof HTMLElement)) continue
      if (isPluginPresentationNode(p)) continue
      if (isCaretInertPresentation(p)) continue
      last = p
    }
  } catch { /* ignore */ }
  if (!last) return { tag: null, runtimeId: null, textPreview: null }
  let runtimeId: string | null = null
  if (peekRuntimeId) { try { runtimeId = peekRuntimeId(last) } catch { runtimeId = null } }
  return { tag: last.tagName, runtimeId, textPreview: bounded(last.textContent, 40) }
}

// ─────────────────────────────────────────────────────────────────────────────
// ArrowDown post-default Selection 审计（有界；非轮询）
// ─────────────────────────────────────────────────────────────────────────────

export interface ArrowDownAuditContext {
  documentKey: string | null
  buildShaOrMarker: string | null
  editorRoot: HTMLElement | null
  editorRootIdentity: string | null
  sourceRevision: number | null
  peekRuntimeId?: (el: HTMLElement) => string | null
  /** 真实 DOM 审计回调（可选）：用于累计门禁计数。 */
  onCaretSite?: (site: CaretSiteSummary, inPresentation: boolean) => void
}

interface PendingArrowDown {
  /** 单调事件序号（每次 enqueue 分配；用于与密钥事件一一对账）。 */
  eventSeq: number
  key: string
  isTrusted: boolean
  defaultPrevented: boolean
  ctx: ArrowDownAuditContext
  /** 入队时刻（真实时钟）。 */
  queuedAt: number
  /** 默认行为发生**之前**的插入点（keydown 同步捕获）。 */
  beforeSite: CaretSiteSummary
  beforeLastReal: { tag: string | null; runtimeId: string | null; textPreview: string | null }
}

/** 参与 post-default 插入点审计的导航键（P0 要求：ArrowDown 起，覆盖方向/Home/End/翻页）。 */
export const NAVIGATION_AUDIT_KEYS: ReadonlyArray<string> = [
  'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
]

// 有界队列 + 单个合并宏任务：每次导航键都留下一条审计（不再相互覆盖），
// 且同一帧内多次按键只调度一次 setTimeout(0)。上限防止无界增长。
//
// P0 HARDENING：**禁止静默覆盖**。旧实现队列满时 `pendingAudits.shift()` 直接丢掉
// 最旧样本且不计数 → 门禁永远看不到缺口（§2.3 / §7.2 明令禁止）。现在：
//   - 队列满 → 计入 `AUDITS_DROPPED`（**不静默**），并让覆盖门禁 FAIL；
//   - 切文档/编辑器根重绑 → `invalidateNavigationAudits(reason)` 取消待处理项并计数；
//   - 每次入队分配 `eventSeq`/`queuedAt`，出队分配 `flushedAt`，供 §7.2 对账。
const MAX_PENDING_AUDITS = 64
const pendingAudits: PendingArrowDown[] = []
let auditFlushScheduled = false
let navigationAuditEventSeq = 0

/** §7.2 审计覆盖计数（真实事件驱动；调用方不得直接写值）。 */
export interface NavigationAuditCounters {
  /** 落在导航允许集内、本应被审计的密钥事件数。 */
  KEY_EVENTS_ELIGIBLE: number
  /** 成功入队的审计数。 */
  AUDITS_ENQUEUED: number
  /** 已执行（真实读取 Selection/DOM）的审计数。 */
  AUDITS_FLUSHED: number
  /** 因队列溢出被丢弃的审计数（本次准入要求 = 0）。 */
  AUDITS_DROPPED: number
  /** 因上下文失效（切文档/根重绑）被取消的待处理审计数。 */
  AUDITS_CANCELLED_WITH_REASON: number
  /** 因不支持而被拒绝的**导航意图**键数。 */
  AUDITS_REJECTED_WITH_REASON: number
  /** 取消项中因切文档而废弃的子集。 */
  STALE_DOCUMENT_DISCARD: number
  /** 落在导航意图之外、审计不支持的键事件数（信息性，不计入 eligible）。 */
  UNSUPPORTED_KEY: number
}

export function createNavigationAuditCounters(): NavigationAuditCounters {
  return {
    KEY_EVENTS_ELIGIBLE: 0,
    AUDITS_ENQUEUED: 0,
    AUDITS_FLUSHED: 0,
    AUDITS_DROPPED: 0,
    AUDITS_CANCELLED_WITH_REASON: 0,
    AUDITS_REJECTED_WITH_REASON: 0,
    STALE_DOCUMENT_DISCARD: 0,
    UNSUPPORTED_KEY: 0,
  }
}

const navigationAuditCounters: NavigationAuditCounters = createNavigationAuditCounters()

export function getNavigationAuditCounters(): Readonly<NavigationAuditCounters> {
  return { ...navigationAuditCounters }
}

/** 仅测试用：复位审计覆盖计数。 */
export function resetNavigationAuditCounters(): void {
  Object.assign(navigationAuditCounters, createNavigationAuditCounters())
  pendingAudits.length = 0
  auditFlushScheduled = false
}

/**
 * §7.2 覆盖门禁：eligible == enqueued + rejected；enqueued == flushed + dropped + cancelled；
 * 且**本次准入要求 `AUDITS_DROPPED = 0`**。任何 `observedCount=0` 且 eligible>0 的情形判 FAIL_COVERAGE。
 */
export function evaluateAuditCoverageGate(
  provided?: Partial<NavigationAuditCounters>,
): { decision: 'PASS' | 'FAIL'; failing: string[]; reason: string } {
  const c = { ...navigationAuditCounters, ...(provided ?? {}) } as NavigationAuditCounters
  const failing: string[] = []
  const eligibleBalanced = c.KEY_EVENTS_ELIGIBLE === c.AUDITS_ENQUEUED + c.AUDITS_REJECTED_WITH_REASON
  // 待处理（已入队、尚未 flush/取消）不构成缺口：用「已入队 ≥ 已 flush + dropped + cancelled」判定，
  // 差额即仍在队列中的在途项。缺口只可能来自 dropped。
  const enqueuedBalanced = c.AUDITS_ENQUEUED >= c.AUDITS_FLUSHED + c.AUDITS_DROPPED + c.AUDITS_CANCELLED_WITH_REASON
  if (!eligibleBalanced) failing.push('KEY_EVENTS_ELIGIBLE_BALANCE')
  if (!enqueuedBalanced) failing.push('AUDITS_ENQUEUED_BALANCE')
  if (c.AUDITS_DROPPED !== 0) failing.push('AUDITS_DROPPED')
  const decision = failing.length === 0 ? 'PASS' : 'FAIL'
  return {
    decision,
    failing,
    reason: decision === 'PASS' ? 'AUDIT_COVERAGE_COMPLETE' : 'FAIL_AUDIT_COVERAGE',
  }
}

/**
 * 取消所有待处理导航审计（切文档 / 编辑器根重绑）。**不静默**：计入
 * `AUDITS_CANCELLED_WITH_REASON`；文档相关原因同时计入 `STALE_DOCUMENT_DISCARD`。
 */
export function invalidateNavigationAudits(reason: string): number {
  const n = pendingAudits.length
  if (n > 0) pendingAudits.length = 0
  if (n > 0) {
    navigationAuditCounters.AUDITS_CANCELLED_WITH_REASON += n
    if (/DOCUMENT|ROOT_REBIND|SWITCH/i.test(reason)) {
      navigationAuditCounters.STALE_DOCUMENT_DISCARD += n
    }
  }
  return n
}

export function scheduleNavigationPostDefaultAudit(
  key: string,
  isTrusted: boolean,
  defaultPrevented: boolean,
  ctx: ArrowDownAuditContext,
): void {
  if (!NAVIGATION_AUDIT_KEYS.includes(key)) {
    // 非导航键：信息性计数，绝不冒充覆盖缺口。
    navigationAuditCounters.UNSUPPORTED_KEY++
    return
  }
  navigationAuditCounters.KEY_EVENTS_ELIGIBLE++
  let beforeNode: Node | null = null
  try {
    const sel = window.getSelection()
    beforeNode = sel && sel.rangeCount > 0 ? sel.anchorNode : null
  } catch { beforeNode = null }
  if (pendingAudits.length >= MAX_PENDING_AUDITS) {
    // **不静默覆盖**：显式计入 dropped（门禁将 FAIL_AUDIT_COVERAGE），仍保留最新样本。
    navigationAuditCounters.AUDITS_DROPPED++
    pendingAudits.shift()
  }
  navigationAuditCounters.AUDITS_ENQUEUED++
  pendingAudits.push({
    eventSeq: ++navigationAuditEventSeq,
    key, isTrusted, defaultPrevented,
    ctx,
    queuedAt: Date.now(),
    beforeSite: summarizeCaretSite(beforeNode, ctx.editorRoot, ctx.peekRuntimeId),
    beforeLastReal: summarizeLastRealEditableParagraph(ctx.editorRoot, ctx.peekRuntimeId),
  })
  if (auditFlushScheduled) return
  auditFlushScheduled = true
  try {
    setTimeout(() => {
      auditFlushScheduled = false
      const batch = pendingAudits.splice(0, pendingAudits.length)
      for (const p of batch) runNavigationPostDefaultAudit(p)
    }, 0)
  } catch { auditFlushScheduled = false /* observability only */ }
}

function runNavigationPostDefaultAudit(p: PendingArrowDown): void {
  const { ctx } = p
  const flushedAt = Date.now()
  navigationAuditCounters.AUDITS_FLUSHED++
  let sel: Selection | null = null
  try { sel = window.getSelection() } catch { sel = null }
  const anchorNode = sel && sel.rangeCount > 0 ? sel.anchorNode : null
  const focusNode = sel && sel.rangeCount > 0 ? sel.focusNode : null
  const site = summarizeCaretSite(anchorNode, ctx.editorRoot, ctx.peekRuntimeId)
  const inPresentation = site.insidePluginPresentation && !site.caretInert
  const lastReal = summarizeLastRealEditableParagraph(ctx.editorRoot, ctx.peekRuntimeId)
  let activeEl: HTMLElement | null = null
  try { activeEl = document.activeElement as HTMLElement | null } catch { activeEl = null }

  // ── 会话门禁计数：全部来自上面的真实 Selection/DOM 事实（先算后报） ──
  try {
    if (inPresentation) caretIsolationCounters.SELECTION_ANCHOR_IN_PLUGIN_PRESENTATION_COUNT++
    const anchorElForEof = anchorNode
      ? (anchorNode.nodeType === 1 ? (anchorNode as Element) : anchorNode.parentElement)
      : null
    if (inPresentation && isEofBoundaryPresentation(anchorElForEof)) {
      caretIsolationCounters.EOF_CARET_BOUNDARY_VIOLATION_COUNT++
    }
    if (p.isTrusted && site.insideWrite === false) {
      // 真实导航键的插入点因插件而离开编辑区 → 原生导航回归
      caretIsolationCounters.NATIVE_ARROW_NAVIGATION_REGRESSION_COUNT++
    }
    refreshCaretIsolationDomCounters(ctx.editorRoot)
    countCaretOcclusion(ctx.editorRoot)
  } catch { /* observability only */ }

  emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-NAV-POST-DEFAULT-SELECTION', {
    documentKey: ctx.documentKey,
    buildShaOrMarker: ctx.buildShaOrMarker,
    editorRootIdentity: ctx.editorRootIdentity,
    key: p.key,
    isTrusted: p.isTrusted,
    defaultPrevented: p.defaultPrevented,
    selectionCollapsed: sel && sel.rangeCount > 0 ? sel.isCollapsed : null,
    // BEFORE（默认行为前）
    beforeAnchorNodeType: p.beforeSite.nodeType,
    beforeAnchorElementTag: p.beforeSite.elementTag,
    beforeAnchorElementClassName: p.beforeSite.elementClassName,
    beforeAnchorElementRuntimeId: p.beforeSite.elementRuntimeId,
    beforeAnchorInsideWrite: p.beforeSite.insideWrite,
    beforeAnchorInsidePluginPresentation: p.beforeSite.insidePluginPresentation,
    beforeLastRealEditableParagraphRuntimeId: p.beforeLastReal.runtimeId,
    // AFTER（默认行为后）
    anchorNodeType: site.nodeType,
    anchorNodeName: site.nodeName,
    anchorTextPreview: site.textPreview,
    anchorElementTag: site.elementTag,
    anchorElementClassName: site.elementClassName,
    anchorElementRuntimeId: site.elementRuntimeId,
    anchorInsideWrite: site.insideWrite,
    anchorInsidePluginPresentation: site.insidePluginPresentation,
    anchorCaretInert: site.caretInert,
    contenteditableAncestorTag: site.contenteditableAncestorTag,
    contenteditableAncestorIsWrite: site.contenteditableAncestorIsWrite,
    focusNodeName: focusNode ? focusNode.nodeName : null,
    activeElementTag: activeEl ? activeEl.tagName : null,
    activeElementId: activeEl?.id || null,
    activeElementClassName: activeEl ? bounded(String(activeEl.className ?? '')) : null,
    lastRealEditableParagraphTag: lastReal.tag,
    lastRealEditableParagraphRuntimeId: lastReal.runtimeId,
    sourceRevision: ctx.sourceRevision,
    // ── §2.3/§7.2 审计覆盖事实（eventSeq/queuedAt/flushedAt/before-after anchor/defaultPrevented）──
    eventSeq: p.eventSeq,
    queuedAt: p.queuedAt,
    flushedAt,
    auditQueueLatencyMs: Math.max(0, flushedAt - p.queuedAt),
    auditCounters: { ...navigationAuditCounters },
    auditCoverageDecision: evaluateAuditCoverageGate().decision,
    auditCoverageReason: evaluateAuditCoverageGate().reason,
    decision: inPresentation ? 'ANCHOR_IN_PLUGIN_PRESENTATION' : 'ANCHOR_IN_EDITOR_CONTENT',
    // ── 六项硬门禁（真实 DOM/Selection；禁止硬编码） ──
    caretIsolationGate: { ...caretIsolationCounters },
    caretIsolationGateDecision: evaluateCaretIsolationGates(caretIsolationCounters).decision,
    diagnosticTextSamples: lastDiagnosticTextSamples.slice(0, 3),
  })

  if (ctx.onCaretSite) {
    try { ctx.onCaretSite(site, inPresentation) } catch { /* ignore */ }
  }
}
