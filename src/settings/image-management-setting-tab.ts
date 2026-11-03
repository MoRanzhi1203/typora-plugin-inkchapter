/**
 * 墨章「图片管理」设置页 = 首次初始化向导 + 日常配置入口。
 *
 * 设计：
 * - 未初始化时，页面顶部明确提示，并提供「校验目录 → 初始化图库」流程。
 * - 初始化完成后才写入 `initialized: true`，在此之前不改动任何磁盘内容。
 * - 远程图床可选；Token 永不在此页面输入，只接受凭据引用 ID。
 */
import { SettingTab } from '@typora-community-plugin/core'
import {
  resolveImageSettings,
  validateRemoteProfile,
  type ImageCompressionMode,
  type ImageNamingStrategy,
  type ImageReferenceMode,
  type ImageSettings,
  type ImageStorageMode,
  type ImageUploadService,
} from '../image-management/image-settings'
import type { InitializeImageLibraryResult, LibraryInspection } from '../image-management/image-library-inspection'
import { resolveImageDataPaths } from '../image-management/image-data-paths'
import type { ImageLibraryCenterRow, ImageLibraryView } from '../image-management/image-library-center'

const DEFAULT_REMOTE_PROFILE_ID = 'github-default'

export interface ImageManagementSettingTabHost {
  read(): ImageSettings
  write(next: ImageSettings): void
  inspect(path: string): Promise<LibraryInspection>
  initialize(path: string, options: { allowNonEmpty: boolean }): Promise<InitializeImageLibraryResult>
  pickDirectory(initialDirectory: string): Promise<string | null>
  confirm(message: string): boolean
  notify(message: string, kind?: 'info' | 'error'): void
  /** 插件私有数据目录，用于展示有效路径。 */
  getDataPath(): string
  /** 只读统计目录占用；失败返回 null。 */
  inspectUsage(path: string): Promise<{ fileCount: number; totalBytes: number } | null>
  /** 四视图图库中心数据；未就绪时返回空数组。 */
  getLibraryCenter(): Promise<ImageLibraryView[]>
  /** 手动上传单张本地图片（不修改 Markdown）。 */
  uploadLocalImage(): Promise<void>
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '未知'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

function inspectionMessage(inspection: LibraryInspection): string {
  switch (inspection.code) {
    case 'EMPTY_PATH':
      return '请先填写或选择本地图库目录。'
    case 'INVALID_PATH':
      return '路径无效：必须是绝对路径，且不能包含 .. 片段。'
    case 'DRIVE_MISSING':
      return `磁盘不存在：${inspection.normalizedPath ?? ''}`
    case 'NOT_A_DIRECTORY':
      return '目标已存在但不是文件夹。'
    case 'NOT_WRITABLE':
      return '目录不可写，请检查权限后重试。'
    case 'PATH_MISSING':
      return '目录尚不存在；点击「初始化图库」可创建（将先检查磁盘与权限）。'
    case 'EXISTING_LIBRARY':
      return `已存在墨章图库：${inspection.normalizedPath ?? ''}（可直接接管）。`
    case 'DIRECTORY_NOT_EMPTY':
      return `目录非空（${inspection.entryCount ?? '?'} 项），且不是墨章图库；接管前需要确认。`
    case 'READY':
      return `目录可用：${inspection.normalizedPath ?? ''}（可用空间 ${formatBytes(inspection.freeBytes)}）。`
    default:
      return '未知状态。'
  }
}

function inspectionDetails(inspection: LibraryInspection): string {
  const parts: string[] = []
  if (inspection.entryCount !== null) parts.push(`现有条目 ${inspection.entryCount}`)
  if (inspection.writable !== null) parts.push(inspection.writable ? '可写' : '不可写')
  parts.push(`可用空间 ${formatBytes(inspection.freeBytes)}`)
  return parts.join(' · ')
}

export class ImageManagementSettingTab extends SettingTab {
  get name(): string {
    return '墨章 · 图片'
  }

  private libraryPathDraft = ''
  private statusEl: HTMLElement | null = null
  private diagnosticsEl: HTMLElement | null = null
  private libraryCenterEl: HTMLElement | null = null
  private remoteInputs: {
    owner: HTMLInputElement | null
    repository: HTMLInputElement | null
    branch: HTMLInputElement | null
    remoteDirectory: HTMLInputElement | null
    credentialReferenceId: HTMLInputElement | null
  } = { owner: null, repository: null, branch: null, remoteDirectory: null, credentialReferenceId: null }

  constructor(private host: ImageManagementSettingTabHost) {
    super()
  }

  onshow(): void {
    this.render()
  }

  private render(): void {
    while (this.containerEl.firstChild) this.containerEl.removeChild(this.containerEl.firstChild)
    const settings = this.host.read()
    this.libraryPathDraft = settings.globalLibrary.root
    this.statusEl = null
    this.diagnosticsEl = null
    this.libraryCenterEl = null
    this.remoteInputs = { owner: null, repository: null, branch: null, remoteDirectory: null, credentialReferenceId: null }

    this.addSettingTitle(settings.initialized ? '图片管理' : '图片管理 · 初始化向导')
    this.addSetting(s => {
      s.addName('启用图片管理')
      s.addDescription(
        settings.initialized
          ? '已初始化。关闭后不加载图片服务，Typora 原生粘贴、拖拽、插入与管理行为不受影响。'
          : '启用后先完成本地图库初始化，再逐步开启上传、下载与同步。未完成初始化不会写入任何磁盘内容。',
      )
      if (settings.initialized) s.addBadge('已初始化')
      s.addCheckbox(cb => {
        cb.checked = settings.enabled
        cb.onchange = () => this.write({ ...settings, enabled: cb.checked })
      })
    })

    this.addSettingTitle('本地图库')
    this.addSetting(s => {
      s.addName('图库模式')
      s.addDescription('「仅索引」不要求创建目录；「长期归档」必须选择真实目录，墨章不会自动清理。')
      s.addSelect(select => {
        const options: Array<['off' | 'index' | 'archive', string]> = [
          ['off', '关闭'],
          ['index', '仅索引（推荐）'],
          ['archive', '长期归档'],
        ]
        for (const [value, label] of options) select.add(new Option(label, value))
        select.value = settings.globalLibrary.mode
        select.onchange = () => {
          const current = this.host.read()
          this.write({
            ...current,
            globalLibrary: { ...current.globalLibrary, mode: select.value as 'off' | 'index' | 'archive' },
          })
          this.render()
        }
      })
    })
    this.addSetting(s => {
      s.addName('图库目录')
      s.addDescription('用于统一存放原图。建议放在独立磁盘或固定目录；初始化前会检查磁盘、权限、空间与目录占用。')
      s.addInput('text', input => {
        input.value = settings.globalLibrary.root
        input.placeholder = '例如 D:\\MyImageLibrary（不要使用 E 盘硬编码）'
        input.onchange = () => {
          this.libraryPathDraft = input.value.trim()
          this.persistDraftPath()
        }
      })
    })

    this.addSetting(s => {
      s.addName('目录操作')
      s.addDescription('「浏览」使用 Windows 原生目录选择框；「校验」只读检查，不创建任何文件。')
      s.addButton(button => {
        button.textContent = '浏览…'
        button.onclick = () => void this.browse()
      })
      s.addButton(button => {
        button.textContent = '校验'
        button.onclick = () => void this.inspect()
      })
      s.addButton(button => {
        button.textContent = '初始化图库'
        button.onclick = () => void this.initialize()
      })
    })

    this.addSetting(s => {
      s.addDescription(div => {
        this.statusEl = div
        div.textContent = settings.initialized
          ? `当前图库：${settings.globalLibrary.root || '未选择目录'}`
          : '尚未初始化本地图库。'
      })
    })

    this.addSettingTitle('存储与引用')
    this.addSetting(s => {
      s.addName('图片存储模式')
      s.addDescription('存储策略与 Markdown 引用策略相互独立：上传成功不代表必须改写文档引用。')
      s.addSelect(select => {
        const options: Array<[ImageStorageMode, string]> = [
          ['dual-storage', '双存储（本地 + 远程，推荐）'],
          ['local-first', '仅本地优先'],
          ['remote-first', '远程优先'],
        ]
        for (const [value, label] of options) select.add(new Option(label, value))
        select.value = settings.storageMode
        select.onchange = () => this.write({ ...this.host.read(), storageMode: select.value as ImageStorageMode })
      })
    })

    this.addSetting(s => {
      s.addName('Markdown 引用形式')
      s.addDescription('第一版不会自动改写已有引用；此处只决定新导入图片的默认引用形式。')
      s.addSelect(select => {
        const options: Array<[ImageReferenceMode, string]> = [
          ['local-relative', '文档相对路径（可移植）'],
          ['remote-url', '远程 URL'],
        ]
        for (const [value, label] of options) select.add(new Option(label, value))
        select.value = settings.referenceMode
        select.onchange = () => this.write({ ...this.host.read(), referenceMode: select.value as ImageReferenceMode })
      })
    })

    this.addSetting(s => {
      s.addName('上传服务')
      s.addDescription(
        '「无」不发起任何新上传、不新增远程位置或双链，历史远程 URL 保持原样；'
        + '「GitHub」需要先保存有效的远程配置。Typora 原生六种插入方式不受影响。',
      )
      s.addSelect(select => {
        const options: Array<[ImageUploadService, string]> = [
          ['none', '无'],
          ['github', 'GitHub'],
        ]
        for (const [value, label] of options) select.add(new Option(label, value))
        select.value = settings.uploadService
        select.onchange = () => {
          const next = resolveImageSettings({
            ...this.host.read(),
            uploadService: select.value as ImageUploadService,
          })
          if (select.value === 'github' && next.uploadService === 'none') {
            this.host.notify('尚无有效 GitHub 远程配置，上传服务保持为「无」', 'error')
            this.render()
            return
          }
          this.write(next)
          this.render()
        }
      })
    })

    this.addSetting(s => {
      s.addName('自动上传')
      s.addDescription('仅在已有可用的上传服务时生效；默认关闭，避免插入即上传。')
      s.addCheckbox(cb => {
        cb.checked = settings.autoUpload
        cb.onchange = () => this.write({ ...this.host.read(), autoUpload: cb.checked })
      })
    })

    this.addSettingTitle('命名与压缩')
    this.addSetting(s => {
      s.addName('图片命名策略')
      s.addDescription('文件名、alt、题注与墨章图号相互独立；图号变化不会重命名物理文件。')
      s.addSelect(select => {
        const options: Array<[ImageNamingStrategy, string]> = [
          ['timestamp-hash', '时间戳 + 哈希短码（推荐）'],
          ['original-name', '保留原文件名'],
          ['custom', '自定义（导入时询问）'],
        ]
        for (const [value, label] of options) select.add(new Option(label, value))
        select.value = settings.namingStrategy
        select.onchange = () => this.write({ ...this.host.read(), namingStrategy: select.value as ImageNamingStrategy })
      })
    })

    this.addSetting(s => {
      s.addName('压缩策略')
      s.addDescription('论文图表与文字截图默认不采用有损压缩；GIF 不破坏动画；SVG 需安全校验。')
      s.addSelect(select => {
        const options: Array<[ImageCompressionMode, string]> = [
          ['keep', '保留原图（默认）'],
          ['lossless', '无损优化'],
          ['smart', '智能压缩'],
        ]
        for (const [value, label] of options) select.add(new Option(label, value))
        select.value = settings.compressionMode
        select.onchange = () => this.write({ ...this.host.read(), compressionMode: select.value as ImageCompressionMode })
      })
    })

    this.addSetting(s => {
      s.addName('转换为 WebP')
      s.addDescription('仅对支持的格式生效；第一版默认关闭。')
      s.addCheckbox(cb => {
        cb.checked = settings.convertToWebp
        cb.onchange = () => this.write({ ...this.host.read(), convertToWebp: cb.checked })
      })
    })

    this.renderRemoteSection(settings)
    this.renderPathSection(settings)
    this.renderGuidance()
  }

  private renderPathSection(settings: ImageSettings): void {
    this.addSettingTitle('存储路径与配额')
    this.addSetting(s => {
      s.addName('缓存模式')
      s.addDescription('普通缓存可被 LRU 清理；固定离线资源永不参与缓存清理。')
      s.addSelect(select => {
        const options: Array<['off' | 'smart' | 'manual', string]> = [
          ['off', '关闭'],
          ['smart', '智能按需（推荐）'],
          ['manual', '仅手动'],
        ]
        for (const [value, label] of options) select.add(new Option(label, value))
        select.value = settings.cache.mode
        select.onchange = () => {
          const current = this.host.read()
          this.write(resolveImageSettings({ ...current, cache: { ...current.cache, mode: select.value as 'off' | 'smart' | 'manual' } }))
          this.render()
        }
      })
    })

    this.addSetting(s => {
      s.addName('缓存目录')
      s.addDescription('留空使用系统默认（LOCALAPPDATA）；自定义必须是绝对路径。')
      s.addInput('text', input => {
        input.value = settings.cache.root
        input.placeholder = '留空 = 系统默认缓存目录'
        input.onchange = () => this.writePathRoot('cache', input.value)
      })
    })

    this.addSetting(s => {
      s.addName('缓存上限（MB）')
      s.addDescription('默认 512 MB；仅统计可清理的普通缓存与缩略图。')
      s.addInput('text', input => {
        input.value = String(settings.cache.maxSizeMB)
        input.onchange = () => {
          const current = this.host.read()
          const parsed = Number(input.value)
          const next = resolveImageSettings({ ...current, cache: { ...current.cache, maxSizeMB: parsed } })
          this.write(next)
          if (Number.isFinite(parsed) && parsed !== next.cache.maxSizeMB) {
            this.host.notify(`缓存上限已调整为 ${next.cache.maxSizeMB} MB`, 'info')
          }
          input.value = String(next.cache.maxSizeMB)
        }
      })
    })

    this.addSetting(s => {
      s.addName('离线资源目录')
      s.addDescription('留空使用系统默认；固定离线资源不会被普通缓存清理。')
      s.addInput('text', input => {
        input.value = settings.offline.root
        input.placeholder = '留空 = 系统默认离线目录'
        input.onchange = () => this.writePathRoot('offline', input.value)
      })
    })

    this.addSetting(s => {
      s.addName('上传暂存目录')
      s.addDescription('留空使用系统临时目录；路径修改只影响未来的上传任务。')
      s.addInput('text', input => {
        input.value = settings.uploadStaging.root
        input.placeholder = '留空 = 系统临时目录'
        input.onchange = () => this.writePathRoot('uploadStaging', input.value)
      })
    })

    this.addSetting(s => {
      s.addName('资产数据库目录')
      s.addDescription('留空使用插件私有数据目录；迁移前会自动备份索引。')
      s.addInput('text', input => {
        input.value = settings.database.root
        input.placeholder = '留空 = 插件私有数据目录'
        input.onchange = () => this.writePathRoot('database', input.value)
      })
    })

    this.addSetting(s => {
      s.addName('有效配置与来源')
      s.addDescription('显示运行时解析后的路径与来源，不会创建目录。')
      s.addButton(button => {
        button.textContent = '刷新有效配置'
        button.onclick = () => void this.refreshDiagnostics()
      })
      s.addDescription(div => {
        this.diagnosticsEl = div
        div.style.whiteSpace = 'pre-wrap'
        div.textContent = '点击「刷新有效配置」查看逻辑路径与来源。'
      })
    })
  }

  private renderGuidance(): void {
    this.addSettingTitle('Typora 原生插图')
    this.addSetting(s => {
      s.addName('六种插入方式保持不变')
      s.addDescription(
        '墨章不复制、不替换 Typora 原生行为：无特殊操作、复制到 ./、复制到 ./assets、'
        + '复制到 ./${filename}.assets、上传图片、复制到指定路径。请在 Typora 首选项 → 图像中设置；'
        + '本页不读取、不伪装同步该状态。',
      )
    })

    this.addSettingTitle('项目整理与离线')
    this.addSetting(s => {
      s.addName('显式操作')
      s.addDescription(
        '项目 assets 迁移、离线准备与分享导出需要具体文档/项目上下文，且都会先预览再执行；'
        + '本页只保存配置，不会自动迁移文件或改写 Markdown。',
      )
    })

    this.renderLibraryCenterSection()
  }

  private renderLibraryCenterSection(): void {
    this.addSettingTitle('图库中心')
    this.addSetting(s => {
      s.addName('四视图（只读）')
      s.addDescription(
        '当前文档 / 本地图库 / 云端图库 / 任务与诊断；只展示已记录的事实，'
        + '不联网探测、不新增漂浮标记、不改变图号与题注样式。',
      )
      s.addButton(button => {
        button.textContent = '刷新'
        button.onclick = () => void this.refreshLibraryCenter()
      })
      s.addButton(button => {
        button.textContent = '上传本地图片…'
        button.onclick = () => void this.host.uploadLocalImage()
      })
    })
    this.addSetting(s => {
      s.addDescription(div => {
        this.libraryCenterEl = div
        div.textContent = '正在读取…'
      })
    })
    void this.refreshLibraryCenter()
  }

  private async refreshLibraryCenter(): Promise<void> {
    const target = this.libraryCenterEl
    if (!target) return
    let views: ImageLibraryView[]
    try {
      views = await this.host.getLibraryCenter()
    } catch {
      target.textContent = '图库中心读取失败；编辑与文件不受影响。'
      return
    }
    while (target.firstChild) target.removeChild(target.firstChild)
    if (views.length === 0) {
      target.textContent = '图库中心尚未就绪（图片服务未启用或初始化未完成）。'
      return
    }
    for (const view of views) {
      const section = document.createElement('div')
      section.style.marginBottom = '10px'
      const title = document.createElement('div')
      title.textContent = `${view.title} — ${view.summary}`
      title.style.fontWeight = '600'
      section.appendChild(title)
      if (view.rows.length === 0) {
        const empty = document.createElement('div')
        empty.textContent = view.emptyMessage
        empty.style.opacity = '0.7'
        section.appendChild(empty)
      } else {
        for (const row of view.rows) section.appendChild(this.buildLibraryCenterRow(row))
      }
      target.appendChild(section)
    }
  }

  private buildLibraryCenterRow(row: ImageLibraryCenterRow): HTMLElement {
    const line = document.createElement('div')
    line.textContent = `• [${row.status}] ${row.primary}${row.secondary ? ` — ${row.secondary}` : ''}`
    line.style.whiteSpace = 'pre-wrap'
    return line
  }

  private writePathRoot(
    field: 'cache' | 'offline' | 'uploadStaging' | 'database',
    value: string,
  ): void {
    const current = this.host.read()
    const root = value.trim()
    let next: ImageSettings
    if (field === 'cache') {
      next = resolveImageSettings({ ...current, cache: { ...current.cache, root } })
    } else if (field === 'offline') {
      next = resolveImageSettings({ ...current, offline: { root } })
    } else if (field === 'uploadStaging') {
      next = resolveImageSettings({ ...current, uploadStaging: { root } })
    } else {
      next = resolveImageSettings({ ...current, database: { root } })
    }
    this.write(next)
    const applied = field === 'cache'
      ? next.cache.root
      : field === 'offline'
        ? next.offline.root
        : field === 'uploadStaging'
          ? next.uploadStaging.root
          : next.database.root
    if (root && !applied) {
      this.host.notify('路径无效：必须是绝对路径且不能包含 ..；已恢复为运行时默认', 'error')
    }
  }

  private async refreshDiagnostics(): Promise<void> {
    const settings = this.host.read()
    let paths: ReturnType<typeof resolveImageDataPaths>
    try {
      paths = resolveImageDataPaths(this.host.getDataPath(), { settings })
    } catch (error) {
      if (this.diagnosticsEl) this.diagnosticsEl.textContent = `无法解析路径：${String(error)}`
      return
    }
    const lines = [
      `上传服务：${settings.uploadService === 'none' ? '无（默认）' : 'GitHub（本机 Profile）'}`,
      `图库（${settings.globalLibrary.mode}）：${paths.libraryRoot ?? '未启用'} [${paths.sources.library}]`,
      `缓存（${settings.cache.mode}）：${paths.cacheRoot ?? '已关闭'} [${paths.sources.cache}]`,
      `离线资源：${paths.offlineRoot} [${paths.sources.offline}]`,
      `上传暂存：${paths.stagingRoot} [${paths.sources.staging}]`,
      `资产数据库：${paths.databaseRoot} [${paths.sources.database}]`,
    ]
    if (paths.cacheObjectsDir) {
      const usage = await this.host.inspectUsage(paths.cacheObjectsDir)
      lines.push(usage
        ? `缓存占用：${formatBytes(usage.totalBytes)} · ${usage.fileCount} 个文件`
        : '缓存占用：尚未创建')
    }
    if (paths.libraryRoot) {
      const inspection = await this.host.inspect(paths.libraryRoot)
      lines.push(inspection.exists
        ? `图库状态：${inspection.code}${inspection.entryCount !== null ? ` · ${inspection.entryCount} 项` : ''}`
        : '图库状态：目录不存在（仅索引模式不会创建）')
    }
    lines.push(`云端图库：${settings.remoteProfiles.length} 个本机 Profile，未联网验证`)
    if (this.diagnosticsEl) this.diagnosticsEl.textContent = lines.join('\n')
  }

  private renderRemoteSection(settings: ImageSettings): void {
    const profile = settings.remoteProfiles.find(item => item.remoteProfileId === DEFAULT_REMOTE_PROFILE_ID)
      ?? settings.remoteProfiles[0]
      ?? null

    this.addSettingTitle('GitHub 图床（可选）')
    this.addSetting(s => {
      s.addName('远程图床')
      s.addDescription(
        '可以跳过，先只使用本地图库。Token 不在此页面输入：此处只保存凭据引用 ID，'
        + '上传阶段再从操作系统凭据读取。默认分支留空表示使用仓库真实默认分支。',
      )
      if (profile) s.addBadge(`已配置 ${profile.owner}/${profile.repository}`)
    })

    this.addSetting(s => {
      s.addName('Owner')
      s.addInput('text', input => {
        this.remoteInputs.owner = input
        input.value = profile?.owner ?? ''
        input.placeholder = 'GitHub 用户名或组织'
        input.onchange = () => this.saveRemoteFromInputs()
      })
    })

    this.addSetting(s => {
      s.addName('Repository')
      s.addInput('text', input => {
        this.remoteInputs.repository = input
        input.value = profile?.repository ?? ''
        input.placeholder = '仓库名，例如 my-images'
        input.onchange = () => this.saveRemoteFromInputs()
      })
    })

    this.addSetting(s => {
      s.addName('Branch')
      s.addInput('text', input => {
        this.remoteInputs.branch = input
        input.value = profile?.branch ?? ''
        input.placeholder = '留空 = 使用仓库默认分支'
        input.onchange = () => this.saveRemoteFromInputs()
      })
    })

    this.addSetting(s => {
      s.addName('上传目录')
      s.addInput('text', input => {
        this.remoteInputs.remoteDirectory = input
        input.value = profile?.remoteDirectory ?? ''
        input.placeholder = '例如 blog/2026（留空 = 仓库根目录）'
        input.onchange = () => this.saveRemoteFromInputs()
      })
    })

    this.addSetting(s => {
      s.addName('凭据引用 ID')
      s.addDescription('例如 image.github.default；Token 本身不得写入设置。')
      s.addInput('text', input => {
        this.remoteInputs.credentialReferenceId = input
        input.value = profile?.credentialReferenceId ?? ''
        input.placeholder = 'image.github.default'
        input.onchange = () => this.saveRemoteFromInputs()
      })
    })

    this.addSetting(s => {
      s.addName('远程配置操作')
      s.addButton(button => {
        button.textContent = '保存远程配置'
        button.onclick = () => this.saveRemoteFromInputs()
      })
      s.addButton(button => {
        button.textContent = '清除远程配置'
        button.onclick = () => {
          this.write({ ...this.host.read(), remoteProfiles: [], defaultRemoteProfileId: null })
          this.host.notify('已清除远程图床配置；本地图库不受影响')
          this.render()
        }
      })
    })
  }

  private inputValues(): { owner: string; repository: string; branch: string; remoteDirectory: string; credentialReferenceId: string } {
    return {
      owner: this.remoteInputs.owner?.value.trim() ?? '',
      repository: this.remoteInputs.repository?.value.trim() ?? '',
      branch: this.remoteInputs.branch?.value.trim() ?? '',
      remoteDirectory: this.remoteInputs.remoteDirectory?.value.trim() ?? '',
      credentialReferenceId: this.remoteInputs.credentialReferenceId?.value.trim() ?? '',
    }
  }

  private saveRemoteFromInputs(): void {
    const current = this.host.read()
    const values = this.inputValues()
    if (!values.owner && !values.repository) {
      this.write({ ...current, remoteProfiles: [], defaultRemoteProfileId: null })
      this.host.notify('远程图床未配置，将只使用本地图库')
      this.render()
      return
    }

    const validation = validateRemoteProfile({
      remoteProfileId: DEFAULT_REMOTE_PROFILE_ID,
      provider: 'github',
      owner: values.owner,
      repository: values.repository,
      branch: values.branch,
      remoteDirectory: values.remoteDirectory,
      urlStrategy: 'raw',
      customUrlBase: '',
      credentialReferenceId: values.credentialReferenceId,
      enabled: true,
    })
    if (!validation.ok || !validation.normalized) {
      this.host.notify(`远程配置无效：${validation.problems.join(', ')}`, 'error')
      return
    }
    this.write({
      ...current,
      remoteProfiles: [validation.normalized],
      defaultRemoteProfileId: validation.normalized.remoteProfileId,
    })
    this.host.notify('远程图床配置已保存（尚未验证仓库与权限）')
    this.render()
  }

  private persistDraftPath(): void {
    const current = this.host.read()
    this.write({
      ...current,
      globalLibrary: { ...current.globalLibrary, root: this.libraryPathDraft },
    })
  }

  private async browse(): Promise<void> {
    const picked = await this.host.pickDirectory(this.libraryPathDraft)
    if (!picked) return
    this.libraryPathDraft = picked
    this.persistDraftPath()
    await this.inspect()
  }

  private async inspect(): Promise<void> {
    const inspection = await this.host.inspect(this.libraryPathDraft)
    if (this.statusEl) {
      this.statusEl.textContent = `${inspectionMessage(inspection)} ${inspectionDetails(inspection)}`
    }
  }

  private async initialize(): Promise<void> {
    const initial = await this.host.inspect(this.libraryPathDraft)
    if (!initial.ok && initial.code !== 'DIRECTORY_NOT_EMPTY' && initial.code !== 'PATH_MISSING') {
      if (this.statusEl) this.statusEl.textContent = inspectionMessage(initial)
      this.host.notify(inspectionMessage(initial), 'error')
      return
    }

    let allowNonEmpty = false
    if (initial.code === 'DIRECTORY_NOT_EMPTY') {
      allowNonEmpty = this.host.confirm(
        `目录中已有 ${initial.entryCount ?? 0} 个条目，且不是墨章图库。\n继续会写入墨章图库标记，但不会移动或删除已有文件。是否继续？`,
      )
      if (!allowNonEmpty) return
    }

    const result = await this.host.initialize(this.libraryPathDraft, { allowNonEmpty })
    if (!result.ok) {
      const message = result.error ?? result.inspection.code
      if (this.statusEl) this.statusEl.textContent = `初始化失败：${message}`
      this.host.notify(`图库初始化失败：${message}`, 'error')
      return
    }

    const current = this.host.read()
    const normalizedPath = result.inspection.normalizedPath ?? this.libraryPathDraft
    this.write({
      ...current,
      enabled: true,
      initialized: true,
      globalLibrary: {
        mode: current.globalLibrary.mode === 'off' ? 'archive' : current.globalLibrary.mode,
        root: normalizedPath,
      },
    })
    this.host.notify(`图库已初始化：${normalizedPath}`)
    this.render()
  }

  private write(next: ImageSettings): void {
    this.host.write(resolveImageSettings(next))
  }
}
