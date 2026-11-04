import { describe, expect, it } from 'vitest'
import { testGitHubConnection, type GitHubJsonRequester } from './github-connection-test'
import type { ImageRemoteProfile } from './image-settings'

const PROFILE: ImageRemoteProfile = {
  remoteProfileId: 'github-default',
  provider: 'github',
  owner: 'octocat',
  repository: 'image-bed',
  branch: 'main',
  remoteDirectory: 'images',
  urlStrategy: 'raw',
  customUrlBase: '',
  credentialReferenceId: 'image.github.default',
  enabled: true,
}

const TOKEN = 'ghp_super_secret_token'

function requester(
  routes: Record<string, { status: number; json?: unknown } | Error>,
): GitHubJsonRequester {
  return async ({ path }) => {
    const value = routes[path]
    if (!value) return { status: 404, json: null }
    if (value instanceof Error) throw value
    return { status: value.status, json: value.json ?? null }
  }
}

const repoPath = '/repos/octocat/image-bed'
const branchPath = `${repoPath}/branches/main`

describe('GitHub connection test', () => {
  it('passes when token, repository, branch, write and public access are valid', async () => {
    const result = await testGitHubConnection({
      profile: PROFILE,
      token: TOKEN,
      request: requester({
        '/user': { status: 200, json: { login: 'octocat' } },
        [repoPath]: {
          status: 200,
          json: {
            default_branch: 'main',
            private: false,
            permissions: { push: true },
          },
        },
        [branchPath]: { status: 200, json: { name: 'main' } },
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.resolvedBranch).toBe('main')
    expect(result.repoPrivate).toBe(false)
    expect(result.checks.every(item => item.ok === true)).toBe(true)
    expect(result.summary).toContain('未创建任何远程文件')
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('uses the repository default branch when the profile branch is empty', async () => {
    const result = await testGitHubConnection({
      profile: { ...PROFILE, branch: '' },
      token: TOKEN,
      request: requester({
        '/user': { status: 200, json: {} },
        [repoPath]: {
          status: 200,
          json: { default_branch: 'trunk', private: false, permissions: { push: true } },
        },
        [`${repoPath}/branches/trunk`]: { status: 200, json: {} },
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.resolvedBranch).toBe('trunk')
  })

  it('fails early on an invalid token without leaking it', async () => {
    const result = await testGitHubConnection({
      profile: PROFILE,
      token: TOKEN,
      request: requester({ '/user': { status: 401 } }),
    })

    expect(result.ok).toBe(false)
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0]).toEqual(expect.objectContaining({ id: 'token', ok: false }))
    expect(result.summary).not.toContain(TOKEN)
  })

  it('reports an inaccessible repository', async () => {
    const result = await testGitHubConnection({
      profile: PROFILE,
      token: TOKEN,
      request: requester({
        '/user': { status: 200, json: {} },
        [repoPath]: { status: 404 },
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.checks.find(item => item.id === 'repository')?.ok).toBe(false)
  })

  it('fails when the branch does not exist', async () => {
    const result = await testGitHubConnection({
      profile: PROFILE,
      token: TOKEN,
      request: requester({
        '/user': { status: 200, json: {} },
        [repoPath]: { status: 200, json: { default_branch: 'main', private: false, permissions: { push: true } } },
        [branchPath]: { status: 404 },
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.checks.find(item => item.id === 'branch')?.ok).toBe(false)
  })

  it('distinguishes read-only tokens from writable ones', async () => {
    const result = await testGitHubConnection({
      profile: PROFILE,
      token: TOKEN,
      request: requester({
        '/user': { status: 200, json: {} },
        [repoPath]: { status: 200, json: { default_branch: 'main', private: false, permissions: { push: false } } },
        [branchPath]: { status: 200, json: {} },
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.checks.find(item => item.id === 'write')).toEqual(expect.objectContaining({
      ok: false,
      detail: 'Token 仅具读取权限，无法上传图片',
    }))
  })

  it('fails public access for a private repository', async () => {
    const result = await testGitHubConnection({
      profile: PROFILE,
      token: TOKEN,
      request: requester({
        '/user': { status: 200, json: {} },
        [repoPath]: { status: 200, json: { default_branch: 'main', private: true, permissions: { push: true } } },
        [branchPath]: { status: 200, json: {} },
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.checks.find(item => item.id === 'public')?.ok).toBe(false)
  })

  it('reports network failures without raw error text', async () => {
    const result = await testGitHubConnection({
      profile: PROFILE,
      token: TOKEN,
      request: requester({ '/user': new Error('socket hang up') }),
    })

    expect(result.ok).toBe(false)
    expect(result.summary).toBe('Token 校验未通过，未继续检查仓库。')
    expect(JSON.stringify(result)).not.toContain('socket hang up')
  })

  it('rejects an invalid upload directory and custom base URL', async () => {
    const result = await testGitHubConnection({
      profile: { ...PROFILE, remoteDirectory: '../escape', urlStrategy: 'custom', customUrlBase: 'not-a-url' },
      token: TOKEN,
      request: requester({
        '/user': { status: 200, json: {} },
        [repoPath]: { status: 200, json: { default_branch: 'main', private: false, permissions: { push: true } } },
        [branchPath]: { status: 200, json: {} },
      }),
    })

    expect(result.checks.find(item => item.id === 'directory')?.ok).toBe(false)
    expect(result.checks.find(item => item.id === 'url')?.ok).toBe(false)
    expect(result.ok).toBe(false)
  })
})
