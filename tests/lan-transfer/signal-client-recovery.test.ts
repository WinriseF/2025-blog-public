import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key'
  const channels: any[] = []
  const realtime = { isConnected: vi.fn(() => true), connect: vi.fn() }
  const client: any = { realtime }
  client.channel = vi.fn((topic: string, options: unknown) => {
    const handlers = new Map<string, (event?: any) => void>()
    const channel: any = {
      topic, options, state: 'closed', presence: {},
      on(type: string, filter: { event: string }, callback: (event?: any) => void) {
        handlers.set(`${type}:${filter.event}`, callback)
        return channel
      },
      subscribe(callback: (status: string, error?: Error) => void) {
        channel.status = callback
        channel.state = 'joined'
        callback('SUBSCRIBED')
        return channel
      },
      track: vi.fn(async () => 'ok'), untrack: vi.fn(async () => 'ok'),
      unsubscribe: vi.fn(async () => 'ok'), send: vi.fn(async () => 'ok'),
      presenceState: vi.fn(() => channel.presence),
      emit(type: string, event: string, payload?: any) { handlers.get(`${type}:${event}`)?.(payload) },
    }
    channels.push(channel)
    return channel
  })
  client.removeChannel = vi.fn(async (channel: any) => { channel.state = 'closed'; return 'ok' })
  return { channels, client, realtime }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fake.client }))

import { LanSignalingClient } from '../../src/lib/lan-transfer/signal-client'
import { LAN_PROTOCOL_VERSION, type LanPeer, type LanSession } from '../../src/lib/lan-transfer/types'

const localPeer: LanPeer = { deviceId: 'host-device', instanceId: 'host-instance', role: 'host', name: 'Host', deviceType: 'desktop', avatarSeed: 'host', startedAt: 1 }
const remotePeer: LanPeer = { deviceId: 'guest-device', instanceId: 'guest-instance', role: 'guest', name: 'Guest', deviceType: 'phone', avatarSeed: 'guest', startedAt: 2 }
const session: LanSession = { roomId: 'room-id', secret: 'never-broadcast', channelKey: 'derived-channel-key', role: 'host', instanceId: localPeer.instanceId, localPeer }

beforeEach(() => {
  vi.useFakeTimers()
  fake.channels.length = 0
  fake.client.channel.mockClear()
  fake.client.removeChannel.mockClear()
  fake.realtime.isConnected.mockReturnValue(true)
})
afterEach(() => vi.useRealTimers())

describe('LanSignalingClient V14', () => {
  it('uses a secret-derived topic and Presence only for device discovery', async () => {
    const peers = vi.fn()
    const client = new LanSignalingClient(session, vi.fn(), undefined, undefined, undefined, peers)
    await client.ready
    const channel = fake.channels[0]
    expect(channel.topic).toBe('lan-transfer:v14:derived-channel-key')
    expect(channel.options).toMatchObject({ config: { broadcast: { ack: false }, presence: { key: localPeer.deviceId } } })
    expect(channel.track.mock.calls[0][0]).not.toHaveProperty('secret')

    channel.presence = {
      [remotePeer.deviceId]: [{ protocolVersion: LAN_PROTOCOL_VERSION, instanceId: remotePeer.instanceId, peer: remotePeer }],
    }
    channel.emit('presence', 'sync')
    expect(peers).toHaveBeenLastCalledWith([remotePeer])
    await client.close()
  })

  it('recreates a terminal channel with one bounded channel retry', async () => {
    const statuses: string[] = []
    const client = new LanSignalingClient(session, vi.fn(), status => statuses.push(status))
    await client.ready
    fake.channels[0].status('CLOSED')
    expect(statuses.at(-1)).toBe('retrying')
    vi.advanceTimersByTime(500)
    expect(fake.channels).toHaveLength(2)
    expect(statuses.at(-1)).toBe('online')
    await client.close()
  })

  it('broadcasts targeted description envelopes', async () => {
    const client = new LanSignalingClient(session, vi.fn())
    await client.ready
    const target = { deviceId: remotePeer.deviceId, instanceId: remotePeer.instanceId }
    await client.sendSignal('description', target, { connectionId: 'connection', exchangeId: 'exchange', description: { type: 'offer', sdp: 'v=0' } })
    expect(fake.channels[0].send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'broadcast', event: 'signal',
      payload: expect.objectContaining({ type: 'description', connectionId: 'connection', exchangeId: 'exchange', toInstanceId: remotePeer.instanceId }),
    }))
    await client.close()
  })

  it('accepts targeted Guest recovery requests and rejects malformed or misdirected requests', async () => {
    const onMessage = vi.fn()
    const client = new LanSignalingClient(session, onMessage)
    await client.ready
    const channel = fake.channels[0]
    const request = {
      type: 'connect-request', protocolVersion: LAN_PROTOCOL_VERSION,
      fromDeviceId: remotePeer.deviceId, fromInstanceId: remotePeer.instanceId,
      toDeviceId: localPeer.deviceId, toInstanceId: localPeer.instanceId,
      ts: Date.now(), connectionId: '', exchangeId: '', reason: 'connect',
    }
    channel.emit('broadcast', 'signal', { payload: request })
    expect(onMessage).toHaveBeenCalledWith(request)
    channel.emit('broadcast', 'signal', { payload: { ...request, reason: 'unknown' } })
    channel.emit('broadcast', 'signal', { payload: { ...request, toInstanceId: 'old-page' } })
    channel.emit('broadcast', 'signal', { payload: { ...request, type: 'description', description: { type: 'offer' } } })
    expect(onMessage).toHaveBeenCalledTimes(1)
    await client.sendSignal('connect-request', { deviceId: remotePeer.deviceId, instanceId: remotePeer.instanceId }, {
      connectionId: 'pc', exchangeId: 'exchange', reason: 'fresh',
    })
    expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ reason: 'fresh', connectionId: 'pc' }) }))
    await client.close()
  })

  it('announces signaling loss before rejecting a failed send', async () => {
    const statuses: string[] = []
    const client = new LanSignalingClient(session, vi.fn(), status => statuses.push(status))
    await client.ready
    fake.channels[0].send.mockResolvedValueOnce('error')
    await expect(client.sendSignal('description', { deviceId: remotePeer.deviceId, instanceId: remotePeer.instanceId }, {
      connectionId: 'pc', exchangeId: 'exchange', description: { type: 'offer', sdp: 'v=0' },
    })).rejects.toThrow('连接消息发送失败')
    expect(statuses.at(-1)).toBe('retrying')
    expect(fake.client.removeChannel).toHaveBeenCalledTimes(1)
    await client.close()
  })

  it('coalesces focus, visibility and network wake notifications', async () => {
    const onWake = vi.fn()
    const client = new LanSignalingClient(session, vi.fn(), undefined, undefined, onWake)
    await client.ready
    fake.channels[0].track.mockClear()
    client.wake()
    client.wake()
    client.wake()
    expect(onWake).toHaveBeenCalledTimes(1)
    expect(fake.channels[0].track).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(500)
    client.wake()
    expect(onWake).toHaveBeenCalledTimes(2)
    await client.close()
  })
})
