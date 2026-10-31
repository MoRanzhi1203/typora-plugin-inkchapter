/**
 * Paragraph Rehydrate Ownership — PF6 Historical Rebind Closure.
 *
 * The single admission authority for PERSISTED_HISTORICAL indent records that
 * try to re-enter the live editor through a rehydrate pass.
 *
 * Failure it closes (app-1793310238729.log): a historical sidecar record whose
 * anchor has NO `textHash` describes an EMPTY paragraph. Neighbour hashes are
 * NOT an identity proof for an empty paragraph — every freshly created empty
 * paragraph between the same two neighbours matches. Such a record therefore
 * kept re-binding to brand-new empty paragraphs (P-RUNTIME-36/40/42/45/49) and
 * flipping them from `auto` to `force-indent`.
 *
 * Rules (fail closed):
 *   1. A live canonical binding is handled upstream and never reaches here.
 *   2. `temporary` records (created for an empty target) are never re-admitted
 *      heuristically — they are retired from the sidecar instead.
 *   3. An empty target has no business identity → never admitted heuristically.
 *   4. An anchor without `textHash` has no business identity → never admitted.
 *   5. LIVE_EDIT requires exact business-text identity (neighbour-only match is
 *      not enough while the user is actively editing).
 *   6. INITIAL_LOAD may restore a paragraph whose text changed as long as the
 *      stored structural neighbourhood still corroborates.
 *   7. The ONLY way a deleted empty paragraph regains its indent is a controlled
 *      Undo recovery proven by this session's own explicit-deletion ledger.
 */

import {
  evaluateHistoricalRehydrateIdentity,
  hashText,
  type ParagraphIndentOverrideRecord,
} from './paragraph-layout-store'
import { isBlankParagraphText } from './paragraph-indent-manager'

// ── Rehydrate Phase Identity ───────────────────────────────────────────

/**
 * Identity policy for a rehydrate pass.
 *
 * INITIAL_LOAD — document just opened; no user edit in this session yet.
 * LIVE_EDIT    — the user has already edited in this session; new paragraphs
 *                are session-born and can only inherit EXACT identity.
 * UNDO_REDO    — a history navigation is in flight; only ledger-proven
 *                recoveries are honoured.
 */
export type RehydratePhase = 'INITIAL_LOAD' | 'LIVE_EDIT' | 'UNDO_REDO'

// ── Admission ──────────────────────────────────────────────────────────

export type HistoricalAdmissionDecision =
  | 'ADMIT_EXACT_TEXT_IDENTITY'
  | 'ADMIT_INITIAL_LOAD_STRUCTURAL'
  | 'ADMIT_TEMPORARY_EMPTY_STRUCTURAL'
  | 'ADMIT_UNDO_RECOVERY'
  | 'REJECT_TEMPORARY_HISTORICAL'
  | 'REJECT_NO_TARGET'
  | 'REJECT_EMPTY_TARGET'
  | 'REJECT_NO_TEXT_IDENTITY'
  | 'REJECT_NON_EXACT_IDENTITY'
  | 'REJECT_TEXT_ONLY_COLLISION'
  | 'REJECT_AMBIGUOUS_DUPLICATE_TEXT'

export interface HistoricalAdmissionRequest {
  record: ParagraphIndentOverrideRecord
  resolvedConfidence: 'exact' | 'high' | 'medium' | 'fallback'
  resolvedIndex: number
  allParagraphs: HTMLElement[]
  phase: RehydratePhase
  /** True only when the session retirement ledger proved an Undo recovery. */
  undoRecoveryProof?: boolean
}

export interface HistoricalAdmissionResult {
  admitted: boolean
  decision: HistoricalAdmissionDecision
  reason: string
  /** The admission gate's own unique-slot resolution (temporary records). */
  resolvedIndexOverride?: number
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Find the ONE empty paragraph that a temporary record can proveably describe.
 *
 * Temporary records are created for empty targets, which have no text identity.
 * Their only persisted proof is the structural slot: the ordinal plus the
 * hashes of the neighbouring CONTENT paragraphs. The slot is admissible only
 * when exactly ONE empty paragraph in the document matches it. Two or more
 * candidates (e.g. a run of blank lines collapsed/created elsewhere) are
 * ambiguous, and a slot with no empty candidate describes a deleted line — both
 * must fail closed.
 */
export function findUniqueEmptyStructuralSlot(
  record: ParagraphIndentOverrideRecord,
  allParagraphs: HTMLElement[],
): number {
  if (allParagraphs.length === 0) return -1
  const anchor = record.anchor
  const hasNeighbours = anchor.beforeHash !== undefined || anchor.afterHash !== undefined
  const candidates: number[] = []

  for (let i = 0; i < allParagraphs.length; i++) {
    const para = allParagraphs[i]
    if (!para || !isBlankParagraphText(para.textContent ?? '')) continue

    if (!hasNeighbours) {
      // No structural proof at all: only the exact stored ordinal may match.
      if (i === anchor.lastKnownOrdinal) candidates.push(i)
      continue
    }

    if (anchor.beforeHash !== undefined) {
      const prev = i > 0 ? allParagraphs[i - 1] : null
      if (!prev || hashText(normalizeText(prev.textContent ?? '')) !== anchor.beforeHash) continue
    }
    if (anchor.afterHash !== undefined) {
      const next = i < allParagraphs.length - 1 ? allParagraphs[i + 1] : null
      if (!next || hashText(normalizeText(next.textContent ?? '')) !== anchor.afterHash) continue
    }
    candidates.push(i)
  }

  return candidates.length === 1 ? candidates[0] : -1
}

/**
 * Decide whether a PERSISTED_HISTORICAL record may bind to the resolved
 * paragraph. Admission is the ONLY way a historical record becomes a live
 * canonical owner again.
 */
export function evaluateHistoricalRehydrateAdmission(
  req: HistoricalAdmissionRequest,
): HistoricalAdmissionResult {
  const { record, resolvedConfidence, resolvedIndex, allParagraphs, phase } = req

  // 1. Controlled Undo recovery — the only path that restores a deleted target.
  if (req.undoRecoveryProof) {
    return {
      admitted: true,
      decision: 'ADMIT_UNDO_RECOVERY',
      reason: 'session ledger proved this record was removed by an explicit Undo-able deletion',
    }
  }

  // 2. Temporary records describe an EMPTY paragraph. They are re-admitted only
  //    on INITIAL_LOAD and only when the stored structural slot still resolves to
  //    exactly ONE empty paragraph. This is what makes an explicit indent on a
  //    surviving blank line survive save/reopen; a deleted or ambiguous line
  //    still fails closed.
  if (record.temporary === true) {
    if (phase !== 'INITIAL_LOAD') {
      return {
        admitted: false,
        decision: 'REJECT_TEMPORARY_HISTORICAL',
        reason: 'temporary record may only be re-admitted by an initial document load',
      }
    }
    const uniqueIndex = findUniqueEmptyStructuralSlot(record, allParagraphs)
    if (uniqueIndex < 0) {
      return {
        admitted: false,
        decision: 'REJECT_TEMPORARY_HISTORICAL',
        reason: 'temporary record has no unique empty structural slot (deleted or ambiguous)',
      }
    }
    return {
      admitted: true,
      decision: 'ADMIT_TEMPORARY_EMPTY_STRUCTURAL',
      reason: `unique empty structural slot at index ${uniqueIndex}`,
      resolvedIndexOverride: uniqueIndex,
    }
  }

  const target = allParagraphs[resolvedIndex]
  if (!target) {
    return {
      admitted: false,
      decision: 'REJECT_NO_TARGET',
      reason: `no paragraph at resolved index ${resolvedIndex}`,
    }
  }

  // 3. An empty paragraph cannot prove ownership of a persisted explicit indent.
  const targetText = normalizeText(target.textContent ?? '')
  if (!targetText) {
    return {
      admitted: false,
      decision: 'REJECT_EMPTY_TARGET',
      reason: 'empty target paragraph has no business identity',
    }
  }

  // 4. No business identity stored on the anchor at all.
  if (!record.anchor.textHash) {
    return {
      admitted: false,
      decision: 'REJECT_NO_TEXT_IDENTITY',
      reason: 'anchor carries no text identity — position alone is not proof',
    }
  }

  // 5. While editing, only exact business-text identity is proof.
  const textMatches = record.anchor.textHash === hashText(targetText)
  if (phase === 'LIVE_EDIT' && resolvedConfidence !== 'exact') {
    return {
      admitted: false,
      decision: 'REJECT_NON_EXACT_IDENTITY',
      reason: `live edit requires exact text identity (resolved=${resolvedConfidence})`,
    }
  }
  if (phase === 'LIVE_EDIT' && !textMatches) {
    return {
      admitted: false,
      decision: 'REJECT_NON_EXACT_IDENTITY',
      reason: 'live edit target text does not match the stored identity',
    }
  }

  // 6. Structural identity gate (duplicate text / neighbourhood mismatch).
  const identity = evaluateHistoricalRehydrateIdentity(
    record.anchor,
    resolvedIndex,
    allParagraphs,
  )
  if (identity.decision !== 'ACCEPT_STRONG_IDENTITY') {
    return {
      admitted: false,
      decision: identity.decision,
      reason: identity.reason,
    }
  }

  if (textMatches) {
    return {
      admitted: true,
      decision: 'ADMIT_EXACT_TEXT_IDENTITY',
      reason: identity.reason,
    }
  }

  // 7. INITIAL_LOAD only: text changed but the structural neighbourhood still
  //    corroborates. Never admissible during a live edit.
  return {
    admitted: true,
    decision: 'ADMIT_INITIAL_LOAD_STRUCTURAL',
    reason: `initial load structural corroboration (${identity.reason})`,
  }
}

// ── Sidecar Lifecycle: temporary historical retirement ─────────────────

/**
 * Temporary records describe an EMPTY paragraph. On load they must be retired
 * only when their structural slot no longer resolves to exactly one empty
 * paragraph (deleted line / ambiguous run). A surviving unique slot keeps the
 * record so the explicit indent survives save/reopen.
 *
 * When `allParagraphs` is not supplied the legacy caller has no document view,
 * so every temporary record is retired (fail closed).
 */
export function selectTemporaryHistoricalRecordsForRetirement(
  records: ParagraphIndentOverrideRecord[],
  allParagraphs?: HTMLElement[] | null,
): string[] {
  const temps = records.filter(r => r.temporary === true)
  if (!allParagraphs || allParagraphs.length === 0) return temps.map(r => r.id)
  return temps
    .filter(r => findUniqueEmptyStructuralSlot(r, allParagraphs) < 0)
    .map(r => r.id)
}

// ── Session Retirement Ledger (Undo/Redo controlled recovery) ──────────

/** How long a retired record stays eligible for a controlled Undo recovery. */
export const RETIRED_INDENT_LEDGER_TTL_MS = 60_000

/** How long after a history-navigation intent a recovery claim is accepted. */
export const HISTORY_UNDO_CLAIM_WINDOW_MS = 3_000

/** Bound on retained entries per session. */
export const RETIRED_INDENT_LEDGER_MAX_ENTRIES = 20

export interface RetiredIndentRecordEntry {
  recordId: string
  record: ParagraphIndentOverrideRecord
  documentKey: string
  deletedAt: number
  ordinal: number
  beforeHash?: string
  afterHash?: string
  /** True when the deleted paragraph was pure blank. */
  targetWasEmpty: boolean
}

export type HistoryIntentKind = 'undo' | 'redo'

export interface UndoRecoveryClaim {
  entry: RetiredIndentRecordEntry
  matchedIndex: number
}

/**
 * Session-scoped ledger of indent records retired by an EXPLICIT paragraph
 * deletion. Never persisted: a restarted session has no Undo proof, so it must
 * never revive a retired record.
 */
export class SessionRetiredIndentLedger {
  private entries: RetiredIndentRecordEntry[] = []
  private historyIntent: { kind: HistoryIntentKind; at: number } | null = null

  retire(entry: RetiredIndentRecordEntry): void {
    this.entries = this.entries.filter(e => e.recordId !== entry.recordId)
    this.entries.push({ ...entry, record: { ...entry.record, anchor: { ...entry.record.anchor } } })
    if (this.entries.length > RETIRED_INDENT_LEDGER_MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - RETIRED_INDENT_LEDGER_MAX_ENTRIES)
    }
  }

  /** Record a history-navigation key intent (Ctrl+Z / Ctrl+Shift+Z). */
  noteHistoryIntent(kind: HistoryIntentKind, now = Date.now()): void {
    this.historyIntent = { kind, at: now }
  }

  /**
   * Any genuine content edit invalidates a pending recovery claim.
   *
   * Exception: the native replay of an Undo emits its own `beforeinput`
   * (`deleteContentBackward`) inside the history window. That is the recovery
   * itself, not a new edit, so the just-recorded intent survives.
   */
  invalidateOnContentEdit(now = Date.now()): void {
    if (
      this.historyIntent !== null &&
      now - this.historyIntent.at <= HISTORY_UNDO_CLAIM_WINDOW_MS
    ) {
      return
    }
    this.historyIntent = null
  }

  clearDocument(documentKey: string): void {
    this.entries = this.entries.filter(e => e.documentKey !== documentKey)
  }

  /** Drop entries older than the TTL. */
  expire(now = Date.now()): void {
    this.entries = this.entries.filter(e => now - e.deletedAt <= RETIRED_INDENT_LEDGER_TTL_MS)
  }

  get size(): number {
    return this.entries.length
  }

  /** Read-only snapshot for diagnostics. */
  snapshot(): RetiredIndentRecordEntry[] {
    return this.entries.map(e => ({ ...e, record: { ...e.record, anchor: { ...e.record.anchor } } }))
  }

  /**
   * Claim the single ledger entry that an Undo just restored.
   *
   * Requirements — ALL must hold, otherwise no claim:
   *  - an Undo intent was recorded within HISTORY_UNDO_CLAIM_WINDOW_MS;
   *  - an entry exists for this document that is still within TTL;
   *  - a paragraph now occupies the recorded slot and its neighbours still
   *    match the recorded structural neighbourhood;
   *  - the paragraph's text identity matches (empty ↔ targetWasEmpty).
   *
   * A successful claim consumes both the entry and the Undo intent, so a Redo
   * (which deletes the paragraph again) re-arms a fresh entry instead of being
   * silently undone a second time.
   */
  claimUndoRecovery(
    documentKey: string,
    allParagraphs: HTMLElement[],
    now = Date.now(),
  ): UndoRecoveryClaim | null {
    this.expire(now)

    if (!this.historyIntent || this.historyIntent.kind !== 'undo') return null
    if (now - this.historyIntent.at > HISTORY_UNDO_CLAIM_WINDOW_MS) return null

    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]
      if (entry.documentKey !== documentKey) continue
      const matchedIndex = findUndoRestoredSlot(entry, allParagraphs)
      if (matchedIndex < 0) continue

      this.entries.splice(i, 1)
      this.historyIntent = null
      return { entry, matchedIndex }
    }
    return null
  }
}

function findUndoRestoredSlot(
  entry: RetiredIndentRecordEntry,
  allParagraphs: HTMLElement[],
): number {
  const candidates: number[] = []
  if (entry.ordinal >= 0 && entry.ordinal < allParagraphs.length) {
    candidates.push(entry.ordinal)
  }
  for (let i = 0; i < allParagraphs.length; i++) {
    if (i !== entry.ordinal) candidates.push(i)
  }

  for (const idx of candidates) {
    const para = allParagraphs[idx]
    if (!para) continue

    const beforePara = idx > 0 ? allParagraphs[idx - 1] : null
    const afterPara = idx < allParagraphs.length - 1 ? allParagraphs[idx + 1] : null
    const beforeMatches = entry.beforeHash === undefined || (
      beforePara !== null && hashText(normalizeText(beforePara.textContent ?? '')) === entry.beforeHash
    )
    const afterMatches = entry.afterHash === undefined || (
      afterPara !== null && hashText(normalizeText(afterPara.textContent ?? '')) === entry.afterHash
    )
    if (!beforeMatches || !afterMatches) continue

    const text = normalizeText(para.textContent ?? '')
    if (entry.targetWasEmpty) {
      if (text === '') return idx
    } else if (entry.record.anchor.textHash && hashText(text) === entry.record.anchor.textHash) {
      return idx
    }
  }
  return -1
}
