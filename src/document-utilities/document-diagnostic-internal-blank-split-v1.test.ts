// @vitest-environment jsdom
/**
 * WC-R2 — EXCESSIVE_INTERNAL_BLANK_LINES split/merge closure.
 *
 * Repro that used to fail: a blank run is split by typed text, Typora wraps ONE
 * of the two boundary blocks in a different DOM level, `collectBetweenBoundarySiblings`
 * refuses the traversal, the visible count becomes unmeasurable and BOTH
 * diagnostics were dropped from the published snapshot.
 *
 * Fixed contract:
 *  - source gaps are built from real content blocks (one diagnostic per gap);
 *  - boundary pairs are normalized to a common sibling level before measuring;
 *  - a transient unmeasurable gap is re-decided ONCE (bounded per source revision);
 *  - split ids are distinct; merge collapses to one; one recovered side disappears alone;
 *  - stale active ids never survive a snapshot that no longer contains them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import {
  analyzeInternalBlankLineGaps,
  internalBlankGapIdentity,
} from './document-diagnostic-internal-blank-lines-v1'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

const CODE = 'EXCESSIVE_INTERNAL_BLANK_LINES'

function inputOf(markdown: string): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:key', markdown, strictMode: true, vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [], h1Facts: null,
  }
}

function snapshotOf(markdown: string, sourceRevision = 1): DocumentDiagnosticsSnapshot {
  const computed = computeDocumentDiagnostics(inputOf(markdown))
  return {
    documentKey: 'doc:key', revision: sourceRevision, sourceRevision, generatedAt: 0,
    diagnostics: computed.diagnostics,
    errorCount: computed.errorCount, warningCount: computed.warningCount, infoCount: computed.infoCount,
  }
}

function rect(top: number, height = 20, width = 600) {
  return { left: 0, top, right: width, bottom: top + height, width, height, x: 0, y: top, toJSON: () => ({}) }
}
function stubRect(el: HTMLElement, r: ReturnType<typeof rect>): void {
  Object.defineProperty(el, 'getBoundingClientRect', { configurable: true, value: () => r })
}

function fakeContext(markdown: string): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => markdown,
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

type World = { host: DocumentUtilityOverlayHost; write: HTMLElement }
let rafQueue: FrameRequestCallback[] = []

/**
 * Build a DOM that mirrors the Markdown source one-to-one: every source line is
 * one `<p data-line="i">` (blank lines are empty paragraphs). This is the shape
 * the gap analyzer expects, so identity/measurement tests stay honest.
 */
function makeWorld(markdown: string, opts: { wrapLine?: number; width?: number } = {}): World {
  const width = opts.width ?? 600
  const lines = markdown.split('\n')
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  stubRect(shell, rect(0, 800, width))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  stubRect(write, rect(0, 800, width))

  lines.forEach((text, i) => {
    const el = document.createElement('p')
    el.textContent = text
    el.setAttribute('data-line', String(i))
    stubRect(el, rect(i * 20, 20, width))
    write.appendChild(el)
  })
  if (opts.wrapLine != null) {
    const target = write.querySelector<HTMLElement>(`[data-line="${opts.wrapLine}"]`)
    if (target) {
      const wrap = document.createElement('div')
      wrap.className = 'md-end-block'
      write.insertBefore(wrap, target)
      wrap.appendChild(target)
    }
  }

  const host = new DocumentUtilityOverlayHost({ ctx: fakeContext(markdown), providers: fakeProviders() } as never)
  host.mount()
  return { host, write }
}

/** Insert the blank rows of a source line range (simulate late DOM rendering). */
function addBlankRows(write: HTMLElement, from: number, to: number, width = 600): void {
  // Insert from the END backwards so each row lands before its successor.
  for (let i = to; i >= from; i--) {
    const el = document.createElement('p')
    el.textContent = ''
    el.setAttribute('data-line', String(i))
    stubRect(el, rect(i * 20, 20, width))
    const next = write.querySelector(`[data-line="${i + 1}"]`)
    if (next) write.insertBefore(el, next)
    else write.appendChild(el)
  }
}

const gapIds = (markdown: string): string[] => analyzeInternalBlankLineGaps(markdown).map(internalBlankGapIdentity)
const blankCounts = (markdown: string): number[] => analyzeInternalBlankLineGaps(markdown).map(g => g.actualBlankLines)
const publishedTargets = (snapshot: DocumentDiagnosticsSnapshot | null): string[] =>
  (snapshot?.diagnostics ?? []).filter(d => d.code === CODE).map(d => String((d as { targetIdentity?: string }).targetIdentity ?? ''))

beforeEach(() => {
  document.body.innerHTML = ''
  rafQueue = []
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { rafQueue.push(cb); return rafQueue.length }) as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', (() => {}) as typeof cancelAnimationFrame)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} } as unknown as typeof ResizeObserver)
})

describe('WC-BLANK source layer — split / merge / boundaries', () => {
  it('splits one excessive run into two independent gaps and identities', () => {
    expect(gapIds('甲。\n\n\n乙。\n')).toHaveLength(1)
    const split = '甲。\n\n\n新。\n\n\n乙。\n'
    expect(blankCounts(split)).toEqual([2, 2])
    expect(new Set(gapIds(split)).size).toBe(2)
  })

  it('a recovered side disappears alone; merging collapses to one gap', () => {
    const oneSideOk = '甲。\n\n\n新。\n\n乙。\n'
    expect(blankCounts(oneSideOk)).toEqual([2])
    const merged = '甲。\n\n\n\n乙。\n'
    expect(blankCounts(merged)).toEqual([3])
    expect(gapIds(merged)).toEqual(['blank-gap:paragraph:甲。#0>>paragraph:乙。#0'])
  })

  it('continuous typing keeps every intermediate pair independent', () => {
    const states = [
      '甲。\n\n\n乙。\n',
      '甲。\n\n\nX。\n\n\n乙。\n',
      '甲。\n\n\nX。\n\n\nY。\n\n\n乙。\n',
    ]
    const sets = states.map(s => new Set(gapIds(s)))
    expect(sets[0].size).toBe(1)
    expect(sets[1].size).toBe(2)
    expect(sets[2].size).toBe(3)
    for (const id of sets[1]) expect(sets[0].has(id)).toBe(false)
  })

  it('backspace / delete / undo / redo walk the same identity transitions', () => {
    const before = gapIds('甲。\n\n\n乙。\n')
    const split = gapIds('甲。\n\n\nX。\n\n\n乙。\n')
    const merged = gapIds('甲。\n\n\n乙。\n')
    // Delete the middle text (= undo the split) → the SAME pre-split identity.
    expect(merged).toEqual(before)
    // Redo (= type it again) → the SAME split identities (no random ids).
    expect(split).toEqual(gapIds('甲。\n\n\nX。\n\n\n乙。\n'))
  })

  it('boundary insert at the gap edge still yields one gap per side', () => {
    const edge = '甲。\n\n\nX。\n\n\n乙。\n'
    expect(blankCounts(edge)).toEqual([2, 2])
  })

  it('same paragraph text still receives distinct ordinal identities', () => {
    const ids = gapIds('正文。\n\n\n正文。\n\n\n正文。\n')
    expect(new Set(ids).size).toBe(2)
  })
})

describe('WC-BLANK host publication — common-level measurement + bounded retry', () => {
  it('same-parent split publishes BOTH warnings', () => {
    const md = '甲。\n\n\n乙。\n\n\n丙。\n'
    const { host } = makeWorld(md)
    const decided = (host as unknown as { reconcileInternalBlankLineDiagnostics: (s: unknown) => DocumentDiagnosticsSnapshot }).reconcileInternalBlankLineDiagnostics(snapshotOf(md))
    const targets = publishedTargets(decided)
    expect(targets).toHaveLength(2)
    expect(new Set(targets).size).toBe(2)
    host.dispose()
  })

  it('a WRAPPED boundary (different DOM level) still publishes BOTH warnings', () => {
    const md = '甲。\n\n\n乙。\n\n\n丙。\n'
    const { host } = makeWorld(md, { wrapLine: 3 })
    const decided = (host as unknown as { reconcileInternalBlankLineDiagnostics: (s: unknown) => DocumentDiagnosticsSnapshot }).reconcileInternalBlankLineDiagnostics(snapshotOf(md))
    expect(publishedTargets(decided)).toHaveLength(2)
    host.dispose()
  })

  it('an unmeasurable gap is re-decided once the blank rows exist', () => {
    const md = '甲。\n\n\n乙。\n\n\n丙。\n'
    const { host, write } = makeWorld(md)
    // Simulate the split's FIRST gap still rendering: its blank rows are absent.
    write.querySelector('[data-line="1"]')?.remove()
    write.querySelector('[data-line="2"]')?.remove()

    const raw = snapshotOf(md, 37)
    rafQueue = [] // ignore mount-time geometry frames; only the retry matters here
    ;(host as unknown as { lastRawAdmittedSnapshot: DocumentDiagnosticsSnapshot | null }).lastRawAdmittedSnapshot = raw
    ;(host as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null } }).diagnostics.snapshot = raw
    ;(host as unknown as { commitAdmittedSnapshot: (s: unknown, r: string) => void }).commitAdmittedSnapshot(raw, 'TEST')

    // First commit: the 甲→乙 gap has no rendered rows yet → dropped; the other survives.
    expect(publishedTargets((host as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot)).toEqual([
      'blank-gap:paragraph:乙。#0>>paragraph:丙。#0',
    ])
    expect(rafQueue.length).toBe(1)

    // The DOM finishes rendering the split's blank rows.
    addBlankRows(write, 1, 2)
    const retry = rafQueue.shift()!
    retry(0)

    const after = publishedTargets((host as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot)
    expect(after).toHaveLength(2)
    expect(new Set(after).size).toBe(2)
    // Bounded: a measurable snapshot schedules no further retry.
    expect(rafQueue.length).toBe(0)
    host.dispose()
  })

  it('one recovered side removes only that side (no stale authority)', () => {
    const split = '甲。\n\n\nX。\n\n\n乙。\n'
    const { host, write } = makeWorld(split)
    const reconcile = (host as unknown as { reconcileInternalBlankLineDiagnostics: (s: unknown) => DocumentDiagnosticsSnapshot }).reconcileInternalBlankLineDiagnostics.bind(host)
    const first = reconcile(snapshotOf(split, 36))
    expect(publishedTargets(first)).toHaveLength(2)

    const recovered = '甲。\n\n\nX。\n\n乙。\n'
    // The recovered document has ONE blank line between X and 乙 → drop one row.
    write.querySelector('[data-line="5"]')?.remove()
    const second = reconcile(snapshotOf(recovered, 37))
    expect(publishedTargets(second)).toEqual(['blank-gap:paragraph:甲。#0>>paragraph:X。#0'])
    const authority = (host as unknown as { renderedBlankRowAuthority: Map<string, unknown> }).renderedBlankRowAuthority
    expect(authority.has('blank-gap:paragraph:X。#0>>paragraph:乙。#0')).toBe(false)
    host.dispose()
  })

  it('a stale active diagnostic id is retired when the split invalidates it', () => {
    const md = '甲。\n\n\n乙。\n\n\n丙。\n'
    const { host } = makeWorld(md)
    const internals = host as unknown as {
      lastLocatedDiagnosticId: string | null
      lastRawAdmittedSnapshot: DocumentDiagnosticsSnapshot | null
      commitAdmittedSnapshot: (s: unknown, r: string) => void
      snapshot: DocumentDiagnosticsSnapshot
    }
    // Pretend the pre-split gap was the active one.
    internals.lastLocatedDiagnosticId = 'document:EXCESSIVE_INTERNAL_BLANK_LINES:blank-gap:paragraph:旧#0>>paragraph:旧二号#0'
    const raw = snapshotOf(md, 36)
    internals.lastRawAdmittedSnapshot = raw
    internals.commitAdmittedSnapshot(raw, 'TEST')
    expect(internals.lastLocatedDiagnosticId).toBeNull()
    host.dispose()
  })

  it('sidebar width / narrow layout never changes the gap decision', () => {
    const md = '甲。\n\n\n乙。\n\n\n丙。\n'
    const wide = makeWorld(md, { width: 1400 })
    const wideTargets = publishedTargets(
      (wide.host as unknown as { reconcileInternalBlankLineDiagnostics: (s: unknown) => DocumentDiagnosticsSnapshot })
        .reconcileInternalBlankLineDiagnostics(snapshotOf(md)),
    )
    wide.host.dispose()
    document.body.innerHTML = ''
    const narrow = makeWorld(md, { width: 420 })
    const narrowTargets = publishedTargets(
      (narrow.host as unknown as { reconcileInternalBlankLineDiagnostics: (s: unknown) => DocumentDiagnosticsSnapshot })
        .reconcileInternalBlankLineDiagnostics(snapshotOf(md)),
    )
    narrow.host.dispose()
    expect(narrowTargets).toEqual(wideTargets)
    expect(narrowTargets).toHaveLength(2)
  })
})
