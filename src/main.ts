import './style.scss'
import { Notice, Plugin, PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from './settings/settings-model'
import { DEFAULT_SETTINGS } from './settings/default-settings'
import { HeadingNumberingService } from './heading-numbering/heading-numbering-service'
import type { ServiceContext } from './heading-numbering/heading-numbering-service'
import { HeadingDomAdapter } from './infrastructure/heading-dom-adapter'
import { HeadingNumberingSettingTab } from './settings/heading-numbering-setting-tab'
import { editor, File } from 'typora'
import { enableRuntimeAudit, getAuditEventsJSON, clearRuntimeAudit, copyAuditEventsToClipboard, recordRuntimeAudit } from './heading-numbering/runtime-audit'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

/** Build marker — search Typora console for this to verify deployed version. */
const HEADING_BUILD_MARKER = 'inkchapter-enter-single-owner-transaction-r47-d9f3c'
/** Runtime audit marker — must co-exist with HEADING_BUILD_MARKER. */
const RUNTIME_AUDIT_BUILD_MARKER = 'inkchapter-runtime-audit-h2-outline-v2'


export default class extends Plugin<InkChapterSettings> {

  private numberingService?: HeadingNumberingService

  onload() {
    console.log(`[InkChapter] onload START  build=${HEADING_BUILD_MARKER}`)
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

    // Build service context (exposes only needed APIs, avoids protected access)
    const ctx: ServiceContext = {
      settings: this.settings,
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
          // Derive vault path from active file
          let vaultDir = ''
          const activeFile = this.app.workspace.activeFile
          if (activeFile) {
            // activeFile is like D:\...\test\vault\doc.md
            // Find the .typora directory to identify vault root
            const parts = activeFile.split(/[\\/]/)
            for (let i = parts.length - 1; i >= 0; i--) {
              const candidate = parts.slice(0, i).join(path.sep)
              try {
                if (fs.existsSync(path.join(candidate, '.typora'))) {
                  vaultDir = candidate
                  break
                }
              } catch { /* ignore */ }
            }
          }
          // Fallback: use manifest.dir
          if (!vaultDir) {
            const pluginRoot = (this as any).manifest?.dir ?? ''
            if (pluginRoot) {
              vaultDir = path.join(pluginRoot, '..', '..')
            }
          }
          if (vaultDir) {
            const diagPath = path.join(vaultDir, filename)
            fs.writeFileSync(diagPath, data, 'utf8')
            console.log(`[InkChapter] wrote diagnostic: ${diagPath}`)
          }
        } catch (e) {
          console.error('[InkChapter] failed to write diagnostic:', e)
        }
      },
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

    // Register settings tab
    if (this.numberingService) {
      try {
        this.registerSettingTab(
          new HeadingNumberingSettingTab(this.settings, this.numberingService),
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
          buildMarker: HEADING_BUILD_MARKER,
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

    console.log('[InkChapter] 插件已加载')
  }

  onunload() {
    if (this.numberingService) {
      this.numberingService.dispose()
      this.numberingService = undefined
    }
    console.log('[InkChapter] 插件已卸载')
  }
}
