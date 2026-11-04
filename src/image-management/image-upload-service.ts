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
import { readFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import type { ImageAssetService } from './image-asset-service'
import { sha256File, type ImageAssetRecord } from './image-asset-index'
import type { ImageDataPaths } from './image-data-paths'
import type { ImageNamingStrategy, ImageRemoteProfile, ImageSettings } from './image-settings'
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
import {
  resolveCredentialReferenceId,
  type ImageCredentialStore,
} from './image-credential-store'
import { defaultGitHubRequester, type GitHubJsonRequester } from './github-connection-test'

/** PicGo 实例的最小接口；只声明本适配器用到的能力，避免 `any`。 */
export interface PicGoInstanceLike {
  upload(files?: string[]): Promise<unknown>
  /** PicGo 3.x：仅写入内存配置，不落盘。缺少时必须拒绝上传。 */
  setConfig?: (config: Record<string, unknown>) => void
  unsetConfig?: (key: string, propName: string) => void
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
  /** 系统安全凭据存储；缺少或不可用时拒绝上传，绝不回退明文。 */
  credentials?: ImageCredentialStore
  /** 测试注入：GitHub API 请求器（仅用于解析空分支的默认分支）。 */
  githubRequest?: GitHubJsonRequester
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
  REMOTE_PATH_INVALID: '远程目录或文件名包含不安全字符，未发起上传；源文件保持不变。',
  FILE_NOT_FOUND: '源文件不存在，未发起上传。',
  FILE_NOT_READABLE: '源文件不可读，未发起上传。',
  REMOTE_URL_NOT_LOCAL_FILE: '收到的是 HTTPS 远程图片地址，不是本地文件；已跳过上传并保留原 URL。',
  STAGING_FAILED: '暂存副本创建失败，未发起上传；源文件保持不变。',
  CREDENTIAL_MISSING: '尚未保存 GitHub Token，未发起上传；请在图片设置中保存 Token。',
  CREDENTIAL_UNAVAILABLE: '系统安全存储不可用，已阻止上传；不会退化为明文保存。',
  CREDENTIAL_READ_FAILED: '无法读取已保存的 GitHub Token，未发起上传；请重新保存 Token。',
  REMOTE_BRANCH_UNRESOLVED: '无法确定目标分支，未发起上传；请填写分支或检查仓库访问权限。',
  PICGO_UNAVAILABLE: 'PicGo 运行环境不可用，未发起上传；源文件保持不变。',
  PICGO_CONFIG_MISSING: '插件私有 PicGo 配置不存在，未发起上传；源文件保持不变。',
  PICGO_CONFIG_WRITE_FAILED: '无法写入插件私有 PicGo 配置，未发起上传；源文件保持不变。',
  PICGO_TOKEN_INJECTION_UNSUPPORTED: '当前 PicGo 版本不支持运行时注入 Token，已阻止上传。',
  PICGO_EMPTY_RESULT: 'PicGo 未返回可用 URL，按失败处理；源文件保持不变。',
  PICGO_INVALID_URL: 'PicGo 返回的 URL 非法或不可公开访问，按失败处理；源文件保持不变。',
  INDEX_WRITE_FAILED: '资产索引写入失败，请检查数据目录权限；源文件保持不变。',
}

function failure(
  errorCode: ImageUploadErrorCode,
  assetId: string | null = null,
  taskId: string | null = null,
): UploadLocalFileFailure {
  return { ok: false, errorCode, message: ERROR_MESSAGES[errorCode], assetId, taskId }
}

/**
 * 把环境变量里的模块标识转换为可被 `import()` 使用的说明符。
 *
 * ESM 动态导入在 Windows 上不接受裸绝对路径（`E:\...`），必须转成
 * `file:///E:/...`；裸包名（`picgo`）与已带协议的说明符保持原样。
 */
export function toPicGoImportSpecifier(raw: string): string {
  const value = raw.trim()
  if (!value) return 'picgo'
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-zA-Z]:[\\/]/.test(value)) return value
  const looksLikePath = /^[a-zA-Z]:[\\/]/.test(value)
    || value.startsWith('\\\\')
    || value.startsWith('.')
    || path.isAbsolute(value)
  return looksLikePath ? pathToFileURL(path.resolve(value)).href : value
}

/** 默认加载器：优先显式注入的模块路径，其次全局安装的 `picgo`。 */
export async function defaultPicGoLoader(): Promise<PicGoConstructorLike> {
  const envSpecifier = process.env.INKCHAPTER_PICGO_MODULE?.trim()
  if (envSpecifier) return importPicGoModule(envSpecifier)

  const failures: string[] = []
  for (const dir of buildPicGoPackageDirs()) {
    // 优先 CJS：PicGo 3.2.0 的 ESM 构建在 Node 24 下会因 lodash 命名导出失败。
    for (const entry of ['dist/index.cjs.js', 'dist/index.esm.js']) {
      const file = path.join(dir, entry)
      try {
        await fs.access(file)
      } catch {
        continue
      }
      try {
        return await importPicGoModule(file)
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
  }
  throw new Error(
    'PicGo module not found. Install picgo globally or set INKCHAPTER_PICGO_MODULE.'
    + (failures.length ? ` (${failures[0]})` : ''),
  )
}

async function importPicGoModule(specifier: string): Promise<PicGoConstructorLike> {
  // 优先 Node 的 require：Electron 渲染进程中的浏览器动态 import 不保证能读
  // `file://` 的 CJS；Typora 提供了全局 require（插件其它模块已在使用）。
  const required = requirePicGoIfAvailable(specifier)
  if (required) return required

  const imported = await import(/* @vite-ignore */ toPicGoImportSpecifier(specifier)) as {
    PicGo?: PicGoConstructorLike
    default?: unknown
  }
  const constructed = extractPicGoConstructor(imported)
  if (constructed) return constructed
  throw new Error('PicGo constructor not found')
}

function extractPicGoConstructor(value: unknown): PicGoConstructorLike | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { PicGo?: unknown; default?: unknown }
  if (typeof record.PicGo === 'function') return record.PicGo as PicGoConstructorLike
  const fallback = record.default
  if (typeof fallback === 'function') return fallback as PicGoConstructorLike
  if (fallback && typeof fallback === 'object' && 'PicGo' in fallback) {
    const nested = (fallback as { PicGo?: unknown }).PicGo
    if (typeof nested === 'function') return nested as PicGoConstructorLike
  }
  return null
}

function requirePicGoIfAvailable(specifier: string): PicGoConstructorLike | null {
  // 通过 globalThis 读取 Typora/Electron 注入的 require：直接调用裸 `require`
  // 会让 esbuild 在 ESM 产物里插入 dynamic require 兼容层，破坏构造期门禁。
  const nodeRequire = (globalThis as { require?: (id: string) => unknown }).require
  if (typeof nodeRequire !== 'function') return null
  const target = /^file:\/\//i.test(specifier)
    ? fileURLToPath(specifier)
    : path.isAbsolute(specifier)
      ? specifier
      : null
  if (!target) return null
  try {
    return extractPicGoConstructor(nodeRequire(target))
  } catch {
    return null
  }
}

export interface PicGoResolveContext {
  env?: NodeJS.ProcessEnv
  homeDir?: string
  /** 测试注入；缺省时读取 `<homeDir>/.npmrc`。 */
  npmrc?: string | null
}

/** 解析 `.npmrc` 中的 `prefix=`（自定义全局安装目录）。 */
export function parseNpmPrefix(npmrc: string | null | undefined): string | null {
  if (typeof npmrc !== 'string' || !npmrc) return null
  for (const line of npmrc.split(/\r?\n/)) {
    const match = /^\s*prefix\s*=\s*(.+?)\s*$/.exec(line)
    if (!match) continue
    const value = match[1].replace(/^["']|["']$/g, '').trim()
    if (value) return value
  }
  return null
}

function readNpmrc(homeDir: string): string | null {
  if (!homeDir) return null
  try {
    return readFileSync(path.join(homeDir, '.npmrc'), 'utf8')
  } catch {
    return null
  }
}

/** 按优先级列出可能包含全局 `picgo` 包的目录；不访问网络。 */
export function buildPicGoPackageDirs(context: PicGoResolveContext = {}): string[] {
  const env = context.env ?? process.env
  const homeDir = context.homeDir ?? env.USERPROFILE?.trim() ?? os.homedir()
  const npmrc = context.npmrc === undefined ? readNpmrc(homeDir) : context.npmrc
  const dirs: string[] = []
  const add = (dir: string | null | undefined) => {
    if (dir && !dirs.includes(dir)) dirs.push(dir)
  }

  const prefix = env.NPM_CONFIG_PREFIX?.trim() || parseNpmPrefix(npmrc)
  add(prefix ? path.join(prefix, 'node_modules', 'picgo') : null)
  add(env.APPDATA?.trim() ? path.join(env.APPDATA.trim(), 'npm', 'node_modules', 'picgo') : null)
  add(env.ProgramFiles?.trim() ? path.join(env.ProgramFiles.trim(), 'nodejs', 'node_modules', 'picgo') : null)
  add(env.NVM_SYMLINK?.trim() ? path.join(env.NVM_SYMLINK.trim(), 'node_modules', 'picgo') : null)
  // 自定义 Node 安装目录通常会在 PATH 中；全局包默认落在 `<nodeDir>\node_modules`。
  const pathValue = env.PATH ?? env.Path ?? ''
  for (const entry of pathValue.split(path.delimiter)) {
    const dir = entry.trim().replace(/^"|"$/g, '')
    if (!dir) continue
    add(path.join(dir, 'node_modules', 'picgo'))
  }
  return dirs
}

export class ImageUploadService {
  private readonly picgoConfigPath: string
  private readonly typoraProfilePath: string
  private readonly loadPicGo: PicGoModuleLoader

  constructor(private readonly options: ImageUploadServiceOptions) {
    this.picgoConfigPath = options.picgoConfigPath
      ?? path.join(options.paths.dataRoot, 'picgo', 'config.json')
    const appData = process.env.APPDATA?.trim()
    // 没有 APPDATA（非 Windows 或受限环境）时留空，读取侧直接返回 unknown，
    // 避免把相对路径 `Typora/profile.data` 误当作用户配置。
    this.typoraProfilePath = options.typoraProfilePath
      ?? (appData ? path.join(appData, 'Typora', 'profile.data') : '')
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
    if (!this.typoraProfilePath) return { insertMode: 'unknown', uploader: null }
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
    // P0: PicGo 只接受本地文件。远程 URL 不得进入 sha256/copyFile/上传链路，
    // 否则会被误映射为 PICGO_UNAVAILABLE，并可能打断 Typora 的图片更新。
    if (/^https?:\/\//i.test(input.filePath.trim())) {
      return failure('REMOTE_URL_NOT_LOCAL_FILE')
    }
    const settings = this.options.readSettings()
    if (settings.uploadService !== 'github') return failure('UPLOAD_SERVICE_NONE')
    const profile = this.resolveRemoteProfile(settings)
    if (!profile) return failure('REMOTE_PROFILE_MISSING')

    const credentials = this.options.credentials
    if (!credentials || credentials.backend === 'unavailable') {
      return failure('CREDENTIAL_UNAVAILABLE')
    }
    const referenceId = resolveCredentialReferenceId(profile)
    const credential = await credentials.read(referenceId)
    if (!credential.ok) {
      if (credential.code === 'CREDENTIAL_NOT_FOUND') return failure('CREDENTIAL_MISSING')
      if (credential.code === 'CREDENTIAL_BACKEND_UNAVAILABLE') return failure('CREDENTIAL_UNAVAILABLE')
      return failure('CREDENTIAL_READ_FAILED')
    }
    let token = credential.secret
    const branch = await this.resolveUploadBranch(profile, token)
    if (!branch) {
      token = ''
      return failure('REMOTE_BRANCH_UNRESOLVED')
    }

    let digest
    try {
      digest = await sha256File(input.filePath)
    } catch (error) {
      token = ''
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
    if (!remotePath) {
      token = ''
      return failure('REMOTE_PATH_INVALID')
    }

    let assetId: string | null = null
    let taskId: string | null = null
    let stagedDir: string | null = null
    let picgo: PicGoInstanceLike | null = null

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
        await this.ensurePicGoBaseConfig(profile, branch)
      } catch {
        return this.failWithTask('PICGO_CONFIG_WRITE_FAILED', assetId, taskId)
      }
      try {
        await fs.mkdir(this.options.paths.stagingRoot, { recursive: true })
        stagedDir = await fs.mkdtemp(path.join(this.options.paths.stagingRoot, 'upload-'))
        const stagedPath = path.join(stagedDir, fileName)
        await fs.copyFile(input.filePath, stagedPath)
        const PicGo = await this.loadPicGo()
        picgo = new PicGo(this.picgoConfigPath)
        if (!picgo.setConfig) {
          return this.failWithTask('PICGO_TOKEN_INJECTION_UNSUPPORTED', assetId, taskId)
        }
        // 仅写入 PicGo 内存配置；不调用 saveConfig，Token 永远不落盘。
        picgo.setConfig({
          // 压掉 PicGo 自身的控制台输出，避免任何配置回显进入 DevTools。
          silent: true,
          'picBed.github.token': token,
          'picBed.github.repo': `${profile.owner}/${profile.repository}`,
          'picBed.github.branch': branch,
          'picBed.github.path': profile.remoteDirectory ? `${profile.remoteDirectory.replace(/\/+$/, '')}/` : '',
          'picBed.github.customUrl': profile.urlStrategy === 'custom' ? profile.customUrlBase : '',
        })
        const output = await picgo.upload([stagedPath])
        const outcome = evaluatePicGoResult(output)
        if (!outcome.ok) return this.failWithTask(outcome.errorCode, assetId, taskId)

        let location: ImageAssetRecord
        try {
          location = await this.options.assets.recordRemoteLocation({
            assetId,
            remoteProfileId: profile.remoteProfileId,
            branch,
            remotePath,
            remoteUrl: outcome.url,
            availability: 'available',
          })
        } catch {
          // 上传已成功但索引写不进去：如实报错，避免下次重复上传或丢失远程位置。
          return this.failWithTask('INDEX_WRITE_FAILED', assetId, taskId)
        }
        const recorded = location.locations.find(
          item => item.type === 'github' && item.locator === outcome.url,
        )
        if (taskId && this.options.tasks) {
          // 任务记录是诊断信息，写入失败不应把已成功的上传判为失败。
          try {
            await this.options.tasks.update(taskId, {
              status: 'succeeded',
              attempt: 1,
              locationId: recorded?.locationId ?? null,
            })
          } catch { /* 任务记录失败不影响上传结果 */ }
        }
        return { ok: true, url: outcome.url, assetId, remotePath, taskId }
      } catch (error) {
        return this.failWithTask(classifyUploadThrownError(error), assetId, taskId)
      }
    } finally {
      // 凭据只活在本次上传的内存中：先清 Token，再丢弃实例与暂存文件。
      if (picgo) {
        try { picgo.unsetConfig?.('picBed.github', 'token') } catch { /* ignore */ }
        try { picgo.setConfig?.({ 'picBed.github.token': '' }) } catch { /* ignore */ }
        picgo = null
      }
      // 防御性兜底：即使第三方上传器调用 saveConfig，也要把落盘 Token 擦掉。
      await this.scrubPicGoConfigToken()
      token = ''
      if (stagedDir) {
        try { await fs.rm(stagedDir, { recursive: true, force: true }) } catch { /* 暂存清理失败不影响源文件 */ }
      }
    }
  }

  /** 空分支时读取仓库真实默认分支；只读 API，不修改仓库。 */
  private async resolveUploadBranch(
    profile: ImageRemoteProfile,
    token: string,
  ): Promise<string | null> {
    const configured = profile.branch.trim()
    if (configured) return configured
    const request = this.options.githubRequest ?? defaultGitHubRequester
    try {
      const response = await request({
        token,
        path: `/repos/${encodeURIComponent(profile.owner)}/${encodeURIComponent(profile.repository)}`,
      })
      if (response.status !== 200) return null
      const body = response.json as { default_branch?: unknown } | null
      const branch = typeof body?.default_branch === 'string' ? body.default_branch.trim() : ''
      return branch || null
    } catch {
      return null
    }
  }

  /** 第三方上传器若把 Token 写回配置，立即移除；失败不影响上传结果。 */
  private async scrubPicGoConfigToken(): Promise<void> {
    try {
      const raw = await fs.readFile(this.picgoConfigPath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      const root = parsed as Record<string, unknown>
      const picBed = root.picBed
      if (!picBed || typeof picBed !== 'object' || Array.isArray(picBed)) return
      const github = (picBed as Record<string, unknown>).github
      if (!github || typeof github !== 'object' || Array.isArray(github)) return
      if (!('token' in github)) return
      delete (github as Record<string, unknown>).token
      const temp = `${this.picgoConfigPath}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(temp, JSON.stringify(root, null, 2) + '\n', 'utf8')
      await fs.rename(temp, this.picgoConfigPath)
    } catch { /* 兜底清理失败不影响上传结果 */ }
  }

  /**
   * 写入**不含 Token** 的 PicGo 基础配置，并保留既有插件字段。
   * 必须在注入 Token 之前完成，避免任何把 Token 持久化的路径。
   */
  private async ensurePicGoBaseConfig(
    profile: ImageRemoteProfile,
    branch: string,
  ): Promise<void> {
    let existing: Record<string, unknown> = {}
    try {
      const raw = await fs.readFile(this.picgoConfigPath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>
      }
    } catch {
      existing = {}
    }

    const picBed = existing.picBed && typeof existing.picBed === 'object' && !Array.isArray(existing.picBed)
      ? existing.picBed as Record<string, unknown>
      : {}
    const github = picBed.github && typeof picBed.github === 'object' && !Array.isArray(picBed.github)
      ? { ...(picBed.github as Record<string, unknown>) }
      : {}
    delete github.token
    Object.assign(github, {
      repo: `${profile.owner}/${profile.repository}`,
      branch,
      path: profile.remoteDirectory ? `${profile.remoteDirectory.replace(/\/+$/, '')}/` : '',
      customUrl: profile.urlStrategy === 'custom' ? profile.customUrlBase : '',
    })
    existing.picBed = { ...picBed, current: 'github', uploader: 'github', github }
    existing.uploader = 'github'
    if (!existing.picgoPlugins || typeof existing.picgoPlugins !== 'object') existing.picgoPlugins = {}

    const temp = `${this.picgoConfigPath}.${process.pid}.${Date.now()}.tmp`
    try {
      await fs.mkdir(path.dirname(this.picgoConfigPath), { recursive: true })
      await fs.writeFile(temp, JSON.stringify(existing, null, 2) + '\n', 'utf8')
      await fs.rename(temp, this.picgoConfigPath)
    } catch (error) {
      try { await fs.rm(temp, { force: true }) } catch { /* ignore */ }
      throw error
    }
  }

  private async failWithTask(
    errorCode: ImageUploadErrorCode,
    assetId: string | null,
    taskId: string | null,
  ): Promise<UploadLocalFileFailure> {
    if (taskId && this.options.tasks) {
      try {
        await this.options.tasks.update(taskId, { status: 'failed', errorCode, attempt: 1 })
      } catch { /* 任务写入失败不应掩盖原始上传错误 */ }
    }
    return failure(errorCode, assetId, taskId)
  }

  private resolveRemoteProfile(settings: ImageSettings) {
    const enabled = settings.remoteProfiles.filter(profile => profile.enabled)
    // 显式默认配置存在时只认它：默认 Profile 被禁用/删除就报缺失，
    // 绝不静默切到另一个仓库，避免把图片传到非预期账号。
    if (settings.defaultRemoteProfileId) {
      return enabled.find(profile => profile.remoteProfileId === settings.defaultRemoteProfileId) ?? null
    }
    return enabled[0] ?? null
  }
}
