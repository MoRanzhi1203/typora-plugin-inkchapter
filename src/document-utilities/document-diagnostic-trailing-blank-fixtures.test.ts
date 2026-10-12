/**
 * 原设计要求 B — 文档尾部多余空行的专用 fixture（0 / 1 / 2 / 3 行）。
 *
 * 末尾空行语义（既有规则，冻结，不在本次修改）：
 *   最后一个非空内容之后 1 个空行为合规；0 → 缺末尾换行；2+ → 尾部空行过多。
 *
 * 这里只验证「0/1/2/3 行」四份真实 Markdown fixture 上既有判定正确
 * （不修改规则、不修改 Markdown 语义），保证尾部标记方案有可复现输入。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeDocumentDiagnostics, computeEofNewlinePolicy } from './document-diagnostics'
import { DOCUMENT_END_TRAILING_BLANK_MIN_EXCESS } from './document-diagnostic-document-end-newline-marker-v1'

const readFixture = (n: number): string =>
  readFileSync(resolve(process.cwd(), `test/vault/runtime/Document-Diagnostics-Trailing-Blank-${n}.md`), 'utf8')

describe('原设计要求 B — 尾部多余空行 0/1/2/3 fixture', () => {
  it('0 与 1 个尾部空行合规（PASS）', () => {
    expect(computeEofNewlinePolicy(readFixture(0))).toMatchObject({
      verdict: 'PASS', hasTerminalNewline: true, extraTrailingBlankLineCount: 0,
    })
    expect(computeEofNewlinePolicy(readFixture(1))).toMatchObject({
      verdict: 'PASS', hasTerminalNewline: true, extraTrailingBlankLineCount: 1,
    })
  })

  it('2 与 3 个尾部空行为 EXCESSIVE（警告）', () => {
    expect(computeEofNewlinePolicy(readFixture(2))).toMatchObject({
      verdict: 'EXCESSIVE_TRAILING_BLANK_LINES', extraTrailingBlankLineCount: 2,
    })
    expect(computeEofNewlinePolicy(readFixture(3))).toMatchObject({
      verdict: 'EXCESSIVE_TRAILING_BLANK_LINES', extraTrailingBlankLineCount: 3,
    })
  })

  it('缺少末尾换行（0 行且无终止换行）仍归 MISSING_TERMINAL_NEWLINE', () => {
    expect(computeEofNewlinePolicy('# T\n\n正文结束。')).toMatchObject({
      verdict: 'MISSING_TERMINAL_NEWLINE', hasTerminalNewline: false,
    })
  })

  it('SOURCE_REVISION_SYNC — 缺末尾换行的诊断记录携带 terminalNewlineCount（视觉层不得读 null）', () => {
    const input = {
      documentKey: 'doc', markdown: '# T\n\n正文结束。', strictMode: true, vaultRoot: '/vault',
      headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
      canonicalDuplicateIdentities: [], captionDuplicateNames: [], h1Facts: null,
    }
    const d = computeDocumentDiagnostics(input as never).diagnostics
      .find(x => x.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING')
    expect(d).toBeTruthy()
    expect(typeof (d!.metadata as Record<string, unknown>).terminalNewlineCount).toBe('number')
  })

  it('10 个尾部空行为 EXCESSIVE，数量与范围准确', () => {
    const p = computeEofNewlinePolicy('# T\n\n正文。\n' + '\n'.repeat(10))
    expect(p.verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES')
    expect(p.extraTrailingBlankLineCount).toBe(10)
    expect(p.terminalNewlineCount).toBe(11)
  })

  it('检测 / 视觉 / 标记共享单一阈值 DOCUMENT_END_TRAILING_BLANK_MIN_EXCESS', () => {
    expect(DOCUMENT_END_TRAILING_BLANK_MIN_EXCESS).toBe(2)
    expect(computeEofNewlinePolicy('# T\n\n正文。\n').verdict).toBe('PASS')
    const excess = computeEofNewlinePolicy('# T\n' + '\n'.repeat(DOCUMENT_END_TRAILING_BLANK_MIN_EXCESS))
    expect(excess.verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES')
    expect(excess.extraTrailingBlankLineCount).toBe(DOCUMENT_END_TRAILING_BLANK_MIN_EXCESS)
  })

  it('正文空行与文末空行同时存在：文末判定只看最后一个非空内容之后', () => {
    const p = computeEofNewlinePolicy('# T\n\n甲\n\n\n乙\n\n\n')
    expect(p.verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES')
    expect(p.extraTrailingBlankLineCount).toBe(2)
  })

  it('CRLF 与无终止换行的组合判定', () => {
    expect(computeEofNewlinePolicy('a\r\n')).toMatchObject({ verdict: 'PASS', hasTerminalNewline: true })
    expect(computeEofNewlinePolicy('a\r\n\r\n\r\n')).toMatchObject({
      verdict: 'EXCESSIVE_TRAILING_BLANK_LINES', extraTrailingBlankLineCount: 2,
    })
    expect(computeEofNewlinePolicy('a\r\nb')).toMatchObject({ verdict: 'MISSING_TERMINAL_NEWLINE' })
  })
})
