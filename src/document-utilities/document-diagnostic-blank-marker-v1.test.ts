import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  blankLineMarkerText,
  formatBlankMarkerText,
  renderedMarkerLabelText,
  resolveBlankLineMarkerFact,
  resolveEndExcessCount,
  resolveEndMissingCount,
  resolveEofMarkerSurfacePainted,
  resolveInternalExcessCount,
  resolveRenderedBlankLineCounts,
} from './document-diagnostic-blank-marker-v1'

// Comments contain braces; strip them so the rule scanner sees selectors only.
const STYLE = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const HOST = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')

/** Extract ONE rule body by exact selector member (handles selector lists). */
function ruleBlock(selector: string): string {
  const re = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(STYLE)) !== null) {
    const selectors = match[1].split(',').map(part => part.trim())
    if (selectors.includes(selector)) return `${selector} {${match[2]}}`
  }
  return ''
}

/**
 * M1-RENDER-COUNT — the user-visible count is the RENDER-LAYER count.
 *
 * Measured on the real Typora 1.6.7 editing DOM (`runtime/gui-acceptance/
 * blank-dom-b*.json`): the source newline count and the rendered empty-paragraph
 * count are DIFFERENT. These tests lock the published mapping so a source number
 * can never impersonate a rendered one.
 */
describe('M1-RENDER-COUNT §4/§5 — rendered blank lines are the only visible count', () => {
  it('source 9 blank lines ≠ rendered 4 (the "正文多余9 / 面板多余4" mismatch)', () => {
    const rendered = resolveRenderedBlankLineCounts({
      kind: 'INTERNAL_EXCESS',
      renderedBlankLineCount: 4,
      allowedBlankLineCount: 1,
      evidence: 'RENDERED_ROWS:4;VISIBLE_BANDS:4',
    })
    expect(rendered.countConfidence).toBe('VERIFIED')
    expect(rendered.renderedBlankLineCount).toBe(4)
    expect(rendered.allowedBlankLineCount).toBe(1)
    expect(rendered.excessBlankLineCount).toBe(3)
    expect(rendered.missingBlankLineCount).toBe(0)
    // the label states the RENDERED count, never the source 9
    expect(renderedMarkerLabelText(rendered, 'INTERNAL_EXCESS')).toBe('多余 4 空行')
  })

  it('the real 0/1/2/4/9 source→rendered mapping never fabricates a number', () => {
    // source blank lines → rendered empty <p> rows (measured in real Typora)
    const mapping: Array<[source: number, rendered: number]> = [[0, 0], [1, 0], [2, 0], [4, 1], [9, 4]]
    for (const [source, rendered] of mapping) {
      const counts = resolveRenderedBlankLineCounts({
        kind: 'INTERNAL_EXCESS',
        renderedBlankLineCount: rendered,
        allowedBlankLineCount: 1,
        evidence: `SOURCE:${source};RENDERED:${rendered}`,
      })
      expect(counts.renderedBlankLineCount).toBe(rendered)
      expect(Object.prototype.hasOwnProperty.call(counts, 'sourceBlankLineCount')).toBe(false)
      expect(renderedMarkerLabelText(counts, 'INTERNAL_EXCESS')).toBe(`多余 ${rendered} 空行`)
    }
  })

  it('EOF: a CLEAN file renders 0 blank rows → no excess, no placeholder counted', () => {
    // Tested semantics (real Typora): a clean document gets NO phantom trailing
    // paragraph, so the rendered count is 0 and nothing is reported.
    const counts = resolveRenderedBlankLineCounts({
      kind: 'END_EXCESS', renderedBlankLineCount: 0, allowedBlankLineCount: 1, evidence: 'RENDERED_ROWS:0',
    })
    expect(counts.excessBlankLineCount).toBe(0)
    expect(renderedMarkerLabelText(counts, 'END_EXCESS')).toBe('多余 0 空行')
  })

  it('EOF: 3 source trailing blanks render 2 rows → "多余 2" (not 3)', () => {
    const counts = resolveRenderedBlankLineCounts({
      kind: 'END_EXCESS', renderedBlankLineCount: 2, allowedBlankLineCount: 1, evidence: 'RENDERED_ROWS:2;SOURCE_EXTRA:3',
    })
    expect(counts.excessBlankLineCount).toBe(1)
    expect(renderedMarkerLabelText(counts, 'END_EXCESS')).toBe('多余 2 空行')
  })

  it('END_MISSING: required 1 − rendered 0 = 缺少 1 空行', () => {
    const counts = resolveRenderedBlankLineCounts({
      kind: 'END_MISSING', renderedBlankLineCount: 0, allowedBlankLineCount: 0, requiredBlankLineCount: 1,
      evidence: 'RENDERED_ROWS:0;TERMINAL_NEWLINE:0',
    })
    expect(counts.missingBlankLineCount).toBe(1)
    expect(renderedMarkerLabelText(counts, 'END_MISSING')).toBe('缺少 1 空行')
  })

  it('§4 — an unverified render structure is NOT_VERIFIED and states NO number', () => {
    const counts = resolveRenderedBlankLineCounts({
      kind: 'INTERNAL_EXCESS', renderedBlankLineCount: null, allowedBlankLineCount: 1, evidence: 'NO_RENDERED_ROWS',
    })
    expect(counts.countConfidence).toBe('NOT_VERIFIED')
    expect(counts.renderedBlankLineCount).toBeNull()
    expect(counts.excessBlankLineCount).toBeNull()
    expect(counts.countEvidence).toBe('NO_RENDERED_ROWS:RENDERED_UNKNOWN')
    // the caller must fall back explicitly — never print a source number as rendered
    expect(renderedMarkerLabelText(counts, 'INTERNAL_EXCESS')).toBeNull()
  })

  it('§5 — a negative/garbage rendered input can never produce a verified count', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const counts = resolveRenderedBlankLineCounts({
        kind: 'END_EXCESS', renderedBlankLineCount: bad, allowedBlankLineCount: 1, evidence: 'BAD',
      })
      expect(counts.countConfidence).toBe('NOT_VERIFIED')
      expect(renderedMarkerLabelText(counts, 'END_EXCESS')).toBeNull()
    }
  })
})

describe('blank marker facts — counts come from the diagnostic', () => {
  it('INTERNAL excess = actualBlankLines − passMaxBlankLines', () => {
    expect(resolveInternalExcessCount({ actualBlankLines: 4, passMaxBlankLines: 1 })).toBe(3)
    expect(resolveInternalExcessCount({ actualBlankLines: 2, passMaxBlankLines: 1 })).toBe(1)
    expect(resolveInternalExcessCount({ actualBlankLines: 1, passMaxBlankLines: 1 })).toBeNull()
    expect(resolveInternalExcessCount({})).toBeNull()
  })

  it('END excess = extraTrailingBlankLineCount', () => {
    expect(resolveEndExcessCount({ extraTrailingBlankLineCount: 5 })).toBe(5)
    expect(resolveEndExcessCount({ extraTrailingBlankLineCount: 0 })).toBeNull()
  })

  it('END missing = 1 when the terminal newline is absent', () => {
    expect(resolveEndMissingCount({ terminalNewlineCount: 0 })).toBe(1)
    expect(resolveEndMissingCount({ terminalNewlineCount: 1 })).toBeNull()
    expect(resolveEndMissingCount({})).toBeNull()
  })

  it('states the normalized text and the line style per kind', () => {
    expect(resolveBlankLineMarkerFact('EXCESSIVE_INTERNAL_BLANK_LINES', { actualBlankLines: 4, passMaxBlankLines: 1 }))
      .toEqual({ kind: 'INTERNAL_EXCESS', count: 3, text: '多余 3 空行', lineStyle: 'solid' })
    expect(blankLineMarkerText('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { extraTrailingBlankLineCount: 2 }))
      .toBe('多余 2 空行')
    expect(blankLineMarkerText('DOCUMENT_TERMINAL_NEWLINE_MISSING', { terminalNewlineCount: 0 }))
      .toBe('缺少 1 空行')
    expect(blankLineMarkerText('HEADING_LEVEL_GAP', {})).toBeNull()
    expect(formatBlankMarkerText('END_MISSING', 1)).toBe('缺少 1 空行')
  })
})

describe('blank marker visual contract — three left markers, no filled band / right count', () => {
  it('INTERNAL + END excess share ONE 2px solid left rail, never a fill', () => {
    // M1-LAYOUT — the rail is ONE shared gutter strip (child of either carrier),
    // so both carriers themselves paint NO border and stay transparent.
    const rail = ruleBlock('.inkchapter-blank-rail')
    expect(rail).toContain('border-left: 2px solid var(--ink-blank-space-warning-accent)')
    expect(rail).toContain('pointer-events: none')
    const internal = ruleBlock('.inkchapter-block-gap-fragments')
    expect(internal).not.toContain('border-left: 2px solid var(--ink-blank-space-warning-accent)')
    expect(internal).toContain('background: transparent')
    const end = ruleBlock(
      ".inkchapter-diagnostic-locate-frame[data-ink-eof-marker='true'][data-ink-blank-region='amber-range']",
    )
    expect(end).not.toContain('border-left: 2px solid var(--ink-blank-space-warning-accent)')
    expect(end).toContain('background: transparent')
    expect(end).not.toContain('var(--ink-blank-space-warning-bg)')
  })

  it('the rail lives in the gutter: host wires it through the pure layout authority', () => {
    expect(HOST).toContain('resolveBlankMarkerGutter({')
    expect(HOST).toContain('this.ensureBlankMarkerRail(')
    expect(HOST).toContain("rail.setAttribute('data-ink-blank-rail', '1')")
    expect(HOST).toContain('resolveBlankMarkerChipPlacement({')
  })

  it('per-row fragments never paint their own amber surface (no width-wide band)', () => {
    const override = ruleBlock('.inkchapter-block-gap-fragments .inkchapter-blank-space-warning')
    expect(override).toContain('background: transparent')
    const eofOverride = ruleBlock(
      ".inkchapter-diagnostic-locate-frame[data-ink-eof-marker='true'] .inkchapter-blank-space-warning",
    )
    expect(eofOverride).toContain('background: transparent')
  })

  it('END missing is a 16–20px DASHED left stroke with the label to its right', () => {
    const line = ruleBlock('.inkchapter-eof-endpoint-line')
    const height = Number.parseFloat(line.match(/height:\s*(\d+(?:\.\d+)?)px/)?.[1] ?? '0')
    expect(height).toBeGreaterThanOrEqual(16)
    expect(height).toBeLessThanOrEqual(20)
    expect(line).toContain('border-left: 2px dashed var(--ink-blank-space-warning-accent)')
    expect(line).toContain('background: none')
    // M1-LAYOUT — the whole short-dash + label group is shifted into the gutter by
    // the SAME live offset the excess rail uses (never a fixed 10px on the caret).
    expect(line).toContain('left: var(--ink-blank-marker-offset, 0px)')
    const label = ruleBlock('.inkchapter-eof-endpoint-label')
    expect(label).toContain('left: calc(10px + var(--ink-blank-marker-offset, 0px))')
  })

  it('the single count label is a 20px chip placed by the caret-collision authority', () => {
    const chip = ruleBlock('.inkchapter-blank-run-count')
    // The base rule stays a compact 20px chip; its x/y now comes from the live
    // placement (inline), so it is never hard-pinned onto the caret.
    expect(chip).toContain('height: 20px')
    expect(chip).not.toContain('right: 6px')
    expect(HOST).toContain('data-ink-blank-chip-caret-collision')
    expect(HOST).toContain('markerIntersectsCaret')
  })
})

describe('blank marker host wiring', () => {
  it('the label text is derived from the normalized diagnostic fact', () => {
    expect(HOST).toContain('blankLineMarkerText(diag?.code ?? \'\', meta)')
    expect(HOST).toContain('blankLineMarkerText(diag.code, diag.metadata)')
    expect(HOST).toContain('formatBlankMarkerText(\'END_EXCESS\'')
  })

  it('no blank marker derives its number from a DOM row count', () => {
    expect(HOST).not.toContain('`${count} 空行`')
    expect(HOST).not.toContain('labelBlankCount')
  })

  it('ONLY the label is interactive and locates its own diagnostic', () => {
    expect(HOST).toContain('this.bindBlankMarkerChip(chip, input.diagnosticId)')
    expect(HOST).toContain('this.bindBlankMarkerChip(label, diag.id)')
    expect(HOST).toContain("chip.dataset['diagnosticId'] = diagnosticId")
    expect(HOST).toContain('this.locateDiagnostic(id)')
    // The overlay/carrier never becomes clickable as a whole.
    expect(HOST).toContain("el.style.cssText = `position:absolute;display:block;left:")
  })
})

/**
 * M1 — the EOF marker surface gate must accept the NO-FILL presentation.
 *
 * Runtime evidence 2026-11-12 (Typora 1.6.7): the excess carrier painted its
 * 2px left rail (`pluginOwnedBorderCount=1`) with `fillCount=0`, so the legacy
 * `fillCount >= 1` gate rolled the marker back on EVERY click
 * (`LOCATE_FAILED → marker removed`). The gate must accept the rail/endpoint
 * surface while still failing a carrier with nothing painted.
 */
describe('EOF marker surface gate — left rail / endpoint are real paint', () => {
  it('a 2px left rail with NO fill satisfies the gate', () => {
    expect(resolveEofMarkerSurfacePainted({ fillCount: 0, pluginOwnedBorderCount: 1, endpointForm: false })).toBe(true)
  })

  it('the no-fill END_MISSING endpoint form satisfies the gate', () => {
    expect(resolveEofMarkerSurfacePainted({ fillCount: 0, pluginOwnedBorderCount: 0, endpointForm: true })).toBe(true)
  })

  it('a legacy filled band still satisfies the gate', () => {
    expect(resolveEofMarkerSurfacePainted({ fillCount: 1, pluginOwnedBorderCount: 0, endpointForm: false })).toBe(true)
  })

  it('a carrier with NO painted surface must still FAIL', () => {
    expect(resolveEofMarkerSurfacePainted({ fillCount: 0, pluginOwnedBorderCount: 0, endpointForm: false })).toBe(false)
  })

  it('the host uses this ONE helper for the commit gate', () => {
    expect(HOST).toContain('resolveEofMarkerSurfacePainted({')
    expect(HOST).toContain('pluginOwnedBorderCount: fillFacts.pluginOwnedBorderCount')
  })
})
