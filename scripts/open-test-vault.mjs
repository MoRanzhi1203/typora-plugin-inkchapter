/**
 * Open the test vault in Typora with the InkChapter plugin actually loaded.
 *
 * WHY: the community framework loads `test/vault/.typora/plugins` ONLY when the
 * folder is opened as a vault. Launching a lone `.md` file gives a window with
 * no InkChapter UI. This helper always mounts the vault first, waits for the
 * real runtime receipt (`inkchapter-runtime-load.json`, `loadSource=vault`),
 * and only then opens the document — so the plugin is loaded by default.
 *
 * Usage:
 *   node scripts/open-test-vault.mjs                # opens test/vault/doc.md
 *   node scripts/open-test-vault.mjs <doc.md path>  # opens another document
 *   TYPORA_EXE=<path> node scripts/open-test-vault.mjs
 *
 * It never kills a running Typora. Re-mounting the vault into an existing
 * instance is supported by Typora's single-instance behaviour.
 */
import * as child_process from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOAD_RECEIPT = path.join(ROOT, 'test', 'vault', '.typora', 'inkchapter-runtime-load.json')

/** Windows-only, read-only: is a Typora process present? Never kills anything. */
export function isTyporaRunning() {
  if (process.platform !== 'win32') return false
  try {
    const out = child_process.execSync(
      'tasklist /FI "IMAGENAME eq Typora.exe" /NH',
      { encoding: 'utf8', windowsHide: true },
    )
    return /Typora\.exe/i.test(out)
  } catch {
    return false
  }
}

/**
 * Resolve the Typora executable.
 * Order: TYPORA_EXE → common install paths → PATH.
 */
export async function resolveTyporaExe() {
  if (process.env.TYPORA_EXE) return process.env.TYPORA_EXE
  const candidates = [
    'D:\\Typora\\Typora.exe',
    'C:\\Program Files\\Typora\\Typora.exe',
    'C:\\Program Files (x86)\\Typora\\Typora.exe',
  ]
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // try next candidate
    }
  }
  return 'Typora'
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function readReceipt() {
  try {
    const [raw, stat] = await Promise.all([fs.readFile(LOAD_RECEIPT, 'utf8'), fs.stat(LOAD_RECEIPT)])
    const parsed = JSON.parse(raw)
    return { mtimeMs: stat.mtimeMs, loadSource: parsed.loadSource, sha: parsed.mainJsSha256 }
  } catch {
    return null
  }
}

/**
 * Mount the vault, wait for the plugin's own load receipt, then open the doc.
 * Returns true when a fresh `loadSource=vault` receipt was observed.
 */
export async function openTestVault(options = {}) {
  const vaultDir = options.vaultDir ?? path.join(ROOT, 'test', 'vault')
  const docPath = options.docPath ?? path.join(vaultDir, 'doc.md')
  const timeoutMs = options.timeoutMs ?? 20000
  const log = options.log ?? ((message) => console.log(message))

  const exe = await resolveTyporaExe()
  const running = isTyporaRunning()
  const before = await readReceipt()

  log(`[open] typora: ${exe}`)
  log(`[open] vault:  ${vaultDir}`)
  child_process.spawn(exe, [vaultDir], { detached: true, stdio: 'ignore' }).unref()

  // A vault receipt that is already fresh needs no waiting: re-mounting the
  // same folder into a running instance keeps the plugin loaded.
  let loaded = running && before?.loadSource === 'vault'
  if (!loaded) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await sleep(500)
      const now = await readReceipt()
      if (now && now.loadSource === 'vault' && (!before || now.mtimeMs > before.mtimeMs)) {
        loaded = true
        break
      }
    }
  }
  if (!loaded) {
    log('[open] WARN: vault runtime receipt did not refresh; opening the document anyway.')
  } else {
    log('[open] plugin loaded from vault (loadSource=vault)')
  }

  log(`[open] document: ${docPath}`)
  child_process.spawn(exe, [docPath], { detached: true, stdio: 'ignore' }).unref()
  return loaded
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const docArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'))
  const docPath = docArg ? path.resolve(docArg) : undefined
  openTestVault({ docPath }).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
