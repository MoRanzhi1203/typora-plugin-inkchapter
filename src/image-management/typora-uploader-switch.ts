/**
 * 把 Typora 原生「上传图片」切换到墨章适配器。
 *
 * Typora 的 Custom Command 合同：
 * - 命令后自动追加待上传图片路径；
 * - 从 stdout 最后 N 行读取 URL；
 * - 只修改用户 profile.data（有备份），不修改 Typora 安装目录。
 */

import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import * as path from 'path'

export const TYPORA_CUSTOM_UPLOADER = 'custom'

export interface TyporaProfileUploaderState {
  imageUploader: string | null
  customImageUploader: string | null
  imageSaveLocation: string | null
}

export type TyporaUploaderSwitchCode =
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_INVALID'
  | 'NODE_NOT_FOUND'
  | 'CLI_NOT_FOUND'
  | 'WRITE_FAILED'
  | 'VERIFY_FAILED'

export interface TyporaUploaderSwitchResult {
  ok: boolean
  code?: TyporaUploaderSwitchCode
  message: string
  command: string | null
  backupPath: string | null
  changed: boolean
  previous: TyporaProfileUploaderState | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** 解码 profile.data（十六进制 UTF-8 JSON，兼容直接 JSON）。 */
export function decodeTyporaProfileData(raw: string): Record<string, unknown> | null {
  const value = raw.trim()
  if (!value) return null
  if (value.startsWith('{')) {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      return null
    }
  }
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null
  try {
    const json = Buffer.from(value, 'hex').toString('utf8')
    return asRecord(JSON.parse(json))
  } catch {
    return null
  }
}

/** Typora 使用十六进制 UTF-8 JSON 保存 profile.data。 */
export function encodeTyporaProfileData(profile: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(profile), 'utf8').toString('hex')
}

export function readTyporaUploaderState(profile: Record<string, unknown>): TyporaProfileUploaderState {
  return {
    imageUploader: typeof profile.image_uploader === 'string' ? profile.image_uploader : null,
    // Typora 偏好设置把 Custom Command 持久化为 custom_image_uploader，
    // 运行时读取 File.option.customImageUploader（见 page-dist Preferences 与 frame.js）。
    customImageUploader: typeof profile.custom_image_uploader === 'string'
      ? profile.custom_image_uploader
      : null,
    imageSaveLocation: typeof profile.image_save_location === 'string'
      ? profile.image_save_location
      : null,
  }
}

interface TyporaRuntimeOptionHost {
  option?: Record<string, unknown>
}

/**
 * 同步运行中的 Typora 上传器选项，避免用户必须重启。
 * 只改内存中的 File.option，不触碰 Typora 安装目录。
 */
export function applyTyporaUploaderRuntime(input: {
  uploader: string
  command: string
  runtime?: TyporaRuntimeOptionHost | null
}): boolean {
  const runtime = input.runtime
    ?? (globalThis as unknown as { File?: TyporaRuntimeOptionHost }).File
  const option = runtime?.option
  if (!option) return false
  option.imageUploader = input.uploader
  option.customImageUploader = input.command
  return true
}

function quoteWin(value: string): string {
  return `"${value.replace(/"/g, '')}"`
}

/** 构造 Typora Custom Command；图片路径由 Typora 追加。 */
export function buildInkChapterUploaderCommand(input: {
  nodeExecutable: string
  cliPath: string
  settingsFile: string
  platform?: NodeJS.Platform
}): string {
  if ((input.platform ?? process.platform) === 'win32') {
    return `${quoteWin(input.nodeExecutable)} ${quoteWin(input.cliPath)} --settings ${quoteWin(input.settingsFile)}`
  }
  const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`
  return `${quote(input.nodeExecutable)} ${quote(input.cliPath)} --settings ${quote(input.settingsFile)}`
}

/** 从 PATH 与常见 Node 安装位置寻找真实 node 可执行文件。 */
export function findNodeExecutable(input: {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  exists?: (file: string) => boolean
} = {}): string | null {
  const platform = input.platform ?? process.platform
  const env = input.env ?? process.env
  const exists = input.exists ?? ((file: string) => existsSync(file))
  const name = platform === 'win32' ? 'node.exe' : 'node'
  const candidates: string[] = []
  const pathValue = env.PATH ?? env.Path ?? ''
  for (const entry of pathValue.split(path.delimiter)) {
    const dir = entry.trim().replace(/^"|"$/g, '')
    if (dir) candidates.push(path.join(dir, name))
  }
  if (env.NVM_SYMLINK?.trim()) candidates.push(path.join(env.NVM_SYMLINK.trim(), name))
  if (env.ProgramFiles?.trim()) candidates.push(path.join(env.ProgramFiles.trim(), 'nodejs', name))
  if (env.LOCALAPPDATA?.trim()) candidates.push(path.join(env.LOCALAPPDATA.trim(), 'Programs', 'nodejs', name))
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return null
}

export function defaultTyporaProfilePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const appData = env.APPDATA?.trim()
  return appData ? path.join(appData, 'Typora', 'profile.data') : null
}

async function readProfileFile(profilePath: string): Promise<Record<string, unknown> | null> {
  try {
    return decodeTyporaProfileData(await fs.readFile(profilePath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 切换 Typora 上传器为墨章 CLI。
 * 只改三个字段：image_save_location / image_uploader / custom_image_uploader。
 */
export async function switchTyporaUploaderToInkChapter(options: {
  profilePath?: string | null
  nodeExecutable: string
  cliPath: string
  settingsFile: string
  now?: Date
}): Promise<TyporaUploaderSwitchResult> {
  const profilePath = options.profilePath ?? defaultTyporaProfilePath()
  if (!profilePath) {
    return {
      ok: false, code: 'PROFILE_NOT_FOUND', message: '未找到 Typora profile.data',
      command: null, backupPath: null, changed: false, previous: null,
    }
  }
  const profile = await readProfileFile(profilePath)
  if (!profile) {
    return {
      ok: false, code: 'PROFILE_NOT_FOUND', message: 'Typora profile.data 不存在或无法解析',
      command: null, backupPath: null, changed: false, previous: null,
    }
  }
  try {
    await fs.access(options.cliPath)
  } catch {
    return {
      ok: false, code: 'CLI_NOT_FOUND', message: '墨章上传 CLI 不存在，请先构建/部署插件',
      command: null, backupPath: null, changed: false, previous: readTyporaUploaderState(profile),
    }
  }
  try {
    await fs.access(options.nodeExecutable)
  } catch {
    return {
      ok: false, code: 'NODE_NOT_FOUND', message: '未找到 Node.js 可执行文件',
      command: null, backupPath: null, changed: false, previous: readTyporaUploaderState(profile),
    }
  }

  const previous = readTyporaUploaderState(profile)
  const command = buildInkChapterUploaderCommand({
    nodeExecutable: options.nodeExecutable,
    cliPath: options.cliPath,
    settingsFile: options.settingsFile,
  })
  if (previous.imageUploader === TYPORA_CUSTOM_UPLOADER
    && previous.customImageUploader === command
    && previous.imageSaveLocation === 'ipic') {
    return {
      ok: true, message: 'Typora 上传器已由墨章接管', command,
      backupPath: null, changed: false, previous,
    }
  }

  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
  const backupPath = `${profilePath}.inkchapter-backup-${stamp}`
  try {
    await fs.copyFile(profilePath, backupPath)
  } catch {
    return {
      ok: false, code: 'WRITE_FAILED', message: '无法备份 Typora profile.data，未做修改',
      command: null, backupPath: null, changed: false, previous,
    }
  }

  const next = {
    ...profile,
    image_save_location: 'ipic',
    image_uploader: TYPORA_CUSTOM_UPLOADER,
    custom_image_uploader: command,
  }
  const temp = `${profilePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temp, encodeTyporaProfileData(next), 'utf8')
    await fs.rename(temp, profilePath)
  } catch {
    try { await fs.rm(temp, { force: true }) } catch { /* ignore */ }
    return {
      ok: false, code: 'WRITE_FAILED', message: '写入 Typora profile.data 失败',
      command: null, backupPath, changed: false, previous,
    }
  }

  const verify = await readProfileFile(profilePath)
  const verified = verify
    && verify.image_uploader === TYPORA_CUSTOM_UPLOADER
    && verify.custom_image_uploader === command
  if (!verified) {
    return {
      ok: false, code: 'VERIFY_FAILED', message: '写入后校验失败，请从备份恢复',
      command, backupPath, changed: true, previous,
    }
  }
  return {
    ok: true, message: 'Typora 上传图片按钮已切换到墨章适配器', command,
    backupPath, changed: true, previous,
  }
}

/** 从最新备份恢复 Typora 上传器设置。 */
export async function restoreTyporaUploaderFromLatestBackup(options: {
  profilePath?: string | null
} = {}): Promise<{
  ok: boolean
  message: string
  restoredFrom: string | null
  state: TyporaProfileUploaderState | null
}> {
  const profilePath = options.profilePath ?? defaultTyporaProfilePath()
  if (!profilePath) {
    return { ok: false, message: '未找到 Typora profile.data', restoredFrom: null, state: null }
  }
  const dir = path.dirname(profilePath)
  const base = path.basename(profilePath)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return { ok: false, message: '无法读取 Typora 配置目录', restoredFrom: null, state: null }
  }
  const backups = entries
    .filter(name => name.startsWith(`${base}.inkchapter-backup-`))
    .sort()
    .reverse()
  const latest = backups[0]
  if (!latest) {
    return { ok: false, message: '没有可用的 Typora 上传器备份', restoredFrom: null, state: null }
  }
  const source = path.join(dir, latest)
  const temp = `${profilePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.copyFile(source, temp)
    await fs.rename(temp, profilePath)
  } catch {
    try { await fs.rm(temp, { force: true }) } catch { /* ignore */ }
    return { ok: false, message: '恢复 Typora 配置失败', restoredFrom: source, state: null }
  }
  const restored = await readProfileFile(profilePath)
  return {
    ok: true,
    message: '已恢复 Typora 原生上传器设置',
    restoredFrom: source,
    state: restored ? readTyporaUploaderState(restored) : null,
  }
}
