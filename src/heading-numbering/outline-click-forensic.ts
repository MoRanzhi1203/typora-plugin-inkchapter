/**
 * Outline Click Forensic Probe (FORENSIC BUILD ONLY — no business behavior).
 *
 * Exposes `window.__inkchapter_outline_click_forensic__(checkpoint)` so the
 * runtime can capture a BEFORE_OUTLINE_CLICK / AFTER_OUTLINE_CLICK snapshot and
 * attribute the "clicking the sidebar outline" behavior to one of the models
 * A/B/C/D/E. This module never mutates outline/decoration state.
 */

import { findOutlineRoot, findOutlineRootRelaxed, findOutlineTextElements } from './outline-numbering-adapter'

// ── Stable string hash (djb2, 32-bit, hex) ──────────────────────────────
function hashString(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// Attributes InkChapter adds to the outline. These MUST be stripped before any
// native fingerprint is computed, otherwise the probe self-pollutes.
const INKCHAPTER_DECORATION_SELECTORS = [
  '[data-inkchapter-number]',
  '[data-inkchapter-outline-number]',
  '[data-inkchapter-outline-decoration]',
  '[data-inkchapter-number-gap]',
]

interface NativeOutlineItem {
  text: string
  tag: string
  cls: string
  href: string
  level: number
}

/** Strip InkChapter decoration nodes from a cloned subtree and return text. */
function nativeTextOf(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement
  for (const sel of INKCHAPTER_DECORATION_SELECTORS) {
    clone.querySelectorAll(sel).forEach(n => n.remove())
  }
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** Collect native outline items (decoration-stripped) from the real DOM. */
function collectNativeOutlineItems(root: HTMLElement | null): NativeOutlineItem[] {
  if (!root) return []
  const items: NativeOutlineItem[] = []

  const wrappers = root.querySelectorAll<HTMLElement>('.outline-item-wrapper')
  if (wrappers.length > 0) {
    wrappers.forEach(w => {
      const anchor = w.querySelector<HTMLAnchorElement>('a[href]')
      const levelMatch = w.className.match(/outline-h(\d)/)
      items.push({
        text: nativeTextOf(w),
        tag: w.tagName,
        cls: (w.className || '').split(' ').filter(c => !c.startsWith('inkchapter-')).join(' '),
        href: anchor?.getAttribute('href') ?? '',
        level: levelMatch ? parseInt(levelMatch[1], 10) : 0,
      })
    })
    return items
  }

  // Fallback: use the adapter's visible/relaxed text-element finder.
  const els = findOutlineTextElements(root)
  els.forEach(el => {
    const anchor = el.closest<HTMLAnchorElement>('a[href]')
    items.push({
      text: nativeTextOf(el),
      tag: el.tagName,
      cls: (el.className || '').split(' ').filter(c => !c.startsWith('inkchapter-')).join(' '),
      href: el.getAttribute('href') ?? anchor?.getAttribute('href') ?? '',
      level: 0,
    })
  })
  return items
}

function textFingerprint(items: NativeOutlineItem[]): string {
  return hashString(items.map((i, idx) => `${idx}|${i.level}|${i.text}`).join('\n'))
}

function structureFingerprint(items: NativeOutlineItem[]): string {
  return hashString(items.map((i, idx) => `${idx}|${i.tag}|${i.level}|${i.href}|${i.cls}`).join('\n'))
}

/** Capture one full forensic snapshot. Never mutates DOM. */
function captureForensicState(checkpoint: string): Record<string, unknown> {
  const syncProbe = (window as unknown as { __inkchapter_outline_sync_probe__?: () => Record<string, unknown> })
    .__inkchapter_outline_sync_probe__
  const controller = typeof syncProbe === 'function' ? syncProbe() : {}

  // Nested probe objects are dynamically shaped — cast once for typed access.
  const render = controller?.render as Record<string, unknown> | undefined
  const lastApply = controller?.lastApplyTransaction as Record<string, unknown> | undefined
  const lastVerify = controller?.lastVerify as Record<string, unknown> | undefined
  const observerState = controller?.observer as Record<string, unknown> | undefined

  const root = findOutlineRoot()
  const relaxedRoot = root ?? findOutlineRootRelaxed()
  const items = collectNativeOutlineItems(relaxedRoot)

  const rootVisible = root ? root.offsetParent !== null : false
  const rootConnected = relaxedRoot ? relaxedRoot.isConnected : false
  const rootRect = relaxedRoot ? relaxedRoot.getBoundingClientRect() : null
  const rootStyle = relaxedRoot ? getComputedStyle(relaxedRoot) : null

  const state: Record<string, unknown> = {
    checkpoint,
    timestamp: Date.now(),
    performanceNow: performance.now(),
    document: {
      activeFilePath: controller?.activeFilePath ?? null,
      authoritativeDocumentKey: controller?.authoritativeDocumentKey ?? null,
      controllerDocumentKey: controller?.controllerDocumentKey ?? null,
      snapshotDocumentKey: controller?.snapshotDocumentKey ?? null,
      documentGeneration: null,
      businessReady: null,
    },
    snapshot: {
      revision: controller?.snapshotRevision ?? 0,
      headingCount: controller?.headingCount ?? null,
      labelCount: controller?.labelCount ?? null,
      labelsFingerprint: null,
    },
    root: {
      exists: !!relaxedRoot,
      rootToken: controller?.boundRootToken ?? 0,
      rootGeneration: controller?.rootGeneration ?? 0,
      selectorIdentity: relaxedRoot
        ? `${relaxedRoot.tagName}#${relaxedRoot.id || '?'}.${(relaxedRoot.className || '').split(' ')[0]}`
        : null,
      connected: rootConnected,
      visible: rootVisible,
      display: rootStyle?.display ?? null,
      visibility: rootStyle?.visibility ?? null,
      width: rootRect ? Math.round(rootRect.width) : 0,
      height: rootRect ? Math.round(rootRect.height) : 0,
      parentIdentity: relaxedRoot?.parentElement
        ? `${relaxedRoot.parentElement.tagName}#${relaxedRoot.parentElement.id || '?'}`
        : null,
    },
    nativeOutline: {
      itemCount: items.length,
      texts: items.map(i => i.text).slice(0, 60),
      textFingerprint: textFingerprint(items),
      structureFingerprint: structureFingerprint(items),
    },
    inkchapter: {
      decorationCount: relaxedRoot ? relaxedRoot.querySelectorAll('[data-inkchapter-number]').length : 0,
      decorationLabels: [],
      decorationFingerprint: null,
    },
    controller: {
      latestSnapshotRevision: controller?.snapshotRevision ?? 0,
      pendingForVisibleRoot: controller?.waiting ?? false,
      pendingDocumentKey: controller?.pendingDocumentKey ?? null,
      pendingRevision: controller?.pendingRevision ?? 0,
      applyScheduled: render?.pendingRaf ?? false,
      pendingReasons: render?.pendingReasons ?? [],
      lastApplyRevision: lastApply?.snapshotRevision ?? null,
      lastApplyRootToken: lastApply?.rootToken ?? null,
      lastVerifyDecision: lastVerify?.decision ?? null,
    },
    observer: {
      sidebarHostFound: !!document.querySelector('#typora-sidebar, .typora-sidebar, .sidebar-content'),
      hostObserverBound: controller?.hostObserverBound ?? false,
      boundRootToken: controller?.boundRootToken ?? 0,
      rootObserverBound: observerState?.rootBound ?? false,
      candidateRootToken: null,
      resizeObserverBound: controller?.resizeObserverBound ?? false,
    },
  }

  console.log(`[InkChapter Numbering] OUTLINE-CLICK-FORENSIC checkpoint=${checkpoint} ${JSON.stringify(state)}`)
  return state
}

/** Register the forensic probe (idempotent, diagnostic-only). */
export function registerOutlineClickForensic(): void {
  try {
    ;(window as unknown as Record<string, unknown>).__inkchapter_outline_click_forensic__ = (
      checkpoint: string,
    ) => captureForensicState(checkpoint ?? 'UNKNOWN')
  } catch {
    /* ignore */
  }
}
