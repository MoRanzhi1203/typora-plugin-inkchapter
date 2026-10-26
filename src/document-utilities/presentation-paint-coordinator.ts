/**
 * PRESENTATION PAINT COORDINATOR (EN-11 R3 → R4 hardening)
 *
 * WHY: during a real Enter's bounded echo window the plugin must not write into
 * the content document (`#write`) — Typora re-normalises its end block on any
 * foreign childList write there, producing a SECOND `SPLIT_1_TO_2` for a single
 * Enter. R3 replaced seven per-site `setTimeout`s with ONE coordinator. R4 fixes
 * three real safety gaps found by source audit (prompt §0.5 / §B1–B3):
 *
 *   B1 — hold-budget exhaustion MUST NOT write while the hold is still active.
 *        R3 force-painted at `MAX_HELD_FRAMES`; R4 BLOCKS instead
 *        (`PAINT_BLOCKED_UNSTABLE`), keeps the dirty intent parked, stops the
 *        active loop and resumes only on a real stable signal (`resumeOnStable`)
 *        or a new request. Fail-open applies to a THROWING predicate/paint, never
 *        to the content-write safety rule.
 *
 *   B2 — identity must be REAL and monotonic, not a repeatable string.
 *        `editorRootId` is now supplied by a WeakMap-generated monotonic identity
 *        at the call site; a replaced root element (even one still called
 *        `DIV#write`) yields a different id → the stale intent is dropped.
 *        `sourceRevision` / `layoutEpoch` are VALIDATED against live values at
 *        commit (missing values never hard-match: they are recorded as UNKNOWN
 *        and the closure re-derives from the live snapshot).
 *
 *   B3 — explicit state flow + no forced paint when the app is not visible.
 *        REQUESTED → (PARKED | BLOCKED) → COMMITTED | DROP_STALE. When the
 *        document is hidden the intent parks (`PARKED_INACTIVE`) instead of
 *        burning frames; it resumes on a stable signal.
 *
 * Prohibited by construction: polling, unbounded recursive timers, any DOM
 * MutationObserver, any write→observe feedback loop, and painting into `#write`
 * while the content-write hold is active.
 */

export interface PresentationPaintIntent {
  /** Owning document identity at request time (null = unknown). */
  documentKey: string | null
  /** Editor content-root identity at request time (monotonic; null = unknown). */
  editorRootId: string | null
  /** Diagnostics source revision at request time (diagnostic + validation). */
  sourceRevision: number | null
  /** Layout epoch at request time (diagnostic + validation). */
  layoutEpoch: number | null
}

export interface PresentationRevision {
  sourceRevision: number | null
  layoutEpoch: number | null
}

export interface PresentationPaintCounters {
  /** Distinct (doc,domain) pending intents created. */
  REQUESTS: number
  /** Requests merged into an already-pending intent (latest-wins). */
  MERGED: number
  /** Intents actually painted. */
  PAINTED: number
  /** Intents dropped as stale (doc/root mismatch, cancel, dispose). */
  DROPPED_STALE: number
  /** Frames observed with an active write hold (intent parked, nothing written). */
  DEFERRED_BY_ECHO_WINDOW: number
  /** Hold budget exhausted while the hold was STILL active → BLOCKED, never painted. */
  PAINT_BLOCKED_UNSTABLE: number
  /** Parked because the document was not visible (no frames burned). */
  PARKED_INACTIVE: number
  /** Resumed after a stable signal and committed. */
  RESUMED_ON_STABLE: number
  /** Committed although the live source revision/layout epoch had advanced. */
  REVISION_ADVANCED_BEFORE_PAINT: number
  /** Committed with no live revision reader (recorded as UNKNOWN, never hard-matched). */
  REVISION_UNKNOWN_AT_PAINT: number
  /** Paint closures that threw (fail-open, swallowed). */
  PAINT_ERRORS: number
}

export function createPresentationPaintCounters(): PresentationPaintCounters {
  return {
    REQUESTS: 0,
    MERGED: 0,
    PAINTED: 0,
    DROPPED_STALE: 0,
    DEFERRED_BY_ECHO_WINDOW: 0,
    PAINT_BLOCKED_UNSTABLE: 0,
    PARKED_INACTIVE: 0,
    RESUMED_ON_STABLE: 0,
    REVISION_ADVANCED_BEFORE_PAINT: 0,
    REVISION_UNKNOWN_AT_PAINT: 0,
    PAINT_ERRORS: 0,
  }
}

export interface PresentationIdentity {
  documentKey: string | null
  editorRootId: string | null
}

/** Explicit lifecycle of one paint request. */
export type PresentationPaintState = 'IDLE' | 'PARKED' | 'BLOCKED' | 'COMMITTED' | 'DROP_STALE'

interface PendingEntry {
  domain: string
  intent: PresentationPaintIntent
  paint: () => void
  /** Monotonic per-entry epoch (latest-wins bookkeeping). */
  intentEpoch: number
}

/**
 * Bounded frame-driven re-check budget. When it is exhausted WHILE the hold is
 * still active the coordinator **blocks** (keeps the intent, writes nothing) —
 * it never forces a `#write` paint through an active hold.
 */
const MAX_HELD_FRAMES = 120

export class PresentationPaintCoordinator {
  private readonly entries = new Map<string, PendingEntry>()
  private disposed = false
  private scheduled = false
  private blocked = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private heldFrames = 0
  private intentSeq = 0
  private state: PresentationPaintState = 'IDLE'
  private readonly counters = createPresentationPaintCounters()

  constructor(
    /** Authority for "content-document writes are unsafe right now". */
    private readonly heldPredicate: () => boolean,
    /** Live identity reader (re-read at paint time — never cached). */
    private readonly currentIdentity: () => PresentationIdentity,
    /** Optional audit hook for drops / parks / blocks. */
    private readonly onEvent?: (event: string, domain: string, detail: Record<string, unknown>) => void,
    /** Optional live revision reader (sourceRevision / layoutEpoch) for B2 validation. */
    private readonly currentRevision?: () => PresentationRevision,
  ) {}

  getCounters(): Readonly<PresentationPaintCounters> {
    return { ...this.counters }
  }

  getState(): PresentationPaintState {
    return this.state
  }

  isBlocked(): boolean {
    return this.blocked
  }

  /** Number of parked (not yet painted) intents. */
  getPendingCount(): number {
    return this.entries.size
  }

  hasPendingFor(domain: string): boolean {
    for (const e of this.entries.values()) if (e.domain === domain) return true
    return false
  }

  /**
   * Request a presentation paint. Commits synchronously when the hold is inactive
   * (unchanged behaviour on every non-Enter path); otherwise parks ONE intent per
   * (documentKey, domain), latest-wins.
   */
  request(domain: string, intent: PresentationPaintIntent, paint: () => void): void {
    if (this.disposed) {
      this.counters.DROPPED_STALE++
      this.state = 'DROP_STALE'
      this.onEvent?.('DROP_STALE', domain, { reason: 'DISPOSED' })
      return
    }
    let live: PresentationIdentity | null = null
    try { live = this.currentIdentity() } catch { live = null }
    if (live && intent.documentKey != null && live.documentKey != null && intent.documentKey !== live.documentKey) {
      this.counters.DROPPED_STALE++
      this.state = 'DROP_STALE'
      this.onEvent?.('DROP_STALE', domain, { reason: 'DOC_MISMATCH_ON_REQUEST' })
      return
    }
    if (live && intent.editorRootId != null && live.editorRootId != null && intent.editorRootId !== live.editorRootId) {
      this.counters.DROPPED_STALE++
      this.state = 'DROP_STALE'
      this.onEvent?.('DROP_STALE', domain, { reason: 'ROOT_MISMATCH_ON_REQUEST' })
      return
    }

    let held = false
    try { held = this.heldPredicate() } catch { held = false /* fail-open: predicate error only */ }

    if (!held && !this.blocked) {
      this.counters.REQUESTS++
      this.commit({ domain, intent, paint, intentEpoch: ++this.intentSeq })
      return
    }

    const key = `${intent.documentKey ?? '∅'}|${domain}`
    const existing = this.entries.get(key)
    if (existing) {
      this.counters.MERGED++
      existing.intent = intent
      existing.paint = paint
      existing.intentEpoch = ++this.intentSeq
    } else {
      this.counters.REQUESTS++
      this.entries.set(key, { domain, intent, paint, intentEpoch: ++this.intentSeq })
    }
    this.state = this.blocked ? 'BLOCKED' : 'PARKED'
    this.onEvent?.('PARKED', domain, { pending: this.entries.size, reason: held ? 'WRITE_HOLD_ACTIVE' : 'COORDINATOR_BLOCKED' })
    // A new request is a legitimate stable signal: allow the loop to retry.
    this.blocked = false
    this.heldFrames = 0
    this.schedule()
  }

  /**
   * External STABLE signal (edit settled / layout invalidation resolved / app
   * visible again). Resumes a BLOCKED or PARKED coordinator without any timer.
   */
  resumeOnStable(reason: string): void {
    if (this.disposed || this.entries.size === 0) return
    if (this.blocked) {
      this.counters.RESUMED_ON_STABLE++
      this.onEvent?.('RESUMED_ON_STABLE', '*', { reason })
    }
    this.blocked = false
    this.heldFrames = 0
    this.schedule()
  }

  /** Drop every parked intent (document switch / root replacement). */
  cancelAll(reason: string): number {
    const n = this.entries.size
    if (n > 0) {
      this.entries.clear()
      this.counters.DROPPED_STALE += n
      this.state = 'DROP_STALE'
      this.onEvent?.('DROP_ALL', '*', { reason, dropped: n })
    }
    this.clearRetry()
    this.scheduled = false
    this.blocked = false
    this.heldFrames = 0
    return n
  }

  dispose(): void {
    this.disposed = true
    this.cancelAll('DISPOSED')
  }

  /**
   * Test/diagnostic seam: run the parked intents now (still subject to the
   * document/root identity re-check). NOTE: this intentionally bypasses the hold —
   * production code must never call it while a content-write hold is active.
   */
  flushNow(): void {
    this.clearRetry()
    this.scheduled = false
    this.blocked = false
    this.heldFrames = 0
    const batch = [...this.entries.values()]
    this.entries.clear()
    for (const e of batch) this.commit(e)
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private schedule(): void {
    if (this.disposed || this.scheduled || this.entries.size === 0 || this.blocked) return
    this.scheduled = true
    const step = (): void => {
      this.scheduled = false
      if (this.disposed) { this.cancelAll('DISPOSED'); return }
      if (this.entries.size === 0) return

      // B3 — never burn frames or force a paint while the app is not visible.
      let visible = true
      try { visible = typeof document === 'undefined' || document.visibilityState !== 'hidden' } catch { visible = true }
      if (!visible) {
        this.blocked = true
        this.state = 'PARKED'
        this.counters.PARKED_INACTIVE++
        this.onEvent?.('PARKED_INACTIVE', '*', { reason: 'DOCUMENT_HIDDEN' })
        return
      }

      let held = true
      try { held = this.heldPredicate() } catch { held = false /* fail-open: predicate error only */ }
      if (held) {
        if (this.heldFrames >= MAX_HELD_FRAMES) {
          // B1 — budget exhausted while the hold is STILL active: BLOCK, never paint.
          this.blocked = true
          this.state = 'BLOCKED'
          this.counters.PAINT_BLOCKED_UNSTABLE++
          this.onEvent?.('PAINT_BLOCKED_UNSTABLE', '*', { frames: this.heldFrames, pending: this.entries.size })
          return
        }
        this.heldFrames++
        this.counters.DEFERRED_BY_ECHO_WINDOW++
        if (typeof requestAnimationFrame === 'function') {
          try { requestAnimationFrame(step); return } catch { /* fall through */ }
        }
        this.retryTimer = setTimeout(step, 16)
        return
      }
      this.heldFrames = 0
      this.flushNow()
    }
    if (typeof requestAnimationFrame === 'function') {
      try { requestAnimationFrame(step); return } catch { /* fall through */ }
    }
    this.retryTimer = setTimeout(step, 0)
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      try { clearTimeout(this.retryTimer) } catch { /* ignore */ }
      this.retryTimer = null
    }
  }

  private commit(entry: PendingEntry): void {
    // B2 — re-read LIVE identity: a paint captured for document A / root A must
    // never run against document B / root B (even if both are named `DIV#write`).
    let live: PresentationIdentity | null = null
    try { live = this.currentIdentity() } catch { live = null }
    if (live) {
      if (entry.intent.documentKey != null && live.documentKey != null && entry.intent.documentKey !== live.documentKey) {
        this.counters.DROPPED_STALE++
        this.state = 'DROP_STALE'
        this.onEvent?.('DROP_STALE', entry.domain, { reason: 'DOC_CHANGED_BEFORE_PAINT' })
        return
      }
      if (entry.intent.editorRootId != null && live.editorRootId != null && entry.intent.editorRootId !== live.editorRootId) {
        this.counters.DROPPED_STALE++
        this.state = 'DROP_STALE'
        this.onEvent?.('DROP_STALE', entry.domain, { reason: 'ROOT_CHANGED_BEFORE_PAINT' })
        return
      }
    }
    // B2 — validate the live revision; missing values are recorded as UNKNOWN and
    // never hard-match. The paint closure re-derives from the live snapshot, so an
    // advanced revision is painted (from live) and counted, never silently replayed.
    if (this.currentRevision) {
      let rev: PresentationRevision | null = null
      try { rev = this.currentRevision() } catch { rev = null }
      const intentHas = entry.intent.sourceRevision != null || entry.intent.layoutEpoch != null
      if (!rev || (!intentHas && rev.sourceRevision == null && rev.layoutEpoch == null)) {
        this.counters.REVISION_UNKNOWN_AT_PAINT++
      } else if (
        (entry.intent.sourceRevision != null && rev.sourceRevision != null && entry.intent.sourceRevision !== rev.sourceRevision) ||
        (entry.intent.layoutEpoch != null && rev.layoutEpoch != null && entry.intent.layoutEpoch !== rev.layoutEpoch)
      ) {
        this.counters.REVISION_ADVANCED_BEFORE_PAINT++
        this.onEvent?.('REDERIVED_FROM_LIVE', entry.domain, {
          intentSourceRevision: entry.intent.sourceRevision,
          liveSourceRevision: rev.sourceRevision,
          intentLayoutEpoch: entry.intent.layoutEpoch,
          liveLayoutEpoch: rev.layoutEpoch,
        })
      }
    }
    try {
      entry.paint()
      this.counters.PAINTED++
      this.state = 'COMMITTED'
    } catch {
      this.counters.PAINT_ERRORS++ /* fail-open: presentation-only */
      this.state = 'COMMITTED'
    }
  }
}
