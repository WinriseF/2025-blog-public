import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLanSession, forgetLanRoom, joinLanSession, lanInviteLink, restoreLanSession } from '../../src/lib/lan-transfer/session-store'

const device = {
  deviceId: 'device-a', peerName: 'Test Desktop', deviceType: 'desktop' as const, avatarSeed: 'avatar-a'
}

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  }
}

beforeEach(() => vi.stubGlobal('localStorage', storage()))
afterEach(() => vi.unstubAllGlobals())

describe('LAN V14 room membership', () => {
  it('creates a stable room secret and derives a separate signaling channel key', async () => {
    const session = await createLanSession(device)
    expect(session.role).toBe('host')
    expect(session.roomId.length).toBeGreaterThanOrEqual(10)
    expect(session.secret.length).toBeGreaterThanOrEqual(20)
    expect(session.channelKey).not.toBe(session.secret)
    expect(lanInviteLink(session, 'https://example.com')).toBe(`https://example.com/t/lan/${session.roomId}#k=${session.secret}`)
  })

  it('restores room and device identity while replacing the page instance', async () => {
    const first = await createLanSession(device)
    const restored = await restoreLanSession(first.roomId, device)
    expect(restored).toMatchObject({ roomId: first.roomId, secret: first.secret, channelKey: first.channelKey, role: 'host' })
    expect(restored?.localPeer.deviceId).toBe(first.localPeer.deviceId)
    expect(restored?.instanceId).not.toBe(first.instanceId)
  })

  it('lets another browser join with the same channel key and forget explicitly', async () => {
    const host = await createLanSession(device)
    localStorage.clear()
    const guest = await joinLanSession(host.roomId, host.secret, { ...device, deviceId: 'device-b', peerName: 'Guest' })
    expect(guest.role).toBe('guest')
    expect(guest.channelKey).toBe(host.channelKey)
    forgetLanRoom(host.roomId)
    expect(await restoreLanSession(host.roomId, device)).toBeNull()
  })
})
