// @vitest-environment jsdom
/**
 * Capability Matrix V1 — Phase G (§8 / §15 / §20): Caption Integrity.
 *
 * The producer is DOM-side and resolves ownership ONLY through the caption
 * service's canonical owner map (`getCanonicalCaptionOwnerRoot`). These tests
 * build REAL caption projections through the canonical writer
 * (`CaptionDomAdapter.renderCaption`) so the owner map + stamped attributes are
 * exactly what production produces — never a hand-rolled fake.
 *
 * Cases (spec §15): C1 normal / C2 orphan / C3 multiple / C4 bad format
 * (+ table + code variants + C7 duplicate-destination figure isolation) and the
 * §20 hard gates that are assertable in this environment.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  CODE_CAPTION_FORMAT_INVALID_CODE,
  CODE_MULTIPLE_CAPTIONS_CODE,
  CODE_ORPHAN_CAPTION_CODE,
  FIGURE_CAPTION_FORMAT_INVALID_CODE,
  FIGURE_MULTIPLE_CAPTIONS_CODE,
  FIGURE_ORPHAN_CAPTION_CODE,
  TABLE_CAPTION_FORMAT_INVALID_CODE,
  TABLE_MULTIPLE_CAPTIONS_CODE,
  TABLE_ORPHAN_CAPTION_CODE,
  computeCaptionIntegrityDiagnostics,
  isCanonicalCaptionLabel,
} from './document-diagnostics-caption-integrity-v1'
import { CaptionDomAdapter, type CaptionTarget } from '../heading-numbering/caption-dom-adapter'
import { getRuleMeta, hasLocatableLocation } from './document-diagnostic-location'
import type { DocumentDiagnostic } from './diagnostics-types'

const containers: HTMLElement[] = []
afterEach(() => {
  for (const c of containers) c.remove()
  containers.length = 0
})

interface Harness {
  root: HTMLElement
  adapter: CaptionDomAdapter
}

/** A fresh business root + caption writer (the ONLY caption owner authority). */
function harness(): Harness {
  const root = document.createElement('div')
  document.body.appendChild(root)
  containers.push(root)
  return { root, adapter: new CaptionDomAdapter(() => root) }
}

/** Append a canonical business object and return its owner root. */
function addObject(root: HTMLElement, type: 'figure' | 'table' | 'code'): HTMLElement {
  let owner: HTMLElement
  if (type === 'figure') {
    owner = document.createElement('p')
    const img = document.createElement('img')
    img.setAttribute('src', 'a.png')
    owner.appendChild(img)
  } else if (type === 'table') {
    owner = document.createElement('table')
    const row = document.createElement('tr')
    owner.appendChild(row)
  } else {
    owner = document.createElement('pre')
    owner.classList.add('md-fences')
  }
  root.appendChild(owner)
  return owner
}

let seq = 0
/** Render ONE canonical caption bound to `owner` via the caption writer. */
function writerCaption(h: Harness, owner: HTMLElement, type: 'figure' | 'table' | 'code', label: string, title: string): HTMLElement {
  const target: CaptionTarget = { type, ordinal: 0, root: owner }
  return h.adapter.renderCaption(target, label, title, `cap-${++seq}`, 'below')
}

const run = (h: Harness): DocumentDiagnostic[] =>
  computeCaptionIntegrityDiagnostics({ documentKey: 'doc:caption-g', root: h.root }).diagnostics

const codes = (diags: readonly DocumentDiagnostic[]): string[] => diags.map(d => d.code)

// ── C1 normal ───────────────────────────────────────────────────────────────

describe('Phase G §15 — C1 normal (figure / table / code)', () => {
  it('one canonical caption per object → orphan=0 multiple=0 format=0', () => {
    for (const type of ['figure', 'table', 'code'] as const) {
      const h = harness()
      const owner = addObject(h.root, type)
      const prefix = type === 'figure' ? '图' : type === 'table' ? '表' : '代码'
      writerCaption(h, owner, type, `${prefix} 1 名称`, '名称')
      expect(codes(run(h)), type).toEqual([])
    }
  })

  it('a user-customised prefix is NOT a format false positive', () => {
    const h = harness()
    const owner = addObject(h.root, 'figure')
    writerCaption(h, owner, 'figure', 'Figure 1 名称', '名称')
    expect(codes(run(h))).toEqual([])
    expect(isCanonicalCaptionLabel('Figure 1 名称', '名称')).toBe(true)
  })

  it('every emitted caption location is locatable by the caption service id', () => {
    const h = harness()
    const owner = addObject(h.root, 'figure')
    writerCaption(h, owner, 'figure', '图1', '') // bad format → one diagnostic
    const diags = run(h)
    expect(diags).toHaveLength(1)
    expect(diags[0].location?.kind).toBe('caption-projection')
    expect(hasLocatableLocation(diags[0].location)).toBe(true)
  })
})

// ── C2 orphan ───────────────────────────────────────────────────────────────

describe('Phase G §15 — C2 orphan (unbound caption projection)', () => {
  it('one orphan → ONE diagnostic (figure)', () => {
    const h = harness()
    const owner = addObject(h.root, 'figure')
    writerCaption(h, owner, 'figure', '图 1', '名称')
    owner.remove() // owner gone → projection is unbound (not adjacency-adopted)
    const diags = run(h)
    expect(codes(diags)).toEqual([FIGURE_ORPHAN_CAPTION_CODE])
    expect(diags).toHaveLength(1)
    expect(diags[0].location?.kind).toBe('caption-projection')
  })

  it('table + code orphans each emit their own code', () => {
    const h = harness()
    const t = addObject(h.root, 'table')
    const c = addObject(h.root, 'code')
    writerCaption(h, t, 'table', '表 1', '')
    writerCaption(h, c, 'code', '代码 1', '')
    t.remove()
    c.remove()
    expect(codes(run(h)).sort()).toEqual([CODE_ORPHAN_CAPTION_CODE, TABLE_ORPHAN_CAPTION_CODE].sort())
  })

  it('§20 CAPTION_INTEGRITY_DOM_NEAREST_OWNER_GUESS_COUNT=0: a stray caption next to another object is ORPHAN, never adopted', () => {
    const h = harness()
    // A valid object the stray caption sits RIGHT NEXT TO in the DOM.
    const neighbour = addObject(h.root, 'figure')
    // An unbound caption whose (disconnected) owner is unrelated.
    const orphanOwner = addObject(h.root, 'figure')
    writerCaption(h, orphanOwner, 'figure', '图 9', '')
    orphanOwner.remove()
    const diags = run(h)
    const orphans = diags.filter(d => d.code === FIGURE_ORPHAN_CAPTION_CODE)
    expect(orphans).toHaveLength(1)
    // The neighbour is untouched (still has no caption of its own).
    expect(neighbour.querySelector('img')).not.toBeNull()
  })
})

// ── C3 multiple ─────────────────────────────────────────────────────────────

describe('Phase G §15 — C3 multiple (one owner, >1 caption)', () => {
  it('one owner + 2 captions → EXACTLY ONE diagnostic, presented as a target-group', () => {
    const h = harness()
    const owner = addObject(h.root, 'figure')
    writerCaption(h, owner, 'figure', '图 1', '')
    writerCaption(h, owner, 'figure', '图 2', '')
    const diags = run(h)
    expect(diags.filter(d => d.code === FIGURE_MULTIPLE_CAPTIONS_CODE)).toHaveLength(1)
    const multi = diags.find(d => d.code === FIGURE_MULTIPLE_CAPTIONS_CODE)!
    expect(multi.location?.kind).toBe('target-group')
    if (multi.location?.kind === 'target-group') {
      expect(multi.location.targets).toHaveLength(2)
      for (const m of multi.location.targets) expect(m.kind).toBe('caption-projection')
    }
  })

  it('table + code multiple variants', () => {
    const h = harness()
    const t = addObject(h.root, 'table')
    const c = addObject(h.root, 'code')
    writerCaption(h, t, 'table', '表 1', '')
    writerCaption(h, t, 'table', '表 2', '')
    writerCaption(h, c, 'code', '代码 1', '')
    writerCaption(h, c, 'code', '代码 2', '')
    const found = codes(run(h))
    expect(found).toContain(TABLE_MULTIPLE_CAPTIONS_CODE)
    expect(found).toContain(CODE_MULTIPLE_CAPTIONS_CODE)
  })

  it('§20 *_MULTIPLE_CAPTIONS_FALSE_POSITIVE_COUNT=0 for a single-caption owner', () => {
    const h = harness()
    const owner = addObject(h.root, 'figure')
    writerCaption(h, owner, 'figure', '图 1', '')
    expect(codes(run(h))).not.toContain(FIGURE_MULTIPLE_CAPTIONS_CODE)
  })
})

// ── C4 bad format ───────────────────────────────────────────────────────────

describe('Phase G §15 — C4 bad format', () => {
  it('a label with no canonical separator → FORMAT_INVALID (figure/table/code)', () => {
    for (const type of ['figure', 'table', 'code'] as const) {
      const h = harness()
      const owner = addObject(h.root, type)
      const expected = type === 'figure' ? FIGURE_CAPTION_FORMAT_INVALID_CODE
        : type === 'table' ? TABLE_CAPTION_FORMAT_INVALID_CODE
          : CODE_CAPTION_FORMAT_INVALID_CODE
      writerCaption(h, owner, type, 'BROKEN', '')
      expect(codes(run(h)), type).toContain(expected)
    }
  })

  it('a title/name mismatch is a format defect', () => {
    const h = harness()
    const owner = addObject(h.root, 'figure')
    writerCaption(h, owner, 'figure', '图 1 甲', '乙')
    expect(codes(run(h))).toContain(FIGURE_CAPTION_FORMAT_INVALID_CODE)
  })

  it('§20 *_CAPTION_FORMAT_FALSE_POSITIVE_COUNT=0 for the canonical formatter output', () => {
    expect(isCanonicalCaptionLabel('图 1', '')).toBe(true)
    expect(isCanonicalCaptionLabel('图 1 名称', '名称')).toBe(true)
    expect(isCanonicalCaptionLabel('代码 2.1 示例', '示例')).toBe(true)
    // negatives
    expect(isCanonicalCaptionLabel('', '')).toBe(false)
    expect(isCanonicalCaptionLabel('图1', '')).toBe(false)
    expect(isCanonicalCaptionLabel('图 ', '')).toBe(false)
    expect(isCanonicalCaptionLabel('图 1', '名')).toBe(false)
  })
})

// ── C7 duplicate destination figure isolation ───────────────────────────────

describe('Phase G §15 — C7 duplicate destination figure isolation', () => {
  it('two figures with the SAME image destination keep distinct owners / captions', () => {
    const h = harness()
    const a = addObject(h.root, 'figure')
    const b = addObject(h.root, 'figure')
    writerCaption(h, a, 'figure', '图 1', '')
    writerCaption(h, b, 'figure', '图 2', '')
    // Distinct owners (each exactly one caption) → no integrity diagnostic.
    expect(run(h)).toEqual([])
  })

  it('a duplicate on ONE figure never leaks to the OTHER figure owner', () => {
    const h = harness()
    const a = addObject(h.root, 'figure')
    const b = addObject(h.root, 'figure')
    const a1 = writerCaption(h, a, 'figure', '图 1', '')
    const a2 = writerCaption(h, a, 'figure', '图 2', '')
    writerCaption(h, b, 'figure', '图 3', '')
    const multi = run(h).filter(d => d.code === FIGURE_MULTIPLE_CAPTIONS_CODE)
    expect(multi).toHaveLength(1)
    expect(multi[0].location?.kind).toBe('target-group')
    if (multi[0].location?.kind === 'target-group') {
      const ids = multi[0].location.targets.map(t => (t.kind === 'caption-projection' ? t.captionId : ''))
      expect(ids.sort()).toEqual([a1.getAttribute('data-inkchapter-caption-id'), a2.getAttribute('data-inkchapter-caption-id')].sort())
    }
  })
})

// ── §20 / §6 — registry + owner authority ───────────────────────────────────

describe('Phase G §8/§20 — registry metadata + single owner authority', () => {
  const NINE = [
    FIGURE_ORPHAN_CAPTION_CODE, TABLE_ORPHAN_CAPTION_CODE, CODE_ORPHAN_CAPTION_CODE,
    FIGURE_MULTIPLE_CAPTIONS_CODE, TABLE_MULTIPLE_CAPTIONS_CODE, CODE_MULTIPLE_CAPTIONS_CODE,
    FIGURE_CAPTION_FORMAT_INVALID_CODE, TABLE_CAPTION_FORMAT_INVALID_CODE, CODE_CAPTION_FORMAT_INVALID_CODE,
  ]

  it('all 9 caption families are IMPLEMENTED with the ONE producer authority', () => {
    const authorities = new Set<string>()
    for (const code of NINE) {
      const meta = getRuleMeta(code)
      expect(meta, code).not.toBeNull()
      expect(meta!.implementationStatus, code).toBe('IMPLEMENTED')
      expect(meta!.producerAuthority, code).toBe('computeCaptionIntegrityDiagnostics')
      expect(meta!.suppressionGroup, code).toBe('caption-integrity')
      authorities.add(meta!.producerAuthority)
    }
    // CAPTION_INTEGRITY_DUPLICATE_OWNER_AUTHORITY_COUNT=0 → exactly ONE authority.
    expect(authorities.size).toBe(1)
  })
})
