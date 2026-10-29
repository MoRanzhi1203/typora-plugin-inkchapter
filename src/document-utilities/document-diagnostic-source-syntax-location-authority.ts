/**
 * TRAE V4 §3 / V5 §10 — `SourceSyntaxLocationAuthority` (data contract + fast path).
 *
 * A source-syntax opener is located through the ONE canonical chain owned by
 * `CanonicalSourceRangeProjectionAuthority`:
 *
 *   validate document → validate source revision
 *   → CanonicalSourceRangeProjectionAuthority
 *   → data-line is only a VERIFIED FAST PATH
 *   → sourceBlockIdentity → primaryElement → exact/verified presentation range
 *   → visible rect(s) → RESOLVED
 *
 * This module owns the DATA CONTRACT (the `source-syntax-opener` location, the
 * locate request/result, the decision vocabulary) and the data-line FAST-PATH
 * helper. The DOM binding itself is executed by the host, which owns the live
 * DOM + the existing source-block binding authority.
 *
 * HARD RULES (spec §5/§30):
 *   - a data-line miss must NEVER terminate the locate;
 *   - `sourceLine` is audit / projection input ONLY — never the identity;
 *   - the identity is the canonical `openerIdentity`.
 */

export type SourceSyntaxKind = 'code-fence' | 'formula-block' | 'frontmatter'

export interface SourceSyntaxSourceRange {
  /** Absolute offset of the first character (inclusive). */
  start: number
  /** Absolute offset AFTER the last character (exclusive). */
  end: number
}

/**
 * §9 — the THREE ranges are deliberately SEPARATE fields:
 *
 *   protectedRange    — opener → EOF (parser / literal ownership; NEVER painted)
 *   sourceStart/End   — the opener TOKEN (the diagnostic's location range)
 *   presentationRange — the opener token / the verified opener-only block
 */
export interface SourceSyntaxOpenerLocation {
  kind: 'source-syntax-opener'
  syntaxKind: SourceSyntaxKind
  /** 0-based opening source line (projection input / audit — never the identity). */
  sourceLine: number
  /** Absolute start offset of the opener TOKEN (the location range). */
  sourceStartOffset: number
  /** Absolute end offset of the opener TOKEN. */
  sourceEndOffset: number
  /** Raw opening source line text (audit / opener verification). */
  openerText: string
  /** Canonical opener identity (`doc.md:fence:\`:221`). */
  openerIdentity: string
  /** The source generation the diagnostic was computed against. */
  sourceRevision: number | null
  protectedRange: SourceSyntaxSourceRange
  presentationRange: SourceSyntaxSourceRange
}

export type SourceSyntaxLocateDecision =
  | 'RESOLVED'
  | 'SOURCE_REVISION_STALE'
  | 'TARGET_NOT_FOUND'
  | 'AMBIGUOUS'
  | 'DOCUMENT_MISMATCH'
  | 'OPENER_TEXT_MISMATCH'

export interface SourceSyntaxLocateRequest {
  documentKey: string
  sourceRevision: number | null
  syntaxKind: SourceSyntaxKind
  sourceLine: number
  openerIdentity: string
  openerText: string
  sourceStartOffset: number
  sourceEndOffset: number
}

export interface SourceSyntaxLocateResult {
  decision: SourceSyntaxLocateDecision
  targetKind: 'source-syntax-opener' | null
  primaryElement: HTMLElement | null
  /** `DATA_LINE_VERIFIED_FAST_PATH` / `CANONICAL_SOURCE_BLOCK_BINDING` / ... */
  strategy: string
  candidateCount: number
  sourceBlockIdentity: string | null
  /** True when the whole bound block represents ONLY the opener line. */
  openerOnlyBlock: boolean
  /** The opener text actually present in the DOM (null when not measured). */
  presentationOpenerText: string | null
}

export interface SourceSyntaxLocateContext {
  documentKey: string | null
  /** The CURRENT source generation (stale-revision guard). */
  getSourceRevision?: () => number | null
  /** Canonical 0-based source line → the SINGLE live element carrying it. */
  resolveSourceLine: (line: number) => HTMLElement | null
  /** How many live elements claim a 0-based source line (ambiguity guard). */
  countSourceLineMatches?: (line: number) => number
  /**
   * §5 — VERIFY a data-line fast-path candidate. Returns true only when the
   * candidate really belongs to the requested source range (block identity /
   * source span / opener text all verified). A false verdict means the fast path
   * is a MISS and the caller MUST fall through to the canonical projection.
   */
  verifySourceLineCandidate?: (element: HTMLElement, line: number) => boolean
}

/** §24.1 → V5 §18.1 — the source-syntax LOCATE runtime audit event. */
export const SOURCE_SYNTAX_LOCATE_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-SOURCE-SYNTAX-LOCATE-AUDIT'

/** §8 Hard Gate — the locator NEVER requires a canonical code block. */
export const SOURCE_SYNTAX_LOCATOR_REQUIRES_CANONICAL_CODE_BLOCK_COUNT = 0

export interface DataLineFastPathOutcome {
  verified: boolean
  element: HTMLElement | null
  /** The source line that produced the candidate (exact or offset-tolerant). */
  resolvedLine: number | null
  /** How many elements claimed `resolvedLine` (ambiguity guard). */
  candidateCount: number
  strategy: string
}

/**
 * §5 — the VERIFIED data-line fast path. It tries the exact line, then the
 * single 1-based offset tolerance; EITHER must additionally VERIFY before it can
 * be accepted. A miss is never terminal — it hands back `verified:false`.
 */
export function tryDataLineFastPath(
  request: SourceSyntaxLocateRequest,
  ctx: SourceSyntaxLocateContext,
): DataLineFastPathOutcome {
  const attempt = (line: number, strategy: string): DataLineFastPathOutcome => {
    const candidates = typeof ctx.countSourceLineMatches === 'function'
      ? ctx.countSourceLineMatches(line)
      : (ctx.resolveSourceLine(line) ? 1 : 0)
    if (candidates > 1) {
      return { verified: false, element: null, resolvedLine: line, candidateCount: candidates, strategy: 'data-line-ambiguous' }
    }
    const el = ctx.resolveSourceLine(line)
    if (!el || !el.isConnected) {
      return { verified: false, element: null, resolvedLine: line, candidateCount: 0, strategy }
    }
    const verified = typeof ctx.verifySourceLineCandidate === 'function'
      ? ctx.verifySourceLineCandidate(el, line)
      : true
    if (!verified) {
      return { verified: false, element: null, resolvedLine: line, candidateCount: 1, strategy: `${strategy}-unverified` }
    }
    return { verified: true, element: el, resolvedLine: line, candidateCount: 1, strategy }
  }
  const exact = attempt(request.sourceLine, 'data-line-exact')
  if (exact.verified) return exact
  const offset = attempt(request.sourceLine + 1, 'data-line-offset')
  if (offset.verified) return offset
  // Report the most informative miss (ambiguity wins over a plain miss).
  if (exact.candidateCount > 1) return exact
  if (offset.candidateCount > 1) return offset
  return { verified: false, element: null, resolvedLine: null, candidateCount: 0, strategy: 'data-line-miss' }
}
