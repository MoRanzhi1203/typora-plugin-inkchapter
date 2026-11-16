/**
 * R10 — Figure / table / code / formula number diagnostics (central panel).
 *
 * Source-level producer. It consumes the SAME `ObjectNumberPersistenceFacts`
 * snapshot the runtime service uses and emits only the defects that the existing
 * DOM rules cannot see:
 *
 *   - an existing caption was never adopted by InkChapter;
 *   - a source caption's chapter prefix no longer matches the heading result;
 *   - the source caption and the render-layer number disagree (render mode);
 *   - the same object carries duplicate caption paragraphs.
 *
 * Every diagnostic carries the exact 1-based source line and the adopt-plan
 * target, so the panel's fix pipeline only replaces the affected caption line.
 *
 * Pure contract: no DOM, no host state.
 */

import type { DocumentDiagnostic, DiagnosticLocation } from './diagnostics-types'
import {
  planObjectNumberPersistence,
  type NumberedObjectKind,
  type ObjectNumberPersistenceFacts,
  type PlannedObjectNumber,
} from '../heading-numbering/object-number-persistence'

export const FIGURE_CAPTION_UNMANAGED_CODE = 'FIGURE_CAPTION_UNMANAGED'
export const TABLE_CAPTION_UNMANAGED_CODE = 'TABLE_CAPTION_UNMANAGED'
export const CODE_CAPTION_UNMANAGED_CODE = 'CODE_CAPTION_UNMANAGED'
export const FORMULA_CAPTION_UNMANAGED_CODE = 'FORMULA_CAPTION_UNMANAGED'
export const OBJECT_NUMBER_CHAPTER_MISMATCH_CODE = 'OBJECT_NUMBER_CHAPTER_MISMATCH'
export const OBJECT_SOURCE_RENDER_CONFLICT_CODE = 'OBJECT_SOURCE_RENDER_CONFLICT'
export const OBJECT_DUPLICATE_CAPTION_CODE = 'OBJECT_DUPLICATE_CAPTION'
/** R12 — explicit scope requested a heading level that does not exist. */
export const OBJECT_NUMBER_SCOPE_MISSING_LEVEL_CODE = 'OBJECT_NUMBER_SCOPE_MISSING_LEVEL'

export const OBJECT_NUMBER_DIAGNOSTIC_CODES: readonly string[] = [
  FIGURE_CAPTION_UNMANAGED_CODE,
  TABLE_CAPTION_UNMANAGED_CODE,
  CODE_CAPTION_UNMANAGED_CODE,
  FORMULA_CAPTION_UNMANAGED_CODE,
  OBJECT_NUMBER_CHAPTER_MISMATCH_CODE,
  OBJECT_SOURCE_RENDER_CONFLICT_CODE,
  OBJECT_DUPLICATE_CAPTION_CODE,
  OBJECT_NUMBER_SCOPE_MISSING_LEVEL_CODE,
]

const UNMANAGED_CODE: Readonly<Record<NumberedObjectKind, string>> = {
  figure: FIGURE_CAPTION_UNMANAGED_CODE,
  table: TABLE_CAPTION_UNMANAGED_CODE,
  code: CODE_CAPTION_UNMANAGED_CODE,
  formula: FORMULA_CAPTION_UNMANAGED_CODE,
}

const KIND_LABEL: Readonly<Record<NumberedObjectKind, string>> = {
  figure: '图片',
  table: '表格',
  code: '代码块',
  formula: '公式',
}

export interface ObjectNumberDiagnosticsInput {
  markdown: string
  documentKey: string | null
  sourceRevision?: number | null
  facts: ObjectNumberPersistenceFacts
}

/**
 * Build the source-level object-number diagnostics. One issue per object and
 * per root cause: a chapter mismatch suppresses the generic source/render
 * conflict (same number-difference root cause).
 */
export function computeObjectNumberDiagnosticFacts(
  input: ObjectNumberDiagnosticsInput,
): DocumentDiagnostic[] {
  const { markdown, facts } = input
  if (!facts?.configs) return []

  const detect = planObjectNumberPersistence(markdown, {
    mode: 'render',
    policy: 'detect-only',
    configs: facts.configs,
    headingSettings: facts.headingSettings,
    overrideEntries: facts.overrideEntries,
    counterPolicy: facts.counterPolicy,
    ownership: facts.ownership,
  })

  const adopt = detect.objects.some(o => needsAdoptTarget(o, facts))
    ? planObjectNumberPersistence(markdown, {
        mode: 'source',
        policy: 'adopt',
        configs: facts.configs,
        headingSettings: facts.headingSettings,
        overrideEntries: facts.overrideEntries,
        counterPolicy: facts.counterPolicy,
        ownership: facts.ownership,
      })
    : null
  const adoptByIdentity = new Map((adopt?.objects ?? []).map(o => [o.identity, o]))

  const out: DocumentDiagnostic[] = []
  for (const object of detect.objects) {
    if (object.captionLine == null) continue
    const adoptEntry = adoptByIdentity.get(object.identity)
    const before = object.before ?? ''
    const after = adoptEntry?.after ?? ''
    const canFix = after !== '' && after !== before
    const line = object.captionLine
    const location: DiagnosticLocation = {
      kind: 'source-range',
      startLine: line - 1,
      startColumn: 0,
      rawText: before,
    }
    const baseMetadata = {
      objectKind: object.kind,
      objectOrdinal: object.ordinal,
      objectSourceIdentity: object.identity,
      captionLine: line,
      detectedNumber: object.detectedNumber,
      expectedNumber: object.expected?.numberText ?? '',
      objectNumberingLine: line,
      objectNumberingBefore: before,
      objectNumberingAfter: canFix ? after : '',
    }

    if (object.chapterMismatch) {
      out.push(makeDiagnostic(input, {
        code: OBJECT_NUMBER_CHAPTER_MISMATCH_CODE,
        kind: object.kind,
        identity: object.identity,
        message: `${KIND_LABEL[object.kind]}编号与所在章节不一致：${object.detectedNumber}`,
        detail: `当前章节应使用编号“${object.expected?.numberText ?? ''}”，源码题注仍为“${object.detectedNumber}”。`,
        location,
        metadata: { ...baseMetadata, reason: 'OBJECT_NUMBER_CHAPTER_MISMATCH' },
        severity: 'error',
      }))
      continue
    }

    if (facts.storageMode === 'render' && object.detectedNumber !== '' && object.expected != null
      && !object.chapterMismatch && object.detectedNumber !== object.expected.numberText) {
      out.push(makeDiagnostic(input, {
        code: OBJECT_SOURCE_RENDER_CONFLICT_CODE,
        kind: object.kind,
        identity: object.identity,
        message: `${KIND_LABEL[object.kind]}源码题注与渲染编号冲突：${object.detectedNumber}`,
        detail: `渲染层按当前方案会显示“${object.expected.numberText}”，源码题注仍为“${object.detectedNumber}”。`,
        location,
        metadata: { ...baseMetadata, reason: 'OBJECT_SOURCE_RENDER_CONFLICT' },
        severity: 'error',
      }))
      continue
    }

    if (object.ownership !== 'inkchapter' && object.ownership !== 'adopted') {
      // A caption whose number is already correct needs no source patch; the
      // adoption itself is a runtime ownership update, not a diagnostic repair.
      // Never offer a button that would answer NOT_APPLICABLE.
      if (canFix) {
        out.push(makeDiagnostic(input, {
          code: UNMANAGED_CODE[object.kind],
          kind: object.kind,
          identity: object.identity,
          message: `${KIND_LABEL[object.kind]}题注尚未接管：${object.detectedNumber}`,
          detail: '源码中已有题注编号，但墨章尚未接管，后续章节变化不会同步该编号。',
          location,
          metadata: { ...baseMetadata, reason: 'CAPTION_UNMANAGED' },
          severity: 'warning',
        }))
      }
    }

    // R12: the configured scope requests a heading level that this object's
    // ancestor chain does not provide, and the user asked for a diagnostic.
    // Only emitted when a real caption patch exists, so the fix button is live.
    const scopePolicy = facts.configs[object.kind]?.scope?.missingLevelPolicy
    if (scopePolicy === 'diagnostic' && object.expected?.missingScopeLevel === true && canFix) {
      out.push(makeDiagnostic(input, {
        code: OBJECT_NUMBER_SCOPE_MISSING_LEVEL_CODE,
        kind: object.kind,
        identity: object.identity,
        message: `${KIND_LABEL[object.kind]}编号作用域缺少标题层级`,
        detail: `配置的前缀层级缺少对应标题，当前按“${object.expected.numberText}”回退显示。`,
        location,
        metadata: {
          ...baseMetadata,
          reason: 'OBJECT_NUMBER_SCOPE_MISSING_LEVEL',
          scopeFallback: object.expected.scopeFallback ?? 'document',
          requestedPrefixLevel: object.expected.requestedPrefixLevel ?? null,
        },
        severity: 'warning',
      }))
    }

    if (object.duplicateCaptionLines.length > 0) {
      out.push(makeDiagnostic(input, {
        code: OBJECT_DUPLICATE_CAPTION_CODE,
        kind: object.kind,
        identity: object.identity,
        message: `${KIND_LABEL[object.kind]}存在重复题注`,
        detail: `同一个${KIND_LABEL[object.kind]}对象绑定了 ${object.duplicateCaptionLines.length + 1} 条题注，请保留唯一一条。`,
        location,
        metadata: {
          ...baseMetadata,
          reason: 'OBJECT_DUPLICATE_CAPTION',
          duplicateCaptionLines: object.duplicateCaptionLines,
        },
        severity: 'warning',
      }))
    }
  }

  return out.sort((a, b) => sourceLine(a) - sourceLine(b))
}

function needsAdoptTarget(object: PlannedObjectNumber, facts: ObjectNumberPersistenceFacts): boolean {
  if (object.captionLine == null) return false
  if (object.chapterMismatch) return true
  if (facts.storageMode === 'render' && object.expected != null
    && object.detectedNumber !== '' && object.detectedNumber !== object.expected.numberText) return true
  return object.ownership !== 'inkchapter' && object.ownership !== 'adopted'
}

function sourceLine(diagnostic: DocumentDiagnostic): number {
  return diagnostic.location?.kind === 'source-range' ? diagnostic.location.startLine : 0
}

interface DiagnosticSpec {
  code: string
  kind: NumberedObjectKind
  identity: string
  message: string
  detail: string
  location: DiagnosticLocation
  metadata: Record<string, unknown>
  severity: 'error' | 'warning'
}

function makeDiagnostic(input: ObjectNumberDiagnosticsInput, spec: DiagnosticSpec): DocumentDiagnostic {
  const documentKey = input.documentKey ?? ''
  return {
    domain: 'document',
    id: `${documentKey}::${spec.code}::${spec.identity}`,
    documentKey,
    severity: spec.severity,
    category: spec.kind,
    code: spec.code,
    message: spec.message,
    detail: spec.detail,
    stableIdentity: spec.identity,
    targetIdentity: `${spec.code}:${spec.identity}`,
    metadata: { ...spec.metadata, sourceRevision: input.sourceRevision ?? null },
    location: spec.location,
  }
}
