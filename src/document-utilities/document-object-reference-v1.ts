/**
 * InkChapter structured object reference — parser only.
 *
 * Product decision (2026-11-11): a structured reference uses a normal Markdown
 * link with the plugin-reserved fragment:
 *
 *   [图 1-1](<other.md#inkchapter-ref:figure:cap_ab12>)
 *   [表 2-3](#inkchapter-ref:table:cap_cd34)
 *
 * The permanent identity is the CaptionRegistry `captionId` (`cap_*`), never a
 * display number. This module only parses/validates the fragment; it does NOT
 * rewrite Markdown, resolve captions, or emit diagnostics yet. Those steps wait
 * for the approved caption persistence/provider.
 */
export type ObjectReferenceKind = 'figure' | 'table' | 'formula'

export interface ObjectReference {
  kind: ObjectReferenceKind
  captionId: string
  /** Original fragment without the leading `#`. */
  fragment: string
}

export type ObjectReferenceParseFailure =
  | 'NOT_OBJECT_REFERENCE'
  | 'INVALID_KIND'
  | 'INVALID_ID'
  | 'DISPLAY_NUMBER_NOT_IDENTITY'

export type ObjectReferenceParseResult =
  | { ok: true; reference: ObjectReference }
  | { ok: false; reason: ObjectReferenceParseFailure }

const PREFIX = 'inkchapter-ref:'
const KINDS: readonly ObjectReferenceKind[] = ['figure', 'table', 'formula']
const CAPTION_ID_RE = /^cap_[A-Za-z0-9_-]+$/

function safeDecode(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

export function parseObjectReference(destination: string | null | undefined): ObjectReferenceParseResult {
  const raw = String(destination ?? '').trim()
  const hash = raw.indexOf('#')
  if (hash < 0 || hash === raw.length - 1) return { ok: false, reason: 'NOT_OBJECT_REFERENCE' }
  const fragment = safeDecode(raw.slice(hash + 1))
  if (!fragment.startsWith(PREFIX)) return { ok: false, reason: 'NOT_OBJECT_REFERENCE' }
  const body = fragment.slice(PREFIX.length)
  const parts = body.split(':')
  if (parts.length !== 2) return { ok: false, reason: 'INVALID_ID' }
  const [kindRaw, captionId] = parts
  if (!KINDS.includes(kindRaw as ObjectReferenceKind)) return { ok: false, reason: 'INVALID_KIND' }
  if (!CAPTION_ID_RE.test(captionId)) {
    return { ok: false, reason: /^\d+$/.test(captionId) ? 'DISPLAY_NUMBER_NOT_IDENTITY' : 'INVALID_ID' }
  }
  return {
    ok: true,
    reference: { kind: kindRaw as ObjectReferenceKind, captionId, fragment },
  }
}

export function buildObjectReferenceFragment(kind: ObjectReferenceKind, captionId: string): string | null {
  if (!KINDS.includes(kind) || !CAPTION_ID_RE.test(captionId)) return null
  return `${PREFIX}${kind}:${captionId}`
}

/** True when a destination carries the reserved prefix (valid or not). */
export function isObjectReferenceDestination(destination: string | null | undefined): boolean {
  const raw = String(destination ?? '')
  const hash = raw.indexOf('#')
  return hash >= 0 && safeDecode(raw.slice(hash + 1)).startsWith(PREFIX)
}
