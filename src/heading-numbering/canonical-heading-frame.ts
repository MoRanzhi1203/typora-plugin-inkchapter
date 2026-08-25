/**
 * Canonical Heading Frame (Phase 7R.3.9)
 *
 * ONE canonical heading collection with stableIdentity generated ONCE and
 * joined with the DOM element + SemanticHeadingNumberState in a single frame.
 * Caption/Formula consumers resolve against the committed frame — they never
 * independently re-collect headings and re-join them to a separate semantic
 * snapshot (the 34-vs-33 drift source).
 *
 * Frame commit invariants (before commit):
 *   canonicalEntryCount == semanticHeadingCount == bindingHeadingCount
 *   identity sets equal
 *   no duplicate identity
 *   epochStart == epochEnd  (STALE_STRUCTURE_EPOCH otherwise)
 *
 * Pure logic + diagnostics; DOM access happens in the caller.
 */

import type { SemanticHeadingNumberState } from './semantic-heading-types'
import { fastHash } from './numbering-fast-path'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { forensicVerboseEnabled } from './document-open-perf'

/** Phase 7R.3.11.8B.2 — HEADING-CANONICAL-FRAME-INVENTORY state-token dedup
 *  (logging-only; identical inventory + decision repeats are suppressed). */
let lastCanonicalFrameInventorySignature = ''

export interface CanonicalHeadingBinding {
  key: string
  element: HTMLElement
  level: number
  text: string
}

export interface CanonicalHeadingEntry {
  stableIdentity: string
  element: HTMLElement
  semanticState: SemanticHeadingNumberState
}

export interface CanonicalHeadingFrame {
  documentKey: string
  semanticRevision: number
  editorStructureEpoch: number
  frameGeneration: number
  semanticFingerprint: string
  frameFingerprint: string
  entries: readonly CanonicalHeadingEntry[]
  entryByIdentity: ReadonlyMap<string, CanonicalHeadingEntry>
}

export type CanonicalFrameDecision =
  | 'COHERENT'
  | 'COUNT_MISMATCH'
  | 'IDENTITY_SET_MISMATCH'
  | 'DUPLICATE_IDENTITY'
  | 'STALE_STRUCTURE_EPOCH'

export interface CanonicalFrameInventory {
  documentKey: string | null
  editorStructureEpoch: number
  semanticRevision: number
  committedFrameGeneration: number
  semanticHeadingCount: number
  bindingHeadingCount: number
  canonicalEntryCount: number
  semanticIdentityCount: number
  bindingIdentityCount: number
  semanticOnlyIdentityCount: number
  bindingOnlyIdentityCount: number
  semanticOnlyIdentities: string[]
  bindingOnlyIdentities: string[]
  duplicateSemanticIdentities: string[]
  duplicateBindingIdentities: string[]
  decision: CanonicalFrameDecision
}

export interface CanonicalFrameBuildResult {
  decision: CanonicalFrameDecision
  frame: CanonicalHeadingFrame | null
  inventory: CanonicalFrameInventory
}

/** Frame fingerprint = ordered identity+level sequence (deterministic). */
export function computeCanonicalFrameFingerprint(entries: readonly CanonicalHeadingEntry[]): string {
  return fastHash(entries.map(e => `${e.stableIdentity}@${e.semanticState.physicalLevel}`).join('|'))
}

/**
 * Build the canonical heading frame from ONE heading binding collection joined
 * with the committed semantic states. Emits HEADING-CANONICAL-FRAME-INVENTORY.
 * The frame is committed ONLY when COHERENT.
 */
export function buildCanonicalHeadingFrame(input: {
  documentKey: string | null
  editorStructureEpoch: number
  semanticRevision: number
  frameGeneration: number
  epochStart: number
  epochEnd: number
  bindings: readonly CanonicalHeadingBinding[]
  semantic: readonly SemanticHeadingNumberState[]
}): CanonicalFrameBuildResult {
  const bindingKeys = input.bindings.map(b => b.key)
  const semanticKeys = input.semantic.map(s => s.stableIdentity)

  const countDuplicates = (keys: string[]): string[] => {
    const seen = new Set<string>()
    const dup = new Set<string>()
    for (const k of keys) { if (seen.has(k)) dup.add(k); seen.add(k) }
    return [...dup].sort()
  }
  const duplicateSemanticIdentities = countDuplicates(semanticKeys)
  const duplicateBindingIdentities = countDuplicates(bindingKeys)

  const semanticSet = new Set(semanticKeys)
  const bindingSet = new Set(bindingKeys)
  const semanticOnlyIdentities = semanticKeys.filter(k => !bindingSet.has(k))
  const bindingOnlyIdentities = bindingKeys.filter(k => !semanticSet.has(k))

  let decision: CanonicalFrameDecision = 'COHERENT'
  if (input.epochStart !== input.epochEnd) {
    decision = 'STALE_STRUCTURE_EPOCH'
  } else if (duplicateSemanticIdentities.length > 0 || duplicateBindingIdentities.length > 0) {
    decision = 'DUPLICATE_IDENTITY'
  } else if (semanticKeys.length !== bindingKeys.length) {
    // Count drift is the more fundamental incoherence (e.g. 33 semantic vs 34
    // bindings); report it before identity-set differences.
    decision = 'COUNT_MISMATCH'
  } else if (semanticOnlyIdentities.length > 0 || bindingOnlyIdentities.length > 0) {
    decision = 'IDENTITY_SET_MISMATCH'
  }

  const inventory: CanonicalFrameInventory = {
    documentKey: input.documentKey,
    editorStructureEpoch: input.editorStructureEpoch,
    semanticRevision: input.semanticRevision,
    committedFrameGeneration: decision === 'COHERENT' ? input.frameGeneration : input.frameGeneration - 1,
    semanticHeadingCount: semanticKeys.length,
    bindingHeadingCount: bindingKeys.length,
    canonicalEntryCount: decision === 'COHERENT' ? bindingKeys.length : 0,
    semanticIdentityCount: semanticSet.size,
    bindingIdentityCount: bindingSet.size,
    semanticOnlyIdentityCount: semanticOnlyIdentities.length,
    bindingOnlyIdentityCount: bindingOnlyIdentities.length,
    semanticOnlyIdentities,
    bindingOnlyIdentities,
    duplicateSemanticIdentities,
    duplicateBindingIdentities,
    decision,
  }

  const verbose = forensicVerboseEnabled()
  // Phase 7R.3.11.8B.2 — state-token dedup: identical inventory + decision
  // repeats are suppressed; transitions / failures / verbose always emit.
  const inventorySignature = `${input.documentKey ?? ''}|${decision}|${inventory.semanticHeadingCount}|${inventory.bindingHeadingCount}|${inventory.canonicalEntryCount}|${inventory.committedFrameGeneration}|${inventory.duplicateSemanticIdentities.length}|${inventory.duplicateBindingIdentities.length}`
  if (verbose || decision !== 'COHERENT' || inventorySignature !== lastCanonicalFrameInventorySignature) {
    lastCanonicalFrameInventorySignature = inventorySignature
    emitRuntimeAudit('HEADING-CANONICAL-FRAME-INVENTORY', {
      documentKey: input.documentKey ?? null,
      editorStructureEpoch: input.editorStructureEpoch,
      semanticRevision: input.semanticRevision,
      committedFrameGeneration: inventory.committedFrameGeneration,
      semanticHeadingCount: inventory.semanticHeadingCount,
      bindingHeadingCount: inventory.bindingHeadingCount,
      canonicalEntryCount: inventory.canonicalEntryCount,
      semanticIdentityCount: inventory.semanticIdentityCount,
      bindingIdentityCount: inventory.bindingIdentityCount,
      semanticOnlyIdentityCount: inventory.semanticOnlyIdentityCount,
      bindingOnlyIdentityCount: inventory.bindingOnlyIdentityCount,
      ...(verbose || decision !== 'COHERENT' ? {
        semanticOnlyIdentities: inventory.semanticOnlyIdentities.slice(0, 24),
        bindingOnlyIdentities: inventory.bindingOnlyIdentities.slice(0, 24),
        duplicateSemanticIdentities: inventory.duplicateSemanticIdentities.slice(0, 12),
        duplicateBindingIdentities: inventory.duplicateBindingIdentities.slice(0, 12),
      } : {}),
      decision,
    })
  }

  if (decision !== 'COHERENT') {
    return { decision, frame: null, inventory }
  }

  const semanticByKey = new Map(input.semantic.map(s => [s.stableIdentity, s]))
  const entries: CanonicalHeadingEntry[] = []
  for (const b of input.bindings) {
    const semanticState = semanticByKey.get(b.key)
    if (!semanticState) continue // cannot happen when COHERENT
    entries.push({ stableIdentity: b.key, element: b.element, semanticState })
  }
  const entryByIdentity = new Map(entries.map(e => [e.stableIdentity, e]))
  const frame: CanonicalHeadingFrame = {
    documentKey: input.documentKey ?? '',
    semanticRevision: input.semanticRevision,
    editorStructureEpoch: input.editorStructureEpoch,
    frameGeneration: input.frameGeneration,
    semanticFingerprint: fastHash(input.semantic.map(s => s.stableIdentity).join('|')),
    frameFingerprint: computeCanonicalFrameFingerprint(entries),
    entries,
    entryByIdentity,
  }
  return { decision, frame, inventory }
}

/**
 * Nearest preceding connected CanonicalHeadingEntry for a target, using DOM
 * document-order relation semantics. Returns the JOINED entry atomically
 * (element + stableIdentity + semanticState) — no second semantic lookup.
 */
export function resolvePrecedingHeading(
  target: HTMLElement,
  frame: CanonicalHeadingFrame | null,
  editorRoot: HTMLElement | null,
): CanonicalHeadingEntry | null {
  if (!frame || frame.entries.length === 0) return null
  if (!target.isConnected || !editorRoot || !editorRoot.contains(target)) return null
  let candidate: CanonicalHeadingEntry | null = null
  for (const entry of frame.entries) {
    const el = entry.element
    if (!el.isConnected || !editorRoot.contains(el)) continue
    if (el.compareDocumentPosition(target) & 4 /* DOCUMENT_POSITION_FOLLOWING */) {
      candidate = entry
    } else {
      break
    }
  }
  return candidate
}
