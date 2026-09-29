// @vitest-environment jsdom
/**
 * V5.12-R7 — Fill-Only Diagnostic Locate Marker Closure.
 *
 * THE DEFECT: the ACTIVE diagnostic locate visual painted a left vertical
 * indicator bar, a closed 1.5px border frame, open-edge continuation arms, a
 * bottom-left corner cap and 2px underline keylines — the target read as
 * "framed" instead of "highlighted".
 *
 * LINE_SOURCE = MIXED (border + pseudo-element + keyline gradient + one DOM
 * child). These kill-bug tests lock the FILL_ONLY contract at the source level
 * (SCSS + DOM), so "no line" is asserted directly instead of guessed from a
 * screenshot.
 *
 *   R7-SCSS-1..4  the line declarations are GONE (incl. no shadow substitute)
 *   R7-DOM-1..3   no line DOM child is created; the caption cue stops at the
 *                 renderer for the no-slot case
 *   R7-GATE-1..4  the FILL_ONLY hard-gate measurement
 *   R7-PASSIVE-1  the passive heading gutter marker / drawer indicator survive
 *   R7-HOST-1..2  a committed locate emits the FILL_ONLY audit with fill >= 1
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { DiagnosticLocateFrameController } from './document-diagnostic-locate-frame'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import {
  ACTIVE_LOCATE_FILL_ONLY_GATE_KEYS,
  ACTIVE_LOCATE_FILL_ONLY_GATE_LABELS,
  ACTIVE_LOCATE_MIN_FILL_COUNT,
  ACTIVE_LOCATE_PRESENTATION_FILL_ONLY,
  FILL_ONLY_LOCATE_AUDIT_EVENT,
  createActiveLocateFillOnlyCounters,
  emptyActiveLocateFillOnlyFacts,
  evaluateActiveLocateFillOnlyGates,
  formatActiveLocateFillOnlyGateReport,
  isHorizontalLineBar,
  isVerticalLineBar,
  measureActiveLocateFillOnlyGates,
} from './document-diagnostic-locate-fill-only-v512-r7'

const here = dirname(fileURLToPath(import.meta.url))
const scss = readFileSync(resolve(here, '../style.scss'), 'utf8')

/** Slice one SCSS rule block starting at `selector`. */
function ruleBlock(selector: string, length = 320): string {
  const idx = scss.indexOf(selector)
  expect(idx, `missing SCSS selector: ${selector}`).toBeGreaterThanOrEqual(0)
  return scss.slice(idx, idx + length)
}

/** The whole "Diagnostic Locate Visual" region of the stylesheet. */
function locateRegion(): string {
  const from = scss.indexOf('.inkchapter-diagnostic-locate-frame {')
  const to = scss.indexOf('V5.12-R1 — Heading Diagnostic In-Document Marker')
  return scss.slice(from, to > from ? to : from + 12000)
}

describe('R7-SCSS — the linear decoration is gone at the source', () => {
  it('R7-SCSS-1: no border frame, no indicator bar, no continuation arm, no corner cap', () => {
    const region = locateRegion()
    // No closed / open-edge BORDER frame anywhere on the locate carrier.
    expect(region).not.toMatch(/data-presentation='(full-frame|open-right-frame|open-left-frame)'\][\s\S]{0,80}border:\s*1\.5px/)
    // The pseudo elements paint nothing any more.
    expect(region).toMatch(/\.inkchapter-diagnostic-locate-frame::before,\s*\.inkchapter-diagnostic-locate-frame::after\s*\{\s*content:\s*none;/)
    // No continuation arm (a 10px gradient at the open edge).
    expect(region).not.toContain('linear-gradient(to left, var(--ink-locate-border)')
    expect(region).not.toContain('linear-gradient(to right, var(--ink-locate-border)')
    // No heading corner cap.
    expect(region).not.toContain('var(--ink-heading-corner')
  })

  it('R7-SCSS-2: fill-only presentations (fill present, border 0, no gradient keyline)', () => {
    for (const presentation of ['full-frame', 'open-right-frame', 'open-left-frame']) {
      const b = ruleBlock(`.inkchapter-diagnostic-locate-frame[data-presentation='${presentation}']`)
      expect(b, presentation).toContain('border: 0')
      expect(b, presentation).toContain('background: var(--ink-locate-context-bg)')
      expect(b, presentation).not.toContain('solid var(--ink-locate-border)')
    }
    const textTight = ruleBlock(".inkchapter-diagnostic-locate-frame[data-presentation='text-tight-marker']")
    expect(textTight).toContain('border: none')
    expect(textTight).toContain('background: var(--ink-locate-context-bg)')
    const inlineMark = ruleBlock(".inkchapter-diagnostic-locate-frame[data-presentation='inline-mark']")
    expect(inlineMark).toContain('background-color: var(--ink-locate-inline-bg)')
    expect(inlineMark).not.toContain('background-image')
  })

  it('R7-SCSS-3: no painted underline keyline in the inline mark / fragment / heading active layer', () => {
    const inlineMark = scss.slice(scss.indexOf('.inkchapter-diagnostic-inline-mark {'))
    expect(inlineMark.slice(0, 900)).not.toContain('background-image: linear-gradient(')
    expect(inlineMark.slice(0, 900)).toContain('background-color: var(--ink-locate-inline-bg)')
    const fragment = scss.slice(scss.indexOf('.inkchapter-diagnostic-inline-fragment {'))
    expect(fragment.slice(0, 900)).not.toContain('background-image: linear-gradient(')
    expect(fragment.slice(0, 900)).toContain('background-color: var(--ink-locate-inline-bg)')
    // The heading ACTIVE keyline rule is gone; the ACTIVE fill fragment stays.
    expect(scss).not.toContain('.inkchapter-heading-diagnostic-active__keyline')
    // V5.12-R9 §10/§19 — the PASSIVE gutter icon + rail are GONE too: neither the
    // DOM class nor its CSS survives (the marker is SOFT_TEXT_SURFACE + CHIP).
    expect(scss).not.toContain('.inkchapter-heading-diagnostic-marker__rail')
    expect(scss).not.toContain('.inkchapter-heading-diagnostic-marker__icon')
    expect(scss).toContain('.inkchapter-heading-diagnostic-passive__fragment')
    expect(scss).toContain('.inkchapter-heading-diagnostic-active__fragment')
  })

  it('R7-SCSS-4: no shadow / inset-shadow substitute and no caption keyline cue', () => {
    const region = locateRegion()
    // Only `box-shadow: none` may appear on the fill carriers.
    for (const m of region.matchAll(/box-shadow:\s*([^;]+);/g)) {
      expect(m[1].trim()).toBe('none')
    }
    // The caption cue is a FILL only: no ::after keyline, no 2px top-edge bar.
    expect(region).not.toMatch(/data-cue-type='caption-host'\]::after/)
    expect(region).not.toMatch(/data-cue-type='top-edge'\]\s*\{[\s\S]{0,120}height:\s*2px/)
    expect(region).toMatch(/data-cue-type='caption-host'\][\s\S]{0,160}background: var\(--ink-locate-primary-bg\)/)
  })

  it('R7-SCSS-5: the severity colour tokens are UNCHANGED (V5.3 frozen)', () => {
    expect(scss).toMatch(/-locate-primary-bg: color-mix\(in srgb, var\(--ink-ui-sev-error[^)]*\) 20%, transparent\)/)
    expect(scss).toMatch(/-locate-context-bg: color-mix\(in srgb, var\(--ink-ui-sev-error[^)]*\) 11%, transparent\)/)
    expect(scss).toMatch(/-locate-inline-bg: color-mix\(in srgb, var\(--ink-ui-sev-warning[^)]*\) 22%, transparent\)/)
  })
})

describe('R7-DOM — the renderer stops creating lines', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const el = this as HTMLElement
      const w = Number.parseFloat(el.style.width || '0')
      const h = Number.parseFloat(el.style.height || '0')
      return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) } as DOMRect
    } as unknown as typeof Element.prototype.getBoundingClientRect
  })

  function mountFrame(): { root: HTMLElement; anchor: HTMLElement; ctrl: DiagnosticLocateFrameController } {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const anchor = document.createElement('pre')
    anchor.getBoundingClientRect = () => ({ x: 200, y: 300, left: 200, top: 300, right: 1000, bottom: 520, width: 800, height: 220, toJSON: () => ({}) }) as DOMRect
    document.body.appendChild(anchor)
    return { root, anchor, ctrl: new DiagnosticLocateFrameController(root) }
  }

  it('R7-DOM-1: a code locate with NO caption host creates NO cue and NO line child', () => {
    const { root, anchor, ctrl } = mountFrame()
    ctrl.commit({ diagnosticId: 'c1', severity: 'warning', anchor, kind: 'code' })
    const frame = root.querySelector('.inkchapter-diagnostic-locate-frame') as HTMLElement
    expect(frame).toBeTruthy()
    // §5A — the 2px `top-edge` keyline fallback is no longer CREATED.
    expect(frame.dataset.captionCue).toBeUndefined()
    expect(frame.querySelectorAll("[data-cue-type='top-edge']").length).toBe(0)
    expect(frame.querySelectorAll('[data-marker-kind="caption-edge"]').length).toBe(0)
    // No line-ish DOM child anywhere in the carrier.
    expect(root.querySelectorAll('[class*="keyline"],[class*="__line"],[class*="-line"],[class*="arm"]').length).toBe(0)
    // The pre/code native surface is untouched (the fill is overlay-only).
    expect(anchor.style.background).toBe('')
    expect(anchor.style.border).toBe('')
  })

  it('R7-DOM-2: a table locate WITH a measured caption host keeps ONE FILL cue (no keyline child)', () => {
    const { root, anchor, ctrl } = mountFrame()
    ctrl.commit({
      diagnosticId: 't1',
      severity: 'warning',
      anchor,
      kind: 'table',
      captionHostRect: { left: 220, top: 320, right: 340, bottom: 350, width: 120, height: 30 },
    })
    const frame = root.querySelector('.inkchapter-diagnostic-locate-frame') as HTMLElement
    expect(frame.dataset.captionCue).toBe('caption-host')
    const cues = frame.querySelectorAll('[data-marker-kind="caption-edge"]')
    expect(cues.length).toBe(1)
    const cue = cues[0] as HTMLElement
    expect(cue.dataset.cueType).toBe('caption-host')
    // A real fill height (never a 2px line).
    expect(Number.parseFloat(cue.style.height)).toBeGreaterThan(2)
    expect(frame.querySelectorAll("::after").length).toBe(0)
  })

  it('R7-DOM-3: the FILL_ONLY carrier set is the only painted surface (fill present, no border/outline)', () => {
    const { root, anchor, ctrl } = mountFrame()
    ctrl.commit({ diagnosticId: 't2', severity: 'error', anchor, kind: 'table' })
    const frame = root.querySelector('.inkchapter-diagnostic-locate-frame') as HTMLElement
    expect(frame.dataset.presentation).toBe('full-frame')
    expect(frame.dataset.targetKind).toBe('table')
    // The fill comes from the presentation/kind rule (asserted in R7-SCSS-2),
    // and the carrier itself carries no inline border/outline/shadow.
    expect(frame.style.border).toBe('')
    expect(frame.style.outline).toBe('')
    expect(frame.style.boxShadow).toBe('')
  })
})

describe('R7-GATE — the FILL_ONLY hard-gate measurement', () => {
  it('R7-GATE-1: a clean fill-only commit measures every gate as 0 and fill >= 1', () => {
    const facts = { ...emptyActiveLocateFillOnlyFacts(), fillCount: 2 }
    const { counters, fillOk } = measureActiveLocateFillOnlyGates(facts, true)
    for (const key of ACTIVE_LOCATE_FILL_ONLY_GATE_KEYS) expect(counters[key], key).toBe(0)
    expect(fillOk).toBe(true)
    expect(2).toBeGreaterThanOrEqual(ACTIVE_LOCATE_MIN_FILL_COUNT)
    expect(ACTIVE_LOCATE_PRESENTATION_FILL_ONLY).toBe('FILL_ONLY')
  })

  it('R7-GATE-2: every leaked line source is counted in its own bucket', () => {
    const facts = {
      ...emptyActiveLocateFillOnlyFacts(),
      fillCount: 1,
      verticalLineCount: 1,
      horizontalLineCount: 2,
      borderCount: 4,
      outlineCount: 1,
      keylineCount: 1,
      cornerArmCount: 1,
      linePseudoElementCount: 2,
      lineDomChildCount: 1,
      svgStrokeLineCount: 1,
      editorShadowCount: 1,
    }
    const { counters } = measureActiveLocateFillOnlyGates(facts, true)
    expect(counters.activeLocateVerticalLineCount).toBe(1)
    expect(counters.activeLocateHorizontalLineCount).toBe(2)
    expect(counters.activeLocateBorderCount).toBe(4)
    expect(counters.activeLocateOutlineCount).toBe(1)
    expect(counters.activeLocateKeylineCount).toBe(1)
    expect(counters.activeLocateCornerArmCount).toBe(1)
    expect(counters.activeLocateLinePseudoElementCount).toBe(2)
    expect(counters.activeLocateLineDomChildCount).toBe(1)
    expect(counters.activeLocateSvgStrokeLineCount).toBe(1)
    expect(counters.activeLocateEditorShadowCount).toBe(1)
    expect(evaluateActiveLocateFillOnlyGates(counters).decision).toBe('FAIL')
  })

  it('R7-GATE-3: no fill at all fails the fill assertion (line gates stay 0)', () => {
    const { counters, fillOk } = measureActiveLocateFillOnlyGates({ ...emptyActiveLocateFillOnlyFacts(), fillCount: 0 }, true)
    expect(fillOk).toBe(false)
    expect(counters.activeLocateBorderCount).toBe(0)
  })

  it('R7-GATE-4: an uncommitted locate never records line gates', () => {
    const facts = { ...emptyActiveLocateFillOnlyFacts(), borderCount: 4, lineDomChildCount: 3 }
    const { counters } = measureActiveLocateFillOnlyGates(facts, false)
    for (const key of ACTIVE_LOCATE_FILL_ONLY_GATE_KEYS) expect(counters[key], key).toBe(0)
  })

  it('R7-GATE-5: the passive / drawer preservation gates are independent', () => {
    const { counters } = measureActiveLocateFillOnlyGates(
      { ...emptyActiveLocateFillOnlyFacts(), fillCount: 1, passiveHeadingMarkerRemoved: true, drawerSeverityIndicatorRemoved: true },
      true,
    )
    expect(counters.passiveHeadingMarkerUnexpectedRemovalCount).toBe(1)
    expect(counters.drawerSeverityIndicatorUnexpectedRemovalCount).toBe(1)
    expect(counters.activeLocateBorderCount).toBe(0)
  })

  it('R7-GATE-6: the report is exactly the 12 gates and maps every key', () => {
    expect(ACTIVE_LOCATE_FILL_ONLY_GATE_KEYS).toHaveLength(12)
    const counters = createActiveLocateFillOnlyCounters()
    expect(formatActiveLocateFillOnlyGateReport(counters)).toHaveLength(12)
    expect(evaluateActiveLocateFillOnlyGates(counters).decision).toBe('PASS')
    counters.activeLocateKeylineCount = 1
    const failed = evaluateActiveLocateFillOnlyGates(counters)
    expect(failed.decision).toBe('FAIL')
    expect(failed.failing).toContain(ACTIVE_LOCATE_FILL_ONLY_GATE_LABELS.activeLocateKeylineCount)
  })

  it('R7-GATE-7: thin-bar classification is the line detector used by the measurement', () => {
    expect(isHorizontalLineBar({ width: 120, height: 2 })).toBe(true)
    expect(isHorizontalLineBar({ width: 120, height: 18 })).toBe(false)
    expect(isVerticalLineBar({ width: 2, height: 120 })).toBe(true)
    expect(isVerticalLineBar({ width: 18, height: 120 })).toBe(false)
  })
})

describe('R7-PASSIVE — the passive indicator rules survive', () => {
  it('R7-PASSIVE-1 / V5.12-R9 §10: the passive marker is a SOFT TEXT SURFACE + CHIP (no icon / no rail)', () => {
    // V5.12-R9 — the passive gutter marker's icon + rail were REMOVED by design;
    // the passive indicator is now the text-tight fill fragment + the reason chip.
    expect(scss).not.toContain('.inkchapter-heading-diagnostic-marker__rail')
    expect(scss).not.toContain('.inkchapter-heading-diagnostic-marker__icon')
    expect(scss).toContain('.inkchapter-heading-diagnostic-passive__fragment')
    expect(scss).toContain('.inkchapter-heading-diagnostic-reason')
    expect(scss).toContain('.inkchapter-heading-diagnostic-marker {')
    // The drawer row severity rail is untouched (this round never touches Drawer).
    expect(scss).toContain('.inkchapter-doc-drawer__item.is-selected')
  })
})

// ── host-level: a committed locate records the FILL_ONLY audit ──────────────
type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
function readAudit(spy: InfoSpy, event: string, nth = 0): Record<string, string> | null {
  const lines = spy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event))
  const line = lines[nth]
  if (!line) return null
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}

const hosts: DocumentUtilityOverlayHost[] = []
afterEach(() => {
  for (const h of hosts) h.dispose()
  hosts.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function makeHost(): DocumentUtilityOverlayHost {
  const ctx: DocumentUtilitiesContext = {
    authority: {
      getActiveLeafState: () => ({ leafStateKnown: true, leafPath: 'doc.md' }),
      getActiveFilePath: () => 'doc.md',
      getDocumentKey: () => 'doc:r7',
      getMarkdown: () => '# T\n',
      isStrictMode: () => true,
      vaultRoot: '/root',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
  const providers: DocumentDiagnosticsProviders = {
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
  const h = new DocumentUtilityOverlayHost({ ctx, providers })
  h.mount()
  hosts.push(h)
  return h
}

describe('R7-HOST — committed locate emits the FILL_ONLY audit', () => {
  it('R7-HOST-1: the gate report + presentation mode are exposed and start clean', () => {
    const h = makeHost()
    expect(h.getActiveLocatePresentationMode()).toBe(ACTIVE_LOCATE_PRESENTATION_FILL_ONLY)
    expect(h.getActiveLocateFillOnlyV512R7GateReport()).toHaveLength(12)
    expect(h.getActiveLocateFillOnlyV512R7GateDecision().decision).toBe('PASS')
    expect(h.getActiveLocateFillCount()).toBe(0)
  })

  it('R7-HOST-2: a committed object locate measures 0 lines, fill >= 1 and emits decision=PASS', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
    // jsdom applies no stylesheet, so the browser-only computed-style probe is
    // doubled with a REALISTIC fill-only carrier (the measurement code itself is
    // the code under test).
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element, pseudo?: string) => {
      if (pseudo != null) return { content: 'none' } as unknown as CSSStyleDeclaration
      void el
      return {
        backgroundColor: 'rgba(168, 121, 50, 0.21)',
        backgroundImage: 'none',
        boxShadow: 'none',
        outlineStyle: 'none',
        outlineWidth: '0px',
        borderTopStyle: 'none',
        borderRightStyle: 'none',
        borderBottomStyle: 'none',
        borderLeftStyle: 'none',
        borderTopWidth: '0px',
        borderRightWidth: '0px',
        borderBottomWidth: '0px',
        borderLeftWidth: '0px',
      } as unknown as CSSStyleDeclaration
    }) as unknown as typeof window.getComputedStyle)

    const h = makeHost()
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
    const table = document.createElement('table')
    table.setAttribute('data-line', '0')
    write.appendChild(table)
    table.getBoundingClientRect = () => ({ x: 200, y: 300, left: 200, top: 300, right: 900, bottom: 500, width: 700, height: 200, toJSON: () => ({}) }) as DOMRect

    const internals = h as unknown as {
      commitDiagnosticLocateVisual: (
        id: string,
        severity: 'error' | 'warning' | 'info',
        targets: HTMLElement[],
        result: unknown,
        primary: HTMLElement | null,
        diag: unknown,
      ) => void
      commitActiveLocateFillOnlyGates: (committed: boolean, id: string) => void
    }
    const diag = {
      id: 't:TABLE_MISSING_NAME:0',
      severity: 'warning',
      code: 'TABLE_MISSING_NAME',
      documentKey: 'doc:r7',
      message: '',
      detail: '',
      metadata: {},
      location: { kind: 'block-node' as const, blockKind: 'table' as const, stableIdentity: 'block:table:0' },
    }
    internals.commitDiagnosticLocateVisual('t:TABLE_MISSING_NAME:0', 'warning', [table], {
      decision: 'RESOLVED',
      element: table,
      scrollAction: null,
      targetIndex: 0,
      primaryAnchor: 'block-identity',
      fallbackAnchor: null,
      resolvedNodeKind: 'table',
      resolvedBlockIdentity: '0',
    }, table, diag)
    internals.commitActiveLocateFillOnlyGates(true, 't:TABLE_MISSING_NAME:0')

    const audit = readAudit(infoSpy, FILL_ONLY_LOCATE_AUDIT_EVENT)
    expect(audit).not.toBeNull()
    expect(audit!.presentationMode).toBe('FILL_ONLY')
    expect(audit!.lineSource).toBe('MIXED')
    expect(audit!.committed).toBe('true')
    expect(audit!.verticalLineCount).toBe('0')
    expect(audit!.horizontalLineCount).toBe('0')
    expect(audit!.borderCount).toBe('0')
    expect(audit!.outlineCount).toBe('0')
    expect(audit!.keylineCount).toBe('0')
    expect(audit!.cornerArmCount).toBe('0')
    expect(audit!.linePseudoElementCount).toBe('0')
    expect(audit!.lineDomChildCount).toBe('0')
    expect(audit!.svgStrokeLineCount).toBe('0')
    expect(audit!.editorShadowCount).toBe('0')
    expect(Number(audit!.fillCount)).toBeGreaterThanOrEqual(ACTIVE_LOCATE_MIN_FILL_COUNT)
    expect(audit!.fillGateSatisfied).toBe('true')
    expect(audit!.decision).toBe('PASS')
    expect(h.getActiveLocateFillOnlyV512R7GateDecision().decision).toBe('PASS')
    expect(h.getActiveLocateFillOnlyV512R7Counters().activeLocateBorderCount).toBe(0)
    infoSpy.mockRestore()
  })
})
