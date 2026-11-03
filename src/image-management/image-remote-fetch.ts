/**
 * 远程图片下载（P4）：URL 安全校验、内容类型与大小限制、流式读取后的哈希计算。
 * 只有真实拿到图片字节才算成功；调用方仍必须写入/校验磁盘后才可标记可用。
 */

import { createHash } from 'crypto'
import {
  extensionForContentType,
  extensionFromUrl,
  validateRemoteImageUrl,
} from './image-remote-url'

export type RemoteFetchErrorCode =
  | 'INVALID_URL'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'NOT_IMAGE'
  | 'TOO_LARGE'
  | 'EMPTY_BODY'

export interface RemoteFetchSuccess {
  ok: true
  sha256: string
  bytes: Uint8Array
  contentType: string | null
  extension: string | null
}

export interface RemoteFetchFailure {
  ok: false
  code: RemoteFetchErrorCode
  message: string
}

export type RemoteFetchResult = RemoteFetchSuccess | RemoteFetchFailure

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function fetchRemoteImage(
  fetchImpl: FetchLike,
  rawUrl: string,
  maxBytes: number,
): Promise<RemoteFetchResult> {
  const safety = validateRemoteImageUrl(rawUrl)
  if (!safety.ok || !safety.normalized) {
    return { ok: false, code: 'INVALID_URL', message: safety.reason ?? 'INVALID_URL' }
  }

  let response: Response
  try {
    response = await fetchImpl(safety.normalized, { redirect: 'follow' })
  } catch (error) {
    return { ok: false, code: 'NETWORK_ERROR', message: error instanceof Error ? error.message : String(error) }
  }
  if (!response.ok) {
    return { ok: false, code: 'HTTP_ERROR', message: `HTTP ${response.status}` }
  }
  // 重定向后的最终地址同样必须通过安全校验，避免被重定向到内网。
  if (response.url) {
    const finalSafety = validateRemoteImageUrl(response.url)
    if (!finalSafety.ok) {
      return { ok: false, code: 'INVALID_URL', message: `REDIRECT_${finalSafety.reason ?? 'BLOCKED'}` }
    }
  }

  const contentType = response.headers.get('content-type')
  const mime = contentType?.split(';')[0].trim().toLowerCase() ?? ''
  if (mime && !mime.startsWith('image/') && mime !== 'application/octet-stream') {
    return { ok: false, code: 'NOT_IMAGE', message: mime }
  }

  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, code: 'TOO_LARGE', message: String(declaredLength) }
  }

  let buffer: ArrayBuffer
  try {
    buffer = await response.arrayBuffer()
  } catch (error) {
    return { ok: false, code: 'NETWORK_ERROR', message: error instanceof Error ? error.message : String(error) }
  }
  const bytes = new Uint8Array(buffer)
  if (bytes.byteLength === 0) {
    return { ok: false, code: 'EMPTY_BODY', message: 'empty response' }
  }
  if (bytes.byteLength > maxBytes) {
    return { ok: false, code: 'TOO_LARGE', message: String(bytes.byteLength) }
  }

  return {
    ok: true,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes,
    contentType,
    extension: extensionForContentType(contentType) ?? extensionFromUrl(rawUrl),
  }
}
