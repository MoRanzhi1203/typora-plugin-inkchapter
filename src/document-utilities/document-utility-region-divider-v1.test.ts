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

  it('is layout-neutral: exactly one 1px real border + the V5.8 boundary border (§15)', () => {
    const css = regionCss()
    const borderDecls = css.match(/border-(top|left|right|bottom):\s*1px/g) ?? []
    // only `#top-titlebar { border-bottom }` is a 1px real border; the other real
    // border is the V5.8 tab bar's own 3px TRANSPARENT bottom border (asserted
    // separately in the V5.8 block) — no second visible edge is introduced here.
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

  it('separator is FULL height — no partial-height short line (V5.5)', () => {
    const css = regionCss()
    // the 1px strip now runs the whole tab box: 0 -> 100%, no transparent stops
    expect(css).toMatch(/var\(--ink-tab-separator\) 0,/)
    expect(css).toMatch(/var\(--ink-tab-separator\) 100%/)
    expect(css).not.toMatch(/transparent 27%/)
    expect(css).not.toMatch(/transparent (2|4|5)\d%/)
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

  it('scrollbar is hidden by default, then matches the sidebar authority', () => {
    const css = regionCss()
    // default must be fully transparent, never a faint grey
    expect(css).toMatch(/--ink-scroll-thumb:\s*transparent/)
    // V5.3 — visible / drag adopt the sidebar's real native colours verbatim
    expect(css).toMatch(/--ink-scroll-thumb-hover:\s*rgba\(0, 0, 0, 0\.3\)/)
    expect(css).toMatch(/--ink-scroll-thumb-active:\s*rgba\(0, 0, 0, 0\.5\)/)
  })

  it('separator is a 1px FULL-HEIGHT structural strip (V5.5)', () => {
    const css = regionCss()
    expect(css).toMatch(/background-size:\s*1px 100%/)
    expect(css).not.toMatch(/background-size:\s*2px/)
    // 0 -> 100%: the strip reaches both edges of the tab box, so TOP_GAP = 0 and
    // BOTTOM_GAP = 0 by construction — no mid-height short line anywhere
    const full = css.match(/var\(--ink-tab-separator\) 0,\s*\n\s*var\(--ink-tab-separator\) 100%/g) ?? []
    expect(full.length).toBeGreaterThanOrEqual(1)
    // the active-neighbour variant is full height too
    expect(css).toMatch(/var\(--ink-tab-separator-active\) 0,\s*\n\s*var\(--ink-tab-separator-active\) 100%/)
    expect(css).not.toMatch(/transparent \d+%,\s*\n\s*var\(--ink-tab-separator/)
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

  it('keeps the only 1px real border on the border-box top bar (no layout shift)', () => {
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
    // the cover must not become a card: the connection itself adds no side/top
    // border and no border width (V5.7 only re-colours the native border on hover)
    expect(css).not.toMatch(/\.typ-tab\.active[^{]*\{[^}]*border-(left|right|top)[^;]*:\s*1px/)
    expect(css).not.toMatch(/\.typ-tab\.active[^{]*\{[^}]*border-width/)
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
    // never be a reveal authority (it stays :hover-matched over the document).
    // `.typ-workspace-tab-header` may only hover for the V5.5 BOUNDARY, never for
    // the scrollbar reveal.
    expect(css).not.toMatch(/\.typ-workspace-tabs:hover/)
    expect(css).not.toMatch(/\.typ-workspace-tab-header:hover[^{]*webkit-scrollbar/)
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

  it('adopts the sidebar scrollbar colours verbatim (V5.3 colour authority)', () => {
    const css = regionCss()
    // visible == the sidebar's native thumb value; drag == its :active value
    expect(css).toMatch(/--ink-scroll-thumb-hover:\s*rgba\(0, 0, 0, 0\.3\)/)
    expect(css).toMatch(/--ink-scroll-thumb-active:\s*rgba\(0, 0, 0, 0\.5\)/)
    // nothing bespoke / no colour-mix scale for the scrollbar any more
    expect(css).not.toMatch(/--ink-scroll-thumb-hover:[^;]*color-mix/)
    expect(css).not.toMatch(/--ink-scroll-thumb-active:[^;]*color-mix/)
    // the hidden state stays ours
    expect(css).toMatch(/--ink-scroll-thumb:\s*transparent/)
    // the sidebar bar is untouched: width-only, zero colour / track override
    expect(css).toMatch(/#typora-sidebar #file-library::-webkit-scrollbar,[\s\S]{0,90}width:\s*5px/)
    expect(css).not.toMatch(/#typora-sidebar[^{}]*webkit-scrollbar[^{}]*\{[^}]*background/)
  })
})

describe('Tab Bar Bottom Boundary V5.8 — ordered boundary + Active cut-out', () => {
  it('paints the SINGLE visible bottom boundary below the native scrollbar', () => {
    const css = regionCss()
    // REAL DOM: `.typ-tabs-wrapper` === `.typ-workspace-tab-header` (one node,
    // framework `TabContainer.containerEl`), so the boundary carrier and the
    // scroll owner are the SAME element — there is no outer header shell.
    expect(css).toMatch(/\.typ-tabs-wrapper\s*\{[\s\S]{0,900}border-bottom:\s*3\.5px solid transparent/)
    // a scrollbar is laid out between the padding edge and the border edge, so the
    // bottom border area is the only region that is BELOW it; the 1px boundary is
    // the last pixel of that border box.
    expect(css).toMatch(/background-position:\s*left bottom/)
    expect(css).toMatch(/background-size:\s*100% 1px/)
    expect(css).toMatch(/background-origin:\s*border-box/)
    expect(css).toMatch(/background-clip:\s*border-box/)
    // no external rail / overlay / pseudo scrollbar of any kind
    expect(css).not.toMatch(/scrollbar-rail|scrollbar-track-el|ink-scrollbar-el/)
    expect(css).not.toMatch(/\.typ-workspace-tab-header\s*\{/)
  })

  it('leaves the framework per-tab border out of visible-boundary authority (V5.8)', () => {
    const css = regionCss()
    // colour-only blanking of the per-tab box, the ACTIVE tab and the filler
    expect(css).toMatch(
      /\.typ-tabs-wrapper \.typ-tab,[\s\S]{0,120}border-bottom-color:\s*transparent/,
    )
    // …width / height / padding / box sizing are untouched, so no tab box moves
    expect(css).not.toMatch(/\.typ-tabs-wrapper \.typ-tab[^{}]*\{[^}]*border-bottom:\s*\d/)
    expect(css).not.toMatch(/\.typ-tabs-wrapper \.typ-tab[^{}]*\{[^}]*border-width/)
    expect(css).not.toMatch(/\.typ-tab(?![\w-])[^{}]*\{[^}]*height:/)
    expect(css).not.toMatch(/\.typ-tab(?![\w-])[^{}]*\{[^}]*padding/)
    // the V5.7 per-tab hover restoration is gone
    expect(css).not.toMatch(/\.typ-tabs-wrapper:hover \.typ-tab\.active/)
  })

  it('REST — the cut-out gradient blanks only the measured Active visible range', () => {
    const css = regionCss()
    expect(css).toMatch(/--ink-active-tab-cut-left, 0px/)
    expect(css).toMatch(/--ink-active-tab-cut-width, 0px/)
    expect(css).toMatch(/transparent var\(--ink-active-tab-cut-left, 0px\)/)
    expect(css).toMatch(
      /calc\([\s\S]{0,120}var\(--ink-active-tab-cut-left, 0px\) \+ var\(--ink-active-tab-cut-width, 0px\)/,
    )
  })

  it('HOVER — pure-CSS cancellation of the cut-out (one continuous boundary)', () => {
    const css = regionCss()
    expect(css).toMatch(/\.typ-tabs-wrapper:hover\s*\{\s*\n\s*background-image:\s*linear-gradient\(/)
    // no class bridge / activity state was needed
    expect(css).not.toContain('ink-tab-strip-hovered')
    expect(css).not.toContain('ink-tab-scroll-active')
  })

  it('internal gap sits BELOW the scrollbar (the V5.7 padding was on the wrong side)', () => {
    const css = regionCss()
    expect(css).not.toMatch(/\.typ-workspace-tab-header\s*\{[\s\S]{0,120}padding-bottom/)
  })
})

describe('Tab Active Boundary Geometry V5.8 — geometry authority (§9/§20/§22/§25)', () => {
  const host = (): string => hostSrc()
  const geometrySrc = (): string =>
    readFileSync(resolve(process.cwd(), 'src/document-utilities/tab-active-boundary-geometry.ts'), 'utf8')

  it('adds exactly ONE Active-geometry controller, wired to the host lifecycle', () => {
    const src = host()
    expect(src).toContain('TabActiveBoundaryGeometryController')
    expect(src).toMatch(/new TabActiveBoundaryGeometryController\(/)
    expect(src).toMatch(/this\.tabBoundaryGeometry\?\.unbind\(\)/)
    // the controller MODULE owns no poller, no body observer, no state machine
    const geometry = geometrySrc()
    expect(geometry).not.toMatch(/setInterval/)
    expect(geometry).not.toMatch(/document\.body/)
    expect(geometry).not.toMatch(/MutationObserver/)
    // the host wires no NEW observer / listener for this feature
    expect(src).toMatch(/private ensureTabBoundaryGeometry\(reason: string\): void \{/)
  })

  it('reuses the EXISTING tab-structure observer for open/close + Active switch', () => {
    const src = host()
    expect(src).toMatch(/TAB_BOUNDARY_STRUCTURE_CHANGE/)
    // the observer is scoped to the tab strip, and now also sees the `.active` class
    expect(src).toMatch(/this\.tabStructureObserver\.observe\(strip, \{[\s\S]{0,240}attributeFilter:\s*\['class'\]/)
  })

  it('re-measures on the EXISTING window-resize path', () => {
    const src = host()
    expect(src).toMatch(/TAB_BOUNDARY_WINDOW_RESIZE/)
  })

  it('keeps the V5.6 wheel handler byte-identical (freeze contract)', () => {
    const src = host()
    expect(src).toMatch(/private readonly onTabStripWheel = \(ev: WheelEvent\): void => \{/)
    expect(src).toMatch(/if \(ev\.deltaX !== 0\) return/)
    expect(src).toMatch(/if \(ev\.deltaY === 0 \|\| ev\.shiftKey\) return/)
    expect(src).toMatch(/if \(wrapper\.scrollLeft !== before\) ev\.preventDefault\(\)/)
  })
})

describe('Tab Strip Wheel Interaction V5.6 — scoped wheel becomes horizontal scroll', () => {
  const host = (): string =>
    readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')

  it('binds a non-passive wheel listener to `.typ-tabs-wrapper` only', () => {
    const src = host()
    expect(src).toMatch(/querySelectorAll<HTMLElement>\('\.typ-tabs-wrapper'\)/)
    expect(src).toMatch(/addEventListener\('wheel', this\.onTabStripWheel, \{ passive: false \}\)/)
    // never global — the listener is scoped to the wrapper element
    expect(src).not.toMatch(/window\.addEventListener\('wheel'/)
    expect(src).not.toMatch(/document\.addEventListener\('wheel'/)
    expect(src).not.toMatch(/body\.addEventListener\('wheel'/)
    // no poller / timer / observer for this feature
    // the wheel helper itself adds no poller / timer
    const wheelRegion = src.slice(
      src.indexOf('Tab Wheel Interaction V5.6'),
      src.indexOf('private unbindTabStripWheel'),
    )
    expect(wheelRegion.length).toBeGreaterThan(0)
    expect(wheelRegion).not.toMatch(/setInterval/)
  })

  it('is idempotent (WeakSet guard) and fully released on dispose', () => {
    const src = host()
    expect(src).toMatch(/new WeakSet<HTMLElement>\(\)/)
    expect(src).toMatch(/if \(this\.tabWheelBound\.has\(wrapper\)\) continue/)
    expect(src).toMatch(/private unbindTabStripWheel\(\): void/)
    expect(src).toMatch(/removeEventListener\('wheel', this\.onTabStripWheel\)/)
    expect(src).toMatch(/this\.unbindTabStripWheel\(\)/)
  })

  it('intercepts only when real horizontal movement is possible', () => {
    const src = host()
    // touchpad deltaX / Shift+wheel are left to the native handler (no double scroll)
    expect(src).toMatch(/if \(ev\.deltaX !== 0\) return/)
    expect(src).toMatch(/if \(ev\.deltaY === 0 \|\| ev\.shiftKey\) return/)
    // no overflow ⇒ never intercepted
    expect(src).toMatch(/const max = wrapper\.scrollWidth - wrapper\.clientWidth/)
    expect(src).toMatch(/if \(max <= 0\) return/)
    // at either boundary ⇒ never swallowed
    expect(src).toMatch(/if \(next === before\) return/)
    // consume only AFTER `scrollLeft` actually changed
    expect(src).toMatch(/if \(wrapper\.scrollLeft !== before\) ev\.preventDefault\(\)/)
  })

  it('keeps the wrapper as the only scroll owner with no external rail', () => {
    const css = regionCss()
    expect(css).toMatch(/\.typ-tabs-wrapper::-webkit-scrollbar/)
    expect(css).not.toMatch(/\.typ-workspace-tab-header::-webkit-scrollbar/)
    expect(css).not.toMatch(/scrollbar-rail|scrollbar-track-el|ink-scrollbar-el/)
  })

  it('leaves the tab height system and every tab box untouched', () => {
    const css = regionCss()
    expect(css).not.toContain('--typ-tabs-height:')
    expect(css).not.toMatch(/\.typ-tabs\s*\{[^}]*height:/)
    expect(css).not.toMatch(/\.typ-tabs-wrapper\s*\{[^}]*height:/)
    expect(css).not.toMatch(/\.typ-tab\s*\{[^}]*height:/)
    expect(css).not.toMatch(/\.typ-tab\s*\{[^}]*padding/)
  })
})
