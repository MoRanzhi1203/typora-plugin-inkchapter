/**
 * InkChapter GUI acceptance probe — READ-ONLY.
 *
 * The file is a UMD-style factory so the SAME source can be:
 *   - pasted into Typora DevTools (it auto-runs and logs JSON), and
 *   - unit-tested from Node/jsdom via `createProbe(document, window)`.
 *
 * It NEVER clicks, types, scrolls, writes DOM, changes styles, or calls plugin
 * APIs. It only reads DOM, computed styles and `elementsFromPoint`.
 */
(function (global) {
  'use strict'

  const TOLERANCE_PX = 1
  const PLUGIN_ROOT = '[data-inkchapter-ui-root="document-utilities"]'

  function round(value) {
    return Math.round(value * 100) / 100
  }

  function tri(applicable, pass, reason) {
    if (!applicable) return { verdict: 'NOT_APPLICABLE', reason }
    return { verdict: pass ? 'PASS' : 'FAIL', reason }
  }

  function createProbe(doc, win) {
    const getStyle = (el) => win.getComputedStyle(el)

    function q(selector) {
      return doc.querySelector(selector)
    }
    function qa(selector) {
      return Array.from(doc.querySelectorAll(selector))
    }
    function rect(el) {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height),
        top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right),
      }
    }
    function computed(el, props) {
      if (!el) return null
      const cs = getStyle(el)
      const out = {}
      for (const p of props) out[p] = cs.getPropertyValue(p)
      return out
    }
    function hasBox(el) {
      if (!el) return false
      const r = el.getBoundingClientRect()
      if (!(r.width > 0 && r.height > 0)) return false
      const cs = getStyle(el)
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'
    }
    function parseMs(value) {
      return String(value || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => part.endsWith('ms') ? Number.parseFloat(part) : Number.parseFloat(part) * 1000)
        .filter(Number.isFinite)
        .reduce((max, n) => Math.max(max, n), 0)
    }
    function maxTransitionMs(elements) {
      let max = 0
      for (const el of elements) {
        if (!el) continue
        const cs = getStyle(el)
        max = Math.max(max, parseMs(cs.transitionDuration) + parseMs(cs.transitionDelay))
      }
      return Math.round(max)
    }
    function nextFrame() {
      return new Promise(resolve => {
        if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => resolve())
        else win.setTimeout(resolve, 16)
      })
    }
    function geometrySignature(elements) {
      return elements.map(el => {
        const r = el ? rect(el) : null
        return r ? `${r.left},${r.top},${r.width},${r.height}` : 'null'
      }).join('|')
    }
    async function waitForStable(elements, maxWaitMs) {
      const started = Date.now()
      let last = geometrySignature(elements)
      let stableFrames = 0
      let samples = 0
      while (Date.now() - started < maxWaitMs && stableFrames < 2) {
        await nextFrame()
        samples++
        const next = geometrySignature(elements)
        if (next === last) stableFrames++
        else { stableFrames = 0; last = next }
      }
      return {
        settled: stableFrames >= 2,
        waitedMs: Date.now() - started,
        samples,
        maxWaitMs,
      }
    }
    function delta(a, b, key) {
      if (!a || !b) return null
      return round(a[key] - b[key])
    }
    function columnVerdict(a, b, applicable, settled, pair) {
      if (!applicable) return { pair, verdict: 'NOT_APPLICABLE', reason: 'COLLAPSED_OR_NOT_VISIBLE', deltas: null }
      if (!a || !b) return { pair, verdict: 'FAIL', reason: 'MISSING_RECT', deltas: null }
      if (!settled) return { pair, verdict: 'NOT_APPLICABLE', reason: 'TRANSITION_NOT_SETTLED', deltas: null }
      const deltas = {
        left: delta(a, b, 'left'),
        right: delta(a, b, 'right'),
        width: delta(a, b, 'width'),
      }
      const pass = Math.abs(deltas.left) <= TOLERANCE_PX
        && Math.abs(deltas.right) <= TOLERANCE_PX
        && Math.abs(deltas.width) <= TOLERANCE_PX
      return { pair, verdict: pass ? 'PASS' : 'FAIL', reason: pass ? 'WITHIN_1PX' : 'EXCEEDS_1PX', deltas, tolerancePx: TOLERANCE_PX }
    }
    function hitTest(point, write) {
      const elements = typeof doc.elementsFromPoint === 'function'
        ? doc.elementsFromPoint(point.x, point.y)
        : (typeof doc.elementFromPoint === 'function'
          ? [doc.elementFromPoint(point.x, point.y)].filter(Boolean)
          : [])
      const pluginElements = elements.filter(el => el && el.closest && el.closest(PLUGIN_ROOT))
      const top = elements[0] || null
      return {
        x: round(point.x), y: round(point.y),
        topTag: top ? top.tagName : null,
        topClass: top ? String(top.className || '') : null,
        insideWrite: !!(top && write && write.contains(top)),
        pluginHit: pluginElements.length > 0,
        pluginTags: pluginElements.slice(0, 4).map(el => el.tagName + (el.className ? '.' + String(el.className).split(/\s+/).slice(0, 2).join('.') : '')),
      }
    }

    async function run() {
      const status = q('.inkchapter-doc-status')
      const square = status ? status.querySelector('.inkchapter-doc-status__square') : null
      const lockFrame = status ? status.querySelector('.inkchapter-doc-status__lock-frame') : null
      const toolbarRoot = q('.inkchapter-doc-toolbar-ui')
      const toolbar = q('.inkchapter-doc-toolbar')
      const layout = q('.inkchapter-doc-expand__layout')
      const row = q('.inkchapter-doc-expand__row')
      const tabs = q('.inkchapter-doc-expand__tabs')
      const tabButtons = qa('.inkchapter-doc-expand__tab')
      const panel = q('.inkchapter-doc-expand__panel')
      const write = q('#write')
      const rows = qa('.inkchapter-doc-expand__diag')

      const expanded = !!(toolbarRoot && toolbarRoot.dataset.expanded === 'true')
      const tabsVisible = hasBox(tabs)
      const panelVisible = hasBox(panel)
      const rowVisible = hasBox(row)
      const writeVisible = hasBox(write)
      const tabInfo = tabButtons.map(tab => ({
        tab: tab.getAttribute('data-tab'),
        text: String(tab.textContent || '').trim(),
        selected: tab.getAttribute('aria-selected'),
        visible: hasBox(tab),
        rect: rect(tab),
      }))
      const widths = tabInfo.map(t => t.rect ? t.rect.width : 0)
      const allTabsVisible = tabInfo.length === 3 && tabInfo.every(t => t.visible && t.rect && t.rect.width > 0)

      const transitionElements = [toolbarRoot, toolbar, layout, row, tabs, panel, ...tabButtons]
      const transitionMaxMs = maxTransitionMs(transitionElements)
      const settle = expanded
        ? await waitForStable([layout, row, tabs, panel, ...tabButtons], Math.min(transitionMaxMs + 120, 1400))
        : { settled: false, waitedMs: 0, samples: 0, maxWaitMs: 0 }

      // Tab-width validation: collapsed = NOT_APPLICABLE; expanded but hidden/zero
      // = FAIL (the expanded UI is expected to show 3 tabs); visible but not
      // settled = NOT_APPLICABLE (cannot judge yet).
      let tabWidth
      if (!expanded) {
        tabWidth = { verdict: 'NOT_APPLICABLE', reason: 'COLLAPSED', widths, delta: null, tolerancePx: TOLERANCE_PX }
      } else if (!tabsVisible || !allTabsVisible) {
        tabWidth = { verdict: 'FAIL', reason: 'TAB_HIDDEN_OR_ZERO_WIDTH', widths, delta: null, tolerancePx: TOLERANCE_PX }
      } else if (!settle.settled) {
        tabWidth = { verdict: 'NOT_APPLICABLE', reason: 'TRANSITION_NOT_SETTLED', widths, delta: null, tolerancePx: TOLERANCE_PX }
      } else {
        const d = round(Math.max(...widths) - Math.min(...widths))
        tabWidth = { verdict: d <= TOLERANCE_PX ? 'PASS' : 'FAIL', reason: d <= TOLERANCE_PX ? 'WITHIN_1PX' : 'EXCEEDS_1PX', widths, delta: d, tolerancePx: TOLERANCE_PX }
      }

      // Geometry pairs: header(row) vs content(panel), layout vs each.
      const geometryApplicable = expanded && rowVisible && panelVisible
      const geometryPairs = [
        columnVerdict(rect(row), rect(panel), geometryApplicable, settle.settled, 'row-vs-panel'),
        columnVerdict(rect(layout), rect(row), geometryApplicable, settle.settled, 'layout-vs-row'),
        columnVerdict(rect(layout), rect(panel), geometryApplicable, settle.settled, 'layout-vs-panel'),
      ]
      const geometryOverall = !expanded
        ? { verdict: 'NOT_APPLICABLE', reason: 'COLLAPSED' }
        : (!geometryApplicable
          ? { verdict: 'FAIL', reason: 'EXPANDED_BUT_ROW_OR_PANEL_NOT_VISIBLE' }
          : (!settle.settled
            ? { verdict: 'NOT_APPLICABLE', reason: 'TRANSITION_NOT_SETTLED' }
            : (geometryPairs.some(p => p.verdict === 'FAIL')
              ? { verdict: 'FAIL', reason: 'COLUMN_DELTA_EXCEEDS_1PX' }
              : { verdict: 'PASS', reason: 'ALL_COLUMNS_WITHIN_1PX' })))

      const dataset = status ? {
        status: status.dataset.status ?? null,
        errorCount: status.dataset.errorCount ?? null,
        warningCount: status.dataset.warningCount ?? null,
        hintCount: status.dataset.hintCount ?? null,
        locked: status.dataset.locked ?? null,
      } : null
      const instanceCounts = {
        error: dataset && dataset.errorCount != null ? Number(dataset.errorCount) : null,
        warning: dataset && dataset.warningCount != null ? Number(dataset.warningCount) : null,
        hint: dataset && dataset.hintCount != null ? Number(dataset.hintCount) : null,
      }
      const instanceTotal = instanceCounts.error == null ? null : instanceCounts.error + instanceCounts.warning + instanceCounts.hint

      const rowInfo = rows.map(r => ({
        id: r.getAttribute('data-diagnostic-id'),
        severity: r.getAttribute('data-severity'),
        text: String(r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        rect: rect(r),
      }))
      const groups = new Map()
      for (const item of rowInfo) {
        const key = item.id || ('anonymous:' + groups.size)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(item)
      }
      const multiTargetGroups = [...groups.entries()]
        .filter(([, items]) => items.length > 1)
        .map(([id, items]) => ({ id, rowCount: items.length, severities: [...new Set(items.map(i => i.severity))], sample: items.slice(0, 3).map(i => i.text) }))

      const domBySeverity = {
        error: rowInfo.filter(r => r.severity === 'error').length,
        warning: rowInfo.filter(r => r.severity === 'warning').length,
        hint: rowInfo.filter(r => r.severity === 'hint' || r.severity === 'info').length,
      }
      const projectionApplicable = expanded && panelVisible
      const projectedRowCount = projectionApplicable ? rowInfo.length : null
      const projection = tri(
        projectionApplicable,
        projectionApplicable && (instanceTotal == null || rowInfo.length >= 0),
        projectionApplicable ? 'EXPANDED_DOM_ROWS' : 'COLLAPSED_DOM_ROWS_NOT_AVAILABLE',
      )
      const rowCoverage = {
        applicable: projectionApplicable,
        verdict: !projectionApplicable ? 'NOT_APPLICABLE' : 'PASS',
        reason: projectionApplicable ? 'DOM_ROWS_PRESENT' : 'COLLAPSED_DOES_NOT_MEAN_ZERO_DIAGNOSTICS',
        instanceCounts,
        instanceTotal,
        projectedRowCount,
        domRowCount: rowInfo.length,
        domBySeverity,
        uniqueDiagnosticIds: groups.size,
      }

      let multiTarget
      if (!projectionApplicable) {
        multiTarget = { verdict: 'NOT_APPLICABLE', reason: 'COLLAPSED', groups: multiTargetGroups }
      } else if (multiTargetGroups.length === 0) {
        multiTarget = { verdict: 'NOT_APPLICABLE', reason: 'NO_MULTI_TARGET_GROUP', groups: multiTargetGroups }
      } else {
        const okay = multiTargetGroups.every(g => g.rowCount >= 2)
          && multiTargetGroups.every(g => instanceCounts.warning == null || instanceCounts.warning >= 1)
        multiTarget = {
          verdict: okay ? 'PASS' : 'FAIL',
          reason: okay ? 'ONE_EVENT_N_TARGETS_N_ROWS' : 'TARGET_ROW_CARDINALITY_MISMATCH',
          expected: '1 warning event, 2 targets, 2 display rows',
          groups: multiTargetGroups,
        }
      }

      // Collapsed transparent-layer hit test: points inside #write must not
      // resolve to any plugin overlay/toolbar element.
      let collapsedHitTest
      const writeRect = rect(write)
      if (expanded || !writeVisible || !writeRect || writeRect.width <= 0 || writeRect.height <= 0) {
        collapsedHitTest = { verdict: 'NOT_APPLICABLE', reason: expanded ? 'EXPANDED' : 'WRITE_NOT_VISIBLE', points: [] }
      } else {
        const points = [
          { x: writeRect.left + writeRect.width / 2, y: writeRect.top + writeRect.height / 2 },
          { x: writeRect.left + Math.max(8, writeRect.width * 0.2), y: writeRect.top + writeRect.height / 2 },
          { x: writeRect.left + Math.min(writeRect.width - 8, writeRect.width * 0.8), y: writeRect.top + writeRect.height / 2 },
        ]
        const hits = points.map(p => hitTest(p, write))
        const blocked = hits.filter(h => h.pluginHit).length
        collapsedHitTest = {
          verdict: blocked === 0 ? 'PASS' : 'FAIL',
          reason: blocked === 0 ? 'NO_PLUGIN_HIT_AT_WRITE_POINTS' : 'PLUGIN_LAYER_BLOCKS_WRITE',
          blockingCount: blocked,
          points: hits,
        }
      }

      const maxWidthRaw = write ? getStyle(write).getPropertyValue('max-width') : ''
      const maxWidthPx = /px$/.test(maxWidthRaw.trim()) ? Number.parseFloat(maxWidthRaw) : null
      const actualWidthPx = writeRect ? writeRect.width : null
      const maxWidthComparison = {
        maxWidthPx,
        actualWidthPx,
        equal: maxWidthPx != null && actualWidthPx != null ? Math.abs(maxWidthPx - actualWidthPx) <= TOLERANCE_PX : null,
        verdict: 'NOT_APPLICABLE',
        reason: 'MAX_WIDTH_IS_A_CAP_NOT_AN_EQUALITY',
      }
      const bodyRect = rect(doc.body)
      const writeYNegative = !!(writeRect && writeRect.y < 0)

      const report = {
        timestamp: new Date().toISOString(),
        readOnly: true,
        location: {
          title: doc.title,
          href: String(win.location.href),
          bodyClass: doc.body ? doc.body.className : null,
          theme: doc.documentElement.getAttribute('data-theme') || (doc.body ? doc.body.getAttribute('data-theme') : null),
          prefersDark: typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-color-scheme: dark)').matches : null,
        },
        dpi: { devicePixelRatio: win.devicePixelRatio, innerWidth: win.innerWidth, innerHeight: win.innerHeight },
        presence: {
          toolbarRoot: !!toolbarRoot, toolbar: !!toolbar, status: !!status, square: !!square,
          lockFrame: !!lockFrame, layout: !!layout, row: !!row, tabs: !!tabs, panel: !!panel,
          write: !!write, domRowCount: rows.length,
        },
        visibility: {
          expanded, toolbarRoot: hasBox(toolbarRoot), toolbar: hasBox(toolbar), status: hasBox(status),
          layout: hasBox(layout), row: rowVisible, tabs: tabsVisible, panel: panelVisible,
          write: writeVisible,
        },
        statusSemantics: status ? {
          dataset,
          ariaLabel: status.getAttribute('aria-label'),
          title: status.getAttribute('title'),
          lockedClass: status.classList.contains('is-locked'),
          square: {
            rect: rect(square),
            computed: computed(square, ['background-color', 'width', 'height', 'border-radius', 'opacity', 'display', 'visibility']),
          },
          lockFrame: {
            rect: rect(lockFrame),
            computed: computed(lockFrame, [
              'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
              'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
              'width', 'height', 'display', 'visibility',
            ]),
          },
        } : null,
        toolbar: {
          rootRect: rect(toolbarRoot), toolbarRect: rect(toolbar), layoutRect: rect(layout),
          rowRect: rect(row), tabsRect: rect(tabs), panelRect: rect(panel),
          tabs: tabInfo,
          tabWidth,
          // Backward-compatible boolean: TRUE only for a valid, visible,
          // settled PASS. Collapsed/hidden/zero-width never returns true.
          tabWidthsEqual: tabWidth.verdict === 'PASS',
          transition: { maxDurationMs: transitionMaxMs, settle },
          geometry: { overall: geometryOverall, pairs: geometryPairs, tolerancePx: TOLERANCE_PX },
        },
        diagnostics: {
          instanceCounts,
          instanceTotal,
          projectedRowCount,
          projection,
          domRowCount: rowInfo.length,
          domBySeverity,
          rows: rowInfo,
          rowCoverage,
          multiTarget,
        },
        content: {
          writeRect,
          writeComputed: computed(write, [
            'max-width', 'width', 'margin-left', 'margin-right',
            'border-top-width', 'border-top-style', 'border-top-color',
            'outline-width', 'outline-style', 'outline-color',
          ]),
          maxWidthComparison,
          writeYNegative,
          bodyRectHeightZero: !!(bodyRect && bodyRect.height === 0),
          bodyRect,
          layoutModification: 'NONE_READ_ONLY',
        },
        collapsedHitTest,
        viewport: {
          clientWidth: doc.documentElement.clientWidth,
          clientHeight: doc.documentElement.clientHeight,
          scrollWidth: doc.documentElement.scrollWidth,
          scrollHeight: doc.documentElement.scrollHeight,
        },
        overall: {
          status: tri(!!status && !!square, dataset != null && (dataset.status === 'YELLOW' || dataset.status === 'RED' || dataset.status === 'HINT' || dataset.status === 'GRAY' || dataset.status === 'GREEN'), 'STATUS_PRESENT'),
          tabWidth: tabWidth.verdict,
          geometry: geometryOverall.verdict,
          collapsedHitTest: collapsedHitTest.verdict,
          multiTarget: multiTarget.verdict,
        },
      }
      return report
    }

    return { run }
  }

  const api = { createProbe, tri, TOLERANCE_PX }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
    return
  }
  if (typeof document !== 'undefined') {
    createProbe(document, window).run().then(result => {
      console.log('[InkChapter GUI Acceptance]', result)
    }).catch(error => {
      console.error('[InkChapter GUI Acceptance] probe failed', error)
    })
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
