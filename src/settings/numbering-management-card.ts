/**
 * R08 — 编号写入与同步（设置页卡片）。
 *
 * One compact card inside the existing 「文档规则」 workbench panel. It owns:
 *   - 存储模式 / 已有编号处理 / 同步时机 / 投影去重;
 *   - the six commands (写入源码、接管、重新同步、移除、冲突检查、导出);
 *   - a live source preview (current line → planned line).
 *
 * Visual language: the existing black/white/grey settings surface. No wizard.
 */

import type { NumberingPersistenceService } from '../heading-numbering/numbering-persistence-service'
import {
  formatNumberingConflictSummary,
  type NumberingConflictReport,
} from '../heading-numbering/heading-number-conflict-check'
import type {
  ExistingHeadingNumberPolicy,
  HeadingNumberStorageMode,
  HeadingNumberSyncTiming,
  NumberingPersistenceSettings,
} from '../heading-numbering/heading-number-persistence'

export interface NumberingManagementCardDeps {
  container: HTMLElement
  persistence: NumberingPersistenceService
  /** Re-render the whole settings tab after a settings change. */
  rerender?: () => void
  notify?: (kind: 'info' | 'warning' | 'error', message: string) => void
}

const STORAGE_OPTIONS: Array<{ value: HeadingNumberStorageMode; label: string; hint: string }> = [
  { value: 'render', label: '渲染层编号', hint: '只在正文与大纲显示，不写入 Markdown' },
  { value: 'source', label: '源码持久化', hint: '编号写入标题文本，仅供参考与导出' },
  { value: 'export', label: '导出时固化', hint: '编辑时不写入，导出副本带编号' },
]

const POLICY_OPTIONS: Array<{ value: ExistingHeadingNumberPolicy; label: string; hint: string }> = [
  { value: 'adopt', label: '接管并同步', hint: '确认的旧编号纳入墨章管理并重算' },
  { value: 'replace', label: '移除并重新生成', hint: '移除已确认旧编号，按当前方案重算' },
  { value: 'preserve', label: '保留且不叠加', hint: '保留已有编号，墨章不再投影' },
  { value: 'detect-only', label: '只检测', hint: '不修改源码，只报告冲突' },
]

const TIMING_OPTIONS: Array<{ value: HeadingNumberSyncTiming; label: string; hint: string }> = [
  { value: 'manual', label: '手动同步', hint: '只在执行命令时写入' },
  { value: 'edit', label: '编辑后自动同步', hint: '标题结构变化时自动同步' },
  { value: 'save', label: '保存时同步', hint: '保存文档前统一写入' },
]

export function renderNumberingManagementCard(deps: NumberingManagementCardDeps): void {
  const { container, persistence } = deps
  const settings = persistence.getSettings()

  const card = document.createElement('div')
  card.className = 'inkchapter-card'
  container.appendChild(card)

  const header = document.createElement('div')
  header.className = 'inkchapter-card-header'
  card.appendChild(header)
  const title = document.createElement('div')
  title.className = 'inkchapter-card-title'
  title.textContent = '编号写入与同步'
  header.appendChild(title)

  const body = document.createElement('div')
  body.style.cssText = 'padding:12px 14px;display:flex;flex-direction:column;gap:12px;'
  card.appendChild(body)

  const note = document.createElement('div')
  note.style.cssText = 'font-size:12px;color:#777;line-height:1.6;'
  note.textContent = '三种存储模式共享同一套编号计算结果：正文、大纲、导出与诊断始终只显示一套编号。'
  body.appendChild(note)

  // ── controls ────────────────────────────────────────
  const controls = document.createElement('div')
  controls.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px 16px;'
  body.appendChild(controls)

  addSelect(controls, '编号存储模式', STORAGE_OPTIONS, settings.storageMode, value => {
    persistence.setSettings({ storageMode: value as HeadingNumberStorageMode }, 'document')
    deps.rerender?.()
  })
  addSelect(controls, '已有编号处理', POLICY_OPTIONS, settings.existingNumberPolicy, value => {
    persistence.setSettings({ existingNumberPolicy: value as ExistingHeadingNumberPolicy }, 'document')
    deps.rerender?.()
  })
  addSelect(controls, '同步时机', TIMING_OPTIONS, settings.syncTiming, value => {
    persistence.setSettings({ syncTiming: value as HeadingNumberSyncTiming }, 'document')
    deps.rerender?.()
  })
  addCheckbox(controls, '源码已有编号时不再叠加投影', settings.dedupeProjectedNumbers, checked => {
    persistence.setSettings({ dedupeProjectedNumbers: checked }, 'document')
    deps.rerender?.()
  })

  const hint = document.createElement('div')
  hint.style.cssText = 'font-size:11px;color:#888;'
  hint.textContent = currentHint(settings)
  body.appendChild(hint)

  // ── actions ─────────────────────────────────────────
  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;'
  body.appendChild(actions)

  const status = document.createElement('div')
  status.style.cssText = 'font-size:12px;color:#555;white-space:pre-wrap;line-height:1.6;'
  body.appendChild(status)

  const conflictList = document.createElement('div')
  conflictList.style.cssText = 'font-size:12px;color:#444;white-space:pre-wrap;line-height:1.6;'
  body.appendChild(conflictList)

  addButton(actions, '将编号写入源码', () => {
    const result = persistence.writeNumbersToSource()
    status.textContent = describeResult(result.status, result.detail)
    refresh()
  })
  addButton(actions, '接管已有编号', () => {
    const result = persistence.adoptExistingNumbers()
    status.textContent = describeResult(result.status, result.detail)
    refresh()
  })
  addButton(actions, '重新同步全部编号', () => {
    const result = persistence.resynchronizeAll()
    status.textContent = describeResult(result.status, result.detail)
    refresh()
  })
  addButton(actions, '移除墨章管理的源码编号', () => {
    const result = persistence.removeManagedNumbers()
    status.textContent = describeResult(result.status, result.detail)
    refresh()
  })
  addButton(actions, '检查编号冲突', () => {
    const report = persistence.checkConflicts()
    if (!report) {
      status.textContent = '无法读取当前文档'
      return
    }
    renderConflicts(conflictList, report)
  })
  addButton(actions, '导出带编号的 Markdown', () => {
    const result = persistence.exportNumberedMarkdown()
    status.textContent = result.ok
      ? (result.detail ?? '已导出编号副本')
      : (result.detail ?? '导出失败')
  })

  // ── live preview ────────────────────────────────────
  const preview = document.createElement('div')
  preview.style.cssText = 'border-top:1px solid #eee;padding-top:10px;display:flex;flex-direction:column;gap:6px;'
  body.appendChild(preview)

  function refresh(): void {
    const data = persistence.getPreview()
    conflictList.textContent = ''
    renderPreview(preview, data.before, data.changed, data.stats)
  }

  refresh()

  function renderConflicts(target: HTMLElement, report: NumberingConflictReport): void {
    if (!report.hasConflict) {
      target.textContent = '未发现编号冲突'
      return
    }
    const head = `${formatNumberingConflictSummary(report)}\n`
    const lines = report.issues.slice(0, 12).map(i => `L${i.line}  ${i.code}  ${i.message}  → ${i.fix}`)
    target.textContent = head + lines.join('\n')
  }
}

function addSelect(
  parent: HTMLElement,
  label: string,
  options: Array<{ value: string; label: string; hint: string }>,
  current: string,
  onChange: (value: string) => void,
): void {
  const wrap = document.createElement('label')
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-size:12px;color:#444;'
  const text = document.createElement('span')
  text.textContent = label
  wrap.appendChild(text)

  const select = document.createElement('select')
  select.style.cssText = 'padding:5px 6px;font-size:12px;border:1px solid #ddd;border-radius:4px;background:#fff;color:#222;'
  for (const option of options) {
    const el = document.createElement('option')
    el.value = option.value
    el.textContent = option.label
    el.title = option.hint
    select.appendChild(el)
  }
  select.value = current
  select.addEventListener('change', () => onChange(select.value))
  wrap.appendChild(select)

  const currentOption = options.find(o => o.value === current)
  if (currentOption) {
    const hint = document.createElement('span')
    hint.style.cssText = 'font-size:11px;color:#999;'
    hint.textContent = currentOption.hint
    wrap.appendChild(hint)
  }
  parent.appendChild(wrap)
}

function addCheckbox(
  parent: HTMLElement,
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): void {
  const wrap = document.createElement('label')
  wrap.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;color:#444;'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = checked
  input.addEventListener('change', () => onChange(input.checked))
  wrap.appendChild(input)
  const text = document.createElement('span')
  text.textContent = label
  wrap.appendChild(text)
  parent.appendChild(wrap)
}

function addButton(parent: HTMLElement, label: string, onClick: () => void): void {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.style.cssText = 'padding:6px 10px;font-size:12px;border:1px solid #d5d5d5;border-radius:4px;background:#fff;color:#222;cursor:pointer;'
  button.addEventListener('mouseenter', () => { button.style.background = '#f5f5f5' })
  button.addEventListener('mouseleave', () => { button.style.background = '#fff' })
  button.addEventListener('click', onClick)
  parent.appendChild(button)
}

function renderPreview(
  target: HTMLElement,
  headings: Array<{ line: number; level: number; title: string; label: string; after: string }>,
  changed: boolean,
  stats: { written: number; updated: number; removed: number; preserved: number; unresolved: number } | null,
): void {
  target.textContent = ''
  const header = document.createElement('div')
  header.style.cssText = 'font-size:12px;color:#555;'
  header.textContent = stats
    ? `预览：${changed ? '有待写入变更' : '无需修改'} · 新写入 ${stats.written} · 更新 ${stats.updated} · 移除 ${stats.removed} · 保留 ${stats.preserved} · 待确认 ${stats.unresolved}`
    : '预览：无标题'
  target.appendChild(header)

  for (const heading of headings) {
    const row = document.createElement('div')
    row.style.cssText = 'font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#333;white-space:pre-wrap;'
    row.textContent = `L${heading.line}  ${'#'.repeat(heading.level)} ${heading.after}`
    target.appendChild(row)
  }
}

function currentHint(settings: NumberingPersistenceSettings): string {
  if (settings.storageMode === 'render') {
    return '当前：渲染层编号。源码保持原样；已有手工编号会被识别并抑制重复投影。'
  }
  if (settings.storageMode === 'export') {
    return '当前：导出时固化。编辑阶段继续使用渲染层编号，导出命令生成带编号副本。'
  }
  return '当前：源码持久化。编号写入标题文本，关闭插件后仍可见；渲染层不再叠加。'
}

function describeResult(status: string, detail: string | undefined): string {
  const clean = (detail ?? '').replace(/^[A-Z_]+:/, '')
  if (status === 'APPLIED') return clean || '已写入源码'
  if (status === 'UNCHANGED') return '编号已是最新，无需修改'
  if (status === 'SKIPPED') return clean || '已跳过'
  return clean || '操作失败'
}
