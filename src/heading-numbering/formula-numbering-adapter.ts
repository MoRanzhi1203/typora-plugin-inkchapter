/**
 * Formula Numbering Adapter — block-formula target classification, native
 * Typora number detection, and idempotent custom-number reconciliation.
 *
 * Design constraints (P0-C):
 * - Formula is an INDEPENDENT ObjectNumberingType (never reuses code).
 * - Only BLOCK formula is numbered; inline math, CodeMirror internals and math
 *   editor internal PRE are rejected.
 * - OWNERSHIP INVARIANT (Phase 7R.1): ONE logical Formula → ONE business target
 *   → ONE Formula ordinal. The logical/source block host
 *   (`div.md-math-block` / `md-rawblock`) is the business-position authority.
 *   Rendered MathJax output (`mjx-container`, `.MathJax`, `svg`, MathJax
 *   internal descendants) is PROJECTION output and never enters the business
 *   target list / ordinal sequence / semantic scope sequence.
 * - Native mode never creates/modifies an InkChapter number.
 * - Custom mode chooses a conflict strategy from runtime evidence:
 *     A. reuse native number node (UPDATE_NATIVE_TEXT)
 *     B. safe-hide native + render InkChapter decoration
 *     C. no native number node → render InkChapter decoration directly
 *        (render-custom). It must NOT block just because the source has no
 *        `\tag{}` — for ordinary untagged display math there is no native tag.
 *     Renderer-not-ready (no rendered math host yet) → DEFER, writes=0; the
 *     number appears automatically once MathJax renders.
 * - Reconciliation is idempotent: stable state → NO_OP (no DOM mutation), so
 *   the Math DOM is never rebuilt on every refresh.
 *
 * Numbering is computed by the SHARED Object Numbering Engine (computeObjectNumbers)
 * in CaptionService; this adapter only classifies DOM and applies rendered text.
 */

import { MATH_HOST_SELECTOR } from './caption-dom-adapter'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

export type FormulaTargetDecision =
  | 'ACCEPT_BLOCK_FORMULA'
  | 'REJECT_INLINE_MATH'
  | 'REJECT_CODEMIRROR_INTERNAL'
  | 'REJECT_NESTED_PRE'
  | 'REJECT_DISCONNECTED'
  | 'REJECT_RENDERER_OUTPUT'

export type FormulaStrategy = 'reuse-native' | 'hide-native' | 'render-custom'

export interface FormulaTarget {
  /** Canonical block-formula business host element (logical/source raw block). */
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
}

export interface FormulaReconcileStats {
  noOpCount: number
  updateNativeTextCount: number
  hideNativeRenderCustomCount: number
  renderCustomCount: number
  deferredCount: number
  blockCustomCount: number
  restoreNativeCount: number
}

export interface FormulaDoubleNumber {
  nativeVisibleCount: number
  inkchapterVisibleCount: number
  doubleNumberDetected: boolean
}

export type FormulaCandidateRole =
  | 'LOGICAL_SOURCE_HOST'
  | 'RENDERED_MATHJAX_HOST'
  | 'MATHJAX_INTERNAL'
  | 'UNKNOWN'

export interface FormulaHostForensicEntry {
  candidateTag: string
  candidateClass: string
  candidateConnected: boolean
  candidateRole: FormulaCandidateRole
  candidateParentTag: string
  candidateParentClass: string
  insideLogicalFormulaHost: boolean
  containsMjxContainer: boolean
  sameLogicalFormulaOwnershipToken: string
  decision: 'ACCEPT_BUSINESS_TARGET' | 'REJECT_RENDERER_OUTPUT' | 'REJECT_NON_FORMULA'
}

export type FormulaProjectionOrigin =
  | 'TYPORA_AUTO'
  | 'USER_EXPLICIT_TAG'
  | 'INKCHAPTER_CUSTOM'
  | 'INKCHAPTER_NATIVE_INJECTION'
  | 'UNKNOWN'

export interface FormulaVisibleProjectionForensicEntry {
  logicalHostTag: string
  logicalHostClass: string
  logicalHostConnected: boolean
  mjxContainerCount: number
  svgRootCount: number
  /** Bounded MathJax output structure: direct children of each mjx-container. */
  mjxOutputChildren: Array<{ tagName: string; className: string; text: string }>
  /** Bounded leaf nodes whose text matches a native number label pattern. */
  nativeNumberPatternNodes: Array<{ tagName: string; className: string; text: string }>
  inkchapterDecorationCount: number
  dataMathTagBeforePresent: boolean
  dataMathTagBeforeValue: string
  dataMathTagAfterPresent: boolean
  dataMathTagAfterValue: string
  dataMathLabelsPresent: boolean
  nativeDetectorFound: boolean
  nativeDetectorText: string
  /** Bounded structural fingerprints of MathJax tag-like nodes. */
  mathJaxTagLikeNodeCount: number
  mathJaxTagLikeFingerprints: Array<{
    tagName: string
    className: string
    parentTag: string
    parentClass: string
    attrs: Array<{ name: string; value: string }>
    textExcerpt: string
    rect: { width: number; height: number } | null
  }>
  projectionOrigin: FormulaProjectionOrigin
  effectiveProjectionChannelsObserved: number
  decision: 'OBSERVED' | 'NO_RENDERER' | 'UNKNOWN'
}

const DECORATION_ATTR = 'data-inkchapter-formula-number'
const MANAGED_ATTR = 'data-inkchapter-formula-managed'

/**
 * BUSINESS target selector — the logical/source Formula block host only.
 * Rendered MathJax nodes (`mjx-container`, `.MathJax`) must NEVER enter the
 * business target list (Phase 7R.1 target-ownership invariant).
 */
const FORMULA_LOGICAL_HOST_SELECTOR = '.md-math-block'

/** Rendered MathJax output inside a logical host (projection target, not business). */
const RENDERED_MATH_SELECTOR = 'mjx-container, .MathJax'

/** A native Typora formula number label looks like a standalone `(1)` / `(2.3)`. */
const NATIVE_NUMBER_TEXT = /^\(\s*\d+(?:[.\-/]\d+)*\s*\)$/

/** Resolve the topmost logical block-formula ancestor within the business selector. */
function resolveCanonicalHost(el: HTMLElement): HTMLElement {
  let host = el
  let parent = el.parentElement
  while (parent && parent.matches(FORMULA_LOGICAL_HOST_SELECTOR)) {
    host = parent
    parent = parent.parentElement
  }
  return host
}

// ── Safe DOM-string helpers (diagnostics only) ─────────────────────────
// DOM nodes traversed by forensic code may be HTMLElement, SVGElement,
// MathJax custom elements or SVG descendants. `SVGElement.className` is an
// `SVGAnimatedString` (not a string), so calling `.slice()`/`.trim()` directly
// on `className` throws. These helpers normalize to string FIRST and never
// throw (Phase 7R.2-A1: forensic must be read-only + non-throwing).
export function safeElementClassName(node: Element | null | undefined): string {
  if (!node) return ''
  try {
    const viaAttr = node.getAttribute('class')
    if (typeof viaAttr === 'string') return viaAttr
  } catch { /* ignore */ }
  try {
    const cn = (node as { className?: unknown }).className
    if (typeof cn === 'string') return cn
    if (cn && typeof (cn as { baseVal?: unknown }).baseVal === 'string') {
      return (cn as { baseVal: string }).baseVal
    }
  } catch { /* ignore */ }
  return ''
}

export function safeTagName(node: Element | null | undefined): string {
  if (!node) return ''
  try {
    const t = node.tagName
    return typeof t === 'string' ? t : ''
  } catch { /* ignore */ }
  return ''
}

export function safeText(node: Node | null | undefined, maxLength = 40): string {
  if (!node) return ''
  try {
    const t = node.textContent
    return typeof t === 'string' ? t.slice(0, maxLength) : ''
  } catch { /* ignore */ }
  return ''
}

export function safeAttr(node: Element | null | undefined, name: string, maxLength = 40): string {
  if (!node) return ''
  try {
    const v = node.getAttribute(name)
    return typeof v === 'string' ? v.slice(0, maxLength) : ''
  } catch { /* ignore */ }
  return ''
}

/** Classify a broad math candidate by ownership role (pure + jsdom-testable). */
export function classifyFormulaCandidateRole(el: HTMLElement): FormulaCandidateRole {
  if (el.matches(FORMULA_LOGICAL_HOST_SELECTOR)) return 'LOGICAL_SOURCE_HOST'
  if (el.matches('mjx-container') || el.classList.contains('MathJax')) return 'RENDERED_MATHJAX_HOST'
  if (el.closest('mjx-container, .MathJax')) return 'MATHJAX_INTERNAL'
  return 'UNKNOWN'
}

/**
 * Classify a canonical math host. Pure + jsdom-testable.
 * Returns ACCEPT only for block-level logical Formula hosts; everything else is rejected.
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
  // Rendered MathJax output can never be a business Formula target (ownership invariant).
  if (host.matches('mjx-container') || host.classList.contains('MathJax')) {
    return { decision: 'REJECT_RENDERER_OUTPUT', reason: 'RENDERED_MATHJAX_OUTPUT', canonicalHost: null }
  }
  return { decision: 'ACCEPT_BLOCK_FORMULA', reason: 'BLOCK_FORMULA_HOST', canonicalHost: host }
}

/**
 * Choose the native-number conflict strategy (priority A → B → C).
 * Pure + jsdom-testable.
 *
 * A. reuse-native: native number node exists and is safe to mutate.
 * B. hide-native: native number node exists but is MathJax-internal (mjx-tag)
 *    → hide it + render the InkChapter decoration.
 * C. render-custom: no native number node (ordinary untagged display math)
 *    → render the InkChapter decoration directly. Never BLOCK on absence of a
 *    native tag: for untagged formulas Typora creates no native tag at all.
 */
export function chooseFormulaStrategy(input: {
  nativeNumberFound: boolean
  nativeNodeSafe: boolean
}): FormulaStrategy {
  if (input.nativeNumberFound && input.nativeNodeSafe) return 'reuse-native'
  if (input.nativeNumberFound && !input.nativeNodeSafe) return 'hide-native'
  return 'render-custom'
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

  constructor(private getEditorRoot: () => HTMLElement | null) {}

  /**
   * Detect a native number node inside a block formula host.
   * - Skips InkChapter decorations (`data-inkchapter-formula-number`).
   * - Skips MathJax internal leaves; the native MathJax tag itself is `mjx-tag`
   *   and is found but marked unsafe (never mutate MathJax-managed nodes).
   */
  detectNativeNumber(host: HTMLElement): { node: HTMLElement | null; text: string; safe: boolean } {
    const leaves = Array.from(host.querySelectorAll<HTMLElement>('span, div, mjx-tag'))
    for (const el of leaves) {
      // The InkChapter decoration is never a native number.
      if (el.hasAttribute(DECORATION_ATTR)) continue
      // The native number label never contains MathJax content.
      if (el.querySelector('mjx-container, svg, math')) continue
      // MathJax internal leaves (other than the native tag node itself) are never labels.
      if (el.tagName !== 'MJX-TAG' && el.closest('mjx-container, .MathJax')) continue
      const text = (el.textContent ?? '').trim()
      if (NATIVE_NUMBER_TEXT.test(text)) {
        // mjx-tag is MathJax-managed output → never safe to rewrite in place.
        return { node: el, text, safe: el.tagName !== 'MJX-TAG' }
      }
    }
    return { node: null, text: '', safe: false }
  }

  /**
   * Bounded Formula ownership forensic (Phase 7R.1-A).
   * Scans the BROAD math selector and classifies each candidate by ownership
   * role, proving that only logical source blocks become business targets.
   * Read-only; never floods the audit with TeX bodies.
   */
  formulaHostOwnershipForensic(): FormulaHostForensicEntry[] {
    const root = this.getEditorRoot()
    if (!root) return []
    const entries: FormulaHostForensicEntry[] = []
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(MATH_HOST_SELECTOR))) {
      const role = classifyFormulaCandidateRole(el)
      const insideLogicalFormulaHost = !!el.closest(FORMULA_LOGICAL_HOST_SELECTOR)
      const parent = el.parentElement
      const closestLogical = el.closest<HTMLElement>(FORMULA_LOGICAL_HOST_SELECTOR)
      entries.push({
        candidateTag: safeTagName(el),
        candidateClass: safeElementClassName(el).slice(0, 60),
        candidateConnected: el.isConnected,
        candidateRole: role,
        candidateParentTag: safeTagName(parent),
        candidateParentClass: safeElementClassName(parent).slice(0, 60),
        insideLogicalFormulaHost,
        containsMjxContainer: !!el.querySelector(RENDERED_MATH_SELECTOR),
        sameLogicalFormulaOwnershipToken: role === 'LOGICAL_SOURCE_HOST'
          ? `${safeTagName(el)}.${safeElementClassName(el).slice(0, 40)}`
          : (closestLogical
              ? `LOGICAL=${safeElementClassName(closestLogical).slice(0, 40)}`
              : 'DETACHED'),
        decision: role === 'LOGICAL_SOURCE_HOST'
          ? 'ACCEPT_BUSINESS_TARGET'
          : (insideLogicalFormulaHost || role === 'RENDERED_MATHJAX_HOST'
              ? 'REJECT_RENDERER_OUTPUT'
              : 'REJECT_NON_FORMULA'),
      })
    }
    return entries
  }

  /**
   * Bounded single-projection forensic (Phase 7R.2-A2).
   * READ-ONLY + NON-THROWING + NON-BLOCKING observation of the ACTUAL visible
   * projection state per logical Formula. Proves whether Typora's visible
   * number is an independent node or embedded MathJax SVG output, and whether
   * FORMULA-NATIVE-DETECT is a false negative. Never logs full TeX / SVG.
   *
   * Any internal failure is contained: emits FORMULA-VISIBLE-PROJECTION-
   * FORENSIC-ERROR and returns an empty result — it can never abort the
   * Formula reconcile in the caller.
   */
  formulaVisibleProjectionForensic(): FormulaVisibleProjectionForensicEntry[] {
    try {
      return this.collectVisibleProjectionForensic()
    } catch (error) {
      emitRuntimeAudit('FORMULA-VISIBLE-PROJECTION-FORENSIC-ERROR', {
        formulaRuntimeKey: 'all',
        errorName: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        errorMessage: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        stage: 'formulaVisibleProjectionForensic',
        decision: 'FORENSIC_ERROR_IGNORED',
        businessProjectionBlocked: false,
      })
      return []
    }
  }

  /** Raw forensic collection — may throw; public entry point contains it. */
  private collectVisibleProjectionForensic(): FormulaVisibleProjectionForensicEntry[] {
    const root = this.getEditorRoot()
    if (!root) return []
    const entries: FormulaVisibleProjectionForensicEntry[] = []
    const hosts = new Set<HTMLElement>()
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(FORMULA_LOGICAL_HOST_SELECTOR))) {
      hosts.add(resolveCanonicalHost(el))
    }
    for (const host of hosts) {
      const mjxContainers = Array.from(host.querySelectorAll<HTMLElement>(RENDERED_MATH_SELECTOR))
      const mjxOutputChildren: Array<{ tagName: string; className: string; text: string }> = []
      const nativeNumberPatternNodes: Array<{ tagName: string; className: string; text: string }> = []
      const tagLikeFingerprints: FormulaVisibleProjectionForensicEntry['mathJaxTagLikeFingerprints'] = []
      for (const mjx of mjxContainers) {
        for (const child of Array.from(mjx.children)) {
          if (mjxOutputChildren.length >= 8) break
          mjxOutputChildren.push({
            tagName: safeTagName(child),
            className: safeElementClassName(child),
            text: safeText(child),
          })
        }
        // Deep scan for leaf nodes whose text matches a native number label
        // pattern — the current detector's target population.
        for (const el of Array.from(mjx.querySelectorAll<HTMLElement>('*'))) {
          if (nativeNumberPatternNodes.length >= 6 && tagLikeFingerprints.length >= 6) break
          const text = safeText(el)
          const leaf = el.children.length === 0
          if (leaf && text.length > 0 && text.length <= 40 && NATIVE_NUMBER_TEXT.test(text)) {
            nativeNumberPatternNodes.push({
              tagName: safeTagName(el),
              className: safeElementClassName(el),
              text,
            })
          }
          const className = safeElementClassName(el)
          if (/tag/i.test(safeTagName(el)) || /tag/i.test(className)) {
            if (tagLikeFingerprints.length >= 6) continue
            const parent = el.parentElement
            let rect: { width: number; height: number } | null = null
            try {
              const r = el.getBoundingClientRect()
              if (r && typeof r.width === 'number' && typeof r.height === 'number') {
                rect = { width: Math.round(r.width), height: Math.round(r.height) }
              }
            } catch { /* ignore */ }
            tagLikeFingerprints.push({
              tagName: safeTagName(el),
              className: className.slice(0, 40),
              parentTag: safeTagName(parent),
              parentClass: safeElementClassName(parent).slice(0, 40),
              attrs: ['aria-label', 'style', 'data-mml-node'].map(name => ({
                name,
                value: safeAttr(el, name, 40),
              })).filter(a => a.value !== ''),
              textExcerpt: text.slice(0, 40),
              rect,
            })
          }
        }
      }
      const decoCount = host.querySelectorAll(`[${DECORATION_ATTR}]`).length
      const tagBefore = host.getAttribute('data-math-tag-before')
      const tagAfter = host.getAttribute('data-math-tag-after')
      const labels = host.getAttribute('data-math-labels')
      const native = this.detectNativeNumber(host)

      const nativeNodes = mjxOutputChildren.filter(c => NATIVE_NUMBER_TEXT.test(c.text))
      const origin: FormulaProjectionOrigin = decoCount > 0
        ? (nativeNodes.length > 0 ? 'TYPORA_AUTO' : 'INKCHAPTER_CUSTOM')
        : (nativeNodes.length > 0
            ? (nativeNodes.every(n => NATIVE_NUMBER_TEXT.test(n.text))
                ? 'TYPORA_AUTO'
                : 'USER_EXPLICIT_TAG')
            : 'UNKNOWN')
      const effectiveProjectionChannelsObserved =
        (nativeNodes.length > 0 ? 1 : 0) + (decoCount > 0 ? 1 : 0)
      const decision: FormulaVisibleProjectionForensicEntry['decision'] =
        mjxContainers.length === 0 ? 'NO_RENDERER' : (effectiveProjectionChannelsObserved > 0 ? 'OBSERVED' : 'UNKNOWN')

      entries.push({
        logicalHostTag: safeTagName(host),
        logicalHostClass: safeElementClassName(host).slice(0, 60),
        logicalHostConnected: host.isConnected,
        mjxContainerCount: mjxContainers.length,
        svgRootCount: host.querySelectorAll('svg').length,
        mjxOutputChildren,
        nativeNumberPatternNodes,
        inkchapterDecorationCount: decoCount,
        dataMathTagBeforePresent: !!tagBefore,
        dataMathTagBeforeValue: tagBefore ? tagBefore.slice(0, 24) : '',
        dataMathTagAfterPresent: !!tagAfter,
        dataMathTagAfterValue: tagAfter ? tagAfter.slice(0, 24) : '',
        dataMathLabelsPresent: !!labels,
        nativeDetectorFound: !!native.node,
        nativeDetectorText: native.text,
        mathJaxTagLikeNodeCount: tagLikeFingerprints.length,
        mathJaxTagLikeFingerprints: tagLikeFingerprints,
        projectionOrigin: origin,
        effectiveProjectionChannelsObserved,
        decision,
      })
    }
    return entries
  }

  /** Collect canonical block-formula BUSINESS targets in document order (4 logical → 4 canonical). */
  collectFormulaTargets(): FormulaTarget[] {
    const root = this.getEditorRoot()
    if (!root) return []

    const hosts = new Set<HTMLElement>()
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(FORMULA_LOGICAL_HOST_SELECTOR))) {
      hosts.add(resolveCanonicalHost(el))
    }

    const targets: FormulaTarget[] = []
    for (const host of hosts) {
      const { decision, reason } = classifyFormulaHost(host)
      console.info(
        `[InkChapter Numbering] FORMULA-TARGET tag=${safeTagName(host)} ` +
        `class=${safeElementClassName(host).slice(0, 60)} connected=${host.isConnected} ` +
        `decision=${decision} reason=${reason}`,
      )
      if (decision !== 'ACCEPT_BLOCK_FORMULA') continue
      const native = this.detectNativeNumber(host)
      console.info(
        `[InkChapter Numbering] FORMULA-NATIVE-DETECT tag=${safeTagName(host)} ` +
        `nativeNumberFound=${!!native.node} nativeNumberText=${JSON.stringify(native.text)} ` +
        `nativeNodeSafe=${native.safe} decision=${native.node ? 'FOUND' : 'NOT_FOUND'}`,
      )
      targets.push({
        root: host,
        ordinal: targets.length,
        nativeNumberNode: native.node,
        nativeNumberText: native.text,
        nativeNodeSafe: native.safe,
      })
    }
    return targets
  }

  /**
   * Idempotently reconcile formula numbers against the desired state.
   * Stable state produces NO_OP (no DOM mutation).
   */
  reconcile(items: FormulaReconcileItem[]): FormulaReconcileStats {
    const stats: FormulaReconcileStats = {
      noOpCount: 0,
      updateNativeTextCount: 0,
      hideNativeRenderCustomCount: 0,
      renderCustomCount: 0,
      deferredCount: 0,
      blockCustomCount: 0,
      restoreNativeCount: 0,
    }

    const activeRoots = new Set<HTMLElement>(items.map(i => i.target.root))

    // Remove stale decorations for hosts that are no longer formula targets.
    const root = this.getEditorRoot()
    if (root) {
      for (const deco of Array.from(root.querySelectorAll<HTMLElement>(`[${DECORATION_ATTR}]`))) {
        const host = deco.closest<HTMLElement>(FORMULA_LOGICAL_HOST_SELECTOR)
        if (host && !activeRoots.has(resolveCanonicalHost(host))) {
          deco.remove()
        }
      }
    }

    for (const item of items) {
      const target = item.target
      const host = target.root
      const native = target.nativeNumberNode
      const deco = this.findDecoration(host)

      // ── Native / disabled → restore native, remove InkChapter effect ──
      if (!item.enabled || item.mode === 'typora-native') {
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

      // ── Custom mode ──
      // Re-evaluate the strategy on every pass so a native tag appearing or
      // disappearing across MathJax rerenders never leaves a stale decision.
      const chosen = chooseFormulaStrategy({ nativeNumberFound: !!native, nativeNodeSafe: target.nativeNodeSafe })
      this.strategyByHost.set(host, chosen)

      if (chosen === 'reuse-native') {
        if (deco) deco.remove()
        if (native && native.textContent !== item.renderedNumber) {
          this.rememberOriginal(native)
          native.textContent = item.renderedNumber
          native.setAttribute(MANAGED_ATTR, 'text')
          stats.updateNativeTextCount++
          console.info(
            `[InkChapter Numbering] FORMULA-RECONCILE tag=${host.tagName} mode=${item.mode} ` +
            `decision=UPDATE_NATIVE_TEXT desired=${JSON.stringify(item.renderedNumber)} reason=REUSE_NATIVE_NODE`,
          )
        } else {
          stats.noOpCount++
        }
        continue
      }

      // hide-native: hide the (unsafe) native tag before rendering our decoration.
      if (chosen === 'hide-native' && native && native.style.display !== 'none') {
        this.rememberOriginal(native)
        native.style.display = 'none'
        native.setAttribute(MANAGED_ATTR, 'hidden')
      }

      // ── Custom projection decoration (hide-native + render-custom) ──
      // The projection node is the rendered MathJax host inside the logical
      // block; it is PROJECTION output and never becomes a business target.
      const projectionTarget = this.resolveProjectionTarget(host)
      if (!projectionTarget) {
        if (deco) {
          deco.remove()
          stats.restoreNativeCount++
          console.info(
            `[InkChapter Numbering] FORMULA-RECONCILE tag=${host.tagName} mode=${item.mode} ` +
            `decision=REMOVE_STALE_CUSTOM reason=RENDERER_NOT_READY`,
          )
        } else {
          stats.deferredCount++
          console.info(
            `[InkChapter Numbering] FORMULA-PROJECTION-DEFER tag=${host.tagName} ` +
            `reason=RENDERER_NOT_READY projectionWrites=0`,
          )
          emitRuntimeAudit('FORMULA-PROJECTION-DEFER', {
            reason: 'RENDERER_NOT_READY',
            projectionWrites: 0,
          })
        }
        continue
      }

      let decoration = deco
      if (!decoration) {
        decoration = document.createElement('span')
        decoration.className = 'inkchapter-formula-number'
        decoration.setAttribute(DECORATION_ATTR, 'true')
        decoration.setAttribute('contenteditable', 'false')
        projectionTarget.insertAdjacentElement('afterend', decoration)
      }
      if (decoration.textContent !== item.label) {
        decoration.textContent = item.label
        if (chosen === 'hide-native') stats.hideNativeRenderCustomCount++
        else stats.renderCustomCount++
        console.info(
          `[InkChapter Numbering] FORMULA-RECONCILE tag=${host.tagName} mode=${item.mode} ` +
          `decision=${chosen === 'hide-native' ? 'HIDE_NATIVE_RENDER_CUSTOM' : 'RENDER_CUSTOM'} ` +
          `label=${JSON.stringify(item.label)} reason=${chosen === 'hide-native' ? 'HIDE_NATIVE_RENDER_CUSTOM' : 'NO_NATIVE_NODE_RENDER_CUSTOM'}`,
        )
      } else {
        stats.noOpCount++
      }
    }

    return stats
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
        this.nativeOriginals.delete(native)
        changed = true
      }
    }
    return changed
  }

  /**
   * PROJECTION target resolution: the rendered MathJax output host inside the
   * logical block. This node is where the visible InkChapter number is anchored;
   * it is NOT a business Formula target. Returns null while the renderer is not
   * ready (formula still in raw/preprocess state) → caller DEFERs writes.
   */
  private resolveProjectionTarget(host: HTMLElement): HTMLElement | null {
    return host.querySelector<HTMLElement>(RENDERED_MATH_SELECTOR)
  }

  private findDecoration(host: HTMLElement): HTMLElement | null {
    return host.querySelector<HTMLElement>(`[${DECORATION_ATTR}]`) ?? null
  }

  private rememberOriginal(native: HTMLElement): void {
    if (!this.nativeOriginals.has(native)) {
      this.nativeOriginals.set(native, { text: native.textContent ?? '', display: native.style.display })
    }
  }

  /** Current double-number evidence across all block formula hosts. */
  computeDoubleNumber(): FormulaDoubleNumber {
    const root = this.getEditorRoot()
    let nativeVisibleCount = 0
    let inkchapterVisibleCount = 0
    if (root) {
      const hosts = new Set<HTMLElement>()
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(FORMULA_LOGICAL_HOST_SELECTOR))) {
        hosts.add(resolveCanonicalHost(el))
      }
      for (const host of hosts) {
        const native = this.detectNativeNumber(host)
        if (native.node && native.node.style.display !== 'none') nativeVisibleCount++
        if (host.querySelector(`[${DECORATION_ATTR}]`)) inkchapterVisibleCount++
      }
    }
    return {
      nativeVisibleCount,
      inkchapterVisibleCount,
      doubleNumberDetected: computeDoubleNumberDetected(nativeVisibleCount, inkchapterVisibleCount),
    }
  }

  /** Remove all InkChapter formula decorations (does not touch native nodes). */
  clearAll(): void {
    const root = this.getEditorRoot()
    if (!root) return
    for (const deco of Array.from(root.querySelectorAll<HTMLElement>(`[${DECORATION_ATTR}]`))) {
      deco.remove()
    }
  }
}
