import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

describe('blog loader', () => {
  it('loads config and markdown and caches the result', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/config.json')) {
        return new Response(JSON.stringify({ title: 'Title', tags: ['x'], date: '2026-08-28', summary: 'Summary' }), { status: 200 })
      }
      return new Response('# hello', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { loadBlog } = await import('../../src/lib/load-blog')
    const first = await loadBlog('demo')
    const second = await loadBlog('demo')

    expect(first.markdown).toBe('# hello')
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not fetch markdown if the config does not exist', async () => {
    const fetchMock = vi.fn(async () => new Response('missing', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const { loadBlog } = await import('../../src/lib/load-blog')
    await expect(loadBlog('missing')).rejects.toThrow(/config/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty slug before issuing a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { loadBlog } = await import('../../src/lib/load-blog')
    await expect(loadBlog('')).rejects.toThrow('Slug is required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('encodes slugs and retries both resources after a markdown failure', async () => {
    let markdownAttempts = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/config.json')) return new Response(JSON.stringify({ title: 'Title', tags: [], date: '2026-08-28', summary: 'Summary' }))
      markdownAttempts += 1
      return markdownAttempts === 1 ? new Response('missing', { status: 404 }) : new Response('# recovered')
    })
    vi.stubGlobal('fetch', fetchMock)

    const { loadBlog } = await import('../../src/lib/load-blog')
    await expect(loadBlog('space / 中文')).rejects.toThrow('Blog not found')
    await expect(loadBlog('space / 中文')).resolves.toMatchObject({ markdown: '# recovered' })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[0][0]).toBe('/blogs/space%20%2F%20%E4%B8%AD%E6%96%87/config.json')
  })

})
