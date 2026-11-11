/**
 * InkChapter CODE diagnostic marker acceptance — READ-ONLY DevTools probe.
 *
 * Paste into Typora DevTools Console while a code diagnostic is active.
 * No clicks, scrolling, DOM writes, or plugin API calls.
 *
 * For every `.inkchapter-diagnostic-locate-frame[data-target-kind="code"]` it
 * resolves the frame's canonical diagnostic/owner identity and compares the
 * marker rect with the REAL target code block, its caption and any sibling code
 * block / blank paragraph. A missing/unmeasurable target is NOT_VERIFIED.
 */
(() => {
  const TOL = 1
  const frames = Array.from(document.querySelectorAll('.inkchapter-diagnostic-locate-frame[data-target-kind="code"]'))
  const codes = Array.from(document.querySelectorAll('#write pre.md-fences'))
  const round = n => Math.round(n * 100) / 100
  const rect = el => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: round(r.left), top: round(r.top), right: round(r.right), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }
  }
  const visible = el => {
    if (!el || !el.isConnected) return false
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'
  }
  const intersects = (a, b) => !!a && !!b
    && a.left < b.right - TOL && b.left < a.right - TOL
    && a.top < b.bottom - TOL && b.top < a.bottom - TOL
  const contains = (outer, inner) => !!outer && !!inner
    && outer.left <= inner.left + TOL && outer.top <= inner.top + TOL
    && outer.right >= inner.right - TOL && outer.bottom >= inner.bottom - TOL
  const codeIdentityOf = el => {
    const i = codes.indexOf(el)
    return i >= 0 ? `block:code:${i}` : null
  }
  const resolveByIdentity = id => {
    const m = /^block:code:(\d+)$/.exec(id || '')
    if (!m) return null
    return codes[Number.parseInt(m[1], 10)] ?? null
  }

  const results = frames.map(frame => {
    const diagnosticId = frame.dataset.diagnosticId || null
    const expected = frame.dataset.codeTargetIdentity || null
    const owner = frame.dataset.markerOwnerIdentity || null
    const binding = frame.dataset.codeTargetBinding || null
    const paintKind = frame.dataset.paintKind || null
    const target = resolveByIdentity(expected)
    const targetIdentity = codeIdentityOf(target)
    const codeRect = rect(target)
    const frameRect = rect(frame)
    let caption = null
    if (target) {
      caption = target.querySelector('.inkchapter-caption-code, [data-inkchapter-caption-id]')
      if (!caption) {
        const prev = target.previousElementSibling
        if (prev && prev.matches && prev.matches('.inkchapter-caption-code')) caption = prev
      }
    }
    const captionRect = rect(caption)
    const topbar = target ? target.querySelector('.inkchapter-content-toolbar--langbar') : null
    const topbarRect = rect(topbar)
    const style = frame ? getComputedStyle(frame) : null
    const markerComputedStyle = style ? {
      display: style.display, visibility: style.visibility, opacity: style.opacity,
      backgroundColor: style.backgroundColor, borderTopWidth: style.borderTopWidth,
      pointerEvents: style.pointerEvents,
    } : null

    const siblings = codes.filter(el => el !== target)
    const nextSibling = target ? siblings.find(el => {
      const r = rect(el)
      return r && codeRect && r.top >= codeRect.bottom - TOL
    }) : null
    const nextSiblingRect = rect(nextSibling)
    const paragraphs = Array.from(document.querySelectorAll('#write p'))
    const blankParagraphs = paragraphs.filter(p => !(p.textContent || '').trim())
    const blankHits = blankParagraphs.filter(p => intersects(frameRect, rect(p)))

    let verdict = 'NOT_VERIFIED'
    let reason = 'TARGET_NOT_RESOLVED'
    if (!frame || !frame.isConnected) {
      reason = 'FRAME_MISSING'
    } else if (!visible(frame)) {
      reason = 'FRAME_NOT_VISIBLE'
    } else if (!target || !targetIdentity) {
      reason = 'TARGET_CODE_BLOCK_NOT_RESOLVED'
    } else if (expected !== targetIdentity) {
      verdict = 'FAIL'
      reason = 'EXPECTED_IDENTITY_NOT_TARGET'
    } else if (owner !== expected || binding !== 'MATCH') {
      verdict = 'FAIL'
      reason = 'MARKER_OWNER_MISMATCH'
    } else {
      const visualRect = paintKind === 'code-topbar' && topbarRect ? topbarRect
        : paintKind === 'caption-only' && captionRect ? captionRect
          : codeRect
      if (!visualRect) {
        reason = 'VISUAL_TARGET_NOT_MEASURABLE'
      } else if (!contains(frameRect, visualRect) && !contains(visualRect, frameRect)) {
        verdict = 'FAIL'
        reason = 'MARKER_NOT_ON_VISUAL_TARGET'
      } else if (nextSiblingRect && intersects(frameRect, nextSiblingRect)) {
        verdict = 'FAIL'
        reason = 'MARKER_OVERLAPS_NEXT_CODE_BLOCK'
      } else if (blankHits.length > 0) {
        verdict = 'FAIL'
        reason = 'MARKER_OVERLAPS_BLANK_PARAGRAPH'
      } else {
        const body = target.querySelector('.CodeMirror, .CodeMirror-scroll, code')
        const bodyRect = rect(body)
        if (bodyRect && intersects(frameRect, bodyRect) && paintKind !== 'block-body') {
          verdict = 'FAIL'
          reason = 'MARKER_OVERLAPS_CODE_CONTENT'
        } else {
          verdict = 'PASS'
          reason = 'MARKER_MATCHES_TARGET'
        }
      }
    }

    return {
      documentKey: null as string | null,
      diagnosticId,
      targetIndex: null as number | null,
      canonicalCodeIdentity: expected,
      markerOwnerIdentity: owner,
      actualTargetIdentity: targetIdentity,
      codeTargetBinding: binding,
      paintKind,
      codeRect,
      captionRect,
      topbarRect,
      diagnosticMarkerRect: frameRect,
      markerComputedStyle,
      layoutEpoch: null as number | null,
      renderedPosition: frameRect ? { x: frameRect.left, y: frameRect.top } : null,
      anchorDecision: paintKind === 'code-topbar' ? 'CODE_TOPBAR'
        : paintKind === 'caption-only' ? 'CAPTION_ROW'
          : paintKind === 'block-body' ? 'CODE_BODY' : 'UNKNOWN',
      nextCodeBlockIdentity: nextSibling ? codeIdentityOf(nextSibling) : null,
      nextCodeBlockOverlap: nextSiblingRect ? intersects(frameRect, nextSiblingRect) : null,
      blankParagraphOverlapCount: blankHits.length,
      markerVisible: visible(frame),
      verdict,
      reason,
    }
  })

  const report = {
    timestamp: new Date().toISOString(),
    readOnly: true,
    devicePixelRatio: window.devicePixelRatio,
    theme: document.body.className,
    codeFrameCount: frames.length,
    codeBlockCount: codes.length,
    results,
    summary: {
      PASS: results.filter(r => r.verdict === 'PASS').length,
      FAIL: results.filter(r => r.verdict === 'FAIL').length,
      NOT_VERIFIED: results.filter(r => r.verdict === 'NOT_VERIFIED').length,
    },
  }
  console.log('[InkChapter Code Marker Acceptance]', report)
  return report
})()
