/**
 * v2.5.7-R5.3.1: MathJax Render Result + Call-Local DOM Delta + External Caller Authority.
 *
 * Repair phases on top of R5.3:
 *   A. Original Promise/thenable fulfillment authority
 *   B. Fulfillment deep-shape probe (structural node-like, not just instanceof)
 *   C. Call-local DOM delta object identity (one-shot MutationObserver per call)
 *   D. External caller authority (wrapper/audit/trampoline frames filtered)
 *   E. Formula non-edit TeX source verifier (see formula-tex-source-verifier.ts)
 *
 * TRANSPARENT hooks only — preserve this/args/sync return/Promise identity/
 * thrown Error/rejection. The original result is ALWAYS returned.
 * No active MathJax calls, no tag injection, no DOM surgery, no polling.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { verifyFormulaTexSource, type FormulaTexSourceKind } from './formula-tex-source-verifier'
import { handleTex2svgPreCall, reportInjectionFulfillment } from './mathjax-tex2svg-tag-injection'
import { setOriginalTex2svgPromise } from './formula-render-projection'

export const R531_RUNTIME_MARKER = 'FORMULA-RENDER-RESULT-CALLER-AUTHORITY-V2.5.7-R5.3.1'
export const R53_RUNTIME_MARKER = 'FORMULA-TYPORA-RENDER-ROUTE-AUTHORITY-V2.5.7-R5.3'
export const R531_BUILD_MARKER = 'inkchapter-formula-render-result-caller-authority-v2.5.7-r5.3.1'

export type RouteTier = 1 | 2 | 3

export type RouteAuthority =
  | 'EXACT_FULFILLMENT_NODE_IDENTITY'
  | 'FULFILLMENT_SUBTREE_IDENTITY'
  | 'CALL_LOCAL_DOM_DELTA_IDENTITY'
  | 'CALL_LOCAL_DOM_REPLACEMENT_IDENTITY'
  | 'CALL_LOCAL_SUBTREE_IDENTITY'
  | 'HOST_CONTAINS_FULFILLMENT_NODE'
  | 'HOST_CONTAINS_FULFILLMENT_DESCENDANT'
  | 'CALL_PLUS_INPUT_HASH_VERIFIER'
  | 'NONE'
  | 'AMBIGUOUS'

export type RouteCorrelationDecision = 'PASS' | 'PROVISIONAL' | 'FAIL'

export type RouteCase = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export type ExternalCallerKind =
  | 'TYPORA_RENDERER_SCRIPT'
  | 'TYPORA_APP_SCRIPT'
  | 'INKCHAPTER_BUSINESS_CALLER'
  | 'MATHJAX_INTERNAL'
  | 'ELECTRON_INTERNAL'
  | 'UNKNOWN'

export type DeltaNodeKind = 'ADDED' | 'REPLACED' | 'SUBTREE'

// ── Identity Bridges ───────────────────────────────────────────────────

/** fulfillment node → route call record. */
export const returnedNodeRoutes = new WeakMap<Node, RouteCallRecord>()
/** call-local delta node → route call record. */
export const deltaNodeRoutes = new WeakMap<Node, RouteCallRecord>()
/** call-local delta node → kind (ADDED/REPLACED/SUBTREE). */
export const deltaNodeKinds = new WeakMap<Node, DeltaNodeKind>()

// ── Route Call Record ──────────────────────────────────────────────────

export interface RouteCallRecord {
  routeName: string
  ownerName: string
  tier: RouteTier
  callOrdinal: number
  timestamp: number
  documentKey: string | null
  documentGeneration: number | null
  renderWindowId: string
  argCount: number
  inputString: string
  inputHash: string
  inputLength: number
  inputPrefix: string
  displayOption: string | null
  optionsSummary: Record<string, unknown>
  stackTop: string[]
  stackHash: string
  callerFrames: string[]
  /** Frames after filtering wrapper/audit/trampoline frames. */
  externalCallerFrame: string | null
  externalCallerSourceKind: ExternalCallerKind
  /** Fulfillment node objects (Phase A/B). */
  fulfillmentNodes: Node[]
  fulfillmentUndefined: boolean
  fulfillmentNodeLike: boolean
  /** Call-local delta node objects (Phase C). */
  deltaNodes: Node[]
  /** Call-local removed node objects (Phase C). */
  removedNodes: Node[]
  deltaKind: DeltaNodeKind | null
  /** Math blocks present at call start (heuristic canonical blocks). */
  mathBlocks: HTMLElement[]
  beforeMjxCounts: Map<HTMLElement, number>
  afterMjxCounts: Map<HTMLElement, number>
  activeCallCountAtStart: number
  maxConcurrentCallCount: number
  overlapDetected: boolean
  observerDisconnected: boolean
  settled: boolean
  returnedNodeCount: number
}

// ── Pure helpers (exported for tests) ──────────────────────────────────

export function simpleHash(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash.toString(16)
}

/** Strip $$ delimiters so captured tex2svg input compares against source tex. */
export function normalizeTex(s: string): string {
  return s.trim().replace(/^\$\$\s*/, '').replace(/\s*\$\$$/, '').trim()
}

function objectTag(value: unknown): string {
  try {
    return Object.prototype.toString.call(value)
  } catch {
    return 'unknown'
  }
}

function constructorName(value: unknown): string | null {
  try {
    const ctor = (value as any)?.constructor
    return typeof ctor?.name === 'string' && ctor.name.length > 0 ? ctor.name : null
  } catch {
    return null
  }
}

export interface RoutePreCallTransformResult {
  applyArgs: unknown[]
  injection: { callOrdinal: number; formulaIndex: number; desiredTag: string } | null
}

/**
 * Transparent wrapper factory — hard contract. Captures the caller stack
 * BEFORE invoking the original so the first frame after the wrapper itself is
 * the real external caller (no audit-helper trampoline pollution).
 * An optional pre-call transform (used by R5.4 tag injection) may swap the
 * args passed to the original; the caller's original args are never mutated.
 */
export function makeTransparentWrapper(
  original: Function,
  observer: (result: unknown, thisArg: unknown, args: unknown[], preCallStack: string, applyArgs: unknown[], injection: RoutePreCallTransformResult['injection']) => void,
  preCallTransform?: (args: unknown[], thisArg: unknown, preCallStack: string) => RoutePreCallTransformResult | null,
): Function {
  return function transparentWrapper(this: unknown, ...args: unknown[]): unknown {
    let preCallStack = ''
    try { preCallStack = new Error().stack ?? '' } catch { /* ignore */ }
    let applyArgs: unknown[] = args
    let injection: RoutePreCallTransformResult['injection'] = null
    try {
      const transformed = preCallTransform ? preCallTransform(args, this, preCallStack) : null
      if (transformed) {
        applyArgs = transformed.applyArgs
        injection = transformed.injection
      }
    } catch {
      applyArgs = args
      injection = null
    }
    const result = Reflect.apply(original, this, applyArgs)
    try {
      observer(result, this, args, preCallStack, applyArgs, injection)
    } catch {
      // Observation must never affect the real call.
    }
    return result
  }
}

// ── State ──────────────────────────────────────────────────────────────

interface RouteCandidate {
  routeName: string
  ownerName: string
  tier: RouteTier
  owner: any
  prop: string
  callable: boolean
  descriptorReadable: boolean
  descriptorWritable: boolean
  descriptorConfigurable: boolean
  hookable: boolean
  original: any
  wrapper: any
  installed: boolean
  installationCount: number
  callCount: number
}

const functionTokens = new WeakMap<Function, number>()
const objectTokens = new WeakMap<object, number>()
let nextToken = 1

let installedCandidates: RouteCandidate[] = []
let hookInstallTimestamp: number | null = null
let candidateInventoryEmitted = false
let callOrdinalCounter = 0
let emittedMarkerCount = 0
const MAX_EMITTED_MARKERS = 140
let currentDocumentKey: string | null = null
let currentDocumentGeneration: number | null = null
let renderWindowCounter = 0
let currentRenderWindowId = 'rw-unknown'
let currentEditorRoot: HTMLElement | null = null
const allRouteRecords: RouteCallRecord[] = []

function tokenForFn(fn: Function): number {
  let t = functionTokens.get(fn)
  if (t === undefined) {
    t = nextToken++
    functionTokens.set(fn, t)
  }
  return t
}

function tokenForObj(obj: object): number {
  let t = objectTokens.get(obj)
  if (t === undefined) {
    t = nextToken++
    objectTokens.set(obj, t)
  }
  return t
}

function findInstalledCandidate(routeName: string): RouteCandidate | undefined {
  return installedCandidates.find((c) => c.routeName === routeName)
}

// ── Candidate Inventory ────────────────────────────────────────────────

const TIER1_CANDIDATES = ['tex2svg', 'tex2svgPromise', 'tex2chtml', 'tex2chtmlPromise', 'typeset', 'typesetPromise']
const TIER2_CANDIDATES = ['convert', 'render', 'rerender', 'compile', 'typeset', 'updateDocument']

function ownerFor(mj: any, tier: RouteTier, index: number): { owner: any; ownerName: string } {
  if (tier === 1) return { owner: mj, ownerName: 'MathJax' }
  if (tier === 2) return { owner: mj?.startup?.document, ownerName: 'MathJax.startup.document' }
  if (index === 0) return { owner: mj?.startup?.input?.[0], ownerName: 'MathJax.startup.input[0]' }
  return { owner: mj?.startup?.output, ownerName: 'MathJax.startup.output' }
}

function buildCandidates(mj: any): RouteCandidate[] {
  const out: RouteCandidate[] = []
  for (const name of TIER1_CANDIDATES) {
    const { owner, ownerName } = ownerFor(mj, 1, 0)
    out.push(makeCandidate(owner, ownerName, 1, name))
  }
  for (const name of TIER2_CANDIDATES) {
    const { owner, ownerName } = ownerFor(mj, 2, 0)
    out.push(makeCandidate(owner, ownerName, 2, name))
  }
  {
    const { owner, ownerName } = ownerFor(mj, 3, 0)
    out.push(makeCandidate(owner, ownerName, 3, 'compile'))
  }
  {
    const { owner, ownerName } = ownerFor(mj, 3, 1)
    out.push(makeCandidate(owner, ownerName, 3, 'typeset'))
  }
  return out
}

function makeCandidate(owner: any, ownerName: string, tier: RouteTier, prop: string): RouteCandidate {
  const callable = typeof owner?.[prop] === 'function'
  const descriptor = owner ? Object.getOwnPropertyDescriptor(owner, prop) : undefined
  const descriptorReadable = descriptor !== undefined
  const descriptorWritable = descriptor?.writable === true
  const descriptorConfigurable = descriptor?.configurable === true
  const hookable = callable && (descriptorWritable || descriptorConfigurable)
  return {
    routeName: `${ownerName}.${prop}`,
    ownerName,
    tier,
    owner,
    prop,
    callable,
    descriptorReadable,
    descriptorWritable,
    descriptorConfigurable,
    hookable,
    original: callable ? owner[prop] : undefined,
    wrapper: undefined,
    installed: false,
    installationCount: 0,
    callCount: 0,
  }
}

function emitInventory(candidates: RouteCandidate[]): void {
  for (const c of candidates) {
    emitRuntimeAudit('MATHJAX-RENDER-ROUTE-CANDIDATE-INVENTORY', {
      candidateName: c.routeName,
      ownerName: c.ownerName,
      tier: c.tier,
      callable: c.callable,
      descriptorReadable: c.descriptorReadable,
      descriptorWritable: c.descriptorWritable,
      descriptorConfigurable: c.descriptorConfigurable,
      hookable: c.hookable,
      decision: c.callable ? (c.hookable ? 'READY' : 'NOT_HOOKABLE') : 'NOT_CALLABLE',
      runtimeMarker: R53_RUNTIME_MARKER,
    })
  }
}

// ── Hook Install / Restore ─────────────────────────────────────────────

export function installRenderRouteHooks(): { decision: string; reason: string | null; installationCount: number } {
  const mj = typeof window !== 'undefined' ? (window as any).MathJax : null
  if (!mj) {
    emitRuntimeAudit('MATHJAX-RENDER-ROUTE-HOOK-INSTALL', {
      routeName: '*',
      ownerName: 'MathJax',
      tier: 1,
      callable: false,
      hookable: false,
      originalFunctionToken: null,
      wrapperFunctionToken: null,
      installationCount: 0,
      decision: 'BLOCK',
      reason: 'MATHJAX_NOT_AVAILABLE_AT_HOOK_INSTALL_TIME',
      runtimeMarker: R53_RUNTIME_MARKER,
    })
    return { decision: 'BLOCK', reason: 'MATHJAX_NOT_AVAILABLE_AT_HOOK_INSTALL_TIME', installationCount: 0 }
  }

  const candidates = buildCandidates(mj)
  if (!candidateInventoryEmitted) {
    candidateInventoryEmitted = true
    emitInventory(candidates)
  }

  let installedCount = 0
  for (const c of candidates) {
    if (!c.callable || !c.hookable) {
      emitRuntimeAudit('MATHJAX-RENDER-ROUTE-HOOK-INSTALL', {
        routeName: c.routeName,
        ownerName: c.ownerName,
        tier: c.tier,
        callable: c.callable,
        hookable: c.hookable,
        originalFunctionToken: c.original ? tokenForFn(c.original) : null,
        wrapperFunctionToken: null,
        installationCount: c.installationCount,
        decision: c.callable ? 'NOT_HOOKABLE' : 'NOT_CALLABLE',
        reason: c.callable ? 'DESCRIPTOR_NOT_WRITABLE' : null,
        runtimeMarker: R53_RUNTIME_MARKER,
      })
      continue
    }
    const existing = findInstalledCandidate(c.routeName)
    if (existing && existing.installed) {
      emitRuntimeAudit('MATHJAX-RENDER-ROUTE-HOOK-INSTALL', {
        routeName: existing.routeName,
        ownerName: existing.ownerName,
        tier: existing.tier,
        callable: existing.callable,
        hookable: existing.hookable,
        originalFunctionToken: existing.original ? tokenForFn(existing.original) : null,
        wrapperFunctionToken: existing.wrapper ? tokenForFn(existing.wrapper) : null,
        installationCount: existing.installationCount,
        decision: 'ALREADY_INSTALLED',
        reason: null,
        runtimeMarker: R53_RUNTIME_MARKER,
      })
      installedCount++
      continue
    }
    try {
      const candidate = existing ?? c
      if (!existing) installedCandidates.push(candidate)
      const original = candidate.original
      const isTex2svgPromise = candidate.routeName === 'MathJax.tex2svgPromise'
      const preCallTransform = isTex2svgPromise
        ? (args: unknown[], thisArg: unknown, preCallStack: string): RoutePreCallTransformResult | null => {
            const r = handleTex2svgPreCall(args, thisArg, preCallStack)
            return { applyArgs: r.applyArgs, injection: r.injection }
          }
        : undefined
      const wrapper = makeTransparentWrapper(
        original,
        (result, thisArg, args, preCallStack, _applyArgs, injection) => {
          observeRouteCall(candidate, result, thisArg, args, preCallStack, injection)
        },
        preCallTransform,
      )
      candidate.owner[candidate.prop] = wrapper
      candidate.wrapper = wrapper
      candidate.installed = true
      candidate.installationCount = 1
      installedCount++
      // R5.4.3.10 P0-C: Save original tex2svgPromise for production fulfillment provider.
      if (isTex2svgPromise && original) {
        setOriginalTex2svgPromise(original as (...args: unknown[]) => Promise<unknown>)
        emitRuntimeAudit('FORMULA-PROJECTION-PROVIDER-INSTALL', {
          originalTex2svgPromiseCallable: true,
          originalFunctionToken: tokenForFn(original),
          wrapperFunctionToken: tokenForFn(wrapper),
          sameFunction: false,
          providerInstalled: true,
          installationCount: 1,
          decision: 'PASS',
          reason: null,
          runtimeMarker: 'FORMULA-ATOMIC-TRANSACTION-RENDER-PROJECTION-V2.5.7-R5.4.3.9',
        })
      }
      if (hookInstallTimestamp === null) hookInstallTimestamp = Date.now()
      emitRuntimeAudit('MATHJAX-RENDER-ROUTE-HOOK-INSTALL', {
        routeName: candidate.routeName,
        ownerName: candidate.ownerName,
        tier: candidate.tier,
        callable: candidate.callable,
        hookable: candidate.hookable,
        originalFunctionToken: tokenForFn(original),
        wrapperFunctionToken: tokenForFn(wrapper),
        installationCount: 1,
        decision: 'INSTALLED',
        reason: null,
        runtimeMarker: R53_RUNTIME_MARKER,
      })
    } catch (e: any) {
      emitRuntimeAudit('MATHJAX-RENDER-ROUTE-HOOK-INSTALL', {
        routeName: c.routeName,
        ownerName: c.ownerName,
        tier: c.tier,
        callable: c.callable,
        hookable: c.hookable,
        originalFunctionToken: c.original ? tokenForFn(c.original) : null,
        wrapperFunctionToken: null,
        installationCount: 0,
        decision: 'FAILED',
        reason: String(e?.message ?? e),
        runtimeMarker: R53_RUNTIME_MARKER,
      })
    }
  }

  return { decision: installedCount > 0 ? 'INSTALLED' : 'NO_HOOKABLE_CANDIDATE', reason: null, installationCount: installedCount }
}

export function restoreRenderRouteHooks(): { restoredCount: number } {
  let restoredCount = 0
  for (const c of installedCandidates) {
    if (c.installed && c.original !== undefined) {
      try {
        c.owner[c.prop] = c.original
        c.installed = false
        restoredCount++
        emitRuntimeAudit('MATHJAX-RENDER-ROUTE-HOOK-RESTORE', {
          routeName: c.routeName,
          restored: true,
          originalReferenceRestored: c.owner[c.prop] === c.original,
          decision: 'RESTORED',
          runtimeMarker: R53_RUNTIME_MARKER,
        })
      } catch (e: any) {
        emitRuntimeAudit('MATHJAX-RENDER-ROUTE-HOOK-RESTORE', {
          routeName: c.routeName,
          restored: false,
          originalReferenceRestored: false,
          decision: 'FAILED',
          reason: String(e?.message ?? e),
          runtimeMarker: R53_RUNTIME_MARKER,
        })
      }
    }
  }
  installedCandidates = []
  hookInstallTimestamp = null
  return { restoredCount }
}

// ── Context ────────────────────────────────────────────────────────────

export function setRouteTraceContext(documentKey: string, documentGeneration: number): void {
  currentDocumentKey = documentKey
  currentDocumentGeneration = documentGeneration
  currentRenderWindowId = `rw-${++renderWindowCounter}`
}

export function setRouteTraceEditorRoot(root: HTMLElement | null): void {
  currentEditorRoot = root
}

// ── Call Capture ───────────────────────────────────────────────────────

function extractInputString(args: unknown[]): { inputString: string; inputHash: string; inputLength: number; inputPrefix: string; inputFound: boolean } {
  for (const a of args) {
    if (typeof a === 'string') {
      const inputString = a
      return {
        inputString,
        inputHash: simpleHash(normalizeTex(inputString)),
        inputLength: inputString.length,
        inputPrefix: inputString.slice(0, 80),
        inputFound: true,
      }
    }
  }
  return { inputString: '', inputHash: '', inputLength: 0, inputPrefix: '', inputFound: false }
}

const OPTION_WHITELIST = ['display', 'em', 'ex', 'containerWidth', 'scale', 'family']

function extractOptions(args: unknown[]): { display: string | null; summary: Record<string, unknown> } {
  for (const a of args) {
    if (a !== null && typeof a === 'object' && !Array.isArray(a)) {
      const obj = a as Record<string, unknown>
      const summary: Record<string, unknown> = {}
      for (const key of OPTION_WHITELIST) {
        if (obj[key] !== undefined) summary[key] = obj[key]
      }
      return { display: typeof obj.display === 'string' ? obj.display : null, summary }
    }
  }
  return { display: null, summary: {} }
}

function parseStackFrames(stack: string): string[] {
  return stack.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('at ')).map((f) => f.replace(/\s+/g, ' ').slice(0, 240))
}

/**
 * External caller filtering — drop the audit frames (wrapper + Reflect.apply
 * trampoline + log-only helpers), never blanket-delete main.js frames.
 */
export function filterExternalCallerFrames(frames: string[]): {
  rawFrameCount: number
  filteredFrameCount: number
  wrapperFrameCount: number
  mathJaxInternalFrameCount: number
  firstNonWrapperFrame: string | null
  firstNonAuditFrame: string | null
  externalCallerFrame: string | null
} {
  const rawFrameCount = frames.length
  const AUDIT_MARKERS = ['transparentWrapper', 'observeRouteCall', 'captureStackFrames', 'reflect.apply', 'observeReturn']
  let wrapperFrameCount = 0
  let mathJaxInternalFrameCount = 0

  const filtered = frames.filter((f) => {
    const lower = f.toLowerCase()
    const isAudit = AUDIT_MARKERS.some((m) => lower.includes(m.toLowerCase()))
    if (isAudit) wrapperFrameCount++
    if (lower.includes('mathjax')) mathJaxInternalFrameCount++
    return !isAudit
  })

  const externalCallerFrame = filtered.length > 0 ? filtered[0] : null
  return {
    rawFrameCount,
    filteredFrameCount: filtered.length,
    wrapperFrameCount,
    mathJaxInternalFrameCount,
    firstNonWrapperFrame: filtered[0] ?? null,
    firstNonAuditFrame: filtered[0] ?? null,
    externalCallerFrame,
  }
}

export function classifyExternalCaller(frames: string[]): { sourceKind: ExternalCallerKind; observed: boolean } {
  const joined = frames.join('\n').toLowerCase()
  if (joined.includes('inkchapter')) return { sourceKind: 'INKCHAPTER_BUSINESS_CALLER', observed: true }
  if (joined.includes('typora') || joined.includes('\\resources\\app') || joined.includes('/resources/app')) {
    // Renderer scripts live under Typora's resources (renderer.html / preload).
    if (joined.includes('renderer') || joined.includes('preload')) return { sourceKind: 'TYPORA_RENDERER_SCRIPT', observed: true }
    return { sourceKind: 'TYPORA_APP_SCRIPT', observed: true }
  }
  if (joined.includes('mathjax')) return { sourceKind: 'MATHJAX_INTERNAL', observed: true }
  if (joined.includes('electron')) return { sourceKind: 'ELECTRON_INTERNAL', observed: true }
  return { sourceKind: 'UNKNOWN', observed: false }
}

function observeRouteCall(
  candidate: RouteCandidate,
  result: unknown,
  _thisArg: unknown,
  args: unknown[],
  preCallStack: string,
  injection: RoutePreCallTransformResult['injection'] = null,
): void {
  try {
    const callOrdinal = injection?.callOrdinal ?? ++callOrdinalCounter
    const input = extractInputString(args)
    const options = extractOptions(args)
    const rawFrames = parseStackFrames(preCallStack)
    // frame0 is the wrapper itself — drop it, then filter audit names.
    const callerFrames = rawFrames.slice(1)
    const filtered = filterExternalCallerFrames(callerFrames)
    const externalKind = classifyExternalCaller(filtered.filteredFrameCount > 0
      ? [filtered.externalCallerFrame ?? '']
      : [])
    const activeCallCountAtStart = activeCallCount
    const overlapDetected = activeCallCountAtStart > 0

    const record: RouteCallRecord = {
      routeName: candidate.routeName,
      ownerName: candidate.ownerName,
      tier: candidate.tier,
      callOrdinal,
      timestamp: Date.now(),
      documentKey: currentDocumentKey,
      documentGeneration: currentDocumentGeneration,
      renderWindowId: currentRenderWindowId,
      argCount: args.length,
      inputString: input.inputString,
      inputHash: input.inputHash,
      inputLength: input.inputLength,
      inputPrefix: input.inputPrefix,
      displayOption: options.display,
      optionsSummary: options.summary,
      stackTop: rawFrames.slice(0, 5),
      stackHash: simpleHash(preCallStack),
      callerFrames: callerFrames,
      externalCallerFrame: filtered.externalCallerFrame,
      externalCallerSourceKind: externalKind.sourceKind,
      fulfillmentNodes: [],
      fulfillmentUndefined: false,
      fulfillmentNodeLike: false,
      deltaNodes: [],
      removedNodes: [],
      deltaKind: null,
      mathBlocks: [],
      beforeMjxCounts: new Map(),
      afterMjxCounts: new Map(),
      activeCallCountAtStart,
      maxConcurrentCallCount: Math.max(1, activeCallCountAtStart + 1),
      overlapDetected,
      observerDisconnected: false,
      settled: false,
      returnedNodeCount: 0,
    }
    allRouteRecords.push(record)
    candidate.callCount++

    if (emittedMarkerCount < MAX_EMITTED_MARKERS) {
      emittedMarkerCount++
      emitRuntimeAudit('MATHJAX-RENDER-ROUTE-CALL', {
        routeName: candidate.routeName,
        ownerName: candidate.ownerName,
        tier: candidate.tier,
        callOrdinal,
        timestamp: record.timestamp,
        documentKey: record.documentKey,
        documentGeneration: record.documentGeneration,
        renderWindowId: record.renderWindowId,
        argCount: record.argCount,
        inputStringFound: input.inputFound,
        inputLength: record.inputLength,
        inputHash: record.inputHash,
        inputPrefix: record.inputPrefix,
        displayOption: record.displayOption,
        optionsSummary: record.optionsSummary,
        stackTop: record.stackTop,
        stackHash: record.stackHash,
        runtimeMarker: R53_RUNTIME_MARKER,
      })
      emitRuntimeAudit('MATHJAX-RENDER-EXTERNAL-CALLER-AUTHORITY', {
        routeName: candidate.routeName,
        callOrdinal,
        rawFrameCount: filtered.rawFrameCount,
        filteredFrameCount: filtered.filteredFrameCount,
        wrapperFrameCount: filtered.wrapperFrameCount,
        mathJaxInternalFrameCount: filtered.mathJaxInternalFrameCount,
        firstNonWrapperFrame: filtered.firstNonWrapperFrame,
        firstNonAuditFrame: filtered.firstNonAuditFrame,
        externalCallerFrame: filtered.externalCallerFrame,
        externalCallerSourceKind: externalKind.sourceKind,
        externalCallerObserved: externalKind.observed,
        decision: externalKind.sourceKind === 'INKCHAPTER_BUSINESS_CALLER' ? 'BLOCK' : 'RECORDED',
        reason: externalKind.sourceKind === 'INKCHAPTER_BUSINESS_CALLER' ? 'INKCHAPTER_SELF_RENDER_CALL_DETECTED' : null,
        runtimeMarker: R531_RUNTIME_MARKER,
      })
    }

    // Phase C: call-local DOM delta window (one-shot observer per call).
    const scheduleFinalize = startCallLocalWindow(candidate, record)

    // Phase A/B: promise object + fulfillment authority.
    observeReturn(candidate, record, result, scheduleFinalize)
  } catch {
    // Observation must never break MathJax.
  }
}

// ── Phase C: Call-Local DOM Delta Window ───────────────────────────────

let activeCallCount = 0
const activeWindows = new Set<CallLocalWindow>()

const OBSERVED_TAGS = new Set(['MJX-CONTAINER', 'SVG', 'MJX-MATH'])

interface CallLocalWindow {
  record: RouteCallRecord
  observer: MutationObserver
  addedNodes: Node[]
  removedNodes: Node[]
  mathBlocks: HTMLElement[]
  beforeMjxCounts: Map<HTMLElement, number>
  finalized: boolean
}

function startCallLocalWindow(candidate: RouteCandidate, record: RouteCallRecord): (() => void) | null {
  const root = currentEditorRoot
  if (!root || typeof MutationObserver === 'undefined') return null

  activeCallCount++
  record.maxConcurrentCallCount = Math.max(record.maxConcurrentCallCount, activeCallCount)
  if (activeCallCount > 1) {
    record.overlapDetected = true
    // Mark all previously active windows as overlapping too.
    for (const w of activeWindows) w.record.overlapDetected = true
  }

  // Heuristic canonical math blocks present at call start (hosts unknown yet).
  let mathBlocks: HTMLElement[] = []
  try {
    mathBlocks = Array.from(root.querySelectorAll<HTMLElement>('.md-math-block, .mathjax-block'))
  } catch { /* ignore */ }
  const beforeMjxCounts = new Map<HTMLElement, number>()
  for (const block of mathBlocks) {
    try { beforeMjxCounts.set(block, block.querySelectorAll('mjx-container').length) } catch { beforeMjxCounts.set(block, 0) }
  }
  record.mathBlocks = mathBlocks
  record.beforeMjxCounts = beforeMjxCounts

  const windowCtx: CallLocalWindow = {
    record,
    observer: null as unknown as MutationObserver,
    addedNodes: [],
    removedNodes: [],
    mathBlocks,
    beforeMjxCounts,
    finalized: false,
  }

  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node instanceof Element && OBSERVED_TAGS.has(node.tagName)) windowCtx.addedNodes.push(node)
      }
      for (const node of mut.removedNodes) {
        if (node instanceof Element && OBSERVED_TAGS.has(node.tagName)) windowCtx.removedNodes.push(node)
      }
    }
  })
  windowCtx.observer = observer
  try {
    observer.observe(root, { childList: true, subtree: true })
  } catch {
    record.observerDisconnected = true
    activeCallCount = Math.max(0, activeCallCount - 1)
    return null
  }
  activeWindows.add(windowCtx)

  const finalize = (): void => {
    if (windowCtx.finalized) return
    windowCtx.finalized = true
    try { observer.disconnect() } catch { /* ignore */ }
    record.observerDisconnected = true
    record.settled = true
    activeWindows.delete(windowCtx)
    activeCallCount = Math.max(0, activeCallCount - 1)

    // Resolve per-block after counts.
    const afterMjxCounts = new Map<HTMLElement, number>()
    for (const block of windowCtx.mathBlocks) {
      try { afterMjxCounts.set(block, block.querySelectorAll('mjx-container').length) } catch { afterMjxCounts.set(block, 0) }
    }
    record.afterMjxCounts = afterMjxCounts
    record.removedNodes = windowCtx.removedNodes

    // Register delta nodes (mjx-container additions → ADDED / REPLACED; svg/mjx-math → SUBTREE).
    for (const node of windowCtx.addedNodes) {
      const el = node as Element
      const tag = el.tagName
      if (tag === 'MJX-CONTAINER') {
        const inExistingBlock = Array.from(windowCtx.mathBlocks).some((b) => {
          const before = windowCtx.beforeMjxCounts.get(b) ?? 0
          return before > 0 && b.contains(node)
        })
        const kind: DeltaNodeKind = inExistingBlock ? 'REPLACED' : 'ADDED'
        deltaNodeRoutes.set(node, record)
        deltaNodeKinds.set(node, kind)
        record.deltaNodes.push(node)
        record.deltaKind = kind
      } else {
        // svg / mjx-math subtree additions under existing mjx.
        deltaNodeRoutes.set(node, record)
        deltaNodeKinds.set(node, 'SUBTREE')
        record.deltaNodes.push(node)
        if (record.deltaKind === null) record.deltaKind = 'SUBTREE'
      }
    }

    emitRuntimeAudit('MATHJAX-RENDER-CALL-WINDOW-AUTHORITY', {
      routeName: candidate.routeName,
      callOrdinal: record.callOrdinal,
      renderCallWindowId: `w${record.callOrdinal}`,
      activeCallCountAtStart: record.activeCallCountAtStart,
      maxConcurrentCallCount: record.maxConcurrentCallCount,
      overlapDetected: record.overlapDetected,
      settled: record.settled,
      observerDisconnected: record.observerDisconnected,
      decision: record.overlapDetected ? 'OVERLAP' : 'CLEAN',
      reason: null,
      runtimeMarker: R531_RUNTIME_MARKER,
    })
  }

  // One-shot flush AFTER settle: a microtask, then a single requestAnimationFrame.
  const scheduleFinalize = (): void => {
    try {
      queueMicrotask(finalize)
    } catch {
      finalize()
      return
    }
    if (typeof requestAnimationFrame === 'function') {
      try {
        requestAnimationFrame(() => finalize())
      } catch {
        finalize()
      }
    }
  }

  return scheduleFinalize
}

// ── Phase A/B: Promise Object + Fulfillment Authority ──────────────────

function nodeLikeStructural(value: unknown): { nodeLike: boolean; nodeType: number | null; nodeName: string | null } {
  if (value !== null && typeof value === 'object') {
    const v = value as any
    if (typeof v.nodeType === 'number' && typeof v.nodeName === 'string') {
      return { nodeLike: true, nodeType: v.nodeType, nodeName: v.nodeName }
    }
  }
  return { nodeLike: false, nodeType: null, nodeName: null }
}

function registerFulfillmentNode(root: Node, record: RouteCallRecord): number {
  let count = 0
  try {
    const isFragment = root.nodeType === 11
    if (root.nodeType === 1 || isFragment) {
      if (!returnedNodeRoutes.has(root)) returnedNodeRoutes.set(root, record)
      record.fulfillmentNodes.push(root)
      count++
      const el = root as Element | DocumentFragment
      if (typeof el.querySelectorAll === 'function') {
        const matches = el.querySelectorAll('mjx-container, svg, mjx-math')
        for (const n of Array.from(matches)) {
          if (!returnedNodeRoutes.has(n)) returnedNodeRoutes.set(n, record)
          record.fulfillmentNodes.push(n)
          count++
        }
      }
    } else {
      if (!returnedNodeRoutes.has(root)) returnedNodeRoutes.set(root, record)
      record.fulfillmentNodes.push(root)
      count++
    }
  } catch { /* non-DOM */ }
  return count
}

function observeFulfilledValue(candidate: RouteCandidate, record: RouteCallRecord, value: unknown): void {
  const structural = nodeLikeStructural(value)
  const valueIsUndefined = value === undefined
  const valueIsNull = value === null
  const nodeLike = structural.nodeLike
  const isNodeInstance = typeof Node !== 'undefined' && value instanceof Node

  let descendantMjxContainerCount = 0
  let descendantSvgCount = 0
  let descendantMjxMathCount = 0
  let childNodeCount = -1
  let querySelectorCallable = false
  let querySelectorAllCallable = false
  let selfIsMjxContainer = false
  let selfIsSvg = false
  let ownerDocumentAvailable = false
  let ownerDocumentIsCurrentDocument = false
  let isConnected = false

  if (nodeLike && value instanceof Node) {
    const el = value as unknown as Element
    childNodeCount = value.nodeType === 1 || value.nodeType === 11 ? el.childNodes.length : 0
    querySelectorCallable = typeof el.querySelector === 'function'
    querySelectorAllCallable = typeof el.querySelectorAll === 'function'
    if (querySelectorAllCallable) {
      try {
        descendantMjxContainerCount = el.querySelectorAll('mjx-container').length
        descendantSvgCount = el.querySelectorAll('svg').length
        descendantMjxMathCount = el.querySelectorAll('mjx-math').length
      } catch { /* ignore */ }
    }
    selfIsMjxContainer = typeof el.tagName === 'string' && el.tagName === 'MJX-CONTAINER'
    selfIsSvg = typeof el.tagName === 'string' && el.tagName === 'SVG'
    ownerDocumentAvailable = !!el.ownerDocument
    try { ownerDocumentIsCurrentDocument = typeof document !== 'undefined' && el.ownerDocument === document } catch { /* ignore */ }
    try { isConnected = el.isConnected } catch { /* ignore */ }
  }

  let classification: string
  if (valueIsUndefined) classification = 'TEX2SVG_PROMISE_FULFILLED_UNDEFINED'
  else if (nodeLike) classification = 'TEX2SVG_PROMISE_FULFILLED_NODE'
  else classification = 'TEX2SVG_PROMISE_FULFILLED_OTHER'

  record.fulfillmentUndefined = valueIsUndefined
  record.fulfillmentNodeLike = nodeLike

  let decision: string
  let reason: string | null
  if (nodeLike) {
    const count = registerFulfillmentNode(value as Node, record)
    record.returnedNodeCount += count
    decision = 'REGISTERED'
    reason = null
    // R5.4: injection fulfillment authority (only for injected calls).
    reportInjectionFulfillment(record.callOrdinal, value, count > 0)
  } else if (valueIsUndefined) {
    decision = 'OBSERVED_UNDEFINED'
    reason = null
  } else {
    decision = 'OBSERVED_OTHER'
    reason = null
  }

  emitRuntimeAudit('MATHJAX-TEX2SVG-PROMISE-FULFILLMENT-AUTHORITY', {
    routeName: candidate.routeName,
    callOrdinal: record.callOrdinal,
    fulfilled: true,
    rejected: false,
    valueIsUndefined,
    valueIsNull,
    typeofValue: typeof value,
    objectTag: objectTag(value),
    constructorName: constructorName(value),
    nodeLike,
    nodeType: structural.nodeType,
    nodeName: structural.nodeName,
    tagName: nodeLike && value instanceof Node ? (value as unknown as Element).tagName ?? null : null,
    ownerDocumentAvailable,
    ownerDocumentIsCurrentDocument,
    isConnected,
    childNodeCount,
    querySelectorCallable,
    querySelectorAllCallable,
    selfIsMjxContainer,
    selfIsSvg,
    descendantMjxContainerCount,
    descendantSvgCount,
    descendantMjxMathCount,
    valueToken: value !== null && typeof value === 'object' ? tokenForObj(value as object) : null,
    classification,
    decision,
    reason,
    runtimeMarker: R531_RUNTIME_MARKER,
  })
}

function observeRejectedValue(candidate: RouteCandidate, record: RouteCallRecord, error: unknown): void {
  emitRuntimeAudit('MATHJAX-TEX2SVG-PROMISE-FULFILLMENT-AUTHORITY', {
    routeName: candidate.routeName,
    callOrdinal: record.callOrdinal,
    fulfilled: false,
    rejected: true,
    valueIsUndefined: false,
    valueIsNull: false,
    typeofValue: typeof error,
    objectTag: objectTag(error),
    constructorName: constructorName(error),
    nodeLike: false,
    nodeType: null,
    nodeName: null,
    tagName: null,
    ownerDocumentAvailable: false,
    ownerDocumentIsCurrentDocument: false,
    isConnected: false,
    childNodeCount: -1,
    querySelectorCallable: false,
    querySelectorAllCallable: false,
    selfIsMjxContainer: false,
    selfIsSvg: false,
    descendantMjxContainerCount: 0,
    descendantSvgCount: 0,
    descendantMjxMathCount: 0,
    valueToken: null,
    classification: 'TEX2SVG_PROMISE_REJECTED',
    decision: 'REJECTED',
    reason: String((error as any)?.message ?? error),
    runtimeMarker: R531_RUNTIME_MARKER,
  })
}

function emitRouteResult(candidate: RouteCandidate, record: RouteCallRecord, fields: Record<string, unknown>): void {
  if (emittedMarkerCount >= MAX_EMITTED_MARKERS) return
  emittedMarkerCount++
  emitRuntimeAudit('MATHJAX-RENDER-ROUTE-RESULT', {
    routeName: candidate.routeName,
    callOrdinal: record.callOrdinal,
    ...fields,
    runtimeMarker: R53_RUNTIME_MARKER,
  })
}

function observeReturn(candidate: RouteCandidate, record: RouteCallRecord, result: unknown, scheduleFinalize: (() => void) | null = null): void {
  if (result !== null && typeof result === 'object') {
    // Promise-like: inspect the original object, then observe the ORIGINAL then.
    if (typeof (result as any).then === 'function') {
      const nativePromiseInstance = typeof Promise !== 'undefined' && result instanceof Promise
      const promiseLike = true
      const thenCallable = typeof (result as any).then === 'function'
      const catchCallable = typeof (result as any).catch === 'function'
      const finallyCallable = typeof (result as any).finally === 'function'

      emitRuntimeAudit('MATHJAX-RENDER-PROMISE-OBJECT-AUTHORITY', {
        routeName: candidate.routeName,
        callOrdinal: record.callOrdinal,
        typeofReturnValue: typeof result,
        objectTag: objectTag(result),
        constructorName: constructorName(result),
        promiseLike,
        thenCallable,
        catchCallable,
        finallyCallable,
        nativePromiseInstance,
        promiseToken: tokenForObj(result as object),
        decision: 'OBSERVED',
        reason: null,
        runtimeMarker: R531_RUNTIME_MARKER,
      })

      // Observe the ORIGINAL thenable — never replace the returned promise.
      try {
        const then = (result as any).then
        void Reflect.apply(then, result, [
          (value: unknown) => {
            observeFulfilledValue(candidate, record, value)
            scheduleFinalize?.()
          },
          (error: unknown) => {
            observeRejectedValue(candidate, record, error)
            scheduleFinalize?.()
          },
        ])
      } catch {
        // Original promise untouched — observer failed silently.
      }

      emitRouteResult(candidate, record, {
        returnKind: 'PROMISE',
        promiseLike,
        resolved: false,
        rejected: false,
        resultNodeAvailable: false,
        resultNodeType: null,
        resultNodeName: null,
        resultNodeConnected: false,
        resultMjxContainerCount: 0,
        resultRootToken: null,
        decision: 'OBSERVING',
        reason: null,
      })
      return
    }
    if (result instanceof Node) {
      const count = registerFulfillmentNode(result, record)
      record.returnedNodeCount += count
      scheduleFinalize?.()
      emitRouteResult(candidate, record, {
        returnKind: result.nodeType === 11 ? 'FRAGMENT' : 'NODE',
        promiseLike: false,
        resolved: true,
        rejected: false,
        resultNodeAvailable: true,
        resultNodeType: result.nodeType,
        resultNodeName: result.nodeName,
        resultNodeConnected: result.isConnected,
        resultMjxContainerCount: count,
        resultRootToken: tokenForFn(candidate.original),
        decision: 'REGISTERED',
        reason: null,
      })
      return
    }
    scheduleFinalize?.()
    emitRouteResult(candidate, record, {
      returnKind: 'OTHER',
      promiseLike: false,
      resolved: true,
      rejected: false,
      resultNodeAvailable: false,
      resultNodeType: null,
      resultNodeName: null,
      resultNodeConnected: false,
      resultMjxContainerCount: 0,
      resultRootToken: null,
      decision: 'OBSERVED',
      reason: null,
    })
    return
  }
  scheduleFinalize?.()
  emitRouteResult(candidate, record, {
    returnKind: result === undefined ? 'UNDEFINED' : 'PRIMITIVE',
    promiseLike: false,
    resolved: true,
    rejected: false,
    resultNodeAvailable: false,
    resultNodeType: null,
    resultNodeName: null,
    resultNodeConnected: false,
    resultMjxContainerCount: 0,
    resultRootToken: null,
    decision: 'OBSERVED',
    reason: null,
  })
}

// ── Stats ──────────────────────────────────────────────────────────────

export interface RenderRouteTraceStats {
  publicApiObservedCallCount: number
  startupDocumentObservedCallCount: number
  inputJaxObservedCallCount: number
  outputJaxObservedCallCount: number
  hookInstallTimestamp: number | null
  earliestRouteCallTimestamp: number | null
  hookAuthorityAvailable: boolean
  installationCount: number
  totalRecordedCalls: number
  activeCallWindowCount: number
  activeObserverCount: number
}

export function getRenderRouteTraceStats(): RenderRouteTraceStats {
  let publicApi = 0
  let startupDocument = 0
  let inputJax = 0
  let outputJax = 0
  for (const c of installedCandidates) {
    if (c.tier === 1) publicApi += c.callCount
    else if (c.tier === 2) startupDocument += c.callCount
    else if (c.routeName.includes('input[0]')) inputJax += c.callCount
    else outputJax += c.callCount
  }
  const earliest = allRouteRecords.length > 0
    ? Math.min(...allRouteRecords.map((r) => r.timestamp))
    : null
  const hasHookable = installedCandidates.some((c) => c.callable && c.hookable)
  const mathJaxSeen = typeof window !== 'undefined' && !!(window as any).MathJax
  const activeObservers = allRouteRecords.filter((r) => !r.observerDisconnected).length
  return {
    publicApiObservedCallCount: publicApi,
    startupDocumentObservedCallCount: startupDocument,
    inputJaxObservedCallCount: inputJax,
    outputJaxObservedCallCount: outputJax,
    hookInstallTimestamp,
    earliestRouteCallTimestamp: earliest,
    hookAuthorityAvailable: mathJaxSeen && (hasHookable || installedCandidates.length === 0),
    installationCount: installedCandidates.length,
    totalRecordedCalls: allRouteRecords.length,
    activeCallWindowCount: activeCallCount,
    activeObserverCount: activeObservers,
  }
}

/** @internal — exposed for tests and runtime correlation. */
export function getRecordedRouteCalls(): RouteCallRecord[] {
  return allRouteRecords.slice()
}

// ── Formula Correlation (pure, testable) ───────────────────────────────

export interface FormulaRouteCorrelationInput {
  formulaIndex: number
  formulaHostToken: number
  desiredTag: string
  host: HTMLElement | null
  formulaTex: string
  formulaSourceKind: FormulaTexSourceKind
  documentKey: string
  documentGeneration: number
  records: RouteCallRecord[]
  returnedNodeRoutesMap: WeakMap<Node, RouteCallRecord>
  deltaNodeRoutesMap: WeakMap<Node, RouteCallRecord>
  deltaNodeKindsMap: WeakMap<Node, DeltaNodeKind>
}

export interface FormulaRouteCorrelationResult {
  formulaIndex: number
  formulaHostToken: number
  desiredTag: string
  formulaTexHash: string
  formulaTexLength: number
  visibleMjxContainerCount: number
  actualCallCaptured: boolean
  routeName: string | null
  routeTier: RouteTier | null
  fulfillmentNodeMatchCount: number
  fulfillmentSubtreeMatchCount: number
  callLocalDomDeltaMatchCount: number
  callLocalDomReplacementMatchCount: number
  callLocalSubtreeMatchCount: number
  hostContainsFulfillmentNodeCount: number
  hostContainsFulfillmentDescendantCount: number
  callWindowOverlapCount: number
  inputHashVerifierMatchCount: number
  correlatedRouteCount: number
  correlatedRouteNames: string[]
  strongestAuthority: RouteAuthority
  strongAuthority: boolean
  externalCallerSourceKind: ExternalCallerKind | null
  externalCallerObserved: boolean
  formulaSourceVerifierReady: boolean
  decision: RouteCorrelationDecision
  reason: string | null
}

const STRONG_AUTHORITIES: RouteAuthority[] = [
  'EXACT_FULFILLMENT_NODE_IDENTITY',
  'FULFILLMENT_SUBTREE_IDENTITY',
  'CALL_LOCAL_DOM_DELTA_IDENTITY',
  'CALL_LOCAL_DOM_REPLACEMENT_IDENTITY',
  'CALL_LOCAL_SUBTREE_IDENTITY',
  'HOST_CONTAINS_FULFILLMENT_NODE',
  'HOST_CONTAINS_FULFILLMENT_DESCENDANT',
]

export function isStrongAuthority(a: RouteAuthority): boolean {
  return STRONG_AUTHORITIES.includes(a)
}

export function classifyFormulaCorrelation(input: FormulaRouteCorrelationInput): FormulaRouteCorrelationResult {
  const { host, formulaTex, documentKey, documentGeneration, records, returnedNodeRoutesMap, deltaNodeRoutesMap, deltaNodeKindsMap } = input
  const formulaTexHash = simpleHash(normalizeTex(formulaTex))
  const visibleMjx = host ? Array.from(host.querySelectorAll('mjx-container')) : []

  const strongRoutes = new Map<string, number>()
  const hashRouteNames = new Set<string>()
  let fulfillmentNodeMatchCount = 0
  let fulfillmentSubtreeMatchCount = 0
  let hostContainsFulfillmentNodeCount = 0
  let hostContainsFulfillmentDescendantCount = 0
  let callLocalDomDeltaMatchCount = 0
  let callLocalDomReplacementMatchCount = 0
  let callLocalSubtreeMatchCount = 0
  // Clean (non-overlapping) delta counts drive strong authority selection.
  let cleanDomDeltaMatchCount = 0
  let cleanDomReplacementMatchCount = 0
  let cleanSubtreeMatchCount = 0
  let callWindowOverlapCount = 0
  const correlatedExternalCallerKinds = new Set<ExternalCallerKind>()

  const eligible = (rec: RouteCallRecord): boolean => {
    if (rec.documentKey !== null && rec.documentKey !== documentKey) return false
    if (rec.documentGeneration !== null && rec.documentGeneration !== documentGeneration) return false
    return true
  }
  const bump = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  const recordDeltaMatch = (rec: RouteCallRecord, kind: DeltaNodeKind | undefined, viaAncestor: boolean): void => {
    if (kind === 'REPLACED') callLocalDomReplacementMatchCount++
    else if (kind === 'SUBTREE') callLocalSubtreeMatchCount++
    else callLocalDomDeltaMatchCount++
    if (rec.overlapDetected) {
      callWindowOverlapCount++
    } else {
      // Clean (non-overlapping) delta → strong candidate.
      if (kind === 'REPLACED') cleanDomReplacementMatchCount++
      else if (kind === 'SUBTREE') cleanSubtreeMatchCount++
      else cleanDomDeltaMatchCount++
      bump(strongRoutes, rec.routeName)
    }
    void viaAncestor
  }

  for (const m of visibleMjx) {
    // Fulfillment exact.
    const fulfillmentRec = returnedNodeRoutesMap.get(m)
    if (fulfillmentRec) {
      fulfillmentNodeMatchCount++
      hostContainsFulfillmentNodeCount++
      if (fulfillmentRec.overlapDetected) callWindowOverlapCount++
      bump(strongRoutes, fulfillmentRec.routeName)
      continue
    }
    // Ancestor walk for fulfillment subtree / delta subtree.
    let node: Node | null = m.parentNode
    while (node && node !== host && node !== null) {
      const fRec = returnedNodeRoutesMap.get(node)
      if (fRec) {
        fulfillmentSubtreeMatchCount++
        if (fRec.overlapDetected) callWindowOverlapCount++
        bump(strongRoutes, fRec.routeName)
        break
      }
      const dRec = deltaNodeRoutesMap.get(node)
      if (dRec) {
        recordDeltaMatch(dRec, deltaNodeKindsMap.get(node), true)
        break
      }
      node = node.parentNode
    }
  }

  // Call-local delta nodes that are THEMSELVES inside the host (added mjx).
  if (host) {
    for (const child of Array.from(host.querySelectorAll('mjx-container, svg, mjx-math'))) {
      const dRec = deltaNodeRoutesMap.get(child)
      if (!dRec) continue
      recordDeltaMatch(dRec, deltaNodeKindsMap.get(child), false)
    }
  }

  // Host-contains fulfillment node/descendant via record arrays.
  for (const rec of records) {
    if (!eligible(rec)) continue
    for (const n of rec.fulfillmentNodes) {
      if (host && host.contains(n)) hostContainsFulfillmentNodeCount++
    }
    for (const n of rec.fulfillmentNodes) {
      if (host && n instanceof Element && Array.from(n.querySelectorAll?.('mjx-container') ?? []).some((m) => host.contains(m))) {
        hostContainsFulfillmentDescendantCount++
        break
      }
    }
  }

  // Hash verifier (eligible records only — never primary identity).
  let hashVerifierCount = 0
  for (const rec of records) {
    if (!eligible(rec)) continue
    if (formulaTexHash && rec.inputHash === formulaTexHash) {
      hashVerifierCount++
      hashRouteNames.add(rec.routeName)
      if (rec.externalCallerSourceKind) correlatedExternalCallerKinds.add(rec.externalCallerSourceKind)
    }
  }

  const eligibleRecords = records.filter(eligible)
  const actualCallCaptured = eligibleRecords.length > 0
  const correlatedRouteNames = Array.from(new Set([...strongRoutes.keys(), ...hashRouteNames]))

  // External caller from correlated records (strong first, then hash-matched).
  let externalCallerSourceKind: ExternalCallerKind | null = null
  for (const rec of eligibleRecords) {
    if (strongRoutes.has(rec.routeName) && rec.externalCallerSourceKind) {
      externalCallerSourceKind = rec.externalCallerSourceKind
      break
    }
  }
  if (externalCallerSourceKind === null && correlatedExternalCallerKinds.size > 0) {
    externalCallerSourceKind = correlatedExternalCallerKinds.values().next().value as ExternalCallerKind
  }
  const externalCallerObserved = externalCallerSourceKind !== null

  let strongestAuthority: RouteAuthority
  if (strongRoutes.size >= 2) {
    strongestAuthority = 'AMBIGUOUS'
  } else if (fulfillmentNodeMatchCount > 0) {
    strongestAuthority = 'EXACT_FULFILLMENT_NODE_IDENTITY'
  } else if (fulfillmentSubtreeMatchCount > 0) {
    strongestAuthority = 'FULFILLMENT_SUBTREE_IDENTITY'
  } else if (cleanDomReplacementMatchCount > 0) {
    strongestAuthority = 'CALL_LOCAL_DOM_REPLACEMENT_IDENTITY'
  } else if (cleanDomDeltaMatchCount > 0) {
    strongestAuthority = 'CALL_LOCAL_DOM_DELTA_IDENTITY'
  } else if (cleanSubtreeMatchCount > 0) {
    strongestAuthority = 'CALL_LOCAL_SUBTREE_IDENTITY'
  } else if (hostContainsFulfillmentNodeCount > 0) {
    strongestAuthority = 'HOST_CONTAINS_FULFILLMENT_NODE'
  } else if (hostContainsFulfillmentDescendantCount > 0) {
    strongestAuthority = 'HOST_CONTAINS_FULFILLMENT_DESCENDANT'
  } else if (hashVerifierCount > 0 && actualCallCaptured) {
    strongestAuthority = 'CALL_PLUS_INPUT_HASH_VERIFIER'
  } else {
    strongestAuthority = 'NONE'
  }

  const strongRouteName = strongRoutes.size === 1 ? strongRoutes.keys().next().value as string : null
  const routeName = strongRouteName ?? (hashRouteNames.size === 1 ? hashRouteNames.values().next().value as string : null)

  let decision: RouteCorrelationDecision
  let reason: string | null
  if (strongestAuthority === 'AMBIGUOUS') {
    decision = 'FAIL'
    reason = 'MULTIPLE_STRONG_ROUTES'
  } else if (isStrongAuthority(strongestAuthority) && actualCallCaptured) {
    decision = 'PASS'
    reason = null
  } else if (strongestAuthority === 'CALL_PLUS_INPUT_HASH_VERIFIER') {
    decision = 'PROVISIONAL'
    reason = 'HASH_ONLY_NO_NODE_IDENTITY'
  } else if (eligibleRecords.length > 0) {
    decision = 'FAIL'
    reason = 'NO_NODE_IDENTITY_NO_HASH_MATCH'
  } else if (visibleMjx.length > 0) {
    decision = 'FAIL'
    reason = 'CURRENT_DOCUMENT_GENERATION_INVALID_FOR_ROUTE_AUTHORITY'
  } else {
    decision = 'FAIL'
    reason = 'NO_CAPTURED_CALL'
  }

  let routeTier: RouteTier | null = null
  if (routeName) {
    const rec = eligibleRecords.find((r) => r.routeName === routeName)
    routeTier = rec?.tier ?? null
  }

  return {
    formulaIndex: input.formulaIndex,
    formulaHostToken: input.formulaHostToken,
    desiredTag: input.desiredTag,
    formulaTexHash,
    formulaTexLength: normalizeTex(formulaTex).length,
    visibleMjxContainerCount: visibleMjx.length,
    actualCallCaptured,
    routeName,
    routeTier,
    fulfillmentNodeMatchCount,
    fulfillmentSubtreeMatchCount,
    callLocalDomDeltaMatchCount,
    callLocalDomReplacementMatchCount,
    callLocalSubtreeMatchCount,
    hostContainsFulfillmentNodeCount,
    hostContainsFulfillmentDescendantCount,
    callWindowOverlapCount,
    inputHashVerifierMatchCount: hashVerifierCount,
    correlatedRouteCount: correlatedRouteNames.length,
    correlatedRouteNames,
    strongestAuthority,
    strongAuthority: isStrongAuthority(strongestAuthority),
    externalCallerSourceKind,
    externalCallerObserved,
    formulaSourceVerifierReady: input.formulaSourceKind !== 'UNAVAILABLE' && formulaTex.length > 0,
    decision,
    reason,
  }
}

// ── Final Route Classification (pure, testable) ────────────────────────

export interface RouteFinalInput {
  formula0: FormulaRouteCorrelationResult
  formula1: FormulaRouteCorrelationResult
  publicApiObservedCallCount: number
  startupDocumentObservedCallCount: number
  inputJaxObservedCallCount: number
  outputJaxObservedCallCount: number
  hookInstallTimestamp: number | null
  earliestRouteCallTimestamp: number | null
  hookAuthorityAvailable: boolean
  fulfillmentUndefinedCount: number
  fulfillmentNodeLikeCount: number
  callLocalDomDeltaCount: number
  callWindowOverlapCount: number
  selfRenderCallDetected: boolean
}

export interface RouteFinalResult {
  routeCase: RouteCase
  classification: string
  decision: 'PASS' | 'PARTIAL' | 'BLOCK'
  reason: string | null
  formula0Route: string
  formula1Route: string
  specificTyporaRenderRoute: string
  hookInstalledBeforeEarliestCapturedCall: boolean
}

export function classifyRouteFinal(input: RouteFinalInput): RouteFinalResult {
  const f0 = input.formula0
  const f1 = input.formula1
  const totalObserved = input.publicApiObservedCallCount
    + input.startupDocumentObservedCallCount
    + input.inputJaxObservedCallCount
    + input.outputJaxObservedCallCount
  const f0Route = f0.strongestAuthority === 'AMBIGUOUS' ? 'AMBIGUOUS' : (f0.routeName ?? 'NOT_DETERMINED')
  const f1Route = f1.strongestAuthority === 'AMBIGUOUS' ? 'AMBIGUOUS' : (f1.routeName ?? 'NOT_DETERMINED')
  const hookInstalledBeforeEarliestCapturedCall =
    input.hookInstallTimestamp !== null
    && input.earliestRouteCallTimestamp !== null
    && input.hookInstallTimestamp < input.earliestRouteCallTimestamp

  const result: RouteFinalResult = {
    routeCase: 'D',
    classification: 'TYPOORA_RENDER_ROUTE_BYPASSES_OR_CACHES_HOOKED_SURFACES',
    decision: 'PASS',
    reason: null,
    formula0Route: f0Route,
    formula1Route: f1Route,
    specificTyporaRenderRoute: 'NOT_DETERMINED',
    hookInstalledBeforeEarliestCapturedCall,
  }

  // Self-render BLOCK.
  if (input.selfRenderCallDetected) {
    result.routeCase = 'F'
    result.classification = 'INKCHAPTER_SELF_RENDER_CALL_DETECTED'
    result.decision = 'BLOCK'
    result.reason = 'INKCHAPTER_BUSINESS_CALLER_OBSERVED'
    return result
  }

  // R5.3 regression: no calls at all.
  if (totalObserved === 0) {
    result.routeCase = 'D'
    result.classification = 'TYPOORA_RENDER_ROUTE_BYPASSES_OR_CACHES_HOOKED_SURFACES'
    result.decision = 'PASS'
    result.reason = 'NO_HOOKED_SURFACE_CALLED'
    return result
  }

  // Hook authority unavailable.
  if (!input.hookAuthorityAvailable) {
    result.routeCase = 'F'
    result.classification = 'RENDER_ROUTE_HOOK_AUTHORITY_UNAVAILABLE'
    result.decision = 'BLOCK'
    result.reason = 'HOOK_AUTHORITY_UNAVAILABLE'
    return result
  }

  const f0Strong = isStrongAuthority(f0.strongestAuthority)
  const f1Strong = isStrongAuthority(f1.strongestAuthority)

  // Per-formula ambiguity.
  if (f0.strongestAuthority === 'AMBIGUOUS' || f1.strongestAuthority === 'AMBIGUOUS') {
    result.routeCase = 'E'
    result.classification = 'FORMULA_RENDER_ROUTE_AMBIGUOUS'
    result.decision = 'BLOCK'
    result.reason = 'MULTIPLE_STRONG_ROUTES_FOR_SAME_FORMULA'
    return result
  }

  // PASS gate: both strong + same route.
  if (f0Strong && f1Strong && f0.routeName && f0.routeName === f1.routeName) {
    const tier = f0.routeTier ?? f1.routeTier
    result.specificTyporaRenderRoute = f0.routeName
    if (tier === 1) {
      result.routeCase = 'A'
      result.classification = 'PUBLIC_MATHJAX_RENDER_ROUTE_PROVEN'
      result.decision = 'PASS'
      result.reason = null
    } else if (tier === 2) {
      result.routeCase = 'B'
      result.classification = 'STARTUP_DOCUMENT_RENDER_ROUTE_PROVEN'
      result.decision = 'PASS'
      result.reason = null
    } else {
      result.routeCase = 'C'
      result.classification = 'MATHJAX_COMPILE_ROUTE_PROVEN_TOPLEVEL_TYPORA_ROUTE_UNRESOLVED'
      result.decision = 'PARTIAL'
      result.reason = 'TIER3_ROUTE_TOPLEVEL_CALLER_UNRESOLVED'
    }
    return result
  }

  // Both strong but different routes → divergence.
  if (f0Strong && f1Strong) {
    result.routeCase = 'E'
    result.classification = 'FORMULA_RENDER_ROUTE_DIVERGENCE'
    result.decision = 'BLOCK'
    result.reason = 'FORMULA0_AND_FORMULA1_ROUTES_DIVERGE'
    return result
  }

  // Only one formula strong → PARTIAL (caller may be proven Typora).
  if (f0Strong || f1Strong) {
    result.routeCase = 'C'
    result.classification = 'TYPORA_CALLER_PROVEN_OUTPUT_IDENTITY_UNRESOLVED'
    result.decision = 'PARTIAL'
    result.reason = 'ONLY_ONE_FORMULA_ROUTE_PROVEN'
    return result
  }

  // Hash-only correlation for at least one formula.
  if (f0.strongestAuthority === 'CALL_PLUS_INPUT_HASH_VERIFIER' || f1.strongestAuthority === 'CALL_PLUS_INPUT_HASH_VERIFIER') {
    result.routeCase = 'C'
    result.classification = 'TYPORA_CALLER_PROVEN_OUTPUT_IDENTITY_UNRESOLVED'
    result.decision = 'PARTIAL'
    result.reason = 'CALL_PLUS_HASH_ONLY_NO_NODE_IDENTITY'
    return result
  }

  result.routeCase = 'C'
  result.classification = 'TYPORA_CALLER_PROVEN_OUTPUT_IDENTITY_UNRESOLVED'
  result.decision = 'PARTIAL'
  result.reason = 'CALLS_CAPTURED_BUT_NO_CORRELATION'
  return result
}

// ── Orchestrated Trace (runtime entry point) ───────────────────────────

export interface TraceFormulaInput {
  host: HTMLElement | null
  formulaIndex: number
  formulaHostToken: number
  desiredTag: string
  formulaTex: string
  formulaSourceKind: FormulaTexSourceKind
}

export interface MathJaxRenderRouteTraceResult {
  formula0: FormulaRouteCorrelationResult
  formula1: FormulaRouteCorrelationResult
  final: RouteFinalResult
}

export function executeMathJaxRenderRouteTrace(
  formulas: TraceFormulaInput[],
  documentKey: string,
  documentGeneration: number,
): MathJaxRenderRouteTraceResult {
  const records = getRecordedRouteCalls()

  // Formula TeX source verifier authority (Formula0/1 each).
  for (const f of formulas) {
    const verifier = verifyFormulaTexSource({
      host: f.host,
      formulaIndex: f.formulaIndex,
      editorRoot: currentEditorRoot,
      markdown: undefined,
    })
    emitRuntimeAudit('FORMULA-TEX-SOURCE-VERIFIER-AUTHORITY', {
      formulaIndex: f.formulaIndex,
      formulaHostToken: f.formulaHostToken,
      editState: verifier.editState,
      sourceCandidateCount: verifier.sourceCandidateCount,
      sourceKind: verifier.sourceKind,
      rawSourceLength: verifier.rawSourceLength,
      normalizedSourceLength: verifier.normalizedSourceLength,
      sourceHash: verifier.sourceHash,
      sourcePrefix: verifier.sourcePrefix,
      containsDisplayDelimiter: verifier.containsDisplayDelimiter,
      decision: verifier.decision,
      reason: verifier.reason,
      runtimeMarker: R531_RUNTIME_MARKER,
    })
  }

  const f0 = classifyFormulaCorrelation({
    formulaIndex: formulas[0]?.formulaIndex ?? 0,
    formulaHostToken: formulas[0]?.formulaHostToken ?? 0,
    desiredTag: formulas[0]?.desiredTag ?? '',
    host: formulas[0]?.host ?? null,
    formulaTex: formulas[0]?.formulaTex ?? '',
    formulaSourceKind: formulas[0]?.formulaSourceKind ?? 'UNAVAILABLE',
    documentKey,
    documentGeneration,
    records,
    returnedNodeRoutesMap: returnedNodeRoutes,
    deltaNodeRoutesMap: deltaNodeRoutes,
    deltaNodeKindsMap: deltaNodeKinds,
  })
  const f1 = classifyFormulaCorrelation({
    formulaIndex: formulas[1]?.formulaIndex ?? 1,
    formulaHostToken: formulas[1]?.formulaHostToken ?? 1,
    desiredTag: formulas[1]?.desiredTag ?? '',
    host: formulas[1]?.host ?? null,
    formulaTex: formulas[1]?.formulaTex ?? '',
    formulaSourceKind: formulas[1]?.formulaSourceKind ?? 'UNAVAILABLE',
    documentKey,
    documentGeneration,
    records,
    returnedNodeRoutesMap: returnedNodeRoutes,
    deltaNodeRoutesMap: deltaNodeRoutes,
    deltaNodeKindsMap: deltaNodeKinds,
  })

  // Call-local DOM delta markers (per real call, hosts now known).
  const selfRenderCallDetected = records.some((r) => r.externalCallerSourceKind === 'INKCHAPTER_BUSINESS_CALLER')
  const fulfillmentUndefinedCount = records.filter((r) => r.fulfillmentUndefined).length
  const fulfillmentNodeLikeCount = records.filter((r) => r.fulfillmentNodeLike).length
  let callLocalDomDeltaCount = 0
  let callWindowOverlapCount = 0
  for (const rec of records) {
    if (rec.deltaNodes.length > 0) callLocalDomDeltaCount++
    if (rec.overlapDetected) callWindowOverlapCount++
    const deltaMjx = rec.deltaNodes.filter((n) => (n as Element).tagName === 'MJX-CONTAINER')
    const deltaSvgMath = rec.deltaNodes.filter((n) => {
      const tag = (n as Element).tagName
      return tag === 'SVG' || tag === 'MJX-MATH'
    })
    const f0Block = formulas[0]?.host
    const f1Block = formulas[1]?.host
    const f0Delta = deltaMjx.filter((n) => f0Block && f0Block.contains(n)).length
    const f1Delta = deltaMjx.filter((n) => f1Block && f1Block.contains(n)).length
    const f0Subtree = deltaSvgMath.filter((n) => f0Block && f0Block.contains(n)).length
    const f1Subtree = deltaSvgMath.filter((n) => f1Block && f1Block.contains(n)).length
    emitRuntimeAudit('MATHJAX-RENDER-CALL-DOM-DELTA', {
      routeName: rec.routeName,
      callOrdinal: rec.callOrdinal,
      renderCallWindowId: `w${rec.callOrdinal}`,
      formula0BeforeMjxCount: rec.beforeMjxCounts.get(f0Block as HTMLElement) ?? -1,
      formula1BeforeMjxCount: rec.beforeMjxCounts.get(f1Block as HTMLElement) ?? -1,
      formula0AfterMjxCount: rec.afterMjxCounts.get(f0Block as HTMLElement) ?? -1,
      formula1AfterMjxCount: rec.afterMjxCounts.get(f1Block as HTMLElement) ?? -1,
      addedMjxNodeCount: deltaMjx.length,
      removedMjxNodeCount: rec.removedNodes.filter((n) => (n as Element).tagName === 'MJX-CONTAINER').length,
      formula0AddedMjxNodeCount: f0Delta,
      formula1AddedMjxNodeCount: f1Delta,
      formula0ReplacedMjxNodeCount: f0Delta > 0 && (rec.beforeMjxCounts.get(f0Block as HTMLElement) ?? 0) > 0 ? f0Delta : 0,
      formula1ReplacedMjxNodeCount: f1Delta > 0 && (rec.beforeMjxCounts.get(f1Block as HTMLElement) ?? 0) > 0 ? f1Delta : 0,
      addedSvgNodeCount: rec.deltaNodes.filter((n) => (n as Element).tagName === 'SVG').length,
      formula0SubtreeMutationCount: f0Subtree,
      formula1SubtreeMutationCount: f1Subtree,
      callWindowOverlapCount: rec.overlapDetected ? 1 : 0,
      uniqueFormulaIndex: f0Delta > 0 && f1Delta === 0 ? 0 : f1Delta > 0 && f0Delta === 0 ? 1 : null,
      strongIdentityAvailable: !rec.overlapDetected && (f0Delta > 0 || f1Delta > 0 || f0Subtree > 0 || f1Subtree > 0),
      decision: !rec.overlapDetected && (f0Delta > 0 || f1Delta > 0 || f0Subtree > 0 || f1Subtree > 0) ? 'STRONG' : (rec.overlapDetected ? 'OVERLAP' : 'NO_DELTA'),
      reason: null,
      runtimeMarker: R531_RUNTIME_MARKER,
    })
  }

  const stats = getRenderRouteTraceStats()
  const final = classifyRouteFinal({
    formula0: f0,
    formula1: f1,
    publicApiObservedCallCount: stats.publicApiObservedCallCount,
    startupDocumentObservedCallCount: stats.startupDocumentObservedCallCount,
    inputJaxObservedCallCount: stats.inputJaxObservedCallCount,
    outputJaxObservedCallCount: stats.outputJaxObservedCallCount,
    hookInstallTimestamp: stats.hookInstallTimestamp,
    earliestRouteCallTimestamp: stats.earliestRouteCallTimestamp,
    hookAuthorityAvailable: stats.hookAuthorityAvailable,
    fulfillmentUndefinedCount,
    fulfillmentNodeLikeCount,
    callLocalDomDeltaCount,
    callWindowOverlapCount,
    selfRenderCallDetected,
  })

  for (const [idx, corr] of [[0, f0], [1, f1]] as const) {
    emitRuntimeAudit('MATHJAX-FORMULA-RENDER-ROUTE-CORRELATION', {
      formulaIndex: corr.formulaIndex,
      formulaHostToken: corr.formulaHostToken,
      desiredTag: corr.desiredTag,
      visibleMjxContainerCount: corr.visibleMjxContainerCount,
      fulfillmentNodeMatchCount: corr.fulfillmentNodeMatchCount,
      fulfillmentSubtreeMatchCount: corr.fulfillmentSubtreeMatchCount,
      callLocalDomDeltaMatchCount: corr.callLocalDomDeltaMatchCount,
      callLocalDomReplacementMatchCount: corr.callLocalDomReplacementMatchCount,
      callLocalSubtreeMatchCount: corr.callLocalSubtreeMatchCount,
      callWindowOverlapCount: corr.callWindowOverlapCount,
      externalCallerSourceKind: corr.externalCallerSourceKind,
      externalCallerObserved: corr.externalCallerObserved,
      formulaSourceVerifierReady: corr.formulaSourceVerifierReady,
      inputHashVerifierMatchCount: corr.inputHashVerifierMatchCount,
      correlatedRouteNames: corr.correlatedRouteNames.join(','),
      strongestAuthority: corr.strongestAuthority,
      strongAuthority: corr.strongAuthority,
      decision: corr.decision,
      reason: corr.reason,
      runtimeMarker: R531_RUNTIME_MARKER,
    })
    void idx
  }

  emitRuntimeAudit('MATHJAX-RENDER-RESULT-CALLER-AUTHORITY-FINAL', {
    documentKey,
    documentGeneration,
    tex2svgPromiseObservedCallCount: stats.publicApiObservedCallCount,
    fulfillmentUndefinedCount,
    fulfillmentNodeLikeCount,
    callLocalDomDeltaCount,
    callWindowOverlapCount,
    formula0Route: final.formula0Route,
    formula1Route: final.formula1Route,
    formula0StrongestAuthority: f0.strongestAuthority,
    formula1StrongestAuthority: f1.strongestAuthority,
    formula0SourceVerifierReady: f0.formulaSourceVerifierReady,
    formula1SourceVerifierReady: f1.formulaSourceVerifierReady,
    formula0HashVerifierMatchCount: f0.inputHashVerifierMatchCount,
    formula1HashVerifierMatchCount: f1.inputHashVerifierMatchCount,
    formula0ExternalCallerKind: f0.externalCallerSourceKind,
    formula1ExternalCallerKind: f1.externalCallerSourceKind,
    formula0ActualCallCaptured: f0.actualCallCaptured,
    formula1ActualCallCaptured: f1.actualCallCaptured,
    formula0StrongAuthority: f0.strongAuthority,
    formula1StrongAuthority: f1.strongAuthority,
    specificTyporaRenderRoute: final.specificTyporaRenderRoute,
    routeCase: final.routeCase,
    classification: final.classification,
    decision: final.decision,
    reason: final.reason,
    runtimeMarker: R531_RUNTIME_MARKER,
  })

  return { formula0: f0, formula1: f1, final }
}
