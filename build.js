import * as fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import * as esbuild from 'esbuild'
import typoraPlugin, { installDevPlugin, closeTypora } from 'esbuild-plugin-typora'
import { sassPlugin } from 'esbuild-sass-plugin'
import { isTyporaRunning, openTestVault } from './scripts/open-test-vault.mjs'


const args = process.argv.slice(2)
const IS_PROD = args.includes('--prod')
const IS_DEV = !IS_PROD

// Patch esbuild-plugin-typora to handle multiline import type blocks.
// The original regex /import type .+? from/g does not match across newlines (no /s flag),
// causing multiline `import type { ... } from` blocks to produce invalid JS.
// This patch is idempotent and must be applied before each build.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
{
  const typoraPluginPath = path.join(__dirname, 'node_modules', 'esbuild-plugin-typora', 'index.js')
  const original = await fs.readFile(typoraPluginPath, 'utf8')
  // Only patch if the regex lacks the /s flag (avoid double-patching)
  if (original.includes("import type .+? from ['\"][^'\"]+['\"];?/g") &&
      !original.includes("import type .+? from ['\"][^'\"]+['\"];?/gs")) {
    const patched = original.replace(
      "import type .+? from ['\"][^'\"]+['\"];?/g",
      "import type .+? from ['\"][^'\"]+['\"];?/gs",
    )
    await fs.writeFile(typoraPluginPath, patched, 'utf8')
    console.log('[build] patched esbuild-plugin-typora for multiline import type')
  }
}

await fs.rm('./dist', { recursive: true, force: true })

try {
  await fs.access('./src/locales')
  await fs.cp('./src/locales', './dist/locales', { recursive: true })
}
catch (e) {
}

await esbuild.build({
  entryPoints: ['src/main.ts'],
  outdir: 'dist',
  format: 'esm',
  bundle: true,
  minify: IS_PROD,
  sourcemap: IS_DEV,
  plugins: [
    typoraPlugin({
      mode: IS_PROD ? 'production' : 'development'
    }),
    sassPlugin(),
  ],
})

// Typora「Custom Command」上传器入口。独立 CJS 产物，避免把 Node CLI
// 依赖塞进渲染进程主包；部署到插件 dist 后由 profile.data 的绝对路径调用。
await esbuild.build({
  entryPoints: ['src/image-management/upload-cli.ts'],
  outfile: 'dist/upload-cli.cjs',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  bundle: true,
  minify: IS_PROD,
  sourcemap: IS_DEV,
})

if (IS_DEV) {

  await installDevPlugin()
  // Never close a running Typora just because a dev build finished: the user may
  // have unsaved windows. closeTypora() removes the community-framework dev lock
  // (which makes the running app quit) and the old flow then relaunched it.
  // Skipping both keeps every window intact; the new artifact still lands in
  // test/vault/.typora/plugins/dist and is loaded on the next manual restart.
  if (isTyporaRunning()) {
    console.log('[build] Typora is running — skipped closeTypora()/relaunch to preserve open windows.')
    console.log('[build] Restart Typora manually to load the new build from test/vault/.typora/plugins/dist.')
  } else {
    // AUDIT: closeTypora() removes the community-framework dev lock
    // (`node_modules/@typora-community-plugin/core/dist/_lock/win-test`). The
    // development core watches that file and calls `window.close` on `rename`, so
    // deleting it is exactly what terminated Typora in the automated flows. Never
    // call it from a build: mount the vault and open the document instead.
    // Always mount the VAULT first (a lone `.md` launch yields a window without
    // the InkChapter UI), wait for the real plugin receipt, then open the doc.
    await openTestVault()
  }
} else {
  // esbuild-sass-plugin names the compiled stylesheet after the `main.ts` entry
  // (`main.css`); the runtime loader and deploy contract expect `style.css`.
  try {
    await fs.rename('./dist/main.css', './dist/style.css')
  } catch {
    // no compiled stylesheet to rename
  }
}
