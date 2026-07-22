import type { LanNativeAgentCallback } from './types'
import { filterNativeEndpoints, validLanFileHttpEndpoint, validLanFileWebTransportEndpoint, validLanHttpBaseEndpoint, validLanWebTransportEndpoint } from './endpoint-validation'

const CALLBACK_CHANNEL = 'winrisef-native-agent-callback-v1'
const CALLBACK_STORAGE_KEY = 'winrisef-native-agent-callback-handoff'

export function createLanAgentLaunchRequest() {
	const nonceBytes = new Uint8Array(16)
	crypto.getRandomValues(nonceBytes)
	const nonce = Array.from(nonceBytes, byte => byte.toString(16).padStart(2, '0')).join('')
	const returnUrl = `${window.location.origin}/t/native-agent-return`
	const query = new URLSearchParams({ returnUrl, nonce })
	return { nonce, uri: `winrisef://launch?${query}` }
}

export function launchLanNativeAgent(uri: string) {
	const anchor = document.createElement('a')
	anchor.href = uri
	anchor.hidden = true
	document.body.append(anchor)
	anchor.click()
	anchor.remove()
}

export function consumeLanAgentCallback(): LanNativeAgentCallback | null {
	const params = new URLSearchParams(window.location.hash.slice(1))
	if (params.get('winrisef-agent') !== '1') return null
	const nonce = params.get('nonce') || ''
	const bridgeEndpoint = params.get('bridge') || ''
	const certificateSha256 = params.get('certificate') || ''
	const launchToken = params.get('token') || ''
	const expiresAt = Number(params.get('expires'))
	const networkEpoch = params.get('network-epoch') || 'legacy'
	const publicIpv6State = params.get('public-ipv6-state') || 'not-present'
	const benchmarkEndpoints = params.getAll('lan')
	const lnaHttpEndpoints = params.getAll('lan-http')
	const fileHttpEndpoints = params.getAll('file-http')
	const fileWebTransportEndpoints = params.getAll('file-wt')
	window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
	return validateCallback({ nonce, bridgeEndpoint, benchmarkEndpoints, lnaHttpEndpoints, fileHttpEndpoints, fileWebTransportEndpoints, certificateSha256, launchToken, expiresAt, bridgeVersion: bridgeVersion(bridgeEndpoint), networkEpoch, publicIpv6State: validPublicIpv6State(publicIpv6State) ? publicIpv6State : 'not-present' })
}

export function deliverLanAgentCallback(callback: LanNativeAgentCallback) {
	if ('BroadcastChannel' in window) {
		const channel = new BroadcastChannel(CALLBACK_CHANNEL)
		channel.postMessage(callback)
		channel.close()
		return
	}
	try {
		localStorage.setItem(CALLBACK_STORAGE_KEY, JSON.stringify(callback))
		localStorage.removeItem(CALLBACK_STORAGE_KEY)
	} catch {}
}

export function subscribeLanAgentCallbacks(listener: (callback: LanNativeAgentCallback) => void) {
	const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CALLBACK_CHANNEL) : null
	const onMessage = (event: MessageEvent<unknown>) => {
		const callback = parseCallback(event.data)
		if (callback) listener(callback)
	}
	const onStorage = (event: StorageEvent) => {
		if (event.key !== CALLBACK_STORAGE_KEY || !event.newValue) return
		try {
			const callback = parseCallback(JSON.parse(event.newValue))
			if (callback) listener(callback)
		} catch {}
	}
	if (channel) channel.addEventListener('message', onMessage)
	else window.addEventListener('storage', onStorage)
	return () => {
		if (channel) {
			channel.removeEventListener('message', onMessage)
			channel.close()
		} else window.removeEventListener('storage', onStorage)
	}
}

function parseCallback(value: unknown): LanNativeAgentCallback | null {
	if (!value || typeof value !== 'object') return null
	const callback = value as Partial<LanNativeAgentCallback>
	if (
		typeof callback.nonce !== 'string' ||
		typeof callback.bridgeEndpoint !== 'string' ||
		typeof callback.certificateSha256 !== 'string' ||
		typeof callback.launchToken !== 'string' ||
		typeof callback.expiresAt !== 'number' ||
		!Array.isArray(callback.benchmarkEndpoints) ||
		!Array.isArray(callback.lnaHttpEndpoints) ||
		!Array.isArray(callback.fileHttpEndpoints) ||
		!Array.isArray(callback.fileWebTransportEndpoints)
	)
		return null
	return validateCallback(callback as LanNativeAgentCallback)
}

function validateCallback(callback: LanNativeAgentCallback): LanNativeAgentCallback | null {
	if (!/^[0-9a-f]{32}$/i.test(callback.nonce) || !/^[0-9a-f]{64}$/i.test(callback.certificateSha256) || !/^[0-9a-f]{32}$/i.test(callback.launchToken))
		return null
	if (!Number.isSafeInteger(callback.expiresAt) || callback.expiresAt <= Date.now()) return null
	if (!validBridgeEndpoint(callback.bridgeEndpoint) || !/^(legacy|[0-9a-f]{16})$/i.test(callback.networkEpoch)) return null
	const benchmarkEndpoints = filterNativeEndpoints(callback.benchmarkEndpoints, validLanWebTransportEndpoint)
	const lnaHttpEndpoints = filterNativeEndpoints(callback.lnaHttpEndpoints, validLanHttpBaseEndpoint)
	const fileHttpEndpoints = filterNativeEndpoints(callback.fileHttpEndpoints, validLanFileHttpEndpoint)
	const fileWebTransportEndpoints = filterNativeEndpoints(callback.fileWebTransportEndpoints, validLanFileWebTransportEndpoint)
	const publicIpv6State = validPublicIpv6State(callback.publicIpv6State) ? callback.publicIpv6State : 'not-present'
	if ((!benchmarkEndpoints.length || (!fileHttpEndpoints.length && !fileWebTransportEndpoints.length)) && publicIpv6State !== 'authorizing') return null
	return { ...callback, benchmarkEndpoints, lnaHttpEndpoints, fileHttpEndpoints, fileWebTransportEndpoints, bridgeVersion: bridgeVersion(callback.bridgeEndpoint), publicIpv6State }
}

function validPublicIpv6State(value: unknown): value is LanNativeAgentCallback['publicIpv6State'] {
	return value === 'not-present' || value === 'authorizing' || value === 'available' || value === 'unavailable'
}

function validBridgeEndpoint(value: string) {
	try {
		const url = new URL(value)
		return url.protocol === 'https:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) && ['/winrisef/bridge/v2', '/winrisef/bridge/v3'].includes(url.pathname) && Boolean(url.port) && !url.search && !url.hash && !url.username && !url.password
	} catch {
		return false
	}
}

function bridgeVersion(value: string): 2 | 3 {
	try {
		return new URL(value).pathname.endsWith('/v3') ? 3 : 2
	} catch {
		return 2
	}
}
