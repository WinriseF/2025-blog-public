import type { VersionControlCallback } from './types'

const CALLBACK_CHANNEL = 'winrisef-version-control-callback-v1'
const CALLBACK_STORAGE_KEY = 'winrisef-version-control-callback-handoff'

export function createVersionControlLaunchRequest() {
	const bytes = new Uint8Array(16)
	crypto.getRandomValues(bytes)
	const nonce = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
	const returnUrl = `${window.location.origin}/toolbox/version-control/agent-return`
	const query = new URLSearchParams({ returnUrl, nonce, feature: 'version-control' })
	return { nonce, uri: `winrisef://launch?${query}` }
}

export function launchVersionControlAgent(uri: string) {
	const anchor = document.createElement('a')
	anchor.href = uri
	anchor.hidden = true
	document.body.append(anchor)
	anchor.click()
	anchor.remove()
}

export function consumeVersionControlCallback() {
	const params = new URLSearchParams(window.location.hash.slice(1))
	if (params.get('winrisef-version-control') !== '1') return null
	const callback = validateCallback({
		nonce: params.get('nonce') || '',
		bridgeEndpoint: params.get('bridge') || '',
		certificateSha256: params.get('certificate') || '',
		launchToken: params.get('token') || '',
		expiresAt: Number(params.get('expires')),
		error: params.get('error') || undefined
	})
	window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
	return callback
}

export function deliverVersionControlCallback(callback: VersionControlCallback) {
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

export function subscribeVersionControlCallbacks(listener: (callback: VersionControlCallback) => void) {
	const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CALLBACK_CHANNEL) : null
	const onMessage = (event: MessageEvent<unknown>) => {
		const callback = validateCallback(event.data)
		if (callback) listener(callback)
	}
	const onStorage = (event: StorageEvent) => {
		if (event.key !== CALLBACK_STORAGE_KEY || !event.newValue) return
		try {
			const callback = validateCallback(JSON.parse(event.newValue))
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

function validateCallback(value: unknown): VersionControlCallback | null {
	if (!value || typeof value !== 'object') return null
	const callback = value as Partial<VersionControlCallback>
	if (/^[0-9a-f]{32}$/i.test(callback.nonce || '') && callback.error === 'agent_busy') {
		return { nonce: callback.nonce!, bridgeEndpoint: '', certificateSha256: '', launchToken: '', expiresAt: 0, error: 'agent_busy' }
	}
	if (
		!/^[0-9a-f]{32}$/i.test(callback.nonce || '') ||
		!/^[0-9a-f]{64}$/i.test(callback.certificateSha256 || '') ||
		!/^[0-9a-f]{32}$/i.test(callback.launchToken || '')
	)
		return null
	if (!Number.isSafeInteger(callback.expiresAt) || Number(callback.expiresAt) <= Date.now()) return null
	if (!validBridgeEndpoint(callback.bridgeEndpoint || '')) return null
	return callback as VersionControlCallback
}

function validBridgeEndpoint(value: string) {
	try {
		const url = new URL(value)
		return (
			url.protocol === 'https:' &&
			['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) &&
			url.pathname === '/winrisef/version-control/v2' &&
			Boolean(url.port) &&
			!url.search &&
			!url.hash &&
			!url.username &&
			!url.password
		)
	} catch {
		return false
	}
}
