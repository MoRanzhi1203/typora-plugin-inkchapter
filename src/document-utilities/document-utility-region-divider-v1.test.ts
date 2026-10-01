// @vitest-environment jsdom
/**
 * Typora Region Divider + Tab Separator + Subtle Tab Scrollbar V1 — targeted
 * contract tests (§37).
 *
 * The change is a pure CSS/visual layer (plus one geometry probe that only toggles
 * a body class), so jsdom cannot resolve the painted result. These tests assert:
 *   1. the four region dividers exist and are layout-neutral (inset box-shadow /
 *      fixed overlay, never a size-changing border);
 *   2. the tab-to-tab separator is a `:not(:last-child)` background strip (no
 *      pointer interception, no second tab node, no width change);
 *   3. the horizontal scrollbar is KEPT and styled subtle (never removed);
 *   4. the right-console divider is gated by `ink-console-docked`, so it can
 *      never leave a dangling line when the console is closed.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const scss = (): string => readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
const hostSrc = (): string =>
  readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')

/** This round's single authoritative block. It is declared at the TOP of
 * src/style.scss (deliberately, so the legacy "slice from my selector to EOF"
 * contracts of the locate/drawer/tab-close rounds stay unaffected), therefore
 * the slice ends where the original stylesheet body begins. Comments are
 * stripped because the explanatory comment legitimately NAMES forbidden things. */
const regionCss = (): string => {
  const all = scss()
  const start = all.indexOf('Typora Region Divider + Tab Separator + Subtle Tab Scrollbar V1')
  expect(start).toBeGreaterThan(-1)
  const bodyStart = all.indexOf('#write h1.inkchapter-numbered-heading::before')
  const end = bodyStart > start ? bodyStart : all.length
  let block = all.slice(start, end)
  // the slice starts INSIDE the block's leading comment, so drop that partial
  // comment first, otherwise its prose would leak into the assertions
  const firstClose = block.indexOf('*/')
  if (firstClose >= 0) block = block.slice(firstClose + 2)
  return block.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('Region Divider V1 — tokens (§4)', () => {
  it('declares every divider / separator / scrollbar token from the Typora theme', () => {
    const css = regionCss()
    for (const token of [
      '--ink-ui-divider:',
      '--ink-ui-divider-strong:',
      '--ink-tab-separator:',
      '--ink-tab-separator-active:',
      '--ink-tab-scrollbar-track:',
      '--ink-tab-scrollbar-thumb:',
      '--ink-tab-scrollbar-thumb-hover:',
      '--ink-tab-scrollbar-thumb-active:',
    ]) {
      expect(css).toContain(token)
    }
    // colour source = Typora theme (text colour via color-mix), never a hardcoded brand colour
    expect(css).toMatch(/--ink-divider-major:\s*color-mix\(in srgb, var\(--text-color/)
    expect(css).toMatch(/--ink-divider-secondary:\s*color-mix\(in srgb, var\(--text-color/)
  })

  it('never hardcodes a Trae / VS Code / pure-black colour', () => {
    const css = regionCss().toLowerCase()
    expect(css).not.toContain('#000000')
    expect(css).not.toMatch(/#(0|1|2|3)[0-9a-f]{5}\b/) // near-black hex
    expect(css).not.toContain('rgb(0, 0, 0)')
  })

  it('keeps the tab bottom line native and the separator weaker than the dividers (§7)', () => {
    const css = regionCss()
    // V5 — the strip bottom line is the framework's own border-bottom, not ours
    expect(css).not.toMatch(/\.typ-workspace-tabs\s*\{[^}]*--ink-divider-major/)
    expect(css).toMatch(/\.typ-tab:not\(:last-child\)/)
  })
})

describe('Region Divider V1 — four region dividers (§5)', () => {
  it('top: real top bar gets a border-box-safe bottom border, native-window gets a fixed overlay', () => {
    const css = regionCss()
    expect(css).toMatch(/#top-titlebar\s*\{\s*border-bottom:\s*1px solid var\(--ink-divider-faint\)/)
    expect(css).toMatch(/body\.native-window::before\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?height:\s*1px;/)
  })

  it('left: sidebar right edge only (single side — no 2px double line)', () => {
    const css = regionCss()
    expect(css).toMatch(/#typora-sidebar::after\s*\{[\s\S]*?right:\s*0;[\s\S]*?width:\s*1px;/)
    // the editor side must NOT add a matching left border
    expect(css).not.toMatch(/\ncontent\s*\{[^}]*border-left/)
  })

  it('tab strip bottom: V5 removed our duplicate — the framework border is the authority', () => {
    const css = regionCss()
    expect(css).not.toMatch(/\.typ-workspace-tabs\s*\{[^}]*background-image/)
    expect(css).not.toMatch(/\.typ-workspace-tab-header\s*\{[^}]*background-image/)
    expect(css).not.toContain('calc(100% - 1px)')
  })

  it('right console: fixed overlay gated by ink-console-docked (no dangling line)', () => {
    const css = regionCss()
    expect(css).toMatch(/body\.ink-console-docked::after\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?width:\s*1px;/)
    expect(css).not.toMatch(/^body::after/m)
  })

  it('is layout-neutral: only the border-box top bar uses a real border (§15)', () => {
    const css = regionCss()
    const borderDecls = css.match(/border-(top|left|right|bottom):\s*1px/g) ?? []
    // only `#top-titlebar { border-bottom }` may be a real border
    expect(borderDecls).toHaveLength(1)
    expect(css).toMatch(/#top-titlebar\s*\{\s*border-bottom/)
    // every other divider is a decorative overlay / background strip and is
    // pointer-transparent, so it can never shift layout or steal a click
    const overlays = css.match(/pointer-events:\s*none/g) ?? []
    expect(overlays.length).toBeGreaterThanOrEqual(3)
  })
})

describe('Region Divider V1 — tab-to-tab separator (§6)', () => {
  it('is a :not(:last-child) 1px background strip, not a border', () => {
    const css = regionCss()
    expect(css).toMatch(/\.typ-workspace-tabs \.typ-tab:not\(:last-child\)/)
    expect(css).toMatch(/\.typ-workspace-tab-header \.typ-tab:not\(:last-child\)/)
    expect(css).toMatch(/background-image:\s*linear-gradient/)
    expect(css).toMatch(/background-size:\s*1px 100%/)
    expect(css).toMatch(/background-repeat:\s*no-repeat/)
    expect(css).toMatch(/background-position:\s*right center/)
  })

  it('separator height stays inside the 42%–48% band (§4)', () => {
    const css = regionCss()
    // transparent 27% → colour 27%..73% → transparent 73%  == 46% of the tab height
    expect(css).toMatch(/transparent 27%,/)
    expect(css).toMatch(/73%,/)
    expect(css).not.toMatch(/transparent 0%/)
  })

  it('cannot intercept pointer events and never changes tab width (§16/§10)', () => {
    const css = regionCss()
    // no pointer-events / width / flex declarations on the tab itself
    expect(css).not.toMatch(/\.typ-tab\s*\{[^}]*pointer-events/)
    expect(css).not.toMatch(/\.typ-tab:not\(:last-child\)\s*\{[^}]*\bwidth:/)
    expect(css).not.toMatch(/\.typ-tab:not\(:last-child\)\s*\{[^}]*\bposition:\s*(relative|absolute)/)
    expect(css).not.toMatch(/\.typ-tab[^{]*\{[^}]*\bborder-(left|right):/)
  })

  it('softens the ACTIVE tab separator instead of adding a second heavy line (§6.3)', () => {
    const css = regionCss()
    expect(css).toMatch(/\.typ-tab\.active:not\(:last-child\)[\s\S]{0,200}--ink-tab-separator-active/)
  })

  it('does not clone / replace native tabs and adds no observer (§12/§13)', () => {
    const css = regionCss()
    expect(css).not.toContain('cloneNode')
    // every pseudo-element in this block is an EMPTY 1px decorative box
    const contents = css.match(/content:\s*'[^']*'/g) ?? []
    expect(contents.length).toBeGreaterThan(0)
    expect(contents.every(declaration => /content:\s*''/.test(declaration))).toBe(true)
    const host = hostSrc()
    // the only new runtime hook is the console-dock class probe
    expect(host).toContain('syncRegionDividerConsoleDock')
    expect(host).toContain("classList.add('ink-console-docked')")
    expect(host).toContain("classList.remove('ink-console-docked')")
  })
})

describe('Region Divider V1 — subtle but preserved tab scrollbar (§8/§9)', () => {
  it('never removes the scrollbar', () => {
    const css = regionCss()
    expect(css).not.toContain('scrollbar-width: none')
    expect(css).not.toMatch(/scrollbar[^{]*\{[^}]*display:\s*none/)
    expect(css).not.toMatch(/::-webkit-scrollbar[^{]*\{[^}]*display:\s*none/)
  })

  it('is scoped to the REAL scroll owner (.typ-tabs-wrapper), 4px hit area', () => {
    const css = regionCss()
    expect(css).toMatch(/\.typ-tabs-wrapper::-webkit-scrollbar\s*\{\s*height:\s*4px/)
    expect(css).toContain('.typ-tabs-wrapper::-webkit-scrollbar-track')
    expect(css).toMatch(/\.typ-tabs-wrapper::-webkit-scrollbar-thumb\s*\{[\s\S]{0,260}background-color:\s*transparent/)
    expect(css).toMatch(/\.typ-tabs-wrapper:hover::-webkit-scrollbar-thumb/)
    expect(css).toMatch(/\.typ-tabs-wrapper::-webkit-scrollbar-thumb:hover[\s\S]{0,120}--ink-scroll-thumb-active\)/)
    // the inert `.typ-tabs`/`.typ-workspace-tabs` scrollbar rules must be gone
    expect(css).not.toMatch(/\.typ-tabs::-webkit-scrollbar/)
    expect(css).not.toMatch(/\.typ-workspace-tabs[^{]*webkit-scrollbar/)
  })

  it('adds no extra tab-strip height (§8.7)', () => {
    const css = regionCss()
    expect(css).not.toMatch(/\.typ-tabs\s*\{[^}]*height:/)
    expect(css).not.toMatch(/\.typ-workspace-tabs\s*\{[^}]*height:/)
  })
})

// ── V2 — visual refinement: one hierarchy, lighter separator, subtler bar ──

/** V3 — the effective alpha of a theme-aware token, as a 0..1 fraction, read from
 * its `color-mix(in srgb, var(--text-color…) N%, transparent)` declaration. A
 * token that only has the rgba() fallback (or still relies on `--border-primary`,
 * whose alpha the theme fully controls) FAILS here — that is exactly the V2
 * defect this contract guards (THEME_DIVIDER_ALPHA_NOT_EFFECTIVE_COUNT). */
const tokenAlpha = (name: string): number => {
  const m = regionCss().match(
    new RegExp(`${name}:[\\s\\S]{0,220}?color-mix\\(in srgb, var\\(--text-color[^)]*\\)\\s*([\\d.]+)%, transparent\\)`),
  )
  expect(m, `${name} must be declared as a theme-aware color-mix(...) token`).not.toBeNull()
  return Number(m![1]) / 100
}

describe('Divider Visual Refinement V2 — hierarchy & separator (§2/§5)', () => {
  it('separator < secondary < major (one visual hierarchy)', () => {
    const sep = tokenAlpha('--ink-tab-separator')
    const secondary = tokenAlpha('--ink-divider-secondary')
    const major = tokenAlpha('--ink-divider-major')
    expect(sep).toBeLessThan(secondary)
    expect(secondary).toBeLessThan(major)
    // §3 — the tab separator must sit in the 4%~6% band, never read as a table border
    expect(sep).toBeGreaterThanOrEqual(0.04)
    expect(sep).toBeLessThanOrEqual(0.06)
  })

  it('scrollbar is hidden by default, then hover < active', () => {
    // §FIX-2 — default must be fully transparent, never a faint grey
    expect(regionCss()).toMatch(/--ink-scroll-thumb:\s*transparent/)
    const hover = tokenAlpha('--ink-scroll-thumb-hover')
    const active = tokenAlpha('--ink-scroll-thumb-active')
    expect(hover).toBeLessThan(active)
    expect(hover).toBeGreaterThan(0)
  })

  it('separator is 1px wide and 46% tall, vertically centred (§4)', () => {
    const css = regionCss()
    expect(css).toMatch(/background-size:\s*1px 100%/)
    expect(css).not.toMatch(/background-size:\s*2px/)
    // transparent 27% → colour 27%..73% → transparent 73%  == 46% of the tab height
    expect(css).toMatch(/transparent 27%,/)
    expect(css).toMatch(/73%,\s*\n\s*transparent 73%/)
    expect(css).not.toMatch(/transparent 25%,/)
  })

  it('softens BOTH the active tab and its left neighbour (§6)', () => {
    const css = regionCss()
    expect(css).toMatch(/\.typ-tab\.active:not\(:last-child\)[\s\S]{0,200}--ink-tab-separator-active/)
    expect(css).toMatch(/\.typ-tab:not\(:last-child\):has\(\+ \.typ-tab\.active\)[\s\S]{0,200}--ink-tab-separator-active/)
    expect(tokenAlpha('--ink-tab-separator-active')).toBeLessThan(tokenAlpha('--ink-tab-separator'))
  })

  it('single tab and LAST tab can never carry a separator (§7/§8)', () => {
    const css = regionCss()
    // every declaration that PAINTS a separator must live under a :not(:last-child) selector
    const uses = [...css.matchAll(/--ink-tab-separator\)/g)].map(m => m.index!)
    expect(uses.length).toBeGreaterThan(0)
    for (const index of uses) {
      const brace = css.lastIndexOf('{', index)
      const selector = css.slice(css.lastIndexOf('}', brace) + 1, brace)
      expect(selector, `unguarded separator painting near offset ${index}`).toContain(':not(:last-child)')
    }
  })
})

describe('Divider Visual Refinement V2 — no double line / no layout shift (§11/§12/§14)', () => {
  it('the scrollbar track is fully transparent so it cannot band with the bottom divider', () => {
    const css = regionCss()
    expect(css).toMatch(/--ink-tab-scrollbar-track:\s*transparent/)
    expect(css).toMatch(/::-webkit-scrollbar-track\s*\{[\s\S]{0,60}background:\s*var\(--ink-tab-scrollbar-track\)/)
    // the track must never get a visible colour of its own
    expect(css).not.toMatch(/::-webkit-scrollbar-track\s*\{[^}]*rgba\(/)
  })

  it('the thumb is a floating pill, never a solid band', () => {
    const css = regionCss()
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[\s\S]{0,260}border-radius:\s*999px/)
  })

  it('no edge is drawn from both sides (no left border on the editor / strip)', () => {
    const css = regionCss()
    expect(css).not.toMatch(/\ncontent\s*\{[^}]*border-(left|right)/)
    expect(css).not.toMatch(/\.typ-workspace-tabs\s*\{[^}]*border-(left|right|top)/)
    expect(css).not.toMatch(/#typora-sidebar\s*\{[^}]*border-(left|top|bottom)/)
  })

  it('keeps the only real border on the border-box top bar (no layout shift)', () => {
    const css = regionCss()
    const borderDecls = css.match(/border-(top|left|right|bottom):\s*1px/g) ?? []
    expect(borderDecls).toHaveLength(1)
    expect(css).toMatch(/#top-titlebar\s*\{\s*border-bottom/)
  })

  it('the right console keeps exactly ONE gated overlay and no second edge line', () => {
    const css = regionCss()
    const gated = css.match(/ink-console-docked/g) ?? []
    expect(gated.length).toBe(1)
    const host = hostSrc()
    expect(host).toContain("classList.add('ink-console-docked')")
  })
})

// ── V3 — theme-aware tokens, active connectivity, thin scrollbar ──

describe('Divider Theme & Visual Hierarchy V3 — theme-aware tokens (§2)', () => {
  it('derives every divider/scrollbar token from the theme text colour', () => {
    expect(tokenAlpha('--ink-divider-major')).toBe(0.1)
    expect(tokenAlpha('--ink-divider-secondary')).toBe(0.07)
    expect(tokenAlpha('--ink-divider-faint')).toBe(0.05)
    expect(tokenAlpha('--ink-tab-separator')).toBe(0.05)
    expect(tokenAlpha('--ink-tab-separator-active')).toBe(0.02)
    // V4.1 §FIX-2 — the tab-strip thumb default is literally TRANSPARENT
    expect(regionCss()).toMatch(/--ink-scroll-thumb:\s*transparent/)
  })

  it('no divider token is left with a theme-controlled alpha (§1 structural fix)', () => {
    const css = regionCss()
    // `var(--border-primary, rgba(...))` silently ignores its own alpha fallback
    expect(css).not.toContain('--border-primary')
    // fallback first, color-mix override second (spec'd degradation pattern)
    for (const name of ['--ink-divider-major', '--ink-divider-secondary', '--ink-divider-faint', '--ink-tab-separator']) {
      const first = css.indexOf(`${name}:`)
      const override = css.indexOf(`${name}:`, first + 1)
      expect(override, `${name} needs a color-mix override after its fallback`).toBeGreaterThan(first)
      expect(css.slice(first, override)).toMatch(/rgba\(/)
    }
  })

  it('top < left < console divider (§14/§15/§16)', () => {
    const css = regionCss()
    // top boundary = faint, left = secondary, right console = major
    expect(css).toMatch(/#top-titlebar\s*\{\s*border-bottom:\s*1px solid var\(--ink-divider-faint\)/)
    expect(css).toMatch(/#typora-sidebar::after\s*\{[\s\S]{0,200}background:\s*var\(--ink-divider-secondary\)/)
    expect(css).toMatch(/body\.ink-console-docked::after\s*\{[\s\S]{0,200}background:\s*var\(--ink-divider-major\)/)
  })
})

describe('Divider Theme & Visual Hierarchy V3 — active connectivity (§6/§7)', () => {
  it('cuts the tab-strip divider out under the active tab WITHOUT a new border', () => {
    const css = regionCss()
    expect(css).toMatch(/\.typ-tab\.active\s*\{[\s\S]{0,120}box-shadow:\s*0 1px 0 0 var\(--background-primary/)
    // the cover must not become a card: no border on the active tab
    expect(css).not.toMatch(/\.typ-tab\.active[^{]*\{[^}]*border-(left|right|top|bottom)/)
  })

  it('uses only the native .active class (no shadow state / no cloning)', () => {
    const css = regionCss()
    expect(css).toContain('.typ-tab.active')
    expect(css).not.toContain('data-ink-active')
    expect(css).not.toContain('cloneNode')
  })
})

describe('Divider Theme & Visual Hierarchy V3 — 4px hit area / 2px visual (§8/§9)', () => {
  it('keeps a 4px hit area but paints only a ~2px pill', () => {
    const css = regionCss()
    expect(css).toMatch(/::-webkit-scrollbar\s*\{[\s\S]{0,80}height:\s*4px/)
    // never crush the hit area to 2px
    expect(css).not.toMatch(/::-webkit-scrollbar\s*\{[\s\S]{0,80}height:\s*2px/)
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[\s\S]{0,260}background-clip:\s*content-box/)
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[\s\S]{0,260}border:\s*1px solid transparent/)
  })

  it('keeps the track fully transparent (no grey band)', () => {
    const css = regionCss()
    expect(css).toMatch(/::-webkit-scrollbar-track\s*\{[\s\S]{0,80}background:\s*var\(--ink-tab-scrollbar-track\)/)
  })
})

// ── V4 — scrollbar slimming & hover-reveal ──

describe('Scrollbar V4.1 §FIX-1 — tree bar is WIDTH-ONLY (native colours intact)', () => {
  it('declares exactly one width rule and nothing else for the sidebar scrollers', () => {
    const css = regionCss()
    const matches: string[] = css.match(/^[^@{}\n]*#typora-sidebar[^{}\n]*\{[^}]*\}/gm) ?? []
    const treeRules = matches.filter(s => s.includes('webkit-scrollbar'))
    expect(treeRules).toHaveLength(1)
    const rule = treeRules[0]
    expect(rule).toContain('width: 5px')
    expect(css).toContain('#typora-sidebar #file-library::-webkit-scrollbar,')
    expect(rule).toContain('sidebar-content-content')
  })

  it('never overrides tree colour / opacity / track / hover (all counters stay 0)', () => {
    const css = regionCss()
    // no colour-bearing property may appear on any sidebar scrollbar selector
    expect(css).not.toMatch(/#typora-sidebar[^{}]*webkit-scrollbar[^{}]*\{[^}]*background/)
    expect(css).not.toMatch(/#typora-sidebar[^{}]*webkit-scrollbar[^{}]*\{[^}]*color-mix/)
    expect(css).not.toMatch(/#typora-sidebar[^{}]*webkit-scrollbar[^{}]*\{[^}]*opacity/)
    expect(css).not.toMatch(/#typora-sidebar[^{}]*webkit-scrollbar[^{}]*\{[^}]*background-clip/)
    expect(css).not.toMatch(/#typora-sidebar[^{}]*webkit-scrollbar[^{}]*\{[^}]*border/)
    // no sidebar-scoped hover/active override either
    expect(css).not.toMatch(/#typora-sidebar[^{}]*webkit-scrollbar-thumb/)
    expect(css).not.toMatch(/#typora-sidebar:hover[^{}]*scrollbar/)
  })

  it('keeps the sidebar divider untouched (no scrollbar colour tokens left)', () => {
    const css = regionCss()
    expect(css).not.toContain('--ink-tree-thumb')
    expect(css).toMatch(/#typora-sidebar::after\s*\{[\s\S]{0,200}background:\s*var\(--ink-divider-secondary\)/)
  })
})

describe('Tab Scrollbar Interaction Authority V5 — owner & reveal authority', () => {
  it('targets the REAL scroll owner and no longer binds :hover as authority', () => {
    const css = regionCss()
    // the only scroller is the wrapper (framework `overflow-x:auto`)
    expect(css).toMatch(/\.typ-tabs-wrapper::-webkit-scrollbar/)
    // §forensic-2 — `.typ-workspace-tabs` is the whole workspace COLUMN, so it must
    // never be a reveal authority (it stays :hover-matched over the document)
    expect(css).not.toMatch(/\.typ-workspace-tabs:hover/)
    expect(css).not.toMatch(/\.typ-workspace-tab-header:hover/)
    expect(css).not.toMatch(/\.typ-tabs:hover/)
  })

  it('is hidden outside the bar and revealed by hovering the WHOLE bar (V5.1)', () => {
    const css = regionCss()
    expect(css).toMatch(/\.typ-tabs-wrapper::-webkit-scrollbar-thumb\s*\{[\s\S]{0,260}background-color:\s*transparent/)
    // the wrapper ITSELF is the hover authority — not the thumb, not a scroll event
    expect(css).toMatch(/\.typ-tabs-wrapper:hover::-webkit-scrollbar-thumb\s*\{\s*background-color:\s*var\(--ink-scroll-thumb-hover\)/)
    expect(css).not.toMatch(/::-webkit-scrollbar-thumb:hover\s*\{[^}]*--ink-scroll-thumb-hover/)
    // no activity-class authority may remain
    expect(css).not.toContain('ink-tab-scroll-active')
    // drag stays visible
    expect(css).toMatch(/\.typ-tabs-wrapper::-webkit-scrollbar-thumb:active[\s\S]{0,120}--ink-scroll-thumb-active\)/)
  })

  it('never reveals via display / height / width switching (no layout shift)', () => {
    const css = regionCss()
    expect(css).not.toContain('display: none')
    expect(css).not.toContain('scrollbar-width: none')
    expect(css).not.toMatch(/::-webkit-scrollbar\s*\{[^}]*height:\s*0/)
    expect(css).not.toMatch(/::-webkit-scrollbar\s*\{[^}]*display/)
    // reveal is colour-only, driven by wrapper hover
    expect(css).toMatch(/\.typ-tabs-wrapper:hover::-webkit-scrollbar-thumb\s*\{\s*background-color:/)
  })
})

// ── V5.1 — the mis-scoped V5 controller is GONE (no JS scrollbar state) ──

describe('Tab Scrollbar Hover-Scope V5.1 — wrong controller removed', () => {
  const host = (): string => hostSrc()

  it('keeps no activity controller of any kind', () => {
    const src = host()
    for (const removed of [
      'onTabScrollbarScroll',
      'onTabScrollbarWheel',
      'onTabScrollbarPointerOver',
      'onTabScrollbarPointerOut',
      'markTabScrollbarActivity',
      'hideTabScrollbar',
      'installTabScrollbarReveal',
      'teardownTabScrollbarReveal',
      'tabScrollbarIdleTimer',
      'tabScrollbarIdleMs',
      'tabScrollbarRevealBound',
      'ink-tab-scroll-active',
      'tabScrollbar',
    ]) {
      expect(src, `${removed} must be fully removed`).not.toContain(removed)
    }
  })

  it('adds no tab-bar scroll / wheel / pointer listener and no inactivity timer', () => {
    const src = host()
    // the file has unrelated pre-existing listeners, so scope the check to the
    // tab-scrollbar symbols this round removed (all covered in the test above)
    expect(src).not.toContain('onTabScrollbar')
    expect(src).not.toContain('TabScrollbar')
    expect(src).not.toContain('ink-tab-scroll-active')
  })

  it('reveal never requires scroll / wheel / thumb-hover (V5.1 gate)', () => {
    const css = regionCss()
    expect(css).not.toContain('scroll-active')
    // the ONLY reveal rule is the wrapper's own :hover
    const revealRules = css.match(/[^{}]*::-webkit-scrollbar-thumb\s*\{[^}]*--ink-scroll-thumb-hover[^}]*\}/g) ?? []
    expect(revealRules).toHaveLength(1)
    expect(revealRules[0]).toContain('.typ-tabs-wrapper:hover')
  })

  it('freezes colours: this round changed the trigger only', () => {
    const css = regionCss()
    // accepted colours untouched; default stays transparent
    expect(tokenAlpha('--ink-scroll-thumb-hover')).toBe(0.09)
    expect(tokenAlpha('--ink-scroll-thumb-active')).toBe(0.14)
    expect(css).toMatch(/--ink-scroll-thumb:\s*transparent/)
    // tree scrollbar still width-only with zero colour/track overrides
    expect(css).toMatch(/#typora-sidebar #file-library::-webkit-scrollbar,[\s\S]{0,90}width:\s*5px/)
    expect(css).not.toMatch(/#typora-sidebar[^{}]*webkit-scrollbar[^{}]*\{[^}]*background/)
  })
})
