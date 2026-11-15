/**
 * R08 — Object numbering (figure / table / code / formula) unified adapter.
 *
 * The caption service keeps owning detection, DOM rendering and its own
 * settings. This module adds ONLY the bridge the persistence/export layer needs:
 * it reads the SAME committed heading snapshot the body uses, derives the
 * chapter prefix for an object, and formats caption text for export.
 *
 * Guarantees:
 *   - the chapter prefix comes from the semantic heading result, so a heading
 *     renumber can never leave "第 2 章 … 图 1-3" behind;
 *   - a code caption is returned separately from the fence (never inside it);
 *   - formulas get an export-only `\tag{…}` — normal number text is never
 *     concatenated into LaTeX content.
 */

import type { HeadingNumberingSnapshot } from './heading-numbering-snapshot'
import { formatToken } from './token-formatter'

export type NumberedObjectKind = 'figure' | 'table' | 'code' | 'formula'

export type ObjectNumberSeparator = 'dash' | 'dot'

export interface ObjectNumberingScope {
  chapterOrdinal: number | null
  sectionOrdinal: number | null
}

export interface ObjectNumberText {
  kind: NumberedObjectKind
  /** Full number text, e.g. `2-1`. */
  numberText: string
  /** Chinese prefix used by captions, e.g. `图`. */
  prefix: string
}

const OBJECT_PREFIXES: Readonly<Record<NumberedObjectKind, string>> = {
  figure: '图',
  table: '表',
  code: '代码',
  formula: '式',
}

/**
 * Resolve the chapter/section scope of the heading that owns an object.
 * Unknown identity → no chapter prefix (`null`), never a fabricated `0`.
 */
export function resolveObjectNumberingScope(
  snapshot: HeadingNumberingSnapshot | null,
  headingIdentity: string | null | undefined,
): ObjectNumberingScope {
  if (!snapshot || !headingIdentity) return { chapterOrdinal: null, sectionOrdinal: null }
  const state = snapshot.semantic.find(s => s.stableIdentity === headingIdentity)
  if (!state) return { chapterOrdinal: null, sectionOrdinal: null }
  return {
    chapterOrdinal: state.chapterOrdinal ?? state.ordinalByDepth[0] ?? null,
    sectionOrdinal: state.sectionOrdinal ?? state.ordinalByDepth[1] ?? null,
  }
}

/** Format the object number from the unified heading result. */
export function formatObjectNumberText(
  kind: NumberedObjectKind,
  sequence: number,
  scope: ObjectNumberingScope,
  separator: ObjectNumberSeparator = 'dash',
): ObjectNumberText {
  const chapter = scope.chapterOrdinal
  const sep = separator === 'dot' ? '.' : '-'
  const numberText = chapter != null && chapter > 0
    ? `${formatToken(chapter, 'arabic')}${sep}${sequence}`
    : String(sequence)
  return { kind, numberText, prefix: OBJECT_PREFIXES[kind] }
}

export type ObjectCaptionPlacement = 'above' | 'below' | 'outside-fence' | 'formula-tag'

export interface ObjectCaptionExport {
  /** Caption line WITHOUT surrounding blank lines. */
  caption: string
  placement: ObjectCaptionPlacement
}

/**
 * Build the caption content for an export copy.
 *
 * Tables: caption goes ABOVE the table (project convention).
 * Figures / code: caption goes BELOW / OUTSIDE the fenced block.
 * Formulas: an export-only tag (Word/LaTeX), never inline number text.
 */
export function buildObjectCaptionExport(
  number: ObjectNumberText,
  caption: string,
  options: { placement?: ObjectCaptionPlacement } = {},
): ObjectCaptionExport {
  const cleanCaption = caption.trim()
  if (number.kind === 'formula') {
    return {
      caption: `\\tag{${number.numberText}}`,
      placement: 'formula-tag',
    }
  }
  const text = cleanCaption === ''
    ? `${number.prefix} ${number.numberText}`
    : `${number.prefix} ${number.numberText} ${cleanCaption}`
  const placement = options.placement
    ?? (number.kind === 'table' ? 'above' : number.kind === 'code' ? 'outside-fence' : 'below')
  return { caption: text, placement }
}

/**
 * Insert a caption line into Markdown for export WITHOUT touching the original.
 * `fencedBlockEndLine` is the 1-based line of the closing fence for code blocks.
 */
export function insertObjectCaptionForExport(
  markdown: string,
  exportLine: ObjectCaptionExport,
  line: number,
): string {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(/\r\n|\n/)
  const index = line <= 0 ? lines.length : Math.min(line, lines.length)
  lines.splice(index, 0, exportLine.caption, '')
  return lines.join(eol)
}
