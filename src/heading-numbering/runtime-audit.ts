/**
 * Runtime Audit — development-mode diagnostic recorder.
 *
 * PURPOSE: Trace heading numbering and outline sync at runtime without
 * changing business logic. Used for forensics to locate exactly where
 * H2 numbering is lost and why outline sync is delayed.
 *
 * All logging is gated by AUDIT_ENABLED flag (set from main.ts).
 * Records are capped at MAX_EVENTS to prevent memory bloat.
 */

// ── Types ─────────────────────────────────────────

export interface RuntimeAuditEvent {
  seq: number
  time: number          // performance.now()
  isoTime: string
  event: string
  documentKey?: string
  renderVersion?: number
  refreshReason?: string
  headingCount?: number
  h1Count?: number
  h2Count?: number
  h3Count?: number
  h4Count?: number
  h5Count?: number
  h6Count?: number
  labelCount?: number
  outlineRootExists?: boolean
  outlineVisible?: boolean
  outlineItemCount?: number
  matchedCount?: number
  appliedCount?: number
  outlineCacheHit?: boolean
  matchMethods?: string   // e.g. "5id+4idx"
  details?: Record<string, unknown>
}

export interface HeadingCollectEntry {
  index: number
  key: string
  tagName: string
  parsedLevel: number
  textPreview: string        // first 40 chars
  id?: string
  dataLine?: string
  isConnected: boolean
}

export interface NumberingEngineEntry {
  headingIndex: number
  actualLevel: number
  styleLevelUsed: number
  styleEnabled: boolean
  visibleDepth: number | null
  enabledLevels: number[]
  activeCounters: number[]
  selectedVariant: string       // 'withLevelOne' | 'withoutLevelOne' | 'fallback-derived'
  variantSegmentCount: number
  generatedLabel: string
  textPreview: string
}

export interface ApplyDiffEntry {
  domIndex: number
  domKey: string
  tagName: string
  parsedLevel: number
  textPreview: string
  labelIndex: number
  incomingLabel: string
  previousAttr: string | null
  action: 'insert' | 'update' | 'remove' | 'skip-same' | 'skip-empty'
  nextAttr: string | null
}

// ── Global state ─────────────────────────────────

export let AUDIT_ENABLED = false
const MAX_EVENTS = 2000
const events: RuntimeAuditEvent[] = []
let seqCounter = 0

// ── Public API ───────────────────────────────────

export function enableRuntimeAudit(): void {
  AUDIT_ENABLED = true
  console.info('[InkChapter Audit] enabled')
}

export function recordRuntimeAudit(event: string, payload?: Partial<RuntimeAuditEvent> & Record<string, unknown>): void {
  if (!AUDIT_ENABLED) return
  if (events.length >= MAX_EVENTS) {
    events.splice(0, 100) // trim oldest
  }
  events.push({
    seq: ++seqCounter,
    time: performance.now(),
    isoTime: new Date().toISOString(),
    event,
    ...payload,
  })
}

export function clearRuntimeAudit(): void {
  events.length = 0
  seqCounter = 0
  console.info('[InkChapter Audit] cleared')
}

export function getAuditEvents(): readonly RuntimeAuditEvent[] {
  return events
}

export function getAuditEventsJSON(): string {
  return JSON.stringify(events, null, 2)
}

export function copyAuditEventsToClipboard(): void {
  const json = getAuditEventsJSON()
  try {
    navigator.clipboard.writeText(json).then(
      () => console.info('[InkChapter Audit] copied', events.length, 'events'),
      () => console.warn('[InkChapter Audit] clipboard write failed, logging to console')
    )
  } catch {
    // Fallback: log JSON to console
    console.log('[InkChapter Audit]', json)
  }
}

// ── Structured snapshot helpers ──────────────────

export function snapshotHeadingCollection(headings: Array<{ key: string; level: number; text: string }>): void {
  if (!AUDIT_ENABLED) return
  const entries: HeadingCollectEntry[] = headings.map((h, i) => ({
    index: i,
    key: h.key,
    tagName: `H${h.level}`,
    parsedLevel: h.level,
    textPreview: h.text.slice(0, 40),
    isConnected: true,
  }))
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
  for (const h of headings) counts[h.level as keyof typeof counts]++
  recordRuntimeAudit('headings:collected', {
    headingCount: headings.length,
    h1Count: counts[1], h2Count: counts[2], h3Count: counts[3],
    h4Count: counts[4], h5Count: counts[5], h6Count: counts[6],
    details: { first: entries.slice(0, 20) },
  })
}

export function snapshotNumberingEngine(
  settings: { showLevelOneNumber?: boolean; preset?: string; maxDepth?: number; levels: Record<number, { enabled: boolean }> },
  engineEntries: NumberingEngineEntry[],
): void {
  if (!AUDIT_ENABLED) return
  const levelCfgs: Record<number, { enabled: boolean }> = {}
  for (let lv = 1; lv <= 6; lv++) {
    const s = settings.levels[lv]
    levelCfgs[lv] = { enabled: s?.enabled ?? false }
  }
  recordRuntimeAudit('numbering:engine-input', {
    details: {
      showLevelOneNumber: settings.showLevelOneNumber,
      preset: settings.preset,
      maxDepth: settings.maxDepth,
      levels: levelCfgs,
    },
  })
  recordRuntimeAudit('numbering:engine-output', {
    labelCount: engineEntries.length,
    details: { entries: engineEntries },
  })
}

export function snapshotApplyDiff(
  labels: readonly string[],
  diffEntries: ApplyDiffEntry[],
  labelCount: number,
  domCount: number,
): void {
  if (!AUDIT_ENABLED) return
  recordRuntimeAudit('diff:results', {
    labelCount,
    details: {
      domCount,
      countMatch: labelCount === domCount,
      entries: diffEntries,
    },
  })
}

export function snapshotConfigSource(
  source: string,
  data: Record<string, unknown>,
): void {
  if (!AUDIT_ENABLED) return
  recordRuntimeAudit(`config:${source}`, { details: data })
}

export function snapshotOutlineDOM(
  data: {
    rootFound: boolean
    rootSelector?: string | null
    rootTag?: string
    rootId?: string
    rootClass?: string
    itemCount?: number
    matchDetails?: Array<{
      olIdx: number
      olText: string
      olHref?: string
      bodyIdx: number | null
      bodyLevel?: number
      label?: string
      method: string
    }>
  },
): void {
  if (!AUDIT_ENABLED) return
  recordRuntimeAudit('outline:dom-snapshot', { details: data })
}

export function snapshotOutlineTabButton(
  data: {
    tagName: string
    id: string
    className: string
    dataAction: string | null
    dataType: string | null
    outerHTMLPreview: string
  },
): void {
  if (!AUDIT_ENABLED) return
  recordRuntimeAudit('outline:tab-button', { details: data })
}

export function snapshotH2DOM(entries: Array<Record<string, unknown>>): void {
  if (!AUDIT_ENABLED) return
  recordRuntimeAudit('dom:h2-state', { details: { entries } })
}
