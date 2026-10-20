// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  FILE_DROP_TARGET_CLASS,
  FILE_TREE_ROOT_SELECTOR,
  FileTreeDragAdapter,
  type FileTreeDragHost,
} from './file-tree-drag-adapter'
import type { CopyBatchResult } from './file-copy-service'

const ROOT = 'D:\\vault'
const DOCS = 'D:\\vault\\docs'
const NOTE = 'D:\\vault\\note.md'

let adapter: FileTreeDragAdapter | null = null

function resultFor(paths: string[], destinationDir = DOCS): CopyBatchResult {
  const entries = paths.map(source => ({
    source,
    destination: `${destinationDir}\\${source.split('\\').pop()}`,
    status: 'copied' as const,
    conflict: false,
    renamed: false,
    bytes: 1,
  }))
  return {
    entries,
    copiedCount: entries.length,
    skippedCount: 0,
    failedCount: 0,
    conflictCount: 0,
    sourcePreserved: true,
  }
}

function makeDataTransfer(
  types: string[],
  paths: string[] = [],
  uriList = '',
): {
  types: string[]
  files: Array<{ path: string }>
  dropEffect: string
  effectAllowed: string
  getData: (format: string) => string
  setData: (format: string, data: string) => void
} {
  return {
    types,
    files: paths.map(path => ({ path })),
    dropEffect: 'none',
    effectAllowed: 'all',
    getData: (format: string) => (format === 'text/uri-list' ? uriList : ''),
    setData: () => undefined,
  }
}

function fire(
  target: Element,
  type: string,
  dataTransfer: ReturnType<typeof makeDataTransfer> | null,
  relatedTarget: Element | null = null,
): Event {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget })
  target.dispatchEvent(event)
  return event
}

function makeHost(over: Partial<FileTreeDragHost> = {}): FileTreeDragHost {
  return {
    document,
    getVaultRoot: () => ROOT,
    copy: vi.fn(async (sources: string[], destinationDir: string) => resultFor(sources, destinationDir)),
    refreshTree: vi.fn(),
    notify: vi.fn(),
    onDragOutObserved: vi.fn(),
    ...over,
  }
}

function node(selector: string): HTMLElement {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`missing node: ${selector}`)
  return element as HTMLElement
}

function docsContent(): HTMLElement {
  return node('[data-path="D:\\\\vault\\\\docs"] > .file-node-content')
}

function fileContent(): HTMLElement {
  return node('[data-path="D:\\\\vault\\\\note.md"] > .file-node-content')
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="write"><div class="file-node-content">editor body</div></div>
    <div id="file-library">
      <div id="file-library-tree">
        <div class="file-library-node file-tree-node" data-path="D:\\vault\\docs" data-is-directory="true" data-has-sub="true">
          <div class="file-node-content"><span class="file-node-title">docs</span></div>
        </div>
        <div class="file-library-node file-tree-node" data-path="D:\\vault\\note.md" data-is-directory="false" data-has-sub="false">
          <div class="file-node-content"><span class="file-node-title">note.md</span></div>
        </div>
      </div>
    </div>`
})

afterEach(() => {
  adapter?.dispose()
  adapter = null
  document.body.innerHTML = ''
})

describe('FileTreeDragAdapter · external drop is copied, never moved natively', () => {
  it('intercepts the drop before the native bubble handler and copies into the directory node', async () => {
    const host = makeHost()
    adapter = new FileTreeDragAdapter(host)
    adapter.attach()

    let nativeMoveHandlerRan = false
    node(FILE_TREE_ROOT_SELECTOR).addEventListener('drop', () => { nativeMoveHandlerRan = true })

    const event = fire(
      docsContent(),
      'drop',
      makeDataTransfer(['Files'], ['D:\\src\\a.md', 'D:\\src\\b.markdown']),
    )
    await flush()

    expect(nativeMoveHandlerRan).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(host.copy).toHaveBeenCalledWith(
      ['D:\\src\\a.md', 'D:\\src\\b.markdown'],
      DOCS,
    )
    expect(host.refreshTree).toHaveBeenCalledWith(DOCS, [
      `${DOCS}\\a.md`,
      `${DOCS}\\b.markdown`,
    ])
    expect(host.notify).toHaveBeenCalled()
    expect(adapter.getInvariant()).toMatchObject({
      attached: true,
      externalDropCount: 1,
      copiedCount: 2,
      failedCount: 0,
      lastDestination: DOCS,
    })
  })

  it('marks an external dragover as copy and stops the document-level none-effect handler', () => {
    const host = makeHost()
    adapter = new FileTreeDragAdapter(host)
    adapter.attach()

    let nativeDragoverRan = false
    node(FILE_TREE_ROOT_SELECTOR).addEventListener('dragover', () => { nativeDragoverRan = true })

    const dataTransfer = makeDataTransfer(['Files'], ['D:\\src\\a.md'])
    const event = fire(docsContent(), 'dragover', dataTransfer)

    expect(event.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(nativeDragoverRan).toBe(false)
  })

  it('drops on a file node into its parent directory', async () => {
    const host = makeHost()
    adapter = new FileTreeDragAdapter(host)
    adapter.attach()

    fire(fileContent(), 'drop', makeDataTransfer(['Files'], ['D:\\src\\a.md']))
    await flush()

    expect(host.copy).toHaveBeenCalledWith(['D:\\src\\a.md'], ROOT)
  })

  it('drops on the tree background into the vault root', async () => {
    const host = makeHost()
    adapter = new FileTreeDragAdapter(host)
    adapter.attach()

    fire(node(FILE_TREE_ROOT_SELECTOR), 'drop', makeDataTransfer(['Files'], ['D:\\src\\a.md']))
    await flush()

    expect(host.copy).toHaveBeenCalledWith(['D:\\src\\a.md'], ROOT)
  })

  it('accepts text/uri-list when File.path is unavailable', async () => {
    const host = makeHost()
    adapter = new FileTreeDragAdapter(host)
    adapter.attach()

    fire(
      docsContent(),
      'drop',
      makeDataTransfer(['Files'], [], 'file:///D:/src/a.md'),
    )
    await flush()

    expect(host.copy).toHaveBeenCalledWith(['D:\\src\\a.md'], DOCS)
  })
})

describe('FileTreeDragAdapter · scope isolation', () => {
  it('never intercepts editor-body drops', async () => {
    const host = makeHost()
    adapter = new FileTreeDragAdapter(host)
    adapter.attach()

    const event = fire(
      node('#write .file-node-content'),
      'drop',
      makeDataTransfer(['Files'], ['D:\\src\\a.md']),
    )
    await flush()

    expect(host.copy).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves internal file-tree drags untouched', async () => {
    const host = makeHost()
    adapter = new FileTreeDragAdapter(host)
    adapter.attach()

    let bubbleRan = false
    node(FILE_TREE_ROOT_SELECTOR).addEventListener('drop', () => { bubbleRan = true })

    const event = fire(
      docsContent(),
      'drop',
      makeDataTransfer(['file', 'text/plain'], [DOCS]),
    )
    await flush()

    expect(host.copy).not.toHaveBeenCalled()
    expect(bubbleRan).toBe(true)
    expect(event.defaultPrevented).toBe(false)
  })

  it('replaces a previously mounted adapter instead of double-installing listeners', async () => {
    const firstHost = makeHost()
    const first = new FileTreeDragAdapter(firstHost)
    first.attach()

    const secondHost = makeHost()
    const second = new FileTreeDragAdapter(secondHost)
    second.attach()
    adapter = second

    fire(docsContent(), 'drop', makeDataTransfer(['Files'], ['D:\\src\\a.md']))
    await flush()

    expect(firstHost.copy).not.toHaveBeenCalled()
    expect(secondHost.copy).toHaveBeenCalledTimes(1)
  })

  it('allows a fresh adapter after the previous one is disposed', async () => {
    const firstHost = makeHost()
    const first = new FileTreeDragAdapter(firstHost)
    first.attach()
    first.dispose()

    const secondHost = makeHost()
    const second = new FileTreeDragAdapter(secondHost)
    second.attach()
    adapter = second

    fire(docsContent(), 'drop', makeDataTransfer(['Files'], ['D:\\src\\a.md']))
    await flush()

    expect(secondHost.copy).toHaveBeenCalledTimes(1)
  })

  it('dispose removes all listeners', async () => {
    const host = makeHost()
    adapter = new FileTreeDragAdapter(host)
    adapter.attach()
    adapter.dispose()

    let bubbleRan = false
    node(FILE_TREE_ROOT_SELECTOR).addEventListener('drop', () => { bubbleRan = true })

    fire(docsContent(), 'drop', makeDataTransfer(['Files'], ['D:\\src\\a.md']))
    await flush()

    expect(host.copy).not.toHaveBeenCalled()
    expect(bubbleRan).toBe(true)
  })
})

describe('FileTreeDragAdapter · drag-out observation', () => {
  it('observes dragstart without preventing or stopping the native path', async () => {
    const host = makeHost()
    adapter = new FileTreeDragAdapter(host)
    adapter.attach()

    let bubbleRan = false
    node(FILE_TREE_ROOT_SELECTOR).addEventListener('dragstart', () => { bubbleRan = true })

    const event = fire(fileContent(), 'dragstart', makeDataTransfer(['file', 'text/plain']))
    await flush()

    expect(host.onDragOutObserved).toHaveBeenCalledWith({ path: NOTE, isDirectory: false })
    expect(bubbleRan).toBe(true)
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not emit drag-out observations for tree background drags', async () => {
    const host = makeHost()
    adapter = new FileTreeDragAdapter(host)
    adapter.attach()

    fire(node(FILE_TREE_ROOT_SELECTOR), 'dragstart', makeDataTransfer(['file']))
    await flush()

    expect(host.onDragOutObserved).not.toHaveBeenCalled()
  })
})

describe('FileTreeDragAdapter · highlight and busy guard', () => {
  it('highlights the target directory and clears it on dragleave', () => {
    const host = makeHost()
    adapter = new FileTreeDragAdapter(host)
    adapter.attach()

    fire(docsContent(), 'dragenter', makeDataTransfer(['Files'], ['D:\\src\\a.md']))
    const docsNode = node('[data-path="D:\\\\vault\\\\docs"]')
    expect(docsNode.classList.contains(FILE_DROP_TARGET_CLASS)).toBe(true)
    expect(adapter.getInvariant().highlighted).toBe(true)

    fire(docsContent(), 'dragleave', makeDataTransfer(['Files']), node('#write'))
    expect(docsNode.classList.contains(FILE_DROP_TARGET_CLASS)).toBe(false)
    expect(adapter.getInvariant().highlighted).toBe(false)
  })

  it('rejects a second drop while a batch is still copying', async () => {
    let resolveCopy: (value: CopyBatchResult) => void = () => undefined
    const host = makeHost({
      copy: vi.fn(() => new Promise<CopyBatchResult>(resolve => { resolveCopy = resolve })),
    })
    adapter = new FileTreeDragAdapter(host)
    adapter.attach()

    fire(docsContent(), 'drop', makeDataTransfer(['Files'], ['D:\\src\\a.md']))
    fire(docsContent(), 'drop', makeDataTransfer(['Files'], ['D:\\src\\b.md']))

    expect(host.copy).toHaveBeenCalledTimes(1)
    expect(host.notify).toHaveBeenCalledWith('墨章：上一批文件仍在导入，请稍候', 'info')

    resolveCopy(resultFor(['D:\\src\\a.md']))
    await flush()
    expect(adapter.getInvariant().processing).toBe(false)
  })
})
