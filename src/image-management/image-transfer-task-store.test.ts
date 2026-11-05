import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ImageTransferTaskStore } from './image-transfer-task-store'

const roots: string[] = []

async function makeStore(): Promise<{ root: string; store: ImageTransferTaskStore; file: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-tasks-'))
  roots.push(root)
  const file = path.join(root, 'transfer-tasks.json')
  return { root, store: new ImageTransferTaskStore(file), file }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

describe('ImageTransferTaskStore', () => {
  it('persists enqueue/update across instances without merging into availability', async () => {
    const { store, file } = await makeStore()
    const task = await store.enqueue({ kind: 'upload', assetId: 'img_a', now: new Date('2026-11-04T01:00:00Z') })
    expect(task.status).toBe('queued')

    const running = await store.update(task.taskId, { status: 'running', attempt: 1 })
    expect(running).toMatchObject({ status: 'running', attempt: 1, errorCode: null })

    const reloaded = new ImageTransferTaskStore(file)
    const tasks = await reloaded.list()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ taskId: task.taskId, status: 'running', attempt: 1 })
  })

  it('records failure codes and keeps the task list bounded', async () => {
    const { store } = await makeStore()
    for (let index = 0; index < 5; index++) {
      await store.enqueue({ kind: 'upload', assetId: `img_${index}` })
    }
    const tasks = await store.list()
    const failed = await store.update(tasks[0].taskId, { status: 'failed', errorCode: 'PICGO_EMPTY_RESULT' })
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'PICGO_EMPTY_RESULT' })

    expect(await store.prune(3)).toBe(2)
    expect(await store.list()).toHaveLength(3)
  })

  it('refuses to overwrite a corrupt task file', async () => {
    const { store, file } = await makeStore()
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '{not json', 'utf8')

    await expect(store.list()).rejects.toThrow('corrupt')
    expect(await fs.readFile(file, 'utf8')).toBe('{not json')
  })

  it('refuses to load tasks with unknown kind or status', async () => {
    const { store, file } = await makeStore()
    const base = {
      taskId: 'task_1',
      kind: 'upload',
      status: 'queued',
      assetId: 'img_a',
      locationId: null,
      attempt: 0,
      maxAttempts: 3,
      errorCode: null,
      createdAt: '2026-11-04T00:00:00.000Z',
      updatedAt: '2026-11-04T00:00:00.000Z',
    }
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, tasks: [{ ...base, status: 'bogus' }] }), 'utf8')
    await expect(store.list()).rejects.toThrow('corrupt')

    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, tasks: [{ ...base, kind: 'teleport' }] }), 'utf8')
    await expect(new ImageTransferTaskStore(file).list()).rejects.toThrow('corrupt')
  })

  it('treats a missing task file as empty', async () => {
    const { store } = await makeStore()
    expect(await store.list()).toEqual([])
  })
})
