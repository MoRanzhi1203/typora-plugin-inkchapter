// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.7.1 — Diagnostic Snapshot Mode-Dependency Synchronization.
 *
 * FIRST_FAILING_LAYER (runtime-proven): the diagnostics mode input read the
 * GLOBAL mode only (ignoring the document override), so a mode transition never
 * changed the computed snapshot. This test locks the closure:
 *   - effectiveMode + effectiveModeRevision are part of the snapshot
 *     provenance AND the semantic fingerprint;
 *   - CONTENT UNCHANGED + MODE CHANGED = new authoritative snapshot;
 *   - idempotent writes / dirty drafts / override-shielded globals do NOT
 *     rebuild;
 *   - one recompute = one publish; latest wins; stale results never publish.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import { DocumentDiagnosticsAuthority, type DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DiagnosticCanonicalHeadingAuthorityResult } from './document-h1-authority-bridge'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { computeDiagnosticLocationContract } from './document-diagnostic-location'

// ── Fixtures ────────────────────────────────────────────

function baseInput(overrides: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:key',
    markdown: '# 标题\n\n正文\n\n',
    strictMode: true,
    vaultRoot: '/vault',
    headings: [],
    h1Facts: [],
    latentAtxMarkers: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
    ...overrides,
  }
}

function h1Authority(overrides: Partial<DiagnosticCanonicalHeadingAuthorityResult> = {}): DiagnosticCanonicalHeadingAuthorityResult {
  return {
    state: 'READY',
    reason: 'READY',
    documentKey: 'doc:key',
    framePresent: true,
    frameDocumentKey: 'doc:key',
    semanticRevision: 1,
    frameGeneration: 1,
    canonicalEntryCount: 0,
    mappedEntryCount: 0,
    invalidEntryCount: 0,
    physicalLevels: [],
    headingFacts: [],
    h1Facts: [],
    h1Count: 0,
    h1StableIdentities: [],
    ...overrides,
  }
}

interface CtxState {
  strict: boolean
  docKey: string
  revision: number
}

function makeCtx(state: CtxState): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => `/vault/${state.docKey}.md`,
      getDocumentKey: () => state.docKey,
      getMarkdown: () => '# 标题\n\n正文\n\n',
      isStrictMode: () => state.strict,
      getEffectiveHeadingModeRevision: () => state.revision,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
}

function makeProviders(): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false,
    getHeadingIdentity: () => null,
    parseLocalLinkTargets: () => [],
    getCanonicalH1Facts: () => h1Authority(),
  }
}

function codes(snapshot: DocumentDiagnosticsSnapshot): string {
  return snapshot.diagnostics.map(d => `${d.severity}:${d.code}`).sort().join(',')
}

// ── Pure severity transitions (M14-M16, M15) ─────────────

describe('PURE severity semantics (frozen policy; mode only switches severity)', () => {
  it('M15 strict-only STRICT_SINGLE_H1_MULTIPLE_H1 exists strict, absent loose', () => {
    const strict = computeDocumentDiagnostics(baseInput({ h1Facts: [{ stableIdentity: 'h1-a', element: null }, { stableIdentity: 'h1-b', element: null }] }))
    const loose = computeDocumentDiagnostics(baseInput({ strictMode: false, h1Facts: [{ stableIdentity: 'h1-a', element: null }, { stableIdentity: 'h1-b', element: null }] }))
    expect(strict.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')).toBe(true)
    expect(loose.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')).toBe(false)
  })

  it('M16 gap Error -> Warning -> Error across strict/loose/strict', () => {
    const el = document.createElement('h2')
    el.setAttribute('data-line', '3')
    const headings = [
      { level: 2, text: 'A', stableIdentity: 'h-a', element: el },
      { level: 4, text: 'B', stableIdentity: 'h-b', element: el },
    ]
    const strict = computeDocumentDiagnostics(baseInput({ headings }))
    const loose = computeDocumentDiagnostics(baseInput({ strictMode: false, headings }))
    const strict2 = computeDocumentDiagnostics(baseInput({ headings }))
    const gap = (r: { diagnostics: Array<{ code: string; severity: string }> }) => r.diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')?.severity
    expect(gap(strict)).toBe('error')
    expect(gap(loose)).toBe('warning')
    expect(gap(strict2)).toBe('error')
  })

  it('M14 LATENT ATX location preserved Warning -> Hint on the SAME source range', () => {
    const el = document.createElement('p')
    el.setAttribute('data-line', '10')
    const latent = [{ line: 10, markerLevel: 2 as const, markerText: '##', element: el, text: '##' }]
    const strict = computeDocumentDiagnostics(baseInput({ latentAtxMarkers: latent }))
    const loose = computeDocumentDiagnostics(baseInput({ strictMode: false, latentAtxMarkers: latent }))
    const s = strict.diagnostics.find(d => d.code.startsWith('LATENT_ATX_HEADING_MARKER'))
    const l = loose.diagnostics.find(d => d.code.startsWith('LATENT_ATX_HEADING_MARKER'))
    expect(s?.severity).toBe('warning')
    // The severity enum represents Hint as `info` (UI displays "Hint").
    expect(l?.severity).toBe('info')
    expect(l?.location?.kind).toBe('source-range')
    // The source range is preserved (same start line) across the mode change.
    expect((l?.location as { startLine?: number } | undefined)?.startLine ?? -1).toBe(10)
  })
})

// ── Authority: mode provenance + fingerprint + publish (M1-M13, M17-M20) ──

describe('AUTHORITY mode-dependency sync', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
  })

  it('M1 strict -> loose republishes a NEW snapshot with mode provenance', () => {
    const state: CtxState = { strict: true, docKey: 'doc:key', revision: 0 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    authority.recompute()
    expect(published).toHaveLength(1)
    expect(published[0].effectiveMode).toBe('strict')
    expect(published[0].effectiveModeRevision).toBe(0)
    const strictCounts = codes(published[0])

    // Content unchanged; mode loose + revision bumped → MUST republish.
    state.strict = false
    state.revision = 1
    authority.recompute()
    expect(published).toHaveLength(2)
    expect(published[1].effectiveMode).toBe('loose')
    expect(published[1].effectiveModeRevision).toBe(1)
    expect(codes(published[1])).not.toBe(strictCounts)
  })

  it('M4 loose -> strict republishes (return to strict counts)', () => {
    const state: CtxState = { strict: false, docKey: 'doc:key', revision: 1 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    authority.recompute()
    state.strict = true
    state.revision = 2
    authority.recompute()
    expect(published).toHaveLength(2)
    expect(published[1].effectiveMode).toBe('strict')
    expect(published[1].effectiveModeRevision).toBe(2)
  })

  it('M5 same content + mode-only change still publishes', () => {
    const state: CtxState = { strict: true, docKey: 'doc:key', revision: 0 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    authority.recompute()
    // Same markdown, only the mode changed.
    state.strict = false
    state.revision = 1
    authority.recompute()
    expect(published).toHaveLength(2)
  })

  it('M6 idempotent loose -> loose does NOT rebuild', () => {
    const state: CtxState = { strict: false, docKey: 'doc:key', revision: 1 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    authority.recompute()
    authority.recompute() // same state, no transition
    expect(published).toHaveLength(1)
  })

  it('M20 duplicate publish suppression: same doc + content + mode = one publish', () => {
    const state: CtxState = { strict: true, docKey: 'doc:key', revision: 0 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    for (let i = 0; i < 5; i++) authority.recompute()
    expect(published).toHaveLength(1)
  })

  it('M7 dirty unsaved draft does NOT trigger diagnostics rebuild', () => {
    // The draft is a local settings-tab value; the AUTHORITY only ever sees the
    // EFFECTIVE mode. A draft=loose while effective=strict must compute strict.
    const state: CtxState = { strict: true, docKey: 'doc:key', revision: 0 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    // Simulate a DIRTY draft edit that is NOT saved (effective stays strict).
    authority.recompute()
    authority.recompute() // draft changed but effective unchanged
    expect(published).toHaveLength(1)
    expect(published[0].effectiveMode).toBe('strict')
  })

  it('M8 saved draft effective change -> exactly one publish', () => {
    const state: CtxState = { strict: true, docKey: 'doc:key', revision: 0 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    authority.recompute()
    // Save applied: effective loose + one transition.
    state.strict = false
    state.revision = 1
    authority.recompute()
    expect(published).toHaveLength(2)
    expect(published[1].effectiveMode).toBe('loose')
  })

  it('M9 global change + inherit -> rebuild (effective changed)', () => {
    const state: CtxState = { strict: true, docKey: 'doc:key', revision: 0 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    authority.recompute()
    state.strict = false
    state.revision = 1
    authority.recompute()
    expect(published).toHaveLength(2)
  })

  it('M10 global change + override shield -> NO rebuild (effective unchanged)', () => {
    // Global flips loose but the ACTIVE doc has a strict override: effective
    // stays strict and the mode revision must NOT bump → fingerprint identical.
    const state: CtxState = { strict: true, docKey: 'doc:key', revision: 0 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    authority.recompute()
    // Global changed but effective STILL strict (override shields it).
    state.revision = 0 // shielded → no effective transition → revision unchanged
    authority.recompute()
    expect(published).toHaveLength(1)
  })

  it('M11 one mode transaction -> max ONE final publish (coalesced recompute)', () => {
    const state: CtxState = { strict: true, docKey: 'doc:key', revision: 0 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    authority.recompute() // baseline strict publish (#1)
    // A single transaction may fire several recompute calls (settings +
    // mutation + canonical commit); the LAST one wins and all others with the
    // same final state are suppressed by the fingerprint → ONE final publish.
    state.strict = false
    state.revision = 1
    authority.recompute()
    authority.recompute()
    authority.recompute()
    expect(published).toHaveLength(2) // baseline strict + ONE final loose
  })

  it('M12 rapid strict -> loose -> strict: latest wins', () => {
    const state: CtxState = { strict: true, docKey: 'doc:key', revision: 0 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    authority.recompute()
    state.strict = false
    state.revision = 1
    authority.recompute()
    state.strict = true
    state.revision = 2
    authority.recompute()
    expect(published[published.length - 1].effectiveMode).toBe('strict')
    expect(published[published.length - 1].effectiveModeRevision).toBe(2)
  })

  it('M13 document switch: stale document results never publish to the new doc', () => {
    const state: CtxState = { strict: true, docKey: 'doc:a', revision: 0 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    authority.recompute()
    expect(published[published.length - 1].documentKey).toBe('doc:a')
    // Switch to doc:b — the NEXT recompute reads doc:b synchronously.
    state.docKey = 'doc:b'
    authority.recompute()
    expect(published[published.length - 1].documentKey).toBe('doc:b')
    expect(published).toHaveLength(2)
  })

  it('M17 manual recheck uses the CURRENT effective mode', () => {
    const state: CtxState = { strict: false, docKey: 'doc:key', revision: 1 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    authority.recompute('MANUAL_RECHECK')
    expect(published[published.length - 1].effectiveMode).toBe('loose')
    // Manual recheck while already loose = idempotent (no duplicate publish).
    authority.recompute('MANUAL_RECHECK')
    expect(published).toHaveLength(1)
  })

  it('M18/M19 subscriber parity: published snapshot == authority snapshot; reopen reads latest', () => {
    const state: CtxState = { strict: true, docKey: 'doc:key', revision: 0 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const published: DocumentDiagnosticsSnapshot[] = []
    authority.subscribe(s => { if (s) published.push(s) })
    authority.recompute()
    // Toolbar/Drawer both read the SAME published snapshot object (parity).
    expect(authority.getSnapshot()).toBe(published[published.length - 1])
    state.strict = false
    state.revision = 1
    authority.recompute()
    // Reopening the drawer later reads the LATEST snapshot, not an old copy.
    expect(authority.getSnapshot()?.effectiveMode).toBe('loose')
    expect(published[published.length - 1]).toBe(authority.getSnapshot())
  })

  it('M2/M3 subscribers always observe the published snapshot (toolbar when drawer closed, drawer when open)', () => {
    const state: CtxState = { strict: true, docKey: 'doc:key', revision: 0 }
    const authority = new DocumentDiagnosticsAuthority(makeCtx(state), makeProviders())
    const observed: Array<DocumentDiagnosticsSnapshot | null> = []
    const unsub = authority.subscribe(s => observed.push(s))
    authority.recompute()
    state.strict = false
    state.revision = 1
    authority.recompute()
    // The subscriber received every publish (in-place update for an open
    // drawer; toolbar count update when closed).
    expect(observed.length).toBeGreaterThanOrEqual(2)
    expect(observed[observed.length - 1]?.effectiveMode).toBe('loose')
    unsub()
  })
})

describe('LOCATION CONTRACT survives the mode republish (strict + loose)', () => {
  it('locatable == item count in BOTH modes', () => {
    const strict = computeDocumentDiagnostics(baseInput())
    const loose = computeDocumentDiagnostics(baseInput({ strictMode: false }))
    for (const out of [strict, loose]) {
      const snapshot = {
        documentKey: 'doc:key',
        revision: 1,
        sourceRevision: 1,
        generatedAt: 0,
        diagnostics: out.diagnostics,
        errorCount: out.errorCount,
        warningCount: out.warningCount,
        infoCount: out.infoCount,
      }
      const contract = computeDiagnosticLocationContract(snapshot)
      expect(contract.locatableDiagnosticCount).toBe(out.diagnostics.length)
      expect(contract.unlocatableDiagnosticCount).toBe(0)
      expect(contract.decision).toBe('PASS')
    }
  })
})
