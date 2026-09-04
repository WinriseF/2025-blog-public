import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerConnectionManager } from '../../src/lib/lan-transfer/peer-connection-manager'
import { LAN_PROTOCOL_VERSION, type LanPeer, type LanSignalMessage } from '../../src/lib/lan-transfer/types'

const remotePeer: LanPeer = {
  deviceId: 'z-guest', instanceId: 'guest-instance-1', role: 'guest', name: 'Guest',
  deviceType: 'phone', avatarSeed: 'guest', startedAt: 1,
}

class FakeTransport {
  readonly id: string
  negotiationId: string
  bufferedAmount = 0
  open = false
  start = vi.fn(async (token: number) => {
    this.options.onDescription({ type: 'offer', sdp: 'v=0' }, this.negotiationId, token)
  })
  restartIce = vi.fn(async (exchangeId: string, token: number) => {
    this.negotiationId = exchangeId
    this.options.onDescription({ type: 'offer', sdp: 'v=0\r\na=ice-options:trickle' }, exchangeId, token)
  })
  acceptDescription = vi.fn(async () => {})
  addRemoteCandidate = vi.fn(async () => {})
  probe = vi.fn(async () => true)
  inspectRoute = vi.fn(async () => ({ family: 'ipv4', kind: 'lan' } as const))
  close = vi.fn(() => { this.open = false })
  send = vi.fn(() => this.open)
  negotiateChunkSize = vi.fn(async () => 60 * 1024)
  waitUntilWritable = vi.fn(async () => {})

  constructor(readonly options: any, index: number) {
    this.id = `transport-${index}`
    this.negotiationId = options.negotiationId
  }

  isOpen() { return this.open }
  setNegotiationId(value: string) { this.negotiationId = value }
  emit(state: string) {
    if (state === 'failed' || state === 'channel-closed') this.open = false
    this.options.onState(state)
  }
  ready() {
    this.open = true
    this.options.onState('connected')
    this.options.onReady()
  }
}

function fixture(localDeviceId = 'a-host') {
  const transports: FakeTransport[] = []
  const states: Array<{ state: string; connected: boolean }> = []
  const sendSignal = vi.fn(async () => {})
  const callbacks = { onAttach: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onDetach: vi.fn(), onData: vi.fn() }
  const manager = new PeerConnectionManager({
    localDeviceId, remotePeer, sendSignal,
    createTransport: (options: any) => {
      const transport = new FakeTransport(options, transports.length + 1)
      transports.push(transport)
      return transport as any
    },
    onState: (_peer, state, _status, connected) => states.push({ state, connected }),
    ...callbacks,
  })
  return { manager, transports, states, sendSignal, callbacks }
}

function description(peer: LanPeer, details: Partial<LanSignalMessage> = {}): LanSignalMessage {
  return {
    type: 'description', protocolVersion: LAN_PROTOCOL_VERSION,
    fromDeviceId: peer.deviceId, fromInstanceId: peer.instanceId,
    toDeviceId: 'a-host', toInstanceId: 'host-instance', ts: Date.now(),
    connectionId: 'remote-connection', exchangeId: 'remote-exchange',
    description: { type: 'offer', sdp: 'v=0' }, ...details,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('PeerConnectionManager V14', () => {
  it('starts with a direct SDP offer and no recovery command prelude', async () => {
    const result = fixture()
    result.manager.setSignalingOnline(true)
    await Promise.resolve()
    expect(result.transports).toHaveLength(1)
    expect(result.sendSignal).toHaveBeenCalledWith('description', expect.anything(), expect.objectContaining({ description: expect.objectContaining({ type: 'offer' }) }))
    expect(new Set(result.sendSignal.mock.calls.map(call => call[0]))).toEqual(new Set(['description']))
  })

  it('replaces the disposable transport immediately when the page instance changes', async () => {
    const result = fixture()
    result.manager.setSignalingOnline(true)
    const first = result.transports[0]
    first.ready()
    const replacement = { ...remotePeer, instanceId: 'guest-instance-2', startedAt: 2 }
    result.manager.updatePeer(replacement)
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(result.transports).toHaveLength(2)
    expect(result.states.at(-1)?.state).toBe('connecting')
  })

  it('keeps an open data channel when only Presence disappears', () => {
    const result = fixture()
    result.manager.setSignalingOnline(true)
    const transport = result.transports[0]
    transport.ready()
    result.manager.setPeerPresent(remotePeer, false)
    expect(transport.close).not.toHaveBeenCalled()
    expect(result.states.at(-1)).toEqual({ state: 'connected', connected: true })
  })

  it('waits for natural recovery and then performs one ICE restart', async () => {
    const result = fixture()
    result.manager.setSignalingOnline(true)
    const transport = result.transports[0]
    transport.ready()
    transport.open = false
    transport.emit('disconnected')
    vi.advanceTimersByTime(1999)
    expect(transport.restartIce).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await Promise.resolve()
    expect(transport.restartIce).toHaveBeenCalledTimes(1)
    expect(result.states.at(-1)?.state).toBe('reconnecting')
  })

  it('creates an answering transport directly from a remote offer', async () => {
    const result = fixture('zz-follower')
    result.manager.setSignalingOnline(true)
    expect(result.transports).toHaveLength(0)
    result.manager.handleSignal(description(remotePeer, { toDeviceId: 'zz-follower' }))
    await Promise.resolve()
    expect(result.transports).toHaveLength(1)
    expect(result.transports[0].acceptDescription).toHaveBeenCalledWith(expect.objectContaining({ type: 'offer' }), expect.any(Number))
  })
})
