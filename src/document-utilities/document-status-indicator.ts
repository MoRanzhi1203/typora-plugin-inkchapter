/**
 * V5.1 — 右上角文档状态方块（纯判定，无 DOM / 无 IO）。
 *
 * 颜色语义（优先级从高到低）：
 *   GRAY  检测关闭 / 尚未检查 / 检测中 / 结构未验证 / 无文档
 *   RED   至少一个 error
 *   YELLOW 有 warning 且无 error
 *   GREEN 检测完成且 0 error / 0 warning
 *
 * 锁定是**独立状态**：不改变检测颜色，只在外围加一圈外框。
 */

export type DocumentStatusCode = 'GREEN' | 'YELLOW' | 'RED' | 'HINT' | 'GRAY'

export interface DocumentStatusFacts {
  /** 是否有活动文档（已保存的 Markdown 才参与文档管理）。 */
  hasDocument: boolean
  /** 诊断功能是否启用。 */
  diagnosticsEnabled: boolean
  /** 是否正在检测（检测中不得显示 GREEN）。 */
  checking: boolean
  /** 快照结构是否已验证（未验证不得声称健康）。 */
  structuralVerified: boolean
  /** 是否存在有效的诊断投影。 */
  hasProjection: boolean
  errorCount: number
  warningCount: number
  hintCount: number
}

export interface DocumentStatusView {
  code: DocumentStatusCode
  color: string
  locked: boolean
  /** 非颜色提示：无障碍名称 / tooltip。 */
  label: string
  errorCount: number
  warningCount: number
  hintCount: number
}

export const DOCUMENT_STATUS_COLORS: Readonly<Record<DocumentStatusCode, string>> = {
  GREEN: '#2f986d',
  YELLOW: '#d49a26',
  RED: '#d24d57',
  HINT: '#66869f',
  GRAY: '#929aa4',
}

/**
 * 纯状态判定。优先级（与列表计数共用同一快照）：
 *   1. 无文档 / 检测关闭 / 检测中 / 无投影 → GRAY（未知）
 *   2. error > 0 → RED
 *   3. warning > 0 → YELLOW（即使结构未验证，已知警告也绝不被灰色吞掉）
 *   4. hint > 0 → HINT（提示专用色，绝不冒充警告）
 *   5. 0/0/0：结构已验证 → GREEN；未验证 → GRAY（不冒充健康）
 */
export function resolveDocumentStatusCode(facts: DocumentStatusFacts): DocumentStatusCode {
  if (!facts.hasDocument) return 'GRAY'
  if (!facts.diagnosticsEnabled) return 'GRAY'
  if (facts.checking) return 'GRAY'
  if (!facts.hasProjection) return 'GRAY'
  if (facts.errorCount > 0) return 'RED'
  if (facts.warningCount > 0) return 'YELLOW'
  if (facts.hintCount > 0) return 'HINT'
  if (!facts.structuralVerified) return 'GRAY'
  return 'GREEN'
}

const STATUS_LABELS: Readonly<Record<DocumentStatusCode, string>> = {
  GREEN: '文档检测：未发现问题',
  YELLOW: '文档检测：存在警告',
  RED: '文档检测：存在错误',
  HINT: '文档检测：存在提示',
  GRAY: '文档检测：未检查或不可用',
}

/**
 * 组合状态视图。`locked` 只影响外框与提示，**绝不**覆盖检测颜色。
 */
export function buildDocumentStatusView(
  facts: DocumentStatusFacts,
  locked: boolean,
): DocumentStatusView {
  const code = resolveDocumentStatusCode(facts)
  const base = STATUS_LABELS[code]
  const counts = code === 'GRAY'
    ? ''
    : `（错误 ${facts.errorCount} / 警告 ${facts.warningCount} / 提示 ${facts.hintCount}）`
  return {
    code,
    color: DOCUMENT_STATUS_COLORS[code],
    locked,
    label: `${base}${counts}${locked ? '；当前文档已锁定' : ''}`,
    errorCount: facts.errorCount,
    warningCount: facts.warningCount,
    hintCount: facts.hintCount,
  }
}

/** 锁定只读：只读检查、浏览资产、复制链接允许；改写 Markdown 的操作必须解锁。 */
export function canRunMarkdownWrite(locked: boolean): boolean {
  return !locked
}

/** 批量图片操作分类：上传/下载/补链不写 Markdown 时锁定不阻塞；引用改写才需要解锁。 */
export function canRunImageBatch(locked: boolean, action: 'upload' | 'download' | 'dual-link' | 'rewrite-reference'): boolean {
  if (!locked) return true
  return action !== 'rewrite-reference'
}

/** 首次启用 / 状态变化的一次性提示键（文档身份 + 配置版本 + 提示类型）。 */
export function buildNoticeKey(input: {
  documentKey: string
  configRevision: string
  referenceRevision: string
  kind: string
}): string {
  return [input.documentKey, input.configRevision, input.referenceRevision, input.kind].join('|')
}

export interface NoticeState {
  /** 已提示过的 key；同一 key 不再重复提示。 */
  seen: ReadonlySet<string>
}

export function shouldShowNotice(state: NoticeState, key: string): boolean {
  return !state.seen.has(key)
}

export function markNoticeSeen(state: NoticeState, key: string): NoticeState {
  const seen = new Set(state.seen)
  seen.add(key)
  return { seen }
}
