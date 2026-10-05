/**
 * Phase 7R.3.11 — Document Diagnostics: pure compute + deduplication.
 *
 * Authority-driven only. Consumes existing canonical facts (strict document
 * validator, canonical heading frame, caption records, formula projection
 * output) and NEVER rebuilds heading numbering / object scope semantics.
 * No timers, no polling — the caller decides WHEN to compute.
 */
import { validateStrictFirstH1Topline } from '../heading-numbering/strict-document-validator'
import { normalizeResourcePath, normalizeSourceAnchorText } from './document-diagnostic-location'
// V5.12-R5 §4 — the SOURCE RANGE IDENTITY authority (pure, no DOM).
import { buildSourceRangeIdentity } from './document-diagnostic-source-occurrence-v512-r5'
// TRAE V4 §3/§4 — the SOURCE-SYNTAX OPENER location kind.
import type { SourceSyntaxKind } from './document-diagnostic-source-syntax-location-authority'
// V5.12-R6 §7 — the ONE empty-document predicate (pure, no DOM / no runtime).
import { isSemanticallyEmptyDocument } from './document-diagnostic-empty-short-circuit-v512-r6'
// V5.12-R8 §4 — resource classification + the unified figure occurrence model.
import type { ResourceClass, ImageSourceOccurrence } from './document-resource-scanner'
// Phase I (spec §10) — the ONE in-document anchor scanner (`[x](#target)`),
// reusing the SAME literal-excluding reference scanner (no second parser).
import { parseLocalAnchorTargets } from './document-resource-scanner'
// V5.15 — Standalone Object Block Invariant (figure structure gate).
import {
  analyzeFigureStandaloneSourceBlocks,
  beginFigureStructureDiagnosticPass,
  figureStructureUserCopy,
  noteFigureStructureDiagnosticPublished,
  FIGURE_BLOCK_STRUCTURE_INVALID_CODE,
  type FigureStandaloneSourceBlock,
} from './document-standalone-object-block-invariant-v515'
import type {
  DiagnosticFigureOccurrenceIdentity,
  DiagnosticLocation,
  DiagnosticValidityFingerprint,
  DocumentDiagnostic,
  DocumentDiagnosticCategory,
  DocumentDiagnosticLocatorDescriptor,
  DocumentDiagnosticSeverity,
  DocumentDiagnosticsSnapshot,
  DocumentDiagnosticsState,
  ObjectEffectiveNumbersSnapshot,
} from './diagnostics-types'
// V1 — Figure Diagnostic Locator Authority (identity builders, pure).
import {
  buildFigureOccurrenceIdentity,
  buildSourceBlockIdentity,
} from './document-diagnostic-locator-authority-v1'
// VNext §9/§11 — the ONE rule metadata authority (scope / presentation).
import { getRuleMeta } from './document-diagnostic-location'
// V1 — 单标题无正文 Hint：the canonical-heading source-line authority (Typora
// `data-line` + the documented ATX text-key safety net). Reused so this rule
// never builds a second Markdown heading parser.
import {
  collectCanonicalHeadingOwnedLines,
  collectCanonicalHeadingSourceLines,
  collectCanonicalHeadingTextKeys,
} from './latent-atx-heading-marker'
// VNext (Requirements Gap Closure V1) §12–§29 — the ONE pure source-only
// analyzer authority for the new completeness / manual-numbering / block
// structure / empty-object rules. It reads the Markdown ONLY (never the DOM).
import {
  analyzeDocumentCompleteness,
  analyzeEmptySourceObjects,
  analyzeDisplayFormulaBlocks,
  analyzeTableBlocks,
  detectManualNumberPrefix,
  type SourceBlockSpan,
} from './document-diagnostics-vnext-authority'
// Heading Auto-Number Conflict Diagnostics V1 §7/§8 — the ONE manual-number
// prefix parser authority (confirmed / ambiguous / none).
import { resolveHeadingManualNumberPrefix } from './document-diagnostics-heading-manual-number-prefix-v1'
// Internal Blank-Line Policy V1 §1/§3/§7 — the ONE threshold + block-gap
// authority for `EXCESSIVE_INTERNAL_BLANK_LINES` (source-only, never DOM).
import {
  EXCESSIVE_INTERNAL_BLANK_LINES_CODE,
  EXCESSIVE_INTERNAL_BLANK_LINES_RULE_ID,
  INTERNAL_BLANK_LINE_POLICY,
  analyzeInternalBlankLineGaps,
  internalBlankGapIdentity,
  internalBlankLineDetail,
} from './document-diagnostic-internal-blank-lines-v1'
// Phase G — the DOM-side caption-integrity producer's emitted codes (the SAME
// single allow-list mirrored below; the caption producer is not a second registry).
import { CAPTION_INTEGRITY_DIAGNOSTIC_CODES } from './document-diagnostics-caption-integrity-v1'
// TRAE V3 §7 — the THREE shared source authorities (single-pass per source
// revision; every new rule consumes them instead of re-scanning the document).
import {
  getDocumentSourceSyntaxSnapshot,
  parseDocumentSourceTables,
  type SourceTableStructure,
} from './document-source-syntax-authority'
import {
  getDocumentDefinitionReferenceIndex,
  type DefinitionReferenceOccurrence,
} from './document-definition-reference-index'
import { getDocumentInlineLinkAuthority } from './document-inline-link-authority'

/** 0-based source line text (CR stripped) — the source-range `rawText` anchor. */
function lineTextAt(markdown: string | null, line: number): string {
  if (markdown == null || !Number.isInteger(line) || line < 0) return ''
  const lines = markdown.split('\n')
  if (line >= lines.length) return ''
  const raw = lines[line]
  return raw.endsWith('\r') ? raw.slice(0, -1) : raw
}

export interface DiagnosticHeadingFact {
  level: number
  text: string
  stableIdentity?: string
  element: HTMLElement | null
  /**
   * Heading Auto-Number Conflict V1 §2/§4 — the heading numbering authority's
   * OWN effective verdict for THIS heading (never the global switch). Produced
   * by the ONE `isAutoNumberingEffectiveForHeading` authority; absent (pure /
   * legacy callers) means "not effective" → the conflict rule stays silent.
   */
  autoNumberingEffective?: boolean
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

/**
 * V5.12-R8 §4 — the UNIFIED Figure Source Occurrence.
 *
 * ONE occurrence carries BOTH source ranges — the full Markdown image token
 * (`![alt](dest)`) AND the destination/path (`dest`) — plus the occurrence
 * identity and the resource semantics. The two figure rules therefore never
 * re-parse the Markdown and never disagree about which occurrence they mean:
 *
 *   FIGURE_MISSING_NAME        → FIGURE_FULL_TOKEN  (tokenStart/tokenEnd)
 *   FIGURE_LOCAL_IMAGE_MISSING → FIGURE_DESTINATION (destinationStart/End)
 */
export interface FigureSourceOccurrence {
  rawToken: string
  rawDestination: string
  altText: string
  /** 'local' | 'remote' | 'data' | 'other' — remote/data are never "missing local". */
  resourceClass: ResourceClass
  isLocal: boolean
  /** Whole `![alt](dest "title")`. */
  tokenStart: number
  tokenEnd: number
  /** Destination/path only (excludes an optional `"title"`). */
  destinationStart: number
  destinationEnd: number
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
  rawText: string
  canonicalDestination: string
  occurrenceIndex: number
  rawLineOrdinal: number
  occurrenceWithinLine: number
  /** Resolved local file existence (null for remote / data / other). */
  localFileExists: boolean | null
  /** Identity of the FULL TOKEN range (the FIGURE_MISSING_NAME authority). */
  sourceRangeIdentity: string | null
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
  /** V4 — SOURCE anchor (Markdown offsets + line span + raw line text). Lets
   *  the missing-image rule run source-first with a real Source Anchor even
   *  when no rendered <img> exists. */
  sourceStart?: number
  sourceEnd?: number
  startLine?: number
  endLine?: number
  /** V5.12-R5 §5 — source columns (computed once from the Markdown source). */
  startColumn?: number
  endColumn?: number
  rawText?: string
  /** V5.12-R8 §4 — destination/path span (the FIGURE_LOCAL_IMAGE_MISSING target). */
  destinationStart?: number
  destinationEnd?: number
  /** V5.12-R8 §4 — the full Markdown reference token (`![alt](dest)`). */
  rawToken?: string
  /** V5.12-R8 §4 — Markdown alt text (the canonical figure name). */
  altText?: string
  /** V5.12-R8 §4 — resource class (local | remote | data | other). */
  resourceClass?: ResourceClass
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
    case 'FORMULA_DUPLICATE_VISIBLE_TAG':
    case 'HEADING_DUPLICATE_IDENTITY':
      return 'error'
    // TRAE V3 — an unclosed code fence / formula block swallows the rest of the
    // document as one protected range and a duplicate footnote definition breaks
    // the footnote model: all are ERRORS.
    case 'CODE_FENCE_UNCLOSED':
    case 'FORMULA_BLOCK_UNCLOSED':
    case 'FOOTNOTE_DEFINITION_DUPLICATE':
    case 'FRONTMATTER_UNCLOSED':
      return 'error'
    // V5.15 §26 — a structurally invalid picture block breaks the Figure
    // business model itself (occurrence identity / numbering / caption /
    // locate / visual target), so it is an ERROR, never a Warning.
    case 'FIGURE_BLOCK_STRUCTURE_INVALID':
      return 'error'
    // VNext §18/§19 — a table / display formula that is NOT a standalone block
    // breaks the object model the same way an invalid picture block does.
    case 'TABLE_BLOCK_STRUCTURE_INVALID':
    case 'FORMULA_BLOCK_STRUCTURE_INVALID':
      return 'error'
    // VNext §24 — a manual number prefix while automatic numbering is ON is a
    // USER-content defect (it will collide with the generated number).
    case 'HEADING_MANUAL_NUMBER_PREFIX':
    case 'FIGURE_MANUAL_NUMBER_PREFIX':
    // Phase H (spec §9) — the table / code analogues of the figure rule.
    case 'TABLE_MANUAL_NUMBER_PREFIX':
    case 'CODE_MANUAL_NUMBER_PREFIX':
      return 'warning'
    // Heading Auto-Number Conflict V1 §13 — when the auto number is EFFECTIVE
    // for the heading AND the source already carries a confirmed manual prefix,
    // two numbering authorities WILL coexist. Fixed ERROR (never mode-dependent).
    case 'HEADING_AUTO_NUMBER_CONFLICT':
      return 'error'
    // ── Constant WARNING rules ──
    // V5.12-R8 §9 — a missing local image is a resource-level WARNING (the
    // document structure is intact; only a referenced asset is absent), never
    // an error. Remote / data URLs can never reach this rule.
    case 'FIGURE_LOCAL_IMAGE_MISSING':
      return 'warning'
    // Internal Blank-Line Policy V1 §2 — 3+ consecutive blank lines INSIDE the
    // body is a document-FORMAT warning. Fixed across strict and loose mode and
    // NEVER escalated to an error (a readable document with sloppy spacing).
    case EXCESSIVE_INTERNAL_BLANK_LINES_CODE:
      return 'warning'
    // Phase I (spec §10) — a `#anchor` link that resolves to no canonical
    // heading anchor is a broken cross-reference (Warning, never Error: the
    // document structure is intact; only the link destination is wrong).
    case 'LINK_LOCAL_ANCHOR_MISSING':
      return 'warning'
    // Phase I (spec §10) — two canonical headings sharing ONE anchor id make the
    // anchor ambiguous; a Warning (a defensive integrity check on Typora's own
    // heading ids).
    case 'HEADING_ANCHOR_COLLISION':
      return 'warning'
    // TRAE V3 — a missing footnote / reference-style link definition, a duplicate
    // reference definition and a link with no destination are WARNINGS (the
    // document structure is intact; only a reference target is wrong).
    case 'FOOTNOTE_REFERENCE_TARGET_MISSING':
    case 'LINK_REFERENCE_DEFINITION_MISSING':
    case 'LINK_REFERENCE_DEFINITION_DUPLICATE':
    case 'LINK_TARGET_EMPTY':
    case 'TABLE_HEADER_DUPLICATE':
      return 'warning'
    // ── Constant INFO rules ──
    case 'DOCUMENT_EMPTY':
    case 'DOCUMENT_INACTIVE':
    case 'DOCUMENT_SOURCE_UNAVAILABLE':
    // VNext §13/§16/§17/§28 — completeness hints are HINTS in both modes.
    case 'DOCUMENT_HEADINGS_ONLY_NO_BODY':
    case 'SECTION_EMPTY':
    case 'SECTION_ONLY_SUBHEADINGS':
    case 'CODE_EMPTY_BLOCK':
    case 'TABLE_EMPTY_CONTENT':
    case 'FORMULA_EMPTY_CONTENT':
    case 'BLOCKQUOTE_EMPTY':
    // V1 §3 — a document that only owns a title is a completeness HINT, never a
    // syntax error / structural warning. Constant across strict and loose mode:
    // an incomplete document is incomplete in both.
    case DOCUMENT_HEADING_ONLY_NO_BODY_CODE:
      return 'info'
    // TRAE V3 — unused / empty footnote definitions and an empty table header cell
    // are HINTS; an empty inline link TEXT is a hint too (an icon link is legal).
    case 'FOOTNOTE_DEFINITION_UNUSED':
    case 'FOOTNOTE_DEFINITION_EMPTY':
    case 'TABLE_HEADER_EMPTY':
    case 'LINK_TEXT_EMPTY':
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
  /**
   * V1 §21 — the source generation this compute runs against. The figure
   * locator records it on every `source-block` / `figure-occurrence` location
   * so a click can detect a STALE source revision instead of locating with an
   * outdated offset.
   */
  sourceRevision?: number | null
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
  /**
   * V5.12-R8 §4 — unified figure source occurrences (ONE scanner authority).
   * When provided, FIGURE_MISSING_NAME is produced SOURCE-FIRST from these
   * occurrences (full Markdown token target, broken images included). Absent =
   * the legacy DOM-figure fallback keeps pure/legacy callers unchanged.
   */
  figureSourceOccurrences?: readonly FigureSourceOccurrence[]
  tables: readonly DiagnosticObjectFact[]
  codes: readonly DiagnosticObjectFact[]
  formulas: readonly DiagnosticFormulaFact[]
  links: readonly DiagnosticLinkFact[]
  canonicalDuplicateIdentities: readonly string[]
  captionDuplicateNames: readonly string[]
  /**
   * VNext §24 — which AUTOMATIC numbering systems are currently ON. A manual
   * number prefix is only a defect while the corresponding auto-numbering would
   * also emit a number (otherwise a literal `1.` prefix is plain text and MUST
   * NOT be reported — `MANUAL_NUMBER_PREFIX_FALSE_POSITIVE_COUNT=0`).
   * Absent = every system OFF (no manual-prefix rule runs).
   */
  numberingEnabled?: {
    heading?: boolean
    figure?: boolean
    table?: boolean
    code?: boolean
    formula?: boolean
  }
  /**
   * Numbering Integrity V2 (spec §9/§21) — the canonical effective-number fact
   * snapshot consumed by the object / formula NUMBER rules (duplicate / order /
   * section-mismatch). It is produced by the EXISTING numbering authority (the
   * caption service) and keyed by the object's canonical SOURCE identity
   * (`block:<kind>:<ordinal>`). Absent / empty ⇒ every number rule stays SILENT
   * (never a false positive). The producer NEVER re-derives or parses a number.
   */
  objectEffectiveNumbers?: ObjectEffectiveNumbersSnapshot | null
  /**
   * Heading Auto-Number Conflict V1 §2/§4/§44 — the heading auto-numbering
   * EFFECTIVENESS authority's global audit facts. The PER-HEADING verdict
   * travels on `DiagnosticHeadingFact.autoNumberingEffective`; these two
   * booleans are the global switch + H1 policy, recorded on the audit only.
   * Absent = everything OFF (the conflict rule never runs).
   */
  headingAutoNumbering?: {
    enabled: boolean
    h1NumberingEnabled: boolean
    /** Heading Auto-Number Conflict V1.2 §13 — the effective STYLE identity. */
    styleKey?: string
  }
}

export interface DocumentDiagnosticsComputed {
  diagnostics: DocumentDiagnostic[]
  errorCount: number
  warningCount: number
  infoCount: number
}

const DOCUMENT_EMPTY_CODE = 'DOCUMENT_EMPTY'
const SOURCE_UNAVAILABLE_CODE = 'DOCUMENT_SOURCE_UNAVAILABLE'

/**
 * V1 §2 — stable, unique, filterable, locatable id of the "a document that is
 * only a title" completeness hint. Severity is `info` (the project's existing
 * "提示 / hint" level — §3 forbids a NEW severity axis).
 */
export const DOCUMENT_HEADING_ONLY_NO_BODY_CODE = 'DOCUMENT_HEADING_ONLY_NO_BODY'

// ── VNext (Requirements Gap Closure V1) rule codes ─────────────────────────
/** §13 — MULTI-heading document without substantive body (mutually exclusive with the single-heading code above). */
export const DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE = 'DOCUMENT_HEADINGS_ONLY_NO_BODY'
/** §16 — a heading whose section owns neither body nor child headings. */
export const SECTION_EMPTY_CODE = 'SECTION_EMPTY'
/** §17 — a heading whose whole subtree owns only descendant headings. */
export const SECTION_ONLY_SUBHEADINGS_CODE = 'SECTION_ONLY_SUBHEADINGS'
/** §24 — a heading text carrying a manual number prefix while auto-numbering is ON. */
export const HEADING_MANUAL_NUMBER_PREFIX_CODE = 'HEADING_MANUAL_NUMBER_PREFIX'
/**
 * Heading Auto-Number Conflict V1 §1/§13 — the heading's automatic numbering is
 * EFFECTIVE for it AND the canonical Markdown source heading already carries a
 * CONFIRMED manual number prefix. Both numbering authorities would coexist, so
 * this is an ERROR (never a warning/hint).
 */
export const HEADING_AUTO_NUMBER_CONFLICT_CODE = 'HEADING_AUTO_NUMBER_CONFLICT'
/** §24 — a figure name carrying a manual number prefix while auto-numbering is ON. */
export const FIGURE_MANUAL_NUMBER_PREFIX_CODE = 'FIGURE_MANUAL_NUMBER_PREFIX'
/** Phase H (spec §9) — a table name carrying a manual number prefix while auto-numbering is ON. */
export const TABLE_MANUAL_NUMBER_PREFIX_CODE = 'TABLE_MANUAL_NUMBER_PREFIX'
/** Phase H (spec §9) — a code-block name carrying a manual number prefix while auto-numbering is ON. */
export const CODE_MANUAL_NUMBER_PREFIX_CODE = 'CODE_MANUAL_NUMBER_PREFIX'
/** Phase I (spec §10) — a `[x](#target)` link whose target is no canonical heading anchor. */
export const LINK_LOCAL_ANCHOR_MISSING_CODE = 'LINK_LOCAL_ANCHOR_MISSING'
/** Phase I (spec §10) — a collision group of canonical headings sharing ONE anchor id. */
export const HEADING_ANCHOR_COLLISION_CODE = 'HEADING_ANCHOR_COLLISION'
/** §18 — a table that is not a standalone block (list / blockquote marker). */
export const TABLE_BLOCK_STRUCTURE_INVALID_CODE = 'TABLE_BLOCK_STRUCTURE_INVALID'
/** §19 — a display formula that is not a standalone block. */
export const FORMULA_BLOCK_STRUCTURE_INVALID_CODE = 'FORMULA_BLOCK_STRUCTURE_INVALID'
/** §28 — an empty fenced code block. */
export const CODE_EMPTY_BLOCK_CODE = 'CODE_EMPTY_BLOCK'
/** §28 — a table with zero body rows. */
export const TABLE_EMPTY_CONTENT_CODE = 'TABLE_EMPTY_CONTENT'
/** §28 — an empty `$$` display formula (never blocks KNOWN_EMPTY numbering). */
export const FORMULA_EMPTY_CONTENT_CODE = 'FORMULA_EMPTY_CONTENT'
/** §28 — an empty blockquote. */
export const BLOCKQUOTE_EMPTY_CODE = 'BLOCKQUOTE_EMPTY'

// ── TRAE V3 (spec §1–§6) — Source Syntax / Footnote / Reference / Front Matter
//    / Table header / Empty-link integrity rule codes ────────────────────────
export const CODE_FENCE_UNCLOSED_CODE = 'CODE_FENCE_UNCLOSED'
export const FORMULA_BLOCK_UNCLOSED_CODE = 'FORMULA_BLOCK_UNCLOSED'
export const FOOTNOTE_REFERENCE_TARGET_MISSING_CODE = 'FOOTNOTE_REFERENCE_TARGET_MISSING'
export const FOOTNOTE_DEFINITION_DUPLICATE_CODE = 'FOOTNOTE_DEFINITION_DUPLICATE'
export const FOOTNOTE_DEFINITION_UNUSED_CODE = 'FOOTNOTE_DEFINITION_UNUSED'
export const FOOTNOTE_DEFINITION_EMPTY_CODE = 'FOOTNOTE_DEFINITION_EMPTY'
export const LINK_REFERENCE_DEFINITION_MISSING_CODE = 'LINK_REFERENCE_DEFINITION_MISSING'
export const LINK_REFERENCE_DEFINITION_DUPLICATE_CODE = 'LINK_REFERENCE_DEFINITION_DUPLICATE'
export const FRONTMATTER_UNCLOSED_CODE = 'FRONTMATTER_UNCLOSED'
export const FRONTMATTER_MALFORMED_CODE = 'FRONTMATTER_MALFORMED'
export const TABLE_HEADER_EMPTY_CODE = 'TABLE_HEADER_EMPTY'
export const TABLE_HEADER_DUPLICATE_CODE = 'TABLE_HEADER_DUPLICATE'
export const LINK_TEXT_EMPTY_CODE = 'LINK_TEXT_EMPTY'
export const LINK_TARGET_EMPTY_CODE = 'LINK_TARGET_EMPTY'

/**
 * §6/§31 — every TRAE V3 runtime code this producer can emit. `FRONTMATTER_MALFORMED`
 * is deliberately ABSENT: it is DEFERRED_BY_SPEC (no canonical YAML parser), so the
 * producer never fabricates it.
 */
export const SOURCE_INTEGRITY_DIAGNOSTIC_CODES: readonly string[] = [
  CODE_FENCE_UNCLOSED_CODE,
  FORMULA_BLOCK_UNCLOSED_CODE,
  FOOTNOTE_REFERENCE_TARGET_MISSING_CODE,
  FOOTNOTE_DEFINITION_DUPLICATE_CODE,
  FOOTNOTE_DEFINITION_UNUSED_CODE,
  FOOTNOTE_DEFINITION_EMPTY_CODE,
  LINK_REFERENCE_DEFINITION_MISSING_CODE,
  LINK_REFERENCE_DEFINITION_DUPLICATE_CODE,
  FRONTMATTER_UNCLOSED_CODE,
  TABLE_HEADER_EMPTY_CODE,
  TABLE_HEADER_DUPLICATE_CODE,
  LINK_TEXT_EMPTY_CODE,
  LINK_TARGET_EMPTY_CODE,
]

// ── Numbering Integrity V2 (spec §9/§21) rule codes ─────────────────────────
/** §9 — two canonical figures share the same effective number. */
export const FIGURE_NUMBER_DUPLICATE_CODE = 'FIGURE_NUMBER_DUPLICATE'
/** §9 — two canonical tables share the same effective number. */
export const TABLE_NUMBER_DUPLICATE_CODE = 'TABLE_NUMBER_DUPLICATE'
/** §9 — two canonical code blocks share the same effective number. */
export const CODE_NUMBER_DUPLICATE_CODE = 'CODE_NUMBER_DUPLICATE'
/** §9 — figure effective numbers are not strictly increasing in document order. */
export const FIGURE_NUMBER_ORDER_INVALID_CODE = 'FIGURE_NUMBER_ORDER_INVALID'
/** §9 — table effective numbers are not strictly increasing in document order. */
export const TABLE_NUMBER_ORDER_INVALID_CODE = 'TABLE_NUMBER_ORDER_INVALID'
/** §9 — code effective numbers are not strictly increasing in document order. */
export const CODE_NUMBER_ORDER_INVALID_CODE = 'CODE_NUMBER_ORDER_INVALID'
/** §9 — formula effective numbers are not strictly increasing in document order. */
export const FORMULA_NUMBER_ORDER_INVALID_CODE = 'FORMULA_NUMBER_ORDER_INVALID'
/** §9 — a section-scoped formula number's section ≠ the section it sits in. */
export const FORMULA_NUMBER_SECTION_MISMATCH_CODE = 'FORMULA_NUMBER_SECTION_MISMATCH'

/**
 * §9 — every NUMBER-INTEGRITY runtime code this producer can emit. The registry
 * ↔ producer gate mirrors this list exactly.
 */
export const NUMBER_INTEGRITY_DIAGNOSTIC_CODES: readonly string[] = [
  FIGURE_NUMBER_DUPLICATE_CODE,
  TABLE_NUMBER_DUPLICATE_CODE,
  CODE_NUMBER_DUPLICATE_CODE,
  FIGURE_NUMBER_ORDER_INVALID_CODE,
  TABLE_NUMBER_ORDER_INVALID_CODE,
  CODE_NUMBER_ORDER_INVALID_CODE,
  FORMULA_NUMBER_ORDER_INVALID_CODE,
  FORMULA_NUMBER_SECTION_MISMATCH_CODE,
]

/**
 * Capability Matrix V1 §6 — the CONSERVATIVE allow-list of every runtime
 * diagnostic code `computeDocumentDiagnostics` can emit. It exists so the
 * Registry ↔ Producer consistency gate is REAL (never vacuous): the capability
 * summary checks each produced code resolves to a registered family. Every
 * entry is mirrored by the registry; the capability test asserts the mapping.
 */
export const PRODUCED_DIAGNOSTIC_CODES: readonly string[] = [
  // document / strict / completeness
  DOCUMENT_EMPTY_CODE,
  SOURCE_UNAVAILABLE_CODE,
  'DOCUMENT_INACTIVE',
  'STRICT_FIRST_H1_LEADING_PARAGRAPH',
  'STRICT_FIRST_H1_LEADING_EMPTY_LINE',
  'STRICT_FIRST_H1_LEADING_EMPTY_BLOCK',
  'STRICT_FIRST_H1_LEADING_OTHER_HEADING',
  'STRICT_FIRST_H1_LEADING_OTHER_BLOCK',
  'STRICT_FIRST_H1_DOCUMENT_EMPTY',
  'STRICT_FIRST_H1_SOURCE_UNAVAILABLE',
  'STRICT_SINGLE_H1_NO_H1',
  'STRICT_SINGLE_H1_MULTIPLE_H1',
  DOCUMENT_HEADING_ONLY_NO_BODY_CODE,
  DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE,
  SECTION_EMPTY_CODE,
  SECTION_ONLY_SUBHEADINGS_CODE,
  HEADING_AUTO_NUMBER_CONFLICT_CODE,
  HEADING_MANUAL_NUMBER_PREFIX_CODE,
  'DOCUMENT_TERMINAL_NEWLINE_MISSING',
  'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE',
  EXCESSIVE_INTERNAL_BLANK_LINES_CODE,
  // latent ATX (LEVEL_n — one representative per emitted level 1..6)
  'LATENT_ATX_HEADING_MARKER_LEVEL_1',
  'LATENT_ATX_HEADING_MARKER_LEVEL_2',
  'LATENT_ATX_HEADING_MARKER_LEVEL_3',
  'LATENT_ATX_HEADING_MARKER_LEVEL_4',
  'LATENT_ATX_HEADING_MARKER_LEVEL_5',
  'LATENT_ATX_HEADING_MARKER_LEVEL_6',
  // heading structure
  'HEADING_DUPLICATE_IDENTITY',
  'HEADING_DUPLICATE_TEXT',
  'HEADING_EMPTY_TEXT',
  'HEADING_LEVEL_GAP',
  // figure
  FIGURE_BLOCK_STRUCTURE_INVALID_CODE,
  'FIGURE_DUPLICATE_NAME',
  'FIGURE_LOCAL_IMAGE_MISSING',
  'FIGURE_MISSING_NAME',
  FIGURE_MANUAL_NUMBER_PREFIX_CODE,
  // table
  TABLE_BLOCK_STRUCTURE_INVALID_CODE,
  'TABLE_DUPLICATE_NAME',
  'TABLE_MISSING_NAME',
  TABLE_EMPTY_CONTENT_CODE,
  TABLE_MANUAL_NUMBER_PREFIX_CODE,
  // code
  CODE_EMPTY_BLOCK_CODE,
  'CODE_DUPLICATE_NAME',
  'CODE_MISSING_NAME',
  'CODE_MISSING_LANGUAGE',
  CODE_MANUAL_NUMBER_PREFIX_CODE,
  // formula
  FORMULA_BLOCK_STRUCTURE_INVALID_CODE,
  'FORMULA_DUPLICATE_VISIBLE_TAG',
  FORMULA_EMPTY_CONTENT_CODE,
  // blockquote
  BLOCKQUOTE_EMPTY_CODE,
  // link
  'LINK_LOCAL_TARGET_MISSING',
  LINK_LOCAL_ANCHOR_MISSING_CODE,
  // heading
  HEADING_ANCHOR_COLLISION_CODE,
  // Phase G — DOM-side Caption Integrity (produced by
  // `computeCaptionIntegrityDiagnostics`, merged into the SAME snapshot).
  ...CAPTION_INTEGRITY_DIAGNOSTIC_CODES,
  // Numbering Integrity V2 (spec §9) — the object / formula NUMBER rules.
  ...NUMBER_INTEGRITY_DIAGNOSTIC_CODES,
  // TRAE V3 — Source Syntax / Footnote / Reference / Front Matter / Table header
  // / Empty-link integrity (13 codes; FRONTMATTER_MALFORMED stays DEFERRED).
  ...SOURCE_INTEGRITY_DIAGNOSTIC_CODES,
]

/**
 * Phase G §8 — merge the source-only diagnostics with the DOM-side diagnostics
 * (caption integrity) into ONE deduplicated list + honest severity counts. The
 * base order is preserved; an id emitted twice keeps its FIRST occurrence.
 */
export function mergeDocumentDiagnostics(
  base: readonly DocumentDiagnostic[],
  extra: readonly DocumentDiagnostic[],
): DocumentDiagnosticsComputed {
  const seen = new Set<string>()
  const diagnostics: DocumentDiagnostic[] = []
  for (const d of base) {
    if (seen.has(d.id)) continue
    seen.add(d.id)
    diagnostics.push(d)
  }
  for (const d of extra) {
    if (seen.has(d.id)) continue
    seen.add(d.id)
    diagnostics.push(d)
  }
  let errorCount = 0
  let warningCount = 0
  let infoCount = 0
  for (const d of diagnostics) {
    if (d.severity === 'error') errorCount++
    else if (d.severity === 'warning') warningCount++
    else infoCount++
  }
  return { diagnostics, errorCount, warningCount, infoCount }
}

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

/**
 * V1 §5/§6/§7/§8/§9 — "substantive non-heading content" authority for the
 * `DOCUMENT_HEADING_ONLY_NO_BODY` hint (one boolean, no completeness score).
 *
 * SOURCE-based and canonical-heading-authority-driven: a source line counts as
 * body content only when it is NOT blank and NOT owned by a canonical heading.
 * The heading line numbers come from the canonical heading elements' Typora
 * `data-line` — the SAME authority the latent-ATX scanner consumes — so this is
 * never a second Markdown heading parser. An ATX-looking line inside a fenced
 * code block, an escaped `\#`, or `#text` is simply NOT a canonical heading
 * line and therefore stays "body content" (which is exactly what Typora
 * renders). Plugin-injected DOM can never participate: the decision reads the
 * SOURCE, never the rendered node count (§8).
 *
 * A setext heading's underline line (`===` / `---` directly beneath the heading
 * text) belongs to the heading above it, so it is not body content either.
 */
export function hasSubstantiveNonHeadingContent(
  markdown: string | null | undefined,
  canonicalHeadingSourceLines: ReadonlySet<number>,
): boolean {
  if (markdown == null) return false
  const lines = markdown.split('\n')
  let previousLineWasHeading = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    // §7 — blank lines / pure whitespace are never body content.
    if (line.trim() === '') {
      previousLineWasHeading = false
      continue
    }
    if (canonicalHeadingSourceLines.has(i)) {
      previousLineWasHeading = true
      continue
    }
    if (previousLineWasHeading && /^\s{0,3}(?:=+|-+)\s*$/.test(line)) {
      previousLineWasHeading = false
      continue
    }
    // §6/§24 — paragraph / list / blockquote / code / table / image / formula:
    // any non-blank source line that no canonical heading owns is substantive.
    return true
  }
  return false
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

/**
 * Phase I §10 — does a `#target` resolve to a canonical heading anchor? The
 * anchor authority is Typora's rendered heading id (raw), with a bounded
 * percent-decode attempt (Typora may encode a non-ASCII anchor in the href).
 * No slugifier, no guessing: an unknown target is simply NOT a heading anchor.
 */
function matchesCanonicalHeadingAnchor(
  target: string,
  anchors: ReadonlyMap<string, readonly DiagnosticHeadingFact[]>,
): boolean {
  if (target === '') return false
  if (anchors.has(target)) return true
  let decoded = target
  try {
    decoded = decodeURIComponent(target)
  } catch {
    return false
  }
  return decoded !== target && anchors.has(decoded)
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
     * V5.12-R6 §9 — publish an explicitly NON-LOCATABLE document notice (no
     * location at all). Only the empty-document terminal `DOCUMENT_EMPTY` uses
     * this: there is no source target to scroll to, so a derived
     * `document-start` target would be a fake locator.
     */
    nonLocatableNotice?: boolean
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
  // VNext §9/§10/§11 — the RULE REGISTRY is the ONE metadata authority. Every
  // published record is stamped with the rule's scope + presentation so a
  // consumer never has to special-case a rule code.
  const ruleMeta = getRuleMeta(code)
  const metadata: Record<string, unknown> | undefined = ruleMeta == null && opts.metadata == null
    ? undefined
    : {
        ...(opts.metadata ?? {}),
        scope: opts.metadata?.['scope'] ?? ruleMeta?.scope,
        reasonChip: opts.metadata?.['reasonChip'] ?? ruleMeta?.presentation.reasonChip,
        passiveVisual: opts.metadata?.['passiveVisual'] ?? ruleMeta?.presentation.passiveVisual,
        activeVisual: opts.metadata?.['activeVisual'] ?? ruleMeta?.presentation.activeVisual,
        area: opts.metadata?.['area'] ?? ruleMeta?.area,
      }
  return {
    // §11 — WHOSE problem this is. The document authority only ever produces
    // the document domain; runtime integrity is a separate model.
    domain: 'document',
    id: `${category}:${code}:${targetIdentity || Math.random().toString(36).slice(2, 8)}`,
    documentKey: input.documentKey ?? '',
    severity,
    category,
    code,
    message,
    detail: opts.detail,
    stableIdentity: opts.stableIdentity,
    targetIdentity: targetIdentity || undefined,
    metadata,
    validityFingerprint: opts.validityFingerprint,
    locator,
    // V5.12-R6 §9 — a declared non-locatable notice carries NO location.
    location: opts.nonLocatableNotice === true ? undefined : (opts.location ?? deriveDefaultLocation(category, opts)),
    nonLocatableNotice: opts.nonLocatableNotice === true ? true : undefined,
  }
}

/**
 * V5.12-R6 §9 — the ONE diagnostic an empty document publishes.
 *
 * `severity = info`, `code = DOCUMENT_EMPTY`, message/detail keep the existing
 * user-facing copy. `locatable = false` (§9): no location, no fake source
 * target — clicking it must never scroll to an H1 / paragraph / EOF.
 */
function createDocumentEmptyDiagnostic(input: DocumentDiagnosticsInput): DocumentDiagnostic {
  return makeDiagnostic(input, 'document', DOCUMENT_EMPTY_CODE, '文档为空', {
    detail: '当前文档没有内容。',
    kind: 'document',
    nonLocatableNotice: true,
  })
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

// ── Numbering Integrity V2 (spec §9/§21) — pure effective-number helpers ─────

/** ONE object's canonical effective-number fact, keyed by its SOURCE identity. */
interface ObjectNumberEntry {
  sourceIdentity: string
  effectiveNumber: string
  sectionNumber?: string
  actualSectionNumber?: string
  element: HTMLElement | null
}

/**
 * §9 — parse a CANONICAL effective number (a numbering-authority fact, never
 * rendered text) into comparable integer components. Returns null for a value
 * the canonical ordering cannot judge (e.g. a Roman numeral) — the caller then
 * never reports an order violation for that step (no false positive).
 */
function parseEffectiveNumberComponents(value: string): number[] | null {
  if (value === '') return null
  const parts = value.split('.')
  const out: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    out.push(Number.parseInt(part, 10))
  }
  return out.length > 0 ? out : null
}

/** §9 — lexical numeric comparison of two component vectors, shorter padded 0. */
function compareEffectiveNumberComponents(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

interface ObjectNumberKindMeta {
  category: DocumentDiagnosticCategory
  duplicateCode: string
  orderCode: string
  label: string
}

const OBJECT_NUMBER_KIND_META: Readonly<Record<'figure' | 'table' | 'code', ObjectNumberKindMeta>> = {
  figure: { category: 'figure', duplicateCode: FIGURE_NUMBER_DUPLICATE_CODE, orderCode: FIGURE_NUMBER_ORDER_INVALID_CODE, label: '图片' },
  table: { category: 'table', duplicateCode: TABLE_NUMBER_DUPLICATE_CODE, orderCode: TABLE_NUMBER_ORDER_INVALID_CODE, label: '表格' },
  code: { category: 'code', duplicateCode: CODE_NUMBER_DUPLICATE_CODE, orderCode: CODE_NUMBER_ORDER_INVALID_CODE, label: '代码块' },
}

/**
 * §9/§21 — the object / formula NUMBER-INTEGRITY producer. It consumes ONLY the
 * canonical effective-number snapshot (`input.objectEffectiveNumbers`); when the
 * snapshot is absent / disabled / empty EVERY rule stays silent (zero output).
 * Every emitted id derives from the object's SOURCE identity — never from the
 * generated number — so a Chinese / Decimal / Roman style switch never churns
 * an id.
 */
function emitObjectNumberIntegrity(
  input: DocumentDiagnosticsInput,
  emit: (d: DocumentDiagnostic) => void,
): void {
  const snapshot = input.objectEffectiveNumbers
  if (!snapshot || !snapshot.numberingEnabled) return
  const bySource = snapshot.bySourceIdentity
  if (!bySource || bySource.size === 0) return

  const collect = (
    facts: readonly { element: HTMLElement | null; targetIdentity?: string }[],
  ): { entries: ObjectNumberEntry[]; complete: boolean } => {
    const entries: ObjectNumberEntry[] = []
    let complete = true
    for (const f of facts) {
      const id = f.targetIdentity
      if (!id) { complete = false; continue }
      const fact = bySource.get(id)
      if (!fact) { complete = false; continue }
      entries.push({
        sourceIdentity: id,
        effectiveNumber: fact.effectiveNumber,
        sectionNumber: fact.sectionNumber,
        actualSectionNumber: fact.actualSectionNumber,
        element: f.element,
      })
    }
    return { entries, complete }
  }

  const emitDuplicates = (
    kind: 'figure' | 'table' | 'code',
    entries: readonly ObjectNumberEntry[],
  ): void => {
    const meta = OBJECT_NUMBER_KIND_META[kind]
    const groups = new Map<string, ObjectNumberEntry[]>()
    for (const e of entries) {
      const list = groups.get(e.effectiveNumber)
      if (list) list.push(e)
      else groups.set(e.effectiveNumber, [e])
    }
    for (const [number, group] of groups) {
      if (group.length <= 1) continue
      const anchor = group[0]
      const targets: DiagnosticLocation[] = group.map(g => ({
        kind: 'block-node',
        blockKind: kind,
        stableIdentity: g.sourceIdentity,
      }))
      emit(makeDiagnostic(input, meta.category, meta.duplicateCode, `${meta.label}编号重复：${number}`, {
        detail: `多个${meta.label}解析出了相同的有效编号，编号应当唯一。`,
        targetIdentity: anchor.sourceIdentity,
        element: anchor.element,
        kind: 'object',
        metadata: {
          ruleId: meta.duplicateCode,
          reason: 'OBJECT_NUMBER_DUPLICATE',
          effectiveNumber: number,
          memberCount: group.length,
        },
        location: { kind: 'target-group', scrollAnchor: targets[0], targets },
      }))
    }
  }

  const emitOrder = (
    category: 'figure' | 'table' | 'code' | 'formula',
    orderCode: string,
    label: string,
    entries: readonly ObjectNumberEntry[],
    complete: boolean,
  ): void => {
    // Order is only judgeable when EVERY object of the type carries a canonical
    // fact — a partial snapshot would produce a false "not increasing" verdict.
    if (!complete || entries.length < 2) return
    let prev: number[] | null = null
    for (const e of entries) {
      const comps = parseEffectiveNumberComponents(e.effectiveNumber)
      if (!comps) { prev = null; continue }
      if (prev && compareEffectiveNumberComponents(prev, comps) >= 0) {
        emit(makeDiagnostic(input, category, orderCode, `${label}编号顺序异常：${e.effectiveNumber}`, {
          detail: `${label}的有效编号在文档顺序中不是严格递增的。`,
          targetIdentity: e.sourceIdentity,
          element: e.element,
          kind: 'object',
          metadata: {
            ruleId: orderCode,
            reason: 'OBJECT_NUMBER_ORDER_INVALID',
            effectiveNumber: e.effectiveNumber,
          },
          location: { kind: 'block-node', blockKind: category, stableIdentity: e.sourceIdentity },
        }))
      }
      prev = comps
    }
  }

  const figureScan = collect(input.figures)
  if (figureScan.entries.length > 0) {
    emitDuplicates('figure', figureScan.entries)
    emitOrder('figure', FIGURE_NUMBER_ORDER_INVALID_CODE, OBJECT_NUMBER_KIND_META.figure.label, figureScan.entries, figureScan.complete)
  }
  const tableScan = collect(input.tables)
  if (tableScan.entries.length > 0) {
    emitDuplicates('table', tableScan.entries)
    emitOrder('table', TABLE_NUMBER_ORDER_INVALID_CODE, OBJECT_NUMBER_KIND_META.table.label, tableScan.entries, tableScan.complete)
  }
  const codeScan = collect(input.codes)
  if (codeScan.entries.length > 0) {
    emitDuplicates('code', codeScan.entries)
    emitOrder('code', CODE_NUMBER_ORDER_INVALID_CODE, OBJECT_NUMBER_KIND_META.code.label, codeScan.entries, codeScan.complete)
  }

  const formulaScan = collect(input.formulas)
  if (formulaScan.entries.length > 0) {
    emitOrder('formula', FORMULA_NUMBER_ORDER_INVALID_CODE, '公式', formulaScan.entries, formulaScan.complete)
    // §9 — FORMULA_NUMBER_SECTION_MISMATCH fires ONLY for a SECTION-scoped
    // number (sectionNumber present); a non-section mode never invents one.
    for (const e of formulaScan.entries) {
      if (e.sectionNumber == null || e.actualSectionNumber == null) continue
      if (e.sectionNumber === e.actualSectionNumber) continue
      emit(makeDiagnostic(input, 'formula', FORMULA_NUMBER_SECTION_MISMATCH_CODE,
        `公式编号章节不一致：${e.effectiveNumber}`, {
        detail: '公式编号所使用的章节号与该公式实际所在章节不一致。',
        targetIdentity: e.sourceIdentity,
        element: e.element,
        kind: 'formula',
        metadata: {
          ruleId: FORMULA_NUMBER_SECTION_MISMATCH_CODE,
          reason: 'FORMULA_NUMBER_SECTION_MISMATCH',
          effectiveNumber: e.effectiveNumber,
          numberSection: e.sectionNumber,
          actualSection: e.actualSectionNumber,
        },
        location: { kind: 'block-node', blockKind: 'formula', stableIdentity: e.sourceIdentity },
      }))
    }
  }
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
 * V5.12-R5 §5/§8.2 — SOURCE-side occurrence ordinals for duplicate resources.
 *
 * Computed ONCE from the Markdown facts (never from the DOM):
 *   - `rawLineOrdinal`   — ordinal of this occurrence's SOURCE LINE among the
 *                          occurrences sharing the same normalized raw line
 *                          (Typora renders one block per source line, so this
 *                          selects the owning block without any DOM guessing);
 *   - `occurrenceWithinLine` — ordinal of this occurrence among the same-line
 *                          occurrences of the SAME (resourceKind, canonical
 *                          destination) group (selects the token in the block).
 *
 * These two are the ONLY duplicate disambiguation inputs. `occurrenceIndex`
 * alone is never a location identity.
 */
export function computeSourceOccurrenceOrdinals(
  links: readonly {
    resourceKind?: 'image' | 'link'
    target: string
    rawText?: string
    startLine?: number
    semanticDestination?: string
  }[],
): Array<{ rawLineOrdinal: number; occurrenceWithinLine: number }> {
  const out = links.map(() => ({ rawLineOrdinal: 0, occurrenceWithinLine: 0 }))
  const nextBlockOrdinalByText = new Map<string, number>()
  const blockOrdinalByLine = new Map<string, number>()
  const nextWithinLine = new Map<string, number>()
  for (let i = 0; i < links.length; i++) {
    const l = links[i]
    if (l.resourceKind !== 'image') continue
    if (!isLocalRelativePath(l.target)) continue
    const lineText = normalizeSourceAnchorText(l.rawText ?? '')
    const lineKey = `${lineText}\u0000${l.startLine ?? -1}`
    let blockOrdinal = blockOrdinalByLine.get(lineKey)
    if (blockOrdinal == null) {
      blockOrdinal = nextBlockOrdinalByText.get(lineText) ?? 0
      nextBlockOrdinalByText.set(lineText, blockOrdinal + 1)
      blockOrdinalByLine.set(lineKey, blockOrdinal)
    }
    const group = `${lineKey}\u0000${normalizeResourceToken(l.semanticDestination || l.target)}`
    const within = nextWithinLine.get(group) ?? 0
    nextWithinLine.set(group, within + 1)
    out[i] = { rawLineOrdinal: blockOrdinal, occurrenceWithinLine: within }
  }
  return out
}

/**
 * Phase 7R.3.11.8B.7.3 — occurrence ordinal (0-based) of `factIndex` within the
 * facts whose destination equals `target`. Occurrence-aware identity for
 * diagnostics AND for the locator's resource semantic resolution.
 */
export function linkOccurrenceIndex(
  links: readonly { target: string; resourceKind?: 'image' | 'link'; semanticDestination?: string }[],
  target: string,
  factIndex: number,
  resourceKind?: 'image' | 'link',
  canonicalDestination?: string | null,
): number {
  // V5.12-R5 §6 — the occurrence GROUP is (resourceKind + canonicalDestination),
  // never the raw destination alone: `image same.png` and `link same.png` are
  // DIFFERENT groups and must never share an occurrence ordinal.
  const keyOf = (l: { target: string; resourceKind?: 'image' | 'link'; semanticDestination?: string }): string =>
    `${l.resourceKind ?? 'link'}\u0000${normalizeResourceToken(l.semanticDestination || l.target)}`
  const self = `${resourceKind ?? 'link'}\u0000${normalizeResourceToken(canonicalDestination || target)}`
  let occurrence = 0
  for (let i = 0; i < factIndex && i < links.length; i++) {
    if (keyOf(links[i]) === self) occurrence++
  }
  return occurrence
}

/**
 * V5.12-R8 §4 — build the UNIFIED Figure Source Occurrences from the SINGLE
 * scanner output. Every occurrence gets its full-token range, its
 * destination/path range, the occurrence ordinal (grouped by resourceKind +
 * canonical destination) and the source-range identity of the FULL TOKEN.
 *
 * Pure: the caller supplies the canonical-destination resolver and the local
 * file existence check (the only effects).
 */
export function buildFigureSourceOccurrences(input: {
  scanned: readonly ImageSourceOccurrence[]
  documentKey: string | null
  resolveCanonicalDestination: (rawDestination: string, isLocal: boolean) => string
  isLocalFileMissing: (rawDestination: string) => boolean
}): FigureSourceOccurrence[] {
  const ordinalInputs = input.scanned.map(img => ({
    resourceKind: 'image' as const,
    target: img.rawDestination,
    rawText: img.rawText,
    startLine: img.startLine,
    semanticDestination: input.resolveCanonicalDestination(img.rawDestination, img.isLocal),
  }))
  const ordinals = computeSourceOccurrenceOrdinals(ordinalInputs)
  return input.scanned.map((img, i) => {
    const canonicalDestination = ordinalInputs[i].semanticDestination
    const occurrenceIndex = linkOccurrenceIndex(ordinalInputs, img.rawDestination, i, 'image', canonicalDestination)
    return {
      rawToken: img.rawToken,
      rawDestination: img.rawDestination,
      altText: img.altText,
      resourceClass: img.resourceClass,
      isLocal: img.isLocal,
      tokenStart: img.tokenStart,
      tokenEnd: img.tokenEnd,
      destinationStart: img.destinationStart,
      destinationEnd: img.destinationEnd,
      startLine: img.startLine,
      endLine: img.endLine,
      startColumn: img.startColumn,
      endColumn: img.endColumn,
      rawText: img.rawText,
      canonicalDestination,
      occurrenceIndex,
      rawLineOrdinal: ordinals[i]?.rawLineOrdinal ?? 0,
      occurrenceWithinLine: ordinals[i]?.occurrenceWithinLine ?? 0,
      localFileExists: img.isLocal ? !input.isLocalFileMissing(img.rawDestination) : null,
      sourceRangeIdentity: buildSourceRangeIdentity({
        documentKey: input.documentKey,
        sourceRevision: null,
        resourceKind: 'image',
        canonicalDestination,
        sourceStart: img.tokenStart,
        sourceEnd: img.tokenEnd,
        occurrenceIndex,
      }),
    }
  })
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
/**
 * TRAE V3 §1–§6/§7 — Source Syntax / Footnote / Reference-link / Front Matter /
 * Table-header / Empty-link integrity. ONE emitter that consumes the THREE
 * shared source authorities; it NEVER re-scans the document itself.
 */
function sourceRangeTarget(
  markdown: string,
  startLine: number,
  sourceStart: number,
  sourceEnd: number,
  startColumn = 0,
): DiagnosticLocation {
  return {
    kind: 'source-range',
    startLine,
    startColumn,
    rawText: lineTextAt(markdown, startLine),
    sourceStart,
    sourceEnd,
  }
}

/**
 * TRAE V4 §3/§4 — the ONE source-syntax opener locator. It carries the canonical
 * opener identity (never a bare line), the THREE separated ranges, and the
 * source generation. The producer NEVER stores only `line=N`.
 */
function sourceSyntaxOpenerTarget(
  markdown: string,
  syntaxKind: SourceSyntaxKind,
  sourceLine: number,
  openerIdentity: string,
  locationRange: { start: number; end: number },
  protectedRange: { start: number; end: number },
  sourceRevision: number | null | undefined,
): DiagnosticLocation {
  return {
    kind: 'source-syntax-opener',
    syntaxKind,
    sourceLine,
    sourceStartOffset: locationRange.start,
    sourceEndOffset: locationRange.end,
    openerText: lineTextAt(markdown, sourceLine),
    openerIdentity,
    sourceRevision: sourceRevision ?? null,
    protectedRange,
    presentationRange: locationRange,
  }
}

function groupTargetLocations(
  markdown: string,
  occurrences: ReadonlyArray<{ startLine: number; sourceStart: number; sourceEnd: number }>,
): DiagnosticLocation[] {
  return occurrences.map(o => sourceRangeTarget(markdown, o.startLine, o.sourceStart, o.sourceEnd))
}

function pushIntoMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function emitSourceSyntaxIntegrity(
  input: DocumentDiagnosticsInput,
  push: (d: DocumentDiagnostic) => void,
): void {
  if (input.markdown == null || input.documentKey == null || input.markdown.trim() === '') return
  const markdown = input.markdown
  const documentKey = input.documentKey
  const syntax = getDocumentSourceSyntaxSnapshot(documentKey, markdown, input.sourceRevision)
  const refIndex = getDocumentDefinitionReferenceIndex(documentKey, markdown, input.sourceRevision, syntax)
  const inlineLinks = getDocumentInlineLinkAuthority(documentKey, markdown, input.sourceRevision, syntax)
  const tables: SourceTableStructure[] = parseDocumentSourceTables(markdown, syntax)

  // §1.1 — an unclosed code fence (the opener is the SINGLE target).
  for (const fence of syntax.codeFences) {
    if (fence.closed) continue
    const label = fence.fenceKind === 'backtick' ? '```' : '~~~'
    const identity = `${documentKey}:${fence.openerIdentity}`
    push(makeDiagnostic(input, 'code', CODE_FENCE_UNCLOSED_CODE,
      `代码块（${label}）未闭合，始于第 ${fence.openLine + 1} 行。`, {
      detail: '未闭合的代码围栏会把后续所有内容视为代码。',
      kind: 'object',
      stableIdentity: identity,
      targetIdentity: identity,
      location: sourceSyntaxOpenerTarget(
        markdown,
        'code-fence',
        fence.openLine,
        identity,
        { start: fence.openStart, end: fence.openEnd },
        { start: fence.protectedRange.start, end: fence.protectedRange.end },
        input.sourceRevision,
      ),
    }))
  }

  // §1.2 — an unclosed `$$` formula block (the opener is the SINGLE target).
  for (const formula of syntax.formulaBlocks) {
    if (formula.closed) continue
    const identity = `${documentKey}:${formula.openerIdentity}`
    push(makeDiagnostic(input, 'formula', FORMULA_BLOCK_UNCLOSED_CODE,
      `公式块（$$）未闭合，始于第 ${formula.openLine + 1} 行。`, {
      detail: '未闭合的 $$ 公式块会把后续内容视为公式。',
      kind: 'formula',
      stableIdentity: identity,
      targetIdentity: identity,
      location: sourceSyntaxOpenerTarget(
        markdown,
        'formula-block',
        formula.openLine,
        identity,
        { start: formula.openStart, end: formula.openStart + 2 },
        { start: formula.protectedRange.start, end: formula.protectedRange.end },
        input.sourceRevision,
      ),
    }))
  }

  // §4.1 — Front Matter unclosed (its opener is the target). FRONTMATTER_MALFORMED
  // is never emitted here: it is DEFERRED_BY_SPEC (no canonical YAML parser).
  const fm = syntax.frontMatter
  if (fm != null && !fm.closed) {
    push(makeDiagnostic(input, 'document', FRONTMATTER_UNCLOSED_CODE,
      'Front Matter 起始分隔符（---）未闭合。', {
      detail: '文档开头的 `---` 缺少结束分隔符，无法解析 Front Matter。',
      kind: 'document',
      stableIdentity: fm.identity,
      targetIdentity: fm.identity,
      location: sourceSyntaxOpenerTarget(
        markdown,
        'frontmatter',
        fm.openLine,
        fm.identity,
        { start: fm.protectedRange.start, end: fm.protectedRange.start + 3 },
        { start: fm.protectedRange.start, end: fm.protectedRange.end },
        input.sourceRevision,
      ),
    }))
  }

  // §2 — Footnote Integrity (ONE diagnostic per label; duplicate suppresses missing).
  const fnDefs = new Map<string, typeof refIndex.footnoteDefinitions[number][]>()
  for (const d of refIndex.footnoteDefinitions) pushIntoMap(fnDefs, d.label, d)
  const fnRefs = new Map<string, DefinitionReferenceOccurrence[]>()
  for (const r of refIndex.footnoteReferences) pushIntoMap(fnRefs, r.label, r)
  for (const label of new Set([...fnDefs.keys(), ...fnRefs.keys()])) {
    const defs = fnDefs.get(label) ?? []
    const refs = fnRefs.get(label) ?? []
    const identity = `${documentKey}:footnote:${label}`
    if (defs.length > 1) {
      push(makeDiagnostic(input, 'document', FOOTNOTE_DEFINITION_DUPLICATE_CODE,
        `脚注「${defs[0].rawLabel}」存在 ${defs.length} 个重复定义。`, {
        detail: '同一个脚注标签只能有一个定义。',
        stableIdentity: identity,
        targetIdentity: identity,
        location: { kind: 'target-group', scrollAnchor: groupTargetLocations(markdown, defs)[0], targets: groupTargetLocations(markdown, defs) },
      }))
    } else if (defs.length === 0 && refs.length > 0) {
      push(makeDiagnostic(input, 'document', FOOTNOTE_REFERENCE_TARGET_MISSING_CODE,
        `脚注引用「${refs[0].rawLabel}」缺少对应定义。`, {
        detail: '存在脚注引用，但没有 `[^label]: 内容` 定义。',
        stableIdentity: identity,
        targetIdentity: identity,
        location: { kind: 'target-group', scrollAnchor: groupTargetLocations(markdown, refs)[0], targets: groupTargetLocations(markdown, refs) },
      }))
    } else if (defs.length >= 1 && refs.length === 0) {
      push(makeDiagnostic(input, 'document', FOOTNOTE_DEFINITION_UNUSED_CODE,
        `脚注定义「${defs[0].rawLabel}」未被任何引用使用。`, {
        detail: '该脚注定义没有对应的正文引用。',
        stableIdentity: identity,
        targetIdentity: identity,
        location: sourceRangeTarget(markdown, defs[0].startLine, defs[0].sourceStart, defs[0].sourceEnd),
      }))
    }
    if (defs.length === 1 && defs[0].empty) {
      push(makeDiagnostic(input, 'document', FOOTNOTE_DEFINITION_EMPTY_CODE,
        `脚注定义「${defs[0].rawLabel}」内容为空。`, {
        detail: '该脚注定义没有任何内容（含续行）。',
        stableIdentity: identity,
        targetIdentity: identity,
        location: sourceRangeTarget(markdown, defs[0].startLine, defs[0].sourceStart, defs[0].sourceEnd),
      }))
    }
  }

  // §3 — Reference-style Link Integrity (shares the SAME index as footnotes).
  const linkDefs = new Map<string, typeof refIndex.linkDefinitions[number][]>()
  for (const d of refIndex.linkDefinitions) pushIntoMap(linkDefs, d.label, d)
  const linkRefs = new Map<string, DefinitionReferenceOccurrence[]>()
  for (const r of refIndex.linkReferences) pushIntoMap(linkRefs, r.label, r)
  for (const label of new Set([...linkDefs.keys(), ...linkRefs.keys()])) {
    const defs = linkDefs.get(label) ?? []
    const refs = linkRefs.get(label) ?? []
    const identity = `${documentKey}:link-ref:${label}`
    if (defs.length > 1) {
      push(makeDiagnostic(input, 'link', LINK_REFERENCE_DEFINITION_DUPLICATE_CODE,
        `引用式链接定义「${defs[0].rawLabel}」存在 ${defs.length} 个重复定义。`, {
        detail: '同一个引用标签只能有一个链接定义。',
        stableIdentity: identity,
        targetIdentity: identity,
        location: { kind: 'target-group', scrollAnchor: groupTargetLocations(markdown, defs)[0], targets: groupTargetLocations(markdown, defs) },
      }))
    } else if (defs.length === 0 && refs.length > 0) {
      push(makeDiagnostic(input, 'link', LINK_REFERENCE_DEFINITION_MISSING_CODE,
        `引用式链接「${refs[0].rawLabel}」缺少对应定义。`, {
        detail: '存在 `[text][label]` 引用，但没有 `[label]: 目标` 定义。',
        stableIdentity: identity,
        targetIdentity: identity,
        location: { kind: 'target-group', scrollAnchor: groupTargetLocations(markdown, refs)[0], targets: groupTargetLocations(markdown, refs) },
      }))
    }
  }

  // §5 — Table Header Integrity (from the Source Table Structure authority).
  for (const table of tables) {
    const emptyCells = table.headerCells.filter(c => c.semantic === '')
    if (emptyCells.length > 0) {
      const targets = emptyCells.map(c => sourceRangeTarget(markdown, table.headerLine, c.start, c.end))
      const identity = `${documentKey}:${table.identity}:empty-header`
      push(makeDiagnostic(input, 'table', TABLE_HEADER_EMPTY_CODE,
        `表格存在 ${emptyCells.length} 个空的表头单元格。`, {
        detail: '表头单元格为空，建议补充列名。',
        stableIdentity: identity,
        targetIdentity: identity,
        location: { kind: 'target-group', scrollAnchor: targets[0], targets },
      }))
    }
    const bySemantic = new Map<string, typeof table.headerCells[number][]>()
    for (const cell of table.headerCells) {
      if (cell.semantic === '') continue
      pushIntoMap(bySemantic, cell.semantic, cell)
    }
    for (const [semantic, cells] of bySemantic) {
      if (cells.length < 2) continue
      const targets = cells.map(c => sourceRangeTarget(markdown, table.headerLine, c.start, c.end))
      const identity = `${documentKey}:${table.identity}:header:${semantic}`
      push(makeDiagnostic(input, 'table', TABLE_HEADER_DUPLICATE_CODE,
        `表格存在 ${cells.length} 个重复的表头「${semantic}」。`, {
        detail: '同一表头文字出现多次，请重命名以区分列。',
        stableIdentity: identity,
        targetIdentity: identity,
        location: { kind: 'target-group', scrollAnchor: targets[0], targets },
      }))
    }
  }

  // §6 — Empty Inline Link Integrity (images are EXCLUDED from LINK_TEXT_EMPTY).
  for (const link of inlineLinks) {
    if (link.isImage) continue
    const identity = `${documentKey}:${link.identity}`
    if (link.text.trim() === '') {
      push(makeDiagnostic(input, 'link', LINK_TEXT_EMPTY_CODE,
        '链接文本为空。', {
        detail: '`[](目标)` 没有可见的链接文字。',
        stableIdentity: identity,
        targetIdentity: identity,
        location: sourceRangeTarget(markdown, link.startLine, link.tokenStart, link.tokenEnd, link.startColumn),
      }))
    }
    if (link.target.trim() === '') {
      push(makeDiagnostic(input, 'link', LINK_TARGET_EMPTY_CODE,
        '链接目标为空。', {
        detail: '`[文字]()` 没有链接目标地址。',
        stableIdentity: identity,
        targetIdentity: identity,
        location: sourceRangeTarget(markdown, link.startLine, link.tokenStart, link.tokenEnd, link.startColumn),
      }))
    }
  }
}

export function computeDocumentDiagnostics(
  input: DocumentDiagnosticsInput,
): DocumentDiagnosticsComputed {
  // ── V5.12-R6 §2/§8 — SEMANTIC EMPTY DOCUMENT = TERMINAL SHORT-CIRCUIT ────
  // An empty (whitespace-only) Markdown source is a TERMINAL state of the whole
  // Document Diagnostics authority: NO content-level rule producer may run. The
  // snapshot published for an empty document is EXCLUSIVELY `[DOCUMENT_EMPTY]`.
  //
  // This is a pipeline short-circuit — never a UI filter, never a ruleId
  // blacklist, and never conflated with the `headingCount === 0` plain-body
  // exemption (a body-only document is NOT empty and keeps its exemption).
  // The cheap path also means: no heading scan / table scan / block scan /
  // resource scan / locator-fact construction for an empty document.
  if (input.documentKey != null && isSemanticallyEmptyDocument(input.markdown)) {
    return {
      diagnostics: [createDocumentEmptyDiagnostic(input)],
      errorCount: 0,
      warningCount: 0,
      infoCount: 1,
    }
  }

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

  // Phase 7R.3.11.8B.11 — PLAIN-BODY-ONLY exemption (the ONLY strict-H1
  // exemption). Strict heading norms are waived solely when the WHOLE document
  // is ordinary body text: canonical headingCount (H1..H6) === 0 AND there is
  // meaningful body content. This is a DOCUMENT SHAPE decision and is
  // independent of heading-policy enabled/configured/activationSource — a
  // legacy stored 'strict' mode must NOT keep plain-body docs complaining, and
  // the moment ANY heading appears (headingCount > 0) the exemption ends and
  // every strict heading rule resumes.
  const hasMeaningfulBody = input.markdown != null && input.markdown.trim() !== ''
  const canonicalHeadingCount = input.headings.length
  const plainBodyOnly = canonicalHeadingCount === 0 && hasMeaningfulBody
  const strictHeadingRulesActive = input.strictMode && !plainBodyOnly

  // ── Document-level ──────────────────────────────────
  if (input.documentKey == null || (input.markdown == null && input.headings.length === 0)) {
    // No active business document: NOT a scary plugin error.
    push(
      makeDiagnostic(input, 'document', 'DOCUMENT_INACTIVE', '当前没有活动文档', {
        detail: '打开一个 Markdown 文档后即可检查其结构。',
      }),
    )
  } else {
    // Phase 7R.3.11.8B.11 — first-H1 / pre-H1-body lint runs whenever strict
    // heading rules are active. It is naturally skipped for plain-body-only
    // docs (exemption above), so a headingless document never double-reports.
    if (strictHeadingRulesActive) {
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

    // ── Phase 7R.3.11.8-B/8B.11 — STRICT-SINGLE-H1 (strict heading rules
    //    active only; canonical frame authority). h1Facts === null means the
    //    heading frame is not committed yet → WAIT, never judge against a
    //    stale/empty frame; h1Facts === [] is a REAL zero-H1 doc.
    if (strictHeadingRulesActive && input.h1Facts != null) {
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

    // ── V1 §5/§10..§13 — DOCUMENT_HEADING_ONLY_NO_BODY (severity = hint) ─────
    // Document SHAPE hint: the document owns EXACTLY ONE canonical heading and
    // no substantive non-heading content whatsoever.
    //
    // TRIGGER (canonical):
    //   headingCount === 1
    //   && substantiveNonHeadingContentCount === 0
    //   && documentIsEmpty === false
    // `documentIsEmpty === false` is guaranteed structurally: the
    // SEMANTIC-EMPTY short-circuit at the top of this function RETURNS BEFORE
    // any content-level producer runs, so `DOCUMENT_EMPTY` and this hint can
    // never coexist (§13). `markdown != null` is required because "no body" is
    // not assertable without a source (a source-less document is the
    // DOCUMENT_SOURCE_UNAVAILABLE concern, not this one).
    //
    // Scope is deliberately EXACTLY ONE heading (§25): a multi-heading document
    // without body is a different rule and is not emitted here.
    // Deliberately NOT gated on strictMode (§32): an incomplete document is
    // equally incomplete in loose mode, and a coexisting higher-severity
    // strict-H1 diagnostic never swallows this hint.
    if (input.markdown != null && canonicalHeadingCount >= 1) {
      const primaryHeading = input.headings[0]
      // The heading's OWN source line is what makes the "no body" verdict
      // trustworthy: it is the line the body scan must exclude. Two canonical
      // authorities are reused (never a second heading parser): the Typora
      // `data-line` stamp and the ATX text-key safety net used by the
      // latent-ATX scanner.
      const headingOwnedLines = collectCanonicalHeadingOwnedLines(
        input.markdown,
        collectCanonicalHeadingSourceLines(input.headings.map(h => h.element)),
        collectCanonicalHeadingTextKeys(input.headings.map(h => ({ physicalLevel: h.level, text: h.text }))),
      )
      // No owned line ⇒ the canonical heading could not be located in the
      // source at all ⇒ the shape is UNVERIFIABLE. Stay silent: an unverifiable
      // verdict must never become a false positive.
      if (headingOwnedLines.size > 0 && !hasSubstantiveNonHeadingContent(input.markdown, headingOwnedLines)) {
        // §19 — stable identity comes from the canonical heading frame; the
        // canonical source line is the fallback anchor (never the heading TEXT).
        const stableIdentity = normalizeIdentity(primaryHeading?.stableIdentity)
        const sourceLine = primaryHeading?.element?.getAttribute?.('data-line')
        const lineNumber = sourceLine != null && sourceLine !== '' ? Number.parseInt(sourceLine, 10) : null
        const hasLineAnchor = lineNumber != null && Number.isInteger(lineNumber)
        if (canonicalHeadingCount === 1) {
        const targetIdentity = `heading-only:${stableIdentity !== ''
          ? stableIdentity
          : hasLineAnchor ? `line:${lineNumber}` : 'single'}`
        // §18 — the canonical target is the UNIQUE HEADING (never EOF / blank
        // body / toolbar / drawer).
        const location: DiagnosticLocation = stableIdentity !== ''
          ? { kind: 'canonical-node', nodeKind: 'heading', stableIdentity }
          : hasLineAnchor
            ? { kind: 'source-range', startLine: lineNumber as number, startColumn: 0 }
            : { kind: 'document-start' }
        push(
          makeDiagnostic(input, 'document', DOCUMENT_HEADING_ONLY_NO_BODY_CODE, '文档仅包含标题', {
            detail: '当前文档只有一个标题，尚未包含正文内容。',
            kind: 'heading',
            stableIdentity: stableIdentity || undefined,
            element: primaryHeading?.element ?? null,
            targetIdentity,
            metadata: {
              ruleId: 'DOCUMENT-HEADING-ONLY-NO-BODY',
              reason: 'HEADING_ONLY_NO_BODY',
              headingCount: canonicalHeadingCount,
              hasSubstantiveNonHeadingContent: false,
              scope: 'document',
              reasonChip: false,
            },
            // Reuses the EXISTING heading locator + Active State Machine V2 —
            // no second locator, no second interaction state machine.
            locator: primaryHeading?.element
              ? { kind: 'heading', targetElement: primaryHeading.element }
              : { kind: 'document', targetElement: null, action: 'GO_TOP' },
            location,
          }),
        )
        } else {
        // ── VNext §12/§13 — MULTI-HEADING document without body ────────────
        // STRICTLY mutually exclusive with the single-heading hint above (this
        // is an if/else on the SAME canonical heading count + the SAME bodyless
        // verdict → SINGLE_AND_MULTI_HEADING_ONLY_COEXIST_COUNT=0 by construction).
        //
        // VNext Presentation Closure V1.1 §3/§5/§7/§44 — the semantic target set
        // is EVERY canonical heading. Target Group V1 §4/§7 — it is ONE
        // `target-group` diagnostic: the FIRST heading is the scroll anchor and
        // the Drawer/locator identity anchor, while ALL headings are co-equal
        // members (ONE Drawer row, N active members — never 1/N occurrences).
        const multiTargetIdentity = `headings-only:${stableIdentity !== ''
          ? stableIdentity
          : hasLineAnchor ? `line:${lineNumber}` : 'multi'}`
        const multiTargets: DiagnosticLocation[] = input.headings.map(h => {
          if (h.stableIdentity) {
            return { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: h.stableIdentity }
          }
          const hLine = h.element?.getAttribute?.('data-line')
          if (hLine != null && hLine !== '') {
            const n = Number.parseInt(hLine, 10)
            if (Number.isInteger(n)) return { kind: 'source-range', startLine: n, startColumn: 0 }
          }
          return { kind: 'document-start' }
        })
        const groupAnchor: DiagnosticLocation = multiTargets[0] ?? { kind: 'document-start' }
        push(
          makeDiagnostic(input, 'document', DOCUMENT_HEADINGS_ONLY_NO_BODY_CODE, '文档只有标题结构', {
            detail: '当前文档包含多个标题，但尚未包含实际正文内容。',
            kind: 'heading',
            stableIdentity: stableIdentity || undefined,
            element: primaryHeading?.element ?? null,
            targetIdentity: multiTargetIdentity,
            metadata: {
              ruleId: 'DOCUMENT-HEADINGS-ONLY-NO-BODY',
              reason: 'HEADINGS_ONLY_NO_BODY',
              headingCount: canonicalHeadingCount,
              groupMemberCount: multiTargets.length,
              hasSubstantiveNonHeadingContent: false,
              scope: 'document',
              reasonChip: false,
            },
            // §8 — the scroll anchor + DOM locator stay the FIRST heading (the
            // existing heading locator; no second locator is introduced).
            locator: primaryHeading?.element
              ? { kind: 'heading', targetElement: primaryHeading.element }
              : { kind: 'document', targetElement: null, action: 'GO_TOP' },
            location: { kind: 'target-group', scrollAnchor: groupAnchor, targets: multiTargets },
          }),
        )
        }
      }

      // ── VNext §16/§17 — SECTION completeness ──────────────────────────────
      // Only emitted when the WHOLE document HAS body (a fully bodyless
      // document is already explained by the document-level hint above, so a
      // section hint would only repeat the same root cause). §16/§17 are
      // mutually exclusive per heading by construction.
      const completeness = analyzeDocumentCompleteness(
        input.markdown,
        input.headings.map(h => ({ level: h.level, text: h.text })),
        input.headings.map(h => h.element),
        headingOwnedLines,
      )
      if (completeness.verifiable && !completeness.bodyless) {
        for (const hint of completeness.sectionHints) {
          const heading = input.headings[hint.headingIndex]
          const hintIdentity = normalizeIdentity(heading?.stableIdentity)
          const hintLineText = lineTextAt(input.markdown, hint.startLine)
          const location: DiagnosticLocation = hintIdentity !== ''
            ? { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: hintIdentity }
            : {
                kind: 'source-range',
                startLine: hint.startLine,
                startColumn: 0,
                endLine: hint.endLine,
                rawText: hintLineText,
              }
          const isOnlySubheadings = hint.code === SECTION_ONLY_SUBHEADINGS_CODE
          push(
            makeDiagnostic(input, 'heading', hint.code,
              isOnlySubheadings ? '章节仅包含子标题' : '章节没有正文内容', {
              detail: isOnlySubheadings
                ? '当前章节下只有子标题，整个章节尚未包含实际正文内容。'
                : '当前标题到下一个同级或更高级标题之间没有正文内容。',
              kind: 'heading',
              stableIdentity: hintIdentity || undefined,
              element: heading?.element ?? null,
              targetIdentity: `section:${hintIdentity !== '' ? hintIdentity : `line:${hint.startLine}`}`,
              metadata: {
                ruleId: isOnlySubheadings ? 'SECTION-ONLY-SUBHEADINGS' : 'SECTION-EMPTY',
                reason: hint.code,
                headingLevel: heading?.level ?? null,
                sectionStartLine: hint.startLine,
                sectionEndLine: hint.endLine,
              },
              locator: heading?.element
                ? { kind: 'heading', targetElement: heading.element }
                : { kind: 'document', targetElement: null, action: 'GO_TOP' },
              location,
            }),
          )
        }
      }

      // ── Heading Auto-Number Conflict V1 §1/§2/§3/§5/§12/§13/§17/§18/§19 ───
      // ONE Error per heading:
      //   isAutoNumberingEffectiveForHeading(heading) === true   (§2/§4/§15 —
      //     the PER-HEADING effective policy, never the global switch)
      //   AND the CANONICAL MARKDOWN SOURCE heading carries a CONFIRMED manual
      //     number prefix (§5 — the rendered label / generated number is NEVER
      //     read, so the plugin can never report its own number).
      // §18 — every conflicting heading is an INDEPENDENT problem (never a
      // Target Group). §19 — the identity is document + code + heading stable
      // identity (never the auto number / style / value), so a renumber or a
      // numbering-style switch can never move the diagnosticId.
      const conflictedHeadingFacts = new Set<DiagnosticHeadingFact>()
      if (input.headingAutoNumbering?.enabled === true) {
        for (const heading of input.headings) {
          if (heading.autoNumberingEffective !== true) continue
          const prefix = resolveHeadingManualNumberPrefix(heading.text)
          if (prefix.status !== 'confirmed') continue
          conflictedHeadingFacts.add(heading)
          const identity = normalizeIdentity(heading.stableIdentity)
          const lineAttr = heading.element?.getAttribute?.('data-line')
          const lineNo = lineAttr != null && lineAttr !== '' ? Number.parseInt(lineAttr, 10) : null
          const hasLine = lineNo != null && Number.isInteger(lineNo)
          const location: DiagnosticLocation = identity !== ''
            ? { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: identity }
            : hasLine
              ? { kind: 'source-range', startLine: lineNo as number, startColumn: 0, rawText: heading.text }
              : { kind: 'document-start' }
          const detail = prefix.rawPrefix !== ''
            ? `当前标题已包含手工编号「${prefix.rawPrefix}」，同时启用了自动标题编号。请删除标题中的手工编号，或关闭该标题级别的自动编号。`
            : '当前标题已包含手工编号，同时启用了自动标题编号。请删除标题中的手工编号，或关闭该标题级别的自动编号。'
          push(
            makeDiagnostic(input, 'heading', HEADING_AUTO_NUMBER_CONFLICT_CODE, '标题编号冲突', {
              detail,
              kind: 'heading',
              stableIdentity: identity || undefined,
              element: heading.element,
              targetIdentity: `auto-number-conflict:${identity !== '' ? identity : hasLine ? `line:${lineNo}` : 'heading'}`,
              metadata: {
                ruleId: 'HEADING-AUTO-NUMBER-CONFLICT',
                reason: 'AUTO_NUMBER_CONFLICT',
                // §1 — the spec's own vocabulary for this rule family.
                ruleCategory: 'heading-numbering',
                headingLevel: heading.level,
                manualPrefixKind: prefix.kind,
                manualPrefixRaw: prefix.rawPrefix,
                manualPrefixStatus: prefix.status,
              },
              locator: heading.element
                ? { kind: 'heading', targetElement: heading.element }
                : { kind: 'document', targetElement: null, action: 'GO_TOP' },
              location,
            }),
          )
        }
      }

      // ── VNext §24 — HEADING manual number prefix ──────────────────────────
      // Only while heading auto-numbering is ON (otherwise a literal `1.` is
      // plain text — MANUAL_NUMBER_PREFIX_FALSE_POSITIVE_COUNT=0).
      // V1 §14/§43 — a heading that already raises the STRONGER
      // HEADING_AUTO_NUMBER_CONFLICT must NOT also raise this generic warning:
      // the two rules share ONE root cause, so the warning is suppressed for
      // exactly those headings (never for the whole document).
      if (input.numberingEnabled?.heading === true) {
        for (const heading of input.headings) {
          if (conflictedHeadingFacts.has(heading)) continue
          const match = detectManualNumberPrefix(heading.text)
          if (!match) continue
          const identity = normalizeIdentity(heading.stableIdentity)
          const lineAttr = heading.element?.getAttribute?.('data-line')
          const lineNo = lineAttr != null && lineAttr !== '' ? Number.parseInt(lineAttr, 10) : null
          const hasLine = lineNo != null && Number.isInteger(lineNo)
          const location: DiagnosticLocation = identity !== ''
            ? { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: identity }
            : hasLine
              ? { kind: 'source-range', startLine: lineNo as number, startColumn: 0, rawText: heading.text }
              : { kind: 'document-start' }
          push(
            makeDiagnostic(input, 'heading', HEADING_MANUAL_NUMBER_PREFIX_CODE,
              `标题文字包含手工编号「${match.matched}」`, {
              detail: '当前已开启标题自动编号，标题文字中的手工编号会与自动编号同时出现，建议删除手工编号。',
              kind: 'heading',
              stableIdentity: identity || undefined,
              element: heading.element,
              targetIdentity: `manual-number:${identity !== '' ? identity : hasLine ? `line:${lineNo}` : 'heading'}`,
              metadata: {
                ruleId: 'HEADING-MANUAL-NUMBER-PREFIX',
                reason: 'MANUAL_NUMBER_PREFIX',
                family: match.family,
                matched: match.matched,
              },
              locator: heading.element
                ? { kind: 'heading', targetElement: heading.element }
                : { kind: 'document', targetElement: null, action: 'GO_TOP' },
              location,
            }),
          )
        }
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
              // V5.13-R2 §7 — the EOF facts are carried on the diagnostic record so
              // the locate/visual/closure audits never re-derive them from the DOM.
              terminalNewlineCount: policy.terminalNewlineCount,
              extraTrailingBlankLineCount: policy.extraTrailingBlankLineCount,
            },
            locator: { kind: 'document', targetElement: null, action: 'GO_BOTTOM' },
            location: { kind: 'document-end' },
          }),
        )
      }
    }

    // ── Internal Blank-Line Policy V1 §1/§7/§8 — EXCESSIVE_INTERNAL_BLANK_LINES
    //    Source-only candidate scan: a run of blank lines BETWEEN two sibling
    //    content blocks. The block-gap authority itself already excludes
    //      · blank lines inside a fenced code block / display formula / front
    //        matter / HTML block (they are CONTENT — §12/§13/§14),
    //      · the leading run before the first block (§11),
    //      · the trailing EOF run (owned by the EOF rules above — §10),
    //      · a loose list / lazy blockquote interior (§15).
    //    ONE gap → ONE diagnostic: the stable identity is built from the two
    //    block identities, never from a line index or the blank count, so
    //    editing 3 → 4 → 5 → 6 blank lines keeps the SAME record (§20/§29).
    if (input.markdown != null) {
      for (const gap of analyzeInternalBlankLineGaps(input.markdown)) {
        const gapIdentity = internalBlankGapIdentity(gap)
        push(
          makeDiagnostic(input, 'document', EXCESSIVE_INTERNAL_BLANK_LINES_CODE, '连续空行过多', {
            detail: internalBlankLineDetail(gap.actualBlankLines),
            kind: 'document',
            targetIdentity: gapIdentity,
            metadata: {
              ruleId: EXCESSIVE_INTERNAL_BLANK_LINES_RULE_ID,
              // §1 — the rule's OWN category / scope vocabulary. `category` on
              // the record stays the legacy consumer grouping ('document').
              ruleCategory: 'document-format',
              scope: 'block-gap',
              reasonChip: false,
              passiveVisual: false,
              activeVisual: true,
              // §9/§33 — the block-gap facts travel on the record so the Drawer,
              // the locator and the audits never re-derive them.
              previousBlockIdentity: gap.previousBlockIdentity,
              previousBlockKind: gap.previousBlockKind,
              previousBlockStartLine: gap.previousBlockStartLine,
              previousBlockAnchorText: gap.previousBlockAnchorText,
              nextBlockIdentity: gap.nextBlockIdentity,
              nextBlockKind: gap.nextBlockKind,
              nextBlockStartLine: gap.nextBlockStartLine,
              nextBlockAnchorText: gap.nextBlockAnchorText,
              previousSourceEnd: gap.previousBlockSourceEnd,
              nextSourceStart: gap.nextBlockSourceStart,
              firstBlankLine: gap.firstBlankLine,
              lastBlankLine: gap.lastBlankLine,
              actualBlankLines: gap.actualBlankLines,
              passMaxBlankLines: INTERNAL_BLANK_LINE_POLICY.passMaxBlankLines,
              warningThreshold: INTERNAL_BLANK_LINE_POLICY.warningThreshold,
            },
            // §22/§23 — the blank area itself owns no DOM node. The scroll anchor
            // (and the active target) is the NEXT block: its proven VISIBLE text
            // is the verification anchor, so the click shows the block the excess
            // blanks precede. `source-range` never paints the whole blank band.
            location: {
              kind: 'source-range',
              startLine: gap.nextBlockStartLine,
              startColumn: 0,
              sourceFingerprint: `internal-blank:${gapIdentity}`,
              rawText: gap.nextBlockAnchorText,
            },
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

    // V5.12-R6 — the empty-document notice is published EXCLUSIVELY by the
    // terminal short-circuit at the head of this function; it is deliberately
    // NOT a peer diagnostic here (that was ROOT_R6_1/ROOT_R6_4).
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

  // ── V5.15 §6/§9 — STANDALONE OBJECT BLOCK INVARIANT (figure structure gate) ──
  // The gate runs BEFORE every normal figure business rule. An invalid owning
  // block never reaches figure numbering / naming / resource diagnostics: it
  // publishes exactly ONE merged structural ERROR instead (per owning block),
  // and the diagnostic itself stays locatable on the WHOLE owning block.
  const structureSourceText = typeof input.markdown === 'string' ? input.markdown : null
  const structureOccurrences = input.figureSourceOccurrences ?? null
  // V5.15 §18 — duplicate detection is scoped to THIS compute.
  beginFigureStructureDiagnosticPass()
  const figureStructureBlocks: FigureStandaloneSourceBlock[] =
    structureSourceText != null && structureOccurrences != null && structureOccurrences.length > 0
      ? analyzeFigureStandaloneSourceBlocks({
          source: structureSourceText,
          occurrences: structureOccurrences.map(o => ({ tokenStart: o.tokenStart, tokenEnd: o.tokenEnd })),
        })
      : []
  const invalidFigureTokenStarts = new Set<number>()
  const invalidFigureDestinations = new Set<string>()
  // §9 — 0-based ordinal among owning blocks carrying the SAME raw block text,
  // so two byte-identical invalid blocks never share a binding identity.
  const structureBlockOrdinalByText = new Map<string, number>()
  for (const block of figureStructureBlocks) {
    // §14 — an image token inside a fenced / indented code block is NOT an image
    // object at all: it sits outside the figure business model, so the standalone
    // structure gate never fires there (the DOM caption chain excludes code
    // containers the same way).
    if (block.containerKind === 'code') continue
    if (block.result.decision === 'VALID_STANDALONE_FIGURE') continue
    const blockOrdinal = structureBlockOrdinalByText.get(block.rawText) ?? 0
    structureBlockOrdinalByText.set(block.rawText, blockOrdinal + 1)
    for (const tokenStart of block.tokenStarts) invalidFigureTokenStarts.add(tokenStart)
    for (const occ of structureOccurrences ?? []) {
      if (!invalidFigureTokenStarts.has(occ.tokenStart)) continue
      const dest = normalizeResourceToken(occ.canonicalDestination || occ.rawDestination)
      if (dest) invalidFigureDestinations.add(dest)
    }
    const copy = figureStructureUserCopy(block.result)
    push(
      makeDiagnostic(input, 'figure', FIGURE_BLOCK_STRUCTURE_INVALID_CODE, copy.title, {
        detail: copy.detail,
        targetIdentity: `structure:${block.owningBlockIdentity}`,
        kind: 'object',
        metadata: {
          ruleId: 'FIGURE-BLOCK-STRUCTURE-INVALID',
          resourceKind: 'image',
          // §16/§17 — the standalone-object audit fields.
          owningBlockIdentity: block.owningBlockIdentity,
          sourceBlockIdentity: block.owningBlockIdentity,
          sourceBlockOrdinal: blockOrdinal,
          containerKind: block.containerKind,
          rawObjectCount: block.imageOccurrenceCount,
          canonicalObjectCount: 0,
          nonObjectSemanticContentCount: block.nonImageContentSummary.length,
          violations: block.result.violationCodes.join('|'),
          violationKinds: block.result.violations.join('|'),
          normalBusinessTargetAdmitted: false,
          structuralDiagnosticPublished: true,
          sourceStart: block.blockStart,
          sourceEnd: block.blockEnd,
          startLine: block.startLine,
          endLine: block.endLine,
        },
        // V1 §4/§5 — a BLOCK-level locator: the target is the WHOLE illegal
        // owning block. The structure rule must NEVER enter the inline
        // occurrence / duplicate-range resolver.
        location: {
          kind: 'source-block',
          objectKind: 'figure',
          sourceBlockIdentity: block.owningBlockIdentity,
          sourceBlockOrdinal: blockOrdinal,
          sourceStart: block.blockStart,
          sourceEnd: block.blockEnd,
          startLine: block.startLine,
          endLine: block.endLine,
          sourceRevision: input.sourceRevision ?? null,
          locatorStrategy: 'OWNING_BLOCK',
        },
      }),
    )
    noteFigureStructureDiagnosticPublished({
      owningBlockIdentity: block.owningBlockIdentity,
      violationCount: block.result.violations.length,
      locatable: Number.isFinite(block.startLine),
    })
  }

  // ── VNext §18/§19 — NON-STANDALONE table / display-formula blocks ─────────
  // The source parser PROVES the block is not standalone (a list / blockquote
  // marker is literally carried by the table's header/delimiter row or by the
  // display formula's `$$` line). Never inferred from DOM position and never
  // from a layout heuristic. Inline `$…$` math is never a display block.
  if (structureSourceText != null) {
    for (const span of analyzeTableBlocks(structureSourceText)) {
      push(
        makeDiagnostic(input, 'table', TABLE_BLOCK_STRUCTURE_INVALID_CODE,
          '表格必须作为独立块插入', {
          detail: '表格不能放在列表项或引用块中，请将表格移动到独立段落。',
          kind: 'object',
          targetIdentity: `table-structure:line:${span.startLine}`,
          metadata: {
            ruleId: 'TABLE-BLOCK-STRUCTURE-INVALID',
            reason: 'NON_STANDALONE_TABLE_BLOCK',
            containerKind: span.containerKind,
            startLine: span.startLine,
            endLine: span.endLine,
            sourceStart: span.sourceStart,
            sourceEnd: span.sourceEnd,
          },
          location: {
            kind: 'source-range',
            startLine: span.startLine,
            startColumn: span.startColumn,
            endLine: span.endLine,
            endColumn: span.endColumn,
            sourceStart: span.sourceStart,
            sourceEnd: span.sourceEnd,
            sourceFingerprint: `table-structure:${span.startLine}`,
            rawText: span.rawText,
          },
        }),
      )
    }
    for (const span of analyzeDisplayFormulaBlocks(structureSourceText)) {
      // A standalone display formula is VALID; an empty one belongs to §28.
      if (span.containerKind == null || span.empty) continue
      push(
        makeDiagnostic(input, 'formula', FORMULA_BLOCK_STRUCTURE_INVALID_CODE,
          '公式必须作为独立块插入', {
          detail: '独立公式不能放在列表项或引用块中，请将公式移动到独立段落。',
          kind: 'formula',
          targetIdentity: `formula-structure:line:${span.startLine}`,
          metadata: {
            ruleId: 'FORMULA-BLOCK-STRUCTURE-INVALID',
            reason: 'NON_STANDALONE_DISPLAY_FORMULA',
            containerKind: span.containerKind,
            startLine: span.startLine,
            endLine: span.endLine,
            sourceStart: span.sourceStart,
            sourceEnd: span.sourceEnd,
          },
          location: {
            kind: 'source-range',
            startLine: span.startLine,
            startColumn: span.startColumn,
            endLine: span.endLine,
            endColumn: span.endColumn,
            sourceStart: span.sourceStart,
            sourceEnd: span.sourceEnd,
            sourceFingerprint: `formula-structure:${span.startLine}`,
            rawText: span.rawText,
          },
        }),
      )
    }

    // ── VNext §28 — EMPTY source objects (hints only) ───────────────────────
    // §20 — the empty-formula hint NEVER touches the numbering system, so a
    // KNOWN_EMPTY formula keeps its number (EMPTY_FORMULA_NUMBERING_BLOCKED=0).
    const emptyObjects = analyzeEmptySourceObjects(structureSourceText)
    const pushEmpty = (
      kindCode: string,
      ruleId: string,
      message: string,
      detail: string,
      category: DocumentDiagnosticCategory,
      kind: 'object' | 'formula',
      identityPrefix: string,
      spans: readonly SourceBlockSpan[],
      canonicalBlockKind?: 'code',
    ): void => {
      for (const span of spans) {
        // TRAE V6 §6/§7 — an EMPTY container binds a CANONICAL BLOCK identity
        // (`block:<kind>:<ordinal>`), NEVER a bare line / caption / Nth-block
        // guess. The canonical block locator resolves the real DOM block.
        const canonicalBlockIdentity = canonicalBlockKind != null && typeof span.ordinal === 'number'
          ? `block:${canonicalBlockKind}:${span.ordinal}`
          : null
        push(
          makeDiagnostic(input, category, kindCode, message, {
            detail,
            kind,
            targetIdentity: canonicalBlockIdentity ?? `${identityPrefix}:line:${span.startLine}`,
            metadata: {
              ruleId,
              reason: 'EMPTY_SOURCE_OBJECT',
              // V6-R2 §2 — the SOURCE authority's emptiness verdict. The
              // presentation MUST trust this, never re-derive emptiness from the
              // DOM (Typora renders line numbers / CodeMirror scaffold).
              sourceSemanticEmpty: true,
              startLine: span.startLine,
              endLine: span.endLine,
              sourceStart: span.sourceStart,
              sourceEnd: span.sourceEnd,
              ...(canonicalBlockIdentity != null ? { canonicalBlockIdentity, blockKind: canonicalBlockKind } : {}),
            },
            location: canonicalBlockIdentity != null && canonicalBlockKind != null
              ? { kind: 'block-node', blockKind: canonicalBlockKind, stableIdentity: canonicalBlockIdentity }
              : {
                  kind: 'source-range',
                  startLine: span.startLine,
                  startColumn: span.startColumn,
                  endLine: span.endLine,
                  endColumn: span.endColumn,
                  sourceStart: span.sourceStart,
                  sourceEnd: span.sourceEnd,
                  sourceFingerprint: `${identityPrefix}:${span.startLine}`,
                  rawText: span.rawText,
                },
          }),
        )
      }
    }
    pushEmpty(CODE_EMPTY_BLOCK_CODE, 'CODE-EMPTY-BLOCK', '代码块为空', '当前代码块没有内容，建议删除或补充内容。', 'code', 'object', 'empty-code', emptyObjects.codeBlocks, 'code')
    for (const span of emptyObjects.tables) {
      push(
        makeDiagnostic(input, 'table', TABLE_EMPTY_CONTENT_CODE, '表格没有数据行', {
          detail: '当前表格只有表头，没有数据行。',
          kind: 'object',
          targetIdentity: `empty-table:line:${span.startLine}`,
          metadata: {
            ruleId: 'TABLE-EMPTY-CONTENT',
            reason: 'EMPTY_SOURCE_OBJECT',
            startLine: span.startLine,
            endLine: span.endLine,
            sourceStart: span.sourceStart,
            sourceEnd: span.sourceEnd,
          },
          location: {
            kind: 'source-range',
            startLine: span.startLine,
            startColumn: span.startColumn,
            endLine: span.endLine,
            endColumn: span.endColumn,
            sourceStart: span.sourceStart,
            sourceEnd: span.sourceEnd,
            sourceFingerprint: `empty-table:${span.startLine}`,
            rawText: span.rawText,
          },
        }),
      )
    }
    pushEmpty(FORMULA_EMPTY_CONTENT_CODE, 'FORMULA-EMPTY-CONTENT', '公式为空', '当前独立公式没有内容。', 'formula', 'formula', 'empty-formula', emptyObjects.formulas)
    pushEmpty(BLOCKQUOTE_EMPTY_CODE, 'BLOCKQUOTE-EMPTY', '引用块为空', '当前引用块没有内容。', 'document', 'object', 'empty-blockquote', emptyObjects.blockquotes)
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

  // ── V4 Missing-Image SOURCE-FIRST ─────────────────────
  // Missing-image diagnostics are produced from the Markdown SOURCE resource
  // facts (resourceKind === 'image') — NEVER gated on a live <img> existing
  // (Typora strips broken images, so a DOM-only scan can never see them).
  // Source = identity / location authority; DOM = rendered target / fallback.
  const sourceImageCovered = new Set<string>()
  // ── V5.12-R5 §5/§8.2 — source-side occurrence ordinals (never DOM-derived).
  const sourceOrdinals = computeSourceOccurrenceOrdinals(input.links)
  for (let linkIdx = 0; linkIdx < input.links.length; linkIdx++) {
    const l = input.links[linkIdx]
    if (l.resourceKind !== 'image') continue
    if (!isLocalRelativePath(l.target)) continue
    // V5.15 §6/§9 — an invalid owning block never reaches a normal figure rule.
    if (typeof l.sourceStart === 'number' && invalidFigureTokenStarts.has(l.sourceStart)) continue
    const occurrenceIndex = linkOccurrenceIndex(input.links, l.target, l.index, 'image', l.semanticDestination)
    const occurrenceLabel = occurrenceIndex > 0 ? `（第 ${occurrenceIndex + 1} 处）` : ''
    const semanticDestination = l.semanticDestination || normalizeResourceToken(l.target)
    const destKey = normalizeResourceToken(semanticDestination || l.target)
    if (destKey) sourceImageCovered.add(destKey)
    const tokenStart = typeof l.sourceStart === 'number' ? l.sourceStart : null
    const tokenEnd = typeof l.sourceEnd === 'number' ? l.sourceEnd : null
    const destStart = typeof l.destinationStart === 'number' ? l.destinationStart : null
    const destEnd = typeof l.destinationEnd === 'number' ? l.destinationEnd : null
    const rawToken = typeof l.rawToken === 'string' ? l.rawToken : null
    // V5.12-R8 §5/§7 — THIS rule targets the DESTINATION/PATH range. Legacy
    // facts without a destination span keep the previous (token) range AND no
    // range role, so no existing consumer changes behavior.
    const sourceStart = destStart ?? tokenStart
    const sourceEnd = destEnd ?? tokenEnd
    const rangeRole: 'figure-destination' | undefined = destStart != null && destEnd != null
      ? 'figure-destination'
      : undefined
    const startLine = typeof l.startLine === 'number' ? l.startLine : null
    const endLine = typeof l.endLine === 'number' ? l.endLine : null
    const startColumn = typeof l.startColumn === 'number' ? l.startColumn : null
    const endColumn = typeof l.endColumn === 'number' ? l.endColumn : null
    // V5.12-R5 §4 — the SOURCE RANGE IDENTITY is the location authority; it is
    // built from the source facts ONLY (never a DOM node / rect / scroll).
    const sourceRangeIdentity = sourceStart != null && sourceEnd != null
      ? buildSourceRangeIdentity({
          documentKey: input.documentKey,
          sourceRevision: null,
          resourceKind: 'image',
          canonicalDestination: destKey || l.target,
          sourceStart,
          sourceEnd,
          occurrenceIndex,
        })
      : null
    const ordinals = sourceOrdinals[linkIdx] ?? { rawLineOrdinal: 0, occurrenceWithinLine: 0 }
    const fingerprint = `${occurrenceIndex}:${startLine ?? -1}:${destKey || l.target}`
    // V1 §6/§9 — the owning source block identity (documentKey + revision +
    // span + block ordinal), never raw block text alone.
    const sourceBlockIdentity = buildSourceBlockIdentity(startLine ?? 0)
    const sourceBlockOrdinal = ordinals.rawLineOrdinal
    const occurrenceIdentity: DiagnosticFigureOccurrenceIdentity = {
      documentKey: input.documentKey ?? null,
      sourceRevision: input.sourceRevision ?? null,
      sourceBlockIdentity,
      sourceBlockOrdinal,
      tokenStart,
      tokenEnd,
      rawLineOrdinal: ordinals.rawLineOrdinal,
      occurrenceWithinLine: ordinals.occurrenceWithinLine,
      destination: destKey || l.target,
    }
    push(
      makeDiagnostic(input, 'figure', 'FIGURE_LOCAL_IMAGE_MISSING', `本地图片不存在：${l.target}${occurrenceLabel}`, {
        detail: '图片引用的本地文件无法解析。',
        element: null,
        targetIdentity: destKey ? `local:${destKey}${occurrenceIndex > 0 ? `:${occurrenceIndex + 1}` : ''}` : `local:${l.target}`,
        kind: 'object',
        metadata: {
          ruleId: 'FIGURE-LOCAL-IMAGE-MISSING',
          resourceKind: 'image',
          // V5.12-R8 §5 — the fixed range semantics for this rule.
          rangeRole,
          destination: semanticDestination,
          rawDestination: l.target,
          // V5.12-R5 §4/§5 — the full source occurrence fact travels intact.
          canonicalDestination: destKey || l.target,
          sourceRangeIdentity,
          occurrenceIndex,
          rawLineOrdinal: ordinals.rawLineOrdinal,
          occurrenceWithinLine: ordinals.occurrenceWithinLine,
          // V1 §6/§11 — the owning source block identity + its ordinal.
          sourceBlockIdentity,
          sourceBlockOrdinal,
          figureOccurrenceIdentity: buildFigureOccurrenceIdentity(occurrenceIdentity),
          // V5.12-R8 §4 — BOTH ranges travel on the same occurrence.
          sourceStart,
          sourceEnd,
          tokenStart,
          tokenEnd,
          destinationStart: destStart,
          destinationEnd: destEnd,
          rawToken,
          altText: typeof l.altText === 'string' ? l.altText : undefined,
          resourceClass: typeof l.resourceClass === 'string' ? l.resourceClass : 'local',
          localFileExists: false,
          startLine,
          endLine,
          startColumn,
          endColumn,
          rawText: l.rawText,
          sourceRevision: null,
          fingerprint,
        },
        // V1 §10/§12/§20 — an OCCURRENCE-level locator. When the <img> is not
        // rendered (broken local image) the resolver falls back to the owning
        // source block, so a missing image is NEVER unlocatable.
        location: startLine != null
          ? {
              kind: 'figure-occurrence',
              occurrenceIdentity,
              resourceKind: 'image',
              // V5.12-R8 §5 — FIGURE_LOCAL_IMAGE_MISSING → FIGURE_DESTINATION.
              rangeRole: rangeRole ?? 'figure-destination',
              startLine,
              startColumn: startColumn ?? 0,
              endLine: endLine ?? startLine,
              endColumn: endColumn ?? undefined,
              rawText: l.rawText,
              // V5.12-R5 §5 — the exact source range survives into the location.
              sourceStart,
              sourceEnd,
              sourceRangeIdentity,
              canonicalDestination: destKey || l.target,
              rawDestination: l.target,
              occurrenceIndex,
              rawLineOrdinal: ordinals.rawLineOrdinal,
              occurrenceWithinLine: ordinals.occurrenceWithinLine,
              rawToken: rawToken ?? undefined,
              tokenStart,
              tokenEnd,
              destinationStart: destStart,
              destinationEnd: destEnd,
            }
          : { kind: 'document-start' },
        validityFingerprint: { kind: 'resource', path: normalizeResourceToken(l.target), occurrence: occurrenceIndex },
      }),
    )
  }

  // ── V5.12-R8 §4/§8 — FIGURE_MISSING_NAME (SOURCE-FIRST) ────────────────
  // The figure name IS the Markdown alt text (ONE authority). When the unified
  // figure source occurrences are available the rule is produced from the
  // SOURCE, so:
  //   - a broken image (`![](a.png)`, no rendered <img>) still yields it, and
  //   - the click target is the WHOLE Markdown image token (`![](a.png)`),
  //     never the path and never the owning paragraph.
  const sourceFigureOccurrences = input.figureSourceOccurrences ?? null
  if (sourceFigureOccurrences) {
    for (const occ of sourceFigureOccurrences) {
      if ((occ.altText ?? '').trim() !== '') continue
      // V5.15 §6/§9 — the structure gate owns an invalid block: no normal figure
      // naming diagnostic may be produced for it (FIGURE_MISSING_NAME is
      // suppressed and replaced by the merged structure ERROR).
      if (invalidFigureTokenStarts.has(occ.tokenStart)) continue
      const occIdx = occ.occurrenceIndex
      const sourceRangeIdentity = occ.sourceRangeIdentity ?? buildSourceRangeIdentity({
        documentKey: input.documentKey,
        sourceRevision: null,
        resourceKind: 'image',
        canonicalDestination: occ.canonicalDestination,
        sourceStart: occ.tokenStart,
        sourceEnd: occ.tokenEnd,
        occurrenceIndex: occIdx,
      })
      // V1 §6/§11 — the owning source block identity + the stable occurrence identity.
      const sourceBlockIdentity = buildSourceBlockIdentity(occ.startLine)
      const occurrenceIdentity: DiagnosticFigureOccurrenceIdentity = {
        documentKey: input.documentKey ?? null,
        sourceRevision: input.sourceRevision ?? null,
        sourceBlockIdentity,
        sourceBlockOrdinal: occ.rawLineOrdinal,
        tokenStart: occ.tokenStart,
        tokenEnd: occ.tokenEnd,
        rawLineOrdinal: occ.rawLineOrdinal,
        occurrenceWithinLine: occ.occurrenceWithinLine,
        destination: occ.canonicalDestination,
      }
      push(
        makeDiagnostic(input, 'figure', 'FIGURE_MISSING_NAME', '图片缺少图名', {
          detail: '建议为图片命名。',
          targetIdentity: `missing-name:${occ.canonicalDestination}${occIdx > 0 ? `:${occIdx + 1}` : ''}`,
          kind: 'object',
          metadata: {
            ruleId: 'FIGURE-MISSING-NAME',
            resourceKind: 'image',
            // V5.12-R8 §5 — FIGURE_MISSING_NAME → FIGURE_FULL_TOKEN.
            rangeRole: 'figure-full-token',
            destination: occ.canonicalDestination,
            rawDestination: occ.rawDestination,
            canonicalDestination: occ.canonicalDestination,
            rawToken: occ.rawToken,
            sourceRangeIdentity,
            occurrenceIndex: occIdx,
            rawLineOrdinal: occ.rawLineOrdinal,
            occurrenceWithinLine: occ.occurrenceWithinLine,
            // V1 §6/§11 — the owning source block identity + its ordinal.
            sourceBlockIdentity,
            sourceBlockOrdinal: occ.rawLineOrdinal,
            figureOccurrenceIdentity: buildFigureOccurrenceIdentity(occurrenceIdentity),
            sourceStart: occ.tokenStart,
            sourceEnd: occ.tokenEnd,
            tokenStart: occ.tokenStart,
            tokenEnd: occ.tokenEnd,
            destinationStart: occ.destinationStart,
            destinationEnd: occ.destinationEnd,
            startLine: occ.startLine,
            endLine: occ.endLine,
            rawText: occ.rawText,
            altText: occ.altText,
            resourceClass: occ.resourceClass,
            localFileExists: occ.localFileExists,
            sourceRevision: null,
          },
          location: {
            kind: 'figure-occurrence',
            occurrenceIdentity,
            resourceKind: 'image',
            rangeRole: 'figure-full-token',
            startLine: occ.startLine,
            startColumn: occ.startColumn,
            endLine: occ.endLine,
            endColumn: occ.endColumn,
            rawText: occ.rawText,
            sourceStart: occ.tokenStart,
            sourceEnd: occ.tokenEnd,
            sourceRangeIdentity,
            canonicalDestination: occ.canonicalDestination,
            rawDestination: occ.rawDestination,
            occurrenceIndex: occIdx,
            rawLineOrdinal: occ.rawLineOrdinal,
            occurrenceWithinLine: occ.occurrenceWithinLine,
            rawToken: occ.rawToken,
            tokenStart: occ.tokenStart,
            tokenEnd: occ.tokenEnd,
            destinationStart: occ.destinationStart,
            destinationEnd: occ.destinationEnd,
          },
        }),
      )
    }
  }

  // ── VNext §24 — FIGURE manual number prefix ───────────────────────────────
  // The figure NAME is the Markdown image alt (the user's own source), so a
  // manual number inside it is a DOCUMENT-domain defect — but only while figure
  // auto-numbering is ON (otherwise it is plain text).
  if (sourceFigureOccurrences && input.numberingEnabled?.figure === true) {
    for (const occ of sourceFigureOccurrences) {
      const match = detectManualNumberPrefix(occ.altText)
      if (!match) continue
      if (invalidFigureTokenStarts.has(occ.tokenStart)) continue
      const occIdx = occ.occurrenceIndex
      const sourceRangeIdentity = occ.sourceRangeIdentity ?? buildSourceRangeIdentity({
        documentKey: input.documentKey,
        sourceRevision: null,
        resourceKind: 'image',
        canonicalDestination: occ.canonicalDestination,
        sourceStart: occ.tokenStart,
        sourceEnd: occ.tokenEnd,
        occurrenceIndex: occIdx,
      })
      const sourceBlockIdentity = buildSourceBlockIdentity(occ.startLine)
      const occurrenceIdentity: DiagnosticFigureOccurrenceIdentity = {
        documentKey: input.documentKey ?? null,
        sourceRevision: input.sourceRevision ?? null,
        sourceBlockIdentity,
        sourceBlockOrdinal: occ.rawLineOrdinal,
        tokenStart: occ.tokenStart,
        tokenEnd: occ.tokenEnd,
        rawLineOrdinal: occ.rawLineOrdinal,
        occurrenceWithinLine: occ.occurrenceWithinLine,
        destination: occ.canonicalDestination,
      }
      push(
        makeDiagnostic(input, 'figure', FIGURE_MANUAL_NUMBER_PREFIX_CODE,
          `图名包含手工编号「${match.matched}」`, {
          detail: '当前已开启图片自动编号，图名中的手工编号会与自动编号同时出现，建议删除手工编号。',
          targetIdentity: `figure-manual-number:${occ.canonicalDestination}${occIdx > 0 ? `:${occIdx + 1}` : ''}`,
          kind: 'object',
          metadata: {
            ruleId: 'FIGURE-MANUAL-NUMBER-PREFIX',
            reason: 'MANUAL_NUMBER_PREFIX',
            family: match.family,
            matched: match.matched,
            resourceKind: 'image',
            rangeRole: 'figure-full-token',
            destination: occ.canonicalDestination,
            rawDestination: occ.rawDestination,
            canonicalDestination: occ.canonicalDestination,
            rawToken: occ.rawToken,
            sourceRangeIdentity,
            occurrenceIndex: occIdx,
            rawLineOrdinal: occ.rawLineOrdinal,
            occurrenceWithinLine: occ.occurrenceWithinLine,
            sourceBlockIdentity,
            sourceBlockOrdinal: occ.rawLineOrdinal,
            figureOccurrenceIdentity: buildFigureOccurrenceIdentity(occurrenceIdentity),
            sourceStart: occ.tokenStart,
            sourceEnd: occ.tokenEnd,
            tokenStart: occ.tokenStart,
            tokenEnd: occ.tokenEnd,
            destinationStart: occ.destinationStart,
            destinationEnd: occ.destinationEnd,
            startLine: occ.startLine,
            endLine: occ.endLine,
            rawText: occ.rawText,
            altText: occ.altText,
            resourceClass: occ.resourceClass,
            localFileExists: occ.localFileExists,
            sourceRevision: null,
          },
          location: {
            kind: 'figure-occurrence',
            occurrenceIdentity,
            resourceKind: 'image',
            rangeRole: 'figure-full-token',
            startLine: occ.startLine,
            startColumn: occ.startColumn,
            endLine: occ.endLine,
            endColumn: occ.endColumn,
            rawText: occ.rawText,
            sourceStart: occ.tokenStart,
            sourceEnd: occ.tokenEnd,
            sourceRangeIdentity,
            canonicalDestination: occ.canonicalDestination,
            rawDestination: occ.rawDestination,
            occurrenceIndex: occIdx,
            rawLineOrdinal: occ.rawLineOrdinal,
            occurrenceWithinLine: occ.occurrenceWithinLine,
            rawToken: occ.rawToken,
            tokenStart: occ.tokenStart,
            tokenEnd: occ.tokenEnd,
            destinationStart: occ.destinationStart,
            destinationEnd: occ.destinationEnd,
          },
        }),
      )
    }
  }

  for (const f of input.figures) {
    const identity = f.targetIdentity ?? undefined
    // V5.12-R8 §8 — with the source-occurrence authority present the missing-NAME
    // rule is SOURCE-FIRST only (one target authority, no DOM/paragraph guess).
    // Legacy pure callers without it keep the DOM-figure behavior unchanged.
    if (!sourceFigureOccurrences && (f.name ?? '').trim() === '') {
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
      // V4 dedup — the SOURCE-first image pass (resourceKind=image facts) is the
      // identity/location authority for a missing image. When this DOM figure
      // resolves to the SAME missing destination, it must NOT double-report.
      const domImageKey = normalizeResourceToken(destRel ?? f.localPath ?? '')
      if (domImageKey && sourceImageCovered.has(domImageKey)) continue
      // V5.15 §6/§9 — the DOM projection of an invalid owning block is excluded
      // from the normal figure resource rule as well.
      if (domImageKey && invalidFigureDestinations.has(domImageKey)) continue
      const occurrenceIndex = figureDestinationOccurrenceIndex(input.figures, f, destRel, input.vaultRoot)
      push(
        makeDiagnostic(input, 'figure', 'FIGURE_LOCAL_IMAGE_MISSING', `本地图片不存在：${f.localPath}`, {
          detail: '图片引用的本地文件无法解析。',
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

  // ── Phase H §9 — TABLE / CODE manual number prefix ────────────────────────
  // MIRRORS the existing FIGURE_MANUAL_NUMBER_PREFIX rule: the object NAME is
  // the user's own caption name, so a manual number inside it is a
  // DOCUMENT-domain defect — but ONLY while the matching auto-numbering is ON
  // (otherwise a literal `1.` prefix is plain text). Reuses the SAME
  // `detectManualNumberPrefix` authority — no second regex. The diagnostic
  // identity derives from the object's SOURCE identity (block ordinal), never
  // from any generated number (style switches therefore never churn the id).
  if (input.numberingEnabled?.table === true) {
    for (const t of input.tables) {
      const match = detectManualNumberPrefix(t.name)
      if (!match) continue
      push(
        makeDiagnostic(input, 'table', TABLE_MANUAL_NUMBER_PREFIX_CODE,
          `表名包含手工编号「${match.matched}」`, {
          detail: '当前已开启表格自动编号，表名中的手工编号会与自动编号同时出现，建议删除手工编号。',
          element: t.element,
          targetIdentity: t.targetIdentity ?? undefined,
          kind: 'object',
          metadata: {
            ruleId: 'TABLE-MANUAL-NUMBER-PREFIX',
            reason: 'MANUAL_NUMBER_PREFIX',
            family: match.family,
            matched: match.matched,
          },
          location: t.targetIdentity
            ? { kind: 'block-node', blockKind: 'table', stableIdentity: t.targetIdentity }
            : undefined,
        }),
      )
    }
  }
  if (input.numberingEnabled?.code === true) {
    for (const c of input.codes) {
      const match = detectManualNumberPrefix(c.name)
      if (!match) continue
      push(
        makeDiagnostic(input, 'code', CODE_MANUAL_NUMBER_PREFIX_CODE,
          `代码名称包含手工编号「${match.matched}」`, {
          detail: '当前已开启代码自动编号，代码名称中的手工编号会与自动编号同时出现，建议删除手工编号。',
          element: c.element,
          targetIdentity: c.targetIdentity ?? undefined,
          kind: 'object',
          metadata: {
            ruleId: 'CODE-MANUAL-NUMBER-PREFIX',
            reason: 'MANUAL_NUMBER_PREFIX',
            family: match.family,
            matched: match.matched,
          },
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
  // V4 — LINK_LOCAL_TARGET_MISSING consumes ONLY resourceKind='link'. Image
  // facts are owned by the SOURCE-FIRST FIGURE_LOCAL_IMAGE_MISSING pass above;
  // an image token must never be miscounted as a missing link.
    for (const l of input.links) {
    if (!isLocalRelativePath(l.target)) continue
    if (l.resourceKind === 'image') continue
    const occurrenceIndex = linkOccurrenceIndex(input.links, l.target, l.index, 'link', l.semanticDestination)
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
          blockKind: 'link',
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

  // ── Phase I §10 — ANCHOR INTEGRITY ────────────────────────────────────────
  // The canonical heading ANCHOR authority is Typora's OWN rendered heading id
  // (`el.id`) — the SAME identity the outline adapter matches `href="#id"`
  // against (`outline-numbering-adapter.matchHeadingsToOutline`). We NEVER write
  // a second slugifier and NEVER parse a rendered number.
  const headingAnchors = new Map<string, DiagnosticHeadingFact[]>()
  for (const h of input.headings) {
    const id = (h.element?.id ?? '').trim()
    if (id === '') continue
    const list = headingAnchors.get(id)
    if (list) list.push(h)
    else headingAnchors.set(id, [h])
  }

  // HEADING_ANCHOR_COLLISION — ONE diagnostic per collision group (a
  // target-group of the colliding headings), never N business diagnostics.
  for (const [anchorId, group] of headingAnchors) {
    if (group.length <= 1) continue
    const targets: DiagnosticLocation[] = group.map(h => {
      if (h.stableIdentity) return { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: h.stableIdentity }
      const line = h.element?.getAttribute?.('data-line')
      if (line != null && line !== '') {
        const n = Number.parseInt(line, 10)
        if (Number.isInteger(n)) return { kind: 'source-range', startLine: n, startColumn: 0 }
      }
      return { kind: 'document-start' }
    })
    push(
      makeDiagnostic(input, 'heading', HEADING_ANCHOR_COLLISION_CODE,
        `标题锚点重复：${anchorId}`, {
        detail: '多个标题生成了相同的锚点，文档内跳转将无法定位到唯一标题。',
        stableIdentity: group[0]?.stableIdentity,
        element: group[0]?.element ?? null,
        targetIdentity: `heading-anchor-collision:${anchorId}`,
        kind: 'heading',
        metadata: {
          ruleId: 'HEADING-ANCHOR-COLLISION',
          reason: 'HEADING_ANCHOR_COLLISION',
          anchor: anchorId,
          groupMemberCount: group.length,
        },
        locator: group[0]?.element
          ? { kind: 'heading', targetElement: group[0].element }
          : { kind: 'document', targetElement: null, action: 'GO_TOP' },
        location: { kind: 'target-group', scrollAnchor: targets[0] ?? { kind: 'document-start' }, targets },
      }),
    )
  }

  // LINK_LOCAL_ANCHOR_MISSING — `[x](#target)` resolving to NO canonical heading
  // anchor. A source-syntax rule; SILENT when the anchor authority is
  // unavailable (no canonical heading carries an id) so it never false-fires.
  if (input.markdown != null && headingAnchors.size > 0) {
    for (const ref of parseLocalAnchorTargets(input.markdown)) {
      if (matchesCanonicalHeadingAnchor(ref.target, headingAnchors)) continue
      push(
        makeDiagnostic(input, 'link', LINK_LOCAL_ANCHOR_MISSING_CODE,
          `本地锚点不存在：#${ref.target}`, {
          detail: '链接指向的文档内锚点无法解析到任何标题。',
          kind: 'link',
          targetIdentity: `anchor:${ref.target}`,
          metadata: {
            ruleId: 'LINK-LOCAL-ANCHOR-MISSING',
            reason: 'LOCAL_ANCHOR_MISSING',
            anchor: ref.target,
          },
          location: {
            kind: 'source-range',
            startLine: ref.startLine,
            startColumn: ref.startColumn,
            endLine: ref.endLine,
            endColumn: ref.endColumn,
            rawText: ref.rawText,
            sourceStart: ref.sourceStart,
            sourceEnd: ref.sourceEnd,
            // Anchor Integrity — the rendered DOM of `[label](#anchor)` is the
            // inline `<a href="#anchor">`; the raw `#anchor` fragment is the
            // locator identity the anchor authority resolves by href equality.
            resourceKind: 'link',
            rawDestination: ref.rawDestination,
            canonicalDestination: ref.rawDestination,
          },
        }),
      )
    }
  }

  // ── Numbering Integrity V2 (spec §9/§21) — object / formula NUMBER rules ──
  // Consumes ONLY the canonical effective-number snapshot; absent / empty ⇒ all
  // of these rules stay silent (never a false positive).
  emitObjectNumberIntegrity(input, push)

  // ── TRAE V3 — Source Syntax / Footnote / Reference / Front Matter / Table
  //    header / Empty-link integrity (ONE shared-authority pass).
  emitSourceSyntaxIntegrity(input, push)

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
