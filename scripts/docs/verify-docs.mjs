// Documentation verifier for InkChapter.
// Checks: broken local Markdown links; missing source / script / fixture paths;
// stale prompt references; duplicate canonical docs; remaining prompt docs.
// No third-party dependencies. Run with Node (>=16):
//   node scripts/docs/verify-docs.mjs
// Exits non-zero when any hard gate fails.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage'])
// Files that legitimately list deleted prompt paths as provenance.
const PROVENANCE_FILES = new Set([
  'docs/maintenance/prompt-consolidation-record.md',
  'docs/maintenance/prompt-cleanup-history.md',
])
// The verifier itself must not be scanned (it embeds the patterns).
const SKIP_FILES = new Set(['scripts/docs/verify-docs.mjs'])

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      walk(path.join(dir, e.name), out)
    } else if (e.name.toLowerCase().endsWith('.md')) {
      out.push(path.join(dir, e.name))
    }
  }
  return out
}

const toRel = (p) => path.relative(root, p).replace(/\\/g, '/')
const exists = (p) => fs.existsSync(p)

/**
 * Documentation gates only apply to content that can actually be published.
 *
 * Local-only Trae prompts (for example `docs/prompts/pending/**`) are
 * deliberately git-ignored: they are working notes, not repository content.
 * Scanning them reported them as `PROMPT_MD_REMAINING_COUNT` / stale prompt
 * references even though they never reach GitHub.
 *
 * `git check-ignore` never reports tracked paths, so a prompt file that is
 * actually tracked is still scanned and still fails the gate.
 */
function selectGitIgnored(relPaths) {
  if (relPaths.length === 0) return new Set()
  try {
    const out = execFileSync('git', ['check-ignore', '--stdin', '-z'], {
      cwd: root,
      input: relPaths.join('\0') + '\0',
      encoding: 'utf8',
    })
    return new Set(out.split('\0').filter(Boolean))
  } catch (error) {
    // exit 1 = nothing ignored; anything else = not a git checkout → scan all
    const out = typeof error?.stdout === 'string' ? error.stdout : ''
    return new Set(out.split('\0').filter(Boolean))
  }
}

const allFiles = walk(root).map(toRel).filter((r) => !SKIP_FILES.has(r)).sort()
const localOnlyFiles = selectGitIgnored(allFiles)
const files = allFiles.filter((r) => !localOnlyFiles.has(r))

const counters = {
  DOC_BROKEN_LINK_COUNT: 0,
  DOC_MISSING_CODE_PATH_COUNT: 0,
  DOC_MISSING_SCRIPT_PATH_COUNT: 0,
  DOC_MISSING_FIXTURE_PATH_COUNT: 0,
  STALE_PROMPT_REFERENCE_COUNT: 0,
  DUPLICATE_CANONICAL_DOC_AUTHORITY_COUNT: 0,
  PROMPT_MD_REMAINING_COUNT: 0,
}
const problems = []

const PROMPT_PATH_RE = /docs\/prompts|prompts\/(pending|archive)|\.prompt-backup/
const PATH_EXT_RE = /\.(ts|tsx|js|mjs|cjs|json|scss|css|ps1|md|yml|yaml)$/i
const PATH_IGNORE_RE = /[*<>…]|\.\.\.|\s/

function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '')
}

// A markdown example written INSIDE an inline code span (e.g. `` `[text](target)` ``)
// is documentation, never a real link — strip inline code before the link scan.
function stripInlineCode(text) {
  return text.replace(/`[^`]*`/g, '')
}

const headingsByTitle = new Map()

for (const rel of files) {
  const content = fs.readFileSync(path.join(root, rel), 'utf8')
  const dir = path.dirname(path.join(root, rel))
  const scan = stripFences(content)
  const linkScan = stripInlineCode(scan)

  // Documentation files only for link/path/stale checks (fixtures legitimately
  // reference non-existent sample assets, so they are excluded).
  const isDoc = rel.startsWith('docs/') || ['README.md', 'README.zh-CN.md', 'CHANGELOG.md'].includes(rel)

  // duplicate canonical docs (H1 under docs/, excluding indexes)
  if (rel.startsWith('docs/')) {
    const h1 = content.match(/^#\s+(.+?)\s*$/m)
    if (h1 && !/\bIndex\b|索引/.test(h1[1])) {
      const key = h1[1].trim()
      if (!headingsByTitle.has(key)) headingsByTitle.set(key, [])
      headingsByTitle.get(key).push(rel)
    }
  }

  const isProvenance = PROVENANCE_FILES.has(rel)

  // 1) markdown links
  const links = linkScan.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)
  if (isDoc) for (const m of links) {
    if (linkScan[m.index - 1] === '!') continue
    let target = m[1]
    if (/…/.test(target)) continue
    const hash = target.indexOf('#')
    if (hash >= 0) target = target.slice(0, hash)
    if (!target) continue
    if (/^(https?:|mailto:|tel:|data:)/i.test(target)) continue
    const resolved = path.resolve(dir, decodeURIComponent(target))
    if (!exists(resolved)) {
      counters.DOC_BROKEN_LINK_COUNT++
      problems.push(`[broken-link] ${rel} -> ${m[1]}`)
    }
    if (!isProvenance && PROMPT_PATH_RE.test(target)) {
      counters.STALE_PROMPT_REFERENCE_COUNT++
      problems.push(`[stale-prompt-link] ${rel} -> ${m[1]}`)
    }
  }

  // 2) backtick path tokens
  const codes = scan.matchAll(/`([^`]+)`/g)
  if (isDoc) for (const m of codes) {
    let token = m[1].trim()
    if (PATH_IGNORE_RE.test(token)) continue
    if (token.startsWith('/') || /^[a-zA-Z]:/.test(token)) continue
    if (/\s/.test(token)) continue
    if (!isProvenance && PROMPT_PATH_RE.test(token)) {
      counters.STALE_PROMPT_REFERENCE_COUNT++
      problems.push(`[stale-prompt-ref] ${rel} -> ${token}`)
      continue
    }
    // A migration / cleanup record legitimately lists DELETED paths as provenance,
    // so its path tokens are never existence-checked.
    if (isProvenance) continue
    const isSrc = token.startsWith('src/')
    const isScript = token.startsWith('scripts/')
    const isFixture = token.startsWith('test/') || token.startsWith('runtime/')
    if (!isSrc && !isScript && !isFixture) continue
    if (!PATH_EXT_RE.test(token)) continue
    if (!exists(path.resolve(root, token))) {
      if (isSrc) counters.DOC_MISSING_CODE_PATH_COUNT++
      else if (isScript) counters.DOC_MISSING_SCRIPT_PATH_COUNT++
      else counters.DOC_MISSING_FIXTURE_PATH_COUNT++
      problems.push(`[missing-path] ${rel} -> ${token}`)
    }
  }

  // 3) remaining prompt docs
  if (/^docs\/prompts\//.test(rel) || /(^|\/)(TRAE-|Trae-)[^/]*\.md$/.test(rel) || /(^|\/)[^/]*PROMPT[^/]*\.md$/.test(rel)) {
    counters.PROMPT_MD_REMAINING_COUNT++
    problems.push(`[prompt-doc] ${rel}`)
  }
}

for (const [title, list] of headingsByTitle) {
  if (list.length > 1) {
    counters.DUPLICATE_CANONICAL_DOC_AUTHORITY_COUNT += list.length - 1
    problems.push(`[duplicate-doc] "${title}" in ${list.join(', ')}`)
  }
}

const labels = {
  DOC_BROKEN_LINK_COUNT: 0,
  DOC_MISSING_CODE_PATH_COUNT: 0,
  DOC_MISSING_SCRIPT_PATH_COUNT: 0,
  DOC_MISSING_FIXTURE_PATH_COUNT: 0,
  STALE_PROMPT_REFERENCE_COUNT: 0,
  DUPLICATE_CANONICAL_DOC_AUTHORITY_COUNT: 0,
  PROMPT_MD_REMAINING_COUNT: 0,
}

console.log('=== InkChapter documentation verification ===')
console.log(`scanned_markdown_files=${files.length}`)
console.log(`local_only_markdown_files=${localOnlyFiles.size}`)
for (const [k, v] of Object.entries(counters)) console.log(`${k}=${v}`)
if (problems.length) {
  console.log('--- problems ---')
  for (const p of problems) console.log(p)
}

const failed = Object.keys(labels).some((k) => counters[k] > labels[k])
console.log(`RESULT=${failed ? 'FAIL' : 'PASS'}`)
process.exit(failed ? 1 : 0)
