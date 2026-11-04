/**
 * 图片设置页凭据 UI 契约：用户只看到 Token 输入与状态，不再需要理解内部引用 ID。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const source = readFileSync(
  resolve(process.cwd(), 'src/settings/image-management-setting-tab.ts'),
  'utf8',
)

describe('IMAGE-SETTINGS-CREDENTIAL-UI contract', () => {
  it('removes the user-facing credential reference field', () => {
    expect(source).not.toContain("addName('凭据引用 ID')")
    expect(source).not.toContain('Token 不在此页面输入')
    expect(source).not.toContain('placeholder = \'image.github.default\'')
  })

  it('offers a password token input with show/hide and lifecycle actions', () => {
    expect(source).toContain("addName('GitHub Token')")
    expect(source).toContain("addInput('password'")
    expect(source).toContain("button.textContent = '显示'")
    expect(source).toContain("button.textContent = '保存 Token'")
    expect(source).toContain("button.textContent = '删除 Token'")
    expect(source).toContain("button.textContent = '测试连接'")
    expect(source).toContain('input.value = \'\'')
  })

  it('never writes the token into settings and derives the reference id internally', () => {
    expect(source).toContain('resolveCredentialReferenceId')
    expect(source).not.toContain('token: token')
    expect(source).not.toContain('credentialReferenceId: values')
    expect(source).toContain('refreshCredentialStatus')
  })

  it('keeps clearing remote config from deleting shared credentials', () => {
    expect(source).toContain('本机安全存储中的 Token 仍保留')
    expect(source).toContain("如需删除请使用「删除 Token」")
  })
})
