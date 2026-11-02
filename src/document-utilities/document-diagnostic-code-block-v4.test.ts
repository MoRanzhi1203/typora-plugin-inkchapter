// @vitest-environment jsdom
/**
 * 代码块诊断 V4 — L1 通用格式 + L2 语言感知标点。
 * 纯只读分析：所有断言同时校验“文本未被修改”（输入即输出源）。
 */
import { describe, it, expect } from 'vitest'
import {
  analyzeCodeBlockV4,
  resolveCodeLexicalFamily,
  type CodeBlockFinding,
} from './document-diagnostic-code-block-v4'

function analyze(text: string, language = 'javascript', options = {}): CodeBlockFinding[] {
  return analyzeCodeBlockV4({ text, language, options })
}

function ruleIds(findings: CodeBlockFinding[]): string[] {
  return findings.map((f) => f.ruleId)
}

describe('L1 通用格式', () => {
  it('CB001 开头 2 个空白逻辑行报告，1 个不报告', () => {
    expect(ruleIds(analyze('\n\na'))).toContain('CB001')
    expect(ruleIds(analyze('\na'))).not.toContain('CB001')
  })

  it('CB002 末尾 2 个空白逻辑行报告，1 个不报告', () => {
    const two = analyze('a\n\n')
    expect(two.find((f) => f.ruleId === 'CB002')?.metadata).toMatchObject({ blankCount: 2 })
    expect(ruleIds(analyze('a\n'))).not.toContain('CB002')
    expect(ruleIds(analyze('a'))).not.toContain('CB002')
  })

  it('CB002 只报告一个范围，不逐行刷屏', () => {
    const findings = analyze('a\n\n\n\n\n')
    expect(findings.filter((f) => f.ruleId === 'CB002')).toHaveLength(1)
  })

  it('CB003 正文内部允许 2 个连续空行，3 个才报告', () => {
    expect(ruleIds(analyze('a\n\n\nb'))).not.toContain('CB003')
    expect(ruleIds(analyze('a\n\n\n\nb'))).toContain('CB003')
  })

  it('CB004 行尾空格/Tab', () => {
    const findings = analyze('const a = 1  \nconst b = 2')
    const hit = findings.find((f) => f.ruleId === 'CB004')
    expect(hit).toMatchObject({ startLine: 1, endLine: 1, severity: 'hint' })
  })

  it('CB005 同一缩进区域混用空格与 Tab', () => {
    expect(ruleIds(analyze('\t  const a = 1'))).toContain('CB005')
    expect(ruleIds(analyze('    const a = 1'))).not.toContain('CB005')
    expect(ruleIds(analyze('\tconst a = 1'))).not.toContain('CB005')
  })

  it('CB006 零宽字符与不可见控制字符', () => {
    expect(ruleIds(analyze('const a\u200B= 1'))).toContain('CB006')
    expect(ruleIds(analyze('const a = 1\uFEFF'))).toContain('CB006')
    expect(ruleIds(analyze('const a = 1'))).not.toContain('CB006')
  })

  it('CB007 仅在原始文本可信时判断 LF/CRLF 混用', () => {
    expect(ruleIds(analyze('a\r\nb\nc'))).not.toContain('CB007')
    expect(ruleIds(analyze('a\r\nb\nc', 'javascript', { rawText: 'a\r\nb\nc' }))).toContain('CB007')
    expect(ruleIds(analyze('a\r\nb', 'javascript', { rawText: 'a\r\nb' }))).not.toContain('CB007')
  })

  it('CB008 默认关闭，开启后报告超长行', () => {
    const long = 'const value = ' + 'x'.repeat(30)
    expect(ruleIds(analyze(long))).not.toContain('CB008')
    expect(ruleIds(analyze(long, 'javascript', { enableLongLine: true, maxLineLength: 20 }))).toContain('CB008')
  })

  it('CB009 仅真正空内容且有题注', () => {
    expect(ruleIds(analyze('', 'javascript', { captionPresent: true }))).toContain('CB009')
    expect(ruleIds(analyze('', 'javascript'))).not.toContain('CB009')
    expect(ruleIds(analyze('\n', 'javascript', { captionPresent: true }))).not.toContain('CB009')
  })

  it('CB010 默认关闭（既有 CODE_MISSING_LANGUAGE 负责）', () => {
    expect(ruleIds(analyze('const a = 1', ''))).not.toContain('CB010')
    expect(ruleIds(analyze('const a = 1', '', { enableMissingLanguage: true }))).toContain('CB010')
  })
})

describe('L2 JS / TS 词法', () => {
  it('全角括号与分号在代码区被报告', () => {
    const text = 'console.log（"你好"）；'
    const findings = analyze(text)
    expect(ruleIds(findings)).toEqual(expect.arrayContaining(['CB101', 'CB102']))
    const paren = findings.find((f) => f.ruleId === 'CB101')
    expect(paren).toMatchObject({ startLine: 1, startColumn: 12, severity: 'warning', confidence: 'high' })
  })

  it('add（1，2）同时命中括号与逗号', () => {
    const ids = ruleIds(analyze('add（1，2）'))
    expect(ids.filter((id) => id === 'CB101')).toHaveLength(2)
    expect(ids.filter((id) => id === 'CB102')).toHaveLength(1)
  })

  it('字符串与注释中的中文标点豁免', () => {
    expect(analyze('console.log("你好，世界！")')).toEqual([])
    expect(analyze('// 中文注释：说明')).toEqual([])
    expect(analyze('/* 中文，注释； */')).toEqual([])
  })

  it('模板字符串文本豁免，${...} 表达式恢复代码上下文', () => {
    expect(analyze('const s = `你好，世界`')).toEqual([])
    const ids = ruleIds(analyze('const x = `${add（1，2）}`'))
    expect(ids).toEqual(expect.arrayContaining(['CB101', 'CB102']))
    expect(analyze('const x = `${"（"}`')).toEqual([])
  })

  it('正则字面量与字符组中的全角标点豁免', () => {
    expect(analyze('const r = /（，）/')).toEqual([])
    expect(analyze('const r = /[/（]/')).toEqual([])
  })

  it('智能引号按全角运算符处理', () => {
    expect(ruleIds(analyze('const s = “x”'))).toEqual(expect.arrayContaining(['CB104']))
  })

  it('全角句号等低置信标点只给 hint', () => {
    const findings = analyze('const s = 1。')
    const hit = findings.find((f) => f.ruleId === 'CB105')
    expect(hit).toMatchObject({ severity: 'hint', confidence: 'low' })
  })

  it('文本类与未知语言不启用 L2', () => {
    expect(analyze('a（b）', 'markdown')).toEqual([])
    expect(analyze('a（b）', 'text')).toEqual([])
    expect(analyze('a（b）', 'rust')).toEqual([])
    expect(resolveCodeLexicalFamily('text')).toBe('text')
    expect(resolveCodeLexicalFamily('tsx')).toBe('js')
  })
})

describe('L2 Python 词法', () => {
  it('普通字符串、三引号、r-string、注释豁免', () => {
    expect(analyze('s = "中文，标点"', 'python')).toEqual([])
    expect(analyze('s = """多行：中文"""', 'python')).toEqual([])
    expect(analyze('s = r"C:\\path（x）"', 'python')).toEqual([])
    expect(analyze('# 中文，注释', 'python')).toEqual([])
  })

  it('f-string 表达式内报告，字面量内豁免', () => {
    expect(ruleIds(analyze('s = f"{add（1，2）}"', 'python'))).toEqual(expect.arrayContaining(['CB101', 'CB102']))
    expect(analyze('s = f"你好，世界"', 'python')).toEqual([])
  })
})

describe('L2 C / C++ 词法', () => {
  it('普通字符串、字符、注释、原始字符串豁免', () => {
    expect(analyze('std::cout << "中文，";', 'cpp')).toEqual([])
    expect(analyze("char c = '，';", 'c')).toEqual([])
    expect(analyze('// 注释：（', 'cpp')).toEqual([])
    expect(analyze('auto x = R"(raw （）)";', 'cpp')).toEqual([])
  })

  it('代码区全角括号被报告', () => {
    expect(ruleIds(analyze('int y = （1）;', 'cpp'))).toEqual(expect.arrayContaining(['CB101']))
  })
})

describe('只读与边界', () => {
  it('不修改输入文本（字符串不可变 + 输出只含范围）', () => {
    const text = 'a\n\nb（c）'
    const before = text
    const findings = analyze(text)
    expect(text).toBe(before)
    for (const f of findings) {
      expect(f.startLine).toBeGreaterThanOrEqual(1)
      expect(f.endLine).toBeGreaterThanOrEqual(f.startLine)
      expect(f.endColumn).toBeGreaterThanOrEqual(1)
    }
  })

  it('maxFindings 限制单块诊断数量', () => {
    const dense = '（'.repeat(50)
    const findings = analyze(dense, 'javascript', { maxFindings: 5 })
    expect(findings.length).toBeLessThanOrEqual(5)
  })
})
