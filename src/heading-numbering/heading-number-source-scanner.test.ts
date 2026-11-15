import { describe, it, expect } from 'vitest'
import {
  canonicalNumberLabel,
  isRewritableHeadingNumber,
  scanHeadingNumber,
  scanHeadingNumberPrefix,
  stripHeadingNumberPrefixes,
} from './heading-number-source-scanner'

describe('R08 — existing heading number scanner', () => {
  it('recognises a verified decimal prefix', () => {
    const result = scanHeadingNumber('1.2 研究背景', { expectedLabel: '1.2' })
    expect(result.first?.numberText).toBe('1.2')
    expect(result.first?.confidence).toBe('verified')
    expect(result.first?.matchesExpected).toBe(true)
    expect(result.title).toBe('研究背景')
  })

  it('recognises a structural decimal prefix that does not match the expected label', () => {
    const result = scanHeadingNumber('1.1 研究背景', { expectedLabel: '1.2' })
    expect(result.first?.confidence).toBe('structural')
    expect(result.first?.matchesExpected).toBe(false)
    expect(isRewritableHeadingNumber(result.first)).toBe(true)
    expect(result.title).toBe('研究背景')
  })

  it('recognises Chinese chapter / outline / parenthesised forms', () => {
    expect(scanHeadingNumber('第一章 绪论').first?.numberText).toBe('第一章')
    expect(scanHeadingNumber('一、研究背景').first?.format).toBe('chinese-outline')
    expect(scanHeadingNumber('（一）研究背景').first?.format).toBe('chinese-parenthesized')
    expect(scanHeadingNumber('（1）研究背景').first?.format).toBe('chinese-parenthesized')
    expect(scanHeadingNumber('附录A 补充材料').first?.format).toBe('appendix')
  })

  it('recognises roman and alphabetic forms only with a delimiter', () => {
    const roman = scanHeadingNumber('III. 方法', { expectedLabel: 'III' })
    expect(roman.first?.format).toBe('roman')
    expect(roman.first?.confidence).toBe('verified')

    const alpha = scanHeadingNumber('A. 方法', { expectedLabel: 'A' })
    expect(alpha.first?.format).toBe('alpha')
    expect(alpha.first?.confidence).toBe('verified')
  })

  it('does not treat English prose as a roman number', () => {
    const result = scanHeadingNumber('I think this is fine')
    expect(result.first).toBeNull()
  })

  it('protects 2026 年研究报告 (weak, never auto-rewritten)', () => {
    const result = scanHeadingNumber('2026 年研究报告', { expectedLabel: '1' })
    expect(result.first?.confidence).toBe('weak')
    expect(isRewritableHeadingNumber(result.first)).toBe(false)
    expect(result.title).toBe('2026 年研究报告')
  })

  it('protects 3D 建模技术 and 第三代人工智能', () => {
    expect(scanHeadingNumber('3D 建模技术').first).toBeNull()
    expect(scanHeadingNumber('第三代人工智能').first).toBeNull()
  })

  it('protects date-like prefixes', () => {
    expect(scanHeadingNumber('2026.11.16 报告').first).toBeNull()
  })

  it('never strips a heading that is only a number', () => {
    expect(scanHeadingNumber('1.1').first).toBeNull()
  })

  it('detects double numbering and strips every confirmed prefix', () => {
    const result = scanHeadingNumber('1.1 1.1 研究背景', { expectedLabel: '1.1' })
    expect(result.first?.numberText).toBe('1.1')
    expect(result.extra).toHaveLength(1)
    expect(result.title).toBe('研究背景')
  })

  it('supports a custom template prefix/suffix', () => {
    const result = scanHeadingNumber('课题2部分 研究背景', {
      expectedLabel: '课题1部分',
      templatePrefix: '课题',
      templateSuffix: '部分',
    })
    expect(result.first?.format).toBe('custom')
    expect(result.first?.confidence).toBe('structural')
    expect(result.title).toBe('研究背景')
  })

  it('canonicalises fullwidth digits and whitespace', () => {
    expect(canonicalNumberLabel('１．２ ')).toBe('1.2')
    expect(canonicalNumberLabel('第 一 章')).toBe('第一章')
  })

  it('stripHeadingNumberPrefixes leaves clean titles untouched', () => {
    expect(stripHeadingNumberPrefixes('研究背景')).toBe('研究背景')
    expect(scanHeadingNumberPrefix('研究背景')).toBeNull()
  })
})
