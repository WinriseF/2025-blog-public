import { describe, expect, it } from 'vitest'
import { endpointAddressKind, filterNativeEndpoints, summarizeNativeEndpoints, validLanFileHttpEndpoint, validLanFileWebTransportEndpoint, validLanHttpBaseEndpoint, validLanWebTransportEndpoint } from '../../src/lib/lan-transfer/native-agent/endpoint-validation'

describe('Native Agent LAN endpoint validation', () => {
  it.each([
    ['10.0.0.1', 'private-ipv4'], ['100.64.0.1', 'private-ipv4'], ['172.16.0.1', 'private-ipv4'], ['192.168.1.1', 'private-ipv4'], ['fd00::1', 'ula-ipv6'], ['2001:4860:4860::8888', 'gua-ipv6']
  ] as const)('%s -> %s', (address, kind) => expect(endpointAddressKind(`https://${address.includes(':') ? `[${address}]` : address}:443/x`)).toBe(kind))

  it.each(['127.0.0.1', '169.254.1.1', '8.8.8.8', '2001:db8::1', '::ffff:192.168.1.1', 'fe80::1%eth0'])('rejects non-LAN/unsupported address %s', address => {
    expect(endpointAddressKind(`https://${address.includes(':') ? `[${address}]` : address}:443/x`)).toBeNull()
  })

  it('requires exact scheme/path/port and forbids credentials/query/hash', () => {
    expect(validLanHttpBaseEndpoint('http://192.168.1.2:43120/winrisef/lna/v1')).toBe(true)
    expect(validLanHttpBaseEndpoint('https://192.168.1.2:43120/winrisef/lna/v1')).toBe(false)
    expect(validLanHttpBaseEndpoint('http://u:p@192.168.1.2:43120/winrisef/lna/v1')).toBe(false)
    expect(validLanFileHttpEndpoint('http://192.168.1.2:43120/winrisef/file/v1?x=1')).toBe(false)
  })

  it('allows global IPv6 only for HTTPS WebTransport endpoints, not plain HTTP LNA', () => {
    expect(validLanWebTransportEndpoint('https://[2001:4860:4860::8888]:43121/winrisef/benchmark/v3')).toBe(true)
    expect(validLanFileWebTransportEndpoint('https://[2001:4860:4860::8888]:43121/winrisef/file/v1')).toBe(true)
    expect(validLanHttpBaseEndpoint('http://[2001:4860:4860::8888]:43120/winrisef/lna/v1')).toBe(false)
  })

  it('deduplicates validated endpoints and summarizes address families', () => {
    const values = ['http://10.0.0.1:1/winrisef/lna/v1', 'http://10.0.0.1:1/winrisef/lna/v1', 'bad']
    expect(filterNativeEndpoints(values, validLanHttpBaseEndpoint)).toEqual(['http://10.0.0.1:1/winrisef/lna/v1'])
    expect(summarizeNativeEndpoints(values)).toEqual({ count: 3, privateIpv4: 2, ulaIpv6: 0, guaIpv6: 0, invalid: 1 })
  })
})
