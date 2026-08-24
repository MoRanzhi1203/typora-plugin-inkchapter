/**
 * Caption DOM Adapter — DOM collection / target resolution / rendering for
 * Caption System V1.
 *
 * All Typora DOM access for table/figure/code captions is concentrated here.
 * Business logic lives in caption-system.ts (pure) and caption-service.ts
 * (orchestration). This adapter is jsdom-testable.
 *
 * Target identity is positional + structural + content-signature corroborated.
 * The target's OWN content is NEVER a sole identity (see resolveCaptionAnchor).
 */

import type {
  CaptionTargetType,
  CaptionTargetAnchor,
  CaptionAnchorDescriptor,
} from './caption-system'
import { hashText } from './paragraph-layout-store'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { forensicVerboseEnabled } from './document-open-perf'

export interface CaptionTarget {
  type: CaptionTargetType
  /** 0-based ordinal among same-type targets in document order. */
  ordinal: number
  /** Block-level DOM wrapper used for rendering + identity. */
  root: HTMLElement
  /** Hash of the target's own content (non-sole identity component). */
  contentSignature?: string
  /** Structural signature of the previous sibling block. */
  beforeFingerprint?: string
  /** Structural signature of the next sibling block. */
  afterFingerprint?: string
  /** For figures: the raw image source path (URL / relative path). */
  src?: string
  /** For figures: the raw Markdown alt projection (Typora img.alt). */
  alt?: string
}

const CAPTION_CLASS = 'inkchapter-caption'
const CAPTION_ATTR = 'data-inkchapter-caption'
const CAPTION_ID_ATTR = 'data-inkchapter-caption-id'
const CAPTION_TYPE_ATTR = 'data-inkchapter-caption-type'
const CAPTION_TITLE_ATTR = 'data-inkchapter-caption-title'
const CAPTION_TARGET_KEY_ATTR = 'data-inkchapter-caption-target-key'

const DOCUMENT_POSITION_FOLLOWING = 4

function isInside(el: Element, selector: string): boolean {
  return !!el.closest(selector)
}

/** Structural-only sibling signature (tagName + first child tagName). */
function siblingSignature(sibling: Element | null): string | undefined {
  if (!sibling) return undefined
  if (sibling.classList.contains(CAPTION_CLASS)) return undefined
  const first = sibling.firstElementChild?.tagName?.toLowerCase() ?? ''
  return `${sibling.tagName.toLowerCase()}${first ? '>' + first : ''}`
}

/** Resolve the immediate element sibling, skipping caption projections. */
function previousElementSibling(el: Element): Element | null {
  let s = el.previousElementSibling
  while (s && s.classList.contains(CAPTION_CLASS)) s = s.previousElementSibling
  return s
}

function nextElementSibling(el: Element): Element | null {
  let s = el.nextElementSibling
  while (s && s.classList.contains(CAPTION_CLASS)) s = s.nextElementSibling
  return s
}

// ── Code candidate classification ────────────────────────────────────

export type CodeCandidateDecision =
  | 'ACCEPT_CANONICAL_FENCE'
  | 'REJECT_CODEMIRROR_INTERNAL'
  | 'REJECT_NESTED_PRE'
  | 'REJECT_MATH_INTERNAL'
  | 'REJECT_NON_FENCE_PRE'
  | 'REJECT_DISCONNECTED'
  | 'REJECT_DUPLICATE_HOST'

export interface CodeDiagnostics {
  rawPreCount: number
  rawMdFencesCount: number
  rawCodeMirrorLineCount: number
  rawCodeMirrorCount: number
  rawMathHostCount: number
  preInsideFenceCount: number
  preInsideMathCount: number
  canonicalFenceCount: number
  rejectedCodeMirrorInternalCount: number
  rejectedMathInternalCount: number
  rejectedNestedPreCount: number
  finalCodeTargetCount: number
}

export const MATH_HOST_SELECTOR = [
  '.md-math-block',
  '.mathjax-block',
  '.MathJax',
  'mjx-container',
  '.md-math',
  '.math-block',
  '.math-display',
].join(',')

const CODE_MIRROR_SELECTOR = '.CodeMirror'

function isCanonicalFence(el: Element): boolean {
  return el.tagName === 'PRE' && el.classList.contains('md-fences')
}

function isInsideCodeMirror(el: Element): boolean {
  return !!el.closest(CODE_MIRROR_SELECTOR)
}

function isInsideMath(el: Element): boolean {
  return !!el.closest(MATH_HOST_SELECTOR)
}

/**
 * Classify a code candidate PRE. Only the canonical Typora fenced-code host
 * (PRE.md-fences) may become a type=code target. CodeMirror internal PRE,
 * math editor internal PRE, and non-fence PRE are all rejected.
 */
function classifyCodeCandidate(el: HTMLElement): { decision: CodeCandidateDecision; reason: string } {
  if (!el.isConnected) return { decision: 'REJECT_DISCONNECTED', reason: 'DISCONNECTED' }
  if (isInsideMath(el)) return { decision: 'REJECT_MATH_INTERNAL', reason: 'MATH_EDITOR_INTERNAL' }
  if (isInsideCodeMirror(el) || el.classList.contains('CodeMirror-line')) {
    return { decision: 'REJECT_CODEMIRROR_INTERNAL', reason: 'CODEMIRROR_INTERNAL' }
  }
  if (isCanonicalFence(el)) return { decision: 'ACCEPT_CANONICAL_FENCE', reason: 'CANONICAL_FENCE' }
  // PRE nested inside another PRE (canonical fence) that is not itself the host.
  if (el.closest('pre')) return { decision: 'REJECT_NESTED_PRE', reason: 'NESTED_CODE_EDITOR_INTERNAL' }
  return { decision: 'REJECT_NON_FENCE_PRE', reason: 'NON_FENCE_PRE' }
}

// ── Idempotent caption reconciliation ──────────────────────────────────

export interface ReconcileItem {
  target: CaptionTarget
  label: string
  title: string
  captionId: string
  position: 'above' | 'below'
}

export interface ReconcileStats {
  createCount: number
  updateCount: number
  moveCount: number
  noOpCount: number
  removeDisabledCount: number
  removeStaleCount: number
}

export interface ReconcileResult {
  stats: ReconcileStats
  createdIds: string[]
}

export type ReconcileDecision =
  | 'CREATE'
  | 'UPDATE_TEXT'
  | 'MOVE'
  | 'NO_OP'
  | 'REMOVE_DISABLED'
  | 'REMOVE_STALE'

/** Unified caption placement model — CREATE / MOVE / NO_OP all use this. */
export interface CaptionPlacement {
  /** Parent that hosts the caption (the target's parent wrapper). */
  parent: HTMLElement | null
  /** The business target root (TABLE / P / PRE.md-fences). */
  target: HTMLElement
  /** Caption goes before the target (above) or after it (below). */
  before: boolean
  /** Stable diagnostic key for the placement. */
  placementKey: string
}

export class CaptionDomAdapter {
  private codeDiagnostics: CodeDiagnostics = {
    rawPreCount: 0, rawMdFencesCount: 0, rawCodeMirrorLineCount: 0, rawCodeMirrorCount: 0,
    rawMathHostCount: 0, preInsideFenceCount: 0, preInsideMathCount: 0,
    canonicalFenceCount: 0, rejectedCodeMirrorInternalCount: 0, rejectedMathInternalCount: 0,
    rejectedNestedPreCount: 0, finalCodeTargetCount: 0,
  }
  /** caption DOM element → owner target root (session-only, survives moves). */
  private captionOwnerRoots = new WeakMap<HTMLElement, HTMLElement>()
  /** owner target root → stable target key (rebuilt on collectTargets). */
  private targetKeysByRoot = new Map<HTMLElement, string>()

  constructor(private getEditorRoot: () => HTMLElement | null) {}

  /** Latest code-scan diagnostics (populated by collectTargets). */
  getCodeDiagnostics(): CodeDiagnostics {
    return { ...this.codeDiagnostics }
  }

  /** Placement diagnostics for each rendered caption (probe evidence). */
  getPlacementDiagnostics(positions?: Record<CaptionTargetType, 'above' | 'below'>): Array<Record<string, unknown>> {
    const root = this.getEditorRoot()
    if (!root) return []
    const out: Array<Record<string, unknown>> = []
    root.querySelectorAll<HTMLElement>(`[${CAPTION_ID_ATTR}]`).forEach(el => {
      const type = (el.getAttribute(CAPTION_TYPE_ATTR) ?? '') as CaptionTargetType | ''
      let desiredPosition: 'above' | 'below' = type === 'figure' ? 'below' : 'above'
      if (type !== '' && positions && positions[type]) {
        desiredPosition = positions[type]
      }
      const owner = this.captionOwnerRoots.get(el) ?? null
      const actualParent = el.parentElement
      const actualPrevious = el.previousElementSibling
      const actualNext = el.nextElementSibling
      let expectedParentTag = 'null'
      let placementMatch = false
      if (owner) {
        const placement = this.resolveCaptionPlacement(
          { type: type as CaptionTargetType, ordinal: 0, root: owner },
          desiredPosition,
        )
        expectedParentTag = placement.parent ? placement.parent.tagName : 'null'
        placementMatch = this.isCorrectlyPlaced(el, placement)
      }
      out.push({
        type,
        desiredPosition,
        actualParentTag: actualParent ? actualParent.tagName : 'null',
        actualPreviousTag: actualPrevious ? actualPrevious.tagName : 'null',
        actualNextTag: actualNext ? actualNext.tagName : 'null',
        expectedParentTag,
        placementMatch,
      })
    })
    return out
  }

  /** Caption owner diagnostics for the probe (evidence of owner mapping). */
  getCaptionOwnerDiagnostics(): Array<Record<string, unknown>> {
    const root = this.getEditorRoot()
    if (!root) return []
    const out: Array<Record<string, unknown>> = []
    root.querySelectorAll<HTMLElement>(`[${CAPTION_ATTR}]`).forEach(el => {
      const owner = this.captionOwnerRoots.get(el) ?? null
      const type = (el.getAttribute(CAPTION_TYPE_ATTR) ?? '') as CaptionTargetType | ''
      out.push({
        text: el.textContent ?? '',
        type,
        targetKey: el.getAttribute(CAPTION_TARGET_KEY_ATTR) ?? '',
        ownerConnected: !!owner && owner.isConnected,
        currentName: el.getAttribute(CAPTION_TITLE_ATTR) ?? '',
      })
    })
    return out
  }

  /**
   * Figure source-edit DOM diagnostics for the image source projection probe.
   * Reports the raw Markdown image token reconstruction and the DOM host that
   * would carry it in edit mode. `canProjectSafely` is conservative: it stays
   * false unless a stable, non-serialized, non-contenteditable projection host
   * is actually detected (never guessed).
   */
  getImageSourceDiagnostics(): Array<Record<string, unknown>> {
    const targets = this.collectTargets().filter(t => t.type === 'figure')
    return targets.map(t => {
      const img = t.root.tagName === 'IMG'
        ? t.root
        : (t.root.querySelector<HTMLElement>('img') ?? null)
      const src = img?.getAttribute('src') ?? t.src ?? ''
      const alt = img?.getAttribute('alt') ?? t.alt ?? ''
      const host = img ?? t.root
      let contentEditable = false
      let node: Element | null = host
      while (node) {
        if (node instanceof HTMLElement && node.getAttribute('contenteditable') === 'true') {
          contentEditable = true
          break
        }
        node = node.parentElement
      }
      return {
        runtimeKey: `${t.type}:${t.contentSignature ?? 'anon'}:${this.computeAnchorForTarget(t, targets).occurrence ?? 1}`,
        rawMarkdownToken: `![${alt}](${src})`,
        rawPath: src,
        sourceHostTag: host.tagName,
        sourceHostClass: String(host.className || '').slice(0, 80),
        contentEditable,
        sourceHostOuterHTMLPreview: host.outerHTML.slice(0, 500),
        canProjectSafely: false,
      }
    })
  }

  /** Collect table / figure / code targets in document order. */
  collectTargets(): CaptionTarget[] {
    const root = this.getEditorRoot()
    if (!root) return []
    const t0 = performance.now()

    interface Raw {
      type: CaptionTargetType
      root: HTMLElement
      contentNode: HTMLElement
    }
    const raw: Raw[] = []

    // Tables (exclude those inside code fences or caption projections).
    root.querySelectorAll<HTMLElement>('table').forEach(t => {
      if (isInside(t, 'pre, code, .md-codeblock')) return
      if (isInside(t, `[${CAPTION_ATTR}]`)) return
      raw.push({ type: 'table', root: t, contentNode: t })
    })

    // Figures (images outside code fences and outside tables).
    root.querySelectorAll<HTMLElement>('img').forEach(img => {
      if (isInside(img, 'pre, code, .md-codeblock, table')) return
      if (isInside(img, `[${CAPTION_ATTR}]`)) return
      const block = img.closest<HTMLElement>('p, figure') ?? img
      raw.push({ type: 'figure', root: block, contentNode: img })
    })

    // Code blocks — canonicalization: only PRE.md-fences is a code target.
    // CodeMirror internal PRE, math editor internal PRE, and nested PRE are rejected.
    const allPres = Array.from(root.querySelectorAll<HTMLElement>('pre'))
    const d = this.codeDiagnostics
    d.rawPreCount = allPres.length
    d.rawMdFencesCount = allPres.filter(p => isCanonicalFence(p)).length
    d.rawCodeMirrorLineCount = allPres.filter(p => p.classList.contains('CodeMirror-line')).length
    d.rawCodeMirrorCount = root.querySelectorAll(CODE_MIRROR_SELECTOR).length
    d.rawMathHostCount = root.querySelectorAll(MATH_HOST_SELECTOR).length
    d.preInsideFenceCount = allPres.filter(p => !isCanonicalFence(p) && !!p.closest('pre.md-fences')).length
    d.preInsideMathCount = allPres.filter(p => isInsideMath(p)).length
    d.canonicalFenceCount = 0
    d.rejectedCodeMirrorInternalCount = 0
    d.rejectedMathInternalCount = 0
    d.rejectedNestedPreCount = 0
    d.finalCodeTargetCount = 0

    const canonicalHosts = new Set<HTMLElement>()
    for (const pre of allPres) {
      if (isInside(pre, `[${CAPTION_ATTR}]`)) continue
      const { decision, reason } = classifyCodeCandidate(pre)
      const mdtype = pre.getAttribute('mdtype') ?? ''
      const closestFence = pre.closest<HTMLElement>('pre.md-fences')
      const closestCodeMirror = !!pre.closest(CODE_MIRROR_SELECTOR)
      const closestMath = !!pre.closest(MATH_HOST_SELECTOR)
      const canonicalHost = isCanonicalFence(pre) ? pre : (closestFence ?? null)

      if (forensicVerboseEnabled()) {
        console.info(
          `[InkChapter Caption] CODE-CANDIDATE-DECISION tag=${pre.tagName} ` +
          `class=${(pre.className || '').slice(0, 60)} mdtype=${mdtype} connected=${pre.isConnected} ` +
          `closestFence=${closestFence ? closestFence.tagName + '.' + (closestFence.className || '').slice(0, 40) : 'none'} ` +
          `closestCodeMirror=${closestCodeMirror} closestMath=${closestMath} ` +
          `canonicalHost=${canonicalHost ? 'PRE.md-fences' : 'none'} ` +
          `decision=${decision} reason=${reason}`,
        )
      }

      if (decision === 'REJECT_CODEMIRROR_INTERNAL') d.rejectedCodeMirrorInternalCount++
      else if (decision === 'REJECT_MATH_INTERNAL') d.rejectedMathInternalCount++
      else if (decision === 'REJECT_NESTED_PRE') d.rejectedNestedPreCount++

      if (decision !== 'ACCEPT_CANONICAL_FENCE') continue
      if (canonicalHosts.has(pre)) continue
      canonicalHosts.add(pre)
      d.canonicalFenceCount++
      raw.push({ type: 'code', root: pre, contentNode: pre })
    }
    d.finalCodeTargetCount = d.canonicalFenceCount

    // Phase 7R.3.9: ONE CODE-CANDIDATE-SUMMARY per scan in normal mode
    // (per-PRE CODE-CANDIDATE-DECISION detail is verbose/failure-only).
    emitRuntimeAudit('CODE-CANDIDATE-SUMMARY', {
      rawPreCount: d.rawPreCount,
      canonicalCodeTargetCount: d.finalCodeTargetCount,
      acceptedCanonicalFenceCount: d.canonicalFenceCount,
      rejectedCodeMirrorInternalCount: d.rejectedCodeMirrorInternalCount,
      rejectedMathCount: d.rejectedMathInternalCount,
      rejectedOtherCount: d.rejectedNestedPreCount,
      durationMs: Math.max(1, Math.round(performance.now() - t0)),
      decision: 'MEASURED',
    })

    // Sort by document order.
    raw.sort((a, b) => {
      if (a.root === b.root) return 0
      const pos = a.root.compareDocumentPosition(b.root)
      if (pos & DOCUMENT_POSITION_FOLLOWING) return -1
      return 1
    })

    // Assign per-type ordinals.
    const counters: Record<CaptionTargetType, number> = { table: 0, figure: 0, code: 0 }
    const targets = raw.map(({ type, root, contentNode }) => {
      const ordinal = counters[type]++
      const isFigure = type === 'figure'
      return {
        type,
        ordinal,
        root,
        contentSignature: this.contentSignature(type, contentNode),
        beforeFingerprint: siblingSignature(previousElementSibling(root)),
        afterFingerprint: siblingSignature(nextElementSibling(root)),
        src: isFigure ? (contentNode.getAttribute('src') ?? '') : undefined,
        alt: isFigure ? (contentNode.getAttribute('alt') ?? '') : undefined,
      }
    })

    // Rebuild the runtime target key registry (root → key) for caption owners.
    this.targetKeysByRoot.clear()
    for (const t of targets) {
      this.targetKeysByRoot.set(t.root, this.targetKeyForTarget(t, targets))
    }

    return targets
  }

  /** Stable diagnostic target key (NOT a persistence key). */
  private targetKeyForTarget(target: CaptionTarget, targets: CaptionTarget[]): string {
    const anchor = this.computeAnchorForTarget(target, targets)
    return `${target.type}:${target.contentSignature ?? 'anon'}:${anchor.occurrence ?? 1}`
  }

  private contentSignature(type: CaptionTargetType, contentNode: HTMLElement): string | undefined {
    if (type === 'figure') {
      const src = contentNode.getAttribute('src') ?? contentNode.getAttribute('alt') ?? ''
      return src ? hashText(src) : undefined
    }
    if (type === 'code' || type === 'table') {
      const text = contentNode.textContent ?? ''
      return text.trim() ? hashText(text.trim()) : undefined
    }
    return undefined
  }

  /** Resolve a clicked/right-clicked element to its containing target. */
  resolveTargetForElement(el: Element): CaptionTarget | null {
    const root = this.getEditorRoot()
    if (!root || !root.contains(el)) return null

    // Caption decoration itself → map back to the owner business target.
    const captionEl = el.closest<HTMLElement>(`[${CAPTION_ATTR}]`)
    if (captionEl) {
      const owner = this.captionOwnerRoots.get(captionEl)
      if (owner && owner.isConnected && root.contains(owner)) {
        return this.resolveTargetForCandidate(owner)
      }
      return null
    }

    return this.resolveTargetForCandidate(el)
  }

  /**
   * Resolve a caption DOM element to its owner root via the runtime owner map.
   * Returns null (→ caller BLOCKs) when the owner is unknown or disconnected,
   * never guessing from adjacent DOM.
   */
  resolveCaptionOwnerRoot(captionEl: HTMLElement): { type: CaptionTargetType; targetKey: string; root: HTMLElement } | null {
    const type = (captionEl.getAttribute(CAPTION_TYPE_ATTR) ?? '') as CaptionTargetType | ''
    if (type !== 'table' && type !== 'figure' && type !== 'code') return null
    const targetKey = captionEl.getAttribute(CAPTION_TARGET_KEY_ATTR) ?? ''
    const owner = this.captionOwnerRoots.get(captionEl) ?? null
    if (!owner || !owner.isConnected) return null
    return { type, targetKey, root: owner }
  }

  /** Resolve a real business element (table cell / img / fence) to a target. */
  private resolveTargetForCandidate(el: Element): CaptionTarget | null {
    let type: CaptionTargetType | null = null
    let targetRoot: HTMLElement | null = null
    let contentNode: HTMLElement | null = null

    const table = el.closest<HTMLElement>('table')
    if (table && !isInside(table, 'pre, code, .md-codeblock')) {
      type = 'table'
      targetRoot = table
      contentNode = table
    } else {
      const img = el instanceof HTMLElement && el.tagName === 'IMG' ? el : el.closest<HTMLElement>('img')
      if (img && !isInside(img, 'pre, code, .md-codeblock, table')) {
        type = 'figure'
        targetRoot = img.closest<HTMLElement>('p, figure') ?? img
        contentNode = img
      } else {
        const fence = el.closest<HTMLElement>('pre.md-fences')
        if (fence && !isInside(fence, 'table') && !isInsideMath(fence)) {
          type = 'code'
          targetRoot = fence
          contentNode = fence
        }
      }
    }

    if (!type || !targetRoot || !contentNode) return null

    // Resolve ordinal by re-collecting and matching the root element.
    const targets = this.collectTargets()
    const match = targets.find(t => t.type === type && t.root === targetRoot)
    return match ?? null
  }

  /** Convert current targets into anchor descriptors for resolution. */
  toDescriptors(targets: CaptionTarget[]): CaptionAnchorDescriptor[] {
    return targets.map(t => ({
      type: t.type,
      ordinal: t.ordinal,
      contentSignature: t.contentSignature,
      beforeFingerprint: t.beforeFingerprint,
      afterFingerprint: t.afterFingerprint,
    }))
  }

  /** Build a persistable anchor for a target within the current document. */
  computeAnchorForTarget(target: CaptionTarget, targets: CaptionTarget[]): CaptionTargetAnchor {
    let occurrence = 1
    if (target.contentSignature) {
      for (const t of targets) {
        if (t.type !== target.type) continue
        if (t.ordinal >= target.ordinal) break
        if (t.contentSignature === target.contentSignature) occurrence++
      }
    }
    return {
      type: target.type,
      ordinal: target.ordinal,
      beforeFingerprint: target.beforeFingerprint,
      afterFingerprint: target.afterFingerprint,
      contentSignature: target.contentSignature,
      occurrence: target.contentSignature ? occurrence : undefined,
    }
  }

  /** Resolve the unified placement model for a target + position. */
  resolveCaptionPlacement(target: CaptionTarget, position: 'above' | 'below'): CaptionPlacement {
    const parent = target.root.parentElement
    const before = position === 'above'
    return {
      parent,
      target: target.root,
      before,
      placementKey: `${before ? 'above' : 'below'}:${parent ? parent.tagName : 'null'}:${target.root.tagName}`,
    }
  }

  /** Insert (or move) a caption element to the resolved placement. */
  insertCaption(el: HTMLElement, placement: CaptionPlacement): void {
    if (!placement.parent) {
      // Fallback: place directly relative to the target root.
      if (placement.before) placement.target.insertAdjacentElement('beforebegin', el)
      else placement.target.insertAdjacentElement('afterend', el)
      return
    }
    const anchor = placement.before ? placement.target : placement.target.nextElementSibling
    placement.parent.insertBefore(el, anchor)
  }

  /** Whether a caption element already sits at the resolved placement. */
  isCorrectlyPlaced(el: HTMLElement, placement: CaptionPlacement): boolean {
    if (el.parentElement !== placement.parent) return false
    if (placement.before) return el.nextElementSibling === placement.target
    return el.previousElementSibling === placement.target
  }

  /** Render a caption projection next to its target. */
  renderCaption(
    target: CaptionTarget,
    label: string,
    title: string,
    captionId: string,
    position: 'above' | 'below',
  ): HTMLElement {
    const el = document.createElement('div')
    el.className = `${CAPTION_CLASS} ${CAPTION_CLASS}-${target.type}`
    el.setAttribute(CAPTION_ATTR, 'true')
    el.setAttribute(CAPTION_ID_ATTR, captionId)
    el.setAttribute(CAPTION_TYPE_ATTR, target.type)
    el.setAttribute(CAPTION_TITLE_ATTR, title)
    el.setAttribute(CAPTION_TARGET_KEY_ATTR, this.targetKeysByRoot.get(target.root) ?? '')
    el.setAttribute('contenteditable', 'false')
    el.textContent = label
    this.captionOwnerRoots.set(el, target.root)

    this.insertCaption(el, this.resolveCaptionPlacement(target, position))
    return el
  }

  /**
   * Idempotently reconcile existing caption projections against the desired
   * state. Unchanged captions are left in place (NO_OP, DOM identity preserved)
   * instead of being removed and recreated, so a stable document produces no
   * new caption decoration mutations.
   */
  reconcileCaptions(
    items: ReconcileItem[],
    disabledTypes: Set<CaptionTargetType> = new Set(),
  ): ReconcileResult {
    const root = this.getEditorRoot()
    const stats: ReconcileStats = {
      createCount: 0, updateCount: 0, moveCount: 0,
      noOpCount: 0, removeDisabledCount: 0, removeStaleCount: 0,
    }
    const createdIds: string[] = []
    if (!root) return { stats, createdIds }

    const desiredIds = new Set(items.map(i => i.captionId))
    const existing = Array.from(root.querySelectorAll<HTMLElement>(`[${CAPTION_ID_ATTR}]`))
    const existingById = new Map<string, HTMLElement>()
    for (const el of existing) {
      const id = el.getAttribute(CAPTION_ID_ATTR)
      if (id) existingById.set(id, el)
    }

    for (const item of items) {
      const existingEl = existingById.get(item.captionId)
      if (!existingEl || !existingEl.isConnected) {
        this.renderCaption(item.target, item.label, item.title, item.captionId, item.position)
        stats.createCount++
        createdIds.push(item.captionId)
        console.info(
          `[InkChapter Caption] RENDER-RECONCILE type=${item.target.type} captionId=${item.captionId} ` +
          `label=${item.label} labelJson=${JSON.stringify(item.label)} decision=CREATE reason=missing-decoration`,
        )
        continue
      }

      const typeChanged = existingEl.getAttribute(CAPTION_TYPE_ATTR) !== item.target.type
      const titleChanged = existingEl.getAttribute(CAPTION_TITLE_ATTR) !== item.title
      const labelChanged = existingEl.textContent !== item.label
      const placement = this.resolveCaptionPlacement(item.target, item.position)
      const positionCorrect = this.isCorrectlyPlaced(existingEl, placement)

      let decision: ReconcileDecision = 'NO_OP'
      let reason = 'state unchanged'
      if (!positionCorrect) {
        decision = 'MOVE'
        reason = 'position changed'
      } else if (labelChanged || typeChanged || titleChanged) {
        decision = 'UPDATE_TEXT'
        reason = 'label/type/title changed'
      }

      if (!positionCorrect) {
        this.insertCaption(existingEl, placement)
      }
      if (labelChanged || titleChanged) {
        existingEl.textContent = item.label
        existingEl.setAttribute(CAPTION_TITLE_ATTR, item.title)
      }
      if (typeChanged) {
        existingEl.setAttribute(CAPTION_TYPE_ATTR, item.target.type)
        existingEl.className = `${CAPTION_CLASS} ${CAPTION_CLASS}-${item.target.type}`
      }
      // Keep owner metadata accurate across reconciliation (target key may shift
      // when a leading object is inserted/deleted even if the caption node is kept).
      const desiredTargetKey = this.targetKeysByRoot.get(item.target.root) ?? ''
      if (existingEl.getAttribute(CAPTION_TARGET_KEY_ATTR) !== desiredTargetKey) {
        existingEl.setAttribute(CAPTION_TARGET_KEY_ATTR, desiredTargetKey)
      }
      this.captionOwnerRoots.set(existingEl, item.target.root)

      if (decision === 'MOVE') stats.moveCount++
      else if (decision === 'UPDATE_TEXT') stats.updateCount++
      else stats.noOpCount++

      console.info(
        `[InkChapter Caption] RENDER-RECONCILE type=${item.target.type} captionId=${item.captionId} ` +
        `label=${item.label} labelJson=${JSON.stringify(item.label)} decision=${decision} reason=${reason}`,
      )
    }

    for (const el of existing) {
      const id = el.getAttribute(CAPTION_ID_ATTR) ?? ''
      if (desiredIds.has(id)) continue
      const typeAttr = el.getAttribute(CAPTION_TYPE_ATTR)
      const type = (typeAttr ?? '') as CaptionTargetType | ''
      const disabled = type !== '' && disabledTypes.has(type)
      el.remove()
      if (disabled) stats.removeDisabledCount++
      else stats.removeStaleCount++
      console.info(
        `[InkChapter Caption] RENDER-RECONCILE type=${type || 'unknown'} captionId=${id} ` +
        `decision=${disabled ? 'REMOVE_DISABLED' : 'REMOVE_STALE'} reason=${disabled ? 'type-disabled' : 'stale-decoration'}`,
      )
    }

    return { stats, createdIds }
  }

  /** Remove all caption projections from the editor. */
  clearAllCaptions(): void {
    const root = this.getEditorRoot()
    if (!root) return
    root.querySelectorAll(`.${CAPTION_CLASS}`).forEach(el => el.remove())
  }

  /** Remove a single caption projection by captionId. */
  removeCaption(captionId: string): void {
    const root = this.getEditorRoot()
    if (!root) return
    root.querySelectorAll(`[${CAPTION_ID_ATTR}="${captionId}"]`).forEach(el => el.remove())
  }
}
