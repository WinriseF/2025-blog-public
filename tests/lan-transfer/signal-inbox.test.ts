import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LanSignalInbox } from '../../src/lib/lan-transfer/signal-inbox'
import { LAN_PROTOCOL_VERSION, type LanPeer, type LanSignalMessage } from '../../src/lib/lan-transfer/types'

const peer: LanPeer = {
  deviceId: 'host', instanceId: 'page-1', startedAt: 1, role: 'host',
  name: 'Host', deviceType: 'desktop', avatarSeed: 'host',
}
const replacement = { ...peer, instanceId: 'page-2', startedAt: 2 }
const offer = (remote = peer): LanSignalMessage => ({
  type: 'description', protocolVersion: LAN_PROTOCOL_VERSION,
  fromDeviceId: remote.deviceId, fromInstanceId: remote.instanceId,
  toDeviceId: 'guest', toInstanceId: 'guest-page', ts: 0,
  connectionId: 'connection', exchangeId: 'exchange', description: { type: 'offer', sdp: 'v=0' },
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('LAN signal inbox', () => {
  it('preserves an offer and candidates arriving before replacement Presence', () => {
    const inbox = new LanSignalInbox()
    inbox.confirm(peer)
    const nextOffer = offer(replacement)
    const candidate: LanSignalMessage = { ...nextOffer, type: 'candidate', description: undefined, candidate: { candidate: 'candidate' } }
    inbox.push(nextOffer)
    inbox.push(candidate)
    // An old Presence snapshot must not consume signals belonging to the new page.
    inbox.confirm(peer)
    expect(inbox.take(peer)).toEqual([])
    expect(inbox.confirm(replacement)).toBe(true)
    expect(inbox.take(replacement)).toEqual([nextOffer, candidate])
    expect(inbox.take(replacement)).toEqual([])
  })

  it('drops retired instance traffic and rejects older Presence snapshots', () => {
    const inbox = new LanSignalInbox()
    inbox.confirm(peer)
    inbox.push(offer(peer))
    inbox.confirm(replacement)
    inbox.push(offer(peer))
    expect(inbox.confirm(peer)).toBe(false)
    expect(inbox.take(peer)).toEqual([])
  })

  it('expires early messages using local receipt time rather than peer clock', () => {
    const inbox = new LanSignalInbox()
    inbox.push(offer())
    expect(inbox.take(peer)).toHaveLength(1)
    inbox.push(offer())
    vi.advanceTimersByTime(10_000)
    expect(inbox.take(peer)).toEqual([])
  })

  it('bounds unknown-instance queues and clears them when a room closes', () => {
    const inbox = new LanSignalInbox()
    for (let i = 0; i < 100; i++) inbox.push(offer({ ...peer, instanceId: 'unknown-' + i }))
    expect(inbox.take({ ...peer, instanceId: 'unknown-0' })).toEqual([])
    for (let i = 0; i < 100; i++) inbox.push(offer(peer))
    expect(inbox.take(peer)).toHaveLength(64)
    inbox.confirm(peer)
    inbox.confirm(replacement)
    inbox.clear()
    expect(inbox.confirm(peer)).toBe(true)
  })
})
