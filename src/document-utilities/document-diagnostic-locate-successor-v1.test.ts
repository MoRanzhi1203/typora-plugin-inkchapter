import { describe, expect, it } from 'vitest'

import { resolveLocateSuccessor } from './document-diagnostic-location'

/**
 * P0 LOC — after a bounded refresh (`LOCATE_BOUNDED_REFRESH`) the previously
 * clicked diagnostic id can be gone: the recompute re-issues the same rule with a
 * NEW id. The old code looked the id up directly, found nothing and finished the
 * transaction silently — the user's click produced no marker.
 *
 * The successor must be recovered from the SEMANTIC MEMBERSHIP of the refreshed
 * snapshot (same rule + same canonical boundary identity), never from text or
 * from "the first remaining diagnostic".
 */
const PREV = {
  diagnosticId: 'document:EXCESSIVE_INTERNAL_BLANK_LINES:blank-gap:p:a#0>>p:b#0',
  code: 'EXCESSIVE_INTERNAL_BLANK_LINES',
  targetIdentity: 'blank-gap:paragraph:a#0>>paragraph:b#0',
  stableIdentity: null as string | null,
}

describe('LOC — diagnostic id successor recovery', () => {
  it('returns the exact diagnostic when the id survived the refresh', () => {
    const next = [{
      id: PREV.diagnosticId,
      code: PREV.code,
      targetIdentity: PREV.targetIdentity,
    }]
    expect(resolveLocateSuccessor(PREV, next)?.id).toBe(PREV.diagnosticId)
  })

  it('recovers the re-issued diagnostic by rule + canonical boundary identity', () => {
    const next = [
      { id: 'document:OTHER_RULE:x', code: 'OTHER_RULE', targetIdentity: 'x' },
      { id: 'document:EXCESSIVE_INTERNAL_BLANK_LINES:blank-gap:p:a#0>>p:b#0#2', code: PREV.code, targetIdentity: PREV.targetIdentity },
    ]
    expect(resolveLocateSuccessor(PREV, next)?.id).toBe('document:EXCESSIVE_INTERNAL_BLANK_LINES:blank-gap:p:a#0>>p:b#0#2')
  })

  it('never matches across rule codes', () => {
    const next = [{ id: 'document:OTHER_RULE:same', code: 'OTHER_RULE', targetIdentity: PREV.targetIdentity }]
    expect(resolveLocateSuccessor(PREV, next)).toBeNull()
  })

  it('returns null when the violation disappeared (caller retires the diagnostic)', () => {
    expect(resolveLocateSuccessor(PREV, [])).toBeNull()
    expect(resolveLocateSuccessor(PREV, [{ id: 'document:OTHER_RULE:x', code: 'OTHER_RULE', targetIdentity: 'x' }])).toBeNull()
  })

  it('returns null on an ambiguous duplicate boundary pair (never first-match)', () => {
    const next = [
      { id: 'document:A:1', code: PREV.code, targetIdentity: PREV.targetIdentity },
      { id: 'document:A:2', code: PREV.code, targetIdentity: PREV.targetIdentity },
    ]
    expect(resolveLocateSuccessor(PREV, next)).toBeNull()
  })

  it('falls back to the stable identity only when it is non-empty and unique', () => {
    const prev = { ...PREV, targetIdentity: null, stableIdentity: 'stable-1' }
    const unique = [{ id: 'document:B:1', code: PREV.code, stableIdentity: 'stable-1' }]
    expect(resolveLocateSuccessor(prev, unique)?.id).toBe('document:B:1')
    const ambiguous = [
      { id: 'document:B:1', code: PREV.code, stableIdentity: 'stable-1' },
      { id: 'document:B:2', code: PREV.code, stableIdentity: 'stable-1' },
    ]
    expect(resolveLocateSuccessor(prev, ambiguous)).toBeNull()
  })

  it('never matches two diagnostics that both lack an identity', () => {
    const prev = { ...PREV, targetIdentity: null, stableIdentity: null }
    expect(resolveLocateSuccessor(prev, [{ id: 'document:C:1', code: PREV.code }])).toBeNull()
  })
})
