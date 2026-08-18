/**
 * Formula Numbering Adapter — block-formula target classification, native
 * Typora number detection, and idempotent custom-number reconciliation.
 *
 * Design constraints (P0-C):
 * - Formula is an INDEPENDENT ObjectNumberingType (never reuses code).
 * - Only BLOCK formula is numbered; inline math, CodeMirror internals and math
 *   editor internal PRE are rejected.
 * - Reuses the math host selectors already established in caption-dom-adapter.ts
 *   (MATH_HOST_SELECTOR). No guessed selectors.
 * - Native mode never creates/modifies an InkChapter number.
 * - Custom mode chooses a conflict strategy from runtime evidence:
 *     A. reuse native number node (UPDATE_NATIVE_TEXT)
 *     B. safe-hide native + render InkChapter decoration
 *     C. cannot safely control → BLOCK custom mode
 * - Reconciliation is idempotent: stable state → NO_OP (no DOM mutation), so
 *   the Math DOM is never rebuilt on every refresh.
 *
 * Numbering is computed by the SHARED Object Numbering Engine (computeObjectNumbers)
 * in CaptionService; this adapter only classifies DOM and applies rendered text.
 */

import { MATH_HOST_SELECTOR } from './caption-dom-adapter'

export type FormulaTargetDecision =
  | 'ACCEPT_BLOCK_FORMULA'
  | 'REJECT_INLINE_MATH'
  | 'REJECT_CODEMIRROR_INTERNAL'
  | 'REJECT_NESTED_PRE'
  | 'REJECT_DISCONNECTED'
  | 'REJECT_INNER_MATHJAX_RENDER_NODE'

export type FormulaStrategy = 'reuse-native' | 'hide-native' | 'create'

export interface FormulaTarget {
  /** Canonical block-formula host element (presentation wrapper). */
  root: HTMLElement
  ordinal: number
  nativeNumberNode: HTMLElement | null
  nativeNumberText: string
  /** Whether the native number node is safe to reuse (no MathJax content inside). */
  nativeNodeSafe: boolean
}

export interface FormulaReconcileItem {
  target: FormulaTarget
  /** Template output, e.g. `(1)` / `(1.2)` (no prefix). */
  renderedNumber: string
  /** Final display label, e.g. `式 (1)` (prefix + renderedNumber). */
  label: string
  mode: 'typora-native' | 'inkchapter'
  enabled: boolean
  /** v2.5.4: context NOT_READY → HIDE_UNTIL_READY (no label, suppress native). */
  blocked?: boolean
  /** v2.5.5: resolved native equation number slot (place label in same slot). */
  nativeSlot?: FormulaNativeNumberSlot | null
  /** v2.5.6: authoritative native slot state (drives the hard barrier). */
  slotState?: 'RESOLVED' | 'NOT_FOUND' | 'AMBIGUOUS' | null
}

export interface FormulaReconcileStats {
  noOpCount: number
  updateNativeTextCount: number
  hideNativeRenderCustomCount: number
  createCustomCount: number
  restoreNativeCount: number
}

export interface FormulaDoubleNumber {
  nativeVisibleCount: number
  inkchapterVisibleCount: number
  doubleNumberDetected: boolean
}

const DECORATION_ATTR = 'data-inkchapter-formula-number'
const MANAGED_ATTR = 'data-inkchapter-formula-managed'
const OWNER_ATTR = 'data-inkchapter-formula-number-owner'
const SUPPRESS_ATTR = 'data-inkchapter-native-number-suppressed'

/** A native Typora formula number label looks like a standalone `(1)` / `(2.3)`. */
const NATIVE_NUMBER_TEXT = /^\(\s*\d+(?:[.\-/]\d+)*\s*\)$/

export type FormulaNumberNodeOwner = 'INKCHAPTER_OWNED' | 'TYPOORA_NATIVE_EXTERNAL' | 'UNKNOWN_EXTERNAL'

export interface FormulaNumberNodeInventory {
  formulaIndex: number
  canonicalHostToken: string
  inkchapterOwnedCount: number
  typoraNativeExternalCount: number
  unknownExternalCount: number
  visibleInkChapterCount: number
  visibleNativeCount: number
  visibleUnknownCount: number
  totalVisibleNumberCount: number
  decision: 'PASS' | 'FAIL'
}

// ── v2.5.4: global formula visual inventory (whole editorRoot) ──────

export type FormulaVisualNodeOwner =
  | 'INKCHAPTER_CURRENT'
  | 'INKCHAPTER_LEGACY'
  | 'TYPORA_NATIVE'
  | 'UNKNOWN_EXTERNAL'
  | 'ORPHAN_FORMULA_NUMBER'

export interface FormulaVisualNodeAttribution {
  nodeToken: number
  node: HTMLElement
  tag: string
  class: string
  text: string
  owner: FormulaVisualNodeOwner
  connected: boolean
  visible: boolean
  closestCanonicalFormulaToken: number | null
  previousCanonicalFormulaToken: number | null
  nextCanonicalFormulaToken: number | null
  insideCanonicalHost: boolean
  siblingOfCanonicalHost: boolean
  legacyMarker: boolean
  decision: string
}

export interface FormulaVisualScanResult {
  hosts: HTMLElement[]
  hostTokens: WeakMap<HTMLElement, number>
  attributions: FormulaVisualNodeAttribution[]
}

export interface FormulaVisualCleanupResult {
  removedLegacyCount: number
  removedOrphanCount: number
  suppressedNativeCount: number
  actions: string[]
}

export interface FormulaVisualInventory {
  formulaIndex: number
  formulaHostToken: number
  currentOwnedInHost: number
  currentOwnedSibling: number
  legacyOwned: number
  nativeOwned: number
  unknownOwned: number
  visibleCurrent: number
  visibleLegacy: number
  visibleNative: number
  visibleUnknown: number
  totalVisibleAssociated: number
  decision: 'PASS' | 'FAIL'
}

// ── v2.5.5: Native Equation Number Visual Slot ──────────────────────

export type NativeSlotSourceKind = 'DOM_NODE' | 'PSEUDO_BEFORE' | 'PSEUDO_AFTER' | 'ATTRIBUTE_DRIVEN' | 'CSS_COUNTER' | 'RENDERER_OVERLAY'

export interface NativeVisualReader {
  readPseudoContent(el: HTMLElement, pseudo: '::before' | '::after'): string
  readAttribute(el: HTMLElement, name: string): string | null
  isVisible(el: HTMLElement): boolean
  getRect(el: HTMLElement): { left: number; top: number; right: number; bottom: number }
  /** v2.5.6: computed style counters / layout (optional; defaults to window). */
  readComputedStyle?(el: HTMLElement): {
    counterReset: string
    counterIncrement: string
    counterSet: string
    display: string
    position: string
    visibility: string
    opacity: string
    zIndex: string
  }
}

function defaultComputedStyle(el: HTMLElement): {
  counterReset: string
  counterIncrement: string
  counterSet: string
  display: string
  position: string
  visibility: string
  opacity: string
  zIndex: string
} {
  try {
    const cs = window.getComputedStyle(el)
    return {
      counterReset: cs.counterReset ?? '',
      counterIncrement: cs.counterIncrement ?? '',
      counterSet: (cs as CSSStyleDeclaration & { counterSet?: string }).counterSet ?? '',
      display: cs.display ?? '',
      position: cs.position ?? '',
      visibility: cs.visibility ?? '',
      opacity: cs.opacity ?? '',
      zIndex: cs.zIndex ?? '',
    }
  } catch {
    return { counterReset: '', counterIncrement: '', counterSet: '', display: '', position: '', visibility: '', opacity: '', zIndex: '' }
  }
}

export const defaultNativeVisualReader: NativeVisualReader = {
  readPseudoContent(el, pseudo) {
    try {
      return window.getComputedStyle(el, pseudo).content ?? ''
    } catch {
      return ''
    }
  },
  readAttribute(el, name) {
    return el.getAttribute(name)
  },
  isVisible(el) {
    return isVisibleNumberNode(el)
  },
  getRect(el) {
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  },
}

export interface FormulaNativeNumberSlot {
  formulaHost: HTMLElement
  sourceKind: NativeSlotSourceKind
  anchorElement: HTMLElement
  nativeNode?: HTMLElement | null
  originalText?: string | null
  originalAttributeName?: string | null
  originalAttributeValue?: string | null
  slotRect: { left: number; top: number; right: number; bottom: number }
  hostRect: { left: number; top: number; right: number; bottom: number }
  restorable: boolean
}

export interface FormulaNativeSlotResolution {
  formulaIndex: number
  formulaHostToken: number
  sourceKind: NativeSlotSourceKind | 'NOT_FOUND' | 'AMBIGUOUS'
  anchorToken: number | null
  nativeNodeToken: number | null
  nativeText: string | null
  nativePseudoContent: string | null
  slotRect: { left: number; top: number; right: number; bottom: number } | null
  hostRect: { left: number; top: number; right: number; bottom: number } | null
  restorable: boolean
  decision: 'RESOLVED' | 'NOT_FOUND' | 'AMBIGUOUS'
  slot: FormulaNativeNumberSlot | null
  candidateSummary?: {
    candidateElementCount: number
    domNumberCandidateCount: number
    pseudoBeforeCandidateCount: number
    pseudoAfterCandidateCount: number
    attributeCandidateCount: number
    visualNumberLikeCandidateCount: number
    /** v2.5.6: structural neighborhood actually probed (host + parent + siblings). */
    structuralCandidateCount: number
    /** v2.5.6: candidates whose pseudo content uses counter(...)/counters(...). */
    counterCandidateCount: number
    /** v2.5.6: candidates resolved as an external renderer overlay. */
    overlayCandidateCount: number
  }
  /** v2.5.6: structural neighborhood candidates actually probed. */
  structuralCandidates?: FormulaStructuralNativeCandidate[]
}

/** v2.5.6: per-candidate structural native probe record (FORMULA-STRUCTURAL-NATIVE-CANDIDATE). */
export interface FormulaStructuralNativeCandidate {
  candidateToken: number
  relation: string
  tag: string
  id: string
  class: string
  text: string
  attributeSummary: string
  pseudoBeforeContent: string
  pseudoAfterContent: string
  counterReset: string
  counterIncrement: string
  counterSet: string
  rect: { left: number; top: number; right: number; bottom: number }
  display: string
  position: string
  visibility: string
  opacity: string
  zIndex: string
  numberLike: boolean
  decision: string
}

export interface FormulaVisualInventoryV3 {
  formulaIndex: number
  formulaHostToken: number
  inkchapterProjectionCount: number
  nativeDomVisibleCount: number
  nativePseudoVisibleCount: number
  nativeAttributeVisibleCount: number
  unknownVisibleCount: number
  effectiveVisibleNumberCount: number
  placementAuthority: 'NATIVE_EQUATION_NUMBER_SLOT' | 'NORMAL_FLOW' | 'NONE'
  decision: 'PASS' | 'FAIL'
}

/** v2.5.6: per-formula visual inventory that ONLY consumes the current canonical set. */
export interface FormulaVisualInventoryV4 {
  formulaIndex: number
  formulaHostToken: number
  slotState: 'RESOLVED' | 'NOT_FOUND' | 'AMBIGUOUS'
  slotSourceKind: NativeSlotSourceKind | null
  flowProjectionCount: number
  slotProjectionCount: number
  nativeVisibleCount: number
  inkchapterVisibleCount: number
  effectiveVisibleNumberCount: number
  placementAuthority: 'NATIVE_EQUATION_NUMBER_SLOT' | 'NONE'
  decision: 'PASS' | 'BLOCKED_NATIVE_ONLY' | 'FAIL'
}

/** v2.5.6: current-set authority (FORMULA-CURRENT-SET-AUTHORITY). */
export interface FormulaCurrentSetAuthority {
  canonicalFormulaCount: number
  verifierFormulaCount: number
  historicalTokenCount: number
  phantomVerifierEntryCount: number
  decision: 'PASS' | 'FAIL'
}

/**
 * v2.5.6: verifier must consume exactly the current canonical formula set, never
 * a historical host/visual registry. `phantomVerifierEntryCount` is the number of
 * verifier entries beyond the current canonical count.
 */
export function computeFormulaCurrentSetAuthority(
  canonicalFormulaCount: number,
  verifierFormulaCount: number,
  historicalTokenCount: number,
): FormulaCurrentSetAuthority {
  const phantomVerifierEntryCount = Math.max(0, verifierFormulaCount - canonicalFormulaCount)
  return {
    canonicalFormulaCount,
    verifierFormulaCount,
    historicalTokenCount,
    phantomVerifierEntryCount,
    decision: verifierFormulaCount === canonicalFormulaCount && phantomVerifierEntryCount === 0 ? 'PASS' : 'FAIL',
  }
}

/** Is a node (or its ancestor) InkChapter-owned formula number? */
export function isInkChapterFormulaNumberNode(el: HTMLElement): boolean {
  return el.getAttribute(OWNER_ATTR) === 'inkchapter'
}

function isVisibleNumberNode(el: HTMLElement): boolean {
  if (el.hidden) return false
  const s = el.style
  if (s.display === 'none' || s.visibility === 'hidden') return false
  return true
}

/** Strip CSS `content` quotes so `"(1)"` → `(1)`. */
export function normalizePseudoContent(content: string): string {
  let c = content.trim()
  if (c.length >= 2 && ((c.startsWith('"') && c.endsWith('"')) || (c.startsWith("'") && c.endsWith("'")))) {
    c = c.slice(1, -1)
  }
  return c.trim()
}

interface NativeSlotCandidate {
  sourceKind: NativeSlotSourceKind
  anchor: HTMLElement
  nativeNode: HTMLElement | null
  text: string | null
  pseudo: string | null
}

/**
 * v2.5.6: resolve the REAL visual source of a formula's native equation number.
 * Builds a STRUCTURAL candidate set FIRST (formulaHost + parent + grandparent +
 * closest math wrappers + siblings), then actually probes each candidate's DOM
 * text / pseudo content / attributes / CSS counters / computed layout. This is
 * the opposite of v2.5.5's "find number-like node first" bug — a connected host
 * is always a structural candidate, so `structuralCandidateCount >= 1`.
 */
export function resolveFormulaNativeNumberSlot(
  host: HTMLElement,
  reader: NativeVisualReader = defaultNativeVisualReader,
): FormulaNativeSlotResolution {
  const readStyle = (el: HTMLElement) => (reader.readComputedStyle ?? defaultComputedStyle)(el)
  const attrNames = ['data-number', 'data-eqno', 'data-equation-number', 'aria-label', 'title']

  // ── 1. Structural candidate set (dedup, always includes the connected host) ──
  const structuralSet = new Set<HTMLElement>()
  const addStructural = (el: HTMLElement | null): void => {
    if (el && el instanceof HTMLElement) structuralSet.add(el)
  }
  addStructural(host)
  addStructural(host.parentElement)
  addStructural(host.parentElement?.parentElement ?? null)
  addStructural(host.closest('.md-math-block') as HTMLElement | null)
  addStructural(host.closest('.mathjax-block') as HTMLElement | null)
  addStructural(host.closest('[mdtype]') as HTMLElement | null)
  addStructural(host.previousElementSibling as HTMLElement | null)
  addStructural(host.nextElementSibling as HTMLElement | null)
  addStructural(host.parentElement?.previousElementSibling as HTMLElement | null)
  addStructural(host.parentElement?.nextElementSibling as HTMLElement | null)

  const relationOf = (el: HTMLElement): string => {
    if (el === host) return 'formulaHost'
    if (el === host.parentElement) return 'parent'
    if (el === host.parentElement?.parentElement) return 'grandparent'
    if (el === host.previousElementSibling) return 'prevSibling'
    if (el === host.nextElementSibling) return 'nextSibling'
    if (el === host.parentElement?.previousElementSibling) return 'parentPrevSibling'
    if (el === host.parentElement?.nextElementSibling) return 'parentNextSibling'
    return 'neighborhood'
  }

  const candidates: NativeSlotCandidate[] = []
  const structuralCandidates: FormulaStructuralNativeCandidate[] = []
  let candidateTokenSeq = 0

  for (const el of structuralSet) {
    candidateTokenSeq++
    const style = readStyle(el)
    const pseudoBeforeRaw = reader.readPseudoContent(el, '::before')
    const pseudoAfterRaw = reader.readPseudoContent(el, '::after')
    const pseudoBefore = normalizePseudoContent(pseudoBeforeRaw)
    const pseudoAfter = normalizePseudoContent(pseudoAfterRaw)
    const text = (el.textContent ?? '').trim()
    const attributeSummary = attrNames.map((n) => `${n}=${reader.readAttribute(el, n) ?? ''}`).join(';')

    const pseudoBeforeNumberLike = NATIVE_NUMBER_TEXT.test(pseudoBefore)
    const pseudoAfterNumberLike = NATIVE_NUMBER_TEXT.test(pseudoAfter)
    const pseudoBeforeCounter = /counter\(/.test(pseudoBeforeRaw) || /counters\(/.test(pseudoBeforeRaw)
    const pseudoAfterCounter = /counter\(/.test(pseudoAfterRaw) || /counters\(/.test(pseudoAfterRaw)
    const counterLike = pseudoBeforeCounter || pseudoAfterCounter

    if (pseudoBeforeNumberLike) {
      candidates.push({ sourceKind: 'PSEUDO_BEFORE', anchor: el, nativeNode: null, text: null, pseudo: pseudoBefore })
    }
    if (pseudoAfterNumberLike) {
      candidates.push({ sourceKind: 'PSEUDO_AFTER', anchor: el, nativeNode: null, text: null, pseudo: pseudoAfter })
    }
    if (counterLike && !pseudoBeforeNumberLike && !pseudoAfterNumberLike) {
      candidates.push({
        sourceKind: 'CSS_COUNTER',
        anchor: el,
        nativeNode: null,
        text: null,
        pseudo: pseudoAfterCounter ? pseudoAfterRaw : pseudoBeforeRaw,
      })
    }

    const numberLike = pseudoBeforeNumberLike || pseudoAfterNumberLike || counterLike
    structuralCandidates.push({
      candidateToken: candidateTokenSeq,
      relation: relationOf(el),
      tag: el.tagName,
      id: el.id,
      class: typeof el.className === 'string' ? el.className : '',
      text,
      attributeSummary,
      pseudoBeforeContent: pseudoBefore,
      pseudoAfterContent: pseudoAfter,
      counterReset: style.counterReset,
      counterIncrement: style.counterIncrement,
      counterSet: style.counterSet,
      rect: reader.getRect(el),
      display: style.display,
      position: style.position,
      visibility: style.visibility,
      opacity: style.opacity,
      zIndex: style.zIndex,
      numberLike,
      decision: numberLike ? 'NUMBER_LIKE' : 'STRUCTURAL',
    })
  }

  // ── 2. DOM node native (host descendants + siblings) ──
  const domCandidates = new Set<HTMLElement>()
  for (const el of Array.from(host.querySelectorAll<HTMLElement>('span, div'))) {
    if (el.querySelector('mjx-container, svg, math')) continue
    if (el.getAttribute(OWNER_ATTR) === 'inkchapter') continue
    if (NATIVE_NUMBER_TEXT.test((el.textContent ?? '').trim())) domCandidates.add(el)
  }
  const parent = host.parentElement
  if (parent) {
    for (const el of Array.from(parent.children)) {
      if (el === host || !(el instanceof HTMLElement)) continue
      if (el.querySelector('mjx-container, svg, math')) continue
      if (el.getAttribute(OWNER_ATTR) === 'inkchapter') continue
      if (NATIVE_NUMBER_TEXT.test((el.textContent ?? '').trim())) domCandidates.add(el)
    }
  }
  for (const el of domCandidates) {
    candidates.push({ sourceKind: 'DOM_NODE', anchor: el, nativeNode: el, text: (el.textContent ?? '').trim(), pseudo: null })
  }

  // ── 3. Attribute-driven content ──
  const attrAnchors: HTMLElement[] = [host]
  if (host.parentElement) attrAnchors.push(host.parentElement)
  for (const anchor of attrAnchors) {
    for (const name of attrNames) {
      const v = reader.readAttribute(anchor, name)
      if (v && NATIVE_NUMBER_TEXT.test(v.trim())) {
        candidates.push({ sourceKind: 'ATTRIBUTE_DRIVEN', anchor, nativeNode: null, text: null, pseudo: v.trim() })
      }
    }
  }

  const hostRect = reader.getRect(host)
  const candidateSummary = {
    candidateElementCount: candidates.length,
    domNumberCandidateCount: candidates.filter((c) => c.sourceKind === 'DOM_NODE').length,
    pseudoBeforeCandidateCount: candidates.filter((c) => c.sourceKind === 'PSEUDO_BEFORE').length,
    pseudoAfterCandidateCount: candidates.filter((c) => c.sourceKind === 'PSEUDO_AFTER').length,
    attributeCandidateCount: candidates.filter((c) => c.sourceKind === 'ATTRIBUTE_DRIVEN').length,
    visualNumberLikeCandidateCount: candidates.length,
    structuralCandidateCount: structuralSet.size,
    counterCandidateCount: candidates.filter((c) => c.sourceKind === 'CSS_COUNTER').length,
    overlayCandidateCount: 0,
  }

  if (candidates.length === 0) {
    return {
      formulaIndex: 0, formulaHostToken: 0, sourceKind: 'NOT_FOUND', anchorToken: null, nativeNodeToken: null,
      nativeText: null, nativePseudoContent: null, slotRect: null, hostRect, restorable: false,
      decision: 'NOT_FOUND', slot: null, candidateSummary, structuralCandidates,
    }
  }
  if (candidates.length > 1) {
    return {
      formulaIndex: 0, formulaHostToken: 0, sourceKind: 'AMBIGUOUS', anchorToken: null, nativeNodeToken: null,
      nativeText: null, nativePseudoContent: null, slotRect: null, hostRect, restorable: false,
      decision: 'AMBIGUOUS', slot: null, candidateSummary, structuralCandidates,
    }
  }

  const c = candidates[0]
  const slot: FormulaNativeNumberSlot = {
    formulaHost: host,
    sourceKind: c.sourceKind,
    anchorElement: c.anchor,
    nativeNode: c.nativeNode,
    originalText: c.nativeNode ? (c.nativeNode.textContent ?? '') : null,
    originalAttributeName: null,
    originalAttributeValue: null,
    slotRect: reader.getRect(c.anchor),
    hostRect,
    restorable: true,
  }
  return {
    formulaIndex: 0, formulaHostToken: 0, sourceKind: c.sourceKind, anchorToken: null, nativeNodeToken: null,
    nativeText: c.text, nativePseudoContent: c.pseudo, slotRect: reader.getRect(c.anchor), hostRect,
    restorable: true, decision: 'RESOLVED', slot, candidateSummary, structuralCandidates,
  }
}

/** Resolve the topmost math ancestor so `mjx-container` inside `div.md-math-block` dedupes. */
function resolveCanonicalHost(el: HTMLElement): HTMLElement {
  let host = el
  let parent = el.parentElement
  while (parent && parent.matches(MATH_HOST_SELECTOR)) {
    host = parent
    parent = parent.parentElement
  }
  return host
}

/** v2.5.2: normalize a raw math candidate to its canonical outer host (one formula = one host). */
export function normalizeFormulaCandidate(el: HTMLElement): HTMLElement {
  return resolveCanonicalHost(el)
}

/**
 * Classify a canonical math host. Pure + jsdom-testable.
 * Returns ACCEPT only for block-level formula hosts; everything else is rejected.
 */
export function classifyFormulaHost(host: HTMLElement): {
  decision: FormulaTargetDecision
  reason: string
  canonicalHost: HTMLElement | null
} {
  if (!host.isConnected) return { decision: 'REJECT_DISCONNECTED', reason: 'DISCONNECTED', canonicalHost: null }
  if (host.closest('.CodeMirror')) return { decision: 'REJECT_CODEMIRROR_INTERNAL', reason: 'CODEMIRROR_INTERNAL', canonicalHost: null }
  if (host.closest('pre')) return { decision: 'REJECT_NESTED_PRE', reason: 'NESTED_PRE_MATH_EDITOR', canonicalHost: null }
  // Inline math is a SPAN (e.g. span.md-math) or an mjx-container without a block wrapper.
  if (host.tagName === 'SPAN' || host.classList.contains('md-math')) {
    return { decision: 'REJECT_INLINE_MATH', reason: 'INLINE_MATH', canonicalHost: null }
  }
  // MathJax internal render nodes are never a canonical formula host.
  if (host.tagName === 'MJX-CONTAINER' || host.tagName === 'MJX-MATH' || host.tagName === 'MJX-MROW' || host.tagName === 'SVG') {
    return { decision: 'REJECT_INNER_MATHJAX_RENDER_NODE', reason: 'MATHJAX_INTERNAL_NODE', canonicalHost: null }
  }
  return { decision: 'ACCEPT_BLOCK_FORMULA', reason: 'BLOCK_FORMULA_HOST', canonicalHost: host }
}

/**
 * Choose the native-number conflict strategy (priority A → B → C).
 * Pure + jsdom-testable. `create` means InkChapter renders its own number even
 * when no Typora native number node exists (native is NOT a prerequisite).
 */
export function chooseFormulaStrategy(input: {
  nativeNumberFound: boolean
  nativeNodeSafe: boolean
}): FormulaStrategy {
  if (input.nativeNumberFound && input.nativeNodeSafe) return 'reuse-native'
  if (input.nativeNumberFound && !input.nativeNodeSafe) return 'hide-native'
  return 'create'
}

/** Double number = a native `(1)` AND an InkChapter decoration are both visible. */
export function computeDoubleNumberDetected(nativeVisibleCount: number, inkchapterVisibleCount: number): boolean {
  return nativeVisibleCount > 0 && inkchapterVisibleCount > 0
}

interface NativeOriginal {
  text: string
  display: string
}

export class FormulaNumberingAdapter {
  private nativeOriginals = new WeakMap<HTMLElement, NativeOriginal>()
  private strategyByHost = new WeakMap<HTMLElement, FormulaStrategy>()
  private suppressedNatives = new Set<HTMLElement>()
  private nodeTokens = new WeakMap<HTMLElement, number>()
  private nextNodeToken = 0
  private nativeSlots = new WeakMap<HTMLElement, FormulaNativeNumberSlot>()
  private nativeSlotProjections = new WeakMap<HTMLElement, HTMLElement>()

  constructor(private getEditorRoot: () => HTMLElement | null) {}

  public resolveCanonicalFormulaHostFromNode(node: Node | null): HTMLElement | null {
    if (!node) return null;
    const el = node instanceof HTMLElement ? node : node.parentElement;
    if (!el) return null;
    return resolveCanonicalHost(el);
  }

  public tokenFor(el: HTMLElement): number {
    let t = this.nodeTokens.get(el)
    if (t === undefined) {
      t = ++this.nextNodeToken
      this.nodeTokens.set(el, t)
    }
    return t
  }

  /** Detect a native number node inside a block formula host (text-pattern based). */
  detectNativeNumber(host: HTMLElement): { node: HTMLElement | null; text: string; safe: boolean } {
    const leaves = Array.from(host.querySelectorAll<HTMLElement>('span, div'))
    for (const el of leaves) {
      // The native number label never contains MathJax content.
      if (el.querySelector('mjx-container, svg, math')) continue
      // v2.5.3: NEVER treat an InkChapter-owned node as a native external number.
      if (el.getAttribute(OWNER_ATTR) === 'inkchapter') continue
      const text = (el.textContent ?? '').trim()
      if (NATIVE_NUMBER_TEXT.test(text)) {
        return { node: el, text, safe: true }
      }
    }
    return { node: null, text: '', safe: false }
  }

  /** Collect canonical block-formula targets in document order. */
  collectFormulaTargets(): FormulaTarget[] {
    const root = this.getEditorRoot()
    if (!root) return []

    const rawCandidates = Array.from(root.querySelectorAll<HTMLElement>(MATH_HOST_SELECTOR))
    console.info(
      `[InkChapter Numbering] FORMULA-CANONICAL-SCAN rawCandidateCount=${rawCandidates.length} decision=SCANNED`,
    )

    const hosts = new Set<HTMLElement>()
    for (const el of rawCandidates) {
      const canonical = normalizeFormulaCandidate(el)
      console.info(
        `[InkChapter Numbering] FORMULA-CANONICALIZE rawTag=${el.tagName} rawClass=${(el.className || '').slice(0, 40)} ` +
        `canonicalTag=${canonical.tagName} canonicalClass=${(canonical.className || '').slice(0, 40)} ` +
        `deduped=${hosts.has(canonical)} decision=RESOLVED`,
      )
      hosts.add(canonical)
    }

    const targets: FormulaTarget[] = []
    for (const host of hosts) {
      const { decision, reason } = classifyFormulaHost(host)
      const native = this.detectNativeNumber(host)
      console.info(
        `[InkChapter Numbering] FORMULA-TARGET tag=${host.tagName} ` +
        `class=${(host.className || '').slice(0, 60)} connected=${host.isConnected} ` +
        `decision=${decision} reason=${reason}`,
      )
      console.info(
        `[InkChapter Numbering] FORMULA-NATIVE-DETECT tag=${host.tagName} ` +
        `nativeNumberFound=${!!native.node} nativeNumberText=${JSON.stringify(native.text)} ` +
        `nativeNodeSafe=${native.safe} decision=${native.node ? 'FOUND' : 'NOT_FOUND'}`,
      )
      if (decision !== 'ACCEPT_BLOCK_FORMULA') continue
      targets.push({
        root: host,
        ordinal: targets.length,
        nativeNumberNode: native.node,
        nativeNumberText: native.text,
        nativeNodeSafe: native.safe,
      })
    }
    console.info(
      `[InkChapter Numbering] FORMULA-CANONICAL-SCAN canonicalCount=${targets.length} decision=COMPLETE`,
    )
    return targets
  }

  /**
   * Idempotently reconcile formula numbers against the desired state.
   * Stable state produces NO_OP (no DOM mutation).
   *
   * v2.5.3 ownership state machine (single-number ownership):
   *   canonical host → dedup InkChapter → ensure InkChapter label
   *   → suppress native external → (verify done by caller).
   */
  reconcile(items: FormulaReconcileItem[]): FormulaReconcileStats {
    const stats: FormulaReconcileStats = {
      noOpCount: 0,
      updateNativeTextCount: 0,
      hideNativeRenderCustomCount: 0,
      createCustomCount: 0,
      restoreNativeCount: 0,
    }

    const activeRoots = new Set<HTMLElement>(items.map(i => i.target.root))

    // Remove stale decorations for hosts that are no longer formula targets.
    const root = this.getEditorRoot()
    if (root) {
      for (const deco of Array.from(root.querySelectorAll<HTMLElement>(`[${DECORATION_ATTR}]`))) {
        const host = deco.closest<HTMLElement>(MATH_HOST_SELECTOR)
        if (host && !activeRoots.has(resolveCanonicalHost(host))) {
          deco.remove()
        }
      }
    }

    for (const item of items) {
      const target = item.target
      const host = target.root
      const native = target.nativeNumberNode

      // ── Native / disabled → restore native, remove InkChapter effect ──
      if (!item.enabled || item.mode === 'typora-native') {
        const deco = this.findDecoration(host)
        const changed = this.restoreNative(host, native, deco)
        this.strategyByHost.delete(host)
        console.info(
          `[InkChapter Numbering] FORMULA-RECONCILE tag=${host.tagName} mode=${item.mode} ` +
          `enabled=${item.enabled} decision=${changed ? 'REMOVE_CUSTOM' : 'NO_OP'} reason=RESTORE_NATIVE`,
        )
        if (changed) stats.restoreNativeCount++
        else stats.noOpCount++
        continue
      }

      // ── v2.5.4 blocked (context NOT_READY) → HIDE_UNTIL_READY ──
      if (item.blocked) {
        const deco = this.findDecoration(host)
        if (deco) { deco.remove(); stats.restoreNativeCount++ }
        if (native && native.getAttribute(SUPPRESS_ATTR) !== '1') {
          this.rememberOriginal(native)
          native.style.display = 'none'
          native.setAttribute(MANAGED_ATTR, 'hidden')
          native.setAttribute(SUPPRESS_ATTR, '1')
          this.suppressedNatives.add(native)
          stats.hideNativeRenderCustomCount++
        }
        console.info(
          `[InkChapter Numbering] FORMULA-RECONCILE tag=${host.tagName} mode=${item.mode} ` +
          `decision=HIDE_UNTIL_READY reason=CONTEXT_NOT_READY`,
        )
        continue
      }

      // ── InkChapter mode: single owned number + suppressed native ──
      // Dedup InkChapter nodes (one canonical formula = one owned number).
      const inkNodes = this.findInkChapterNodes(host)
      if (inkNodes.length > 1) {
        for (let i = 1; i < inkNodes.length; i++) inkNodes[i].remove()
        stats.createCustomCount++ // treat dedup as a reconciliation write
      }

      // v2.5.5: place the label in the native equation number visual slot.
      if (item.nativeSlot) {
        const before = this.nativeSlotProjections.get(host)?.textContent ?? null
        const projection = this.projectNativeSlot(item.nativeSlot, item.label, target.ordinal)
        const labelAction = before === item.label ? 'NO_OP' : 'CREATE'
        if (labelAction === 'CREATE') stats.createCustomCount++
        else stats.noOpCount++
        this.logDomOwnership(target, host, !!item.nativeSlot.nativeNode, inkNodes.length > 0, labelAction, item.label)
        console.info(
          `[InkChapter Numbering] FORMULA-RECONCILE tag=${host.tagName} mode=${item.mode} ` +
          `decision=${labelAction === 'CREATE' ? 'PROJECT_NATIVE_SLOT' : 'NO_OP'} label=${JSON.stringify(item.label)} ` +
          `reason=NATIVE_EQUATION_NUMBER_SLOT projectionConnected=${projection.projectionNode.isConnected}`,
        )
        continue
      }

      // ── v2.5.6: native slot hard barrier (FORMULA-NATIVE-SLOT-BARRIER) ──
      // NOT_FOUND / AMBIGUOUS must NEVER fall back to a normal-flow InkChapter
      // span. Leave the Typora native visual in place; only remove stale flow
      // projections from a previous (legacy) run.
      if (item.slotState === 'NOT_FOUND' || item.slotState === 'AMBIGUOUS') {
        const removedFlow = this.removeStaleFlowProjection(host)
        if (native && native.getAttribute(SUPPRESS_ATTR) === '1') {
          const orig = this.nativeOriginals.get(native)
          if (orig) {
            native.textContent = orig.text
            native.style.display = orig.display
            native.removeAttribute(MANAGED_ATTR)
            native.removeAttribute(SUPPRESS_ATTR)
            native.removeAttribute(OWNER_ATTR)
            this.nativeOriginals.delete(native)
            this.suppressedNatives.delete(native)
          }
        }
        console.info(
          `[InkChapter Numbering] FORMULA-NATIVE-SLOT-BARRIER formulaIndex=${target.ordinal} ` +
          `formulaHostToken=${this.tokenFor(host)} slotState=${item.slotState} ` +
          `existingFlowProjectionCount=${removedFlow > 0 ? 1 : 0} removedFlowProjectionCount=${removedFlow} ` +
          `legacyReconcileInvoked=false flowProjectionCount=0 decision=BLOCK ` +
          `reason=NATIVE_SLOT_${item.slotState} ` +
          `runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
        )
        if (removedFlow > 0) stats.restoreNativeCount++
        continue
      }

      // Ensure exactly one InkChapter label (normal-flow fallback).
      const decoration = this.ensureDecoration(host, native)
      const labelAction = decoration.textContent !== item.label ? 'CREATE' : 'NO_OP'
      if (labelAction === 'CREATE') {
        decoration.textContent = item.label
        stats.createCustomCount++
      } else {
        stats.noOpCount++
      }

      // Suppress native external (idempotent, reversible).
      if (native && native.getAttribute(SUPPRESS_ATTR) !== '1') {
        this.rememberOriginal(native)
        native.style.display = 'none'
        native.setAttribute(MANAGED_ATTR, 'hidden')
        native.setAttribute(SUPPRESS_ATTR, '1')
        this.suppressedNatives.add(native)
        stats.hideNativeRenderCustomCount++
      }

      this.logDomOwnership(target, host, !!native, inkNodes.length > 0, labelAction, item.label)
      console.info(
        `[InkChapter Numbering] FORMULA-RECONCILE tag=${host.tagName} mode=${item.mode} ` +
        `decision=${labelAction === 'CREATE' ? 'CREATE_CUSTOM' : 'NO_OP'} label=${JSON.stringify(item.label)} ` +
        `reason=SINGLE_NUMBER_OWNERSHIP`,
      )
    }

    return stats
  }

  private logDomOwnership(target: FormulaTarget, host: HTMLElement, nativeNumberFound: boolean, inkchapterNodeBefore: boolean, action: string, renderedText: string): void {
    console.info(
      `[InkChapter Numbering] FORMULA-DOM-OWNERSHIP formulaIndex=${target.ordinal} ` +
      `canonicalHostTag=${host.tagName} canonicalHostClass=${(host.className || '').slice(0, 40)} ` +
      `nativeNumberFound=${nativeNumberFound} inkchapterNodeBefore=${inkchapterNodeBefore} action=${action} ` +
      `inkchapterNodeAfter=true renderedText=${JSON.stringify(renderedText)} decision=PASS ` +
      `runtimeMarker=FORMULA-BLOCK-ANCHOR-NATIVE-BARRIER-V2.5.6`,
    )
  }

  /** Restore native number + remove InkChapter decoration. Idempotent (returns whether it mutated). */
  private restoreNative(host: HTMLElement, native: HTMLElement | null, deco: HTMLElement | null): boolean {
    let changed = false
    if (deco) {
      deco.remove()
      changed = true
    }
    if (native) {
      const orig = this.nativeOriginals.get(native)
      if (orig) {
        native.textContent = orig.text
        native.style.display = orig.display
        native.removeAttribute(MANAGED_ATTR)
        native.removeAttribute(SUPPRESS_ATTR)
        native.removeAttribute(OWNER_ATTR)
        this.nativeOriginals.delete(native)
        this.suppressedNatives.delete(native)
        changed = true
      }
    }
    return changed
  }

  /** Restore every suppressed native number (plugin unload / mode switch). */
  restoreAllNative(): void {
    for (const native of Array.from(this.suppressedNatives)) {
      const orig = this.nativeOriginals.get(native)
      if (!orig) continue
      native.textContent = orig.text
      native.style.display = orig.display
      native.removeAttribute(MANAGED_ATTR)
      native.removeAttribute(SUPPRESS_ATTR)
      native.removeAttribute(OWNER_ATTR)
      this.nativeOriginals.delete(native)
    }
    this.suppressedNatives.clear()
  }

  private findDecoration(host: HTMLElement): HTMLElement | null {
    return host.querySelector<HTMLElement>(`[${DECORATION_ATTR}]`) ?? null
  }

  /**
   * v2.5.6: remove any InkChapter-owned flow projection for a host (stale legacy
   * span from a previous run). Leaves the Typora native visual untouched.
   */
  private removeStaleFlowProjection(host: HTMLElement): number {
    let removed = 0
    for (const deco of Array.from(host.querySelectorAll<HTMLElement>(`[${DECORATION_ATTR}]`))) {
      deco.remove()
      removed++
    }
    const p = this.nativeSlotProjections.get(host)
    if (p) {
      p.remove()
      this.nativeSlotProjections.delete(host)
      removed++
    }
    return removed
  }

  /** All InkChapter-owned number nodes within a canonical host (for dedup). */
  private findInkChapterNodes(host: HTMLElement): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>(`[${OWNER_ATTR}="inkchapter"]`))
  }

  /** Get-or-create the InkChapter-owned formula number decoration (outside MathJax tree). */
  private ensureDecoration(host: HTMLElement, native: HTMLElement | null): HTMLElement {
    let decoration = this.findDecoration(host)
    if (!decoration) {
      decoration = document.createElement('span')
      decoration.className = 'inkchapter-formula-number'
      decoration.setAttribute(DECORATION_ATTR, 'true')
      decoration.setAttribute('data-inkchapter-formula-number-owner', 'inkchapter')
      decoration.setAttribute('contenteditable', 'false')
      if (native) native.insertAdjacentElement('afterend', decoration)
      else host.appendChild(decoration)
    }
    return decoration
  }

  private rememberOriginal(native: HTMLElement): void {
    if (!this.nativeOriginals.has(native)) {
      this.nativeOriginals.set(native, { text: native.textContent ?? '', display: native.style.display })
    }
  }

  /**
   * Enumerate the number nodes within one canonical formula host and attribute
   * each to its owner (InkChapter vs native Typora vs unknown). Visibility is
   * judged by display/visibility/hidden — never raw node count.
   */
  computeNumberNodeInventory(host: HTMLElement, formulaIndex: number): FormulaNumberNodeInventory {
    const inkNodes = Array.from(host.querySelectorAll<HTMLElement>(`[${OWNER_ATTR}="inkchapter"]`))
    const leaves = Array.from(host.querySelectorAll<HTMLElement>('span, div'))
    const nativeNodes: HTMLElement[] = []
    for (const el of leaves) {
      if (el.querySelector('mjx-container, svg, math')) continue
      if (el.getAttribute(OWNER_ATTR) === 'inkchapter') continue
      const text = (el.textContent ?? '').trim()
      if (NATIVE_NUMBER_TEXT.test(text)) nativeNodes.push(el)
    }

    const visibleInk = inkNodes.filter(isVisibleNumberNode).length
    const visibleNative = nativeNodes.filter(isVisibleNumberNode).length
    const visibleUnknown = 0
    const total = visibleInk + visibleNative + visibleUnknown
    const decision: 'PASS' | 'FAIL' = total === 1 && visibleInk === 1 && visibleNative === 0 ? 'PASS' : 'FAIL'

    return {
      formulaIndex,
      canonicalHostToken: `${host.tagName}.${(host.className || '').slice(0, 40)}`,
      inkchapterOwnedCount: inkNodes.length,
      typoraNativeExternalCount: nativeNodes.length,
      unknownExternalCount: 0,
      visibleInkChapterCount: visibleInk,
      visibleNativeCount: visibleNative,
      visibleUnknownCount: visibleUnknown,
      totalVisibleNumberCount: total,
      decision,
    }
  }

  /** Current double-number evidence across all block formula hosts. */
  computeDoubleNumber(): FormulaDoubleNumber {
    const root = this.getEditorRoot()
    let nativeVisibleCount = 0
    let inkchapterVisibleCount = 0
    if (root) {
      const hosts = new Set<HTMLElement>()
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(MATH_HOST_SELECTOR))) {
        hosts.add(resolveCanonicalHost(el))
      }
      let i = 0
      for (const host of hosts) {
        const inv = this.computeNumberNodeInventory(host, i++)
        nativeVisibleCount += inv.visibleNativeCount
        inkchapterVisibleCount += inv.visibleInkChapterCount
      }
    }
    return {
      nativeVisibleCount,
      inkchapterVisibleCount,
      doubleNumberDetected: computeDoubleNumberDetected(nativeVisibleCount, inkchapterVisibleCount),
    }
  }

  /** Remove all InkChapter formula decorations and restore suppressed natives. */
  clearAll(): void {
    const root = this.getEditorRoot()
    if (!root) return
    for (const deco of Array.from(root.querySelectorAll<HTMLElement>(`[${DECORATION_ATTR}]`))) {
      deco.remove()
    }
    this.restoreAllNative()
  }

  /**
   * v2.5.4: scan the WHOLE editor root for every formula-number-like node —
   * not just the canonical host's descendants. This is what catches the second
   * `(1)/(2)` living as a host sibling / legacy projection / orphan.
   */
  scanVisualFormulaNodes(): FormulaVisualScanResult {
    const root = this.getEditorRoot()
    const hosts: HTMLElement[] = []
    const hostTokens = new WeakMap<HTMLElement, number>()
    const attributions: FormulaVisualNodeAttribution[] = []
    if (!root) return { hosts, hostTokens, attributions }

    const seen = new Set<HTMLElement>()
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(MATH_HOST_SELECTOR))) {
      const h = resolveCanonicalHost(el)
      if (!seen.has(h)) {
        seen.add(h)
        hosts.push(h)
        hostTokens.set(h, hosts.length)
      }
    }

    const candidates = new Set<HTMLElement>()
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${DECORATION_ATTR}], [${OWNER_ATTR}]`))) {
      candidates.add(el)
    }
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('span, div'))) {
      const text = (el.textContent ?? '').trim()
      if (NATIVE_NUMBER_TEXT.test(text)) candidates.add(el)
    }

    let nodeToken = 0
    for (const el of candidates) {
      nodeToken++
      attributions.push(this.attributeVisualNode(el, nodeToken, hosts, hostTokens))
    }
    return { hosts, hostTokens, attributions }
  }

  private attributeVisualNode(
    el: HTMLElement,
    nodeToken: number,
    hosts: HTMLElement[],
    hostTokens: WeakMap<HTMLElement, number>,
  ): FormulaVisualNodeAttribution {
    const tag = el.tagName
    const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 60)
    const text = (el.textContent ?? '').trim()
    const connected = el.isConnected
    const visible = isVisibleNumberNode(el)
    const isCurrentInk = el.getAttribute(OWNER_ATTR) === 'inkchapter'
    const hasDecorationAttr = el.hasAttribute(DECORATION_ATTR)
    const legacyMarker = hasDecorationAttr && !isCurrentInk

    let insideHost = false
    let siblingHost = false
    let closestToken: number | null = null
    const ancestor = el.closest<HTMLElement>(MATH_HOST_SELECTOR)
    if (ancestor) {
      const canonical = resolveCanonicalHost(ancestor)
      const t = hostTokens.get(canonical) ?? null
      if (t !== null) { insideHost = true; closestToken = t }
    } else {
      for (const h of hosts) {
        if (h.parentElement && h.parentElement === el.parentElement && h !== el) {
          siblingHost = true
          closestToken = hostTokens.get(h) ?? null
          break
        }
      }
    }

    let previousToken: number | null = null
    let nextToken: number | null = null
    for (const h of hosts) {
      const t = hostTokens.get(h) ?? null
      if (t === null) continue
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) previousToken = t
      else if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) {
        if (nextToken === null) nextToken = t
      }
    }

    let owner: FormulaVisualNodeOwner
    if (isCurrentInk) {
      owner = insideHost || siblingHost ? 'INKCHAPTER_CURRENT' : 'ORPHAN_FORMULA_NUMBER'
    } else if (legacyMarker) {
      owner = insideHost || siblingHost ? 'INKCHAPTER_LEGACY' : 'ORPHAN_FORMULA_NUMBER'
    } else if (NATIVE_NUMBER_TEXT.test(text)) {
      owner = insideHost || siblingHost ? 'TYPORA_NATIVE' : 'UNKNOWN_EXTERNAL'
    } else {
      owner = 'UNKNOWN_EXTERNAL'
    }

    return {
      nodeToken,
      node: el,
      tag,
      class: cls,
      text,
      owner,
      connected,
      visible,
      closestCanonicalFormulaToken: closestToken,
      previousCanonicalFormulaToken: previousToken,
      nextCanonicalFormulaToken: nextToken,
      insideCanonicalHost: insideHost,
      siblingOfCanonicalHost: siblingHost,
      legacyMarker,
      decision: owner,
    }
  }

  /**
   * v2.5.4: remove legacy duplicates / orphan legacy nodes and suppress native
   * nodes (reversible). UNKNOWN_EXTERNAL is never touched.
   */
  cleanupVisualNodes(scan: FormulaVisualScanResult): FormulaVisualCleanupResult {
    const result: FormulaVisualCleanupResult = {
      removedLegacyCount: 0,
      removedOrphanCount: 0,
      suppressedNativeCount: 0,
      actions: [],
    }
    for (const a of scan.attributions) {
      const el = a.node
      if (a.owner === 'INKCHAPTER_LEGACY') {
        el.remove()
        result.removedLegacyCount++
        result.actions.push(`REMOVE_LEGACY_DUPLICATE:${a.tag}.${a.class}`)
      } else if (a.owner === 'ORPHAN_FORMULA_NUMBER') {
        el.remove()
        result.removedOrphanCount++
        result.actions.push(`REMOVE_ORPHAN_LEGACY:${a.tag}.${a.class}`)
      } else if (a.owner === 'TYPORA_NATIVE' && el.getAttribute(SUPPRESS_ATTR) !== '1') {
        this.rememberOriginal(el)
        el.style.display = 'none'
        el.setAttribute(MANAGED_ATTR, 'hidden')
        el.setAttribute(SUPPRESS_ATTR, '1')
        this.suppressedNatives.add(el)
        result.suppressedNativeCount++
        result.actions.push(`SUPPRESS_NATIVE:${a.tag}.${a.class}`)
      }
    }
    return result
  }

  /** v2.5.4: global per-formula visual inventory (whole editorRoot boundary). */
  computeGlobalFormulaVisualInventory(): FormulaVisualInventory[] {
    const scan = this.scanVisualFormulaNodes()
    const inventories: FormulaVisualInventory[] = scan.hosts.map((_, i) => ({
      formulaIndex: i,
      formulaHostToken: i + 1,
      currentOwnedInHost: 0,
      currentOwnedSibling: 0,
      legacyOwned: 0,
      nativeOwned: 0,
      unknownOwned: 0,
      visibleCurrent: 0,
      visibleLegacy: 0,
      visibleNative: 0,
      visibleUnknown: 0,
      totalVisibleAssociated: 0,
      decision: 'PASS' as const,
    }))

    for (const a of scan.attributions) {
      const token = a.closestCanonicalFormulaToken
      if (token === null) continue
      const inv = inventories[token - 1]
      if (!inv) continue
      if (a.owner === 'INKCHAPTER_CURRENT') {
        if (a.insideCanonicalHost) inv.currentOwnedInHost++
        else if (a.siblingOfCanonicalHost) inv.currentOwnedSibling++
        if (a.visible) inv.visibleCurrent++
      } else if (a.owner === 'INKCHAPTER_LEGACY') {
        inv.legacyOwned++
        if (a.visible) inv.visibleLegacy++
      } else if (a.owner === 'TYPORA_NATIVE') {
        inv.nativeOwned++
        if (a.visible) inv.visibleNative++
      } else if (a.owner === 'UNKNOWN_EXTERNAL') {
        inv.unknownOwned++
        if (a.visible) inv.visibleUnknown++
      }
    }

    for (const inv of inventories) {
      inv.totalVisibleAssociated = inv.visibleCurrent + inv.visibleLegacy + inv.visibleNative + inv.visibleUnknown
      inv.decision = inv.totalVisibleAssociated === 1 && inv.visibleCurrent === 1 ? 'PASS' : 'FAIL'
    }
    return inventories
  }

  /** v2.5.5: resolve the native equation number visual slot for a formula host. */
  resolveNativeNumberSlot(host: HTMLElement, formulaIndex: number, reader?: NativeVisualReader): FormulaNativeSlotResolution {
    const res = resolveFormulaNativeNumberSlot(host, reader)
    res.formulaIndex = formulaIndex
    res.formulaHostToken = this.tokenFor(host)
    if (res.slot) {
      res.anchorToken = this.tokenFor(res.slot.anchorElement)
      res.nativeNodeToken = res.slot.nativeNode ? this.tokenFor(res.slot.nativeNode) : null
      this.nativeSlots.set(host, res.slot)
    }
    return res
  }

  /**
   * v2.5.5: project an InkChapter label into the SAME visual slot as the native
   * equation number (never a normal-flow span that falls to the next line).
   */
  projectNativeSlot(
    slot: FormulaNativeNumberSlot,
    label: string,
    formulaIndex: number,
  ): { projectionNode: HTMLElement; nativeVisualSuppressed: boolean; projectionVisible: boolean } {
    const host = slot.formulaHost

    if (slot.sourceKind === 'DOM_NODE' && slot.nativeNode) {
      const native = slot.nativeNode
      if (native.getAttribute(SUPPRESS_ATTR) !== '1') {
        this.rememberOriginal(native)
        native.style.display = 'none'
        native.setAttribute(MANAGED_ATTR, 'hidden')
        native.setAttribute(SUPPRESS_ATTR, '1')
        this.suppressedNatives.add(native)
      }
      // Same layout slot: sibling of the native node, inheriting its class.
      let projection = this.nativeSlotProjections.get(host) ?? null
      if (!projection || !projection.isConnected) {
        projection = document.createElement('span')
        projection.className = `inkchapter-formula-number inkchapter-formula-native-slot ${typeof native.className === 'string' ? native.className : ''}`.trim()
        projection.setAttribute(DECORATION_ATTR, 'true')
        projection.setAttribute(OWNER_ATTR, 'inkchapter')
        projection.setAttribute('data-inkchapter-formula-slot', 'native')
        projection.setAttribute('contenteditable', 'false')
        native.insertAdjacentElement('afterend', projection)
        this.nativeSlotProjections.set(host, projection)
      }
      if (projection.textContent !== label) projection.textContent = label
      return { projectionNode: projection, nativeVisualSuppressed: true, projectionVisible: true }
    }

    // pseudo / attribute / overlay → scoped suppress + overlay projection.
    slot.anchorElement.classList.add('inkchapter-native-visual-suppressed')
    let projection = this.nativeSlotProjections.get(host) ?? null
    if (!projection || !projection.isConnected) {
      projection = document.createElement('span')
      projection.className = 'inkchapter-formula-number inkchapter-formula-native-overlay'
      projection.setAttribute(DECORATION_ATTR, 'true')
      projection.setAttribute(OWNER_ATTR, 'inkchapter')
      projection.setAttribute('data-inkchapter-formula-slot', 'overlay')
      projection.setAttribute('contenteditable', 'false')
      projection.style.position = 'absolute'
      projection.style.right = '0'
      projection.style.top = '50%'
      projection.style.transform = 'translateY(-50%)'
      if (slot.anchorElement.style.position === '' || slot.anchorElement.style.position === 'static') {
        slot.anchorElement.style.position = 'relative'
      }
      slot.anchorElement.appendChild(projection)
      this.nativeSlotProjections.set(host, projection)
    }
    if (projection.textContent !== label) projection.textContent = label
    return { projectionNode: projection, nativeVisualSuppressed: true, projectionVisible: true }
  }

  /** v2.5.5: remove InkChapter projection + restore the native visual slot. */
  restoreNativeSlot(host: HTMLElement): void {
    const slot = this.nativeSlots.get(host)
    const projection = this.nativeSlotProjections.get(host)
    if (projection) {
      projection.remove()
      this.nativeSlotProjections.delete(host)
    }
    if (slot) {
      if (slot.sourceKind === 'DOM_NODE' && slot.nativeNode) {
        const native = slot.nativeNode
        const orig = this.nativeOriginals.get(native)
        if (orig) {
          native.textContent = orig.text
          native.style.display = orig.display
          native.removeAttribute(MANAGED_ATTR)
          native.removeAttribute(SUPPRESS_ATTR)
          native.removeAttribute(OWNER_ATTR)
          this.nativeOriginals.delete(native)
          this.suppressedNatives.delete(native)
        }
      }
      slot.anchorElement.classList.remove('inkchapter-native-visual-suppressed')
      this.nativeSlots.delete(host)
    }
  }

  /** v2.5.5: token of the InkChapter projection for a host (if any). */
  getNativeSlotProjectionToken(host: HTMLElement): number | null {
    const p = this.nativeSlotProjections.get(host)
    return p ? this.tokenFor(p) : null
  }

  /** v2.5.5: editor-wide visual inventory including native pseudo/attribute slot. */
  computeFormulaVisualInventoryV3(): FormulaVisualInventoryV3[] {
    const hosts = this.collectCanonicalHostsInOrder()
    return hosts.map((host, i) => {
      const projectionCount = Array.from(host.querySelectorAll<HTMLElement>(`[${OWNER_ATTR}="inkchapter"]`)).length
      const slot = this.nativeSlots.get(host) ?? null
      let nativeDomVisible = 0
      let nativePseudoVisible = 0
      let nativeAttributeVisible = 0
      let unknownVisible = 0
      if (slot && slot.sourceKind === 'DOM_NODE' && slot.nativeNode) {
        if (isVisibleNumberNode(slot.nativeNode)) nativeDomVisible++
      } else if (slot && (slot.sourceKind === 'PSEUDO_BEFORE' || slot.sourceKind === 'PSEUDO_AFTER')) {
        if (!slot.anchorElement.classList.contains('inkchapter-native-visual-suppressed')) nativePseudoVisible++
      } else if (slot && slot.sourceKind === 'ATTRIBUTE_DRIVEN') {
        if (!slot.anchorElement.classList.contains('inkchapter-native-visual-suppressed')) nativeAttributeVisible++
      }
      const effective = projectionCount > 0 ? 1 : 0
      return {
        formulaIndex: i,
        formulaHostToken: i + 1,
        inkchapterProjectionCount: projectionCount,
        nativeDomVisibleCount: nativeDomVisible,
        nativePseudoVisibleCount: nativePseudoVisible,
        nativeAttributeVisibleCount: nativeAttributeVisible,
        unknownVisibleCount: unknownVisible,
        effectiveVisibleNumberCount: effective,
        placementAuthority: projectionCount > 0 ? 'NATIVE_EQUATION_NUMBER_SLOT' : 'NONE',
        decision: effective === 1 && nativeDomVisible === 0 && nativePseudoVisible === 0 && nativeAttributeVisible === 0 ? 'PASS' : 'FAIL',
      }
    })
  }

  private collectCanonicalHostsInOrder(): HTMLElement[] {
    const root = this.getEditorRoot()
    const hosts: HTMLElement[] = []
    if (!root) return hosts
    const seen = new Set<HTMLElement>()
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(MATH_HOST_SELECTOR))) {
      const h = resolveCanonicalHost(el)
      if (!seen.has(h)) { seen.add(h); hosts.push(h) }
    }
    return hosts
  }

  /**
   * v2.5.6: per-formula visual inventory that ONLY consumes the current canonical
   * formula list (never a whole-editor scan). `placementAuthority` is an observed
   * value: it is NATIVE_EQUATION_NUMBER_SLOT only when the slot is RESOLVED AND a
   * projection is bound to that anchor; otherwise NONE.
   */
  computeFormulaVisualInventoryV4(
    entries: Array<{ host: HTMLElement; slotState: 'RESOLVED' | 'NOT_FOUND' | 'AMBIGUOUS' }>,
  ): FormulaVisualInventoryV4[] {
    return entries.map((entry, i) => {
      const host = entry.host
      const slot = this.nativeSlots.get(host) ?? null
      const projection = this.nativeSlotProjections.get(host) ?? null
      const native = this.detectNativeNumber(host).node
      const flowProjectionCount = Array.from(host.querySelectorAll<HTMLElement>(`[${DECORATION_ATTR}]`))
        .filter((d) => d !== projection).length
      const slotProjectionCount = projection && projection.isConnected ? 1 : 0
      const nativeVisibleCount = native && isVisibleNumberNode(native) && native.getAttribute(SUPPRESS_ATTR) !== '1' ? 1 : 0
      const inkchapterVisibleCount = projection && isVisibleNumberNode(projection) ? 1 : 0
      const effectiveVisibleNumberCount = slotProjectionCount > 0 ? 1 : nativeVisibleCount

      let placementAuthority: 'NATIVE_EQUATION_NUMBER_SLOT' | 'NONE' = 'NONE'
      if (entry.slotState === 'RESOLVED' && slot && slotProjectionCount === 1 && projection && isVisibleNumberNode(projection)) {
        placementAuthority = 'NATIVE_EQUATION_NUMBER_SLOT'
      }

      let decision: 'PASS' | 'BLOCKED_NATIVE_ONLY' | 'FAIL'
      if (placementAuthority === 'NATIVE_EQUATION_NUMBER_SLOT' && nativeVisibleCount === 0 && inkchapterVisibleCount === 1 && effectiveVisibleNumberCount === 1) {
        decision = 'PASS'
      } else if (entry.slotState !== 'RESOLVED' && slotProjectionCount === 0 && flowProjectionCount === 0 && nativeVisibleCount === 1 && inkchapterVisibleCount === 0) {
        decision = 'BLOCKED_NATIVE_ONLY'
      } else {
        decision = 'FAIL'
      }

      return {
        formulaIndex: i,
        formulaHostToken: this.tokenFor(host),
        slotState: entry.slotState,
        slotSourceKind: slot?.sourceKind ?? null,
        flowProjectionCount,
        slotProjectionCount,
        nativeVisibleCount,
        inkchapterVisibleCount,
        effectiveVisibleNumberCount,
        placementAuthority,
        decision,
      }
    })
  }
}
