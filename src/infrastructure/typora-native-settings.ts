/**
 * Typora native preference reader (R13).
 *
 * Typora 1.6.7 stores its preferences in `%APPDATA%\Typora\profile.data` as a
 * hex-encoded UTF-8 JSON document. Two keys decide whether `$...$` inline math
 * can render at all, independently of InkChapter:
 *
 *   - `strict_mode`          → strict Markdown parsing (disables inline math)
 *   - `enable_inline_math`   → "Preferences → Markdown → Syntax Support → Inline Math"
 *
 * InkChapter NEVER writes this file: it is the user's Typora configuration.
 * The plugin only reads it to (a) explain why inline formulas are missing and
 * (b) report the native setting state in the runtime acceptance.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export interface TyporaNativeMathSettings {
  /** True when the profile file could be decoded. */
  available: boolean
  profilePath: string | null
  strictMode: boolean | null
  inlineMathEnabled: boolean | null
  autoNumberingForMath: string | null
}

const UNAVAILABLE: TyporaNativeMathSettings = {
  available: false,
  profilePath: null,
  strictMode: null,
  inlineMathEnabled: null,
  autoNumberingForMath: null,
}

interface CacheEntry {
  mtimeMs: number
  settings: TyporaNativeMathSettings
}

let cache: CacheEntry | null = null

/** Resolve Typora's profile.data path for the current platform. */
export function resolveTyporaProfilePath(): string | null {
  try {
    if (process.platform === 'win32') {
      const appData = process.env['APPDATA']
      return appData ? path.join(appData, 'Typora', 'profile.data') : null
    }
    if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', 'Typora', 'profile.data')
    }
    const configHome = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config')
    return path.join(configHome, 'Typora', 'profile.data')
  } catch {
    return null
  }
}

/**
 * Decode a Typora profile payload. Typora writes hex-encoded JSON, but older
 * builds used raw JSON; both are accepted. Returns null for unreadable input.
 */
export function decodeTyporaProfileData(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  try {
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed) as unknown
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
    }
    const hex = trimmed.replace(/\s+/g, '')
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
    const parsed = JSON.parse(Buffer.from(hex, 'hex').toString('utf8')) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function toBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function toOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Read (and cache by mtime) the Typora native math preferences. Read-only. */
export function readTyporaNativeMathSettings(profilePath?: string): TyporaNativeMathSettings {
  const resolved = profilePath ?? resolveTyporaProfilePath()
  if (!resolved) return { ...UNAVAILABLE }
  try {
    const stat = fs.statSync(resolved)
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.settings.profilePath === resolved) {
      return cache.settings
    }
    const decoded = decodeTyporaProfileData(fs.readFileSync(resolved, 'utf8'))
    if (!decoded) {
      cache = { mtimeMs: stat.mtimeMs, settings: { ...UNAVAILABLE, profilePath: resolved } }
      return cache.settings
    }
    const settings: TyporaNativeMathSettings = {
      available: true,
      profilePath: resolved,
      strictMode: toBoolean(decoded['strict_mode']),
      inlineMathEnabled: toBoolean(decoded['enable_inline_math']),
      autoNumberingForMath: toOptionalString(decoded['auto_numbering_for_math']),
    }
    cache = { mtimeMs: stat.mtimeMs, settings }
    return settings
  } catch {
    return { ...UNAVAILABLE, profilePath: resolved }
  }
}

/**
 * Human-readable warning for the settings page. Returns null when inline math
 * is enabled and usable (or when the profile cannot be read, because guessing
 * would be worse than saying nothing).
 */
export function describeTyporaInlineMathHint(settings: TyporaNativeMathSettings): string | null {
  if (!settings.available) return null
  const problems: string[] = []
  if (settings.inlineMathEnabled !== true) {
    problems.push('Typora 未启用「行内公式」：偏好设置 → Markdown → 语法支持 → 勾选 Inline Math')
  }
  if (settings.strictMode === true) {
    problems.push('Typora 严格模式已开启：偏好设置 → Markdown → 勾选/取消 Strict Mode 以允许 $...$ 解析')
  }
  return problems.length > 0 ? problems.join('；') : null
}

/** Test/diagnostic hook — clears the mtime cache. */
export function resetTyporaNativeMathSettingsCache(): void {
  cache = null
}
