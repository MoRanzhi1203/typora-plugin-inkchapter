/**
 * Blank-Space Warning Presentation Policy — targeted contract tests (V8).
 *
 * Verifies the shared policy constants / predicates and that the unified
 * `FILL_WITH_LEFT_ACCENT` presentation is actually wired: the
 * `.inkchapter-blank-space-warning` CSS rule restores the ORIGINAL document-end
 * EOF band (low-emphasis Warning surface + ONE 4px left accent rail) and the
 * overlay host invokes `commitBlankSpaceWarningBand` from
 * `applyLocateHighlightAndVerify`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BLANK_SPACE_WARNING_BACKGROUND_MIX_PERCENT,
  BLANK_SPACE_WARNING_BACKGROUND_TOKEN,
  BLANK_SPACE_WARNING_BORDER_RADIUS,
  BLANK_SPACE_WARNING_CODES,
  BLANK_SPACE_WARNING_EOF_CODE,
  BLANK_SPACE_WARNING_INTERNAL_CODE,
  BLANK_SPACE_WARNING_LEADING_H1_PREFIX,
  BLANK_SPACE_WARNING_LEFT_ACCENT_COUNT,
  BLANK_SPACE_WARNING_LEFT_ACCENT_TOKEN,
  BLANK_SPACE_WARNING_LEFT_ACCENT_WIDTH_PX,
  BLANK_SPACE_WARNING_MARKER_CLASS,
  BLANK_SPACE_WARNING_MIN_VISIBLE_HEIGHT_PX,
  BLANK_SPACE_WARNING_POLICY,
  BLANK_SPACE_WARNING_PRESENTATION_MODE,
  BLANK_SPACE_WARNING_SEVERITY,
  BLANK_SPACE_WARNING_TERMINAL_NEWLINE_CODE,
  formatBlankSpaceWarningPolicyReport,
  isBlankSpaceWarningCode,
  isLeadingBlankSpaceWarningCode,
  isTerminalNewlineBlankSpaceWarningCode,
} from './blank-space-warning-presentation'
import { EOF_ACCENT_BORDER_RADIUS, EOF_ACCENT_WIDTH_PX } from './document-diagnostic-document-end-visual-v513-r1'

const STYLE_SCSS = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
const OVERLAY_HOST = readFileSync(
  resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'),
  'utf8',
)

describe('Blank-Space Warning Presentation Policy — constants', () => {
  it('exposes the shared severity / mode / background / left accent / min height', () => {
    expect(BLANK_SPACE_WARNING_SEVERITY).toBe('warning')
    expect(BLANK_SPACE_WARNING_PRESENTATION_MODE).toBe('FILL_WITH_LEFT_ACCENT')
    expect(BLANK_SPACE_WARNING_BACKGROUND_TOKEN).toBe('--ink-blank-space-warning-bg')
    expect(BLANK_SPACE_WARNING_BACKGROUND_MIX_PERCENT).toBe(18)
    expect(BLANK_SPACE_WARNING_LEFT_ACCENT_TOKEN).toBe('--ink-blank-space-warning-accent')
    expect(BLANK_SPACE_WARNING_LEFT_ACCENT_WIDTH_PX).toBe(4)
    expect(BLANK_SPACE_WARNING_LEFT_ACCENT_COUNT).toBe(1)
    expect(BLANK_SPACE_WARNING_BORDER_RADIUS).toBe('0 6px 6px 0')
    expect(BLANK_SPACE_WARNING_MIN_VISIBLE_HEIGHT_PX).toBeGreaterThanOrEqual(2)
    expect(BLANK_SPACE_WARNING_MARKER_CLASS).toBe('inkchapter-blank-space-warning')
  })

  it('reuses the ORIGINAL document-end EOF accent width / radius (no re-invented colour)', () => {
    expect(BLANK_SPACE_WARNING_LEFT_ACCENT_WIDTH_PX).toBe(EOF_ACCENT_WIDTH_PX)
    expect(BLANK_SPACE_WARNING_BORDER_RADIUS).toBe(EOF_ACCENT_BORDER_RADIUS)
  })

  it('aggregates the same values into the frozen policy object', () => {
    expect(BLANK_SPACE_WARNING_POLICY.severity).toBe(BLANK_SPACE_WARNING_SEVERITY)
    expect(BLANK_SPACE_WARNING_POLICY.presentationMode).toBe(BLANK_SPACE_WARNING_PRESENTATION_MODE)
    expect(BLANK_SPACE_WARNING_POLICY.leftAccent).toBe(true)
    expect(BLANK_SPACE_WARNING_POLICY.leftAccentCount).toBe(1)
    expect(BLANK_SPACE_WARNING_POLICY.leftAccentWidthPx).toBe(BLANK_SPACE_WARNING_LEFT_ACCENT_WIDTH_PX)
    expect(BLANK_SPACE_WARNING_POLICY.borderTopWidthPx).toBe(0)
    expect(BLANK_SPACE_WARNING_POLICY.borderRightWidthPx).toBe(0)
    expect(BLANK_SPACE_WARNING_POLICY.borderBottomWidthPx).toBe(0)
    expect(BLANK_SPACE_WARNING_POLICY.outline).toBe(false)
    expect(BLANK_SPACE_WARNING_POLICY.boxShadow).toBe(false)
    expect(BLANK_SPACE_WARNING_POLICY.layoutMutation).toBe(false)
    expect(Object.isFrozen(BLANK_SPACE_WARNING_POLICY)).toBe(true)
  })

  it('lists exactly the four covered codes', () => {
    expect(BLANK_SPACE_WARNING_CODES).toEqual([
      BLANK_SPACE_WARNING_EOF_CODE,
      BLANK_SPACE_WARNING_INTERNAL_CODE,
      BLANK_SPACE_WARNING_TERMINAL_NEWLINE_CODE,
      BLANK_SPACE_WARNING_LEADING_H1_PREFIX,
    ])
  })
})

describe('Blank-Space Warning Presentation Policy — predicates', () => {
  it('isBlankSpaceWarningCode covers all four families and rejects others', () => {
    expect(isBlankSpaceWarningCode(BLANK_SPACE_WARNING_EOF_CODE)).toBe(true)
    expect(isBlankSpaceWarningCode(BLANK_SPACE_WARNING_INTERNAL_CODE)).toBe(true)
    expect(isBlankSpaceWarningCode(BLANK_SPACE_WARNING_TERMINAL_NEWLINE_CODE)).toBe(true)
    expect(isBlankSpaceWarningCode('STRICT_FIRST_H1_LEADING_EMPTY_LINE')).toBe(true)
    expect(isBlankSpaceWarningCode('HEADING_EMPTY_TEXT')).toBe(false)
  })

  it('isLeadingBlankSpaceWarningCode matches the strict leading-H1 family only', () => {
    expect(isLeadingBlankSpaceWarningCode('STRICT_FIRST_H1_LEADING_EMPTY_LINE')).toBe(true)
    expect(isLeadingBlankSpaceWarningCode(BLANK_SPACE_WARNING_LEADING_H1_PREFIX)).toBe(true)
    expect(isLeadingBlankSpaceWarningCode('STRICT_FIRST_H1_DOCUMENT_EMPTY')).toBe(false)
    expect(isLeadingBlankSpaceWarningCode(BLANK_SPACE_WARNING_TERMINAL_NEWLINE_CODE)).toBe(false)
  })

  it('isTerminalNewlineBlankSpaceWarningCode is a strict equality', () => {
    expect(isTerminalNewlineBlankSpaceWarningCode(BLANK_SPACE_WARNING_TERMINAL_NEWLINE_CODE)).toBe(true)
    expect(isTerminalNewlineBlankSpaceWarningCode(BLANK_SPACE_WARNING_EOF_CODE)).toBe(false)
    expect(isTerminalNewlineBlankSpaceWarningCode('DOCUMENT_TERMINAL_NEWLINE_MISSING_EXTRA')).toBe(false)
  })

  it('formatBlankSpaceWarningPolicyReport emits the FILL_WITH_LEFT_ACCENT lines', () => {
    const lines = formatBlankSpaceWarningPolicyReport()
    expect(lines).toContain('BLANK_SPACE_WARNING_POLICY_ID=blank-space-warning-v1')
    expect(lines).toContain('BLANK_SPACE_WARNING_SEVERITY=warning')
    expect(lines).toContain('BLANK_SPACE_WARNING_PRESENTATION_MODE=FILL_WITH_LEFT_ACCENT')
    expect(lines).toContain('BLANK_SPACE_WARNING_LEFT_ACCENT=true')
    expect(lines).toContain('BLANK_SPACE_WARNING_LEFT_ACCENT_WIDTH_PX=4')
    expect(lines).toContain('BLANK_SPACE_WARNING_BACKGROUND_MIX_PERCENT=18')
  })
})

describe('Blank-Space Warning Presentation Policy — CSS band', () => {
  const bandBlock = STYLE_SCSS.match(
    /\.inkchapter-blank-space-warning,\s*\n\.inkchapter-diagnostic-locate-frame\[data-ink-eof-marker='true'\] \{[^}]*\}/,
  )?.[0] ?? ''

  it('shares ONE rule between every blank-space carrier and the EOF selector', () => {
    expect(bandBlock).not.toBe('')
    // Low-emphasis Warning surface + exactly ONE 4px left accent rail.
    expect(bandBlock).toContain('var(--ink-blank-space-warning-bg)')
    expect(bandBlock).toContain('var(--ink-blank-space-warning-accent-width)')
    expect(bandBlock).toContain('solid')
    expect(bandBlock).toContain('var(--ink-blank-space-warning-accent)')
    expect(bandBlock).toContain('var(--ink-blank-space-warning-radius)')
    // No top / right / bottom border line, no outline, no shadow.
    expect(bandBlock).toContain('border: 0')
    expect(bandBlock).toContain('box-shadow: none')
    expect(bandBlock).toContain('outline: none')
    expect(bandBlock).toContain('pointer-events: none')
  })

  it('the Warning token values (deepened 18% surface, 4px accent, 0 6px 6px 0, 3px row rail)', () => {
    expect(STYLE_SCSS).toContain('--ink-blank-space-warning-accent-width: 4px')
    expect(STYLE_SCSS).toContain('--ink-blank-space-warning-radius: 0 6px 6px 0')
    expect(STYLE_SCSS).toContain(
      '--ink-blank-space-warning-bg: color-mix(in srgb, var(--ink-ui-sev-warning, #a87932) 18%, transparent)',
    )
    expect(STYLE_SCSS).toContain('--ink-blank-space-warning-accent: var(--ink-ui-sev-warning, #a87932)')
    // 醒目度优化 — the per-row 3px LEFT rail token.
    expect(STYLE_SCSS).toContain('--ink-blank-space-warning-fragment-rail: 3px')
  })

  it('统一绘制权威 — ONE range background + ONE left accent + ONE count label', () => {
    // the container owns the ONE range surface + ONE accent (no stacked layers)
    const containerBlock = STYLE_SCSS.match(/\.inkchapter-block-gap-fragments \{[^}]*\}/)?.[0] ?? ''
    expect(containerBlock).not.toBe('')
    expect(containerBlock).toContain('background: var(--ink-blank-space-warning-bg)')
    // 光标安全 — the container must carry NO inner vertical bar / border line
    expect(containerBlock).toContain('border: 0')
    expect(containerBlock).not.toContain('border-left')
    // the per-row fragments are pure geometry anchors → NO surface of their own
    const fragBlock = STYLE_SCSS.match(/\.inkchapter-block-gap-fragment \{[^}]*\}/)?.[0] ?? ''
    expect(fragBlock).toContain('background: transparent')
    // the removed per-row role fills must NOT come back (they caused stacked layers)
    expect(STYLE_SCSS).not.toMatch(/data-ink-blank-role='(allowed|excess)'\] \{/)
    // ONE count label, overlay-only
    const chipBlock = STYLE_SCSS.match(/\.inkchapter-blank-run-count \{[^}]*\}/)?.[0] ?? ''
    expect(chipBlock).not.toBe('')
    expect(chipBlock).toContain('pointer-events: none')
    // 光标安全 — the label is RIGHT-aligned, never over the left caret column
    expect(chipBlock).toContain('right: 6px')
    expect(chipBlock).not.toContain('left:')
  })

  it('the bright FILL_ONLY regression is gone from the blank-space carriers', () => {
    const gapBlock = STYLE_SCSS.match(/\.inkchapter-block-gap-visual \{[^}]*\}/)?.[0] ?? ''
    expect(gapBlock).not.toBe('')
    expect(gapBlock).not.toContain('--ink-diagnostic-warning-active-bg')
    expect(gapBlock).not.toContain('background-color')
    expect(bandBlock).not.toContain('--ink-diagnostic-warning-active-bg')
  })
})

describe('Blank-Space Warning Presentation Policy — overlay host wiring', () => {
  it('the host defines and invokes commitBlankSpaceWarningBand after the verify hook', () => {
    expect(OVERLAY_HOST).toContain('commitBlankSpaceWarningBand')
    const verifyAt = OVERLAY_HOST.indexOf('private applyLocateHighlightAndVerify')
    const callAt = OVERLAY_HOST.indexOf('this.commitBlankSpaceWarningBand(')
    expect(verifyAt).toBeGreaterThanOrEqual(0)
    expect(callAt).toBeGreaterThan(verifyAt)
  })

  it('every blank-space carrier carries the shared marker class', () => {
    // TRAE §22/§24 + 醒目度优化 — the gap carrier's container carries the shared
    // marker surface (the CONTINUOUS band) and the N row fragments carry the
    // shared marker class for their per-row left rail.
    expect(OVERLAY_HOST).toContain('${RENDERED_BLANK_ROW_FRAGMENT_CLASS} ${BLANK_SPACE_WARNING_MARKER_CLASS}')
    expect(OVERLAY_HOST).toContain('${BLOCK_GAP_VISUAL_CLASS} ${RENDERED_BLANK_ROW_FRAGMENT_CONTAINER_CLASS}')
    // EOF carrier
    expect(OVERLAY_HOST).toContain('${DIAGNOSTIC_LOCATE_FRAME_CLASS} ${BLANK_SPACE_WARNING_MARKER_CLASS}')
    // terminal-newline / leading-H1 band
    expect(OVERLAY_HOST).toContain('data-ink-blank-space-warning')
  })
})
