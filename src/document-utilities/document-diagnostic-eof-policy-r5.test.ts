// @vitest-environment node
/**
 * EOF-R5 — EOF-15：文末空行统计必须与「内部间距」独立。
 *
 * 代码块/公式块内部的空行、正文段落之间的空行都不得计入 EOF 尾随空行；
 * CRLF 与 LF 使用同一套计数规则。
 */
import { describe, it, expect } from 'vitest'
import { computeEofNewlinePolicy } from './document-diagnostics'

describe('EOF-15 — EOF 只统计最后一个内容块之后的空行', () => {
  it('围栏代码块内部的空行不计入 EOF（闭合围栏后 1 行合法）', () => {
    const policy = computeEofNewlinePolicy('# T\n\n```\na\n\n\nb\n```\n\n')
    expect(policy.hasTerminalNewline).toBe(true)
    expect(policy.extraTrailingBlankLineCount).toBe(1)
    expect(policy.verdict).toBe('PASS')
  })

  it('显示公式块内部的空行不计入 EOF（闭合 $$ 后 1 行合法）', () => {
    const policy = computeEofNewlinePolicy('# T\n\n$$\na\n\n\nb\n$$\n\n')
    expect(policy.hasTerminalNewline).toBe(true)
    expect(policy.extraTrailingBlankLineCount).toBe(1)
    expect(policy.verdict).toBe('PASS')
  })

  it('正文段落之间的空行不计入 EOF', () => {
    const policy = computeEofNewlinePolicy('# T\n\n甲\n\n\n\n乙\n\n')
    expect(policy.extraTrailingBlankLineCount).toBe(1)
    expect(policy.verdict).toBe('PASS')
  })

  it('CRLF 使用同一计数规则（尾随 2 行 ⇒ EXCESSIVE）', () => {
    const policy = computeEofNewlinePolicy('# T\r\n\r\ncontent\r\n\r\n\r\n')
    expect(policy.hasTerminalNewline).toBe(true)
    expect(policy.terminalNewlineCount).toBe(3)
    expect(policy.extraTrailingBlankLineCount).toBe(2)
    expect(policy.verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES')
  })
})
