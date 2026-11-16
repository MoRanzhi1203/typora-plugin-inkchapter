/**
 * R10 — Object number persistence planner (figure / table / code / formula).
 *
 * ONE calculation feeds every surface. Chapter/section ordinals come from the
 * canonical SEMANTIC heading engine (`computeSemanticHeadingNumbers`) — the exact
 * authority the body/outline renderer consumes — so a heading renumber can never
 * leave `图 1-3` behind under chapter 2.
 *
 * The planner only ever writes the caption LINE (or the `\tag{…}` token for a
 * formula). It never touches the image URL, the table structure, the code fence
 * or the LaTeX body. Every rule is idempotent: computing the plan twice against
 * its own output produces zero edits.
 *
 * Pure contract: no DOM, no host state, no I/O.
 */

import type { HeadingNumberingSettings, UnnumberedCounterPolicy } from './heading-types'
import type { HeadingStructureMode, PhysicalHeading, SemanticHeadingNumberState } from './semantic-heading-types'
import { computeSemanticHeadingNumbers, resolveSemanticStartAt, resolvePhysicalStartAt, computePhysicalHeadingPaths } from './semantic-heading-numbering'
import { resolveHeadingStructure } from './heading-structure'
import { normalizeHeadingTitle, parseMarkdownHeadings, type SourceHeadingLine, type SourceOverrideEntry } from './heading-number-persistence'
import { canonicalNumberLabel, scanHeadingNumber } from './heading-number-source-scanner'
import { parseMarkdownImageTokens, type MarkdownImageToken } from './figure-token-locator'
import { resolveCaptionScope } from './caption-scope-resolver'
import { formatObjectNumber, presetToScopeStyle, type NumberingPreset } from './numbering-preset-formatter'
import { formatObjectNumberFromComponents, formatObjectScopeNumber, displayPrefixForPreset, resolveDisplayPrefixScope, resolveObjectNumberScope } from './object-scope-config'
import {
  buildObjectNumberingLabel,
  renderNumberTemplate,
  type ObjectNumberingConfig,
} from './object-numbering-engine'

// ── Public types ─────────────────────────────────────────

export type NumberedObjectKind = 'figure' | 'table' | 'code' | 'formula'

export type ObjectNumberStorageMode = 'render' | 'source' | 'export'

export type ObjectCaptionPolicy = 'adopt' | 'replace' | 'preserve' | 'detect-only'

export type ObjectNumberOwnership = 'inkchapter' | 'adopted' | 'user-preserved' | 'unresolved' | 'none'

export type ObjectNumberSyncTiming = 'manual' | 'edit' | 'save'

export interface ObjectNumberOwnershipRecord {
  identity: string
  kind: NumberedObjectKind
  ownership: ObjectNumberOwnership
  numberText: string
  title: string
  updatedAt: number
}

export interface ObjectNumberPersistenceSettings {
  storageMode: ObjectNumberStorageMode
  existingCaptionPolicy: ObjectCaptionPolicy
  syncTiming: ObjectNumberSyncTiming
  dedupeProjectedNumbers: boolean
}

export interface ObjectNumberingConfigs {
  figure: ObjectNumberingConfig
  table: ObjectNumberingConfig
  code: ObjectNumberingConfig
  formula: ObjectNumberingConfig
}

/** The snapshot consumed by the central diagnostics panel (PURE read). */
export interface ObjectNumberPersistenceFacts {
  enabled: boolean
  storageMode: ObjectNumberStorageMode
  policy: ObjectCaptionPolicy
  dedupeProjectedNumbers: boolean
  headingSettings: HeadingNumberingSettings
  overrideEntries: readonly SourceOverrideEntry[]
  counterPolicy: UnnumberedCounterPolicy
  configs: ObjectNumberingConfigs
  ownership: Record<string, ObjectNumberOwnershipRecord>
}

export interface CaptionCandidate {
  /** 1-based caption line. */
  line: number
  prefix: string
  numberText: string
  /** Caption name only (never includes prefix / number). */
  title: string
  raw: string
  placement: 'above' | 'below' | 'tag'
}

export interface ScannedNumberedObject {
  identity: string
  kind: NumberedObjectKind
  /** 0-based ordinal among same-kind objects in document order. */
  ordinal: number
  /** 1-based inclusive block range. */
  startLine: number
  endLine: number
  contentSignature: string
  /** 1-based line of the nearest preceding heading (null before the first). */
  headingLine: number | null
  caption: CaptionCandidate | null
  /** Extra adjacent captions for the SAME object (duplicate captions). */
  duplicateCaptions: CaptionCandidate[]
}

export interface ParsedNumberedObjects {
  objects: ScannedNumberedObject[]
  headings: SourceHeadingLine[]
  lineCount: number
  eol: string
}

// ── Object scanning ──────────────────────────────────────

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const TABLE_DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/

interface InternalObject {
  kind: NumberedObjectKind
  ordinal: number
  startLine: number
  endLine: number
  contentSignature: string
  /** Formula only: line that carries `\tag{…}`. */
  tagLine: number | null
}

function detectObjects(markdown: string): { objects: InternalObject[]; headings: SourceHeadingLine[]; lineCount: number; eol: string } {
  const parsed = parseMarkdownHeadings(markdown)
  const eol = parsed.eol
  const lines = markdown.split(/\r\n|\n/)
  const objects: InternalObject[] = []
  const ordinals: Record<NumberedObjectKind, number> = { figure: 0, table: 0, code: 0, formula: 0 }

  const push = (
    kind: NumberedObjectKind,
    startLine: number,
    endLine: number,
    contentSignature: string,
    tagLine: number | null = null,
  ): void => {
    objects.push({ kind, ordinal: ordinals[kind]++, startLine, endLine, contentSignature, tagLine })
  }

  let i = 0
  let inFrontMatter = false
  while (i < lines.length) {
    const raw = lines[i]

    if (i === 0 && raw.trim() === '---') {
      inFrontMatter = true
      i++
      continue
    }
    if (inFrontMatter) {
      if (raw.trim() === '---') inFrontMatter = false
      i++
      continue
    }

    // ── fenced code block ──────────────────────────────
    const fence = FENCE_OPEN.exec(raw)
    if (fence) {
      const marker = fence[1]
      const startLine = i + 1
      let j = i + 1
      while (j < lines.length) {
        const close = FENCE_OPEN.exec(lines[j])
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) break
        j++
      }
      const endLine = Math.min(j + 1, lines.length)
      const body = lines.slice(i + 1, j).join('\n')
      push('code', startLine, endLine, `code:${hashString(body)}`)
      i = j + 1
      continue
    }

    const trimmed = raw.trim()

    // ── display math (single-line and block) ───────────
    if (trimmed.startsWith('$$')) {
      if (trimmed.length > 4 && trimmed.endsWith('$$')) {
        const startLine = i + 1
        const body = trimmed.slice(2, -2)
        push('formula', startLine, startLine, `formula:${hashString(body)}`, findTagLine(lines, i, i))
        i++
        continue
      }
      if (trimmed === '$$') {
        const startLine = i + 1
        let j = i + 1
        while (j < lines.length && lines[j].trim() !== '$$') j++
        const endLine = Math.min(j + 1, lines.length)
        const body = lines.slice(i + 1, j).join('\n')
        push('formula', startLine, endLine, `formula:${hashString(body)}`, findTagLine(lines, i + 1, j - 1))
        i = j + 1
        continue
      }
    }

    // ── GFM table ──────────────────────────────────────
    if (i + 1 < lines.length && raw.includes('|') && TABLE_DELIMITER.test(lines[i + 1])) {
      const startLine = i + 1
      let j = i + 2
      while (j < lines.length && lines[j].trim() !== '' && lines[j].includes('|')) j++
      const endLine = j
      const body = lines.slice(i, j).join('\n')
      push('table', startLine, endLine, `table:${hashString(body)}`)
      i = j
      continue
    }

    // ── image-only paragraph ───────────────────────────
    if (trimmed !== '') {
      let j = i
      while (j < lines.length && lines[j].trim() !== '') j++
      const blockText = lines.slice(i, j).join('\n')
      const tokens = parseMarkdownImageTokens(blockText)
      if (tokens.length > 0 && stripImageTokens(blockText, tokens).trim() === '') {
        for (const token of tokens) {
          const lineOffset = countNewlines(blockText, token.start)
          const alt = token.altRaw
          const destination = token.destinationRaw
          push('figure', i + lineOffset + 1, i + lineOffset + 1, `figure:${hashString(`${alt}\u0000${destination}`)}`)
        }
        i = j
        continue
      }
      i = j
      continue
    }

    i++
  }

  return { objects, headings: parsed.headings, lineCount: lines.length, eol }
}

function stripImageTokens(text: string, tokens: readonly MarkdownImageToken[]): string {
  let out = ''
  let cursor = 0
  for (const token of tokens) {
    if (token.start < cursor) continue
    out += text.slice(cursor, token.start)
    cursor = token.end
  }
  out += text.slice(cursor)
  return out
}

function countNewlines(text: string, end: number): number {
  let count = 0
  for (let i = 0; i < end && i < text.length; i++) {
    if (text[i] === '\n') count++
  }
  return count
}

function findTagLine(lines: readonly string[], start: number, end: number): number | null {
  for (let i = start; i <= end && i < lines.length; i++) {
    if (/\\tag\{[^}]*\}/.test(lines[i])) return i + 1
  }
  return null
}

export function hashString(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

// ── Caption parsing ──────────────────────────────────────

const DEFAULT_PREFIX: Readonly<Record<NumberedObjectKind, string>> = {
  figure: '图',
  table: '表',
  code: '代码',
  formula: '式',
}

const NUMBER_TOKEN = '[0-9０-９][0-9A-Za-z０-９.\\-－]*'
const FORMULA_NUMBER_LINE = /^[（(]\s*([0-9][0-9.\-]*)\s*[）)]$/

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Parse a standalone caption paragraph for one object kind. */
export function parseCaptionLine(
  kind: NumberedObjectKind,
  raw: string,
  configuredPrefix?: string,
): { prefix: string; numberText: string; title: string } | null {
  const text = raw.trim()
  if (kind === 'formula') {
    const match = FORMULA_NUMBER_LINE.exec(text)
    if (!match) return null
    return { prefix: '', numberText: match[1], title: '' }
  }
  const prefixes = new Set<string>([DEFAULT_PREFIX[kind]])
  if (configuredPrefix != null && configuredPrefix.trim() !== '') prefixes.add(configuredPrefix.trim())
  for (const prefix of prefixes) {
    const regex = new RegExp(`^${escapeRegExp(prefix)}\\s*(${NUMBER_TOKEN})(?:\\s+(.*))?$`)
    const match = regex.exec(text)
    if (!match) continue
    return { prefix, numberText: match[1], title: (match[2] ?? '').trim() }
  }
  return null
}

function isStandaloneParagraph(lines: readonly string[], index: number): boolean {
  if (index < 0 || index >= lines.length) return false
  if (lines[index].trim() === '') return false
  const prevBlank = index === 0 || lines[index - 1].trim() === ''
  const nextBlank = index === lines.length - 1 || lines[index + 1].trim() === ''
  return prevBlank && nextBlank
}

function parseTagLine(raw: string): string | null {
  const match = /\\tag\{([^}]*)\}/.exec(raw)
  return match ? match[1].trim() : null
}

interface ObjectCaptionResolution {
  caption: CaptionCandidate | null
  duplicates: CaptionCandidate[]
}

/**
 * Resolve captions for ALL objects in one exclusive pass.
 *
 * A caption paragraph can be adjacent to two objects (e.g. directly below a
 * figure and directly above the table that follows). It must bind to exactly
 * ONE object — otherwise the second object would overwrite the first object's
 * caption and every later sync would fight itself. Primary placements are
 * claimed first (figure below / table above / code per config), then the
 * alternate side is considered only for still-unclaimed objects.
 */
function resolveObjectCaptions(
  lines: readonly string[],
  objects: readonly InternalObject[],
  configs: ObjectNumberingConfigs,
): ObjectCaptionResolution[] {
  const results: ObjectCaptionResolution[] = objects.map(() => ({ caption: null, duplicates: [] }))
  const claimed = new Set<number>()
  const startLines = new Set(objects.map(o => o.startLine))

  // Formula: an internal `\tag{…}` always wins over a sibling number line.
  objects.forEach((object, index) => {
    if (object.kind !== 'formula' || object.tagLine == null) return
    const raw = lines[object.tagLine - 1] ?? ''
    const value = parseTagLine(raw)
    if (value == null) return
    results[index].caption = { line: object.tagLine, prefix: '', numberText: value, title: '', raw, placement: 'tag' }
    claimed.add(object.tagLine)
  })

  const tryAssign = (index: number, placement: 'above' | 'below'): boolean => {
    if (results[index].caption) return false
    const object = objects[index]
    const line = placement === 'below'
      ? adjacentLineBelow(lines, object.endLine)
      : adjacentLineAbove(lines, object.startLine)
    if (line == null || claimed.has(line) || startLines.has(line)) return false
    if (!isStandaloneParagraph(lines, line - 1)) return false
    const parsed = parseCaptionLine(object.kind, lines[line - 1], configs[object.kind].prefix)
    if (!parsed) return false
    // Ordinary prose that merely starts with `图 1-1 …` usually ends with a
    // sentence punctuation mark; a real caption name does not.
    if (object.kind !== 'formula' && /[。！？；]$/.test(parsed.title)) return false
    results[index].caption = { ...parsed, line, raw: lines[line - 1], placement }
    claimed.add(line)
    return true
  }

  // Primary pass.
  objects.forEach((object, index) => {
    const position = normalizedPosition(object.kind, configs[object.kind])
    tryAssign(index, position)
  })
  // Secondary pass (adoption of captions that sit on the other side).
  objects.forEach((object, index) => {
    if (results[index].caption) return
    const position = normalizedPosition(object.kind, configs[object.kind])
    tryAssign(index, position === 'below' ? 'above' : 'below')
  })

  // Duplicate caption paragraphs belong to the SAME object (never another one).
  objects.forEach((object, index) => {
    const first = results[index].caption
    if (!first) return
    let cursor = first.line // 0-based index of the line after the caption
    for (;;) {
      if (cursor >= lines.length || lines[cursor].trim() !== '') break
      const next = cursor + 1
      if (next >= lines.length) break
      if (claimed.has(next + 1)) break
      if (!isStandaloneParagraph(lines, next)) break
      const parsed = parseCaptionLine(object.kind, lines[next], configs[object.kind].prefix)
      if (!parsed) break
      if (object.kind !== 'formula' && /[。！？；]$/.test(parsed.title)) break
      results[index].duplicates.push({ ...parsed, line: next + 1, raw: lines[next], placement: first.placement })
      claimed.add(next + 1)
      cursor = next + 1
    }
  })

  return results
}

function adjacentLineBelow(lines: readonly string[], endLine: number): number | null {
  let index = endLine // 0-based line after the object
  if (index >= lines.length) return null
  if (lines[index].trim() === '') index++
  if (index >= lines.length) return null
  return index + 1
}

function adjacentLineAbove(lines: readonly string[], startLine: number): number | null {
  let index = startLine - 2 // 0-based line before the object
  if (index < 0) return null
  if (lines[index].trim() === '') index--
  if (index < 0) return null
  return index + 1
}

// ── Heading context (semantic authority) ─────────────────

export interface ObjectHeadingContext {
  headings: SourceHeadingLine[]
  stateByLine: Map<number, SemanticHeadingNumberState>
  eol: string
}

/**
 * Build the semantic heading states for the CURRENT markdown. This is the SAME
 * engine the runtime heading service uses; the planner never parses heading
 * text to invent a chapter number.
 */
export function buildObjectHeadingContext(
  markdown: string,
  settings: HeadingNumberingSettings,
  overrideEntries: readonly SourceOverrideEntry[] = [],
  counterPolicy: UnnumberedCounterPolicy = 'skip',
): ObjectHeadingContext {
  const parsed = parseMarkdownHeadings(markdown)
  const prepared = prepareHeadingKeys(parsed.headings)
  const structure = resolveHeadingStructure(settings)
  const mode: HeadingStructureMode = structure.showLevelOneNumber ? 'loose' : 'strict'
  const physical: PhysicalHeading[] = prepared.map(p => ({
    key: p.key,
    level: p.heading.level,
    text: p.title,
  }))
  const overrideMap = buildOverrideMap(prepared, overrideEntries)
  const states = computeSemanticHeadingNumbers(physical, mode, {
    startAt: resolveSemanticStartAt(settings, mode),
    physicalStartAt: resolvePhysicalStartAt(settings),
    physicalPathsByKey: computePhysicalHeadingPaths(physical, settings, mode, overrideMap, counterPolicy),
    sourceRevision: 0,
    overrideMap: overrideMap.size > 0 ? overrideMap : undefined,
    counterPolicy,
  })
  const stateByLine = new Map<number, SemanticHeadingNumberState>()
  states.forEach((state, index) => {
    const heading = prepared[index]
    if (heading) stateByLine.set(heading.heading.line, state)
  })
  return { headings: parsed.headings, stateByLine, eol: parsed.eol }
}

interface PreparedHeading {
  heading: SourceHeadingLine
  title: string
  key: string
  occurrence: number
}

function prepareHeadingKeys(headings: readonly SourceHeadingLine[]): PreparedHeading[] {
  const stack: Array<{ level: number; key: string }> = []
  const occurrences = new Map<string, number>()
  const titleOccurrences = new Map<string, number>()
  return headings.map(heading => {
    const title = stripHeadingNumber(heading.text)
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) stack.pop()
    const parent = stack.length > 0 ? stack[stack.length - 1].key : 'root'
    const base = `${heading.level}|${parent}|${normalizeHeadingTitle(title)}`
    const occ = occurrences.get(base) ?? 0
    occurrences.set(base, occ + 1)
    const key = `${base}#${occ}`
    stack.push({ level: heading.level, key })
    const titleKey = `${heading.level}|${normalizeHeadingTitle(title)}`
    const titleOcc = titleOccurrences.get(titleKey) ?? 0
    titleOccurrences.set(titleKey, titleOcc + 1)
    return { heading, title, key, occurrence: titleOcc }
  })
}

function stripHeadingNumber(text: string): string {
  return scanHeadingNumber(text).title
}

function buildOverrideMap(
  prepared: readonly PreparedHeading[],
  entries: readonly SourceOverrideEntry[],
): Map<string, 'numbered' | 'unnumbered'> {
  const map = new Map<string, 'numbered' | 'unnumbered'>()
  if (entries.length === 0) return map
  const index = new Map<string, PreparedHeading>()
  for (const p of prepared) {
    index.set(`${p.heading.level}|${normalizeHeadingTitle(p.title)}#${p.occurrence}`, p)
  }
  for (const entry of entries) {
    const target = index.get(`${entry.level}|${normalizeHeadingTitle(entry.title)}#${entry.occurrence}`)
    if (target) map.set(target.key, entry.mode)
  }
  return map
}

// ── Expected number computation ──────────────────────────

export interface ExpectedObjectNumber {
  rawNumber: string
  numberText: string
  label: string
  scope: 'global' | 'chapter' | 'section'
  chapter: number | null
  section: number | null
  scopeKey: string
  /** R12: explicit scope requested a heading level that is absent. */
  missingScopeLevel?: boolean
  /** R12: which fallback the missing-level policy applied. */
  scopeFallback?: 'none' | 'nearest-ancestor' | 'document'
  /** R12: requested prefix level (null = none / legacy). */
  requestedPrefixLevel?: number | null
}

function requestedScopeForConfig(config: ObjectNumberingConfig): 'global' | 'chapter' | 'section' {
  const preset = config.preset ?? 'global'
  if (preset === 'legacy-custom') {
    const template = config.template ?? '{n}'
    if (template.includes('{section}')) return 'section'
    if (template.includes('{chapter}')) return 'chapter'
    return 'global'
  }
  return presetToScopeStyle(preset as NumberingPreset).requestedScope
}

function resetGroupKey(config: ObjectNumberingConfig, chapter: number | null, section: number | null): string {
  switch (config.numberingMode) {
    case 'reset-h1':
    case 'chapter-linked':
      return `h1:${chapter ?? 0}`
    case 'reset-h2':
    case 'reset-h3':
      return `h2:${chapter ?? 0}.${section ?? 0}`
    default:
      return 'continuous'
  }
}

// ── Public scanning entry ────────────────────────────────

/**
 * Scan the Markdown source into numbered objects (figure / table / code /
 * formula) with their adjacent captions, using the default per-kind caption
 * position + prefix. Used by the UI, diagnostics and tests; the planner uses
 * the same scanner with the user's real config.
 */
export function scanMarkdownNumberedObjects(markdown: string): ParsedNumberedObjects {
  const detected = detectObjects(markdown)
  const lines = markdown.split(/\r\n|\n/)
  const identityOccurrences = new Map<string, number>()
  const defaults = DEFAULT_OBJECT_CONFIG
  const resolutions = resolveObjectCaptions(lines, detected.objects, defaults)
  const objects: ScannedNumberedObject[] = detected.objects.map((object, index) => {
    const captionScan = resolutions[index] ?? { caption: null, duplicates: [] }
    const title = captionScan.caption?.title ?? ''
    const base = buildObjectSourceIdentity(object.kind, object.contentSignature, title, 0)
    const occurrence = identityOccurrences.get(base) ?? 0
    identityOccurrences.set(base, occurrence + 1)
    return {
      identity: buildObjectSourceIdentity(object.kind, object.contentSignature, title, occurrence),
      kind: object.kind,
      ordinal: object.ordinal,
      startLine: object.startLine,
      endLine: object.endLine,
      contentSignature: object.contentSignature,
      headingLine: precedingHeadingLine(detected.headings, object.startLine),
      caption: captionScan.caption,
      duplicateCaptions: captionScan.duplicates,
    }
  })
  return {
    objects,
    headings: detected.headings,
    lineCount: detected.lineCount,
    eol: detected.eol,
  }
}

const DEFAULT_OBJECT_CONFIG: ObjectNumberingConfigs = {
  figure: {
    enabled: true, prefix: '图', position: 'below', numberingMode: 'continuous',
    numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '{n}', preset: 'chapter-dash',
  },
  table: {
    enabled: true, prefix: '表', position: 'above', numberingMode: 'continuous',
    numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '{n}', preset: 'chapter-dash',
  },
  code: {
    enabled: true, prefix: '代码', position: 'above', numberingMode: 'continuous',
    numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '{n}', preset: 'chapter-dash',
  },
  formula: {
    enabled: true, prefix: '', position: 'right', numberingMode: 'continuous',
    numberStyle: 'arabic', startAt: 1, minDigits: 1, template: '{n}', preset: 'chapter-dash',
  },
}

function precedingHeadingLine(headings: readonly SourceHeadingLine[], objectStartLine: number): number | null {
  let result: number | null = null
  for (const heading of headings) {
    if (heading.line >= objectStartLine) break
    result = heading.line
  }
  return result
}

// ── Plan model ───────────────────────────────────────────

export type ObjectNumberAction = 'write' | 'update' | 'remove' | 'preserve' | 'skip'

export interface PlannedObjectNumber {
  identity: string
  kind: NumberedObjectKind
  ordinal: number
  startLine: number
  endLine: number
  contentSignature: string
  captionLine: number | null
  captionPlacement: 'above' | 'below' | 'tag' | null
  detectedNumber: string
  detectedTitle: string
  expected: ExpectedObjectNumber | null
  ownership: ObjectNumberOwnership
  action: ObjectNumberAction
  before: string | null
  after: string | null
  duplicateCaptionLines: number[]
  chapterMismatch: boolean
}

export interface ObjectNumberEdit {
  kind: 'replace' | 'insert' | 'delete'
  /** 1-based line for replace/delete. */
  line?: number
  /** 0-based insertion index. */
  index?: number
  lines?: string[]
  before?: string
  after?: string
}

export interface ObjectNumberPlanStats {
  scanned: number
  figures: number
  tables: number
  codes: number
  formulas: number
  captioned: number
  written: number
  updated: number
  removed: number
  preserved: number
  adopted: number
  unresolved: number
  duplicateCaptions: number
  chapterMismatch: number
  edits: number
}

export interface ObjectNumberPersistencePlan {
  mode: ObjectNumberStorageMode
  policy: ObjectCaptionPolicy
  objects: PlannedObjectNumber[]
  edits: ObjectNumberEdit[]
  nextMarkdown: string
  changed: boolean
  writable: boolean
  ownership: Record<string, ObjectNumberOwnershipRecord>
  stats: ObjectNumberPlanStats
}

export interface ObjectNumberPlanOptions {
  mode: ObjectNumberStorageMode
  policy: ObjectCaptionPolicy
  configs: ObjectNumberingConfigs
  headingSettings: HeadingNumberingSettings
  overrideEntries?: readonly SourceOverrideEntry[]
  counterPolicy?: UnnumberedCounterPolicy
  ownership?: Record<string, ObjectNumberOwnershipRecord>
  /** Remove command: delete ONLY captions recorded as plugin-managed. */
  removeManagedOnly?: boolean
  /** Remove duplicate captions while syncing. */
  removeDuplicateCaptions?: boolean
  now?: number
}

export function buildObjectSourceIdentity(
  kind: NumberedObjectKind,
  contentSignature: string,
  title: string,
  occurrence: number,
): string {
  return `${kind}|${contentSignature}|${normalizeHeadingTitle(title)}#${occurrence}`
}

export function planObjectNumberPersistence(
  markdown: string,
  options: ObjectNumberPlanOptions,
): ObjectNumberPersistencePlan {
  const detected = detectObjects(markdown)
  const context = buildObjectHeadingContext(
    markdown,
    options.headingSettings,
    options.overrideEntries ?? [],
    options.counterPolicy ?? 'skip',
  )
  const lines = markdown.split(/\r\n|\n/)
  const captionResolutions = resolveObjectCaptions(lines, detected.objects, options.configs)
  const counters = new Map<string, number>()
  const identityOccurrences = new Map<string, number>()
  // R12: canonical semantic state index for explicit scope resolution.
  const semanticByIdentity = new Map<string, SemanticHeadingNumberState>()
  for (const state of context.stateByLine.values()) semanticByIdentity.set(state.stableIdentity, state)

  const planned: PlannedObjectNumber[] = []
  const ownership: Record<string, ObjectNumberOwnershipRecord> = {}
  const replacements = new Map<number, string>()
  const deletions = new Set<number>()
  const insertions = new Map<number, string[]>()
  const now = options.now ?? Date.now()

  const stats: ObjectNumberPlanStats = {
    scanned: detected.objects.length,
    figures: 0,
    tables: 0,
    codes: 0,
    formulas: 0,
    captioned: 0,
    written: 0,
    updated: 0,
    removed: 0,
    preserved: 0,
    adopted: 0,
    unresolved: 0,
    duplicateCaptions: 0,
    chapterMismatch: 0,
    edits: 0,
  }

  for (let objectIndex = 0; objectIndex < detected.objects.length; objectIndex++) {
    const object = detected.objects[objectIndex]
    const config = options.configs[object.kind]
    const headingState = precedingHeadingState(context, object.startLine)
    const expected = computeExpectedNumber(object, config, headingState, counters, semanticByIdentity)
    const captionScan = captionResolutions[objectIndex] ?? { caption: null, duplicates: [] }
    const caption = captionScan.caption
    const title = caption?.title ?? ''
    const identityBase = buildObjectSourceIdentity(object.kind, object.contentSignature, title, 0)
    const occurrence = identityOccurrences.get(identityBase) ?? 0
    identityOccurrences.set(identityBase, occurrence + 1)
    const identity = buildObjectSourceIdentity(object.kind, object.contentSignature, title, occurrence)

    const previous = resolveObjectOwnershipRecord(options.ownership, identity, object.kind, title, caption?.numberText ?? '')
    const managed = isManagedObjectCaption(caption, previous)
    const label = expected?.label ?? ''
    const expectedNumber = expected?.numberText ?? ''

    const kindEnabled = config.enabled === true

    const chapterMismatch = caption != null && expected != null && isChapterMismatch(caption.numberText, expected)
    if (chapterMismatch) stats.chapterMismatch++
    if (captionScan.duplicates.length > 0) stats.duplicateCaptions += captionScan.duplicates.length

    const plan = decideObjectAction({
      object,
      config,
      caption,
      duplicates: captionScan.duplicates,
      managed,
      previous,
      expected,
      label,
      expectedNumber,
      kindEnabled,
      options,
      lines,
    })
    plan.entry.identity = identity

    planned.push(plan.entry)
    ownership[identity] = {
      identity,
      kind: object.kind,
      ownership: plan.entry.ownership,
      numberText: plan.entry.ownership === 'inkchapter' || plan.entry.ownership === 'adopted'
        ? expectedNumber
        : (caption?.numberText ?? ''),
      title,
      updatedAt: now,
    }

    if (plan.replacement) replacements.set(plan.replacement.line - 1, plan.replacement.after)
    if (plan.deletion) {
      for (const line of plan.deletion.lines) deletions.add(line - 1)
    }
    if (plan.insertion) {
      const bucket = insertions.get(plan.insertion.index) ?? []
      bucket.push(...plan.insertion.lines)
      insertions.set(plan.insertion.index, bucket)
    }

    if (plan.entry.action === 'write') stats.written++
    else if (plan.entry.action === 'update') stats.updated++
    else if (plan.entry.action === 'remove') stats.removed++
    else if (plan.entry.action === 'preserve') stats.preserved++
    if (plan.entry.ownership === 'adopted') stats.adopted++
    if (plan.entry.ownership === 'unresolved') stats.unresolved++
    if (caption) stats.captioned++
    if (object.kind === 'figure') stats.figures++
    else if (object.kind === 'table') stats.tables++
    else if (object.kind === 'code') stats.codes++
    else stats.formulas++
  }

  const edits: ObjectNumberEdit[] = []
  for (const [index, after] of replacements) {
    const before = lines[index] ?? ''
    if (before !== after) edits.push({ kind: 'replace', line: index + 1, before, after })
  }
  for (const index of deletions) {
    if (replacements.has(index)) continue
    edits.push({ kind: 'delete', line: index + 1 })
  }
  for (const [index, inserted] of insertions) {
    edits.push({ kind: 'insert', index, lines: inserted })
  }
  stats.edits = edits.length

  const nextMarkdown = applyEdits(lines, replacements, deletions, insertions, detected.eol)

  return {
    mode: options.mode,
    policy: options.policy,
    objects: planned,
    edits,
    nextMarkdown,
    changed: edits.length > 0,
    writable: options.mode === 'source' && Object.values(options.configs).some(c => c.enabled === true),
    ownership,
    stats,
  }
}

interface DecideObjectInput {
  object: InternalObject
  config: ObjectNumberingConfig
  caption: CaptionCandidate | null
  duplicates: CaptionCandidate[]
  managed: boolean
  previous: ObjectNumberOwnershipRecord | undefined
  expected: ExpectedObjectNumber | null
  label: string
  expectedNumber: string
  kindEnabled: boolean
  options: ObjectNumberPlanOptions
  lines: readonly string[]
}

interface DecideObjectResult {
  entry: PlannedObjectNumber
  replacement?: { line: number; after: string }
  deletion?: { lines: number[] }
  insertion?: { index: number; lines: string[] }
}

function decideObjectAction(input: DecideObjectInput): DecideObjectResult {
  const {
    object, config, caption, duplicates, managed, previous, expected,
    label, expectedNumber, kindEnabled, options,
  } = input
  const entry: PlannedObjectNumber = {
    identity: '',
    kind: object.kind,
    ordinal: object.ordinal,
    startLine: object.startLine,
    endLine: object.endLine,
    contentSignature: object.contentSignature,
    captionLine: caption?.line ?? null,
    captionPlacement: caption?.placement ?? null,
    detectedNumber: caption?.numberText ?? '',
    detectedTitle: caption?.title ?? '',
    expected,
    ownership: 'none',
    action: 'skip',
    before: caption?.raw ?? null,
    after: caption?.raw ?? null,
    duplicateCaptionLines: duplicates.map(d => d.line),
    chapterMismatch: false,
  }

  if (!kindEnabled) {
    entry.ownership = previous?.ownership ?? (caption ? 'user-preserved' : 'none')
    entry.action = 'preserve'
    return { entry: finalizeEntry(entry, input) }
  }

  // Remove command: only plugin-managed captions disappear.
  if (options.removeManagedOnly) {
    if (caption && managed) {
      entry.ownership = 'none'
      entry.action = 'remove'
      entry.after = null
      const removal = planCaptionRemoval(input.lines, caption, duplicates)
      return { entry: finalizeEntry(entry, input), ...removal }
    }
    entry.ownership = previous?.ownership ?? (caption ? 'user-preserved' : 'none')
    entry.action = 'preserve'
    return { entry: finalizeEntry(entry, input) }
  }

  // Render layer / detect-only: never write the source.
  if (options.mode !== 'source' || options.policy === 'detect-only') {
    entry.ownership = previous?.ownership ?? (caption ? 'user-preserved' : 'none')
    entry.action = 'preserve'
    return { entry: finalizeEntry(entry, input) }
  }

  if (label === '') {
    // Kind has no computable number (no chapter scope etc.) — keep the source.
    entry.ownership = previous?.ownership ?? (caption ? 'user-preserved' : 'none')
    entry.action = 'preserve'
    return { entry: finalizeEntry(entry, input) }
  }

  // ── preserve policy: never rewrite an existing caption ──
  if (options.policy === 'preserve') {
    if (caption) {
      entry.ownership = 'user-preserved'
      entry.action = 'preserve'
      return { entry: finalizeEntry(entry, input) }
    }
    const insertion = planCaptionInsertion(input.lines, object, buildCaptionLine(object.kind, config.prefix, expectedNumber, ''), normalizedPosition(object.kind, config))
    entry.ownership = 'inkchapter'
    entry.action = 'write'
    entry.after = insertion.caption
    return { entry: finalizeEntry(entry, input), insertion: { index: insertion.index, lines: insertion.lines } }
  }

  // ── adopt / replace ─────────────────────────────────────
  if (caption) {
    const updatedRaw = caption.placement === 'tag'
      ? replaceTagNumber(caption.raw, expectedNumber)
      : buildCaptionLine(object.kind, config.prefix, expectedNumber, caption.title)
    const normalizedUpdated = updatedRaw
    if (normalizedUpdated === caption.raw) {
      entry.ownership = managed ? (previous?.ownership ?? 'adopted') : 'adopted'
      entry.action = 'skip'
      const result: DecideObjectResult = { entry: finalizeEntry(entry, input) }
      if (options.removeDuplicateCaptions && duplicates.length > 0) {
        result.deletion = { lines: duplicates.map(d => d.line) }
      }
      return result
    }
    entry.ownership = managed ? (previous?.ownership ?? 'adopted') : 'adopted'
    entry.action = 'update'
    entry.after = normalizedUpdated
    const result: DecideObjectResult = {
      entry: finalizeEntry(entry, input),
      replacement: { line: caption.line, after: normalizedUpdated },
    }
    if (options.removeDuplicateCaptions && duplicates.length > 0) {
      result.deletion = { lines: duplicates.map(d => d.line) }
    }
    return result
  }

  const insertion = planCaptionInsertion(input.lines, object, buildCaptionLine(object.kind, config.prefix, expectedNumber, ''), normalizedPosition(object.kind, config))
  entry.ownership = 'inkchapter'
  entry.action = 'write'
  entry.after = insertion.caption
  return { entry: finalizeEntry(entry, input), insertion: { index: insertion.index, lines: insertion.lines } }
}

function finalizeEntry(entry: PlannedObjectNumber, input: DecideObjectInput): PlannedObjectNumber {
  entry.chapterMismatch = input.caption != null && input.expected != null
    && isChapterMismatch(input.caption.numberText, input.expected)
  return entry
}

function normalizedPosition(kind: NumberedObjectKind, config: ObjectNumberingConfig): 'above' | 'below' {
  if (kind === 'formula') return 'below'
  if (config.position === 'below') return 'below'
  if (config.position === 'above') return 'above'
  // left/right are legacy values; table defaults above, figure/code below.
  return kind === 'table' ? 'above' : 'below'
}

function buildCaptionLine(kind: NumberedObjectKind, prefix: string, numberText: string, title: string): string {
  if (kind === 'formula') return `（${numberText}）`
  return buildObjectNumberingLabel(prefix, numberText, title)
}

function replaceTagNumber(raw: string, numberText: string): string {
  return raw.replace(/\\tag\{[^}]*\}/, `\\tag{${numberText}}`)
}

function isManagedObjectCaption(
  caption: CaptionCandidate | null,
  record: ObjectNumberOwnershipRecord | undefined,
): boolean {
  if (!caption || !record) return false
  if (record.ownership !== 'inkchapter' && record.ownership !== 'adopted') return false
  return canonicalNumberLabel(record.numberText) === canonicalNumberLabel(caption.numberText)
}

/**
 * Tolerant ledger lookup: exact identity first, then the SAME kind + title +
 * canonical number (a content edit or an object move keeps its ownership).
 */
export function resolveObjectOwnershipRecord(
  ownership: Record<string, ObjectNumberOwnershipRecord> | undefined,
  identity: string,
  kind: NumberedObjectKind,
  title: string,
  numberText: string | null | undefined,
): ObjectNumberOwnershipRecord | undefined {
  if (!ownership) return undefined
  const exact = ownership[identity]
  if (exact) return exact
  if (numberText == null || numberText === '') return undefined
  const normalizedTitle = normalizeHeadingTitle(title)
  const target = canonicalNumberLabel(numberText)
  for (const record of Object.values(ownership)) {
    if (record.kind !== kind) continue
    if (record.ownership !== 'inkchapter' && record.ownership !== 'adopted') continue
    if (canonicalNumberLabel(record.numberText) !== target) continue
    if (normalizeHeadingTitle(record.title) === normalizedTitle) return record
  }
  return undefined
}

// ── Insertion / removal planning ─────────────────────────

function planCaptionInsertion(
  lines: readonly string[],
  object: InternalObject,
  caption: string,
  position: 'above' | 'below',
): { index: number; lines: string[]; caption: string } {
  const len = lines.length
  if (position === 'below') {
    // Insert immediately after the object so the caption never jumps over an
    // object that follows in the same gap (e.g. figure followed by a table).
    const index = object.endLine
    if (index >= len) return { index, lines: ['', caption], caption }
    return {
      index,
      lines: lines[index].trim() === '' ? ['', caption] : ['', caption, ''],
      caption,
    }
  }
  // Insert immediately BEFORE the object.
  const index = object.startLine - 1
  if (index <= 0) return { index, lines: [caption, ''], caption }
  return {
    index,
    lines: lines[index - 1]?.trim() === '' ? [caption, ''] : ['', caption, ''],
    caption,
  }
}

function planCaptionRemoval(
  lines: readonly string[],
  caption: CaptionCandidate,
  duplicates: readonly CaptionCandidate[],
): { deletion?: { lines: number[] } } {
  const targets = [caption.line, ...duplicates.map(d => d.line)]
  const deletion = new Set<number>(targets)
  for (const line of targets) {
    const prev = line - 2
    const next = line
    if (prev >= 0 && lines[prev]?.trim() === '') deletion.add(line - 1)
    else if (next < lines.length && lines[next]?.trim() === '') deletion.add(line + 1)
  }
  return { deletion: { lines: [...deletion].sort((a, b) => a - b) } }
}

function applyEdits(
  lines: readonly string[],
  replacements: ReadonlyMap<number, string>,
  deletions: ReadonlySet<number>,
  insertions: ReadonlyMap<number, readonly string[]>,
  eol: string,
): string {
  if (replacements.size === 0 && deletions.size === 0 && insertions.size === 0) {
    return lines.join(eol)
  }
  const out: string[] = []
  for (let i = 0; i <= lines.length; i++) {
    const inserted = insertions.get(i)
    if (inserted) out.push(...inserted)
    if (i === lines.length) break
    if (deletions.has(i)) continue
    out.push(replacements.get(i) ?? lines[i])
  }
  return out.join(eol)
}

// ── Expected number computation (reuses canonical formatters) ──

function precedingHeadingState(context: ObjectHeadingContext, objectStartLine: number): SemanticHeadingNumberState | null {
  let result: SemanticHeadingNumberState | null = null
  for (const heading of context.headings) {
    if (heading.line >= objectStartLine) break
    const state = context.stateByLine.get(heading.line)
    if (state) result = state
  }
  return result
}

function computeExpectedNumber(
  object: InternalObject,
  config: ObjectNumberingConfig,
  state: SemanticHeadingNumberState | null,
  counters: Map<string, number>,
  semanticByIdentity: ReadonlyMap<string, SemanticHeadingNumberState>,
): ExpectedObjectNumber | null {
  // R12: explicit scope (physical reset/prefix level). Legacy configs keep the
  // historical preset + degradation behavior byte-for-byte.
  const explicitScope = resolveObjectNumberScope(object.kind, config, state, semanticByIdentity)
  if (explicitScope) {
    const ordinal = (counters.get(explicitScope.scopeKey) ?? 0) + 1
    counters.set(explicitScope.scopeKey, ordinal)
    const minDigits = Math.max(1, config.minDigits ?? 1)
    const effectiveOrdinal = (config.startAt ?? 1) + ordinal - 1
    const rawNumber = formatObjectScopeNumber(explicitScope, effectiveOrdinal, minDigits)
    const componentCount = explicitScope.prefixComponents.length
    const scope: ExpectedObjectNumber['scope'] = componentCount === 0
      ? 'global'
      : componentCount === 1 ? 'chapter' : 'section'
    return {
      rawNumber,
      numberText: rawNumber,
      label: buildObjectNumberingLabel(config.prefix, rawNumber, ''),
      scope,
      chapter: explicitScope.prefixComponents[0] ?? null,
      section: componentCount > 1 ? explicitScope.prefixComponents[componentCount - 1] : null,
      scopeKey: explicitScope.scopeKey,
      missingScopeLevel: explicitScope.missingRequestedLevel,
      scopeFallback: explicitScope.fallback,
      requestedPrefixLevel: explicitScope.requestedPrefixLevel,
    }
  }

  // R12 — standard presets follow the heading's VISIBLE number path.
  const presetSpec = displayPrefixForPreset(config.preset ?? 'global')
  const displayScope = presetSpec
    ? resolveDisplayPrefixScope(object.kind, presetSpec.componentCount, presetSpec.style, state, semanticByIdentity)
    : null
  if (displayScope) {
    const ordinal = (counters.get(displayScope.scopeKey) ?? 0) + 1
    counters.set(displayScope.scopeKey, ordinal)
    const minDigits = Math.max(1, config.minDigits ?? 1)
    const effectiveOrdinal = (config.startAt ?? 1) + ordinal - 1
    const rawNumber = formatObjectNumberFromComponents(displayScope.components, displayScope.style, effectiveOrdinal, minDigits)
    const componentCount = displayScope.components.length
    return {
      rawNumber,
      numberText: rawNumber,
      label: buildObjectNumberingLabel(config.prefix, rawNumber, ''),
      scope: componentCount === 0 ? 'global' : componentCount === 1 ? 'chapter' : 'section',
      chapter: displayScope.components[0] ?? null,
      section: componentCount > 1 ? displayScope.components[1] : null,
      scopeKey: displayScope.scopeKey,
      ...(displayScope.degraded
        ? {
            missingScopeLevel: true,
            scopeFallback: 'nearest-ancestor' as const,
            requestedPrefixLevel: presetSpec?.componentCount ?? null,
          }
        : {}),
    }
  }

  const requested = requestedScopeForConfig(config)
  const chapter = state?.chapterOrdinal ?? null
  const section = state?.sectionOrdinal ?? null
  const scope = resolveCaptionScope(requested, chapter, section)
  const reset = resetGroupKey(config, scope.chapter, scope.section)
  const scopeKey = `${object.kind}:${scope.effectiveScope}:${scope.chapter ?? 0}:${scope.section ?? 0}:${reset}`
  const ordinal = (counters.get(scopeKey) ?? 0) + 1
  counters.set(scopeKey, ordinal)

  const minDigits = Math.max(1, config.minDigits ?? 1)
  const effectiveOrdinal = (config.startAt ?? 1) + ordinal - 1
  const preset = config.preset ?? 'global'
  let rawNumber: string
  if (preset === 'legacy-custom') {
    rawNumber = renderNumberTemplate(config.template ?? '{n}', {
      n: String(effectiveOrdinal).padStart(minDigits, '0'),
      chapter: String(scope.chapter ?? 0),
      section: String(scope.section ?? 0),
    })
  } else {
    const { style } = presetToScopeStyle(preset as NumberingPreset)
    rawNumber = formatObjectNumber(scope.effectiveScope, style, scope.chapter, scope.section, effectiveOrdinal, minDigits)
  }
  const label = buildObjectNumberingLabel(config.prefix, rawNumber, '')
  return {
    rawNumber,
    numberText: rawNumber,
    label,
    scope: scope.effectiveScope,
    chapter: scope.chapter,
    section: scope.section,
    scopeKey,
  }
}

function isChapterMismatch(detectedNumber: string, expected: ExpectedObjectNumber): boolean {
  if (expected.scope === 'global') return false
  const detectedChapter = leadingNumericComponent(detectedNumber)
  if (detectedChapter == null || expected.chapter == null) return false
  return detectedChapter !== expected.chapter
}

function leadingNumericComponent(numberText: string): number | null {
  const match = /^([0-9]+)/.exec(numberText.trim())
  return match ? Number(match[1]) : null
}

// ── Small public helpers ─────────────────────────────────

export function formatObjectNumberForPrefix(
  kind: NumberedObjectKind,
  prefix: string,
  numberText: string,
  title: string,
): string {
  return buildCaptionLine(kind, prefix, numberText, title)
}

/** Stable structure signature: headings + object kinds/content + caption presence. */
export function computeObjectStructureSignature(markdown: string): string {
  const detected = detectObjects(markdown)
  const headingPart = parseMarkdownHeadings(markdown).headings
    .map(h => `${h.level}:${normalizeHeadingTitle(stripHeadingNumber(h.text))}`)
    .join('\n')
  const objectPart = detected.objects
    .map(o => `${o.kind}:${o.contentSignature}`)
    .join('\n')
  return `${headingPart}\n--\n${objectPart}`
}
