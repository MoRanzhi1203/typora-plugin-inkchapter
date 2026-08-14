/**
 * Runtime log timestamp helper — single, testable source of truth for the
 * per-line timestamp standard introduced in the TS1 observability build.
 *
 * Guarantees `tsIso` and `tsEpochMs` come from the SAME `Date.now()` capture,
 * so a human-readable ISO string and a numeric epoch never drift by a ms.
 *
 * Pure utility — no business, DOM, selection, canonical, or sidecar side effects.
 */

export interface RuntimeLogTimestamp {
  /** Milliseconds since epoch (wall clock, single capture). */
  tsEpochMs: number
  /** ISO-8601 string derived from the SAME capture. */
  tsIso: string
}

/** Capture tsEpochMs + tsIso from one `now` value (defaults to Date.now()). */
export function captureRuntimeLogTimestamp(now: number = Date.now()): RuntimeLogTimestamp {
  return {
    tsEpochMs: now,
    tsIso: new Date(now).toISOString(),
  }
}

/** Console-line timestamp prefix: `[ISO][epoch]`. */
export function formatRuntimeLogTimestamp(ts: RuntimeLogTimestamp): string {
  return `[${ts.tsIso}][${ts.tsEpochMs}]`
}
