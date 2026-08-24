// @vitest-environment jsdom
/**
 * Phase 7R.3.11.2 — Overlay selector isolation / accidental fullscreen tests.
 *
 * TREE OWNERSHIP ≠ ROOT LAYOUT AUTHORITY:
 *  - `data-inkchapter-ui-root="document-utilities"` marks the whole tree.
 *  - `data-inkchapter-utility-root="true"` is the ONLY viewport portal root.
 *  - The ownership selector must never carry viewport geometry; otherwise every
 *    child becomes a 100vw×100vh layer and occludes the editor (the reported
 *    white-screen bug).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  computeOcclusionRatio,
  isAccidentalFullscreenChild,
  DocumentUtilityOverlayHost,
  UTILITY_ROOT_IDENTITY_ATTR,
  UTILITY_UI_ROOT_ATTR,
  UTILITY_UI_ROOT_VALUE,
} from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

/** Extract every `selector { body }` pair. */
function rulePairs(css: string): Array<{ selector: string; body: string }> {
  const pairs: Array<{ selector: string; body: string }> = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    pairs.push({ selector: m[1].trim(), body: m[2].trim() })
  }
  return pairs
}

const OWNERSHIP = `[${UTILITY_UI_ROOT_ATTR}="${UTILITY_UI_ROOT_VALUE}"]`
const ROOT_ID = `[${UTILITY_ROOT_IDENTITY_ATTR}="true"]`

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# 标题\n\n正文',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
}

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

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
})

function mountHost(): DocumentUtilityOverlayHost {
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
  h.mount()
  return h
}

describe('CSS-ROOT-1/2/3 ownership vs root-identity selectors', () => {
  it('viewport geometry lives ONLY on the root-identity selector', () => {
    const pairs = rulePairs(scss)
    // Root identity selector carries the viewport portal geometry.
    const rootRule = pairs.find(p => p.selector.includes(ROOT_ID))
    expect(rootRule).toBeTruthy()
    expect(rootRule!.body).toMatch(/position\s*:\s*fixed/)
    expect(rootRule!.body).toMatch(/inset\s*:\s*0/)
    expect(rootRule!.body).toMatch(/width\s*:\s*100vw/)
    expect(rootRule!.body).toMatch(/height\s*:\s*100vh/)
    expect(rootRule!.body).toMatch(/pointer-events\s*:\s*none/)
  })

  it('ownership selector is FREE of viewport geometry (CSS-ROOT-2)', () => {
    const pairs = rulePairs(scss)
    const ownershipRules = pairs.filter(p => p.selector.includes(OWNERSHIP))
    for (const rule of ownershipRules) {
      expect(rule.body).not.toMatch(/position\s*:\s*fixed/)
      expect(rule.body).not.toMatch(/width\s*:\s*100vw/)
      expect(rule.body).not.toMatch(/height\s*:\s*100vh/)
      expect(rule.body).not.toMatch(/inset\s*:\s*0/)
      expect(rule.body).not.toMatch(/z-index\s*:\s*900/)
    }
  })

  it('no rule applies viewport geometry through the ownership selector (global scan)', () => {
    const pairs = rulePairs(scss)
    for (const p of pairs) {
      if (!p.selector.includes(OWNERSHIP)) continue
      const dangerous = /position\s*:\s*fixed/.test(p.body) || /100vw/.test(p.body) || /100vh/.test(p.body) || /inset\s*:\s*0/.test(p.body)
      expect(dangerous).toBe(false)
    }
  })
})

describe('CSS-CHILD-1..4 children are content/bounded sized', () => {
  it('toolbar is NOT viewport-sized (CSS-CHILD-1)', () => {
    const pairs = rulePairs(scss)
    const toolbar = pairs.find(p => !p.selector.includes(',') && p.selector.trim() === '.inkchapter-doc-toolbar')
    expect(toolbar).toBeTruthy()
    expect(toolbar!.body).not.toMatch(/100vw|100vh/)
    expect(toolbar!.body).not.toMatch(/inset\s*:/)
    expect(toolbar!.body).toMatch(/max-width/)
  })

  it('navigator is NOT viewport-sized (CSS-CHILD-2)', () => {
    const pairs = rulePairs(scss)
    const nav = pairs.find(p => !p.selector.includes(',') && p.selector.trim() === '.inkchapter-doc-navigator')
    expect(nav).toBeTruthy()
    expect(nav!.body).not.toMatch(/100vw|100vh/)
    expect(nav!.body).not.toMatch(/inset\s*:/)
  })

  it('buttons are NOT viewport-sized (CSS-CHILD-3)', () => {
    // Nested SCSS (hover/focus) breaks naive brace-pair parsing, so assert on
    // the raw SCSS: the button rules must not declare fullscreen dimensions.
    for (const selector of ['.inkchapter-doc-toolbar__btn', '.inkchapter-doc-navigator__btn']) {
      const m = scss.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`))
      expect(m, `${selector} rule must exist`).toBeTruthy()
      const body = m![1]
      expect(body).not.toMatch(/100vw|100vh/)
      expect(body).not.toMatch(/inset\s*:/)
    }
  })

  it('drawer width is bounded (CSS-CHILD-4)', () => {
    const pairs = rulePairs(scss)
    const drawer = pairs.find(p => !p.selector.includes(',') && p.selector.trim() === '.inkchapter-doc-drawer')
    expect(drawer).toBeTruthy()
    expect(drawer!.body).not.toMatch(/100vw|100vh/)
    expect(drawer!.body).toMatch(/width\s*:\s*(360px|clamp\(|min\(|max\(|\d{3}px)/)
    expect(drawer!.body).toMatch(/max-width/)
  })
})

describe('OVERLAY-ISO-1 ownership vs root identity in the DOM', () => {
  it('ownership on many nodes; root identity on exactly one', () => {
    mountHost()
    const ownershipCount = document.querySelectorAll(OWNERSHIP).length
    const rootIdentityCount = document.querySelectorAll(ROOT_ID).length
    expect(ownershipCount).toBeGreaterThan(1)
    expect(rootIdentityCount).toBe(1)
  })
})

describe('OVERLAY-ISO-2 root viewport-sized, children content-sized', () => {
  it('root has 100vw/100vh; toolbar/navigator/buttons do not', () => {
    mountHost()
    const root = document.querySelector(ROOT_ID) as HTMLElement
    expect(root.style.width).toBe('100vw')
    expect(root.style.height).toBe('100vh')
    const toolbar = document.querySelector('.inkchapter-doc-toolbar') as HTMLElement
    const nav = document.querySelector('.inkchapter-doc-navigator') as HTMLElement
    const btn = document.querySelector('.inkchapter-doc-toolbar__btn') as HTMLElement
    for (const el of [toolbar, nav, btn]) {
      expect(el.style.width).not.toBe('100vw')
      expect(el.style.height).not.toBe('100vh')
      expect(el.style.inset).not.toBe('0px')
    }
  })
})

describe('OVERLAY-ISO-3 pointer-events contract', () => {
  it('root none, toolbar/navigator/drawer auto', () => {
    mountHost()
    const root = document.querySelector(ROOT_ID) as HTMLElement
    expect(root.style.pointerEvents).toBe('none')
    expect((document.querySelector('.inkchapter-doc-toolbar') as HTMLElement).style.pointerEvents).toBe('auto')
    expect((document.querySelector('.inkchapter-doc-navigator') as HTMLElement).style.pointerEvents).toBe('auto')
    expect((document.querySelector('.inkchapter-doc-drawer') as HTMLElement).style.pointerEvents).toBe('auto')
  })
})

describe('OVERLAY-ISO-4 editor occlusion ratio', () => {
  it('small toolbar/navigator rects stay far below 0.3 of a 1200×700 editor', () => {
    const editor = { left: 250, top: 100, right: 1450, bottom: 800 } // 1200×700
    const toolbar = { left: 1260, top: 112, right: 1426, bottom: 160 } // small top-right pill
    const nav = { left: 1362, top: 676, right: 1422, bottom: 776 }
    expect(computeOcclusionRatio(toolbar, editor)).toBeLessThan(0.3)
    expect(computeOcclusionRatio(nav, editor)).toBeLessThan(0.3)
  })

  it('a fullscreen child IS flagged as accidental fullscreen', () => {
    expect(isAccidentalFullscreenChild({ width: 1200, height: 700 }, { width: 1500, height: 800 })).toBe(true)
    expect(isAccidentalFullscreenChild({ width: 200, height: 40 }, { width: 1500, height: 800 })).toBe(false)
  })
})

describe('OVERLAY-ISO-5/6 drawer bounded + #write untouched', () => {
  it('open drawer: #write.innerHTML unchanged; drawer width bounded via SCSS', () => {
    const write = document.createElement('div')
    write.id = 'write'
    write.innerHTML = '<h1>标题</h1>'
    document.body.appendChild(write)
    mountHost()
    const before = write.innerHTML
    const diag = document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement
    diag.click()
    expect(write.innerHTML).toBe(before)
    const drawer = document.querySelector('.inkchapter-doc-drawer') as HTMLElement
    expect(drawer.getAttribute('style')).toContain('display: flex')
    // Drawer width contract enforced by CSS (not inline fullscreen).
    expect(drawer.style.width).not.toBe('100vw')
    const close = Array.from(document.querySelectorAll('.inkchapter-doc-drawer__action')).find(b => b.textContent === '关闭') as HTMLButtonElement
    close.click()
    expect(write.innerHTML).toBe(before)
    expect(drawer.getAttribute('style')).toContain('display: none')
  })
})

describe('OVERLAY-ISO-7 document switch counts', () => {
  it('repeated bindDocument keeps one root / toolbar / navigator', () => {
    const h = mountHost()
    h.bindDocument()
    h.bindDocument()
    expect(document.querySelectorAll(ROOT_ID)).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-toolbar')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-drawer')).toHaveLength(1)
  })
})

describe('OVERLAY-ISO-8 resize keeps controls inside the editor', () => {
  it('window resize reschedules geometry; placement stays viewport-bounded', () => {
    mountHost()
    window.dispatchEvent(new Event('resize'))
    const toolbar = document.querySelector('.inkchapter-doc-toolbar') as HTMLElement
    // Inline geometry uses viewport coordinates (no fullscreen dimensions).
    expect(toolbar.style.width).not.toBe('100vw')
    expect(parseFloat(toolbar.style.right)).toBeGreaterThanOrEqual(0)
  })
})
