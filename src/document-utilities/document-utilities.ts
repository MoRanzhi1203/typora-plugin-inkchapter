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
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import { mapCanonicalHeadingFrameForDiagnostics } from './document-h1-authority-bridge'

export interface DocumentUtilitiesSources {
  getActiveFilePath: () => string | null
  getDocumentKey: () => string | null
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
  /** Phase 7R.3.11.8B.7.6 — rendered caption host for an object element
   *  (compound missing-name locator). Optional. */
  getObjectCaptionHost?: (el: HTMLElement) => HTMLElement | null
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

/**
 * Phase 7R.3.11.8B.7.3 — local resource reference fact.
 * `resourceKind` distinguishes image Markdown (`![..](dest)`, rendered as an
 * `<img>` block) from plain links (`[..](dest)`, rendered as an `<a>`).
 */
export interface LocalResourceReference {
  target: string
  resourceKind?: 'image' | 'link'
}

/**
 * Safe local-relative resource parsing from Markdown (no network).
 * Every occurrence of a local destination is returned in document order;
 * identical destinations appear once per occurrence.
 */
export function parseLocalLinkTargets(markdown: string): Array<string | LocalResourceReference> {
  const out: Array<string | LocalResourceReference> = []
  const re = /(!?)\[([^\]]*)\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const target = m[3].trim().split(/\s+/)[0]
    if (!target) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue // scheme
    if (target.startsWith('#')) continue // in-document anchor
    if (target.startsWith('mailto:')) continue
    const isImage = m[1] === '!'
    if (isImage) out.push({ target, resourceKind: 'image' })
    else out.push({ target, resourceKind: 'link' })
  }
  return out
}

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
    // Phase 7R.3.11.8B.7.6 — compound locator caption host (optional).
    getObjectCaptionHost: sources.getObjectCaptionHost,
    // Phase 7R.3.11.8B.1 — canonical H1 authority bridge: maps the REAL
    // CanonicalHeadingFrame (entry.semanticState.physicalLevel) into a
    // WAIT / INVALID / READY result. NEVER reads a fake top-level physicalLevel.
    getCanonicalH1Facts: () => mapCanonicalHeadingFrameForDiagnostics(
      sources.getCanonicalHeadingFrame(),
      sources.getDocumentKey(),
    ),
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
