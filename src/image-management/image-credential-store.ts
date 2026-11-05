/**
 * 图片上传凭据的安全存储（Windows DPAPI）。
 *
 * 约束：
 * - 真实 Token 只以 DPAPI（CurrentUser）加密后的二进制形式落在插件私有目录，
 *   普通设置 JSON、Markdown、日志、异常信息中都不出现明文。
 * - PowerShell 只通过 stdin 接收 Token，命令行参数与环境变量不携带 Token。
 * - 该模块不向 `window` / `globalThis` 暴露任何读取入口；调用方必须显式持有
 *   store 实例（设置页与上传适配器），页面脚本无法直接从全局拿到 Token。
 * - 安全存储不可用时返回明确错误码，调用方必须阻止上传，禁止退化为明文。
 */

import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'

export type ImageCredentialBackend = 'windows-dpapi' | 'unavailable'

export type ImageCredentialErrorCode =
  | 'CREDENTIAL_BACKEND_UNAVAILABLE'
  | 'CREDENTIAL_REFERENCE_INVALID'
  | 'CREDENTIAL_EMPTY'
  | 'CREDENTIAL_NOT_FOUND'
  | 'CREDENTIAL_WRITE_FAILED'
  | 'CREDENTIAL_READ_FAILED'
  | 'CREDENTIAL_DELETE_FAILED'

export interface ImageCredentialStatus {
  configured: boolean
  backend: ImageCredentialBackend
  /** 密文文件最后更新时间（毫秒）；未配置时为 null。 */
  updatedAt: number | null
}

export type ImageCredentialReadResult =
  | { ok: true; secret: string }
  | { ok: false; code: ImageCredentialErrorCode }

export type ImageCredentialWriteResult =
  | { ok: true }
  | { ok: false; code: ImageCredentialErrorCode }

export interface ImageCredentialStore {
  readonly backend: ImageCredentialBackend
  status(referenceId: string): Promise<ImageCredentialStatus>
  read(referenceId: string): Promise<ImageCredentialReadResult>
  write(referenceId: string, secret: string): Promise<ImageCredentialWriteResult>
  delete(referenceId: string): Promise<ImageCredentialWriteResult>
}

const REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/

/** 凭据引用 ID 只允许安全字符；非法值直接拒绝，不拼接路径。 */
export function isValidCredentialReferenceId(value: unknown): value is string {
  return typeof value === 'string' && REFERENCE_RE.test(value)
}

/** 由 Profile 自动派生内部凭据引用 ID（用户不输入）。 */
export function resolveCredentialReferenceId(profile: {
  remoteProfileId: string
  credentialReferenceId: string
}): string {
  const existing = profile.credentialReferenceId.trim()
  if (isValidCredentialReferenceId(existing)) return existing
  const slug = profile.remoteProfileId
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
  return `inkchapter.github.${slug || 'default'}`
}

// ── DPAPI 子进程 ─────────────────────────────────────────────────────

const PROTECT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Security',
  '$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '$plain = [Text.Encoding]::UTF8.GetBytes([string]$payload.secret)',
  '$cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $null, "CurrentUser")',
  '[Console]::Out.Write([Convert]::ToBase64String($cipher))',
].join('; ')

const UNPROTECT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Security',
  '$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '$cipher = [Convert]::FromBase64String([string]$payload.cipher)',
  '$plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, "CurrentUser")',
  '[Console]::Out.Write([Convert]::ToBase64String($plain))',
].join('; ')

const DPAPI_TIMEOUT_MS = 10_000
const MAX_CIPHER_CHARS = 256 * 1024

export interface DpapiRunner {
  protect(secret: string): Promise<string>
  unprotect(cipher: string): Promise<string>
}

interface PowerShellResult {
  code: number | null
  stdout: string
}

function runPowerShell(script: string, payload: Record<string, string>): Promise<PowerShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let settled = false
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      resolve({ code, stdout })
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      child.kill()
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error('DPAPI_TIMEOUT')), DPAPI_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length + chunk.length > MAX_CIPHER_CHARS) {
        fail(new Error('DPAPI_OUTPUT_TOO_LARGE'))
        return
      }
      stdout += chunk
    })
    // stderr 只丢弃：DPAPI 错误信息不包含 Token，但也不回传给上层，避免任何泄露面。
    child.stderr.resume()
    child.on('error', () => fail(new Error('DPAPI_SPAWN_FAILED')))
    child.on('close', code => {
      clearTimeout(timer)
      finish(code)
    })
    try {
      child.stdin.end(JSON.stringify(payload))
    } catch {
      fail(new Error('DPAPI_STDIN_FAILED'))
    }
  })
}

/** 默认 DPAPI 执行器；非 Windows 或缺少 PowerShell 时抛错，由 store 映射为不可用。 */
export const defaultDpapiRunner: DpapiRunner = {
  async protect(secret: string): Promise<string> {
    if (process.platform !== 'win32') throw new Error('DPAPI_PLATFORM_UNSUPPORTED')
    const result = await runPowerShell(PROTECT_SCRIPT, { secret })
    const cipher = result.stdout.trim()
    if (result.code !== 0 || !cipher) throw new Error('DPAPI_PROTECT_FAILED')
    return cipher
  },
  async unprotect(cipher: string): Promise<string> {
    if (process.platform !== 'win32') throw new Error('DPAPI_PLATFORM_UNSUPPORTED')
    const result = await runPowerShell(UNPROTECT_SCRIPT, { cipher })
    const encoded = result.stdout.trim()
    if (result.code !== 0 || !encoded) throw new Error('DPAPI_UNPROTECT_FAILED')
    const bytes = Buffer.from(encoded, 'base64')
    try {
      return bytes.toString('utf8')
    } finally {
      bytes.fill(0)
    }
  },
}

// ── Store ────────────────────────────────────────────────────────────

export interface WindowsDpapiCredentialStoreOptions {
  /** 插件私有凭据目录，例如 `<dataRoot>/secrets`。 */
  rootDir: string
  runner?: DpapiRunner
  /** 测试注入；默认判断 `process.platform === 'win32'`。 */
  platform?: NodeJS.Platform
}

export class WindowsDpapiCredentialStore implements ImageCredentialStore {
  readonly backend: ImageCredentialBackend
  private readonly rootDir: string
  private readonly runner: DpapiRunner

  constructor(options: WindowsDpapiCredentialStoreOptions) {
    this.rootDir = options.rootDir
    this.runner = options.runner ?? defaultDpapiRunner
    this.backend = (options.platform ?? process.platform) === 'win32'
      ? 'windows-dpapi'
      : 'unavailable'
  }

  private fileFor(referenceId: string): string | null {
    if (!isValidCredentialReferenceId(referenceId)) return null
    return path.join(this.rootDir, `${referenceId}.dpapi`)
  }

  async status(referenceId: string): Promise<ImageCredentialStatus> {
    const file = this.fileFor(referenceId)
    if (!file || this.backend === 'unavailable') {
      return { configured: false, backend: this.backend, updatedAt: null }
    }
    try {
      const stat = await fs.stat(file)
      return { configured: true, backend: this.backend, updatedAt: stat.mtimeMs }
    } catch {
      return { configured: false, backend: this.backend, updatedAt: null }
    }
  }

  async read(referenceId: string): Promise<ImageCredentialReadResult> {
    if (this.backend === 'unavailable') {
      return { ok: false, code: 'CREDENTIAL_BACKEND_UNAVAILABLE' }
    }
    const file = this.fileFor(referenceId)
    if (!file) return { ok: false, code: 'CREDENTIAL_REFERENCE_INVALID' }
    let cipher: string
    try {
      cipher = (await fs.readFile(file, 'utf8')).trim()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return { ok: false, code: code === 'ENOENT' ? 'CREDENTIAL_NOT_FOUND' : 'CREDENTIAL_READ_FAILED' }
    }
    if (!cipher) return { ok: false, code: 'CREDENTIAL_READ_FAILED' }
    try {
      const secret = await this.runner.unprotect(cipher)
      return secret ? { ok: true, secret } : { ok: false, code: 'CREDENTIAL_READ_FAILED' }
    } catch {
      return { ok: false, code: 'CREDENTIAL_READ_FAILED' }
    }
  }

  async write(referenceId: string, secret: string): Promise<ImageCredentialWriteResult> {
    if (this.backend === 'unavailable') {
      return { ok: false, code: 'CREDENTIAL_BACKEND_UNAVAILABLE' }
    }
    const file = this.fileFor(referenceId)
    if (!file) return { ok: false, code: 'CREDENTIAL_REFERENCE_INVALID' }
    const value = typeof secret === 'string' ? secret.trim() : ''
    if (!value) return { ok: false, code: 'CREDENTIAL_EMPTY' }

    let cipher: string
    try {
      cipher = await this.runner.protect(value)
    } catch {
      return { ok: false, code: 'CREDENTIAL_WRITE_FAILED' }
    }

    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    try {
      await fs.mkdir(this.rootDir, { recursive: true })
      await fs.writeFile(temp, cipher, { encoding: 'utf8', mode: 0o600 })
      await fs.rename(temp, file)
      return { ok: true }
    } catch {
      try { await fs.rm(temp, { force: true }) } catch { /* ignore */ }
      return { ok: false, code: 'CREDENTIAL_WRITE_FAILED' }
    }
  }

  async delete(referenceId: string): Promise<ImageCredentialWriteResult> {
    const file = this.fileFor(referenceId)
    if (!file) return { ok: false, code: 'CREDENTIAL_REFERENCE_INVALID' }
    try {
      await fs.rm(file, { force: true })
      return { ok: true }
    } catch {
      return { ok: false, code: 'CREDENTIAL_DELETE_FAILED' }
    }
  }
}

// ── 旧版 PicGo 明文 Token 迁移 ───────────────────────────────────────

export type LegacyTokenMigrationResult =
  | 'none'
  | 'migrated'
  | 'removed-without-store'
  | 'failed'

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8')
    await fs.rename(temp, file)
  } catch (error) {
    try { await fs.rm(temp, { force: true }) } catch { /* ignore */ }
    throw error
  }
}

/**
 * 把旧版 PicGo 私有配置里的明文 Token 移入安全存储，并立刻从 JSON 中移除。
 * 安全存储写入失败时仍然移除明文（阻止继续使用明文），返回 `removed-without-store`。
 */
export async function migrateLegacyPicGoToken(options: {
  configPath: string
  store: ImageCredentialStore
  referenceId: string
}): Promise<LegacyTokenMigrationResult> {
  let raw: string
  try {
    raw = await fs.readFile(options.configPath, 'utf8')
  } catch {
    return 'none'
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'failed'
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'failed'

  const root = parsed as Record<string, unknown>
  const picBed = root.picBed
  if (!picBed || typeof picBed !== 'object' || Array.isArray(picBed)) return 'none'
  const github = (picBed as Record<string, unknown>).github
  if (!github || typeof github !== 'object' || Array.isArray(github)) return 'none'
  const token = (github as Record<string, unknown>).token
  if (typeof token !== 'string' || !token.trim()) return 'none'

  const stored = await options.store.write(options.referenceId, token.trim())
  delete (github as Record<string, unknown>).token
  try {
    await writeJsonAtomic(options.configPath, root)
  } catch {
    return 'failed'
  }
  return stored.ok ? 'migrated' : 'removed-without-store'
}
