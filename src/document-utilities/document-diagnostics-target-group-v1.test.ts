// @vitest-environment jsdom
/**
 * Target Group V1 — `DOCUMENT_HEADINGS_ONLY_NO_BODY` single-row Drawer closure
 * (§7/§8/§9/§11/§12/§13/§14/§15/§16/§19/§20).
 *
 * A TARGET GROUP is ONE diagnostic / ONE Drawer row / ONE interaction / ONE lease
 * with N co-equal heading members. It is ARCHITECTURALLY distinct from the ordinary
 * occurrence `multi-target` (N rows / `1-N` badge / cursor / switch), which MUST
 * keep its behaviour (regression-protected).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnostic, DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { DOCUMENT_DIAGNOSTIC_POST_SETTLE_CLOSURE_V2 } from './document-diagnostic-active-state-machine-v2'
import { HEADING_POST_RECONCILE_CLOSURE_EVENT } from './document-diagnostic-heading-active-persistence-v1'
import {
  flattenDiagnosticsToProjections,
  TARGET_GROUP_STABLE_IDENTITY,
} from './document-diagnostic-drawer-order-v514-r1'
import {
  getRuleMeta,
  resolveRuleActiveVisualMode,
  resolveRuleDrawerProjectionMode,
  resolveRuleInteractionMode,
  resolveDiagnosticLocation,
} from './document-diagnostic-location'
import { computeDocumentDiagnostics, DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE, type DocumentDiagnosticsInput } from './document-diagnostics'

// ── harness ─────────────────────────────────────────────────────────────────

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

type Internals = { locateDiagnostic(id: string, targetIndex?: number): void; renderDrawer(): void }
type HostApi = {
  renderHeadingDiagnosticMarkers(): void
  getDiagnosticInteractionStateV2(): {
    version: number
    phase: 'IDLE' | 'ACTIVE'
    diagnosticId: string | null
    targetKey: string | null
    diagnosticTargetIndex: number | null
    targetMode?: string
    groupMemberCount?: number
  }
  getActiveStateMachineV2GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
  getVisualTransactionV21GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
  getTargetGroupV1GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
  getTargetGroupV1GateReport(): string[]
  getTargetGroupV1CoverageReport(): string[]
  getTargetGroupV1DrawerFacts(): { groupProjectionCount: number; groupRowCount: number; groupOccurrenceBadgeCount: number; multiTargetProjectionCount: number }
  getTargetGroupProjectionCount(id: string): number
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

function makeWorld(levels: number[]): { h: DocumentUtilityOverlayHost; ids: string[] } {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  stubRect(shell, () => ({ left: 0, top: 0, right: 1200, bottom: 800 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  stubRect(write, () => ({ left: 0, top: 0, right: 1200, bottom: 800 }))
  const ids: string[] = []
  levels.forEach((level, i) => {
    const id = `H-${i + 1}`
    const el = document.createElement(`h${level}`)
    el.setAttribute('data-id', id)
    el.setAttribute('data-line', String(4 + i))
    el.textContent = `标题${i + 1}`
    write.appendChild(el)
    stubRect(el, () => ({ left: 100, top: 100 + i * 60, right: 700, bottom: 132 + i * 60 }))
    ids.push(id)
  })
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, ids }
}

/** ONE `target-group` hint over the given heading ids. */
function groupDiagnostic(ids: string[], id = 'group-1'): Record<string, unknown> {
  return {
    id,
    domain: 'document',
    documentKey: 'doc:key',
    severity: 'info',
    category: 'document',
    code: 'DOCUMENT_HEADINGS_ONLY_NO_BODY',
    message: '文档只有标题结构',
    detail: '当前文档包含多个标题，但尚未包含实际正文内容。',
    stableIdentity: ids[0],
    targetIdentity: `headings-only:${ids[0]}`,
    metadata: { scope: 'document', reasonChip: false, groupMemberCount: ids.length },
    location: {
      kind: 'target-group',
      scrollAnchor: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: ids[0] },
      targets: ids.map(id2 => ({ kind: 'canonical-node', nodeKind: 'heading', stableIdentity: id2 })),
    },
  }
}

/** ONE ordinary occurrence `multi-target` diagnostic (regression control). */
function multiTargetDiagnostic(ids: string[], id = 'multi-1'): Record<string, unknown> {
  return {
    id,
    domain: 'document',
    documentKey: 'doc:key',
    severity: 'warning',
    category: 'heading',
    code: 'HEADING_DUPLICATE_TEXT',
    message: '重复的标题文字',
    detail: '',
    metadata: {},
    location: {
      kind: 'multi-target',
      targets: ids.map(id2 => ({ kind: 'canonical-node', nodeKind: 'heading', stableIdentity: id2 })),
    },
  }
}

function inject(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>, revision = 1): void {
  const info = diags.filter(d => d.severity === 'info').length
  const err = diags.filter(d => d.severity === 'error').length
  const warn = diags.filter(d => d.severity === 'warning').length
  const snapshot = {
    documentKey: 'doc:key', revision, sourceRevision: revision, generatedAt: 0,
    diagnostics: diags, errorCount: err, warningCount: warn, infoCount: info,
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
const renderDrawer = (h: DocumentUtilityOverlayHost): void => {
  ;(h as unknown as Internals).renderDrawer()
}
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
const activeWrapperCount = (): number => document.querySelectorAll('.inkchapter-heading-diagnostic-active').length
const drawerRows = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-doc-drawer__item[data-diagnostic-id]'))
const occurrenceBadges = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-doc-drawer__item-target'))
const selectedRows = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-doc-drawer__item.is-selected[data-diagnostic-id]'))
const lastAudit = (event: string): Record<string, string> => {
  const lines = (infoSpy?.mock.calls ?? []).map(c => String(c[0] ?? '')).filter(l => l.includes(event))
  const line = lines[lines.length - 1] ?? ''
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}
const closureAudit = (): Record<string, string> => lastAudit(DOCUMENT_DIAGNOSTIC_POST_SETTLE_CLOSURE_V2)

// ── registry / producer / projection authority (pure) ───────────────────────

describe('Target Group V1 §6/§7/§8 — registry, producer and projection authority', () => {
  it('the rule is registered as a target-group with the group modes', () => {
    const meta = getRuleMeta(DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE)
    expect(meta).not.toBeNull()
    expect(meta!.locationStrategy).toBe('target-group')
    expect(meta!.presentation.interactionMode).toBe('group')
    expect(meta!.presentation.drawerProjectionMode).toBe('single-row')
    expect(meta!.presentation.activeVisualMode).toBe('text-tight-target-group')
    expect(meta!.presentation.reasonChip).toBe(false)
    expect(resolveRuleInteractionMode(DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE)).toBe('group')
    expect(resolveRuleDrawerProjectionMode(DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE)).toBe('single-row')
    expect(resolveRuleActiveVisualMode(DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE)).toBe('text-tight-target-group')
  })

  it('§7 — the producer emits ONE target-group diagnostic with all headings', () => {
    const el = (tag: string, line: number): HTMLElement => {
      const e = document.createElement(tag); e.setAttribute('data-line', String(line)); return e
    }
    const facts = [
      { level: 1, text: 'A', stableIdentity: 'H-A', element: el('h1', 0) },
      { level: 2, text: 'B', stableIdentity: 'H-B', element: el('h2', 2) },
      { level: 3, text: 'C', stableIdentity: 'H-C', element: el('h3', 4) },
    ]
    const input = {
      documentKey: 'doc:key', markdown: '# A\n\n## B\n\n### C\n', strictMode: true, vaultRoot: '/vault',
      headings: facts, h1Facts: [], latentAtxMarkers: [], figures: [], tables: [], codes: [], formulas: [], links: [],
      canonicalDuplicateIdentities: [], captionDuplicateNames: [],
    } as unknown as DocumentDiagnosticsInput
    const out = computeDocumentDiagnostics(input)
    const hits = out.diagnostics.filter(d => d.code === DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE)
    expect(hits).toHaveLength(1)
    expect(hits[0].location?.kind).toBe('target-group')
    if (hits[0].location?.kind !== 'target-group') throw new Error('not a target-group')
    expect(hits[0].location.targets).toHaveLength(3)
    expect(hits[0].location.scrollAnchor).toEqual({ kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-A' })
    expect(hits[0].metadata?.groupMemberCount).toBe(3)
  })

  it('§8 — flatten: a target-group yields EXACTLY ONE projection (no 1/N); multi-target keeps N', () => {
    const group: DocumentDiagnostic = {
      id: 'g', documentKey: 'doc:key', severity: 'info', category: 'document',
      code: 'DOCUMENT_HEADINGS_ONLY_NO_BODY', message: 'm',
      location: {
        kind: 'target-group',
        scrollAnchor: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-A' },
        targets: [
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-A' },
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-B' },
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-C' },
        ],
      },
    }
    const groupProjections = flattenDiagnosticsToProjections([group])
    expect(groupProjections).toHaveLength(1)
    expect(groupProjections[0].locationKind).toBe('target-group')
    expect(groupProjections[0].targetCount).toBe(1)
    expect(groupProjections[0].targetIndex).toBe(0)
    expect(groupProjections[0].stableIdentity).toBe(TARGET_GROUP_STABLE_IDENTITY)

    // ordinary occurrence multi-target is UNCHANGED (N projections, shared count).
    const occ: DocumentDiagnostic = {
      id: 'o', documentKey: 'doc:key', severity: 'warning', category: 'heading',
      code: 'HEADING_DUPLICATE_TEXT', message: 'm',
      location: {
        kind: 'multi-target',
        targets: [
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-A' },
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-B' },
        ],
      },
    }
    const occProjections = flattenDiagnosticsToProjections([occ])
    expect(occProjections).toHaveLength(2)
    expect(occProjections.map(p => p.targetCount)).toEqual([2, 2])
    expect(occProjections.map(p => p.targetIndex)).toEqual([0, 1])
  })

  it('§13 — the resolver locates the SCROLL ANCHOR for a target-group', () => {
    const diag: DocumentDiagnostic = {
      id: 'g', documentKey: 'doc:key', severity: 'info', category: 'document',
      code: 'DOCUMENT_HEADINGS_ONLY_NO_BODY', message: 'm',
      location: {
        kind: 'target-group',
        scrollAnchor: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-A' },
        targets: [
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-A' },
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-B' },
        ],
      },
    }
    const seen: string[] = []
    const result = resolveDiagnosticLocation(diag, diag.location, {
      documentKey: 'doc:key',
      getRoot: () => null,
      resolveHeadingIdentity: (id) => { seen.push(id); return null },
      resolveSourceLine: () => null,
      resolveBlockIdentity: () => null,
    }, 0)
    // the resolver only ever asks for the ANCHOR identity
    expect(seen).toEqual(['H-A'])
    expect(result.scrollAction).toBeNull()
  })
})

// ── host wiring ─────────────────────────────────────────────────────────────

describe('Target Group V1 §8/§9 — single-row Drawer projection', () => {
  it('§8/§9 — 3 headings → 1 hint row, 0 occurrence badge; multi-target keeps N rows + badge', async () => {
    const w = makeWorld([1, 2, 3, 2])
    host = w.h
    inject(host, [groupDiagnostic([w.ids[0], w.ids[1], w.ids[2]]), multiTargetDiagnostic([w.ids[2], w.ids[3]])])
    api().renderHeadingDiagnosticMarkers()
    renderDrawer(host)

    // group → exactly one row, no badge
    expect(api().getTargetGroupProjectionCount('group-1')).toBe(1)
    const groupRows = drawerRows().filter(r => r.getAttribute('data-diagnostic-id') === 'group-1')
    expect(groupRows).toHaveLength(1)
    expect(groupRows[0].querySelector('.inkchapter-doc-drawer__item-target')).toBeNull()
    // ordinary multi-target → 2 rows, each with a 1/2 · 2/2 badge
    const multiRows = drawerRows().filter(r => r.getAttribute('data-diagnostic-id') === 'multi-1')
    expect(multiRows).toHaveLength(2)
    expect(multiRows.map(r => r.querySelector('.inkchapter-doc-drawer__item-target')?.textContent)).toEqual(['1/2', '2/2'])
    // no `1/N` badge anywhere for the group
    expect(occurrenceBadges().filter(b => b.textContent?.includes('/3'))).toHaveLength(0)
    const facts = api().getTargetGroupV1DrawerFacts()
    expect(facts.groupProjectionCount).toBe(1)
    expect(facts.groupRowCount).toBe(1)
    expect(facts.groupOccurrenceBadgeCount).toBe(0)
    expect(facts.multiTargetProjectionCount).toBe(2)
    expect(api().getTargetGroupV1GateDecision().decision).toBe('PASS')
  })
})

describe('Target Group V1 §11/§12/§13/§14/§15/§16 — group interaction', () => {
  it('§12/§13/§14 — 3 headings: click → ACTIVE with 3 members; click again → IDLE', async () => {
    const w = makeWorld([1, 2, 3])
    host = w.h
    inject(host, [groupDiagnostic([w.ids[0], w.ids[1], w.ids[2]])])
    api().renderHeadingDiagnosticMarkers()
    renderDrawer(host)

    await click(host, 'group-1')
    const st = api().getDiagnosticInteractionStateV2()
    expect(st.phase).toBe('ACTIVE')
    expect(st.targetMode).toBe('group')
    expect(st.groupMemberCount).toBe(3)
    expect(st.diagnosticTargetIndex).toBe(0)
    // group key is the GROUP sentinel (never a member occurrence identity)
    expect(st.targetKey).toBe(`doc:key::group-1::0::${TARGET_GROUP_STABLE_IDENTITY}`)
    expect(activeFillCount()).toBe(3)
    expect(activeWrapperCount()).toBe(3)
    expect(selectedRows()).toHaveLength(1)
    const closure = closureAudit()
    expect(closure.decision).toBe('PASS')
    expect(closure.phaseAfter).toBe('ACTIVE')
    expect(closure.activeTargetCount).toBe('3')
    expect(closure.activeLeasePresent).toBe('true')
    const postReconcile = lastAudit(HEADING_POST_RECONCILE_CLOSURE_EVENT)
    expect(postReconcile.decision).toBe('PASS')
    expect(postReconcile.activeTargetCount).toBe('3')

    await click(host, 'group-1')
    expect(api().getDiagnosticInteractionStateV2().phase).toBe('IDLE')
    expect(activeFillCount()).toBe(0)
    expect(activeWrapperCount()).toBe(0)
    expect(selectedRows()).toHaveLength(0)
    expect(closureAudit().activeTargetCount).toBe('0')
    expect(api().getTargetGroupV1GateDecision().decision).toBe('PASS')
  })

  it('§12 — 2 headings: one click activates BOTH; second click DEACTIVATEs (never SWITCH)', async () => {
    const w = makeWorld([2, 3])
    host = w.h
    inject(host, [groupDiagnostic([w.ids[0], w.ids[1]])])
    api().renderHeadingDiagnosticMarkers()
    renderDrawer(host)
    await click(host, 'group-1')
    expect(activeFillCount()).toBe(2)
    expect(activeWrapperCount()).toBe(2)
    expect(closureAudit().activeTargetCount).toBe('2')
    await click(host, 'group-1')
    expect(api().getDiagnosticInteractionStateV2().phase).toBe('IDLE')
    expect(api().getTargetGroupV1GateReport()).toContain('TARGET_GROUP_TARGET_SWITCH_COUNT=0')
    expect(api().getTargetGroupV1GateReport()).toContain('TARGET_GROUP_CURSOR_READ_COUNT=0')
    expect(api().getTargetGroupV1GateReport()).toContain('TARGET_GROUP_CURSOR_ADVANCE_COUNT=0')
    expect(api().getTargetGroupV1GateReport()).toContain('TARGET_GROUP_REPEATED_CLICK_NOT_DEACTIVATE_COUNT=0')
    expect(api().getTargetGroupV1GateReport()).toContain('TARGET_GROUP_DRAWER_VISIBLE_ROW_MISMATCH_COUNT=0')
    expect(api().getTargetGroupV1GateReport()).toContain('TARGET_GROUP_EXPECTED_ACTIVE_TARGET_COUNT_MISMATCH_COUNT=0')
  })

  it('§19 — group activation coverage is proven (2-member and 3-member)', async () => {
    const w = makeWorld([1, 2, 3])
    host = w.h
    inject(host, [groupDiagnostic([w.ids[0], w.ids[1]], 'group-a')])
    api().renderHeadingDiagnosticMarkers()
    await click(host, 'group-a')
    inject(host, [groupDiagnostic(w.ids, 'group-b')])
    api().renderHeadingDiagnosticMarkers()
    await click(host, 'group-b')
    const report = api().getTargetGroupV1CoverageReport().join('|')
    expect(report).toContain('targetGroupTwoMemberActivationCount=1')
    expect(report).toContain('targetGroupThreeMemberActivationCount=1')
  })

  it('§20 — ordinary multi-target keeps its cursor / SWITCH behaviour (no regression)', async () => {
    const w = makeWorld([1, 2, 2])
    host = w.h
    inject(host, [multiTargetDiagnostic([w.ids[1], w.ids[2]])])
    api().renderHeadingDiagnosticMarkers()
    renderDrawer(host)
    await click(host, 'multi-1', 0)
    const st1 = api().getDiagnosticInteractionStateV2()
    expect(st1.diagnosticTargetIndex).toBe(0)
    // clicking the 2nd occurrence row locates the 2nd target (SWITCH, not DEACTIVATE)
    await click(host, 'multi-1', 1)
    const st2 = api().getDiagnosticInteractionStateV2()
    expect(st2.phase).toBe('ACTIVE')
    expect(st2.diagnosticTargetIndex).toBe(1)
    expect(api().getTargetGroupV1GateReport()).toContain('MULTI_TARGET_OCCURRENCE_REGRESSION_COUNT=0')
  })
})
