/**
 * Phase 7R.3.11 — Document Diagnostics: pure compute + deduplication.
 *
 * Authority-driven only. Consumes existing canonical facts (strict document
 * validator, canonical heading frame, caption records, formula projection
 * output) and NEVER rebuilds heading numbering / object scope semantics.
 * No timers, no polling — the caller decides WHEN to compute.
 */
import { validateStrictFirstH1Topline } from '../heading-numbering/strict-document-validator'
import { normalizeResourcePath } from './document-diagnostic-location'
import type {
  DiagnosticLocation,
  DiagnosticValidityFingerprint,
  DocumentDiagnostic,
  DocumentDiagnosticCategory,
  DocumentDiagnosticLocatorDescriptor,
  DocumentDiagnosticSeverity,
  DocumentDiagnosticsSnapshot,
  DocumentDiagnosticsState,
} from './diagnostics-types'

export interface DiagnosticHeadingFact {
  level: number
  text: string
  stableIdentity?: string
  element: HTMLElement | null
}

/**
 * Phase 7R.3.11.8-B — canonical H1 fact (from the committed CanonicalHeadingFrame
 * semanticState.physicalLevel === 1). NEVER derived from a bare DOM h1 count.
 */
export interface DiagnosticH1Fact {
  stableIdentity?: string
  element: HTMLElement | null
  text?: string
}

export interface DiagnosticObjectFact {
  name: string | null
  /** For figures: resolved local path (null when remote/untracked). */
  localPath?: string | null
  /** For code: fence language. */
  language?: string | null
  element: HTMLElement | null
  targetIdentity?: string
}

export interface DiagnosticFormulaFact {
  /** Visible tag tokens extracted by the existing projection authority (read-only). */
  visibleTagTokens: string[]
  element: HTMLElement | null
  targetIdentity?: string
}

export interface DiagnosticLinkFact {
  target: string
  element: HTMLElement | null
  /**
   * Phase 7R.3.11.8B.7.3 — occurrence ordinal of this destination among ALL
   * local references in the document (0-based). Same destination twice →
   * two diagnostics, each locatable to its own occurrence.
   */
  index: number
  /**
   * Phase 7R.3.11.8B.7.3 — 'image' when the Markdown reference is an image
   * (`![..](..)`), 'link' for plain links. The DOM target differs (img vs a).
   */
  resourceKind?: 'image' | 'link'
  /**
   * Phase 7R.3.11.8B.7.3 — stable per-occurrence locator identity
   * (e.g. `local:phase6-test.png:1`); also used as the block-node stableIdentity.
   */
  targetIdentity?: string
  /**
   * Phase 7R.3.11.8B.7.4 — Semantic Resource Identity: the vault-relative
   * canonical (decoded) path of the resource, resolved against the DOCUMENT
   * base directory. Raw `target` (Source Token Identity) stays untouched —
   * validity compares tokens; DOM resolution compares this semantic identity.
   */
  semanticDestination?: string
}

/**
 * Phase 7R.3.11.8B.4 — Heading Diagnostics Authority invariant.
 *
 * Only a READY canonical frame may drive heading structure diagnostics. When
 * the diagnostic heading sequence deviates from the canonical sequence
 * (count mismatch / non-canonical entries included / canonical entries
 * missing) the decision is FAIL and the structure rules (gap / empty heading /
 * duplicate text) must NOT publish from the polluted sequence.
 */
export type HeadingDiagnosticAuthorityDecision = 'PASS' | 'FAIL' | 'NOT_EVALUATED'

export interface HeadingDiagnosticAuthority {
  canonicalHeadingCount: number
  diagnosticHeadingCount: number
  canonicalStableIdentities: readonly string[]
  diagnosticStableIdentities: readonly string[]
  nonCanonicalIncludedCount: number
  missingCanonicalCount: number
  decision: HeadingDiagnosticAuthorityDecision
  reason?: string
}

/**
 * Phase 7R.3.11.8B.4.1 — latent ATX heading marker fact (Source Syntax
 * Diagnostics). Pure source-syntax input; NEVER structural.
 */
export interface LatentAtxMarkerInput {
  /** 0-based source line index. */
  line: number
  /** 0-based source column of the marker start. */
  column?: number
  markerLevel: number
  markerText: string
  text: string
  /**
   * Scan-time raw text of the source line (as captured from the Markdown at
   * scan time). The locate resolver uses it to verify the DOM block and to
   * re-anchor by text context (source-only diagnostics have no Heading DOM).
   */
  rawText?: string
}

/**
 * Phase 7R.3.11.8B.4 — Document Diagnostic Severity Policy (single authority).
 *
 * ALL diagnostics severities flow through this entry point. Mode-dependent
 * rules (HEADING_LEVEL_GAP / HEADING_EMPTY_TEXT) resolve by strict/loose;
 * constant rules keep their fixed matrix value from Phase 7R.3.11.8-B.
 */
export function resolveDocumentDiagnosticSeverity(
  code: string,
  strictMode: boolean,
): DocumentDiagnosticSeverity {
  switch (code) {
    // ── Strict vs Loose mode-dependent rules ──
    case 'HEADING_LEVEL_GAP':
      return strictMode ? 'error' : 'warning'
    case 'HEADING_EMPTY_TEXT':
      return strictMode ? 'error' : 'warning'
    // ── Constant ERROR rules ──
    case 'STRICT_SINGLE_H1_NO_H1':
    case 'STRICT_SINGLE_H1_MULTIPLE_H1':
    case 'FIGURE_LOCAL_IMAGE_MISSING':
    case 'FORMULA_DUPLICATE_VISIBLE_TAG':
    case 'HEADING_DUPLICATE_IDENTITY':
      return 'error'
    // ── Constant INFO rules ──
    case 'DOCUMENT_EMPTY':
    case 'DOCUMENT_INACTIVE':
    case 'DOCUMENT_SOURCE_UNAVAILABLE':
      return 'info'
    default:
      // Phase 7R.3.11.8B.4.1 — latent source syntax risk: strict=WARNING,
      // loose=HINT ('info'). Codes are level-suffixed
      // (LATENT_ATX_HEADING_MARKER_LEVEL_2), so match the ruleId prefix.
      // NEVER error — a latent marker is not a current structure defect.
      if (code.startsWith('LATENT_ATX_HEADING_MARKER')) return strictMode ? 'warning' : 'info'
      // Phase 7R.3.11.8B.5 — STRICT_FIRST_H1 severity is WARNING (positional
      // naming/format lint, not a structural break).
      return 'warning'
  }
}

export interface DocumentDiagnosticsInput {
  documentKey: string | null
  markdown: string | null
  strictMode: boolean
  /**
   * Phase 7R.3.11.8B.9 — CONDITIONAL strict-policy activation.
   * strict-policy rules (must-exist-H1 / exactly-one-H1 / start-with-H1 /
   * no-pre-H1-body) run ONLY when this is true. Absent (pure/legacy callers)
   * falls back to the legacy `strictMode` boolean so existing tests keep their
   * semantics; the runtime authority always supplies the real three-state gate.
   */
  strictPolicyActive?: boolean
  /** Phase 7R.3.11.8B.9 — heading-numbering feature master switch (audit). */
  headingPolicyEnabled?: boolean
  /** Phase 7R.3.11.8B.9 — explicit user heading-policy configuration (audit). */
  headingPolicyConfigured?: boolean
  vaultRoot: string | null
  headings: readonly DiagnosticHeadingFact[]
  /**
   * Phase 7R.3.11.8-B — canonical H1 facts from the committed heading frame.
   * `null`/absent = heading authority not ready (STRICT-SINGLE-H1 WAITS, never
   * judged against a stale/empty frame); `[]` = committed frame with ZERO H1.
   */
  h1Facts?: readonly DiagnosticH1Fact[] | null
  /**
   * Phase 7R.3.11.8B.4 — canonical heading authority invariant. Absent = pure
   * compute callers feed the sequence directly (structure rules allowed).
   * decision=FAIL blocks structure rules derived from the polluted sequence.
   */
  headingAuthority?: HeadingDiagnosticAuthority
  /**
   * Phase 7R.3.11.8B.4.1 — Source Syntax Diagnostics input. Latent ATX heading
   * markers are STRICTLY isolated from structural diagnostics: they never
   * affect h1Count / gap / boundaries / outline / caption / formula scope.
   */
  latentAtxMarkers?: readonly LatentAtxMarkerInput[]
  figures: readonly DiagnosticObjectFact[]
  tables: readonly DiagnosticObjectFact[]
  codes: readonly DiagnosticObjectFact[]
  formulas: readonly DiagnosticFormulaFact[]
  links: readonly DiagnosticLinkFact[]
  canonicalDuplicateIdentities: readonly string[]
  captionDuplicateNames: readonly string[]
}

export interface DocumentDiagnosticsComputed {
  diagnostics: DocumentDiagnostic[]
  errorCount: number
  warningCount: number
  infoCount: number
}

const DOCUMENT_EMPTY_CODE = 'DOCUMENT_EMPTY'
const SOURCE_UNAVAILABLE_CODE = 'DOCUMENT_SOURCE_UNAVAILABLE'

// ── Standard EOF newline policy (Phase 7R.3.11.8B.8) ────────────────────
// Supersedes the "exactly one trailing blank line" rule (7R.3.11.8B.7.x).
// The EOF contract is a FILE-level newline rule over the serialized Markdown
// SOURCE (markdownEditor.getMarkdown()). A "visual empty paragraph" in the
// Live editor is an UI state, never a file-standard condition — EOF detection
// therefore NEVER reads the Live DOM and NEVER uses Source+DOM max(...).
//
// Two quantities are deliberately split:
//   hasTerminalNewline         — does the file end with a line break?
//   extraTrailingBlankLineCount — how many whitespace-only LOGICAL lines sit
//                                AFTER the last content line (once the file is
//                                known to end with a terminal newline).
//
//   "" / whitespace-only       → SKIP (empty-document policy)
//   "a"                        → terminal newline missing        → MISSING
//   "a\n" / "a\r\n"            → terminal newline, 0 extra blank → PASS
//   "a\n\n" / "a\r\n\r\n"      → terminal newline, 1 extra blank → PASS
//   "a\n\n\n" / "a\r\n\r\n\r\n"→ terminal newline, 2 extra blank→ EXCESSIVE
//
// A blank line is a whitespace-only LOGICAL line ("" / "   " / "\t" / " \t ")
// AFTER the last non-empty logical line. Trailing spaces on a CONTENT line
// never count as a blank line. Interior blank lines never count.
export type EofNewlineVerdict =
  | 'MISSING_TERMINAL_NEWLINE'
  | 'PASS'
  | 'EXCESSIVE_TRAILING_BLANK_LINES'
  | 'SKIP'

export interface EofNewlinePolicyResult {
  verdict: EofNewlineVerdict
  hasTerminalNewline: boolean
  /** Terminal line-break count at the very end (LF-normalized, informational). */
  terminalNewlineCount: number
  /** Whitespace-only logical lines after the last content line (file-level). */
  extraTrailingBlankLineCount: number
}

export function computeEofNewlinePolicy(markdown: string | null | undefined): EofNewlinePolicyResult {
  if (markdown == null || markdown.replace(/\r/g, '').trim() === '') {
    return { verdict: 'SKIP', hasTerminalNewline: false, terminalNewlineCount: 0, extraTrailingBlankLineCount: 0 }
  }
  // Universal line splitting (LF / CRLF / bare CR). When the source ends with a
  // line break the split produces a final '' element — that marker is the
  // terminal newline, NOT an extra blank line.
  const lines = markdown.split(/\r\n|\r|\n/)
  const hasTerminalNewline = markdown.endsWith('\n') || markdown.endsWith('\r')
  const lastIndex = hasTerminalNewline ? lines.length - 2 : lines.length - 1
  let lastNonBlank = -1
  for (let i = 0; i <= lastIndex; i++) {
    if (lines[i].trim() !== '') lastNonBlank = i
  }
  if (lastNonBlank === -1) {
    return { verdict: 'SKIP', hasTerminalNewline, terminalNewlineCount: 0, extraTrailingBlankLineCount: 0 }
  }
  const extraTrailingBlankLineCount = lastIndex - lastNonBlank
  const lfOnly = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const terminalMatch = lfOnly.match(/\n+$/)
  const terminalNewlineCount = terminalMatch ? terminalMatch[0].length : 0
  if (!hasTerminalNewline) {
    return { verdict: 'MISSING_TERMINAL_NEWLINE', hasTerminalNewline, terminalNewlineCount, extraTrailingBlankLineCount }
  }
  if (extraTrailingBlankLineCount >= 2) {
    return { verdict: 'EXCESSIVE_TRAILING_BLANK_LINES', hasTerminalNewline, terminalNewlineCount, extraTrailingBlankLineCount }
  }
  return { verdict: 'PASS', hasTerminalNewline, terminalNewlineCount, extraTrailingBlankLineCount }
}

/** Normalize a message so the same root cause deduplicates deterministically. */
function normalizeIdentity(value: string | undefined | null): string {
  return (value ?? '').trim()
}

/**
 * Deduplicate diagnostics: one stable item per (category + code + targetIdentity).
 * The first occurrence wins; identical duplicates are dropped.
 */
export function deduplicateDiagnostics(
  diagnostics: readonly DocumentDiagnostic[],
): DocumentDiagnostic[] {
  const seen = new Set<string>()
  const out: DocumentDiagnostic[] = []
  for (const d of diagnostics) {
    const key = `${d.category}\u0000${d.code}\u0000${normalizeIdentity(d.targetIdentity)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(d)
  }
  return out
}

function makeDiagnostic(
  input: DocumentDiagnosticsInput,
  category: DocumentDiagnosticCategory,
  code: string,
  message: string,
  opts: {
    detail?: string
    stableIdentity?: string
    targetIdentity?: string
    element?: HTMLElement | null
    kind?: 'heading' | 'object' | 'formula' | 'link' | 'document'
    metadata?: Record<string, unknown>
    /** Phase 7R.3.11.8-B — explicit locator (element OR document-level scroll action). */
    locator?: DocumentDiagnosticLocatorDescriptor
    /**
     * Phase 7R.3.11.8B.5 — Universal Location. Every published diagnostic MUST
     * carry a non-null `location` (PUBLISHED = LOCATABLE). When absent, a
     * best-effort derivation runs (see deriveDefaultLocation) so the location
     * contract audit stays enforceable in production AND in pure tests.
     */
    location?: DiagnosticLocation
    /**
     * Phase 7R.3.11.8B.7.3 — scan-time source validity fingerprint
     * (VALIDITY ≠ DOM RESOLUTION). Carried by source-syntax / resource rules.
     */
    validityFingerprint?: DiagnosticValidityFingerprint
  } = {},
): DocumentDiagnostic {
  // Phase 7R.3.11.8B.4 — severity ALWAYS comes from the single policy entry.
  const severity = resolveDocumentDiagnosticSeverity(code, input.strictMode)
  const targetIdentity = normalizeIdentity(opts.targetIdentity) || normalizeIdentity(opts.stableIdentity)
  const locator = opts.locator ?? (opts.element
    ? { kind: opts.kind ?? category === 'heading' ? 'heading' : 'object', targetElement: opts.element }
    : undefined)
  return {
    id: `${category}:${code}:${targetIdentity || Math.random().toString(36).slice(2, 8)}`,
    documentKey: input.documentKey ?? '',
    severity,
    category,
    code,
    message,
    detail: opts.detail,
    stableIdentity: opts.stableIdentity,
    targetIdentity: targetIdentity || undefined,
    metadata: opts.metadata,
    validityFingerprint: opts.validityFingerprint,
    locator,
    location: opts.location ?? deriveDefaultLocation(category, opts),
  }
}

/**
 * Phase 7R.3.11.8B.5 — best-effort location derivation when a producer does not
 * pass an explicit `location`. NEVER holds a long-lived element: canonical-node
 * from stableIdentity, source-range from Typora `data-line`, block-node from
 * targetIdentity, document boundary for document-level rules.
 */
function deriveDefaultLocation(
  category: DocumentDiagnosticCategory,
  opts: {
    stableIdentity?: string
    targetIdentity?: string
    element?: HTMLElement | null
    kind?: 'heading' | 'object' | 'formula' | 'link' | 'document'
  },
): DiagnosticLocation | undefined {
  if (opts.kind === 'heading') {
    if (opts.stableIdentity) return { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: opts.stableIdentity }
    const line = opts.element?.getAttribute?.('data-line')
    if (line != null && line !== '') {
      const n = Number.parseInt(line, 10)
      if (Number.isFinite(n)) return { kind: 'source-range', startLine: n, startColumn: 0 }
    }
    return { kind: 'document-start' }
  }
  if (opts.kind === 'object' || opts.kind === 'formula' || opts.kind === 'link') {
    if (opts.targetIdentity) {
      const blockKind = category === 'figure' ? 'figure'
        : category === 'table' ? 'table'
          : category === 'code' ? 'code'
            : category === 'formula' ? 'formula'
              : 'link'
      return { kind: 'block-node', blockKind, stableIdentity: opts.targetIdentity }
    }
    const line = opts.element?.getAttribute?.('data-line')
    if (line != null && line !== '') {
      const n = Number.parseInt(line, 10)
      if (Number.isFinite(n)) return { kind: 'source-range', startLine: n, startColumn: 0 }
    }
    return { kind: 'document-start' }
  }
  return { kind: 'document-start' }
}

/** Count duplicate text names (case-insensitive, trimmed, non-empty). */
function duplicateNames(names: readonly (string | null | undefined)[]): string[] {
  const seen = new Map<string, number>()
  const dupes: string[] = []
  for (const raw of names) {
    const name = (raw ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n === 2) dupes.push(name)
  }
  return dupes
}

/**
 * Phase 7R.3.11.8B.5 — build MULTI-TARGET block-node locations for duplicate
 * object names: the FIRST occurrence is the baseline, the 2nd..Nth are the
 * offending targets (block ordinal identity from the authority).
 */
function duplicateOccurrenceTargets(
  items: ReadonlyArray<{ name?: string | null; targetIdentity?: string; index: number }>,
  blockKind: 'figure' | 'table' | 'code',
  duplicateName: string,
): DiagnosticLocation[] {
  const targets: DiagnosticLocation[] = []
  let first = false
  for (const it of items) {
    if ((it.name ?? '').trim().toLowerCase() !== duplicateName.toLowerCase()) continue
    if (!first) { first = true; continue }
    targets.push({
      kind: 'block-node',
      blockKind,
      stableIdentity: it.targetIdentity ?? `block:${blockKind}:${it.index}`,
    })
  }
  return targets
}

/** True when the path is a safe-to-check local relative path (no scheme). */
function isLocalRelativePath(target: string): boolean {
  if (!target) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false // scheme (http:, file:, data:, ...)
  if (target.startsWith('#') || target.startsWith('mailto:')) return false
  return true
}

/**
 * Phase 7R.3.11.8B.7.3 — derive the vault-relative destination from a Typora
 * DOM image src (file:// / absolute / relative). Returns null when the src
 * cannot be reduced to a vault-relative identity.
 */
export function resourceSrcToVaultRelative(src: string, vaultRoot: string | null): string | null {
  if (!src) return null
  if (/^https?:\/\//i.test(src)) return null
  let value = src
  if (/^file:\/\//i.test(value)) value = value.slice('file://'.length).replace(/^\/+/, '')
  try { value = decodeURIComponent(value) } catch { /* keep raw */ }
  value = value.replace(/\\/g, '/')
  while (value.startsWith('./')) value = value.slice(2)
  if (vaultRoot) {
    const root = vaultRoot.replace(/\\/g, '/').replace(/\/+$/, '')
    const rootNorm = root.replace(/^([a-z]):/i, (_m, d: string) => `${d.toUpperCase()}:`)
    value = value.replace(/^([a-z]):/i, (_m, d: string) => `${d.toUpperCase()}:`)
    const prefix = rootNorm.endsWith('/') ? rootNorm : `${rootNorm}/`
    if (value.startsWith(prefix)) return value.slice(prefix.length)
    return null
  }
  return value === '' ? null : value
}

/**
 * Phase 7R.3.11.8B.7.4 — resolve a Markdown resource token to its Semantic
 * Resource Identity. The token is resolved PHYSICALLY against the active
 * document directory (absolute path), then reduced to the vault-relative form
 * when it stays inside the vault — or kept absolute when it escapes the vault
 * (e.g. `../../../Downloads/...`). This is the ONE comparison space shared
 * with the DOM side (`normalizeDomSrcToVaultRelative`). Pure lexical work —
 * never touches the filesystem.
 */
export function resolveResourceSemanticPath(
  rawToken: string,
  activeFilePath: string | null,
  vaultRoot: string | null,
): string {
  const token = (rawToken ?? '').trim()
  if (activeFilePath == null || /^[a-z][a-z0-9+.-]*:/i.test(token) && !/^file:\/\//i.test(token)) {
    return normalizeResourceToken(token)
  }
  const dir = (activeFilePath.replace(/\\/g, '/').replace(/[\\/][^\\/]*$/, '')).replace(/\/+$/, '')
  const joined = `${dir}/${token}`
  const physical = normalizeResourceToken(joined)
  if (vaultRoot) {
    const rootN = normalizeResourceToken(vaultRoot)
    if (physical === rootN) return '.'
    const prefix = rootN.endsWith('/') ? rootN : `${rootN}/`
    if (physical.startsWith(prefix)) return physical.slice(prefix.length)
  }
  // Escapes the vault (or no vault root) — the absolute form IS the identity.
  return physical
}

/**
 * Phase 7R.3.11.8B.7.4 — source-token canonical form (single authority:
 * `normalizeResourcePath` in document-diagnostic-location). Decodes bounded,
 * never resolves a base directory — two Markdown spellings of one resource
 * (`a%20b.png` vs `a b.png`) collapse; different resources never do.
 */
export function normalizeResourceToken(raw: string | null | undefined): string {
  return normalizeResourcePath(raw)
}

/**
 * Phase 7R.3.11.8B.7.4 — vault-relative directory of the active document
 * (e.g. "fixtures/figure" for ".../vault/fixtures/figure/x.md"). Null when the
 * document lives outside the vault.
 */
export function resourceDirVaultRelative(activeFilePath: string, vaultRoot: string): string | null {
  const dir = activeFilePath.replace(/[\\/][^\\/]*$/, '')
  const root = vaultRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const dirNorm = dir.replace(/\\/g, '/').replace(/\/+$/, '')
  if (dirNorm === root) return ''
  const prefix = root.endsWith('/') ? root : `${root}/`
  if (dirNorm.startsWith(prefix)) return dirNorm.slice(prefix.length)
  return null
}

/**
 * Phase 7R.3.11.8B.7.3 — occurrence ordinal (0-based) of `factIndex` within the
 * facts whose destination equals `target`. Occurrence-aware identity for
 * diagnostics AND for the locator's resource semantic resolution.
 */
/**
 * Phase 7R.3.11.8B.7.3 — occurrence ordinal (0-based) of `factIndex` within the
 * facts whose destination equals `target`. Occurrence-aware identity for
 * diagnostics AND for the locator's resource semantic resolution.
 */
export function linkOccurrenceIndex(
  links: readonly { target: string }[],
  target: string,
  factIndex: number,
): number {
  let occurrence = 0
  for (let i = 0; i < factIndex && i < links.length; i++) {
    if (links[i].target === target) occurrence++
  }
  return occurrence
}

/**
 * Phase 7R.3.11.8B.7.4 — occurrence ordinal (0-based) of a figure among the
 * figures sharing the SAME semantic destination (identity-key separation —
 * the ordinal NEVER merges into the destination path).
 */
export function figureDestinationOccurrenceIndex(
  figures: readonly { element: HTMLElement | null; localPath?: string | null }[],
  fact: { element: HTMLElement | null; localPath?: string | null },
  destRel: string | undefined | null,
  vaultRoot: string | null,
): number {
  if (!destRel) return 0
  let occurrence = 0
  for (const f of figures) {
    if (f === fact) break
    const src = f.element?.getAttribute?.('src') ?? ''
    const otherRel = resourceSrcToVaultRelative(src, vaultRoot) ?? (f.localPath || null)
    if (otherRel === destRel) occurrence++
  }
  return occurrence
}

/**
 * Compute the full diagnostics list from existing authority facts.
 *
 * Pure and synchronous — the production authority calls this on relevant
 * document/authority change events (never on a timer).
 */
export function computeDocumentDiagnostics(
  input: DocumentDiagnosticsInput,
): DocumentDiagnosticsComputed {
  const diagnostics: DocumentDiagnostic[] = []
  const errors: DocumentDiagnostic[] = []
  const warnings: DocumentDiagnostic[] = []
  const infos: DocumentDiagnostic[] = []

  const push = (d: DocumentDiagnostic) => {
    diagnostics.push(d)
    if (d.severity === 'error') errors.push(d)
    else if (d.severity === 'warning') warnings.push(d)
    else infos.push(d)
  }

  // Phase 7R.3.11.8B.9 — CONDITIONAL strict-policy activation. The four
  // strict-policy rules (must-exist-H1 / exactly-one-H1 / start-with-H1 /
  // no-pre-H1-body) are gated on this flag alone. The runtime authority feeds
  // the real three-state gate (feature enabled && explicitly configured &&
  // effective mode strict); absent (pure/legacy callers) keeps strictMode.
  const strictPolicyActive = input.strictPolicyActive ?? input.strictMode

  // ── Document-level ──────────────────────────────────
  if (input.documentKey == null || (input.markdown == null && input.headings.length === 0)) {
    // No active business document: NOT a scary plugin error.
    push(
      makeDiagnostic(input, 'document', 'DOCUMENT_INACTIVE', '当前没有活动文档', {
        detail: '打开一个 Markdown 文档后即可检查其结构。',
      }),
    )
  } else {
    // Phase 7R.3.11.8B.10 — when the committed frame confirms ZERO H1, the
    // missing-H1 diagnostic is the SINGLE authoritative strict error; the
    // "must start with H1 / no pre-H1 body" lint is redundant for a headingless
    // document and must not double-report the same activation failure.
    const frameHasZeroH1 = input.h1Facts?.length === 0
    if (strictPolicyActive && !frameHasZeroH1) {
      const topline = validateStrictFirstH1Topline(input.markdown, 'strict')
      if (!topline.skipped && !topline.passed && topline.message) {
        // Phase 7R.3.11.8B.5 — locate the H1 ITSELF (canonical-node when the frame
        // provides a stable identity, source-range from data-line otherwise).
        const firstH1 = input.headings.find(h => h.level === 1)
        let firstH1Location: DiagnosticLocation = { kind: 'document-start' }
        if (firstH1?.stableIdentity) {
          firstH1Location = { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: firstH1.stableIdentity }
        } else if (firstH1?.element) {
          const fl = firstH1.element.getAttribute('data-line')
          if (fl != null && fl !== '') {
            firstH1Location = { kind: 'source-range', startLine: Number.parseInt(fl, 10), startColumn: 0 }
          }
        }
        push(
          makeDiagnostic(input, 'document', `STRICT_FIRST_H1_${topline.reason}`, topline.message, {
            detail: topline.documentStartState === 'DOCUMENT_EMPTY' ? '文档为空，无法满足严格模式首行 H1。' : undefined,
            kind: 'document',
            location: firstH1Location,
          }),
        )
      }
    }

    // ── Phase 7R.3.11.8-B — STRICT-SINGLE-H1 (strict policy active only,
    //    canonical frame authority). h1Facts === null means the heading frame
    //    is not committed yet → WAIT, never judge against a stale/empty frame;
    //    h1Facts === [] is a REAL zero-H1 doc.
    if (strictPolicyActive && input.h1Facts != null) {
      const h1Count = input.h1Facts.length
      if (h1Count === 0) {
        push(
          makeDiagnostic(input, 'document', 'STRICT_SINGLE_H1_NO_H1',
            '严格模式要求全文必须且只能包含一个一级标题（H1），当前未检测到 H1。', {
            detail: '文档必须且只能包含一个一级标题（H1）。',
            kind: 'document',
            targetIdentity: 'single-h1:no-h1',
            metadata: { ruleId: 'STRICT-SINGLE-H1', h1Count, reason: 'NO_H1', violationFingerprint: 'NO_H1' },
            locator: { kind: 'document', targetElement: null, action: 'GO_TOP' },
          }),
        )
      } else if (h1Count > 1) {
        const offending = input.h1Facts[1] // the FIRST offending H1 (second H1)
        const offendingIdentity = offending?.stableIdentity ?? null
        // Phase 7R.3.11.8B.5 — MULTI-TARGET: H1 #2..#N are the offending
        // targets; the FIRST H1 stays the baseline candidate. Each target is a
        // canonical-node (stableIdentity) with source-range fallback.
        const multiTargets: DiagnosticLocation[] = input.h1Facts.slice(1).map(f => {
          if (f.stableIdentity) return { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: f.stableIdentity }
          const line = f.element?.getAttribute?.('data-line')
          if (line != null && line !== '') return { kind: 'source-range', startLine: Number.parseInt(line, 10), startColumn: 0 }
          return { kind: 'document-start' }
        })
        push(
          makeDiagnostic(input, 'document', 'STRICT_SINGLE_H1_MULTIPLE_H1',
            `严格模式要求全文只能包含一个一级标题（H1），当前检测到 ${h1Count} 个。`, {
            detail: '请删除或降级多余的 H1，只保留一个一级标题。',
            kind: 'heading',
            stableIdentity: offendingIdentity ?? undefined,
            element: offending?.element ?? null,
            targetIdentity: `single-h1:multiple-h1:${offendingIdentity ?? ''}`,
            metadata: {
              ruleId: 'STRICT-SINGLE-H1',
              h1Count,
              reason: 'MULTIPLE_H1',
              violationFingerprint: `MULTIPLE_H1:${h1Count}:${offendingIdentity ?? ''}`,
            },
            locator: offending?.element
              ? { kind: 'heading', targetElement: offending.element }
              : { kind: 'document', targetElement: null, action: 'GO_TOP' },
            location: { kind: 'multi-target', targets: multiTargets },
          }),
        )
      }
    }

    // ── Phase 7R.3.11.8B.8 — Standard EOF newline policy (all modes, raw
    //    source authority). The file MUST end with a terminal newline; 0~1
    //    extra trailing blank lines are legal; >=2 extra blank lines warn.
    //    MISSING_TERMINAL_NEWLINE and EXCESSIVE are MUTUALLY EXCLUSIVE by
    //    construction (one policy verdict). Both anchor at document-end
    //    (GO_BOTTOM) — an EOF diagnostic never pretends to own a regular DOM
    //    block, so it can never hit SOURCE_LINE_NOT_FOUND/STALE.
    if (input.markdown != null) {
      const policy = computeEofNewlinePolicy(input.markdown)
      if (policy.verdict === 'MISSING_TERMINAL_NEWLINE') {
        push(
          makeDiagnostic(input, 'document', 'DOCUMENT_TERMINAL_NEWLINE_MISSING',
            '警告：文档末尾缺少换行符', {
            detail: 'Markdown 文档应以一个换行符结束。',
            kind: 'document',
            targetIdentity: 'document:terminal-newline-missing',
            metadata: {
              ruleId: 'DOCUMENT-TERMINAL-NEWLINE-MISSING',
              reason: 'MISSING_TERMINAL_NEWLINE',
              hasTerminalNewline: policy.hasTerminalNewline,
              extraTrailingBlankLineCount: policy.extraTrailingBlankLineCount,
            },
            locator: { kind: 'document', targetElement: null, action: 'GO_BOTTOM' },
            location: { kind: 'document-end' },
          }),
        )
      } else if (policy.verdict === 'EXCESSIVE_TRAILING_BLANK_LINES') {
        push(
          makeDiagnostic(input, 'document', 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE',
            '警告：文档末尾存在过多空行', {
            detail: 'Markdown 文档末尾存在多个连续空行，建议删除多余空行。',
            kind: 'document',
            targetIdentity: 'document:trailing-blank-lines-excessive',
            metadata: {
              ruleId: 'DOCUMENT-TRAILING-BLANK-LINES-EXCESSIVE',
              reason: 'EXCESSIVE_TRAILING_BLANK_LINES',
              hasTerminalNewline: policy.hasTerminalNewline,
              extraTrailingBlankLineCount: policy.extraTrailingBlankLineCount,
            },
            locator: { kind: 'document', targetElement: null, action: 'GO_BOTTOM' },
            location: { kind: 'document-end' },
          }),
        )
      }
    }

    // ── Phase 7R.3.11.8B.4.1 — LATENT-ATX-HEADING-MARKER (Source Syntax
    //    Diagnostics). Strictly isolated from structural diagnostics: these
    //    items NEVER affect h1Count / gap / boundary / outline / caption /
    //    formula scope. severity: strict=WARNING, loose=HINT('info').
    for (const latent of input.latentAtxMarkers ?? []) {
      const marker = latent.markerText || `#`.repeat(Math.max(1, latent.markerLevel))
      const levelLabel = `H${latent.markerLevel}`
      // Phase 7R.3.11.8B.5 — every LATENT item carries its OWN source-range
      // (line + column) so identical markers at different lines never collide.
      const line = latent.line
      const column = latent.column ?? 0
      const rawLineText = latent.rawText ?? marker
      push(
        makeDiagnostic(input, 'heading', `LATENT_ATX_HEADING_MARKER_LEVEL_${latent.markerLevel}`,
          `检测到未转义的潜在标题标记「${marker}」`, {
          detail: `当前该行尚未被 Typora 识别为标题，但后续重新解析时可能成为 ${levelLabel}。若希望始终作为普通文本，请使用 \\${marker}。`,
          kind: 'heading',
          targetIdentity: `latent-atx:line:${line}:${marker}`,
          metadata: {
            ruleId: 'LATENT-ATX-HEADING-MARKER',
            markerLevel: latent.markerLevel,
            markerText: marker,
            line,
            sourceRange: { line, column },
            fixable: true,
            fixKind: 'ESCAPE_HEADING_MARKER',
          },
          location: {
            kind: 'source-range',
            startLine: line,
            startColumn: column,
            sourceFingerprint: `latent:${line}:${marker}`,
            // Phase 7R.3.11.8B.7.2 — scan-time raw line text is the content
            // anchor: the resolver verifies the DOM block against it and
            // re-anchors by text context (no Heading DOM required).
            rawText: rawLineText,
          },
          // Phase 7R.3.11.8B.7.3 — VALIDITY fingerprint: this source line must
          // still carry the same text for the diagnostic to stay valid. UI /
          // outline / numbering mutations never touch it.
          validityFingerprint: {
            kind: 'source-text',
            line,
            text: rawLineText,
          },
        }),
      )
    }

    const isEmpty =
      input.markdown != null && input.markdown.trim() === '' && input.headings.length === 0
    if (isEmpty) {
      push(
        makeDiagnostic(input, 'document', DOCUMENT_EMPTY_CODE, '文档为空', {
          detail: '当前文档没有内容。',
          kind: 'document',
        }),
      )
    }
    if (input.markdown == null) {
      push(
        makeDiagnostic(input, 'document', SOURCE_UNAVAILABLE_CODE, '无法读取文档源码', {
          detail: '部分源码相关的检查将跳过。',
          kind: 'document',
        }),
      )
    }
  }

  // ── Heading diagnostics (from canonical frame facts, NOT re-derived numbering) ──
  // Multiple H1 in strict mode is a VALID numbering boundary — never an error here.
  for (const identity of input.canonicalDuplicateIdentities) {
    push(
      makeDiagnostic(input, 'heading', 'HEADING_DUPLICATE_IDENTITY', '标题存在重复的规范身份', {
        detail: `规范身份 ${identity} 出现多次，可能导致编号与定位不稳定。`,
        stableIdentity: identity,
        targetIdentity: `identity:${identity}`,
        location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: identity },
      }),
    )
  }

  // Phase 7R.3.11.8B.4 — heading structure rules (duplicate text / empty
  // heading / level gap) are gated on the canonical heading authority. When
  // the invariant FAILs (non-canonical headings mixed into the sequence) these
  // rules MUST NOT publish from the polluted sequence.
  const headingStructureAllowed =
    input.headingAuthority == null || input.headingAuthority.decision !== 'FAIL'

  if (headingStructureAllowed) {
    const headingTexts = input.headings.map(h => h.text)
    // Phase 7R.3.11.8B.5 — HEADING_DUPLICATE_TEXT is MULTI-TARGET: the first
    // occurrence is the baseline, the 2nd..Nth are the offending targets
    // (canonical-node / source-range each). Never a text-only find.
    for (const name of duplicateNames(headingTexts)) {
      const dupTargets: DiagnosticLocation[] = []
      let firstSkipped = false
      for (const h of input.headings) {
        if ((h.text ?? '').trim() !== name) continue
        if (!firstSkipped) { firstSkipped = true; continue } // baseline occurrence
        if (h.stableIdentity) {
          dupTargets.push({ kind: 'canonical-node', nodeKind: 'heading', stableIdentity: h.stableIdentity })
        } else {
          const line = h.element?.getAttribute?.('data-line')
          if (line != null && line !== '') {
            dupTargets.push({ kind: 'source-range', startLine: Number.parseInt(line, 10), startColumn: 0 })
          }
        }
      }
      push(
        makeDiagnostic(input, 'heading', 'HEADING_DUPLICATE_TEXT', `重复的标题文字「${name}」`, {
          detail: '多个标题使用相同文字，建议区分以避免混淆。',
          targetIdentity: `text:${name.toLowerCase()}`,
          location: dupTargets.length > 0
            ? { kind: 'multi-target', targets: dupTargets }
            : { kind: 'document-start' },
        }),
      )
    }

    for (const h of input.headings) {
      if ((h.text ?? '').trim() === '') {
        push(
          makeDiagnostic(input, 'heading', 'HEADING_EMPTY_TEXT', '存在空标题', {
            detail: '标题没有文字内容。',
            stableIdentity: h.stableIdentity,
            element: h.element,
            targetIdentity: h.stableIdentity ? `identity:${h.stableIdentity}` : undefined,
            kind: 'heading',
          }),
        )
      }
    }

    // Forward level gap: nextLevel > previousLevel + 1 (backtracking to any
    // higher heading level is a NORMAL structure close — never a gap).
    // Phase 7R.3.11.4: this is a Markdown STRUCTURE lint and uses PHYSICAL
    // heading levels regardless of numbering strict mode (HEADING_LEVEL_GAP).
    if (input.headings.length > 1) {
      let prevLevel: number | null = null
      for (const h of input.headings) {
        if (prevLevel != null && h.level > prevLevel + 1) {
          const missingLevels: number[] = []
          for (let l = prevLevel + 1; l < h.level; l++) missingLevels.push(l)
          push(
            makeDiagnostic(input, 'heading', 'HEADING_LEVEL_GAP', `标题层级存在跳级（H${prevLevel} → H${h.level}）`, {
              detail: `当前标题为 H${h.level}，但前一可用层级为 H${prevLevel}，缺少 ${missingLevels.map(l => `H${l}`).join('、')}。`,
              stableIdentity: h.stableIdentity,
              element: h.element,
              targetIdentity: h.stableIdentity ? `identity:${h.stableIdentity}` : `gap:${prevLevel}>${h.level}:${h.text}`,
              kind: 'heading',
              metadata: {
                ruleId: 'HEADING-LEVEL-GAP',
                previousLevel: prevLevel,
                currentLevel: h.level,
                missingLevels,
              },
            }),
          )
        }
        prevLevel = h.level
      }
    }
  }

  // ── Figure diagnostics ──────────────────────────────
  const figureNames = input.figures.map(f => f.name)
  for (const name of duplicateNames(figureNames)) {
    const dupTargets = duplicateOccurrenceTargets(
      input.figures.map((f, i) => ({ name: f.name, targetIdentity: f.targetIdentity, index: i })),
      'figure',
      name,
    )
    push(
      makeDiagnostic(input, 'figure', 'FIGURE_DUPLICATE_NAME', `重复的图名「${name}」`, {
        detail: '多张图片使用相同图名。',
        targetIdentity: `name:${name.toLowerCase()}`,
        location: dupTargets.length > 0 ? { kind: 'multi-target', targets: dupTargets } : { kind: 'document-start' },
      }),
    )
  }
  for (const f of input.figures) {
    const identity = f.targetIdentity ?? undefined
    if ((f.name ?? '').trim() === '') {
      push(
        makeDiagnostic(input, 'figure', 'FIGURE_MISSING_NAME', '图片缺少图名', {
          detail: '建议为图片命名。',
          element: f.element,
          targetIdentity: identity,
          kind: 'object',
        }),
      )
    }
    // Local resource check only for resolvable local relative paths.
    if (f.localPath && isLocalRelativePath(f.localPath)) {
      const figLine = f.element?.getAttribute?.('data-line')
      // Phase 7R.3.11.8B.7.3/7.4 — Semantic Resource Identity = the
      // vault-relative canonical destination derived from the DOM src. The
      // resolver re-derives the img from the CURRENT frame by this identity —
      // an ordinal drift or wrapper insertion never turns it stale. Duplicate
      // images of the SAME destination get a per-occurrence ordinal that never
      // merges into the path (block-node ordinal location already targets the
      // correct img; occurrenceIndex only drives the semantic fallback).
      const src = f.element?.getAttribute?.('src') ?? ''
      const destRel = resourceSrcToVaultRelative(src, input.vaultRoot) ?? (f.localPath || undefined)
      const occurrenceIndex = figureDestinationOccurrenceIndex(input.figures, f, destRel, input.vaultRoot)
      push(
        makeDiagnostic(input, 'figure', 'FIGURE_LOCAL_IMAGE_MISSING', `本地图片不存在：${f.localPath}`, {
          detail: '相对路径无法解析到现有文件。',
          element: f.element,
          targetIdentity: destRel
            ? `local:${destRel}${occurrenceIndex > 0 ? `:${occurrenceIndex + 1}` : ''}`
            : `local:${f.localPath}`,
          kind: 'object',
          metadata: {
            ruleId: 'FIGURE-LOCAL-IMAGE-MISSING',
            resourceKind: 'image',
            // Semantic Resource Identity (decoded, vault-relative canonical).
            destination: destRel,
            // Source Token Identity: the raw DOM src captured at scan time.
            rawDestination: src || undefined,
            occurrenceIndex,
          },
          location: f.targetIdentity
            ? { kind: 'block-node', blockKind: 'figure', stableIdentity: f.targetIdentity }
            : figLine != null && figLine !== ''
              ? { kind: 'source-range', startLine: Number.parseInt(figLine, 10), startColumn: 0 }
              : { kind: 'document-start' },
        }),
      )
    }
  }

  // ── Table diagnostics ───────────────────────────────
  const tableNames = input.tables.map(t => t.name)
  for (const name of duplicateNames(tableNames)) {
    const dupTargets = duplicateOccurrenceTargets(
      input.tables.map((t, i) => ({ name: t.name, targetIdentity: t.targetIdentity, index: i })),
      'table',
      name,
    )
    push(
      makeDiagnostic(input, 'table', 'TABLE_DUPLICATE_NAME', `重复的表名「${name}」`, {
        detail: '多张表格使用相同表名。',
        targetIdentity: `name:${name.toLowerCase()}`,
        location: dupTargets.length > 0 ? { kind: 'multi-target', targets: dupTargets } : { kind: 'document-start' },
      }),
    )
  }
  for (const t of input.tables) {
    if ((t.name ?? '').trim() === '') {
      push(
        makeDiagnostic(input, 'table', 'TABLE_MISSING_NAME', '表格缺少表名', {
          detail: '建议为表格命名。',
          element: t.element,
          targetIdentity: t.targetIdentity ?? undefined,
          kind: 'object',
        }),
      )
    }
  }

  // ── Code diagnostics ────────────────────────────────
  const codeNames = input.codes.map(c => c.name)
  for (const name of duplicateNames(codeNames)) {
    const dupTargets = duplicateOccurrenceTargets(
      input.codes.map((c, i) => ({ name: c.name, targetIdentity: c.targetIdentity, index: i })),
      'code',
      name,
    )
    push(
      makeDiagnostic(input, 'code', 'CODE_DUPLICATE_NAME', `重复的代码名称「${name}」`, {
        detail: '多个代码块使用相同名称。',
        targetIdentity: `name:${name.toLowerCase()}`,
        location: dupTargets.length > 0 ? { kind: 'multi-target', targets: dupTargets } : { kind: 'document-start' },
      }),
    )
  }
  for (const c of input.codes) {
    if ((c.name ?? '').trim() === '') {
      push(
        makeDiagnostic(input, 'code', 'CODE_MISSING_NAME', '代码块缺少名称', {
          detail: '建议为代码块命名。',
          element: c.element,
          targetIdentity: c.targetIdentity ?? undefined,
          kind: 'object',
        }),
      )
    }
    if ((c.language ?? '').trim() === '') {
      push(
        makeDiagnostic(input, 'code', 'CODE_MISSING_LANGUAGE', '代码块缺少语言标识', {
          detail: '未指定代码语言（如 python / ts）。',
          element: c.element,
          targetIdentity: c.targetIdentity ? `${c.targetIdentity}:lang` : undefined,
          kind: 'object',
          // Phase 7R.3.11.8B.5 — the LOCATION points at the SAME code block
          // (block ordinal), even though the dedup key carries a :lang suffix.
          location: c.targetIdentity
            ? { kind: 'block-node', blockKind: 'code', stableIdentity: c.targetIdentity }
            : undefined,
        }),
      )
    }
  }

  // ── Formula diagnostics (projection invariants only — never business re-derivation) ──
  for (const f of input.formulas) {
    const tokenSet = new Set(f.visibleTagTokens.map(t => t.trim()))
    if (f.visibleTagTokens.length > tokenSet.size) {
      push(
        makeDiagnostic(input, 'formula', 'FORMULA_DUPLICATE_VISIBLE_TAG', '公式出现重复可见编号', {
          detail: '同一公式宿主内检测到重复的可见编号标签。',
          element: f.element,
          targetIdentity: f.targetIdentity ?? undefined,
          kind: 'formula',
        }),
      )
    }
  }

  // ── Link diagnostics (safe local resolution only; no network) ──
  // Phase 7R.3.11.8B.7.3/7.4 — THREE-LAYER identity separation:
  //   rawDestination  = Source Token Identity (exact Markdown token; validity)
  //   destination     = Semantic Resource Identity (vault-relative canonical,
  //                     resolved from the document base; DOM resolution)
  //   occurrenceIndex = duplicate ordinal, NEVER merged into the path
  // The `#2`/`:2` display suffix is UI text only and never a real path.
    for (const l of input.links) {
    if (!isLocalRelativePath(l.target)) continue
    const occurrenceIndex = linkOccurrenceIndex(input.links, l.target, l.index)
    const occurrenceLabel = occurrenceIndex > 0 ? `（第 ${occurrenceIndex + 1} 处）` : ''
    const semanticDestination = l.semanticDestination || normalizeResourceToken(l.target)
    push(
      makeDiagnostic(input, 'link', 'LINK_LOCAL_TARGET_MISSING', `本地链接目标不存在：${l.target}${occurrenceLabel}`, {
        detail: '链接指向的本地文件无法解析。',
        element: l.element,
        targetIdentity: `local:${l.target}${occurrenceIndex > 0 ? `:${occurrenceIndex + 1}` : ''}`,
        kind: 'link',
        metadata: {
          ruleId: 'LINK-LOCAL-TARGET-MISSING',
          resourceKind: l.resourceKind ?? 'link',
          // Semantic Resource Identity for DOM resolution (decoded canonical).
          destination: semanticDestination,
          // Source Token Identity for source-layer validity (raw, untouched).
          rawDestination: l.target,
          occurrenceIndex,
        },
        location: {
          kind: 'block-node',
          blockKind: l.resourceKind === 'image' ? 'figure' : 'link',
          stableIdentity: l.targetIdentity ?? `local:${l.target}`,
        },
        // Phase 7R.3.11.8B.7.4 — validity lives on the SOURCE TOKEN layer:
        // the current Markdown must still reference the same token
        // (occurrence-aware). Path representation differences (percent-encoded
        // vs decoded DOM forms) never reach this verdict.
        validityFingerprint: {
          kind: 'resource',
          path: normalizeResourceToken(l.target),
          occurrence: occurrenceIndex,
        },
      }),
    )
  }

  const deduped = deduplicateDiagnostics(diagnostics)
  return {
    diagnostics: deduped,
    errorCount: deduped.filter(d => d.severity === 'error').length,
    warningCount: deduped.filter(d => d.severity === 'warning').length,
    infoCount: deduped.filter(d => d.severity === 'info').length,
  }
}

/** Build the compact toolbar/UI state from a snapshot. */
export function deriveDiagnosticsState(
  snapshot: DocumentDiagnosticsSnapshot | null,
): DocumentDiagnosticsState {
  if (!snapshot || snapshot.documentKey == null) return { state: 'NO_ACTIVE_DOCUMENT', errorCount: 0, warningCount: 0, infoCount: 0 }
  if (snapshot.errorCount > 0 || snapshot.warningCount > 0) {
    return { state: 'HAS_ISSUES', errorCount: snapshot.errorCount, warningCount: snapshot.warningCount, infoCount: snapshot.infoCount }
  }
  return { state: 'HEALTHY', errorCount: 0, warningCount: 0, infoCount: snapshot.infoCount }
}
