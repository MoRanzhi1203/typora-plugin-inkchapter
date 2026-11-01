/**
 * 内容块工具栏 — 图片资源解析与复制策略（纯函数）。
 *
 * 真实 Typora 图片：`<span class="md-image" data-src="原始目标"><img src="file:///...?lastModify=...">`。
 * 因此本地路径优先用 `data-src`（未改写），远程/data 用运行时 `src`。
 *
 * 复制语义（不是 URL、不是 Markdown）：
 * - local-path → Electron `nativeImage.createFromPath`
 * - http(s)/blob → fetch → `nativeImage.createFromBuffer`
 * - data URL → `nativeImage.createFromDataURL`
 * - 其余或解码失败 → 由已加载的 `<img>` 画布栅格化为 PNG（CORS 污染则明确失败）
 */

import * as path from 'path'
import { classifyImagePath, safeDecodePathOnce } from '../heading-numbering/image-path-codec'

export type ImageResourceKind = 'local-path' | 'http' | 'data' | 'blob' | 'unsupported'

export interface ResolvedImageResource {
  kind: ImageResourceKind
  /** 本地绝对路径（local-path）或可直接 fetch / 解码的值。 */
  value: string
  /** 仅 local-path 有值。 */
  absolutePath: string | null
  /** 命中来源。 */
  source: 'data-src' | 'src'
  raw: string
}

const TYPORA_TYPEMARK_PREFIX = 'typora://app/typemark/'
const WKFILE_PREFIX = 'wkfile://'

function stripAngleBrackets(value: string): string {
  const s = value.trim()
  if (s.startsWith('<') && s.endsWith('>')) return s.slice(1, -1).trim()
  return s
}

function stripQueryAndHash(value: string): string {
  return value.split(/[?#]/, 1)[0]
}

function toLocalAbsolute(raw: string, baseDir: string | null): string | null {
  const s = stripAngleBrackets(raw)
  if (!s) return null
  const lower = s.toLowerCase()

  if (lower.startsWith('typora://')) {
    if (!lower.startsWith(TYPORA_TYPEMARK_PREFIX)) return null
    const rel = safeDecodePathOnce(stripQueryAndHash(s.slice(TYPORA_TYPEMARK_PREFIX.length))).decoded
    if (!rel) return null
    return baseDir ? path.resolve(/* 相对文档目录解析 */ path.normalize(baseDir), rel) : null
  }

  if (lower.startsWith('file:')) {
    const rest = s.slice(5).replace(/^\/{2,3}/, '')
    const decoded = safeDecodePathOnce(stripQueryAndHash(rest)).decoded
    return decoded ? path.normalize(decoded) : null
  }

  if (lower.startsWith(WKFILE_PREFIX)) {
    const decoded = safeDecodePathOnce(stripQueryAndHash(s.slice(WKFILE_PREFIX.length))).decoded
    return decoded ? path.normalize(decoded) : null
  }

  if (/^[a-zA-Z]:[\\/]/.test(s)) {
    return path.normalize(safeDecodePathOnce(stripQueryAndHash(s)).decoded)
  }

  const kind = classifyImagePath(s)
  if (kind === 'HTTP_URL' || kind === 'HTTPS_URL' || kind === 'DATA_URL') return null
  if (!baseDir) return null
  return path.resolve(baseDir, safeDecodePathOnce(stripQueryAndHash(s)).decoded)
}

/**
 * 解析图片资源。`data-src` 优先（本地原始目标），失败再退回运行时 `src`。
 * 两者都不可解析时返回 unsupported（仍可尝试画布栅格化）。
 */
export function resolveImageResource(input: {
  src: string | null
  dataSrc: string | null
  baseDir: string | null
}): ResolvedImageResource | null {
  const candidates: Array<{ raw: string; source: 'data-src' | 'src' }> = []
  const dataSrc = stripAngleBrackets(input.dataSrc ?? '')
  const src = (input.src ?? '').trim()
  if (dataSrc) candidates.push({ raw: dataSrc, source: 'data-src' })
  if (src) candidates.push({ raw: src, source: 'src' })

  for (const candidate of candidates) {
    const raw = candidate.raw
    const lower = raw.toLowerCase()
    if (lower.startsWith('data:')) {
      return { kind: 'data', value: raw, absolutePath: null, source: candidate.source, raw }
    }
    if (lower.startsWith('blob:')) {
      return { kind: 'blob', value: raw, absolutePath: null, source: candidate.source, raw }
    }
    if (lower.startsWith('http://') || lower.startsWith('https://')) {
      return { kind: 'http', value: raw, absolutePath: null, source: candidate.source, raw }
    }
    const absolutePath = toLocalAbsolute(raw, input.baseDir)
    if (absolutePath) {
      return { kind: 'local-path', value: absolutePath, absolutePath, source: candidate.source, raw }
    }
  }

  const fallback = candidates[0]
  if (!fallback) return null
  return { kind: 'unsupported', value: fallback.raw, absolutePath: null, source: fallback.source, raw: fallback.raw }
}

export type ImageCopyStrategy = 'native-path' | 'native-buffer' | 'native-data-url' | 'dom-raster'

export interface ImageCopyPlan {
  strategy: ImageCopyStrategy
  reason: string
}

/** 选择复制通道。`hasElectron=false` 时一律退回画布栅格化 + Web Clipboard。 */
export function planImageCopy(resource: ResolvedImageResource | null, hasElectron: boolean): ImageCopyPlan {
  if (!resource) return { strategy: 'dom-raster', reason: 'RESOURCE_UNRESOLVED' }
  switch (resource.kind) {
    case 'local-path':
      return hasElectron
        ? { strategy: 'native-path', reason: 'LOCAL_FILE_PATH' }
        : { strategy: 'dom-raster', reason: 'NO_ELECTRON' }
    case 'http':
    case 'blob':
      return hasElectron
        ? { strategy: 'native-buffer', reason: resource.kind === 'blob' ? 'BLOB_URL' : 'REMOTE_URL' }
        : { strategy: 'dom-raster', reason: 'NO_ELECTRON' }
    case 'data':
      return hasElectron
        ? { strategy: 'native-data-url', reason: 'DATA_URL' }
        : { strategy: 'dom-raster', reason: 'NO_ELECTRON' }
    default:
      return { strategy: 'dom-raster', reason: 'UNSUPPORTED_SCHEME' }
  }
}

/** 扩展名（小写，不含点）；无扩展名返回 ''。 */
export function imageFileExtension(filePathOrUrl: string): string {
  try {
    const clean = stripQueryAndHash(filePathOrUrl)
    const ext = path.extname(clean).toLowerCase()
    return ext.startsWith('.') ? ext.slice(1) : ''
  } catch {
    return ''
  }
}

/** GIF 为首帧复制（Electron nativeImage / 画布均不保留动画）。 */
export function isAnimatedGif(resource: ResolvedImageResource | null): boolean {
  if (!resource) return false
  return imageFileExtension(resource.raw) === 'gif' || imageFileExtension(resource.value) === 'gif'
}
