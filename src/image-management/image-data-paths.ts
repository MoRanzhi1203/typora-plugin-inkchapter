/**
 * 图片数据路径解析（P2 建立，P3 扩展为五类独立路径）。
 *
 * 公开默认一律为「空字符串 → 运行时解析系统目录」，绝不把某台机器的
 * 盘符或展开路径写进仓库。解析阶段只计算路径，不创建目录。
 *
 * 持久化格式选择 JSON 原子写（临时文件 + rename），不引入 SQLite：
 * 现有 Electron 运行时未验证原生模块 ABI，升级/编译风险高于收益。
 */

import * as os from 'os'
import * as path from 'path'
import {
  DEFAULT_IMAGE_SETTINGS,
  type ImageSettings,
} from './image-settings'

export type ImagePathSource = 'default' | 'override' | 'disabled'
export type ImagePathRole = 'library' | 'cache' | 'offline' | 'staging' | 'database'

export interface ImagePathEnvironment {
  localAppData: string
  tempDir: string
}

export interface ImageDataPaths {
  /** 插件私有数据根（资产库默认位置）。 */
  dataRoot: string
  assetIndexFile: string
  backupDir: string
  /** `null` 表示关闭或未选择物理目录。 */
  libraryRoot: string | null
  libraryImagesDir: string | null
  /** `null` 表示缓存关闭。 */
  cacheRoot: string | null
  cacheObjectsDir: string | null
  thumbnailsDir: string | null
  offlineRoot: string
  offlineObjectsDir: string
  offlineManifestsDir: string
  stagingRoot: string
  databaseRoot: string
  sources: Record<ImagePathRole, ImagePathSource>
}

export interface ResolveImageDataPathsOptions {
  settings?: Pick<
    ImageSettings,
    'globalLibrary' | 'cache' | 'offline' | 'uploadStaging' | 'database'
  >
  env?: Partial<ImagePathEnvironment>
}

/** 从进程环境读取系统目录；缺失时退回到 Node 的通用目录。 */
export function readImagePathEnvironment(env: NodeJS.ProcessEnv = process.env): ImagePathEnvironment {
  const localAppData = env.LOCALAPPDATA?.trim()
    || path.join(os.homedir(), 'AppData', 'Local')
  const tempDir = env.TEMP?.trim() || env.TMP?.trim() || os.tmpdir()
  return { localAppData, tempDir }
}

export function resolveImageDataPaths(
  pluginDataPath: string,
  options: ResolveImageDataPathsOptions = {},
): ImageDataPaths {
  const trimmed = typeof pluginDataPath === 'string' ? pluginDataPath.trim() : ''
  if (!trimmed) throw new Error('plugin data path is empty')

  const settings = options.settings ?? {
    globalLibrary: DEFAULT_IMAGE_SETTINGS.globalLibrary,
    cache: DEFAULT_IMAGE_SETTINGS.cache,
    offline: DEFAULT_IMAGE_SETTINGS.offline,
    uploadStaging: DEFAULT_IMAGE_SETTINGS.uploadStaging,
    database: DEFAULT_IMAGE_SETTINGS.database,
  }
  const environment = { ...readImagePathEnvironment(), ...options.env }

  const dataRoot = path.join(trimmed, 'image')
  const assetIndexFile = path.join(dataRoot, 'image-assets.json')
  const backupDir = path.join(dataRoot, 'backup')

  const libraryConfigured = settings.globalLibrary.mode !== 'off'
  const libraryRoot = libraryConfigured && settings.globalLibrary.root
    ? settings.globalLibrary.root
    : null
  const libraryImagesDir = libraryRoot ? path.join(libraryRoot, 'images') : null

  const cacheEnabled = settings.cache.mode !== 'off'
  const cacheRoot = cacheEnabled
    ? settings.cache.root || path.join(environment.localAppData, 'InkChapter', 'ImageCache')
    : null
  const cacheObjectsDir = cacheRoot ? path.join(cacheRoot, 'objects') : null
  const thumbnailsDir = cacheRoot ? path.join(cacheRoot, 'thumbnails') : null

  const offlineRoot = settings.offline.root
    || path.join(environment.localAppData, 'InkChapter', 'OfflineAssets')
  const offlineObjectsDir = path.join(offlineRoot, 'objects')
  const offlineManifestsDir = path.join(offlineRoot, 'manifests')

  const stagingRoot = settings.uploadStaging.root
    || path.join(environment.tempDir, 'InkChapter', 'ImageUpload')

  const databaseRoot = settings.database.root || dataRoot

  return {
    dataRoot,
    assetIndexFile,
    backupDir,
    libraryRoot,
    libraryImagesDir,
    cacheRoot,
    cacheObjectsDir,
    thumbnailsDir,
    offlineRoot,
    offlineObjectsDir,
    offlineManifestsDir,
    stagingRoot,
    databaseRoot,
    sources: {
      library: libraryConfigured ? (settings.globalLibrary.root ? 'override' : 'default') : 'disabled',
      cache: cacheEnabled ? (settings.cache.root ? 'override' : 'default') : 'disabled',
      offline: settings.offline.root ? 'override' : 'default',
      staging: settings.uploadStaging.root ? 'override' : 'default',
      database: settings.database.root ? 'override' : 'default',
    },
  }
}
