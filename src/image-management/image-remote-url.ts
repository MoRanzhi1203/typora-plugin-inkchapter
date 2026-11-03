/**
 * 远程图片 URL 安全与命名（P4）。
 *
 * - 只允许 http / https，拒绝携带用户名密码的 URL。
 * - 拒绝本机、回环、私网、链路本地与 `.local` 主机，降低 SSRF 风险。
 * - 远端文件名从不沿用用户文件名；缓存/离线对象一律用内容哈希命名。
 */

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'])

export interface RemoteImageUrlValidation {
  ok: boolean
  normalized: string | null
  reason?: string
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null
  const numbers = parts.map(part => Number(part))
  if (numbers.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null
  return numbers
}

function isBlockedIpv4(parts: number[]): boolean {
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isBlockedIpv6(hostname: string): boolean {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (value === '::1' || value === '::') return true
  if (value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice('::ffff:'.length)
    const parts = parseIpv4(mapped)
    return parts ? isBlockedIpv4(parts) : true
  }
  return false
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local')) return true
  const ipv6 = host.startsWith('[')
  if (ipv6) return isBlockedIpv6(host)
  const ipv4 = parseIpv4(host)
  if (ipv4) return isBlockedIpv4(ipv4)
  return false
}

export function validateRemoteImageUrl(raw: string): RemoteImageUrlValidation {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, normalized: null, reason: 'INVALID_URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, normalized: null, reason: 'UNSUPPORTED_PROTOCOL' }
  }
  if (url.username || url.password) {
    return { ok: false, normalized: null, reason: 'CREDENTIALS_NOT_ALLOWED' }
  }
  if (isBlockedHostname(url.hostname)) {
    return { ok: false, normalized: null, reason: 'BLOCKED_HOST' }
  }
  return { ok: true, normalized: url.toString() }
}

export function extensionForContentType(contentType: string | null): string | null {
  if (!contentType) return null
  const mime = contentType.split(';')[0].trim().toLowerCase()
  return EXTENSION_BY_MIME[mime] ?? null
}

export function extensionFromUrl(raw: string): string | null {
  try {
    const pathname = new URL(raw).pathname
    const match = /\.([a-zA-Z0-9]{1,8})$/.exec(pathname)
    if (!match) return null
    const extension = match[1].toLowerCase()
    return IMAGE_EXTENSIONS.has(extension) ? extension : null
  } catch {
    return null
  }
}

/** 缓存对象名：完全由内容哈希与扩展名决定，不含原始文件名。 */
export function buildCacheObjectName(sha256: string, extension: string | null): string {
  if (!/^[0-9a-f]{64}$/i.test(sha256)) throw new Error('invalid sha256')
  const safeExtension = extension && /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'img'
  return `${sha256.toLowerCase()}.${safeExtension}`
}

/** 离线工作副本中的资源名：短哈希 + 序号，避免空格、`#`、`%` 与重名。 */
export function buildOfflineAssetName(sha256: string, extension: string | null, index: number): string {
  if (!/^[0-9a-f]{64}$/i.test(sha256)) throw new Error('invalid sha256')
  const safeExtension = extension && /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'img'
  return `img-${sha256.slice(0, 10).toLowerCase()}-${index}.${safeExtension}`
}
