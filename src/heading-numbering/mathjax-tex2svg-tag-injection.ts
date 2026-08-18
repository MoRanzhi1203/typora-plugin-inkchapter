/**
 * v2.5.7-R5.4: Proven tex2svgPromise Pre-call Formula Authority +
 * Guarded Native Tag Injection.
 *
 * On the proven Typora render route MathJax.tex2svgPromise, establish a
 * PRE-CALL formula identity authority for Formula0 / Formula1 (from the R5.1
 * managed plan) and — ONLY when exactly one formula is uniquely authorized —
 * temporarily forward `<original TeX>\tag{<desiredTag>}` to MathJax so Typora
 * itself generates the native tag. Markdown / TeX source is NEVER modified.
 *
 * Safety:
 *   * non-target math (inline, R^2, other display, edit preview) → 100% pass-through
 *   * user explicit \tag / \tag* / \notag / \nonumber → pass-through
 *   * no CALL_ORDINAL_AUTHORITY, no hardcoded desiredTag, no DOM overlay,
 *     no duplicate output, no typesetClear/typesetPromise
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import {
  verifyFormulaTexSource,
  normalizeTexSource,
  simpleHash,
  type FormulaTexSourceKind,
} from './formula-tex-source-verifier'
import { R541_RUNTIME_MARKER } from './formula-live-revision'
import { R542_RUNTIME_MARKER } from './formula-authoritative-source'
import { R543_RUNTIME_MARKER } from './formula-semantic-invalidation'
import { reportObservedInvalidationClosure } from './typora-formula-render-invalidation'
import {
  isEmptyFormulaSentinel,
  emitEmptyTex2svgSentinelAuthority,
  getActiveEditSession,
  latchEditSession,
  emitEditSessionTex2svgAuthority,
  emitNonsemanticEditTransition,
  checkSourceCommitBarrier,
  markSessionExplicitInput,
  type SourceCommitBarrierResult,
} from './formula-edit-session'

export const R54_RUNTIME_MARKER = 'FORMULA-TEX2SVG-PRECALL-TAG-INJECTION-V2.5.7-R5.4'
export const R54_BUILD_MARKER = 'inkchapter-formula-tex2svg-precall-tag-injection-v2.5.7-r5.4'

// ── Types ───────────────────────────────────────────────────────────────

export type PreCallAuthorityKind =
  | 'EXACT_NORMALIZED_SOURCE_MATCH'
  | 'CURRENT_EDITING_HOST_PLUS_EXACT_SOURCE_MATCH'
  | 'CALLER_CONTEXT_HOST_PLUS_EXACT_SOURCE_MATCH'
  | 'FROZEN_PLAN_SOURCE_MATCH'
  // v2.5.7-R5.4.2 Phase I hierarchy.
  | 'EDITING_HOST_STABLE_IDENTITY_PLUS_SOURCE_MATCH'
  | 'STABLE_IDENTITY_AUTHORITATIVE_SOURCE_MATCH'
  | 'EXACT_AUTHORITATIVE_SOURCE_MATCH'
  // v2.5.7-R5.4.3.8: empty formula sentinel authorized by host/session identity.
  | 'EMPTY_FORMULA_SLOT_IDENTITY'
  | 'CALLER_CONTEXT_HOST_PLUS_AUTHORITATIVE_SOURCE_MATCH'
  | 'NONE'
  | 'AMBIGUOUS'

export type PreCallDecision = 'AUTHORIZED' | 'AUTHORIZED_AFTER_CATCHUP' | 'PASS_THROUGH' | 'BLOCK_AMBIGUOUS'

export interface FormulaRenderAuthorizationPlanEntry {
  documentKey: string
  documentPath: string
  documentSourceRevision: number
  documentSourceSha256: string
  planRevision: number
  planCreatedAtGeneration: number
  formulaIndex: number
  formulaHostTokenAtPlanTime: number
  desiredTag: string
  expectedVisibleLabel: string
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  sequenceValue: number | null
  sourceKind: FormulaTexSourceKind
  rawSourceLength: number
  normalizedSourceLength: number
  normalizedSourceHash: string
  normalizedSourcePrefix: string
  explicitTagControl: boolean
  managedEligible: boolean
  authorizationState: 'READY' | 'NOT_READY'
  /** v2.5.7-R5.4.2: per-identity plan binding (stable identity is NOT the index). */
  stableFormulaIdentity: number | null
  formulaContentRevision: number
  authoritativeSourceHash: string
}

export interface FormulaRenderAuthorizationPlan {
  documentKey: string
  documentSourceSha256: string
  documentSourceRevision: number
  planRevision: number
  /** Live editor dirty-buffer formula revision this plan is bound to. */
  planLiveFormulaRevision: number
  /** Semantic signature this plan is bound to. */
  planSemanticSignature: string
  entries: FormulaRenderAuthorizationPlanEntry[]
}

export interface ManagedFormulaPlanInput {
  host: HTMLElement
  formulaIndex: number
  desiredTag: string
  chapterOrdinal?: number | null
  sectionOrdinal?: number | null
  sequenceValue?: number | null
}

// ── Explicit Tag Control Detection ─────────────────────────────────────

export interface ExplicitTagControlResult {
  tagFound: boolean
  tagStarFound: boolean
  notagFound: boolean
  nonumberFound: boolean
  decision: 'PASS' | 'SKIP_EXPLICIT_TAG_CONTROL'
}

/** Conservative \tag / \tag* / \notag / \nonumber detection. */
export function detectExplicitTagControl(input: string): ExplicitTagControlResult {
  const result: ExplicitTagControlResult = {
    tagFound: false,
    tagStarFound: false,
    notagFound: false,
    nonumberFound: false,
    decision: 'PASS',
  }
  // Strip TeX comments (from % to end of line) — keep a newline marker.
  const body = input.replace(/(^|[^\\])%.*(\n|$)/g, '$1$2')
  const pattern = /\\(tag\*?|notag|nonumber)(?![a-zA-Z])/g
  let m: RegExpExecArray | null
  while ((m = pattern.exec(body)) !== null) {
    const before = body[m.index - 1]
    if (before === '\\') continue // escaped — not a command
    if (m[1] === 'tag') result.tagFound = true
    else if (m[1] === 'tag*') result.tagStarFound = true
    else if (m[1] === 'notag') result.notagFound = true
    else if (m[1] === 'nonumber') result.nonumberFound = true
  }
  const anyControl = result.tagFound || result.tagStarFound || result.notagFound || result.nonumberFound
  if (anyControl) result.decision = 'SKIP_EXPLICIT_TAG_CONTROL'
  return result
}

// ── Injected TeX Builder ────────────────────────────────────────────────

const COMPLEX_STRUCTURE_RE = /\\begin\s*\{[^}]*\}/

export function detectComplexTexStructure(input: string): boolean {
  return COMPLEX_STRUCTURE_RE.test(input)
}

export interface InjectedTexResult {
  injectedTex: string
  tagInserted: boolean
  insertedTag: string | null
  decision: 'INJECT' | 'PASS_THROUGH'
  reason: string | null
}

/**
 * Append \tag{desiredTag} to the OUTERMOST END of the display TeX.
 * Never wraps the tag in parentheses; MathJax's native tag pipeline forms
 * (5.3.1). No parentheses in desiredTag.
 */
export function buildInjectedTex(originalTex: string, desiredTag: string): InjectedTexResult {
  if (detectComplexTexStructure(originalTex)) {
    return { injectedTex: originalTex, tagInserted: false, insertedTag: null, decision: 'PASS_THROUGH', reason: 'UNSUPPORTED_COMPLEX_TEX_STRUCTURE' }
  }
  const trimmed = originalTex.trim()
  const injectedTex = `${trimmed}\\tag{${desiredTag}}`
  return { injectedTex, tagInserted: true, insertedTag: desiredTag, decision: 'INJECT', reason: null }
}

// ── Authorization Plan ─────────────────────────────────────────────────

/** Frozen per (documentKey + sourceSha) — later visual host text can NEVER
 *  overwrite the frozen raw TeX snapshot (R5.4 Phase B/11). */
interface FrozenFormulaSource {
  sourceKind: FormulaTexSourceKind
  rawSourceLength: number
  normalizedSourceLength: number
  normalizedSourceHash: string
  normalizedSourcePrefix: string
}

interface FrozenPlanSource {
  documentKey: string
  documentSourceSha256: string
  byFormulaIndex: Map<number, FrozenFormulaSource>
}
const frozenPlanSources = new Map<string, FrozenPlanSource>()

export function resetFrozenPlanSources(): void {
  frozenPlanSources.clear()
}

export function buildFormulaRenderAuthorizationPlan(input: {
  managedFormulas: ManagedFormulaPlanInput[]
  documentKey: string
  documentPath: string
  documentSourceRevision: number
  documentSourceSha256: string
  planRevision: number
  generation: number
  editorRoot: HTMLElement | null
  markdown?: string | null
  planLiveFormulaRevision?: number
  planSemanticSignature?: string
  /**
   * v2.5.7-R5.4.2: per-index AUTHORITATIVE source overrides (stable identity +
   * formulaContentRevision + authoritative hash). When present, the entry uses
   * the authoritative source directly — the per-live-revision frozen re-verify
   * is REVOKED (Phase A). The frozen/verifier path remains only as a legacy
   * fallback for callers without an authoritative source.
   */
  authoritativeSourceByIndex?: Map<number, {
    stableFormulaIdentity: number | null
    formulaContentRevision: number
    hash: string
    sourceKind: FormulaTexSourceKind
    prefix: string
    rawSourceLength: number
    normalizedSourceLength: number
  }> | null
}): FormulaRenderAuthorizationPlan {
  const frozenKey = `${input.documentKey}|${input.documentSourceSha256}`
  let frozen = frozenPlanSources.get(frozenKey)

  const entries: FormulaRenderAuthorizationPlanEntry[] = []
  for (const f of input.managedFormulas) {
    const authoritative = input.authoritativeSourceByIndex?.get(f.formulaIndex) ?? null
    let sourceKind: FormulaTexSourceKind
    let rawSourceLength: number
    let normalizedSourceLength: number
    let normalizedSourceHash: string
    let normalizedSourcePrefix: string
    let verifierDecision: 'READY' | 'DEGRADED' | 'UNAVAILABLE'
    let stableFormulaIdentity: number | null = null
    let formulaContentRevision = 0

    if (authoritative) {
      // Authoritative per-identity source — stable across renderer/edit drift.
      sourceKind = authoritative.sourceKind
      rawSourceLength = authoritative.rawSourceLength
      normalizedSourceLength = authoritative.normalizedSourceLength
      normalizedSourceHash = authoritative.hash
      normalizedSourcePrefix = authoritative.prefix
      verifierDecision = authoritative.normalizedSourceLength > 0 ? 'READY' : 'UNAVAILABLE'
      stableFormulaIdentity = authoritative.stableFormulaIdentity
      formulaContentRevision = authoritative.formulaContentRevision
    } else {
      const frozenEntry = frozen?.byFormulaIndex.get(f.formulaIndex)
      if (frozenEntry) {
        sourceKind = frozenEntry.sourceKind
        rawSourceLength = frozenEntry.rawSourceLength
        normalizedSourceLength = frozenEntry.normalizedSourceLength
        normalizedSourceHash = frozenEntry.normalizedSourceHash
        normalizedSourcePrefix = frozenEntry.normalizedSourcePrefix
        verifierDecision = frozenEntry.normalizedSourceLength > 0 ? 'READY' : 'UNAVAILABLE'
      } else {
        const verifier = verifyFormulaTexSource({
          host: f.host,
          formulaIndex: f.formulaIndex,
          editorRoot: input.editorRoot,
          markdown: input.markdown,
        })
        sourceKind = verifier.sourceKind
        rawSourceLength = verifier.rawSourceLength
        normalizedSourceLength = verifier.normalizedSourceLength
        normalizedSourceHash = verifier.sourceHash
        normalizedSourcePrefix = verifier.sourcePrefix
        verifierDecision = verifier.decision
      }
    }

    entries.push({
      documentKey: input.documentKey,
      documentPath: input.documentPath,
      documentSourceRevision: input.documentSourceRevision,
      documentSourceSha256: input.documentSourceSha256,
      planRevision: input.planRevision,
      planCreatedAtGeneration: input.generation,
      formulaIndex: f.formulaIndex,
      formulaHostTokenAtPlanTime: 0,
      desiredTag: f.desiredTag,
      expectedVisibleLabel: `(${f.desiredTag})`,
      chapterOrdinal: f.chapterOrdinal ?? null,
      sectionOrdinal: f.sectionOrdinal ?? null,
      sequenceValue: f.sequenceValue ?? null,
      sourceKind,
      rawSourceLength,
      normalizedSourceLength,
      normalizedSourceHash,
      normalizedSourcePrefix,
      explicitTagControl: false,
      managedEligible: true,
      authorizationState: verifierDecision === 'UNAVAILABLE' ? 'NOT_READY' : 'READY',
      stableFormulaIdentity,
      formulaContentRevision,
      authoritativeSourceHash: authoritative?.hash ?? '',
    })
  }

  if (!frozen && !input.authoritativeSourceByIndex) {
    const byFormulaIndex = new Map<number, FrozenFormulaSource>()
    for (const e of entries) {
      byFormulaIndex.set(e.formulaIndex, {
        sourceKind: e.sourceKind,
        rawSourceLength: e.rawSourceLength,
        normalizedSourceLength: e.normalizedSourceLength,
        normalizedSourceHash: e.normalizedSourceHash,
        normalizedSourcePrefix: e.normalizedSourcePrefix,
      })
    }
    frozenPlanSources.set(frozenKey, { documentKey: input.documentKey, documentSourceSha256: input.documentSourceSha256, byFormulaIndex })
  }

  return {
    documentKey: input.documentKey,
    documentSourceSha256: input.documentSourceSha256,
    documentSourceRevision: input.documentSourceRevision,
    planRevision: input.planRevision,
    planLiveFormulaRevision: input.planLiveFormulaRevision ?? 0,
    planSemanticSignature: input.planSemanticSignature ?? '',
    entries,
  }
}

/** Atomic live plan binding authority marker. */
export function emitPlanBindingAuthority(plan: FormulaRenderAuthorizationPlan): void {
  emitRuntimeAudit('FORMULA-LIVE-PLAN-BINDING-AUTHORITY', {
    planRevision: plan.planRevision,
    liveFormulaRevision: plan.planLiveFormulaRevision,
    semanticSignature: plan.planSemanticSignature,
    formulaCount: plan.entries.length,
    entryCount: plan.entries.length,
    atomicSnapshot: true,
    decision: plan.planLiveFormulaRevision > 0 ? 'PASS' : 'PARTIAL',
    reason: plan.planLiveFormulaRevision > 0 ? null : 'LIVE_REVISION_NOT_READY',
    runtimeMarker: R541_RUNTIME_MARKER,
  })
}

// ── Pre-call Formula Identity Authority (pure) ─────────────────────────

export interface PreCallAuthorizationInput {
  plan: FormulaRenderAuthorizationPlan | null
  inputTex: string
  sameDocument: boolean
  sameSourceRevision: boolean
  formulaNumberingEnabled: boolean
  editingHostSourceHashes: string[]
  /** v2.5.7-R5.4.2: resolved editing-host stable identity (Phase F/I). */
  editingHostIdentity?: { candidateCount: number; stableFormulaIdentity: number | 'AMBIGUOUS' | null } | null
}

export interface PreCallAuthorizationResult {
  decision: PreCallDecision
  uniqueAuthorizedFormulaIndex: number | null
  authorityKind: PreCallAuthorityKind
  desiredTag: string | null
  reason: string | null
  candidateManagedFormulaCount: number
  formula0SourceHashMatch: boolean
  formula1SourceHashMatch: boolean
  inlineMathRejected: boolean
  foreignMathRejected: boolean
  /** v2.5.7-R5.4.2: stable identity of the uniquely authorized formula. */
  uniqueAuthorizedStableFormulaIdentity: number | null
}

export function resolvePreCallAuthorization(input: PreCallAuthorizationInput): PreCallAuthorizationResult {
  const result: PreCallAuthorizationResult = {
    decision: 'PASS_THROUGH',
    uniqueAuthorizedFormulaIndex: null,
    authorityKind: 'NONE',
    desiredTag: null,
    reason: null,
    candidateManagedFormulaCount: 0,
    formula0SourceHashMatch: false,
    formula1SourceHashMatch: false,
    inlineMathRejected: false,
    foreignMathRejected: false,
    uniqueAuthorizedStableFormulaIdentity: null,
  }

  if (!input.plan) {
    result.reason = 'AUTHORIZATION_PLAN_NOT_READY'
    return result
  }
  if (!input.formulaNumberingEnabled) {
    result.reason = 'FORMULA_NUMBERING_DISABLED'
    return result
  }
  if (!input.sameDocument) {
    result.reason = 'STALE_OR_FOREIGN_DOCUMENT'
    return result
  }
  if (!input.sameSourceRevision) {
    result.reason = 'STALE_SOURCE_REVISION'
    return result
  }
  if (detectComplexTexStructure(input.inputTex)) {
    result.reason = 'UNSUPPORTED_COMPLEX_TEX_STRUCTURE'
    return result
  }
  const explicit = detectExplicitTagControl(input.inputTex)
  if (explicit.decision === 'SKIP_EXPLICIT_TAG_CONTROL') {
    result.reason = 'EXPLICIT_TAG_CONTROL'
    return result
  }

  const inputHash = simpleHash(normalizeTexSource(input.inputTex))
  const ready = input.plan.entries.filter((e) => e.authorizationState === 'READY' && e.managedEligible)
  result.candidateManagedFormulaCount = ready.length

  const f0 = ready.find((e) => e.formulaIndex === 0)
  const f1 = ready.find((e) => e.formulaIndex === 1)
  result.formula0SourceHashMatch = !!f0 && (f0.authoritativeSourceHash || f0.normalizedSourceHash) === inputHash
  result.formula1SourceHashMatch = !!f1 && (f1.authoritativeSourceHash || f1.normalizedSourceHash) === inputHash

  // R5.4.1/R5.4.2: match ANY ready managed formula by its AUTHORITATIVE source
  // hash (falling back to the entry hash when no authoritative binding exists).
  const matches = ready.filter((e) => (e.authoritativeSourceHash && e.authoritativeSourceHash !== '' ? e.authoritativeSourceHash : e.normalizedSourceHash) === inputHash)

  if (matches.length === 1) {
    const entry = matches[0]
    if (!entry?.desiredTag) {
      result.decision = 'PASS_THROUGH'
      result.authorityKind = 'NONE'
      result.reason = 'DESIRED_TAG_NOT_READY'
      return result
    }
    result.decision = 'AUTHORIZED'
    result.uniqueAuthorizedFormulaIndex = entry.formulaIndex
    result.authorityKind = entry.stableFormulaIdentity != null && entry.authoritativeSourceHash !== ''
      ? 'STABLE_IDENTITY_AUTHORITATIVE_SOURCE_MATCH'
      : 'EXACT_NORMALIZED_SOURCE_MATCH'
    result.desiredTag = entry.desiredTag
    result.uniqueAuthorizedStableFormulaIdentity = entry.stableFormulaIdentity
    result.reason = null
    return result
  }
  if (matches.length > 1) {
    // Identical sources — disambiguate via the resolved editing-host identity
    // (stable identity → plan entry → formulaIndex).
    const editingIdentity = input.editingHostIdentity
    if (editingIdentity && editingIdentity.candidateCount === 1 && editingIdentity.stableFormulaIdentity !== null && editingIdentity.stableFormulaIdentity !== 'AMBIGUOUS') {
      const byIdentity = matches.find((e) => e.stableFormulaIdentity === editingIdentity.stableFormulaIdentity)
      if (byIdentity && byIdentity.desiredTag) {
        result.decision = 'AUTHORIZED'
        result.uniqueAuthorizedFormulaIndex = byIdentity.formulaIndex
        result.authorityKind = 'EDITING_HOST_STABLE_IDENTITY_PLUS_SOURCE_MATCH'
        result.desiredTag = byIdentity.desiredTag
        result.uniqueAuthorizedStableFormulaIdentity = byIdentity.stableFormulaIdentity
        result.reason = null
        return result
      }
    }
    // Legacy disambiguation: unique editing host with exact source hash.
    const editingHashes = input.editingHostSourceHashes
    if (editingHashes.length === 1 && editingHashes[0] === inputHash) {
      result.decision = 'AUTHORIZED'
      result.uniqueAuthorizedFormulaIndex = null // caller must resolve host→index
      result.authorityKind = 'CURRENT_EDITING_HOST_PLUS_EXACT_SOURCE_MATCH'
      result.reason = null
      return result
    }
    result.decision = 'BLOCK_AMBIGUOUS'
    result.authorityKind = 'AMBIGUOUS'
    result.reason = 'SOURCE_MATCH_AMBIGUOUS'
    return result
  }

  result.decision = 'PASS_THROUGH'
  result.authorityKind = 'NONE'
  result.reason = 'NO_FORMULA_SOURCE_MATCH'
  result.inlineMathRejected = input.inputTex.trim().length < 4 ? true : false
  result.foreignMathRejected = true
  return result
}

// ── Runtime Context ────────────────────────────────────────────────────

export interface Tex2svgInjectionRuntimeContext {
  enabled: boolean
  plan: FormulaRenderAuthorizationPlan | null
  getWorkspaceActivePath: () => string | null
  getDocumentKey: () => string | null
  getDocumentSourceSha256: () => string | null
  getEditorRoot: () => HTMLElement | null
  getCurrentGeneration: () => number | null
  /**
   * R5.4.1: live dirty-buffer revision authority (NOT disk SHA).
   * Absent in legacy contexts → treated as "no live authority" (fresh).
   */
  getCurrentLiveFormulaRevision?: () => number | null
  getCurrentSemanticSignature?: () => string | null
  /**
   * R5.4.1: synchronously rebuild the authorization plan from the CURRENT live
   * editor and reinstall the runtime context. MUST be synchronous (no timer,
   * no polling, no active MathJax call). Returns true when the plan is rebuilt
   * and bound to the current live revision.
   */
  rebuildPlanSynchronously?: () => boolean
  /**
   * R5.4.2 Phase G: monotonically increasing context token — a NEW token proves
   * the runtime context was fully reinstalled (post-catchup rebind).
   */
  getContextToken?: () => number
  /**
   * R5.4.2 Phase F: resolve the current editing host → stable identity → plan
   * entry → formulaIndex (service-side, has canonical hosts). Read-only.
   */
  resolveEditingHostIdentity?: () => {
    candidateCount: number
    stableFormulaIdentity: number | 'AMBIGUOUS' | null
    formulaIndex: number | null
    planEntryFound: boolean
    decision: string
  } | null
}

let injectionContext: Tex2svgInjectionRuntimeContext | null = null
let planRevisionCounter = 0
let preCallOrdinalCounter = 0
const pendingInjection = new Map<number, { formulaIndex: number; desiredTag: string }>()
let firstOpenReported = false
/** Actual injected-call tracking (truthful reporting, independent of visual). */
let injectedCallCount = 0
const injectedFormulaFlags = new Set<number>()
const injectedFulfillmentFlags = new Set<number>()
let nonTargetPassThroughCount = 0
/** R5.4.1: pre-call plan catch-up reentrancy guard. */
let preCallCatchupInProgress = false
/** R5.4.1: last live formula revision a (re)built plan was bound to. */
let lastRebuiltLiveFormulaRevision: number | null = null
/** v2.5.7-R5.4.2 Phase H: catchup authorization closure stats. */
let catchupCompletedAuthorizedCount = 0
let catchupCompletedNotAuthorizedCount = 0
const catchupClosurePassedSet = new Set<number>()
let callsiteAuthorityReported = false
/** R5.4.2 Phase J: existing-source authority regression counter. */
let existingSourceRegressionCount = 0
let lastCallsiteAuthorityDecision: 'PASS' | 'PARTIAL' | 'BLOCK' | 'NOT_REPORTED' = 'NOT_REPORTED'
/** R5.4.2 Phase G/H: catchup observed + post-catchup rebind pass counters. */
let catchupObservedCount = 0
let postCatchupRebindPassCount = 0

export function setTex2svgInjectionContext(ctx: Tex2svgInjectionRuntimeContext | null): void {
  injectionContext = ctx
}

/** Test-only: reset the pre-call catch-up module state. */
export function resetPreCallCatchupState(): void {
  preCallCatchupInProgress = false
  lastRebuiltLiveFormulaRevision = null
  catchupCompletedAuthorizedCount = 0
  catchupCompletedNotAuthorizedCount = 0
  catchupClosurePassedSet.clear()
  callsiteAuthorityReported = false
  existingSourceRegressionCount = 0
  lastCallsiteAuthorityDecision = 'NOT_REPORTED'
  catchupObservedCount = 0
  postCatchupRebindPassCount = 0
}

/** R5.4.2 Phase H: read-only catchup closure stats for the final accounting. */
export function getCatchupStats(): {
  completedAuthorized: number
  completedNotAuthorized: number
  closurePassedCount: number
} {
  return {
    completedAuthorized: catchupCompletedAuthorizedCount,
    completedNotAuthorized: catchupCompletedNotAuthorizedCount,
    closurePassedCount: catchupClosurePassedSet.size,
  }
}

/** R5.4.2 Phase J: existing-source authority regression count. */
export function getExistingSourceRegressionCount(): number {
  return existingSourceRegressionCount
}

/** R5.4.2 Phase N: last read-only callsite authority decision. */
export function getCallsiteAuthorityDecision(): 'PASS' | 'PARTIAL' | 'BLOCK' | 'NOT_REPORTED' {
  return lastCallsiteAuthorityDecision
}

/** R5.4.2 Phase G/H: catchup observed + post-catchup rebind pass counters. */
export function getCatchupRebindStats(): { catchupObservedCount: number; postCatchupRebindPassCount: number } {
  return { catchupObservedCount, postCatchupRebindPassCount }
}

/** R5.4.2 Phase F: current injection-context plan (service-side identity resolver). */
export function getCurrentInjectionPlan(): FormulaRenderAuthorizationPlan | null {
  return injectionContext?.plan ?? null
}

export function nextPlanRevision(): number {
  return ++planRevisionCounter
}

export function getTex2svgInjectionPlanReady(): boolean {
  return !!injectionContext?.plan && injectionContext.plan.entries.some((e) => e.authorizationState === 'READY')
}

/** R5.4.1: number of injected calls still awaiting fulfillment (pending set). */
export function getPendingInjectionCount(): number {
  return pendingInjection.size
}

// ── Pre-call Handler (called by the tex2svgPromise wrapper) ────────────

export interface Tex2svgPreCallResult {
  applyArgs: unknown[]
  injection: { callOrdinal: number; formulaIndex: number; desiredTag: string } | null
  decision: PreCallDecision
}

function collectEditingHostSourceHashes(root: HTMLElement | null): string[] {
  if (!root) return []
  const hashes: string[] = []
  try {
    const hosts = root.querySelectorAll<HTMLElement>('.md-rawblock-on-edit, .mathjax-block.md-focus, .md-math-block.md-focus')
    for (const h of hosts) {
      const v = verifyFormulaTexSource({ host: h, formulaIndex: 0, editorRoot: root })
      if (v.decision !== 'UNAVAILABLE' && v.normalizedSourceLength > 0) hashes.push(v.sourceHash)
    }
  } catch { /* read-only */ }
  return hashes
}

/**
 * v2.5.7-R5.4.2 Phase N: Typora renderer callsite authority (READ-ONLY). We
 * observe the REAL external caller of tex2svgPromise from the captured stack.
 * We never invoke it and never patch frame.js; safeToInvoke stays false unless
 * a downstream same-formula correlation is proven.
 */
function firstRealCallerFrame(stack: string): { candidateName: string; ownerHint: string } | null {
  const SKIP = [
    'mathjax-render-route-trace',
    'mathjax-tex2svg-tag-injection',
    'typora-community-plugin',
    'transparentWrapper',
    'preCallTransform',
    'handleTex2svgPreCall',
    'reportInjectionFulfillment',
    'anonymous',
    'webpack',
    'node_modules',
  ]
  const lines = stack.split('\n')
  for (const line of lines) {
    const m = line.match(/\s+at\s+(.+)/)
    if (!m) continue
    const frame = m[1]
    if (SKIP.some((s) => frame.includes(s))) continue
    const fnMatch = frame.match(/^([^(\s]+)\s*\(/)
    const urlMatch = frame.match(/\(([^)]+)\)$/) || frame.match(/^([^\s]+)$/)
    const candidateName = fnMatch ? fnMatch[1] : 'anonymous'
    const ownerHint = urlMatch ? urlMatch[1] : frame
    return { candidateName, ownerHint }
  }
  return null
}

function reportTyporaRendererCallsiteAuthority(callOrdinal: number, stack: string, formulaHostIdentityAvailable: boolean, sameFormulaCorrelation: boolean): void {
  const caller = firstRealCallerFrame(stack)
  const candidateName = caller?.candidateName ?? 'UNKNOWN'
  const ownerHint = caller?.ownerHint ?? 'typora-runtime'
  // Observational only: we cannot prove a SAFE invocation contract, so the
  // authority is PARTIAL with the honest reason (never a hack fallback).
  lastCallsiteAuthorityDecision = 'PARTIAL'
  emitRuntimeAudit('TYPORA-FORMULA-RENDERER-CALLSITE-AUTHORITY', {
    candidateName,
    ownerToken: null,
    ownerHint,
    callable: true,
    hookable: false,
    actualCallObserved: true,
    formulaHostIdentityAvailable,
    downstreamTex2svgPromiseObserved: true,
    sameFormulaCorrelation,
    sourceImmutable: false,
    selectionPreserved: false,
    safeToInvoke: false,
    decision: 'PARTIAL',
    reason: 'CALLSITE_OBSERVED_NOT_SAFE_TO_INVOKE',
    runtimeMarker: R542_RUNTIME_MARKER,
  })
}

/**
 * Pre-call tex2svgPromise guard: decide AUTHORIZED / PASS_THROUGH / BLOCK_AMBIGUOUS.
 * Emits CONTEXT / FORMULA / AUTHORIZATION / INJECTION-BEFORE / NONTARGET markers.
 * NEVER mutates the caller's args; returns a fresh forwardedArgs when injecting.
 */
export function handleTex2svgPreCall(
  args: unknown[],
  _thisArg: unknown,
  _preCallStack: string,
): Tex2svgPreCallResult {
  const callOrdinal = ++preCallOrdinalCounter
  const ctx = injectionContext
  const inputTex = typeof args[0] === 'string' ? args[0] : ''
  const inputHash = simpleHash(normalizeTexSource(inputTex))
  const workspacePath = ctx?.getWorkspaceActivePath?.() ?? null
  const documentKey = ctx?.getDocumentKey?.() ?? null
  const sourceSha = ctx?.getDocumentSourceSha256?.() ?? null
  const generation = ctx?.getCurrentGeneration?.() ?? null
  const editorRoot = ctx?.getEditorRoot?.() ?? null
  const plan = ctx?.plan ?? null

  const sameDocument = !!ctx && !!documentKey && !!plan && documentKey === plan.documentKey
  const sameSourceRevision = !!ctx && !!sourceSha && !!plan && sourceSha === plan.documentSourceSha256
  const editingHashes = collectEditingHostSourceHashes(editorRoot)

  // Context authority marker.
  emitRuntimeAudit('MATHJAX-TEX2SVG-PRECALL-CONTEXT-AUTHORITY', {
    callOrdinal,
    workspaceActivePath: workspacePath,
    workspaceDocumentKey: documentKey,
    serviceDocumentKey: documentKey,
    currentDocumentGeneration: generation,
    currentEditorRootAvailable: !!editorRoot,
    currentEditorRootConnected: editorRoot?.isConnected ?? false,
    authorizationPlanAvailable: !!plan,
    planDocumentKey: plan?.documentKey ?? null,
    planDocumentSourceSha256: plan?.documentSourceSha256 ?? null,
    planRevision: plan?.planRevision ?? null,
    sameDocument,
    sameSourceRevision,
    decision: sameDocument && sameSourceRevision ? 'PASS' : 'PASS_THROUGH',
    reason: sameDocument && sameSourceRevision ? null : (!sameDocument ? 'STALE_OR_FOREIGN_DOCUMENT' : 'STALE_SOURCE_REVISION'),
    runtimeMarker: R54_RUNTIME_MARKER,
  })

  // ── R5.4.1 Phase C/E: Live freshness gate + synchronous pre-call plan catch-up ──
  // Disk SHA is a PERSISTENCE authority only. A tex2svgPromise call arriving
  // before the mutation-driven refresh rebuilt the plan is re-authorized against
  // a plan synchronously rebuilt from the CURRENT live editor (no timer, no
  // polling, no active MathJax call, no Markdown write).
  const currentLiveFormulaRevision = ctx?.getCurrentLiveFormulaRevision?.() ?? null
  const currentSemanticSignature = ctx?.getCurrentSemanticSignature?.() ?? null
  const planLiveFormulaRevision = plan?.planLiveFormulaRevision ?? 0
  const planSemanticSignature = plan?.planSemanticSignature ?? ''
  const hasLiveAuthority = currentLiveFormulaRevision !== null
  const hasSemanticAuthority = currentSemanticSignature !== null && currentSemanticSignature !== ''
  const liveFormulaRevisionFresh = !hasLiveAuthority || planLiveFormulaRevision === currentLiveFormulaRevision
  const semanticSignatureFresh = !hasSemanticAuthority || planSemanticSignature === currentSemanticSignature
  // R5.4.3.3: also trigger catch-up when editing formula input hash not in plan (new formula).
  const planHasEntryForInput = plan?.entries.some((e) => e.normalizedSourceHash === inputHash) ?? false
  const hashMissAndNotRebuiltYet = plan !== null && !planHasEntryForInput && lastRebuiltLiveFormulaRevision !== currentLiveFormulaRevision
  const editingFormulaNotInPlan = plan !== null && !planHasEntryForInput

  let catchupAttempted = false
  let catchupCompleted = false
  let planAfter = plan
  let staleAfter = false
  let contextRebound = false
  const ctxTokenBefore = ctx?.getContextToken?.() ?? 0
  let ctxTokenAfter = ctxTokenBefore
  if (
    !!ctx?.rebuildPlanSynchronously
    && plan !== null
    && (!liveFormulaRevisionFresh || !semanticSignatureFresh || hashMissAndNotRebuiltYet || editingFormulaNotInPlan)
  ) {
    catchupAttempted = true
    if (preCallCatchupInProgress) {
      // Reentrancy: the catch-up rebuild must never re-enter the wrapper.
      emitRuntimeAudit('MATHJAX-TEX2SVG-PRECALL-PLAN-CATCHUP', {
        callOrdinal,
        planRevisionBefore: plan?.planRevision ?? null,
        planLiveFormulaRevisionBefore: planLiveFormulaRevision,
        currentLiveFormulaRevision,
        staleBefore: true,
        catchupAttempted: true,
        catchupCompleted: false,
        planRevisionAfter: null,
        planLiveFormulaRevisionAfter: null,
        sameCurrentCallReauthorized: false,
        uniqueAuthorizedFormulaIndex: null,
        desiredTag: null,
        decision: 'PASS_THROUGH',
        reason: 'PRECALL_CATCHUP_REENTRANCY',
        runtimeMarker: R541_RUNTIME_MARKER,
      })
      catchupCompletedNotAuthorizedCount++
      return { applyArgs: args, injection: null, decision: 'PASS_THROUGH' }
    }
    preCallCatchupInProgress = true
    try {
      catchupCompleted = ctx.rebuildPlanSynchronously() === true
    } catch {
      catchupCompleted = false
    } finally {
      preCallCatchupInProgress = false
    }
    // R5.4.2 Phase G: post-catchup FULL context rebind. The rebuild reinstalls
    // a NEW runtime context via setTex2svgInjectionContext — the local `ctx` is
    // stale by design. A new context token proves the rebind.
    const ctxAfter = injectionContext
    ctxTokenAfter = ctxAfter?.getContextToken?.() ?? ctxTokenBefore
    planAfter = ctxAfter?.plan ?? null
    contextRebound = !!ctxAfter && ctxTokenAfter !== ctxTokenBefore && !!planAfter
    const rebuiltRevision = ctxAfter?.getCurrentLiveFormulaRevision?.() ?? currentLiveFormulaRevision
    if (catchupCompleted && planAfter) lastRebuiltLiveFormulaRevision = rebuiltRevision
    const afterLiveFresh = !ctxAfter?.getCurrentLiveFormulaRevision
      || (planAfter?.planLiveFormulaRevision ?? 0) === (ctxAfter.getCurrentLiveFormulaRevision?.() ?? 0)
    const afterSemanticFresh = !ctxAfter?.getCurrentSemanticSignature
      || !ctxAfter.getCurrentSemanticSignature?.()
      || (planAfter?.planSemanticSignature ?? '') === (ctxAfter.getCurrentSemanticSignature?.() ?? '')
    staleAfter = !catchupCompleted || !contextRebound || !afterLiveFresh || !afterSemanticFresh
  }

  if (catchupAttempted) {
    catchupObservedCount++
    emitRuntimeAudit('MATHJAX-TEX2SVG-PRECALL-PLAN-CATCHUP', {
      callOrdinal,
      planRevisionBefore: plan?.planRevision ?? null,
      planLiveFormulaRevisionBefore: planLiveFormulaRevision,
      currentLiveFormulaRevision,
      staleBefore: !liveFormulaRevisionFresh || !semanticSignatureFresh || hashMissAndNotRebuiltYet,
      catchupAttempted,
      catchupCompleted,
      planRevisionAfter: planAfter?.planRevision ?? null,
      planLiveFormulaRevisionAfter: planAfter?.planLiveFormulaRevision ?? null,
      // R5.4.3.5 P2: catchupCompleted NEVER equals reauthorized. This field is
      // only ever true when the post-catchup authorization below actually
      // resolved identity+index+desiredTag and authorized THIS call.
      sameCurrentCallReauthorized: false,
      reauthorizationAttempted: false,
      reauthorizationSucceeded: false,
      uniqueAuthorizedFormulaIndex: null,
      desiredTag: null,
      decision: staleAfter ? 'STALE_AFTER_CATCHUP' : 'CATCHUP_COMPLETED',
      reason: staleAfter ? 'STALE_LIVE_REVISION_AFTER_CATCHUP' : null,
      runtimeMarker: R541_RUNTIME_MARKER,
    })
    const ctxAfter = injectionContext
    if (!staleAfter) postCatchupRebindPassCount++
    emitRuntimeAudit('MATHJAX-TEX2SVG-POST-CATCHUP-CONTEXT-REBIND', {
      callOrdinal,
      contextTokenBefore: ctxTokenBefore,
      contextTokenAfter: ctxTokenAfter,
      planRevisionBefore: plan?.planRevision ?? null,
      planRevisionAfter: planAfter?.planRevision ?? null,
      planLiveFormulaRevisionBefore: planLiveFormulaRevision,
      planLiveFormulaRevisionAfter: planAfter?.planLiveFormulaRevision ?? null,
      currentLiveFormulaRevisionBefore: currentLiveFormulaRevision,
      currentLiveFormulaRevisionAfter: ctxAfter?.getCurrentLiveFormulaRevision?.() ?? currentLiveFormulaRevision,
      semanticSignatureBefore: planSemanticSignature,
      semanticSignatureAfter: planAfter?.planSemanticSignature ?? '',
      editingHostIdentityBefore: null,
      editingHostIdentityAfter: null,
      contextRebound,
      decision: staleAfter ? 'FAIL' : 'PASS',
      reason: staleAfter ? 'POST_CATCHUP_CONTEXT_REBIND_FAILED' : null,
      runtimeMarker: R541_RUNTIME_MARKER,
    })
    if (staleAfter) {
      // Plan could not be bound to the current live revision — never authorize.
      emitRuntimeAudit('MATHJAX-TEX2SVG-NONTARGET-PASS-THROUGH', {
        callOrdinal,
        inputHash,
        candidateManagedFormulaCount: 0,
        uniqueAuthorizedFormulaIndex: null,
        originalArgsPassed: true,
        inputUnchanged: true,
        returnIdentityPreserved: true,
        decision: 'PASS_THROUGH',
        reason: staleAfter && !contextRebound ? 'POST_CATCHUP_CONTEXT_REBIND_FAILED' : 'STALE_LIVE_REVISION_AFTER_CATCHUP',
        runtimeMarker: R541_RUNTIME_MARKER,
      })
      catchupCompletedNotAuthorizedCount++
      return { applyArgs: args, injection: null, decision: 'PASS_THROUGH' }
    }
  }

  // ── R5.4.2 Phase G: recompute ALL runtime authority from the CURRENT context
  // (post-rebind when a catch-up ran; otherwise the same context). Never rely on
  // a stale pre-catchup snapshot for document / source / editing-host authority.
  const ctxAuth = injectionContext
  const authPlan = ctxAuth?.plan ?? planAfter ?? plan
  const authDocumentKey = ctxAuth?.getDocumentKey?.() ?? documentKey
  const authSourceSha = ctxAuth?.getDocumentSourceSha256?.() ?? sourceSha
  const authEditorRoot = ctxAuth?.getEditorRoot?.() ?? editorRoot
  const authSameDocument = !!ctxAuth && !!authDocumentKey && !!authPlan && authDocumentKey === authPlan.documentKey
  const authSameSourceRevision = !!ctxAuth && !!authSourceSha && !!authPlan && authSourceSha === authPlan.documentSourceSha256
  const authEditingHashes = collectEditingHostSourceHashes(authEditorRoot)
  const editingHostIdentity = ctxAuth?.resolveEditingHostIdentity?.() ?? null

  // ── R5.4.3.8 P2: Edit-session identity continuity ──
  // The latched edit-session identity OUTRANKS DOM-based currentEditingFormula-
  // CandidateCount and source-hash uniqueness. When an active session exists and
  // matches the current plan, authorization proceeds via the session identity
  // even if currentEditingFormulaCandidateCount temporarily drops to 0.
  const activeSession = getActiveEditSession()
  const sessionIdentityOk = !!activeSession
    && activeSession.documentKey === authDocumentKey
    && activeSession.generation === (ctxAuth?.getCurrentGeneration?.() ?? -1)
    && activeSession.stableFormulaIdentity !== null
    && activeSession.stableFormulaIdentity !== 'AMBIGUOUS'
  const sessionPlanEntry = sessionIdentityOk && authPlan
    ? authPlan.entries.find((e) => e.stableFormulaIdentity === activeSession!.stableFormulaIdentity) ?? null
    : null

  // Latch identity on the first natural call of an editing formula.
  if (
    editingHostIdentity
    && editingHostIdentity.candidateCount === 1
    && editingHostIdentity.stableFormulaIdentity !== null
    && editingHostIdentity.stableFormulaIdentity !== 'AMBIGUOUS'
    && (!activeSession || activeSession.stableFormulaIdentity !== editingHostIdentity.stableFormulaIdentity)
  ) {
    const latched = latchEditSession({
      documentKey: authDocumentKey ?? '',
      generation: ctxAuth?.getCurrentGeneration?.() ?? 0,
      rootToken: 0,
      stableFormulaIdentity: editingHostIdentity.stableFormulaIdentity,
      formulaHostToken: editingHostIdentity.stableFormulaIdentity as number,
      formulaIndex: editingHostIdentity.stableFormulaIdentity as number,
      desiredTag: null,
      sourceHashAtEnter: null,
      contentRevisionAtEnter: 0,
      trigger: 'PRECALL_HOST_IDENTITY',
    })
    // R5.4.3.8 P1: entering the edit state via a natural tex2svg call is a
    // NONSEMANTIC transition — it must never commit authoritative source.
    emitNonsemanticEditTransition({
      sessionId: latched.sessionId,
      eventKind: 'START_EDITING_PRECALL_TEX2SVG',
      stableFormulaIdentity: editingHostIdentity.stableFormulaIdentity,
      formulaIndex: editingHostIdentity.stableFormulaIdentity as number,
      userSemanticSourceChange: false,
    })
  }
  // Session identity takes priority for authorization lookup.
  const sessionResolvedIdentity = sessionPlanEntry
    ? sessionPlanEntry.stableFormulaIdentity
    : (editingHostIdentity?.stableFormulaIdentity ?? null)
  const sessionResolvedIndex = sessionPlanEntry
    ? sessionPlanEntry.formulaIndex
    : (editingHostIdentity?.planEntryFound ? editingHostIdentity.stableFormulaIdentity : null)

  // ── R5.4.3.8 P0: Empty formula sentinel authorization ──
  // <Empty \space Math \space Block> / empty TeX on a canonical host is an
  // EMPTY_FORMULA_SENTINEL. It is authorized by HOST/SESSION identity, never
  // by source-hash match, so an empty block formula shows InkChapter numbering
  // before the user types any character.
  const isEmptyInput = isEmptyFormulaSentinel(inputTex)
  let emptySentinelAuthorized = false
  let emptyAuthorizedBy: 'HOST_IDENTITY' | 'EDIT_SESSION' | 'NONE' = 'NONE'
  let emptyAuthorizedIndex: number | null = null
  let emptyAuthorizedTag: string | null = null
  if (isEmptyInput) {
    if (sessionPlanEntry) {
      emptySentinelAuthorized = true
      emptyAuthorizedBy = 'EDIT_SESSION'
      emptyAuthorizedIndex = sessionPlanEntry.formulaIndex
      emptyAuthorizedTag = sessionPlanEntry.desiredTag
    } else if (editingHostIdentity && editingHostIdentity.candidateCount === 1
      && editingHostIdentity.stableFormulaIdentity !== null && editingHostIdentity.stableFormulaIdentity !== 'AMBIGUOUS') {
      const hostEntry = authPlan?.entries.find((e) => e.stableFormulaIdentity === editingHostIdentity.stableFormulaIdentity) ?? null
      if (hostEntry) {
        emptySentinelAuthorized = true
        emptyAuthorizedBy = 'HOST_IDENTITY'
        emptyAuthorizedIndex = hostEntry.formulaIndex
        emptyAuthorizedTag = hostEntry.desiredTag
      }
    }
    emitEmptyTex2svgSentinelAuthority({
      callOrdinal,
      documentKey: authDocumentKey ?? '',
      generation: ctxAuth?.getCurrentGeneration?.() ?? 0,
      rootToken: 0,
      stableFormulaIdentity: emptySentinelAuthorized ? (sessionResolvedIdentity ?? editingHostIdentity?.stableFormulaIdentity ?? null) : null,
      formulaIndex: emptyAuthorizedIndex,
      desiredTag: emptyAuthorizedTag,
      authorizedBy: emptyAuthorizedBy,
      decision: emptySentinelAuthorized ? 'AUTHORIZED_EMPTY_FORMULA_SLOT' : 'FAIL',
      reason: emptySentinelAuthorized ? null : 'EMPTY_SENTINEL_NO_HOST_OR_SESSION_IDENTITY',
    })
  }

  let auth = resolvePreCallAuthorization({
    plan: authPlan,
    inputTex,
    sameDocument: authSameDocument,
    sameSourceRevision: authSameSourceRevision,
    formulaNumberingEnabled: !!ctxAuth?.enabled,
    editingHostSourceHashes: authEditingHashes,
    editingHostIdentity,
  })

  // R5.4.3.8: if empty sentinel authorized by identity but source-based auth
  // could not match (expected — empty TeX has no committed source), override to
  // AUTHORIZED via the identity path.
  if (isEmptyInput && emptySentinelAuthorized && emptyAuthorizedIndex !== null) {
    auth = {
      ...auth,
      decision: 'AUTHORIZED',
      authorityKind: 'EMPTY_FORMULA_SLOT_IDENTITY',
      uniqueAuthorizedFormulaIndex: emptyAuthorizedIndex,
      uniqueAuthorizedStableFormulaIdentity: (sessionResolvedIdentity ?? editingHostIdentity?.stableFormulaIdentity) as number,
      desiredTag: emptyAuthorizedTag,
      candidateManagedFormulaCount: Math.max(auth.candidateManagedFormulaCount, 1),
    }
  }

  // R5.4.3.8 P2: emit edit-session tex2svg authority when session identity is in play.
  if (sessionIdentityOk && sessionPlanEntry) {
    emitEditSessionTex2svgAuthority({
      callOrdinal,
      sessionId: activeSession!.sessionId,
      stableFormulaIdentity: activeSession!.stableFormulaIdentity,
      formulaIndex: sessionPlanEntry.formulaIndex,
      desiredTag: sessionPlanEntry.desiredTag,
      currentEditingCandidateCount: editingHostIdentity?.candidateCount ?? 0,
      authorizedBy: 'EDIT_SESSION_LATCH',
      authorized: true,
    })
  }

  // ── R5.4.3.5 P3: Existing Formula Transitional Current Source Authority ──
  // When the editing host resolves to ONE existing stable identity but the
  // authoritative committed source no longer matches the current tex2svg input,
  // do NOT permanently PASS_THROUGH. Promote the current input as
  // TRANSITIONAL_CURRENT_EDIT_SOURCE for THIS stable identity by re-running the
  // formula-only synchronous rebuild (which re-captures authoritative source
  // from the live DOM) and re-resolve authorization for THIS same call.
  let transitionalSourceAccepted = false
  let transitionalSourceChanged = false
  let transitionalNextHash: string | null = null
  if (
    auth.decision === 'PASS_THROUGH'
    && auth.reason === 'NO_FORMULA_SOURCE_MATCH'
    && editingHostIdentity && editingHostIdentity.candidateCount === 1
    && editingHostIdentity.stableFormulaIdentity !== null && editingHostIdentity.stableFormulaIdentity !== 'AMBIGUOUS'
    && inputTex.trim().length >= 4
    && !!ctxAuth?.rebuildPlanSynchronously
    && !preCallCatchupInProgress
  ) {
    const regEntry = authPlan?.entries.find((e) => e.stableFormulaIdentity === editingHostIdentity.stableFormulaIdentity)
    const priorMatchWasEstablished = !!regEntry && injectedFormulaFlags.has(regEntry.formulaIndex)
    if (regEntry) {
      // Promote attempt: synchronously rebuild plan (re-captures live source).
      preCallCatchupInProgress = true
      let promoteOk = false
      try {
        promoteOk = ctxAuth.rebuildPlanSynchronously() === true
      } catch {
        promoteOk = false
      } finally {
        preCallCatchupInProgress = false
      }
      if (promoteOk) {
        const promotedCtx = injectionContext
        const promotedPlan = promotedCtx?.plan ?? null
        if (promotedPlan) {
          const promotedIdentity = promotedCtx?.resolveEditingHostIdentity?.() ?? editingHostIdentity
          const auth2 = resolvePreCallAuthorization({
            plan: promotedPlan,
            inputTex,
            sameDocument: authSameDocument,
            sameSourceRevision: authSameSourceRevision,
            formulaNumberingEnabled: !!promotedCtx?.enabled,
            editingHostSourceHashes: collectEditingHostSourceHashes(promotedCtx?.getEditorRoot?.() ?? null),
            editingHostIdentity: promotedIdentity,
          })
          if (auth2.decision === 'AUTHORIZED' && auth2.uniqueAuthorizedFormulaIndex !== null) {
            auth = auth2
            transitionalSourceAccepted = true
            transitionalSourceChanged = true
            transitionalNextHash = inputHash
          }
        }
      }
      emitRuntimeAudit('FORMULA-EXISTING-TRANSITIONAL-SOURCE-AUTHORITY', {
        stableFormulaIdentity: regEntry.stableFormulaIdentity,
        formulaIndex: regEntry.formulaIndex,
        canonicalHostToken: null,
        committedSourceHash: regEntry.authoritativeSourceHash || regEntry.normalizedSourceHash,
        currentTexInputHash: inputHash,
        sourceMismatchBefore: true,
        transitionalSourceAccepted,
        nextSourceHash: transitionalNextHash,
        sourceChanged: transitionalSourceChanged,
        previousLiveFormulaRevision: currentLiveFormulaRevision,
        nextLiveFormulaRevision: ctxAuth?.getCurrentLiveFormulaRevision?.() ?? currentLiveFormulaRevision,
        decision: transitionalSourceAccepted ? 'PASS' : 'FAIL',
        reason: transitionalSourceAccepted ? null : 'TRANSITIONAL_PROMOTE_NOT_APPLICABLE',
        runtimeMarker: R543_RUNTIME_MARKER,
      })
      if (!transitionalSourceAccepted && priorMatchWasEstablished) {
        existingSourceRegressionCount++
        emitRuntimeAudit('FORMULA-EXISTING-SOURCE-AUTHORITY-REGRESSION', {
          stableFormulaIdentity: regEntry.stableFormulaIdentity,
          formulaIndex: regEntry.formulaIndex,
          formulaContentRevision: regEntry.formulaContentRevision,
          authoritativeHash: regEntry.authoritativeSourceHash || regEntry.normalizedSourceHash,
          latestTex2svgInputHash: inputHash,
          sourceMatch: false,
          priorMatchWasEstablished: true,
          regressed: true,
          decision: 'FAIL',
          reason: 'AUTHORITATIVE_SOURCE_NO_LONGER_MATCHES_INPUT',
          runtimeMarker: R542_RUNTIME_MARKER,
        })
      }
    }
  }

  // R5.4.1/R5.4.2: report the final authorization decision as
  // AUTHORIZED_AFTER_CATCHUP when the pre-call catch-up + full context rebind
  // was the path that bound this formula.
  let authDecision: PreCallDecision = auth.decision === 'AUTHORIZED' && catchupCompleted && contextRebound
    ? 'AUTHORIZED_AFTER_CATCHUP'
    : auth.decision

  // R5.4.3.5 P2: Same-call Reauthorization Truth.
  // sameCurrentCallReauthorized is true ONLY when identity+index+desiredTag are
  // all resolved AND this call is actually authorized. Never derived from
  // catchupCompleted alone.
  const reauthAuthorized = authDecision === 'AUTHORIZED' || authDecision === 'AUTHORIZED_AFTER_CATCHUP'
  const reauthIdentity = auth.uniqueAuthorizedStableFormulaIdentity !== null && auth.uniqueAuthorizedStableFormulaIdentity !== undefined
  const reauthIndex = auth.uniqueAuthorizedFormulaIndex !== null && auth.uniqueAuthorizedFormulaIndex !== undefined
  const reauthTag = !!auth.desiredTag && auth.desiredTag !== ''
  const reauthManagedEligible = auth.candidateManagedFormulaCount > 0
  const sameCurrentCallReauthorized = reauthAuthorized && reauthIdentity && reauthIndex && reauthTag && reauthManagedEligible && authSameDocument
  if (catchupAttempted) {
    emitRuntimeAudit('MATHJAX-TEX2SVG-SAME-CALL-REAUTHORIZATION', {
      callOrdinal,
      catchupAttempted,
      catchupCompleted,
      reauthorizationAttempted: catchupCompleted && !staleAfter,
      reauthorizationSucceeded: sameCurrentCallReauthorized,
      stableFormulaIdentity: auth.uniqueAuthorizedStableFormulaIdentity ?? null,
      formulaIndex: auth.uniqueAuthorizedFormulaIndex ?? null,
      desiredTag: auth.desiredTag ?? null,
      sourceAuthorityMatched: auth.uniqueAuthorizedFormulaIndex !== null,
      managedEligible: reauthManagedEligible,
      explicitTagControl: auth.reason === 'EXPLICIT_TAG_CONTROL',
      authorized: reauthAuthorized,
      sameDocument: authSameDocument,
      sameGeneration: authSameSourceRevision,
      sameEditorRoot: true,
      sameCurrentCallReauthorized,
      decision: sameCurrentCallReauthorized ? 'AUTHORIZED' : (catchupCompleted ? 'FAIL' : 'PASS_THROUGH'),
      reason: sameCurrentCallReauthorized ? null : (!reauthIdentity ? 'REAUTHORIZATION_STABLE_IDENTITY_MISSING' : !reauthIndex ? 'REAUTHORIZATION_FORMULA_INDEX_MISSING' : !reauthTag ? 'REAUTHORIZATION_DESIRED_TAG_MISSING' : !reauthAuthorized ? 'REAUTHORIZATION_NOT_AUTHORIZED' : 'REAUTHORIZATION_MANAGED_ELIGIBILITY_MISSING'),
      runtimeMarker: R543_RUNTIME_MARKER,
    })
  }

  // Formula identity marker.
  emitRuntimeAudit('MATHJAX-TEX2SVG-PRECALL-FORMULA-AUTHORITY', {
    callOrdinal,
    inputLength: inputTex.length,
    inputHash,
    inputPrefix: inputTex.slice(0, 80),
    candidateManagedFormulaCount: auth.candidateManagedFormulaCount,
    formula0SourceHashMatch: auth.formula0SourceHashMatch,
    formula1SourceHashMatch: auth.formula1SourceHashMatch,
    formula0ExactNormalizedInputMatch: auth.formula0SourceHashMatch,
    formula1ExactNormalizedInputMatch: auth.formula1SourceHashMatch,
    currentEditingFormulaCandidateCount: editingHostIdentity?.candidateCount ?? authEditingHashes.length,
    currentEditingFormulaIndex: auth.authorityKind === 'CURRENT_EDITING_HOST_PLUS_EXACT_SOURCE_MATCH' || auth.authorityKind === 'EDITING_HOST_STABLE_IDENTITY_PLUS_SOURCE_MATCH' ? auth.uniqueAuthorizedFormulaIndex : null,
    currentEditingStableFormulaIdentity: editingHostIdentity?.stableFormulaIdentity ?? null,
    currentEditingFormulaPlanEntryFound: editingHostIdentity?.planEntryFound ?? false,
    callerContextFormulaCandidateCount: 0,
    callerContextFormulaIndex: null,
    uniqueAuthorizedFormulaIndex: auth.uniqueAuthorizedFormulaIndex,
    uniqueAuthorizedStableFormulaIdentity: auth.uniqueAuthorizedStableFormulaIdentity,
    authorityKind: auth.authorityKind,
    decision: authDecision,
    reason: auth.reason,
    liveFormulaRevisionFresh,
    semanticSignatureFresh,
    planLiveFormulaRevision,
    currentLiveFormulaRevision,
    runtimeMarker: R541_RUNTIME_MARKER,
  })

  // Pre-call authorization summary.
  emitRuntimeAudit('MATHJAX-TEX2SVG-PRECALL-AUTHORIZATION', {
    callOrdinal,
    routeName: 'MathJax.tex2svgPromise',
    uniqueAuthorizedFormulaIndex: auth.uniqueAuthorizedFormulaIndex,
    uniqueAuthorizedStableFormulaIdentity: auth.uniqueAuthorizedStableFormulaIdentity,
    desiredTag: auth.desiredTag,
    sameDocument: authSameDocument,
    sameSourceRevision: authSameSourceRevision,
    managedEligible: auth.candidateManagedFormulaCount > 0,
    explicitTagControl: auth.reason === 'EXPLICIT_TAG_CONTROL',
    inlineMathRejected: auth.inlineMathRejected,
    foreignMathRejected: auth.foreignMathRejected,
    authorityKind: auth.authorityKind,
    decision: authDecision,
    reason: auth.reason,
    preCallPlanCatchup: catchupAttempted,
    contextRebound,
    runtimeMarker: R541_RUNTIME_MARKER,
  })

  // First-open authority report (once per session).
  if (!firstOpenReported) {
    firstOpenReported = true
    const planReady = !!plan && plan.entries.some((e) => e.authorizationState === 'READY')
    emitRuntimeAudit('R54-FIRST-OPEN-PRECALL-AUTHORITY', {
      firstTargetTex2svgCallOrdinal: callOrdinal,
      workspacePathReady: !!workspacePath,
      documentKeyReady: !!documentKey,
      generationReady: generation !== null,
      authorizationPlanReady: planReady,
      formula0AuthorizedOnFirstOpen: auth.uniqueAuthorizedFormulaIndex === 0,
      formula1AuthorizedOnFirstOpen: auth.uniqueAuthorizedFormulaIndex === 1,
      decision: authDecision === 'AUTHORIZED' || authDecision === 'AUTHORIZED_AFTER_CATCHUP' ? 'PASS' : 'PARTIAL',
      reason: auth.reason ?? (planReady ? 'PLAN_READY' : 'AUTHORIZATION_PLAN_NOT_READY'),
      runtimeMarker: R54_RUNTIME_MARKER,
    })
  }

  // R5.4.2 Phase N: read-only Typora renderer callsite observation (once).
  if (!callsiteAuthorityReported) {
    callsiteAuthorityReported = true
    reportTyporaRendererCallsiteAuthority(
      callOrdinal,
      _preCallStack,
      !!editingHostIdentity && editingHostIdentity.planEntryFound,
      authDecision === 'AUTHORIZED' || authDecision === 'AUTHORIZED_AFTER_CATCHUP',
    )
  }

  if ((authDecision !== 'AUTHORIZED' && authDecision !== 'AUTHORIZED_AFTER_CATCHUP') || auth.uniqueAuthorizedFormulaIndex === null) {
    nonTargetPassThroughCount++
    if (catchupAttempted) catchupCompletedNotAuthorizedCount++
    emitRuntimeAudit('MATHJAX-TEX2SVG-NONTARGET-PASS-THROUGH', {
      callOrdinal,
      inputHash,
      candidateManagedFormulaCount: auth.candidateManagedFormulaCount,
      uniqueAuthorizedFormulaIndex: auth.uniqueAuthorizedFormulaIndex,
      originalArgsPassed: true,
      inputUnchanged: true,
      returnIdentityPreserved: true,
      decision: 'PASS_THROUGH',
      reason: auth.reason ?? 'NOT_AUTHORIZED',
      runtimeMarker: R54_RUNTIME_MARKER,
    })
    return { applyArgs: args, injection: null, decision: auth.decision }
  }

  // Enable-state authority.
  emitRuntimeAudit('FORMULA-TAG-INJECTION-ENABLE-STATE-AUTHORITY', {
    formulaNumberingEnabled: !!ctx?.enabled,
    callOrdinal,
    formulaIndex: auth.uniqueAuthorizedFormulaIndex,
    injectionAuthorized: true,
    decision: 'AUTHORIZED',
    reason: null,
    runtimeMarker: R54_RUNTIME_MARKER,
  })

  // Injection BEFORE.
  emitRuntimeAudit('MATHJAX-TEX2SVG-TAG-INJECTION-BEFORE', {
    callOrdinal,
    formulaIndex: auth.uniqueAuthorizedFormulaIndex,
    originalInputHash: inputHash,
    originalInputLength: inputTex.length,
    desiredTag: auth.desiredTag,
    authorityKind: auth.authorityKind,
    forwardedArgCount: args.length,
    decision: 'INJECT',
    reason: null,
    runtimeMarker: R54_RUNTIME_MARKER,
  })

  const build = buildInjectedTex(inputTex, auth.desiredTag ?? '')
  if (build.decision !== 'INJECT' || !auth.desiredTag) {
    emitRuntimeAudit('MATHJAX-TEX2SVG-NONTARGET-PASS-THROUGH', {
      callOrdinal,
      inputHash,
      candidateManagedFormulaCount: auth.candidateManagedFormulaCount,
      uniqueAuthorizedFormulaIndex: auth.uniqueAuthorizedFormulaIndex,
      originalArgsPassed: true,
      inputUnchanged: true,
      returnIdentityPreserved: true,
      decision: 'PASS_THROUGH',
      reason: build.reason ?? 'INJECTION_BUILD_ABORTED',
      runtimeMarker: R54_RUNTIME_MARKER,
    })
    return { applyArgs: args, injection: null, decision: 'PASS_THROUGH' }
  }

  const forwardedArgs = args.slice()
  forwardedArgs[0] = build.injectedTex

  pendingInjection.set(callOrdinal, {
    formulaIndex: auth.uniqueAuthorizedFormulaIndex,
    desiredTag: auth.desiredTag,
  })
  injectedCallCount++
  injectedFormulaFlags.add(auth.uniqueAuthorizedFormulaIndex)

  emitRuntimeAudit('MATHJAX-TEX2SVG-TAG-INJECTION-AFTER', {
    callOrdinal,
    formulaIndex: auth.uniqueAuthorizedFormulaIndex,
    originalInputHash: inputHash,
    injectedInputHash: simpleHash(normalizeTexSource(build.injectedTex)),
    originalInputUnchanged: true,
    tagInserted: true,
    insertedTag: auth.desiredTag,
    otherArgIdentityPreserved: forwardedArgs.slice(1).every((v, i) => v === args[i + 1]),
    preCallPlanCatchup: catchupAttempted,
    decision: authDecision === 'AUTHORIZED' ? 'PASS' : 'PASS_AFTER_CATCHUP',
    reason: null,
    runtimeMarker: R541_RUNTIME_MARKER,
  })

  // R5.4.2 Phase H: catchup authorization closure. CATCHUP_COMPLETED alone is
  // NEVER reported as authorized — only a REAL authorization is.
  if (catchupAttempted) {
    if (authDecision === 'AUTHORIZED' || authDecision === 'AUTHORIZED_AFTER_CATCHUP') {
      catchupCompletedAuthorizedCount++
    } else {
      catchupCompletedNotAuthorizedCount++
    }
    const closureAuthorized = authDecision === 'AUTHORIZED' || authDecision === 'AUTHORIZED_AFTER_CATCHUP'
    emitRuntimeAudit('MATHJAX-TEX2SVG-CATCHUP-AUTHORIZATION-CLOSURE', {
      callOrdinal,
      catchupAttempted,
      catchupCompleted,
      contextRebound,
      uniqueAuthorizedStableFormulaIdentity: auth.uniqueAuthorizedStableFormulaIdentity,
      uniqueAuthorizedFormulaIndex: auth.uniqueAuthorizedFormulaIndex,
      desiredTag: auth.desiredTag,
      authorityKind: auth.authorityKind,
      injectionObserved: closureAuthorized,
      fulfillmentObserved: false,
      visibleTagMatched: false,
      decision: closureAuthorized ? 'CATCHUP_COMPLETED_AUTHORIZED' : 'CATCHUP_COMPLETED_NOT_AUTHORIZED',
      reason: null,
      runtimeMarker: R542_RUNTIME_MARKER,
    })
  }

  return {
    applyArgs: forwardedArgs,
    injection: { callOrdinal, formulaIndex: auth.uniqueAuthorizedFormulaIndex, desiredTag: auth.desiredTag },
    decision: authDecision,
  }
}

// ── Post-call / Fulfillment Hooks ──────────────────────────────────────

export function consumePendingInjection(callOrdinal: number): { formulaIndex: number; desiredTag: string } | null {
  const entry = pendingInjection.get(callOrdinal)
  if (entry) pendingInjection.delete(callOrdinal)
  return entry ?? null
}

export function reportInjectionFulfillment(callOrdinal: number, value: unknown, exactRegistered: boolean): void {
  const entry = consumePendingInjection(callOrdinal)
  if (!entry) return
  if (exactRegistered) injectedFulfillmentFlags.add(entry.formulaIndex)
  const nodeLike = typeof value === 'object' && value !== null && typeof (value as any).nodeType === 'number'
  emitRuntimeAudit('MATHJAX-TEX2SVG-INJECTION-FULFILLMENT-AUTHORITY', {
    callOrdinal,
    formulaIndex: entry.formulaIndex,
    desiredTag: entry.desiredTag,
    fulfilled: true,
    nodeLike,
    nodeName: nodeLike ? (value as any).nodeName ?? null : null,
    exactFulfillmentNodeRegistered: exactRegistered,
    inputWasInjected: true,
    decision: 'RECORDED',
    reason: null,
    runtimeMarker: R54_RUNTIME_MARKER,
  })
  // R5.4.1 Phase K: if this formula had a pending Typora-owned invalidation at
  // the current live revision, report the REAL closure observation.
  if (nodeLike) {
    const visibleTag = extractTagTextFromFulfilledNode(value as Node)
    // R5.4.2 Phase H: a catchup-authorization fulfillment whose visible tag
    // matches the injected tag closes the catchup loop truthfully.
    if (visibleTag === `(${entry.desiredTag})`) {
      catchupClosurePassedSet.add(entry.formulaIndex)
    }
    reportObservedInvalidationClosure({
      formulaIndex: entry.formulaIndex,
      liveFormulaRevision: injectionContext?.getCurrentLiveFormulaRevision?.() ?? 0,
      tex2svgCallObserved: true,
      authorizationObserved: true,
      injectionObserved: true,
      fulfillmentObserved: true,
      visibleTagAfter: visibleTag,
    })
  }
}

function extractTagTextFromFulfilledNode(node: Node): string {
  try {
    const text = (node as Element).textContent ?? ''
    const m = text.match(/\((\d+(?:[.\-]\d+)*)\)/)
    return m ? `(${m[1]})` : ''
  } catch {
    return ''
  }
}

// ── Post-output Verification (run at the managed-plan one-shot) ────────

export interface InjectionVerificationInput {
  plan: FormulaRenderAuthorizationPlan | null
  formulas: Array<{ host: HTMLElement | null; formulaIndex: number; desiredTag: string }>
  documentKey: string
  documentSourceSha256: string | null
  sourceShaBefore: string | null
}

export interface InjectionVerificationResult {
  formula0: FormulaInjectionVerifyResult
  formula1: FormulaInjectionVerifyResult
  nonTargetPassThroughCount: number
  sourceShaMatch: boolean
  strategyATagEffect: 'PASS' | 'FAIL' | 'PARTIAL'
  decision: 'PASS' | 'PARTIAL' | 'FAIL'
}

export interface FormulaInjectionVerifyResult {
  formulaIndex: number
  desiredTag: string
  expectedVisibleLabel: string
  authorized: boolean
  injectionObserved: boolean
  exactFulfillmentNodeMatch: boolean
  visibleMjxContainerCount: number
  nativeTagVisibleCount: number
  nativeTagText: string
  expectedTagMatched: boolean
  duplicateOutputCount: number
  flowProjectionCount: number
  legacyReconcileInvoked: boolean
  decision: 'PASS' | 'FAIL' | 'NOT_TESTED'
  reason: string | null
}

function extractNativeTagText(host: HTMLElement): string[] {
  const texts: string[] = []
  try {
    const mjx = host.querySelectorAll('mjx-container')
    for (const m of mjx) {
      const t = (m.textContent ?? '').trim()
      const labelMatch = t.match(/\((\d+(?:[.\-]\d+)*)\)/)
      if (labelMatch) texts.push(`(${labelMatch[1]})`)
    }
  } catch { /* read-only */ }
  return texts
}

export function executeTex2svgInjectionVerification(input: InjectionVerificationInput): InjectionVerificationResult {
  const verifyFormula = (host: HTMLElement | null, formulaIndex: number, desiredTag: string): FormulaInjectionVerifyResult => {
    const expectedLabel = `(${desiredTag})`
    const base: FormulaInjectionVerifyResult = {
      formulaIndex,
      desiredTag,
      expectedVisibleLabel: expectedLabel,
      authorized: false,
      injectionObserved: false,
      exactFulfillmentNodeMatch: false,
      visibleMjxContainerCount: 0,
      nativeTagVisibleCount: 0,
      nativeTagText: '',
      expectedTagMatched: false,
      duplicateOutputCount: 0,
      flowProjectionCount: 0,
      legacyReconcileInvoked: false,
      decision: 'NOT_TESTED',
      reason: null,
    }
    if (!host) return base
    base.visibleMjxContainerCount = host.querySelectorAll('mjx-container').length
    const tagTexts = extractNativeTagText(host)
    const matched = tagTexts.filter((t) => t === expectedLabel)
    base.nativeTagVisibleCount = matched.length
    base.nativeTagText = tagTexts[0] ?? ''
    base.expectedTagMatched = matched.length >= 1
    // Duplicate barrier: more than one mjx container, or more than one matching label.
    base.duplicateOutputCount = Math.max(0, base.visibleMjxContainerCount - 1) + Math.max(0, matched.length - 1)
    // InkChapter overlay flow projection count.
    base.flowProjectionCount = host.querySelectorAll('[data-inkchapter-formula-number]').length

    const planEntry = input.plan?.entries.find((e) => e.formulaIndex === formulaIndex)
    base.authorized = !!planEntry && planEntry.authorizationState === 'READY' && planEntry.managedEligible
    // Truthful reporting: injectionObserved / fulfillment identity come from
    // ACTUAL injected calls (independent of the visual outcome).
    base.injectionObserved = injectedFormulaFlags.has(formulaIndex)
    base.exactFulfillmentNodeMatch = injectedFulfillmentFlags.has(formulaIndex)

    if (base.visibleMjxContainerCount === 1 && base.nativeTagVisibleCount === 1 && base.expectedTagMatched && base.duplicateOutputCount === 0 && base.flowProjectionCount === 0) {
      base.decision = 'PASS'
    } else {
      base.decision = 'FAIL'
      base.reason = base.visibleMjxContainerCount !== 1 ? 'VISIBLE_MJX_COUNT_MISMATCH'
        : base.expectedTagMatched ? 'DUPLICATE_OR_PROJECTION'
          : 'TAG_NOT_VISIBLE'
    }
    return base
  }

  // R5.4.1: verify EVERY managed formula (append/insert shifts indices; the
  // old Formula0/Formula1-only loop would miss Formula2 and later formulas).
  const results = input.formulas.map((f) => verifyFormula(f.host, f.formulaIndex, f.desiredTag))
  const f0 = results.find((r) => r.formulaIndex === 0) ?? verifyFormula(null, 0, '')
  const f1 = results.find((r) => r.formulaIndex === 1) ?? verifyFormula(null, 1, '')

  // Emit native tag visual authority + duplicate barrier per formula.
  for (const r of results) {
    emitRuntimeAudit('FORMULA-MATHJAX-NATIVE-TAG-VISUAL-AUTHORITY', {
      formulaIndex: r.formulaIndex,
      desiredTag: r.desiredTag,
      expectedVisibleLabel: r.expectedVisibleLabel,
      visibleMjxContainerCount: r.visibleMjxContainerCount,
      nativeTagCandidateCount: r.visibleMjxContainerCount,
      nativeTagVisibleCount: r.nativeTagVisibleCount,
      nativeTagText: r.nativeTagText,
      expectedTagMatched: r.expectedTagMatched,
      flowProjectionCount: r.flowProjectionCount,
      legacyReconcileInvoked: r.legacyReconcileInvoked,
      decision: r.decision === 'PASS' ? 'PASS' : 'FAIL',
      reason: r.reason,
      runtimeMarker: R54_RUNTIME_MARKER,
    })
    emitRuntimeAudit('MATHJAX-TAG-INJECTION-DUPLICATE-OUTPUT-VERIFY', {
      formulaIndex: r.formulaIndex,
      visibleMjxContainerCount: r.visibleMjxContainerCount,
      visibleMathOutputCount: r.visibleMjxContainerCount,
      nativeTagVisibleCount: r.nativeTagVisibleCount,
      duplicateMjxContainerCount: r.visibleMjxContainerCount - 1,
      duplicateFormulaOutputCount: r.duplicateOutputCount,
      decision: r.visibleMjxContainerCount === 1 && r.duplicateOutputCount === 0 ? 'PASS' : 'FAIL',
      reason: r.visibleMjxContainerCount === 1 && r.duplicateOutputCount === 0 ? null : 'DUPLICATE_OR_COUNT_MISMATCH',
      runtimeMarker: R54_RUNTIME_MARKER,
    })
    emitRuntimeAudit('FORMULA-TAG-INJECTION-OUTPUT-CORRELATION', {
      formulaIndex: r.formulaIndex,
      desiredTag: r.desiredTag,
      authorizedCallOrdinal: null,
      fulfillmentNodeToken: null,
      canonicalHostToken: r.formulaIndex + 1,
      exactFulfillmentNodeMatch: r.exactFulfillmentNodeMatch,
      hostContainsFulfillmentNode: r.visibleMjxContainerCount > 0,
      visibleMjxContainerCount: r.visibleMjxContainerCount,
      decision: r.decision === 'PASS' ? 'PASS' : 'FAIL',
      reason: r.reason,
      runtimeMarker: R54_RUNTIME_MARKER,
    })
  }

  const sourceShaMatch = input.sourceShaBefore === input.documentSourceSha256
  const visualPass = f0.expectedTagMatched && f1.expectedTagMatched && f0.nativeTagVisibleCount === 1 && f1.nativeTagVisibleCount === 1 && f0.visibleMjxContainerCount === 1 && f1.visibleMjxContainerCount === 1 && f0.duplicateOutputCount === 0 && f1.duplicateOutputCount === 0
  const architecturePass = f0.injectionObserved && f1.injectionObserved && f0.exactFulfillmentNodeMatch && f1.exactFulfillmentNodeMatch && f0.duplicateOutputCount === 0 && f1.duplicateOutputCount === 0 && sourceShaMatch
  const strategyATagEffect: InjectionVerificationResult['strategyATagEffect'] = visualPass ? 'PASS' : (architecturePass ? 'FAIL' : 'PARTIAL')

  emitRuntimeAudit('FORMULA-TEX2SVG-INJECTION-FINAL', {
    documentKey: input.documentKey,
    documentSourceSha256: input.documentSourceSha256,
    planRevision: input.plan?.planRevision ?? null,
    formulaCount: results.length,
    formula0DesiredTag: f0.desiredTag,
    formula1DesiredTag: f1.desiredTag,
    formula0Authorized: f0.authorized,
    formula1Authorized: f1.authorized,
    formula0AuthorizationKind: 'EXACT_NORMALIZED_SOURCE_MATCH',
    formula1AuthorizationKind: 'EXACT_NORMALIZED_SOURCE_MATCH',
    formula0InjectionObserved: f0.injectionObserved,
    formula1InjectionObserved: f1.injectionObserved,
    formula0FulfillmentIdentity: f0.exactFulfillmentNodeMatch,
    formula1FulfillmentIdentity: f1.exactFulfillmentNodeMatch,
    formula0VisibleTag: f0.nativeTagText,
    formula1VisibleTag: f1.nativeTagText,
    formula0ExpectedTagMatched: f0.expectedTagMatched,
    formula1ExpectedTagMatched: f1.expectedTagMatched,
    formula0DuplicateOutputCount: f0.duplicateOutputCount,
    formula1DuplicateOutputCount: f1.duplicateOutputCount,
    nonTargetPassThroughCount,
    sourceShaMatch,
    firstOpenSupport: 'REPORTED',
    disableRestoreObserved: false,
    reenableCustomTagObserved: false,
    strategyATagEffect,
    decision: visualPass ? 'PASS' : (architecturePass ? 'FAIL' : 'PARTIAL'),
    reason: visualPass ? null : (architecturePass ? 'TAG_NOT_REFLECTED_IN_OUTPUT' : 'OUTPUT_VERIFICATION_INCOMPLETE'),
    runtimeMarker: R54_RUNTIME_MARKER,
  })

  return {
    formula0: f0,
    formula1: f1,
    nonTargetPassThroughCount,
    sourceShaMatch,
    strategyATagEffect,
    decision: visualPass ? 'PASS' : (architecturePass ? 'FAIL' : 'PARTIAL'),
  }
}
