/**
 * 空行规则编辑期增量重算 — 脏区间与结构敏感判定（纯函数，无宿主持久状态）。
 *
 * 目的：把「编辑 → 空行诊断」从 300ms 全量语义去抖中剥离出来，由
 * {@link scanBlankDirtyRanges} 给出可定位的行区间；宿主在同一帧内只做空行专用
 * 快速重算（构造权威仍是 `buildInternalBlankLineDiagnostics`）。
 *
 * 契约：
 *   - 任一 mutation 无法映射到源码行 → `requiresFullScan = true`（不猜测）。
 *   - 任一 mutation 落在代码围栏 / 公式 / 表格 / HTML / front-matter / 列表 /
 *     引用容器内 → `requiresFullScan = true`（结构边界可能整体变化）。
 */

export interface DirtyLineRange {
  /** 0-based，包含 */
  start: number
  /** 0-based，包含 */
  end: number
}

export interface BlankDirtyScan {
  ranges: DirtyLineRange[]
  /** true = 不能安全地做局部判断，必须走全量扫描 */
  requiresFullScan: boolean
  /** 触发全量的首个原因（取证用；null = 无需全量） */
  fullScanReason: string | null
}

/** 结构敏感容器：其内部编辑可能改变块边界 / 保护区域语义。 */
export const BLANK_STRUCTURE_SENSITIVE_SELECTOR = [
  'pre.md-fences',
  '.md-math-block',
  'table',
  '.md-htmlblock',
  '.md-frontmatter',
  'ul',
  'ol',
  'blockquote',
].join(',')

function clampLine(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

function structureAncestorOf(target: Node | null): Element | null {
  const el = target == null
    ? null
    : (target.nodeType === 1 ? target as Element : target.parentElement)
  if (el == null) return null
  try {
    return el.closest(BLANK_STRUCTURE_SENSITIVE_SELECTOR)
  } catch {
    return null
  }
}

/**
 * 把一批 mutation 映射为源码行区间。
 *
 * `lineOfNode` 由宿主提供（`[data-line]` 祖先解析）；返回 null 表示无法定位。
 */
export function scanBlankDirtyRanges(
  records: readonly MutationRecord[],
  lineOfNode: (node: Node) => number | null,
): BlankDirtyScan {
  const ranges: DirtyLineRange[] = []
  let requiresFullScan = false
  let fullScanReason: string | null = null

  const flagFullScan = (reason: string): void => {
    if (requiresFullScan) return
    requiresFullScan = true
    fullScanReason = reason
  }

  for (const record of records) {
    if (structureAncestorOf(record.target) != null) {
      flagFullScan('STRUCTURE_CONTAINER')
      continue
    }
    const base = lineOfNode(record.target)
    if (base == null) {
      flagFullScan('UNMAPPED_TARGET')
      continue
    }
    // mutation 可能新增/删除节点：把当前节点行与相邻行都视为脏。
    ranges.push({ start: base, end: base })
    const next = lineOfNode(
      record.nextSibling ?? record.target,
    )
    if (next != null) ranges.push({ start: next, end: next })
  }

  return {
    ranges: mergeDirtyLineRanges(ranges),
    requiresFullScan,
    fullScanReason,
  }
}

/** 合并重叠区间并按 `padding` 向外扩张（默认 ±2 行）。 */
export function mergeDirtyLineRanges(
  ranges: readonly DirtyLineRange[],
  padding = 2,
): DirtyLineRange[] {
  if (ranges.length === 0) return []
  const pad = Math.max(0, Math.floor(padding))
  const expanded = ranges
    .map(r => ({ start: Math.max(0, Math.min(r.start, r.end) - pad), end: Math.max(r.start, r.end) + pad }))
    .sort((a, b) => a.start - b.start)
  const out: DirtyLineRange[] = []
  for (const r of expanded) {
    const last = out[out.length - 1]
    if (last != null && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end)
    } else {
      out.push({ start: r.start, end: r.end })
    }
  }
  return out
}

/** 脏区间覆盖的总行数（不含 padding 外的重复计算）。 */
export function dirtyLineCount(ranges: readonly DirtyLineRange[]): number {
  let total = 0
  for (const r of ranges) {
    const s = clampLine(r.start)
    const e = clampLine(r.end)
    if (s == null || e == null) continue
    total += Math.max(0, e - s + 1)
  }
  return total
}

/**
 * 脏区间是否超过全文占比阈值（超过则局部判断不再经济/安全）。
 */
export function exceedsDirtyRatio(
  ranges: readonly DirtyLineRange[],
  totalLineCount: number,
  ratio = 0.2,
): boolean {
  if (!Number.isFinite(totalLineCount) || totalLineCount <= 0) return true
  return dirtyLineCount(ranges) / totalLineCount > ratio
}
