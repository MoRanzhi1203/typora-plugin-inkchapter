/**
 * 墨章侧上传适配器（P10-B）。
 *
 * 与 Typora 原生 PicGo 链路的区别：
 * - 走 PicGo 的**编程 API**，不启动未隔离的 CLI 进程；
 * - 配置固定为插件私有路径（`<dataRoot>/picgo/config.json`），不读写用户全局
 *   `~/.picgo/config.json`，也不把 Token 复制进插件设置；
 * - 上传前把文件复制到暂存目录并改成安全名，原始文件与源文件名保持不变；
 * - 只采信 PicGo 返回的真实 URL；失败时保留源文件，仅记录错误码。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type { ImageAssetService } from './image-asset-service'
import { sha256File } from './image-asset-index'
import type { ImageDataPaths } from './image-data-paths'
import type { ImageNamingStrategy, ImageSettings } from './image-settings'
import type { ImageTransferTaskStore } from './image-transfer-task-store'
import {
  classifyUploadThrownError,
  detectUploadServiceConflict,
  evaluatePicGoResult,
  parseTyporaImagePreferences,
  type ImageUploadErrorCode,
  type TyporaImagePreferences,
  type UploadConflictResult,
} from './image-upload-policy'
import { buildUploadFileName, joinRemotePath } from './image-upload-naming'

/** PicGo 实例的最小接口；只声明本适配器用到的能力，避免 `any`。 */
export interface PicGoInstanceLike {
  upload(files?: string[]): Promise<unknown>
}

export type PicGoConstructorLike = new (configPath?: string) => PicGoInstanceLike

export type PicGoModuleLoader = () => Promise<PicGoConstructorLike>

export interface ImageUploadServiceOptions {
  paths: ImageDataPaths
  assets: ImageAssetService
  readSettings(): ImageSettings
  /** 传输任务持久化；缺省时不写任务，但仍执行上传。 */
  tasks?: ImageTransferTaskStore
  /** 测试注入：默认动态导入 `picgo`。 */
  loadPicGo?: PicGoModuleLoader
  /** 插件私有 PicGo 配置；默认 `<dataRoot>/picgo/config.json`。 */
  picgoConfigPath?: string
  /** Typora `profile.data`；默认 `%APPDATA%/Typora/profile.data`。 */
  typoraProfilePath?: string
  now?: () => Date
}

export interface UploadLocalFileInput {
  filePath: string
  /** 仅作为资产元数据与扩展名来源，不参与远端命名。 */
  originalFilename?: string
  strategy?: ImageNamingStrategy
}

export interface UploadLocalFileSuccess {
  ok: true
  url: string
  assetId: string
  remotePath: string
  taskId: string | null
}

export interface UploadLocalFileFailure {
  ok: false
  errorCode: ImageUploadErrorCode
  message: string
  assetId: string | null
  taskId: string | null
}

export type UploadLocalFileResult = UploadLocalFileSuccess | UploadLocalFileFailure

const ERROR_MESSAGES: Record<ImageUploadErrorCode, string> = {
  UPLOAD_SERVICE_NONE: '上传服务为「无」，未发起上传；源文件保持不变。',
  REMOTE_PROFILE_MISSING: '未找到可用的 GitHub 远程配置，未发起上传。',
  FILE_NOT_FOUND: '源文件不存在，未发起上传。',
  FILE_NOT_READABLE: '源文件不可读，未发起上传。',
  STAGING_FAILED: '暂存副本创建失败，未发起上传；源文件保持不变。',
  PICGO_UNAVAILABLE: 'PicGo 运行环境不可用，未发起上传；源文件保持不变。',
  PICGO_CONFIG_MISSING: '插件私有 PicGo 配置不存在，未发起上传；源文件保持不变。',
  PICGO_EMPTY_RESULT: 'PicGo 未返回可用 URL，按失败处理；源文件保持不变。',
  PICGO_INVALID_URL: 'PicGo 返回的 URL 非法或不可公开访问，按失败处理；源文件保持不变。',
  INDEX_WRITE_FAILED: '上传成功但资产索引写入失败，请检查数据目录权限。',
}

function failure(
  errorCode: ImageUploadErrorCode,
  assetId: string | null = null,
  taskId: string | null = null,
): UploadLocalFileFailure {
  return { ok: false, errorCode, message: ERROR_MESSAGES[errorCode], assetId, taskId }
}

/** 默认加载器：优先显式注入的模块路径，其次裸 `picgo`。 */
export async function defaultPicGoLoader(): Promise<PicGoConstructorLike> {
  const specifier = process.env.INKCHAPTER_PICGO_MODULE?.trim() || 'picgo'
  const imported = await import(/* @vite-ignore */ specifier) as {
    PicGo?: PicGoConstructorLike
    default?: unknown
  }
  if (imported.PicGo) return imported.PicGo
  const fallback = imported.default
  if (typeof fallback === 'function') return fallback as PicGoConstructorLike
  if (fallback && typeof fallback === 'object' && 'PicGo' in fallback) {
    const nested = (fallback as { PicGo?: unknown }).PicGo
    if (typeof nested === 'function') return nested as PicGoConstructorLike
  }
  throw new Error('PicGo constructor not found')
}

export class ImageUploadService {
  private readonly picgoConfigPath: string
  private readonly typoraProfilePath: string
  private readonly loadPicGo: PicGoModuleLoader

  constructor(private readonly options: ImageUploadServiceOptions) {
    this.picgoConfigPath = options.picgoConfigPath
      ?? path.join(options.paths.dataRoot, 'picgo', 'config.json')
    this.typoraProfilePath = options.typoraProfilePath
      ?? path.join(process.env.APPDATA?.trim() || '', 'Typora', 'profile.data')
    this.loadPicGo = options.loadPicGo ?? defaultPicGoLoader
  }

  getPicGoConfigPath(): string {
    return this.picgoConfigPath
  }

  getTyporaProfilePath(): string {
    return this.typoraProfilePath
  }

  /** 只读解析 Typora 首选项；文件缺失或无法解析时返回 `unknown`，不抛错。 */
  async readTyporaImagePreferences(): Promise<TyporaImagePreferences> {
    try {
      const raw = await fs.readFile(this.typoraProfilePath, 'utf8')
      return parseTyporaImagePreferences(raw)
    } catch {
      return { insertMode: 'unknown', uploader: null }
    }
  }

  /** 「上传图片」+ 上传服务 `none` 的显式冲突提示。 */
  async inspectInsertModeConflict(): Promise<UploadConflictResult> {
    const preferences = await this.readTyporaImagePreferences()
    return detectUploadServiceConflict({
      uploadService: this.options.readSettings().uploadService,
      preferences,
    })
  }

  async uploadLocalFile(input: UploadLocalFileInput): Promise<UploadLocalFileResult> {
    const settings = this.options.readSettings()
    if (settings.uploadService !== 'github') return failure('UPLOAD_SERVICE_NONE')
    const profile = this.resolveRemoteProfile(settings)
    if (!profile) return failure('REMOTE_PROFILE_MISSING')

    let digest
    try {
      digest = await sha256File(input.filePath)
    } catch (error) {
      return failure(classifyUploadThrownError(error))
    }

    const originalFilename = input.originalFilename?.trim() || path.basename(input.filePath)
    const fileName = buildUploadFileName({
      sha256: digest.sha256,
      originalFilename,
      strategy: input.strategy ?? settings.namingStrategy,
      now: this.options.now?.() ?? new Date(),
    })
    const remotePath = joinRemotePath(profile.remoteDirectory, fileName)
    if (!remotePath) return failure('STAGING_FAILED')

    let assetId: string | null = null
    let taskId: string | null = null
    let stagedDir: string | null = null

    try {
      try {
        const upserted = await this.options.assets.upsertLocalFile({
          filePath: input.filePath,
          filename: originalFilename,
        })
        assetId = upserted.asset.assetId
      } catch {
        return failure('INDEX_WRITE_FAILED')
      }

      if (this.options.tasks) {
        try {
          const task = await this.options.tasks.enqueue({ kind: 'upload', assetId })
          taskId = task.taskId
          await this.options.tasks.update(task.taskId, { status: 'running' })
        } catch {
          taskId = null
        }
      }

      try {
        await fs.access(this.picgoConfigPath)
      } catch {
        return this.failWithTask('PICGO_CONFIG_MISSING', assetId, taskId)
      }
      try {
        await fs.mkdir(this.options.paths.stagingRoot, { recursive: true })
        stagedDir = await fs.mkdtemp(path.join(this.options.paths.stagingRoot, 'upload-'))
        const stagedPath = path.join(stagedDir, fileName)
        await fs.copyFile(input.filePath, stagedPath)
        const PicGo = await this.loadPicGo()
        const picgo = new PicGo(this.picgoConfigPath)
        const output = await picgo.upload([stagedPath])
        const outcome = evaluatePicGoResult(output)
        if (!outcome.ok) return this.failWithTask(outcome.errorCode, assetId, taskId)

        const location = await this.options.assets.recordRemoteLocation({
          assetId,
          remoteProfileId: profile.remoteProfileId,
          branch: profile.branch,
          remotePath,
          remoteUrl: outcome.url,
          availability: 'available',
        })
        const recorded = location.locations.find(
          item => item.type === 'github' && item.locator === outcome.url,
        )
        if (taskId && this.options.tasks) {
          await this.options.tasks.update(taskId, {
            status: 'succeeded',
            attempt: 1,
            locationId: recorded?.locationId ?? null,
          })
        }
        return { ok: true, url: outcome.url, assetId, remotePath, taskId }
      } catch (error) {
        return this.failWithTask(classifyUploadThrownError(error), assetId, taskId)
      }
    } finally {
      if (stagedDir) {
        try { await fs.rm(stagedDir, { recursive: true, force: true }) } catch { /* 暂存清理失败不影响源文件 */ }
      }
    }
  }

  private async failWithTask(
    errorCode: ImageUploadErrorCode,
    assetId: string | null,
    taskId: string | null,
  ): Promise<UploadLocalFileFailure> {
    if (taskId && this.options.tasks) {
      try {
        await this.options.tasks.update(taskId, { status: 'failed', errorCode })
      } catch { /* 任务写入失败不应掩盖原始上传错误 */ }
    }
    return failure(errorCode, assetId, taskId)
  }

  private resolveRemoteProfile(settings: ImageSettings) {
    const enabled = settings.remoteProfiles.filter(profile => profile.enabled)
    if (settings.defaultRemoteProfileId) {
      const matched = enabled.find(profile => profile.remoteProfileId === settings.defaultRemoteProfileId)
      if (matched) return matched
    }
    return enabled[0] ?? null
  }
}
