/**
 * 上传结果校验与插入方式冲突提示（P10-B）。
 *
 * 两个必须坚持的约束：
 * 1. PicGo 失败时可能**不抛异常**，而是返回空数组或空 URL。因此成功与否
 *    只认「可解析、可公开访问的 http(s) URL」，绝不据进程退出码或日志判断。
 * 2. Typora 插入方式为「上传图片」而墨章上传服务为 `none` 时，必须显式提示，
 *    不能静默把图片当作已上传（更不能删除源文件）。
 */

import { validateRemoteImageUrl } from './image-remote-url'
import type { ImageUploadService } from './image-settings'

export type ImageUploadErrorCode =
  | 'UPLOAD_SERVICE_NONE'
  | 'REMOTE_PROFILE_MISSING'
  | 'REMOTE_PATH_INVALID'
  | 'FILE_NOT_FOUND'
  | 'FILE_NOT_READABLE'
  | 'REMOTE_URL_NOT_LOCAL_FILE'
  | 'STAGING_FAILED'
  | 'CREDENTIAL_MISSING'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'CREDENTIAL_READ_FAILED'
  | 'REMOTE_BRANCH_UNRESOLVED'
  | 'PICGO_UNAVAILABLE'
  | 'PICGO_CONFIG_MISSING'
  | 'PICGO_CONFIG_WRITE_FAILED'
  | 'PICGO_TOKEN_INJECTION_UNSUPPORTED'
  | 'PICGO_EMPTY_RESULT'
  | 'PICGO_INVALID_URL'
  | 'INDEX_WRITE_FAILED'

export interface UploadSuccess {
  ok: true
  url: string
}

export interface UploadFailure {
  ok: false
  errorCode: ImageUploadErrorCode
}

export type UploadOutcome = UploadSuccess | UploadFailure

/**
 * 从 PicGo 返回值中提取真实 URL。
 *
 * 兼容 PicGo 的 `IImgInfo`（`imgUrl`）与旧字段 `url`；只接受第一个通过
 * 安全校验的 URL，空数组/空字符串/本地路径/私网地址一律判失败。
 */
export function evaluatePicGoResult(output: unknown): UploadOutcome {
  if (!Array.isArray(output) || output.length === 0) {
    return { ok: false, errorCode: 'PICGO_EMPTY_RESULT' }
  }
  let sawCandidate = false
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const record = item as { imgUrl?: unknown; url?: unknown }
    const candidate = typeof record.imgUrl === 'string'
      ? record.imgUrl
      : typeof record.url === 'string'
        ? record.url
        : ''
    if (!candidate.trim()) continue
    sawCandidate = true
    const validation = validateRemoteImageUrl(candidate.trim())
    if (validation.ok && validation.normalized) {
      return { ok: true, url: validation.normalized }
    }
  }
  // 只要存在候选但全部非法就报 INVALID_URL；完全没有候选才算空结果。
  return { ok: false, errorCode: sawCandidate ? 'PICGO_INVALID_URL' : 'PICGO_EMPTY_RESULT' }
}

/** 把异常映射为稳定错误码，绝不把响应正文或凭据写入日志。 */
export function classifyUploadThrownError(error: unknown): ImageUploadErrorCode {
  const message = error instanceof Error ? error.message : String(error)
  const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : ''
  if (code === 'FILE_NOT_FOUND' || code === 'ENOENT' || /ENOENT|file not found/i.test(message)) {
    return 'FILE_NOT_FOUND'
  }
  if (code === 'FILE_NOT_READABLE' || code === 'EACCES' || code === 'EPERM' || code === 'EISDIR'
    || /EACCES|EPERM|EISDIR|not a regular file|read failed/i.test(message)) {
    return 'FILE_NOT_READABLE'
  }
  return 'PICGO_UNAVAILABLE'
}

export type TyporaImageInsertMode = 'upload' | 'local' | 'unknown'

export interface TyporaImagePreferences {
  insertMode: TyporaImageInsertMode
  uploader: string | null
}

/**
 * 解析 Typora 的 `profile.data`。
 *
 * 该文件是「十六进制编码的 JSON」（实测于 Typora 1.6.7），也兼容直接传 JSON。
 * `image_save_location = "ipic"` 对应「上传图片」；其余值按本地复制处理；
 * 缺失或无法解析时返回 `unknown`，调用方不得据此做破坏性动作。
 */
export function parseTyporaImagePreferences(raw: string | null | undefined): TyporaImagePreferences {
  const fallback: TyporaImagePreferences = { insertMode: 'unknown', uploader: null }
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  if (!trimmed) return fallback

  let json = trimmed
  if (!trimmed.startsWith('{')) {
    if (!/^[0-9a-f]+$/i.test(trimmed) || trimmed.length % 2 !== 0) return fallback
    try {
      json = Buffer.from(trimmed, 'hex').toString('utf8')
    } catch {
      return fallback
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return fallback
  }
  if (!parsed || typeof parsed !== 'object') return fallback
  const record = parsed as { image_save_location?: unknown; image_uploader?: unknown }
  const uploader = typeof record.image_uploader === 'string' && record.image_uploader.trim()
    ? record.image_uploader.trim()
    : null
  const location = typeof record.image_save_location === 'string'
    ? record.image_save_location.trim().toLowerCase()
    : ''
  if (!location) return { insertMode: 'unknown', uploader }
  return { insertMode: location === 'ipic' ? 'upload' : 'local', uploader }
}

export interface UploadConflictInput {
  uploadService: ImageUploadService
  preferences: TyporaImagePreferences
}

export interface UploadConflictResult {
  hasConflict: boolean
  message: string | null
}

export const UPLOAD_CONFLICT_MESSAGE =
  'Typora 当前插入方式为「上传图片」，但墨章上传服务为「无」：'
  + '粘贴或拖入的图片不会由墨章上传，也不会新增远程链接（Typora 原生行为不变）。'
  + '如需上传，请在「设置 → 墨章 · 图片」启用 GitHub 上传服务；'
  + '否则建议把 Typora 插入方式改为本地复制，避免误以为图片已在云端。'

/** 仅在「上传图片」+ `none` 时返回提示；其他组合保持静默。 */
export function detectUploadServiceConflict(input: UploadConflictInput): UploadConflictResult {
  if (input.uploadService !== 'none') return { hasConflict: false, message: null }
  if (input.preferences.insertMode !== 'upload') return { hasConflict: false, message: null }
  return { hasConflict: true, message: UPLOAD_CONFLICT_MESSAGE }
}
