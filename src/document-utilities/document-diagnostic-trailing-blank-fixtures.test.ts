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

/**
 * ROOT_EOF_TEXT_SOURCE — runtime evidence 2026-11-12 (real Typora 1.6.7 GUI).
 *
 * `UserOp.getMarkdownSourceFrom` is BLOCK-level: it drops the file's terminal
 * line break in WYSIWYG (`# 干净文档\n\n正文。\n` → `# 干净文档\n\n正文。`) and adds
 * one in source view. Because the EOF policy read that serialization, EVERY
 * clean document was reported as `DOCUMENT_TERMINAL_NEWLINE_MISSING`, and the
 * trailing-blank excess count was distorted. The EOF verdict must read the
 * TEXT mirror (`eofMarkdown`), while structure/gap rules keep the snapshot.
 */
describe('ROOT_EOF_TEXT_SOURCE — EOF 事实读文本镜像，结构仍读结构化快照', () => {
  const base = {
    documentKey: 'doc', strictMode: true, vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [], h1Facts: null,
  }
  const codesOf = (input: Record<string, unknown>): string[] =>
    computeDocumentDiagnostics(input as never).diagnostics.map(d => d.code)

  it('干净文档（结构化快照丢末尾换行）不得报告缺少末尾换行', () => {
    const codes = codesOf({
      ...base,
      markdown: '# 干净文档\n\n正文。',   // structural serializer (block-level)
      eofMarkdown: '# 干净文档\n\n正文。\n', // real buffer text
    })
    expect(codes).not.toContain('DOCUMENT_TERMINAL_NEWLINE_MISSING')
    expect(codes).not.toContain('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')
  })

  it('文末多余空行数量来自文本镜像（不是被结构化的块序列）', () => {
    const diag = computeDocumentDiagnostics({
      ...base,
      markdown: '# T\n\n正文。',
      eofMarkdown: '# T\n\n正文。\n\n\n',
    } as never).diagnostics.find(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')
    expect(diag).toBeTruthy()
    expect((diag!.metadata as Record<string, unknown>).extraTrailingBlankLineCount).toBe(2)
    expect((diag!.metadata as Record<string, unknown>).terminalNewlineCount).toBe(3)
  })

  it('真正缺少末尾换行（文本镜像也无换行）仍必须报告', () => {
    const codes = codesOf({
      ...base,
      markdown: '# T\n\n正文。',
      eofMarkdown: '# T\n\n正文。',
    })
    expect(codes).toContain('DOCUMENT_TERMINAL_NEWLINE_MISSING')
  })

  it('纯/legacy 调用方未提供 eofMarkdown 时保持 markdown 作为 EOF 源', () => {
    const codes = codesOf({ ...base, markdown: '# T\n\n正文。' })
    expect(codes).toContain('DOCUMENT_TERMINAL_NEWLINE_MISSING')
  })
})
