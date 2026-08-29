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

})
