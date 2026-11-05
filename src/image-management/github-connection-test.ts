/**
 * GitHub 图床连接测试。
 *
 * 只做只读 API 调用：验证 Token、仓库访问、分支、写权限与公开可达性。
 * 默认不创建任何远程文件；写入能力依据仓库 `permissions.push` 判定，
 * 不通过“写一个测试文件”来探测，避免用户不知情的远程变更。
 *
 * Token 只放在 Authorization 头，不进入 URL、查询串、日志或错误信息。
 */

import * as https from 'https'
import { normalizeRemoteDirectory, type ImageRemoteProfile } from './image-settings'

export interface GitHubJsonResponse {
  status: number
  json: unknown
}

export type GitHubJsonRequester = (input: {
  token: string
  path: string
}) => Promise<GitHubJsonResponse>

export type GitHubConnectionCheckId =
  | 'token'
  | 'repository'
  | 'branch'
  | 'write'
  | 'public'
  | 'directory'
  | 'url'

export interface GitHubConnectionCheck {
  id: GitHubConnectionCheckId
  label: string
  ok: boolean | null
  detail: string
}

export interface GitHubConnectionTestResult {
  ok: boolean
  summary: string
  checks: GitHubConnectionCheck[]
  resolvedBranch: string | null
  repoPrivate: boolean | null
}

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 512 * 1024

function readJsonBody(raw: string): unknown {
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/** 默认请求器：Node https，Token 仅用于请求头。 */
export const defaultGitHubRequester: GitHubJsonRequester = ({ token, path }) => {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: 'api.github.com',
        path,
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'InkChapter-Typora-Plugin',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: DEFAULT_TIMEOUT_MS,
      },
      response => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          if (body.length + chunk.length > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('GITHUB_RESPONSE_TOO_LARGE'))
            return
          }
          body += chunk
        })
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, json: readJsonBody(body) })
        })
      },
    )
    request.on('timeout', () => request.destroy(new Error('GITHUB_TIMEOUT')))
    // 网络错误只保留稳定错误码，不把底层 message（可能含 URL）抛给 UI。
    request.on('error', () => reject(new Error('GITHUB_NETWORK_ERROR')))
    request.end()
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function check(
  id: GitHubConnectionCheckId,
  label: string,
  ok: boolean | null,
  detail: string,
): GitHubConnectionCheck {
  return { id, label, ok, detail }
}

function buildRawUrl(profile: ImageRemoteProfile, branch: string, sampleFile: string): string {
  const dir = profile.remoteDirectory ? `${profile.remoteDirectory.replace(/\/+$/, '')}/` : ''
  return `https://raw.githubusercontent.com/${profile.owner}/${profile.repository}/${encodeURIComponent(branch)}/${dir}${sampleFile}`
}

/**
 * 执行连接测试。任何异常都转换为结构化失败，绝不抛出原始错误文本。
 */
export async function testGitHubConnection(options: {
  profile: ImageRemoteProfile
  token: string
  request?: GitHubJsonRequester
}): Promise<GitHubConnectionTestResult> {
  const { profile } = options
  const request = options.request ?? defaultGitHubRequester
  const checks: GitHubConnectionCheck[] = []
  const token = typeof options.token === 'string' ? options.token.trim() : ''

  if (!token) {
    checks.push(check('token', 'Token 有效性', false, '未提供 Token'))
    return {
      ok: false,
      summary: '未找到已保存的 Token，请先保存后重试。',
      checks,
      resolvedBranch: null,
      repoPrivate: null,
    }
  }

  let tokenValid = false
  try {
    const user = await request({ token, path: '/user' })
    if (user.status === 200) {
      tokenValid = true
      checks.push(check('token', 'Token 有效性', true, 'Token 有效'))
    } else if (user.status === 401) {
      checks.push(check('token', 'Token 有效性', false, 'Token 无效或已过期'))
    } else if (user.status === 403) {
      checks.push(check('token', 'Token 有效性', false, 'Token 被拒绝或触发限流'))
    } else {
      checks.push(check('token', 'Token 有效性', false, `GitHub 返回 HTTP ${user.status}`))
    }
  } catch {
    checks.push(check('token', 'Token 有效性', false, '无法连接 GitHub（网络或代理错误）'))
  }

  if (!tokenValid) {
    return {
      ok: false,
      summary: 'Token 校验未通过，未继续检查仓库。',
      checks,
      resolvedBranch: null,
      repoPrivate: null,
    }
  }

  const repoPath = `/repos/${encodeURIComponent(profile.owner)}/${encodeURIComponent(profile.repository)}`
  let repoBody: Record<string, unknown> | null = null
  try {
    const repo = await request({ token, path: repoPath })
    if (repo.status === 200) {
      repoBody = asRecord(repo.json)
      checks.push(check('repository', '仓库访问权限', true, '仓库可访问'))
    } else if (repo.status === 404) {
      checks.push(check('repository', '仓库访问权限', false, '仓库不存在或 Token 无权访问'))
    } else if (repo.status === 401) {
      checks.push(check('repository', '仓库访问权限', false, 'Token 无效或已过期'))
    } else if (repo.status === 403) {
      checks.push(check('repository', '仓库访问权限', false, 'Token 无权访问该仓库'))
    } else {
      checks.push(check('repository', '仓库访问权限', false, `GitHub 返回 HTTP ${repo.status}`))
    }
  } catch {
    checks.push(check('repository', '仓库访问权限', false, '无法连接 GitHub（网络或代理错误）'))
  }

  if (!repoBody) {
    return {
      ok: false,
      summary: '仓库访问检查未通过，未继续检查分支与权限。',
      checks,
      resolvedBranch: null,
      repoPrivate: null,
    }
  }

  const defaultBranch = typeof repoBody.default_branch === 'string' && repoBody.default_branch.trim()
    ? repoBody.default_branch.trim()
    : ''
  const resolvedBranch = profile.branch.trim() || defaultBranch || null
  const repoPrivate = typeof repoBody.private === 'boolean' ? repoBody.private : null

  if (!resolvedBranch) {
    checks.push(check('branch', '目标分支', false, '未填写分支，且仓库未返回默认分支'))
  } else {
    try {
      const branch = await request({
        token,
        path: `${repoPath}/branches/${encodeURIComponent(resolvedBranch)}`,
      })
      if (branch.status === 200) {
        checks.push(check('branch', '目标分支', true, `分支 ${resolvedBranch} 存在`))
      } else if (branch.status === 404) {
        checks.push(check('branch', '目标分支', false, `分支 ${resolvedBranch} 不存在`))
      } else {
        checks.push(check('branch', '目标分支', false, `分支检查返回 HTTP ${branch.status}`))
      }
    } catch {
      checks.push(check('branch', '目标分支', false, '分支检查时无法连接 GitHub'))
    }
  }

  const permissions = asRecord(repoBody.permissions)
  const canPush = permissions?.push
  if (canPush === true) {
    checks.push(check('write', '写入权限', true, 'Token 对该仓库具有 push 权限（未创建测试文件）'))
  } else if (canPush === false) {
    checks.push(check('write', '写入权限', false, 'Token 仅具读取权限，无法上传图片'))
  } else {
    checks.push(check('write', '写入权限', null, '仓库未返回权限信息，无法确认写入能力'))
  }

  if (repoPrivate === false) {
    checks.push(check('public', '图片公开访问', true, '仓库为公开仓库，raw 链接可公开访问'))
  } else if (repoPrivate === true) {
    checks.push(check('public', '图片公开访问', false, '仓库为私有仓库，raw 链接无法公开访问'))
  } else {
    checks.push(check('public', '图片公开访问', null, '仓库可见性未知'))
  }

  const directory = normalizeRemoteDirectory(profile.remoteDirectory)
  if (directory === null) {
    checks.push(check('directory', '上传目录', false, '上传目录包含非法字符或上级跳转'))
  } else if (!directory) {
    checks.push(check('directory', '上传目录', true, '使用仓库根目录'))
  } else if (!resolvedBranch) {
    checks.push(check('directory', '上传目录', null, '缺少分支，无法检查目录'))
  } else {
    try {
      const contents = await request({
        token,
        path: `${repoPath}/contents/${directory}?ref=${encodeURIComponent(resolvedBranch)}`,
      })
      if (contents.status === 404) {
        checks.push(check('directory', '上传目录', true, `目录 ${directory} 尚不存在，将在上传时创建`))
      } else if (contents.status === 200) {
        const type = asRecord(contents.json)?.type
        checks.push(type === 'file'
          ? check('directory', '上传目录', false, `路径 ${directory} 指向文件而不是目录`)
          : check('directory', '上传目录', true, `目录 ${directory} 可用`))
      } else {
        checks.push(check('directory', '上传目录', null, `目录检查返回 HTTP ${contents.status}`))
      }
    } catch {
      checks.push(check('directory', '上传目录', null, '目录检查时无法连接 GitHub'))
    }
  }

  if (profile.urlStrategy === 'custom') {
    const ok = /^https?:\/\/\S+$/i.test(profile.customUrlBase.trim())
    checks.push(check(
      'url',
      'URL 策略',
      ok,
      ok ? '自定义基址格式有效' : '自定义基址必须是有效的 http(s) URL',
    ))
  } else if (resolvedBranch) {
    checks.push(check(
      'url',
      'URL 策略',
      true,
      `示例图片地址：${buildRawUrl(profile, resolvedBranch, 'example.png')}`,
    ))
  } else {
    checks.push(check('url', 'URL 策略', null, '缺少分支，无法生成示例地址'))
  }

  const failed = checks.filter(item => item.ok === false)
  const unknown = checks.filter(item => item.ok === null)
  const ok = failed.length === 0 && unknown.length === 0
  const summary = ok
    ? '连接测试通过：Token、读取、写入、分支与公开访问均正常；未创建任何远程文件。'
    : failed.length > 0
      ? `连接测试未通过：${failed.map(item => item.detail).join('；')}`
      : `连接测试存在未确认项：${unknown.map(item => item.detail).join('；')}`

  return { ok, summary, checks, resolvedBranch, repoPrivate }
}
