/**
 * Caption Service — orchestration layer for Caption System V1.
 *
 * Wires together the pure canonical core (caption-system.ts), the DOM adapter
 * (caption-dom-adapter.ts) and sidecar persistence (caption-store.ts), and
 * exposes the user-facing create / edit / delete / renumber / rehydrate flows.
 *
 * Identity guarantees:
 * - live-session move tracking via bound target roots (same DOM node moves)
 * - cross-session rehydrate uses STRONG anchor resolution only (content
 *   signature + occurrence, or ordinal + neighborhood); ORDINAL_ONLY/AMBIGUOUS
 *   historical anchors are kept ORPHAN and NEVER auto-bind to a new object.
 */

import {
  CaptionRegistry,
  CAPTION_TYPE_CONFIG,
  resolveCaptionNumbers,
  resolveCaptionAnchor,
  renderCaptionLabel,
  type CaptionRecord,
  type CaptionTargetType,
} from './caption-system'
import { CaptionDomAdapter, type CaptionTarget } from './caption-dom-adapter'
import { loadCaptionStore, saveCaptionStore } from './caption-store'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

export interface CaptionServiceContext {
  vaultRoot?: string | null
  getActiveFilePath?: () => string | null
  getDocumentKey?: () => string | null
  getEditorRoot?: () => HTMLElement | null
  onEditorEvent?: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  onWorkspaceEvent?: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  registerDisposable?: (fn: () => void) => void
}

const REFRESH_DELAY_MS = 0

export class CaptionService {
  private registry = new CaptionRegistry()
  private adapter: CaptionDomAdapter
  private ctx: CaptionServiceContext

  /** captionId → live target root (session-only, survives moves). */
  private boundTargets = new Map<string, HTMLElement>()
  /** captionIds kept ORPHAN on rehydrate (never auto-bound). */
  private orphanIds = new Set<string>()

  private currentDocumentKey: string | null = null
  private mutationObserver: MutationObserver | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private disposers: Array<() => void> = []
  private captionSeq = 0
  private started = false
  private lastNumbers = new Map<string, number>()
  private rendering = false

  constructor(ctx: CaptionServiceContext) {
    this.ctx = ctx
    this.adapter = new CaptionDomAdapter(() => ctx.getEditorRoot?.() ?? null)
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  start(): void {
    if (this.started) return
    this.started = true

    const root = this.ctx.getEditorRoot?.() ?? null
    if (root) this.connectObserver(root)

    const onLoad = (editorEl: unknown) => {
      if (editorEl instanceof HTMLElement) {
        this.connectObserver(editorEl)
      }
      this.onDocumentChanged()
    }
    if (this.ctx.onEditorEvent) {
      this.disposers.push(this.ctx.onEditorEvent('load', onLoad))
    }
    if (this.ctx.onWorkspaceEvent) {
      this.disposers.push(this.ctx.onWorkspaceEvent('file:open', () => this.onDocumentChanged()))
    }

    // Initial rehydrate (editor may already be loaded).
    this.onDocumentChanged()
  }

  private onDocumentChanged(): void {
    const docKey = this.ctx.getDocumentKey?.() ?? this.ctx.getActiveFilePath?.() ?? null
    const changed = docKey !== this.currentDocumentKey

    if (changed && this.currentDocumentKey !== null) {
      // Document switch: flush old document bindings (persisted already).
      this.flushDocument()
    }
    this.currentDocumentKey = docKey
    this.rehydrate()
  }

  private flushDocument(): void {
    this.boundTargets.clear()
    this.orphanIds.clear()
  }

  private connectObserver(root: HTMLElement): void {
    this.disconnectObserver()
    this.mutationObserver = new MutationObserver(() => {
      if (this.rendering) return
      this.scheduleRefresh()
    })
    this.mutationObserver.observe(root, { childList: true, subtree: true })
  }

  private disconnectObserver(): void {
    this.mutationObserver?.disconnect()
    this.mutationObserver = null
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) return
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      this.refresh()
    }, REFRESH_DELAY_MS)
  }

  dispose(): void {
    this.disconnectObserver()
    for (const d of this.disposers) { try { d() } catch { /* ignore */ } }
    this.disposers = []
    if (this.refreshTimer !== null) { clearTimeout(this.refreshTimer); this.refreshTimer = null }
    this.started = false
  }

  // ── User-facing actions ───────────────────────────────────────────

  setCaption(type: CaptionTargetType, target: CaptionTarget, title: string): CaptionRecord | null {
    const docKey = this.currentDocumentKey
    if (!docKey) return null

    // Delete any existing caption bound to the same target first (idempotent set).
    const existingId = this.captionIdForRoot(target.root)
    if (existingId) this.deleteCaption(existingId)

    const targets = this.adapter.collectTargets()
    const anchor = this.adapter.computeAnchorForTarget(target, targets)

    const record = this.registry.create({
      captionId: this.nextCaptionId(),
      documentKey: docKey,
      type,
      title,
      targetAnchor: anchor,
    })
    this.boundTargets.set(record.captionId, target.root)
    this.orphanIds.delete(record.captionId)

    emitRuntimeAudit('CAPTION-CREATE', {
      documentKey: docKey,
      captionId: record.captionId,
      type,
      title,
      targetAnchor: anchor,
      decision: 'CREATED',
    })

    this.save()
    this.refresh()
    return record
  }

  editCaption(captionId: string, title: string): CaptionRecord | null {
    const record = this.registry.update(captionId, title)
    if (!record) return null
    emitRuntimeAudit('CAPTION-UPDATE', {
      documentKey: record.documentKey,
      captionId,
      type: record.type,
      title,
      decision: 'UPDATED',
    })
    this.save()
    this.refresh()
    return record
  }

  /** Delete only the caption record; the target object is untouched. */
  deleteCaption(captionId: string): boolean {
    const record = this.registry.getById(captionId)
    if (!record) return false
    const ok = this.registry.delete(captionId)
    this.boundTargets.delete(captionId)
    this.orphanIds.delete(captionId)
    this.adapter.removeCaption(captionId)

    emitRuntimeAudit('CAPTION-DELETE', {
      documentKey: record.documentKey,
      captionId,
      type: record.type,
      decision: 'DELETED',
    })
    this.save()
    this.refresh()
    return ok
  }

  // ── Queries ────────────────────────────────────────────────────────

  resolveTargetForElement(el: Element): CaptionTarget | null {
    return this.adapter.resolveTargetForElement(el)
  }

  getCaptionForTarget(target: CaptionTarget): CaptionRecord | null {
    const id = this.captionIdForRoot(target.root)
    return id ? this.registry.getById(id) : null
  }

  getCaptionForElement(el: Element): CaptionRecord | null {
    const target = this.resolveTargetForElement(el)
    if (!target) return null
    return this.getCaptionForTarget(target)
  }

  getCaptionCount(): number {
    return this.registry.listByDocument(this.currentDocumentKey ?? '').length
  }

  getCaptionById(captionId: string): CaptionRecord | null {
    return this.registry.getById(captionId)
  }

  getOrphanCount(): number {
    return this.orphanIds.size
  }

  /** Resolved display number for a bound caption (null if not bound). */
  getResolvedNumber(captionId: string): number | null {
    return this.lastNumbers.get(captionId) ?? null
  }

  /** Number of captioned targets of a given type in the current document. */
  getTypeCaptionCount(type: CaptionTargetType): number {
    let count = 0
    for (const id of this.boundTargets.keys()) {
      const r = this.registry.getById(id)
      if (r?.type === type) count++
    }
    return count
  }

  private captionIdForRoot(root: HTMLElement): string | null {
    for (const [id, r] of this.boundTargets) {
      if (r === root) return id
    }
    return null
  }

  private nextCaptionId(): string {
    this.captionSeq++
    return `caption-${Date.now().toString(36)}-${this.captionSeq}`
  }

  // ── Reconcile / renumber / render ─────────────────────────────────

  /** Reconcile bound captions against current DOM, then renumber + render. */
  refresh(): void {
    const docKey = this.currentDocumentKey
    if (!docKey) { this.adapter.clearAllCaptions(); return }

    const targets = this.adapter.collectTargets()
    const descriptors = this.adapter.toDescriptors(targets)
    const roots = new Set(targets.map(t => t.root))
    const targetByRoot = new Map(targets.map(t => [t.root, t]))

    // Reconcile live bindings: detect moved (retarget) vs deleted (cleanup).
    for (const [captionId, root] of Array.from(this.boundTargets)) {
      if (roots.has(root) && root.isConnected) {
        const target = targetByRoot.get(root)!
        const anchor = this.adapter.computeAnchorForTarget(target, targets)
        this.registry.retarget(captionId, anchor)
      } else {
        // Target deleted → cleanup record (no orphan projection).
        const record = this.registry.getById(captionId)
        this.registry.delete(captionId)
        this.boundTargets.delete(captionId)
        this.adapter.removeCaption(captionId)
        emitRuntimeAudit('CAPTION-CLEANUP', {
          documentKey: docKey,
          captionId,
          type: record?.type,
          decision: 'TARGET_DELETED',
        })
      }
    }

    // Build document-order list of bound records.
    const globalIndex = new Map<HTMLElement, number>()
    targets.forEach((t, i) => globalIndex.set(t.root, i))

    const ordered: Array<{ captionId: string; type: CaptionTargetType; target: CaptionTarget }> = []
    for (const [captionId, root] of this.boundTargets) {
      const target = targetByRoot.get(root)
      if (!target) continue
      ordered.push({ captionId, type: target.type, target })
    }
    ordered.sort((a, b) => {
      const ia = globalIndex.get(a.target.root) ?? Number.MAX_SAFE_INTEGER
      const ib = globalIndex.get(b.target.root) ?? Number.MAX_SAFE_INTEGER
      return ia - ib
    })

    const numbers = resolveCaptionNumbers(ordered.map(o => ({ captionId: o.captionId, type: o.type })))
    const numberByCaption = new Map(numbers.map(n => [n.captionId, n.number]))
    this.lastNumbers = numberByCaption

    emitRuntimeAudit('CAPTION-RENUMBER', {
      documentKey: docKey,
      captionedCount: ordered.length,
      decision: 'RESOLVED',
    })

    // Re-render (clear all, then project each).
    this.rendering = true
    try {
      this.adapter.clearAllCaptions()
      for (const item of ordered) {
        const record = this.registry.getById(item.captionId)
        if (!record) continue
        const number = numberByCaption.get(item.captionId) ?? 1
        const label = renderCaptionLabel(item.type, number, record.title)
        this.adapter.renderCaption(item.target, label, record.title, item.captionId, CAPTION_TYPE_CONFIG[item.type].position)
      }
    } finally {
      this.rendering = false
    }

    if (ordered.length > 0) {
      emitRuntimeAudit('CAPTION-RENDER', {
        documentKey: docKey,
        renderedCount: ordered.length,
        decision: 'RENDERED',
      })
    }

    this.save()
  }

  /** Load persisted records and strictly resolve + bind. */
  rehydrate(): void {
    const docKey = this.currentDocumentKey
    if (!docKey) { this.adapter.clearAllCaptions(); return }

    const records = loadCaptionStore(docKey)
    if (!records || records.length === 0) {
      this.registry.clearDocument(docKey)
      this.boundTargets.clear()
      this.orphanIds.clear()
      return
    }

    this.registry.rehydrate(docKey, records)
    this.boundTargets.clear()
    this.orphanIds.clear()

    const targets = this.adapter.collectTargets()
    const descriptors = this.adapter.toDescriptors(targets)
    const targetByIndex = new Map(targets.map((t, i) => [i, t]))

    let bound = 0
    let orphaned = 0
    for (const record of records) {
      const result = resolveCaptionAnchor(record.targetAnchor, descriptors)
      emitRuntimeAudit('CAPTION-TARGET-RESOLVE', {
        documentKey: docKey,
        captionId: record.captionId,
        type: record.type,
        targetAnchor: record.targetAnchor,
        decision: result.decision,
        reason: result.reason,
      })
      if (result.decision === 'STRONG' && result.index >= 0) {
        const target = targetByIndex.get(result.index)
        if (target) {
          this.boundTargets.set(record.captionId, target.root)
          this.registry.retarget(record.captionId, this.adapter.computeAnchorForTarget(target, targets))
          bound++
          continue
        }
      }
      this.orphanIds.add(record.captionId)
      orphaned++
    }

    emitRuntimeAudit('CAPTION-REHYDRATE', {
      documentKey: docKey,
      totalRecords: records.length,
      bound,
      orphaned,
      decision: orphaned > 0 ? 'PARTIAL' : 'RESOLVED',
    })

    this.refresh()
  }

  private save(): void {
    const docKey = this.currentDocumentKey
    if (!docKey) return
    const path = this.ctx.getActiveFilePath?.() ?? ''
    saveCaptionStore(docKey, path, this.registry.serialize(docKey))
  }
}
