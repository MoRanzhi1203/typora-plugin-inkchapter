// @vitest-environment jsdom
/**
 * P0 — 右下角翻页导航器在“切换 Markdown”后必须持续可见。
 *
 * 覆盖完整状态覆盖与生命周期：
 *   A(长) → B(短) → C(长) → A(长)
 *   快速连续切换（中间不等待几何/诊断）
 *   切换期间的瞬时无文档（SWITCHING_DOCUMENT）
 *   真正无活动文档（NO_DOCUMENT）才隐藏
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
  Object.defineProperty(shell, 'scrollTop', { configurable: true, value: 0, writable: true })
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
  setDoc('/vault/a.md', 'doc:a', LONG_MD, true)
})

describe('P0 navigator document switch — A(长) → B(短) → C(长) → A(长)', () => {
  it('stays visible and mounted through every switch', () => {
    const h = mount()
    expect(isVisible()).toBe(true)
    expect(arrows().every(btn => btn.disabled)).toBe(false)

    setDoc('/vault/b.md', 'doc:b', SHORT_MD, false)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    expect(arrows().every(btn => btn.disabled)).toBe(true)

    setDoc('/vault/c.md', 'doc:c', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    expect(arrows().every(btn => btn.disabled)).toBe(false)

    setDoc('/vault/a.md', 'doc:a', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    expect(navigator().style.right).not.toBe('')
    h.dispose()
  })

  it('survives rapid consecutive switches without waiting for geometry', () => {
    const h = mount()
    setDoc('/vault/b.md', 'doc:b', SHORT_MD, false)
    h.bindDocument()
    setDoc('/vault/c.md', 'doc:c', LONG_MD, true)
    h.bindDocument()
    setDoc('/vault/a.md', 'doc:a', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
    h.dispose()
  })

  it('transient EMPTY during a switch does not persist a hidden navigator', () => {
    const h = mount()
    // 切换中的瞬时状态：workspace 暂时报告“无活动叶子”。
    activeWs = { active: false, file: null, key: null, md: '' }
    h.bindDocument()
    // 新文档到达（同一 tick 内继续切换）。
    setDoc('/vault/b.md', 'doc:b', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    h.dispose()
  })

  it('hides only for a genuine NO_DOCUMENT state', () => {
    const h = mount()
    activeWs = { active: false, file: null, key: null, md: '' }
    h.bindDocument()
    const nav = navigator()
    expect(nav.hidden).toBe(true)
    expect(nav.style.display).toBe('none')
    h.dispose()
  })

  it('keeps visible navigator usable after reopening a document', () => {
    const h = mount()
    activeWs = { active: false, file: null, key: null, md: '' }
    h.bindDocument()
    expect(navigator().hidden).toBe(true)
    setDoc('/vault/d.md', 'doc:d', LONG_MD, true)
    h.bindDocument()
    expect(isVisible()).toBe(true)
    expect(arrows().every(btn => btn.disabled)).toBe(false)
    h.dispose()
  })
})
