import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReconnectCoordinator } from '../../src/lib/lan-transfer/reconnect-coordinator'
import { LAN_PROTOCOL_VERSION, type LanPeer, type LanSignalMessage } from '../../src/lib/lan-transfer/types'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const remotePeer: LanPeer = {
  deviceId: 'guest-device', instanceId: 'guest-instance', role: 'guest', name: 'Guest',
  deviceType: 'phone', avatarSeed: 'guest', joinedAt: 1,
}

function signal(type: LanSignalMessage['type'], details: Partial<LanSignalMessage> = {}): LanSignalMessage {
  return {
    type, protocolVersion: LAN_PROTOCOL_VERSION, roomId: 'room', tokenHash: 'hash',
    fromDeviceId: remotePeer.deviceId, fromInstanceId: remotePeer.instanceId,
    toDeviceId: 'host-device', toInstanceId: 'host-instance', messageId: `message-${Math.random()}`,
    seq: 1, ts: Date.now(), generation: 1, negotiationId: 'negotiation-1', peer: remotePeer,
    ...details,
  }
}

class FakeTransport {
  readonly id: string
  readonly generation: number
  negotiationId: string
  bufferedAmount = 0
  open = false
  start = vi.fn(async (_attemptToken: number) => {})
  restartIce = vi.fn(async (_negotiationId: string, _attemptToken: number) => {})
  acceptDescription = vi.fn(async (_description: RTCSessionDescriptionInit, _attemptToken: number) => {})
  addRemoteCandidate = vi.fn(async () => {})
  probe = vi.fn(async () => true)
  getHealthStats = vi.fn(async () => ({ connectionState: 'connected', iceConnectionState: 'connected', candidatePairId: 'pair', bytesSent: 0, bytesReceived: 0, consentRequestsSent: 0, responsesReceived: 0 } as any))
  inspectRoute = vi.fn(async () => ({ family: 'ipv4', kind: 'lan' } as const))
  close = vi.fn(() => { this.open = false })
  send = vi.fn(() => this.open)
  negotiateChunkSize = vi.fn(async () => 60 * 1024)
  waitUntilWritable = vi.fn(async () => {})

  constructor(readonly options: any, index: number) {
    this.id = `transport-${index}`
    this.generation = options.generation
    this.negotiationId = options.negotiationId
  }

  isOpen() { return this.open }
  setNegotiationId(value: string) { this.negotiationId = value }
  emit(state: string) { this.options.onState(state) }
  ready() {
    this.open = true
    this.options.onState('connected')
    this.options.onReady()
  }
}

function fixture(sendSignal: any = vi.fn(async () => {})) {
  const transports: FakeTransport[] = []
  const states: Array<{ state: string; status: string; connected: boolean }> = []
  const coordinator = new ReconnectCoordinator({
    role: 'host', remotePeer,
    createTransport: (options: any) => {
      const transport = new FakeTransport(options, transports.length + 1)
      transports.push(transport)
      return transport as any
    },
    isTransferActive: () => false,
    sendSignal,
    onState: (_peer, state, status, connected) => states.push({ state, status, connected }),
    onAttach: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onRoute: vi.fn(), onDetach: vi.fn(), onData: vi.fn(),
  })
  return { coordinator, sendSignal, transports, states }
}

async function connectHost(result: ReturnType<typeof fixture>) {
  result.coordinator.setSignalingOnline(true)
  await flush()
  const transport = result.transports.at(-1)!
  transport.ready()
  await flush()
  return transport
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ReconnectCoordinator behavior', () => {
  it('ignores a stale ICE continuation after a hard rebuild supersedes it', async () => {
    const iceSignal = deferred<void>()
    const rebuildSignal = deferred<void>()
    let rebuilds = 0
    const result = fixture(vi.fn((type: string) => {
      if (type === 'ice-restart') return iceSignal.promise
      if (type === 'rebuild' && ++rebuilds > 1) return rebuildSignal.promise
      return Promise.resolve()
    }))
    const original = await connectHost(result)

    original.emit('disconnected')
    vi.advanceTimersByTime(3000)
    await flush()
    expect(result.states.at(-1)?.state).toBe('ice-restarting')

    result.coordinator.handleSignal(signal('reconnect-request', { hardRecovery: true }))
    rebuildSignal.resolve(undefined)
    await flush()
    const rebuilt = result.transports.at(-1)!
    expect(rebuilt).not.toBe(original)

    iceSignal.resolve(undefined)
    await flush()
    vi.advanceTimersByTime(5000)
    await flush()
    expect(rebuilt.close).not.toHaveBeenCalled()

    rebuilt.ready()
    await flush()
    vi.advanceTimersByTime(3000)
    expect(result.states.at(-1)).toMatchObject({ state: 'connected', connected: true })
  })

  it('keeps a healthy data channel alive when only Supabase Presence disappears', async () => {
    const result = fixture()
    const transport = await connectHost(result)
    const transportCount = result.transports.length

    result.coordinator.setPeerPresent(remotePeer, false)

    expect(transport.close).not.toHaveBeenCalled()
    expect(result.transports).toHaveLength(transportCount)
    expect(result.states.at(-1)).toMatchObject({ state: 'connected', connected: true })
    expect(result.states.at(-1)?.status).toContain('直连正常')

    result.coordinator.setPeerPresent(remotePeer, true)
    await flush()
    expect(transport.close).not.toHaveBeenCalled()
    expect(result.states.at(-1)).toMatchObject({ state: 'connected', connected: true })
  })

  it('stops retrying an absent peer without a usable transport and resumes when it returns', async () => {
    const result = fixture()
    const transport = await connectHost(result)
    const callsBeforeLeave = result.sendSignal.mock.calls.length
    transport.open = false

    result.coordinator.setPeerPresent(remotePeer, false)
    expect(transport.close).toHaveBeenCalledTimes(1)
    expect(result.states.at(-1)?.status).toContain('暂时离线')
    vi.advanceTimersByTime(60_000)
    await flush()
    expect(result.sendSignal).toHaveBeenCalledTimes(callsBeforeLeave)

    result.coordinator.setPeerPresent(remotePeer, true)
    await flush()
    expect(result.sendSignal.mock.calls.length).toBeGreaterThan(callsBeforeLeave)
    expect(result.states.at(-1)?.state).toBe('rebuilding')
  })

  it('forces a hard rebuild when the user retries an unhealthy transport that still reports open', async () => {
    const result = fixture()
    const original = await connectHost(result)
    original.emit('disconnected')
    expect(result.states.at(-1)?.state).toBe('suspect')

    result.coordinator.retry()
    await flush()

    expect(original.close).toHaveBeenCalledTimes(1)
    expect(result.transports.at(-1)).not.toBe(original)
    expect(result.states.at(-1)?.state).toBe('rebuilding')
  })

  it('does not cancel an ICE restart when Supabase signaling resubscribes', async () => {
    const result = fixture()
    const transport = await connectHost(result)
    transport.emit('disconnected')
    vi.advanceTimersByTime(3000)
    await flush()
    expect(result.states.at(-1)?.state).toBe('ice-restarting')

    result.coordinator.setSignalingOnline(false)
    result.coordinator.setSignalingOnline(true)
    await flush()

    expect(transport.restartIce).toHaveBeenCalledTimes(1)
    expect(result.states.at(-1)?.state).toBe('ice-restarting')
  })

  it('pauses after the bounded automatic retry budget and supports an explicit retry', async () => {
    const result = fixture()
    result.coordinator.setSignalingOnline(true)
    await flush()

    for (const delay of [0, 750, 2000]) {
      const current = (result.coordinator as any).transport
      ;(result.coordinator as any).handleAttemptFailure((result.coordinator as any).attemptEpoch, current)
      vi.advanceTimersByTime(delay)
      await flush()
    }
    const current = (result.coordinator as any).transport
    ;(result.coordinator as any).handleAttemptFailure((result.coordinator as any).attemptEpoch, current)
    expect(result.states.at(-1)?.status).toContain('自动重连未成功')

    const transportCount = result.transports.length
    vi.advanceTimersByTime(60_000)
    await flush()
    expect(result.transports).toHaveLength(transportCount)

    result.coordinator.retry()
    await flush()
    expect(result.transports.length).toBeGreaterThan(transportCount)
  })
})
