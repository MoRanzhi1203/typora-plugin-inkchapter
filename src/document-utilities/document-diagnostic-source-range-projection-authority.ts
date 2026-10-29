/**
 * TRAE V5 §2/§3/§4/§5/§7/§8 — `CanonicalSourceRangeProjectionAuthority`.
 *
 * The ONE authority that turns a SOURCE RANGE (an absolute `[start,end)` offset
 * pair in the CURRENT Markdown) into a
 *
 *   canonical source block → sourceBlockIdentity → verified Typora DOM binding
 *   → exact opener DOM Range (or a VERIFIED opener-only block)
 *
 * WHY it exists: `sourceLine → [data-line]` is NOT a sufficient authority in
 * Typora. A malformed / unclosed source-syntax construct is often NOT a normal
 * canonical object (the unclosed fence may render as `p.md-p`, not a
 * `<pre class="md-fences">`, and carries no `data-line`). `data-line` is
 * therefore only a VERIFIED FAST PATH; when it misses, resolution MUST fall back
 * to the canonical source block binding instead of terminating in
 * `TARGET_NOT_FOUND`.
 *
 * HARD RULES (spec §5/§6/§7/§8/§30):
 *   - NEVER `querySelector('pre')` / `innerText.indexOf(...)` / nearest block /
 *     ordinal block / "the Nth paragraph";
 *   - the identity is the canonical `sourceBlockIdentity` built from the SOURCE,
 *     never a DOM ordinal;
 *   - a data-line hit that does not VERIFY (block identity / source span /
 *     opener text) is rejected — it must not terminate the locate;
 *   - the protected range (opener→EOF) is NEVER the presentation target.
 *
 * Pure: block segmentation reads the Markdown only (no DOM, no host state).
 */
import { buildSourceLineSpans } from './document-source-syntax-authority'
import { buildSourceBlockIdentity } from './document-diagnostic-locator-authority-v1'

/** §3 — the projection decision vocabulary. */
export type SourceSyntaxProjectionDecision =
  | 'RESOLVED'
  | 'DOCUMENT_MISMATCH'
  | 'SOURCE_REVISION_STALE'
  | 'SOURCE_RANGE_INVALID'
  | 'SOURCE_BLOCK_NOT_FOUND'
  | 'DOM_BINDING_NOT_FOUND'
  | 'DOM_BINDING_AMBIGUOUS'
  | 'TEXT_RANGE_NOT_PROJECTABLE'
  | 'OPENER_TEXT_MISMATCH'
  | 'TARGET_NOT_FOUND'

/** §5 — the projection strategies (at least these three are distinguishable). */
export type SourceSyntaxProjectionStrategy =
  | 'DATA_LINE_VERIFIED_FAST_PATH'
  | 'CANONICAL_SOURCE_BLOCK_BINDING'
  | 'CANONICAL_SOURCE_RANGE_PROJECTION'
  | 'NONE'

/** §4 — ONE canonical Markdown source block. */
export interface CanonicalSourceBlock {
  /** `src-block:<startLine>` — the canonical owning-block identity. */
  identity: string
  startLine: number
  endLine: number
  /** Absolute offset of the block's first character (inclusive). */
  startOffset: number
  /** Absolute offset AFTER the block's last character (exclusive). */
  endOffset: number
  text: string
}

/** §4 — the canonical source block index of a whole Markdown document. */
export function computeCanonicalSourceBlocks(markdown: string): CanonicalSourceBlock[] {
  if (!markdown) return []
  const lines = buildSourceLineSpans(markdown)
  const out: CanonicalSourceBlock[] = []
  let runStart = -1
  const flush = (endIdx: number): void => {
    if (runStart < 0) return
    const first = lines[runStart]
    const last = lines[endIdx]
    out.push({
      identity: buildSourceBlockIdentity(first.index),
      startLine: first.index,
      endLine: last.index,
      startOffset: first.start,
      endOffset: last.end,
      text: markdown.slice(first.start, last.end),
    })
    runStart = -1
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].blank) {
      flush(i - 1 >= runStart ? i - 1 : runStart)
      continue
    }
    if (runStart < 0) runStart = i
  }
  if (runStart >= 0) flush(lines.length - 1)
  return out
}

/**
 * §4 — the canonical source block CONTAINING `offset`. A block owns `offset`
 * when `startOffset <= offset <= endOffset` (the end bound is inclusive so an
 * offset exactly at a block boundary resolves deterministically to the block
 * that ENDS there, never to the following block).
 */
export function findCanonicalSourceBlockForOffset(
  blocks: readonly CanonicalSourceBlock[],
  offset: number,
): CanonicalSourceBlock | null {
  if (!Number.isFinite(offset)) return null
  let fallback: CanonicalSourceBlock | null = null
  for (const b of blocks) {
    if (offset >= b.startOffset && offset <= b.endOffset) {
      // Prefer the innermost block when boundaries touch.
      if (fallback == null || (b.endOffset - b.startOffset) < (fallback.endOffset - fallback.startOffset)) {
        fallback = b
      }
    }
  }
  return fallback
}

/** §4 — normalized text for the opener-compatibility comparison. */
export function normalizeCanonicalBlockText(text: string): string {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/**
 * §4 — is the source slice `[start,end)` compatible with `openerText`? The slice
 * must START with the opener token (a fence opener may carry an info string, so
 * the opener is a prefix, never an exact whole-slice equality).
 */
export function openerTextCompatible(
  markdown: string,
  start: number,
  end: number,
  openerText: string,
): boolean {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false
  const opener = normalizeCanonicalBlockText(openerText)
  if (opener === '') return true
  const slice = normalizeCanonicalBlockText(markdown.slice(start, end))
  if (slice === '') return false
  return slice.startsWith(opener)
}

/** §18.1 — the source-syntax PROJECTION runtime audit event. */
export const SOURCE_SYNTAX_PROJECTION_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-SOURCE-SYNTAX-PROJECTION-AUDIT'

export function buildSourceSyntaxProjectionAudit(input: {
  documentKey: string | null
  diagnosticId: string | null
  ruleId: string
  severity: string
  sourceRevision: number | null
  sourceStartOffset: number
  sourceEndOffset: number
  sourceLine: number
  syntaxKind: string
  openerIdentity: string
  openerText: string
  sourceBlockIdentity: string | null
  sourceBlockStartOffset: number | null
  sourceBlockEndOffset: number | null
  projectionStrategy: SourceSyntaxProjectionStrategy
  dataLineFastPathAttempted: boolean
  dataLineFastPathVerified: boolean
  primaryElementKind: string | null
  primaryElementConnected: boolean
  domRangeResolved: boolean
  visibleRectCount: number
  layoutEpoch: number
  decision: SourceSyntaxProjectionDecision
  reason: string
}): Record<string, unknown> {
  return { ...input }
}
