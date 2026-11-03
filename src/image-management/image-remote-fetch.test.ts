import { describe, it, expect } from 'vitest'
import { fetchRemoteImage, type FetchLike } from './image-remote-fetch'

function responseLike(input: {
  url?: string
  status?: number
  contentType?: string
  contentLength?: string
  bytes?: Uint8Array
}): Response {
  return {
    ok: (input.status ?? 200) >= 200 && (input.status ?? 200) < 300,
    status: input.status ?? 200,
    url: input.url ?? '',
    headers: new Headers({
      ...(input.contentType ? { 'content-type': input.contentType } : {}),
      ...(input.contentLength ? { 'content-length': input.contentLength } : {}),
    }),
    arrayBuffer: async () => (input.bytes ?? new Uint8Array([1, 2, 3])).buffer,
  } as unknown as Response
}

describe('fetchRemoteImage', () => {
  it('returns a hash, bytes and extension for a real image response', async () => {
    const fetchImpl: FetchLike = async () => responseLike({
      url: 'https://cdn.example.test/a.png',
      contentType: 'image/png',
      bytes: new Uint8Array([9, 8, 7]),
    })
    const result = await fetchRemoteImage(fetchImpl, 'https://example.test/a.png', 1024)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bytes.byteLength).toBe(3)
      expect(result.extension).toBe('png')
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('rejects HTTP failures, oversized bodies and non-image content', async () => {
    const notFound: FetchLike = async () => responseLike({ status: 404 })
    expect((await fetchRemoteImage(notFound, 'https://example.test/a.png', 1024)).ok).toBe(false)

    const tooLarge: FetchLike = async () => responseLike({ contentType: 'image/png', contentLength: '2048' })
    const large = await fetchRemoteImage(tooLarge, 'https://example.test/a.png', 1024)
    expect(large.ok).toBe(false)
    if (!large.ok) expect(large.code).toBe('TOO_LARGE')

    const html: FetchLike = async () => responseLike({ contentType: 'text/html' })
    const notImage = await fetchRemoteImage(html, 'https://example.test/a.png', 1024)
    expect(notImage.ok).toBe(false)
    if (!notImage.ok) expect(notImage.code).toBe('NOT_IMAGE')
  })

  it('rejects a redirect that resolves to a blocked host', async () => {
    const redirect: FetchLike = async () => responseLike({
      url: 'http://127.0.0.1/a.png',
      contentType: 'image/png',
    })
    const result = await fetchRemoteImage(redirect, 'https://example.test/a.png', 1024)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('INVALID_URL')
      expect(result.message).toContain('REDIRECT')
    }
  })
})
