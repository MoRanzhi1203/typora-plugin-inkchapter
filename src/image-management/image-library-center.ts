/**
 * 四视图图库中心（P10-C）。
 *
 * 只构建**纯数据视图模型**，不碰 DOM、不新增 MutationObserver、不写任何文件：
 * - 当前文档：解析文档中的图片引用并给出可用性；
 * - 本地图库：资产的全部永久本地位置；
 * - 云端图库：资产的 GitHub 位置（只认已记录的 URL，不联网探测）；
 * - 任务与诊断：传输任务状态、上传服务、Typora 插入方式与冲突提示。
 *
 * 设置页负责把这些模型渲染成只读文本；任何删除/迁移都必须由用户显式触发。
 */

import {
  parseMarkdownImageReferences,
  type AssetLocationRecord,
  type TransferTask,
} from './image-asset-model'
import type { ImageAssetRecord } from './image-asset-index'
import { resolveReferenceState } from './image-reference-state'
import type { ImageDataPaths } from './image-data-paths'
import type { ImageSettings } from './image-settings'
import { detectUploadServiceConflict, type TyporaImagePreferences } from './image-upload-policy'

export type ImageLibraryViewId = 'document' | 'local-library' | 'cloud-library' | 'tasks-diagnostics'

export type ImageLibraryRowStatus =
  | 'available'
  | 'missing'
  | 'unknown'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'info'

export interface ImageLibraryCenterRow {
  primary: string
  secondary: string | null
  status: ImageLibraryRowStatus
}

export interface ImageLibraryView {
  id: ImageLibraryViewId
  title: string
  description: string
  summary: string
  emptyMessage: string
  rows: ImageLibraryCenterRow[]
}

export interface ImageLibraryCenterInput {
  documentPath: string | null
  /** 当前文档的 Markdown 文本；未打开文档时为 `null`。 */
  markdown: string | null
  assets: readonly ImageAssetRecord[]
  tasks: readonly TransferTask[]
  settings: ImageSettings
  paths: ImageDataPaths
  typoraPreferences: TyporaImagePreferences
  cacheUsage?: { fileCount: number; totalBytes: number } | null
}

const MAX_ROWS = 100

export const IMAGE_LIBRARY_VIEWS: ReadonlyArray<Pick<ImageLibraryView, 'id' | 'title' | 'description'>> = [
  {
    id: 'document',
    title: '当前文档',
    description: '逐条列出本文档的图片引用与可用性；不修改引用。',
  },
  {
    id: 'local-library',
    title: '本地图库',
    description: '项目 / 图库 / 离线工作副本中的永久本地位置。',
  },
  {
    id: 'cloud-library',
    title: '云端图库',
    description: '已记录的上传位置；不联网探测，断网时仍按历史记录展示。',
  },
  {
    id: 'tasks-diagnostics',
    title: '任务与诊断',
    description: '传输任务状态、上传服务、Typora 插入方式与配置提示。',
  },
]

function truncateValue(value: string, max = 80): string {
  const trimmed = value.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${Math.max(0, Math.round(bytes / 1024))} KB`
}

function isPermanentLocal(location: AssetLocationRecord): boolean {
  return location.type === 'project' || location.type === 'library' || location.type === 'offline'
}

function statusForAvailability(availability: AssetLocationRecord['availability']): ImageLibraryRowStatus {
  if (availability === 'available') return 'available'
  if (availability === 'missing') return 'missing'
  return 'unknown'
}

function withOverflowNote(rows: ImageLibraryCenterRow[], total: number): { rows: ImageLibraryCenterRow[]; note: string } {
  if (total <= MAX_ROWS) return { rows, note: '' }
  return {
    rows: rows.slice(0, MAX_ROWS),
    note: `仅显示前 ${MAX_ROWS} 条（共 ${total} 条）`,
  }
}

function buildDocumentView(input: ImageLibraryCenterInput): ImageLibraryView {
  const definition = IMAGE_LIBRARY_VIEWS[0]
  if (!input.documentPath || input.markdown === null) {
    return {
      ...definition,
      summary: '未打开可读取的文档',
      emptyMessage: '打开一个 Markdown 文档后，这里会列出它的图片引用。',
      rows: [],
    }
  }

  const references = parseMarkdownImageReferences(input.markdown, input.documentPath)
  const rows: ImageLibraryCenterRow[] = references.map(reference => {
    const asset = reference.assetId
      ? input.assets.find(item => item.assetId === reference.assetId) ?? null
      : null
    const target = reference.resolved.remoteUrl ?? reference.resolved.decoded ?? reference.rawDestination
    if (!asset) {
      // 没有索引记录时无法判断真实可用性：只展示引用事实，不谎称可用或缺失。
      return {
        primary: truncateValue(reference.altText ? `${reference.altText} → ${target}` : target),
        secondary: `第 ${reference.startLine} 行 · 未索引`,
        status: 'unknown',
      }
    }
    const state = resolveReferenceState(reference.resolved, asset.locations)
    const status: ImageLibraryRowStatus = state.displayState === 'unavailable' || state.displayState === 'cache-only'
      ? 'missing'
      : state.displayState === 'non-file'
        ? 'unknown'
        : 'available'
    return {
      primary: truncateValue(reference.altText ? `${reference.altText} → ${target}` : target),
      secondary: `第 ${reference.startLine} 行 · ${state.displayState}`,
      status,
    }
  })
  const limited = withOverflowNote(rows, rows.length)
  const available = rows.filter(row => row.status === 'available').length
  return {
    ...definition,
    summary: `${rows.length} 条引用 · ${available} 条可用${limited.note ? ` · ${limited.note}` : ''}`,
    emptyMessage: '该文档没有图片引用。',
    rows: limited.rows,
  }
}

function formatCheckedAt(value: string | null): string {
  if (!value) return ''
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value)
  return match ? ` · 校验于 ${match[1]} ${match[2]}` : ''
}

function describeLocation(location: AssetLocationRecord): string {
  if (location.type === 'github') {
    const version = location.remoteVersion ? ` · ${truncateValue(location.remoteVersion, 16)}` : ''
    return `github · ${location.remoteProfileId ?? ''} · ${location.remoteBranch ?? ''}`
      + ` · ${truncateValue(location.remotePath ?? location.locator)}${version}${formatCheckedAt(location.lastCheckedAt)}`
  }
  return `${location.type} · ${truncateValue(location.locator)}${formatCheckedAt(location.lastCheckedAt)}`
}

function buildLocationView(
  definition: Pick<ImageLibraryView, 'id' | 'title' | 'description'>,
  input: ImageLibraryCenterInput,
  predicate: (location: AssetLocationRecord) => boolean,
  emptyMessage: string,
): ImageLibraryView {
  const entries: ImageLibraryCenterRow[] = []
  for (const asset of input.assets) {
    for (const location of asset.locations) {
      if (!predicate(location)) continue
      entries.push({
        primary: asset.filename,
        secondary: describeLocation(location),
        status: statusForAvailability(location.availability),
      })
    }
  }
  const limited = withOverflowNote(entries, entries.length)
  return {
    ...definition,
    summary: `${entries.length} 个位置${limited.note ? ` · ${limited.note}` : ''}`,
    emptyMessage,
    rows: limited.rows,
  }
}

function buildTasksDiagnosticsView(input: ImageLibraryCenterInput): ImageLibraryView {
  const definition = IMAGE_LIBRARY_VIEWS[3]
  const taskRows: ImageLibraryCenterRow[] = input.tasks.map(task => ({
    primary: `${task.kind} · ${task.assetId}`,
    secondary: `已尝试 ${task.attempt}/${task.maxAttempts} 次`
      + `${task.resultKind ? ` · ${task.resultKind}` : ''}`
      + `${task.errorCode ? ` · ${task.errorCode}` : ''}`,
    status: task.status,
  }))

  const conflict = detectUploadServiceConflict({
    uploadService: input.settings.uploadService,
    preferences: input.typoraPreferences,
  })
  const diagnostics: ImageLibraryCenterRow[] = [
    {
      primary: `上传服务：${input.settings.uploadService === 'none' ? '无' : 'GitHub'}`,
      secondary: conflict.hasConflict ? '与 Typora「上传图片」冲突' : null,
      status: conflict.hasConflict ? 'failed' : 'info',
    },
    {
      primary: `Typora 插入方式：${input.typoraPreferences.insertMode === 'upload'
        ? '上传图片'
        : input.typoraPreferences.insertMode === 'local'
          ? '本地复制'
          : '未知'}`,
      secondary: input.typoraPreferences.uploader,
      status: 'info',
    },
  ]
  if (conflict.message) {
    diagnostics.push({ primary: conflict.message, secondary: null, status: 'failed' })
  }

  diagnostics.push(
    {
      primary: `图库目录：${input.settings.globalLibrary.mode === 'off' ? '未启用' : input.paths.libraryRoot ?? '未选择'}`,
      secondary: `来源 ${input.paths.sources.library}`,
      status: 'info',
    },
    {
      primary: `缓存目录：${input.paths.cacheRoot ?? '已关闭'}`,
      secondary: input.cacheUsage
        ? `${formatBytes(input.cacheUsage.totalBytes)} · ${input.cacheUsage.fileCount} 个文件`
        : null,
      status: 'info',
    },
    {
      primary: `离线资源目录：${input.paths.offlineRoot}`,
      secondary: null,
      status: 'info',
    },
  )

  const pending = input.tasks.filter(task => task.status === 'queued' || task.status === 'running').length
  const failed = input.tasks.filter(task => task.status === 'failed').length
  return {
    ...definition,
    summary: `${pending} 个进行中 · ${failed} 个失败 · ${input.tasks.length} 条任务记录`,
    emptyMessage: '暂无传输任务；诊断信息仍会显示在上方。',
    rows: [...diagnostics, ...taskRows],
  }
}

/** 构建四个只读视图；调用方决定渲染顺序与折叠方式。 */
export function buildImageLibraryCenter(input: ImageLibraryCenterInput): ImageLibraryView[] {
  return [
    buildDocumentView(input),
    buildLocationView(IMAGE_LIBRARY_VIEWS[1], input, isPermanentLocal, '尚无永久本地位置。'),
    buildLocationView(IMAGE_LIBRARY_VIEWS[2], input, location => location.type === 'github', '尚无云端位置记录。'),
    buildTasksDiagnosticsView(input),
  ]
}
