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
  const safeKey = documentKey.replace(/[/\\:*?"<>|]/g, '_')
  return path.join(dir, `${safeKey}.json`)
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
      return null
    }
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
    return data.captions
  } catch (e) {
    emitRuntimeAudit('CAPTION-REHYDRATE', {
      documentKey,
      decision: 'ERROR',
      reason: String(e),
    }, 'error')
    return null
  }
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
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
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
  fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 2), 'utf8')
  fs.renameSync(tmpPath, filePath)
}
