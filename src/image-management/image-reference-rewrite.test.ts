import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import {
  relativeMarkdownImagePath,
  rewriteReferenceDestination,
  selectMarkdownImageReference,
} from './image-reference-rewrite'

const DOC = path.resolve('D:/vault/note/doc.md')

describe('selectMarkdownImageReference', () => {
  it('selects the reference by destination and occurrence, not alt or filename', () => {
    const markdown = [
      '# 标题',
      '',
      '![第一张](https://cdn.example.test/a.png)',
      '',
      '![第二张](https://cdn.example.test/a.png)',
      '',
      '正文',
    ].join('\n')

    const first = selectMarkdownImageReference({
      markdown,
      documentPath: DOC,
      rawDestinations: ['https://cdn.example.test/a.png'],
      occurrenceIndex: 0,
    })
    const second = selectMarkdownImageReference({
      markdown,
      documentPath: DOC,
      rawDestinations: ['https://cdn.example.test/a.png'],
      occurrenceIndex: 1,
    })

    expect(first.reference?.altText).toBe('第一张')
    expect(second.reference?.altText).toBe('第二张')
    expect(first.reference?.destinationStart).not.toBe(second.reference?.destinationStart)
  })

  it('returns null when the reference is missing', () => {
    const result = selectMarkdownImageReference({
      markdown: '![x](https://cdn.example.test/other.png)',
      documentPath: DOC,
      rawDestinations: ['https://cdn.example.test/a.png'],
      occurrenceIndex: 0,
    })
    expect(result.reference).toBeNull()
    expect(result.reason).toBe('NO_REFERENCE')
  })

  it('blocks rewriting a shared reference-style definition', () => {
    const markdown = [
      '![甲][img]',
      '',
      '![乙][img]',
      '',
      '[img]: https://cdn.example.test/a.png',
    ].join('\n')
    const result = selectMarkdownImageReference({
      markdown,
      documentPath: DOC,
      rawDestinations: ['https://cdn.example.test/a.png'],
      occurrenceIndex: 0,
    })
    expect(result.reference).toBeNull()
    expect(result.reason).toBe('SHARED_REFERENCE_DEFINITION')
  })
})

describe('rewriteReferenceDestination', () => {
  it('replaces only the destination and keeps alt, title and surrounding text', () => {
    const markdown = [
      '# 标题',
      '',
      '![图 1 架构图](https://cdn.example.test/a.png "图名")',
      '',
      '正文保持不变。',
    ].join('\n')
    const selection = selectMarkdownImageReference({
      markdown,
      documentPath: DOC,
      rawDestinations: ['https://cdn.example.test/a.png'],
      occurrenceIndex: 0,
    })
    expect(selection.reference).toBeTruthy()
    const next = rewriteReferenceDestination(
      markdown,
      selection.reference!,
      'assets/images/a.png',
    )
    expect(next).toBe([
      '# 标题',
      '',
      '![图 1 架构图](assets/images/a.png "图名")',
      '',
      '正文保持不变。',
    ].join('\n'))
  })

  it('wraps destinations containing spaces for Markdown but not for HTML img', () => {
    const markdown = '![x](https://cdn.example.test/a.png)\n\n<img src="https://cdn.example.test/b.png" alt="y">'
    const first = selectMarkdownImageReference({
      markdown,
      documentPath: DOC,
      rawDestinations: ['https://cdn.example.test/a.png'],
      occurrenceIndex: 0,
    })
    const rewritten = rewriteReferenceDestination(markdown, first.reference!, 'assets/my image.png')
    expect(rewritten).toContain('![x](<assets/my image.png>)')

    const second = selectMarkdownImageReference({
      markdown: rewritten ?? markdown,
      documentPath: DOC,
      rawDestinations: ['https://cdn.example.test/b.png'],
      occurrenceIndex: 0,
    })
    const html = rewriteReferenceDestination(
      rewritten ?? markdown,
      second.reference!,
      'assets/my image b.png',
    )
    expect(html).toContain('<img src="assets/my image b.png" alt="y">')
  })

  it('produces readable relative Markdown paths', () => {
    const file = path.resolve('D:/vault/note/assets/images/a.png')
    expect(relativeMarkdownImagePath(DOC, file)).toBe('assets/images/a.png')
  })
})
