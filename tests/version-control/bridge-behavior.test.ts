import { describe, expect, it, vi } from 'vitest'
import { VersionControlBridge } from '../../src/lib/version-control/bridge'

describe('VersionControlBridge behavior', () => {
  it('compacts sparse file selections as includes and dense selections as excludes', async () => {
    const bridge = new VersionControlBridge() as any
    bridge.request = vi.fn(async (_type: string, fields: any) => fields)
    const sparse = await bridge.prepareExport('r', 'd', 'json', 'unified', [1, 2, 3, 9], 20)
    expect(sparse.fileSelection).toEqual({ mode: 'include', ranges: [[1, 3], [9, 9]] })
    const dense = await bridge.prepareExport('r', 'd', 'json', 'unified', [0, 1, 2, 3, 4, 6, 7, 8, 9], 10)
    expect(dense.fileSelection).toEqual({ mode: 'exclude', ranges: [[5, 5]] })
  })

  it('deduplicates and merges adjacent ids while compacting selection', async () => {
    const bridge = new VersionControlBridge() as any
    bridge.request = vi.fn(async (_type: string, fields: any) => fields)
    const result = await bridge.prepareExport('r', 'd', 'txt', 'split', [3, 2, 2, 1], 100)
    expect(result.fileSelection).toEqual({ mode: 'include', ranges: [[1, 3]] })
  })

  it('wraps request ids back to 1 instead of exposing zero', () => {
    const bridge = new VersionControlBridge() as any
    bridge.requestId = 0xffffffff
    expect(bridge.nextRequestId()).toBe(1)
  })

  it('rejects oversized control frames before writing to the transport', async () => {
    const bridge = new VersionControlBridge() as any
    bridge.writer = { write: vi.fn(async () => {}) }
    await expect(bridge.writeFrame({ payload: 'x'.repeat(70 * 1024) })).rejects.toThrow(/命令过大/)
    expect(bridge.writer.write).not.toHaveBeenCalled()
  })

  it('close rejects pending requests and preview streams exactly once', () => {
    const bridge = new VersionControlBridge() as any
    const pending = { reject: vi.fn(), resolve: vi.fn() }
    const stream = { reject: vi.fn(), resolve: vi.fn(), kind: 'text' }
    bridge.pending.set(1, pending); bridge.streams.set(1, stream)
    bridge.transport = { close: vi.fn() }
    bridge.close(); bridge.close()
    expect(pending.reject).toHaveBeenCalledTimes(1)
    expect(stream.reject).toHaveBeenCalledTimes(1)
    expect(bridge.transport.close).toHaveBeenCalledTimes(1)
  })
})
