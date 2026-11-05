/**
 * 上传远端命名（P10-B）。
 *
 * 背景（P0-LOCAL 实测）：Typora 原生 PicGo 链路直接沿用源文件名，
 * 空格未编码、`#` 会被当作 URL 片段导致扩展名丢失，同名二次上传返回 422。
 * 因此墨章自己的上传适配器必须在**提交前**把文件重命名为安全名：
 *
 * - 只使用 `[a-z0-9-]`、单点分隔的扩展名，杜绝 `#` / `%` / 空格 / 中文路径歧义；
 * - 名字里包含内容哈希短码，同内容重复上传不会产生 422，不同内容不会互相覆盖；
 * - 原始文件名只作为资产元数据保留，不参与远端路径。
 */

import type { ImageNamingStrategy } from './image-settings'

const SHA256_RE = /^[0-9a-f]{64}$/i
const SAFE_EXTENSION_RE = /^[a-z0-9]{1,8}$/

/** 从原始文件名取扩展名；不安全或缺失时返回 `null`，由调用方决定回退值。 */
export function safeImageExtension(originalFilename: string): string | null {
  const match = /\.([^./\\]+)$/.exec(originalFilename)
  if (!match) return null
  const extension = match[1].toLowerCase()
  return SAFE_EXTENSION_RE.test(extension) ? extension : null
}

/** 原始文件名清洗：仅用于 `original-name` 策略，绝不用于默认路径。 */
export function sanitizeOriginalBaseName(originalFilename: string): string {
  const withoutExtension = originalFilename.replace(/\.[^./\\]*$/, '')
  const normalized = withoutExtension
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '')
    .slice(0, 64)
    .replace(/-+/g, '-')
  return normalized || 'image'
}

function formatUtcStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`
    + `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
}

export interface BuildUploadFileNameInput {
  sha256: string
  originalFilename: string
  /** 默认 `timestamp-hash`。 */
  strategy?: ImageNamingStrategy
  /** 测试注入用；默认当前时间。 */
  now?: Date
}

/**
 * 生成远端安全文件名。
 *
 * - `timestamp-hash`（默认）：`20261104-010203-<sha10>.png`
 * - `original-name` / `custom`：`<清洗后的原名>-<sha8>.png`（仍保留短哈希避免重名）
 */
export function buildUploadFileName(input: BuildUploadFileNameInput): string {
  if (!SHA256_RE.test(input.sha256)) throw new Error('invalid sha256')
  const extension = safeImageExtension(input.originalFilename) ?? 'img'
  const strategy: ImageNamingStrategy = input.strategy ?? 'timestamp-hash'

  if (strategy === 'original-name' || strategy === 'custom') {
    return `${sanitizeOriginalBaseName(input.originalFilename)}-${input.sha256.slice(0, 8).toLowerCase()}.${extension}`
  }
  const now = input.now ?? new Date()
  return `${formatUtcStamp(now)}-${input.sha256.slice(0, 10).toLowerCase()}.${extension}`
}

/**
 * 拼接远端相对路径。目录部分只允许普通片段；`..`、绝对路径与反斜杠被拒绝，
 * 返回 `null` 表示调用方必须放弃上传而不是猜测路径。
 */
export function joinRemotePath(directory: string, fileName: string): string | null {
  if (!fileName || /[/\\#%\s]/.test(fileName)) return null
  const trimmed = directory.trim().replace(/\\/g, '/')
  if (trimmed.startsWith('/')) return null
  const segments = trimmed.split('/').filter(segment => segment !== '' && segment !== '.')
  if (segments.some(segment => segment === '..' || /[#%\0-\x1f]/.test(segment))) return null
  return [...segments, fileName].join('/')
}
