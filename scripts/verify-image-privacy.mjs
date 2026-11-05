#!/usr/bin/env node
/**
 * 图片管理隐私门禁（P8）。
 *
 * 两种模式：
 *   - 默认：只扫描「已暂存的新增行」，避免历史文档中的既有内容阻塞提交；
 *   - `--all`：扫描**全部跟踪文件**的当前内容（提交后 / 发布前的全仓审计），
 *     不再受“只扫 diff”的盲区影响——已提交文件里的本机路径同样会被拦住。
 *
 * 命中时只输出文件、行号和规则名，不回显任何敏感内容。
 *
 * 用法：
 *   node scripts/verify-image-privacy.mjs           # 扫描 git diff --cached
 *   node scripts/verify-image-privacy.mjs --all     # 扫描全部跟踪文件
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const args = new Set(process.argv.slice(2))
const scanAll = args.has('--all')
const SELF_PATH = 'scripts/verify-image-privacy.mjs'

const RULES = [
  { name: 'GITHUB_CLASSIC_TOKEN', pattern: /ghp_[A-Za-z0-9]{20,}/ },
  { name: 'GITHUB_FINE_GRAINED_TOKEN', pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'PRIVATE_KEY', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS_ACCESS_KEY', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'PICGO_TOKEN_FIELD', pattern: /"token"\s*:\s*"[^"]{20,}"/ },
  // 普通文本形式：C:\Users\name（必须带用户目录名，避免命中测试里的
  // “禁止 C:\Users” 正则字面量 `/C:\\Users/i`）。
  { name: 'PRIVATE_USER_ROOT', pattern: /C:\\Users\\([^\\\s"']+)/i, captureUser: true },
  // JSON / 日志转义后的双反斜杠形式：C:\\Users\\name（旧规则漏掉的真实泄露形态）。
  { name: 'PRIVATE_USER_ROOT_ESCAPED', pattern: /C:\\\\Users\\\\([^\\\s"']+)/i, captureUser: true },
  // 非 C 盘的私人图库/图片目录同样不得进入提交（夹具与日志也适用）。
  { name: 'PRIVATE_IMAGE_LIBRARY_PATH', pattern: /[A-Za-z]:[\\/][^\\/\s"']*(?:TyporaImageLibrary|图片库)[\\/]/i },
]

/**
 * 测试与文档里的路径占位符不是真实用户目录，不能当作隐私泄露；
 * 只拦截真实用户名（如 MSIPC）。`<user>` 这类尖括号占位符也跳过。
 */
const PLACEHOLDER_USER_NAMES = new Set([
  'me', 'name', 'user', 'username', 'alice', 'bob', 'test', 'example', 'someone',
])

const hits = []
let scanned = 0

function checkLine(file, lineNumber, text) {
  scanned++
  if (file === SELF_PATH) return
  for (const rule of RULES) {
    const match = rule.pattern.exec(text)
    if (!match) continue
    if (rule.captureUser) {
      const user = (match[1] ?? '').toLowerCase()
      if (user === '' || user.startsWith('<') || PLACEHOLDER_USER_NAMES.has(user)) continue
    }
    hits.push({ file, line: lineNumber, rule: rule.name })
  }
}

if (scanAll) {
  let files = []
  try {
    files = execFileSync('git', ['ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }).split('\0').filter(Boolean)
  } catch (error) {
    console.error('PRIVACY_GATE=GIT_FAILED')
    console.error(String(error?.message ?? error).split('\n').slice(0, 3).join('\n'))
    process.exit(2)
  }
  for (const file of files) {
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    // 二进制文件（含 NUL）不做文本误报扫描。
    if (text.includes('\0')) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) checkLine(file, i + 1, lines[i])
  }
} else {
  let diff = ''
  try {
    diff = execFileSync(
      'git',
      ['diff', '--cached', '--unified=0', '--no-color'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    )
  } catch (error) {
    console.error('PRIVACY_GATE=GIT_FAILED')
    console.error(String(error?.message ?? error).split('\n').slice(0, 3).join('\n'))
    process.exit(2)
  }

  let currentFile = null
  let currentLine = 0
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length)
      currentLine = 0
      continue
    }
    if (line.startsWith('@@')) {
      const match = /\+(\d+)/.exec(line)
      currentLine = match ? Number(match[1]) - 1 : 0
      continue
    }
    if (!currentFile) continue
    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentLine++
      checkLine(currentFile, currentLine, line)
      continue
    }
    if (line.startsWith(' ')) currentLine++
  }
}

console.log(`PRIVACY_GATE=SCANNED_LINES:${scanned}`)

if (hits.length === 0) {
  console.log('PRIVACY_GATE=PASS')
  process.exit(0)
}

for (const hit of hits) {
  console.error(`PRIVACY_GATE=HIT file=${hit.file} line=${hit.line} rule=${hit.rule}`)
}
console.error(`PRIVACY_GATE=FAIL hits=${hits.length}`)
process.exit(1)
