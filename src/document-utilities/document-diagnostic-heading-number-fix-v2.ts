/**
 * R09 — REAL repair actions for the unified heading-number diagnostics.
 *
 * Every R09 diagnostic carries its fix target in metadata, produced by the SAME
 * R08 planner that produced the diagnostic:
 *   numberingLine   — 1-based heading line
 *   numberingBefore — the exact current heading line
 *   numberingAfter  — the adopt-plan target for that line ('' = no safe rewrite)
 *
 * The fixer only replaces that ONE line and refuses when the current text no
 * longer matches (STALE_SOURCE), so a panel click can never rewrite a heading
 * whose content changed after the detection snapshot.
 *
 * Pure contract: no DOM, no host state.
 */

import {
  splitFixLines,
  type DiagnosticFixPatch,
  type FixBlocker,
  type FixContext,
  type Fixer,
} from './document-diagnostic-fix-v1'
import type { DocumentDiagnostic } from './diagnostics-types'

export interface HeadingNumberFixCapability {
  capability: 'AUTO_SAFE' | 'EXPLICIT_ONLY'
  label: string
}

export const HEADING_NUMBER_FIX_CAPABILITIES: Readonly<Record<string, HeadingNumberFixCapability>> = {
  HEADING_DOUBLE_NUMBER_PREFIX: { capability: 'AUTO_SAFE', label: '移除重复编号' },
  HEADING_NUMBER_ORDER_ANOMALY: { capability: 'AUTO_SAFE', label: '重新编号' },
  HEADING_NUMBER_MISMATCH: { capability: 'EXPLICIT_ONLY', label: '同步标题编号' },
  HEADING_NUMBER_MISSING: { capability: 'EXPLICIT_ONLY', label: '补齐标题编号' },
  HEADING_NUMBER_FORMAT_INCONSISTENT: { capability: 'EXPLICIT_ONLY', label: '转换为当前方案' },
  HEADING_NUMBER_OWNERSHIP_CONFLICT: { capability: 'EXPLICIT_ONLY', label: '修正编号归属' },
  HEADING_MANUAL_NUMBER_PREFIX: { capability: 'EXPLICIT_ONLY', label: '接管该编号' },
  HEADING_AUTO_NUMBER_CONFLICT: { capability: 'EXPLICIT_ONLY', label: '消除重复显示' },
}

function buildHeadingLineFix(
  diagnostic: DocumentDiagnostic,
  ctx: FixContext,
): { patches?: DiagnosticFixPatch[]; blockers?: FixBlocker[] } {
  const metadata = diagnostic.metadata ?? {}
  const line = typeof metadata['numberingLine'] === 'number' ? metadata['numberingLine'] : 0
  const before = typeof metadata['numberingBefore'] === 'string' ? metadata['numberingBefore'] : ''
  const after = typeof metadata['numberingAfter'] === 'string' ? metadata['numberingAfter'] : ''

  if (!Number.isInteger(line) || line < 1 || before === '') {
    return { blockers: [{ code: 'INVALID_FACT', message: '该编号诊断缺少可定位的标题行。' }] }
  }
  if (after === '' || after === before) {
    return { blockers: [{ code: 'NOT_APPLICABLE', message: '该标题没有可安全自动写入的编号。' }] }
  }

  const lines = splitFixLines(ctx.markdown)
  const index = line - 1
  const target = lines[index]
  if (!target) {
    return { blockers: [{ code: 'TARGET_NOT_FOUND', message: '诊断对应的标题行已不存在。' }] }
  }
  if (target.text !== before) {
    return { blockers: [{ code: 'STALE_SOURCE', message: '标题内容已变化，请重新检测后再修复。' }] }
  }

  return {
    patches: [{
      start: target.start,
      end: target.start + target.text.length,
      before: target.text,
      after,
      lineStart: index,
      lineEnd: index,
      kind: 'replace-line',
    }],
  }
}

/** ONE fixer per R09 code; all share the same metadata-driven line replacement. */
export const HEADING_NUMBER_FIXERS: Readonly<Record<string, Fixer>> = Object.fromEntries(
  Object.entries(HEADING_NUMBER_FIX_CAPABILITIES).map(([code, capability]) => [
    code,
    {
      code,
      support: capability.capability === 'AUTO_SAFE' ? 'AUTO' : 'MANUAL',
      label: capability.label,
      build: buildHeadingLineFix,
    } satisfies Fixer,
  ]),
)
