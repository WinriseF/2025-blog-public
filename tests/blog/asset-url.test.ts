import { describe, expect, it, vi } from 'vitest'

describe('asset URL normalization', () => {
  it('keeps absolute URLs and expands root-relative asset paths', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_ASSET_ORIGIN', 'https://assets.example.test/')
    const { getAssetUrl, ASSET_ORIGIN } = await import('../../src/lib/asset-url')
    expect(ASSET_ORIGIN).toBe('https://assets.example.test')
    expect(getAssetUrl('/a/b.png')).toBe('https://assets.example.test/a/b.png')
    expect(getAssetUrl('https://other.test/x.png')).toBe('https://other.test/x.png')
    expect(getAssetUrl('   ')).toBe('')
  })
})
