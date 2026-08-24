// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { CaptionService, type CaptionServiceContext } from './caption-service'
import { CaptionContextMenu, captionMenuLabels } from './caption-context-menu'
import { setCaptionVaultRootForTesting, clearCaptionVaultRootForTesting } from './caption-store'
import { readImageAlt } from './figure-alt-binding'

const TEST_VAULT = (() => {
  const dir = path.join(os.tmpdir(), `inkchapter-caption-menu-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
})()

function cleanStore(): void {
  const dir = path.join(TEST_VAULT, '.typora', 'inkchapter', 'captions')
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f))
  }
}

function makeRoot(): HTMLElement {
  const root = document.createElement('div')
  root.id = 'write'
  document.body.appendChild(root)
  return root
}

function addTable(root: HTMLElement, text = 'cell'): HTMLElement {
  const t = document.createElement('table')
  const tr = document.createElement('tr')
  const td = document.createElement('td')
  td.textContent = text
  tr.appendChild(td)
  t.appendChild(tr)
  root.appendChild(t)
  return t
}

function addImage(root: HTMLElement, src = 'a.png'): HTMLElement {
  const p = document.createElement('p')
  const im = document.createElement('img')
  im.setAttribute('src', src)
  p.appendChild(im)
  root.appendChild(p)
  return im
}

function markdownFromRoot(root: HTMLElement): string {
  const lines: string[] = []
  root.querySelectorAll('img').forEach(img => {
    const alt = img.getAttribute('alt') ?? ''
    const src = img.getAttribute('src') ?? ''
    lines.push(`![${alt}](${src})`)
  })
  return lines.join('\n\n')
}

function createMarkdownState(root: HTMLElement): { getMarkdown: () => string; reload: (md: string) => void } {
  let md = markdownFromRoot(root)
  return {
    getMarkdown: () => md,
    reload: (newMd: string) => {
      md = newMd
      // Simulate Typora re-render: sync img alt from markdown source (by occurrence).
      const seen = new Map<string, number>()
      root.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src') ?? ''
        const occ = (seen.get(src) ?? 0) + 1
        seen.set(src, occ)
        img.setAttribute('alt', readImageAlt(md, src, occ) ?? '')
      })
    },
  }
}

function createService(root: HTMLElement, docKey: string): CaptionService {
  const md = createMarkdownState(root)
  const ctx: CaptionServiceContext = {
    vaultRoot: TEST_VAULT,
    getActiveFilePath: () => `/vault/${docKey}.md`,
    getDocumentKey: () => docKey,
    getEditorRoot: () => root,
    // Phase 7R.3.9R: authority-ready test context (committed frame for docKey).
    getCanonicalHeadingFrame: () => ({
      documentKey: docKey,
      semanticRevision: 1,
      editorStructureEpoch: 1,
      frameGeneration: 1,
      semanticFingerprint: 'test-semantic',
      frameFingerprint: 'test-frame',
      entries: [],
      entryByIdentity: new Map(),
    }),
    getMarkdown: md.getMarkdown,
    reloadContent: md.reload,
  }
  const svc = new CaptionService(ctx)
  svc.start()
  // Phase 7R.3.9R: rehydrate-empty/document-open run through the coalescing
  // scheduler (microtask); flush so synchronous assertions see the projection.
  ;(svc as unknown as { reconcileScheduler: { flushNow(): boolean } }).reconcileScheduler.flushNow()
  return svc
}

let services: CaptionService[] = []

beforeEach(() => {
  document.body.innerHTML = ''
  cleanStore()
  setCaptionVaultRootForTesting(TEST_VAULT)
  services = []
})

afterEach(() => {
  for (const s of services) s.dispose()
  services = []
  clearCaptionVaultRootForTesting()
})

describe('captionMenuLabels', () => {
  it('returns table labels', () => {
    expect(captionMenuLabels('table')).toEqual({ set: '设置表名…', edit: '编辑表名…', clear: '清除表名' })
  })

  it('returns figure labels', () => {
    expect(captionMenuLabels('figure')).toEqual({ set: '设置图名…', edit: '编辑图名…', clear: '清除图名' })
  })

  it('returns code labels', () => {
    expect(captionMenuLabels('code')).toEqual({ set: '设置代码片段名称…', edit: '编辑代码片段名称…', clear: '清除代码片段名称' })
  })
})

describe('CaptionContextMenu', () => {
  it('opens a set-name menu when right-clicking a table cell', () => {
    const root = makeRoot()
    const tb = addTable(root)
    const svc = createService(root, 'doc-a')
    services.push(svc)

    const menu = new CaptionContextMenu(svc)
    const dispose = menu.attach(() => root)
    try {
      const td = tb.querySelector('td')!
      td.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
      const menuEl = document.querySelector('.inkchapter-caption-menu')
      expect(menuEl).not.toBeNull()
      expect(menuEl!.textContent).toContain('设置表名')
    } finally {
      dispose()
      menu.dispose()
    }
  })

  it('does not open a menu when right-clicking a non-target (plain text)', () => {
    const root = makeRoot()
    const p = document.createElement('p')
    p.textContent = 'plain text'
    root.appendChild(p)
    const svc = createService(root, 'doc-a')
    services.push(svc)

    const menu = new CaptionContextMenu(svc)
    const dispose = menu.attach(() => root)
    try {
      p.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
      expect(document.querySelector('.inkchapter-caption-menu')).toBeNull()
    } finally {
      dispose()
      menu.dispose()
    }
  })

  it('clicking the set-name item opens the dialog and closes the menu', () => {
    const root = makeRoot()
    const tb = addTable(root)
    const svc = createService(root, 'doc-a')
    services.push(svc)

    const menu = new CaptionContextMenu(svc)
    const dispose = menu.attach(() => root)
    try {
      const td = tb.querySelector('td')!
      td.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
      const item = document.querySelector('.inkchapter-caption-menu__item') as HTMLElement
      expect(item).not.toBeNull()

      item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }))

      // Dialog overlay is appended synchronously by promptCaptionTitle.
      expect(document.querySelector('[data-inkchapter-caption-dialog]')).not.toBeNull()
      // Menu is closed after the action.
      expect(document.querySelector('.inkchapter-caption-menu')).toBeNull()
    } finally {
      dispose()
      menu.dispose()
    }
  })

  it('outside pointerdown closes the menu without opening a dialog', () => {
    const root = makeRoot()
    const tb = addTable(root)
    const svc = createService(root, 'doc-a')
    services.push(svc)

    const menu = new CaptionContextMenu(svc)
    const dispose = menu.attach(() => root)
    try {
      const td = tb.querySelector('td')!
      td.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
      expect(document.querySelector('.inkchapter-caption-menu')).not.toBeNull()

      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      expect(document.querySelector('.inkchapter-caption-menu')).toBeNull()
      expect(document.querySelector('[data-inkchapter-caption-dialog]')).toBeNull()
    } finally {
      dispose()
      menu.dispose()
    }
  })

  it('inside pointerdown keeps the menu available', () => {
    const root = makeRoot()
    const tb = addTable(root)
    const svc = createService(root, 'doc-a')
    services.push(svc)

    const menu = new CaptionContextMenu(svc)
    const dispose = menu.attach(() => root)
    try {
      const td = tb.querySelector('td')!
      td.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
      const item = document.querySelector('.inkchapter-caption-menu__item') as HTMLElement
      expect(item).not.toBeNull()

      item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      expect(document.querySelector('.inkchapter-caption-menu')).not.toBeNull()
    } finally {
      dispose()
      menu.dispose()
    }
  })

  it('right-clicking a named caption shows edit/clear menu (owner path)', () => {
    const root = makeRoot()
    const im = addImage(root, 'a.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)
    svc.setCaption('figure', svc.resolveTargetForElement(im)!, 'okok')

    const menu = new CaptionContextMenu(svc)
    const dispose = menu.attach(() => root)
    try {
      const caption = root.querySelector('[data-inkchapter-caption]') as HTMLElement
      expect(caption).not.toBeNull()
      caption.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))

      const menuEl = document.querySelector('.inkchapter-caption-menu')
      expect(menuEl).not.toBeNull()
      expect(menuEl!.textContent).toContain('编辑图名')
      expect(menuEl!.textContent).toContain('清除图名')
    } finally {
      dispose()
      menu.dispose()
    }
  })

  it('right-clicking an unnamed caption shows set-name menu (owner path)', () => {
    const root = makeRoot()
    const im = addImage(root, 'a.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    const menu = new CaptionContextMenu(svc)
    const dispose = menu.attach(() => root)
    try {
      const caption = root.querySelector('[data-inkchapter-caption]') as HTMLElement
      expect(caption).not.toBeNull()
      caption.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))

      const menuEl = document.querySelector('.inkchapter-caption-menu')
      expect(menuEl).not.toBeNull()
      expect(menuEl!.textContent).toContain('设置图名')
    } finally {
      dispose()
      menu.dispose()
    }
  })

  it('right-clicking the image body still opens the edit/clear menu (regression)', () => {
    const root = makeRoot()
    const im = addImage(root, 'a.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)
    svc.setCaption('figure', svc.resolveTargetForElement(im)!, 'okok')

    const menu = new CaptionContextMenu(svc)
    const dispose = menu.attach(() => root)
    try {
      im.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
      const menuEl = document.querySelector('.inkchapter-caption-menu')
      expect(menuEl).not.toBeNull()
      expect(menuEl!.textContent).toContain('编辑图名')
      expect(menuEl!.textContent).toContain('清除图名')
    } finally {
      dispose()
      menu.dispose()
    }
  })
})
