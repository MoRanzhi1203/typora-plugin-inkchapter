import { describe, it, expect } from 'vitest'
import {
  NUMBERING_ACCEPTANCE_DOCUMENT_IN_VAULT,
  resolveNumberingAcceptanceGate,
} from './numbering-acceptance-runner'

const VAULT = 'D:/repo/test/vault'
const DOC = `${VAULT}/${NUMBERING_ACCEPTANCE_DOCUMENT_IN_VAULT}`

describe('R08 — numbering acceptance gate', () => {
  it('is disabled outside the repository test vault', () => {
    expect(resolveNumberingAcceptanceGate({
      vaultRoot: 'D:/user/notes',
      activeFilePath: 'D:/user/notes/a.md',
      requestToken: 't',
      lastReportToken: null,
    })).toEqual({ enabled: false, reason: 'NOT_TEST_VAULT' })
  })

  it('is disabled for any other document in the vault', () => {
    expect(resolveNumberingAcceptanceGate({
      vaultRoot: VAULT,
      activeFilePath: 'D:/repo/test/vault/doc.md',
      requestToken: 't',
      lastReportToken: null,
    })).toEqual({ enabled: false, reason: 'NOT_ACCEPTANCE_DOCUMENT' })
  })

  it('requires a request token', () => {
    expect(resolveNumberingAcceptanceGate({
      vaultRoot: VAULT,
      activeFilePath: DOC,
      requestToken: null,
      lastReportToken: null,
    })).toEqual({ enabled: false, reason: 'NO_REQUEST_TOKEN' })
  })

  it('does not re-run the same token', () => {
    expect(resolveNumberingAcceptanceGate({
      vaultRoot: VAULT,
      activeFilePath: DOC,
      requestToken: 't1',
      lastReportToken: 't1',
    })).toEqual({ enabled: false, reason: 'ALREADY_RUN' })
  })

  it('enables on the dedicated fixture with a fresh token (path case tolerant)', () => {
    expect(resolveNumberingAcceptanceGate({
      vaultRoot: VAULT.replace(/\//g, '\\'),
      activeFilePath: DOC.toLowerCase(),
      requestToken: ' t2 ',
      lastReportToken: 't1',
    })).toEqual({ enabled: true, reason: 'ENABLED' })
  })
})
