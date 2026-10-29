/**
 * Paragraph Indent V2 — Empty Paragraph Deletion Ownership (P0, RED → GREEN).
 *
 * 实机缺陷（app-1793308458675，审计通道 runtime-sess-1793308372475，21:14:10.913–.939）：
 *
 *   BOUNDARY-MERGE-INTENT-ARM  leftSemantic=auto  rightSemantic=force-indent
 *                              leftRecordId=none  rightRecordId=indent-1793308449794-63
 *   TRANSFER-PLAN              recordId=indent-1793308449794-63 → P-RUNTIME-25
 *   PARAGRAPH-MERGE-FINAL      semanticWinner=force-indent mergeReason=SINGLE_OWNER overall=true
 *
 * 用户按 Backspace 删除的是一个“空的、显式首行缩进”的段落，正文全部来自左侧
 * auto 段落；插件却把被删空段落的 force-indent 记录转移给了保留下来的正文段落。
 *
 * 规则（Empty Paragraph Deletion Ownership Rule）：
 *   唯一 canonical owner 位于**纯空白**一侧，且合并后的可见正文能够证明来自另一侧时，
 *   该记录必须退役（不转移），保留段落按自身语义 + 文档/全局 defaultIndent 投影。
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest'
import {
  resolveMergeOwnerRetirement,
  resolveMergeSemantic,
  isBlankParagraphText,
  computeParagraphLogicalCaretOffset,
  clearParagraphIndentVisualAndSemantic,
  applyIndentMarkerProjection,
  setParagraphIndentMode,
  getParagraphIndentMode,
  getUserVisibleParagraphText,
  rehydrateParagraphIndentState,
  readParagraphIndentCommand,
  INDENT_MODE_ATTR,
  INDENT_MARKER_ATTR,
} from './paragraph-indent-manager'
import { DEFAULT_PARAGRAPH_LAYOUT } from './heading-types'

const INDENT_CLASS = 'inkchapter-paragraph-effective-indent-2'

describe('EMPTY-DELETE-1 被删除的空缩进段落：记录退役，不转移给正文段落', () => {
  it('Backspace：右侧空 force-indent、左侧正文 auto → RETIRE', () => {
    expect(resolveMergeOwnerRetirement({
      ownerSide: 'right',
      leftText: '正文段落。',
      rightText: '',
    })).toBe('RETIRE_EMPTY_PARA_OWNER')
  })

  it('Delete：左侧空 force-indent、右侧正文 auto → RETIRE（反向场景）', () => {
    expect(resolveMergeOwnerRetirement({
      ownerSide: 'left',
      leftText: '',
      rightText: '正文段落。',
    })).toBe('RETIRE_EMPTY_PARA_OWNER')
  })

  it('纯空白占位符（U+200B / 空格 / NBSP）同样视为空段落', () => {
    for (const filler of ['\u200B', '   ', '\u00A0', '\u200B \u00A0']) {
      expect(resolveMergeOwnerRetirement({
        ownerSide: 'right',
        leftText: '正文',
        rightText: filler,
      })).toBe('RETIRE_EMPTY_PARA_OWNER')
    }
  })

  it('owner 位于有正文的一侧 → 保持转移（格式属于存活内容）', () => {
    expect(resolveMergeOwnerRetirement({
      ownerSide: 'left',
      leftText: '正文段落。',
      rightText: '',
    })).toBe('TRANSFER_SINGLE_OWNER')
  })

  it('两侧都为空 → 来源不可证明，保持原行为（TRANSFER）', () => {
    expect(resolveMergeOwnerRetirement({
      ownerSide: 'right',
      leftText: '',
      rightText: '',
    })).toBe('TRANSFER_SINGLE_OWNER')
  })

  it('两侧都有正文 → 不适用空段落规则（TRANSFER）', () => {
    expect(resolveMergeOwnerRetirement({
      ownerSide: 'right',
      leftText: '左正文',
      rightText: '右正文',
    })).toBe('TRANSFER_SINGLE_OWNER')
  })

  it('owner 缺失 → TRANSFER（由既有路径处理）', () => {
    expect(resolveMergeOwnerRetirement({
      ownerSide: 'none',
      leftText: '正文',
      rightText: '',
    })).toBe('TRANSFER_SINGLE_OWNER')
  })
})

describe('EMPTY-DELETE-2 退役后保留段落必须是 auto（不得写成 flush）', () => {
  it('清除被转移过来的 force-indent 投影：语义/标记/缩进 class 全部还原', () => {
    const p = document.createElement('p')
    p.textContent = '诊断验证请勿在此文件进行'
    setParagraphIndentMode(p, 'force-indent')
    p.classList.add(INDENT_CLASS)
    applyIndentMarkerProjection(p, 'force-indent')
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBe('explicit-2')

    clearParagraphIndentVisualAndSemantic(p, 'test-retire')

    expect(getParagraphIndentMode(p)).toBe('auto')
    expect(p.hasAttribute(INDENT_MODE_ATTR)).toBe(false)
    expect(p.hasAttribute(INDENT_MARKER_ATTR)).toBe(false)
    expect(p.classList.contains(INDENT_CLASS)).toBe(false)
    // 没有写成 force-flush：auto 由 defaultIndent 决定
    expect(getParagraphIndentMode(p)).not.toBe('force-flush')
  })
})

describe('EMPTY-DELETE-2b 退役后按 defaultIndent 投影（不得强制 flush）', () => {
  it('defaultIndent=indent-2 时，auto 段落按默认缩进投影而非 flush', () => {
    const p = document.createElement('p')
    p.textContent = '正文段落。'
    rehydrateParagraphIndentState(p, 'auto', {
      ...DEFAULT_PARAGRAPH_LAYOUT,
      defaultIndent: 'indent-2',
    }, {
      source: 'dom-rebuild-restore',
      semanticWriterId: 'test-retire',
      visualWriterId: 'test-retire',
    })

    expect(p.classList.contains(INDENT_CLASS)).toBe(true)
    expect(p.hasAttribute(INDENT_MODE_ATTR)).toBe(false)
    expect(p.hasAttribute(INDENT_MARKER_ATTR)).toBe(false)
  })

  it('defaultIndent=flush 时，auto 段落为 flush', () => {
    const p = document.createElement('p')
    p.textContent = '正文段落。'
    rehydrateParagraphIndentState(p, 'auto', DEFAULT_PARAGRAPH_LAYOUT, {
      source: 'dom-rebuild-restore',
      semanticWriterId: 'test-retire',
      visualWriterId: 'test-retire',
    })

    expect(p.classList.contains(INDENT_CLASS)).toBe(false)
    expect(p.hasAttribute(INDENT_MODE_ATTR)).toBe(false)
  })
})

describe('EMPTY-DELETE-4 全角快捷命令（。。）与半角（..）走同一所有权规则', () => {
  for (const token of ['..', '。。'] as const) {
    it(`命令令牌 "${token}" 可识别，消费后段落为空 ⇒ 删除时 RETIRE`, () => {
      const p = document.createElement('p')
      p.textContent = token
      expect(readParagraphIndentCommand(p)).toBe(token)
      expect(getUserVisibleParagraphText(p)).toBe(token)
      expect(isBlankParagraphText(getUserVisibleParagraphText(p))).toBe(false)

      // clearParagraphToken(): the paragraph becomes a native empty paragraph.
      p.textContent = ''
      expect(getUserVisibleParagraphText(p)).toBe('')
      expect(isBlankParagraphText(getUserVisibleParagraphText(p))).toBe(true)

      // Deleting that (now blank) indented line must retire, not transfer.
      expect(resolveMergeOwnerRetirement({
        ownerSide: 'right',
        leftText: '正文段落。',
        rightText: getUserVisibleParagraphText(p),
      })).toBe('RETIRE_EMPTY_PARA_OWNER')
    })
  }

  it('全角令牌不是空白文本，不会被误判为“空段落所有者”', () => {
    expect(isBlankParagraphText('。。')).toBe(false)
    expect(isBlankParagraphText('..')).toBe(false)
  })
})

describe('EMPTY-DELETE-5 force-flush 组合：正文保持自己的 force-flush', () => {
  it('Backspace 冲突策略选中空 force-indent 侧 ⇒ 空段落规则仍必须接管', () => {
    // left body force-flush (proven), right blank force-indent (proven)
    const semantic = resolveMergeSemantic('backspace', 'force-flush', 'force-indent')
    expect(semantic.reason).toBe('CONFLICT_BACKSPACE_RIGHT')
    const semanticWinnerSide = semantic.winner === 'force-flush' ? 'left' : 'right'
    expect(semanticWinnerSide).toBe('right')

    // The semantic winner is the BLANK paragraph — the service must swap the
    // transfer source back to the body side instead of lending its format.
    expect(resolveMergeOwnerRetirement({
      ownerSide: 'right',
      leftText: '正文段落。',
      rightText: '',
    })).toBe('RETIRE_EMPTY_PARA_OWNER')
  })

  it('Delete 冲突策略选中空 force-indent 侧（左侧）⇒ 同样 RETIRE', () => {
    const semantic = resolveMergeSemantic('delete', 'force-indent', 'force-flush')
    expect(semantic.reason).toBe('CONFLICT_DELETE_LEFT')
    const semanticWinnerSide = semantic.winner === 'force-indent' ? 'left' : 'right'
    expect(semanticWinnerSide).toBe('left')
    expect(resolveMergeOwnerRetirement({
      ownerSide: 'left',
      leftText: '',
      rightText: '正文段落。',
    })).toBe('RETIRE_EMPTY_PARA_OWNER')
  })

  it('空的 force-flush 段落作为唯一记录：同样退役（规则与语义无关）', () => {
    expect(resolveMergeOwnerRetirement({
      ownerSide: 'left',
      leftText: '',
      rightText: '正文段落。',
    })).toBe('RETIRE_EMPTY_PARA_OWNER')
    expect(resolveMergeOwnerRetirement({
      ownerSide: 'right',
      leftText: '正文段落。',
      rightText: '',
    })).toBe('RETIRE_EMPTY_PARA_OWNER')
  })

  it('退役清理同样适用于 force-flush 投影（class/属性/marker 全部还原为 auto）', () => {
    const p = document.createElement('p')
    p.textContent = '正文段落。'
    setParagraphIndentMode(p, 'force-flush')
    p.classList.add('inkchapter-paragraph-effective-flush')
    applyIndentMarkerProjection(p, 'force-indent')

    clearParagraphIndentVisualAndSemantic(p, 'test-retire-flush')

    expect(getParagraphIndentMode(p)).toBe('auto')
    expect(p.hasAttribute(INDENT_MODE_ATTR)).toBe(false)
    expect(p.hasAttribute(INDENT_MARKER_ATTR)).toBe(false)
    expect(p.classList.contains('inkchapter-paragraph-effective-flush')).toBe(false)
  })
})

describe('EMPTY-DELETE-3 光标期望值必须是“段落逻辑偏移”而不是节点内偏移', () => {
  it('跨内联节点的逻辑偏移', () => {
    const p = document.createElement('p')
    p.innerHTML = '<span>诊断验证请勿在此文件进行；请在</span><strong>同一个已加载墨章的窗口</strong>中从左侧文件树打开：'
    const lastText = p.lastChild as Text
    expect(computeParagraphLogicalCaretOffset(p, lastText, lastText.length)).toBe(36)
    const strongText = (p.querySelector('strong')!.firstChild) as Text
    expect(computeParagraphLogicalCaretOffset(p, strongText, 3)).toBe(18)
    expect(computeParagraphLogicalCaretOffset(p, p.firstChild!.firstChild as Text, 0)).toBe(0)
  })

  it('空段落偏移恒为 0', () => {
    const p = document.createElement('p')
    expect(computeParagraphLogicalCaretOffset(p, p, 0)).toBe(0)
  })
})
