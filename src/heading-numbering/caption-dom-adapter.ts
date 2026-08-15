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
}

const CAPTION_CLASS = 'inkchapter-caption'
const CAPTION_ID_ATTR = 'data-inkchapter-caption-id'
const CAPTION_TYPE_ATTR = 'data-inkchapter-caption-type'
const CAPTION_TITLE_ATTR = 'data-inkchapter-caption-title'

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

export class CaptionDomAdapter {
  constructor(private getEditorRoot: () => HTMLElement | null) {}

  /** Collect table / figure / code targets in document order. */
  collectTargets(): CaptionTarget[] {
    const root = this.getEditorRoot()
    if (!root) return []

    interface Raw {
      type: CaptionTargetType
      root: HTMLElement
      contentNode: HTMLElement
    }
    const raw: Raw[] = []

    // Tables (exclude those inside code fences).
    root.querySelectorAll<HTMLElement>('table').forEach(t => {
      if (isInside(t, 'pre, code, .md-codeblock')) return
      raw.push({ type: 'table', root: t, contentNode: t })
    })

    // Figures (images outside code fences and outside tables).
    root.querySelectorAll<HTMLElement>('img').forEach(img => {
      if (isInside(img, 'pre, code, .md-codeblock, table')) return
      const block = img.closest<HTMLElement>('p, figure') ?? img
      raw.push({ type: 'figure', root: block, contentNode: img })
    })

    // Code blocks (fenced <pre>, outside tables).
    root.querySelectorAll<HTMLElement>('pre').forEach(pre => {
      if (isInside(pre, 'table')) return
      const block = pre.closest<HTMLElement>('.md-codeblock') ?? pre
      raw.push({ type: 'code', root: block, contentNode: pre })
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
    return raw.map(({ type, root, contentNode }) => {
      const ordinal = counters[type]++
      return {
        type,
        ordinal,
        root,
        contentSignature: this.contentSignature(type, contentNode),
        beforeFingerprint: siblingSignature(previousElementSibling(root)),
        afterFingerprint: siblingSignature(nextElementSibling(root)),
      }
    })
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
        const pre = el.closest<HTMLElement>('pre')
        if (pre && !isInside(pre, 'table')) {
          type = 'code'
          targetRoot = pre.closest<HTMLElement>('.md-codeblock') ?? pre
          contentNode = pre
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
    el.setAttribute(CAPTION_ID_ATTR, captionId)
    el.setAttribute(CAPTION_TYPE_ATTR, target.type)
    el.setAttribute(CAPTION_TITLE_ATTR, title)
    el.textContent = label

    if (position === 'below') {
      target.root.insertAdjacentElement('afterend', el)
    } else {
      target.root.parentElement?.insertBefore(el, target.root)
    }
    return el
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
