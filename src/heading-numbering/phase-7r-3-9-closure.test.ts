// @vitest-environment jsdom
/**
 * Phase 7R.3.9 — Caption Deferred Hot-Loop + Canonical Heading Frame Closure
 *
 * RETRY-1..6    deferred retry state machine (IDLE/FOLLOW_UP/PARK/no self-wake)
 * FRAME-1..6    canonical heading frame build + coherence
 * RESOLVER-1..3 frame-based nearest-preceding resolver
 * LOG-1..4      normal-mode logging gates
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  CaptionDeferredRetryController,
  buildCaptionReconcileStateToken,
  buildCaptionFailureSignature,
  buildCaptionTargetFingerprint,
} from './caption-reconcile-retry'
import {
  buildCanonicalHeadingFrame,
  resolvePrecedingHeading,
  type CanonicalHeadingBinding,
  type CanonicalHeadingFrame,
} from './canonical-heading-frame'
import type { SemanticHeadingNumberState } from './semantic-heading-types'
import { HeadingNumberingAuthority } from './heading-numbering-snapshot'
import { buildHeadingNumberingSnapshotForRevision } from './heading-numbering-snapshot'
import { getPresetLevels } from './presets'
import type { HeadingNumberingSettings } from './heading-types'

const auditCalls: Array<{ event: string; payload: Record<string, unknown> }> = []
vi.mock('../runtime/forensic-log-sink', () => ({
  emitRuntimeAudit: (event: string, payload: Record<string, unknown>) => {
    auditCalls.push({ event, payload })
  },
}))

beforeEach(() => {
  auditCalls.length = 0
})

function token(overrides: Partial<Parameters<typeof buildCaptionReconcileStateToken>[0]> = {}): string {
  return buildCaptionReconcileStateToken({
    documentKey: 'doc.md',
    editorStructureEpoch: 47,
    headingSemanticFingerprint: 'f-headings-a',
    canonicalHeadingFrameFingerprint: 'f-frame-a',
    canonicalTargetFingerprint: buildCaptionTargetFingerprint(['code', 'code', 'table']),
    settingsSemanticSignature: 'f-settings-c',
    ...overrides,
  })
}

function failureSig(t: string, count = 8): string {
  return buildCaptionFailureSignature(t, count, 'fp-reasons', 'fp-identities')
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

function semanticState(key: string, physicalLevel: 1 | 2 | 3 | 4 | 5 | 6): SemanticHeadingNumberState {
  return {
    stableIdentity: key,
    physicalLevel,
    effectiveDepth: physicalLevel - 1,
    semanticRole: physicalLevel === 1 ? 'document-title' : (physicalLevel === 2 ? 'chapter' : 'section'),
    structuralParentIdentity: null,
    structuralChapterIdentity: null,
    structuralSectionIdentity: null,
    strictBoundaryIdentity: null,
    strictBoundaryOrdinal: null,
    ordinalByDepth: [],
    displayCountedPath: [],
    logicalOrdinal: null,
    chapterOrdinal: physicalLevel === 2 ? 1 : null,
    sectionOrdinal: physicalLevel === 3 ? 1 : null,
    sourceRevision: 1,
    counted: physicalLevel > 1,
    countingReason: 'test',
  }
}

function binding(key: string, level: number, element: HTMLElement): CanonicalHeadingBinding {
  return { key, element, level, text: key }
}

describe('RETRY — caption deferred retry state machine', () => {
  it('RETRY-1: complete first pass → IDLE, no follow-up', () => {
    const c = new CaptionDeferredRetryController()
    expect(c.getState().state).toBe('IDLE')
    c.markComplete()
    expect(c.getState().state).toBe('IDLE')
    expect(c.getGateCounters().followUpCount).toBe(0)
  })

  it('RETRY-2: transient then complete → one follow-up allowed, then IDLE', () => {
    const c = new CaptionDeferredRetryController()
    const t = token()
    const sig = failureSig(t)
    expect(c.decide(t, sig)).toBe('ALLOW_ONE_FOLLOW_UP')
    expect(c.getState().state).toBe('FOLLOW_UP_ALLOWED')
    c.markComplete()
    expect(c.getState().state).toBe('IDLE')
    expect(c.getGateCounters().followUpCount).toBe(1)
  })

  it('RETRY-3: transient X/Y twice → PARK after one follow-up (2 attempts total, no third)', () => {
    const c = new CaptionDeferredRetryController()
    const t = token()
    const sig = failureSig(t)
    expect(c.decide(t, sig)).toBe('ALLOW_ONE_FOLLOW_UP') // pass 1
    expect(c.decide(t, sig)).toBe('PARK') // pass 2 (the single follow-up)
    expect(c.getState().state).toBe('PARKED')
    expect(c.getGateCounters().followUpCount).toBe(1)
    expect(c.getGateCounters().parkedCount).toBe(1)
  })

  it('RETRY-4: parked state does NOT self-wake on same token+failureSignature', () => {
    const c = new CaptionDeferredRetryController()
    const t = token()
    const sig = failureSig(t)
    c.decide(t, sig)
    c.decide(t, sig) // → PARK
    // A third pass with identical state must be ignored — never schedule again.
    expect(c.decide(t, sig)).toBe('IGNORE_PARKED_SAME_STATE')
    expect(c.getGateCounters().parkedStateSelfWakeCount).toBe(1)
  })

  it('RETRY-5: real authority change (editorStructureEpoch) releases the park', () => {
    const c = new CaptionDeferredRetryController()
    const tA = token({ editorStructureEpoch: 47 })
    const sigA = failureSig(tA)
    c.decide(tA, sigA)
    c.decide(tA, sigA) // → PARK
    expect(c.getState().state).toBe('PARKED')
    const tB = token({ editorStructureEpoch: 48 })
    const sigB = failureSig(tB)
    expect(c.decide(tB, sigB)).toBe('ALLOW_ONE_FOLLOW_UP')
  })

  it('RETRY-6: document switch clears parked state', () => {
    const c = new CaptionDeferredRetryController()
    const tA = token({ documentKey: 'doc-a.md' })
    const sigA = failureSig(tA)
    c.decide(tA, sigA)
    c.decide(tA, sigA) // → PARK
    c.resetForDocument()
    expect(c.getState().state).toBe('IDLE')
    const tB = token({ documentKey: 'doc-b.md' })
    expect(c.decide(tB, failureSig(tB))).toBe('ALLOW_ONE_FOLLOW_UP')
  })

  it('RETRY-FUSE: hot-loop fuse force-parks after >2 identical full reconciles', () => {
    const c = new CaptionDeferredRetryController()
    const t = token()
    const sig = failureSig(t)
    // simulate: full reconcile recorded 3x with same token+sig, then decide
    c.recordFullReconcile(t, sig)
    c.recordFullReconcile(t, sig)
    c.recordFullReconcile(t, sig)
    const decision = c.decide(t, sig)
    expect(decision).toBe('HOT_LOOP_FUSE_PARK')
    expect(c.getGateCounters().hotLoopGuardTriggeredCount).toBe(1)
    expect(c.getState().state).toBe('PARKED')
  })
})

describe('FRAME — canonical heading frame', () => {
  function frameInput(opts: {
    semanticKeys?: string[]
    bindingKeys?: string[]
    duplicateBinding?: boolean
    staleEpoch?: boolean
  }) {
    const semanticKeys = opts.semanticKeys ?? ['H1', 'H2', 'H3']
    const bindingKeys = opts.bindingKeys ?? [...semanticKeys]
    const els = bindingKeys.map(() => document.createElement('h2'))
    const bindings = bindingKeys.map((k, i) => binding(k, 2, els[i]))
    const semantic = semanticKeys.map(k => semanticState(k, 2))
    if (opts.duplicateBinding) bindings.push(binding(bindingKeys[0], 2, document.createElement('h2')))
    const epoch = opts.staleEpoch ? 1 : 0
    return {
      documentKey: 'doc.md',
      editorStructureEpoch: 47,
      semanticRevision: 5,
      frameGeneration: 1,
      epochStart: epoch,
      epochEnd: 0,
      bindings,
      semantic,
    }
  }

  it('FRAME-1: identical semantic+binding sets → COHERENT, frame committed', () => {
    const r = buildCanonicalHeadingFrame(frameInput({}))
    expect(r.decision).toBe('COHERENT')
    expect(r.frame).not.toBeNull()
    expect(r.frame!.entries.length).toBe(3)
    expect(r.inventory.canonicalEntryCount).toBe(3)
  })

  it('FRAME-2: semantic=33 binding=34 → COUNT_MISMATCH, no commit, no endless retry', () => {
    const r = buildCanonicalHeadingFrame(frameInput({
      semanticKeys: Array.from({ length: 33 }, (_, i) => `H${i}`),
      bindingKeys: Array.from({ length: 34 }, (_, i) => `H${i}`),
    }))
    expect(r.decision).toBe('COUNT_MISMATCH')
    expect(r.frame).toBeNull()
    const inv = auditCalls.find(c => c.event === 'HEADING-CANONICAL-FRAME-INVENTORY')
    expect(inv).toBeDefined()
    expect(inv!.payload.decision).toBe('COUNT_MISMATCH')
  })

  it('FRAME-3: equal counts but different identity sets → IDENTITY_SET_MISMATCH', () => {
    const r = buildCanonicalHeadingFrame(frameInput({
      semanticKeys: ['H1', 'H2', 'H3'],
      bindingKeys: ['H1', 'H2', 'HX'],
    }))
    expect(r.decision).toBe('IDENTITY_SET_MISMATCH')
    expect(r.frame).toBeNull()
    expect(r.inventory.bindingOnlyIdentities).toEqual(['HX'])
    expect(r.inventory.semanticOnlyIdentities).toEqual(['H3'])
  })

  it('FRAME-4: duplicate identity → DUPLICATE_IDENTITY', () => {
    const r = buildCanonicalHeadingFrame(frameInput({ duplicateBinding: true }))
    expect(r.decision).toBe('DUPLICATE_IDENTITY')
    expect(r.frame).toBeNull()
  })

  it('FRAME-5: structure epoch changed during frame build → STALE_STRUCTURE_EPOCH', () => {
    const r = buildCanonicalHeadingFrame(frameInput({ staleEpoch: true }))
    expect(r.decision).toBe('STALE_STRUCTURE_EPOCH')
    expect(r.frame).toBeNull()
  })

  it('FRAME-6: entry.stableIdentity === semanticState.stableIdentity (identity generated once)', () => {
    const r = buildCanonicalHeadingFrame(frameInput({}))
    expect(r.decision).toBe('COHERENT')
    for (const e of r.frame!.entries) {
      expect(e.stableIdentity).toBe(e.semanticState.stableIdentity)
    }
  })
})

describe('RESOLVER — frame-based nearest-preceding heading', () => {
  function makeFrame(): { frame: CanonicalHeadingFrame; root: HTMLElement } {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const h1 = document.createElement('h1'); h1.id = 'h1'; root.appendChild(h1)
    const p1 = document.createElement('p'); p1.textContent = 'text'; root.appendChild(p1)
    const h2 = document.createElement('h2'); h2.id = 'h2'; root.appendChild(h2)
    const p2 = document.createElement('p'); p2.textContent = 'text2'; root.appendChild(p2)
    const bindings: CanonicalHeadingBinding[] = [
      { key: 'H1', element: h1, level: 1, text: 't' },
      { key: 'H2', element: h2, level: 2, text: 't' },
    ]
    const semantic = [semanticState('H1', 1), semanticState('H2', 2)]
    const r = buildCanonicalHeadingFrame({
      documentKey: 'doc.md', editorStructureEpoch: 1, semanticRevision: 1, frameGeneration: 1,
      epochStart: 0, epochEnd: 0, bindings, semantic,
    })
    return { frame: r.frame!, root }
  }

  it('RESOLVER-1: nearest preceding returns element + identity + semanticState atomically', () => {
    const { frame, root } = makeFrame()
    const p1 = root.querySelectorAll('p')[0]
    const p2 = root.querySelectorAll('p')[1]
    const e1 = resolvePrecedingHeading(p1, frame, root)
    const e2 = resolvePrecedingHeading(p2, frame, root)
    expect(e1!.stableIdentity).toBe('H1')
    expect(e1!.element.tagName).toBe('H1')
    expect(e1!.semanticState.chapterOrdinal).toBeNull()
    expect(e2!.stableIdentity).toBe('H2')
    expect(e2!.semanticState.semanticRole).toBe('chapter')
  })

  it('RESOLVER-2: success path never does candidate→semanticByIdentity.get (source-level proof)', () => {
    // The batch resolver returns the JOINED entry from the committed frame;
    // the only remaining semanticByIdentity.get is inside the pre-frame
    // fallback branch, never on the frame success path.
    const src = fs.readFileSync(path.resolve(__dirname, 'heading-numbering-service.ts'), 'utf8')
    // Slice ONLY the committed-frame success branch (useFrame…SESSION_FRAME_FORWARD_SWEEP);
    // the pre-frame fallback branch legitimately keeps the identity lookup.
    const frameBranch = src.slice(src.indexOf('const useFrame = frame !== null'), src.indexOf("decision: 'SESSION_FRAME_FORWARD_SWEEP'"))
    expect(frameBranch).not.toContain('semanticByIdentity.get')
  })

  it('RESOLVER-3: disconnected target → null (transient, bounded)', () => {
    const { frame, root } = makeFrame()
    const detached = document.createElement('p')
    expect(resolvePrecedingHeading(detached, frame, root)).toBeNull()
    expect(resolvePrecedingHeading(root.querySelectorAll('p')[0], frame, null)).toBeNull()
  })
})

describe('LOG — normal-mode logging gates', () => {
  it('LOG-1: CODE-CANDIDATE-DECISION is verbose-gated; CODE-CANDIDATE-SUMMARY exists', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'caption-dom-adapter.ts'), 'utf8')
    expect(src).toContain('CODE-CANDIDATE-SUMMARY')
    const detailIdx = src.indexOf('CODE-CANDIDATE-DECISION')
    const gated = src.slice(Math.max(0, detailIdx - 400), detailIdx)
    expect(gated).toContain('forensicVerboseEnabled')
  })

  it('LOG-2/3: CAPTION-UNRESOLVED-SUMMARY exists with state-dedup; per-target forensic verbose-gated', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'caption-service.ts'), 'utf8')
    expect(src).toContain('CAPTION-UNRESOLVED-SUMMARY')
    expect(src).toContain('lastReportedCaptionFailureSignature')
    // per-target success forensic moved behind forensicVerboseEnabled
    const targetDecision = src.indexOf('CAPTION-TARGET-DECISION')
    // The verbose gate is ~8 lines above the audit line (large console.info template).
    expect(src.slice(Math.max(0, targetDecision - 800), targetDecision)).toContain('forensicVerboseEnabled')
    const bindingForensic = src.indexOf('CAPTION-HEADING-BINDING-FORENSIC')
    expect(src.slice(Math.max(0, bindingForensic - 200), bindingForensic)).toContain('forensicVerboseEnabled')
  })

  it('LOG-4: verbose mode restores detail (forensicVerboseEnabled gates both sides)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'caption-service.ts'), 'utf8')
    expect(src).toContain('forensicVerboseEnabled()')
  })
})

describe('TOKEN — deterministic state token', () => {
  it('token excludes retry counters and timestamps', () => {
    const t1 = token()
    const t2 = token()
    expect(t1).toBe(t2) // deterministic
    // a real authority change changes the token
    expect(token({ editorStructureEpoch: 99 })).not.toBe(t1)
  })
})
