// document-identity.mjs — pure document identity normalization for the Phase-B
// authority gate. Resolves basename / vault-relative / absolute representations
// of the SAME file into one comparable vault-relative key.
//
// Windows rules: slash normalization, case-insensitive comparison key,
// outside-vault / `../` escape detection. Read-only, no file mutation.

import path from 'node:path'

function toSlash(p) {
  return String(p).replace(/\\/g, '/')
}

function isAbsoluteLike(raw) {
  return path.win32.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('/')
}

/**
 * @param {{ rawDocument?: string|null, vaultRoot?: string|null }} input
 */
export function normalizeDocumentIdentity({ rawDocument, vaultRoot }) {
  const empty = {
    raw: rawDocument ?? '',
    absolutePath: '',
    vaultRelativePath: '',
    comparisonKey: '',
    insideVault: false,
    valid: false,
    reason: 'DOCUMENT_IDENTITY_INVALID',
  }

  if (!rawDocument || typeof rawDocument !== 'string' || rawDocument.trim() === '') {
    return empty
  }
  if (!vaultRoot || typeof vaultRoot !== 'string' || vaultRoot.trim() === '') {
    return { ...empty, raw: rawDocument, reason: 'DOCUMENT_IDENTITY_INVALID' }
  }

  const vaultAbs = path.win32.resolve(vaultRoot)
  let abs
  try {
    abs = isAbsoluteLike(rawDocument)
      ? path.win32.normalize(rawDocument)
      : path.win32.resolve(vaultAbs, rawDocument)
    abs = path.win32.normalize(abs)
  } catch {
    return { ...empty, raw: rawDocument }
  }

  let rel
  try {
    rel = path.win32.relative(vaultAbs, abs)
  } catch {
    return { ...empty, raw: rawDocument }
  }

  // Outside-vault / escape gate — never compare by basename alone.
  if (rel.startsWith('..') || path.win32.isAbsolute(rel)) {
    return {
      raw: rawDocument,
      absolutePath: toSlash(abs),
      vaultRelativePath: toSlash(rel),
      comparisonKey: '',
      insideVault: false,
      valid: false,
      reason: 'DOCUMENT_OUTSIDE_VAULT',
    }
  }

  const vaultRelativePath = toSlash(rel)
  return {
    raw: rawDocument,
    absolutePath: toSlash(abs),
    vaultRelativePath,
    comparisonKey: vaultRelativePath.toLowerCase(),
    insideVault: true,
    valid: true,
    reason: '',
  }
}
