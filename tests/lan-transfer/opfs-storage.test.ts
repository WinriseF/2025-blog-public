import { afterEach, describe, expect, it, vi } from 'vitest'
import { LAN_OPFS_DIRECTORY_NAME, OpfsStorageEngine } from '../../src/lib/lan-transfer/storage/opfs-storage'

class FakeFileHandle {
  bytes = new Uint8Array()
  async getFile() { return new File([this.bytes], 'fake.bin') }
  async createWritable(options?: { keepExistingData?: boolean }) {
    if (!options?.keepExistingData) this.bytes = new Uint8Array()
    return {
      write: async (value: any) => {
        if (typeof value === 'string') { this.bytes = new TextEncoder().encode(value); return }
        if (value instanceof Uint8Array) { this.bytes = value.slice(); return }
        if (value?.type === 'write') {
          const data = value.data instanceof Uint8Array ? value.data : new Uint8Array(value.data)
          const needed = value.position + data.byteLength
          if (this.bytes.byteLength < needed) { const grown = new Uint8Array(needed); grown.set(this.bytes); this.bytes = grown }
          this.bytes.set(data, value.position)
        }
      },
      close: async () => {}, abort: async () => {}
    }
  }
}

class FakeDirectory {
  dirs = new Map<string, FakeDirectory>()
  files = new Map<string, FakeFileHandle>()
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let dir = this.dirs.get(name)
    if (!dir && options?.create) { dir = new FakeDirectory(); this.dirs.set(name, dir) }
    if (!dir) throw new DOMException('missing', 'NotFoundError')
    return dir as any
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    let file = this.files.get(name)
    if (!file && options?.create) { file = new FakeFileHandle(); this.files.set(name, file) }
    if (!file) throw new DOMException('missing', 'NotFoundError')
    return file as any
  }
  async removeEntry(name: string) { this.dirs.delete(name); this.files.delete(name) }
}

const meta = { id: 'f', name: 'f.bin', mime: 'application/octet-stream', size: 6, lastModified: 1, chunkSize: 2, chunkCount: 3, storage: 'opfs' } as any

function setup() {
  const root = new FakeDirectory()
  vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn(async () => root) } })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:opfs')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return root
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('OpfsStorageEngine', () => {
  it('creates its isolated root directory and persists an initial manifest', async () => {
    const root = setup(); const engine = new OpfsStorageEngine(); await engine.prepare(meta)
    expect(root.dirs.has(LAN_OPFS_DIRECTORY_NAME)).toBe(true)
    expect(await engine.getManifest('f')).toMatchObject({ id: 'f', status: 'pending', receivedBytes: 0 })
  })

  it('supports out-of-order chunk writes and finalizes exact file bytes', async () => {
    setup(); const engine = new OpfsStorageEngine(); await engine.prepare(meta)
    await engine.writeChunk(meta, 1, new Uint8Array([3, 4]))
    await engine.writeChunk(meta, 0, new Uint8Array([1, 2]))
    const manifest = await engine.writeChunk(meta, 2, new Uint8Array([5, 6]))
    expect(manifest).toMatchObject({ receivedBytes: 6, receivedChunks: 3, status: 'complete' })
    expect(manifest.receivedRanges).toEqual([[0, 2]])
    await expect(engine.finalize(meta)).resolves.toMatchObject({ url: 'blob:opfs' })
  })

  it('does not double-count a duplicate chunk', async () => {
    setup(); const engine = new OpfsStorageEngine(); await engine.prepare(meta)
    await engine.writeChunk(meta, 0, new Uint8Array([1, 2])); await engine.checkpoint(meta)
    const before = await engine.getManifest('f')
    const after = await engine.writeChunk(meta, 0, new Uint8Array([9, 9]))
    expect(after.receivedBytes).toBe(before!.receivedBytes)
    expect(after.receivedChunks).toBe(before!.receivedChunks)
  })

  it('reopens a compatible manifest without deleting received ranges', async () => {
    setup(); const first = new OpfsStorageEngine(); await first.prepare(meta)
    await first.writeChunk(meta, 0, new Uint8Array([1, 2])); await first.checkpoint(meta)
    const restored = new OpfsStorageEngine(); await restored.prepare(meta)
    expect(await restored.getManifest('f')).toMatchObject({ receivedBytes: 2, receivedChunks: 1, receivedRanges: [[0, 0]] })
  })

  it('rejects finalize when persisted data length does not match metadata', async () => {
    setup(); const engine = new OpfsStorageEngine(); await engine.prepare({ ...meta, size: 8 })
    await engine.writeChunk({ ...meta, size: 8 }, 2, new Uint8Array([5, 6]))
    await expect(engine.finalize({ ...meta, size: 8 })).rejects.toThrow(/文件保存失败/)
  })

  it('cleanup removes persistent state without throwing when entries are already gone', async () => {
    const root = setup(); const engine = new OpfsStorageEngine(); await engine.prepare(meta)
    await engine.cleanup('f'); await expect(engine.cleanup('f')).resolves.toBeUndefined()
    const top = root.dirs.get(LAN_OPFS_DIRECTORY_NAME)!
    expect(top.dirs.has('f')).toBe(false)
  })
})
