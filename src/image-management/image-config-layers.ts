/**
 * 图片配置分层（P7）。
 *
 * 层级：
 * 1. 公开默认：仓库内 DEFAULT_IMAGE_SETTINGS，uploadService = none，所有路径为空。
 * 2. 本机用户配置：插件设置（Git 工作区之外），可覆盖服务、路径与配额。
 * 3. 项目级可共享选项：只允许无隐私、非路径、非凭据的少量字段。
 * 4. 当次操作覆盖：仅对当前任务生效，不写回用户配置。
 *
 * 本模块只做纯函数合并与来源标注，不做 IO。
 */

import {
  DEFAULT_IMAGE_SETTINGS,
  resolveImageSettings,
  type ImageCacheMode,
  type ImageReferenceMode,
  type ImageSettings,
  type ImageUploadService,
} from './image-settings'

export type ImageConfigLayer = 'public-default' | 'user' | 'operation'

export interface ImageOperationOverrides {
  uploadService?: ImageUploadService
  referenceMode?: ImageReferenceMode
  autoUpload?: boolean
  cacheMode?: ImageCacheMode
}

export type EffectiveConfigKey = 'uploadService' | 'referenceMode' | 'autoUpload' | 'cacheMode'

export interface EffectiveImageConfig {
  settings: ImageSettings
  origins: Record<EffectiveConfigKey, ImageConfigLayer>
}

function originOf(
  key: EffectiveConfigKey,
  value: unknown,
  base: ImageSettings,
  overrides: ImageOperationOverrides | undefined,
): ImageConfigLayer {
  const override = overrides?.[key]
  if (override !== undefined && value === override) return 'operation'
  switch (key) {
    case 'uploadService':
      return base.uploadService === DEFAULT_IMAGE_SETTINGS.uploadService ? 'public-default' : 'user'
    case 'referenceMode':
      return base.referenceMode === DEFAULT_IMAGE_SETTINGS.referenceMode ? 'public-default' : 'user'
    case 'autoUpload':
      return base.autoUpload === DEFAULT_IMAGE_SETTINGS.autoUpload ? 'public-default' : 'user'
    case 'cacheMode':
      return base.cache.mode === DEFAULT_IMAGE_SETTINGS.cache.mode ? 'public-default' : 'user'
  }
}

/** 合并用户配置与当次操作覆盖，并标注每个键的最终来源。 */
export function resolveEffectiveImageConfig(
  base: ImageSettings,
  overrides?: ImageOperationOverrides,
): EffectiveImageConfig {
  const merged = resolveImageSettings({
    ...base,
    ...(overrides?.uploadService !== undefined ? { uploadService: overrides.uploadService } : {}),
    ...(overrides?.referenceMode !== undefined ? { referenceMode: overrides.referenceMode } : {}),
    ...(overrides?.autoUpload !== undefined ? { autoUpload: overrides.autoUpload } : {}),
    ...(overrides?.cacheMode !== undefined
      ? { cache: { ...base.cache, mode: overrides.cacheMode } }
      : {}),
  })

  return {
    settings: merged,
    origins: {
      uploadService: originOf('uploadService', merged.uploadService, base, overrides),
      referenceMode: originOf('referenceMode', merged.referenceMode, base, overrides),
      autoUpload: originOf('autoUpload', merged.autoUpload, base, overrides),
      cacheMode: originOf('cacheMode', merged.cache.mode, base, overrides),
    },
  }
}

/**
 * 项目级可共享选项：只允许引用形式与缓存模式。
 * 明确禁止上传凭证、仓库、绝对路径与用户目录。
 */
export interface ProjectImageOptions {
  schemaVersion: 1
  referenceMode?: ImageReferenceMode
  cacheMode?: ImageCacheMode
}

export interface ProjectImageOptionsParseResult {
  ok: boolean
  options: ProjectImageOptions | null
  problems: string[]
}

const ALLOWED_PROJECT_KEYS = new Set(['schemaVersion', 'referenceMode', 'cacheMode'])

export function parseProjectImageOptions(raw: unknown): ProjectImageOptionsParseResult {
  const problems: string[] = []
  if (!raw || typeof raw !== 'object') {
    return { ok: false, options: null, problems: ['NOT_AN_OBJECT'] }
  }
  const input = raw as Partial<ProjectImageOptions> & Record<string, unknown>
  if (input.schemaVersion !== 1) problems.push('SCHEMA_VERSION_UNSUPPORTED')
  for (const key of Object.keys(input)) {
    if (!ALLOWED_PROJECT_KEYS.has(key)) problems.push(`KEY_NOT_ALLOWED:${key}`)
  }
  if (input.referenceMode !== undefined
    && input.referenceMode !== 'local-relative'
    && input.referenceMode !== 'remote-url') {
    problems.push('REFERENCE_MODE_INVALID')
  }
  if (input.cacheMode !== undefined
    && input.cacheMode !== 'off'
    && input.cacheMode !== 'smart'
    && input.cacheMode !== 'manual') {
    problems.push('CACHE_MODE_INVALID')
  }
  if (problems.length > 0) return { ok: false, options: null, problems }
  return {
    ok: true,
    options: {
      schemaVersion: 1,
      ...(input.referenceMode ? { referenceMode: input.referenceMode } : {}),
      ...(input.cacheMode ? { cacheMode: input.cacheMode } : {}),
    },
    problems: [],
  }
}
