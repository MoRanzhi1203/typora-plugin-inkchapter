/**
 * PA-15 — a coalesced refresh batch must keep document-switch and
 * force-refresh semantics regardless of which reason wins the priority race.
 */
import { describe, it, expect } from 'vitest'
import { decideRefreshBatch, DOCUMENT_SWITCH_REASONS, FORCE_REFRESH_REASON_IDS } from './refresh-reason-policy'

describe('PA-15 refresh batch decision', () => {
  it('keeps document-switch semantics when editor-input merges into the batch', () => {
    const d = decideRefreshBatch(['editor-input', 'file-open'])
    expect(d.documentSwitch).toBe(true)
    expect(d.forceRefresh).toBe(true)
  })

  it('keeps document-switch semantics for active-leaf-change + mutation', () => {
    const d = decideRefreshBatch(['editor-mutation', 'active-leaf-change'])
    expect(d.documentSwitch).toBe(true)
    expect(d.forceRefresh).toBe(true)
  })

  it('a plain typing batch is neither a document switch nor forced', () => {
    const d = decideRefreshBatch(['editor-input', 'editor-keyup', 'focus-in'])
    // focus-in IS a force reason; assert the document-switch part is false.
    expect(d.documentSwitch).toBe(false)
    expect(d.forceRefresh).toBe(true)
    expect(decideRefreshBatch(['editor-input', 'editor-keyup']).forceRefresh).toBe(false)
  })

  it('an empty batch is a no-op decision', () => {
    expect(decideRefreshBatch([])).toEqual({ documentSwitch: false, forceRefresh: false })
  })

  it('document-switch reasons are a subset of force reasons', () => {
    for (const r of DOCUMENT_SWITCH_REASONS) expect(FORCE_REFRESH_REASON_IDS.has(r)).toBe(true)
  })
})
