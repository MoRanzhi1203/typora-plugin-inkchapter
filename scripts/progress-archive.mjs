#!/usr/bin/env node
/**
 * 墨章 InkChapter — 修复进度存档（APPEND-ONLY）
 *
 * 解决的真实问题：存档此前是「每日期单一 topics.md + 整文件覆盖写」，
 * 新会话写入会整体替换旧内容 → 进度「被意外重置」；且无完整性校验、
 * 无原子写入、无分片索引。
 *
 * 本工具把存档改成**只追加**日志，并固化四条不变量：
 *   I1 APPEND-ONLY：新内容必须以旧内容为前缀（既有字节永不被改写）；
 *   I2 MONOTONIC ：ENTRY 编号 1..N 连续、时间戳非递减（可检测"归零/回退"）；
 *   I3 INTEGRITY ：每条 entry 携带体区 sha256，可检测截断/位翻转；
 *   I4 ATOMIC    ：temp + rename 原子替换，写失败不留半截文件；
 *   I5 写前校验：既有文件损坏时**拒绝**继续追加（不掩盖故障）。
 *
 * 用法：
 *   node scripts/progress-archive.mjs verify
 *   node scripts/progress-archive.mjs append --title <t> --session <s> --body "多行文本"
 */
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'

const ARCHIVE = resolve(process.cwd(), 'docs/archive/PROGRESS-ARCHIVE.md')
const BANNER = [
  '# 墨章 InkChapter — 修复进度存档（APPEND-ONLY）',
  '',
  '> 不变量：本文件**只允许追加**，禁止整文件覆盖/截断（既有字节永不被改写）。',
  '> 每条 entry 由 `scripts/progress-archive.mjs append` 写入；写入前先 `verify` 既有完整性，',
  '> 写入采用 temp+rename 原子替换；entry 体区带 sha256 以便检测截断/位翻转。',
  '> 格式：',
  '> ```',
  '> ## [ENTRY <n>] <iso> <session-id>',
  '> sha256: <64-hex>',
  '> <<<BODY',
  '> ...',
  '> >>>BODY',
  '> ```',
  '',
].join('\n')

// 注意：BODY 体区不允许出现独占一行的 `>>>BODY`
const ENTRY_RE = /^## \[ENTRY (\d+)\] (\S+) (\S+)\nsha256: ([0-9a-f]{64})\n<<<BODY\n([\s\S]*?)\n>>>BODY$/gm

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

function parse(text) {
  const out = []
  for (const m of text.matchAll(ENTRY_RE)) {
    out.push({ n: Number(m[1]), iso: m[2], session: m[3], hash: m[4], body: m[5] })
  }
  return out
}

/** I2/I3 — 完整性校验；返回 { ok, errors, entries } */
function verify(text) {
  const errors = []
  const entries = parse(text)
  if (entries.length === 0) errors.push('NO_ENTRY: 存档中不存在任何合法 entry（疑似被覆盖或为空）')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.n !== i + 1) errors.push(`RESET_OR_GAP: 期望 ENTRY ${i + 1}，实际 ${e.n}（进度归零/跳号）`)
    if (i > 0 && entries[i - 1].iso > e.iso) errors.push(`TIME_REGRESSION: ENTRY ${e.n} 时间戳早于上一条`)
    if (e.session.trim() === '') errors.push(`EMPTY_SESSION: ENTRY ${e.n}`)
    const actual = sha256(e.body)
    if (actual !== e.hash) errors.push(`HASH_MISMATCH: ENTRY ${e.n} 体区被改动或截断`)
  }
  const seen = new Set()
  for (const e of entries) {
    if (seen.has(e.n)) errors.push(`DUPLICATE_ENTRY: ${e.n}`)
    seen.add(e.n)
  }
  return { ok: errors.length === 0, errors, entries }
}

function atomicWrite(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, data, 'utf8')
    renameSync(tmp, path) // I4 原子替换
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* noop */ }
    throw e
  }
}

function readOrInit() {
  if (existsSync(ARCHIVE)) return readFileSync(ARCHIVE, 'utf8')
  return BANNER
}

function cmdVerify() {
  const text = readOrInit()
  const r = verify(text)
  console.log(`ARCHIVE=${ARCHIVE}`)
  console.log(`ENTRY_COUNT=${r.entries.length}`)
  console.log(`LAST_ENTRY=${r.entries.at(-1)?.n ?? 'none'} TS=${r.entries.at(-1)?.iso ?? 'none'}`)
  if (!r.ok) { console.error('VERIFY=FAIL'); for (const e of r.errors) console.error(' - ' + e); process.exit(1) }
  console.log('VERIFY=PASS')
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function cmdAppend() {
  const title = arg('--title')
  const session = arg('--session')
  const body = arg('--body')
  if (!title || !session || body == null) {
    console.error('usage: append --title <t> --session <s> --body "text"')
    process.exit(2)
  }
  const base = readOrInit()
  // I5 — 写前校验：既有损坏则拒绝追加（不掩盖故障）。
  // 边界条件：**文件不存在**（首次创建）是合法空基线，必须放行。
  // 文件「已存在但解析不出任何 entry」= 曾经有进度却被清空/截断 → 一律拒绝，
  // 不得把「被重置的残留」当作全新基线继续写（否则会静默吞掉历史）。
  const existedBefore = existsSync(ARCHIVE)
  const pre = verify(base)
  if (!pre.ok && (pre.entries.length > 0 || existedBefore)) {
    console.error('APPEND=REFUSED reason=baseline-corrupt')
    for (const e of pre.errors) console.error(' - ' + e)
    process.exit(1)
  }
  const n = (pre.entries.at(-1)?.n ?? 0) + 1
  const iso = new Date().toISOString()
  const safeBody = body.replace(/\r\n/g, '\n').replace(/^>>>BODY$/m, '>>> B O D Y')
  const entry = `## [ENTRY ${n}] ${iso} ${session}\nsha256: ${sha256(safeBody)}\n<<<BODY\n${safeBody}\n>>>BODY\n`
  const next = base.endsWith('\n') ? base + '\n' + entry : base + '\n\n' + entry
  // I1 — APPEND-ONLY：新内容必须以旧内容为前缀
  if (!next.startsWith(base)) { console.error('APPEND=REFUSED reason=append-only-violation'); process.exit(1) }
  atomicWrite(ARCHIVE, next)
  const post = verify(next)
  if (!post.ok) { console.error('APPEND=FAIL post-verify'); for (const e of post.errors) console.error(' - ' + e); process.exit(1) }
  console.log(`APPEND=OK ENTRY=${n} SESSION=${session} TS=${iso} COUNT=${post.entries.length}`)
}

const cmd = process.argv[2]
if (cmd === 'verify') cmdVerify()
else if (cmd === 'append') cmdAppend()
else { console.error('usage: verify | append --title <t> --session <s> --body "text"'); process.exit(2) }
