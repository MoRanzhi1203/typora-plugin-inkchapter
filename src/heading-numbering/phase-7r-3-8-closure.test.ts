/**
 * Phase 7R.3.8 — Fixture Integrity + Document-Aware Formula Cardinality +
 * Boundary Semantic No-op / Audit Performance Closure
 *
 * FIXTURE-IMG-1/2   fixture local image references resolve; no absolute/remote
 * CARD-1..5         production cardinality diagnostic is document-aware
 * REV-NOOP-1..5     semantic no-op does not advance revision / notify
 * LOG-BOUNDARY-1..3 boundary summary in normal mode; detail on demand/failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import type { HeadingDescriptor, HeadingNumberingSettings } from './heading-types'
import { getPresetLevels } from './presets'
import { HeadingNumberingAuthority } from './heading-numbering-snapshot'
import { computeHeadingSemanticFingerprint } from './numbering-fast-path'
import { buildHeadingNumberingSnapshotForRevision } from './heading-numbering-snapshot'
import { resetHeadingSemanticPerfCounters, getHeadingSemanticPerfCounters } from './heading-semantic-perf'

const auditCalls: Array<{ event: string; payload: Record<string, unknown> }> = []
vi.mock('../runtime/forensic-log-sink', () => ({
  emitRuntimeAudit: (event: string, payload: Record<string, unknown>) => {
    auditCalls.push({ event, payload })
  },
}))

const fixtureDir = path.resolve(__dirname, '../../test/vault/runtime/smoke')
const fixturePath = path.join(fixtureDir, 'Phase7-Strict-H1-Boundary-Runtime-Test.md')

function hd(key: string, level: 1 | 2 | 3 | 4 | 5 | 6, text = key): HeadingDescriptor {
  return { key, level, text }
}

function settings(mode: 'strict' | 'loose' = 'strict'): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode: mode,
    showLevelOneNumber: mode === 'loose',
    preset: 'decimal-hierarchical',
    maxDepth: 6,
    levels: getPresetLevels('decimal-hierarchical'),
    customDefinition: getPresetLevels('decimal-hierarchical'),
  } as HeadingNumberingSettings
}

function auditEvents(...names: string[]): number {
  return auditCalls.filter(c => names.includes(c.event)).length
}

beforeEach(() => {
  auditCalls.length = 0
  resetHeadingSemanticPerfCounters()
  delete (globalThis as { __inkchapter_forensic_verbose__?: unknown }).__inkchapter_forensic_verbose__
})

describe('FIXTURE-IMG — Strict-H1 boundary fixture asset integrity', () => {
  const PNG_SIGNATURE = '89504e470d0a1a0a'
  const sha256Of = (file: string): string =>
    createHash('sha256').update(fs.readFileSync(file).toString('base64')).digest('hex')

  it('FIXTURE-IMG-1: every local image reference resolves to a real, non-empty PNG in the repository', () => {
    const md = fs.readFileSync(fixturePath, 'utf8')
    const refs = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1])
    expect(refs.length).toBeGreaterThanOrEqual(3)
    const digests = new Map<string, string>()
    for (const ref of refs) {
      const target = path.resolve(fixtureDir, ref)
      expect(fs.existsSync(target), `missing asset: ${ref}`).toBe(true)
      const bytes = fs.readFileSync(target)
      // 真实 PNG 内容，而不是 0 字节占位文件。
      expect(bytes.length, `empty asset: ${ref}`).toBeGreaterThan(0)
      expect(bytes.subarray(0, 8).toString('hex'), `not a PNG: ${ref}`).toBe(PNG_SIGNATURE)
      // 同一图片被多次引用时必须指向完全相同的字节（内容身份，而非文件名）。
      const digest = sha256Of(target)
      const previous = digests.get(ref)
      if (previous != null) expect(digest, `unstable content: ${ref}`).toBe(previous)
      digests.set(ref, digest)
    }
    // 三张不同的 boundary 图片内容互不相同：同名/同引用不得被当作同一张图。
    expect(digests.size).toBeGreaterThanOrEqual(3)
    expect(new Set(digests.values()).size).toBe(digests.size)
  })

  it('FIXTURE-IMG-1b: the runtime copies are byte-identical to the canonical vault assets', () => {
    const canonical = path.resolve(fixtureDir, '../../assets/phase7-strict-h1-boundary')
    // 这些是 vault 级共享资产，runtime 副本必须逐字节一致（不得漂移）。
    for (const name of ['boundary-a-figure.png', 'boundary-b-figure.png']) {
      const runtimeCopy = path.join(fixtureDir, 'assets', 'phase7-strict-h1-boundary', name)
      const sourceCopy = path.join(canonical, name)
      expect(fs.existsSync(runtimeCopy), `missing runtime copy: ${name}`).toBe(true)
      expect(fs.existsSync(sourceCopy), `missing canonical copy: ${name}`).toBe(true)
      expect(sha256Of(runtimeCopy), `copy drifted: ${name}`).toBe(sha256Of(sourceCopy))
    }
    // A2 图是本章专用资源，只存在于 runtime 夹具目录：必须同样是非空 PNG。
    const a2 = path.join(fixtureDir, 'assets', 'phase7-strict-h1-boundary', 'boundary-a-chapter-a2-figure.png')
    expect(fs.existsSync(a2)).toBe(true)
    const a2Bytes = fs.readFileSync(a2)
    expect(a2Bytes.length).toBeGreaterThan(0)
    expect(a2Bytes.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE)
  })

  it('FIXTURE-IMG-2: no absolute / user-specific / remote image source', () => {
    const md = fs.readFileSync(fixturePath, 'utf8')
    const refs = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1])
    for (const ref of refs) {
      expect(ref).not.toMatch(/^(https?:)?\/\//i)
      expect(ref).not.toMatch(/^[A-Za-z]:\\/i)
      expect(ref).not.toMatch(/^\\\\/i)
      expect(ref).not.toMatch(/C:\\Users/i)
      expect(ref).not.toMatch(/^data:/i)
    }
    // canonical asset directory exists and contains the three boundary figures
    const assetDir = path.join(fixtureDir, 'assets', 'phase7-strict-h1-boundary')
    expect(fs.existsSync(path.join(assetDir, 'boundary-a-figure.png'))).toBe(true)
    expect(fs.existsSync(path.join(assetDir, 'boundary-a-chapter-a2-figure.png'))).toBe(true)
    expect(fs.existsSync(path.join(assetDir, 'boundary-b-figure.png'))).toBe(true)
  })
})

describe('CARD — document-aware Formula cardinality diagnostic', () => {
  it('CARD-1/2: production marker carries NO hardcoded expected count; NOT_APPLICABLE + NONE', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'caption-service.ts'), 'utf8')
    // no literal 4 / 2 expectation in the generic production marker
    expect(src).not.toContain('expectedLogicalFormulaCount: 4')
    expect(src).not.toContain('expectedLogicalFormulaCount: 2')
    expect(src).toContain("expectedLogicalFormulaCount: 'NOT_APPLICABLE'")
    expect(src).toContain("expectationSource: 'NONE'")
    // observed document-aware fields present
    expect(src).toContain('logicalFormulaHostCount')
    expect(src).toContain('canonicalFormulaTargetCount')
    expect(src).toContain('uniqueCanonicalHostCount')
    expect(src).toContain('duplicateCanonicalHostCount')
    expect(src).toContain('renderedMathJaxBusinessTargetCount')
  })

  it('CARD-4/5: rendered MathJax must not inflate count; duplicate detection preserved', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'caption-service.ts'), 'utf8')
    // RENDERED_NODE_LEAK decision exists and MJX leakage is treated as a failure
    expect(src).toContain("'RENDERED_NODE_LEAK'")
    expect(src).toContain("'DUPLICATE_CANONICAL_HOST'")
    expect(src).toContain("'CARDINALITY_MISMATCH'")
  })
})

describe('REV-NOOP — semantic no-op revision suppression', () => {
  it('REV-NOOP-1: same semantic state recomputed → revision advances once only', () => {
    const a = new HeadingNumberingAuthority()
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3)]
    a.commit(headings, settings())
    const r1 = a.getCurrentRevision()
    const snap2 = a.commit(headings, settings())
    expect(a.getCurrentRevision()).toBe(r1) // no-op: no advance
    expect(snap2.revision).toBe(r1)
    expect(getHeadingSemanticPerfCounters().semanticNoopRevisionAdvanceCount).toBe(0)
    expect(getHeadingSemanticPerfCounters().semanticCommitUnchangedCount).toBe(1)
  })

  it('REV-NOOP-2: unchanged inputs → subscriber notify = 0 on the no-op pass', () => {
    const a = new HeadingNumberingAuthority()
    let notified = 0
    a.subscribe(() => { notified++ })
    const headings = [hd('t', 1), hd('c', 2)]
    a.commit(headings, settings())
    expect(notified).toBe(1) // first commit changed
    a.commit(headings, settings())
    expect(notified).toBe(1) // no-op: no notify
  })

  it('REV-NOOP-3: heading TEXT-only change → semantic fingerprint unchanged → no notify', () => {
    const a = new HeadingNumberingAuthority()
    let notified = 0
    a.subscribe(() => { notified++ })
    a.commit([hd('t', 1, 'Title A'), hd('c', 2, 'Chapter A')], settings())
    const r1 = a.getCurrentRevision()
    a.commit([hd('t', 1, 'Title B'), hd('c', 2, 'Chapter B')], settings())
    expect(a.getCurrentRevision()).toBe(r1)
    expect(notified).toBe(1)
    // fingerprints equal across text-only change
    const s1 = buildHeadingNumberingSnapshotForRevision([hd('t', 1, 'Title A'), hd('c', 2, 'Chapter A')], settings(), undefined, undefined, 1, 'doc')
    const s2 = buildHeadingNumberingSnapshotForRevision([hd('t', 1, 'Title B'), hd('c', 2, 'Chapter B')], settings(), undefined, undefined, 1, 'doc')
    expect(computeHeadingSemanticFingerprint(s1)).toBe(computeHeadingSemanticFingerprint(s2))
  })

  it('REV-NOOP-4: real H3→H4 → fingerprint changed, revision +1, subscriber notify +1', () => {
    const a = new HeadingNumberingAuthority()
    let notified = 0
    a.subscribe(() => { notified++ })
    a.commit([hd('t', 1), hd('c', 2), hd('s', 3)], settings())
    const r1 = a.getCurrentRevision()
    a.commit([hd('t', 1), hd('c', 2), hd('s', 4)], settings()) // H3 → H4
    expect(a.getCurrentRevision()).toBe(r1 + 1)
    expect(notified).toBe(2)
  })

  it('REV-NOOP-5: insert second H1 → boundary identity changes → fingerprint changed, revision +1', () => {
    const a = new HeadingNumberingAuthority()
    a.commit([hd('tA', 1), hd('c1', 2)], settings())
    const r1 = a.getCurrentRevision()
    a.commit([hd('tA', 1), hd('c1', 2), hd('tB', 1), hd('c2', 2)], settings())
    expect(a.getCurrentRevision()).toBe(r1 + 1)
    expect(getHeadingSemanticPerfCounters().semanticRevisionAdvanceCount).toBe(2)
  })
})

describe('LOG-BOUNDARY — boundary audit compression', () => {
  it('LOG-BOUNDARY-1: normal mode changed commit → ONE summary, zero per-heading detail (no failure)', () => {
    const a = new HeadingNumberingAuthority()
    a.commit([hd('tA', 1), hd('c1', 2), hd('s1', 3), hd('tB', 1), hd('c2', 2)], settings())
    expect(auditEvents('STRICT-NUMBERING-BOUNDARY-SUMMARY')).toBe(1)
    expect(auditEvents('STRICT-NUMBERING-BOUNDARY')).toBe(0) // no failure → no detail
    const perf = getHeadingSemanticPerfCounters()
    expect(perf.strictBoundarySummaryCount).toBe(1)
    expect(perf.strictBoundaryDetailedRecordCount).toBe(0)
  })

  it('LOG-BOUNDARY-2: verbose mode → per-heading detailed records available', () => {
    ;(globalThis as { __inkchapter_forensic_verbose__?: unknown }).__inkchapter_forensic_verbose__ = true
    const a = new HeadingNumberingAuthority()
    a.commit([hd('tA', 1), hd('c1', 2), hd('s1', 3)], settings())
    expect(auditEvents('STRICT-NUMBERING-BOUNDARY-SUMMARY')).toBe(1)
    expect(auditEvents('STRICT-NUMBERING-BOUNDARY')).toBeGreaterThan(0) // OPEN/CONTINUE detail
    expect(getHeadingSemanticPerfCounters().strictBoundaryDetailedRecordCount).toBeGreaterThan(0)
  })

  it('LOG-BOUNDARY-3: normal mode hard boundary failure → affected-heading forensic emitted', () => {
    const a = new HeadingNumberingAuthority()
    // H1 / H3 (no H2) → invalid strict parent → targeted failure forensic
    a.commit([hd('t', 1), hd('orphan-section', 3)], settings())
    const summary = auditCalls.find(c => c.event === 'STRICT-NUMBERING-BOUNDARY-SUMMARY')
    expect(summary).toBeDefined()
    expect((summary!.payload as { invalidStrictParentCount: number }).invalidStrictParentCount).toBe(1)
    expect((summary!.payload as { zeroFillSuppressedCount: number }).zeroFillSuppressedCount).toBe(1)
    // affected-heading failure record exists even in normal mode
    const fail = auditCalls.find(c => c.event === 'STRICT-NUMBERING-BOUNDARY' && (c.payload as { decision: string }).decision === 'INVALID_STRICT_PARENT')
    expect(fail).toBeDefined()
  })
})
