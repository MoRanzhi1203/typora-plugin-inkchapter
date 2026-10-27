/**
 * PA-16 — a canonical frame commit must not force a FULL structural diagnostics
 * transaction when it is presentation-only (caret move / focus / re-bind).
 *
 * The gate deliberately uses the canonical heading authority's OWN semantic
 * fingerprint. It never consults `editor.getMarkdown()` (the incremental
 * mirror), which R10 proved is not a reliable "structure unchanged" signal.
 */
import { describe, it, expect } from 'vitest'
import { shouldRunDiagnosticsForFrame } from './document-utilities'

const NONE = { documentKey: null, semanticFingerprint: null }

describe('PA-16 canonical-frame diagnostics gate', () => {
  it('runs when there is no previous transaction', () => {
    expect(shouldRunDiagnosticsForFrame({ documentKey: 'doc-a', semanticFingerprint: 'fp-1' }, NONE)).toBe(true)
  })

  it('skips a presentation-only commit of the SAME document + fingerprint', () => {
    expect(shouldRunDiagnosticsForFrame(
      { documentKey: 'doc-a', semanticFingerprint: 'fp-1' },
      { documentKey: 'doc-a', semanticFingerprint: 'fp-1' },
    )).toBe(false)
  })

  it('runs when the heading semantic fingerprint changes', () => {
    expect(shouldRunDiagnosticsForFrame(
      { documentKey: 'doc-a', semanticFingerprint: 'fp-2' },
      { documentKey: 'doc-a', semanticFingerprint: 'fp-1' },
    )).toBe(true)
  })

  it('runs for a different document even with an identical fingerprint', () => {
    expect(shouldRunDiagnosticsForFrame(
      { documentKey: 'doc-b', semanticFingerprint: 'fp-1' },
      { documentKey: 'doc-a', semanticFingerprint: 'fp-1' },
    )).toBe(true)
  })

  it('never skips without evidence (missing frame / key / fingerprint)', () => {
    expect(shouldRunDiagnosticsForFrame(undefined, { documentKey: 'doc-a', semanticFingerprint: 'fp-1' })).toBe(true)
    expect(shouldRunDiagnosticsForFrame({ semanticFingerprint: 'fp-1' }, { documentKey: 'doc-a', semanticFingerprint: 'fp-1' })).toBe(true)
    expect(shouldRunDiagnosticsForFrame({ documentKey: 'doc-a' }, { documentKey: 'doc-a', semanticFingerprint: 'fp-1' })).toBe(true)
  })
})
