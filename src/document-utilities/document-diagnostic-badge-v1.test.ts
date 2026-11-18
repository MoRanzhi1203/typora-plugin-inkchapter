/**
 * R14 — 正文诊断徽章展示模型测试（文案 / 聚合 / 排序 / 工具提示）。
 */
import { describe, expect, it } from 'vitest'
import {
  R14_GENERIC_BADGE_LABELS,
  R14_MAX_BADGES_BEFORE_SUMMARY,
  R14_MAX_BADGE_LABEL_CHARS,
  buildDiagnosticBadge,
  buildDiagnosticBadgeSet,
  formatDiagnosticBadgeTooltip,
  isGenericBadgeLabel,
  resolveDiagnosticBadgeLabel,
} from './document-diagnostic-badge-v1'

function badge(overrides: Partial<Parameters<typeof buildDiagnosticBadge>[0]> = {}) {
  return buildDiagnosticBadge({
    diagnosticId: 'd1',
    code: 'HEADING_LEVEL_GAP',
    severity: 'warning',
    message: '标题层级存在跳级（H3 → H5）',
    metadata: { previousLevel: 3, currentLevel: 5, missingLevels: [4] },
    line: 9,
    headingText: '第五节',
    ...overrides,
  })
}

describe('R14 badge copy', () => {
  it('T01 renders the dynamic level-gap label', () => {
    expect(badge().shortLabel).toBe('层级跳级 H3→H5')
  })

  it('T02 maps the sequence anomaly to 编号错序', () => {
    expect(badge({ code: 'HEADING_NUMBER_SEQUENCE_INVALID', severity: 'warning', metadata: {} }).shortLabel).toBe('编号错序')
    expect(badge({ code: 'HEADING_NUMBER_ORDER_ANOMALY', severity: 'error', metadata: {} }).shortLabel).toBe('编号错序')
  })

  it('T03 maps the manual heading number to 手工编号', () => {
    expect(badge({ code: 'HEADING_MANUAL_NUMBER_PREFIX', severity: 'warning', metadata: {} }).shortLabel).toBe('手工编号')
  })

  it('T04 renders the duplicate title with its real text', () => {
    expect(badge({
      code: 'HEADING_DUPLICATE_TEXT',
      severity: 'warning',
      message: '重复的标题文字「第一节」',
      headingText: '第一节',
      metadata: {},
    }).shortLabel).toBe('重复标题：第一节')
  })

  it('T05 never emits a generic category label', () => {
    const codes = [
      'HEADING_LEVEL_GAP',
      'HEADING_DUPLICATE_TEXT',
      'HEADING_MANUAL_NUMBER_PREFIX',
      'HEADING_NUMBER_SEQUENCE_INVALID',
      'HEADING_NUMBER_MISSING',
      'HEADING_NUMBER_FORMAT_INCONSISTENT',
      'HEADING_AUTO_NUMBER_CONFLICT',
      'SECTION_ONLY_SUBHEADINGS',
      'OBJECT_NUMBER_SCOPE_MISSING_LEVEL',
      'HEADING_SOMETHING_NEW',
    ]
    for (const code of codes) {
      const label = resolveDiagnosticBadgeLabel({
        diagnosticId: `id-${code}`,
        code,
        severity: 'warning',
        message: '标题结构需要检查',
        line: 3,
        headingText: '第三节',
      }).label
      expect(R14_GENERIC_BADGE_LABELS).not.toContain(label)
      expect(isGenericBadgeLabel(label)).toBe(false)
    }
  })

  it('T06 tooltip carries the full title, description and real line', () => {
    const text = formatDiagnosticBadgeTooltip(badge())
    expect(text).toContain('标题层级存在跳级')
    expect(text).toContain('标题层级出现跳级')
    expect(text).toContain('L9')
  })

  it('T07 keeps the diagnostic line on the badge', () => {
    expect(badge({ line: 13 }).line).toBe(13)
    expect(formatDiagnosticBadgeTooltip(badge({ line: 13 }))).toContain('L13')
  })

  it('clamps long duplicate titles and keeps the full text in the tooltip', () => {
    const longTitle = '一个非常非常长的重复标题名称'
    const b = badge({
      code: 'HEADING_DUPLICATE_TEXT',
      message: `重复的标题文字「${longTitle}」`,
      headingText: longTitle,
      metadata: {},
    })
    expect(Array.from(b.shortLabel).length).toBeLessThanOrEqual(R14_MAX_BADGE_LABEL_CHARS)
    expect(b.shortLabel.endsWith('…')).toBe(true)
    expect(formatDiagnosticBadgeTooltip(b)).toContain(longTitle)
  })

  it('never exceeds the general label budget', () => {
    const b = badge({ code: 'HEADING_SOMETHING_NEW', message: '一个特别特别特别特别长的诊断标题描述', metadata: {} })
    expect(Array.from(b.shortLabel).length).toBeLessThanOrEqual(R14_MAX_BADGE_LABEL_CHARS)
  })
})

// `重复标题：` prefix (5) + truncated title budget (8) stays within the general
// 16-char badge budget; the full title lives in the tooltip.

describe('R14 badge aggregation', () => {
  it('T08 paints one badge for one problem', () => {
    const set = buildDiagnosticBadgeSet([{ diagnosticId: 'a', code: 'HEADING_LEVEL_GAP', severity: 'warning', metadata: { previousLevel: 3, currentLevel: 5 } }])
    expect(set.visible).toHaveLength(1)
    expect(set.summary).toBeNull()
  })

  it('T09 paints two badges for two problems', () => {
    const set = buildDiagnosticBadgeSet([
      { diagnosticId: 'a', code: 'HEADING_LEVEL_GAP', severity: 'warning', metadata: { previousLevel: 3, currentLevel: 5 } },
      { diagnosticId: 'b', code: 'HEADING_MANUAL_NUMBER_PREFIX', severity: 'warning', metadata: {} },
    ])
    expect(set.visible.map(b => b.shortLabel)).toEqual(['层级跳级 H3→H5', '手工编号'])
    expect(set.summary).toBeNull()
  })

  it('T10 paints two + "+1" for three problems', () => {
    const set = buildDiagnosticBadgeSet([
      { diagnosticId: 'a', code: 'HEADING_LEVEL_GAP', severity: 'warning', metadata: { previousLevel: 3, currentLevel: 5 } },
      { diagnosticId: 'b', code: 'HEADING_MANUAL_NUMBER_PREFIX', severity: 'warning', metadata: {} },
      { diagnosticId: 'c', code: 'HEADING_NUMBER_SEQUENCE_INVALID', severity: 'warning', metadata: {} },
    ])
    expect(set.visible).toHaveLength(2)
    expect(set.summary).toEqual({ kind: 'summary', label: '+1', count: 1 })
  })

  it('T11 paints two + "+2" for four problems', () => {
    const set = buildDiagnosticBadgeSet([
      { diagnosticId: 'a', code: 'HEADING_LEVEL_GAP', severity: 'warning', metadata: { previousLevel: 3, currentLevel: 5 } },
      { diagnosticId: 'b', code: 'HEADING_MANUAL_NUMBER_PREFIX', severity: 'warning', metadata: {} },
      { diagnosticId: 'c', code: 'HEADING_NUMBER_SEQUENCE_INVALID', severity: 'warning', metadata: {} },
      { diagnosticId: 'd', code: 'HEADING_DUPLICATE_TEXT', severity: 'warning', message: '重复的标题文字「第一节」' },
    ])
    expect(set.visible).toHaveLength(2)
    expect(set.summary?.label).toBe('+2')
  })

  it('T12 orders by priority, then severity, then stable rule id', () => {
    const set = buildDiagnosticBadgeSet([
      { diagnosticId: 'dup', code: 'HEADING_DUPLICATE_TEXT', severity: 'warning', message: '重复的标题文字「第一节」' },
      { diagnosticId: 'manual', code: 'HEADING_MANUAL_NUMBER_PREFIX', severity: 'warning' },
      { diagnosticId: 'gap', code: 'HEADING_LEVEL_GAP', severity: 'warning', metadata: { previousLevel: 3, currentLevel: 5 } },
      { diagnosticId: 'order', code: 'HEADING_NUMBER_SEQUENCE_INVALID', severity: 'warning' },
    ])
    expect(set.visible.map(b => b.shortLabel)).toEqual(['层级跳级 H3→H5', '编号错序'])
    // identical input in a different order must produce the same badges
    const reversed = buildDiagnosticBadgeSet([
      { diagnosticId: 'order', code: 'HEADING_NUMBER_SEQUENCE_INVALID', severity: 'warning' },
      { diagnosticId: 'gap', code: 'HEADING_LEVEL_GAP', severity: 'warning', metadata: { previousLevel: 3, currentLevel: 5 } },
      { diagnosticId: 'dup', code: 'HEADING_DUPLICATE_TEXT', severity: 'warning', message: '重复的标题文字「第一节」' },
      { diagnosticId: 'manual', code: 'HEADING_MANUAL_NUMBER_PREFIX', severity: 'warning' },
    ])
    expect(reversed.all.map(b => b.diagnosticId)).toEqual(set.all.map(b => b.diagnosticId))
  })

  it('T13 deduplicates the same visible problem (sequence + order anomaly)', () => {
    const set = buildDiagnosticBadgeSet([
      { diagnosticId: 'a', code: 'HEADING_NUMBER_SEQUENCE_INVALID', severity: 'warning' },
      { diagnosticId: 'b', code: 'HEADING_NUMBER_ORDER_ANOMALY', severity: 'error' },
    ])
    expect(set.all).toHaveLength(1)
    expect(set.summary).toBeNull()
  })

  it('does NOT merge two same-label problems with different target identities', () => {
    const set = buildDiagnosticBadgeSet([
      { diagnosticId: 'a', code: 'HEADING_MANUAL_NUMBER_PREFIX', severity: 'warning', targetIdentity: 'heading:H1' },
      { diagnosticId: 'b', code: 'HEADING_MANUAL_NUMBER_PREFIX', severity: 'warning', targetIdentity: 'heading:H2' },
    ])
    expect(set.all).toHaveLength(2)
    expect(set.visible).toHaveLength(2)
    expect(set.summary).toBeNull()
  })

  it('T14 keeps different real problems apart', () => {
    const set = buildDiagnosticBadgeSet([
      { diagnosticId: 'a', code: 'HEADING_LEVEL_GAP', severity: 'warning', metadata: { previousLevel: 3, currentLevel: 5 } },
      { diagnosticId: 'b', code: 'HEADING_MANUAL_NUMBER_PREFIX', severity: 'warning' },
      { diagnosticId: 'c', code: 'HEADING_DUPLICATE_TEXT', severity: 'warning', message: '重复的标题文字「第一节」' },
    ])
    expect(set.all.map(b => b.shortLabel)).toEqual(['层级跳级 H3→H5', '手工编号', '重复标题：第一节'])
  })

  it('T15 keeps the same title on different headings independent', () => {
    const a = buildDiagnosticBadgeSet([{ diagnosticId: 'a', code: 'HEADING_DUPLICATE_TEXT', severity: 'warning', message: '重复的标题文字「第一节」' }])
    const b = buildDiagnosticBadgeSet([{ diagnosticId: 'b', code: 'HEADING_DUPLICATE_TEXT', severity: 'warning', message: '重复的标题文字「第一节」' }])
    expect(a.visible).toHaveLength(1)
    expect(b.visible).toHaveLength(1)
    expect(a.visible[0].diagnosticId).toBe('a')
    expect(b.visible[0].diagnosticId).toBe('b')
  })

  it('summary count never includes a deduplicated generic copy', () => {
    const set = buildDiagnosticBadgeSet([
      { diagnosticId: 'gap', code: 'HEADING_LEVEL_GAP', severity: 'warning', metadata: { previousLevel: 3, currentLevel: 5 } },
      { diagnosticId: 'order1', code: 'HEADING_NUMBER_SEQUENCE_INVALID', severity: 'warning' },
      { diagnosticId: 'order2', code: 'HEADING_NUMBER_ORDER_ANOMALY', severity: 'error' },
      { diagnosticId: 'manual', code: 'HEADING_MANUAL_NUMBER_PREFIX', severity: 'warning' },
    ])
    expect(set.all).toHaveLength(3)
    expect(set.summary?.count).toBe(1)
  })

  it('max visible badges before summary stays 2', () => {
    expect(R14_MAX_BADGES_BEFORE_SUMMARY).toBe(2)
  })
})
