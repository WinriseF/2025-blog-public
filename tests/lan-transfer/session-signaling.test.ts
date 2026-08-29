import { describe, expect, it } from 'vitest'
import { createLanSession, joinLanSession } from '../../src/lib/lan-transfer/signal-client'

const device = {
  deviceId: 'device-a',
  peerName: 'Test Desktop',
  deviceType: 'desktop' as const,
  avatarSeed: 'avatar-a'
}

describe('LAN session invitation material', () => {
  it('creates a cryptographically random room/token pair with a hashed verifier', async () => {
    const session = await createLanSession(device)
    expect(session.role).toBe('host')
    expect(session.roomId.length).toBeGreaterThanOrEqual(10)
    expect(session.token.length).toBeGreaterThanOrEqual(20)
    expect(session.tokenHash).not.toBe(session.token)
    expect(session.tokenHash.length).toBeGreaterThan(20)
  })

  it('derives the same token hash for a joining peer using the same invite', async () => {
    const host = await createLanSession(device)
    const guest = await joinLanSession(host.roomId, host.token, {
      ...device,
      deviceId: 'device-b',
      peerName: 'Guest'
    })
    expect(guest.roomId).toBe(host.roomId)
    expect(guest.tokenHash).toBe(host.tokenHash)
    expect(guest.instanceId).not.toBe(host.instanceId)
  })

  it('uses a different verifier for a wrong token', async () => {
    const host = await createLanSession(device)
    const guest = await joinLanSession(host.roomId, `${host.token}x`, { ...device, deviceId: 'device-c' })
    expect(guest.tokenHash).not.toBe(host.tokenHash)
  })
})
