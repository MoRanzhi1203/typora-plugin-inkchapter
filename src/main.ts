import './style.scss'
import { Notice, Plugin, PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from './settings/settings-model'
import { DEFAULT_SETTINGS, DEFAULT_UI_SETTINGS, resolveUiSettings } from './settings/default-settings'
import { InkChapterUiSettingTab } from './settings/inkchapter-ui-setting-tab'
import { ImageManagementSettingTab } from './settings/image-management-setting-tab'
import { resolveImageSettings, type ImageRemoteProfile, type ImageSettings } from './image-management/image-settings'
import { ImageScopeStore } from './image-management/image-scope-store'
import { ImageDocumentScopeService } from './image-management/image-document-scope-service'
import { ImageInsertionController } from './image-management/image-insertion-controller'
import {
  WindowsDpapiCredentialStore,
  migrateLegacyPicGoToken,
  resolveCredentialReferenceId,
  type ImageCredentialStatus,
  type ImageCredentialStore,
} from './image-management/image-credential-store'
import {
  testGitHubConnection,
  type GitHubConnectionTestResult,
} from './image-management/github-connection-test'
import { initializeImageLibrary, inspectImageLibraryTarget } from './image-management/image-library-inspection'
import { pickFolderNative } from './image-management/image-directory-picker'
import { pickImageFileNative } from './image-management/image-file-picker'
import { resolveImageDataPaths } from './image-management/image-data-paths'
import { ImageAssetService } from './image-management/image-asset-service'
import { ImageTransferTaskStore } from './image-management/image-transfer-task-store'
import { ImageUploadService } from './image-management/image-upload-service'
import { ImageDownloadService } from './image-management/image-download-service'
import { downloadDocumentRemoteImages } from './image-management/document-remote-download'
import { ImageContextMenuDownload } from './image-management/image-context-menu-download'
import {
  applyReferenceDestination,
  relativeMarkdownImagePath,
  selectMarkdownImageReference,
} from './image-management/image-reference-rewrite'
import {
  TYPORA_CUSTOM_UPLOADER,
  applyTyporaUploaderRuntime,
  findNodeExecutable,
  restoreTyporaUploaderFromLatestBackup,
  switchTyporaUploaderToInkChapter,
} from './image-management/typora-uploader-switch'
import { buildImageLibraryCenter, type ImageLibraryView } from './image-management/image-library-center'
import { inspectDirectoryUsage, resolveImageProjectDirectory } from './image-management/image-path-policy'
import { DocumentImageBatchService } from './image-management/document-image-batch-service'
import {
  buildDocumentImageBatchPreview,
  summarizeImagePolicy,
  type BatchReferenceKnowledge,
} from './image-management/document-image-batch'
import type { DocumentHubImageSummary } from './document-utilities/document-hub-model'
import { parseImageSourceOccurrences } from './document-utilities/document-resource-scanner'
import {
  FRAMEWORK_RIBBON_ENABLE_CLASS,
  INKCHAPTER_RIBBON_HIDDEN_CLASS,
  applyRibbonHiddenClass,
  resolveRibbonHidden,
} from './settings/ribbon-visibility'
import { HeadingNumberingService } from './heading-numbering/heading-numbering-service'
import type { ServiceContext } from './heading-numbering/heading-numbering-service'
import { resolveHeadingPolicyActivation } from './heading-numbering/heading-policy-activation'
import { HeadingDomAdapter } from './infrastructure/heading-dom-adapter'
import { mountPendingFencesSynchronously, type TyporaFenceApi } from './infrastructure/typora-adapter'
import { HeadingNumberingSettingTab } from './settings/heading-numbering-setting-tab'
import { CaptionService } from './heading-numbering/caption-service'
import type { CaptionServiceContext } from './heading-numbering/caption-service'
import { DocumentNumberingCoordinator } from './heading-numbering/document-numbering-coordinator'
import { CaptionContextMenu } from './heading-numbering/caption-context-menu'
import { generateDocumentKey } from './heading-numbering/heading-numbering-scope-store'
import { editor, File } from 'typora'
import { enableRuntimeAudit, getAuditEventsJSON, clearRuntimeAudit, copyAuditEventsToClipboard, recordRuntimeAudit } from './heading-numbering/runtime-audit'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { INKCHAPTER_BUILD_ID, RUNTIME_GATE_REVISION } from './heading-numbering/paragraph-indent-forensic'
import { initializeForensicSink, isRuntimeAuditSinkRequested, shutdownForensicSink, emitRuntimeAudit } from './runtime/forensic-log-sink'
import {
  INKCHAPTER_PLUGIN_ID,
  buildInkChapterGlobalLoadAudit,
  resolveInkChapterPathAuthority,
  resolveInkChapterStorageRoot,
  toInkChapterDocumentContext,
  type InkChapterDocumentContext,
} from './runtime/inkchapter-path-authority'
import { recordInkChapterBootstrap } from './runtime/inkchapter-bootstrap-audit'
import { installGuiCaretAudit } from './runtime/gui-caret-audit'
// Unified Diagnostics Domain V1 §6/§37 — the plugin's OWN runtime integrity is
// the `runtime` domain; it is adapted here and never enters the user Drawer.
import { refreshRuntimeIntegrity, runtimeIntegrityFindingsFromIdentity } from './document-utilities/diagnostic-domain-v1'
import { createDocumentUtilities, extractFormulaVisibleTagTokens, type DocumentUtilities } from './document-utilities/document-utilities'
import { createImageEvidenceRuntime } from './image-management/image-evidence-runtime'
import { createNodeImageEvidenceProvider } from './image-management/image-evidence-provider'
import { resolveDiagnosticProfile, type ResolvedDiagnosticProfile } from './document-utilities/document-diagnostic-profile-v1'
import { resolveAcademicWidthModel } from './document-utilities/document-diagnostic-academic-width-v1'
// Heading Auto-Number Conflict V1.2 §21/§22 — dev/test-only bridge IO (report sink).
import { writeHeadingConflictBridgeReport, readHeadingConflictBridgeFile, consumeHeadingConflictBridgeFile } from './heading-numbering/heading-conflict-test-bridge'
import { DocumentViewContextMenu, type DocViewPlatform } from './document-utilities/document-view-context-menu'
import { TabCloseVisibilityEnhancer, measureTabCloseVisibility, evaluateTabCloseVisibility, measureTabCloseCentering, evaluateTabCloseCentering } from './document-utilities/document-utility-tab-close-visibility'
import { FileCopyService } from './file-transfer/file-copy-service'
import { resolveModifiedState } from './file-transfer/file-transfer-policy'
import { FileTreeDragAdapter } from './file-transfer/file-tree-drag-adapter'
import { NativeDragBridge, type ElectronRendererLike } from './file-transfer/native-drag-bridge'
import { createContentBlockClipboard, type ElectronLike } from './infrastructure/content-block-clipboard'
import type { EmptyWorkspaceSurfaceFacts } from './document-utilities/document-empty-workspace-controller'

/** Runtime audit marker — separate from INKCHAPTER_BUILD_ID. */
const RUNTIME_AUDIT_BUILD_MARKER = 'inkchapter-runtime-audit-h2-outline-v2'

/**
 * R10 Closure §5.1 — OPT-IN structural-serialization perf evidence
 * (`INKCHAPTER_STRUCTURAL_AUDIT=1`). Off by default so the production hot path
 * never formats an audit payload per transaction.
 *
 * Resolved LAZILY: the renderer may expose `process` only after the bundle is
 * evaluated, so a module-scope read can miss the environment (forensic only).
 */
let structuralAuditEnabledCache: boolean | null = null
function isStructuralAuditEnabled(): boolean {
  if (structuralAuditEnabledCache !== null) return structuralAuditEnabledCache
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    structuralAuditEnabledCache = proc?.env?.INKCHAPTER_STRUCTURAL_AUDIT === '1'
      // The GUI-acceptance run already proves the env channel works and needs
      // the same per-transaction serialization cost; both are test-only flags.
      || proc?.env?.INKCHAPTER_GUI_CARET_AUDIT === '1'
  } catch {
    structuralAuditEnabledCache = false
  }
  return structuralAuditEnabledCache
}

console.log('[InkChapter] INKCHAPTER-BOOT-MODULE-LOAD')

// ── V1 §A — GLOBAL BOOTSTRAP PROVENANCE (earliest possible evidence) ────────
// Runs at MODULE EVALUATION time — before the forensic sink, DocumentContext,
// Document Utilities and Heading Numbering bootstrap — and writes to a
// USER-LEVEL path, so it never depends on vaultRoot / workspaceRoot / activeFile
// / a local `.typora`. If the InkChapter bundle executes AT ALL, this fires.
recordInkChapterBootstrap(INKCHAPTER_PLUGIN_ID, INKCHAPTER_BUILD_ID)

/** Best-effort fenced code language from the canonical code host. */
function codeLanguageOf(el: HTMLElement): string | null {
  const cls = String(el.className || '')
  const m = cls.match(/(?:^|\s)language-([A-Za-z0-9_+-]+)/)
  if (m) return m[1]
  return el.getAttribute('data-lang') ?? el.getAttribute('lang') ?? null
}

// ── V3 — ACTIVE workspace leaf document-facts helpers ──────────────────────
// The current workspace leaf (`activeLeaf.state.path`) is the highest-priority
// ACTIVE DOCUMENT PRESENCE authority. `''` means the active leaf holds NO real
// Markdown document (New tab / empty view / untitled) and HARD-VETOES any stale
// `workspace.activeFile` / `documentKey`. Only an unreadable leaf yields
// known=false → UNKNOWN → legacy fallback.
function normalizeLeafPathForPresence(raw: unknown): string | null {
  if (raw === undefined || raw === null) return ''
  const s = String(raw)
  if (s === '') return ''
  if (s.startsWith('typ://')) return '' // framework New-tab / empty view
  return s
}

interface ActiveLeafWorkspaceShape {
  activeLeaf?: { state?: { path?: unknown } } | null
  activeFile?: unknown
}

/**
 * Read the ACTIVE workspace leaf document facts.
 *  - leaf present          → leafStateKnown=true (path normalized; '' = empty).
 *  - leaf absent but NO file identity → leafStateKnown=true, path='' (provably empty).
 *  - leaf absent AND a file identity still exists → leafStateKnown=false (UNKNOWN) so
 *    the legacy fallback decides during framework-startup transients.
 */
function readWorkspaceActiveLeafState(workspace: ActiveLeafWorkspaceShape): { leafStateKnown: boolean; leafPath: string | null } {
  try {
    const leaf = workspace.activeLeaf ?? null
    const file = workspace.activeFile ?? null
    if (!leaf) {
      const filePresent = file != null && String(file) !== ''
      if (!filePresent) return { leafStateKnown: true, leafPath: '' }
      return { leafStateKnown: false, leafPath: null }
    }
    return { leafStateKnown: true, leafPath: normalizeLeafPathForPresence(leaf.state?.path) }
  } catch {
    return { leafStateKnown: false, leafPath: null }
  }
}

/**
 * V2 — EMPTY Workspace SURFACE AUTHORITY. The surface is resolved from the
 * CURRENT active workspace leaf's own view container (`leaf.view.containerEl`),
 * never from the stale Markdown `#write` business root. Ownership is inherent
 * because the element comes straight off `workspace.activeLeaf.view`. The view
 * type is NOT assumed — in real Typora the empty placeholder leaf can be a
 * `core.empty` EmptyView or a `core.markdown` leaf with an empty path.
 */
function readActiveEmptyWorkspaceSurface(workspace: {
  activeLeaf?: { viewType?: string; view?: { containerEl?: unknown } } | null
}): EmptyWorkspaceSurfaceFacts | null {
  try {
    const leaf = workspace?.activeLeaf ?? null
    if (!leaf) {
      return { surface: null, source: 'NO_ACTIVE_LEAF', activeLeafExists: false, activeLeafViewType: null }
    }
    const viewType = leaf.viewType ?? null
    const container = leaf.view?.containerEl instanceof HTMLElement ? leaf.view.containerEl : null
    if (!container) {
      return { surface: null, source: 'VIEW_CONTAINER_MISSING', activeLeafExists: true, activeLeafViewType: viewType }
    }
    // The stale Markdown business root itself must NEVER become the surface.
    if (container === document.getElementById('write')) {
      return { surface: null, source: 'NOT_EMPTY_VIEW', activeLeafExists: true, activeLeafViewType: viewType }
    }
    return { surface: container, source: 'ACTIVE_EMPTY_LEAF_VIEW', activeLeafExists: true, activeLeafViewType: viewType }
  } catch {
    return { surface: null, source: 'NO_ACTIVE_LEAF', activeLeafExists: false, activeLeafViewType: null }
  }
}

interface ActiveLeafTabsNodeShape {
  type?: string
  on?: (event: string, listener: (leaf: unknown) => void) => () => void
}

interface ActiveLeafWorkspaceLifecycleShape {
  activeLeaf?: { state?: { path?: unknown }; parent?: ActiveLeafTabsNodeShape } | null
  activeFile?: unknown
  on?: (event: string, listener: () => void) => () => void
}

/**
 * Subscribe to the REAL workspace-tabs `tab:toggle` of the CURRENT active tabs
 * node. Workspace-tabs events do NOT bubble, and the active tabs node can change
 * (split layout / close-last re-root), so the subscription re-arms itself on
 * every workspace `active-leaf:change`. Returns a single dispose.
 */
function subscribeActiveTabsTabToggle(
  workspace: ActiveLeafWorkspaceLifecycleShape,
  onTogglePath: (path: string | null) => void,
): () => void {
  let currentTabs: ActiveLeafTabsNodeShape | null = null
  let disposeTabs: (() => void) | null = null
  let disposed = false

  const readToggleLeaf = (leaf: unknown): void => {
    if (disposed) return
    const state = (leaf as { state?: { path?: unknown } } | null)?.state
    onTogglePath(normalizeLeafPathForPresence(state?.path))
  }

  const attach = (): void => {
    if (disposed) return
    const parent = workspace.activeLeaf?.parent ?? null
    if (!parent || parent.type !== 'tabs' || parent === currentTabs) return
    disposeTabs?.()
    currentTabs = parent
    disposeTabs = parent.on?.('tab:toggle', readToggleLeaf) ?? null
  }

  attach()
  const disposeReArm = workspace.on?.('active-leaf:change', () => attach()) ?? (() => undefined)
  return () => {
    disposed = true
    disposeTabs?.()
    disposeReArm()
  }
}

/** V5.2 — 当前生效的 Typora 原生插入方式（只读展示，绝不改变原生行为）。 */
function describeTyporaInsertionMode(settings: ImageSettings): string {
  if (settings.uploadService === 'github') return '上传图片（GitHub）'
  const dir = settings.documentResourceDirectory
  if (dir === '' || dir === '.' || dir === './') return '复制到当前文件夹 ./'
  if (dir === 'assets' || dir === './assets') return '复制到 ./assets'
  if (dir.includes('${filename}.assets')) return '复制到 ./${filename}.assets'
  return `复制到指定路径（${dir}）`
}

function describeAutoSync(settings: ImageSettings): string {
  const parts: string[] = []
  if (settings.autoUpload) parts.push('自动上传')
  if (settings.autoLocalizeOnInsert) parts.push('自动本地化')
  return parts.length > 0 ? parts.join(' / ') : '关闭'
}

export default class extends Plugin<InkChapterSettings> {

  private numberingService?: HeadingNumberingService
  private captionService?: CaptionService
  private captionContextMenu?: CaptionContextMenu
  private numberingCoordinator?: DocumentNumberingCoordinator
  private documentUtilities?: DocumentUtilities
  /** B2d — async image bytes → sync diagnostics evidence. */
  private imageEvidenceRuntime = createImageEvidenceRuntime(createNodeImageEvidenceProvider())
  private imageEvidenceDocKey: string | null = null
  private imageEvidenceWarmSeq = 0
  private vaultRootPath: string | null = null
  /**
   * Heading Auto-Number Conflict V1.2 §21/§22 — the last dev/test bridge command.
   * The bridge never writes a report itself: it arms the ONE post-commit capture,
   * which stamps this command onto the report.
   */
  private headingConflictBridgeLastCommand: { command: string; arg: string | null; result: string } | null = null
  /** §24 V1.2 — the last consumed bridge nonce (idempotent, one command in flight). */
  private headingConflictBridgeLastNonce: string | null = null
  private docViewMenu?: DocumentViewContextMenu
  private tabCloseVisibility?: TabCloseVisibilityEnhancer
  private fileCopyService?: FileCopyService
  private nativeDragBridge?: NativeDragBridge
  private fileTreeDragAdapter?: FileTreeDragAdapter
  /** 图片资产索引服务：延迟加载，损坏索引不阻断插件启动。 */
  private imageAssetService?: ImageAssetService
  /** 传输任务持久化（上传队列与诊断）。 */
  private imageTransferTaskStore?: ImageTransferTaskStore
  /** 墨章侧上传适配器（PicGo 编程 API + 插件私有配置）。 */
  private imageUploadService?: ImageUploadService
  /** 远程图片下载（复用缓存/图库；默认不改写 Markdown）。 */
  private imageDownloadService?: ImageDownloadService
  /** 在 Typora 原生图片右键菜单中追加下载项。 */
  private imageContextMenuDownload?: ImageContextMenuDownload
  /** 系统安全凭据存储；只在插件内部持有，不挂到 window。 */
  private imageCredentialStore?: ImageCredentialStore
  /** V5.0 — 文件夹 / 文档级图片配置覆盖（插件私有数据目录）。 */
  private imageScopeStore?: ImageScopeStore
  /** V5.0 — 当前文档的生效图片配置解析服务。 */
  private imageDocumentScopeService?: ImageDocumentScopeService
  /** V5.0 — 原生插入后的逐文档策略执行器（默认不干预原生语义）。 */
  private imageInsertionController?: ImageInsertionController
  /** 当前文档已解析的图片配置（供同步回调如 readSettings 使用）。 */
  private activeImageSettings: ImageSettings | null = null
  /** V5.1 — 当前文档图片策略的作用域来源（面板展示）。 */
  private activeImageScopeSource: 'global' | 'folder' | 'document' = 'global'
  private activeImageScopeLabel = '全局默认'
  /** V5.1 — 当前文档批量操作（预览 → 确认 → 执行）。 */
  private documentImageBatchService?: DocumentImageBatchService
  /** V5.1 — 已验证资产知识（rawDestination → 本地/远程状态）；异步刷新。 */
  private documentHubAssetKnowledge = new Map<string, BatchReferenceKnowledge>()
  private documentHubAssetKnowledgeAt = 0
  /** V5.1 — 首次启用 / 变更提示的去重集合（本会话）。 */
  private documentHubNoticeSeen = new Set<string>()

  /**
   * V5.0 — 当前文档的生效图片配置（global → folder → document）。
   * 所有插件自有的图片动作（下载 / 上传 / 批量 / 图库中心）都必须走这里，
   * 而不是直接读全局 `image` 设置。
   */
  private async resolveActiveImageSettings(): Promise<ImageSettings> {
    const globalSettings = resolveImageSettings(this.settings.get('image' as keyof InkChapterSettings) as never)
    if (!this.imageDocumentScopeService) {
      this.activeImageSettings = globalSettings
      return globalSettings
    }
    try {
      const resolved = await this.imageDocumentScopeService.resolve()
      this.activeImageSettings = resolved.settings
      const origin = resolved.origins.find(item => item.key === 'documentResourceDirectory')?.origin ?? 'global'
      this.activeImageScopeSource = origin
      this.activeImageScopeLabel = origin === 'document'
        ? '覆盖：当前文档'
        : origin === 'folder'
          ? '继承：当前文件夹'
          : '全局默认'
      return resolved.settings
    } catch {
      this.activeImageSettings = globalSettings
      this.activeImageScopeSource = 'global'
      this.activeImageScopeLabel = '全局默认'
      return globalSettings
    }
  }

  /** V5.1 — 当前文档图片摘要（文档管理中心面板；只读，不创建目录）。 */
  private buildDocumentHubImageSummary(): DocumentHubImageSummary | null {
    const settings = this.activeImageSettings
      ?? resolveImageSettings(this.settings.get('image' as keyof InkChapterSettings) as never)
    if (!settings.enabled) return null
    const documentPath = this.app.workspace.activeFile ?? null
    let markdown: string | null = null
    try { markdown = editor.getMarkdown() } catch { markdown = null }
    const refs = markdown ? parseImageSourceOccurrences(markdown) : []
    const knowledge = this.documentHubAssetKnowledge
    const batchRefs = refs.map(ref => ({
      rawDestination: ref.rawDestination,
      isRemote: !ref.isLocal,
      isLocal: ref.isLocal,
      localExists: null,
      assetKnown: knowledge.get(ref.rawDestination) ?? ('unknown' as const),
    }))
    const projectDirectory = documentPath
      ? resolveImageProjectDirectory(documentPath, settings.documentResourceDirectory)
      : null
    const preview = buildDocumentImageBatchPreview({
      references: batchRefs,
      settings,
      projectDirectory,
      uploadAvailable: settings.uploadService === 'github',
    })
    // 异步刷新资产知识（不阻塞面板；失败保持 unknown，不冒充“已复用”）。
    void this.refreshDocumentHubAssetKnowledge()
    return {
      enabled: true,
      referenceCount: preview.totalReferences,
      localCount: preview.localReferences,
      remoteCount: preview.remoteReferences,
      reuseLocalCount: preview.reuseLocalCount,
      reuseRemoteCount: preview.reuseRemoteCount,
      pendingUploadCount: preview.pendingUploadCount,
      pendingDownloadCount: preview.pendingDownloadCount,
      missingLocalCount: preview.missingLocalCount,
      dualLinkCompleteCount: preview.dualLinkCompleteCount,
      policyText: summarizeImagePolicy(settings),
      scopeSource: this.activeImageScopeSource,
      scopeLabel: this.activeImageScopeLabel,
      projectDirectory,
      insertionModeText: describeTyporaInsertionMode(settings),
      autoSyncText: describeAutoSync(settings),
    }
  }

  /** V5.1 — 从资产索引刷新“已验证”知识（节流；只读）。 */
  private async refreshDocumentHubAssetKnowledge(): Promise<void> {
    const now = Date.now()
    if (now - this.documentHubAssetKnowledgeAt < 5000) return
    this.documentHubAssetKnowledgeAt = now
    try {
      const assets = await this.imageAssetService?.list() ?? []
      const map = new Map<string, BatchReferenceKnowledge>()
      for (const asset of assets) {
        const hasLocal = asset.locations.some(loc => loc.type !== 'github' && loc.availability === 'available')
        const hasRemote = asset.locations.some(loc => loc.type === 'github' && loc.availability === 'available')
        const known: BatchReferenceKnowledge = hasLocal && hasRemote
          ? 'both'
          : hasLocal
            ? 'local-verified'
            : hasRemote
              ? 'remote-verified'
              : 'unknown'
        for (const loc of asset.locations) {
          if (loc.type === 'github') map.set(loc.locator, known)
        }
      }
      this.documentHubAssetKnowledge = map
    } catch { /* 索引不可用时保持 unknown */ }
  }

  /** V5.1 — 批量图片服务（预览只读；确认后才执行；默认不改写 Markdown）。 */
  private getDocumentImageBatchService(): DocumentImageBatchService {
    if (this.documentImageBatchService) return this.documentImageBatchService
    const service = new DocumentImageBatchService({
      getMarkdown: () => {
        try { return editor.getMarkdown() } catch { return null }
      },
      getDocumentPath: () => this.app.workspace.activeFile ?? null,
      getSettings: () => this.activeImageSettings
        ?? resolveImageSettings(this.settings.get('image' as keyof InkChapterSettings) as never),
      resolveProjectDirectory: (settings) => {
        const documentPath = this.app.workspace.activeFile
        if (!documentPath) return null
        return resolveImageProjectDirectory(documentPath, settings.documentResourceDirectory)
      },
      getAssetKnowledge: () => this.documentHubAssetKnowledge,
      upload: async (filePath) => {
        const uploader = this.imageUploadService
        if (!uploader) return { ok: false, message: 'UPLOAD_SERVICE_UNAVAILABLE' }
        const result = await uploader.uploadLocalFile({ filePath })
        return result.ok ? { ok: true, resultKind: result.resultKind } : { ok: false, message: result.message }
      },
      download: async (url) => {
        const downloader = this.imageDownloadService
        const documentPath = this.app.workspace.activeFile
        if (!downloader || !documentPath) return { ok: false, message: 'DOWNLOAD_SERVICE_UNAVAILABLE' }
        const settings = await this.resolveActiveImageSettings()
        const projectDirectory = resolveImageProjectDirectory(documentPath, settings.documentResourceDirectory)
        const result = await downloader.download({ url, documentPath, projectDirectory, placement: 'project' })
        return result.ok ? { ok: true, resultKind: result.resultKind } : { ok: false, message: result.message }
      },
      confirm: (message) => window.confirm(message),
      notify: (message, kind) => {
        if (kind === 'error') Notice.error(`墨章：${message}`)
        else Notice.info(`墨章：${message}`)
      },
    })
    this.documentImageBatchService = service
    return service
  }

  /** V5.1 — 面板提示：首次启用只提示一次；不改变任何配置。 */
  private documentHubHint(): string | null {
    const settings = this.activeImageSettings
    if (!settings?.enabled) return null
    const key = `image-hub:${settings.initialized ? 1 : 0}:${settings.uploadService}:${settings.referenceMode}`
    if (this.documentHubNoticeSeen.has(key)) return null
    this.documentHubNoticeSeen.add(key)
    return '首次启用：批量操作会先显示预览，确认后才会上传/下载；默认不改写 Markdown。'
  }

  /** V5.1 — 图片设置入口（面板“图片设置…”）。 */
  private openImageSettingsEntry(): void {
    Notice.info('墨章：按 Ctrl+. 打开插件设置，选择「墨章 · 图片」调整图片策略。')
  }

  /**
   * F2 — resolve a caption target by the diagnostics' OWN canonical identity
   * (`block:<kind>:<ordinal>`). The caption service decides the authoritative
   * target order; the raw DOM order is only a bounded fallback.
   */
  private resolveCaptionElementByCanonicalOrdinal(
    kind: 'code' | 'table',
    identity: string,
  ): HTMLElement | null {
    const match = new RegExp(`^block:${kind}:(\\d+)$`).exec(identity)
    if (!match) return null
    const ordinal = Number.parseInt(match[1], 10)
    const root = document.getElementById('write')
    if (!root) return null
    const selector = kind === 'code' ? 'pre.md-fences' : 'table'
    const all = Array.from(root.querySelectorAll<HTMLElement>(selector))
    const service = this.captionService
    if (!service) return all[ordinal] ?? null
    let index = 0
    for (const element of all) {
      const naming = service.resolveCaptionNamingTarget(element)
      if (!naming || naming.type !== kind) continue
      if (index === ordinal) return element
      index++
    }
    return all[ordinal] ?? null
  }

  /** 文档切换 / 设置变化后刷新缓存，避免同步回调读到上一份文档的配置。 */
  private refreshActiveImageScope(): void {
    void this.resolveActiveImageSettings().catch(() => undefined)
  }

  /** 当前文档的生效作用域（设置页展示继承关系用；失败时返回 null）。 */
  private async readActiveImageScope() {
    if (!this.imageDocumentScopeService) return null
    try {
      return await this.imageDocumentScopeService.resolve()
    } catch {
      return null
    }
  }

  /**
   * 图片数据根目录。
   *
   * 框架的 `dataPath` 指向**设置文件**（`<dataDir>/<pluginId>.json`），
   * 不能直接当作目录传给 `resolveImageDataPaths`，否则会生成
   * `.../ranzhi.inkchapter.json/image` 这种把文件当目录的非法路径。
   */
  private get imageDataBaseDir(): string {
    return path.dirname(this.dataPath)
  }

  /** 懒创建系统安全凭据存储；失败时返回 null（上传将被阻止）。 */
  private getOrCreateCredentialStore(): ImageCredentialStore | null {
    if (this.imageCredentialStore) return this.imageCredentialStore
    try {
      const settings = resolveImageSettings(this.settings.get('image' as keyof InkChapterSettings) as never)
      const paths = resolveImageDataPaths(this.imageDataBaseDir, { settings })
      this.imageCredentialStore = new WindowsDpapiCredentialStore({
        rootDir: path.join(paths.dataRoot, 'secrets'),
      })
      return this.imageCredentialStore
    } catch {
      return null
    }
  }

  /** 只读连接测试；Token 只在本方法内短期持有，不写入日志或设置。 */
  private async testImageRemoteConnection(
    profile: ImageRemoteProfile,
  ): Promise<GitHubConnectionTestResult> {
    const store = this.getOrCreateCredentialStore()
    if (!store || store.backend === 'unavailable') {
      return {
        ok: false,
        summary: '系统安全存储不可用，无法读取 Token；上传保持禁用。',
        checks: [],
        resolvedBranch: null,
        repoPrivate: null,
      }
    }
    const credential = await store.read(resolveCredentialReferenceId(profile))
    if (!credential.ok) {
      return {
        ok: false,
        summary: credential.code === 'CREDENTIAL_NOT_FOUND'
          ? '尚未保存 GitHub Token，请先保存后再测试连接。'
          : '无法读取已保存的 GitHub Token，请重新保存。',
        checks: [],
        resolvedBranch: null,
        repoPrivate: null,
      }
    }
    return testGitHubConnection({ profile, token: credential.secret })
  }

  /** 下载目标按当前文档与图库配置动态计算（不需要用户理解资产模型）。 */
  private imageDownloadTargets(): Array<'project' | 'library' | 'offline' | 'custom'> {
    const targets: Array<'project' | 'library' | 'offline' | 'custom'> = []
    if (this.app.workspace.activeFile) targets.push('project')
    try {
      const settings = this.activeImageSettings
        ?? resolveImageSettings(this.settings.get('image' as keyof InkChapterSettings) as never)
      const paths = resolveImageDataPaths(this.imageDataBaseDir, { settings })
      if (paths.libraryImagesDir) targets.push('library')
    } catch { /* ignore */ }
    targets.push('offline', 'custom')
    return targets
  }

  /** 工具栏“下载图片”入口：下载到指定位置，可选替换当前引用。 */
  private async downloadImageFromToolbar(input: {
    img: HTMLImageElement
    url: string
    destination: 'project' | 'library' | 'offline' | 'custom'
    replaceReference: boolean
  }): Promise<{ ok: boolean; message: string }> {
    const service = this.imageDownloadService
    if (!service) return { ok: false, message: '图片下载服务未就绪，请重启 Typora 后重试' }
    const documentPath = this.app.workspace.activeFile ?? null
    if (!documentPath && input.destination === 'project') {
      return { ok: false, message: '当前文档尚未保存，无法下载到文档图片目录' }
    }
    let customDirectory: string | null = null
    if (input.destination === 'custom') {
      customDirectory = await pickFolderNative({ description: '选择图片下载目录' })
      if (!customDirectory) return { ok: false, message: '已取消下载' }
    }
    let projectDirectory: string | null = null
    if (documentPath) {
      const settings = await this.resolveActiveImageSettings()
      projectDirectory = resolveImageProjectDirectory(documentPath, settings.documentResourceDirectory)
    }
    const result = await service.download({
      url: input.url,
      documentPath,
      projectDirectory,
      placement: input.destination,
      customDirectory,
    })
    if (!result.ok || !result.filePath) {
      return { ok: false, message: result.message }
    }
    let alreadyLinked = false
    if (input.replaceReference) {
      const rewrite = this.rewriteImageReferenceToLocal(input.img, result.filePath)
      if (!rewrite.ok) {
        return { ok: false, message: `图片已下载，但 Markdown 引用替换失败：${rewrite.reason}` }
      }
      alreadyLinked = rewrite.resultKind === 'ALREADY_LINKED'
    }
    const action = result.resultKind === 'REUSED_LOCAL'
      ? '本地已有相同图片，已直接复用，无需重复下载'
      : result.resultKind === 'COPIED_EXISTING_LOCAL'
        ? '已复用本地已有图片并复制到目标目录，无需联网下载'
        : '已下载新图片'
    const referenceNote = !input.replaceReference
      ? ''
      : alreadyLinked
        ? '，当前引用已正确，无需修改'
        : '，并已更新当前图片引用'
    return {
      ok: true,
      message: `${action}${referenceNote}${input.replaceReference ? '' : `：${path.basename(result.filePath)}`}`,
    }
  }

  /** 原生图片右键菜单「下载并转为本地引用（墨章）」：复用/下载后只改当前引用。 */
  private async downloadImageFromContextMenu(img: HTMLImageElement): Promise<void> {
    const wrapper = img.closest<HTMLElement>('.md-image')
    const url = wrapper?.getAttribute('data-src')?.trim() || img.getAttribute('src')?.trim() || ''
    if (!url) {
      Notice.error('墨章：无法读取当前图片地址')
      return
    }
    const result = await this.downloadImageFromToolbar({
      img,
      url,
      destination: 'project',
      replaceReference: true,
    })
    if (result.ok) Notice.info(`墨章：${result.message}`)
    else Notice.error(`墨章：下载失败 — ${result.message}`)
  }

  /** 批量下载当前文档的全部远程图片；只落盘登记，不改写 Markdown。 */
  private async downloadDocumentRemoteImagesInteractive(): Promise<void> {
    const service = this.imageDownloadService
    if (!service) {
      Notice.error('墨章：图片下载服务未就绪，请重启 Typora 后重试')
      return
    }
    const documentPath = this.app.workspace.activeFile ?? null
    if (!documentPath) {
      Notice.info('墨章：当前文档尚未保存，无法确定下载目录')
      return
    }
    const markdown = editor.getMarkdown()
    const settings = await this.resolveActiveImageSettings()
    const projectDirectory = resolveImageProjectDirectory(documentPath, settings.documentResourceDirectory)
    const summary = await downloadDocumentRemoteImages({
      markdown,
      documentPath,
      projectDirectory,
      maxConcurrent: settings.limits.maxConcurrentDownloads,
      download: input => service.download(input),
    })
    if (summary.total === 0) {
      Notice.info('墨章：本文档没有远程图片')
      return
    }
    const detail = `复用 ${summary.reused} 张、实际下载 ${summary.downloaded} 张、本地复制 ${summary.copied} 张、`
      + `失败 ${summary.failed} 张（网络传输 ${summary.networkTransfers} 次）`
    if (summary.failed > 0) {
      Notice.error(`墨章：${detail}；Markdown 未改动，失败项可重试`)
    } else {
      Notice.info(`墨章：${detail}；Markdown 未改动`)
    }
  }

  /** 只替换当前图片的 destination；保留 alt / 图号 / 图名与其他正文。 */
  private rewriteImageReferenceToLocal(
    img: HTMLImageElement,
    filePath: string,
  ): { ok: boolean; reason?: string; resultKind?: 'ALREADY_LINKED' | 'REWRITTEN' } {
    const documentPath = this.app.workspace.activeFile
    if (!documentPath) return { ok: false, reason: 'NO_ACTIVE_DOCUMENT' }
    const markdown = editor.getMarkdown()
    const wrapper = img.closest<HTMLElement>('.md-image')
    const dataSrc = wrapper?.getAttribute('data-src') ?? null
    const src = img.getAttribute('src')
    const selection = selectMarkdownImageReference({
      markdown,
      documentPath,
      rawDestinations: [dataSrc, src],
      occurrenceIndex: this.remoteImageOccurrenceIndex(img),
    })
    if (!selection.reference) return { ok: false, reason: selection.reason ?? 'NO_REFERENCE' }
    const outcome = applyReferenceDestination(
      markdown,
      selection.reference,
      relativeMarkdownImagePath(documentPath, filePath),
    )
    if (!outcome) return { ok: false, reason: 'INVALID_DESTINATION_RANGE' }
    // 目标引用已经正确：返回 ALREADY_LINKED，不触发重载，避免无意义的正文
    // 写入与撤销栈污染（alt / 图号 / 图名保持不变）。
    if (outcome.kind === 'ALREADY_LINKED') return { ok: true, resultKind: 'ALREADY_LINKED' }
    // 第三参数 false：保留 Typora 撤销历史（与现有安全写回路径一致）。
    File.reloadContent(outcome.markdown, false, false, false, true)
    return { ok: true, resultKind: 'REWRITTEN' }
  }

  /**
   * V5.0 — 原生插入策略执行后的引用改写：按 destination 定位唯一引用，
   * 只替换目标地址（alt / 图号 / 图名 / 正文保持不变）。
   */
  private rewriteInsertedReference(rawDestination: string, newDestination: string): boolean {
    const documentPath = this.app.workspace.activeFile
    if (!documentPath) return false
    let markdown: string
    try {
      markdown = editor.getMarkdown()
    } catch {
      return false
    }
    const selection = selectMarkdownImageReference({
      markdown,
      documentPath,
      rawDestinations: [rawDestination],
      occurrenceIndex: 0,
    })
    if (!selection.reference) return false
    const outcome = applyReferenceDestination(markdown, selection.reference, newDestination)
    if (!outcome) return false
    if (outcome.kind === 'ALREADY_LINKED') return true
    this.invalidateImageEvidenceDestinations([rawDestination, newDestination])
    try {
      File.reloadContent(outcome.markdown, false, false, false, true)
      return true
    } catch {
      return false
    }
  }

  /** 让 Typora 原生「上传图片」调用墨章 CLI（可逆：写入前自动备份 profile.data）。 */
  private async switchTyporaNativeUploader(): Promise<void> {
    const manifest = (this as unknown as { manifest?: { dir?: string } }).manifest
    const pluginDir = manifest?.dir?.trim() ?? ''
    if (!pluginDir) {
      Notice.error('墨章：无法定位插件目录，未修改 Typora 上传器')
      return
    }
    const nodeExecutable = findNodeExecutable()
    if (!nodeExecutable) {
      Notice.error('墨章：未找到 Node.js，无法切换 Typora 自定义上传器')
      return
    }
    const result = await switchTyporaUploaderToInkChapter({
      nodeExecutable,
      cliPath: path.join(pluginDir, 'upload-cli.cjs'),
      settingsFile: this.dataPath,
    })
    if (!result.ok) {
      Notice.error(`墨章：Typora 上传器切换失败（${result.code ?? 'UNKNOWN'}）— ${result.message}`)
      return
    }
    const applied = result.command
      ? applyTyporaUploaderRuntime({ uploader: TYPORA_CUSTOM_UPLOADER, command: result.command })
      : false
    Notice.info(applied
      ? '墨章：Typora 上传图片按钮已切换到墨章适配器；若当前窗口仍提示未设置，请重启 Typora'
      : '墨章：Typora 上传图片按钮已切换到墨章适配器，请重启 Typora 生效')
  }

  /** 恢复 Typora 原生上传器设置（使用最近一次自动备份）。 */
  private async restoreTyporaNativeUploader(): Promise<void> {
    const result = await restoreTyporaUploaderFromLatestBackup()
    if (!result.ok) {
      Notice.error(`墨章：${result.message}`)
      return
    }
    const applied = result.state
      ? applyTyporaUploaderRuntime({
        uploader: result.state.imageUploader ?? '',
        command: result.state.customImageUploader ?? '',
      })
      : false
    Notice.info(applied
      ? '墨章：已恢复 Typora 原生上传器设置；若当前窗口仍使用墨章适配器，请重启 Typora'
      : '墨章：已恢复 Typora 原生上传器设置，请重启 Typora 生效')
  }

  /** 同一原始远程 URL 的图片序号（不依赖 alt/文件名/图号）。 */
  private remoteImageOccurrenceIndex(img: HTMLImageElement): number {
    const root = img.closest('#write') ?? document.getElementById('write')
    if (!root) return 0
    const keyOf = (el: HTMLImageElement): string => {
      const wrapper = el.closest<HTMLElement>('.md-image')
      return wrapper?.getAttribute('data-src') ?? el.getAttribute('src') ?? ''
    }
    const key = keyOf(img)
    let index = 0
    for (const candidate of Array.from(root.querySelectorAll('img'))) {
      if (keyOf(candidate) !== key) continue
      if (candidate === img) return index
      index++
    }
    return 0
  }

  /** 界面 / 文件夹树 配置（读取侧唯一权威：缺失字段按默认值补齐）。 */
  private readUiSettings() {
    return resolveUiSettings(this.settings.get('ui' as keyof InkChapterSettings) as never)
  }

  /**
   * 手动上传单张本地图片：选择文件 → 走墨章上传器 → 复制真实 URL。
   * 不修改当前 Markdown，也不删除源文件。
   */
  private async uploadLocalImageInteractive(): Promise<void> {
    const settings = await this.resolveActiveImageSettings()
    if (!settings.enabled) {
      Notice.info('墨章：图片管理尚未启用，请先在「设置 → 墨章 · 图片」启用。')
      return
    }
    if (!this.imageUploadService) {
      Notice.error('墨章：上传服务未就绪，请重启 Typora 后重试。')
      return
    }
    if (settings.uploadService !== 'github') {
      const conflict = await this.imageUploadService.inspectInsertModeConflict()
      const suffix = conflict.hasConflict
        ? ' 当前 Typora 插入方式为「上传图片」，同样不会自动上传。'
        : ''
      Notice.error(`墨章：上传服务为「无」，未发起上传。请在「设置 → 墨章 · 图片」启用 GitHub 上传服务。${suffix}`)
      return
    }

    const filePath = await pickImageFileNative({ description: '选择要上传到图床的图片' })
    if (!filePath) return

    const result = await this.imageUploadService.uploadLocalFile({ filePath })
    if (!result.ok) {
      Notice.error(`墨章：上传失败（${result.errorCode}）— ${result.message}`)
      return
    }
    let copied = false
    try {
      await navigator.clipboard.writeText(result.url)
      copied = true
    } catch { /* 剪贴板不可用时仍展示 URL */ }
    const action = result.resultKind === 'REUSED_REMOTE'
      ? 'GitHub 已有相同图片，已直接复用云端链接，无需重复上传（0 次上传）'
      : '已上传新图片（1 次上传）'
    Notice.info(`墨章：${action}${copied ? '，URL 已复制' : ''}：${result.url}`)
  }

  /**
   * 构建四视图图库中心（只读）。
   * 图片管理未启用或服务未初始化时返回空数组，设置页据此显示「尚未就绪」。
   */
  private async buildImageLibraryCenter(): Promise<ImageLibraryView[]> {
    const settings = await this.resolveActiveImageSettings()
    if (!settings.enabled || !this.imageAssetService || !this.imageUploadService) return []

    const paths = resolveImageDataPaths(this.imageDataBaseDir, { settings })
    const assets = await this.imageAssetService.list()
    const tasks = this.imageTransferTaskStore ? await this.imageTransferTaskStore.list() : []
    const typoraPreferences = await this.imageUploadService.readTyporaImagePreferences()

    const documentPath = this.app.workspace.activeFile ?? null
    let markdown: string | null = null
    if (documentPath) {
      try {
        const content = File.getContent()
        if (typeof content === 'string') markdown = content
      } catch { /* 编辑器未就绪时只展示「未索引」状态 */ }
    }

    let cacheUsage: { fileCount: number; totalBytes: number } | null = null
    if (paths.cacheObjectsDir) {
      try {
        const usage = await inspectDirectoryUsage(paths.cacheObjectsDir)
        cacheUsage = { fileCount: usage.fileCount, totalBytes: usage.totalBytes }
      } catch { /* 缓存目录尚未创建 */ }
    }

    return buildImageLibraryCenter({
      documentPath,
      markdown,
      assets,
      tasks,
      settings,
      paths,
      typoraPreferences,
      cacheUsage,
    })
  }

  /** 界面配置应用次数（有界取证 A3，仅计数，不产生日志风暴）。 */
  private uiApplyCount = 0

  /**
   * 应用 Ribbon 可见性 —— **幂等、只写墨章自己的类、绝不与框架争夺框架类**。
   *
   * `ui.ribbon === false`（默认）= 保持 Typora 原生侧栏：
   *   仅切换 `body.inkchapter-ribbon-hidden`；框架的 `typ-ribbon--enable` **保持不动**
   *   （它是框架自己的模式状态），原生「文件 / 搜索 / 大纲」切页栏与侧栏布局改由
   *   style.scss 在墨章命名空间下恢复。状态未变化时零 DOM 写入 ⇒ 无 MutationRecord
   *   ⇒ 不触发任何观察者，也不与框架形成“写—观察”反馈环。
   *
   * 只允许由：插件设置加载完成、用户修改 `ui.ribbon`、设置页写回 触发。
   */
  private applyRibbonVisibility(): void {
    try {
      const body = document.body
      if (!body) return
      this.uiApplyCount++
      const hidden = resolveRibbonHidden(this.readUiSettings().ribbon)
      const wrote = applyRibbonHiddenClass(body, hidden)
      if (wrote) {
        emitRuntimeAudit('INKCHAPTER-UI-RIBBON-STATE', {
          ribbonHidden: hidden,
          frameworkRibbonEnabled: body.classList.contains(FRAMEWORK_RIBBON_ENABLE_CLASS),
          domWrite: true,
          applyCount: this.uiApplyCount,
        })
      }
    } catch { /* fail-open */ }
  }

  /**
   * B3 — apply the selected academic profile only to the plugin's own CSS
   * namespace. It never rewrites the user's Markdown or Typora configuration.
   */
  private applyAcademicProfile(): void {
    try {
      const ui = this.readUiSettings()
      const profile = resolveDiagnosticProfile(ui.diagnosticProfile)
      const width = ui.academicWidthPreset === 'custom'
        ? resolveAcademicWidthModel({ customPx: ui.academicCustomWidthPx })
        : resolveAcademicWidthModel({ preset: ui.academicWidthPreset })
      const body = document.body
      if (!body) return
      const active = ui.diagnosticProfile !== 'general'
      document.documentElement.style.setProperty('--inkchapter-content-width', `${width.contentWidthPx}px`)
      body.classList.toggle('inkchapter-academic-width', active)
      body.dataset['inkchapterDiagnosticProfile'] = profile.id
      emitRuntimeAudit('INKCHAPTER-ACADEMIC-PROFILE', {
        profile: profile.id,
        contentWidthPx: width.contentWidthPx,
        clamped: width.clamped,
        active,
      })
    } catch { /* fail-open: a broken setting must never break the plugin */ }
  }

  private readDiagnosticProfile(): ResolvedDiagnosticProfile {
    try { return resolveDiagnosticProfile(this.readUiSettings().diagnosticProfile) } catch {
      return resolveDiagnosticProfile('general')
    }
  }

  // ── B2d — document-scoped async image evidence ───────────────────────────

  private activeDocumentKeyForEvidence(): string | null {
    try {
      const fp = this.app.workspace.activeFile
      const vr = this.vaultRootPath ?? ''
      if (!fp || !vr) return null
      return generateDocumentKey(fp, vr)
    } catch { return null }
  }

  private resolveImageDestinationPath(destination: string): string | null {
    const raw = String(destination ?? '').trim()
    if (raw === '' || /^(?:https?:|data:|blob:|file:|\/|[A-Za-z]:[\\/]|\\\\)/i.test(raw)) return null
    let decoded = raw.split('#')[0].split('?')[0]
    try { decoded = decodeURIComponent(decoded) } catch { /* keep raw */ }
    if (!/\.(?:png|jpe?g|gif|bmp|webp|avif|svg)$/i.test(decoded)) return null
    const base = this.app.workspace.activeFile
      ? path.dirname(this.app.workspace.activeFile)
      : this.vaultRootPath
    if (!base) return null
    try { return path.resolve(base, decoded) } catch { return null }
  }

  /** Sync, document-isolated evidence for diagnostics (no file IO). */
  private getImageEvidenceForDestination(destination: string): {
    format: string | null
    sha256: string
    sizeBytes: number
  } | null {
    if (this.imageEvidenceDocKey !== this.activeDocumentKeyForEvidence()) return null
    const resolved = this.resolveImageDestinationPath(destination)
    if (!resolved) return null
    return this.imageEvidenceRuntime.get(resolved)
  }

  /** Evidence must be dropped when the Markdown destination changes. */
  private invalidateImageEvidenceDestinations(destinations: readonly string[]): void {
    for (const destination of destinations) {
      const resolved = this.resolveImageDestinationPath(destination)
      if (resolved) this.imageEvidenceRuntime.invalidatePath(resolved)
    }
  }

  /**
   * Fire-and-forget warm of the ACTIVE document's local images. The sync
   * diagnostics path never waits; when new evidence appears the host is asked
   * for ONE coalesced recompute.
   */
  private prewarmImageEvidenceForActiveDocument(): void {
    try {
      const docKey = this.activeDocumentKeyForEvidence()
      if (!docKey) return
      if (this.imageEvidenceDocKey !== docKey) {
        this.imageEvidenceDocKey = docKey
        this.imageEvidenceRuntime.setDocument(docKey)
      }
      let markdown = ''
      try { markdown = editor.getMarkdown() } catch { return }
      const occurrences = parseImageSourceOccurrences(markdown)
      const unique = new Set<string>()
      for (const occurrence of occurrences) {
        if (!occurrence.isLocal) continue
        const resolved = this.resolveImageDestinationPath(occurrence.rawDestination)
        if (resolved) unique.add(resolved)
      }
      if (unique.size === 0) return
      const seq = ++this.imageEvidenceWarmSeq
      void this.imageEvidenceRuntime.warm([...unique]).then(appeared => {
        if (!appeared || seq !== this.imageEvidenceWarmSeq) return
        if (this.imageEvidenceDocKey !== this.activeDocumentKeyForEvidence()) return
        this.documentUtilities?.requestDiagnosticsRefresh?.('IMAGE_EVIDENCE_READY')
      }).catch(() => { /* evidence is optional; never break diagnostics */ })
    } catch { /* fail-open */ }
  }


  /**
   * 有界取证（A3）——3 次一次性心跳，证明 onload 之后主线程仍在运行、以及最终的
   * Ribbon 状态；发射完即停止，**不做任何轮询 / 长期观察器**。仅用于 Runtime 验收。
   */
  private emitResponsiveHeartbeats(): void {
    try {
      for (const ms of [1000, 3000, 6000]) {
        const id = window.setTimeout(() => {
          try {
            const body = document.body
            emitRuntimeAudit('INKCHAPTER-UI-RESPONSIVE-HEARTBEAT', {
              afterMs: ms,
              ribbonHidden: body.classList.contains(INKCHAPTER_RIBBON_HIDDEN_CLASS),
              frameworkRibbonEnabled: body.classList.contains(FRAMEWORK_RIBBON_ENABLE_CLASS),
              uiApplyCount: this.uiApplyCount,
              ribbonObserverCount: 0,
            })
          } catch { /* fail-open */ }
        }, ms)
        this.register(() => window.clearTimeout(id))
      }
    } catch { /* fail-open */ }
  }

  constructor(...args: ConstructorParameters<typeof Plugin>) {
    super(...args)
    console.log('[InkChapter] INKCHAPTER-BOOT-CONSTRUCTOR-SUCCESS')
  }

  onload() {
    console.log('[InkChapter] INKCHAPTER-BOOT-ONLOAD-START')
    console.log(`[InkChapter] onload START  build=${INKCHAPTER_BUILD_ID}`)

    // ── Startup SyntaxError attribution ──────────
    // Catch SyntaxError: Unexpected token ')' that may appear during
    // Typora startup and formally attribute it to InkChapter or an external
    // script (community-plugin core / Typora / another plugin).
    const startupErrorHandler = (event: ErrorEvent): void => {
      if (event.error instanceof SyntaxError && event.error.message.includes("Unexpected token ')'")) {
        const filename = event.filename ?? ''
        const stack = event.error.stack ?? ''
        const source = filename || (stack.match(/https?:\/\/[^\s)]+/) ?? [])[0] || stack.split('\n')[0] || 'unknown'
        const isInkChapter = filename.toLowerCase().includes('inkchapter') ||
          stack.toLowerCase().includes('inkchapter')
        console.info(
          `[InkChapter] SYNTAX-ERROR-ATTRIBUTION ` +
          `decision=${isInkChapter ? 'INKCHAPTER' : 'UNRELATED_EXTERNAL'} ` +
          `source=${source} filename=${filename} build=${INKCHAPTER_BUILD_ID}`,
        )
        console.info(
          `[InkChapter] SYNTAX-ERROR-ATTRIBUTION-EVIDENCE message=${event.error.message} ` +
          `stack=${stack.slice(0, 500)}`,
        )
      }
    }
    window.addEventListener('error', startupErrorHandler)
    // Remove after 10s — startup-only diagnostic
    setTimeout(() => window.removeEventListener('error', startupErrorHandler), 10000)

    // Runtime audit: disabled (uncomment enableRuntimeAudit() for diagnostics)
    // Register settings (must succeed for plugin to function)
    this.registerSettings(
      new PluginSettings(this.app, this.manifest, {
        version: DEFAULT_SETTINGS.schemaVersion,
      }),
    )
    this.settings.setDefault(DEFAULT_SETTINGS)
    console.log('[InkChapter] settings registered')

    // ── Schema migration: add levelRange if missing ──
    try {
      const current = this.settings.get('levelRange' as keyof InkChapterSettings) as any
      if (!current) {
        this.settings.set('levelRange' as keyof InkChapterSettings, {
          defaultMaxLevel: 6,
          documentOverrides: {},
        } as any)
        console.log('[InkChapter] levelRange migration applied')
      }
    } catch (e) {
      console.error('[InkChapter] migration error:', e)
    }

    // ── Schema migration: add specialNumbering if missing ──
    try {
      const current = this.settings.get('specialNumbering' as keyof InkChapterSettings) as any
      if (!current) {
        this.settings.set('specialNumbering' as keyof InkChapterSettings, {
          unnumberedCounterPolicy: 'skip',
          nameSettings: {
            enabled: true,
            candidates: [
              '摘要', 'Abstract', '关键词', 'Keywords',
              '引言', '前言', '结语', '总结',
              '参考文献', 'References', '致谢', '附录',
              '作者简介',
            ].map((text: string) => ({ text, enabled: true })),
            matchMode: 'trim',
            matchAction: 'prompt',
          },
        } as any)
        console.log('[InkChapter] specialNumbering migration applied')
      }
    } catch (e) {
      console.error('[InkChapter] migration error:', e)
    }

    // ── Schema migration: init formatLibrary if missing ──
    try {
      const current = this.settings.get('formatLibrary' as keyof InkChapterSettings) as any
      if (!current || !current.version) {
        this.settings.set('formatLibrary' as keyof InkChapterSettings, {
          version: 1,
          formats: [],
        } as any)
        console.log('[InkChapter] formatLibrary migration applied')
      }
    } catch (e) {
      console.error('[InkChapter] formatLibrary migration error:', e)
    }

    // ── Schema migration: init caption settings if missing ──
    try {
      const current = this.settings.get('caption' as keyof InkChapterSettings) as any
      if (!current || !current.types) {
        this.settings.set('caption' as keyof InkChapterSettings, {
          schemaVersion: 1,
          types: {
            table: { enabled: true, position: 'above', prefix: '表', numbering: 'continuous' },
            figure: { enabled: true, position: 'below', prefix: '图', numbering: 'continuous' },
            code: { enabled: true, position: 'above', prefix: '代码', numbering: 'continuous' },
          },
        } as any)
        console.log('[InkChapter] caption settings migration applied')
      }
    } catch (e) {
      console.error('[InkChapter] caption settings migration error:', e)
    }

    // ── Schema migration: init ui (界面 / 文件夹树) if missing ──
    try {
      const current = this.settings.get('ui' as keyof InkChapterSettings) as any
      if (!current || typeof current !== 'object') {
        this.settings.set('ui' as keyof InkChapterSettings, DEFAULT_UI_SETTINGS as any)
        console.log('[InkChapter] ui settings migration applied')
      }
    } catch (e) {
      console.error('[InkChapter] ui settings migration error:', e)
    }

    // Build service context (exposes only needed APIs, avoids protected access)
    // R58.4: Authoritative vault root from Typora Core app.vault.path
    let vaultRoot: string | undefined
    try {
      // Access app.vault — the authoritative vault service from Typora Community Core
      const appVault = (this.app as any).vault as { path?: string } | undefined
      if (appVault?.path) {
        vaultRoot = appVault.path
        console.info(`[InkChapter] SIDECAR-CONTEXT-UPDATE: vaultRoot=${vaultRoot} source=vault-service`)
      }
    } catch { /* vaultRoot stays undefined */ }
    this.vaultRootPath = vaultRoot ?? null

    // ── V1.1-GLOBAL §7/§12 — SIDECAR/AUDIT STORAGE ROOT ──────────────────
    // A REAL vault already owns a `.typora` config dir, so sidecars/audits stay
    // there. A plain document folder must NOT be turned into a vault by our own
    // writes: the community framework reads `enabledPlugins` from `<folder>/.typora`
    // whenever it exists, so creating it silently disables this user-level plugin
    // on the next start. Non-vault storage goes to a per-folder USER-LEVEL dir.
    const storageRoot = resolveInkChapterStorageRoot({
      vaultPath: vaultRoot ?? null,
      userHome: (() => { try { return os.homedir() } catch { return null } })(),
      localDotTyporaPresent: vaultRoot ? fs.existsSync(path.join(vaultRoot, '.typora')) : false,
    })
    console.info(
      `[InkChapter] SIDECAR-CONTEXT-UPDATE: vaultRoot=${vaultRoot ?? 'null'} ` +
      `storageRoot=${storageRoot ?? 'null'} source=storage-root-authority`,
    )

    // ── File-backed forensic audit sink (pure observability, fail-open) ──
    // PERFORMANCE: opt-in only. Console mirroring stays always-on; persisting
    // JSONL would otherwise write to disk from the editing hot path.
    // `sessionId` stays function-scoped: the runtime identity audit below
    // reports it regardless of whether the file sink is enabled.
    const sessionId = `sess-${Date.now()}`
    if (isRuntimeAuditSinkRequested()) {
      initializeForensicSink({ vaultRoot: storageRoot, buildId: INKCHAPTER_BUILD_ID, sessionId })
    } else {
      console.info('[InkChapter] RUNTIME-AUDIT-SINK: disabled (console-only)')
    }

    // ── 界面配置：Ribbon 可见性（在 sink 就绪后应用；幂等、无长期观察器） ──
    try {
      this.register(this.settings.onChange('*', () => {
      this.applyRibbonVisibility()
      this.applyAcademicProfile()
    }))
    } catch { /* fail-open */ }
    this.applyRibbonVisibility()
    this.emitResponsiveHeartbeats()

    // ── GLOBAL LOAD AUDIT (Block-Gap Transaction Closure V1.1-GLOBAL §12/§14) ──
    // Observability ONLY (fail-open): InkChapter is a Typora USER-LEVEL plugin,
    // so it must load for ANY document path — with or without a local `.typora`.
    let documentContext: InkChapterDocumentContext | undefined
    try {
      const docPath = this.app.workspace.activeFile ?? null
      const docDir = docPath ? path.dirname(docPath) : null
      const localDot = docDir ? fs.existsSync(path.join(docDir, '.typora')) : false
      const localPlugin = localDot && docDir
        ? fs.existsSync(path.join(docDir, '.typora', 'plugins', INKCHAPTER_PLUGIN_ID))
        : false
      const authority = resolveInkChapterPathAuthority({
        userHome: os.homedir(),
        reportedInstallRoot: null,
        documentPath: docPath,
        workspaceRoot: vaultRoot ?? null,
        vaultRoot: vaultRoot ?? null,
        localDotTyporaPresent: localDot,
        localInkChapterPluginPresent: localPlugin,
      })
      // §6 — the SPLIT document context is threaded into the service context so
      // business code never has to infer document/plugin roots from one vaultRoot.
      documentContext = toInkChapterDocumentContext(authority)
      emitRuntimeAudit('INKCHAPTER-GLOBAL-LOAD-AUDIT', {
        ...buildInkChapterGlobalLoadAudit(authority, true, 1),
      })
    } catch { /* observability must never block initialization */ }

    /**
     * R10 Closure §2.2 — ONE structural-read implementation shared by the
     * ServiceContext and the Document-Utilities authority. Every degraded path
     * reports WHY and always returns `structural:false` with the fallback string;
     * the transaction builder records that fact on the diagnostics input.
     */
    const readStructuralMarkdown = (): {
      markdown: string | null
      structural: boolean
      reason?: 'ROOT_DISCONNECTED' | 'API_THREW' | 'EMPTY_RESULT' | 'API_UNAVAILABLE'
    } => {
      const incremental = (): string | null => {
        try { return editor.getMarkdown() } catch { return null }
      }
      let area: HTMLElement | null = null
      try {
        const writingArea = editor.writingArea as HTMLElement | null | undefined
        area = writingArea ?? null
      } catch { area = null }
      if (area == null || area.isConnected === false) {
        return { markdown: incremental(), structural: false, reason: 'ROOT_DISCONNECTED' }
      }
      // 公式渲染安全阀：`UserOp.getMarkdownSourceFrom` 会遍历并重建块内 DOM，
      // 实测即使块公式已渲染完成，该序列化仍会清空 `.md-math-block`（公式永久
      // 空白，renderUnder 也无法恢复）。因此含块公式的文档一律降级为增量镜像，
      // 公式渲染优先于结构诊断。
      if (area.querySelector('.md-math-block')) {
        return { markdown: incremental(), structural: false, reason: 'API_UNAVAILABLE' }
      }
      const userOp = (editor as unknown as { UserOp?: { getMarkdownSourceFrom?: (el: unknown) => unknown } }).UserOp
      if (userOp == null || typeof userOp.getMarkdownSourceFrom !== 'function') {
        return { markdown: incremental(), structural: false, reason: 'API_UNAVAILABLE' }
      }
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0
      try {
        const structural = userOp.getMarkdownSourceFrom($(area))
        const elapsedMs = t0 > 0 ? Math.round((performance.now() - t0) * 100) / 100 : -1
        // Perf evidence is OPT-IN (`INKCHAPTER_STRUCTURAL_AUDIT=1`): the
        // product hot path performs no audit formatting by default.
        if (isStructuralAuditEnabled()) {
          emitRuntimeAudit('R10-STRUCTURAL-SERIALIZE-AUDIT', {
            path: this.app.workspace.activeFile ?? null,
            writingAreaChildCount: area.childElementCount,
            serializeMs: elapsedMs,
            markdownLength: typeof structural === 'string' ? structural.length : null,
            decision: typeof structural === 'string' && structural !== '' ? 'STRUCTURAL' : 'EMPTY_RESULT',
          })
        }
        if (typeof structural === 'string' && structural !== '') {
          return { markdown: structural, structural: true }
        }
        return { markdown: incremental(), structural: false, reason: 'EMPTY_RESULT' }
      } catch {
        return { markdown: incremental(), structural: false, reason: 'API_THREW' }
      }
    }

    const ctx: ServiceContext = {
      settings: this.settings,
      vaultRoot,
      storageRoot,
      documentContext,
      onWorkspaceEvent: (event, listener) => {
        const dispose = this.app.workspace.on(event as never, listener as never)
        this.register(dispose)
        return dispose
      },
      onEditorEvent: (event, listener) => {
        const dispose = this.app.features.markdownEditor.on(event as never, listener as never)
        this.register(dispose)
        return dispose
      },
      registerDisposable: (fn) => this.register(fn),
      getActiveFilePath: () => this.app.workspace.activeFile ?? null,
      // R10 Closure §2.1 — `getMarkdown()` is the GENERAL read path consumed by
      // ~18 places (not only blank-gap). It stays the incremental mirror exactly
      // as before: forcing serialization here would tax every consumer.
      getMarkdown: () => editor.getMarkdown(),
      // R10 Closure §2.2 — the STRUCTURAL snapshot authority for one diagnostics
      // transaction. buildDocumentDiagnosticsInput calls this exactly once per
      // reconcile; the returned string then flows through source scanning,
      // visible-row binding, diagnostic publish and the read-only audit.
      // `structural=false` means the structural read failed or came back empty
      // and the caller got the incremental mirror — a DEGRADED fact that must
      // never be reported as structure-verified.
      getStructuralMarkdown: readStructuralMarkdown,
      reloadContent: (markdown: string) => {
        File.reloadContent(markdown, false, true, false, true)
      },
      reloadContentPreservingUndo: (markdown: string) => {
        File.reloadContent(markdown, false, false, false, true)
      },
      writeDiagnosticFile: (filename: string, data: string) => {
        try {
          // V1.1-GLOBAL §7 — diagnostics are plugin-owned sidecars: they go to the
          // resolved storage root (user-level for a non-vault folder) and never
          // create a `.typora` inside a plain document folder.
          if (!storageRoot) return
          const dp = path.join(storageRoot, '.typora', filename)
          fs.mkdirSync(path.dirname(dp), { recursive: true })
          fs.writeFileSync(dp, data, 'utf8')
        } catch { /* fail-open */ }
      },
      getCursorOffset: () => {
        try { return this.app.features.markdownEditor.selection.getCursor() } catch { return null }
      },
      setCursorOffset: (offset: number) => {
        try { this.app.features.markdownEditor.selection.setCursor(offset) } catch { /* fail-open */ }
      },
      // Phase 7R.3.11.8B.7.1 — the SERVICE reads the latest PUBLISHED
      // diagnostic snapshot for the CONTROL-SURFACE-INVARIANT (closes the
      // stale-snapshot false PASS).
      getDiagnosticSnapshot: () => this.documentUtilities?.getSnapshot() ?? null,
      // P0-3 — 结构边界 Delete 被阻止时的即时提示（复用墨章 toast 组件）。
      showTransientHint: (message: string) => this.documentUtilities?.showTransientHint(message),
    }

    // Init heading numbering (safe: service is optional)
    try {
      const adapter = new HeadingDomAdapter()
      this.numberingService = new HeadingNumberingService(ctx, adapter)
      console.log('[InkChapter] service created')
    } catch (e) {
      console.error('[InkChapter] 标题编号服务初始化失败，编号功能不可用', e)
      Notice.error('墨章：标题编号服务初始化失败，编号功能暂不可用')
    }

    // Init caption system (table/figure/code caption naming + numbering)
    try {
      const captionCtx: CaptionServiceContext = {
        vaultRoot,
        getActiveFilePath: () => this.app.workspace.activeFile ?? null,
        getDocumentKey: () => {
          const fp = this.app.workspace.activeFile
          const vr = vaultRoot ?? ''
          if (!fp || !vr) return null
          try { return generateDocumentKey(fp, vr) } catch { return null }
        },
        getEditorRoot: () => document.getElementById('write') as HTMLElement | null,
        getHeadingNumberingSnapshot: () => this.numberingService?.getCurrentHeadingNumberingSnapshot() ?? null,
        resolvePrecedingSemanticHeading: (target) => this.numberingService?.resolvePrecedingSemanticHeading(target) ?? null,
        resolvePrecedingSemanticHeadingBatch: (targets) => this.numberingService?.resolvePrecedingSemanticHeadingBatch(targets) ?? targets.map(() => ({ bound: false as const, reason: 'NO_SERVICE' })),
        getHeadingBindingGeneration: () => this.numberingService?.getHeadingBindingGeneration() ?? 0,
        getCanonicalHeadingFrame: () => this.numberingService?.getCanonicalHeadingFrame() ?? null,
        getCanonicalHeadingFrameFingerprint: () => this.numberingService?.getCanonicalHeadingFrameFingerprint() ?? '',
        subscribeCanonicalHeadingFrame: (listener, opts) => {
          if (!this.numberingService?.subscribeCanonicalHeadingFrame) return () => {}
          return this.numberingService.subscribeCanonicalHeadingFrame(listener, opts)
        },
        getMarkdown: () => {
          try { return editor.getMarkdown() } catch { return '' }
        },
        reloadContent: (markdown: string) => {
          try { File.reloadContent(markdown, false, false, false, true) } catch { /* fail-open */ }
        },
        readActiveFileContent: () => {
          try {
            const fp = this.app.workspace.activeFile
            if (!fp) return null
            return fs.readFileSync(fp, 'utf8')
          } catch { return null }
        },
        onEditorEvent: (event, listener) => {
          const dispose = this.app.features.markdownEditor.on(event as never, listener as never)
          this.register(dispose)
          return dispose
        },
        onWorkspaceEvent: (event, listener) => {
          const dispose = this.app.workspace.on(event as never, listener as never)
          this.register(dispose)
          return dispose
        },
        registerDisposable: (fn) => this.register(fn),
      }
      this.captionService = new CaptionService(captionCtx)
      this.captionService.start()
      // Phase 6B: event-driven coordinator wires heading snapshot lifecycle to
      // Caption full-logical recompute (no polling, no click/focus dependency).
      this.numberingCoordinator = new DocumentNumberingCoordinator({
        getDocumentKey: () => this.numberingService?.getCurrentHeadingNumberingSnapshot()?.documentKey ?? null,
        getSnapshot: () => this.numberingService?.getCurrentHeadingNumberingSnapshot() ?? null,
        refresh: (reasons) => this.captionService?.refresh(reasons.join(',')) ?? undefined,
        onSnapshotCommit: (cb) => this.numberingService?.subscribeHeadingNumberingSnapshot((_s, reason) => { if (reason === 'COMMITTED') cb() }) ?? (() => {}),
        onSnapshotInvalidate: (cb) => this.numberingService?.subscribeHeadingNumberingSnapshot((_s, reason) => { if (reason.startsWith('INVALIDATED')) cb() }) ?? (() => {}),
      })
      this.register(() => this.numberingCoordinator?.dispose())
      this.captionContextMenu = new CaptionContextMenu(this.captionService)
      this.captionContextMenu.attach(() => document.getElementById('write') as HTMLElement | null)
      // Apply persisted caption settings to the runtime service (enabled/position/prefix).
      try {
        const captionCfg = this.settings.get('caption' as keyof InkChapterSettings) as any
        if (captionCfg?.types) {
          this.captionService.applySettings(captionCfg as any)
        }
        const captionFormulaCfg = this.settings.get('captionFormula' as keyof InkChapterSettings) as any
        if (captionFormulaCfg) {
          this.captionService.applyFormulaSettings(captionFormulaCfg as any)
        }
      } catch { /* fail-open */ }
      console.log('[InkChapter] caption service started')
    } catch (e) {
      console.error('[InkChapter] 题注服务初始化失败，题注功能不可用', e)
    }

    // ── 内容块悬停工具栏：唯一剪贴板边界（Typora / Electron） ──────────
    // 代码文本走 CodeMirror 队列（只读），图片走 Electron nativeImage（与
    // Typora 原生 copyImage 同一通道），均带回读校验。
    const contentBlockClipboard = createContentBlockClipboard({
      getEditor: () => editor,
      getElectron: () => {
        const globalScope = globalThis as { reqnode?: unknown }
        if (typeof globalScope.reqnode !== 'function') return null
        try {
          return (globalScope.reqnode as (id: string) => unknown)('electron') as ElectronLike
        } catch {
          return null
        }
      },
      getActiveFilePath: () => this.app.workspace.activeFile ?? null,
    })

    // ── Phase 7R.3.11: Document Utilities (diagnostics + lock + scroll) ──
    // Presentation/utility layer only. Mounts editor-shell overlays OUTSIDE
    // #write so their mutations never enter numbering pipelines.
    try {
      this.documentUtilities = createDocumentUtilities({
        contentBlockToolbar: {
          actions: {
            readCodeSource: (fence) => contentBlockClipboard.readCodeSource(fence),
            copyText: (text) => contentBlockClipboard.copyText(text),
            copyImage: (img) => contentBlockClipboard.copyImage(img),
          },
          emitAudit: (event, payload) => emitRuntimeAudit(event, payload),
          getPreviewLines: () => this.readUiSettings().codeBlockPreviewLines,
          getAutoExpandOnEdit: () => this.readUiSettings().codeBlockAutoExpandOnEdit,
          getDocumentDir: () => {
            const filePath = this.app.workspace.activeFile
            return filePath ? path.dirname(filePath) : null
          },
          imageAssetActions: {
            getFigureNameState: (img) => {
              const target = this.captionService?.resolveCaptionNamingTarget(img)
              return target ? { named: !!target.currentName } : null
            },
            requestFigureName: (img, mode) =>
              this.captionContextMenu?.requestNamingForElement(img, mode) ?? false,
            downloadTargets: () => this.imageDownloadTargets(),
            download: (input) => this.downloadImageFromToolbar(input),
          },
        },
        // V5.1 — 文档管理中心图片区：状态方块点击后展示当前文档策略与批量入口。
        documentHub: {
          getImageSummary: () => {
            try { return this.buildDocumentHubImageSummary() } catch { return null }
          },
          uploadAll: () => { void this.getDocumentImageBatchService().run('upload') },
          downloadAll: () => { void this.getDocumentImageBatchService().run('download') },
          checkDualLink: () => { void this.getDocumentImageBatchService().run('dual-link') },
          openImageSettings: () => this.openImageSettingsEntry(),
          getHint: () => this.documentHubHint(),
        },
        // F0 — the ONLY production diagnostic-fix write bridge.
        // `File.reloadContent(markdown, {})` runs Typora's `reload` undo command
        // (undo.register) — ONE Undo restores the previous document — and we
        // read the buffer back so the UI never claims an unverified write.
        diagnosticFix: {
          applyMarkdown: (next: string, expectedBefore: string) => {
            try {
              // The SAME authority the planner used (the exact document text). The
              // structural serializer must never be the write base: it rebuilds a
              // rendered fenced code block from DOM text, so its fence body carries
              // the line-number gutter and the language/line-count chrome
              // (`" 1<code>TXT纯文本1 行"` — see runtime/gui-acceptance/snap-J.json).
              const readSource = (): string | null => {
                try { return editor.getMarkdown() } catch { return null }
              }
              const before = readSource()
              // The plan was built from `expectedBefore`; a different live
              // buffer means the diagnostic plan is stale — never write blind.
              if (before !== expectedBefore) {
                return { ok: false, reason: 'STALE_SOURCE' }
              }
              if (typeof next !== 'string' || next === before) {
                return { ok: false, reason: 'NO_CHANGE' }
              }
              // The Typora typings describe positional booleans, but the real
              // implementation destructures an OPTIONS object. Pass the object
              // explicitly so undo registration is the documented default path.
              ;(File.reloadContent as unknown as (
                markdown: string,
                options?: Record<string, unknown>,
              ) => void)(next, {})
              // 代码块在 reload 后会先渲染成 `mock-cm`（只有纯文本、没有行内编号），
              // CodeMirror 稍后才挂载——中间那一帧会被绘制，肉眼就是“行内编号刷新一下”。
              // 在插入的同一个任务里同步挂载，使第一帧即为最终形态。
              mountPendingFencesSynchronously(editor as unknown as TyporaFenceApi)
              // READBACK — the STRUCTURAL serializer is block-level and cannot
              // represent the document's terminal newline (a real 1.6.7 document
              // ending in `\n` serializes without it), so it can never verify an
              // EOF blank-line repair. The incremental mirror IS the document text
              // Typora reloaded, so it is the exact readback authority here.
              let after: string | null = null
              try { after = editor.getMarkdown() } catch { after = null }
              if (after !== next) {
                console.error('[InkChapter] diagnostic fix readback mismatch', {
                  expectedLength: next.length,
                  actualLength: after?.length ?? null,
                  beforeLength: before?.length ?? null,
                })
                return { ok: false, reason: 'READBACK_MISMATCH' }
              }
              return { ok: true }
            } catch (error) {
              console.error('[InkChapter] diagnostic fix write failed', error)
              return { ok: false, reason: error instanceof Error ? error.message : 'WRITE_THREW' }
            }
          },
          readMarkdownExact: () => {
            try { return editor.getMarkdown() } catch { return null }
          },
          setCaptionName: (request) => {
            try {
              const service = this.captionService
              if (!service) return { ok: false, reason: 'CAPTION_SERVICE_UNAVAILABLE' }
              const element = request.element && request.element.isConnected
                ? request.element
                : this.resolveCaptionElementByCanonicalOrdinal(request.kind, request.targetIdentity)
              if (!element) return { ok: false, reason: 'TARGET_ELEMENT_MISSING' }
              const naming = service.resolveCaptionNamingTarget(element)
              if (!naming) return { ok: false, reason: 'TARGET_NOT_A_CAPTION' }
              // Kind mismatch means the diagnostic identity moved: refuse rather
              // than naming an unrelated object.
              if (naming.type !== request.kind) return { ok: false, reason: 'TARGET_KIND_MISMATCH' }
              const record = service.setCaption(naming.type, naming.target, request.name)
              if (!record) return { ok: false, reason: 'NAME_NOT_SAVED' }
              this.documentUtilities?.requestDiagnosticsRefresh?.('CAPTION_NAME_APPLIED')
              return { ok: true }
            } catch (error) {
              console.error('[InkChapter] caption name fix failed', error)
              return { ok: false, reason: error instanceof Error ? error.message : 'CAPTION_WRITE_THREW' }
            }
          },
        },
        getActiveFilePath: () => this.app.workspace.activeFile ?? null,
        getDocumentKey: () => {
          const fp = this.app.workspace.activeFile
          const vr = vaultRoot ?? ''
          if (!fp || !vr) return null
          try { return generateDocumentKey(fp, vr) } catch { return null }
        },
        // V3 — ACTIVE workspace leaf facts (highest authority) + real
        // lifecycle triggers: workspace `active-leaf:change` and workspace-tabs
        // `tab:toggle`. After a TRUE close of the last tab, the leaf state turns
        // empty and HARD-VETOES the still-stale activeFile/documentKey above.
        getActiveLeafState: () => readWorkspaceActiveLeafState(this.app.workspace as unknown as ActiveLeafWorkspaceShape),
        onActiveLeafChanged: (cb) => {
          const dispose = this.app.workspace.on('active-leaf:change' as never, (() => cb()) as never)
          this.register(dispose)
          return dispose
        },
        onTabToggle: (cb) => {
          const dispose = subscribeActiveTabsTabToggle(
            this.app.workspace as unknown as ActiveLeafWorkspaceLifecycleShape,
            () => cb(),
          )
          this.register(dispose)
          return dispose
        },
        getMarkdown: () => {
          try { return editor.getMarkdown() } catch { return null }
        },
        // R10 Closure §2.2 — the diagnostics transaction's ONE structural
        // snapshot source. Without this forwarding the authority fell back to
        // the incremental mirror while still reporting “verified”.
        getStructuralMarkdown: readStructuralMarkdown,
        isStrictMode: () => {
          // Phase 7R.3.11.8B.7.1 — the diagnostics mode input MUST be the
          // EFFECTIVE mode (document override ?? global), never global-only.
          try {
            return this.numberingService?.getEffectiveHeadingMode() === 'strict'
          } catch { return false }
        },
        getDiagnosticProfile: () => this.readDiagnosticProfile(),
        getImageEvidenceForDestination: (destination) => this.getImageEvidenceForDestination(destination),
        // Phase 7R.3.11.8B.10 — Heading Policy Activation Authority. Stored
        // mode ('strict' legacy seed) NEVER implies activation. The resolver
        // separates featureEnabled / explicit-global / explicit-document and
        // reports effectiveMode=null while the policy is inactive.
        getHeadingPolicyState: () => {
          try {
            const svc = this.numberingService
            if (!svc) {
              return {
                enabled: false, configured: false, effectiveMode: null, strictPolicyActive: false,
                storedMode: null, storedStrictRequire: false, globalScopeEnabled: false,
                documentScopeEnabled: false, documentOverride: null, activationSource: 'none' as const,
                effectivePolicyActive: false, effectiveStrictRequire: false,
              }
            }
            const store = svc.getScopeStore()
            const fp = this.app.workspace.activeFile
            const vr = vaultRoot ?? ''
            let docKey: string | null = null
            if (fp && vr) { try { docKey = generateDocumentKey(fp, vr) } catch { docKey = null } }
            const docOverrideMode = docKey != null
              ? (store.documentOverrides[docKey]?.settings?.headingStructureMode ?? null)
              : null
            const policy = resolveHeadingPolicyActivation(store.globalDefault, docOverrideMode)
            return {
              enabled: policy.featureEnabled,
              configured: policy.globalScopeEnabled || policy.documentScopeEnabled,
              effectiveMode: policy.effectiveMode,
              strictPolicyActive: policy.effectivePolicyActive && policy.effectiveMode === 'strict',
              storedMode: policy.storedMode,
              storedStrictRequire: policy.storedStrictRequire,
              globalScopeEnabled: policy.globalScopeEnabled,
              documentScopeEnabled: policy.documentScopeEnabled,
              documentOverride: policy.documentOverride,
              activationSource: policy.activationSource,
              effectivePolicyActive: policy.effectivePolicyActive,
              effectiveStrictRequire: policy.effectiveStrictRequire,
            }
          } catch {
            return {
              enabled: false, configured: false, effectiveMode: null, strictPolicyActive: false,
              storedMode: null, storedStrictRequire: false, globalScopeEnabled: false,
              documentScopeEnabled: false, documentOverride: null, activationSource: 'none' as const,
              effectivePolicyActive: false, effectiveStrictRequire: false,
            }
          }
        },
        getEffectiveHeadingModeRevision: () => {
          try { return this.numberingService?.getEffectiveHeadingModeRevision() ?? 0 } catch { return 0 }
        },
        vaultRoot: vaultRoot ?? null,
        getCanonicalHeadingFrame: () => this.numberingService?.getCanonicalHeadingFrame() ?? null,
        // Phase 7R.3.11.8B.7.5 — unified semantic-name authority: figure →
        // Markdown alt; table/code → caption registry title (name-only). The
        // rendered "type + number" prefix never counts as a name.
        getCaptionTitleForElement: (el) => this.captionService?.getSemanticNameForElement(el) ?? null,
        // VNext §24 — the object auto-numbering activation authority for the
        // manual-number rules (figure/table/code/formula). Reports `enabled`
        // only; all numbering semantics stay inside the caption service.
        getObjectNumberingEnabled: () => this.captionService?.getObjectNumberingEnabledState()
          ?? { figure: false, table: false, code: false, formula: false },
        // Heading Auto-Number Conflict V1 §2/§4 — the ONE per-heading heading
        // auto-numbering EFFECTIVENESS authority (reuses the numbering service's
        // effective settings + the numbering engine; never a second rule).
        getHeadingAutoNumberingEffectiveFacts: () => this.numberingService?.getHeadingAutoNumberingEffectiveFacts()
          ?? { enabled: false, h1NumberingEnabled: false, styleKey: '', isEffectiveForElement: () => false },
        // Heading Auto-Number Conflict V1.2 §21/§22 — the ONE post-commit report
        // sink: the diagnostics authority calls it at the END of a committed
        // recompute (never right after a setter), and main.ts owns the file IO.
        onHeadingConflictReportCapture: (capture) => {
          const root = storageRoot ?? null
          if (!root) return
          writeHeadingConflictBridgeReport(root, {
            command: this.headingConflictBridgeLastCommand?.command ?? 'REPORT_ONLY',
            arg: this.headingConflictBridgeLastCommand?.arg ?? null,
            appliedAt: new Date().toISOString(),
            result: this.headingConflictBridgeLastCommand?.result ?? 'POST_COMMIT_CAPTURE',
            runtimeSessionId: capture.runtimeSessionId,
            reportSequence: capture.reportSequence,
            settingsRevision: capture.settingsRevision,
            sourceRevision: capture.sourceRevision,
            diagnosticsRevision: capture.diagnosticsRevision,
            baselineEstablished: capture.baselineEstablished,
            capturePhase: capture.capturePhase,
            dualPass: capture.dualPass,
            gateReport: capture.gateReport,
            coverageReport: capture.coverageReport,
          })
          this.headingConflictBridgeLastCommand = null
        },
        // Heading Auto-Number Conflict V1.2 §21/§22 — the ONE dev/test bridge
        // consumption point, driven by the diagnostics recompute (the toolbar
        // 「重新检查文档」 button), never by an OS-level focus/selection event.
        consumeHeadingConflictTestBridge: () => {
          const root = storageRoot ?? null
          if (!root) return
          const cmd = readHeadingConflictBridgeFile(root, this.headingConflictBridgeLastNonce)
          if (!cmd) return
          // Stamp the nonce BEFORE applying so a nested recompute driven by the
          // setter can never re-apply the same command.
          this.headingConflictBridgeLastNonce = cmd.nonce
          const result = this.numberingService?.applyHeadingConflictBridgeCommand(cmd.command, cmd.arg) ?? 'NO_SERVICE'
          this.headingConflictBridgeLastCommand = { command: cmd.command, arg: cmd.arg, result }
          consumeHeadingConflictBridgeFile(root, cmd)
          // §21/§22 — arm the POST-COMMIT capture; flush happens at the END of
          // this same committed recompute.
          this.documentUtilities?.host.requestHeadingAutoNumberConflictReport()
        },
        // Phase 7R.3.11.8B.7.6 — rendered caption host for compound locate.
        getObjectCaptionHost: (el) => this.captionService?.getObjectCaptionHost(el) ?? null,
        // Phase G §8 — DOM-side Caption Integrity producer (same diagnostics
        // pipeline). Ownership comes ONLY from the caption service's canonical
        // owner map; no adjacency guessing.
        getCaptionIntegrityDiagnostics: (documentKey, sourceRevision) =>
          this.captionService?.computeCaptionIntegrityDiagnostics(documentKey, sourceRevision) ?? [],
        // Numbering Integrity V2 §9/§21 — the ONE canonical effective-number fact
        // provider (owned by the caption service / formula planner). The
        // diagnostics layer joins it to its OWN canonical source identity.
        getObjectEffectiveNumberElementFacts: () =>
          this.captionService?.getObjectEffectiveNumberElementFacts() ?? null,
        // V5.14-R2 §P8 — mirror heading diagnostics onto the LEFT outline
        // (painted only on a COMMITTED outline mapping).
        publishOutlineHeadingDiagnostics: (targets) => {
          this.numberingService?.setHeadingDiagnosticTargets(targets)
        },
        getCodeLanguage: (el) => codeLanguageOf(el),
        getFormulaVisibleTagTokens: (host) => extractFormulaVisibleTagTokens(host),
        onDocumentSwitch: (cb) => {
          const dispose = this.app.workspace.on('file:open' as never, (() => cb()) as never)
          this.register(dispose)
          return dispose
        },
        // Phase 7R.3.11.8B.7.7 — Markdown SOURCE change authority (editor 'edit'
        // fires on every real source edit incl. EOF blank-line toggles that may
        // produce no ordinary DOM block change).
        onSourceEdit: (cb) => {
          const dispose = this.app.features.markdownEditor.on('edit', (() => cb()) as never)
          this.register(dispose)
          return dispose
        },
        onCanonicalFrameCommit: (cb) => {
          if (!this.numberingService) return () => undefined
          // PA-16 — forward the committed frame so diagnostics can tell a real
          // heading change from a presentation-only commit (caret/focus/re-bind).
          return this.numberingService.subscribeCanonicalHeadingFrame(
            (frame) => cb(frame == null
              ? undefined
              : {
                  documentKey: frame.documentKey,
                  semanticRevision: frame.semanticRevision,
                  semanticFingerprint: frame.semanticFingerprint,
                }),
            { emitCurrent: true },
          )
        },
        onSettingsChanged: (cb) => {
          if (!this.numberingService) return () => undefined
          return this.numberingService.onSettingsChanged(() => cb())
        },
        // Empty Workspace UX V1 — injected platform for EMPTY-state dblclick
        // .md creation. Directory identity comes ONLY from the file-tree root /
        // selection (never hard-coded / cwd); creation is exclusive ('wx'); the
        // created file opens through the framework App.openFile (real API).
        emptyWorkspace: {
          contentEditableBoundaryAllowed: true,
          isEnabled: () => this.readUiSettings().emptyWorkspaceCreate,
          resolveEmptySurface: () => readActiveEmptyWorkspaceSurface(
            this.app.workspace as unknown as { activeLeaf?: { viewType?: string; view?: { containerEl?: unknown } } | null },
          ),
          platform: {
            getFileTreeRoot: () => {
              try {
                const mf = typeof File.getMountFolder === 'function' ? File.getMountFolder() : ''
                if (mf) return mf
                return vaultRoot ?? null
              } catch {
                return vaultRoot ?? null
              }
            },
            statKind: (absolutePath) => {
              try {
                const s = fs.statSync(absolutePath)
                return s.isDirectory() ? 'directory' : s.isFile() ? 'file' : null
              } catch {
                return null
              }
            },
            markdownExists: (absolutePath) => {
              try { return fs.existsSync(absolutePath) } catch { return false }
            },
            createExclusiveMarkdown: (directory, fileName) => {
              const absolutePath = path.join(directory, fileName)
              try {
                const fd = fs.openSync(absolutePath, 'wx')
                fs.closeSync(fd)
                return { ok: true, path: absolutePath, code: 'OK' }
              } catch (e) {
                const code = (e as NodeJS.ErrnoException)?.code
                return { ok: false, path: null, code: code === 'EEXIST' ? 'EXISTS' : 'ERROR' }
              }
            },
            openCreatedFile: async (absolutePath) => {
              const appOpen = (this.app as unknown as { openFile?: (fp: string) => Promise<unknown> }).openFile
              if (typeof appOpen !== 'function') {
                throw new Error('NO_NATIVE_OPEN_FILE_API')
              }
              await appOpen(absolutePath)
            },
            revealInFileTree: (absolutePath) => {
              try {
                const lib = (editor as { library?: unknown }).library as {
                  revealInFileTree?: (p: string, ...rest: unknown[]) => unknown
                  revealInFileList?: (p: string, ...rest: unknown[]) => unknown
                  revealInSidebar?: (p: string, ...rest: unknown[]) => unknown
                } | undefined
                const fn = lib?.revealInFileTree ?? lib?.revealInFileList ?? lib?.revealInSidebar
                if (typeof fn !== 'function') return false
                fn.call(lib, absolutePath)
                return true
              } catch {
                return false
              }
            },
            notice: (message) => {
              try { Notice.info(message) } catch { /* fail-open */ }
            },
          },
        },
      })
      this.documentUtilities.mount()
    this.prewarmImageEvidenceForActiveDocument()
      console.log('[InkChapter] document utilities mounted')
    } catch (e) {
      console.error('[InkChapter] 文档工具初始化失败，诊断/锁定/滚动功能不可用', e)
    }

    // ── R10 GUI caret probe (READ-ONLY, disposable-fixture only) ──────────
    // Typora 1.6.7 refuses remote debugging and exposes no accessibility tree,
    // so the GUI driver cannot otherwise prove which paragraph owns the caret
    // BEFORE sending a destructive key. Off unless explicitly requested.
    try {
      this.register(installGuiCaretAudit({
        getDocumentKey: () => {
          const fp = this.app.workspace.activeFile
          const vr = vaultRoot ?? ''
          if (!fp || !vr) return null
          try { return generateDocumentKey(fp, vr) } catch { return null }
        },
        getSourceRevision: () => this.documentUtilities?.getSnapshot()?.sourceRevision ?? null,
      }))
    } catch { /* test-only probe must never block initialization */ }

    // ── Document View context menu (墨章 · 文档查看, tab right-click V1) ──
    // Presentation only: reuses the current Typora file-tree root as the
    // relative-path base, the framework workspace tabs as the right-click
    // target, native close controls, and a safe Explorer process spawn.
    try {
      const appPlatform = (this.app as { platform?: string }).platform
      const docViewPlatform: DocViewPlatform = {
        isWindows: appPlatform === 'win32',
        getFileTreeRoot: () => {
          try {
            const mf = typeof File.getMountFolder === 'function' ? File.getMountFolder() : ''
            return mf ? mf : (vaultRoot ?? null)
          } catch {
            return vaultRoot ?? null
          }
        },
        fileExists: (p) => {
          try { return fs.existsSync(p) } catch { return false }
        },
        copyText: (text) => {
          try {
            editor.UserOp.setClipboard(null, null, text, true)
          } catch {
            try {
              const pending = navigator.clipboard?.writeText(text)
              if (pending && typeof pending.catch === 'function') pending.catch(() => {})
            } catch { /* fail-open */ }
          }
        },
        revealInExplorer: (absolutePath) => new Promise<boolean>((resolve) => {
          try {
            const cp = require('child_process') as typeof import('child_process')
            const child = cp.spawn('explorer.exe', [`/select,"${absolutePath}"`])
            let settled = false
            const finish = (ok: boolean): void => { if (!settled) { settled = true; resolve(ok) } }
            child.on('error', () => finish(false))
            child.on('exit', () => finish(true))
            setTimeout(() => finish(true), 2000)
          } catch {
            resolve(false)
          }
        }),
        showFileTree: () => {
          try {
            const library = (editor as { library?: unknown }).library as {
              show?: (tab?: string) => void
              showSidebar?: () => void
              isSidebarShown?: () => boolean
              switch?: (view?: string, param?: unknown) => void
            } | undefined
            try { library?.show?.('file-tree') } catch { /* best-effort */ }
            const sidebar = document.getElementById('typora-sidebar')
            if (sidebar && !sidebar.classList.contains('open')) {
              try { library?.showSidebar?.() } catch { /* best-effort */ }
            }
            try { library?.switch?.('', true) } catch { /* best-effort */ }
            document.getElementById('info-panel-tab-file')?.click()
            if (sidebar?.classList.contains('use-file-list-style')) {
              document.getElementById('switch-file-list-btn')?.click()
            }
          } catch { /* best-effort */ }
        },
        nativeRevealInFileTree: (absolutePath) => {
          try {
            const lib = (editor as { library?: unknown }).library as {
              revealInFileTree?: (p: string, ...rest: unknown[]) => unknown
              revealInFileList?: (p: string, ...rest: unknown[]) => unknown
              revealInSidebar?: (p: string, ...rest: unknown[]) => unknown
            } | undefined
            const fn = lib?.revealInFileTree ?? lib?.revealInFileList ?? lib?.revealInSidebar
            if (typeof fn !== 'function') return false
            fn.call(lib, absolutePath)
            return true
          } catch {
            return false
          }
        },
        notice: (message) => {
          try { Notice.info(message) } catch { /* fail-open */ }
        },
        onInvariant: (event, payload) => {
          emitRuntimeAudit(event, payload)
        },
      }
      this.docViewMenu = new DocumentViewContextMenu(docViewPlatform, document, () => {
        const ui = this.readUiSettings()
        return { menu: ui.docViewMenu, flash: ui.fileTreeLocateFlash }
      })
      this.docViewMenu.attach()
      this.register(() => {
        this.docViewMenu?.dispose()
        this.docViewMenu = undefined
      })
      const invariant = this.docViewMenu.getInvariant()
      console.log('[InkChapter] document view context menu ready', invariant)
    } catch (e) {
      console.error('[InkChapter] 文档查看右键菜单初始化失败', e)
    }

    // ── File tree ↔ Windows Explorer drag/drop enhancement ──
    // 外部拖入：捕获阶段改「移动」为真实复制；拖出：只观察，保留 Typora 原生 IPC 拖拽。
    try {
      this.fileCopyService = new FileCopyService()
      this.nativeDragBridge = new NativeDragBridge({
        getElectron: () => {
          const globalScope = globalThis as { reqnode?: unknown }
          if (typeof globalScope.reqnode !== 'function') return null
          try {
            return (globalScope.reqnode as (id: string) => unknown)('electron') as ElectronRendererLike
          } catch {
            return null
          }
        },
      })
      const copyService = this.fileCopyService
      const bridge = this.nativeDragBridge
      let lastDragOutNoticeAt = 0
      // 真实 Typora 1.6.7（Windows）不提供可靠的未保存标记：
      // hasMidified 恒为 false，getContent/savedContent 始终相同。这里记录编辑器
      // 最后一次 input 时间；拖出时若晚于磁盘 mtime（允许 1s 时钟粒度），
      // 说明存在未保存修改。保存会推进 mtime，从而自动恢复为干净状态。
      const lastEditAt = new Map<string, number>()
      const markEdited = (): void => {
        try {
          const activePath = File.bundle?.filePath
          if (activePath) lastEditAt.set(activePath, Date.now())
        } catch { /* 忽略 */ }
      }
      const isInsideEditor = (target: EventTarget | null): boolean => {
        const element = target as Element | null
        return !!element && typeof element.closest === 'function' && !!element.closest('#write')
      }
      const onEditorEdit = (event: Event): void => {
        if (isInsideEditor(event.target)) markEdited()
      }
      const onEditorKeyDown = (event: KeyboardEvent): void => {
        if (!isInsideEditor(event.target)) return
        if (event.ctrlKey || event.metaKey || event.altKey) {
          if (!['v', 'x', 'z', 'y'].includes(event.key.toLowerCase())) return
        } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape', 'CapsLock'].includes(event.key)) {
          return
        }
        markEdited()
      }
      document.addEventListener('input', onEditorEdit, true)
      document.addEventListener('paste', onEditorEdit, true)
      document.addEventListener('cut', onEditorEdit, true)
      document.addEventListener('drop', onEditorEdit, true)
      document.addEventListener('compositionend', onEditorEdit, true)
      document.addEventListener('keydown', onEditorKeyDown, true)
      this.register(() => {
        document.removeEventListener('input', onEditorEdit, true)
        document.removeEventListener('paste', onEditorEdit, true)
        document.removeEventListener('cut', onEditorEdit, true)
        document.removeEventListener('drop', onEditorEdit, true)
        document.removeEventListener('compositionend', onEditorEdit, true)
        document.removeEventListener('keydown', onEditorKeyDown, true)
      })

      this.fileTreeDragAdapter = new FileTreeDragAdapter({
        document,
        getVaultRoot: () => {
          try {
            return File.getMountFolder() || null
          } catch {
            return null
          }
        },
        copy: (sources, destinationDir) => {
          const vaultRoot = File.getMountFolder()
          if (!vaultRoot) {
            return Promise.resolve({
              entries: [],
              copiedCount: 0,
              skippedCount: 0,
              failedCount: sources.length,
              conflictCount: 0,
              sourcePreserved: true as const,
            })
          }
          return copyService.copyBatch(sources, destinationDir, {
            vaultRoot,
            conflictPolicy: 'rename',
          })
        },
        refreshTree: (destinationDir, copiedFiles) => {
          try {
            const tree = editor.library?.fileTree
            if (!tree) return
            // 增量更新：不调用 refreshPanelCommand()，避免整体重绘折叠用户已展开的节点。
            for (const filePath of copiedFiles) {
              tree.onChangeForWin(filePath, [], 'add')
            }
          } catch (e) {
            console.warn('[InkChapter] 文件树增量刷新失败', e)
          }
        },
        notify: (message, level) => {
          if (level === 'error') Notice.error(message)
          else if (level === 'warning') Notice.warning(message)
          else Notice.info(message)
        },
        onDragOutObserved: ({ path: draggedPath, isDirectory }) => {
          if (isDirectory) return
          try {
            // Typora 的 bundle.filePath 通常为绝对路径；旧版 File.filePath 可能为
            // vault 相对路径，先按 vault 根规范化，避免同一文件因形式不同而漏报。
            const bundle = File.bundle as { filePath?: string; hasMidified?: boolean; savedContent?: string; modifiedDate?: Date } | undefined
            const legacyPath = File.filePath
            let activePath: string | null = bundle?.filePath || legacyPath || null
            if (activePath && !path.isAbsolute(activePath)) {
              try {
                const vault = File.getMountFolder()
                if (vault) activePath = path.resolve(vault, activePath)
              } catch { /* 保持原值 */ }
            }
            let currentContent: string | null = null
            let contentError: string | null = null
            try { currentContent = File.getContent() } catch (e) { contentError = e instanceof Error ? e.message : String(e) }
            const contentType = typeof currentContent
            const contentCtor = currentContent && typeof currentContent === 'object'
              ? ((currentContent as unknown as { constructor?: { name?: string } }).constructor?.name ?? null)
              : null
            // hasMidified 在真实运行中可能滞后；用 savedContent 与当前正文比对兜底。
            const state = resolveModifiedState(bundle?.hasMidified, currentContent, bundle?.savedContent)
            let modified = state.modified
            const editedAt = lastEditAt.get(draggedPath) ?? null
            if (!modified && editedAt !== null) {
              try {
                const mtime = fs.statSync(draggedPath).mtimeMs
                if (editedAt > mtime + 1000) modified = true
              } catch { /* 忽略 */ }
            }
            // 诊断：记录文档标签页 DOM（.typ-tab）的类名与活动标签 HTML，
            // 定位 Typora 原生的未保存标记（hasMidified 在真实运行中不可靠）。
            let docTabClasses: string[] = []
            let activeTabHtml: string | null = null
            let activeCloseBefore: string | null = null
            try {
              const tabs = Array.from(document.querySelectorAll('.typ-workspace-tabs .typ-tab, .typ-workspace-tab-header .typ-tab'))
              docTabClasses = tabs.slice(0, 8).map(element => String((element as HTMLElement).className))
              const activeTab = tabs.find(element => element.classList.contains('active'))
              activeTabHtml = activeTab ? String(activeTab.outerHTML).slice(0, 600) : null
              const closeButton = activeTab?.querySelector('.typ-close')
              activeCloseBefore = closeButton ? window.getComputedStyle(closeButton, '::before').content : null
            } catch { docTabClasses = []; activeTabHtml = null; activeCloseBefore = null }
            // 诊断：Typora 在加载/保存后重置 UndoManager.commandStack；
            // 非空命令栈通常意味着存在未保存编辑。
            let undoStackLength: number | null = null
            try {
              const undoManager = (editor as unknown as { undo?: { UndoManager?: { commandStack?: unknown[] } } }).undo?.UndoManager
              undoStackLength = Array.isArray(undoManager?.commandStack) ? undoManager.commandStack.length : null
            } catch { undoStackLength = null }
            const inspection = bridge.inspect(draggedPath, activePath, modified)
            const warning = bridge.warningFor(inspection)
            const notify = (text: string | null): void => {
              if (!text) return
              const now = Date.now()
              if (now - lastDragOutNoticeAt < 4000) return
              lastDragOutNoticeAt = now
              Notice.warning(text)
            }
            emitRuntimeAudit('INKCHAPTER-FILE-DRAG-OUT-INSPECT', {
              phase: 'sync',
              draggedPath,
              activePath,
              modified,
              modifiedSource: state.source,
              hasMidified: !!bundle?.hasMidified,
              bundleType: typeof bundle,
              legacyPath: legacyPath || null,
              savedContentLength: typeof bundle?.savedContent === 'string' ? bundle.savedContent.length : null,
              currentContentLength: typeof currentContent === 'string' ? currentContent.length : null,
              contentType,
              contentCtor,
              contentError,
              docTabClasses,
              activeTabHtml,
              activeCloseBefore,
              undoStackLength,
              modifiedDate: bundle?.modifiedDate instanceof Date ? bundle.modifiedDate.toISOString() : String(bundle?.modifiedDate ?? null),
              fileMtime: (() => { try { return new Date(fs.statSync(draggedPath).mtimeMs).toISOString() } catch { return null } })(),
              editedAt: editedAt === null ? null : new Date(editedAt).toISOString(),
              windowTitle: (() => {
                try {
                  const reqnode = (globalThis as { reqnode?: (id: string) => unknown }).reqnode
                  const electron = reqnode?.('electron') as { remote?: { getCurrentWindow?: () => { getTitle?: () => string } } } | undefined
                  return electron?.remote?.getCurrentWindow?.()?.getTitle?.() ?? null
                } catch (e) { return e instanceof Error ? `ERR:${e.message}` : 'ERR' }
              })(),
              documentTitle: document.title,
              remoteTitle: (() => {
                try {
                  const reqnode = (globalThis as { reqnode?: (id: string) => unknown }).reqnode
                  const remote = reqnode?.('@electron/remote') as { getCurrentWindow?: () => { getTitle?: () => string } } | undefined
                  return remote?.getCurrentWindow?.()?.getTitle?.() ?? null
                } catch (e) { return e instanceof Error ? `ERR:${e.message}` : 'ERR' }
              })(),
              exists: inspection.exists,
              symlink: inspection.symlink,
              staleDueToUnsavedChanges: inspection.staleDueToUnsavedChanges,
              warning: warning ? 'WARN' : 'NONE',
            })
            if (warning) {
              notify(warning)
              return
            }
            // hasMidified 与 getContent 在真实运行中均不可靠；尝试从 getContent 的
            // 异步返回值或 Typora 文档桥读取当前 Markdown，与 savedContent 比对。
            const savedContent = bundle?.savedContent
            if (typeof savedContent !== 'string') return
            const evaluateContent = (raw: unknown, source: string): void => {
              const content = typeof raw === 'string'
                ? raw
                : (raw && typeof (raw as { content?: unknown }).content === 'string'
                  ? (raw as { content: string }).content
                  : null)
              const asyncState = resolveModifiedState(false, content, savedContent)
              const asyncInspection = bridge.inspect(draggedPath, activePath, asyncState.modified)
              const asyncWarning = bridge.warningFor(asyncInspection)
              emitRuntimeAudit('INKCHAPTER-FILE-DRAG-OUT-INSPECT', {
                phase: 'async',
                contentSource: source,
                draggedPath,
                activePath,
                modified: asyncState.modified,
                modifiedSource: asyncState.source,
                resultType: typeof raw,
                savedContentLength: savedContent.length,
                currentContentLength: typeof content === 'string' ? content.length : null,
                exists: asyncInspection.exists,
                symlink: asyncInspection.symlink,
                staleDueToUnsavedChanges: asyncInspection.staleDueToUnsavedChanges,
                warning: asyncWarning ? 'WARN' : 'NONE',
              })
              notify(asyncWarning)
            }
            const maybePromise = currentContent as unknown
            if (maybePromise && typeof (maybePromise as { then?: unknown }).then === 'function') {
              void (maybePromise as Promise<unknown>).then(value => evaluateContent(value, 'getContentPromise')).catch((error: unknown) => {
                emitRuntimeAudit('INKCHAPTER-FILE-DRAG-OUT-INSPECT', {
                  phase: 'async-error',
                  contentSource: 'getContentPromise',
                  draggedPath,
                  error: error instanceof Error ? error.message : String(error),
                })
              })
              return
            }
            const jsBridge = (globalThis as { JSBridge?: { invoke: (command: string) => Promise<unknown> } }).JSBridge
            if (!jsBridge) return
            void jsBridge.invoke('document.getContent').then(value => evaluateContent(value, 'jsbridge')).catch((error: unknown) => {
              emitRuntimeAudit('INKCHAPTER-FILE-DRAG-OUT-INSPECT', {
                phase: 'async-error',
                contentSource: 'jsbridge',
                draggedPath,
                error: error instanceof Error ? error.message : String(error),
              })
            })
          } catch { /* 观察失败绝不影响原生拖出 */ }
        },
        onDropDecided: (decision) => {
          emitRuntimeAudit('INKCHAPTER-FILE-DRAG-IN-DROP', {
            phase: decision.phase,
            processing: decision.processing,
            sourcesCount: decision.sourcesCount,
            targetDirectory: decision.targetDirectory,
          })
        },
      })

      const attached = this.fileTreeDragAdapter.attach()
      const capability = this.nativeDragBridge.probe()
      console.log('[InkChapter] file tree drag adapter ready', {
        attached,
        capability,
        invariant: this.fileTreeDragAdapter.getInvariant(),
      })
      this.register(() => {
        this.fileTreeDragAdapter?.dispose()
        this.fileTreeDragAdapter = undefined
      })
    } catch (e) {
      console.error('[InkChapter] 文件树拖放增强初始化失败', e)
    }

    // ── Workspace tab close × — hover/focus-only (CSS) enhancer (V1) ──
    // Visibility itself is CSS-only; this enhancer only guards single mount and
    // emits the DEFAULT state invariant (0 × visible) after tabs settle.
    try {
      this.tabCloseVisibility = new TabCloseVisibilityEnhancer()
      this.tabCloseVisibility.attach()
      this.register(() => {
        this.tabCloseVisibility?.dispose()
        this.tabCloseVisibility = undefined
      })
      setTimeout(() => {
        if (!this.tabCloseVisibility) return
        try {
          const m = measureTabCloseVisibility(document)
          const result = evaluateTabCloseVisibility({
            tabCount: m.tabCount,
            activeIndex: m.activeIndex,
            hoveredOrFocusedIndex: -1,
            visibleIndices: m.visibleIndices,
            origin: 'none',
            layout: { tabWidthDeltaPx: null, titleWidthDeltaPx: null, titleLeftDeltaPx: null },
          })
          emitRuntimeAudit('DOCUMENT-UTILITY-TAB-CLOSE-VISIBILITY-INVARIANT', {
            tabCloseEnhancerCount: this.tabCloseVisibility.getInvariant().tabCloseEnhancerCount,
            duplicateListener: this.tabCloseVisibility.getInvariant().duplicateListener,
            tabCount: m.tabCount,
            activeTabIndex: m.activeIndex,
            hoveredTabIndex: -1,
            visibleCloseCount: result.visibleCloseCount,
            otherVisibleCloseCount: result.otherVisibleCloseCount,
            closeSlotWidthsPx: m.closeSlotWidthsPx,
            defaultStateOk: result.defaultStateOk,
            decision: result.decision,
            reason: result.reason,
          })
          const c = measureTabCloseCentering(document)
          if (c.closeRect && c.computed && c.pseudo) {
            const inlineFlex = c.computed.display === 'inline-flex'
            const alignCenter = c.computed.alignItems === 'center'
            const justifyCenter = c.computed.justifyContent === 'center'
            const paddingZero = /^0px( 0px)*$/.test(c.computed.padding.trim())
            const marginZero = /^0px( 0px)*$/.test(c.computed.margin.trim())
            const pseudoNoOffset = c.pseudo.transform === 'none' && c.pseudo.top === 'auto' && c.pseudo.left === 'auto' && c.pseudo.padding === '0px' && c.pseudo.margin === '0px'
            const square = Math.abs(c.closeRect.width - c.closeRect.height) <= 1 && c.closeRect.width >= 18 && c.closeRect.width <= 22
            // R10 Project Audit §2.6 — Typora hides the tab close control by
            // default (single tab / hover-only). A hidden control has no hitbox;
            // evaluating it produced a permanent false FAIL audit.
            const closeRendered = c.computed.display !== 'none'
              && c.closeRect.width > 0
              && c.closeRect.height > 0
            const centering = evaluateTabCloseCentering({
              closeRendered,
              deltaCenterX: null,
              deltaCenterY: null,
              widthPx: c.closeRect.width,
              heightPx: c.closeRect.height,
              paddingZero,
              marginZero,
              inlineFlex,
              alignItemsCenter: alignCenter,
              justifyContentCenter: justifyCenter,
              square,
              pseudoNoOffset,
              slotWidthDefault: c.closeRect.width,
              slotWidthHover: c.closeRect.width,
              tabWidthDeltaPx: null,
              titleWidthDeltaPx: null,
              titleLeftDeltaPx: null,
            })
            emitRuntimeAudit('DOCUMENT-UTILITY-TAB-CLOSE-CENTERING-INVARIANT', {
              closeRect: { width: c.closeRect.width, height: c.closeRect.height },
              closeComputed: c.computed,
              closePseudo: c.pseudo,
              glyphAuthority: 'PSEUDO_ELEMENT ::before content:"×"',
              hitboxFlags: { inlineFlex, alignCenter, justifyCenter, paddingZero, marginZero, square, pseudoNoOffset },
              closeRendered,
              measureMode: centering.measureMode,
              deltaCenterX: null,
              deltaCenterY: null,
              decision: centering.decision,
              reason: centering.reason,
            })
          }
        } catch { /* best-effort */ }
      }, 7000)
    } catch (e) {
      console.error('[InkChapter] 标签关闭按钮增强初始化失败', e)
    }

    // ── Phase 7R.3.11.8B.9 — runtime heading-policy probes ──
    // Debug/UI-driver hooks only. They reuse the SINGLE write authority +
    // existing persist/notify pipelines (never bypass), so live diagnostics
    // refresh exactly as a real settings toggle would.
    try {
      const w = window as {
        __inkchapter_heading_policy_probe__?: unknown
        __inkchapter_heading_set_global_mode__?: unknown
        __inkchapter_heading_toggle_enabled__?: unknown
      }
      w.__inkchapter_heading_policy_probe__ = () => {
        try {
          const svc = this.numberingService
          if (!svc) return { available: false }
          const store = svc.getScopeStore()
          const enabled = store.globalDefault.enabled !== false
          const fp = this.app.workspace.activeFile
          const vr = vaultRoot ?? ''
          let docKey: string | null = null
          if (fp && vr) { try { docKey = generateDocumentKey(fp, vr) } catch { docKey = null } }
          const globalConfigured = store.globalDefault.headingStructureConfigured === true
          const overrideConfigured = docKey != null
            && store.documentOverrides[docKey]?.settings?.headingStructureMode != null
          const configured = globalConfigured || overrideConfigured
          const effectiveMode = svc.getEffectiveHeadingMode()
          return {
            available: true,
            documentKey: docKey,
            featureEnabled: enabled,
            configured,
            globalConfigured,
            overrideConfigured,
            effectiveMode,
            strictPolicyActive: enabled && configured && effectiveMode === 'strict',
          }
        } catch (e) {
          return { error: String((e as Error)?.message ?? e) }
        }
      }
      w.__inkchapter_heading_set_global_mode__ = (mode: 'strict' | 'loose') => {
        try {
          this.numberingService?.setHeadingStructureMode({
            scope: 'global', documentKey: null, mode, source: 'RUNTIME_TEST',
          })
          return 'OK'
        } catch (e) {
          return String((e as Error)?.message ?? e)
        }
      }
      w.__inkchapter_heading_toggle_enabled__ = () => {
        try {
          this.numberingService?.toggle()
          return 'OK'
        } catch (e) {
          return String((e as Error)?.message ?? e)
        }
      }
    } catch { /* probe hooks are best-effort */ }

    // Register settings tab
    if (this.numberingService) {
      try {
        this.registerSettingTab(
          new HeadingNumberingSettingTab(this.settings, this.numberingService, this.captionService),
        )
        console.log('[InkChapter] settings tab registered')
      } catch (e) {
        console.error('[InkChapter] 设置页面注册失败', e)
        Notice.error('墨章：设置页面加载失败，但插件主体仍可用')
      }
    }

    // Register 界面 / 文件夹树 settings tab (independent of the numbering service)
    try {
      this.registerSettingTab(new InkChapterUiSettingTab({
        read: () => this.readUiSettings(),
        write: (next) => {
          this.settings.set('ui' as keyof InkChapterSettings, next as never)
          this.applyRibbonVisibility()
          this.applyAcademicProfile()
        },
      }))
      console.log('[InkChapter] ui settings tab registered')
    } catch (e) {
      console.error('[InkChapter] 界面设置页注册失败', e)
    }

    // Register 图片管理 settings tab (initialization wizard; no services yet)
    try {
      this.registerSettingTab(new ImageManagementSettingTab({
        read: () => resolveImageSettings(this.settings.get('image' as keyof InkChapterSettings) as never),
        write: (next) => {
          this.settings.set('image' as keyof InkChapterSettings, next as never)
        },
        inspect: (libraryPath) => inspectImageLibraryTarget(libraryPath),
        initialize: (libraryPath, options) => initializeImageLibrary(libraryPath, {
          allowNonEmpty: options.allowNonEmpty,
        }),
        pickDirectory: (initialDirectory) => pickFolderNative({ initialDirectory }),
        confirm: (message) => window.confirm(message),
        notify: (message, kind) => {
          if (kind === 'error') Notice.error(message)
          else Notice.info(message)
        },
        getDataPath: () => this.imageDataBaseDir,
        inspectUsage: async (target) => {
          try {
            const usage = await inspectDirectoryUsage(target)
            return { fileCount: usage.fileCount, totalBytes: usage.totalBytes }
          } catch {
            return null
          }
        },
        getLibraryCenter: () => this.buildImageLibraryCenter(),
        uploadLocalImage: () => this.uploadLocalImageInteractive(),
        getCredentialStatus: async (referenceId): Promise<ImageCredentialStatus> => {
          const store = this.getOrCreateCredentialStore()
          if (!store) {
            return { configured: false, backend: 'unavailable', updatedAt: null }
          }
          return store.status(referenceId)
        },
        saveCredential: async (referenceId, token) => {
          const store = this.getOrCreateCredentialStore()
          if (!store) return { ok: false, code: 'CREDENTIAL_BACKEND_UNAVAILABLE' }
          return store.write(referenceId, token)
        },
        deleteCredential: async (referenceId) => {
          const store = this.getOrCreateCredentialStore()
          if (!store) return { ok: false, code: 'CREDENTIAL_BACKEND_UNAVAILABLE' }
          return store.delete(referenceId)
        },
        testConnection: (profile) => this.testImageRemoteConnection(profile),
        // V5.0 — 三级作用域：设置页读取 / 写入当前文档与当前文件夹的覆盖。
        getScopeContext: async () => {
          const service = this.imageDocumentScopeService
          const resolved = await this.readActiveImageScope()
          return {
            documentPath: this.app.workspace.activeFile ?? null,
            folderPath: service?.getActiveFolderPath() ?? null,
            resolved,
            documentOverride: service ? await service.getDocumentOverride() : null,
            folderOverride: service ? await service.getFolderOverride() : null,
          }
        },
        setDocumentScope: async (overrides) => {
          const service = this.imageDocumentScopeService
          if (!service) throw new Error('IMAGE_SCOPE_SERVICE_UNAVAILABLE')
          await service.setDocumentScope(overrides)
          this.refreshActiveImageScope()
        },
        setFolderScope: async (overrides) => {
          const service = this.imageDocumentScopeService
          if (!service) throw new Error('IMAGE_SCOPE_SERVICE_UNAVAILABLE')
          await service.setFolderScope(overrides)
          this.refreshActiveImageScope()
        },
        clearDocumentScope: async () => {
          const service = this.imageDocumentScopeService
          if (!service) throw new Error('IMAGE_SCOPE_SERVICE_UNAVAILABLE')
          await service.clearDocumentScope()
          this.refreshActiveImageScope()
        },
        clearFolderScope: async () => {
          const service = this.imageDocumentScopeService
          if (!service) throw new Error('IMAGE_SCOPE_SERVICE_UNAVAILABLE')
          await service.clearFolderScope()
          this.refreshActiveImageScope()
        },
      }))
      console.log('[InkChapter] image settings tab registered')
    } catch (e) {
      console.error('[InkChapter] 图片设置页注册失败', e)
    }

    // 图片资产索引：只解析路径并建立服务，首次使用时才读盘。
    try {
      const imageSettings = resolveImageSettings(this.settings.get('image' as keyof InkChapterSettings) as never)
      const paths = resolveImageDataPaths(this.imageDataBaseDir, { settings: imageSettings })
      this.imageAssetService = new ImageAssetService(paths)
      // V5.0 — 文件夹 / 文档级覆盖：与全局设置一起构成三级图片配置。
      this.imageScopeStore = new ImageScopeStore({ dataRoot: paths.dataRoot })
      this.imageDocumentScopeService = new ImageDocumentScopeService({
        getGlobalSettings: () => resolveImageSettings(this.settings.get('image' as keyof InkChapterSettings) as never),
        getActiveDocumentPath: () => this.app.workspace.activeFile ?? null,
        store: this.imageScopeStore,
      })
      this.activeImageSettings = imageSettings
      this.imageTransferTaskStore = new ImageTransferTaskStore(
        path.join(paths.dataRoot, 'transfer-tasks.json'),
      )
      const credentialStore = this.getOrCreateCredentialStore()
      this.imageUploadService = new ImageUploadService({
        paths,
        assets: this.imageAssetService,
        tasks: this.imageTransferTaskStore,
        credentials: credentialStore ?? undefined,
        readSettings: () => this.activeImageSettings
          ?? resolveImageSettings(this.settings.get('image' as keyof InkChapterSettings) as never),
      })
      this.imageDownloadService = new ImageDownloadService({
        paths,
        assets: this.imageAssetService,
        tasks: this.imageTransferTaskStore,
      })
      this.imageContextMenuDownload = new ImageContextMenuDownload({
        download: image => { void this.downloadImageFromContextMenu(image) },
      })
      this.imageContextMenuDownload.start()

      // V5.0 — 逐文档插入策略：只有当前文档/文件夹显式开启 autoUpload /
      // autoLocalizeOnInsert 时才接管；默认 NONE，Typora 原生六种插入语义不变。
      this.imageInsertionController = new ImageInsertionController({
        getSettings: () => this.activeImageSettings
          ?? resolveImageSettings(this.settings.get('image' as keyof InkChapterSettings) as never),
        getMarkdown: () => {
          try { return editor.getMarkdown() } catch { return null }
        },
        getDocumentPath: () => this.app.workspace.activeFile ?? null,
        upload: async (filePath) => {
          const service = this.imageUploadService
          if (!service) return { ok: false, message: 'UPLOAD_SERVICE_UNAVAILABLE' }
          const result = await service.uploadLocalFile({ filePath })
          return result.ok ? { ok: true, url: result.url } : { ok: false, message: result.message }
        },
        localize: async (url) => {
          const service = this.imageDownloadService
          const documentPath = this.app.workspace.activeFile ?? null
          if (!service || !documentPath) return { ok: false, message: 'NO_ACTIVE_DOCUMENT' }
          const settings = await this.resolveActiveImageSettings()
          const projectDirectory = resolveImageProjectDirectory(documentPath, settings.documentResourceDirectory)
          const result = await service.download({ url, documentPath, projectDirectory, placement: 'project' })
          if (!result.ok || !result.filePath) return { ok: false, message: result.message }
          return { ok: true, destination: relativeMarkdownImagePath(documentPath, result.filePath) }
        },
        rewrite: (rawDestination, newDestination) => this.rewriteInsertedReference(rawDestination, newDestination),
        notify: (message, kind) => {
          if (kind === 'error') Notice.error(message)
          else Notice.info(message)
        },
      })
      this.register(() => this.imageInsertionController?.dispose())
      this.register(this.app.features.markdownEditor.on('edit', () => {
        this.refreshActiveImageScope()
        this.imageInsertionController?.notifyEdit()
        this.prewarmImageEvidenceForActiveDocument()
      }) as never)
      this.register(this.app.workspace.on('active-leaf:change', () => {
        this.refreshActiveImageScope()
        this.prewarmImageEvidenceForActiveDocument()
      }) as never)
      console.log('[InkChapter] image asset service ready')

      // 旧版 PicGo 私有配置里的明文 Token → 系统安全存储，并立即从 JSON 移除。
      // 即使还没有远程配置也要执行，确保任何明文 Token 都不留在磁盘。
      const migrationProfile = imageSettings.remoteProfiles.find(profile => profile.enabled)
        ?? imageSettings.remoteProfiles[0]
      if (credentialStore) {
        void migrateLegacyPicGoToken({
          configPath: this.imageUploadService.getPicGoConfigPath(),
          store: credentialStore,
          referenceId: migrationProfile
            ? resolveCredentialReferenceId(migrationProfile)
            : 'image.github.default',
        }).then(result => {
          if (result === 'migrated') {
            Notice.info('墨章：已将旧版 PicGo 明文 Token 迁移到本机安全存储')
          } else if (result === 'removed-without-store') {
            Notice.error('墨章：安全存储不可用，已从 PicGo 配置移除明文 Token；请重新保存 Token')
          }
        }).catch(() => undefined)
      }

      // 「上传图片 + 上传服务 none」在启动时提示一次；不修改 Typora 首选项。
      if (imageSettings.enabled) {
        void this.imageUploadService.inspectInsertModeConflict().then(conflict => {
          if (conflict.hasConflict) Notice.info(`墨章：${conflict.message}`)
        }).catch(() => undefined)
      }
    } catch (e) {
      console.error('[InkChapter] 图片资产索引初始化失败，图片增强功能不可用', e)
    }

    // 已启用但未初始化：提示用户完成向导（不阻塞启动）
    try {
      const image = resolveImageSettings(this.settings.get('image' as keyof InkChapterSettings) as never)
      if (image.enabled && !image.initialized) {
        Notice.info('墨章：图片管理尚未初始化，请在「设置 → 墨章 · 图片」中完成初始化')
      }
    } catch { /* fail-open */ }

    // ── Commands (always registered, even if service failed) ──

    // Status check command
    this.registerCommand({
      id: 'inkchapter.check-status',
      title: '检查插件状态',
      scope: 'global',
      callback: () => Notice.info('墨章 InkChapter 已正常加载'),
    })

    // 手动上传入口：只上传用户显式选择的单张图片，不改写 Markdown。
    this.registerCommand({
      id: 'inkchapter.image.upload-local',
      title: '墨章：上传本地图片…',
      scope: 'global',
      callback: () => { void this.uploadLocalImageInteractive() },
    })

    // 批量下载当前文档的远程图片；只落盘登记，不改写 Markdown。
    this.registerCommand({
      id: 'inkchapter.image.download-document-remote',
      title: '墨章：下载本文档全部远程图片',
      scope: 'global',
      callback: () => { void this.downloadDocumentRemoteImagesInteractive() },
    })

    // Typora 原生「上传图片」接管 / 恢复（修改前自动备份 profile.data）。
    this.registerCommand({
      id: 'inkchapter.image.use-typora-uploader',
      title: '墨章：让 Typora 上传图片使用墨章适配器',
      scope: 'global',
      callback: () => { void this.switchTyporaNativeUploader() },
    })
    this.registerCommand({
      id: 'inkchapter.image.restore-typora-uploader',
      title: '墨章：恢复 Typora 原生上传器',
      scope: 'global',
      callback: () => { void this.restoreTyporaNativeUploader() },
    })

    // 图库中心入口：只读汇总四视图，不修改任何文件。
    this.registerCommand({
      id: 'inkchapter.image.library-center',
      title: '墨章：图片图库中心',
      scope: 'global',
      callback: () => {
        void this.buildImageLibraryCenter().then(views => {
          if (views.length === 0) {
            Notice.info('墨章：图片管理尚未启用或未初始化，请先在「设置 → 墨章 · 图片」完成初始化。')
            return
          }
          const summary = views
            .map(view => `${view.title}：${view.rows.length} 项`)
            .join('；')
          const diagnostics = views.find(view => view.id === 'tasks-diagnostics')
          const conflict = diagnostics?.rows.find(row => row.status === 'failed' && row.primary.includes('上传图片'))
          Notice.info(`墨章图库中心 — ${summary}${conflict ? `。${conflict.primary}` : ''}`)
        }).catch(() => { Notice.error('墨章：图库中心读取失败，编辑与文件不受影响。') })
      },
    })

    // File tree drag/drop capability report (runtime verification helper)
    this.registerCommand({
      id: 'inkchapter.file-transfer.capability',
      title: '墨章：文件拖放能力检测',
      scope: 'global',
      callback: () => {
        const capability = this.nativeDragBridge?.probe()
        const invariant = this.fileTreeDragAdapter?.getInvariant()
        const dragOut = capability?.nativeDragOut ?? 'UNAVAILABLE'
        const ipc = capability?.ipcRendererAvailable ? '可用' : '不可用'
        const stats = invariant
          ? `拖入 ${invariant.externalDropCount} 次 / 复制 ${invariant.copiedCount} 个 / 失败 ${invariant.failedCount} 个`
          : '适配器未就绪'
        Notice.info(
          `文件树拖放：原生拖出=${dragOut}，Electron IPC=${ipc}；${stats}。目标端默认复制，Shift 拖放由系统判定为移动。`,
        )
      },
    })

    // Toggle heading numbering
    this.registerCommand({
      id: 'inkchapter.heading.toggle',
      title: '启用/关闭标题编号',
      scope: 'global',
      callback: () => this.numberingService?.toggle(),
    })

    // Renumber headings
    this.registerCommand({
      id: 'inkchapter.heading.renumber',
      title: '重新编号标题',
      scope: 'global',
      callback: () => this.numberingService?.renumber(),
    })

    // Toggle heading structure mode (strict / loose)
    this.registerCommand({
      id: 'inkchapter.heading.toggle-structure-mode',
      title: '墨章：切换标题结构模式',
      scope: 'global',
      callback: () => {
        this.numberingService?.toggleLevelOneNumber()
        const scopes = this.numberingService?.getScopeStore()
        const mode = scopes?.globalDefault?.headingStructureMode
          ?? (scopes?.globalDefault?.showLevelOneNumber ? 'loose' : 'strict')
        Notice.info(`标题结构：${mode === 'strict' ? '严格模式' : '宽松模式'}`)
      },
    })

    // @deprecated — use inkchapter.heading.toggle-structure-mode instead
    this.registerCommand({
      id: 'inkchapter.heading.toggle-level-one',
      title: '墨章：切换标题结构模式（旧版兼容）',
      scope: 'global',
      callback: () => {
        this.numberingService?.toggleLevelOneNumber()
        const scopes = this.numberingService?.getScopeStore()
        const mode = scopes?.globalDefault?.headingStructureMode
          ?? (scopes?.globalDefault?.showLevelOneNumber ? 'loose' : 'strict')
        Notice.info(`标题结构：${mode === 'strict' ? '严格模式' : '宽松模式'}`)
      },
    })

    // ── Heading numbering override commands ──────────

    // Unnumber current heading
    this.registerCommand({
      id: 'inkchapter.heading.unnumber-current',
      title: '墨章：取消当前标题编号',
      scope: 'editor',
      callback: () => {
        this.numberingService?.setCurrentHeadingOverride('unnumbered')
      },
    })

    // Number current heading
    this.registerCommand({
      id: 'inkchapter.heading.number-current',
      title: '墨章：启用当前标题编号',
      scope: 'editor',
      callback: () => {
        this.numberingService?.setCurrentHeadingOverride('numbered')
      },
    })

    // Inherit current heading
    this.registerCommand({
      id: 'inkchapter.heading.inherit-current',
      title: '墨章：当前标题编号恢复继承',
      scope: 'editor',
      callback: () => {
        this.numberingService?.setCurrentHeadingOverride('inherit')
      },
    })

    // ── Paragraph Indent Diagnostic Commands (R32) ──

    // Force indent current paragraph (diagnostic: bypasses shortcut producer)
    this.registerCommand({
      id: 'inkchapter.paragraph.force-indent-current',
      title: '墨章：强制首行缩进当前段落（诊断）',
      scope: 'editor',
      callback: () => {
        const ok = this.numberingService?.forceIndentCurrentParagraph('force-indent')
        Notice.info(ok ? '已强制首行缩进当前段落' : '当前段落不支持强制缩进')
      },
    })

    // Force flush current paragraph
    this.registerCommand({
      id: 'inkchapter.paragraph.force-flush-current',
      title: '墨章：强制顶格当前段落',
      scope: 'editor',
      callback: () => {
        const ok = this.numberingService?.forceIndentCurrentParagraph('force-flush')
        Notice.info(ok ? '已强制顶格当前段落' : '当前段落不支持此操作')
      },
    })

    // Restore auto indent for current paragraph
    this.registerCommand({
      id: 'inkchapter.paragraph.auto-indent-current',
      title: '墨章：恢复当前段落自动缩进',
      scope: 'editor',
      callback: () => {
        const ok = this.numberingService?.forceIndentCurrentParagraph('auto')
        Notice.info(ok ? '已恢复自动缩进' : '当前段落不支持此操作')
      },
    })

    // Batch unnumber from current
    this.registerCommand({
      id: 'inkchapter.heading.batch-unnumber-from-here',
      title: '墨章：从此标题开始停止编号',
      scope: 'editor',
      callback: () => {
        this.numberingService?.batchOverrideFromCurrent('unnumbered')
      },
    })

    // Batch number from current
    this.registerCommand({
      id: 'inkchapter.heading.batch-number-from-here',
      title: '墨章：从此标题开始启用编号',
      scope: 'editor',
      callback: () => {
        this.numberingService?.batchOverrideFromCurrent('numbered')
      },
    })

    // Unnumber subtree
    this.registerCommand({
      id: 'inkchapter.heading.unnumber-subtree',
      title: '墨章：取消当前标题及下级编号',
      scope: 'editor',
      callback: () => {
        this.numberingService?.setSubtreeOverride('unnumbered')
      },
    })

    // Restore subtree
    this.registerCommand({
      id: 'inkchapter.heading.restore-subtree',
      title: '墨章：恢复当前标题及下级继承',
      scope: 'editor',
      callback: () => {
        this.numberingService?.setSubtreeOverride('inherit')
      },
    })

    // Clear all overrides
    this.registerCommand({
      id: 'inkchapter.heading.clear-overrides',
      title: '墨章：清除当前文档所有标题编号覆盖',
      scope: 'editor',
      callback: () => {
        this.numberingService?.clearDocumentOverrides()
        Notice.info('已清除当前文档所有标题编号覆盖')
      },
    })

    // ── Outline numbering commands ─────────────────

    // Diagnostic probe
    this.registerCommand({
      id: 'inkchapter.outline.probe',
      title: '墨章：诊断大纲编号',
      scope: 'editor',
      callback: () => {
        this.numberingService?.runOutlineProbe((log: string) => {
          console.log(log)
        })
        Notice.info('大纲探针已运行，请查看左侧大纲前三项是否显示 [墨章探针N]')
      },
    })

    // Full DOM diagnostic dump
    this.registerCommand({
      id: 'inkchapter.outline.dump-dom',
      title: '墨章：导出大纲DOM诊断',
      scope: 'editor',
      callback: () => {
        this.numberingService?.dumpOutlineDOM()
        Notice.info('大纲DOM诊断已输出到控制台，请打开开发者工具查看')
      },
    })

    // Manual outline sync
    this.registerCommand({
      id: 'inkchapter.outline.sync',
      title: '墨章：立即同步大纲编号',
      scope: 'editor',
      callback: () => {
        const result = this.numberingService?.manualOutlineSync((log: string) => {
          console.log('[InkChapter:outline-sync]', log)
        })
        if (result) {
          const msg = [
            `rootFound=${result.rootFound}`,
            `bodyHeadings=${result.bodyHeadingCount}`,
            `outlineItems=${result.outlineItemCount}`,
            `matched=${result.matchedCount}`,
            `byIndex=${result.matchedByIdx}`,
            `applied=${result.attributeApplied}`,
            `unmatched=${result.unmatchedCount}`,
          ].join(', ')
          Notice.info(`大纲同步: ${msg}`)
          console.log('[InkChapter:outline-sync]', msg)
        } else {
          Notice.info('大纲同步失败：未找到大纲根节点')
        }
      },
    })

    // ── Runtime audit commands ────────────────
    this.registerCommand({
      id: 'inkchapter.audit.copy',
      title: '墨章：复制运行时诊断日志',
      scope: 'global',
      callback: () => {
        copyAuditEventsToClipboard()
        Notice.info('诊断日志已复制到剪贴板或输出到控制台')
      },
    })
    this.registerCommand({
      id: 'inkchapter.audit.clear',
      title: '墨章：清空运行时诊断日志',
      scope: 'global',
      callback: () => {
        clearRuntimeAudit()
        Notice.info('诊断日志已清空')
      },
    })
    this.registerCommand({
      id: 'inkchapter.audit.snapshot',
      title: '墨章：输出当前标题编号快照',
      scope: 'editor',
      callback: () => {
        const json = getAuditEventsJSON()
        console.log('[InkChapter Snapshot]', json)
        Notice.info(`快照已输出到控制台（${JSON.parse(json).length} 条事件）`)
      },
    })

    // ── Runtime load verification ────────────────
    try {
      const pluginRoot = (this as any).manifest?.dir ?? ''
      if (pluginRoot) {
        const mainJsPath = path.join(pluginRoot, 'main.js')
        const manifestPath = path.join(pluginRoot, 'manifest.json')
        const mainJsContent = fs.readFileSync(mainJsPath)
        const hash = crypto.createHash('sha256').update(new Uint8Array(mainJsContent)).digest('hex').toUpperCase()

        // Write to {vault}/.typora/inkchapter-runtime-load.json
        const runtimeLoadPath = path.join(pluginRoot, '..', '..', 'inkchapter-runtime-load.json')
        const runtimeLoad = {
          pluginId: this.manifest.id,
          pluginName: this.manifest.name,
          buildMarker: INKCHAPTER_BUILD_ID,
          runtimeGateRevision: RUNTIME_GATE_REVISION,
          loadedAt: new Date().toISOString(),
          pluginRoot,
          mainJsPath,
          mainJsSha256: hash,
          manifestPath,
          // Framework-reported install position: 'global' (user-level) or 'vault'
          // (a local `.typora/plugins` copy). This is the AUTHORITATIVE per-window
          // load source — the same id can be installed in both roots, and only
          // this field (plus pluginRoot) tells them apart without path guessing.
          loadSource: (this as any).manifest?.postion ?? 'unknown',
          initializationCount: 1,
          ribbonInjected: !!document.querySelector('.typ-ribbon'),
          ribbonEnableClass: document.body.classList.contains('typ-ribbon--enable'),
          sidebarStructure: {
            hasInfoPanelTabWrapper: !!document.querySelector('#typora-sidebar .info-panel-tab-wrapper'),
            hasInfoPanelTabFile: !!document.querySelector('#info-panel-tab-file'),
            hasInfoPanelTabSearch: !!document.querySelector('#info-panel-tab-search-back'),
            hasInfoPanelTabOutline: !!document.querySelector('#info-panel-tab-outline'),
            sidebarClasses: document.getElementById('typora-sidebar')?.className ?? 'N/A',
          },
        }
        fs.writeFileSync(runtimeLoadPath, JSON.stringify(runtimeLoad, null, 2), 'utf8')
        // ENTER→BLANK ECHO GUARD (plan ②) — publish the evidence directory so the
        // targeted DOM-write call-stack tracer can persist its DIRECT evidence to
        // disk (the console audits cannot be read from outside the app).
        try {
          (globalThis as unknown as { __INKCHAPTER_EVIDENCE_DIR?: string }).__INKCHAPTER_EVIDENCE_DIR
            = path.join(pluginRoot, '..', '..')
        } catch { /* forensics only */ }
        console.log('[InkChapter] runtime-load.json written:', runtimeLoadPath)
      }
    } catch (e) {
      console.error('[InkChapter] Failed to write runtime-load.json:', e)
    }

    // ── R59: Runtime Banner ─────────────────────────────────────────
    const activeDoc = this.app.workspace.activeFile ?? 'unknown'
    // R58.6.3: PLUGIN-RUNTIME-ARTIFACT — resolve from vault root, NOT __dirname
    const { existsSync } = require('fs') as typeof import('fs')
    const targetVault = vaultRoot ?? ''
    const pluginDistPath = targetVault
      ? path.join(targetVault, '.typora', 'plugins', 'dist', 'main.js')
      : ''
    // R58.7 Phase A: project path derived from vault root (not __dirname which points to deployed vault)
    const projectDistPath = targetVault
      ? path.resolve(targetVault, '..', '..', 'dist', 'main.js')
      : path.resolve(__dirname, '..', '..', '..', '..', '..', 'dist', 'main.js')
    
    let pluginArtifactPath: string
    if (pluginDistPath && existsSync(pluginDistPath)) {
      pluginArtifactPath = pluginDistPath
    } else if (existsSync(projectDistPath)) {
      pluginArtifactPath = projectDistPath
    } else {
      pluginArtifactPath = path.resolve(__dirname, 'main.js')
    }
    const pluginExists = existsSync(pluginArtifactPath)
    
    const pluginMainSha256 = (() => {
      try {
        const shaPath = existsSync(projectDistPath) ? projectDistPath : (existsSync(pluginDistPath) ? pluginDistPath : pluginArtifactPath)
        if (existsSync(shaPath)) {
          const data = require('fs').readFileSync(shaPath, 'utf-8') as string
          return crypto.createHash('sha256').update(data).digest('hex').toUpperCase()
        }
        return 'unknown'
      } catch { return 'unknown' }
    })()

    // ── R58.6.7: Project source SHA256 ──
    const projectMainPath = projectDistPath
    const projectMainExists = existsSync(projectMainPath)
    const projectMainSha256 = (() => {
      try {
        if (existsSync(projectMainPath)) {
          const data = require('fs').readFileSync(projectMainPath, 'utf-8') as string
          return crypto.createHash('sha256').update(data).digest('hex').toUpperCase()
        }
        return 'unknown'
      } catch { return 'unknown' }
    })()
    const shaMatch = pluginMainSha256 !== 'unknown' && projectMainSha256 !== 'unknown'
      ? pluginMainSha256 === projectMainSha256
      : null

    // ── R58.6.7: Style SHA256 ──
    const stylePath = targetVault
      ? path.resolve(targetVault, '..', '..', 'dist', 'style.css')
      : path.resolve(__dirname, '..', '..', '..', '..', '..', 'dist', 'style.css')
    const styleSha256 = (() => {
      try {
        if (existsSync(stylePath)) {
          const data = require('fs').readFileSync(stylePath, 'utf-8') as string
          return crypto.createHash('sha256').update(data).digest('hex').toUpperCase()
        }
        return 'unknown'
      } catch { return 'unknown' }
    })()
    
    // Initialization count (starts at 1 for fresh restart)
    const initCount = 1
    console.log('================================================')
    console.log('InkChapter Runtime')
    console.log(`Business Build: ${INKCHAPTER_BUILD_ID}`)
    console.log(`Runtime Gate Revision: ${RUNTIME_GATE_REVISION}`)
    console.log(`Plugin Artifact Path: ${pluginArtifactPath}`)
    console.log(`Plugin SHA256: ${pluginMainSha256}`)
    console.log(`Project SHA256: ${projectMainSha256}`)
    console.log(`SHA Match: ${shaMatch}`)
    console.log(`Style SHA256: ${styleSha256}`)
    console.log(`Active Doc: ${activeDoc}`)
    console.log(`Initialization Count: ${initCount}`)
    console.log('================================================')

    console.info(
      `[InkChapter] PLUGIN-RUNTIME-ARTIFACT: ` +
      `pluginMainPath=${pluginArtifactPath} ` +
      `exists=${pluginExists} ` +
      `pluginMainSha256=${pluginMainSha256} ` +
      `buildId=${INKCHAPTER_BUILD_ID}`,
    )
    console.info(
      `[InkChapter] INKCHAPTER-INITIALIZATION: ` +
      `buildId=${INKCHAPTER_BUILD_ID} ` +
      `initializationCount=${initCount} ` +
      `sessionId=${sessionId} ` +
      `timestamp=${new Date().toISOString()}`,
    )
    // R58.6.7: RUNTIME-IDENTITY-FINAL — complete identity snapshot
    emitRuntimeAudit('RUNTIME-IDENTITY-FINAL', {
      reason: 'plugin-onload',
      vaultRoot: vaultRoot ?? 'unknown',
      activeDoc,
      pluginMainPath: pluginArtifactPath,
      pluginMainExists: pluginExists,
      pluginMainSha256,
      projectMainPath,
      projectMainExists,
      projectMainSha256,
      shaMatch,
      stylePath,
      styleSha256,
      buildId: INKCHAPTER_BUILD_ID,
      initializationCount: initCount,
      sessionId,
    })

    // Unified Diagnostics Domain V1 §6/§16/§37 — the identity result is a
    // RUNTIME-domain concern (deployment / plugin state). It is collected into
    // the runtime integrity report and NEVER becomes a user document problem.
    // §6 — the DEPLOYED artifact's own SHA (the legacy `pluginMainSha256` above
    // prefers the project build, so it cannot see a stale deployment).
    const deployedMainSha256 = (() => {
      try {
        if (pluginExists) {
          const data = require('fs').readFileSync(pluginArtifactPath, 'utf-8') as string
          return crypto.createHash('sha256').update(data).digest('hex').toUpperCase()
        }
        return 'unknown'
      } catch { return 'unknown' }
    })()
    const runtimeIntegrity = refreshRuntimeIntegrity(runtimeIntegrityFindingsFromIdentity({
      pluginMainExists: pluginExists,
      pluginMainSha256,
      projectMainExists,
      projectMainSha256,
      shaMatch,
      deployedMainExists: pluginExists,
      deployedMainSha256,
      buildId: INKCHAPTER_BUILD_ID,
      initializationCount: initCount,
    }))
    console.info(
      `[InkChapter] [DIAGNOSTIC][RUNTIME] ` +
      `decision=${runtimeIntegrity.decision} ` +
      `total=${runtimeIntegrity.total} ` +
      `fail=${runtimeIntegrity.failCount} ` +
      `degraded=${runtimeIntegrity.degradedCount} ` +
      `pending=${runtimeIntegrity.pendingCount}`,
    )

    console.log('[InkChapter] INKCHAPTER-BOOT-ONLOAD-SUCCESS')
    console.log('[InkChapter] 插件已加载')
  }

  onunload() {
    // Each disposer is isolated: one throwing service must not abort the rest
    // (in particular the forensic sink flush at the end).
    const safely = (step: string, fn: () => void): void => {
      try {
        fn()
      } catch (error) {
        console.error(`[InkChapter] UNLOAD-STEP-FAILED: step=${step} error=${String(error)}`)
      }
    }
    safely('file-tree-drag', () => {
      if (this.fileTreeDragAdapter) {
        this.fileTreeDragAdapter.dispose()
        this.fileTreeDragAdapter = undefined
      }
    })
    this.fileCopyService = undefined
    this.nativeDragBridge = undefined
    safely('tab-close-visibility', () => {
      if (this.tabCloseVisibility) {
        this.tabCloseVisibility.dispose()
        this.tabCloseVisibility = undefined
      }
    })
    safely('doc-view-menu', () => {
      if (this.docViewMenu) {
        this.docViewMenu.dispose()
        this.docViewMenu = undefined
      }
    })
    safely('document-utilities', () => {
      if (this.documentUtilities) {
        this.documentUtilities.dispose()
        this.documentUtilities = undefined
      }
    })
    safely('numbering-service', () => {
      if (this.numberingService) {
        this.numberingService.dispose()
        this.numberingService = undefined
      }
    })
    safely('caption-context-menu', () => {
      if (this.captionContextMenu) {
        this.captionContextMenu.dispose()
        this.captionContextMenu = undefined
      }
    })
    safely('caption-service', () => {
      if (this.captionService) {
        this.captionService.dispose()
        this.captionService = undefined
      }
    })
    safely('image-context-menu-download', () => {
      if (this.imageContextMenuDownload) {
        this.imageContextMenuDownload.dispose()
        this.imageContextMenuDownload = undefined
      }
    })
    safely('image-asset-service', () => {
      if (this.imageAssetService) {
        this.imageAssetService.dispose()
        this.imageAssetService = undefined
      }
    })
    safely('forensic-sink', () => shutdownForensicSink())
    console.log('[InkChapter] 插件已卸载')
  }
}
