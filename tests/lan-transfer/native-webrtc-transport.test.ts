import { afterEach, describe, expect, it, vi } from 'vitest'
import { LAN_LIMITS } from '../../src/lib/lan-transfer/types'
import { NativeWebRtcTransport, lanRtcConfig } from '../../src/lib/lan-transfer/native-webrtc-transport'

class FakeChannel {
  readyState = 'open'; bufferedAmount = 0; bufferedAmountLowThreshold = 0
  sent: unknown[] = []; close = vi.fn(() => { this.readyState = 'closed' })
  send = vi.fn((value: unknown) => this.sent.push(value))
  addEventListener = vi.fn(); removeEventListener = vi.fn()
  onopen: any = null; onclose: any = null; onerror: any = null; onmessage: any = null
}

class FakePC {
  connectionState: RTCPeerConnectionState = 'connected'; iceConnectionState: RTCIceConnectionState = 'connected'
  iceGatheringState: RTCIceGatheringState = 'complete'; signalingState: RTCSignalingState = 'stable'
  localDescription: any = null; remoteDescription: any = null; canTrickleIceCandidates = true
  channel = new FakeChannel(); reports = new Map<string, any>()
  onicecandidate: any; onicecandidateerror: any; onicegatheringstatechange: any; onsignalingstatechange: any; onconnectionstatechange: any; oniceconnectionstatechange: any; ondatachannel: any
  createDataChannel = vi.fn(() => this.channel as any)
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'v=0' }))
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'v=0' }))
  setLocalDescription = vi.fn(async (d: any) => { this.localDescription = { ...d, toJSON: () => d } })
  setRemoteDescription = vi.fn(async (d: any) => { this.remoteDescription = d })
  addIceCandidate = vi.fn(async () => {})
  restartIce = vi.fn()
  getStats = vi.fn(async () => this.reports as any)
  close = vi.fn(() => { this.connectionState = 'closed' })
}

function setup(role: 'host' | 'guest' = 'host') {
  let pc!: FakePC
  vi.stubGlobal('RTCPeerConnection', class extends FakePC { constructor() { super(); pc = this } })
  const options = { role, generation: 2, negotiationId: 'n', onDescription: vi.fn(), onCandidate: vi.fn(), onData: vi.fn(), onState: vi.fn(), onReady: vi.fn() }
  const transport = new NativeWebRtcTransport(options as any)
  return { transport, pc, options }
}

afterEach(() => vi.unstubAllGlobals())

describe('NativeWebRtcTransport', () => {
  it('uses STUN only and never configures a TURN relay', () => {
    const urls = (lanRtcConfig.iceServers || []).flatMap(server => typeof server.urls === 'string' ? [server.urls] : server.urls)
    expect(urls.some(url => /^turns?:/i.test(url))).toBe(false)
    expect(urls.some(url => /^stun:/i.test(url))).toBe(true)
  })

  it('host creates an ordered data channel and can send only while open', () => {
    const { transport, pc } = setup('host')
    expect(pc.createDataChannel).toHaveBeenCalledWith('lan-session-v13', { ordered: true })
    expect(transport.isOpen()).toBe(true)
    expect(transport.send(new Uint8Array([1, 2]))).toBe(true)
    expect(pc.channel.send).toHaveBeenCalledTimes(1)
    pc.channel.readyState = 'closed'
    expect(transport.send(new Uint8Array([3]))).toBe(false)
  })

  it('falls back immediately when peer maximum is at or below fallback tier', async () => {
    const { transport } = setup()
    await expect(transport.negotiateChunkSize(1)).resolves.toBe(LAN_LIMITS.dataChannelFallbackChunkSize)
    await expect(transport.negotiateChunkSize(LAN_LIMITS.dataChannelFallbackChunkSize)).resolves.toBe(LAN_LIMITS.dataChannelFallbackChunkSize)
  })

  it('reports selected candidate-pair health statistics', async () => {
    const { transport, pc } = setup()
    pc.reports.set('transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' })
    pc.reports.set('pair', { id: 'pair', type: 'candidate-pair', state: 'succeeded', bytesSent: 10, bytesReceived: 20, consentRequestsSent: 3, responsesReceived: 4, localCandidateId: 'l', remoteCandidateId: 'r' })
    expect(await transport.getHealthStats()).toMatchObject({ candidatePairId: 'pair', bytesSent: 10, bytesReceived: 20, consentRequestsSent: 3, responsesReceived: 4 })
  })

  it('rejects a relay-selected route instead of silently using TURN', async () => {
    const { transport, pc } = setup()
    pc.reports.set('transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' })
    pc.reports.set('pair', { id: 'pair', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'l', remoteCandidateId: 'r' })
    pc.reports.set('l', { id: 'l', type: 'local-candidate', address: '10.0.0.2', candidateType: 'relay' })
    pc.reports.set('r', { id: 'r', type: 'remote-candidate', address: '10.0.0.3', candidateType: 'host' })
    await expect(transport.inspectRoute()).rejects.toThrow(/无法直连/)
  })

  it('close is idempotent and tears down both channel and peer connection', () => {
    const { transport, pc, options } = setup()
    transport.close(); transport.close()
    expect(pc.channel.close).toHaveBeenCalledTimes(1)
    expect(pc.close).toHaveBeenCalledTimes(1)
    expect(options.onState).toHaveBeenCalledWith('closed')
  })
})
