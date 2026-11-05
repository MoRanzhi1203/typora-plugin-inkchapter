import { describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_SETTINGS, resolveImageSettings } from './image-settings'
import {
  decideInsertionAction,
  detectNewImageReferences,
  isAbsoluteLocalDestination,
  isRemoteImageDestination,
  planInsertionActions,
} from './image-insertion-policy'

function settings(overrides: Record<string, unknown> = {}) {
  return resolveImageSettings({ ...DEFAULT_IMAGE_SETTINGS, ...overrides } as never)
}

const REMOTE = 'https://cdn.example.test/a.png'
const LOCAL_ABS = 'C:\\Users\\me\\Pictures\\a.png'

describe('detectNewImageReferences', () => {
  it('returns every reference when there is no previous markdown', () => {
    const refs = detectNewImageReferences(null, `![a](${REMOTE})\n`)
    expect(refs).toHaveLength(1)
    expect(refs[0].rawDestination).toBe(REMOTE)
  })

  it('detects one newly inserted image', () => {
    const refs = detectNewImageReferences(
      `![a](${REMOTE})\n`,
      `![a](${REMOTE})\n\n![](assets/new.png)\n`,
    )
    expect(refs).toHaveLength(1)
    expect(refs[0].rawDestination).toBe('assets/new.png')
  })

  it('does not report deletions, and is insensitive to offset changes', () => {
    const before = `# title\n\n![a](${REMOTE})\n`
    const after = `# title\n\nmore text\n\n![a](${REMOTE})\n`
    expect(detectNewImageReferences(before, after)).toEqual([])
  })

  it('detects a second insertion of the exact same image', () => {
    const before = `![](${REMOTE})\n`
    const after = `![](${REMOTE})\n\n![](${REMOTE})\n`
    expect(detectNewImageReferences(before, after)).toHaveLength(1)
  })
})

describe('insertion policy decisions (native semantics preserved by default)', () => {
  it('does nothing when image management is disabled', () => {
    const decision = decideInsertionAction({
      settings: settings({ enabled: false, autoLocalizeOnInsert: true }),
      reference: { rawDestination: REMOTE, rawToken: `![](${REMOTE})` },
    })
    expect(decision.action).toBe('NONE')
    expect(decision.reason).toBe('DISABLED')
  })

  it('leaves remote insertions untouched unless autoLocalizeOnInsert is on', () => {
    const decision = decideInsertionAction({
      settings: settings({ enabled: true, autoLocalizeOnInsert: false }),
      reference: { rawDestination: REMOTE, rawToken: `![](${REMOTE})` },
    })
    expect(decision.action).toBe('NONE')
    expect(decision.reason).toBe('POLICY_OFF')
  })

  it('localizes a new remote image when the document policy enables it', () => {
    const decision = decideInsertionAction({
      settings: settings({ enabled: true, autoLocalizeOnInsert: true, referenceMode: 'local-relative' }),
      reference: { rawDestination: REMOTE, rawToken: `![](${REMOTE})` },
    })
    expect(decision.action).toBe('LOCALIZE')
    expect(decision.reason).toBe('LOCALIZE_ENABLED')
  })

  it('does not localize when the reference mode is remote-url', () => {
    const decision = decideInsertionAction({
      settings: settings({ enabled: true, autoLocalizeOnInsert: true, referenceMode: 'remote-url' }),
      reference: { rawDestination: REMOTE, rawToken: `![](${REMOTE})` },
    })
    expect(decision.action).toBe('NONE')
    expect(decision.reason).toBe('NOT_ELIGIBLE')
  })

  it('uploads a new absolute local image only with autoUpload + github', () => {
    const profile = {
      remoteProfileId: 'p1', provider: 'github', owner: 'o', repository: 'r', branch: 'main',
      remoteDirectory: '', urlStrategy: 'raw', customUrlBase: '', credentialReferenceId: 'c', enabled: true,
    }
    const decision = decideInsertionAction({
      settings: settings({ enabled: true, autoUpload: true, uploadService: 'github', remoteProfiles: [profile] }),
      reference: { rawDestination: LOCAL_ABS, rawToken: `![a](${LOCAL_ABS})` },
    })
    expect(decision.action).toBe('UPLOAD')
    expect(decision.reason).toBe('UPLOAD_ENABLED')
  })

  it('does not upload when the upload service is none', () => {
    const decision = decideInsertionAction({
      settings: settings({ enabled: true, autoUpload: true, uploadService: 'none' }),
      reference: { rawDestination: LOCAL_ABS, rawToken: `![a](${LOCAL_ABS})` },
    })
    expect(decision.action).toBe('NONE')
    expect(decision.reason).toBe('NOT_ELIGIBLE')
  })

  it('never touches already-relative local insertions (native result preserved)', () => {
    const decision = decideInsertionAction({
      settings: settings({ enabled: true, autoUpload: true, uploadService: 'github' }),
      reference: { rawDestination: 'assets/a.png', rawToken: '![a](assets/a.png)' },
    })
    expect(decision.action).toBe('NONE')
  })

  it('classifies destinations', () => {
    expect(isRemoteImageDestination(REMOTE)).toBe(true)
    expect(isRemoteImageDestination('assets/a.png')).toBe(false)
    expect(isAbsoluteLocalDestination(LOCAL_ABS)).toBe(true)
    expect(isAbsoluteLocalDestination('assets/a.png')).toBe(false)
    expect(isAbsoluteLocalDestination('\\\\server\\share\\a.png')).toBe(true)
  })

  it('plans only actionable insertions', () => {
    const actions = planInsertionActions({
      settings: settings({ enabled: true, autoLocalizeOnInsert: true, referenceMode: 'local-relative' }),
      previousMarkdown: '',
      nextMarkdown: `![](${REMOTE})\n\n![rel](assets/b.png)\n`,
    })
    expect(actions).toHaveLength(1)
    expect(actions[0].action).toBe('LOCALIZE')
    expect(actions[0].rawDestination).toBe(REMOTE)
  })
})
