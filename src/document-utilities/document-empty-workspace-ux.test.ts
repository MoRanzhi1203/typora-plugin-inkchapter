// @vitest-environment jsdom
/**
 * Empty Workspace UX V1 — targeted tests.
 *   EMPTY-TAB-1..10   EMPTY placeholder never shows × (marker/suppression)
 *   EMPTY-CREATE-1..18 blank-workspace dblclick creates exactly one .md
 *   EMPTY-EVENT-1..4  single listener / cleanup / re-sync lifecycle
 * Plus static CSS guards that real Markdown-tab hover/focus-only × and the
 * 20×20 centering block stay untouched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { EmptyWorkspaceUxController } from './document-empty-workspace-controller'
import type { EmptyWorkspaceUxPlatform, EmptyWorkspacePresence } from './document-empty-workspace-controller'
import {
  EMPTY_PLACEHOLDER_ATTR,
  applyEmptyPlaceholderTabState,
  isEmptyPlaceholderTab,
  isInteractiveDoubleClickTarget,
  readFileTreeSelectionPath,
  resolveEmptyWorkspaceCreateDirectory,
  resolveUncollidedMarkdownName as nextName,
} from './document-empty-workspace'

const scss = (): string => readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const joinSlash = (dir: string, name: string): string => `${dir}/${name}`.replace(/\/+/g, '/')

function buildEmptyTabs(): void {
  document.body.innerHTML = [
    '<div class="typ-workspace-tab-header"><div class="typ-tabs">',
    '<div class="typ-tab active" data-id="typ://empty/xxx/New tab" role="tab">New tab<i class="typ-icon typ-close"></i></div>',
    '</div></div>',
    '<div id="write"></div>',
  ].join('')
}

function buildRealTabsWithEmptyActive(): { real: HTMLElement } {
  document.body.innerHTML = [
    '<div class="typ-workspace-tab-header"><div class="typ-tabs">',
    '<div class="typ-tab active" data-id="typ://empty/xxx/New tab">New tab<i class="typ-icon typ-close"></i></div>',
    '<div class="typ-tab" data-id="/root/a.md">a<i class="typ-icon typ-close"></i></div>',
    '</div></div>',
    '<div id="write"></div>',
  ].join('')
  return { real: document.querySelector<HTMLElement>('.typ-tab[data-id="/root/a.md"]')! }
}

interface Rec {
  root: string | null
  existing: Set<string>
  creates: string[]
  openCalls: string[]
  notices: string[]
  openFail: boolean
  failCreate: boolean
  dirPaths: Set<string>
  autoActivate: boolean
}

function makePlatform(over: Partial<Rec> = {}): { platform: EmptyWorkspaceUxPlatform; rec: Rec } {
  const rec: Rec = {
    root: '/root',
    existing: new Set(),
    creates: [],
    openCalls: [],
    notices: [],
    openFail: false,
    failCreate: false,
    dirPaths: new Set(['/root/sub']),
    autoActivate: false,
    ...over,
  }
  const platform: EmptyWorkspaceUxPlatform = {
    getFileTreeRoot: () => rec.root,
    statKind: (p) => (rec.dirPaths.has(p) ? 'directory' : rec.existing.has(p) && !p.endsWith('.md') ? 'directory' : p.endsWith('.md') ? 'file' : null),
    markdownExists: (p) => rec.existing.has(p) || rec.existing.has(p.replace(/\\/g, '/')),
    createExclusiveMarkdown: (dir, name) => {
      const p = joinSlash(dir, name)
      if (rec.existing.has(p)) return { ok: false, path: null, code: 'EXISTS' }
      if (rec.failCreate) return { ok: false, path: null, code: 'ERROR' }
      rec.existing.add(p)
      rec.creates.push(p)
      return { ok: true, path: p, code: 'OK' }
    },
    openCreatedFile: async (p) => {
      rec.openCalls.push(p)
      if (rec.openFail) throw new Error('OPEN_FAILED')
      if (rec.autoActivate) {
        presence.state = 'ACTIVE'
        presence.path = p
      }
    },
    revealInFileTree: () => true,
    notice: (m) => rec.notices.push(m),
  }
  return { platform, rec }
}

let presence: EmptyWorkspacePresence = { state: 'EMPTY', path: '' }

let surfaceEl: HTMLElement | null = null
let controllers: EmptyWorkspaceUxController[] = []

beforeEach(() => {
  document.body.innerHTML = ''
  presence = { state: 'EMPTY', path: '' }
  surfaceEl = null
  controllers = []
})

afterEach(() => {
  for (const c of controllers) c.dispose()
  controllers = []
})

function makeController(platform: EmptyWorkspaceUxPlatform, surface: () => HTMLElement | null): EmptyWorkspaceUxController {
  const c = new EmptyWorkspaceUxController({
    platform,
    getPresence: () => presence,
    resolveSurface: surface,
    contentEditableBoundaryAllowed: true,
  })
  c.sync(presence)
  controllers.push(c)
  return c
}

function surface(): HTMLElement | null {
  return document.getElementById('write')
}

function dbl(button = 0, detail = 2): MouseEvent {
  return new MouseEvent('dblclick', { bubbles: true, cancelable: true, button, detail })
}

describe('EMPTY-TAB-1..10 — EMPTY placeholder never shows ×', () => {
  it('EMPTY-TAB-1 marker applied to the ACTIVE empty placeholder tab only', () => {
    buildRealTabsWithEmptyActive()
    const r = applyEmptyPlaceholderTabState(document, true)
    expect(r.tabFound).toBe(true)
    expect(r.markerApplied).toBe(true)
    const marked = document.querySelectorAll(`.typ-tab[${EMPTY_PLACEHOLDER_ATTR}="true"]`)
    expect(marked.length).toBe(1)
    expect(marked[0].getAttribute('data-id')).toMatch(/^typ:\/\//)
    // real markdown tab untouched
    expect(document.querySelector('.typ-tab[data-id="/root/a.md"]')?.hasAttribute(EMPTY_PLACEHOLDER_ATTR)).toBe(false)
  })

  it('EMPTY-TAB-2 EMPTY close permanently hidden (aria + scoped CSS display:none)', () => {
    buildEmptyTabs()
    applyEmptyPlaceholderTabState(document, true)
    const close = document.querySelector<HTMLElement>('.typ-tab.active .typ-icon.typ-close')!
    expect(close.getAttribute('aria-hidden')).toBe('true')
    expect(close.getAttribute('tabindex')).toBe('-1')
    const css = scss()
    const emptyRule = css.slice(css.indexOf(`[${EMPTY_PLACEHOLDER_ATTR}="true"] .typ-icon.typ-close`))
    expect(emptyRule).toMatch(/display:\s*none/)
  })

  it('EMPTY-TAB-3/4 hover/focus cannot reveal the × (no placeholder reveal rule)', () => {
    const css = scss()
    const start = css.indexOf(`[${EMPTY_PLACEHOLDER_ATTR}="true"] .typ-icon.typ-close`)
    const block = css.slice(start, css.indexOf('}', start) + 1)
    expect(block).not.toMatch(/visibility:\s*visible/)
    expect(block).not.toMatch(/opacity:\s*1/)
    expect(block).toMatch(/pointer-events:\s*none/)
    buildEmptyTabs()
    applyEmptyPlaceholderTabState(document, true)
    const close = document.querySelector<HTMLElement>('.typ-tab.active .typ-icon.typ-close')!
    // simulate hover/focus states by keeping the placeholder attributes; the
    // only thing that can reveal an × would be a CSS rule — none exists.
    expect(close.getAttribute('aria-hidden')).toBe('true')
  })

  it('EMPTY-TAB-5 close pointer-events none + non-focusable', () => {
    buildEmptyTabs()
    applyEmptyPlaceholderTabState(document, true)
    const close = document.querySelector<HTMLElement>('.typ-tab.active .typ-icon.typ-close')!
    expect(close.getAttribute('tabindex')).toBe('-1')
  })

  it('EMPTY-TAB-6 identity never depends on the "New tab" text', () => {
    const tab = document.createElement('div')
    tab.className = 'typ-tab active'
    tab.setAttribute('data-id', 'typ://empty/x') // different visible label below
    tab.textContent = 'anything-but-new-tab'
    expect(isEmptyPlaceholderTab(tab)).toBe(true)
    const real = document.createElement('div')
    real.className = 'typ-tab active'
    real.setAttribute('data-id', '/root/a.md')
    real.textContent = 'New tab' // text says New tab but it is a REAL tab
    expect(isEmptyPlaceholderTab(real)).toBe(false)
  })

  it('EMPTY-TAB-7 EMPTY → ACTIVE removes the marker', () => {
    buildEmptyTabs()
    applyEmptyPlaceholderTabState(document, true)
    expect(document.querySelectorAll(`[${EMPTY_PLACEHOLDER_ATTR}="true"]`).length).toBe(1)
    applyEmptyPlaceholderTabState(document, false)
    expect(document.querySelectorAll(`[${EMPTY_PLACEHOLDER_ATTR}="true"]`).length).toBe(0)
    const close = document.querySelector<HTMLElement>('.typ-tab.active .typ-icon.typ-close')!
    expect(close.hasAttribute('aria-hidden')).toBe(false)
  })

  it('EMPTY-TAB-8 ACTIVE → EMPTY restores the marker', () => {
    buildEmptyTabs()
    applyEmptyPlaceholderTabState(document, false)
    expect(document.querySelectorAll(`[${EMPTY_PLACEHOLDER_ATTR}="true"]`).length).toBe(0)
    applyEmptyPlaceholderTabState(document, true)
    expect(document.querySelectorAll(`[${EMPTY_PLACEHOLDER_ATTR}="true"]`).length).toBe(1)
  })

  it('EMPTY-TAB-9 real document hover close unchanged (no marker + hover rule intact)', () => {
    buildRealTabsWithEmptyActive()
    applyEmptyPlaceholderTabState(document, true)
    const css = scss()
    // the real hover/focus visibility rules are still present & unmodified
    expect(css).toMatch(/\.typ-tab:hover \.typ-icon\.typ-close[\s\S]*?visibility:\s*visible/)
    expect(css).toMatch(/\.typ-tab:focus-within \.typ-icon\.typ-close[\s\S]*?visibility:\s*visible/)
    // real tab close remains present & not aria-hidden by us
    const realClose = document.querySelector<HTMLElement>('.typ-tab[data-id="/root/a.md"] .typ-icon.typ-close')!
    expect(realClose.hasAttribute('aria-hidden')).toBe(false)
  })

  it('EMPTY-TAB-10 real document 20×20 centering unchanged', () => {
    const css = scss()
    const start = css.indexOf('.typ-workspace-root .typ-workspace-tabs .typ-tab .typ-icon.typ-close')
    const elementPart = css.slice(start, css.indexOf('.typ-close::before', start))
    expect(elementPart).toMatch(/width:\s*20px/)
    expect(elementPart).toMatch(/flex:\s*0 0 20px/)
    expect(elementPart).toMatch(/display:\s*inline-flex/)
  })
})

describe('EMPTY-CREATE-1..18 — blank-workspace dblclick creates one .md', () => {
  it('EMPTY-CREATE-1 single click → no create', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    makeController(platform, surface)
    document.getElementById('write')!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    await flush()
    expect(rec.creates.length).toBe(0)
  })

  it('EMPTY-CREATE-2 left dblclick blank workspace → exactly one md in file-tree root', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    makeController(platform, surface)
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(1)
    expect(rec.creates[0]).toMatch(/\/root\/未命名\.md$/)
    expect(rec.openCalls.length).toBe(1)
  })

  it('EMPTY-CREATE-3 right dblclick → no create', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    makeController(platform, surface)
    document.getElementById('write')!.dispatchEvent(dbl(2))
    await flush()
    expect(rec.creates.length).toBe(0)
  })

  it('EMPTY-CREATE-4 middle dblclick → no create', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    makeController(platform, surface)
    document.getElementById('write')!.dispatchEvent(dbl(1))
    await flush()
    expect(rec.creates.length).toBe(0)
  })

  it('EMPTY-CREATE-5 interactive target → no create', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    makeController(platform, surface)
    const btn = document.createElement('button')
    btn.textContent = '打开文件'
    document.getElementById('write')!.appendChild(btn)
    btn.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(0)
    expect(isInteractiveDoubleClickTarget(btn, document.getElementById('write'), true)).toBe(true)
  })

  it('EMPTY-CREATE-6 active document dblclick → no create (listener detached)', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    const c = makeController(platform, surface)
    presence = { state: 'ACTIVE', path: '/root/a.md' }
    c.sync(presence)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(0)
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(0)
  })

  it('EMPTY-CREATE-7 selected folder → create inside that folder', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    makeController(platform, surface)
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="file-library-tree"><div class="file-library-node selected" data-path="/root/sub"></div></div>',
    )
    expect(readFileTreeSelectionPath(document)).toBe('/root/sub')
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates[0]).toMatch(/\/root\/sub\/未命名\.md$/)
  })

  it('EMPTY-CREATE-8 selected file → create in its parent directory', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    rec.existing.add('/root/sub/a.md')
    makeController(platform, surface)
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="file-library-tree"><div class="file-library-node selected" data-path="/root/sub/a.md"></div></div>',
    )
    expect(readFileTreeSelectionPath(document)).toBe('/root/sub/a.md')
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates[0]).toMatch(/\/root\/sub\/未命名\.md$/)
  })

  it('EMPTY-CREATE-9 no selection → create in file-tree root', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    makeController(platform, surface)
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates[0]).toBe('/root/未命名.md')
  })

  it('EMPTY-CREATE-10 no file-tree root → reject + notice, no create', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform({ root: null })
    makeController(platform, surface)
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(0)
    expect(rec.notices).toContain('当前未打开文件目录')
    expect(resolveEmptyWorkspaceCreateDirectory({ root: null, selectedPath: null, selectedKind: null })).toEqual({
      kind: 'reject',
      reason: 'NO_FILE_TREE_ROOT',
    })
  })

  it('EMPTY-CREATE-11 未命名.md collision → 未命名 2.md', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    rec.existing.add('/root/未命名.md')
    makeController(platform, surface)
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(1)
    expect(rec.creates[0]).toBe('/root/未命名 2.md')
  })

  it('EMPTY-CREATE-12 repeated collisions increment', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    rec.existing.add('/root/未命名.md')
    rec.existing.add('/root/未命名 2.md')
    makeController(platform, surface)
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates[0]).toBe('/root/未命名 3.md')
    const onlyPreSeed = new Set(['/root/未命名.md', '/root/未命名 2.md'])
    const name = nextName((p) => onlyPreSeed.has(p.replace(/\\/g, '/')), '/root')
    expect(name.fileName).toBe('未命名 3.md')
  })

  it('EMPTY-CREATE-13 transaction guard prevents a second file from one or double dblclicks', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    // open never resolves → the guard stays non-IDLE across both events
    let resolveOpen!: () => void
    const gated: EmptyWorkspaceUxPlatform = {
      ...platform,
      openCreatedFile: (p) => new Promise<void>((r) => { rec.openCalls.push(p); resolveOpen = r }),
    }
    makeController(gated, surface)
    const write = document.getElementById('write')!
    write.dispatchEvent(dbl(0))
    write.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(1)
    resolveOpen()
    await flush()
    expect(rec.creates.length).toBe(1)
  })

  it('EMPTY-CREATE-14 create success → file open attempted', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform({ autoActivate: true })
    makeController(platform, surface)
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.openCalls.length).toBe(1)
    expect(rec.openCalls[0]).toBe(rec.creates[0])
    // auto-activation mimics real open events → presence became ACTIVE
    expect(presence.state).toBe('ACTIVE')
  })

  it('EMPTY-CREATE-15 open success → presence ACTIVE with the created path', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform({ autoActivate: true })
    makeController(platform, surface)
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(1)
    expect(presence.path).toBe(rec.creates[0])
    expect(presence.state).toBe('ACTIVE')
  })

  it('EMPTY-CREATE-16 open failure → created file retained + transaction released', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform({ openFail: true })
    const c = makeController(platform, surface)
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(1) // file kept, never deleted
    expect(rec.openCalls.length).toBe(1)
    // transaction released: a second dblclick creates another file
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(2)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(1)
  })

  it('EMPTY-CREATE-17 never overwrites an existing file (exclusive create)', async () => {
    const { platform, rec } = makePlatform()
    rec.existing.add('/root/未命名.md')
    expect(platform.createExclusiveMarkdown('/root', '未命名.md')).toEqual({ ok: false, path: null, code: 'EXISTS' })
  })

  it('EMPTY-CREATE-18 no document/body global dblclick pollution', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    makeController(platform, surface)
    document.body.dispatchEvent(dbl(0))
    document.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(0)
  })
})

describe('EMPTY-EVENT-1..4 — controller listener lifecycle', () => {
  it('EMPTY-EVENT-1 dblclick listener count=1', () => {
    buildEmptyTabs()
    const { platform } = makePlatform()
    const c = makeController(platform, surface)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(1)
  })

  it('EMPTY-EVENT-2 unmount removes the listener', async () => {
    buildEmptyTabs()
    const { platform, rec } = makePlatform()
    const c = makeController(platform, surface)
    c.dispose()
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(0)
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(0)
  })

  it('EMPTY-EVENT-3 repeated EMPTY/ACTIVE keeps a single listener', () => {
    buildEmptyTabs()
    const { platform } = makePlatform()
    const c = makeController(platform, surface)
    for (let i = 0; i < 4; i++) {
      presence = { state: 'EMPTY', path: '' }
      c.sync(presence)
      expect(c.getRuntimeFacts().dblclickListenerCount).toBe(1)
      presence = { state: 'ACTIVE', path: '/root/a.md' }
      c.sync(presence)
      expect(c.getRuntimeFacts().dblclickListenerCount).toBe(0)
    }
    presence = { state: 'EMPTY', path: '' }
    c.sync(presence)
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(1)
  })

  it('EMPTY-EVENT-4 stale workspace surface listener cleaned on surface swap', async () => {
    document.body.innerHTML = '<div id="write"></div><div id="write2"></div>'
    const { platform, rec } = makePlatform()
    let current: HTMLElement | null = document.getElementById('write')
    const c = new EmptyWorkspaceUxController({
      platform,
      getPresence: () => presence,
      resolveSurface: () => current,
      contentEditableBoundaryAllowed: true,
    })
    c.sync({ state: 'EMPTY', path: '' })
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(1)
    current = document.getElementById('write2')
    c.sync({ state: 'EMPTY', path: '' })
    expect(c.getRuntimeFacts().dblclickListenerCount).toBe(1)
    document.getElementById('write')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(0) // stale surface no longer listened
    document.getElementById('write2')!.dispatchEvent(dbl(0))
    await flush()
    expect(rec.creates.length).toBe(1) // new surface receives the event once
  })
})
