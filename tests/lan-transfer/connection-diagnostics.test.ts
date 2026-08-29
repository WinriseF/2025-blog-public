import { describe, expect, it } from 'vitest'
import { redactDiagnosticDetails, shortConnectionId, summarizeIceCandidate, summarizeNetworkAddress } from '../../src/lib/lan-transfer/connection-diagnostics'

describe('LAN connection diagnostics privacy and parsing', () => {
  it('classifies common private/public/link-local address families', () => {
    expect(summarizeNetworkAddress('192.168.1.2')).toEqual({ family: 'ipv4', addressKind: 'private-ipv4' })
    expect(summarizeNetworkAddress('100.64.1.2')).toEqual({ family: 'ipv4', addressKind: 'cgnat-ipv4' })
    expect(summarizeNetworkAddress('8.8.8.8')).toEqual({ family: 'ipv4', addressKind: 'public-ipv4' })
    expect(summarizeNetworkAddress('fe80::1%12')).toEqual({ family: 'ipv6', addressKind: 'link-local-ipv6' })
    expect(summarizeNetworkAddress('fd00::1')).toEqual({ family: 'ipv6', addressKind: 'ula-ipv6' })
    expect(summarizeNetworkAddress('host-abc.local')).toEqual({ family: 'mdns', addressKind: 'mdns' })
  })

  it('parses ICE candidate metadata without exposing unparsed secret fields', () => {
    const result = summarizeIceCandidate({
      candidate: 'candidate:1 1 UDP 2122260223 192.168.1.20 54832 typ host generation 0 ufrag abc network-id 2 network-cost 10',
      sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'abc'
    })
    expect(result).toMatchObject({ foundation: '1', component: 1, protocol: 'udp', type: 'host', family: 'ipv4', addressKind: 'private-ipv4', port: 54832, generation: 0, networkId: 2, networkCost: 10 })
  })

  it('redacts sensitive keys, identifiers, credentials embedded in URLs, and long secret-like strings', () => {
    const details: any = {
      token: 'super-secret', roomId: 'room-secret', peerId: 'peer-1234567890',
      sourceUrl: 'https://user:pass@example.com/path?q=secret#fragment',
      payload: 'A'.repeat(80)
    }
    const redacted = redactDiagnosticDetails(details)
    expect(redacted.token).toBe('[redacted]')
    expect(redacted.roomId).toBe('[redacted]')
    expect(redacted.peerId).toBe(shortConnectionId(details.peerId))
    expect(redacted.sourceUrl).toBe('https://example.com/path')
    expect(['[redacted-secret]', '[redacted-hex]']).toContain(redacted.payload)
  })

  it('handles circular and deeply nested values without recursive explosions', () => {
    const circular: any = { name: 'root' }; circular.self = circular
    const redacted = redactDiagnosticDetails({ circular, nested: { a: { b: { c: { d: { e: 1 } } } } } }) as any
    expect(redacted.circular.self).toBe('[circular]')
    expect(JSON.stringify(redacted)).toContain('[max-depth]')
  })
})
