// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  loadCaptionStore,
  saveCaptionStore,
  setCaptionVaultRootForTesting,
  clearCaptionVaultRootForTesting,
} from './caption-store'
import { computeCaptionAnchor, type CaptionRecord } from './caption-system'

const TEST_VAULT = (() => {
  const dir = path.join(os.tmpdir(), `inkchapter-caption-test-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
})()

beforeEach(() => {
  setCaptionVaultRootForTesting(TEST_VAULT)
})

afterEach(() => {
  clearCaptionVaultRootForTesting()
  const dir = path.join(TEST_VAULT, '.typora', 'inkchapter', 'captions')
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f))
  }
})

function record(id: string, title: string, ordinal: number): CaptionRecord {
  return {
    captionId: id,
    documentKey: 'doc-a',
    type: 'figure',
    title,
    targetAnchor: computeCaptionAnchor('figure', ordinal),
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('Caption Store sidecar persistence', () => {
  it('round-trips caption records for a document', () => {
    saveCaptionStore('doc-a', '/vault/doc-a.md', [record('f1', '架构', 0), record('f2', '细节', 1)])

    const loaded = loadCaptionStore('doc-a')
    expect(loaded).not.toBeNull()
    expect(loaded).toHaveLength(2)
    expect(loaded![0].captionId).toBe('f1')
    expect(loaded![0].title).toBe('架构')
    expect(loaded![0].targetAnchor.ordinal).toBe(0)
  })

  it('returns null for a document with no sidecar file', () => {
    expect(loadCaptionStore('missing-doc')).toBeNull()
  })

  it('isolates documents by documentKey', () => {
    saveCaptionStore('doc-a', '/vault/a.md', [record('f1', 'A', 0)])
    saveCaptionStore('doc-b', '/vault/b.md', [record('b1', 'B', 0)])

    const a = loadCaptionStore('doc-a')
    const b = loadCaptionStore('doc-b')
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a![0].captionId).not.toBe(b![0].captionId)
  })

  it('persists title only (never a rendered "图 N xxx" string)', () => {
    saveCaptionStore('doc-a', '/vault/a.md', [record('f1', '系统架构', 0)])
    const loaded = loadCaptionStore('doc-a')!
    expect(loaded[0].title).toBe('系统架构')
    expect(loaded[0].title).not.toContain('图')
    expect(loaded[0].title).not.toMatch(/\d/)
  })
})
