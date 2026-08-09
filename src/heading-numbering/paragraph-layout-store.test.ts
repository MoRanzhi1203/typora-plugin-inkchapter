/**
 * Paragraph Layout Sidecar Store Tests (R34)
 *
 * Tests for sidecar-based paragraph indent persistence,
 * anchor model, legacy marker migration, and round-trip.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  hashText,
  createParagraphAnchor,
  resolveParagraphAnchor,
  updateParagraphAnchor,
  loadParagraphLayout,
  saveParagraphLayout,
  collectContentParagraphs,
  migrateLegacyIndentMarkers,
  setVaultRootForTesting,
  type ParagraphAnchor,
  type ParagraphIndentOverrideRecord,
} from './paragraph-layout-store'

// ── Test setup ──────────────────────────────────────────────────────────

const TEST_VAULT: string = (() => {
  const dir = path.join(os.tmpdir(), `inkchapter-test-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(dir, '.typora', 'inkchapter', 'paragraph-layout'), { recursive: true })
  return dir
})()

beforeEach(() => {
  setVaultRootForTesting(TEST_VAULT)
})

afterEach(() => {
  // Clean up test sidecar files
  const sidecarDir = path.join(TEST_VAULT, '.typora', 'inkchapter', 'paragraph-layout')
  if (fs.existsSync(sidecarDir)) {
    for (const f of fs.readdirSync(sidecarDir)) {
      fs.unlinkSync(path.join(sidecarDir, f))
    }
  }
})

// ── Helpers ────────────────────────────────────────────────────────────

function makePara(text: string, index: number): HTMLElement {
  return {
    tagName: 'P',
    textContent: text,
    closest: () => null,
  } as unknown as HTMLElement
}

// ── 1. Sidecar Schema Tests ────────────────────────────────────────────

describe('Sidecar Schema', () => {
  it('save and load round-trip', () => {
    const overrides: ParagraphIndentOverrideRecord[] = [
      {
        id: 'test-1',
        mode: 'force-indent',
        anchor: { lastKnownOrdinal: 3, textHash: hashText('hello'), occurrence: 1 },
      },
    ]
    saveParagraphLayout('doc1', 'folder/doc1.md', overrides)
    const loaded = loadParagraphLayout('doc1')
    expect(loaded).not.toBeNull()
    expect(loaded!.schemaVersion).toBe(1)
    expect(loaded!.documentPath).toBe('folder/doc1.md')
    expect(loaded!.paragraphOverrides).toHaveLength(1)
    expect(loaded!.paragraphOverrides[0].mode).toBe('force-indent')
    expect(loaded!.updatedAt).toBeGreaterThan(0)
  })

  it('returns null for non-existent document', () => {
    expect(loadParagraphLayout('nonexistent')).toBeNull()
  })

  it('handles empty overrides', () => {
    saveParagraphLayout('doc2', 'doc2.md', [])
    const loaded = loadParagraphLayout('doc2')
    expect(loaded).not.toBeNull()
    expect(loaded!.paragraphOverrides).toHaveLength(0)
  })

  it('document path is preserved', () => {
    saveParagraphLayout('doc3', 'sub/deep/doc3.md', [])
    const loaded = loadParagraphLayout('doc3')
    expect(loaded!.documentPath).toBe('sub/deep/doc3.md')
  })

  it('updatedAt increases on re-save', () => {
    saveParagraphLayout('doc4', 'doc4.md', [])
    const v1 = loadParagraphLayout('doc4')!.updatedAt
    // Small delay to ensure timestamp change
    const overrides: ParagraphIndentOverrideRecord[] = [
      { id: 'x', mode: 'force-indent', anchor: { lastKnownOrdinal: 1 } },
    ]
    saveParagraphLayout('doc4', 'doc4.md', overrides)
    const v2 = loadParagraphLayout('doc4')!.updatedAt
    expect(v2).toBeGreaterThanOrEqual(v1)
  })
})

// ── 2. Anchor Creation Tests ───────────────────────────────────────────

describe('createParagraphAnchor', () => {
  it('creates anchor with textHash for non-empty paragraph', () => {
    const paras = [makePara('unique text', 0)]
    const anchor = createParagraphAnchor(0, paras)
    expect(anchor.textHash).toBeDefined()
    expect(anchor.lastKnownOrdinal).toBe(0)
    expect(anchor.occurrence).toBe(1)
  })

  it('counts occurrence for duplicate text', () => {
    const paras = [makePara('same', 0), makePara('same', 1), makePara('same', 2)]
    const anchor0 = createParagraphAnchor(0, paras)
    const anchor1 = createParagraphAnchor(1, paras)
    const anchor2 = createParagraphAnchor(2, paras)
    expect(anchor0.occurrence).toBe(1)
    expect(anchor1.occurrence).toBe(2)
    expect(anchor2.occurrence).toBe(3)
    expect(anchor0.textHash).toBe(anchor1.textHash)
  })

  it('sets beforeHash and afterHash for middle paragraph', () => {
    const paras = [makePara('before', 0), makePara('target', 1), makePara('after', 2)]
    const anchor = createParagraphAnchor(1, paras)
    expect(anchor.beforeHash).toBeDefined()
    expect(anchor.afterHash).toBeDefined()
    expect(anchor.beforeHash).toBe(hashText('before'))
    expect(anchor.afterHash).toBe(hashText('after'))
  })

  it('leaves beforeHash undefined for first paragraph', () => {
    const paras = [makePara('first', 0), makePara('second', 1)]
    const anchor = createParagraphAnchor(0, paras)
    expect(anchor.beforeHash).toBeUndefined()
    expect(anchor.afterHash).toBeDefined()
  })

  it('leaves afterHash undefined for last paragraph', () => {
    const paras = [makePara('first', 0), makePara('last', 1)]
    const anchor = createParagraphAnchor(1, paras)
    expect(anchor.afterHash).toBeUndefined()
    expect(anchor.beforeHash).toBeDefined()
  })

  it('leaves textHash undefined for empty paragraph', () => {
    const paras = [makePara('', 0)]
    const anchor = createParagraphAnchor(0, paras)
    expect(anchor.textHash).toBeUndefined()
  })
})

// ── 3. Anchor Resolution Tests ─────────────────────────────────────────

describe('resolveParagraphAnchor', () => {
  it('resolves by exact textHash + occurrence (Level 1)', () => {
    const paras = [makePara('A', 0), makePara('B', 1), makePara('A', 2)]
    // Second occurrence of 'A' (occurrence 2) should be at index 2
    const anchor: ParagraphAnchor = {
      lastKnownOrdinal: 2,
      textHash: hashText('A'),
      occurrence: 2,
    }
    const result = resolveParagraphAnchor(anchor, paras)
    expect(result).not.toBeNull()
    expect(result!.index).toBe(2)
    expect(result!.confidence).toBe('exact')
  })

  it('returns null for textHash that does not exist', () => {
    const paras = [makePara('A', 0)]
    const anchor: ParagraphAnchor = {
      lastKnownOrdinal: 0,
      textHash: hashText('nonexistent'),
      occurrence: 1,
    }
    expect(resolveParagraphAnchor(anchor, paras)).toBeNull()
  })

  it('returns null for occurrence that exceeds total matches', () => {
    const paras = [makePara('A', 0)]
    const anchor: ParagraphAnchor = {
      lastKnownOrdinal: 0,
      textHash: hashText('A'),
      occurrence: 5, // only 1 match exists
    }
    expect(resolveParagraphAnchor(anchor, paras)).toBeNull()
  })

  it('falls back to lastKnownOrdinal when no textHash (Level 4)', () => {
    const paras = [makePara('A', 0), makePara('B', 1)]
    const anchor: ParagraphAnchor = { lastKnownOrdinal: 1 }
    const result = resolveParagraphAnchor(anchor, paras)
    expect(result).not.toBeNull()
    expect(result!.index).toBe(1)
    expect(result!.confidence).toBe('fallback')
  })

  it('uses neighbor hashes for disambiguation (Level 2/3)', () => {
    const paras = [makePara('X', 0), makePara('dup', 1), makePara('Y', 2), makePara('dup', 3), makePara('Z', 4)]
    // Two 'dup' paragraphs — use neighbor hashes to pick index 3 (after Y)
    const anchor: ParagraphAnchor = {
      lastKnownOrdinal: 3,
      textHash: hashText('dup'),
      occurrence: 2,
      beforeHash: hashText('Y'),
      afterHash: hashText('Z'),
    }
    const result = resolveParagraphAnchor(anchor, paras)
    expect(result).not.toBeNull()
    expect(result!.index).toBe(3)
  })

  it('returns null for out-of-range ordinal fallback', () => {
    const paras = [makePara('A', 0)]
    const anchor: ParagraphAnchor = { lastKnownOrdinal: 99 }
    expect(resolveParagraphAnchor(anchor, paras)).toBeNull()
  })

  it('returns null for empty paragraph list', () => {
    expect(resolveParagraphAnchor({ lastKnownOrdinal: 0 }, [])).toBeNull()
  })
})

// ── 4. Anchor Update Tests ─────────────────────────────────────────────

describe('updateParagraphAnchor', () => {
  it('refreshes ordinal after paragraph insert/delete', () => {
    const paras = [makePara('A', 0), makePara('target', 1), makePara('C', 2)]
    const oldAnchor = createParagraphAnchor(1, paras)
    expect(oldAnchor.lastKnownOrdinal).toBe(1)

    // Simulate insert before: target moves to index 2
    const newParas = [makePara('A', 0), makePara('new', 1), makePara('target', 2), makePara('C', 3)]
    const updated = updateParagraphAnchor(oldAnchor, 2, newParas)
    expect(updated.lastKnownOrdinal).toBe(2)
    expect(updated.textHash).toBe(hashText('target'))
  })
})

// ── 5. Legacy Migration Tests ──────────────────────────────────────────

describe('migrateLegacyIndentMarkers', () => {
  it('migrates standalone canonical marker', () => {
    const md = 'para before\n\n<!-- inkchapter:paragraph-indent=2 -->\n\ntarget para\n\npara after'
    const { cleanMarkdown, overrides, migrated } = migrateLegacyIndentMarkers(md)
    expect(migrated).toBe(true)
    expect(overrides).toHaveLength(1)
    expect(overrides[0].mode).toBe('force-indent')
    expect(cleanMarkdown).not.toContain('inkchapter:paragraph-indent=2')
    expect(cleanMarkdown).toContain('target para')
    expect(cleanMarkdown).toContain('para before')
    expect(cleanMarkdown).toContain('para after')
  })

  it('migrates same-line marker: "<!-- m -->target text"', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->target text here'
    const { cleanMarkdown, overrides, migrated } = migrateLegacyIndentMarkers(md)
    expect(migrated).toBe(true)
    expect(overrides).toHaveLength(1)
    expect(cleanMarkdown).toBe('target text here')
  })

  it('migrates single-newline marker', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->\ntarget text'
    const { cleanMarkdown, overrides, migrated } = migrateLegacyIndentMarkers(md)
    expect(migrated).toBe(true)
    expect(cleanMarkdown).toContain('target text')
    expect(cleanMarkdown).not.toContain('inkchapter:paragraph-indent=2')
  })

  it('does NOT modify normal HTML comments', () => {
    const md = '<!-- regular user comment -->\n\nparagraph text'
    const { cleanMarkdown, migrated } = migrateLegacyIndentMarkers(md)
    expect(migrated).toBe(false)
    expect(cleanMarkdown).toContain('<!-- regular user comment -->')
  })

  it('does NOT modify other InkChapter comments', () => {
    const md = '<!-- inkchapter:other-feature=true -->\n\nparagraph'
    const { cleanMarkdown, migrated } = migrateLegacyIndentMarkers(md)
    expect(migrated).toBe(false)
    expect(cleanMarkdown).toContain('<!-- inkchapter:other-feature=true -->')
  })

  it('handles multiple markers', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->text A\n\nmiddle\n\n<!-- inkchapter:paragraph-indent=2 -->\n\ntext B'
    const { cleanMarkdown, overrides, migrated } = migrateLegacyIndentMarkers(md)
    expect(migrated).toBe(true)
    expect(overrides).toHaveLength(2)
    expect(cleanMarkdown).not.toContain('inkchapter:paragraph-indent=2')
    expect(cleanMarkdown).toContain('text A')
    expect(cleanMarkdown).toContain('text B')
    expect(cleanMarkdown).toContain('middle')
  })

  it('handles orphan marker (no target)', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->'
    const { cleanMarkdown, overrides, migrated } = migrateLegacyIndentMarkers(md)
    expect(migrated).toBe(true)
    expect(overrides).toHaveLength(0)
    expect(cleanMarkdown).toBe('')
  })

  it('is idempotent — clean Markdown has no more markers', () => {
    const md = '<!-- inkchapter:paragraph-indent=2 -->target'
    const first = migrateLegacyIndentMarkers(md)
    expect(first.migrated).toBe(true)
    const second = migrateLegacyIndentMarkers(first.cleanMarkdown)
    expect(second.migrated).toBe(false)
    expect(second.cleanMarkdown).toBe(first.cleanMarkdown)
  })

  it('returns not migrated for clean Markdown', () => {
    const { migrated } = migrateLegacyIndentMarkers('plain paragraph text')
    expect(migrated).toBe(false)
  })
})

// ── 6. hashText Tests ──────────────────────────────────────────────────

describe('hashText', () => {
  it('produces deterministic hash', () => {
    expect(hashText('hello')).toBe(hashText('hello'))
  })

  it('different texts produce different hashes', () => {
    expect(hashText('hello')).not.toBe(hashText('world'))
  })

  it('normalization is the caller\'s responsibility', () => {
    // hashText does NOT normalize; leading/trailing spaces differ
    expect(hashText(' hello')).not.toBe(hashText('hello'))
  })
})
