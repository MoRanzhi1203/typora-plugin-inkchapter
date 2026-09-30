// @vitest-environment jsdom
/**
 * V1 — Heading Diagnostic Active Persistence targeted suite.
 *
 * THE DEFECT: after a `layoutEpoch 37 → 38` reconcile the passive markers were
 * rebuilt while the ACTIVE emphasis was dropped, and because the passive-fill
 * suppression was derived from the heading IDENTITY (not from a REAL active fill)
 * the target ended as `activeMarkerPresent=true` + `activeFragmentRects=[]` +
 * `fillFragmentCount=0` + `passiveFillSuppressed=true` — a visual vacuum that
 * still audited PASS.
 *
 * Covered here:
 *   V1-IDENTITY-*  the two target-index namespaces + canonical keys (§7/§8/§9/§65)
 *   V1-SCOPE-*     cross-diagnostic active scope (§24/§25/§26)
 *   V1-AUDIT-*     the marker audit success condition (§27/§28/§62)
 *   V1-CLOSURE-*   the post-reconcile closure (§30/§32/§33)
 *   V1-GATE-*      the hard gates + the positive coverage (§38/§39)
 *   V1-HOST-*      the REAL host: active fill survives layout/geometry rebuilds
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  HEADING_ACTIVE_PERSISTENCE_V1_COVERAGE_KEYS,
  HEADING_ACTIVE_PERSISTENCE_V1_GATE_KEYS,
  activeTargetScopeForDiagnostic,
  buildCanonicalDiagnosticTargetKey,
  buildCanonicalDrawerRowKey,
  createHeadingActivePersistenceV1Counters,
  createHeadingActivePersistenceV1CoverageCounters,
  evaluateActiveVisualReadiness,
  evaluateHeadingActivePersistenceV1Coverage,
  evaluateHeadingActivePersistenceV1Gates,
  evaluateHeadingMarkerAuditDecision,
  evaluateHeadingPostReconcileClosure,
  formatHeadingActivePersistenceV1CoverageReport,
  formatHeadingActivePersistenceV1GateReport,
  parseCanonicalTargetKeyIndex,
  resolveCanonicalTargetIndexAuthority,
  type HeadingActiveVisualFacts,
} from './document-diagnostic-heading-active-persistence-v1'
import {
  HEADING_MULTI_TARGET_V2_COVERAGE_KEYS,
  HEADING_MULTI_TARGET_V2_GATE_KEYS,
  createHeadingMultiTargetV2Counters,
  createHeadingMultiTargetV2CoverageCounters,
  evaluateActiveTargetAuthority,
  evaluateHeadingMultiTargetV2Coverage,
  evaluateHeadingMultiTargetV2Gates,
  evaluateStrictMultiH1CurrentSnapshot,
  formatHeadingMultiTargetV2CoverageReport,
  formatHeadingMultiTargetV2GateReport,
  parseCanonicalTargetKeyIdentityV2,
  parseCanonicalTargetKeyIndexV2,
  resolveCanonicalActiveHeadingTarget,
} from './document-diagnostic-canonical-active-target-v2'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

// ── §7/§8/§9/§65 — the target-index namespaces ────────────────────────────

describe('V1-IDENTITY — the two target-index namespaces never alias', () => {
  it('a narrowed transaction (local 0) keeps the canonical diagnostic index', () => {
    const narrowed = resolveCanonicalTargetIndexAuthority({
      diagnosticTargetIndex: 1,
      transactionLocalTargetIndex: 0,
      transactionTargetCount: 1,
    })
    expect(narrowed.canonicalDiagnosticTargetIndex).toBe(1)
    expect(narrowed.transactionLocalTargetIndex).toBe(0)
    expect(narrowed.aliased).toBe(false)
    expect(narrowed.reason).toBe('TARGET_INDEX_NAMESPACES_SEPARATED')
  })

  it('the alias defect is DETECTED when the local index is encoded as canonical', () => {
    // the legacy bug: the canonical key was encoded with the local index (0)
    // although the user clicked the SECOND subtarget (canonical index 1).
    const aliased = resolveCanonicalTargetIndexAuthority({
      diagnosticTargetIndex: 1,
      transactionLocalTargetIndex: 0,
      transactionTargetCount: 1,
      reportedCanonicalIndex: 0,
    })
    expect(aliased.aliased).toBe(true)
    expect(aliased.reason).toBe('TRANSACTION_LOCAL_INDEX_ALIASES_DIAGNOSTIC_INDEX')
    // and the canonical index it RETURNS is still the diagnostic one.
    expect(aliased.canonicalDiagnosticTargetIndex).toBe(1)
    // no alias when the caller encodes the diagnostic index.
    expect(resolveCanonicalTargetIndexAuthority({
      diagnosticTargetIndex: 1, transactionLocalTargetIndex: 0, transactionTargetCount: 1, reportedCanonicalIndex: 1,
    }).aliased).toBe(false)
  })

  it('the canonical target key / drawer row key encode the DIAGNOSTIC index (§8/§9/§73)', () => {
    const one = buildCanonicalDiagnosticTargetKey({
      documentKey: 'doc', diagnosticId: 'STRICT_SINGLE_H1_MULTIPLE_H1', diagnosticTargetIndex: 0, stableHeadingIdentity: 'id:H1:idx:4',
    })
    const two = buildCanonicalDiagnosticTargetKey({
      documentKey: 'doc', diagnosticId: 'STRICT_SINGLE_H1_MULTIPLE_H1', diagnosticTargetIndex: 1, stableHeadingIdentity: 'id:H1:idx:8',
    })
    expect(one).toBe('doc::STRICT_SINGLE_H1_MULTIPLE_H1::0::id:H1:idx:4')
    expect(two).toBe('doc::STRICT_SINGLE_H1_MULTIPLE_H1::1::id:H1:idx:8')
    expect(one).not.toBe(two)
    expect(parseCanonicalTargetKeyIndex(one)).toBe(0)
    expect(parseCanonicalTargetKeyIndex(two)).toBe(1)

    const rowOne = buildCanonicalDrawerRowKey({ diagnosticId: 'STRICT_SINGLE_H1_MULTIPLE_H1', diagnosticTargetIndex: 0, stableHeadingIdentity: 'id:H1:idx:4' })
    const rowTwo = buildCanonicalDrawerRowKey({ diagnosticId: 'STRICT_SINGLE_H1_MULTIPLE_H1', diagnosticTargetIndex: 1, stableHeadingIdentity: 'id:H1:idx:8' })
    expect(rowOne).not.toBe(rowTwo)
    expect(parseCanonicalTargetKeyIndex(rowOne)).toBe(0)
    expect(parseCanonicalTargetKeyIndex(rowTwo)).toBe(1)
    // §73 — same diagnosticId, different rowKey / targetKey / identity
    expect(rowOne.startsWith('STRICT_SINGLE_H1_MULTIPLE_H1::')).toBe(true)
    expect(rowTwo.startsWith('STRICT_SINGLE_H1_MULTIPLE_H1::')).toBe(true)
  })
})

// ── §23/§28 — the state-derived readiness ─────────────────────────────────

function facts(over: Partial<HeadingActiveVisualFacts> = {}): HeadingActiveVisualFacts {
  return {
    fragmentCount: 1, fragmentRects: [{ left: 0, top: 0, width: 10, height: 10 }],
    layoutEpoch: 5, geometryGeneration: 9, diagnosticId: 'E1', targetKey: 'doc::E1::0::H-A',
    diagnosticTargetIndex: 0, transactionLocalTargetIndex: 0,
    stableHeadingIdentity: 'H-A', headingIdentity: 'id:H-A', interactionVersion: 1,
    ...over,
  }
}

describe('V1-READINESS — activeMarkerPresent derives from REAL fragments (§21/§28)', () => {
  it('is ready only with fragments AND the current epochs AND a connected wrapper', () => {
    expect(evaluateActiveVisualReadiness({ facts: facts(), wrapperConnected: true, currentLayoutEpoch: 5, currentGeometryGeneration: 9 }).ready).toBe(true)
  })
  it('is NOT ready with zero fragments', () => {
    const r = evaluateActiveVisualReadiness({ facts: facts({ fragmentCount: 0 }), wrapperConnected: true, currentLayoutEpoch: 5, currentGeometryGeneration: 9 })
    expect(r.ready).toBe(false)
    expect(r.reason).toBe('ACTIVE_FRAGMENT_COUNT_ZERO')
  })
  it('is NOT ready after a layoutEpoch / geometryGeneration change', () => {
    expect(evaluateActiveVisualReadiness({ facts: facts(), wrapperConnected: true, currentLayoutEpoch: 6, currentGeometryGeneration: 9 }).reason)
      .toBe('ACTIVE_VISUAL_LAYOUT_EPOCH_STALE')
    expect(evaluateActiveVisualReadiness({ facts: facts(), wrapperConnected: true, currentLayoutEpoch: 5, currentGeometryGeneration: 10 }).reason)
      .toBe('ACTIVE_VISUAL_GEOMETRY_GENERATION_STALE')
  })
  it('is NOT ready when the wrapper is gone (the legacy phantom-marker state)', () => {
    expect(evaluateActiveVisualReadiness({ facts: facts(), wrapperConnected: false, currentLayoutEpoch: 5, currentGeometryGeneration: 9 }).ready).toBe(false)
    expect(evaluateActiveVisualReadiness({ facts: null, wrapperConnected: true, currentLayoutEpoch: 5, currentGeometryGeneration: 9 }).ready).toBe(false)
  })
})

// ── §24/§25/§26 — the cross-diagnostic scope ──────────────────────────────

describe('V1-SCOPE — a foreign active target is never in scope', () => {
  it('returns null for another diagnostic (the H3 leak)', () => {
    const scope = activeTargetScopeForDiagnostic({
      phase: 'ACTIVE',
      activeDiagnosticId: 'HEADING_LEVEL_GAP:H3:idx:9',
      activeTargetKey: 'doc::HEADING_LEVEL_GAP:H3:idx:9::0::id:H3:idx:9',
      activeHeadingIdentity: 'id:H3:idx:9',
      activeDiagnosticTargetIndex: 0,
      diagnosticId: 'STRICT_SINGLE_H1_MULTIPLE_H1',
    })
    expect(scope.belongsToDiagnostic).toBe(false)
    expect(scope.activeHeadingIdentity).toBeNull()
    expect(scope.activeTargetKey).toBeNull()
  })
  it('returns the own target when the active belongs to this diagnostic', () => {
    const scope = activeTargetScopeForDiagnostic({
      phase: 'ACTIVE',
      activeDiagnosticId: 'MULTI',
      activeTargetKey: 'doc::MULTI::1::id:H1:idx:8',
      activeHeadingIdentity: 'id:H1:idx:8',
      activeDiagnosticTargetIndex: 1,
      diagnosticId: 'MULTI',
    })
    expect(scope.belongsToDiagnostic).toBe(true)
    expect(scope.activeHeadingIdentity).toBe('id:H1:idx:8')
    expect(scope.activeDiagnosticTargetIndex).toBe(1)
  })
})

// ── §27/§28/§62 — the audit success condition ─────────────────────────────

describe('V1-AUDIT — a marker boolean with zero fill can never PASS (§27/§62)', () => {
  const base = {
    activeOwned: true,
    activeMarkerPresent: true,
    activeFragmentCount: 1,
    activeFillCount: 1,
    activeFragmentMeasurable: true,
    activeFragmentVisible: true,
    activeFragmentHeadingIdentityMatches: true,
    activeFragmentLayoutEpochCurrent: true,
    activeFragmentGeometryGenerationCurrent: true,
    passiveFillSuppressed: true,
  }
  it('PASSes only when the active fill really exists', () => {
    expect(evaluateHeadingMarkerAuditDecision(base).decision).toBe('PASS')
  })
  it('FAILs the exact runtime defect: marker present + zero fragments/fill', () => {
    const d = evaluateHeadingMarkerAuditDecision({ ...base, activeFragmentCount: 0, activeFillCount: 0 })
    expect(d.decision).toBe('FAIL')
    expect(d.failedChecks).toContain('ACTIVE_HEADING_WITH_ZERO_FRAGMENT')
    expect(d.failedChecks).toContain('ACTIVE_HEADING_WITH_ZERO_FILL')
    expect(d.failedChecks).toContain('MARKER_BOOLEAN_WITHOUT_FRAGMENT')
    expect(d.failedChecks).toContain('PASSIVE_SUPPRESSED_WITHOUT_ACTIVE_FILL')
    expect(d.effectiveActiveMarkerPresent).toBe(false)
  })
  it('FAILs when the active visual was measured in a stale epoch/generation', () => {
    expect(evaluateHeadingMarkerAuditDecision({ ...base, activeFragmentLayoutEpochCurrent: false }).failedChecks)
      .toContain('ACTIVE_VISUAL_LOST_AFTER_LAYOUT_EPOCH')
    expect(evaluateHeadingMarkerAuditDecision({ ...base, activeFragmentGeometryGenerationCurrent: false }).failedChecks)
      .toContain('ACTIVE_VISUAL_LOST_AFTER_GEOMETRY_GENERATION')
  })
  it('a PASSIVE heading with a suppressed fill is a violation of its own', () => {
    const d = evaluateHeadingMarkerAuditDecision({ ...base, activeOwned: false, passiveFillSuppressed: true })
    expect(d.decision).toBe('FAIL')
    expect(d.failedChecks).toContain('PASSIVE_SUPPRESSED_WITHOUT_ACTIVE_OWNER')
  })
})

// ── §30/§32/§33 — the post-reconcile closure ──────────────────────────────

describe('V1-CLOSURE — post-reconcile closure (not just click settle)', () => {
  const active = {
    phase: 'ACTIVE' as const,
    activeTargetIsHeading: true,
    selectedActiveRowCount: 1,
    activeTargetCount: 1,
    activeHeadingFragmentCount: 1,
    activeFillCount: 1,
    activeLeasePresent: true,
    activeTargetKeyMatchesState: true,
    activeHeadingIdentityMatchesTargetKey: true,
    activeFragmentLayoutEpochCurrent: true,
    activeFragmentGeometryGenerationCurrent: true,
    drawerActiveRowCount: 1,
  }
  it('PASSes a fully closed post-layout state', () => {
    expect(evaluateHeadingPostReconcileClosure(active).decision).toBe('PASS')
  })
  it('FAILs the runtime vacuum (active heading with zero fill)', () => {
    const d = evaluateHeadingPostReconcileClosure({ ...active, activeHeadingFragmentCount: 0, activeFillCount: 0, activeTargetCount: 0 })
    expect(d.decision).toBe('FAIL')
    expect(d.failedChecks).toContain('ACTIVE_HEADING_FRAGMENT_COUNT_ZERO')
    expect(d.failedChecks).toContain('ACTIVE_FILL_COUNT_ZERO')
  })
  it('FAILs when the Drawer row and the heading visual disagree (§33)', () => {
    expect(evaluateHeadingPostReconcileClosure({ ...active, drawerActiveRowCount: 0 }).failedChecks)
      .toContain('DRAWER_ACTIVE_ROW_COUNT_NOT_ONE')
    expect(evaluateHeadingPostReconcileClosure({ ...active, activeFragmentLayoutEpochCurrent: false }).failedChecks)
      .toContain('ACTIVE_FRAGMENT_LAYOUT_EPOCH_STALE')
    expect(evaluateHeadingPostReconcileClosure({ ...active, activeFragmentGeometryGenerationCurrent: false }).failedChecks)
      .toContain('ACTIVE_FRAGMENT_GEOMETRY_GENERATION_STALE')
  })
  it('a true IDLE must leave nothing behind (§49/§50)', () => {
    const idle = {
      ...active, phase: 'IDLE' as const, activeTargetIsHeading: false,
      activeHeadingFragmentCount: 0, activeFillCount: 0, activeLeasePresent: false, drawerActiveRowCount: 0,
    }
    expect(evaluateHeadingPostReconcileClosure(idle).decision).toBe('PASS')
    expect(evaluateHeadingPostReconcileClosure({ ...idle, activeLeasePresent: true }).failedChecks)
      .toContain('IDLE_WITH_ACTIVE_LEASE')
    expect(evaluateHeadingPostReconcileClosure({ ...idle, activeFillCount: 1 }).failedChecks)
      .toContain('IDLE_WITH_ACTIVE_FILL')
  })
  it('a NON-heading active target may hold a lease but never a heading fill', () => {
    const nonHeading = { ...active, activeTargetIsHeading: false, activeHeadingFragmentCount: 0, activeFillCount: 0 }
    expect(evaluateHeadingPostReconcileClosure(nonHeading).decision).toBe('PASS')
    expect(evaluateHeadingPostReconcileClosure({ ...nonHeading, activeHeadingFragmentCount: 1 }).decision).toBe('FAIL')
  })
})

// ── §38/§39 — the gates + coverage ────────────────────────────────────────

describe('V1-GATE — the active-persistence hard gates and coverage', () => {
  it('covers every required counter and all-zero PASSes', () => {
    expect(HEADING_ACTIVE_PERSISTENCE_V1_GATE_KEYS.length).toBeGreaterThanOrEqual(23)
    const counters = createHeadingActivePersistenceV1Counters()
    expect(formatHeadingActivePersistenceV1GateReport(counters)).toHaveLength(HEADING_ACTIVE_PERSISTENCE_V1_GATE_KEYS.length)
    expect(evaluateHeadingActivePersistenceV1Gates(counters).decision).toBe('PASS')
    for (const key of [
      'activeHeadingWithZeroFill', 'activeHeadingVisualLostAfterLayoutEpoch',
      'multiTargetHeadingActiveTargetKeyMismatch', 'crossDiagnosticActiveTargetLeak',
      'drawerActiveRowWithoutHeadingActiveVisual', 'staleHeadingVisualCallbackApplied',
    ] as const) {
      const c = createHeadingActivePersistenceV1Counters()
      c[key] = 1
      expect(evaluateHeadingActivePersistenceV1Gates(c).decision).toBe('FAIL')
    }
  })

  it('the coverage minima are the six positive counters (§39/§61)', () => {
    expect(HEADING_ACTIVE_PERSISTENCE_V1_COVERAGE_KEYS).toHaveLength(6)
    const coverage = createHeadingActivePersistenceV1CoverageCounters()
    expect(evaluateHeadingActivePersistenceV1Coverage(coverage).decision).toBe('FAIL')
    coverage.activeHeadingInitialActivateRuntime = 1
    coverage.activeHeadingSwitchRuntime = 1
    coverage.activeHeadingRebuiltAfterLayoutEpoch = 1
    coverage.activeHeadingRebuiltAfterGeometryGeneration = 1
    coverage.multiTargetHeadingDistinctSubtargetActivation = 2
    coverage.headingSameTargetDeactivateRuntime = 1
    expect(formatHeadingActivePersistenceV1CoverageReport(coverage)).toHaveLength(6)
    expect(evaluateHeadingActivePersistenceV1Coverage(coverage).decision).toBe('PASS')
  })
})

// ── the REAL host (§20/§23/§30/§67) ───────────────────────────────────────

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
let host: DocumentUtilityOverlayHost | null = null
let infoSpy: InfoSpy | null = null
let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1

async function flushRaf(): Promise<void> {
  let guard = 0
  while (rafTasks.size > 0 && guard++ < 400) {
    const cur = Array.from(rafTasks.values())
    rafTasks.clear()
    for (const cb of cur) cb(0)
    await Promise.resolve()
  }
}

function stubRect(el: Element, getRect: () => { left: number; top: number; right: number; bottom: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const r = getRect()
      return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }
    },
  })
}
function stubRangeRects(rects: Array<{ left: number; top: number; right: number; bottom: number }>): void {
  const fake = {
    setStart(): void { /* noop */ },
    setEnd(): void { /* noop */ },
    getClientRects: () => rects.map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top })),
  }
  ;(document as unknown as { createRange: () => unknown }).createRange = () => fake
}
function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# t',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  } as unknown as DocumentUtilitiesContext
}
function fakeProviders(): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false,
    getHeadingIdentity: (el: HTMLElement) => el.getAttribute('data-id'),
    parseLocalLinkTargets: () => [],
    getObjectCaptionHost: () => null,
  } as unknown as DocumentDiagnosticsProviders
}

type InteractionStateView = {
  version: number
  phase: 'IDLE' | 'ACTIVE'
  diagnosticId: string | null
  targetKey: string | null
  diagnosticTargetIndex: number | null
  transactionLocalTargetIndex: number | null
}
type HostApi = {
  renderHeadingDiagnosticMarkers(): void
  renderHeadingActiveEmphasis(id: string, diag: unknown, el: HTMLElement): void
  clearHeadingActiveEmphasis(): void
  currentDocumentLayoutEpoch: number
  getDiagnosticInteractionStateV2(): InteractionStateView
  getHeadingActivePersistenceFacts(): Readonly<HeadingActiveVisualFacts> | null
  getHeadingActivePersistenceV1GateReport(): string[]
  getHeadingActivePersistenceV1CoverageReport(): string[]
  getHeadingActivePersistenceV1GateDecision(): {
    decision: 'PASS' | 'FAIL'
    failedChecks: readonly string[]
    unmetCoverage: readonly string[]
    gateDecision: 'PASS' | 'FAIL'
    coverageDecision: 'PASS' | 'FAIL'
  }
  getActiveTargetAuthoritySnapshot(): {
    decision: 'PASS' | 'FAIL'
    reason: string
    failedChecks: readonly string[]
    matches: {
      diagnosticIdMatch: boolean
      diagnosticTargetIndexMatch: boolean
      targetKeyMatch: boolean
      stableHeadingIdentityMatch: boolean
      drawerAuthorityMatch: boolean
      leaseAuthorityMatch: boolean
    }
    visualOnForeignHeading: boolean
  }
  getMultiTargetV2Counters(): Record<string, number>
  getMultiTargetV2GateReport(): string[]
  getMultiTargetV2CoverageReport(): string[]
  getMultiTargetV2GateDecision(): {
    decision: 'PASS' | 'FAIL'
    gateDecision: 'PASS' | 'FAIL'
    coverageDecision: 'PASS' | 'FAIL'
    failedChecks: readonly string[]
    unmetCoverage: readonly string[]
  }
}
type MatrixInternals = {
  locateDiagnostic(id: string, targetIndex?: number): void
  renderDrawer(): void
  refreshDrawerActiveRow(): void
  bumpDocumentLayoutEpoch(kind: string): boolean
  visualGeometryGeneration: number
}
function matrixInternals(h: DocumentUtilityOverlayHost): MatrixInternals {
  return h as unknown as MatrixInternals
}

function makeWorld(headingCount = 3): { h: DocumentUtilityOverlayHost; headings: HTMLElement[] } {
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  stubRect(write, () => ({ left: 0, top: 0, right: 900, bottom: 3000 }))
  const headings: HTMLElement[] = []
  for (let i = 0; i < headingCount; i++) {
    const h = document.createElement('h2')
    h.setAttribute('data-id', `H-${String.fromCharCode(65 + i)}`)
    h.setAttribute('data-line', String(4 + i))
    h.textContent = `标题${i + 1}`
    write.appendChild(h)
    stubRect(h, () => ({ left: 100, top: 200 + i * 100, right: 1000, bottom: 232 + i * 100 }))
    headings.push(h)
  }
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, headings }
}
function diagFor(id: string, headingId: string, severity: string, code: string): Record<string, unknown> {
  return {
    id, documentKey: 'doc:key', severity, category: 'heading', code, message: 'm', detail: '',
    stableIdentity: headingId, metadata: {},
    location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: headingId },
  } as unknown as Record<string, unknown>
}
function inject(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>, revision = 1): void {
  const snapshot = {
    documentKey: 'doc:key', revision, sourceRevision: revision, generatedAt: 0,
    diagnostics: diags, errorCount: 1, warningCount: 2, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for the marker test */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}
const api = (): HostApi => host as unknown as HostApi
const diagEl = (id: string) => ({
  id, severity: id.startsWith('E') ? 'error' : 'warning', code: 'HEADING_LEVEL_GAP', message: 'm', metadata: {},
})
const activeFragmentCount = (): number => document.querySelectorAll('.inkchapter-heading-diagnostic-active__fragment').length

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  rafTasks = new Map<number, FrameRequestCallback>()
  rafSeq = 1
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: FrameRequestCallback): number => { const id = rafSeq++; rafTasks.set(id, cb); return id }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number): void => { rafTasks.delete(id) }
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  stubRangeRects([{ left: 200, top: 204, right: 420, bottom: 228 }])
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

describe('V2-HOST — the ACTIVE visual belongs to the CANONICAL multi-target', () => {
  it('TEST-V2-2 — 2/2 initial activate binds State / Drawer / Visual to H-C', async () => {
    const w = matrixWorld()
    host = w.h
    inject(host, matrixDiags(), 11)
    matrixInternals(host).renderDrawer()

    await clickDrawerRow('MH', 1)
    const st = api().getDiagnosticInteractionStateV2()
    expect(st.diagnosticTargetIndex).toBe(1)
    expect(parseCanonicalTargetKeyIndexV2(st.targetKey)).toBe(1)
    expect(parseCanonicalTargetKeyIdentityV2(st.targetKey)).toBe('H-C')
    // the Drawer selected the 2/2 row, never the 1/2 row
    expect(rowEl('MH', 1)!.classList.contains('is-selected')).toBe(true)
    expect(rowEl('MH', 0)!.classList.contains('is-selected')).toBe(false)
    // the ACTIVE facts are SELF-IDENTIFYING
    const facts = api().getHeadingActivePersistenceFacts()
    expect(facts).not.toBeNull()
    expect(facts!.diagnosticTargetIndex).toBe(1)
    expect(facts!.stableHeadingIdentity).toBe('H-C')
    expect(facts!.headingIdentity).toBe('id:H-C')
    expect(facts!.targetKey).toBe(st.targetKey)
    // the ACTIVE DOM wrapper carries the canonical authority (State -> DOM)
    const active = document.querySelector<HTMLElement>('.inkchapter-heading-diagnostic-active')
    expect(active).not.toBeNull()
    expect(active!.getAttribute('data-ink-diagnostic-target-index')).toBe('1')
    expect(active!.getAttribute('data-ink-heading-identity')).toBe('id:H-C')
    expect(active!.getAttribute('data-ink-target-key')).toBe(st.targetKey)
    expect(activeFragmentCount()).toBeGreaterThanOrEqual(1)
    const authority = api().getActiveTargetAuthoritySnapshot()
    expect(authority.matches.targetKeyMatch).toBe(true)
    expect(authority.matches.diagnosticTargetIndexMatch).toBe(true)
    expect(authority.matches.stableHeadingIdentityMatch).toBe(true)
    expect(authority.matches.drawerAuthorityMatch).toBe(true)
  })

  it('TEST-V2-3 — 2/2 SURVIVES a layoutEpoch rebuild (never falls back to 1/2)', async () => {
    const w = matrixWorld()
    host = w.h
    inject(host, matrixDiags(), 12)
    matrixInternals(host).renderDrawer()
    await clickDrawerRow('MH', 1)
    const before = api().getHeadingActivePersistenceFacts()!
    expect(before.stableHeadingIdentity).toBe('H-C')

    matrixInternals(host).bumpDocumentLayoutEpoch('PLUGIN_DOM_MUTATION')
    api().renderHeadingDiagnosticMarkers()
    await flushRaf()

    const after = api().getHeadingActivePersistenceFacts()
    expect(after).not.toBeNull()
    expect(after!.stableHeadingIdentity).toBe('H-C')
    expect(after!.diagnosticTargetIndex).toBe(1)
    expect(after!.targetKey).toBe(before.targetKey)
    expect(after!.fragmentCount).toBeGreaterThanOrEqual(1)
    expect(api().getActiveTargetAuthoritySnapshot().matches.stableHeadingIdentityMatch).toBe(true)
    expect(api().getMultiTargetV2GateDecision().gateDecision, api().getMultiTargetV2GateReport().join(' | ')).toBe('PASS')
  })

  it('TEST-V2-4 — 2/2 SURVIVES a geometryGeneration rebuild', async () => {
    const w = matrixWorld()
    host = w.h
    inject(host, matrixDiags(), 13)
    matrixInternals(host).renderDrawer()
    await clickDrawerRow('MH', 1)
    const before = api().getHeadingActivePersistenceFacts()!
    api().renderHeadingDiagnosticMarkers()
    await flushRaf()
    const after = api().getHeadingActivePersistenceFacts()
    expect(after).not.toBeNull()
    expect(after!.stableHeadingIdentity).toBe('H-C')
    expect(after!.geometryGeneration).toBeGreaterThanOrEqual(before.geometryGeneration)
    expect(api().getActiveTargetAuthoritySnapshot().matches.stableHeadingIdentityMatch).toBe(true)
  })

  it('TEST-V2-5 — 1/2 → 2/2 → 1/2 keeps the EXACT identity at every step', async () => {
    const w = matrixWorld()
    host = w.h
    inject(host, matrixDiags(), 14)
    matrixInternals(host).renderDrawer()

    await clickDrawerRow('MH', 0)
    const one = api().getHeadingActivePersistenceFacts()!
    expect(one.stableHeadingIdentity).toBe('H-B')
    expect(one.diagnosticTargetIndex).toBe(0)

    await clickDrawerRow('MH', 1)
    const two = api().getHeadingActivePersistenceFacts()!
    expect(two.stableHeadingIdentity).toBe('H-C')
    expect(two.diagnosticTargetIndex).toBe(1)
    expect(two.targetKey).not.toBe(one.targetKey)

    await clickDrawerRow('MH', 0)
    const back = api().getHeadingActivePersistenceFacts()!
    expect(back.stableHeadingIdentity).toBe('H-B')
    expect(back.diagnosticTargetIndex).toBe(0)
    expect(back.targetKey).toBe(one.targetKey)
    expect(activeFragmentCount()).toBeGreaterThanOrEqual(1)
  })

  it('TEST-V2-8 — same-target DEACTIVATE tears down ATOMICALLY (closure after teardown)', async () => {
    const w = matrixWorld()
    host = w.h
    inject(host, matrixDiags(), 15)
    matrixInternals(host).renderDrawer()
    await clickDrawerRow('MH', 1)
    expect(isSelectedRowCount()).toBe(1)

    await clickDrawerRow('MH', 1)
    const st = api().getDiagnosticInteractionStateV2()
    expect(st.phase).toBe('IDLE')
    expect(isSelectedRowCount()).toBe(0)
    expect(activeFragmentCount()).toBe(0)
    expect(api().getHeadingActivePersistenceFacts()).toBeNull()
    const closure = lastAuditWith('DOCUMENT-DIAGNOSTIC-HEADING-POST-RECONCILE-CLOSURE', 'trigger', 'SAME_TARGET_DEACTIVATE_TEARDOWN_COMMITTED')
    expect(closure.decision).toBe('PASS')
    expect(closure.phase).toBe('IDLE')
    expect(closure.activeFillCount).toBe('0')
    expect(closure.activeLeasePresent).toBe('false')
    expect(api().getMultiTargetV2Counters().deactivateClosureBeforeTeardownCommit).toBe(0)
    expect(api().getMultiTargetV2Counters().idleWithActiveFill).toBe(0)
    expect(api().getMultiTargetV2Counters().idleWithActiveLease).toBe(0)
  })

  it('TEST-V2-7 — the visual projection NEVER mutates the interaction state', async () => {
    const w = matrixWorld()
    host = w.h
    inject(host, matrixDiags(), 16)
    matrixInternals(host).renderDrawer()
    await clickDrawerRow('MH', 1)

    const before = api().getDiagnosticInteractionStateV2()
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingDiagnosticMarkers()
    await flushRaf()
    const after = api().getDiagnosticInteractionStateV2()
    expect(after).toEqual(before)
    expect(api().getMultiTargetV2Counters().visualProjectionWroteInteractionState).toBe(0)
    expect(api().getMultiTargetV2Counters().visualProjectionAttemptedWithoutActiveState).toBe(0)
  })

  it('TEST-V2-10 — cross-diagnostic: the strict multi-H1 audit never reads the GAP target', async () => {
    const w = matrixWorld()
    host = w.h
    inject(host, matrixDiags(), 17)
    matrixInternals(host).renderDrawer()
    await clickDrawerRow('GAP', 0)
    const strictAudit = lastAudit('STRICT-MULTI-H1-VISUAL-AUDIT')
    expect(strictAudit.activeTargetIdentity).toBe('null')
    expect(strictAudit.activeTargetBelongsToAudit).toBe('false')
    expect(api().getMultiTargetV2Counters().activeStateVisualHeadingIdentityMismatch).toBe(0)
  })
})

describe('V2-PURE — the canonical resolver / identity closure / current snapshot', () => {
  const state = (over: Partial<{ phase: 'IDLE' | 'ACTIVE'; diagnosticId: string | null; targetKey: string | null; diagnosticTargetIndex: number | null }> = {}) => ({
    phase: 'ACTIVE' as const,
    diagnosticId: 'MH',
    targetKey: 'doc:key::MH::1::H-C',
    diagnosticTargetIndex: 1,
    transactionLocalTargetIndex: 0,
    ...over,
  })
  const projections = [
    { diagnosticId: 'MH', targetIndex: 0, stableIdentity: 'H-B' },
    { diagnosticId: 'MH', targetIndex: 1, stableIdentity: 'H-C' },
  ]
  const element = () => {
    const el = document.createElement('h1')
    el.setAttribute('data-id', 'H-C')
    // the resolver FAILS CLOSED on a disconnected target, so mount it.
    document.body.appendChild(el)
    return el
  }

  it('TEST-V2-1 — targetIndex 1 resolves H-C (never H-B / targets[0])', () => {
    const r = resolveCanonicalActiveHeadingTarget({
      state: state(),
      documentKey: 'doc:key',
      diagnostic: { id: 'MH', severity: 'error', stableIdentity: 'H-B', isMultiTarget: true },
      projections,
      resolveHeadingElement: () => element(),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.target.stableHeadingIdentity).toBe('H-C')
    expect(r.target.diagnosticTargetIndex).toBe(1)
    expect(r.target.headingIdentity).toBe('id:H-C')
  })

  it('TEST-V2-1b — a targetKey that encodes the WRONG index FAILS CLOSED', () => {
    const r = resolveCanonicalActiveHeadingTarget({
      state: state({ targetKey: 'doc:key::MH::0::H-B' }),
      documentKey: 'doc:key',
      diagnostic: { id: 'MH', severity: 'error', stableIdentity: 'H-B', isMultiTarget: true },
      projections,
      resolveHeadingElement: () => element(),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('TARGET_KEY_INDEX_MISMATCH')
  })

  it('TEST-V2-1c — a targetKey whose identity disagrees with the projection FAILS CLOSED', () => {
    const r = resolveCanonicalActiveHeadingTarget({
      state: state({ targetKey: 'doc:key::MH::1::H-B' }),
      documentKey: 'doc:key',
      diagnostic: { id: 'MH', severity: 'error', stableIdentity: 'H-B', isMultiTarget: true },
      projections,
      resolveHeadingElement: () => element(),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('TARGET_KEY_IDENTITY_MISMATCH')
  })

  it('TEST-V2-6 — an EXISTING fill on the WRONG heading FAILS the identity closure', () => {
    const base = {
      phase: 'ACTIVE' as const,
      activeTargetIsHeading: true,
      stateDiagnosticId: 'MH',
      stateDiagnosticTargetIndex: 1,
      stateTargetKey: 'doc:key::MH::1::H-C',
      stateHeadingIdentity: 'id:H-C',
      visualDiagnosticId: 'MH',
      visualDiagnosticTargetIndex: 1,
      visualTargetKey: 'doc:key::MH::1::H-C',
      visualHeadingIdentity: 'id:H-C',
      drawerTargetKey: 'doc:key::MH::1::H-C',
      leaseTargetKey: 'doc:key::MH::1::H-C',
      fragmentCount: 1,
      fillCount: 1,
      activeLeasePresent: true,
      activeTargetCount: 1,
      selectedActiveRowCount: 1,
      drawerActiveRowCount: 1,
      drawerRowsRendered: true,
      layoutEpochCurrent: true,
      geometryGenerationCurrent: true,
    }
    expect(evaluateActiveTargetAuthority(base).decision).toBe('PASS')
    // the SAME fill count, but painted on the FIRST subtarget → FAIL
    const wrong = evaluateActiveTargetAuthority({
      ...base,
      visualDiagnosticTargetIndex: 0,
      visualTargetKey: 'doc:key::MH::0::H-B',
      visualHeadingIdentity: 'id:H-B',
      drawerTargetKey: 'doc:key::MH::0::H-B',
      leaseTargetKey: 'doc:key::MH::0::H-B',
    })
    expect(wrong.decision).toBe('FAIL')
    expect(wrong.failedChecks).toContain('ACTIVE_STATE_VISUAL_TARGET_KEY_MISMATCH')
    expect(wrong.failedChecks).toContain('ACTIVE_STATE_VISUAL_HEADING_IDENTITY_MISMATCH')
    expect(wrong.visualOnForeignHeading).toBe(true)
  })

  it('TEST-V2-9 — the Strict Multi-H1 decision uses the CURRENT snapshot only', () => {
    const agree = evaluateStrictMultiH1CurrentSnapshot({
      expectedExcessTargetCount: 2, diagnosticTargetCount: 2, visualTargetCount: 2,
      locateTargetCount: 2, auditTargetCount: 2, passiveMarkerCount: 2,
      siblingPassiveLostCount: 0, activeTargetNotInExcessSet: false,
      passiveActiveFillStackCount: 0, activeMarkerCountGt1: 0,
    })
    expect(agree.decision).toBe('PASS')
    expect(agree.currentExpectedCountMismatch).toBe(0)
    expect(agree.currentPassiveCountMismatch).toBe(0)
    const mismatch = evaluateStrictMultiH1CurrentSnapshot({
      expectedExcessTargetCount: 2, diagnosticTargetCount: 2, visualTargetCount: 2,
      locateTargetCount: 2, auditTargetCount: 2, passiveMarkerCount: 1,
      siblingPassiveLostCount: 0, activeTargetNotInExcessSet: false,
      passiveActiveFillStackCount: 0, activeMarkerCountGt1: 0,
    })
    expect(mismatch.decision).toBe('FAIL')
    expect(mismatch.currentPassiveCountMismatch).toBe(1)
  })

  it('V2-GATE — every V2 fatal counter is 0 by default and a V2 coverage minimum is enforced', () => {
    const counters = createHeadingMultiTargetV2Counters()
    expect(formatHeadingMultiTargetV2GateReport(counters).length)
      .toBe(HEADING_MULTI_TARGET_V2_GATE_KEYS.length)
    expect(evaluateHeadingMultiTargetV2Gates(counters).decision).toBe('PASS')
    counters.activeStateVisualTargetKeyMismatch = 1
    expect(evaluateHeadingMultiTargetV2Gates(counters).decision).toBe('FAIL')
    const coverage = createHeadingMultiTargetV2CoverageCounters()
    expect(evaluateHeadingMultiTargetV2Coverage(coverage).decision).toBe('FAIL')
    expect(formatHeadingMultiTargetV2CoverageReport(coverage).length)
      .toBe(HEADING_MULTI_TARGET_V2_COVERAGE_KEYS.length)
  })
})

// ── the Runtime Matrix A–G (§71/§77/§79) ──────────────────────────────────
//
// Driven through the REAL production pipeline: a REAL click on the REAL Drawer
// row (`buildDrawerItem` → `locateDiagnostic`), the REAL reducer
// (`commitDiagnosticTransitionV2`), the REAL heading visual projection, the REAL
// layoutEpoch / geometryGeneration reconcile and the REAL same-target
// DEACTIVATE. Every fact read back is the production audit / DOM fact.

const lastAudit = (event: string): Record<string, string> => {
  const lines = (infoSpy?.mock.calls ?? []).map(c => String(c[0] ?? '')).filter(l => l.includes(event))
  const line = lines[lines.length - 1] ?? ''
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}
/** the LAST audit line of `event` whose `key` equals `value`. */
const lastAuditWith = (event: string, key: string, value: string): Record<string, string> => {
  const lines = (infoSpy?.mock.calls ?? []).map(c => String(c[0] ?? '')).filter(l => l.includes(event))
  for (let i = lines.length - 1; i >= 0; i--) {
    const body = lines[i].slice(lines[i].indexOf(event) + event.length).replace(/^:\s*/, '')
    const out: Record<string, string> = {}
    for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
    if (out[key] === value) return out
  }
  return {}
}
const isSelectedRowCount = (): number =>
  document.querySelectorAll('.inkchapter-doc-drawer__item.is-selected[data-diagnostic-id]').length
const rowEl = (id: string, index: number): HTMLElement | null =>
  document.querySelector<HTMLElement>(`.inkchapter-doc-drawer__item[data-diagnostic-id="${id}"][data-target-index="${index}"]`)

async function clickDrawerRow(id: string, index: number): Promise<void> {
  const el = rowEl(id, index)
  expect(el, `the Drawer row ${id} ${index}/${index + 1} must be rendered`).not.toBeNull()
  // a REAL user click on the REAL production row (its own click listener runs).
  el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await flushRaf()
  // a real snapshot/geometry reconcile re-projects the Active visual.
  api().renderHeadingDiagnosticMarkers()
  await flushRaf()
}

function matrixWorld(): { h: DocumentUtilityOverlayHost; headings: Record<string, HTMLElement> } {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  stubRect(shell, () => ({ left: 0, top: 0, right: 1200, bottom: 800 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  stubRect(write, () => ({ left: 0, top: 0, right: 1200, bottom: 800 }))
  const spec: Array<[string, string]> = [['H-A', 'h1'], ['H-B', 'h1'], ['H-C', 'h1'], ['H-D', 'h3']]
  const headings: Record<string, HTMLElement> = {}
  spec.forEach(([id, tag], i) => {
    const h = document.createElement(tag)
    h.setAttribute('data-id', id)
    h.setAttribute('data-line', String(4 + i))
    h.textContent = `标题${i + 1}`
    write.appendChild(h)
    stubRect(h, () => ({ left: 100, top: 100 + i * 60, right: 700, bottom: 132 + i * 60 }))
    headings[id] = h
  })
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, headings }
}

/** ONE multi-target strict-H1 diagnostic (2 canonical subtargets) + ONE level-gap. */
function matrixDiags(): Array<Record<string, unknown>> {
  return [
    {
      id: 'MH', documentKey: 'doc:key', severity: 'error', category: 'heading',
      code: 'STRICT_SINGLE_H1_MULTIPLE_H1', message: '多个一级标题', detail: '',
      metadata: { ruleId: 'STRICT-SINGLE-H1', h1Count: 3, reason: 'MULTIPLE_H1' },
      stableIdentity: 'H-B',
      location: {
        kind: 'multi-target',
        targets: [
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-B' },
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-C' },
        ],
      },
    } as unknown as Record<string, unknown>,
    diagFor('GAP', 'H-D', 'error', 'HEADING_LEVEL_GAP'),
  ]
}

describe('V1-RUNTIME-MATRIX — the full A–G sequence through the production pipeline', () => {
  it('A→F — activate / multi-target switch / cross-diagnostic switch / layout rebuild / geometry rebuild / deactivate', async () => {
    const w = matrixWorld()
    host = w.h
    inject(host, matrixDiags(), 3)
    matrixInternals(host).renderDrawer()
    expect(isSelectedRowCount()).toBe(0)

    // ── A. Initial ACTIVATE (1/2) ─────────────────────────────────────────
    await clickDrawerRow('MH', 0)
    const stA = api().getDiagnosticInteractionStateV2()
    expect(stA.phase).toBe('ACTIVE')
    expect(stA.diagnosticId).toBe('MH')
    expect(stA.diagnosticTargetIndex).toBe(0)
    expect(parseCanonicalTargetKeyIndex(stA.targetKey)).toBe(0)
    expect(isSelectedRowCount()).toBe(1)
    expect(activeFragmentCount()).toBeGreaterThanOrEqual(1)
    const factsA = api().getHeadingActivePersistenceFacts()
    expect(factsA).not.toBeNull()
    expect(factsA!.diagnosticId).toBe('MH')
    expect(factsA!.targetKey).toBe(stA.targetKey)
    expect(lastAudit('DOCUMENT-DIAGNOSTIC-HEADING-POST-RECONCILE-CLOSURE').decision).toBe('PASS')

    // ── B. Multi-target SWITCH (2/2) → a DIFFERENT canonical subtarget ────
    await clickDrawerRow('MH', 1)
    const stB = api().getDiagnosticInteractionStateV2()
    expect(stB.phase).toBe('ACTIVE')
    expect(stB.diagnosticId).toBe('MH')
    expect(stB.diagnosticTargetIndex).toBe(1)
    expect(parseCanonicalTargetKeyIndex(stB.targetKey)).toBe(1)
    expect(stB.targetKey).not.toBe(stA.targetKey)
    expect(isSelectedRowCount()).toBe(1)
    // the SELECTED row is the 2/2 row, never the 1/2 row
    expect(rowEl('MH', 1)!.classList.contains('is-selected')).toBe(true)
    expect(rowEl('MH', 0)!.classList.contains('is-selected')).toBe(false)
    expect(activeFragmentCount()).toBeGreaterThanOrEqual(1)

    // ── C. Cross-diagnostic SWITCH (H1 → H3 level-gap) ────────────────────
    await clickDrawerRow('GAP', 0)
    const stC = api().getDiagnosticInteractionStateV2()
    expect(stC.diagnosticId).toBe('GAP')
    const strictAudit = lastAudit('STRICT-MULTI-H1-VISUAL-AUDIT')
    // the strict multi-H1 audit NEVER adopts the foreign level-gap active target.
    expect(strictAudit.activeTargetBelongsToAudit).toBe('false')
    expect(activeFragmentCount()).toBeGreaterThanOrEqual(1)

    // ── D. Back to the SECOND subtarget (2/2), then a REAL layoutEpoch rebuild ──
    await clickDrawerRow('MH', 1)
    const beforeD = api().getHeadingActivePersistenceFacts()!
    expect(beforeD.diagnosticId).toBe('MH')
    expect(beforeD.stableHeadingIdentity).toBe('H-C')
    expect(beforeD.diagnosticTargetIndex).toBe(1)
    matrixInternals(host).bumpDocumentLayoutEpoch('PLUGIN_DOM_MUTATION')
    api().renderHeadingDiagnosticMarkers()
    await flushRaf()
    const afterD = api().getHeadingActivePersistenceFacts()
    expect(afterD).not.toBeNull()
    expect(afterD!.fragmentCount).toBeGreaterThanOrEqual(1)
    expect(afterD!.layoutEpoch).toBe(beforeD.layoutEpoch + 1)
    expect(afterD!.diagnosticId).toBe('MH')
    // the 2/2 subtarget NEVER falls back to 1/2 across a layout reconcile.
    expect(afterD!.stableHeadingIdentity).toBe('H-C')
    expect(afterD!.targetKey).toBe(beforeD.targetKey)
    expect(activeFragmentCount()).toBeGreaterThanOrEqual(1)

    // ── E. A REAL geometryGeneration rebuild (still 2/2) ──────────────────
    api().renderHeadingDiagnosticMarkers()
    await flushRaf()
    const afterE = api().getHeadingActivePersistenceFacts()
    expect(afterE).not.toBeNull()
    expect(afterE!.fragmentCount).toBeGreaterThanOrEqual(1)
    expect(afterE!.geometryGeneration).toBeGreaterThan(afterD!.geometryGeneration)
    expect(afterE!.stableHeadingIdentity).toBe('H-C')
    expect(activeFragmentCount()).toBeGreaterThanOrEqual(1)

    // ── E2. 2/2 → 1/2 (an exact switch back to the FIRST subtarget) ───────
    await clickDrawerRow('MH', 0)
    const afterE2 = api().getHeadingActivePersistenceFacts()!
    expect(afterE2.stableHeadingIdentity).toBe('H-B')
    expect(afterE2.diagnosticTargetIndex).toBe(0)
    expect(rowEl('MH', 0)!.classList.contains('is-selected')).toBe(true)
    expect(rowEl('MH', 1)!.classList.contains('is-selected')).toBe(false)

    // ── F. Same-target DEACTIVATE (click the SAME 1/2 row again) ──────────
    await clickDrawerRow('MH', 0)
    const stF = api().getDiagnosticInteractionStateV2()
    expect(stF.phase).toBe('IDLE')
    expect(stF.diagnosticId).toBeNull()
    expect(isSelectedRowCount()).toBe(0)
    expect(activeFragmentCount()).toBe(0)
    expect(api().getHeadingActivePersistenceFacts()).toBeNull()
    // the PASSIVE marker of the diagnosed headings is restored (never lost).
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-passive__fragment').length).toBeGreaterThanOrEqual(1)
    expect(lastAuditWith('DOCUMENT-DIAGNOSTIC-HEADING-POST-RECONCILE-CLOSURE', 'trigger', 'SAME_TARGET_DEACTIVATE_TEARDOWN_COMMITTED').decision).toBe('PASS')

    // ── every hard gate 0 AND every positive coverage met ─────────────────
    const gateReport = api().getHeadingActivePersistenceV1GateReport()
    for (const line of gateReport) expect(line.endsWith('=0'), line).toBe(true)
    const decision = api().getHeadingActivePersistenceV1GateDecision()
    expect(decision.gateDecision).toBe('PASS')
    expect(decision.coverageDecision).toBe('PASS')
    expect(decision.failedChecks).toEqual([])
    expect(decision.unmetCoverage).toEqual([])

    const coverage = api().getHeadingActivePersistenceV1CoverageReport()
    const coverageValue = (label: string): number =>
      Number.parseInt(coverage.find(l => l.startsWith(label))!.split('=')[1], 10)
    expect(coverageValue('ACTIVE_HEADING_INITIAL_ACTIVATE_RUNTIME_COUNT')).toBeGreaterThanOrEqual(1)
    expect(coverageValue('ACTIVE_HEADING_SWITCH_RUNTIME_COUNT')).toBeGreaterThanOrEqual(1)
    expect(coverageValue('ACTIVE_HEADING_REBUILT_AFTER_LAYOUT_EPOCH_COUNT')).toBeGreaterThanOrEqual(1)
    expect(coverageValue('ACTIVE_HEADING_REBUILT_AFTER_GEOMETRY_GENERATION_COUNT')).toBeGreaterThanOrEqual(1)
    expect(coverageValue('MULTI_TARGET_HEADING_DISTINCT_SUBTARGET_ACTIVATION_COUNT')).toBe(2)
    expect(coverageValue('HEADING_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT')).toBeGreaterThanOrEqual(1)

    // ── V2 §12 — the multi-target canonical coverage of THIS round.
    const v2Report = api().getMultiTargetV2CoverageReport()
    const v2Value = (label: string): number =>
      Number.parseInt(v2Report.find(l => l.startsWith(label))!.split('=')[1], 10)
    expect(v2Value('MULTI_TARGET_FIRST_SUBTARGET_ACTIVATION_COUNT'), v2Report.join(' | ')).toBeGreaterThanOrEqual(1)
    expect(v2Value('MULTI_TARGET_SECOND_SUBTARGET_ACTIVATION_COUNT'), v2Report.join(' | ')).toBeGreaterThanOrEqual(1)
    expect(v2Value('MULTI_TARGET_SECOND_SUBTARGET_REBUILT_AFTER_LAYOUT_COUNT'), v2Report.join(' | ')).toBeGreaterThanOrEqual(1)
    expect(v2Value('MULTI_TARGET_SECOND_SUBTARGET_REBUILT_AFTER_GEOMETRY_COUNT'), v2Report.join(' | ')).toBeGreaterThanOrEqual(1)
    expect(v2Value('MULTI_TARGET_SWITCH_1_TO_2_COUNT'), v2Report.join(' | ')).toBeGreaterThanOrEqual(1)
    expect(v2Value('MULTI_TARGET_SWITCH_2_TO_1_COUNT'), v2Report.join(' | ')).toBeGreaterThanOrEqual(1)
    expect(v2Value('CROSS_DIAGNOSTIC_HEADING_SWITCH_COUNT'), v2Report.join(' | ')).toBeGreaterThanOrEqual(1)
    expect(v2Value('SAME_TARGET_DEACTIVATE_AFTER_MULTI_TARGET_COUNT'), v2Report.join(' | ')).toBeGreaterThanOrEqual(1)
    expect(v2Value('CANONICAL_ACTIVE_TARGET_EXACT_RESOLUTION_COUNT'), v2Report.join(' | ')).toBeGreaterThanOrEqual(1)
    expect(api().getMultiTargetV2GateDecision().coverageDecision).toBe('PASS')
    expect(api().getMultiTargetV2GateDecision().failedChecks, api().getMultiTargetV2GateReport().join(' | ')).toEqual([])
  })

  it('§73 — 1/2 and 2/2 use DISTINCT canonical rowKey / targetKey / heading identity', async () => {
    const w = matrixWorld()
    host = w.h
    inject(host, matrixDiags(), 4)
    matrixInternals(host).renderDrawer()

    await clickDrawerRow('MH', 0)
    const one = api().getDiagnosticInteractionStateV2()
    await clickDrawerRow('MH', 1)
    const two = api().getDiagnosticInteractionStateV2()

    expect(one.diagnosticId).toBe(two.diagnosticId)
    expect(one.targetKey).not.toBe(two.targetKey)
    expect(one.targetKey!.split('::').slice(3).join('::'))
      .not.toBe(two.targetKey!.split('::').slice(3).join('::'))
    expect(rowEl('MH', 0)!.getAttribute('data-target-index')).toBe('0')
    expect(rowEl('MH', 1)!.getAttribute('data-target-index')).toBe('1')
    expect(api().getHeadingActivePersistenceV1GateDecision().gateDecision).toBe('PASS')
  })

  it('§74 — a passive heading with an EMPTY active fragment set is NOT a failure', () => {
    const w = matrixWorld()
    host = w.h
    inject(host, matrixDiags(), 5)
    matrixInternals(host).renderDrawer()
    api().renderHeadingDiagnosticMarkers()
    // IDLE: every heading is passive; the audit decision is still PASS.
    expect(lastAudit('DOCUMENT-DIAGNOSTIC-HEADING-MARKER-AUDIT').decision).toBe('PASS')
    expect(api().getHeadingActivePersistenceV1GateDecision().gateDecision).toBe('PASS')
  })
})
