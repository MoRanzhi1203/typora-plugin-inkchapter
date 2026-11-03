/**
 * 传输任务持久化（P10-C）。
 *
 * - 复用索引的「JSON + 临时文件 + rename」原子写模式，不引入数据库。
 * - 任务状态与资产 `availability` 分离：上传失败不等于资产不可用。
 * - 只在任务生命周期节点写盘（入队 / 开始 / 结束），不做高频轮询。
 * - 文件损坏时只报错、不覆盖：用户数据优先于自动修复。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type { TransferTask, TransferTaskKind, TransferTaskStatus } from './image-asset-model'

export const TRANSFER_TASK_SCHEMA_VERSION = 1

interface TransferTaskFile {
  schemaVersion: number
  tasks: TransferTask[]
}

export interface EnqueueTransferTaskInput {
  kind: TransferTaskKind
  assetId: string
  locationId?: string | null
  maxAttempts?: number
  status?: Extract<TransferTaskStatus, 'queued' | 'running'>
  now?: Date
}

export interface UpdateTransferTaskPatch {
  status?: TransferTaskStatus
  attempt?: number
  errorCode?: string | null
  locationId?: string | null
  now?: Date
}

export class ImageTransferTaskStore {
  private tasks: TransferTask[] | null = null
  private loadPromise: Promise<void> | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private counter = 0

  constructor(readonly filePath: string) {}

  async list(): Promise<TransferTask[]> {
    await this.ensureLoaded()
    return (this.tasks ?? []).map(task => ({ ...task }))
  }

  async enqueue(input: EnqueueTransferTaskInput): Promise<TransferTask> {
    await this.ensureLoaded()
    const now = (input.now ?? new Date()).toISOString()
    const task: TransferTask = {
      taskId: this.allocateTaskId(now),
      kind: input.kind,
      status: input.status ?? 'queued',
      assetId: input.assetId,
      locationId: input.locationId ?? null,
      attempt: 0,
      maxAttempts: Math.max(1, input.maxAttempts ?? 3),
      errorCode: null,
      createdAt: now,
      updatedAt: now,
    }
    this.tasks = [...(this.tasks ?? []), task]
    await this.persist()
    return { ...task }
  }

  async update(taskId: string, patch: UpdateTransferTaskPatch): Promise<TransferTask | null> {
    await this.ensureLoaded()
    const tasks = this.tasks ?? []
    const index = tasks.findIndex(task => task.taskId === taskId)
    if (index < 0) return null
    const current = tasks[index]
    const next: TransferTask = {
      ...current,
      status: patch.status ?? current.status,
      attempt: patch.attempt ?? current.attempt,
      errorCode: patch.errorCode === undefined ? current.errorCode : patch.errorCode,
      locationId: patch.locationId === undefined ? current.locationId : patch.locationId,
      updatedAt: (patch.now ?? new Date()).toISOString(),
    }
    this.tasks = tasks.map((task, position) => (position === index ? next : task))
    await this.persist()
    return { ...next }
  }

  /** 只保留最近的 `maxTasks` 条，避免任务文件无限增长。 */
  async prune(maxTasks = 200): Promise<number> {
    await this.ensureLoaded()
    const tasks = this.tasks ?? []
    if (tasks.length <= maxTasks) return 0
    const removed = tasks.length - maxTasks
    this.tasks = tasks.slice(tasks.length - maxTasks)
    await this.persist()
    return removed
  }

  private allocateTaskId(now: string): string {
    this.counter += 1
    return `task_${now.replace(/[-:.TZ]/g, '')}_${this.counter}`
  }

  private async ensureLoaded(): Promise<void> {
    if (this.tasks) return
    if (!this.loadPromise) {
      this.loadPromise = this.load().catch(error => {
        this.loadPromise = null
        throw error
      })
    }
    await this.loadPromise
  }

  private async load(): Promise<void> {
    let raw: string
    try {
      raw = await fs.readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.tasks = []
        return
      }
      throw new Error(`transfer task read failed: ${(error as Error).message}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('transfer task file is corrupt')
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('transfer task file is corrupt')
    const file = parsed as Partial<TransferTaskFile>
    if (!Array.isArray(file.tasks) || !file.tasks.every(isTransferTask)) {
      throw new Error('transfer task file is corrupt')
    }
    this.tasks = file.tasks.map(task => ({ ...task }))
  }

  private async persist(): Promise<void> {
    await this.enqueueWrite(async () => {
      const payload: TransferTaskFile = {
        schemaVersion: TRANSFER_TASK_SCHEMA_VERSION,
        tasks: (this.tasks ?? []).map(task => ({ ...task })),
      }
      const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true })
        await fs.writeFile(temporary, JSON.stringify(payload, null, 2), 'utf8')
        await fs.rename(temporary, this.filePath)
      } catch (error) {
        try { await fs.unlink(temporary) } catch { /* 临时文件不存在时忽略 */ }
        throw new Error(`transfer task write failed: ${(error as Error).message}`)
      }
    })
  }

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    const run = this.writeQueue.then(task, task)
    this.writeQueue = run.then(() => undefined, () => undefined)
    return run
  }
}

function isTransferTask(value: unknown): value is TransferTask {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<TransferTask>
  return typeof task.taskId === 'string'
    && typeof task.kind === 'string'
    && typeof task.status === 'string'
    && typeof task.assetId === 'string'
    && typeof task.attempt === 'number'
    && typeof task.createdAt === 'string'
}
