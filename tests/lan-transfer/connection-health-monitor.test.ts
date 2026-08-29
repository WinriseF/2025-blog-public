import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionHealthMonitor } from '../../src/lib/lan-transfer/connection-health-monitor'

function stats(overrides: Record<string, unknown> = {}) {
  return {
    connectionState: 'connected', iceConnectionState: 'connected', candidatePairId: 'pair-a',
    bytesSent: 0, bytesReceived: 0, consentRequestsSent: 0, responsesReceived: 0, ...overrides
  } as any
}

function fixture(active = false) {
  const transport = { id: 't', isOpen: vi.fn(() => true), bufferedAmount: 0, getHealthStats: vi.fn(), inspectRoute: vi.fn() } as any
  const callbacks = { onHealthy: vi.fn(), onSlow: vi.fn(), onSuspect: vi.fn() }
  const monitor = new ConnectionHealthMonitor({ getTransport: () => transport, isTransferActive: () => active, ...callbacks })
  return { transport, callbacks, monitor }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-29T00:00:00Z')) })
afterEach(() => vi.useRealTimers())

describe('ConnectionHealthMonitor', () => {
  it('immediately marks failed/closed transport as suspect', () => {
    const { monitor, transport, callbacks } = fixture()
    ;(monitor as any).evaluate(transport, stats({ connectionState: 'failed' }), false)
    expect(callbacks.onSuspect).toHaveBeenCalledWith('连接已失效，正在恢复', true)
  })

  it('treats candidate-pair changes and incoming bytes as strong progress', () => {
    const { monitor, transport, callbacks } = fixture(true)
    ;(monitor as any).evaluate(transport, stats({ candidatePairId: 'a', bytesReceived: 1 }), false)
    ;(monitor as any).evaluate(transport, stats({ candidatePairId: 'b', bytesReceived: 2 }), false)
    expect(callbacks.onHealthy).toHaveBeenCalledWith(transport, true, false)
  })

  it('reports slow before escalating an active transfer stall', () => {
    const { monitor, transport, callbacks } = fixture(true)
    transport.bufferedAmount = 1
    ;(monitor as any).evaluate(transport, stats(), false)
    vi.advanceTimersByTime(4000); vi.setSystemTime(new Date(Date.now() + 4000))
    ;(monitor as any).evaluate(transport, stats(), false)
    expect(callbacks.onSlow).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(7000); vi.setSystemTime(new Date(Date.now() + 7000))
    ;(monitor as any).evaluate(transport, stats(), false)
    expect(callbacks.onSuspect).toHaveBeenCalledWith('文件传输路径无响应，正在恢复', true)
  })

  it('stop invalidates an in-flight asynchronous health check', async () => {
    const { monitor, transport, callbacks } = fixture()
    let resolve!: (value: any) => void
    transport.getHealthStats.mockReturnValue(new Promise(r => { resolve = r }))
    const check = (monitor as any).check()
    monitor.stop()
    resolve(stats({ connectionState: 'failed' }))
    await check
    expect(callbacks.onSuspect).not.toHaveBeenCalled()
  })
})
