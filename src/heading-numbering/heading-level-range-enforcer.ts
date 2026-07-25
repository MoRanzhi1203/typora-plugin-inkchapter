/**
 * Heading Level Range Enforcer — unified enforcement engine.
 *
 * Responsibilities:
 * - canCreateHeading(): permission-check gate for all heading-creation entry points
 * - preserveBlockedAtxHeadingAsText(): escape hashes so they render as plain text
 * - Post-hoc correction: revert out-of-range headings created by Typora's native
 *   shortcuts (which cannot be intercepted), by watching DOM mutations
 * - Paste interception: after paste, detect & convert out-of-range ATX lines
 * - Demotion interception: block heading demotion past the max level
 * - Notices: user-friendly prompts for blocked operations
 *
 * Design principle:
 *   Typora's native heading shortcuts (Ctrl+1..6) are NOT interceptable
 *   via the community framework API.  We therefore use a post-hoc strategy:
 *   detect the DOM change, validate the heading level, and revert if
 *   out-of-range.  This is the only reliable approach given API constraints.
 */

import type { HeadingLevel, MaxHeadingLevel } from './heading-types'
import * as logger from '../core/logger'

// ── Public API ────────────────────────────────────────────────────────

/**
 * Check whether a heading of `requestedLevel` can be created given the
 * current effective `maxLevel`.
 *
 * This is the single gate used by all entry points.
 */
export function canCreateHeading(
  requestedLevel: HeadingLevel,
  effectiveMaxLevel: MaxHeadingLevel,
): boolean {
  return requestedLevel <= effectiveMaxLevel
}

/**
 * Preserve a blocked ATX heading line as plain text by escaping the leading
 * hash characters.
 *
 * Input:   `##### H5标题`
 * Output:  `\#\#\#\#\# H5标题`
 *
 * The escaped line renders as plain text (not a heading).
 *
 * Requirements:
 * - Hash count preserved exactly
 * - Spaces preserved
 * - Heading text preserved (including inline code, links, etc.)
 * - No auto-numbering written
 * - No double-escaping (already-escaped hashes left alone)
 * - Code-block lines and non-line-start hashes unaffected
 */
export function preserveBlockedAtxHeadingAsText(
  rawLine: string,
  requestedLevel: number,
): string {
  // Already escaped? Leave alone
  if (/^\\#/.test(rawLine)) return rawLine

  const hashLen = rawLine.match(/^(#{1,6})(\s|$)/)
  if (!hashLen || hashLen[0].length - (hashLen[2]?.length ?? 0) < 1) return rawLine

  const hashes = hashLen[1]
  const rest = rawLine.slice(hashes.length)

  // Only escape if the hash count matches the blocked level
  if (hashes.length !== requestedLevel) return rawLine

  // Escape: \ before each #
  const escaped = '\\' + hashes.replace(/#/g, '\\#')
  return escaped + rest
}

/**
 * Convert a pasted line that would be an out-of-range ATX heading into
 * safe plain text (same as preserveBlockedAtxHeadingAsText but validates level).
 */
export function preserveBlockedPastedLine(
  line: string,
  maxLevel: number,
): string | null {
  const match = line.match(/^(#{1,6})\s+(.+)/)
  if (!match) return null

  const level = match[1].length
  if (level <= maxLevel) return null

  return preserveBlockedAtxHeadingAsText(line, level)
}

/**
 * Parse a heading line to get its level.  Returns 0 if not a heading.
 */
export function parseHeadingLevel(line: string): number {
  const match = line.match(/^(#{1,6})(\s|$)/)
  if (!match) return 0
  return match[1].length
}

// ── Phase 2: Post-hoc enforcer for the HeadingNumberingService ───────

export interface EnforcerCallbacks {
  /** Get current effective max level. */
  getEffectiveMaxLevel: () => HeadingLevel
  /** Get raw markdown content. */
  getMarkdown: () => string
  /** Replace editor content with undo support. */
  reloadContent: (markdown: string) => void
  /** Show notice to user. */
  showNotice: (message: string) => void
}

export class HeadingLevelRangeEnforcer {
  private callbacks: EnforcerCallbacks
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  /** Set of heading levels that have already shown a notice this session. */
  private noticedLevelsThisSession: Set<number> = new Set()

  constructor(callbacks: EnforcerCallbacks) {
    this.callbacks = callbacks
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  // ── Unified check ────────────────────────────────────────────────

  canCreateHeading(level: HeadingLevel): boolean {
    return canCreateHeading(level, this.callbacks.getEffectiveMaxLevel() as MaxHeadingLevel)
  }

  getBlockedNotice(level: HeadingLevel): string {
    const max = this.callbacks.getEffectiveMaxLevel()
    return `当前文档有效标题范围为 H1 – H${max}，不能创建 H${level}。`
  }

  // ── Post-hoc DOM correction ──────────────────────────────────────

  /**
   * Called after DOM mutations that might have created out-of-range headings.
   * Scans h5/h6 elements in the editor and reverts them to escaped text.
   *
   * This covers:
   * - Typora native Ctrl+5 / Ctrl+6 shortcuts
   * - Typora heading menu selection
   * - Command panel heading conversion
   */
  enforceAfterMutation(): void {
    const maxLevel = this.callbacks.getEffectiveMaxLevel()
    if (maxLevel >= 6) return // no restriction

    // Schedule: deduplicate rapid mutations
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.doEnforceAfterMutation(maxLevel)
    }, 80)
  }

  private doEnforceAfterMutation(maxLevel: number): void {
    const write = document.getElementById('write')
    if (!write) return

    const outOfRange = write.querySelectorAll<HTMLHeadingElement>(
      Array.from({ length: 6 - maxLevel }, (_, i) => `h${maxLevel + i + 1}`).join(', '),
    )
    if (outOfRange.length === 0) return

    // Collect blocked levels for notice
    const blockedLevels = new Set<number>()
    for (let i = 0; i < outOfRange.length; i++) {
      blockedLevels.add(parseInt(outOfRange[i].tagName.charAt(1), 10))
    }

    // Show notice once per level per session
    let noticeShown = false
    for (const lv of blockedLevels) {
      if (!this.noticedLevelsThisSession.has(lv)) {
        this.callbacks.showNotice(this.getBlockedNotice(lv as HeadingLevel))
        this.noticedLevelsThisSession.add(lv)
        noticeShown = true
      }
    }

    // Revert via markdown manipulation: replace heading lines with escaped text
    const md = this.callbacks.getMarkdown()
    const lines = md.split('\n')
    let inCodeBlock = false
    let modified = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const isFence = /^```/.test(line.trimStart())
      if (isFence) { inCodeBlock = !inCodeBlock; continue }
      if (inCodeBlock) continue

      const match = line.match(/^(#{1,6})\s+(.+)/)
      if (!match) continue

      const level = match[1].length
      if (level <= maxLevel) continue

      // Convert to escaped plain text
      lines[i] = preserveBlockedAtxHeadingAsText(line, level)
      modified = true
      logger.info(`[enforcer] 已将 H${level} 行转为普通文本: ${line.slice(0, 40)}`)
    }

    if (modified) {
      const newMd = lines.join('\n')
      this.callbacks.reloadContent(newMd)
    }

    // Reset notices after re-correction
    if (modified) this.noticedLevelsThisSession.clear()
  }

  // ── Paste handling ───────────────────────────────────────────────

  /**
   * Handle paste event: scan the markdown for out-of-range ATX headings
   * and convert them to escaped plain text.
   *
   * This is called from the MutationObserver after paste completes.
   */
  enforceAfterPaste(): void {
    // Same logic as enforceAfterMutation but with paste-specific notice
    const maxLevel = this.callbacks.getEffectiveMaxLevel()
    if (maxLevel >= 6) return

    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.doEnforceAfterPaste(maxLevel)
    }, 100)
  }

  private doEnforceAfterPaste(maxLevel: number): void {
    const md = this.callbacks.getMarkdown()
    const lines = md.split('\n')
    let inCodeBlock = false
    let blockedCount = 0
    const converted: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const isFence = /^```/.test(line.trimStart())
      if (isFence) { inCodeBlock = !inCodeBlock; continue }
      if (inCodeBlock) continue

      const match = line.match(/^(#{1,6})\s+(.+)/)
      if (!match) continue

      const level = match[1].length
      if (level <= maxLevel) continue

      lines[i] = preserveBlockedAtxHeadingAsText(line, level)
      blockedCount++
      converted.push(line.trim())
    }

    if (blockedCount > 0) {
      const newMd = lines.join('\n')
      this.callbacks.reloadContent(newMd)
      this.callbacks.showNotice(
        `粘贴内容中有 ${blockedCount} 个标题超出 H1–H${maxLevel}，已作为普通文本保留。`,
      )
      logger.info(`[enforcer] 粘贴处理：${blockedCount} 个超范围标题已转文本`)
    }
  }

  // ── Demotion interception ─────────────────────────────────────────

  /**
   * Check if a heading demotion (levelUp) would exceed the max level.
   * Call BEFORE allowing the demotion.
   *
   * @param currentLevel - Current heading level
   * @returns { allowed: boolean, blockedLevel?: number }
   */
  checkDemotion(currentLevel: number): { allowed: boolean; blockedLevel?: number } {
    const maxLevel = this.callbacks.getEffectiveMaxLevel()
    const targetLevel = currentLevel + 1

    if (targetLevel > 6) return { allowed: true, blockedLevel: undefined } // already max
    if (targetLevel <= maxLevel) return { allowed: true, blockedLevel: undefined }

    return { allowed: false, blockedLevel: targetLevel }
  }

  /**
   * Show demotion-blocked notice (throttled: once per level per session).
   */
  showDemotionBlockedNotice(blockedLevel: number): void {
    const max = this.callbacks.getEffectiveMaxLevel()
    const key = blockedLevel + 10 // offset to avoid collision with create-notices

    if (!this.noticedLevelsThisSession.has(key)) {
      this.noticedLevelsThisSession.add(key)
      this.callbacks.showNotice(
        `当前文档有效标题范围为 H1 – H${max}，H${blockedLevel - 1} 不能降为 H${blockedLevel}。`,
      )
    }
  }

  /** Reset session notices (e.g. when range changes). */
  resetNotices(): void {
    this.noticedLevelsThisSession.clear()
  }
}
