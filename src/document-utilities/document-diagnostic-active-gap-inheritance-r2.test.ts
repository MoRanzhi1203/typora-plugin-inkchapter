// @vitest-environment jsdom
/**
 * WC-R2 — ACTIVE GAP GROUP inheritance (AG01–AG20, automated subset).
 *
 * These tests drive the REAL host lineage + group projection (no scanner
 * rewrite). The group is the user's single semantic selection; the highlighted
 * members are derived from a provable block-range lineage, never from geometry.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import { analyzeInternalBlankLineGaps, internalBlankGapIdentity } from './document-diagnostic-internal-blank-lines-v1'
import {
  emptyDiagnosticInteractionState,
  reduceDiagnosticClick,
  type DiagnosticInteractionState,
} from './document-diagnostic-active-state-machine-v2'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

const CODE = 'EXCESSIVE_INTERNAL_BLANK_LINES'
let mdRef = { current: '' }
let docKeyRef = { current: 'doc:key' }

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
      getActiveFilePath: () => '/vault/doc.md',
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
  activeGapGroupVisualEls: HTMLElement[]
  snapshot: DocumentDiagnosticsSnapshot | null
}

let host: DocumentUtilityOverlayHost

function makeHost(): Internals {
  host = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() } as never)
  return host as unknown as Internals
}

/** The proven `(prev, next)` boundary pairs of the given gap identities. */
function anchorsOf(markdown: string, identities: Iterable<string>): Array<{ prev: string; next: string }> {
  const want = new Set(identities)
  const out: Array<{ prev: string; next: string }> = []
  for (const gap of analyzeInternalBlankLineGaps(markdown)) {
    if (!want.has(internalBlankGapIdentity(gap))) continue
    out.push({ prev: gap.previousBlockIdentity, next: gap.nextBlockIdentity })
  }
  return out
}

/** Seed a fully-formed ACTIVE group (R3 shape) on the OLD revision. */
function seedGroup(h: Internals, markdown: string, identities?: Iterable<string>): Set<string> {
  const ids = new Set(identities ?? gapIdsOf(markdown))
  const anchors = anchorsOf(markdown, ids)
  h.activeGapGroup = {
    groupId: 1,
    lifecycle: 'ACTIVE',
    originDiagnosticId: 'origin-diag',
    members: ids,
    anchors,
    scopePrev: anchors.length > 0 ? anchors[0].prev : null,
    scopeNext: anchors.length > 0 ? anchors[anchors.length - 1].next : null,
    documentKey: docKeyRef.current,
    sourceRevision: 1,
  }
  return ids
}

/** Seed an active group on the OLD revision, then reconcile the NEW one. */
function evolve(oldMarkdown: string, newMarkdown: string, revision = 2): Set<string> {
  mdRef.current = oldMarkdown
  const h = makeHost()
  const oldSnapshot = snapshotOf(oldMarkdown, revision - 1)
  const oldGap = analyzeInternalBlankLineGaps(oldMarkdown)[0]
  expect(oldGap, 'the seed revision must own an excessive gap').toBeTruthy()
  seedGroup(h, oldMarkdown, [internalBlankGapIdentity(oldGap)])
  h.updateGapLineage(oldSnapshot)
  mdRef.current = newMarkdown
  const next = snapshotOf(newMarkdown, revision)
  h.snapshot = next
  h.reconcileActiveGapGroup(next)
  return new Set(h.activeGapGroup?.members ?? [])
}

const gapIdsOf = (markdown: string): string[] => analyzeInternalBlankLineGaps(markdown).map(internalBlankGapIdentity)
/** N VISIBLE blank lines (N + 1 newline characters). */
const blanks = (n: number): string => '\n'.repeat(n + 1)

beforeEach(() => {
  document.body.innerHTML = ''
  mdRef = { current: '' }
  docKeyRef = { current: 'doc:key' }
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} } as unknown as typeof ResizeObserver)
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', (() => {}) as typeof cancelAnimationFrame)
})

describe('WC-R2 active gap group — split / edit / merge', () => {
  it('AG01 one active gap split into 3+3 inherits BOTH new gaps', () => {
    const oldMd = `甲${blanks(5)}乙`
    const newMd = `甲${blanks(3)}X${blanks(3)}乙`
    const members = evolve(oldMd, newMd)
    expect(members.size).toBe(2)
    expect(members).toEqual(new Set(gapIdsOf(newMd)))
  })

  it('AG02 split 3+1 inherits only the excessive side', () => {
    const members = evolve(`甲${blanks(5)}乙`, `甲${blanks(3)}X\n乙`)
    expect(members.size).toBe(1)
  })

  it('AG03 split 1+1 leaves a DORMANT group (intent kept, zero highlights)', () => {
    const members = evolve(`甲${blanks(5)}乙`, `甲\nX\n乙`)
    expect(members.size).toBe(0)
    // WC-R3 §2.2 — nothing is published, but the anchors still resolve, so the
    // intent survives as DORMANT instead of being destroyed.
    const g = (host as unknown as Internals).activeGapGroup
    expect(g?.lifecycle).toBe('DORMANT')
  })

  it('AG04 shrinking one side removes only that side', () => {
    const split = `甲${blanks(3)}X${blanks(3)}乙`
    // seed the group with BOTH split members, then recover the first one
    mdRef.current = split
    const h = makeHost()
    h.updateGapLineage(snapshotOf(split, 1))
    seedGroup(h, split)
    mdRef.current = `甲\nX${blanks(3)}乙`
    const next = snapshotOf(`甲\nX${blanks(3)}乙`, 2)
    h.snapshot = next
    h.reconcileActiveGapGroup(next)
    expect(h.activeGapGroup?.members).toEqual(new Set(gapIdsOf(`甲\nX${blanks(3)}乙`)))
    expect(h.activeGapGroup?.members.size).toBe(1)
  })

  it('AG05 a second split keeps existing siblings and inherits descendants', () => {
    const newMd = `甲${blanks(2)}Y${blanks(2)}X${blanks(3)}乙`
    const members = evolve(`甲${blanks(3)}X${blanks(3)}乙`, newMd)
    // The seeded member is 甲>>X; only its descendants (inside 甲..X) inherit.
    const expected = new Set(gapIdsOf(newMd).filter(id => id.includes('甲#0>>') || id.includes('>>paragraph:X#0')))
    expect(members).toEqual(expected)
    expect(members.size).toBe(2)
  })

  it('AG06 deleting the middle text merges into ONE inherited gap', () => {
    const split = `甲${blanks(3)}X${blanks(3)}乙`
    mdRef.current = split
    const h = makeHost()
    h.updateGapLineage(snapshotOf(split, 1))
    seedGroup(h, split)
    const merged = `甲${blanks(7)}乙`
    mdRef.current = merged
    const next = snapshotOf(merged, 2)
    h.snapshot = next
    h.reconcileActiveGapGroup(next)
    expect(h.activeGapGroup?.members).toEqual(new Set(gapIdsOf(merged)))
    expect(h.activeGapGroup?.members.size).toBe(1)
  })

  it('AG07 a merge never spans existing non-empty content', () => {
    const members = evolve(`甲${blanks(5)}乙`, `甲${blanks(3)}X${blanks(3)}乙`)
    // both new gaps are siblings; no gap covers `X`
    for (const id of members) expect(id).not.toMatch(/>(\s*)paragraph:X.*>>/)
  })

  it('AG08 a compliant merge retires the group', () => {
    const members = evolve(`甲${blanks(5)}乙`, `甲\n乙`)
    expect(members.size).toBe(0)
  })

  it('AG12 undo / redo re-derives lineage from the real source', () => {
    const base = `甲${blanks(5)}乙`
    const split = `甲${blanks(3)}X${blanks(3)}乙`
    const first = evolve(base, split)
    expect(first.size).toBe(2)
    // redo back to the original source with an empty lineage cache is NOT a
    // valid lineage input → fail closed (no inheritance) and no stale members.
    mdRef.current = split
    const h = host as unknown as Internals
    h.updateGapLineage(snapshotOf(split, 2))
    mdRef.current = base
    const next = snapshotOf(base, 3)
    h.snapshot = next
    h.reconcileActiveGapGroup(next)
    expect(h.activeGapGroup?.members).toEqual(new Set(gapIdsOf(base)))
  })

  it('AG09 a repeated click on a group member cancels the WHOLE group', () => {
    const md = `甲${blanks(3)}X${blanks(3)}乙`
    mdRef.current = md
    const h = makeHost()
    h.snapshot = snapshotOf(md, 1)
    const internals = h as unknown as {
      onDiagnosticActivatedForGapGroup(id: string | null): void
      retireActiveVisualForDeactivate(owner: null, click: unknown): void
      activeGapGroup: { members: Set<string> } | null
      activeGapGroupVisualEls: HTMLElement[]
    }
    const first = h.snapshot.diagnostics.find(d => d.code === CODE)!
    internals.onDiagnosticActivatedForGapGroup(first.id)
    expect(internals.activeGapGroup?.members.size).toBe(1)
    // Same-target toggle-off (the real DEACTIVATE side effect).
    internals.retireActiveVisualForDeactivate(null, { diagnosticId: first.id } as never)
    expect(internals.activeGapGroup).toBeNull()
    expect(internals.activeGapGroupVisualEls).toHaveLength(0)
  })

  it('AG10 activating an unrelated diagnostic clears the gap group', () => {
    const md = `甲${blanks(5)}乙`
    mdRef.current = md
    const h = makeHost()
    h.snapshot = snapshotOf(md, 1)
    const internals = h as unknown as {
      onDiagnosticActivatedForGapGroup(id: string | null): void
      activeGapGroup: { members: Set<string> } | null
    }
    const gap = h.snapshot.diagnostics.find(d => d.code === CODE)!
    internals.onDiagnosticActivatedForGapGroup(gap.id)
    expect(internals.activeGapGroup?.members.size).toBe(1)
    // A non-gap diagnostic id (or an unknown one) must drop the group entirely.
    internals.onDiagnosticActivatedForGapGroup('document:CODE_MISSING_NAME:block:code:0')
    expect(internals.activeGapGroup).toBeNull()
  })

  it('AG11 geometry-only changes keep the group membership stable', () => {
    const split = `甲${blanks(3)}X${blanks(3)}乙`
    mdRef.current = split
    const h = makeHost()
    h.updateGapLineage(snapshotOf(split, 1))
    seedGroup(h, split)
    const next = snapshotOf(split, 2)
    h.snapshot = next
    const before = new Set(h.activeGapGroup?.members)
    h.reconcileActiveGapGroup(next)
    h.reconcileActiveGapGroup(next)
    const after = new Set(h.activeGapGroup?.members)
    expect(after).toEqual(before)
    expect(after.size).toBe(2)
  })

  it('AG13 rapid split → merge → split never resurrects a stale group', () => {
    const base = `甲${blanks(5)}乙`
    const split = `甲${blanks(3)}X${blanks(3)}乙`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    const steps = [split, base, split]
    steps.forEach((md, i) => {
      mdRef.current = md
      const next = snapshotOf(md, i + 2)
      h.snapshot = next
      h.reconcileActiveGapGroup(next)
    })
    expect(h.activeGapGroup?.members).toEqual(new Set(gapIdsOf(split)))
    expect(h.activeGapGroup?.members.size).toBe(2)
  })

  it('AG21 a descendant withheld by the visible gate rejoins on the next edit', () => {
    // Real runtime sequence (observed in Typora): after the split one side is
    // still a SOURCE gap but the VISIBLE-count gate withholds its diagnostic.
    // A later edit makes it visible again — the user's selection must own it.
    const base = `甲${blanks(5)}乙`
    const split = `甲${blanks(3)}X${blanks(3)}乙`
    const ids = gapIdsOf(split)
    expect(ids.length).toBe(2)
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    // Split, with the FIRST gap withheld by the visible gate.
    mdRef.current = split
    const withheld = snapshotOf(split, 2)
    withheld.diagnostics = withheld.diagnostics.filter(d =>
      String((d as { targetIdentity?: string }).targetIdentity ?? '') !== ids[0])
    h.snapshot = withheld
    h.reconcileActiveGapGroup(withheld)
    expect(h.activeGapGroup?.members).toEqual(new Set(ids))
    // Next edit: the withheld gap is visible again.
    const visible = snapshotOf(split, 3)
    h.snapshot = visible
    h.reconcileActiveGapGroup(visible)
    expect(h.activeGapGroup?.members).toEqual(new Set(ids))
    expect(h.activeGapGroup?.members.size).toBe(2)
  })

  it('AG23 a side that lost every blank line rejoins once it is excessive again', () => {
    // The observed runtime sequence: the inserted paragraph touches one neighbour
    // (ZERO blank lines → no gap record at all), so gap-to-gap lineage alone can
    // never re-adopt that side. The SELECTED block range must.
    const base = `甲${blanks(5)}乙`
    const zeroSide = `甲\nX${blanks(4)}乙`
    const restored = `甲${blanks(2)}X${blanks(4)}乙`
    expect(gapIdsOf(zeroSide).length).toBe(1)
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    ;[zeroSide, restored].forEach((md, i) => {
      mdRef.current = md
      const next = snapshotOf(md, i + 2)
      h.snapshot = next
      h.reconcileActiveGapGroup(next)
    })
    expect(h.activeGapGroup?.members).toEqual(new Set(gapIdsOf(restored)))
    expect(h.activeGapGroup?.members.size).toBe(2)
  })

  it('AG22 a group with nothing published goes DORMANT (never a stale highlight)', () => {
    const base = `甲${blanks(5)}乙`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    // The only lineage member is a SOURCE gap, but nothing is published.
    const hidden = snapshotOf(base, 2)
    hidden.diagnostics = hidden.diagnostics.filter(d => d.code !== CODE)
    h.snapshot = hidden
    h.reconcileActiveGapGroup(hidden)
    expect(h.activeGapGroup?.lifecycle).toBe('DORMANT')
    expect(h.activeGapGroup?.members.size).toBe(1)
    expect(h.activeGapGroupVisualEls).toHaveLength(0)
  })

  it('AG14 identical paragraph text stays inside the proven range (no mis-inheritance)', () => {
    const oldMd = `正文${blanks(5)}正文`
    const newMd = `正文${blanks(3)}正文${blanks(3)}正文`
    const members = evolve(oldMd, newMd)
    // With identical text the ordinal identity of the OLD next block now points at
    // the inserted middle paragraph; only provable descendants inherit. Nothing
    // outside the new range may enter the group.
    expect(members.size).toBeGreaterThanOrEqual(1)
    expect(members.size).toBeLessThanOrEqual(2)
    for (const id of members) expect(gapIdsOf(newMd)).toContain(id)
  })

  it('AG15 a document switch clears the group (no cross-document contamination)', () => {
    const oldMd = `甲${blanks(5)}乙`
    mdRef.current = oldMd
    const h = makeHost()
    h.updateGapLineage(snapshotOf(oldMd, 1))
    seedGroup(h, oldMd)
    docKeyRef.current = 'doc:other'
    mdRef.current = `甲${blanks(5)}乙`
    const next = snapshotOf(`甲${blanks(5)}乙`, 2)
    h.snapshot = next
    h.reconcileActiveGapGroup(next)
    expect(h.activeGapGroup).toBeNull()
  })

  it('AG17 an inactive gap split never auto-activates a group', () => {
    mdRef.current = `甲${blanks(5)}乙`
    const h = makeHost()
    h.updateGapLineage(snapshotOf(`甲${blanks(5)}乙`, 1))
    mdRef.current = `甲${blanks(3)}X${blanks(3)}乙`
    const next = snapshotOf(`甲${blanks(3)}X${blanks(3)}乙`, 2)
    h.snapshot = next
    h.reconcileActiveGapGroup(next)
    expect(h.activeGapGroup).toBeNull()
  })

  it('AG18 a new activation supersedes the old group (only one group)', () => {
    const md = `甲${blanks(3)}X${blanks(3)}乙`
    mdRef.current = md
    const h = makeHost()
    const snapshot = snapshotOf(md, 1)
    h.snapshot = snapshot
    const diags = snapshot.diagnostics.filter(d => d.code === CODE)
    expect(diags.length).toBe(2)
    const internals = h as unknown as {
      onDiagnosticActivatedForGapGroup(id: string | null): void
      activeGapGroup: { members: Set<string> } | null
    }
    internals.onDiagnosticActivatedForGapGroup(diags[0].id)
    const firstMembers = new Set(internals.activeGapGroup?.members)
    internals.onDiagnosticActivatedForGapGroup(diags[1].id)
    expect(internals.activeGapGroup?.members.size).toBe(1)
    expect(internals.activeGapGroup?.members).not.toEqual(firstMembers)
  })

  it('AG19 trailing (EOF) blanks never enter an internal gap group', () => {
    const oldMd = `甲${blanks(5)}乙`
    const newMd = `甲${blanks(3)}X${blanks(3)}乙${blanks(5)}`
    const members = evolve(oldMd, newMd)
    expect(members.size).toBe(2)
    // the EOF run has no next block → it must not appear in any member id
    for (const id of members) expect(id.endsWith(`>>${''}`)).toBe(false)
  })

  it('AG20 20 split/merge cycles never grow members or leak a stale group', () => {
    const base = `甲${blanks(5)}乙`
    const split = `甲${blanks(3)}X${blanks(3)}乙`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    for (let i = 0; i < 20; i++) {
      const md = i % 2 === 0 ? split : base
      mdRef.current = md
      const next = snapshotOf(md, i + 2)
      h.snapshot = next
      h.reconcileActiveGapGroup(next)
      expect(h.activeGapGroup?.members.size ?? 0).toBeLessThanOrEqual(2)
    }
    expect(h.activeGapGroup?.members).toEqual(new Set(gapIdsOf(base)))
  })
})

describe('WC-R3 — active gap group lifecycle', () => {
  it('R3-04 DORMANT keeps the intent and resumes only for a proven descendant', () => {
    const split = `甲${blanks(3)}X${blanks(3)}乙`
    const allCompliant = `甲\nX\n乙`
    const leftAgain = `甲${blanks(3)}X\n乙`
    mdRef.current = split
    const h = makeHost()
    h.updateGapLineage(snapshotOf(split, 1))
    seedGroup(h, split)
    // Both descendants become compliant → DORMANT, zero highlights, no members.
    mdRef.current = allCompliant
    const dormant = snapshotOf(allCompliant, 2)
    h.snapshot = dormant
    h.reconcileActiveGapGroup(dormant)
    expect(h.activeGapGroup?.lifecycle).toBe('DORMANT')
    expect(h.activeGapGroup?.members.size).toBe(0)
    expect(h.activeGapGroup?.anchors.length).toBe(2)
    expect(h.activeGapGroupVisualEls).toHaveLength(0)
    // One descendant is excessive again → ACTIVE with ONLY that descendant.
    mdRef.current = leftAgain
    const active = snapshotOf(leftAgain, 3)
    h.snapshot = active
    h.reconcileActiveGapGroup(active)
    expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
    expect(h.activeGapGroup?.members).toEqual(new Set(gapIdsOf(leftAgain)))
    expect(h.activeGapGroup?.members.size).toBe(1)
  })

  it('R3-07 an unrelated gap inside a historically expanded range never inherits', () => {
    // `甲 [gap] 乙 丙 [gap] 丁`: the seeded member is 甲>>乙 while the historical
    // selection range was expanded to 甲..丁 (a previously proven merge).
    const md = `甲${blanks(5)}乙\n丙${blanks(5)}丁`
    mdRef.current = md
    const h = makeHost()
    h.updateGapLineage(snapshotOf(md, 1))
    seedGroup(h, md, [gapIdsOf(md)[0]])
    // Simulate the historical extension of the bounded selection.
    h.activeGapGroup!.scopeNext = 'block:paragraph:丁#0'
    const next = snapshotOf(md, 2)
    h.snapshot = next
    h.reconcileActiveGapGroup(next)
    expect(h.activeGapGroup?.members).toEqual(new Set([gapIdsOf(md)[0]]))
    // The 丙>>丁 gap is inside the historical extent but shares no boundary.
    expect(gapIdsOf(md).length).toBe(2)
    expect(h.activeGapGroup?.members.has(gapIdsOf(md)[1])).toBe(false)
  })

  it('R3-23 an unrelated neighbour is not adopted after the original disappears', () => {
    const seeded = `甲${blanks(5)}乙\n丙${blanks(5)}丁`
    const afterEdit = `甲${blanks(1)}乙\n\n丙${blanks(5)}丁`
    mdRef.current = seeded
    const h = makeHost()
    h.updateGapLineage(snapshotOf(seeded, 1))
    seedGroup(h, seeded, [gapIdsOf(seeded)[0]])
    h.activeGapGroup!.scopeNext = 'block:paragraph:丁#0'
    mdRef.current = afterEdit
    const next = snapshotOf(afterEdit, 2)
    h.snapshot = next
    h.reconcileActiveGapGroup(next)
    // The original 甲>>乙 is compliant; 丙>>丁 must NOT be silently adopted.
    expect(h.activeGapGroup?.members.size).toBe(0)
    expect(h.activeGapGroup?.lifecycle).toBe('DORMANT')
    expect(h.activeGapGroupVisualEls).toHaveLength(0)
  })

  it('R3-09 a current group member is recognised as a whole-group toggle-off', () => {
    const md = `甲${blanks(3)}X${blanks(3)}乙`
    mdRef.current = md
    const h = makeHost()
    h.snapshot = snapshotOf(md, 1)
    const internals = h as unknown as Internals & {
      onDiagnosticActivatedForGapGroup(id: string | null): void
      isActiveGapGroupMemberDiagnostic(id: string | null): boolean
    }
    seedGroup(h, md)
    const [first, second] = h.snapshot.diagnostics.filter(d => d.code === CODE)
    expect(internals.isActiveGapGroupMemberDiagnostic(first.id)).toBe(true)
    expect(internals.isActiveGapGroupMemberDiagnostic(second.id)).toBe(true)
    expect(internals.isActiveGapGroupMemberDiagnostic('document:OTHER:block:code:0')).toBe(false)
    // An unrelated activation replaces the group (never merges into it).
    internals.onDiagnosticActivatedForGapGroup('document:OTHER:block:code:0')
    expect(h.activeGapGroup).toBeNull()
  })

  it('R3-25 a descendant that lost every blank line rejoins after being split off', () => {
    // Real runtime sequence observed in Typora:
    //   1. the inserted paragraph lands INSIDE the next block (`X乙` is ONE block);
    //   2. the user splits it back out (`X` / `乙`), so the anchor pair dies;
    //   3. only afterwards the new side earns its own excessive blank run.
    // The group must still own both sides of the split.
    const base = `甲${blanks(5)}乙`
    const merged = `甲${blanks(5)}X乙`
    const splitOff = `甲${blanks(5)}X\n乙`
    const restored = `甲${blanks(5)}X${blanks(2)}乙`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    ;[merged, splitOff, restored].forEach((md, i) => {
      mdRef.current = md
      const next = snapshotOf(md, i + 2)
      h.snapshot = next
      h.reconcileActiveGapGroup(next)
    })
    expect(h.activeGapGroup?.members).toEqual(new Set(gapIdsOf(restored)))
    expect(h.activeGapGroup?.members.size).toBe(2)
  })

  it('R3-24 identical text on different boundaries keeps its own lineage', () => {
    // Two paragraphs share the exact same text; only the seeded pair may inherit.
    const md = `甲${blanks(5)}乙${blanks(1)}甲${blanks(5)}乙`
    const ids = gapIdsOf(md)
    expect(ids.length).toBe(2)
    mdRef.current = md
    const h = makeHost()
    h.updateGapLineage(snapshotOf(md, 1))
    seedGroup(h, md, [ids[0]])
    const splitMd = `甲${blanks(3)}X${blanks(3)}乙${blanks(1)}甲${blanks(5)}乙`
    mdRef.current = splitMd
    const next = snapshotOf(splitMd, 2)
    h.snapshot = next
    h.reconcileActiveGapGroup(next)
    const members = h.activeGapGroup?.members ?? new Set<string>()
    // The untouched second pair is never adopted, even though its text matches.
    expect(members.size).toBeLessThanOrEqual(2)
    for (const id of members) expect(id).not.toContain('甲#1')
  })
})

// ── WC-R4 §3.1 — ONE reducer decision per click ─────────────────────────────

function activeGapInteractionState(): DiagnosticInteractionState {
  return {
    ...emptyDiagnosticInteractionState(),
    version: 2,
    phase: 'ACTIVE',
    diagnosticId: 'G1',
    targetKey: 'doc:key::G1::0::甲>>X',
    diagnosticTargetIndex: 0,
    transactionLocalTargetIndex: null,
    transactionId: 5,
    leaseToken: 'lease:5',
  }
}
function gapClick(diagnosticId: string, targetKey: string) {
  return { diagnosticId, targetKey, diagnosticTargetIndex: 0, transactionLocalTargetIndex: null }
}

describe('WC-R4 §3.1 — the ONE click authority', () => {
  it('R4-13 clicking the ACTIVE target is DEACTIVATE (provenance agrees)', () => {
    const prev = activeGapInteractionState()
    const t = reduceDiagnosticClick(prev, gapClick('G1', prev.targetKey!), 6, null)
    expect(t.action).toBe('DEACTIVATE')
    expect(t.provenanceAction).toBe('DEACTIVATE')
    expect(t.reason).toBeUndefined()
    expect(t.next).toMatchObject({ version: 3, phase: 'IDLE', diagnosticId: null, targetKey: null })
  })

  it('R4-14 clicking an INHERITED member is the reducer’s own DEACTIVATE decision', () => {
    const prev = activeGapInteractionState()
    const t = reduceDiagnosticClick(
      prev,
      gapClick('G2', 'doc:key::G2::0::X>>Y'),
      6,
      null,
      { inheritedGroupMember: true },
    )
    // The final action is decided ONCE, in the reducer — never ACTIVATE-then-rewrite.
    // The mechanical (provenance) classification of an ACTIVE→other-target click
    // is SWITCH; the inherited-group context turns it into one whole-group DEACTIVATE.
    expect(t.action).toBe('DEACTIVATE')
    expect(t.provenanceAction).toBe('SWITCH')
    expect(t.reason).toBe('GROUP_MEMBER_TOGGLE_OFF')
    expect(t.next).toMatchObject({
      version: 3,
      phase: 'IDLE',
      diagnosticId: null,
      targetKey: null,
      transactionId: null,
      leaseToken: null,
    })
  })

  it('R4-14b 从 IDLE 点击继承组成员必须 ACTIVATE（无有效 owner 时没有可取消的东西）', () => {
    const t = reduceDiagnosticClick(
      emptyDiagnosticInteractionState(),
      gapClick('G2', 'doc:key::G2::0::X>>Y'),
      6,
      null,
      { inheritedGroupMember: true },
    )
    // BLANK-GAP ACTIVATION RECOVERY §3.1 — GROUP_MEMBER_TOGGLE_OFF 只在存在真实
    // ACTIVE owner 时才成立。IDLE + 历史组成员必须走正常激活（否则第一次点击
    // 就被解释为“取消”，永远画不出高亮）。
    expect(t.action).toBe('ACTIVATE')
    expect(t.provenanceAction).toBe('ACTIVATE')
    expect(t.reason).toBeUndefined()
    expect(t.next).toMatchObject({
      version: 1,
      phase: 'ACTIVE',
      diagnosticId: 'G2',
      targetKey: 'doc:key::G2::0::X>>Y',
      transactionId: 6,
    })
  })

  it('ACT-05 Drawer 仍选中但 phase=IDLE 时，继承组成员点击仍是激活而不是取消', () => {
    // `selectedDiagnosticId` / Drawer 选中只是 UI 关注，不是 ACTIVE owner。
    const prev = emptyDiagnosticInteractionState()
    const t = reduceDiagnosticClick(prev, gapClick('G2', 'doc:key::G2::0::X>>Y'), 7, null, {
      inheritedGroupMember: true,
    })
    expect(t.action).toBe('ACTIVATE')
    expect(t.next.phase).toBe('ACTIVE')
  })

  it('R4-15 an unrelated diagnostic still SWITCHes and inherits nothing', () => {
    const prev = activeGapInteractionState()
    const t = reduceDiagnosticClick(prev, gapClick('OTHER', 'doc:key::OTHER::0::A>>B'), 6, 'lease:6')
    expect(t.action).toBe('SWITCH')
    expect(t.reason).toBeUndefined()
    expect(t.next).toMatchObject({
      version: 3,
      phase: 'ACTIVE',
      diagnosticId: 'OTHER',
      transactionId: 6,
      leaseToken: 'lease:6',
    })
  })

  it('R4-28 rapid alternate clicks keep provenance === action when nothing is inherited', () => {
    let state = emptyDiagnosticInteractionState()
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      const t = reduceDiagnosticClick(state, gapClick('G1', 'doc:key::G1::0::甲>>X'), i + 1, null)
      expect(t.provenanceAction).toBe(t.action)
      expect(t.reason).toBeUndefined()
      expect(t.next.version).toBe(state.version + 1)
      seen.push(t.action)
      state = t.next
    }
    expect(seen).toEqual(['ACTIVATE', 'DEACTIVATE', 'ACTIVATE', 'DEACTIVATE', 'ACTIVATE', 'DEACTIVATE'])
  })
})

// ── WC-R4 §3.4 — staleness is a FACT comparison ─────────────────────────────

type FakeDiagnostic = DocumentDiagnosticsSnapshot['diagnostics'][number]
function fakeDiagnostic(id: string, meta: Record<string, unknown>, severity = 'warning'): FakeDiagnostic {
  return { id, severity, metadata: meta } as unknown as FakeDiagnostic
}
const blankMeta = (actual: number, published: number): Record<string, unknown> => ({
  actualBlankLines: actual,
  publishedBlankLineCount: published,
  previousBlockStartLine: 3,
  nextBlockStartLine: 3 + actual + 1,
})

describe('WC-R4 §3.4 — STALE_ACTIVE_VISUAL_COUNT is proven by FACTS', () => {
  const staleOf = (painted: FakeDiagnostic | null, live: FakeDiagnostic | null): boolean => {
    const h = makeHost() as unknown as {
      isStaleActiveVisualFact(a: FakeDiagnostic | null, b: FakeDiagnostic | null): boolean
    }
    return h.isStaleActiveVisualFact(painted, live)
  }

  it('R4-26 a FRESH equal instance of the same facts is NOT stale (the reported defect)', () => {
    // `liveDiagnosticFor()` re-reads the snapshot and therefore returns a NEW
    // object; object identity said "stale" while the DOM had one correct owner.
    expect(staleOf(fakeDiagnostic('G1', blankMeta(5, 2)), fakeDiagnostic('G1', blankMeta(5, 2)))).toBe(false)
  })

  it('R4-26b a real fact divergence IS stale', () => {
    expect(staleOf(fakeDiagnostic('G1', blankMeta(5, 2)), fakeDiagnostic('G1', blankMeta(7, 3)))).toBe(true)
    expect(staleOf(fakeDiagnostic('G1', blankMeta(5, 2)), fakeDiagnostic('G1', blankMeta(5, 3)))).toBe(true)
    expect(staleOf(fakeDiagnostic('G1', blankMeta(5, 2)), fakeDiagnostic('G2', blankMeta(5, 2)))).toBe(true)
    expect(staleOf(fakeDiagnostic('G1', blankMeta(5, 2), 'warning'), fakeDiagnostic('G1', blankMeta(5, 2), 'error'))).toBe(true)
  })

  it('R4-26c a disappeared diagnostic is NOT stale (the snapshot path tears it down)', () => {
    expect(staleOf(fakeDiagnostic('G1', blankMeta(5, 2)), null)).toBe(false)
  })
})

// ── WC-R4 §3.2/§3.3 — bounded lineage across merge / repeated split ─────────

describe('WC-R4 — merge and repeated split keep ONE bounded group', () => {
  it('R4-09 merging the active gap with an adjacent existing gap covers the merged range', () => {
    const split = `甲${blanks(3)}X${blanks(3)}乙`
    const merged = `甲${blanks(7)}乙`
    mdRef.current = split
    const h = makeHost()
    h.updateGapLineage(snapshotOf(split, 1))
    // Only the FIRST gap is active; the second one exists but is NOT selected.
    seedGroup(h, split, [gapIdsOf(split)[0]])
    mdRef.current = merged
    const next = snapshotOf(merged, 2)
    h.snapshot = next
    h.reconcileActiveGapGroup(next)
    expect(h.activeGapGroup?.members).toEqual(new Set(gapIdsOf(merged)))
    expect(h.activeGapGroup?.members.size).toBe(1)
    // The scope must have EXPANDED to the merged boundary, never shrunk.
    const anchors = h.activeGapGroup?.anchors ?? []
    expect(anchors.some(a => a.prev.endsWith('甲#0') && a.next.endsWith('乙#0'))).toBe(true)
  })

  it('R4-10 split → merge → split never duplicates members or leaves stale visuals', () => {
    const base = `甲${blanks(5)}乙`
    const split = `甲${blanks(3)}X${blanks(3)}乙`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    const steps = [split, base, split, base, split]
    steps.forEach((md, i) => {
      mdRef.current = md
      const next = snapshotOf(md, i + 2)
      h.snapshot = next
      h.reconcileActiveGapGroup(next)
      const members = h.activeGapGroup?.members ?? new Set<string>()
      expect(members.size).toBeLessThanOrEqual(2)
      // Every painted group carrier belongs to a CURRENT member — never a leftover.
      expect(h.activeGapGroupVisualEls.length).toBeLessThanOrEqual(members.size)
    })
    expect(h.activeGapGroup?.members).toEqual(new Set(gapIdsOf(split)))
  })

  it('R4-19 undo/redo across split, compliance, merge and cancellation keeps ONE truth', () => {
    const base = `甲${blanks(5)}乙`
    const split = `甲${blanks(3)}X${blanks(3)}乙`
    const compliant = `甲\nX\n乙`
    const merged = `甲${blanks(7)}乙`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base)
    const steps: Array<{ md: string; check: (members: Set<string>) => void }> = [
      { md: split, check: m => expect(m.size).toBe(2) },
      { md: base, check: m => expect(m.size).toBe(1) },
      { md: split, check: m => expect(m.size).toBe(2) },
      { md: compliant, check: m => expect(m.size).toBe(0) },
      { md: merged, check: m => expect(m.size).toBe(1) },
    ]
    steps.forEach((s, i) => {
      mdRef.current = s.md
      const next = snapshotOf(s.md, i + 2)
      h.snapshot = next
      h.reconcileActiveGapGroup(next)
      s.check(new Set(h.activeGapGroup?.members ?? []))
    })
    // A cancellation is FINAL: reconciling the same snapshot never resurrects it.
    h.clearActiveGapGroup('DEACTIVATE')
    expect(h.activeGapGroup).toBeNull()
    h.reconcileActiveGapGroup(h.snapshot!)
    expect(h.activeGapGroup).toBeNull()
  })
})
