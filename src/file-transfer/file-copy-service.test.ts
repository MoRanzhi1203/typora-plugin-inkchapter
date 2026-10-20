import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { FileCopyService } from './file-copy-service'

let sandbox = ''
let vault = ''
let destination = ''
let sourceDir = ''

function sha256(filePath: string): string {
  return createHash('sha256').update(new Uint8Array(fs.readFileSync(filePath))).digest('hex')
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-file-copy-'))
  vault = path.join(sandbox, 'vault')
  destination = path.join(vault, 'docs')
  sourceDir = path.join(sandbox, 'sources')
  fs.mkdirSync(destination, { recursive: true })
  fs.mkdirSync(sourceDir, { recursive: true })
})

afterEach(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true })
})

describe('FileCopyService · real copies', () => {
  it('copies real bytes, preserves the source, and reports sizes', async () => {
    const source = path.join(sourceDir, 'a.md')
    write(source, '# Hello 墨章\n')
    const sourceHashBefore = sha256(source)

    const result = await new FileCopyService().copyBatch([source], destination, { vaultRoot: vault })

    expect(result.copiedCount).toBe(1)
    expect(result.failedCount).toBe(0)
    expect(result.sourcePreserved).toBe(true)

    const copied = path.join(destination, 'a.md')
    expect(fs.existsSync(copied)).toBe(true)
    expect(fs.readFileSync(copied, 'utf8')).toBe('# Hello 墨章\n')
    expect(sha256(copied)).toBe(sourceHashBefore)
    expect(fs.existsSync(source)).toBe(true)
    expect(sha256(source)).toBe(sourceHashBefore)
    expect(result.entries[0].bytes).toBe(Buffer.byteLength('# Hello 墨章\n'))

    // Evidence for the final report: same hash, source still present.
    console.log('[EVIDENCE][COPY]', JSON.stringify({
      source,
      destination: copied,
      sourceHashBefore,
      sourceHashAfter: sha256(source),
      destinationHash: sha256(copied),
      sourceStillExists: fs.existsSync(source),
      bytes: result.entries[0].bytes,
    }))
  })

  it('imports a batch of .md and .markdown files', async () => {
    const a = path.join(sourceDir, 'a.md')
    const b = path.join(sourceDir, 'b.markdown')
    write(a, 'A')
    write(b, 'B')

    const result = await new FileCopyService().copyBatch([a, b], destination, { vaultRoot: vault })

    expect(result.copiedCount).toBe(2)
    expect(fs.readFileSync(path.join(destination, 'a.md'), 'utf8')).toBe('A')
    expect(fs.readFileSync(path.join(destination, 'b.markdown'), 'utf8')).toBe('B')
    expect(fs.existsSync(a) && fs.existsSync(b)).toBe(true)
  })

  it('copies 0-byte Markdown files byte-for-byte', async () => {
    const source = path.join(sourceDir, 'empty.md')
    fs.writeFileSync(source, '', 'utf8')
    const result = await new FileCopyService().copyBatch([source], destination, { vaultRoot: vault })

    expect(result.copiedCount).toBe(1)
    const copied = path.join(destination, 'empty.md')
    expect(fs.statSync(copied).size).toBe(0)
    expect(sha256(copied)).toBe(sha256(source))
  })

  it('copies Chinese / space / Unicode names and CRLF bytes unchanged', async () => {
    const source = path.join(sourceDir, '中文 名称（空格）.md')
    fs.writeFileSync(source, '第一行\r\n第二行\r\n', 'utf8')
    const result = await new FileCopyService().copyBatch([source], destination, { vaultRoot: vault })

    expect(result.copiedCount).toBe(1)
    const copied = path.join(destination, '中文 名称（空格）.md')
    expect(fs.existsSync(copied)).toBe(true)
    expect(fs.readFileSync(copied)).toEqual(fs.readFileSync(source))
    expect(sha256(copied)).toBe(sha256(source))
  })

  it('treats case-different names as conflicts on Windows', async () => {
    if (process.platform !== 'win32') return
    const source = path.join(sourceDir, 'note.md')
    write(source, 'NEW')
    write(path.join(destination, 'Note.md'), 'OLD')

    const result = await new FileCopyService().copyBatch([source], destination, { vaultRoot: vault })

    expect(result.copiedCount).toBe(1)
    expect(result.conflictCount).toBe(1)
    expect(result.entries[0].destination).toBe(path.join(destination, 'note (2).md'))
    expect(fs.readFileSync(path.join(destination, 'Note.md'), 'utf8')).toBe('OLD')
  })

  it('continues the batch when one source is invalid', async () => {
    const valid = path.join(sourceDir, 'valid.md')
    write(valid, 'ok')
    const missing = path.join(sourceDir, 'missing.md')

    const result = await new FileCopyService().copyBatch([missing, valid], destination, { vaultRoot: vault })

    expect(result.copiedCount).toBe(1)
    expect(result.failedCount).toBe(1)
    expect(result.entries[0].reason).toBe('SOURCE_MISSING')
    expect(fs.existsSync(path.join(destination, 'valid.md'))).toBe(true)
  })
})

describe('FileCopyService · conflicts', () => {
  it('renames on conflict by default and keeps the existing file', async () => {
    const source = path.join(sourceDir, 'a.md')
    write(source, 'NEW')
    write(path.join(destination, 'a.md'), 'OLD')

    const result = await new FileCopyService().copyBatch([source], destination, { vaultRoot: vault })

    expect(result.copiedCount).toBe(1)
    expect(result.conflictCount).toBe(1)
    expect(result.entries[0].renamed).toBe(true)
    expect(result.entries[0].destination).toBe(path.join(destination, 'a (2).md'))
    expect(fs.readFileSync(path.join(destination, 'a.md'), 'utf8')).toBe('OLD')
    expect(fs.readFileSync(path.join(destination, 'a (2).md'), 'utf8')).toBe('NEW')
  })

  it('skips on conflict when configured', async () => {
    const source = path.join(sourceDir, 'a.md')
    write(source, 'NEW')
    write(path.join(destination, 'a.md'), 'OLD')

    const result = await new FileCopyService().copyBatch([source], destination, {
      vaultRoot: vault,
      conflictPolicy: 'skip',
    })

    expect(result.copiedCount).toBe(0)
    expect(result.skippedCount).toBe(1)
    expect(result.entries[0].reason).toBe('CONFLICT_SKIPPED')
    expect(fs.readFileSync(path.join(destination, 'a.md'), 'utf8')).toBe('OLD')
  })

  it('overwrites only when explicitly configured', async () => {
    const source = path.join(sourceDir, 'a.md')
    write(source, 'NEW')
    write(path.join(destination, 'a.md'), 'OLD')

    const result = await new FileCopyService().copyBatch([source], destination, {
      vaultRoot: vault,
      conflictPolicy: 'overwrite',
    })

    expect(result.copiedCount).toBe(1)
    expect(result.conflictCount).toBe(1)
    expect(fs.readFileSync(path.join(destination, 'a.md'), 'utf8')).toBe('NEW')
    expect(fs.readFileSync(source, 'utf8')).toBe('NEW')
  })
})

describe('FileCopyService · safety gates', () => {
  it('rejects unsupported extensions', async () => {
    const source = path.join(sourceDir, 'a.txt')
    write(source, 'text')
    const result = await new FileCopyService().copyBatch([source], destination, { vaultRoot: vault })
    expect(result.failedCount).toBe(1)
    expect(result.entries[0].reason).toBe('UNSUPPORTED_EXTENSION')
    expect(fs.existsSync(path.join(destination, 'a.txt'))).toBe(false)
  })

  it('rejects destinations outside the vault', async () => {
    const source = path.join(sourceDir, 'a.md')
    write(source, 'A')
    const outside = path.join(sandbox, 'outside')
    fs.mkdirSync(outside)
    const result = await new FileCopyService().copyBatch([source], outside, { vaultRoot: vault })
    expect(result.entries[0].reason).toBe('DESTINATION_OUTSIDE_VAULT')
    expect(fs.existsSync(path.join(outside, 'a.md'))).toBe(false)
  })

  it('rejects a missing destination directory', async () => {
    const source = path.join(sourceDir, 'a.md')
    write(source, 'A')
    const result = await new FileCopyService().copyBatch(
      [source],
      path.join(vault, 'missing'),
      { vaultRoot: vault },
    )
    expect(result.entries[0].reason).toBe('DESTINATION_MISSING')
  })

  it('rejects a destination that is a file', async () => {
    const source = path.join(sourceDir, 'a.md')
    write(source, 'A')
    const notDirectory = path.join(vault, 'file.md')
    write(notDirectory, 'x')
    const result = await new FileCopyService().copyBatch([source], notDirectory, { vaultRoot: vault })
    expect(result.entries[0].reason).toBe('DESTINATION_NOT_DIRECTORY')
  })

  it('rejects an empty source', async () => {
    const result = await new FileCopyService().copyBatch([''], destination, { vaultRoot: vault })
    expect(result.entries[0].reason).toBe('INVALID_SOURCE')
  })

  it('skips when source and destination are the same file', async () => {
    const source = path.join(destination, 'same.md')
    write(source, 'same')
    const result = await new FileCopyService().copyBatch([source], destination, { vaultRoot: vault })
    expect(result.skippedCount).toBe(1)
    expect(result.entries[0].reason).toBe('SAME_FILE')
    expect(fs.readFileSync(source, 'utf8')).toBe('same')
  })

  it('rejects a symlinked destination directory (when the OS allows creating one)', async () => {
    const source = path.join(sourceDir, 'a.md')
    write(source, 'A')
    const link = path.join(vault, 'link')
    try {
      fs.symlinkSync(destination, link, 'junction')
    } catch {
      return
    }
    const result = await new FileCopyService().copyBatch([source], link, { vaultRoot: vault })
    expect(result.entries[0].reason).toBe('DESTINATION_SYMLINK_REJECTED')
  })

  it('rejects a path whose realpath escapes the vault through a parent junction', async () => {
    const source = path.join(sourceDir, 'a.md')
    write(source, 'A')
    const outside = path.join(sandbox, 'outside-real')
    const outsideSub = path.join(outside, 'sub')
    fs.mkdirSync(outsideSub, { recursive: true })
    const link = path.join(vault, 'link-to-outside')
    try {
      fs.symlinkSync(outside, link, 'junction')
    } catch {
      return
    }
    const result = await new FileCopyService().copyBatch(
      [source],
      path.join(link, 'sub'),
      { vaultRoot: vault },
    )
    expect(result.entries[0].reason).toBe('DESTINATION_OUTSIDE_VAULT')
    expect(result.entries[0].detail).toBe('REALPATH')
    expect(fs.existsSync(path.join(outsideSub, 'a.md'))).toBe(false)
  })

  it('rejects a symlinked source file (when the OS allows creating one)', async () => {
    const real = path.join(sourceDir, 'real.md')
    write(real, 'A')
    const link = path.join(sourceDir, 'link.md')
    try {
      fs.symlinkSync(real, link, 'file')
    } catch {
      return
    }
    const result = await new FileCopyService().copyBatch([link], destination, { vaultRoot: vault })
    expect(result.entries[0].reason).toBe('SOURCE_SYMLINK_REJECTED')
  })
})
