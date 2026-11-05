#!/usr/bin/env node
/**
 * 图片管理隐私门禁（P8）。
 *
 * 只扫描「已暂存的新增行」，避免历史文档中的既有内容阻塞提交。
 * 命中时只输出文件、行号和规则名，不回显任何敏感内容。
 *
 * 用法：
 *   node scripts/verify-image-privacy.mjs           # 扫描 git diff --cached
 *   node scripts/verify-image-privacy.mjs --all     # 扫描工作区相对 HEAD 的改动
 */

import { execFileSync } from 'node:child_process'

const args = new Set(process.argv.slice(2))
const diffArgs = args.has('--all')
  ? ['diff', 'HEAD', '--unified=0', '--no-color']
  : ['diff', '--cached', '--unified=0', '--no-color']

const SELF_PATH = 'scripts/verify-image-privacy.mjs'

const RULES = [
  { name: 'GITHUB_CLASSIC_TOKEN', pattern: /ghp_[A-Za-z0-9]{20,}/ },
  { name: 'GITHUB_FINE_GRAINED_TOKEN', pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'PRIVATE_KEY', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS_ACCESS_KEY', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'PICGO_TOKEN_FIELD', pattern: /"token"\s*:\s*"[^"]{20,}"/ },
  { name: 'PRIVATE_USER_ROOT', pattern: /C:\\Users\\[^\\\s]+/i },
  // 非 C 盘的私人图库/图片目录同样不得进入提交（夹具与日志也适用）。
  { name: 'PRIVATE_IMAGE_LIBRARY_PATH', pattern: /[A-Za-z]:[\\/][^\\/\s"']*(?:TyporaImageLibrary|图片库)[\\/]/i },
]

let diff = ''
try {
  diff = execFileSync('git', diffArgs, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
} catch (error) {
  console.error('PRIVACY_GATE=GIT_FAILED')
  console.error(String(error?.message ?? error).split('\n').slice(0, 3).join('\n'))
  process.exit(2)
}

let currentFile = null
let currentLine = 0
const hits = []
let scanned = 0

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
    scanned++
    if (currentFile === SELF_PATH) continue
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        hits.push({ file: currentFile, line: currentLine, rule: rule.name })
      }
    }
    continue
  }
  if (line.startsWith(' ')) currentLine++
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
