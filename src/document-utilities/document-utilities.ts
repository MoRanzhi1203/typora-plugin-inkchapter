/**
 * Phase 7R.3.11 — Document Utilities entry (factory).
 *
 * Wires the shared document context + production diagnostic providers from
 * existing authorities, then creates the singleton overlay host.
 */
import * as fs from 'fs'
import * as path from 'path'
import type { CanonicalHeadingFrame } from '../heading-numbering/canonical-heading-frame'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import type { ObjectEffectiveNumberElementFacts } from './diagnostics-types'
import type { OutlineDiagnosticTargetInput } from './document-diagnostic-outline-projection-v514-r2'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { ActiveLeafDocumentFacts } from './document-active-leaf-presence'
import { mapCanonicalHeadingFrameForDiagnostics } from './document-h1-authority-bridge'

export interface DocumentUtilitiesSources {
  getActiveFilePath: () => string | null
  getDocumentKey: () => string | null
  /**
   * V3 — ACTIVE workspace leaf document facts. Optional so legacy / headless
   * consumers keep the old file/document-key-only authority (leaf UNKNOWN).
   */
  getActiveLeafState?: () => ActiveLeafDocumentFacts | null | undefined
  /** V3 — workspace `active-leaf:change` primary lifecycle trigger. */
  onActiveLeafChanged?: (cb: () => void) => () => void
  /** V3 — workspace-tabs `tab:toggle` primary lifecycle trigger. */
  onTabToggle?: (cb: () => void) => () => void
  /** Empty Workspace UX V1 — optional platform (create/open .md on dblclick). */
  emptyWorkspace?: {
    platform: import('./document-empty-workspace-controller').EmptyWorkspaceUxPlatform
    contentEditableBoundaryAllowed?: boolean
    resolveEmptySurface?(): import('./document-empty-workspace-controller').EmptyWorkspaceSurfaceFacts | null
  }
  getMarkdown: () => string | null
  isStrictMode: () => boolean
  /** Phase 7R.3.11.8B.9 — conditional strict-policy activation gate
   *  (enabled && explicitly-configured && effective strict). Optional so
   *  legacy/test callers keep the isStrictMode-only semantics. */
  getHeadingPolicyState?: () => {
    enabled: boolean
    configured: boolean
    effectiveMode: 'strict' | 'loose' | 'custom' | null
    strictPolicyActive: boolean
  }
  vaultRoot: string | null
  /** Phase 7R.3.11.8B.1 — the REAL production CanonicalHeadingFrame. Level lives
   *  at entry.semanticState.physicalLevel (never a fake flat physicalLevel). */
  getCanonicalHeadingFrame: () => CanonicalHeadingFrame | null
  getCaptionTitleForElement: (el: HTMLElement) => string | null
  /**
   * VNext §24 — OBJECT auto-numbering activation (figure/table/code/formula).
   * Optional: absent ⇒ the manual-number rules stay OFF.
   */
  getObjectNumberingEnabled?: () => { figure?: boolean; table?: boolean; code?: boolean; formula?: boolean }
  /**
   * Heading Auto-Number Conflict V1 §2/§4 — the ONE per-heading heading
   * auto-numbering EFFECTIVENESS authority (owned by the numbering service).
   * Optional: absent ⇒ the conflict rule never runs.
   */
  getHeadingAutoNumberingEffectiveFacts?: () => {
    enabled: boolean
    h1NumberingEnabled: boolean
    /** Heading Auto-Number Conflict V1.2 §13 — the effective STYLE identity. */
    styleKey?: string
    isEffectiveForElement: (element: HTMLElement | null) => boolean
  }
  /**
   * Numbering Integrity V2 (spec §9/§21) — the ONE canonical effective-number
   * fact provider (owned by the caption service / formula planner), keyed by the
   * object's DOM element. Optional: absent ⇒ every number rule stays silent.
   */
  getObjectEffectiveNumberElementFacts?: () => ObjectEffectiveNumberElementFacts | null
  /**
   * Heading Auto-Number Conflict V1.2 §21/§22 — the dev/test post-commit report
   * sink (implemented by main.ts, which owns the file IO).
   */
  onHeadingConflictReportCapture?: (capture: {
    runtimeSessionId: string
    reportSequence: number
    settingsRevision: number
    sourceRevision: number
    diagnosticsRevision: number
    baselineEstablished: boolean
    capturePhase: 'POST_COMMIT'
    dualPass: { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[]; unmet: readonly string[] }
    gateReport: string[]
    coverageReport: string[]
  }) => void
  /**
   * Heading Auto-Number Conflict V1.2 §21/§22 — the ONE dev/test bridge
   * consumption point, invoked at the start of every diagnostics recompute.
   * Implemented by main.ts (owns the bridge file IO + the official setter).
   */
  consumeHeadingConflictTestBridge?: () => void
  /** Phase 7R.3.11.8B.7.6 — rendered caption host for an object element
   *  (compound missing-name locator). Optional. */
  getObjectCaptionHost?: (el: HTMLElement) => HTMLElement | null
  /**
   * Phase G §8 — the DOM-side Caption Integrity producer. Optional: absent ⇒
   * no caption-integrity diagnostics are merged into the snapshot.
   */
  getCaptionIntegrityDiagnostics?: (
    documentKey: string | null,
    sourceRevision: number,
  ) => readonly import('./diagnostics-types').DocumentDiagnostic[]
  /** V5.14-R2 §P8 — heading diagnostic occurrences → LEFT OUTLINE mirror. Optional. */
  publishOutlineHeadingDiagnostics?: (targets: readonly OutlineDiagnosticTargetInput[]) => void
  /** Phase 7R.3.11.8B.7.7 — Markdown SOURCE change subscription (markdownEditor
   *  'edit'). The live-reconcile authority for document-level diagnostics. */
  onSourceEdit?: (cb: () => void) => () => void
  getCodeLanguage: (el: HTMLElement) => string | null
  getFormulaVisibleTagTokens: (host: HTMLElement) => string[]
  /** Subscribe to document switch (workspace file:open etc.). */
  onDocumentSwitch: (cb: () => void) => () => void
  /** Phase 7R.3.11.8-B — canonical heading frame commit subscription (live diagnostics). */
  onCanonicalFrameCommit?: (cb: () => void) => () => void
  /** Phase 7R.3.11.8-B — numbering settings/mode change subscription. */
  onSettingsChanged?: (cb: () => void) => () => void
  /** Phase 7R.3.11.8B.7.1 — effective-mode transition revision (real transitions). */
  getEffectiveHeadingModeRevision?: () => number
}

export interface DocumentUtilities {
  host: DocumentUtilityOverlayHost
  mount: () => void
  dispose: () => void
  /** Phase 7R.3.11.8B.7.1 — latest PUBLISHED diagnostic snapshot (read-only). */
  getSnapshot: () => DocumentDiagnosticsSnapshot | null
}

const VISIBLE_TAG_TOKEN_RE = /^\(\s*([\d]+(?:\.[\d]+)*-\d+|\d+)\s*\)$/

/**
 * Read-only formula visible-tag token extraction (projection invariant check).
 * Mirrors the bounded logic of the existing Formula projection authority:
 * scans rendered MathJax leaf text for `(1.1-1)`-style tokens. It never
 * derives business state and never mutates anything.
 */
export function extractFormulaVisibleTagTokens(host: HTMLElement): string[] {
  const tokens: string[] = []
  for (const mjx of Array.from(host.querySelectorAll<HTMLElement>('mjx-container'))) {
    for (const el of Array.from(mjx.querySelectorAll<HTMLElement>('*'))) {
      if (el.children.length !== 0) continue
      const text = (el.textContent ?? '').replace(/\u00A0/g, ' ').trim()
      const m = VISIBLE_TAG_TOKEN_RE.exec(text)
      if (m) tokens.push(m[1])
      if (tokens.length >= 6) return tokens
    }
  }
  return tokens
}

// V5.12-R8 §6 — the Markdown resource scanner lives in ONE module
// (`document-resource-scanner.ts`). This file re-exports it so the historical
// provider contract (`parseLocalLinkTargets` / `LocalResourceReference`) stays
// intact while the offset authority stays single.
export { parseLocalLinkTargets, parseImageSourceOccurrences }
export type { LocalResourceReference, ImageSourceOccurrence, ResourceClass } from './document-resource-scanner'
import { parseLocalLinkTargets, parseImageSourceOccurrences } from './document-resource-scanner'

function isLocalRelative(target: string): boolean {
  if (!target) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false
  if (target.startsWith('#')) return false
  return true
}

/**
 * Phase 7R.3.11.8B.7.6 — resource base authority: the ACTIVE DOCUMENT's
 * directory (dirname(currentMarkdownFile)). Relative Markdown destinations are
 * resolved against it — NEVER against vaultRoot / cwd / plugin root. Falls
 * back to the vault root only when no active document path exists.
 */
function resourceBaseDir(activeFilePath: string | null, vaultRoot: string | null): string | null {
  if (activeFilePath) return path.dirname(activeFilePath)
  return vaultRoot
}

function imageLocalPath(img: HTMLElement, baseDir: string | null): string | null {
  const src = img.getAttribute('src') ?? ''
  if (!src) return null
  if (/^https?:\/\//i.test(src)) return null // remote — never a "missing local file"
  let candidate: string | null = null
  if (src.startsWith('file://')) {
    // file:///D:/... and file://D:/... → strip scheme and any leading slash.
    candidate = decodeURIComponent(src.slice('file://'.length).replace(/^\/+/, ''))
  } else if (path.isAbsolute(src)) {
    candidate = src
  } else if (baseDir) {
    candidate = path.resolve(baseDir, src)
  }
  if (!candidate) return null
  try {
    return fs.existsSync(candidate) ? null : candidate
  } catch {
    return null
  }
}

function linkTargetMissing(target: string, baseDir: string | null): boolean {
  if (!isLocalRelative(target) || !baseDir) return false
  try {
    const resolved = path.resolve(baseDir, target)
    return !fs.existsSync(resolved)
  } catch {
    return false
  }
}

export function createDocumentUtilities(sources: DocumentUtilitiesSources): DocumentUtilities {
  const ctx: DocumentUtilitiesContext = {
    authority: {
      getActiveFilePath: sources.getActiveFilePath,
      getDocumentKey: sources.getDocumentKey,
      getActiveLeafState: sources.getActiveLeafState,
      getMarkdown: sources.getMarkdown,
      isStrictMode: sources.isStrictMode,
      getHeadingPolicyState: sources.getHeadingPolicyState,
      getEffectiveHeadingModeRevision: () => sources.getEffectiveHeadingModeRevision?.() ?? 0,
      vaultRoot: sources.vaultRoot,
      getCanonicalDuplicateIdentities: () => {
        const frame = sources.getCanonicalHeadingFrame()
        if (!frame) return []
        const seen = new Map<string, number>()
        const dupes: string[] = []
        for (const e of frame.entries) {
          if (!e.stableIdentity) continue
          const n = (seen.get(e.stableIdentity) ?? 0) + 1
          seen.set(e.stableIdentity, n)
          if (n === 2) dupes.push(e.stableIdentity)
        }
        return dupes
      },
      getCaptionDuplicateNames: () => {
        // Caption-name duplicates are detected structurally in the DOM facts
        // (same pure compute path); the caption authority here has no extra
        // aggregate surface. Return empty — the structural scan covers it.
        return []
      },
      // VNext §24 — the object auto-numbering activation authority (optional:
      // absent ⇒ the manual-number rules stay OFF).
      getObjectNumberingEnabled: sources.getObjectNumberingEnabled,
      // Numbering Integrity V2 §9 — the canonical effective-number fact provider.
      getObjectEffectiveNumberElementFacts: sources.getObjectEffectiveNumberElementFacts,
    },
    hasActiveDocument: () => sources.getActiveFilePath() != null,
  }

  const headingIdentityByElement = new WeakMap<HTMLElement, string>()
  const indexHeadingIdentities = (): void => {
    const frame = sources.getCanonicalHeadingFrame()
    if (!frame) return
    for (const e of frame.entries) {
      if (e.element && e.stableIdentity) headingIdentityByElement.set(e.element, e.stableIdentity)
    }
  }
  indexHeadingIdentities()

  const providers: DocumentDiagnosticsProviders = {
    getFormulaVisibleTagTokens: (host) => sources.getFormulaVisibleTagTokens(host) ?? extractFormulaVisibleTagTokens(host),
    // Phase 7R.3.11.8B.7.6 — every local-resource existence check resolves
    // against the ACTIVE DOCUMENT directory (dirname of the current markdown),
    // never the vault root. Dynamic per call so document switches stay correct.
    getFigureName: (img) => sources.getCaptionTitleForElement(img),
    getTableName: (el) => sources.getCaptionTitleForElement(el),
    getCodeName: (el) => sources.getCaptionTitleForElement(el),
    getCodeLanguage: (el) => sources.getCodeLanguage(el),
    resolveImageLocalPath: (img) => ({ localPath: imageLocalPath(img, resourceBaseDir(sources.getActiveFilePath(), sources.vaultRoot)) }),
    isLinkTargetMissing: (target) => linkTargetMissing(target, resourceBaseDir(sources.getActiveFilePath(), sources.vaultRoot)),
    getHeadingIdentity: (el) => headingIdentityByElement.get(el) ?? null,
    parseLocalLinkTargets,
    // V5.12-R8 §4 — EVERY image occurrence (full token range + destination
    // range), the single scanner authority for figure diagnostics.
    parseImageSourceOccurrences,
    // Phase 7R.3.11.8B.7.6 — compound locator caption host (optional).
    getObjectCaptionHost: sources.getObjectCaptionHost,
    // Phase G §8 — the DOM-side caption-integrity producer (optional).
    getCaptionIntegrityDiagnostics: sources.getCaptionIntegrityDiagnostics,
    // V5.14-R2 §P8 — heading diagnostics → LEFT OUTLINE projection publisher.
    publishOutlineHeadingDiagnostics: sources.publishOutlineHeadingDiagnostics,
    // Phase 7R.3.11.8B.1 — canonical H1 authority bridge: maps the REAL
    // CanonicalHeadingFrame (entry.semanticState.physicalLevel) into a
    // WAIT / INVALID / READY result. NEVER reads a fake top-level physicalLevel.
    getCanonicalH1Facts: () => mapCanonicalHeadingFrameForDiagnostics(
      sources.getCanonicalHeadingFrame(),
      sources.getDocumentKey(),
    ),
    // Heading Auto-Number Conflict V1 §2/§4 — the ONE per-heading heading
    // auto-numbering EFFECTIVENESS authority (owned by the numbering service).
    getHeadingAutoNumberingEffectiveFacts: sources.getHeadingAutoNumberingEffectiveFacts,
    // Heading Auto-Number Conflict V1.2 §21/§22 — the post-commit report sink.
    onHeadingConflictReportCapture: sources.onHeadingConflictReportCapture,
    // Heading Auto-Number Conflict V1.2 §21/§22 — the ONE recompute-time bridge
    // consumption point (driven by the toolbar 「重新检查文档」 button).
    consumeHeadingConflictTestBridge: sources.consumeHeadingConflictTestBridge,
  }

  // Phase 7R.3.11.8B.7.1 — settings/mode recompute is rAF-coalesced so one mode
  // transaction produces AT MOST ONE final recompute/publish.
  let settingsRecomputePending = false
  // Phase 7R.3.11.8B.7.7 — source-edit recompute is rAF-coalesced. The Markdown
  // SOURCE (markdownEditor 'edit') is the authority for document-level rules
  // (EOF trailing blank lines etc.) — EOF whitespace changes may not produce
  // any ordinary DOM block mutation, so we must not rely on the MutationObserver
  // alone to retire/add those diagnostics.
  let sourceRecomputePending = false

  const host = new DocumentUtilityOverlayHost({
    ctx,
    providers,
    onBindDocument: (bind) => {
      sources.onDocumentSwitch(() => {
        indexHeadingIdentities()
        bind()
      })
    },
    // V3 — real active-leaf lifecycle as PRIMARY triggers. Both the workspace
    // `active-leaf:change` event and the workspace-tabs `tab:toggle` event drive
    // the host's synchronous presence re-evaluation; the tab DOM MutationObserver
    // remains only a fallback trigger, never an identity authority.
    onActiveLeafLifecycle: (onTransition) => {
      const disposes: Array<() => void> = []
      const disposeChanged = sources.onActiveLeafChanged?.(() => onTransition('ACTIVE_LEAF_CHANGE'))
      if (disposeChanged) disposes.push(disposeChanged)
      const disposeToggle = sources.onTabToggle?.(() => onTransition('TAB_TOGGLE'))
      if (disposeToggle) disposes.push(disposeToggle)
      return () => { for (const d of disposes) d() }
    },
    emptyWorkspace: sources.emptyWorkspace,
    // Phase 7R.3.11.8-B — live diagnostics triggers (heading frame commit +
    // settings/mode change) → lightweight snapshot recompute only.
    onDiagnosticsTrigger: (recompute) => {
      sources.onCanonicalFrameCommit?.(() => {
        indexHeadingIdentities()
        recompute('CANONICAL_FRAME_CHANGED')
      })
      sources.onSettingsChanged?.(() => {
        if (settingsRecomputePending) return
        settingsRecomputePending = true
        requestAnimationFrame(() => {
          settingsRecomputePending = false
          recompute('HEADING_STRUCTURE_MODE_CHANGED')
        })
      })
      // Phase 7R.3.11.8B.7.7 — Markdown SOURCE change is the live-reconcile
      // authority for document-level diagnostics (EOF blank lines). Recompute
      // is pure + fingerprint-gated, so identical state never re-publishes and
      // a real 0→1 / 1→2 / 2→1 / 1→0 transition auto ADD/REMOVE the warning.
      sources.onSourceEdit?.(() => {
        if (sourceRecomputePending) return
        sourceRecomputePending = true
        requestAnimationFrame(() => {
          sourceRecomputePending = false
          recompute('DOCUMENT_SOURCE_CHANGED')
        })
      })
    },
  })

  return {
    host,
    mount: () => host.mount(),
    dispose: () => host.dispose(),
    // Phase 7R.3.11.8B.7.1 — latest PUBLISHED diagnostic snapshot (read-only,
    // consumed by the control-surface invariant).
    getSnapshot: () => host.getSnapshot(),
  }
}
