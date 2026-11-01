/**
 * 内容块工具栏 — 围栏源文本解析测试。
 * 语义基准：Typora CodeMirror `getValue()`（不含围栏/语言串/末尾换行）。
 */
import { describe, it, expect } from 'vitest'
import { lookupFenceSource, parseFencedCodeBlocks } from './content-block-toolbar-code-source'

describe('CONTENT-TOOLBAR-CODE-SOURCE parse', () => {
  it('extracts source text without fences and info string', () => {
    const md = ['```js', 'const a = 1', '  return a', '```'].join('\n')
    const [block] = parseFencedCodeBlocks(md)
    expect(block.info).toBe('js')
    expect(block.text).toBe('const a = 1\n  return a')
    expect(block.closed).toBe(true)
  })

  it('preserves leading spaces, tabs, blank lines and unicode', () => {
    const md = ['```', '\tindent-tab', '', '    four spaces', '中文 · ✓', '```'].join('\n')
    const [block] = parseFencedCodeBlocks(md)
    expect(block.text).toBe('\tindent-tab\n\n    four spaces\n中文 · ✓')
  })

  it('handles an empty block', () => {
    const md = ['```', '```'].join('\n')
    const [block] = parseFencedCodeBlocks(md)
    expect(block.text).toBe('')
  })

  it('handles a block whose content ends with a blank line', () => {
    const md = ['```', 'a', '', '```'].join('\n')
    const [block] = parseFencedCodeBlocks(md)
    expect(block.text).toBe('a\n')
  })

  it('supports tilde fences and longer closing fences', () => {
    const md = ['~~~python print', 'x = 1', '~~~~'].join('\n')
    const [block] = parseFencedCodeBlocks(md)
    expect(block.info).toBe('python print')
    expect(block.text).toBe('x = 1')
  })

  it('does not treat a backtick fence with backticks in the info string as an opener', () => {
    const md = ['```a`b', 'x', '```'].join('\n')
    const blocks = parseFencedCodeBlocks(md)
    // 第 1 行不是围栏；第 3 行才是真正的开始围栏（未闭合）。
    expect(blocks).toHaveLength(1)
    expect(blocks[0].lineStart).toBe(2)
    expect(blocks[0].closed).toBe(false)
  })

  it('parses an unterminated fence to the end of the document', () => {
    const md = ['```js', 'x', 'y'].join('\n')
    const [block] = parseFencedCodeBlocks(md)
    expect(block.closed).toBe(false)
    expect(block.text).toBe('x\ny')
  })

  it('does not produce a phantom trailing line for an unterminated fence', () => {
    const md = '```js\nx\n'
    const [block] = parseFencedCodeBlocks(md)
    expect(block.text).toBe('x')
  })

  it('normalizes CRLF content to LF (CodeMirror convention)', () => {
    const md = '```\r\na\r\nb\r\n```\r\n'
    const [block] = parseFencedCodeBlocks(md)
    expect(block.text).toBe('a\nb')
  })

  it('keeps multiple fences in document order', () => {
    const md = ['```js', 'one', '```', '', '```ts', 'two', '```'].join('\n')
    const blocks = parseFencedCodeBlocks(md)
    expect(blocks.map((b) => b.text)).toEqual(['one', 'two'])
  })
})

describe('CONTENT-TOOLBAR-CODE-SOURCE lookup', () => {
  it('looks up by DOM ordinal and distinguishes "not found" from empty text', () => {
    const md = ['```', '```', '', '```js', 'code', '```'].join('\n')
    expect(lookupFenceSource(md, 0)).toMatchObject({ found: true, text: '' })
    expect(lookupFenceSource(md, 1)).toMatchObject({ found: true, text: 'code' })
    expect(lookupFenceSource(md, 9)).toMatchObject({ found: false, text: null })
    expect(lookupFenceSource(md, -1).found).toBe(false)
  })

  it('indented fences inside a list still resolve', () => {
    const md = ['- item', '', '  ```js', '  indented', '  ```'].join('\n')
    const [block] = parseFencedCodeBlocks(md)
    expect(block?.text).toBe('indented')
  })
})
