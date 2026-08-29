import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectFileStorageEngine } from '../../src/lib/lan-transfer/storage/direct-file-storage'

const meta = { id: 'f', name: 'f.bin', mime: 'application/octet-stream', size: 6, lastModified: 1, chunkSize: 2, chunkCount: 3, storage: 'file' } as any

function setupPicker() {
  const writes: any[] = []
  const writable = { write: vi.fn(async (value: any) => { writes.push(value) }), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) }
  const handle = { createWritable: vi.fn(async () => writable) }
  const showSaveFilePicker = vi.fn(async () => handle)
  vi.stubGlobal('window', { showSaveFilePicker })
  return { writes, writable, handle, showSaveFilePicker }
}

beforeEach(() => setupPicker())
afterEach(() => vi.unstubAllGlobals())

describe('DirectFileStorageEngine', () => {
  it('prepares a user-selected file and starts with an empty manifest', async () => {
    const engine = new DirectFileStorageEngine()
    await engine.prepare(meta)
    expect((window as any).showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'f.bin' })
    expect(await engine.getManifest('f')).toMatchObject({ receivedBytes: 0, receivedChunks: 0, status: 'pending' })
  })

  it('buffers contiguous chunks and flushes them in order on the final chunk', async () => {
    const { writes } = setupPicker(); const engine = new DirectFileStorageEngine(); await engine.prepare(meta)
    await engine.writeChunk(meta, 0, new Uint8Array([1, 2]))
    await engine.writeChunk(meta, 1, new Uint8Array([3, 4]))
    expect(writes).toHaveLength(0)
    const manifest = await engine.writeChunk(meta, 2, new Uint8Array([5, 6]))
    expect(writes).toHaveLength(1)
    expect(Array.from(writes[0] as Uint8Array)).toEqual([1, 2, 3, 4, 5, 6])
    expect(manifest).toMatchObject({ receivedBytes: 6, receivedChunks: 3, status: 'complete', receivedRanges: [[0, 2]] })
  })

  it('uses positional writes when chunks arrive out of order and ignores duplicates', async () => {
    const { writes } = setupPicker(); const engine = new DirectFileStorageEngine(); await engine.prepare(meta)
    await engine.writeChunk(meta, 1, new Uint8Array([3, 4]))
    await engine.writeChunk(meta, 0, new Uint8Array([1, 2]))
    await engine.checkpoint(meta)
    const before = (await engine.getManifest('f'))!.receivedBytes
    await engine.writeChunk(meta, 1, new Uint8Array([9, 9]))
    expect((await engine.getManifest('f'))!.receivedBytes).toBe(before)
    expect(writes.some(value => value && typeof value === 'object' && value.type === 'write' && value.position === 2)).toBe(true)
  })

  it('finalize closes the stream while cleanup aborts an unfinished stream', async () => {
    const { writable } = setupPicker(); const engine = new DirectFileStorageEngine(); await engine.prepare(meta)
    await engine.writeChunk(meta, 0, new Uint8Array([1, 2])); await engine.finalize(meta)
    expect(writable.close).toHaveBeenCalledTimes(1)
    await expect(engine.finalize(meta)).rejects.toThrow(/文件保存失败/)

    const second = setupPicker(); const engine2 = new DirectFileStorageEngine(); await engine2.prepare({ ...meta, id: 'g' })
    await engine2.cleanup('g')
    expect(second.writable.abort).toHaveBeenCalledTimes(1)
  })
})
