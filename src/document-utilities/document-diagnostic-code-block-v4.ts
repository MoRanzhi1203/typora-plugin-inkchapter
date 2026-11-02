/**
 * 代码块诊断 V4 — L1 通用格式 + L2 语言感知标点（纯只读分析）。
 *
 * 约束：
 * - 输入是 CodeMirror 的源文本（不含围栏标记与语言信息串），按 `\n` 规范化；
 * - 绝不修改文本，只输出结构化的行/列范围；
 * - L2 只覆盖能可靠词法区分的语言（JS/TS、Python、C/C++），
 *   字符串、注释、正则/原始字符串内的标点一律豁免；
 * - 不认识的语言或无法确定词法上下文时返回 SKIP（不发布诊断）。
 *
 * 行号/列号均从 1 开始，列按 UTF-16 代码单元计数（与 CodeMirror 的 ch 对齐）。
 */

export type CodeDiagnosticSeverity = 'warning' | 'hint'

export type CodeDiagnosticConfidence = 'high' | 'medium' | 'low'

export interface CodeBlockFinding {
  ruleId: string
  severity: CodeDiagnosticSeverity
  /** 块内逻辑行号（1 基）。 */
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  message: string
  confidence: CodeDiagnosticConfidence
  metadata?: Record<string, unknown>
}

export interface CodeBlockAnalysisOptions {
  /** CB008：超长行阈值；默认关闭。 */
  maxLineLength?: number
  enableLongLine?: boolean
  /** CB010：缺少语言；默认关闭（既有 CODE_MISSING_LANGUAGE 已负责）。 */
  enableMissingLanguage?: boolean
  /** CB009 需要知道是否同时存在题注。 */
  captionPresent?: boolean
  /**
   * CB007 需要原始换行信息。CodeMirror 的 `getValue()` 已把换行规范化为 `\n`，
   * 缺省即 SKIP；只有调用方能提供原始文本时才判断混用。
   */
  rawText?: string | null
  /** 单块诊断数量上限（防止标点密集时刷屏）。 */
  maxFindings?: number
}

export interface CodeBlockAnalysisInput {
  /** CodeMirror 源文本（无围栏、无语言串）。 */
  text: string
  /** 语言信息串（已 trim；大小写不敏感）。 */
  language: string
  options?: CodeBlockAnalysisOptions
}

export const CODE_BLOCK_V4_RULES = {
  CB001: '代码内容开头空白逻辑行过多',
  CB002: '代码内容末尾空白逻辑行过多',
  CB003: '代码正文中连续空行过多',
  CB004: '非空代码行末尾存在多余空格或 Tab',
  CB005: '同一行缩进混用空格与 Tab',
  CB006: '代码中出现零宽或不可见控制字符',
  CB007: '同一代码块混用 LF 与 CRLF',
  CB008: '代码行过长',
  CB009: '空代码块同时存在题注',
  CB010: '代码块未指定语言',
  CB101: '代码中使用全角括号',
  CB102: '代码中使用全角逗号或分号',
  CB103: '代码中使用全角冒号',
  CB104: '代码中使用全角运算符或智能引号',
  CB105: '代码中疑似输入法误输入的全角标点',
} as const

export type CodeBlockRuleId = keyof typeof CODE_BLOCK_V4_RULES

const DEFAULT_MAX_FINDINGS = 40
const DEFAULT_LONG_LINE = 120

/** L2 明确跳过的文本类语言（CB108 语义，不产生诊断）。 */
const TEXT_LANGUAGES = new Set([
  'text', 'txt', 'plain', 'plaintext', 'markdown', 'md', 'mdx', 'mermaid',
  'plantuml', 'puml', 'dot', 'graphviz', 'diff', 'patch', 'log',
])

const JS_LANGUAGES = new Set(['js', 'javascript', 'jsx', 'mjs', 'cjs', 'ts', 'typescript', 'tsx'])
const PY_LANGUAGES = new Set(['py', 'python', 'python3'])
const C_LANGUAGES = new Set(['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hxx', 'ino'])

/** 语言归一化：取信息串第一个 token，小写。 */
export function normalizeCodeLanguage(info: string): string {
  const first = (info ?? '').trim().split(/\s+/)[0] ?? ''
  return first.toLowerCase()
}

export type CodeLexicalFamily = 'js' | 'python' | 'c' | 'text' | 'unsupported'

export function resolveCodeLexicalFamily(language: string): CodeLexicalFamily {
  const lang = normalizeCodeLanguage(language)
  if (TEXT_LANGUAGES.has(lang)) return 'text'
  if (JS_LANGUAGES.has(lang)) return 'js'
  if (PY_LANGUAGES.has(lang)) return 'python'
  if (C_LANGUAGES.has(lang)) return 'c'
  return 'unsupported'
}

// ── 基础判定 ────────────────────────────────────────────────────────────

function isBlankLine(line: string): boolean {
  return /^[ \t]*$/.test(line)
}

function lineLength(line: string): number {
  return line.length
}

function exceedsMax(findings: CodeBlockFinding[], max: number): boolean {
  return findings.length >= max
}

// 不可见字符：零宽、方向控制、BOM、C0 控制符（保留 \n \t）。
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

function pushFindings(findings: CodeBlockFinding[], items: CodeBlockFinding[], max: number): void {
  for (const item of items) {
    if (exceedsMax(findings, max)) return
    findings.push(item)
  }
}

// ── L1 ─────────────────────────────────────────────────────────────────

function analyzeFormat(
  lines: readonly string[],
  options: CodeBlockAnalysisOptions,
  max: number,
): CodeBlockFinding[] {
  const findings: CodeBlockFinding[] = []
  const count = lines.length
  const allBlank = lines.every(isBlankLine)

  // CB001 开头空白逻辑行（允许 1 行）
  let leading = 0
  while (leading < count && isBlankLine(lines[leading])) leading++
  if (leading >= 2 && !allBlank) {
    findings.push({
      ruleId: 'CB001',
      severity: 'warning',
      startLine: 1,
      startColumn: 1,
      endLine: leading,
      endColumn: lineLength(lines[leading - 1]) + 1,
      message: `代码开头有 ${leading} 个空白逻辑行`,
      confidence: 'high',
      metadata: { blankCount: leading },
    })
  }

  // CB002 末尾空白逻辑行（允许 1 行）
  let trailing = 0
  while (trailing < count && isBlankLine(lines[count - 1 - trailing])) trailing++
  if (trailing >= 2 && !allBlank && trailing < count) {
    findings.push({
      ruleId: 'CB002',
      severity: 'warning',
      startLine: count - trailing + 1,
      startColumn: 1,
      endLine: count,
      endColumn: lineLength(lines[count - 1]) + 1,
      message: `代码末尾有 ${trailing} 个空白逻辑行`,
      confidence: 'high',
      metadata: { blankCount: trailing },
    })
  }

  // CB003 正文内部连续空行（允许 2 行）
  const interiorStart = leading
  const interiorEnd = count - trailing
  let runStart = -1
  for (let i = interiorStart; i < interiorEnd; i++) {
    if (isBlankLine(lines[i])) {
      if (runStart < 0) runStart = i
    } else if (runStart >= 0) {
      const runLength = i - runStart
      if (runLength >= 3) {
        findings.push({
          ruleId: 'CB003',
          severity: 'hint',
          startLine: runStart + 1,
          startColumn: 1,
          endLine: i,
          endColumn: 1,
          message: `代码正文中有 ${runLength} 个连续空行`,
          confidence: 'high',
          metadata: { blankCount: runLength },
        })
      }
      runStart = -1
    }
  }
  if (runStart >= 0) {
    const runLength = interiorEnd - runStart
    if (runLength >= 3) {
      findings.push({
        ruleId: 'CB003',
        severity: 'hint',
        startLine: runStart + 1,
        startColumn: 1,
        endLine: interiorEnd,
        endColumn: 1,
        message: `代码正文中有 ${runLength} 个连续空行`,
        confidence: 'high',
        metadata: { blankCount: runLength },
      })
    }
  }

  // CB004 行尾空格 / Tab；CB005 缩进混用
  for (let i = 0; i < count; i++) {
    if (exceedsMax(findings, max)) break
    const line = lines[i]
    if (isBlankLine(line)) continue
    const trailingWs = /[ \t]+$/.exec(line)
    if (trailingWs) {
      findings.push({
        ruleId: 'CB004',
        severity: 'hint',
        startLine: i + 1,
        startColumn: trailingWs.index + 1,
        endLine: i + 1,
        endColumn: line.length + 1,
        message: '行尾存在多余空格或 Tab',
        confidence: 'high',
        metadata: { whitespaceLength: line.length - trailingWs.index },
      })
    }
    const indent = /^[ \t]+/.exec(line)
    if (indent && indent[0].includes(' ') && indent[0].includes('\t')) {
      findings.push({
        ruleId: 'CB005',
        severity: 'hint',
        startLine: i + 1,
        startColumn: 1,
        endLine: i + 1,
        endColumn: indent[0].length + 1,
        message: '缩进同时使用空格与 Tab',
        confidence: 'medium',
        metadata: { indentWidth: indent[0].length },
      })
    }
  }

  // CB006 不可见字符（逐行合并连续命中）
  for (let i = 0; i < count; i++) {
    if (exceedsMax(findings, max)) break
    const line = lines[i]
    let j = 0
    while (j < line.length) {
      if (!INVISIBLE_RE.test(line[j])) { j++; continue }
      const start = j
      while (j < line.length && INVISIBLE_RE.test(line[j])) j++
      findings.push({
        ruleId: 'CB006',
        severity: 'warning',
        startLine: i + 1,
        startColumn: start + 1,
        endLine: i + 1,
        endColumn: j + 1,
        message: '行内包含零宽或不可见控制字符',
        confidence: 'high',
        metadata: { codePoints: Array.from(line.slice(start, j)).map((c) => c.codePointAt(0)) },
      })
    }
  }

  // CB007 LF / CRLF 混用（仅在原始文本可信时判断）
  const raw = options.rawText ?? null
  if (raw != null && raw.includes('\r\n')) {
    const crlfCount = (raw.match(/\r\n/g) ?? []).length
    const lfOnly = (raw.match(/(?<!\r)\n/g) ?? []).length
    if (crlfCount > 0 && lfOnly > 0) {
      findings.push({
        ruleId: 'CB007',
        severity: 'hint',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
        message: '同一代码块混用 CRLF 与 LF 换行',
        confidence: 'high',
        metadata: { crlfCount, lfCount: lfOnly },
      })
    }
  }

  // CB008 超长行（默认关闭）
  if (options.enableLongLine === true) {
    const limit = Number.isFinite(options.maxLineLength)
      ? Math.max(20, Math.floor(options.maxLineLength as number))
      : DEFAULT_LONG_LINE
    for (let i = 0; i < count; i++) {
      if (exceedsMax(findings, max)) break
      if (lineLength(lines[i]) <= limit) continue
      findings.push({
        ruleId: 'CB008',
        severity: 'hint',
        startLine: i + 1,
        startColumn: limit + 1,
        endLine: i + 1,
        endColumn: lineLength(lines[i]) + 1,
        message: `代码行超过 ${limit} 个字符`,
        confidence: 'high',
        metadata: { length: lineLength(lines[i]), limit },
      })
    }
  }

  // CB009 真正空内容 + 题注
  if (options.captionPresent === true && lines.length === 1 && lines[0] === '') {
    findings.push({
      ruleId: 'CB009',
      severity: 'hint',
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 1,
      message: '空代码块仍带有题注',
      confidence: 'high',
    })
  }

  return findings
}

// ── L2 词法扫描 ────────────────────────────────────────────────────────

interface LexScanResult {
  /** 与 text 等长；true 表示位于可检查的代码区域。 */
  codeMask: Uint8Array
  /** 词法是否可靠；false 时整块 SKIP。 */
  reliable: boolean
}

function markCode(mask: Uint8Array, from: number, to: number): void {
  for (let i = from; i < to && i < mask.length; i++) mask[i] = 1
}

const JS_REGEX_PREFIX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])
const JS_REGEX_WORDS = new Set(['return', 'case', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'do', 'else', 'yield', 'await'])

function previousSignificant(text: string, index: number): { char: string; word: string } {
  let i = index - 1
  while (i >= 0 && /\s/.test(text[i])) i--
  if (i < 0) return { char: '', word: '' }
  const char = text[i]
  let word = ''
  let j = i
  while (j >= 0 && /[A-Za-z_$]/.test(text[j])) {
    word = text[j] + word
    j--
  }
  return { char, word }
}

/** JS / TS 词法：字符串、模板、注释、正则区域一律标记为“非代码”。 */
function scanJs(text: string): LexScanResult {
  const mask = new Uint8Array(text.length)
  const templateStack: Array<{ braceDepth: number }> = []
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex' = 'code'
  let i = 0
  let reliable = true
  let regexInClass = false
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; i += 2; continue }
      if (ch === '/' && next === '*') { state = 'block'; i += 2; continue }
      if (ch === "'") { state = 'single'; i++; continue }
      if (ch === '"') { state = 'double'; i++; continue }
      if (ch === '`') { state = 'template'; i++; continue }
      if (ch === '/') {
        const prev = previousSignificant(text, i)
        const isRegex = JS_REGEX_PREFIX.has(prev.char) || JS_REGEX_WORDS.has(prev.word)
        if (isRegex) {
          // 仅当同一行内能找到未转义的闭合 `/` 时才按正则处理；否则保守跳过整块。
          let j = i + 1
          let closed = false
          let inClass = false
          while (j < text.length && text[j] !== '\n') {
            const cj = text[j]
            if (cj === '\\') { j += 2; continue }
            if (cj === '[') inClass = true
            else if (cj === ']') inClass = false
            else if (cj === '/' && !inClass) { closed = true; break }
            j++
          }
          if (closed) { regexInClass = false; state = 'regex'; i++; continue }
          // 形如 `a / b` 的除法：按代码处理。
        }
        markCode(mask, i, i + 1)
        i++
        continue
      }
      if (ch === '{' && templateStack.length > 0) {
        templateStack[templateStack.length - 1].braceDepth++
        markCode(mask, i, i + 1)
        i++
        continue
      }
      if (ch === '}' && templateStack.length > 0) {
        const top = templateStack[templateStack.length - 1]
        if (top.braceDepth === 0) {
          templateStack.pop()
          state = 'template'
          i++
          continue
        }
        top.braceDepth--
        markCode(mask, i, i + 1)
        i++
        continue
      }
      markCode(mask, i, i + 1)
      i++
      continue
    }
    if (state === 'line') {
      if (ch === '\n') { state = 'code'; i++; continue }
      i++
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; i += 2; continue }
      i++
      continue
    }
    if (state === 'single' || state === 'double') {
      if (ch === '\\') { i += 2; continue }
      if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"')) {
        state = 'code'; i++; continue
      }
      if (ch === '\n') { reliable = false; state = 'code'; i++; continue }
      i++
      continue
    }
    if (state === 'template') {
      if (ch === '\\') { i += 2; continue }
      if (ch === '`') { state = 'code'; i++; continue }
      if (ch === '$' && next === '{') {
        templateStack.push({ braceDepth: 0 })
        state = 'code'
        i += 2
        continue
      }
      i++
      continue
    }
    if (state === 'regex') {
      if (ch === '\\') { i += 2; continue }
      if (ch === '[') { regexInClass = true; i++; continue }
      if (ch === ']' && regexInClass) { regexInClass = false; i++; continue }
      if (ch === '/' && !regexInClass) { state = 'code'; i++; continue }
      if (ch === '\n') { reliable = false; state = 'code'; i++; continue }
      i++
      continue
    }
  }
  return { codeMask: mask, reliable }
}

const PY_PREFIXES = new Set(['r', 'u', 'b', 'f', 'br', 'rb', 'fr', 'rf', 'ur'])

/** Python 词法：注释、字符串、三引号、f-string 表达式。 */
function scanPython(text: string): LexScanResult {
  const mask = new Uint8Array(text.length)
  type State = 'code' | 'comment' | 'single' | 'double' | 'triple-single' | 'triple-double'
  let state: State = 'code'
  let inFString = false
  const fexprStack: Array<{ braceDepth: number; returnState: Exclude<State, 'code' | 'comment'> }> = []
  let i = 0
  let reliable = true

  const readPrefix = (index: number): { prefix: string; quoteIndex: number } | null => {
    let j = index
    let prefix = ''
    while (j < text.length && prefix.length < 2 && /[A-Za-z]/.test(text[j])) {
      prefix += text[j].toLowerCase()
      j++
    }
    if (prefix === '') return { prefix: '', quoteIndex: index }
    if (!PY_PREFIXES.has(prefix)) return null
    if (text[j] !== "'" && text[j] !== '"') return null
    return { prefix, quoteIndex: j }
  }

  const enterString = (quote: "'" | '"', triple: boolean, isF: boolean): void => {
    state = triple
      ? (quote === "'" ? 'triple-single' : 'triple-double')
      : (quote === "'" ? 'single' : 'double')
    inFString = isF
  }

  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (state === 'code') {
      if (ch === '#') { state = 'comment'; i++; continue }
      if (ch === "'" || ch === '"') {
        const triple = text[i + 1] === ch && text[i + 2] === ch
        enterString(ch as "'" | '"', triple, false)
        i += triple ? 3 : 1
        continue
      }
      if (/[A-Za-z]/.test(ch)) {
        const prefixInfo = readPrefix(i)
        if (prefixInfo) {
          const q = text[prefixInfo.quoteIndex]
          const triple = text[prefixInfo.quoteIndex + 1] === q && text[prefixInfo.quoteIndex + 2] === q
          enterString(q as "'" | '"', triple, prefixInfo.prefix.includes('f'))
          i = prefixInfo.quoteIndex + (triple ? 3 : 1)
          continue
        }
        markCode(mask, i, i + 1)
        i++
        continue
      }
      if (ch === '{' && fexprStack.length > 0) {
        fexprStack[fexprStack.length - 1].braceDepth++
        markCode(mask, i, i + 1)
        i++
        continue
      }
      if (ch === '}' && fexprStack.length > 0) {
        const top = fexprStack[fexprStack.length - 1]
        if (top.braceDepth === 0) {
          fexprStack.pop()
          state = top.returnState
          i++
          continue
        }
        top.braceDepth--
        markCode(mask, i, i + 1)
        i++
        continue
      }
      markCode(mask, i, i + 1)
      i++
      continue
    }
    if (state === 'comment') {
      if (ch === '\n') { state = 'code' }
      i++
      continue
    }
    if (state === 'triple-single' || state === 'triple-double') {
      const q = state === 'triple-single' ? "'" : '"'
      if (inFString && ch === '{') {
        if (next === '{') { i += 2; continue }
        fexprStack.push({ braceDepth: 0, returnState: state })
        state = 'code'
        i++
        continue
      }
      if (inFString && ch === '}' && next === '}') { i += 2; continue }
      if (ch === '\\') { i += 2; continue }
      if (ch === q && next === q && text[i + 2] === q) {
        state = 'code'
        inFString = false
        i += 3
        continue
      }
      i++
      continue
    }
    if (state === 'single' || state === 'double') {
      const q = state === 'single' ? "'" : '"'
      if (inFString && ch === '{') {
        if (next === '{') { i += 2; continue }
        fexprStack.push({ braceDepth: 0, returnState: state })
        state = 'code'
        i++
        continue
      }
      if (inFString && ch === '}' && next === '}') { i += 2; continue }
      if (ch === '\\') { i += 2; continue }
      if (ch === q) {
        state = 'code'
        inFString = false
        i++
        continue
      }
      if (ch === '\n') { reliable = false; state = 'code'; inFString = false; i++; continue }
      i++
      continue
    }
    i++
  }
  return { codeMask: mask, reliable }
}

/** C / C++ 词法：行注释、块注释、普通/原始字符串、字符字面量。 */
function scanC(text: string): LexScanResult {
  const mask = new Uint8Array(text.length)
  let state: 'code' | 'line' | 'block' | 'string' | 'char' | 'raw' = 'code'
  let rawTerminator = ''
  let i = 0
  let reliable = true
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; i += 2; continue }
      if (ch === '/' && next === '*') { state = 'block'; i += 2; continue }
      if (ch === 'R' && next === '"' && (i === 0 || !/[A-Za-z0-9_$]/.test(text[i - 1]))) {
        const open = text.indexOf('(', i + 2)
        if (open >= 0) {
          const delim = text.slice(i + 2, open)
          rawTerminator = `)${delim}"`
          state = 'raw'
          i = open + 1
          continue
        }
      }
      if (ch === '"') { state = 'string'; i++; continue }
      if (ch === "'") { state = 'char'; i++; continue }
      markCode(mask, i, i + 1)
      i++
      continue
    }
    if (state === 'line') {
      if (ch === '\n') { state = 'code' }
      i++
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; i += 2; continue }
      i++
      continue
    }
    if (state === 'string' || state === 'char') {
      if (ch === '\\') { i += 2; continue }
      if ((state === 'string' && ch === '"') || (state === 'char' && ch === "'")) {
        state = 'code'; i++; continue
      }
      if (ch === '\n') { reliable = false; state = 'code'; i++; continue }
      i++
      continue
    }
    if (state === 'raw') {
      if (text.startsWith(rawTerminator, i)) {
        i += rawTerminator.length
        state = 'code'
        continue
      }
      i++
      continue
    }
  }
  return { codeMask: mask, reliable }
}

function scanLexical(text: string, family: CodeLexicalFamily): LexScanResult | null {
  if (family === 'js') return scanJs(text)
  if (family === 'python') return scanPython(text)
  if (family === 'c') return scanC(text)
  return null
}

// ── L2 规则 ────────────────────────────────────────────────────────────

const FULLWIDTH_PAREN = new Set(['（', '）'])
const FULLWIDTH_COMMA_SEMI = new Set(['，', '；'])
const FULLWIDTH_COLON = new Set(['：'])
const FULLWIDTH_OPERATOR = new Set(['＝', '＋', '－', '＊', '／', '％', '＜', '＞', '＆', '｜', '～', '＾', '＃', '＠', '“', '”', '‘', '’'])
const FULLWIDTH_OTHER = new Set(['。', '、', '！', '？', '【', '】', '《', '》', '〈', '〉', '「', '」', '『', '』', '［', '］', '｛', '｝', '＄', '\u3000'])

interface PunctuationRule {
  ruleId: CodeBlockRuleId
  severity: CodeDiagnosticSeverity
  message: string
  confidence: CodeDiagnosticConfidence
}

function classifyPunctuation(ch: string): PunctuationRule | null {
  if (FULLWIDTH_PAREN.has(ch)) {
    return { ruleId: 'CB101', severity: 'warning', message: '代码中使用全角括号', confidence: 'high' }
  }
  if (FULLWIDTH_COMMA_SEMI.has(ch)) {
    return { ruleId: 'CB102', severity: 'warning', message: '代码中使用全角逗号或分号', confidence: 'high' }
  }
  if (FULLWIDTH_COLON.has(ch)) {
    return { ruleId: 'CB103', severity: 'warning', message: '代码中使用全角冒号', confidence: 'high' }
  }
  if (FULLWIDTH_OPERATOR.has(ch)) {
    return { ruleId: 'CB104', severity: 'warning', message: '代码中使用全角运算符或智能引号', confidence: 'high' }
  }
  if (FULLWIDTH_OTHER.has(ch)) {
    return { ruleId: 'CB105', severity: 'hint', message: '疑似输入法误输入的全角标点', confidence: 'low' }
  }
  return null
}

function analyzePunctuation(
  text: string,
  family: CodeLexicalFamily,
  max: number,
): CodeBlockFinding[] {
  if (family === 'text' || family === 'unsupported') return []
  const scan = scanLexical(text, family)
  if (!scan || !scan.reliable) return []

  const findings: CodeBlockFinding[] = []
  const lineStarts: number[] = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1)
  }
  const lineOf = (offset: number): { line: number; column: number } => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1 }
  }

  for (let i = 0; i < text.length; i++) {
    if (!scan.codeMask[i]) continue
    const ch = text[i]
    if (ch === '\n' || ch === '\t') continue
    const rule = classifyPunctuation(ch)
    if (!rule) continue
    if (exceedsMax(findings, max)) break
    const pos = lineOf(i)
    findings.push({
      ruleId: rule.ruleId,
      severity: rule.severity,
      startLine: pos.line,
      startColumn: pos.column,
      endLine: pos.line,
      endColumn: pos.column + ch.length,
      message: rule.message,
      confidence: rule.confidence,
      metadata: { char: ch, codePoint: `U+${ch.codePointAt(0)?.toString(16).toUpperCase()}` },
    })
  }
  return findings
}

// ── 入口 ───────────────────────────────────────────────────────────────

/**
 * 分析一个代码块的完整源文本（未裁剪、未 trim）。
 * 返回值按行号/列号升序；同一问题只产出一个范围（空行区段不逐行刷屏）。
 */
export function analyzeCodeBlockV4(input: CodeBlockAnalysisInput): CodeBlockFinding[] {
  const text = (input.text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = text.split('\n')
  const options = input.options ?? {}
  const max = Number.isFinite(options.maxFindings)
    ? Math.max(1, Math.floor(options.maxFindings as number))
    : DEFAULT_MAX_FINDINGS

  const findings: CodeBlockFinding[] = []
  // Collect a bounded superset first, then prefer warnings over hints before
  // truncating: a block full of trailing-space hints must never hide all
  // full-width punctuation warnings.
  const rawMax = Math.max(max * 4, max)
  pushFindings(findings, analyzeFormat(lines, options, rawMax), rawMax)

  // CB010（默认关闭）：与既有 CODE_MISSING_LANGUAGE 重复，不默认启用。
  if (options.enableMissingLanguage === true && normalizeCodeLanguage(input.language) === '' && text !== '') {
    findings.push({
      ruleId: 'CB010',
      severity: 'hint',
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 1,
      message: '代码块未指定语言',
      confidence: 'high',
    })
  }

  const family = resolveCodeLexicalFamily(input.language)
  pushFindings(findings, analyzePunctuation(text, family, rawMax), rawMax)

  const rank = (severity: CodeDiagnosticSeverity): number => (severity === 'warning' ? 0 : 1)
  const byPosition = (a: CodeBlockFinding, b: CodeBlockFinding): number =>
    a.startLine - b.startLine || a.startColumn - b.startColumn
  findings.sort((a, b) => rank(a.severity) - rank(b.severity) || byPosition(a, b))
  const kept = findings.slice(0, max)
  kept.sort(byPosition)
  return kept
}
