import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LanWebRtcBenchmarkRuntime } from '../../src/lib/lan-transfer/webrtc-benchmark-runtime'
import { LAN_LIMITS } from '../../src/lib/lan-transfer/types'

function fixture() {
  const transport = { isOpen: vi.fn(() => true), negotiateChunkSize: vi.fn(async () => LAN_LIMITS.dataChannelFallbackChunkSize), waitUntilWritable: vi.fn(async () => {}), send: vi.fn(() => true), bufferedAmount: 0 } as any
  const callbacks = {
    transport: vi.fn(() => transport), recommendedChunkSize: vi.fn(() => LAN_LIMITS.dataChannelFallbackChunkSize), fileTransferActive: vi.fn(() => false), mobile: vi.fn(() => false), createId: vi.fn(() => 'bench'),
    sendRequest: vi.fn(() => true), sendReady: vi.fn(() => true), sendResult: vi.fn(() => true), sendCancel: vi.fn(() => true)
  }
  return { runtime: new LanWebRtcBenchmarkRuntime(callbacks), callbacks, transport }
}

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(performance, 'now').mockReturnValue(1000) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('WebRTC benchmark runtime', () => {
  it('rejects local runs without an open transport or with invalid sizes', async () => {
    const { runtime, callbacks } = fixture()
    ;(callbacks.transport() as any).isOpen.mockReturnValue(false)
    await expect(runtime.run('upload', 1)).rejects.toThrow(/先连接测速设备/)
    ;(callbacks.transport() as any).isOpen.mockReturnValue(true)
    await expect(runtime.run('upload', 0)).rejects.toThrow(/大小无效/)
  })

  it('rejects an incoming request with an unsupported chunk tier', () => {
    const { runtime, callbacks } = fixture()
    runtime.handleRequest({ type: 'webrtc-benchmark-request', protocolVersion: 13, peerId: 'p', seq: 1, createdAt: 1, benchmarkId: 'x', direction: 'requester-to-peer', totalBytes: 1024, chunkSize: 123 } as any)
    expect(callbacks.sendReady).toHaveBeenCalledWith({ benchmarkId: 'x', accepted: false, error: 'WebRTC 测速参数无效' })
    expect(runtime.isActive()).toBe(false)
  })

  it('accepts a valid receiver benchmark and rejects out-of-order frames', () => {
    const { runtime, callbacks } = fixture()
    const chunkSize = LAN_LIMITS.dataChannelFallbackChunkSize
    runtime.handleRequest({ type: 'webrtc-benchmark-request', protocolVersion: 13, peerId: 'p', seq: 1, createdAt: 1, benchmarkId: 'x', direction: 'requester-to-peer', totalBytes: chunkSize * 2, chunkSize } as any)
    expect(runtime.isActive()).toBe(true)
    runtime.handleFrame('x', 1, new Uint8Array(chunkSize))
    expect(callbacks.sendCancel).toHaveBeenCalledWith({ benchmarkId: 'x', reason: 'WebRTC 测速数据顺序或大小不一致' })
    expect(runtime.isActive()).toBe(false)
  })

  it('completes an exact receiver stream and sends measured result', () => {
    const { runtime, callbacks } = fixture()
    const chunkSize = LAN_LIMITS.dataChannelFallbackChunkSize
    runtime.handleRequest({ type: 'webrtc-benchmark-request', protocolVersion: 13, peerId: 'p', seq: 1, createdAt: 1, benchmarkId: 'x', direction: 'requester-to-peer', totalBytes: chunkSize + 10, chunkSize } as any)
    runtime.handleFrame('x', 0, new Uint8Array(chunkSize))
    vi.spyOn(performance, 'now').mockReturnValue(1100)
    runtime.handleFrame('x', 1, new Uint8Array(10))
    expect(callbacks.sendResult).toHaveBeenCalledWith(expect.objectContaining({ benchmarkId: 'x', receivedBytes: chunkSize + 10 }))
    expect(runtime.isActive()).toBe(false)
  })

  it('reset cancels an active local benchmark promise', async () => {
    const { runtime } = fixture()
    const pending = runtime.run('download', 1024)
    await Promise.resolve(); await Promise.resolve()
    expect(runtime.isActive()).toBe(true)
    runtime.reset('reset-test')
    await expect(pending).rejects.toThrow('reset-test')
  })
})
