/**
 * R08 — Heading number persistence planner (pure).
 *
 * ONE numbering calculation feeds every surface. This module takes the SAME
 * `computeHeadingNumbering()` result the body/outline renderer consumes, merges
 * it with what the Markdown SOURCE already contains, and emits line-level
 * patches that write / update / remove *only* the number prefix.
 *
 * Invariants:
 *   - Numbering is computed from heading titles with every confirmed prefix
 *     stripped, so a second sync produces zero patches (idempotent).
 *   - A managed prefix is UPDATED in place — never appended. `## 1.1 研究背景`
 *     can therefore never become `## 1.1 1.1 研究背景`.
 *   - Ambiguous prefixes (`2026 年研究报告`) are never rewritten automatically.
 *   - `mode: 'render'` and policy `detect-only` produce NO source patch.
 *   - Disabling heading numbering never deletes persisted numbers.
 *
 * Pure contract: no DOM, no host state, no I/O.
 */

import type {
  HeadingDescriptor,
  HeadingLevel,
  HeadingNumberingSettings,
  HeadingLevelStyle,
  UnnumberedCounterPolicy,
} from './heading-types'
import { computeHeadingNumbering } from './numbering-engine'
import { buildStrictEffectiveLevels } from './numbering-engine'
import { resolveHeadingStructure } from './heading-structure'
import {
  canonicalNumberLabel,
  isRewritableHeadingNumber,
  scanHeadingNumber,
  type ExistingHeadingNumber,
} from './heading-number-source-scanner'

// ── Settings model ───────────────────────────────────────

export type HeadingNumberStorageMode = 'render' | 'source' | 'export'

export type ExistingHeadingNumberPolicy = 'adopt' | 'replace' | 'preserve' | 'detect-only'

export type HeadingNumberSyncTiming = 'manual' | 'edit' | 'save'

export type HeadingNumberOwnership =
  | 'inkchapter'
  | 'adopted'
  | 'user-preserved'
  | 'unresolved'
  | 'none'

export interface HeadingNumberOwnershipRecord {
  /** Stable structural identity (level + ancestor path + title + occurrence). */
  identity: string
  ownership: HeadingNumberOwnership
  /** Number text currently owned at this identity (`''` when unnumbered). */
  numberText: string
  updatedAt: number
}

export interface NumberingPersistenceSettings {
  storageMode: HeadingNumberStorageMode
  existingNumberPolicy: ExistingHeadingNumberPolicy
  syncTiming: HeadingNumberSyncTiming
  /** Do not project a render-layer number when the source already has one. */
  dedupeProjectedNumbers: boolean
}

export interface SourceOverrideEntry {
  level: HeadingLevel
  /** Title with confirmed number prefixes stripped. */
  title: string
  /** Occurrence index among headings with the same level + title (document order). */
  occurrence: number
  mode: 'numbered' | 'unnumbered'
}

// ── Source parsing ───────────────────────────────────────

export interface SourceHeadingLine {
  /** 1-based line number. */
  line: number
  level: HeadingLevel
  /** Everything before the heading text (indent + hashes + at least one space). */
  marker: string
  /** Heading text after the marker, may still contain an existing number. */
  text: string
  /** The complete original line. */
  raw: string
}

export interface ParsedMarkdownHeadings {
  headings: SourceHeadingLine[]
  lineCount: number
  /** Detected line ending (defaults to `\n`). */
  eol: string
}

const HEADING_LINE = /^( {0,3})(#{1,6})([ \t]+)(.*)$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * Parse ATX headings outside fenced code blocks and YAML front matter.
 * Setext headings are intentionally not interpreted as headings here.
 */
export function parseMarkdownHeadings(markdown: string): ParsedMarkdownHeadings {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(/\r\n|\n/)
  const headings: SourceHeadingLine[] = []
  let fence: string | null = null
  let inFrontMatter = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const isFirst = i === 0

    if (isFirst && raw.trim() === '---') {
      inFrontMatter = true
      continue
    }
    if (inFrontMatter) {
      if (raw.trim() === '---') inFrontMatter = false
      continue
    }

    const fenceMatch = FENCE.exec(raw)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (fence == null) fence = marker[0]
      else if (marker[0] === fence) fence = null
      continue
    }
    if (fence != null) continue

    const match = HEADING_LINE.exec(raw)
    if (!match) continue
    const marker = `${match[1]}${match[2]}${match[3]}`
    headings.push({
      line: i + 1,
      level: match[2].length as HeadingLevel,
      marker,
      text: match[4],
      raw,
    })
  }

  return { headings, lineCount: lines.length, eol }
}

// ── Plan model ───────────────────────────────────────────

export type HeadingNumberAction = 'write' | 'update' | 'remove' | 'preserve' | 'skip'

export interface PlannedHeadingNumber {
  line: number
  level: HeadingLevel
  identity: string
  /** Title after every confirmed prefix was removed. */
  title: string
  /** Unified engine label (`''` = heading is not numbered). */
  label: string
  labelGap: string
  /** First existing number prefix (outermost). */
  detected: ExistingHeadingNumber | null
  /** Additional prefixes after the first one (double numbering). */
  extra: ExistingHeadingNumber[]
  ownership: HeadingNumberOwnership
  action: HeadingNumberAction
  before: string
  after: string
}

export interface HeadingNumberPatch {
  line: number
  before: string
  after: string
}

export interface HeadingNumberPlanStats {
  scanned: number
  written: number
  updated: number
  removed: number
  preserved: number
  adopted: number
  unresolved: number
  changedLines: number
}

export interface HeadingNumberPersistencePlan {
  mode: HeadingNumberStorageMode
  policy: ExistingHeadingNumberPolicy
  headings: PlannedHeadingNumber[]
  patches: HeadingNumberPatch[]
  nextMarkdown: string
  changed: boolean
  /** Whether the caller may write the plan (feature enabled + real write mode). */
  writable: boolean
  ownership: Record<string, HeadingNumberOwnershipRecord>
  stats: HeadingNumberPlanStats
}

export interface HeadingNumberPlanOptions {
  mode: HeadingNumberStorageMode
  policy: ExistingHeadingNumberPolicy
  /** Ownership records from the previous run (identity → record). */
  ownership?: Record<string, HeadingNumberOwnershipRecord>
  overrideEntries?: readonly SourceOverrideEntry[]
  counterPolicy?: UnnumberedCounterPolicy
  /** Remove command: strip ONLY prefixes recorded as plugin-managed. */
  removeManagedOnly?: boolean
  now?: number
}

/** Build the stable identity used by the ownership map. */
export function buildHeadingSourceIdentity(
  level: HeadingLevel,
  parentIdentity: string,
  title: string,
  occurrence: number,
): string {
  return `${level}|${parentIdentity}|${normalizeHeadingTitle(title)}#${occurrence}`
}

export function normalizeHeadingTitle(title: string): string {
  return title
    .replace(/[\s\u00A0\u3000]+/g, '')
    .replace(/[，。！？、；：""''（）【】《》]/g, '')
    .toLowerCase()
}

// ── Planner ──────────────────────────────────────────────

interface PreparedHeading {
  heading: SourceHeadingLine
  title: string
  identity: string
  occurrenceKey: string
  occurrence: number
}

export function planHeadingNumberPersistence(
  markdown: string,
  headingSettings: HeadingNumberingSettings,
  options: HeadingNumberPlanOptions,
): HeadingNumberPersistencePlan {
  const parsed = parseMarkdownHeadings(markdown)
  const lines = markdown.split(/\r\n|\n/)
  const prepared = prepareHeadings(parsed.headings)

  const overrideMap = buildOverrideMap(prepared, options.overrideEntries ?? [])
  const descriptors: HeadingDescriptor[] = prepared.map(p => ({
    key: p.identity,
    level: p.heading.level,
    text: p.title,
  }))
  const numbered = computeHeadingNumbering(
    descriptors,
    headingSettings,
    overrideMap.size > 0 ? overrideMap : undefined,
    options.counterPolicy,
  )
  const byIdentity = new Map(numbered.map(n => [n.key, n]))
  const levelSlots = resolveLevelSlots(headingSettings)

  const planned: PlannedHeadingNumber[] = []
  const patches: HeadingNumberPatch[] = []
  const ownership: Record<string, HeadingNumberOwnershipRecord> = {}
  const now = options.now ?? Date.now()
  const stats: HeadingNumberPlanStats = {
    scanned: prepared.length,
    written: 0,
    updated: 0,
    removed: 0,
    preserved: 0,
    adopted: 0,
    unresolved: 0,
    changedLines: 0,
  }

  for (const item of prepared) {
    const result = byIdentity.get(item.identity)
    const label = result?.label ?? ''
    const labelGap = result?.labelGap ?? 'none'
    const slot = levelSlots[item.heading.level]
    const scan = scanHeadingNumber(item.heading.text, {
      expectedLabel: label,
      templatePrefix: slot?.templatePrefix,
      templateSuffix: slot?.templateSuffix,
    })
    const detected = scan.first
    const previous = options.ownership?.[item.identity]
    const plan = decideHeadingAction({
      heading: item.heading,
      identity: item.identity,
      title: scan.title,
      label,
      labelGap,
      detected,
      extra: scan.extra,
      previous,
      options,
      featureEnabled: headingSettings.enabled === true,
    })

    planned.push(plan)
    ownership[item.identity] = {
      identity: item.identity,
      ownership: plan.ownership,
      numberText: plan.ownership === 'adopted' || plan.ownership === 'inkchapter'
        ? label
        : (detected?.numberText ?? ''),
      updatedAt: now,
    }

    if (plan.after !== plan.before) {
      patches.push({ line: plan.line, before: plan.before, after: plan.after })
      if (plan.action === 'write') stats.written++
      else if (plan.action === 'update') stats.updated++
      else if (plan.action === 'remove') stats.removed++
      stats.changedLines++
    }
    if (plan.action === 'preserve') stats.preserved++
    if (plan.ownership === 'adopted') stats.adopted++
    if (plan.ownership === 'unresolved') stats.unresolved++
  }

  if (patches.length > 0) {
    for (const patch of patches) {
      lines[patch.line - 1] = patch.after
    }
  }
  const nextMarkdown = patches.length === 0 ? markdown : lines.join(parsed.eol)

  return {
    mode: options.mode,
    policy: options.policy,
    headings: planned,
    patches,
    nextMarkdown,
    changed: patches.length > 0,
    writable: options.mode === 'source' && headingSettings.enabled === true,
    ownership,
    stats,
  }
}

interface DecideInput {
  heading: SourceHeadingLine
  identity: string
  title: string
  label: string
  labelGap: string
  detected: ExistingHeadingNumber | null
  extra: ExistingHeadingNumber[]
  previous: HeadingNumberOwnershipRecord | undefined
  options: HeadingNumberPlanOptions
  featureEnabled: boolean
}

function decideHeadingAction(input: DecideInput): PlannedHeadingNumber {
  const { heading, identity, label, labelGap, detected, previous, options } = input
  const base = {
    line: heading.line,
    level: heading.level,
    identity,
    title: input.title,
    label,
    labelGap,
    detected,
    extra: input.extra,
    before: heading.raw,
    after: heading.raw,
  }

  const managed = isManagedPrefix(detected, previous)
  const canRewrite = (detected === null || managed || isRewritableHeadingNumber(detected))
    && input.extra.every(isRewritableHeadingNumber)
  const sep = label === '' ? '' : (labelGap === 'space' ? ' ' : '')
  const withNumber = `${heading.marker}${label}${sep}${input.title}`
  const withoutNumber = `${heading.marker}${input.title}`

  const keep = (ownership: HeadingNumberOwnership, action: HeadingNumberAction = 'skip') => ({
    ...base,
    ownership,
    action,
    after: heading.raw,
  })

  // Explicit removal command — only plugin-managed prefixes.
  if (options.removeManagedOnly) {
    if (managed && canRewrite) {
      return { ...base, ownership: 'none', action: 'remove', after: withoutNumber }
    }
    return keep(previous?.ownership ?? (detected ? 'user-preserved' : 'none'), 'preserve')
  }

  // Feature disabled: never delete persisted numbers.
  if (!input.featureEnabled) {
    return keep(previous?.ownership ?? (detected ? 'user-preserved' : 'none'))
  }

  // Render layer / detect-only / export without a number: no source edit.
  if (options.mode === 'render' || options.policy === 'detect-only') {
    return keep(resolvePassiveOwnership(detected, previous))
  }

  if (label === '') {
    if (options.mode === 'export') return keep(resolvePassiveOwnership(detected, previous), 'preserve')
    if (managed && canRewrite) {
      return { ...base, ownership: 'none', action: 'remove', after: withoutNumber }
    }
    return keep(resolvePassiveOwnership(detected, previous), 'preserve')
  }

  if (options.policy === 'preserve') {
    if (detected) {
      return keep(detected.confidence === 'weak' ? 'unresolved' : 'user-preserved', 'preserve')
    }
    return { ...base, ownership: 'inkchapter', action: 'write', after: withNumber }
  }

  // adopt / replace
  if (detected && detected.confidence === 'weak' && !detected.matchesExpected) {
    return keep('unresolved', 'preserve')
  }
  if (!canRewrite) {
    return keep('unresolved', 'preserve')
  }
  if (withNumber === heading.raw) {
    return { ...base, ownership: detected ? 'adopted' : 'inkchapter', action: 'skip' }
  }
  return {
    ...base,
    ownership: detected ? 'adopted' : 'inkchapter',
    action: detected ? 'update' : 'write',
    after: withNumber,
  }
}

function resolvePassiveOwnership(
  detected: ExistingHeadingNumber | null,
  previous: HeadingNumberOwnershipRecord | undefined,
): HeadingNumberOwnership {
  if (previous && previous.ownership !== 'none') return previous.ownership
  if (!detected) return 'none'
  return detected.confidence === 'weak' ? 'unresolved' : 'user-preserved'
}

/** A prefix is plugin-managed only when a record says so AND the text matches. */
export function isManagedPrefix(
  detected: ExistingHeadingNumber | null,
  record: HeadingNumberOwnershipRecord | undefined,
): boolean {
  if (!detected || !record) return false
  if (record.ownership !== 'inkchapter' && record.ownership !== 'adopted') return false
  return canonicalNumberLabel(record.numberText) === canonicalNumberLabel(detected.numberText)
}

// ── Internals ────────────────────────────────────────────

function prepareHeadings(headings: readonly SourceHeadingLine[]): PreparedHeading[] {
  const stack: Array<{ level: HeadingLevel; identity: string }> = []
  const identityOccurrences = new Map<string, number>()
  const titleOccurrences = new Map<string, number>()

  return headings.map(heading => {
    const title = scanHeadingNumber(heading.text).title
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) stack.pop()
    const parentIdentity = stack.length > 0 ? stack[stack.length - 1].identity : 'root'
    const baseKey = `${heading.level}|${parentIdentity}|${normalizeHeadingTitle(title)}`
    const occ = identityOccurrences.get(baseKey) ?? 0
    identityOccurrences.set(baseKey, occ + 1)
    const identity = `${baseKey}#${occ}`
    stack.push({ level: heading.level, identity })

    const occurrenceKey = `${heading.level}|${normalizeHeadingTitle(title)}`
    const titleOcc = titleOccurrences.get(occurrenceKey) ?? 0
    titleOccurrences.set(occurrenceKey, titleOcc + 1)

    return { heading, title, identity, occurrenceKey, occurrence: titleOcc }
  })
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
    const key = `${entry.level}|${normalizeHeadingTitle(entry.title)}#${entry.occurrence}`
    const target = index.get(key)
    if (target) map.set(target.identity, entry.mode)
  }
  return map
}

interface LevelSlot {
  templatePrefix: string
  templateSuffix: string
}

/**
 * Resolve the *effective* level style (strict H1 shifts H2..H6 by one slot) and
 * read the custom prefix/suffix that the active label actually renders.
 */
function resolveLevelSlots(settings: HeadingNumberingSettings): Record<HeadingLevel, LevelSlot> {
  const structure = resolveHeadingStructure(settings)
  const effective: Record<HeadingLevel, HeadingLevelStyle> = structure.showLevelOneNumber
    ? settings.levels
    : buildStrictEffectiveLevels(settings.levels)
  const showLevelOne = structure.showLevelOneNumber

  const slots = {} as Record<HeadingLevel, LevelSlot>
  for (const level of [1, 2, 3, 4, 5, 6] as HeadingLevel[]) {
    const style = effective[level]
    let prefix = style?.levelTemplate?.prefix ?? style?.prefix ?? ''
    let suffix = style?.levelTemplate?.suffix ?? style?.suffix ?? ''
    const contextual = style?.contextualFormatVariants?.withLevelOne ?? []
    const own = contextual.find(seg => seg.type === 'level-reference' && seg.level === level)
    if (own && own.type === 'level-reference') {
      prefix = own.appearance.prefix
      suffix = own.appearance.suffix
    }
    if (!showLevelOne && level === 1) {
      prefix = ''
      suffix = ''
    }
    slots[level] = { templatePrefix: prefix, templateSuffix: suffix }
  }
  return slots
}
