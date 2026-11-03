/**
 * 普通图片缓存配额（P3）。
 *
 * 只有「可清理的普通缓存对象与缩略图」参与限额：
 * 用户图库、项目图片、固定离线资源、数据库与上传暂存一律不进入本模块。
 * 固定离线资源即使物理上放在缓存盘，也不得被 LRU 选中。
 */

export interface CacheEntry {
  locator: string
  sizeBytes: number
  /** ISO 时间；无效值按最旧处理。 */
  lastAccessedAt: string
  /** 固定离线/图库等受保护对象；默认 false。 */
  pinned?: boolean
}

export interface CacheEvictionPlan {
  evict: CacheEntry[]
  /** 清理后仍保留的可清理字节数。 */
  retainedBytes: number
  evictedBytes: number
}

function normalizedSize(entry: CacheEntry): number {
  return Number.isFinite(entry.sizeBytes) && entry.sizeBytes > 0 ? Math.floor(entry.sizeBytes) : 0
}

function accessTime(entry: CacheEntry): number {
  const value = Date.parse(entry.lastAccessedAt)
  return Number.isFinite(value) ? value : 0
}

/**
 * 计算 LRU 清理计划（纯函数，不触碰磁盘）。
 * `maxBytes <= 0` 表示关闭缓存：清空全部可清理对象。
 */
export function planCacheEviction(
  entries: readonly CacheEntry[],
  maxBytes: number,
): CacheEvictionPlan {
  const cleanable = entries.filter(entry => entry.pinned !== true)
  const totalBytes = cleanable.reduce((sum, entry) => sum + normalizedSize(entry), 0)

  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return {
      evict: [...cleanable].sort((a, b) => accessTime(a) - accessTime(b) || a.locator.localeCompare(b.locator)),
      retainedBytes: 0,
      evictedBytes: totalBytes,
    }
  }

  if (totalBytes <= maxBytes) {
    return { evict: [], retainedBytes: totalBytes, evictedBytes: 0 }
  }

  const ordered = [...cleanable].sort(
    (a, b) => accessTime(a) - accessTime(b) || a.locator.localeCompare(b.locator),
  )
  const evict: CacheEntry[] = []
  let remaining = totalBytes
  let evictedBytes = 0
  for (const entry of ordered) {
    if (remaining <= maxBytes) break
    evict.push(entry)
    const size = normalizedSize(entry)
    remaining -= size
    evictedBytes += size
  }

  return {
    evict,
    retainedBytes: remaining,
    evictedBytes,
  }
}

export function cacheQuotaBytes(maxSizeMB: number): number {
  if (!Number.isFinite(maxSizeMB) || maxSizeMB <= 0) return 0
  return Math.max(0, Math.floor(maxSizeMB * 1024 * 1024))
}
