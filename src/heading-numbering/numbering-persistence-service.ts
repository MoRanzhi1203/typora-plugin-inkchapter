/**
 * R08 — Heading number persistence runtime service.
 *
 * Owns the lifecycle the pure planner cannot: read the live buffer, plan with
 * the SAME unified engine result, guard against write→listener→write recursion,
 * record ownership, and expose the six commands.
 *
 * Safety:
 *   - only headings lines are rewritten; body text is preserved byte-for-byte;
 *   - the write goes through Typora's reload with undo preserved (one undo entry);
 *   - a document switch resets every guard;
 *   - feature-off never deletes persisted numbers.
 */

import type { PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from '../settings/settings-model'
import type { HeadingNumberingSettings, UnnumberedCounterPolicy } from './heading-types'
import {
  parseMarkdownHeadings,
  planHeadingNumberPersistence,
  type HeadingNumberPersistenceFacts,
  type HeadingNumberPersistencePlan,
  type HeadingNumberPlanStats,
  type NumberingPersistenceSettings,
  type SourceOverrideEntry,
} from './heading-number-persistence'
import {
  checkNumberingConflicts,
  type NumberingConflictReport,
} from './heading-number-conflict-check'
import {
  getDocumentOwnership,
  normalizeNumberingPersistenceConfig,
  resolveNumberingPersistenceSettings,
  withDocumentOwnership,
  withNumberingPersistenceSettings,
  type NumberingPersistenceConfig,
} from './numbering-persistence-settings'

export const NUMBERING_PERSISTENCE_SETTINGS_KEY = 'numberingPersistence'

export interface NumberingPersistenceDeps {
  settings: PluginSettings<InkChapterSettings>
  getDocumentKey: () => string | null
  getMarkdown: () => string | null
  getHeadingSettings: () => HeadingNumberingSettings
  getSourceOverrideEntries: () => {
    entries: SourceOverrideEntry[]
    counterPolicy: UnnumberedCounterPolicy
  }
  getActiveFilePath?: () => string | null
  reloadContentPreservingUndo?: (markdown: string) => void
  reloadContent?: (markdown: string) => void
  /** Write the numbered copy next to the document. Returns the written name. */
  writeExportFile?: (fileName: string, content: string) => string | null
  notify?: (kind: 'info' | 'warning' | 'error', message: string) => void
  onEditorEdit?: (listener: () => void) => () => void
  onBeforeSave?: (listener: () => void) => () => void
  onDocumentSwitch?: (listener: () => void) => () => void
  registerDisposable?: (fn: () => void) => void
}

export type NumberingSyncStatus = 'APPLIED' | 'UNCHANGED' | 'SKIPPED' | 'FAILED'

export interface NumberingSyncResult {
  ok: boolean
  status: NumberingSyncStatus
  reason: string
  detail?: string
  patchCount: number
  stats: HeadingNumberPlanStats | null
  conflicts: NumberingConflictReport | null
}

export interface NumberingExportResult extends NumberingSyncResult {
  /** The numbered Markdown (never written back to the original document). */
  markdown: string | null
  fileName: string | null
}

export interface NumberingPreviewHeading {
  line: number
  level: number
  title: string
  label: string
  after: string
}

const AUTO_SYNC_DEBOUNCE_MS = 400

export class NumberingPersistenceService {
  private static readonly EXPORT_SUFFIX = '.numbered.md'

  private writing = false
  private lastWrittenHash: number | null = null
  private lastSignature: string | null = null
  private autoTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<() => void>()
  private disposers: Array<() => void> = []
  private sourceUnavailable = false
  private lastResult: NumberingSyncResult | null = null

  constructor(private readonly deps: NumberingPersistenceDeps) {}

  // ── lifecycle ──────────────────────────────────────────

  start(): void {
    if (this.deps.onEditorEdit) {
      this.disposers.push(this.deps.onEditorEdit(() => this.scheduleAutoSync()))
    }
    if (this.deps.onBeforeSave) {
      this.disposers.push(this.deps.onBeforeSave(() => this.handleBeforeSave()))
    }
    if (this.deps.onDocumentSwitch) {
      this.disposers.push(this.deps.onDocumentSwitch(() => this.resetDocumentState()))
    }
    for (const dispose of this.disposers) this.deps.registerDisposable?.(dispose)
  }

  dispose(): void {
    if (this.autoTimer !== null) {
      clearTimeout(this.autoTimer)
      this.autoTimer = null
    }
    for (const dispose of this.disposers.splice(0)) dispose()
    this.listeners.clear()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  // ── settings ───────────────────────────────────────────

  getConfig(): NumberingPersistenceConfig {
    return normalizeNumberingPersistenceConfig(
      this.deps.settings.get(NUMBERING_PERSISTENCE_SETTINGS_KEY as keyof InkChapterSettings),
    )
  }

  getSettings(): NumberingPersistenceSettings {
    return resolveNumberingPersistenceSettings(this.getConfig(), this.deps.getDocumentKey())
  }

  isSourceMode(): boolean {
    return this.getSettings().storageMode === 'source'
  }

  shouldDedupeProjections(): boolean {
    return this.getSettings().dedupeProjectedNumbers
  }

  setSettings(
    patch: Partial<NumberingPersistenceSettings>,
    scope: 'global' | 'document' = 'document',
  ): NumberingPersistenceSettings {
    const documentKey = this.deps.getDocumentKey()
    const next = withNumberingPersistenceSettings(this.getConfig(), patch, scope, documentKey)
    this.deps.settings.set(NUMBERING_PERSISTENCE_SETTINGS_KEY as keyof InkChapterSettings, next as never)
    this.notifyListeners()
    return resolveNumberingPersistenceSettings(next, documentKey)
  }

  getLastResult(): NumberingSyncResult | null {
    return this.lastResult
  }

  // ── planning / preview ─────────────────────────────────

  planCurrent(markdownOverride?: string): HeadingNumberPersistencePlan | null {
    const markdown = markdownOverride ?? this.deps.getMarkdown()
    if (markdown == null) return null
    const settings = this.getSettings()
    const overrides = this.deps.getSourceOverrideEntries()
    return planHeadingNumberPersistence(markdown, this.deps.getHeadingSettings(), {
      mode: settings.storageMode,
      policy: settings.existingNumberPolicy,
      ownership: getDocumentOwnership(this.getConfig(), this.deps.getDocumentKey()),
      overrideEntries: overrides.entries,
      counterPolicy: overrides.counterPolicy,
    })
  }

  /** R09 — the snapshot consumed by the central diagnostics panel (PURE read). */
  getDiagnosticsFacts(): HeadingNumberPersistenceFacts {
    const headingSettings = this.deps.getHeadingSettings()
    const persistence = this.getSettings()
    const overrides = this.deps.getSourceOverrideEntries()
    return {
      enabled: headingSettings.enabled === true,
      storageMode: persistence.storageMode,
      policy: persistence.existingNumberPolicy,
      dedupeProjectedNumbers: persistence.dedupeProjectedNumbers,
      settings: headingSettings,
      overrideEntries: overrides.entries,
      counterPolicy: overrides.counterPolicy,
      ownership: getDocumentOwnership(this.getConfig(), this.deps.getDocumentKey()),
    }
  }

  /** R09 — compact status for the settings card (mode / adopted / conflicts). */
  getStatusSummary(): {
    storageMode: NumberingPersistenceSettings['storageMode']
    policy: NumberingPersistenceSettings['existingNumberPolicy']
    syncTiming: NumberingPersistenceSettings['syncTiming']
    adoptedCount: number
    managedCount: number
    conflictCount: number
    errorCount: number
    hasConflicts: boolean
  } {
    const settings = this.getSettings()
    const ownership = getDocumentOwnership(this.getConfig(), this.deps.getDocumentKey())
    const records = Object.values(ownership)
    const report = this.checkConflicts()
    return {
      storageMode: settings.storageMode,
      policy: settings.existingNumberPolicy,
      syncTiming: settings.syncTiming,
      adoptedCount: records.filter(r => r.ownership === 'adopted' || r.ownership === 'user-preserved').length,
      managedCount: records.filter(r => r.ownership === 'inkchapter' || r.ownership === 'adopted').length,
      conflictCount: report?.issues.length ?? 0,
      errorCount: report?.errorCount ?? 0,
      hasConflicts: report?.hasConflict ?? false,
    }
  }

  /** Preview used by the settings card: source before/after for the current document. */
  getPreview(): {
    before: NumberingPreviewHeading[]
    changed: boolean
    stats: HeadingNumberPlanStats | null
    settings: NumberingPersistenceSettings
  } {
    const plan = this.planCurrent()
    const settings = this.getSettings()
    if (!plan) return { before: [], changed: false, stats: null, settings }
    return {
      before: plan.headings.slice(0, 12).map(h => ({
        line: h.line,
        level: h.level,
        title: h.title,
        label: h.label,
        after: h.after.trim(),
      })),
      changed: plan.changed,
      stats: plan.stats,
      settings,
    }
  }

  // ── commands ───────────────────────────────────────────

  writeNumbersToSource(): NumberingSyncResult {
    const current = this.getSettings()
    if (current.existingNumberPolicy === 'detect-only') {
      this.setSettings({ storageMode: 'source', existingNumberPolicy: 'adopt' })
    } else {
      this.setSettings({ storageMode: 'source' })
    }
    return this.runSync('command-write-source', 'source')
  }

  adoptExistingNumbers(): NumberingSyncResult {
    this.setSettings({ storageMode: 'source', existingNumberPolicy: 'adopt' })
    return this.runSync('command-adopt', 'source')
  }

  resynchronizeAll(): NumberingSyncResult {
    if (!this.isSourceMode()) {
      return this.skipped('command-resync', 'NOT_SOURCE_MODE', '当前不是源码持久化模式，请先切换存储模式')
    }
    return this.runSync('command-resync', 'source')
  }

  removeManagedNumbers(): NumberingSyncResult {
    const markdown = this.deps.getMarkdown()
    if (markdown == null) return this.skipped('command-remove', 'NO_MARKDOWN', '无法读取当前文档')
    const settings = this.getSettings()
    const overrides = this.deps.getSourceOverrideEntries()
    const ownership = getDocumentOwnership(this.getConfig(), this.deps.getDocumentKey())
    if (Object.keys(ownership).length === 0) {
      return this.skipped('command-remove', 'NO_OWNERSHIP', '没有墨章管理的源码编号记录')
    }
    const plan = planHeadingNumberPersistence(markdown, this.deps.getHeadingSettings(), {
      mode: 'source',
      policy: settings.existingNumberPolicy,
      ownership,
      overrideEntries: overrides.entries,
      counterPolicy: overrides.counterPolicy,
      removeManagedOnly: true,
    })
    if (!plan.changed) {
      const result: NumberingSyncResult = {
        ok: true,
        status: 'UNCHANGED',
        reason: 'command-remove',
        patchCount: 0,
        stats: plan.stats,
        conflicts: null,
      }
      this.lastResult = result
      return result
    }
    const written = this.writeMarkdown(plan.nextMarkdown)
    if (!written) return this.failed('command-remove', 'WRITE_FAILED', '写入失败：编辑器不支持内容替换')
    this.clearOwnership()
    const result: NumberingSyncResult = {
      ok: true,
      status: 'APPLIED',
      reason: 'command-remove',
      detail: `已移除 ${plan.stats.removed} 个墨章管理的编号`,
      patchCount: plan.patches.length,
      stats: plan.stats,
      conflicts: null,
    }
    this.lastResult = result
    this.lastSignature = computeHeadingStructureSignature(plan.nextMarkdown)
    return result
  }

  checkConflicts(): NumberingConflictReport | null {
    const plan = this.planCurrent()
    if (!plan) return null
    const settings = this.getSettings()
    return checkNumberingConflicts(plan, {
      numberingEnabled: this.deps.getHeadingSettings().enabled === true,
      storageMode: settings.storageMode,
      policy: settings.existingNumberPolicy,
    })
  }

  exportNumberedMarkdown(): NumberingExportResult {
    const markdown = this.deps.getMarkdown()
    if (markdown == null) {
      return { ...this.skipped('command-export', 'NO_MARKDOWN', '无法读取当前文档'), markdown: null, fileName: null }
    }
    const overrides = this.deps.getSourceOverrideEntries()
    const plan = planHeadingNumberPersistence(markdown, this.deps.getHeadingSettings(), {
      mode: 'export',
      policy: 'adopt',
      ownership: getDocumentOwnership(this.getConfig(), this.deps.getDocumentKey()),
      overrideEntries: overrides.entries,
      counterPolicy: overrides.counterPolicy,
    })
    const fileName = this.resolveExportFileName()
    const written = this.deps.writeExportFile?.(fileName, plan.nextMarkdown) ?? null
    if (written == null) {
      return {
        ok: false,
        status: 'FAILED',
        reason: 'command-export',
        detail: '导出失败：无法写入编号副本',
        patchCount: plan.patches.length,
        stats: plan.stats,
        conflicts: null,
        markdown: plan.nextMarkdown,
        fileName: null,
      }
    }
    const result: NumberingExportResult = {
      ok: true,
      status: plan.changed ? 'APPLIED' : 'UNCHANGED',
      reason: 'command-export',
      detail: `已导出编号副本：${written}`,
      patchCount: plan.patches.length,
      stats: plan.stats,
      conflicts: null,
      markdown: plan.nextMarkdown,
      fileName: written,
    }
    this.lastResult = result
    return result
  }

  /** Synchronise now (command / save / auto). Never throws. */
  runSync(reason: string, modeOverride?: 'source'): NumberingSyncResult {
    if (this.writing) return this.skipped(reason, 'WRITE_IN_PROGRESS', '正在写入编号，已跳过')
    const markdown = this.deps.getMarkdown()
    if (markdown == null) return this.skipped(reason, 'NO_MARKDOWN', '无法读取当前文档')
    const settings = this.getSettings()
    const mode = modeOverride ?? settings.storageMode
    if (mode !== 'source') {
      return this.skipped(reason, 'NOT_SOURCE_MODE', '当前存储模式不写入源码')
    }
    const headingSettings = this.deps.getHeadingSettings()
    if (headingSettings.enabled !== true) {
      return this.skipped(reason, 'NUMBERING_DISABLED', '标题编号已关闭，源码编号保持不变')
    }
    const overrides = this.deps.getSourceOverrideEntries()
    const documentKey = this.deps.getDocumentKey()
    const plan = planHeadingNumberPersistence(markdown, headingSettings, {
      mode: 'source',
      policy: settings.existingNumberPolicy,
      ownership: getDocumentOwnership(this.getConfig(), documentKey),
      overrideEntries: overrides.entries,
      counterPolicy: overrides.counterPolicy,
    })
    this.persistOwnership(documentKey, plan)

    if (!plan.changed) {
      const result: NumberingSyncResult = {
        ok: true,
        status: 'UNCHANGED',
        reason,
        patchCount: 0,
        stats: plan.stats,
        conflicts: null,
      }
      this.lastResult = result
      return result
    }
    const written = this.writeMarkdown(plan.nextMarkdown)
    if (!written) return this.failed(reason, 'WRITE_FAILED', '写入失败：编辑器不支持内容替换')

    this.lastWrittenHash = hashMarkdown(plan.nextMarkdown)
    this.lastSignature = computeHeadingStructureSignature(plan.nextMarkdown)
    const result: NumberingSyncResult = {
      ok: true,
      status: 'APPLIED',
      reason,
      detail: `已更新 ${plan.patches.length} 个标题编号`,
      patchCount: plan.patches.length,
      stats: plan.stats,
      conflicts: null,
    }
    this.lastResult = result
    this.notifyListeners()
    return result
  }

  // ── internals ──────────────────────────────────────────

  private writeMarkdown(markdown: string): boolean {
    const write = this.deps.reloadContentPreservingUndo ?? this.deps.reloadContent
    if (!write) {
      this.sourceUnavailable = true
      return false
    }
    this.writing = true
    try {
      write(markdown)
      return true
    } catch {
      return false
    } finally {
      this.writing = false
    }
  }

  private persistOwnership(documentKey: string | null, plan: HeadingNumberPersistencePlan): void {
    if (!documentKey) return
    const config = this.getConfig()
    const current = config.ownership?.[documentKey] ?? {}
    if (JSON.stringify(current) === JSON.stringify(plan.ownership)) return
    const next = withDocumentOwnership(config, documentKey, plan.ownership)
    this.deps.settings.set(NUMBERING_PERSISTENCE_SETTINGS_KEY as keyof InkChapterSettings, next as never)
  }

  private clearOwnership(): void {
    const documentKey = this.deps.getDocumentKey()
    if (!documentKey) return
    const config = this.getConfig()
    const next = withDocumentOwnership(config, documentKey, {})
    this.deps.settings.set(NUMBERING_PERSISTENCE_SETTINGS_KEY as keyof InkChapterSettings, next as never)
  }

  private scheduleAutoSync(): void {
    const hot = this.readHotSettings()
    if (hot.storageMode !== 'source' || hot.syncTiming !== 'edit') return
    if (this.autoTimer !== null) clearTimeout(this.autoTimer)
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null
      this.handleAutoEdit()
    }, AUTO_SYNC_DEBOUNCE_MS)
  }

  private handleAutoEdit(): void {
    const hot = this.readHotSettings()
    if (hot.storageMode !== 'source' || hot.syncTiming !== 'edit') return
    const markdown = this.deps.getMarkdown()
    if (markdown == null) return
    if (this.lastWrittenHash !== null && hashMarkdown(markdown) === this.lastWrittenHash) return
    const signature = computeHeadingStructureSignature(markdown)
    if (signature === this.lastSignature) return
    this.runSync('auto-edit')
  }

  private handleBeforeSave(): void {
    const hot = this.readHotSettings()
    if (hot.storageMode !== 'source' || hot.syncTiming !== 'save') return
    this.runSync('save')
  }

  /**
   * HOT-PATH read: the edit listener fires on every keystroke. Read only the
   * two fields that gate the work instead of normalising the whole ownership
   * ledger (which can hold one record per heading).
   */
  private readHotSettings(): Pick<NumberingPersistenceSettings, 'storageMode' | 'syncTiming'> {
    try {
      const raw = this.deps.settings.get(NUMBERING_PERSISTENCE_SETTINGS_KEY as keyof InkChapterSettings) as unknown as {
        global?: { storageMode?: unknown; syncTiming?: unknown }
        documentOverrides?: Record<string, { storageMode?: unknown; syncTiming?: unknown } | undefined>
      } | null
      const docKey = this.deps.getDocumentKey()
      const override = docKey ? raw?.documentOverrides?.[docKey] : undefined
      const storageMode = override?.storageMode ?? raw?.global?.storageMode
      const syncTiming = override?.syncTiming ?? raw?.global?.syncTiming
      return {
        storageMode: storageMode === 'source' || storageMode === 'export' ? storageMode : 'render',
        syncTiming: syncTiming === 'edit' || syncTiming === 'save' ? syncTiming : 'manual',
      }
    } catch {
      return { storageMode: 'render', syncTiming: 'manual' }
    }
  }

  private resetDocumentState(): void {
    if (this.autoTimer !== null) {
      clearTimeout(this.autoTimer)
      this.autoTimer = null
    }
    this.writing = false
    this.lastWrittenHash = null
    this.lastSignature = null
    this.sourceUnavailable = false
  }

  private resolveExportFileName(): string {
    const path = this.deps.getActiveFilePath?.() ?? ''
    const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
    const withoutExt = base.replace(/\.md$/i, '')
    const stem = withoutExt === '' ? 'document' : withoutExt
    return `${stem}${NumberingPersistenceService.EXPORT_SUFFIX}`
  }

  private skipped(reason: string, code: string, detail: string): NumberingSyncResult {
    const result: NumberingSyncResult = {
      ok: false,
      status: 'SKIPPED',
      reason,
      detail: `${code}:${detail}`,
      patchCount: 0,
      stats: null,
      conflicts: null,
    }
    this.lastResult = result
    return result
  }

  private failed(reason: string, code: string, detail: string): NumberingSyncResult {
    const result: NumberingSyncResult = {
      ok: false,
      status: 'FAILED',
      reason,
      detail: `${code}:${detail}`,
      patchCount: 0,
      stats: null,
      conflicts: null,
    }
    this.lastResult = result
    return result
  }

  private notifyListeners(): void {
    for (const listener of Array.from(this.listeners)) {
      try { listener() } catch { /* UI listener errors must not break a write */ }
    }
  }

  /** True when a previous write failed because no editor write API exists. */
  isSourceUnavailable(): boolean {
    return this.sourceUnavailable
  }
}

/**
 * Structural signature that IGNORES body text and existing numbers: only the
 * heading levels and the titles (prefix stripped). Typing body text therefore
 * never triggers a source rewrite.
 */
export function computeHeadingStructureSignature(markdown: string): string {
  const parsed = parseMarkdownHeadings(markdown)
  return parsed.headings
    .map(h => `${h.level}:${normalizeSignatureTitle(h.text)}`)
    .join('\n')
}

function normalizeSignatureTitle(text: string): string {
  return text
    .replace(/^[\s\u00A0\u3000]+/, '')
    .replace(/[\s\u00A0\u3000]+/g, '')
}

/** Small non-cryptographic hash — change detection only. */
export function hashMarkdown(markdown: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < markdown.length; i++) {
    hash ^= markdown.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}
