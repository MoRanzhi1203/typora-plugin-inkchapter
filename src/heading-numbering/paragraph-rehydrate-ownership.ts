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
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
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

  // 1. Controlled Undo recovery — the only path that can restore an empty target.
  if (req.undoRecoveryProof) {
    return {
      admitted: true,
      decision: 'ADMIT_UNDO_RECOVERY',
      reason: 'session ledger proved this record was removed by an explicit Undo-able deletion',
    }
  }

  // 2. Records created for an empty target never regain heuristic write access.
  if (record.temporary === true) {
    return {
      admitted: false,
      decision: 'REJECT_TEMPORARY_HISTORICAL',
      reason: 'temporary historical record has no transferable business identity',
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
 * Temporary records describe an EMPTY paragraph, which has no business
 * identity. They cannot be rebound safely and must be retired from the sidecar
 * so they can never poison a new empty paragraph. Business records are kept.
 */
export function selectTemporaryHistoricalRecordsForRetirement(
  records: ParagraphIndentOverrideRecord[],
): string[] {
  return records.filter(r => r.temporary === true).map(r => r.id)
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
