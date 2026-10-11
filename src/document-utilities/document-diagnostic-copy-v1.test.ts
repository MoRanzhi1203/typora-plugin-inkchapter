import { describe, it, expect } from 'vitest'
import {
  DOCUMENT_DIAGNOSTIC_COPY_TABLE,
  DOCUMENT_DIAGNOSTIC_RULE_PRIORITY,
  DOCUMENT_DIAGNOSTIC_RULE_PRIORITY_FALLBACK,
  isRedundantDiagnosticCopy,
  normalizeDiagnosticText,
  resolveDiagnosticCopy,
  resolveRulePriority,
  resolveSeverityLabel,
} from './document-diagnostic-copy-v1'
import { INTERNAL_BLANK_LINE_POLICY } from './document-diagnostic-internal-blank-lines-v1'
import { DOCUMENT_DIAGNOSTIC_RULE_REGISTRY } from './document-diagnostic-location'
import { buildDiagnosticPresentation } from './document-diagnostic-inline-presentation-v514-r5'

describe('copy V1 — terminology / text normalization', () => {
  it('strips a leading severity glyph and classification prefix', () => {
    expect(normalizeDiagnosticText('⚠ 严格模式结构错误：文档必须以一级标题开始 H1 前存在正文内容'))
      .toBe('严格模式结构错误：文档必须以一级标题开始 H1 前存在正文内容')
    expect(normalizeDiagnosticText('警告：文档末尾缺少换行符')).toBe('文档末尾缺少换行符')
  })

  it('collapses newlines and repeated whitespace into one line', () => {
    expect(normalizeDiagnosticText('第一行\n  第二行')).toBe('第一行 第二行')
    expect(normalizeDiagnosticText('a   b')).toBe('a b')
    expect(normalizeDiagnosticText(null)).toBe('')
  })
})

describe('copy V1 — severity label', () => {
  it('maps internal info to hint, never a 4th level', () => {
    expect(resolveSeverityLabel('error')).toBe('错误')
    expect(resolveSeverityLabel('warning')).toBe('警告')
    expect(resolveSeverityLabel('info')).toBe('提示')
    expect(resolveSeverityLabel('hint')).toBe('提示')
    expect(resolveSeverityLabel(null)).toBe('提示')
  })
})

describe('copy V1 — stable rule priority', () => {
  it('orders document-state before format before heading before objects', () => {
    expect(resolveRulePriority('DOCUMENT_EMPTY')).toBeLessThan(resolveRulePriority('EXCESSIVE_INTERNAL_BLANK_LINES'))
    expect(resolveRulePriority('EXCESSIVE_INTERNAL_BLANK_LINES')).toBeLessThan(resolveRulePriority('HEADING_LEVEL_GAP'))
    expect(resolveRulePriority('HEADING_LEVEL_GAP')).toBeLessThan(resolveRulePriority('FIGURE_MISSING_NAME'))
    expect(resolveRulePriority('FIGURE_MISSING_NAME')).toBeLessThan(resolveRulePriority('TABLE_MISSING_NAME'))
    expect(resolveRulePriority('TABLE_MISSING_NAME')).toBeLessThan(resolveRulePriority('LINK_TEXT_EMPTY'))
  })

  it('is prefix-aware for the dynamic families', () => {
    expect(resolveRulePriority('LATENT_ATX_HEADING_MARKER_LEVEL_2'))
      .toBe(DOCUMENT_DIAGNOSTIC_RULE_PRIORITY.LATENT_ATX_HEADING_MARKER)
    expect(resolveRulePriority('STRICT_FIRST_H1_LEADING_PARAGRAPH'))
      .toBe(DOCUMENT_DIAGNOSTIC_RULE_PRIORITY.STRICT_FIRST_H1_POSITION)
  })

  it('falls back deterministically for an unknown code', () => {
    expect(resolveRulePriority('TOTALLY_UNKNOWN')).toBe(DOCUMENT_DIAGNOSTIC_RULE_PRIORITY_FALLBACK)
  })
})

describe('copy V1 — canonical title / description / suggestion', () => {
  it('uses the static canonical title when defined', () => {
    const copy = resolveDiagnosticCopy({ code: 'DOCUMENT_EMPTY', message: '文档为空' })
    expect(copy.title).toBe('文档为空')
    expect(copy.description).not.toBe('')
    expect(copy.suggestion).not.toBe('')
  })

  it('keeps a DYNAMIC title from the message when no static title exists', () => {
    const copy = resolveDiagnosticCopy({
      code: 'FIGURE_DUPLICATE_NAME',
      message: '重复的图名「A」',
      detail: '多张图片使用相同图名。',
    })
    expect(copy.title).toBe('重复的图名「A」')
    expect(copy.description).toBe('多张图片使用了相同的图名。')
    expect(copy.suggestion).toBe('修改图名以互相区分。')
  })

  it('normalizes a severity-prefixed message title', () => {
    const copy = resolveDiagnosticCopy({ code: 'UNKNOWN_RULE', message: '警告：随便一句话' })
    expect(copy.title).toBe('随便一句话')
  })
})

describe('copy V1 — coverage cannot drift', () => {
  it('every REGISTERED rule family has a copy spec (static or dynamic)', () => {
    const missing = Object.keys(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY)
      .filter(id => DOCUMENT_DIAGNOSTIC_COPY_TABLE[id] == null)
    expect(missing).toEqual([])
  })

  it('every copy spec is non-empty and single-line', () => {
    for (const [code, spec] of Object.entries(DOCUMENT_DIAGNOSTIC_COPY_TABLE)) {
      expect(spec.description.trim(), code).not.toBe('')
      expect(spec.suggestion.trim(), code).not.toBe('')
      if (spec.title != null) expect(spec.title).not.toContain('\n')
      expect(spec.description).not.toContain('\n')
    }
  })

  it('every REGISTERED rule family has a stable priority', () => {
    const missing = Object.keys(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY)
      .filter(id => DOCUMENT_DIAGNOSTIC_RULE_PRIORITY[id] == null)
    expect(missing).toEqual([])
  })
})

describe('copy V1 — the Drawer presentation consumes the copy authority', () => {
  it('normalizes a legacy severity-prefixed title and adds the fix advice', () => {
    const p = buildDiagnosticPresentation({
      code: 'DOCUMENT_TERMINAL_NEWLINE_MISSING',
      severity: 'warning',
      message: '警告：文档末尾缺少换行符',
      detail: 'Markdown 文档应以一个换行符结束。',
    })
    expect(p.drawerTitle).toBe('文档末尾缺少换行符')
    expect(p.drawerSuggestion).toBe('在文档末尾补充一个换行符。')
  })

  it('keeps the frozen strict-H1 per-code Drawer title', () => {
    const p = buildDiagnosticPresentation({
      code: 'STRICT_FIRST_H1_LEADING_PARAGRAPH',
      severity: 'error',
      message: '⚠ 严格模式结构错误：文档必须以一级标题开始\nH1 前存在正文内容',
    })
    expect(p.drawerTitle).toBe('H1 前存在正文')
    expect(p.drawerDetail).toContain('严格模式结构错误')
  })

  it('exposes a suggestion for every registered family', () => {
    for (const id of Object.keys(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY)) {
      const p = buildDiagnosticPresentation({ code: id, message: 'm', detail: 'd' })
      expect(p.drawerSuggestion, id).not.toBeNull()
    }
  })
})

describe('copy V1 — 说明与修复建议不得语义重复', () => {
  it('no rule pairs a description with a redundant suggestion', () => {
    for (const [code, spec] of Object.entries(DOCUMENT_DIAGNOSTIC_COPY_TABLE)) {
      expect(isRedundantDiagnosticCopy(spec.description, spec.suggestion), code).toBe(false)
    }
  })

  it('isRedundantDiagnosticCopy detects equality / containment, keeps distinct advice', () => {
    expect(isRedundantDiagnosticCopy('当前两个内容块之间存在 3 个连续空行。', '当前两个内容块之间存在3个连续空行')).toBe(true)
    expect(isRedundantDiagnosticCopy('建议为图片命名。', '为图片补充图名，避免与其他图混淆。')).toBe(false)
    expect(isRedundantDiagnosticCopy('', '任何建议')).toBe(false)
    expect(isRedundantDiagnosticCopy(null, null)).toBe(false)
  })
})

describe('copy V1 — 内部空行阈值与文案一致', () => {
  it('EXCESSIVE_INTERNAL_BLANK_LINES 的说明采用策略阈值（2），不是硬编码 3', () => {
    const spec = DOCUMENT_DIAGNOSTIC_COPY_TABLE.EXCESSIVE_INTERNAL_BLANK_LINES
    expect(INTERNAL_BLANK_LINE_POLICY.warningThreshold).toBe(2)
    expect(spec.description).toContain(`${INTERNAL_BLANK_LINE_POLICY.warningThreshold} 个及以上`)
    expect(spec.description).not.toContain('3 个及以上')
  })
})
