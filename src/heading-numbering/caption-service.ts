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
  DEFAULT_CAPTION_SETTINGS,
  resolveCaptionAnchor,
  resolveCaptionTypeSettings,
  type CaptionRecord,
  type CaptionTargetType,
  type CaptionTargetAnchor,
  type CaptionSettings,
} from './caption-system'
import * as path from 'path'
import { CaptionDomAdapter, type CaptionTarget, type ReconcileItem, type ReconcileStats } from './caption-dom-adapter'
import { loadCaptionStore, saveCaptionStore } from './caption-store'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { INKCHAPTER_BUILD_ID } from './paragraph-indent-forensic'
import { readImageAlt, escapeMarkdownAlt, unescapeMarkdownAlt } from './figure-alt-binding'
import { imagePathInfo, normalizeLocalImageMarkdownDestination } from './image-path-codec'
import {
  locateMarkdownImageToken,
  parseMarkdownImageTokens,
  patchAltRange,
  patchDestinationRange,
  canonicalizeMarkdownDestination,
  normalizeWindowsPath,
  type MarkdownImageToken,
  type LocateMarkdownImageTokenResult,
} from './figure-token-locator'
import {
  computeObjectNumbers,
  buildObjectNumberingLabel,
  renderNumberingPreview,
  DEFAULT_OBJECT_NUMBERING_CONFIG,
  type ObjectNumberingConfig,
  type ObjectNumberingType,
  type NumberingTarget,
} from './object-numbering-engine'
import { migrateObjectNumberingConfig } from './object-numbering-settings'
import { resolveHeadingContext, chapterFromHeadingNumber, sectionFromHeadingNumber, type HeadingContextEntry, type ResolvedHeadingContext } from './heading-context-resolver'
import { FormulaNumberingAdapter, type FormulaReconcileItem } from './formula-numbering-adapter'
import type { HeadingNumberingSnapshot } from './heading-numbering-snapshot'
import { computeProductionDesiredCaptionStates, type CaptionObjectEntry, type ProductionObjectConfigs } from './caption-semantic-bridge'

export interface CaptionServiceContext {
  vaultRoot?: string | null
  getActiveFilePath?: () => string | null
  getDocumentKey?: () => string | null
  getEditorRoot?: () => HTMLElement | null
  getMarkdown?: () => string
  /** Phase 6: authoritative heading snapshot consumed for Figure/Table/Code numbering. */
  getHeadingNumberingSnapshot?: () => HeadingNumberingSnapshot | null
  reloadContent?: (markdown: string) => void
  /** Read the active .md file bytes from disk (for FAW6 persistence evidence). */
  readActiveFileContent?: () => string | null
  onEditorEvent?: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  onWorkspaceEvent?: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  registerDisposable?: (fn: () => void) => void
}

const REFRESH_DELAY_MS = 0

export type CaptionMutationClassification = 'SELF_ONLY' | 'CONTENT_RELEVANT' | 'MIXED'

/**
 * Classify a mutation batch as caption-decoration-only, real-content, or mixed.
 * Checks target AND addedNodes AND removedNodes so caption insert/remove/text
 * updates (whose target may be a parent container, not the caption itself) are
 * all recognized as self-mutations.
 */
export function classifyCaptionMutationBatch(records: MutationRecord[]): CaptionMutationClassification {
  let captionOnly = 0
  let content = 0
  for (const record of records) {
    const targetIsCaption = record.target instanceof Element
      && !!record.target.closest(`[data-inkchapter-caption]`)
    const addedAllCaption = Array.from(record.addedNodes).every(n =>
      n instanceof Element && (n.matches(`[data-inkchapter-caption]`) || !!n.closest(`[data-inkchapter-caption]`)))
    const removedAllCaption = Array.from(record.removedNodes).every(n =>
      n instanceof Element && (n.matches(`[data-inkchapter-caption]`) || !!n.closest(`[data-inkchapter-caption]`)))
    const hasAdded = record.addedNodes.length > 0
    const hasRemoved = record.removedNodes.length > 0
    const isCaptionMutation = targetIsCaption || (hasAdded && addedAllCaption) || (hasRemoved && removedAllCaption)
    if (isCaptionMutation) captionOnly++
    else content++
  }
  if (captionOnly > 0 && content === 0) return 'SELF_ONLY'
  if (content > 0 && captionOnly === 0) return 'CONTENT_RELEVANT'
  return 'MIXED'
}

/** Resolved naming target for a right-clicked element. */
export interface CaptionNamingTarget {
  type: CaptionTargetType
  canonicalElement: HTMLElement
  /** Stable diagnostic identity (NOT a persistence key; see targetAnchor). */
  runtimeKey: string
  currentNumber: number
  currentName?: string
  recordId: string | null
  documentKey: string | null
  target: CaptionTarget
}

export class CaptionService {
  private registry = new CaptionRegistry()
  private adapter: CaptionDomAdapter
  private formulaAdapter: FormulaNumberingAdapter
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
  private captionSettings: CaptionSettings = DEFAULT_CAPTION_SETTINGS
  private formulaConfig: ObjectNumberingConfig = DEFAULT_OBJECT_NUMBERING_CONFIG.formula
  private currentEditorRoot: HTMLElement | null = null
  private lastRefreshReason = 'none'
  private lastScanAt: number | null = null
  private lastRenderAt: number | null = null
  private lastError: string | null = null
  private captionMutationSelfIgnoredCount = 0
  private captionMutationContentRefreshCount = 0
  private renderStats: ReconcileStats = {
    createCount: 0, updateCount: 0, moveCount: 0,
    noOpCount: 0, removeDisabledCount: 0, removeStaleCount: 0,
  }
  private lastEligibility: Record<CaptionTargetType, { targetCount: number; eligibleCount: number; namedCount: number; renderedCount: number; skippedReasons: string[] }> = {
    table: { targetCount: 0, eligibleCount: 0, namedCount: 0, renderedCount: 0, skippedReasons: [] },
    figure: { targetCount: 0, eligibleCount: 0, namedCount: 0, renderedCount: 0, skippedReasons: [] },
    code: { targetCount: 0, eligibleCount: 0, namedCount: 0, renderedCount: 0, skippedReasons: [] },
  }

  /** Last figure alt write trace (FAW0–FAW5) for runtime probe. */
  private lastFigureAltWrite: {
    runtimeKey: string
    occurrence: number
    oldAlt: string
    newAlt: string
    oldRawPath: string
    newRawPath: string
    sourceMarkdownBefore: string
    sourceMarkdownAfter: string
    editorMarkdownChanged: boolean
    sourceTokenMatched: boolean
    writeMethod: 'MARKDOWN_REWRITE' | 'NONE'
    decision: 'WRITTEN' | 'NO_OP' | 'BLOCK'
    reason: string
    at: number
  } | null = null

  /** Last local image path normalization trace. */
  private lastPathNormalizeDecision: {
    decision: 'WRITTEN' | 'NO_OP' | 'BLOCK'
    normalized: number
    blocked: number
    reason: string
    at: number
  } | null = null

  constructor(ctx: CaptionServiceContext) {
    this.ctx = ctx
    this.adapter = new CaptionDomAdapter(() => this.currentEditorRoot)
    this.formulaAdapter = new FormulaNumberingAdapter(() => this.currentEditorRoot)
    console.info('[InkChapter Caption] SERVICE-CONSTRUCTED')
    emitRuntimeAudit('CAPTION-SERVICE-CONSTRUCTED', { decision: 'CONSTRUCTED' })
  }

  // ── Settings ──────────────────────────────────────────────────────

  /** Apply user caption settings (enabled/position/prefix) and re-render. */
  applySettings(settings: CaptionSettings): void {
    this.captionSettings = settings
    emitRuntimeAudit('CAPTION-SETTINGS-APPLY', {
      tableEnabled: settings.types.table.enabled,
      tablePosition: settings.types.table.position,
      tablePrefix: settings.types.table.prefix,
      figureEnabled: settings.types.figure.enabled,
      figurePosition: settings.types.figure.position,
      figurePrefix: settings.types.figure.prefix,
      codeEnabled: settings.types.code.enabled,
      codePosition: settings.types.code.position,
      codePrefix: settings.types.code.prefix,
      decision: 'APPLIED',
    })
    console.info(
      `[InkChapter Caption] SETTINGS-APPLY ` +
      `table=${settings.types.table.enabled}/${settings.types.table.position}/${settings.types.table.prefix} ` +
      `image=${settings.types.figure.enabled}/${settings.types.figure.position}/${settings.types.figure.prefix} ` +
      `code=${settings.types.code.enabled}/${settings.types.code.position}/${settings.types.code.prefix}`,
    )
    this.refresh()
  }

  getSettings(): CaptionSettings {
    return this.captionSettings
  }

  /** Apply the (independent) formula ObjectNumberingConfig and re-render. */
  applyFormulaSettings(config: ObjectNumberingConfig): void {
    this.formulaConfig = migrateObjectNumberingConfig('formula', config)
    const mode = this.formulaConfig.formulaMode ?? 'typora-native'
    console.info(
      `[InkChapter Numbering] FORMULA-MODE-SWITCH mode=${mode} ` +
      `enabled=${this.formulaConfig.enabled} prefix=${JSON.stringify(this.formulaConfig.prefix)} ` +
      `numberingMode=${this.formulaConfig.numberingMode} template=${JSON.stringify(this.formulaConfig.template)} decision=APPLIED`,
    )
    emitRuntimeAudit('FORMULA-SETTINGS-APPLY', {
      mode,
      enabled: this.formulaConfig.enabled,
      numberingMode: this.formulaConfig.numberingMode,
      template: this.formulaConfig.template,
      decision: 'APPLIED',
    })
    this.refresh()
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  start(): void {
    if (this.started) return
    this.started = true

    console.info('[InkChapter Caption] SERVICE-START')
    emitRuntimeAudit('CAPTION-SERVICE-START', { decision: 'STARTED' })

    // ── External configuration attribution (not a Caption/Alt/Path root cause) ──
    // InkChapter never configures Typora's image uploader; any missing
    // `imageUploader_windows_amd64.exe` error is an external Typora config issue.
    console.info(
      '[InkChapter Caption] IMAGE-UPLOADER-ATTRIBUTION ' +
      'decision=EXTERNAL_CONFIGURATION_ERROR reason=inkchapter-does-not-configure-uploader',
    )

    // ── Late-subscriber catch-up: actively resolve + bind the CURRENT editor ──
    // The editor may already be loaded when the plugin onload runs. Do NOT rely
    // solely on future 'load' / 'file:open' listeners.
    const currentRoot = this.resolveCurrentEditorRoot('startup')
    if (currentRoot) {
      this.bindEditor(currentRoot, 'startup-catchup')
    }

    // Future editor load (new editor instance / first load).
    const onLoad = (editorEl: unknown) => {
      if (editorEl instanceof HTMLElement) {
        this.bindEditor(editorEl, 'editor-load')
      } else {
        const root = this.resolveCurrentEditorRoot('editor-load-fallback')
        if (root) this.bindEditor(root, 'editor-load-fallback')
      }
      this.onDocumentChanged()
    }
    if (this.ctx.onEditorEvent) {
      this.disposers.push(this.ctx.onEditorEvent('load', onLoad))
    }
    if (this.ctx.onWorkspaceEvent) {
      this.disposers.push(this.ctx.onWorkspaceEvent('file:open', () => {
        // File switch: re-resolve root, re-bind if changed, then refresh.
        const root = this.resolveCurrentEditorRoot('file-switch')
        if (root && root !== this.currentEditorRoot) {
          this.bindEditor(root, 'file-switch')
        }
        this.onDocumentChanged()
      }))
    }

    // Register DevTools diagnostic entry points.
    this.registerProbe()

    // Set document key + rehydrate (this also triggers the initial refresh).
    this.onDocumentChanged()
  }

  /** Resolve the current editor root with explicit logging. */
  private resolveCurrentEditorRoot(reason: string): HTMLElement | null {
    const candidates: HTMLElement[] = []
    const fromCtx = this.ctx.getEditorRoot?.() ?? null
    if (fromCtx) candidates.push(fromCtx)

    // Fallback candidates (real Typora editing area may not be #write).
    const byWrite = document.getElementById('write')
    if (byWrite && !candidates.includes(byWrite)) candidates.push(byWrite)
    const byContent = document.querySelector<HTMLElement>('[contenteditable="true"]')
    if (byContent && !candidates.includes(byContent)) candidates.push(byContent)

    let selected: HTMLElement | null = null
    for (const c of candidates) {
      if (c.isConnected) { selected = c; break }
    }
    if (!selected && candidates.length > 0) selected = candidates[0]

    const containsTables = selected ? selected.querySelectorAll('table').length : 0
    console.info(
      `[InkChapter Caption] EDITOR-RESOLVE ` +
      `reason=${reason} candidateCount=${candidates.length} ` +
      `selected=${selected ? selected.tagName + (selected.id ? '#' + selected.id : '') + '.' + (selected.className || '').slice(0, 40) : 'null'} ` +
      `connected=${selected ? selected.isConnected : false} ` +
      `containsTableCount=${containsTables}`,
    )
    emitRuntimeAudit('CAPTION-EDITOR-RESOLVE', {
      reason,
      candidateCount: candidates.length,
      selectedCandidate: selected ? `${selected.tagName}#${selected.id}.${(selected.className || '').slice(0, 40)}` : null,
      connected: selected ? selected.isConnected : false,
      containsTableCount: containsTables,
    })
    if (!selected) {
      this.lastError = `EDITOR_RESOLVE_FAILED reason=${reason}`
    }
    return selected
  }

  /** Bind a specific editor root (connect observer + immediate refresh). */
  private bindEditor(root: HTMLElement, reason: string): void {
    this.currentEditorRoot = root
    this.connectObserver(root)
    console.info(
      `[InkChapter Caption] EDITOR-BOUND ` +
      `reason=${reason} tag=${root.tagName} id=${root.id || ''} ` +
      `class=${(root.className || '').slice(0, 60)} connected=${root.isConnected}`,
    )
    emitRuntimeAudit('CAPTION-EDITOR-BOUND', {
      reason,
      tag: root.tagName,
      id: root.id || '',
      connected: root.isConnected,
      decision: 'BOUND',
    })
    // Immediate refresh — static-open documents must show captions without waiting for a mutation.
    queueMicrotask(() => this.refresh(reason))
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
    this.mutationObserver = new MutationObserver((records) => {
      if (this.rendering) return
      const classification = classifyCaptionMutationBatch(records)
      if (classification === 'SELF_ONLY') {
        this.captionMutationSelfIgnoredCount++
        console.info('[InkChapter Caption] EDITOR-MUTATION decision=IGNORE reason=CAPTION_DECORATION_SELF_MUTATION')
        return
      }
      this.captionMutationContentRefreshCount++
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
    const trimmed = title.trim()

    // Figure name source of truth = Markdown image alt (not sidecar).
    if (type === 'figure') {
      this.writeFigureAlt(target, trimmed)
      this.refresh()
      this.emitFaw('FAW7', 'PASS', 'CAPTION_RECONCILED')
      this.logNameReconcile(type, `auto-figure-${target.ordinal}`, trimmed || '')
      return null
    }

    // Empty name === clear name: keep the numbered caption, drop name metadata.
    if (trimmed === '') {
      const existingId = this.captionIdForRoot(target.root)
      if (existingId) this.deleteCaption(existingId)
      return null
    }

    // Existing name on the same target → edit in place (stable recordId).
    const existingId = this.captionIdForRoot(target.root)
    if (existingId) {
      return this.editCaption(existingId, trimmed)
    }

    const targets = this.adapter.collectTargets()
    const anchor = this.adapter.computeAnchorForTarget(target, targets)
    const record = this.registry.create({
      captionId: this.nextCaptionId(),
      documentKey: docKey,
      type,
      title: trimmed,
      targetAnchor: anchor,
    })
    this.boundTargets.set(record.captionId, target.root)
    this.orphanIds.delete(record.captionId)

    this.logNameSave(docKey, type, record.captionId, anchor, '', trimmed, target.ordinal + 1)
    this.save()
    this.refresh()
    this.logNameReconcile(type, record.captionId, trimmed)
    return record
  }

  editCaption(captionId: string, title: string): CaptionRecord | null {
    const record = this.registry.getById(captionId)
    if (!record) return null
    const trimmed = title.trim()

    // Empty name === clear name.
    if (trimmed === '') {
      this.deleteCaption(captionId)
      return null
    }

    const oldName = record.title
    const updated = this.registry.update(captionId, trimmed)
    if (!updated) return null

    this.logNameSave(record.documentKey, record.type, captionId, record.targetAnchor, oldName, trimmed, this.numberForRoot(this.boundTargets.get(captionId) ?? null))
    this.save()
    this.refresh()
    this.logNameReconcile(record.type, captionId, trimmed)
    return updated
  }

  /** Clear the name only; the numbered caption stays (falls back to number-only). */
  deleteCaption(captionId: string): boolean {
    const record = this.registry.getById(captionId)
    if (!record) return false
    const oldName = record.title
    const type = record.type
    const root = this.boundTargets.get(captionId) ?? null
    const numberAtClear = this.numberForRoot(root)

    const ok = this.registry.delete(captionId)
    this.boundTargets.delete(captionId)
    this.orphanIds.delete(captionId)
    this.adapter.removeCaption(captionId)

    console.info(
      `[InkChapter Caption] NAME-CLEAR type=${type} oldName=${oldName} ` +
      `recordDeleted=${ok} numberAtClear=${numberAtClear} decision=CLEARED`,
    )
    this.save()
    this.refresh()
    this.logNameReconcile(type, captionId, '')
    return ok
  }

  /** Clear the name of a target; figure → clear Markdown alt, table/code → sidecar. */
  clearCaptionName(type: CaptionTargetType, target: CaptionTarget): boolean {
    if (type === 'figure') {
      this.writeFigureAlt(target, '')
      this.refresh()
      this.emitFaw('FAW7', 'PASS', 'CAPTION_RECONCILED')
      this.logNameReconcile(type, `auto-figure-${target.ordinal}`, '')
      return true
    }
    const id = this.captionIdForRoot(target.root)
    return id ? this.deleteCaption(id) : false
  }

  /** Emit one FAW stage log with an explicit PASS/FAIL/UNCERTAIN decision. */
  private emitFaw(stage: string, decision: string, reason: string, detail = ''): void {
    console.info(
      `[InkChapter Caption] FAW stage=${stage} decision=${decision} reason=${reason}${detail ? ' ' + detail : ''}`,
    )
  }

  private documentDirectory(): string | null {
    const fp = this.ctx.getActiveFilePath?.() ?? null
    if (!fp) return null
    try { return path.dirname(fp) } catch { return null }
  }

  private buildHeadingContextEntries(headingEls: HTMLElement[]): HeadingContextEntry[] {
    const counts: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 }
    return headingEls.map((h, i) => {
      const level = parseInt(h.tagName.charAt(1), 10) as 1 | 2 | 3
      counts[level]++
      const number = h.getAttribute('data-inkchapter-heading-number') || String(counts[level])
      return { level, number, documentOrder: i }
    })
  }

  private headingContextForTargetRoot(
    root: HTMLElement,
    headingEls: HTMLElement[],
    entries: HeadingContextEntry[],
    targetType: string,
    runtimeKey: string,
  ): ResolvedHeadingContext {
    let preceding = 0
    for (const h of headingEls) {
      const pos = root.compareDocumentPosition(h)
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) break
      preceding++
    }
    const ctx = resolveHeadingContext(entries, preceding)
    console.info(
      `[InkChapter Numbering] HEADING-CONTEXT targetType=${targetType} runtimeKey=${runtimeKey} ` +
      `nearestH1=${ctx.h1 ?? 'none'} nearestH2=${ctx.h2 ?? 'none'} nearestH3=${ctx.h3 ?? 'none'} ` +
      `chapter=${chapterFromHeadingNumber(ctx.h1)} section=${sectionFromHeadingNumber(ctx.h2)} ` +
      `source=data-inkchapter-heading-number decision=RESOLVED`,
    )
    return ctx
  }

  private logFigureTokenLocator(runtimeKey: string, locate: LocateMarkdownImageTokenResult): void {
    console.info(
      `[InkChapter Caption] FIGURE-TOKEN-LOCATOR runtimeKey=${runtimeKey} ` +
      `runtimeSrcRaw=${JSON.stringify(locate.runtimeSrcRaw)} runtimePathCanonical=${locate.runtimePathCanonical ?? 'none'} ` +
      `documentDirectory=${locate.documentDirectory ?? 'none'} candidateCount=${locate.candidateCount} ` +
      `candidateIndex=${locate.candidateIndex} candidateAlt=${JSON.stringify(locate.candidateAlt ?? '')} ` +
      `candidateDestinationRaw=${JSON.stringify(locate.candidateDestinationRaw ?? '')} ` +
      `candidatePathCanonical=${locate.candidatePathCanonical ?? 'none'} pathMatch=${locate.pathMatch} ` +
      `occurrenceMatch=${locate.occurrenceMatch} decision=${locate.decision} reason=${locate.reason}`,
    )
  }

  private logLpn(stage: string, decision: string, reason: string, detail = ''): void {
    console.info(
      `[InkChapter Caption] LPN stage=${stage} decision=${decision} reason=${reason}${detail ? ' ' + detail : ''}`,
    )
  }

  private logLocalPathNormalize(
    runtimeKey: string,
    occurrence: number,
    rawDestination: string,
    decodedDestination: string,
    destinationKind: string,
    candidateMarkdownDestination: string,
    resolvedFileBefore: string | null,
    resolvedFileAfter: string | null,
    sameFile: boolean,
    decision: string,
    reason: string,
  ): void {
    console.info(
      `[InkChapter Caption] LOCAL-PATH-NORMALIZE runtimeKey=${runtimeKey} tokenOccurrence=${occurrence} ` +
      `rawDestination=${JSON.stringify(rawDestination)} decodedDestination=${JSON.stringify(decodedDestination)} ` +
      `destinationKind=${destinationKind} candidateMarkdownDestination=${JSON.stringify(candidateMarkdownDestination)} ` +
      `resolvedFileBefore=${resolvedFileBefore ?? 'none'} resolvedFileAfter=${resolvedFileAfter ?? 'none'} ` +
      `sameFile=${sameFile} markdownChanged=${decision === 'WRITTEN'} diskPersisted=UNVERIFIED reopenPersisted=UNVERIFIED ` +
      `decision=${decision} reason=${reason}`,
    )
  }

  /**
   * Normalize LOCAL image markdown destinations to a human-readable form by
   * percent-decoding exactly one level and rebuilding a CommonMark destination.
   * Only LOCAL_RELATIVE_PATH / LOCAL_ABSOLUTE_WINDOWS_PATH are touched; remote
   * URLs and data URLs are left byte-for-byte unchanged. Alt is never modified.
   */
  normalizeLocalImagePaths(): { normalized: number; blocked: number; decision: 'WRITTEN' | 'NO_OP' | 'BLOCK' } {
    const getMarkdown = this.ctx.getMarkdown
    const reloadContent = this.ctx.reloadContent
    if (!getMarkdown || !reloadContent) {
      this.lastPathNormalizeDecision = { decision: 'BLOCK', normalized: 0, blocked: 0, reason: 'NO_MARKDOWN_API', at: Date.now() }
      console.info('[InkChapter Caption] LOCAL-PATH-NORMALIZE decision=BLOCK reason=NO_MARKDOWN_API')
      return { normalized: 0, blocked: 0, decision: 'BLOCK' }
    }

    const before = getMarkdown()
    const documentDirectory = this.documentDirectory()
    const tokens = parseMarkdownImageTokens(before)
    const patches: Array<{ token: MarkdownImageToken; newDest: string }> = []
    let normalized = 0
    let blocked = 0

    for (const token of tokens) {
      const occurrence = token.occurrence
      this.logLpn('LPN0', 'PASS', 'TOKEN_FOUND', `alt=${JSON.stringify(token.altRaw)}`)
      const res = normalizeLocalImageMarkdownDestination(token.destinationRaw)
      const isInvalidPercent = res.reason === 'INVALID_PERCENT_ENCODING'
      this.logLpn('LPN1', res.safe ? 'PASS' : (isInvalidPercent ? 'FAIL' : 'SKIP'), 'LOCAL_PATH_CLASSIFIED', `kind=${res.kind}`)

      if (!res.safe) {
        if (isInvalidPercent) blocked++
        this.logLpn('LPN2', 'SKIP', 'DECODED', res.reason)
        this.logLocalPathNormalize('batch', occurrence, token.destinationRaw, res.decoded, res.kind, token.destinationRaw, null, null, false, 'SKIP', res.reason)
        continue
      }

      this.logLpn('LPN2', 'PASS', 'DECODED', `decoded=${JSON.stringify(res.decoded)}`)

      let resolvedFileBefore: string | null = null
      let resolvedFileAfter: string | null = null
      let sameFile = false
      if (documentDirectory) {
        resolvedFileBefore = canonicalizeMarkdownDestination(token.destinationRaw, documentDirectory)
        resolvedFileAfter = normalizeWindowsPath(path.win32.resolve(documentDirectory, res.decoded))
        sameFile = resolvedFileBefore !== null && resolvedFileBefore === resolvedFileAfter
      }

      this.logLpn('LPN3', resolvedFileBefore ? 'PASS' : 'FAIL', 'BEFORE_FILE_RESOLVED', `resolved=${resolvedFileBefore ?? 'none'}`)
      this.logLpn('LPN4', 'PASS', 'DESTINATION_BUILT', `markdownDestination=${JSON.stringify(res.markdownDestination)}`)
      this.logLpn('LPN5', resolvedFileAfter ? 'PASS' : 'FAIL', 'AFTER_FILE_RESOLVED', `resolved=${resolvedFileAfter ?? 'none'}`)
      this.logLpn('LPN6', sameFile ? 'PASS' : 'FAIL', 'SAME_FILE', `sameFile=${sameFile}`)

      if (!res.changed) {
        this.logLocalPathNormalize('batch', occurrence, token.destinationRaw, res.decoded, res.kind, res.markdownDestination, resolvedFileBefore, resolvedFileAfter, sameFile, 'NO_OP', 'ALREADY_READABLE')
        continue
      }
      if (!sameFile) {
        blocked++
        this.logLocalPathNormalize('batch', occurrence, token.destinationRaw, res.decoded, res.kind, res.markdownDestination, resolvedFileBefore, resolvedFileAfter, sameFile, 'BLOCK', 'SAME_FILE_MISMATCH')
        continue
      }

      patches.push({ token, newDest: res.markdownDestination })
      normalized++
      this.logLocalPathNormalize('batch', occurrence, token.destinationRaw, res.decoded, res.kind, res.markdownDestination, resolvedFileBefore, resolvedFileAfter, sameFile, 'WRITTEN', 'NORMALIZED')
    }

    if (patches.length > 0) {
      let after = before
      for (let i = patches.length - 1; i >= 0; i--) {
        after = patchDestinationRange(after, patches[i].token, patches[i].newDest)
      }
      reloadContent(after)
      this.refresh()
      this.logLpn('LPN7', 'PASS', 'MARKDOWN_APPLIED', `normalized=${normalized}`)
      this.lastPathNormalizeDecision = { decision: 'WRITTEN', normalized, blocked, reason: 'normalized', at: Date.now() }
    } else if (blocked > 0) {
      this.lastPathNormalizeDecision = { decision: 'BLOCK', normalized: 0, blocked, reason: 'blocked', at: Date.now() }
    } else {
      this.lastPathNormalizeDecision = { decision: 'NO_OP', normalized: 0, blocked: 0, reason: 'no-local-encoded-paths', at: Date.now() }
    }

    console.info(
      `[InkChapter Caption] LOCAL-PATH-NORMALIZE normalized=${normalized} blocked=${blocked} ` +
      `decision=${this.lastPathNormalizeDecision!.decision} reason=${this.lastPathNormalizeDecision!.reason}`,
    )

    return { normalized, blocked, decision: this.lastPathNormalizeDecision!.decision }
  }

  /**
   * Normalize a single figure's LOCAL destination (explicit per-figure entry).
   * Returns the LPN trace; disk save / reopen persistence remain runtime-only.
   */
  normalizeFigureLocalPath(target: CaptionTarget): { normalized: number; blocked: number; decision: 'WRITTEN' | 'NO_OP' | 'BLOCK' } {
    const getMarkdown = this.ctx.getMarkdown
    const reloadContent = this.ctx.reloadContent
    if (!getMarkdown || !reloadContent) {
      this.lastPathNormalizeDecision = { decision: 'BLOCK', normalized: 0, blocked: 0, reason: 'NO_MARKDOWN_API', at: Date.now() }
      return { normalized: 0, blocked: 0, decision: 'BLOCK' }
    }
    const before = getMarkdown()
    const documentDirectory = this.documentDirectory()
    const targets = this.adapter.collectTargets()
    const occurrence = this.adapter.computeAnchorForTarget(target, targets).occurrence ?? 1
    const locate = locateMarkdownImageToken(before, target.src ?? '', documentDirectory, occurrence)
    this.logFigureTokenLocator(this.runtimeKeyForTarget(target, targets), locate)
    if (!locate.token) {
      this.lastPathNormalizeDecision = { decision: 'BLOCK', normalized: 0, blocked: 1, reason: locate.reason, at: Date.now() }
      return { normalized: 0, blocked: 1, decision: 'BLOCK' }
    }
    const res = normalizeLocalImageMarkdownDestination(locate.token.destinationRaw)
    this.logLpn('LPN0', 'PASS', 'TOKEN_FOUND', `alt=${JSON.stringify(locate.token.altRaw)}`)
    this.logLpn('LPN1', res.safe ? 'PASS' : 'SKIP', 'LOCAL_PATH_CLASSIFIED', `kind=${res.kind}`)
    if (!res.safe || !res.changed) {
      this.lastPathNormalizeDecision = { decision: res.safe ? 'NO_OP' : 'BLOCK', normalized: 0, blocked: res.safe ? 0 : 1, reason: res.reason, at: Date.now() }
      return { normalized: 0, blocked: res.safe ? 0 : 1, decision: res.safe ? 'NO_OP' : 'BLOCK' }
    }
    this.logLpn('LPN2', 'PASS', 'DECODED', `decoded=${JSON.stringify(res.decoded)}`)
    const resolvedBefore = documentDirectory ? canonicalizeMarkdownDestination(locate.token.destinationRaw, documentDirectory) : null
    const resolvedAfter = documentDirectory ? normalizeWindowsPath(path.win32.resolve(documentDirectory, res.decoded)) : null
    const sameFile = resolvedBefore !== null && resolvedBefore === resolvedAfter
    this.logLpn('LPN3', resolvedBefore ? 'PASS' : 'FAIL', 'BEFORE_FILE_RESOLVED', `resolved=${resolvedBefore ?? 'none'}`)
    this.logLpn('LPN4', 'PASS', 'DESTINATION_BUILT', `markdownDestination=${JSON.stringify(res.markdownDestination)}`)
    this.logLpn('LPN5', resolvedAfter ? 'PASS' : 'FAIL', 'AFTER_FILE_RESOLVED', `resolved=${resolvedAfter ?? 'none'}`)
    this.logLpn('LPN6', sameFile ? 'PASS' : 'FAIL', 'SAME_FILE', `sameFile=${sameFile}`)
    if (!sameFile) {
      this.lastPathNormalizeDecision = { decision: 'BLOCK', normalized: 0, blocked: 1, reason: 'SAME_FILE_MISMATCH', at: Date.now() }
      return { normalized: 0, blocked: 1, decision: 'BLOCK' }
    }
    const after = patchDestinationRange(before, locate.token, res.markdownDestination)
    reloadContent(after)
    this.refresh()
    this.logLpn('LPN7', 'PASS', 'MARKDOWN_APPLIED')
    this.lastPathNormalizeDecision = { decision: 'WRITTEN', normalized: 1, blocked: 0, reason: 'normalized', at: Date.now() }
    return { normalized: 1, blocked: 0, decision: 'WRITTEN' }
  }

  /**
   * Write a figure name to the Markdown image alt (canonical source of truth).
   * Never mutates img DOM directly; uses getMarkdown + reloadContent so the
   * Markdown source is the single authority. Only the alt token is rewritten —
   * the image path is never touched.
   */
  private writeFigureAlt(target: CaptionTarget, newAlt: string): void {
    const oldAlt = target.alt ?? ''
    const src = target.src ?? ''
    const getMarkdown = this.ctx.getMarkdown
    const reloadContent = this.ctx.reloadContent

    const targets = this.adapter.collectTargets()
    const anchor = this.adapter.computeAnchorForTarget(target, targets)
    const occurrence = anchor.occurrence ?? 1
    const runtimeKey = this.runtimeKeyForTarget(target, targets)

    // FAW0 (TARGET_RESOLVED) and FAW1 (NAMING_CONTEXT_READY) are emitted by the
    // context-menu resolver; FAW2 (DIALOG_CONFIRMED) is emitted by the dialog.

    if (!getMarkdown || !reloadContent) {
      this.lastFigureAltWrite = {
        runtimeKey, occurrence, oldAlt, newAlt, oldRawPath: src, newRawPath: src,
        sourceMarkdownBefore: '', sourceMarkdownAfter: '', editorMarkdownChanged: false,
        sourceTokenMatched: false, writeMethod: 'NONE', decision: 'BLOCK', reason: 'NO_MARKDOWN_API', at: Date.now(),
      }
      this.emitFaw('FAW3', 'FAIL', 'NO_MARKDOWN_API')
      console.info(
        `[InkChapter Caption] FIGURE-ALT-WRITE runtimeKey=${runtimeKey} occurrence=${occurrence} ` +
        `oldAlt=${JSON.stringify(oldAlt)} newAlt=${JSON.stringify(newAlt)} ` +
        `oldRawPath=${JSON.stringify(src)} newRawPath=${JSON.stringify(src)} ` +
        `sourceMarkdownBefore=${JSON.stringify('')} sourceMarkdownAfter=${JSON.stringify('')} ` +
        `editorMarkdownChanged=false writeMethod=NONE decision=BLOCK reason=NO_MARKDOWN_API`,
      )
      return
    }

    const sourceMarkdownBefore = getMarkdown()
    this.emitFaw('FAW3', 'PASS', 'CURRENT_MARKDOWN_READ', `length=${sourceMarkdownBefore.length}`)

    const documentDirectory = this.documentDirectory()
    const locate = locateMarkdownImageToken(sourceMarkdownBefore, src, documentDirectory, occurrence)
    this.logFigureTokenLocator(runtimeKey, locate)

    if (!locate.token) {
      this.emitFaw('FAW4', 'FAIL', 'IMAGE_TOKEN_MATCHED', `decision=${locate.decision} reason=${locate.reason}`)
      this.emitFaw('FAW5', 'SKIP', 'NO_REWRITE', locate.decision)
      this.lastFigureAltWrite = {
        runtimeKey, occurrence, oldAlt, newAlt, oldRawPath: src, newRawPath: src,
        sourceMarkdownBefore, sourceMarkdownAfter: sourceMarkdownBefore, editorMarkdownChanged: false,
        sourceTokenMatched: false, writeMethod: 'MARKDOWN_REWRITE', decision: 'NO_OP', reason: locate.reason, at: Date.now(),
      }
      console.info(
        `[InkChapter Caption] FIGURE-ALT-WRITE runtimeKey=${runtimeKey} occurrence=${occurrence} ` +
        `oldAlt=${JSON.stringify(oldAlt)} newAlt=${JSON.stringify(newAlt)} ` +
        `oldRawPath=${JSON.stringify(src)} newRawPath=${JSON.stringify(src)} ` +
        `sourceMarkdownBefore=${JSON.stringify(sourceMarkdownBefore)} sourceMarkdownAfter=${JSON.stringify(sourceMarkdownBefore)} ` +
        `editorMarkdownChanged=false writeMethod=MARKDOWN_REWRITE decision=NO_OP reason=${locate.decision}`,
      )
      return
    }

    this.emitFaw('FAW4', 'PASS', 'IMAGE_TOKEN_MATCHED', `occurrence=${occurrence}`)
    const sourceMarkdownAfter = patchAltRange(sourceMarkdownBefore, locate.token, escapeMarkdownAlt(newAlt))
    this.emitFaw('FAW5', 'PASS', 'ALT_REWRITE_PRODUCED')

    reloadContent(sourceMarkdownAfter)

    let editorMarkdownChanged = false
    try {
      const after = getMarkdown()
      const afterLocate = locateMarkdownImageToken(after, src, documentDirectory, occurrence)
      editorMarkdownChanged = afterLocate.token ? (unescapeMarkdownAlt(afterLocate.token.altRaw) === newAlt) : false
    } catch {
      editorMarkdownChanged = false
    }
    this.emitFaw('FAW6', editorMarkdownChanged ? 'PASS' : 'UNCERTAIN', 'EDITOR_MARKDOWN_APPLIED', `editorMarkdownChanged=${editorMarkdownChanged}`)

    this.lastFigureAltWrite = {
      runtimeKey, occurrence, oldAlt, newAlt, oldRawPath: src, newRawPath: src,
      sourceMarkdownBefore, sourceMarkdownAfter, editorMarkdownChanged,
      sourceTokenMatched: true, writeMethod: 'MARKDOWN_REWRITE', decision: 'WRITTEN', reason: 'ok', at: Date.now(),
    }

    console.info(
      `[InkChapter Caption] FIGURE-ALT-WRITE runtimeKey=${runtimeKey} occurrence=${occurrence} ` +
      `oldAlt=${JSON.stringify(oldAlt)} newAlt=${JSON.stringify(newAlt)} ` +
      `oldRawPath=${JSON.stringify(src)} newRawPath=${JSON.stringify(src)} ` +
      `sourceMarkdownBefore=${JSON.stringify(sourceMarkdownBefore)} sourceMarkdownAfter=${JSON.stringify(sourceMarkdownAfter)} ` +
      `editorMarkdownChanged=${editorMarkdownChanged} writeMethod=MARKDOWN_REWRITE decision=WRITTEN reason=ok`,
    )
  }

  /** Migrate a legacy sidecar figure name to Markdown alt (alt wins on conflict). */
  private migrateFigureSidecarName(record: CaptionRecord, target: CaptionTarget): void {
    const sidecarName = record.title.trim()
    const alt = (target.alt ?? '').trim()
    let decision: 'NONE' | 'MIGRATED' | 'ALT_WINS'
    if (alt === '' && sidecarName !== '') {
      decision = 'MIGRATED'
      this.writeFigureAlt(target, sidecarName)
    } else if (alt !== '' && sidecarName !== '' && alt !== sidecarName) {
      decision = 'ALT_WINS'
    } else {
      decision = 'NONE'
    }
    console.info(
      `[InkChapter Caption] FIGURE-NAME-MIGRATION recordId=${record.captionId} ` +
      `sidecarName=${JSON.stringify(sidecarName)} alt=${JSON.stringify(alt)} decision=${decision}`,
    )
  }

  private numberForRoot(root: HTMLElement | null): number {
    if (!root) return 0
    const targets = this.adapter.collectTargets()
    const match = targets.find(t => t.root === root)
    return match ? match.ordinal + 1 : 0
  }

  private logNameSave(
    documentKey: string,
    type: CaptionTargetType,
    recordId: string,
    anchor: CaptionTargetAnchor,
    oldName: string,
    newName: string,
    numberAtSave: number,
  ): void {
    const anchorSummary = `${anchor.type}:${anchor.ordinal}:${anchor.contentSignature ?? 'anon'}:${anchor.occurrence ?? 1}`
    console.info(
      `[InkChapter Caption] NAME-SAVE documentKey=${documentKey} type=${type} recordId=${recordId} ` +
      `numberAtSave=${numberAtSave} oldName=${oldName} newName=${newName} anchorSummary=${anchorSummary} decision=SAVED`,
    )
  }

  private logNameReconcile(type: CaptionTargetType, captionId: string, name: string): void {
    console.info(
      `[InkChapter Caption] NAME-RECONCILE type=${type} captionId=${captionId} ` +
      `name=${name} decision=RECONCILED`,
    )
    // N9 evidence: the caption DOM text after reconcile.
    const el = document.querySelector(`[data-inkchapter-caption-id="${captionId}"]`) as HTMLElement | null
      ?? document.querySelector(`[data-inkchapter-caption-type="${type}"]`) as HTMLElement | null
    console.info(
      `[InkChapter Caption] NAME-UI-TEXT-UPDATED type=${type} captionId=${captionId} ` +
      `text=${el ? el.textContent : 'none'} decision=UPDATED`,
    )
  }

  // ── Queries ────────────────────────────────────────────────────────

  resolveTargetForElement(el: Element): CaptionTarget | null {
    return this.adapter.resolveTargetForElement(el)
  }

  /**
   * Resolve a caption DOM element back to its owner target + naming context.
   * Uses the runtime owner map (targetKey / owner map), never nearest DOM.
   * BLOCKs (returns null) when the owner cannot be reliably resolved.
   */
  resolveCaptionOwner(captionEl: HTMLElement): CaptionNamingTarget | null {
    const eventTargetTag = captionEl.tagName
    const eventTargetClass = String(captionEl.className || '').slice(0, 60)
    const captionType = captionEl.getAttribute('data-inkchapter-caption-type') ?? ''
    const captionText = captionEl.textContent ?? ''
    const targetKey = captionEl.getAttribute('data-inkchapter-caption-target-key') ?? ''

    const owner = this.adapter.resolveCaptionOwnerRoot(captionEl)
    if (!owner) {
      console.info(
        `[InkChapter Caption] NAME-CAPTION-OWNER-RESOLVE eventTargetTag=${eventTargetTag} ` +
        `eventTargetClass=${eventTargetClass} captionFound=true captionType=${captionType} ` +
        `captionText=${JSON.stringify(captionText)} targetKey=${targetKey} runtimeKey=none ` +
        `ownerFound=false ownerTag=none ownerClass=none currentNumber=0 currentName= ` +
        `recordId=none decision=BLOCK reason=CAPTION_OWNER_NOT_FOUND`,
      )
      return null
    }

    const targets = this.adapter.collectTargets()
    const target = targets.find(t => t.type === owner.type && t.root === owner.root)
    if (!target) {
      console.info(
        `[InkChapter Caption] NAME-CAPTION-OWNER-RESOLVE eventTargetTag=${eventTargetTag} ` +
        `eventTargetClass=${eventTargetClass} captionFound=true captionType=${captionType} ` +
        `captionText=${JSON.stringify(captionText)} targetKey=${targetKey} runtimeKey=none ` +
        `ownerFound=false ownerTag=${owner.root.tagName} ownerClass=${String(owner.root.className || '').slice(0, 40)} ` +
        `currentNumber=0 currentName= recordId=none decision=BLOCK reason=CAPTION_OWNER_STALE`,
      )
      return null
    }

    const runtimeKey = this.runtimeKeyForTarget(target, targets)
    let recordId: string | null = null
    let currentName: string | undefined
    if (target.type === 'figure') {
      // Figure name source = Markdown alt (target.alt projection).
      const alt = (target.alt ?? '').trim()
      currentName = alt !== '' ? alt : undefined
    } else {
      recordId = this.captionIdForRoot(target.root)
      const record = recordId ? this.registry.getById(recordId) : null
      currentName = record && record.title.trim() !== '' ? record.title : undefined
    }
    const currentNumber = target.ordinal + 1

    if (target.type === 'figure') {
      this.emitFaw('FAW0', 'PASS', 'TARGET_RESOLVED', `runtimeKey=${runtimeKey} src=${JSON.stringify(target.src ?? '')}`)
      this.emitFaw('FAW1', 'PASS', 'NAMING_CONTEXT_READY', `type=figure currentName=${currentName ?? ''}`)
    }

    console.info(
      `[InkChapter Caption] NAME-CAPTION-OWNER-RESOLVE eventTargetTag=${eventTargetTag} ` +
      `eventTargetClass=${eventTargetClass} captionFound=true captionType=${captionType} ` +
      `captionText=${JSON.stringify(captionText)} targetKey=${targetKey} runtimeKey=${runtimeKey} ` +
      `ownerFound=true ownerTag=${owner.root.tagName} ownerClass=${String(owner.root.className || '').slice(0, 40)} ` +
      `currentNumber=${currentNumber} currentName=${currentName ?? ''} recordId=${recordId ?? 'none'} ` +
      `decision=RESOLVED reason=CAPTION_OWNER`,
    )

    return {
      type: target.type,
      canonicalElement: target.root,
      runtimeKey,
      currentNumber,
      currentName,
      recordId,
      documentKey: this.currentDocumentKey,
      target,
    }
  }

  /** Resolve a right-clicked element to a naming target (with NAME-MENU-RESOLVE). */
  resolveCaptionNamingTarget(el: Element): CaptionNamingTarget | null {
    const eventTargetTag = el.tagName
    const eventTargetClass = el instanceof HTMLElement ? String(el.className).slice(0, 60) : ''

    const target = this.adapter.resolveTargetForElement(el)
    if (!target) {
      console.info(
        `[InkChapter Caption] NAME-MENU-RESOLVE eventTargetTag=${eventTargetTag} ` +
        `eventTargetClass=${eventTargetClass} type=none runtimeKey=none canonicalTag=none ` +
        `canonicalClass=none number=0 hasName=false decision=NO_TARGET reason=not-a-caption-target`,
      )
      return null
    }

    const targets = this.adapter.collectTargets()
    const runtimeKey = this.runtimeKeyForTarget(target, targets)
    let recordId: string | null = null
    let currentName: string | undefined
    if (target.type === 'figure') {
      const alt = (target.alt ?? '').trim()
      currentName = alt !== '' ? alt : undefined
    } else {
      recordId = this.captionIdForRoot(target.root)
      const record = recordId ? this.registry.getById(recordId) : null
      currentName = record && record.title.trim() !== '' ? record.title : undefined
    }
    const currentNumber = target.ordinal + 1
    const documentKey = this.currentDocumentKey

    if (target.type === 'figure') {
      this.emitFaw('FAW0', 'PASS', 'TARGET_RESOLVED', `runtimeKey=${runtimeKey} src=${JSON.stringify(target.src ?? '')}`)
      this.emitFaw('FAW1', 'PASS', 'NAMING_CONTEXT_READY', `type=figure currentName=${currentName ?? ''}`)
    }

    const resolveReason = (() => {
      if (el.closest(`[data-inkchapter-caption]`)) return 'CAPTION_OWNER'
      if (target.type === 'table') {
        const td = el.closest('td, th')
        if (td) return 'TABLE_CELL'
        return el.closest('table') ? 'TABLE_ELEMENT' : 'TABLE_WRAPPER'
      }
      return target.type === 'code' ? 'CODE_FENCE' : 'IMAGE_TARGET'
    })()

    console.info(
      `[InkChapter Caption] NAME-MENU-RESOLVE eventTargetTag=${eventTargetTag} ` +
      `eventTargetClass=${eventTargetClass} type=${target.type} runtimeKey=${runtimeKey} ` +
      `canonicalTag=${target.root.tagName} canonicalClass=${String(target.root.className || '').slice(0, 40)} ` +
      `number=${currentNumber} hasName=${!!currentName} documentKey=${documentKey ?? 'none'} ` +
      `decision=RESOLVED reason=${resolveReason}`,
    )

    return {
      type: target.type,
      canonicalElement: target.root,
      runtimeKey,
      currentNumber,
      currentName,
      recordId,
      documentKey,
      target,
    }
  }

  private runtimeKeyForTarget(target: CaptionTarget, targets: CaptionTarget[]): string {
    const anchor = this.adapter.computeAnchorForTarget(target, targets)
    return `${target.type}:${target.contentSignature ?? 'anon'}:${anchor.occurrence ?? 1}`
  }

  /** Validate a frozen naming snapshot still points at a live target. */
  isNamingTargetValid(target: CaptionNamingTarget): boolean {
    if (!target.canonicalElement.isConnected) return false
    if (target.documentKey !== this.currentDocumentKey) return false
    return true
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
  refresh(reason = 'manual'): void {
    this.lastRefreshReason = reason
    const docKey = this.currentDocumentKey
    const editorRoot = this.currentEditorRoot

    const documentRawTables = document.querySelectorAll('table').length
    const documentRawImages = document.querySelectorAll('img').length
    const documentRawPres = document.querySelectorAll('pre').length
    const editorRawTables = editorRoot ? editorRoot.querySelectorAll('table').length : 0
    const editorRawImages = editorRoot ? editorRoot.querySelectorAll('img').length : 0
    const editorRawPres = editorRoot ? editorRoot.querySelectorAll('pre').length : 0

    if (!docKey) { this.adapter.clearAllCaptions(); this.formulaAdapter.clearAll(); return }

    const targets = this.adapter.collectTargets()
    const descriptors = this.adapter.toDescriptors(targets)
    const roots = new Set(targets.map(t => t.root))
    const targetByRoot = new Map(targets.map(t => [t.root, t]))

    const tableCount = targets.filter(t => t.type === 'table').length
    const imageCount = targets.filter(t => t.type === 'figure').length
    const codeCount = targets.filter(t => t.type === 'code').length
    this.lastScanAt = Date.now()

    console.info(
      `[InkChapter Caption] SCAN reason=${reason} ` +
      `documentRawTables=${documentRawTables} documentRawImages=${documentRawImages} documentRawPres=${documentRawPres} ` +
      `editorRawTables=${editorRawTables} editorRawImages=${editorRawImages} editorRawPres=${editorRawPres} ` +
      `adapterTableTargets=${tableCount} adapterImageTargets=${imageCount} adapterCodeTargets=${codeCount}`,
    )
    emitRuntimeAudit('CAPTION-SCAN', {
      reason,
      documentRawTables,
      documentRawImages,
      documentRawPres,
      editorRawTables,
      editorRawImages,
      editorRawPres,
      adapterTableTargets: tableCount,
      adapterImageTargets: imageCount,
      adapterCodeTargets: codeCount,
      decision: 'SCANNED',
    })

    // ── Minimal debug caption (bypasses sidecar / name / settings / numbering) ──
    if ((window as any).__INKCHAPTER_CAPTION_DEBUG_MINIMAL__) {
      this.renderDebugMinimalCaption(targets)
      return
    }

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

    // ── Build render plan from ALL live targets (document order) ──────
    // New semantics: live target + enabled = must render. Name is optional.
    interface PlanItem {
      target: CaptionTarget
      type: CaptionTargetType
      ordinal: number
      name: string | undefined
      recordId: string | null
    }
    const plan: PlanItem[] = []
    const targetCounts: Record<CaptionTargetType, number> = { table: 0, figure: 0, code: 0 }
    const eligibleCounts: Record<CaptionTargetType, number> = { table: 0, figure: 0, code: 0 }
    const namedCounts: Record<CaptionTargetType, number> = { table: 0, figure: 0, code: 0 }
    const skippedReasons: Record<CaptionTargetType, string[]> = { table: [], figure: [], code: [] }

    for (const target of targets) {
      const type = target.type
      const cfg = resolveCaptionTypeSettings(this.captionSettings, type)
      const ordinal = target.ordinal
      targetCounts[type]++

      let recordId: string | null
      let name: string | undefined
      if (type === 'figure') {
        // Figure name source of truth = Markdown image alt (target.alt projection).
        const rawAlt = target.alt ?? ''
        const alt = rawAlt.trim()
        name = alt !== '' ? alt : undefined
        recordId = null
        console.info(
          `[InkChapter Caption] FIGURE-ALT-READ rawAlt=${JSON.stringify(rawAlt)} ` +
          `normalizedAlt=${JSON.stringify(alt)} captionName=${name ?? ''} decision=READ`,
        )
        console.info(
          `[InkChapter Caption] FIGURE-NAME-SOURCE runtimeKey=${this.runtimeKeyForTarget(target, targets)} ` +
          `rawAlt=${JSON.stringify(rawAlt)} resolvedName=${name ?? ''} ` +
          `source=MARKDOWN_ALT sidecarName= migrationDecision=NONE`,
        )
      } else {
        recordId = this.captionIdForRoot(target.root)
        const record = recordId ? this.registry.getById(recordId) : null
        name = record && record.title.trim() !== '' ? record.title : undefined
      }
      const hasCaptionRecord = type !== 'figure' && !!recordId
      const hasName = !!name

      let decision: 'RENDER' | 'SKIP'
      let reason: string
      if (!cfg.enabled) { decision = 'SKIP'; reason = 'TYPE_DISABLED' }
      else if (!target.root.isConnected) { decision = 'SKIP'; reason = 'TARGET_DISCONNECTED' }
      else { decision = 'RENDER'; reason = 'ENABLED_LIVE_TARGET' }

      console.info(
        `[InkChapter Caption] TARGET-DECISION type=${type} ordinal=${ordinal} ` +
        `targetConnected=${target.root.isConnected} enabled=${cfg.enabled} ` +
        `hasCaptionRecord=${hasCaptionRecord} hasName=${hasName} ` +
        `recordId=${recordId ?? 'none'} resolvedName=${name ?? ''} ` +
        `decision=${decision} reason=${reason}`,
      )
      emitRuntimeAudit('CAPTION-TARGET-DECISION', {
        type, ordinal, targetConnected: target.root.isConnected, enabled: cfg.enabled,
        hasCaptionRecord, hasName, recordId: recordId ?? null, resolvedName: name ?? null,
        decision, reason,
      })

      if (decision === 'SKIP') {
        skippedReasons[type].push(reason)
        continue
      }
      eligibleCounts[type]++
      if (hasName) namedCounts[type]++
      plan.push({ target, type, ordinal, name, recordId })
    }

    const renderedPlanned: Record<CaptionTargetType, number> = { table: 0, figure: 0, code: 0 }
    for (const p of plan) renderedPlanned[p.type]++

    console.info(
      `[InkChapter Caption] RENDER-PLAN ` +
      `tableTargetCount=${targetCounts.table} imageTargetCount=${targetCounts.figure} codeTargetCount=${targetCounts.code} ` +
      `tableEligibleCount=${eligibleCounts.table} imageEligibleCount=${eligibleCounts.figure} codeEligibleCount=${eligibleCounts.code} ` +
      `tableNamedCount=${namedCounts.table} imageNamedCount=${namedCounts.figure} codeNamedCount=${namedCounts.code} ` +
      `tableRenderedPlanned=${renderedPlanned.table} imageRenderedPlanned=${renderedPlanned.figure} codeRenderedPlanned=${renderedPlanned.code}`,
    )
    emitRuntimeAudit('CAPTION-RENDER-PLAN', {
      tableTargetCount: targetCounts.table, imageTargetCount: targetCounts.figure, codeTargetCount: targetCounts.code,
      tableEligibleCount: eligibleCounts.table, imageEligibleCount: eligibleCounts.figure, codeEligibleCount: eligibleCounts.code,
      tableNamedCount: namedCounts.table, imageNamedCount: namedCounts.figure, codeNamedCount: namedCounts.code,
      tableRenderedPlanned: renderedPlanned.table, imageRenderedPlanned: renderedPlanned.figure, codeRenderedPlanned: renderedPlanned.code,
    })

    // Phase 6: compute Figure/Table/Code desired numbers from the canonical
    // HeadingNumberingSnapshot (semantic ordinals) — never DOM heading numbers.
    const snapshot = this.ctx.getHeadingNumberingSnapshot?.() ?? null
    const headingEls = Array.from(this.currentEditorRoot?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6') ?? [])

    const objectEntries: CaptionObjectEntry[] = plan.map(item => {
      let preceding = 0
      for (const h of headingEls) {
        const pos = item.target.root.compareDocumentPosition(h)
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) break
        preceding++
      }
      return {
        stableIdentity: item.recordId ?? this.runtimeKeyForTarget(item.target, targets),
        objectKind: item.type,
        precedingHeadingCount: preceding,
        name: item.name,
      }
    })

    const productionConfigs: ProductionObjectConfigs = {
      figure: migrateObjectNumberingConfig('figure', resolveCaptionTypeSettings(this.captionSettings, 'figure')),
      table: migrateObjectNumberingConfig('table', resolveCaptionTypeSettings(this.captionSettings, 'table')),
      code: migrateObjectNumberingConfig('code', resolveCaptionTypeSettings(this.captionSettings, 'code')),
    }

    const desiredStates = snapshot
      ? computeProductionDesiredCaptionStates(snapshot, objectEntries, productionConfigs)
      : []

    const numbered = plan.map((item, i) => {
      const desired = desiredStates[i]
      return {
        ...item,
        number: desired?.ordinal ?? 0,
        renderedNumber: desired?.rawNumber ?? '',
      }
    })
    for (let i = 0; i < numbered.length; i++) {
      const item = numbered[i]
      const cfg = resolveCaptionTypeSettings(this.captionSettings, item.type)
      console.info(
        `[InkChapter Numbering] NUMBERING-RESULT type=${item.type} mode=${cfg.numberingMode ?? 'continuous'} ` +
        `startAt=${cfg.startAt ?? 1} numberStyle=${cfg.numberStyle ?? 'arabic'} template=${cfg.template ?? '{n}'} ` +
        `sequenceValue=${item.number} renderedNumber=${item.renderedNumber} labelJson=${JSON.stringify(buildObjectNumberingLabel(cfg.prefix, item.renderedNumber, item.name ?? ''))}`,
      )
    }
    this.lastNumbers = new Map()
    for (const item of numbered) {
      if (item.recordId) this.lastNumbers.set(item.recordId, item.number)
    }

    // Re-render via idempotent reconciliation (unchanged captions → NO_OP,
    // DOM identity preserved; no remove-and-recreate churn).
    this.rendering = true
    try {
      const disabledTypes = new Set<CaptionTargetType>()
      for (const t of ['table', 'figure', 'code'] as const) {
        if (!resolveCaptionTypeSettings(this.captionSettings, t).enabled) disabledTypes.add(t)
      }

      const desired: ReconcileItem[] = []
      const labelById = new Map<string, string>()
      for (const item of numbered) {
        const cfg = resolveCaptionTypeSettings(this.captionSettings, item.type)
        const label = buildObjectNumberingLabel(cfg.prefix, item.renderedNumber, item.name ?? '')
        const captionId = item.recordId ?? `auto-${item.type}-${item.ordinal}`
        const insertParentTag = cfg.position === 'above'
          ? (item.target.root.parentElement?.tagName ?? 'null')
          : item.target.root.tagName
        console.info(
          `[InkChapter Caption] RENDER-ATTEMPT type=${item.type} number=${item.number} ` +
          `name=${item.name ?? ''} label=${label} labelJson=${JSON.stringify(label)} ` +
          `targetConnected=${item.target.root.isConnected} targetTag=${item.target.root.tagName} ` +
          `targetClass=${(item.target.root.className || '').slice(0, 40)} insertParentTag=${insertParentTag} ` +
          `position=${cfg.position}`,
        )
        desired.push({ target: item.target, label, title: item.name ?? '', captionId, position: cfg.position })
        labelById.set(captionId, label)
      }

      const result = this.adapter.reconcileCaptions(desired, disabledTypes)
      this.renderStats = result.stats
      for (const id of result.createdIds) {
        this.verifyRender(id, labelById.get(id) ?? '')
      }
    } finally {
      this.rendering = false
    }

    // Persist eligibility stats for probe.
    this.lastEligibility = {
      table: { targetCount: targetCounts.table, eligibleCount: eligibleCounts.table, namedCount: namedCounts.table, renderedCount: renderedPlanned.table, skippedReasons: [...skippedReasons.table] },
      figure: { targetCount: targetCounts.figure, eligibleCount: eligibleCounts.figure, namedCount: namedCounts.figure, renderedCount: renderedPlanned.figure, skippedReasons: [...skippedReasons.figure] },
      code: { targetCount: targetCounts.code, eligibleCount: eligibleCounts.code, namedCount: namedCounts.code, renderedCount: renderedPlanned.code, skippedReasons: [...skippedReasons.code] },
    }

    if (numbered.length > 0) {
      this.lastRenderAt = Date.now()
      emitRuntimeAudit('CAPTION-RENDER', {
        documentKey: docKey,
        renderedCount: numbered.length,
        decision: 'RENDERED',
      })
    }

    this.refreshFormulaNumbering()

    this.save()
  }

  /** Insert a minimal hard-coded debug caption for the first table target. */
  private renderDebugMinimalCaption(targets: CaptionTarget[]): void {
    const firstTable = targets.find(t => t.type === 'table')
    if (!firstTable) {
      console.info('[InkChapter Caption] RENDER-ATTEMPT type=table targetConnected=false reason=no-table-target')
      return
    }
    this.adapter.clearAllCaptions()
    const el = document.createElement('div')
    el.className = 'inkchapter-caption inkchapter-caption-table'
    el.setAttribute('data-inkchapter-caption', 'true')
    el.setAttribute('data-inkchapter-caption-debug', 'true')
    el.setAttribute('contenteditable', 'false')
    el.textContent = 'CAPTION DEBUG · 表 1'
    firstTable.root.parentElement?.insertBefore(el, firstTable.root)
    this.verifyRender('debug-minimal', 'CAPTION DEBUG · 表 1')
  }

  /**
   * Formula numbering runtime pass (P0-C). Reuses the SAME heading context
   * resolver and the SAME shared Numbering Engine — never a second counter.
   */
  private refreshFormulaNumbering(): void {
    const root = this.currentEditorRoot
    if (!root) { this.formulaAdapter.clearAll(); return }

    const config = this.formulaConfig
    const mode = config.formulaMode ?? 'typora-native'
    const enabled = config.enabled
    const formulaTargets = this.formulaAdapter.collectFormulaTargets()

    const headingEls = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3'))
    const headingEntries = this.buildHeadingContextEntries(headingEls)
    const numberingTargets: NumberingTarget[] = formulaTargets.map((t, i) => ({
      type: 'formula',
      documentOrder: i,
      headingContext: this.headingContextForTargetRoot(t.root, headingEls, headingEntries, 'formula', `formula:${i}`),
    }))

    const configs: Record<ObjectNumberingType, ObjectNumberingConfig> = {
      table: migrateObjectNumberingConfig('table', resolveCaptionTypeSettings(this.captionSettings, 'table')),
      figure: migrateObjectNumberingConfig('figure', resolveCaptionTypeSettings(this.captionSettings, 'figure')),
      code: migrateObjectNumberingConfig('code', resolveCaptionTypeSettings(this.captionSettings, 'code')),
      formula: config,
    }
    const results = computeObjectNumbers(numberingTargets, { configs })
    const items: FormulaReconcileItem[] = formulaTargets.map((t, i) => ({
      target: t,
      renderedNumber: results[i].renderedNumber,
      label: results[i].label,
      mode,
      enabled,
    }))

    for (let i = 0; i < items.length; i++) {
      console.info(
        `[InkChapter Numbering] FORMULA-NUMBERING-RESULT type=formula mode=${config.numberingMode} ` +
        `startAt=${config.startAt} numberStyle=${config.numberStyle} template=${JSON.stringify(config.template)} ` +
        `sequenceValue=${results[i].sequenceValue} renderedNumber=${results[i].renderedNumber} ` +
        `labelJson=${JSON.stringify(results[i].label)}`,
      )
    }

    this.rendering = true
    try {
      this.formulaAdapter.reconcile(items)
    } finally {
      this.rendering = false
    }
  }

  /** DevTools probe: block formula count, native detection, mode, double-number evidence. */
  private formulaNumberProbe(): Record<string, unknown> {
    const config = this.formulaConfig
    const mode = config.formulaMode ?? 'typora-native'
    const targets = this.formulaAdapter.collectFormulaTargets()
    const formulas = targets.map(t => ({
      canonicalHost: `${t.root.tagName}.${(t.root.className || '').slice(0, 60)}`,
      nativeNumberFound: !!t.nativeNumberNode,
      nativeNumberText: t.nativeNumberText,
      nativeNumberNode: t.nativeNumberNode
        ? `${t.nativeNumberNode.tagName}.${(t.nativeNumberNode.className || '').slice(0, 40)}`
        : null,
      inkchapterNumberFound: !!t.root.querySelector('[data-inkchapter-formula-number]'),
      mode,
    }))
    const double = this.formulaAdapter.computeDoubleNumber()
    return {
      buildId: INKCHAPTER_BUILD_ID,
      blockFormulaCount: targets.length,
      formulas,
      nativeVisibleCount: double.nativeVisibleCount,
      inkchapterVisibleCount: double.inkchapterVisibleCount,
      doubleNumberDetected: double.doubleNumberDetected,
      mode,
      enabled: config.enabled,
    }
  }

  /** Verify a just-created caption node survives + is visible (sync + RAF). */
  private verifyRender(captionId: string, label: string): void {
    const root = this.currentEditorRoot
    const elInDoc = document.querySelector(`[data-inkchapter-caption-id="${captionId}"]`) as HTMLElement | null
      ?? document.querySelector(`[data-inkchapter-caption-debug="true"]`) as HTMLElement | null
    const captionConnectedSync = elInDoc ? elInDoc.isConnected : false
    const cs = elInDoc ? window.getComputedStyle(elInDoc) : null
    const rect = elInDoc ? elInDoc.getBoundingClientRect() : null
    console.info(
      `[InkChapter Caption] RENDER-VERIFY captionCreated=${!!elInDoc} ` +
      `captionConnectedSync=${captionConnectedSync} ` +
      `captionCountInDocument=${document.querySelectorAll('[data-inkchapter-caption]').length} ` +
      `captionCountInEditorRoot=${root ? root.querySelectorAll('[data-inkchapter-caption]').length : 0} ` +
      `computedDisplay=${cs ? cs.display : 'null'} computedVisibility=${cs ? cs.visibility : 'null'} ` +
      `rectWidth=${rect ? Math.round(rect.width) : 0} rectHeight=${rect ? Math.round(rect.height) : 0} ` +
      `label=${label}`,
    )
    // Async survival check (RAF).
    requestAnimationFrame(() => {
      const el2 = document.querySelector(`[data-inkchapter-caption-id="${captionId}"]`) as HTMLElement | null
        ?? document.querySelector(`[data-inkchapter-caption-debug="true"]`) as HTMLElement | null
      const connected = el2 ? el2.isConnected : false
      const cs2 = el2 ? window.getComputedStyle(el2) : null
      const rect2 = el2 ? el2.getBoundingClientRect() : null
      console.info(
        `[InkChapter Caption] RENDER-VERIFY captionConnectedRAF=${connected} ` +
        `computedDisplay=${cs2 ? cs2.display : 'null'} rectWidth=${rect2 ? Math.round(rect2.width) : 0} rectHeight=${rect2 ? Math.round(rect2.height) : 0}`,
      )
    })
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
      // Sidecar miss must NOT block render: unnamed objects still auto-number.
      this.refresh('rehydrate-empty')
      return
    }

    this.registry.rehydrate(docKey, records)
    this.boundTargets.clear()
    this.orphanIds.clear()

    const targets = this.adapter.collectTargets()
    const descriptors = this.adapter.toDescriptors(targets)
    const targetByIndex = new Map(targets.map((t, i) => [i, t]))

    console.info(
      `[InkChapter Caption] NAME-LOAD storedRecordCount=${records.length} ` +
      `liveTargetCount=${targets.length} decision=LOADED`,
    )

    let bound = 0
    let orphaned = 0
    for (const record of records) {
      const result = resolveCaptionAnchor(record.targetAnchor, descriptors)
      const decision = result.decision === 'STRONG' ? 'MATCH' : 'BLOCK'
      let matchedRuntimeKey = 'none'
      let matched = false
      let figureDropped = false
      if (result.decision === 'STRONG' && result.index >= 0) {
        const target = targetByIndex.get(result.index)
        if (target) {
          matchedRuntimeKey = this.runtimeKeyForTarget(target, targets)
          if (record.type === 'figure') {
            // Figure name now lives in Markdown alt; migrate legacy sidecar name.
            this.migrateFigureSidecarName(record, target)
            this.registry.delete(record.captionId)
            figureDropped = true
          } else {
            this.boundTargets.set(record.captionId, target.root)
            this.registry.retarget(record.captionId, this.adapter.computeAnchorForTarget(target, targets))
            matched = true
          }
        }
      }
      console.info(
        `[InkChapter Caption] NAME-ANCHOR-MATCH recordId=${record.captionId} type=${record.type} ` +
        `matchedRuntimeKey=${matchedRuntimeKey} decision=${decision} reason=${result.reason}`,
      )
      emitRuntimeAudit('CAPTION-ANCHOR-MATCH', {
        documentKey: docKey,
        captionId: record.captionId,
        type: record.type,
        matchedRuntimeKey,
        decision,
        reason: result.reason,
      })
      if (matched) {
        bound++
      } else if (!figureDropped) {
        this.orphanIds.add(record.captionId)
        orphaned++
      }
    }

    console.info(
      `[InkChapter Caption] NAME-LOAD storedRecordCount=${records.length} ` +
      `liveTargetCount=${targets.length} matchedCount=${bound} blockedCount=${orphaned} decision=COMPLETE`,
    )

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

  // ── Runtime diagnostics (DevTools entry points) ───────────────────

  private registerProbe(): void {
    try {
      ;(window as any).__inkchapter_caption_probe__ = () => this.probe()
      ;(window as any).__inkchapter_caption_force_refresh__ = () => this.forceRefresh()
      ;(window as any).__inkchapter_image_source_probe__ = () => this.imageSourceProbe()
      ;(window as any).__inkchapter_figure_alt_write_probe__ = () => this.figureAltWriteProbe()
      ;(window as any).__inkchapter_local_image_path_probe__ = () => this.localImagePathProbe()
      ;(window as any).__inkchapter_normalize_local_image_paths__ = () => this.normalizeLocalImagePaths()
      ;(window as any).__inkchapter_normalize_figure_local_path__ = (index: number) => {
        const targets = this.adapter.collectTargets().filter(t => t.type === 'figure')
        const target = targets[index]
        if (!target) return { ok: false, reason: 'no-figure-at-index' }
        return { ok: true, ...this.normalizeFigureLocalPath(target) }
      }
      ;(window as any).__inkchapter_numbering_preview__ = (type: ObjectNumberingType, overrides?: Partial<ObjectNumberingConfig>) => {
        const config = { ...migrateObjectNumberingConfig(type, resolveCaptionTypeSettings(this.captionSettings, type as CaptionTargetType)), ...overrides }
        return {
          renderedNumber: renderNumberingPreview(type, config, { n: 1, chapter: '2', section: '3', name: '示例' }),
          label: renderNumberingPreview(type, config, { n: 1, chapter: '2', section: '3', name: '示例' }),
          context: { chapter: '2', section: '3', n: '1' },
        }
      }
      ;(window as any).__inkchapter_formula_number_probe__ = () => this.formulaNumberProbe()
      ;(window as any).__inkchapter_caption_set_name__ = (type: CaptionTargetType, index: number, name: string) => {
        const targets = this.adapter.collectTargets().filter(t => t.type === type)
        const target = targets[index]
        if (!target) return { ok: false, reason: 'no-target-at-index' }
        const record = this.setCaption(type, target, String(name ?? ''))
        return { ok: true, recordId: record?.captionId ?? null }
      }
      ;(window as any).__inkchapter_caption_clear_name__ = (type: CaptionTargetType, index: number) => {
        const targets = this.adapter.collectTargets().filter(t => t.type === type)
        const target = targets[index]
        if (!target) return { ok: false, reason: 'no-target-at-index' }
        const id = this.captionIdForRoot(target.root)
        if (!id) return { ok: false, reason: 'not-named' }
        const ok = this.deleteCaption(id)
        return { ok }
      }
    } catch { /* ignore */ }
  }

  probe(): Record<string, unknown> {
    const editorRoot = this.currentEditorRoot
    const settings = this.captionSettings
    const documentRawTableCount = document.querySelectorAll('table').length
    const documentRawImageCount = document.querySelectorAll('img').length
    const documentRawPreCount = document.querySelectorAll('pre').length
    const editorRawTableCount = editorRoot ? editorRoot.querySelectorAll('table').length : 0
    const editorRawImageCount = editorRoot ? editorRoot.querySelectorAll('img').length : 0
    const editorRawPreCount = editorRoot ? editorRoot.querySelectorAll('pre').length : 0

    const targets = this.adapter.collectTargets()
    const adapterTable = targets.filter(t => t.type === 'table').length
    const adapterImage = targets.filter(t => t.type === 'figure').length
    const adapterCode = targets.filter(t => t.type === 'code').length

    const rendered = document.querySelectorAll('[data-inkchapter-caption]')
    const renderedTable = document.querySelectorAll('[data-inkchapter-caption-type="table"]').length
    const renderedImage = document.querySelectorAll('[data-inkchapter-caption-type="figure"]').length
    const renderedCode = document.querySelectorAll('[data-inkchapter-caption-type="code"]').length

    const firstTable = document.querySelector('table')
    let firstTableAncestor = ''
    if (firstTable) {
      const chain: string[] = []
      let p = firstTable.parentElement
      let depth = 0
      while (p && depth < 5) {
        chain.push(`${p.tagName}${p.id ? '#' + p.id : ''}.${(p.className || '').slice(0, 30)}`)
        p = p.parentElement
        depth++
      }
      firstTableAncestor = chain.join(' > ')
    }

    return {
      buildId: INKCHAPTER_BUILD_ID,
      activeDoc: this.ctx.getActiveFilePath?.() ?? null,
      serviceExists: true,
      serviceStarted: this.started,
      editorResolved: !!editorRoot,
      editorRootConnected: editorRoot ? editorRoot.isConnected : false,
      editorRootTag: editorRoot ? editorRoot.tagName : null,
      editorRootClass: editorRoot ? String(editorRoot.className).slice(0, 60) : null,
      editorRootId: editorRoot ? editorRoot.id : null,
      settings: {
        table: { enabled: settings.types.table.enabled, position: settings.types.table.position, prefix: settings.types.table.prefix },
        image: { enabled: settings.types.figure.enabled, position: settings.types.figure.position, prefix: settings.types.figure.prefix },
        code: { enabled: settings.types.code.enabled, position: settings.types.code.position, prefix: settings.types.code.prefix },
      },
      documentCounts: {
        rawTableCount: documentRawTableCount,
        rawImageCount: documentRawImageCount,
        rawPreCount: documentRawPreCount,
        rawCodeBlockCount: documentRawPreCount,
      },
      editorRootCounts: {
        rawTableCount: editorRawTableCount,
        rawImageCount: editorRawImageCount,
        rawPreCount: editorRawPreCount,
        rawCodeBlockCount: editorRawPreCount,
      },
      adapterCounts: { table: adapterTable, image: adapterImage, code: adapterCode, total: adapterTable + adapterImage + adapterCode },
      codeDiagnostics: this.adapter.getCodeDiagnostics(),
      renderedCaptionCounts: { table: renderedTable, image: renderedImage, code: renderedCode, total: rendered.length },
      eligibility: {
        table: { ...this.lastEligibility.table, renderedCount: renderedTable },
        image: { ...this.lastEligibility.figure, renderedCount: renderedImage },
        code: { ...this.lastEligibility.code, renderedCount: renderedCode },
      },
      firstTable: firstTable ? {
        exists: true,
        tagName: firstTable.tagName,
        className: String(firstTable.className).slice(0, 80),
        outerHTMLPreview: firstTable.outerHTML.slice(0, 1500),
        parentTag: firstTable.parentElement?.tagName ?? null,
        parentClass: firstTable.parentElement ? String(firstTable.parentElement.className).slice(0, 80) : null,
        ancestorSummary: firstTableAncestor,
      } : {
        exists: false, tagName: null, className: null, outerHTMLPreview: null,
        parentTag: null, parentClass: null, ancestorSummary: null,
      },
      lastRefreshReason: this.lastRefreshReason,
      lastScanAt: this.lastScanAt,
      lastRenderAt: this.lastRenderAt,
      lastError: this.lastError,
      captionMutationSelfIgnoredCount: this.captionMutationSelfIgnoredCount,
      captionMutationContentRefreshCount: this.captionMutationContentRefreshCount,
      renderStats: { ...this.renderStats },
      naming: this.namingStats(),
      placement: this.adapter.getPlacementDiagnostics({
        table: settings.types.table.position,
        figure: settings.types.figure.position,
        code: settings.types.code.position,
      }),
      captionOwners: this.captionOwnersStats(),
      figures: this.figuresStats(),
      numbering: this.numberingStats(),
    }
  }

  /** Object Numbering V2 summary for the probe (table/figure/code + formula). */
  private numberingStats(): Record<string, unknown> {
    const configs: Record<ObjectNumberingType, ObjectNumberingConfig> = {
      table: migrateObjectNumberingConfig('table', resolveCaptionTypeSettings(this.captionSettings, 'table')),
      figure: migrateObjectNumberingConfig('figure', resolveCaptionTypeSettings(this.captionSettings, 'figure')),
      code: migrateObjectNumberingConfig('code', resolveCaptionTypeSettings(this.captionSettings, 'code')),
      formula: this.formulaConfig,
    }
    const targets = this.adapter.collectTargets().filter(t => t.type === 'table' || t.type === 'figure' || t.type === 'code')
    const results = computeObjectNumbers(targets.map((t, i) => ({ type: t.type as ObjectNumberingType, documentOrder: i })), { configs })

    const out: Record<string, unknown> = {}
    for (const type of ['table', 'figure', 'code'] as const) {
      const cfg = configs[type]
      const typeTargets = targets.filter(t => t.type === type)
      out[type] = {
        enabled: cfg.enabled,
        mode: cfg.numberingMode,
        numberStyle: cfg.numberStyle,
        startAt: cfg.startAt,
        template: cfg.template,
        targetCount: typeTargets.length,
        renderedNumbers: results.filter(r => r.type === type).map(r => r.renderedNumber),
      }
    }
    out.formula = {
      enabled: configs.formula.enabled,
      mode: configs.formula.formulaMode ?? 'typora-native',
      numberStyle: configs.formula.numberStyle,
      startAt: configs.formula.startAt,
      template: configs.formula.template,
      targetCount: this.formulaAdapter.collectFormulaTargets().length,
      renderedNumbers: [],
    }
    return out
  }

  /** Figure alt/path diagnostics for the probe. */
  private figuresStats(): Array<Record<string, unknown>> {
    const targets = this.adapter.collectTargets().filter(t => t.type === 'figure')
    const hasMarkdownApi = !!(this.ctx.getMarkdown && this.ctx.reloadContent)
    return targets.map(t => {
      const rawAlt = t.alt ?? ''
      const rawPath = t.src ?? ''
      const info = imagePathInfo(rawPath)
      const norm = normalizeLocalImageMarkdownDestination(rawPath)
      const captionName = rawAlt.trim() !== '' ? rawAlt.trim() : ''
      const last = this.lastFigureAltWrite
      const isLast = last !== null && last.runtimeKey === this.runtimeKeyForTarget(t, targets)
      console.info(
        `[InkChapter Caption] IMAGE-PATH-CODEC rawPath=${JSON.stringify(rawPath)} ` +
        `kind=${info.kind} decodedDisplay=${JSON.stringify(info.display)} ` +
        `storageCandidate=${JSON.stringify(info.storage)} decodeSucceeded=${info.decodeSucceeded}`,
      )
      return {
        runtimeKey: this.runtimeKeyForTarget(t, targets),
        number: t.ordinal + 1,
        rawAlt,
        captionName,
        nameSource: 'MARKDOWN_ALT',
        rawPath,
        rawDestination: rawPath,
        decodedDestination: norm.decoded,
        normalizedDestination: norm.safe ? norm.markdownDestination : rawPath,
        destinationKind: info.kind,
        pathKind: info.kind,
        displayPath: info.display,
        writebackAvailable: hasMarkdownApi,
        pathNormalizationAvailable: hasMarkdownApi && norm.safe,
        sidecarFigureName: '',
        migrationState: 'NONE',
        sourceTokenMatched: isLast ? last!.sourceTokenMatched : null,
        writeMethod: isLast ? last!.writeMethod : null,
        lastWriteDecision: isLast ? last!.decision : null,
        lastAltWriteDecision: isLast ? last!.decision : null,
        lastPathNormalizeDecision: this.lastPathNormalizeDecision?.decision ?? null,
      }
    })
  }

  /** Local image path probe (raw/decoded/candidates/sameFile). */
  private localImagePathProbe(): Record<string, unknown> {
    const targets = this.adapter.collectTargets().filter(t => t.type === 'figure')
    const items = targets.map(t => {
      const raw = t.src ?? ''
      const res = normalizeLocalImageMarkdownDestination(raw)
      const candidatePlain = res.safe ? res.decoded : raw
      const candidateAngleBracket = res.safe ? `<${res.decoded}>` : raw
      const isLocal = res.kind === 'LOCAL_RELATIVE_PATH' || res.kind === 'LOCAL_ABSOLUTE_WINDOWS_PATH'
      return {
        runtimeKey: this.runtimeKeyForTarget(t, targets),
        raw,
        kind: res.kind,
        decoded: res.decoded,
        candidatePlain,
        candidateAngleBracket,
        // Percent-decoding preserves the referenced file; absolute resolution is runtime-only.
        resolvedFileBefore: raw,
        resolvedFileAfter: res.safe ? res.decoded : raw,
        sameFile: isLocal && res.safe ? true : null,
      }
    })
    return {
      buildId: INKCHAPTER_BUILD_ID,
      activeDoc: this.ctx.getActiveFilePath?.() ?? null,
      figureCount: items.length,
      items,
      lastPathNormalizeDecision: this.lastPathNormalizeDecision ?? null,
    }
  }

  /** Image source projection probe (raw vs decoded display + source host DOM). */
  private imageSourceProbe(): Record<string, unknown> {
    const sourceEditors = this.adapter.getImageSourceDiagnostics().map(item => {
      const rawPath = String(item.rawPath ?? '')
      const info = imagePathInfo(rawPath)
      return {
        ...item,
        decodedDisplayPath: info.display,
      }
    })
    return {
      buildId: INKCHAPTER_BUILD_ID,
      activeDoc: this.ctx.getActiveFilePath?.() ?? null,
      figureCount: sourceEditors.length,
      sourceEditors,
      projectionPolicy: 'storage encoded / display decoded (no inline source DOM rewrite)',
    }
  }

  /** Last figure alt write trace (FAW0–FAW7 are live logs) plus FAW8/FAW9 evidence. */
  private figureAltWriteProbe(): Record<string, unknown> {
    const last = this.lastFigureAltWrite
    let fileSaved: { decision: string; reason: string; persistedAlt: string | null } = { decision: 'UNKNOWN', reason: 'no-write-yet', persistedAlt: null }
    if (last) {
      const readFile = this.ctx.readActiveFileContent
      if (readFile) {
        try {
          const disk = readFile()
          if (disk === null) {
            fileSaved = { decision: 'UNKNOWN', reason: 'no-active-file', persistedAlt: null }
          } else {
            const diskAlt = readImageAlt(disk, last.oldRawPath, last.occurrence)
            const persisted = (diskAlt ?? '') === last.newAlt
            fileSaved = { decision: persisted ? 'PASS' : 'FAIL', reason: persisted ? 'file-has-new-alt' : 'file-still-old-alt', persistedAlt: diskAlt }
          }
        } catch (e) {
          fileSaved = { decision: 'UNKNOWN', reason: `read-error:${String(e)}`, persistedAlt: null }
        }
      } else {
        fileSaved = { decision: 'UNKNOWN', reason: 'readActiveFileContent-not-wired', persistedAlt: null }
      }
    }
    return {
      buildId: INKCHAPTER_BUILD_ID,
      lastWrite: last ?? null,
      fileSaved,
      faw: last ? { FAW8: fileSaved.decision, FAW9: 'UNVERIFIED' } : null,
      reopenPersisted: 'UNVERIFIED (requires real save + reopen)',
    }
  }

  /** Caption owner evidence for the probe. */
  private captionOwnersStats(): Record<string, unknown> {
    const items = this.adapter.getCaptionOwnerDiagnostics()
    const totalCaptions = items.length
    const withTargetKey = items.filter(i => String(i.targetKey ?? '') !== '').length
    const ownerResolved = items.filter(i => i.ownerConnected === true).length
    const ownerMissing = totalCaptions - ownerResolved
    return { totalCaptions, withTargetKey, ownerResolved, ownerMissing, items }
  }

  /** Snapshot of persisted name records and their match state. */
  private namingStats(): Record<string, unknown> {
    const docKey = this.currentDocumentKey ?? ''
    const records = this.registry.listByDocument(docKey)
    const targets = this.adapter.collectTargets()
    let tableNamed = 0
    let imageNamed = 0
    let codeNamed = 0
    let matched = 0
    let blocked = 0
    const recordList: Array<Record<string, unknown>> = []

    for (const r of records) {
      const root = this.boundTargets.get(r.captionId) ?? null
      const isMatched = !!root && root.isConnected
      let runtimeKey = 'blocked'
      if (root) {
        const target = targets.find(t => t.root === root)
        if (target) runtimeKey = this.runtimeKeyForTarget(target, targets)
      }
      if (isMatched) {
        matched++
        if (r.type === 'table') tableNamed++
        else if (r.type === 'figure') imageNamed++
        else if (r.type === 'code') codeNamed++
      } else {
        blocked++
      }
      recordList.push({ type: r.type, runtimeKey, name: r.title, matched: isMatched, recordId: r.captionId })
    }

    return {
      recordCount: records.length,
      matchedCount: matched,
      blockedCount: blocked,
      tableNamedCount: tableNamed,
      imageNamedCount: imageNamed,
      codeNamedCount: codeNamed,
      records: recordList,
    }
  }

  forceRefresh(): Record<string, unknown> {
    console.info('[InkChapter Caption] FORCE-REFRESH')
    emitRuntimeAudit('CAPTION-FORCE-REFRESH', { decision: 'INVOKED' })
    const before = document.querySelectorAll('[data-inkchapter-caption]').length
    try {
      const root = this.resolveCurrentEditorRoot('force-refresh')
      if (root && root !== this.currentEditorRoot) {
        this.bindEditor(root, 'force-refresh')
      } else if (root) {
        this.connectObserver(root)
        this.currentEditorRoot = root
      }
      if (!this.currentDocumentKey) {
        this.onDocumentChanged()
      }
      this.refresh('force-refresh')
    } catch (e) {
      this.lastError = String(e)
    }
    const after = document.querySelectorAll('[data-inkchapter-caption]').length
    const targets = this.adapter.collectTargets()
    const renderedTable = document.querySelectorAll('[data-inkchapter-caption-type="table"]').length
    const renderedImage = document.querySelectorAll('[data-inkchapter-caption-type="figure"]').length
    const renderedCode = document.querySelectorAll('[data-inkchapter-caption-type="code"]').length
    return {
      editorBound: !!this.currentEditorRoot && this.currentEditorRoot.isConnected,
      tableTargets: targets.filter(t => t.type === 'table').length,
      tableEligible: this.lastEligibility.table.eligibleCount,
      tableRendered: renderedTable,
      imageTargets: targets.filter(t => t.type === 'figure').length,
      imageEligible: this.lastEligibility.figure.eligibleCount,
      imageRendered: renderedImage,
      codeTargets: targets.filter(t => t.type === 'code').length,
      codeEligible: this.lastEligibility.code.eligibleCount,
      codeRendered: renderedCode,
      captionsRendered: after,
      captionsPresentAfterRender: after,
      before,
      after,
      codeDiagnostics: this.adapter.getCodeDiagnostics(),
      renderStats: { ...this.renderStats },
      captionMutationSelfIgnoredCount: this.captionMutationSelfIgnoredCount,
      captionMutationContentRefreshCount: this.captionMutationContentRefreshCount,
      error: this.lastError,
    }
  }
}
