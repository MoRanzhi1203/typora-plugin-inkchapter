/**
 * 原生插入后的图片策略执行器（V5.0）。
 *
 * 职责边界：
 * - 只消费 `planInsertionActions` 的决策，不自行猜测图片语义；
 * - 上传 / 本地化 / 引用改写全部通过注入的回调完成，便于测试与复用；
 * - 默认策略关闭时完全不动作，Typora 原生插入结果原样保留；
 * - 对同一 (token, destination) 只处理一次，且改写后重新取 Markdown，
 *   避免一次插入触发无限上传 / 重复改写。
 */

import type { InsertionActionKind, InsertionDecision } from './image-insertion-policy'
import { planInsertionActions } from './image-insertion-policy'
import type { ImageSettings } from './image-settings'

export interface InsertionControllerDeps {
  /** 当前文档的生效配置（已合并 folder / document scope）。 */
  getSettings: () => ImageSettings
  getMarkdown: () => string | null
  getDocumentPath: () => string | null
  /** 上传本地绝对路径图片；返回远程 URL。 */
  upload: (filePath: string) => Promise<{ ok: boolean; url?: string; message?: string }>
  /** 下载远程图片到当前文档资源目录；返回新的 Markdown 目标。 */
  localize: (url: string) => Promise<{ ok: boolean; destination?: string; message?: string }>
  /** 只改写目标引用；返回是否成功。 */
  rewrite: (rawDestination: string, newDestination: string) => boolean
  notify?: (message: string, kind: 'info' | 'error') => void
  debounceMs?: number
  now?: () => number
}

export interface InsertionRunResult {
  attempted: number
  uploaded: number
  localized: number
  rewritten: number
  failed: number
  skipped: number
}

const EMPTY_RESULT: InsertionRunResult = {
  attempted: 0, uploaded: 0, localized: 0, rewritten: 0, failed: 0, skipped: 0,
}

export class ImageInsertionController {
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastMarkdown: string | null = null
  private lastDocumentPath: string | null = null
  private readonly handled = new Set<string>()
  /** 插件自己产出的目标（上传后的 URL / 本地化后的路径），绝不被下一轮再次接管。 */
  private readonly produced = new Set<string>()
  private readonly debounceMs: number
  private readonly now: () => number
  private disposed = false
  private running: Promise<InsertionRunResult> | null = null

  constructor(private readonly deps: InsertionControllerDeps) {
    this.debounceMs = Math.max(0, deps.debounceMs ?? 900)
    this.now = deps.now ?? (() => Date.now())
    this.lastMarkdown = deps.getMarkdown()
    this.lastDocumentPath = deps.getDocumentPath()
  }

  /** 编辑器 edit 事件入口：按文档隔离，文档切换时重置基线。 */
  notifyEdit(): void {
    if (this.disposed) return
    const documentPath = this.deps.getDocumentPath()
    if (documentPath !== this.lastDocumentPath) {
      this.lastDocumentPath = documentPath
      this.lastMarkdown = this.deps.getMarkdown()
      return
    }
    if (this.timer != null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.debounceMs)
  }

  /** 立即处理一次（测试 / 文档关闭前冲刷）。 */
  async flush(): Promise<InsertionRunResult> {
    if (this.disposed) return { ...EMPTY_RESULT }
    if (this.running) return this.running
    this.running = this.process()
      .then(result => {
        this.lastRunAt = this.now()
        return result
      })
      .finally(() => { this.running = null })
    return this.running
  }

  private async process(): Promise<InsertionRunResult> {
    const nextMarkdown = this.deps.getMarkdown()
    if (nextMarkdown == null) return { ...EMPTY_RESULT }
    const settings = this.deps.getSettings()
    const previous = this.lastMarkdown
    this.lastMarkdown = nextMarkdown

    const planned = planInsertionActions({ settings, previousMarkdown: previous, nextMarkdown })
      .filter(decision => !this.produced.has(decision.rawDestination))
    const result: InsertionRunResult = { ...EMPTY_RESULT }
    for (const decision of planned) {
      result.attempted++
      const key = `${decision.action}|${decision.rawDestination}\u0000${decision.rawToken}`
      if (this.handled.has(key)) {
        result.skipped++
        continue
      }
      const outcome = await this.execute(decision)
      if (outcome) {
        this.handled.add(key)
        this.lastMarkdown = this.deps.getMarkdown()
        if (decision.action === 'UPLOAD') result.uploaded++
        else result.localized++
        result.rewritten += outcome.rewritten ? 1 : 0
      } else {
        result.failed++
      }
    }
    return result
  }

  private async execute(decision: InsertionDecision): Promise<{ rewritten: boolean } | null> {
    try {
      if (decision.action === 'UPLOAD') {
        const uploaded = await this.deps.upload(decision.rawDestination)
        if (!uploaded.ok || !uploaded.url || !this.deps.rewrite(decision.rawDestination, uploaded.url)) {
          this.deps.notify?.(
            `墨章：插入了本地图片，但自动上传未完成（${uploaded.message ?? '未返回可用 URL'}）；图片保持原样。`,
            'error',
          )
          return null
        }
        this.deps.notify?.('墨章：已按当前文档设置上传插入的图片并更新引用。', 'info')
        this.produced.add(uploaded.url)
        return { rewritten: true }
      }
      if (decision.action === 'LOCALIZE') {
        const localized = await this.deps.localize(decision.rawDestination)
        if (!localized.ok || !localized.destination
          || !this.deps.rewrite(decision.rawDestination, localized.destination)) {
          this.deps.notify?.(
            `墨章：插入了远程图片，但自动下载未完成（${localized.message ?? '未返回本地路径'}）；图片保持原样。`,
            'error',
          )
          return null
        }
        this.deps.notify?.('墨章：已按当前文档设置下载插入的图片并更新引用。', 'info')
        this.produced.add(localized.destination)
        return { rewritten: true }
      }
      return null
    } catch (error) {
      this.deps.notify?.(`墨章：插入策略执行失败 — ${(error as Error)?.message ?? String(error)}`, 'error')
      return null
    }
  }

  getLastRunAt(): number | null {
    return this.lastRunAt
  }

  private lastRunAt: number | null = null

  dispose(): void {
    this.disposed = true
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

export type { InsertionActionKind }
