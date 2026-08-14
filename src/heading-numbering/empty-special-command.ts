/**
 * Empty Paragraph Special-Command Structural + Caret Continuity (P0).
 *
 * When a paragraph's ENTIRE user-visible text is exactly the token (".." or "。。"),
 * consuming the token re-empties the paragraph and Typora then runs its own
 * empty-block normalization (replacement / collapse / placeholder processing).
 *
 * The ordinary synchronous ENTER-COMMIT-ATOMIC is no longer sufficient for this
 * token-only empty case: it binds canonical ownership and restores the caret
 * BEFORE Typora's normalization completes, so the target empty paragraph can be
 * deleted/replaced/merged right after the "success".
 *
 * This module holds the PURE, unit-testable logic for:
 *   - the empty special-command transaction state machine
 *   - EmptySlotResolution (SAME_NODE / CONTROLLED_REPLACEMENT / AMBIGUOUS / MISSING)
 *   - caret geometry verification
 *   - final authority evaluation
 *
 * It must NOT mutate the DOM, canonical registry, sidecar, or selection. The
 * DOM-touching wiring lives in heading-numbering-service.ts.
 */

export type EmptySpecialCommandState =
  | 'PRE_CAPTURED'
  | 'MUTATION_WINDOW_ARMED'
  | 'TOKEN_CONSUMED'
  | 'DOM_NORMALIZED'
  | 'NORMALIZATION_PENDING'
  | 'MUTATION_OBSERVED'
  | 'QUIET_BOUNDARY_REACHED'
  | 'STRUCTURE_RESOLVED'
  | 'CANONICAL_COMMITTED'
  | 'CARET_VERIFIED'
  | 'VISUAL_VERIFIED'
  | 'COMMITTED'
  | 'BLOCKED'

export interface EmptySpecialCommandPlan {
  operation: 'CREATE' | 'UPDATE'
  existingRecordId: string | null
  mode: 'force-indent'
  scopeId: string
  intentEpoch: number
  sourceRuntimeId: string
  sourceOrdinal: number
  previousRuntimeId: string | null
  nextRuntimeId: string | null
  paragraphCountBefore: number
  sourceWasTokenOnly: true
}

export interface EmptySpecialCommandTransaction {
  txnId: string
  scopeId: string
  intentEpoch: number
  sourceElement: HTMLElement
  sourceRuntimeId: string
  sourceOrdinal: number
  previousElement: HTMLElement | null
  previousRuntimeId: string | null
  nextElement: HTMLElement | null
  nextRuntimeId: string | null
  paragraphCountBefore: number
  sourceWasTokenOnly: true
  existingCanonicalRecordId: string | null
  desiredMode: 'force-indent'
  state: EmptySpecialCommandState
  authorizedCaretWriteCount: number
  resolvedRuntimeId: string | null
}

export type EmptySlotDecision = 'SAME_NODE' | 'CONTROLLED_REPLACEMENT' | 'AMBIGUOUS' | 'MISSING'

export interface EmptySlotResolution {
  decision: EmptySlotDecision
  sourceRuntimeId: string
  resolvedRuntimeId: string | null
  previousRuntimeId: string | null
  nextRuntimeId: string | null
  candidateCount: number
  paragraphCountBefore: number
  paragraphCountAfter: number
}

/** DOM-free inputs for slot resolution. Callers already query the DOM. */
export interface EmptySlotResolutionInput {
  sourceConnected: boolean
  sourceRuntimeId: string
  previousRuntimeId: string | null
  nextRuntimeId: string | null
  /** Replacement candidates (already filtered to be connected + between prev/next). */
  candidateRuntimeIds: string[]
  paragraphCountBefore: number
  paragraphCountAfter: number
}

export interface EmptyCaretGeometryInput {
  fontSizePx: number
  expectedIndentPx: number
  paragraphContentLeft: number
  caretRectLeft: number
  tolerancePx: number
  logicalOffset: number
}

export interface EmptyCaretGeometryResult {
  fontSizePx: number
  expectedIndentPx: number
  paragraphContentLeft: number
  caretRectLeft: number
  actualCaretIndentPx: number
  tolerancePx: number
  logicalOffset: number
  overall: boolean
}

export interface EmptySpecialFinalInput {
  logicalSlotPreserved: boolean
  paragraphCountPreserved: boolean
  canonicalOwnerCorrect: boolean
  semanticCorrect: boolean
  visualIndentCorrect: boolean
  caretLogicalCorrect: boolean
  caretVisualCorrect: boolean
  authorizedCaretWriteCount: number
  unexpectedMerge: boolean
  unexpectedDelete: boolean
}

export interface EmptySpecialFinalReport {
  sourceWasTokenOnly: true
  logicalSlotPreserved: boolean
  paragraphCountPreserved: boolean
  canonicalOwnerCorrect: boolean
  semanticCorrect: boolean
  visualIndentCorrect: boolean
  caretLogicalCorrect: boolean
  caretVisualCorrect: boolean
  authorizedCaretWriteCount: number
  unexpectedMerge: boolean
  unexpectedDelete: boolean
  overall: boolean
}

/**
 * Resolve the final logical empty slot after token consumption.
 *
 * Priority:
 *   source still connected → SAME_NODE
 *   source disconnected + exactly one connected replacement → CONTROLLED_REPLACEMENT
 *   zero replacements → MISSING
 *   more than one replacement → AMBIGUOUS (BLOCK, never guess)
 */
export function resolveEmptySlot(input: EmptySlotResolutionInput): EmptySlotResolution {
  const base = {
    sourceRuntimeId: input.sourceRuntimeId,
    previousRuntimeId: input.previousRuntimeId,
    nextRuntimeId: input.nextRuntimeId,
    paragraphCountBefore: input.paragraphCountBefore,
    paragraphCountAfter: input.paragraphCountAfter,
  }

  if (input.sourceConnected) {
    return { ...base, decision: 'SAME_NODE', resolvedRuntimeId: input.sourceRuntimeId, candidateCount: 1 }
  }

  const candidates = input.candidateRuntimeIds
  if (candidates.length === 1) {
    return { ...base, decision: 'CONTROLLED_REPLACEMENT', resolvedRuntimeId: candidates[0], candidateCount: 1 }
  }
  if (candidates.length === 0) {
    return { ...base, decision: 'MISSING', resolvedRuntimeId: null, candidateCount: 0 }
  }
  return { ...base, decision: 'AMBIGUOUS', resolvedRuntimeId: null, candidateCount: candidates.length }
}

/**
 * Verify caret geometry against the expected indent.
 * actualCaretIndentPx = caretRectLeft - paragraphContentLeft.
 */
export function computeCaretGeometry(input: EmptyCaretGeometryInput): EmptyCaretGeometryResult {
  const actualCaretIndentPx = input.caretRectLeft - input.paragraphContentLeft
  const overall = Math.abs(actualCaretIndentPx - input.expectedIndentPx) <= input.tolerancePx
  return {
    fontSizePx: input.fontSizePx,
    expectedIndentPx: input.expectedIndentPx,
    paragraphContentLeft: input.paragraphContentLeft,
    caretRectLeft: input.caretRectLeft,
    actualCaretIndentPx,
    tolerancePx: input.tolerancePx,
    logicalOffset: input.logicalOffset,
    overall,
  }
}

/**
 * Final authority for a token-only empty special command.
 * Only `overall === true` means the command actually PASSED.
 */
export function evaluateEmptySpecialFinal(input: EmptySpecialFinalInput): EmptySpecialFinalReport {
  const overall =
    input.logicalSlotPreserved &&
    input.paragraphCountPreserved &&
    input.canonicalOwnerCorrect &&
    input.semanticCorrect &&
    input.visualIndentCorrect &&
    input.caretLogicalCorrect &&
    input.caretVisualCorrect &&
    !input.unexpectedMerge &&
    !input.unexpectedDelete
  return { ...input, sourceWasTokenOnly: true, overall }
}

/** True when the special command must use the deferred token-only path. */
export function isTokenOnlyEmptySpecialCommand(visibleText: string, token: '..' | '。。'): boolean {
  return visibleText === token
}

// ── A: Native Empty DOM Root-Cause Probe ──────────────────────────────

/**
 * Read-only snapshot of an empty-block candidate's DOM, used to compare the
 * native empty form against the token-consumed empty form at runtime.
 *
 * This is a diagnostic probe only — it NEVER mutates the DOM and never produces
 * a business conclusion. The fields are the raw observed facts; a runtime audit
 * consumer (or a human) compares snapshots across phases.
 */
export interface EmptyBlockDomSnapshot {
  phase: string
  runtimeId: string | null
  isConnected: boolean
  tagName: string
  innerHTML: string
  textContent: string
  childNodeCount: number
  childNodeSummaries: string[]
  hasBR: boolean
  brCount: number
  hasPlaceholderSpan: boolean
  hasTyporaMarker: boolean
}

/** Maximum child summaries captured per snapshot (keeps the JSONL bounded). */
const DOM_SNAPSHOT_CHILD_LIMIT = 8

function describeChildNode(node: Node): string {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    const text = (node.textContent ?? '').slice(0, 24).replace(/\s+/g, ' ')
    return `text:${text.length === 0 ? '(empty)' : text}`
  }
  if (node.nodeType === 8 /* COMMENT_NODE */) {
    return `comment:${(node.textContent ?? '').slice(0, 24)}`
  }
  if (node instanceof Element) {
    const cls = typeof node.className === 'string' ? node.className : ''
    return `tag:${node.tagName.toLowerCase()}${cls ? `.${cls.slice(0, 24)}` : ''}`
  }
  return `node:${node.nodeType}`
}

/**
 * Capture a read-only DOM snapshot of an empty-block candidate.
 *
 * @param node  The paragraph element (or any Node) to snapshot.
 * @param phase One of NATIVE_EMPTY / BEFORE_TOKEN_CONSUME / AFTER_TOKEN_CONSUME /
 *              AFTER_MICROTASK / AFTER_RAF.
 * @param runtimeId Object-identity runtime ID of the paragraph (or null).
 */
export function snapshotEmptyBlockDom(node: Node | null, phase: string, runtimeId: string | null): EmptyBlockDomSnapshot {
  if (!node) {
    return {
      phase, runtimeId, isConnected: false, tagName: 'none', innerHTML: '',
      textContent: '', childNodeCount: 0, childNodeSummaries: [], hasBR: false,
      brCount: 0, hasPlaceholderSpan: false, hasTyporaMarker: false,
    }
  }

  const isConnected = typeof (node as Node).isConnected === 'boolean' ? (node as Node).isConnected : false
  const el = node instanceof Element ? (node as Element) : null
  const tagName = el ? el.tagName.toLowerCase() : 'text'
  const textContent = node.textContent ?? ''
  const innerHTML = el ? (el as HTMLElement).innerHTML ?? '' : textContent

  const childNodes: Node[] = []
  node.childNodes.forEach(c => childNodes.push(c))
  const childNodeSummaries = childNodes.slice(0, DOM_SNAPSHOT_CHILD_LIMIT).map(describeChildNode)

  const brs = el ? el.querySelectorAll('br') : ([] as unknown as NodeListOf<HTMLBRElement>)
  const brCount = brs.length

  const hasPlaceholderSpan = el
    ? el.querySelector('span[data-placeholder], span.placeholder, span.md-empty') !== null
    : false

  // Heuristic: Typora inline markers use `.md-*` classes; CodeMirror uses `.cm-*`.
  const hasTyporaMarker = el
    ? el.querySelector('[class*="md-"], [class*="cm-"]') !== null
    : false

  return {
    phase,
    runtimeId,
    isConnected,
    tagName,
    innerHTML,
    textContent,
    childNodeCount: node.childNodes.length,
    childNodeSummaries,
    hasBR: brCount > 0,
    brCount,
    hasPlaceholderSpan,
    hasTyporaMarker,
  }
}

// ── B: Mutation-authoritative settle decision ────────────────────────

export type EmptySpecialSettleDecisionName =
  | 'PENDING'
  | 'SETTLED_BY_MUTATION_QUIET'
  | 'SETTLED_NO_RELEVANT_MUTATION'
  | 'TIMEOUT_BLOCK'

export interface EmptySpecialSettleDecisionInput {
  /** Monotonic mutation batch generation counter. */
  mutationGeneration: number
  /** Number of relevant structural/characterData mutation batches observed so far. */
  relevantMutationCount: number
  /** Number of consecutive quiet frames since the last observed mutation batch. */
  quietFramesSinceMutation: number
  /** Milliseconds since the settle window opened. */
  elapsedMs: number
  /** Bounded safety timeout (ms). */
  maxTimeoutMs: number
  /** Number of consecutive quiet frames required to declare the boundary reached. */
  requiredQuietFrames: number
  /** Whether the source paragraph is still connected. */
  sourceConnected: boolean
  /** Whether PRE/microtask/RAF topology is stable (no new mutation for N frames). */
  topologyStable: boolean
}

export interface EmptySpecialSettleDecision {
  decision: EmptySpecialSettleDecisionName
  quietBoundaryReached: boolean
  timeoutReached: boolean
  shouldResolve: boolean
}

/**
 * Mutation-authoritative settle decision.
 *
 *   relevantMutationCount > 0:
 *     quiet boundary reached → SETTLED_BY_MUTATION_QUIET
 *     timeout               → TIMEOUT_BLOCK (NOT a success fallback)
 *
 *   relevantMutationCount == 0:
 *     source connected + topology stable → SETTLED_NO_RELEVANT_MUTATION
 *     timeout                          → TIMEOUT_BLOCK
 *
 *   otherwise → PENDING
 */
export function decideEmptySpecialSettle(input: EmptySpecialSettleDecisionInput): EmptySpecialSettleDecision {
  const timeoutReached = input.elapsedMs >= input.maxTimeoutMs

  if (input.relevantMutationCount > 0) {
    const quietBoundaryReached = input.quietFramesSinceMutation >= input.requiredQuietFrames
    if (quietBoundaryReached) {
      return { decision: 'SETTLED_BY_MUTATION_QUIET', quietBoundaryReached: true, timeoutReached: false, shouldResolve: true }
    }
    if (timeoutReached) {
      return { decision: 'TIMEOUT_BLOCK', quietBoundaryReached: false, timeoutReached: true, shouldResolve: true }
    }
    return { decision: 'PENDING', quietBoundaryReached: false, timeoutReached: false, shouldResolve: false }
  }

  if (input.sourceConnected && input.topologyStable) {
    return { decision: 'SETTLED_NO_RELEVANT_MUTATION', quietBoundaryReached: false, timeoutReached: false, shouldResolve: true }
  }
  if (timeoutReached) {
    return { decision: 'TIMEOUT_BLOCK', quietBoundaryReached: false, timeoutReached: true, shouldResolve: true }
  }
  return { decision: 'PENDING', quietBoundaryReached: false, timeoutReached: false, shouldResolve: false }
}

// ── P0-A: Token-only Empty DOM Normalization ─────────────────────────

export type EmptyDomNormalizeDecision =
  | 'NORMALIZED_TO_NATIVE_EMPTY'
  | 'ALREADY_NATIVE_EMPTY'
  | 'BLOCK_UNSAFE_STRUCTURE'

export interface EmptyDomNormalizeInput {
  txnId: string
  runtimeId: string
  paragraph: HTMLElement
}

export interface EmptyDomNormalizeResult {
  txnId: string
  runtimeId: string
  beforeInnerHTML: string
  afterInnerHTML: string
  beforeChildNodeCount: number
  afterChildNodeCount: number
  beforeVisibleText: string
  afterVisibleText: string
  nativeEmptyEquivalentBefore: boolean
  nativeEmptyEquivalentAfter: boolean
  markdownContentChanged: boolean
  decision: EmptyDomNormalizeDecision
  overall: boolean
  /** Predicate analysis of the single span child (null when there is no single span). */
  spanPredicate: EmptySpanPredicateResult | null
}

export function isNativeEmptyParagraph(p: HTMLElement): boolean {
  return p.childNodes.length === 0 && (p.textContent ?? '') === ''
}

/**
 * P0-A forensic predicate for a candidate empty md-plain span.
 *
 * Safe shape (exact):
 *   tagName == span, md-inline == "plain", class contains md-plain AND md-expand,
 *   no element children, no unknown node types, and every Text node has
 *   nodeValue === "" (ZERO-LENGTH). 0 child nodes OR 1+ Text("") are allowed.
 *
 * Rejected (never treated as empty):
 *   Text(" "), Text("\n"), Text("\t"), nested element, link, code, image,
 *   or any unknown inline child.
 *
 * `trim()` is deliberately NOT used — a whitespace-only text node must NOT be
 * treated as empty content.
 */
export interface EmptySpanPredicateResult {
  spanTag: string
  mdInlineValue: string
  classList: string[]
  spanChildNodeCount: number
  spanTextNodeCount: number
  spanElementChildCount: number
  textNodeValues: string[]
  spanTextContent: string
  hasNestedElement: boolean
  hasNonTextNode: boolean
  hasNonEmptyTextNode: boolean
  matchesExpectedMdPlainShape: boolean
  safeEmptyTextShape: boolean
  rejectReason: string | null
  decision: 'SAFE_EMPTY' | 'REJECT'
}

export function analyzeEmptyMdPlainSpan(el: Element): EmptySpanPredicateResult {
  const spanTag = el.tagName.toLowerCase()
  const mdInlineValue = el.getAttribute('md-inline') ?? ''
  const classList = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean)

  const childNodes: Node[] = []
  el.childNodes.forEach(c => childNodes.push(c))
  const spanChildNodeCount = childNodes.length

  let spanTextNodeCount = 0
  let spanElementChildCount = 0
  const textNodeValues: string[] = []
  let hasNestedElement = false
  let hasNonTextNode = false
  let hasNonEmptyTextNode = false

  for (const c of childNodes) {
    if (c.nodeType === 3 /* TEXT_NODE */) {
      spanTextNodeCount++
      const v = c.nodeValue ?? ''
      textNodeValues.push(v)
      if (v !== '') hasNonEmptyTextNode = true
    } else if (c.nodeType === 1 /* ELEMENT_NODE */) {
      spanElementChildCount++
      hasNestedElement = true
    } else {
      hasNonTextNode = true
    }
  }

  const spanTextContent = el.textContent ?? ''
  const matchesExpectedMdPlainShape =
    spanTag === 'span' &&
    mdInlineValue === 'plain' &&
    classList.includes('md-plain') &&
    classList.includes('md-expand')

  const safeEmptyTextShape =
    !hasNestedElement &&
    !hasNonTextNode &&
    !hasNonEmptyTextNode

  let rejectReason: string | null = null
  if (!matchesExpectedMdPlainShape) {
    rejectReason = 'shape-mismatch'
  } else if (!safeEmptyTextShape) {
    if (hasNestedElement) rejectReason = 'has-nested-element'
    else if (hasNonTextNode) rejectReason = 'has-non-text-node'
    else if (hasNonEmptyTextNode) rejectReason = 'has-non-empty-text-node'
    else rejectReason = 'unsafe-shape'
  }

  return {
    spanTag,
    mdInlineValue,
    classList,
    spanChildNodeCount,
    spanTextNodeCount,
    spanElementChildCount,
    textNodeValues,
    spanTextContent,
    hasNestedElement,
    hasNonTextNode,
    hasNonEmptyTextNode,
    matchesExpectedMdPlainShape,
    safeEmptyTextShape,
    rejectReason,
    decision: matchesExpectedMdPlainShape && safeEmptyTextShape ? 'SAFE_EMPTY' : 'REJECT',
  }
}

/**
 * P0-A: Safely restore a token-consumed empty paragraph to the Typora-native
 * empty representation `<p></p>` (or strictly equivalent native empty).
 *
 * ONLY normalizes when the paragraph contains exactly one safe empty md-plain /
 * md-expand span (per analyzeEmptyMdPlainSpan). Any other structure (non-empty
 * text, links, emphasis, code, image, multiple/unknown siblings) is
 * BLOCK_UNSAFE_STRUCTURE — never blindly deleted. Never inserts invisible
 * Markdown characters.
 *
 * Mutates `paragraph` (removing the empty span) only on the NORMALIZED decision.
 */
export function normalizeTokenConsumedEmptyParagraph(input: EmptyDomNormalizeInput): EmptyDomNormalizeResult {
  const p = input.paragraph
  const beforeInnerHTML = p.innerHTML
  const beforeChildNodeCount = p.childNodes.length
  const beforeVisibleText = p.textContent ?? ''
  const nativeEmptyEquivalentBefore = isNativeEmptyParagraph(p)

  const base = {
    txnId: input.txnId,
    runtimeId: input.runtimeId,
    beforeInnerHTML,
    beforeChildNodeCount,
    beforeVisibleText,
    nativeEmptyEquivalentBefore,
  }

  if (nativeEmptyEquivalentBefore) {
    return {
      ...base,
      afterInnerHTML: beforeInnerHTML,
      afterChildNodeCount: beforeChildNodeCount,
      afterVisibleText: beforeVisibleText,
      nativeEmptyEquivalentAfter: true,
      markdownContentChanged: false,
      decision: 'ALREADY_NATIVE_EMPTY',
      overall: true,
      spanPredicate: null,
    }
  }

  const children: Node[] = []
  p.childNodes.forEach(c => children.push(c))

  const isSingleSpanElement = children.length === 1 && children[0] instanceof Element
  const spanPredicate: EmptySpanPredicateResult | null = isSingleSpanElement
    ? analyzeEmptyMdPlainSpan(children[0] as Element)
    : null
  const isSingleEmptyMdPlainSpan = isSingleSpanElement && spanPredicate !== null && spanPredicate.decision === 'SAFE_EMPTY'

  if (!isSingleEmptyMdPlainSpan) {
    return {
      ...base,
      afterInnerHTML: beforeInnerHTML,
      afterChildNodeCount: beforeChildNodeCount,
      afterVisibleText: beforeVisibleText,
      nativeEmptyEquivalentAfter: false,
      markdownContentChanged: false,
      decision: 'BLOCK_UNSAFE_STRUCTURE',
      overall: false,
      spanPredicate,
    }
  }

  p.removeChild(children[0])

  const afterInnerHTML = p.innerHTML
  const afterChildNodeCount = p.childNodes.length
  const afterVisibleText = p.textContent ?? ''
  const nativeEmptyEquivalentAfter = isNativeEmptyParagraph(p)

  return {
    ...base,
    afterInnerHTML,
    afterChildNodeCount,
    afterVisibleText,
    nativeEmptyEquivalentAfter,
    markdownContentChanged: beforeVisibleText !== afterVisibleText,
    decision: 'NORMALIZED_TO_NATIVE_EMPTY',
    overall: nativeEmptyEquivalentAfter,
    spanPredicate,
  }
}

// ── P0-B: terminal cleanup guard ─────────────────────────────────────

/**
 * Only clear the active txn binding when it is the SAME txn being closed.
 * Guarantees closing an OLD txn never clears a NEWER active txn.
 */
export function shouldClearActiveTxn(activeTxnId: string | null | undefined, closingTxnId: string): boolean {
  return activeTxnId === closingTxnId
}

// ── P0-VC: Empty-Only Visual Caret Projection ────────────────────────

/**
 * How a force-indent paragraph is visually projected.
 *
 *   TEXT_INDENT    — non-empty paragraph: text-indent:2em pushes the first line.
 *   EMPTY_PADDING  — native-empty paragraph: text-indent does NOT move a collapsed
 *                    caret in an empty block, so padding-inline-start:2em is used.
 *   NONE           — not force-indent (auto / flush), no empty projection.
 */
export type EmptyProjectionMode = 'TEXT_INDENT' | 'EMPTY_PADDING' | 'NONE'

export type EmptySemanticMode = 'force-indent' | 'force-flush' | 'auto'

/** Decide the visual projection mode for a paragraph from semantic + empty state. */
export function decideEmptyProjectionMode(
  isNativeEmpty: boolean,
  semanticMode: EmptySemanticMode,
): EmptyProjectionMode {
  if (semanticMode === 'force-indent') {
    return isNativeEmpty ? 'EMPTY_PADDING' : 'TEXT_INDENT'
  }
  return 'NONE'
}

export interface EmptyVisualCaretGeometryInput {
  fontSizePx: number
  expectedIndentPx: number
  projectionMode: EmptyProjectionMode
  /** getBoundingClientRect().left of the paragraph border box. */
  paragraphRectLeft: number
  /** Computed border-inline-start width (px). */
  borderInlineStartWidth: number
  /** Computed padding-inline-start (px). */
  paddingInlineStart: number
  /** Computed text-indent (px, may be 0). */
  textIndentPx: number
  /** Collapsed caret range left (px). */
  caretRectLeft: number
  tolerancePx: number
  logicalOffset: number
}

export interface EmptyVisualCaretGeometryResult {
  fontSizePx: number
  expectedIndentPx: number
  projectionMode: EmptyProjectionMode
  paragraphRectLeft: number
  borderInlineStartWidth: number
  paddingInlineStart: number
  textIndentPx: number
  /** Content box left = rect.left + border + padding. */
  paragraphContentLeft: number
  /**
   * The visual start WITHOUT the projection indent:
   *   EMPTY_PADDING → padding IS the indent, so it is excluded.
   *   TEXT_INDENT / NONE → padding is base layout, so content box is the start.
   */
  unindentedVisualStart: number
  caretRectLeft: number
  actualCaretIndentPx: number
  tolerancePx: number
  logicalOffset: number
  overall: boolean
}

/**
 * P0-VC/Phase-C geometry authority.
 *
 * For EMPTY_PADDING the collapsed caret sits at the content box, which is already
 * shifted by padding-inline-start. Treating the padded content box as the 0 point
 * (the old bug) yields actual=0 even though the caret is correctly indented.
 * `unindentedVisualStart` excludes the projection padding so the padding is counted
 * as the indent.
 */
export function computeEmptyVisualCaretGeometry(
  input: EmptyVisualCaretGeometryInput,
): EmptyVisualCaretGeometryResult {
  const paragraphContentLeft =
    input.paragraphRectLeft + input.borderInlineStartWidth + input.paddingInlineStart
  const unindentedVisualStart =
    input.projectionMode === 'EMPTY_PADDING'
      ? input.paragraphRectLeft + input.borderInlineStartWidth
      : paragraphContentLeft
  const actualCaretIndentPx = input.caretRectLeft - unindentedVisualStart
  const overall = Math.abs(actualCaretIndentPx - input.expectedIndentPx) <= input.tolerancePx

  return {
    fontSizePx: input.fontSizePx,
    expectedIndentPx: input.expectedIndentPx,
    projectionMode: input.projectionMode,
    paragraphRectLeft: input.paragraphRectLeft,
    borderInlineStartWidth: input.borderInlineStartWidth,
    paddingInlineStart: input.paddingInlineStart,
    textIndentPx: input.textIndentPx,
    paragraphContentLeft,
    unindentedVisualStart,
    caretRectLeft: input.caretRectLeft,
    actualCaretIndentPx,
    tolerancePx: input.tolerancePx,
    logicalOffset: input.logicalOffset,
    overall,
  }
}

// ── P0-AC: Failed-Transaction Atomic Commit Gate ─────────────────────

export interface EmptySpecialCommitGateInput {
  /** All pre-canonical verifications passed (semantic/visual/caret logical/caret visual). */
  preCommitVerifyPassed: boolean
  /** Canonical CREATE/UPDATE succeeded after pre-commit verify. */
  canonicalCommitSucceeded: boolean
  /** Final live owner resolved to the committed record. */
  canonicalOwnerCorrect: boolean
}

export type EmptySpecialCommitDecision = 'COMMIT' | 'ROLLBACK'

/**
 * P0-AC: single authority for whether a failed transaction may leave business state.
 * Only a fully verified + successfully committed transaction may COMMIT.
 * Any failure → ROLLBACK (no canonical record, no persistence, no rehydrate winner).
 */
export function decideEmptySpecialCommit(input: EmptySpecialCommitGateInput): EmptySpecialCommitDecision {
  if (!input.preCommitVerifyPassed) return 'ROLLBACK'
  if (!input.canonicalCommitSucceeded) return 'ROLLBACK'
  if (!input.canonicalOwnerCorrect) return 'ROLLBACK'
  return 'COMMIT'
}

// ── P0-VC Phase B: Empty→Nonempty Projection Transition (observability) ──

export interface FirstGlyphVisualGeometryInput {
  paragraphRectLeft: number
  borderInlineStartWidth: number
  firstGlyphRectLeft: number
  expectedIndentPx: number
  tolerancePx: number
}

export interface FirstGlyphVisualGeometryResult {
  paragraphRectLeft: number
  borderInlineStartWidth: number
  unindentedVisualStart: number
  firstGlyphRectLeft: number
  expectedIndentPx: number
  actualFirstGlyphIndentPx: number
  tolerancePx: number
  overall: boolean
}

/**
 * Read-only first-glyph geometry authority for the empty→nonempty transition.
 *
 * For a NON-EMPTY force-indent paragraph, the first glyph visual indent is
 * measured against `paragraphRectLeft + borderInlineStartWidth` (padding is NOT
 * part of the baseline — text-indent already accounts for the visual indent).
 *
 *   actualFirstGlyphIndentPx = firstGlyphRectLeft - unindentedVisualStart
 */
export function computeFirstGlyphVisualGeometry(
  input: FirstGlyphVisualGeometryInput,
): FirstGlyphVisualGeometryResult {
  const unindentedVisualStart = input.paragraphRectLeft + input.borderInlineStartWidth
  const actualFirstGlyphIndentPx = input.firstGlyphRectLeft - unindentedVisualStart
  const overall = Math.abs(actualFirstGlyphIndentPx - input.expectedIndentPx) <= input.tolerancePx
  return {
    paragraphRectLeft: input.paragraphRectLeft,
    borderInlineStartWidth: input.borderInlineStartWidth,
    unindentedVisualStart,
    firstGlyphRectLeft: input.firstGlyphRectLeft,
    expectedIndentPx: input.expectedIndentPx,
    actualFirstGlyphIndentPx,
    tolerancePx: input.tolerancePx,
    overall,
  }
}

export interface EmptyNonemptyProjectionBefore {
  runtimeId: string
  canonicalRecordId: string
  generation: number
  semanticMode: EmptySemanticMode
  visibleText: string
  isNativeEmpty: boolean
  paddingInlineStartPx: number
  textIndentPx: number
  fontSizePx: number
  paragraphRectLeft: number
  borderInlineStartWidth: number
  selectionRuntimeId: string | null
  logicalOffset: number
}

export interface EmptyNonemptyProjectionAfter {
  runtimeId: string
  canonicalRecordId: string
  generation: number
  semanticMode: EmptySemanticMode
  visibleText: string
  isNativeEmpty: boolean
  paddingInlineStartPx: number
  textIndentPx: number
  fontSizePx: number
  paragraphRectLeft: number
  borderInlineStartWidth: number
  firstGlyphRectLeft: number
  selectionRuntimeId: string | null
  logicalOffset: number
  pluginSelectionWriteCount: number
  caretContinuityRestoreCount: number
  caretRepairCount: number
}

export interface EmptyNonemptyProjectionTransitionReport {
  runtimeIdBefore: string
  runtimeIdAfter: string
  canonicalRecordIdBefore: string
  canonicalRecordIdAfter: string
  generationBefore: number
  generationAfter: number
  semanticModeBefore: EmptySemanticMode
  semanticModeAfter: EmptySemanticMode
  visibleTextBefore: string
  visibleTextAfter: string
  isNativeEmptyBefore: boolean
  isNativeEmptyAfter: boolean
  paddingInlineStartBeforePx: number
  paddingInlineStartAfterPx: number
  textIndentBeforePx: number
  textIndentAfterPx: number
  fontSizePx: number
  paragraphRectLeft: number
  unindentedVisualStart: number
  firstGlyphRectLeft: number
  expectedIndentPx: number
  actualFirstGlyphIndentPx: number
  tolerancePx: number
  pluginSelectionWriteCount: number
  caretContinuityRestoreCount: number
  caretRepairCount: number
  canonicalIdentityPreserved: boolean
  projectionExclusive: boolean
  firstGlyphGeometryCorrect: boolean
  selectionOwnershipClean: boolean
  overall: boolean
}

/**
 * Pure gate for whether to emit the empty→nonempty transition observation.
 * Only the FIRST real character (empty → nonempty) on a force-indent canonical
 * paragraph qualifies — never ordinary subsequent characters.
 */
export function shouldEmitEmptyNonemptyTransition(
  isTrustedTextInput: boolean,
  semanticMode: EmptySemanticMode,
  isNativeEmptyBefore: boolean,
  canonicalRecordIdBefore: string | null,
  visibleTextBefore: string,
): boolean {
  if (!isTrustedTextInput) return false
  if (semanticMode !== 'force-indent') return false
  if (!isNativeEmptyBefore) return false
  if (!canonicalRecordIdBefore) return false
  return visibleTextBefore === ''
}

/** Pure evaluation of the empty→nonempty projection transition (Phase B). */
export function evaluateEmptyNonemptyProjectionTransition(
  before: EmptyNonemptyProjectionBefore,
  after: EmptyNonemptyProjectionAfter,
): EmptyNonemptyProjectionTransitionReport {
  const canonicalIdentityPreserved = before.canonicalRecordId === after.canonicalRecordId

  // Padding must exit (32→0) and text-indent must restore (0→32) — never both.
  const projectionExclusive =
    before.paddingInlineStartPx > 0 &&
    after.paddingInlineStartPx === 0 &&
    before.textIndentPx === 0 &&
    after.textIndentPx > 0

  const geometry = computeFirstGlyphVisualGeometry({
    paragraphRectLeft: after.paragraphRectLeft,
    borderInlineStartWidth: after.borderInlineStartWidth,
    firstGlyphRectLeft: after.firstGlyphRectLeft,
    expectedIndentPx: after.fontSizePx * 2,
    tolerancePx: 4,
  })

  const selectionOwnershipClean =
    after.pluginSelectionWriteCount === 0 &&
    after.caretContinuityRestoreCount === 0 &&
    after.caretRepairCount === 0

  const overall =
    canonicalIdentityPreserved &&
    projectionExclusive &&
    geometry.overall &&
    selectionOwnershipClean

  return {
    runtimeIdBefore: before.runtimeId,
    runtimeIdAfter: after.runtimeId,
    canonicalRecordIdBefore: before.canonicalRecordId,
    canonicalRecordIdAfter: after.canonicalRecordId,
    generationBefore: before.generation,
    generationAfter: after.generation,
    semanticModeBefore: before.semanticMode,
    semanticModeAfter: after.semanticMode,
    visibleTextBefore: before.visibleText,
    visibleTextAfter: after.visibleText,
    isNativeEmptyBefore: before.isNativeEmpty,
    isNativeEmptyAfter: after.isNativeEmpty,
    paddingInlineStartBeforePx: before.paddingInlineStartPx,
    paddingInlineStartAfterPx: after.paddingInlineStartPx,
    textIndentBeforePx: before.textIndentPx,
    textIndentAfterPx: after.textIndentPx,
    fontSizePx: after.fontSizePx,
    paragraphRectLeft: after.paragraphRectLeft,
    unindentedVisualStart: geometry.unindentedVisualStart,
    firstGlyphRectLeft: after.firstGlyphRectLeft,
    expectedIndentPx: geometry.expectedIndentPx,
    actualFirstGlyphIndentPx: geometry.actualFirstGlyphIndentPx,
    tolerancePx: geometry.tolerancePx,
    pluginSelectionWriteCount: after.pluginSelectionWriteCount,
    caretContinuityRestoreCount: after.caretContinuityRestoreCount,
    caretRepairCount: after.caretRepairCount,
    canonicalIdentityPreserved,
    projectionExclusive,
    firstGlyphGeometryCorrect: geometry.overall,
    selectionOwnershipClean,
    overall,
  }
}
