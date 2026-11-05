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
import type { ReuseResultKind } from './image-asset-model'
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
  findRemoteContentBySha256,
  isRemoteUrlForProfile,
  listRemoteImageEntries,
  readRemoteFileVersion,
  buildRemoteImageUrl,
  type RemoteDirectoryIndex,
} from './image-remote-index'
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
  /**
   * 上传前扫描目标目录，复用远端同内容图片。默认开启；
   * 扫描失败或结果不完整时**不会**据此断言“远端没有重复”，而是继续上传。
   */
  remoteIndexEnabled?: boolean
  /** 远程目录索引缓存有效期；默认 5 分钟。 */
  remoteIndexTtlMs?: number
  now?: () => Date
}

export interface UploadLocalFileInput {
  filePath: string
  /** 仅作为资产元数据与扩展名来源，不参与远端命名。 */
  originalFilename?: string
  strategy?: ImageNamingStrategy
}

/** 复用依据：本地索引记录 / 远程内容扫描 / 本次新上传。 */
export type UploadReuseVerification = 'INDEX_RECORD' | 'REMOTE_CONTENT' | 'NEW_UPLOAD'

export interface UploadLocalFileSuccess {
  ok: true
  url: string
  assetId: string
  remotePath: string
  taskId: string | null
  /** 复用远端已有图片，还是本次真的发生了一次上传。 */
  resultKind: Extract<ReuseResultKind, 'REUSED_REMOTE' | 'UPLOADED_NEW'>
  /** 实际网络写入次数：复用为 0，新上传为 1。 */
  uploadTransfers: number
  verification: UploadReuseVerification
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
  PICGO_UPLOAD_FAILED: 'PicGo 上传失败；源文件保持不变。',
  PICGO_INVALID_URL: 'PicGo 返回的 URL 非法或不可公开访问，按失败处理；源文件保持不变。',
  INDEX_WRITE_FAILED: '资产索引写入失败，请检查数据目录权限；源文件保持不变。',
}

function failure(
  errorCode: ImageUploadErrorCode,
  assetId: string | null = null,
  taskId: string | null = null,
  detail?: string,
): UploadLocalFileFailure {
  const suffix = detail ? `（${detail}）` : ''
  return { ok: false, errorCode, message: ERROR_MESSAGES[errorCode] + suffix, assetId, taskId }
}

/** 远端复用命中：URL 已被内容哈希或本机上传记录证明对应同一内容版本。 */
interface RemoteReuseHit {
  url: string
  remotePath: string
  remoteVersion: string | null
  verification: Extract<UploadReuseVerification, 'INDEX_RECORD' | 'REMOTE_CONTENT'>
}

/** 历史位置必须仍位于当前配置的上传目录内，避免仓库目录改动后错误复用。 */
function isRemotePathInDirectory(remotePath: string | null, directory: string): boolean {
  if (!remotePath) return false
  const dir = directory.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!dir) return true
  return remotePath.replace(/\\/g, '/').startsWith(`${dir}/`)
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
  // Typora 渲染进程没有可用的全局 `require`，但暴露了 Node 模块加载器
  // `reqnode`（框架其它模块也用它加载 Node 内置模块）。直接调用裸 `require`
  // 会让 esbuild 在 ESM 产物里插入 dynamic require 兼容层，破坏构造期门禁。
  const globals = globalThis as { reqnode?: unknown; require?: unknown }
  const nodeRequire = typeof globals.reqnode === 'function'
    ? globals.reqnode as (id: string) => unknown
    : typeof globals.require === 'function'
      ? globals.require as (id: string) => unknown
      : null
  if (!nodeRequire) return null
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
  /** 同内容 + 同目标位置的并发上传合并为一次真实写入。 */
  private readonly inFlight = new Map<string, Promise<UploadLocalFileResult>>()
  private readonly remoteIndexCache = new Map<string, { fetchedAt: number; index: RemoteDirectoryIndex }>()
  private readonly remoteIndexEnabled: boolean
  private readonly remoteIndexTtlMs: number

  constructor(private readonly options: ImageUploadServiceOptions) {
    this.picgoConfigPath = options.picgoConfigPath
      ?? path.join(options.paths.dataRoot, 'picgo', 'config.json')
    const appData = process.env.APPDATA?.trim()
    // 没有 APPDATA（非 Windows 或受限环境）时留空，读取侧直接返回 unknown，
    // 避免把相对路径 `Typora/profile.data` 误当作用户配置。
    this.typoraProfilePath = options.typoraProfilePath
      ?? (appData ? path.join(appData, 'Typora', 'profile.data') : '')
    this.loadPicGo = options.loadPicGo ?? defaultPicGoLoader
    this.remoteIndexEnabled = options.remoteIndexEnabled !== false
    this.remoteIndexTtlMs = Math.max(0, options.remoteIndexTtlMs ?? 5 * 60 * 1000)
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

    const branch = await this.resolveUploadBranch(profile, credential.secret)
    if (!branch) return failure('REMOTE_BRANCH_UNRESOLVED')

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
    if (!remotePath) return failure('REMOTE_PATH_INVALID')

    // 同一内容版本 + 同一目标仓库/分支/路径：并发任务只允许一条真实写入。
    const key = [digest.sha256, profile.remoteProfileId, branch, remotePath].join('|')
    const running = this.inFlight.get(key)
    if (running) return running
    const task = this.executeUpload({
      input,
      profile,
      token: credential.secret,
      branch,
      digest,
      originalFilename,
      fileName,
      remotePath,
    }).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, task)
    return task
  }

  private async executeUpload(params: {
    input: UploadLocalFileInput
    profile: ImageRemoteProfile
    token: string
    branch: string
    digest: { sha256: string; sizeBytes: number }
    originalFilename: string
    fileName: string
    remotePath: string
  }): Promise<UploadLocalFileResult> {
    let token = params.token
    const input = params.input
    const { profile, branch, digest, originalFilename, fileName, remotePath } = params

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

      // D2：先查找目标仓库/分支里是否已有同一内容版本。
      // 命中则零上传直接复用；未命中或无法验证才继续真实上传。
      let reuse: RemoteReuseHit | null = null
      try {
        reuse = await this.findReusableRemote({
          profile,
          branch,
          token,
          sha256: digest.sha256,
          sizeBytes: digest.sizeBytes,
          remotePath,
        })
      } catch {
        reuse = null
      }
      if (reuse) {
        let locationId: string | null = null
        if (this.options.tasks) {
          try {
            const task = await this.options.tasks.enqueue({ kind: 'upload', assetId })
            taskId = task.taskId
          } catch {
            taskId = null
          }
        }
        try {
          const updated = await this.options.assets.recordRemoteLocation({
            assetId,
            remoteProfileId: profile.remoteProfileId,
            branch,
            remotePath: reuse.remotePath,
            remoteUrl: reuse.url,
            remoteVersion: reuse.remoteVersion,
            availability: 'available',
          })
          locationId = updated.locations.find(item => item.locator === reuse?.url)?.locationId ?? null
        } catch { /* 复用结论已成立；索引写入失败只影响后续复用线索 */ }
        if (taskId && this.options.tasks) {
          try {
            await this.options.tasks.update(taskId, {
              status: 'succeeded',
              attempt: 0,
              locationId,
              resultKind: 'REUSED_REMOTE',
            })
          } catch { /* 任务记录失败不影响复用结果 */ }
        }
        return {
          ok: true,
          url: reuse.url,
          assetId,
          remotePath: reuse.remotePath,
          taskId,
          resultKind: 'REUSED_REMOTE',
          uploadTransfers: 0,
          verification: reuse.verification,
        }
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
        if (!outcome.ok) {
          // PicGo 3.x 失败时返回 Error；detail 只做展示，必须先把 Token 擦掉。
          const detail = outcome.detail
            ? (token ? outcome.detail.split(token).join('***') : outcome.detail)
            : undefined
          return this.failWithTask(outcome.errorCode, assetId, taskId, detail)
        }

        // 记录远端对象版本（Git blob SHA，不等于内容 SHA-256），供下次轻量校验。
        let remoteVersion: string | null = null
        if (this.remoteIndexEnabled) {
          const request = this.options.githubRequest ?? defaultGitHubRequester
          const version = await readRemoteFileVersion({ request, token, profile, branch }, remotePath)
          remoteVersion = version?.gitSha ?? null
        }
        this.remoteIndexCache.delete(this.remoteIndexCacheKey(profile, branch))

        let location: ImageAssetRecord
        try {
          location = await this.options.assets.recordRemoteLocation({
            assetId,
            remoteProfileId: profile.remoteProfileId,
            branch,
            remotePath,
            remoteUrl: outcome.url,
            remoteVersion,
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
              resultKind: 'UPLOADED_NEW',
            })
          } catch { /* 任务记录失败不影响上传结果 */ }
        }
        return {
          ok: true,
          url: outcome.url,
          assetId,
          remotePath,
          taskId,
          resultKind: 'UPLOADED_NEW',
          uploadTransfers: 1,
          verification: 'NEW_UPLOAD',
        }
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error)
        const detail = raw.slice(0, 200)
        const safe = token ? detail.split(token).join('***') : detail
        return this.failWithTask(classifyUploadThrownError(error), assetId, taskId, safe)
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

  /**
   * 查找目标仓库/分支中与当前内容版本一致的远程图片。
   *
   * 顺序：
   * 1. 本机索引中由墨章历史上传记录下来的位置（local SHA-256 + 上传结果）；
   * 2. 目标目录的远程索引 + 候选内容 SHA-256 验证（覆盖其它工具上传的文件）。
   * 无法证明一致时返回 null，绝不把“未找到”说成“已存在”。
   */
  private async findReusableRemote(input: {
    profile: ImageRemoteProfile
    branch: string
    token: string
    sha256: string
    sizeBytes: number
    remotePath: string
  }): Promise<RemoteReuseHit | null> {
    let assets: ImageAssetRecord[] = []
    try {
      assets = await this.options.assets.list()
    } catch {
      assets = []
    }
    for (const asset of assets) {
      if (asset.sha256 !== input.sha256) continue
      const location = asset.locations.find(item => item.type === 'github'
        && item.remoteProfileId === input.profile.remoteProfileId
        && item.remoteBranch === input.branch
        && item.availability === 'available'
        && !!item.locator
        && isRemoteUrlForProfile(item.locator, input.profile)
        && isRemotePathInDirectory(item.remotePath, input.profile.remoteDirectory))
      if (location) {
        return {
          url: location.locator,
          remotePath: location.remotePath || input.remotePath,
          remoteVersion: location.remoteVersion,
          verification: 'INDEX_RECORD',
        }
      }
    }

    if (!this.remoteIndexEnabled) return null
    const index = await this.loadRemoteIndex(input.profile, input.branch, input.token)
    if (!index.ok || index.entries.length === 0) return null

    const request = this.options.githubRequest ?? defaultGitHubRequester
    const match = await findRemoteContentBySha256({
      request,
      token: input.token,
      profile: input.profile,
      branch: input.branch,
      entries: index.entries,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
    })
    if (!match) return null
    const url = buildRemoteImageUrl({
      profile: input.profile,
      branch: input.branch,
      path: match.path,
    })
    if (!url) return null
    return {
      url,
      remotePath: match.path,
      remoteVersion: match.gitSha,
      verification: 'REMOTE_CONTENT',
    }
  }

  private remoteIndexCacheKey(profile: ImageRemoteProfile, branch: string): string {
    return [profile.remoteProfileId, branch, profile.remoteDirectory].join('|')
  }

  /** 目录索引按 TTL 缓存；失败结果不缓存，下次上传重新尝试。 */
  private async loadRemoteIndex(
    profile: ImageRemoteProfile,
    branch: string,
    token: string,
  ): Promise<RemoteDirectoryIndex> {
    const key = this.remoteIndexCacheKey(profile, branch)
    const cached = this.remoteIndexCache.get(key)
    const now = Date.now()
    if (cached && now - cached.fetchedAt < this.remoteIndexTtlMs) return cached.index
    const request = this.options.githubRequest ?? defaultGitHubRequester
    const index = await listRemoteImageEntries({
      request,
      token,
      profile,
      branch,
      directory: profile.remoteDirectory,
    })
    if (index.ok) this.remoteIndexCache.set(key, { fetchedAt: now, index })
    return index
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
    // PicGo 3.x 的顶层 `uploader` 是对象（`{ github: { configList, defaultId } }`）。
    // 覆盖成字符串会破坏其 uploader 配置读取，只在缺失或旧版字符串形态时写入。
    existing.uploader = existing.uploader
      && typeof existing.uploader === 'object'
      && !Array.isArray(existing.uploader)
      ? existing.uploader
      : 'github'
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
    detail?: string,
  ): Promise<UploadLocalFileFailure> {
    if (taskId && this.options.tasks) {
      try {
        await this.options.tasks.update(taskId, {
          status: 'failed',
          errorCode,
          attempt: 1,
          errorDetail: detail ?? null,
        })
      } catch { /* 任务写入失败不应掩盖原始上传错误 */ }
    }
    return failure(errorCode, assetId, taskId, detail)
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
