// @vitest-environment jsdom
/**
 * 远程重复 URL 引用定位回归。
 *
 * 背景：`Figure-Diagnostic-Locator-V1-Remote-Test.md` 中 Case W1 有两个**完全相同**的
 * GitHub 图片 URL。修复前，两处引用共用 `rawLineOrdinal = 0`，定位器把第二处
 * 再次绑定到第一个 DOM 块，导致 `WRONG_TARGET` / `WRONG_FIRST_MATCH` 计数为 1。
 *
 * 本测试只使用远程副本夹具，不替代本地资源基准（本地基准确认存在性、缺图诊断、
 * PNG 内容与 SHA-256 仍由 Figure-Diagnostic-Locator-V1-Test.md 承担）。
 *
 * 覆盖：上传 / 下载后的引用改写、重新渲染、文档切换、滚动之后的引用定位，
 * 并断言覆盖率指标真实达到门槛（不是 0 下限）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeDocumentDiagnostics, buildFigureSourceOccurrences } from './document-diagnostics'
import type { DocumentDiagnosticsInput } from './document-diagnostics'
import { parseMarkdownImageReferences } from '../image-management/image-asset-model'
import {
  rewriteReferenceDestination,
  selectMarkdownImageReference,
} from '../image-management/image-reference-rewrite'
import { parseImageSourceOccurrences } from './document-resource-scanner'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

const DOCUMENT_KEY = 'runtime/smoke/Figure-Diagnostic-Locator-V1-Remote-Test.md'
const DOCUMENT_PATH = `/vault/${DOCUMENT_KEY}`
const FIXTURE_PATH = resolve(process.cwd(), 'test/vault', DOCUMENT_KEY)
const FIXTURE_MARKDOWN = readFileSync(FIXTURE_PATH, 'utf8')
const W1_URL = 'https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/20261104-093908-7d5d02a14e.png'

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
let infoSpy: InfoSpy | null = null
let host: DocumentUtilityOverlayHost | null = null
let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1

function stubRaf(): void {
  rafTasks = new Map()
  rafSeq = 1
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
    (cb: FrameRequestCallback): number => { const id = rafSeq++; rafTasks.set(id, cb); return id }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number): void => { rafTasks.delete(id) }
}
async function flushRaf(): Promise<void> {
  let guard = 0
  while (rafTasks.size > 0 && guard++ < 400) {
    const cur = Array.from(rafTasks.values())
    rafTasks.clear()
    for (const cb of cur) cb(0)
    await Promise.resolve()
  }
}
function stubRect(el: Element, getRect: () => { left: number; top: number; right: number; bottom: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const r = getRect()
      return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }
    },
  })
}
function stubDecodedImg(el: HTMLImageElement, w = 24, h = 24): void {
  Object.defineProperty(el, 'complete', { configurable: true, value: true })
  Object.defineProperty(el, 'naturalWidth', { configurable: true, value: w })
  Object.defineProperty(el, 'naturalHeight', { configurable: true, value: h })
}
function stubRangeRectsByOffset(): void {
  const fake = {
    setStart(): void { /* noop */ },
    setEnd(): void { /* noop */ },
    selectNodeContents(): void { /* noop */ },
    getClientRects: () => [{ left: 300, top: 100, right: 324, bottom: 124, width: 24, height: 24 }],
  }
  ;(document as unknown as { createRange: () => unknown }).createRange = () => fake
}
function readAudit(spy: InfoSpy, event: string, nth = 0): Record<string, string> | null {
  const lines = spy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event))
  const line = lines[nth]
  if (!line) return null
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}
function locateAudit(nth: number): Record<string, string> {
  const audit = readAudit(infoSpy!, 'FIGURE-DIAGNOSTIC-LOCATOR-AUDIT', nth)
  expect(audit, `missing locator audit #${nth}`).not.toBeNull()
  return audit!
}
function coverageValue(h: DocumentUtilityOverlayHost, key: string): number {
  const line = h.getFixtureResourceV1CoverageReport().find(item => item.startsWith(`${key}=`))
  return Number(line?.split('=')[1] ?? '0')
}

function inputOf(markdown: string, missing: (t: string) => boolean = () => false): DocumentDiagnosticsInput {
  return {
    documentKey: DOCUMENT_KEY,
    markdown,
    strictMode: false,
    vaultRoot: 'D:/vault',
    headings: [], figures: [],
    figureSourceOccurrences: buildFigureSourceOccurrences({
      scanned: parseImageSourceOccurrences(markdown),
      documentKey: DOCUMENT_KEY,
      resolveCanonicalDestination: d => d,
      isLocalFileMissing: missing,
    }),
    tables: [], codes: [], formulas: [],
    links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
  }
}

/** One real DOM block per Markdown line that carries an image token. */
function buildDom(write: HTMLElement, markdown: string): void {
  const blocks: string[] = []
  markdown.split('\n').forEach((line, idx) => {
    if (!/!\[[^\]]*\]\([^)]+\)/.test(line)) return
    blocks.push(`<p data-line="${idx}">${line.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
      (_m, alt: string, dest: string) => `<img src="${dest}" alt="${alt}">`)}</p>`)
  })
  write.innerHTML = blocks.join('')
  for (const img of Array.from(write.querySelectorAll('img'))) {
    stubRect(img, () => ({ left: 300, top: 100, right: 324, bottom: 124 }))
    stubDecodedImg(img as HTMLImageElement)
  }
  for (const p of Array.from(write.querySelectorAll('p'))) {
    stubRect(p, () => ({ left: 300, top: 100, right: 700, bottom: 124 }))
  }
}

function diagnosticsSnapshot(markdown: string, documentKey = DOCUMENT_KEY): DocumentDiagnosticsSnapshot {
  const computed = computeDocumentDiagnostics({ ...inputOf(markdown), documentKey })
  return {
    documentKey,
    revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: computed.diagnostics,
    errorCount: computed.errorCount, warningCount: computed.warningCount, infoCount: computed.infoCount,
  } as unknown as DocumentDiagnosticsSnapshot
}

interface RemoteHost {
  h: DocumentUtilityOverlayHost
  write: HTMLElement
  snapshot: DocumentDiagnosticsSnapshot
  /** 模拟 Typora 切换文档：documentKey + Markdown + snapshot 一起变化。 */
  setDocument: (nextKey: string, next: string) => DocumentDiagnosticsSnapshot
}

function makeHost(markdown: string): RemoteHost {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  stubRect(shell, () => ({ left: 0, top: 0, right: 800, bottom: 600 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  const root = document.createElement('div')
  root.className = 'inkchapter-doc-overlay-root'
  stubRect(root, () => ({ left: 0, top: 0, right: 1536, bottom: 782 }))
  document.body.appendChild(root)

  let currentMarkdown = markdown
  let currentDocumentKey = DOCUMENT_KEY
  const ctx: DocumentUtilitiesContext = {
    authority: {
      getActiveFilePath: () => DOCUMENT_PATH,
      getDocumentKey: () => currentDocumentKey,
      getMarkdown: () => currentMarkdown,
      isStrictMode: () => false,
      vaultRoot: 'D:/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
  const providers: DocumentDiagnosticsProviders = {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false,
    getHeadingIdentity: (el) => el.getAttribute('data-id'),
    parseLocalLinkTargets: () => [],
  }
  const h = new DocumentUtilityOverlayHost({ ctx, providers })
  h.mount()

  const snapshot = diagnosticsSnapshot(markdown)
  const authority = (h as unknown as {
    diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void }
  }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for this fixture */ }
  const setDocument = (nextKey: string, next: string): DocumentDiagnosticsSnapshot => {
    currentDocumentKey = nextKey
    currentMarkdown = next
    authority.snapshot = diagnosticsSnapshot(next, nextKey)
    return authority.snapshot
  }
  return { h, write, snapshot, setDocument }
}

async function locate(h: DocumentUtilityOverlayHost, id: string): Promise<void> {
  ;(h as unknown as { locateDiagnostic(id: string): void }).locateDiagnostic(id)
  await flushRaf()
}

function w1Diagnostics(snapshot: DocumentDiagnosticsSnapshot): DocumentDiagnosticsSnapshot['diagnostics'] {
  return snapshot.diagnostics.filter(d => d.code === 'FIGURE_MISSING_NAME'
    && String((d.metadata as Record<string, unknown>)?.canonicalDestination ?? '') === W1_URL)
}

function assertZeroWrongTargetGates(h: DocumentUtilityOverlayHost): void {
  const gates = h.getFixtureResourceV1GateReport()
  expect(gates).toContain('RENDERED_FIGURE_OCCURRENCE_WRONG_TARGET_COUNT=0')
  expect(gates).toContain('DUPLICATE_DESTINATION_WRONG_FIRST_MATCH_COUNT=0')
  expect(gates).toContain('DUPLICATE_DESTINATION_AMBIGUITY_COUNT=0')
  expect(h.getFixtureResourceV1GateDecision().failedChecks).toEqual([])
}

/** 下载 / 上传改写：按 occurrence 序号定位引用，只改 destination。 */
function rewriteOccurrence(
  markdown: string,
  from: string,
  occurrenceIndex: number,
  to: string,
): string {
  const selection = selectMarkdownImageReference({
    markdown,
    documentPath: DOCUMENT_PATH,
    rawDestinations: [from],
    occurrenceIndex,
  })
  expect(selection.reference, `reference #${occurrenceIndex} for ${from}`).not.toBeNull()
  const next = rewriteReferenceDestination(markdown, selection.reference!, to)
  expect(next).not.toBeNull()
  return next!
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

describe('REMOTE-DUPLICATE — two identical GitHub URLs are two independent references', () => {
  it('assigns distinct reference identities while sharing the same remote URL', () => {
    const computed = computeDocumentDiagnostics(inputOf(FIXTURE_MARKDOWN))
    const w1 = computed.diagnostics.filter(d => d.code === 'FIGURE_MISSING_NAME'
      && String((d.metadata as Record<string, unknown>)?.canonicalDestination ?? '') === W1_URL)

    expect(w1).toHaveLength(2)
    const [first, second] = w1
    // 同一内容 URL：不是引用实例的唯一身份。
    expect(first.metadata?.canonicalDestination).toBe(second.metadata?.canonicalDestination)
    // Reference / occurrence identity 必须不同。
    expect(first.metadata?.figureOccurrenceIdentity).not.toBe(second.metadata?.figureOccurrenceIdentity)
    expect(first.metadata?.sourceRangeIdentity).not.toBe(second.metadata?.sourceRangeIdentity)
    expect(first.metadata?.sourceStart).not.toBe(second.metadata?.sourceStart)
    expect(first.metadata?.rawLineOrdinal).not.toBe(second.metadata?.rawLineOrdinal)

    // 引用实例身份：同一 URL 也必须得到不同的 Reference ID 与源偏移；
    // Asset ID 只有在建立资产映射后才存在，不能拿 URL 冒充引用身份。
    const refs = parseMarkdownImageReferences(FIXTURE_MARKDOWN, DOCUMENT_PATH)
      .filter(ref => ref.rawDestination === W1_URL)
    expect(refs).toHaveLength(2)
    expect(refs[0].referenceId).not.toBe(refs[1].referenceId)
    expect(refs[0].tokenStart).not.toBe(refs[1].tokenStart)
    expect(refs[0].assetId).toBeNull()
    expect(refs[1].assetId).toBeNull()
  })

  it('locates the two references to two DIFFERENT DOM nodes with zero wrong-target gates', async () => {
    const { h, write, snapshot } = makeHost(FIXTURE_MARKDOWN)
    host = h
    buildDom(write, FIXTURE_MARKDOWN)
    stubRangeRectsByOffset()

    const w1 = w1Diagnostics(snapshot)
    expect(w1).toHaveLength(2)

    await locate(h, w1[0].id)
    await locate(h, w1[1].id)

    const a0 = locateAudit(0)
    const a1 = locateAudit(1)
    expect(a0.resolveDecision).toBe('RESOLVED')
    expect(a1.resolveDecision).toBe('RESOLVED')
    expect(a0.resolvedNodeKind).toBe('img')
    expect(a1.resolvedNodeKind).toBe('img')
    expect(a0.resolvedBlockIdentity).not.toBe(a1.resolvedBlockIdentity)
    // 真实 DOM 目标（不是同一个 <img>）。
    expect(a0.resolvedBlockIdentity).toBe('dom-block:p:line:26')
    expect(a1.resolvedBlockIdentity).toBe('dom-block:p:line:28')

    assertZeroWrongTargetGates(h)

    // 覆盖率必须由真实发生的定位产生，而不是 0 下限的空断言。
    expect(coverageValue(h, 'RENDERED_FIGURE_OCCURRENCE_LOCATE_RUNTIME_COUNT')).toBeGreaterThanOrEqual(2)
    expect(coverageValue(h, 'DUPLICATE_DESTINATION_VISIBLE_OCCURRENCE_COUNT')).toBeGreaterThanOrEqual(2)
    expect(coverageValue(h, 'DUPLICATE_DESTINATION_DISTINCT_SOURCE_BLOCK_IDENTITY_COUNT')).toBeGreaterThanOrEqual(2)
    expect(coverageValue(h, 'DUPLICATE_DESTINATION_DISTINCT_OCCURRENCE_IDENTITY_COUNT')).toBeGreaterThanOrEqual(2)
    expect(coverageValue(h, 'DUPLICATE_DESTINATION_DISTINCT_RESOLVED_DOM_ELEMENT_COUNT')).toBeGreaterThanOrEqual(2)
    // 远程夹具只对本组覆盖项负责；本地资源基线（VISIBLE_FIXTURE_*）由本地
    // Figure-Diagnostic-Locator-V1-Test.md 的 preflight 单独负责，两者分开。
    expect(h.getFixtureResourceV1GateDecision().gateDecision).toBe('PASS')
  })

  it('keeps the binding after re-render, scroll and document switch', async () => {
    const { h, write, snapshot, setDocument } = makeHost(FIXTURE_MARKDOWN)
    host = h
    buildDom(write, FIXTURE_MARKDOWN)
    stubRangeRectsByOffset()

    const w1 = w1Diagnostics(snapshot)
    await locate(h, w1[0].id)
    await locate(h, w1[1].id)
    expect(locateAudit(0).resolvedBlockIdentity).toBe('dom-block:p:line:26')
    expect(locateAudit(1).resolvedBlockIdentity).toBe('dom-block:p:line:28')

    // ── 1. 重新渲染：Typora 替换整个内容 DOM 后，引用身份仍然有效。
    write.innerHTML = ''
    buildDom(write, FIXTURE_MARKDOWN)
    await locate(h, w1[0].id)
    await locate(h, w1[1].id)
    expect(locateAudit(2).resolvedBlockIdentity).toBe('dom-block:p:line:26')
    expect(locateAudit(3).resolvedBlockIdentity).toBe('dom-block:p:line:28')
    expect(locateAudit(2).resolvedBlockIdentity).not.toBe(locateAudit(3).resolvedBlockIdentity)

    // ── 2. 滚动：目标块移到视口下方后再次定位，仍是同一个引用实例。
    const paragraphs = Array.from(write.querySelectorAll('p')) as HTMLElement[]
    paragraphs.forEach((p, i) => stubRect(p, () => ({ left: 300, top: 2400 + i * 200, right: 700, bottom: 2524 + i * 200 })))
    await locate(h, w1[0].id)
    expect(locateAudit(4).resolveDecision).toBe('RESOLVED')
    expect(locateAudit(4).resolvedBlockIdentity).toBe('dom-block:p:line:26')

    // ── 3. 文档切换：另一文档只有一处同 URL，再切回后引用不串。
    const otherMarkdown = '# Other\n\n![](' + W1_URL + ')\n'
    const otherSnapshot = setDocument('runtime/smoke/Other-Doc.md', otherMarkdown)
    write.innerHTML = ''
    buildDom(write, otherMarkdown)
    const other = otherSnapshot.diagnostics.filter(d => d.code === 'FIGURE_MISSING_NAME')
    expect(other).toHaveLength(1)
    await locate(h, other[0].id)
    const otherAudit = locateAudit(5)
    expect(otherAudit.resolveDecision).toBe('RESOLVED')
    expect(otherAudit.resolvedBlockIdentity).toBe('dom-block:p:line:2')

    const restored = setDocument(DOCUMENT_KEY, FIXTURE_MARKDOWN)
    write.innerHTML = ''
    buildDom(write, FIXTURE_MARKDOWN)
    const restoredW1 = w1Diagnostics(restored)
    await locate(h, restoredW1[1].id)
    expect(locateAudit(6).resolvedBlockIdentity).toBe('dom-block:p:line:28')

    assertZeroWrongTargetGates(h)
    expect(coverageValue(h, 'DUPLICATE_DESTINATION_DISTINCT_RESOLVED_DOM_ELEMENT_COUNT')).toBeGreaterThanOrEqual(2)
  })

  it('keeps the binding after download / upload reference rewrites (alt and body untouched)', async () => {
    // ── 下载：两处相同 URL → 两个不同的本地相对路径。
    const downloaded = rewriteOccurrence(FIXTURE_MARKDOWN, W1_URL, 0, 'assets/w1-downloaded-1.png')
    const downloadedBoth = rewriteOccurrence(downloaded, W1_URL, 0, 'assets/w1-downloaded-2.png')
    expect(downloadedBoth).toContain('![](assets/w1-downloaded-1.png)')
    expect(downloadedBoth).toContain('![](assets/w1-downloaded-2.png)')
    expect(downloadedBoth).not.toContain(W1_URL)
    // alt / 正文 / 其它引用保持不变。
    expect(downloadedBoth).toContain('## Case W2 合法独立图片缺图名（occurrence locate）[EXPECTED_VISIBLE]')
    expect(downloadedBoth).toContain('before ![S1](')
    expect(downloadedBoth).toContain('![W3 expected missing](https://raw.githubusercontent.com/'
      + 'MoRanzhi1203/Picture_Bed/main/images/missing-local-image.png)')

    const { h, write, snapshot } = makeHost(downloadedBoth)
    host = h
    buildDom(write, downloadedBoth)
    stubRangeRectsByOffset()
    const downloadedDiags = snapshot.diagnostics.filter(d => d.code === 'FIGURE_MISSING_NAME'
      && /w1-downloaded-[12]\.png$/.test(String((d.metadata as Record<string, unknown>)?.canonicalDestination ?? '')))
    expect(downloadedDiags).toHaveLength(2)
    await locate(h, downloadedDiags[0].id)
    await locate(h, downloadedDiags[1].id)
    expect(locateAudit(0).resolveDecision).toBe('RESOLVED')
    expect(locateAudit(1).resolveDecision).toBe('RESOLVED')
    expect(locateAudit(0).resolvedBlockIdentity).not.toBe(locateAudit(1).resolvedBlockIdentity)

    // ── 下载复用：两处引用被改写为同一个本地路径（仍必须解析为两个实例）。
    host?.dispose()
    host = null
    const reusedLocal = rewriteOccurrence(
      rewriteOccurrence(FIXTURE_MARKDOWN, W1_URL, 0, 'assets/w1-reused.png'),
      W1_URL, 0, 'assets/w1-reused.png',
    )
    expect((reusedLocal.match(/\]\(assets\/w1-reused\.png\)/g) ?? [])).toHaveLength(2)
    const reusedHost = makeHost(reusedLocal)
    host = reusedHost.h
    buildDom(reusedHost.write, reusedLocal)
    const reusedDiags = reusedHost.snapshot.diagnostics.filter(d => d.code === 'FIGURE_MISSING_NAME'
      && String((d.metadata as Record<string, unknown>)?.canonicalDestination ?? '') === 'assets/w1-reused.png')
    expect(reusedDiags).toHaveLength(2)
    await locate(reusedHost.h, reusedDiags[0].id)
    await locate(reusedHost.h, reusedDiags[1].id)
    expect(locateAudit(0).resolvedBlockIdentity).not.toBe(locateAudit(1).resolvedBlockIdentity)
    assertZeroWrongTargetGates(reusedHost.h)

    // ── 上传：两处本地引用 → 两个不同的 GitHub URL（同一个内容，两次上传）。
    host?.dispose()
    host = null
    const uploaded = rewriteOccurrence(
      rewriteOccurrence(reusedLocal, 'assets/w1-reused.png', 0, 'https://example.com/uploads/w1-a.png'),
      'assets/w1-reused.png', 0, 'https://example.com/uploads/w1-b.png',
    )
    expect(uploaded).toContain('![](https://example.com/uploads/w1-a.png)')
    expect(uploaded).toContain('![](https://example.com/uploads/w1-b.png)')
    const uploadedHost = makeHost(uploaded)
    host = uploadedHost.h
    buildDom(uploadedHost.write, uploaded)
    const uploadedDiags = uploadedHost.snapshot.diagnostics.filter(d => d.code === 'FIGURE_MISSING_NAME'
      && /example\.com\/uploads\/w1-[ab]\.png$/.test(String((d.metadata as Record<string, unknown>)?.canonicalDestination ?? '')))
    expect(uploadedDiags).toHaveLength(2)
    await locate(uploadedHost.h, uploadedDiags[0].id)
    await locate(uploadedHost.h, uploadedDiags[1].id)
    expect(locateAudit(0).resolvedBlockIdentity).not.toBe(locateAudit(1).resolvedBlockIdentity)
    expect(locateAudit(0).resolvedNodeKind).toBe('img')
    expect(locateAudit(1).resolvedNodeKind).toBe('img')
    assertZeroWrongTargetGates(uploadedHost.h)
  })
})
