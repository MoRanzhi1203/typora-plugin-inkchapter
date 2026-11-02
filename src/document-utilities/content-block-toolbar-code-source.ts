/**
 * 内容块工具栏 — 围栏代码源文本解析（纯函数，只读）。
 *
 * 仅在 CodeMirror 实例不可用时作为回退：按围栏在文档中的顺序（与
 * `pre.md-fences` 的 DOM 顺序一致）取出**源文本**。
 *
 * 语义与 Typora CodeMirror 的 `getValue()` 对齐：
 * - 不含围栏标记（``` / ~~~）与语言信息串；
 * - 行间用 `\n`，**不含**闭合围栏前的最后一个换行；
 * - 保留前导空格、制表符、内部空行、Unicode 与行尾空白。
 * 绝不使用渲染后 DOM 的 `innerText`（含行号/CodeMirror 脚手架）。
 */

export interface FencedCodeBlock {
  /** 语言信息串（已 trim，可含 mermaid 等附加参数）。 */
  info: string
  /** 源文本（与 CodeMirror doc 值同构）。 */
  text: string
  /** 起始围栏所在行（0 基）。 */
  lineStart: number
  /** 结束围栏所在行（未闭合时为最后一行）。 */
  lineEnd: number
  /** 是否找到闭合围栏。 */
  closed: boolean
}

export interface FenceSourceLookup {
  found: boolean
  /** 围栏源文本；found=false 时为 null。 */
  text: string | null
  block: FencedCodeBlock | null
}

function normalizeLineBreaks(markdown: string): { text: string; endedWithNewline: boolean } {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return { text: normalized, endedWithNewline: normalized.endsWith('\n') }
}

const OPENING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})([^\n]*)$/
const CLOSING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})[ \t]*$/

/**
 * 解析 Markdown 中全部围栏代码块（CommonMark 基本子集）。
 * 未闭合的围栏解析到文档末尾，`closed=false`。
 */
export function parseFencedCodeBlocks(markdown: string): FencedCodeBlock[] {
  const { text, endedWithNewline } = normalizeLineBreaks(markdown ?? '')
  if (text === '') return []
  const lines = text.split('\n')
  const blocks: FencedCodeBlock[] = []

  let i = 0
  while (i < lines.length) {
    const opening = OPENING_FENCE_RE.exec(lines[i])
    if (!opening) {
      i++
      continue
    }
    const indent = opening[1].length
    const marker = opening[2]
    const info = opening[3].trim()
    // CommonMark：反引号围栏的信息串内不得出现反引号，否则不是围栏。
    if (marker[0] === '`' && info.includes('`')) {
      i++
      continue
    }

    const stripIndent = (line: string): string => {
      if (indent === 0) return line
      let n = 0
      while (n < indent && line[n] === ' ') n++
      return line.slice(n)
    }

    const content: string[] = []
    let j = i + 1
    let closed = false
    let closeLine = lines.length - 1
    for (; j < lines.length; j++) {
      const closing = CLOSING_FENCE_RE.exec(lines[j])
      if (closing && closing[2][0] === marker[0] && closing[2].length >= marker.length) {
        closed = true
        closeLine = j
        break
      }
      content.push(stripIndent(lines[j]))
    }
    // 未闭合且文档以换行结尾时，split 会多出一个空元素；它不是代码行。
    if (!closed && endedWithNewline && content.length > 0 && content[content.length - 1] === '') {
      content.pop()
    }

    blocks.push({
      info,
      text: content.join('\n'),
      lineStart: i,
      lineEnd: closed ? closeLine : lines.length - 1,
      closed,
    })
    i = closed ? closeLine + 1 : lines.length
  }
  return blocks
}

/** 按 DOM 顺序取出第 `ordinal` 个围栏的源文本。 */
export function lookupFenceSource(markdown: string, ordinal: number): FenceSourceLookup {
  if (!Number.isInteger(ordinal) || ordinal < 0) return { found: false, text: null, block: null }
  const blocks = parseFencedCodeBlocks(markdown)
  const block = blocks[ordinal] ?? null
  if (!block) return { found: false, text: null, block: null }
  return { found: true, text: block.text, block }
}

/**
 * 从活动代码块元素读取 CodeMirror 的真实源文本（只读）。
 *
 * 为什么优先于 Markdown 解析：语言栏位于 PRE 内部后，部分环境的 Markdown
 * 序列化会把 PRE 的渲染文本（行号占位、语言栏文字）当作代码内容并压成一行。
 * CodeMirror 的 `getValue()` 是文档模型权威，且与复制功能使用同一来源。
 */
export function readFenceSourceFromElement(element: HTMLElement | null | undefined): string | null {
  try {
    const wrapper = element?.querySelector('.CodeMirror') as
      (HTMLElement & { CodeMirror?: { getValue?: () => string } }) | null
    const value = wrapper?.CodeMirror?.getValue?.()
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

/** 目标围栏在编辑器根内的序号（与 Markdown 围栏顺序一致）。 */
export function codeFenceOrdinal(element: HTMLElement, editorRoot: HTMLElement): number {
  try {
    return Array.from(editorRoot.querySelectorAll<HTMLElement>('pre.md-fences')).indexOf(element)
  } catch {
    return -1
  }
}
