// @vitest-environment jsdom
/**
 * 端到端（DOM → 策略 → 真实文件系统）复制证据：
 *   - 模拟资源管理器拖入 → 捕获 drop → FileCopyService 真实 copyFile；
 *   - 断言源文件仍在、目标字节一致、原生「移动」处理器未执行；
 *   - 断言文件树收到增量刷新调用。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { FileCopyService } from './file-copy-service'
import { FileTreeDragAdapter } from './file-tree-drag-adapter'

let sandbox = ''
let vault = ''
let docs = ''
let source = ''
let adapter: FileTreeDragAdapter | null = null

function sha256(filePath: string): string {
  return createHash('sha256').update(new Uint8Array(fs.readFileSync(filePath))).digest('hex')
}

function fireDrop(target: Element, filePath: string): Event {
  const dataTransfer = {
    types: ['Files'],
    files: [{ path: filePath }],
    dropEffect: 'none',
    effectAllowed: 'all',
    getData: () => '',
    setData: () => undefined,
  }
  const event = new window.Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  Object.defineProperty(event, 'relatedTarget', { value: null })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-drop-e2e-'))
  vault = path.join(sandbox, 'vault')
  docs = path.join(vault, 'docs')
  fs.mkdirSync(docs, { recursive: true })
  source = path.join(sandbox, 'sources', 'note.md')
  fs.mkdirSync(path.dirname(source), { recursive: true })
  fs.writeFileSync(source, '# 墨章 drag import\n\n真实复制证据。\n', 'utf8')

  document.body.innerHTML = `
    <div id="write"></div>
    <div id="file-library">
      <div id="file-library-tree">
        <div class="file-library-node file-tree-node" data-path="" data-is-directory="true" data-has-sub="true">
          <div class="file-node-content"><span class="file-node-title">docs</span></div>
        </div>
      </div>
    </div>`
  document.querySelector('.file-library-node')?.setAttribute('data-path', docs)
})

afterEach(() => {
  adapter?.dispose()
  adapter = null
  document.body.innerHTML = ''
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true })
})

describe('file tree external drop · end-to-end real copy', () => {
  it('creates a real copy, keeps the source, and refreshes the tree', async () => {
    const service = new FileCopyService()
    const refreshTree = vi.fn()
    const notify = vi.fn()

    adapter = new FileTreeDragAdapter({
      document,
      getVaultRoot: () => vault,
      copy: (sources, destinationDir) => service.copyBatch(sources, destinationDir, {
        vaultRoot: vault,
        conflictPolicy: 'rename',
      }),
      refreshTree,
      notify,
      onDragOutObserved: vi.fn(),
    })
    adapter.attach()

    let nativeMoveHandlerRan = false
    document.getElementById('file-library-tree')?.addEventListener('drop', () => {
      nativeMoveHandlerRan = true
    })

    const target = document.querySelector('.file-library-node > .file-node-content')
    if (!target) throw new Error('missing drop target')
    const sourceHashBefore = sha256(source)
    const event = fireDrop(target, source)

    await vi.waitFor(() => {
      expect(refreshTree).toHaveBeenCalled()
    }, { timeout: 5000 })

    const destination = path.join(docs, 'note.md')
    expect(nativeMoveHandlerRan).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(fs.existsSync(destination)).toBe(true)
    expect(fs.readFileSync(destination, 'utf8')).toBe(fs.readFileSync(source, 'utf8'))
    expect(sha256(destination)).toBe(sourceHashBefore)
    expect(fs.existsSync(source)).toBe(true)
    expect(sha256(source)).toBe(sourceHashBefore)
    expect(refreshTree).toHaveBeenCalledWith(docs, [destination])
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('已复制 1 个文件'), 'info')

    console.log('[EVIDENCE][E2E-DROP]', JSON.stringify({
      source,
      destination,
      sourceHashBefore,
      sourceHashAfter: sha256(source),
      destinationHash: sha256(destination),
      sourceStillExists: fs.existsSync(source),
      destinationExists: fs.existsSync(destination),
      nativeMoveHandlerRan,
    }))
  })

  it('does not copy unsupported extensions but keeps the native handler blocked', async () => {
    const service = new FileCopyService()
    const refreshTree = vi.fn()
    const notify = vi.fn()
    adapter = new FileTreeDragAdapter({
      document,
      getVaultRoot: () => vault,
      copy: (sources, destinationDir) => service.copyBatch(sources, destinationDir, { vaultRoot: vault }),
      refreshTree,
      notify,
      onDragOutObserved: vi.fn(),
    })
    adapter.attach()

    const txt = path.join(sandbox, 'sources', 'note.txt')
    fs.writeFileSync(txt, 'not markdown', 'utf8')
    const target = document.querySelector('.file-library-node > .file-node-content')
    if (!target) throw new Error('missing drop target')

    fireDrop(target, txt)
    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('仅支持 .md / .markdown'), 'warning')
    }, { timeout: 5000 })

    expect(refreshTree).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(docs, 'note.txt'))).toBe(false)
    expect(fs.existsSync(txt)).toBe(true)
  })
})
