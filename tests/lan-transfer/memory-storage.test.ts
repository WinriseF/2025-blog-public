import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStorageEngine } from '../../src/lib/lan-transfer/storage/memory-storage'

function meta() {
  return { id: 'file-1', name: 'x.bin', mime: 'application/octet-stream', size: 5, chunkSize: 2, chunkCount: 3, storage: 'memory' } as never
}

afterEach(() => vi.unstubAllGlobals())

describe('MemoryStorageEngine', () => {
  it('does not double-count duplicate chunks', async () => {
    const engine = new MemoryStorageEngine()
    const m = meta()
    await engine.prepare(m)
    await engine.writeChunk(m, 0, new Uint8Array([1, 2]))
    const duplicate = await engine.writeChunk(m, 0, new Uint8Array([9, 9]))
    expect(duplicate.receivedBytes).toBe(2)
    expect(duplicate.receivedChunks).toBe(1)
    expect(duplicate.receivedRanges).toEqual([[0, 0]])
  })

  it('tracks sparse chunks and marks complete only at chunkCount', async () => {
    const engine = new MemoryStorageEngine(); const m = meta(); await engine.prepare(m)
    await engine.writeChunk(m, 2, new Uint8Array([5]))
    const mid = await engine.writeChunk(m, 0, new Uint8Array([1, 2]))
    expect(mid.status).toBe('receiving')
    expect(mid.receivedRanges).toEqual([[0, 0], [2, 2]])
    const done = await engine.writeChunk(m, 1, new Uint8Array([3, 4]))
    expect(done.status).toBe('complete')
    expect(done.receivedBytes).toBe(5)
  })

  it('finalizes chunks in index order and cleanup drops the manifest', async () => {
    const createObjectURL = vi.fn(() => 'blob:test')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const engine = new MemoryStorageEngine(); const m = meta(); await engine.prepare(m)
    await engine.writeChunk(m, 1, new Uint8Array([3, 4])); await engine.writeChunk(m, 0, new Uint8Array([1, 2])); await engine.writeChunk(m, 2, new Uint8Array([5]))
    const finalized = await engine.finalize(m)
    expect(finalized.url).toBe('blob:test')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    await engine.cleanup('file-1')
    expect(await engine.getManifest('file-1')).toBeNull()
  })
})
