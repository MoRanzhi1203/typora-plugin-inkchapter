/**
 * LAYOUT-INVALIDATION 回归 — 侧栏分隔线拖拽导致诊断标记定位错误。
 *
 * Runtime 证据：拖动左侧文件树与编辑区之间的分隔线后，编辑区宽度 578→878，
 * 正文起始 X 571.8→277，诊断标记偏移/错位/旧高亮残留（`ResizeObserver loop limit
 * exceeded`）。根因：编辑区几何真实变化后（文本重排），已提交的标记**从未重测**，
 * 仍复用旧的 origin/rect。
 *
 * 本测试锁定修复契约：
 *  - 以「编辑区真实几何」为失效信号（非仅 window.resize、非内容变更）；
 *  - 几何变化 → 递增 layoutInvalidateEpoch → 在合并 rAF 内**重测**已提交视觉；
 *  - 重测带 generation + 文档身份守卫（旧事务不得覆盖新事务）；
 *  - 视觉被清理后不得再被重测（禁止残影/复活）；
 *  - 回调只采样几何 + 调度合并刷新，无轮询、无反馈写样式。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HOST_SRC = readFileSync(
  resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8',
)

describe('LAYOUT-INVALIDATION — 侧栏拖拽几何失效与重测', () => {
  it('以编辑区真实几何为失效信号（非仅 window.resize）', () => {
    expect(HOST_SRC).toContain('LAYOUT-INVALIDATION')
    expect(HOST_SRC).toContain('const rect = container?.getBoundingClientRect()')
    expect(HOST_SRC).toContain('geometryChanged')
    expect(HOST_SRC).toContain("remeasureActiveVisualOnLayoutChange('EDITOR_GEOMETRY_CHANGED')")
    // 拖拽必须不能被当成文档内容变更
    expect(HOST_SRC).toContain('a divider drag must never be treated as a document edit')
  })

  it('几何变化递增 generation 并重测已提交视觉', () => {
    expect(HOST_SRC).toContain('this.layoutInvalidateEpoch++')
    expect(HOST_SRC).toContain('this.commitDiagnosticLocateVisual(')
    expect(HOST_SRC).toContain('this.remeasureActiveVisualOnLayoutChange')
  })

  it('重测带 generation + 文档身份守卫（旧事务不得覆盖新事务）', () => {
    expect(HOST_SRC).toContain('documentKey !== inputs.documentKey')
    expect(HOST_SRC).toContain('if (epoch !== this.layoutInvalidateEpoch) return')
    expect(HOST_SRC).toContain('DOCUMENT-DIAGNOSTIC-LAYOUT-INVALIDATION-REMEASURE')
  })

  it('视觉清理后不得再被重测（防残影/复活）', () => {
    const clearFn = HOST_SRC.slice(HOST_SRC.indexOf('private clearDiagnosticLocateVisual'))
    expect(clearFn.slice(0, 600)).toContain('this.lastLocateVisualInputs = null')
  })

  it('只在 ACTIVE 相位重测，且不重跑点击转移', () => {
    const fn = HOST_SRC.slice(HOST_SRC.indexOf('private remeasureActiveVisualOnLayoutChange'))
    const body = fn.slice(0, 1600)
    expect(body).toContain("this.diagnosticInteractionState.phase !== 'ACTIVE'")
    expect(body).not.toContain('reduceDiagnosticClick')
    expect(body).not.toContain('commitDiagnosticTransitionV2')
  })

  it('无轮询、无新增观察器', () => {
    const fn = HOST_SRC.slice(HOST_SRC.indexOf('private remeasureActiveVisualOnLayoutChange'))
    const body = fn.slice(0, 1600)
    expect(body).not.toContain('setInterval')
    expect(body).not.toContain('new ResizeObserver')
    expect(body).not.toContain('new MutationObserver')
  })
})

describe('PASSIVE 几何失效 — 侧栏拖拽后非激活标记同样重测', () => {
  it('根因：内容变更路径只在 realContentMutation 时失效（侧栏拖拽无 DOM 变更 → 永不触发）', () => {
    // EDITOR_REFLOW 只在 realContentMutation 内被调用 —— 这正是 Passive 变陈旧的原因
    const idx = HOST_SRC.indexOf("invalidateDiagnosticVisualGeometry('EDITOR_REFLOW')")
    expect(idx).toBeGreaterThan(0)
    const before = HOST_SRC.slice(Math.max(0, idx - 900), idx)
    expect(before).toContain('if (realContentMutation)')
  })

  it('统一失效：编辑区几何变化驱动 PASSIVE reconcile（非点击状态机）', () => {
    expect(HOST_SRC).toContain("this.invalidateDiagnosticVisualGeometry('EDITOR_LAYOUT_INVALIDATION')")
    // reason 必须避开 scoped skip，强制 FULL reconcile
    const fn = HOST_SRC.slice(HOST_SRC.indexOf('private invalidateDiagnosticVisualGeometry'))
    const body = fn.slice(0, 1400)
    expect(body).toContain('PLUGIN_DOM_MUTATION|RECONCILE')
    expect(body).toContain('this.headingVisualDirtyScope = null')
    // 不进入点击状态机
    expect(body).not.toContain('commitDiagnosticTransitionV2')
    expect(body).not.toContain('reduceDiagnosticClick')
  })

  it('reconcile 的触发条件同时覆盖 Passive 与 Active', () => {
    const fn = HOST_SRC.slice(HOST_SRC.indexOf('private hasDiagnosticGeometryToReconcile'))
    const body = fn.slice(0, 400)
    expect(body).toContain('headingPassiveMarkers.size > 0')
    expect(body).toContain("locateFrame?.hasCommitted() === true")
  })

  it('Passive 视觉就绪同时校验 layoutEpoch 与 geometryGeneration', () => {
    const fn = HOST_SRC.slice(HOST_SRC.indexOf('private activeHeadingVisualReadiness'))
    const body = fn.slice(0, 900)
    expect(body).toContain('currentLayoutEpoch')
    expect(body).toContain('currentGeometryGeneration')
  })

  it('统一失效入口以 fixed geometry generation 递增（一次 reconcile 一个代次）', () => {
    const fn = HOST_SRC.slice(HOST_SRC.indexOf('private bumpVisualGeometryGeneration'))
    const body = fn.slice(0, 500)
    expect(body).toContain('this.visualGeometryGeneration')
  })
})

describe('SCROLL 坐标 — 已提交的视口层定位框必须随滚动重同步（category C 纯平移）', () => {
  it('视口层事实：overlay root 为 position:fixed（故内容滚动它不会动）', () => {
    expect(HOST_SRC).toContain("root.style.cssText = 'position:fixed;inset:0")
  })

  it('根因：post-commit 滚动分支曾 INERT + 现补重同步入口', () => {
    const body = HOST_SRC.slice(
      HOST_SRC.indexOf('private onEditorScrollForLocateFrame'),
      HOST_SRC.indexOf('private onEditorScrollForLocateFrame') + 2400,
    )
    expect(body).toContain('this.auditPostCommitScrollInert()')
    expect(body).toContain('if (!this.committedVisualIsDocumentSpacePresented())')
    expect(body).toContain('this.scheduleCommittedFrameScrollResync()')
  })

  it('门禁：文档局载体（表格/代码/inline/EOF）仍保持 scroll-INERT（V5.11/V5.12 契约不回归）', () => {
    const idx = HOST_SRC.indexOf('private committedVisualIsDocumentSpacePresented')
    const body = HOST_SRC.slice(idx, idx + 500)
    expect(body).toContain('this.locateDocCarrier != null')
    expect(body).toContain('this.locateDocEndCarrier != null')
    expect(body).toContain("getStructure().kind === 'inline'")
  })

  it('重同步为纯平移：只改绘制变换，不重解析/不写 scrollTop/不重入事务/无轮询', () => {
    const idx = HOST_SRC.indexOf('private scheduleCommittedFrameScrollResync')
    const body = HOST_SRC.slice(idx, idx + 1500)
    expect(body).toContain('this.repositionDiagnosticLocateFrame(true)')
    expect(body).not.toContain('scrollTop =')
    expect(body).not.toContain('reduceDiagnosticClick')
    expect(body).not.toContain('finishLocateTransaction')
    expect(body).not.toContain('setInterval')
    expect(body).not.toContain('new ResizeObserver')
  })

  it('单帧合并 + 代次守卫（旧滚动不得覆盖新位置）', () => {
    const idx = HOST_SRC.indexOf('private scheduleCommittedFrameScrollResync')
    const body = HOST_SRC.slice(idx, idx + 1500)
    expect(body).toContain('if (this.committedFrameScrollRafHandle !== null) return')
    expect(body).toContain('expectedEpoch !== this.locateVisualEpoch')
    expect(body).toContain('if (this.locateScrollLeaseActive()) return')
  })
})

describe('EOF 载体几何失效 — 侧栏拖拽后文档末尾带同样重测（ROOT_EOF_LIVE_COMPARATOR）', () => {
  it('根因：EOF 带的水平范围仅在 locate/scroll 提交路径求导，无拖拽重求导分支', () => {
    // 唯一的几何写入入口是 commitSyntheticEofVisual（locate/scroll 路径）
    const commitIdx = HOST_SRC.indexOf('private commitSyntheticEofVisual')
    expect(commitIdx).toBeGreaterThan(0)
    // 该 carrier 通道与 block-gap 同类，均属「提交期固定尺寸」缺陷
    expect(HOST_SRC).toContain('this.locateDocEndCarrier = el')
  })

  it('编辑区几何真实变化 → 文档末尾带以 LIVE 几何重求导（与 block-gap 同一权威）', () => {
    expect(HOST_SRC).toContain('this.rederiveSyntheticEofVisualOnLayoutChange()')
    const fn = HOST_SRC.slice(HOST_SRC.indexOf('private rederiveSyntheticEofVisualOnLayoutChange'))
    const body = fn.slice(0, 1600)
    // 只有已连接的真实载体才重求导
    expect(body).toContain('this.locateDocEndCarrier')
    expect(body).toContain('.isConnected')
    // 重求导走唯一权威，且刷新已提交几何事实
    expect(body).toContain('this.recomputeSyntheticEofPresentation(')
    expect(body).toContain('this.lastDocEndClosureFacts.presentationRect')
    expect(body).toContain('DOCUMENT-DIAGNOSTIC-EOF-LAYOUT-REMEASURE')
  })

  it('重求导用真实测量（尾随空行 + 内容列 + 文本列），绝不使用常量/存储值', () => {
    const fn = HOST_SRC.slice(HOST_SRC.indexOf('private recomputeSyntheticEofPresentation'))
    const body = fn.slice(0, 2400)
    expect(body).toContain('this.measureTrailingBlankGeometry()')
    expect(body).toContain('this.measureSemanticContentColumnRect()')
    expect(body).toContain('this.measureDocumentTextColumnLeft(')
    expect(body).toContain('viewportRectToDocumentLocalRect(')
    // 无轮询 / 无新增观察器
    expect(body).not.toContain('setInterval')
    expect(body).not.toContain('new ResizeObserver')
    expect(body).not.toContain('new MutationObserver')
  })

  it('EOF 闭合审计带 LIVE 对照字段（不再自引用提交期几何）', () => {
    const idx = HOST_SRC.indexOf('const liveEofColumn = this.measureSemanticContentColumnRect()')
    expect(idx).toBeGreaterThan(0)
    for (const field of [
      'liveContentColumnRect',
      'liveDocumentTextColumnLeft',
      'endBandOverhangPx',
      'endBandAnchorDriftPx',
      'endBandGeometryDecision',
    ]) {
      expect(HOST_SRC).toContain(field)
    }
    // 外溢超容差 → 计入当前事务的绘制漂移计数（可被门禁捕获）
    expect(HOST_SRC).toContain('this.docSpaceCarrierPaintDriftCurrentTx++')
  })
})

describe('ROOT_BLANK_LAYOUT_REDERIVE / ROOT_BLANK_SOURCE_AUTHORITY — 契约', () => {
  it('空白带自有输入持久化，布局失效时用「自有输入优先」重求导（不被冻结）', () => {
    expect(HOST_SRC).toContain('this.locateCommittedBlockGapInputs = { diagId, severity, diag, element: preferredNextElement }')
    const idx = HOST_SRC.indexOf('if (this.isBlockGapVisualActive()) {')
    expect(idx).toBeGreaterThan(0)
    const body = HOST_SRC.slice(idx, idx + 900)
    // 自有输入优先（旧的 `inputs?.diag != null` 单一守卫会把带冻结在提交宽度）
    expect(body).toContain('const bg = this.locateCommittedBlockGapInputs')
    expect(body).toContain('bg?.diag ?? inputs?.diag')
    expect(body).toContain('this.commitBlockGapVisual(')
  })

  it('§2.2 — 源码计数缺失时绝不回退渲染行数（UNRESOLVED_SOURCE + 一次有界重解析）', () => {
    // 旧写法已删除：不得再出现 `actualBlankLines ?? renderedRowCount`
    expect(HOST_SRC).not.toContain('actualBlankLines ?? renderedRowCount')
    expect(HOST_SRC).toContain("sourceCountAuthority: actualBlankLines == null ? 'UNRESOLVED_SOURCE' : 'SOURCE'")
    expect(HOST_SRC).toContain("this.requestBoundedInternalBlankReparse('INTERNAL_BLANK_LINE_SOURCE_UNRESOLVED')")
    // 有界：同一 sourceRevision 只重解析一次，不是轮询
    const fn = HOST_SRC.slice(HOST_SRC.indexOf('private requestBoundedInternalBlankReparse'))
    const body = fn.slice(0, 500)
    expect(body).toContain('revision === this.lastInternalBlankReparseRevision')
    expect(body).not.toContain('setInterval')
    expect(body).not.toContain('setTimeout')
  })
})

describe('ROOT_CODE_COMPOUND_TARGET — 代码块复合载体必须覆盖「名称行 ∪ 代码主体」', () => {
  it('载体范围取 frame ∩ LIVE 题注的并集（消除 68.44/42.64 两值漂移）', () => {
    const idx = HOST_SRC.indexOf('const vpFrame = this.measureLocateRect(frameEl)')
    expect(idx).toBeGreaterThan(0)
    const body = HOST_SRC.slice(idx, idx + 2600)
    // 必须把 LIVE 题注并进范围，而不是只信 frame.getFrameElement()（会退化成 body-only 42.64）
    expect(body).toContain('const captionElForCarrier = this.locatePlacementCtx?.primaryEl ?? null')
    expect(body).toContain('Math.min(vpFrame.top, captionVpForCarrier.top)')
    expect(body).toContain('Math.max(vpFrame.bottom, captionVpForCarrier.bottom)')
    // 题注必须已连接且与 frame/anchor 不是同一节点（避免自并集）
    expect(body).toContain('captionElForCarrier !== frameEl && captionElForCarrier !== anchor')
    // 并集后的 rect 必须走同一 document-local 权威（不新增坐标换算路径）
    expect(body).toContain('viewportRectToDocumentLocalRect({ viewportRect: vp, contentHostRect: hostRect })')
  })

  it('载体↔锚点边关系在提交期一次性固化为 edgePad（供 reconcile 同代次复现）', () => {
    const idx = HOST_SRC.indexOf('this.locateCommittedCarrierEdgePad = anchorVpAtCommit && vp')
    expect(idx).toBeGreaterThan(0)
    const body = HOST_SRC.slice(idx, idx + 420)
    expect(body).toContain('left: vp.left - anchorVpAtCommit.left')
    expect(body).toContain('top: vp.top - anchorVpAtCommit.top')
    expect(body).toContain('bottom: vp.bottom - anchorVpAtCommit.bottom')
  })
})

const FRAME_SRC = readFileSync(
  resolve(process.cwd(), 'src/document-utilities/document-diagnostic-locate-frame.ts'), 'utf8',
)

describe('ROOT_CODE_CARRIER_CONTENT_COLUMN — 4px 水平外溢收口', () => {
  it('外框 breathing gap 按内容列夹取（只夹 gap，不夹目标）', () => {
    const idx = FRAME_SRC.indexOf('function clampCarrierGapToColumn')
    expect(idx).toBeGreaterThan(0)
    const body = FRAME_SRC.slice(idx, idx + 900)
    // 仅当 pre-gap 盒已在列内时才把该边拉回列边界（目标超列时不缩）
    expect(body).toContain('base.left >= column.left ? Math.max(withGap.left, column.left) : withGap.left')
    expect(body).toContain('base.right <= column.right ? Math.min(withGap.right, column.right) : withGap.right')
  })

  it('reposition 用内容列夹取并集后的载体（gap>0 才夹）', () => {
    const idx = FRAME_SRC.indexOf('const withCaption = contentColumn && gap > 0')
    expect(idx).toBeGreaterThan(0)
    const body = FRAME_SRC.slice(idx, idx + 400)
    expect(body).toContain('clampCarrierGapToColumn(withCaptionGap, mergeCaptionHost(semanticSource, caption), contentColumn)')
  })

  it('闭合审计对 CODE 目标做独立 scope 覆盖 + 内容列包含判定', () => {
    expect(HOST_SRC).toContain('codeVisualClosureScoped: codeRuleActive ? codeVisualScopeOk : null')
    expect(HOST_SRC).toContain('this.countersDocSpaceV511.codeCarrierOverflowsContentColumn++')
    // 超列只在「目标本身也在列内」的一侧计入（目标超列不误报）
    expect(HOST_SRC).toContain('targetRect.left >= contentCol.left ? Math.max(0, contentCol.left - carrierRect.left) : 0')
    expect(HOST_SRC).toContain('targetRect.right <= contentCol.right ? Math.max(0, carrierRect.right - contentCol.right) : 0')
  })
})
