import * as child_process from 'node:child_process'
import * as fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import * as esbuild from 'esbuild'
import typoraPlugin, { installDevPlugin, closeTypora } from 'esbuild-plugin-typora'
import { sassPlugin } from 'esbuild-sass-plugin'


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

if (IS_DEV) {

  await installDevPlugin()
  await closeTypora()
  child_process.exec('Typora ./test/vault/doc.md')
}
