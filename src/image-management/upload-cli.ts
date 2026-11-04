/**
 * Typora「Custom Command」上传器入口。
 *
 * Typora 会把待上传图片路径追加到命令末尾，并从 stdout 的最后 N 行读取 URL。
 * 本 CLI 复用墨章上传适配器（唯一文件名 + DPAPI Token + 插件私有 PicGo 配置）：
 *
 *   node upload-cli.cjs --settings <ranzhi.inkchapter.json> "a.png" "b.png"
 *
 * stdout 只输出最终 URL（每行一个）；所有日志/错误走 stderr。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { resolveImageSettings } from './image-settings'
import { resolveImageDataPaths } from './image-data-paths'
import { ImageAssetService } from './image-asset-service'
import { ImageTransferTaskStore } from './image-transfer-task-store'
import { ImageUploadService } from './image-upload-service'
import { WindowsDpapiCredentialStore } from './image-credential-store'

interface CliOptions {
  settingsFile: string
  images: string[]
}

function parseArgs(argv: string[]): CliOptions | null {
  let settingsFile = ''
  const images: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--settings') {
      settingsFile = argv[++i] ?? ''
      continue
    }
    if (!arg.startsWith('--')) images.push(arg)
  }
  if (!settingsFile || images.length === 0) return null
  return { settingsFile, images }
}

async function readImageSettings(settingsFile: string) {
  const raw = JSON.parse(await fs.readFile(settingsFile, 'utf8')) as {
    settings?: { image?: unknown }
  }
  return resolveImageSettings(
    raw.settings?.image as Parameters<typeof resolveImageSettings>[0],
  )
}

async function main(): Promise<void> {
  // CJS 产物中把 require 暴露给既有 PicGo 加载器（ESM 主包不受影响）。
  const nodeRequire = (globalThis as { require?: (id: string) => unknown }).require
  if (typeof nodeRequire !== 'function' && typeof require === 'function') {
    (globalThis as { require?: (id: string) => unknown }).require = require
  }

  const options = parseArgs(process.argv.slice(2))
  if (!options) {
    process.stderr.write('墨章上传器：缺少 --settings 或图片路径\n')
    process.exitCode = 1
    return
  }

  let settings
  try {
    settings = await readImageSettings(options.settingsFile)
  } catch (error) {
    process.stderr.write(`墨章上传器：无法读取图片设置（${error instanceof Error ? error.message : 'unknown'}）\n`)
    process.exitCode = 1
    return
  }

  const dataBaseDir = path.dirname(options.settingsFile)
  const paths = resolveImageDataPaths(dataBaseDir, { settings })
  const assets = new ImageAssetService(paths)
  const tasks = new ImageTransferTaskStore(path.join(paths.dataRoot, 'transfer-tasks.json'))
  const credentials = new WindowsDpapiCredentialStore({
    rootDir: path.join(paths.dataRoot, 'secrets'),
  })
  const service = new ImageUploadService({
    paths,
    assets,
    tasks,
    credentials,
    readSettings: () => settings,
  })

  const urls: string[] = []
  for (const image of options.images) {
    // Typora 可能把已经是远程 URL 的图片交给上传命令；原样返回，避免把 URL
    // 当成本地文件送进 PicGo，也避免误报 PICGO_UNAVAILABLE。
    if (/^https?:\/\//i.test(image.trim())) {
      urls.push(image.trim())
      continue
    }
    const result = await service.uploadLocalFile({ filePath: path.resolve(image) })
    if (!result.ok) {
      process.stderr.write(`墨章上传器失败：${result.errorCode} ${result.message}\n`)
      process.exitCode = 1
      return
    }
    urls.push(result.url)
  }

  // 只输出 URL，且放在最后，符合 Typora 的“最后 N 行”约定。
  process.stdout.write(`${urls.join('\n')}\n`)
}

main().catch(error => {
  process.stderr.write(`墨章上传器异常：${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
