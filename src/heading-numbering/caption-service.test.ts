// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { CaptionService, classifyCaptionMutationBatch, type CaptionServiceContext } from './caption-service'
import { setCaptionVaultRootForTesting, clearCaptionVaultRootForTesting, saveCaptionStore } from './caption-store'
import { DEFAULT_CAPTION_SETTINGS, type CaptionSettings, type CaptionRecord } from './caption-system'
import { readImageAlt } from './figure-alt-binding'
import { hashText } from './paragraph-layout-store'
import { buildHeadingNumberingSnapshotForRevision } from './heading-numbering-snapshot'
import { DEFAULT_SETTINGS } from '../settings/default-settings'

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
  pre.classList.add('md-fences')
  const c = document.createElement('code')
  c.textContent = text
  pre.appendChild(c)
  root.appendChild(pre)
  return pre
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
    getHeadingNumberingSnapshot: () => buildHeadingNumberingSnapshotForRevision([], DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault, undefined, undefined, 1, docKey),
    getMarkdown: md.getMarkdown,
    reloadContent: md.reload,
  }
  const svc = new CaptionService(ctx)
  svc.start()
  return svc
}

function createServiceWithMarkdown(root: HTMLElement, docKey: string): { svc: CaptionService; getMarkdown: () => string } {
  const md = createMarkdownState(root)
  const ctx: CaptionServiceContext = {
    vaultRoot: TEST_VAULT,
    getActiveFilePath: () => `/vault/${docKey}.md`,
    getDocumentKey: () => docKey,
    getEditorRoot: () => root,
    getHeadingNumberingSnapshot: () => buildHeadingNumberingSnapshotForRevision([], DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault, undefined, undefined, 1, docKey),
    getMarkdown: md.getMarkdown,
    reloadContent: md.reload,
  }
  const svc = new CaptionService(ctx)
  svc.start()
  return { svc, getMarkdown: md.getMarkdown }
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
    expect(text).toContain('表 1 实验结果')
    expect(text).toContain('图 1 系统架构')
    expect(text).toContain('代码 1 初始化逻辑')

    // Position: table caption before table, figure caption after image <p>.
    const tableCaption = els.find(e => e.textContent!.startsWith('表'))!
    const figureCaption = els.find(e => e.textContent!.startsWith('图'))!
    const codeCaption = els.find(e => e.textContent!.startsWith('代码'))!
    expect(tableCaption.nextElementSibling).toBe(tb)
    expect(figureCaption.previousElementSibling).toBe(im.closest('p'))
    expect(codeCaption.nextElementSibling).toBe(cd)
  })

  it('all enabled live targets participate; unnamed targets get number-only caption', () => {
    const root = makeRoot()
    const im1 = addImage(root, '1.png')
    const im2 = addImage(root, '2.png')
    const im3 = addImage(root, '3.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    // Name only the 2nd and 3rd images; the 1st stays unnamed.
    svc.setCaption('figure', svc.resolveTargetForElement(im2)!, 'B')
    svc.setCaption('figure', svc.resolveTargetForElement(im3)!, 'C')

    const texts = captionEls(root).map(e => e.textContent)
    expect(texts).toEqual(['图 1', '图 2 B', '图 3 C'])
    void im1
  })

  it('edits title without changing the number (table sidecar)', () => {
    const root = makeRoot()
    const tb1 = addTable(root, '1')
    const tb2 = addTable(root, '2')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(tb1)!, '旧')
    svc.setCaption('table', svc.resolveTargetForElement(tb2)!, '二')
    const rec2 = svc.getCaptionForElement(tb2)!

    svc.editCaption(rec2.captionId, '新')
    expect(svc.getResolvedNumber(rec2.captionId)).toBe(2)
    expect(captionEls(root).map(e => e.textContent)).toContain('表 2 新')
  })

  it('deletes caption but preserves target and renumbers followers (table sidecar)', () => {
    const root = makeRoot()
    const tb1 = addTable(root, '1')
    const tb2 = addTable(root, '2')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(tb1)!, 'A')
    svc.setCaption('table', svc.resolveTargetForElement(tb2)!, 'B')
    const rec1 = svc.getCaptionForElement(tb1)!

    svc.deleteCaption(rec1.captionId)

    // Target preserved, name cleared → tb1 falls back to number-only, tb2 renumbered.
    expect(tb1.isConnected).toBe(true)
    expect(svc.getCaptionForElement(tb1)).toBeNull()
    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1', '表 2 B'])
  })

  it('cleans up caption record when its target is deleted (no orphan)', () => {
    const root = makeRoot()
    const tb1 = addTable(root, '1')
    const tb2 = addTable(root, '2')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(tb1)!, 'A')
    svc.setCaption('table', svc.resolveTargetForElement(tb2)!, 'B')

    // Delete tb1 target then refresh (simulate Typora removing the block).
    tb1.remove()
    svc.refresh()

    expect(svc.getCaptionCount()).toBe(1)
    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1 B'])
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
    expect(texts).toEqual(['图 1 B', '图 2 A'])
  })

  it('gives duplicate-content tables independent captions (sidecar)', () => {
    const root = makeRoot()
    const tb1 = addTable(root, 'same')
    const tb2 = addTable(root, 'same')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(tb1)!, '架构')
    svc.setCaption('table', svc.resolveTargetForElement(tb2)!, '细节')

    expect(svc.getCaptionForElement(tb1)!.title).toBe('架构')
    expect(svc.getCaptionForElement(tb2)!.title).toBe('细节')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1 架构', '表 2 细节'])
  })

  it('rehydrates table captions across document close/reopen (sidecar)', () => {
    const root1 = makeRoot()
    const tb1 = addTable(root1, '1')
    const tb2 = addTable(root1, '2')
    const svc1 = createService(root1, 'doc-a')
    services.push(svc1)
    svc1.setCaption('table', svc1.resolveTargetForElement(tb1)!, '架构')
    svc1.setCaption('table', svc1.resolveTargetForElement(tb2)!, '细节')

    // Simulate document close/reopen with a fresh root + service.
    document.body.innerHTML = ''
    const root2 = makeRoot()
    const n1 = addTable(root2, '1')
    const n2 = addTable(root2, '2')
    const svc2 = createService(root2, 'doc-a')
    services.push(svc2)

    expect(captionEls(root2).map(e => e.textContent)).toEqual(['表 1 架构', '表 2 细节'])
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
    // doc-b's unnamed image still auto-renders 图 1, but no name leaked from doc-a.
    expect(captionEls(rootB).map(e => e.textContent)).toEqual(['图 1'])
  })

  it('applySettings disables a type → its captions are removed, others remain', () => {
    const root = makeRoot()
    const tb = addTable(root)
    const im = addImage(root)
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(tb)!, '表A')
    svc.setCaption('figure', svc.resolveTargetForElement(im)!, '图A')
    expect(captionEls(root)).toHaveLength(2)

    const settings: CaptionSettings = JSON.parse(JSON.stringify(DEFAULT_CAPTION_SETTINGS))
    settings.types.figure.enabled = false
    svc.applySettings(settings)

    const texts = captionEls(root).map(e => e.textContent)
    expect(texts).toEqual(['表 1 表A'])
  })

  it('applySettings changes prefix immediately', () => {
    const root = makeRoot()
    const tb = addTable(root)
    const svc = createService(root, 'doc-a')
    services.push(svc)
    svc.setCaption('table', svc.resolveTargetForElement(tb)!, '用户表')

    const settings: CaptionSettings = JSON.parse(JSON.stringify(DEFAULT_CAPTION_SETTINGS))
    settings.types.table.prefix = 'Table'
    svc.applySettings(settings)

    expect(captionEls(root).map(e => e.textContent)).toEqual(['Table 1 用户表'])
  })

  it('applySettings changes position immediately (table above → below)', () => {
    const root = makeRoot()
    const tb = addTable(root)
    const svc = createService(root, 'doc-a')
    services.push(svc)
    svc.setCaption('table', svc.resolveTargetForElement(tb)!, '数据')

    const settings: CaptionSettings = JSON.parse(JSON.stringify(DEFAULT_CAPTION_SETTINGS))
    settings.types.table.position = 'below'
    svc.applySettings(settings)

    const cap = captionEls(root)[0]
    expect(cap.previousElementSibling).toBe(tb)
  })

  it('unnamed table renders 表 1 automatically', () => {
    const root = makeRoot()
    addTable(root)
    const svc = createService(root, 'doc-a')
    services.push(svc)

    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1'])
  })

  it('two tables with only the second named → 表 1 and 表 2 实验结果', () => {
    const root = makeRoot()
    const tb1 = addTable(root, 'a')
    const tb2 = addTable(root, 'b')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(tb2)!, '实验结果')

    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1', '表 2 实验结果'])
    void tb1
  })

  it('unnamed image → 图 1 and named image → 图 1 架构图', () => {
    const root = makeRoot()
    addImage(root, 'a.png')
    const im2 = addImage(root, 'b.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)
    svc.setCaption('figure', svc.resolveTargetForElement(im2)!, '架构图')

    expect(captionEls(root).map(e => e.textContent)).toEqual(['图 1', '图 2 架构图'])
  })

  it('unnamed code → 代码 1 and named code → 代码 1 初始化逻辑', () => {
    const root = makeRoot()
    addCode(root, 'a()')
    const cd2 = addCode(root, 'b()')
    const svc = createService(root, 'doc-a')
    services.push(svc)
    svc.setCaption('code', svc.resolveTargetForElement(cd2)!, '初始化逻辑')

    expect(captionEls(root).map(e => e.textContent)).toEqual(['代码 1', '代码 2 初始化逻辑'])
  })

  it('enabled=false hides all captions; re-enable restores', () => {
    const root = makeRoot()
    addTable(root)
    addImage(root, 'a.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)
    expect(captionEls(root)).toHaveLength(2)

    const settings: CaptionSettings = JSON.parse(JSON.stringify(DEFAULT_CAPTION_SETTINGS))
    settings.types.table.enabled = false
    svc.applySettings(settings)
    expect(captionEls(root).map(e => e.textContent)).toEqual(['图 1'])

    settings.types.table.enabled = true
    svc.applySettings(settings)
    expect(captionEls(root)).toHaveLength(2)
  })

  it('deleting a leading object renumbers but names stay with correct objects', () => {
    const root = makeRoot()
    const tb1 = addTable(root, 'a')
    const tb2 = addTable(root, 'b')
    const tb3 = addTable(root, 'c')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(tb2)!, '结果')

    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1', '表 2 结果', '表 3'])

    // Delete leading T1.
    tb1.remove()
    svc.refresh()

    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1 结果', '表 2'])
  })

  it('inserting a leading object renumbers while name identity stays stable', () => {
    const root = makeRoot()
    const tb1 = addTable(root, 'a')
    const tb2 = addTable(root, 'b')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(tb2)!, 'A')

    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1', '表 2 A'])

    // Insert new leading table T0.
    const tb0 = addTable(root, 'z')
    root.insertBefore(tb0, tb1)
    svc.refresh()

    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1', '表 2', '表 3 A'])
  })

  it('code A + math + code B renders only 代码 1 / 代码 2 (math excluded)', () => {
    const root = makeRoot()
    const codeA = addCode(root, 'A')

    const math = document.createElement('div')
    math.className = 'md-math-block'
    const mathPre = document.createElement('pre')
    mathPre.className = 'CodeMirror-line'
    mathPre.textContent = 'a+b'
    math.appendChild(mathPre)
    root.appendChild(math)

    const codeB = addCode(root, 'B')

    const svc = createService(root, 'doc-a')
    services.push(svc)

    expect(captionEls(root).map(e => e.textContent)).toEqual(['代码 1', '代码 2'])
    // The math editor's internal PRE must never carry a code caption.
    expect(math.querySelector('[data-inkchapter-caption]')).toBeNull()
    void codeA; void codeB
  })

  it('set name then clear name for a table (caption stays number-only)', () => {
    const root = makeRoot()
    const tb = addTable(root)
    const svc = createService(root, 'doc-a')
    services.push(svc)

    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1'])

    svc.setCaption('table', svc.resolveTargetForElement(tb)!, '实验结果')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1 实验结果'])

    const rec = svc.getCaptionForElement(tb)!
    svc.deleteCaption(rec.captionId)
    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1'])
  })

  it('empty name in setCaption clears existing name (no placeholder record)', () => {
    const root = makeRoot()
    const tb = addTable(root)
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(tb)!, '实验结果')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1 实验结果'])

    svc.setCaption('table', svc.resolveTargetForElement(tb)!, '   ')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1'])
    expect(svc.getCaptionCount()).toBe(0)
  })

  it('name follows object when a leading table is inserted', () => {
    const root = makeRoot()
    const tb1 = addTable(root, 'a')
    const tb2 = addTable(root, 'b')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(tb1)!, '用户表')
    svc.setCaption('table', svc.resolveTargetForElement(tb2)!, '订单表')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1 用户表', '表 2 订单表'])

    const tb0 = addTable(root, 'z')
    root.insertBefore(tb0, tb1)
    svc.refresh()

    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1', '表 2 用户表', '表 3 订单表'])
  })

  it('name does not drift when a leading object is deleted', () => {
    const root = makeRoot()
    const tb1 = addTable(root, 'a')
    const tb2 = addTable(root, 'b')
    const tb3 = addTable(root, 'c')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(tb2)!, 'B')
    svc.setCaption('table', svc.resolveTargetForElement(tb3)!, 'C')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1', '表 2 B', '表 3 C'])

    tb1.remove()
    svc.refresh()
    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1 B', '表 2 C'])
  })

  it('figure names bind to Markdown alt and survive reopen via alt', () => {
    document.body.innerHTML = ''
    const root1 = makeRoot()
    const i1 = addImage(root1, 'same.png')
    const i2 = addImage(root1, 'same.png')
    const svc1 = createService(root1, 'doc-a')
    services.push(svc1)
    svc1.setCaption('figure', svc1.resolveTargetForElement(i1)!, '前端结构')
    svc1.setCaption('figure', svc1.resolveTargetForElement(i2)!, '后端结构')
    expect(captionEls(root1).map(e => e.textContent)).toEqual(['图 1 前端结构', '图 2 后端结构'])
    expect(i1.getAttribute('alt')).toBe('前端结构')
    expect(i2.getAttribute('alt')).toBe('后端结构')

    // Reopen: new root has imgs whose alt reflects the persisted Markdown.
    document.body.innerHTML = ''
    const root2 = makeRoot()
    const n1 = addImage(root2, 'same.png')
    const n2 = addImage(root2, 'same.png')
    n1.setAttribute('alt', '前端结构')
    n2.setAttribute('alt', '后端结构')
    const svc2 = createService(root2, 'doc-a')
    services.push(svc2)

    expect(captionEls(root2).map(e => e.textContent)).toEqual(['图 1 前端结构', '图 2 后端结构'])
  })

  it('duplicate code blocks keep independent names across reopen', () => {
    document.body.innerHTML = ''
    const root1 = makeRoot()
    addCode(root1, 'console.log(1)')
    addCode(root1, 'console.log(1)')
    const svc1 = createService(root1, 'doc-a')
    services.push(svc1)
    svc1.setCaption('code', svc1.resolveTargetForElement(root1.querySelectorAll('pre')[0])!, '初始化')
    svc1.setCaption('code', svc1.resolveTargetForElement(root1.querySelectorAll('pre')[1])!, '清理')
    expect(captionEls(root1).map(e => e.textContent)).toEqual(['代码 1 初始化', '代码 2 清理'])

    document.body.innerHTML = ''
    const root2 = makeRoot()
    addCode(root2, 'console.log(1)')
    addCode(root2, 'console.log(1)')
    const svc2 = createService(root2, 'doc-a')
    services.push(svc2)

    expect(captionEls(root2).map(e => e.textContent)).toEqual(['代码 1 初始化', '代码 2 清理'])
  })

  it('duplicate tables keep independent names', () => {
    const root = makeRoot()
    const t1 = addTable(root, 'same')
    const t2 = addTable(root, 'same')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(t1)!, '输入数据')
    svc.setCaption('table', svc.resolveTargetForElement(t2)!, '输出数据')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1 输入数据', '表 2 输出数据'])
  })

  it('cleared name keeps target eligible and rendered', () => {
    const root = makeRoot()
    const tb = addTable(root)
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('table', svc.resolveTargetForElement(tb)!, '实验数据')
    const rec = svc.getCaptionForElement(tb)!
    svc.deleteCaption(rec.captionId)

    expect(captionEls(root).map(e => e.textContent)).toEqual(['表 1'])
    const eligibility = (svc.probe() as any).eligibility
    expect(eligibility.table.eligibleCount).toBe(1)
    expect(eligibility.table.renderedCount).toBe(1)
  })

  it('caption owner resolves to the same figure name (alt source, no record)', () => {
    const root = makeRoot()
    const im = addImage(root, 'a.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('figure', svc.resolveTargetForElement(im)!, 'okok')
    expect(im.getAttribute('alt')).toBe('okok')

    const caption = root.querySelector('[data-inkchapter-caption]') as HTMLElement
    const owner = svc.resolveCaptionOwner(caption)!
    expect(owner.type).toBe('figure')
    expect(owner.currentName).toBe('okok')
    expect(owner.recordId).toBeNull()

    // Edit via caption owner → writes Markdown alt, caption updates (no new record).
    svc.setCaption('figure', owner.target, '系统架构')
    expect(svc.getCaptionCount()).toBe(0)
    expect(im.getAttribute('alt')).toBe('系统架构')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['图 1 系统架构'])
  })

  it('clearing name via caption owner clears alt but keeps the numbered caption', () => {
    const root = makeRoot()
    const im = addImage(root, 'a.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    svc.setCaption('figure', svc.resolveTargetForElement(im)!, 'okok')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['图 1 okok'])
    expect(im.getAttribute('alt')).toBe('okok')

    svc.clearCaptionName('figure', svc.resolveTargetForElement(im)!)
    expect(im.getAttribute('alt')).toBe('')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['图 1'])
  })

  it('caption owner BLOCKs when targetKey owner is missing', () => {
    const root = makeRoot()
    addImage(root, 'a.png')
    const svc = createService(root, 'doc-a')
    services.push(svc)

    const orphan = document.createElement('div')
    orphan.setAttribute('data-inkchapter-caption', 'true')
    orphan.setAttribute('data-inkchapter-caption-type', 'figure')
    orphan.setAttribute('data-inkchapter-caption-target-key', 'figure:anon:1')
    root.appendChild(orphan)

    expect(svc.resolveCaptionOwner(orphan)).toBeNull()
  })

  it('migrates legacy sidecar figure name to Markdown alt when alt is empty', () => {
    const root = makeRoot()
    addImage(root, 'a.png')
    // Seed a legacy figure sidecar record (old SIDECAR semantics).
    saveCaptionStore('doc-a', '/vault/doc-a.md', [{
      captionId: 'legacy-fig-1',
      documentKey: 'doc-a',
      type: 'figure',
      title: '系统架构',
      targetAnchor: { type: 'figure', ordinal: 0, contentSignature: hashText('a.png'), occurrence: 1 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }])

    const svc = createService(root, 'doc-a')
    services.push(svc)

    // Legacy sidecar name migrated to Markdown alt; figure record dropped.
    const img = root.querySelector('img')!
    expect(img.getAttribute('alt')).toBe('系统架构')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['图 1 系统架构'])
    expect(svc.getCaptionCount()).toBe(0)
  })

  it('Markdown alt wins over conflicting legacy sidecar figure name (ALT_WINS)', () => {
    const root = makeRoot()
    const img = addImage(root, 'a.png')
    img.setAttribute('alt', '新名称')
    // Seed a conflicting legacy figure sidecar record.
    saveCaptionStore('doc-a', '/vault/doc-a.md', [{
      captionId: 'legacy-fig-2',
      documentKey: 'doc-a',
      type: 'figure',
      title: '旧名称',
      targetAnchor: { type: 'figure', ordinal: 0, contentSignature: hashText('a.png'), occurrence: 1 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }])

    const svc = createService(root, 'doc-a')
    services.push(svc)

    // Markdown alt is authoritative; sidecar is not applied.
    expect(img.getAttribute('alt')).toBe('新名称')
    expect(captionEls(root).map(e => e.textContent)).toEqual(['图 1 新名称'])
    expect(svc.getCaptionCount()).toBe(0)
  })

  it('figure alt write changes the editor markdown source (not just img.alt)', () => {
    const root = makeRoot()
    const im = addImage(root, 'a.png')
    const { svc, getMarkdown } = createServiceWithMarkdown(root, 'doc-a')
    services.push(svc)

    svc.setCaption('figure', svc.resolveTargetForElement(im)!, '系统架构')

    // The Markdown source string itself is rewritten; the raw path is preserved.
    expect(getMarkdown()).toBe('![系统架构](a.png)')
    expect(readImageAlt(getMarkdown(), 'a.png', 1)).toBe('系统架构')
    expect(im.getAttribute('src')).toBe('a.png')
  })

  it('figure alt write preserves an encoded path unchanged', () => {
    const root = makeRoot()
    const im = addImage(root, '../../Downloads/a%20b.png')
    const { svc, getMarkdown } = createServiceWithMarkdown(root, 'doc-a')
    services.push(svc)

    svc.setCaption('figure', svc.resolveTargetForElement(im)!, '测试')

    // Only alt changes; the percent-encoded path stays byte-for-byte identical.
    expect(getMarkdown()).toBe('![测试](../../Downloads/a%20b.png)')
    expect(im.getAttribute('src')).toBe('../../Downloads/a%20b.png')
  })

  it('normalizeLocalImagePaths writes readable local path and leaves remote URL unchanged', () => {
    const root = makeRoot()
    const im1 = addImage(root, '../../Downloads/ChatGPT%20Image%202026%E5%B9%B4.png')
    im1.setAttribute('alt', 'tst')
    const im2 = addImage(root, 'https://example.com/a%20b.png')
    im2.setAttribute('alt', 'HTTP')
    const { svc, getMarkdown } = createServiceWithMarkdown(root, 'doc-a')
    services.push(svc)

    const result = svc.normalizeLocalImagePaths()

    expect(result.normalized).toBe(1)
    expect(getMarkdown()).toContain('![tst](<../../Downloads/ChatGPT Image 2026年.png>)')
    expect(getMarkdown()).toContain('![HTTP](https://example.com/a%20b.png)')
  })
})

describe('classifyCaptionMutationBatch', () => {
  function capture(container: HTMLElement, mutate: () => void): MutationRecord[] {
    const observer = new MutationObserver(() => {})
    observer.observe(container, { childList: true, subtree: true })
    mutate()
    const records = observer.takeRecords()
    observer.disconnect()
    return records
  }

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('caption-decoration-only added node → SELF_ONLY', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const records = capture(container, () => {
      const caption = document.createElement('div')
      caption.setAttribute('data-inkchapter-caption', 'true')
      container.appendChild(caption)
    })
    expect(classifyCaptionMutationBatch(records)).toBe('SELF_ONLY')
  })

  it('caption text update (target=caption) → SELF_ONLY', () => {
    const container = document.createElement('div')
    const caption = document.createElement('div')
    caption.setAttribute('data-inkchapter-caption', 'true')
    caption.textContent = '图 1'
    container.appendChild(caption)
    document.body.appendChild(container)

    const records = capture(container, () => {
      caption.textContent = '图 1  A'
    })
    expect(classifyCaptionMutationBatch(records)).toBe('SELF_ONLY')
  })

  it('real content mutation → CONTENT_RELEVANT', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const records = capture(container, () => {
      const p = document.createElement('p')
      p.textContent = 'real content'
      container.appendChild(p)
    })
    expect(classifyCaptionMutationBatch(records)).toBe('CONTENT_RELEVANT')
  })

  it('caption + real content mutation → MIXED', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const records = capture(container, () => {
      const caption = document.createElement('div')
      caption.setAttribute('data-inkchapter-caption', 'true')
      container.appendChild(caption)
      const p = document.createElement('p')
      p.textContent = 'real content'
      container.appendChild(p)
    })
    expect(classifyCaptionMutationBatch(records)).toBe('MIXED')
  })
})
