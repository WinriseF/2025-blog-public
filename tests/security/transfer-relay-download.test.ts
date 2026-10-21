import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRelayTransfer, openRelayTransfer } from '../../src/lib/transfer-relay'
import { decryptTransferChunk, encryptTransferChunk } from '../../src/lib/transfer-crypto'
import { createRelayDownloadStorage } from '../../src/lib/transfer-download-storage'
import { TRANSFER_LIMITS, type TransferPublicMeta } from '../../src/lib/transfer-types'

vi.mock('../../src/lib/transfer-download-storage', () => ({ createRelayDownloadStorage: vi.fn() }))
vi.mock('../../src/lib/transfer-crypto', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/lib/transfer-crypto')>(),
  createTransferEncryptionContext: vi.fn(async () => ({ key: {} as CryptoKey, salt: 'salt', proof: 'proof' })),
  deriveTransferProof: vi.fn(async () => ({ key: {} as CryptoKey, proof: 'proof' })),
  decryptTransferChunk: vi.fn(),
  encryptTransferChunk: vi.fn(async (plain: Uint8Array, _key: CryptoKey, iv: string) => ({ cipher: plain.slice(), iv }))
}))

// Exercise a full 800 MiB manifest while mocked crypto keeps the test data small.
const chunks = Array.from({ length: TRANSFER_LIMITS.maxFileBytes / TRANSFER_LIMITS.publicRelayChunkBytes }, (_, index) => ({
  index, iv: `chunk-${index}`, plainSize: TRANSFER_LIMITS.publicRelayChunkBytes, cipherSize: TRANSFER_LIMITS.publicRelayChunkBytes + 16
}))
const meta: TransferPublicMeta = {
  code: 'ABC234', kind: 'file', name: 'large.png', contentType: 'image/png',
  size: TRANSFER_LIMITS.maxFileBytes, salt: 'salt', status: 'ready', expireAt: Date.now() + 3600000,
  createdAt: Date.now(), chunked: true, chunkSize: TRANSFER_LIMITS.publicRelayChunkBytes,
  chunkCount: chunks.length, chunks
}
const options = { code: meta.code, password: 'password', metaUrl: '/meta', openUrl: '/open', receivedUrl: '/received' }
const receipt = { id: 'example-transfer-id', token: 'example-receipt-token' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

function setup(manifest = meta) {
  const events: string[] = []
  const storage = {
    write: vi.fn(async (_bytes: Uint8Array) => {}),
    finish: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])])),
    dispose: vi.fn(async () => {})
  }
  vi.mocked(createRelayDownloadStorage).mockImplementation(async () => { events.push('storage'); return storage })
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === '/meta') return Response.json(manifest)
    events.push(url)
    if (url === '/open') return Response.json({ ...manifest, receipt, chunks: manifest.chunks.map(chunk => ({ ...chunk, url: `/chunk/${chunk.index}` })) })
    if (url === '/received') {
      const { startIndex } = JSON.parse(String(_init?.body))
      return Response.json({ nextIndex: startIndex + 20 >= manifest.chunkCount ? null : startIndex + 20 })
    }
    return new Response(new Uint8Array([Number(url.split('/').pop())]))
  })
  vi.stubGlobal('fetch', fetcher)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:relay-test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { events, storage, fetcher }
}

beforeEach(() => {
  vi.mocked(createRelayDownloadStorage).mockReset()
  vi.mocked(decryptTransferChunk).mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]))
})
afterEach(() => vi.useRealTimers())

describe('public relay large-file receive lifecycle', () => {
  it('accepts an 800 MiB file and creates a 200-chunk manifest without reading the entire file', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => { throw new Error('creation reached') })
    vi.stubGlobal('fetch', fetcher)
    const file = { name: 'large.bin', type: 'application/octet-stream', size: 800 * 1024 * 1024, slice: vi.fn() } as unknown as File
    await expect(createRelayTransfer({ kind: 'file', text: '', file, password: 'password', createUrl: '/create', completeUrl: '/complete' })).rejects.toThrow('creation reached')
    const manifest = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(manifest).toMatchObject({ size: 800 * 1024 * 1024, chunkCount: 200, chunkSize: 4 * 1024 * 1024 })
    expect(file.slice).not.toHaveBeenCalled()
  })

  it('rejects a file one byte above 800 MiB before making an API request', async () => {
    const { fetcher } = setup()
    const file = { name: 'too-large.bin', size: 800 * 1024 * 1024 + 1 } as File
    await expect(createRelayTransfer({ kind: 'file', text: '', file, password: 'password', createUrl: '/create', completeUrl: '/complete' })).rejects.toThrow('800MB')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves the one-time code if local storage cannot be prepared', async () => {
    const { fetcher } = setup()
    vi.mocked(createRelayDownloadStorage).mockRejectedValueOnce(new Error('no disk space'))
    await expect(openRelayTransfer(options)).rejects.toThrow('no disk space')
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/meta'])
  })

  it('prepares disk before opening and releases disk plus the URL when the result is disposed', async () => {
    const { events, storage } = setup()
    const result = await openRelayTransfer(options)
    expect(createRelayDownloadStorage).toHaveBeenCalledWith(800 * 1024 * 1024)
    expect(events).toEqual(['storage', '/open', ...chunks.map(chunk => `/chunk/${chunk.index}`), ...Array(10).fill('/received')])
    expect(storage.write).toHaveBeenCalledTimes(200)
    expect(storage.write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
    expect(storage.finish).toHaveBeenCalledWith('image/png')
    expect(storage.dispose).not.toHaveBeenCalled()
    await result.file?.dispose()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:relay-test')
    expect(storage.dispose).toHaveBeenCalledOnce()
  })

  it('removes a partial file when writing a decrypted chunk fails', async () => {
    const { storage, fetcher } = setup()
    storage.write.mockRejectedValueOnce(new Error('disk full'))
    await expect(openRelayTransfer(options)).rejects.toThrow('disk full')
    expect(storage.dispose).toHaveBeenCalledOnce()
    expect(storage.finish).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(fetcher.mock.calls.some(([url]) => url === '/received')).toBe(false)
  })

  it('acknowledges only after the full local file is ready and clears all 200 chunks in separate pages', async () => {
    const { events, storage, fetcher } = setup()
    storage.finish.mockImplementation(async () => { events.push('file-ready'); return new Blob([new Uint8Array([1])]) })
    const result = await openRelayTransfer(options)
    expect(events.indexOf('/received')).toBeGreaterThan(events.indexOf('file-ready'))
    const requests = fetcher.mock.calls.filter(([url]) => url === '/received').map(([, init]) => JSON.parse(String(init?.body)))
    expect(requests).toEqual(Array.from({ length: 10 }, (_, index) => ({ ...receipt, startIndex: index * 20 })))
    await result.file?.dispose()
  })

  it('keeps the received file usable and reports deferred cleanup if acknowledgement fails', async () => {
    const { storage, fetcher } = setup()
    const originalFetch = fetcher.getMockImplementation()!
    fetcher.mockImplementation((url, init) => url === '/received' ? Promise.resolve(new Response(null, { status: 401 })) : originalFetch(url, init))
    const onStatus = vi.fn()
    const result = await openRelayTransfer({ ...options, onStatus })
    expect(result.file?.url).toBe('blob:relay-test')
    expect(storage.dispose).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(onStatus).toHaveBeenLastCalledWith('接收成功，中转数据清理未完成，将由定时任务清理')
    await result.file?.dispose()
  })

  it('cleans text transfers after decoding the received content', async () => {
    const plain = new TextEncoder().encode('hello')
    const manifest = { ...meta, kind: 'text' as const, size: plain.length, chunkCount: 1, chunks: [{ ...chunks[0], plainSize: plain.length, cipherSize: plain.length + 16 }] }
    const { fetcher } = setup(manifest)
    vi.mocked(decryptTransferChunk).mockResolvedValue(plain)
    expect(await openRelayTransfer(options)).toEqual({ text: 'hello' })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/meta', '/open', '/chunk/0', '/received'])
    expect(createRelayDownloadStorage).not.toHaveBeenCalled()
  })

  it('releases the local result and stops further pages when cancelled during receipt cleanup', async () => {
    const { storage, fetcher } = setup()
    const pending = deferred<Response>()
    const originalFetch = fetcher.getMockImplementation()!
    fetcher.mockImplementation((url, init) => url === '/received' ? pending.promise : originalFetch(url, init))
    const controller = new AbortController()
    const run = expect(openRelayTransfer({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === '/received')).toBe(true))
    controller.abort()
    pending.resolve(Response.json({ nextIndex: 20 }))
    await run
    expect(fetcher.mock.calls.filter(([url]) => url === '/received')).toHaveLength(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:relay-test')
    expect(storage.dispose).toHaveBeenCalledOnce()
  })

  it('cleans a prepared file without consuming the code if the receive is cancelled', async () => {
    const { storage, fetcher } = setup()
    const controller = new AbortController()
    vi.mocked(createRelayDownloadStorage).mockImplementationOnce(async () => { controller.abort(); return storage })
    await expect(openRelayTransfer({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/meta'])
    expect(storage.dispose).toHaveBeenCalledOnce()
  })

  it.each(['memory', 'disk'])('preserves file order with out-of-order downloads in %s storage', async mode => {
    const manifest = mode === 'disk' ? meta : { ...meta, size: 7 * TRANSFER_LIMITS.publicRelayChunkBytes, chunkCount: 7, chunks: chunks.slice(0, 7) }
    const { fetcher, storage } = setup(manifest)
    const first = deferred<Response>()
    const originalFetch = fetcher.getMockImplementation()!
    fetcher.mockImplementation((url, init) => url === '/chunk/0' ? first.promise : originalFetch(url, init))
    vi.mocked(decryptTransferChunk).mockImplementation(async cipher => new Uint8Array(cipher))
    let output: Blob | undefined
    vi.mocked(URL.createObjectURL).mockImplementation(blob => { output = blob as Blob; return 'blob:relay-test' })
    const run = openRelayTransfer(options)
    await vi.waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.startsWith('/chunk/'))).toHaveLength(4))
    expect(storage.write).not.toHaveBeenCalled()
    first.resolve(new Response(new Uint8Array([0])))
    const result = await run
    const expected = manifest.chunks.map(chunk => chunk.index)
    if (mode === 'disk') expect(storage.write.mock.calls.map(([bytes]) => bytes[0])).toEqual(expected)
    else {
      expect(createRelayDownloadStorage).not.toHaveBeenCalled()
      expect([...new Uint8Array(await output!.arrayBuffer())]).toEqual(expected)
    }
    expect(fetcher.mock.calls.filter(([url]) => url === '/open')).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([url]) => url.startsWith('/chunk/'))).toHaveLength(manifest.chunkCount)
    await result.file?.dispose()
  })

  it('drains non-cancellable crypto before disposing a cancelled download and never writes afterwards', async () => {
    const { storage } = setup()
    const enteredCrypto = deferred<void>()
    const cryptoResult = deferred<Awaited<ReturnType<typeof decryptTransferChunk>>>()
    vi.mocked(decryptTransferChunk).mockImplementation(async (_cipher, _key, iv) => {
      if (iv !== 'chunk-0') return new Uint8Array([1])
      enteredCrypto.resolve()
      return cryptoResult.promise
    })
    const controller = new AbortController()
    const result = expect(openRelayTransfer({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await enteredCrypto.promise
    controller.abort()
    expect(storage.dispose).not.toHaveBeenCalled()
    cryptoResult.resolve(new Uint8Array([0]))
    await result
    expect(storage.dispose).toHaveBeenCalledOnce()
    expect(storage.write).not.toHaveBeenCalled()
    expect(storage.finish).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('does not retry decryption failures or reopen the consumed code', async () => {
    const { storage, fetcher } = setup()
    vi.mocked(decryptTransferChunk).mockRejectedValue(new Error('invalid GCM tag'))
    await expect(openRelayTransfer(options)).rejects.toThrow('文件分片已损坏')
    const downloads = fetcher.mock.calls.map(([url]) => url).filter(url => url.startsWith('/chunk/'))
    expect(downloads.length).toBeLessThanOrEqual(4)
    expect(new Set(downloads).size).toBe(downloads.length)
    expect(fetcher.mock.calls.filter(([url]) => url === '/open')).toHaveLength(1)
    expect(storage.dispose).toHaveBeenCalledOnce()
    expect(storage.finish).not.toHaveBeenCalled()
    expect(fetcher.mock.calls.some(([url]) => url === '/received')).toBe(false)
  })

  it('retries the same upload ciphertext, reports byte-weighted progress and completes once after all uploads', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const events: string[] = []
    const bodies: Array<RequestInit['body']> = []
    let retried = false
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      events.push(url)
      if (url === '/create') return Response.json({ code: meta.code, uploadUrls: [0, 1, 2].map(index => ({ index, url: `/upload/${index}` })) })
      if (url === '/complete') return Response.json(meta)
      if (url === '/upload/1') {
        bodies.push(init?.body)
        if (!retried) { retried = true; return new Response(null, { status: 503 }) }
      }
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const file = {
      name: 'file.bin', size: 2 * TRANSFER_LIMITS.publicRelayChunkBytes + 1,
      slice: (start: number) => ({ arrayBuffer: async () => new Uint8Array([start / TRANSFER_LIMITS.publicRelayChunkBytes]).buffer })
    } as unknown as File
    const statuses: string[] = []
    const run = createRelayTransfer({ kind: 'file', text: '', file, password: 'password', createUrl: '/create', completeUrl: '/complete', onStatus: message => statuses.push(message) })
    await vi.advanceTimersByTimeAsync(0)
    expect(events).not.toContain('/complete')
    await vi.runAllTimersAsync()
    expect((await run).code).toBe(meta.code)
    expect(vi.mocked(encryptTransferChunk)).toHaveBeenCalledTimes(3)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toBe(bodies[1])
    expect(events.filter(url => url === '/create')).toHaveLength(1)
    expect(events.filter(url => url === '/complete')).toHaveLength(1)
    expect(events.at(-1)).toBe('/complete')
    const progress = statuses.flatMap(message => { const match = message.match(/上传 (\d+)%/); return match ? [Number(match[1])] : [] })
    expect(progress).toContain(50)
    expect(progress).toEqual([...progress].sort((a, b) => a - b))
    expect(progress.at(-1)).toBe(100)
  })

  it('never marks a transfer complete when a chunk upload is permanently rejected', async () => {
    const fetcher = vi.fn(async (url: string) => url === '/create'
      ? Response.json({ code: meta.code, uploadUrls: [{ index: 0, url: '/upload/0' }] })
      : new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(createRelayTransfer({ kind: 'text', text: 'secret', file: null, password: 'password', createUrl: '/create', completeUrl: '/complete' })).rejects.toThrow('上传失败')
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/create', '/upload/0'])
  })

  it('cancels an upload during encryption without uploading or completing the transfer', async () => {
    const fetcher = vi.fn(async () => Response.json({ code: meta.code, uploadUrls: [{ index: 0, url: '/upload/0' }] }))
    vi.stubGlobal('fetch', fetcher)
    const enteredCrypto = deferred<void>()
    const encrypted = deferred<Awaited<ReturnType<typeof encryptTransferChunk>>>()
    vi.mocked(encryptTransferChunk).mockImplementationOnce(async () => { enteredCrypto.resolve(); return encrypted.promise })
    const controller = new AbortController()
    const result = expect(createRelayTransfer({ kind: 'text', text: 'secret', file: null, password: 'password', createUrl: '/create', completeUrl: '/complete', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await enteredCrypto.promise
    controller.abort()
    encrypted.resolve({ cipher: new Uint8Array([1]), iv: 'iv' })
    await result
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
