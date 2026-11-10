/**
 * InkChapter GUI acceptance — READ-ONLY DevTools probe.
 *
 * Usage:
 *   1. Open the target document in Typora.
 *   2. Press Shift+F12 (View → Developer Tools) or Ctrl+Shift+I.
 *   3. Paste this whole file into the Console and press Enter.
 *   4. Copy the returned JSON into the acceptance record.
 *
 * This script NEVER clicks, types, scrolls, writes DOM, changes styles, or
 * calls plugin APIs. It only reads the current DOM and computed styles.
 */
(() => {
  const q = (selector) => document.querySelector(selector)
  const qa = (selector) => Array.from(document.querySelectorAll(selector))
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      x: Math.round(r.x * 100) / 100,
      y: Math.round(r.y * 100) / 100,
      width: Math.round(r.width * 100) / 100,
      height: Math.round(r.height * 100) / 100,
      top: Math.round(r.top * 100) / 100,
      bottom: Math.round(r.bottom * 100) / 100,
    }
  }
  const style = (el, props) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const out = {}
    for (const p of props) out[p] = cs.getPropertyValue(p)
    return out
  }
  const visible = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0
      && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'
  }

  const status = q('.inkchapter-doc-status')
  const square = status ? status.querySelector('.inkchapter-doc-status__square') : null
  const lockFrame = status ? status.querySelector('.inkchapter-doc-status__lock-frame') : null
  const toolbarRoot = q('.inkchapter-doc-toolbar-ui')
  const toolbar = q('.inkchapter-doc-toolbar')
  const layout = q('.inkchapter-doc-expand__layout')
  const tabs = q('.inkchapter-doc-expand__tabs')
  const tabButtons = qa('.inkchapter-doc-expand__tab')
  const panel = q('.inkchapter-doc-expand__panel')
  const write = q('#write')
  const rows = qa('.inkchapter-doc-expand__diag')

  const rowInfo = rows.map((row) => ({
    severity: row.getAttribute('data-severity'),
    text: (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    rect: rect(row),
  }))
  const tabInfo = tabButtons.map((tab) => ({
    tab: tab.getAttribute('data-tab'),
    text: (tab.textContent || '').trim(),
    selected: tab.getAttribute('aria-selected'),
    rect: rect(tab),
  }))

  const result = {
    timestamp: new Date().toISOString(),
    location: {
      title: document.title,
      href: String(location.href),
      bodyClass: document.body ? document.body.className : null,
      htmlClass: document.documentElement.className,
      theme: document.documentElement.getAttribute('data-theme')
        || (document.body ? document.body.getAttribute('data-theme') : null),
      prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
    },
    dpi: {
      devicePixelRatio: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    },
    presence: {
      toolbarRoot: !!toolbarRoot,
      toolbar: !!toolbar,
      status: !!status,
      statusSquare: !!square,
      lockFrame: !!lockFrame,
      layout: !!layout,
      tabs: !!tabs,
      panel: !!panel,
      write: !!write,
      diagRowCount: rows.length,
    },
    visibility: {
      toolbarRoot: visible(toolbarRoot),
      toolbar: visible(toolbar),
      status: visible(status),
      tabs: visible(tabs),
      panel: visible(panel),
      write: visible(write),
      layoutExpanded: toolbarRoot ? toolbarRoot.dataset.expanded : null,
    },
    statusSemantics: status ? {
      dataset: {
        status: status.dataset.status ?? null,
        errorCount: status.dataset.errorCount ?? null,
        warningCount: status.dataset.warningCount ?? null,
        hintCount: status.dataset.hintCount ?? null,
        locked: status.dataset.locked ?? null,
      },
      ariaLabel: status.getAttribute('aria-label'),
      title: status.getAttribute('title'),
      lockedClass: status.classList.contains('is-locked'),
      square: {
        rect: rect(square),
        computed: style(square, [
          'background-color', 'width', 'height', 'border-radius', 'opacity', 'display', 'visibility',
        ]),
      },
      lockFrame: {
        rect: rect(lockFrame),
        computed: style(lockFrame, [
          'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
          'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
          'width', 'height', 'display', 'visibility',
        ]),
      },
    } : null,
    toolbar: {
      rootRect: rect(toolbarRoot),
      toolbarRect: rect(toolbar),
      layoutRect: rect(layout),
      tabsRect: rect(tabs),
      panelRect: rect(panel),
      tabs: tabInfo,
      tabWidthsEqual: (() => {
        const widths = tabInfo.map(t => t.rect ? t.rect.width : 0)
        if (widths.length !== 3) return false
        return Math.max(...widths) - Math.min(...widths) <= 1
      })(),
    },
    diagnostics: {
      total: rowInfo.length,
      bySeverity: {
        error: rowInfo.filter(r => r.severity === 'error').length,
        warning: rowInfo.filter(r => r.severity === 'warning').length,
        hint: rowInfo.filter(r => r.severity === 'hint' || r.severity === 'info').length,
      },
      rows: rowInfo,
    },
    content: {
      writeRect: rect(write),
      writeComputed: style(write, [
        'max-width', 'width', 'margin-left', 'margin-right',
        'border-top-width', 'border-top-style', 'border-top-color',
        'outline-width', 'outline-style', 'outline-color',
      ]),
      lockedDocumentClass: !!(write && write.classList.contains('inkchapter-document-locked')),
    },
    bodyRect: rect(document.body),
    viewport: {
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    },
  }

  console.log('[InkChapter GUI Acceptance]', result)
  return result
})()
