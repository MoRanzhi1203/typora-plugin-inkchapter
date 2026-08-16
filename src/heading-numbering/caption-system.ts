/**
 * Caption System V1 — unified table/figure/code caption naming + numbering.
 *
 * This module is the PURE canonical core (data model, registry, numbering,
 * label rendering, target identity, serialization). It contains NO DOM, NO
 * context-menu, NO sidecar I/O — those live in the runtime integration layer.
 *
 * Design invariants (per spec):
 * - title and number are FULLY separated; number is computed, never stored.
 * - table/figure/code numbering sequences are independent.
 * - target identity is positional (ordinal + neighborhood), NEVER content
 *   (URL / text / innerHTML / code text), so duplicate-content targets get
 *   independent captions and historical records cannot re-bind by content.
 */

export type CaptionTargetType = 'table' | 'figure' | 'code'

export interface CaptionTypeConfig {
  type: CaptionTargetType
  /** Default display prefix (表 / 图 / 代码). Not hardcoded into DOM. */
  prefix: string
  /** Caption position relative to target. */
  position: 'above' | 'below'
  enabled: boolean
  numbering: 'continuous'
}

export const CAPTION_TYPE_CONFIG: Record<CaptionTargetType, CaptionTypeConfig> = {
  table: { type: 'table', prefix: '表', position: 'above', enabled: true, numbering: 'continuous' },
  figure: { type: 'figure', prefix: '图', position: 'below', enabled: true, numbering: 'continuous' },
  code: { type: 'code', prefix: '代码', position: 'above', enabled: true, numbering: 'continuous' },
}

// ── User-facing settings (entry point for a future settings UI) ─────

export interface CaptionTypeSettings {
  enabled: boolean
  position: 'above' | 'below'
  prefix: string
  numbering: 'continuous'
  /** Object Numbering V2 fields (additive; defaults keep legacy behavior). */
  numberingMode?: 'continuous' | 'reset-h1' | 'reset-h2' | 'reset-h3' | 'chapter-linked' | 'custom'
  numberStyle?: 'arabic' | 'arabic-padded' | 'chinese' | 'chinese-financial' | 'roman-lower' | 'roman-upper' | 'alpha-lower' | 'alpha-upper'
  startAt?: number
  minDigits?: number
  template?: string
  resetHeadingLevel?: 1 | 2 | 3
}

export interface CaptionSettings {
  schemaVersion: number
  types: Record<CaptionTargetType, CaptionTypeSettings>
}

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  schemaVersion: 1,
  types: {
    table: { enabled: true, position: 'above', prefix: '表', numbering: 'continuous', numberingMode: 'continuous', numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '{n}' },
    figure: { enabled: true, position: 'below', prefix: '图', numbering: 'continuous', numberingMode: 'continuous', numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '{n}' },
    code: { enabled: true, position: 'above', prefix: '代码', numbering: 'continuous', numberingMode: 'continuous', numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '{n}' },
  },
}

/** Positional, content-independent target identity. */
export interface CaptionTargetAnchor {
  type: CaptionTargetType
  /** 0-based ordinal among same-type targets in document order. */
  ordinal: number
  /** Structural neighborhood fingerprints (NEVER the target's own content). */
  beforeFingerprint?: string
  afterFingerprint?: string
  /**
   * Hash of the target's own content (image URL / code text / table text).
   * NEVER a sole identity: always corroborated by ordinal + occurrence +
   * neighborhood. Used to survive reorder/move and disambiguate duplicates.
   */
  contentSignature?: string
  /** 1-based occurrence among same-type targets sharing contentSignature. */
  occurrence?: number
}

export interface CaptionRecord {
  captionId: string
  documentKey: string
  type: CaptionTargetType
  /** User-entered caption title only (never "图 3 xxx"). */
  title: string
  targetAnchor: CaptionTargetAnchor
  createdAt: number
  updatedAt: number
}

// ── Registry ──────────────────────────────────────────────────────────

export class CaptionRegistry {
  private recordsById = new Map<string, CaptionRecord>()
  private byDocument = new Map<string, CaptionRecord[]>()

  create(input: {
    captionId: string
    documentKey: string
    type: CaptionTargetType
    title: string
    targetAnchor: CaptionTargetAnchor
    now?: number
  }): CaptionRecord {
    const now = input.now ?? Date.now()
    const record: CaptionRecord = {
      captionId: input.captionId,
      documentKey: input.documentKey,
      type: input.type,
      title: input.title,
      targetAnchor: input.targetAnchor,
      createdAt: now,
      updatedAt: now,
    }
    this.recordsById.set(record.captionId, record)
    const list = this.byDocument.get(record.documentKey) ?? []
    list.push(record)
    this.byDocument.set(record.documentKey, list)
    return record
  }

  update(captionId: string, title: string, now?: number): CaptionRecord | null {
    const record = this.recordsById.get(captionId)
    if (!record) return null
    record.title = title
    record.updatedAt = now ?? Date.now()
    return record
  }

  /** Retarget a caption to a new anchor (object moved). Never changes title. */
  retarget(captionId: string, targetAnchor: CaptionTargetAnchor, now?: number): CaptionRecord | null {
    const record = this.recordsById.get(captionId)
    if (!record) return null
    record.targetAnchor = targetAnchor
    record.updatedAt = now ?? Date.now()
    return record
  }

  /** Delete only the caption record (target object is untouched). */
  delete(captionId: string): boolean {
    const record = this.recordsById.get(captionId)
    if (!record) return false
    this.recordsById.delete(captionId)
    const list = this.byDocument.get(record.documentKey)
    if (list) {
      const idx = list.findIndex(r => r.captionId === captionId)
      if (idx >= 0) list.splice(idx, 1)
      if (list.length === 0) this.byDocument.delete(record.documentKey)
    }
    return true
  }

  getById(captionId: string): CaptionRecord | null {
    return this.recordsById.get(captionId) ?? null
  }

  /** Lookup by positional target identity (NOT content). */
  getByTarget(documentKey: string, type: CaptionTargetType, ordinal: number): CaptionRecord | null {
    const list = this.byDocument.get(documentKey) ?? []
    return list.find(r => r.type === type && r.targetAnchor.ordinal === ordinal) ?? null
  }

  listByDocument(documentKey: string): CaptionRecord[] {
    return [...(this.byDocument.get(documentKey) ?? [])]
  }

  listByDocumentAndType(documentKey: string, type: CaptionTargetType): CaptionRecord[] {
    return (this.byDocument.get(documentKey) ?? []).filter(r => r.type === type)
  }

  /** Clear all captions for a document (document switch isolation). */
  clearDocument(documentKey: string): void {
    const list = this.byDocument.get(documentKey)
    if (list) {
      for (const r of list) this.recordsById.delete(r.captionId)
      this.byDocument.delete(documentKey)
    }
  }

  serialize(documentKey: string): CaptionRecord[] {
    return this.listByDocument(documentKey).map(r => ({ ...r, targetAnchor: { ...r.targetAnchor } }))
  }

  /** Rehydrate a document's records from persisted data. */
  rehydrate(documentKey: string, records: CaptionRecord[]): void {
    this.clearDocument(documentKey)
    for (const r of records) {
      this.create({
        captionId: r.captionId,
        documentKey,
        type: r.type,
        title: r.title,
        targetAnchor: { ...r.targetAnchor },
        now: r.createdAt,
      })
    }
  }
}

// ── Numbering (independent per-type sequences) ────────────────────────

export interface CaptionNumberEntry {
  captionId: string
  type: CaptionTargetType
  number: number
}

/**
 * Resolve caption numbers. Only captioned targets participate; each type
 * increments independently, in document order.
 */
export function resolveCaptionNumbers(
  orderedCaptions: Array<{ captionId: string; type: CaptionTargetType }>,
): CaptionNumberEntry[] {
  const counters: Record<CaptionTargetType, number> = { table: 0, figure: 0, code: 0 }
  return orderedCaptions.map(({ captionId, type }) => {
    counters[type]++
    return { captionId, type, number: counters[type] }
  })
}

/**
 * Build a caption label from prefix + number + optional name using a single
 * structural space between each part.
 *
 * Invariants:
 * - no name  → `图 1`
 * - with name → `图 1 tst` (exactly ONE structural space between number and name)
 * - the user's own internal double spaces inside `name` are PRESERVED (only the
 *   leading/trailing whitespace is trimmed; the plugin never collapses inner spaces).
 */
export function buildCaptionLabel(prefix: string, number: number, name: string): string {
  const parts: string[] = [prefix, String(number)]
  const trimmedName = name.trim()
  if (trimmedName !== '') parts.push(trimmedName)
  return parts.join(' ')
}

/** Build the display label (prefix + number + title) from the resolved number. */
export function renderCaptionLabel(type: CaptionTargetType, number: number, title: string, prefixOverride?: string): string {
  const prefix = prefixOverride ?? CAPTION_TYPE_CONFIG[type].prefix
  return buildCaptionLabel(prefix, number, title)
}

/** Resolve the effective per-type config from user settings (or default). */
export function resolveCaptionTypeSettings(settings: CaptionSettings | null | undefined, type: CaptionTargetType): CaptionTypeSettings {
  return settings?.types?.[type] ?? DEFAULT_CAPTION_SETTINGS.types[type]
}

// ── Target identity (positional, content-independent) ────────────────

/** Compute a positional anchor for the Nth same-type target in document order. */
export function computeCaptionAnchor(
  type: CaptionTargetType,
  ordinal: number,
  beforeFingerprint?: string,
  afterFingerprint?: string,
  contentSignature?: string,
  occurrence?: number,
): CaptionTargetAnchor {
  return { type, ordinal, beforeFingerprint, afterFingerprint, contentSignature, occurrence }
}

/**
 * Resolve a caption record to an ordered target position.
 *
 * Pure positional resolution — never matches by URL / text / code content, so
 * duplicate-content objects stay independent and historical records cannot
 * re-bind to a new object merely because content is equal.
 */
export function resolveCaptionTargetIndex(
  anchor: CaptionTargetAnchor,
  orderedAnchors: CaptionTargetAnchor[],
): number {
  let sameTypeSeen = 0
  for (let i = 0; i < orderedAnchors.length; i++) {
    const a = orderedAnchors[i]
    if (a.type !== anchor.type) continue
    if (sameTypeSeen === anchor.ordinal) return i
    sameTypeSeen++
  }
  return -1
}

// ── Strong identity resolution ────────────────────────────────────────

/**
 * Current-document descriptor for a single same-type target, in document
 * order. Produced by the DOM adapter (content + structural neighborhood).
 */
export interface CaptionAnchorDescriptor {
  type: CaptionTargetType
  ordinal: number
  contentSignature?: string
  beforeFingerprint?: string
  afterFingerprint?: string
}

export type CaptionAnchorResolveDecision =
  | 'STRONG'
  | 'ORDINAL_ONLY'
  | 'AMBIGUOUS'
  | 'NOT_FOUND'

export interface CaptionAnchorResolveResult {
  /** Index into the FULL ordered descriptor list, or -1 when unresolved. */
  index: number
  decision: CaptionAnchorResolveDecision
  reason: string
}

/**
 * Resolve a persisted anchor to a current-document target index.
 *
 * Identity rules (per spec — content is NEVER a sole identity):
 * 1. contentSignature + occurrence (1-based) → STRONG when the occurrence-th
 *    same-content same-type target exists. Disambiguates duplicates.
 * 2. contentSignature without occurrence → STRONG only when unique; AMBIGUOUS
 *    otherwise (duplicate content without occurrence is not resolvable).
 * 3. Fallback to ordinal + neighborhood fingerprints (content-independent).
 *    - ordinal + corroborated neighborhood → STRONG
 *    - ordinal only → ORDINAL_ONLY (weak; callers must NOT auto-bind on
 *      rehydrate, only during live-session repair)
 * 4. No candidate → NOT_FOUND.
 */
export function resolveCaptionAnchor(
  anchor: CaptionTargetAnchor,
  descriptors: CaptionAnchorDescriptor[],
): CaptionAnchorResolveResult {
  const sameType = descriptors
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.type === anchor.type)

  // ── Level 1: content signature + occurrence ──
  if (anchor.contentSignature) {
    const matches = sameType.filter(({ d }) => d.contentSignature === anchor.contentSignature)
    if (matches.length > 0) {
      if (anchor.occurrence && anchor.occurrence >= 1) {
        const target = matches[anchor.occurrence - 1]
        if (target) {
          return {
            index: target.i,
            decision: 'STRONG',
            reason: `content signature + occurrence ${anchor.occurrence} corroborated`,
          }
        }
      } else if (matches.length === 1) {
        return {
          index: matches[0].i,
          decision: 'STRONG',
          reason: 'content signature unique',
        }
      } else {
        return {
          index: -1,
          decision: 'AMBIGUOUS',
          reason: 'duplicate content without occurrence — cannot disambiguate',
        }
      }
    }
    // contentSignature present but no match → object content changed or deleted.
    // Fall through to neighborhood/ordinal only if no content match is expected.
  }

  // ── Level 2: ordinal + neighborhood ──
  const ordinalTarget = sameType.find(({ d }) => d.ordinal === anchor.ordinal)
  if (ordinalTarget) {
    const beforeOk = anchor.beforeFingerprint
      ? ordinalTarget.d.beforeFingerprint === anchor.beforeFingerprint
      : null
    const afterOk = anchor.afterFingerprint
      ? ordinalTarget.d.afterFingerprint === anchor.afterFingerprint
      : null

    const hasNeighborhood = anchor.beforeFingerprint !== undefined || anchor.afterFingerprint !== undefined
    const neighborhoodMatches =
      (beforeOk === null || beforeOk === true) && (afterOk === null || afterOk === true)
    const atLeastOneMatch =
      (beforeOk === true) || (afterOk === true)

    if (!hasNeighborhood) {
      return {
        index: ordinalTarget.i,
        decision: 'ORDINAL_ONLY',
        reason: 'ordinal-only fallback (weak anchor)',
      }
    }
    if (neighborhoodMatches && atLeastOneMatch) {
      return {
        index: ordinalTarget.i,
        decision: 'STRONG',
        reason: 'ordinal + neighborhood corroborated',
      }
    }
    return {
      index: -1,
      decision: 'NOT_FOUND',
      reason: 'ordinal matched but neighborhood mismatch',
    }
  }

  return { index: -1, decision: 'NOT_FOUND', reason: 'no same-type target at ordinal' }
}

/** Serialize records for persistence (JSON round-trip safe). */
export function serializeCaptionRecords(documentKey: string, records: CaptionRecord[]): string {
  return JSON.stringify({ documentKey, records: records.map(r => ({ ...r, targetAnchor: { ...r.targetAnchor } })) })
}

/** Deserialize records (strong shape validation; returns [] on any corruption). */
export function deserializeCaptionRecords(json: string, expectedDocumentKey: string): CaptionRecord[] {
  try {
    const parsed = JSON.parse(json) as { documentKey?: string; records?: CaptionRecord[] }
    if (!parsed || parsed.documentKey !== expectedDocumentKey || !Array.isArray(parsed.records)) return []
    return parsed.records
      .filter(r => r && typeof r.captionId === 'string' && typeof r.title === 'string' && r.targetAnchor)
      .map(r => ({ ...r, targetAnchor: { ...r.targetAnchor } }))
  } catch {
    return []
  }
}
