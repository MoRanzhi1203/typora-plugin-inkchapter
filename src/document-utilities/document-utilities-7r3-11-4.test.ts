// @vitest-environment jsdom
/**
 * Phase 7R.3.11.4 — diagnostic sync / heading gap / collision / attribution /
 * BCR verdict / visible-occlusion focused tests (SNAPSHOT-*, HEADING-GAP-*,
 * COLLISION-*, RESIZE-ATTR-*, BCR-*, OCCLUSION-*, INTERACTION-1).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  classifyAttribution,
  computeBcrVerdict,
  computeOverlayGeometry,
  intersectRects,
  rectIntersectionArea,
  DocumentUtilityOverlayHost,
  UTILITY_ROOT_IDENTITY_ATTR,
} from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DiagnosticCanonicalHeadingAuthorityResult } from './document-h1-authority-bridge'
import { computeDocumentDiagnostics } from './document-diagnostics'

const rootIdentity = `[${UTILITY_ROOT_IDENTITY_ATTR}="true"]`

/** Mutable context — lets tests switch the active document like a real switch. */
function mutableContext(initialKey: string | null = 'doc:a'): {
  ctx: DocumentUtilitiesContext
  setKey: (k: string | null) => void
} {
  let key: string | null = initialKey
  const ctx: DocumentUtilitiesContext = {
    authority: {
      getActiveFilePath: () => (key ? '/vault/doc.md' : null),
      getDocumentKey: () => key,
      getMarkdown: () => (key === 'doc:b' ? '# B\n\n' : '# A\n\n## A2\n\n#### A4\n\n'),
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => key != null,
  }
  return {
    ctx,
    setKey: (k) => { key = k },
  }
}

function fakeProviders(overrides: Partial<DocumentDiagnosticsProviders> = {}): DocumentDiagnosticsProviders {
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
    ...overrides,
  }
}

/** Phase 7R.3.11.8B.4 — READY canonical heading result (levels in document order). */
function canonicalHeadingResult(
  levels: number[],
  docKey: string,
  texts: string[] = [],
  lineOffsets: number[] = [],
): DiagnosticCanonicalHeadingAuthorityResult {
  const headingFacts = levels.map((level, i) => {
    const el = document.createElement(`h${level}`)
    if (lineOffsets[i] != null) el.setAttribute('data-line', String(lineOffsets[i]))
    el.textContent = texts[i] ?? `H${level}`
    return { stableIdentity: `H:${docKey}:${i}`, element: el, physicalLevel: level, text: el.textContent ?? '' }
  })
  const h1Facts = headingFacts.filter(f => f.physicalLevel === 1)
  return {
    state: 'READY', reason: 'READY', documentKey: docKey, framePresent: true, frameDocumentKey: docKey,
    semanticRevision: 1, frameGeneration: 1, canonicalEntryCount: headingFacts.length,
    mappedEntryCount: headingFacts.length, invalidEntryCount: 0,
    physicalLevels: headingFacts.map(f => f.physicalLevel),
    headingFacts, h1Facts,
    h1Count: h1Facts.length, h1StableIdentities: h1Facts.map(f => f.stableIdentity),
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
})

function mountHost(ctx: DocumentUtilitiesContext): DocumentUtilityOverlayHost {
  const h = new DocumentUtilityOverlayHost({ ctx, providers: fakeProviders(), onBindDocument: () => {} })
  h.mount()
  return h
}

/**
 * Phase 7R.3.11.8B.4 — heading gap tests run through the HOST must drive the
 * diagnostics heading sequence from the canonical authority (never DOM-only).
 */
function mountHostWithCanonicalHeadings(ctx: DocumentUtilitiesContext): DocumentUtilityOverlayHost {
  const providers = fakeProviders({
    getCanonicalH1Facts: () => {
      const key = ctx.authority.getDocumentKey()
      if (key === 'doc:b') return canonicalHeadingResult([1], 'doc:b', ['B'], [0])
      return canonicalHeadingResult([1, 2, 4], 'doc:a', ['A', 'A2', 'A4'], [0, 2, 4])
    },
  })
  const h = new DocumentUtilityOverlayHost({ ctx, providers, onBindDocument: () => {} })
  h.mount()
  return h
}

describe('SNAPSHOT-1 drawer auto-refreshes across document switch', () => {
  it('drawer renders doc A warnings, then switches to doc B and re-renders in place', () => {
    const { ctx, setKey } = mutableContext('doc:a')
    const write = document.createElement('div')
    write.id = 'write'
    write.innerHTML = '<h1>A</h1><h2>A2</h2><h4>A4</h4>'
    document.body.appendChild(write)
    const h = mountHostWithCanonicalHeadings(ctx)

    // Open drawer → doc A warnings (heading gap 2→4).
    const diag = document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement
    diag.click()
    const list = document.querySelector('.inkchapter-doc-drawer__list') as HTMLElement
    expect(list.textContent).toContain('跳级')

    // Switch to doc B (drawer stays open).
    setKey('doc:b')
    write.innerHTML = '<h1>B</h1>'
    h.bindDocument()

    // Drawer shows doc B content only — no stale doc A warnings.
    expect(list.textContent).toContain('未发现问题')
    expect(list.textContent).not.toContain('跳级')
    expect(list.textContent).not.toContain('表名')
  })
})

describe('HEADING-GAP-1/2 physical level structure lint', () => {
  it('H2→H4 reports HEADING_LEVEL_GAP (missing H3)', () => {
    const r = computeDocumentDiagnostics({
      documentKey: 'doc:a', markdown: '## H2\n\n#### H4\n', strictMode: false, vaultRoot: '/v',
      headings: [
        { level: 2, text: 'H2', element: document.createElement('div') },
        { level: 4, text: 'H4', element: document.createElement('div') },
      ],
      figures: [], tables: [], codes: [], formulas: [], links: [],
      canonicalDuplicateIdentities: [], captionDuplicateNames: [],
    })
    expect(r.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(true)
  })

  it('H2→H3→H4 has no gap', () => {
    const r = computeDocumentDiagnostics({
      documentKey: 'doc:a', markdown: '## H2\n\n### H3\n\n#### H4\n', strictMode: true, vaultRoot: '/v',
      headings: [
        { level: 2, text: 'H2', element: document.createElement('div') },
        { level: 3, text: 'H3', element: document.createElement('div') },
        { level: 4, text: 'H4', element: document.createElement('div') },
      ],
      figures: [], tables: [], codes: [], formulas: [], links: [],
      canonicalDuplicateIdentities: [], captionDuplicateNames: [],
    })
    expect(r.diagnostics.some(d => d.code === 'HEADING_LEVEL_GAP')).toBe(false)
  })
})

describe('COLLISION-1/2 drawer/navigator independent anchors (7R.3.11.8B.3)', () => {
  const viewport = { width: 1920, height: 1080 }
  const shell = { top: 100, right: 1400, bottom: 900 }

  it('drawer closed → navigator at base right position', () => {
    const g = computeOverlayGeometry(shell, viewport, { drawerOpen: false, scrollHeight: 2000, clientHeight: 800 })
    expect(g.navRight).toBe(520 + 28)
    expect(g.navigatorVisible).toBe(true)
  })

  it('drawer open → navigator position UNCHANGED (independent anchor, delta 0)', () => {
    const closed = computeOverlayGeometry(shell, viewport, { drawerOpen: false, scrollHeight: 2000, clientHeight: 800 })
    const open = computeOverlayGeometry(shell, viewport, { drawerOpen: true, scrollHeight: 2000, clientHeight: 800 })
    expect(open.navRight).toBe(520 + 28)
    expect(open.navRight - closed.navRight).toBe(0)
    expect(open.navBottom - closed.navBottom).toBe(0)
    // Drawer is capped above the reserved navigator zone: vertical conflict is
    // resolved by drawerMaxHeight, never by pushing the navigator.
    expect(open.drawerMaxHeight).toBe(1080 - (100 + 56) - 140)
  })

  it('drawer close → navigator still at base position', () => {
    const g = computeOverlayGeometry(shell, viewport, { drawerOpen: false, scrollHeight: 2000, clientHeight: 800 })
    expect(g.navRight).toBe(520 + 28)
  })
})

describe('RESIZE-ATTR-1..4 final attribution verdicts', () => {
  it('MIXED correlation is NOT upgraded to ATTRIBUTED_TO_DOCUMENT_UTILITIES', () => {
    const v = classifyAttribution({ feedbackLoopConfirmedCount: 0, mixedCorrelationCount: 3, externalResizeEpoch: 2, warningCorrelationCount: 2 })
    expect(v).toBe('MIXED')
  })

  it('confirmed causal loop → ATTRIBUTED_TO_DOCUMENT_UTILITIES', () => {
    const v = classifyAttribution({ feedbackLoopConfirmedCount: 2, mixedCorrelationCount: 5, externalResizeEpoch: 2, warningCorrelationCount: 5 })
    expect(v).toBe('ATTRIBUTED_TO_DOCUMENT_UTILITIES')
  })

  it('external only → ATTRIBUTED_TO_EXTERNAL_RESIZE', () => {
    const v = classifyAttribution({ feedbackLoopConfirmedCount: 0, mixedCorrelationCount: 0, externalResizeEpoch: 3, warningCorrelationCount: 1 })
    expect(v).toBe('ATTRIBUTED_TO_EXTERNAL_RESIZE')
  })

  it('no causal evidence → UNPROVEN', () => {
    const v = classifyAttribution({ feedbackLoopConfirmedCount: 0, mixedCorrelationCount: 0, externalResizeEpoch: 0, warningCorrelationCount: 0 })
    expect(v).toBe('UNPROVEN')
  })
})

describe('BCR-1/2 verdict accuracy', () => {
  const base = { toolbarFullscreen: false, navigatorFullscreen: false, drawerFullscreen: false, navigatorExpectedVisible: true }

  it('pre-layout / not committed → GEOMETRY_PENDING (never VISIBLE)', () => {
    const v = computeBcrVerdict({
      ...base,
      geometryCommitted: false, toolbarInsideEditorShell: false, navigatorInsideEditorShell: false,
      toolbarVisible: false, navigatorVisible: false,
      stateSpecificPlacementValid: false, placementFailure: null,
    })
    expect(v).toBe('GEOMETRY_PENDING')
  })

  it('committed + inside shell + visible + bounded → VISIBLE_GEOMETRY', () => {
    const v = computeBcrVerdict({
      ...base,
      geometryCommitted: true, toolbarInsideEditorShell: true, navigatorInsideEditorShell: true,
      toolbarVisible: true, navigatorVisible: true,
      stateSpecificPlacementValid: true, placementFailure: null,
    })
    expect(v).toBe('VISIBLE_GEOMETRY')
  })

  it('inside shell false even when committed → GEOMETRY_PENDING', () => {
    const v = computeBcrVerdict({
      ...base,
      geometryCommitted: true, toolbarInsideEditorShell: false, navigatorInsideEditorShell: true,
      toolbarVisible: true, navigatorVisible: true,
      stateSpecificPlacementValid: true, placementFailure: null,
    })
    expect(v).toBe('GEOMETRY_PENDING')
  })

  it('state-specific placement invalid → NAVIGATOR_STALE_DRAWER_OFFSET (Phase 7R.3.11.6)', () => {
    const v = computeBcrVerdict({
      ...base,
      geometryCommitted: true, toolbarInsideEditorShell: true, navigatorInsideEditorShell: true,
      toolbarVisible: true, navigatorVisible: true,
      stateSpecificPlacementValid: false, placementFailure: 'NAVIGATOR_STALE_DRAWER_OFFSET',
    })
    expect(v).toBe('NAVIGATOR_STALE_DRAWER_OFFSET')
  })

  it('expected-hidden navigator (0×0, not inside shell) → GEOMETRY_VALID_NAV_EXPECTED_HIDDEN, never GEOMETRY_PENDING', () => {
    const v = computeBcrVerdict({
      ...base,
      navigatorExpectedVisible: false,
      // The real hidden navigator is 0×0 → its "inside shell" check is false.
      geometryCommitted: true, toolbarInsideEditorShell: true, navigatorInsideEditorShell: false,
      toolbarVisible: true, navigatorVisible: false,
      stateSpecificPlacementValid: true, placementFailure: null,
    })
    expect(v).toBe('GEOMETRY_VALID_NAV_EXPECTED_HIDDEN')
  })

  it('expected-visible but navigator 0×0 → GEOMETRY_PENDING (real missing case)', () => {
    const v = computeBcrVerdict({
      ...base,
      navigatorExpectedVisible: true,
      geometryCommitted: true, toolbarInsideEditorShell: true, navigatorInsideEditorShell: true,
      toolbarVisible: true, navigatorVisible: false,
      stateSpecificPlacementValid: true, placementFailure: null,
    })
    expect(v).toBe('GEOMETRY_PENDING')
  })
})

describe('OCCLUSION-1 visibleWriteRect uses viewport intersection', () => {
  it('long write rect + short viewport → visibleWriteRect is viewport-bounded', () => {
    const write = { left: 250, top: 100, right: 1450, bottom: 3400 } // long doc
    const viewport = { left: 250, top: 100, right: 1450, bottom: 800 } // ~700 tall viewport
    const vw = intersectRects(write, viewport)
    expect(vw).not.toBeNull()
    expect(vw!.height).toBe(700)
    expect(vw!.height).toBeLessThan(write.bottom - write.top)
  })
})

describe('INTERACTION-1 drawer open + nav click', () => {
  it('navigator click scrolls while the drawer stays open', () => {
    // #write + scrollable shell with a scrollTo spy.
    const shell = document.createElement('div')
    shell.style.cssText = 'overflow-y:auto;'
    Object.defineProperty(shell, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(shell, 'clientHeight', { configurable: true, get: () => 200 })
    Object.defineProperty(shell, 'scrollTop', { configurable: true, get: () => 0, set: () => {} })
    const scrollTo = vi.fn()
    ;(shell as unknown as { scrollTo: unknown }).scrollTo = scrollTo
    const write = document.createElement('div')
    write.id = 'write'
    write.setAttribute('contenteditable', 'true')
    shell.appendChild(write)
    document.body.appendChild(shell)

    const { ctx } = mutableContext('doc:a')
    const h = mountHost(ctx)
    const diag = document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement
    diag.click()
    expect(document.querySelector('.inkchapter-doc-drawer')!.getAttribute('style')).toContain('display: flex')

    const navBtns = Array.from(document.querySelectorAll('.inkchapter-doc-navigator__btn')) as HTMLButtonElement[]
    const downBtn = navBtns[navBtns.length - 1] // ↓
    expect(downBtn.disabled).toBe(false) // scrollable at top → ↓ enabled
    downBtn.click()
    expect(scrollTo).toHaveBeenCalled()
    // Drawer stays open.
    expect(document.querySelector('.inkchapter-doc-drawer')!.getAttribute('style')).toContain('display: flex')
    h.dispose()
  })
})
