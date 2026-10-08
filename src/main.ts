import './style.scss'
import { Notice, Plugin, PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from './settings/settings-model'
import { DEFAULT_SETTINGS } from './settings/default-settings'
import { HeadingNumberingService } from './heading-numbering/heading-numbering-service'
import type { ServiceContext } from './heading-numbering/heading-numbering-service'
import { resolveHeadingPolicyActivation } from './heading-numbering/heading-policy-activation'
import { HeadingDomAdapter } from './infrastructure/heading-dom-adapter'
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
import { initializeForensicSink, shutdownForensicSink, emitRuntimeAudit } from './runtime/forensic-log-sink'
import {
  INKCHAPTER_PLUGIN_ID,
  buildInkChapterGlobalLoadAudit,
  resolveInkChapterPathAuthority,
  resolveInkChapterStorageRoot,
  toInkChapterDocumentContext,
  type InkChapterDocumentContext,
} from './runtime/inkchapter-path-authority'
import { recordInkChapterBootstrap } from './runtime/inkchapter-bootstrap-audit'
// Unified Diagnostics Domain V1 §6/§37 — the plugin's OWN runtime integrity is
// the `runtime` domain; it is adapted here and never enters the user Drawer.
import { refreshRuntimeIntegrity, runtimeIntegrityFindingsFromIdentity } from './document-utilities/diagnostic-domain-v1'
import { createDocumentUtilities, extractFormulaVisibleTagTokens, type DocumentUtilities } from './document-utilities/document-utilities'
// Heading Auto-Number Conflict V1.2 §21/§22 — dev/test-only bridge IO (report sink).
import { writeHeadingConflictBridgeReport, readHeadingConflictBridgeFile, consumeHeadingConflictBridgeFile } from './heading-numbering/heading-conflict-test-bridge'
import { DocumentViewContextMenu, type DocViewPlatform } from './document-utilities/document-view-context-menu'
import { TabCloseVisibilityEnhancer, measureTabCloseVisibility, evaluateTabCloseVisibility, measureTabCloseCentering, evaluateTabCloseCentering } from './document-utilities/document-utility-tab-close-visibility'
import type { EmptyWorkspaceSurfaceFacts } from './document-utilities/document-empty-workspace-controller'

/** Runtime audit marker — separate from INKCHAPTER_BUILD_ID. */
const RUNTIME_AUDIT_BUILD_MARKER = 'inkchapter-runtime-audit-h2-outline-v2'

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

export default class extends Plugin<InkChapterSettings> {

  private numberingService?: HeadingNumberingService
  private captionService?: CaptionService
  private captionContextMenu?: CaptionContextMenu
  private numberingCoordinator?: DocumentNumberingCoordinator
  private documentUtilities?: DocumentUtilities
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
    const sessionId = `sess-${Date.now()}`
    initializeForensicSink({ vaultRoot: storageRoot, buildId: INKCHAPTER_BUILD_ID, sessionId })

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
      getMarkdown: () => editor.getMarkdown(),
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

    // ── Phase 7R.3.11: Document Utilities (diagnostics + lock + scroll) ──
    // Presentation/utility layer only. Mounts editor-shell overlays OUTSIDE
    // #write so their mutations never enter numbering pipelines.
    try {
      this.documentUtilities = createDocumentUtilities({
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
        isStrictMode: () => {
          // Phase 7R.3.11.8B.7.1 — the diagnostics mode input MUST be the
          // EFFECTIVE mode (document override ?? global), never global-only.
          try {
            return this.numberingService?.getEffectiveHeadingMode() === 'strict'
          } catch { return false }
        },
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
          return this.numberingService.subscribeCanonicalHeadingFrame(() => cb(), { emitCurrent: true })
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
      console.log('[InkChapter] document utilities mounted')
    } catch (e) {
      console.error('[InkChapter] 文档工具初始化失败，诊断/锁定/滚动功能不可用', e)
    }

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
            try { void navigator.clipboard?.writeText(text) } catch { /* fail-open */ }
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
      this.docViewMenu = new DocumentViewContextMenu(docViewPlatform)
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
            const centering = evaluateTabCloseCentering({
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

    // ── Commands (always registered, even if service failed) ──

    // Status check command
    this.registerCommand({
      id: 'inkchapter.check-status',
      title: '检查插件状态',
      scope: 'global',
      callback: () => Notice.info('墨章 InkChapter 已正常加载'),
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
    if (this.tabCloseVisibility) {
      this.tabCloseVisibility.dispose()
      this.tabCloseVisibility = undefined
    }
    if (this.docViewMenu) {
      this.docViewMenu.dispose()
      this.docViewMenu = undefined
    }
    if (this.documentUtilities) {
      this.documentUtilities.dispose()
      this.documentUtilities = undefined
    }
    if (this.numberingService) {
      this.numberingService.dispose()
      this.numberingService = undefined
    }
    if (this.captionContextMenu) {
      this.captionContextMenu.dispose()
      this.captionContextMenu = undefined
    }
    if (this.captionService) {
      this.captionService.dispose()
      this.captionService = undefined
    }
    shutdownForensicSink()
    console.log('[InkChapter] 插件已卸载')
  }
}
