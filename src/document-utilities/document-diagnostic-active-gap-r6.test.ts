// @vitest-environment jsdom
/**
 * R6 — Blank-Gap Active Group: lineage robustness, one visual owner, and the
 * bounded repaint contract.
 *
 * These tests drive the REAL lineage + group projection (same harness shape as
 * R2/R5) and assert FACTS: the proven member set, the group lifecycle, the exact
 * boundary pairs, the carrier surface contract, and the parked-paint state —
 * never "a method ran".
 *
 * Divergences this suite locks down (each one was reproduced before the fix):
 *
 *  R6-01  SPLIT was inferred by "is there a block id the old revision lacked?".
 *         Block identities are `kind:text#ordinal`, so an inserted paragraph
 *         whose text already exists elsewhere can REUSE an ordinal the previous
 *         revision already had → a real split looked like "nothing inserted" and
 *         both descendants were dropped (group degraded to DORMANT, 0 markers).
 *         Fixed structurally: a maximal-run anchor is CUT as soon as ANY block
 *         sits between its two ends, and nested residual splits are contained.
 *  R6-03  The group projection wrote into `#write`'s locate layer without the
 *         EN-11 content-document write hold → a second `SPLIT_1_TO_2` per Enter.
 *  R6-04  A member whose DOM bind/measurement failed right after a split was
 *         skipped with no retry → the "two descendants" case settled with ONE
 *         marker. Now ONE bounded rAF re-decision (max 2 passes).
 *  R6-06  The group carrier lacked the amber range class, so every inherited
 *         descendant was DOM-present but INVISIBLE.
 *  R6-07  A real editor-geometry change re-derived only the primary/EOF bands.
 *  R6-08  Retiring the primary carrier while activation stays left the ORIGIN
 *         member with no marker — and re-projecting in the generic clear path
 *         would break the one-owner rule (guarded).
 *  R6-09  A snapshot/live-buffer skew dropped every published member (DORMANT).
 *  R6-10  Activation re-scanned the live buffer for its anchor instead of using
 *         the snapshot record the user actually clicked.
 *  R6-11  A nine-step mixed sequence keeps every invariant after every step.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import { analyzeInternalBlankLineGaps, internalBlankGapIdentity } from './document-diagnostic-internal-blank-lines-v1'
import { armEnterEchoWriteTrace } from './enter-echo-write-trace'
import { shouldRequestGroupRepaint } from './document-diagnostic-active-state-machine-v2'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

let mdRef = { current: '' }
let docKeyRef = { current: 'doc:r6' }

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
      getActiveFilePath: () => '/vault/r6.md',
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
  updateGapLineage(snapshot: unknown): void
  reconcileActiveGapGroup(snapshot: unknown): void
  onDiagnosticActivatedForGapGroup(id: string | null): void
  activeGapGroupVisualEls: HTMLElement[]
  snapshot: DocumentDiagnosticsSnapshot | null
  lastGapLineage: { documentKey: string | null; sourceRevision: number; blockOrder: string[] }
}

/** N blank source lines. */
const blanks = (n: number): string => '\n'.repeat(n + 1)
const gapIdsOf = (markdown: string): string[] =>
  analyzeInternalBlankLineGaps(markdown).map(internalBlankGapIdentity)

let host: DocumentUtilityOverlayHost

function makeHost(): Internals {
  host = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() } as never)
  return host as unknown as Internals
}

function seedGroup(h: Internals, markdown: string, ids: Iterable<string>): Set<string> {
  const want = new Set(ids)
  const anchors: Array<{ prev: string; next: string }> = []
  for (const gap of analyzeInternalBlankLineGaps(markdown)) {
    if (!want.has(internalBlankGapIdentity(gap))) continue
    anchors.push({ prev: gap.previousBlockIdentity, next: gap.nextBlockIdentity })
  }
  const members = new Set(anchors.map(a => `blank-gap:${a.prev}>>${a.next}`))
  h.activeGapGroup = {
    groupId: 1,
    lifecycle: 'ACTIVE',
    originDiagnosticId: 'origin',
    members,
    anchors,
    scopePrev: anchors.length > 0 ? anchors[0].prev : null,
    scopeNext: anchors.length > 0 ? anchors[anchors.length - 1].next : null,
    documentKey: docKeyRef.current,
    sourceRevision: 1,
  }
  return members
}

/** Apply ONE edit transaction: seed lineage on `from`, then reconcile `to`. */
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
  docKeyRef = { current: 'doc:r6' }
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} } as unknown as typeof ResizeObserver)
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', (() => {}) as typeof cancelAnimationFrame)
})

afterEach(() => {
  // never leak an armed content-document write hold into another test
  armEnterEchoWriteTrace(null, 0, 0)
})

// ── R6-01 — split whose inserted block REUSES an existing identity ──────────

describe('R6-01 split inheritance is structural, not block-identity-diff based', () => {
  it('R6-01a split inherits BOTH descendants when the typed text equals a later block', () => {
    // The trailing `X` occupies `paragraph:X#0` in the PREVIOUS revision. Typing
    // `X` inside the gap therefore re-uses `paragraph:X#0` as the NEW middle
    // block, so a naive "is there a block id the old revision lacked?" test says
    // NO structural cut happened.
    const from = `甲。${blanks(5)}乙。${blanks(5)}X`
    const to = `甲。${blanks(2)}X${blanks(2)}乙。${blanks(5)}X`
    mdRef.current = from
    const h = makeHost()
    h.updateGapLineage(snapshotOf(from, 1))
    seedGroup(h, from, [gapIdsOf(from)[0]])
    expect([...gapIdsOf(to)]).toEqual([
      'blank-gap:paragraph:甲。#0>>paragraph:X#0',
      'blank-gap:paragraph:X#0>>paragraph:乙。#0',
      'blank-gap:paragraph:乙。#0>>paragraph:X#1',
    ])
    const members = step(h, from, to, 2)
    expect([...members].sort()).toEqual([
      'blank-gap:paragraph:X#0>>paragraph:乙。#0',
      'blank-gap:paragraph:甲。#0>>paragraph:X#0',
    ])
    expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
  })

  it('R6-01b split inherits BOTH descendants when the typed text equals an EARLIER block', () => {
    const from = `X${blanks(5)}甲。${blanks(5)}乙。`
    const to = `X${blanks(5)}甲。${blanks(2)}X${blanks(2)}乙。`
    mdRef.current = from
    const h = makeHost()
    h.updateGapLineage(snapshotOf(from, 1))
    // the (甲,乙) gap is the SECOND one
    seedGroup(h, from, [gapIdsOf(from)[1]])
    // the inserted `X` becomes `paragraph:X#1`
    expect([...gapIdsOf(to)]).toEqual([
      'blank-gap:paragraph:X#0>>paragraph:甲。#0',
      'blank-gap:paragraph:甲。#0>>paragraph:X#1',
      'blank-gap:paragraph:X#1>>paragraph:乙。#0',
    ])
    const members = step(h, from, to, 2)
    expect([...members].sort()).toEqual([
      'blank-gap:paragraph:X#1>>paragraph:乙。#0',
      'blank-gap:paragraph:甲。#0>>paragraph:X#1',
    ])
    expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
  })
})

// ── R6-02 — a SECOND-generation split keeps every proven descendant ─────────

describe('R6-02 nested split keeps all proven descendants', () => {
  it('R6-02a splitting the LEFT descendant keeps the middle and the right member', () => {
    const v1 = `甲。${blanks(5)}乙。`
    const v2 = `甲。${blanks(3)}X${blanks(3)}乙。`
    mdRef.current = v1
    const h = makeHost()
    h.updateGapLineage(snapshotOf(v1, 1))
    seedGroup(h, v1, gapIdsOf(v1))
    expect([...step(h, v1, v2, 2)].sort()).toEqual([
      'blank-gap:paragraph:X#0>>paragraph:乙。#0',
      'blank-gap:paragraph:甲。#0>>paragraph:X#0',
    ])
    // Split ONLY the left side again: 甲 .. P .. X .. 乙
    const v3 = `甲。${blanks(3)}P${blanks(3)}X${blanks(3)}乙。`
    const members = step(h, v2, v3, 3)
    expect([...members].sort()).toEqual([
      'blank-gap:paragraph:P#0>>paragraph:X#0',
      'blank-gap:paragraph:X#0>>paragraph:乙。#0',
      'blank-gap:paragraph:甲。#0>>paragraph:P#0',
    ])
    expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
  })
})

// ── R6-03 — the group projection obeys the content-document write hold ─────

describe('R6-03 the group projection never writes #write during an Enter echo window', () => {
  it('R6-03a reconcile parks the projection while the hold is armed, then commits it', () => {
    // The coordinator must not burn frames here: park the intent only.
    vi.stubGlobal('requestAnimationFrame', ((_cb: FrameRequestCallback) => 1) as typeof requestAnimationFrame)
    const from = `甲。${blanks(5)}乙。`
    mdRef.current = from
    const h = makeHost()
    h.updateGapLineage(snapshotOf(from, 1))
    seedGroup(h, from, gapIdsOf(from))
    armEnterEchoWriteTrace('R6-03', 250)
    const to = `甲。${blanks(3)}X${blanks(3)}乙。`
    mdRef.current = to
    h.snapshot = snapshotOf(to, 2)
    h.reconcileActiveGapGroup(h.snapshot)
    // the lineage decision itself already happened …
    expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
    expect(h.activeGapGroup?.members.size).toBe(2)
    // … but NOTHING was written inside `#write`, so no group container exists
    expect(document.querySelectorAll('.inkchapter-block-gap-group-visual').length).toBe(0)
    expect(h.activeGapGroupVisualEls.length).toBe(0)
    // the projection is parked as ONE latest-wins intent
    expect(host.getPresentationPaintPendingCount()).toBeGreaterThan(0)
    host.flushPresentationPaintNow()
    expect(host.getPresentationPaintPendingCount()).toBe(0)
  })

  it('R6-03b every reconcile-driven group projection goes through the coordinator', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    const countOf = (needle: string): number => src.split(needle).length - 1
    // A bare `this.paintActiveGapGroupVisuals()` would be an unguarded `#write`
    // write site; count parity proves every call sits on a coordinator request.
    expect(countOf('this.paintActiveGapGroupVisuals()')).toBeGreaterThanOrEqual(1)
    expect(countOf('this.paintActiveGapGroupVisuals()')).toBe(
      countOf("runContentDocumentPaint('ACTIVE_GAP_GROUP'"),
    )
  })
})

// ── R6-04 — a member that failed to paint earns exactly ONE bounded repaint ──

describe('R6-04 published-but-unpainted members trigger a bounded repaint only', () => {
  it('R6-04a two published members, one painted, no primary owner → repaint', () => {
    expect(shouldRequestGroupRepaint({
      publishedMemberCount: 2, paintedMemberCount: 1, primaryCarrierMemberCount: 0,
    })).toBe(true)
  })

  it('R6-04b the primary carrier already owns the missing member → no repaint', () => {
    expect(shouldRequestGroupRepaint({
      publishedMemberCount: 2, paintedMemberCount: 1, primaryCarrierMemberCount: 1,
    })).toBe(false)
  })

  it('R6-04c an empty projection never asks for a repaint', () => {
    expect(shouldRequestGroupRepaint({
      publishedMemberCount: 0, paintedMemberCount: 0, primaryCarrierMemberCount: 0,
    })).toBe(false)
  })

  it('R6-04d a complete projection never asks for a repaint', () => {
    expect(shouldRequestGroupRepaint({
      publishedMemberCount: 2, paintedMemberCount: 2, primaryCarrierMemberCount: 0,
    })).toBe(false)
  })

  it('R6-04e production wires the repaint into the group projection, bounded by rAF', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(src).toContain('shouldRequestGroupRepaint({')
    expect(src).toContain('if (repaintNeeded) this.requestInternalBlankReDecision(snapshot.sourceRevision ?? -1)')
    // the retry budget is the EXISTING bounded re-decision (max 2 rAF passes),
    // never a timer loop or a permanent retry
    expect(src).toContain('this.internalBlankReDecisionAttempts >= 2')
  })
})

// ── R6-06 — the group carrier owns the SAME surface as the primary carrier ──

describe('R6-06 both bloc-gap carriers share ONE surface contract', () => {
  it('R6-06a every gap carrier that paints blank rows carries the amber range class', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    // `.inkchapter-block-gap-fragments` is where the amber RANGE BACKGROUND lives;
    // a carrier without it is invisible even though it exists in the DOM.
    expect(src).toContain(
      'container.className = `${BLOCK_GAP_VISUAL_CLASS} ${RENDERED_BLANK_ROW_FRAGMENT_CONTAINER_CLASS}`')
    expect(src).toContain(
      'container.className = `${BLOCK_GAP_VISUAL_CLASS} ${RENDERED_BLANK_ROW_FRAGMENT_CONTAINER_CLASS} inkchapter-block-gap-group-visual`')
    // and no gap carrier may be created with ONLY the pointer-events class
    expect(src).not.toContain('container.className = `${BLOCK_GAP_VISUAL_CLASS}`')
  })

  it('R6-06b the group carrier is still identifiable as the group projection', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(src).toContain('data-block-gap-visual\', \'active-gap-group\')')
    expect(src).toContain('inkchapter-block-gap-group-visual')
  })
})

// ── R6-07 — geometry changes re-derive the group like the primary band ──────

describe('R6-07 a real editor-geometry change re-derives the group projection', () => {
  it('R6-07a the layout-invalidation pass repaints an ACTIVE group by LIVE geometry', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    const layoutPass = src.indexOf("this.remeasureActiveVisualOnLayoutChange('EDITOR_GEOMETRY_CHANGED')")
    expect(layoutPass).toBeGreaterThan(-1)
    const groupRepaint = src.indexOf(
      "if (this.activeGapGroup != null && this.activeGapGroup.lifecycle === 'ACTIVE')", layoutPass)
    expect(groupRepaint).toBeGreaterThan(layoutPass)
    // the repaint must reuse the ONE coordinator (no direct #write write)
    expect(src.slice(groupRepaint, groupRepaint + 260)).toContain(
      "runContentDocumentPaint('ACTIVE_GAP_GROUP', () => this.paintActiveGapGroupVisuals())")
    // and it must land BEFORE the EOF re-derive, i.e. inside the same pass
    const eofRedefine = src.indexOf('this.rederiveSyntheticEofVisualOnLayoutChange()', layoutPass)
    expect(eofRedefine).toBeGreaterThan(groupRepaint)
  })

  it('R6-07b a DORMANT group renders nothing on a geometry change', () => {
    // the guard is `lifecycle === 'ACTIVE'`, so a dormant intent never paints
    const src = readFileSync(
      resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    const idx = src.indexOf("if (this.activeGapGroup != null && this.activeGapGroup.lifecycle === 'ACTIVE')")
    expect(idx).toBeGreaterThan(-1)
    expect(src.slice(idx, idx + 120)).not.toContain('DORMANT')
  })
})

// ── R6-08 — the group must never be left half-painted ───────────────────────

describe('R6-08 retiring the primary carrier re-derives the group, atomically', () => {
  it('R6-08a the group is re-projected where the carrier goes but the activation stays', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    const helperStart = src.indexOf('private reprojectActiveGapGroupAfterCarrierRetirement(')
    expect(helperStart).toBeGreaterThan(-1)
    const helperEnd = src.indexOf('\n  private ', helperStart + 10)
    const helper = src.slice(helperStart, helperEnd)
    expect(helper).toContain("runContentDocumentPaint('ACTIVE_GAP_GROUP'")
    // guarded: the primary carrier is really gone AND the group is still ACTIVE
    expect(helper).toContain('this.lastBlockGapDiagnosticId != null')
    expect(helper).toContain("this.activeGapGroup.lifecycle !== 'ACTIVE'")
    // the two explicit "activation stays, carrier goes" entry points
    const dismiss = src.indexOf("clearDiagnosticLocateVisual('DOCUMENT_LEFT_POINTER_DISMISS')")
    expect(dismiss).toBeGreaterThan(-1)
    expect(src.slice(dismiss, dismiss + 400)).toContain('reprojectActiveGapGroupAfterCarrierRetirement()')
    const drawer = src.indexOf("clearDiagnosticLocateVisual('DRAWER_CLOSE')")
    expect(drawer).toBeGreaterThan(-1)
    expect(src.slice(drawer, drawer + 500)).toContain('reprojectActiveGapGroupAfterCarrierRetirement()')
  })

  it('R6-08b clearDiagnosticLocateVisual itself NEVER re-projects', () => {
    // SWITCH/ACTIVATE retires the old carrier and then installs a NEW primary
    // carrier for the new target. Re-projecting inside the generic clear would
    // paint that target twice (group + primary) and break the one-owner rule.
    const src = readFileSync(
      resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    const start = src.indexOf('private clearDiagnosticLocateVisual(')
    expect(start).toBeGreaterThan(-1)
    const bodyEnd = src.indexOf('\n  }\n', start) + 4
    const body = src.slice(start, bodyEnd)
    expect(body).not.toContain('paintActiveGapGroupVisuals')
    expect(body).not.toContain('reprojectActiveGapGroupAfterCarrierRetirement')
  })

  it('R6-08c removeBlockGapVisual NEVER re-projects (commitBlockGapVisual would double-own)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    const start = src.indexOf('private removeBlockGapVisual(')
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('\n  private ', start + 10)
    expect(src.slice(start, end)).not.toContain('paintActiveGapGroupVisuals')
  })
})

// ── R6-09 — a lagging live buffer must not erase the activation ─────────────

describe('R6-09 a published gap stays proven when the live buffer moved on', () => {
  it('R6-09a snapshot/live skew keeps the group ACTIVE instead of DORMANT', () => {
    const from = `甲。${blanks(5)}乙。`
    // The user already renamed the block AFTER the gap, so `paragraph:乙。#0` no
    // longer exists in the live block order — but the committed snapshot (the one
    // the user is looking at) still published that gap.
    const live = `甲。${blanks(5)}乙x`
    mdRef.current = from
    const h = makeHost()
    h.updateGapLineage(snapshotOf(from, 1))
    seedGroup(h, from, gapIdsOf(from))
    mdRef.current = live
    const stale = snapshotOf(from, 1)
    h.snapshot = stale
    h.reconcileActiveGapGroup(stale)
    expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
    expect([...h.activeGapGroup!.members]).toEqual(['blank-gap:paragraph:甲。#0>>paragraph:乙。#0'])
  })

  it('R6-09b the same skew never invents an unknown-position membership', () => {
    const from = `甲。${blanks(5)}乙。`
    mdRef.current = from
    const h = makeHost()
    h.updateGapLineage(snapshotOf(from, 1))
    seedGroup(h, from, gapIdsOf(from))
    // an unrelated document revision with a DIFFERENT gap in the live buffer
    mdRef.current = `子。${blanks(5)}丑。`
    const stale = snapshotOf(from, 1)
    h.snapshot = stale
    h.reconcileActiveGapGroup(stale)
    // no position was guessed: the unrelated live gap is NOT adopted
    const members = [...(h.activeGapGroup?.members ?? [])]
    for (const m of members) {
      expect(m).not.toContain('paragraph:子')
      expect(m).not.toContain('paragraph:丑')
    }
  })
})

// ── R6-10 — activation derives its anchor from the SNAPSHOT ─────────────────

describe('R6-10 activation anchor comes from the snapshot the user clicked', () => {
  it('R6-10a activation works even when the live buffer is unrelated', () => {
    const from = `甲。${blanks(5)}乙。`
    const snap = snapshotOf(from, 1)
    const h = makeHost()
    h.snapshot = snap
    // Typora serialisation is behind: the live buffer does not contain the gap
    mdRef.current = `子。${blanks(5)}丑。`
    const diag = snap.diagnostics.find(d => d.code === 'EXCESSIVE_INTERNAL_BLANK_LINES')!
    expect(diag).toBeTruthy()
    h.onDiagnosticActivatedForGapGroup(diag.id)
    expect(h.activeGapGroup?.anchors).toEqual([
      { prev: 'paragraph:甲。#0', next: 'paragraph:乙。#0' },
    ])
    expect([...h.activeGapGroup!.members]).toEqual(['blank-gap:paragraph:甲。#0>>paragraph:乙。#0'])
    expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
  })

  it('R6-10b a null snapshot retires the lineage index', () => {
    const from = `甲。${blanks(5)}乙。`
    mdRef.current = from
    const h = makeHost()
    h.updateGapLineage(snapshotOf(from, 1))
    expect(h.lastGapLineage.blockOrder.length).toBe(2)
    h.reconcileActiveGapGroup(null)
    expect(h.lastGapLineage.blockOrder).toEqual([])
    expect(h.lastGapLineage.documentKey).toBeNull()
  })
})

// ── R6-11 — a long mixed sequence keeps the invariants after EVERY step ─────

describe('R6-11 mixed sequence keeps the group invariants after every step', () => {
  it('R6-11 activate → split → one side compliant → resume → merge → dormant → resume → switch', () => {
    const v1 = `甲。${blanks(5)}乙。`
    const v2 = `甲。${blanks(3)}X${blanks(3)}乙。`
    const leftCompliant = `甲。${blanks(1)}X${blanks(3)}乙。`
    const rightCompliant = `甲。${blanks(3)}X${blanks(1)}乙。`
    const bothCompliant = `甲。${blanks(1)}X${blanks(1)}乙。`
    const L = 'blank-gap:paragraph:甲。#0>>paragraph:X#0'
    const R = 'blank-gap:paragraph:X#0>>paragraph:乙。#0'
    const M = 'blank-gap:paragraph:甲。#0>>paragraph:乙。#0'

    mdRef.current = v1
    const h = makeHost()
    h.updateGapLineage(snapshotOf(v1, 1))
    seedGroup(h, v1, gapIdsOf(v1))

    const check = (expected: string[], lifecycle: 'ACTIVE' | 'DORMANT'): void => {
      const g = h.activeGapGroup
      expect(g).not.toBeNull()
      expect(g!.lifecycle).toBe(lifecycle)
      expect([...g!.members].sort()).toEqual([...expected].sort())
      // hard invariants after EVERY step
      expect(g!.anchors.length).toBeLessThanOrEqual(12)
      expect(g!.documentKey).toBe(docKeyRef.current)
      for (const m of g!.members) expect(m.startsWith('blank-gap:')).toBe(true)
    }

    let revision = 2
    check([M], 'ACTIVE')
    // 1) split into two invalid descendants
    expect([...step(h, v1, v2, revision++)].sort()).toEqual([L, R].sort())
    check([L, R], 'ACTIVE')
    // 2) left becomes compliant → only the right stays highlighted
    expect([...step(h, v2, leftCompliant, revision++)]).toEqual([R])
    check([R], 'ACTIVE')
    // 3) left re-invalidated → inherited WITHOUT a new click
    expect([...step(h, leftCompliant, v2, revision++)].sort()).toEqual([L, R].sort())
    check([L, R], 'ACTIVE')
    // 4) right becomes compliant → only the left stays
    expect([...step(h, v2, rightCompliant, revision++)]).toEqual([L])
    check([L], 'ACTIVE')
    // 5) right re-invalidated
    expect([...step(h, rightCompliant, v2, revision++)].sort()).toEqual([L, R].sort())
    check([L, R], 'ACTIVE')
    // 6) delete the inserted block → ONE merged member
    expect([...step(h, v2, v1, revision++)]).toEqual([M])
    check([M], 'ACTIVE')
    // 7) both compliant → DORMANT with zero published members
    expect([...step(h, v1, bothCompliant, revision++)]).toEqual([])
    check([], 'DORMANT')
    // 8) resume without a click
    expect([...step(h, bothCompliant, v1, revision++)]).toEqual([M])
    check([M], 'ACTIVE')
    // 9) document switch retires the group
    docKeyRef.current = 'doc:r6-other'
    mdRef.current = v1
    h.reconcileActiveGapGroup(snapshotOf(v1, revision++))
    expect(h.activeGapGroup).toBeNull()
  })
})

// ── R6-05 — merge / unrelated gaps / repeated split-merge ───────────────────

describe('R6-05 merge and unrelated gaps stay correct with the structural cut rule', () => {
  it('R6-05a deleting the inserted text merges back into ONE inherited member', () => {
    const v1 = `甲。${blanks(5)}乙。`
    const v2 = `甲。${blanks(3)}X${blanks(3)}乙。`
    mdRef.current = v1
    const h = makeHost()
    h.updateGapLineage(snapshotOf(v1, 1))
    seedGroup(h, v1, gapIdsOf(v1))
    expect(step(h, v1, v2, 2).size).toBe(2)
    const members = step(h, v2, v1, 3)
    expect([...members]).toEqual(['blank-gap:paragraph:甲。#0>>paragraph:乙。#0'])
    expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
  })

  it('R6-05b an UNRELATED gap outside the anchor range is never inherited', () => {
    const v1 = `甲。${blanks(5)}乙。`
    const v2 = `甲。${blanks(5)}乙。${blanks(5)}丙。`
    mdRef.current = v1
    const h = makeHost()
    h.updateGapLineage(snapshotOf(v1, 1))
    seedGroup(h, v1, gapIdsOf(v1))
    const members = step(h, v1, v2, 2)
    expect([...members]).toEqual(['blank-gap:paragraph:甲。#0>>paragraph:乙。#0'])
    expect([...members]).not.toContain('blank-gap:paragraph:乙。#0>>paragraph:丙。#0')
  })

  it('R6-05c neither anchor block survives → nothing is inherited', () => {
    const v1 = `甲。${blanks(5)}乙。`
    const v2 = `子。${blanks(5)}丑。`
    mdRef.current = v1
    const h = makeHost()
    h.updateGapLineage(snapshotOf(v1, 1))
    seedGroup(h, v1, gapIdsOf(v1))
    // both boundary blocks are gone: no proven lineage, fail closed
    const members = step(h, v1, v2, 2)
    expect([...members]).toEqual([])
  })

  it('R6-05c2 renaming ONE boundary block keeps the SAME gap inherited', () => {
    // The highest-frequency real edit: type a character in the block AFTER the
    // gap. Its identity becomes `paragraph:乙x#0`, so the anchor's exact pair is
    // gone — the surviving LEFT boundary must still prove the descendant.
    const v1 = `甲。${blanks(5)}乙。`
    const v2 = `甲。${blanks(5)}乙x`
    mdRef.current = v1
    const h = makeHost()
    h.updateGapLineage(snapshotOf(v1, 1))
    seedGroup(h, v1, gapIdsOf(v1))
    const members = step(h, v1, v2, 2)
    expect([...members]).toEqual(['blank-gap:paragraph:甲。#0>>paragraph:乙x#0'])
    expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
  })

  it('R6-05d repeated split/merge keeps the member set exact (5 rounds)', () => {
    const base = `甲。${blanks(5)}乙。`
    const split = `甲。${blanks(3)}X${blanks(3)}乙。`
    mdRef.current = base
    const h = makeHost()
    h.updateGapLineage(snapshotOf(base, 1))
    seedGroup(h, base, gapIdsOf(base))
    let revision = 2
    for (let round = 0; round < 5; round++) {
      const afterSplit = step(h, base, split, revision++)
      expect(afterSplit.size).toBe(2)
      expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
      const afterMerge = step(h, split, base, revision++)
      expect([...afterMerge]).toEqual(['blank-gap:paragraph:甲。#0>>paragraph:乙。#0'])
      expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
    }
    // bounded anchor history (never unbounded growth)
    expect(h.activeGapGroup!.anchors.length).toBeLessThanOrEqual(12)
    expect(h.activeGapGroup!.members.size).toBe(1)
  })

  it('R6-05e both descendants compliant → DORMANT with zero members, then resume', () => {
    const v1 = `甲。${blanks(5)}乙。`
    const v2 = `甲。${blanks(3)}X${blanks(3)}乙。`
    const v3 = `甲。${blanks(1)}X${blanks(1)}乙。`
    mdRef.current = v1
    const h = makeHost()
    h.updateGapLineage(snapshotOf(v1, 1))
    seedGroup(h, v1, gapIdsOf(v1))
    expect(step(h, v1, v2, 2).size).toBe(2)
    expect(step(h, v2, v3, 3).size).toBe(0)
    expect(h.activeGapGroup?.lifecycle).toBe('DORMANT')
    // resume WITHOUT a click: the proven anchors still describe this gap
    const resumed = step(h, v3, v2, 4)
    expect([...resumed].sort()).toEqual([
      'blank-gap:paragraph:X#0>>paragraph:乙。#0',
      'blank-gap:paragraph:甲。#0>>paragraph:X#0',
    ])
    expect(h.activeGapGroup?.lifecycle).toBe('ACTIVE')
  })
})
