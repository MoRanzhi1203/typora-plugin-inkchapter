/**
 * R10 — Object caption/number persistence runtime service.
 *
 * Owns what the pure planner cannot: the live buffer, the write→listener→write
 * recursion guard, the ownership ledger, debounce and the user commands.
 *
 * The write always goes through the SAME undo-preserving reload the heading
 * service uses, so Ctrl+Z restores the exact pre-write buffer.
 */

import type { PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from '../settings/settings-model'
import type { HeadingNumberingSettings, UnnumberedCounterPolicy } from './heading-types'
import {
  computeObjectStructureSignature,
  planObjectNumberPersistence,
  type NumberedObjectKind,
  type ObjectCaptionPolicy,
  type ObjectNumberPersistencePlan,
  type ObjectNumberPersistenceSettings,
  type ObjectNumberPlanStats,
  type ObjectNumberingConfigs,
  type ObjectNumberStorageMode,
  type ObjectNumberSyncTiming,
} from './object-number-persistence'
import type { SourceOverrideEntry } from './heading-number-persistence'
import { planHeadingNumberPersistence } from './heading-number-persistence'
import {
  getObjectDocumentOwnership,
  normalizeObjectNumberPersistenceConfig,
  resolveObjectNumberPersistenceSettings,
  withObjectDocumentOwnership,
  withObjectNumberPersistenceSettings,
  type ObjectNumberPersistenceConfig,
} from './object-number-persistence-settings'

export const OBJECT_NUMBER_PERSISTENCE_SETTINGS_KEY = 'objectNumberingPersistence'

const AUTO_SYNC_DEBOUNCE_MS = 400

export interface ObjectNumberPersistenceDeps {
  settings: PluginSettings<InkChapterSettings>
  getDocumentKey: () => string | null
  getMarkdown: () => string | null
  getHeadingSettings: () => HeadingNumberingSettings
  getSourceOverrideEntries: () => { entries: SourceOverrideEntry[]; counterPolicy: UnnumberedCounterPolicy }
  getObjectNumberingConfigs: () => ObjectNumberingConfigs
  getActiveFilePath?: () => string | null
  reloadContentPreservingUndo?: (markdown: string) => void
  reloadContent?: (markdown: string) => void
  writeExportFile?: (fileName: string, content: string) => string | null
  notify?: (kind: 'info' | 'warning' | 'error', message: string) => void
  onEditorEdit?: (listener: () => void) => () => void
  onBeforeSave?: (listener: () => void) => () => void
  onDocumentSwitch?: (listener: () => void) => () => void
  registerDisposable?: (fn: () => void) => void
}

export type ObjectNumberSyncStatus = 'APPLIED' | 'UNCHANGED' | 'SKIPPED' | 'FAILED'

export interface ObjectNumberSyncResult {
  ok: boolean
  status: ObjectNumberSyncStatus
  reason: string
  detail?: string
  patchCount: number
  stats: ObjectNumberPlanStats | null
}

export interface ObjectNumberExportResult extends ObjectNumberSyncResult {
  markdown: string | null
  fileName: string | null
}

export interface ObjectNumberStatusSummary {
  storageMode: ObjectNumberStorageMode
  policy: ObjectCaptionPolicy
  syncTiming: ObjectNumberSyncTiming
  objectsByKind: Record<NumberedObjectKind, number>
  captionedCount: number
  managedCount: number
  adoptedCount: number
  duplicateCaptionCount: number
  chapterMismatchCount: number
  missingCaptionCount: number
}

export interface ObjectNumberPreviewRow {
  kind: NumberedObjectKind
  line: number
  before: string
  after: string
  action: string
}

export class ObjectNumberPersistenceService {
  private static readonly EXPORT_SUFFIX = '.numbered.md'

  private writing = false
  private lastWrittenHash: number | null = null
  private lastSignature: string | null = null
  private autoTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<() => void>()
  private disposers: Array<() => void> = []
  private sourceUnavailable = false
  private lastResult: ObjectNumberSyncResult | null = null

  constructor(private readonly deps: ObjectNumberPersistenceDeps) {}

  start(): void {
    if (this.deps.onEditorEdit) this.disposers.push(this.deps.onEditorEdit(() => this.scheduleAutoSync()))
    if (this.deps.onBeforeSave) this.disposers.push(this.deps.onBeforeSave(() => this.handleBeforeSave()))
    if (this.deps.onDocumentSwitch) this.disposers.push(this.deps.onDocumentSwitch(() => this.resetDocumentState()))
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

  getConfig(): ObjectNumberPersistenceConfig {
    return normalizeObjectNumberPersistenceConfig(
      this.deps.settings.get(OBJECT_NUMBER_PERSISTENCE_SETTINGS_KEY as keyof InkChapterSettings),
    )
  }

  getSettings(): ObjectNumberPersistenceSettings {
    return resolveObjectNumberPersistenceSettings(this.getConfig(), this.deps.getDocumentKey())
  }

  setSettings(
    patch: Partial<ObjectNumberPersistenceSettings>,
    scope: 'global' | 'document' = 'document',
  ): ObjectNumberPersistenceSettings {
    const documentKey = this.deps.getDocumentKey()
    const next = withObjectNumberPersistenceSettings(this.getConfig(), patch, scope, documentKey)
    this.deps.settings.set(OBJECT_NUMBER_PERSISTENCE_SETTINGS_KEY as keyof InkChapterSettings, next as never)
    this.notifyListeners()
    return resolveObjectNumberPersistenceSettings(next, documentKey)
  }

  getLastResult(): ObjectNumberSyncResult | null {
    return this.lastResult
  }

  // ── planning ───────────────────────────────────────────

  planCurrent(markdownOverride?: string, modeOverride?: ObjectNumberStorageMode, policyOverride?: ObjectCaptionPolicy): ObjectNumberPersistencePlan | null {
    const markdown = markdownOverride ?? this.deps.getMarkdown()
    if (markdown == null) return null
    const settings = this.getSettings()
    const overrides = this.deps.getSourceOverrideEntries()
    return planObjectNumberPersistence(markdown, {
      mode: modeOverride ?? settings.storageMode,
      policy: policyOverride ?? settings.existingCaptionPolicy,
      configs: this.deps.getObjectNumberingConfigs(),
      headingSettings: this.deps.getHeadingSettings(),
      overrideEntries: overrides.entries,
      counterPolicy: overrides.counterPolicy,
      ownership: getObjectDocumentOwnership(this.getConfig(), this.deps.getDocumentKey()),
    })
  }

  getDiagnosticsFacts(): {
    enabled: boolean
    storageMode: ObjectNumberStorageMode
    policy: ObjectCaptionPolicy
    dedupeProjectedNumbers: boolean
    headingSettings: HeadingNumberingSettings
    overrideEntries: readonly SourceOverrideEntry[]
    counterPolicy: UnnumberedCounterPolicy
    configs: ObjectNumberingConfigs
    ownership: ReturnType<typeof getObjectDocumentOwnership>
  } {
    const settings = this.getSettings()
    const overrides = this.deps.getSourceOverrideEntries()
    return {
      enabled: this.isAnyKindEnabled(),
      storageMode: settings.storageMode,
      policy: settings.existingCaptionPolicy,
      dedupeProjectedNumbers: settings.dedupeProjectedNumbers,
      headingSettings: this.deps.getHeadingSettings(),
      overrideEntries: overrides.entries,
      counterPolicy: overrides.counterPolicy,
      configs: this.deps.getObjectNumberingConfigs(),
      ownership: getObjectDocumentOwnership(this.getConfig(), this.deps.getDocumentKey()),
    }
  }

  getStatusSummary(): ObjectNumberStatusSummary {
    const settings = this.getSettings()
    const plan = this.planCurrent()
    const ownership = Object.values(getObjectDocumentOwnership(this.getConfig(), this.deps.getDocumentKey()))
    const objectsByKind: Record<NumberedObjectKind, number> = { figure: 0, table: 0, code: 0, formula: 0 }
    let captionedCount = 0
    let missingCaptionCount = 0
    for (const object of plan?.objects ?? []) {
      objectsByKind[object.kind]++
      if (object.captionLine != null) captionedCount++
      else missingCaptionCount++
    }
    return {
      storageMode: settings.storageMode,
      policy: settings.existingCaptionPolicy,
      syncTiming: settings.syncTiming,
      objectsByKind,
      captionedCount,
      managedCount: ownership.filter(r => r.ownership === 'inkchapter' || r.ownership === 'adopted').length,
      adoptedCount: ownership.filter(r => r.ownership === 'adopted' || r.ownership === 'user-preserved').length,
      duplicateCaptionCount: plan?.stats.duplicateCaptions ?? 0,
      chapterMismatchCount: plan?.stats.chapterMismatch ?? 0,
      missingCaptionCount,
    }
  }

  getPreview(limit = 12): { rows: ObjectNumberPreviewRow[]; changed: boolean; stats: ObjectNumberPlanStats | null } {
    const plan = this.planCurrent()
    if (!plan) return { rows: [], changed: false, stats: null }
    const rows = plan.objects
      .filter(o => o.before !== o.after || o.action === 'update' || o.action === 'write')
      .slice(0, limit)
      .map(o => ({
        kind: o.kind,
        line: o.captionLine ?? o.startLine,
        before: o.before ?? '',
        after: o.after ?? '',
        action: o.action,
      }))
    return { rows, changed: plan.changed, stats: plan.stats }
  }

  // ── commands ───────────────────────────────────────────

  writeObjectNumbersToSource(): ObjectNumberSyncResult {
    if (this.getSettings().existingCaptionPolicy === 'detect-only') {
      this.setSettings({ storageMode: 'source', existingCaptionPolicy: 'adopt' })
    } else {
      this.setSettings({ storageMode: 'source' })
    }
    return this.runSync('command-write-object-source', 'source')
  }

  adoptExistingCaptions(): ObjectNumberSyncResult {
    this.setSettings({ storageMode: 'source', existingCaptionPolicy: 'adopt' })
    return this.runSync('command-adopt-object-captions', 'source')
  }

  resynchronizeAll(): ObjectNumberSyncResult {
    if (this.getSettings().storageMode !== 'source') {
      return this.skipped('command-object-resync', 'NOT_SOURCE_MODE', '当前不是源码持久化模式，请先切换存储模式')
    }
    return this.runSync('command-object-resync', 'source')
  }

  removeManagedCaptions(): ObjectNumberSyncResult {
    const markdown = this.deps.getMarkdown()
    if (markdown == null) return this.skipped('command-object-remove', 'NO_MARKDOWN', '无法读取当前文档')
    const ownership = getObjectDocumentOwnership(this.getConfig(), this.deps.getDocumentKey())
    if (Object.keys(ownership).length === 0) {
      return this.skipped('command-object-remove', 'NO_OWNERSHIP', '没有墨章管理的题注记录')
    }
    const settings = this.getSettings()
    const overrides = this.deps.getSourceOverrideEntries()
    const plan = planObjectNumberPersistence(markdown, {
      mode: 'source',
      policy: settings.existingCaptionPolicy,
      configs: this.deps.getObjectNumberingConfigs(),
      headingSettings: this.deps.getHeadingSettings(),
      overrideEntries: overrides.entries,
      counterPolicy: overrides.counterPolicy,
      ownership,
      removeManagedOnly: true,
    })
    if (!plan.changed) {
      const result: ObjectNumberSyncResult = {
        ok: true,
        status: 'UNCHANGED',
        reason: 'command-object-remove',
        patchCount: 0,
        stats: plan.stats,
      }
      this.lastResult = result
      return result
    }
    if (!this.writeMarkdown(plan.nextMarkdown)) {
      return this.failed('command-object-remove', 'WRITE_FAILED', '写入失败：编辑器不支持内容替换')
    }
    this.clearOwnership()
    const result: ObjectNumberSyncResult = {
      ok: true,
      status: 'APPLIED',
      reason: 'command-object-remove',
      detail: `已移除 ${plan.stats.removed} 个墨章管理的题注`,
      patchCount: plan.edits.length,
      stats: plan.stats,
    }
    this.lastResult = result
    this.lastSignature = computeObjectStructureSignature(plan.nextMarkdown)
    return result
  }

  /** Detect-only conflict summary for the settings card and diagnostics. */
  checkConflicts(): ObjectNumberPersistencePlan | null {
    return this.planCurrent(undefined, 'render', 'detect-only')
  }

  /**
   * Export a numbered copy WITHOUT touching the open document:
   * heading numbers are materialised first, then figure/table/code/formula
   * captions on top of that copy.
   */
  exportNumberedMarkdown(): ObjectNumberExportResult {
    const markdown = this.deps.getMarkdown()
    if (markdown == null) {
      return { ...this.skipped('command-object-export', 'NO_MARKDOWN', '无法读取当前文档'), markdown: null, fileName: null }
    }
    const overrides = this.deps.getSourceOverrideEntries()
    const headingPlan = planHeadingNumberPersistence(markdown, this.deps.getHeadingSettings(), {
      mode: 'export',
      policy: 'adopt',
      overrideEntries: overrides.entries,
      counterPolicy: overrides.counterPolicy,
    })
    const objectPlan = planObjectNumberPersistence(headingPlan.nextMarkdown, {
      mode: 'source',
      policy: 'adopt',
      configs: this.deps.getObjectNumberingConfigs(),
      headingSettings: this.deps.getHeadingSettings(),
      overrideEntries: overrides.entries,
      counterPolicy: overrides.counterPolicy,
      ownership: getObjectDocumentOwnership(this.getConfig(), this.deps.getDocumentKey()),
    })
    const fileName = this.resolveExportFileName()
    const written = this.deps.writeExportFile?.(fileName, objectPlan.nextMarkdown) ?? null
    if (written == null) {
      return {
        ok: false,
        status: 'FAILED',
        reason: 'command-object-export',
        detail: '导出失败：无法写入编号副本',
        patchCount: objectPlan.edits.length,
        stats: objectPlan.stats,
        markdown: objectPlan.nextMarkdown,
        fileName: null,
      }
    }
    const result: ObjectNumberExportResult = {
      ok: true,
      status: objectPlan.changed || headingPlan.changed ? 'APPLIED' : 'UNCHANGED',
      reason: 'command-object-export',
      detail: `已导出带编号副本：${written}`,
      patchCount: objectPlan.edits.length,
      stats: objectPlan.stats,
      markdown: objectPlan.nextMarkdown,
      fileName: written,
    }
    this.lastResult = result
    return result
  }

  runSync(reason: string, modeOverride?: ObjectNumberStorageMode): ObjectNumberSyncResult {
    if (this.writing) return this.skipped(reason, 'WRITE_IN_PROGRESS', '正在写入编号，已跳过')
    const markdown = this.deps.getMarkdown()
    if (markdown == null) return this.skipped(reason, 'NO_MARKDOWN', '无法读取当前文档')
    const settings = this.getSettings()
    const mode = modeOverride ?? settings.storageMode
    if (mode !== 'source') return this.skipped(reason, 'NOT_SOURCE_MODE', '当前存储模式不写入源码')
    if (!this.isAnyKindEnabled()) return this.skipped(reason, 'NUMBERING_DISABLED', '图/表/代码/公式编号均已关闭，源码保持不变')

    const overrides = this.deps.getSourceOverrideEntries()
    const documentKey = this.deps.getDocumentKey()
    const plan = planObjectNumberPersistence(markdown, {
      mode: 'source',
      policy: settings.existingCaptionPolicy,
      configs: this.deps.getObjectNumberingConfigs(),
      headingSettings: this.deps.getHeadingSettings(),
      overrideEntries: overrides.entries,
      counterPolicy: overrides.counterPolicy,
      ownership: getObjectDocumentOwnership(this.getConfig(), documentKey),
      removeDuplicateCaptions: true,
    })
    this.persistOwnership(documentKey, plan)

    if (!plan.changed) {
      const result: ObjectNumberSyncResult = {
        ok: true,
        status: 'UNCHANGED',
        reason,
        patchCount: 0,
        stats: plan.stats,
      }
      this.lastResult = result
      return result
    }
    if (!this.writeMarkdown(plan.nextMarkdown)) {
      return this.failed(reason, 'WRITE_FAILED', '写入失败：编辑器不支持内容替换')
    }
    this.lastWrittenHash = hashMarkdown(plan.nextMarkdown)
    this.lastSignature = computeObjectStructureSignature(plan.nextMarkdown)
    const result: ObjectNumberSyncResult = {
      ok: true,
      status: 'APPLIED',
      reason,
      detail: `已更新 ${plan.edits.length} 处对象编号/题注`,
      patchCount: plan.edits.length,
      stats: plan.stats,
    }
    this.lastResult = result
    this.notifyListeners()
    return result
  }

  // ── internals ──────────────────────────────────────────

  private isAnyKindEnabled(): boolean {
    const configs = this.deps.getObjectNumberingConfigs()
    return Object.values(configs).some(config => config.enabled === true)
  }

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

  private persistOwnership(documentKey: string | null, plan: ObjectNumberPersistencePlan): void {
    if (!documentKey) return
    const config = this.getConfig()
    const current = config.ownership?.[documentKey] ?? {}
    if (JSON.stringify(current) === JSON.stringify(plan.ownership)) return
    const next = withObjectDocumentOwnership(config, documentKey, plan.ownership)
    this.deps.settings.set(OBJECT_NUMBER_PERSISTENCE_SETTINGS_KEY as keyof InkChapterSettings, next as never)
  }

  private clearOwnership(): void {
    const documentKey = this.deps.getDocumentKey()
    if (!documentKey) return
    const next = withObjectDocumentOwnership(this.getConfig(), documentKey, {})
    this.deps.settings.set(OBJECT_NUMBER_PERSISTENCE_SETTINGS_KEY as keyof InkChapterSettings, next as never)
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
    const signature = computeObjectStructureSignature(markdown)
    if (signature === this.lastSignature) return
    this.runSync('auto-edit-object')
  }

  private handleBeforeSave(): void {
    const hot = this.readHotSettings()
    if (hot.storageMode !== 'source' || hot.syncTiming !== 'save') return
    this.runSync('save-object')
  }

  private readHotSettings(): Pick<ObjectNumberPersistenceSettings, 'storageMode' | 'syncTiming'> {
    try {
      const raw = this.deps.settings.get(OBJECT_NUMBER_PERSISTENCE_SETTINGS_KEY as keyof InkChapterSettings) as unknown as {
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
    const activePath = this.deps.getActiveFilePath?.() ?? ''
    const base = activePath.replace(/\\/g, '/').split('/').pop() ?? ''
    const stem = base.replace(/\.md$/i, '') || 'document'
    return `${stem}${ObjectNumberPersistenceService.EXPORT_SUFFIX}`
  }

  private skipped(reason: string, code: string, detail: string): ObjectNumberSyncResult {
    const result: ObjectNumberSyncResult = {
      ok: false,
      status: 'SKIPPED',
      reason,
      detail: `${code}:${detail}`,
      patchCount: 0,
      stats: null,
    }
    this.lastResult = result
    return result
  }

  private failed(reason: string, code: string, detail: string): ObjectNumberSyncResult {
    const result: ObjectNumberSyncResult = {
      ok: false,
      status: 'FAILED',
      reason,
      detail: `${code}:${detail}`,
      patchCount: 0,
      stats: null,
    }
    this.lastResult = result
    return result
  }

  private notifyListeners(): void {
    for (const listener of Array.from(this.listeners)) {
      try { listener() } catch { /* UI listener errors must not break a write */ }
    }
  }

  isSourceUnavailable(): boolean {
    return this.sourceUnavailable
  }
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
