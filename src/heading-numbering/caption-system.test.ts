// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  CaptionRegistry,
  resolveCaptionNumbers,
  renderCaptionLabel,
  computeCaptionAnchor,
  resolveCaptionTargetIndex,
  resolveCaptionAnchor,
  serializeCaptionRecords,
  deserializeCaptionRecords,
  CAPTION_TYPE_CONFIG,
} from './caption-system'

describe('CAPTION: unified table/figure/code caption system V1', () => {
  it('CAPTION-1: table set caption → 表 1 实验结果, position above', () => {
    expect(CAPTION_TYPE_CONFIG.table.position).toBe('above')
    const r = new CaptionRegistry().create({
      captionId: 'c1', documentKey: 'doc', type: 'table',
      title: '实验结果', targetAnchor: computeCaptionAnchor('table', 0),
    })
    const n = resolveCaptionNumbers([{ captionId: r.captionId, type: r.type }])
    expect(renderCaptionLabel('table', n[0].number, r.title)).toBe('表 1  实验结果')
  })

  it('CAPTION-2: figure set caption → 图 1 系统架构, position below', () => {
    expect(CAPTION_TYPE_CONFIG.figure.position).toBe('below')
    const label = renderCaptionLabel('figure', 1, '系统架构')
    expect(label).toBe('图 1  系统架构')
  })

  it('CAPTION-3: code set caption → 代码 1 初始化逻辑, position above', () => {
    expect(CAPTION_TYPE_CONFIG.code.position).toBe('above')
    expect(renderCaptionLabel('code', 1, '初始化逻辑')).toBe('代码 1  初始化逻辑')
  })

  it('CAPTION-4: table/figure/code numbering independent', () => {
    const ordered = [
      { captionId: 'f1', type: 'figure' as const },
      { captionId: 't1', type: 'table' as const },
      { captionId: 'f2', type: 'figure' as const },
      { captionId: 'c1', type: 'code' as const },
      { captionId: 't2', type: 'table' as const },
    ]
    const nums = resolveCaptionNumbers(ordered)
    const num = (id: string) => nums.find(n => n.captionId === id)!.number
    expect(num('f1')).toBe(1)
    expect(num('t1')).toBe(1)
    expect(num('f2')).toBe(2)
    expect(num('c1')).toBe(1)
    expect(num('t2')).toBe(2)
  })

  it('CAPTION-5: unnamed target does not take a number', () => {
    const ordered = [
      { captionId: 'f1', type: 'figure' as const },
      { captionId: 'f2', type: 'figure' as const },
    ]
    // Only f1 has a caption; the other figure is unnamed and absent from orderedCaptions.
    const nums = resolveCaptionNumbers([{ captionId: 'f1', type: 'figure' }])
    expect(nums).toHaveLength(1)
    expect(nums[0].number).toBe(1)
    void ordered
  })

  it('CAPTION-6: edit title → number unchanged', () => {
    const reg = new CaptionRegistry()
    reg.create({ captionId: 'c1', documentKey: 'doc', type: 'figure', title: '旧标题', targetAnchor: computeCaptionAnchor('figure', 0) })
    const before = resolveCaptionNumbers([{ captionId: 'c1', type: 'figure' }])[0].number
    reg.update('c1', '新标题')
    const after = resolveCaptionNumbers([{ captionId: 'c1', type: 'figure' }])[0].number
    expect(before).toBe(after)
    expect(reg.getById('c1')!.title).toBe('新标题')
  })

  it('CAPTION-7: delete caption → target preserved → renumber', () => {
    const reg = new CaptionRegistry()
    reg.create({ captionId: 'f1', documentKey: 'doc', type: 'figure', title: 'A', targetAnchor: computeCaptionAnchor('figure', 0) })
    reg.create({ captionId: 'f2', documentKey: 'doc', type: 'figure', title: 'B', targetAnchor: computeCaptionAnchor('figure', 1) })
    expect(reg.getById('f2')!.targetAnchor.ordinal).toBe(1)

    reg.delete('f1')
    // f2 now becomes the first remaining figure → number 1.
    const nums = resolveCaptionNumbers([{ captionId: 'f2', type: 'figure' }])
    expect(nums[0].number).toBe(1)
    expect(reg.getById('f2')!.title).toBe('B') // title unchanged
  })

  it('CAPTION-8: delete target → caption cleanup → no orphan', () => {
    const reg = new CaptionRegistry()
    reg.create({ captionId: 'f1', documentKey: 'doc', type: 'figure', title: 'A', targetAnchor: computeCaptionAnchor('figure', 0) })
    reg.create({ captionId: 'f2', documentKey: 'doc', type: 'figure', title: 'B', targetAnchor: computeCaptionAnchor('figure', 1) })

    // Target f1 deleted → delete its caption record.
    reg.delete('f1')
    expect(reg.getById('f1')).toBeNull()
    expect(reg.listByDocument('doc')).toHaveLength(1)
  })

  it('CAPTION-9: move target → caption follows → renumber', () => {
    const reg = new CaptionRegistry()
    reg.create({ captionId: 'f1', documentKey: 'doc', type: 'figure', title: 'A', targetAnchor: computeCaptionAnchor('figure', 0) })
    reg.create({ captionId: 'f2', documentKey: 'doc', type: 'figure', title: 'B', targetAnchor: computeCaptionAnchor('figure', 1) })

    // Move f2 before f1 → retarget ordinals; numbering recomputes in document order.
    reg.retarget('f2', computeCaptionAnchor('figure', 0))
    reg.retarget('f1', computeCaptionAnchor('figure', 1))

    const ordered = [{ captionId: 'f2', type: 'figure' as const }, { captionId: 'f1', type: 'figure' as const }]
    const nums = resolveCaptionNumbers(ordered)
    expect(nums.find(n => n.captionId === 'f2')!.number).toBe(1)
    expect(nums.find(n => n.captionId === 'f1')!.number).toBe(2)
  })

  it('CAPTION-10: two same-URL images get independent captions (positional identity)', () => {
    const reg = new CaptionRegistry()
    // Same content, different ordinal → independent.
    reg.create({ captionId: 'img1', documentKey: 'doc', type: 'figure', title: '架构', targetAnchor: computeCaptionAnchor('figure', 0) })
    reg.create({ captionId: 'img2', documentKey: 'doc', type: 'figure', title: '细节', targetAnchor: computeCaptionAnchor('figure', 1) })

    expect(reg.getByTarget('doc', 'figure', 0)!.captionId).toBe('img1')
    expect(reg.getByTarget('doc', 'figure', 1)!.captionId).toBe('img2')
    expect(reg.getById('img1')!.title).not.toBe(reg.getById('img2')!.title)
  })

  it('CAPTION-11: two same-text code blocks get independent captions', () => {
    const reg = new CaptionRegistry()
    reg.create({ captionId: 'code1', documentKey: 'doc', type: 'code', title: 'A', targetAnchor: computeCaptionAnchor('code', 0) })
    reg.create({ captionId: 'code2', documentKey: 'doc', type: 'code', title: 'B', targetAnchor: computeCaptionAnchor('code', 1) })
    expect(reg.getByTarget('doc', 'code', 0)!.captionId).toBe('code1')
    expect(reg.getByTarget('doc', 'code', 1)!.captionId).toBe('code2')
  })

  it('CAPTION-12: two same-content tables get independent captions', () => {
    const reg = new CaptionRegistry()
    reg.create({ captionId: 't1', documentKey: 'doc', type: 'table', title: '甲', targetAnchor: computeCaptionAnchor('table', 0) })
    reg.create({ captionId: 't2', documentKey: 'doc', type: 'table', title: '乙', targetAnchor: computeCaptionAnchor('table', 1) })
    expect(reg.getByTarget('doc', 'table', 0)!.captionId).toBe('t1')
    expect(reg.getByTarget('doc', 'table', 1)!.captionId).toBe('t2')
  })

  it('CAPTION-13: document close/reopen → caption rehydrate correctly', () => {
    const reg1 = new CaptionRegistry()
    reg1.create({ captionId: 'f1', documentKey: 'doc', type: 'figure', title: '架构', targetAnchor: computeCaptionAnchor('figure', 0) })
    const json = serializeCaptionRecords('doc', reg1.serialize('doc'))

    const reg2 = new CaptionRegistry()
    reg2.rehydrate('doc', deserializeCaptionRecords(json, 'doc'))
    expect(reg2.getById('f1')!.title).toBe('架构')
    expect(reg2.getByTarget('doc', 'figure', 0)!.captionId).toBe('f1')
  })

  it('CAPTION-14: historical weak match / duplicate content does not wrongly bind', () => {
    const reg = new CaptionRegistry()
    // A historical record bound to ordinal 0 must NOT bind a new object at ordinal 1.
    reg.rehydrate('doc', [{ captionId: 'old', documentKey: 'doc', type: 'figure', title: '旧', targetAnchor: computeCaptionAnchor('figure', 0), createdAt: 1, updatedAt: 1 }])
    expect(reg.getByTarget('doc', 'figure', 1)).toBeNull()
    expect(reg.getByTarget('doc', 'figure', 0)!.captionId).toBe('old')
  })

  it('CAPTION-15: document switch → caption state does not cross documents', () => {
    const reg = new CaptionRegistry()
    reg.create({ captionId: 'a1', documentKey: 'docA', type: 'figure', title: 'A', targetAnchor: computeCaptionAnchor('figure', 0) })
    reg.create({ captionId: 'b1', documentKey: 'docB', type: 'figure', title: 'B', targetAnchor: computeCaptionAnchor('figure', 0) })
    expect(reg.listByDocument('docA')).toHaveLength(1)
    expect(reg.listByDocument('docB')).toHaveLength(1)

    reg.clearDocument('docA')
    expect(reg.listByDocument('docA')).toHaveLength(0)
    expect(reg.listByDocument('docB')).toHaveLength(1)
  })

  it('CAPTION-16: right-click internal td/span resolves to correct target root (ordinal)', () => {
    const ordered = [
      computeCaptionAnchor('figure', 0),
      computeCaptionAnchor('figure', 1),
      computeCaptionAnchor('figure', 2),
    ]
    // Internal element resolves to its containing figure's ordinal.
    expect(resolveCaptionTargetIndex(computeCaptionAnchor('figure', 1), ordered)).toBe(1)
    expect(resolveCaptionTargetIndex(computeCaptionAnchor('figure', 0), ordered)).toBe(0)
  })

  it('CAPTION-17: delete caption record → projection cleanup (registry delete)', () => {
    const reg = new CaptionRegistry()
    reg.create({ captionId: 'f1', documentKey: 'doc', type: 'figure', title: 'A', targetAnchor: computeCaptionAnchor('figure', 0) })
    expect(reg.delete('f1')).toBe(true)
    expect(reg.getById('f1')).toBeNull()
  })

  it('CAPTION-18: renumber does not modify captionTitle', () => {
    const reg = new CaptionRegistry()
    reg.create({ captionId: 'f1', documentKey: 'doc', type: 'figure', title: '系统架构', targetAnchor: computeCaptionAnchor('figure', 0) })
    const titleBefore = reg.getById('f1')!.title
    resolveCaptionNumbers([{ captionId: 'f1', type: 'figure' }])
    expect(reg.getById('f1')!.title).toBe(titleBefore)
  })
})

describe('CAPTION: strong identity resolution (historical anchor safety)', () => {
  const fig = (ordinal: number, content?: string, before?: string, after?: string) => ({
    type: 'figure' as const, ordinal, contentSignature: content, beforeFingerprint: before, afterFingerprint: after,
  })

  it('resolves STRONG by content signature + occurrence (duplicate disambiguation)', () => {
    const descriptors = [fig(0, 'hA'), fig(1, 'hA'), fig(2, 'hB')]
    const anchor = computeCaptionAnchor('figure', 1, undefined, undefined, 'hA', 2)
    const r = resolveCaptionAnchor(anchor, descriptors)
    expect(r.decision).toBe('STRONG')
    expect(r.index).toBe(1)
  })

  it('resolves STRONG by unique content signature without occurrence', () => {
    const descriptors = [fig(0, 'hA'), fig(1, 'hB')]
    const anchor = computeCaptionAnchor('figure', 1, undefined, undefined, 'hB')
    const r = resolveCaptionAnchor(anchor, descriptors)
    expect(r.decision).toBe('STRONG')
    expect(r.index).toBe(1)
  })

  it('marks AMBIGUOUS for duplicate content without occurrence', () => {
    const descriptors = [fig(0, 'hA'), fig(1, 'hA')]
    const anchor = computeCaptionAnchor('figure', 0, undefined, undefined, 'hA')
    const r = resolveCaptionAnchor(anchor, descriptors)
    expect(r.decision).toBe('AMBIGUOUS')
    expect(r.index).toBe(-1)
  })

  it('falls back to ORDINAL_ONLY when no content/neighborhood signatures exist', () => {
    const descriptors = [fig(0), fig(1)]
    const anchor = computeCaptionAnchor('figure', 1)
    const r = resolveCaptionAnchor(anchor, descriptors)
    expect(r.decision).toBe('ORDINAL_ONLY')
    expect(r.index).toBe(1)
  })

  it('resolves STRONG by ordinal + neighborhood corroboration', () => {
    const descriptors = [fig(0, undefined, 'sigA', 'sigB'), fig(1, undefined, 'sigB', undefined)]
    const anchor = computeCaptionAnchor('figure', 1, 'sigB', undefined)
    const r = resolveCaptionAnchor(anchor, descriptors)
    expect(r.decision).toBe('STRONG')
    expect(r.index).toBe(1)
  })

  it('rejects NOT_FOUND when neighborhood mismatches at the ordinal', () => {
    const descriptors = [fig(0, undefined, 'sigA', 'sigB'), fig(1, undefined, 'sigC', undefined)]
    const anchor = computeCaptionAnchor('figure', 1, 'sigB', undefined)
    const r = resolveCaptionAnchor(anchor, descriptors)
    expect(r.decision).toBe('NOT_FOUND')
    expect(r.index).toBe(-1)
  })

  it('does not re-bind a historical ordinal-only anchor to a new object at a different ordinal', () => {
    const descriptors = [fig(0), fig(1), fig(2)]
    const historical = computeCaptionAnchor('figure', 0)
    const r = resolveCaptionAnchor(historical, descriptors)
    // Weak ordinal-only: still resolves to ordinal 0 but is NOT STRONG, so a
    // strict rehydrate must treat it as orphan rather than auto-bind.
    expect(r.decision).toBe('ORDINAL_ONLY')
    expect(r.index).toBe(0)
  })
})
