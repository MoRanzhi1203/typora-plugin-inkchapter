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
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

export type FormulaTargetDecision =
  | 'ACCEPT_BLOCK_FORMULA'
  | 'REJECT_INLINE_MATH'
  | 'REJECT_CODEMIRROR_INTERNAL'
  | 'REJECT_NESTED_PRE'
  | 'REJECT_DISCONNECTED'

export type FormulaStrategy = 'reuse-native' | 'hide-native' | 'block'

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
}

export interface FormulaReconcileStats {
  noOpCount: number
  updateNativeTextCount: number
  hideNativeRenderCustomCount: number
  blockCustomCount: number
  restoreNativeCount: number
}

export interface FormulaDoubleNumber {
  nativeVisibleCount: number
  inkchapterVisibleCount: number
  doubleNumberDetected: boolean
}

const DECORATION_ATTR = 'data-inkchapter-formula-number'
const MANAGED_ATTR = 'data-inkchapter-formula-managed'

/** A native Typora formula number label looks like a standalone `(1)` / `(2.3)`. */
const NATIVE_NUMBER_TEXT = /^\(\s*\d+(?:[.\-/]\d+)*\s*\)$/

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
  return { decision: 'ACCEPT_BLOCK_FORMULA', reason: 'BLOCK_FORMULA_HOST', canonicalHost: host }
}

/**
 * Choose the native-number conflict strategy (priority A → B → C).
 * Pure + jsdom-testable.
 */
export function chooseFormulaStrategy(input: {
  nativeNumberFound: boolean
  nativeNodeSafe: boolean
}): FormulaStrategy {
  if (input.nativeNumberFound && input.nativeNodeSafe) return 'reuse-native'
  if (input.nativeNumberFound && !input.nativeNodeSafe) return 'hide-native'
  return 'block'
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

  /** Detect a native number node inside a block formula host (text-pattern based). */
  detectNativeNumber(host: HTMLElement): { node: HTMLElement | null; text: string; safe: boolean } {
    const leaves = Array.from(host.querySelectorAll<HTMLElement>('span, div'))
    for (const el of leaves) {
      // The native number label never contains MathJax content.
      if (el.querySelector('mjx-container, svg, math')) continue
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

    const hosts = new Set<HTMLElement>()
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(MATH_HOST_SELECTOR))) {
      hosts.add(resolveCanonicalHost(el))
    }

    const targets: FormulaTarget[] = []
    for (const host of hosts) {
      const { decision, reason } = classifyFormulaHost(host)
      const native = this.detectNativeNumber(host)
      // Phase 7R bounded discovery diagnostic — distinguishes raw block vs rendered MathJax host.
      emitRuntimeAudit('FORMULA-TARGET-CANDIDATE', {
        targetOrdinal: targets.length,
        targetTag: host.tagName,
        targetClass: (host.className || '').slice(0, 60),
        targetConnected: host.isConnected,
        canonicalHostTag: host.tagName,
        canonicalHostClass: (host.className || '').slice(0, 60),
        canonicalHostToken: `${host.tagName}.${(host.className || '').slice(0, 40)}:${host.getAttribute('data-line') ?? 'no-line'}`,
        logicalSourceBlockToken: host.matches('.md-math-block, .mathjax-block') ? 'RAW_BLOCK' : (host.matches('mjx-container, .MathJax') ? 'RENDERED_MATHJAX' : 'OTHER'),
        renderedMathJaxToken: host.tagName === 'MJX-CONTAINER' || host.classList.contains('MathJax') ? 'RENDERED' : (host.querySelector('mjx-container') ? 'HAS_MATHJAX_CHILD' : 'NONE'),
        decision,
      })
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
      blockCustomCount: 0,
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
      const deco = this.findDecoration(host)
      const strategy = this.strategyByHost.get(host) ?? null

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
      const chosen = strategy ?? chooseFormulaStrategy({ nativeNumberFound: !!native, nativeNodeSafe: target.nativeNodeSafe })
      this.strategyByHost.set(host, chosen)

      if (chosen === 'block') {
        if (deco) {
          deco.remove()
          stats.restoreNativeCount++
        } else {
          stats.blockCustomCount++
        }
        console.info(
          `[InkChapter Numbering] FORMULA-RECONCILE tag=${host.tagName} mode=${item.mode} ` +
          `decision=BLOCK_CUSTOM reason=NATIVE_NODE_NOT_FOUND`,
        )
        continue
      }

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

      // chosen === 'hide-native'
      if (native && native.style.display !== 'none') {
        this.rememberOriginal(native)
        native.style.display = 'none'
        native.setAttribute(MANAGED_ATTR, 'hidden')
      }
      let decoration = this.findDecoration(host)
      if (!decoration) {
        decoration = document.createElement('span')
        decoration.className = 'inkchapter-formula-number'
        decoration.setAttribute(DECORATION_ATTR, 'true')
        decoration.setAttribute('contenteditable', 'false')
        if (native) native.insertAdjacentElement('afterend', decoration)
        else host.appendChild(decoration)
      }
      if (decoration.textContent !== item.label) {
        decoration.textContent = item.label
        stats.hideNativeRenderCustomCount++
      } else {
        stats.noOpCount++
      }
      console.info(
        `[InkChapter Numbering] FORMULA-RECONCILE tag=${host.tagName} mode=${item.mode} ` +
        `decision=HIDE_NATIVE_RENDER_CUSTOM label=${JSON.stringify(item.label)} reason=HIDE_NATIVE_RENDER_CUSTOM`,
      )
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
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(MATH_HOST_SELECTOR))) {
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
