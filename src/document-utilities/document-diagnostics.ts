/**
 * Phase 7R.3.11 — Document Diagnostics: pure compute + deduplication.
 *
 * Authority-driven only. Consumes existing canonical facts (strict document
 * validator, canonical heading frame, caption records, formula projection
 * output) and NEVER rebuilds heading numbering / object scope semantics.
 * No timers, no polling — the caller decides WHEN to compute.
 */
import { validateStrictFirstH1Topline } from '../heading-numbering/strict-document-validator'
import type {
  DiagnosticLocation,
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

// ── Phase 7R.3.11.8-B — DOCUMENT-TRAILING-BLANK-LINE ──────────────────
export type TrailingBlankLineVerdict = 'PASS' | 'WARNING' | 'SKIP'

/**
 * Pure trailing-blank-line verdict from the RAW Markdown source.
 *
 * A "trailing blank line" exists iff at least TWO line breaks appear after the
 * last non-blank logical line (i.e. the last content line is followed by a
 * complete empty/whitespace-only logical line AND its terminating newline).
 *
 *   "content\n\n"      → PASS
 *   "content\r\n\r\n"  → PASS
 *   "content\n   \n"   → PASS (blank line may contain space/tab)
 *   "content\n"        → WARNING (a single EOF newline is NOT a blank line)
 *   "content"          → WARNING
 *   "" / whitespace    → SKIP (empty-document policy)
 */
export function computeDocumentTrailingBlankLine(markdown: string | null | undefined): TrailingBlankLineVerdict {
  if (markdown == null) return 'SKIP'
  const lines = markdown.split('\n')
  let lastNonBlank = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, '').trim() !== '') lastNonBlank = i
  }
  if (lastNonBlank === -1) return 'SKIP' // empty / whitespace-only document
  const lineBreaksAfter = lines.length - 1 - lastNonBlank
  return lineBreaksAfter >= 2 ? 'PASS' : 'WARNING'
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

  // ── Document-level ──────────────────────────────────
  if (input.documentKey == null || (input.markdown == null && input.headings.length === 0)) {
    // No active business document: NOT a scary plugin error.
    push(
      makeDiagnostic(input, 'document', 'DOCUMENT_INACTIVE', '当前没有活动文档', {
        detail: '打开一个 Markdown 文档后即可检查其结构。',
      }),
    )
  } else {
    const topline = validateStrictFirstH1Topline(input.markdown, input.strictMode ? 'strict' : 'loose')
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

    // ── Phase 7R.3.11.8-B — STRICT-SINGLE-H1 (strict only, canonical frame authority) ──
    // h1Facts === null means the heading frame is not committed yet → WAIT, never
    // judge against a stale/empty frame. h1Facts === [] is a REAL zero-H1 doc.
    if (input.strictMode && input.h1Facts != null) {
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

    // ── Phase 7R.3.11.8-B — DOCUMENT-TRAILING-BLANK-LINE (all modes, raw source authority) ──
    if (input.markdown != null) {
      const verdict = computeDocumentTrailingBlankLine(input.markdown)
      if (verdict === 'WARNING') {
        push(
          makeDiagnostic(input, 'document', 'DOCUMENT_TRAILING_BLANK_LINE',
            '警告：文档末尾缺少空行', {
            detail: 'Markdown 文档最后一个非空内容之后应保留至少一个空行。',
            kind: 'document',
            targetIdentity: 'document:trailing-blank-line',
            metadata: { ruleId: 'DOCUMENT-TRAILING-BLANK-LINE', reason: 'MISSING_TRAILING_BLANK_LINE' },
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
          location: { kind: 'source-range', startLine: line, startColumn: column, sourceFingerprint: `latent:${line}:${marker}` },
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
      push(
        makeDiagnostic(input, 'figure', 'FIGURE_LOCAL_IMAGE_MISSING', `本地图片不存在：${f.localPath}`, {
          detail: '相对路径无法解析到现有文件。',
          element: f.element,
          targetIdentity: `local:${f.localPath}`,
          kind: 'object',
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
  for (const l of input.links) {
    if (!isLocalRelativePath(l.target)) continue
    push(
      makeDiagnostic(input, 'link', 'LINK_LOCAL_TARGET_MISSING', `本地链接目标不存在：${l.target}`, {
        detail: '链接指向的本地文件无法解析。',
        element: l.element,
        targetIdentity: `local:${l.target}`,
        kind: 'link',
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
