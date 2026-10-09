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
