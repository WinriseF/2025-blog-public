import { describe, expect, it, vi } from 'vitest'
import { NativeFileStorageWriter } from '../../src/lib/lan-transfer/native-agent/native-storage-writer'

const meta = { id: 'f', name: 'f.bin', mime: 'application/octet-stream', size: 10, lastModified: 1, chunkSize: 4, chunkCount: 3, storage: 'memory' } as any

function storage() {
  let receivedBytes = 0; let receivedChunks = 0
  const writeChunk = vi.fn(async (_meta: any, _index: number, data: Uint8Array) => {
    receivedBytes += data.byteLength; receivedChunks += 1
    return { ...meta, version: 3, receivedBytes, receivedChunks, receivedRanges: [], status: receivedChunks === meta.chunkCount ? 'complete' : 'receiving', createdAt: 1, updatedAt: 1 }
  })
  return { writeChunk } as any
}

describe('NativeFileStorageWriter', () => {
  it('splits a large contiguous write across logical LAN chunks', async () => {
    const s = storage(); const writer = new NativeFileStorageWriter(s, meta)
    await writer.write(0, new Uint8Array([0,1,2,3,4,5,6,7,8,9]))
    await expect(writer.finish()).resolves.toMatchObject({ receivedBytes: 10, receivedChunks: 3 })
    expect(s.writeChunk.mock.calls.map((call: any[]) => [call[1], call[2].byteLength])).toEqual([[0,4],[1,4],[2,2]])
  })

  it('reassembles a logical chunk from multiple offset writes before handing it to storage', async () => {
    const s = storage(); const writer = new NativeFileStorageWriter(s, meta)
    await writer.write(0, new Uint8Array([1,2]))
    expect(s.writeChunk).not.toHaveBeenCalled()
    await writer.write(2, new Uint8Array([3,4]))
    expect(s.writeChunk).toHaveBeenCalledTimes(1)
    expect(Array.from(s.writeChunk.mock.calls[0][2])).toEqual([1,2,3,4])
  })

  it('serializes overlapping asynchronous write calls through its internal queue', async () => {
    const order: number[] = []
    const s = { writeChunk: vi.fn(async (_m: any, index: number, data: Uint8Array) => { await Promise.resolve(); order.push(index); return { ...meta, version: 3, receivedBytes: data.byteLength * (index + 1), receivedChunks: index + 1, receivedRanges: [], status: 'receiving', createdAt: 1, updatedAt: 1 } }) } as any
    const writer = new NativeFileStorageWriter(s, meta)
    await Promise.all([writer.write(0, new Uint8Array([1,2,3,4])), writer.write(4, new Uint8Array([5,6,7,8]))])
    expect(order).toEqual([0,1])
  })

  it('refuses finish while a partial chunk remains incomplete', async () => {
    const writer = new NativeFileStorageWriter(storage(), meta)
    await writer.write(0, new Uint8Array([1,2]))
    await expect(writer.finish()).rejects.toThrow(/覆盖不完整/)
  })
})
