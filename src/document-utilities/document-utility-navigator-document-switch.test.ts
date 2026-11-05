// @vitest-environment jsdom
/**
 * P0 — 右下角翻页导航器：只有当前正文存在真实纵向滚动范围时才显示。
 *
 * 最终交互规则：
 *   无活动文档            → 隐藏
 *   当前文档不可纵向滚动  → 隐藏
 *   当前文档可纵向滚动    → 显示（箭头按位置启用/禁用）
 *   切换短→长 / 长→短 / 长→长 / 长→短→长 / 长→长→短 → 每次按新文档重新计算
 *   窗口尺寸变化、内容编辑导致滚动范围变化 → 重新计算
 *
 * 断言真实 DOM：hidden / inline display / aria-hidden / 节点唯一性 / 箭头可用性。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

type Rect = { top: number; right: number; bottom: number; left: number; width: number; height: number }

function fakeProviders(): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false,
    getHeadingIdentity: () => null,
    parseLocalLinkTargets: () => [],
  }
}

interface Ws { active: boolean; file: string | null; key: string | null; md: string }

function makeContext(ws: () => Ws): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => ws().file,
      getDocumentKey: () => ws().key,
      getMarkdown: () => ws().md,
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => ws().active,
  }
}

const shellRect: Rect = { top: 100, right: 1400, bottom: 900, left: 200, width: 1200, height: 800 }

function makeShell(): HTMLElement {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  Object.defineProperty(shell, 'getBoundingClientRect', { configurable: true, value: () => shellRect })
  Object.defineProperty(shell, 'clientHeight', { configurable: true, value: 700 })
  Object.defineProperty(shell, 'scrollHeight', { configurable: true, writable: true, value: 700 })
  Object.defineProperty(shell, 'scrollTop', { configurable: true, writable: true, value: 0 })
  const write = document.createElement('div')
  write.id = 'write'
  write.setAttribute('contenteditable', 'true')
  shell.appendChild(write)
  document.body.appendChild(shell)
  return shell
}

let activeWs: Ws
let shell: HTMLElement

function navigator(): HTMLElement {
  const nodes = document.querySelectorAll<HTMLElement>('.inkchapter-doc-navigator')
  expect(nodes.length, 'exactly one navigator node').toBe(1)
  return nodes[0]
}

function isVisible(): boolean {
  const nav = navigator()
  return nav.hidden === false && nav.style.display !== 'none'
    && nav.getAttribute('aria-hidden') === 'false'
}

function arrows(): HTMLButtonElement[] {
  return Array.from(navigator().querySelectorAll<HTMLButtonElement>('.inkchapter-doc-navigator__btn'))
}

function setDoc(file: string, key: string, markdown: string, scrollable: boolean): void {
  activeWs = { active: true, file, key, md: markdown }
  Object.defineProperty(shell, 'scrollHeight', { configurable: true, writable: true, value: scrollable ? 2400 : 700 })
}

const LONG_MD = '# 长文\n\n' + Array.from({ length: 120 }, (_, i) => `段落 ${i}`).join('\n\n')
const SHORT_MD = '# 短文\n\n正文。'

function mount(): DocumentUtilityOverlayHost {
  const h = new DocumentUtilityOverlayHost({
    ctx: makeContext(() => activeWs),
    providers: fakeProviders(),
    onBindDocument: () => {},
  })
  h.mount()
  return h
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 })
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  shell = makeShell()
  setDoc('/vault/short.md', 'doc:short', SHORT_MD, false)
})

describe('P0 navigator visibility — short documents hide, long documents show', () => {
  it('short document → hidden; long document → visible', () => {
    const h = mount()
    expect(isVisible()).toBe(false)
    expect(navigator().hidden).toBe(true)
    expect(navigator().style.display).toBe('none')

    setDoc('/vault/long.md', 'doc:long', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    expect(arrows().every(btn => btn.disabled)).toBe(false)
    h.dispose()
  })

  it('short → short stays hidden; long → long stays visible', () => {
    const h = mount()
    setDoc('/vault/short2.md', 'doc:short2', SHORT_MD, false)
    h.bindDocument()
    expect(isVisible()).toBe(false)

    setDoc('/vault/long.md', 'doc:long', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    setDoc('/vault/long2.md', 'doc:long2', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    h.dispose()
  })

  it('long → short hides; long → short → long shows again', () => {
    const h = mount()
    setDoc('/vault/long.md', 'doc:long', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)

    setDoc('/vault/short.md', 'doc:short', SHORT_MD, false)
    h.bindDocument()
    expect(isVisible()).toBe(false)

    setDoc('/vault/long2.md', 'doc:long2', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    h.dispose()
  })

  it('long → long → short ends hidden', () => {
    const h = mount()
    setDoc('/vault/long.md', 'doc:long', LONG_MD, true)
    h.bindDocument()
    setDoc('/vault/long2.md', 'doc:long2', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    setDoc('/vault/short.md', 'doc:short', SHORT_MD, false)
    h.bindDocument()
    expect(isVisible()).toBe(false)
    h.dispose()
  })

  it('survives 10 rapid switches and matches the final document', () => {
    const h = mount()
    for (let i = 0; i < 10; i++) {
      const long = i % 2 === 0
      setDoc(`/vault/doc-${i}.md`, `doc:${i}`, long ? LONG_MD : SHORT_MD, long)
      h.bindDocument()
    }
    // i=9 → short → hidden
    expect(isVisible()).toBe(false)
    setDoc('/vault/final-long.md', 'doc:final', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
    h.dispose()
  })

  it('recomputes after a window resize (small → large → small)', () => {
    const h = mount()
    setDoc('/vault/long.md', 'doc:long', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
    window.dispatchEvent(new Event('resize'))
    expect(isVisible()).toBe(true)

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 })
    window.dispatchEvent(new Event('resize'))
    expect(isVisible()).toBe(true)
    h.dispose()
  })

  it('recomputes when editing changes the real scroll range', () => {
    const h = mount()
    expect(isVisible()).toBe(false)
    setDoc('/vault/short.md', 'doc:short', LONG_MD, true)
    window.dispatchEvent(new Event('resize'))
    expect(isVisible()).toBe(true)
    setDoc('/vault/short.md', 'doc:short', SHORT_MD, false)
    window.dispatchEvent(new Event('resize'))
    expect(isVisible()).toBe(false)
    h.dispose()
  })

  it('disables the up arrow at the top and the down arrow at the bottom', () => {
    const h = mount()
    setDoc('/vault/long.md', 'doc:long', LONG_MD, true)
    h.bindDocument()
    const nav = navigator()
    const [up, down] = arrows()
    expect(up).toBeTruthy()
    expect(down).toBeTruthy()
    // At the top: up is disabled, down is enabled.
    expect(up.disabled).toBe(true)
    expect(down.disabled).toBe(false)
    ;(shell as HTMLElement & { scrollTop: number }).scrollTop = 1700
    shell.dispatchEvent(new Event('scroll'))
    expect(up.disabled).toBe(false)
    expect(down.disabled).toBe(true)
    void nav
    h.dispose()
  })

  it('hides only for a genuine NO_DOCUMENT state', () => {
    const h = mount()
    setDoc('/vault/long.md', 'doc:long', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    activeWs = { active: false, file: null, key: null, md: '' }
    h.bindDocument()
    expect(navigator().hidden).toBe(true)
    expect(navigator().style.display).toBe('none')
    h.dispose()
  })

  it('keeps the navigator unaffected by hub/status failures', () => {
    const h = new DocumentUtilityOverlayHost({
      ctx: makeContext(() => activeWs),
      providers: fakeProviders(),
      onBindDocument: () => {},
      documentHub: {
        getImageSummary: () => { throw new Error('image summary failure') },
        uploadAll: () => {},
        downloadAll: () => {},
        checkDualLink: () => {},
        openImageSettings: () => {},
      },
    })
    h.mount()
    setDoc('/vault/long.md', 'doc:long', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    h.dispose()
  })
})
