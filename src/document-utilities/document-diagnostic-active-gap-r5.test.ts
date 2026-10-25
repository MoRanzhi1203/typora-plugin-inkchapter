// @vitest-environment jsdom
/**
 * R5 — Blank Gap Runtime Closure (automated subset).
 *
 * These tests drive the REAL lineage + group projection (same harness as the
 * R2/R3 suites) and the REAL one-owner PAINT contract. They assert FACTS
 * (member sets, anchor boundaries, owner decisions), never "a method ran".
 *
 * Items that need real Typora geometry / real keyboard input are marked in
 * `runtime/evidence/blank-gap-r5/REPORT.md` as PENDING; they are NOT claimed
 * here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import { analyzeInternalBlankLineGaps, internalBlankGapIdentity } from './document-diagnostic-internal-blank-lines-v1'
import {
  emptyDiagnosticInteractionState,
  isCurrentOwnerV2,
  ownerOf,
  shouldSkipGroupMemberForPrimaryCarrier,
} from './document-diagnostic-active-state-machine-v2'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

const CODE = 'EXCESSIVE_INTERNAL_BLANK_LINES'
let mdRef = { current: '' }
let docKeyRef = { current: 'doc:r5' }

function inputOf(markdown: string): DocumentDiagnosticsInput {
  return {
    documentKey: docKeyRef.current, markdown, strictMode: true, vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [], h1Facts: null,
  }
}
function snapshotOf(markdown: string, sourceRevision = 1): DocumentDiagnosticsSnapshot {
  const c = computeDocumentDiagnostics(inputOf(markdown))
  return {
    documentKey: docKeyRef.current, revision: sourceRevision, sourceRevision, generatedAt: 0,
    diagnostics: c.diagnostics, errorCount: c.errorCount, warningCount: c.warningCount, infoCount: c.infoCount,
  }
}
function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/r5.md',
      getDocumentKey: () => docKeyRef.current,
      getMarkdown: () => mdRef.current,
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
    getFormulaVisibleTagTokens: () => [], getFigureName: () => null, getTableName: () => null,
    getCodeName: () => null, getCodeLanguage: () => null, resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false, getHeadingIdentity: () => null, parseLocalLinkTargets: () => [],
  } as unknown as DocumentDiagnosticsProviders
}

type GapGroupState = {
  groupId: number
  lifecycle: 'ACTIVE' | 'DORMANT'
  originDiagnosticId: string
  members: Set<string>
  anchors: Array<{ prev: string; next: string }>
  scopePrev: string | null
  scopeNext: string | null
  documentKey: string | null
  sourceRevision: number | null
}
type Internals = {
  activeGapGroup: GapGroupState | null
  lastGapLineage: unknown
  updateGapLineage(snapshot: unknown): void
  reconcileActiveGapGroup(snapshot: unknown): void
  clearActiveGapGroup(reason: string): void
  onDiagnosticActivatedForGapGroup(id: string | null): void
  isActiveGapGroupMemberDiagnostic(id: string | null): boolean
  activeGapGroupVisualEls: HTMLElement[]
  snapshot: DocumentDiagnosticsSnapshot | null
  lastBlockGapDiagnosticId: string | null
  blockGapVisualEl: HTMLElement | null
}

let host: DocumentUtilityOverlayHost

function makeHost(): Internals {
  host = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() } as never)
  return host as unknown as Internals
}
const gapIdsOf = (markdown: string): string[] => analyzeInternalBlankLineGaps(markdown).map(internalBlankGapIdentity)
const blanks = (n: number): string => '\n'.repeat(n + 1)

function anchorsOf(markdown: string, ids: Iterable<string>): Array<{ prev: string; next: string }> {
  const want = new Set(ids)
  const out: Array<{ prev: string; next: string }> = []
  for (const gap of analyzeInternalBlankLineGaps(markdown)) {
    if (!want.has(internalBlankGapIdentity(gap))) continue
    out.push({ prev: gap.previousBlockIdentity, next: gap.nextBlockIdentity })
  }
  return out
}
function seedGroup(h: Internals, markdown: string, ids?: Iterable<string>): Set<string> {
  const set = new Set(ids ?? gapIdsOf(markdown))
  const anchors = anchorsOf(markdown, set)
  h.activeGapGroup = {
    groupId: 1,
    lifecycle: 'ACTIVE',
    originDiagnosticId: 'origin',
    members: set,
    anchors,
    scopePrev: anchors.length > 0 ? anchors[0].prev : null,
    scopeNext: anchors.length > 0 ? anchors[anchors.length - 1].next : null,
    documentKey: docKeyRef.current,
    sourceRevision: 1,
  }
  return set
}
/** Apply ONE edit: seed on `from`, then reconcile `to` (the real commit order). */
function step(h: Internals, from: string, to: string, revision: number): Set<string> {
  mdRef.current = from
  h.snapshot = snapshotOf(from, revision - 1)
  h.updateGapLineage(h.snapshot)
  mdRef.current = to
  const next = snapshotOf(to, revision)
  h.snapshot = next
  h.reconcileActiveGapGroup(next)
  return new Set(h.activeGapGroup?.members ?? [])
}

beforeEach(() => {
  document.body.innerHTML = ''
  mdRef = { current: '' }
  docKeyRef = { current: 'doc:r5' }
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} } as unknown as typeof ResizeObserver)
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', (() => {}) as typeof cancelAnimationFrame)
})

// ── R5 §3/§5 — ONE visual owner per target ─────────────────────────────────

describe('R5 §3/§5 — the primary carrier may skip a group member only while it really exists', () => {
  it('R5-13 a member whose id equals the primary id AND a connected carrier IS skipped', () => {
    expect(shouldSkipGroupMemberForPrimaryCarrier({
      memberDiagnosticId: 'D1', primaryDiagnosticId: 'D1', primaryCarrierConnected: true,
    })).toBe(true)
  })

  it('R5-12 a RETIRED primary carrier must never suppress the group highlight', () => {
    expect(shouldSkipGroupMemberForPrimaryCarrier({
      memberDiagnosticId: 'D1', primaryDiagnosticId: 'D1', primaryCarrierConnected: false,
    })).toBe(false)
  })

  it('R5-12b a stale primary id (registered before a failed paint) never suppresses', () => {
    expect(shouldSkipGroupMemberForPrimaryCarrier({
      memberDiagnosticId: 'D-split-left', primaryDiagnosticId: 'D-origin', primaryCarrierConnected: true,
    })).toBe(false)
    expect(shouldSkipGroupMemberForPrimaryCarrier({
      memberDiagnosticId: 'D1', primaryDiagnosticId: null, primaryCarrierConnected: true,
    })).toBe(false)
    expect(shouldSkipGroupMemberForPrimaryCarrier({
      memberDiagnosticId: null, primaryDiagnosticId: 'D1', primaryCarrierConnected: true,
    })).toBe(false)
  })
})

describe('R5-17 — an older paint generation can never override the current one', () => {
  it('R5-17 only the CURRENT owner version/target passes the async guard', () => {
    const current = {
      ...emptyDiagnosticInteractionState(),
      version: 7, phase: 'ACTIVE' as const, diagnosticId: 'G1', targetKey: 'k1',
      diagnosticTargetIndex: 0, transactionLocalTargetIndex: null, transactionId: 3, leaseToken: 'l3',
    }
    const owner = ownerOf(current)!
    expect(isCurrentOwnerV2(owner, current)).toBe(true)
    // an older generation (version 6) of the SAME target is stale
    expect(isCurrentOwnerV2({ ...owner, version: 6 }, current)).toBe(false)
    // a different target is stale even at the same version
    expect(isCurrentOwnerV2({ ...owner, targetKey: 'k2' }, current)).toBe(false)
  })
})

// ── R5 §2 S01→S10 — lineage facts ───────────────────────────────────────────

describe('R5 — split / local edit / compliance / merge (S01–S07)', () => {
  it('R5-01 one real edit splits into TWO independently proven members', () => {
    const base = `甲${blanks(11)}乙`
    const split = `甲${blanks(5)}X${blanks(5)}乙`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    const members = step(h, base, split, 2)
    const ids = gapIdsOf(split)
    expect(ids.length).toBe(2)
    expect(members).toEqual(new Set(ids))
    // the two members have DIFFERENT boundary pairs (two real positions)
    const anchors = h.activeGapGroup?.anchors ?? []
    const distinct = new Set(anchors.map(a => `${a.prev}>>${a.next}`))
    expect(distinct.size).toBeGreaterThanOrEqual(2)
  })

  it('R5-02 a split with only one excessive side keeps only that side', () => {
    const base = `甲${blanks(11)}乙`
    const oneSide = `甲${blanks(5)}X\n乙`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    const members = step(h, base, oneSide, 2)
    expect(members).toEqual(new Set(gapIdsOf(oneSide)))
    expect(members.size).toBe(1)
  })

  it('R5-03 both sides excessive → both are members in the SAME revision', () => {
    const base = `甲${blanks(11)}乙`
    const split = `甲${blanks(4)}X${blanks(4)}乙`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    const members = step(h, base, split, 2)
    expect(members.size).toBe(2)
    expect(h.activeGapGroup?.sourceRevision).toBe(2)
  })

  it('R5-04 shrinking the LEFT side only updates the left member', () => {
    const split = `甲${blanks(5)}X${blanks(5)}乙`
    const leftShrunk = `甲${blanks(3)}X${blanks(5)}乙`
    mdRef.current = split
    const h = makeHost()
    h.updateGapLineage(snapshotOf(split, 1))
    seedGroup(h, split)
    const members = step(h, split, leftShrunk, 2)
    const ids = gapIdsOf(leftShrunk)
    expect(members).toEqual(new Set(ids))
    // the RIGHT anchor pair is untouched
    const rightPair = ids[ids.length - 1]
    const rightAnchor = anchorsOf(leftShrunk, [rightPair])[0]
    expect(h.activeGapGroup?.anchors).toContainEqual(rightAnchor)
  })

  it('R5-05 left goes compliant then excessive again → DORMANT then proven recovery', () => {
    const split = `甲${blanks(5)}X${blanks(5)}乙`
    const leftCompliant = `甲\nX${blanks(5)}乙`
    const leftBack = `甲${blanks(3)}X${blanks(5)}乙`
    mdRef.current = split
    const h = makeHost()
    h.updateGapLineage(snapshotOf(split, 1))
    seedGroup(h, split)
    const dormant = step(h, split, leftCompliant, 2)
    expect(dormant).toEqual(new Set(gapIdsOf(leftCompliant)))
    expect(dormant.size).toBe(1)
    const recovered = step(h, leftCompliant, leftBack, 3)
    expect(recovered).toEqual(new Set(gapIdsOf(leftBack)))
    expect(recovered.size).toBe(2)
    expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
  })

  it('R5-06 both sides compliant → DORMANT with ZERO painted carriers', () => {
    const split = `甲${blanks(5)}X${blanks(5)}乙`
    const compliant = `甲\nX\n乙`
    mdRef.current = split
    const h = makeHost()
    h.updateGapLineage(snapshotOf(split, 1))
    seedGroup(h, split)
    const members = step(h, split, compliant, 2)
    expect(members.size).toBe(0)
    expect(h.activeGapGroup?.lifecycle).toBe('DORMANT')
    expect(h.activeGapGroupVisualEls).toHaveLength(0)
  })

  it('R5-07 deleting the middle text merges into ONE range covering the full gap', () => {
    const split = `甲${blanks(5)}X${blanks(5)}乙`
    const merged = `甲${blanks(11)}乙`
    mdRef.current = split
    const h = makeHost()
    h.updateGapLineage(snapshotOf(split, 1))
    seedGroup(h, split)
    const members = step(h, split, merged, 2)
    expect(members).toEqual(new Set(gapIdsOf(merged)))
    expect(members.size).toBe(1)
    // the merged pair is the full 甲..乙 range, not a leftover descendant
    const anchors = h.activeGapGroup?.anchors ?? []
    expect(anchors.some(a => a.prev.endsWith('甲#0') && a.next.endsWith('乙#0'))).toBe(true)
  })

  it('R5-08 merging the ACTIVE member with an untouched neighbour expands the range', () => {
    const split = `甲${blanks(4)}X${blanks(4)}乙`
    const merged = `甲${blanks(9)}乙`
    mdRef.current = split
    const h = makeHost()
    h.updateGapLineage(snapshotOf(split, 1))
    // only the LEFT member is active; the right one is an untouched neighbour
    seedGroup(h, split, [gapIdsOf(split)[0]])
    const members = step(h, split, merged, 2)
    expect(members).toEqual(new Set(gapIdsOf(merged)))
    expect(members.size).toBe(1)
  })

  it('R5-09 three consecutive split/merge cycles never duplicate or drop the highlight', () => {
    const base = `甲${blanks(11)}乙`
    const split = `甲${blanks(5)}X${blanks(5)}乙`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    let cur = base
    const sequence = [split, base, split, base, split]
    sequence.forEach((next, i) => {
      const members = step(h, cur, next, i + 2)
      const expected = next === base ? 1 : 2
      expect(members.size).toBe(expected)
      expect(h.activeGapGroup?.members.size).toBe(expected)
      expect(new Set(h.activeGapGroup?.members).size).toBe(expected)
      expect(h.activeGapGroupVisualEls.length).toBeLessThanOrEqual(expected)
      cur = next
    })
    expect(h.activeGapGroup?.members).toEqual(new Set(gapIdsOf(split)))
  })
})

describe('R5 — unrelated gaps never inherit (S10)', () => {
  it('R5-10 a NEW unrelated gap with the same rule is never adopted', () => {
    const base = `甲${blanks(5)}乙\n丙\n丁`
    const withNew = `甲${blanks(5)}乙\n丙${blanks(5)}丁`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    const members = step(h, base, withNew, 2)
    expect(members).toEqual(new Set(gapIdsOf(base)))
    expect(members.has(gapIdsOf(withNew)[1])).toBe(false)
  })

  it('R5-11 an unrelated gap inside a historically expanded scope has 0 inheritance', () => {
    // 乙 and 丙 are SEPARATE blocks, so the second gap owns 丙..丁 and shares NO
    // boundary with the active 甲..乙 anchor.
    const md = `甲${blanks(5)}乙${blanks(1)}丙${blanks(5)}丁`
    mdRef.current = md
    const h = makeHost()
    h.updateGapLineage(snapshotOf(md, 1))
    const gaps = analyzeInternalBlankLineGaps(md)
    expect(gaps.length).toBe(2)
    expect(gaps[1].previousBlockIdentity).not.toBe(gaps[0].nextBlockIdentity)
    seedGroup(h, md, [internalBlankGapIdentity(gaps[0])])
    // historical extent reached the SECOND gap's end block (a previously proven merge)
    h.activeGapGroup!.scopeNext = gaps[1].nextBlockIdentity
    const next = snapshotOf(md, 2)
    h.snapshot = next
    h.reconcileActiveGapGroup(next)
    expect(h.activeGapGroup?.members).toEqual(new Set([internalBlankGapIdentity(gaps[0])]))
    expect(h.activeGapGroup?.members.has(internalBlankGapIdentity(gaps[1]))).toBe(false)
  })
})

describe('R5 — cancellation, switching and document lifecycle', () => {
  it('R5-14 clicking ANY current member cancels the whole group and every carrier', () => {
    const split = `甲${blanks(5)}X${blanks(5)}乙`
    mdRef.current = split
    const h = makeHost()
    h.snapshot = snapshotOf(split, 1)
    seedGroup(h, split)
    const diags = h.snapshot!.diagnostics.filter(d => d.code === CODE)
    expect(diags.length).toBe(2)
    expect(h.isActiveGapGroupMemberDiagnostic(diags[0].id)).toBe(true)
    expect(h.isActiveGapGroupMemberDiagnostic(diags[1].id)).toBe(true)
    h.clearActiveGapGroup('DEACTIVATE')
    expect(h.activeGapGroup).toBeNull()
    expect(h.activeGapGroupVisualEls).toHaveLength(0)
  })

  it('R5-15 activating another rule retires the gap group with no residue', () => {
    const md = `甲${blanks(5)}乙`
    mdRef.current = md
    const h = makeHost()
    h.snapshot = snapshotOf(md, 1)
    h.onDiagnosticActivatedForGapGroup('document:OTHER:block:code:0')
    expect(h.activeGapGroup).toBeNull()
    expect(h.activeGapGroupVisualEls).toHaveLength(0)
  })

  it('R5-18 group members are a subset of the PUBLISHED diagnostics (Drawer parity)', () => {
    const split = `甲${blanks(5)}X${blanks(5)}乙`
    mdRef.current = split
    const h = makeHost()
    h.updateGapLineage(snapshotOf(split, 1))
    seedGroup(h, split)
    const next = snapshotOf(split, 2)
    h.snapshot = next
    h.reconcileActiveGapGroup(next)
    const published = new Set(
      next.diagnostics.filter(d => d.code === CODE)
        .map(d => String((d as { targetIdentity?: string }).targetIdentity ?? '')),
    )
    for (const id of h.activeGapGroup?.members ?? []) expect(published.has(id)).toBe(true)
  })

  it('R5-20 a document switch retires the group (no cross-document visual)', () => {
    const md = `甲${blanks(5)}乙`
    mdRef.current = md
    const h = makeHost()
    h.updateGapLineage(snapshotOf(md, 1))
    seedGroup(h, md)
    docKeyRef.current = 'doc:other'
    mdRef.current = md
    const next = snapshotOf(md, 2)
    h.snapshot = next
    h.reconcileActiveGapGroup(next)
    expect(h.activeGapGroup).toBeNull()
    expect(h.activeGapGroupVisualEls).toHaveLength(0)
  })

  it('R5-16 undo/redo re-derives from the LATEST revision, never a stale member set', () => {
    const base = `甲${blanks(11)}乙`
    const split = `甲${blanks(5)}X${blanks(5)}乙`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    const a = step(h, base, split, 2)
    expect(a.size).toBe(2)
    const b = step(h, split, base, 3)
    expect(b.size).toBe(1)
    const c = step(h, base, split, 4)
    expect(c.size).toBe(2)
    expect(h.activeGapGroup?.sourceRevision).toBe(4)
  })
})
