// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  classifyObserverEmptyEquivalent,
  classifyObserverArmReason,
  evaluateEmptyNonemptyProjectionTransition,
  computeFirstGlyphVisualGeometry,
  type EmptyNonemptyProjectionBefore,
  type EmptyNonemptyProjectionAfter,
} from './empty-special-command'
import {
  initializeForensicSink,
  shutdownForensicSink,
  flushForensicSink,
  emitRuntimeAudit,
} from '../runtime/forensic-log-sink'

function before(overrides: Partial<EmptyNonemptyProjectionBefore> = {}): EmptyNonemptyProjectionBefore {
  return {
    runtimeId: 'P-RUNTIME-2',
    canonicalRecordId: 'R',
    generation: 1,
    semanticMode: 'force-indent',
    visibleText: '',
    isNativeEmpty: true,
    safeEmptyEquivalent: true,
    emptyEquivalentReason: 'NATIVE_EMPTY',
    paddingInlineStartPx: 32,
    textIndentPx: 0,
    fontSizePx: 16,
    paragraphRectLeft: 100,
    borderInlineStartWidth: 0,
    selectionRuntimeId: 'P-RUNTIME-2',
    logicalOffset: 0,
    ...overrides,
  }
}

function after(overrides: Partial<EmptyNonemptyProjectionAfter> = {}): EmptyNonemptyProjectionAfter {
  return {
    runtimeId: 'P-RUNTIME-2',
    canonicalRecordId: 'R',
    generation: 1,
    semanticMode: 'force-indent',
    visibleText: '啊',
    isNativeEmpty: false,
    safeEmptyEquivalent: false,
    emptyEquivalentReason: 'VISIBLE_TEXT_NONEMPTY',
    paddingInlineStartPx: 0,
    textIndentPx: 32,
    fontSizePx: 16,
    paragraphRectLeft: 100,
    borderInlineStartWidth: 0,
    firstGlyphRectLeft: 132,
    selectionRuntimeId: 'P-RUNTIME-2',
    logicalOffset: 1,
    pluginSelectionWriteCount: 0,
    caretContinuityRestoreCount: 0,
    caretRepairCount: 0,
    ...overrides,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  shutdownForensicSink()
  vi.restoreAllMocks()
})

describe('OBSRT2 — empty→nonempty observer safe empty-equivalent runtime contract', () => {
  it('OBSRT2-1: strictNativeEmpty=true → ARM', () => {
    document.body.innerHTML = `<p id="p"></p>`
    const c = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(c.strictNativeEmpty).toBe(true)
    expect(c.safeEmptyEquivalent).toBe(true)
    expect(classifyObserverArmReason('force-indent', '', 'R', c.safeEmptyEquivalent)).toBeNull()
  })

  it('OBSRT2-2: strictNativeEmpty=false + safeEmptyEquivalent=true + CURRENT_LIVE + force-indent → ARM', () => {
    document.body.innerHTML = `<p id="p"><span md-inline="plain" class="md-plain md-expand"></span></p>`
    const c = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(c.strictNativeEmpty).toBe(false)
    expect(c.safeEmptyEquivalent).toBe(true)
    expect(classifyObserverArmReason('force-indent', '', 'R', c.safeEmptyEquivalent)).toBeNull()
  })

  it('OBSRT2-3: safeEmptyEquivalent=false → SKIP BEFORE_NOT_SAFE_EMPTY_EQUIVALENT', () => {
    document.body.innerHTML = `<p id="p"><span data-unknown="x"></span></p>`
    const c = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(c.safeEmptyEquivalent).toBe(false)
    expect(classifyObserverArmReason('force-indent', '', 'R', c.safeEmptyEquivalent)).toBe('BEFORE_NOT_SAFE_EMPTY_EQUIVALENT')
  })

  it('OBSRT2-4: empty md-plain shell → "啊" → ARM + AFTER + TRANSITION exactly once', () => {
    document.body.innerHTML = `<p id="p"><span md-inline="plain" class="md-plain md-expand"></span></p>`
    const p = document.getElementById('p')!
    const beforeState = classifyObserverEmptyEquivalent(p)
    expect(beforeState.safeEmptyEquivalent).toBe(true)
    expect(classifyObserverArmReason('force-indent', '', 'R', beforeState.safeEmptyEquivalent)).toBeNull()

    // First real character enters.
    p.textContent = '啊'
    const afterState = classifyObserverEmptyEquivalent(p)
    expect(afterState.safeEmptyEquivalent).toBe(false)

    let transitionCount = 0
    const r = evaluateEmptyNonemptyProjectionTransition(
      before({ safeEmptyEquivalent: beforeState.safeEmptyEquivalent, emptyEquivalentReason: beforeState.reason, isNativeEmpty: beforeState.strictNativeEmpty }),
      after({ safeEmptyEquivalent: afterState.safeEmptyEquivalent, emptyEquivalentReason: afterState.reason, isNativeEmpty: afterState.strictNativeEmpty }),
    )
    if (r.overall) transitionCount += 1
    expect(transitionCount).toBe(1)
    expect(r.overall).toBe(true)
  })

  it('OBSRT2-5: BEFORE DOM snapshot precedes eligibility decision (read-only)', () => {
    document.body.innerHTML = `<p id="p"><span md-inline="plain" class="md-plain md-expand"></span></p>`
    const p = document.getElementById('p')!
    const domBefore = { html: p.innerHTML, text: p.textContent, count: p.childNodes.length }

    // BEFORE-DOM evidence (classifier) is captured before the eligibility decision.
    const c = classifyObserverEmptyEquivalent(p)
    const reason = classifyObserverArmReason('force-indent', '', 'R', c.safeEmptyEquivalent)

    expect(reason).toBeNull()
    expect(p.innerHTML).toBe(domBefore.html)
    expect(p.textContent).toBe(domBefore.text)
    expect(p.childNodes.length).toBe(domBefore.count)
  })

  it('OBSRT2-6: transition carries emptyEquivalentReasonBefore', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(
      before({ emptyEquivalentReason: 'EMPTY_MD_PLAIN_SHELL' }),
      after(),
    )
    expect(r.emptyEquivalentReasonBefore).toBe('EMPTY_MD_PLAIN_SHELL')
    expect(r.emptyEquivalentReasonAfter).toBe('VISIBLE_TEXT_NONEMPTY')
  })

  it('OBSRT2-7: unknown empty DOM → no transition', () => {
    document.body.innerHTML = `<p id="p"><span data-unknown="x"></span></p>`
    const c = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(c.safeEmptyEquivalent).toBe(false)
    // Ineligible → no ARM, hence no transition is emitted.
    expect(classifyObserverArmReason('force-indent', '', 'R', c.safeEmptyEquivalent)).not.toBeNull()
  })

  it('OBSRT2-8: zero-width content → no ARM', () => {
    document.body.innerHTML = `<p id="p">\u200B</p>`
    const c = classifyObserverEmptyEquivalent(document.getElementById('p')!)
    expect(c.safeEmptyEquivalent).toBe(false)
    expect(classifyObserverArmReason('force-indent', '', 'R', c.safeEmptyEquivalent)).toBe('BEFORE_NOT_SAFE_EMPTY_EQUIVALENT')
  })

  it('OBSRT2-9: first-glyph Range read does not touch Selection', () => {
    const selSpy = vi.spyOn(window, 'getSelection').mockImplementation(() => {
      throw new Error('Selection accessed')
    })
    const g = computeFirstGlyphVisualGeometry({ paragraphRectLeft: 100, borderInlineStartWidth: 0, firstGlyphRectLeft: 132, expectedIndentPx: 32, tolerancePx: 4 })
    expect(g.actualFirstGlyphIndentPx).toBe(32)
    selSpy.mockRestore()
  })

  it('OBSRT2-10: observer evaluation is fail-open (never throws)', () => {
    expect(() =>
      evaluateEmptyNonemptyProjectionTransition(
        before({ fontSizePx: 0, paddingInlineStartPx: 0 }),
        after({ fontSizePx: 0, paddingInlineStartPx: 0 }),
      ),
    ).not.toThrow()
    expect(() => classifyObserverEmptyEquivalent(document.createElement('p'))).not.toThrow()
  })

  it('OBSRT2-11: canonical ID preserved → PASS', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(before(), after())
    expect(r.canonicalIdentityPreserved).toBe(true)
    expect(r.canonicalRecordIdBefore).toBe(r.canonicalRecordIdAfter)
  })

  it('OBSRT2-12: padding32→0 + indent0→32 → projectionExclusive=true', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(before(), after())
    expect(r.paddingInlineStartBeforePx).toBe(32)
    expect(r.paddingInlineStartAfterPx).toBe(0)
    expect(r.textIndentBeforePx).toBe(0)
    expect(r.textIndentAfterPx).toBe(32)
    expect(r.projectionExclusive).toBe(true)
  })

  it('OBSRT2-13: padding32→32 + indent32 → double-indent evidence / overall=false', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(before(), after({ paddingInlineStartPx: 32, textIndentPx: 32 }))
    expect(r.projectionExclusive).toBe(false)
    expect(r.overall).toBe(false)
  })

  it('OBSRT2-14: selection/caret writes remain zero', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(
      before(),
      after({ pluginSelectionWriteCount: 0, caretContinuityRestoreCount: 0, caretRepairCount: 0 }),
    )
    expect(r.pluginSelectionWriteCount).toBe(0)
    expect(r.caretContinuityRestoreCount).toBe(0)
    expect(r.caretRepairCount).toBe(0)
    expect(r.selectionOwnershipClean).toBe(true)
  })

  it('OBSRT2-15: tsIso + tsEpochMs exist on observer audit events', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-obsrt2-'))
    initializeForensicSink({ auditDir: tmp, sessionId: 'obsrt2' })
    emitRuntimeAudit('EMPTY-NONEMPTY-OBSERVER-ARM', { decision: 'ARMED', safeEmptyEquivalent: true })
    flushForensicSink()

    const file = path.join(tmp, 'runtime-obsrt2.log')
    const line = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').pop()!)
    expect(line.event).toBe('EMPTY-NONEMPTY-OBSERVER-ARM')
    expect(typeof line.tsIso).toBe('string')
    expect(typeof line.tsEpochMs).toBe('number')
    expect(Date.parse(line.tsIso)).toBe(line.tsEpochMs)
  })
})
