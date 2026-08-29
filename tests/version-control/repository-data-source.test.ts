import { describe, expect, it, vi } from 'vitest'
import { LocalAgentRepositoryDataSource } from '../../src/lib/version-control/repository-data-source'

function bridge(overrides: Record<string, unknown> = {}) {
  return {
    connectHistory: vi.fn(), closeRepository: vi.fn(), refresh: vi.fn(), getBranches: vi.fn(), getHistory: vi.fn(), getDirectory: vi.fn(),
    openRepositoryFile: vi.fn(), openRepositoryImage: vi.fn(), openDiff: vi.fn(), getDiffFiles: vi.fn(), openPreview: vi.fn(),
    prepareExport: vi.fn(), confirmExport: vi.fn(), cancelExport: vi.fn(), ...overrides
  } as never
}

describe('LocalAgentRepositoryDataSource', () => {
  it('rejects malformed pagination cursors before calling the bridge', async () => {
    const b = bridge()
    const source = new LocalAgentRepositoryDataSource(b, 'repo')
    await expect(source.getHistory(null, '-1')).rejects.toThrow(/游标/)
    await expect(source.getHistory(null, '1.5')).rejects.toThrow(/游标/)
    await expect(source.getDirectory('', 'NaN')).rejects.toThrow(/游标/)
    expect((b as any).getHistory).not.toHaveBeenCalled()
  })

  it('maps bridge hasMore/nextSkip into string cursors', async () => {
    const b = bridge({ getHistory: vi.fn().mockResolvedValue({ items: [{ hash: 'a' }], hasMore: true, nextSkip: 30 }) })
    const source = new LocalAgentRepositoryDataSource(b, 'repo')
    const page = await source.getHistory('query', '10', 20, ['refs/heads/main'])
    expect(page.nextCursor).toBe('30')
    expect((b as any).getHistory).toHaveBeenCalledWith('repo', 'query', 10, 20, ['refs/heads/main'])
  })

  it('detects a non-advancing branch cursor instead of looping forever', async () => {
    const b = bridge({ getBranches: vi.fn().mockResolvedValue({ items: [], hasMore: true, nextSkip: 0 }) })
    const source = new LocalAgentRepositoryDataSource(b, 'repo')
    await expect(source.getBranches()).rejects.toThrow(/分支分页游标无效/)
  })

  it('computes UTF-8 byte size for repository text', async () => {
    const b = bridge({ openRepositoryFile: vi.fn().mockResolvedValue('中文A') })
    const source = new LocalAgentRepositoryDataSource(b, 'repo')
    const result = await source.openRepositoryFile('README.md')
    expect(result).toEqual({ path: 'README.md', content: '中文A', size: new TextEncoder().encode('中文A').byteLength })
  })
})
