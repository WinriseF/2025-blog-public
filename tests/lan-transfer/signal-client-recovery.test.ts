import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key'
  const channels: any[] = []
  const realtime = { isConnected: vi.fn(() => true), connect: vi.fn() }
  const client: any = { realtime }
  client.channel = vi.fn((_topic: string, options: unknown) => {
    const handlers = new Map<string, () => void>()
    const channel: any = {
      options,
      state: 'closed',
      presence: {},
      on(type: string, filter: { event: string }, callback: () => void) {
        handlers.set(`${type}:${filter.event}`, callback)
        return channel
      },
      subscribe(callback: (status: string, error?: Error) => void) {
        channel.status = callback
        channel.state = 'joined'
        callback('SUBSCRIBED')
        return channel
      },
      track: vi.fn(async () => 'ok'),
      untrack: vi.fn(async () => 'ok'),
      unsubscribe: vi.fn(async () => 'ok'),
      send: vi.fn(async () => 'ok'),
      presenceState: vi.fn(() => channel.presence),
      emitPresence(event: string) { handlers.get(`presence:${event}`)?.() },
    }
    channels.push(channel)
    return channel
  })
  client.removeChannel = vi.fn(async (channel: any) => { channel.state = 'closed'; return 'ok' })
  return { channels, client, realtime }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fake.client }))

import { LanSignalingClient } from '../../src/lib/lan-transfer/signal-client'
import type { LanPeer, LanSession } from '../../src/lib/lan-transfer/types'

const localPeer: LanPeer = { deviceId: 'host-device', instanceId: 'host-instance', role: 'host', name: 'Host', deviceType: 'desktop', avatarSeed: 'host', joinedAt: 1 }
const remotePeer: LanPeer = { deviceId: 'guest-device', instanceId: 'guest-instance', role: 'guest', name: 'Guest', deviceType: 'phone', avatarSeed: 'guest', joinedAt: 2 }
const session: LanSession = { roomId: 'room', token: 'token', tokenHash: 'hash', role: 'host', instanceId: localPeer.instanceId, localPeer, pairExpiresAt: 1, sessionExpiresAt: 1 }

beforeEach(() => {
  vi.useFakeTimers()
  fake.channels.length = 0
  fake.client.channel.mockClear()
  fake.client.removeChannel.mockClear()
})
afterEach(() => vi.useRealTimers())

describe('LanSignalingClient recovery', () => {
  it('recreates a channel that reaches the terminal CLOSED state', async () => {
    const statuses: string[] = []
    const client = new LanSignalingClient(session, vi.fn(), status => statuses.push(status))
    await client.ready
    const first = fake.channels[0]
    expect(first.options).toMatchObject({ config: { broadcast: { ack: false } } })

    first.status('CLOSED')
    expect(statuses).toContain('offline')
    vi.advanceTimersByTime(250)
    expect(fake.channels).toHaveLength(2)
    expect(statuses.at(-1)).toBe('online')
    await client.close()
  })

  it('uses a grace lease before reporting an abruptly missing presence peer', async () => {
    const presence = vi.fn()
    const client = new LanSignalingClient(session, vi.fn(), undefined, undefined, undefined, presence)
    await client.ready
    const channel = fake.channels[0]
    channel.presence = {
      [remotePeer.instanceId]: [{ instanceId: remotePeer.instanceId, role: remotePeer.role, peer: remotePeer, tokenHash: session.tokenHash, joinedAt: remotePeer.joinedAt }],
    }
    channel.emitPresence('sync')
    expect(presence).toHaveBeenCalledWith(remotePeer, true)

    channel.presence = {}
    channel.emitPresence('leave')
    vi.advanceTimersByTime(6499)
    expect(presence).not.toHaveBeenCalledWith(remotePeer, false)
    vi.advanceTimersByTime(1)
    expect(presence).toHaveBeenCalledWith(remotePeer, false)
    await client.close()
  })

  it('supersedes stale recovery messages and drops an unacknowledged one after bounded retries', async () => {
    const client = new LanSignalingClient(session, vi.fn())
    await client.ready
    const target = { deviceId: remotePeer.deviceId, instanceId: remotePeer.instanceId }
    await client.sendSignal('rebuild', target, { generation: 1, negotiationId: 'first' })
    await client.sendSignal('rebuild', target, { generation: 2, negotiationId: 'second' })
    expect((client as any).pending.size).toBe(1)

    for (let index = 0; index < 3; index += 1) await vi.advanceTimersByTimeAsync(800)
    expect((client as any).pending.size).toBe(0)
    await client.close()
  })
})
