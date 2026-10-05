// @vitest-environment jsdom
/**
 * TRAE rebase §10 — Diagnostic CLICK PROVENANCE (generic audit) tests.
 *
 *   T1  one pointer activation → exactly one business click
 *   T2  a duplicate dispatch of the SAME activation is DROPPED
 *   T3  a genuine second activation still reaches the business entry
 *   T15 a click with no activation token is allowed (never a fabricated drop)
 *   T16 no debounce / time-window pseudo-fix
 *   H1  host: 1 pointerdown + 2 clicks ⇒ ONE business CLICK_DISPATCH
 *   H2  host: 2 pointerdowns + 2 clicks ⇒ TWO business dispatches
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CLICK_PROVENANCE_AUDIT_EVENT,
  buildClickProvenanceAudit,
  evaluateClickProvenance,
  type ClickProvenanceInput,
  type PointerActivationToken,
} from './document-diagnostic-persistent-carrier-authority-v8'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

const V8_SRC = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-diagnostic-persistent-carrier-authority-v8.ts'), 'utf8')
const HOST_SRC = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')

function token(partial: Partial<PointerActivationToken> = {}): PointerActivationToken {
  return {
    pointerActivationId: 1,
    source: 'POINTER_DOWN',
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    timeStamp: 100,
    targetIdentity: 'div[code:CODE_EMPTY_BLOCK:block:code:0]',
    dispatchCount: 0,
    ...partial,
  }
}

function clickInput(partial: Partial<ClickProvenanceInput> = {}): ClickProvenanceInput {
  return {
    token: null,
    eventType: 'click',
    eventIsTrusted: true,
    eventTimeStamp: 120,
    eventDetail: 1,
    button: 0,
    buttons: 0,
    pointerId: 1,
    pointerType: 'mouse',
    eventTargetIdentity: 'div[code:CODE_EMPTY_BLOCK:block:code:0]',
    currentTargetIdentity: 'div[code:CODE_EMPTY_BLOCK:block:code:0]',
    listenerGeneration: 1,
    handlerInstanceId: 'h1',
    ...partial,
  }
}

describe('TRAE §10 — Click Provenance Authority (generic audit)', () => {
  it('T1: one pointer activation → exactly one business dispatch', () => {
    const t = token({ dispatchCount: 0 })
    const v = evaluateClickProvenance(clickInput({ token: t }))
    expect(v.dispatch).toBe(true)
    expect(v.decision).toBe('DISPATCH')
    t.dispatchCount++
    expect(t.dispatchCount).toBe(1)
  })

  it('T2: the SAME activation reaching the business entry twice is DROPPED', () => {
    const t = token({ dispatchCount: 1 })
    const v = evaluateClickProvenance(clickInput({ token: t }))
    expect(v.dispatch).toBe(false)
    expect(v.decision).toBe('DROP_DUPLICATE_POINTER_ACTIVATION')
    expect(v.reason).toBe('DUPLICATE_BUSINESS_CLICK_FOR_POINTER_ACTIVATION')
  })

  it('T3: a genuine second activation (new token) is dispatched', () => {
    expect(evaluateClickProvenance(clickInput({ token: token({ pointerActivationId: 1, dispatchCount: 1 }) })).dispatch).toBe(false)
    expect(evaluateClickProvenance(clickInput({ token: token({ pointerActivationId: 2, dispatchCount: 0 }) })).dispatch).toBe(true)
  })

  it('T15: a click with no token is allowed (never a fabricated drop)', () => {
    const v = evaluateClickProvenance(clickInput({ token: null }))
    expect(v.dispatch).toBe(true)
    expect(v.reason).toBe('NO_POINTER_ACTIVATION_TOKEN')
  })

  it('T1b: the audit row carries the full provenance field set', () => {
    const t = token()
    const row = buildClickProvenanceAudit({
      documentKey: 'doc:key',
      diagnosticId: 'code:CODE_EMPTY_BLOCK:block:code:0',
      targetKey: 'doc:key::code:CODE_EMPTY_BLOCK:block:code:0::0::block:code:0',
      provenance: clickInput({ token: t }),
      businessClickSequence: 1,
      businessDispatchCountForPointerActivation: 1,
      classifiedAction: 'ACTIVATE',
      sameDiagnostic: false,
      sameTarget: false,
      verdict: evaluateClickProvenance(clickInput({ token: t })),
    })
    for (const key of [
      'pointerActivationId', 'eventType', 'eventIsTrusted', 'eventTimeStamp', 'eventDetail',
      'button', 'buttons', 'pointerId', 'pointerType', 'eventTargetIdentity',
      'currentTargetIdentity', 'listenerGeneration', 'handlerInstanceId',
      'businessClickSequence', 'businessDispatchCountForPointerActivation',
      'classifiedAction', 'sameDiagnostic', 'sameTarget', 'decision', 'reason',
    ]) {
      expect(row).toHaveProperty(key)
    }
    expect(CLICK_PROVENANCE_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-CLICK-PROVENANCE-AUDIT')
  })

  it('T16: neither the authority nor the click dispatch introduces a debounce', () => {
    expect(V8_SRC).toContain('DUPLICATE_BUSINESS_CLICK_FOR_POINTER_ACTIVATION')
    expect(V8_SRC).not.toMatch(/setTimeout|debounce|Date\.now\(\)/)
    const start = HOST_SRC.indexOf('private dispatchDrawerActivation(')
    expect(start).toBeGreaterThan(-1)
    const region = HOST_SRC.slice(start, start + 4200)
    expect(region).not.toMatch(/setTimeout|debounce|Date\.now\(\)/)
    expect(region).toContain('evaluateClickProvenance')
  })
})

// ── Host-level: the drawer dispatch routes through the generic authority ────
describe('TRAE §10 — host drawer dispatch', () => {
  let host: DocumentUtilityOverlayHost | null = null
  let infoSpy: { mock: { calls: unknown[][] }; mockRestore: () => void } | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
    Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as typeof infoSpy
  })
  afterEach(() => {
    infoSpy?.mockRestore()
    infoSpy = null
    host?.dispose()
    host = null
    vi.unstubAllGlobals()
  })

  function ctx(): DocumentUtilitiesContext {
    return {
      authority: {
        getActiveFilePath: () => '/vault/doc.md',
        getDocumentKey: () => 'doc:key',
        getMarkdown: () => '```\n```\n',
        isStrictMode: () => true,
        vaultRoot: '/vault',
        getCanonicalDuplicateIdentities: () => [],
        getCaptionDuplicateNames: () => [],
      },
      hasActiveDocument: () => true,
    }
  }
  function providers(): DocumentDiagnosticsProviders {
    return {
      getFormulaVisibleTagTokens: () => [], getFigureName: () => null, getTableName: () => null,
      getCodeName: () => null, getCodeLanguage: () => null,
      resolveImageLocalPath: () => ({ localPath: null }), isLinkTargetMissing: () => false,
      getHeadingIdentity: () => null, parseLocalLinkTargets: () => [], getObjectCaptionHost: () => null,
    }
  }
  function countAudit(event: string): number {
    return infoSpy!.mock.calls.map(c => String(c[0])).filter(l => l.includes(event)).length
  }

  function mountWithRow(): HTMLElement {
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
    const pre = document.createElement('pre')
    pre.className = 'md-fences'
    pre.setAttribute('data-line', '1')
    write.appendChild(pre)
    const h = new DocumentUtilityOverlayHost({ ctx: ctx(), providers: providers() })
    host = h
    h.mount()
    const snapshot = {
      documentKey: 'doc:key', revision: 1, sourceRevision: 1, generatedAt: 0,
      diagnostics: [{
        id: 'code:CODE_EMPTY_BLOCK:block:code:0',
        documentKey: 'doc:key', severity: 'info', category: 'document',
        code: 'CODE_EMPTY_BLOCK', message: '代码块为空', detail: '',
        metadata: { canonicalBlockIdentity: 'block:code:0', sourceSemanticEmpty: true },
        location: { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' },
      }],
      errorCount: 0, warningCount: 0, infoCount: 1,
    }
    const authority = (h as unknown as {
      diagnostics: { snapshot: unknown; recompute: (r: string) => void }
    }).diagnostics
    authority.snapshot = snapshot
    authority.recompute = () => { /* frozen for the dispatch tests */ }
    ;(h as unknown as { snapshot: unknown }).snapshot = snapshot
    ;(h as unknown as { openDrawer(filter: string): void }).openDrawer('all')
    ;(h as unknown as { renderDrawer(): void }).renderDrawer()
    return document.querySelector<HTMLElement>('.inkchapter-doc-drawer__item[data-diagnostic-id]') as HTMLElement
  }

  it('H1: 1 pointerdown + 2 clicks ⇒ exactly ONE business CLICK_DISPATCH', () => {
    const row = mountWithRow()
    expect(row).toBeTruthy()
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(countAudit('DOCUMENT-DIAGNOSTIC-CLICK-DISPATCH-V2')).toBe(1)
    expect(countAudit(CLICK_PROVENANCE_AUDIT_EVENT)).toBe(2)
    expect(host!.getDuplicatePointerActivationDropCount()).toBe(1)
    expect(host!.getLastClickProvenanceDecision()).toBe('DROP_DUPLICATE_POINTER_ACTIVATION')
    const deactivates = infoSpy!.mock.calls.map(c => String(c[0]))
      .filter(l => l.includes('ACTIVE-INTERACTION-AUDIT') && l.includes('DEACTIVATE')).length
    expect(deactivates).toBe(0)
  })

  it('H2: 2 pointerdowns + 2 clicks ⇒ TWO business dispatches (toggle preserved)', () => {
    const row = mountWithRow()
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(countAudit('DOCUMENT-DIAGNOSTIC-CLICK-DISPATCH-V2')).toBe(2)
    expect(host!.getDuplicatePointerActivationDropCount()).toBe(0)
  })
})
