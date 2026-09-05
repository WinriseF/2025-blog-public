import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerConnectionManager, type PeerConnectionManagerOptions } from '../../src/lib/lan-transfer/peer-connection-manager'
import { LanSignalInbox } from '../../src/lib/lan-transfer/signal-inbox'
import { LAN_PROTOCOL_VERSION, type LanPeer, type LanRole, type LanSignalMessage } from '../../src/lib/lan-transfer/types'
import type { LanTransportCreateOptions, LanTransportState } from '../../src/lib/lan-transfer/transport-types'

const guest: LanPeer = {
  deviceId: 'a-guest', instanceId: 'guest-instance-1', role: 'guest', name: 'Guest',
  deviceType: 'phone', avatarSeed: 'guest', startedAt: 1,
}
const host: LanPeer = { ...guest, deviceId: 'z-host', instanceId: 'host-instance-1', role: 'host' }

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
    this.options.onDescription({ type: 'offer', sdp: 'restart' }, exchangeId, token)
  })
  acceptDescription = vi.fn(async (description: RTCSessionDescriptionInit, token: number) => {
    if (description.type === 'offer') this.options.onDescription({ type: 'answer', sdp: 'v=0' }, this.negotiationId, token)
  })
  addRemoteCandidate = vi.fn(async () => {})
  probe = vi.fn(async () => true)
  inspectRoute = vi.fn(async () => ({ family: 'ipv4', kind: 'lan' } as const))
  close = vi.fn(() => { this.open = false })
  send = vi.fn(() => this.open)
  negotiateChunkSize = vi.fn(async () => 60 * 1024)
  waitUntilWritable = vi.fn(async () => {})

  constructor(readonly options: LanTransportCreateOptions, index: number) {
    this.id = 'transport-' + index
    this.negotiationId = options.negotiationId
  }

  isOpen() { return this.open }
  setNegotiationId(value: string) { this.negotiationId = value }
  emit(state: LanTransportState) {
    if (['disconnected', 'ice-failed', 'failed', 'channel-closed'].includes(state)) this.open = false
    this.options.onState(state)
  }
  ready() {
    this.open = true
    this.options.onState('connected')
    this.options.onReady()
  }
}

function fixture(localRole: LanRole = 'host') {
  const transports: FakeTransport[] = []
  const states: Array<{ state: string; connected: boolean }> = []
  const sendSignal = vi.fn<PeerConnectionManagerOptions['sendSignal']>(async () => {})
  const callbacks = { onAttach: vi.fn(), onRoute: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onDetach: vi.fn(), onData: vi.fn() }
  const remotePeer = localRole === 'host' ? guest : host
  const manager = new PeerConnectionManager({
    localRole, remotePeer, sendSignal,
    createTransport: options => {
      const transport = new FakeTransport(options, transports.length + 1)
      transports.push(transport)
      return transport
    },
    onState: (_peer, state, _status, connected) => states.push({ state, connected }),
    ...callbacks,
  })
  return { manager, transports, states, sendSignal, callbacks, remotePeer }
}

function description(peer: LanPeer, details: Partial<LanSignalMessage> = {}): LanSignalMessage {
  return {
    type: 'description', protocolVersion: LAN_PROTOCOL_VERSION,
    fromDeviceId: peer.deviceId, fromInstanceId: peer.instanceId,
    toDeviceId: peer.role === 'host' ? guest.deviceId : host.deviceId, toInstanceId: 'local-instance', ts: Date.now(),
    connectionId: 'remote-connection', exchangeId: 'remote-exchange',
    description: { type: 'offer', sdp: 'v=0' }, ...details,
  }
}

function latestOffer(result: ReturnType<typeof fixture>) {
  return result.sendSignal.mock.calls.filter(call => call[2].description?.type === 'offer').at(-1)![2]
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function establish(result: ReturnType<typeof fixture>) {
  result.manager.setSignalingOnline(true)
  if (result.remotePeer.role === 'guest') {
    const offer = latestOffer(result)
    result.manager.handleSignal(description(result.remotePeer, { ...offer, description: { type: 'answer', sdp: 'v=0' } }))
  } else result.manager.handleSignal(description(host))
  await settle()
  result.transports.at(-1)!.ready()
  return result.transports.at(-1)!
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('PeerConnectionManager V14.1', () => {
  it('connects two managers and recovers a Guest-only channel closure without Guest offers', async () => {
    const a = fixture()
    const b = fixture('guest')
    for (const [sender, receiver, local] of [[a, b, host], [b, a, guest]] as const) {
      sender.sendSignal.mockImplementation(async (type, _target, details) => {
        receiver.manager.handleSignal(description(local, { ...details, type }))
      })
    }
    b.manager.setSignalingOnline(true)
    a.manager.setSignalingOnline(true)
    await settle()
    a.transports[0].ready()
    b.transports[0].ready()
    expect(a.callbacks.onAttach).toHaveBeenCalledTimes(1)
    expect(b.callbacks.onAttach).toHaveBeenCalledTimes(1)
    b.transports[0].emit('channel-closed')
    await vi.advanceTimersByTimeAsync(10)
    expect(a.transports).toHaveLength(2)
    expect(b.transports).toHaveLength(2)
    a.transports[1].ready()
    b.transports[1].ready()
    expect(a.states.at(-1)?.connected).toBe(true)
    expect(b.states.at(-1)?.connected).toBe(true)
    expect(b.sendSignal.mock.calls.some(call => call[2].description?.type === 'offer')).toBe(false)
  })

  it('accepts an early replacement offer immediately when Presence catches up', async () => {
    const result = fixture('guest')
    const first = await establish(result)
    const inbox = new LanSignalInbox()
    inbox.confirm(host)
    const nextHost = { ...host, instanceId: 'host-instance-2', startedAt: 2 }
    const offer = description(nextHost, { connectionId: 'new-pc', exchangeId: 'new-exchange' })
    inbox.push(offer)
    inbox.confirm(nextHost)
    result.manager.updatePeer(nextHost)
    for (const message of inbox.take(nextHost)) result.manager.handleSignal(message)
    await settle()
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(result.transports).toHaveLength(2)
    expect(result.transports[1].acceptDescription).toHaveBeenCalledWith(offer.description, expect.any(Number))
    result.transports[1].ready()
    expect(result.states.at(-1)?.connected).toBe(true)
  })

  it('always lets the Host offer even when its device ID sorts after the Guest', () => {
    const result = fixture()
    result.manager.setSignalingOnline(true)
    expect(result.transports).toHaveLength(1)
    expect(latestOffer(result).description?.type).toBe('offer')
    result.manager.handleSignal(description(guest))
    expect(result.transports).toHaveLength(1)
    expect(result.transports[0].acceptDescription).not.toHaveBeenCalled()
  })

  it('lets the Guest request, answer and retry without creating an offer', async () => {
    const result = fixture('guest')
    const transport = await establish(result)
    expect(transport.options.role).toBe('answerer')
    result.manager.retry()
    expect(result.transports).toHaveLength(1)
    expect(result.sendSignal).toHaveBeenLastCalledWith('connect-request', expect.anything(), expect.objectContaining({ reason: 'retry' }))
    expect(result.sendSignal.mock.calls.some(call => call[2].description?.type === 'offer')).toBe(false)
  })

  it('attaches exactly once before a stalled route query and delivers early data', async () => {
    const result = fixture()
    result.manager.setSignalingOnline(true)
    const transport = result.transports[0]
    transport.inspectRoute.mockImplementation(() => new Promise(() => {}))
    await establish(result)
    expect(result.callbacks.onAttach).toHaveBeenCalledTimes(1)
    expect(result.states.at(-1)).toEqual({ state: 'connected', connected: true })
    transport.options.onData('resume-query')
    expect(result.callbacks.onData).toHaveBeenCalledWith(guest, transport.id, 'resume-query')
    transport.ready()
    result.manager.setPeerPresent(guest, true)
    expect(result.callbacks.onAttach).toHaveBeenCalledTimes(1)
    expect(result.callbacks.onResume).not.toHaveBeenCalled()
    expect(transport.inspectRoute).toHaveBeenCalledTimes(1)
  })

  it('ignores a delayed route result from a replaced transport', async () => {
    const result = fixture()
    result.manager.setSignalingOnline(true)
    let resolveRoute!: (route: { family: 'ipv4'; kind: 'lan' }) => void
    result.transports[0].inspectRoute.mockImplementation(() => new Promise(resolve => { resolveRoute = resolve }))
    await establish(result)
    result.manager.updatePeer({ ...guest, instanceId: 'guest-instance-2', startedAt: 2 })
    resolveRoute({ family: 'ipv4', kind: 'lan' })
    await settle()
    expect(result.callbacks.onRoute).not.toHaveBeenCalled()
  })

  it('replaces a new page instance immediately and never rolls back to an older snapshot', async () => {
    const result = fixture()
    const first = await establish(result)
    result.manager.updatePeer({ ...guest, instanceId: 'guest-instance-2', startedAt: 2 })
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(result.transports).toHaveLength(2)
    result.manager.updatePeer(guest)
    expect(result.manager.remotePeer.instanceId).toBe('guest-instance-2')
    expect(result.transports).toHaveLength(2)
  })

  it('keeps a healthy P2P connection while signaling and Presence disappear', async () => {
    const result = fixture()
    const transport = await establish(result)
    result.manager.setSignalingOnline(false)
    result.manager.setPeerPresent(guest, false)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(transport.close).not.toHaveBeenCalled()
    expect(result.callbacks.onPause).not.toHaveBeenCalled()
    expect(transport.send()).toBe(true)
  })

  it('waits two seconds and cancels recovery if the original path returns', async () => {
    const result = fixture()
    const transport = await establish(result)
    transport.emit('disconnected')
    await vi.advanceTimersByTimeAsync(1999)
    expect(transport.restartIce).not.toHaveBeenCalled()
    transport.ready()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(transport.restartIce).not.toHaveBeenCalled()
    expect(transport.close).not.toHaveBeenCalled()
    expect(result.callbacks.onResume).toHaveBeenCalledTimes(1)
  })

  it('restarts ICE once per outage and renews that budget after a successful recovery', async () => {
    const result = fixture()
    const transport = await establish(result)
    for (let outage = 1; outage <= 2; outage++) {
      transport.emit('disconnected')
      await vi.advanceTimersByTimeAsync(2000)
      expect(transport.restartIce).toHaveBeenCalledTimes(outage)
      const offer = latestOffer(result)
      result.manager.handleSignal(description(guest, { ...offer, description: { type: 'answer', sdp: 'v=0' } }))
      await settle()
      transport.ready()
    }
    expect(result.transports).toHaveLength(1)
  })

  it('skips the grace period for ICE failure without immediately replacing the PC', async () => {
    const result = fixture()
    const transport = await establish(result)
    transport.emit('ice-failed')
    expect(transport.restartIce).toHaveBeenCalledTimes(1)
    expect(transport.close).not.toHaveBeenCalled()
  })

  it('retains a disconnected PC offline and restarts ICE after signaling returns', async () => {
    const result = fixture()
    const transport = await establish(result)
    transport.emit('disconnected')
    result.manager.setSignalingOnline(false)
    result.manager.setPeerPresent(guest, false)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(transport.close).not.toHaveBeenCalled()
    expect(transport.restartIce).not.toHaveBeenCalled()
    result.manager.setSignalingOnline(true)
    result.manager.setPeerPresent(guest, true)
    expect(transport.restartIce).toHaveBeenCalledTimes(1)
  })

  it('resumes the original channel if the network recovers while signaling is still offline', async () => {
    const result = fixture()
    const transport = await establish(result)
    result.manager.setSignalingOnline(false)
    transport.emit('disconnected')
    await vi.advanceTimersByTimeAsync(3000)
    transport.ready()
    expect(result.states.at(-1)?.connected).toBe(true)
    expect(result.callbacks.onResume).toHaveBeenCalledTimes(1)
    result.manager.setSignalingOnline(true)
    expect(transport.restartIce).not.toHaveBeenCalled()
    expect(transport.close).not.toHaveBeenCalled()
  })

  it('ignores a late request rejection after a newer Guest request has started', async () => {
    const result = fixture('guest')
    let reject!: (error: Error) => void
    result.sendSignal.mockImplementationOnce(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest }))
    result.manager.setSignalingOnline(true)
    await vi.advanceTimersByTimeAsync(7001)
    expect(result.sendSignal).toHaveBeenCalledTimes(2)
    reject(new Error('late send failure'))
    await settle()
    await vi.advanceTimersByTimeAsync(1001)
    expect(result.sendSignal).toHaveBeenCalledTimes(2)
  })

  it('suspends an in-flight restart deadline when signaling goes offline', async () => {
    const result = fixture()
    const transport = await establish(result)
    transport.emit('disconnected')
    await vi.advanceTimersByTimeAsync(2000)
    result.manager.setSignalingOnline(false)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(transport.close).not.toHaveBeenCalled()
    result.manager.setSignalingOnline(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.close).toHaveBeenCalledTimes(1)
    expect(result.transports).toHaveLength(2)
  })

  it('lets a Guest-only outage request an ICE restart from a locally healthy Host', async () => {
    const sender = fixture('guest')
    const guestTransport = await establish(sender)
    guestTransport.emit('disconnected')
    await vi.advanceTimersByTimeAsync(2000)
    expect(sender.sendSignal).toHaveBeenLastCalledWith('connect-request', expect.anything(), expect.objectContaining({ reason: 'network' }))
    const receiver = fixture()
    const hostTransport = await establish(receiver)
    const offer = latestOffer(receiver)
    const request = description(guest, { ...offer, type: 'connect-request', description: undefined, reason: 'network' })
    receiver.manager.handleSignal(request)
    receiver.manager.handleSignal(request)
    expect(hostTransport.restartIce).toHaveBeenCalledTimes(1)
    expect(hostTransport.close).not.toHaveBeenCalled()
  })

  it('rebuilds for a Guest closed-channel request and ignores duplicate/stale requests', async () => {
    const result = fixture()
    const first = await establish(result)
    const offer = latestOffer(result)
    const request = description(guest, { ...offer, type: 'connect-request', description: undefined, reason: 'fresh' })
    result.manager.handleSignal(request)
    result.manager.handleSignal(request)
    await vi.advanceTimersByTimeAsync(1)
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(result.transports).toHaveLength(2)
    result.manager.handleSignal(request)
    await vi.advanceTimersByTimeAsync(1)
    expect(result.transports).toHaveLength(2)
  })

  it('requests a fresh PC immediately when the Guest channel closes', async () => {
    const result = fixture('guest')
    const transport = await establish(result)
    transport.emit('channel-closed')
    await vi.advanceTimersByTimeAsync(1)
    expect(result.sendSignal).toHaveBeenLastCalledWith('connect-request', expect.anything(), expect.objectContaining({
      connectionId: 'remote-connection', reason: 'fresh',
    }))
    expect(result.transports).toHaveLength(1)
  })

  it('bounds hard-failure retries even with repeated Presence snapshots', async () => {
    const result = fixture()
    result.manager.setSignalingOnline(true)
    for (const delay of [0, 1000, 3000]) {
      result.transports.at(-1)!.emit('failed')
      for (let i = 0; i < 3; i++) result.manager.updatePeer(guest)
      await vi.advanceTimersByTimeAsync(delay + 1)
    }
    result.transports.at(-1)!.emit('failed')
    result.manager.updatePeer(guest)
    result.manager.setSignalingOnline(false)
    result.manager.setSignalingOnline(true)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(result.transports).toHaveLength(4)
    expect(result.states.at(-1)?.state).toBe('offline')
    result.manager.retry()
    expect(result.transports).toHaveLength(5)
  })

  it('coalesces wake probes and does not destroy a PC because an old probe fails', async () => {
    const result = fixture()
    const first = await establish(result)
    let finish!: (alive: boolean) => void
    first.probe.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    result.manager.wake()
    result.manager.wake()
    expect(first.probe).toHaveBeenCalledTimes(1)
    result.manager.updatePeer({ ...guest, instanceId: 'guest-instance-2', startedAt: 2 })
    finish(false)
    await settle()
    await vi.advanceTimersByTimeAsync(2000)
    expect(result.transports).toHaveLength(2)
    expect(result.transports[1].close).not.toHaveBeenCalled()
  })

  it('does not turn a wake during initial negotiation into a rebuild', () => {
    const result = fixture()
    result.manager.setSignalingOnline(true)
    result.manager.wake()
    expect(result.transports).toHaveLength(1)
    expect(result.transports[0].close).not.toHaveBeenCalled()
  })

  it('ignores descriptions and candidates for retired connections', async () => {
    const result = fixture('guest')
    await establish(result)
    result.manager.handleSignal(description(host, { connectionId: 'new-connection', exchangeId: 'new-exchange' }))
    await settle()
    result.manager.handleSignal(description(host))
    result.manager.handleSignal(description(host, { type: 'candidate', candidate: { candidate: 'old' } }))
    expect(result.transports).toHaveLength(2)
    expect(result.transports[1].addRemoteCandidate).not.toHaveBeenCalled()
  })
})
