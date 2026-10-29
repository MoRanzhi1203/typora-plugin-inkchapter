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
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import type { DocumentUtilitiesContext, StructuralMarkdownSnapshot } from './document-utilities-context'
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
    /** 配置：空工作区双击新建是否启用（缺省 = 启用）。 */
    isEnabled?: () => boolean
    resolveEmptySurface?(): import('./document-empty-workspace-controller').EmptyWorkspaceSurfaceFacts | null
  }
  getMarkdown: () => string | null
  /**
   * R10 Closure §2.2 — the ONE structural markdown snapshot per diagnostics
   * transaction. Forwarded VERBATIM into the diagnostics authority (the host
   * transaction builder calls it exactly once per reconcile). Absent only for
   * legacy/pure consumers.
   */
  getStructuralMarkdown?: () => StructuralMarkdownSnapshot
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
  onCanonicalFrameCommit?: (cb: (frame?: CanonicalFrameSignal) => void) => () => void
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

/**
 * PA-16 — the SEMANTIC identity of a committed canonical heading frame.
 *
 * A frame commit also fires for presentation-only reasons (caret move, focus,
 * re-bind, scroll). Diagnostics must be able to tell those apart from a real
 * heading change WITHOUT consulting the incremental markdown mirror:
 * `semanticFingerprint` is produced by the canonical heading authority itself.
 */
export interface CanonicalFrameSignal {
  documentKey?: string
  semanticRevision?: number
  semanticFingerprint?: string
}

/**
 * PA-16 — whether a frame commit must start a FULL diagnostics transaction.
 *
 * Rules (monotonic, never "assume unchanged"):
 * - no frame / no documentKey / no semanticFingerprint ⇒ RUN (no evidence);
 * - same document AND same semantic fingerprint ⇒ SKIP (presentation-only);
 * - anything else ⇒ RUN.
 */
export function shouldRunDiagnosticsForFrame(
  frame: CanonicalFrameSignal | undefined,
  last: { documentKey: string | null; semanticFingerprint: string | null },
): boolean {
  const key = frame?.documentKey ?? null
  const fingerprint = frame?.semanticFingerprint ?? null
  // An EMPTY fingerprint is not evidence: the authority emits '' before it has
  // real heading data, and two empties must never be treated as "unchanged".
  if (key === null || key === '' || fingerprint === null || fingerprint === '') return true
  return !(key === last.documentKey && fingerprint === last.semanticFingerprint)
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

/**
 * PERFORMANCE — local resource existence cache.
 *
 * Applies to the diagnostics recompute path only (image / link targets). That
 * recompute runs on every editor mutation, so this used to issue one
 * synchronous `fs.existsSync` per resource per keystroke — a blocking disk stat
 * on the renderer thread (worst on Windows / network drives).
 *
 * Results are cached by resolved absolute path for a short TTL: one typing
 * burst never stats the same path twice, while a created/deleted asset is still
 * observed within the freshness window.
 */
const RESOURCE_EXISTENCE_TTL_MS = 2000
const RESOURCE_EXISTENCE_CACHE_MAX_ENTRIES = 2000
const resourceExistenceCache = new Map<string, { exists: boolean; checkedAt: number }>()

function cachedPathExists(absolutePath: string): boolean {
  const now = Date.now()
  const hit = resourceExistenceCache.get(absolutePath)
  if (hit && now - hit.checkedAt < RESOURCE_EXISTENCE_TTL_MS) return hit.exists
  let exists = false
  try {
    exists = fs.existsSync(absolutePath)
  } catch {
    exists = false
  }
  if (resourceExistenceCache.size >= RESOURCE_EXISTENCE_CACHE_MAX_ENTRIES) {
    resourceExistenceCache.clear()
  }
  resourceExistenceCache.set(absolutePath, { exists, checkedAt: now })
  return exists
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
    return cachedPathExists(candidate) ? null : candidate
  } catch {
    return null
  }
}

function linkTargetMissing(target: string, baseDir: string | null): boolean {
  if (!isLocalRelative(target) || !baseDir) return false
  try {
    const resolved = path.resolve(baseDir, target)
    return !cachedPathExists(resolved)
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
      getStructuralMarkdown: sources.getStructuralMarkdown,
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

  // TRAE §1.3/§4.3 — ONE rAF-coalescing scheduler for the ASYNC diagnostics
  // triggers (source edit + settings/mode change). They used to hold SEPARATE rAF
  // flags and never merged, so a single user action that both edited the source
  // and flipped a setting ran TWO recomputes of the SAME semantic state (the
  // duplicated `DOCUMENT-TRAILING-BLANK-AUDIT` / `ACTIVE_DOCUMENT_RECONCILE`
  // storm). Now a frame runs exactly ONE recompute with the MERGED reason; the
  // producer fingerprint still dedupes a genuinely unchanged state.
  const pendingRecomputeReasons = new Set<string>()
  let recomputeRafPending = false
  /** PA-16 — semantic identity of the LAST full diagnostics transaction. */
  let lastDiagnosticFrameKey: string | null = null
  let lastDiagnosticSemanticFingerprint: string | null = null

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
      // TRAE §1.3/§4.3 — the ONE coalescing scheduler (see the state above).
      const scheduleRecompute = (reason: string): void => {
        pendingRecomputeReasons.add(reason)
        if (recomputeRafPending) return
        recomputeRafPending = true
        requestAnimationFrame(() => {
          recomputeRafPending = false
          const merged = Array.from(pendingRecomputeReasons).join('+')
          pendingRecomputeReasons.clear()
          recompute(merged || reason)
        })
      }
      sources.onCanonicalFrameCommit?.((frame) => {
        indexHeadingIdentities()
        const frameKey = frame?.documentKey ?? null
        const frameFingerprint = frame?.semanticFingerprint ?? null
        // PA-16 — SAME document + SAME semantic fingerprint as the last full
        // transaction ⇒ this commit is presentation-only (caret/focus/re-bind),
        // so the structural diagnostics pass is skipped. Real edits still reach
        // diagnostics through DOCUMENT_MUTATION / DOCUMENT_SOURCE_CHANGED, and
        // the first frame of every document always runs.
        if (!shouldRunDiagnosticsForFrame(frame, {
          documentKey: lastDiagnosticFrameKey,
          semanticFingerprint: lastDiagnosticSemanticFingerprint,
        })) {
          emitRuntimeAudit('DOCUMENT-DIAGNOSTIC-FRAME-SKIPPED', {
            documentKey: frameKey,
            semanticRevision: frame?.semanticRevision ?? null,
            semanticFingerprint: frameFingerprint,
            reason: 'SEMANTICALLY_UNCHANGED_FRAME',
            decision: 'SKIPPED',
          })
          return
        }
        lastDiagnosticFrameKey = frameKey
        lastDiagnosticSemanticFingerprint = frameFingerprint
        recompute('CANONICAL_FRAME_CHANGED')
      })
      sources.onSettingsChanged?.(() => {
        scheduleRecompute('HEADING_STRUCTURE_MODE_CHANGED')
      })
      // Phase 7R.3.11.8B.7.7 — Markdown SOURCE change is the live-reconcile
      // authority for document-level diagnostics (EOF blank lines). Recompute
      // is pure + fingerprint-gated, so identical state never re-publishes and
      // a real 0→1 / 1→2 / 2→1 / 1→0 transition auto ADD/REMOVE the warning.
      sources.onSourceEdit?.(() => {
        scheduleRecompute('DOCUMENT_SOURCE_CHANGED')
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
