import { describe, it, expect } from 'vitest'
import {
  analyzeFigureSyntax,
  buildFigureSyntaxFix,
  FIGURE_UNCLOSED_DESTINATION_CODE,
  FIGURE_UNCLOSED_ALT_CODE,
  FIGURE_MALFORMED_SYNTAX_CODE,
  FIGURE_INVALID_DESTINATION_CODE,
} from './document-figure-syntax-integrity-v1'

function codesOf(markdown: string): string[] {
  return analyzeFigureSyntax(markdown).map(issue => issue.code)
}

function fixOnce(markdown: string): string {
  const issue = analyzeFigureSyntax(markdown)[0]
  expect(issue, 'expected a syntax issue').toBeTruthy()
  const outcome = buildFigureSyntaxFix(markdown, issue)
  expect(outcome.refusal).toBeNull()
  return outcome.text
}

describe('V3 §3 — 图片语法完整性扫描', () => {
  it('缺少右圆括号 → FIGURE_UNCLOSED_DESTINATION，并补全在段落结尾', () => {
    const md = '## 结束 ![K](https://raw.githubusercontent.com/a/b/k.png\n'
    const issues = analyzeFigureSyntax(md)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe(FIGURE_UNCLOSED_DESTINATION_CODE)
    expect(issues[0].title).toBe('图片链接括号未闭合')
    expect(issues[0].destination).toBe('https://raw.githubusercontent.com/a/b/k.png')
    expect(fixOnce(md)).toBe('## 结束 ![K](https://raw.githubusercontent.com/a/b/k.png)\n')
    expect(analyzeFigureSyntax(fixOnce(md))).toEqual([])
  })

  it('段落未结束时不自动补全（仍显示诊断）', () => {
    const md = '段落 ![K](a.png\n下一行仍是同一段落\n'
    const issues = analyzeFigureSyntax(md)
    expect(issues).toHaveLength(1)
    expect(issues[0].repair).toBeNull()
    expect(issues[0].refusal).toContain('段落结尾')
    expect(buildFigureSyntaxFix(md, issues[0]).changed).toBe(false)
  })

  it('同一段落存在多个未闭合结构时全部转为手动修复', () => {
    const md = '![A](a.png ![B](b.png\n'
    const issues = analyzeFigureSyntax(md)
    expect(issues.length).toBeGreaterThanOrEqual(2)
    expect(issues.every(issue => issue.repair == null)).toBe(true)
  })

  it('缺少右方括号 → FIGURE_UNCLOSED_ALT，并安全插入 `]`', () => {
    const md = '![K(assets/k.png)\n'
    const issues = analyzeFigureSyntax(md)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe(FIGURE_UNCLOSED_ALT_CODE)
    expect(issues[0].title).toBe('图片描述方括号未闭合')
    expect(fixOnce(md)).toBe('![K](assets/k.png)\n')
  })

  it('描述中存在括号时无法无歧义恢复 → 手动修复', () => {
    const md = '![K(说明(assets/k.png)\n'
    const issues = analyzeFigureSyntax(md)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe(FIGURE_UNCLOSED_ALT_CODE)
    expect(issues[0].repair).toBeNull()
    expect(buildFigureSyntaxFix(md, issues[0]).changed).toBe(false)
  })

  it('完整的图片语法不产生语法问题', () => {
    expect(codesOf('![图](a.png)\n')).toEqual([])
    expect(codesOf('![图](a(b).png)\n')).toEqual([])
    expect(codesOf('![图](assets/图 片.png "标题")\n')).toEqual([])
    expect(codesOf('![图](<assets/图 片.png> "标题")\n')).toEqual([])
    expect(codesOf('![图](a\\(b\\).png)\n')).toEqual([])
    expect(codesOf('![图](https://example.com/a%20b.png?x=1&y=2)\n')).toEqual([])
  })

  it('空路径属于 FIGURE_EMPTY_SOURCE，不在这里重复报语法错误', () => {
    for (const raw of ['![]()', '![alt]()', '![](   )', '![a](<>)']) {
      expect(codesOf(`${raw}\n`), raw).toEqual([])
    }
  })

  it('非法路径语法 → FIGURE_INVALID_DESTINATION', () => {
    const issues = analyzeFigureSyntax('![图](<assets/a.png\n')
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe(FIGURE_INVALID_DESTINATION_CODE)
    expect(issues[0].title).toBe('图片路径语法不合法')
    expect(buildFigureSyntaxFix('![图](<assets/a.png\n', issues[0]).changed).toBe(false)
  })

  it('未闭合 title / 非法分隔 → FIGURE_MALFORMED_SYNTAX', () => {
    expect(codesOf('![图](a.png "标题)\n')).toEqual([FIGURE_MALFORMED_SYNTAX_CODE])
    expect(codesOf('![图] (a.png)\n')).toEqual([FIGURE_MALFORMED_SYNTAX_CODE])
  })

  it('围栏代码 / 行内代码 / 转义 / 普通链接 / HTML 不误报', () => {
    expect(codesOf('```md\n![K](a.png\n```\n')).toEqual([])
    expect(codesOf('行内 `![K](a.png` 文本\n')).toEqual([])
    expect(codesOf('\\![K](a.png\n')).toEqual([])
    expect(codesOf('普通链接 [K](a.png)\n')).toEqual([])
    expect(codesOf('<!-- ![K](a.png -->\n')).toEqual([])
    expect(codesOf('<script>const x = "![K](a.png"</script>\n')).toEqual([])
    expect(codesOf('<pre>![K](a.png</pre>\n')).toEqual([])
  })

  it('标题 / 列表 / 引用中的未闭合语法都覆盖', () => {
    expect(codesOf('## 结束 ![K](a.png\n')).toEqual([FIGURE_UNCLOSED_DESTINATION_CODE])
    expect(codesOf('- ![K](a.png\n')).toEqual([FIGURE_UNCLOSED_DESTINATION_CODE])
    expect(codesOf('> ![K](a.png\n')).toEqual([FIGURE_UNCLOSED_DESTINATION_CODE])
  })

  it('同一行多个完整图片 + 一个未闭合：只报未闭合的那个', () => {
    const md = '![A](a.png) ![B](b.png) ![C](c.png\n'
    const issues = analyzeFigureSyntax(md)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe(FIGURE_UNCLOSED_DESTINATION_CODE)
    expect(issues[0].rawToken).toBe('![C](c.png')
    expect(issues[0].repair).toBe('append-closing-paren')
  })

  it('修复字节最小化：只插入闭合符号，不改变 URL / alt', () => {
    const md = '![K](https://例.子/a%20b(c).png?x=1\n'
    const fixed = fixOnce(md)
    expect(fixed).toBe('![K](https://例.子/a%20b(c).png?x=1)\n')
    expect(fixed).toContain('https://例.子/a%20b(c).png?x=1')
  })

  it('多个候选结构的游标不会互相吞并', () => {
    const issues = analyzeFigureSyntax('![A](a.png)\n![B](b.png)\n')
    expect(issues).toEqual([])
  })
})
