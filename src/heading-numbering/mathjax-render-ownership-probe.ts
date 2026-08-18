/**
 * v2.5.7-R5.2: MathJax Render Ownership Authority Probe.
 *
 * READ-ONLY probe that determines whether Typora's visible formula output
 * is owned by MathJax.startup.document's MathItem registry, and classifies
 * the ownership relationship into CASE A/B/C/D/E.
 *
 * No destructive MathJax API calls (typesetClear, typesetPromise, etc.).
 * No DOM mutation. One-shot execution only.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

const R52_MARKER = 'FORMULA-MATHJAX-RENDER-OWNERSHIP-V2.5.7-R5.2'

// ── Types ───────────────────────────────────────────────────────────────

export type OwnershipCase = 'A' | 'B' | 'C' | 'D' | 'E'

export interface MathJaxRenderOwnershipResult {
  ownershipCase: OwnershipCase
  classification: string
  details: {
    mathJaxExists: boolean
    startupExists: boolean
    startupDocumentExists: boolean
    getMathItemsWithinCallable: boolean
    registryReadable: boolean
    registryIterable: boolean
    registryItemCount: number
    bodyMathItemCount: number
    editorRootMathItemCount: number
    formula0HostMathItemCount: number
    formula1HostMathItemCount: number
    formula0VisibleMjxCount: number
    formula1VisibleMjxCount: number
    formula0OwnershipCandidateCount: number
    formula1OwnershipCandidateCount: number
    startupDocumentOwnsFormula0: boolean
    startupDocumentOwnsFormula1: boolean
  }
}

// ── Probe Helpers ───────────────────────────────────────────────────────

function getMathJax(): any {
  return typeof window !== 'undefined' ? (window as any).MathJax : null
}

function safeGetMathItemsWithin(doc: any, el: HTMLElement): number {
  try {
    const items = doc.getMathItemsWithin(el)
    return Array.isArray(items) ? items.length : (items?.length ?? 0)
  } catch {
    return -1
  }
}

function safeIterateRegistry(doc: any): Array<{ mathItem: any; ordinal: number }> {
  const result: Array<{ mathItem: any; ordinal: number }> = []
  try {
    const registry = doc.math
    if (!registry) return result

    // Try standard iteration: Array, List, or Iterable.
    const items: any[] = []
    if (Array.isArray(registry)) {
      items.push(...registry)
    } else if (typeof registry[Symbol.iterator] === 'function') {
      for (const item of registry) {
        items.push(item)
      }
    } else if (typeof registry.forEach === 'function') {
      registry.forEach((item: any) => items.push(item))
    } else {
      // Unknown type — try length-based access.
      const len = (registry as any).length
      if (typeof len === 'number' && len >= 0) {
        for (let i = 0; i < len; i++) {
          items.push(registry[i])
        }
      }
    }

    for (let i = 0; i < items.length; i++) {
      result.push({ mathItem: items[i], ordinal: i })
    }
  } catch {
    // Registry not iterable
  }
  return result
}

function safeNodeName(node: any): string {
  return node?.nodeName ?? 'null'
}

function safeNodeType(node: any): number {
  return node?.nodeType ?? -1
}

function isConnected(node: any): boolean {
  try {
    return node?.isConnected ?? false
  } catch {
    return false
  }
}

function containsFormulaHost(el: Node | null, host: HTMLElement): boolean {
  if (!el) return false
  if (el === host) return true
  try {
    return host.contains(el) || el.contains(host)
  } catch {
    return false
  }
}

function simpleHash(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash.toString(16)
}

// ── Main Probe ──────────────────────────────────────────────────────────

export function executeMathJaxRenderOwnershipProbe(
  formula0Host: HTMLElement | null,
  formula1Host: HTMLElement | null,
  editorRoot: HTMLElement | null,
  documentKey: string,
  documentGeneration: number,
): MathJaxRenderOwnershipResult {
  const mj = getMathJax()

  // ── Phase A: API Authority ──
  const mathJaxExists = !!mj
  const startupExists = !!mj?.startup
  const startupDocumentExists = !!mj?.startup?.document
  const getMathItemsWithinCallable = typeof mj?.startup?.document?.getMathItemsWithin === 'function'
  const doc = startupDocumentExists ? mj.startup.document : null

  emitRuntimeAudit('MATHJAX-RENDER-OWNERSHIP-API-AUTHORITY', {
    mathJaxExists,
    startupExists,
    startupDocumentExists,
    getMathItemsWithinCallable,
    startupDocumentMathReadable: !!doc?.math,
    startupDocumentMathIterable: typeof doc?.math?.[Symbol.iterator] === 'function' || Array.isArray(doc?.math) || typeof doc?.math?.forEach === 'function',
    startupDocumentMathLengthReadable: typeof doc?.math?.length === 'number',
    bodyAvailable: !!document.body,
    editorRootAvailable: !!editorRoot,
    decision: mathJaxExists && startupExists && startupDocumentExists && getMathItemsWithinCallable ? 'PASS' : 'FAIL',
    reason: null,
    runtimeMarker: R52_MARKER,
  })

  const apiPass = mathJaxExists && startupExists && startupDocumentExists && getMathItemsWithinCallable

  // ── Phase B: Registry Scope Probe ──
  const bodyMathItemCount = doc && document.body ? safeGetMathItemsWithin(doc, document.body) : -1
  const editorRootMathItemCount = doc && editorRoot ? safeGetMathItemsWithin(doc, editorRoot) : -1
  const formula0HostMathItemCount = doc && formula0Host ? safeGetMathItemsWithin(doc, formula0Host) : -1
  const formula1HostMathItemCount = doc && formula1Host ? safeGetMathItemsWithin(doc, formula1Host) : -1

  emitRuntimeAudit('MATHJAX-REGISTRY-SCOPE-PROBE', {
    documentBodyMathItemCount: bodyMathItemCount,
    editorRootMathItemCount,
    formula0HostMathItemCount,
    formula1HostMathItemCount,
    documentBodyConnected: document.body?.isConnected ?? false,
    editorRootConnected: editorRoot?.isConnected ?? false,
    formula0HostConnected: formula0Host?.isConnected ?? false,
    formula1HostConnected: formula1Host?.isConnected ?? false,
    decision: 'PASS',
    runtimeMarker: R52_MARKER,
  })

  // ── Phase C: startup.document MathItem Inventory ──
  const registryItems = doc && apiPass ? safeIterateRegistry(doc) : []
  const registryItemCount = registryItems.length
  let inspectionErrorCount = 0

  emitRuntimeAudit('MATHJAX-STARTUP-DOCUMENT-MATH-INVENTORY', {
    registryReadable: !!doc?.math,
    registryIterable: registryItems.length > 0 || (doc?.math && typeof doc.math.length === 'number' && doc.math.length === 0),
    registryItemCount,
    itemInspectionCount: registryItems.length,
    inspectionErrorCount,
    decision: 'PASS',
    reason: null,
    runtimeMarker: R52_MARKER,
  })

  // ── Phase E: Render Route Surface ──
  const renderRoute: Record<string, boolean> = {
    tex2svg: typeof mj?.tex2svg === 'function',
    tex2svgPromise: typeof mj?.tex2svgPromise === 'function',
    tex2chtml: typeof mj?.tex2chtml === 'function',
    tex2chtmlPromise: typeof mj?.tex2chtmlPromise === 'function',
    typeset: typeof mj?.typeset === 'function',
    typesetPromise: typeof mj?.typesetPromise === 'function',
    typesetClear: typeof mj?.typesetClear === 'function',
    startupDocumentRender: typeof doc?.render === 'function',
    startupDocumentRerender: typeof doc?.rerender === 'function',
    startupDocumentConvert: typeof doc?.convert === 'function',
  }

  emitRuntimeAudit('MATHJAX-RENDER-ROUTE-SURFACE', {
    ...renderRoute,
    runtimeMarker: R52_MARKER,
  })

  // ── Phase C (cont): MathItem Ownership Entries ──
  let formula0OwnershipCandidateCount = 0
  let formula1OwnershipCandidateCount = 0
  let formula0StartCount = 0
  let formula1StartCount = 0
  let formula0EndCount = 0
  let formula1EndCount = 0
  let formula0TypesetRootCount = 0
  let formula1TypesetRootCount = 0

  for (const entry of registryItems) {
    const mi = entry.mathItem
    const start = mi.start?.node ?? null
    const end = mi.end?.node ?? null
    const typesetRoot = mi.typesetRoot ?? null
    const inputTex = String(mi.math ?? mi.input ?? '')
    const inputHash = simpleHash(inputTex)
    const inputLength = inputTex.length
    const inputPrefix = inputTex.slice(0, 80)

    const startInF0 = formula0Host && start ? containsFormulaHost(start, formula0Host) : false
    const startInF1 = formula1Host && start ? containsFormulaHost(start, formula1Host) : false
    const endInF0 = formula0Host && end ? containsFormulaHost(end, formula0Host) : false
    const endInF1 = formula1Host && end ? containsFormulaHost(end, formula1Host) : false
    const trInF0 = formula0Host && typesetRoot ? containsFormulaHost(typesetRoot, formula0Host) : false
    const trInF1 = formula1Host && typesetRoot ? containsFormulaHost(typesetRoot, formula1Host) : false

    if (startInF0 || endInF0 || trInF0) formula0OwnershipCandidateCount++
    if (startInF1 || endInF1 || trInF1) formula1OwnershipCandidateCount++
    if (startInF0) formula0StartCount++
    if (startInF1) formula1StartCount++
    if (endInF0) formula0EndCount++
    if (endInF1) formula1EndCount++
    if (trInF0) formula0TypesetRootCount++
    if (trInF1) formula1TypesetRootCount++

    emitRuntimeAudit('MATHJAX-MATHITEM-OWNERSHIP-ENTRY', {
      mathItemOrdinal: entry.ordinal,
      inputHash,
      inputLength,
      inputPrefix,
      display: mi.display ?? 'unknown',
      startNodeType: safeNodeType(start),
      startNodeName: safeNodeName(start),
      startNodeConnected: isConnected(start),
      endNodeType: safeNodeType(end),
      endNodeName: safeNodeName(end),
      endNodeConnected: isConnected(end),
      typesetRootAvailable: !!typesetRoot,
      typesetRootNodeName: safeNodeName(typesetRoot),
      typesetRootConnected: isConnected(typesetRoot),
      typesetRootParentNodeName: safeNodeName(typesetRoot?.parentElement ?? null),
      insideDocumentBody: start ? document.body?.contains(start) : false,
      insideEditorRoot: editorRoot && start ? editorRoot.contains(start) : false,
      startInsideFormula0: startInF0,
      startInsideFormula1: startInF1,
      endInsideFormula0: endInF0,
      endInsideFormula1: endInF1,
      typesetRootInsideFormula0: trInF0,
      typesetRootInsideFormula1: trInF1,
      formula0ContainsStart: startInF0,
      formula1ContainsStart: startInF1,
      decision: 'RECORDED',
      runtimeMarker: R52_MARKER,
    })
  }

  // ── Phase D: Visible Output Ownership ──
  const f0VisibleMjx = formula0Host ? formula0Host.querySelectorAll('mjx-container').length : 0
  const f1VisibleMjx = formula1Host ? formula1Host.querySelectorAll('mjx-container').length : 0

  for (const [fi, host, visibleCount] of [[0, formula0Host, f0VisibleMjx], [1, formula1Host, f1VisibleMjx]] as const) {
    if (!host) continue
    const mjxAll = host.querySelectorAll('mjx-container').length
    const svgCount = host.querySelectorAll('svg').length
    const chtmlCount = 0

    // Visible tag candidates (text matching number-like pattern)
    const tagCandidates: string[] = []
    for (const el of host.querySelectorAll<HTMLElement>('span, div')) {
      if (el.querySelector('mjx-container, svg, math')) continue
      const text = (el.textContent ?? '').trim()
      if (/^\(\s*\d+(?:[.\-/]\d+)*\s*\)$/.test(text)) tagCandidates.push(text)
    }

    emitRuntimeAudit('MATHJAX-VISIBLE-OUTPUT-OWNERSHIP', {
      formulaIndex: fi,
      formulaHostToken: 0,
      mjxContainerCount: mjxAll,
      visibleMjxContainerCount: visibleCount,
      svgCount,
      chtmlCount,
      visibleMathOutputCount: visibleCount >= 1 ? 1 : 0,
      visibleTagCandidateCount: tagCandidates.length,
      visibleTagTexts: tagCandidates.join(', '),
      startupDocumentMathItemCountForHost: fi === 0 ? formula0HostMathItemCount : formula1HostMathItemCount,
      startupDocumentMathItemByStartCount: fi === 0 ? formula0StartCount : formula1StartCount,
      startupDocumentMathItemByEndCount: fi === 0 ? formula0EndCount : formula1EndCount,
      startupDocumentMathItemByTypesetRootCount: fi === 0 ? formula0TypesetRootCount : formula1TypesetRootCount,
      ownershipCandidateCount: fi === 0 ? formula0OwnershipCandidateCount : formula1OwnershipCandidateCount,
      decision: 'PASS',
      reason: null,
      runtimeMarker: R52_MARKER,
    })
  }

  // ── Phase F: DOM Ownership ──
  for (const [fi, host] of [[0, formula0Host], [1, formula1Host]] as const) {
    if (!host) continue
    const allMjx = host.querySelectorAll('mjx-container')
    const firstMjx = allMjx[0] as HTMLElement | undefined
    const firstMjxText = firstMjx?.textContent ?? ''
    const hasNumberLike = /^\(\s*\d/.test(firstMjxText.trim())

    emitRuntimeAudit('MATHJAX-FORMULA-HOST-DOM-OWNERSHIP', {
      formulaIndex: fi,
      formulaHostToken: 0,
      hostTag: host.tagName,
      hostId: host.id || '',
      hostClass: typeof host.className === 'string' ? host.className : '',
      hostConnected: host.isConnected,
      directMjxContainerCount: host.children.length > 0 ? Array.from(host.children).filter((c) => c.tagName === 'MJX-CONTAINER').length : 0,
      descendantMjxContainerCount: allMjx.length,
      visibleMjxContainerCount: allMjx.length,
      firstMjxContainerTag: firstMjx?.tagName ?? 'none',
      firstMjxContainerClass: firstMjx ? (typeof firstMjx.className === 'string' ? firstMjx.className : '') : '',
      firstMjxContainerConnected: firstMjx?.isConnected ?? false,
      firstMjxContainerTextHasNumberLike: hasNumberLike,
      decision: 'PASS',
      runtimeMarker: R52_MARKER,
    })
  }

  // ── Phase G: Differential ──
  emitRuntimeAudit('MATHJAX-GETMATHITEMSWITHIN-DIFFERENTIAL', {
    bodyCount: bodyMathItemCount,
    editorRootCount: editorRootMathItemCount,
    formula0HostCount: formula0HostMathItemCount,
    formula1HostCount: formula1HostMathItemCount,
    formula0DescendantTypesetRootMatchCount: formula0TypesetRootCount,
    formula1DescendantTypesetRootMatchCount: formula1TypesetRootCount,
    formula0StartContainmentMatchCount: formula0StartCount,
    formula1StartContainmentMatchCount: formula1StartCount,
    formula0EndContainmentMatchCount: formula0EndCount,
    formula1EndContainmentMatchCount: formula1EndCount,
    decision: 'PASS',
    reason: null,
    runtimeMarker: R52_MARKER,
  })

  // ── Phase I: Ownership Case Decision ──
  let ownershipCase: OwnershipCase
  let classification: string
  let startupDocumentOwnsFormula0: boolean
  let startupDocumentOwnsFormula1: boolean

  // CASE C: Unique MathItem exists for each formula.
  if (formula0Host && formula0OwnershipCandidateCount === 1 && formula1Host && formula1OwnershipCandidateCount === 1) {
    ownershipCase = 'C'
    classification = 'R5_PRECHECK_IMPLEMENTATION_BUG'
    startupDocumentOwnsFormula0 = true
    startupDocumentOwnsFormula1 = true
  }
  // CASE B: Registry exists, but host getMathItemsWithin=0, yet typesetRoot/start/end match.
  else if (registryItemCount > 0 && formula0HostMathItemCount === 0 && formula1HostMathItemCount === 0 && (formula0OwnershipCandidateCount > 0 || formula1OwnershipCandidateCount > 0)) {
    ownershipCase = 'B'
    classification = 'MATHITEM_CONTAINER_BOUNDARY_MISMATCH'
    startupDocumentOwnsFormula0 = formula0OwnershipCandidateCount > 0
    startupDocumentOwnsFormula1 = formula1OwnershipCandidateCount > 0
  }
  // CASE A: Registry empty, but visible mjx output exists.
  else if (registryItemCount === 0 && (f0VisibleMjx > 0 || f1VisibleMjx > 0)) {
    ownershipCase = 'A'
    classification = 'TYPOORA_VISIBLE_MATH_NOT_OWNED_BY_STARTUP_DOCUMENT_REGISTRY'
    startupDocumentOwnsFormula0 = false
    startupDocumentOwnsFormula1 = false
  }
  // CASE D: Registry exists but ownership ambiguous.
  else if (registryItemCount > 0) {
    ownershipCase = 'D'
    classification = 'STARTUP_DOCUMENT_MATHITEM_OWNERSHIP_AMBIGUOUS'
    startupDocumentOwnsFormula0 = formula0OwnershipCandidateCount > 0
    startupDocumentOwnsFormula1 = formula1OwnershipCandidateCount > 0
  }
  // CASE E: Registry not safely introspectable.
  else {
    ownershipCase = 'E'
    classification = 'MATHJAX_REGISTRY_INTROSPECTION_UNAVAILABLE'
    startupDocumentOwnsFormula0 = false
    startupDocumentOwnsFormula1 = false
  }

  const result: MathJaxRenderOwnershipResult = {
    ownershipCase,
    classification,
    details: {
      mathJaxExists,
      startupExists,
      startupDocumentExists,
      getMathItemsWithinCallable,
      registryReadable: !!doc?.math,
      registryIterable: registryItems.length > 0 || (doc?.math && typeof doc.math.length === 'number' && doc.math.length === 0),
      registryItemCount,
      bodyMathItemCount,
      editorRootMathItemCount,
      formula0HostMathItemCount,
      formula1HostMathItemCount,
      formula0VisibleMjxCount: f0VisibleMjx,
      formula1VisibleMjxCount: f1VisibleMjx,
      formula0OwnershipCandidateCount,
      formula1OwnershipCandidateCount,
      startupDocumentOwnsFormula0,
      startupDocumentOwnsFormula1,
    },
  }

  emitRuntimeAudit('MATHJAX-RENDER-OWNERSHIP-FINAL', {
    documentKey,
    documentGeneration,
    registryItemCount,
    bodyMathItemCount,
    editorRootMathItemCount,
    formula0HostMathItemCount,
    formula1HostMathItemCount,
    formula0VisibleMjxContainerCount: f0VisibleMjx,
    formula1VisibleMjxContainerCount: f1VisibleMjx,
    formula0OwnershipCandidateCount,
    formula1OwnershipCandidateCount,
    ownershipCase,
    classification,
    startupDocumentOwnsVisibleFormula0: startupDocumentOwnsFormula0,
    startupDocumentOwnsVisibleFormula1: startupDocumentOwnsFormula1,
    specificTyporaRenderRoute: 'NOT_DETERMINED',
    decision: 'PASS',
    reason: null,
    runtimeMarker: R52_MARKER,
  })

  return result
}