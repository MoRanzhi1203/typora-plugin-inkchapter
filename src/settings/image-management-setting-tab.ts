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

const DEFAULT_REMOTE_PROFILE_ID = 'github-default'

export interface ImageManagementSettingTabHost {
  read(): ImageSettings
  write(next: ImageSettings): void
  inspect(path: string): Promise<LibraryInspection>
  initialize(path: string, options: { allowNonEmpty: boolean }): Promise<InitializeImageLibraryResult>
  pickDirectory(initialDirectory: string): Promise<string | null>
  confirm(message: string): boolean
  notify(message: string, kind?: 'info' | 'error'): void
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
    this.libraryPathDraft = settings.localLibraryPath
    this.statusEl = null
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
      s.addName('图库目录')
      s.addDescription('用于统一存放原图。建议放在独立磁盘或固定目录；初始化前会检查磁盘、权限、空间与目录占用。')
      s.addInput('text', input => {
        input.value = settings.localLibraryPath
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
          ? `当前图库：${settings.localLibraryPath}${settings.documentResourceDirectory ? ` · 文档资源目录：${settings.documentResourceDirectory}` : ''}`
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
    this.write({ ...current, localLibraryPath: this.libraryPathDraft })
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
      localLibraryPath: normalizedPath,
    })
    this.host.notify(`图库已初始化：${normalizedPath}`)
    this.render()
  }

  private write(next: ImageSettings): void {
    this.host.write(resolveImageSettings(next))
  }
}
