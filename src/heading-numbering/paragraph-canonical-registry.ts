/**
 * Paragraph Canonical Registry — authoritative source for paragraph indent record identity.
 *
 * Responsibilities:
 * 1. Canonical record ID ownership (CanonicalRecordId = 唯一业务身份)
 * 2. Runtime lifecycle state machine (CURRENT_LIVE / AWAITING_TRANSFER / RETIRED / PERSISTED_HISTORICAL)
 * 3. Element ↔ recordId binding (one-to-one)
 * 4. runtimeId ↔ recordId binding (one-to-one)
 * 5. Session origin tracking
 * 6. Binding transfer (DOM replacement → same canonicalRecordId)
 * 7. Promotion (temporary → stable, same recordId)
 * 8. Mutation intent validation (Backspace MUST NOT CREATE_NEW)
 * 9. R58.5: LiveOwnershipProof + generation lease
 * 10. R58.5: LiveReplacementTicket for generic DOM replacement continuity
 *
 * Architecture Rule:
 *   no live binding != historical record
 *   CURRENT_SESSION record MUST NOT enter persistent heuristic resolver.
 */

import type { ParagraphIndentOverrideRecord } from './paragraph-layout-store'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

// ── R58.5: LiveOwnershipProof ─────────────────────────────────────────

/**
 * Live ownership lease proof.
 *
 * NOT a persistent identity. Represents:
 * "At generation N, HTMLElement E / runtimeId R is confirmed as
 *  the current live owner of canonical record C."
 *
 * All live mutations (Promotion, Backspace, UI Update) MUST carry valid proof.
 * Proof is invalidated on any transfer (generation++).
 */
export interface LiveOwnershipProof {
  recordId: string
  documentKey: string
  runtimeId: string
  element: HTMLElement
  generation: number
}

// ── R58.5: LiveReplacementTicket ─────────────────────────────────────

/**
 * Current-session DOM replacement continuity ticket.
 *
 * Created when MutationObserver detects a CURRENT_LIVE bound element
 * has been removed. Carries enough DOM continuity evidence to find
 * the replacement paragraph in the same mutation batch.
 *
 * NEVER persisted. Only serves current-session live continuity.
 */
export interface LiveReplacementTicket {
  ticketId: string
  recordId: string
  documentKey: string
  /** R58.7 Phase A.1.3.1a: Runtime scope identity for cross-scope guard. */
  scopeId: string
  previousElement: HTMLElement
  previousRuntimeId: string
  previousGeneration: number
  parentElement?: HTMLElement
  previousOrdinal?: number
  /** Child index within parent at removal time, if known. */
  childIndex?: number  
  semanticMode: string
  createdAt: number
  source: 'COMMAND_HANDOFF' | 'MUTATION_OBSERVER'
}

/** Result of live replacement resolution. */
export type ReplacementResolution =
  | { decision: 'TRANSFER'; replacement: HTMLElement; replacementRuntimeId: string; evidence: string[] }
  | { decision: 'PENDING'; reason: string; candidateCount: number }
  | { decision: 'BLOCK'; reason: string; candidateCount: number }

// ── Lifecycle State Machine ──────────────────────────────────────────

/**
 * Canonical runtime lifecycle state.
 *
 * CURRENT_LIVE           — active binding, element connected, can be mutated
 * CURRENT_AWAITING_TRANSFER — element disconnected, awaiting replacement resolution
 * CURRENT_RETIRED        — explicitly retired, kept for audit only
 * PERSISTED_HISTORICAL   — loaded from physical sidecar, NOT created in this session
 */
export type CanonicalRuntimeState =
  | 'CURRENT_LIVE'
  | 'CURRENT_AWAITING_TRANSFER'
  | 'CURRENT_RETIRED'
  | 'PERSISTED_HISTORICAL'

// ── Mutation Intent ──────────────────────────────────────────────────

/**
 * Explicit mutation intent — each maps to exactly one API.
 *
 * ENTER_CREATE      — Enter token → create record (only CREATE_NEW path)
 * BACKSPACE_UPDATE  — Backspace → MUST update existing, BLOCK if no identity
 * PROMOTE           — temporary → stable promotion by recordId
 * UI_UPDATE         — explicit UI command → update existing only
 * TRANSFER_BINDING  — handoff → transfer canonical binding
 * EXPLICIT_RETIRE   — explicit retirement with known cause
 * HISTORICAL_REPAIR — anchor repair for PERSISTED_HISTORICAL only
 */
export type CanonicalMutationIntent =
  | 'ENTER_CREATE'
  | 'BACKSPACE_UPDATE'
  | 'PROMOTE'
  | 'UI_UPDATE'
  | 'TRANSFER_BINDING'
  | 'EXPLICIT_RETIRE'
  | 'HISTORICAL_REPAIR'

/**
 * Deterministic retirement reason — must be an explicit event, never timing-based.
 */
export type CanonicalRetireReason =
  | 'DOCUMENT_SWITCH'
  | 'DOCUMENT_CLOSE'
  | 'EDITOR_DISPOSE'
  | 'EXPLICIT_PARAGRAPH_DELETE'
  | 'COMMAND_CANCEL_CONFIRMED'

// ── Unified Mutation Result ──────────────────────────────────────────

export type CanonicalMutationResult = {
  ok: true
  recordId: string
  intent: CanonicalMutationIntent
  stateBefore: CanonicalRuntimeState
  stateAfter: CanonicalRuntimeState
  recordCountBefore: number
  recordCountAfter: number
} | {
  ok: false
  recordId?: string
  intent: CanonicalMutationIntent
  reason:
    | 'INVALID_LIFECYCLE_STATE'
    | 'DOCUMENT_MISMATCH'
    | 'RUNTIME_MISMATCH'
    | 'ELEMENT_MISMATCH'
    | 'ELEMENT_DISCONNECTED'
    | 'RECORD_MISSING'
    | 'BINDING_COLLISION'
    | 'INVALID_TRANSITION'
    | 'NOT_TEMPORARY'
}

// ── Candidate Source ─────────────────────────────────────────────────

export type CandidateSource =
  | 'LIVE'
  | 'PERSISTENT'
  | 'LEGACY'
  | 'NONE'

// ── Runtime Metadata ─────────────────────────────────────────────────

export interface CanonicalRuntimeMeta {
  /** Canonical record identity (matches ParagraphIndentOverrideRecord.id). */
  recordId: string
  /** Document scope key (DEPRECATED: use scopeId for current-session identity). */
  documentKey: string
  /** R58.7 Phase A.1.3.1a: Runtime scope identity (current-session authority). */
  scopeId: string
  /** R58.7 Phase A.1.3.1a: Persistence namespace key (null for EPHEMERAL). */
  persistenceKey: string | null

  /** Current lifecycle state. */
  state: CanonicalRuntimeState

  /** Session ID that created this record. */
  sessionId: string
  /** Monotonically increasing binding generation. */
  generation: number

  /** Current live element (only valid in CURRENT_LIVE state). */
  currentElement?: HTMLElement
  /** Current runtime object-identity ID (only valid in CURRENT_LIVE state). */
  currentRuntimeId?: string

  /** Previous element/runtimeId before transfer (for audit). */
  previousElement?: HTMLElement
  previousRuntimeId?: string

  /** R58.3: Awaiting-transfer terminal policy metadata. */
  awaitingSince?: number
  handoffId?: string
  handoffGeneration?: number
  awaitingReason?: string

  /** True if record content is provisional (empty paragraph). Separated from session ownership. */
  temporary: boolean

  /** Creation timestamp (epoch ms). */
  createdAt: number
  /** Last mutation timestamp (epoch ms). */
  updatedAt: number

  /** Origin: 'current-session' or 'persisted-load'. */
  origin: 'current-session' | 'persisted-load'
}

// ── Binding Transfer Result ──────────────────────────────────────────

export interface CanonicalBindingTransferResult {
  success: boolean
  canonicalRecordId: string
  fromRuntimeId: string
  toRuntimeId: string
  stateBefore: CanonicalRuntimeState
  stateAfter: CanonicalRuntimeState
  generationBefore: number
  generationAfter: number
  oldOwnerInvalidated: boolean
  newOwnerEstablished: boolean
  recordCountBefore: number
  recordCountAfter: number
  failReason?: string
}

// ── Registry ─────────────────────────────────────────────────────────

export class ParagraphCanonicalRegistry {
  /** Session identity — set once on construction. */
  readonly sessionId: string

  /** All runtime metadata keyed by canonical recordId. */
  private runtimeMetaByRecordId = new Map<string, CanonicalRuntimeMeta>()

  /** Element → recordId (WeakMap — element GC = binding automatically released). */
  private recordIdByElement = new WeakMap<HTMLElement, string>()

  /** runtimeId → recordId. */
  private recordIdByRuntimeId = new Map<string, string>()

  /** Record storage reference (owned by service, exposed for rehydrate). */
  private recordsById = new Map<string, ParagraphIndentOverrideRecord>()

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  // ── Lifecycle State Transitions ─────────────────────────────────────

  /**
   * Register a newly created current-session canonical record.
   * Called by Enter transaction ONLY.
   */
  registerCurrentSessionRecord(
    record: ParagraphIndentOverrideRecord,
    documentKey: string,
    element: HTMLElement,
    runtimeId: string,
    temporary: boolean,
    scopeId?: string,
    persistenceKey?: string | null,
  ): CanonicalRuntimeMeta {
    // Collision check: one runtime → max one record
    const existingByRt = this.recordIdByRuntimeId.get(runtimeId)
    if (existingByRt && existingByRt !== record.id) {
      this.emitDiagnostic('LIVE-BINDING-COLLISION', {
        recordId: record.id,
        existingRecordId: existingByRt,
        runtimeId,
        reason: 'one runtime → two records',
      })
      // BLOCK: do not register
      throw new Error(`LIVE-BINDING-COLLISION: runtimeId=${runtimeId} already bound to recordId=${existingByRt}`)
    }

    // Collision check: one record → max one live owner
    const existingMeta = this.runtimeMetaByRecordId.get(record.id)
    if (existingMeta && existingMeta.state === 'CURRENT_LIVE') {
      this.emitDiagnostic('LIVE-BINDING-COLLISION', {
        recordId: record.id,
        existingRuntimeId: existingMeta.currentRuntimeId,
        newRuntimeId: runtimeId,
        reason: 'one record → two live owners',
      })
      throw new Error(`LIVE-BINDING-COLLISION: recordId=${record.id} already has live owner runtimeId=${existingMeta.currentRuntimeId}`)
    }

    const meta: CanonicalRuntimeMeta = {
      recordId: record.id,
      documentKey,
      scopeId: scopeId || documentKey,
      persistenceKey: persistenceKey !== undefined ? persistenceKey : (documentKey || null),
      state: 'CURRENT_LIVE',
      sessionId: this.sessionId,
      generation: (existingMeta?.generation ?? 0) + 1,
      currentElement: element,
      currentRuntimeId: runtimeId,
      temporary,
      createdAt: existingMeta?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      origin: 'current-session',
    }

    this.runtimeMetaByRecordId.set(record.id, meta)
    this.recordIdByElement.set(element, record.id)
    this.recordIdByRuntimeId.set(runtimeId, record.id)
    this.recordsById.set(record.id, record)

    this.emitLifecycle(record.id, 'REGISTER_CURRENT', meta, runtimeId)
    return meta
  }

  /**
   * Register a PERSISTED_HISTORICAL record loaded from physical sidecar.
   * MUST be called after loadParagraphLayout / reconstructParagraphOverridesFromSidecar.
   */
  registerPersistedHistorical(
    record: ParagraphIndentOverrideRecord,
    documentKey: string,
  ): CanonicalRuntimeMeta {
    const existing = this.runtimeMetaByRecordId.get(record.id)
    if (existing) {
      // Already registered — update if needed
      if (existing.state !== 'PERSISTED_HISTORICAL') {
        existing.state = 'PERSISTED_HISTORICAL'
        existing.origin = 'persisted-load'
        existing.documentKey = documentKey
        existing.updatedAt = Date.now()
      }
      return existing
    }

    const meta: CanonicalRuntimeMeta = {
      recordId: record.id,
      documentKey,
      scopeId: documentKey,       // PERSISTED_HISTORICAL uses documentKey as scopeId
      persistenceKey: documentKey, // PERSISTED_HISTORICAL has persistence key
      state: 'PERSISTED_HISTORICAL',
      sessionId: this.sessionId, // loaded IN this session but origin distinguishes
      generation: 0,
      temporary: record.temporary ?? false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      origin: 'persisted-load',
    }

    this.runtimeMetaByRecordId.set(record.id, meta)
    this.recordsById.set(record.id, record)

    this.emitLifecycle(record.id, 'PERSISTED_LOAD', meta, undefined)
    return meta
  }

  /**
   * Transition: CURRENT_LIVE → CURRENT_AWAITING_TRANSFER.
   * Called when current live element is detected as disconnected (DOM replacement).
   *
   * R58.7 Phase A.1.3.1a: operationScopeId is required for scope authorization.
   */
  markAwaitingTransfer(recordId: string, handoffId?: string, reason?: string, operationScopeId?: string): boolean {
    const meta = this.runtimeMetaByRecordId.get(recordId)
    if (!meta) return false
    if (meta.state !== 'CURRENT_LIVE') return false

    // R58.7: Cross-scope mutation firewall
    if (operationScopeId && !this.assertCanonicalScope(
      meta.scopeId, operationScopeId, 'AWAIT', recordId,
    )) {
      return false
    }

    meta.previousElement = meta.currentElement
    meta.previousRuntimeId = meta.currentRuntimeId
    meta.state = 'CURRENT_AWAITING_TRANSFER'
    meta.awaitingSince = Date.now()
    meta.handoffId = handoffId
    meta.awaitingReason = reason ?? 'element-disconnected'
    meta.updatedAt = Date.now()

    // Clear element/runtime bindings (element is disconnected)
    if (meta.currentElement) {
      this.recordIdByElement.delete(meta.currentElement)
    }
    if (meta.currentRuntimeId) {
      this.recordIdByRuntimeId.delete(meta.currentRuntimeId)
    }
    meta.currentElement = undefined
    meta.currentRuntimeId = undefined

    this.emitLifecycle(recordId, 'AWAIT_TRANSFER', meta, undefined)
    return true
  }

  /**
   * Transfer canonical binding: old element → new element, SAME recordId.
   *
   * Validates:
   * - record exists
   * - state is CURRENT_AWAITING_TRANSFER
   * - new element not already bound
   * - old owner invalidated
   *
   * Returns detailed transfer result.
   *
   * R58.7 Phase A.1.3.1a: operationScopeId is required for scope authorization.
   */
  transferCanonicalBinding(
    recordId: string,
    toElement: HTMLElement,
    toRuntimeId: string,
    reason: string,
    operationScopeId?: string,
  ): CanonicalBindingTransferResult {
    const meta = this.runtimeMetaByRecordId.get(recordId)
    const recordCountBefore = this.runtimeMetaByRecordId.size

    const baseResult: CanonicalBindingTransferResult = {
      success: false,
      canonicalRecordId: recordId,
      fromRuntimeId: meta?.previousRuntimeId ?? 'unknown',
      toRuntimeId,
      stateBefore: meta?.state ?? 'CURRENT_RETIRED',
      stateAfter: meta?.state ?? 'CURRENT_RETIRED',
      generationBefore: meta?.generation ?? 0,
      generationAfter: meta?.generation ?? 0,
      oldOwnerInvalidated: false,
      newOwnerEstablished: false,
      recordCountBefore,
      recordCountAfter: recordCountBefore,
    }

    if (!meta) {
      baseResult.failReason = 'record-not-found'
      return baseResult
    }

    // R58.7: Cross-scope mutation firewall
    if (operationScopeId && !this.assertCanonicalScope(
      meta.scopeId, operationScopeId, 'TRANSFER', recordId,
    )) {
      baseResult.failReason = 'scope-mismatch'
      return baseResult
    }

    if (meta.state !== 'CURRENT_AWAITING_TRANSFER') {
      baseResult.failReason = `invalid-state: ${meta.state} (expected CURRENT_AWAITING_TRANSFER)`
      return baseResult
    }

    // Collision: new element already bound to another record
    const existingByElement = this.recordIdByElement.get(toElement)
    if (existingByElement && existingByElement !== recordId) {
      baseResult.failReason = `element-collision: already bound to recordId=${existingByElement}`
      return baseResult
    }

    // Collision: new runtimeId already bound to another record
    const existingByRt = this.recordIdByRuntimeId.get(toRuntimeId)
    if (existingByRt && existingByRt !== recordId) {
      baseResult.failReason = `runtime-collision: already bound to recordId=${existingByRt}`
      return baseResult
    }

    // ── R58.3: Preserve transfer lineage ──
    // previousRuntimeId was saved in markAwaitingTransfer — DO NOT overwrite
    const fromRuntimeId = meta.previousRuntimeId ?? 'unknown'
    const generationBefore = meta.generation

    // Hard invariant: fromRuntimeId must be known
    if (fromRuntimeId === 'unknown') {
      baseResult.failReason = 'TRANSFER-LINEAGE-INVARIANT-VIOLATION: fromRuntimeId=unknown — transfer blocked'
      console.error(
        `[InkChapter] TRANSFER-LINEAGE-INVARIANT-VIOLATION: ` +
        `recordId=${recordId} fromRuntimeId=unknown ` +
        `state=${meta.state} ACTION=HARD_STOP`,
      )
      return baseResult
    }

    meta.currentElement = toElement
    meta.currentRuntimeId = toRuntimeId
    meta.generation = generationBefore + 1
    meta.state = 'CURRENT_LIVE'
    meta.updatedAt = Date.now()
    // Keep previousRuntimeId as audit trail — do NOT clear

    // Establish new bindings
    this.recordIdByElement.set(toElement, recordId)
    this.recordIdByRuntimeId.set(toRuntimeId, recordId)

    this.emitLifecycle(recordId, 'TRANSFER', meta, toRuntimeId)

    const recordCountAfter = this.runtimeMetaByRecordId.size

    return {
      success: true,
      canonicalRecordId: recordId,
      fromRuntimeId,
      toRuntimeId,
      stateBefore: 'CURRENT_AWAITING_TRANSFER',
      stateAfter: 'CURRENT_LIVE',
      generationBefore,
      generationAfter: meta.generation,
      oldOwnerInvalidated: true,
      newOwnerEstablished: true,
      recordCountBefore,
      recordCountAfter,
    }
  }

  /**
   * Retire a record — move to CURRENT_RETIRED.
   * Does NOT remove from persistent storage; only marks runtime lifecycle.
   *
   * R58.4: ONLY accepts explicit CanonicalRetireReason.
   * PREMATURE-RETIREMENT-VIOLATION on any non-explicit reason.
   * R58.7: operationScopeId is required for scope authorization.
   */
  retireRecord(recordId: string, reason: string, retireReason?: CanonicalRetireReason, operationScopeId?: string): boolean {
    const meta = this.runtimeMetaByRecordId.get(recordId)
    if (!meta) return false

    // R58.7: Cross-scope mutation firewall
    if (operationScopeId && !this.assertCanonicalScope(
      meta.scopeId, operationScopeId, 'RETIRE', recordId,
    )) {
      return false
    }

    // ── R58.4: Premature retirement gate ──
    const validRetireReasons: CanonicalRetireReason[] = [
      'DOCUMENT_SWITCH', 'DOCUMENT_CLOSE', 'EDITOR_DISPOSE',
      'EXPLICIT_PARAGRAPH_DELETE', 'COMMAND_CANCEL_CONFIRMED',
    ]
    if (!retireReason || !validRetireReasons.includes(retireReason)) {
      console.error(
        `[InkChapter] PREMATURE-RETIREMENT-VIOLATION: ` +
        `recordId=${recordId} ` +
        `state=${meta.state} ` +
        `retireReason=${retireReason ?? 'none'} ` +
        `ACTION=HARD_STOP`,
      )
      return false
    }

    // Clear bindings
    if (meta.currentElement) {
      this.recordIdByElement.delete(meta.currentElement)
    }
    if (meta.currentRuntimeId) {
      this.recordIdByRuntimeId.delete(meta.currentRuntimeId)
    }

    meta.state = 'CURRENT_RETIRED'
    meta.currentElement = undefined
    meta.currentRuntimeId = undefined
    meta.updatedAt = Date.now()

    this.emitLifecycle(recordId, 'RETIRE', meta, undefined)
    return true
  }

  // ── R58.4: Unified Mutation Firewall ─────────────────────────────

  /** Mutation matrix: which states allow which intents. */
  private static readonly MUTATION_MATRIX: Record<CanonicalRuntimeState, Partial<Record<CanonicalMutationIntent, boolean>>> = {
    'CURRENT_LIVE': {
      'ENTER_CREATE': true,
      'BACKSPACE_UPDATE': true,
      'PROMOTE': true,
      'UI_UPDATE': true,
      'TRANSFER_BINDING': true,
      'EXPLICIT_RETIRE': true,
    },
    'CURRENT_AWAITING_TRANSFER': {
      'ENTER_CREATE': false,
      'BACKSPACE_UPDATE': false,
      'PROMOTE': false,
      'UI_UPDATE': false,
      'TRANSFER_BINDING': true,  // Only transfer is allowed
      'EXPLICIT_RETIRE': true,
    },
    'CURRENT_RETIRED': {
      'ENTER_CREATE': false,
      'BACKSPACE_UPDATE': false,
      'PROMOTE': false,
      'UI_UPDATE': false,
      'TRANSFER_BINDING': false,
      'EXPLICIT_RETIRE': false,  // Already retired
      'HISTORICAL_REPAIR': false,
    },
    'PERSISTED_HISTORICAL': {
      'ENTER_CREATE': false,
      'BACKSPACE_UPDATE': false,
      'PROMOTE': false,
      'UI_UPDATE': false,
      'TRANSFER_BINDING': false,
      'EXPLICIT_RETIRE': false,
      'HISTORICAL_REPAIR': true,
    },
  }

  /**
   * Validate that a record's lifecycle state allows the requested mutation.
   * Emits CANONICAL-MUTATION-BLOCK if blocked.
   * Emits LIFECYCLE-TRANSITION-VIOLATION if an invalid transition is attempted.
   */
  validateMutation(
    recordId: string,
    intent: CanonicalMutationIntent,
    expectedState?: CanonicalRuntimeState,
    verifiedDocumentKey?: string,
    verifiedRuntimeId?: string,
    verifiedElement?: HTMLElement,
    verifiedScopeId?: string,
  ): CanonicalMutationResult {
    const meta = this.runtimeMetaByRecordId.get(recordId)
    const recordCountBefore = this.runtimeMetaByRecordId.size

    const block = (reason: CanonicalMutationResult extends { ok: false } ? CanonicalMutationResult['reason'] : string): CanonicalMutationResult => ({
      ok: false,
      recordId,
      intent,
      reason: reason as any,
    })

    if (!meta) {
      return block('RECORD_MISSING')
    }

    // R58.7: Cross-scope mutation firewall — scope check BEFORE documentKey
    if (verifiedScopeId && !this.assertCanonicalScope(
      meta.scopeId, verifiedScopeId, intent, recordId,
    )) {
      return block('DOCUMENT_MISMATCH' as any)
    }

    // ── Document key check ──
    if (verifiedDocumentKey && meta.documentKey !== verifiedDocumentKey) {
      return block('DOCUMENT_MISMATCH')
    }

    // ── Runtime ID check ──
    if (verifiedRuntimeId && meta.currentRuntimeId !== verifiedRuntimeId) {
      return block('RUNTIME_MISMATCH')
    }

    // ── Element check ──
    if (verifiedElement) {
      if (meta.currentElement !== verifiedElement) {
        return block('ELEMENT_MISMATCH')
      }
      if (!verifiedElement.isConnected) {
        return block('ELEMENT_DISCONNECTED')
      }
    }

    // ── Lifecycle state check ──
    const allowed = ParagraphCanonicalRegistry.MUTATION_MATRIX[meta.state]?.[intent]
    if (allowed !== true) {
      console.error(
        `[InkChapter] CANONICAL-MUTATION-BLOCK: ` +
        `recordId=${recordId} ` +
        `intent=${intent} ` +
        `state=${meta.state} ` +
        `reason=INVALID_LIFECYCLE_STATE ` +
        `ACTION=BLOCK`,
      )
      return block('INVALID_LIFECYCLE_STATE')
    }

    // ── Expected state check ──
    if (expectedState && meta.state !== expectedState) {
      console.error(
        `[InkChapter] LIFECYCLE-TRANSITION-VIOLATION: ` +
        `recordId=${recordId} ` +
        `expectedFrom=${expectedState} ` +
        `actualFrom=${meta.state} ` +
        `requestedTo=${intent} ` +
        `documentKey=${meta.documentKey} ` +
        `runtimeId=${meta.currentRuntimeId ?? 'none'} ` +
        `ACTION=HARD_STOP`,
      )
      return block('INVALID_TRANSITION')
    }

    return {
      ok: true,
      recordId,
      intent,
      stateBefore: meta.state,
      stateAfter: meta.state,
      recordCountBefore,
      recordCountAfter: recordCountBefore,
    }
  }

  // ── R58.4: Awaiting-Transfer Audit Only (NO auto-retirement) ──────

  /**
   * Audit all CURRENT_AWAITING_TRANSFER records.
   * Emits CANONICAL-TRANSFER-PENDING for each awaiting record.
   * Emits AWAITING-TRANSFER-LEAK-AUDIT summarizing state.
   *
   * NEVER retires records. Retirement requires an explicit event
   * (DOCUMENT_SWITCH, DOCUMENT_CLOSE, etc.) — never timeout alone.
   */
  auditAwaitingTransferRecords(activeHandoffIds: Set<string> = new Set()): void {
    const now = Date.now()
    let pendingCount = 0
    let oldestAwaitingMs = 0
    const pendingRecordIds: string[] = []

    for (const [, meta] of this.runtimeMetaByRecordId) {
      if (meta.state !== 'CURRENT_AWAITING_TRANSFER') continue

      const awaitingMs = now - (meta.awaitingSince ?? meta.updatedAt)
      if (awaitingMs > oldestAwaitingMs) oldestAwaitingMs = awaitingMs

      pendingCount++
      pendingRecordIds.push(meta.recordId)

      const hasActiveHandoff = meta.handoffId && activeHandoffIds.has(meta.handoffId)
      const reason = hasActiveHandoff ? 'handoff-still-active' : 'within-ttl-no-handoff'

      console.info(
        `[InkChapter] CANONICAL-TRANSFER-PENDING: ` +
        `recordId=${meta.recordId} ` +
        `previousRuntimeId=${meta.previousRuntimeId ?? 'none'} ` +
        `documentKey=${meta.documentKey} ` +
        `handoffId=${meta.handoffId ?? 'none'} ` +
        `awaitingSince=${meta.awaitingSince} ` +
        `awaitingForMs=${awaitingMs} ` +
        `activeHandoff=${hasActiveHandoff} ` +
        `candidateCount=0 ` +
        `reason=${reason}`,
      )
    }

    // ── AWAITING-TRANSFER-LEAK-AUDIT (diagnostic only, no mutation) ──
    emitRuntimeAudit('AWAITING-TRANSFER-LEAK-AUDIT', {
      awaitingCount: pendingCount,
      oldestAwaitingMs,
      recordIds: `[${pendingRecordIds.join(',')}]`,
      activeHandoffCount: activeHandoffIds.size,
    })
  }

  /**
   * @deprecated R58.4: Use auditAwaitingTransferRecords() instead.
   * This method MUST NOT retire records — retirement requires explicit evidence.
   */
  sweepStaleAwaitingRecords(_activeHandoffIds: Set<string> = new Set()): number {
    this.auditAwaitingTransferRecords(_activeHandoffIds)
    return 0 // No retirements — audit only
  }

  /** Get current count of records in CURRENT_AWAITING_TRANSFER state. */
  getAwaitingCount(): number {
    let count = 0
    for (const [, meta] of this.runtimeMetaByRecordId) {
      if (meta.state === 'CURRENT_AWAITING_TRANSFER') count++
    }
    return count
  }

  /** Get active (not retired, not historical) record count. */
  getActiveRecordCount(): number {
    let count = 0
    for (const [, meta] of this.runtimeMetaByRecordId) {
      if (meta.state === 'CURRENT_LIVE' || meta.state === 'CURRENT_AWAITING_TRANSFER') count++
    }
    return count
  }

  // ── Promotion ───────────────────────────────────────────────────────

  /**
   * R58.4: Promote a temporary record to stable by recordId — with full lifecycle validation.
   *
   * REQUIRES:
   *   state === CURRENT_LIVE
   *   runtimeId matches
   *   element matches
   *   element.isConnected === true
   *   documentKey matches
   *   temporary === true
   *
   * Only: same recordId, temporary true→false, recordCount unchanged, binding retained.
   */
  promoteExistingByRecordId(
    recordId: string,
    verifiedRuntimeId?: string,
    verifiedElement?: HTMLElement,
    verifiedDocumentKey?: string,
    verifiedScopeId?: string,
  ): CanonicalMutationResult {
    const meta = this.runtimeMetaByRecordId.get(recordId)
    const recordCountBefore = this.runtimeMetaByRecordId.size

    const baseBlock = (reason: CanonicalMutationResult extends { ok: false } ? CanonicalMutationResult['reason'] : string): CanonicalMutationResult => ({
      ok: false,
      recordId,
      intent: 'PROMOTE',
      reason: reason as any,
    })

    if (!meta) {
      return baseBlock('RECORD_MISSING')
    }

    // R58.7: Cross-scope mutation firewall — scope check BEFORE documentKey
    if (verifiedScopeId && !this.assertCanonicalScope(
      meta.scopeId, verifiedScopeId, 'PROMOTION', recordId,
    )) {
      return baseBlock('DOCUMENT_MISMATCH' as any)
    }

    // ── Lifecycle validation ──
    if (meta.state !== 'CURRENT_LIVE') {
      console.error(
        `[InkChapter] PROMOTION-LIFECYCLE-VIOLATION: ` +
        `recordId=${recordId} ` +
        `state=${meta.state} ` +
        `reason=INVALID_LIFECYCLE_STATE ` +
        `decision=BLOCK`,
      )
      return baseBlock('INVALID_LIFECYCLE_STATE')
    }

    if (!meta.temporary) {
      return baseBlock('NOT_TEMPORARY')
    }

    // Document key check
    if (verifiedDocumentKey && meta.documentKey !== verifiedDocumentKey) {
      return baseBlock('DOCUMENT_MISMATCH')
    }

    // Runtime ID check
    if (verifiedRuntimeId && meta.currentRuntimeId !== verifiedRuntimeId) {
      return baseBlock('RUNTIME_MISMATCH')
    }

    // Element check
    if (verifiedElement) {
      if (meta.currentElement !== verifiedElement) {
        return baseBlock('ELEMENT_MISMATCH')
      }
      if (!verifiedElement.isConnected) {
        return baseBlock('ELEMENT_DISCONNECTED')
      }
    }

    // ── Execute promotion ──
    const stateBefore = meta.state
    meta.temporary = false
    meta.updatedAt = Date.now()

    // Update persistent record
    const record = this.recordsById.get(recordId)
    if (record) {
      record.temporary = false
    }

    this.emitLifecycle(recordId, 'PROMOTE', meta, meta.currentRuntimeId)

    console.info(
      `[InkChapter] CANONICAL-RECORD-PROMOTION: ` +
      `recordId=${recordId} ` +
      `stateBefore=${stateBefore} ` +
      `stateAfter=CURRENT_LIVE ` +
      `runtimeId=${meta.currentRuntimeId ?? 'none'} ` +
      `bindingVerified=${!!(verifiedRuntimeId && meta.currentRuntimeId === verifiedRuntimeId)} ` +
      `elementConnected=${!!(verifiedElement?.isConnected)} ` +
      `temporaryBefore=true ` +
      `temporaryAfter=false ` +
      `recordCountBefore=${recordCountBefore} ` +
      `recordCountAfter=${this.runtimeMetaByRecordId.size} ` +
      `decision=PROMOTE`,
    )

    return {
      ok: true,
      recordId,
      intent: 'PROMOTE',
      stateBefore,
      stateAfter: 'CURRENT_LIVE',
      recordCountBefore,
      recordCountAfter: this.runtimeMetaByRecordId.size,
    }
  }

  // ── Lookup ──────────────────────────────────────────────────────────

  /** Resolve canonical record by exact live element. */
  resolveExactLiveRecord(element: HTMLElement): {
    recordId: string
    meta: CanonicalRuntimeMeta
    record: ParagraphIndentOverrideRecord | undefined
  } | null {
    const recordId = this.recordIdByElement.get(element)
    if (!recordId) return null

    const meta = this.runtimeMetaByRecordId.get(recordId)
    if (!meta) return null
    if (meta.state !== 'CURRENT_LIVE') return null
    if (!meta.currentElement?.isConnected) {
      return null
    }

    return {
      recordId,
      meta,
      record: this.recordsById.get(recordId),
    }
  }

  /**
   * R58.6: Resolve record by element even when disconnected.
   * Used by MutationObserver to detect CURRENT_LIVE records whose element
   * was just removed from the DOM.
   */
  resolveRecordByRemovedElement(element: HTMLElement): {
    recordId: string
    meta: CanonicalRuntimeMeta
    record: ParagraphIndentOverrideRecord | undefined
  } | null {
    const recordId = this.recordIdByElement.get(element)
    if (!recordId) return null

    const meta = this.runtimeMetaByRecordId.get(recordId)
    if (!meta) return null
    if (meta.state !== 'CURRENT_LIVE') return null

    return {
      recordId,
      meta,
      record: this.recordsById.get(recordId),
    }
  }

  /** Resolve canonical record by runtimeId. */
  resolveByRuntimeId(runtimeId: string): {
    recordId: string
    meta: CanonicalRuntimeMeta
    record: ParagraphIndentOverrideRecord | undefined
  } | null {
    const recordId = this.recordIdByRuntimeId.get(runtimeId)
    if (!recordId) return null

    const meta = this.runtimeMetaByRecordId.get(recordId)
    if (!meta) return null

    return {
      recordId,
      meta,
      record: this.recordsById.get(recordId),
    }
  }

  /**
   * P0: Controlled replacement — rebind an existing CURRENT_LIVE record to a
   * replacement element using a CAS-like lease contract.
   *
   * Only used by empty-slot CONTROLLED_REPLACEMENT resolution (final-owner
   * commit). Does NOT retire the record and MUST NOT CREATE_NEW or consult any
   * historical resolver.
   *
   * Lease enforcement (any violation → BLOCK, return false):
   *   - record exists and state === CURRENT_LIVE
   *   - scopeId matches (when provided)
   *   - documentKey matches (when provided)
   *   - expectedGeneration matches (when provided)
   *   - expectedOldRuntimeId matches the current owner (when provided)
   *   - new element is not already bound to a different record
   *   - new runtimeId is not already bound to a different record
   */
  rebindCurrentLiveRecord(
    recordId: string,
    newElement: HTMLElement,
    newRuntimeId: string,
    lease?: {
      scopeId?: string
      documentKey?: string
      expectedGeneration?: number
      expectedOldRuntimeId?: string
    },
  ): boolean {
    const meta = this.runtimeMetaByRecordId.get(recordId)
    if (!meta || meta.state !== 'CURRENT_LIVE') {
      this.emitDiagnostic('REBIND-BLOCKED', { recordId, reason: 'invalid-state' })
      return false
    }

    if (lease?.scopeId !== undefined && !this.assertCanonicalScope(meta.scopeId, lease.scopeId, 'REBIND', recordId)) {
      return false
    }
    if (lease?.documentKey !== undefined && meta.documentKey !== lease.documentKey) {
      this.emitDiagnostic('REBIND-BLOCKED', {
        recordId, reason: 'document-mismatch',
        expectedDocumentKey: lease.documentKey, actualDocumentKey: meta.documentKey,
      })
      return false
    }
    if (lease?.expectedGeneration !== undefined && meta.generation !== lease.expectedGeneration) {
      this.emitDiagnostic('REBIND-BLOCKED', {
        recordId, reason: 'generation-mismatch',
        expectedGeneration: lease.expectedGeneration, actualGeneration: meta.generation,
      })
      return false
    }
    if (lease?.expectedOldRuntimeId !== undefined && meta.currentRuntimeId !== lease.expectedOldRuntimeId) {
      this.emitDiagnostic('REBIND-BLOCKED', {
        recordId, reason: 'old-runtime-mismatch',
        expectedOldRuntimeId: lease.expectedOldRuntimeId, actualOldRuntimeId: meta.currentRuntimeId ?? 'none',
      })
      return false
    }

    // Collision: new element already bound to a different record
    const existingByElement = this.recordIdByElement.get(newElement)
    if (existingByElement !== undefined && existingByElement !== recordId) {
      this.emitDiagnostic('REBIND-BLOCKED', { recordId, reason: 'element-collision', otherRecordId: existingByElement })
      return false
    }
    // Collision: new runtimeId already bound to a different record
    const existingByRt = this.recordIdByRuntimeId.get(newRuntimeId)
    if (existingByRt !== undefined && existingByRt !== recordId) {
      this.emitDiagnostic('REBIND-BLOCKED', { recordId, reason: 'runtime-collision', otherRecordId: existingByRt })
      return false
    }

    const oldRuntimeId = meta.currentRuntimeId
    const oldElement = meta.currentElement
    const generationBefore = meta.generation
    const recordCountBefore = this.runtimeMetaByRecordId.size

    // Invalidate old bindings (D8/D9)
    if (oldElement && this.recordIdByElement.get(oldElement) === recordId) {
      this.recordIdByElement.delete(oldElement)
    }
    if (oldRuntimeId && this.recordIdByRuntimeId.get(oldRuntimeId) === recordId) {
      this.recordIdByRuntimeId.delete(oldRuntimeId)
    }

    // Install new bindings (D10/D11) — generation increments exactly once (D12)
    this.recordIdByElement.set(newElement, recordId)
    this.recordIdByRuntimeId.set(newRuntimeId, recordId)
    meta.currentElement = newElement
    meta.currentRuntimeId = newRuntimeId
    meta.generation = generationBefore + 1
    meta.updatedAt = Date.now()

    const recordCountAfter = this.runtimeMetaByRecordId.size
    const recordCountPreserved = recordCountBefore === recordCountAfter

    this.emitLifecycle(recordId, 'REBIND_CURRENT', meta, newRuntimeId)
    emitRuntimeAudit('EMPTY-SPECIAL-CANONICAL-REBIND', {
      recordId,
      scopeId: meta.scopeId,
      documentKey: meta.documentKey,
      expectedScopeId: lease?.scopeId ?? null,
      expectedDocumentKey: lease?.documentKey ?? null,
      expectedGeneration: lease?.expectedGeneration ?? null,
      expectedOldRuntimeId: lease?.expectedOldRuntimeId ?? null,
      oldRuntimeId: oldRuntimeId ?? null,
      newRuntimeId,
      generationBefore,
      generationAfter: meta.generation,
      recordCountBefore,
      recordCountAfter,
      recordCountPreserved,
      decision: 'REBOUND',
    })

    return recordCountPreserved
  }

  /** Get runtime metadata for a record. Returns null if not in registry. */
  getRuntimeMeta(recordId: string): CanonicalRuntimeMeta | null {
    return this.runtimeMetaByRecordId.get(recordId) ?? null
  }

  /** Check if a record was created in the current session. */
  isCurrentSessionRecord(recordId: string): boolean {
    const meta = this.runtimeMetaByRecordId.get(recordId)
    if (!meta) return false
    return meta.origin === 'current-session'
  }

  /** Get record by ID. */
  getRecord(recordId: string): ParagraphIndentOverrideRecord | undefined {
    return this.recordsById.get(recordId)
  }

  /** R58.7: Count records stuck in CURRENT_AWAITING_TRANSFER (leak audit). */
  getAwaitingTransferCount(): number {
    let count = 0
    for (const meta of this.runtimeMetaByRecordId.values()) {
      if (meta.state === 'CURRENT_AWAITING_TRANSFER') count++
    }
    return count
  }

  /** Update persistent record reference (used when service mutates records). */
  setRecord(recordId: string, record: ParagraphIndentOverrideRecord): void {
    this.recordsById.set(recordId, record)
  }

  /** Delete record from registry (used when mode=auto removes override). */
  deleteRecord(recordId: string): void {
    const meta = this.runtimeMetaByRecordId.get(recordId)
    if (meta) {
      if (meta.currentElement) {
        this.recordIdByElement.delete(meta.currentElement)
      }
      if (meta.currentRuntimeId) {
        this.recordIdByRuntimeId.delete(meta.currentRuntimeId)
      }
    }
    this.runtimeMetaByRecordId.delete(recordId)
    this.recordsById.delete(recordId)
  }

  /** Get all records that are in a current-session lifecycle state. */
  getCurrentSessionRecordIds(): string[] {
    const ids: string[] = []
    for (const [id, meta] of this.runtimeMetaByRecordId) {
      if (meta.origin === 'current-session') {
        ids.push(id)
      }
    }
    return ids
  }

  /** Get all registered record IDs. */
  getAllRecordIds(): string[] {
    return Array.from(this.runtimeMetaByRecordId.keys())
  }

  /** Get the number of registered runtime records. */
  get recordCount(): number {
    return this.runtimeMetaByRecordId.size
  }

  /** Get element bound to a record. */
  getBoundElement(recordId: string): HTMLElement | null {
    const meta = this.runtimeMetaByRecordId.get(recordId)
    return meta?.currentElement ?? null
  }

  /** Get runtimeId bound to a record. */
  getBoundRuntimeId(recordId: string): string | null {
    const meta = this.runtimeMetaByRecordId.get(recordId)
    return meta?.currentRuntimeId ?? null
  }

  // ── R58.5: LiveOwnershipProof Resolver ───────────────────────────

  /**
   * Resolve a LiveOwnershipProof for an element.
   *
   * Validates ALL of:
   * - record exists in registry
   * - runtime meta exists
   * - state === CURRENT_LIVE
   * - element.isConnected === true
   * - meta.currentElement === element
   * - runtimeId exists
   * - meta.currentRuntimeId === runtimeId
   * - recordIdByElement(element) === recordId
   * - recordIdByRuntimeId(runtimeId) === recordId
   * - meta.documentKey === documentKey
   *
   * Missing ANY → null (proof rejected).
   */
  resolveLiveOwnershipProof(
    element: HTMLElement,
    documentKey: string,
    runtimeId: string,
  ): LiveOwnershipProof | null {
    // Element connected check
    if (!element.isConnected) {
      console.info(
        `[InkChapter] LIVE-OWNERSHIP-PROOF-REJECT: ` +
        `documentKey=${documentKey} runtimeId=${runtimeId} ` +
        `reason=element-disconnected`,
      )
      return null
    }

    // Record by element
    const recordId = this.recordIdByElement.get(element)
    if (!recordId) {
      console.info(
        `[InkChapter] LIVE-OWNERSHIP-PROOF-REJECT: ` +
        `documentKey=${documentKey} runtimeId=${runtimeId} ` +
        `reason=no-record-by-element`,
      )
      return null
    }

    // Record by runtimeId
    const recordIdByRt = this.recordIdByRuntimeId.get(runtimeId)
    if (recordIdByRt !== recordId) {
      console.info(
        `[InkChapter] LIVE-OWNERSHIP-PROOF-REJECT: ` +
        `documentKey=${documentKey} recordId=${recordId} runtimeId=${runtimeId} ` +
        `reason=runtimeId-mismatch (expected=${recordIdByRt ?? 'none'})`,
      )
      return null
    }

    // Runtime meta
    const meta = this.runtimeMetaByRecordId.get(recordId)
    if (!meta) {
      console.info(
        `[InkChapter] LIVE-OWNERSHIP-PROOF-REJECT: ` +
        `documentKey=${documentKey} recordId=${recordId} ` +
        `reason=no-runtime-meta`,
      )
      return null
    }

    // State check
    if (meta.state !== 'CURRENT_LIVE') {
      console.info(
        `[InkChapter] LIVE-OWNERSHIP-PROOF-REJECT: ` +
        `documentKey=${documentKey} recordId=${recordId} state=${meta.state} ` +
        `reason=not-current-live`,
      )
      return null
    }

    // Element match
    if (meta.currentElement !== element) {
      console.info(
        `[InkChapter] LIVE-OWNERSHIP-PROOF-REJECT: ` +
        `documentKey=${documentKey} recordId=${recordId} ` +
        `reason=element-mismatch`,
      )
      return null
    }

    // RuntimeId match
    if (meta.currentRuntimeId !== runtimeId) {
      console.info(
        `[InkChapter] LIVE-OWNERSHIP-PROOF-REJECT: ` +
        `documentKey=${documentKey} recordId=${recordId} ` +
        `reason=runtimeId-mismatch-vs-meta`,
      )
      return null
    }

    // Document key match
    if (meta.documentKey !== documentKey) {
      console.info(
        `[InkChapter] LIVE-OWNERSHIP-PROOF-REJECT: ` +
        `documentKey=${documentKey} recordId=${recordId} ` +
        `reason=document-mismatch (meta.doc=${meta.documentKey})`,
      )
      return null
    }

    const proof: LiveOwnershipProof = {
      recordId,
      documentKey,
      runtimeId,
      element,
      generation: meta.generation,
    }

    console.info(
      `[InkChapter] LIVE-OWNERSHIP-PROOF: ` +
      `recordId=${recordId} ` +
      `documentKey=${documentKey} ` +
      `runtimeId=${runtimeId} ` +
      `generation=${meta.generation} ` +
      `elementConnected=true ` +
      `state=CURRENT_LIVE ` +
      `bindingByElement=true ` +
      `bindingByRuntime=true ` +
      `decision=VALID`,
    )

    return proof
  }

  /**
   * Validate that a proof is still current (generation matches registry).
   * Emits STALE-LIVE-OWNERSHIP-PROOF if generation mismatch.
   */
  validateProofGeneration(
    proof: LiveOwnershipProof,
    intent: CanonicalMutationIntent,
  ): CanonicalMutationResult {
    const meta = this.runtimeMetaByRecordId.get(proof.recordId)
    const recordCount = this.runtimeMetaByRecordId.size

    const block = (reason: CanonicalMutationResult extends { ok: false } ? CanonicalMutationResult['reason'] : string): CanonicalMutationResult => ({
      ok: false,
      recordId: proof.recordId,
      intent,
      reason: reason as any,
    })

    if (!meta) {
      return block('RECORD_MISSING')
    }

    if (meta.generation !== proof.generation) {
      console.error(
        `[InkChapter] STALE-LIVE-OWNERSHIP-PROOF: ` +
        `recordId=${proof.recordId} ` +
        `proofGeneration=${proof.generation} ` +
        `metaGeneration=${meta.generation} ` +
        `intent=${intent} ` +
        `decision=BLOCK`,
      )
      return block('INVALID_TRANSITION')
    }

    return {
      ok: true,
      recordId: proof.recordId,
      intent,
      stateBefore: meta.state,
      stateAfter: meta.state,
      recordCountBefore: recordCount,
      recordCountAfter: recordCount,
    }
  }

  // ── R58.5: Live Replacement Resolver ─────────────────────────────

  /**
   * Resolve a live replacement for a ticket using DOM continuity evidence
   * from a MutationObserver batch.
   *
   * Evidence required:
   *   - same parent container
   *   - old element removed
   *   - exactly one paragraph added in matching slot
   *   - candidateCount === 1
   *
   * Does NOT use anchor/text/ordinal/proximity heuristics.
   */
  resolveLiveReplacement(
    ticket: LiveReplacementTicket,
    removedElements: HTMLElement[],
    addedParagraphs: HTMLElement[],
    parentElement: HTMLElement | null,
  ): ReplacementResolution {
    // Filter to actual paragraph elements only
    const addedPs = addedParagraphs.filter(el => el.tagName === 'P' && el.isConnected)

    if (addedPs.length === 0) {
      return { decision: 'PENDING', reason: 'no-added-paragraphs', candidateCount: 0 }
    }

    // Candidate count must be exactly 1
    if (addedPs.length > 1) {
      return { decision: 'BLOCK', reason: `ambiguous: ${addedPs.length} added paragraphs`, candidateCount: addedPs.length }
    }

    const replacement = addedPs[0]
    const evidence: string[] = []

    // Same parent evidence
    if (parentElement && replacement.parentElement === parentElement) {
      evidence.push('same-parent')
    }

    // Same batch evidence
    const wasRemoved = removedElements.some(el => el === ticket.previousElement)
    if (wasRemoved) {
      evidence.push('old-element-in-removed-list')
    }

    // Only transfer if we have DOM continuity evidence
    // For 1→1 replacement: same-batch + same-parent or old-in-removed is sufficient
    // R58.6.1: relaxed from requiring 2 evidence to allowing 1 strong evidence
    if (evidence.length === 0) {
      return {
        decision: 'PENDING',
        reason: `insufficient-evidence`,
        candidateCount: 1,
      }
    }

    const replacementRuntimeId = `P-RUNTIME-UNKNOWN`
    console.info(
      `[InkChapter] LIVE-REPLACEMENT-RESOLVE: ` +
      `ticketId=${ticket.ticketId} ` +
      `recordId=${ticket.recordId} ` +
      `candidateCount=1 ` +
      `replacementRuntimeId=${replacementRuntimeId} ` +
      `evidence=[${evidence.join(',')}] ` +
      `decision=TRANSFER`,
    )

    // Resolve replacement through service's getParagraphRuntimeId — handled by caller
    return {
      decision: 'TRANSFER',
      replacement,
      replacementRuntimeId: '', // filled by caller
      evidence,
    }
  }

  // ── Document Switch ─────────────────────────────────────────────────

  /**
   * Clean up all live bindings for current-session records on document switch.
   * Does NOT convert current-session records to historical.
   * Does NOT clear PERSISTED_HISTORICAL records.
   */
  clearDocumentBindings(documentKey: string): void {
    const toRetire: string[] = []

    for (const [id, meta] of this.runtimeMetaByRecordId) {
      if (meta.origin === 'current-session') {
        toRetire.push(id)
      }
    }

    for (const id of toRetire) {
      this.retireRecord(id, 'document-switch', 'DOCUMENT_SWITCH')
    }

    // Also clear element/runtime bindings that may have leaked
    // (PERSISTED_HISTORICAL records don't have live bindings)
    this.emitDiagnostic('CANONICAL-BINDING-DOCUMENT-SWITCH', {
      documentKey,
      retiredCount: toRetire.length,
      remainingCount: this.runtimeMetaByRecordId.size,
    })
  }

  // ── Diagnostic ──────────────────────────────────────────────────────

  /**
   * R58.7 Phase A.1.3.1a: Scope authorization guard.
   * Returns true if record scope matches operation scope.
   * On mismatch: emits CANONICAL-SCOPE-MISMATCH, returns false.
   * Caller must BLOCK the mutation.
   */
  assertCanonicalScope(
    recordScopeId: string,
    operationScopeId: string,
    operation: string,
    recordId: string,
  ): boolean {
    if (recordScopeId === operationScopeId) return true
    emitRuntimeAudit('CANONICAL-SCOPE-MISMATCH', {
      recordId,
      recordScopeId,
      operationScopeId,
      operation,
      decision: 'HARD_STOP',
    }, 'warn')
    return false
  }

  private emitLifecycle(
    recordId: string,
    event: string,
    meta: CanonicalRuntimeMeta,
    targetRuntimeId: string | undefined,
  ): void {
    emitRuntimeAudit('RECORD-LIFECYCLE', {
      event,
      recordId,
      scopeId: meta.scopeId,
      persistenceKey: meta.persistenceKey ?? 'null',
      documentKey: meta.documentKey,
      sessionId: meta.sessionId,
      state: meta.state,
      runtimeId: meta.currentRuntimeId ?? targetRuntimeId ?? 'none',
      previousRuntimeId: meta.previousRuntimeId ?? 'none',
      generation: meta.generation,
      temporary: meta.temporary,
      origin: meta.origin,
      recordCount: this.runtimeMetaByRecordId.size,
      timestamp: Date.now(),
    })
  }

  private emitDiagnostic(
    diagnostic: string,
    fields: Record<string, unknown>,
  ): void {
    const parts = [`[InkChapter] ${diagnostic}:`]
    for (const [k, v] of Object.entries(fields)) {
      parts.push(`${k}=${v}`)
    }
    console.info(parts.join(' '))
  }

  /** Dump full registry state for debugging. */
  dumpState(): Record<string, unknown> {
    const records: Record<string, unknown>[] = []
    for (const [id, meta] of this.runtimeMetaByRecordId) {
      records.push({
        recordId: id,
        state: meta.state,
        origin: meta.origin,
        generation: meta.generation,
        temporary: meta.temporary,
        documentKey: meta.documentKey,
        hasElement: !!meta.currentElement,
        hasRuntimeId: !!meta.currentRuntimeId,
        runtimeId: meta.currentRuntimeId ?? 'none',
      })
    }
    return {
      sessionId: this.sessionId,
      recordCount: this.runtimeMetaByRecordId.size,
      records,
    }
  }
}

// ── Persistent Resolver Gate ──────────────────────────────────────────

/**
 * HARD GATE: only PERSISTED_HISTORICAL records may enter persistent resolver.
 *
 * If any current-session record (CURRENT_LIVE, CURRENT_AWAITING_TRANSFER,
 * CURRENT_RETIRED) attempts to enter persistent resolver, emit
 * BUG-CURRENT-SESSION-RECORD-ENTERED-PERSISTENT-RESOLVER and HARD STOP.
 */
export function validatePersistentResolverEligibility(
  registry: ParagraphCanonicalRegistry,
  recordId: string,
  callerStage: string,
): { allowed: boolean; state: CanonicalRuntimeState | null; reason: string } {
  const meta = registry.getRuntimeMeta(recordId)
  if (!meta) {
    // Not in registry — treated as PERSISTED_HISTORICAL by default
    // (should only happen for records loaded before registry existed)
    return { allowed: true, state: null, reason: 'not-in-registry' }
  }

  if (meta.state === 'PERSISTED_HISTORICAL') {
    return { allowed: true, state: meta.state, reason: 'correct-state' }
  }

  // HARD STOP: current-session record entering persistent resolver
  const diagnostic = {
    recordId,
    state: meta.state,
    sessionId: meta.sessionId,
    documentKey: meta.documentKey,
    boundRuntimeId: meta.currentRuntimeId ?? 'none',
    origin: meta.origin,
    resolverStage: callerStage,
  }

  console.error(
    `[InkChapter] BUG-CURRENT-SESSION-RECORD-ENTERED-PERSISTENT-RESOLVER: ` +
    `recordId=${diagnostic.recordId} ` +
    `state=${diagnostic.state} ` +
    `sessionId=${diagnostic.sessionId} ` +
    `documentKey=${diagnostic.documentKey} ` +
    `boundRuntimeId=${diagnostic.boundRuntimeId} ` +
    `origin=${diagnostic.origin} ` +
    `resolverStage=${diagnostic.resolverStage} ` +
    `ACTION=HARD_STOP`,
  )

  return {
    allowed: false,
    state: meta.state,
    reason: `BUG-CURRENT-SESSION-RECORD-ENTERED-PERSISTENT-RESOLVER: state=${meta.state}`,
  }
}

/**
 * Validate a candidate is allowed for a target paragraph.
 * If the target is "。" (single dot) and the candidate comes from
 * a current-session record, emit SINGLE-DOT-CURRENT-SESSION-CANDIDATE.
 */
export function validateSingleDotCandidate(
  registry: ParagraphCanonicalRegistry,
  recordId: string,
  targetText: string,
): { allowed: boolean; reason: string } {
  if (targetText !== '。' && targetText !== '.') {
    return { allowed: true, reason: 'not-single-dot' }
  }

  const meta = registry.getRuntimeMeta(recordId)
  if (!meta) {
    return { allowed: true, reason: 'not-in-registry' }
  }

  if (meta.state !== 'PERSISTED_HISTORICAL') {
    console.error(
      `[InkChapter] SINGLE-DOT-CURRENT-SESSION-CANDIDATE: ` +
      `recordId=${recordId} ` +
      `state=${meta.state} ` +
      `origin=${meta.origin} ` +
      `targetText="。" ` +
      `ACTION=HARD_STOP`,
    )
    return {
      allowed: false,
      reason: `SINGLE-DOT-CURRENT-SESSION-CANDIDATE: record state=${meta.state}`,
    }
  }

  return { allowed: true, reason: 'persisted-historical' }
}
