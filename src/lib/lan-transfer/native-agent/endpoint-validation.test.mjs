import assert from 'node:assert/strict'
import test from 'node:test'
import {
	filterNativeEndpoints,
	ipAddressKind,
	validLanFileWebTransportEndpoint,
	validLanHttpBaseEndpoint,
	validLanWebTransportEndpoint,
} from './endpoint-validation.ts'

test('classifies private IPv4, ULA and GUA without accepting special IPv6 ranges', () => {
	assert.equal(ipAddressKind('192.168.1.2'), 'private-ipv4')
	assert.equal(ipAddressKind('100.127.0.1'), 'private-ipv4')
	assert.equal(ipAddressKind('fd12:3456::1'), 'ula-ipv6')
	assert.equal(ipAddressKind('2408:8207::1'), 'gua-ipv6')
	for (const value of ['127.0.0.1', '169.254.1.1', '::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:c0a8:101'])
		assert.equal(ipAddressKind(value), null, value)
})

test('keeps public IPv6 exclusive to pinned WebTransport endpoints', () => {
	assert.equal(validLanHttpBaseEndpoint('http://[fd00::1]:17691/winrisef/lna/v1'), true)
	assert.equal(validLanHttpBaseEndpoint('http://[2408:8207::1]:17691/winrisef/lna/v1'), false)
	assert.equal(validLanWebTransportEndpoint('https://[2408:8207::1]:17691/winrisef/benchmark/v3'), true)
	assert.equal(validLanFileWebTransportEndpoint('https://[fd00::1]:17691/winrisef/file/v1'), true)
})

test('rejects hostnames, zone IDs, malformed authorities and endpoint suffixes', () => {
	for (const value of [
		'https://agent.local:17691/winrisef/benchmark/v3',
		'https://[fe80::1%25eth0]:17691/winrisef/benchmark/v3',
		'https://user@[2408:8207::1]:17691/winrisef/benchmark/v3',
		'https://[2408:8207::1]:0/winrisef/benchmark/v3',
		'https://[2408:8207::1]:17691/winrisef/benchmark/v2',
		'https://[2408:8207::1]:17691/winrisef/benchmark/v3?x=1',
		'https://[2408:8207::1]:17691/winrisef/benchmark/v3#x',
	]) assert.equal(validLanWebTransportEndpoint(value), false, value)
})

test('filters mixed endpoint lists without discarding valid entries', () => {
	const valid = 'https://[2408:8207::1]:17691/winrisef/benchmark/v3'
	assert.deepEqual(
		filterNativeEndpoints([valid, 'https://example.com:17691/winrisef/benchmark/v3', valid, 7], validLanWebTransportEndpoint),
		[valid],
	)
})
