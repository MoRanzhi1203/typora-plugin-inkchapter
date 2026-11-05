import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import {
  applyReferenceDestination,
  relativeMarkdownImagePath,
  rewriteReferenceDestination,
  selectMarkdownImageReference,
} from './image-reference-rewrite'
import { IMAGE_DOWNLOAD_MENU_LABEL } from './image-context-menu-download'

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

describe('applyReferenceDestination', () => {
  it('returns ALREADY_LINKED (and no content change) when the reference is already correct', () => {
    const markdown = '![图 1 架构图](assets/images/a.png "图名")\n\n正文保持不变。\n'
    const selection = selectMarkdownImageReference({
      markdown,
      documentPath: DOC,
      rawDestinations: ['assets/images/a.png'],
      occurrenceIndex: 0,
    })
    expect(selection.reference).toBeTruthy()
    const outcome = applyReferenceDestination(markdown, selection.reference!, 'assets/images/a.png')
    expect(outcome?.kind).toBe('ALREADY_LINKED')
    // 已正确时正文一字不改：不产生无意义的撤销步骤。
    expect(outcome?.markdown).toBe(markdown)
  })

  it('returns REWRITTEN and only replaces the destination', () => {
    const markdown = '![图 1 架构图](https://cdn.example.test/a.png "图名")\n\n正文保持不变。\n'
    const selection = selectMarkdownImageReference({
      markdown,
      documentPath: DOC,
      rawDestinations: ['https://cdn.example.test/a.png'],
      occurrenceIndex: 0,
    })
    const outcome = applyReferenceDestination(markdown, selection.reference!, 'assets/images/a.png')
    expect(outcome?.kind).toBe('REWRITTEN')
    expect(outcome?.markdown).toBe('![图 1 架构图](assets/images/a.png "图名")\n\n正文保持不变。\n')
    // alt / 图名 / 正文全部保留。
    expect(outcome?.markdown).toContain('![图 1 架构图]')
    expect(outcome?.markdown).toContain('"图名"')
    expect(outcome?.markdown).toContain('正文保持不变。')
  })

  it('rewrites two identical destinations independently by occurrence ordinal', () => {
    const markdown = [
      '# 标题',
      '',
      '![](https://cdn.example.test/repeated.png)',
      '',
      '![](https://cdn.example.test/repeated.png)',
      '',
      '正文',
    ].join('\n')

    const first = selectMarkdownImageReference({
      markdown,
      documentPath: DOC,
      rawDestinations: ['https://cdn.example.test/repeated.png'],
      occurrenceIndex: 0,
    })
    const second = selectMarkdownImageReference({
      markdown,
      documentPath: DOC,
      rawDestinations: ['https://cdn.example.test/repeated.png'],
      occurrenceIndex: 1,
    })
    const afterFirst = applyReferenceDestination(markdown, first.reference!, 'assets/first.png')
    expect(afterFirst?.kind).toBe('REWRITTEN')
    const afterSecond = applyReferenceDestination(markdown, second.reference!, 'assets/second.png')
    expect(afterSecond?.kind).toBe('REWRITTEN')

    // 两处相同 URL 的引用各自改写后互不影响：第一处 → first，第二处 → second。
    expect(afterFirst?.markdown).toContain('![](assets/first.png)')
    expect(afterFirst?.markdown).toContain('![](https://cdn.example.test/repeated.png)')
    expect(afterSecond?.markdown).toContain('![](assets/second.png)')
    expect(afterSecond?.markdown).toContain('![](https://cdn.example.test/repeated.png)')

    // 顺序无关：先改第二处再改第一处，结果同样是两处不同目标。
    const reverseAfterSecond = applyReferenceDestination(markdown, second.reference!, 'assets/second.png')
    const reverseFirst = selectMarkdownImageReference({
      markdown: reverseAfterSecond!.markdown,
      documentPath: DOC,
      rawDestinations: ['https://cdn.example.test/repeated.png'],
      occurrenceIndex: 0,
    })
    const reverseAfterFirst = applyReferenceDestination(reverseAfterSecond!.markdown, reverseFirst.reference!, 'assets/first.png')
    expect(reverseAfterFirst?.markdown).toContain('![](assets/first.png)')
    expect(reverseAfterFirst?.markdown).toContain('![](assets/second.png)')
  })

  it('never writes any context-menu label into Markdown', () => {
    const markdown = '![图 1 架构图](https://cdn.example.test/a.png "图名")\n\n正文保持不变。\n'
    const selection = selectMarkdownImageReference({
      markdown,
      documentPath: DOC,
      rawDestinations: ['https://cdn.example.test/a.png'],
      occurrenceIndex: 0,
    })
    const outcome = applyReferenceDestination(markdown, selection.reference!, 'assets/images/a.png')
    expect(outcome?.kind).toBe('REWRITTEN')
    // 菜单/工具栏文案只存在于 UI，绝不进入正文。
    expect(outcome!.markdown).not.toContain(IMAGE_DOWNLOAD_MENU_LABEL)
    expect(outcome!.markdown).not.toContain('墨章')
    expect(outcome!.markdown).toBe('![图 1 架构图](assets/images/a.png "图名")\n\n正文保持不变。\n')
  })
})
