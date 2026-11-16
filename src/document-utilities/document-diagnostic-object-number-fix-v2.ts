/**
 * R10 — REAL repair actions for figure/table/code/formula number diagnostics.
 *
 * Every object-number diagnostic carries its fix target in metadata:
 *   objectNumberingLine     1-based caption line
 *   objectNumberingBefore   the exact current caption line
 *   objectNumberingAfter    the adopt-plan target ('' = no safe rewrite)
 *   duplicateCaptionLines   1-based lines of the redundant captions
 *
 * The fixer replaces/deletes only those lines and refuses when the live text no
 * longer matches (STALE_SOURCE), so a panel click can never corrupt an object
 * whose caption changed after the detection snapshot.
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
import {
  FIGURE_CAPTION_UNMANAGED_CODE,
  TABLE_CAPTION_UNMANAGED_CODE,
  CODE_CAPTION_UNMANAGED_CODE,
  FORMULA_CAPTION_UNMANAGED_CODE,
  OBJECT_NUMBER_CHAPTER_MISMATCH_CODE,
  OBJECT_SOURCE_RENDER_CONFLICT_CODE,
  OBJECT_DUPLICATE_CAPTION_CODE,
  OBJECT_NUMBER_SCOPE_MISSING_LEVEL_CODE,
} from './document-diagnostics-object-number-v1'

export interface ObjectNumberFixCapability {
  capability: 'AUTO_SAFE' | 'EXPLICIT_ONLY'
  label: string
}

export const OBJECT_NUMBER_FIX_CAPABILITIES: Readonly<Record<string, ObjectNumberFixCapability>> = {
  [OBJECT_NUMBER_CHAPTER_MISMATCH_CODE]: { capability: 'AUTO_SAFE', label: '同步题注编号' },
  [OBJECT_SOURCE_RENDER_CONFLICT_CODE]: { capability: 'EXPLICIT_ONLY', label: '消除重复编号' },
  [FIGURE_CAPTION_UNMANAGED_CODE]: { capability: 'EXPLICIT_ONLY', label: '接管图题' },
  [TABLE_CAPTION_UNMANAGED_CODE]: { capability: 'EXPLICIT_ONLY', label: '接管表题' },
  [CODE_CAPTION_UNMANAGED_CODE]: { capability: 'EXPLICIT_ONLY', label: '接管代码题注' },
  [FORMULA_CAPTION_UNMANAGED_CODE]: { capability: 'EXPLICIT_ONLY', label: '接管公式编号' },
  [OBJECT_DUPLICATE_CAPTION_CODE]: { capability: 'AUTO_SAFE', label: '删除重复题注' },
  // R12 — the fallback number is still a real, computable caption target.
  [OBJECT_NUMBER_SCOPE_MISSING_LEVEL_CODE]: { capability: 'EXPLICIT_ONLY', label: '同步对象编号' },
}

function buildCaptionLineFix(
  diagnostic: DocumentDiagnostic,
  ctx: FixContext,
): { patches?: DiagnosticFixPatch[]; blockers?: FixBlocker[] } {
  const metadata = diagnostic.metadata ?? {}
  const line = typeof metadata['objectNumberingLine'] === 'number' ? metadata['objectNumberingLine'] : 0
  const before = typeof metadata['objectNumberingBefore'] === 'string' ? metadata['objectNumberingBefore'] : ''
  const after = typeof metadata['objectNumberingAfter'] === 'string' ? metadata['objectNumberingAfter'] : ''

  if (!Number.isInteger(line) || line < 1 || before === '') {
    return { blockers: [{ code: 'INVALID_FACT', message: '该题注诊断缺少可定位的题注行。' }] }
  }
  if (after === '' || after === before) {
    return { blockers: [{ code: 'NOT_APPLICABLE', message: '该题注没有可安全自动写入的编号。' }] }
  }

  const lines = splitFixLines(ctx.markdown)
  const index = line - 1
  const target = lines[index]
  if (!target) {
    return { blockers: [{ code: 'TARGET_NOT_FOUND', message: '诊断对应的题注行已不存在。' }] }
  }
  if (target.text !== before) {
    return { blockers: [{ code: 'STALE_SOURCE', message: '题注内容已变化，请重新检测后再修复。' }] }
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

function buildDuplicateCaptionFix(
  diagnostic: DocumentDiagnostic,
  ctx: FixContext,
): { patches?: DiagnosticFixPatch[]; blockers?: FixBlocker[] } {
  const metadata = diagnostic.metadata ?? {}
  const raw = metadata['duplicateCaptionLines']
  const duplicateLines = Array.isArray(raw)
    ? raw.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1)
    : []
  if (duplicateLines.length === 0) {
    return { blockers: [{ code: 'INVALID_FACT', message: '该诊断没有可删除的重复题注行。' }] }
  }

  const lines = splitFixLines(ctx.markdown)
  const patches: DiagnosticFixPatch[] = []
  for (const line of duplicateLines) {
    const target = lines[line - 1]
    if (!target) {
      return { blockers: [{ code: 'TARGET_NOT_FOUND', message: '重复题注行已不存在。' }] }
    }
    patches.push({
      start: target.start,
      end: target.end,
      before: ctx.markdown.slice(target.start, target.end),
      after: '',
      lineStart: line - 1,
      lineEnd: line - 1,
      kind: 'delete-lines',
    })
  }
  return { patches }
}

function buildObjectNumberFix(
  diagnostic: DocumentDiagnostic,
  ctx: FixContext,
): { patches?: DiagnosticFixPatch[]; blockers?: FixBlocker[] } {
  if (diagnostic.code === OBJECT_DUPLICATE_CAPTION_CODE) {
    return buildDuplicateCaptionFix(diagnostic, ctx)
  }
  return buildCaptionLineFix(diagnostic, ctx)
}

/** ONE fixer per R10 code; all share the metadata-driven caption repair. */
export const OBJECT_NUMBER_FIXERS: Readonly<Record<string, Fixer>> = Object.fromEntries(
  Object.entries(OBJECT_NUMBER_FIX_CAPABILITIES).map(([code, capability]) => [
    code,
    {
      code,
      support: capability.capability === 'AUTO_SAFE' ? 'AUTO' : 'MANUAL',
      label: capability.label,
      build: buildObjectNumberFix,
    } satisfies Fixer,
  ]),
)
