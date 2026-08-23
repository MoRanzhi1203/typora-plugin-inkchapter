/**
 * MathJax Render-Input Hook (Phase 7R.3-C / 7R.3.1-A / 7R.3.2-B)
 *
 * The PROVEN native render seam: Typora's visible Formula number is produced by
 * MathJax itself during `MathJax.tex2svgPromise(tex, metrics)` (and the sync
 * `MathJax.tex2svg`), driven by `tex.tags` + the MathJax tag counter. MathJax
 * renders exactly ONE tag per equation; an explicit `\tag{X}` in the transient
 * render input overrides the automatic sequential number for that equation and
 * does NOT consume the counter (proven in the MathJax Tag source).
 *
 * Phase 7R.3.2 architecture:
 *   - SINGLE STABLE WRAPPER: the hook is installed exactly once per plugin
 *     session (MATHJAX_HOOK_INSTALLATION_COUNT = 1). It is process/plugin
 *     infrastructure, NOT document identity.
 *   - LIVE CONTEXT PROVIDER: `getLiveContext()` is called INSIDE every
 *     tex2svgPromise/tex2svg call. documentKey / headingSnapshotRevision /
 *     controller are read at call time — never frozen at install time.
 *   - For a TeX string correlating to EXACTLY ONE canonical Formula with an
 *     active inkchapter-native-transient plan, a transient `\tag{<semantic>}`
 *     is appended to the render input. Document mismatch is never relaxed;
 *     pure snapshot revision drift on an identical plan is accepted.
 *
 * Safety: host-correlated, idempotent (explicit `\tag` preserved), transient
 * (Markdown never modified), exception-safe (failure falls through).
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { hashFormulaSource } from './formula-projection-controller'
import type { FormulaProjectionController } from './formula-projection-controller'

export interface FormulaProjectionLiveContext {
  documentKey: string | null
  controller: FormulaProjectionController | null
  /** Provenance/debug only — never used as the sole authority. */
  headingSnapshotRevision: number | null
}

export type FormulaProjectionLiveContextProvider = () => FormulaProjectionLiveContext

type MathJaxLike = {
  tex2svgPromise?: (...args: unknown[]) => unknown
  tex2svg?: (...args: unknown[]) => unknown
}

let hookInstalled = false
let hookUninstall: (() => void) | null = null
let installationAttemptCount = 0
let installationSuccessCount = 0
let liveProvider: FormulaProjectionLiveContextProvider | null = null
/** Install-time document values retained ONLY as forensic evidence. */
let installForensic: { documentKey: string | null; revision: number | null } | null = null

function getMathJax(): MathJaxLike | null {
  try {
    const M = (globalThis as { MathJax?: MathJaxLike }).MathJax
    return M && typeof M.tex2svgPromise === 'function' ? M : null
  } catch {
    return null
  }
}

/** Bounded structural scan of a MathJax returned node for tag evidence. */
function scanOutputForTags(node: unknown): { semanticTagEvidenceCount: number; sequentialTagEvidenceCount: number; outputTagName: string } {
  try {
    const el = node as Element
    if (!el || typeof el.querySelectorAll !== 'function') {
      return { semanticTagEvidenceCount: 0, sequentialTagEvidenceCount: 0, outputTagName: 'NON_ELEMENT' }
    }
    const textNodes = Array.from(el.querySelectorAll('*'))
      .filter(n => n.children.length === 0)
      .map(n => (n.textContent ?? '').trim())
      .filter(t => t.length > 0 && t.length <= 40)
    const semanticTagEvidenceCount = textNodes.filter(t => /\(\s*[\d]+\.[\d.]+-[\d]+\s*\)/.test(t)).length
    const sequentialTagEvidenceCount = textNodes.filter(t => /^\(\s*\d+\s*\)$/.test(t)).length
    return { semanticTagEvidenceCount, sequentialTagEvidenceCount, outputTagName: el.tagName }
  } catch {
    return { semanticTagEvidenceCount: 0, sequentialTagEvidenceCount: 0, outputTagName: 'SCAN_ERROR' }
  }
}

/**
 * Install the SINGLE STABLE MathJax wrapper (idempotent, install once).
 * `getLiveContext` must be a STABLE provider reference (reads live state);
 * the wrapper invokes it on EVERY call so document/revision never freeze.
 *
 * Returns true when the hook is (or was already) installed. If MathJax is not
 * ready yet, returns false and the caller should retry on the next refresh
 * opportunity (event-driven, no timers).
 */
export function ensureMathJaxRenderInputHook(options: { getLiveContext: FormulaProjectionLiveContextProvider }): boolean {
  installationAttemptCount++
  if (hookInstalled) {
    emitRuntimeAudit('FORMULA-MATHJAX-HOOK-INSTALL', {
      mathJaxPresent: true,
      tex2svgPromisePresent: true,
      tex2svgPresent: !!getMathJax()?.tex2svg,
      promiseWrapped: true,
      syncWrapped: !!getMathJax()?.tex2svg,
      installationAttemptCount,
      installationSuccessCount,
      alreadyWrapped: true,
      decision: 'ALREADY_INSTALLED',
    })
    return true
  }
  const M = getMathJax()
  if (!M) {
    emitRuntimeAudit('FORMULA-MATHJAX-HOOK-INSTALL', {
      mathJaxPresent: false,
      tex2svgPromisePresent: false,
      tex2svgPresent: false,
      promiseWrapped: false,
      syncWrapped: false,
      installationAttemptCount,
      installationSuccessCount,
      alreadyWrapped: false,
      decision: 'MATHJAX_NOT_READY',
    })
    return false
  }
  if (typeof M.tex2svgPromise !== 'function') {
    emitRuntimeAudit('FORMULA-MATHJAX-HOOK-INSTALL', {
      mathJaxPresent: true,
      tex2svgPromisePresent: false,
      tex2svgPresent: !!M.tex2svg,
      promiseWrapped: false,
      syncWrapped: false,
      installationAttemptCount,
      installationSuccessCount,
      alreadyWrapped: false,
      decision: 'UNSUPPORTED_SURFACE',
    })
    return false
  }

  liveProvider = options.getLiveContext
  const installLive = liveProvider()
  installForensic = { documentKey: installLive.documentKey, revision: installLive.headingSnapshotRevision }

  const origPromise = M.tex2svgPromise!
  const origSync = M.tex2svg

  const prepare = (tex: unknown, callKind: 'tex2svgPromise' | 'tex2svg'): { tex: unknown; injected: boolean; inputHashBefore: string; sourceHash: string } => {
    const inputHashBefore = typeof tex === 'string' ? hashFormulaSource(tex) : ''
    const inputLength = typeof tex === 'string' ? tex.length : 0
    // LIVE context — read fresh on EVERY call (never the install-time closure).
    const live = liveProvider ? liveProvider() : { documentKey: null, controller: null, headingSnapshotRevision: null }
    emitRuntimeAudit('FORMULA-MATHJAX-HOOK-CALL', {
      callKind,
      hookInstallDocumentKey: installForensic?.documentKey ?? null,
      hookInstallRevision: installForensic?.revision ?? null,
      liveDocumentKey: live.documentKey,
      liveSnapshotRevision: live.headingSnapshotRevision,
      contextSource: 'LIVE_PROVIDER',
      inputHash: inputHashBefore,
      inputLength,
      inputHasExplicitTag: typeof tex === 'string' && /(^|[^\\])\\tag\s*\{/.test(tex),
      activePlanCount: live.controller ? live.controller.inventory().planCount : 0,
      decision: 'OBSERVED',
    })
    if (typeof tex !== 'string' || !live.controller || !live.documentKey) {
      return { tex, injected: false, inputHashBefore, sourceHash: inputHashBefore }
    }
    try {
      const decision = live.controller.prepareTransientRenderInput(tex, live.documentKey, live.headingSnapshotRevision ?? -1)
      if (decision.injected) {
        const plan = live.controller.getPlanBySourceHash(decision.sourceHash)
        emitRuntimeAudit('FORMULA-NATIVE-TRANSIENT-INJECT', {
          documentKey: live.documentKey,
          activeRevision: live.headingSnapshotRevision ?? -1,
          formulaRuntimeKey: plan?.formulaRuntimeKey ?? null,
          inputHashBefore,
          inputHashAfter: hashFormulaSource(decision.tex),
          rawNumber: plan?.rawNumber ?? null,
          renderedNumber: plan?.renderedNumber ?? null,
          tagInjected: true,
          sourceMutated: false,
          decision: 'INJECTED',
        })
        emitRuntimeAudit('FORMULA-MATHJAX-DELEGATE', {
          callKind,
          inputHashBefore,
          delegatedInputHash: hashFormulaSource(decision.tex),
          tagInjected: true,
          semanticTagTokenHash: hashFormulaSource(`\\tag{${plan?.rawNumber ?? ''}}`),
          decision: 'DELEGATED',
        })
      }
      return { tex: decision.tex, injected: decision.injected, inputHashBefore, sourceHash: decision.sourceHash }
    } catch {
      return { tex, injected: false, inputHashBefore, sourceHash: inputHashBefore }
    }
  }

  M.tex2svgPromise = function (tex: unknown, options?: unknown) {
    const prepared = prepare(tex, 'tex2svgPromise')
    const result = origPromise.call(M, prepared.tex, options)
    if (prepared.injected && result && typeof (result as Promise<unknown>).then === 'function') {
      const sourceHash = prepared.sourceHash
      const live = liveProvider ? liveProvider() : null
      const plan = live?.controller?.getPlanBySourceHash(sourceHash)
      ;(result as Promise<unknown>).then((node: unknown) => {
        const scan = scanOutputForTags(node)
        emitRuntimeAudit('FORMULA-MATHJAX-OUTPUT', {
          formulaRuntimeKey: plan?.formulaRuntimeKey ?? null,
          tagInjected: true,
          outputTagName: scan.outputTagName,
          outputConnectedAtReturn: node instanceof Element ? node.isConnected : null,
          semanticTagEvidenceCount: scan.semanticTagEvidenceCount,
          sequentialTagEvidenceCount: scan.sequentialTagEvidenceCount,
          decision: scan.semanticTagEvidenceCount > 0
            ? (scan.sequentialTagEvidenceCount > 0 ? 'DUPLICATE_TAGS_IN_RETURNED_OUTPUT' : 'SEMANTIC_TAG_PRESENT')
            : 'NO_SEMANTIC_TAG_IN_RETURNED_OUTPUT',
        })
      }, () => {
        /* render failure — no output audit */
      })
    }
    return result
  }
  if (origSync) {
    M.tex2svg = function (tex: unknown, options?: unknown) {
      const prepared = prepare(tex, 'tex2svg')
      return origSync.call(M, prepared.tex, options)
    }
  }

  hookInstalled = true
  installationSuccessCount++
  hookUninstall = () => {
    if (!hookInstalled) return
    const M2 = getMathJax()
    if (M2) {
      if (M2.tex2svgPromise === M.tex2svgPromise) M2.tex2svgPromise = origPromise
      if (origSync && M2.tex2svg === M.tex2svg) M2.tex2svg = origSync
    }
    hookInstalled = false
    hookUninstall = null
    liveProvider = null
    installForensic = null
  }
  emitRuntimeAudit('FORMULA-MATHJAX-HOOK-INSTALL', {
    mathJaxPresent: true,
    tex2svgPromisePresent: true,
    tex2svgPresent: !!origSync,
    promiseWrapped: true,
    syncWrapped: !!origSync,
    installationAttemptCount,
    installationSuccessCount,
    alreadyWrapped: false,
    decision: 'INSTALLED',
  })
  return true
}

/** Remove the hook (restore originals). Safe to call multiple times. */
export function uninstallMathJaxRenderInputHook(): void {
  if (hookUninstall) hookUninstall()
}

export function isMathJaxRenderInputHookInstalled(): boolean {
  return hookInstalled
}

export function mathJaxHookInstallationStats(): { attempts: number; successes: number } {
  return { attempts: installationAttemptCount, successes: installationSuccessCount }
}
