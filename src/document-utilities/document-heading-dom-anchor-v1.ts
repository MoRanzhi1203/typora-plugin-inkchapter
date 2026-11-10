/**
 * Typora DOM heading-anchor authority.
 *
 * Typora generates the REAL heading `id` in the rendered `#write` DOM. That id
 * is the only anchor authority we accept for cross-file/fragment links; no
 * GitHub slug or text-derived fallback is allowed here.
 *
 * `UNKNOWN` is returned whenever the DOM cannot be trusted (missing root,
 * duplicate ids, detached root). An empty heading list is only returned when
 * the root is connected and genuinely has no heading elements.
 */
export interface DomHeadingAnchorResult {
  state: 'READY' | 'UNKNOWN'
  anchors: readonly string[]
  /** Duplicate ids make the whole authority ambiguous → UNKNOWN. */
  duplicateAnchors: readonly string[]
  reason: 'READY' | 'ROOT_MISSING' | 'ROOT_DETACHED' | 'DUPLICATE_ID'
}

const HEADING_SELECTOR = 'h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'

export function readDomHeadingAnchors(root: ParentNode | null | undefined): DomHeadingAnchorResult {
  if (!root || !(root instanceof Element)) {
    return { state: 'UNKNOWN', anchors: [], duplicateAnchors: [], reason: 'ROOT_MISSING' }
  }
  if (!root.isConnected) {
    return { state: 'UNKNOWN', anchors: [], duplicateAnchors: [], reason: 'ROOT_DETACHED' }
  }
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  const anchors: string[] = []
  for (const heading of Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR))) {
    const id = heading.getAttribute('id') ?? ''
    if (id === '') continue
    if (seen.has(id)) {
      duplicated.add(id)
      continue
    }
    seen.add(id)
    anchors.push(id)
  }
  if (duplicated.size > 0) {
    return {
      state: 'UNKNOWN',
      anchors: [],
      duplicateAnchors: [...duplicated].sort(),
      reason: 'DUPLICATE_ID',
    }
  }
  return { state: 'READY', anchors, duplicateAnchors: [], reason: 'READY' }
}

/** True when this DOM root belongs to the same absolute file path. */
export function isSameDocumentPath(activeFilePath: string | null, targetFilePath: string): boolean {
  if (!activeFilePath || !targetFilePath) return false
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
  return norm(activeFilePath) === norm(targetFilePath)
}
