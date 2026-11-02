/**
 * Caption Store — sidecar persistence for Caption System V1.
 *
 * Persistent source of truth for table/figure/code caption records.
 * Mirrors the paragraph-layout-store pattern (one file per document, keyed by
 * normalized relative document key), but keeps captions fully isolated from
 * paragraph-indent overrides.
 *
 * Sidecar files: <vault>/.typora/inkchapter/captions/<safeKey>.json
 *
 * Caption records store ONLY the user title (never "图 3 xxx"); numbering is
 * resolved at render time. See caption-system.ts for the canonical model.
 */

import * as fs from 'fs'
import * as path from 'path'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import type { CaptionRecord } from './caption-system'

// ── Schema ─────────────────────────────────────────────────────────────

export interface CaptionStoreDocument {
  schemaVersion: number
  documentPath: string
  updatedAt: number
  captions: CaptionRecord[]
}

const CURRENT_SCHEMA_VERSION = 1

// ── Vault path resolution ──────────────────────────────────────────────

let captionVaultRootOverride: string | null = null
/** Set vault root for testing. Overrides all other sources. */
export function setCaptionVaultRootForTesting(root: string): void {
  captionVaultRootOverride = root
}

/** Clear the test-only vault root override (after tests). */
export function clearCaptionVaultRootForTesting(): void {
  captionVaultRootOverride = null
}

function resolveVaultRoot(): string | null {
  if (captionVaultRootOverride) return captionVaultRootOverride
  return (globalThis as any).__inkchapter_vault_root__ ?? null
}

function getCaptionSidecarDir(): string | null {
  const vault = resolveVaultRoot()
  if (vault) return path.join(vault, '.typora', 'inkchapter', 'captions')
  // Test fallback only when an explicit test override is set; otherwise disable.
  if (captionVaultRootOverride) {
    return path.join(require('os').tmpdir(), 'inkchapter-captions-test')
  }
  return null
}

function getCaptionSidecarPath(documentKey: string): string | null {
  const dir = getCaptionSidecarDir()
  if (!dir) return null
  return path.join(dir, `${captionSidecarFileName(documentKey)}.json`)
}

/** FNV-1a 32-bit — stable, dependency-free bucket for collision-free file names. */
function hashDocumentKey(documentKey: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < documentKey.length; i++) {
    hash ^= documentKey.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * `<sanitized-basename>-<hash>.json`. The sanitizer alone maps `a/b.md` and
 * `a_b.md` to the same file, so the hash of the full documentKey disambiguates.
 */
function captionSidecarFileName(documentKey: string): string {
  const base = documentKey.split(/[/\\]/).pop() ?? documentKey
  const safeBase = base.replace(/[/\\:*?"<>|]/g, '_').slice(0, 80) || 'document'
  return `${safeBase}-${hashDocumentKey(documentKey)}`
}

/** Pre-hash layout (`<safeKey>.json`) — read-only fallback for existing vaults. */
function getLegacyCaptionSidecarPath(documentKey: string): string | null {
  const dir = getCaptionSidecarDir()
  if (!dir) return null
  return path.join(dir, `${documentKey.replace(/[/\\:*?"<>|]/g, '_')}.json`)
}

function isValidCaptionRecord(value: unknown): value is CaptionRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.captionId === 'string' && record.captionId !== ''
    && typeof record.documentKey === 'string'
    && typeof record.title === 'string'
    && typeof record.type === 'string'
    && record.targetAnchor !== null && typeof record.targetAnchor === 'object'
    && typeof record.createdAt === 'number'
    && typeof record.updatedAt === 'number'
}

// ── Load / Save ────────────────────────────────────────────────────────

export function loadCaptionStore(documentKey: string): CaptionRecord[] | null {
  try {
    const filePath = getCaptionSidecarPath(documentKey)
    if (!filePath) {
      emitRuntimeAudit('CAPTION-REHYDRATE', {
        documentKey,
        decision: 'DISABLED',
        reason: 'vault root unknown — sidecar unavailable',
      }, 'warn')
      return null
    }
    if (!fs.existsSync(filePath)) {
      const legacyPath = getLegacyCaptionSidecarPath(documentKey)
      if (!legacyPath || !fs.existsSync(legacyPath)) return null
      // Pre-hash layout: read it once; the next save writes the hashed name.
      emitRuntimeAudit('CAPTION-REHYDRATE', {
        documentKey,
        decision: 'LEGACY_SIDECAR',
        reason: 'loaded pre-hash sidecar name',
      }, 'info')
      return readCaptionSidecar(legacyPath, documentKey)
    }
    return readCaptionSidecar(filePath, documentKey)
  } catch (e) {
    emitRuntimeAudit('CAPTION-REHYDRATE', {
      documentKey,
      decision: 'ERROR',
      reason: String(e),
    }, 'error')
    return null
  }
}

function readCaptionSidecar(filePath: string, documentKey: string): CaptionRecord[] | null {
  const raw = fs.readFileSync(filePath, 'utf8')
  const data = JSON.parse(raw) as CaptionStoreDocument
  if (!data || data.schemaVersion !== CURRENT_SCHEMA_VERSION || !Array.isArray(data.captions)) {
    emitRuntimeAudit('CAPTION-REHYDRATE', {
      documentKey,
      decision: 'INVALID_SCHEMA',
      reason: 'schema mismatch or missing captions array',
    }, 'warn')
    return null
  }
  const valid = data.captions.filter(isValidCaptionRecord)
  if (valid.length !== data.captions.length) {
    emitRuntimeAudit('CAPTION-REHYDRATE', {
      documentKey,
      decision: 'DROPPED_INVALID_RECORDS',
      dropped: data.captions.length - valid.length,
      kept: valid.length,
    }, 'warn')
  }
  return valid
}

export function saveCaptionStore(
  documentKey: string,
  documentPath: string,
  captions: CaptionRecord[],
): void {
  if (!documentKey || documentKey.trim() === '') {
    emitRuntimeAudit('CAPTION-CLEANUP', {
      decision: 'BLOCKED',
      reason: 'empty documentKey — write prevented',
    }, 'warn')
    return
  }
  const dir = getCaptionSidecarDir()
  if (!dir) {
    emitRuntimeAudit('CAPTION-CLEANUP', {
      documentKey,
      decision: 'DISABLED',
      reason: 'vault root unknown — write blocked',
    }, 'warn')
    return
  }
  const filePath = getCaptionSidecarPath(documentKey)
  if (!filePath) return
  const doc: CaptionStoreDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    documentPath,
    updatedAt: Date.now(),
    captions,
  }
  const tmpPath = filePath + '.tmp'
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 2), 'utf8')
    fs.renameSync(tmpPath, filePath)
  } catch (e) {
    // Keep the previous sidecar intact; a failed write must not interrupt
    // the reconcile pass that called us.
    try {
      fs.unlinkSync(tmpPath)
    } catch { /* tmp may not exist */ }
    emitRuntimeAudit('CAPTION-SAVE', {
      documentKey,
      decision: 'ERROR',
      reason: String(e),
    }, 'error')
  }
}
