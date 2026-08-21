import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { buildHeadingNumberingSnapshotForRevision } from './heading-numbering-snapshot'
import { computeProductionDesiredCaptionStates, type CaptionObjectEntry, type ProductionObjectConfigs } from './caption-semantic-bridge'
import { DEFAULT_OBJECT_NUMBERING_CONFIG, type ObjectNumberingConfig } from './object-numbering-engine'
import type { HeadingDescriptor, HeadingNumberingSettings } from './heading-types'
import { DEFAULT_SETTINGS } from '../settings/default-settings'

const base = DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault

function hd(key: string, level: 1 | 2 | 3 | 4 | 5 | 6, text = key): HeadingDescriptor {
  return { key, level, text }
}

function settings(mode: 'strict' | 'loose'): HeadingNumberingSettings {
  return { ...base, levels: { ...base.levels }, headingStructureMode: mode, showLevelOneNumber: mode === 'loose' }
}

function config(preset: ObjectNumberingConfig['preset']): ObjectNumberingConfig {
  return { ...DEFAULT_OBJECT_NUMBERING_CONFIG.figure, preset }
}

function configs(preset: ObjectNumberingConfig['preset']): ProductionObjectConfigs {
  return {
    figure: config(preset),
    table: { ...config(preset), prefix: '表' },
    code: { ...config(preset), prefix: '代码' },
  }
}

function compute(headings: HeadingDescriptor[], mode: 'strict' | 'loose', objects: CaptionObjectEntry[], cfg: ProductionObjectConfigs) {
  const snap = buildHeadingNumberingSnapshotForRevision(headings, settings(mode), undefined, undefined, 1, 'doc.md')
  return computeProductionDesiredCaptionStates(snap, objects, cfg)
}

// ── BRIDGE-BIND — pure identity lookup, no positional index authority ──

describe('Phase 6.1R bridge identity binding (BRIDGE-BIND)', () => {
  const headings = [hd('t', 1), hd('c', 2, 'Chapter A'), hd('sA', 3, 'Section A'), hd('sB', 3, 'Section B')]

  it('BRIDGE-BIND-1: precedingHeadingStableIdentity=SectionA wins even when SectionB is the last semantic entry', () => {
    const r = compute(
      headings,
      'strict',
      [{ stableIdentity: 'f1', objectKind: 'table', precedingHeadingStableIdentity: 'sA' }],
      configs('section-dash'),
    )
    expect(r[0].chapterOrdinal).toBe(1)
    expect(r[0].sectionOrdinal).toBe(1)
    expect(r[0].rawNumber).toBe('1.1-1')
  })

  it('BRIDGE-BIND-2: reordering the semantic array (same stable identities) does NOT alter the selected state', () => {
    // Build the snapshot normally, then reorder ONLY the semantic array while
    // keeping each entry's identity and ordinal values intact. The bridge must
    // resolve Section A by identity regardless of array position.
    const snap = buildHeadingNumberingSnapshotForRevision(headings, settings('strict'), undefined, undefined, 1, 'doc.md')
    const reorderedSemantic = [...snap.semantic].reverse()
    const cfg = configs('section-dash')
    const r = computeProductionDesiredCaptionStates(
      { ...snap, semantic: reorderedSemantic },
      [{ stableIdentity: 'f1', objectKind: 'table', precedingHeadingStableIdentity: 'sA' }],
      cfg,
    )
    expect(r[0].chapterOrdinal).toBe(1)
    expect(r[0].sectionOrdinal).toBe(1)
    expect(r[0].rawNumber).toBe('1.1-1')
  })

  it('BRIDGE-BIND-3: unknown heading identity → no guess, no last-entry fallback (resolves via no preceding → GLOBAL)', () => {
    const r = compute(
      headings,
      'strict',
      [{ stableIdentity: 'f1', objectKind: 'table', precedingHeadingStableIdentity: 'ghost-heading' }],
      configs('section-dash'),
    )
    expect(r[0].effectiveScope).toBe('global')
    expect(r[0].chapterOrdinal).toBeNull()
    expect(r[0].sectionOrdinal).toBeNull()
    expect(r[0].rawNumber).toBe('1')
  })

  it('BRIDGE-BIND-4: no preceding identity → global fallback from no semantic heading', () => {
    const r = compute(
      [hd('t', 1)],
      'strict',
      [{ stableIdentity: 'f1', objectKind: 'code', precedingHeadingStableIdentity: null }],
      configs('section-dash'),
    )
    expect(r[0].effectiveScope).toBe('global')
    expect(r[0].rawNumber).toBe('1')
  })

  it('BRIDGE-BIND-5: chapter fallback — object under Chapter A only → section-dash degrades to 1-1', () => {
    const r = compute(
      [hd('t', 1), hd('c', 2, 'Chapter A')],
      'strict',
      [{ stableIdentity: 'f1', objectKind: 'code', precedingHeadingStableIdentity: 'c' }],
      configs('section-dash'),
    )
    expect(r[0].effectiveScope).toBe('chapter')
    expect(r[0].chapterOrdinal).toBe(1)
    expect(r[0].sectionOrdinal).toBeNull()
    expect(r[0].rawNumber).toBe('1-1')
  })

  it('BIND-SAME: multiple objects at the same structural position resolve the same heading identity', () => {
    const objects: CaptionObjectEntry[] = [
      { stableIdentity: 'T1', objectKind: 'table', precedingHeadingStableIdentity: 'sA' },
      { stableIdentity: 'C1', objectKind: 'code', precedingHeadingStableIdentity: 'sA' },
      { stableIdentity: 'F1', objectKind: 'figure', precedingHeadingStableIdentity: 'sA' },
    ]
    const r = compute(headings, 'strict', objects, configs('section-dash'))
    expect(r.map(x => `${x.objectKind}:${x.rawNumber}`)).toEqual([
      'table:1.1-1',
      'code:1.1-1',
      'figure:1.1-1',
    ])
  })
})

// ── Source guards — the exact Phase 6.1R root cause ──

describe('Phase 6.1R resolver source guards', () => {
  it('resolver uses local DOM position bitmask constants, NOT Node.DOCUMENT_POSITION_*', () => {
    const src = readFileSync(fileURLToPath(new URL('./heading-numbering-service.ts', import.meta.url)), 'utf8')
    // Root cause: in the bundled runtime, Node.DOCUMENT_POSITION_* resolved to
    // undefined, making every bitmask test falsy (never-break old path → +1;
    // always-break resolver → NO_PRECEDING_CANDIDATE).
    const resolverRegion = src.slice(src.indexOf('resolvePrecedingSemanticHeading'), src.indexOf('subscribeHeadingNumberingSnapshot'))
    expect(resolverRegion).not.toContain('Node.DOCUMENT_POSITION')
    expect(resolverRegion).toContain('DOM_POSITION_FOLLOWING')
    expect(resolverRegion).toContain('DOM_POSITION_PRECEDING')
    expect(resolverRegion).toContain('DOM_POSITION_DISCONNECTED')
  })

  it('production Caption path has NO raw positional semantic authority', () => {
    const service = readFileSync(fileURLToPath(new URL('./caption-service.ts', import.meta.url)), 'utf8')
    const bridge = readFileSync(fileURLToPath(new URL('./caption-semantic-bridge.ts', import.meta.url)), 'utf8')
    expect(service).not.toContain('precedingHeadingCount')
    expect(service).not.toContain('semantic[precedingHeadingCount')
    expect(bridge).not.toContain('precedingHeadingCount')
    expect(bridge).not.toContain('semantic[')
  })
})
