/**
 * Document Diagnostics — Caption Integrity (Phase G / spec §8 / §15 / §20).
 *
 * DOM-side producer. Caption OWNERSHIP is a runtime concept owned by the caption
 * service (the ONLY writer): a caption projection binds to exactly one canonical
 * object owner through the runtime owner map exposed by `caption-dom-adapter`
 * (`getCanonicalCaptionOwnerRoot`). This module NEVER guesses an owner from DOM
 * adjacency (`nextElementSibling` / nearest caption / skip-empty-p / a global
 * caption selector / a text regex) — an unbound caption is an ORPHAN by
 * definition.
 *
 * FORMAT validation reuses the ONE canonical formatter `buildObjectNumberingLabel`
 * — the SAME authority the caption service renders every caption with. No second
 * regex, no hardcoded 图/表/代码 display strings.
 */
import type { DiagnosticLocation, DocumentDiagnostic } from './diagnostics-types'
import {
  collectCanonicalCaptionProjections,
  getCanonicalCaptionId,
  getCanonicalCaptionKind,
  getCanonicalCaptionOwnerRoot,
  getCanonicalCaptionTitle,
} from '../heading-numbering/caption-dom-adapter'
import { buildObjectNumberingLabel } from '../heading-numbering/object-numbering-engine'

// ── Codes (registry keys, EXACT) ────────────────────────────────────────────
export const FIGURE_ORPHAN_CAPTION_CODE = 'FIGURE_ORPHAN_CAPTION'
export const TABLE_ORPHAN_CAPTION_CODE = 'TABLE_ORPHAN_CAPTION'
export const CODE_ORPHAN_CAPTION_CODE = 'CODE_ORPHAN_CAPTION'
export const FIGURE_MULTIPLE_CAPTIONS_CODE = 'FIGURE_MULTIPLE_CAPTIONS'
export const TABLE_MULTIPLE_CAPTIONS_CODE = 'TABLE_MULTIPLE_CAPTIONS'
export const CODE_MULTIPLE_CAPTIONS_CODE = 'CODE_MULTIPLE_CAPTIONS'
export const FIGURE_CAPTION_FORMAT_INVALID_CODE = 'FIGURE_CAPTION_FORMAT_INVALID'
export const TABLE_CAPTION_FORMAT_INVALID_CODE = 'TABLE_CAPTION_FORMAT_INVALID'
export const CODE_CAPTION_FORMAT_INVALID_CODE = 'CODE_CAPTION_FORMAT_INVALID'

/** §6 — every runtime code this producer can emit (Registry ↔ Producer allow-list). */
export const CAPTION_INTEGRITY_DIAGNOSTIC_CODES: readonly string[] = [
  FIGURE_ORPHAN_CAPTION_CODE,
  TABLE_ORPHAN_CAPTION_CODE,
  CODE_ORPHAN_CAPTION_CODE,
  FIGURE_MULTIPLE_CAPTIONS_CODE,
  TABLE_MULTIPLE_CAPTIONS_CODE,
  CODE_MULTIPLE_CAPTIONS_CODE,
  FIGURE_CAPTION_FORMAT_INVALID_CODE,
  TABLE_CAPTION_FORMAT_INVALID_CODE,
  CODE_CAPTION_FORMAT_INVALID_CODE,
]

export type CaptionIntegrityKind = 'figure' | 'table' | 'code'

export interface CaptionIntegrityInput {
  documentKey: string | null
  /** The business content root the caption projections live in. */
  root: HTMLElement | null
  sourceRevision?: number | null
}

export interface CaptionIntegrityResult {
  diagnostics: DocumentDiagnostic[]
  /** ONE per unbound caption projection. */
  orphanCaptionCount: number
  /** ONE per owner owning >1 caption. */
  multipleCaptionOwnerCount: number
  /** ONE per caption whose label does not conform to the canonical formatter. */
  formatInvalidCaptionCount: number
}

const KIND_LABEL: Readonly<Record<CaptionIntegrityKind, string>> = {
  figure: '图片',
  table: '表格',
  code: '代码块',
}

const ORPHAN_CODE: Readonly<Record<CaptionIntegrityKind, string>> = {
  figure: FIGURE_ORPHAN_CAPTION_CODE,
  table: TABLE_ORPHAN_CAPTION_CODE,
  code: CODE_ORPHAN_CAPTION_CODE,
}

const MULTIPLE_CODE: Readonly<Record<CaptionIntegrityKind, string>> = {
  figure: FIGURE_MULTIPLE_CAPTIONS_CODE,
  table: TABLE_MULTIPLE_CAPTIONS_CODE,
  code: CODE_MULTIPLE_CAPTIONS_CODE,
}

const FORMAT_CODE: Readonly<Record<CaptionIntegrityKind, string>> = {
  figure: FIGURE_CAPTION_FORMAT_INVALID_CODE,
  table: TABLE_CAPTION_FORMAT_INVALID_CODE,
  code: CODE_CAPTION_FORMAT_INVALID_CODE,
}

function isCaptionKind(value: string | null): value is CaptionIntegrityKind {
  return value === 'figure' || value === 'table' || value === 'code'
}

/**
 * §8.3 — a caption label conforms to the canonical formatter output iff it can
 * be reproduced EXACTLY by `buildObjectNumberingLabel(prefix, number, name)` for
 * the projection's own canonical `name` (`data-inkchapter-caption-title`) and a
 * single leading `prefix`/`number` split. The prefix is taken from the label
 * itself (never a hardcoded display string) so a user-customised prefix is NOT a
 * false positive; the canonical formatter is the ONLY authority that decides.
 */
export function isCanonicalCaptionLabel(label: string, title: string): boolean {
  if (label === '') return false
  const name = title.trim()
  const nameSuffix = name !== '' ? ` ${name}` : ''
  if (nameSuffix !== '' && !label.endsWith(nameSuffix)) return false
  const head = nameSuffix !== '' ? label.slice(0, label.length - nameSuffix.length) : label
  const sep = head.indexOf(' ')
  if (sep <= 0) return false
  const prefix = head.slice(0, sep)
  const number = head.slice(sep + 1)
  if (number === '') return false
  return buildObjectNumberingLabel(prefix, number, name) === label
}

function captionLocation(captionKind: CaptionIntegrityKind, captionId: string): DiagnosticLocation {
  return { kind: 'caption-projection', captionKind, captionId }
}

/**
 * §8/§15 — the DOM-side caption integrity producer. Pure over the DOM: it reads
 * the canonical owner map + the canonical projection attributes and emits the 9
 * caption-integrity codes. One diagnostic per orphan caption; ONE per owner with
 * >1 caption (a `target-group`, never N business diagnostics); one per
 * malformed label.
 */
export function computeCaptionIntegrityDiagnostics(input: CaptionIntegrityInput): CaptionIntegrityResult {
  const out: DocumentDiagnostic[] = []
  const docKey = input.documentKey ?? ''
  const root = input.root
  if (!root) {
    return { diagnostics: out, orphanCaptionCount: 0, multipleCaptionOwnerCount: 0, formatInvalidCaptionCount: 0 }
  }

  const byOwner = new Map<HTMLElement, HTMLElement[]>()
  let orphanCaptionCount = 0
  let formatInvalidCaptionCount = 0

  for (const caption of collectCanonicalCaptionProjections(root)) {
    const kindAttr = getCanonicalCaptionKind(caption)
    if (!isCaptionKind(kindAttr)) continue
    const kind: CaptionIntegrityKind = kindAttr
    const captionId = getCanonicalCaptionId(caption)
    if (captionId === '') continue // an id-less projection cannot be located; skip
    const owner = getCanonicalCaptionOwnerRoot(caption)
    const label = caption.textContent ?? ''

    if (!owner) {
      // ── §8.1 ORPHAN — ONE diagnostic per unbound caption. Never adopt a
      // neighbour by adjacency.
      orphanCaptionCount++
      out.push(makeDiagnostic(input, docKey, {
        code: ORPHAN_CODE[kind],
        kind,
        captionId,
        message: `${KIND_LABEL[kind]}题注没有对应的对象`,
        detail: `存在一个${KIND_LABEL[kind]}题注，但无法绑定到唯一的${KIND_LABEL[kind]}对象。`,
        location: captionLocation(kind, captionId),
        element: caption,
        metadata: { reason: 'ORPHAN_CAPTION', captionKind: kind, captionId },
      }))
      continue
    }

    const list = byOwner.get(owner) ?? []
    list.push(caption)
    byOwner.set(owner, list)

    // ── §8.3 FORMAT — one diagnostic per malformed label.
    if (!isCanonicalCaptionLabel(label, getCanonicalCaptionTitle(caption))) {
      formatInvalidCaptionCount++
      out.push(makeDiagnostic(input, docKey, {
        code: FORMAT_CODE[kind],
        kind,
        captionId,
        message: `${KIND_LABEL[kind]}题注格式不规范`,
        detail: `题注文字不符合规范格式「${KIND_LABEL[kind]} 编号 名称」。`,
        location: captionLocation(kind, captionId),
        element: caption,
        metadata: {
          reason: 'CAPTION_FORMAT_INVALID',
          captionKind: kind,
          captionId,
          captionLabel: label,
          captionName: getCanonicalCaptionTitle(caption),
        },
      }))
    }
  }

  // ── §8.2 MULTIPLE — ONE diagnostic per owner with >1 bound caption, presented
  // as a TARGET GROUP (ONE Drawer row / N members) — never N business diagnostics.
  let multipleCaptionOwnerCount = 0
  for (const [owner, captions] of byOwner) {
    if (captions.length <= 1) continue
    multipleCaptionOwnerCount++
    const kindAttr = getCanonicalCaptionKind(captions[0])
    if (!isCaptionKind(kindAttr)) continue
    const kind: CaptionIntegrityKind = kindAttr
    const members = captions.map(c => captionLocation(kind, getCanonicalCaptionId(c)))
    const ownerKey = owner.getAttribute('data-inkchapter-caption-owner-key') ?? ''
    const anchor = members[0]
    const identity = ownerKey !== '' ? ownerKey : (anchor as Extract<DiagnosticLocation, { kind: 'caption-projection' }>).captionId
    out.push(makeDiagnostic(input, docKey, {
      code: MULTIPLE_CODE[kind],
      kind,
      captionId: identity,
      message: `${KIND_LABEL[kind]}存在多个题注`,
      detail: `同一个${KIND_LABEL[kind]}对象绑定了多个题注，请保留唯一一个。`,
      location: { kind: 'target-group', scrollAnchor: anchor, targets: members },
      element: captions[0],
      metadata: {
        reason: 'MULTIPLE_CAPTIONS',
        captionKind: kind,
        captionCount: captions.length,
        ownerKey,
      },
    }))
  }

  return { diagnostics: out, orphanCaptionCount, multipleCaptionOwnerCount, formatInvalidCaptionCount }
}

interface CaptionDiagnosticSpec {
  code: string
  kind: CaptionIntegrityKind
  /** The stable suffix that makes this diagnostic unique (captionId or ownerKey). */
  captionId: string
  message: string
  detail: string
  location: DiagnosticLocation
  element: HTMLElement
  metadata: Record<string, unknown>
}

function makeDiagnostic(
  input: CaptionIntegrityInput,
  docKey: string,
  spec: CaptionDiagnosticSpec,
): DocumentDiagnostic {
  return {
    domain: 'document',
    id: `${docKey}::${spec.code}::${spec.captionId}`,
    documentKey: docKey,
    severity: 'warning',
    category: spec.kind,
    code: spec.code,
    message: spec.message,
    detail: spec.detail,
    stableIdentity: spec.captionId,
    targetIdentity: `${spec.code}:${spec.captionId}`,
    locator: { kind: 'object', targetElement: spec.element },
    metadata: { ...spec.metadata, sourceRevision: input.sourceRevision ?? null },
    location: spec.location,
  }
}
