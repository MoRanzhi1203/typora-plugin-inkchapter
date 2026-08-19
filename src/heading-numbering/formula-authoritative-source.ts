/**
 * v2.5.7-R5.4.2: Authoritative Live Formula Source Authority.
 *
 * Each stable formula carries its OWN authoritative TeX source state keyed by
 * (stableFormulaIdentity + formulaContentRevision). formulaContentRevision only
 * advances on a REAL user TeX edit; renderer DOM replacement, edit-state
 * enter/exit, MathJax output, visible-text updates and other-formula insertions
 * can NEVER overwrite the authoritative source (source drift barrier).
 *
 * Source candidates are classified:
 *   AUTHORITATIVE  - raw source node / raw-block container (user semantic state)
 *   VERIFIER_ONLY  - verifier fallback (may capture, lower confidence)
 *   RENDERED_TEXT  - contains native number / visual render text → BLOCKED
 *   AMBIGUOUS      - cannot decide
 *   UNAVAILABLE    - no usable source yet
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { tokenFor } from './mathjax-native-tag-injection'
import { resolveStableFormulaIdentity, type MutationClassification } from './formula-live-revision'
import { checkSourceCommitBarrier, getActiveEditSession } from './formula-edit-session'
import type { FormulaTexSourceKind } from './formula-tex-source-verifier'
import type { FormulaRenderAuthorizationPlan } from './mathjax-tex2svg-tag-injection'

export const R542_RUNTIME_MARKER = 'FORMULA-LIVE-SOURCE-RENDERER-AUTHORITY-V2.5.7-R5.4.2'
export const R542_BUILD_MARKER = 'inkchapter-formula-live-source-renderer-authority-v2.5.7-r5.4.2'

// ── Candidate Classification ───────────────────────────────────────────

export type FormulaSourceCandidateClassification =
  | 'AUTHORITATIVE'
  | 'VERIFIER_ONLY'
  | 'RENDERED_TEXT'
  | 'AMBIGUOUS'
  | 'UNAVAILABLE'

/** Native equation-number / rendered-visual prefix, e.g. "(1)y^t+1=..." */
const RENDERED_LABEL_RE = /^\s*\(\d+(?:[.\-]\d+)*\)\s*/
const EMPTY_BLOCK_RE = /<Empty[\s\S]*?Block>/

export function classifyFormulaSourceCandidate(input: {
  candidateSourceKind: FormulaTexSourceKind
  candidateRawSource: string
  candidateHash: string
}): { classification: FormulaSourceCandidateClassification; reason: string | null } {
  const raw = (input.candidateRawSource ?? '').trim()
  if (!input.candidateHash || input.candidateSourceKind === 'UNAVAILABLE') {
    return { classification: 'UNAVAILABLE', reason: 'NO_SOURCE_AVAILABLE' }
  }
  if (raw.length === 0 || EMPTY_BLOCK_RE.test(raw)) {
    return { classification: 'UNAVAILABLE', reason: 'EMPTY_OR_PLACEHOLDER' }
  }
  if (RENDERED_LABEL_RE.test(raw)) {
    return { classification: 'RENDERED_TEXT', reason: 'NATIVE_NUMBER_OR_VISUAL_TEXT' }
  }
  if (input.candidateSourceKind === 'FORMULA_HOST_RAW_SOURCE_NODE' || input.candidateSourceKind === 'RAWBLOCK_SOURCE_CONTAINER') {
    return { classification: 'AUTHORITATIVE', reason: null }
  }
  return { classification: 'VERIFIER_ONLY', reason: 'VERIFIER_FALLBACK_SOURCE' }
}

// ── State ──────────────────────────────────────────────────────────────

export interface AuthoritativeFormulaSourceState {
  documentKey: string
  stableFormulaIdentity: number
  formulaContentRevision: number
  authoritativeSourceKind: FormulaTexSourceKind
  authoritativeRawSource: string
  normalizedSource: string
  normalizedSourceHash: string
  sourceCapturedFromUserSemanticState: boolean
  lastAcceptedAtLiveFormulaRevision: number
  lastObservedVisualSourceHash: string
  lastObservedRuntimeSourceHash: string
  decision: 'AUTHORITATIVE' | 'PENDING_CAPTURE' | 'BLOCKED_DRIFT' | 'UNAVAILABLE'
}

const sourceStateRegistry = new Map<string, AuthoritativeFormulaSourceState>()

/** Drift stats consumed by the live-revision noise authority. */
let driftObservedCount = 0
let blockedOverwriteCount = 0

export function resetAuthoritativeSourceStates(): void {
  sourceStateRegistry.clear()
  driftObservedCount = 0
  blockedOverwriteCount = 0
}

export function getAuthoritativeSourceState(documentKey: string, stableFormulaIdentity: number): AuthoritativeFormulaSourceState | null {
  return sourceStateRegistry.get(`${documentKey}|${stableFormulaIdentity}`) ?? null
}

export function getAndResetSourceDriftStats(): { driftObservedCount: number; blockedOverwriteCount: number } {
  const stats = { driftObservedCount, blockedOverwriteCount }
  driftObservedCount = 0
  blockedOverwriteCount = 0
  return stats
}

// ── Update / Capture ───────────────────────────────────────────────────

export interface AuthoritativeSourceUpdateInput {
  documentKey: string
  stableFormulaIdentity: number
  formulaIndex: number
  liveFormulaRevision: number
  candidateSourceKind: FormulaTexSourceKind
  candidateRawSource: string
  candidateNormalized: string
  candidateHash: string
  candidatePrefix: string
  mutationClassification: MutationClassification
  editState: 'EDIT' | 'NON_EDIT' | 'UNKNOWN'
  /**
   * R5.4.3.21 P0-B/C: provenance of the candidate. When the exact current
   * block formula host + Store identity rebind prove a REAL user edit (same
   * tex2svg current edit), 'CURRENT_USER_EDIT' bypasses the non-input edit
   * barrier and advances the SINGLE authoritative source revision.
   */
  provenance?: 'CURRENT_USER_EDIT' | 'TYPORA_CANONICAL_SOURCE'
}

export interface AuthoritativeSourceUpdateResult {
  state: AuthoritativeFormulaSourceState | null
  candidateClassification: FormulaSourceCandidateClassification
  userSemanticSourceChange: boolean
  authoritativeSourceUpdated: boolean
  contentRevisionChanged: boolean
  overwriteBlocked: boolean
  driftObserved: boolean
}

/**
 * Evaluate a live source candidate against the per-identity authoritative
 * state. Emits FORMULA-AUTHORITATIVE-SOURCE-AUTHORITY and, when applicable,
 * FORMULA-CONTENT-REVISION-AUTHORITY + FORMULA-AUTHORITATIVE-SOURCE-DRIFT-BARRIER.
 */
export function captureOrUpdateAuthoritativeSource(input: AuthoritativeSourceUpdateInput): AuthoritativeSourceUpdateResult {
  const key = `${input.documentKey}|${input.stableFormulaIdentity}`
  const prev = sourceStateRegistry.get(key) ?? null
  const cls = classifyFormulaSourceCandidate({
    candidateSourceKind: input.candidateSourceKind,
    candidateRawSource: input.candidateRawSource,
    candidateHash: input.candidateHash,
  })

  const result: AuthoritativeSourceUpdateResult = {
    state: prev,
    candidateClassification: cls.classification,
    userSemanticSourceChange: false,
    authoritativeSourceUpdated: false,
    contentRevisionChanged: false,
    overwriteBlocked: false,
    driftObserved: false,
  }

  const sameHash = prev !== null && prev.normalizedSourceHash === input.candidateHash

  if (cls.classification === 'UNAVAILABLE' || cls.classification === 'AMBIGUOUS') {
    emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-AUTHORITY', {
      documentKey: input.documentKey,
      stableFormulaIdentity: input.stableFormulaIdentity,
      formulaIndex: input.formulaIndex,
      formulaContentRevision: prev?.formulaContentRevision ?? 0,
      candidateSourceKind: input.candidateSourceKind,
      candidateHash: input.candidateHash,
      previousAuthoritativeHash: prev?.normalizedSourceHash ?? null,
      nextAuthoritativeHash: prev?.normalizedSourceHash ?? null,
      candidateClassification: cls.classification,
      userSemanticSourceChange: false,
      authoritativeSourceUpdated: false,
      decision: 'UNAVAILABLE',
      reason: cls.reason,
      runtimeMarker: R542_RUNTIME_MARKER,
    })
    return result
  }

  if (cls.classification === 'RENDERED_TEXT') {
    if (prev && !sameHash) {
      driftObservedCount++
      blockedOverwriteCount++
      result.driftObserved = true
      result.overwriteBlocked = true
      emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-DRIFT-BARRIER', {
        stableFormulaIdentity: input.stableFormulaIdentity,
        formulaContentRevision: prev.formulaContentRevision,
        authoritativeHash: prev.normalizedSourceHash,
        observedCandidateHash: input.candidateHash,
        observedCandidateKind: input.candidateSourceKind,
        rendererOrEditStateMutation: true,
        sameFormulaContentRevision: true,
        overwriteAttempted: true,
        overwriteBlocked: true,
        decision: 'PASS',
        reason: 'RENDERED_TEXT_BLOCKED',
        runtimeMarker: R542_RUNTIME_MARKER,
      })
    }
    emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-AUTHORITY', {
      documentKey: input.documentKey,
      stableFormulaIdentity: input.stableFormulaIdentity,
      formulaIndex: input.formulaIndex,
      formulaContentRevision: prev?.formulaContentRevision ?? 0,
      candidateSourceKind: input.candidateSourceKind,
      candidateHash: input.candidateHash,
      previousAuthoritativeHash: prev?.normalizedSourceHash ?? null,
      nextAuthoritativeHash: prev?.normalizedSourceHash ?? null,
      candidateClassification: 'RENDERED_TEXT',
      userSemanticSourceChange: false,
      authoritativeSourceUpdated: false,
      decision: 'RENDERED_TEXT_BLOCKED',
      reason: cls.reason,
      runtimeMarker: R542_RUNTIME_MARKER,
    })
    return result
  }

  // AUTHORITATIVE | VERIFIER_ONLY — may update the authoritative source.
  if (!prev) {
    // First capture: only accept AUTHORITATIVE (user semantic state); a
    // VERIFIER_ONLY first capture could freeze a transient fallback.
    if (cls.classification !== 'AUTHORITATIVE') {
      emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-AUTHORITY', {
        documentKey: input.documentKey,
        stableFormulaIdentity: input.stableFormulaIdentity,
        formulaIndex: input.formulaIndex,
        formulaContentRevision: 0,
        candidateSourceKind: input.candidateSourceKind,
        candidateHash: input.candidateHash,
        previousAuthoritativeHash: null,
        nextAuthoritativeHash: null,
        candidateClassification: cls.classification,
        userSemanticSourceChange: false,
        authoritativeSourceUpdated: false,
        decision: 'PENDING_CAPTURE',
        reason: 'WAITING_FOR_AUTHORITATIVE_CANDIDATE',
        runtimeMarker: R542_RUNTIME_MARKER,
      })
      return result
    }
    const state: AuthoritativeFormulaSourceState = {
      documentKey: input.documentKey,
      stableFormulaIdentity: input.stableFormulaIdentity,
      formulaContentRevision: 1,
      authoritativeSourceKind: input.candidateSourceKind,
      authoritativeRawSource: input.candidateRawSource,
      normalizedSource: input.candidateNormalized,
      normalizedSourceHash: input.candidateHash,
      sourceCapturedFromUserSemanticState: true,
      lastAcceptedAtLiveFormulaRevision: input.liveFormulaRevision,
      lastObservedVisualSourceHash: input.candidateHash,
      lastObservedRuntimeSourceHash: input.candidateHash,
      decision: 'AUTHORITATIVE',
    }
    sourceStateRegistry.set(key, state)
    result.state = state
    result.authoritativeSourceUpdated = true
    emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-AUTHORITY', {
      documentKey: input.documentKey,
      stableFormulaIdentity: input.stableFormulaIdentity,
      formulaIndex: input.formulaIndex,
      formulaContentRevision: 1,
      candidateSourceKind: input.candidateSourceKind,
      candidateHash: input.candidateHash,
      previousAuthoritativeHash: null,
      nextAuthoritativeHash: input.candidateHash,
      candidateClassification: 'AUTHORITATIVE',
      userSemanticSourceChange: false,
      authoritativeSourceUpdated: true,
      decision: 'CAPTURED',
      reason: null,
      runtimeMarker: R542_RUNTIME_MARKER,
    })
    return result
  }

  // Existing state — refresh the observed hashes.
  const next: AuthoritativeFormulaSourceState = {
    ...prev,
    lastObservedVisualSourceHash: input.candidateHash,
    lastObservedRuntimeSourceHash: input.candidateHash,
  }

  if (sameHash) {
    sourceStateRegistry.set(key, next)
    result.state = next
    emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-AUTHORITY', {
      documentKey: input.documentKey,
      stableFormulaIdentity: input.stableFormulaIdentity,
      formulaIndex: input.formulaIndex,
      formulaContentRevision: prev.formulaContentRevision,
      candidateSourceKind: input.candidateSourceKind,
      candidateHash: input.candidateHash,
      previousAuthoritativeHash: prev.normalizedSourceHash,
      nextAuthoritativeHash: prev.normalizedSourceHash,
      candidateClassification: cls.classification,
      userSemanticSourceChange: false,
      authoritativeSourceUpdated: false,
      decision: 'STABLE',
      reason: null,
      runtimeMarker: R542_RUNTIME_MARKER,
    })
    return result
  }

  // Hash differs. R5.4.3.8 P1/P2: the edit-session source commit barrier runs
  // FIRST. Click / focus / startEditing / CodeMirror-mount / rawblock-mount /
  // MJX-replacement are NONSEMANTIC — while the SAME latched edit session has
  // explicitInputObserved=false, the authoritative source can NEVER be
  // overwritten, regardless of mutation classification or edit state.
  const activeSession = getActiveEditSession()
  const sessionTargetsThisIdentity = !!activeSession
    && activeSession.documentKey === input.documentKey
    && activeSession.stableFormulaIdentity === input.stableFormulaIdentity
  // R5.4.3.21 P0-B/C: a proven CURRENT_USER_EDIT (exact block host + Store
  // identity rebind + current tex2svg input) is REAL user input — it must
  // bypass the non-input edit barrier so the SINGLE source revision advances.
  const isProvenUserEdit = input.provenance === 'CURRENT_USER_EDIT'
  if (sessionTargetsThisIdentity && !isProvenUserEdit) {
    const barrier = checkSourceCommitBarrier({
      sessionId: activeSession!.sessionId,
      stableFormulaIdentity: input.stableFormulaIdentity,
      formulaIndex: input.formulaIndex,
      eventKind: input.mutationClassification,
      explicitInputObserved: activeSession!.explicitInputObserved,
      sourceHashBefore: prev.normalizedSourceHash,
      candidateSourceHash: input.candidateHash,
      contentRevisionBefore: prev.formulaContentRevision,
    })
    if (!barrier.commitAllowed) {
      driftObservedCount++
      blockedOverwriteCount++
      result.driftObserved = true
      result.overwriteBlocked = true
      sourceStateRegistry.set(key, next)
      result.state = next
      emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-DRIFT-BARRIER', {
        stableFormulaIdentity: input.stableFormulaIdentity,
        formulaContentRevision: prev.formulaContentRevision,
        authoritativeHash: prev.normalizedSourceHash,
        observedCandidateHash: input.candidateHash,
        observedCandidateKind: input.candidateSourceKind,
        rendererOrEditStateMutation: true,
        sameFormulaContentRevision: true,
        overwriteAttempted: true,
        overwriteBlocked: true,
        decision: 'PASS',
        reason: 'EDIT_SESSION_NO_EXPLICIT_INPUT_BLOCKED',
        runtimeMarker: R542_RUNTIME_MARKER,
      })
      emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-AUTHORITY', {
        documentKey: input.documentKey,
        stableFormulaIdentity: input.stableFormulaIdentity,
        formulaIndex: input.formulaIndex,
        formulaContentRevision: prev.formulaContentRevision,
        candidateSourceKind: input.candidateSourceKind,
        candidateHash: input.candidateHash,
        previousAuthoritativeHash: prev.normalizedSourceHash,
        nextAuthoritativeHash: prev.normalizedSourceHash,
        candidateClassification: cls.classification,
        userSemanticSourceChange: false,
        authoritativeSourceUpdated: false,
        decision: 'DRIFT_BLOCKED',
        reason: 'EDIT_SESSION_BARRIER_BLOCKED',
        runtimeMarker: R542_RUNTIME_MARKER,
      })
      return result
    }
  }

  // Only a REAL user TeX edit (real-content mutation while the
  // rawblock is in EDIT state) may advance the content revision.
  // R5.4.3.21: a proven CURRENT_USER_EDIT counts as user semantic regardless
  // of the mutation classifier (the wrapper proved the exact editing host).
  const userSemantic = isProvenUserEdit
    || input.mutationClassification === 'REAL_DOCUMENT_CONTENT'
    || input.mutationClassification === 'MIXED_CONTENT_AND_RENDERER'
  if (userSemantic && (isProvenUserEdit || input.editState === 'EDIT')) {
    const updated: AuthoritativeFormulaSourceState = {
      ...next,
      formulaContentRevision: prev.formulaContentRevision + 1,
      authoritativeSourceKind: input.candidateSourceKind,
      authoritativeRawSource: input.candidateRawSource,
      normalizedSource: input.candidateNormalized,
      normalizedSourceHash: input.candidateHash,
      lastAcceptedAtLiveFormulaRevision: input.liveFormulaRevision,
      decision: 'AUTHORITATIVE',
    }
    sourceStateRegistry.set(key, updated)
    result.state = updated
    result.userSemanticSourceChange = true
    result.contentRevisionChanged = true
    result.authoritativeSourceUpdated = true
    emitRuntimeAudit('FORMULA-CONTENT-REVISION-AUTHORITY', {
      stableFormulaIdentity: input.stableFormulaIdentity,
      previousContentRevision: prev.formulaContentRevision,
      nextContentRevision: updated.formulaContentRevision,
      mutationClassification: input.mutationClassification,
      sourceHashBefore: prev.normalizedSourceHash,
      sourceHashAfter: input.candidateHash,
      userSemanticChange: true,
      decision: 'ADVANCE',
      reason: 'USER_FORMULA_SOURCE_CHANGE',
      runtimeMarker: R542_RUNTIME_MARKER,
    })
    emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-AUTHORITY', {
      documentKey: input.documentKey,
      stableFormulaIdentity: input.stableFormulaIdentity,
      formulaIndex: input.formulaIndex,
      formulaContentRevision: updated.formulaContentRevision,
      candidateSourceKind: input.candidateSourceKind,
      candidateHash: input.candidateHash,
      previousAuthoritativeHash: prev.normalizedSourceHash,
      nextAuthoritativeHash: input.candidateHash,
      candidateClassification: cls.classification,
      userSemanticSourceChange: true,
      authoritativeSourceUpdated: true,
      decision: 'UPDATED',
      reason: null,
      runtimeMarker: R542_RUNTIME_MARKER,
    })
    return result
  }

  // Renderer / edit-state / other drift → block the overwrite.
  driftObservedCount++
  blockedOverwriteCount++
  result.driftObserved = true
  result.overwriteBlocked = true
  sourceStateRegistry.set(key, next)
  result.state = next
  emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-DRIFT-BARRIER', {
    stableFormulaIdentity: input.stableFormulaIdentity,
    formulaContentRevision: prev.formulaContentRevision,
    authoritativeHash: prev.normalizedSourceHash,
    observedCandidateHash: input.candidateHash,
    observedCandidateKind: input.candidateSourceKind,
    rendererOrEditStateMutation: input.editState !== 'EDIT' || !userSemantic,
    sameFormulaContentRevision: true,
    overwriteAttempted: true,
    overwriteBlocked: true,
    decision: 'PASS',
    reason: 'SOURCE_DRIFT_BLOCKED',
    runtimeMarker: R542_RUNTIME_MARKER,
  })
  emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-AUTHORITY', {
    documentKey: input.documentKey,
    stableFormulaIdentity: input.stableFormulaIdentity,
    formulaIndex: input.formulaIndex,
    formulaContentRevision: prev.formulaContentRevision,
    candidateSourceKind: input.candidateSourceKind,
    candidateHash: input.candidateHash,
    previousAuthoritativeHash: prev.normalizedSourceHash,
    nextAuthoritativeHash: prev.normalizedSourceHash,
    candidateClassification: cls.classification,
    userSemanticSourceChange: false,
    authoritativeSourceUpdated: false,
    decision: 'DRIFT_BLOCKED',
    reason: 'AUTHORITATIVE_SOURCE_PRESERVED',
    runtimeMarker: R542_RUNTIME_MARKER,
  })
  return result
}

// ── Phase E: Plan Source Binding ────────────────────────────────────────

/**
 * Every plan entry must bind its own stableFormulaIdentity + formulaContentRevision
 * + authoritativeSourceHash; the entry source must equal the authoritative hash.
 */
export function emitPlanSourceBindingAuthority(plan: FormulaRenderAuthorizationPlan | null, liveFormulaRevision: number): void {
  if (!plan) return
  for (const entry of plan.entries) {
    const ready = !!entry.authoritativeSourceHash && entry.authoritativeSourceHash !== ''
    const same = entry.authoritativeSourceHash === entry.normalizedSourceHash
    emitRuntimeAudit('FORMULA-PLAN-SOURCE-BINDING-AUTHORITY', {
      planRevision: plan.planRevision,
      liveFormulaRevision,
      stableFormulaIdentity: entry.stableFormulaIdentity,
      formulaContentRevision: entry.formulaContentRevision,
      authoritativeSourceReady: ready,
      authoritativeSourceHash: entry.authoritativeSourceHash,
      entrySourceHash: entry.normalizedSourceHash,
      sameSourceAuthority: same,
      decision: ready && same ? 'PASS' : 'FAIL',
      reason: ready && same ? null : (!ready ? 'AUTHORITATIVE_SOURCE_NOT_READY' : 'SOURCE_AUTHORITY_MISMATCH'),
      runtimeMarker: R542_RUNTIME_MARKER,
    })
  }
}

// ── Phase F: Editing Host Identity Resolver ─────────────────────────────

const EDITING_HOST_SELECTOR = '.md-rawblock-on-edit, .mathjax-block.md-focus, .md-math-block.md-focus'

export interface EditingHostIdentityInput {
  editorRoot: HTMLElement | null
  canonicalHosts: Array<{ host: HTMLElement; formulaIndex: number }>
  plan: FormulaRenderAuthorizationPlan | null
}

export interface EditingHostIdentityResult {
  candidateCount: number
  editingNodeToken: number | null
  canonicalHostToken: number | null
  stableFormulaIdentity: number | 'AMBIGUOUS' | null
  planEntryFound: boolean
  formulaIndex: number | null
  sourceHash: string | null
  decision: 'PASS' | 'AMBIGUOUS' | 'FAIL' | 'NONE'
  reason: string | null
}

/**
 * Map the (unique) currently-editing formula host back to its canonical host,
 * then stableFormulaIdentity → plan entry → formulaIndex. formulaIndex is NEVER
 * a primary identity — it is derived from the stable identity's plan entry.
 */
export function resolveCurrentEditingFormulaIdentity(input: EditingHostIdentityInput): EditingHostIdentityResult {
  const empty: EditingHostIdentityResult = {
    candidateCount: 0,
    editingNodeToken: null,
    canonicalHostToken: null,
    stableFormulaIdentity: null,
    planEntryFound: false,
    formulaIndex: null,
    sourceHash: null,
    decision: 'NONE',
    reason: 'NO_EDITING_HOST',
  }
  if (!input.editorRoot) return empty
  let editingHosts: HTMLElement[]
  try {
    editingHosts = Array.from(input.editorRoot.querySelectorAll<HTMLElement>(EDITING_HOST_SELECTOR))
  } catch {
    return empty
  }
  if (editingHosts.length === 0) return empty

  let result: EditingHostIdentityResult
  if (editingHosts.length > 1) {
    result = {
      candidateCount: editingHosts.length,
      editingNodeToken: null,
      canonicalHostToken: null,
      stableFormulaIdentity: 'AMBIGUOUS',
      planEntryFound: false,
      formulaIndex: null,
      sourceHash: null,
      decision: 'AMBIGUOUS',
      reason: 'MULTIPLE_EDITING_HOSTS',
    }
    emitEditingHostIdentityAuthority(result)
    return result
  }

  const editingNode = editingHosts[0]
  const editingNodeToken = tokenFor(editingNode)
  const match = input.canonicalHosts.find((c) => c.host === editingNode || c.host.contains(editingNode) || editingNode.contains(c.host))
  if (!match) {
    result = {
      candidateCount: 1,
      editingNodeToken,
      canonicalHostToken: null,
      stableFormulaIdentity: null,
      planEntryFound: false,
      formulaIndex: null,
      sourceHash: null,
      decision: 'FAIL',
      reason: 'EDITING_HOST_OUTSIDE_CANONICAL_SET',
    }
    emitEditingHostIdentityAuthority(result)
    return result
  }

  const identity = resolveStableFormulaIdentity(match.host)
  const planEntry = input.plan?.entries.find((e) => e.stableFormulaIdentity === identity) ?? null
  result = {
    candidateCount: 1,
    editingNodeToken,
    canonicalHostToken: tokenFor(match.host),
    stableFormulaIdentity: identity,
    planEntryFound: !!planEntry,
    formulaIndex: planEntry?.formulaIndex ?? null,
    sourceHash: planEntry?.authoritativeSourceHash ?? planEntry?.normalizedSourceHash ?? null,
    decision: planEntry ? 'PASS' : 'FAIL',
    reason: planEntry ? null : 'PLAN_ENTRY_NOT_FOUND',
  }
  emitEditingHostIdentityAuthority(result)
  return result
}

function emitEditingHostIdentityAuthority(result: EditingHostIdentityResult): void {
  emitRuntimeAudit('FORMULA-EDITING-HOST-IDENTITY-AUTHORITY', {
    currentEditingFormulaCandidateCount: result.candidateCount,
    editingNodeToken: result.editingNodeToken,
    canonicalHostToken: result.canonicalHostToken,
    stableFormulaIdentity: result.stableFormulaIdentity,
    planEntryFound: result.planEntryFound,
    formulaIndex: result.formulaIndex,
    sourceHash: result.sourceHash,
    decision: result.decision,
    reason: result.reason,
    runtimeMarker: R542_RUNTIME_MARKER,
  })
}

// ── Phase Y: Live Source Renderer Final ────────────────────────────────

export interface LiveSourceRendererFinalInput {
  documentKey: string
  liveFormulaRevision: number
  stableFormulaCount: number
  authoritativeSourceReadyCount: number
  authoritativeSourceDriftCount: number
  contentRevisionCount: number
  existingSourceRegressionCount: number
  editingHostIdentityPass: boolean
  catchupObservedCount: number
  postCatchupContextRebindPassCount: number
  catchupAuthorizedCount: number
  catchupNotAuthorizedCount: number
  newFormulaCatchupPass: boolean
  affectedCount: number
  completedCount: number
  pendingCount: number
  blockedCount: number
  failedCount: number
  safeSkippedCount: number
  unresolvedCount: number
  typoraRendererCallsiteAuthority: string
  typoraRendererTriggerName: string | null
  rendererInvalidationClosurePass: boolean
  allDesiredTagsVisible: boolean
  duplicateOutputCount: number
  sourceMutationDetected: boolean
  rendererFeedbackLoopCount: number
}

export function emitLiveSourceRendererFinal(input: LiveSourceRendererFinalInput): void {
  const decision = input.authoritativeSourceDriftCount === 0
    && input.existingSourceRegressionCount === 0
    && input.editingHostIdentityPass
    && input.postCatchupContextRebindPassCount > 0
    && input.newFormulaCatchupPass
    && input.unresolvedCount === 0
    && input.typoraRendererCallsiteAuthority === 'PASS'
    && input.rendererInvalidationClosurePass
    && input.allDesiredTagsVisible
    && input.duplicateOutputCount === 0
    && !input.sourceMutationDetected
    && input.rendererFeedbackLoopCount === 0
    ? 'PASS'
    : 'PARTIAL'
  emitRuntimeAudit('FORMULA-LIVE-SOURCE-RENDERER-FINAL', {
    documentKey: input.documentKey,
    liveFormulaRevision: input.liveFormulaRevision,
    stableFormulaCount: input.stableFormulaCount,
    authoritativeSourceReadyCount: input.authoritativeSourceReadyCount,
    authoritativeSourceDriftCount: input.authoritativeSourceDriftCount,
    contentRevisionCount: input.contentRevisionCount,
    existingSourceRegressionCount: input.existingSourceRegressionCount,
    editingHostIdentityPass: input.editingHostIdentityPass,
    catchupObservedCount: input.catchupObservedCount,
    postCatchupContextRebindPassCount: input.postCatchupContextRebindPassCount,
    catchupAuthorizedCount: input.catchupAuthorizedCount,
    catchupNotAuthorizedCount: input.catchupNotAuthorizedCount,
    newFormulaCatchupPass: input.newFormulaCatchupPass,
    affectedCount: input.affectedCount,
    completedCount: input.completedCount,
    pendingCount: input.pendingCount,
    blockedCount: input.blockedCount,
    failedCount: input.failedCount,
    safeSkippedCount: input.safeSkippedCount,
    unresolvedCount: input.unresolvedCount,
    typoraRendererCallsiteAuthority: input.typoraRendererCallsiteAuthority,
    typoraRendererTriggerName: input.typoraRendererTriggerName,
    rendererInvalidationClosurePass: input.rendererInvalidationClosurePass,
    allDesiredTagsVisible: input.allDesiredTagsVisible,
    duplicateOutputCount: input.duplicateOutputCount,
    sourceMutationDetected: input.sourceMutationDetected,
    rendererFeedbackLoopCount: input.rendererFeedbackLoopCount,
    decision,
    reason: decision === 'PASS' ? null : 'LIVE_UPDATE_CLOSURE_INCOMPLETE',
    runtimeMarker: R542_RUNTIME_MARKER,
  })
}
