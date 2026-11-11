// @vitest-environment jsdom
/**
 * P0 REGRESSION — a code-block diagnostic MUST keep a VISIBLE marker.
 *
 * The previous anchoring round moved the code marker onto the real language bar
 * (CODE_TOPBAR). In production the painted carrier is then only ~30px tall: the
 * one-click visual gate requires the painted rect to intersect the visible
 * editor, and a tall code block whose top bar is scrolled out therefore ends in
 * `ONE_CLICK_VISUAL_FAILED: PAINTED_OUTSIDE_VISIBLE_EDITOR` → the transaction
 * rolls back and the marker DISAPPEARS. The same shrink also made the marker
 * effectively invisible on an `info` (hint) empty block.
 *
 * These tests lock the corrected contract:
 *   - the visible carrier is the DIAGNOSED code block's own body (caption only
 *     when the product semantics own a real caption row);
 *   - the marker never grows onto the next code block / adjacent blank lines;
 *   - a wrong locator element is corrected to the diagnostic's canonical
 *     `block:code:N` (never paint the neighbour);
 *   - a language bar mounted later never removes the marker.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

type Rect = { left: number; top: number; right: number; bottom: number }

function stubRect(el: Element, r: Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top,
      toJSON: () => ({ ...r }),
    }),
  })
}

function fakeCtx(): DocumentUtilitiesContext {
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

function fakeProviders(): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [], getFigureName: () => null, getTableName: () => null,
    getCodeName: () => null, getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }), isLinkTargetMissing: () => false,
    getHeadingIdentity: () => null, parseLocalLinkTargets: () => [], getObjectCaptionHost: () => null,
  }
}

type CodeDiag = DocumentDiagnosticsSnapshot['diagnostics'][number]

function codeDiag(code: string, ordinal: number): CodeDiag {
  return {
    id: `code:${code}:block:code:${ordinal}`,
    documentKey: 'doc:key',
    domain: 'document',
    severity: code === 'CODE_EMPTY_BLOCK' ? 'info' : 'warning',
    category: 'document',
    code,
    message: code,
    metadata: { canonicalBlockIdentity: `block:code:${ordinal}` },
    location: { kind: 'block-node', blockKind: 'code', stableIdentity: `block:code:${ordinal}` },
  } as unknown as CodeDiag
}

type Internals = {
  commitDiagnosticLocateVisual(
    diagId: string | null,
    severity: 'error' | 'warning' | 'info',
    targets: HTMLElement[],
    result: { element: HTMLElement } | null,
    resolvedPrimary: HTMLElement | null,
    diag: CodeDiag | null,
  ): void
}

describe('P0 — code diagnostic marker stays visible and on its OWN block', () => {
  let host: DocumentUtilityOverlayHost | null = null
  let write: HTMLElement
  let pres: HTMLElement[]

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
    write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
    // Four consecutive code blocks, each 240px tall, 10px apart.
    pres = []
    for (let i = 0; i < 4; i++) {
      const pre = document.createElement('pre')
      pre.className = 'md-fences'
      pre.setAttribute('data-line', String(i + 1))
      const top = 100 + i * 250
      stubRect(pre, { left: 60, top, right: 760, bottom: top + 240 })
      write.appendChild(pre)
      pres.push(pre)
    }
    host = new DocumentUtilityOverlayHost({ ctx: fakeCtx(), providers: fakeProviders() })
    host.mount()
  })

  afterEach(() => {
    host?.dispose()
    host = null
    vi.unstubAllGlobals()
  })

  function commit(diag: CodeDiag, anchor: HTMLElement, primary: HTMLElement | null = null): HTMLElement {
    const h = host as unknown as Internals
    h.commitDiagnosticLocateVisual(diag.id, diag.severity, [anchor], { element: anchor }, primary ?? anchor, diag)
    const frame = document.querySelector<HTMLElement>('.inkchapter-diagnostic-locate-frame')
    expect(frame, 'a real locate frame element must be mounted').not.toBeNull()
    return frame!
  }

  function frameGeometry(frame: HTMLElement): { top: number; height: number } {
    return {
      top: Number.parseFloat(frame.style.top || '0'),
      height: Number.parseFloat(frame.style.height || '0'),
    }
  }

  for (const code of ['CODE_MISSING_NAME', 'CODE_MISSING_LANGUAGE', 'CODE_EMPTY_BLOCK']) {
    it(`${code}: with a real language bar the visible marker still covers the code BODY (never only the 30px top bar)`, () => {
      const pre = pres[0]
      const bar = document.createElement('div')
      bar.className = 'inkchapter-content-toolbar--langbar'
      stubRect(bar, { left: 60, top: 100, right: 760, bottom: 134 })
      pre.appendChild(bar)
      const diag = codeDiag(code, 0)
      const frame = commit(diag, pre)
      const g = frameGeometry(frame)
      // The diagnosed block body is 240px; a 34px top-bar-only carrier is the
      // production regression this test exists for.
      expect(g.height, `${code}: marker height must cover the code body`).toBeGreaterThanOrEqual(200)
      expect(Math.abs(g.top - 100), `${code}: marker must start on the code block`).toBeLessThanOrEqual(2)
      expect(frame.dataset.paintKind).not.toBe('code-topbar')
    })
  }

  it('a language bar mounted AFTER the marker exists never removes or shrinks the marker', () => {
    const pre = pres[0]
    const diag = codeDiag('CODE_MISSING_LANGUAGE', 0)
    const before = frameGeometry(commit(diag, pre))
    expect(before.height).toBeGreaterThanOrEqual(200)
    // Typora / the toolbar controller may mount the language bar later.
    const bar = document.createElement('div')
    bar.className = 'inkchapter-content-toolbar--langbar'
    stubRect(bar, { left: 60, top: 100, right: 760, bottom: 134 })
    pre.appendChild(bar)
    const afterFrame = commit(diag, pre)
    const after = frameGeometry(afterFrame)
    expect(after.height).toBeGreaterThanOrEqual(200)
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(2)
  })

  it('only the diagnosed block gets the marker — four consecutive code blocks', () => {
    const target = pres[2]
    const diag = codeDiag('CODE_MISSING_LANGUAGE', 2)
    const frame = commit(diag, target)
    const g = frameGeometry(frame)
    const targetTop = 100 + 2 * 250
    expect(Math.abs(g.top - targetTop)).toBeLessThanOrEqual(2)
    // Never extends onto the previous (code:1) or the next (code:3) block.
    expect(g.top + g.height).toBeLessThanOrEqual(targetTop + 240 + 2)
    expect(g.top).toBeGreaterThanOrEqual(100 + 250 - 2)
  })

  it('a wrong locator element is corrected to the diagnostic canonical block:code:N (never the neighbour)', () => {
    const diag = codeDiag('CODE_MISSING_NAME', 0)
    // The locator (incorrectly) hands back the NEXT code block.
    const frame = commit(diag, pres[1])
    const g = frameGeometry(frame)
    expect(frame.dataset.codeTargetIdentity).toBe('block:code:0')
    expect(frame.dataset.markerOwnerIdentity).toBe('block:code:0')
    expect(Math.abs(g.top - 100), 'marker must sit on block:code:0').toBeLessThanOrEqual(2)
    expect(g.top + g.height, 'marker must not reach block:code:1').toBeLessThanOrEqual(100 + 240 + 2)
  })

  it('CODE_MISSING_NAME with a caption BELOW the block paints the BLOCK, never the caption row', () => {
    // Production path: the caption-host lookup only runs outside the headless test
    // runtime, so force a real-layout user agent for this case.
    const uaSpy = vi.spyOn(Navigator.prototype, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    try {
      host?.dispose()
      const pre = pres[0]
      const caption = document.createElement('p')
      caption.textContent = '代码 1 下方的题注'
      stubRect(caption, { left: 60, top: 350, right: 760, bottom: 370 })
      write.appendChild(caption)
      host = new DocumentUtilityOverlayHost({
        ctx: fakeCtx(),
        providers: { ...fakeProviders(), getObjectCaptionHost: (el) => (el === pre ? caption : null) },
      })
      host.mount()
      const diag = codeDiag('CODE_MISSING_NAME', 0)
      const frame = commit(diag, pre)
      const g = frameGeometry(frame)
      expect(frame.dataset.paintKind).toBe('block-body')
      // Block top is 100 (frame gap 2) — NOT the caption top (350).
      expect(Math.abs(g.top - 98), 'marker must start on the code block').toBeLessThanOrEqual(2)
      expect(g.height, 'marker must cover the code block').toBeGreaterThanOrEqual(200)
      expect(g.top, 'marker must not sit on the caption below').toBeLessThan(300)
    } finally {
      uaSpy.mockRestore()
    }
  })
})
