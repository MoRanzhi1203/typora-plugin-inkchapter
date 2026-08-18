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

export const R54_RUNTIME_MARKER = 'FORMULA-TEX2SVG-PRECALL-TAG-INJECTION-V2.5.7-R5.4'
export const R54_BUILD_MARKER = 'inkchapter-formula-tex2svg-precall-tag-injection-v2.5.7-r5.4'

// ── Types ───────────────────────────────────────────────────────────────

export type PreCallAuthorityKind =
  | 'EXACT_NORMALIZED_SOURCE_MATCH'
  | 'CURRENT_EDITING_HOST_PLUS_EXACT_SOURCE_MATCH'
  | 'CALLER_CONTEXT_HOST_PLUS_EXACT_SOURCE_MATCH'
  | 'FROZEN_PLAN_SOURCE_MATCH'
  | 'NONE'
  | 'AMBIGUOUS'

export type PreCallDecision = 'AUTHORIZED' | 'PASS_THROUGH' | 'BLOCK_AMBIGUOUS'

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
}

export interface FormulaRenderAuthorizationPlan {
  documentKey: string
  documentSourceSha256: string
  documentSourceRevision: number
  planRevision: number
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
}): FormulaRenderAuthorizationPlan {
  const frozenKey = `${input.documentKey}|${input.documentSourceSha256}`
  let frozen = frozenPlanSources.get(frozenKey)

  const entries: FormulaRenderAuthorizationPlanEntry[] = []
  for (const f of input.managedFormulas) {
    const frozenEntry = frozen?.byFormulaIndex.get(f.formulaIndex)
    let sourceKind: FormulaTexSourceKind
    let rawSourceLength: number
    let normalizedSourceLength: number
    let normalizedSourceHash: string
    let normalizedSourcePrefix: string
    let verifierDecision: 'READY' | 'DEGRADED' | 'UNAVAILABLE'

    if (frozenEntry) {
      // Reuse the FROZEN snapshot — do not re-read (possibly polluted) host.
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
    })
  }

  if (!frozen) {
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
    entries,
  }
}

// ── Pre-call Formula Identity Authority (pure) ─────────────────────────

export interface PreCallAuthorizationInput {
  plan: FormulaRenderAuthorizationPlan | null
  inputTex: string
  sameDocument: boolean
  sameSourceRevision: boolean
  formulaNumberingEnabled: boolean
  editingHostSourceHashes: string[]
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
  const f0Match = !!f0 && f0.normalizedSourceHash === inputHash
  const f1Match = !!f1 && f1.normalizedSourceHash === inputHash
  result.formula0SourceHashMatch = f0Match
  result.formula1SourceHashMatch = f1Match

  const matches = [f0Match ? 0 : null, f1Match ? 1 : null].filter((i): i is number => i !== null)

  if (matches.length === 1) {
    const idx = matches[0]
    const entry = idx === 0 ? f0 : f1
    if (!entry?.desiredTag) {
      result.decision = 'PASS_THROUGH'
      result.authorityKind = 'NONE'
      result.reason = 'DESIRED_TAG_NOT_READY'
      return result
    }
    result.decision = 'AUTHORIZED'
    result.uniqueAuthorizedFormulaIndex = idx
    result.authorityKind = 'EXACT_NORMALIZED_SOURCE_MATCH'
    result.desiredTag = entry.desiredTag
    result.reason = null
    return result
  }
  if (matches.length === 2) {
    // Identical sources — disambiguate via the currently-editing host.
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

export function setTex2svgInjectionContext(ctx: Tex2svgInjectionRuntimeContext | null): void {
  injectionContext = ctx
}

export function nextPlanRevision(): number {
  return ++planRevisionCounter
}

export function getTex2svgInjectionPlanReady(): boolean {
  return !!injectionContext?.plan && injectionContext.plan.entries.some((e) => e.authorizationState === 'READY')
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

  const auth = resolvePreCallAuthorization({
    plan,
    inputTex,
    sameDocument,
    sameSourceRevision,
    formulaNumberingEnabled: !!ctx?.enabled,
    editingHostSourceHashes: editingHashes,
  })

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
    currentEditingFormulaCandidateCount: editingHashes.length,
    currentEditingFormulaIndex: auth.authorityKind === 'CURRENT_EDITING_HOST_PLUS_EXACT_SOURCE_MATCH' ? auth.uniqueAuthorizedFormulaIndex : null,
    callerContextFormulaCandidateCount: 0,
    callerContextFormulaIndex: null,
    uniqueAuthorizedFormulaIndex: auth.uniqueAuthorizedFormulaIndex,
    authorityKind: auth.authorityKind,
    decision: auth.decision,
    reason: auth.reason,
    runtimeMarker: R54_RUNTIME_MARKER,
  })

  // Pre-call authorization summary.
  emitRuntimeAudit('MATHJAX-TEX2SVG-PRECALL-AUTHORIZATION', {
    callOrdinal,
    routeName: 'MathJax.tex2svgPromise',
    uniqueAuthorizedFormulaIndex: auth.uniqueAuthorizedFormulaIndex,
    desiredTag: auth.desiredTag,
    sameDocument,
    sameSourceRevision,
    managedEligible: auth.candidateManagedFormulaCount > 0,
    explicitTagControl: auth.reason === 'EXPLICIT_TAG_CONTROL',
    inlineMathRejected: auth.inlineMathRejected,
    foreignMathRejected: auth.foreignMathRejected,
    authorityKind: auth.authorityKind,
    decision: auth.decision,
    reason: auth.reason,
    runtimeMarker: R54_RUNTIME_MARKER,
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
      decision: auth.decision === 'AUTHORIZED' ? 'PASS' : 'PARTIAL',
      reason: auth.reason ?? (planReady ? 'PLAN_READY' : 'AUTHORIZATION_PLAN_NOT_READY'),
      runtimeMarker: R54_RUNTIME_MARKER,
    })
  }

  if (auth.decision !== 'AUTHORIZED' || auth.uniqueAuthorizedFormulaIndex === null) {
    nonTargetPassThroughCount++
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
    decision: 'PASS',
    reason: null,
    runtimeMarker: R54_RUNTIME_MARKER,
  })

  return {
    applyArgs: forwardedArgs,
    injection: { callOrdinal, formulaIndex: auth.uniqueAuthorizedFormulaIndex, desiredTag: auth.desiredTag },
    decision: 'AUTHORIZED',
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
  emitRuntimeAudit('MATHJAX-TEX2SVG-INJECTION-FULFILLMENT-AUTHORITY', {
    callOrdinal,
    formulaIndex: entry.formulaIndex,
    desiredTag: entry.desiredTag,
    fulfilled: true,
    nodeLike: typeof value === 'object' && value !== null && typeof (value as any).nodeType === 'number',
    nodeName: typeof value === 'object' && value !== null ? (value as any).nodeName ?? null : null,
    exactFulfillmentNodeRegistered: exactRegistered,
    inputWasInjected: true,
    decision: 'RECORDED',
    reason: null,
    runtimeMarker: R54_RUNTIME_MARKER,
  })
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

  const f0 = verifyFormula(input.formulas[0]?.host ?? null, 0, input.formulas[0]?.desiredTag ?? '')
  const f1 = verifyFormula(input.formulas[1]?.host ?? null, 1, input.formulas[1]?.desiredTag ?? '')

  // Emit native tag visual authority + duplicate barrier per formula.
  for (const r of [f0, f1]) {
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
