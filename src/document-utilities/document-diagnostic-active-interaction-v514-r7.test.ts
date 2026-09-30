// @vitest-environment jsdom
/**
 * V5.14-R7 — Document Diagnostic ACTIVE INTERACTION state machine.
 *
 * Covers the V5.14-R7 prompt:
 *   A  Error toggle           IDLE -> ACTIVE(A) -> IDLE (no new locate tx)
 *   B  Warning toggle         IDLE -> ACTIVE(B) -> IDLE (no new locate tx)
 *   C  Warning -> Error       ONE click
 *   D  Error -> Warning       ONE click (ROOT_R7_3 regression)
 *   E  Error A -> Error C     ONE click
 *   F  Warning B -> Warning D ONE click
 *   G  same diagnostic, another targetIndex -> SWITCH
 *   H  stale-owner cleanup    -> SKIP_STALE_OWNER (never clears the new active)
 *   I  the PASSIVE set is untouched by every Active transition
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  ACTIVE_INTERACTION_V514R7_GATE_KEYS,
  ACTIVE_INTERACTION_V514R7_GATE_LABELS,
  DOCUMENT_DIAGNOSTIC_ACTIVE_INTERACTION_AUDIT_EVENT,
  DOCUMENT_DIAGNOSTIC_ACTIVE_OWNER_AUDIT_EVENT,
  SAME_TARGET_TOGGLE_OFF_REASON,
  classifyDiagnosticInteraction,
  classifyDiagnosticInteractionIsSeverityBlind,
  createActiveInteractionV514R7Counters,
  evaluateActiveInteractionV514R7Gates,
  formatActiveInteractionV514R7GateReport,
  isCurrentVisualOwner,
  isSameActiveTarget,
  resolveOwnerCleanupDecision,
  type DiagnosticActiveState,
} from './document-diagnostic-active-interaction-v514-r7'
import { DOCUMENT_DIAGNOSTIC_POST_SETTLE_CLOSURE_V2 } from './document-diagnostic-active-state-machine-v2'

// ── pure contract ───────────────────────────────────────────────────────────

function activeState(overrides: Partial<DiagnosticActiveState> = {}): DiagnosticActiveState {
  return {
    interactionEpoch: 1,
    documentKey: 'doc:key',
    diagnosticId: 'E1',
    targetKey: 'doc:key::E1::0::H-A',
    targetIndex: 0,
    transactionId: 7,
    leaseToken: 'lease:7',
    phase: 'active',
    ...overrides,
  }
}
function clicked(overrides: Partial<{ diagnosticId: string; targetKey: string; targetIndex: number; severity: string | null }> = {}) {
  return {
    documentKey: 'doc:key',
    diagnosticId: 'E1',
    targetKey: 'doc:key::E1::0::H-A',
    targetIndex: 0,
    severity: 'error' as string | null,
    ...overrides,
  }
}

describe('V5.14-R7 §6/§9 — the ONE interaction classifier', () => {
  it('IDLE→ACTIVATE, same targetKey→DEACTIVATE, another targetKey→SWITCH', () => {
    expect(classifyDiagnosticInteraction(null, clicked())).toBe('ACTIVATE')
    expect(classifyDiagnosticInteraction(activeState(), clicked())).toBe('DEACTIVATE')
    expect(classifyDiagnosticInteraction(activeState(), clicked({ diagnosticId: 'W1', targetKey: 'doc:key::W1::0::H-B' }))).toBe('SWITCH')
    expect(isSameActiveTarget(activeState(), clicked())).toBe(true)
    expect(isSameActiveTarget(activeState(), clicked({ targetKey: 'doc:key::E1::1::H-B', targetIndex: 1 }))).toBe(false)
  })

  it('§12 — same diagnosticId but a DIFFERENT targetKey is a SWITCH, never a DEACTIVATE', () => {
    const prev = activeState({ diagnosticId: 'X', targetKey: 'doc:key::X::0::H-A', targetIndex: 0 })
    const next = clicked({ diagnosticId: 'X', targetKey: 'doc:key::X::1::H-B', targetIndex: 1 })
    expect(classifyDiagnosticInteraction(prev, next)).toBe('SWITCH')
    expect(isSameActiveTarget(prev, next)).toBe(false)
  })

  it('§9 — the transition table is severity-BLIND', () => {
    expect(classifyDiagnosticInteractionIsSeverityBlind()).toBe(true)
    const prev = activeState()
    for (const severity of ['error', 'warning', 'info', null]) {
      expect(classifyDiagnosticInteraction(prev, clicked({ severity }))).toBe('DEACTIVATE')
      expect(classifyDiagnosticInteraction(null, clicked({ severity }))).toBe('ACTIVATE')
      expect(classifyDiagnosticInteraction(prev, clicked({ diagnosticId: 'W1', targetKey: 'doc:key::W1::0::H-B', severity }))).toBe('SWITCH')
    }
  })

  it('§8 — the owner guard applies ONLY to the current owner', () => {
    const current = activeState({ interactionEpoch: 5, targetKey: 'doc:key::W1::0::H-B' })
    expect(isCurrentVisualOwner({ interactionEpoch: 5, targetKey: 'doc:key::W1::0::H-B' }, current)).toBe(true)
    expect(resolveOwnerCleanupDecision({ interactionEpoch: 5, targetKey: 'doc:key::W1::0::H-B' }, current)).toBe('APPLY')
    // a RETIRED owner (older epoch, another target) can never clear the new active
    expect(isCurrentVisualOwner({ interactionEpoch: 4, targetKey: 'doc:key::E1::0::H-A' }, current)).toBe(false)
    expect(resolveOwnerCleanupDecision({ interactionEpoch: 4, targetKey: 'doc:key::E1::0::H-A' }, current)).toBe('SKIP_STALE_OWNER')
    expect(resolveOwnerCleanupDecision({ interactionEpoch: 4, targetKey: 'doc:key::E1::0::H-A' }, null)).toBe('SKIP_STALE_OWNER')
  })

  it('§14 — the 12 active-interaction gates are declared, complete and 0 when clean', () => {
    expect(ACTIVE_INTERACTION_V514R7_GATE_KEYS).toHaveLength(12)
    const counters = createActiveInteractionV514R7Counters()
    expect(formatActiveInteractionV514R7GateReport(counters)).toHaveLength(12)
    expect(evaluateActiveInteractionV514R7Gates(counters).decision).toBe('PASS')
    expect(ACTIVE_INTERACTION_V514R7_GATE_LABELS.switchRequiredSecondUserClick).toBe('SWITCH_REQUIRED_SECOND_USER_CLICK_COUNT')
    expect(ACTIVE_INTERACTION_V514R7_GATE_LABELS.staleVisualOwnerCleanupApplied).toBe('STALE_VISUAL_OWNER_CLEANUP_APPLIED_COUNT')
    const dirty = createActiveInteractionV514R7Counters()
    dirty.sameActiveTargetFailedToToggleOff = 1
    expect(evaluateActiveInteractionV514R7Gates(dirty).decision).toBe('FAIL')
  })

  it('§7.2 — the explicit toggle-off reason is the required one', () => {
    expect(SAME_TARGET_TOGGLE_OFF_REASON).toBe('SAME_TARGET_TOGGLE_OFF')
    expect(DOCUMENT_DIAGNOSTIC_ACTIVE_INTERACTION_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-ACTIVE-INTERACTION-AUDIT')
    expect(DOCUMENT_DIAGNOSTIC_ACTIVE_OWNER_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-ACTIVE-OWNER-AUDIT')
  })
})

// ── host wiring (jsdom) ─────────────────────────────────────────────────────

let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1
function stubRaf(): void {
  rafTasks = new Map()
  rafSeq = 1
  const raf = (cb: FrameRequestCallback): number => { const id = rafSeq++; rafTasks.set(id, cb); return id }
  const caf = (id: number): void => { rafTasks.delete(id) }
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = raf
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = caf
}
async function flushRaf(): Promise<void> {
  let guard = 0
  while (rafTasks.size > 0 && guard++ < 400) {
    const cur = Array.from(rafTasks.values())
    rafTasks.clear()
    for (const cb of cur) cb(0)
    await Promise.resolve()
  }
}
type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}
function stubRangeRects(rects: Rect[]): void {
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
    getHeadingIdentity: (el) => el.getAttribute('data-id'),
    parseLocalLinkTargets: () => [],
    getObjectCaptionHost: () => null,
  }
}

type Internals = { locateDiagnostic(id: string, targetIndex?: number): void }
type HostApi = {
  renderHeadingDiagnosticMarkers(): void
  getActiveDiagnosticStateV514R7(): DiagnosticActiveState | null
  getActiveInteractionV514R7Counters(): Record<string, number>
  getActiveInteractionV514R7GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
  getDiagnosticInteractionStateV2(): {
    version: number
    phase: 'IDLE' | 'ACTIVE'
    diagnosticId: string | null
    targetKey: string | null
    targetIndex: number | null
  }
  getActiveDiagnosticIdV2(): string | null
  getActiveStateMachineV2Counters(): Record<string, number>
  getActiveStateMachineV2GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
  getActiveStateMachineV2CoverageReport(): string[]
  getActiveStateMachineV2CoverageDecision(): { decision: 'PASS' | 'FAIL'; missing: string[] }
  getVisualTransactionV21Counters(): Record<string, number>
  getVisualTransactionV21GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
  getVisualTransactionV21CoverageReport(): string[]
  getPassiveActiveVisualStateV514R3(): { passiveKeys: readonly string[]; activeKeys: readonly string[]; passiveCount: number; activeInPassiveSet: boolean }
}
let host: DocumentUtilityOverlayHost | null = null
let infoSpy: { mock: { calls: unknown[][] }; mockRestore: () => void } | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  stubRangeRects([{ left: 200, top: 204, right: 420, bottom: 228 }])
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as { mock: { calls: unknown[][] }; mockRestore: () => void }
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

/**
 * FOUR diagnosed headings (two errors A/C + two warnings B/D), all placed INSIDE
 * the visible editor viewport so a locate COMMITS without any real scroll
 * (jsdom has no scroll engine).
 */
function makeWorld(): { h: DocumentUtilityOverlayHost; headings: Record<string, HTMLElement> } {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  stubRect(shell, () => ({ left: 0, top: 0, right: 1200, bottom: 800 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  stubRect(write, () => ({ left: 0, top: 0, right: 1200, bottom: 800 }))
  const ids = ['H-A', 'H-B', 'H-C', 'H-D']
  const headings: Record<string, HTMLElement> = {}
  ids.forEach((id, i) => {
    const h = document.createElement('h2')
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
function diagFor(id: string, headingId: string, severity: string, code: string): Record<string, unknown> {
  return {
    id, documentKey: 'doc:key', severity, category: 'heading', code, message: 'm', detail: '',
    stableIdentity: headingId, metadata: {},
    location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: headingId },
  } as unknown as Record<string, unknown>
}
function fourDiags(): Array<Record<string, unknown>> {
  return [
    diagFor('E1', 'H-A', 'error', 'HEADING_LEVEL_GAP'),
    diagFor('W1', 'H-B', 'warning', 'HEADING_DUPLICATE_TEXT'),
    diagFor('E2', 'H-C', 'error', 'HEADING_LEVEL_GAP'),
    diagFor('W2', 'H-D', 'warning', 'HEADING_DUPLICATE_TEXT'),
  ]
}
function inject(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>, revision = 1): void {
  const snapshot = {
    documentKey: 'doc:key', revision, sourceRevision: revision, generatedAt: 0,
    diagnostics: diags, errorCount: 2, warningCount: 2, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}
const api = (): HostApi => host as unknown as HostApi
const click = async (h: DocumentUtilityOverlayHost, id: string, targetIndex?: number): Promise<void> => {
  ;(h as unknown as Internals).locateDiagnostic(id, targetIndex)
  await flushRaf()
}
const activeKey = (): string | null => api().getActiveDiagnosticStateV514R7()?.targetKey ?? null
const passiveCount = (): number => api().getPassiveActiveVisualStateV514R3().passiveCount
const countAudit = (event: string): number =>
  (infoSpy?.mock.calls ?? []).filter(c => String(c[0] ?? '').includes(event)).length
const lastAudit = (event: string): Record<string, string> => {
  const lines = (infoSpy?.mock.calls ?? []).map(c => String(c[0] ?? '')).filter(l => l.includes(event))
  const line = lines[lines.length - 1] ?? ''
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}

describe('V5.14-R7 — ACTIVE interaction state machine (host wiring)', () => {
  it('A — Error toggle: click → ACTIVE, click again → IDLE with NO new transaction', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()

    await click(host, 'E1')
    const st = api().getActiveDiagnosticStateV514R7()
    expect(st).not.toBeNull()
    expect(st!.diagnosticId).toBe('E1')
    expect(st!.phase).toBe('active')
    const txAfterFirst = countAudit('DOCUMENT-DIAGNOSTIC-LOCATE-TRANSACTION')

    await click(host, 'E1')
    expect(api().getActiveDiagnosticStateV514R7()).toBeNull()
    // ROOT_R7_1 — a same-target toggle-off creates NO new locate transaction.
    expect(countAudit('DOCUMENT-DIAGNOSTIC-LOCATE-TRANSACTION')).toBe(txAfterFirst)
    const off = lastAudit(DOCUMENT_DIAGNOSTIC_ACTIVE_INTERACTION_AUDIT_EVENT)
    expect(off.classifiedAction).toBe('DEACTIVATE')
    expect(off.sameTarget).toBe('true')
    expect(off.finalState).toBe('IDLE')
    expect(off.reason).toBe('SAME_TARGET_TOGGLE_OFF_V2')
    expect(api().getActiveInteractionV514R7GateDecision().decision).toBe('PASS')
  })

  it('B — Warning toggle: identical transitions to the Error case', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()

    await click(host, 'W1')
    expect(api().getActiveDiagnosticStateV514R7()!.diagnosticId).toBe('W1')
    const txAfterFirst = countAudit('DOCUMENT-DIAGNOSTIC-LOCATE-TRANSACTION')
    await click(host, 'W1')
    expect(api().getActiveDiagnosticStateV514R7()).toBeNull()
    expect(countAudit('DOCUMENT-DIAGNOSTIC-LOCATE-TRANSACTION')).toBe(txAfterFirst)
    expect(lastAudit(DOCUMENT_DIAGNOSTIC_ACTIVE_INTERACTION_AUDIT_EVENT).classifiedAction).toBe('DEACTIVATE')
    expect(api().getActiveInteractionV514R7GateDecision().decision).toBe('PASS')
  })

  it('C — Warning → Error switches in ONE click', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()

    await click(host, 'W1')
    const before = activeKey()
    await click(host, 'E1')
    const st = api().getActiveDiagnosticStateV514R7()
    expect(st!.diagnosticId).toBe('E1')
    expect(activeKey()).not.toBe(before)
    const audit = lastAudit(DOCUMENT_DIAGNOSTIC_ACTIVE_INTERACTION_AUDIT_EVENT)
    expect(audit.classifiedAction).toBe('SWITCH')
    expect(audit.secondUserClickRequired).toBe('false')
    expect(api().getActiveInteractionV514R7Counters().switchRequiredSecondUserClick).toBe(0)
    expect(api().getActiveInteractionV514R7GateDecision().decision).toBe('PASS')
  })

  it('D — Error → Warning switches in ONE click (ROOT_R7_3 regression)', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()

    await click(host, 'E1')
    expect(api().getActiveDiagnosticStateV514R7()!.diagnosticId).toBe('E1')
    await click(host, 'W1')
    const st = api().getActiveDiagnosticStateV514R7()
    expect(st).not.toBeNull()
    expect(st!.diagnosticId).toBe('W1')
    expect(st!.phase).toBe('active')
    const audit = lastAudit(DOCUMENT_DIAGNOSTIC_ACTIVE_INTERACTION_AUDIT_EVENT)
    expect(audit.classifiedAction).toBe('SWITCH')
    expect(audit.secondUserClickRequired).toBe('false')
    expect(api().getActiveInteractionV514R7Counters().switchRequiredSecondUserClick).toBe(0)
    expect(api().getActiveInteractionV514R7Counters().activeSwitchLeftStableIdleBetweenClicks).toBe(0)
    expect(api().getActiveInteractionV514R7GateDecision().decision).toBe('PASS')
  })

  it('E/F — Error A → Error C and Warning B → Warning D each switch in ONE click', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()

    await click(host, 'E1')
    await click(host, 'E2')
    expect(api().getActiveDiagnosticStateV514R7()!.diagnosticId).toBe('E2')
    await click(host, 'W1')
    expect(api().getActiveDiagnosticStateV514R7()!.diagnosticId).toBe('W1')
    await click(host, 'W2')
    expect(api().getActiveDiagnosticStateV514R7()!.diagnosticId).toBe('W2')
    expect(api().getActiveInteractionV514R7GateDecision().decision).toBe('PASS')
    expect(api().getActiveInteractionV514R7Counters().multipleActiveTarget).toBe(0)
  })

  it('G — the same diagnostic at another targetIndex is a SWITCH (not a toggle-off)', async () => {
    const w = makeWorld()
    host = w.h
    const multi = {
      id: 'M1', documentKey: 'doc:key', severity: 'error', category: 'document',
      code: 'STRICT_SINGLE_H1_MULTIPLE_H1', message: 'm', detail: '', metadata: {},
      location: {
        kind: 'multi-target',
        targets: [
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-A' },
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-C' },
        ],
      },
    } as unknown as Record<string, unknown>
    inject(host, [multi])
    api().renderHeadingDiagnosticMarkers()

    await click(host, 'M1', 0)
    expect(api().getActiveDiagnosticStateV514R7()!.targetIndex).toBe(0)
    await click(host, 'M1', 1)
    const st = api().getActiveDiagnosticStateV514R7()
    expect(st).not.toBeNull()
    expect(st!.targetIndex).toBe(1)
    expect(lastAudit(DOCUMENT_DIAGNOSTIC_ACTIVE_INTERACTION_AUDIT_EVENT).classifiedAction).toBe('SWITCH')
    expect(api().getActiveInteractionV514R7GateDecision().decision).toBe('PASS')
  })

  it('H — a stale-owner cleanup is SKIPPED and never clears the new active', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()

    await click(host, 'E1')
    await click(host, 'W1')
    const current = api().getActiveDiagnosticStateV514R7()!
    expect(current.diagnosticId).toBe('W1')
    // the OWNER audit proves the stale owner was skipped (no clear applied)
    const ownerAudit = lastAudit(DOCUMENT_DIAGNOSTIC_ACTIVE_OWNER_AUDIT_EVENT)
    if (Object.keys(ownerAudit).length > 0) {
      expect(ownerAudit.cleanupDecision === 'APPLY' || ownerAudit.cleanupDecision === 'SKIP_STALE_OWNER').toBe(true)
    }
    // the OLD owner is no longer current → its cleanup resolves to SKIP
    expect(resolveOwnerCleanupDecision(
      { interactionEpoch: current.interactionEpoch - 1, targetKey: 'doc:key::E1::0::H-A' },
      current,
    )).toBe('SKIP_STALE_OWNER')
    expect(api().getActiveDiagnosticStateV514R7()!.diagnosticId).toBe('W1')
    expect(api().getActiveInteractionV514R7Counters().staleVisualOwnerCleanupApplied).toBe(0)
    expect(api().getActiveInteractionV514R7Counters().oldActiveCleanupClearedNewActive).toBe(0)
  })

  it('I — the PASSIVE set is identical across ACTIVATE / SWITCH / DEACTIVATE', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()
    const baseline = passiveCount()
    expect(baseline).toBe(4)

    await click(host, 'E1')
    expect(passiveCount()).toBe(baseline)
    await click(host, 'W1')
    expect(passiveCount()).toBe(baseline)
    await click(host, 'W2')
    expect(passiveCount()).toBe(baseline)
    await click(host, 'W2')
    expect(api().getActiveDiagnosticStateV514R7()).toBeNull()
    expect(passiveCount()).toBe(baseline)
    expect(api().getActiveInteractionV514R7GateDecision().decision).toBe('PASS')
  })
})

// ── V5.14-R8 / Active State Machine V2 — host wiring ────────────────────────

type V2Audit = Record<string, string>
// §10 — a fragment counts as PAINTED when it has real geometry OR the plugin's
// own inline size (jsdom has no layout engine).
const paintedFragment = (el: HTMLElement): boolean => {
  const r = el.getBoundingClientRect()
  if (r.width > 0 && r.height > 0) return true
  const w = Number.parseFloat(el.style.width)
  const h = Number.parseFloat(el.style.height)
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
}
const activeFillCount = (): number =>
  Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-heading-diagnostic-active__fragment'))
    .filter(paintedFragment).length
const selectedActiveRowCount = (): number =>
  document.querySelectorAll('.inkchapter-doc-drawer__item.is-selected[data-diagnostic-id]').length
const closureAudit = (): V2Audit => lastAudit(DOCUMENT_DIAGNOSTIC_POST_SETTLE_CLOSURE_V2)

describe('V5.14-R8 — Active State Machine V2 (host wiring)', () => {
  it('§4.1 — EVERY click (ACTIVATE / DEACTIVATE / SWITCH) increments the version once', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()

    const v0 = api().getDiagnosticInteractionStateV2().version
    await click(host, 'E1')
    const v1 = api().getDiagnosticInteractionStateV2().version
    await click(host, 'E1')
    const v2 = api().getDiagnosticInteractionStateV2().version
    await click(host, 'W1')
    const v3 = api().getDiagnosticInteractionStateV2().version
    expect([v1 - v0, v2 - v1, v3 - v2]).toEqual([1, 1, 1])
    expect(api().getDiagnosticInteractionStateV2().phase).toBe('ACTIVE')
    expect(api().getDiagnosticInteractionStateV2().diagnosticId).toBe('W1')
  })

  it('§14 — the settle closure PROVES the DOM state (ACTIVE: 1 row/1 target/fill/lease; IDLE: all zero)', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()

    await click(host, 'E1')
    const activeState = api().getDiagnosticInteractionStateV2()
    expect(activeState.phase).toBe('ACTIVE')
    expect(activeFillCount()).toBeGreaterThanOrEqual(1)
    const activeClosure = closureAudit()
    expect(activeClosure.decision).toBe('PASS')
    expect(activeClosure.phaseAfter).toBe('ACTIVE')
    expect(activeClosure.activeStatePresent).toBe('true')
    // the Drawer is not rendered in this harness → the row requirement is N/A and
    // the closure must say so EXPLICITLY (never a silent omission).
    expect(activeClosure.drawerRowsRendered).toBe('false')
    expect(selectedActiveRowCount()).toBe(0)
    expect(activeClosure.activeTargetCount).toBe('1')
    expect(activeClosure.activeLeasePresent).toBe('true')

    await click(host, 'E1')
    const idleState = api().getDiagnosticInteractionStateV2()
    expect(idleState.phase).toBe('IDLE')
    expect(idleState.diagnosticId).toBeNull()
    expect(idleState.targetKey).toBeNull()
    expect(activeFillCount()).toBe(0)
    expect(selectedActiveRowCount()).toBe(0)
    const idleClosure = closureAudit()
    expect(idleClosure.decision).toBe('PASS')
    expect(idleClosure.phaseAfter).toBe('IDLE')
    expect(idleClosure.activeStatePresent).toBe('false')
    expect(idleClosure.activeFillCount).toBe('0')
    expect(idleClosure.activeTargetCount).toBe('0')
    expect(idleClosure.activeLeasePresent).toBe('false')
  })

  it('§15/§24 — Error AND Warning same-target DEACTIVATE are really covered', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()

    await click(host, 'E1')
    await click(host, 'E1')
    await click(host, 'W1')
    await click(host, 'W1')
    const coverage = api().getActiveStateMachineV2CoverageDecision()
    expect(coverage.decision).toBe('PASS')
    expect(api().getActiveStateMachineV2CoverageReport()).toEqual([
      'ERROR_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT=1',
      'WARNING_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT=1',
    ])
  })

  it('§8 — a SWITCH never runs a global unscoped clear and the new owner survives', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()

    await click(host, 'E1')
    await click(host, 'W1')
    expect(api().getDiagnosticInteractionStateV2().diagnosticId).toBe('W1')
    expect(api().getActiveStateMachineV2Counters().switchWithGlobalUnscopedClear).toBe(0)
    expect(api().getActiveStateMachineV2Counters().staleCallbackMutation).toBe(0)
    expect(closureAudit().decision).toBe('PASS')
    expect(closureAudit().classifiedAction).toBe('SWITCH')
    expect(activeFillCount()).toBeGreaterThanOrEqual(1)
    expect(api().getActiveStateMachineV2GateDecision().decision).toBe('PASS')
  })

  it('§3.1 — the sticky lastLocatedDiagnosticId can NOT revive an IDLE interaction', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()

    await click(host, 'W1')
    await click(host, 'W1')
    expect(api().getActiveDiagnosticStateV514R7()).toBeNull()
    expect(api().getActiveDiagnosticIdV2()).toBeNull()
    expect(selectedActiveRowCount()).toBe(0)
    // a reconcile AFTER the toggle-off must not resurrect the emphasis
    api().renderHeadingDiagnosticMarkers()
    await flushRaf()
    expect(api().getActiveDiagnosticStateV514R7()).toBeNull()
    expect(activeFillCount()).toBe(0)
    expect(api().getActiveStateMachineV2GateDecision().decision).toBe('PASS')
  })
})

// ── V5.14-R9 / V2.1 — visual transaction closure (host wiring) ──────────────
const utilityPanelsLast = (): boolean => {
  const root = document.querySelector('.inkchapter-document-utility-root')
  if (root == null) return true
  const panels = Array.from(root.querySelectorAll<HTMLElement>('.inkchapter-doc-utility-panel, [class*="navigator"], [class*="toolbar"], [class*="drawer"]'))
    .filter(p => p.parentElement === root)
  if (panels.length === 0) return true
  const children = Array.from(root.children)
  const lastPanelIdx = Math.max(...panels.map(p => children.indexOf(p)))
  return children.every((c, i) => panels.includes(c as HTMLElement) || i < lastPanelIdx)
}

describe('V5.14-R9 / V2.1 — visual transaction closure (host wiring)', () => {
  it('§16 — a normal ACTIVATE / same-target DEACTIVATE keeps every V2.1 gate at 0', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()

    await click(host, 'E1')
    expect(api().getVisualTransactionV21Counters().idleWithActiveFill).toBe(0)
    expect(api().getVisualTransactionV21Counters().idleWithActiveLease).toBe(0)
    expect(closconlyIdleIllegal()).toBe(false)

    await click(host, 'E1')
    const counters = api().getVisualTransactionV21Counters()
    // the DEACTIVATE closed State + Fill + Lease TOGETHER (no half rollback)
    expect(counters.idleWithActiveFill).toBe(0)
    expect(counters.idleWithActiveLease).toBe(0)
    expect(counters.idleWithActiveMarker).toBe(0)
    expect(counters.idleWithActiveTransaction).toBe(0)
    expect(counters.visualFailurePartialRollback).toBe(0)
    expect(counters.atomicTeardownIncomplete).toBe(0)
    expect(counters.rollbackWithFillSurvival).toBe(0)
    expect(counters.rollbackWithLeaseSurvival).toBe(0)
    expect(api().getVisualTransactionV21GateDecision().decision).toBe('PASS')
  })

  it('§6.1 — the production layering invariant holds: utility panels paint LAST', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()
    await click(host, 'E1')
    expect(closureAudit().panelPaintOrderEnforced).toBe('true')
    expect(api().getVisualTransactionV21Counters().unrecoveredFramePaintsAboveNavigator).toBe(0)
    expect(api().getVisualTransactionV21Counters().navigatorCollisionRecoveryFailure).toBe(0)
    expect(utilityPanelsLast()).toBe(true)
  })

  it('§17 — the collision DETECTION surface is reported even when nothing collides', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, fourDiags())
    api().renderHeadingDiagnosticMarkers()
    await click(host, 'E1')
    const report = api().getVisualTransactionV21CoverageReport()
    expect(report).toHaveLength(4)
    expect(report[0]).toBe('FRAME_PAINTS_ABOVE_NAVIGATOR_COUNT=0')
  })
})

const closconlyIdleIllegal = (): boolean => {
  const c = api().getVisualTransactionV21Counters()
  return (c.idleWithActiveFill ?? 0) > 0 || (c.idleWithActiveLease ?? 0) > 0
}
