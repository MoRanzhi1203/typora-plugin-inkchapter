/**
 * ENTER→BLANK ECHO GUARD — targeted DOM-write call-stack tracer.
 *
 * ROOT CAUSE CONTEXT: one trusted `Enter` produces TWO `SPLIT_1_TO_2` batches; the
 * second (~60–120ms after NORMAL-ENTER-FINAL) has NO Enter transaction and NO
 * keyboard event. The plugin never dispatches Enter and never splits a paragraph,
 * so the second split must be provoked by a PLUGIN DOM WRITE inside `#write` (the
 * Typora document-model root) that makes the native block model rebuild the last
 * paragraph. A paragraph-style deferral was tried and REFUTED by the runtime log
 * (the deferral fired and the echo still happened).
 *
 * This tracer is the DIRECT evidence instrument: it is armed ONLY for the bounded
 * Enter echo window and, at each plugin write site inside `#write`, records the
 * call stack. The consumer emits ONE bounded audit so the REAL writer is named
 * instead of guessed.
 *
 * Pure bookkeeping — no DOM, no timers. Always OFF outside the armed window so it
 * can never affect normal editing (bounded: max records + max chars per stack).
 */

import { writeFileSync } from 'fs'
import { join } from 'path'

export interface EnterEchoWriteRecord {
  atMs: number
  sinceEnterMs: number
  kind: string
  target: string
  /** TRAE §3.1 — the operated node's TOPOLOGY fingerprint (tag/childCount/parent/attrs). */
  targetFingerprint: string
  /** TRAE §3.1 — the OTHER node's fingerprint (removeChild/insertBefore); '' when absent. */
  affectedFingerprint: string
  /** §B2 — WHO actually issued the write (first real external business frame). */
  origin: EnterEchoWriteOrigin
  stack: string
}

export type EnterEchoWriteOrigin = 'plugin' | 'typora' | 'unknown'

/**
 * §B2 — resolve the ORIGIN of a write from the frames BELOW the wrapper.
 * A frame in the InkChapter bundle means the plugin wrote; a `typora://` frame
 * means Typora itself wrote (wrapping in `main.js` proves nothing).
 */
export function classifyWriteOrigin(stack: string): EnterEchoWriteOrigin {
  const frames = stack.split('|').map(f => f.trim())
  for (const f of frames) {
    if (f.includes('typora://')) return 'typora'
    if (/main\.js/.test(f)) return 'plugin'
  }
  return frames.length ? 'unknown' : 'unknown'
}

const MAX_RECORDS = 24
const MAX_STACK_CHARS = 900
const MAX_STACK_FRAMES = 8

let armedUntil = 0
let sceneId: string | null = null
let enteredAt = 0
let records: EnterEchoWriteRecord[] = []

/** Arm the tracer for the bounded Enter echo window (called on a trusted Enter). */
export function armEnterEchoWriteTrace(scene: string | null, windowMs: number, now = Date.now()): void {
  armedUntil = now + windowMs
  sceneId = scene
  enteredAt = now
  records = []
  installWriteInterceptor()
}

export function isEnterEchoWriteTraceArmed(now = Date.now()): boolean {
  return now < armedUntil
}

/**
 * TRAE §4/§5 — the CONTENT-DOCUMENT WRITE HOLD.
 *
 * True while a real Enter transaction's echo window is armed. During this window
 * the plugin MUST NOT perform ANY structural DOM write inside the content document
 * (`#write`): the commit-time paint-layer acceptance dry-run inserts its probe
 * nodes there, and Typora's own block model then re-runs its end-block
 * re-normalisation, producing a SECOND `SPLIT_1_TO_2` that adds one extra empty
 * paragraph (source `…1064 → 1066`, +2 LF) for a SINGLE Enter. The hold lets every
 * content-document writer opt out of the echo window WITHOUT touching any count or
 * visual logic.
 */
export function isContentDocumentWriteHoldActive(now = Date.now()): boolean {
  return now < armedUntil
}

function describeTarget(target: Element | string | null): string {
  if (target == null) return 'none'
  if (typeof target === 'string') return target.slice(0, 80)
  const tag = target.tagName ?? 'node'
  const cls = String(target.className ?? '').slice(0, 60)
  return `${tag}${cls ? '.' + cls.split(/\s+/).slice(0, 2).join('.') : ''}`
}

/**
 * TRAE §3.1 — a bounded TOPOLOGY FINGERPRINT of a write target: tag, child element
 * count, parent identity and the identity-bearing attributes (class/id/data-*).
 * It ties a recorded write to a REAL node class (dry-run probe vs content
 * paragraph) instead of only a tag name, and proves whether the parent is `#write`.
 */
function describeFingerprint(node: Node | null): string {
  if (node == null) return 'none'
  if (typeof Element === 'undefined' || !(node instanceof Element)) {
    try { return `nodeType=${node.nodeType};name=${node.nodeName}` } catch { return 'none' }
  }
  const el = node as Element
  let attrs = ''
  try {
    attrs = Array.from(el.attributes)
      .filter(a => a.name === 'class' || a.name === 'id' || a.name.startsWith('data-'))
      .slice(0, 6)
      .map(a => `${a.name}=${String(a.value).slice(0, 48)}`)
      .join(';')
  } catch { /* forensic only */ }
  const parent = el.parentElement
  const parentDesc = parent
    ? `${parent.tagName}${parent.id ? '#' + parent.id : ''}${parent.className ? '.' + String(parent.className).split(/\s+/).slice(0, 2).join('.') : ''}`
    : 'none'
  try {
    return `tag=${el.tagName};childCount=${el.childElementCount};parent=${parentDesc};attrs=${attrs}`
  } catch {
    return `tag=${el.tagName}`
  }
}

function firstFrames(skip = 1): string {
  try {
    const raw = new Error().stack ?? ''
    return raw
      .split('\n')
      .slice(skip, skip + MAX_STACK_FRAMES)
      .map(l => l.trim().slice(0, 120))
      .join(' | ')
      .slice(0, MAX_STACK_CHARS)
  } catch {
    return ''
  }
}

/**
 * Record ONE plugin DOM write while the tracer is armed. A no-op (and therefore
 * free) outside the armor window.
 */
export function noteEnterEchoWrite(
  kind: string,
  target: Element | string | null,
  now = Date.now(),
  origin: EnterEchoWriteOrigin = 'plugin',
  stackOverride?: string,
  affected?: Node | null,
): void {
  if (now >= armedUntil) return
  if (records.length >= MAX_RECORDS) return
  records.push({
    atMs: now,
    sinceEnterMs: Math.max(0, now - enteredAt),
    kind,
    target: describeTarget(target),
    targetFingerprint: typeof target === 'object' && target != null ? describeFingerprint(target as Node) : 'none',
    affectedFingerprint: affected != null ? describeFingerprint(affected) : '',
    origin,
    stack: stackOverride ?? firstFrames(),
  })
}

/**
 * BROAD INTERCEPTOR — covers EVERY plugin DOM write, not just a hand-picked list.
 *
 * The hand-instrumented sites reported `recordCount: 0` for a REAL Enter whose
 * duplicate split was reproduced, so the writer must be a write the tracer did not
 * cover. During the armed window only, `Node`/`Element` mutation methods are
 * wrapped to record the call stack of writes that (a) touch `#write` and (b) come
 * from the plugin bundle (stack frame mentioning the plugin `main.js`).
 *
 * SAFETY: the wrappers are pure pass-through. They are installed ONCE and add only
 * a single timestamp comparison outside the armed window, so normal editing is not
 * affected; nothing is unpinned/pinned per Enter.
 */
const WRITE_METHODS: ReadonlyArray<[string, 'node' | 'element']> = [
  ['appendChild', 'node'],
  ['insertBefore', 'node'],
  ['removeChild', 'node'],
  ['replaceChild', 'node'],
  ['setAttribute', 'element'],
  ['removeAttribute', 'element'],
  ['insertAdjacentElement', 'element'],
  ['remove', 'element'],
]

let interceptorInstalled = false

function nodeTouchesWriteRoot(node: Node | null): boolean {
  try {
    const write = document.getElementById('write')
    if (!write || !node) return false
    const el = node.nodeType === 1 ? (node as Element) : (node.parentElement ?? null)
    return !!el && (el === write || write.contains(el))
  } catch {
    return false
  }
}

function installWriteInterceptor(): void {
  if (interceptorInstalled) return
  interceptorInstalled = true
  try {
    const proto = Node.prototype as unknown as Record<string, unknown>
    const elProto = Element.prototype as unknown as Record<string, unknown>
    for (const [name, kind] of WRITE_METHODS) {
      const host = (kind === 'node' ? proto : elProto)[name] as ((...a: unknown[]) => unknown) | undefined
      if (typeof host !== 'function') continue
      const original = host
      const wrapped = function (this: Node, ...args: unknown[]): unknown {
        if (Date.now() < armedUntil) {
          try {
            const affected = args.find(a => a instanceof Node) as Node | undefined
            if (nodeTouchesWriteRoot(this) || nodeTouchesWriteRoot(affected ?? null)) {
              // §B2 — "wrapped in main.js" ≠ "the plugin is the writer". Drop ALL
              // tracer-internal frames (firstFrames + noteEnterEchoWrite + wrapper)
              // so the ownership test sees the FIRST REAL EXTERNAL business frame.
              const stack = firstFrames(4)
              const origin = classifyWriteOrigin(stack)
              if (origin !== 'unknown') {
                // §B2 — structural ops and attribute-only ops are separate classes:
                // an attribute write can never be evidence of a structural split.
                const isStructural = name !== 'setAttribute' && name !== 'removeAttribute'
                noteEnterEchoWrite(
                  `${isStructural ? 'struct' : 'attr'}:${name}`, (this as unknown as Element), Date.now(), origin, stack, affected ?? null,
                )
              }
            }
          } catch { /* never disturb the real call */ }
        }
        return original.apply(this, args)
      }
      ;(kind === 'node' ? proto : elProto)[name] = wrapped
    }
  } catch {
    /* forensics only */
  }
}

/** Snapshot the arm state + records (consumer emits the audit). */
export function drainEnterEchoWriteTrace(): {
  sceneId: string | null
  enteredAt: number
  /** §B2 — true when the bounded buffer was full (evidence is incomplete). */
  truncated: boolean
  records: readonly EnterEchoWriteRecord[]
} {
  const out = { sceneId, enteredAt, truncated: records.length >= MAX_RECORDS, records: records.slice() }
  records = []
  return out
}

/**
 * Persist the drained evidence to `{vault}/.typora/inkchapter-enter-echo-trace.json`.
 *
 * The runtime audits only reach the DevTools console, which cannot be read from
 * outside the app — so the DIRECT evidence must be written to disk to be
 * inspectable. `main.ts` publishes the evidence directory as a global; when it is
 * absent (unit tests) this is a no-op.
 */
export function persistEnterEchoWriteTrace(payload: unknown): void {
  try {
    const dir = (globalThis as unknown as { __INKCHAPTER_EVIDENCE_DIR?: string }).__INKCHAPTER_EVIDENCE_DIR
    if (!dir) return
    writeFileSync(join(dir, 'inkchapter-enter-echo-trace.json'), JSON.stringify(payload, null, 2), 'utf8')
  } catch {
    /* forensic only — never disturb editing */
  }
}
