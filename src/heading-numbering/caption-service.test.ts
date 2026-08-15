// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { CaptionService, type CaptionServiceContext } from './caption-service'
import { setCaptionVaultRootForTesting, clearCaptionVaultRootForTesting } from './caption-store'

const TEST_VAULT = (() => {
  const dir = path.join(os.tmpdir(), `inkchapter-caption-svc-${Date.now()}`)
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

function addCode(root: HTMLElement, text = 'console.log(1)'): HTMLElement {
  const pre = document.createElement('pre')
  const c = document.createElement('code')
  c.textContent = text
  pre.appendChild(c)
  root.appendChild(pre)
  return pre
}

function createService(root: HTMLElement, docKey: string): CaptionService {
  const ctx: CaptionServiceContext = {
    vaultRoot: TEST_VAULT,
    getActiveFilePath: () => `/vault/${docKey}.md`,
    getDocumentKey: () => docKey,
    getEditorRoot: () => root,
  }
  const svc = new CaptionService(ctx)
  svc.start()
  return svc
}

function captionEls(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.inkchapter-caption'))
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

describe('CaptionService orchestration', () => {
  it('sets table/figure/code captions with independent numbering and positions', () => {
    const root = makeRoot()
    const tb = addTable(root)
    const im = addImage(root)
    const cd = addCode(root)
    const svc = createService(root, 'doc-a')
    services.push(svc)

    const tableTarget = svc.resolveTargetForElement(tb)!
    const figureTarget = svc.resolveTargetForElement(im)!
    const codeTarget = svc.resolveTargetForElement(cd)!

    svc.setCaption('table', tableTarget, '实验结果')
    svc.setCaption('figure', figureTarget, '系统架构')
    svc.setCaption('code', codeTarget, '初始化逻辑')

    const els = captionEls(root)
    const text = els.map(e => e.textContent)
    expect(text).toContain('表 1  实验结果')
    expect(text).toContain('图 1  系统架构')
    expect(text).toContain('代码 1  初始化逻辑')

    // Position: table caption before table, figure caption after image <p>.
    const tableCaption = els.find(e => e.textContent!.startsWith('表'))!
    const figureCaption = els.find(e => e.textContent!.startsWith('图'))!
    const codeCaption = els.find(e => e.textContent!.startsWith('代码'))!
    expect(tableCaption.nextElementSibling).toBe(tb)
    expect(figureCaption.previousElementSibling).toBe(im.closest('p'))
    expect(codeCaption.nextElementSibling).toBe(cd)
  })

  it('only captioned targets take numbers; unnamed targets are skipped', () => {
    const root = makeRoot()
    const im1 = addImage(root, '1.png')
    const im2 = addImage(root, '2.png')
    const im3 = addImage(root, '3.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    // Caption only the 2nd and 3rd images.
    svc.setCaption('figure', svc.resolveTargetForElement(im2)!, 'B')
    svc.setCaption('figure', svc.resolveTargetForElement(im3)!, 'C')

    const texts = captionEls(root).map(e => e.textContent)
    expect(texts).toEqual(['图 1  B', '图 2  C'])
    void im1
  })

  it('edits title without changing the number', () => {
    const root = makeRoot()
    const im1 = addImage(root, '1.png')
    const im2 = addImage(root, '2.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('figure', svc.resolveTargetForElement(im1)!, '旧')
    svc.setCaption('figure', svc.resolveTargetForElement(im2)!, '二')
    const rec2 = svc.getCaptionForElement(im2)!

    svc.editCaption(rec2.captionId, '新')
    expect(svc.getResolvedNumber(rec2.captionId)).toBe(2)
    expect(captionEls(root).map(e => e.textContent)).toContain('图 2  新')
  })

  it('deletes caption but preserves target and renumbers followers', () => {
    const root = makeRoot()
    const im1 = addImage(root, '1.png')
    const im2 = addImage(root, '2.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('figure', svc.resolveTargetForElement(im1)!, 'A')
    svc.setCaption('figure', svc.resolveTargetForElement(im2)!, 'B')
    const rec1 = svc.getCaptionForElement(im1)!

    svc.deleteCaption(rec1.captionId)

    // Image preserved, caption removed, follower renumbered to 图 1.
    expect(im1.isConnected).toBe(true)
    expect(svc.getCaptionForElement(im1)).toBeNull()
    expect(captionEls(root).map(e => e.textContent)).toEqual(['图 1  B'])
  })

  it('cleans up caption record when its target is deleted (no orphan)', () => {
    const root = makeRoot()
    const im1 = addImage(root, '1.png')
    const im2 = addImage(root, '2.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('figure', svc.resolveTargetForElement(im1)!, 'A')
    svc.setCaption('figure', svc.resolveTargetForElement(im2)!, 'B')

    // Delete im1 target then refresh (simulate Typora removing the block).
    im1.remove()
    svc.refresh()

    expect(svc.getCaptionCount()).toBe(1)
    expect(captionEls(root).map(e => e.textContent)).toEqual(['图 1  B'])
  })

  it('keeps caption bound when a target moves and renumbers', () => {
    const root = makeRoot()
    const im1 = addImage(root, '1.png')
    const im2 = addImage(root, '2.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('figure', svc.resolveTargetForElement(im1)!, 'A')
    svc.setCaption('figure', svc.resolveTargetForElement(im2)!, 'B')

    // Move im2 before im1 (same DOM node moves).
    root.insertBefore(im2.closest('p')!, im1.closest('p')!)
    svc.refresh()

    const texts = captionEls(root).map(e => e.textContent)
    // Document order now: im2 (B) then im1 (A) → B becomes 图 1.
    expect(texts).toEqual(['图 1  B', '图 2  A'])
  })

  it('gives duplicate-content images independent captions', () => {
    const root = makeRoot()
    const im1 = addImage(root, 'same.png')
    const im2 = addImage(root, 'same.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('figure', svc.resolveTargetForElement(im1)!, '架构')
    svc.setCaption('figure', svc.resolveTargetForElement(im2)!, '细节')

    expect(svc.getCaptionForElement(im1)!.title).toBe('架构')
    expect(svc.getCaptionForElement(im2)!.title).toBe('细节')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['图 1  架构', '图 2  细节'])
  })

  it('rehydrates captions across document close/reopen', () => {
    const root1 = makeRoot()
    const im1 = addImage(root1, '1.png')
    const im2 = addImage(root1, '2.png')
    const svc1 = createService(root1, 'doc-a')
    services.push(svc1)
    svc1.setCaption('figure', svc1.resolveTargetForElement(im1)!, '架构')
    svc1.setCaption('figure', svc1.resolveTargetForElement(im2)!, '细节')

    // Simulate document close/reopen with a fresh root + service.
    document.body.innerHTML = ''
    const root2 = makeRoot()
    const n1 = addImage(root2, '1.png')
    const n2 = addImage(root2, '2.png')
    const svc2 = createService(root2, 'doc-a')
    services.push(svc2)

    expect(captionEls(root2).map(e => e.textContent)).toEqual(['图 1  架构', '图 2  细节'])
    expect(svc2.getCaptionForElement(n1)!.title).toBe('架构')
    expect(svc2.getCaptionForElement(n2)!.title).toBe('细节')
  })

  it('isolates caption state between documents', () => {
    const rootA = makeRoot()
    addImage(rootA, 'a.png')
    const svcA = createService(rootA, 'doc-a')
    services.push(svcA)
    svcA.setCaption('figure', svcA.resolveTargetForElement(rootA.querySelector('img')!)!, 'A')

    document.body.innerHTML = ''
    const rootB = makeRoot()
    addImage(rootB, 'b.png')
    const svcB = createService(rootB, 'doc-b')
    services.push(svcB)

    expect(svcB.getCaptionCount()).toBe(0)
    expect(captionEls(rootB)).toHaveLength(0)
  })
})
