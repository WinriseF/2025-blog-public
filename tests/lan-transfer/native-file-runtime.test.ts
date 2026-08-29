import { afterEach, describe, expect, it, vi } from 'vitest'
import { LAN_NATIVE_FILE_MIN_BYTES, LanNativeFileRuntime } from '../../src/lib/lan-transfer/native-file-runtime'

function capability(nativeAgent?: any) {
  return {
    type: 'capability', protocolVersion: 13, peerId: 'p', platform: 'desktop', browser: 'chrome', isEmbeddedBrowser: false, webTransport: true,
    nativeAgent, storage: { memory: true, opfs: true, indexedDB: true, fileSystemAccess: true },
    limits: { maxRecommendedFileSize: 1e12, maxExperimentalFileSize: 1e12, recommendedChunkSize: 262144, recommendedStorage: 'file' }, notes: []
  } as any
}

function host(context: any = null) {
  return {
    context: vi.fn(() => context), peerBulk: { upload: vi.fn(), download: vi.fn() }, controlBase: vi.fn((type: string) => ({ type, protocolVersion: 13, peerId: 'p', seq: 1, createdAt: 1 })),
    sendControl: vi.fn(() => true), prepareStorage: vi.fn(), createAttachment: vi.fn(), patchAttachment: vi.fn(), patchFile: vi.fn(),
    downloadReady: vi.fn(), status: vi.fn(), fallbackBrowserFile: vi.fn()
  } as any
}

function nativeAdvertisement() {
  return { bridgeVersion: 3, benchmarkVersion: 3, ownerDeviceId: 'remote', endpoints: [], lnaHttpVersion: 1, lnaHttpEndpoints: [], fileVersion: 1,
    fileHttpEndpoints: ['http://192.168.1.2:5000/winrisef/file/v1'], fileWebTransportEndpoints: [], certificateSha256: 'a'.repeat(64), networkEpoch: 'e', publicIpv6State: 'not-present' }
}

afterEach(() => vi.restoreAllMocks())

describe('LanNativeFileRuntime', () => {
  it('does nothing when the peer does not advertise native file transfer', async () => {
    const runtime = new LanNativeFileRuntime(host({ remoteCapability: capability(), localCapability: capability(), localDeviceId: 'local', peerDeviceId: 'remote', localPort: null }))
    const file = new File([new Uint8Array(1)], 'tiny.bin')
    await expect(runtime.trySendBrowserFiles([file])).resolves.toEqual([file])
    expect(runtime.hasActiveTransfer()).toBe(false)
  })

  it('keeps small files and images on the browser/WebRTC path', async () => {
    const ctx = { remoteCapability: capability(nativeAdvertisement()), localCapability: capability(), localDeviceId: 'local', peerDeviceId: 'remote', localPort: null }
    const runtime = new LanNativeFileRuntime(host(ctx))
    const tiny = { name: 'tiny.bin', size: LAN_NATIVE_FILE_MIN_BYTES - 1, type: 'application/octet-stream' } as File
    const image = { name: 'huge.png', size: LAN_NATIVE_FILE_MIN_BYTES + 1, type: 'image/png' } as File
    await expect(runtime.trySendBrowserFiles([tiny, image])).resolves.toEqual([tiny, image])
    expect(runtime.hasActiveTransfer()).toBe(false)
  })

  it('claims non-WebRTC offers and creates an incoming attachment record', () => {
    const h = host({ remoteCapability: capability(nativeAdvertisement()), localCapability: capability(), localDeviceId: 'local', peerDeviceId: 'remote', localPort: null })
    const runtime = new LanNativeFileRuntime(h)
    const base = { id: 'f', kind: 'file', name: 'x.bin', mime: 'application/octet-stream', size: LAN_NATIVE_FILE_MIN_BYTES, lastModified: 1, chunkSize: 1, chunkCount: 1, suggestedStorage: 'file' }
    expect(runtime.handleOffer({ type: 'attachment-offer', protocolVersion: 13, peerId: 'p', seq: 1, createdAt: 1, messageId: 'm', attachment: { ...base, dataPlane: 'webrtc' } } as any)).toBe(false)
    expect(runtime.handleOffer({ type: 'attachment-offer', protocolVersion: 13, peerId: 'p', seq: 1, createdAt: 1, messageId: 'm', attachment: { ...base, dataPlane: 'native-lna-http' } } as any)).toBe(true)
    expect(h.createAttachment).toHaveBeenCalledTimes(1)
    expect(runtime.hasActiveTransfer()).toBe(true)
  })

  it('reset aborts transfers, cleans storage and revokes generated object URLs', () => {
    const storage = { engine: { cleanup: vi.fn(async () => {}) }, meta: { id: 'f' } }
    const h = host(null); const runtime = new LanNativeFileRuntime(h) as any
    const abort = new AbortController(); const outgoingAbort = new AbortController()
    runtime.incoming.set('f', { offer: {}, storage, abort })
    runtime.outgoing.set('g', { source: 'browser', file: {}, manifest: {}, messageId: 'm', createdAt: 1, abort: outgoingAbort })
    runtime.objectUrls.push('blob:a')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    runtime.reset()
    expect(abort.signal.aborted).toBe(true); expect(outgoingAbort.signal.aborted).toBe(true)
    expect(storage.engine.cleanup).toHaveBeenCalledWith('f')
    expect(revoke).toHaveBeenCalledWith('blob:a')
    expect(runtime.hasActiveTransfer()).toBe(false)
  })
})
