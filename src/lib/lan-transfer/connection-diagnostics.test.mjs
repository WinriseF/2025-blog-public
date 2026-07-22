import assert from 'node:assert/strict'
import test from 'node:test'
import { redactDiagnosticDetails } from './connection-diagnostics.ts'
import { summarizeNativeEndpoints } from './native-agent/endpoint-validation.ts'

test('redacts credentials and shortens identifiers before persistence', () => {
	const redacted = redactDiagnosticDetails({
		launchToken: '0123456789abcdef0123456789abcdef',
		nonce: 'abcdefabcdefabcdefabcdefabcdefab',
		deviceId: 'device-1234567890',
		error: 'certificate 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef failed',
		nested: { roomId: 'room-secret' },
	})
	assert.equal(redacted.launchToken, '[redacted]')
	assert.equal(redacted.nonce, '[redacted]')
	assert.equal(redacted.deviceId, 'device-1')
	assert.match(String(redacted.error), /\[redacted-hex\]/)
	assert.deepEqual(redacted.nested, { roomId: '[redacted]' })
})

test('summarizes endpoint address families without retaining addresses', () => {
	assert.deepEqual(
		summarizeNativeEndpoints([
			'http://192.168.1.2:17691/winrisef/lna/v1',
			'https://[fd12:3456::1]:17691/winrisef/benchmark/v3',
			'https://[2408:8207::1]:17691/winrisef/benchmark/v3',
			'https://example.com:17691/winrisef/benchmark/v3',
		]),
		{ count: 4, privateIpv4: 1, ulaIpv6: 1, guaIpv6: 1, invalid: 1 },
	)
})
