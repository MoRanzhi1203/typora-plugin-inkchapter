// @vitest-environment jsdom
/**
 * V3-UI — REAL producer coverage: every diagnostic of a mixed document owns a
 * real source line, even when the heading/link/code elements carry NO
 * `data-line` (the production Typora case).
 */
import { describe, expect, it } from 'vitest'
import {
  buildFigureSourceOccurrences,
  computeDocumentDiagnostics,
  SECTION_EMPTY_CODE,
  SECTION_ONLY_SUBHEADINGS_CODE,
  type DocumentDiagnosticsInput,
} from './document-diagnostics'
import { parseImageSourceOccurrences } from './document-resource-scanner'
import {
  diagnosticDisplayLine,
  flattenDiagnosticsToProjections,
} from './document-diagnostic-drawer-order-v514-r1'

const MARKDOWN = [
  '# 行号统一验收',            // 1
  '',
  '## 章节A',                 // 3
  '',
  '#### 跳级子标题',          // 5
  '',
  '## 重复标题',              // 7
  '',
  '## 重复标题',              // 9
  '',
  '正文 [本地链接](missing-link.md)', // 11
  '',
  '![缺失图片](assets/not-exist.png)', // 13
  '',
  '文字与图片 ![混排](a.png)', // 15
  '',
  '```md',                    // 17
  '![伪图片](fake.png',
  '```',                      // 19
  '',
  '## 章节B',                 // 21
  '',
  '### 只有子标题',           // 23
  '',
  '## 结束',                  // 25
  '',
  '',
].join('\n')

function headingElement(level: number, text: string): HTMLElement {
  const el = document.createElement(`h${level}`)
  el.textContent = text
  // Deliberately NO data-line: Typora does not guarantee it on headings.
  return el
}

function input(): DocumentDiagnosticsInput {
  const headings = [
    { level: 1, text: '行号统一验收', identity: 'H:0', line: 0 },
    { level: 2, text: '章节A', identity: 'H:1', line: 2 },
    { level: 4, text: '跳级子标题', identity: 'H:2', line: 4 },
    { level: 2, text: '重复标题', identity: 'H:3', line: 6 },
    { level: 2, text: '重复标题', identity: 'H:4', line: 8 },
    { level: 2, text: '章节B', identity: 'H:5', line: 20 },
    { level: 3, text: '只有子标题', identity: 'H:6', line: 22 },
    { level: 2, text: '结束', identity: 'H:7', line: 24 },
  ].map(h => ({
    level: h.level,
    text: h.text,
    stableIdentity: h.identity,
    element: headingElement(h.level, h.text),
  }))
  const code = document.createElement('pre')
  code.className = 'md-fences'
  const link = document.createElement('a')
  link.textContent = '本地链接'
  const figureSourceOccurrences = buildFigureSourceOccurrences({
    scanned: parseImageSourceOccurrences(MARKDOWN),
    documentKey: 'doc:line-coverage',
    resolveCanonicalDestination: d => d,
    isLocalFileMissing: () => true,
  })
  return {
    documentKey: 'doc:line-coverage',
    markdown: MARKDOWN,
    strictMode: false,
    vaultRoot: 'D:/vault',
    headings,
    figures: [],
    figureSourceOccurrences,
    tables: [],
    codes: [{ name: null, language: 'md', element: code, targetIdentity: 'block:code:0' }],
    formulas: [],
    links: [
      {
        target: 'missing-link.md',
        element: link,
        index: 0,
        resourceKind: 'link',
        targetIdentity: 'local:missing-link.md',
        startLine: 10,
        endLine: 10,
        sourceStart: 0,
        sourceEnd: 0,
      },
      // The producer consumes MISSING local image facts from `links`
      // (resourceKind='image'), never a rendered <img>.
      {
        target: 'assets/not-exist.png',
        element: null,
        index: 1,
        resourceKind: 'image',
        targetIdentity: 'local:assets/not-exist.png',
        startLine: 12,
        endLine: 12,
        rawToken: '![缺失图片](assets/not-exist.png)',
        altText: '缺失图片',
        resourceClass: 'local',
      },
    ],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
  }
}

function diagnosticsOf(markdown: string = MARKDOWN, overrides: Partial<DocumentDiagnosticsInput> = {}) {
  return computeDocumentDiagnostics({ ...input(), markdown, ...overrides }).diagnostics
}

function lineOf(markdown: string, code: string): number | null {
  const d = diagnosticsOf(markdown).find(x => x.code === code)
  expect(d, `missing ${code}`).toBeTruthy()
  return typeof d!.metadata?.['startLine'] === 'number' ? d!.metadata!['startLine'] as number : null
}

describe('V3-UI — 混合文档全规则行号', () => {
  it('heading / section / link / code / figure rules expose REAL 0-based lines', () => {
    expect(lineOf(MARKDOWN, 'HEADING_LEVEL_GAP')).toBe(4) // H3 on 1-based 5
    expect(lineOf(MARKDOWN, 'HEADING_DUPLICATE_TEXT')).toBe(8) // second duplicate on 1-based 9
    expect(lineOf(MARKDOWN, 'LINK_LOCAL_TARGET_MISSING')).toBe(10)
    expect(lineOf(MARKDOWN, 'CODE_MISSING_NAME')).toBe(16)
    expect(lineOf(MARKDOWN, 'FIGURE_LOCAL_IMAGE_MISSING')).toBe(12)
    expect(lineOf(MARKDOWN, 'FIGURE_TEXT_MIXED')).toBe(14)
    expect(
      diagnosticsOf().filter(d => d.code === SECTION_ONLY_SUBHEADINGS_CODE || d.code === SECTION_EMPTY_CODE)
        .map(d => d.metadata?.['startLine'])
        .sort((a, b) => Number(a) - Number(b)),
    ).toEqual([2, 4, 6, 20, 22, 24])
  })

  it('every diagnostic resolves a projection line with NO DOM data-line context', () => {
    const projections = flattenDiagnosticsToProjections(diagnosticsOf(), {
      documentLineCount: MARKDOWN.split('\n').length,
    })
    expect(projections.length).toBeGreaterThan(0)
    for (const p of projections) {
      expect(p.sourceLine, `${p.ruleId} (${p.diagnosticId})`).not.toBeNull()
      expect(diagnosticDisplayLine(p.sourceLine)).toBeGreaterThan(0)
    }
  })

  it('LF / CRLF / first line / Unicode keep the same line mapping', () => {
    const lf = MARKDOWN
    const crlf = MARKDOWN.replace(/\n/g, '\r\n')
    expect(lineOf(lf, 'HEADING_LEVEL_GAP')).toBe(lineOf(crlf, 'HEADING_LEVEL_GAP'))
    const unicode = ['# 标题 😀', '', '## 章节', '', '#### 子 😀', ''].join('\n')
    const d = diagnosticsOf(unicode, { headings: [
      { level: 1, text: '标题 😀', stableIdentity: 'U:0', element: headingElement(1, '标题 😀') },
      { level: 2, text: '章节', stableIdentity: 'U:1', element: headingElement(2, '章节') },
      { level: 4, text: '子 😀', stableIdentity: 'U:2', element: headingElement(4, '子 😀') },
    ] }).find(x => x.code === 'HEADING_LEVEL_GAP')
    expect(d?.metadata?.['startLine']).toBe(4)
  })
})
