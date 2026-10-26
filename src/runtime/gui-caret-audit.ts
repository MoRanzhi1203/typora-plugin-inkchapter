/**
 * R10 GUI CARET PROBE — READ-ONLY, TEST-FIXTURE ONLY.
 *
 * WHY: the R10 GUI matrix must prove, before ANY destructive key, that the real
 * caret belongs to the intended paragraph. Pixel scanning / OCR cannot supply
 * that proof (R10 evidence: blind clicks deleted unrelated paragraphs), and
 * Typora 1.6.7 refuses remote debugging (`Not allow debugging this program`).
 *
 * This module therefore exposes a bounded, read-only observation channel INSIDE
 * the renderer: on `selectionchange` / `input` it emits ONE audit record with
 *   · the caret's REAL top-level block (index, tag, `data-line`, text digest,
 *     anchor/focus offsets, root connectivity),
 *   · the current top-level block map with viewport rects, and
 *   · the viewport (scroll, dpr) needed to map a CSS rect to a screen point.
 *
 * CONSTRAINTS (hard):
 *   · OFF unless `INKCHAPTER_GUI_CARET_AUDIT=1` at startup.
 *   · Only emits for a DISPOSABLE smoke fixture (`…/runtime/smoke/*.md`).
 *   · Read-only: never mutates DOM, selection, Markdown or settings.
 *   · Event-driven with ONE rAF coalescer; no timers, no polling.
 */
import { emitRuntimeAudit } from './forensic-log-sink'

export const GUI_CARET_AUDIT_ENV = 'INKCHAPTER_GUI_CARET_AUDIT'
const FIXTURE_RE = /(^|[\\/])runtime[\\/]smoke[\\/][^\\/]+\.md$/i

export function isGuiCaretAuditRequested(): boolean {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    return proc?.env?.[GUI_CARET_AUDIT_ENV] === '1'
  } catch { return false }
}

function textDigest(el: Element | null): string {
  if (el == null) return ''
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

function topBlockOf(node: Node | null, root: HTMLElement): HTMLElement | null {
  let cur: Node | null = node
  while (cur != null && cur !== root) {
    if (cur.parentNode === root && cur instanceof HTMLElement) return cur
    cur = cur.parentNode
  }
  return null
}

/**
 * Plugin presentation nodes are appended INSIDE `#write`, and real business
 * blocks also carry plugin decoration classes (e.g. `inkchapter-numbered-heading`
 * on the H1, paragraph-indent classes on <p>). Filtering by class prefix would
 * therefore DROP real blocks and shift every index — the probe keeps the FULL
 * top-level child list and only LABELS plugin-owned nodes.
 */
function isPluginNode(el: Element): boolean {
  if (el.hasAttribute('data-inkchapter-presentation')) return true
  if (el.hasAttribute('data-inkchapter-locate-layer')) return true
  const id = el.id.toLowerCase()
  return id.startsWith('inkchapter')
}

function topLevelChildren(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter((el): el is HTMLElement => el instanceof HTMLElement)
}

function blockFacts(el: HTMLElement | null, children: readonly HTMLElement[]): Record<string, unknown> | null {
  if (el == null) return null
  const index = children.indexOf(el)
  const rects = el.getClientRects()
  const rect = rects.length > 0 ? rects[0] : el.getBoundingClientRect()
  return {
    blockIndex: index,
    tag: el.tagName,
    plugin: isPluginNode(el),
    dataLine: el.getAttribute('data-line'),
    textDigest: textDigest(el),
    textLength: (el.textContent ?? '').length,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
  }
}

export interface GuiCaretAuditOptions {
  getDocumentKey: () => string | null
  getSourceRevision: () => number | null
}

export function installGuiCaretAudit(opts: GuiCaretAuditOptions): () => void {
  if (!isGuiCaretAuditRequested()) return () => {}
  if (typeof document === 'undefined') return () => {}

  let disposed = false
  let frame = 0
  let lastSignature = ''

  emitRuntimeAudit('R10-GUI-CARET-PROBE', {
    trigger: 'INSTALL',
    requested: true,
    fixtureRegex: String(FIXTURE_RE),
    activeDocumentKey: opts.getDocumentKey(),
  })

  const emitProbe = (trigger: string): void => {
    if (disposed) return
    const docKey = opts.getDocumentKey()
    if (!docKey || !FIXTURE_RE.test(docKey)) return
    const root = document.getElementById('write')
    if (!(root instanceof HTMLElement)) return
    const sel = document.getSelection()
    const active = document.activeElement
    const anchor = sel?.anchorNode ?? null
    const focus = sel?.focusNode ?? null
    const anchorBlock = topBlockOf(anchor, root)
    const children = topLevelChildren(root)
    const anchorFacts = blockFacts(anchorBlock, children)
    const drawerEl = document.querySelector<HTMLElement>('.inkchapter-doc-drawer')
    const drawerItems = Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-doc-drawer__item[data-diagnostic-id]'))
    const diagButton = document.querySelector<HTMLElement>('.inkchapter-doc-toolbar__btn--diag')
    const caretSignature = [
      docKey,
      anchorFacts == null ? -1 : anchorFacts['blockIndex'],
      sel?.anchorOffset ?? -1,
      sel?.focusOffset ?? -1,
      active?.tagName ?? '',
      drawerEl != null ? `D${drawerEl.getClientRects().length > 0 ? 1 : 0}` : 'D0',
      drawerEl?.className ?? '',
      drawerItems.length,
      diagButton != null ? 'B1' : 'B0',
      children.length,
    ].join('|')
    const isInitial = trigger === 'INITIAL' || trigger === 'INSTALL'
    if (!isInitial && caretSignature === lastSignature) return
    lastSignature = caretSignature
    const diagRect = diagButton?.getClientRects()[0] ?? null
    let diagHit: Record<string, unknown> | null = null
    let diagStyle: Record<string, unknown> | null = null
    let toolbarRect: Record<string, unknown> | null = null
    if (diagButton != null && diagRect != null) {
      const cx = diagRect.left + diagRect.width / 2
      const cy = diagRect.top + diagRect.height / 2
      const hit = document.elementFromPoint(cx, cy)
      diagHit = hit == null ? null : {
        tag: hit.tagName,
        id: hit.id,
        className: String(hit.className),
        text: (hit.textContent ?? '').trim().slice(0, 30),
      }
      const style = getComputedStyle(diagButton)
      diagStyle = {
        pointerEvents: style.pointerEvents,
        visibility: style.visibility,
        opacity: style.opacity,
        display: style.display,
        position: style.position,
      }
      const host = diagButton.parentElement?.parentElement ?? diagButton.parentElement
      const hostRect = host?.getClientRects()[0] ?? null
      toolbarRect = hostRect == null ? null : {
        tag: host?.tagName ?? null,
        className: host?.className ?? null,
        left: hostRect.left,
        top: hostRect.top,
        width: hostRect.width,
        height: hostRect.height,
      }
    }
    emitRuntimeAudit('R10-GUI-CARET-PROBE', {
      trigger,
      documentKey: docKey,
      sourceRevision: opts.getSourceRevision(),
      rootConnected: root.isConnected,
      blockCount: children.length,
      activeElement: active == null ? null : { tag: active.tagName, id: active.id, className: String(active.className) },
      caret: {
        collapsed: sel?.isCollapsed ?? null,
        rangeCount: sel?.rangeCount ?? 0,
        anchorOffset: sel?.anchorOffset ?? null,
        focusOffset: sel?.focusOffset ?? null,
        anchorBlock: anchorFacts,
        focusBlock: blockFacts(topBlockOf(focus, root), children),
      },
      diagnosticsButton: diagButton == null ? null : {
        ariaLabel: diagButton.getAttribute('aria-label'),
        title: diagButton.getAttribute('title'),
        text: (diagButton.textContent ?? '').trim(),
        rect: diagRect == null ? null : { left: diagRect.left, top: diagRect.top, width: diagRect.width, height: diagRect.height },
        style: diagStyle,
        hitTest: diagHit,
        toolbarRect,
      },
      drawer: drawerEl == null ? { visible: false, itemCount: 0, selectedId: null, targets: [] } : {
        visible: drawerEl.getClientRects().length > 0,
        itemCount: drawerItems.length,
        selectedId: drawerItems.find(el => el.classList.contains('is-selected'))?.getAttribute('data-diagnostic-id') ?? null,
        targets: drawerItems.slice(0, 6).map(el => el.getAttribute('data-diagnostic-id')),
        rect: (() => {
          const r = drawerEl.getClientRects()[0]
          return r == null ? null : { left: r.left, top: r.top, width: r.width, height: r.height }
        })(),
        closeRect: (() => {
          const btn = drawerEl.querySelector<HTMLElement>('.inkchapter-doc-drawer__action--close')
          const r = btn?.getClientRects()[0] ?? null
          return r == null ? null : { left: r.left, top: r.top, width: r.width, height: r.height }
        })(),
      },
      viewport: {
        dpr: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
        scrollX: typeof window !== 'undefined' ? window.scrollX : 0,
        scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
        innerWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
        innerHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
      },
      blocks: children.slice(0, 80).map(el => blockFacts(el, children)),
    })
  }

  const schedule = (trigger: string): void => {
    if (disposed || frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      emitProbe(trigger)
    })
  }

  const onSelectionChange = (): void => schedule('SELECTION')
  const onInput = (): void => schedule('INPUT')
  // A document switch replaces the whole writing area; re-probe after the next
  // frame so the block map describes the NEW document (never a stale one).
  const onMutation = (): void => schedule('MUTATION')
  // Read-only click forensics: proves WHAT the real pointer hit (the toolbar
  // button must be hit-testable, not swallowed by a drag region / overlay).
  const onPointer = (ev: MouseEvent): void => {
    if (disposed) return
    const docKey = opts.getDocumentKey()
    if (!docKey || !FIXTURE_RE.test(docKey)) return
    const target = ev.target instanceof Element ? ev.target : null
    emitRuntimeAudit('R10-GUI-CLICK', {
      type: ev.type,
      clientX: ev.clientX,
      clientY: ev.clientY,
      button: ev.button,
      detail: ev.detail,
      target: target == null ? null : {
        tag: target.tagName,
        id: target.id,
        className: String(target.className),
        text: (target.textContent ?? '').trim().slice(0, 30),
      },
      closestDiagButton: target?.closest('.inkchapter-doc-toolbar__btn--diag') != null,
    })
  }

  document.addEventListener('selectionchange', onSelectionChange, true)
  document.addEventListener('input', onInput, true)
  document.addEventListener('mousedown', onPointer, true)
  document.addEventListener('click', onPointer, true)
  const observer = new MutationObserver(onMutation)
  // Body-wide childList only (no attributes / text): the Drawer and the toolbar
  // button live OUTSIDE `#write`, so their appearance must be observable too.
  // Emits are coalesced by ONE rAF and de-duplicated by the probe signature.
  try { observer.observe(document.body, { childList: true, subtree: true }) } catch { /* fail-open */ }
  schedule('INITIAL')

  return () => {
    disposed = true
    document.removeEventListener('selectionchange', onSelectionChange, true)
    document.removeEventListener('input', onInput, true)
    document.removeEventListener('mousedown', onPointer, true)
    document.removeEventListener('click', onPointer, true)
    try { observer.disconnect() } catch { /* fail-open */ }
    if (frame !== 0) {
      try { cancelAnimationFrame(frame) } catch { /* fail-open */ }
      frame = 0
    }
  }
}
