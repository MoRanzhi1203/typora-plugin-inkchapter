/**
 * R08 — Heading number conflict detection.
 *
 * Reuses the EXISTING diagnostic semantics (`HEADING_MANUAL_NUMBER_PREFIX`,
 * `HEADING_AUTO_NUMBER_CONFLICT`) and adds only the rules the persistence layer
 * needs. Each issue carries the exact 1-based source line (Lxx) and a fix kind
 * that maps to a real command, so the panel never offers a repair that does not
 * exist.
 *
 * Pure contract: consumes one persistence plan, no DOM, no host state.
 */

import {
  canonicalNumberLabel,
  isRewritableHeadingNumber,
} from './heading-number-source-scanner'
import type {
  HeadingNumberPersistencePlan,
  HeadingNumberStorageMode,
  PlannedHeadingNumber,
} from './heading-number-persistence'

export const NUMBERING_CONFLICT_CODES = {
  /** Existing manual prefix while automated numbering is active (legacy rule). */
  manualNumberPrefix: 'HEADING_MANUAL_NUMBER_PREFIX',
  /** Auto number rendered on top of a manual prefix (legacy rule). */
  autoNumberConflict: 'HEADING_AUTO_NUMBER_CONFLICT',
  doubleNumberPrefix: 'HEADING_DOUBLE_NUMBER_PREFIX',
  numberMismatch: 'HEADING_NUMBER_MISMATCH',
  numberMissing: 'HEADING_NUMBER_MISSING',
  numberOrderAnomaly: 'HEADING_NUMBER_ORDER_ANOMALY',
  numberFormatInconsistent: 'HEADING_NUMBER_FORMAT_INCONSISTENT',
  numberOwnershipConflict: 'HEADING_NUMBER_OWNERSHIP_CONFLICT',
} as const

export type NumberingConflictCode =
  typeof NUMBERING_CONFLICT_CODES[keyof typeof NUMBERING_CONFLICT_CODES]

export type NumberingConflictFix =
  | 'adopt'
  | 'remove-duplicate'
  | 'renumber'
  | 'write'
  | 'preserve'
  | 'none'

export type NumberingConflictSeverity = 'error' | 'warning' | 'info'

export interface NumberingConflictIssue {
  code: NumberingConflictCode
  severity: NumberingConflictSeverity
  /** 1-based line in the Markdown source. */
  line: number
  identity: string
  level: number
  message: string
  fix: NumberingConflictFix
}

export interface NumberingConflictReport {
  issues: NumberingConflictIssue[]
  errorCount: number
  warningCount: number
  hasConflict: boolean
  /** The line number rendered in the panel: always `L<line>`. */
  formatLine(line: number): string
}

export interface NumberingConflictOptions {
  numberingEnabled: boolean
  storageMode: HeadingNumberStorageMode
  policy: string
}

export function checkNumberingConflicts(
  plan: HeadingNumberPersistencePlan,
  options: NumberingConflictOptions,
): NumberingConflictReport {
  const issues: NumberingConflictIssue[] = []
  const add = (
    code: NumberingConflictCode,
    severity: NumberingConflictSeverity,
    heading: PlannedHeadingNumber,
    message: string,
    fix: NumberingConflictFix,
  ) => {
    issues.push({
      code,
      severity,
      line: heading.line,
      identity: heading.identity,
      level: heading.level,
      message,
      fix,
    })
  }

  const seenExpected = new Set<string>()
  const seenDetected = new Set<string>()
  const formatCounts = new Map<string, number>()

  for (const heading of plan.headings) {
    const detected = heading.detected
    const label = heading.label
    const writable = isRewritableHeadingNumber(detected)

    if (heading.extra.length > 0) {
      add(
        NUMBERING_CONFLICT_CODES.doubleNumberPrefix,
        'error',
        heading,
        `标题出现双重编号：${detected?.numberText ?? ''} ${heading.extra.map(e => e.numberText).join(' ')}`,
        'remove-duplicate',
      )
    }

    if (detected && writable) {
      const family = numberFormatFamily(detected.format)
      formatCounts.set(family, (formatCounts.get(family) ?? 0) + 1)
    }

    if (label !== '' && detected && writable && !detected.matchesExpected) {
      add(
        NUMBERING_CONFLICT_CODES.numberMismatch,
        options.storageMode === 'source' ? 'error' : 'warning',
        heading,
        `源码编号“${detected.numberText}”与当前方案计算结果“${label}”不一致`,
        'renumber',
      )
    }

    if (options.numberingEnabled && label !== '' && detected && options.storageMode === 'render') {
      add(
        NUMBERING_CONFLICT_CODES.autoNumberConflict,
        'error',
        heading,
        `自动编号“${label}”已生效，源码中仍有手工编号“${detected.numberText}”`,
        'adopt',
      )
    }

    if (options.numberingEnabled && label !== '' && options.storageMode === 'source' && !detected) {
      add(
        NUMBERING_CONFLICT_CODES.numberMissing,
        'warning',
        heading,
        `源码持久化已开启，但该标题缺少编号“${label}”`,
        'write',
      )
    }

    if (detected && (label === '' || !options.numberingEnabled)) {
      add(
        NUMBERING_CONFLICT_CODES.manualNumberPrefix,
        'warning',
        heading,
        `标题包含手工编号“${detected.numberText}”，墨章未接管`,
        'preserve',
      )
    }

    if (detected && writable) {
      const detectedKey = canonicalNumberLabel(detected.numberText)
      if (seenDetected.has(detectedKey) || (label !== '' && seenExpected.has(detectedKey) && !detected.matchesExpected)) {
        add(
          NUMBERING_CONFLICT_CODES.numberOrderAnomaly,
          'error',
          heading,
          `编号“${detected.numberText}”在文档中重复或顺序异常`,
          'renumber',
        )
      }
      seenDetected.add(detectedKey)
    }
    if (label !== '') seenExpected.add(canonicalNumberLabel(label))

    const record = plan.ownership[heading.identity]
    if (record?.ownership === 'inkchapter' && label !== '' && !detected) {
      add(
        NUMBERING_CONFLICT_CODES.numberOwnershipConflict,
        'warning',
        heading,
        '编号归属记录显示墨章已写入，但源码中不存在对应编号',
        'write',
      )
    }
    if (record?.ownership === 'user-preserved' && !detected && label !== '') {
      add(
        NUMBERING_CONFLICT_CODES.numberOwnershipConflict,
        'warning',
        heading,
        '编号归属记录显示用户保留，但源码中不存在对应编号',
        'renumber',
      )
    }
  }

  // Format consistency: one dominant FAMILY; every deviation is reported.
  const dominantFormat = [...formatCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (dominantFormat != null && formatCounts.size > 1) {
    for (const heading of plan.headings) {
      const detected = heading.detected
      if (!detected || !isRewritableHeadingNumber(detected)) continue
      if (numberFormatFamily(detected.format) === dominantFormat) continue
      add(
        NUMBERING_CONFLICT_CODES.numberFormatInconsistent,
        'warning',
        heading,
        `编号格式“${numberFormatFamilyLabel(detected.format)}”与文档主流格式“${numberFormatFamilyLabel(dominantFormat)}”不一致`,
        'renumber',
      )
    }
  }

  issues.sort((a, b) => a.line - b.line)
  const errorCount = issues.filter(i => i.severity === 'error').length
  const warningCount = issues.filter(i => i.severity === 'warning').length

  return {
    issues,
    errorCount,
    warningCount,
    hasConflict: issues.length > 0,
    formatLine: (line: number) => `L${line}`,
  }
}

/** Human-readable one-line summary for a Notice. */
export function formatNumberingConflictSummary(report: NumberingConflictReport): string {
  if (!report.hasConflict) return '未发现编号冲突'
  const head = report.issues.slice(0, 3)
    .map(i => `L${i.line} ${i.code}`)
    .join('；')
  return `发现 ${report.errorCount} 个错误、${report.warningCount} 个警告：${head}`
}

/**
 * R09 — formats that belong to the SAME visual family never conflict with each
 * other. `1` and `1.1` are both decimal numbers; comparing the raw token type
 * would flag every hierarchical document as "inconsistent".
 */
export function numberFormatFamily(format: string): string {
  switch (format) {
    case 'arabic':
    case 'fullwidth-arabic':
    case 'decimal-multilevel':
      return 'numeric'
    case 'chinese-chapter':
    case 'chinese-outline':
    case 'chinese-parenthesized':
      return 'chinese'
    default:
      return format
  }
}

function numberFormatFamilyLabel(family: string): string {
  switch (family) {
    case 'numeric': return '阿拉伯数字'
    case 'chinese': return '中文数字'
    case 'roman': return '罗马数字'
    case 'alpha': return '字母'
    case 'appendix': return '附录'
    case 'circled': return '带圈数字'
    case 'custom': return '自定义'
    default: return family
  }
}
