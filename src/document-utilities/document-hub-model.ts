/**
 * V5.1 — 统一「墨章文档管理中心」数据模型（纯函数）。
 *
 * 一个面板同时呈现：检测摘要、锁定状态、当前文档图片策略与批量图片入口。
 * 数据模型不读 DOM / 不读盘；调用方把真实快照传进来。
 */

import type { DocumentStatusView } from './document-status-indicator'

export type ImageScopeSource = 'global' | 'folder' | 'document'

export interface DocumentHubImageSummary {
  enabled: boolean
  referenceCount: number
  localCount: number
  remoteCount: number
  reuseLocalCount: number
  reuseRemoteCount: number
  pendingUploadCount: number
  pendingDownloadCount: number
  /** 预检确认的本地缺失资源数（缺失不等于可上传）。 */
  missingLocalCount?: number
  dualLinkCompleteCount: number
  policyText: string
  scopeSource: ImageScopeSource
  scopeLabel: string
  projectDirectory: string | null
  /** 当前生效的 Typora 原生插入方式（只读展示）。 */
  insertionModeText?: string
  /** 自动同步状态（自动上传 / 自动本地化）。 */
  autoSyncText?: string
}

/** 检测面板的视图排序模式（只影响呈现，不改变诊断身份/计数）。 */
export type DiagnosticSortMode = 'document' | 'document-desc' | 'severity' | 'rule'

export const DIAGNOSTIC_SORT_MODES: readonly { id: DiagnosticSortMode; label: string }[] = [
  { id: 'document', label: '文档顺序' },
  { id: 'document-desc', label: '文档倒序' },
  { id: 'severity', label: '严重程度' },
  { id: 'rule', label: '规则类型' },
]

/** 行内修复入口的能力描述（来自真实修复能力矩阵）。 */
export interface DocumentHubFixAction {
  capability: 'AUTO_SAFE' | 'EXPLICIT_ONLY' | 'USER_INPUT_REQUIRED' | 'MANUAL_ONLY' | 'UNAVAILABLE'
  label: string
  requiresInput?: { field: 'name' | 'language'; label: string; placeholder?: string }
}

/** 检测标签列表的一行（来自真实诊断快照 + 既有文案/排序权威）。 */
export interface DocumentHubDiagnosticItem {
  id: string
  severity: 'error' | 'warning' | 'hint' | 'info'
  /** 规范化单行标题（resolveDiagnosticCopy.title）。 */
  title: string
  /** 可选一行说明（resolveDiagnosticCopy.description）。 */
  detail?: string
  /** 文档位置行号（1 基；未知为 null）。 */
  line: number | null
  /** 规则 ID（同类修复的分组键）。 */
  ruleId?: string
  /** 目标组/多目标语义（保留既有投影规则）。 */
  targetIndex?: number
  targetCount?: number
  /** 行内修复能力；缺省/ UNAVAILABLE 时不渲染空按钮。 */
  fix?: DocumentHubFixAction
}

export interface DocumentHubModelInput {
  documentPath: string | null
  saved: boolean
  status: DocumentStatusView
  locked: boolean
  image: DocumentHubImageSummary | null
  /** 检测功能是否可用（诊断服务就绪）。 */
  diagnosticsAvailable: boolean
  /** 当前文档诊断列表（详情视图；缺省为空）。 */
  diagnostics?: readonly DocumentHubDiagnosticItem[]
  /** 当前快照中可安全自动修复的诊断数（实时计划结果）。 */
  autoFixableCount?: number
  /** 是否正在应用修复（禁用重复提交）。 */
  fixBusy?: boolean
}

export interface DocumentHubActionAvailability {
  recheck: boolean
  toggleLock: boolean
  openDiagnostics: boolean
  uploadAll: boolean
  downloadAll: boolean
  dualLink: boolean
  openImageSettings: boolean
}

export interface DocumentHubModel {
  documentPath: string | null
  documentName: string
  saved: boolean
  status: DocumentStatusView
  locked: boolean
  image: DocumentHubImageSummary | null
  actions: DocumentHubActionAvailability
  /** 顶部一句摘要。 */
  headline: string
  /** 检测标签详情视图的数据源（真实诊断快照）。 */
  diagnostics: readonly DocumentHubDiagnosticItem[]
  /**
   * B1 §B1-03 — number of VISIBLE ROWS (multi-target expands to N rows). This is
   * deliberately separate from `status.warningCount` / `errorCount` / `hintCount`,
   * which count normalized diagnostic EVENTS. A multi-target warning is ONE
   * warning event but N clickable rows.
   */
  rowCount: number
  /** 可安全自动修复的诊断数（0 ⇒ 不出现“一键修复”按钮）。 */
  autoFixableCount: number
  fixBusy: boolean
}

export function buildDocumentHubModel(input: DocumentHubModelInput): DocumentHubModel {
  const hasDocument = input.documentPath != null && input.documentPath !== ''
  const documentName = hasDocument
    ? input.documentPath!.split(/[\\/]/).pop() ?? input.documentPath!
    : '未保存文档'
  const imageEnabled = input.image?.enabled === true
  const canReadImages = imageEnabled && hasDocument
  return {
    documentPath: input.documentPath,
    documentName,
    saved: input.saved,
    status: input.status,
    locked: input.locked,
    image: input.image,
    actions: {
      recheck: input.diagnosticsAvailable,
      toggleLock: hasDocument,
      openDiagnostics: hasDocument,
      uploadAll: canReadImages && !input.locked && (input.image?.pendingUploadCount ?? 0) > 0,
      downloadAll: canReadImages && (input.image?.pendingDownloadCount ?? 0) > 0,
      dualLink: canReadImages && (input.image?.referenceCount ?? 0) > 0,
      openImageSettings: true,
    },
    headline: input.status.label,
    diagnostics: input.diagnostics ?? [],
    rowCount: input.diagnostics?.length ?? 0,
    autoFixableCount: Math.max(0, input.autoFixableCount ?? 0),
    fixBusy: input.fixBusy === true,
  }
}

const SEVERITY_RANK: Readonly<Record<DocumentHubDiagnosticItem['severity'], number>> = {
  error: 0,
  warning: 1,
  hint: 2,
  info: 3,
}

/**
 * VIEW-ONLY sort. `document` keeps the host's authoritative source-position
 * order untouched; `severity` / `rule` are STABLE secondary views over the same
 * array, so equal keys keep document order and counts never change.
 */
export function sortDiagnosticItems(
  items: readonly DocumentHubDiagnosticItem[],
  mode: DiagnosticSortMode,
): DocumentHubDiagnosticItem[] {
  if (mode === 'document') return [...items]
  // Reverse-document is the same stable view, reversed AFTER the source-order
  // list is established (never a different comparator).
  if (mode === 'document-desc') return [...items].reverse()
  const decorated = items.map((item, index) => ({ item, index }))
  decorated.sort((a, b) => {
    if (mode === 'severity') {
      const rank = SEVERITY_RANK[a.item.severity] - SEVERITY_RANK[b.item.severity]
      if (rank !== 0) return rank
    } else {
      const ra = a.item.ruleId ?? ''
      const rb = b.item.ruleId ?? ''
      if (ra !== rb) return ra < rb ? -1 : 1
    }
    return a.index - b.index
  })
  return decorated.map(entry => entry.item)
}

/** Severity filter is a pure view predicate (never reorders the survivors). */
export function filterDiagnosticItems(
  items: readonly DocumentHubDiagnosticItem[],
  filter: 'all' | 'error' | 'warning' | 'info',
): DocumentHubDiagnosticItem[] {
  if (filter === 'all') return [...items]
  if (filter === 'info') return items.filter(item => item.severity === 'info' || item.severity === 'hint')
  return items.filter(item => item.severity === filter)
}

/** 批量操作按钮的禁用原因（用于 tooltip，避免“按钮灰了但不知道为什么”）。 */
export function explainBatchActionDisabled(
  action: 'uploadAll' | 'downloadAll' | 'dualLink',
  model: DocumentHubModel,
): string | null {
  if (!model.image || !model.image.enabled) return '图片管理未启用'
  if (!model.documentPath) return '当前文档尚未保存'
  if (action === 'uploadAll' && model.locked) return '文档已锁定：上传会改写引用，请先解锁'
  if (action === 'uploadAll' && model.image.pendingUploadCount === 0) return '没有待上传的本地图片'
  if (action === 'downloadAll' && model.image.pendingDownloadCount === 0) return '没有待下载的远程图片'
  if (action === 'dualLink' && model.image.referenceCount === 0) return '当前文档没有图片引用'
  return null
}
