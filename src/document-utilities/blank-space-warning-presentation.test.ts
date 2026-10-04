/**
 * Blank-Space Warning Presentation Policy — targeted contract tests.
 *
 * Verifies the shared policy constants / predicates and that the unified
 * FILL_ONLY warning band is actually wired: the `.inkchapter-blank-space-warning`
 * CSS rule is identical to the document-end reference band, and the overlay host
 * invokes `commitBlankSpaceWarningBand` from `applyLocateHighlightAndVerify`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BLANK_SPACE_WARNING_CODES,
  BLANK_SPACE_WARNING_EOF_CODE,
  BLANK_SPACE_WARNING_FILL_TOKEN,
  BLANK_SPACE_WARNING_INTERNAL_CODE,
  BLANK_SPACE_WARNING_LEADING_H1_PREFIX,
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

const STYLE_SCSS = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
const OVERLAY_HOST = readFileSync(
  resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'),
  'utf8',
)

describe('Blank-Space Warning Presentation Policy — constants', () => {
  it('exposes the shared severity / mode / fill token / min height', () => {
    expect(BLANK_SPACE_WARNING_SEVERITY).toBe('warning')
    expect(BLANK_SPACE_WARNING_PRESENTATION_MODE).toBe('FILL_ONLY')
    expect(BLANK_SPACE_WARNING_FILL_TOKEN).toBe('--ink-diagnostic-warning-active-bg')
    expect(BLANK_SPACE_WARNING_MIN_VISIBLE_HEIGHT_PX).toBeGreaterThanOrEqual(2)
    expect(BLANK_SPACE_WARNING_MARKER_CLASS).toBe('inkchapter-blank-space-warning')
  })

  it('aggregates the same values into the frozen policy object', () => {
    expect(BLANK_SPACE_WARNING_POLICY.severity).toBe(BLANK_SPACE_WARNING_SEVERITY)
    expect(BLANK_SPACE_WARNING_POLICY.presentationMode).toBe(BLANK_SPACE_WARNING_PRESENTATION_MODE)
    expect(BLANK_SPACE_WARNING_POLICY.fillToken).toBe(BLANK_SPACE_WARNING_FILL_TOKEN)
    expect(BLANK_SPACE_WARNING_POLICY.markerClass).toBe(BLANK_SPACE_WARNING_MARKER_CLASS)
    expect(BLANK_SPACE_WARNING_POLICY.minVisibleHeightPx).toBe(BLANK_SPACE_WARNING_MIN_VISIBLE_HEIGHT_PX)
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

  it('formatBlankSpaceWarningPolicyReport emits the FILL_ONLY + fill-token lines', () => {
    const lines = formatBlankSpaceWarningPolicyReport()
    expect(lines).toContain('BLANK_SPACE_WARNING_POLICY_ID=blank-space-warning-v1')
    expect(lines).toContain('BLANK_SPACE_WARNING_SEVERITY=warning')
    expect(lines).toContain('BLANK_SPACE_WARNING_PRESENTATION_MODE=FILL_ONLY')
    expect(lines).toContain('BLANK_SPACE_WARNING_FILL_TOKEN=--ink-diagnostic-warning-active-bg')
  })
})

describe('Blank-Space Warning Presentation Policy — CSS band', () => {
  it('the unified band is the same FILL_ONLY fill with no border / outline / shadow', () => {
    const block = STYLE_SCSS.match(/\.inkchapter-blank-space-warning \{[^}]*\}/)?.[0] ?? ''
    expect(block).not.toBe('')
    expect(block).toContain('--ink-diagnostic-warning-active-bg')
    expect(block).toContain('box-shadow: none')
    expect(block).toContain('outline: none')
    expect(block).not.toContain('border: 1px')
    expect(block).toContain('border: 0')
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
})
